/**
 * Chat 状态管理
 *
 * - 内部维护 sessions / currentSession / messages / streaming
 * - 对外暴露 useChatStore() hook（基于 useSyncExternalStore）
 * - sendMessage 走 api.chatStream()，逐 chunk 累加到 streamingContent
 *
 * 设计要点：
 * - 流式过程中不在 messages 数组里加临时条目，而是单独维护 streamingContent，
 *   屏幕组件在 streaming=true 时把 streamingContent 渲染为最后一条 assistant 气泡。
 * - 流结束时把完整内容固化为一条 messages 条目，并把 currentSessionId / topic 更新。
 * - 支持图片 / 文件附件（pending → 上传 → 提交）、群聊、Agent 切换。
 */

import { useSyncExternalStore } from "react";
import { api } from "./api-client";
import type {
  AgentInfo,
  ChatFileAttachment,
  ChatImageAttachment,
  ChatMessage,
  ChatSessionDetail,
  ChatSessionInfo,
  ChatSessionType,
  ChatStreamEvent,
  GroupInfo,
  GroupMember,
  GroupMessage,
  ToolCall,
} from "../types/api";

/** 用户在输入框里挂起的待发送图片（还没上传） */
export interface PendingImage {
  /** 本地 URI（file://…） */
  uri: string;
  /** 用户自定义名，可选 */
  fileName?: string;
  mime?: string;
}

/** 用户在输入框里挂起的待发送文件 */
export interface PendingFile {
  uri: string;
  name: string;
  size?: number;
  mime?: string;
}

interface ChatState {
  sessions: ChatSessionInfo[];
  currentSessionId: string | null;
  currentSessionType: ChatSessionType;
  currentTopic: string | null;
  /** 群聊场景下：当前会话对应的群 id */
  currentGroupId: string | null;
  /** 当前群名称（群聊头部展示） */
  currentGroupName: string | null;
  /** 当前 Agent id（私聊场景可切换） */
  currentAgentId: string | null;
  currentAgentName: string | null;
  messages: ChatMessage[];
  streaming: boolean;
  streamingContent: string;
  loading: boolean;
  error: string | null;
  /** 输入框挂起的待发送图片 */
  pendingImages: PendingImage[];
  /** 输入框挂起的待发送文件 */
  pendingFiles: PendingFile[];
  /** 已知的群列表缓存（@ 选择器可用） */
  groups: GroupInfo[];
  /** 已知的 Agent 列表缓存 */
  agents: AgentInfo[];
  /** 当前群成员缓存 */
  currentGroupMembers: GroupMember[];
}

const INITIAL_STATE: ChatState = {
  sessions: [],
  currentSessionId: null,
  currentSessionType: "private",
  currentTopic: null,
  currentGroupId: null,
  currentGroupName: null,
  currentAgentId: null,
  currentAgentName: null,
  messages: [],
  streaming: false,
  streamingContent: "",
  loading: false,
  error: null,
  pendingImages: [],
  pendingFiles: [],
  groups: [],
  agents: [],
  currentGroupMembers: [],
};

/** 单条发送的输入载荷 */
export interface SendPayload {
  content: string;
  image?: { url: string };
  file?: { path: string; name: string };
}

class ChatStore {
  private state: ChatState = { ...INITIAL_STATE };
  private listeners = new Set<() => void>();
  /** 当前进行中的流请求 AbortController（用于打断或中途取消） */
  private currentAbort: AbortController | null = null;

  // ── 读取 ──────────────────────────────────────────────────

  getState(): ChatState {
    return this.state;
  }

  // ── 修改 ──────────────────────────────────────────────────

