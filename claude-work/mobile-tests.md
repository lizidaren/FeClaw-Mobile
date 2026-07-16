# FeClaw-Mobile: 单元测试

项目: /home/lch/Projects/FeClaw-Mobile

Jest 已配置（`package.json` 中 `"test": "jest"`，有 `@types/jest`、`react-test-renderer`）。

## 需要测试的模块

### 1. `src/services/api-client.ts`
测试 ApiClient 类，mock fetch 以避免真实网络请求：
- 构造函数正确设置 baseUrl（去掉末尾斜杠）
- setToken/clearToken 正确管理 token
- login() 发送正确请求并解析响应
- getEntries() 发送正确请求并包含 Bearer token
- getEntry/createEntry/deleteEntry/archiveEntry/unarchiveEntry/getBlocks/updateBlocks/search
- 401 响应触发 onUnauthorized handler
- 网络错误封装为 ApiError

### 2. `src/services/auth-store.ts`
测试 auth store（自实现 light store + useSyncExternalStore）：
- 初始状态: token=null, initialized=false
- hydrate() 从 AsyncStorage 读取 token
- login() 在成功时设置 token 并持久化
- 使用 useAuth() hook 获取状态
- isLoggedIn() 返回正确值

AsyncStorage 需要 mock（`@react-native-async-storage/async-storage/jest/async-storage-mock`）。

### 3. `src/services/zentrim-store.ts`
测试 zentrim store：
- 初始状态: entries=[], loading=false, error=null
- fetchEntries() 成功时更新 entries
- fetchEntries() 失败时设置 error
- createEntry() 将新条目插入列表头部
- deleteEntry() 从列表移除
- reset() 清空状态

### 4. `src/screens/HomeScreen.tsx`
使用 react-test-renderer 渲染测试：
- 渲染问候语
- 渲染三张卡片
- 渲染 ＋ 按钮
- Mock zentrim store 返回数据时显示条目

### 5. `src/screens/LoginScreen.tsx`
- 渲染用户名/密码输入框和登录按钮
- 空输入时按钮禁用
- 登录成功调用 authStore.login

### 6. `src/types/api.ts`
- 验证类型定义正确（编译检查，不单独写测试）

### 7. `src/services/config.ts`
- 验证 BASE_URL 根据 __DEV__ 切换

## 注意事项
- 使用 `jest.mock()` mock 外部依赖（fetch, AsyncStorage, @react-navigation/native 等）
- 不 mock src/canvas/ 下的任何文件
- 测试文件放在 `__tests__/` 目录，与源码路径对应
- 遵循项目已有的测试命名风格
- 运行 `npx jest --passWithNoTests` 确认所有测试通过
- 运行 `npx tsc --noEmit` 确认类型正确

## 输出
测试完成后运行 `npx jest --passWithNoTests`，结果写入 `claude-work/mobile-tests-result.md`。
