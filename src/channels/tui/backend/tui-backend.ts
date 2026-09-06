/**
 * TUI 后端（UiBackend 的终端实装——07 §4.3 通道后端面的 tui 腿）。
 *
 * 批 10e-1 呈现纵切落直播呈现/状态面/固定区静态形；批 10e-2 交互纵切接
 * 输入管线与交互件（本批）：
 * - **输入管线自持**（不经 Engine——Engine 是全屏帧管线〔清屏锤/帧差分〕，
 *   与主屏 append-only 编舞直接冲突；07「两形态进出场模式串分立」条款正合
 *   本件自定义主屏形模式串：粘贴开 + kitty 推栈/弹栈 + 探测哨兵——无光标
 *   藏、无 1049）：InputDecoder 喂入 + lone-ESC 判定窗 + raw 模式 + 硬退
 *   复原钩；
 * - **路由四层**（07 §4.3 拦截链序）：①全局键（ctrl+c 打断 / ctrl+d 空框
 *   退出——overlay 在场或框有文时 ctrl+d 让路）→ ②overlay 模态独占（未消费
 *   键不穿透）→ ③补全弹层（非模态——未消费穿透）→ ④编辑器（未消费键终局
 *   丢弃）；提交路由：input-ask 应答优先 → '/' 起手命令柄（false 落
 *   onSubmit 兜底——03 §2.2 驱动侧语义归 conversation）→ onSubmit；
 * - **固定区 v2 动态布局**（自上而下）：overlay 段（锚定注册表 = 本件
 *   renderFixed 行账——开层锚定闭包读注册表）→ todo 面板（件 4）/ 工具
 *   进度面板（件 5）〔后续批接入，本批零行〕→ input-ask 提示行 → 补全
 *   弹层 → 编辑器（动态量高 + 光标声明——setFixed 声明位落 cup）→ 状态行；
 * - **渲染合并**：调度注入后 op 队列合并（连续 present 留末次、transient
 *   到达序保持、固定区脏位重建一帧一次）+ fps 帽 60 + tick 100ms 自重排
 *   驱动状态行转轮；**无注入调度 = 同步直出**（测试语义——合并与自驱 tick
 *   关闭，10e-1 同步断言原样成立；生产装配须注入宿主调度）。
 *
 * 批内边界：setWidget 不支撑（报 false）；主屏滚动帽实测定值挂装配批 12
 * 实机；件 7 OSC 外显与件 8 副屏（AltScreenHost 与本件共享 io）不在本纵切。
 */
import type { AgentEvent } from '../../../agent/index.js';
import type { AgentMessage } from '../../../contracts/index.js';
import type {
  ApprovalAskAnswer,
  ApprovalAskRequest,
  NotifyLevel,
  SessionEnvelope,
  UiAskOptions,
  UiBackend,
  UiInputOptions,
  UiSelectChoice,
} from '../../types.js';
import { CellGrid, InputDecoder, ProcessTerminalIO, type TerminalIO } from '../../engine/index.js';
import { MainScreen } from './main-screen.js';
import { LiveTranscript, type SummaryLine, type TranscriptBlock } from './transcript.js';
import { StatusLine } from '../status/status-line.js';
import { sessionColor } from '../theme.js';
import { buildSgr, SGR_RESET } from './ansi-rows.js';
import { Editor } from '../editor/editor.js';
import { OverlayStack, type OverlayAnchor, type OverlayContent, type OverlayHandle } from '../overlay/overlay.js';
import { ConfirmPanel, SelectPanel } from '../overlay/select-confirm.js';
import { AutocompletePopup } from '../autocomplete/popup.js';
import { CombinedAutocompleteProvider, type AutocompleteSources } from '../autocomplete/autocomplete.js';

