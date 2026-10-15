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
import { ellipsize, stringWidth } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import { shortIdOf } from '../backend/transcript.js';
import type { OverlayContent } from '../overlay/overlay.js';
import { hintLine } from '../keys/hint.js';
import type { UiUsageSummary } from '../../../contracts/index.js';
import { fitLine } from '../row-segments.js';
import { VIEWER_HEAD_MARK, headStyleOf, renderViewerHintBar } from './panel-chrome.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';

/**
 * 上下文余量快照（挖掘 31 轮 [6]——条形行数据源）：used = 已用 token（settled
 * 真值 + 流中估值——装配位单源算式）；max = 帽（null/≤0 = 供数端未报帽——
 * 裸呈紧凑值不画条形）。扩参不动 UiUsageSummary 契约面（累计分表与余量行
 * 分账：累计 = 会话全 run 聚合、余量 = 当前上下文窗——两口径不同源）。
 */
export interface UsageContextSnapshot {
  /** 已用 token（开屏快照档——面板静态不活跟） */
  readonly used: number;
  /** 帽（null = 未报帽；≤0 同缺席处理——非正值无百分比义） */
  readonly max: number | null;
}

/** 用量面板装配选项 */
export interface UsageViewerOptions {
  readonly sessionId: string;
  readonly summary: UiUsageSummary;
  /**
   * 上下文余量快照（挖掘 31 轮 [6]）：在场时行集殿后追加余量条形行；缺席
   * （undefined/null）= 行集维持既有 10 行（诚实缺席——首轮前 context_usage
   * 未落账同律）。
   */
  readonly context?: UsageContextSnapshot | null;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
  /**
   * 主题（界面美化役 2026-10-01 美学批——头行 accent 着色注入位）：测试装配
   * 缺省 DEFAULT_THEME；主会话装配位已接线（tui-backend theme: this.theme）。
   */
  readonly theme?: ResolvedTheme;
}

/** 余量条形定宽段数（承 codex 配额条形机制——rate_limits 定宽 20 段） */
const REMAINING_BAR_SEGMENTS = 20;
/** 余量条形满段符 */
const REMAINING_BAR_FILLED = '█';
/** 余量条形空段符 */
const REMAINING_BAR_EMPTY = '░';

/** 按模型分段模型名列宽帽（挖掘 44 轮件 A——calls-viewer MODEL_WIDTH 同值镜像） */
const MODEL_COLUMN_CAP = 24;

/**
 * 模型短名（挖掘 44 轮件 A——footer modelShortOf 同律第三拷；一行函数不立
 * 共享模块，calls-viewer 第二拷同款注记先例）：'provider/model' 取尾段、
 * 裸 id 自返；残键 '' 自返 ''（呈现词「未标识」另派）。
 */
function modelShortOf(spec: string): string {
  return spec.split('/').pop() ?? spec;
}

/**
 * 余量条形串（挖掘 31 轮 [6]）：按**剩余率**取整画段——`[████░░░░]` 满段数
 * = round(剩余率 × 20)。取向铁律：剩余率非已用率（传已用率整条倒读——
 * 剩多满少恰反转）；互补律：条形段取整与百分比 floor 同源互补，两读数恒
 * 同向不矛盾（剩 N% 口径单源 contextRemainingPercent——footer 同式同值，
 * 挖掘 44 轮件 B 起双面同源）。
 */
function renderRemainingBar(used: number, max: number): string {
  const ratio = Math.max(0, 1 - used / max);
  const filled = Math.min(REMAINING_BAR_SEGMENTS, Math.round(ratio * REMAINING_BAR_SEGMENTS));
  return `[${REMAINING_BAR_FILLED.repeat(filled)}${REMAINING_BAR_EMPTY.repeat(REMAINING_BAR_SEGMENTS - filled)}]`;
}

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
 * `上下文 12 K / 1 M · 剩 62%`）。与 formatCount 千位分组分职（累计段用全值
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
 * 上下文剩余百分比（挖掘 44 轮件 B——footer 行1 上下文槽与 /usage 余量行
 * 双面单源）：100 − floor(已用率 × 100)，下夹 0（越帽瞬态诚实见底）；
 * 值域 [0,100]（used ≥ 0 恒成立——settled 真值非负 + 流中估值器非负）。
 * 前置条件 max > 0（双消费位各自守门后才入——无帽二件套形不入本函数）。
 */
