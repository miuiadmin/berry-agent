/**
 * /usage 用量副屏件（07 §4.1 R7 批 10k——数据源条款落码呈现腿）：会话全
 * run 累计分表（token 四分表 + 合计 + 货币 + 轮次）。与件 6 状态行 usage
 * 文案（run 级清账态——repaint 归零重计）分职不互替。
 *
 * - **静态行集**（快照档——HelpViewer 同律：构造后静态，返回主屏全帧补显）；
 * - **计数口径注记**：计 ALL assistant/message 事件（含被遮蔽 retry——遮蔽
 *   是呈现层概念，token 已真实花费；foldSessionUsage 头注在案）；
 * - **退出键面**：q/Esc 退出、Ctrl+C 打断、Ctrl+D 退出进程——副屏键面
 *   补丁三件套与件 8 同律。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import { shortIdOf } from '../backend/transcript.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type { UiUsageSummary } from '../../../contracts/index.js';

/** 用量面板装配选项 */
export interface UsageViewerOptions {
  readonly sessionId: string;
  readonly summary: UiUsageSummary;
  /** 行集构建折宽锚（开屏时终端列宽） */
  readonly columns: number;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
}

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 底行键面提示 */
const HINT_TEXT = 'q/esc 返回 · ↑↓/pgup/pgdn/home/end 滚动';

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/** token 数千位分组（tui-backend formatTokenCount 同形——分表行呈现） */
function formatCount(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 用量面板内容件：ScrollView 子类 + OverlayContent（副屏 root）。行集
 * 构造后静态（快照档）。
 */
export class UsageViewer extends ScrollView implements OverlayContent {
  private readonly sessionId: string;
  private readonly onExit: (() => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  private exited = false;

  constructor(options: UsageViewerOptions) {
    super();
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.setLines(buildUsageLines(options.summary));
    this.scrollToTop(); // 开屏锚顶（ScrollView 缺省贴尾为回看器语义——口径注记是首行）
  }

  /** 量高：头行 + 视口全量 + 底行提示 */
  measure(width: number): number {
    return 1 + super.measure(width) + 1;
  }

  /** 落位：头行 → 滚动视口 → 底行提示 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    buffer.writeText(region.row, region.col, `⧗ 会话用量 · ${shortIdOf(this.sessionId)}`);
    const viewHeight = region.height - 2;
    if (viewHeight > 0) {
      super.render(buffer, { row: region.row + 1, col: region.col, width: region.width, height: viewHeight });
    }
    buffer.writeText(region.row + region.height - 1, region.col, HINT_TEXT, HINT_STYLE);
  }

  /** 事件分发（副屏内容终局消费——键面同 HelpViewer） */
  handleEvent(event: InputEvent): boolean {
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.sessionId);
        return true;
      }
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
      this.exit();
      return true;
    }
    super.handleEvent(event);
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
 * 用量行集构造（纯函数——测试直锁消费）：口径注记 → 轮次 → token 四分表
 * + 合计 → 货币行（无 cost 上报如实呈现）。
 */
export function buildUsageLines(summary: UiUsageSummary): string[] {
  const labelCol = 18; // 标签列宽（最长「合计 totalTokens」+ 2）
  const row = (label: string, value: string): string => `${label.padEnd(labelCol)}${value}`;
  return [
    '全 run 累计（含被遮蔽重试——token 已真实花费）',
    '',
    row('轮次 turns', `${summary.turns}`),
    row('输入 input', formatCount(summary.input)),
    row('输出 output', formatCount(summary.output)),
    row('缓存读 cacheRead', formatCount(summary.cacheRead)),
    row('缓存写 cacheWrite', formatCount(summary.cacheWrite)),
    row('合计 totalTokens', formatCount(summary.totalTokens)),
    '',
    summary.currency === null && summary.cost === 0
      ? row('费用 cost', '无上报')
      : row('费用 cost', `${summary.cost.toFixed(4)} ${summary.currency ?? ''}`.trimEnd()),
  ];
}
