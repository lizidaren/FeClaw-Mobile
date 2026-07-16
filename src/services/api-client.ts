/**
 * 轻量 HTTP API 客户端
 *
 * - 零依赖：直接用 RN 内置 fetch
 * - 自动加 Authorization: Bearer <token> header
 * - 自动 JSON 序列化/反序列化
 * - 401 触发 onUnauthorized 回调（由 auth-store 注册，清除 token）
 * - 错误抛出 ApiError（含 status + body）
 */

import { API_CONFIG } from "./config";
import type {
  AuthResponse,
  Block,
  CreateEntryRequest,
  LoginRequest,
  PaginatedResponse,
  UpdateEntryRequest,
  ZentrimEntry,
} from "../types/api";

/** 抛出错误类型，组件层可读 status 判断 */
export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

type UnauthorizedHandler = () => void;

export class ApiClient {
  private baseUrl: string;
  private token: string | null = null;
  private onUnauthorized: UnauthorizedHandler | null = null;

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? API_CONFIG.BASE_URL).replace(/\/$/, "");
  }

  // ── Token 管理 ────────────────────────────────────────────

  setToken(token: string): void {
    this.token = token;
  }

  clearToken(): void {
    this.token = null;
  }

  getToken(): string | null {
    return this.token;
  }

  /** 注册 401 处理器。auth-store 在 init 时调用一次。 */
  setUnauthorizedHandler(handler: UnauthorizedHandler): void {
    this.onUnauthorized = handler;
  }

  // ── 内部 fetch 包装 ───────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = {
      Accept: "application/json",
      ...(extraHeaders ?? {}),
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
    }
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    // 401 → 触发外部清 token
    if (res.status === 401) {
      this.clearToken();
      this.onUnauthorized?.();
    }

    // 解析响应体
    const text = await res.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      const msg =
        (parsed && typeof parsed === "object" && "message" in parsed
          ? String((parsed as { message: unknown }).message)
          : res.statusText) || `HTTP ${res.status}`;
      throw new ApiError(res.status, msg, parsed);
    }

    return parsed as T;
  }

  // ── Auth ──────────────────────────────────────────────────

  async login(username: string, password: string): Promise<AuthResponse> {
    const body: LoginRequest = { username, password };
    return this.request<AuthResponse>("POST", "/api/user/login", body);
  }

  // ── Zentrim entries ───────────────────────────────────────

  async getEntries(
    page: number = 1,
    pageSize: number = 10,
  ): Promise<PaginatedResponse<ZentrimEntry>> {
    return this.request<PaginatedResponse<ZentrimEntry>>(
      "GET",
      `/api/zentrim/entries?page=${page}&page_size=${pageSize}`,
    );
  }

  async getEntry(entryId: string): Promise<ZentrimEntry> {
    return this.request<ZentrimEntry>(
      "GET",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}`,
    );
  }

  async createEntry(data: CreateEntryRequest): Promise<ZentrimEntry> {
    return this.request<ZentrimEntry>("POST", "/api/zentrim/entries", data);
  }

  async updateEntry(
    entryId: string,
    data: UpdateEntryRequest,
  ): Promise<ZentrimEntry> {
    return this.request<ZentrimEntry>(
      "PATCH",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}`,
      data,
    );
  }

  async deleteEntry(entryId: string): Promise<void> {
    await this.request<unknown>(
      "DELETE",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}`,
    );
  }

  async archiveEntry(entryId: string): Promise<ZentrimEntry> {
    return this.request<ZentrimEntry>(
      "POST",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}/archive`,
    );
  }

  async unarchiveEntry(entryId: string): Promise<ZentrimEntry> {
    return this.request<ZentrimEntry>(
      "POST",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}/unarchive`,
    );
  }

  // ── Zentrim blocks ────────────────────────────────────────

  async getBlocks(entryId: string): Promise<Block[]> {
    return this.request<Block[]>(
      "GET",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}/blocks`,
    );
  }

  async updateBlocks(entryId: string, blocks: Block[]): Promise<void> {
    await this.request<unknown>(
      "PUT",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}/blocks`,
      { blocks },
    );
  }

  // ── Search ────────────────────────────────────────────────

  async search(q: string): Promise<ZentrimEntry[]> {
    const qs = encodeURIComponent(q);
    return this.request<ZentrimEntry[]>(
      "GET",
      `/api/zentrim/search?q=${qs}`,
    );
  }
}

/** 全局单例。组件内直接 `import { api } from "..."` 即可。 */
export const api = new ApiClient();
