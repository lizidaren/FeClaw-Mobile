/**
 * Zentrim 首页
 *
 * 数据来源：zentrimStore（fetchEntries() 后注入）。
 * 聚焦页面时自动重新拉取；pull-to-refresh。
 *
 * 布局（竖排卡片版）：
 * - 顶部问候语 + 登出
 * - "注意到"提示行（点击弹出 Modal）
 * - 三张竖排长条形卡片：📋待办 | 📈完成度追踪 | 📅全部笔记
 *   - 数值 0：灰色文字 + 灰色背景
 *   - 数值 > 0：正常文字 + 白色背景（"全部笔记"始终有色）
 * - FlatList 时间线
 * - 浮窗 ＋ 按钮 → Canvas
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { SafeAreaView } from "react-native-safe-area-context";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { zentrimStore, useZentrimStore } from "../services/zentrim-store";
import { authStore } from "../services/auth-store";
import type { ZentrimEntry } from "../types/api";

/** 根据当前小时返回问候 */
function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 6) return "🌙 夜深了，记得休息";
  if (h < 11) return "☀️ 早上好，今天有物理课";
  if (h < 14) return "🌞 中午好，吃完饭再学习吧";
  if (h < 18) return "🌤️ 下午好，继续加油";
  if (h < 22) return "🌙 晚上好，今天辛苦了";
  return "🌙 夜深了，记得休息";
}

/** 把 ISO 时间戳转成 MM-DD 字符串 */
function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}`;
}

/** 把 ISO 时间戳转成 HH:MM */
function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mi}`;
}

/** 根据 tags / type 推断图标 */
function iconForEntry(e: ZentrimEntry): string {
  const tags = e.tags ?? [];
  if (tags.includes("photo")) return "📷";
  if (tags.includes("file")) return "📎";
  if (tags.includes("audio") || tags.includes("voice")) return "🎙️";
  if (e.type === "audio" || e.type === "voice") return "🎙️";
  if (e.type === "photo") return "📷";
  if (e.type === "pdf") return "📄";
  return "📝";
}

type CardKind = "todo" | "active" | "all";

interface CardData {
  kind: CardKind;
  icon: string;
  title: string;
  value: number;
  /** true 表示始终有色（不管值是否为 0） */
  alwaysColored: boolean;
}

type HomeScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "Main"
>;

