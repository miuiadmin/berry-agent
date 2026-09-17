/**
 * /sessions 会话切换副屏件（07 §4.1 R7 批 10k——选定走 registry.focus()
 * 既有权威路〔通道核闭包注入 onSelect〕；本件只呈现清单与光标选择）。
 *
 * - **光标行选择**（与回看器滚动模型分立的选择模型）：↑/↓ 移动光标
 *   （PgUp/PgDn 翻选、Home/End 到首尾），Enter 选定 → 先收副屏再 onSelect
 *   （切焦异步 repaint 与收屏两序皆收敛——挂起闸/复起全帧重画各担一形）；
 * - **行呈现**：光标标记 ▸ + 活跃位 ●（进程内 driver 在场）+ 标题（缺席
 *   如实「（无题）」）+ 右侧时间（MM-DD HH:mm——呈现位确定性）与会话短
 *   id；超宽整字截断（左段适配剩余宽——CJK 双宽不产半字）；
 * - **滚动**：光标驱动的窗口滚动（光标恒可见——offset 跟随夹取），非
 *   ScrollView 的自由滚动（选择模型下两者合一更直）；
 * - **退出键面**：q/Esc 取消退出、Ctrl+C 打断、Ctrl+D 退出进程（先收副屏
 *   再转退出柄）——副屏键面补丁三件套与件 8 同律。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { stringWidth, truncateToWidth } from '../../engine/index.js';
import { shortIdOf } from '../backend/transcript.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type { UiSessionSummary } from '../../../contracts/index.js';

/** 切换器装配选项 */
export interface SessionPickerOptions {
  /** 会话清单（装配序——最新在前；空表如实呈现「无会话」行） */
  readonly sessions: readonly UiSessionSummary[];
  /** 选定回调（通道核闭包——registry.focus() 既有权威路） */
  readonly onSelect: (sessionId: string) => void;
  readonly onExit: () => void;
  /** 打断在飞 run（打断目标 = 当前聚焦会话——装配闭包自知，非光标行） */
  readonly onInterrupt?: () => void;
  readonly onQuit?: () => void;
}

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 光标行标记（在选行） */
const CURSOR_MARK = '▸';
/** 活跃位标记（进程内 driver 在场） */
const ACTIVE_MARK = '●';

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/** 活动时间呈现（MM-DD HH:mm——呈现位确定性形；本地时区显示档） */
function formatStamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 会话切换器内容件（OverlayContent——副屏 root 直收全屏 region；自持
 * 光标与视口窗口，非 ScrollView〔选择模型与滚动合一〕）。
 */
