# krpano-cutter-tools

纯浏览器端 krpano 切图工具，支持：

- **cube**：等距柱状全景 → 立方体 multires 瓦片
- **flat**：平面图（高清矩阵）→ flat multires 瓦片（路径与 Krpano 官方一致）

对外为两个异步函数，无需 `new`：

```ts
import { makeCubeTiles, makeFlatTiles } from 'krpano-cutter-tools';

const cube = await makeCubeTiles(file, { sceneId: 'abc', onProgress });
const flat = await makeFlatTiles(file, { sceneId: 'abc', onProgress });
```

## 背景与瓶颈

等距柱状全景在 1:2 比例下像素量可达 ~1 亿级。旧方案多为整图上传后再由服务端切图，主线程阻塞与内存峰值高。本库在浏览器端直接产出瓦片 Blob，上传粒度为单瓦片。

## 主要功能

1. **cube**：解码 → WebGL/CPU equirect→cube → 六面金字塔瓦片 → XML / multires
2. **flat**：解码 → 原图金字塔 → 2D 瓦片 → flat XML / multires（对齐 Krpano 官方）
3. 预览图 / 缩略图 Blob
4. 进度与日志回调

## cube 流水线

```
File → decodeImage → convertToCubeFaces → analyzeLevels
     → preview/thumb → 六面并行切瓦片 → generateXmlCode → MakeTilesResult
```

- 面边长：`faceSize = min(floor(srcWidth / 4), maxCubeSize)`（默认 max 2048）
- 瓦片路径：`{sceneId}/{face}/l{level}/{row}/l{level}_{face}_{row}_{col}.jpg`
- multires：`{tileSize},{sizes}#%s/l%l/%v/l%l_%s_%v_%h.jpg`

## flat 流水线

```
File → decodeImage → analyzeFlatLevels → preview/thumb
     → 金字塔切瓦片 → generateFlatXmlCode → MakeTilesResult
```

对齐 Krpano 官方 flat 模板：

- 瓦片路径：`l{level}/{row}/l{level}_{row}_{col}.jpg`
- URL 模板：`l%l/%v/l%l_%v_%h.jpg`（常量 `FLAT_TILE_URL_TEMPLATE`）
- `<flat url="{path}l%l/%v/l%l_%v_%h.jpg" multires="..." />`
- `tilesize=512`，层级约每边减半（levelstep=2）

## 文件结构

```
src/
├── index.ts              # named export：makeCubeTiles / makeFlatTiles
├── types.ts
├── context.ts            # createCubeContext / createFlatContext
├── levels.ts             # cube + flat 层级、FLAT_TILE_URL_TEMPLATE
├── tiles.ts
├── xml.ts
├── preview.ts
├── canvas.ts
├── cube/
│   ├── pipeline.ts       # makeCubeTiles
│   ├── convert.ts
│   ├── webgl.ts
│   └── cpu.ts
└── flat/
    └── pipeline.ts       # makeFlatTiles
```

## 使用

### 全景（cube）

```ts
import { makeCubeTiles } from 'krpano-cutter-tools';

const result = await makeCubeTiles(file, {
    tileSize: 512,
    maxCubeSize: 2048,
    sceneId: 'abc12345',
    onLog: msg => console.log('[切图]', msg),
    onProgress: (percent, processed, total) => {
        console.log(`${percent}% (${processed}/${total})`);
    },
});

for (const tile of result.content) {
    const path = `${sceneId}/${tile.face}/l${tile.levelNum}/${tile.row}/${tile.name}`;
    // upload tile.blob
}

result.code.multires;
result.code.scene;
```

### 高清矩阵（flat）

```ts
import { makeFlatTiles, FLAT_TILE_URL_TEMPLATE } from 'krpano-cutter-tools';

const result = await makeFlatTiles(file, {
    tileSize: 512,
    sceneId: 'abc12345',
});

for (const tile of result.content) {
    const path = `${sceneId}/l${tile.levelNum}/${tile.row}/${tile.name}`;
    // upload tile.blob
}

// 展示端可用；若业务要存 multires#url，可直接用 result.code.multires
result.code.shortTileImage;
result.code.multires;
FLAT_TILE_URL_TEMPLATE; // 'l%l/%v/l%l_%v_%h.jpg'
```

## 配置项

### 共用（BaseTilesOptions）

| 选项                         | 类型     | 默认（cube / flat）            | 说明             |
| ---------------------------- | -------- | ------------------------------ | ---------------- |
| `tileSize`                   | `number` | `512`                          | 瓦片边长         |
| `jpegQuality`                | `number` | `0.82`                         | 最高层 JPEG 质量 |
| `previewQuality`             | `number` | `0.72`                         | 预览图质量       |
| `thumbWidth` / `thumbHeight` | `number` | cube `480×240`；flat `240×135` | 缩略图框         |
| `thumbQuality`               | `number` | `0.7`                          | 缩略图质量       |
| `onProgress`                 | 函数     | —                              | 进度回调         |
| `onLog`                      | 函数     | —                              | 日志回调         |
| `sceneId`                    | `string` | `''`                           | 路径前缀         |

### 仅 cube

| 选项              | 默认   | 说明             |
| ----------------- | ------ | ---------------- |
| `maxCubeSize`     | `2048` | 立方体面最大边长 |
| `previewFaceSize` | `256`  | 预览条带每面像素 |

## 返回值 `MakeTilesResult`

| 字段                                                       | 说明                                       |
| ---------------------------------------------------------- | ------------------------------------------ |
| `content`                                                  | 瓦片数组（cube 含 `face`；flat 无 `face`） |
| `code.multires` / `scene` / `tileImage` / `shortTileImage` | XML 与短语法                               |
| `preview` / `thumb`                                        | Blob                                       |
| `levels` / `tiles` / `width` / `height` / `duration`       | 元信息                                     |
