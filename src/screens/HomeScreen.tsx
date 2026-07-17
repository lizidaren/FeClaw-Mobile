/**
 * Zentrim 首页
 *
 * 数据来源：zentrimStore（fetchEntries() 后注入）。
 * 聚焦页面时自动重新拉取；pull-to-refresh。
 *
 * 布局（极简主页版）：
 * - 顶部问候语 + 登出
 * - "注意到"提示行（点击弹出 Modal；空数据时整行隐藏）
 * - 三张竖排长条形卡片：📋待办 | 📈完成度追踪 | 📅全部笔记
 *   - 每张卡片可点击：
 *     - 待办 → Alert("待办功能开发中")
 *     - 完成度 → Alert("完成度追踪开发中")
 *     - 全部笔记 → 打开"全部笔记"Modal（时间线列表）
 * - 浮窗 ＋ 按钮 → Canvas
 *
 * 时间线（FlatList）只在"全部笔记"Modal 中展示，主页不再直接渲染。
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
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

/**
 * 构造"注意到"提示文案。
 * 如果后端没有提供 notice 字段，则基于 entry 数据动态生成一个温和的提示；
 * 没有数据时整行隐藏（返回 null）。
 *
 * 数据来源真实：依赖 entries 长度与最近一条的 created_at，不含硬编码 mock。
 */
function buildNoticeLine(entries: ZentrimEntry[]): string | null {
  if (entries.length === 0) return null;
  const todoCount = entries.filter((e) =>
    (e.tags ?? []).includes("todo"),
  ).length;
  if (todoCount > 0) {
    return `💡 你有 ${todoCount} 条待办事项还没处理`;
  }
  const latest = entries[0];
  const dateLabel = formatDate(latest.created_at);
  return `💡 最近的笔记更新于 ${dateLabel}`;
}

