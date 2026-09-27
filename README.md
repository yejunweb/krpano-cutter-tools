# krpano-cutter-tools

纯浏览器端 krpano 全景图切图工具，将等距柱状全景图转换为立方体 multires 瓦片。

## 背景与瓶颈

等距柱状全景在 1:2 比例下像素量可达 ~1 亿级（如 14099×7050 ≈ 99 MP），单文件体积常见 100–200 MB。典型旧方案链路为：

1. 浏览器 `decode` 整图并在内存中保留全分辨率位图
2. 在 CPU / Canvas 2D 侧生成一倍图、三倍图等多档副本
3. 整图上传 OSS 后，由服务端再切 multires 瓦片

主要瓶颈：

- **主线程长时间阻塞**：大图 decode + 2D 绘制占用主线程，UI 事件队列无法及时处理
- **内存峰值叠加**：源图与多档降采样副本同时驻留，易触发 OOM 或标签页崩溃
- **链路冗余**：整图上传 + 服务端二次切图，I/O 与转码重复

本库在浏览器端直接产出 krpano multires 瓦片：`ImageBitmap` 解码 → WebGL equirect-to-cube → 分层 JPEG 编码；六面与瓦片并行生成，上传粒度为单瓦片 `Blob`，跳过中间分辨率副本与整包二次切图。

## 性能基准

测试样本：14099×7050（~99 MP），JPEG 100–200 MB；统计范围含本地切图与 OSS 并发上传。

| 项目 | 数值 |
|------|------|
| 输入分辨率 | 14099 × 7050 |
| 输入体积 | 100–200 MB |
| 端到端耗时 | < 20 s |

对比基线（一倍图 / 三倍图 + 服务端切图，同等素材与网络环境）：端到端耗时约 **50–100×** 差距，具体倍数受 GPU 型号、瓦片并发上传数与带宽影响。

## 主要功能

1. **全景图解码**：将上传的图片文件解码为 `ImageBitmap`
2. **球面→立方体转换**：等矩形全景图映射到六个立方体面（l / f / r / b / u / d）
3. **多级分辨率瓦片**：按原图尺寸自动计算层级，生成金字塔结构瓦片
4. **XML 配置生成**：输出 krpano 所需的 `scene`、`tileImage`、`multires` 配置
5. **预览图生成**：立方体条带预览（3×2 CUBESTRIP）与列表缩略图

## 技术特性

1. **WebGL GPU 加速**：球面到立方体转换优先走 GPU，显著快于 CPU
2. **自动降级**：不支持 WebGL 或 GPU 失败时自动切换 CPU 版本
3. **并行处理**：六个立方体面与瓦片生成均并行执行
4. **OffscreenCanvas**：支持离屏 canvas 加速瓦片编码
5. **双线性插值**：CPU 降级路径使用双线性采样提升画质

## 实现原理

### 切图流水线

`PureFrontendTileCutter.makeTiles()` 按六个阶段编排，各阶段由独立模块实现：

```
File
  │
  ▼ ① decodeImage          canvas.ts — createImageBitmap 直接解码
  │
  ▼ ② convertToCubeFaces   cube/convert.ts — WebGL 优先，失败降级 CPU
  │     ├─ webgl.ts         片段着色器：equirect → 六面 render target
  │     └─ cpu.ts           逐像素射线映射 + 双线性插值
  │
  ▼ ③ analyzeLevels        levels.ts — 按 faceSize 生成 multires 金字塔
  │
  ▼ ④ 预览图               preview.ts — 3×2 条带 preview + 等距柱状 thumb
  │
  ▼ ⑤ 瓦片编码             tiles.ts — 六面 × 各层并行，OffscreenCanvas 优先
  │     └─ 金字塔下采样      canvas.ts resizeBitmap — 高层→低层逐级缩放
  │
  ▼ ⑥ generateXmlCode      xml.ts — scene / tileImage / multires 字符串
  │
  ▼ MakeTilesResult
```

### 核心算法

**球面 → 立方体（equirect-to-cube）**

- 立方体面边长：`faceSize = min(floor(srcWidth / 4), maxCubeSize)`
- 对面上每个像素，从立方体中心发出射线，转为球坐标 `(θ, φ)`，再映射到等距柱状纹理坐标采样
- WebGL 路径：全景图上传为 GPU 纹理，片段着色器并行计算六面；源图超过 `MAX_TEXTURE_SIZE` 时先等比缩放再上传
- CPU 路径：读取 `ImageData`，对内联双线性插值，作为 WebGL 不可用或纹理上传失败时的降级

**多级分辨率金字塔**

- 从最高 `faceSize` 起每层减半，尺寸对齐到 64 像素与 `tileSize` 整数倍
- krpano 约定：`l1` = 最低分辨率，`lN` = 最高分辨率
- 瓦片生成从最高层往低层走，每层由上一层 `resizeBitmap` 下采样，避免对同一面重复大图缩放
- 低层级 JPEG 质量自动降低（`getJpegQualityForLevel`），优先保证 l1/l2 快速解码

**瓦片路径与命名**

- 单瓦片 Blob 路径模板：`{sceneId}/{face}/l{levelNum}/{row}/{name}`
- 文件名：`l{level}_{face}_{row}_{col}.jpg`（如 `l3_f_1_2.jpg`）
- `code.multires` 短语法：`{tileSize},{level1},{level2},...#%s/l%l/%v/l%l_%s_%v_%h.jpg`

### 模块协作

类实例持有用户配置（`tileSize`、`sceneId`、回调等），通过内部 `CutterContext` 传给各纯函数模块，避免全局状态，便于单测与后续扩展（如 Worker 瓦片编码）。

## 文件结构