export class SessionPicker implements OverlayContent {
  private readonly sessions: readonly UiSessionSummary[];
  private readonly onSelect: (sessionId: string) => void;
  private readonly onExit: () => void;
  private readonly onInterrupt: (() => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 光标行（清单下标；空表恒 0） */
  private cursor = 0;
  /** 视口首行（光标驱动夹取） */
  private offset = 0;
  /** 视口高实测（render 回写——翻选的页幅依据） */
  private viewportHeight = 1;
  /** 退出闭锁（选定与取消两路共闭——竞发防御位） */
  private exited = false;

  constructor(options: SessionPickerOptions) {
    this.sessions = options.sessions;
    this.onSelect = options.onSelect;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
  }

  /** 量高：头行 + 清单全量 + 底行提示（副屏 root 不经布局路——render 按实际 region 窗口化） */
  measure(width: number): number {
    void width;
    return 1 + Math.max(1, this.sessions.length) + 1;
  }

  /** 落位：头行 → 清单视口（光标行标记 + 活跃位 + 标题左段 / 时间·短 id 右段）→ 底行提示 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    const head = this.sessions.length === 0 ? '⇄ 会话切换 · 无会话' : `⇄ 会话切换 · ${this.sessions.length} 会话`;
    buffer.writeText(region.row, region.col, head);
    const viewHeight = Math.max(1, region.height - 2);
    this.viewportHeight = viewHeight;
    this.clampOffset();
    if (this.sessions.length === 0) {
      buffer.writeText(region.row + 1, region.col, '（无会话）', HINT_STYLE);
    } else {
      for (let i = 0; i < viewHeight; i++) {
        const index = this.offset + i;
        if (index >= this.sessions.length) break;
        this.renderRow(buffer, region.row + 1 + i, region.col, region.width, index);
      }
    }
    buffer.writeText(
      region.row + region.height - 1,
      region.col,
      this.sessions.length === 0 ? 'q/esc 返回' : '↑↓ 移动 · enter 切焦 · q/esc 返回',
      HINT_STYLE,
    );
  }

  /** 单行落位：左段（光标 + 活跃位 + 标题——适配剩余宽截断）+ 右段（时间 短id）右对齐 */
  private renderRow(buffer: CellBuffer, row: number, col: number, width: number, index: number): void {
    const session = this.sessions[index]!;
    const right = `${formatStamp(session.updatedAt)} ${shortIdOf(session.id)}`;
    const rightWidth = stringWidth(right);
    const rightCol = col + width - rightWidth;
    // 左段 = 光标标记 + 活跃位 + 标题；截断帽 = 剩余宽 - 间隔 1 列
    const prefix = index === this.cursor ? `${CURSOR_MARK} ` : '  ';
    const title = session.title !== undefined && session.title !== '' ? session.title : '（无题）';
    const left = `${prefix}${session.active ? ACTIVE_MARK : ' '} ${title}`;
    const maxLeft = width - rightWidth - 1;
    const fitLeft = stringWidth(left) <= maxLeft ? left : `${truncateToWidth(left, Math.max(0, maxLeft - 1))}…`;
    buffer.writeText(row, col, fitLeft);
    buffer.writeText(row, rightCol, right, HINT_STYLE);
  }

  /** 事件分发（副屏内容终局消费）：Ctrl+C/Ctrl+D 补丁 → 选定/取消 → 移动键 */
  handleEvent(event: InputEvent): boolean {
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        // Ctrl+C = 打断在飞 run（目标 = 当前聚焦会话——装配闭包自知）
        this.onInterrupt?.();
        return true;
      }
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd') {
        this.exit();
        this.onQuit?.();
        return true;
      }
      if (this.sessions.length > 0) {
        if (isPlainKey(k, 'up')) {
          this.moveCursor(-1);
          return true;
        }
        if (isPlainKey(k, 'down')) {
          this.moveCursor(1);
          return true;
        }
        if (isPlainKey(k, 'pageup')) {
          this.moveCursor(-this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'pagedown')) {
          this.moveCursor(this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'home')) {
          this.cursor = 0;
          this.clampOffset();
          return true;
        }
        if (isPlainKey(k, 'end')) {
          this.cursor = this.sessions.length - 1;
          this.clampOffset();
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          const chosen = this.sessions[this.cursor]!;
          this.exit(); // 先收副屏（切焦 repaint 异步到达——收屏与重画两序皆收敛）
          this.onSelect(chosen.id);
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

  /** 光标移动（越界夹取——不循环；移动后光标恒可见） */
  private moveCursor(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.sessions.length - 1, this.cursor + delta));
    this.clampOffset();
  }

  /** 视口夹取：光标行恒在窗内（下溢提窗 / 上溢压窗） */
  private clampOffset(): void {
    // 窗高上界：视口长高时 offset 不得深于「尾行恰贴窗底」位（首渲染前击键
    // 会以陈 viewportHeight=1 夹出过深 offset——render 回写真实窗高后回拉）
    const maxOffset = Math.max(0, this.sessions.length - this.viewportHeight);
    if (this.offset > maxOffset) this.offset = maxOffset;
    if (this.cursor < this.offset) this.offset = this.cursor;
    else if (this.cursor >= this.offset + this.viewportHeight) {
      this.offset = this.cursor - this.viewportHeight + 1;
    }
  }

  /** 退出（闭锁——选定与取消单次收口） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }
}
