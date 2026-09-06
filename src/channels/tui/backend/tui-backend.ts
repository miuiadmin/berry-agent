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
 *   renderFixed 行账——开层锚定闭包读注册表）→ todo 面板（件 4）→
 *   input-ask 提示行 → 补全弹层 → 编辑器（动态量高 + 光标声明——setFixed
 *   声明位落 cup）→ 工具进度面板（件 5——与状态行分职互补相邻）→ 状态行；
 * - **渲染合并**：调度注入后 op 队列合并（连续 present 留末次、transient
 *   到达序保持、固定区脏位重建一帧一次）+ fps 帽 60 + tick 100ms 自重排
 *   驱动状态行转轮；**无注入调度 = 同步直出**（测试语义——合并与自驱 tick
 *   关闭，10e-1 同步断言原样成立；生产装配须注入宿主调度）；
 * - **件 7 终端外显**（本纵切）：OscDisplay 自持件——起屏基线 title、
 *   onEnvelope 按会话净计数忙态（OSC 9;4 + 1s 保活）、onRepaint title 点缀
 *   会话短 id、stop/硬退复原两写点；
 * - **阻塞原语撤销面**（批 10f-3）：ask 四路 signal abort 收口时曾在屏者
 *   正文流落 ⏹ 撤销说明行（07 §4.3 语义纪律「曾在屏者由通道上撤销说明行」
 *   ——保守值收口之外的可感知收场；迟到 abort 不误写）。
 *
 * 批内边界：setWidget 不支撑（报 false）；主屏滚动帽实测定值挂装配批 12
 * 实机；件 8 副屏（AltScreenHost 与本件共享 io）不在本纵切。
 */
import type { AgentEvent } from '../../../agent/index.js';
import { isStandardMessage, type AgentMessage, type Usage } from '../../../contracts/index.js';
import type {
  ApprovalAskAnswer,
  ApprovalAskRequest,
  NotifyLevel,
  SessionEnvelope,
  TodoItem,
  UiAskOptions,
  UiBackend,
  UiInputOptions,
  UiSelectChoice,
} from '../../types.js';
import { CellGrid, InputDecoder, ProcessTerminalIO, type TerminalIO } from '../../engine/index.js';
import { MainScreen } from './main-screen.js';
import { LiveTranscript, shortIdOf, type SummaryLine, type TranscriptBlock } from './transcript.js';
import { OscDisplay } from './osc.js';
import { StatusLine } from '../status/status-line.js';
import { TodoPanel } from '../panels/todo-panel.js';
import { ToolProgressPanel } from '../panels/tool-progress-panel.js';
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
  /** todo 面板数据源（件 4——装配接 deps 同名面；注入缺席 = 面板缺席零变化） */
  readonly todoFor?: (sessionId: string) => readonly TodoItem[] | null | undefined;
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
  /** 宿主版本（件 7——title 基线 `berry-agent <版本>`；缺席或空串 = 无版本缀裸名。真值归批 12 host 装配传 HostFace.version） */
  readonly version?: string;
}

/** 主屏形进屏模式串：粘贴开 + kitty 推栈（disambiguate 最小位）+ 探测哨兵（无光标藏无 1049——与 Engine 全屏形分立） */
const ENTER_MAIN = '\x1b[?2004h' + '\x1b[>1u' + '\x1b[?u' + '\x1b[c';
/** 出屏模式串（与进屏严格对称反序——单源常量） */
const LEAVE_MAIN = '\x1b[<u' + '\x1b[?2004l';

/** 渲染合并帧率帽缺省（对齐 Engine DEFAULT_FPS_CAP——批 10f-3 性能回归锁校准定值 60，实机校准后收紧留批 12） */
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
 * run 级用量累计（件 6——agent_start/repaint 归零、turn_end 累加、agent_end
 * 落行；观测面供装配/宿主侧二次消费，`/usage` 全量面板分职不互替）。
 */
export interface UsageAccumulation {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly totalTokens: number;
  /** 累计货币额（cost 在场才累——spec 条款） */
  readonly cost: number;
  /** 币种（首见 cost.currency 定着） */
  readonly currency: string | null;
}

/** 零账（归零基线） */
const ZERO_USAGE: UsageAccumulation = Object.freeze({
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: 0,
  currency: null,
});

