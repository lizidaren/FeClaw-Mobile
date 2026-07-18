/**
 * 一键拍照按钮
 *
 * 调用 react-native-image-picker 的 launchCamera 拍照，
 * 拍照成功后通过 onPhotoCapture 回调把照片信息传出（uri / 尺寸）。
 *
 * react-native-image-picker 为可选依赖，未安装时按钮点击会走 console.warn。
 */

import React, { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity } from "react-native";
import { launchCamera } from "react-native-image-picker";
import { PHOTO_A11Y } from "../constants/strings";
import { Icon } from "../components/Icon";


/** 拍照结果 */
export interface CapturedPhoto {
  uri: string;
  width: number;
  height: number;
  fileName?: string;
}

export interface PhotoCaptureProps {
  onPhotoCapture: (photo: CapturedPhoto) => void;
  /** 可选：自定义样式覆盖（如放到工具栏中） */
  compact?: boolean;
}

// fix(P1-4): React.memo 避免不必要的重绘
export const PhotoCapture = React.memo(function PhotoCapture({ onPhotoCapture, compact }: PhotoCaptureProps) {
  const [busy, setBusy] = useState(false);

  const handlePress = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await launchCamera({
        mediaType: "photo",
        quality: 0.9,
        saveToPhotos: false,
      });
      if (result.didCancel) return;
      if (result.errorCode) {
        console.warn("[PhotoCapture] 拍照失败", result.errorCode, result.errorMessage);
        return;
      }
      const asset = result.assets?.[0];
      // fix(P1-3): 防御性检查 asset 和 uri
      if (!asset?.uri) {
        console.warn("[PhotoCapture] 拍照返回空资源");
        return;
      }
      onPhotoCapture({
        uri: asset.uri,
        width: asset.width ?? 0,
        height: asset.height ?? 0,
        fileName: asset.fileName,
      });
    } catch (e) {
      console.warn("[PhotoCapture] launchCamera 异常", e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <TouchableOpacity
      style={[styles.button, compact && styles.compact]}
      activeOpacity={0.6}
      disabled={busy}
      onPress={handlePress}
      accessibilityRole="button"
      // fix(P1-2): 使用常量替代硬编码字符串
      accessibilityLabel={PHOTO_A11Y}
    >
      {busy ? (
        <ActivityIndicator size="small" color="#333" />
      ) : (
        <>
          <Text style={styles.icon}><Icon name="camera-alt" size={24} /></Text>
          {!compact ? <Text style={styles.label}>{PHOTO_A11Y}</Text> : null}
        </>
      )}
    </TouchableOpacity>
  );
});

const styles = StyleSheet.create({
  button: {
    width: 56,
    height: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
    marginVertical: 2,
  },
  compact: {
    width: 48,
    height: 48,
  },
  icon: {
    fontSize: 22,
  },
  label: {
    fontSize: 10,
    marginTop: 2,
    color: "#333",
  },
});
