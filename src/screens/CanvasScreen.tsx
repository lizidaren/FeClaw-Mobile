/**
 * 画布全屏页
 *
 * 组合：
 * - ZentrimCanvas（Skia 画布主体，三层渲染）
 * - CanvasToolbar（左侧竖排工具栏：笔/橡皮/拍照/撤销）
 * - DraftToggle（左下角草稿纸按钮）
 * - ThreeDotMenu（右上角 ⋮ 菜单）
 * - RecordingBubble（录音/回放气泡，按需显示）
 * - 颜色面板（笔模式双击弹出）
 * - PdfImportDialog（插入文件时弹出）
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { launchCamera } from "react-native-image-picker";
import { ZentrimCanvas } from "../canvas/ZentrimCanvas";
import type { CanvasEngine, ToolMode } from "../canvas/CanvasEngine";
import type {
  CanvasImage,
  PageMetadata,
  Stroke,
} from "../canvas/types";
import { screenToDoc } from "../canvas/ViewportManager";
import { CanvasToolbar } from "../components/CanvasToolbar";
import { DraftToggle } from "../components/DraftToggle";
import { ThreeDotMenu, type CanvasInfo } from "../components/ThreeDotMenu";
import { RecordingBubble, type RecordingMode } from "../components/RecordingBubble";
import { PdfImportDialog, type PdfPage } from "../components/PdfImportDialog";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { COLOR_PANEL_TITLE } from "../constants/strings";

/** 预设墨水颜色 */
const INK_COLORS = [
  "#1a1a1a",
  "#d32f2f",
  "#1976d2",
  "#388e3c",
  "#f57c00",
  "#7b1fa2",
];

export interface CanvasScreenProps {
  pageId?: string;
  strokes?: Stroke[];
  images?: CanvasImage[];
  metadata?: PageMetadata;
  info?: CanvasInfo;
  /** 录音/回放气泡状态（不传则不显示） */
  recording?: {
    mode: RecordingMode;
    seconds: number;
    asrReady?: boolean;
  };
  /** 插入文件（PDF）时可展示的页面列表；空则对话框只提供“放个链接” */
  pdfPages?: PdfPage[];
  pdfFileName?: string;
  onSaveSvg?: (svg: string) => void;
}

/** 默认元数据（用于 standalone / dev 入口） */
const DEFAULT_METADATA: PageMetadata = {
  first_stroke_at: 0,
  last_modified_at: 0,
  content_bbox: { x_min: 0, y_min: 0, x_max: 0, y_max: 0 },
  device_resolution: { width: 0, height: 0 },
};

/** 默认 CanvasInfo（用于 standalone / dev 入口） */
const DEFAULT_INFO: CanvasInfo = {
  createdAt: 0,
  device: "Unknown",
  viewCount: 0,
  editMinutes: 0,
};

