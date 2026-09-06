/**
 * 引擎编排件（07 篇引擎节件 5——帧管线 + 生命周期状态机 + 交出面）。
 *
 * - **帧管线**：requestRender 单入口——请求合并（帧定时器在飞则不另排，多次
 *   请求一帧收）+ FPS 帧率帽（帧间隔下限：距上帧不足一间隔则排到帽点）+
 *   按需渲染（无请求零写出）。帧体：back 清屏 → 根渲染 → renderFrameDiff
 *   增量（光标去重内建 diff 件——内容与光标**双零才整帧零写出**）→ DECSET
 *   2026 同步输出包裹 → io.write。双缓冲换位（back 升格屏上真相——复用
 *   内存零分配，resize 是唯一重分配点）。
 * - **生命周期四态闸门**（idle / running / suspended / disposed）：挂起终退后
 *   残听、迟到 resize、迟到渲染请求一律静默吞——竞态不靠时序约定靠闸门。
 * - **双形态模式串**（单源常量、严格对称反序）：inline 主屏形态缺省——驻
 *   primary screen 不进 1049 备屏（正文 append-only 交终端原生 scrollback）；
 *   alt-screen 副屏形态——1049 备屏进出（/history /memory 回看器）。
 * - **挂起 / 复起交出面**：挂起三件套（出屏模式串 → 卸输入监听 → 丢在途
 *   转义 → 停流 → raw 复原先验态）；复起六步（进屏模式串 → raw 重设 →
 *   监听重装 → **显式放流**（已被显式 pause 的流再挂监听不会自动回 flowing，
 *   缺放流则永久失聪）→ 几何核对（挂起期 resize 被闸门整批丢弃，复起重查
 *   真值不信缓存）→ 全量重绘）。drainInput 终退排空（临时吞处理器 + 放流 +
 *   闲窗轮询——总帽 1000ms / 闲窗 50ms；dispose 不自动排空、终退编舞由装配
 *   侧显式调用）。
 * - **终端态复原钩子**：仅真 ProcessTerminalIO 武装（注入 io 零污染）——持屏
 *   窗内 fatal exit 不经 dispose 时 process 'exit' 兜底写 LEAVE_MODES + raw
 *   交还。
 * - **输入接线**：decoder.feed → 事件排空上抛；lone-ESC 判定窗定时器由引擎
 *   装 / 卸；kitty 探测应答上抛 keyboardProtocol 事件。
 */
import { CellGrid } from './cell.js';
import { renderFrameDiff } from './diff.js';
import { InputDecoder } from './input.js';
import { ProcessTerminalIO } from './process-io.js';
import type { InputEvent, KeyboardProtocol, Region, Renderable, TerminalIO } from './types.js';

/** 缺省帧率帽（帧间隔下限 = 1000/60——码面缺省随性能回归锁校准回填） */
const DEFAULT_FPS_CAP = 60;
/** 缺省 lone-ESC 判定窗（ms——承 berry 实证值升为行为预算） */
const DEFAULT_ESCAPE_WINDOW_MS = 30;
/** drainInput 缺省窗（总帽 / 闲窗——承 berry 实证值升为行为预算） */
const DRAIN_MAX_MS = 1000;
const DRAIN_IDLE_MS = 50;

/** 屏幕形态两分：inline 主屏（不进 1049）/ alt-screen 副屏（1049 备屏进出） */
export type ScreenForm = 'inline' | 'alt-screen';

/** 进屏模式串公共尾（两形态共用）：光标藏 + 粘贴开 + kitty 推送 + 探测 */
const ENTER_COMMON =
  '\x1b[?25l' + // 光标藏（帧尾按声明落位再显）
  '\x1b[?2004h' + // bracketed paste 开（粘贴严格处理）
  '\x1b[>1u' + // kitty 键盘协议推栈：disambiguate 最小位（Esc/alt/ctrl 无歧义化）
  '\x1b[?u' + // kitty 探测：查询当前增强位
  '\x1b[c'; // DA1 探测哨兵（应答先到无 kitty 应答 = legacy）

/** 出屏模式串公共头（两形态共用）：与进屏公共尾严格对称反序 */
const LEAVE_COMMON =
  '\x1b[<u' + // kitty 弹栈（恢复宿主栈态——kitty 规范）
  '\x1b[?2004l' + // 粘贴关
  '\x1b[?25h'; // 光标显

