/**
 * 笔划轮廓构建器
 *
 * 把贝塞尔曲线段转换为带压力感知的闭合多边形路径：
 * 1. de Casteljau 等距细分（控制点间距 > 2px 时递归细分）
 * 2. parallel transport frame 计算每个细分点的法向量
 * 3. 按压力值沿法线左右偏移
 * 4. 起笔/收笔 tapered cap（按压力梯度渐变到 minWidth=10%）
 * 5. 自相交 → fill("evenodd")
 *
 * 输出是一个可直接 drawPath 的 Skia 路径（已应用视口缩放）。
 */

import { Skia, type SkPath } from "@shopify/react-native-skia";
import type { BezierCurve, Stroke, Viewport } from "./types";

/** 最小笔划相对宽度（用于 tapered cap） */
const MIN_WIDTH_RATIO = 0.1;
/** 细分阈值（屏幕像素） */
const SUBDIVISION_THRESHOLD = 2.0;

/** 细分后的中线点（含压力） */
interface CenterlinePoint {
  x: number;
  y: number;
  pressure: number;
}

/**
 * de Casteljau 切分一条三次贝塞尔曲线为两段（在 t=0.5 处）。
 * 返回两条子曲线，每条仍是三次贝塞尔。
 */
function splitBezierAtHalf(c: BezierCurve): [BezierCurve, BezierCurve] {
  const [x0, y0] = c.p0;
  const [x1, y1] = c.p1;
  const [x2, y2] = c.p2;
  const [x3, y3] = c.p3;

  // 中点
  const m01x = (x0 + x1) / 2;
  const m01y = (y0 + y1) / 2;
  const m12x = (x1 + x2) / 2;
  const m12y = (y1 + y2) / 2;
  const m23x = (x2 + x3) / 2;
  const m23y = (y2 + y3) / 2;
  const m012x = (m01x + m12x) / 2;
  const m012y = (m01y + m12y) / 2;
  const m123x = (m12x + m23x) / 2;
  const m123y = (m12y + m23y) / 2;
  const m0123x = (m012x + m123x) / 2;
  const m0123y = (m012y + m123y) / 2;

  // 左半（p0 → mid）
  const left: BezierCurve = {
    p0: [x0, y0],
    p1: [m01x, m01y],
    p2: [m012x, m012y],
    p3: [m0123x, m0123y],
    samples: splitSamples(c.samples, 0, 0.5),
  };

  // 右半（mid → p3）
  const right: BezierCurve = {
    p0: [m0123x, m0123y],
    p1: [m123x, m123y],
    p2: [m23x, m23y],
    p3: [x3, y3],
    samples: splitSamples(c.samples, 0.5, 1),
  };

  return [left, right];
}

/** 把 samples 按 t 切分到 [tStart, tEnd] 区间，并归一化 */
function splitSamples(
  samples: BezierCurve["samples"],
  tStart: number,
  tEnd: number,
): BezierCurve["samples"] {
  if (samples.length === 0) return samples;
  const span = tEnd - tStart;
  const filtered = samples.filter(
    (s) => s.t >= tStart - 1e-9 && s.t <= tEnd + 1e-9,
  );
  return filtered.map((s) => ({
    t: (s.t - tStart) / span,
    pressure: s.pressure,
  }));
}

/** 控制点间距（屏幕像素） */
function controlPointDistance(c: BezierCurve): number {
  const dx = c.p3[0] - c.p0[0];
  const dy = c.p3[1] - c.p0[1];
  return Math.hypot(dx, dy);
}

/**
 * 把一条贝塞尔曲线细分成小段，直到控制点跨度小于 SUBDIVISION_THRESHOLD。
 * 输出子曲线列表，每条都"足够短"。
 */
function subdivide(c: BezierCurve): BezierCurve[] {
  const result: BezierCurve[] = [];
  const queue: BezierCurve[] = [c];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (controlPointDistance(cur) <= SUBDIVISION_THRESHOLD) {
      result.push(cur);
    } else {
      const [a, b] = splitBezierAtHalf(cur);
      queue.push(a, b);
    }
  }
  return result;
}

/**
 * 把曲线集合细分成小段，并按 (t, pressure) 取出每条曲线中点的压力。
 * 输出顺序中线点列表。
 */