```
krpano-cutter-tools/
├── src/
│   ├── index.ts          # 包入口：re-export 类型 + default PureFrontendTileCutter
│   ├── cutter.ts         # 主类：constructor + makeTiles 流程编排
│   ├── types.ts          # 公共 TypeScript 类型（Options、MakeTilesResult、TileData 等）
│   ├── context.ts        # 内部 CutterContext（各模块共享运行时配置）
│   ├── constants.ts      # CUBE_FACES 六面标识常量
│   ├── canvas.ts         # 解码、缩放、toBlob、WebGL 能力检测
│   ├── levels.ts         # 层级分析、multires 字符串、分层 JPEG 质量
│   ├── xml.ts            # krpano scene / tileImage / shortTileImage 生成
│   ├── preview.ts        # 立方体条带预览 + 列表缩略图
│   ├── tiles.ts          # 单面瓦片切分与 JPEG 编码
│   └── cube/
│       ├── convert.ts    # WebGL / CPU 调度、源图超大时预缩放
│       ├── webgl.ts      # GLSL 着色器 + GPU 六面渲染
│       └── cpu.ts        # CPU 降级转换 + getCubeDirection
├── dist/                 # tsc 编译产物（.js + .d.ts + source map）
├── package.json
├── tsconfig.json
└── readme.md
```

| 文件 | 职责 |
|------|------|
| `cutter.ts` | 对外唯一类；`makeTiles` 六阶段编排与进度回调 |
| `canvas.ts` | `decodeImage`、`resizeBitmap`、`canvasToBlob`、`supportsWebGL` |
| `cube/convert.ts` | 转换入口；WebGL 异常或不可用时 fallback CPU |
| `cube/webgl.ts` | 着色器编译、纹理上传、六面 `createImageBitmap` |
| `cube/cpu.ts` | 像素级 equirect 采样；`getCubeDirection` 射线方向 |
| `levels.ts` | `_analyzeLevels` 逻辑；`buildMultiresStr` |
| `tiles.ts` | 面内 grid 切分；`OffscreenCanvas` / `HTMLCanvasElement` 编码 |
| `preview.ts` | 3×2 CUBESTRIP 布局 preview；等距柱状 thumb |
| `xml.ts` | 生成 krpano 可直接使用的 XML 片段 |

## 安装

```bash
npm install krpano-cutter-tools
```

本地联调：

```json
"krpano-cutter-tools": "file:../path/to/krpano-cutter-tools"
```

## 使用

```typescript
import PureFrontendTileCutter from 'krpano-cutter-tools'

const cutter = new PureFrontendTileCutter({
    tileSize: 1024,
    sceneId: 'abc12345',
    onLog: msg => console.log('[切图]', msg),
    onProgress: (percent, processed, total) => {
        console.log(`${percent}% (${processed}/${total})`)
    },
})

const result = await cutter.makeTiles(file)

// 上传瓦片
for (const tile of result.content) {
    const path = `${sceneId}/${tile.face}/l${tile.levelNum}/${tile.row}/${tile.name}`
    // upload tile.blob ...
}

// krpano 配置
result.code.multires
result.code.scene
```

## 配置项

| 选项              | 类型                                  | 默认值 | 说明                                        |
| ----------------- | ------------------------------------- | ------ | ------------------------------------------- |
| `tileSize`        | `number`                              | `512`  | 瓦片边长（像素），常见 512 / 1024           |
| `maxCubeSize`     | `number`                              | `2048` | 立方体面最大边长，对齐 krpano `maxcubesize` |
| `jpegQuality`     | `number`                              | `0.82` | 最高层级瓦片 JPEG 质量（0–1）               |
| `previewFaceSize` | `number`                              | `256`  | 预览条带每面像素（3×2 布局）                |
| `previewQuality`  | `number`                              | `0.72` | 预览图 JPEG 质量                            |
| `thumbWidth`      | `number`                              | `480`  | 列表缩略图宽度                              |
| `thumbHeight`     | `number`                              | `240`  | 列表缩略图高度                              |
| `thumbQuality`    | `number`                              | `0.7`  | 缩略图 JPEG 质量                            |
| `onProgress`      | `(percent, processed, total) => void` | —      | 切图进度回调                                |
| `onLog`           | `(message) => void`                   | —      | 日志回调                                    |
| `sceneId`         | `string`                              | `''`   | 场景 ID，用于生成 OSS / XML 路径前缀        |

## 返回值 `MakeTilesResult`

| 字段                  | 类型         | 说明                                                          |
| --------------------- | ------------ | ------------------------------------------------------------- |
| `dirName`             | `string`     | 目录名（文件名去掉扩展名）                                    |
| `content`             | `TileData[]` | 瓦片数组，含 `blob`、`face`、`levelNum`、`row`、`col`、`name` |
| `duration`            | `string`     | 耗时，如 `"12.34s"`                                           |
| `code.scene`          | `string`     | 完整 scene XML                                                |
| `code.tileImage`      | `string`     | 带 `<level>` 的 multires `<image>`                            |
| `code.shortTileImage` | `string`     | 简化 `<cube multires="...">` 格式                             |
| `code.multires`       | `string`     | multires 短语法字符串                                         |
| `code.cubeImage`      | `string`     | 保留字段（当前为空）                                          |
| `preview`             | `Blob`       | 立方体条带预览图                                              |
| `thumb`               | `Blob`       | 等距柱状缩略图                                                |
| `levels`              | `number`     | 分辨率层级数                                                  |
| `tiles`               | `number`     | 瓦片总数                                                      |
| `width` / `height`    | `number`     | 原图宽高                                                      |

## 构建

```bash
npm run build
```

产物输出至 `dist/`，含 `.js` 与 `.d.ts`。
