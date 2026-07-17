/**
 * 画布全屏页
 *
 * 组合：
 * - ZentrimCanvas（Skia 画布主体，三层渲染）
 * - CanvasEditor（WebView 富文本编辑层，覆盖在画布之上，文字模式时接收键盘）
 * - CanvasToolbar（左侧竖排工具栏：文字/笔/橡皮/拍照/撤销）
 * - DraftToggle（左下角草稿纸按钮）
 * - ThreeDotMenu（右上角 ⋮ 菜单）
 * - RecordingBubble（录音/回放气泡，按需显示）
 * - 颜色面板（笔模式双击弹出）
 * - PdfImportDialog（插入文件时弹出）
 *
 * 交互协议：
 * - Default：text mode（activeTool=null），CanvasEditor enabled，键盘打开
 * - Pen mode：用户点工具栏笔按钮 → setActiveTool("ink") + CanvasEditor.enabled=false + Keyboard.dismiss()
 *   画布接管后续触摸事件，WebView pointerEvents=none 透传触控
 * - 用户点工具栏文字按钮 → setActiveTool(null) + CanvasEditor.enabled=true + focus
 * - 退出时（componentWillUnmount）才把 IElement[] 序列化到后端（PUT /api/zentrim/entries/{id}/blocks）
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
import { CanvasEditor, type CanvasEditorHandle, type RecordingEvent } from "../components/CanvasEditor";
import { DraftToggle } from "../components/DraftToggle";
import { ThreeDotMenu, type CanvasInfo } from "../components/ThreeDotMenu";
import { RecordingBubble, type RecordingMode } from "../components/RecordingBubble";
import { FormatToolbar, type FormatCommand } from "../components/FormatToolbar";
import { PdfImportDialog, type PdfPage } from "../components/PdfImportDialog";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { COLOR_PANEL_TITLE } from "../constants/strings";
import { api } from "../services/api-client";
import type { Block, CanvasData } from "../types/api";
import type { IElement } from "../webview-editor/types";
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

/** 从后端 CanvasBlock[] 提取纯文本（text block 拼接；IElement[] JSON 格式时尝试解析） */
function extractText(canvasData: CanvasData): string {
  const texts: string[] = [];
  for (const b of canvasData.blocks) {
    if (b.type === "text" && b.text) {
      texts.push(b.text);
    }
  }
  return texts.join("\n");
}

