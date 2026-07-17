/**
 * Chat 会话列表页
 *
 * 顶部："💬 聊天" 标题 + "+" 新建按钮 / "👥 群聊" 切换
 * 列表：每个会话一行（topic / 更新时间 / 最后消息摘要）
 *   - 私聊：单头像圆形 + 标题
 *   - 群聊：群头像（多人头像叠加占位）+ 标题 + "👥 N人"
 * 操作：点行 → ChatSession / GroupChatSession；下拉刷新；空状态文案
 */

import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation, useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { chatStore, useChatStore } from "../services/chat-store";
import type { ChatSessionInfo, GroupInfo } from "../types/api";
import type { RootStackParamList } from "../navigation/AppNavigator";

type Nav = NativeStackNavigationProp<RootStackParamList, "Main">;

/** 顶部 Tab：private（私聊） / group（群聊） */
type ListMode = "private" | "group";

/** 把 ISO 时间转成 MM-DD HH:MM（本地时区） */
function formatTimestamp(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
}

/** 截取最后消息前 60 字做摘要 */
function previewText(s: ChatSessionInfo): string {
  if (s.last_message && s.last_message.length > 0) {
    const oneLine = s.last_message.replace(/\s+/g, " ");
    return oneLine.length > 60 ? `${oneLine.slice(0, 60)}…` : oneLine;
  }
  return "";
}

export function ChatListScreen() {
  const navigation = useNavigation<Nav>();
  const { sessions, loading, error, groups } = useChatStore();
  const [mode, setMode] = useState<ListMode>("private");

  useFocusEffect(
    useCallback(() => {
      void chatStore.fetchSessions();
      void chatStore.fetchGroups();
    }, []),
  );

  // 首次进入若 groups 为空也尝试拉一次
  useEffect(() => {
    if (groups.length === 0) {
      void chatStore.fetchGroups();
    }
  }, [groups.length]);

  const handleNew = useCallback(() => {
    chatStore.createNewSession();
    navigation.navigate("ChatSession", { sessionId: null });
  }, [navigation]);

  const handleOpenPrivate = useCallback(
    (sessionId: string) => {
      navigation.navigate("ChatSession", { sessionId });
    },
    [navigation],
  );

  const handleOpenGroup = useCallback(
    (group: GroupInfo) => {
      chatStore.openGroupSession(group);
      navigation.navigate("GroupChatSession", { groupId: group.group_id });
    },
    [navigation],
  );

  const handleRefresh = useCallback(() => {
    void chatStore.fetchSessions();
    void chatStore.fetchGroups();
  }, []);

  const privateSessions = sessions.filter((s) => s.type !== "group");

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title}>💬 聊天</Text>
        {mode === "private" && (
          <Pressable
            onPress={handleNew}
            hitSlop={12}
            style={styles.newBtn}
            accessibilityLabel="新建聊天"
          >
            <Text style={styles.newBtnText}>＋</Text>
          </Pressable>
        )}
      </View>

      {/* Tab 切换：私聊 / 群聊 */}
      <View style={styles.tabBar}>
        <Pressable
          style={[styles.tab, mode === "private" && styles.tabActive]}
          onPress={() => setMode("private")}
        >
          <Text
            style={[
              styles.tabText,
              mode === "private" && styles.tabTextActive,
            ]}
          >
            私聊
          </Text>
        </Pressable>
        <Pressable
          style={[styles.tab, mode === "group" && styles.tabActive]}
          onPress={() => setMode("group")}
        >
          <Text
            style={[
              styles.tabText,
              mode === "group" && styles.tabTextActive,
            ]}
          >
            群聊
          </Text>
        </Pressable>
      </View>

      {error !== null && (mode === "private" ? privateSessions.length === 0 : groups.length === 0) && (
        <Text style={styles.errorHint}>⚠️ {error}</Text>
      )}

      {mode === "private" ? (
        <PrivateList
          sessions={privateSessions}
          loading={loading}
          onOpen={handleOpenPrivate}
          onRefresh={handleRefresh}
        />
      ) : (
        <GroupList
          groups={groups}
          loading={loading}
          onOpen={handleOpenGroup}
          onRefresh={handleRefresh}
        />
      )}
    </SafeAreaView>
  );
}

// ── 私聊列表 ──────────────────────────────────────────────────

function PrivateList(props: {
  sessions: ChatSessionInfo[];
  loading: boolean;
  onOpen: (sessionId: string) => void;
  onRefresh: () => void;
}) {
  const { sessions, loading, onOpen, onRefresh } = props;

  if (sessions.length === 0 && !loading) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyEmoji}>💬</Text>
        <Text style={styles.emptyText}>还没有聊天记录</Text>
        <Text style={styles.emptyHint}>点右上角 + 开始一次新对话</Text>
      </View>
    );
  }

  return (
    <View style={styles.listWrap}>
      {loading && sessions.length === 0 && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#1976d2" />
        </View>
      )}
      <ScrollView>
        {sessions.map((s, idx) => (
          <Pressable
            key={s.session_id}
            style={[
              styles.row,
              idx === sessions.length - 1 && styles.rowLast,
            ]}
            onPress={() => onOpen(s.session_id)}
            android_ripple={{ color: "#E0E0E0" }}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>
                {(s.topic || "新对话").slice(0, 1)}
              </Text>
            </View>
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {s.topic || "新对话"}
              </Text>
              {!!previewText(s) && (
                <Text style={styles.rowPreview} numberOfLines={1}>
                  {previewText(s)}
                </Text>
              )}
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowTime}>
                {formatTimestamp(s.updated_at ?? s.created_at)}
              </Text>
              {typeof s.message_count === "number" && s.message_count > 0 && (
                <Text style={styles.rowCount}>{s.message_count} 条</Text>
              )}
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable style={styles.refreshHint} onPress={onRefresh}>
        <Text style={styles.refreshHintText}>
          {loading ? "刷新中…" : "点此刷新"}
        </Text>
      </Pressable>
    </View>
  );
}

