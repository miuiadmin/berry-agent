/**
 * /help 帮助副屏件（07 §4.1 R7 批 10k——形态随 10k 定：副屏，命令册 + 键位册
 * 双源静态行集；ScrollView 装载滚动，HistoryViewer 同基建同键面）。
 *
 * - **双源内容**（R7 条款「内容源双册」；07 §4.1 命令面增补批扩读三源）：
 *   命令册 = 通道核命令注册面 + TUI 本地命令族（/status /debug /skills 等
 *   副屏/瞬时交互族——本地拦截不进通道核命令表）+ TUI 本地退出词（装配位
 *   合流注入）；键位册 = Keymap.actions 投影（解析后当前键集——用户覆盖
 *   生效形随动，按域分组呈现）；
 * - **静态行集**（快照档——同件 8 回看器快照律：构造后静态，返回主屏
 *   全帧补显；活体跟随挂账同源）；
 * - **退出键面**：q/Esc 退出、Ctrl+C 打断、Ctrl+D 退出进程（先收副屏再转
 *   退出柄）——副屏键面补丁三件套与件 8 同律。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import { shortIdOf } from '../backend/transcript.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type { ActionScope, ActionView } from '../keys/registry.js';

/** 命令册条目（装配位合流注入——通道核命令表 + TUI 本地命令族 + TUI 本地退出词） */
export interface HelpCommandEntry {
  readonly name: string;
  readonly description?: string;
}

/** 帮助面装配选项 */
export interface HelpViewerOptions {
  /** 命令册（name 无斜杠——本件拼 '/'） */
  readonly commands: readonly HelpCommandEntry[];
  /** 键位册（Keymap.actions 投影——解析后生效键集） */
  readonly actions: readonly ActionView[];
  readonly sessionId: string;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
}

/** 域分组呈现名（键位册分组头——ActionScope 中文呈现单源） */
const SCOPE_LABELS: Readonly<Record<ActionScope, string>> = Object.freeze({
  global: '全局',
  thinking: '思考块',
  tools: '工具卡',
  editor: '编辑器',
});

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 底行键面提示 */
const HINT_TEXT = 'q/esc 返回 · ↑↓/pgup/pgdn/home/end 滚动';

/** key 事件窄化（text/ime/paste 归各分路） */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/**
 * 帮助面内容件：ScrollView 子类 + OverlayContent（副屏 root——render 直收
 * 全屏 region）。行集构造后静态（快照档）。
 */
export class HelpViewer extends ScrollView implements OverlayContent {
  private readonly sessionId: string;
  private readonly onExit: (() => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 退出闭锁（同批多事件只退一次——q 与 Esc 竞发防御位） */
  private exited = false;

  constructor(options: HelpViewerOptions) {
    super(); // 无 maxHeight——副屏 root 直收 region 全高
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.setLines(buildHelpLines(options.commands, options.actions));
    this.scrollToTop(); // 开屏锚顶（ScrollView 缺省贴尾为回看器语义——帮助册首段是命令头）
  }

  /** 量高：头行 + 视口全量 + 底行提示（副屏 root 不经布局路） */
  measure(width: number): number {
    return 1 + super.measure(width) + 1;
  }

  /** 落位：头行 → 滚动视口（super.render）→ 底行提示 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    const head = `❓ 命令与键位帮助 · 会话 ${shortIdOf(this.sessionId)}`;
    buffer.writeText(region.row, region.col, head);
    const viewHeight = region.height - 2;
    if (viewHeight > 0) {
      super.render(buffer, { row: region.row + 1, col: region.col, width: region.width, height: viewHeight });
    }
    buffer.writeText(region.row + region.height - 1, region.col, HINT_TEXT, HINT_STYLE);
  }

  /**
   * 事件分发（副屏内容终局消费）：Ctrl+C/Ctrl+D 副屏键面补丁 → 常态退出键
   * （q/Esc）→ 滚动键（ScrollView）。
   */
  handleEvent(event: InputEvent): boolean {
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断在飞 run（滤 kitty release——件 8 同律）
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
 * 帮助行集构造（纯函数——测试直锁消费）：命令册段（/name 对齐 + 描述）+
 * 键位册段（按域分组，键集对齐 + 标签；全局域条目带不可覆盖注记）。
 */
export function buildHelpLines(commands: readonly HelpCommandEntry[], actions: readonly ActionView[]): string[] {
  const lines: string[] = [];
  // 命令册段：名列对齐（最宽名 + 2，帽 24——超宽名独行列）
  const nameCol = Math.min(24, Math.max(...commands.map((c) => c.name.length), 0) + 2);
  lines.push('── 命令 ──');
  if (commands.length === 0) lines.push('（无在册命令）');
  for (const cmd of commands) {
    const label = `/${cmd.name}`;
    lines.push(`${label.padEnd(nameCol)}${cmd.description ?? ''}`.trimEnd());
  }
  // 键位册段：按域分组（册序内首见建组——ACTION_CATALOG 已按域聚集）
  lines.push('', '── 键位 ──');
  const keyCol = Math.min(28, Math.max(...actions.map((a) => a.keys.join(' / ').length), 0) + 2);
  let currentScope: ActionScope | null = null;
  for (const action of actions) {
    if (action.scope !== currentScope) {
      currentScope = action.scope;
      lines.push(`· ${SCOPE_LABELS[action.scope]}`);
    }
    const keys = action.keys.join(' / ');
    const note = action.scope === 'global' ? '（不可覆盖）' : '';
    lines.push(`${keys.padEnd(keyCol)}${action.label}${note}`.trimEnd());
  }
  return lines;
}
