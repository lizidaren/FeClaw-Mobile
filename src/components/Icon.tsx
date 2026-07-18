import React from "react";
import { StyleSheet, Text } from "react-native";
import MaterialIcons from "react-native-vector-icons/MaterialIcons";

type IconName = React.ComponentProps<typeof MaterialIcons>["name"];

interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  style?: any;
}

/** 统一图标组件。全项目的 emoji 都用它替换 */
export function Icon({ name, size = 22, color = "#555", style }: IconProps) {
  return (
    <MaterialIcons
      name={name}
      size={size}
      color={color}
      style={style}
    />
  );
}

/** 预定义图标映射（方便统一管理和替换） */
export const ICONS = {
  chat: "chat" as IconName,
  add: "add-circle-outline" as IconName,
  image: "image" as IconName,
  camera: "camera-alt" as IconName,
  attach: "attach-file" as IconName,
  mic: "mic" as IconName,
  recording: "fiber-manual-record" as IconName,
  brush: "brush" as IconName,
  eraser: "auto-fix-high" as IconName,
  undo: "undo" as IconName,
  redo: "redo" as IconName,
  home: "home" as IconName,
  note: "note" as IconName,
  check: "check-circle" as IconName,
  close: "close" as IconName,
  delete: "delete" as IconName,
  edit: "edit" as IconName,
  more: "more-vert" as IconName,
  send: "send" as IconName,
  search: "search" as IconName,
  settings: "settings" as IconName,
  group: "group" as IconName,
  person: "person" as IconName,
  robot: "smart-toy" as IconName,
  warning: "warning" as IconName,
  lightbulb: "lightbulb" as IconName,
  assignment: "assignment" as IconName,
  trending: "trending-up" as IconName,
  calendar: "calendar-today" as IconName,
  folder: "folder" as IconName,
  pin: "push-pin" as IconName,
  clear: "clear" as IconName,
  formatBold: "format-bold" as IconName,
  formatItalic: "format-italic" as IconName,
  formatUnderline: "format-underline" as IconName,
  formatList: "format-list-bulleted" as IconName,
  heading: "title" as IconName,
};

export default Icon;
