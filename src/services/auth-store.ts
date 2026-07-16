/**
 * 鉴权状态管理（轻量版，类 Zustand 但零依赖）
 *
 * - 内部维护 token + 订阅者列表
 * - AsyncStorage 持久化
 * - 对外暴露 `useAuth()` hook（基于 useSyncExternalStore，React 18+ 原生）
 * - 同时把 token 同步到 ApiClient，避免循环 import（api-client 不感知 auth-store）
 */

import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "./api-client";

const TOKEN_KEY = "auth_token";

/** 从不同形状的 AuthResponse 中抽取 token（兼容嵌套 / 顶层 / access_token） */
function extractToken(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.token === "string") return obj.token;
  if (typeof obj.access_token === "string") return obj.access_token;
  if (
    obj.data &&
    typeof obj.data === "object" &&
    typeof (obj.data as Record<string, unknown>).token === "string"
  ) {
    return (obj.data as Record<string, unknown>).token as string;
  }
  return null;
}

class AuthStore {
  private token: string | null = null;
  private listeners = new Set<() => void>();
  private initialized = false;

  constructor() {
    // 让 api-client 收到 401 时通知我们清 token + 通知订阅者
    api.setUnauthorizedHandler(() => {
      this.token = null;
      void AsyncStorage.removeItem(TOKEN_KEY);
      this.emit();
    });
  }

  // ── 读取状态 ──────────────────────────────────────────────

  getToken(): string | null {
    return this.token;
  }

  isLoggedIn(): boolean {
    return this.token !== null;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // ── 修改状态 ──────────────────────────────────────────────

  async login(username: string, password: string): Promise<void> {
    const resp = await api.login(username, password);
    const token = extractToken(resp);
    if (!token) {
      throw new Error("登录成功但未返回 token");
    }
    this.token = token;
    api.setToken(token);
    await AsyncStorage.setItem(TOKEN_KEY, token);
    this.emit();
  }

  async logout(): Promise<void> {
    this.token = null;
    api.clearToken();
    await AsyncStorage.removeItem(TOKEN_KEY);
    this.emit();
  }

  /** App 启动时调用：把 AsyncStorage 里的 token 恢复出来 */
  async hydrate(): Promise<void> {
    const token = await AsyncStorage.getItem(TOKEN_KEY);
    if (token) {
      this.token = token;
      api.setToken(token);
    }
    this.initialized = true;
    this.emit();
  }

  // ── 订阅 ──────────────────────────────────────────────────

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    this.listeners.forEach((l) => l());
  }
}

export const authStore = new AuthStore();

/** React hook：返回是否已登录。组件用 `useAuth()` 即自动重渲。 */
export function useAuth(): boolean {
  return useSyncExternalStore(
    (cb) => authStore.subscribe(cb),
    () => authStore.isLoggedIn(),
    () => false,
  );
}

/** 调试用：取当前 token（如果需要在外部直接读） */
export function useToken(): string | null {
  return useSyncExternalStore(
    (cb) => authStore.subscribe(cb),
    () => authStore.getToken(),
    () => null,
  );
}
