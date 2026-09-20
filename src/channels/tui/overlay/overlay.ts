/**
 * 主屏浮层基建（07 §4.1 引擎节件 6（组件与呈现装配件））：OverlayStack——cell 网格局部区浮层。
 *
 * 「overlay」专指主屏浮层（不进 1049 备屏——副屏另名 AltScreenHost）：
 * - 栈形多枚并存（栈序即叠放序——装配层经 contents 快照按栈底→栈顶序排段；
 *   锚定自由定位路已整域清退〔renderAll + OverlayAnchor 一刀清——第五役
 *   F3〕，浮层位形全归装配层栈序叠放）；
 * - 事件路由模态独占：栈非空时 routeEvent 恒返 true——占焦期间未消费键
 *   不穿透至 UiBackend 三序（07 §4.3 输入路由拦截链条款）；
 * - 进出栈经 onChange 通知装配层请求重绘（overlay 是主屏帧的组成段）。
 */
import type { InputEvent, Renderable } from '../../engine/index.js';

/** 浮层内容协议：可渲染 + 可吃键（占焦模态件的两面） */
export interface OverlayContent extends Renderable {
  /** 键 / 文本 / IME / 粘贴事件分发（返回是否消费——未消费也不穿透） */
  handleEvent(event: InputEvent): boolean;
}

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
  closed: boolean;
}

/**
 * 浮层栈：固定区首段的内容源与输入路由的「先吃段」。
 *
 * 装配序（每帧）：tui-backend renderFixed 经 contents 快照将各层按栈序
 * 自上而下叠放为固定区首段（各层量高 + 视口帽收口——与主树分域不覆盖）；
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

  /** 在场浮层只读快照（栈底→栈顶——装配层量高遍历/测试观测面） */
  get contents(): readonly OverlayContent[] {
    return this.entries.map((entry) => entry.content);
  }

  /** 开层：压栈 + 返回句柄（幂等关闭归句柄） */
  open(content: OverlayContent): OverlayHandle {
    const entry: OverlayEntry = { content, closed: false };
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
