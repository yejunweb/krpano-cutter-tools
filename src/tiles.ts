import { canvasToBlob } from './canvas';
import type { CutterContext } from './context';
import { getJpegQualityForLevel } from './levels';
import type { CubeFace, LevelConfig, TileCanvas, TileData } from './types';

/**
 * 为单个立方体面生成瓦片
 *
 * 瓦片生成策略：
 * 1. 将立方体面划分为 tileSize × tileSize 的瓦片
 * 2. 最后一行/列的瓦片可能小于 tileSize
 * 3. Promise.all 并行生成所有瓦片
 * 4. 优先使用 OffscreenCanvas
 */
export async function generateTilesForFace(
    ctx: CutterContext,
    faceBitmap: ImageBitmap,
    level: LevelConfig,
    face: CubeFace,
    totalLevels: number
): Promise<TileData[]> {
    const width = level.width;
    const height = level.height;
    const { row, col, levelIndex } = level;
    const tileSize = ctx.tileSize;
    const quality = getJpegQualityForLevel(ctx, levelIndex, totalLevels);
    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const tilePromises: Array<Promise<TileData>> = [];

    for (let r = 0; r < row; r++) {
        for (let c = 0; c < col; c++) {
            const x = c * tileSize;
            const y = r * tileSize;
            const w = Math.min(tileSize, width - x);
            const h = Math.min(tileSize, height - y);
            tilePromises.push(
                createTile(
                    faceBitmap,
                    x,
                    y,
                    w,
                    h,
                    levelIndex,
                    r + 1,
                    c + 1,
                    useOffscreen,
                    quality,
                    face
                )
            );
        }
    }

    return Promise.all(tilePromises);
}

/**
 * 为 flat 某一分辨率层生成瓦片
 *
 * 瓦片生成策略与立方体面相同：
 * 1. 划分为 tileSize × tileSize 的瓦片
 * 2. 最后一行/列的瓦片可能小于 tileSize
 * 3. Promise.all 并行生成所有瓦片
 * 4. 优先使用 OffscreenCanvas
 * 命名无 face：l{level}_{row}_{col}.jpg
 */
export async function generateTilesForFlatLevel(
    ctx: CutterContext,
    levelBitmap: ImageBitmap,
    level: LevelConfig,
    totalLevels: number
): Promise<TileData[]> {
    const { width, height, row, col, levelIndex } = level;
    const tileSize = ctx.tileSize;
    const quality = getJpegQualityForLevel(ctx, levelIndex, totalLevels);
    const useOffscreen = typeof OffscreenCanvas !== 'undefined';
    const tilePromises: Array<Promise<TileData>> = [];

    for (let r = 0; r < row; r++) {
        for (let c = 0; c < col; c++) {
            const x = c * tileSize;
            const y = r * tileSize;
            const w = Math.min(tileSize, width - x);
            const h = Math.min(tileSize, height - y);
            tilePromises.push(
                createTile(
                    levelBitmap,
                    x,
                    y,
                    w,
                    h,
                    levelIndex,
                    r + 1,
                    c + 1,
                    useOffscreen,
                    quality
                )
            );
        }
    }

    return Promise.all(tilePromises);
}

/**
 * 异步创建单个瓦片
 *
 * @param sourceBitmap - 源 Bitmap（立方体面或 flat 层级图）
 * @param x - 瓦片在源图上的起始 X 坐标
 * @param y - 瓦片在源图上的起始 Y 坐标
 * @param w - 瓦片宽度
 * @param h - 瓦片高度
 * @param levelIndex - 层级索引
 * @param rowNum - 行号（从 1 开始）
 * @param colNum - 列号（从 1 开始）
 * @param useOffscreen - 是否使用 OffscreenCanvas
 * @param quality - JPEG 质量
 * @param face - 面标识（仅 cube）
 */
async function createTile(
    sourceBitmap: ImageBitmap,
    x: number,
    y: number,
    w: number,
    h: number,
    levelIndex: number,
    rowNum: number,
    colNum: number,
    useOffscreen: boolean,
    quality: number,
    face?: CubeFace
): Promise<TileData> {
    // 画布必须是瓦片真实像素。补成 tileSize 后，krpano 会把整图（含黑边）贴进
    // 右侧/下侧剩余网格，远景用到的低层会被明显拉长。
    const canvas: TileCanvas = useOffscreen
        ? new OffscreenCanvas(w, h)
        : document.createElement('canvas');
    if (!useOffscreen) {
        const htmlCanvas = canvas as HTMLCanvasElement;
        htmlCanvas.width = w;
        htmlCanvas.height = h;
    }

    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
        throw new Error('2D canvas context unavailable');
    }
    ctx2d.imageSmoothingEnabled = false;
    ctx2d.drawImage(sourceBitmap, x, y, w, h, 0, 0, w, h);

    const blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    const name = face
        ? `l${levelIndex}_${face}_${rowNum}_${colNum}.jpg`
        : `l${levelIndex}_${rowNum}_${colNum}.jpg`;

    // 返回瓦片数据对象
    return {
        blob, // 瓦片Blob数据
        levelNum: levelIndex, // 层级编号（用于文件路径）
        face, // 面标识（l/f/r/b/u/d）；flat 为 undefined
        row: rowNum, // 行号（从1开始，用于文件路径）
        col: colNum, // 列号（从1开始，用于文件路径）
        name, // 瓦片文件名
    };
}
