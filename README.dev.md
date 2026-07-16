# FeClaw Mobile

> FeClaw 跨平台移动端（Android / iOS / HarmonyOS）
> 版本：v1.0.0（与 FeClaw 引擎共享版本号）
> 对应设计文档：https://github.com/lizidaren/FeClaw/tree/main/docs/v1

---

## 技术栈

| 层 | 技术 |
|:---|:-----|
| 框架 | **React Native**（Fabric + JSI） |
| 画布引擎 | **@shopify/react-native-skia** |
| 状态管理 | **Zustand** |
| 导航 | **React Navigation** |
| 离线存储 | **react-native-sqlite-storage** + 文件系统 |
| 通信 | REST（fetch）+ WebSocket |
| 包管理 | **pnpm**（monorepo 兼容） |

## 目录结构

```
FeClaw-Mobile/
│
├── src/
│   ├── App.tsx                    ← 应用入口 + 导航配置
│   │
│   ├── screens/                   ← 页面级组件
│   │   ├── ChatScreen.tsx         ← 聊天 Tab
│   │   ├── ChatDetailScreen.tsx   ← Agent 对话页
│   │   ├── CurioHomeScreen.tsx    ← Curio 主页（问候/注意到/三卡片/输入框）
│   │   ├── CurioTimelineScreen.tsx← 时间线全览
│   │   ├── CurioDetailScreen.tsx  ← 条目详情页
│   │   ├── CanvasScreen.tsx       ← 画布全屏页
│   │   ├── UniverseScreen.tsx     ← Universe 发现页（V2）
│   │   └── SettingsScreen.tsx     ← 设置页（V2）
│   │
│   ├── components/                ← 可复用 UI 组件
│   │   ├── GreetingBanner.tsx     ← Curio 问候语
│   │   ├── CurioNoticeCard.tsx    ← 注意到弹窗
│   │   ├── TodoCard.tsx           ← TODO 卡片
│   │   ├── CompletionCard.tsx     ← 完成度卡片
│   │   ├── TimelineItem.tsx       ← 时间线条目
│   │   ├── SearchOverlay.tsx      ← 搜索覆盖层
│   │   ├── RecordingBubble.tsx    ← 录音气泡
│   │   ├── AudioPlayer.tsx        ← 录音播放器
│   │   ├── CanvasToolbar.tsx      ← 画布左侧工具栏
│   │   ├── DraftToggle.tsx        ← 草稿纸按钮
│   │   ├── ThreeDotMenu.tsx       ← ⋮ 菜单
│   │   ├── PhotoCapture.tsx       ← 拍照按钮
│   │   ├── PdfImportDialog.tsx    ← PDF 导入对话框
│   │   └── MarkdownRenderer.tsx   ← Markdown 渲染
│   │
│   ├── canvas/                    ← 画布引擎（RN Skia）
│   │   ├── CurioCanvas.tsx        ← 画布主组件
│   │   ├── CanvasEngine.ts        ← 渲染引擎（三层画布管理）
│   │   ├── ColdStart.ts           ← 冷启动双缓冲逻辑
│   │   ├── StrokeRenderer.ts      ← 单笔渲染（轮廓填充）
│   │   ├── EraserRenderer.ts      ← 橡皮擦渲染
│   │   ├── ImageRenderer.ts       ← 图片渲染
│   │   ├── ContourBuilder.ts      ← de Casteljau 细分 + 法线偏移
│   │   ├── SvgExporter.ts         ← evenodd SVG 导出
│   │   ├── UndoManager.ts         ← 命令模式撤销
│   │   ├── ViewportManager.ts     ← 坐标系转换
│   │   └── types.ts               ← 画布类型定义
│   │
│   ├── api/                       ← FeClaw API 调用层
│   │   ├── client.ts              ← HTTP 客户端（fetch + JWT）
│   │   ├── chat.ts                ← 聊天 API
│   │   ├── curio.ts               ← Curio CRUD API
│   │   ├── pages.ts               ← 画布同步 API
│   │   └── search.ts              ← 搜索 API
│   │
│   └── store/                     ← 状态管理（Zustand）
│       ├── chatStore.ts           ← 聊天状态
│       ├── curioStore.ts          ← Curio 条目/时间线
│       ├── canvasStore.ts         ← 画布当前状态
│       └── settingsStore.ts       ← 用户设置
│
├── android/                        ← Android 原生壳
├── ios/                            ← iOS 原生壳
├── harmony/                        ← HarmonyOS 适配（V2+）
│
├── package.json
├── tsconfig.json
├── babel.config.js
├── metro.config.js
└── README.md
```

## 编码规范

### 命名

| 类型 | 命名 | 例子 |
|:-----|:-----|:-----|
| 组件文件 | PascalCase | `CurioHomeScreen.tsx` |
| 普通文件 | PascalCase | `StrokeRenderer.ts` |
| 函数/变量 | camelCase | `renderStrokeToCanvas()` |
| 类型/接口 | PascalCase | `interface Stroke {}` |
| 常量 | UPPER_SNAKE | `MAX_ZOOM = 4.0` |

### 代码风格

- TypeScript strict mode
- 使用 `import type` 导入类型
- 组件使用函数组件 + hooks，不用 class component
- 样式使用 StyleSheet.create()，不写内联 style
- 状态管理走 Zustand，不走 Redux 或 Context
- React Navigation 管理路由，不走其他导航方案

### 画布模块规范

- `canvas/` 下的文件是纯 TS，不依赖 React
- 画布对外暴露的唯一 React 组件是 `CurioCanvas.tsx`
- 其他 canvas 文件是纯逻辑（渲染、转换、导出），可独立测试
- 不在 canvas/ 中处理 UI 事件——UI 事件在 components/ 中处理后传给 CanvasEngine

### API 调用规范

- 所有请求走 `api/client.ts`（统一 JWT 注入、错误处理、重试）
- API 路径不要硬编码在业务代码中，写在对应 `api/xxx.ts` 文件里
- 响应类型定义在 API 文件中，不在 screens/ 里定义

## 与 FeClaw 引擎的关系

FeClaw-Mobile 是 FeClaw 引擎的一个客户端。它：

- 通过 REST API 调用引擎的全部能力
- 通过 WebSocket 接收流式响应（聊天 SSE、画布同步）
- 在本地维护 Curio 数据的离线副本（SQLite）
- 不包含任何 AI 计算能力——所有 LLM/VLM 调用走远端引擎

## 初始设置

```bash
# 安装依赖
pnpm install

# iOS
cd ios && pod install && cd ..

# Android
npx react-native run-android

# iOS
npx react-native run-ios
```

## 设计文档

详见 `FeClaw/docs/v1/`：
- `01-prd.md` — 产品需求
- `02-curio.md` — Curio 设计（主页/时间线/画布/Pipeline）
- `02-curio-canvas-impl.md` — 画布渲染引擎实现方案
- `06-tdd.md` — 技术设计总纲
