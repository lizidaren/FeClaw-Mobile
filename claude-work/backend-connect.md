# FeClaw-Mobile: 连接后端 API

项目: /home/lch/Projects/FeClaw-Mobile

## 背景
首页 UI（HomeScreen）已经完成，但所有数据都是 mock 常量。需要创建 API 客户端层，连接到 FeClaw 后端获取真实数据。

## 后端 API 信息

**本地开发服务：** `http://localhost:8080`
**生产服务：** `https://feclaw.lizidaren.cn`

**鉴权：** JWT Bearer Token
- 登录: `POST /api/user/login` → body `{"username":"...", "password":"..."}`
- 返回 JWT token，后续请求在 `Authorization: Bearer <token>` header 中

**Zentrim 相关端点（prefix: /api/zentrim）：**

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/entries?page=1&page_size=10` | 时间线分页列表（返回 entries） |
| GET | `/entries/{entry_id}` | 条目详情 |
| POST | `/entries` | 创建条目 |
| DELETE | `/entries/{entry_id}` | 硬删除 |
| PATCH | `/entries/{entry_id}` | 更新条目 |
| POST | `/entries/{entry_id}/archive` | 归档 |
| POST | `/entries/{entry_id}/unarchive` | 取消归档 |
| PUT | `/entries/{entry_id}/blocks` | 更新条目的 blocks |
| GET | `/entries/{entry_id}/blocks` | 获取条目的 blocks |
| GET | `/search?q=...` | 搜索 |

**用户端点（prefix: /api/user）：**

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/login` | 登录 |

Note: 后端返回的 response 中 entry 对象字段包括但不限于：
- `id`, `title`, `content_preview`, `blocks_count`, `type`, `created_at`, `updated_at`, `is_archived`, `tags`

## 开发用户凭据

- Username: `test`
- Password: `test`

## 任务

### 1. 创建 `src/services/api-client.ts`

封装 HTTP 请求：
```typescript
class ApiClient {
  private baseUrl: string;
  private token: string | null;

  constructor(baseUrl?: string);

  setToken(token: string): void;
  clearToken(): void;

  // Auth
  async login(username: string, password: string): Promise<AuthResponse>;

  // Zentrim entries
  async getEntries(page?: number, pageSize?: number): Promise<PaginatedResponse<ZentrimEntry>>;
  async getEntry(entryId: string): Promise<ZentrimEntry>;
  async createEntry(data: CreateEntryRequest): Promise<ZentrimEntry>;

  // ... etc
}
```

- 所有请求自动添加 `Authorization: Bearer <token>` header
- 自动 JSON 序列化/反序列化
- 401 时自动 clearToken
- 使用 `fetch` API（零依赖）

### 2. 创建 `src/services/auth-store.ts`

Zustand store（或简单类）管理 auth 状态：
- `token: string | null`
- `isLoggedIn: boolean`
- `login(username, password): Promise<void>`
- `logout(): void`
- 使用 `AsyncStorage` 持久化 token

### 3. 创建 `src/services/zentrim-store.ts`

Zustand store（或简单类）管理 Zentrim 数据：
- `entries: ZentrimEntry[]`
- `loading: boolean`
- `error: string | null`
- `fetchEntries(): Promise<void>`
- `createEntry(data): Promise<void>`
- `deleteEntry(id): Promise<void>`

本 store 使用 api-client。

### 4. 更新 `HomeScreen.tsx`

- 使用 `useFocusEffect` 在每次页面聚焦时 fetch entries
- 替换 mock 数据为真实数据
- 三张卡片的数据从真实 entries 统计：
  - 📋待办数 = entries with type=todo 且未完成
  - 📈完成度 = entries with is_archived=false
  - 📅全部 = entries.length
- 时间线 Sheet 显示真实 entries（按 created_at 分组）

### 5. 创建 `src/services/config.ts`

```typescript
export const API_CONFIG = {
  // 开发时用 localhost，生产切换为 feclaw.lizidaren.cn
  BASE_URL: __DEV__ ? 'http://localhost:8080' : 'https://feclaw.lizidaren.cn',
};
```

### 6. 创建类型定义 `src/types/api.ts`

```typescript
export interface ZentrimEntry {
  id: string;
  title?: string;
  content_preview?: string;
  blocks_count?: number;
  type?: string;
  tags?: string[];
  created_at: string;
  updated_at?: string;
  is_archived?: boolean;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}
```

### 7. 更新 `App.tsx`

- 启动时检查是否有已存储的 token
- 有 token → 直接进入首页
- 无 token → 显示登录页面

### 8. 创建 `src/screens/LoginScreen.tsx`

简单登录页：
- 用户名输入框
- 密码输入框
- 登录按钮
- 调用 ApiClient.login
- 成功后跳转首页

## 注意事项
- 不修改 src/canvas/ 下的文件
- 使用项目已有的 Zustand 风格（如果项目中已有 store 模式，保持一致）
- 处理网络错误、loading 状态
- `npx tsc --noEmit` 零错误
- 所有 mock 数据保留为 fallback（如果后端不可达，显示 mock 数据而不是白屏）

## 输出
完成后运行 `npx tsc --noEmit`，结果写入 `claude-work/backend-connect-result.md`。