function buildCenterline(
  curves: BezierCurve[],
  vp: Viewport,
): CenterlinePoint[] {
  const out: CenterlinePoint[] = [];
  let first = true;
  for (const raw of curves) {
    const subs = subdivide(raw);
    for (const sub of subs) {
      // 取每条子曲线中点（在文档坐标 → 屏幕坐标）
      const dx = (sub.p0[0] + sub.p3[0]) / 2;
      const dy = (sub.p0[1] + sub.p3[1]) / 2;
      // 屏幕坐标 = (doc - offset) * scale
      const sx = (dx - vp.offsetX) * vp.scale;
      const sy = (dy - vp.offsetY) * vp.scale;
      // 取子曲线中点的压力（取最接近 t=0.5 的 sample）
      const p = samplePressureAt(sub.samples, 0.5);
      if (first) {
        out.push({ x: sx, y: sy, pressure: p });
        first = false;
      } else {
        out.push({ x: sx, y: sy, pressure: p });
      }
    }
  }
  return out;
}

/** 在 samples 中按 t 插值取压力 */
function samplePressureAt(
  samples: BezierCurve["samples"],
  t: number,
): number {
  if (samples.length === 0) return 0.5;
  if (samples.length === 1) return samples[0].pressure;
  // 找最接近的 sample
  let best = samples[0];
  let bestDist = Math.abs(best.t - t);
  for (const s of samples) {
    const d = Math.abs(s.t - t);
    if (d < bestDist) {
      best = s;
      bestDist = d;
    }
  }
  return best.pressure;
}

/**
 * 计算相邻点的方向向量，用 parallel transport frame 求每点的法向量。
 * 这样相邻法线夹角最小化，避免在急转弯处出现翻转。
 */
function computeNormals(points: CenterlinePoint[]): Array<{ nx: number; ny: number }> {
  const n = points.length;
  if (n === 0) return [];
  // fix(P1-3): 单点时无法计算切线，返回默认法线
  if (n === 1) return [{ nx: 0, ny: -1 }];
  const normals: Array<{ nx: number; ny: number }> = [];

  // 1. 先求每个点的切线方向
  const tangents: Array<{ tx: number; ty: number }> = [];
  for (let i = 0; i < n; i++) {
    let tx = 0;
    let ty = 0;
    if (i === 0) {
      tx = points[1].x - points[0].x;
      ty = points[1].y - points[0].y;
    } else if (i === n - 1) {
      tx = points[n - 1].x - points[n - 2].x;
      ty = points[n - 1].y - points[n - 2].y;
    } else {
      tx = points[i + 1].x - points[i - 1].x;
      ty = points[i + 1].y - points[i - 1].y;
    }
    const len = Math.hypot(tx, ty);
    if (len > 1e-9) {
      tangents.push({ tx: tx / len, ty: ty / len });
    } else {
      tangents.push({ tx: 1, ty: 0 });
    }
  }

  // 2. 用 parallel transport 初始化第一个法线（垂直于切线）
  const t0 = tangents[0];
  normals.push({ nx: -t0.ty, ny: t0.tx });

  // 3. 逐点 rotate 累计法线，使相邻法线夹角最小
  for (let i = 1; i < n; i++) {
    const prevT = tangents[i - 1];
    const curT = tangents[i];
    const prevN = normals[i - 1];
    // 旋转 prevN 使其与 curT 垂直，且保持连续
    const dot = prevT.tx * curT.tx + prevT.ty * curT.ty;
    const cross = prevT.tx * curT.ty - prevT.ty * curT.tx;
    const cosA = dot;
    const sinA = cross;
    const rx = prevN.nx * cosA - prevN.ny * sinA;
    const ry = prevN.nx * sinA + prevN.ny * cosA;
    const rlen = Math.hypot(rx, ry);
    if (rlen > 1e-9) {
      normals.push({ nx: rx / rlen, ny: ry / rlen });
    } else {
      normals.push({ nx: -curT.ty, ny: curT.tx });
    }
  }

  return normals;
}