export function contextRemainingPercent(used: number, max: number): number {
  return Math.max(0, 100 - Math.floor((used / max) * 100));
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
    this.setLines(buildUsageLines(options.summary, options.context ?? null));
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
    // 底行：键面提示 + 滚动位置读数（挖掘 31 轮 [5]——右缘 NN%，未溢出/窄窗/超帽提示态缺席）
    renderViewerHintBar(buffer, region, HINT_TEXT, this.scrollPercent());
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
 * + 合计 → 货币行（无 cost 上报如实呈现）→ 上下文余量条形行（挖掘 31 轮
 * [6]——context 在场时追加式殿后：既有 0..9 行零迁移）→ 按模型分段（挖掘
 * 44 轮件 A——绝对尾追加：byModel ≥2 行才出段，缺席律冷启动零噪声）。
 * max>0 形 = `[bar] 剩 N% · used / max`（紧凑值单源 formatTokensCompact
 * ——与 footer 三件套同词汇；百分比单源 contextRemainingPercent——挖掘 44
 * 轮件 B 起双面同式同值）；缺席双态（context null / max 缺报）裸呈紧凑值
 * 不画条形。
 */
export function buildUsageLines(summary: UiUsageSummary, context: UsageContextSnapshot | null = null): string[] {
  const labelCol = 8; // 标签列宽（最长标签「缓存读/缓存写」宽 6 + 2）
  // 标签补齐按显示宽（批 10k 遗漏修——padEnd 码元计量下 CJK 双宽标签错位
  // 1 格：缓存读/写行值列比轮次行右凸 1 列）；值列恒右起同列
  const row = (label: string, value: string): string =>
    label + ' '.repeat(Math.max(0, labelCol - stringWidth(label))) + value;
  const lines = [
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
  if (context !== null) {
    lines.push(
      '',
      row(
        '上下文',
        context.max !== null && context.max > 0
          ? `${renderRemainingBar(context.used, context.max)} 剩 ${contextRemainingPercent(
              context.used,
              context.max,
            )}% · ${formatTokensCompact(context.used)} / ${formatTokensCompact(context.max)}`
          : formatTokensCompact(context.used),
      ),
    );
  }
  // 按模型分段（挖掘 44 轮件 A——追加位 = 绝对尾，31 轮 [6] 上下文行之后）：
  // 缺席律 = 分组键 <2 整段缺席（连空行带头行都不出——单模型会话主表已是该
  // 模型的账，重复即噪声；面板与现状逐字节相同）
  const modelRows = summary.byModel;
  if (modelRows !== undefined && modelRows.length >= 2) {
    // 撞尾回落：块内 ≥2 个互异键短名相同（如 zai/glm-4.7 与 fit/glm-4.7）→
    // 该撞名组全部回落全形呈现（防两行同名误读同模型——呈现层规则，数据键不动）
    const shortCounts = new Map<string, number>();
    for (const r of modelRows) {
      const short = modelShortOf(r.model);
      shortCounts.set(short, (shortCounts.get(short) ?? 0) + 1);
    }
    // 呈现名三档：残键「未标识」/ 撞名组全形 / 短名
    const presentName = (r: (typeof modelRows)[number]): string =>
      r.model === '' ? '未标识' : (shortCounts.get(modelShortOf(r.model)) ?? 0) >= 2 ? r.model : modelShortOf(r.model);
    // 块内动态列宽：max(8, 块内最宽呈现名) 帽 24（ellipsize 收口——超帽键有损
    // 呈现，/calls 面板 MODEL_WIDTH 同帽可查全形）；数值三段 + 百分数块内右对齐
    const nameWidth = Math.min(MODEL_COLUMN_CAP, Math.max(8, ...modelRows.map((r) => stringWidth(presentName(r)))));
    const count = (n: number): string => formatCount(n);
    const widthOf = (vals: string[]): number => Math.max(...vals.map((v) => v.length));
    const wIn = widthOf(modelRows.map((r) => count(r.input)));
    const wOut = widthOf(modelRows.map((r) => count(r.output)));
    const wTotal = widthOf(modelRows.map((r) => count(r.totalTokens)));
    const pctOf = (r: (typeof modelRows)[number]): number =>
      summary.totalTokens > 0 ? Math.round((r.totalTokens / summary.totalTokens) * 100) : 0; // 分母 ≤0 防御归 0%（codex 同守卫）
    const wPct = widthOf(modelRows.map((r) => String(pctOf(r))));
    const pad = (v: string, w: number): string => ' '.repeat(Math.max(0, w - v.length)) + v;
    lines.push('', '按模型');
    for (const r of modelRows) {
      // 名列左对齐补齐（显示宽计量）+ 数值三段/百分数块内右对齐
      const name = ellipsize(presentName(r), nameWidth);
      const namePad = ' '.repeat(Math.max(0, nameWidth - stringWidth(name)));
      lines.push(
        `${name}${namePad}输入 ${pad(count(r.input), wIn)} · 输出 ${pad(count(r.output), wOut)} · 合计 ${pad(count(r.totalTokens), wTotal)} · ${pad(String(pctOf(r)), wPct)}%`,
      );
    }
  }
  return lines;
}
