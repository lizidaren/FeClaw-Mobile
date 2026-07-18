/**
 * 创建 AI 向导页
 *
 * 流程：
 *   1) 拉取模板列表（GET /api/console/templates）
 *   2) 用户点模板 → POST /api/console/agents 创建 Agent
 *   3) 创建成功 → 弹 toast，回退到上一页
 *
 * 降级：模板接口失败时（网络错误 / 404），显示手动输入名字
 * + "直接创建" 按钮，调 POST /api/user/agents 兜底。
 *
 * UI 组件只来自 react-native，避免引入额外的图标库。
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { api } from "../services/api-client";
import { chatStore } from "../services/chat-store";
import type { AgentTemplate } from "../types/api";
import type { RootStackParamList } from "../navigation/AppNavigator";
import { Icon } from "../components/Icon";


type Nav = NativeStackNavigationProp<RootStackParamList, "CreateAgent">;

/**
 * 列表为空时显示的内置兜底模板（让用户至少能创建一个"通用" Agent）。
 * fix(Bug-9): FALLBACK_TEMPLATES 在两处降级路径使用——listTemplates 返回空数组、
 * 或 listTemplates 抛错——两者都可达，故不再删除。改用下方注释统一说明用途。
 */
const FALLBACK_TEMPLATES: AgentTemplate[] = [
  {
    id: "blank",
    name: "通用助手",
    description: "一个可以从零开始对话的 AI 向导",
    icon: "✦",
    category: "通用",
  },
  {
    id: "tutor",
    name: "学习导师",
    description: "循序渐进讲解概念、给出例题和练习",
    icon: "✎",
    category: "教育",
  },
  {
    id: "coder",
    name: "编程伙伴",
    description: "协助写代码、调试、解释错误信息",
    icon: "◇",
    category: "编程",
  },
];

export function CreateAgentScreen() {
  const navigation = useNavigation<Nav>();

  const [templates, setTemplates] = useState<AgentTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [manualName, setManualName] = useState("");

  // 进入即拉模板；失败 → manualMode = true
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const list = await api.listTemplates();
        if (cancelled) return;
        if (list.length === 0) {
          setTemplates(FALLBACK_TEMPLATES);
          setManualMode(true);
        } else {
          setTemplates(list);
          setManualMode(false);
        }
      } catch (err) {
        if (cancelled) return;
        const m = err instanceof Error ? err.message : "拉取模板失败";
        setLoadError(m);
        // 降级：内置模板 + 手动输入
        setTemplates(FALLBACK_TEMPLATES);
        setManualMode(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── 选模板创建 ───────────────────────────────────────────
  // fix(P0): Mobile 端每个 Agent 始终只有一个 Session。
  // 流程：createAgent → createChatSession → navigate("ChatSession")
  // 不再"创建 Agent 后弹 Alert 然后退回"——直接进入会话。
  const handlePickTemplate = useCallback(
    async (tpl: AgentTemplate) => {
      if (submitting) return;
      setSubmitting(true);
      try {
        const created = await api.createAgent(tpl.name, tpl.id);
        // 立刻为这个 Agent 创建一个 Session（即使还没发消息，session 也存在）
        const session = await api.createChatSession(created.hash);
        // 后台刷新列表（不阻塞跳转）
        void chatStore.fetchSessions().catch((e) => {
          console.warn("[CreateAgent] fetchSessions 失败", e);
        });
        // 直接跳到聊天页：替换当前 CreateAgent 栈，避免用户按返回又回到这里
        navigation.replace("ChatSession", { sessionId: session.session_id });
      } catch (err) {
        const m = err instanceof Error ? err.message : "创建失败";
        Alert.alert("创建失败", m, [{ text: "重试", style: "default" }]);
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, navigation],
  );

  // ── 手动输入名字（降级） ────────────────────────────────
  const handleManualCreate = useCallback(async () => {
    const name = manualName.trim();
    if (!name || submitting) return;
    setSubmitting(true);
    try {
      const created = await api.createAgent(name);
      // fix(P0): 同样立即建 session + 进聊天页
      const session = await api.createChatSession(created.hash);
      void chatStore.fetchSessions().catch((e) => {
        console.warn("[CreateAgent] fetchSessions 失败", e);
      });
      navigation.replace("ChatSession", { sessionId: session.session_id });
    } catch (err) {
      const m = err instanceof Error ? err.message : "创建失败";
      Alert.alert("创建失败", m);
    } finally {
      setSubmitting(false);
    }
  }, [manualName, submitting, navigation]);

  // 按 category 分组
  const grouped = useMemo(() => {
    const map = new Map<string, AgentTemplate[]>();
    for (const t of templates) {
      const key = t.category ?? "通用";
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [templates]);

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
        <Text style={styles.topTitle}>创建 AI 向导</Text>
        <View style={styles.backBtn} />
      </View>

      {loadError !== null && manualMode && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>
            <Icon name="warning" size={16} />️ 模板接口不可用，已开启手动创建模式
          </Text>
        </View>
      )}

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {loading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color="#1976d2" />
              <Text style={styles.loadingText}>正在加载模板…</Text>
            </View>
          ) : manualMode ? (
            <ManualSection
              name={manualName}
              onChangeName={setManualName}
              onSubmit={handleManualCreate}
              submitting={submitting}
            />
          ) : (
            <View>
              {grouped.map(([cat, items]) => (
                <View key={cat} style={styles.group}>
                  <Text style={styles.groupTitle}>{cat}</Text>
                  {items.map((tpl) => (
                    <TemplateRow
                      key={tpl.id}
                      tpl={tpl}
                      disabled={submitting}
                      onPress={() => handlePickTemplate(tpl)}
                    />
                  ))}
                </View>
              ))}
              <Pressable
                style={styles.manualSwitch}
                onPress={() => setManualMode(true)}
                disabled={submitting}
              >
                <Text style={styles.manualSwitchText}>
                  没找到合适的？点此手动输入名称
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {submitting && (
        <View style={styles.submitOverlay} pointerEvents="auto">
          <ActivityIndicator color="#FFFFFF" size="large" />
        </View>
      )}
    </SafeAreaView>
  );
}

// ── 子组件 ─────────────────────────────────────────────────

function TemplateRow({
  tpl,
  disabled,
  onPress,
}: {
  tpl: AgentTemplate;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.tplRow,
        pressed && styles.tplRowPressed,
        disabled && styles.tplRowDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      android_ripple={{ color: "#E0E0E0" }}
    >
      <View style={styles.tplIcon}>
        <Text style={styles.tplIconText}>{tpl.icon ?? "✦"}</Text>
      </View>
      <View style={styles.tplMain}>
        <Text style={styles.tplName} numberOfLines={1}>
          {tpl.name}
        </Text>
        {!!tpl.description && (
          <Text style={styles.tplDesc} numberOfLines={2}>
            {tpl.description}
          </Text>
        )}
      </View>
      <Text style={styles.tplArrow}>›</Text>
    </Pressable>
  );
}

function ManualSection({
  name,
  onChangeName,
  onSubmit,
  submitting,
}: {
  name: string;
  onChangeName: (s: string) => void;
  onSubmit: () => void;
  submitting: boolean;
}) {
  return (
    <View style={styles.manualWrap}>
      <Text style={styles.manualHint}>给你的 AI 向导起个名字</Text>
      <TextInput
        style={styles.manualInput}
        value={name}
        onChangeText={onChangeName}
        placeholder="例如：英语陪练"
        placeholderTextColor="#999"
        editable={!submitting}
        maxLength={32}
        returnKeyType="done"
        onSubmitEditing={onSubmit}
      />
      <Pressable
        style={[
          styles.manualBtn,
          (submitting || name.trim().length === 0) && styles.manualBtnDisabled,
        ]}
        onPress={onSubmit}
        disabled={submitting || name.trim().length === 0}
        accessibilityLabel="直接创建"
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.manualBtnText}>直接创建</Text>
        )}
      </Pressable>
    </View>
  );
}

