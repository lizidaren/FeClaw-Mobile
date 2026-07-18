/**
 * 后端 API 类型定义
 *
 * 字段命名约定：与后端 JSON 完全一致（snake_case），
 * 这样 API 客户端可以直接 JSON.parse() 不需要映射。
 */

/**
 * Zentrim 单条笔记/条目
 *
 * 后端实际返回（routers/zentrim.py → ZentrimService.serialize_entry）：
 *   id, user_id, title, tags, status, metadata, created_at, updated_at, archived_at
 *
 * 老 schema 字段（content_preview/blocks_count/type/is_archived）保留为 optional
 * 向后兼容；前端在新代码中应使用 `status` / `archived_at` / `metadata`。
 */
export interface ZentrimEntry {
  id: string;
  user_id?: number;
  title?: string | null;
  /** 后端真实状态机："pending" | "processing" | "ready" | "error" | ... */
  status?: string;
  tags?: string[];
  /** 任意 JSON 元数据（annotation, appendices 等） */
  metadata?: Record<string, unknown> | null;
  /** ISO 8601 字符串 */
  created_at: string;
  updated_at?: string | null;
  archived_at?: string | null;
  /** 老 schema 兼容字段，可能不存在 */
  content_preview?: string;
  blocks_count?: number;
  type?: string;
  is_archived?: boolean;
}

/** 分页响应 */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

/** 登录请求体 */
export interface LoginRequest {
  username: string;
  password: string;
}

/** 登录响应（兼容多种后端实现） */
export interface AuthResponse {
  /** 直接返回 token 字符串 */
  token?: string;
  /** 或者嵌套在 data 中 */
  data?: {
    token?: string;
  };
  access_token?: string;
}

/**
 * 创建条目的请求体。
 * 后端 EntryCreateRequest 仅接受 title / tags / metadata；
 * 老的 `type` / `content` 字段在新建路径不再使用（实际内容走 PUT /blocks）。
 */
export interface CreateEntryRequest {
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /** @deprecated 后端不再接受，保留以兼容调用方；提交时会被剥离 */
  content?: string;
  /** @deprecated 后端不再接受，保留以兼容调用方；提交时会被剥离 */
  type?: string;
}

/**
 * 更新条目的请求体（PATCH）。
 * 后端 EntryPatchRequest 仅允许 title / tags / metadata；
 * `content` / `type` / `is_archived` 由后端忽略（is_archived 走 /archive 端点）。
 */
export interface UpdateEntryRequest {
  title?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  /** @deprecated 后端不再接受，提交时会被剥离 */
  content?: string;
  /** @deprecated 后端不再接受，提交时会被剥离 */
  type?: string;
  /** @deprecated 改用 POST /entries/{id}/archive 和 /unarchive */
  is_archived?: boolean;
}

/** ── Canvas 聚合数据 ─────────────────────────────────── */

/** Canvas 聚合端点返回的 block 项（比 Block 类型更贴近后端实际字段） */
export interface CanvasBlock {
  id: string;
  entry_id?: string;
  sort_order?: number;
  type: string; // "text" | "ink" | "audio" | "photo" | "image" | "file"
  /** JSON 数据（ink block 存 strokes/images/metadata；photo 存 cos_key 等） */
  data?: Record<string, unknown> | null;
  /** text block 的纯文本内容 */
  text?: string;
  model_name?: string;
  vector_id?: string;
  created_at?: string;
}

/** GET /api/zentrim/entries/{entry_id}/canvas 返回结构 */
export interface CanvasData {
  entry: {
    id: string;
    title?: string;
    tags?: string[];
    metadata?: Record<string, unknown> | null;
    [key: string]: unknown;
  };
  blocks: CanvasBlock[];
}

/** Block（条目内嵌的笔记块） */
export interface Block {
  id?: string;
  type?: string;
  content?: string;
  /**
   * fix(P0-2): 后端 serialize_block 把结构化字段（strokes/images/url/...）
   * 存在 `data` 字段（dict），而 `content` 通常装纯文本 / JSON 字符串。
   * 前端写入路径要跟后端一致：ink/audio 用 `data`；text 用 `content`。
   */
  data?: Record<string, unknown>;
  order?: number;
  /** COS 远端路径（photo/file block 用） */
  cos_key?: string;
  /** 缩略图 URL（photo block 用） */
  thumbnail_url?: string;
  /** 原始文件名 */
  file_name?: string;
  /** MIME 类型 */
  mime?: string;
  /** 文件大小（字节） */
  size?: number;
}

