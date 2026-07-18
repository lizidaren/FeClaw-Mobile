import { Dimensions } from "react-native";

const BASE = 390;

export function isTablet(w?: number) {
  return (w ?? Dimensions.get("window").width) >= 600;
}

export function isLandscape() {
  const { width, height } = Dimensions.get("window");
  return width > height;
}

export function scale(s: number, w?: number) {
  return ((w ?? Dimensions.get("window").width) / BASE) * s;
}
