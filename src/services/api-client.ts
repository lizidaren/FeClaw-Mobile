/**
 * 轻量 HTTP API 客户端
 *
 * - 零依赖：直接用 RN 内置 fetch
 * - 自动加 Authorization: Bearer <token> header
 * - 自动 JSON 序列化/反序列化
 * - 401 触发 onUnauthorized 回调（由 auth-store 注册，清除 token）
 * - 错误抛出 ApiError（含 status + body）
 */

// React Native runtime 在 Hermes / JSC 上都提供 TextDecoder，但
// @react-native/typescript-config 的 lib 不包含 dom 类型 — 在这里
// 显式声明一下，避免 TS2304。
declare global {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  class TextDecoder {
    constructor(
      label?: string,
      options?: { fatal?: boolean; ignoreBOM?: boolean; stream?: boolean },
    );
    decode(
      input?: ArrayBufferView | ArrayBuffer | null,
      options?: { stream?: boolean },
    ): string;
  }
}

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

  /**
   * 拉取条目列表（时间线）。
   *
   * 后端（routers/zentrim.py GET /entries）实际返回 `ZentrimEntry[]`（裸数组），
   * 查询参数为 `limit` / `before` / `include_archived`，不是 `page` / `page_size`。
   * 为了兼容调用方已有的 `page / pageSize` 入参，函数内部用 `limit` 充当 pageSize，
   * 并把裸数组包成 `PaginatedResponse` 形式返回。
   */
  async getEntries(
    page: number = 1,
    pageSize: number = 50,
  ): Promise<PaginatedResponse<ZentrimEntry>> {
    // 后端没有 page 参数；pageSize 直接作为 limit 传给后端（上限 100）
    const limit = Math.max(1, Math.min(100, pageSize));
    void page; // 留作未来分页扩展
    const raw = await this.request<ZentrimEntry[]>(
      "GET",
      `/api/zentrim/entries?limit=${limit}&include_archived=false`,
    );
    return {
      items: raw,
      total: raw.length,
      page: 1,
      page_size: raw.length,
    };
  }

  async getEntry(entryId: string): Promise<ZentrimEntry> {
    return this.request<ZentrimEntry>(
      "GET",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}`,
    );
  }

  /**
   * 创建条目。后端 EntryCreateRequest 仅接受 title/tags/metadata，
   * 老的 type/content 字段在提交前被剥离，避免后端 Pydantic 422。
   */
  async createEntry(data: CreateEntryRequest): Promise<ZentrimEntry> {
    const body: Record<string, unknown> = {};
    if (data.title !== undefined) body.title = data.title;
    if (data.tags !== undefined) body.tags = data.tags;
    if (data.metadata !== undefined) body.metadata = data.metadata;
    return this.request<ZentrimEntry>("POST", "/api/zentrim/entries", body);
  }

  /**
   * 更新条目（PATCH）。后端 EntryPatchRequest 仅接受 title/tags/metadata。
   * 老的 content/type/is_archived 字段被剥离（归档走专门端点）。
   */
  async updateEntry(
    entryId: string,
    data: UpdateEntryRequest,
  ): Promise<ZentrimEntry> {
    const body: Record<string, unknown> = {};
    if (data.title !== undefined) body.title = data.title;
    if (data.tags !== undefined) body.tags = data.tags;
    if (data.metadata !== undefined) body.metadata = data.metadata;
    return this.request<ZentrimEntry>(
      "PATCH",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}`,
      body,
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

  /**
   * 读取 entry 的 blocks。
   * 后端返回 `{blocks: [...]}`，这里把 `blocks` 字段解开成数组。
   * 解开失败时回退到 `[]`，避免上游崩溃。
   */
  async getBlocks(entryId: string): Promise<Block[]> {
    const raw = await this.request<
      { blocks?: Block[] } | Block[]
    >("GET", `/api/zentrim/entries/${encodeURIComponent(entryId)}/blocks`);
    if (Array.isArray(raw)) return raw;
    return Array.isArray(raw?.blocks) ? raw.blocks : [];
  }

  /**
   * 全量替换 entry 的 blocks。
   * 后端期望请求体形如 `{blocks: [...]}`（与现有代码一致），
   * 这里把数组里每个 block 的 `data` 字段展开到顶层（与后端 serialize_block 一致）。
   *
   * 返回新创建的 block 列表（带 server-assigned `id`），
   * 供调用方拿到 block_id 后再触发管线（processEntry）。
   */
  async updateBlocks(
    entryId: string,
    blocks: Block[],
  ): Promise<{ block_count: number; blocks?: Block[] }> {
    // 把每个 block 展开为后端通用 dict（保留 type/data/text 等所有字段）
    const body = {
      blocks: blocks.map((b) => {
        const obj: Record<string, unknown> = {};
        if (b.id !== undefined) obj.id = b.id;
        if (b.type !== undefined) obj.type = b.type;
        if (b.content !== undefined) obj.content = b.content;
        if (b.order !== undefined) obj.order = b.order;
        if (b.cos_key !== undefined) obj.cos_key = b.cos_key;
        if (b.thumbnail_url !== undefined) obj.thumbnail_url = b.thumbnail_url;
        if (b.file_name !== undefined) obj.file_name = b.file_name;
        if (b.mime !== undefined) obj.mime = b.mime;
        if (b.size !== undefined) obj.size = b.size;
        return obj;
      }),
    };
    const res = await this.request<{
      status: string;
      block_count: number;
      blocks?: Block[];
    }>(
      "PUT",
      `/api/zentrim/entries/${encodeURIComponent(entryId)}/blocks`,
      body,
    );
    return { block_count: res.block_count, blocks: res.blocks };
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

  /**
   * 搜索 Zentrim 条目。
   * 后端（routers/zentrim.py GET /search）返回 `{query, count, results: [...]}`，
   * 这里把 `results` 解开成 `ZentrimEntry[]`，与原签名保持兼容。
   */
  async search(q: string): Promise<ZentrimEntry[]> {
    const qs = encodeURIComponent(q);
    const raw = await this.request<{
      query: string;
      count: number;
      results: ZentrimEntry[];
    }>("GET", `/api/zentrim/search?q=${qs}`);
    return Array.isArray(raw?.results) ? raw.results : [];
  }

  // ── Chat ────────────────────────────────────────────────

  async listChatSessions(): Promise<ChatSessionInfo[]> {
    return this.request<ChatSessionInfo[]>("GET", "/api/chat/sessions");
  }

  /**
   * 显式创建一个新的私聊会话（Mobile 一对一场景）。
   *
   * 后端：POST /api/chat/sessions，body={agent_hash}，
   * response={session_id, topic, created_at, agent_hash}。
   *
   * 设计：Mobile 端每个 Agent 始终只有一个 Session。
   * 创建 Agent 后立刻调本接口创建 Session，再 navigate 到聊天页，
   * 避免依赖"第一条消息发出时自动建会话"的隐式行为。
   */
  async createChatSession(
    agentHash: string,
  ): Promise<{
    session_id: string;
    topic?: string;
    created_at?: string;
    agent_hash: string;
  }> {
    return this.request<{
      session_id: string;
      topic?: string;
      created_at?: string;
      agent_hash: string;
    }>("POST", "/api/chat/sessions", { agent_hash: agentHash });
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
   *
   * 群聊流：P0 — 后端 `routers/group.py` 没有 `/api/groups/{id}/stream` 端点。
   * 后端群消息是 fire-and-forget 的异步 dispatch，没有 SSE 通道。
   * 这里把 `body.group_id` 当作开关：群聊不发流式请求，调用方在
   * `sendMessage` 完成后改走轮询 `listGroupMessages()`。
   */
  async chatStream(
    body: ChatStreamRequest,
    signal?: AbortSignal,
  ): Promise<AsyncIterableIterator<ChatStreamEvent>> {
    // 群聊暂不支持流式：直接返回一个空迭代器（立即 done）。
    // 调用方应在拿到 done 后触发 listGroupMessages() 拉取新消息。
    if (body.group_id) {
      const emptyIter: AsyncIterableIterator<ChatStreamEvent> = {
        next: () =>
          Promise.resolve({
            value: undefined as unknown as ChatStreamEvent,
            done: true,
          }),
        return: () =>
          Promise.resolve({
            value: undefined as unknown as ChatStreamEvent,
            done: true,
          }),
        throw: () =>
          Promise.resolve({
            value: undefined as unknown as ChatStreamEvent,
            done: true,
          }),
        [Symbol.asyncIterator]() {
          return this;
        },
      };
      return emptyIter;
    }

    const url = `${this.baseUrl}/api/chat/stream`;

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
      // fix(Bug-1): 用 arraybuffer + TextDecoder(stream:true) 解码，
      // 避免 xhr.responseText 把半截的 UTF-8 多字节字符（中文 3 字节等）解码成乱码。
      // 老的 responseText 路径在 TCP 半包时会把 "你" 的前 2 字节直接渲染成
      // 替换字符，触发流式"丢字/跳字"。
      xhr.open("POST", url, true);
      xhr.responseType = "arraybuffer";
      xhr.setRequestHeader("Accept", "text/event-stream");
      xhr.setRequestHeader("Content-Type", "application/json");
      if (this.token) {
        xhr.setRequestHeader("Authorization", `Bearer ${this.token}`);
      }

      // 用 stream decoder 累积分片解码；保留按 \n\n 分帧的旧逻辑。
      // 关键：xhr.response 在 arraybuffer 模式下指向当前累计的完整 body，
      // 我们用 processedBytes 记录上次已解码的字节偏移，onprogress 时只
      // 解码 "新到的字节" 部分 — decoder 会跨调用保持多字节字符的不完整
      // 字节，直到后续 chunk 补全后才输出。
      const decoder = new TextDecoder("utf-8", { stream: true });
      let processedBytes = 0;
      let buffer = "";
      // 降级标记：若老平台不支持 responseType=arraybuffer，
      // xhr.response 会是 ""，此时退回 responseText 路径。
      let useArrayBuffer = true;

      const handleChunk = (text: string) => {
        if (!text) return;
        buffer += text;
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

      xhr.onprogress = () => {
        const buf = xhr.response;
        if (!useArrayBuffer || !(buf instanceof ArrayBuffer)) {
          // 降级到老 responseText 路径（仅一次）
          useArrayBuffer = false;
          const fullText = xhr.responseText ?? "";
          if (fullText.length <= processedBytes) return;
          const newPart = fullText.slice(processedBytes);
          processedBytes = fullText.length;
          handleChunk(newPart);
          return;
        }
        const total = buf.byteLength;
        if (total < processedBytes) {
          // 防御：理论不会发生
          processedBytes = 0;
        }
        if (total === processedBytes) return;
        // 只 decode 新到的字节区间（stream:true 模式下 decoder 会保留
        // 未完整的多字节字符，等下一次 decode 补全）。
        const slice = new Uint8Array(buf, processedBytes, total - processedBytes);
        processedBytes = total;
        const text = decoder.decode(slice, { stream: true });
        handleChunk(text);
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
          // 错误响应：完整 decode 一次（不需要 stream）
          const buf = xhr.response;
          let errText = "";
          if (buf instanceof ArrayBuffer) {
            try {
              errText = new TextDecoder("utf-8").decode(buf);
            } catch {
              errText = "";
            }
          } else {
            errText = xhr.responseText || "";
          }
          fail(
            new ApiError(
              xhr.status,
              errText || `HTTP ${xhr.status}`,
              errText || null,
            ),
          );
          return;
        }

        // 状态码 OK（2xx）才 flush 残余 + 推送 done
        // fix(Bug-3): 不要重复 parseChunk(buffer)；只解析剩余的 rest 拼到 buffer 后推一次。
        // notify() 内部的 seenSignatures 已为 [DONE] 等哨兵去重作为兜底。
        if (useArrayBuffer) {
          // 收尾：end-of-stream flush，让 decoder 释放残余不完整多字节
          const tail = decoder.decode();
          if (tail) handleChunk(tail);
        } else {
          // 降级路径：把已读到的完整 text 中未处理的部分 flush 出来
          const fullText = xhr.responseText ?? "";
          if (fullText.length > processedBytes) {
            handleChunk(fullText.slice(processedBytes));
          }
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

  /**
   * 把后端 GroupResponse 规整为前端 GroupInfo。
   * 后端字段：`id`, `name`, `announcement`, `owner_user_id`, `settings`,
   * `context_isolation`, `max_rounds`, `created_at` (unix 秒), `member_count`
   * 前端期望：`group_id`, `name`, `description` (=announcement), `member_count`,
   * `created_at` (字符串), `members`（list 时通常不返回）
   */
  private normalizeGroup(raw: Record<string, unknown>): GroupInfo {
    const id = String(raw.id ?? "");
    const created =
      typeof raw.created_at === "number"
        ? new Date(raw.created_at * 1000).toISOString()
        : (raw.created_at as string | undefined);
    return {
      group_id: id,
      name: (raw.name as string) ?? "",
      description: (raw.announcement as string) ?? "",
      announcement: raw.announcement as string | undefined,
      member_count:
        typeof raw.member_count === "number" ? raw.member_count : undefined,
      owner_user_id:
        typeof raw.owner_user_id === "number"
          ? raw.owner_user_id
          : undefined,
      context_isolation:
        typeof raw.context_isolation === "boolean"
          ? raw.context_isolation
          : undefined,
      max_rounds:
        typeof raw.max_rounds === "number" ? raw.max_rounds : undefined,
      settings: (raw.settings as Record<string, unknown>) ?? undefined,
      created_at: created,
    };
  }

  async listGroups(): Promise<GroupInfo[]> {
    const raw = await this.request<Array<Record<string, unknown>>>(
      "GET",
      "/api/groups",
    );
    if (!Array.isArray(raw)) return [];
    return raw.map((g) => this.normalizeGroup(g));
  }

  async getGroup(groupId: string): Promise<GroupInfo> {
    const raw = await this.request<Record<string, unknown>>(
      "GET",
      `/api/groups/${encodeURIComponent(groupId)}`,
    );
    return this.normalizeGroup(raw);
  }

  /**
   * 群成员列表。
   * 后端（MemberResponse）：agent_hash, role, is_silent, joined_at（unix 秒）
   * 前端：member_id, name, role, is_silent, joined_at
   */
  async listGroupMembers(groupId: string): Promise<GroupMember[]> {
    const raw = await this.request<
      Array<{
        agent_hash: string;
        role?: string;
        is_silent?: boolean;
        joined_at?: number;
      }>
    >("GET", `/api/groups/${encodeURIComponent(groupId)}/members`);
    if (!Array.isArray(raw)) return [];
    return raw.map((m) => ({
      member_id: m.agent_hash,
      role: m.role,
      is_silent: m.is_silent,
      joined_at: m.joined_at,
      kind: "agent" as const,
    }));
  }

  /**
   * 群消息历史。
   * 后端（MessageResponse）：id, sender_type, sender_hash, content,
   *   message_type, attachments, mentions, round, created_at（unix 秒）
   * 前端：message_id, group_id, sender_id, sender_name, content, timestamp
   *
   * 后端用 `before` (unix 秒) + `limit` (默认 50) 分页，
   * 不是 `page` + `page_size`。这里保留入参命名但映射到后端语义。
   */
  async listGroupMessages(
    groupId: string,
    page: number = 1,
    pageSize: number = 50,
    before?: number,
  ): Promise<GroupMessage[]> {
    void page; // 后端用 before/limit 分页，这里 page 留作未来扩展
    const limit = Math.max(1, Math.min(200, pageSize));
    const qs = new URLSearchParams();
    qs.set("limit", String(limit));
    if (before !== undefined) qs.set("before", String(before));
    const raw = await this.request<
      Array<{
        id: string;
        sender_type: "user" | "agent";
        sender_hash?: string;
        content: string;
        message_type: string;
        attachments?: Array<Record<string, unknown>>;
        mentions?: string[];
        round?: number;
        created_at: number;
      }>
    >(
      "GET",
      `/api/groups/${encodeURIComponent(groupId)}/messages?${qs.toString()}`,
    );
    if (!Array.isArray(raw)) return [];
    return raw.map((m) => ({
      message_id: m.id,
      group_id: groupId,
      sender_id: m.sender_type === "user" ? "user" : m.sender_hash ?? "",
      sender_name: m.sender_hash ?? undefined,
      sender_type: m.sender_type,
      content: m.content ?? "",
      message_type: m.message_type,
      round: m.round,
      mentions: m.mentions,
      attachments: m.attachments as never,
      timestamp:
        typeof m.created_at === "number"
          ? new Date(m.created_at * 1000).toISOString()
          : undefined,
    }));
  }

  /**
   * 发送群消息。
   * 后端（POST /api/groups/{id}/messages）请求体是 SendMessageRequest：
   *   content, mentions, attachments, message_type（默认 "text"）
   * 响应是 `{status, msg_id}`，不是完整的 GroupMessage。
   * 这里把前端 SendGroupMessageRequest 翻译成后端格式，并返回由前端补全的
   * GroupMessage 伪对象（带 caller-side 时间戳），方便调用方继续渲染。
   */
  async sendGroupMessage(
    groupId: string,
    body: SendGroupMessageRequest,
  ): Promise<GroupMessage> {
    const backendBody: Record<string, unknown> = {
      content: body.content,
      message_type: body.message_type ?? "text",
    };
    if (body.mentions) backendBody.mentions = body.mentions;
    if (body.attachments) backendBody.attachments = body.attachments;
    // 老字段 image_url/file_path/file_name → 折叠到 attachments（保持兼容）
    if (body.image_url || body.file_path) {
      const att = (backendBody.attachments as Array<Record<string, unknown>>) ?? [];
      if (body.image_url) att.push({ type: "image", url: body.image_url });
      if (body.file_path)
        att.push({ type: "file", path: body.file_path, name: body.file_name });
      backendBody.attachments = att;
    }
    const res = await this.request<{ status: string; msg_id: string }>(
      "POST",
      `/api/groups/${encodeURIComponent(groupId)}/messages`,
      backendBody,
    );
    return {
      message_id: res.msg_id,
      group_id: groupId,
      sender_id: "user",
      sender_name: "我",
      content: body.content,
      timestamp: new Date().toISOString(),
    };
  }

  // ── Agents ─────────────────────────────────────────────────

  /**
   * 列出当前用户的 Agent。
   * 后端无 `/api/agents` 端点；最接近的是 `/api/console/agents`，返回
   * `{status, agents: [{id, hash, name, description, ...}], total}`。
   * 这里把 console 端点解开为 `AgentInfo[]`，并把 `hash` 映射为 `agent_id`。
   */
  async listAgents(): Promise<AgentInfo[]> {
    const raw = await this.request<{
      status: string;
      agents: Array<{
        id: number;
        hash: string;
        name: string;
        description?: string;
      }>;
      total: number;
    }>("GET", "/api/console/agents");
    if (!raw || !Array.isArray(raw.agents)) return [];
    return raw.agents.map((a) => ({
      agent_id: a.hash,
      name: a.name,
      description: a.description,
    }));
  }

  /**
   * 通过 agent_hash 获取单个 Agent。
   * 后端有两条：
   *   GET /api/console/agents/by-hash/{hash}   → {status, agent: {id, hash, name, ...}}
   *   GET /api/user/agents/{hash}              → {hash, name, description, ...}
   * 优先用 console 接口（更详细），降级到 user 接口。
   */
  async getAgent(agentId: string): Promise<AgentInfo> {
    try {
      const raw = await this.request<{
        status: string;
        agent: {
          id: number;
          hash: string;
          name: string;
          description?: string;
        };
      }>("GET", `/api/console/agents/by-hash/${encodeURIComponent(agentId)}`);
      if (raw?.agent) {
        return {
          agent_id: raw.agent.hash,
          name: raw.agent.name,
          description: raw.agent.description,
        };
      }
    } catch (err) {
      // 404 / 401 等 — 降级
      if (err instanceof ApiError && [400, 401, 403, 422].includes(err.status)) {
        throw err;
      }
    }
    const raw = await this.request<{
      hash: string;
      name: string;
      description?: string;
    }>("GET", `/api/user/agents/${encodeURIComponent(agentId)}`);
    return {
      agent_id: raw.hash,
      name: raw.name,
      description: raw.description,
    };
  }

  // ── Agent 模板 / 创建 ─────────────────────────────────────

  /**
   * 拉取可用的 Agent 模板列表。
   * 后端约定：`GET /api/console/templates` → `{status, templates: AgentTemplate[]}`。
   * 兼容老后端：若返回的是裸数组，也直接透传。
   */
  async listTemplates(): Promise<AgentTemplate[]> {
    const res = await this.request<
      | AgentTemplate[]
      | { templates: AgentTemplate[] }
      | { status: string; templates: AgentTemplate[] }
    >("GET", "/api/console/templates");
    if (Array.isArray(res)) return res;
    if (res && Array.isArray((res as { templates: unknown }).templates)) {
      return (res as { templates: AgentTemplate[] }).templates;
    }
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
   * 重要：console 接口的请求体是 `{name, agent_mode}`，
   * 不是 `{name, template_id}`。template_id 通过后端初始化步骤
   * （POST /api/console/agents/{id}/initialize）使用，这里不传。
   *
   * 响应形状：console → `{status, agent: {hash, name, ...}}`；
   * user → `{hash, name, description}`。两种都做归一化。
   */
  async createAgent(
    name: string,
    templateId?: string,
  ): Promise<CreatedAgent> {
    void templateId; // console /agents 不接 template_id，留待 initialize 步骤使用
    const consoleBody = { name, agent_mode: "classic" };
    try {
      const res = await this.request<{
        status: string;
        agent: { id: number; hash: string; name: string };
      }>("POST", "/api/console/agents", consoleBody);
      if (res?.agent) {
        return { hash: res.agent.hash, name: res.agent.name };
      }
      // 兼容老 console 实现：直接返回 {hash, name}
      return res as unknown as CreatedAgent;
    } catch (err) {
      if (err instanceof ApiError) {
        const NON_FALLBACK_4XX = new Set([400, 401, 403, 422]);
        if (NON_FALLBACK_4XX.has(err.status)) {
          throw err;
        }
      }
      // 降级到老接口：忽略 template_id，只传 name
      const res = await this.request<CreatedAgent>(
        "POST",
        "/api/user/agents",
        { name },
      );
      return res;
    }
  }

  // ── Upload ─────────────────────────────────────────────────

  /**
   * 上传二进制文件（图片/普通文件）并返回后端给出的 url。
   * 进度回调 onProgress 可选，接收 0~1 之间的进度值。
   *
   * P0 fix: 后端没有通用 `POST /api/upload` 端点。最接近的接口是
   * `POST /api/zentrim/attachments`（multipart，需要 entry_id + file_type），
   * 它返回 `{status, entry_id, attachment: {key, url, mime, size, ...}}`。
   *
   * 调用方必须先有 entryId（先 `api.createEntry`）；没有时传入空字符串会失败，
   * 上层应在更上层捕获错误。
   *
   * 对于聊天场景的图片/文件附件，后端目前没有直接的多 part upload 端点，
   * 该函数把 content-type 当作 `file_type` 提交；后端会做白名单校验。
   */
  async uploadFile(
    fileUri: string,
    fileName: string,
    mimeType: string,
    onProgress?: (pct: number) => void,
    signal?: AbortSignal,
    entryId?: string,
  ): Promise<{ url: string; size?: number; mime?: string }> {
    if (!entryId) {
      throw new Error(
        "uploadFile 需要 entryId（后端 /api/zentrim/attachments 必须挂载到已存在的 entry）。" +
          "调用方请先 api.createEntry() 再上传。",
      );
    }
    const url = `${this.baseUrl}/api/zentrim/attachments`;
    // 后端 file_type 是白名单字段（^[a-z0-9_-]{1,32}$）。从 mime 取第一段作为 file_type。
    const fileType =
      mimeType.split("/")[0]?.toLowerCase().replace(/[^a-z0-9_-]/g, "") ||
      "file";

    return await new Promise<{ url: string; size?: number; mime?: string }>(
      (resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url, true);

        const form = new FormData();
        form.append("entry_id", entryId);
        form.append("file_type", fileType);
        form.append("file", {
          uri: fileUri,
          name: fileName,
          type: mimeType,
        } as unknown as Blob);

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
              status?: string;
              attachment?: {
                key?: string;
                url?: string;
                mime?: string;
                size?: number;
              };
              url?: string;
              size?: number;
              mime?: string;
            };
            // 两种可能形状：
            //   旧客户端：{url, size, mime}
            //   新服务端：{status, entry_id, attachment: {key, url, mime, size}}
            const att = parsed.attachment;
            const finalUrl = att?.url ?? parsed.url;
            if (!finalUrl) {
              reject(new Error("上传响应缺少 url"));
              return;
            }
            resolve({
              url: finalUrl,
              size: att?.size ?? parsed.size,
              mime: att?.mime ?? parsed.mime ?? mimeType,
            });
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
          xhr.send(form as unknown as BodyInit_);
        } catch (e) {
          reject(e instanceof Error ? e : new Error("发送失败"));
        }
      },
    );
  }

  /**
   * 上传 base64 二进制内容（不带 data: 前缀）到后端。
   * 录音（WebView MediaRecorder）走这个接口。
   *
   * P0 fix: 后端没有 `POST /api/upload`；也没有专门的 base64/octet-stream
   * 上传端点。降级方案：把 base64 解码成 Blob，再走 `uploadFile` 的 multipart 路径。
   * 调用方需要先有 entryId。
   */
  async uploadBase64(
    base64: string,
    fileName: string,
    mimeType: string,
    signal?: AbortSignal,
    entryId?: string,
  ): Promise<{ url: string; size?: number; mime?: string }> {
    if (!entryId) {
      throw new Error(
        "uploadBase64 需要 entryId；调用方请先 api.createEntry() 再上传录音。",
      );
    }
    // base64 → Uint8Array → Blob-like object（RN FormData 接受 {uri, name, type}）
    let bytes: Uint8Array;
    try {
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
    // RN 没有 Blob 构造器；用临时 data URI 走 fetch → file:// uri 替代方案不可靠。
    // 退而求其次：把 base64 包成 data: URL，再走普通 fetch 拉成 Blob，
    // 再用 RN 的 {uri, type, name} FormData 形式提交。
    const dataUrl = `data:${mimeType};base64,${base64}`;
    return this.uploadFile(dataUrl, fileName, mimeType, undefined, signal, entryId);
  }
}

/** 全局单例。组件内直接 `import { api } from "..."` 即可。 */
export const api = new ApiClient();
