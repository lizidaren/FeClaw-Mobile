/**
 * Zentrim 首页
 *
 * 数据来源：zentrimStore（fetchEntries() 后注入）。
 * 聚焦页面时自动重新拉取；后端不可达时回退到 mock 数据，不白屏。
 *
 * 上下布局：
 * - 顶部问候语（随时间变化）
 * - "注意到"提示行（点击弹出 Modal）
 * - 三张白色圆角卡片：📋待办 | 📈完成度 | 📅全部
 * - 底部居中蓝色 + 按钮 → 跳转 CanvasScreen
 * - 点卡片弹出底部 Sheet（按 created_at 分组显示真实 entries）
 */

import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
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

/** 模拟数据：后端不可达时兜底显示 */
interface NoteEntry {
  date: string;
  icon: string;
  title: string;
  status?: "done" | "pending";
}

const MOCK_NOTES: NoteEntry[] = [
  { date: "07-09", icon: "📷", title: "化学试卷批改", status: "done" },
  { date: "07-09", icon: "🎙️", title: "英语课堂录音", status: "pending" },
  { date: "07-08", icon: "📝", title: "三角函数总结" },
];

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

/** type → emoji 映射（未知类型显示 📝） */
function iconForType(type?: string): string {
  switch (type) {
    case "todo":
      return "📋";
    case "audio":
    case "voice":
      return "🎙️";
    case "photo":
      return "📷";
    case "pdf":
      return "📄";
    case "note":
      return "📝";
    default:
      return "📝";
  }
}

type CardKind = "todo" | "completion" | "all";

interface CardData {
  kind: CardKind;
  icon: string;
  title: string;
  value: string;
  hint: string;
}

type HomeScreenNavigationProp = NativeStackNavigationProp<
  RootStackParamList,
  "Main"
>;

