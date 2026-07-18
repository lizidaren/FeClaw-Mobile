/**
 * Chat 会话列表页
 *
 * 顶部："💬 聊天" 标题 + "+" 新建按钮
 * 列表：私聊 + 群聊混排，按更新时间倒序，每个一行
 *   - 私聊：单头像圆形 + 标题
 *   - 群聊：群头像（多人头像叠加占位）+ 标题 + "👥 N人"
 * 操作：点行 → ChatSession / GroupChatSession；下拉刷新；空状态文案
 *
 * fix(Bug-4): 删除原本的 私聊/群聊 Tab 切换，私聊和群聊混排展示。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
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
import {
  CHAT_TITLE,
  CHAT_NEW_BTN,
  CHAT_NEW_A11Y,
  CHAT_DEFAULT_TOPIC,
  CHAT_MESSAGE_COUNT_SUFFIX,
  CHAT_REFRESH_HINT,
  CHAT_REFRESHING,
  CHAT_EMPTY_PRIVATE,
  CHAT_EMPTY_PRIVATE_HINT,
  CHAT_GROUP_COUNT,
  chatSessionDisplayTopic,
} from "../constants/strings";

type Nav = NativeStackNavigationProp<RootStackParamList, "Main">;

/** 统一列表条目：私聊或群聊 */
type UnifiedRow =
  | {
      kind: "private";
      id: string;
      session: ChatSessionInfo;
      updatedAt: number;
    }
  | {
      kind: "group";
      id: string;
      group: GroupInfo;
      updatedAt: number;
    };

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

/** 解析 ISO 时间戳为毫秒；解析失败或缺失返回 0 */
function parseTime(iso?: string): number {
  if (!iso) return 0;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function ChatListScreen() {
  const navigation = useNavigation<Nav>();
  const { sessions, loading, error, groups } = useChatStore();
  // 私聊：过滤掉 group 类型
  const privateSessions = sessions.filter((s) => s.type !== "group");

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
    navigation.navigate("CreateAgent");
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

  // 合并私聊 + 群聊，按更新时间倒序
  const rows = useMemo<UnifiedRow[]>(() => {
    const privateRows: UnifiedRow[] = privateSessions.map((s) => ({
      kind: "private",
      id: `p:${s.session_id}`,
      session: s,
      updatedAt: parseTime(s.updated_at ?? s.created_at),
    }));
    const groupRows: UnifiedRow[] = groups.map((g) => ({
      kind: "group",
      id: `g:${g.group_id}`,
      group: g,
      updatedAt: parseTime(g.updated_at ?? g.created_at),
    }));
    return [...privateRows, ...groupRows].sort(
      (a, b) => b.updatedAt - a.updatedAt,
    );
  }, [privateSessions, groups]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <Text style={styles.title}>{CHAT_TITLE}</Text>
        <Pressable
          onPress={handleNew}
          hitSlop={12}
          style={styles.newBtn}
          accessibilityLabel={CHAT_NEW_A11Y}
        >
          <Text style={styles.newBtnText}>{CHAT_NEW_BTN}</Text>
        </Pressable>
      </View>

      {error !== null && rows.length === 0 && (
        <Text style={styles.errorHint}>⚠️ {error}</Text>
      )}

      <UnifiedList
        rows={rows}
        loading={loading}
        onOpenPrivate={handleOpenPrivate}
        onOpenGroup={handleOpenGroup}
        onRefresh={handleRefresh}
      />
    </SafeAreaView>
  );
}

// ── 统一列表（私聊 + 群聊混排） ─────────────────────────────

function UnifiedList(props: {
  rows: UnifiedRow[];
  loading: boolean;
  onOpenPrivate: (sessionId: string) => void;
  onOpenGroup: (group: GroupInfo) => void;
  onRefresh: () => void;
}) {
  const { rows, loading, onOpenPrivate, onOpenGroup, onRefresh } = props;

  if (rows.length === 0 && !loading) {
    return (
      <View style={styles.emptyWrap}>
        <Text style={styles.emptyEmoji}>💬</Text>
        <Text style={styles.emptyText}>{CHAT_EMPTY_PRIVATE}</Text>
        <Text style={styles.emptyHint}>{CHAT_EMPTY_PRIVATE_HINT}</Text>
      </View>
    );
  }

  return (
    <View style={styles.listWrap}>
      {loading && rows.length === 0 && (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color="#1976d2" />
        </View>
      )}
      <ScrollView>
        {rows.map((row, idx) => (
          <UnifiedRowItem
            key={row.id}
            row={row}
            isLast={idx === rows.length - 1}
            onOpenPrivate={onOpenPrivate}
            onOpenGroup={onOpenGroup}
          />
        ))}
      </ScrollView>
      <Pressable style={styles.refreshHint} onPress={onRefresh}>
        <Text style={styles.refreshHintText}>
          {loading ? CHAT_REFRESHING : CHAT_REFRESH_HINT}
        </Text>
      </Pressable>
    </View>
  );
}

// ── 单行渲染 ──────────────────────────────────────────────

function UnifiedRowItem(props: {
  row: UnifiedRow;
  isLast: boolean;
  onOpenPrivate: (sessionId: string) => void;
  onOpenGroup: (group: GroupInfo) => void;
}) {
  const { row, isLast, onOpenPrivate, onOpenGroup } = props;
  if (row.kind === "private") {
    const s = row.session;
    // fix(P0): 刚创建还没发消息的会话 topic 只有渠道前缀 [mobile]，
    // 走 chatSessionDisplayTopic 剥前缀 + 占位
    const title = chatSessionDisplayTopic(s.topic) || CHAT_DEFAULT_TOPIC;
    return (
      <Pressable
        style={[styles.row, isLast && styles.rowLast]}
        onPress={() => onOpenPrivate(s.session_id)}
        android_ripple={{ color: "#E0E0E0" }}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{title.slice(0, 1)}</Text>
        </View>
        <View style={styles.rowMain}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
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
            <Text style={styles.rowCount}>
              {CHAT_MESSAGE_COUNT_SUFFIX(s.message_count)}
            </Text>
          )}
        </View>
      </Pressable>
    );
  }
  // group
  const g = row.group;
  return (
    <Pressable
      style={[styles.row, isLast && styles.rowLast]}
      onPress={() => onOpenGroup(g)}
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
        <Text style={styles.rowTime}>
          {formatTimestamp(g.updated_at ?? g.created_at)}
        </Text>
        <Text style={styles.rowCount}>
          {CHAT_GROUP_COUNT(g.member_count ?? g.members?.length ?? "—")}
        </Text>
      </View>
    </Pressable>
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
  refreshHint: {
    paddingVertical: 10,
    alignItems: "center",
  },
  refreshHintText: {
    fontSize: 12,
    color: "#999",
  },
});
