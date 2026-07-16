/**
 * 撤销管理器（Command Pattern）
 *
 * 仅运行时内存维护，退出清空。LIFO 顺序，上限 100 步。
 *
 * undo 实现：
 * - 对于 ink stroke：从 strokes[] 移除 → 通知引擎重绘受影响区域
 * - 对于 eraser stroke：同上（删掉 eraser = 被挖掉的 ink 重新可见）
 *
 * 引擎无需重放时间线，ink 像素仍在 persistent canvas 上。
 */

import type { Command } from "./types";

/** 撤销栈最大步数 */
const MAX_UNDO_SIZE = 100;

/** 重做栈（撤销后可重做） */
export class UndoManager {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  // fix(P0-3): 变更订阅者集合 — pop 后通知 CanvasEngine 重绘（render），
  // 避免撤销栈与画布渲染状态不同步。
  private listeners: Set<() => void> = new Set();

  /** 压入新命令并清空 redo 栈 */
  push(cmd: Command): void {
    this.undoStack.push(cmd);
    if (this.undoStack.length > MAX_UNDO_SIZE) {
      this.undoStack.shift();
    }
    // 任何新操作都清空 redo 栈
    this.redoStack.length = 0;
  }

  /** 弹出最新命令（返回 null 表示无可撤销） */
  popUndo(): Command | null {
    const cmd = this.undoStack.pop();
    if (cmd) {
      this.redoStack.push(cmd);
      this.notify();
    }
    return cmd ?? null;
  }

  /** 重做（返回 null 表示无可重做） */
  popRedo(): Command | null {
    const cmd = this.redoStack.pop();
    if (cmd) {
      this.undoStack.push(cmd);
      this.notify();
    }
    return cmd ?? null;
  }

  /** 是否可撤销 */
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  /** 是否可重做 */
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** 撤销栈深度 */
  undoDepth(): number {
    return this.undoStack.length;
  }

  /** 重做栈深度 */
  redoDepth(): number {
    return this.redoStack.length;
  }

  /** 清空所有栈 */
  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  // fix(P0-3): 订阅撤销栈变更；CanvasEngine 构造时挂上 onChange→this.render()。
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private notify(): void {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch {
        /* 忽略订阅者异常 */
      }
    }
  }
}

/**
 * 创建一个 add_stroke 命令对象。
 * 引擎在 undo/redo 时调用其 undo/redo 方法。
 */
export function makeAddStrokeCommand(stroke: Command["stroke"]): Command {
  return {
    type: "add_stroke",
    stroke,
  };
}