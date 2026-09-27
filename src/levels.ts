import type { CutterContext } from './context'
import type { LevelConfig } from './types'

/** 将层级尺寸对齐到 64 像素与 tileSize 整数倍 */
function alignLevelSize(ctx: CutterContext, size: number): number {
    let aligned = Math.round(size / 64) * 64
    aligned = Math.round(aligned / ctx.tileSize) * ctx.tileSize
    return Math.max(ctx.tileSize, aligned)
}

/**
 * 低层级用更低 JPEG 质量，优先保证 l1/l2 快速解码完成，缩放时少卡顿
 */
export function getJpegQualityForLevel(
    ctx: CutterContext,
    levelIndex: number,
    totalLevels: number
): number {
    if (totalLevels <= 1) return ctx.jpegQuality
    const t = (levelIndex - 1) / (totalLevels - 1)
    const minQ = Math.max(0.65, ctx.jpegQuality - 0.14)
    return minQ + t * (ctx.jpegQuality - minQ)
}

/** 分析多级分辨率层级（krpano 约定 l1=最低分辨率，lN=最高分辨率） */
export function analyzeLevels(
    ctx: CutterContext,
    faceSize: number
): LevelConfig[] {
    // 从最高分辨率逐层减半，直到 tileSize
    const levels: LevelConfig[] = []
    let current = faceSize

    while (true) {
        const size = alignLevelSize(ctx, current)
        if (size <= 0) break

        // 避免对齐后重复层级（如 600→512 与 300→512）
        if (levels.length && levels[levels.length - 1]!.size === size) {
            if (size <= ctx.tileSize) break
            current = current / 2
            continue
        }

        levels.push({
            size,
            row: size / ctx.tileSize,
            col: size / ctx.tileSize,
            levelIndex: levels.length + 1,
        })

        if (size <= ctx.tileSize) break
        current = current / 2
    }

    // krpano 约定 l1=最低分辨率，lN=最高分辨率
    return levels.reverse().map((level, idx) => ({
        ...level,
        levelIndex: idx + 1,
    }))
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
    const levelSizes = levels.map(l => l.size).join(',')
    return `${ctx.tileSize},${levelSizes}#%s/l%l/%v/l%l_%s_%v_%h.jpg`
}
