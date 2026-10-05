/** 立方体面标识：l=左 f=前 r=右 b=后 u=上 d=下 */
export type CubeFace = 'l' | 'f' | 'r' | 'b' | 'u' | 'd';

/** 六个立方体面的 ImageBitmap 集合 */
export type FaceBitmaps = Record<CubeFace, ImageBitmap>;

/** 单个 multires 层级的尺寸与瓦片网格 */
export interface LevelConfig {
    /** 该层级图像宽度（像素）；cube 时等于 size */
    width: number;
    /** 该层级图像高度（像素）；cube 时等于 size */
    height: number;
    size: number; // 该层级边长（cube 为正方形边长；flat 为 max(width, height)）
    row: number; // 瓦片行数
    col: number; // 瓦片列数
    levelIndex: number; // 层级编号，l1=最低分辨率
}

/** 单个 JPEG 瓦片 */
export interface TileData {
    blob: Blob; // 瓦片二进制数据
    levelNum: number; // 层级编号，对应路径 l{N}
    face?: CubeFace; // 面标识（仅 cube；flat 无此字段）
    row: number; // 行号（从 1 开始）
    col: number; // 列号（从 1 开始）
    name: string; // 文件名，如 l3_f_1_2.jpg（cube）或 l3_1_2.jpg（flat）
}

/** `_generateXmlCode` 内部返回值 */
export interface XmlCodeResult {
    scene: string; // 完整 scene XML
    tileImage: string; // 带 <level> 的 multires <image>
    shortTileImage: string; // 简化 <cube multires="..."> / <flat multires="..."> 格式
}

/** krpano XML / multires 配置片段 */
export interface MakeTilesCode {
    scene: string; // 完整 scene XML（含 view、preview、image）
    cubeImage: string; // 保留字段，当前为空字符串
    tileImage: string; // 带层级的 <image> 标签
    shortTileImage: string; // 简化版 <image><cube> / <flat> 格式
    multires: string; // multires 短语法，如 512,512,1024#%s/l%l/...
}

/** `makeCubeTiles` / `makeFlatTiles` 返回值 */
export interface MakeTilesResult {
    dirName: string; // 目录名（文件名不含扩展名）
    content: TileData[]; // 全部瓦片
    duration: string; // 耗时字符串，如 "12.34s"
    code: MakeTilesCode; // XML 与 multires 配置
    preview: Blob; // 预览图（cube 为 3×2 条带；flat 为整图缩放）
    thumb: Blob; // 列表缩略图
    levels: number; // 分辨率层级数量
    tiles: number; // 瓦片总数（cube 为 6 面 × 各层；flat 为各层之和）
    width: number; // 原图宽度
    height: number; // 原图高度
}

/** 切图进度回调：(百分比, 已处理数, 总数) */
export type ProgressCallback = (
    percent: number,
    processed: number,
    total: number
) => void;

/** 切图日志回调 */
export type LogCallback = (message: string) => void;

/** cube / flat 共用选项 */
export interface BaseTilesOptions {
    tileSize?: number; // 瓦片边长，默认 512
    jpegQuality?: number; // 最高层级 JPEG 质量，默认 0.82
    previewQuality?: number; // 预览图 JPEG 质量，默认 0.72
    thumbWidth?: number; // 缩略图宽度（cube 默认 480；flat 默认 240）
    thumbHeight?: number; // 缩略图高度（cube 默认 240；flat 默认 135）
    thumbQuality?: number; // 缩略图 JPEG 质量，默认 0.7
    onProgress?: ProgressCallback; // 进度回调
    onLog?: LogCallback; // 日志回调
    sceneId?: string; // 场景 ID，用于 OSS / XML 路径前缀
}

/** `makeCubeTiles` 选项 */
export interface CubeTilesOptions extends BaseTilesOptions {
    maxCubeSize?: number; // 立方体面最大边长，默认 2048
    previewFaceSize?: number; // 预览条带每面像素，默认 256
}

/** `makeFlatTiles` 选项 */
export interface FlatTilesOptions extends BaseTilesOptions {}

/** 立方体面上某像素对应的射线方向 */
export interface CubeDirection {
    x: number;
    y: number;
    z: number;
}

/** 瓦片编码用的 canvas 类型 */
export type TileCanvas = HTMLCanvasElement | OffscreenCanvas;