/** 后端构造选项 */
export interface TuiBackendOptions {
  /** 当前交互会话位（提交/打断柄的 sessionId 机器位——装配焦点联动可改） */
  readonly sessionId?: string;
  /** 装配向接线柄（07 §4.3 两柄）：提交（非命令形文本——驱动 conversation） */
  readonly onSubmit?: (sessionId: string, text: string) => void;
  /** 装配向接线柄：打断当前 run（ctrl+c——run 打断经装配侧折入 ask 链收口） */
  readonly onInterrupt?: (sessionId: string) => void;
  /** 装配向接线柄：退出（ctrl+d 空框） */
  readonly onQuit?: () => void;
  /** 命令柄（'/' 起手文本——03 §2.2 dispatch；false = 未命中落 onSubmit 兜底） */
  readonly dispatchCommand?: (input: string) => Promise<boolean>;
  /** 补全三源注入（命令名源注入查询函数接 CommandRegistry.list()；@ 文件段源归装配批） */
  readonly autocomplete?: AutocompleteSources;
  /** 调度注入（启用渲染合并 + fps 帽 + tick 自驱——缺省同步直出测试语义） */
  readonly schedule?: (fn: () => void, ms: number) => unknown;
  /** 取消调度注入（与 schedule 配对——stop 时收在飞帧/tick/ESC 窗） */
  readonly cancelSchedule?: (handle: unknown) => void;
  /** 时钟注入（缺省 Date.now——fps 帽锚） */
  readonly now?: () => number;
  /** lone-ESC 判定窗（ms；缺省 30） */
  readonly escapeWindowMs?: number;
  /** 帧率帽 fps（缺省 60——与 Engine DEFAULT_FPS_CAP 对齐） */
  readonly fpsCap?: number;
  /** 编辑器最大可视行（装配按终端高 30% 注入；缺省 8） */
  readonly maxVisibleLines?: number;
}

/** 主屏形进屏模式串：粘贴开 + kitty 推栈（disambiguate 最小位）+ 探测哨兵（无光标藏无 1049——与 Engine 全屏形分立） */
const ENTER_MAIN = '\x1b[?2004h' + '\x1b[>1u' + '\x1b[?u' + '\x1b[c';
/** 出屏模式串（与进屏严格对称反序——单源常量） */
const LEAVE_MAIN = '\x1b[<u' + '\x1b[?2004l';

/** 渲染合并帧率帽缺省（对齐 Engine DEFAULT_FPS_CAP） */
const DEFAULT_FPS_CAP = 60;
/** lone-ESC 判定窗缺省（对齐 Engine DEFAULT_ESCAPE_WINDOW_MS） */
const DEFAULT_ESCAPE_WINDOW_MS = 30;
/** 状态行转轮自驱间隔（ms——注入调度后自重排） */
const TICK_INTERVAL_MS = 100;

/** notify 档位符号（正文着色纪律——纯符号不配色，与摘要行会话色分立） */
const NOTIFY_SYMBOLS: Readonly<Record<NotifyLevel, string>> = Object.freeze({
  info: '·',
  success: '✓',
  warn: '⚠',
  error: '✖',
});

/** 渲染合并 op 两形（repaint/resize 权威重建不走队列——同步直出） */
type PendingOp =
  | { readonly kind: 'present'; readonly blocks: readonly TranscriptBlock[] }
  | { readonly kind: 'transient'; readonly lines: readonly string[] };

/** input-ask 在飞体（提示行呈现 + 提交应答路） */
interface InputAsk {
  readonly message: string;
  readonly resolve: (text: string) => void;
}

/**
 * TUI 后端：单终端 inline 主屏 + 自持输入管线。构造后须 start()（模式串 +
 * 清屏 + 滚动区确立）再接核事件；stop() 对称出屏（模式串反序 + raw 复原）。
 */
export class TuiBackend implements UiBackend<AgentMessage> {
  readonly id = 'tui';
  readonly capabilities = Object.freeze({
    notify: true,
    confirm: true, // 浮层面板呈现（批 10e-2 交互纵切实装）
    select: true,
    input: true,
    approval: true,
    setStatus: true,
    setWidget: false,
  });

  /** 当前交互会话位（装配焦点联动可改——提交/打断柄的机器位） */
  sessionId: string;

