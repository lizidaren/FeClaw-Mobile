/**
 * canvas-editor 文字层类型定义
 *
 * canvas-editor 是基于 Canvas 的富文本编辑器（@hufe921/canvas-editor）。
 * 这里只定义 RN ↔ WebView 通信所需的最小类型子集，
 * 完整 IElement 见 https://hufe921.github.io/canvas-editor-doc/guide/api.html
 */

/** canvas-editor 的元素（与 UMD 中 window.Editor.IElement 形状一致） */
export interface IElement {
  value: string;
  size?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  highlight?: string;
  rowFlex?: "left" | "center" | "right" | "alignment";
  type?: string;
  [key: string]: unknown;
}

/** canvas-editor 编辑器数据结构 */
export interface IEditorData {
  main: IElement[];
  header?: IElement[];
  footer?: IElement[];
}

/** RN → WebView 消息（type discriminator） */
export type EditorInboundMessage =
  | { type: "load"; payload: { main: IElement[] } }
  | { type: "clear" };

/** WebView → RN 消息 */
export type EditorOutboundMessage =
  | { type: "ready" }
  | { type: "change"; payload: { main: IElement[] } }
  | { type: "error"; payload: { message: string } };