/** 形态 → 进屏模式串（1049 备屏进出仅在 alt-screen 形态） */
const ENTER_MODES: Record<ScreenForm, string> = {
  inline: ENTER_COMMON,
  'alt-screen': '\x1b[?1049h' + ENTER_COMMON, // 备屏进
};
/** 形态 → 出屏模式串（与进屏严格对称反序——单源常量） */
const LEAVE_MODES: Record<ScreenForm, string> = {
  inline: LEAVE_COMMON,
  'alt-screen': LEAVE_COMMON + '\x1b[?1049l', // 备屏出（回主屏）
};

/** 引擎事件面（零 durable 事件的运行时侧通道） */
export interface EngineEventMap {
  /** 结构化输入事件（key/text/ime/paste 四分——decoder 产出） */
  input: InputEvent;
  /** 几何变更（缓冲已弃旧换新、清屏锤已写——消费方按新几何重排） */
  resize: { columns: number; rows: number };
  /** kitty 探测落定（应答前缺省 legacy） */
  keyboardProtocol: KeyboardProtocol;
}

/** 极简类型化 emitter（订阅返回卸载函数——装拆对称） */
class Emitter<M> {
  private readonly map = new Map<keyof M, Set<(payload: never) => void>>();

  on<K extends keyof M>(event: K, cb: (payload: M[K]) => void): () => void {
    let set = this.map.get(event);
    if (!set) {
      set = new Set();
      this.map.set(event, set);
    }
    set.add(cb as (payload: never) => void);
    return () => set.delete(cb as (payload: never) => void);
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.map.get(event);
    if (!set) return;
    for (const cb of set) (cb as (payload: M[K]) => void)(payload);
  }
}

/** 引擎构造选项 */
export interface EngineOptions {
  /** 终端 IO（缺省 ProcessTerminalIO——组合根注入替代品的注入口） */
  io?: TerminalIO;
  /** 屏幕形态（缺省 inline 主屏——alt-screen 为副屏回看器形态） */
  screen?: ScreenForm;
  /** 帧率帽 fps（帧间隔下限 = 1000/fps——码面缺省随性能回归锁校准回填） */
  fpsCap?: number;
  /** lone-ESC 判定窗（ms；缺省 30） */
  escapeWindowMs?: number;
  /** 时钟注入（缺省 Date.now——测试假钟注入口） */
  now?: () => number;
  /** 调度注入（缺省 setTimeout——测试假钟注入口） */
  schedule?: (fn: () => void, ms: number) => unknown;
  /** 取消调度注入（缺省 clearTimeout） */
  cancelSchedule?: (handle: unknown) => void;
}

/** TUI 引擎（构造后 start 进屏；dispose 终退） */
export class Engine {
  private readonly io: TerminalIO;
  private readonly screen: ScreenForm;
  /** 帧率帽（帧间隔下限 = 1000/fpsCap ms） */
  private readonly minFrameMs: number;
  /** 时钟 / 调度注入（测试假钟注入口） */
  private readonly now: () => number;
  private readonly scheduleFn: (fn: () => void, ms: number) => unknown;
  private readonly cancelFn: (handle: unknown) => void;

  /** 渲染树根（shell 经 setRoot 装载） */
  private root: Renderable | null = null;
  /** 双缓冲：front = 屏上真相（差分基线）/ back = 本帧渲染目标 */
  private front: CellGrid;
  private back: CellGrid;

  /** 全量帧旗标（首帧 / 复起重进 / resize——front 基线失真时置位） */
  private forceFull = true;
  /** 帧定时器句柄（null = 无在飞帧——请求合并的合并位） */
  private frameHandle: unknown = null;
  /** 上帧时刻（FPS 帽锚——调度时刻滚；-Infinity = 首帧立即出） */
  private lastFrameAt = Number.NEGATIVE_INFINITY;

  /** 生命周期态：idle 未启 / running 持屏 / suspended 挂起 / disposed 终退 */
  private state: 'idle' | 'running' | 'suspended' | 'disposed' = 'idle';
  /** start 时的 raw 先验态（suspend/dispose 复原依据） */
  private priorRaw = false;