  private readonly io: TerminalIO;
  private readonly screen: MainScreen;
  private readonly transcript = new LiveTranscript();
  private readonly statusLine = new StatusLine();
  private readonly editor: Editor;
  private readonly popup: AutocompletePopup;
  private readonly stack = new OverlayStack();
  /** overlay 锚定注册表（content 身份键 → 本帧 region——renderFixed 行账重建） */
  private readonly overlayLayout = new Map<
    OverlayContent,
    { row: number; col: number; width: number; height: number }
  >();
  /** 装配柄（07 §4.3 两柄 + 命令柄） */
  private readonly onSubmit: ((sessionId: string, text: string) => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  private readonly dispatchCommand: ((input: string) => Promise<boolean>) | undefined;

  /* ---- 输入管线态 ---- */
  private readonly decoder: InputDecoder;
  private readonly escapeWindowMs: number;
  private escapeHandle: unknown = null;
  private unsubInput: (() => void) | null = null;
  private unsubResize: (() => void) | null = null;
  private running = false;
  private priorRaw = false;
  private disarmExitRestore: (() => void) | null = null;

  /* ---- 渲染合并态（schedule 注入后活——否则同步直出） ---- */
  private readonly scheduleFn: ((fn: () => void, ms: number) => unknown) | null;
  private readonly cancelFn: (handle: unknown) => void;
  private readonly now: () => number;
  private readonly minFrameMs: number;
  private pendingOps: PendingOp[] = [];
  private needFixed = false;
  private frameHandle: unknown = null;
  private tickHandle: unknown = null;
  private lastFlushAt = Number.NEGATIVE_INFINITY;

  /** input-ask 在飞体（null = 常态——提交落 onSubmit） */
  private inputAsk: InputAsk | null = null;

  constructor(io: TerminalIO, options: TuiBackendOptions = {}) {
    this.io = io;
    this.sessionId = options.sessionId ?? 'main';
    this.onSubmit = options.onSubmit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.dispatchCommand = options.dispatchCommand;
    this.scheduleFn = options.schedule ?? null;
    this.cancelFn = options.cancelSchedule ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    this.now = options.now ?? Date.now;
    this.minFrameMs = 1000 / (options.fpsCap ?? DEFAULT_FPS_CAP);
    this.escapeWindowMs = options.escapeWindowMs ?? DEFAULT_ESCAPE_WINDOW_MS;
    this.decoder = new InputDecoder({ now: this.now, escapeWindowMs: this.escapeWindowMs });
    this.editor = new Editor({
      onSubmit: (text) => this.handleSubmit(text),
      onChange: () => this.handleEditorChange(),
      maxVisibleLines: options.maxVisibleLines,
    });
    this.popup = new AutocompletePopup(new CombinedAutocompleteProvider(options.autocomplete ?? {}), this.editor.model);
    this.stack.onChange = () => this.touchFixed();
    this.screen = new MainScreen(io, { fixedHeight: 4 }); // 初始高：编辑器 3 + 状态行 1（动态更新经 setFixed）
  }

  /** TUI 恒有观众（07 §4.3 观众探针定值） */
  hasAudience(): boolean {
    return true;
  }

  /** 启动：主屏形模式串 + raw + 输入订阅 + 清屏滚动区 + 固定区首画 */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.priorRaw = this.io.isRaw();
    this.io.write(ENTER_MAIN);
    this.armExitRestore();
    this.io.setRawMode(true);
    this.unsubInput = this.io.onInput(this.handleInput);
    // 显式放流（共享 io 换防接缝——副屏 Engine 复用同 io 场景；首启 no-op）
    this.io.resume();
    this.screen.start();
    this.renderFixed();
    this.unsubResize = this.io.onResize(() => this.handleResize());
    if (this.scheduleFn !== null) this.armTick();
  }

  /** 对称出屏：模式串反序 + 输入卸订 + 定时器全收 + raw 复原（终退不可复用） */
  stop(): void {
    if (!this.running) return;
    this.running = false;
    this.io.write(LEAVE_MAIN);
    this.unsubInput?.();
    this.unsubInput = null;
    this.unsubResize?.();
    this.unsubResize = null;
    this.cancelTimer('frame');
    this.cancelTimer('tick');
    this.cancelTimer('escape');
    this.disarmExitRestore?.();
    this.io.pause();
    this.io.setRawMode(this.priorRaw);
  }

