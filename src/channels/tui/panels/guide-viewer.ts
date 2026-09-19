/**
 * /guide 快速上手参考副屏件（07 §8.5 第 2 条——TUI 本地拦截族 2026-09-19
 * 启动版本检查批）：版本 + 核心命令清单 + 文档地图 + 升级/卸载一句。
 *
 * - **本地拦截族**（/exit 批先例）：不进通道核命令表（webui 零污染），词干
 *   恰零参命中即开屏——内容行装配位（tui-entry）单源注入，本件收纯数据行；
 * - **静态行集**（快照档——StatusViewer 同律：构造后静态，返回主屏全帧补显）；
 * - **退出键面**：q/Esc 退出、Ctrl+C 打断、Ctrl+D 退出进程（先收副屏再转
 *   退出柄）——副屏键面三件套同律。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { ScrollView } from '../scroll/scroll-view.js';
import type { OverlayContent } from '../overlay/overlay.js';

/** 指南段（标题 + 行集——装配位定段序与文案单源） */
export interface GuideSection {
  readonly title: string;
  readonly lines: readonly string[];
}

/** 指南面板数据快照（装配位现取注入——面板收纯数据行，不触任何边外面） */
export interface GuidePanelData {
  /** 宿主版本（装配 options.version） */
  readonly version: string;
  /** 段集（快速上手 / 核心命令 / 文档地图 / 升级与卸载——段序归装配位） */
  readonly sections: readonly GuideSection[];
}

/** 指南面板装配选项 */
export interface GuideViewerOptions {
  readonly data: GuidePanelData;
  /** 打断柄锚会话位（host 级面——不呈会话段，柄与会话解耦） */
  readonly sessionId: string;
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
 * 快速上手参考内容件：ScrollView 子类 + OverlayContent（副屏 root）。行集
 * 构造后静态（快照档——StatusViewer 同律）。
 */
export class GuideViewer extends ScrollView implements OverlayContent {
  private readonly sessionId: string;
  private readonly onExit: (() => void) | undefined;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 退出闭锁（同批多事件只退一次——q 与 Esc 竞发防御位） */
  private exited = false;

  constructor(options: GuideViewerOptions) {
    super(); // 无 maxHeight——副屏 root 直收 region 全高
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.setLines(buildGuideLines(options.data));
    this.scrollToTop(); // 开屏锚顶（首段是上手指引——回看器贴尾语义反）
  }

  /** 量高：头行 + 视口全量 + 底行提示（副屏 root 不经布局路） */
  measure(width: number): number {
    return 1 + super.measure(width) + 1;
  }

  /** 落位：头行 → 滚动视口（super.render）→ 底行提示 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    buffer.writeText(region.row, region.col, '◉ 快速上手 /guide');
    const viewHeight = region.height - 2;
    if (viewHeight > 0) {
      super.render(buffer, { row: region.row + 1, col: region.col, width: region.width, height: viewHeight });
    }
    buffer.writeText(region.row + region.height - 1, region.col, HINT_TEXT, HINT_STYLE);
  }

  /** 事件分发（副屏内容终局消费——键面同 StatusViewer 三件套） */
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
 * 指南行集构造（纯函数——测试直锁消费）：首段版本行 → 各段「── 标题 ──」
 * 分隔头 + 行集（段间空行）。段序与文案真源归装配位，本函数只做拼接形。
 */
export function buildGuideLines(data: GuidePanelData): string[] {
  const lines: string[] = [`版本 version    ${data.version}`, ''];
  for (const section of data.sections) {
    lines.push(`── ${section.title} ──`);
    lines.push(...section.lines);
    lines.push('');
  }
  return lines;
}
