# FeClaw-Mobile Curio 前端审计报告 — 2026-07-13

## 概要

- **总文件数**：18
- **总行数**：3,305
- **发现**：**P0 8 个，P1 16 个，P2 6 个**

| 严重等级 | 数量 | 类型 |
|---------|------|------|
| P0 必须修复 | 8 | 资源泄漏/状态不一致/未实现功能/崩溃风险 |
| P1 建议修复 | 16 | 死代码/性能/类型安全/UX |
| P2 值得改进 | 6 | 命名/注释/一致性 |

---

## [canvas/CanvasEngine.ts — P0]

### [P0-1] SkImage snapshot 未释放，频繁分配导致 native 端累积
- **行号**：196, 225
- **代码**：
  ```ts
  this.persistentImage = surface.makeImageSnapshot();   // L196 rebuildSurface
  this.persistentImage = this.persistentSurface.makeImageSnapshot();  // L225 addStroke
  ```
- **风险**：每次 `rebuildSurface()` / `addStroke()` 都创建新的 `SkImage`，但旧的 `persistentImage` 仅被 JS 引用覆盖，未显式 `dispose()`。Skia 的 `SkImage` 背后是 native handle（GPU 纹理 / 位图内存），JS GC 不能及时释放，频繁笔划或视口拖动会累积显存。RN-Skia 的 `SkImage` 在 JS 层有 `delete()` 方法（部分版本）或依赖引用计数；本项目未调用。
- **修复建议**：在赋值新 snapshot 前，对旧 `this.persistentImage` 调用 `.delete()` / `.dispose()`；在 `dispose()` (L437-440) 中也补一次显式释放。

### [P0-2] `engine.images` 是死状态 — 数据源双轨，实际渲染走 props
- **行号**：CanvasEngine.ts:76, 264-275；CurioCanvas.tsx:72, 124-137, 310
- **代码**：
  - 引擎有 `private images: CanvasImage[]` 及 `addImage/removeImage`，并 emit `"images"` 事件，但 **`ImageRenderer.renderImage()` 从未被任何渲染路径调用**。
  - CurioCanvas.tsx L310 直接 `images?.map((img) => <CanvasImageNode .../>)` 渲染 props.images。
- **风险**：
  1. CanvasScreen 拍照后 `setImages([...prev, newImage])`（CanvasScreen.tsx L169），CurioCanvas 收到新 props 渲染新图片——但 **engine 完全不知道**，且 init 时传入的 images 也只是复制到 `this.images` 数组里搁置。
  2. `engine.addImage` / `engine.removeImage` 实际是死代码。
  3. 两个数据源（props vs engine）长期会发散。
- **修复建议**：选定唯一数据源。要么 CurioCanvas 走 engine（订阅 images 事件，删除 props.images），要么从引擎彻底移除 `images` 字段与 `addImage/removeImage` 方法。

### [P0-3] `init()` 是 `async` 但内部无 `await`，签名误导且无取消语义
- **行号**：123, 137
- **代码**：
  ```ts
  async init(page: PageData): Promise<void> {
    this.strokes = [...page.strokes];
    ...
    this.coldStart.decodeThumbnail(page.metadata.thumbnail);
    this.emit({ type: "coldstart", isColdStarting: true, rebuiltTs: -1 });
  }
  ```
- **风险**：`async` 关键字无意义（返回值永远是立即 resolve），但调用方可能误以为可以 `await` 后才安全使用——例如 CurioCanvas.tsx L131 `engine.init(...)`（无 await）。如果未来真正加异步（解码大文件），又缺少 race 防护：在 init 完成前若用户已点击，strokes/images 状态可能错位。
- **修复建议**：去掉 `async`（同步函数），或将真正异步的工作包成内部 Promise 并加 in-flight 标记防重入。

### [P0-4] `rebuildSurface()` 全量回放，视口/撤销/redo 都触发，大文档下卡顿
- **行号**：182-197, 234-252, 279-289
- **代码**：
  ```ts
  private rebuildSurface(): void {
    ...
    for (const s of sorted) {
      renderStrokeToSurface(canvas, s, this.viewport, opacity);  // 每笔 N 条曲线细分
    }
    this.persistentImage = surface.makeImageSnapshot();
  }
  ```
- **风险**：视口 pan/pinch、撤销、redo、草稿模式切换都调用 `rebuildSurface()`，回放全部 strokes + 每笔的 `subdivide()` O(N) 递归细分。1000 笔画时，每次拖动视口都做 1000 次回放 + makeImageSnapshot → 掉帧 / 主线程阻塞。
- **修复建议**：
  - 对撤销/redo 只回放被影响的小区域（脏矩形）；
  - 或保留 doc-space 中线层 + 一个"视口变换"的 group，每次只平移/缩放 layer；
  - 至少将 `subdivide` / `buildContourPath` 移到 worklet / 后台线程（JSI Skia thread）。