// ── 样式 ───────────────────────────────────────────────────

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
  topTitle: {
    flex: 1,
    textAlign: "center",
    fontSize: 17,
    fontWeight: "600",
    color: "#1a1a1a",
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
  scrollContent: {
    padding: 16,
    paddingBottom: 48,
  },
  loadingWrap: {
    paddingVertical: 40,
    alignItems: "center",
  },
  loadingText: {
    marginTop: 8,
    color: "#666",
    fontSize: 13,
  },
  group: {
    marginBottom: 16,
  },
  groupTitle: {
    fontSize: 12,
    color: "#888",
    fontWeight: "600",
    marginBottom: 8,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  tplRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 14,
    marginBottom: 8,
  },
  tplRowPressed: {
    backgroundColor: "#F0F0F0",
  },
  tplRowDisabled: {
    opacity: 0.5,
  },
  tplIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(25,118,210,0.10)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  tplIconText: {
    fontSize: 20,
    color: "#1976d2",
  },
  tplMain: {
    flex: 1,
    marginRight: 8,
  },
  tplName: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  tplDesc: {
    fontSize: 12,
    color: "#666",
  },
  tplArrow: {
    fontSize: 22,
    color: "#BBB",
  },
  manualSwitch: {
    paddingVertical: 12,
    alignItems: "center",
  },
  manualSwitchText: {
    fontSize: 13,
    color: "#1976d2",
  },
  manualWrap: {
    backgroundColor: "#FFFFFF",
    borderRadius: 12,
    padding: 20,
  },
  manualHint: {
    fontSize: 14,
    color: "#666",
    marginBottom: 12,
  },
  manualInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#CCC",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: "#1a1a1a",
    backgroundColor: "#FAFAFA",
    marginBottom: 16,
  },
  manualBtn: {
    backgroundColor: "#1976d2",
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: "center",
  },
  manualBtnDisabled: {
    opacity: 0.5,
  },
  manualBtnText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "600",
  },
  submitOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.25)",
    alignItems: "center",
    justifyContent: "center",
  },
});