export function HomeScreen() {
  const navigation = useNavigation<HomeScreenNavigationProp>();
  const { entries, loading, error } = useZentrimStore();
  const [noticeVisible, setNoticeVisible] = useState(false);
  const [sheetKind, setSheetKind] = useState<CardKind | null>(null);

  // 每次页面聚焦 → 重新拉取
  useFocusEffect(
    useCallback(() => {
      void zentrimStore.fetchEntries();
    }, []),
  );

  const greeting = useMemo(() => getGreeting(), []);

  // 三张卡片的数据（全部来自真实 entries；空数组时显示 0）
  const cards: CardData[] = useMemo(() => {
    const todoCount = entries.filter((e) => e.type === "todo").length;
    const activeCount = entries.filter((e) => !e.is_archived).length;
    const total = entries.length;
    return [
      { kind: "todo", icon: "📋", title: "待办", value: String(todoCount), hint: "未完成" },
      {
        kind: "completion",
        icon: "📈",
        title: "完成度",
        value: String(activeCount),
        hint: "未归档",
      },
      { kind: "all", icon: "📅", title: "全部", value: String(total), hint: "条笔记" },
    ];
  }, [entries]);

  const sheetTitle = useMemo(() => {
    if (sheetKind === "all") return "📅 全部笔记";
    if (sheetKind === "todo") return "📋 待办";
    if (sheetKind === "completion") return "📈 完成度";
    return "";
  }, [sheetKind]);

  // Sheet 内显示的列表：先尝试真实数据，失败/空时回退到 mock
  const sheetItems: Array<{
    key: string;
    date: string;
    icon: string;
    title: string;
    status?: "done" | "pending";
  }> = useMemo(() => {
    if (entries.length > 0) {
      // 按 sheetKind 过滤
      let list = entries;
      if (sheetKind === "todo") {
        list = list.filter((e) => e.type === "todo");
      } else if (sheetKind === "completion") {
        list = list.filter((e) => !e.is_archived);
      }
      return list.map((e: ZentrimEntry) => ({
        key: e.id,
        date: formatDate(e.created_at),
        icon: iconForType(e.type),
        title: e.title || e.content_preview || "(无标题)",
        status: e.is_archived ? "done" : "pending",
      }));
    }
    // fallback
    return MOCK_NOTES.map((n, idx) => ({
      key: `mock-${idx}`,
      date: n.date,
      icon: n.icon,
      title: n.title,
      status: n.status,
    }));
  }, [entries, sheetKind]);

  const onRefresh = useCallback(() => {
    void zentrimStore.fetchEntries();
  }, []);

  const onLogout = useCallback(() => {
    void authStore.logout();
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <ScrollView
        contentContainerStyle={styles.scroll}
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

        {/* 注意到提示行 */}
        <Pressable onPress={() => setNoticeVisible(true)}>
          <Text style={styles.notice}>💡 你有一段录音提到了 Kimi K2.7</Text>
        </Pressable>

        {/* 三张卡片 */}
        <View style={styles.cardsRow}>
          {cards.map((card) => (
            <Pressable
              key={card.kind}
              style={styles.card}
              onPress={() => setSheetKind(card.kind)}
            >
              <Text style={styles.cardIcon}>{card.icon}</Text>
              <Text style={styles.cardTitle}>{card.title}</Text>
              <Text style={styles.cardValue}>{card.value}</Text>
              <Text style={styles.cardHint}>{card.hint}</Text>
            </Pressable>
          ))}
        </View>

        {/* 错误提示（不阻塞 UI） */}
        {error !== null && entries.length === 0 && (
          <Text style={styles.errorHint}>
            ⚠️ 后端未连通，已显示示例数据（{error}）
          </Text>
        )}

        {/* 预留空间，把 + 按钮挤到底部 */}
        <View style={styles.spacer} />
      </ScrollView>

      {/* 底部 + 按钮 */}
      <SafeAreaView edges={["bottom"]} style={styles.bottomBar}>
        <TouchableOpacity
          style={styles.addButton}
          activeOpacity={0.85}
          onPress={() => navigation.navigate("Canvas")}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.addButtonText}>＋</Text>
          )}
        </TouchableOpacity>
      </SafeAreaView>

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

      {/* 时间线 Sheet（点卡片弹出） */}
      <Modal
        visible={sheetKind !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSheetKind(null)}
      >
        <Pressable
          style={styles.sheetBackdrop}
          onPress={() => setSheetKind(null)}
        >
          <Pressable style={styles.sheet} onPress={() => undefined}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{sheetTitle}</Text>
              <Pressable
                style={styles.sheetClose}
                onPress={() => setSheetKind(null)}
                hitSlop={8}
              >
                <Text style={styles.sheetCloseText}>✕</Text>
              </Pressable>
            </View>
            <ScrollView style={styles.sheetList}>
              {sheetItems.length === 0 ? (
                <Text style={styles.sheetEmpty}>暂无内容</Text>
              ) : (
                sheetItems.map((note) => (
                  <Pressable
                    key={note.key}
                    style={styles.noteItem}
                    onPress={() => {
                      setSheetKind(null);
                      navigation.navigate("Canvas");
                    }}
                  >
                    <Text style={styles.noteDate}>{note.date}</Text>
                    <Text style={styles.noteIcon}>{note.icon}</Text>
                    <View style={styles.noteTextWrap}>
                      <Text style={styles.noteTitle} numberOfLines={1}>
                        {note.title}
                      </Text>
                      {note.status === "done" && (
                        <Text style={styles.noteStatusDone}>✓已处理</Text>
                      )}
                      {note.status === "pending" && (
                        <Text style={styles.noteStatusPending}>⏳转换中</Text>
                      )}
                    </View>
                  </Pressable>
                ))
              )}
            </ScrollView>
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
  scroll: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 16,
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
  cardsRow: {
    flexDirection: "row",
    gap: 10,
  },
  card: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: 10,
    alignItems: "center",
    shadowColor: "#000",
    shadowOpacity: 0.05,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  cardIcon: {
    fontSize: 22,
    marginBottom: 6,
  },
  cardTitle: {
    fontSize: 12,
    color: "#666",
    marginBottom: 4,
  },
  cardValue: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 2,
  },
  cardHint: {
    fontSize: 11,
    color: "#999",
  },
  errorHint: {
    fontSize: 12,
    color: "#f57c00",
    marginTop: 12,
  },
  spacer: {
    flexGrow: 1,
    minHeight: 80,
  },
  bottomBar: {
    alignItems: "center",
    paddingBottom: 12,
    backgroundColor: "#F5F5F0",
  },
  addButton: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#1976d2",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  addButtonText: {
    color: "#FFFFFF",
    fontSize: 30,
    fontWeight: "300",
    lineHeight: 34,
  },
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
  sheetBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: "70%",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  sheetClose: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  sheetCloseText: {
    fontSize: 16,
    color: "#666",
  },
  sheetList: {
    flexGrow: 0,
  },
  sheetEmpty: {
    fontSize: 14,
    color: "#999",
    textAlign: "center",
    paddingVertical: 24,
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
  noteStatusDone: {
    fontSize: 12,
    color: "#388e3c",
  },
  noteStatusPending: {
    fontSize: 12,
    color: "#f57c00",
  },
});
