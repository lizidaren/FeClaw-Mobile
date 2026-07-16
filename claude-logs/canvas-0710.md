All 13 files created under `/home/lch/Projects/FeClaw-Mobile/`:

**`src/canvas/`** (纯 TS，无 React/Hooks):
- `types.ts` — Stroke/BezierCurve/CanvasImage/PageMetadata/PageData/Viewport/Command 类型
- `ViewportManager.ts` — docToScreen / screenToDoc / clampScale(0.25–4.0) / panViewport / zoomAt
- `ContourBuilder.ts` — de Casteljau 细分 + parallel transport frame + 压力驱动宽度 + tapered cap + evenodd
- `StrokeRenderer.ts` — ink 渲染（Fill 模式 + AA）
- `EraserRenderer.ts` — DstOut blend mode + Round cap
- `ImageRenderer.ts` — 图片加载 + 旋转 + zIndex 排序
- `ColdStart.ts` — 缩略图解码 + 后台分批回放（每批 50 笔）+ 让出主线程
- `SvgExporter.ts` — evenodd 单 path 导出（ink 外路径 + eraser 子路径）
- `UndoManager.ts` — LIFO 命令栈 100 步 + redo 支持
- `CanvasEngine.ts` — 三层画布编排 + 订阅/通知 + 草稿模式
- `CurioCanvas.tsx` — 唯一 React 入口，Skia Canvas 渲染 + 手势处理（笔/触摸走 drawingGesture，双指 pan+pinch）

**`src/components/`** (React UI):
- `CanvasToolbar.tsx` — 左侧竖排 4 按钮（笔/橡皮/拍照/撤销）
- `DraftToggle.tsx` — 左下角草稿纸切换

注意：未运行 `npm install`（`package.json` 不存在，按约束不创建）；未创建 `src/canvas/index.ts`（按约束不批量导出）。冷启动缩略图通过 Skia Image 显示，`destination-out` 橡皮擦在 React 端用 `<Path style="stroke">` 占位渲染（生产实现需 Skia Surface）。
