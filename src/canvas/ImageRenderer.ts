/**
 * 图片元素渲染（不依赖 React）
 *
 * CanvasImage 在画布上的渲染：
 * - 应用旋转（绕中心）
 * - 应用 zIndex（笔划默认 zIndex=1，图片默认 zIndex=0）
 * - 图片源可以是 URL 或本地路径，调用方需自行解码为 SkImage
 */

import {
  Skia,
  type SkCanvas,
  type SkImage,
} from "@shopify/react-native-skia";
import type { CanvasImage, Viewport } from "./types";

/** 渲染单张图片（应用变换：旋转 + 平移 + 缩放） */
// fix(P1-1): exported but currently unused — kept for future use
export function renderImage(
  ctx: SkCanvas,
  image: SkImage,
  element: CanvasImage,
  vp: Viewport,
): void {
  const sx = (element.x - vp.offsetX) * vp.scale;
  const sy = (element.y - vp.offsetY) * vp.scale;
  const sw = element.width * vp.scale;
  const sh = element.height * vp.scale;

  ctx.save();
  // 围绕中心旋转
  if (element.rotation && element.rotation !== 0) {
    const cx = sx + sw / 2;
    const cy = sy + sh / 2;
    ctx.translate(cx, cy);
    // fix: Skia 2.x 的 Canvas.rotate 需要传旋转中心 (rx, ry)，这里用 (0,0)
    // 因为前面已经 translate 到中心点，所以旋转中心就是原点。
    ctx.rotate(element.rotation, 0, 0);
    ctx.translate(-cx, -cy);
  }
  // 应用图片源实际尺寸 → 目标尺寸
  const srcRect = {
    x: 0,
    y: 0,
    width: image.width(),
    height: image.height(),
  };
  const dstRect = {
    x: sx,
    y: sy,
    width: sw,
    height: sh,
  };
  ctx.drawImageRect(image, srcRect, dstRect, Skia.Paint());
  ctx.restore();
}

/**
 * 异步从 URL/路径加载 SkImage。
 * 调用方负责缓存与错误处理。
 */
// fix(P1-1): exported but currently unused — kept for future use
export async function loadImage(source: string): Promise<SkImage | null> {
  try {
    if (source.startsWith("data:")) {
      // base64 data URL
      const base64 = source.split(",")[1] ?? "";
      const data = Skia.Data.fromBase64(base64);
      return Skia.Image.MakeImageFromEncoded(data);
    }
    if (source.startsWith("http://") || source.startsWith("https://")) {
      const resp = await fetch(source);
      const buf = await resp.arrayBuffer();
      const data = Skia.Data.fromBytes(new Uint8Array(buf));
      return Skia.Image.MakeImageFromEncoded(data);
    }
    // 本地路径：调用方需自行实现（react-native-fs 等）
    // 这里返回 null，由 UI 层处理加载失败
    return null;
  } catch {
    return null;
  }
}

/** 按 zIndex 升序排列图片元素 */
// fix(P1-1): exported but currently unused — kept for future use
export function sortImagesByZIndex(images: CanvasImage[]): CanvasImage[] {
  return [...images].sort((a, b) => a.zIndex - b.zIndex);
}