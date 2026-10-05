import { CUBE_FACES } from './constants';
import type {
    BaseTilesOptions,
    CubeFace,
    CubeTilesOptions,
    FlatTilesOptions,
    LogCallback,
    ProgressCallback,
} from './types';

/** 切图流水线各模块共享的运行时配置（内部使用） */
export interface CutterContext {
    tileSize: number; // 瓦片边长（像素），默认 512
    maxCubeSize: number; // 立方体面最大边长，默认 2048（flat 不用）
    jpegQuality: number; // 最高层级瓦片 JPEG 质量 0–1，默认 0.82
    previewFaceSize: number; // 预览条带每面像素（3×2 布局），默认 256
    previewQuality: number; // 预览图 JPEG 质量，默认 0.72
    thumbWidth: number; // 列表缩略图宽度
    thumbHeight: number; // 列表缩略图高度
    thumbQuality: number; // 缩略图 JPEG 质量，默认 0.7
    onLog: LogCallback; // 切图日志：(message) => void
    onProgress: ProgressCallback; // 切图进度：(percent, processed, total) => void
    faces: readonly CubeFace[]; // l/f/r/b/u/d 六个立方体面
    sceneId: string; // 场景 ID，用于 OSS / XML 路径前缀
}

function resolveBase(
    options: BaseTilesOptions,
    defaults: { thumbWidth: number; thumbHeight: number }
): Pick<
    CutterContext,
    | 'tileSize'
    | 'jpegQuality'
    | 'previewQuality'
    | 'thumbWidth'
    | 'thumbHeight'
    | 'thumbQuality'
    | 'onLog'
    | 'onProgress'
    | 'sceneId'
> {
    return {
        // 设置瓦片尺寸，默认512像素（krpano推荐尺寸）
        tileSize: options.tileSize || 512,
        // 瓦片 JPEG 质量（最高层级）；低层级自动再降低以加快解码
        jpegQuality: options.jpegQuality || 0.82,
        previewQuality: options.previewQuality || 0.72,
        // 列表缩略图
        thumbWidth: options.thumbWidth || defaults.thumbWidth,
        thumbHeight: options.thumbHeight || defaults.thumbHeight,
        thumbQuality: options.thumbQuality || 0.7,
        // 设置进度回调函数，用于外部显示切图进度
        onProgress: options.onProgress || (() => {}),
        // 设置日志回调函数，用于输出切图过程信息
        onLog: options.onLog || (() => {}),
        // 场景ID，用于生成正确的OSS存储路径（如 panos/sceneId/...）
        sceneId: options.sceneId || '',
    };
}

/** 由 cube 选项构建运行时上下文（供各子模块使用） */
export function createCubeContext(
    options: CubeTilesOptions = {}
): CutterContext {
    const base = resolveBase(options, { thumbWidth: 480, thumbHeight: 240 });
    return {
        ...base,
        // 立方体面最大边长（对齐 krpano maxcubesize，限制最高层级瓦片数量，减轻缩放卡顿）
        maxCubeSize: options.maxCubeSize || 2048,
        // 立方体条带预览：每面像素（3×2 布局，krpano cube 加载过渡更快）
        previewFaceSize: options.previewFaceSize || 256,
        faces: CUBE_FACES,
    };
}

/** 由 flat 选项构建运行时上下文（thumb 默认最长边约 240 的 16:9） */
export function createFlatContext(
    options: FlatTilesOptions = {}
): CutterContext {
    // 列表缩略图（体积极小；对齐 Krpano 官方 thumbsize≈240）
    const base = resolveBase(options, { thumbWidth: 240, thumbHeight: 135 });
    return {
        ...base,
        maxCubeSize: 0,
        previewFaceSize: 0,
        faces: CUBE_FACES,
    };
}