  async fetchSessions(): Promise<void> {
    this.update({ loading: true, error: null });
    try {
      const sessions = await api.listChatSessions();
      this.update({ sessions, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取会话列表失败";
      this.update({ error: message, loading: false });
    }
  }

  async fetchSession(sessionId: string): Promise<void> {
    this.update({ loading: true, error: null });
    try {
      const detail = await api.getChatSession(sessionId);
      this.applyDetail(detail);
      this.update({ loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取会话详情失败";
      this.update({ error: message, loading: false });
    }
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    // 取消任何进行中的流，避免 SSE 继续写回已删除的会话
    if (this.currentAbort) {
      try {
        this.currentAbort.abort();
      } catch {
        // ignore
      }
      this.currentAbort = null;
    }
    this.update({ error: null });
    try {
      await api.deleteChatSession(sessionId);
      const sessions = this.state.sessions.filter(
        (s) => s.session_id !== sessionId,
      );
      // 若删除的是当前会话，清空消息区
      const isCurrent = this.state.currentSessionId === sessionId;
      this.update({
        sessions,
        ...(isCurrent
          ? {
              currentSessionId: null,
              currentTopic: null,
              messages: [],
              currentGroupId: null,
              currentGroupName: null,
              currentSessionType: "private" as const,
            }
          : {}),
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "删除会话失败";
      this.update({ error: message });
      return false;
    }
  }

  /** 新建私聊会话 */
  createNewSession(): void {
    // 取消任何进行中的流，避免旧会话的 SSE 继续写回新会话
    if (this.currentAbort) {
      try {
        this.currentAbort.abort();
      } catch {
        // ignore
      }
      this.currentAbort = null;
    }
    this.update({
      currentSessionId: null,
      currentTopic: null,
      messages: [],
      streaming: false,
      streamingContent: "",
      error: null,
      currentSessionType: "private",
      currentGroupId: null,
      currentGroupName: null,
      pendingImages: [],
      pendingFiles: [],
    });
  }

  /** 进入群聊会话 */
  openGroupSession(group: GroupInfo): void {
    // 取消任何进行中的流，避免旧会话的 SSE 继续写回新群
    if (this.currentAbort) {
      try {
        this.currentAbort.abort();
      } catch {
        // ignore
      }
      this.currentAbort = null;
    }
    this.update({
      currentSessionId: null,
      currentSessionType: "group",
      currentTopic: group.name,
      currentGroupId: group.group_id,
      currentGroupName: group.name,
      currentGroupMembers: group.members ?? [],
      messages: [],
      streaming: false,
      streamingContent: "",
      error: null,
      pendingImages: [],
      pendingFiles: [],
    });
    // 异步加载群消息
    void this.refreshGroupMessages(group.group_id);
    // 异步加载成员（如果 list 时没给）
    if (!group.members) {
      void this.refreshGroupMembers(group.group_id);
    }
  }

  /** 切换当前 Agent（仅影响后续 sendMessage；当前会话不重置） */
  switchAgent(agent: AgentInfo): void {
    this.update({
      currentAgentId: agent.agent_id,
      currentAgentName: agent.name,
    });
  }

  /** 添加待发送图片 */
  addPendingImage(img: PendingImage): void {
    this.update({
      pendingImages: [...this.state.pendingImages, img],
    });
  }

  /** 移除待发送图片 */
  removePendingImage(index: number): void {
    const list = this.state.pendingImages.slice();
    if (index >= 0 && index < list.length) list.splice(index, 1);
    this.update({ pendingImages: list });
  }

  /** 添加待发送文件 */
  addPendingFile(file: PendingFile): void {
    this.update({
      pendingFiles: [...this.state.pendingFiles, file],
    });
  }

  /** 移除待发送文件 */
  removePendingFile(index: number): void {
    const list = this.state.pendingFiles.slice();
    if (index >= 0 && index < list.length) list.splice(index, 1);
    this.update({ pendingFiles: list });
  }

  /** 退出登录时清空所有本地缓存 */
  reset(): void {
    // 中断任何进行中的流
    if (this.currentAbort) {
      try {
        this.currentAbort.abort();
      } catch {
        // ignore
      }
      this.currentAbort = null;
    }
    this.state = { ...INITIAL_STATE };
    this.emit();
  }

  // ── 列表加载（群 / Agent） ────────────────────────────────

  async fetchGroups(): Promise<GroupInfo[]> {
    try {
      const groups = await api.listGroups();
      this.update({ groups });
      return groups;
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取群列表失败";
      this.update({ error: message });
      return [];
    }
  }

  async fetchAgents(): Promise<AgentInfo[]> {
    try {
      const agents = await api.listAgents();
      this.update({ agents });
      return agents;
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取 Agent 列表失败";
      this.update({ error: message });
      return [];
    }
  }

  async refreshGroupMembers(groupId: string): Promise<GroupMember[]> {
    try {
      const members = await api.listGroupMembers(groupId);
      if (this.state.currentGroupId === groupId) {
        this.update({ currentGroupMembers: members });
      }
      return members;
    } catch {
      return [];
    }
  }

  async refreshGroupMessages(groupId: string): Promise<GroupMessage[]> {
    this.update({ loading: true, error: null });
    try {
      const list = await api.listGroupMessages(groupId);
      const messages: ChatMessage[] = list.map((m) => ({
        role: "user",
        content: m.content,
        timestamp: m.timestamp,
        sender_id: m.sender_id,
        sender_name: m.sender_name,
        images: m.images,
        files: m.files,
      }));
      if (this.state.currentGroupId === groupId) {
        this.update({ messages, loading: false });
      }
      return list;
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取群消息失败";
      this.update({ error: message, loading: false });
      return [];
    }
  }

  /**
   * 发送一条消息并消费 SSE 流。
   * - 立即把 user 消息 push 进 messages，开启 streaming
   * - 逐 chunk 累加到 streamingContent
   * - 结束后把完整内容固化为一条 assistant 消息
   *
   * 支持图片/文件附件：先尝试上传（若已是 URL/data URL 则跳过），
   * 拿到最终 URL 后再以 image_url/file_path 形式塞进请求体。
   */
  async sendMessage(content: string, sessionId?: string | null): Promise<void> {
    const trimmed = content.trim();
    const hasAttachments =
      this.state.pendingImages.length > 0 || this.state.pendingFiles.length > 0;

    // 没有任何内容且没附件，直接 return
    if (!trimmed && !hasAttachments) return;
    if (this.state.streaming) {
      // 已有流在跑，忽略（UI 已禁用发送按钮）
      return;
    }

    // 1) 上传所有 pending 图片（串行，避免一次性触发多个大请求）
    // fix(Bug-3): 三级兜底 —— 远端 URL → data URL → 本地 URI。
    // 最后一级确保 user 消息的 images 字段非空，UI 缩略图始终能显示。
    const uploadedImages: ChatImageAttachment[] = [];
    for (const img of this.state.pendingImages) {
      const mime = img.mime ?? "image/jpeg";
      let resolvedUrl: string | null = null;
      try {
        const res = await api.uploadFile(
          img.uri,
          img.fileName ?? `image-${Date.now()}.jpg`,
          mime,
        );
        if (res?.url) {
          resolvedUrl = res.url;
        }
      } catch {
        // 上传失败：继续走 data URL 兜底
      }
      if (!resolvedUrl) {
        const fallback = await tryReadAsDataUrl(img.uri).catch(() => null);
        if (fallback) {
          resolvedUrl = fallback;
        }
      }
      // 最后兜底：直接用本地 URI（Image 组件能渲染 file://）
      if (!resolvedUrl) {
        resolvedUrl = img.uri;
      }
      uploadedImages.push({ url: resolvedUrl, mime });
    }

    // 2) 上传所有 pending 文件
    // fix(Bug-3): 失败兜底用本地 URI；保证 user 消息的 files 字段至少能显示文件名。
    const uploadedFiles: ChatFileAttachment[] = [];
    for (const f of this.state.pendingFiles) {
      const mime = f.mime ?? "application/octet-stream";
      try {
        const res = await api.uploadFile(f.uri, f.name, mime);
        uploadedFiles.push({ path: res.url, name: f.name, size: res.size, mime: res.mime ?? mime });
      } catch {
        // 上传失败：保留本地 URI 兜底，让 file card 仍能渲染与本地预览
        uploadedFiles.push({ path: f.uri, name: f.name, size: f.size, mime });
      }
    }

    // 3) 取首个图/文件作为请求体里的 image_url/file_path（后端单数约定）
    const primaryImage = uploadedImages[0]?.url;
    const primaryFile = uploadedFiles[0]
      ? { path: uploadedFiles[0].path, name: uploadedFiles[0].name }
      : undefined;

    // 4) 构造 user 消息并 push
    const targetSessionId = sessionId ?? this.state.currentSessionId;
    const userMsg: ChatMessage = {
      role: "user",
      content: trimmed || "(附件)",
      timestamp: new Date().toISOString(),
      images: uploadedImages.length > 0 ? uploadedImages : undefined,
      files: uploadedFiles.length > 0 ? uploadedFiles : undefined,
      sender_id: "me",
      sender_name: "我",
    };

    this.update({
      messages: [...this.state.messages, userMsg],
      streaming: true,
      streamingContent: "",
      error: null,
      pendingImages: [],
      pendingFiles: [],
    });

    const abort = new AbortController();
    this.currentAbort = abort;

    try {
      const stream = await api.chatStream(
        {
          content: trimmed,
          session_id: targetSessionId,
          image_url: primaryImage,
          file_path: primaryFile?.path,
          file_name: primaryFile?.name,
          group_id: this.state.currentGroupId ?? undefined,
          agent_id: this.state.currentAgentId ?? undefined,
        },
        abort.signal,
      );

      let assistantContent = "";
      let resolvedSessionId: string | null = targetSessionId;
      let resolvedTopic: string | null = this.state.currentTopic;
      // fix(Bug-3): 即使底层 SSE 消费者已加去重，消费侧再守一道：
      // 多次收到 done 事件只 break 一次。
      let doneReceived = false;
      // fix(Bug-2): 流式过程中收集工具调用，结束固化到 assistant 消息上。
      // 否则退出再进会话后工具调用记录会"消失"。
      const toolCalls: ToolCall[] = [];
      // 用 tool_call_id 关联 tool_result；老后端可能用 index 顺序合并。
      const pendingToolIds = new Set<string>();

      for await (const event of stream as AsyncIterable<ChatStreamEvent>) {
        if (abort.signal.aborted) break;

        const ev = event as ChatStreamEvent;

        if (typeof ev.session_id === "string" && ev.session_id.length > 0) {
          resolvedSessionId = ev.session_id;
        }
        if (typeof (ev as { topic?: unknown }).topic === "string") {
          resolvedTopic = (ev as { topic: string }).topic;
        }

        if (ev.type === "error" || typeof ev.error === "string") {
          const errMsg = ev.error ?? "流式响应出错";
          throw new Error(errMsg);
        }
        // fix(Bug-2): 工具调用事件 —— 单独收集，不并入 content。
        if (ev.type === "tool_call") {
          const id = ev.tool_call_id;
          if (id) pendingToolIds.add(id);
          toolCalls.push({
            id,
            name: ev.tool_name ?? "tool",
            args: ev.tool_args,
            status: "done",
          });
          continue;
        }
        if (ev.type === "tool_result") {
          const id = ev.tool_call_id;
          if (id) {
            // 找匹配 id 的 tool_call 把 result 写上去
            const target = toolCalls.find((t) => t.id === id);
            if (target) {
              target.result = ev.tool_result;
              target.status = "done";
            } else {
              // 没有前置 tool_call —— 直接 append 一条
              toolCalls.push({
                id,
                name: ev.tool_name ?? "tool",
                result: ev.tool_result,
                status: "done",
              });
            }
            pendingToolIds.delete(id);
          } else {
            // 没有 id：追加到末尾（兜底）
            toolCalls.push({
              name: ev.tool_name ?? "tool",
              result: ev.tool_result,
              status: "done",
            });
          }
          continue;
        }
        if (ev.type === "done") {
          if (doneReceived) continue;
          doneReceived = true;
          break;
        }

        const chunk =
          (typeof ev.content === "string" ? ev.content : "") ||
          (typeof ev.message === "string" ? ev.message : "") ||
          (typeof ev.data === "string" ? ev.data : "");
        if (chunk) {
          assistantContent += chunk;
          this.update({ streamingContent: assistantContent });
        }
      }

      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: assistantContent,
        timestamp: new Date().toISOString(),
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      };
      const finalMessages = [...this.state.messages, assistantMsg];

      this.update({
        messages: finalMessages,
        streaming: false,
        streamingContent: "",
        currentSessionId: resolvedSessionId,
        currentTopic: resolvedTopic,
      });

      // 异步刷新一次列表
      // 群聊：后端无 SSE，消息是异步 dispatch 出去的，所以 sendMessage 完结后
      // 主动拉一次群消息历史。P0 — 长期应改用 WS 或后端群消息流。
      if (this.state.currentGroupId) {
        void this.refreshGroupMessages(this.state.currentGroupId).catch(() => undefined);
      } else {
        void this.fetchSessions().catch(() => undefined);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "发送失败，请重试";
      this.update({
        streaming: false,
        streamingContent: "",
        error: message,
      });
    } finally {
      this.currentAbort = null;
    }
  }

  // ── 内部工具 ─────────────────────────────────────────────

  private applyDetail(detail: ChatSessionDetail): void {
    this.update({
      currentSessionId: detail.session_id,
      currentTopic: detail.topic ?? null,
      messages: (detail.messages ?? []).map(normalizeChatMessage),
      streaming: false,
      streamingContent: "",
      currentSessionType: detail.type ?? "private",
      currentGroupId: null,
      currentGroupName: detail.group_name ?? null,
      currentAgentId: detail.agent_id ?? null,
      currentAgentName: detail.agent_name ?? null,
    });
  }

  private update(partial: Partial<ChatState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }

  // ── 订阅 ──────────────────────────────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const chatStore = new ChatStore();

/** React hook：订阅整个 store state */
export function useChatStore(): ChatState {
  return useSyncExternalStore(
    (cb) => chatStore.subscribe(cb),
    () => chatStore.getState(),
    () => chatStore.getState(),
  );
}

/**
 * 把本地文件 URI 读成 base64 data URL（仅 fallback 用）。
 * RN 没有 fs API，这里走 fetch(uri).then(r => r.blob()) + FileReader 模拟。
 * 失败返回 null。
 */
async function tryReadAsDataUrl(uri: string): Promise<string | null> {
  try {
    const res = await fetch(uri);
    const blob = await res.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * 规整化后端历史消息，把不同后端实现里的 tool_calls 表达统一成
 * 前端 `ChatMessage.tool_calls: ToolCall[]` 格式。
 *
 * 后端可能把工具调用藏在：
 *   1. OpenAI 风格 `{role:"assistant", tool_calls:[{id, function:{name, arguments}, ...}]}`
 *   2. 扁平风格 `{role:"assistant", tool_calls:[{name, args, result}]}`
 *   3. tool 角色 `{role:"tool", tool_call_id, content}`（结果）
 *   4. 文本嵌入（content 含 "[Tool Call: name]" 等标记）
 *
 * 全部归一化成 `{role:"assistant", content, tool_calls:[{name, args, result, id, status}]}`。
 */
function normalizeChatMessage(raw: ChatMessage): ChatMessage {
  if (!raw) return raw;

  // 1) 已有标准 tool_calls 数组：原样透传
  if (Array.isArray(raw.tool_calls) && raw.tool_calls.length > 0) {
    return raw;
  }

  // 2) 后端用 `role: "tool"` 单独发结果 —— 这里只能丢（没有匹配 call）；
  //    但若后端在 assistant 消息的 content 里 JSON 化了 tool_calls，也兜底解一下。
  // 3) 文本嵌入：content 是 JSON 字符串
  const content = typeof raw.content === "string" ? raw.content : "";
  // 匹配 ```json ... ``` 包裹的 tool_calls 块（部分后端用 markdown 代码块塞）
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) {
    const inner = fenced[1].trim();
    if (inner.startsWith("{") || inner.startsWith("[")) {
      try {
        const parsed = JSON.parse(inner) as unknown;
        const extracted = extractToolCallsFromUnknown(parsed);
        if (extracted.length > 0) {
          // 替换 fenced 块为占位（保留其余正文）
          const stripped = content.replace(fenced[0], "").trim();
          return {
            ...raw,
            content: stripped,
            tool_calls: extracted,
          };
        }
      } catch {
        // 不是 JSON：忽略
      }
    }
  }
  // 4) 文本嵌入：content 直接是 JSON
  if (content.startsWith("{") || content.startsWith("[")) {
    try {
      const parsed = JSON.parse(content) as unknown;
      const extracted = extractToolCallsFromUnknown(parsed);
      if (extracted.length > 0) {
        return { ...raw, content: "", tool_calls: extracted };
      }
    } catch {
      // 不是 JSON：忽略
    }
  }

  return raw;
}

function extractToolCallsFromUnknown(v: unknown): ToolCall[] {
  if (!v || typeof v !== "object") return [];
  const out: ToolCall[] = [];
  const obj = v as Record<string, unknown>;

  // 形状 A：{ tool_calls: [...] }
  if (Array.isArray(obj.tool_calls)) {
    for (const tc of obj.tool_calls) {
      if (tc && typeof tc === "object") {
        const t = tc as Record<string, unknown>;
        const fn = t.function as Record<string, unknown> | undefined;
        const name =
          (fn?.name as string | undefined) ?? (t.name as string | undefined) ?? "tool";
        let args: string | undefined =
          (t.args as string | undefined) ??
          (fn?.arguments as string | undefined);
        if (args && typeof args !== "string") args = JSON.stringify(args);
        out.push({
          id: (t.id as string | undefined) ?? (t.tool_call_id as string | undefined),
          name,
          args,
          result: (t.result as string | undefined),
          status: (t.status as ToolCall["status"]) ?? "done",
        });
      }
    }
    return out;
  }

  // 形状 B：[{ name, args, result, id }, ...]
  if (Array.isArray(v)) {
    for (const tc of v) {
      if (tc && typeof tc === "object") {
        const t = tc as Record<string, unknown>;
        const fn = t.function as Record<string, unknown> | undefined;
        const name =
          (fn?.name as string | undefined) ?? (t.name as string | undefined) ?? "tool";
        let args: string | undefined =
          (t.args as string | undefined) ??
          (fn?.arguments as string | undefined);
        if (args && typeof args !== "string") args = JSON.stringify(args);
        out.push({
          id: (t.id as string | undefined) ?? (t.tool_call_id as string | undefined),
          name,
          args,
          result: (t.result as string | undefined),
          status: (t.status as ToolCall["status"]) ?? "done",
        });
      }
    }
    return out;
  }

  return out;
}