/**
 * PDF 导入对话框（Modal）
 *
 * 两种导入方式：
 * - 选项 A：<Icon name="attach-file" size={16} /> 放个链接 —— PDF 作为附件链接挂到画布，不展开
 * - 选项 B：<Icon name="image" size={16} />️ 展开到画布 —— 展示页面缩略图选择器，可多选 / 全选，
 *           选中的页面作为图片元素插入画布
 */

import React, { useMemo, useState } from "react";
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  PDF_TITLE_PREFIX,
  PDF_ATTACH_LINK,
  PDF_ATTACH_HINT,
  PDF_EXPAND,
  PDF_EXPAND_HINT,
  PDF_SELECTED_COUNT,
  PDF_SELECT_ALL,
  PDF_DESELECT_ALL,
  PDF_PAGE_LABEL,
  PDF_BACK,
  PDF_INSERT,
} from "../constants/strings";
import { Icon } from "../components/Icon";

/** PDF 单页（用于展开选择器） */
export interface PdfPage {
  /** 0-based 页码 */
  index: number;
  /** 缩略图（URL 或 data URI） */
  thumbnail: string;
}

export interface PdfImportDialogProps {
  visible: boolean;
  /** PDF 文件名（展示用） */
  fileName: string;
  /** 页面缩略图列表（展开选项用） */
  pages: PdfPage[];
  onClose: () => void;
  /** 选项 A：作为链接附件 */
  onAttachLink: () => void;
  /** 选项 B：把选中页面展开到画布（升序页码数组） */
  onExpandToCanvas: (selectedPageIndices: number[]) => void;
}

type Stage = "choose" | "select";

