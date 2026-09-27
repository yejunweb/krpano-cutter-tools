import type { CubeFace, LogCallback, ProgressCallback } from './types'

/** 切图流水线各模块共享的运行时配置（内部使用） */
export interface CutterContext {
    tileSize: number
    maxCubeSize: number
    jpegQuality: number
    previewFaceSize: number
    previewQuality: number
    thumbWidth: number
    thumbHeight: number
    thumbQuality: number
    onLog: LogCallback
    onProgress: ProgressCallback
    faces: readonly CubeFace[]
}
