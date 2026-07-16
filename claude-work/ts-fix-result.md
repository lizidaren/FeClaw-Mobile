# FeClaw-Mobile TypeScript 编译错误修复结果

## 结论

`npx tsc --noEmit` 通过，退出码 0，无任何错误。

## 修复明细

| # | 文件 | 错误 | 修复方案 |
|---|------|------|----------|
| 1 | `src/screens/CanvasScreen.tsx` | `App.tsx` 渲染 `CanvasScreen` 时缺失 `pageId` / `metadata` / `info` 必填 props | 把 `CanvasScreenProps` 中 `pageId` / `metadata` / `info` 改为可选，并提供默认值（`pageId = "default_page"`、`metadata = DEFAULT_METADATA`、`info = DEFAULT_INFO`）。`DEFAULT_METADATA` / `DEFAULT_INFO` 符合 `PageMetadata` / `CanvasInfo` 接口要求 |
| 2 | `src/canvas/CanvasEngine.ts` | `private undo = new UndoManager()` 与方法 `undo(): Stroke \| null` 同名 → TS2300 重复标识符 | 把字段重命名为 `undoManager`（保留原方法名 `undo()`，对外契约不变），所有引用同步更新（`addStroke` / `clearStrokes` / `canUndo` / `canRedo` / `dispose` / `undo()` / `redo()` / 构造函数订阅） |
| 3 | `src/canvas/ColdStart.ts` | `Skia.Image.MakeFromEncoded` 在 Skia 2.x 重命名为 `MakeImageFromEncoded` | `MakeFromEncoded(data)` → `MakeImageFromEncoded(data)` |
| 4 | `src/canvas/ImageRenderer.ts` (1) | 同上，`MakeFromEncoded` 改名 | 替换 2 处 `MakeFromEncoded` → `MakeImageFromEncoded` |
| 5 | `src/canvas/ImageRenderer.ts` (2) | `ctx.rotate(angle)` 在 Skia 2.x 变为 `rotate(angle, rx, ry)`，3 个参数 | 改为 `ctx.rotate(element.rotation, 0, 0)`（前面已经 `translate(cx, cy)` 到中心点，所以旋转中心就是原点） |
| 6 | `src/canvas/StrokeRenderer.ts` | `SkColor` 在 Skia 2.x 改为 `Float32Array`，`paint.setColor(number)` 类型不匹配 | 用 `Skia.Color(number)` 包装。`Skia.Color` 接受 `number` 并返回 `Float32Array`（按位展开 r/g/b/a 为 0..1） |
| 7 | `src/canvas/ZentrimCanvas.tsx` | `Pinch` 的 `onUpdate` 事件类型只有 `PinchGestureHandlerEventPayload`（含 `scale`），不含 `scaleChange` | 改为 `onChange` 回调（事件类型为 `PinchGestureHandlerEventPayload & PinchGestureChangeEventPayload`，包含 `scaleChange`） |
| 8 | `src/components/PhotoCapture.tsx` + `src/screens/CanvasScreen.tsx` | 缺包 `react-native-image-picker` | 安装 `react-native-image-picker`（带自带的 `lib/typescript/index.d.ts` 类型声明），`launchCamera` 直接可用，无需注释源码 |
| 9 | `src/screens/CanvasScreen.tsx` | `engineRef.current?.undo()` 报 "private" / "not callable" | 这是 #2 重复标识符造成的连带错误——私有 `undo` 字段把同名方法遮蔽。修好 #2 后此问题自动消失 |

## 未改动

- `src/canvas/types.ts` 中的 `Stroke` / `BezierCurve` 等数据模型（架构设计，已按要求保留）
- `App.tsx`（无修改，由 #1 把 `CanvasScreen` 入口放宽解决）

## 新增依赖

- `react-native-image-picker`：在 `package.json` 的 `dependencies` 中新增（npm install 已自动写入）

## 验证

```bash
$ npx tsc --noEmit
$ echo $?
0
```