  /** 输入解码器（kitty/legacy 双轨 + IME 组字态） */
  private readonly decoder: InputDecoder;
  /** lone-ESC 判定窗（构造时留档——定时器装排用） */
  private readonly decoderEscapeWindowMs: number;
  /** lone-ESC 判定窗定时器句柄 */
  private escapeHandle: unknown = null;
  /** 输入监听退订函数（null = 未装） */
  private unsubInput: (() => void) | null = null;
  /** resize 监听退订函数（挂起期保留监听、dispose 才卸） */
  private unsubResize: (() => void) | null = null;
  /** 引擎事件面 */
  private readonly events = new Emitter<EngineEventMap>();
  /** kitty 探测落定值（应答到达前缺省 legacy） */
  private protocol: KeyboardProtocol = 'legacy';
  /**
   * 硬退复原钩子解除器（null = 未武装）：持屏窗内 fatal exit(1)/二次
   * SIGINT exit(130) 不经 dispose——用户被留在死模式态（备屏 / 光标藏 /
   * 粘贴开 / kitty 推栈）。生命周期 = 持屏窗〔start/resume → suspend/dispose〕。
   */
  private disarmExitRestore: (() => void) | null = null;

  constructor(opts: EngineOptions = {}) {
    this.io = opts.io ?? new ProcessTerminalIO();
    this.screen = opts.screen ?? 'inline';
    this.minFrameMs = 1000 / (opts.fpsCap ?? DEFAULT_FPS_CAP);
    this.now = opts.now ?? Date.now;
    this.scheduleFn = opts.schedule ?? ((fn, ms) => setTimeout(fn, ms));
    this.cancelFn = opts.cancelSchedule ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    const { columns, rows } = this.io.size();
    this.front = new CellGrid(columns, rows);
    this.back = new CellGrid(columns, rows);
    this.decoder = new InputDecoder({
      now: this.now,
      escapeWindowMs: opts.escapeWindowMs ?? DEFAULT_ESCAPE_WINDOW_MS,
      onProtocol: (p) => {
        this.protocol = p;
        this.events.emit('keyboardProtocol', p);
      },
    });
    this.decoderEscapeWindowMs = opts.escapeWindowMs ?? DEFAULT_ESCAPE_WINDOW_MS;
  }

  /** 当前网格宽（列——io 直查真值不缓存） */
  get columns(): number {
    return this.io.size().columns;
  }

  /** 当前网格高（行） */
  get rows(): number {
    return this.io.size().rows;
  }

  /** 挂起中旗标（换防面查询） */
  get suspended(): boolean {
    return this.state === 'suspended';
  }

  /** 生命周期态（idle/running/suspended/disposed） */
  get lifecycle(): 'idle' | 'running' | 'suspended' | 'disposed' {
    return this.state;
  }

  /** kitty 探测落定值（应答前缺省 legacy） */
  get keyboardProtocol(): KeyboardProtocol {
    return this.protocol;
  }

  /** 事件订阅（返回卸载函数） */
  on<K extends keyof EngineEventMap>(event: K, cb: (payload: EngineEventMap[K]) => void): () => void {
    return this.events.on(event, cb);
  }

  /**
   * 进屏启动：模式串写出 + raw 设定 + 输入 / resize 监听装上 + 全量首帧。
   * 幂等保护：仅 idle 可启（挂起复位走 resume）。
   */
  start(root: Renderable): void {
    if (this.state !== 'idle') return;
    this.priorRaw = this.io.isRaw();
    this.root = root;
    this.io.write(ENTER_MODES[this.screen]);
    this.armExitRestore();
    this.io.setRawMode(true);
    this.unsubInput = this.io.onInput(this.handleInput);
    this.unsubResize = this.io.onResize(this.handleResize);
    // 显式放流：已被显式 pause 的流（如副屏 Engine 复用主屏挂起后共享的 io）
    // 再挂监听不会自动回 flowing——须放流才有数据事件；首启场景对已
    // flowing 流为 no-op（Node 流语义），与 resume 六步的放流位对齐
    this.io.resume();
    this.state = 'running';
    this.forceFull = true;
    this.requestRender();
  }

  /** 换渲染树根（同帧请求合并——下帧生效） */
  setRoot(root: Renderable): void {
    this.root = root;
    this.requestRender();
  }

  /**
   * 渲染请求（单入口语义）：挂起 / 终退态静默短路（闸门）；帧定时器在飞则
   * 不另排（请求合并——多次请求一帧收）。
   */
  requestRender(): void {
    if (this.state === 'suspended' || this.state === 'disposed') return; // 闸门短路
    if (this.frameHandle === null) {
      // FPS 帽：距上帧不足一个帧间隔 → 排到帽点；否则下一拍即出
      const due = Math.max(0, this.lastFrameAt + this.minFrameMs - this.now());
      this.frameHandle = this.scheduleFn(() => {
        this.frameHandle = null;
        this.renderNow();
      }, due);
    }
  }

