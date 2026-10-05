import type { CutterContext } from './context';
import type { LevelConfig } from './types';

/** flat 瓦片 URL 模板（相对 path 前缀，与 Krpano 官方一致） */
export const FLAT_TILE_URL_TEMPLATE = 'l%l/%v/l%l_%v_%h.jpg';

/** 将层级尺寸对齐到 64 像素与 tileSize 整数倍 */
function alignLevelSize(ctx: CutterContext, size: number): number {
    let aligned = Math.round(size / 64) * 64;
    aligned = Math.round(aligned / ctx.tileSize) * ctx.tileSize;
    return Math.max(ctx.tileSize, aligned);
}

/**
 * 低层级用更低 JPEG 质量，优先保证 l1/l2 快速解码完成，缩放时少卡顿
 */
export function getJpegQualityForLevel(
    ctx: CutterContext,
    levelIndex: number,
    totalLevels: number
): number {
    if (totalLevels <= 1) return ctx.jpegQuality;
    const t = (levelIndex - 1) / (totalLevels - 1);
    const minQ = Math.max(0.65, ctx.jpegQuality - 0.14);
    return minQ + t * (ctx.jpegQuality - minQ);
}

function toSquareLevel(
    size: number,
    tileSize: number,
    levelIndex: number
): LevelConfig {
    return {
        size,
        width: size,
        height: size,
        row: size / tileSize,
        col: size / tileSize,
        levelIndex,
    };
}

/** 分析多级分辨率层级（krpano 约定 l1=最低分辨率，lN=最高分辨率） */
export function analyzeLevels(
    ctx: CutterContext,
    faceSize: number
): LevelConfig[] {
    // 从最高分辨率逐层减半，直到 tileSize
    const levels: LevelConfig[] = [];
    let current = faceSize;

    while (true) {
        const size = alignLevelSize(ctx, current);
        if (size <= 0) break;

        // 避免对齐后重复层级（如 600→512 与 300→512）
        if (levels.length && levels[levels.length - 1]!.size === size) {
            if (size <= ctx.tileSize) break;
            current = current / 2;
            continue;
        }

        levels.push(toSquareLevel(size, ctx.tileSize, levels.length + 1));

        if (size <= ctx.tileSize) break;
        current = current / 2;
    }

    // krpano 约定 l1=最低分辨率，lN=最高分辨率
    return levels.reverse().map((level, idx) => ({
        ...level,
        levelIndex: idx + 1,
    }));
}

/**
 * 分析 flat 多级分辨率层级（对齐 Krpano 官方 levelstep=2，保持宽高比）
 *
 * krpano 约定 l1=最低分辨率，lN=最高分辨率
 */
export function analyzeFlatLevels(
    ctx: CutterContext,
    srcWidth: number,
    srcHeight: number
): LevelConfig[] {
    // 从最高分辨率逐层减半，直到最长边 <= tileSize
    const tileSize = ctx.tileSize;
    const levels: LevelConfig[] = [];
    let width = Math.max(1, Math.round(srcWidth));
    let height = Math.max(1, Math.round(srcHeight));

    while (true) {
        // 避免减半后尺寸不变导致死循环
        const last = levels[levels.length - 1];
        if (last && last.width === width && last.height === height) {
            break;
        }

        levels.push({
            width,
            height,
            size: Math.max(width, height),
            row: Math.ceil(height / tileSize),
            col: Math.ceil(width / tileSize),
            levelIndex: levels.length + 1,
        });

        if (Math.max(width, height) <= tileSize) break;

        const nextW = Math.max(1, Math.round(width / 2));
        const nextH = Math.max(1, Math.round(height / 2));
        if (nextW === width && nextH === height) break;
        width = nextW;
        height = nextH;
    }

    // krpano 约定 l1=最低分辨率，lN=最高分辨率
    return levels.reverse().map((level, idx) => ({
        ...level,
        levelIndex: idx + 1,
    }));
}

/**
 * 生成 krpano multires 配置字符串（短语法 + URL 模板）
 *
 * 格式：tilesize,level1,level2,...#url
 */
export function buildMultiresStr(
    ctx: CutterContext,
    levels: LevelConfig[]
): string {
    const levelSizes = levels.map(l => l.size).join(',');
    return `${ctx.tileSize},${levelSizes}#%s/l%l/%v/l%l_%s_%v_%h.jpg`;
}

/** flat 层级尺寸片段：正方形用数字，矩形用 WxH */
function flatLevelToken(level: LevelConfig): string {
    if (level.width === level.height) return String(level.width);
    return `${level.width}x${level.height}`;
}

/**
 * 生成 flat multires 配置字符串（短语法 + URL 模板）
 *
 * 格式：tilesize,level1,level2,...#url
 * 展示端无 # 时用固定模板；有 # 时取后半段 url
 */
export function buildFlatMultiresStr(
    ctx: CutterContext,
    levels: LevelConfig[]
): string {
    const levelSizes = levels.map(flatLevelToken).join(',');
    return `${ctx.tileSize},${levelSizes}#${FLAT_TILE_URL_TEMPLATE}`;
}
