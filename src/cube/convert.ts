import { getMaxTextureSize, resizeBitmap, supportsWebGL } from '../canvas';
import type { CutterContext } from '../context';
import type { FaceBitmaps } from '../types';
import { convertToCubeFacesCPU } from './cpu';
import { convertToCubeFacesWebGL } from './webgl';

/**
 * 将球面全景图转换为六个立方体面
 *
 * 转换策略：
 * - 优先使用WebGL GPU加速
 * - 不支持WebGL时自动降级到CPU版本
 *
 * 立方体面尺寸：faceSize = min(floor(srcWidth / 4), maxCubeSize)
 */
export async function convertToCubeFaces(
    ctx: CutterContext,
    sourceBitmap: ImageBitmap,
    srcWidth: number,
    srcHeight: number
): Promise<FaceBitmaps> {
    const rawFaceSize = Math.floor(srcWidth / 4);
    const faceSize = Math.min(rawFaceSize, ctx.maxCubeSize);

    // 仅在源图超出 WebGL MAX_TEXTURE_SIZE（硬性 GPU 限制）时才缩放
    // 不做额外的“有效分辨率”裁剪——超出 GPU 限制的尺寸会导致 texImage2D 静默失败→黑屏
    // 但在限制内的多余分辨率经双线性插值采样后仍能提升极点区域质量，不应丢弃
    let maxSourceSize = Infinity;
    if (supportsWebGL()) {
        maxSourceSize = getMaxTextureSize();
    }

    let workBitmap = sourceBitmap;
    let workWidth = srcWidth;
    let workHeight = srcHeight;
    let needClose = false;

    if (srcWidth > maxSourceSize || srcHeight > maxSourceSize) {
        const scale = maxSourceSize / Math.max(srcWidth, srcHeight);
        workWidth = Math.floor(srcWidth * scale);
        workHeight = Math.floor(srcHeight * scale);
        workBitmap = await resizeBitmap(sourceBitmap, workWidth, workHeight);
        needClose = true;
        ctx.onLog(
            `源图过大(${srcWidth}x${srcHeight})，已缩放至 ${workWidth}x${workHeight} 用于转换`
        );
    }

    let faces: FaceBitmaps;
    if (supportsWebGL()) {
        try {
            faces = await convertToCubeFacesWebGL(
                ctx,
                workBitmap,
                workWidth,
                workHeight,
                faceSize
            );
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            ctx.onLog(`WebGL 转换失败: ${message}，降级到 CPU 模式`);
            faces = await convertToCubeFacesCPU(
                ctx,
                workBitmap,
                workWidth,
                workHeight,
                faceSize
            );
        }
    } else {
        faces = await convertToCubeFacesCPU(
            ctx,
            workBitmap,
            workWidth,
            workHeight,
            faceSize
        );
    }

    if (needClose) workBitmap.close();
    return faces;
}
