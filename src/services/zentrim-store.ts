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
import type { CreateEntryRequest, ZentrimEntry } from "../types/api";

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
      this.update({ entries: resp.items, loading: false });
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