/** 从后端 CanvasBlock[] 提取富文本（IElement[]）。text block 的 text 字段如果是 JSON 数组则解析，否则包成单元素。 */
function extractRichText(canvasData: CanvasData): IElement[] {
  const out: IElement[] = [];
  for (const b of canvasData.blocks) {
    if (b.type !== "text" || !b.text) continue;
    const raw = b.text.trim();
    if (raw.startsWith("[")) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          for (const item of parsed) {
            if (item && typeof item === "object" && "value" in item) {
              out.push(item as IElement);
            }
          }
          continue;
        }
      } catch {
        // 解析失败：当作纯文本
      }
    }
    // 纯文本 fallback
    out.push({ value: b.text, size: 16 });
  }
  return out;
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
  const editorRef = useRef<CanvasEditorHandle | null>(null);

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

  const loadedRichText = useMemo<IElement[]>(() => {
    if (loadState.status !== "success") return [];
    return extractRichText(loadState.data);
  }, [loadState]);

  // 最终使用的 strokes / images / pageId
  const strokes = entryId ? loadedStrokes : propStrokes;
  const imagesFromData = entryId ? loadedImages : initialImages;
  const pageId = pageIdProp ?? (entryId ? `entry_${entryId}` : "default_page");

  // toolMode: null = 文字模式（WebView 收键盘）；"ink" / "eraser" = 绘画模式
  const [activeTool, setActiveTool] = useState<ToolMode | null>(null);
  const [canUndo, setCanUndo] = useState(false);
  const [isDraft, setIsDraft] = useState(false);
  const [inkColor, setInkColor] = useState(INK_COLORS[0]);
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [images, setImages] = useState<CanvasImage[]>(imagesFromData);

  // canvas-editor（WebView 文字层）状态
  // editorEnabled: WebView 是否接收触控（true=文字模式，false=笔模式透传）
  const [editorEnabled, setEditorEnabled] = useState(true);
  // 待保存的 IElement[]：WebView onChange 持续累积；componentWillUnmount 时落库
  const pendingEditorContentRef = useRef<IElement[]>(loadedRichText);
  // WebView 内 canvas-editor 实例是否已就绪
  const editorReadyRef = useRef(false);

  // 当 entry 加载完成时把 IElement[] 注入编辑器
  // fix(P1-render): 推迟到 microtask，避免与上一 commit 撞车
  useEffect(() => {
    if (!entryId) return;
    let disposed = false;
    Promise.resolve().then(() => {
      if (disposed) return;
      setImages(imagesFromData);
      pendingEditorContentRef.current = loadedRichText;
      // 编辑器已就绪则 reload；未就绪则在 handleEditorReady 补发
      if (editorReadyRef.current) {
        editorRef.current?.reloadContent(loadedRichText);
      }
    });
    return () => { disposed = true; };
  }, [entryId, imagesFromData, loadedRichText]);
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  // ── 录音状态（由 CanvasEditor.onRecordingEvent 驱动） ──
  // - isRecording: WebView 端 MediaRecorder 是否正在录音
  // - recordingStartAt: 本地计时起点（用于实时 mm:ss 显示）
  // - recordingDuration: 录音完成时记录总时长
  // - recordingUrl: 上传成功后保存的远端 URL
  // - recordingPlaying: 播放态
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartAt, setRecordingStartAt] = useState<number>(0);
  const [recordingDuration, setRecordingDuration] = useState<number>(0);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);
  const [recordingPlaying, setRecordingPlaying] = useState(false);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 强制重渲染（用于录音中的实时时间码 — 不更新 setState 避免多余渲染）
  const [, forceTick] = useState(0);
  const tick = useCallback(() => forceTick((n) => n + 1), []);

  // 清理录音计时器
  const stopRecordingTimer = useCallback(() => {
    if (recordingTimerRef.current) {
      clearInterval(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
  }, []);

  // 订阅引擎状态变化，同步工具栏 UI（引擎由 ZentrimCanvas 创建，子 effect 先于本 effect 运行）
  // fix(P1-render): 初始 sync() 推迟到下一 microtask，避免在 React commit 阶段
  // 立即触发 setState（Fabric 报 "Should not already be working"）。
  // 引擎内部 emit 同样异步化（setTimeout 0），确保订阅回调不会在渲染中途改状态。
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    let disposed = false;
    const scheduleSync = () => {
      if (disposed) return;
      // 优先用 Promise.resolve().then 走 microtask；若引擎同步链触发嵌套 render，
      // 微任务会让出当前 commit；最坏情况回退到 setTimeout 0。
      Promise.resolve().then(() => {
        if (disposed) return;
        // 引擎内部 tool 初始是 "ink"（CanvasEngine 构造默认）；
        // 我们的 activeTool 状态独立控制是否进入绘画态。
        setCanUndo(eng.canUndo());
        setIsDraft(eng.isDraftModeOn());
      });
    };
    const unsub = eng.subscribe(scheduleSync);
    scheduleSync();
    return () => {
      disposed = true;
      unsub();
    };
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

  // ── 退出时落库（不自动保存，仅在卸载时） ──
  // 设计：用户点返回箭头或 ⋮ 菜单离开本页面 → 触发卸载 → 同步构造 blocks 并 PUT
  // 失败仅 console.warn，不阻塞路由返回
  useEffect(() => {
    return () => {
      const rich = pendingEditorContentRef.current;
      const textBlockContent = rich.length > 0 ? JSON.stringify(rich) : "";
      // 只在有内容变更或已有 entryId 时落库
      if (!textBlockContent && !entryId) return;

      // 构造 blocks：保留 ink + 拍照图；追加 text block
      const blocks: Block[] = [];
      // 现有 ink/photo block 数据已经在后端，PUT 整组会全量覆盖
      // 这里只追加我们关心的新 text block；旧 ink block 保留在 ink block（仍由后端 GET canvas 拉回）
      // 注：当前 api.updateBlocks 接受全量 blocks；为了不丢旧数据，
      // 改为调用 updateBlocks 时把 ink block 一并提交（从当前 images 推导）
      if (images.length > 0 || strokes.length > 0) {
        blocks.push({
          type: "ink",
          content: JSON.stringify({
            strokes,
            images: images.map((img) => ({
              id: img.id,
              source: img.source,
              x: img.x,
              y: img.y,
              width: img.width,
              height: img.height,
              rotation: img.rotation,
              zIndex: img.zIndex,
            })),
            metadata,
          }),
        });
      }
      if (textBlockContent) {
        blocks.push({ type: "text", content: textBlockContent });
      }

      const persist = async () => {
        try {
          let targetId = entryId;
          if (!targetId) {
            const created = await api.createEntry({ type: "note" });
            targetId = created.id;
          }
          if (targetId && blocks.length > 0) {
            await api.updateBlocks(targetId, blocks);
          }
        } catch (e) {
          console.warn("[CanvasScreen] 自动落库失败", e);
        }
      };
      void persist();
    };
    // 仅在卸载时跑一次；依赖列表用 ref / state 取最新值（deps 不参与触发）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── 工具栏回调 ──

  /**
   * 用户手动选中工具：切换 toolMode，保存到引擎，并 dismiss 键盘
   * （因为用户从键盘模式切到绘画模式，意味着想画而不是写字）
   */
  const handleSelectTool = useCallback((tool: ToolMode) => {
    engineRef.current?.setTool(tool);
    setActiveTool(tool);
    setEditorEnabled(false);
    Keyboard.dismiss();
  }, []);

  /**
   * 切回文字模式：关闭工具栏高亮、允许 WebView 接收触控并唤起键盘
   */
  const handleSelectTextMode = useCallback(() => {
    setActiveTool(null);
    setEditorEnabled(true);
    // 微任务后聚焦 WebView（让 React 先把 enabled 切到 auto，再让 WebView 拉起键盘）
    setTimeout(() => {
      try {
        editorRef.current?.focus?.();
      } catch {
        // focus 是可选能力，缺失时不抛错
      }
    }, 50);
  }, []);

  /**
   * canvas-editor 内容变更：累积到 ref，等退出时落库
   */
  const handleEditorChange = useCallback((elements: IElement[]) => {
    pendingEditorContentRef.current = elements;
  }, []);

  const handleEditorReady = useCallback(() => {
    editorReadyRef.current = true;
    // 加载时已有内容 → 注入到 WebView
    if (pendingEditorContentRef.current.length > 0) {
      editorRef.current?.reloadContent(pendingEditorContentRef.current);
    }
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

  // ── 浮动格式化工具栏：转发命令到 WebView ──
  const handleFormatCommand = useCallback((cmd: FormatCommand) => {
    try {
      editorRef.current?.command?.(cmd);
    } catch (e) {
      console.warn("[CanvasScreen] command 失败", cmd, e);
    }
  }, []);

  // ── 录音按钮：开始 / 停止 ──
  const handleToggleRecording = useCallback(() => {
    if (isRecording) {
      try {
        editorRef.current?.stopRecording?.();
      } catch (e) {
        console.warn("[CanvasScreen] stopRecording 失败", e);
      }
    } else {
      try {
        editorRef.current?.startRecording?.();
      } catch (e) {
        console.warn("[CanvasScreen] startRecording 失败", e);
      }
    }
  }, [isRecording]);

  // ── 录音生命周期事件：处理 base64 → 上传 → audio block ──
  const handleRecordingEvent = useCallback(
    async (event: RecordingEvent) => {
      if (event.type === "recording_started") {
        setIsRecording(true);
        setRecordingStartAt(Date.now());
        setRecordingDuration(0);
        setRecordingUrl(null);
        // 每秒 tick 一次更新气泡时间码
        stopRecordingTimer();
        recordingTimerRef.current = setInterval(tick, 500);
        return;
      }
      if (event.type === "recording_error") {
        console.warn("[CanvasScreen] 录音失败", event.payload.message);
        setIsRecording(false);
        stopRecordingTimer();
        return;
      }
      if (event.type === "recording_complete") {
        setIsRecording(false);
        stopRecordingTimer();
        const dur = event.payload.duration ?? 0;
        setRecordingDuration(dur);
        // base64 → data URL → 上传到 /api/upload
        const { base64, mime } = event.payload;
        if (!base64) {
          console.warn("[CanvasScreen] 录音 base64 为空");
          return;
        }
        try {
          // RN 的 fetch 支持 data URL 形式作为 uri；FileReader 也能用，但这里直接用 data URL 上传
          const dataUrl = `data:${mime};base64,${base64}`;
          const fileName = `recording-${Date.now()}.webm`;
          const uploaded = await api.uploadFile(dataUrl, fileName, mime);
          setRecordingUrl(uploaded.url);
          // 落库：创建/更新 entry 的 audio block
          await persistAudioBlock(uploaded.url, mime, dur);
        } catch (e) {
          console.warn("[CanvasScreen] 上传录音失败", e);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [stopRecordingTimer, tick],
  );

  /**
   * 把 audio block 持久化到当前 entry。规则：
   * - 若有 entryId：直接 updateBlocks（追加）
   * - 若没有 entryId：先 createEntry，再 updateBlocks
   * 注：后端 updateBlocks 是 PUT 全量覆盖，所以这里需要先 GET 现有 blocks。
   * 简化方案：使用 ink 块已存在的逻辑（保留）；新加 audio 块追加到末尾。
   */
  const persistAudioBlock = useCallback(
    async (url: string, mime: string, duration: number) => {
      try {
        let targetId = entryId;
        if (!targetId) {
          const created = await api.createEntry({ type: "note" });
          targetId = created.id;
        }
        if (!targetId) return;
        // 拉取现有 blocks，追加 audio 块后整组 PUT
        let existing: Block[] = [];
        try {
          existing = await api.getBlocks(targetId);
        } catch {
          existing = [];
        }
        const audioBlock: Block = {
          type: "audio",
          content: JSON.stringify({ url, mime, duration }),
        };
        const next = [...existing, audioBlock];
        await api.updateBlocks(targetId, next);
      } catch (e) {
        console.warn("[CanvasScreen] 持久化 audio block 失败", e);
      }
    },
    [entryId],
  );

  // ── 播放录音：调 WebView Audio API ──
  const handlePlayRecording = useCallback(() => {
    if (!recordingUrl) return;
    setRecordingPlaying(true);
    try {
      editorRef.current?.playAudio?.(recordingUrl);
    } catch (e) {
      console.warn("[CanvasScreen] playAudio 失败", e);
    }
    // WebView 的 Audio API 结束事件不传回 RN；这里 3 秒后粗略复位
    setTimeout(() => setRecordingPlaying(false), 3000);
  }, [recordingUrl]);

  // 卸载时清理录音 timer
  useEffect(() => {
    return () => {
      stopRecordingTimer();
    };
  }, [stopRecordingTimer]);

  // 录音中的实时时间码（秒）
  const recordingSeconds = isRecording
    ? Math.floor((Date.now() - recordingStartAt) / 1000)
    : recordingDuration;

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

          {/* WebView 文字层（覆盖在 Skia 之上；enabled=false 时透传触控给 Skia） */}
          <View
            style={styles.editorLayer}
            pointerEvents={editorEnabled ? "auto" : "none"}
          >
            <CanvasEditor
              ref={editorRef}
              enabled={editorEnabled}
              initialContent={loadedRichText}
              onChange={handleEditorChange}
              onReady={handleEditorReady}
              onRecordingEvent={handleRecordingEvent}
              style={styles.editorFill}
            />
          </View>

          <CanvasToolbar
            activeTool={activeTool}
            canUndo={canUndo}
            onSelectTool={handleSelectTool}
            onSelectTextMode={handleSelectTextMode}
            onPenDoubleTap={handlePenDoubleTap}
            onPhotoCapture={handlePhotoCapture}
            onUndo={handleUndo}
            onToggleRecording={handleToggleRecording}
            isRecording={isRecording}
          />

          {/* 浮动格式化工具栏：仅在文字模式（activeTool=null）显示 */}
          {activeTool === null ? (
            <FormatToolbar onCommand={handleFormatCommand} />
          ) : null}

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
          ) : isRecording || recordingUrl ? (
            <RecordingBubble
              mode={isRecording ? "recording" : "recorded"}
              seconds={recordingSeconds}
              asrReady={false}
              onOpenAudio={handlePlayRecording}
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
  editorLayer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    // 文字层在 Skia 之上、工具栏/菜单之下
    zIndex: 5,
  },
  editorFill: {
    flex: 1,
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
