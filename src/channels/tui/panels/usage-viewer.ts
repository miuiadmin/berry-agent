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
import { stringWidth } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import { shortIdOf } from '../backend/transcript.js';
import type { OverlayContent } from '../overlay/overlay.js';
import { hintLine } from '../keys/hint.js';
import type { UiUsageSummary } from '../../../contracts/index.js';
import { fitLine } from '../row-segments.js';
import { headStyleOf, VIEWER_HEAD_MARK } from './panel-chrome.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import { DIM_STYLE } from '../../engine/index.js';

/** 用量面板装配选项 */
export interface UsageViewerOptions {
  readonly sessionId: string;
  readonly summary: UiUsageSummary;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
  /**
   * 主题（界面美化役 2026-10-01 美学批——头行 accent 着色注入位）：测试装配
   * 缺省 DEFAULT_THEME；主会话装配位已接线（tui-backend theme: this.theme）。
   */
  readonly theme?: ResolvedTheme;
}

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = DIM_STYLE;
/** 底行键面提示 */
const HINT_TEXT = hintLine('q/esc 返回', '↑↓/pgup/pgdn/home/end 滚动');

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/** token 数千位分组（单源——tui-backend 状态行 import 同消费；顺既有边 tui-backend→usage-viewer 无环） */
export function formatCount(n: number): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 速度格式化（三反馈批C；V-4 注⑪⑦ 自 tui-backend 迁入——任务行速段与尾注
 * 速段双退役后本件持单源）三档（TUI 对标 Codex 五件批 E 件翻档——千分位
 * 退役）：<100 tok/s 一位小数（尾零剥除——25.0 → 25，精度帽一位不失信息）、
 * ≥100 无千分位整数（600）、≥1000 一位小数 k 缩写（1,600 → 1.6k——用户读
 * 感拍板：速度槽高速段位宽压缩、千分位逗号在快速刷新语境徒增噪音）。消费位 =
 * 行1 速度段（V-4 笔3 底栏三行栈——speedView 观测面供数 + E 件 500ms 显示
 * 节流缓存）。档界舍入角：999.6 → Math.round → '1000' 四位直显一帧（升档
 * 判据按入参 n 非舍入后值——边界一窗 500ms 无观测义）。
 */
export function formatTokensPerSecond(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n >= 100) return String(Math.round(n));
  return n.toFixed(1).replace(/\.0$/, '');
}

/**
 * token 数紧凑格式（V-4 注⑪②——footer 行1 上下文三件套单源）：≥1M 一位
 * 小数（尾零剥除——1.0 → 1）、≥1K 千位整数、<1K 原值；空格单位形（用户样例
 * `上下文 12 K / 1 M · 38%`）。与 formatCount 千位分组分职（累计段用全值
 * 分组形——槽位充裕；上下文段用紧凑形——三件套并列省宽）。
 *
 * K 档先舍入后分档（alpha.31 二轮扫描处置——修「1000 K」双单位并置）：
 * rounded 达 1000 升 M 档（999,500 起 Math.round 进到 1000——若直显
 * 「1000 K」将与 1,000,000 的「1 M」双单位制并置失真；升档复用 M 档一位
 * 小数舍入形）。M 档自身无更高档：舍入入千位（999,950,000 起「1000 M」）
 * 为单档续形非双单位并置——保留。
 */
export function formatTokensCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')} M`;
  if (n >= 1_000) {
    // 先舍入后分档：rounded 达 1000 升 M 档（999,500 → 1 M；999,499 → 999 K）
    const rounded = Math.round(n / 1_000);
    if (rounded >= 1_000) return `${(rounded / 1_000).toFixed(1).replace(/\.0$/, '')} M`;
    return `${rounded} K`;
  }
  return `${n}`;
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
  /** 头行 accent 派生样式（theme 注入位——缺省 DEFAULT_THEME） */
  private readonly headStyle: Readonly<CellStyle>;

  constructor(options: UsageViewerOptions) {
    // 界面美化役 2026-10-01 美学批：折行续行 2 空格悬挂（用量行集无分段线族
    // ——dim 档不选开，predicate 空转不立）
    super({ hangingIndent: true });
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.headStyle = headStyleOf(options.theme ?? DEFAULT_THEME);
    this.setLines(buildUsageLines(options.summary));
    this.scrollToTop(); // 开屏锚顶（ScrollView 缺省贴尾为回看器语义——口径注记是首行）
  }

  /** 量高：头行 + 视口全量 + 底行提示 */
  measure(width: number): number {
    return 1 + super.measure(width) + 1;
  }

  /** 落位：头行（accent + fitLine 收口）→ 滚动视口 → 底行提示（fitLine 收口） */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    // 界面美化役美学注④/⑤：头符 ◉（查看族——⧗ 弃用）accent 着色 + 非条目行 fitLine 收口
    buffer.writeText(
      region.row,
      region.col,
      fitLine(`${VIEWER_HEAD_MARK} 会话用量 · ${shortIdOf(this.sessionId)}`, region.width),
      this.headStyle,
    );
    const viewHeight = region.height - 2;
    if (viewHeight > 0) {
      super.render(buffer, { row: region.row + 1, col: region.col, width: region.width, height: viewHeight });
    }
    buffer.writeText(region.row + region.height - 1, region.col, fitLine(HINT_TEXT, region.width), HINT_STYLE);
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
  const labelCol = 8; // 标签列宽（最长标签「缓存读/缓存写」宽 6 + 2）
  // 标签补齐按显示宽（批 10k 遗漏修——padEnd 码元计量下 CJK 双宽标签错位
  // 1 格：缓存读/写行值列比轮次行右凸 1 列）；值列恒右起同列
  const row = (label: string, value: string): string =>
    label + ' '.repeat(Math.max(0, labelCol - stringWidth(label))) + value;
  return [
    '本会话累计（含未显示的重试——重试同样消耗 token）',
    '',
    row('轮次', `${summary.turns}`),
    row('输入', formatCount(summary.input)),
    row('输出', formatCount(summary.output)),
    row('缓存读', formatCount(summary.cacheRead)),
    row('缓存写', formatCount(summary.cacheWrite)),
    row('合计', formatCount(summary.totalTokens)),
    '',
    summary.currency === null && summary.cost === 0
      ? row('费用', '无上报')
      : row('费用', `${summary.cost.toFixed(4)} ${summary.currency ?? ''}`.trimEnd()),
  ];
}
