/**
 * Curio 画布类型定义
 *
 * 文档坐标系使用 Int32（±21 亿），锚定在创建设备分辨率 × 4。
 * 屏幕坐标系使用 Float32，由 Viewport 缩放/平移得到。
 */

/** 文档坐标系点（Int32 范围） */
export type DocCoord = [number, number];

/** 贝塞尔曲线段（p0..p3 + 采样点压力） */
export interface BezierCurve {
  p0: DocCoord;
  p1: DocCoord;
  p2: DocCoord;
  p3: DocCoord;
  samples: Array<{ t: number; pressure: number }>;
}

/** 笔划 */
export interface Stroke {
  id: string; // ULID
  type: "ink" | "eraser";
  /** 相对 first_stroke_at 的偏移（ms） */
  ts: number;
  curves: BezierCurve[];
  style: {
    /** hex #rrggbb */
    color: string;
    /** px float */
    width: number;
  };
  /** eraser 专属（ink 笔划不设） */
  eraser_width?: number;
}

/** 画布图片元素 */
export interface CanvasImage {
  id: string;
  /** URL 或本地路径 */
  source: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
}

/** 文档元数据 */
export interface PageMetadata {
  first_stroke_at: number;
  last_modified_at: number;
  content_bbox: {
    x_min: number;
    y_min: number;
    x_max: number;
    y_max: number;
  };
  device_resolution: { width: number; height: number };
  /** base64 webp */
  thumbnail?: string;
}

/** 画布文档 */
export interface PageData {
  version: number;
  id: string;
  strokes: Stroke[];
  images: CanvasImage[];
  metadata: PageMetadata;
}

/** 视口（当前屏幕显示范围） */
export interface Viewport {
  offsetX: number;
  offsetY: number;
  /** 0.25 ~ 4.0 */
  scale: number;
}

/** 撤销命令（add_stroke：撤销时把这一笔从画布上移除） */
export interface Command {
  type: "add_stroke";
  stroke: Stroke;
}

/** 画布事件回调 */
export interface CanvasCallbacks {
  onStrokeAdd: (stroke: Stroke) => void;
  onSave: (page: PageData) => void;
  onPhotoCapture: () => void;
  onFileInsert: () => void;
  onUndo: () => void;
  onToggleDraft: () => void;
  onOpenMenu: () => void;
}