  /** 一次性通知：正文瞬时行直写（级别符号前缀——不进行集） */
  notify(message: string, opts?: { level?: NotifyLevel }): void {
    const symbol = NOTIFY_SYMBOLS[opts?.level ?? 'info'];
    this.pendingOps.push({ kind: 'transient', lines: [`${symbol} ${message}`] });
    this.requestRender();
  }

  /** 状态行文案（last-writer-wins——StatusLine 件语义） */
  setStatus(_sessionId: string, status: string): void {
    this.statusLine.setStatus(status);
    this.touchFixed();
  }

  /** 活体信封呈现：渲染归约 + 摘要行分叉 + 聚焦态状态面消费 */
  onEnvelope(env: SessionEnvelope, focused: boolean): void {
    const summary = this.transcript.applyEvent(env, focused);
    if (summary !== null) {
      this.pendingOps.push({ kind: 'transient', lines: [summaryToAnsi(summary)] });
    } else {
      this.enqueuePresent();
    }
    this.requestRender();
    if (focused) this.applyStatusEvent(env.event);
  }

  /** 重画呈现：投影重建行集 + 清屏全量重写（widget 槽值不支撑——忽略） */
  onRepaint(_sessionId: string, projection: readonly AgentMessage[], _widget: { node: unknown } | null): void {
    // 权威全量重建——排队旧帧作废（repaint 是新真相，合并无意义）
    this.pendingOps = [];
    this.needFixed = false;
    this.transcript.loadProjection(projection);
    this.screen.repaint(this.transcript.snapshot);
    this.renderFixed();
  }

  /** 状态行动画推帧（自驱定时器内调；公开面留装配侧手动驱动——忙态外零开销） */
  tick(): void {
    if (!this.statusLine.isBusy) return;
    this.statusLine.tick();
    this.touchFixed();
  }

  /** resize 编舞：几何重取 + 主屏全量重画 + 固定区按新几何重建（权威重建不走队列） */
  handleResize(): void {
    this.pendingOps = [];
    this.needFixed = false;
    this.screen.handleResize(this.transcript.snapshot);
    this.renderFixed();
  }

  /* ---------------- 阻塞四件（浮层面板呈现——07 §4.3） ---------------- */

