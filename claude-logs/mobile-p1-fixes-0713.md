All P1 fixes applied. Here's the summary:

---

## P1 修复摘要

### P1-1: 死代码/未使用的导出
标记了以下已导出但未被任何文件导入的函数（保留供未来使用）：
- `ContourBuilder.ts` → `hasSelfIntersection`
- `SvgExporter.ts` → `exportInkOnlySVG`
- `ImageRenderer.ts` → `renderImage`, `loadImage`, `sortImagesByZIndex`
- `ViewportManager.ts` → `ViewportState`, `fitViewportToBBox`, `panViewport`, `zoomAt`

> 注：所有 `.ts`/`.tsx` 文件的 import 检查均通过，无未使用的导入。

### P1-2: 硬编码字符串
创建 `src/constants/strings.ts`，提取了 **40+** 个 UI 字符串为命名常量。涉及文件：
- `CanvasToolbar.tsx` → `TOOLBAR_PEN`, `TOOLBAR_ERASER` 等
- `DraftToggle.tsx` → `DRAFT_ACTIVE`, `DRAFT_INACTIVE` 等
- `RecordingBubble.tsx` → `RECORDING_ASR`, `RECORDING_AUDIO` 等
- `ThreeDotMenu.tsx` → `MENU_CREATED_AT`, `MENU_DEVICE` 等（14 个）
- `PhotoCapture.tsx` → `PHOTO_A11Y`
- `PdfImportDialog.tsx` → `PDF_TITLE_PREFIX`, `PDF_ATTACH_LINK` 等（11 个）
- `CanvasScreen.tsx` → `COLOR_PANEL_TITLE`

### P1-3: 边界情况
- **`ContourBuilder.ts:177`** — `computeNormals()` 在 `n === 1` 时访问 `points[1]` 导致崩溃。添加了单点提前返回 `[{ nx: 0, ny: -1 }]`
- **`StrokeRenderer.ts:23`** — `parseHexColor()` 输入长度不足时 `parseInt` 返回 NaN。添加了长度校验和 `|| 0` 兜底
- **`PhotoCapture.tsx:56`** — 已有 `asset?.uri` 防御检查（确认无遗漏）

### P1-4: 性能（React.memo）
为以下组件添加了 `React.memo`：
- `CanvasToolbar` + `ToolbarButton`
- `DraftToggle`
- `RecordingBubble` + `PillButton`
- `ThreeDotMenu` + `InfoRow` + `MenuItem`
- `PhotoCapture`

### P1-5: 类型安全
- `StrokeRenderer.ts` — `parseHexColor` 增加了输入校验，确保返回值始终为有效 `number`

### P1-6: 错误边界
- 创建 `src/components/ErrorBoundary.tsx` — class component，捕获渲染异常，显示错误信息 + 重试按钮
- `CanvasScreen.tsx` — 整个页面内容包裹在 `<ErrorBoundary>` 中

### 新增文件
| 文件 | 用途 |
|------|------|
| `src/constants/strings.ts` | UI 字符串常量集中管理 |
| `src/components/ErrorBoundary.tsx` | React 错误边界组件 |
