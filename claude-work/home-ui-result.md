# FeClaw-Mobile: Zentrim 首页 UI — 实施结果

任务源: `claude-work/home-ui.md`
日期: 2026-07-16
`npx tsc --noEmit` 退出码: **0**（无类型错误）

## 完成清单

| 任务 | 状态 | 文件 |
|------|------|------|
| 安装导航依赖 | ✅ 全部已安装（新增 `@react-navigation/native-stack`） | `package.json` |
| `HomeScreen.tsx` | ✅ 重写 | `src/screens/HomeScreen.tsx` |
| `ChatTab.tsx` | ✅ 占位页 | `src/screens/ChatTab.tsx` |
| `AppNavigator.tsx` | ✅ 重写为 native-stack + bottom-tabs | `src/navigation/AppNavigator.tsx` |
| `App.tsx` | ✅ 用 AppNavigator + SafeAreaProvider 包装 | `App.tsx` |
| `npx tsc --noEmit` | ✅ 通过（退出 0） | — |

## 关键决策

### 1. Stack 库选型
任务列出 `@react-navigation/native` + `@react-navigation/bottom-tabs`，又要求 "Stack Navigator 注册: Main(tabs) → Canvas(全屏)"。`@react-navigation/native` v7 不提供 Stack 工厂；初版文件用的是 `@react-navigation/stack`（不在依赖中），会编译失败。

**解决**: 安装 `@react-navigation/native-stack@7.17.10`（peer-deps 已满足 react-native-screens / safe-area-context），`createNativeStackNavigator` 是 v7 官方推荐 stack。

### 2. 路由表类型
在 `AppNavigator.tsx` 导出：
```ts
export type TabParamList = { ChatTab: undefined; ZentrimTab: undefined };
export type RootStackParamList = { Main: undefined; Canvas: undefined };
```
`HomeScreen` 用 `NativeStackNavigationProp<RootStackParamList, "Main">` 让 `navigation.navigate("Canvas")` 强类型通过。

### 3. App.tsx 加 SafeAreaProvider
`HomeScreen` 用了 `react-native-safe-area-context` 的 `SafeAreaView`，必须在 Provider 包裹下才能读取 inset；外层一并设置 `StatusBar` 让浅米色背景 #F5F5F0 与首页一致。

## 实施细节

### HomeScreen（src/screens/HomeScreen.tsx）
- **问候**: `getGreeting()` 按 `Date.getHours()` 返回 6 段文案（夜 / 早 / 中 / 下午 / 晚 / 夜深），默认匹配任务示例 "☀️ 早上好，今天有物理课"。
- **💡 提示行**: 浅灰 `#888`、13px，整行 Pressable，点击打开"注意到" Modal。
- **三张卡片**: 数据驱动 `CARDS: CardData[]`，`flex: 1 + gap: 10` 三等分；点击切换 `sheetKind` 状态。
- **Sheet**: 半透明 `rgba(0,0,0,0.4)` 遮罩 + 圆角 20 顶部 sheet；高度 max 70%；按 sheetKind 切换标题。
- **底部 + 按钮**: 64×64 蓝圆（#1976d2），底部居中 12px；`onPress → navigation.navigate("Canvas")`。
- **Mock 数据**: `MOCK_NOTES` 含 3 条（化学试卷批改 ✓、英语课堂录音 ⏳、三角函数总结），点条目 → 关闭 sheet + 跳 Canvas。
- **Modal 行为**: 区分外层 Pressable（关闭）和内层 Pressable（`onPress={() => undefined}` 阻止冒泡）。

### AppNavigator（src/navigation/AppNavigator.tsx）
```
NavigationContainer
  └ Stack (native-stack)
      ├ Main → Tab.Navigator
      │   ├ ChatTab       ("💬 聊天")
      │   └ ZentrimTab → HomeScreen  ("📦 Zentrim")
      └ Canvas  (presentation: fullScreenModal)
```
不再用旧的 `function ZentrimTab({ navigation }) { <HomeScreen navigation={navigation}/> }` 包装层——`useNavigation` hook 已在 HomeScreen 内部直接拿，类型由 hook 泛型保证，代码更短。

### ChatTab（src/screens/ChatTab.tsx）
保留既有实现（居中 "💬 聊天" + #F5F5F0 背景），未改动。

### App.tsx
外层用 `SafeAreaProvider` 包裹，内层渲染 `<AppNavigator />`；`StatusBar` 设置 `barStyle="dark-content"` 与米色背景。

## 验证

```bash
$ npx tsc --noEmit ; echo EXIT=$?
EXIT=0
```

无任何类型错误。

## 注意事项

- `src/canvas/` 任何文件未触碰（任务硬约束）。
- `CanvasScreen` 未修改，直接作为 Stack 屏幕复用。
- 所有交互数据都是 mock 常量（`MOCK_NOTES`、`CARDS`），无网络请求、无后端依赖。
- `gap: 10` 等 RN 0.71+ 语法已被项目使用（package.json 显示 RN 0.86.0），无兼容性问题。

## 未做的事

- 未实装 `ZentrimCanvas` 中具体的"新建笔记"逻辑——`+` 按钮只触发 navigation，Canvas 内部仍由现有 props 控制（pageId="default_page"）。
- 未实装 Modal 三个按钮的业务逻辑——只关闭 Modal，与任务描述一致（任务只说"点条目跳转"，未要求 Modal 按钮有功能）。