export function CanvasScreen({
  pageId = "default_page",
  strokes = [],
  images: initialImages = [],
  metadata = DEFAULT_METADATA,
  info = DEFAULT_INFO,
  recording,
  pdfPages = [],
  pdfFileName = "document.pdf",
  onSaveSvg,
}: CanvasScreenProps) {
  const { width, height } = useWindowDimensions();
  const engineRef = useRef<CanvasEngine | null>(null);

  const [activeTool, setActiveTool] = useState<ToolMode>("ink");
  const [canUndo, setCanUndo] = useState(false);
  const [isDraft, setIsDraft] = useState(false);
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [images, setImages] = useState<CanvasImage[]>(initialImages);

  // 订阅引擎状态变化，同步工具栏 UI（引擎由 ZentrimCanvas 创建，子 effect 先于本 effect 运行）
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const sync = () => {
      setActiveTool(eng.getTool());
      setCanUndo(eng.canUndo());
      setIsDraft(eng.isDraftModeOn());
    };
    const unsub = eng.subscribe(sync);
    sync();
    return unsub;
  }, [pageId]);

  // ── 工具栏回调 ──

  const handleSelectTool = useCallback((tool: ToolMode) => {
    engineRef.current?.setTool(tool);
    setActiveTool(tool);
  }, []);

  const handlePenDoubleTap = useCallback(() => {
    setColorPanelOpen(true);
  }, []);

  const handleUndo = useCallback(() => {
    engineRef.current?.undo();
    setCanUndo(engineRef.current?.canUndo() ?? false);
  }, []);

  const handleToggleDraft = useCallback(() => {
    const on = engineRef.current?.toggleDraft() ?? false;
    setIsDraft(on);
  }, []);

  const handleSelectColor = useCallback((color: string) => {
    engineRef.current?.setInkColor(color);
    setInkColor(color);
    setColorPanelOpen(false);
  }, []);

  // ── 拍照 → 作为图片元素插入画布 ──
  const handlePhotoCapture = useCallback(async () => {
    try {
      const result = await launchCamera({
        mediaType: "photo",
        quality: 0.9,
        saveToPhotos: false,
      });
      if (result.didCancel) return;
      if (result.errorCode) {
        console.warn("[CanvasScreen] 拍照失败", result.errorCode, result.errorMessage);
        return;
      }
      const asset = result.assets?.[0];
      if (!asset?.uri) {
        console.warn("[CanvasScreen] 拍照返回空资源");
        return;
      }
      const eng = engineRef.current;
      const vp = eng?.getViewport() ?? { offsetX: 0, offsetY: 0, scale: 1 };
      // 放到当前视口中心，按屏幕宽度 60% 定尺寸
      const targetScreenW = width * 0.6;
      const aspect = asset.height && asset.width ? asset.height / asset.width : 0.75;
      const targetScreenH = targetScreenW * aspect;
      const topLeft = screenToDoc(
        (width - targetScreenW) / 2,
        (height - targetScreenH) / 2,
        vp,
      );
      const newImage: CanvasImage = {
        id: `img_${Date.now().toString(36)}`,
        source: asset.uri,
        x: topLeft.x,
        y: topLeft.y,
        width: targetScreenW / vp.scale,
        height: targetScreenH / vp.scale,
        rotation: 0,
        zIndex: 0,
      };
      setImages((prev) => [...prev, newImage]);
    } catch (e) {
      console.warn("[CanvasScreen] launchCamera 异常", e);
    }
  }, [width, height]);

  // ── ⋮ 菜单回调 ──

  const handleExportSvg = useCallback(() => {
    const svg = engineRef.current?.exportSVG() ?? "";
    if (svg) onSaveSvg?.(svg);
  }, [onSaveSvg]);

  const handleExportPng = useCallback(() => {
    // PNG 导出：对持久层快照编码。此处交由上层实现，仅记录。
    console.warn("[CanvasScreen] PNG 导出尚未接线到上层保存逻辑");
  }, []);

  const handleChangeTimeline = useCallback(() => {
    console.warn("[CanvasScreen] 更改所属时间线：待接入时间线选择");
  }, []);

  const handleInsertFile = useCallback(() => {
    setPdfOpen(true);
  }, []);

  const handleAttachLink = useCallback(() => {
    console.warn("[CanvasScreen] PDF 作为链接附件：待接入附件存储");
  }, []);

  const handleExpandPdf = useCallback(
    (pageIndices: number[]) => {
      const eng = engineRef.current;
      const vp = eng?.getViewport() ?? { offsetX: 0, offsetY: 0, scale: 1 };
      // 把选中页面缩略图作为图片竖向排布插入
      const pageW = width * 0.7;
      let cursorScreenY = height * 0.1;
      const newImages: CanvasImage[] = [];
      for (const idx of pageIndices) {
        const page = pdfPages.find((p) => p.index === idx);
        if (!page) continue;
        const pageH = pageW * 1.414; // A4 近似
        const topLeft = screenToDoc((width - pageW) / 2, cursorScreenY, vp);
        newImages.push({
          id: `pdf_${idx}_${Date.now().toString(36)}`,
          source: page.thumbnail,
          x: topLeft.x,
          y: topLeft.y,
          width: pageW / vp.scale,
          height: pageH / vp.scale,
          rotation: 0,
          zIndex: 0,
        });
        cursorScreenY += pageH + 24;
      }
      if (newImages.length > 0) {
        setImages((prev) => [...prev, ...newImages]);
      }
    },
    [pdfPages, width, height],
  );

  const colorSwatches = useMemo(
    () =>
      INK_COLORS.map((c) => (
        <TouchableOpacity
          key={c}
          style={[
            styles.swatch,
            { backgroundColor: c },
            c === inkColor && styles.swatchActive,
          ]}
          onPress={() => handleSelectColor(c)}
          accessibilityRole="button"
          accessibilityLabel={`选择颜色 ${c}`}
        />
      )),
    [inkColor, handleSelectColor],
  );

  // fix(P1-6): ErrorBoundary 捕获渲染异常，防止白屏崩溃
  return (
    <ErrorBoundary fallbackMessage="画布页面渲染出错">
      <View style={styles.root}>
        <ZentrimCanvas
          pageId={pageId}
          strokes={strokes}
          images={images}
          metadata={metadata}
          screenSize={{ width, height }}
          engineRef={engineRef}
        />

        <CanvasToolbar
          activeTool={activeTool}
          canUndo={canUndo}
          onSelectTool={handleSelectTool}
          onPenDoubleTap={handlePenDoubleTap}
          onPhotoCapture={handlePhotoCapture}
          onUndo={handleUndo}
        />

        <DraftToggle isDraft={isDraft} onToggle={handleToggleDraft} />

        <ThreeDotMenu
          info={info}
          onChangeTimeline={handleChangeTimeline}
          onExportSvg={handleExportSvg}
          onExportPng={handleExportPng}
          onInsertFile={handleInsertFile}
        />

        {recording ? (
          <RecordingBubble
            mode={recording.mode}
            seconds={recording.seconds}
            asrReady={recording.asrReady}
          />
        ) : null}

        {/* 颜色面板 */}
        <Modal
          visible={colorPanelOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setColorPanelOpen(false)}
        >
          <Pressable style={styles.colorBackdrop} onPress={() => setColorPanelOpen(false)} />
          <View style={styles.colorPanel}>
            {/* fix(P1-2): 使用常量替代硬编码字符串 */}
            <Text style={styles.colorTitle}>{COLOR_PANEL_TITLE}</Text>
            <View style={styles.swatchRow}>{colorSwatches}</View>
          </View>
        </Modal>

        {/* PDF 导入 */}
        <PdfImportDialog
          visible={pdfOpen}
          fileName={pdfFileName}
          pages={pdfPages}
          onClose={() => setPdfOpen(false)}
          onAttachLink={handleAttachLink}
          onExpandToCanvas={handleExpandPdf}
        />
      </View>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  colorBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  colorPanel: {
    position: "absolute",
    left: 80,
    top: "35%",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  colorTitle: {
    fontSize: 13,
    color: "#666",
    marginBottom: 10,
  },
  swatchRow: {
    flexDirection: "row",
  },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginHorizontal: 5,
    borderWidth: 2,
    borderColor: "transparent",
  },
  swatchActive: {
    borderColor: "#333",
  },
});
