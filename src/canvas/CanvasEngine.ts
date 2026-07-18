/**
 * 画布渲染引擎（核心）
 *
 * 职责：
 * - 管理 Persistent Canvas / Overlay Canvas / Image Layer 三层概念
 * - 冷启动双缓冲（缩略图 + 后台回放）
 * - 增量更新（O(1) 单笔添加/撤销）
 * - 视口管理
 * - 草稿模式切换
 * - 暴露同步事件供 React 组件订阅
 *
 * 说明：本引擎不直接持有 SkCanvas（Skia 在 React 端创建）。
 * 它是一份"画布状态 + 渲染指令源"，通过订阅/通知机制
 * 让 CurioCanvas 组件把状态变化映射为 Skia 元素的重新挂载。
 *
 * 三层模型：
 * - Image Layer：背景图片（zIndex=0），最先绘制
 * - Persistent Canvas：已确认的 ink/eraser 笔划
 * - Overlay Canvas：用户当前正在画的笔划（笔尖抬起前）
 */

import {
  Skia,
  type SkImage,
  type SkSurface,
} from "@shopify/react-native-skia";
import { ColdStartContext } from "./ColdStart";
import { renderStrokeToSurface } from "./StrokeRenderer";
import {
  UndoManager,
  makeAddStrokeCommand,
} from "./UndoManager";
import { exportSVG } from "./SvgExporter";
import type {
  CanvasImage,
  PageData,
  PageMetadata,
  Stroke,
  Viewport,
} from "./types";
import { makeViewport, clampScale } from "./ViewportManager";

/** 工具模式 */
export type ToolMode = "ink" | "eraser";

/** 引擎订阅事件 */
export type EngineEvent =
  | { type: "viewport"; viewport: Viewport }
  | { type: "strokes"; strokes: Stroke[] }
  | { type: "images"; images: CanvasImage[] }
  | { type: "coldstart"; isColdStarting: boolean; rebuiltTs: number }
  | { type: "draft"; isDraftMode: boolean }
  | { type: "tool"; tool: ToolMode };

/** 订阅者回调 */
export type EngineSubscriber = (event: EngineEvent) => void;

/** 引擎配置 */
export interface EngineConfig {
  /** 草稿模式笔划透明度（0~1） */
  draftOpacity?: number;
  /** ink 默认颜色 */
  defaultInkColor?: string;
  /** ink 默认宽度 */
  defaultInkWidth?: number;
  /** eraser 默认宽度 */
  defaultEraserWidth?: number;
}

/** fix(P2-1): 导出默认 ink 颜色常量，供外部组件引用（避免硬编码） */
export const DEFAULT_INK_COLOR = "#1a1a1a";

/**
 * 画布渲染引擎
 */
export class CanvasEngine {
  // ── 状态 ──
  private strokes: Stroke[] = [];
  private images: CanvasImage[] = [];
  private metadata: PageMetadata | null = null;
  private viewport: Viewport = makeViewport();
  private tool: ToolMode = "ink";
  private isDraftMode = false;
  private inkColor = DEFAULT_INK_COLOR;
  private inkWidth = 4.0;
  private eraserWidth = 40;

  // ── 子模块 ──
  private coldStart = new ColdStartContext();
  // fix: 原名 `undo` 与撤销方法同名会触发 TS2300，重命名为 `undoManager` 区分。
  private undoManager = new UndoManager();
  // fix(P0-3): UndoManager 订阅句柄，dispose 时统一注销
  private unsubscribeUndo: (() => void) | null = null;

  // ── 持久层（离屏 Skia Surface）──
  /** 已确认笔划的离屏渲染目标（screen-space，随视口/尺寸重建） */
  private persistentSurface: SkSurface | null = null;
  /** persistentSurface 的最新快照，供 React 端 <Image> 显示 */
  private persistentImage: SkImage | null = null;
  private surfaceWidth = 0;
  private surfaceHeight = 0;

  // ── 订阅者 ──
  /** fix(Bug-3): _disposed 标记, render 回调检查后跳过 */
  _disposed = false;
  /** fix(Bug-3): 待取消的 rAF handle */
  private _pendingFrame: number | null = null;
  private subscribers: Set<EngineSubscriber> = new Set();

