import { decodeImage, resizeBitmap } from './canvas'
import { CUBE_FACES } from './constants'
import type { CutterContext } from './context'
import { convertToCubeFaces } from './cube/convert'
import { analyzeLevels, buildMultiresStr } from './levels'
import { generateCubeStripPreview, generateThumb } from './preview'
import { generateTilesForFace } from './tiles'
import type {
    CubeFace,
    LogCallback,
    MakeTilesResult,
    ProgressCallback,
    PureFrontendTileCutterOptions,
    TileData,
} from './types'
import { generateXmlCode } from './xml'

class PureFrontendTileCutter {
    readonly tileSize: number // 瓦片边长（像素），默认 512
    readonly maxCubeSize: number // 立方体面最大边长，默认 2048
    readonly jpegQuality: number // 最高层级瓦片 JPEG 质量 0–1，默认 0.82
    readonly previewFaceSize: number // 预览条带每面像素（3×2 布局），默认 256
    readonly previewQuality: number // 预览图 JPEG 质量，默认 0.72
    readonly thumbWidth: number // 列表缩略图宽度，默认 480
    readonly thumbHeight: number // 列表缩略图高度，默认 240
    readonly thumbQuality: number // 缩略图 JPEG 质量，默认 0.7
    readonly onProgress: ProgressCallback // 切图进度：(percent, processed, total) => void
    readonly onLog: LogCallback // 切图日志：(message) => void
    readonly sceneId: string // 场景 ID，用于 OSS / XML 路径前缀
    readonly faces: readonly CubeFace[] = CUBE_FACES // l/f/r/b/u/d 六个立方体面

    /**
     * 构造函数，初始化切图器配置参数
     */
    constructor(options: PureFrontendTileCutterOptions = {}) {
        // 设置瓦片尺寸，默认512像素（krpano推荐尺寸）
        this.tileSize = options.tileSize || 512
        // 立方体面最大边长（对齐 krpano maxcubesize，限制最高层级瓦片数量，减轻缩放卡顿）
        this.maxCubeSize = options.maxCubeSize || 2048
        // 瓦片 JPEG 质量（最高层级）；低层级自动再降低以加快解码
        this.jpegQuality = options.jpegQuality || 0.82
        // 立方体条带预览：每面像素（3×2 布局，krpano cube 加载过渡更快）
        this.previewFaceSize = options.previewFaceSize || 256
        this.previewQuality = options.previewQuality || 0.72
        // 列表缩略图（等距柱状，体积极小）
        this.thumbWidth = options.thumbWidth || 480
        this.thumbHeight = options.thumbHeight || 240
        this.thumbQuality = options.thumbQuality || 0.7
        // 设置进度回调函数，用于外部显示切图进度
        this.onProgress = options.onProgress || (() => {})
        // 设置日志回调函数，用于输出切图过程信息
        this.onLog = options.onLog || (() => {})
        // 场景ID，用于生成正确的OSS存储路径（如 panos/sceneId/...）
        this.sceneId = options.sceneId || ''
    }

    /** 供各子模块使用的运行时上下文 */
    private get ctx(): CutterContext {
        return {
            tileSize: this.tileSize,
            maxCubeSize: this.maxCubeSize,
            jpegQuality: this.jpegQuality,
            previewFaceSize: this.previewFaceSize,
            previewQuality: this.previewQuality,
            thumbWidth: this.thumbWidth,
            thumbHeight: this.thumbHeight,
            thumbQuality: this.thumbQuality,
            onLog: this.onLog,
            onProgress: this.onProgress,
            faces: this.faces,
        }
    }