// ── 群聊列表 ──────────────────────────────────────────────────

function GroupList(props: {
  groups: GroupInfo[];
  loading: boolean;
  onOpen: (group: GroupInfo) => void;
  onRefresh: () => void;
}) {
  const { groups, loading, onOpen, onRefresh } = props;

  if (groups.length === 0 && !loading) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyEmoji}>👥</Text>
        <Text style={styles.emptyText}>还没有群聊</Text>
        <Text style={styles.emptyHint}>点此刷新</Text>
        <Pressable style={styles.refreshBtn} onPress={onRefresh}>
          <Text style={styles.refreshBtnText}>刷新</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.listWrap}>
      {loading && groups.length === 0 && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#1976d2" />
        </View>
      )}
      <ScrollView>
        {groups.map((g, idx) => (
          <Pressable
            key={g.group_id}
            style={[
              styles.row,
              idx === groups.length - 1 && styles.rowLast,
            ]}
            onPress={() => onOpen(g)}
            android_ripple={{ color: "#E0E0E0" }}
          >
            <GroupAvatar name={g.name} />
            <View style={styles.rowMain}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {g.name}
              </Text>
              {!!g.description && (
                <Text style={styles.rowPreview} numberOfLines={1}>
                  {g.description}
                </Text>
              )}
            </View>
            <View style={styles.rowMeta}>
              <Text style={styles.rowCount}>
                👥 {g.member_count ?? g.members?.length ?? "—"}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable style={styles.refreshHint} onPress={onRefresh}>
        <Text style={styles.refreshHintText}>
          {loading ? "刷新中…" : "点此刷新"}
        </Text>
      </Pressable>
    </View>
  );
}

// ── 群头像（多人叠加占位） ───────────────────────────────────

function GroupAvatar({ name }: { name: string }) {
  return (
    <View style={styles.groupAvatar}>
      <View style={[styles.groupAvatarItem, styles.groupAvatarItemTL]}>
        <Text style={styles.groupAvatarText}>{name.slice(0, 1)}</Text>
      </View>
      <View style={[styles.groupAvatarItem, styles.groupAvatarItemBR]}>
        <Text style={styles.groupAvatarText}>👥</Text>
      </View>
    </View>
  );
}

// ── 样式 ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F5F5F0",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: "#1a1a1a",
  },
  newBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#1976d2",
    alignItems: "center",
    justifyContent: "center",
  },
  newBtnText: {
    color: "#FFFFFF",
    fontSize: 22,
    fontWeight: "300",
    lineHeight: 24,
  },
  tabBar: {
    flexDirection: "row",
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  tab: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.05)",
    marginRight: 8,
  },
  tabActive: {
    backgroundColor: "#1976d2",
  },
  tabText: {
    fontSize: 13,
    color: "#666",
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#FFFFFF",
  },
  errorHint: {
    color: "#f57c00",
    fontSize: 12,
    paddingHorizontal: 20,
    marginBottom: 8,
  },
  listWrap: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    marginHorizontal: 12,
    borderRadius: 12,
    overflow: "hidden",
    marginBottom: 12,
  },
  loadingWrap: {
    paddingVertical: 24,
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 72,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#E0E0E0",
    backgroundColor: "#FFFFFF",
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#1976d2",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "700",
  },
  groupAvatar: {
    width: 48,
    height: 48,
    marginRight: 12,
  },
  groupAvatarItem: {
    position: "absolute",
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#1976d2",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFFFF",
  },
  groupAvatarItemTL: {
    top: 0,
    left: 0,
    backgroundColor: "#42a5f5",
  },
  groupAvatarItemBR: {
    bottom: 0,
    right: 0,
    backgroundColor: "#66bb6a",
  },
  groupAvatarText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "700",
  },
  rowMain: {
    flex: 1,
    marginRight: 12,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  rowPreview: {
    fontSize: 13,
    color: "#666",
  },
  rowMeta: {
    alignItems: "flex-end",
  },
  rowTime: {
    fontSize: 12,
    color: "#999",
    marginBottom: 2,
  },
  rowCount: {
    fontSize: 11,
    color: "#1976d2",
  },
  emptyWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 16,
    color: "#666",
    marginBottom: 4,
  },
  emptyHint: {
    fontSize: 13,
    color: "#999",
    marginBottom: 16,
  },
  refreshBtn: {
    paddingHorizontal: 20,
    paddingVertical: 8,
    backgroundColor: "#1976d2",
    borderRadius: 16,
  },
  refreshBtnText: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
  },
  refreshHint: {
    paddingVertical: 10,
    alignItems: "center",
  },
  refreshHintText: {
    fontSize: 12,
    color: "#999",
  },
});