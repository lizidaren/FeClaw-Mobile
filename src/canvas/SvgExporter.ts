/**
 * SVG evenodd 单 path 导出
 *
 * 算法：
 * 1. 按 ts 升序排序所有笔划
 * 2. 每条笔划导出为「轮廓多边形」（保留压力驱动的笔宽），而非中线：
 *    - ink：buildContourPath 生成的闭合轮廓
 *    - eraser：中线路径按 eraser_width 描边后的轮廓（作为镂空子路径）
 * 3. 合并到单个 <path fill-rule="evenodd">：ink 为外路径，eraser 为内路径 →
 *    evenodd 自动在 ink 上抠出 eraser 覆盖的区域
 *
 * 注意：SVG 仅作视觉参考，不可编辑。完整可编辑数据始终保留在 strokes.json 中。
 * 导出使用文档坐标系（identity 视口），不受当前缩放/平移影响。
 */

import { StrokeCap, StrokeJoin, type SkPath } from "@shopify/react-native-skia";
import { buildContourPath, curvesToPath } from "./ContourBuilder";
import type { Stroke, Viewport } from "./types";

/** 导出选项 */
export interface ExportSVGOptions {
  /** 视图宽度（默认 0 = 自动计算） */
  width?: number;
  /** 视图高度（默认 0 = 自动计算） */
  height?: number;
  /** 填充色（ink 笔划的视觉颜色，默认 #1a1a1a） */
  fillColor?: string;
}

/** 文档坐标系视口（导出时用，不做任何缩放/平移） */
const IDENTITY_VIEWPORT: Viewport = { offsetX: 0, offsetY: 0, scale: 1 };

/** 把一条笔划转换为轮廓 SVG path d 片段（保留笔宽）。失败返回 ""。 */
function strokeToContourD(stroke: Stroke): string {
  try {
    if (stroke.type === "ink") {
      if (stroke.curves.length === 0) return "";
      const path = buildContourPath(stroke, IDENTITY_VIEWPORT);
      return path.toSVGString();
    }
    // eraser：中线路径 → 按 eraser_width 描边取轮廓
    if (stroke.curves.length === 0) return "";
    const centerline = curvesToPath(stroke.curves, IDENTITY_VIEWPORT);
    const outlined = strokeCenterline(centerline, stroke.eraser_width ?? 40);
    return outlined.toSVGString();
  } catch (e) {
    console.warn("[SvgExporter] 笔划轮廓生成失败", stroke.id, e);
    return "";
  }
}

/** 把中线路径按指定宽度描边为闭合轮廓路径（用于 eraser 镂空）。 */
function strokeCenterline(centerline: SkPath, width: number): SkPath {
  const outlined = centerline.stroke({
    width,
    cap: StrokeCap.Round,
    join: StrokeJoin.Round,
  });
  // RN Skia 的 stroke() 返回描边后的新路径；null 时回退到原路径
  return outlined ?? centerline;
}

/** 计算所有笔划的总 bbox（基于曲线控制点）与最大笔宽（用于 padding） */
function computeBBox(strokes: Stroke[]): {
  x_min: number;
  y_min: number;
  x_max: number;
  y_max: number;
  maxWidth: number;
} {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  let maxWidth = 0;
  for (const s of strokes) {
    const w = s.type === "eraser" ? s.eraser_width ?? 40 : s.style.width;
    if (w > maxWidth) maxWidth = w;
    for (const c of s.curves) {
      const xs = [c.p0[0], c.p1[0], c.p2[0], c.p3[0]];
      const ys = [c.p0[1], c.p1[1], c.p2[1], c.p3[1]];
      for (const x of xs) {
        if (x < xMin) xMin = x;
        if (x > xMax) xMax = x;
      }
      for (const y of ys) {
        if (y < yMin) yMin = y;
        if (y > yMax) yMax = y;
      }
    }
  }
  if (!isFinite(xMin)) {
    return { x_min: 0, y_min: 0, x_max: 0, y_max: 0, maxWidth: 0 };
  }
  return { x_min: xMin, y_min: yMin, x_max: xMax, y_max: yMax, maxWidth };
}

/** 导出整个 strokes 数组为 SVG 字符串 */
export function exportSVG(
  strokes: Stroke[],
  options: ExportSVGOptions = {},
): string {
  const sorted = [...strokes].sort((a, b) => a.ts - b.ts);
  const inkPaths: string[] = [];
  const eraserPaths: string[] = [];

  for (const s of sorted) {
    const d = strokeToContourD(s);
    if (d === "") continue;
    if (s.type === "ink") {
      inkPaths.push(d);
    } else {
      eraserPaths.push(d);
    }
  }

  const fillColor = options.fillColor ?? "#1a1a1a";

  let width = options.width ?? 0;
  let height = options.height ?? 0;
  let viewBoxX = 0;
  let viewBoxY = 0;
  if (width === 0 || height === 0) {
    const bbox = computeBBox(strokes);
    // padding 需覆盖轮廓相对中线外扩的半宽
    const pad = 16 + Math.ceil(bbox.maxWidth / 2);
    viewBoxX = Math.floor(bbox.x_min - pad);
    viewBoxY = Math.floor(bbox.y_min - pad);
    const w = Math.ceil(bbox.x_max - bbox.x_min + pad * 2);
    const h = Math.ceil(bbox.y_max - bbox.y_min + pad * 2);
    if (width === 0) width = w;
    if (height === 0) height = h;
  }

  // ink 外路径在前，eraser 内路径在后，evenodd 抠孔
  const allD = [...inkPaths, ...eraserPaths].join(" ");

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="${viewBoxX} ${viewBoxY} ${width} ${height}" ` +
    `width="${width}" height="${height}">` +
    `<path d="${allD}" fill="${fillColor}" fill-rule="evenodd" />` +
    `</svg>`
  );
}

/** 仅导出 ink 笔划（无 eraser 镂空） */
// fix(P1-1): exported but currently unused — kept for future use
export function exportInkOnlySVG(
  strokes: Stroke[],
  options: ExportSVGOptions = {},
): string {
  return exportSVG(
    strokes.filter((s) => s.type === "ink"),
    options,
  );
}
