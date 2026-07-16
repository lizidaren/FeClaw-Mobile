# 修复 FeClaw-Mobile TypeScript 编译错误

## 项目信息
- 项目目录: `/home/lch/Projects/FeClaw-Mobile`
- React Native 0.86.0 + React 19.2.3
- @shopify/react-native-skia 2.8.0
- react-native-gesture-handler 2.24.0
- react-native-reanimated 3.19.1
- TypeScript 5.8.3

## 当前编译错误
运行 `npx tsc --noEmit` 可复现。主要问题：

### 1. App.tsx
- `CanvasScreen` 需要 props（`pageId`, `metadata`, `info`），但 App 渲染时没传
- 修复：给默认空值，或改成可选参数

### 2. CanvasEngine.ts (L87, L248)
- 重复的 `undo` 标识符
- 检查是否两个 `undo` 方法/变量重名了

### 3. ColdStart.ts (L46)
- `Skia.Image.MakeFromEncoded()` → 已改名 `MakeImageFromEncoded()`
- 还有 ImageRenderer.ts (L67, L73) 同样的改名

### 4. ImageRenderer.ts (L36)
- 某个函数调用参数数量不对（期望3个但传了1个）
- 检查是哪个 Skia API 变了

### 5. StrokeRenderer.ts (L51)
- `number` 不能赋值给 `SkColor`
- Skia 2.x 的 color 类型变了，需要检查

### 6. ZentrimCanvas.tsx (L259)
- Pinch gesture 的 `event.scaleChange` 不存在
- Skia 2.x 的 Gesture API 可能变了，查文档或用替代方法

### 7. 缺少 `react-native-image-picker`
- `PhotoCapture.tsx` 和 `CanvasScreen.tsx` 引用了 `react-native-image-picker`
- 安装：`npm install react-native-image-picker`
- 或如果这个功能暂时不需要，可以先注释掉相关代码

### 8. CanvasScreen.tsx (L117)
- `engine.undo` 是私有属性，从外部访问不了
- 要么暴露公共方法，要么改调用方式

## 要求
1. 所有修复直接改源码文件
2. 修改后运行 `npx tsc --noEmit` 确认无错误
3. 结果追加写入 `/home/lch/Projects/FeClaw-Mobile/claude-work/ts-fix-result.md`
4. **不要改动 canvas 数据模型（types.ts 中的 Stroke/BezierCurve 等类型）**— 这些是架构设计好的
5. `react-native-image-picker` 可以安装，也可以注释掉暂时不需要的代码，自己判断
