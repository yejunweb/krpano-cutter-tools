import type { TileCanvas } from './types'

/** 获取 WebGL 上下文（兼容 webgl / experimental-webgl） */
export function getWebGLContext(
    canvas: HTMLCanvasElement
): WebGLRenderingContext | null {
    return (canvas.getContext('webgl') ||
        canvas.getContext('experimental-webgl')) as WebGLRenderingContext | null
}

/**
 * 检查浏览器是否支持WebGL
 *
 * 检测方式：
 * 1. 检查 window.WebGLRenderingContext 是否存在
 * 2. 创建 canvas 并尝试获取 webgl 或 experimental-webgl 上下文
 */
export function supportsWebGL(): boolean {
    try {
        // 创建临时canvas元素
        const canvas = document.createElement('canvas')
        // 检查WebGL上下文是否可用（兼容标准WebGL和实验性WebGL）
        return !!(window.WebGLRenderingContext && getWebGLContext(canvas))
    } catch {
        // 发生异常表示不支持
        return false
    }
}

/**
 * 获取 WebGL 最大纹理尺寸
 *
 * 浏览器通常限制为 16384（桌面）或 4096（移动端）。
 * 源图超出此尺寸时 texImage2D 会静默失败，导致采样全黑。
 */
export function getMaxTextureSize(): number {
    try {
        const canvas = document.createElement('canvas')
        const gl = getWebGLContext(canvas)
        if (gl) {
            return gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
        }
    } catch {
        // ignore
    }
    return 4096 // 保守回退值
}

/**
 * 将File对象解码为ImageBitmap
 *
 * File 继承 Blob，直接 createImageBitmap 即可；
 * 避免 fetch(blobUrl) 在生产环境 CSP / 大文件场景下 Failed to fetch
 */
export async function decodeImage(file: File) {
    const bitmap = await createImageBitmap(file, {
        premultiplyAlpha: 'none',
        colorSpaceConversion: 'none',
    })
    return {
        width: bitmap.width,
        height: bitmap.height,
        bitmap,
    }
}

/**
 * 调整Bitmap尺寸（用于生成多级分辨率）
 *
 * 使用 canvas 的 drawImage 方法进行高质量缩放，
 * 启用 imageSmoothing 以避免缩放后出现锯齿。
 */
export async function resizeBitmap(
    sourceBitmap: ImageBitmap,
    targetWidth: number,
    targetHeight: number
): Promise<ImageBitmap> {
    // 创建临时canvas用于缩放
    const canvas = document.createElement('canvas')
    canvas.width = targetWidth
    canvas.height = targetHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) {
        throw new Error('2D canvas context unavailable')
    }

    // 启用图像平滑（抗锯齿）
    ctx.imageSmoothingEnabled = true
    // 设置高质量平滑算法
    ctx.imageSmoothingQuality = 'high'
    // 绘制并缩放到目标尺寸
    ctx.drawImage(sourceBitmap, 0, 0, targetWidth, targetHeight)

    // 将canvas转换为ImageBitmap并返回
    return createImageBitmap(canvas)
}

/**
 * 将canvas转换为Blob（Promise封装）
 *
 * 兼容两种canvas类型：
 * - HTMLCanvasElement：toBlob()（回调方式）
 * - OffscreenCanvas：convertToBlob()（Promise方式）
 */
export async function canvasToBlob(
    canvas: TileCanvas,
    type: string,
    quality: number
): Promise<Blob> {
    // OffscreenCanvas 使用 convertToBlob() 方法（直接返回Promise）
    if (canvas instanceof OffscreenCanvas) {
        return canvas.convertToBlob({ type, quality })
    }
    // 普通HTMLCanvasElement使用 toBlob() 方法（需要封装为Promise）
    return new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
            blob => {
                if (blob) {
                    resolve(blob)
                } else {
                    reject(new Error('canvas.toBlob failed'))
                }
            },
            type,
            quality
        )
    })
}
