import { decodeImage, resizeBitmap } from '../canvas';
import { createCubeContext } from '../context';
import { analyzeLevels, buildMultiresStr } from '../levels';
import { generateCubeStripPreview, generateThumb } from '../preview';
import { generateTilesForFace } from '../tiles';
import type { CubeTilesOptions, MakeTilesResult, TileData } from '../types';
import { generateXmlCode } from '../xml';
import { convertToCubeFaces } from './convert';

/**
 * 主入口：执行全景图（cube）切图完整流程
 *
 * 切图流程：
 * 1. 解码图片 → 2. 球面→立方体转换 → 3. 分析层级 → 4. 并行生成瓦片 → 5. 生成预览图 → 6. 生成XML
 *
 * @param file - 上传的全景图文件（支持 JPEG、PNG 等格式）
 * @param options - 切图配置（tileSize、sceneId、回调等）
 */
export async function makeCubeTiles(
    file: File,
    options: CubeTilesOptions = {}
): Promise<MakeTilesResult> {
    // 记录开始时间，用于计算总耗时（毫秒）
    const start = performance.now();
    const ctx = createCubeContext(options);

    // ==================== 阶段1：解码图片 ====================
    ctx.onLog('正在解码图片...');
    const { width, height, bitmap } = await decodeImage(file);
    ctx.onLog(`图片尺寸: ${width}x${height}`);

    // ==================== 阶段2：球面→立方体转换 ====================
    ctx.onLog('正在转换立方体面...');
    // 将等矩形球面全景图转换为六个立方体面的Bitmap对象
    // 优先使用WebGL GPU加速，不支持则降级到CPU版本
    const faceBitmaps = await convertToCubeFaces(ctx, bitmap, width, height);
    ctx.onLog('立方体面转换完成');

    // ==================== 阶段3：分析多级分辨率层级 ====================
    const rawFaceSize = Math.floor(width / 4);
    const faceSize = Math.min(rawFaceSize, ctx.maxCubeSize);
    const levels = analyzeLevels(ctx, faceSize);
    ctx.onLog(
        `立方体面: ${faceSize}px (原 ${rawFaceSize}px), 层级: ${levels.length}, 瓦片/面(最高层): ${levels[levels.length - 1]!.row}×${levels[levels.length - 1]!.col}`
    );

    // ==================== 阶段4：预览图（cube 条带 + 缩略图，在切瓦片前生成） ====================
    const previewBlob = await generateCubeStripPreview(ctx, faceBitmaps);
    const thumbBlob = await generateThumb(ctx, bitmap);

    // ==================== 阶段5：逐级缩放生成瓦片（金字塔下采样，减少重复大图缩放） ====================
    // 预计算总瓦片数（6个面 × 每层的瓦片数），用于进度计算
    const totalTiles =
        levels.reduce((sum, level) => sum + level.row * level.col, 0) * 6;

    // 使用对象引用保存已处理瓦片数（因为闭包中无法修改基本类型）
    const processedTilesRef = { value: 0 };

    // 并行处理六个立方体面（Promise.all 并行执行）
    const totalLevels = levels.length;
    const facePromises = ctx.faces.map(async face => {
        ctx.onLog(`处理 ${face} 面...`);
        const faceBitmap = faceBitmaps[face];
        const faceTiles: TileData[] = [];
        let levelBitmap = faceBitmap;
        let ownedBitmap: ImageBitmap | null = null;

        // 从最高分辨率层往低层走，每层由上一层下采样得到
        for (let i = levels.length - 1; i >= 0; i--) {
            const level = levels[i]!;

            if (
                levelBitmap.width !== level.width ||
                levelBitmap.height !== level.height
            ) {
                const resized = await resizeBitmap(
                    levelBitmap,
                    level.width,
                    level.height
                );
                if (ownedBitmap) ownedBitmap.close();
                levelBitmap = resized;
                ownedBitmap = resized;
            }

            const tiles = await generateTilesForFace(
                ctx,
                levelBitmap,
                level,
                face,
                totalLevels
            );
            faceTiles.push(...tiles);

            processedTilesRef.value += tiles.length;
            const percent = Math.round(
                (processedTilesRef.value / totalTiles) * 100
            );
            ctx.onProgress(percent, processedTilesRef.value, totalTiles);
        }

        if (ownedBitmap) ownedBitmap.close();
        faceBitmap.close();
        return faceTiles;
    });

    // 等待所有面处理完成
    const allTiles = (await Promise.all(facePromises)).flat();

    // ==================== 阶段6：生成XML ====================
    // 提取文件名（不含扩展名）作为目录名（用于OSS存储路径）
    const dirName = file.name.replace(/\.[^/.]+$/, '');
    // 生成krpano所需的三种XML配置代码变体
    const xmlCode = generateXmlCode(
        ctx.tileSize,
        file,
        dirName,
        ctx.sceneId,
        levels
    );

    // 释放原始图片Bitmap内存（避免内存泄漏）
    bitmap.close();

    // ==================== 完成切图 ====================
    const duration = ((performance.now() - start) / 1000).toFixed(2);
    ctx.onLog(`切图完成! 耗时: ${duration}s, 瓦片: ${totalTiles}`);

    // 构造 krpano multires 短语法：tilesize,level1,level2,...（必须列出全部层级尺寸）
    const multiresStr = buildMultiresStr(ctx, levels);

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
    };
}