  /** 立即帧（测试与强制刷新面——绕过调度直出） */
  renderNow(): void {
    if (this.state !== 'running' || !this.root) return;
    this.lastFrameAt = this.now();
    // back 清屏 → 根渲染（全屏区域）→ 差分。forceFull 时清差分基线——front
    // 全空基线使 renderFrameDiff 自然全量（光标声明随 clear 归零、去重基线同步重置）
    this.back.clear();
    if (this.forceFull) {
      this.front.clear();
      this.forceFull = false;
    }
    const region: Region = { row: 0, col: 0, width: this.back.columns, height: this.back.rows };
    this.root.render(this.back, region);
    const content = renderFrameDiff(this.front, this.back);
    if (content.length === 0) return; // 内容与光标双零才整帧零写出
    // DECSET 2026 同步输出包裹：内容 + 光标同帧原子呈现（不支持的主流外终端
    // 撕裂自担——赌主流不探测）
    this.io.write(`\x1b[?2026h${content}\x1b[?2026l`);
    // 双缓冲换位：back 升格屏上真相（新 back 为旧 front——复用内存零分配）
    const t = this.front;
    this.front = this.back;
    this.back = t;
  }

  /**
   * 挂起（换防交出方——三件套）：出屏模式串 → 卸输入监听 → 丢在途转义 →
   * 停流 → raw 复原先验态。挂起后 requestRender 静默短路（闸门）；resize
   * 监听保留（无副作用——复起几何核对兜住挂起期变更）。
   */
  suspend(): void {
    if (this.state !== 'running') return;
    this.io.write(LEAVE_MODES[this.screen]);
    this.unsubInput?.();
    this.unsubInput = null;
    this.decoder.discardPending(); // 在途转义 / 粘贴 / 预编辑一窗全丢（粘贴态转吸收）
    this.io.pause();
    this.io.setRawMode(this.priorRaw);
    this.cancelFrame();
    this.state = 'suspended';
    this.disarmExitRestore?.(); // 出屏解除硬退复原钩子（持屏窗闭合）
  }

  /**
   * 复位（换防接收方——六步）：进屏模式串清屏进 → raw 重设 → 监听重装 →
   * **显式放流**（已被显式 pause 的流再挂监听不会自动回 flowing——缺放流则
   * 复位后引擎永久失聪）→ 几何核对（挂起期 resize 事件被闸门整批丢弃——
   * 复起重查当前真值，失配即 handleResize 同款弃旧换新）→ 全量首帧重绘
   * （front 基线在挂起期已失真——对方栈写过屏）。
   */
  resume(): void {
    if (this.state !== 'suspended') return;
    this.io.write(ENTER_MODES[this.screen]);
    this.armExitRestore(); // 复进屏重武装（arm 幂等——先解除旧钩子再挂）
    this.io.setRawMode(true);
    this.unsubInput = this.io.onInput(this.handleInput);
    this.io.resume();
    this.state = 'running';
    // 几何核对：失配即走 handleResize 同款重分配（此时 state 已 running——
    // 新 CellBuffer×2 + 2J 清屏锤 + resize 事件 + forceFull，尾部自带
    // requestRender 直接收口）。修前不核对：按旧尺寸全量重绘——终端已缩则
    // 差分写出含越界定位 / 旧宽折行，已扩则桌面不扩张
    const { columns, rows } = this.io.size();
    if (columns !== this.front.columns || rows !== this.front.rows) {
      this.handleResize();
      return;
    }
    this.forceFull = true;
    this.requestRender();
  }

  /**
   * 排空 stdin 缓冲（终退回 shell 前——交出面公开方法位）：临时吞处理器 +
   * 放流 → 闲窗（idleMs 无新数据）或总帽（maxMs）到点收手。返回后输入处理
   * 器保持卸载、stdin 暂停——干净交回 shell。dispose 不自动排空——终退编舞
   * （排空 → 出屏 → dispose 序）由装配侧显式调用。
   */
  async drainInput(maxMs: number = DRAIN_MAX_MS, idleMs: number = DRAIN_IDLE_MS): Promise<void> {
    const wasRunning = this.state === 'running';
    if (wasRunning) {
      this.unsubInput?.(); // 运行态调用：先卸引擎处理器
      this.unsubInput = null;
    }
    let lastData = this.now();
    const swallow = (): void => {
      lastData = this.now();
    };
    const unsubSwallow = this.io.onInput(swallow);
    this.io.resume(); // 放流：缓冲数据事件化（被吞处理器吃掉）
    const deadline = this.now() + maxMs;
    while (this.now() < deadline && this.now() - lastData < idleMs) {
      await new Promise<void>((res) => this.scheduleFn(res, idleMs));
    }
    unsubSwallow();
    this.io.pause();
    if (wasRunning) {
      // 运行态调用（罕见）：恢复引擎处理器与流态
      this.unsubInput = this.io.onInput(this.handleInput);
      this.io.resume();
    }
  }