---

## [canvas/CurioCanvas.tsx — P0]

### [P0-5] `useEffect([pageId])` 闭包陷阱 — props 变化时引擎不重 init
- **行号**：109-145
- **代码**：
  ```ts
  useEffect(() => {
    const engine = new CanvasEngine();
    ...
    engine.init({ ..., strokes: initialStrokes, images: images ?? [], metadata });
    return () => { unsub(); engine.dispose(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);
  ```
- **风险**：
  1. `initialStrokes` / `images` / `metadata` 从闭包读取，但依赖只有 `pageId`。父组件修改 strokes/images（如拍照插入图片后 CanvasScreen 的 `setImages`，或外部拉取新 page 数据但 pageId 不变）时，引擎不重 init，导致 **engine 的 `this.strokes` / `this.images` 与实际显示不一致**。幸而实际渲染走 props 暂时不崩，但是双数据源（P0-2 的根因）。
  2. 关闭 ESLint 检查等于把潜在回归留到运行时。
- **修复建议**：把 `images` / `metadata` 加进依赖数组；或者从架构上消除双数据源（见 P0-2）。同时保留引擎作为渲染真相源，CurioCanvas 走订阅。

### [P0-6] `inProgressRef` 通过 `useEffect` 异步同步，存在 race
- **行号**：103-106, 237
- **代码**：
  ```ts
  const inProgressRef = useRef<InProgressStroke | null>(null);
  useEffect(() => { inProgressRef.current = inProgress; }, [inProgress]);
  ...
  .onEnd(() => {
    const current = inProgressRef.current;  // 可能读到旧值
    if (!eng || !current) return;
    if (current.stroke.curves.length > 0) {
      eng.addStroke(current.stroke);
      ...
    }
  })
  ```
- **风险**：`onUpdate` 触发 `setInProgress` 后，effect 在下一个 commit 才更新 ref。若用户极快地点击—抬起（onBegin → onEnd 之间没有 onUpdate），或手势结束与 React render 重叠，`onEnd` 可能读到 `null` / 旧 stroke，导致笔尖抬起时本应 `addStroke` 的笔画丢失。
- **修复建议**：把 inProgress 改成 `useRef<InProgressStroke | null>` 并在 `onUpdate` 里**同步** `ref.current = next`，再在 `onEnd` 中读 ref。state 仍保留用于触发 UI 重渲染。

### [P0-7] `setInProgress` 在每次 onUpdate 重建整条笔划的曲线 — O(N²)
- **行号**：218-234, 407-427
- **代码**：
  ```ts
  .onUpdate((e) => {
    ...
    setInProgress((prev) => {
      const nextPoints = [...prev.points, ...];
      return { stroke: { ...prev.stroke, curves: pointsToCurves(nextPoints) }, ... };
    });
  })
  ```
  + `pointsToCurves` 每次生成 N 条曲线（line 412-426）。
- **风险**：N 个采样点触发 N 次 update，每次生成包含 1..N 条曲线的 stroke 对象；useMemo `inProgressPath` (L291-297) 又对全部曲线跑 `buildContourPath`（细分 + 法线 + 轮廓）。一笔 N=200 点的笔画总工作量 ≈ O(N²) = 40,000 次操作 + 同样数量的 `SkPath` 节点。**掉帧/卡顿的根因**。
- **修复建议**：
  - 在 `onUpdate` 只把新点追加到 `points`，**不要重建 `curves` 字段**；`curves` 在 `onEnd` 时一次性生成。
  - `inProgressPath` 改用增量构建（只对新加入的点产生 SkPath 段）；或直接用 `useSharedValue` + worklet 在 UI 线程做。
  - 至少要 memoize `pointsToCurves(nextPoints)`（输入相同则复用）。

### [P0-8] 没有错误边界，画布崩溃 = 全页崩溃
- **行号**：screens/CanvasScreen.tsx（无 ErrorBoundary）
- **风险**：CurioCanvas 内部任一处抛错（Skia native 错误、malformed stroke 数据、NaN/Infinity 数学运算等）会冒泡到 React，导致整个 CanvasScreen unmount，用户已绘笔划状态丢失。React Native 默认无 error boundary。
- **修复建议**：用 RN 的 `ErrorBoundary` 类组件包住 `<CurioCanvas/>`，fallback UI 显示"画布渲染失败"，并把 page 数据保留在 store 里以便恢复。

