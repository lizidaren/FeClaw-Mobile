/**
 * 画布左侧竖排工具栏
 *
 * 5 个按钮：笔 / 橡皮 / 拍照 / 撤销 / 录音
 * - ✏️ 笔 — 单击切到笔模式；已在笔模式再双击 → 打开颜色面板
 * - 🧹 橡皮 — 切到橡皮模式
 * - 📷 拍照 — 一键调用 onPhotoCapture
 * - ↩️ 撤销 — 调用 onUndo
 * - 🎤 录音 — 点击开始/停止录音；录音中按钮显示红色脉冲
 */

import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import {
  TOOLBAR_PEN,
  TOOLBAR_PEN_A11Y,
  TOOLBAR_TEXT,
  TOOLBAR_TEXT_A11Y,
  TOOLBAR_ERASER,
  TOOLBAR_PHOTO,
  TOOLBAR_UNDO,
} from "../constants/strings";

export type ToolMode = "ink" | "eraser";

export interface CanvasToolbarProps {
  /** 当前激活的工具；null 表示未选中（文字模式，工具栏按钮全部灰色未选中态） */
  activeTool: ToolMode | null;
  /** 是否有可撤销的笔划 */
  canUndo: boolean;
  onSelectTool: (tool: ToolMode) => void;
  /** 切换到文字模式（仅在 activeTool !== null 时显示） */
  onSelectTextMode?: () => void;
  /** 笔模式下双击触发（打开颜色面板） */
  onPenDoubleTap: () => void;
  onPhotoCapture: () => void;
  onUndo: () => void;
  /** 录音按钮：开始/停止（WebView 端 MediaRecorder 驱动） */
  onToggleRecording?: () => void;
  /** 录音中：图标变红 + 脉冲 */
  isRecording?: boolean;
}

// fix(P1-4): React.memo 避免父组件 re-render 导致工具栏不必要的重绘
export const CanvasToolbar = React.memo(function CanvasToolbar({
  activeTool,
  canUndo,
  onSelectTool,
  onSelectTextMode,
  onPenDoubleTap,
  onPhotoCapture,
  onUndo,
  onToggleRecording,
  isRecording = false,
}: CanvasToolbarProps) {
  const isInk = activeTool === "ink";
  // 笔按钮手势：单击选中笔 / 双击（已在笔模式时）打开颜色面板
  // 当 activeTool === null（键盘模式）时，单击也能切到笔模式（隐藏键盘由父组件处理）
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
        // fix(P1-8): 已在 ink 模式时单击无操作，避免重复调用 onSelectTool 产生副作用
        if (isInk) return;
        onSelectTool("ink");
      });
    // 优先识别双击；双击失败才回退到单击
    return Gesture.Exclusive(doubleTap, singleTap);
  }, [isInk, onPenDoubleTap, onSelectTool]);
  return (
    <View style={styles.container}>
      <ToolbarButton
        label={TOOLBAR_TEXT}
        icon="⌨️"
        active={activeTool === null}
        inactive={false}
        onPress={() => onSelectTextMode?.()}
        accessibilityLabel={TOOLBAR_TEXT_A11Y}
      />
      <GestureDetector gesture={penGesture}>
        <View
          style={[styles.button, isInk && styles.buttonActive, activeTool === null && styles.buttonInactive]}
          accessibilityRole="button"
          accessibilityLabel={isInk ? TOOLBAR_PEN_A11Y : TOOLBAR_PEN}
        >
          <Text style={[styles.icon, activeTool === null && styles.iconInactive]}>✏️</Text>
          <Text style={[styles.label, activeTool === null && styles.labelInactive]}>{TOOLBAR_PEN}</Text>
        </View>
      </GestureDetector>
      <ToolbarButton
        label={TOOLBAR_ERASER}
        icon="🧹"
        active={activeTool === "eraser"}
        inactive={activeTool === null}
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
      <RecordingButton
        isRecording={isRecording}
        onPress={() => onToggleRecording?.()}
      />
    </View>
  );
});

/**
 * 录音按钮：录音中显示红色脉冲动画。
 * 使用 Animated.Value + 循环 loop 实现。
 */
const RecordingButton = React.memo(function RecordingButton({
  isRecording,
  onPress,
}: {
  isRecording: boolean;
  onPress: () => void;
}) {
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!isRecording) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1.18,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [isRecording, pulse]);

  return (
    <TouchableOpacity
      activeOpacity={0.6}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={isRecording ? "停止录音" : "开始录音"}
      style={[styles.button, isRecording && styles.buttonRecording]}
    >
      <Animated.View style={{ transform: [{ scale: pulse }] }}>
        <Text style={[styles.icon, isRecording && styles.iconRecording]}>🎤</Text>
      </Animated.View>
      <Text style={[styles.label, isRecording && styles.labelRecording]}>
        {isRecording ? "停止" : "录音"}
      </Text>
    </TouchableOpacity>
  );
});

interface ToolbarButtonProps {
  label: string;
  icon: string;
  active: boolean;
  disabled?: boolean;
  /** 未选中态（键盘模式）：灰色半透明图标，无高亮背景 */
  inactive?: boolean;
  onPress: () => void;
  /** a11y 自定义标签 */
  accessibilityLabel?: string;
}

// fix(P1-4): React.memo 避免每次父组件渲染都重建按钮
const ToolbarButton = React.memo(function ToolbarButton({
  label,
  icon,
  active,
  disabled,
  inactive,
  onPress,
  accessibilityLabel,
}: ToolbarButtonProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.6}
      disabled={disabled}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={[
        styles.button,
        active && styles.buttonActive,
        inactive && styles.buttonInactive,
        disabled && styles.buttonDisabled,
      ]}
    >
      <Text style={[styles.icon, inactive && styles.iconInactive, disabled && styles.iconDisabled]}>
        {icon}
      </Text>
      <Text style={[styles.label, inactive && styles.labelInactive, disabled && styles.labelDisabled]}>
        {label}
      </Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    // fix(Bug-2): CanvasScreen 的 editorLayer 是 zIndex: 5，会盖在工具栏上面
    // 拦截触控。给工具栏更高 zIndex 让 📷/🎤 按钮在文字模式下也能点到。
    // 其他 UI（ThreeDotMenu / DraftToggle / FormatToolbar）同理高于 editorLayer。
    // FormatToolbar 自己已经 zIndex: 20，所以这里取 10 即可（>5 但 <20）。
    zIndex: 10,
    elevation: 6,
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
  buttonInactive: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "#DDD",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  icon: {
    fontSize: 22,
  },
  iconInactive: {
    opacity: 0.45,
  },
  iconDisabled: {
    opacity: 0.4,
  },
  label: {
    fontSize: 10,
    marginTop: 2,
    color: "#333",
  },
  labelInactive: {
    color: "#999",
  },
  labelDisabled: {
    color: "#999",
  },
  buttonRecording: {
    backgroundColor: "rgba(220, 53, 69, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(220, 53, 69, 0.4)",
  },
  iconRecording: {
    // 红色不透明度靠父按钮背景 + Text 默认色（系统颜色）即可
  },
  labelRecording: {
    color: "#d32f2f",
    fontWeight: "700",
  },
});
