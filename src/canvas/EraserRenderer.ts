/**
 * 橡皮擦渲染（不依赖 React）
 *
 * 橡皮擦以 destination-out blend mode 渲染：
 * - 把笔划区域像素的 alpha 减为 0
 * - 用户视觉上看到笔划被"擦掉"
 */

import {
  BlendMode,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  type SkCanvas,
  type SkPaint,
} from "@shopify/react-native-skia";
import { curvesToPath } from "./ContourBuilder";
import type { Stroke, Viewport } from "./types";

/** 渲染一条 eraser 笔划（destination-out） */
export function renderEraserStroke(
  ctx: SkCanvas,
  stroke: Stroke,
  vp: Viewport,
): void {
  if (stroke.type !== "eraser") return;
  // fix(P0-6): 防御性空数组检查 — curves 为空时 curvesToPath 返回空 Path，
  // drawPath 在某些 Skia 版本会抛异常。直接早退避免整个回放链路中断。
  if (!stroke.curves || stroke.curves.length === 0) return;

  ctx.save();

  const paint: SkPaint = Skia.Paint();
  paint.setBlendMode(BlendMode.DstOut);
  paint.setAntiAlias(true);
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth((stroke.eraser_width ?? 40) * vp.scale);
  paint.setStrokeCap(StrokeCap.Round);
  paint.setStrokeJoin(StrokeJoin.Round);

  const path = curvesToPath(stroke.curves, vp);
  ctx.drawPath(path, paint);

  ctx.restore();
}