/**
 * /jobs 后台任务副屏（界面美化役批6——UX 批6 问题②拍板 C 件：
 * diff-viewer 光标导航克隆形）。
 *
 * - **全量清单**（固定区段 JobPanel 只呈 running 帽 5 行，本屏补全量）：
 *   「运行中」段（注册序，running/stopping）+「近期结束」段（终态
 *   terminal.at 降序——最近收场的在前）；行形 `{名} · {状态} · {时长} ·
 *   {归属}`，状态词直白面（运行中/停止中/已完成/已停止/失败），子代理
 *   归属呈会话短 id（shortIdOf 单源）；
 * - **时长口径**：运行中 = 本地钟现减 startedAt（活时），终态 =
 *   terminal.at - startedAt（冻结）；格式单源 formatElapsedCompact；
 * - **快照档**（diff-viewer 同律——构造期一次现取，开屏后行集静态；
 *   活体跟随挂账）；终态行 dim（历史感）、失败行 error 着色、在选行
 *   ▸ 记 + accent；
 * - **光标域 = 条目行**（分段头不可选——移动键跳过分段头，diff-viewer
 *   组头可选中形的差异化：组头无展开语义故不值驻留）；initialJobId
 *   定位（JobPanel enter 进屏定位该任务）；
 * - 键面同副屏件族律（q / esc 返回、Ctrl+C 打断、Ctrl+D 先收屏再退；
 *   滚轮 ±3 行自由滚——不挪光标）。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { ellipsize } from '../../engine/index.js';
import type { JobEntry, JobStatus } from '../../../contracts/index.js';
import type { ResolvedTheme } from '../theme/index.js';
import { CURSOR_MARK, VIEWER_HEAD_MARK, headStyleOf } from './panel-chrome.js';
import type { OverlayContent } from '../overlay/overlay.js';
import { hintLine } from '../keys/hint.js';
import { shortIdOf } from '../backend/transcript.js';
import { formatElapsedCompact } from '../status/task-status-line.js';

/** 状态词直白面（用户面话术律——禁内部黑话；killed = 已停止） */
const STATUS_WORDS: Readonly<Record<JobStatus, string>> = Object.freeze({
  running: '运行中',
  stopping: '停止中',
  completed: '已完成',
  killed: '已停止',
  failed: '失败',
});

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 分段头样式（dim——panel-chrome 分段头 dim 律） */
const HEAD_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });

/** 滚轮单步行数（diff-viewer / ScrollView WHEEL_LINES 同值） */
const WHEEL_LINES = 3;

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/**
 * 扁平呈现行（分段头 + 条目——光标/滚动的行空间单源；快照档构造期定形
 * 后静态，render/事件两消费面共读）。
 */
type FlatRow =
  | { readonly kind: 'head'; readonly text: string }
  | { readonly kind: 'entry'; readonly entry: JobEntry; readonly text: string };

/** 条目行文本组装（纯函数——测试单源位）：`{名} · {状态} · {时长} · {归属}` */
export function jobEntryLine(entry: JobEntry, now: number): string {
  const duration =
    entry.terminal === undefined
      ? formatElapsedCompact(Math.max(0, now - entry.startedAt)) // 活时（本地钟现减）
      : formatElapsedCompact(Math.max(0, entry.terminal.at - entry.startedAt)); // 终态冻结
  const owner = entry.kind === 'subagent' ? shortIdOf(entry.owner) : entry.owner;
  return `${entry.name} · ${STATUS_WORDS[entry.status]} · ${duration} · ${owner}`;
}

/** 副屏装配选项 */
export interface JobsViewerOptions {
  /** 清单快照（构造期一次现取——开屏行集静态，活体跟随挂账） */
  readonly entries: readonly JobEntry[];
  /** 本地钟（运行中条目活时计算——注入位测试确定性） */
  readonly now: () => number;
  /** 主题（头行 accent / 失败行 error 派生着色） */
  readonly theme: ResolvedTheme;
  /** 进屏定位（JobPanel enter 消费——该任务行即光标位；缺席 = 光标置首条目） */
  readonly initialJobId?: string;
  readonly sessionId: string;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
}

