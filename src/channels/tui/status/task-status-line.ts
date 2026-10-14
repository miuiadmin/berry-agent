/**
 * 任务状态行（界面美化役批 4——07 §4.1 呈现面新固定段，编辑器正上方；
 * V-4 底栏重做批笔 2 件 12 翻档——注⑪⑦）。
 *
 * 忙态在场、闲态离场（零高度缺席——measure 随态归零，闲态不占固定区预算）。
 * 四态编舞（驱动事件面 = backend applyFocusedEvent，本件零事件知识）：
 * - ① working 正在对话中：转轮 + 工具段 `⚙ 名 …` 优先（无工具显「正在对话中」）；
 * - ② 细分双态（注⑪⑦——streaming 拆分，message_update 尾块分诊零新事件型）：
 *   thinking 思考中（message_start 起跑缺省 + thinking 尾块维持；活头在场替位
 *   ——末思考块首个粗体段、缺席兜底现词面，挖掘 31 轮 [2]）/
 *   generating 生成中（text 尾块词面迁移一次）；message_end 归态①；
 * - ③ retrying 重试中：转轮不停 + 「重试中 第 n/N 次 · Ns 后」整段 dim——
 *   倒计时消费端本地钟渲染（04 §2 绝对时刻律：事件只携 nextAt 绝对时刻）；
 * - ④ error 错误终态：红 ✗（agent_end(failed) 的终态揭示——retry_wait_end
 *   aborted/exhausted 翻档位；在下次 agent_start 前驻留）。
 *
 * 统一格式 `文案 · 本轮 N (1m 02s · 按 ESC 取消对话)`：括号段恒 dim（注⑩
 * ——括号段内串接符 ·）；耗时
 * 整 run 口径（runStartedAt 起、重试续入不清零——供数器注入）；**本轮段**
 * 拼于括号段前（态①②——流中估值器 ⑥c 供数、message_end 真值收口；态③④
 * 无段）；**速度段退役**（注⑪⑦——taskLine 尾拼与 agent_end 尾注速段双撤，
 * 速度面归行1 笔3 speedView 消费）；ESC 提示取键位册首键单源显示。
 * 忙态文案段扫光（挖掘 35 轮 B0+B3——codex shimmer 同形）：2s 周期余弦
 * 扫光带逐字素着色，相位 = 注入钟渲染期现算（绝对时刻律同源——件内零自
 * 驱时钟维持）；真彩档基色向探测 bg 混 t×0.9 恒 bold、非真彩三档阶梯
 * （dim/无样式/bold）；受动效门辖（禁用形纯文本——B2 门）。
 * 供数器（elapsed/turnTokens/interruptHint/now）全注入——本件零装配知识，测试
 * 确定性前提（件内零自驱时钟，与 StatusLine 同律）。
 */
import type { CellBuffer, CellStyle, Region, Renderable, RgbChannels } from '../../engine/index.js';
import { DIM_STYLE, colorRgbOf, ellipsize, graphemeWidth, splitGraphemes, stringWidth } from '../../engine/index.js';
import { formatElapsedCompact, joinSegments } from '../../../contracts/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import { HEAD_MARKS } from '../panels/panel-chrome.js';

/** 转轮帧序（braille 十帧——件内自持单源） */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

/** 扫光带参数（挖掘 35 轮 B0+B3——codex shimmer.rs 同形：2s 周期、半带宽
 * 5 列、两侧 padding 10 列——带自文案左侧入场至右侧离场匀速扫过） */
const SHIMMER_PERIOD_MS = 2_000;
const SHIMMER_HALF_WIDTH = 5;
const SHIMMER_PADDING = 10;
/** 真彩档混色强度帽（codex 同形 0.9——带心字素也保留 10% 基色，不整字没入底色） */
const SHIMMER_STRENGTH = 0.9;

/** bold 样式（阶梯档带内 ≥0.6 位——engine 只出 DIM/EMPTY，本件自持单源） */
const BOLD_STYLE: Readonly<CellStyle> = Object.freeze({ bold: true });

/**
 * 扫光强度（0..1）：文案段内列位的余弦带——带心 1、带缘 0、带外 0。相位
 * 基准 = 注入钟（pos 随 nowMs 推进、周期环绕）。纯函数导出（测试单源锁形）。
 */
