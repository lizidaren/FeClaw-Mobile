/**
 * canvas-editor WebView 内嵌 HTML 模板
 *
 * 通信协议（postMessage）：
 *  - RN → WebView: { type: "load",   payload: { main: IElement[] } }  加载内容
 *  - RN → WebView: { type: "clear" }                                  清空
 *  - WebView → RN: { type: "ready" }                                  初始化完成
 *  - WebView → RN: { type: "change", payload: { main: IElement[] } }  内容变更
 *  - WebView → RN: { type: "error", payload: { message } }            内部错误
 *
 * canvas-editor 没有 setValue API，所以 reload 内容走 destroy + recreate。
 * UMD 全局对象为 `window.Editor`（见 canvas-editor README）。
 */

export const CANVAS_EDITOR_CDN =
  "https://cdn.jsdelivr.net/npm/@hufe921/canvas-editor@0.9.137/dist/index.umd.js";

export const CANVAS_EDITOR_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <title>Canvas Editor</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      background: transparent;
      overflow: hidden;
      -webkit-tap-highlight-color: transparent;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "PingFang SC", "Helvetica Neue", sans-serif;
    }
    /* canvas-editor 内部容器：透明背景让画布下层图片透出 */
    #editor {
      width: 100%;
      height: 100%;
      background: transparent;
    }
    .canvas-editor {
      background: transparent !important;
    }
    .canvas-editor__content {
      background: transparent !important;
    }
    /* 16px 默认字号、适中行距 */
    .canvas-editor td,
    .canvas-editor th,
    .canvas-editor .text-content {
      font-size: 16px;
      line-height: 1.7;
      color: #1a1a1a;
    }
    /* 隐藏所有 UI 控件（Clean mode） */
    .canvas-editor__header,
    .canvas-editor__footer,
    .canvas-editor__menu,
    .canvas-editor__contextmenu,
    .canvas-editor__tooltip,
    .canvas-editor__scale,
    .canvas-editor__page-break,
    .canvas-editor__page-number {
      display: none !important;
    }
    /* 滚动交给 RN 主页面控制 */
    .canvas-editor__container {
      overflow: hidden !important;
    }
  </style>
</head>
<body>
  <div id="editor"></div>
  <script src="${CANVAS_EDITOR_CDN}"></script>
  <script>
    (function () {
      var instance = null;
      var isLoaded = false;

      function postToRN(msg) {
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify(msg));
          }
        } catch (e) {
          // 静默：postMessage 失败不影响编辑器主功能
        }
      }

      function safeDestroy() {
        if (instance) {
          try { instance.destroy(); } catch (e) { /* ignore */ }
          instance = null;
        }
      }

      function build(data) {
        safeDestroy();
        var el = document.getElementById("editor");
        if (!el) return;
        // editorConfig：data 装载业务数据；mode="clean" 隐藏工具栏/菜单
        var config = {
          noAllowEditorAuthService: true,
          width: el.clientWidth || window.innerWidth,
          height: el.clientHeight || window.innerHeight,
          noSign: true,
        };
        // 数据：data.data 装载 IEditorData 整体
        var payload = { data: data, options: config, mode: "clean" };
        try {
          instance = new window.Editor(el, payload);
          isLoaded = true;
          postToRN({ type: "ready" });
        } catch (e) {
          postToRN({ type: "error", payload: { message: String(e && e.message || e) } });
        }
      }

      // canvas-editor 的 changeCommand：内容变更回调
      function bindChange() {
        if (!instance || !instance.listener) return;
        try {
          instance.listener.contentChange = function () {
            try {
              var data = instance.getValue ? instance.getValue() : { main: [] };
              postToRN({ type: "change", payload: { main: (data && data.main) || [] } });
            } catch (e) {
              postToRN({ type: "error", payload: { message: "getValue: " + String(e) } });
            }
          };
        } catch (e) {
          // 旧版无 listener，跳过
        }
      }

      // 启动后等一帧再注册 change 回调
      function initOnce() {
        if (!window.Editor) {
          // CDN 加载失败
          postToRN({ type: "error", payload: { message: "canvas-editor UMD 未加载" } });
          return;
        }
        build({ main: [] });
        bindChange();
      }

      // 等待 DOMContentLoaded
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initOnce);
      } else {
        initOnce();
      }

      // 接收 RN 消息
      window.addEventListener("message", function (ev) {
        handleRNMessage(ev.data);
      });
      // Android 兼容：直接覆盖 document.title 的方式不太通用，
      // 这里只用标准的 window.message。RN WebView 默认注入
      // window.ReactNativeWebView.postMessage，对应 window.addEventListener("message", ...) 即可。

      function handleRNMessage(raw) {
        if (!raw) return;
        var msg;
        try { msg = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return; }
        if (!msg || !msg.type) return;
        if (msg.type === "load") {
          var data = (msg.payload && msg.payload.main) ? { main: msg.payload.main } : { main: [] };
          build(data);
          bindChange();
        } else if (msg.type === "clear") {
          build({ main: [] });
          bindChange();
        }
      }

      // 暴露给 RN 调用（部分平台通过 injectJavaScript 走 evaluateJavaScript 注入函数）
      window.__canvasEditorBridge = {
        load: function (json) {
          try {
            var data = typeof json === "string" ? JSON.parse(json) : json;
            handleRNMessage({ type: "load", payload: data });
          } catch (e) {
            postToRN({ type: "error", payload: { message: "load: " + String(e) } });
          }
        },
        clear: function () {
          handleRNMessage({ type: "clear" });
        },
        getValue: function () {
          if (!instance || !instance.getValue) return JSON.stringify({ main: [] });
          try { return JSON.stringify(instance.getValue()); } catch (e) { return JSON.stringify({ main: [] }); }
        },
        isReady: function () { return isLoaded; },
      };
    })();
  </script>
</body>
</html>`;
