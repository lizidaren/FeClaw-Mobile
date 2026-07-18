/**
 * Zentrim 数据状态管理
 *
 * - 内部维护 entries 列表 + loading + error
 * - 提供 fetchEntries / createEntry / deleteEntry
 * - 对外暴露 useZentrimStore() hook（基于 useSyncExternalStore）
 *
 * 设计：每次 fetch 拉 page 1 拉一批（默认 50 条，足够首页展示）；
 * 后续如需分页再扩展。
 */

import { useSyncExternalStore } from "react";
import { api } from "./api-client";
import type {
  Block,
  CreateEntryRequest,
  ZentrimEntry,
} from "../types/api";

const DEFAULT_PAGE_SIZE = 50;

interface ZentrimState {
  entries: ZentrimEntry[];
  loading: boolean;
  error: string | null;
}

class ZentrimStore {
  private state: ZentrimState = {
    entries: [],
    loading: false,
    error: null,
  };
  private listeners = new Set<() => void>();

  // ── 读取 ──────────────────────────────────────────────────

  getState(): ZentrimState {
    return this.state;
  }

  // ── 修改 ──────────────────────────────────────────────────

  async fetchEntries(): Promise<void> {
    this.update({ loading: true, error: null });
    try {
      const resp = await api.getEntries(1, DEFAULT_PAGE_SIZE);
      // resp 可能是数组（直接返回 entries）或 {items, total} 格式
      const entries = Array.isArray(resp) ? resp : resp?.items ?? [];
      this.update({ entries, loading: false });
    } catch (err) {
      const message = err instanceof Error ? err.message : "获取失败";
      this.update({ error: message, loading: false });
    }
  }

  async createEntry(data: CreateEntryRequest): Promise<ZentrimEntry | null> {
    this.update({ error: null });
    try {
      const created = await api.createEntry(data);
      this.update({ entries: [created, ...this.state.entries] });
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : "创建失败";
      this.update({ error: message });
      return null;
    }
  }

  async deleteEntry(id: string): Promise<boolean> {
    this.update({ error: null });
    try {
      await api.deleteEntry(id);
      this.update({
        entries: this.state.entries.filter((e) => e.id !== id),
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "删除失败";
      this.update({ error: message });
      return false;
    }
  }

  async archiveEntry(id: string): Promise<boolean> {
    this.update({ error: null });
    try {
      const updated = await api.archiveEntry(id);
      this.update({
        entries: this.state.entries.map((e) =>
          e.id === id ? updated : e,
        ),
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "归档失败";
      this.update({ error: message });
      return false;
    }
  }

  async unarchiveEntry(id: string): Promise<boolean> {
    this.update({ error: null });
    try {
      const updated = await api.unarchiveEntry(id);
      this.update({
        entries: this.state.entries.map((e) =>
          e.id === id ? updated : e,
        ),
      });
      return true;
    } catch (err) {
      const message = err instanceof Error ? err.message : "取消归档失败";
      this.update({ error: message });
      return false;
    }
  }

  /**
   * 拍照创建 Entry：创建 entry → 上传图片（必须 entryId 存在）→ 保存 photo block。
   * 失败时已创建的 entry 仍保留在列表中。
   * 返回创建的 entry，失败返回 null。
   *
   * 修复 P0：之前的顺序是先 uploadFile 再 createEntry，但新 api.uploadFile
   * 需要 entryId。新流程：先 createEntry（零成本），再 uploadFile（拿到 cos_key），
   * 再 updateBlocks 写入 block 引用；后端 updateBlocks 响应里会带 server-assigned
   * block.id（如果返回），用这个 id 去触发 processEntry。
   */
  async createPhotoEntry(
    fileUri: string,
    fileName: string,
    mimeType: string,
    onProgress?: (pct: number) => void,
  ): Promise<ZentrimEntry | null> {
    this.update({ loading: true, error: null });
    try {
      // 1. 先创建 entry
      const created = await api.createEntry({
        title: fileName,
        tags: ["photo"],
      });
      // 2. 上传图片（必须挂到 entry）
      const uploaded = await api.uploadFile(
        fileUri,
        fileName,
        mimeType,
        onProgress,
        undefined,
        created.id,
      );
      // 3. 保存 photo block
      const photoBlock: Block = {
        type: "photo",
        cos_key: uploaded.url,
        thumbnail_url: uploaded.url,
        file_name: fileName,
        mime: uploaded.mime ?? mimeType,
        size: uploaded.size,
        order: 0,
      };
      try {
        const upd = await api.updateBlocks(created.id, [photoBlock]);
        // 4. 触发管线（非阻塞，失败忽略）
        //    修复：之前的代码用 photoBlock.id（前端未生成，永远 undefined），
        //    现在用 updateBlocks 响应里后端返回的 block_id。
        const returnedBlocks = (upd.blocks ?? []) as Array<{ id?: string; type?: string }>;
        const serverBlock = returnedBlocks.find((b) => b.type === "photo") ?? returnedBlocks[0];
        if (serverBlock?.id) {
          void api.processEntry(created.id, {
            block_id: serverBlock.id,
            cos_key: uploaded.url,
            block_type: "photo",
          });
        }
      } catch {
        // block 保存/管线触发失败不阻塞 entry 展示
      }
      this.update({
        entries: [created, ...this.state.entries],
        loading: false,
      });
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : "拍照创建失败";
      this.update({ error: message, loading: false });
      return null;
    }
  }

  /**
   * 文件创建 Entry：先 createEntry → uploadFile → updateBlocks（file block）。
   *
   * 注意：后端 `processEntry` 仅支持 block_type ∈ {photo, audio, ink}，
   * 不支持 "file"。所以这里不触发 processEntry（之前会发 400）。
   */
  async createFileEntry(
    fileUri: string,
    fileName: string,
    mimeType: string,
    onProgress?: (pct: number) => void,
  ): Promise<ZentrimEntry | null> {
    this.update({ loading: true, error: null });
    try {
      const created = await api.createEntry({
        title: fileName,
        tags: ["file"],
      });
      const uploaded = await api.uploadFile(
        fileUri,
        fileName,
        mimeType,
        onProgress,
        undefined,
        created.id,
      );
      const fileBlock: Block = {
        type: "file",
        cos_key: uploaded.url,
        file_name: fileName,
        mime: uploaded.mime ?? mimeType,
        size: uploaded.size,
        order: 0,
      };
      try {
        await api.updateBlocks(created.id, [fileBlock]);
        // 不触发 processEntry：file 类型不被管线接受
      } catch {
        // 非阻塞
      }
      this.update({
        entries: [created, ...this.state.entries],
        loading: false,
      });
      return created;
    } catch (err) {
      const message = err instanceof Error ? err.message : "文件创建失败";
      this.update({ error: message, loading: false });
      return null;
    }
  }

  /** 登出时清空本地缓存 */
  reset(): void {
    this.state = { entries: [], loading: false, error: null };
    this.emit();
  }

  // ── 订阅 ──────────────────────────────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private update(partial: Partial<ZentrimState>): void {
    this.state = { ...this.state, ...partial };
    this.emit();
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export const zentrimStore = new ZentrimStore();

/** React hook：订阅整个 store state */
export function useZentrimStore(): ZentrimState {
  return useSyncExternalStore(
    (cb) => zentrimStore.subscribe(cb),
    () => zentrimStore.getState(),
    () => zentrimStore.getState(),
  );
}
