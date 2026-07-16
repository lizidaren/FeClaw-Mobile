/**
 * 后端 API 类型定义
 *
 * 字段命名约定：与后端 JSON 完全一致（snake_case），
 * 这样 API 客户端可以直接 JSON.parse() 不需要映射。
 */

/** Zentrim 单条笔记/条目 */
export interface ZentrimEntry {
  id: string;
  title?: string;
  content_preview?: string;
  blocks_count?: number;
  /** 条目类型，例如 "todo" / "note" / ... */
  type?: string;
  tags?: string[];
  /** ISO 8601 字符串 */
  created_at: string;
  updated_at?: string;
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

/** 创建条目的请求体 */
export interface CreateEntryRequest {
  title?: string;
  content?: string;
  type?: string;
  tags?: string[];
}

/** 更新条目的请求体（PATCH） */
export interface UpdateEntryRequest {
  title?: string;
  content?: string;
  type?: string;
  tags?: string[];
  is_archived?: boolean;
}

/** Block（条目内嵌的笔记块） */
export interface Block {
  id?: string;
  type?: string;
  content?: string;
  order?: number;
}