  /** 是/否确认：ConfirmPanel 浮层（Enter → true / Esc → false；signal abort 保守值 + 关层） */
  confirm(message: string, opts?: UiAskOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const panel = new ConfirmPanel({ message });
      const handle = this.openAskLayer(panel, () => resolve(false), opts?.signal);
      panel.onFinish = (confirmed) => {
        handle.close();
        resolve(confirmed);
      };
    });
  }

  /** 单选：SelectPanel 浮层（Enter → value / Esc → ''；ui-core 校验不在集保守值同收 ''） */
  select(message: string, choices: readonly UiSelectChoice[], opts?: UiAskOptions): Promise<string> {
    return new Promise<string>((resolve) => {
      const panel = new SelectPanel({
        title: message,
        options: choices.map((c) => ({ value: c.value, label: c.label })),
      });
      const handle = this.openAskLayer(panel, () => resolve(''), opts?.signal);
      panel.onFinish = (value) => {
        handle.close();
        resolve(value);
      };
    });
  }

  /**
   * 自由文本：input-ask 形——提示行入固定区 + 编辑器转应答车（提交即应答，
   * 弹层抑制）；signal abort → '' 保守值 + 残稿清框。
   */
  input(message: string, opts?: UiInputOptions): Promise<string> {
    return new Promise<string>((resolve) => {
      const ask: InputAsk = { message, resolve };
      this.inputAsk = ask;
      this.editor.setText(''); // 应答起始清框（草稿让位——提交路模型自清）
      this.popup.refresh(); // 应答期弹层抑制前，在层按空框重算自隐
      opts?.signal?.addEventListener(
        'abort',
        () => {
          if (this.inputAsk !== ask) return; // 已应答收场——迟到 abort no-op
          this.inputAsk = null;
          this.editor.setText('');
          this.popup.refresh();
          resolve('');
          this.touchFixed();
        },
        { once: true },
      );
      this.touchFixed();
    });
  }

  /**
   * 审批：SelectPanel 浮层四值（批准/拒绝/总是批准/取消——Esc 面板保守值 ''
   * 映射 cancel，与 07 §4.3 收口律对齐）；always 草案经 hint 段呈现（回写
   * 归通道核 settleApprovalAlways——本件只呈现与回值）。
   */
  askApproval(request: ApprovalAskRequest, opts?: UiAskOptions): Promise<ApprovalAskAnswer> {
    return new Promise<ApprovalAskAnswer>((resolve) => {
      const title = request.toolName !== undefined ? `⚙ ${request.toolName}：${request.summary}` : request.summary;
      const panel = new SelectPanel({
        title,
        options: [
          { value: 'approve', label: '批准' },
          { value: 'reject', label: '拒绝' },
          { value: 'always', label: '总是批准', hint: request.suggestedEntry },
          { value: 'cancel', label: '取消' },
        ],
      });
      const handle = this.openAskLayer(panel, () => resolve('cancel'), opts?.signal);
      panel.onFinish = (value) => {
        handle.close();
        // 值集即 ApprovalAskAnswer 四值（面板 Esc 收 '' → cancel 映射）
        resolve(value === '' ? 'cancel' : (value as ApprovalAskAnswer));
      };
    });
  }

  /* ---------------- 内部：输入管线 ---------------- */

  /** 输入处理器：decoder 喂入 + lone-ESC 窗定时器（同步直出模式无窗即决） + 事件路由 */
  private readonly handleInput = (chunk: string): void => {
    if (!this.running) return; // stop 后残听防御
    this.decoder.feed(chunk);
    if (this.decoder.hasPendingEscape) {
      if (this.scheduleFn !== null) {
        if (this.escapeHandle === null) {
          this.escapeHandle = this.scheduleFn(() => {
            this.escapeHandle = null;
            this.decoder.settle();
            this.flushDecoderEvents();
          }, this.escapeWindowMs);
        }
      } else {
        this.decoder.settle(); // 同步直出无窗即决（测试语义——单 chunk 喂入不拆序）
      }
    }
    this.flushDecoderEvents();
  };

  /** 排空 decoder 事件队列并逐件路由 */
  private flushDecoderEvents(): void {
    for (const ev of this.decoder.take()) this.routeEvent(ev);
  }

  /**
   * 事件路由四层（07 §4.3 拦截链序）。
   * 层① 全局键先于 overlay（ctrl+c 打断 run——ask 链收口经装配侧信号折入；
   * ctrl+d 仅 overlay 空 + 编辑器空框才全局退出，否则让路面板/编辑器）；
   * 层② overlay 模态独占（未消费键不穿透）；层③ 补全弹层非模态穿透；
   * 层④ 编辑器（未消费键终局丢弃——escape 等无全局绑定）。
   */
  private routeEvent(ev: import('../../engine/types.js').InputEvent): void {
    if (ev.kind === 'key' && ev.phase === 'press' && ev.ctrl && !ev.alt && !ev.shift && !ev.meta) {
      if (ev.key === 'c') {
        this.onInterrupt?.(this.sessionId);
        return;
      }
      if (ev.key === 'd' && this.stack.size === 0 && this.editor.model.isEmpty()) {
        this.onQuit?.();
        return;
      }
    }
    if (this.stack.routeEvent(ev)) return;
    if (this.popup.visible && this.popup.handleEvent(ev)) {
      this.touchFixed(); // 弹层高亮/隐层——固定区重建
      return;
    }
    if (this.editor.handleEvent(ev)) this.touchFixed();
  }

  /** 编辑器提交路由：input-ask 应答优先 → '/' 命令柄（false 兜底）→ onSubmit */
  private handleSubmit(text: string): void {
    const ask = this.inputAsk;
    if (ask !== null) {
      this.inputAsk = null;
      ask.resolve(text);
      this.popup.refresh(); // 应答期抑制的补全层此刻按空框重算自隐
      this.touchFixed();
      return;
    }
    if (text.startsWith('/') && this.dispatchCommand !== undefined) {
      this.dispatchCommand(text)
        .then((handled) => {
          if (!handled) this.onSubmit?.(this.sessionId, text); // 未命中兜底（03 §2.2 驱动侧语义）
        })
        .catch((err: unknown) => {
          // 命令处理器异常不静默不崩进程——呈现面兜底（命令面纪律归命令面）
          this.notify(`命令异常：${String(err)}`, { level: 'error' });
        });
      return;
    }
    this.onSubmit?.(this.sessionId, text);
  }

  /** 编辑器内容变更：补全层重取（应答期抑制）+ 固定区脏位 */
  private handleEditorChange(): void {
    if (this.inputAsk === null) this.popup.refresh();
    this.touchFixed();
  }

  /* ---------------- 内部：ask 浮层 ---------------- */

  /** 开 ask 浮层：锚定注册表锚 + signal abort 保守值收口 + 重绘请求 */
  private openAskLayer(content: OverlayContent, abort: () => void, signal: AbortSignal | undefined): OverlayHandle {
    const handle = this.stack.open(content, this.anchorFor(content));
    signal?.addEventListener(
      'abort',
      () => {
        handle.close();
        abort(); // 面板 done 锁下迟到 abort 是 no-op（已应答）
        this.touchFixed();
      },
      { once: true },
    );
    this.touchFixed();
    return handle;
  }

  /** 锚定闭包：读 renderFixed 行账（首帧前回退固定区顶整宽） */
  private anchorFor(content: OverlayContent): OverlayAnchor {
    return (frame) =>
      this.overlayLayout.get(content) ?? { row: 0, col: 0, width: frame.width, height: content.measure(frame.width) };
  }

  /* ---------------- 内部：渲染合并 ---------------- */

  /** present op 入队（连续 present 合并留末次——到达序相对 transient 保持） */
  private enqueuePresent(): void {
    const last = this.pendingOps[this.pendingOps.length - 1];
    if (last !== undefined && last.kind === 'present') this.pendingOps.pop();
    this.pendingOps.push({ kind: 'present', blocks: [...this.transcript.snapshot] });
  }

  /** 固定区脏位 + 渲染请求（touch 固定区的统一入口） */
  private touchFixed(): void {
    this.needFixed = true;
    this.requestRender();
  }

  /** 渲染请求（合并位）：同步直出立即 flush；注入调度则 fps 帽下排帧 */
  private requestRender(): void {
    if (!this.running) return;
    if (this.scheduleFn === null) {
      this.flush();
      return;
    }
    if (this.frameHandle === null) {
      const due = Math.max(0, this.lastFlushAt + this.minFrameMs - this.now());
      this.frameHandle = this.scheduleFn(() => {
        this.frameHandle = null;
        this.flush();
      }, due);
    }
  }

  /** 帧落地：op 队列按到达序执行 + 固定区脏位一帧一次重建 */
  private flush(): void {
    if (!this.running) return;
    this.lastFlushAt = this.now();
    const ops = this.pendingOps;
    this.pendingOps = [];
    for (const op of ops) {
      if (op.kind === 'present') this.screen.present(op.blocks);
      else this.screen.appendTransient(op.lines);
    }
    if (this.needFixed) {
      this.needFixed = false;
      this.renderFixed();
    }
  }

  /** 状态行转轮自驱定时器（注入调度后自重排；忙态外 tick 零开销） */
  private armTick(): void {
    this.tickHandle = this.scheduleFn!(() => {
      this.tickHandle = null;
      this.tick();
      this.armTick();
    }, TICK_INTERVAL_MS);
  }

  /** 定时器收口（frame/tick/escape 三名） */
  private cancelTimer(which: 'frame' | 'tick' | 'escape'): void {
    const handle = which === 'frame' ? this.frameHandle : which === 'tick' ? this.tickHandle : this.escapeHandle;
    if (handle !== null) this.cancelFn(handle);
    if (which === 'frame') this.frameHandle = null;
    else if (which === 'tick') this.tickHandle = null;
    else this.escapeHandle = null;
  }

  /* ---------------- 内部：状态面与固定区 ---------------- */

  /**
   * 聚焦事件的状态面消费：run 启停驱动忙态、工具执行锚点轮换工具名。
   * （执行层事件正文零渲染——07 §4.1 直播路渲染单源的刻意分立。）
   */
  private applyStatusEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.statusLine.start();
        this.touchFixed();
        break;
      case 'agent_end':
        this.statusLine.stop();
        this.touchFixed();
        break;
      case 'tool_execution_start':
        this.statusLine.setTool(event.name);
        this.touchFixed();
        break;
      case 'tool_execution_end':
        this.statusLine.setTool(null);
        this.touchFixed();
        break;
      default:
        break; // 消息族/turn 族不触状态面（StatusLine 自持忙态文案）
    }
  }

  /**
   * 固定区 v2 重建（自上而下段序）：overlay 段（各层量高叠放 + 锚定注册表
   * 行账）→〔件 4 todo / 件 5 工具进度——后续批接入位〕→ input-ask 提示行
   * → 补全弹层 → 编辑器（动态量高；聚焦态 = 无 overlay 占焦）→ 状态行。
   * 编辑光标经 EditorView setCursor 声明 → MainScreen.setFixed 声明位落 cup。
   */
  private renderFixed(): void {
    const columns = this.io.size().columns;
    const contents = this.stack.contents;
    const overlayHeights = contents.map((c) => c.measure(columns));
    const overlayHeight = overlayHeights.reduce((sum, h) => sum + h, 0);
    const askHeight = this.inputAsk !== null ? 1 : 0;
    const popupHeight = this.popup.visible ? this.popup.measure(columns) : 0;
    const editorHeight = this.editor.measure(columns);
    const total = overlayHeight + askHeight + popupHeight + editorHeight + 1;
    const grid = new CellGrid(columns, total);
    let row = 0;

    // 段一：overlay 段（栈序自上而下叠放；锚定注册表即本段行账）
    for (let i = 0; i < contents.length; i++) {
      const height = overlayHeights[i]!;
      this.overlayLayout.set(contents[i]!, { row, col: 0, width: columns, height });
      contents[i]!.render(grid, { row, col: 0, width: columns, height });
      row += height;
    }
    // （件 4 todo 面板 / 件 5 工具进度面板——呈现面批接入位，本批零行）

    // 段四：input-ask 提示行（应答期编辑器转应答车的引导位）
    if (this.inputAsk !== null) {
      grid.writeText(row, 0, `? ${this.inputAsk.message}`, { dim: true });
      row += 1;
    }

    // 段五：补全弹层（可见才占位——非模态浮层）
    if (this.popup.visible) {
      this.popup.render(grid, { row, col: 0, width: columns, height: popupHeight });
      row += popupHeight;
    }

    // 段六：编辑器（overlay 占焦期非聚焦——边框普通态 + 不抢光标声明）
    this.editor.setFocused(this.stack.size === 0);
    this.editor.render(grid, { row, col: 0, width: columns, height: editorHeight });
    row += editorHeight;

    // 段七：状态行（固定区末行）
    this.statusLine.render(grid, { row, col: 0, width: columns, height: 1 });
    this.screen.setFixed(grid);
  }

  /** 硬退复原钩子（仅真 ProcessTerminalIO——注入 io 零污染；Engine 同形） */
  private armExitRestore(): void {
    if (!(this.io instanceof ProcessTerminalIO)) return;
    this.disarmExitRestore?.();
    const restore = (): void => {
      try {
        this.io.write(LEAVE_MAIN);
        this.io.setRawMode(false);
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
}

/**
 * 摘要行 ANSI 序列化：行首段（档位符号 + 会话短 id）着会话区分色——
 * 非 accent 家族的第二着色位（07 §4.1 呈现面件 9），label 段裸文本。
 */
function summaryToAnsi(line: SummaryLine): string {
  const head = `${line.symbol} ${line.shortId}`;
  return buildSgr({ fg: sessionColor(line.shortId) }) + head + SGR_RESET + ` ${line.label}`;
}
