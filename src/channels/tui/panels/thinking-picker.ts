/**
 * /thinking 思考档位切换副屏件（2026-09-17 会话档位切换面批 F1——TUI 本地
 * 拦截族）：theme-picker 形选择器——▸ 光标 + enter 选定 + 当前档 ● 标记。
 *
 * - **行集七档**：词表单源 conversation THINKING_LEVELS（off..max——装配位
 *   注入条目，本件只收纯数据行原样呈现）；
 * - **当前档锚**：● 标记判据 = 装配位注入的 current（会话 fold 现值 ?? 栈
 *   基线——boot 未设且无切档事件时 undefined = 诚实无锚）；光标 ▸ 与当前 ●
 *   两记分立（光标独立游走）；
 * - **选定先收副屏再回调**（SessionPicker/ThemePicker 同序律）：onSelect 收
 *   档位词——append durable 事件 + setStatus 回执全归装配闭包，本件零边外面；
 * - **退出键面**：q/Esc 退出（kitty text 'q' 双轨）、Ctrl+C 打断在飞 run
 *   （不退屏）、Ctrl+D 退出进程（先收副屏再转退出柄）——副屏键面件族律。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { fitRowSegments } from '../row-segments.js';
import type { OverlayContent } from '../overlay/overlay.js';

/** 档位条目（装配位从 THINKING_LEVELS 单源合成——本件不 import conversation） */
export interface ThinkingPickEntry {
  /** 档位词（七档之一——onSelect 原样回传） */
  readonly level: string;
  /** 行说明（右段——档位语义短注） */
  readonly detail: string;
}

/** 思考档位选择器装配选项 */
export interface ThinkingPickerOptions {
  /** 条目快照（七档序由装配保证——本件原样呈现） */
  readonly entries: readonly ThinkingPickEntry[];
  /** 当前档（● 标记判据——fold 现值 ?? 栈基线；undefined = 诚实无锚） */
  readonly current: string | undefined;
  /** 选定回调（档位词——先收副屏再回调；append + 回执归装配闭包） */
  readonly onSelect: (level: string) => void;
  readonly sessionId: string;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
}

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 光标行标记（在选行） */
const CURSOR_MARK = '▸';
/** 当前档标记 */
const CURRENT_MARK = '●';

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/**
 * 思考档位选择器内容件（OverlayContent——副屏 root 直收全屏 region；自持
 * 光标与视口窗口，ThemePicker 同基建）。快照档——构造后静态，返回主屏全帧
 * 补显。
 */
export class ThinkingPicker implements OverlayContent {
  private readonly entries: readonly ThinkingPickEntry[];
  private readonly current: string | undefined;
  private readonly onSelect: (level: string) => void;
  private readonly sessionId: string;
  private readonly onExit: () => void;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 光标行（条目下标） */
  private cursor = 0;
  /** 视口首行（光标驱动夹取——七档通常一屏，防御极小终端） */
  private offset = 0;
  /** 视口高实测（render 回写——翻选的页幅依据） */
  private viewportHeight = 1;
  /** 退出闭锁（选定与取消两路共闭——竞发防御位） */
  private exited = false;

  constructor(options: ThinkingPickerOptions) {
    this.entries = options.entries;
    this.current = options.current;
    this.onSelect = options.onSelect;
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
  }

  /** 量高：头行 + 条目全量 + 底行提示（副屏 root 不经布局路——render 按实际 region 窗口化） */
  measure(width: number): number {
    void width;
    return 1 + Math.max(1, this.entries.length) + 1;
  }

  /** 落位：头行 → 条目视口（光标 ▸ + 当前 ● + 档名 / 说明右段）→ 底行提示 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    const head = this.entries.length === 0 ? '◆ 思考档位 · 无条目' : `◆ 思考档位 · ${this.entries.length} 档`;
    buffer.writeText(region.row, region.col, head);
    const viewHeight = Math.max(1, region.height - 2);
    this.viewportHeight = viewHeight;
    this.clampOffset();
    if (this.entries.length === 0) {
      buffer.writeText(region.row + 1, region.col, '（无档位条目——七档词表恒在，此形属装配防御位）', HINT_STYLE);
    } else {
      for (let i = 0; i < viewHeight; i++) {
        const index = this.offset + i;
        if (index >= this.entries.length) break;
        this.renderRow(buffer, region.row + 1 + i, region.col, region.width, index);
      }
    }
    buffer.writeText(
      region.row + region.height - 1,
      region.col,
      this.entries.length === 0
        ? 'q/esc 返回'
        : '↑↓ 移动 · enter 选定（下一 run 起生效；档位是否生效随模型能力） · q/esc 返回',
      HINT_STYLE,
    );
  }

  /** 单行落位：左段（光标 + 当前档标记 + 档名）+ 右段（说明）右对齐 */
  private renderRow(buffer: CellBuffer, row: number, col: number, width: number, index: number): void {
    const entry = this.entries[index]!;
    const right = entry.detail;
    // 左段 = 光标标记 + 当前档标记 + 档名
    const prefix = index === this.cursor ? `${CURSOR_MARK} ` : '  ';
    const mark = this.current !== undefined && entry.level === this.current ? `${CURRENT_MARK} ` : '  ';
    const left = `${prefix}${mark}${entry.level}`;
    // 右段预算律单源：说明先按预算 … 截断再右对齐（窄窗不再负起列劈毁档名）
    const fit = fitRowSegments(left, right, width);
    buffer.writeText(row, col, fit.left);
    if (fit.rightWidth > 0) buffer.writeText(row, col + width - fit.rightWidth, fit.right, HINT_STYLE);
  }

  /** 事件分发（副屏内容终局消费）：Ctrl+C/Ctrl+D 补丁 → 选定/取消 → 移动键 */
  handleEvent(event: InputEvent): boolean {
    if (this.exited) return true; // 闭锁后终局吞——选定/取消后残键零二次回调（生产位副屏已收、本位纯防御）
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
      if (this.entries.length > 0) {
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
          this.cursor = this.entries.length - 1;
          this.clampOffset();
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          const chosen = this.entries[this.cursor]!.level;
          this.exit(); // 先收副屏再选定（append + 回执归装配闭包）
          this.onSelect(chosen);
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
    this.cursor = Math.max(0, Math.min(this.entries.length - 1, this.cursor + delta));
    this.clampOffset();
  }

  /** 视口夹取：光标行恒在窗内（下溢提窗 / 上溢压窗）+ 窗高长高回拉（防首渲染前击键的陈窗深 offset） */
  private clampOffset(): void {
    // 窗高上界：视口长高时 offset 不得深于「尾行恰贴窗底」位（首渲染前击键
    // 会以陈 viewportHeight=1 夹出过深 offset——render 回写真实窗高后回拉）
    const maxOffset = Math.max(0, this.entries.length - this.viewportHeight);
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