  /** 终退：出屏 + 一切复原（dispose 后引擎不可复用） */
  dispose(): void {
    if (this.state === 'disposed') return;
    if (this.state === 'running') {
      this.io.write(LEAVE_MODES[this.screen]);
      this.unsubInput?.();
      this.unsubInput = null;
      this.io.pause();
      this.io.setRawMode(this.priorRaw);
    }
    this.unsubResize?.();
    this.unsubResize = null;
    this.cancelFrame();
    this.cancelEscapeTimer();
    this.disarmExitRestore?.(); // 出屏解除硬退复原钩子（挂起态已解除亦幂等）
    this.state = 'disposed';
  }

  /**
   * 武装硬退复原钩子（仅真 ProcessTerminalIO——注入 io 零污染）：进屏模式串
   * 是写字节开启的设备态（备屏 / 光标 / 粘贴 / kitty 推栈），fatal exit 不经
   * dispose——钩子在 process 'exit' 兜底写 LEAVE_MODES（与出屏严格对称反序
   * ——单源常量）+ raw 交还。
   */
  private armExitRestore(): void {
    if (!(this.io instanceof ProcessTerminalIO)) return; // 注入 io（测试）零污染
    this.disarmExitRestore?.();
    const restore = (): void => {
      try {
        this.io.write(LEAVE_MODES[this.screen]); // 出屏对称反序单源
        this.io.setRawMode(false); // raw 交还（进程出场钩亦会做——幂等兜底）
      } catch {
        // 复位尽力而为——退出路径不允许二次异常
      }
    };
    process.on('exit', restore);
    this.disarmExitRestore = () => {
      process.removeListener('exit', restore);
      this.disarmExitRestore = null;
    };
  }

  /** 输入处理器（decoder 喂入 + 事件排空上抛 + lone-ESC 判定窗定时器装 / 卸） */
  private readonly handleInput = (chunk: string): void => {
    if (this.state !== 'running') return; // 挂起 / 终退后残听防御（闸门）
    this.decoder.feed(chunk);
    if (this.decoder.hasPendingEscape && this.escapeHandle === null) {
      this.escapeHandle = this.scheduleFn(() => {
        this.escapeHandle = null;
        this.decoder.settle();
        this.flushDecoderEvents();
      }, this.decoderEscapeWindowMs);
    }
    this.flushDecoderEvents();
  };

  /** 排空 decoder 事件队列并上抛 emitter */
  private flushDecoderEvents(): void {
    for (const ev of this.decoder.take()) {
      this.events.emit('input', ev);
    }
  }

  /** resize 处理器：缓冲弃旧换新 + 清屏锤 + 全量重绘 + 事件上抛 */
  private readonly handleResize = (): void => {
    if (this.state !== 'running') return; // 迟到 resize 静默吞（闸门）
    const { columns, rows } = this.io.size();
    if (columns === this.front.columns && rows === this.front.rows) return;
    this.front = new CellGrid(columns, rows); // 弃旧换新（不做原地搬运——宽字符 reflow 必失真）
    this.back = new CellGrid(columns, rows);
    this.forceFull = true;
    // 清屏锤：resize 后终端可能 reflow 残留——2J 全清 + 全量重绘兜底
    this.io.write('\x1b[2J');
    this.events.emit('resize', { columns, rows });
    this.requestRender();
  };

  /** 取消在飞帧定时器 */
  private cancelFrame(): void {
    if (this.frameHandle !== null) {
      this.cancelFn(this.frameHandle);
      this.frameHandle = null;
    }
  }

  /** 取消 lone-ESC 判定窗定时器 */
  private cancelEscapeTimer(): void {
    if (this.escapeHandle !== null) {
      this.cancelFn(this.escapeHandle);
      this.escapeHandle = null;
    }
  }
}