/**
 * 后台任务清单副屏内容件（OverlayContent——副屏 root 直收全屏 region）：
 * 行空间光标域 = 条目行（分段头跳过），视口滚动 diff-viewer 同律（光标
 * 钉随 + 滚轮自由滚位）。快照档——返回主屏全帧补显。
 */
export class JobsViewer implements OverlayContent {
  private readonly rows: readonly FlatRow[];
  /** 条目行的扁平行下标集（光标域——分段头不在域内） */
  private readonly entryPositions: readonly number[];
  /** 光标位（entryPositions 下标域；空域 = 0 无人观测） */
  private cursor = 0;
  /** 视口首行（光标驱动夹取） */
  private offset = 0;
  /** 滚轮自由滚位（diff-viewer 同律——只滚视口不挪光标，键盘动作复位钉随） */
  private freeScroll = false;
  /** 视口高实测（render 回写——翻页的页幅依据） */
  private viewportHeight = 1;
  /** 退出闭锁（q/Esc 与 Ctrl+D 两路共闭——竞发防御位） */
  private exited = false;
  private readonly now: () => number;
  private readonly theme: ResolvedTheme;
  private readonly sessionId: string;
  private readonly onExit: () => void;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;

  constructor(options: JobsViewerOptions) {
    this.now = options.now;
    this.theme = options.theme;
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    // 分段组装：运行中（注册序）+ 近期结束（terminal.at 降序）；终态防御
    // 分流（无 terminal 的 running/stopping 归运行段——registry 语义同源）
    const running: JobEntry[] = [];
    const settled: JobEntry[] = [];
    for (const entry of options.entries) {
      if (entry.terminal === undefined) running.push(entry);
      else settled.push(entry);
    }
    settled.sort((a, b) => b.terminal!.at - a.terminal!.at);
    const rows: FlatRow[] = [];
    if (running.length > 0) rows.push({ kind: 'head', text: `── 运行中（${running.length}）──` });
    for (const entry of running) rows.push({ kind: 'entry', entry, text: jobEntryLine(entry, this.now()) });
    if (settled.length > 0) rows.push({ kind: 'head', text: `── 近期结束（${settled.length}）──` });
    for (const entry of settled) rows.push({ kind: 'entry', entry, text: jobEntryLine(entry, this.now()) });
    this.rows = rows;
    this.entryPositions = rows.flatMap((row, index) => (row.kind === 'entry' ? [index] : []));
    // 进屏定位（JobPanel enter 面）：initialJobId 命中即光标位；缺席 = 首条目
    if (options.initialJobId !== undefined) {
      const found = rows.findIndex((row) => row.kind === 'entry' && row.entry.id === options.initialJobId);
      if (found >= 0) {
        const pos = this.entryPositions.indexOf(found);
        if (pos >= 0) this.cursor = pos;
      }
    }
  }

  /** 量高：头行 + 扁平行全量 + 底行提示（副屏 root 不经布局路——render 窗口化） */
  measure(_width: number): number {
    void _width;
    return 1 + Math.max(1, this.rows.length) + 1;
  }

  /** 落位：头行 → 行视口（分段头 dim / 终态行 dim / 失败行 error / 在选 accent）→ 底行提示 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    buffer.writeText(
      region.row,
      region.col,
      ellipsize(`${VIEWER_HEAD_MARK} 后台任务 /jobs`, region.width),
      headStyleOf(this.theme),
    );
    const viewHeight = Math.max(1, region.height - 2);
    this.viewportHeight = viewHeight;
    if (this.rows.length === 0) {
      buffer.writeText(region.row + 1, region.col, '（当前没有后台任务）', HINT_STYLE);
    } else {
      this.clampCursor();
      this.clampOffset();
      for (let i = 0; i < viewHeight; i++) {
        const index = this.offset + i;
        if (index >= this.rows.length) break;
        const row = this.rows[index]!;
        if (row.kind === 'head') {
          buffer.writeText(region.row + 1 + i, region.col, row.text, HEAD_STYLE);
          continue;
        }
        const selected = this.entryPositions[this.cursor] === index;
        const line = `${selected ? CURSOR_MARK : ' '} ${row.text}`;
        buffer.writeText(
          region.row + 1 + i,
          region.col,
          ellipsize(line, region.width),
          selected ? headStyleOf(this.theme) : this.entryStyle(row.entry),
        );
      }
    }
    buffer.writeText(
      region.row + region.height - 1,
      region.col,
      this.rows.length === 0 ? 'q/esc 返回' : hintLine('↑↓ 移动', 'q/esc 返回'),
      HINT_STYLE,
    );
  }

  /** 条目行常态样式：失败 = error 着色、其余终态 = dim（历史感）、运行中 = 裸 */
  private entryStyle(entry: JobEntry): Readonly<CellStyle> | undefined {
    if (entry.terminal === undefined) return undefined;
    return entry.terminal.status === 'failed' ? Object.freeze({ fg: this.theme.error }) : HINT_STYLE;
  }