---

## [screens/CanvasScreen.tsx — P0]

### [P0-9] 拍照权限拒绝 / 拍照失败仅 `console.warn`，用户无反馈
- **行号**：131-173
- **代码**：
  ```ts
  if (result.errorCode) {
    console.warn("[CanvasScreen] 拍照失败", result.errorCode, result.errorMessage);
    return;
  }
  ```
- **风险**：
  - 用户拒绝相机权限后 `result.errorCode = "permission"`，应用静默无反应；
  - 没有 Toast / Alert / 错误气泡；
  - 与 `PhotoCapture.tsx:42-43` 重复（DRY）。
- **修复建议**：复用 `<PhotoCapture/>` 组件，并通过 `onPhotoCapture` + 错误回调 / `Alert.alert(...)` 给用户反馈。

### [P0-10] PNG 导出 / 时间线更改 / 附件链接 — UI 已暴露但功能未实现
- **行号**：182-185, 187-189, 195-197；ThreeDotMenu.tsx L96-98
- **代码**：
  ```ts
  const handleExportPng = useCallback(() => {
    console.warn("[CanvasScreen] PNG 导出尚未接线到上层保存逻辑");
  }, []);
  const handleChangeTimeline = useCallback(() => {
    console.warn("[CanvasScreen] 更改所属时间线：待接入时间线选择");
  }, []);
  const handleAttachLink = useCallback(() => {
    console.warn("[CanvasScreen] PDF 作为链接附件：待接入附件存储");
  }, []);
  ```
- **风险**：右上角 ⋮ 菜单的"导出 PNG / 更改时间线 / 插入文件（链接）"是真实可点按钮，但只 log warn。**用户视觉上认为功能可用，实际完全无效**——典型的"假装实现了"。
- **修复建议**：要么实现，至少给个 `Alert.alert("功能即将上线")` 用户提示；要么把这些 menu 项禁用 / 隐藏直到后端就绪。

---

## [P0 修复优先级建议]

| 编号 | 修复成本 | 影响 | 建议 |
|-----|---------|------|------|
| P0-1 | 低 | 高 | 立即修 |
| P0-2 | 中 | 高 | 立即修（架构） |
| P0-3 | 低 | 中 | 立即修 |
| P0-4 | 高 | 中 | 排期 |
| P0-5 | 低 | 高 | 立即修 |
| P0-6 | 低 | 中 | 立即修 |
| P0-7 | 中 | 高 | 排期 |
| P0-8 | 低 | 中 | 立即修 |
| P0-9 | 低 | 中 | 立即修 |
| P0-10 | 中 | 高 | 排期（取决于产品优先级） |

---

## [P1 — 建议修复]

### [P1-1] ContourBuilder 死代码 `hasSelfIntersection`
- **文件**：ContourBuilder.ts L319-326
- **风险**：导出但无任何调用方（已 `Grep` 验证）。注释承诺"检查任意两段是否相交"，实际只按采样点数阈值返回。
- **修复**：删除或真正实现自相交检测。

### [P1-2] `buildCenterline` 内 `if (first) ... else ...` 两个分支做完全相同的事
- **文件**：ContourBuilder.ts L138-143
- **代码**：
  ```ts
  if (first) {
    out.push({ x: sx, y: sy, pressure: p });
    first = false;
  } else {
    out.push({ x: sx, y: sy, pressure: p });
  }
  ```
- **修复**：合并两分支，删除 `first` 标志。

### [P1-3] `samplePressureAt` 用最近邻查找，精度低
- **文件**：ContourBuilder.ts L149-167
- **风险**：当 `samples` 是单调递增 `t` 数组（按设计），应二分查找 + 线性插值；现在 O(n) 扫一遍，每次构建轮廓都跑。
- **修复**：二分 + 插值。

### [P1-4] StrokeRenderer `parseHexColor` 不支持 `#rrggbbaa`、对非法输入静默返回 0
- **文件**：StrokeRenderer.ts L22-33
- **风险**：传入 `"red"` / `"#abc"` 等非法值 → `parseInt` 返回 NaN → 颜色变成 0x00000000（透明）+ 警告被吞。`#rrggbbaa` 是 Sketch/Procreate 常见导出格式。
- **修复**：校验长度 7 或 9，非法抛错或返回 fallback + warn。

### [P1-5] StrokeRenderer `(stroke as Stroke).type` 不必要 cast
- **文件**：StrokeRenderer.ts L80
- **代码**：`console.warn("[StrokeRenderer] 未知笔划类型，跳过渲染", (stroke as Stroke).type);`
- **修复**：`stroke.type` 已经是 `string` 联合类型，直接读即可。

