/**
 * Curio 画布主组件（React 端唯一入口）
 *
 * 职责：
 * - 创建 Skia Canvas，显示三层：
 *     ① Image Layer（照片/PDF/图片元素，最底层）
 *     ② Persistent Layer（已确认笔划的离屏 Surface 快照，含 eraser 抠孔）
 *     ③ Overlay Layer（用户当前正在画的笔划）
 * - 冷启动期先显示缩略图，Surface 就绪后切换为 persistentImage
 * - 处理触摸/笔手势
 *   - 单指/笔 → 笔划事件（在文档坐标系存储）
 *   - 双指 → 平移 / 缩放视口
 * - 把 UI 事件转发给 CanvasEngine
 *
 * 注意：本组件是 canvas/ 下唯一的 React 文件。其他 canvas/* 都是纯 TS。
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  Canvas,
  Group,
  Image as SkiaImage,
  Path,
  useCanvasRef,
  useImage,
} from "@shopify/react-native-skia";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import type { EngineEvent } from "./CanvasEngine";
import { CanvasEngine } from "./CanvasEngine";
import { buildContourPath, curvesToPath } from "./ContourBuilder";
import { screenToDoc } from "./ViewportManager";
import type {
  BezierCurve,
  CanvasImage,
  PageData,
  PageMetadata,
  Stroke,
  Viewport,
} from "./types";

/** 组件 Props */
export interface ZentrimCanvasProps {
  pageId: string;
  strokes: Stroke[];
  /** 图片元素（Image Layer，渲染在笔划之下） */
  images?: CanvasImage[];
  metadata: PageMetadata;
  /** 屏幕尺寸（用于计算视口和持久层 Surface 尺寸） */
  screenSize: { width: number; height: number };
  onStrokeAdd?: (stroke: Stroke) => void;
  onSave?: (page: PageData) => void;
  onPhotoCapture?: () => void;
  onFileInsert?: () => void;
  onUndo?: () => void;
  onToggleDraft?: () => void;
  onOpenMenu?: () => void;
  /** 外部持有的引擎引用（供工具栏等外部组件调用） */
  engineRef?: React.MutableRefObject<CanvasEngine | null>;
}

/** 当前绘制中的笔划状态 */
interface InProgressStroke {
  stroke: Stroke;
  /** 文档坐标系累积点 */
  points: Array<{ x: number; y: number; pressure: number; t: number }>;
}

