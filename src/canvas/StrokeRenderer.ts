/**
 * 单笔 ink 笔划渲染（不依赖 React）
 *
 * 渲染策略：
 * - 用 ContourBuilder 把 BezierCurve → 闭合轮廓路径
 * - Fill Style + EvenOdd（处理自相交）
 * - 抗锯齿 + 圆角（仅当 fill 模式时由 Skia 默认开启）
 */

import {
  BlendMode,
  PaintStyle,
  Skia,
  type SkCanvas,
  type SkPaint,
} from "@shopify/react-native-skia";
import { buildContourPath } from "./ContourBuilder";
import { renderEraserStroke } from "./EraserRenderer";
import type { Stroke, Viewport } from "./types";

/** 解析 #rrggbb 字符串为 Skia Color */
// fix(P1-5): 添加输入校验，防止非法 hex 导致 NaN
function parseHexColor(hex: string): number {
  const cleaned = hex.replace("#", "");
  const full = cleaned.length === 3
    ? cleaned.split("").map((c) => c + c).join("")
    : cleaned;
  if (full.length < 6) return 0xff1a1a1a; // fallback 黑色
  const r = parseInt(full.substring(0, 2), 16) || 0;
  const g = parseInt(full.substring(2, 4), 16) || 0;
  const b = parseInt(full.substring(4, 6), 16) || 0;
  // Skia Color = (a<<24) | (r<<16) | (g<<8) | b
  const a = 0xff;
  return ((a << 24) | (r << 16) | (g << 8) | b) >>> 0;
}

/** 渲染一条 ink 笔划到 canvas */
export function renderInkStroke(
  ctx: SkCanvas,
  stroke: Stroke,
  vp: Viewport,
  opacity: number = 1.0,
): void {
  if (stroke.type !== "ink") return;

  const paint: SkPaint = Skia.Paint();
  const baseColor = parseHexColor(stroke.style.color);
  // 应用 opacity：直接修改 alpha 通道
  const alpha = Math.round(opacity * 0xff) & 0xff;
  const color = ((alpha << 24) | (baseColor & 0x00ffffff)) >>> 0;
  // fix: Skia 2.x 中 SkColor = Float32Array；Skia.Color(number) 把
  // 32-bit ARGB number 转换为 [r,g,b,a]（每通道 0..1）Float32Array。
  paint.setColor(Skia.Color(color));
  paint.setAntiAlias(true);
  paint.setStyle(PaintStyle.Fill);
  paint.setBlendMode(BlendMode.SrcOver);

  const path = buildContourPath(stroke, vp);
  ctx.drawPath(path, paint);
}

/**
 * 统一的单笔渲染入口：把一条笔划画到目标 SkCanvas（离屏 Surface 或屏幕）。
 *
 * - ink：SrcOver 填充轮廓
 * - eraser：DstOut（把已画像素的 alpha 抠掉）
 *
 * @param ctx     目标画布（通常是 persistentSurface.getCanvas()）
 * @param stroke  笔划
 * @param vp      当前视口（文档坐标 → 屏幕坐标）
 * @param opacity ink 笔划透明度（草稿模式降低）
 */
export function renderStrokeToSurface(
  ctx: SkCanvas,
  stroke: Stroke,
  vp: Viewport,
  opacity: number = 1.0,
): void {
  if (stroke.type === "ink") {
    renderInkStroke(ctx, stroke, vp, opacity);
  } else if (stroke.type === "eraser") {
    renderEraserStroke(ctx, stroke, vp);
  } else {
    console.warn("[StrokeRenderer] 未知笔划类型，跳过渲染", (stroke as Stroke).type);
  }
}