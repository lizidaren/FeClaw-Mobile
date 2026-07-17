/**
 * CanvasEditor — 在画布上嵌入 canvas-editor（WebView 富文本编辑器）
 *
 * 职责：
 *  - 内联加载 canvas-editor UMD（HTML 模板见 src/webview-editor/index.html.ts）
 *  - 与 WebView 双向 postMessage 通信：load / clear / change / ready
 *  - 暴露 reloadContent(elements) ref 方法，加载新内容（destroy + recreate）
 *  - 通过 enabled 控制 WebView 是否接收触控
 *    - 文字模式：enabled=true, pointerEvents=auto, 唤起键盘
 *    - 笔模式：  enabled=false, pointerEvents=none, WebView 透传触控给 Skia
 *
 * 使用注意：
 *  - canvas-editor 没有 setValue API；reload 必须走 destroy + recreate（HTML 内已实现）
 *  - WebView 背景透明，androidLayerType="software" 避免某些 Android 设备黑底
 *  - 不带滚动（scrollEnabled=false），由 CanvasScreen 统一控制滚动
 */

import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Platform, View, type StyleProp, type ViewStyle } from "react-native";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import { CANVAS_EDITOR_HTML } from "../webview-editor/index.html";
import type {
  EditorOutboundMessage,
  IElement,
} from "../webview-editor/types";

export interface CanvasEditorProps {
  /** 初始内容（IElement[]），变化时通过 reloadContent 注入 */
  initialContent?: IElement[];
  /** 内容变更回调（每次编辑器触发 contentChange 时调用） */
  onChange?: (elements: IElement[]) => void;
  /** 编辑器就绪回调（WebView 端 canvas-editor 实例构建完成） */
  onReady?: () => void;
  /** 是否接收触控（文字模式=true 接收；笔模式=false 透传给 Skia） */
  enabled?: boolean;
  /** 自定义容器样式（控制位置/尺寸） */
  style?: StyleProp<ViewStyle>;
  /** 容器事件：enabled=false 时由 RN 接收 */
  onTouchStart?: (e: unknown) => void;
  onTouchMove?: (e: unknown) => void;
  onTouchEnd?: (e: unknown) => void;
}

export interface CanvasEditorHandle {
  /** 重新加载内容（destroy 当前实例 + 用新 main 重建） */
  reloadContent: (elements: IElement[]) => void;
  /** 清空编辑器 */
  clear: () => void;
  /** 当前是否已就绪（WebView 内 canvas-editor 实例构建完成） */
  isReady: () => boolean;
  /** 获取当前内容（同步从 ref 中读最近一次 onChange 收到的 main） */
  getContent: () => IElement[];
  /** 聚焦 WebView（唤起键盘）—— best-effort：先用 RN WebView.requestFocus，再用 JS 选中文本 */
  focus?: () => void;
}