  // ── 配置 ──
  private readonly config: Required<EngineConfig>;

  constructor(config: EngineConfig = {}) {
    this.config = {
      draftOpacity: config.draftOpacity ?? 0.5,
      defaultInkColor: config.defaultInkColor ?? DEFAULT_INK_COLOR,
      defaultInkWidth: config.defaultInkWidth ?? 4.0,
      defaultEraserWidth: config.defaultEraserWidth ?? 40,
    };
    this.inkColor = this.config.defaultInkColor;
    this.inkWidth = this.config.defaultInkWidth;
    this.eraserWidth = this.config.defaultEraserWidth;
    // fix(P0-3): 撤销栈变更后强制 render，让 cachedViewport / 渲染层同步刷新。
    this.unsubscribeUndo = this.undoManager.subscribe(() => {
      this.render();
    });
  }

  // ─────────── 初始化 ───────────

  /**
   * 初始化页面数据。
   *
   * 立即返回。冷启动期间先显示缩略图；持久层 Surface 由 React 端在拿到屏幕
   * 尺寸后调用 `ensureSurface()` 创建并回放全部笔划，完成后结束冷启动。
   */
  async init(page: PageData): Promise<void> {
    this.strokes = [...page.strokes];
    this.images = [...page.images];
    this.metadata = { ...page.metadata };

    // 释放上一页的 Surface
    this.persistentSurface = null;
    this.persistentImage = null;
    this.surfaceWidth = 0;
    this.surfaceHeight = 0;

    // 重置冷启动状态并解码缩略图（同步）
    this.coldStart.reset();
    this.coldStart.decodeThumbnail(page.metadata.thumbnail);

    // 进入冷启动期：先由缩略图占位，等待 ensureSurface()
    this.emit({ type: "coldstart", isColdStarting: true, rebuiltTs: -1 });
  }

  // ─────────── 持久层 Surface ───────────

  /**
   * 确保离屏持久层 Surface 存在且尺寸匹配。
   * 首次创建或尺寸变化时重建，并回放全部已确认笔划。
   * 完成后结束冷启动期（缩略图切换为 persistentImage）。
   *
   * 由 CurioCanvas 在拿到屏幕尺寸后调用。
   */
  ensureSurface(width: number, height: number): void {
    const w = Math.max(1, Math.floor(width));
    const h = Math.max(1, Math.floor(height));
    if (this.persistentSurface && this.surfaceWidth === w && this.surfaceHeight === h) {
      return;
    }
    const surface = Skia.Surface.MakeOffscreen(w, h);
    if (!surface) {
      console.warn("[CanvasEngine] Skia.Surface.MakeOffscreen 创建失败", w, h);
      return;
    }
    this.persistentSurface = surface;
    this.surfaceWidth = w;
    this.surfaceHeight = h;
    this.rebuildSurface();

    // Surface 就绪 → 结束冷启动，切换到 persistentImage
    this.coldStart.endColdStart();
    this.emit({
      type: "coldstart",
      isColdStarting: false,
      rebuiltTs: this.coldStart.getLastRebuiltTs(),
    });
  }

