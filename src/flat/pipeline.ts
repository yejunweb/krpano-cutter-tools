import { decodeImage, resizeBitmap } from '../canvas';
import { createFlatContext } from '../context';
import { analyzeFlatLevels, buildFlatMultiresStr } from '../levels';
import { generateFlatPreview, generateFlatThumb } from '../preview';
import { generateTilesForFlatLevel } from '../tiles';
import type { FlatTilesOptions, MakeTilesResult, TileData } from '../types';
import { generateFlatXmlCode } from '../xml';

/**
 * 主入口：执行平面图（flat / 高清矩阵）切图完整流程
 *
 * 切图流程：
 * 1. 解码图片 → 2. 分析层级 → 3. 生成预览图 → 4. 金字塔切瓦片 → 5. 生成XML
 *
 * 路径与 Krpano 官方一致：l{level}/{row}/l{level}_{row}_{col}.jpg
 *
 * @param file - 上传的平面图文件（支持 JPEG、PNG 等格式）
 * @param options - 切图配置（tileSize、sceneId、回调等）
 */
export async function makeFlatTiles(
    file: File,
    options: FlatTilesOptions = {}
): Promise<MakeTilesResult> {
    // 记录开始时间，用于计算总耗时（毫秒）
    const start = performance.now();
    const ctx = createFlatContext(options);

    // ==================== 阶段1：解码图片 ====================
    ctx.onLog('正在解码图片...');
    const { width, height, bitmap } = await decodeImage(file);
    ctx.onLog(`图片尺寸: ${width}x${height}`);

    // ==================== 阶段2：分析多级分辨率层级 ====================
    const levels = analyzeFlatLevels(ctx, width, height);
    const top = levels[levels.length - 1]!;
    ctx.onLog(
        `flat 层级: ${levels.length}, 最高层: ${top.width}x${top.height}, 瓦片网格: ${top.col}×${top.row}`
    );

    // ==================== 阶段3：预览图（在切瓦片前生成） ====================
    const previewBlob = await generateFlatPreview(ctx, bitmap);
    const thumbBlob = await generateFlatThumb(ctx, bitmap);

    // ==================== 阶段4：逐级缩放生成瓦片（金字塔下采样，减少重复大图缩放） ====================
    // 预计算总瓦片数（各层 row×col 之和），用于进度计算
    const totalTiles = levels.reduce(
        (sum, level) => sum + level.row * level.col,
        0
    );
    // 使用对象引用保存已处理瓦片数（因为闭包中无法修改基本类型）
    const processedTilesRef = { value: 0 };
    const totalLevels = levels.length;
    const allTiles: TileData[] = [];

    let levelBitmap = bitmap;
    let ownedBitmap: ImageBitmap | null = null;

    // 从最高分辨率层往低层走，每层由上一层下采样得到
    for (let i = levels.length - 1; i >= 0; i--) {
        const level = levels[i]!;
        ctx.onLog(
            `处理层级 l${level.levelIndex}: ${level.width}x${level.height}`
        );

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

        const tiles = await generateTilesForFlatLevel(
            ctx,
            levelBitmap,
            level,
            totalLevels
        );
        allTiles.push(...tiles);

        processedTilesRef.value += tiles.length;
        const percent = Math.round(
            (processedTilesRef.value / Math.max(totalTiles, 1)) * 100
        );
        ctx.onProgress(percent, processedTilesRef.value, totalTiles);
    }

    if (ownedBitmap) ownedBitmap.close();

    // ==================== 阶段5：生成XML ====================
    // 提取文件名（不含扩展名）作为目录名（用于OSS存储路径）
    const dirName = file.name.replace(/\.[^/.]+$/, '');
    // 生成krpano所需的三种XML配置代码变体
    const xmlCode = generateFlatXmlCode(
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
    const multiresStr = buildFlatMultiresStr(ctx, levels);

    // 返回切图结果对象
    return {
        dirName, // 目录名称（文件名不含扩展名）
        content: allTiles, // 所有瓦片数据数组
        duration: `${duration}s`, // 耗时字符串（如 "12.34s"）
        code: {
            scene: xmlCode.scene, // 完整场景XML代码（包含view、preview、image）
            cubeImage: '', // 保留字段（立方体格式图片路径）
            tileImage: xmlCode.tileImage, // 带层级的<image>标签代码
            shortTileImage: xmlCode.shortTileImage, // 简化版<flat>格式代码
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
