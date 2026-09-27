import type { LevelConfig, XmlCodeResult } from './types'

/**
 * 生成krpano所需的XML配置代码
 *
 * 生成三种XML代码变体：
 * 1. scene - 完整场景配置（包含view、preview、image标签）
 * 2. tileImage - 带层级的<image>标签（适合多级分辨率）
 * 3. shortTileImage - 简化的<image><cube>格式（适合单级分辨率）
 */
export function generateXmlCode(
    tileSize: number,
    file: File,
    dirName: string,
    sceneId: string,
    levels: LevelConfig[]
): XmlCodeResult {
    // 提取文件名（不含扩展名）作为场景标题基础名称
    const baseName = file.name.replace(/\.[^/.]+$/, '')

    // 路径前缀：优先使用sceneId生成路径，否则使用dirName
    // 格式：sceneId 或 dirName（与上传路径保持一致）
    const pathPrefix = sceneId ? `${sceneId}` : `${dirName}`

    // ==================== 生成tileImage（带层级的<image>标签） ====================
    // 遍历所有层级，生成每个层级的<level>标签
    const levelTags = levels
        .map((level, idx) => {
            // 层级编号从1开始（krpano约定）
            const lNum = idx + 1
            // 生成单个层级标签，包含尺寸和URL模板
            // %s = 面标识(l/f/r/b/u/d), %v = 行号, %h = 列号, %l = 层级号
            return `                    <level tiledimageheight="${level.size}" tiledimagewidth="${level.size}">
                        <cube url="${pathPrefix}/%s/l${lNum}/%v/l${lNum}_%s_%v_%h.jpg" />
                    </level>`
        })
        .join('')

    // 组合完整的tileImage代码（multires=true表示多级分辨率）
    const tileImage = `<image multires="true" tilesize="${tileSize}" type="CUBE"> ${levelTags}</image>`

    // ==================== 生成shortTileImage（简化格式） ====================
    const multiresLevels = levels.map(l => l.size).join(',')
    const shortTileImage = `<image>
                  <cube url="${pathPrefix}/%s/l%l/%v/l%l_%s_%v_%h.jpg" multires="${tileSize},${multiresLevels}" />
               </image>`

    // ==================== 生成完整 scene 代码 ====================
    // scene 标签包含场景名称、标题、缩略图路径、经纬度等元数据
    // view 标签配置初始视角（水平视角、垂直视角、视场角等）
    // preview 标签指定预览图路径（用于加载过渡，避免黑色闪烁）
    const scene = `<scene name="scene_${dirName}" title="${baseName}" onstart="" thumburl="${pathPrefix}/thumb.jpg" lat="" lng="" heading="">

                <view hlookat="0.0" vlookat="0.0" fovtype="MFOV" fov="100" maxpixelzoom="1.5" fovmin="90" fovmax="120" limitview="auto" />

                <preview url="${pathPrefix}/preview.jpg" striporder="LFRBUD" />

                ${tileImage}</scene>`

    // 返回三种XML代码变体
    return { scene, tileImage, shortTileImage }
}
