/**
 * 画布全屏页
 *
 * 组合：
 * - ZentrimCanvas（Skia 画布主体，三层渲染）
 * - CanvasToolbar（左侧竖排工具栏：笔/橡皮/拍照/撤销）
 * - 顶部 TextInput（flomo 风格，进入时自动 focus 唤起键盘）
 * - DraftToggle（左下角草稿纸按钮）
 * - ThreeDotMenu（右上角 ⋮ 菜单）
 * - RecordingBubble（录音/回放气泡，按需显示）
 * - 颜色面板（笔模式双击弹出）
 * - PdfImportDialog（插入文件时弹出）
 *
 * 交互协议（设计文档 §7.9）：
 * - Default：text mode（activeTool=null），键盘打开，顶部 TextInput autoFocus
 * - Pen mode：用户点工具栏笔按钮 → setActiveTool("ink") + Keyboard.dismiss()
 *   画布接管后续触摸事件，不转发当前触发按钮的 touch
 * - 切换模式只能通过工具栏按钮，不再做手指/触控笔自动检测（RN 无法可靠获取 pointerType）
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { launchCamera } from "react-native-image-picker";
import { useRoute, type RouteProp } from "@react-navigation/native";
import { ZentrimCanvas } from "../canvas/ZentrimCanvas";
import { CanvasEngine, DEFAULT_INK_COLOR, type ToolMode } from "../canvas/CanvasEngine";
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
import { api } from "../services/api-client";
import type { CanvasData } from "../types/api";
import type { RootStackParamList } from "../navigation/AppNavigator";

/** 预设墨水颜色（fix(P2-1): 首项使用 CanvasEngine 导出的 DEFAULT_INK_COLOR） */
const INK_COLORS = [
  DEFAULT_INK_COLOR,
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
  /** 插入文件（PDF）时可展示的页面列表；空则对话框只提供"放个链接" */
  pdfPages?: PdfPage[];
  pdfFileName?: string;
  onSaveSvg?: (svg: string) => void;
}

/** 从后端 CanvasBlock[] 提取 strokes（ink block 的 data.strokes 字段） */
function extractStrokes(canvasData: CanvasData): Stroke[] {
  const out: Stroke[] = [];
  for (const b of canvasData.blocks) {
    if (b.type === "ink" && b.data) {
      const strokes = (b.data as { strokes?: unknown }).strokes;
      if (Array.isArray(strokes)) {
        out.push(...(strokes as Stroke[]));
      }
    }
  }
  return out;
}

/** 从后端 CanvasBlock[] 提取 images（ink block 的 data.images 字段 + photo/image block） */
function extractImages(canvasData: CanvasData): CanvasImage[] {
  const out: CanvasImage[] = [];
  for (const b of canvasData.blocks) {
    if (b.type === "ink" && b.data) {
      const imgs = (b.data as { images?: unknown }).images;
      if (Array.isArray(imgs)) {
        out.push(...(imgs as CanvasImage[]));
      }
    } else if ((b.type === "photo" || b.type === "image") && b.data) {
      const d = b.data as Record<string, unknown>;
      const source =
        (d.thumbnail_url as string) || (d.url as string);
      if (source) {
        out.push({
          id: b.id,
          source,
          x: (d.x as number) ?? 0,
          y: (d.y as number) ?? 0,
          width: (d.width as number) ?? 200,
          height: (d.height as number) ?? 150,
          rotation: (d.rotation as number) ?? 0,
          zIndex: 0,
        });
      }
    }
  }
  return out;
}

