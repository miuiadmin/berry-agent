/**
 * /feedback 反馈副屏件（UX ④拍板——2026-09-30 UX 五问题批 + 2026-10-01 界面
 * 美化役批）：run 错误史查看 + 本地诊断包导出。
 *
 * - **本地拦截族**（/exit 批先例）：不进通道核命令表（webui 零污染），词干
 *   恰零参命中即开屏——数据面装配位（tui-entry）单源注入，本件收纯数据行；
 * - **零上报腿**（README 六语零遥测承诺红线——codex「上报维护者」腿不照
 *   搬，功能形态等价：收集 → 打包 → 本地落盘 → 回执给路径）：诊断材料只写
 *   本机文件，界面与导出包内都明示「不会上传」；
 * - **错误史两腿**（durable events 既有读面 queryEvents——零新事件词）：
 *   `assistant/message` 的 errorMessage 腿（错误消息正文）+ `turn/end`
 *   reason=error 腿（agent_end failed 的持久化形）——同轮去重（同轮已有
 *   错误消息正文则不重复合成收尾条目）；
 * - **静态行集 + 退出键面**：快照档同 HelpViewer/GuideViewer（开屏一次扫描，
 *   面板期不追新）；q/Esc 退出、Ctrl+C 打断、Ctrl+D 退出进程——副屏键面
 *   三件套同律；另加 **e = 导出诊断包**（回执行落尾段后跳尾立现）。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { ellipsize, sanitizeDisplayText } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import { shortIdOf } from '../backend/transcript.js';
import type { OverlayContent } from '../overlay/overlay.js';
import { hintLine } from '../keys/hint.js';
import { fitLine } from '../row-segments.js';
import { sanitizeLineText } from '../blocks/tool-card.js';
import { headStyleOf, VIEWER_HEAD_MARK, weakLineStyle } from './panel-chrome.js';
import { maskDaemonLogLines } from './debug-viewer.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import { DIM_STYLE } from '../../engine/index.js';

/** 运行错误史条目（快照行——装配侧扫描产出，面板收纯数据） */
export interface FeedbackErrorEntry {
  /** 事件时间（ms epoch——呈现按本地时区折 MM-DD HH:mm） */
  readonly time: number;
  /** 会话 id（呈现取短 id 8 位） */
  readonly sessionId: string;
  /** 错误全文（呈现截首行、导出包全文——多行保留） */
  readonly text: string;
  /** 来源腿：「message」= 错误消息正文（assistant/message errorMessage）；「turn」= 失败收尾（turn/end reason=error 无正文） */
  readonly source: 'message' | 'turn';
}

/** 反馈面板数据快照（装配位现取注入——面板收纯数据行，不触任何边外面） */
export interface FeedbackPanelData {
  /** 扫描时间范围（天——呈现与导出包同值披露） */
  readonly windowDays: number;
  /** 会话总数（manager.countSessions——范围披露的 N/M 分母） */
  readonly sessionsTotal: number;
  /** 实际扫描会话数（manager.list 近窗行数——范围披露的分子） */
  readonly scannedSessions: number;
  /** 错误史（时间降序——装配位扫描排好序） */
  readonly errors: readonly FeedbackErrorEntry[];
  /** 扫描是否触上限（单会话事件超页帽或条目超帽——诚实截断披露） */
  readonly truncated: boolean;
  /**
   * daemon.log 路径（null = :memory: 无数据目录——诚实缺席形；07 §4.1 V-0
   * 注⑤ daemon.log 随导出件出——/debug 同源数据面）
   */
  readonly daemonLogPath: string | null;
  /**
   * daemon.log 尾行快照（帽 50 由装配位执行；null = 文件缺席〔非 daemon 跑法〕
   * 诚实缺席；行集为日志明文——Bearer 掩码在本件呈现边界执法，与装配位传参无关）
   */
  readonly daemonLogTail: readonly string[] | null;
}

