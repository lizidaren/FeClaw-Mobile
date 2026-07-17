/**
 * 录音状态气泡
 *
 * 三种形态：
 * - 录音态（recording）：左上角小椭圆，🎧 + 时间码
 * - 已录态（recorded）：波形占位 + 时间码 + 🔊 播放按钮
 * - 回放态（playback）：拉长占顶，含 [📝ASR] [🔊音轨] [📷照片] 三个入口按钮
 *   - 转写完成前（asrReady=false）不显示 ASR 按钮
 */

import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  RECORDING_ASR,
  RECORDING_AUDIO,
  RECORDING_PHOTOS,
} from "../constants/strings";

export type RecordingMode = "recording" | "recorded" | "playback";

export interface RecordingBubbleProps {
  mode: RecordingMode;
  /** 已录制/已播放时长（秒） */
  seconds: number;
  /** 回放态：ASR 转写是否已完成（未完成不显示 ASR 按钮） */
  asrReady?: boolean;
  /** 回放态按钮回调 */
  onOpenAsr?: () => void;
  onOpenAudio?: () => void;
  onOpenPhotos?: () => void;
}

// fix(P1-4): React.memo 避免不必要的重绘
export const RecordingBubble = React.memo(function RecordingBubble({
  mode,
  seconds,
  asrReady = false,
  onOpenAsr,
  onOpenAudio,
  onOpenPhotos,
}: RecordingBubbleProps) {
  const timecode = formatTimecode(seconds);

  if (mode === "recording") {
    return (
      <View style={styles.recording}>
        <Text style={styles.recDot}>🎧</Text>
        <Text style={styles.recTime}>{timecode}</Text>
      </View>
    );
  }

  if (mode === "recorded") {
    return (
      <View style={styles.recorded}>
        <Text style={styles.recTime}>{timecode}</Text>
        <View style={styles.waveform} accessibilityLabel="音频波形占位" />
        <TouchableOpacity
          style={styles.playBtn}
          onPress={onOpenAudio}
          accessibilityRole="button"
          accessibilityLabel="播放录音"
        >
          <Text style={styles.playIcon}>🔊</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.playback}>
      <Text style={styles.playTime}>{timecode}</Text>
      <View style={styles.actions}>
        {asrReady ? (
          // fix(P1-2): 使用常量替代硬编码字符串
          <PillButton icon="📝" label={RECORDING_ASR} onPress={onOpenAsr} />
        ) : null}
        <PillButton icon="🔊" label={RECORDING_AUDIO} onPress={onOpenAudio} />
        <PillButton icon="📷" label={RECORDING_PHOTOS} onPress={onOpenPhotos} />
      </View>
    </View>
  );
});

// fix(P1-4): React.memo 避免每次父组件渲染都重建按钮
const PillButton = React.memo(function PillButton({
  icon,
  label,
  onPress,
}: {
  icon: string;
  label: string;
  onPress?: () => void;
}) {
  return (
    <TouchableOpacity
      style={styles.pill}
      activeOpacity={0.6}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Text style={styles.pillIcon}>{icon}</Text>
      <Text style={styles.pillLabel}>{label}</Text>
    </TouchableOpacity>
  );
});

/** 秒 → mm:ss */
function formatTimecode(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

const styles = StyleSheet.create({
  recording: {
    position: "absolute",
    left: 12,
    top: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(220, 53, 69, 0.92)",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  recDot: {
    fontSize: 14,
    marginRight: 6,
  },
  recTime: {
    color: "#FFFFFF",
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  playback: {
    position: "absolute",
    left: 12,
    right: 12,
    top: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "rgba(33, 37, 41, 0.92)",
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  recorded: {
    position: "absolute",
    left: 12,
    top: 12,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(33, 37, 41, 0.92)",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
    elevation: 3,
  },
  waveform: {
    width: 80,
    height: 18,
    backgroundColor: "rgba(255,255,255,0.25)",
    borderRadius: 4,
    marginHorizontal: 8,
  },
  playBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  playIcon: {
    fontSize: 14,
  },
  playTime: {
    color: "#FFFFFF",
    fontSize: 14,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    marginLeft: 8,
  },
  pillIcon: {
    fontSize: 13,
    marginRight: 4,
  },
  pillLabel: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "500",
  },
});
