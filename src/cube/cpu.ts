import type { CutterContext } from '../context';
import type { CubeDirection, CubeFace, FaceBitmaps } from '../types';

/**
 * 根据立方体面和归一化坐标计算射线方向向量
 *
 * 坐标系说明：
 * - X轴：向右为正
 * - Y轴：向上为正
 * - Z轴：向前为正（朝向观察者）
 *
 * 六个面的视线方向：
 * - l (left): 看向 -X 方向
 * - f (front): 看向 -Z 方向
 * - r (right): 看向 +X 方向
 * - b (back): 看向 +Z 方向
 * - u (up): 看向 +Y 方向
 * - d (down): 看向 -Y 方向
 *
 * @param face - 面标识（l/f/r/b/u/d）
 * @param nx - 归一化X坐标 [-1, 1]，水平方向
 * @param ny - 归一化Y坐标 [-1, 1]，垂直方向
 */
export function getCubeDirection(
    face: CubeFace,
    nx: number,
    ny: number
): CubeDirection {
    // 将归一化坐标缩放0.5（映射到[-0.5, 0.5]范围）
    const x = nx * 0.5;
    const y = ny * 0.5;

    // 根据不同面返回对应的方向向量
    switch (face) {
        case 'l':
            return { x: -0.5, y: -y, z: -x }; // 左面：视线方向为-X
        case 'f':
            return { x: x, y: -y, z: -0.5 }; // 前面：视线方向为-Z
        case 'r':
            return { x: 0.5, y: -y, z: x }; // 右面：视线方向为+X
        case 'b':
            return { x: -x, y: -y, z: 0.5 }; // 后面：视线方向为+Z
        case 'u':
            return { x: x, y: 0.5, z: -y }; // 顶面：视线方向为+Y
        case 'd':
            return { x: x, y: -0.5, z: y }; // 底面：视线方向为-Y
        default:
            return { x: 0, y: 0, z: 0 }; // 默认返回原点（不应该发生）
    }
}

/**
 * CPU版本：将球面全景图转换为六个立方体面
 *
 * 当浏览器不支持WebGL时使用此方法作为降级方案。
 *
 * 转换流程：
 * 1. 将ImageBitmap绘制到canvas并获取像素数据
 * 2. 遍历六个立方体面
 * 3. 对每个面的每个像素，计算其在全景图上的对应位置
 * 4. 使用双线性插值采样颜色
 * 5. 将结果写入新的ImageBitmap
 */
