/**
 * TUI 后端（UiBackend 的终端实装——07 §4.3 通道后端面的 tui 腿，批 10e-1 呈现纵切）。
 *
 * 职责三段：
 * - **直播呈现**：onEnvelope → LiveTranscript 渲染归约（聚焦全渲染 /
 *   非聚焦摘要行瞬时直写）+ MainScreen 增量编舞；
 * - **状态面**：StatusLine 消费 run 生命周期与工具执行事件（agent_start/end
 *   启停、tool_execution_start/end 工具名轮换——执行层锚点正文零渲染、
 *   状态面消费是唯一去向）；
 * - **固定区**：状态行 + 输入占位行两行 v1 静态形（EditorView 接入归
 *   10e-2——届时随内容折行经 setFixed 动态更新）。
 *
 * 批 10e-1 边界：confirm/select/input 阻塞原语未实装（capabilities 报
 * false——核降级链 notify 化收场；overlay 族呈现归 10e-2）；setWidget
 * 不支撑（报 false）；tick 公开面供装配定时驱动接线。
 */
import type { AgentEvent } from '../../../agent/index.js';
import type { AgentMessage } from '../../../contracts/index.js';
import type { NotifyLevel, SessionEnvelope, UiBackend } from '../../types.js';
import { CellGrid, type TerminalIO } from '../../engine/index.js';
import { MainScreen } from './main-screen.js';
import { LiveTranscript, type SummaryLine } from './transcript.js';
import { StatusLine } from '../status/status-line.js';
import { sessionColor } from '../theme.js';
import { buildSgr, SGR_RESET } from './ansi-rows.js';

/** 后端构造选项 */
export interface TuiBackendOptions {
  /** 固定区高（行——v1 缺省两行：状态行 + 输入占位行） */
  readonly fixedHeight?: number;
}

/** 固定区缺省高 */
const DEFAULT_FIXED_HEIGHT = 2;

/** notify 档位符号（正文着色纪律——纯符号不配色，与摘要行会话色分立） */
const NOTIFY_SYMBOLS: Readonly<Record<NotifyLevel, string>> = Object.freeze({
  info: '·',
  success: '✓',
  warn: '⚠',
  error: '✖',
});

/**
 * TUI 后端：单终端 inline 主屏。构造后须 start()（清屏 + 滚动区确立）
 * 再接核事件——呈现编舞前置在位。
 */
export class TuiBackend implements UiBackend<AgentMessage> {
  readonly id = 'tui';
  readonly capabilities = Object.freeze({
    notify: true,
    confirm: false, // overlay 族呈现归批 10e-2
    select: false,
    input: false,
    approval: false, // 审批面板呈现归批 10e-2 交互纵切
    setStatus: true,
    setWidget: false,
  });

  private readonly io: TerminalIO;
  private readonly screen: MainScreen;
  private readonly transcript = new LiveTranscript();
  private readonly statusLine = new StatusLine();
  /** 固定区高（v1 静态——EditorView 折行动态形归 10e-2） */
  private readonly fixedHeight: number;
  private columns: number;

  constructor(io: TerminalIO, options: TuiBackendOptions = {}) {
    this.io = io;
    this.columns = io.size().columns;
    this.fixedHeight = options.fixedHeight ?? DEFAULT_FIXED_HEIGHT;
    this.screen = new MainScreen(io, { fixedHeight: this.fixedHeight });
  }

  /** TUI 恒有观众（07 §4.3 观众探针定值） */
  hasAudience(): boolean {
    return true;
  }

  /** 启动：清屏 + 滚动区确立 + 固定区首画 + resize 自订阅 */
  start(): void {
    this.screen.start();
    this.renderFixed();
    this.io.onResize(() => this.handleResize());
  }

  /** 一次性通知：正文瞬时行直写（级别符号前缀——不进行集） */
  notify(message: string, opts?: { level?: NotifyLevel }): void {
    const symbol = NOTIFY_SYMBOLS[opts?.level ?? 'info'];
    this.screen.appendTransient([`${symbol} ${message}`]);
  }

  /** 状态行文案（last-writer-wins——StatusLine 件语义） */
  setStatus(_sessionId: string, status: string): void {
    this.statusLine.setStatus(status);
    this.renderFixed();
  }

  /** 活体信封呈现：渲染归约 + 摘要行分叉 + 聚焦态状态面消费 */
  onEnvelope(env: SessionEnvelope, focused: boolean): void {
    const summary = this.transcript.applyEvent(env, focused);
    if (summary !== null) {
      this.screen.appendTransient([summaryToAnsi(summary)]);
    } else {
      this.screen.present(this.transcript.snapshot);
    }
    if (focused) this.applyStatusEvent(env.event);
  }

  /** 重画呈现：投影重建行集 + 清屏全量重写（widget 槽值不支撑——忽略） */
  onRepaint(_sessionId: string, projection: readonly AgentMessage[], _widget: { node: unknown } | null): void {
    this.transcript.loadProjection(projection);
    this.screen.repaint(this.transcript.snapshot);
  }

  /** 状态行动画推帧（装配定时驱动接线面——忙态外零开销） */
  tick(): void {
    if (!this.statusLine.isBusy) return;
    this.statusLine.tick();
    this.renderFixed();
  }

  /** resize 编舞：几何重取 + 主屏全量重画 + 固定区按新几何重建 */
  handleResize(): void {
    this.columns = this.io.size().columns;
    this.screen.handleResize(this.transcript.snapshot);
    this.renderFixed();
  }

  /* ---------------- 内部 ---------------- */

  /**
   * 聚焦事件的状态面消费：run 启停驱动忙态、工具执行锚点轮换工具名。
   * （执行层事件正文零渲染——07 §4.1 直播路渲染单源的刻意分立。）
   */
  private applyStatusEvent(event: AgentEvent): void {
    switch (event.type) {
      case 'agent_start':
        this.statusLine.start();
        this.renderFixed();
        break;
      case 'agent_end':
        this.statusLine.stop();
        this.renderFixed();
        break;
      case 'tool_execution_start':
        this.statusLine.setTool(event.name);
        this.renderFixed();
        break;
      case 'tool_execution_end':
        this.statusLine.setTool(null);
        this.renderFixed();
        break;
      default:
        break; // 消息族/turn 族不触状态面（StatusLine 自持忙态文案）
    }
  }

  /** 固定区重建（状态行 + 输入占位行——v1 静态两行；行级差分由 MainScreen 执） */
  private renderFixed(): void {
    const grid = new CellGrid(this.columns, this.fixedHeight);
    this.statusLine.render(grid, { row: 0, col: 0, width: this.columns, height: 1 });
    // 输入占位行：dim 提示符（EditorView 接入归 10e-2——本行届时整行替换）
    grid.writeText(1, 0, '› ', { dim: true });
    this.screen.setFixed(grid);
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
