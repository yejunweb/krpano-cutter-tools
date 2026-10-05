import { canvasToBlob } from './canvas';
import type { CutterContext } from './context';
import type { CubeFace, FaceBitmaps } from './types';

/**
 * 生成立方体条带预览图（3×2 CUBESTRIP，体积小、krpano cube 模式解码更快）
 */
export async function generateCubeStripPreview(
    ctx: CutterContext,
    faceBitmaps: FaceBitmaps
): Promise<Blob> {
    const s = ctx.previewFaceSize;
    const layout: Array<[CubeFace, number, number]> = [
        ['l', 0, 0],
        ['f', 1, 0],
        ['r', 2, 0],
        ['b', 0, 1],
        ['u', 1, 1],
        ['d', 2, 1],
    ];
    const canvas = document.createElement('canvas');
    canvas.width = s * 3;
    canvas.height = s * 2;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
        throw new Error('2D canvas context unavailable');
    }
    ctx2d.imageSmoothingEnabled = true;
    ctx2d.imageSmoothingQuality = 'medium';

    for (const [face, col, row] of layout) {
        ctx2d.drawImage(faceBitmaps[face], 0, 0, s, s, col * s, row * s, s, s);
    }

    return canvasToBlob(canvas, 'image/jpeg', ctx.previewQuality);
}

/** 列表缩略图（等距柱状小图） */
export async function generateThumb(
    ctx: CutterContext,
    bitmap: ImageBitmap
): Promise<Blob> {
    const canvas = document.createElement('canvas');
    canvas.width = ctx.thumbWidth;
    canvas.height = ctx.thumbHeight;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
        throw new Error('2D canvas context unavailable');
    }
    ctx2d.imageSmoothingEnabled = true;
    ctx2d.imageSmoothingQuality = 'medium';
    ctx2d.drawImage(bitmap, 0, 0, ctx.thumbWidth, ctx.thumbHeight);
    return canvasToBlob(canvas, 'image/jpeg', ctx.thumbQuality);
}

/** flat 预览图：整图等比缩放到最长边 1024（对应 preview.jpg） */
export async function generateFlatPreview(
    ctx: CutterContext,
    bitmap: ImageBitmap
): Promise<Blob> {
    const maxEdge = 1024;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
        throw new Error('2D canvas context unavailable');
    }
    ctx2d.imageSmoothingEnabled = true;
    ctx2d.imageSmoothingQuality = 'high';
    ctx2d.drawImage(bitmap, 0, 0, width, height);
    return canvasToBlob(canvas, 'image/jpeg', ctx.previewQuality);
}

/** flat 列表缩略图：等比放入 thumb 框（contain，对齐 Krpano 官方 thumbsize≈240） */
export async function generateFlatThumb(
    ctx: CutterContext,
    bitmap: ImageBitmap
): Promise<Blob> {
    const boxW = ctx.thumbWidth;
    const boxH = ctx.thumbHeight;
    const scale = Math.min(boxW / bitmap.width, boxH / bitmap.height, 1);
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx2d = canvas.getContext('2d');
    if (!ctx2d) {
        throw new Error('2D canvas context unavailable');
    }
    ctx2d.imageSmoothingEnabled = true;
    ctx2d.imageSmoothingQuality = 'medium';
    ctx2d.drawImage(bitmap, 0, 0, width, height);
    return canvasToBlob(canvas, 'image/jpeg', ctx.thumbQuality);
}
