/**
 * 浮动格式化工具栏
 *
 * 文字模式（toolMode=null）时显示在画布顶部居中。8 个按钮 + 2 个分隔线：
 * 撤销 / 重做 | B I U S | H 列表
 *
 * 通过注入到 WebView 的 `window.__canvasEditorBridge.command(json)` 调用
 * canvas-editor 暴露的 command API（bold/italic/underline/strikeout/
 * undo/redo/size/list）。
 *
 * 设计：深色半透明底 `rgba(30,30,30,0.85)` + 圆角 20px + 内边距 4px；
 * 紧贴画布顶部（top=12），居中；不遮挡左上角的 RecordingBubble
 * （RecordingBubble 高度约 36px，工具栏在它右侧或下方排布即可）。
 */

import React, { useCallback } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";

export type FormatCommand =
  | "undo"
  | "redo"
  | "bold"
  | "italic"
  | "underline"
  | "strikeout"
  | "heading"
  | "list";

export interface FormatToolbarProps {
  /** 外部注入命令的回调（CanvasEditor 暴露此能力） */
  onCommand: (cmd: FormatCommand) => void;
}

/** 按钮定义：label + command 映射 */
const ITEMS_LEFT: Array<{ label: string; icon: string; cmd: FormatCommand; a11y: string }> = [
  { label: "撤销", icon: "↩️", cmd: "undo", a11y: "撤销" },
  { label: "重做", icon: "↪️", cmd: "redo", a11y: "重做" },
];

const ITEMS_INLINE: Array<{ label: string; icon: string; cmd: FormatCommand; a11y: string }> = [
  { label: "粗体", icon: "B", cmd: "bold", a11y: "加粗" },
  { label: "斜体", icon: "I", cmd: "italic", a11y: "斜体" },
  { label: "下划线", icon: "U", cmd: "underline", a11y: "下划线" },
  { label: "删除线", icon: "S", cmd: "strikeout", a11y: "删除线" },
];

const ITEMS_BLOCK: Array<{ label: string; icon: string; cmd: FormatCommand; a11y: string }> = [
  { label: "标题", icon: "H", cmd: "heading", a11y: "标题" },
  { label: "列表", icon: "≡", cmd: "list", a11y: "列表" },
];

// fix(P1-4): React.memo 避免父组件 re-render 时整个工具栏重建
export const FormatToolbar = React.memo(function FormatToolbar({ onCommand }: FormatToolbarProps) {
  const renderButton = useCallback(
    (
      item: { label: string; icon: string; cmd: FormatCommand; a11y: string },
      bold: boolean,
    ) => (
      <TouchableOpacity
        key={item.cmd}
        style={styles.btn}
        onPress={() => onCommand(item.cmd)}
        activeOpacity={0.6}
        accessibilityRole="button"
        accessibilityLabel={item.a11y}
      >
        <Text style={[styles.icon, bold ? styles.iconBold : null]}>{item.icon}</Text>
      </TouchableOpacity>
    ),
    [onCommand],
  );

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.bar}>
        {ITEMS_LEFT.map((it) => renderButton(it, false))}
        <View style={styles.divider} />
        {ITEMS_INLINE.map((it) => renderButton(it, true))}
        <View style={styles.divider} />
        {ITEMS_BLOCK.map((it) => renderButton(it, true))}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    // 紧贴画布顶部，水平居中；不挡左上 RecordingBubble（top=12, left=12）
    position: "absolute",
    top: 12,
    left: 0,
    right: 0,
    alignItems: "center",
    // 让 RecordingBubble 仍可点击（box-none 配合子 bar 接事件）
    zIndex: 20,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(30, 30, 30, 0.85)",
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 5,
  },
  btn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    marginHorizontal: 2,
  },
  icon: {
    color: "#FFFFFF",
    fontSize: 16,
  },
  iconBold: {
    fontWeight: "700",
  },
  divider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    marginHorizontal: 4,
  },
});