export function shimmerIntensity(col: number, textCols: number, nowMs: number): number {
  const span = textCols + SHIMMER_PADDING * 2;
  const pos = ((nowMs % SHIMMER_PERIOD_MS) / SHIMMER_PERIOD_MS) * span;
  const dist = Math.abs(col + SHIMMER_PADDING - pos);
  if (dist > SHIMMER_HALF_WIDTH) return 0;
  return 0.5 * (1 + Math.cos((Math.PI * dist) / SHIMMER_HALF_WIDTH));
}

/** 任务行态 + 离场态（idle = 零高度缺席；注⑪⑦：streaming 拆 thinking/generating 双态） */
export type TaskLineState = 'idle' | 'working' | 'thinking' | 'generating' | 'retrying' | 'error';

/** 供数器注入面（backend 装配位——本件零装配知识） */
export interface TaskStatusProviders {
  /** run 累计耗时毫秒（runStartedAt 起、重试续入不清零；null = 无起点诚实缺席） */
  readonly elapsedMs: () => number | null;
  /** 本轮 token 段文本（`本轮 N`——估值器 ⑥c 供数；'' = 缺席缩位，零 token 形） */
  readonly turnTokensText: () => string;
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
  /** 态② 思考活状态头（message_update 末思考块首个粗体段——backend 派生注入；
   * null = 缺席兜底「思考中」——挖掘 31 轮 [2] 词面律） */
  private thinkingHeader: string | null = null;
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
  /** 扫光混色对（theme.shimmer 定值——setTheme 重建；undefined = 非真彩档/
   * 基色不可知，走三档阶梯回退〔挖掘 35 轮 B0+B3〕） */
  private shimmerBlend: { base: RgbChannels; highlight: RgbChannels } | undefined = DEFAULT_THEME.shimmer;
  /** dim 样式（态③ 文案与括号段——注⑩：engine 正典单源） */
  private readonly dimStyle: Readonly<CellStyle> = DIM_STYLE;
  /** 动效门（挖掘 35 轮 B2+B4——false = 禁用形：转轮退 • dim 静态符 + tick
   * 零推帧零通知〔07 §4.1 呈现面动效门控〕；backend 装配单源注入，缺省 true） */
  private animationsEnabled = true;
  private readonly providers: TaskStatusProviders;

  constructor(providers: TaskStatusProviders) {
    this.providers = providers;
  }

  /** 主题换装（backend injectTheme 单源路——accent/error 派生样式重建 + 扫光
   * 混色对随行〔色域档/探测面换装即换扫光档〕） */
  setTheme(theme: ResolvedTheme): void {
    this.spinnerStyle = Object.freeze({ fg: theme.accent });
    this.errorStyle = Object.freeze({ fg: theme.error });
    this.shimmerBlend = theme.shimmer;
  }

  /** 动效门控（挖掘 35 轮 B2+B4——backend 构造后早于首 render 注入；真源 =
   * settings.json animations 键 + env BERRY_AGENT_TUI_ANIMATIONS 逐次覆盖） */
  setAnimations(enabled: boolean): void {
    this.animationsEnabled = enabled;
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
    return (
      this.state === 'working' || this.state === 'thinking' || this.state === 'generating' || this.state === 'retrying'
    );
  }

