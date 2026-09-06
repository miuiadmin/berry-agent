/**
 * 主屏浮层基建（07 §4.1 呈现面件 6）：OverlayStack——cell 网格局部区浮层。
 *
 * 「overlay」专指主屏浮层（不进 1049 备屏——副屏另名 AltScreenHost）：
 * - 栈形多枚并存，栈底先画、栈顶最后画（覆盖序即栈序）；
 * - 锚定是函数（拿帧几何自由定位——select / confirm 挂输入框上方等），
 *   返回 region 须在屏内（越界写由缓冲吸收——缓冲兜底，锚定函数自律）；
 * - 事件路由模态独占：栈非空时 routeEvent 恒返 true——占焦期间未消费键
 *   不穿透至 UiBackend 三序（07 §4.3 输入路由拦截链条款）；
 * - 进出栈经 onChange 通知装配层请求重绘（overlay 是主屏帧的组成段）。
 */
import type { CellBuffer, InputEvent, Region, Renderable } from '../../engine/index.js';

/** 浮层内容协议：可渲染 + 可吃键（占焦模态件的两面） */
export interface OverlayContent extends Renderable {
  /** 键 / 文本 / IME / 粘贴事件分发（返回是否消费——未消费也不穿透） */
  handleEvent(event: InputEvent): boolean;
}

/** 锚定函数（帧几何 → 浮层区域；返回 region 须在屏内——缓冲吸收越界兜底） */
export type OverlayAnchor = (frame: { width: number; height: number }) => Region;

/** 浮层句柄（两形态共用——主屏浮层与副屏同形接口） */
export interface OverlayHandle {
  /** 关层（幂等；非栈顶亦可关——按句柄定位移除） */
  close(): void;
  /** 已关态 */
  readonly closed: boolean;
}

/** 栈条目（句柄闭包的持有体） */
interface OverlayEntry {
  readonly content: OverlayContent;
  readonly anchor: OverlayAnchor;
  closed: boolean;
}

/**
 * 浮层栈：主屏帧的「后画段」与输入路由的「先吃段」。
 *
 * 装配序（每帧）：主树 render → renderAll（浮层覆盖其上）；
 * 路由序（每键）：routeEvent（栈非空短路三序）→ UiBackend 命令 / 队列 / 输入框。
 */
export class OverlayStack {
  private entries: OverlayEntry[] = [];
  /** 栈变更通知（开 / 关——装配层接重绘请求） */
  onChange?: () => void;

  /** 在场浮层数 */
  get size(): number {
    return this.entries.length;
  }

  /** 开层：压栈 + 返回句柄（幂等关闭归句柄） */
  open(content: OverlayContent, anchor: OverlayAnchor): OverlayHandle {
    const entry: OverlayEntry = { content, anchor, closed: false };
    this.entries.push(entry);
    this.onChange?.();
    return {
      close: () => {
        if (entry.closed) return;
        entry.closed = true;
        const idx = this.entries.indexOf(entry);
        if (idx >= 0) this.entries.splice(idx, 1);
        this.onChange?.();
      },
      get closed() {
        return entry.closed;
      },
    };
  }

  /** 浮层渲染（主树渲染后调用——栈底先画、栈顶覆盖） */
  renderAll(buffer: CellBuffer): void {
    for (const entry of this.entries) {
      const region = entry.anchor({ width: buffer.columns, height: buffer.rows });
      entry.content.render(buffer, region);
    }
  }

  /**
   * 事件路由（模态独占）：栈顶先吃；**栈非空恒返 true**——未消费键不穿透
   * 至三序（07 §4.3 overlay 占焦条款）。栈空返 false（无浮层归常态路由）。
   */
  routeEvent(event: InputEvent): boolean {
    const top = this.entries[this.entries.length - 1];
    if (top === undefined) return false;
    top.content.handleEvent(event); // 消费与否都在层内终局（不穿透）
    return true;
  }
}
