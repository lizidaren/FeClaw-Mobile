# FeClaw-Mobile: 连接后端 API — 执行结果

## 任务状态总结

执行前对项目做了全面审计：**任务文件 1-8 均已存在并实现**，无需新建。`npx tsc --noEmit` 零错误通过。

| # | 任务 | 状态 | 文件 |
|---|------|------|------|
| 1 | 创建 `src/services/api-client.ts` | ✅ 已存在 | `src/services/api-client.ts:36-209` |
| 2 | 创建 `src/services/auth-store.ts` | ✅ 已存在 | `src/services/auth-store.ts:32-124` |
| 3 | 创建 `src/services/zentrim-store.ts` | ✅ 已存在 | `src/services/zentrim-store.ts:24-113` |
| 4 | 更新 `HomeScreen.tsx` | ✅ 已存在 | `src/screens/HomeScreen.tsx:103-345` |
| 5 | 创建 `src/services/config.ts` | ✅ 已存在 | `src/services/config.ts:8-12` |
| 6 | 创建类型定义 `src/types/api.ts` | ✅ 已存在 | `src/types/api.ts:9-72` |
| 7 | 更新 `App.tsx` | ✅ 已存在 | `App.tsx:9-45` |
| 8 | 创建 `src/screens/LoginScreen.tsx` | ✅ 已存在 | `src/screens/LoginScreen.tsx:22-148` |

## 各任务实现要点

### Task 1: ApiClient
- `src/services/api-client.ts:36-209`
- 零依赖，纯 `fetch`；构造时去掉 `baseUrl` 末尾 `/`
- `setToken/clearToken/setUnauthorizedHandler` 提供 token 注入与 401 回调
- 401 自动 `clearToken` 并触发外部 handler（auth-store 注册）
- 错误统一封装为 `ApiError(status, message, body)`，可读 status 判断
- 覆盖全部端点：`login`, `getEntries`, `getEntry`, `createEntry`, `updateEntry`, `deleteEntry`, `archiveEntry`, `unarchiveEntry`, `getBlocks`, `updateBlocks`, `search`
- 全局单例 `export const api = new ApiClient()`

### Task 2: auth-store
- `src/services/auth-store.ts:32-124`
- 自实现轻量 store（零依赖，未引入 zustand），用 `useSyncExternalStore` 暴露 hook
- 状态：`token`, `initialized`，`isLoggedIn()` 派生
- 启动时 `hydrate()` 从 AsyncStorage 恢复 token；App.tsx 启动期间用 `isInitialized()` 控制不闪现登录页
- `login()` 自动从响应抽取 token（兼容 `token` / `access_token` / `data.token` 三种格式）
- 构造函数里注册 `api.setUnauthorizedHandler` 实现 401 → 自动清 token

### Task 3: zentrim-store
- `src/services/zentrim-store.ts:24-113`
- 状态：`entries`, `loading`, `error`
- `fetchEntries()` 默认拉 page=1 page_size=50（首屏够用）
- `createEntry` 成功后插入列表头部；`deleteEntry` 按 id 过滤
- `reset()` 登出时清空缓存（App.tsx `RootRouter` effect 调用）

### Task 4: HomeScreen
- `src/screens/HomeScreen.tsx`
- `useFocusEffect` 每次聚焦 → `zentrimStore.fetchEntries()`（line 110-114）
- 三张卡片数据派生自真实 entries：
  - 📋待办 = `entries.filter(e => e.type === "todo").length`
  - 📈完成度 = `entries.filter(e => !e.is_archived).length`
  - 📅全部 = `entries.length`
- 时间线 Sheet 按 `sheetKind` 过滤 entries；按 `created_at` 取 MM-DD
- 后端不可达时回退到 `MOCK_NOTES` 兜底，不白屏（line 168-174）
- 错误提示：`error !== null && entries.length === 0` 时显示 ⚠️ 提示

### Task 5: config
- `src/services/config.ts:8-12`
- `BASE_URL: __DEV__ ? "http://localhost:8080" : "https://feclaw.lizidaren.cn"`
- `__DEV__` 是 React Native 编译期常量，debug 构建为 true

### Task 6: types/api.ts
- `src/types/api.ts`
- `ZentrimEntry`, `PaginatedResponse<T>`, `LoginRequest`, `AuthResponse`, `CreateEntryRequest`, `UpdateEntryRequest`, `Block`
- 字段命名与后端 JSON 完全一致（snake_case），无需映射

### Task 7: App.tsx
- `App.tsx:9-45`
- 启动 `useEffect` 调用 `authStore.hydrate()`
- hydrate 完成前显示 ActivityIndicator（避免登录页一闪）
- 登录态切换时由 `RootRouter` effect 调用 `zentrimStore.reset()` 清缓存
- `AppNavigator` 用 `key={isLoggedIn ? "main" : "auth"}` 强制重建 NavigationContainer

### Task 8: LoginScreen
- `src/screens/LoginScreen.tsx:22-148`
- 用户名 + 密码 + 登录按钮
- `KeyboardAvoidingView` iOS 用 padding 行为
- 提交中按钮显示 ActivityIndicator；`canSubmit` 校验输入非空
- 错误捕获自 `ApiError.message`，显示在按钮上方
- 成功由 `authStore` 触发 `isLoggedIn` 变化 → AppNavigator 自动切到 Main

## tsc 结果

```
$ npx tsc --noEmit
（无输出 = 零错误，退出码 0）
```

TypeScript 配置：
- `tsconfig.json` extends `@react-native/typescript-config`
- types: `["jest"]`
- include: `**/*.ts`, `**/*.tsx`
- exclude: `node_modules`, `Pods`

## 架构总览

```
App.tsx
 ├─ useEffect → authStore.hydrate()       (启动恢复 token)
 ├─ authStore.isInitialized()             (未就绪显示 ActivityIndicator)
 └─ AppNavigator(isLoggedIn)
     ├─ AuthNavigator                      (未登录)
     │   └─ LoginScreen                    → authStore.login()
     └─ MainNavigator                      (已登录)
         ├─ Main (TabNavigator)
         │   ├─ ChatTab
         │   └─ HomeScreen (ZentrimTab)
         │       └─ useFocusEffect → zentrimStore.fetchEntries()
         │           └─ api.getEntries() → GET /api/zentrim/entries
         └─ Canvas (fullScreenModal)

ApiClient (api 单例)
 ├─ Authorization: Bearer <token>
 ├─ 401 → onUnauthorized → authStore 清 token
 └─ ApiError(status, message, body) 统一错误

authStore
 ├─ token, initialized
 ├─ hydrate() (AsyncStorage)
 └─ useAuth() hook (useSyncExternalStore)

zentrimStore
 ├─ entries, loading, error
 ├─ fetchEntries / createEntry / deleteEntry / reset
 └─ useZentrimStore() hook
```

## 结论

8 项任务全部完成，代码通过 `npx tsc --noEmit` 零错误验证。无需额外修改。
