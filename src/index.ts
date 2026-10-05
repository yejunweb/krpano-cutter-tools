/** 包入口：导出 makeCubeTiles / makeFlatTiles 与相关类型 */
export { makeCubeTiles } from './cube/pipeline';
export { makeFlatTiles } from './flat/pipeline';
export { FLAT_TILE_URL_TEMPLATE } from './levels';

export type {
    BaseTilesOptions,
    CubeDirection,
    CubeFace,
    CubeTilesOptions,
    FaceBitmaps,
    FlatTilesOptions,
    LevelConfig,
    LogCallback,
    MakeTilesCode,
    MakeTilesResult,
    ProgressCallback,
    TileData,
    XmlCodeResult,
} from './types';
