/**
 * /status 状态汇总副屏件（07 §4.1 命令面增补批——TUI 本地拦截族）：版本 /
 * 模型位（当前 + 全集计数——ctrl+p 模型循环同数据源）/ 会话（短 id / cwd
 * 短名 / 轮次）/ 数据目录 / theme 生效档 / env 三键白名单。
 *
 * - **本地拦截族**（/exit 批先例）：不进通道核命令表（webui 零污染），词干
 *   恰零参命中即开屏——数据快照装配位现取注入（开屏一次快照档）；
 * - **静态行集**（快照档——HelpViewer 同律：构造后静态，返回主屏全帧补显）；
 * - **凭证恒不入面**（04 §7 白名单制纪律）：env 行恒只 BERRY_AGENT_MODEL /
 *   BERRY_AGENT_DATA_DIR / BERRY_AGENT_LOG_LEVEL 三键——其余 env（含
 *   token 形）不在本面行集内；
 * - **退出键面**：q/Esc 退出、Ctrl+C 打断、Ctrl+D 退出进程（先收副屏再转
 *   退出柄）——副屏键面补丁三件套与件 8 同律。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { stringWidth } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import { shortIdOf } from '../backend/transcript.js';
import type { OverlayContent } from '../overlay/overlay.js';

/** env 旋钮生效值条目（白名单三键——装配位定键序；null = 未设） */
export interface StatusEnvEntry {
  readonly key: string;
  readonly value: string | null;
}

/** 状态面板数据快照（装配位现取注入——面板收纯数据行，不触任何边外面） */
export interface StatusPanelData {
  /** 宿主版本（装配 options.version——缺席 = '0.0.0' 基线） */
  readonly version: string;
  /** 当前模型（provider/model 形——栈级旋钮现值） */
  readonly model: string;
  /** 模型全集计数（providers × models 装配序全列——ctrl+p 循环宇宙同源） */
  readonly modelCount: number;
  /** 会话 id（短 id 呈现位——面板内 shortIdOf） */
  readonly sessionId: string;
  /** 工作区短名（cwd basename） */
  readonly cwdLabel: string;
  /** 轮次（会话 events fold——/usage 同数据源） */
  readonly turns: number;
  /** 数据目录（null = :memory: 诊断形——诚实缺席行呈现） */
  readonly dataDir: string | null;
  /** theme 生效档（dark/light/auto——settings 档位非探测结果） */
  readonly theme: string;
  /** env 三键生效值（白名单制——恒三键，缺席值 null 呈现「未设」） */
  readonly env: readonly StatusEnvEntry[];
}

/** 状态面板装配选项 */
export interface StatusViewerOptions {
  readonly data: StatusPanelData;
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

/**
 * 状态汇总内容件：ScrollView 子类 + OverlayContent（副屏 root）。行集构造后
 * 静态（快照档）。
 */
export class StatusViewer extends ScrollView implements OverlayContent {
  private readonly data: StatusPanelData;
  private readonly onExit: (() => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 退出闭锁（同批多事件只退一次——q 与 Esc 竞发防御位） */
  private exited = false;

  constructor(options: StatusViewerOptions) {
    super(); // 无 maxHeight——副屏 root 直收 region 全高
    this.data = options.data;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.setLines(buildStatusLines(options.data));
    this.scrollToTop(); // 开屏锚顶（ScrollView 缺省贴尾为回看器语义——状态首段是运行时头）
  }

  /** 量高：头行 + 视口全量 + 底行提示（副屏 root 不经布局路） */
  measure(width: number): number {
    return 1 + super.measure(width) + 1;
  }

  /** 落位：头行 → 滚动视口（super.render）→ 底行提示 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    buffer.writeText(region.row, region.col, `◉ 状态汇总 · 会话 ${shortIdOf(this.data.sessionId)}`);
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
      // Ctrl+C = 打断在飞 run（滤 kitty release——件 8 同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.data.sessionId);
        return true;
      }
      // Ctrl+D = 退出进程（先收副屏再转退出柄——件 8 同律）
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
      this.exit(); // kitty disambiguate 轨纯键打字走 text 事件——key 路防御同判
      return true;
    }
    super.handleEvent(event); // 滚动键（未消费键终局吞——模态独占）
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
 * 状态行集构造（纯函数——测试直锁消费）：运行时段（版本 / 模型 + 全集计数）
 * → 会话段（短 id / cwd 短名 / 轮次）→ 环境段（数据目录 / theme 档 / env
 * 三键——白名单制，缺席值「未设」）。标签补齐按显示宽（批 10k 遗漏修同律
 * ——CJK 双宽标签 padEnd 码元计量会错位 1 格）。
 */
export function buildStatusLines(data: StatusPanelData): string[] {
  const labelCol = 18; // 标签列宽（段内对齐——最长「数据目录 dataDir」+ 2）
  const row = (label: string, value: string): string =>
    label + ' '.repeat(Math.max(0, labelCol - stringWidth(label))) + value;
  const lines: string[] = [
    '── 运行时 ──',
    row('版本 version', data.version),
    row(
      '模型 model',
      data.modelCount > 0 ? `${data.model}（全集 ${data.modelCount} 档）` : `${data.model}（模型目录空）`,
    ),
    '',
    '── 会话 ──',
    row('会话 session', shortIdOf(data.sessionId)),
    row('工作区 cwd', data.cwdLabel),
    row('轮次 turns', `${data.turns}`),
    '',
    '── 环境 ──',
    row('数据目录 dataDir', data.dataDir ?? '（:memory: 诊断形——数据目录缺席）'),
    row('主题 theme', data.theme),
  ];
  // env 三键（白名单制——键名本身即标签，值列对齐独立于 CJK 标签段）
  const envKeyCol = 24; // 最长键 BERRY_AGENT_LOG_LEVEL（21）+ 3
  for (const entry of data.env) {
    lines.push(entry.key + ' '.repeat(Math.max(0, envKeyCol - stringWidth(entry.key))) + (entry.value ?? '未设'));
  }
  return lines;
}
