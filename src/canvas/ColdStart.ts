/**
 * 冷启动双缓冲
 *
 * 启动序列：
 * 1. 解码缩略图 → 全屏显示（用户立即可见）
 * 2. React 端拿到屏幕尺寸后调用 CanvasEngine.ensureSurface() → 回放全部笔划到离屏 Surface
 * 3. 回放期间 Overlay 立即可用 → 用户新笔画不受影响
 * 4. Surface 就绪后调用 endColdStart() 无感切换（缩略图消失，persistentImage 接管）
 *
 * 本模块只负责：
 * - 缩略图解码
 * - 冷启动期标志维护
 *
 * 实际的笔划回放由 CanvasEngine 在离屏 SkSurface 上完成。
 */

import { Skia, type SkImage } from "@shopify/react-native-skia";

/** 冷启动上下文（持有缩略图与冷启动标志） */
export class ColdStartContext {
  /** 是否仍处于冷启动期（缩略图占位，Surface 未就绪） */
  private coldStarting = true;
  /** 解码后的缩略图 */
  private thumbnail: SkImage | null = null;
  /** 已回放的最大 ts（保留字段，供进度展示） */
  private lastRebuiltTs = -1;

  /** 是否处于冷启动期 */
  isColdStarting(): boolean {
    return this.coldStarting;
  }

  /** 获取缩略图（解码后） */
  getThumbnail(): SkImage | null {
    return this.thumbnail;
  }

  /**
   * 解码缩略图（base64 webp/jpeg/png）。
   * 失败时返回 null（冷启动期由空白画布接管）。
   */
  decodeThumbnail(base64: string | undefined): SkImage | null {
    if (!base64) return null;
    try {
      const data = Skia.Data.fromBase64(base64);
      const img = Skia.Image.MakeImageFromEncoded(data);
      this.thumbnail = img;
      return img;
    } catch (e) {
      console.warn("[ColdStart] 缩略图解码失败", e);
      return null;
    }
  }

  /**
   * 带超时的异步解码包装（fix(P0-4): 防止巨型 base64 阻塞冷启动帧绘制）。
   * 返回 SkImage 或 null（null 表示超时/失败，冷启动期交由空白画布接管）。
   *
   * @param base64   base64 缩略图字符串
   * @param timeoutMs 默认 800ms：超过此时间强制放弃解码，避免 jank
   */
  async decodeThumbnailWithTimeout(
    base64: string | undefined,
    timeoutMs: number = 800,
  ): Promise<SkImage | null> {
    const work = new Promise<SkImage | null>((resolve) => {
      // setTimeout(0) 把 work 推到下一微任务，避免和微任务队列的 render 竞争
      setTimeout(() => resolve(this.decodeThumbnail(base64)), 0);
    });
    const timeout = new Promise<SkImage | null>((resolve) => {
      setTimeout(() => {
        console.warn(
          "[ColdStart] 缩略图解码超时",
          timeoutMs,
          "ms，已放弃，空白画布接管",
        );
        resolve(null);
      }, timeoutMs);
    });
    return Promise.race([work, timeout]);
  }

  /**
   * 结束冷启动期：Surface 已就绪，丢弃缩略图。
   */
  endColdStart(): void {
    this.coldStarting = false;
    this.thumbnail = null;
  }

  /** 已回放的最大 ts */
  getLastRebuiltTs(): number {
    return this.lastRebuiltTs;
  }

  /** 重置（切换 page 时调用） */
  reset(): void {
    this.coldStarting = true;
    this.thumbnail = null;
    this.lastRebuiltTs = -1;
  }

  /** 销毁：释放 Skia 引用 */
  dispose(): void {
    this.thumbnail = null;
  }
}