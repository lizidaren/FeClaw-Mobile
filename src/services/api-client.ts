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
  AgentInfo,
  AgentTemplate,
  AuthResponse,
  Block,
  CanvasData,
  ChatSessionDetail,
  ChatSessionInfo,
  ChatStreamEvent,
  ChatStreamRequest,
  CreateAgentRequest,
  CreateEntryRequest,
  CreatedAgent,
  EntryProcessStatus,
  GroupInfo,
  GroupMember,
  GroupMessage,
  LoginRequest,
  PaginatedResponse,
  ProcessEntryRequest,
  SendGroupMessageRequest,
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

  async getEntryCanvas(entryId: string): Promise<CanvasData> {
    return this.request<CanvasData>(
      "GET",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}/canvas`,
    );
  }

  // ── Zentrim processing ────────────────────────────────────

  async processEntry(
    entryId: string,
    body: ProcessEntryRequest,
  ): Promise<unknown> {
    return this.request<unknown>(
      "POST",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}/process`,
      body,
    );
  }

  async getEntryStatus(entryId: string): Promise<EntryProcessStatus> {
    return this.request<EntryProcessStatus>(
      "GET",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}/status`,
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

  // ── Chat ────────────────────────────────────────────────

  async listChatSessions(): Promise<ChatSessionInfo[]> {
    return this.request<ChatSessionInfo[]>("GET", "/api/chat/sessions");
  }

  async getChatSession(sessionId: string): Promise<ChatSessionDetail> {
    return this.request<ChatSessionDetail>(
      "GET",
      `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  async deleteChatSession(sessionId: string): Promise<void> {
    await this.request<unknown>(
      "DELETE",
      `/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    );
  }

  /**
   * 发送消息并消费 SSE 流。
   * 返回一个 async 迭代器，逐块产出 ChatStreamEvent。
   * 调用方负责读取；中途 break/error 会触发 abort 中断请求。
   *
   * 实现说明：React Native 的 fetch 不暴露 ReadableStream.body，
   * 因此使用 XMLHttpRequest + onprogress 来逐块读取 responseText，
   * 并按 "\n\n" 切分 SSE event。
   */
  async chatStream(
    body: ChatStreamRequest,
    signal?: AbortSignal,
  ): Promise<AsyncIterableIterator<ChatStreamEvent>> {
    // 群聊走 group 接口，否则走 chat stream
    const url = body.group_id
      ? `${this.baseUrl}/api/groups/${encodeURIComponent(body.group_id)}/stream`
      : `${this.baseUrl}/api/chat/stream`;

    type Resolver = (value: IteratorResult<ChatStreamEvent>) => void;
    const queue: ChatStreamEvent[] = [];
    const waiters: Resolver[] = [];
    let done = false;
    let error: Error | null = null;
    let started = false;
    // fix(Bug-3): 守卫 finish() 只调用一次。onload 与 onprogress 末尾清理、
    // xhr.onabort、外部 AbortSignal 都可能走到 finish，需要幂等。
    let finished = false;
    // 跟踪已推送的事件签名，避免 onload 里对残余 buffer 重复 parseChunk。
    const seenSignatures = new Set<string>();

    const notify = (ev: ChatStreamEvent) => {
      // dedup：相同 type + 相同 content 的事件只推一次。
      // 重点防御 [DONE] 哨兵和 onload 里被重复 parseChunk 的尾部事件。
      const sig = `${ev.type}|${(ev as { content?: unknown }).content ?? ""}|${(ev as { message?: unknown }).message ?? ""}`;
      if (seenSignatures.has(sig)) return;
      seenSignatures.add(sig);
      const w = waiters.shift();
      if (w) {
        w({ value: ev, done: false });
      } else {
        queue.push(ev);
      }
    };

    const finish = () => {
      if (finished) return;
      finished = true;
      done = true;
      while (waiters.length > 0) {
        const w = waiters.shift();
        if (w) w({ value: undefined as unknown as ChatStreamEvent, done: true });
      }
    };

    const fail = (err: Error) => {
      error = err;
      while (waiters.length > 0) {
        const w = waiters.shift();
        if (w) {
          // 在 async iterator 协议里，错误应该通过 throw() 传递；
          // 这里直接把 done=true 推给等待者，避免 Promise 永久 hang。
          w({ value: undefined as unknown as ChatStreamEvent, done: true });
        }
      }
    };

    // SSE 解析：把一整段文本（可能含多个 event）拆成 event 数组
    const parseChunk = (chunk: string): ChatStreamEvent[] => {
      const out: ChatStreamEvent[] = [];
      const parts = chunk.split("\n\n");
      for (const raw of parts) {
        const trimmed = raw.trim();
        if (!trimmed) continue;
        let data = "";
        for (const line of trimmed.split("\n")) {
          if (line.startsWith("data:")) {
            data += line.slice(5).trim();
          }
        }
        if (!data) continue;
        if (data === "[DONE]") {
          out.push({ type: "done" });
          continue;
        }
        try {
          const parsed = JSON.parse(data) as unknown;
          if (parsed && typeof parsed === "object") {
            out.push(parsed as ChatStreamEvent);
          } else {
            out.push({ type: "message", content: String(parsed) });
          }
        } catch {
          out.push({ type: "delta", content: data });
        }
      }
      return out;
    };

    const start = () => {
      if (started) return;
      started = true;

      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Accept", "text/event-stream");
      xhr.setRequestHeader("Content-Type", "application/json");
      if (this.token) {
        xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
      }

      // 记录上次处理到的位置，处理按 \n\n 切分
      let processedLen = 0;
      let buffer = "";

      xhr.onprogress = () => {
        const fullText = xhr.responseText ?? "";
        if (fullText.length < processedLen) {
          // 理论上不会发生，防御性 reset
          processedLen = 0;
          buffer = "";
        }
        const newPart = fullText.slice(processedLen);
        processedLen = fullText.length;
        buffer += newPart;
        const events = parseChunk(buffer);
        // 把末尾未以 \n\n 结尾的部分保留在 buffer
        const lastSep = buffer.lastIndexOf("\n\n");
        if (lastSep >= 0) {
          buffer = buffer.slice(lastSep + 2);
        }
        for (const ev of events) {
          notify(ev);
        }
      };

      xhr.onload = () => {
        // 优先检查 HTTP 状态码：非 2xx 直接 fail，不要把 error body 当 SSE 解析发出。
        if (xhr.status === 401) {
          this.clearToken();
          this.onUnauthorized?.();
          fail(new ApiError(401, "未授权", null));
          return;
        }
        if (xhr.status < 200 || xhr.status >= 300) {
          fail(
            new ApiError(
              xhr.status,
              xhr.responseText || `HTTP ${xhr.status}`,
              xhr.responseText || null,
            ),
          );
          return;
        }

        // 状态码 OK（2xx）才 flush 残余 + 推送 done
        // fix(Bug-3): 不要重复 parseChunk(buffer)；只解析剩余的 rest 拼到 buffer 后推一次。
        // notify() 内部的 seenSignatures 已为 [DONE] 等哨兵去重作为兜底。
        const rest = (xhr.responseText ?? "").slice(processedLen);
        if (rest) {
          buffer += rest;
          const events = parseChunk(buffer);
          // 把未以 \n\n 结尾的部分保留在 buffer（与 onprogress 保持一致）
          const lastSep = buffer.lastIndexOf("\n\n");
          if (lastSep >= 0) {
            buffer = buffer.slice(lastSep + 2);
          }
          for (const ev of events) notify(ev);
        }
        notify({ type: "done" });
        finish();
      };

      xhr.onerror = () => {
        fail(new Error("网络错误"));
      };

      xhr.onabort = () => {
        finish();
      };

      // 外部 AbortSignal 联动
      const onAbort = () => {
        try {
          xhr.abort();
        } catch {
          // ignore
        }
        finish();
      };
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener("abort", onAbort, { once: true });
        }
      }

      try {
        xhr.send(JSON.stringify(body));
      } catch (e) {
        fail(e instanceof Error ? e : new Error("发送失败"));
      }
    };

    const iterator: AsyncIterableIterator<ChatStreamEvent> = {
      next: (): Promise<IteratorResult<ChatStreamEvent>> => {
        // 首次 next() 时才真正发起请求（lazy）
        if (!started) start();
        if (error) {
          return Promise.reject(error);
        }
        const next = queue.shift();
        if (next) {
          return Promise.resolve({ value: next, done: false });
        }
        if (done) {
          return Promise.resolve({
            value: undefined as unknown as ChatStreamEvent,
            done: true,
          });
        }
        return new Promise<IteratorResult<ChatStreamEvent>>((resolve) => {
          waiters.push(resolve);
        });
      },
      return: (): Promise<IteratorResult<ChatStreamEvent>> => {
        finish();
        return Promise.resolve({
          value: undefined as unknown as ChatStreamEvent,
          done: true,
        });
      },
      throw: (err: unknown): Promise<IteratorResult<ChatStreamEvent>> => {
        fail(err instanceof Error ? err : new Error(String(err)));
        return Promise.resolve({
          value: undefined as unknown as ChatStreamEvent,
          done: true,
        });
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };

    return iterator;
  }

  // ── Group chat ─────────────────────────────────────────────

  async listGroups(): Promise<GroupInfo[]> {
    return this.request<GroupInfo[]>("GET", "/api/groups");
  }

  async getGroup(groupId: string): Promise<GroupInfo> {
    return this.request<GroupInfo>(
      "GET",
      `/api/groups/${encodeURIComponent(groupId)}`,
    );
  }

  async listGroupMembers(groupId: string): Promise<GroupMember[]> {
    return this.request<GroupMember[]>(
      "GET",
      `/api/groups/${encodeURIComponent(groupId)}/members`,
    );
  }

  async listGroupMessages(
    groupId: string,
    page: number = 1,
    pageSize: number = 50,
  ): Promise<GroupMessage[]> {
    return this.request<GroupMessage[]>(
      "GET",
      `/api/groups/${encodeURIComponent(groupId)}/messages?page=${page}&page_size=${pageSize}`,
    );
  }

  async sendGroupMessage(
    groupId: string,
    body: SendGroupMessageRequest,
  ): Promise<GroupMessage> {
    return this.request<GroupMessage>(
      "POST",
      `/api/groups/${encodeURIComponent(groupId)}/messages`,
      body,
    );
  }

  // ── Agents ─────────────────────────────────────────────────

  async listAgents(): Promise<AgentInfo[]> {
    return this.request<AgentInfo[]>("GET", "/api/agents");
  }

  async getAgent(agentId: string): Promise<AgentInfo> {
    return this.request<AgentInfo>(
      "GET",
      `/api/agents/${encodeURIComponent(agentId)}`,
    );
  }

  // ── Agent 模板 / 创建 ─────────────────────────────────────

  /**
   * 拉取可用的 Agent 模板列表。
   * 后端约定：`GET /api/console/templates` → `{templates: AgentTemplate[]}`。
   * 兼容老后端：若返回的是裸数组，也直接透传。
   */
  async listTemplates(): Promise<AgentTemplate[]> {
    const res = await this.request<
      AgentTemplate[] | { templates: AgentTemplate[] }
    >("GET", "/api/console/templates");
    if (Array.isArray(res)) return res;
    if (res && Array.isArray(res.templates)) return res.templates;
    return [];
  }

  /**
   * 基于模板（或裸名）创建一个新 Agent。
   * - 优先尝试 `POST /api/console/agents`（新控制台接口）
   * - 失败时降级到 `POST /api/user/agents`（老用户接口）
   *
   * 降级策略（fix Bug-7）：
   * - 400 / 401 / 403 / 422：客户端错误，不降级（避免把鉴权/参数错误当成接口不存在）
   * - 404 / 501 / 503：接口不存在或暂不可用，降级
   * - 其他 4xx：降级兜底
   * - 5xx / 网络错误：降级兜底
   *
   * 返回 `{hash, name}`，hash 是 4~8 位 hex 字符串。
   */
  async createAgent(
    name: string,
    templateId?: string,
  ): Promise<CreatedAgent> {
    const body: CreateAgentRequest = { name, template_id: templateId };
    try {
      return await this.request<CreatedAgent>(
        "POST",
        "/api/console/agents",
        body,
      );
    } catch (err) {
      if (err instanceof ApiError) {
        // 客户端请求错误——不降级，直接抛
        const NON_FALLBACK_4XX = new Set([400, 401, 403, 422]);
        if (NON_FALLBACK_4XX.has(err.status)) {
          throw err;
        }
        // 其他情况（含 404/501/503 及非 4xx）走降级
      }
      // 降级到老接口：忽略 template_id，只传 name
      return await this.request<CreatedAgent>(
        "POST",
        "/api/user/agents",
        { name },
      );
    }
  }

  // ── Upload ─────────────────────────────────────────────────

  /**
   * 上传二进制文件（图片/普通文件）并返回后端给出的 url。
   * 进度回调 onProgress 可选，接收 0~1 之间的进度值。
   */
  async uploadFile(
    fileUri: string,
    fileName: string,
    mimeType: string,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal,
  ): Promise<{ url: string; size?: number; mime?: string }> {
    const url = `${this.baseUrl}/api/upload`;

    return await new Promise<{ url: string; size?: number; mime?: string }>(
      (resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);

        const form = new FormData();
        // React Native 的 FormData 接受 { uri, name, type } 文件对象
        // （不是标准 Blob）。RN 会读取 uri 指向的本地文件并附加到 multipart。
        form.append("file", {
          uri: fileUri,
          name: fileName,
          type: mimeType,
        } as unknown as Blob);

        // 不手动设置 Content-Type：浏览器/RN 会自动加 multipart/form-data + boundary
        if (this.token) {
          xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
        }

        if (onProgress) {
          xhr.upload.onprogress = (ev: ProgressEvent) => {
            if (ev.lengthComputable && ev.total > 0) {
              onProgress(ev.loaded / ev.total);
            }
          };
        }

        xhr.onload = () => {
          if (xhr.status === 401) {
            this.clearToken();
            this.onUnauthorized?.();
            reject(new ApiError(401, "未授权", null));
            return;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(
              new ApiError(
                xhr.status,
                xhr.responseText || `HTTP ${xhr.status}`,
                xhr.responseText || null,
              ),
            );
            return;
          }
          try {
            const parsed = JSON.parse(xhr.responseText) as {
              url?: string;
              size?: number;
              mime?: string;
            };
            if (!parsed.url) {
              reject(new Error("上传响应缺少 url"));
              return;
            }
            resolve({ url: parsed.url, size: parsed.size, mime: parsed.mime });
          } catch (e) {
            reject(e instanceof Error ? e : new Error("解析上传响应失败"));
          }
        };

        xhr.onerror = () => reject(new Error("网络错误"));
        xhr.onabort = () => reject(new Error("已取消"));

        if (signal) {
          if (signal.aborted) {
            xhr.abort();
          } else {
            signal.addEventListener(
              "abort",
              () => {
                try {
                  xhr.abort();
                } catch {
                  /* ignore */
                }
              },
              { once: true },
            );
          }
        }

        try {
          // RN XHR.send 接受 FormData / string / Blob，TS 类型里叫 BodyInit_
          xhr.send(form as unknown as BodyInit_);
        } catch (e) {
          reject(e instanceof Error ? e : new Error("发送失败"));
        }
      },
    );
  }

  /**
   * 上传 base64 二进制内容（不带 data: 前缀）到 /api/upload。
   * fix(Bug-4): 录音是 base64 字符串，RN FormData 的 file 对象要求 uri 指向本地文件，
   * 不接受 data: URL。这里把 base64 解码后以 application/octet-stream POST，
   * 后端按 file_name + mime_type 落盘。
   */
  async uploadBase64(
    base64: string,
    fileName: string,
    mimeType: string,
    signal?: AbortSignal,
  ): Promise<{ url: string; size?: number; mime?: string }> {
    const url = `${this.baseUrl}/api/upload`;
    // base64 → Uint8Array
    let bytes: Uint8Array;
    try {
      // atob 在 RN/Hermes 中可用（polyfilled）；用 globalThis 访问避免 TS 报错
      const atobFn = (globalThis as { atob?: (s: string) => string }).atob;
      const binary = typeof atobFn === "function" ? atobFn(base64) : "";
      const arr = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
      bytes = arr;
    } catch (e) {
      throw new Error(
        `uploadBase64: base64 解码失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    return await new Promise<{ url: string; size?: number; mime?: string }>(
      (resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        // 告诉后端扩展名和 mime（很多后端按 header 取）
        xhr.setRequestHeader("X-File-Name", encodeURIComponent(fileName));
        xhr.setRequestHeader("X-File-Type", encodeURIComponent(mimeType));
        if (this.token) {
          xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
        }

        xhr.onload = () => {
          if (xhr.status === 401) {
            this.clearToken();
            this.onUnauthorized?.();
            reject(new ApiError(401, "未授权", null));
            return;
          }
          if (xhr.status < 200 || xhr.status >= 300) {
            reject(
              new ApiError(
                xhr.status,
                xhr.responseText || `HTTP ${xhr.status}`,
                xhr.responseText || null,
              ),
            );
            return;
          }
          try {
            const parsed = JSON.parse(xhr.responseText) as {
              url?: string;
              size?: number;
              mime?: string;
            };
            if (!parsed.url) {
              reject(new Error("上传响应缺少 url"));
              return;
            }
            resolve({ url: parsed.url, size: parsed.size, mime: parsed.mime });
          } catch (e) {
            reject(e instanceof Error ? e : new Error("解析上传响应失败"));
          }
        };

        xhr.onerror = () => reject(new Error("网络错误"));
        xhr.onabort = () => reject(new Error("已取消"));

        if (signal) {
          if (signal.aborted) {
            xhr.abort();
          } else {
            signal.addEventListener(
              "abort",
              () => {
                try {
                  xhr.abort();
                } catch {
                  /* ignore */
                }
              },
              { once: true },
            );
          }
        }

        try {
          // RN XHR.send 接受 ArrayBuffer/Uint8Array 等
          xhr.send(bytes as unknown as BodyInit_);
        } catch (e) {
          reject(e instanceof Error ? e : new Error("发送失败"));
        }
      },
    );
  }
}

/** 全局单例。组件内直接 `import { api } from "..."` 即可。 */
export const api = new ApiClient();