export function ZentrimCanvas({
  pageId,
  strokes: initialStrokes,
  images,
  metadata,
  screenSize,
  onStrokeAdd,
  engineRef: externalEngineRef,
}: ZentrimCanvasProps) {
  const canvasRef = useCanvasRef();
  const internalEngineRef = useRef<CanvasEngine | null>(null);
  // 兼容外部传入的 engineRef
  const engineRef = externalEngineRef ?? internalEngineRef;

  // 强制 re-render 用：当引擎状态变化时递增
  const [version, setVersion] = useState(0);
  const [viewport, setViewport] = useState<Viewport>({
    offsetX: 0,
    offsetY: 0,
    scale: 1.0,
  });
  const [isColdStarting, setIsColdStarting] = useState(true);
  const [isDraftMode, setIsDraftMode] = useState(false);

  // 当前正在画的笔划
  const [inProgress, setInProgress] = useState<InProgressStroke | null>(null);

  // 视口 ref（供手势回调读取，规避 React state 闭包旧值问题）
  const viewportRef = useRef(viewport);
  useEffect(() => {
    viewportRef.current = viewport;
  }, [viewport]);

  // inProgress ref（供 onEnd 读取最新值）
  const inProgressRef = useRef<InProgressStroke | null>(null);
  useEffect(() => {
    inProgressRef.current = inProgress;
  }, [inProgress]);

  // 初始化引擎
  useEffect(() => {
    const engine = new CanvasEngine();
    engineRef.current = engine;
    const unsub = engine.subscribe((event: EngineEvent) => {
      switch (event.type) {
        case "viewport":
          setViewport(event.viewport);
          break;
        case "coldstart":
          setIsColdStarting(event.isColdStarting);
          break;
        case "draft":
          setIsDraftMode(event.isDraftMode);
          break;
        case "strokes":
        case "images":
        case "tool":
        default:
          break;
      }
      setVersion((v) => v + 1);
    });
    engine.init({
      version: 1,
      id: pageId,
      strokes: initialStrokes,
      images: images ?? [],
      metadata,
    });
    return () => {
      unsub();
      engine.dispose();
      engineRef.current = null;
    };
    // 仅当 pageId 变化时重新初始化
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId]);

  // 拿到屏幕尺寸后创建/重建持久层 Surface（结束冷启动）
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || screenSize.width <= 0 || screenSize.height <= 0) return;
    // 让首帧先显示缩略图，下一个 tick 再构建 Surface
    const id = setTimeout(() => {
      const e = engineRef.current;
      if (!e) return;
      e.ensureSurface(screenSize.width, screenSize.height);
    }, 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageId, screenSize.width, screenSize.height]);

  // ── 手势 ──

  /** 双指平移 */
  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minPointers(2)
        .onUpdate((e) => {
          const eng = engineRef.current;
          if (!eng) return;
          const vp = eng.getViewport();
          // 屏幕像素增量 → 文档坐标增量（除以 scale）
          const newVp: Viewport = {
            offsetX: vp.offsetX - e.translationX / vp.scale,
            offsetY: vp.offsetY - e.translationY / vp.scale,
            scale: vp.scale,
          };
          eng.setViewport(newVp);
        }),
    [engineRef],
  );

  /**
   * 单指/笔绘画手势。所有坐标在采集时即转换为文档坐标存储，
   * 渲染时再由 buildContourPath / curvesToPath 应用视口变换回屏幕坐标。
   */
  const drawingGesture = useMemo(
    () =>
      Gesture.Pan()
        .minPointers(1)
        .maxPointers(1)
        .minDistance(0)
        .onBegin((e) => {
          const eng = engineRef.current;
          if (!eng) return;
          const tool = eng.getTool();
          const doc = screenToDoc(e.x, e.y, viewportRef.current);
          const baseWidth =
            tool === "eraser" ? eng.getEraserWidth() : eng.getInkWidth();
          const baseColor = eng.getInkColor();
          const newStroke: Stroke = {
            id: makeUlid(),
            type: tool,
            ts: Date.now(),
            curves: [],
            style:
              tool === "ink"
                ? { color: baseColor, width: baseWidth }
                : { color: "#000000", width: 0 },
            ...(tool === "eraser" ? { eraser_width: baseWidth } : {}),
          };
          const pressure = (e as { pressure?: number }).pressure ?? 0.5;
          setInProgress({
            stroke: newStroke,
            points: [{ x: doc.x, y: doc.y, pressure, t: 0 }],
          });
        })
        .onUpdate((e) => {
          const eng = engineRef.current;
          if (!eng) return;
          const doc = screenToDoc(e.x, e.y, viewportRef.current);
          const pressure = (e as { pressure?: number }).pressure ?? 0.5;
          setInProgress((prev) => {
            if (!prev) return prev;
            const nextPoints = [
              ...prev.points,
              { x: doc.x, y: doc.y, pressure, t: prev.points.length },
            ];
            return {
              stroke: { ...prev.stroke, curves: pointsToCurves(nextPoints) },
              points: nextPoints,
            };
          });
        })
        .onEnd(() => {
          const eng = engineRef.current;
          const current = inProgressRef.current;
          if (!eng || !current) return;
          // 至少需要一段曲线
          if (current.stroke.curves.length > 0) {
            eng.addStroke(current.stroke);
            onStrokeAdd?.(current.stroke);
          }
          setInProgress(null);
        })
        .onFinalize(() => {
          setInProgress(null);
        }),
    [engineRef, onStrokeAdd],
  );

  /** 双指缩放（围绕焦点） */
  // fix: scaleChange 仅在 onChange 回调中（Pin change event payload），
  // onUpdate 只有 scale（累计值）。这里需要每帧的 scaleChange，所以改用 onChange。
  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch().onChange((e) => {
        const eng = engineRef.current;
        if (!eng) return;
        const vp = eng.getViewport();
        const nextScale = Math.min(4.0, Math.max(0.25, vp.scale * e.scaleChange));
        // 围绕焦点缩放：保持焦点处的文档坐标不变
        const docAnchorX = e.focalX / vp.scale + vp.offsetX;
        const docAnchorY = e.focalY / vp.scale + vp.offsetY;
        const newVp: Viewport = {
          offsetX: docAnchorX - e.focalX / nextScale,
          offsetY: docAnchorY - e.focalY / nextScale,
          scale: nextScale,
        };
        eng.setViewport(newVp);
      }),
    [engineRef],
  );

  const composedGesture = useMemo(
    () =>
      Gesture.Race(
        drawingGesture,
        Gesture.Simultaneous(panGesture, pinchGesture),
      ),
    [drawingGesture, panGesture, pinchGesture],
  );

  // ── 派生渲染数据 ──

  // 持久层快照与缩略图（引擎持有；version 变化触发重读）
  const eng = engineRef.current;
  const persistentImage = eng?.getPersistentImage() ?? null;
  const thumbnailImage = eng?.getThumbnailImage() ?? null;
  // 引用 version 以在引擎状态变化时刷新以上快照
  void version;

  const inProgressPath = useMemo(() => {
    if (!inProgress) return null;
    if (inProgress.stroke.type === "ink") {
      return buildContourPath(inProgress.stroke, viewport);
    }
    return curvesToPath(inProgress.stroke.curves, viewport);
  }, [inProgress, viewport]);

  // ── 渲染 ──

  return (
    <View style={styles.container}>
      <GestureDetector gesture={composedGesture}>
        <Canvas
          ref={canvasRef}
          style={{ width: screenSize.width, height: screenSize.height }}
        >
          <Group>
            {/* ① Image Layer（zIndex=0，最底层） */}
            {images?.map((img) => (
              <CanvasImageNode key={img.id} img={img} viewport={viewport} />
            ))}

            {/* ② Persistent Layer / 冷启动缩略图 */}
            {isColdStarting && thumbnailImage ? (
              <SkiaImage
                image={thumbnailImage}
                x={0}
                y={0}
                width={screenSize.width}
                height={screenSize.height}
                fit="contain"
              />
            ) : persistentImage ? (
              <SkiaImage
                image={persistentImage}
                x={0}
                y={0}
                width={screenSize.width}
                height={screenSize.height}
                fit="fill"
              />
            ) : null}

            {/* ③ Overlay Layer：当前正在画的笔划 */}
            {inProgress && inProgressPath ? (
              inProgress.stroke.type === "ink" ? (
                <Path
                  path={inProgressPath}
                  color={inProgress.stroke.style.color}
                  opacity={isDraftMode ? 0.5 : 1}
                  style="fill"
                />
              ) : (
                <Path
                  path={inProgressPath}
                  color="#000000"
                  style="stroke"
                  strokeWidth={
                    (inProgress.stroke.eraser_width ?? 40) * viewport.scale
                  }
                  strokeCap="round"
                  strokeJoin="round"
                  blendMode="dstOut"
                />
              )
            ) : null}
          </Group>
        </Canvas>
      </GestureDetector>
    </View>
  );
}