/** 触发 AI 管线请求 */
export interface ProcessEntryRequest {
  block_id: string;
  cos_key: string;
  block_type: string;
}

/** 管线处理状态 */
export interface EntryProcessStatus {
  status: "pending" | "processing" | "done" | "error";
  message?: string;
  progress?: number;
}

/** ── Chat ───────────────────────────────────────────── */

/** 会话类型：私聊 / 群聊 */
export type ChatSessionType = "private" | "group";

/** 会话列表中的简要信息 */
export interface ChatSessionInfo {
  session_id: string;
  /** 私聊/群聊（默认 private，向后兼容老后端） */
  type?: ChatSessionType;
  /** 群聊名称（仅 type === "group"） */
  group_name?: string;
  /** Agent hash / id（私聊和多 Agent 切换场景） */
  agent_id?: string;
  /** Agent 显示名 */
  agent_name?: string;
  message_count?: number;
  topic?: string;
  last_message?: string;
  created_at?: string;
  updated_at?: string;
}

/** 图片附件（user / assistant 通用） */
export interface ChatImageAttachment {
  /** 远端 URL 或 base64 data URL */
  url: string;
  /** 可选：宽高（用于占位） */
  width?: number;
  height?: number;
  /** 可选：MIME */
  mime?: string;
}

/** 文件附件 */
export interface ChatFileAttachment {
  /** 远端 URL 或本地路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 字节数 */
  size?: number;
  /** MIME */
  mime?: string;
}

/** 单次工具调用（assistant 调用 LLM tool） */
export interface ToolCall {
  /** 工具名（OpenAI 风格: tool_calls[].function.name） */
  name: string;
  /** 工具参数（JSON 字符串或对象） */
  args?: string | Record<string, unknown>;
  /** 工具返回结果（assistant 渲染时可能已合并） */
  result?: string;
  /** 工具调用 id（用于关联 tool 消息，可选） */
  id?: string;
  /** 状态：默认 "done"，失败时 "error" */
  status?: "pending" | "done" | "error";
}

/** 会话内的一条消息 */
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  /** 发送者名称（群聊场景） */
  sender_name?: string;
  /** 发送者 id（群聊场景） */
  sender_id?: string;
  /** 附带图片 */
  images?: ChatImageAttachment[];
  /** 附带文件 */
  files?: ChatFileAttachment[];
  /**
   * 工具调用列表（assistant 消息专用）。
   * 后端历史可能把 tool_calls 嵌在 assistant 消息里：role=assistant + tool_calls=[{name, args, result, ...}]
   * 退出再进会话时若不保留这个字段，工具调用会"消失"。
   */
  tool_calls?: ToolCall[];
}

/** 会话详情（列表 + 消息） */
export interface ChatSessionDetail {
  session_id: string;
  type?: ChatSessionType;
  group_name?: string;
  agent_id?: string;
  agent_name?: string;
  message_count?: number;
  topic?: string;
  created_at?: string;
  updated_at?: string;
  messages?: ChatMessage[];
}

/** 发送消息请求体 */
export interface ChatStreamRequest {
  content: string;
  session_id?: string | null;
  /** 图片 URL（base64 data URL 或已上传 URL），与后端约定 */
  image_url?: string;
  /** 文件路径 */
  file_path?: string;
  /** 文件名 */
  file_name?: string;
  /** 群聊 id（type === "group" 时必填） */
  group_id?: string;
  /** Agent id（多 Agent 场景） */
  agent_id?: string;
}

/** SSE 流式事件（兼容多种后端实现） */
export interface ChatStreamEvent {
  /** 事件类型，如 "message" / "delta" / "done" / "error" / "tool_call" / "tool_result" */
  type?: string;
  /** 文本增量（流式 chunk） */
  content?: string;
  /** 完整消息（done 事件） */
  message?: string;
  /** 会话 id（首条响应里返回） */
  session_id?: string;
  /** 群聊 id（群聊响应里返回） */
  group_id?: string;
  /** 错误信息 */
  error?: string;
  /** 允许后端把整段 JSON 直接放在 data 字段 */
  data?: string;
  /** 兼容字段：会话主题 */
  topic?: string;
  /** 工具名（type=tool_call / tool_result 时） */
  tool_name?: string;
  /** 工具参数（type=tool_call） */
  tool_args?: string | Record<string, unknown>;
  /** 工具调用 id（type=tool_call / tool_result） */
  tool_call_id?: string;
  /** 工具返回（type=tool_result） */
  tool_result?: string;
}