export async function convertToCubeFacesCPU(
    ctx: CutterContext,
    sourceBitmap: ImageBitmap,
    srcWidth: number,
    srcHeight: number,
    faceSize: number
): Promise<FaceBitmaps> {
    const faces = {} as FaceBitmaps;

    // ==================== 准备源图像像素数据 ====================
    // 创建临时canvas用于读取原始图片像素数据
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = srcWidth;
    tempCanvas.height = srcHeight;
    const tempCtx = tempCanvas.getContext('2d');
    if (!tempCtx) {
        throw new Error('2D canvas context unavailable');
    }
    tempCtx.drawImage(sourceBitmap, 0, 0);
    // 获取原始图片的像素数据（RGBA格式，Uint8ClampedArray）
    const srcData = tempCtx.getImageData(0, 0, srcWidth, srcHeight).data;

    // ==================== 预计算常量（优化性能） ====================
    const PI = Math.PI; // 圆周率
    const PI2 = PI * 2; // 2π
    const halfPI = PI / 2; // π/2
    const faceSizeMinus1 = faceSize - 1; // 面尺寸-1（避免重复计算）
    const srcWidthMinus1 = srcWidth - 1; // 源宽度-1（边界检查用）
    const srcHeightMinus1 = srcHeight - 1; // 源高度-1（边界检查用）

    // 使用Float32Array优化像素访问（避免类型转换开销）
    const srcDataFloat = new Float32Array(srcData.buffer);

    // ==================== 遍历六个立方体面 ====================
    for (const face of ctx.faces) {
        // 创建当前面的canvas
        const canvas = document.createElement('canvas');
        canvas.width = faceSize;
        canvas.height = faceSize;
        const ctx2d = canvas.getContext('2d');
        if (!ctx2d) {
            throw new Error('2D canvas context unavailable');
        }
        const imageData = ctx2d.createImageData(faceSize, faceSize);
        const dstData = imageData.data;

        // 获取当前面的方向计算函数
        const getDir = (nx: number, ny: number) =>
            getCubeDirection(face, nx, ny);

        // ==================== 遍历当前面的每个像素 ====================
        for (let y = 0; y < faceSize; y++) {
            // 预计算行相关值：归一化Y坐标 [-1, 1]
            const ny = (2 * y) / faceSizeMinus1 - 1;
            // 预计算当前行在dstData中的偏移量（每行有faceSize*4个字节）
            const rowOffset = y * faceSize * 4;

            for (let x = 0; x < faceSize; x++) {
                // 计算当前像素在立方面上的归一化坐标 [-1, 1]
                const nx = (2 * x) / faceSizeMinus1 - 1;

                // 获取射线方向向量（从立方体中心指向当前像素）
                const dir = getDir(nx, ny);

                // 归一化为单位向量（球面坐标计算需要单位向量）
                const length = Math.sqrt(
                    dir.x * dir.x + dir.y * dir.y + dir.z * dir.z
                );
                const sx = dir.x / length;
                const sy = dir.y / length;
                const sz = dir.z / length;

                // 计算球面坐标（球坐标系）
                const theta = Math.atan2(sz, sx); // 水平角度（方位角）
                const phi = Math.asin(sy); // 垂直角度（极角）

                // 映射到equirectangular全景图纹理坐标 [0, 1]
                const texX = (theta + PI) / PI2;
                const texY = (halfPI - phi) / PI;

                // 转换为像素坐标并边界检查（防止越界访问）
                const srcX = Math.max(
                    0,
                    Math.min(srcWidthMinus1, texX * srcWidthMinus1)
                );
                const srcY = Math.max(
                    0,
                    Math.min(srcHeightMinus1, texY * srcHeightMinus1)
                );

                // ==================== 双线性插值采样 ====================
                // 获取四个相邻像素的整数坐标
                const x0 = Math.floor(srcX);
                const y0 = Math.floor(srcY);
                const x1 = Math.min(x0 + 1, srcWidthMinus1);
                const y1 = Math.min(y0 + 1, srcHeightMinus1);
                // 计算小数部分（插值权重）
                const fx = srcX - x0;
                const fy = srcY - y0;

                // 使用位运算优化索引计算（<< 2 等同于 * 4）
                const idx00 = (y0 * srcWidth + x0) << 2; // 左上角像素索引
                const idx01 = (y0 * srcWidth + x1) << 2; // 右上角像素索引
                const idx10 = (y1 * srcWidth + x0) << 2; // 左下角像素索引
                const idx11 = (y1 * srcWidth + x1) << 2; // 右下角像素索引

                // 双线性插值计算RGB通道值（内联展开优化）
                const r =
                    srcDataFloat[idx00]! * (1 - fx) * (1 - fy) +
                    srcDataFloat[idx01]! * fx * (1 - fy) +
                    srcDataFloat[idx10]! * (1 - fx) * fy +
                    srcDataFloat[idx11]! * fx * fy;
                const g =
                    srcDataFloat[idx00 + 1]! * (1 - fx) * (1 - fy) +
                    srcDataFloat[idx01 + 1]! * fx * (1 - fy) +
                    srcDataFloat[idx10 + 1]! * (1 - fx) * fy +
                    srcDataFloat[idx11 + 1]! * fx * fy;
                const b =
                    srcDataFloat[idx00 + 2]! * (1 - fx) * (1 - fy) +
                    srcDataFloat[idx01 + 2]! * fx * (1 - fy) +
                    srcDataFloat[idx10 + 2]! * (1 - fx) * fy +
                    srcDataFloat[idx11 + 2]! * fx * fy;

                // 计算目标像素索引
                const idx = rowOffset + (x << 2);
                // 设置RGB通道值（+0.5实现四舍五入）
                dstData[idx] = r + 0.5;
                dstData[idx + 1] = g + 0.5;
                dstData[idx + 2] = b + 0.5;
                dstData[idx + 3] = 255; // Alpha通道设为不透明
            }
        }

        // 将像素数据绘制到canvas
        ctx2d.putImageData(imageData, 0, 0);
        // 将canvas转换为ImageBitmap并存储
        faces[face] = await createImageBitmap(canvas);
    }

    // 返回六个立方体面的Bitmap对象
    return faces;
}
