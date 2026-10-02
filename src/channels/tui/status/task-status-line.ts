/**
 * 任务状态行（界面美化役批 4——07 §4.1 呈现面新固定段，编辑器正上方）。
 *
 * 忙态在场、闲态离场（零高度缺席——measure 随态归零，闲态不占固定区预算）。
 * 四态编舞（驱动事件面 = backend applyFocusedEvent，本件零事件知识）：
 * - ① working 正在对话中：转轮 + 工具段 `⚙ 名 …` 优先（无工具显「正在对话中」）；
 * - ② streaming 获取响应中：message_start/message_update 流式窗口驱动；
 * - ③ retrying 重试中：转轮不停 + 「重试中 第 n/N 次 · Ns 后」整段 dim——
 *   倒计时消费端本地钟渲染（04 §2 绝对时刻律：事件只携 nextAt 绝对时刻）；
 * - ④ error 错误终态：红 ✖（agent_end(failed) 的终态揭示——retry_wait_end
 *   aborted/exhausted 翻档位；在下次 agent_start 前驻留）。
 *
 * 统一格式 `文案 · X tok/s (1m 02s • 按 ESC 取消对话)`：括号段恒 dim；耗时
 * 整 run 口径（runStartedAt 起、重试续入不清零——供数器注入）；速度段拼于
 * 括号段前（态①②，态③ 由倒计时文案顶替）；ESC 提示取键位册首键单源显示。
 * 供数器（elapsed/speed/interruptHint/now）全注入——本件零装配知识，测试
 * 确定性前提（件内零自驱时钟，与 StatusLine 同律）。
 */
import type { CellBuffer, CellStyle, Region, Renderable } from '../../engine/index.js';
import { ellipsize, stringWidth } from '../../engine/index.js';
import { formatElapsedCompact } from '../../../contracts/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';

/** 转轮帧序（braille 十帧——与状态行同源形态，件内自持单源） */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** 任务行四态 + 离场态（idle = 零高度缺席） */
export type TaskLineState = 'idle' | 'working' | 'streaming' | 'retrying' | 'error';

/** 供数器注入面（backend 装配位——本件零装配知识） */
export interface TaskStatusProviders {
  /** run 累计耗时毫秒（runStartedAt 起、重试续入不清零；null = 无起点诚实缺席） */
  readonly elapsedMs: () => number | null;
  /** 速度段文本（'' = 缺席缩位——亚秒/零 token 形） */
  readonly speedText: () => string;
  /** 中断键提示文案（如「按 ESC 取消对话」；'' = 缺席） */
  readonly interruptHint: () => string;
  /** 本地钟（倒计时与耗时段渲染基准——注入位测试确定性） */
  readonly now: () => number;
}