/** 反馈面板装配选项 */
export interface FeedbackViewerOptions {
  readonly data: FeedbackPanelData;
  readonly sessionId: string;
  /**
   * 导出柄（按 e 触发——装配位执行本地落盘并返回回执串；回执入行集前过
   * 单行消毒）。缺席形 e 无动作（防御位——产线装配恒在场）。
   */
  readonly onExport?: () => string;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
  /**
   * 主题（界面美化役 2026-10-01 美学批——头行 accent 着色注入位）：缺省
   * DEFAULT_THEME（装配位接线前呈现不缺色）。
   */
  readonly theme?: ResolvedTheme;
}

/** 扫描源会话行形（结构子集——host 装配位注入 manager.list({}) 投影，channels 不 import persist/host 面） */
export interface FeedbackScanSession {
  readonly id: string;
}

/** 扫描源事件形（结构子集——persist queryEvents 返回 SessionEvent 的投影位：data 为原始 JSON 载荷） */
export interface FeedbackScanEvent {
  readonly type: string;
  readonly time: number;
  readonly data: unknown;
}

/**
 * 单会话事件查询面形（host 装配位注入 store.queryEvents 恒等闭包——结构
 * 兼容即受；channels 侧不 import persist，读面恒经装配注入）。
 */
export type FeedbackScanQuery = (filter: {
  readonly sessionId: string;
  readonly types: readonly string[];
  readonly sinceMs: number;
  readonly limit: number;
}) => { readonly events: readonly FeedbackScanEvent[]; readonly nextCursor: unknown };

/** 反馈副屏数据源集（host 装配位打包注入——扫描/导出全料在此，面板与导出包共用单快照） */
export interface FeedbackScreenSources {
  /** 会话行集（/sessions 同窗语义——manager.list({}) 近窗投影） */
  readonly sessions: readonly FeedbackScanSession[];
  /** 单会话事件查询面（queryEvents 恒等闭包） */
  readonly queryEvents: FeedbackScanQuery;
  /** 扫描起点（ms epoch——近 N 天） */
  readonly sinceMs: number;
  /** 时间范围天数（呈现/导出包披露） */
  readonly windowDays: number;
  /** 单会话事件单页帽（queryEvents 每会话一页——溢出即 truncated） */
  readonly pageLimit: number;
  /** 错误条目帽（呈现与导出包共用——重错误机诚实截断） */
  readonly maxEntries: number;
  /** 会话总数（范围披露分母） */
  readonly sessionsTotal: number;
  /** 环境摘要行集（「标签 值」拼好形——导出包头段专用，面板不呈） */
  readonly env: readonly string[];
  /** daemon.log 路径（null = :memory: 无数据目录；V-0 注⑤ daemon.log 随导出件出） */
  readonly daemonLogPath: string | null;
  /** daemon.log 尾行快照（帽 50 由装配位执行；null = 文件缺席——非 daemon 跑法诚实缺席） */
  readonly daemonLogTail: readonly string[] | null;
  /** 落盘闭包（host 侧 mkdir+write——收导出包全文返回执串） */
  readonly writeFile: (content: string) => string;
}

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = DIM_STYLE;
/** 底行键面提示（e = 导出诊断包——本件独有动作键） */
const HINT_TEXT = hintLine('q/esc 返回', 'e 导出诊断包', '↑↓/pgup/pgdn/home/end 滚动');

/** 错误史条目正文呈现帽（首行截宽——列表可扫读；超宽由 ellipsize 收口，再宽由折行兜底） */
const ENTRY_TEXT_WIDTH = 96;

/** 扫描事件类型集（turn/start 仅作轮界标记供同轮去重） */
const SCAN_TYPES: readonly string[] = ['turn/start', 'assistant/message', 'turn/end'];

/** 失败收尾条目正文（turn/end reason=error 且无错误消息正文——用户面直白词，事件词不外溢） */
const TURN_ERROR_TEXT = '运行失败（未记录错误详情）';

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/** 事件 JSON 载荷窄化读：errorMessage 腿（非空 string 才在场） */
function errorMessageOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const value = (data as { errorMessage?: unknown }).errorMessage;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** 事件 JSON 载荷窄化读：reason 腿 */
function reasonOf(data: unknown): string | undefined {
  if (typeof data !== 'object' || data === null) return undefined;
  const value = (data as { reason?: unknown }).reason;
  return typeof value === 'string' ? value : undefined;
}