### [P1-6] ImageRenderer `loadImage` 无超时 — 慢服务器可能挂死
- **文件**：ImageRenderer.ts L59-78
- **风险**：`fetch(source)` 无 timeout 控制；离线 / 慢服务器下 promise 长期挂起。
- **修复**：`AbortController` + `setTimeout` 实现超时。

### [P1-7] PdfImportDialog `onClose` props 直接调用时不会重置内部状态
- **文件**：PdfImportDialog.tsx L36, L58-66
- **风险**：如果父组件直接传新 `visible=false`（不经过组件内部的 `close()`），下一次打开时 `selected` 与 `stage` 残留。`onClose` 没有 sync 副作用。
- **修复**：用 `useEffect` 监听 `visible` 变化做 reset。

### [P1-8] CurioCanvas gesture 用 `minDistance(0)` 过于敏感
- **文件**：CurioCanvas.tsx L192
- **风险**：1px 抖动就触发 `onBegin`，与 panGesture 用 `minPointers(2)` 区分不够干净，可能出现单指轻微抖动切换成 pan。
- **修复**：调成 `minDistance(2~4)`。

### [P1-9] CurioCanvas `e as { pressure?: number }` 类型断言不安全
- **文件**：CurioCanvas.tsx L212, L222
- **风险**：用 `as` 把任意对象断言为有 pressure 的 shape，绕过类型检查。RN gesture-handler 的 `PanGestureHandlerEventPayload` 在 iOS 有 `pressure`，Android 没有；若未来 SDK 升级字段名变化，类型不会报错。
- **修复**：从 `@types/react-native-gesture-handler` 引入 `PanGestureHandlerEventPayload` 并用 `(e as PanGestureHandlerEventPayload).pressure`。

### [P1-10] CanvasEngine `async init()` 与 CurioCanvas 中无 `await` 调用并存
- 同 P0-3 的另一面：如果未来在 init 加真正的异步工作（例如解码 thumbnail async），当前调用方无 await，会出现"strokes 已显示但 thumbnail 还没解码"的中间态。
- **修复**：去掉 `async` 或显式 `await` + 状态机。

### [P1-11] CanvasEngine `setViewport` 每次都 `rebuildSurface()`，在 pan 中丢帧
- **文件**：CanvasEngine.ts L279-289
- **风险**：双指 pan 每帧 setViewport → 每次 rebuild → 1000 笔 1 秒 ~60 次 rebuild = 60k 次笔划回放。
- **修复**：见 P0-4；至少 throttle（rAF 节流）。

### [P1-12] CanvasScreen `handleSelectColor` 不会从 engine 反向同步
- **文件**：CanvasScreen.tsx L124-128
- **风险**：组件内 `inkColor` state 与 `engine.getInkColor()` 分离。如果别的代码（快捷键、外部面板）改了 engine 颜色，UI 不刷新。
- **修复**：在订阅里加 `setInkColor(eng.getInkColor())`。

### [P1-13] CurioCanvas useEffect 缺 screenSize 变化时的重建
- **文件**：CurioCanvas.tsx L148-159
- **风险**：依赖 `[pageId, screenSize.width, screenSize.height]`，正确。但 `ensureSurface` 内部判断 "尺寸相同则 return"——OK，但若仅 scale 变化（不改变 viewport 物理尺寸）且重建未触发，surface 仍是旧尺寸。实际这是边界 case，可接受。
- **修复**：观察是否真有问题，无则跳过。

### [P1-14] SvgExporter 把所有 ink + eraser 拼成单个 `<path d="...">`，长文档输出大
- **文件**：SvgExporter.ts L136-144
- **风险**：N 笔画 → 字符串拼接 + 浏览器解析单个 path → 大文档 SVG 几百 KB，渲染卡。
- **修复**：按 stroke 分多个 `<path>`（SVG 仍是 valid）。

### [P1-15] SvgExporter `computeBBox` 按每条曲线 4 控制点扫，O(N)，无问题但可缓存
- **文件**：SvgExporter.ts L64-96
- **修复**：notes，可选。

### [P1-16] CurioCanvas 颜色面板 Modal 与 Dialog 不是同源逻辑
- **文件**：CanvasScreen.tsx L288-299
- **风险**：颜色面板 Modal 直接在 CanvasScreen 内联，状态机简单；与 `PdfImportDialog` 风格不一致。维护性下降。

---

## [P2 — 值得改进]

