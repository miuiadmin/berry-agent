/**
 * 副屏编舞件（07 §4.1 引擎节件 6（组件与呈现装配件） + §4.3 屏幕模型双形态）：AltScreenHost——
 * 备屏 1049 整屏切换的进出编排。
 *
 * 「overlay」专指主屏浮层（OverlayStack）；本件是副屏路——件 8 /history
 * 回看器与 06 /memory 的呈现形态（整屏内容值得 1049 备屏切换）。
 *
 * 编舞序（进出对称）：
 * - 进：主屏 suspendMain（出屏串 + 卸监听 + pause 流 + raw 复先验）→ 副屏
 *   Engine（共享同一 io 实例、screen:'alt-screen'）start（1049 备屏进 + raw +
 *   放流——start 的显式放流正是为共享 io 场景补的结构性接缝）；
 * - 出：退订转发 → 副屏 dispose（备屏出 + raw 复原 + pause）→ 主屏 resumeMain
 *   （进屏串 + raw + 放流 + 全帧重画不走 repaint：停屏期瞬时行靠全帧 + 缓冲
 *   补吐，07 屏模型 / 件 8 条款）→ onReturn 装配钩（树重建等附加动作）。
 *
 * 输入路由切换：共享 io 同一时刻只有一个在听（主屏 suspendMain 已卸监听、
 * 副屏 start 重装）——副屏 input 事件转发 content.handleEvent（回看器键盘滚动）。
 *
 * 鼠标降级接线（2026-09-11 鼠标解码批）：open 组合 onMouseLegacy——X10 形首
 * 达（开了 1006 的会话里到达 ⟺ 终端无 SGR 能力，判据可靠）即写 DECRST
 * 1006/1002 关鼠标签听把选区还给终端原生（写序与出屏关序同取先 1006 后
 * 1002）。降级闩 = per-entry：每次 open 新 Engine 新 decoder——重开重新武装、
 * 再吃一次首达（非 SGR 终端上重开 /history 的首个鼠标事件死一次为已知代价）。
 *
 * 构造双注 (primary, io)：Engine.io 私有无 getter——装配根同根传两参（io 须与
 * primary 共享同一实例，否则编舞失联）。
 *
 * 批 10f-4 主屏绑收窄：primary 原系 Engine 型——10e 前旧设想残留（主屏
 * TuiBackend 自持输入管线不经 Engine，07 篇屏模型双形态实装对账注）。收窄为
 * AltScreenPrimary 最小宿主介面（本件实际消费面：挂起 / 复起 + 生命周期判定
 * 位）；Engine 语义保留给副屏自身的帧管线（生命周期四态仅副屏 Engine 消费）。
 */
import { Engine, type EngineOptions } from '../../engine/index.js';
import type { InputEvent, TerminalIO } from '../../engine/types.js';
import type { OverlayContent, OverlayHandle } from './overlay.js';

/**
 * 主屏宿主窄介面（AltScreenHost 消费面的最小集——批 10f-4 收窄）。
 *
 * 实装 = TuiBackend（主屏挂起 / 复起交出面 UiBackend 实装件自持——07 §4.1
 * 件 8 条款 2026-09-07 勘正：主屏编舞自持不经 Engine）。挂起 = 停屏期主屏
 * 零写出 + 瞬时行入缓冲；复起 = 全帧重画不走（通道）repaint + 瞬时行缓冲
 * 补吐——语义细节归实装件（tui-backend.ts 直测覆盖）。
 */
export interface AltScreenPrimary {
  /** 生命周期判定位（'running' 才是可挂起对象——open 前置闸；四态词表对齐 Engine） */
  readonly lifecycle: 'idle' | 'running' | 'suspended' | 'disposed';
  /** 挂起主屏（进副屏半场：出屏串 + 卸监听 + 停流 + raw 复先验 + 渲染 no-op 闸） */
  suspendMain(): void;
  /** 复起主屏（出副屏半场：进屏串 + 重装 + 放流 + 全帧重画 + 瞬时行补吐） */
  resumeMain(): void;
}

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
  private readonly primary: AltScreenPrimary;
  private readonly io: TerminalIO;
  private readonly engineOptions: Omit<EngineOptions, 'io' | 'screen'> | undefined;
  private readonly onReturn: (() => void) | undefined;
  private alt: Engine | null = null;
  private unsubAltInput: (() => void) | null = null;

  constructor(primary: AltScreenPrimary, io: TerminalIO, options: AltScreenOptions = {}) {
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
    this.primary.suspendMain(); // 出主屏（编舞对称的进半场）
    const base = this.engineOptions;
    const alt = new Engine({
      ...base,
      io: this.io,
      screen: 'alt-screen',
      // X10 首达降级组合柄：关鼠标签听回终端原生选区 + 链原注入柄（透传面）
      onMouseLegacy: () => {
        this.io.write('\x1b[?1006l\x1b[?1002l'); // DECRST（与出屏关序同取——对称律同序）
        base?.onMouseLegacy?.();
      },
    });
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
    this.primary.resumeMain(); // 主屏复起 + 全帧重画不走 repaint（07 条款）+ 瞬时行补吐
    this.onReturn?.();
  }
}