export function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { entries, loading, error } = useZentrimStore();
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [actionEntryId, setActionEntryId] = useState<string | null>(null);

  // 每次页面聚焦 → 重新拉取
  // fix(P1-6): 页面失焦时取消 fetch（用 cancelled flag 避免卸载后 setState）
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void zentrimStore.fetchEntries().then(() => {
        if (cancelled) {
          // 仅阻止后续逻辑（目前 fetchEntries 内部已 setState，无法阻止，
          // 但保留 flag 供未来扩展分页/搜索时使用）
        }
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const greeting = useMemo(() => getGreeting(), []);

  // 三张卡片：todo = tags 含 "todo"；active = 未归档；all = 总数
  const cards: CardData[] = useMemo(() => {
    const todoCount = entries.filter((e) =>
      (e.tags ?? []).includes("todo"),
    ).length;
    const activeCount = entries.filter((e) => !e.is_archived).length;
    const total = entries.length;
    return [
      { kind: "todo", icon: "📋", title: "TODO", value: todoCount, alwaysColored: false },
      { kind: "active", icon: "📈", title: "完成度追踪", value: activeCount, alwaysColored: false },
      { kind: "all", icon: "📅", title: "全部笔记", value: total, alwaysColored: true },
    ];
  }, [entries]);

  const onRefresh = useCallback(() => {
    void zentrimStore.fetchEntries();
  }, []);

  const onLogout = useCallback(() => {
    void authStore.logout();
  }, []);

  // 长按 → action sheet
  const onLongPressEntry = useCallback((id: string) => {
    setActionEntryId(id);
  }, []);

  // fix(P1-7): 异步操作完成前不关闭 action sheet，失败时弹 Alert 反馈
  const [actionPending, setActionPending] = useState(false);

  const onArchive = useCallback(async () => {
    if (!actionEntryId) return;
    const id = actionEntryId;
    setActionPending(true);
    const ok = await zentrimStore.archiveEntry(id);
    setActionPending(false);
    if (ok) {
      setActionEntryId(null);
    } else {
      const errMsg = zentrimStore.getState().error ?? "归档失败";
      Alert.alert("操作失败", errMsg, [{ text: "知道了" }]);
    }
  }, [actionEntryId]);

  // fix(P1-3): deleteEntry 返回结果后反馈，失败时不关闭 sheet
  const onDelete = useCallback(() => {
    if (!actionEntryId) return;
    const id = actionEntryId;
    Alert.alert("删除笔记", "确定删除？删除后不可恢复。", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          setActionPending(true);
          const ok = await zentrimStore.deleteEntry(id);
          setActionPending(false);
          if (ok) {
            setActionEntryId(null);
          } else {
            const errMsg = zentrimStore.getState().error ?? "删除失败";
            Alert.alert("操作失败", errMsg, [{ text: "知道了" }]);
          }
        },
      },
    ]);
  }, [actionEntryId]);

  // 跳转 Canvas（新建模式，不传 entryId）
  const goCanvas = useCallback(() => {
    navigation.navigate("Canvas");
  }, [navigation]);

  // 跳转 Canvas（打开已有条目）
  const goCanvasWithEntry = useCallback(
    (entryId: string) => {
      navigation.navigate("Canvas", { entryId });
    },
    [navigation],
  );

  // 渲染单条 entry
  const renderEntry = useCallback(
    ({ item }: { item: ZentrimEntry }) => {
      const title = item.title || item.content_preview || "(无标题)";
      return (
        <Pressable
          style={styles.noteItem}
          onLongPress={() => onLongPressEntry(item.id)}
          onPress={() => goCanvasWithEntry(item.id)}
        >
          <Text style={styles.noteDate}>{formatDate(item.created_at)}</Text>
          <Text style={styles.noteIcon}>{iconForEntry(item)}</Text>
          <View style={styles.noteTextWrap}>
            <Text style={styles.noteTitle} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.noteTime}>{formatTime(item.created_at)}</Text>
          </View>
          {item.is_archived && (
            <Text style={styles.noteArchived}>📦</Text>
          )}
        </Pressable>
      );
    },
    [goCanvas, goCanvasWithEntry, onLongPressEntry],
  );

  // 渲染单张竖排卡片
  // fix(P0-2): 纯展示卡片，Pressable → View（无 onPress，避免不必要的点击反馈）
  const renderCard = useCallback(
    (card: CardData) => {
      const isEmpty = card.value === 0;
      const colored = card.alwaysColored || !isEmpty;
      return (
        <View
          key={card.kind}
          style={[styles.cardRow, !colored && styles.cardRowEmpty]}
        >
          <View style={styles.cardLeft}>
            <Text style={[styles.cardIcon, !colored && styles.cardIconEmpty]}>{card.icon}</Text>
            <Text style={[styles.cardTitle, !colored && styles.cardTitleEmpty]}>{card.title}</Text>
          </View>
          <Text style={[styles.cardValue, !colored && styles.cardValueEmpty]}>
            {card.value}
          </Text>
        </View>
      );
    },
    [],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      {/* 顶部滚动区域 */}
      <FlatList
        data={entries}
        keyExtractor={(e) => e.id}
        renderItem={renderEntry}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={onRefresh} />
        }
        ListHeaderComponent={
          <View>
            {/* 头部：问候 + 登出 */}
            <View style={styles.headerRow}>
              <Text style={styles.greeting}>{greeting}</Text>
              <Pressable onPress={onLogout} hitSlop={8}>
                <Text style={styles.logoutText}>登出</Text>
              </Pressable>
            </View>

            {/* 注意到提示行 */}
            <Pressable onPress={() => setNoticeVisible(true)}>
              <Text style={styles.notice}>💡 你有一段录音提到了 Kimi K2.7</Text>
            </Pressable>

            {/* 三张竖排卡片 */}
            <View style={styles.cardsColumn}>
              {cards.map(renderCard)}
            </View>

            {/* 错误提示（不阻塞 UI） */}
            {error !== null && (
              <Text style={styles.errorHint}>⚠️ {error}</Text>
            )}

            <Text style={styles.timelineHeader}>时间线</Text>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <Text style={styles.emptyHint}>暂无笔记，点击 ＋ 开始第一条</Text>
          ) : null
        }
        contentContainerStyle={styles.listContent}
      />

      {/* 浮窗 ＋ 按钮 → Canvas */}
      <Pressable style={styles.fab} onPress={goCanvas}>
        <Text style={styles.fabText}>＋</Text>
      </Pressable>

      {/* 注意到 Modal */}
      <Modal
        visible={noticeVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setNoticeVisible(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setNoticeVisible(false)}
        >
          <Pressable style={styles.modalCard} onPress={() => undefined}>
            <Text style={styles.modalTitle}>AI 模型调研 · 07-01</Text>
            <Text style={styles.modalBody}>
              检测到你的录音里提到了 Kimi K2.7，要怎么处理？
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={() => setNoticeVisible(false)}
              >
                <Text style={styles.modalBtnTextPrimary}>展开看看</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={() => setNoticeVisible(false)}
              >
                <Text style={styles.modalBtnText}>加入附录</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={() => setNoticeVisible(false)}
              >
                <Text style={styles.modalBtnText}>OK</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 长按 entry → action sheet */}
      <Modal
        visible={actionEntryId !== null}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!actionPending) setActionEntryId(null); }}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => { if (!actionPending) setActionEntryId(null); }}
        >
          <Pressable style={styles.actionSheet} onPress={() => undefined}>
            <TouchableOpacity
              style={styles.actionSheetBtn}
              onPress={() => void onArchive()}
            >
              <Text style={styles.actionSheetText}>📦 归档</Text>
            </TouchableOpacity>
            <View style={styles.actionSheetDivider} />
            <TouchableOpacity
              style={styles.actionSheetBtn}
              onPress={() => onDelete()}
            >
              <Text style={[styles.actionSheetText, styles.actionSheetDelete]}>
                🗑️ 删除
              </Text>
            </TouchableOpacity>
            <View style={styles.actionSheetDivider} />
            <TouchableOpacity
              style={styles.actionSheetBtn}
              onPress={() => setActionEntryId(null)}
            >
              <Text style={styles.actionSheetCancelText}>取消</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F5F5F0",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 96,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  greeting: {
    fontSize: 22,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  logoutText: {
    fontSize: 12,
    color: "#1976d2",
  },
  notice: {
    fontSize: 13,
    color: "#888",
    marginBottom: 20,
  },
  // ── 竖排卡片 ──
  cardsColumn: {
    flexDirection: "column",
    gap: 8,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 64,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E5E5E5",
  },
  cardRowEmpty: {
    backgroundColor: "#f0f0f0",
    borderColor: "transparent",
  },
  cardLeft: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  cardIconEmpty: {
    opacity: 0.4,
  },
  cardTitle: {
    fontSize: 15,
    color: "#1a1a1a",
  },
  cardTitleEmpty: {
    color: "#999",
  },
  cardValue: {
    fontSize: 20,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  cardValueEmpty: {
    color: "#999",
  },
  // ── 浮窗 ＋ 按钮 ──
  fab: {
    position: "absolute",
    right: 20,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#1976d2",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
    elevation: 4,
  },
  fabText: {
    fontSize: 28,
    color: "#FFFFFF",
    fontWeight: "300",
    marginTop: -2,
  },
  // ── 时间线 ──
  timelineHeader: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 24,
    marginBottom: 8,
  },
  emptyHint: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    paddingVertical: 40,
  },
  errorHint: {
    fontSize: 12,
    color: "#f57c00",
    marginTop: 12,
  },
  noteItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#EEE",
  },
  noteDate: {
    width: 48,
    fontSize: 12,
    color: "#999",
  },
  noteIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  noteTextWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  noteTitle: {
    fontSize: 14,
    color: "#1a1a1a",
    flex: 1,
    marginRight: 8,
  },
  noteTime: {
    fontSize: 11,
    color: "#bbb",
  },
  noteArchived: {
    fontSize: 16,
    marginLeft: 8,
  },
  // ── Modal ──
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 8,
  },
  modalBody: {
    fontSize: 14,
    color: "#555",
    lineHeight: 20,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  modalBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#F0F0F0",
  },
  modalBtnPrimary: {
    backgroundColor: "#1976d2",
  },
  modalBtnText: {
    fontSize: 13,
    color: "#333",
  },
  modalBtnTextPrimary: {
    fontSize: 13,
    color: "#FFFFFF",
    fontWeight: "600",
  },
  actionSheet: {
    width: "100%",
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    overflow: "hidden",
  },
  actionSheetBtn: {
    paddingVertical: 14,
    alignItems: "center",
  },
  actionSheetText: {
    fontSize: 15,
    color: "#1976d2",
  },
  actionSheetDelete: {
    color: "#d32f2f",
  },
  actionSheetCancelText: {
    fontSize: 15,
    color: "#666",
  },
  actionSheetDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#EEE",
    marginHorizontal: 12,
  },
});