    /**
     * 主入口方法：执行全景图切图完整流程
     *
     * 切图流程：
     * 1. 解码图片 → 2. 球面→立方体转换 → 3. 分析层级 → 4. 并行生成瓦片 → 5. 生成预览图 → 6. 生成XML
     *
     * @param file - 上传的全景图文件（支持 JPEG、PNG 等格式）
     */
    async makeTiles(file: File): Promise<MakeTilesResult> {
        // 记录开始时间，用于计算总耗时（毫秒）
        const start = performance.now()
        const ctx = this.ctx

        // ==================== 阶段1：解码图片 ====================
        this.onLog('正在解码图片...')
        const { width, height, bitmap } = await decodeImage(file)
        this.onLog(`图片尺寸: ${width}x${height}`)

        // ==================== 阶段2：球面→立方体转换 ====================
        this.onLog('正在转换立方体面...')
        // 将等矩形球面全景图转换为六个立方体面的Bitmap对象
        // 优先使用WebGL GPU加速，不支持则降级到CPU版本
        const faceBitmaps = await convertToCubeFaces(ctx, bitmap, width, height)
        this.onLog('立方体面转换完成')

        // ==================== 阶段3：分析多级分辨率层级 ====================
        const rawFaceSize = Math.floor(width / 4)
        const faceSize = Math.min(rawFaceSize, this.maxCubeSize)
        const levels = analyzeLevels(ctx, faceSize)
        this.onLog(
            `立方体面: ${faceSize}px (原 ${rawFaceSize}px), 层级: ${levels.length}, 瓦片/面(最高层): ${levels[levels.length - 1]!.row}×${levels[levels.length - 1]!.col}`
        )

        // ==================== 阶段4：预览图（cube 条带 + 缩略图，在切瓦片前生成） ====================
        const previewBlob = await generateCubeStripPreview(ctx, faceBitmaps)
        const thumbBlob = await generateThumb(ctx, bitmap)

        // ==================== 阶段5：逐级缩放生成瓦片（金字塔下采样，减少重复大图缩放） ====================
        // 预计算总瓦片数（6个面 × 每层的瓦片数），用于进度计算
        const totalTiles =
            levels.reduce((sum, level) => sum + level.row * level.col, 0) * 6

        // 使用对象引用保存已处理瓦片数（因为闭包中无法修改基本类型）
        const processedTilesRef = { value: 0 }

        // 并行处理六个立方体面（Promise.all 并行执行）
        const totalLevels = levels.length
        const facePromises = this.faces.map(async face => {
            this.onLog(`处理 ${face} 面...`)
            const faceBitmap = faceBitmaps[face]
            const faceTiles: TileData[] = []
            let levelBitmap = faceBitmap
            let ownedBitmap: ImageBitmap | null = null

            // 从最高分辨率层往低层走，每层由上一层下采样得到
            for (let i = levels.length - 1; i >= 0; i--) {
                const level = levels[i]!

                if (
                    levelBitmap.width !== level.size ||
                    levelBitmap.height !== level.size
                ) {
                    const resized = await resizeBitmap(
                        levelBitmap,
                        level.size,
                        level.size
                    )
                    if (ownedBitmap) ownedBitmap.close()
                    levelBitmap = resized
                    ownedBitmap = resized
                }

                const tiles = await generateTilesForFace(
                    ctx,
                    levelBitmap,
                    level,
                    face,
                    totalLevels
                )
                faceTiles.push(...tiles)

                processedTilesRef.value += tiles.length
                const percent = Math.round(
                    (processedTilesRef.value / totalTiles) * 100
                )
                this.onProgress(percent, processedTilesRef.value, totalTiles)
            }

            if (ownedBitmap) ownedBitmap.close()
            faceBitmap.close()
            return faceTiles
        })

        // 等待所有面处理完成
        const allTiles = (await Promise.all(facePromises)).flat()

        // ==================== 阶段6：生成XML ====================
        // 提取文件名（不含扩展名）作为目录名（用于OSS存储路径）
        const dirName = file.name.replace(/\.[^/.]+$/, '')
        // 生成krpano所需的三种XML配置代码变体
        const xmlCode = generateXmlCode(
            this.tileSize,
            file,
            dirName,
            this.sceneId,
            levels
        )

        // 释放原始图片Bitmap内存（避免内存泄漏）
        bitmap.close()

        // ==================== 完成切图 ====================
        const duration = ((performance.now() - start) / 1000).toFixed(2)
        this.onLog(`切图完成! 耗时: ${duration}s, 瓦片: ${totalTiles}`)

        // 构造 krpano multires 短语法：tilesize,level1,level2,...（必须列出全部层级尺寸）
        const multiresStr = buildMultiresStr(ctx, levels)

        // 返回切图结果对象
        return {
            dirName, // 目录名称（文件名不含扩展名）
            content: allTiles, // 所有瓦片数据数组
            duration: `${duration}s`, // 耗时字符串（如 "12.34s"）
            code: {
                scene: xmlCode.scene, // 完整场景XML代码（包含view、preview、image）
                cubeImage: '', // 保留字段（立方体格式图片路径）
                tileImage: xmlCode.tileImage, // 带层级的<image>标签代码
                shortTileImage: xmlCode.shortTileImage, // 简化版<image><cube>格式代码
                multires: multiresStr, // multires配置字符串
            },
            preview: previewBlob,
            thumb: thumbBlob,
            levels: levels.length, // 层级数量
            tiles: totalTiles, // 瓦片总数
            width, // 原始图片宽度
            height, // 原始图片高度
        }
    }
}

export default PureFrontendTileCutter
