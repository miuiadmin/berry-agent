/**
 * /debug 调试信息副屏件（07 §4.1 命令面增补批——TUI 本地拦截族）：daemon.log
 * 路径 + 尾行快照（帽 50 行、开屏一次只读——活体跟随挂账，/history 快照档
 * 同律）/ log level 生效值 / settings 解析态（有效键清单 + 拒载与坏值 warn
 * 汇总——keybindings 拒载清单与 theme 坏值 warn 的集中面）/ sqlite 路径 /
 * 已装载插件 id 清单。
 *
 * - **凭证/token 恒不入面**（04 §7 敏感件集纪律——serve/daemon.log 属模型
 *   读腿禁读件，人面呈现仍须掩码）：尾行快照过 `maskDaemonLogLines`——
 *   Bearer 形披露行（daemon token 自动生成回执）掩码呈现，呈现边界在本件
 *   执法（面板恒不显 Bearer 形尾段，与装配位传参无关）；
 * - **诚实缺席**：非 daemon 跑法 daemon.log 缺席 / :memory: 无数据目录——
 *   各自如实缺席行，不虚报；
 * - **静态行集 + 退出键面**：快照档同 HelpViewer；q/Esc 退出、Ctrl+C 打断、
 *   Ctrl+D 退出进程——副屏键面补丁三件套与件 8 同律。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { stringWidth } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import type { OverlayContent } from '../overlay/overlay.js';
import { hintLine } from '../keys/hint.js';
import { fitLine } from '../row-segments.js';
import { headStyleOf, sectionHeadLineStyle, VIEWER_HEAD_MARK } from './panel-chrome.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import { DIM_STYLE } from '../../engine/index.js';

/** 调试面板数据快照（装配位现取注入——面板收纯数据行，不触任何边外面） */
export interface DebugPanelData {
  /** daemon.log 路径（null = :memory: 诊断形无数据目录） */
  readonly daemonLogPath: string | null;
  /** 尾行快照（帽 50 由装配位执行；null = 文件缺席——非 daemon 跑法诚实缺席） */
  readonly daemonLogTail: readonly string[] | null;
  /** log level 生效值呈现串（装配位拼好含出处注记——env 原串 / --debug 旗标 / 缺省） */
  readonly logLevel: string;
  /** settings 解析后实存有效键清单（重读收集——空表如实） */
  readonly settingsKeys: readonly string[];
  /** 拒载与坏值 warn 汇总（settings 读面 warn + 键位拒载清单——集中面） */
  readonly settingsWarnings: readonly string[];
  /** sqlite 库路径（':memory:' 如实呈现） */
  readonly sqlitePath: string;
  /** 已装载插件 id 清单（boot.report.activated） */
  readonly pluginIds: readonly string[];
}