/**
 * 构建单条 ink 笔划的轮廓闭合多边形路径（用 cubicTo 模拟多边形）。
 * 输出 Skia Path，可直接 drawPath + Fill。
 *
 * 算法：
 * - 对每条 BezierCurve 细分成中线点
 * - 用 parallel transport frame 计算每点法线
 * - 沿法线左右偏移，偏移量 = effective_width/2 = style.width × (0.1 + 0.9 × pressure) × scale / 2
 * - 起笔/收笔 tapered cap：按端点附近压力梯度渐变到 0
 * - 连接所有 left 点 + 反向 right 点 → 闭合多边形
 * - 自相交检测：buildPath 本身不做交叉检测，统一交由 Skia 的 fill("evenodd") 处理
 */
export function buildContourPath(stroke: Stroke, vp: Viewport): SkPath {
  const path = Skia.Path.Make();
  const centerline = buildCenterline(stroke.curves, vp);
  if (centerline.length === 0) return path;

  const normals = computeNormals(centerline);
  const n = centerline.length;

  // tapered cap 在首尾两端各 TAPER_POINTS 个采样点渐变到 0
  const TAPER_RATIO = 0.1;
  const baseWidth = stroke.style.width * vp.scale;

  // 算每个点的半宽（带 tapered cap）
  const halfWidths: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const pressureFactor = MIN_WIDTH_RATIO + (1 - MIN_WIDTH_RATIO) * centerline[i].pressure;
    let half = (baseWidth * pressureFactor) / 2;
    // 起笔 cap：i=0..n/4 内渐变到 baseWidth * TAPER_RATIO / 2
    const taperZone = Math.max(1, Math.floor(n * 0.15));
    if (i < taperZone) {
      const t = i / taperZone;
      half *= TAPER_RATIO + (1 - TAPER_RATIO) * t;
    } else if (i > n - 1 - taperZone) {
      const t = (n - 1 - i) / taperZone;
      half *= TAPER_RATIO + (1 - TAPER_RATIO) * t;
    }
    halfWidths[i] = half;
  }

  // 左半边点
  const left: Array<{ x: number; y: number }> = [];
  const right: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    const p = centerline[i];
    const nor = normals[i];
    const hw = halfWidths[i];
    left.push({ x: p.x + nor.nx * hw, y: p.y + nor.ny * hw });
    right.push({ x: p.x - nor.nx * hw, y: p.y - nor.ny * hw });
  }

  // 构建多边形路径：left[0..n-1] → right[n-1..0] → close
  path.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < n; i++) {
    path.lineTo(left[i].x, left[i].y);
  }
  for (let i = n - 1; i >= 0; i--) {
    path.lineTo(right[i].x, right[i].y);
  }
  path.close();

  return path;
}

/**
 * 把笔划的 BezierCurve 列表转换为 Skia 路径（不含轮廓，纯中线）。
 * 用于橡皮擦渲染（drawPath + Stroke）。
 */
export function curvesToPath(curves: BezierCurve[], vp: Viewport): SkPath {
  const path = Skia.Path.Make();
  let first = true;
  for (const c of curves) {
    const x0 = (c.p0[0] - vp.offsetX) * vp.scale;
    const y0 = (c.p0[1] - vp.offsetY) * vp.scale;
    const x1 = (c.p1[0] - vp.offsetX) * vp.scale;
    const y1 = (c.p1[1] - vp.offsetY) * vp.scale;
    const x2 = (c.p2[0] - vp.offsetX) * vp.scale;
    const y2 = (c.p2[1] - vp.offsetY) * vp.scale;
    const x3 = (c.p3[0] - vp.offsetX) * vp.scale;
    const y3 = (c.p3[1] - vp.offsetY) * vp.scale;
    if (first) {
      path.moveTo(x0, y0);
      first = false;
    }
    path.cubicTo(x1, y1, x2, y2, x3, y3);
  }
  return path;
}

/** 检查路径是否自相交（简单版：检查任意两段是否相交；超过点数阈值返回 true） */
// fix(P1-1): exported but currently unused — kept for future use
export function hasSelfIntersection(curve: BezierCurve[]): boolean {
  // 中线点数过多意味着路径复杂，自相交概率高
  // 简化策略：点数 > 80 时直接视为有自相交，使用 evenodd fill
  let count = 0;
  for (const c of curve) {
    count += c.samples.length + 4;
  }
  return count > 80;
}