/** token 数千位分组（1,234,567——usage 行「格式化」定形） */
function formatTokenCount(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
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

  /* ---- 呈现面件 4/5/6 态 ---- */
  private readonly todoFor: ((sessionId: string) => readonly TodoItem[] | null | undefined) | undefined;
  private readonly todoPanel = new TodoPanel();
  private readonly toolPanel = new ToolProgressPanel();
  /** 当前 turn 的 assistant 消息用量暂存（turn_end 累加——件 6 等价性条款） */
  private pendingUsage: Usage | null = null;
  private usageTotal: UsageAccumulation = ZERO_USAGE;

  /* ---- 呈现面件 7 态（终端外显） ---- */
  /** title 基线（`berry-agent` 或 `berry-agent <版本>`——起屏与复原落点） */
  private readonly titleBaseline: string;
  private readonly osc: OscDisplay;
  /**
   * 各会话在飞净计数（agent_start +1 / agent_end -1——按信封 sessionId 归
   * 账，clamp ≥ 0；归零删条目防会话退出残键）。聚焦位不参账：run 跨切焦时
   * start/end 恒落同一会话账——按事件时刻聚焦位分两路会跨路不对称（末路
   * end 被 clamp 吞致忙态永残留，07 件 7 判据勘正）。
   */
  private readonly inFlightBySession = new Map<string, number>();
  /** 进度态上次写出（忙闲迁移门——同态静默，周期重发归保活自持） */
  private progressBusy = false;

  constructor(io: TerminalIO, options: TuiBackendOptions = {}) {
    this.io = io;
    this.sessionId = options.sessionId ?? 'main';
    this.onSubmit = options.onSubmit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.dispatchCommand = options.dispatchCommand;
    this.todoFor = options.todoFor;
    this.scheduleFn = options.schedule ?? null;
    this.cancelFn = options.cancelSchedule ?? ((h) => clearTimeout(h as NodeJS.Timeout));
    this.now = options.now ?? Date.now;
    this.minFrameMs = 1000 / (options.fpsCap ?? DEFAULT_FPS_CAP);
    this.escapeWindowMs = options.escapeWindowMs ?? DEFAULT_ESCAPE_WINDOW_MS;
    // 件 7：title 基线（version 注入缺席 = 裸名）；外显件复用本件调度注入
    // （schedule 缺席 = 保活缺位——同步测试语义，与渲染合并同构）
    this.titleBaseline = options.version ? `berry-agent ${options.version}` : 'berry-agent'; // 空串同缺席归裸名（无尾随空格脏基线）
    this.osc = new OscDisplay(io, {
      baseline: this.titleBaseline,
      schedule: this.scheduleFn ?? undefined,
      cancel: this.cancelFn,
    });
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
    this.osc.setTitle(this.titleBaseline); // 件 7：起屏基线 title（OSC 0——值缓存首写）
    this.io.setRawMode(true);
    this.unsubInput = this.io.onInput(this.handleInput);
    // 显式放流（共享 io 换防接缝——副屏 Engine 复用同 io 场景；首启 no-op）
    this.io.resume();
    this.screen.start();
    this.renderFixed();
    this.unsubResize = this.io.onResize(() => this.handleResize());
    if (this.scheduleFn !== null) this.armTick();
  }

  /** 对称出屏：模式串反序 + 输入卸订 + 定时器全收 + 外显复原 + raw 复原（终退不可复用） */
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
    this.osc.restore(); // 件 7：复原两写点（title 基线 + 进度清零）+ 保活停针（名册语义）
    this.disarmExitRestore?.();
    this.io.pause();
    this.io.setRawMode(this.priorRaw);
  }

  /** 一次性通知：正文瞬时行直写（级别符号前缀——不进行集） */
  notify(message: string, opts?: { level?: NotifyLevel }): void {
    const symbol = NOTIFY_SYMBOLS[opts?.level ?? 'info'];
    this.appendTransientLine(`${symbol} ${message}`);
  }

  /**
   * 瞬时说明行入正文流（notify 与 ask 撤销说明行共用路——07 §4.3「曾在屏
   * 者由通道上撤销说明行」）：op 入合并队列 + 渲染请求（同步直出模式立即
   * 落地；注入调度随帧合并——transient 到达序保持）。
   */
  private appendTransientLine(line: string): void {
    this.pendingOps.push({ kind: 'transient', lines: [line] });
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
    this.trackProgress(env); // 件 7：按会话净计数（终端级注意力——任一会话在飞即忙）
    if (focused) this.applyFocusedEvent(env.event);
  }

  /** 重画呈现：投影重建行集 + 清屏全量重写（widget 槽值不支撑——忽略） */
  onRepaint(sessionId: string, projection: readonly AgentMessage[], _widget: { node: unknown } | null): void {
    // 权威全量重建——排队旧帧作废（repaint 是新真相，合并无意义）
    this.pendingOps = [];
    this.needFixed = false;
    this.transcript.loadProjection(projection);
    this.resetUsage(); // 件 6：清行并归零（切焦清账重计——尾注射界）
    this.toolPanel.clear(); // 件 5：瞬时面不跨 repaint 保存
    this.refreshTodo(); // 件 4：刷新三时点之一
    this.osc.setTitle(`${this.titleBaseline} · ${shortIdOf(sessionId)}`); // 件 7：title 点缀会话短 id
    this.screen.repaint(this.transcript.snapshot);
    this.renderFixed();
  }

  /** 状态行动画推帧（自驱定时器内调；公开面留装配侧手动驱动——忙态外零开销） */
  tick(): void {
    if (!this.statusLine.isBusy) return;
    this.statusLine.tick();
    this.touchFixed();
  }

  /** run 级用量累计观测面（件 6——装配/宿主侧二次消费） */
  get usageView(): UsageAccumulation {
    return { ...this.usageTotal };
  }

  /** resize 编舞：几何重取 + 主屏全量重画 + 固定区按新几何重建（权威重建不走队列） */
  handleResize(): void {
    this.pendingOps = [];
    this.needFixed = false;
    this.screen.handleResize(this.transcript.snapshot);
    this.renderFixed();
  }

  /* ---------------- 阻塞四件（浮层面板呈现——07 §4.3） ---------------- */

  /** 是/否确认：ConfirmPanel 浮层（Enter → true / Esc → false；signal abort 保守值 + 关层 + 撤销说明行） */
  confirm(message: string, opts?: UiAskOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const panel = new ConfirmPanel({ message });
      const handle = this.openAskLayer(panel, () => resolve(false), opts?.signal, '⏹ 已取消确认');
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
      const handle = this.openAskLayer(panel, () => resolve(''), opts?.signal, '⏹ 已取消选择');
      panel.onFinish = (value) => {
        handle.close();
        resolve(value);
      };
    });
  }

  /**
   * 自由文本：input-ask 形——提示行入固定区 + 编辑器转应答车（提交即应答，
   * 弹层抑制）；signal abort → '' 保守值 + 残稿清框 + 撤销说明行（07 §4.3
   * 撤销面——提示行曾在固定区在屏，abort 收口正文流落 ⏹ 行）。
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
          if (this.inputAsk !== ask) return; // 已应答收场——迟到 abort no-op（无说明行）
          this.inputAsk = null;
          this.appendTransientLine('⏹ 已取消提问');
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
   * 归通道核 settleApprovalAlways——本件只呈现与回值）。signal abort 收口
   * 'cancel' 保守值 + 撤销说明行（文案「审批」区分于 input/confirm/select
   * 三件——07 §4.3 撤销面）。
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
      const handle = this.openAskLayer(panel, () => resolve('cancel'), opts?.signal, '⏹ 已取消审批');
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

  /**
   * 开 ask 浮层：锚定注册表锚 + signal abort 保守值收口 + 撤销说明行 + 重绘
   * 请求。
   *
   * 「曾在屏者」判据（07 §4.3 语义纪律撤销面——confirm / select / askApproval
   * 三路共用本层，统一处理）：abort 传播到后端呈现时层仍未关（在 overlay 栈
   * 中）= 曾在屏 → 撤销说明行入正文流；面板已 done（onFinish 先关层）后迟
   * 到的 abort 是 no-op，不误写。说明行只标撤销收场本身——保守值收口（与提
   * 问队列收口三则「保守值同撤销面」同源条款：审批项收 'cancel'、阻塞件各
   * 收保守值）由 promise 回值承载，行文不重复。
   */
  private openAskLayer(
    content: OverlayContent,
    abort: () => void,
    signal: AbortSignal | undefined,
    cancelLine: string,
  ): OverlayHandle {
    const handle = this.stack.open(content, this.anchorFor(content));
    signal?.addEventListener(
      'abort',
      () => {
        if (!handle.closed) this.appendTransientLine(cancelLine); // 曾在屏才写——面板 done 后迟到 abort 不误写
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
   * 聚焦事件的固定区消费面：run 启停驱动忙态与 usage 累计（件 6）、工具
   * 执行驱动状态行工具名与进度面板（件 3/5）、tool_execution_end/agent_end
   * 驱动 todo 刷新（件 4）。（执行层事件正文零渲染——07 §4.1 直播路渲染
   * 单源的刻意分立。）
   */
  private applyFocusedEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.statusLine.start();
        this.resetUsage(); // 件 6：归零清行（上一 run 尾注不跨 run）
        this.toolPanel.clear(); // 件 5：瞬时面清板
        this.touchFixed();
        break;
      case 'agent_end':
        this.statusLine.stop();
        // 件 6：落行（与 setStatus 同载体 last-writer-wins）
        this.statusLine.setStatus(`✓ 用量 ${formatTokenCount(this.usageTotal.totalTokens)}`);
        this.toolPanel.clear();
        this.refreshTodo(); // 件 4：刷新三时点之三
        this.touchFixed();
        break;
      case 'tool_execution_start':
        this.statusLine.setTool(event.name);
        this.toolPanel.begin(event.toolCallId, event.name); // 件 5：建档不建行
        this.touchFixed();
        break;
      case 'tool_execution_end':
        this.statusLine.setTool(null);
        this.toolPanel.end(event.toolCallId); // 件 5：end 即摘行
        this.refreshTodo(); // 件 4：刷新三时点之二（写后即显）
        this.touchFixed();
        break;
      case 'tool_execution_update':
        this.toolPanel.applyUpdate(event.toolCallId, event.update); // 件 5：首 update 建行
        this.touchFixed();
        break;
      case 'message_end':
        // 件 6 数据源：assistant 消息终值暂存（累加时点 turn_end——一 turn 恰
        // 一 assistant 消息，两时点等价；spec 条款按本仓轻载荷形取 message_end 面）
        if (isStandardMessage(event.message) && event.message.role === 'assistant') {
          this.pendingUsage = event.message.usage;
        }
        break; // 正文换装已走直播路——固定区零扰动
      case 'turn_end':
        this.accumulateUsage(); // 件 6：累加时点（非呈现时点）
        break;
      default:
        break; // 消息族其余/turn 族其余不触固定区
    }
  }

  /** usage 归零清行（agent_start / repaint——件 6 清账重计条款） */
  private resetUsage(): void {
    this.pendingUsage = null;
    this.usageTotal = ZERO_USAGE;
    this.statusLine.setStatus('');
  }

  /** turn_end 累加（暂存的 assistant 用量并入 run 级账本；cost 在场累货币额） */
  private accumulateUsage(): void {
    const pending = this.pendingUsage;
    if (pending === null) return;
    this.pendingUsage = null;
    const prev = this.usageTotal;
    this.usageTotal = {
      input: prev.input + pending.input,
      output: prev.output + pending.output,
      cacheRead: prev.cacheRead + pending.cacheRead,
      cacheWrite: prev.cacheWrite + pending.cacheWrite,
      totalTokens: prev.totalTokens + pending.totalTokens,
      cost: prev.cost + (pending.cost?.total ?? 0),
      currency: prev.currency ?? pending.cost?.currency ?? null,
    };
  }

  /** todo 面板刷新（todoFor 注入缺席 = 面板缺席零变化——件 4 条款） */
  private refreshTodo(): void {
    if (this.todoFor === undefined) return;
    this.todoPanel.update(this.todoFor(this.sessionId));
  }

  /**
   * 件 7 进度态按会话净计数（任一会话在飞即忙——终端标签页注意力模型）：
   * agent_start +1 / agent_end -1，均按信封 sessionId 归账、clamp ≥ 0（进程
   * 内事件无错过窗——clamp 只防重复 end 不穿底；归零删条目）。聚焦位不参
   * 账（07 件 7 判据勘正——事件时刻聚焦位分两路在切焦场景与主句背离）。
   * 忙闲迁移才写 progress 序列（同态静默——周期重发归 osc 保活自持）。
   * stop 后静默短路（终退不再写字节）。
   */
  private trackProgress(env: SessionEnvelope): void {
    if (!this.running) return; // 停后残事件防御——与 requestRender 同闸
    const { event } = env;
    if (event.type === 'agent_start') {
      this.inFlightBySession.set(env.sessionId, (this.inFlightBySession.get(env.sessionId) ?? 0) + 1);
    } else if (event.type === 'agent_end') {
      // clamp ≥ 0：净计数不越零（重复 end 不累积负账）；归零删条目
      const next = Math.max(0, (this.inFlightBySession.get(env.sessionId) ?? 0) - 1);
      if (next > 0) this.inFlightBySession.set(env.sessionId, next);
      else this.inFlightBySession.delete(env.sessionId);
    } else {
      return; // run 启停族之外零扰动
    }
    let busy = false;
    for (const count of this.inFlightBySession.values()) {
      if (count > 0) {
        busy = true;
        break;
      }
    }
    if (busy !== this.progressBusy) {
      this.progressBusy = busy;
      this.osc.setProgress(busy);
    }
  }

  /**
   * 固定区 v2 重建（自上而下段序）：overlay 段（各层量高叠放 + 锚定注册表
   * 行账）→ todo 面板（件 4——todoFor 缺席/空表即零行）→ input-ask 提示行
   * → 补全弹层 → 编辑器（动态量高；聚焦态 = 无 overlay 占焦）→ 工具进度
   * 面板（件 5——与状态行分职互补相邻）→ 状态行。编辑光标经 EditorView
   * setCursor 声明 → MainScreen.setFixed 声明位落 cup。
   */
  private renderFixed(): void {
    const columns = this.io.size().columns;
    const contents = this.stack.contents;
    const overlayHeights = contents.map((c) => c.measure(columns));
    const overlayHeight = overlayHeights.reduce((sum, h) => sum + h, 0);
    const todoHeight = this.todoPanel.measure(columns);
    const askHeight = this.inputAsk !== null ? 1 : 0;
    const popupHeight = this.popup.visible ? this.popup.measure(columns) : 0;
    const editorHeight = this.editor.measure(columns);
    const toolHeight = this.toolPanel.measure(columns);
    const total = overlayHeight + todoHeight + askHeight + popupHeight + editorHeight + toolHeight + 1;
    const grid = new CellGrid(columns, total);
    let row = 0;

    // 段一：overlay 段（栈序自上而下叠放；锚定注册表即本段行账）
    for (let i = 0; i < contents.length; i++) {
      const height = overlayHeights[i]!;
      this.overlayLayout.set(contents[i]!, { row, col: 0, width: columns, height });
      contents[i]!.render(grid, { row, col: 0, width: columns, height });
      row += height;
    }

    // 段二：todo 面板（件 4——输入框上方紧凑面板；清板即零行）
    if (todoHeight > 0) {
      this.todoPanel.render(grid, { row, col: 0, width: columns, height: todoHeight });
      row += todoHeight;
    }

    // 段三：input-ask 提示行（应答期编辑器转应答车的引导位）
    if (this.inputAsk !== null) {
      grid.writeText(row, 0, `? ${this.inputAsk.message}`, { dim: true });
      row += 1;
    }

    // 段四：补全弹层（可见才占位——非模态浮层）
    if (this.popup.visible) {
      this.popup.render(grid, { row, col: 0, width: columns, height: popupHeight });
      row += popupHeight;
    }

    // 段五：编辑器（overlay 占焦期非聚焦——边框普通态 + 不抢光标声明）
    this.editor.setFocused(this.stack.size === 0);
    this.editor.render(grid, { row, col: 0, width: columns, height: editorHeight });
    row += editorHeight;

    // 段六：工具进度面板（件 5——正在流 partial 的工具各占一行；清板即零行）
    if (toolHeight > 0) {
      this.toolPanel.render(grid, { row, col: 0, width: columns, height: toolHeight });
      row += toolHeight;
    }

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
        this.osc.restore(); // 件 7：硬退复原两写点（title 基线 + 进度清零——与 stop 同收口）
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
