/**
 * 群聊会话页
 *
 * 与 ChatSessionScreen 的差异：
 * - 顶部显示群名 + 成员数
 * - 消息气泡上方显示发送者名（群成员）
 * - 不展示 pending/streaming 状态条（Gen 2 草稿不在群聊显示）
 * - @ 选择器列出群成员
 * - 支持图片 / 文件附件（与私聊共用 chatStore.sendMessage 路径）
 *
 * 群聊不持久化 sessionId（在 store 里通过 currentGroupId 标识）。
 * 所有消息按时间正序排列。
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  useFocusEffect,
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import {
  launchImageLibrary,
  type Asset,
} from "react-native-image-picker";

import { chatStore, useChatStore } from "../services/chat-store";
import type {
  ChatFileAttachment,
  ChatMessage,
  GroupMember,
} from "../types/api";
import type { RootStackParamList } from "../navigation/AppNavigator";

type DocPickerResult = {
  uri: string;
  name: string | null;
  size: number | null;
  type: string | null;
  fileCopyUri?: string | null;
};
type DocPickerModule = {
  pickSingle: (opts: {
    type?: string | string[];
    copyTo?: "cachesDirectory" | "documentDirectory";
  }) => Promise<DocPickerResult>;
  types?: { allFiles?: string };
  isCancel?: (err: unknown) => boolean;
};
let DocumentPicker: DocPickerModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  DocumentPicker = require("react-native-document-picker") as DocPickerModule;
} catch {
  DocumentPicker = null;
}

type Nav = NativeStackNavigationProp<RootStackParamList, "GroupChatSession">;
type RouteT = RouteProp<RootStackParamList, "GroupChatSession">;

export function GroupChatSessionScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteT>();
  const initialGroupId = route.params?.groupId ?? null;

  const {
    currentGroupId,
    currentGroupName,
    currentGroupMembers,
    messages,
    error,
    pendingImages,
    pendingFiles,
  } = useChatStore();

  const [input, setInput] = useState("");
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [showMemberPicker, setShowMemberPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // 进入时校验群 id：与 store 不一致就刷新消息 + 成员
  useEffect(() => {
    if (!initialGroupId) return;
    if (currentGroupId !== initialGroupId) {
      // store 还没切到该群：从 groups 里找一下
      const all = chatStore.getState().groups;
      const found = all.find((g) => g.group_id === initialGroupId);
      if (found) {
        chatStore.openGroupSession(found);
      } else {
        // 没有缓存：直接拉成员 + 消息
        void chatStore.refreshGroupMessages(initialGroupId);
        void chatStore.refreshGroupMembers(initialGroupId);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialGroupId]);

  useFocusEffect(
    useCallback(() => {
      if (initialGroupId) {
        void chatStore.refreshGroupMessages(initialGroupId);
      }
    }, [initialGroupId]),
  );

  useEffect(() => {
    if (messages.length > 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
      });
    }
  }, [messages.length]);

  const handleChangeText = useCallback((text: string) => {
    setInput(text);
    const lastAt = text.lastIndexOf("@");
    if (lastAt >= 0) {
      const tail = text.slice(lastAt + 1);
      if (!/\s/.test(tail)) {
        setMentionQuery(tail);
        setShowMemberPicker(true);
        return;
      }
    }
    setShowMemberPicker(false);
  }, []);

  const insertMention = useCallback(
    (name: string) => {
      const lastAt = input.lastIndexOf("@");
      if (lastAt >= 0) {
        const before = input.slice(0, lastAt);
        setInput(`${before}@${name} `);
      } else {
        setInput((cur) => `${cur}@${name} `);
      }
      setShowMemberPicker(false);
    },
    [input],
  );

  const handlePickImage = useCallback(async () => {
    try {
      const res = await launchImageLibrary({
        mediaType: "photo",
        selectionLimit: 1,
        includeBase64: false,
      });
      if (res.didCancel) return;
      const asset: Asset | undefined = res.assets?.[0];
      if (!asset?.uri) return;
      chatStore.addPendingImage({
        uri: asset.uri,
        fileName: asset.fileName ?? undefined,
        mime: asset.type ?? "image/jpeg",
      });
    } catch (err) {
      const m = err instanceof Error ? err.message : "选择图片失败";
      Alert.alert("提示", m);
    }
  }, []);

  const handlePickFile = useCallback(async () => {
    if (!DocumentPicker) {
      Alert.alert(
        "未安装文件选择器",
        "请先 npm install react-native-document-picker",
      );
      return;
    }
    try {
      const picked = await DocumentPicker.pickSingle({
        type: [DocumentPicker.types?.allFiles ?? "*/*"],
        copyTo: "cachesDirectory",
      });
      const uri = picked.uri ?? picked.fileCopyUri;
      if (!uri) return;
      chatStore.addPendingFile({
        uri,
        name: picked.name ?? "file",
        size: picked.size ?? undefined,
        mime: picked.type ?? undefined,
      });
    } catch (err) {
      if (DocumentPicker.isCancel?.(err)) return;
      if (err && typeof err === "object" && "code" in err) {
        const code = (err as { code?: string }).code;
        if (code === "DOCUMENT_PICKER_CANCELED" || code === "OPERATION_CANCELED") {
          return;
        }
      }
      const m = err instanceof Error ? err.message : "选择文件失败";
      Alert.alert("提示", m);
    }
  }, []);

  const handleSend = useCallback(async () => {
    const trimmed = input.trim();
    const hasAttach =
      chatStore.getState().pendingImages.length > 0 ||
      chatStore.getState().pendingFiles.length > 0;
    if ((!trimmed && !hasAttach) || sending) return;
    setInput("");
    setShowMemberPicker(false);
    setSending(true);
    try {
      await chatStore.sendMessage(trimmed, null);
      // 群聊场景下，发完后再拉一次消息列表，确保新消息能进来
      const gid = chatStore.getState().currentGroupId;
      if (gid) {
        void chatStore.refreshGroupMessages(gid);
      }
    } finally {
      setSending(false);
    }
  }, [input, sending]);

  const headerTitle = currentGroupName ?? "群聊";
  const memberCount = currentGroupMembers.length;

  const filteredMembers = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return currentGroupMembers;
    return currentGroupMembers.filter((m) =>
      m.name.toLowerCase().includes(q),
    );
  }, [currentGroupMembers, mentionQuery]);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "left", "right"]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={() => navigation.goBack()}
          hitSlop={12}
          style={styles.backBtn}
          accessibilityLabel="返回"
        >
          <Text style={styles.backIcon}>←</Text>
        </Pressable>
        <View style={styles.titleWrap}>
          <Text style={styles.topTitle} numberOfLines={1}>
            👥 {headerTitle}
          </Text>
          <Text style={styles.topSubtitle} numberOfLines={1}>
            {memberCount > 0 ? `${memberCount} 位成员` : "群聊"}
          </Text>
        </View>
        {/* 占位，保持对称布局 */}
        <View style={styles.backBtn} />
      </View>

      {error !== null && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>⚠️ {error}</Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(_, idx) => `gmsg-${idx}`}
          renderItem={({ item }) => (
            <MessageBubble msg={item} onPreviewImage={setPreviewUri} />
          )}
          contentContainerStyle={styles.listContent}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        {pendingImages.length > 0 && (
          <ScrollView
            horizontal
            style={styles.pendingBar}
            contentContainerStyle={styles.pendingBarContent}
            keyboardShouldPersistTaps="handled"
          >
            {pendingImages.map((img, idx) => (
              <View key={`img-${idx}`} style={styles.pendingItem}>
                <Image source={{ uri: img.uri }} style={styles.pendingImage} />
                <Pressable
                  style={styles.pendingRemove}
                  onPress={() => chatStore.removePendingImage(idx)}
                  hitSlop={8}
                >
                  <Text style={styles.pendingRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}

        {pendingFiles.length > 0 && (
          <View style={styles.pendingFilesBox}>
            {pendingFiles.map((f, idx) => (
              <View key={`file-${idx}`} style={styles.pendingFileRow}>
                <Text style={styles.pendingFileIcon}>📄</Text>
                <View style={styles.pendingFileMeta}>
                  <Text style={styles.pendingFileName} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <Text style={styles.pendingFileSize}>
                    {formatBytes(f.size)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => chatStore.removePendingFile(idx)}
                  hitSlop={8}
                >
                  <Text style={styles.pendingRemoveText}>×</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <View style={styles.inputBar}>
          <Pressable
            onPress={handlePickImage}
            hitSlop={8}
            style={styles.attachBtn}
            disabled={sending}
            accessibilityLabel="选择图片"
          >
            <Text style={styles.attachBtnText}>📷</Text>
          </Pressable>
          <Pressable
            onPress={handlePickFile}
            hitSlop={8}
            style={styles.attachBtn}
            disabled={sending}
            accessibilityLabel="选择文件"
          >
            <Text style={styles.attachBtnText}>📎</Text>
          </Pressable>
          <TextInput
            style={styles.textInput}
            value={input}
            onChangeText={handleChangeText}
            placeholder="说点什么…"
            placeholderTextColor="#999"
            editable={!sending}
            multiline
            maxLength={2000}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={handleSend}
            disabled={sending || input.trim().length === 0}
            style={[
              styles.sendBtn,
              (sending || input.trim().length === 0) && styles.sendBtnDisabled,
            ]}
            accessibilityLabel="发送"
          >
            {sending ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.sendBtnText}>→</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <Modal
        visible={showMemberPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMemberPicker(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowMemberPicker(false)}
        >
          <View style={styles.mentionSheet}>
            <Text style={styles.mentionTitle}>选择要 @ 的群成员</Text>
            {filteredMembers.map((m) => (
              <MemberPickerRow
                key={m.member_id}
                member={m}
                onPick={() => insertMention(m.name)}
              />
            ))}
            {filteredMembers.length === 0 && (
              <Text style={styles.mentionEmpty}>
                {currentGroupMembers.length === 0
                  ? "暂未加载到成员列表"
                  : "没有匹配的成员"}
              </Text>
            )}
          </View>
        </Pressable>
      </Modal>

      <Modal
        visible={previewUri !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setPreviewUri(null)}
      >
        <Pressable
          style={styles.previewBackdrop}
          onPress={() => setPreviewUri(null)}
        >
          {previewUri && (
            <Image
              source={{ uri: previewUri }}
              style={styles.previewImage}
              resizeMode="contain"
            />
          )}
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

// ── 子组件 ───────────────────────────────────────────────────

function MemberPickerRow({
  member,
  onPick,
}: {
  member: GroupMember;
  onPick: () => void;
}) {
  return (
    <Pressable style={styles.mentionItem} onPress={onPick}>
      <Text style={styles.mentionAvatar}>
        {member.kind === "agent" ? "🤖" : "👤"}
      </Text>
      <Text style={styles.mentionName}>{member.name}</Text>
    </Pressable>
  );
}

function MessageBubble({
  msg,
  onPreviewImage,
}: {
  msg: ChatMessage;
  onPreviewImage: (uri: string) => void;
}) {
  const isMe = msg.sender_id === "me" || msg.sender_name === "我";
  return (
    <View>
      {/* 群聊：每条消息上方显示发送者名（自己也可不显示以保持清洁） */}
      {!isMe && msg.sender_name && (
        <Text style={styles.senderName}>{msg.sender_name}</Text>
      )}
      <View style={[styles.row, isMe ? styles.rowUser : styles.rowAssistant]}>
        <View
          style={[
            styles.bubble,
            isMe ? styles.bubbleUser : styles.bubbleAssistant,
          ]}
        >
          {!!msg.images && msg.images.length > 0 && (
            <View style={styles.imageStack}>
              {msg.images.map((img, idx) => (
                <Pressable
                  key={`img-${idx}`}
                  onPress={() => onPreviewImage(img.url)}
                >
                  <Image
                    source={{ uri: img.url }}
                    style={styles.attachmentImage}
                    resizeMode="cover"
                  />
                </Pressable>
              ))}
            </View>
          )}
          {!!msg.files && msg.files.length > 0 && (
            <View style={styles.fileStack}>
              {msg.files.map((f, idx) => (
                <FileCard key={`file-${idx}`} file={f} />
              ))}
            </View>
          )}
          {!!msg.content && msg.content.length > 0 && (
            <Text
              style={[
                styles.bubbleText,
                isMe ? styles.bubbleTextUser : styles.bubbleTextAssistant,
              ]}
            >
              {msg.content}
            </Text>
          )}
        </View>
      </View>
    </View>
  );
}

function FileCard({ file }: { file: ChatFileAttachment }) {
  const handleOpen = useCallback(() => {
    if (file.path) {
      void Linking.openURL(file.path).catch(() => undefined);
    }
  }, [file.path]);

  return (
    <Pressable style={styles.fileCard} onPress={handleOpen}>
      <Text style={styles.fileCardIcon}>📄</Text>
      <View style={styles.flex}>
        <Text style={styles.fileCardName} numberOfLines={1}>
          {file.name}
        </Text>
        <Text style={styles.fileCardSize}>{formatBytes(file.size)}</Text>
      </View>
      <Text style={styles.fileCardAction}>打开</Text>
    </Pressable>
  );
}

function formatBytes(n?: number): string {
  if (typeof n !== "number" || n <= 0) return "未知大小";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#F5F5F0" },
  flex: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: "#FFFFFF",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#DDD",
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  backIcon: { fontSize: 22, color: "#1976d2" },
  titleWrap: { flex: 1, alignItems: "center", marginHorizontal: 8 },
  topTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1a1a1a",
    textAlign: "center",
  },
  topSubtitle: { fontSize: 12, color: "#666", marginTop: 2 },
  errorBanner: {
    backgroundColor: "#FFEBEE",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: { color: "#c62828", fontSize: 13 },
  listContent: {
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 12,
    flexGrow: 1,
  },
  senderName: {
    fontSize: 11,
    color: "#666",
    marginLeft: 4,
    marginBottom: 2,
  },
  row: { flexDirection: "row", marginBottom: 10 },
  rowUser: { justifyContent: "flex-end" },
  rowAssistant: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
  },
  bubbleUser: {
    backgroundColor: "#1976d2",
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: "#FFFFFF",
    borderBottomLeftRadius: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#E0E0E0",
  },
  bubbleText: { fontSize: 16, lineHeight: 22 },
  bubbleTextUser: { color: "#FFFFFF" },
  bubbleTextAssistant: { color: "#1a1a1a" },
  imageStack: { flexDirection: "row", flexWrap: "wrap", marginBottom: 6 },
  attachmentImage: {
    width: 120,
    height: 120,
    borderRadius: 8,
    marginRight: 6,
    marginBottom: 6,
    backgroundColor: "#EEE",
  },
  fileStack: { marginBottom: 6 },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 8,
    marginBottom: 4,
  },
  fileCardIcon: { fontSize: 20, marginRight: 8 },
  fileCardName: {
    fontSize: 14,
    color: "#1a1a1a",
    fontWeight: "600",
  },
  fileCardSize: { fontSize: 11, color: "#666" },
  fileCardAction: {
    fontSize: 13,
    color: "#1976d2",
    paddingHorizontal: 8,
  },
  pendingBar: {
    maxHeight: 90,
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#DDD",
  },
  pendingBarContent: { paddingHorizontal: 10, paddingVertical: 8 },
  pendingItem: { marginRight: 8, position: "relative" },
  pendingImage: {
    width: 64,
    height: 64,
    borderRadius: 8,
    backgroundColor: "#EEE",
  },
  pendingRemove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  pendingRemoveText: {
    color: "#FFFFFF",
    fontSize: 16,
    lineHeight: 18,
    fontWeight: "700",
  },
  pendingFilesBox: {
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#DDD",
    paddingHorizontal: 10,
    paddingTop: 6,
  },
  pendingFileRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
  },
  pendingFileIcon: { fontSize: 18, marginRight: 8 },
  pendingFileMeta: { flex: 1 },
  pendingFileName: { fontSize: 14, color: "#1a1a1a" },
  pendingFileSize: { fontSize: 11, color: "#999" },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#DDD",
  },
  attachBtn: {
    width: 36,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  attachBtnText: { fontSize: 20 },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "#F5F5F0",
    borderRadius: 18,
    fontSize: 16,
    color: "#1a1a1a",
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#1976d2",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendBtnText: { color: "#FFFFFF", fontSize: 20, fontWeight: "600" },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  mentionSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: "70%",
  },
  mentionTitle: {
    fontSize: 14,
    color: "#666",
    marginBottom: 8,
    fontWeight: "600",
  },
  mentionItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#EEE",
  },
  mentionAvatar: { fontSize: 20, marginRight: 10 },
  mentionName: { fontSize: 16, color: "#1a1a1a", flex: 1 },
  mentionEmpty: {
    paddingVertical: 24,
    textAlign: "center",
    color: "#999",
    fontSize: 13,
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: { width: "100%", height: "100%" },
});