export function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { entries, loading, error } = useZentrimStore();
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [allNotesVisible, setAllNotesVisible] = useState(false);
  const [actionEntryId, setActionEntryId] = useState<string | null>(null);

  // 每次页面聚焦 → 重新拉取
  useFocusEffect(
    useCallback(() => {
      void zentrimStore.fetchEntries();
    }, []),
  );

  const greeting = useMemo(() => getGreeting(), []);
  const noticeLine = useMemo(() => buildNoticeLine(entries), [entries]);

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

  // 长按 entry → action sheet
  const onLongPressEntry = useCallback((id: string) => {
    setActionEntryId(id);
  }, []);

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
      // 先关闭弹窗，避免栈重叠导致视觉错乱
      setAllNotesVisible(false);
      navigation.navigate("Canvas", { entryId });
    },
    [navigation],
  );

  // ── 卡片点击处理 ──
  const onCardPress = useCallback((kind: CardKind) => {
    switch (kind) {
      case "todo":
        Alert.alert("提示", "待办功能开发中", [{ text: "知道了" }]);
        break;
      case "active":
        Alert.alert("提示", "完成度追踪开发中", [{ text: "知道了" }]);
        break;
      case "all":
        setAllNotesVisible(true);
        break;
    }
  }, []);

  // ── "注意到"弹窗按钮处理 ──
  const onNoticeExpand = useCallback(() => {
    // fix(P1): 不再是空 stub——关闭弹窗 + 控制台日志，便于后续接入搜索/详情页
    console.log("[HomeScreen] notice: 展开看看");
    setNoticeVisible(false);
  }, []);

  const onNoticeAttach = useCallback(() => {
    // fix(P1): 不再是空 stub——给用户可见反馈，避免"点了没反应"的误判
    console.log("[HomeScreen] notice: 加入附录");
    setNoticeVisible(false);
    Alert.alert("已加入附录", "这条提示已加入今天的附录。", [{ text: "好的" }]);
  }, []);

  const onNoticeOk = useCallback(() => {
    console.log("[HomeScreen] notice: OK");
    setNoticeVisible(false);
  }, []);

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
    [goCanvasWithEntry, onLongPressEntry],
  );

  // 渲染单张竖排卡片（现在可点击）
  const renderCard = useCallback(
    (card: CardData) => {
      const isEmpty = card.value === 0;
      const colored = card.alwaysColored || !isEmpty;
      return (
        <Pressable
          key={card.kind}
          style={({ pressed }) => [
            styles.cardRow,
            !colored && styles.cardRowEmpty,
            pressed && styles.cardRowPressed,
          ]}
          onPress={() => onCardPress(card.kind)}
          accessibilityRole="button"
          accessibilityLabel={`${card.title}，${card.value} 条`}
        >
          <View style={styles.cardLeft}>
            <Text style={[styles.cardIcon, !colored && styles.cardIconEmpty]}>{card.icon}</Text>
            <Text style={[styles.cardTitle, !colored && styles.cardTitleEmpty]}>{card.title}</Text>
          </View>
          <Text style={[styles.cardValue, !colored && styles.cardValueEmpty]}>
            {card.value}
          </Text>
        </Pressable>
      );
    },
    [onCardPress],
  );

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={loading} onRefresh={onRefresh} />
        }
      >
        {/* 头部：问候 + 登出 */}
        <View style={styles.headerRow}>
          <Text style={styles.greeting}>{greeting}</Text>
          <Pressable onPress={onLogout} hitSlop={8}>
            <Text style={styles.logoutText}>登出</Text>
          </Pressable>
        </View>

        {/* 注意到提示行（无数据时不渲染，避免显示硬编码文案） */}
        {noticeLine !== null ? (
          <Pressable onPress={() => setNoticeVisible(true)}>
            <Text style={styles.notice}>{noticeLine}</Text>
          </Pressable>
        ) : (
          <Text style={styles.noticeEmpty}>开始你的第一条笔记吧</Text>
        )}

        {/* 三张竖排卡片（每张可点击） */}
        <View style={styles.cardsColumn}>
          {cards.map(renderCard)}
        </View>

        {/* 错误提示（不阻塞 UI） */}
        {error !== null && (
          <Text style={styles.errorHint}>⚠️ {error}</Text>
        )}
      </ScrollView>

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
            <Text style={styles.modalTitle}>Zentrim 提示</Text>
            <Text style={styles.modalBody}>
              {noticeLine
                ? noticeLine.replace(/^💡\s*/, "")
                : "暂时没有需要关注的提示"}
            </Text>
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.modalBtnPrimary]}
                onPress={onNoticeExpand}
              >
                <Text style={styles.modalBtnTextPrimary}>展开看看</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={onNoticeAttach}
              >
                <Text style={styles.modalBtnText}>加入附录</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtn}
                onPress={onNoticeOk}
              >
                <Text style={styles.modalBtnText}>OK</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* 全部笔记 Modal：时间线列表 */}
      <Modal
        visible={allNotesVisible}
        animationType="slide"
        onRequestClose={() => setAllNotesVisible(false)}
      >
        <SafeAreaView style={styles.allNotesRoot} edges={["top", "left", "right"]}>
          <View style={styles.allNotesHeader}>
            <Text style={styles.allNotesTitle}>全部笔记 · {entries.length}</Text>
            <Pressable
              onPress={() => setAllNotesVisible(false)}
              hitSlop={8}
              style={styles.allNotesClose}
            >
              <Text style={styles.allNotesCloseText}>关闭</Text>
            </Pressable>
          </View>
          <FlatList
            data={entries}
            keyExtractor={(e) => e.id}
            renderItem={renderEntry}
            refreshControl={
              <RefreshControl refreshing={loading} onRefresh={onRefresh} />
            }
            ListEmptyComponent={
              !loading ? (
                <Text style={styles.emptyHint}>暂无笔记，点击 ＋ 开始第一条</Text>
              ) : null
            }
            contentContainerStyle={styles.allNotesList}
          />
        </SafeAreaView>
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
  scrollContent: {
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
  noticeEmpty: {
    fontSize: 13,
    color: "#bbb",
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
  cardRowPressed: {
    opacity: 0.7,
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
  // ── 全部笔记 Modal ──
  allNotesRoot: {
    flex: 1,
    backgroundColor: "#F5F5F0",
  },
  allNotesHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E5E5E5",
  },
  allNotesTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  allNotesClose: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  allNotesCloseText: {
    fontSize: 14,
    color: "#1976d2",
  },
  allNotesList: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 24,
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
