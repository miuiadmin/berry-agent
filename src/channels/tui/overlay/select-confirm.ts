/**
 * 一次性问答面板两枚（07 §4.3）：select / confirm 的主屏浮层实装。
 *
 * - select：↑/↓ 移动高亮、Enter 选定、Esc 取消收 ''（与撤销面保守值同语义）；
 * - confirm：Enter/y 确认 true、Esc/n 取消 false（保守值 = 不动原状态）；
 * - 一次性问答不值得整屏切换——主屏浮层形态（挂 OverlayStack，不进 1049）；
 * - 面板底先铺空格再写内容（写格覆盖下层浮出内容——不写格的位置会透出
 *   主树文字）；
 * - onFinish 单次语义（触发即完成态，后续事件静默——防连按双 resolve）；
 *   关层归装配（onFinish 回调里 close 句柄——裸件不持栈引用）。
 */
import type { CellBuffer, InputEvent, Region, Renderable } from '../../engine/index.js';
import { ACCENT_INDEX } from '../theme.js';
import { ansiColor, type CellStyle } from '../../engine/index.js';
import { prefixDisplayWidth } from '../editor/visual-lines.js';

/** 保守取消值（select——空串与撤销面同语义） */
export const SELECT_CANCELLED = '';

/** 高亮行样式（整行反色——面板内最强存在感） */
const ACTIVE_STYLE: Readonly<CellStyle> = Object.freeze({ inverse: true });
/** 标题样式（accent 定值——theme 单源） */
const TITLE_STYLE: Readonly<CellStyle> = Object.freeze({ fg: ansiColor(ACCENT_INDEX) });
/** 说明段样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });

/** 无修饰单字符 / 命名键匹配 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/** 键事件窄化（其他事件形面板不消费） */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 选项（value 是应答值、label 是呈现、hint 右侧说明段） */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
}

/** select 面板选项集 */
export interface SelectPanelOptions {
  readonly title?: string;
  readonly options: readonly SelectOption[];
}

/**
 * 选择面板：单选浮层。onFinish 后赋（装配在 open 句柄后接线——闭包里关层）。
 */
export class SelectPanel implements Renderable {
  /** 完成回调（Enter 选定 value / Esc 取消收 ''）——装配接线 */
  onFinish?: (value: string) => void;
  private activeIndex = 0;
  private done = false;
  private readonly title: string | undefined;
  private readonly options: readonly SelectOption[];

  constructor(options: SelectPanelOptions) {
    this.title = options.title;
    this.options = options.options;
  }

  /** 量高：标题（有则 1）+ 选项行数（单行制——不折行，超宽截断归渲染） */
  measure(width: number): number {
    void width; // 高与宽无关（截断不折行）
    return (this.title !== undefined ? 1 : 0) + this.options.length;
  }

  /** 落位：铺底空格 → 标题 → 选项行（高亮反色 + 说明右对齐） */
  render(buffer: CellBuffer, region: Region): void {
    // 铺底空格（写格覆盖——未写格会透出主树文字）
    for (let r = 0; r < region.height; r++) {
      for (let c = 0; c < region.width; c++) {
        buffer.setCell(region.row + r, region.col + c, ' ');
      }
    }
    let row = region.row;
    if (this.title !== undefined) {
      buffer.writeText(row, region.col, this.title, TITLE_STYLE);
      row += 1;
    }
    for (let i = 0; i < this.options.length; i++, row++) {
      const active = i === this.activeIndex;
      const option = this.options[i]!;
      // 前缀 + label 段（高亮行整段反色）
      const prefix = active ? '❯ ' : '  ';
      buffer.writeText(row, region.col, `${prefix}${option.label}`, active ? ACTIVE_STYLE : undefined);
      // 说明段右对齐（dim 恒态——不随高亮变脸；按显示宽——CJK 段宽 ≠ 码位数）
      if (option.hint !== undefined && option.hint.length > 0) {
        const hintCols = prefixDisplayWidth(option.hint, option.hint.length);
        buffer.writeText(row, region.col + region.width - hintCols, option.hint, HINT_STYLE);
      }
    }
  }

  /** 事件分发：完成态静默；↑/↓ 循环移动、Enter 选定、Esc 取消 */
  handleEvent(event: InputEvent): boolean {
    const e = asKey(event);
    if (e === null) return true; // 面板占焦——非键事件（文本 / IME / 粘贴）层内终局
    if (e.phase === 'release' || this.done) return true;
    if (e.ctrl || e.alt || e.shift || e.meta) return true;
    if (e.key === 'up') {
      this.activeIndex = this.activeIndex === 0 ? this.options.length - 1 : this.activeIndex - 1;
      return true;
    }
    if (e.key === 'down') {
      this.activeIndex = this.activeIndex === this.options.length - 1 ? 0 : this.activeIndex + 1;
      return true;
    }
    if (e.key === 'enter') {
      this.finish(this.options[this.activeIndex]?.value ?? SELECT_CANCELLED);
      return true;
    }
    if (e.key === 'escape') {
      this.finish(SELECT_CANCELLED);
      return true;
    }
    return true; // 其余键层内终局（模态独占——不穿透）
  }

  /** 单次完成路（触发后锁完成态） */
  private finish(value: string): void {
    if (this.done) return;
    this.done = true;
    this.onFinish?.(value);
  }
}

/** confirm 面板配置 */
export interface ConfirmPanelOptions {
  readonly message: string;
  /** 确认键提示文案（缺省 'enter 确认'） */
  readonly confirmHint?: string;
  /** 取消键提示文案（缺省 'esc 取消'） */
  readonly cancelHint?: string;
}

/**
 * 确认面板：两键问答浮层（Enter/y → true、Esc/n → false——保守值 = 不动原状态）。
 */
export class ConfirmPanel implements Renderable {
  /** 完成回调——装配接线（同 SelectPanel 形） */
  onFinish?: (confirmed: boolean) => void;
  private done = false;
  private readonly message: string;
  private readonly confirmHint: string;
  private readonly cancelHint: string;

  constructor(options: ConfirmPanelOptions) {
    this.message = options.message;
    this.confirmHint = options.confirmHint ?? 'enter 确认';
    this.cancelHint = options.cancelHint ?? 'esc 取消';
  }

  /** 量高：消息 1 + 键提示 1 */
  measure(width: number): number {
    void width;
    return 2;
  }

  /** 落位：铺底空格 → 消息 → 键提示（dim） */
  render(buffer: CellBuffer, region: Region): void {
    for (let r = 0; r < region.height; r++) {
      for (let c = 0; c < region.width; c++) {
        buffer.setCell(region.row + r, region.col + c, ' ');
      }
    }
    buffer.writeText(region.row, region.col, this.message);
    buffer.writeText(region.row + 1, region.col, `${this.confirmHint} · ${this.cancelHint}`, HINT_STYLE);
  }

  /** 事件分发：Enter/y 确认、Esc/n 取消（保守值） */
  handleEvent(event: InputEvent): boolean {
    const e = asKey(event);
    if (e === null) return true;
    if (e.phase === 'release' || this.done) return true;
    if (e.ctrl || e.alt || e.shift || e.meta) return true;
    if (isPlainKey(e, 'enter') || isPlainKey(e, 'y')) {
      this.finish(true);
      return true;
    }
    if (isPlainKey(e, 'escape') || isPlainKey(e, 'n')) {
      this.finish(false);
      return true;
    }
    return true; // 其余键层内终局
  }

  /** 单次完成路 */
  private finish(confirmed: boolean): void {
    if (this.done) return;
    this.done = true;
    this.onFinish?.(confirmed);
  }
}
