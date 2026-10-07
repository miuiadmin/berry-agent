/**
 * /calls 调用台账副屏件（07 §4.1 B3 定形注——数据源条款呈现腿）：聚焦会话
 * 模型调用明细台账（最近 N 条：时刻/模型/状态/重试/tokens/耗时——N 定值
 * 50，fold 尾窗帽同值）。三职分立：件 6 = run 级清账态、/usage = 会话全 run
 * 累计分表、/calls = 调用明细台账（聚合与明细分职不互替）。
 *
 * - **静态行集**（快照档——usage-viewer 同款骨架：ScrollView + panel-chrome
 *   头行 accent + q/Esc/Ctrl+C/Ctrl+D 键面三件套 + fitLine 收口；开屏一次
 *   现读，开屏后新调用不进在场面板，重开重取）；
 * - **行段序**：时刻短形 · 模型短名 · [归因] · 状态词 · [重试注记] ·
 *   [失败短因] · tokens 短形 · 耗时（主对话路耗时诚实缺席「—」——durable
 *   无 per-request 位不冒充）；
 * - **最新在前**（jobs-viewer 近期结束降序同律——开屏即见最近调用）；
 * - **头行计数截断披露**：全量超行集注记「N 条（仅显示最近 50）」；
 * - **空态句带下一步**（07 §4.4 律五逐字）。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { ellipsize } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import { shortIdOf } from '../backend/transcript.js';
import type { OverlayContent } from '../overlay/overlay.js';
import { hintLine } from '../keys/hint.js';
import { formatElapsedCompact, joinSegments } from '../../../contracts/index.js';
import { formatTokensCompact } from './usage-viewer.js';
import { fitLine } from '../row-segments.js';
import { headStyleOf, VIEWER_HEAD_MARK, weakLineStyle } from './panel-chrome.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import { DIM_STYLE } from '../../engine/index.js';

/**
 * 台账条目（呈现面结构——conversation 侧 foldCallLedger 产物 CallLogEntry
 * 的结构兼容子集：只声明本件消费位字段，多余字段结构 typing 透传零映射）。
 */
export interface CallsViewerEntry {
  /** 时刻（毫秒） */
  readonly time: number;
  /** 模型（provider/model 实录全形；缺席呈现「——」） */
  readonly model?: string;
  /** 状态（stopReason 五终值——词面映射归本件） */
  readonly status?: CallsViewerStatus;
  /** 失败短因（status=error 携带——失败行段） */
  readonly errorMessage?: string;
  /** 尝试序号（>1 才显重试注记段） */
  readonly attempt: number;
  /** 重试帽（配对在场 = 第n/N次形） */
  readonly maxAttempts?: number;
  /** tokens（缺席呈现「——」） */
  readonly tokens?: number;
  /** 耗时毫秒（单发路在场必显；主路缺席呈现「——」） */
  readonly elapsedMs?: number;
  /** 归因前缀（callId 冒号前段——probe 等调用位宽容透传） */
  readonly attribution?: string;
}

/** 状态词键（= StopReason 闭集五终值——词汇语义单源在 conversation fold，词面映射归本件） */
export type CallsViewerStatus = 'stop' | 'toolUse' | 'length' | 'error' | 'aborted';

/** 状态词直白面（B3 定形注词族：完成/调工具/截断/失败/中止——既有词族复用+直白新造） */
const STATUS_WORDS: Readonly<Record<CallsViewerStatus, string>> = Object.freeze({
  stop: '完成',
  toolUse: '调工具',
  length: '截断',
  error: '失败',
  aborted: '中止',
});

/** 已知归因前缀的用户面词（枚举非穷尽——未知前缀原样透传，宽容解码） */
const ATTRIBUTION_LABELS: Readonly<Record<string, string>> = Object.freeze({
  probe: '连通测试',
});

/** 空态句（07 §4.4 律五带下一步形——逐字） */
const EMPTY_CALLS_TEXT = '本会话暂无模型调用——发起对话后自动记录';
/** 分段线（panel-chrome isSectionHeadLine `──` 形——weakLineStyle 取色链命中） */
const SECTION_LINE = '── 最近调用（最新在前）──';
/** 底行键面提示 */
const HINT_TEXT = hintLine('q/esc 返回', '↑↓/pgup/pgdn/home/end 滚动');
/** 失败短因段宽帽（首行截宽——长因省略，行宽不失控） */
const CAUSE_WIDTH = 48;
/** 模型短名段宽帽（同上——超宽模型名省略截断） */
const MODEL_WIDTH = 24;
/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = DIM_STYLE;

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/**
 * 时刻短形（MM-DD HH:mm 本地时——session-picker formatStamp / feedback-viewer
 * formatFeedbackStamp 同形；两先例皆件内私有，本件同形自持第三拷）。
 */