/**
 * 错误史扫描（纯函数——测试直锁消费）：逐会话单页查询（types 含轮界标记），
 * 按事件序走——errorMessage 腿即时记条；turn/end reason=error 且本轮无正文
 * 腿才合成失败收尾条（同轮去重）；末按时间降序夹条目帽。截断判据两源：任一
 * 会话页溢出（nextCursor 非空）或条目触帽。
 */
export function scanFeedbackErrors(input: {
  readonly sessions: readonly FeedbackScanSession[];
  readonly queryEvents: FeedbackScanQuery;
  readonly sinceMs: number;
  readonly pageLimit: number;
  readonly maxEntries: number;
}): { readonly errors: FeedbackErrorEntry[]; readonly truncated: boolean } {
  const collected: FeedbackErrorEntry[] = [];
  let truncated = false;
  for (const session of input.sessions) {
    const page = input.queryEvents({
      sessionId: session.id,
      types: SCAN_TYPES,
      sinceMs: input.sinceMs,
      limit: input.pageLimit,
    });
    if (page.nextCursor != null) truncated = true; // 单会话事件超页帽——诚实截断
    let turnSawMessageError = false; // 轮界标记（turn/start 重置——窗口切进半轮时缺省 false）
    for (const event of page.events) {
      if (event.type === 'turn/start') {
        turnSawMessageError = false;
        continue;
      }
      if (event.type === 'assistant/message') {
        const errorMessage = errorMessageOf(event.data);
        if (errorMessage !== undefined) {
          collected.push({ time: event.time, sessionId: session.id, text: errorMessage, source: 'message' });
          turnSawMessageError = true;
        }
        continue;
      }
      if (event.type === 'turn/end' && reasonOf(event.data) === 'error' && !turnSawMessageError) {
        // 失败收尾腿：本轮没有错误消息正文才合成（去重——正文腿信息量覆盖收尾腿）
        collected.push({ time: event.time, sessionId: session.id, text: TURN_ERROR_TEXT, source: 'turn' });
      }
    }
  }
  // 时间降序（稳定排序保同时刻的轮内序——重错误机重时间戳常见）
  collected.sort((a, b) => b.time - a.time);
  if (collected.length > input.maxEntries) {
    collected.length = input.maxEntries; // 条目帽（呈现/导出共用同快照）
    truncated = true;
  }
  return { errors: collected, truncated };
}

/** 时间戳呈现（MM-DD HH:mm 本地时区——session-picker formatStamp 同形，件内私有故本件同形自持） */
export function formatFeedbackStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 错误正文首行（单行消毒 + 帽 96 截宽——多行正文只呈首行，全文进导出包） */
export function firstErrorLine(text: string): string {
  const first = text.split(/\r?\n/, 1)[0] ?? '';
  return ellipsize(sanitizeLineText(first), ENTRY_TEXT_WIDTH);
}

/**
 * 反馈行集构造（纯函数——测试直锁消费）：错误史段（段头带时间范围与条数 +
 * 条目「时间 · 会话短 id · 错误首行」+ 空态/截断披露）→ 诊断导出段（导出
 * 内容与范围说明 + 「不会上传」明示）→ 导出回执段（在场才呈——e 动作后）。
 */
export function buildFeedbackLines(data: FeedbackPanelData, receipt?: string | null): string[] {
  const lines: string[] = [`── 运行错误（近 ${data.windowDays} 天 · ${data.errors.length} 条）──`];
  if (data.errors.length === 0) {
    lines.push(`（近 ${data.windowDays} 天没有运行错误记录）`);
  } else {
    for (const entry of data.errors) {
      lines.push(`${formatFeedbackStamp(entry.time)} · ${shortIdOf(entry.sessionId)} · ${firstErrorLine(entry.text)}`);
    }
    if (data.truncated) {
      lines.push('（部分结果超出扫描上限未列出——以上为最近的错误）');
    }
  }
  lines.push('', '── 诊断导出 ──', '按 e 生成诊断包并保存到本机（不会上传）：');
  lines.push('· 运行错误史（含完整错误文本）');
  lines.push('· 运行环境（版本 / 模型 / 数据目录 / 平台）');
  // daemon 日志清单行在场才列（快照在开屏时已取到——缺席不虚报在列；V-0 注⑤）
  if (data.daemonLogTail !== null) {
    lines.push('· daemon 日志末尾 50 行（令牌已打码）');
  }
  lines.push(`· 范围：近 ${data.windowDays} 天 · 最近 ${data.scannedSessions} 个会话（共 ${data.sessionsTotal} 个）`);
  if (receipt !== undefined && receipt !== null && receipt !== '') {
    lines.push('', '── 导出回执 ──', receipt);
  }
  return lines;
}