  /** 当前转轮帧观测面（测试断言帧推进用） */
  get frame(): string {
    return SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length]!;
  }

  /** 态① 正在对话中（agent_start / retry_wait_end(resumed) 驱动；工具段让位律同状态行） */
  enterWorking(): void {
    this.state = 'working';
    this.toolName = null;
    this.thinkingHeader = null; // 活头连清（工具段相位无活头——态迁移连清律）
    this.onChange?.();
  }

  /** 态② 思考中（注⑪⑦ 细分双态之一——message_start 起跑缺省 / thinking 尾块
   * 维持；assistant 流式窗口开，message_end 归态①）。活头重置（新段起步语义
   * ——块界清头重建的组件半边，backend 下一 delta 重提） */
  enterThinking(): void {
    this.state = 'thinking';
    this.thinkingHeader = null;
    this.onChange?.();
  }

  /** 态② 生成中（注⑪⑦ 细分双态之二——text 尾块词面迁移一次；message_end 归态①） */
  enterGenerating(): void {
    this.state = 'generating';
    this.thinkingHeader = null; // 活头退场（text 相位只辖 thinking 词面——挖掘 31 轮 [2]）
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

  /** 态④ 错误终态（retry_wait_end aborted/exhausted 揭示——红 ✗ 驻留至下个 agent_start；
   * reason = 失败直呈律（07 §4.1 V-0 注②）同句原因——agent_end failed 的
   * errorMessage 经持有档揭示位供入，缺席兜底裸形） */
  enterError(reason?: string): void {
    this.state = 'error';
    this.toolName = null;
    this.thinkingHeader = null; // 活头连清（终态词面独立——不残留流中活头）
    this.errorReason = reason !== undefined && reason !== '' ? reason : null;
    this.onChange?.();
  }

  /** 离场（agent_end completed/aborted——零高度缺席） */
  goIdle(): void {
    this.state = 'idle';
    this.toolName = null;
    this.thinkingHeader = null; // 活头连清（repaint 清账既有律——流中窗内下一 delta 重建）
    this.onChange?.();
  }

  /** 实时工具名（tool_execution_start → name；null 清——态① 优先段） */
  setTool(name: string | null): void {
    this.toolName = name;
    this.onChange?.();
  }

  /** 思考活状态头（message_update 末思考块首个粗体段——挖掘 31 轮 [2]；setTool
   * 同族注入面：backend 消毒后供入，null/空串归一缺席——同值零通知（同词零重绘
   * 律——流中逐 delta 重提、恒头一零重绘）） */
  setThinkingHeader(text: string | null): void {
    const next = text !== null && text !== '' ? text : null;
    if (this.thinkingHeader === next) return;
    this.thinkingHeader = next;
    this.onChange?.();
  }

  /** 推帧（装配层定时驱动——仅忙态有意义；闲态/终态零变化零通知；禁用形
   * 零推帧零通知——静止回退，态变/供数变才触重绘〔挖掘 35 轮 B2+B4〕） */
  tick(): void {
    if (!this.animationsEnabled) return;
    if (!this.isBusy) return;
    this.frameIndex++;
    this.onChange?.();
  }

  /** 落位（左起：转轮/✗ + 文案段 + dim 括号段；文案段超宽让位截断加省略号） */
  render(buffer: CellBuffer, region: Region): void {
    if (this.state === 'idle' || region.width <= 0) return;
    if (this.state === 'error') {
      // 态④：红 ✗ 终态——无转轮无括号（失败腿不写 footer 用量尾注——V-3 注⑧
      // 已退役，用量经行1 累计槽；速度段亦退役 V-4 注⑪⑦）；失败直呈律
      // （V-0 注②）同句携因 `✗ 失败 · 原因`（缺席裸形兜底）；原因行宽帽 = 段帽
      // （ellipsize 一句话帽——不溢行产漂账物理行）
      const text = this.errorReason === null ? '✗ 失败' : `✗ 失败 · ${this.errorReason}`;
      buffer.writeText(region.row, region.col, ellipsize(text, region.width), this.errorStyle);
      return;
    }
    // 动效门（挖掘 35 轮 B2+B4）：启用形 = braille 转轮帧 accent；禁用形退
    // • dim 静态符——前庭敏感/慢 SSH 的静止回退（07 §4.1 呈现面动效门控）
    if (this.animationsEnabled) {
      const frame = SPINNER_FRAMES[this.frameIndex % SPINNER_FRAMES.length]!;
      buffer.writeText(region.row, region.col, frame, this.spinnerStyle);
    } else {
      buffer.writeText(region.row, region.col, '•', this.dimStyle);
    }
    const text = this.statusText();
    const paren = this.parenText();
    // 宽度分配：转轮 1 列 + 间隔 1 列 + 文案段弹性（超宽截断加省略号）+ 括号
    // 段保尾；括号装不下（极窄屏）整段退场——文案段独享剩余宽（不截半括号）
    const parenWidth = paren !== '' ? stringWidth(paren) : 0;
    const useParen = parenWidth > 0 && parenWidth + 2 <= region.width;
    const textBudget = Math.max(0, region.width - 2 - (useParen ? parenWidth : 0));
    const fitted = ellipsize(text, textBudget);
    if (fitted !== '') {
      if (this.animationsEnabled) {
        // 忙态文案段扫光（挖掘 35 轮 B0+B3——态①②③ 同扫）：逐字素按列位
        // 强度着色；态③ t=0 阶梯位即 dim（注⑩ 基形天然落在带外档，带过境
        // 字素短暂升档 = 忙指示语汇统一）
        this.writeShimmered(buffer, region.row, region.col + 2, fitted);
      } else {
        // 门禁用形（B2）：扫光退场纯文本——态③ 例外保整段 dim（注⑩ 是静态
        // 降存在感语义非动效，门辖外）
        buffer.writeText(region.row, region.col + 2, fitted, this.state === 'retrying' ? this.dimStyle : undefined);
      }
    }
    if (useParen) buffer.writeText(region.row, region.col + 2 + stringWidth(fitted), paren, this.dimStyle);
  }

  /** 忙态文案段扫光落格（B0+B3）：逐字素取列位强度单写一格（宽字素按其
   * 起始列定位——列域扫光与显示几何同构）；相位渲染期现算（纯渲染零态变） */
  private writeShimmered(buffer: CellBuffer, row: number, col: number, text: string): void {
    const nowMs = this.providers.now();
    const cols = stringWidth(text);
    let at = col;
    for (const g of splitGraphemes(text)) {
      const t = shimmerIntensity(at - col, cols, nowMs);
      buffer.writeText(row, at, g, this.shimmerStyle(t));
      at += graphemeWidth(g);
    }
  }

  /**
   * 单字素扫光样式：真彩档 = 基色向高光（探测 bg）混 t×0.9 + 恒 bold（codex
   * blend 同向同强——带外字素也恒样式）；非真彩 = 三档阶梯（t<0.2 dim /
   * t<0.6 无样式 / ≥0.6 bold）。
   */
  private shimmerStyle(t: number): Readonly<CellStyle> | undefined {
    if (this.shimmerBlend !== undefined) {
      const a = t * SHIMMER_STRENGTH;
      const { base, highlight } = this.shimmerBlend;
      return Object.freeze({
        fg: colorRgbOf(
          Math.round(highlight.r * a + base.r * (1 - a)),
          Math.round(highlight.g * a + base.g * (1 - a)),
          Math.round(highlight.b * a + base.b * (1 - a)),
        ),
        bold: true,
      });
    }
    if (t < 0.2) return this.dimStyle;
    if (t < 0.6) return undefined;
    return BOLD_STYLE;
  }

  /** 文案段（态① 工具段优先/② 思考中·生成中细分/③ 重试倒计时；本轮段尾拼 ` · `——态①②） */
  private statusText(): string {
    if (this.state === 'retrying') {
      // 倒计时本地钟现算（绝对时刻律）：窗尽 clamp 0s（resumed 事件随后续到达）
      const secondsLeft = Math.max(0, Math.ceil((this.retryNextAt - this.providers.now()) / 1000));
      return `重试中 第 ${this.retryAttempt}/${this.retryMaxAttempts} 次 · ${secondsLeft}s 后`;
    }
    const base =
      this.state === 'thinking'
        ? (this.thinkingHeader ?? '思考中') // 活头在场替位、缺席兜底现词面（挖掘 31 轮 [2]——不硬造）
        : this.state === 'generating'
          ? '生成中'
          : this.toolName !== null
            ? `${HEAD_MARKS.tool} ${this.toolName} …` // ⚙ 单源走头符表 tool 位（选型翻档只改一处）
            : '正在对话中';
    const turnTokens = this.providers.turnTokensText();
    return turnTokens === '' ? base : `${base} · ${turnTokens}`;
  }

  /** 括号段（dim——` (1m 02s · 按 ESC 取消对话)`；两段各自缩位，双缺席无括号） */
  private parenText(): string {
    const elapsedMs = this.providers.elapsedMs();
    const elapsed = elapsedMs === null ? '' : formatElapsedCompact(elapsedMs);
    const hint = this.providers.interruptHint();
    // 空段过滤 + 「 · 」串接 = joinSegments 单源语义（filter 旧形即其语义）；
    // 双缺席 inner 为空串 → 无括号（守卫在 return 行）
    const inner = joinSegments(elapsed, hint);
    return inner === '' ? '' : ` (${inner})`;
  }
}