export function formatCallStamp(unixMs: number): string {
  const d = new Date(unixMs);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 模型全形 → 短名（id 尾段——footer modelShortOf 同律；裸 id 自返） */
function modelShortOf(spec: string): string {
  return spec.split('/').pop() ?? '';
}

/** 台账装配选项 */
export interface CallsViewerOptions {
  readonly sessionId: string;
  /** 台账行快照（fold 尾窗产物——构造期一次现取，开屏行集静态） */
  readonly entries: readonly CallsViewerEntry[];
  /** 全量计数（截断披露真源；缺席 = entries.length 即零截断） */
  readonly totalCount?: number;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
  /** 主题（头行 accent 注入位——测试装配缺省 DEFAULT_THEME；主会话装配位已接线 tui-backend theme: this.theme） */
  readonly theme?: ResolvedTheme;
}

/**
 * 调用台账副屏内容件：ScrollView 子类 + OverlayContent（副屏 root）。行集
 * 构造后静态（快照档——返回主屏全帧补显）。
 */
export class CallsViewer extends ScrollView implements OverlayContent {
  private readonly sessionId: string;
  private readonly onExit: (() => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 头行 accent 派生样式（theme 注入位——缺省 DEFAULT_THEME） */
  private readonly headStyle: Readonly<CellStyle>;
  /** 头行计数段（截断披露在构造期定形——行集静态） */
  private readonly countText: string;
  private exited = false;

  constructor(options: CallsViewerOptions) {
    // 分段线弱线取色（weakRule 在场整行弱线色、键缺席回退 dim）+ 折行续行
    // 2 空格悬挂；空态句恒 dim（弱线链不命中——显式分支优先）
    super({
      hangingIndent: true,
      lineStyle: (line) =>
        line === EMPTY_CALLS_TEXT ? DIM_STYLE : weakLineStyle(options.theme ?? DEFAULT_THEME)(line),
    });
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.headStyle = headStyleOf(options.theme ?? DEFAULT_THEME);
    const total = options.totalCount ?? options.entries.length;
    // 截断披露：全量超行集才注记（「N 条（仅显示最近 50）」——帽内零注记）
    this.countText =
      total > options.entries.length ? `${total} 条（仅显示最近 ${options.entries.length}）` : `${total} 条`;
    this.setLines(buildCallsLines(options.entries));
    this.scrollToTop(); // 开屏锚顶（ScrollView 缺省贴尾为回看器语义——分段线是首行）
  }

  /** 量高：头行 + 视口全量 + 底行提示 */
  measure(width: number): number {
    return 1 + super.measure(width) + 1;
  }

  /** 落位：头行（accent + fitLine 收口）→ 滚动视口 → 底行提示（fitLine 收口） */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    const head = `${VIEWER_HEAD_MARK} 调用台账 · ${shortIdOf(this.sessionId)} · ${this.countText}`;
    buffer.writeText(region.row, region.col, fitLine(head, region.width), this.headStyle);
    const viewHeight = region.height - 2;
    if (viewHeight > 0) {
      super.render(buffer, { row: region.row + 1, col: region.col, width: region.width, height: viewHeight });
    }
    buffer.writeText(region.row + region.height - 1, region.col, fitLine(HINT_TEXT, region.width), HINT_STYLE);
  }

  /** 事件分发（副屏内容终局消费——键面同 usage-viewer） */
  handleEvent(event: InputEvent): boolean {
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断（目标 = 当前交互会话位——不退屏）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.sessionId);
        return true;
      }
      // Ctrl+D = 退出进程（先收屏再转退出柄）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd') {
        this.exit();
        this.onQuit?.();
        return true;
      }
      if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) {
        this.exit();
        return true;
      }
    }
    if (event.kind === 'text' && event.text === 'q') {
      this.exit(); // kitty disambiguate 轨纯键打字走 text 事件
      return true;
    }
    super.handleEvent(event); // 滚动键
    return true;
  }

  /** 退出（闭锁——单次） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }
}

/**
 * 条目行文本组装（纯函数——测试直锁消费）：
 * `时刻 · 模型短名 · [归因] · 状态词 · [重试注记] · [失败短因] · tokens · 耗时`
 * （joinSegments 空段跳过——缺席字段按位「—」或段缺席，诚实不虚构）。
 */
export function callEntryLine(entry: CallsViewerEntry): string {
  // 重试注记：首试（attempt=1）零段；配对帽在场 = 第n/N次形（task-status-line 词族）
  const retry =
    entry.attempt > 1 ? `第${entry.attempt}${entry.maxAttempts !== undefined ? `/${entry.maxAttempts}` : ''}次` : '';
  // 失败短因：首行截宽（多行错误只呈首行——全文在会话回看）
  const cause =
    entry.errorMessage !== undefined ? ellipsize(entry.errorMessage.split(/\r?\n/, 1)[0] ?? '', CAUSE_WIDTH) : '';
  const attribution =
    entry.attribution !== undefined ? (ATTRIBUTION_LABELS[entry.attribution] ?? entry.attribution) : '';
  return joinSegments(
    formatCallStamp(entry.time),
    entry.model !== undefined ? ellipsize(modelShortOf(entry.model), MODEL_WIDTH) : '—',
    attribution,
    entry.status !== undefined ? STATUS_WORDS[entry.status] : '—',
    retry,
    cause,
    entry.tokens !== undefined ? formatTokensCompact(entry.tokens) : '—',
    entry.elapsedMs !== undefined ? formatElapsedCompact(entry.elapsedMs) : '—',
  );
}

/**
 * 台账行集构造（纯函数——测试直锁消费）：空态句（逐字）或 分段线 + 条目行
 * （最新在前——jobs-viewer 近期结束降序同律）。
 */
export function buildCallsLines(entries: readonly CallsViewerEntry[]): string[] {
  if (entries.length === 0) return [EMPTY_CALLS_TEXT];
  return [SECTION_LINE, ...[...entries].reverse().map(callEntryLine)];
}