  /**
   * 清空并按 ts 顺序回放全部笔划到 Surface，刷新 persistentImage。
   * 在视口变化、撤销/重做、草稿模式切换后调用。
   *
   * 背景透明：eraser 的 DstOut 会抠出透明孔，透出下方 Image 层 / 容器白底。
   */
  private rebuildSurface(): void {
    if (this._disposed) return;
    const surface = this.persistentSurface;
    if (!surface) return;
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color("transparent"));
    const opacity = this.getStrokeOpacity();
    const sorted = [...this.strokes].sort((a, b) => a.ts - b.ts);
    for (const s of sorted) {
      try {
        renderStrokeToSurface(canvas, s, this.viewport, opacity);
      } catch (e) {
        console.warn("[CanvasEngine] 回放笔划失败", s.id, e);
      }
    }
    // fix(P0-1): 替换前释放旧 snapshot，避免 Skia 句柄泄漏
    if (this.persistentImage) {
      this.persistentImage.dispose();
    }
    this.persistentImage = surface.makeImageSnapshot();
  }

  /** 当前持久层快照（供 React 端 <Image> 显示）。 */
  getPersistentImage(): SkImage | null {
    return this.persistentImage;
  }

  /** 冷启动缩略图（解码后的 SkImage）。 */
  getThumbnailImage(): SkImage | null {
    return this.coldStart.getThumbnail();
  }

  // ─────────── 笔划操作 ───────────

  /**
   * 添加一笔（O(1)，笔尖抬起时调用）。
   * 增量渲染到 Surface（不回放历史），自动入栈。
   */
  addStroke(stroke: Stroke): void {
    this.strokes.push(stroke);
    this.undoManager.push(makeAddStrokeCommand(stroke));
    if (this.persistentSurface) {
      const canvas = this.persistentSurface.getCanvas();
      try {
        renderStrokeToSurface(canvas, stroke, this.viewport, this.getStrokeOpacity());
      } catch (e) {
        console.warn("[CanvasEngine] 增量渲染笔划失败", stroke.id, e);
      }
      // fix(P0-1): 替换前释放旧 snapshot，避免 Skia 句柄泄漏
      if (this.persistentImage) {
        this.persistentImage.dispose();
      }
      this.persistentImage = this.persistentSurface.makeImageSnapshot();
    }
    this.emit({ type: "strokes", strokes: this.strokes });
  }

  /**
   * 撤销最后一笔。
   * 移除笔划后回放剩余笔划重建 Surface（eraser 挖掉的 ink 会重新可见）。
   */
  undo(): Stroke | null {
    const cmd = this.undoManager.popUndo();
    if (!cmd) return null;
    const idx = this.strokes.findIndex((s) => s.id === cmd.stroke.id);
    if (idx >= 0) this.strokes.splice(idx, 1);
    this.rebuildSurface();
    this.emit({ type: "strokes", strokes: this.strokes });
    return cmd.stroke;
  }

  /** 重做 */
  redo(): Stroke | null {
    const cmd = this.undoManager.popRedo();
    if (!cmd) return null;
    this.strokes.push(cmd.stroke);
    this.rebuildSurface();
    this.emit({ type: "strokes", strokes: this.strokes });
    return cmd.stroke;
  }

  /** 清空所有笔划（reset 时调用） */
  clearStrokes(): void {
    this.strokes.length = 0;
    this.undoManager.clear();
    this.rebuildSurface();
    this.emit({ type: "strokes", strokes: this.strokes });
  }

  // ─────────── 图片 ───────────

  addImage(image: CanvasImage): void {
    this.images.push(image);
    this.emit({ type: "images", images: this.images });
  }

  removeImage(id: string): void {
    const idx = this.images.findIndex((i) => i.id === id);
    if (idx >= 0) {
      this.images.splice(idx, 1);
      this.emit({ type: "images", images: this.images });
    }
  }

  // ─────────── 视口 ───────────

  setViewport(vp: Viewport): void {
    const next: Viewport = {
      offsetX: vp.offsetX,
      offsetY: vp.offsetY,
      scale: clampScale(vp.scale),
    };
    this.viewport = next;
    // 持久层是 screen-space 渲染，视口变化后需按新视口回放重建
    this.rebuildSurface();
    this.emit({ type: "viewport", viewport: this.viewport });
  }

  getViewport(): Viewport {
    return this.viewport;
  }

  // ─────────── 工具 ───────────

  setTool(tool: ToolMode): void {
    this.tool = tool;
    this.emit({ type: "tool", tool });
  }

  getTool(): ToolMode {
    return this.tool;
  }

  setInkColor(color: string): void {
    this.inkColor = color;
  }

  getInkColor(): string {
    return this.inkColor;
  }

  setInkWidth(width: number): void {
    this.inkWidth = width;
  }

  getInkWidth(): number {
    return this.inkWidth;
  }

  setEraserWidth(width: number): void {
    this.eraserWidth = width;
  }

  getEraserWidth(): number {
    return this.eraserWidth;
  }

  // ─────────── 草稿模式 ───────────

  toggleDraft(): boolean {
    this.isDraftMode = !this.isDraftMode;
    this.rebuildSurface();
    this.emit({ type: "draft", isDraftMode: this.isDraftMode });
    return this.isDraftMode;
  }

  setDraftMode(on: boolean): void {
    if (this.isDraftMode === on) return;
    this.isDraftMode = on;
    this.rebuildSurface();
    this.emit({ type: "draft", isDraftMode: this.isDraftMode });
  }

  isDraftModeOn(): boolean {
    return this.isDraftMode;
  }

  // ─────────── 渲染辅助 ───────────

  /**
   * 公共渲染入口：强制重建持久层快照并通知订阅者。
   * fix(P0-3): undo/redo 后通过此方法重绘，撤销栈与画布渲染状态保持一致。
   */
  render(): void {
    this.rebuildSurface();
  }

  /**
   * 当前应使用的 ink 笔划透明度（草稿模式时降低）。
   */
  getStrokeOpacity(): number {
    return this.isDraftMode ? this.config.draftOpacity : 1.0;
  }

  // ─────────── 导出 ───────────

  /** 导出为 SVG（evenodd 单 path） */
  exportSVG(): string {
    return exportSVG(this.strokes);
  }

  /** 序列化当前页数据为 PageData */
  toPageData(pageId: string): PageData {
    return {
      version: 1,
      id: pageId,
      strokes: this.strokes,
      images: this.images,
      metadata: this.metadata ?? {
        first_stroke_at: Date.now(),
        last_modified_at: Date.now(),
        content_bbox: { x_min: 0, y_min: 0, x_max: 0, y_max: 0 },
        device_resolution: { width: 0, height: 0 },
      },
    };
  }

  // ─────────── 状态读取 ───────────

  getStrokes(): Stroke[] {
    return this.strokes;
  }

  getImages(): CanvasImage[] {
    return this.images;
  }

  getMetadata(): PageMetadata | null {
    return this.metadata;
  }

  isColdStarting(): boolean {
    return this.coldStart.isColdStarting();
  }

  getLastRebuiltTs(): number {
    return this.coldStart.getLastRebuiltTs();
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  // ─────────── 订阅 ───────────

  subscribe(fn: EngineSubscriber): () => void {
    this.subscribers.add(fn);
    return () => {
      this.subscribers.delete(fn);
    };
  }

  private emit(event: EngineEvent): void {
    for (const fn of this.subscribers) {
      try {
        fn(event);
      } catch {
        // 忽略订阅者异常，避免影响其他订阅者
      }
    }
  }

  // ─────────── 销毁 ───────────

  // fix(P0-5): routeEvent 占位实现 — 当前所有 UI 事件由 CurioCanvas
  // 手势回调直接调用 engine 方法（setViewport / addStroke / undo 等），
  // 此处保留入口供未来事件总线方案接入。调用前请先判断 typeof === 'function'。
  routeEvent(_event: unknown): void {
    /* no-op: 引擎未启用事件总线模式 */
  }

  dispose(): void {
    // fix(P0-3): 先注销 UndoManager 订阅，避免 dispose 期间触发 render 回调
    if (this.unsubscribeUndo) {
      this.unsubscribeUndo();
      this.unsubscribeUndo = null;
    }
    this.subscribers.clear();
    this.coldStart.dispose();
    this.undoManager.clear();
    // fix(Bug-3): 标记已销毁，后续 render 回调跳过
    this._disposed = true;
    // 取消待执行帧
    if (this._pendingFrame !== null) {
      cancelAnimationFrame(this._pendingFrame);
      this._pendingFrame = null;
    }
    // 先释放 Surface（中断渲染管线）
    if (this.persistentSurface) {
      this.persistentSurface = null;
    }
    // fix(Bug-3): 延迟一帧释放 persistentImage，避免 sksg reconciler 还在
    // 回放渲染命令时引用已销毁的 SkImage（"Attempted to access a disposed object"）。
    if (this.persistentImage) {
      const img = this.persistentImage;
      this.persistentImage = null;
      requestAnimationFrame(() => { img.dispose(); });
    }
    this.surfaceWidth = 0;
    this.surfaceHeight = 0;
  }


}