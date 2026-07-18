/**
 * 右上角 ⋮ 菜单
 *
 * 点击 ⋮ 弹出底部面板（bottom sheet 风格 Modal），包含：
 * - 画布信息（创建时间、设备、查看次数、编辑时长）
 * - 子时间线归属/更改
 * - 导出 SVG / PNG
 * - 插入文件
 */

import React, { useEffect, useState } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {

  MENU_A11Y,
  MENU_CREATED_AT,
  MENU_DEVICE,
  MENU_VIEW_COUNT,
  MENU_EDIT_DURATION,
  MENU_TIMELINE,
  MENU_TIMELINE_UNCATEGORIZED,
  MENU_CHANGE_TIMELINE,
  MENU_EXPORT_SVG,
  MENU_EXPORT_PNG,
  MENU_INSERT_FILE,
  MENU_CANCEL,
  MENU_COUNT_SUFFIX,
  MENU_MINUTES_SUFFIX,
} from "../constants/strings";
import { Icon } from "../components/Icon";

/** 画布信息（展示用） */
export interface CanvasInfo {
  /** 创建时间（ms） */
  createdAt: number;
  /** 采集设备（如 "iPad Pro 12.9"） */
  device: string;
  /** 查看次数 */
  viewCount: number;
  /** 累计编辑时长（分钟） */
  editMinutes: number;
  /** 所属子时间线名称 */
  timelineName?: string;
}

export interface ThreeDotMenuProps {
  info: CanvasInfo;
  onChangeTimeline: () => void;
  onExportSvg: () => void;
  onExportPng: () => void;
  onInsertFile: () => void;
  /** 未实现的功能按钮设为 disabled（灰色不可点） */
  disabledItems?: string[];
}

export function ThreeDotMenu({
  info,
  onChangeTimeline,
  onExportSvg,
  onExportPng,
  onInsertFile,
  disabledItems = [],
}: ThreeDotMenuProps) {
  const [open, setOpen] = useState(false);

  const close = () => setOpen(false);

  // fix(P0-8): 监听 Keyboard 事件，菜单打开时挂监听、关闭/卸载时清理。
  // 之前的实现裸调用 addListener 但没有 cleanup，组件卸载后会触发
  // 已卸载组件的 setState 警告，且 listener 永久泄漏。
  useEffect(() => {
    if (!open) return;
    const showSub = Keyboard.addListener("keyboardDidShow", () => {
      // 键盘弹出时把面板收起，避免遮挡
      close();
    });
    return () => {
      showSub.remove();
    };
  }, [open]);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };

  return (
    <>
      <TouchableOpacity
        style={styles.trigger}
        activeOpacity={0.6}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={MENU_A11Y}
      >
        <Text style={styles.triggerIcon}>⋮</Text>
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={close}
      >
        <Pressable style={styles.backdrop} onPress={close} />
        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* 画布信息 */}
          {/* fix(P1-2): 使用常量替代硬编码字符串 */}
          <View style={styles.infoBlock}>
            <InfoRow label={MENU_CREATED_AT} value={formatDate(info.createdAt)} />
            <InfoRow label={MENU_DEVICE} value={info.device} />
            <InfoRow label={MENU_VIEW_COUNT} value={`${info.viewCount}${MENU_COUNT_SUFFIX}`} />
            <InfoRow label={MENU_EDIT_DURATION} value={`${info.editMinutes}${MENU_MINUTES_SUFFIX}`} />
            <InfoRow
              label={MENU_TIMELINE}
              value={info.timelineName ?? MENU_TIMELINE_UNCATEGORIZED}
            />
          </View>

          <View style={styles.divider} />

          {/* 操作项 */}
          {/* fix(P2-2): 未实现的操作以 disabled 灰色显示，不再 console.warn */}
          <MenuItem icon="📁" label={MENU_CHANGE_TIMELINE} onPress={run(onChangeTimeline)} disabled={disabledItems.includes("timeline")} />
          <MenuItem icon="🖼" label={MENU_EXPORT_SVG} onPress={run(onExportSvg)} />
          <MenuItem icon="🏞" label={MENU_EXPORT_PNG} onPress={run(onExportPng)} disabled={disabledItems.includes("png")} />
          <MenuItem icon="📎" label={MENU_INSERT_FILE} onPress={run(onInsertFile)} />

          <TouchableOpacity style={styles.cancel} onPress={close}>
            <Text style={styles.cancelText}>{MENU_CANCEL}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </>
  );
}

// fix(P1-4): React.memo 避免不必要的重绘
const InfoRow = React.memo(function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
});

// fix(P1-4): React.memo 避免不必要的重绘
const MenuItem = React.memo(function MenuItem({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: string;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.item, disabled && styles.itemDisabled]}
      activeOpacity={0.6}
      disabled={disabled}
      onPress={onPress}
    >
      <Text style={[styles.itemIcon, disabled && styles.itemLabelDisabled]}>{icon}</Text>
      <Text style={[styles.itemLabel, disabled && styles.itemLabelDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
});

function formatDate(ms: number): string {
  try {
    const d = new Date(ms);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
      d.getHours(),
    )}:${pad(d.getMinutes())}`;
  } catch (e) {
    console.warn("[ThreeDotMenu] 日期格式化失败", e);
    return "-";
  }
}

const styles = StyleSheet.create({
  trigger: {
    position: "absolute",
    right: 12,
    top: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.95)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  triggerIcon: {
    fontSize: 22,
    color: "#333",
    lineHeight: 24,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  sheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 20,
    paddingBottom: 32,
    paddingTop: 8,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#DDD",
    marginBottom: 12,
  },
  infoBlock: {
    paddingVertical: 4,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 6,
  },
  infoLabel: {
    fontSize: 14,
    color: "#999",
  },
  infoValue: {
    fontSize: 14,
    color: "#333",
    fontWeight: "500",
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#EEE",
    marginVertical: 12,
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
  },
  itemDisabled: {
    opacity: 0.4,
  },
  itemIcon: {
    fontSize: 20,
    width: 32,
  },
  itemLabel: {
    fontSize: 16,
    color: "#333",
  },
  itemLabelDisabled: {
    color: "#999",
  },
  cancel: {
    marginTop: 12,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: "#F5F5F5",
    borderRadius: 12,
  },
  cancelText: {
    fontSize: 16,
    color: "#666",
    fontWeight: "600",
  },
});
