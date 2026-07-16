/**
 * 视口管理：文档坐标系 ↔ 屏幕坐标系转换
 *
 * - 文档坐标 = Int32（锚定在创建设备分辨率 × 4）
 * - 屏幕坐标 = Float32（缩放和平移后的当前视口）
 * - scale 范围：0.25 ~ 4.0
 */

import type { Viewport } from "./types";

/** 最小缩放 */
export const MIN_SCALE = 0.25;
/** 最大缩放 */
export const MAX_SCALE = 4.0;

/** 文档坐标 → 屏幕坐标 */
export function docToScreen(
  docX: number,
  docY: number,
  vp: Viewport,
): { x: number; y: number } {
  return {
    x: (docX - vp.offsetX) * vp.scale,
    y: (docY - vp.offsetY) * vp.scale,
  };
}

/** 屏幕坐标 → 文档坐标 */
export function screenToDoc(
  screenX: number,
  screenY: number,
  vp: Viewport,
): { x: number; y: number } {
  return {
    x: screenX / vp.scale + vp.offsetX,
    y: screenY / vp.scale + vp.offsetY,
  };
}

/** 把 scale 钳制在合法范围 */
export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

/** 创建默认视口 */
export function makeViewport(): Viewport {
  return { offsetX: 0, offsetY: 0, scale: 1.0 };
}

/**
 * 计算"自适应内容"视口：把内容包围盒完整放入指定屏幕尺寸内。
 * 返回的 scale 已钳制到 [MIN_SCALE, MAX_SCALE]；当 bbox 无效时返回当前视口。
 */
// fix(P1-1): exported but currently unused outside ViewportState — kept for future use
export function fitViewportToBBox(
  current: Viewport,
  bbox: { x_min: number; y_min: number; x_max: number; y_max: number } | null,
  screenW: number,
  screenH: number,
  padding: number = 24,
): Viewport {
  if (!bbox) return current;
  const w = bbox.x_max - bbox.x_min;
  const h = bbox.y_max - bbox.y_min;
  if (w <= 0 || h <= 0 || screenW <= 0 || screenH <= 0) return current;
  const availW = Math.max(1, screenW - padding * 2);
  const availH = Math.max(1, screenH - padding * 2);
  const rawScale = Math.min(availW / w, availH / h);
  const scale = clampScale(rawScale);
  // 让 bbox 中心对齐屏幕中心
  const cx = (bbox.x_min + bbox.x_max) / 2;
  const cy = (bbox.y_min + bbox.y_max) / 2;
  return {
    scale,
    offsetX: cx - screenW / 2 / scale,
    offsetY: cy - screenH / 2 / scale,
  };
}

/**
 * 持有 cachedViewport 的视口状态层（避免上层 UI 持有局部状态与引擎不同步）。
 * 通过 syncTo 回调把状态推回 CanvasEngine（避免循环依赖：ViewportManager 不引 CanvasEngine）。
 */
// fix(P1-1): exported but currently unused — kept for future use
export class ViewportState {
  private vp: Viewport;
  /** 把当前 cachedViewport 推回引擎的回调（由调用方注入） */
  private syncTo: (vp: Viewport) => void;

  constructor(initial: Viewport, syncTo: (vp: Viewport) => void) {
    this.vp = initial;
    this.syncTo = syncTo;
  }

  /** 当前缓存的视口 */
  get(): Viewport {
    return this.vp;
  }

  /**
   * ZoomToFit：根据包围盒重新计算视口，并把结果同步到 CanvasEngine。
   * fix(P0-2): 保证 cachedViewport 与引擎 setViewport 一致，避免缩放后引擎视图不刷新。
   */
  zoomToFit(
    bbox: { x_min: number; y_min: number; x_max: number; y_max: number } | null,
    screenW: number,
    screenH: number,
    padding: number = 24,
  ): Viewport {
    const next = fitViewportToBBox(this.vp, bbox, screenW, screenH, padding);
    this.vp = next;
    this.syncTo(next); // 同步到 CanvasEngine：engine.setViewport(next)
    return next;
  }
}

/** 平移视口（屏幕像素增量） */
// fix(P1-1): exported but currently unused — kept for future use
export function panViewport(
  vp: Viewport,
  deltaScreenX: number,
  deltaScreenY: number,
): Viewport {
  return {
    offsetX: vp.offsetX - deltaScreenX / vp.scale,
    offsetY: vp.offsetY - deltaScreenY / vp.scale,
    scale: vp.scale,
  };
}

/** 围绕屏幕锚点缩放 */
// fix(P1-1): exported but currently unused — kept for future use
export function zoomAt(
  vp: Viewport,
  screenAnchorX: number,
  screenAnchorY: number,
  nextScale: number,
): Viewport {
  const scale = clampScale(nextScale);
  const docAnchorX = screenAnchorX / vp.scale + vp.offsetX;
  const docAnchorY = screenAnchorY / vp.scale + vp.offsetY;
  return {
    offsetX: docAnchorX - screenAnchorX / scale,
    offsetY: docAnchorY - screenAnchorY / scale,
    scale,
  };
}