export function PdfImportDialog({
  visible,
  fileName,
  pages,
  onClose,
  onAttachLink,
  onExpandToCanvas,
}: PdfImportDialogProps) {
  const [stage, setStage] = useState<Stage>("choose");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const allSelected = pages.length > 0 && selected.size === pages.length;

  const reset = () => {
    setStage("choose");
    setSelected(new Set());
  };

  const close = () => {
    reset();
    onClose();
  };

  const togglePage = (index: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected(allSelected ? new Set() : new Set(pages.map((p) => p.index)));
  };

  const confirmExpand = () => {
    const indices = [...selected].sort((a, b) => a - b);
    if (indices.length === 0) {
      console.warn("[PdfImportDialog] 未选择任何页面");
      return;
    }
    // fix(P0-7): TODO 实际 PDF 展开 API。
    // 当前仅回调上层 onExpandToCanvas(indices)；真实数据流应：
    //   1) 调用 /api/pdf/{fileId}/pages?indices=... 拿到每页 image URL
    //   2) 走 docx.uploadImage → COS 拿到永久 URL
    //   3) 通过 engine.addImage({source, x, y, ...}) 插入画布
    // 上层回调拿到原始 base64 后再 insert；现在上层（CanvasScreen）尚未实现，
    // 请在 onExpandToCanvas 拿到数组的位置补全该流程。
    onExpandToCanvas(indices);
    close();
  };

  const attach = () => {
    // fix(P0-7): TODO 实际 PDF 链接附件 API。
    // 当前仅回调上层 onAttachLink；真实数据流应：
    //   1) 上传 PDF 文件 → VFS（curl /api/vfs/upload?path=...）
    //   2) 把 VFS path 写入画布 metadata.attachments
    //   3) 在画布渲染一个 <Icon name="attach-file" size={16} /> 占位节点，onClick → 打开预览
    onAttachLink();
    close();
  };

  const sortedPages = useMemo(
    () => [...pages].sort((a, b) => a.index - b.index),
    [pages],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={styles.dialog}>
        <Text style={styles.title} numberOfLines={1}>
          {/* fix(P1-2): 使用常量替代硬编码字符串 */}
          {PDF_TITLE_PREFIX}{fileName}
        </Text>

        {stage === "choose" ? (
          <View style={styles.choices}>
            <TouchableOpacity style={styles.choice} activeOpacity={0.7} onPress={attach}>
              <Text style={styles.choiceIcon}><Icon name="attach-file" size={16} /></Text>
              <Text style={styles.choiceLabel}>{PDF_ATTACH_LINK}</Text>
              <Text style={styles.choiceHint}>{PDF_ATTACH_HINT}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.choice}
              activeOpacity={0.7}
              onPress={() => setStage("select")}
            >
              <Text style={styles.choiceIcon}><Icon name="image" size={16} />️</Text>
              <Text style={styles.choiceLabel}>{PDF_EXPAND}</Text>
              <Text style={styles.choiceHint}>{PDF_EXPAND_HINT}</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.selectHeader}>
              <Text style={styles.selectCount}>
                {PDF_SELECTED_COUNT(selected.size, pages.length)}
              </Text>
              <TouchableOpacity onPress={toggleSelectAll}>
                <Text style={styles.selectAll}>
                  {allSelected ? PDF_DESELECT_ALL : PDF_SELECT_ALL}
                </Text>
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.grid}>
              {sortedPages.map((page) => {
                const isSel = selected.has(page.index);
                return (
                  <TouchableOpacity
                    key={page.index}
                    style={[styles.thumbWrap, isSel && styles.thumbWrapSelected]}
                    activeOpacity={0.8}
                    onPress={() => togglePage(page.index)}
                  >
                    <Image
                      source={{ uri: page.thumbnail }}
                      style={styles.thumb}
                      resizeMode="contain"
                    />
                    <Text style={styles.thumbLabel}>{PDF_PAGE_LABEL(page.index + 1)}</Text>
                    {isSel ? <Text style={styles.check}>✓</Text> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <View style={styles.footer}>
              <TouchableOpacity style={styles.secondaryBtn} onPress={() => setStage("choose")}>
                <Text style={styles.secondaryText}>{PDF_BACK}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.primaryBtn, selected.size === 0 && styles.primaryDisabled]}
                disabled={selected.size === 0}
                onPress={confirmExpand}
              >
                <Text style={styles.primaryText}>{PDF_INSERT(selected.size)}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  dialog: {
    position: "absolute",
    left: 20,
    right: 20,
    top: "12%",
    bottom: "12%",
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    padding: 20,
  },
  title: {
    fontSize: 16,
    fontWeight: "600",
    color: "#333",
    marginBottom: 16,
  },
  choices: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  choice: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 24,
    marginHorizontal: 6,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "#DDD",
    backgroundColor: "#FAFAFA",
  },
  choiceIcon: {
    fontSize: 36,
    marginBottom: 8,
  },
  choiceLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: "#333",
  },
  choiceHint: {
    fontSize: 11,
    color: "#999",
    marginTop: 4,
    textAlign: "center",
  },
  selectHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  selectCount: {
    fontSize: 14,
    color: "#666",
  },
  selectAll: {
    fontSize: 14,
    color: "#1a73e8",
    fontWeight: "600",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
  },
  thumbWrap: {
    width: "31%",
    aspectRatio: 0.72,
    marginBottom: 12,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: "transparent",
    backgroundColor: "#F2F2F2",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  thumbWrapSelected: {
    borderColor: "#1a73e8",
  },
  thumb: {
    width: "100%",
    height: "82%",
  },
  thumbLabel: {
    fontSize: 11,
    color: "#666",
    marginTop: 2,
  },
  check: {
    position: "absolute",
    top: 4,
    right: 6,
    color: "#1a73e8",
    fontSize: 16,
    fontWeight: "700",
  },
  footer: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
  },
  secondaryBtn: {
    flex: 1,
    paddingVertical: 12,
    marginRight: 8,
    borderRadius: 10,
    backgroundColor: "#F5F5F5",
    alignItems: "center",
  },
  secondaryText: {
    fontSize: 15,
    color: "#666",
    fontWeight: "600",
  },
  primaryBtn: {
    flex: 2,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: "#1a73e8",
    alignItems: "center",
  },
  primaryDisabled: {
    opacity: 0.4,
  },
  primaryText: {
    fontSize: 15,
    color: "#FFFFFF",
    fontWeight: "600",
  },
});