export const CanvasEditor = forwardRef<CanvasEditorHandle, CanvasEditorProps>(
  function CanvasEditor(
    {
      initialContent,
      onChange,
      onReady,
      enabled = true,
      style,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
    },
    ref,
  ) {
    const webViewRef = useRef<WebView | null>(null);
    const readyRef = useRef(false);
    const lastContentRef = useRef<IElement[]>(initialContent ?? []);
    // 跟踪"待发送的初始内容"：WebView 端 ready 之前，初始内容无法直接 postMessage（HTML 端 self-init）。
    // WebView 加载时已通过 initialContent 渲染；这里只需要缓存以便 reloadContent 复用。
    const pendingInitialRef = useRef<IElement[] | null>(initialContent ?? null);
    // 防抖：避免 onChange 风暴（每次按键都触发 reload）—— 用 ref 记录上次内容做差分判断
    const lastEmittedRef = useRef<string>("");
    const [pointerEvents, setPointerEvents] = useState<"auto" | "none">(
      enabled ? "auto" : "none",
    );

    // enabled 切换 → pointerEvents 跟着切
    useEffect(() => {
      setPointerEvents(enabled ? "auto" : "none");
    }, [enabled]);

    // 发送消息到 WebView（用 window.message + window.__canvasEditorBridge 双路径，
    // 兼容 Android/iOS 上的 react-native-webview 注入方式）
    const sendToWebView = useCallback(
      (type: "load" | "clear", payload?: { main: IElement[] }) => {
        const wv = webViewRef.current;
        if (!wv) return;
        const msg = payload ? { type, payload } : { type };
        const json = JSON.stringify(msg);
        // 路径 1：injectJavaScript（最稳）
        if (type === "load" && payload) {
          const fn =
            `window.__canvasEditorBridge && window.__canvasEditorBridge.load(${JSON.stringify(json)}); true;`;
          wv.injectJavaScript(fn);
        } else if (type === "clear") {
          const fn = `window.__canvasEditorBridge && window.__canvasEditorBridge.clear(); true;`;
          wv.injectJavaScript(fn);
        }
      },
      [],
    );

    // 收到 WebView 消息
    const handleMessage = useCallback(
      (e: WebViewMessageEvent) => {
        const raw = e.nativeEvent.data;
        let msg: EditorOutboundMessage | null = null;
        try {
          msg = JSON.parse(raw) as EditorOutboundMessage;
        } catch {
          return;
        }
        if (!msg || !msg.type) return;
        if (msg.type === "ready") {
          readyRef.current = true;
          // 如果 RN 端在 WebView 还没 ready 时已经有初始内容待注入，
          // 这里补发一次（正常情况 HTML 端会用 self-init 渲染空编辑，
          // initialContent 通过 props 已经在 HTML 渲染时无法拿到；
          // 真正首次加载走下方"外部 reloadContent"或 onMountEffect）。
          if (pendingInitialRef.current && pendingInitialRef.current.length > 0) {
            sendToWebView("load", { main: pendingInitialRef.current });
            pendingInitialRef.current = null;
          }
          onReady?.();
        } else if (msg.type === "change") {
          const main = msg.payload?.main ?? [];
          lastContentRef.current = main;
          // 简单去重：内容字符串相同时跳过 onChange
          const sig = JSON.stringify(main);
          if (sig === lastEmittedRef.current) return;
          lastEmittedRef.current = sig;
          onChange?.(main);
        } else if (msg.type === "error") {
          // 仅日志，不抛出 —— canvas-editor 错误不应让画布崩溃
          console.warn("[CanvasEditor] webview error:", msg.payload?.message);
        }
      },
      [onChange, onReady, sendToWebView],
    );

    // 外部 ref API
    useImperativeHandle(
      ref,
      () => ({
        reloadContent(elements: IElement[]) {
          lastContentRef.current = elements;
          lastEmittedRef.current = JSON.stringify(elements);
          sendToWebView("load", { main: elements });
        },
        clear() {
          lastContentRef.current = [];
          lastEmittedRef.current = "[]";
          sendToWebView("clear");
        },
        isReady() {
          return readyRef.current;
        },
        getContent() {
          return lastContentRef.current;
        },
        focus() {
          const wv = webViewRef.current;
          if (!wv) return;
          try {
            // RN WebView 暴露 requestFocus（部分平台）；同时用 JS 把光标放到文末
            const w = wv as unknown as { requestFocus?: () => void };
            w.requestFocus?.();
            wv.injectJavaScript(
              "(function(){var c=document.querySelector('.canvas-editor__content');" +
                "if(c&&c.focus){c.focus();}var s=document.querySelector('.canvas-editor [contenteditable=\"true\"]');" +
                "if(s&&s.focus){s.focus();}" +
                "})(); true;",
            );
          } catch {
            // ignore
          }
        },
      }),
      [sendToWebView],
    );

    return (
      <View
        style={[styles.container, style]}
        pointerEvents={pointerEvents}
        onTouchStart={onTouchStart as never}
        onTouchMove={onTouchMove as never}
        onTouchEnd={onTouchEnd as never}
      >
        <WebView
          ref={webViewRef}
          style={styles.webview}
          originWhitelist={["*"]}
          source={{ html: CANVAS_EDITOR_HTML, baseUrl: "" }}
          onMessage={handleMessage}
          // Android 软渲染避免硬件层在透明背景上显示黑色
          {...(Platform.OS === "android" ? { androidLayerType: "software" as const } : {})}
          // 编辑器自带滚动 / 缩放关掉，由 RN 端容器控制
          scrollEnabled={false}
          // 不允许用户在 WebView 内做原生手势导航
          allowsBackForwardNavigationGestures={false}
          // 不需要文件访问
          allowFileAccess={false}
          // 关闭长按菜单
          domStorageEnabled={false}
          // 加快首屏：禁用缓存（HTML 模板已 self-contained）
          cacheEnabled={false}
          // 防止 keyboard accessory 工具条遮挡
          hideKeyboardAccessoryView
        />
      </View>
    );
  },
);

/** WebView 的 style 类型（react-native-webview 用 ViewStyle 兼容即可） */
type WebViewStyle = StyleProp<ViewStyle>;

const styles: { container: ViewStyle; webview: WebViewStyle } = {
  container: {
    flex: 1,
    backgroundColor: "transparent",
  },
  webview: {
    // WebView 的 style 接受 ViewStyle；用 backgroundColor: "transparent" 让 canvas-editor 透明背景透出 Skia
    flex: 1,
    backgroundColor: "transparent",
  },
};
