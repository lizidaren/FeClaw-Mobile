/**
 * 草稿纸按钮（左下角）
 *
 * 单击切换草稿模式：
 * - 开启：底色变灰网格，笔划半透明，默认不保存到云端
 * - 关闭：恢复正常模式
 */

import React from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import {
  DRAFT_ENTER_A11Y,
  DRAFT_EXIT_A11Y,
  DRAFT_ACTIVE,
  DRAFT_INACTIVE,
} from "../constants/strings";

export interface DraftToggleProps {
  isDraft: boolean;
  onToggle: () => void;
}

// fix(P1-4): React.memo 避免不必要的重绘
export const DraftToggle = React.memo(function DraftToggle({ isDraft, onToggle }: DraftToggleProps) {
  return (
    <TouchableOpacity
      activeOpacity={0.6}
      onPress={onToggle}
      style={[styles.button, isDraft && styles.buttonActive]}
      accessibilityRole="button"
      // fix(P1-2): 使用常量替代硬编码字符串
      accessibilityLabel={isDraft ? DRAFT_EXIT_A11Y : DRAFT_ENTER_A11Y}
    >
      <Text style={[styles.icon, isDraft && styles.iconActive]}>🗒</Text>
      <Text style={[styles.label, isDraft && styles.labelActive]}>
        {isDraft ? DRAFT_ACTIVE : DRAFT_INACTIVE}
      </Text>
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    left: 12,
    bottom: 24,
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 28,
    backgroundColor: "rgba(255, 255, 255, 0.95)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonActive: {
    backgroundColor: "#FFF4E5",
  },
  icon: {
    fontSize: 22,
  },
  iconActive: {
    // 草稿模式时图标可加重（视觉提示）
  },
  label: {
    fontSize: 10,
    marginTop: 2,
    color: "#666",
  },
  labelActive: {
    color: "#C77B00",
    fontWeight: "600",
  },
});