/**
 * 单张图片节点（Image Layer）。
 * 用 useImage 异步解码图片源（URL / base64 data URI）。
 */
function CanvasImageNode({
  img,
  viewport,
}: {
  img: CanvasImage;
  viewport: Viewport;
}) {
  const skImage = useImage(img.source);
  if (!skImage) return null;
  // 文档坐标 → 屏幕坐标（docToScreen）
  const x = (img.x - viewport.offsetX) * viewport.scale;
  const y = (img.y - viewport.offsetY) * viewport.scale;
  const w = img.width * viewport.scale;
  const h = img.height * viewport.scale;
  return <SkiaImage image={skImage} x={x} y={y} width={w} height={h} fit="fill" />;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
});

// ─────────── Helpers ───────────

/** ULID 简化版（可时间排序的 ID） */
function makeUlid(): string {
  const time = Date.now().toString(36).padStart(10, "0").toUpperCase();
  const rand = Math.random().toString(36).slice(2, 12).padStart(12, "0").toUpperCase();
  return time + rand;
}

/**
 * 把文档坐标点列表转换为贝塞尔曲线段。
 * 点已是文档坐标（在手势回调中经 screenToDoc 转换），此处不再做坐标转换。
 * 简化策略：用相邻 4 点构造三次贝塞尔。
 */
function pointsToCurves(
  points: Array<{ x: number; y: number; pressure: number; t: number }>,
): BezierCurve[] {
  if (points.length < 2) return [];
  const curves: BezierCurve[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i];
    const p1 = points[Math.min(i + 1, points.length - 1)];
    const p2 = points[Math.min(i + 2, points.length - 1)];
    const p3 = points[Math.min(i + 3, points.length - 1)];

    curves.push({
      p0: [p0.x, p0.y],
      p1: [p1.x, p1.y],
      p2: [p2.x, p2.y],
      p3: [p3.x, p3.y],
      samples: [{ t: 0.5, pressure: p1.pressure }],
    });
  }
  return curves;
}
