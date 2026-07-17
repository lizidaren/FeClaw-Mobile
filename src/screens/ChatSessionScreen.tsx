/**
 * Chat 会话页（私聊 + 多 Agent）
 *
 * - 顶部：返回箭头 + topic / agent 切换 + 删除按钮
 * - 中部：消息列表（用户右蓝 / 助手左灰），streaming 时底部打字动画
 * - 底部：TextInput + 📷 / 📎 按钮 + @ 提及 + 发送按钮
 * - Markdown 渲染：轻量自实现（**粗体** / `代码` / 代码块 / 换行 / 图片 ![](url)）
 * - 附件：图片点击全屏预览，文件显示文件卡
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

// 图片选择器（已在 package.json 中，jest 用 __mocks__ 替代）
import {
  launchImageLibrary,
  type Asset,
} from "react-native-image-picker";

import { chatStore, useChatStore } from "../services/chat-store";
import type {
  AgentInfo,
  ChatFileAttachment,
  ChatImageAttachment,
  ChatMessage,
  GroupMember,
} from "../types/api";
import type { RootStackParamList } from "../navigation/AppNavigator";

// 文档选择器（用户安装；未装时动态降级为只提示）
type DocPickerResult = {
  uri: string;
  name: string | null;
  size: number | null;
  type: string | null;
  fileCopyUri?: string | null;
  copyError?: string;
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

type Nav = NativeStackNavigationProp<RootStackParamList, "ChatSession">;
type RouteT = RouteProp<RootStackParamList, "ChatSession">;

// ── 轻量 Markdown 渲染 ───────────────────────────────────────
// 不引第三方库：识别 **bold** / `inline code` / ```code block``` / 换行 / ![alt](url) 图片。

interface MdSegment {
  text: string;
  bold?: boolean;
  code?: boolean;
  block?: boolean;
  image?: ChatImageAttachment;
}

function renderMarkdown(src: string): MdSegment[] {
  if (!src) return [];
  const segments: MdSegment[] = [];
  const lines = src.split("\n");

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("```")) {
      const buf: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        buf.push(lines[i]);
        i += 1;
      }
      if (i < lines.length) i += 1;
      const code = buf.join("\n");
      if (code) {
        segments.push({ text: code, block: true });
      }
      continue;
    }

    const inlineSegs = parseInline(line);
    for (const seg of inlineSegs) {
      segments.push(seg);
    }
    if (i < lines.length - 1) {
      segments.push({ text: "\n" });
    }
    i += 1;
  }

  return segments;
}

function parseInline(line: string): MdSegment[] {
  const out: MdSegment[] = [];
  let i = 0;
  let buf = "";
  const flush = () => {
    if (buf) {
      out.push({ text: buf });
      buf = "";
    }
  };

  while (i < line.length) {
    const ch = line[i];

    // Markdown 图片：![alt](url)
    if (ch === "!" && line[i + 1] === "[" && line[i + 2] !== undefined) {
      const altEnd = line.indexOf("]", i + 2);
      if (altEnd > i + 2 && line[altEnd + 1] === "(") {
        const urlEnd = line.indexOf(")", altEnd + 2);
        if (urlEnd > altEnd + 2) {
          flush();
          const url = line.slice(altEnd + 2, urlEnd).trim();
          out.push({
            text: "",
            image: { url, mime: "image/*" },
          });
          i = urlEnd + 1;
          continue;
        }
      }
    }

    // `inline code`
    if (ch === "`") {
      const end = line.indexOf("`", i + 1);
      if (end > i) {
        flush();
        out.push({ text: line.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
    }

    // **bold**
    if (ch === "*" && line[i + 1] === "*") {
      const end = line.indexOf("**", i + 2);
      if (end > i + 1) {
        flush();
        out.push({ text: line.slice(i + 2, end), bold: true });
        i = end + 2;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }
  flush();
  return out;
}

// ── 屏幕组件 ─────────────────────────────────────────────────

export function ChatSessionScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteT>();
  const initialSessionId = route.params?.sessionId ?? null;

  const {
    currentSessionId,
    currentTopic,
    currentAgentName,
    messages,
    streaming,
    streamingContent,
    error,
    pendingImages,
    pendingFiles,
    agents,
  } = useChatStore();

  const [input, setInput] = useState("");
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showMentionPicker, setShowMentionPicker] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const listRef = useRef<FlatList<ChatMessage>>(null);

  // 进入会话时拉一次详情 + 拉一次 Agent 列表
  useEffect(() => {
    if (initialSessionId) {
      void chatStore.fetchSession(initialSessionId);
    } else {
      chatStore.createNewSession();
    }
    void chatStore.fetchAgents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSessionId]);

  useFocusEffect(
    useCallback(() => {
      if (initialSessionId && messages.length === 0 && !streaming) {
        void chatStore.fetchSession(initialSessionId);
      }
    }, [initialSessionId, messages.length, streaming]),
  );

  useEffect(() => {
    if (messages.length > 0 || streamingContent.length > 0) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: true });
      });
    }
  }, [messages.length, streamingContent.length]);

  // 监听输入中的 @ 触发提及选择器
  const handleChangeText = useCallback((text: string) => {
    setInput(text);
    const lastAt = text.lastIndexOf("@");
    if (lastAt >= 0) {
      const tail = text.slice(lastAt + 1);
      // 没有空格说明还在输入 mention
      if (!/\s/.test(tail)) {
        setMentionQuery(tail);
        setShowMentionPicker(true);
        return;
      }
    }
    setShowMentionPicker(false);
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
      setShowMentionPicker(false);
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

  const handleSend = useCallback(() => {
    const trimmed = input.trim();
    const hasAttach =
      chatStore.getState().pendingImages.length > 0 ||
      chatStore.getState().pendingFiles.length > 0;
    if ((!trimmed && !hasAttach) || streaming) return;
    setInput("");
    setShowMentionPicker(false);
    void chatStore.sendMessage(trimmed, currentSessionId);
  }, [input, streaming, currentSessionId]);

  const handleDelete = useCallback(() => {
    if (!currentSessionId) {
      navigation.goBack();
      return;
    }
    Alert.alert("删除会话", "确认删除这个会话吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          await chatStore.deleteSession(currentSessionId);
          navigation.goBack();
        },
      },
    ]);
  }, [currentSessionId, navigation]);

  const headerTitle = useMemo(() => {
    if (currentTopic) return currentTopic;
    if (currentSessionId) return "对话";
    return "新对话";
  }, [currentTopic, currentSessionId]);

  // ── @ 候选项：私聊场景下显示当前 Agent
  const mentionCandidates: Array<{ id: string; name: string; kind?: string }> =
    useMemo(() => {
      const list: Array<{ id: string; name: string; kind?: string }> = [];
      if (currentAgentName) {
        list.push({ id: currentAgentName, name: currentAgentName, kind: "agent" });
      }
      for (const a of agents) {
        if (!list.find((x) => x.id === a.name)) {
          list.push({ id: a.name, name: a.name, kind: "agent" });
        }
      }
      if (list.length === 0) {
        list.push({ id: "Agent", name: "Agent", kind: "agent" });
      }
      return list;
    }, [currentAgentName, agents]);

  const filteredMentions = useMemo(() => {
    const q = mentionQuery.trim().toLowerCase();
    if (!q) return mentionCandidates;
    return mentionCandidates.filter((c) => c.name.toLowerCase().includes(q));
  }, [mentionCandidates, mentionQuery]);

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
        <Pressable
          style={styles.titleWrap}
          onPress={() => agents.length > 0 && setShowAgentPicker(true)}
          accessibilityLabel="切换 Agent"
        >
          <Text style={styles.topTitle} numberOfLines={1}>
            {headerTitle}
          </Text>
          {!!currentAgentName && (
            <Text style={styles.topSubtitle} numberOfLines={1}>
              @{currentAgentName}
            </Text>
          )}
        </Pressable>
        <Pressable
          onPress={handleDelete}
          hitSlop={12}
          style={styles.deleteBtn}
          accessibilityLabel="删除会话"
        >
          <Text style={styles.deleteIcon}>🗑️</Text>
        </Pressable>
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
          keyExtractor={(item, idx) =>
            // 优先用 timestamp+role 作为稳定 key，避免 index 在 messages
            // 重排/前置插入时导致整列 cell 重 mount
            item.timestamp
              ? `${item.role}-${item.timestamp}-${idx}`
              : `msg-${idx}`
          }
          renderItem={({ item }) => (
            <MessageBubble msg={item} onPreviewImage={setPreviewUri} />
          )}
          contentContainerStyle={styles.listContent}
          ListFooterComponent={
            streaming ? (
              <StreamingBubble content={streamingContent} />
            ) : null
          }
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        />

        {/* 待发送图片预览 */}
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

        {/* 待发送文件列表 */}
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
            disabled={streaming}
            accessibilityLabel="选择图片"
          >
            <Text style={styles.attachBtnText}>📷</Text>
          </Pressable>
          <Pressable
            onPress={handlePickFile}
            hitSlop={8}
            style={styles.attachBtn}
            disabled={streaming}
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
            editable={!streaming}
            multiline
            maxLength={2000}
            onSubmitEditing={handleSend}
            blurOnSubmit={false}
          />
          <Pressable
            onPress={handleSend}
            disabled={streaming || input.trim().length === 0}
            style={[
              styles.sendBtn,
              (streaming || input.trim().length === 0) && styles.sendBtnDisabled,
            ]}
            accessibilityLabel="发送"
          >
            {streaming ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.sendBtnText}>→</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      {/* @ 提及选择器 */}
      <Modal
        visible={showMentionPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMentionPicker(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowMentionPicker(false)}
        >
          <View style={styles.mentionSheet}>
            <Text style={styles.mentionTitle}>选择要 @ 的成员</Text>
            {filteredMentions.map((c) => (
              <Pressable
                key={c.id}
                style={styles.mentionItem}
                onPress={() => insertMention(c.name)}
              >
                <Text style={styles.mentionAvatar}>
                  {c.kind === "agent" ? "🤖" : "👤"}
                </Text>
                <Text style={styles.mentionName}>{c.name}</Text>
              </Pressable>
            ))}
            {filteredMentions.length === 0 && (
              <Text style={styles.mentionEmpty}>没有匹配的成员</Text>
            )}
          </View>
        </Pressable>
      </Modal>

      {/* Agent 切换器 */}
      <Modal
        visible={showAgentPicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowAgentPicker(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setShowAgentPicker(false)}
        >
          <View style={styles.agentSheet}>
            <Text style={styles.mentionTitle}>切换 Agent</Text>
            <ScrollView style={styles.agentList}>
              {agents.map((a) => (
                <AgentPickerRow
                  key={a.agent_id}
                  agent={a}
                  onPick={() => {
                    chatStore.switchAgent(a);
                    setShowAgentPicker(false);
                  }}
                />
              ))}
              {agents.length === 0 && (
                <Text style={styles.mentionEmpty}>暂无可用 Agent</Text>
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {/* 图片全屏预览 */}
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

function AgentPickerRow({
  agent,
  onPick,
}: {
  agent: AgentInfo;
  onPick: () => void;
}) {
  return (
    <Pressable style={styles.mentionItem} onPress={onPick}>
      <Text style={styles.mentionAvatar}>🤖</Text>
      <View style={styles.flex}>
        <Text style={styles.mentionName}>{agent.name}</Text>
        {!!agent.description && (
          <Text style={styles.mentionDesc} numberOfLines={1}>
            {agent.description}
          </Text>
        )}
      </View>
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
  const isUser = msg.role === "user";
  const segments = useMemo(() => renderMarkdown(msg.content), [msg.content]);

  return (
    <View>
      {/* 群聊场景显示发送者名（气泡上方小字） */}
      {!isUser && msg.sender_name && (
        <Text style={styles.senderName}>{msg.sender_name}</Text>
      )}
      <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
        <View
          style={[
            styles.bubble,
            isUser ? styles.bubbleUser : styles.bubbleAssistant,
          ]}
        >
          {/* 附带图片缩略图 */}
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
          {/* 附带文件卡 */}
          {!!msg.files && msg.files.length > 0 && (
            <View style={styles.fileStack}>
              {msg.files.map((f, idx) => (
                <FileCard key={`file-${idx}`} file={f} />
              ))}
            </View>
          )}

          {segments.length === 0 ? (
            <Text
              style={[
                styles.bubbleText,
                isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant,
              ]}
            >
              {" "}
            </Text>
          ) : (
            <Text
              style={[
                styles.bubbleText,
                isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant,
              ]}
            >
              {segments.map((seg, idx) => {
                if (seg.image) {
                  return (
                    <Text
                      key={idx}
                      onPress={() => onPreviewImage(seg.image!.url)}
                      style={styles.mdImageLink}
                    >
                      [图片]
                    </Text>
                  );
                }
                const segStyle = [
                  isUser ? styles.bubbleTextUser : styles.bubbleTextAssistant,
                  seg.bold && styles.mdBold,
                  seg.code && !seg.block && styles.mdCodeInline,
                  seg.block && styles.mdCodeBlock,
                ];
                return (
                  <Text key={idx} style={segStyle}>
                    {seg.text}
                  </Text>
                );
              })}
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

function StreamingBubble({ content }: { content: string }) {
  const segments = useMemo(() => renderMarkdown(content), [content]);
  const showCursor = content.length === 0;
  return (
    <View style={[styles.row, styles.rowAssistant]}>
      <View style={[styles.bubble, styles.bubbleAssistant]}>
        {showCursor ? (
          <Text style={[styles.bubbleText, styles.bubbleTextAssistant]}>
            <Text style={styles.cursor}>●●●</Text>
          </Text>
        ) : (
          <Text
            style={[styles.bubbleText, styles.bubbleTextAssistant]}
          >
            {segments.map((seg, idx) => {
              const segStyle = [
                styles.bubbleTextAssistant,
                seg.bold && styles.mdBold,
                seg.code && !seg.block && styles.mdCodeInline,
                seg.block && styles.mdCodeBlock,
              ];
              return (
                <Text key={idx} style={segStyle}>
                  {seg.text}
                </Text>
              );
            })}
            <Text style={styles.cursor}> ●</Text>
          </Text>
        )}
      </View>
    </View>
  );
}

// ── 工具 ─────────────────────────────────────────────────────

function formatBytes(n?: number): string {
  if (typeof n !== "number" || n <= 0) return "未知大小";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

// 兜底：未引用的 GroupMember 类型避免 TS6133
type _GroupMemberRef = GroupMember;

// ── 样式 ─────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#F5F5F0",
  },
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
  backIcon: {
    fontSize: 22,
    color: "#1976d2",
  },
  titleWrap: {
    flex: 1,
    alignItems: "center",
    marginHorizontal: 8,
  },
  topTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1a1a1a",
    textAlign: "center",
  },
  topSubtitle: {
    fontSize: 12,
    color: "#1976d2",
    marginTop: 2,
  },
  deleteBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  deleteIcon: {
    fontSize: 18,
  },
  errorBanner: {
    backgroundColor: "#FFEBEE",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: {
    color: "#c62828",
    fontSize: 13,
  },
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
  row: {
    flexDirection: "row",
    marginBottom: 10,
  },
  rowUser: {
    justifyContent: "flex-end",
  },
  rowAssistant: {
    justifyContent: "flex-start",
  },
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
  bubbleText: {
    fontSize: 16,
    lineHeight: 22,
  },
  bubbleTextUser: {
    color: "#FFFFFF",
  },
  bubbleTextAssistant: {
    color: "#1a1a1a",
  },
  mdBold: {
    fontWeight: "700",
  },
  mdCodeInline: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    backgroundColor: "rgba(0,0,0,0.06)",
    paddingHorizontal: 4,
    borderRadius: 4,
    fontSize: 14,
  },
  mdCodeBlock: {
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    backgroundColor: "#F5F5F5",
    padding: 8,
    borderRadius: 6,
    fontSize: 13,
  },
  mdImageLink: {
    color: "#1976d2",
    textDecorationLine: "underline",
  },
  cursor: {
    color: "#999",
    fontSize: 14,
  },
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
  attachBtnText: {
    fontSize: 20,
  },
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
  sendBtnDisabled: {
    opacity: 0.5,
  },
  sendBtnText: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "600",
  },
  pendingBar: {
    maxHeight: 90,
    backgroundColor: "#FFFFFF",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#DDD",
  },
  pendingBarContent: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  pendingItem: {
    marginRight: 8,
    position: "relative",
  },
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
  pendingFileIcon: {
    fontSize: 18,
    marginRight: 8,
  },
  pendingFileMeta: {
    flex: 1,
  },
  pendingFileName: {
    fontSize: 14,
    color: "#1a1a1a",
  },
  pendingFileSize: {
    fontSize: 11,
    color: "#999",
  },
  imageStack: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginBottom: 6,
  },
  attachmentImage: {
    width: 120,
    height: 120,
    borderRadius: 8,
    marginRight: 6,
    marginBottom: 6,
    backgroundColor: "#EEE",
  },
  fileStack: {
    marginBottom: 6,
  },
  fileCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 8,
    marginBottom: 4,
  },
  fileCardIcon: {
    fontSize: 20,
    marginRight: 8,
  },
  fileCardName: {
    fontSize: 14,
    color: "#1a1a1a",
    fontWeight: "600",
  },
  fileCardSize: {
    fontSize: 11,
    color: "#666",
  },
  fileCardAction: {
    fontSize: 13,
    color: "#1976d2",
    paddingHorizontal: 8,
  },
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
  mentionAvatar: {
    fontSize: 20,
    marginRight: 10,
  },
  mentionName: {
    fontSize: 16,
    color: "#1a1a1a",
    flex: 1,
  },
  mentionDesc: {
    fontSize: 12,
    color: "#999",
  },
  mentionEmpty: {
    paddingVertical: 24,
    textAlign: "center",
    color: "#999",
    fontSize: 13,
  },
  agentSheet: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 24,
    maxHeight: "70%",
  },
  agentList: {
    maxHeight: 400,
  },
  previewBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  previewImage: {
    width: "100%",
    height: "100%",
  },
});