/** 任务状态行（量高随态：忙态/终态 1 行、闲态 0 行——零高度缺席律） */
export class TaskStatusLine implements Renderable {
  /** 状态变更通知（装配层接重绘请求） */
  onChange?: () => void;
  private state: TaskLineState = 'idle';
  /** 实时工具名（态① 优先段；null = 无工具） */
  private toolName: string | null = null;
  /** 重试窗参数（态③——nextAt 绝对时刻，倒计时渲染期现算） */
  private retryAttempt = 0;
  private retryMaxAttempts = 0;
  private retryNextAt = 0;
  private frameIndex = 0;
  /** 态④ 失败原因（失败直呈律 V-0 注②——同句携因；null = 无因裸形） */
  private errorReason: string | null = null;
  /** 转轮样式（accent 派生——主题单源，setTheme 重建） */
  private spinnerStyle: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.accent });
  /** 错误终态样式（error 语义键） */
  private errorStyle: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.error });
  /** dim 样式（态③ 文案与括号段） */
  private readonly dimStyle: Readonly<CellStyle> = Object.freeze({ dim: true });
  private readonly providers: TaskStatusProviders;

  constructor(providers: TaskStatusProviders) {
    this.providers = providers;
  }

  /** 主题换装（backend injectTheme 单源路——accent/error 派生样式重建） */
  setTheme(theme: ResolvedTheme): void {
    this.spinnerStyle = Object.freeze({ fg: theme.accent });
    this.errorStyle = Object.freeze({ fg: theme.error });
  }

  /** 量高：闲态零高度缺席、其余恒 1 行 */
  measure(_width: number): number {
    return this.state === 'idle' ? 0 : 1;
  }

  /** 当前态观测面（backend 路由层与断言消费） */
  get taskState(): TaskLineState {
    return this.state;
  }

  /** 忙态观测（转轮驱动闸——终态 error 与离场 idle 不推帧） */
  get isBusy(): boolean {
    return this.state === 'working' || this.state === 'streaming' || this.state === 'retrying';
  }

  /** 当前转轮帧观测面（测试断言帧推进用） */
  get frame(): string {
    return SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length]!;
  }

  /** 态① 正在对话中（agent_start / retry_wait_end(resumed) 驱动；工具段让位律同状态行） */
  enterWorking(): void {
    this.state = 'working';
    this.toolName = null;
    this.onChange?.();
  }

  /** 态② 获取响应中（assistant 流式窗口 message_start 驱动——message_end 归态①） */
  enterStreaming(): void {
    this.state = 'streaming';
    this.onChange?.();
  }

  /** 态③ 重试中（retry_wait_start 驱动——attempt 将续入序号 / nextAt 绝对时刻） */
  enterRetry(attempt: number, maxAttempts: number, nextAt: number): void {
    this.state = 'retrying';
    this.retryAttempt = attempt;
    this.retryMaxAttempts = maxAttempts;
    this.retryNextAt = nextAt;
    this.onChange?.();
  }

  /** 态④ 错误终态（retry_wait_end aborted/exhausted 揭示——红 ✖ 驻留至下个 agent_start；
   * reason = 失败直呈律（07 §4.1 V-0 注②）同句原因——agent_end failed 的
   * errorMessage 经持有档揭示位供入，缺席兜底裸形） */
  enterError(reason?: string): void {
    this.state = 'error';
    this.toolName = null;
    this.errorReason = reason !== undefined && reason !== '' ? reason : null;
    this.onChange?.();
  }

  /** 离场（agent_end completed/aborted——零高度缺席） */
  goIdle(): void {
    this.state = 'idle';
    this.toolName = null;
    this.onChange?.();
  }

  /** 实时工具名（tool_execution_start → name；null 清——态① 优先段） */
  setTool(name: string | null): void {
    this.toolName = name;
    this.onChange?.();
  }

  /** 推帧（装配层定时驱动——仅忙态有意义；闲态/终态零变化零通知） */
  tick(): void {
    if (!this.isBusy) return;
    this.frameIndex++;
    this.onChange?.();
  }

  /** 落位（左起：转轮/✖ + 文案段 + dim 括号段；文案段超宽让位截断加省略号） */
  render(buffer: CellBuffer, region: Region): void {
    if (this.state === 'idle' || region.width <= 0) return;
    if (this.state === 'error') {
      // 态④：红 ✖ 终态——无转轮无括号（用量与速度归 footer 尾注）；失败直呈律
      // （V-0 注②）同句携因 `✖ 失败 · 原因`（缺席裸形兜底）；原因行宽帽 = 段帽
      // （ellipsize 一句话帽——不溢行产漂账物理行）
      const text = this.errorReason === null ? '✖ 失败' : `✖ 失败 · ${this.errorReason}`;
      buffer.writeText(region.row, region.col, ellipsize(text, region.width), this.errorStyle);
      return;
    }
    const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length]!;
    const text = this.statusText();
    const paren = this.parenText();
    // 宽度分配：转轮 1 列 + 间隔 1 列 + 文案段弹性（超宽截断加省略号）+ 括号
    // 段保尾；括号装不下（极窄屏）整段退场——文案段独享剩余宽（不截半括号）
    const parenWidth = paren !== '' ? stringWidth(paren) : 0;
    const useParen = parenWidth > 0 && parenWidth + 2 <= region.width;
    const textBudget = Math.max(0, region.width - 2 - (useParen ? parenWidth : 0));
    const fitted = ellipsize(text, textBudget);
    buffer.writeText(region.row, region.col, frame, this.spinnerStyle);
    if (fitted !== '') {
      // 态③ 整段 dim（转轮不停——仅文案降存在感，不闪「✖ 失败」）
      buffer.writeText(region.row, region.col + 2, fitted, this.state === 'retrying' ? this.dimStyle : undefined);
    }
    if (useParen) buffer.writeText(region.row, region.col + 2 + stringWidth(fitted), paren, this.dimStyle);
  }

  /** 文案段（态① 工具段优先/② 流式/③ 重试倒计时；速度段尾拼 ` · `——态①②） */
  private statusText(): string {
    if (this.state === 'retrying') {
      // 倒计时本地钟现算（绝对时刻律）：窗尽 clamp 0s（resumed 事件随后续到达）
      const secondsLeft = Math.max(0, Math.ceil((this.retryNextAt - this.providers.now()) / 1000));
      return `重试中 第 ${this.retryAttempt}/${this.retryMaxAttempts} 次 · ${secondsLeft}s 后`;
    }
    const base =
      this.state === 'streaming' ? '获取响应中' : this.toolName !== null ? `⚙ ${this.toolName} …` : '正在对话中';
    const speed = this.providers.speedText();
    return speed === '' ? base : `${base} · ${speed}`;
  }

  /** 括号段（dim——` (1m 02s • 按 ESC 取消对话)`；两段各自缩位，双缺席无括号） */
  private parenText(): string {
    const elapsedMs = this.providers.elapsedMs();
    const elapsed = elapsedMs === null ? '' : formatElapsedCompact(elapsedMs);
    const hint = this.providers.interruptHint();
    const inner = [elapsed, hint].filter((segment) => segment !== '').join(' • ');
    return inner === '' ? '' : ` (${inner})`;
  }
}
