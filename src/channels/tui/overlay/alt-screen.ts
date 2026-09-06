/**
 * 副屏编舞件（07 §4.1 呈现面件 6 + §4.3 屏幕模型双形态）：AltScreenHost——
 * 备屏 1049 整屏切换的进出编排。
 *
 * 「overlay」专指主屏浮层（OverlayStack）；本件是副屏路——件 8 /history
 * 回看器与 06 /memory 的呈现形态（整屏内容值得 1049 备屏切换）。
 *
 * 编舞序（进出对称）：
 * - 进：主屏 suspend（出屏串 + 卸监听 + pause 流 + raw 复先验）→ 副屏 Engine
 *   （共享同一 io 实例、screen:'alt-screen'）start（1049 备屏进 + raw + 放流
 *   ——start 的显式放流正是为共享 io 场景补的结构性接缝）；
 * - 出：退订转发 → 副屏 dispose（备屏出 + raw 复原 + pause）→ 主屏 resume
 *   （进屏串 + raw + 放流 + forceFull 全帧重画——不走 repaint：停屏期入树的
 *   瞬时行靠全帧补显，07 屏幕模型条款）→ onReturn 装配钩（树重建等附加动作）。
 *
 * 输入路由切换：共享 io 同一时刻只有一个 Engine 在听（主屏 suspend 已卸监听、
 * 副屏 start 重装）——副屏 input 事件转发 content.handleEvent（回看器键盘滚动）。
 *
 * 构造双注 (primary, io)：Engine.io 私有无 getter——装配根同根传两参（io 须与
 * primary 共享同一实例，否则编舞失联）。
 */
import { Engine, type EngineOptions } from '../../engine/index.js';
import type { InputEvent, TerminalIO } from '../../engine/types.js';
import type { OverlayContent, OverlayHandle } from './overlay.js';

/** 副屏编舞选项 */
export interface AltScreenOptions {
  /** 引擎构造透传（测试假钟 / 帧帽注入口——io 与 screen 由本件独占） */
  readonly engineOptions?: Omit<EngineOptions, 'io' | 'screen'>;
  /** 出副屏钩（主屏 resume 已全帧重画后调——装配层做树重建等附加动作） */
  readonly onReturn?: () => void;
}

/**
 * 副屏宿主：单副屏在场（再 open 拒绝返 null——1049 无嵌套备屏）。
 */
export class AltScreenHost {
  private readonly primary: Engine;
  private readonly io: TerminalIO;
  private readonly engineOptions: Omit<EngineOptions, 'io' | 'screen'> | undefined;
  private readonly onReturn: (() => void) | undefined;
  private alt: Engine | null = null;
  private unsubAltInput: (() => void) | null = null;

  constructor(primary: Engine, io: TerminalIO, options: AltScreenOptions = {}) {
    this.primary = primary;
    this.io = io;
    this.engineOptions = options.engineOptions;
    this.onReturn = options.onReturn;
  }

  /** 副屏在场态 */
  get isOpen(): boolean {
    return this.alt !== null;
  }

  /**
   * 进副屏：挂起主屏 → 副屏 Engine 进屏 → 输入转发接线。
   * 拒绝位：已在副屏 / 主屏不在 running 态（无挂起对象）返 null。
   */
  open(content: OverlayContent): OverlayHandle | null {
    if (this.alt !== null) return null; // 已在副屏——无嵌套备屏
    if (this.primary.lifecycle !== 'running') return null; // 主屏不在场无挂起对象
    this.primary.suspend(); // 出主屏（编舞对称的进半场）
    const alt = new Engine({ ...this.engineOptions, io: this.io, screen: 'alt-screen' });
    alt.start(content); // 1049 备屏进 + 首帧（start 显式放流——共享 io 接缝）
    this.unsubAltInput = alt.on('input', (event: InputEvent) => {
      content.handleEvent(event); // 副屏内容终局消费（回看器键盘滚动）
    });
    this.alt = alt;
    let closed = false;
    return {
      close: () => {
        if (closed) return;
        closed = true;
        this.close();
      },
      get closed() {
        return closed;
      },
    };
  }

  /** 出副屏（幂等）：退订 → 副屏 dispose → 主屏 resume（全帧重画）→ onReturn 钩 */
  private close(): void {
    const alt = this.alt;
    if (alt === null) return;
    this.unsubAltInput?.(); // 先退订转发（防 dispose 过程竞发）
    this.unsubAltInput = null;
    this.alt = null;
    alt.dispose(); // 备屏出 + raw 复原 + pause 流
    this.primary.resume(); // 主屏复起 + forceFull 全帧重画（不走 repaint——07 条款）
    this.onReturn?.();
  }
}
