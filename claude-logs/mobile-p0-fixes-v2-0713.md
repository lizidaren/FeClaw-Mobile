全部 8 处修复都已落到代码里。

## 修改摘要

| # | 文件 | 修复 |
|---|------|------|
| **P0-1** | `src/canvas/CanvasEngine.ts` | `rebuildSurface()` / `addStroke()` / `dispose()` 在替换 persistentImage 前先 `.dispose()` 旧 snapshot，杜绝 SkImage 句柄泄漏 |
| **P0-2** | `src/canvas/ViewportManager.ts` | 新增 `fitViewportToBBox()` + `ViewportState` 类，持有 `cachedViewport` 并通过 `syncTo` 回调在 `zoomToFit()` 后推回 `CanvasEngine.setViewport` |
| **P0-3** | `src/canvas/UndoManager.ts` + `CanvasEngine.ts` | `UndoManager` 增加 `subscribe`/`notify`，`popUndo`/`popRedo` 后 fire；`CanvasEngine` 构造时挂订阅 → `render()`（新增公共方法）；`dispose()` 先取消订阅再清栈 |
| **P0-4** | `src/canvas/ColdStart.ts` | 新增 `decodeThumbnailWithTimeout(base64, timeoutMs=800)`，用 `Promise.race(work, timeout)` 防止巨型 base64 阻塞冷启动首帧 |
| **P0-5** | `src/canvas/CanvasEngine.ts` | 新增空 `routeEvent(_event)` 占位方法，注释说明当前由 CurioCanvas 手势直接调用引擎 |
| **P0-6** | `src/canvas/EraserRenderer.ts` | 渲染前检查 `!stroke.curves \|\| stroke.curves.length === 0` 时早退 |
| **P0-7** | `src/components/PdfImportDialog.tsx` | `attach()` / `confirmExpand()` 各加一段 TODO 注释，说明真实 PDF 附件 / 展开 API 流程（COS / VFS / addImage） |
| **P0-8** | `src/components/ThreeDotMenu.tsx` | 新增 `useEffect` 订阅 `Keyboard.keyboardDidShow`，菜单打开时挂监听，关闭 / 卸载时 `showSub.remove()` 注销 |