/** 调试面板装配选项 */
export interface DebugViewerOptions {
  readonly data: DebugPanelData;
  readonly sessionId: string;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
  /**
   * 主题（界面美化役 2026-10-01 美学批——头行 accent 着色注入位）：缺省
   * DEFAULT_THEME（装配位接线前呈现不缺色——挂账装配）。
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

/** Bearer 形掩码串（daemon token 披露行——尾段以星替，前缀保留可辨识行义） */
const BEARER_MASK = 'Bearer ****';

/**
 * daemon.log 行掩码（纯函数——呈现边界执法）：Bearer 形（`Bearer <token>`）
 * 尾段掩码——daemon token 披露行（serve-daemon 自动生成回执）不再现明文。
 * 与行内其他内容无关（只替换 Bearer 形段）。
 */
export function maskDaemonLogLines(lines: readonly string[]): string[] {
  return lines.map((line) => line.replace(/Bearer\s+\S+/g, BEARER_MASK));
}

/**
 * 调试信息内容件：ScrollView 子类 + OverlayContent（副屏 root）。行集构造后
 * 静态（快照档）。
 */
export class DebugViewer extends ScrollView implements OverlayContent {
  private readonly sessionId: string;
  private readonly onExit: (() => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 退出闭锁（同批多事件只退一次——q 与 Esc 竞发防御位） */
  private exited = false;
  /** 头行 accent 派生样式（theme 注入位——缺省 DEFAULT_THEME） */
  private readonly headStyle: Readonly<CellStyle>;

  constructor(options: DebugViewerOptions) {
    // 界面美化役 2026-10-01 美学批两档 + V-3 注⑨①⑤分诊取色：折行续行 2 空格
    // 悬挂 + 分段头弱线取色 + ⚠ 告警行恒 dim 不混合（`── … ──` 分段线族沿线
    // 色、`⚠ 坏值` 告警族语义色不参与混合——panel-chrome 分诊样式单源）
    const theme = options.theme ?? DEFAULT_THEME;
    super({ hangingIndent: true, lineStyle: sectionHeadLineStyle(theme) });
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.headStyle = headStyleOf(theme);
    this.setLines(buildDebugLines(options.data)); // 行集构造后静态（快照档——data 不留柄）
    this.scrollToTop(); // 开屏锚顶（ScrollView 缺省贴尾为回看器语义——调试首段是运行时头）
  }

  /** 量高：头行 + 视口全量 + 底行提示（副屏 root 不经布局路） */
  measure(width: number): number {
    return 1 + super.measure(width) + 1;
  }

  /** 落位：头行（accent + fitLine 收口）→ 滚动视口（super.render）→ 底行提示（fitLine 收口） */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    // 界面美化役美学注④/⑤：头符 ◉（查看族——⚙ 归工具卡语义族）accent 着色
    // + 非条目行 fitLine 收口
    buffer.writeText(region.row, region.col, fitLine(`${VIEWER_HEAD_MARK} 调试信息`, region.width), this.headStyle);
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
      // Ctrl+C = 打断在飞 run（目标 = 当前交互会话位——件 8 同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.sessionId);
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
 * 调试行集构造（纯函数——测试直锁消费）：运行时段（log level / sqlite /
 * 插件清单）→ daemon.log 段（路径 + 尾行快照——Bearer 形掩码执法在本构造
 * 内，缺席两形各自诚实）→ settings 段（有效键 + warn 汇总）。标签补齐按
 * 显示宽（批 10k 遗漏修同律）。
 */
export function buildDebugLines(data: DebugPanelData): string[] {
  const labelCol = 10; // 标签列宽（最长标签「日志级别/日志路径/数据库路径」宽 8 + 2）
  const row = (label: string, value: string): string =>
    label + ' '.repeat(Math.max(0, labelCol - stringWidth(label))) + value;
  const lines: string[] = [
    '── 运行时 ──',
    row('日志级别', data.logLevel),
    row('数据库路径', data.sqlitePath),
    '',
    `── 已安装插件（${data.pluginIds.length} 个）──`,
  ];
  if (data.pluginIds.length === 0) {
    lines.push('（无已安装插件——--no-plugins 启动或启用清单为空）');
  } else {
    for (const id of data.pluginIds) lines.push(`· ${id}`);
  }
  lines.push('', '── daemon.log ──');
  if (data.daemonLogPath === null) {
    // :memory: 诊断形——无数据目录即无 daemon 面
    lines.push(row('日志路径', '（:memory: 模式——未使用数据目录）'));
  } else {
    lines.push(row('日志路径', data.daemonLogPath));
    if (data.daemonLogTail === null) {
      lines.push('（未以 daemon 方式运行或文件尚未生成——没有 daemon.log）');
    } else {
      // 尾快照头行按实数呈现（帽 50 由装配位 readLogTailLines 执行——短日志
      // 不足帽时如实报实数不虚报；feedback-viewer 导出段「末尾 N 行」同律）
      lines.push(`日志末尾 ${data.daemonLogTail.length} 行（令牌已打码）：`);
      if (data.daemonLogTail.length === 0) {
        lines.push('│ （空文件——尚无日志行）');
      } else {
        for (const line of maskDaemonLogLines(data.daemonLogTail)) lines.push(`│ ${line}`);
      }
    }
  }
  lines.push('', '── settings ──');
  if (data.settingsKeys.length === 0) {
    lines.push(row('有效键', '（无用户配置键——全用默认）'));
  } else {
    lines.push(row('有效键', data.settingsKeys.join('、')));
  }
  if (data.settingsWarnings.length === 0) {
    lines.push('无效配置警告：无');
  } else {
    lines.push('无效配置警告汇总：');
    for (const warning of data.settingsWarnings) lines.push(`⚠ ${warning}`);
  }
  return lines;
}