/** 从后端 CanvasBlock[] 提取纯文本（text block 拼接） */
function extractText(canvasData: CanvasData): string {
  const texts: string[] = [];
  for (const b of canvasData.blocks) {
    if (b.type === "text" && b.text) {
      texts.push(b.text);
    }
  }
  return texts.join("\n");
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
  pageId: pageIdProp,
  strokes: propStrokes = [],
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

  // route params (entryId from navigation)
  const route = useRoute<RouteProp<RootStackParamList, "Canvas">>();
  const entryId = route.params?.entryId;

  // ── entry canvas data loading ──
  type LoadState =
    | { status: "idle" }        // no entryId → new blank canvas
    | { status: "loading" }
    | { status: "success"; data: CanvasData }
    | { status: "error"; message: string };
  const [loadState, setLoadState] = useState<LoadState>(
    entryId ? { status: "loading" } : { status: "idle" },
  );

  useEffect(() => {
    if (!entryId) {
      setLoadState({ status: "idle" });
      return;
    }
    let cancelled = false;
    setLoadState({ status: "loading" });
    api.getEntryCanvas(entryId).then((data) => {
      if (cancelled) return;
      setLoadState({ status: "success", data });
    }).catch((err: unknown) => {
      if (cancelled) return;
      const msg = err instanceof Error ? err.message : "加载失败";
      setLoadState({ status: "error", message: msg });
    });
    return () => { cancelled = true; };
  }, [entryId]);

  // 从加载到的数据派生 strokes / images / text
  const loadedStrokes = useMemo<Stroke[]>(() => {
    if (loadState.status !== "success") return [];
    return extractStrokes(loadState.data);
  }, [loadState]);

  const loadedImages = useMemo<CanvasImage[]>(() => {
    if (loadState.status !== "success") return [];
    return extractImages(loadState.data);
  }, [loadState]);

  const loadedText = useMemo<string>(() => {
    if (loadState.status !== "success") return "";
    return extractText(loadState.data);
  }, [loadState]);

  // 最终使用的 strokes / images / pageId
  const strokes = entryId ? loadedStrokes : propStrokes;
  const imagesFromData = entryId ? loadedImages : initialImages;
  const pageId = pageIdProp ?? (entryId ? `entry_${entryId}` : "default_page");

  // toolMode: null = 键盘优先（未选工具）；"ink" / "eraser" = 绘画模式
  const [activeTool, setActiveTool] = useState<ToolMode | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [isDraft, setIsDraft] = useState(false);
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [images, setImages] = useState<CanvasImage[]>(imagesFromData);

  // 顶部文字输入
  const [noteText, setNoteText] = useState(loadedText);

  // 当加载到的 images/text 变化时同步 state（entry 加载完成）
  useEffect(() => {
    if (entryId) {
      setImages(imagesFromData);
      setNoteText(loadedText);
    }
  }, [entryId, imagesFromData, loadedText]);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // 订阅引擎状态变化，同步工具栏 UI（引擎由 ZentrimCanvas 创建，子 effect 先于本 effect 运行）
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const sync = () => {
      // 引擎内部 tool 初始是 "ink"（CanvasEngine 构造默认）；
      // 我们的 activeTool 状态独立控制是否进入绘画态。
      setCanUndo(eng.canUndo());
      setIsDraft(eng.isDraftModeOn());
    };
    const unsub = eng.subscribe(sync);
    sync();
    return unsub;
  }, [pageId]);

  // 键盘事件订阅
  useEffect(() => {
    const showSub = Keyboard.addListener("keyboardDidShow", () =>
      setKeyboardVisible(true),
    );
    const hideSub = Keyboard.addListener("keyboardDidHide", () =>
      setKeyboardVisible(false),
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // ── 工具栏回调 ──

  /**
   * 用户手动选中工具：切换 toolMode，保存到引擎，并 dismiss 键盘
   * （因为用户从键盘模式切到绘画模式，意味着想画而不是写字）
   */
  const handleSelectTool = useCallback((tool: ToolMode) => {
    engineRef.current?.setTool(tool);
    setActiveTool(tool);
    Keyboard.dismiss();
  }, []);

  const handlePenDoubleTap = useCallback(() => {
    setColorPanelOpen(true);
  }, []);

  // fix(P1-5): 不在 handleUndo 里手动 setCanUndo —— 引擎订阅 sync() 会自动同步。
  // 手动设置会和订阅回调竞争，导致 UI 闪烁或状态不一致。
  const handleUndo = useCallback(() => {
    engineRef.current?.undo();
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
        cameraType: "back",
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
      const heightToWidthRatio = asset.height && asset.width ? asset.height / asset.width : 0.75;
      const targetScreenH = targetScreenW * heightToWidthRatio;
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
    // PNG 导出：待接入上层保存逻辑
  }, []);

  // fix(P2-2): 未实现的功能改为 disabled，不再 console.warn
  const handleChangeTimeline = useCallback(() => {
    // 待接入时间线选择
  }, []);

  const handleInsertFile = useCallback(() => {
    setPdfOpen(true);
  }, []);

  const handleAttachLink = useCallback(() => {
    // PDF 作为链接附件：待接入附件存储
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

  // 加载中 / 错误状态（仅 entryId 模式）
  if (loadState.status === "loading") {
    return (
      <ErrorBoundary fallbackMessage="画布页面渲染出错">
        <View style={styles.loadingRoot}>
          <ActivityIndicator size="large" color="#1976d2" />
          <Text style={styles.loadingText}>加载中...</Text>
        </View>
      </ErrorBoundary>
    );
  }

  if (loadState.status === "error") {
    return (
      <ErrorBoundary fallbackMessage="画布页面渲染出错">
        <View style={styles.loadingRoot}>
          <Text style={styles.errorText}>{loadState.message}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => {
              if (!entryId) return;
              setLoadState({ status: "loading" });
              api.getEntryCanvas(entryId).then((data) => {
                setLoadState({ status: "success", data });
              }).catch((err: unknown) => {
                const msg = err instanceof Error ? err.message : "加载失败";
                setLoadState({ status: "error", message: msg });
              });
            }}
          >
            <Text style={styles.retryText}>重试</Text>
          </TouchableOpacity>
        </View>
      </ErrorBoundary>
    );
  }

  // fix(P1-6): ErrorBoundary 捕获渲染异常，防止白屏崩溃
  return (
    <ErrorBoundary fallbackMessage="画布页面渲染出错">
      {/* fix(P1-1): Android 用 "height"，iOS 用 "padding"（Android 下 "padding" 会跳跃） */}
      <KeyboardAvoidingView
        style={styles.root}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.canvasWrap}>
          <ZentrimCanvas
            pageId={pageId}
            strokes={strokes}
            images={images}
            metadata={metadata}
            screenSize={{ width, height }}
            engineRef={engineRef}
          />

          {/* 顶部文字输入框（flomo 风格） */}
          <View style={styles.textInputWrap}>
            <TextInput
              style={[styles.noteInput, keyboardVisible && styles.noteInputFocused]}
              value={noteText}
              onChangeText={setNoteText}
              placeholder="写点什么..."
              placeholderTextColor="#999"
              autoFocus
              multiline
              blurOnSubmit={false}
            />
          </View>

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
            disabledItems={["timeline", "png"]}
          />

          {recording ? (
            <RecordingBubble
              mode={recording.mode}
              seconds={recording.seconds}
              asrReady={recording.asrReady}
            />
          ) : null}
        </View>

        {/* 颜色面板 */}
        <Modal
          visible={colorPanelOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setColorPanelOpen(false)}
        >
          <Pressable style={styles.colorBackdrop} onPress={() => setColorPanelOpen(false)} />
          <View style={styles.colorPanel}>
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
      </KeyboardAvoidingView>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF",
  },
  loadingRoot: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
  },
  loadingText: {
    marginTop: 16,
    color: "#999",
    fontSize: 14,
  },
  errorText: {
    color: "#d32f2f",
    fontSize: 15,
    textAlign: "center",
    marginBottom: 16,
    paddingHorizontal: 24,
  },
  retryButton: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: "#1976d2",
  },
  retryText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  canvasWrap: {
    flex: 1,
    position: "relative",
  },
  textInputWrap: {
    position: "absolute",
    left: 16,
    right: 16,
    top: 16,
    zIndex: 10,
  },
  noteInput: {
    backgroundColor: "rgba(255, 255, 255, 0.92)",
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    fontSize: 18,
    color: "#1a1a1a",
    minHeight: 56,
    maxHeight: 240,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0, 0, 0, 0.08)",
    // iOS 磨砂效果（backdrop-filter 在 RN 中通过 experimental backdrop-filter 不可用；
    // 用半透明白底近似）
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  noteInputFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.98)",
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
