/**
 * 画布左侧竖排工具栏
 *
 * 4 个按钮：笔 / 橡皮 / 拍照 / 撤销
 * - ✏️ 笔 — 单击切到笔模式；已在笔模式再双击 → 打开颜色面板
 * - 🧹 橡皮 — 切到橡皮模式
 * - 📷 拍照 — 一键调用 onPhotoCapture
 * - ↩️ 撤销 — 调用 onUndo
 */

import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  TOOLBAR_PEN,
  TOOLBAR_PEN_A11Y,
  TOOLBAR_ERASER,
  TOOLBAR_PHOTO,
  TOOLBAR_UNDO,
} from "../constants/strings";

export type ToolMode = "ink" | "eraser";

export interface CanvasToolbarProps {
  /** 当前激活的工具 */
  activeTool: ToolMode;
  /** 是否有可撤销的笔划 */
  canUndo: boolean;
  onSelectTool: (tool: ToolMode) => void;
  /** 笔模式下双击触发（打开颜色面板） */
  onPenDoubleTap: () => void;
  onPhotoCapture: () => void;
  onUndo: () => void;
}

// fix(P1-4): React.memo 避免父组件 re-render 导致工具栏不必要的重绘
export const CanvasToolbar = React.memo(function CanvasToolbar({
  activeTool,
  canUndo,
  onSelectTool,
  onPenDoubleTap,
  onPhotoCapture,
  onUndo,
}: CanvasToolbarProps) {
  const isInk = activeTool === "ink";

  // 笔按钮手势：单击选中笔 / 双击（已在笔模式时）打开颜色面板
  const penGesture = useMemo(() => {
    const doubleTap = Gesture.Tap()
      .numberOfTaps(2)
      .maxDuration(300)
      .onEnd((_e, success) => {
        if (!success) return;
        if (isInk) {
          onPenDoubleTap();
        } else {
          onSelectTool("ink");
        }
      });
    const singleTap = Gesture.Tap()
      .numberOfTaps(1)
      .onEnd((_e, success) => {
        if (!success) return;
        onSelectTool("ink");
      });
    // 优先识别双击；双击失败才回退到单击
    return Gesture.Exclusive(doubleTap, singleTap);
  }, [isInk, onPenDoubleTap, onSelectTool]);

  return (
    <View style={styles.container}>
      <GestureDetector gesture={penGesture}>
        <View
          style={[styles.button, isInk && styles.buttonActive]}
          accessibilityRole="button"
          // fix(P1-2): 使用常量替代硬编码字符串
          accessibilityLabel={isInk ? TOOLBAR_PEN_A11Y : TOOLBAR_PEN}
        >
          <Text style={styles.icon}>✏️</Text>
          <Text style={styles.label}>{TOOLBAR_PEN}</Text>
        </View>
      </GestureDetector>
      <ToolbarButton
        label={TOOLBAR_ERASER}
        icon="🧹"
        active={activeTool === "eraser"}
        onPress={() => onSelectTool("eraser")}
      />
      <ToolbarButton
        label={TOOLBAR_PHOTO}
        icon="📷"
        active={false}
        onPress={onPhotoCapture}
      />
      <ToolbarButton
        label={TOOLBAR_UNDO}
        icon="↩️"
        active={false}
        disabled={!canUndo}
        onPress={onUndo}
      />
    </View>
  );
});

interface ToolbarButtonProps {
  label: string;
  icon: string;
  active: boolean;
  disabled?: boolean;
  onPress: () => void;
}

// fix(P1-4): React.memo 避免每次父组件渲染都重建按钮
const ToolbarButton = React.memo(function ToolbarButton({ label, icon, active, disabled, onPress }: ToolbarButtonProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.6}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        active && styles.buttonActive,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[styles.icon, disabled && styles.iconDisabled]}>{icon}</Text>
      <Text style={[styles.label, disabled && styles.labelDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 12,
    top: "30%",
    flexDirection: "column",
    alignItems: "center",
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 4,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  button: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    marginVertical: 2,
  },
  buttonActive: {
    backgroundColor: "#E8F0FE",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  icon: {
    fontSize: 22,
  },
  iconDisabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: 10,
    marginTop: 2,
    color: "#333",
  },
  labelDisabled: {
    color: "#999",
  },
});