  /** 事件分发（副屏内容终局消费）：滚轮 → Ctrl+C/Ctrl+D → 移动键（跳分段头）→ 退出 */
  handleEvent(event: InputEvent): boolean {
    if (event.kind === 'mouse') {
      // 滚轮只滚视口（diff-viewer 同律）：±3 行界夹取；wheel 无 release 相；
      // 非滚轮鼠标相零动作吞（v1 无选区/点击面，模态独占）
      if (event.phase === 'press' && (event.button === 'wheel-up' || event.button === 'wheel-down')) {
        if (this.rows.length > 0) {
          const maxOffset = Math.max(0, this.rows.length - this.viewportHeight);
          const delta = event.button === 'wheel-up' ? -WHEEL_LINES : WHEEL_LINES;
          this.freeScroll = true; // 自由滚位（render 夹取只守界）
          this.offset = Math.max(0, Math.min(maxOffset, this.offset + delta));
        }
        return true;
      }
      return true;
    }
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断在飞 run（目标 = 当前交互会话位——不退屏，件族同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.sessionId);
        return true;
      }
      // Ctrl+D = 退出进程（先收副屏再转退出柄——件族同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd') {
        this.exit();
        this.onQuit?.();
        return true;
      }
      // 键盘光标动作族复位钉随（光标恒可见律）；光标域 = 条目行（分段头跳过
      // ——域即 entryPositions 下标，天然不含分段头）
      if (this.entryPositions.length > 0) {
        this.freeScroll = false;
        const last = this.entryPositions.length - 1;
        if (isPlainKey(k, 'up')) {
          this.cursor = Math.max(0, this.cursor - 1);
          return true;
        }
        if (isPlainKey(k, 'down')) {
          this.cursor = Math.min(last, this.cursor + 1);
          return true;
        }
        if (isPlainKey(k, 'pageup')) {
          this.cursor = Math.max(0, this.cursor - this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'pagedown')) {
          this.cursor = Math.min(last, this.cursor + this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'home')) {
          this.cursor = 0;
          return true;
        }
        if (isPlainKey(k, 'end')) {
          this.cursor = last;
          return true;
        }
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
    return true; // 未消费键终局吞（模态独占）
  }

  /** 光标夹取（域收缩防御位——快照档行集静态，正常路恒入界） */
  private clampCursor(): void {
    if (this.entryPositions.length === 0) this.cursor = 0;
    else this.cursor = Math.max(0, Math.min(this.entryPositions.length - 1, this.cursor));
  }

  /**
   * 视口夹取（diff-viewer 同律）：界夹取恒守；光标钉随（下溢提窗 / 上溢压窗）
   * 只在非自由滚位期——滚轮只滚视口期光标可暂出窗（键盘光标动作复位钉随）。
   */
  private clampOffset(): void {
    const maxOffset = Math.max(0, this.rows.length - this.viewportHeight);
    if (this.offset > maxOffset) this.offset = maxOffset;
    if (this.offset < 0) this.offset = 0;
    if (this.freeScroll) return; // 滚轮自由滚位——只守界（光标可暂出窗）
    const cursorRow = this.entryPositions[this.cursor] ?? 0;
    if (cursorRow < this.offset) this.offset = cursorRow;
    else if (cursorRow >= this.offset + this.viewportHeight) {
      this.offset = cursorRow - this.viewportHeight + 1;
    }
  }

  /** 退出（闭锁——单次收口） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }
}