### [P2-1] 命名一致性
- 组件 props：`onStrokeAdd`（CurioCanvas）/ `handleSelectTool`（CanvasScreen）——前缀风格混用。
- `ink`/`INK`：CanvasToolbar 注释 "笔按钮"；types.ts 字段名 `ink`。建议统一术语。

### [P2-2] 常量命名 / 位置不一致
- `MIN_WIDTH_RATIO`（module-level const, ContourBuilder L18）vs `TAPER_RATIO`（局部 const, ContourBuilder L249）。
- 0.15 系数 (taperZone) 是 magic number (L258)。

### [P2-3] ContourBuilder `hasSelfIntersection` 注释与实现不符
- 注释说"检查任意两段是否相交"，实际只看 sample count > 80。

### [P2-4] CurioCanvas 大量 `void version;` 风格代码
- L289：`void version;` 注释说"引用 version 以触发重读"，但 useState 的 `version` 是 state，每次 setVersion 已经触发 re-render，不需要手动 void。语义不清。

### [P2-5] 错误处理仅 `console.warn`
- 全栈大量 catch { console.warn }，无 telemetry、无 user-facing 反馈。生产环境难以追踪。

### [P2-6] 测试友好度
- 所有 canvas 引擎代码有清晰边界（pure TS class），但缺少 unit test（即便仓库无 node_modules 装不上，源码层面也看不到测试文件）。
- 关键算法 `buildContourPath` / `subdivide` / `computeNormals` 应有 property-based 测试（不同压力/不同曲率下输出 path 节点数 / 面积合理）。

---

## [分类清单 — 各文件问题计数]

| 文件 | P0 | P1 | P2 |
|-----|----|----|-----|
| canvas/CanvasEngine.ts | 4 | 2 | 0 |
| canvas/ColdStart.ts | 0 | 0 | 0 |
| canvas/ContourBuilder.ts | 0 | 3 | 1 |
| canvas/CurioCanvas.tsx | 4 | 3 | 2 |
| canvas/EraserRenderer.ts | 0 | 0 | 0 |
| canvas/ImageRenderer.ts | 0 | 1 | 0 |
| canvas/StrokeRenderer.ts | 0 | 2 | 0 |
| canvas/SvgExporter.ts | 0 | 2 | 0 |
| canvas/UndoManager.ts | 0 | 0 | 0 |
| canvas/ViewportManager.ts | 0 | 0 | 0 |
| canvas/types.ts | 0 | 0 | 0 |
| components/CanvasToolbar.tsx | 0 | 0 | 0 |
| components/DraftToggle.tsx | 0 | 0 | 0 |
| components/PdfImportDialog.tsx | 0 | 1 | 0 |
| components/PhotoCapture.tsx | 0 | 0 | 0 |
| components/RecordingBubble.tsx | 0 | 0 | 0 |
| components/ThreeDotMenu.tsx | 0 | 0 | 0 |
| screens/CanvasScreen.tsx | 2 | 3 | 0 |

---

## 总结

**最严重的两个问题**：

1. **P0-2 + P0-5（双数据源 + useEffect 闭包陷阱）**：engine 维护 images 数组但实际渲染走 props；同时 `useEffect([pageId])` 闭包陷阱导致 props 变化时 engine 不知道。两个问题纠缠在一起，是当前最容易隐藏 bug 的源头。建议统一数据源——让 engine 成为唯一真相源，CurioCanvas 通过订阅渲染。

2. **P0-7 + P0-1（性能 + Skia 资源泄漏）**：onUpdate 每次 O(N) 重建曲线 + rebuildSurface 频繁触发 + SkImage snapshot 不释放。这三者是 **画布掉帧** 和 **长时间使用后显存膨胀** 的根因；用户用 30 分钟后画布卡顿 / OOM 都是从这里开始的。

**最影响产品的两个问题**：

3. **P0-10（未实现功能暴露 UI）**：⋮ 菜单的 PNG 导出、时间线、附件链接都是真实按钮但仅 console.warn，对用户是"假功能"。
4. **P0-8（无 ErrorBoundary）**：画布组件任一处抛错 → 全页崩溃 → 用户的笔划 state 丢失。这是 P0 级体验问题。

**值得肯定的**：
- `CurioCanvas` 是唯一 React 组件的纪律保持得不错；
- 引擎订阅者模型（`EngineEvent` + `subscribe()`）设计干净；
- `UndoManager` 实现简洁；
- `SvgExporter` 的 evenodd 单 path 设计有想法。

---

*报告生成日期：2026-07-13*
*审计范围：18 个文件，3,305 行*