/**
 * 诊断包全文构造（纯函数——测试直锁消费；导出包 = 终端外载体，错误正文过
 * sanitizeDisplayText 消毒〔LF 保留供分段〕——OSC 52 类转义不随文件外泄）。
 * 结构：标题与零上报声明 → 环境段 → 范围段 → 错误史段（全文多行保留，收
 * 尾腿如实标注）→ daemon.log 段（V-0 注⑤：尾行快照 Bearer 掩码 + 消毒，
 * 缺席两形诚实披露）。
 */
export function renderFeedbackDiagnosticReport(input: {
  readonly exportedAt: number;
  readonly data: FeedbackPanelData;
  readonly env: readonly string[];
  readonly pageLimit: number;
  readonly maxEntries: number;
}): string {
  const { data } = input;
  const exported = new Date(input.exportedAt);
  const p = (n: number): string => String(n).padStart(2, '0');
  const exportedStamp = `${exported.getFullYear()}-${p(exported.getMonth() + 1)}-${p(exported.getDate())} ${p(exported.getHours())}:${p(exported.getMinutes())}:${p(exported.getSeconds())}`;
  const lines: string[] = [
    '# 诊断包（/feedback 导出）',
    '',
    `导出时间：${exportedStamp}`,
    '本文件由 /feedback 命令在本地生成——内容只保存在本机，不会上传到任何服务器。',
    '',
    '## 环境',
    ...input.env,
    '',
    '## 范围',
    `- 时间：近 ${data.windowDays} 天`,
    `- 会话：最近 ${data.scannedSessions} 个（会话总数 ${data.sessionsTotal}）`,
    `- 上限：单会话事件 ${input.pageLimit} 条 / 错误条目 ${input.maxEntries} 条`,
    `- 截断：${data.truncated ? '是——部分结果超出上限，仅含最近的错误' : '否'}`,
    '',
    `## 运行错误（${data.errors.length} 条，新到旧）`,
  ];
  if (data.errors.length === 0) {
    lines.push(`（近 ${data.windowDays} 天没有运行错误记录）`);
  } else {
    data.errors.forEach((entry, i) => {
      lines.push(
        '',
        `### ${i + 1}. ${formatFeedbackStamp(entry.time)} · 会话 ${shortIdOf(entry.sessionId)}`,
        `- 来源：${entry.source === 'message' ? '错误消息正文' : '运行失败收尾（无错误正文）'}`,
        sanitizeDisplayText(entry.text),
      );
    });
  }
  // daemon.log 段（V-0 注⑤「daemon.log 随导出件出」——钩子/周期路诊断走日志通道，
  // 导出件是它们的承载面）：三形如实——内存模式无数据目录 / 文件缺席（非
  // daemon 跑法）/ 尾行快照（Bearer 掩码 + 消毒——/debug 同律，daemon token
  // 明文恒不入导出包）
  lines.push('', '## daemon.log');
  if (data.daemonLogPath === null) {
    lines.push('（内存模式——无数据目录，没有 daemon.log）');
  } else {
    lines.push(`- 路径：${data.daemonLogPath}`);
    if (data.daemonLogTail === null) {
      lines.push('（未以 daemon 方式运行或文件尚未生成——没有 daemon.log）');
    } else {
      lines.push(`（末尾 ${data.daemonLogTail.length} 行——令牌已打码）`);
      for (const line of maskDaemonLogLines(data.daemonLogTail)) lines.push(`│ ${sanitizeDisplayText(line)}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * 反馈面内容件：ScrollView 子类 + OverlayContent（副屏 root）。行集快照档
 * （开屏扫描一次——data 留柄仅为 e 动作后重建行集，无任何外部柄）。
 */
export class FeedbackViewer extends ScrollView implements OverlayContent {
  private readonly sessionId: string;
  private readonly onExport: (() => string) | undefined;
  private readonly onExit: (() => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 退出闭锁（同批多事件只退一次——q 与 Esc 竞发防御位） */
  private exited = false;
  /** 导出回执（null = 未导出——e 动作后在场，重建行集时并入尾段） */
  private receipt: string | null = null;
  /** 面板数据快照（e 动作后重建行集用——导出柄闭包侧自持同快照） */
  private readonly data: FeedbackPanelData;
  /** 头行 accent 派生样式（theme 注入位——缺省 DEFAULT_THEME） */
  private readonly headStyle: Readonly<CellStyle>;

  constructor(options: FeedbackViewerOptions) {
    // 界面美化役 2026-10-01 美学批两档 + V-3 注⑨①取色承接：折行续行 2 空格悬
    // 挂 + 分段头弱线取色（`── 段题 ──` 分段线族经 panel-chrome 弱线样式——
    // weakRule 在场整行弱线色、键缺席回退 dim）
    const theme = options.theme ?? DEFAULT_THEME;
    super({ hangingIndent: true, lineStyle: weakLineStyle(theme) });
    this.sessionId = options.sessionId;
    this.onExport = options.onExport;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.data = options.data;
    this.headStyle = headStyleOf(theme);
    this.setLines(buildFeedbackLines(options.data));
    this.scrollToTop(); // 开屏锚顶（错误史首条在顶——回看器贴尾语义反）
  }

  /** 量高：头行 + 视口全量 + 底行提示（副屏 root 不经布局路） */
  measure(width: number): number {
    return 1 + super.measure(width) + 1;
  }

  /** 落位：头行（accent + fitLine 收口）→ 滚动视口（super.render）→ 底行提示（fitLine 收口） */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    // 界面美化役美学注④/⑤：头符 ◉（查看族）accent 着色 + 非条目行 fitLine 收口
    buffer.writeText(
      region.row,
      region.col,
      fitLine(`${VIEWER_HEAD_MARK} 反馈 /feedback`, region.width),
      this.headStyle,
    );
    const viewHeight = region.height - 2;
    if (viewHeight > 0) {
      super.render(buffer, { row: region.row + 1, col: region.col, width: region.width, height: viewHeight });
    }
    buffer.writeText(region.row + region.height - 1, region.col, fitLine(HINT_TEXT, region.width), HINT_STYLE);
  }

  /** 事件分发（副屏内容终局消费——键面三件套同律 + e 导出动作键） */
  handleEvent(event: InputEvent): boolean {
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断在飞 run（滤 kitty release——同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.sessionId);
        return true;
      }
      // Ctrl+D = 退出进程（先收副屏再转退出柄——同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd') {
        this.exit();
        this.onQuit?.();
        return true;
      }
      if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) {
        this.exit();
        return true;
      }
      if (isPlainKey(k, 'e')) {
        this.runExport();
        return true;
      }
    }
    if (event.kind === 'text') {
      // kitty disambiguate 轨纯键打字走 text 事件——q/e 两键防御同判
      if (event.text === 'q') {
        this.exit();
        return true;
      }
      if (event.text === 'e') {
        this.runExport();
        return true;
      }
    }
    super.handleEvent(event); // 滚动键（未消费键终局吞——模态独占）
    return true;
  }

  /** 导出动作（e）：柄缺席无动作；柄异常不外抛（回执行诚实呈报失败——副屏事件环不接异常） */
  private runExport(): void {
    if (this.onExport === undefined) return;
    let receipt: string;
    try {
      receipt = this.onExport();
    } catch (err: unknown) {
      receipt = `导出失败：${err instanceof Error ? err.message : String(err)}`;
    }
    // 回执入行集前过单行消毒（回执含落盘路径/异常文本——行集契约是每元素一逻辑行）
    this.receipt = sanitizeLineText(receipt);
    this.setLines(buildFeedbackLines(this.data, this.receipt));
    this.scrollToEnd(); // 回执在尾段——导出动作后跳尾立现（用户按 e 即等为回执）
  }

  /** 退出（闭锁——单次） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }
}