/** ── Group ──────────────────────────────────────────── */

/**
 * 群基本信息
 *
 * 后端实际返回（routers/group.py → GroupResponse）：
 *   id, name, announcement, announcement_updated_at, owner_user_id,
 *   settings, context_isolation, max_rounds, created_at, member_count
 *
 * 前端用 `group_id` 作主键；list 响应中由 API client 把 `id` 映射过来。
 * `announcement` 后端字段映射为前端的 `description`。
 */
export interface GroupInfo {
  /** 后端为 `id`，前端统一用 `group_id` */
  group_id: string;
  name: string;
  /** 后端字段为 `announcement`；客户端用 `description` 命名以保持既有调用不变 */
  description?: string;
  member_count?: number;
  /** 后端返回 unix timestamp（秒），前端展示时再格式化 */
  created_at?: string;
  updated_at?: string;
  /** 群成员列表（如果后端在 list 时一并返回） */
  members?: GroupMember[];
  /** 后端原始字段，前端组件按需读取 */
  announcement?: string;
  owner_user_id?: number;
  context_isolation?: boolean;
  max_rounds?: number;
  settings?: Record<string, unknown>;
}

/**
 * 群成员。
 * 后端实际返回（MemberResponse）：agent_hash, role, is_silent, joined_at。
 * 前端把 agent_hash 映射为 member_id；通过 GET /agents/{hash} 拿 name。
 */
export interface GroupMember {
  member_id: string;
  name?: string;
  role?: string;
  is_silent?: boolean;
  joined_at?: number;
  kind?: "agent" | "human";
  avatar_url?: string;
}

/**
 * 群消息
 *
 * 后端实际返回（MessageResponse）：
 *   id, sender_type ("user"|"agent"), sender_hash, content,
 *   message_type, attachments, mentions, round, created_at (unix 秒)
 *
 * 前端用 message_id / group_id / sender_id / timestamp 等命名。
 * `sender_name` 来自 sender_hash → 通过 GET /api/user/agents/{hash} 解析或前端缓存。
 */
export interface GroupMessage {
  /** 后端为 `id`；前端统一用 `message_id` */
  message_id?: string;
  group_id: string;
  /** 后端为 `sender_hash`；用户消息固定为 "user"（见后端 on_message 逻辑） */
  sender_id: string;
  /** 前端缓存/由 sender_hash 二次解析 */
  sender_name?: string;
  content: string;
  /** 后端为 `created_at` unix 秒；前端组件按需转 ISO */
  timestamp?: string;
  /** 后端原始字段 */
  sender_type?: "user" | "agent";
  message_type?: string;
  round?: number;
  mentions?: string[];
  attachments?: ChatFileAttachment[];
  images?: ChatImageAttachment[];
  files?: ChatFileAttachment[];
}

/** 发送群消息请求 */
export interface SendGroupMessageRequest {
  content: string;
  image_url?: string;
  file_path?: string;
  file_name?: string;
  /** @mention 列表（agent_hash 数组） */
  mentions?: string[];
  /** 附件 dict 列表（与后端 SendMessageRequest.attachments 对齐） */
  attachments?: Array<Record<string, unknown>>;
  message_type?: string;
}

/** ── Agent ──────────────────────────────────────────── */

/** Agent 摘要 */
export interface AgentInfo {
  agent_id: string;
  name: string;
  description?: string;
  avatar_url?: string;
}

/** ── Agent 模板 / 创建 ───────────────────────────────── */

/** Agent 模板（创建向导的预置模板） */
export interface AgentTemplate {
  id: string;
  name: string;
  description?: string;
  /** 单个 emoji 或 unicode 字符，作为模板的视觉图标 */
  icon?: string;
  /** 模板分类（"通用" / "教育" / "编程" 等），用于分组展示 */
  category?: string;
}

/** 创建 Agent 请求体 */
export interface CreateAgentRequest {
  name: string;
  /** 可选：基于某个模板创建 */
  template_id?: string;
}

/** 创建 Agent 响应 */
export interface CreatedAgent {
  /** Agent hash（4~8 位十六进制） */
  hash: string;
  name: string;
}
