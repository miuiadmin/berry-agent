/**
 * 一次性问答面板两枚（07 §4.3）：select / confirm 的主屏浮层实装。
 *
 * - select：↑/↓ 移动高亮、Enter 选定、Esc 取消收 ''（与撤销面保守值同语义）；
 *   选项数超视口帽时开滚动窗（fx2-B——光标居中 + 顶/底「↑/↓ N more」指示行，
 *   ViewportCapAware——固定区总高恒 ≤ 截断预算，不触发主屏陈货守卫整段不写）；
 * - confirm：Enter/y 确认 true、Esc/n 取消 false（保守值 = 不动原状态）；
 * - 一次性问答不值得整屏切换——主屏浮层形态（挂 OverlayStack，不进 1049）；
 * - 面板底先铺空格再写内容（写格覆盖下层浮出内容——不写格的位置会透出
 *   主树文字）；
 * - onFinish 单次语义（触发即完成态，后续事件静默——防连按双 resolve）；
 *   关层归装配（onFinish 回调里 close 句柄——裸件不持栈引用）。
 */
import type { CellBuffer, InputEvent, Region, Renderable } from '../../engine/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import type { CellStyle } from '../../engine/index.js';
import { stringWidth, truncateToWidth } from '../../engine/index.js';

/** 保守取消值（select——空串与撤销面同语义） */
export const SELECT_CANCELLED = '';

/** 高亮行样式（整行反色——面板内最强存在感） */
const ACTIVE_STYLE: Readonly<CellStyle> = Object.freeze({ inverse: true });
/** 说明段样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });

/**
 * 单行左右双段预算排版（market-picker renderRow 预算律同款——2026-09-20
 * TUI 视觉品质战役·组 2 修 finding C）：右段（hint）先按预算截成 … 省略形
 * 再右对齐——极长右段按原宽右对齐会把起列推成负值（CellGrid 越界静默吸收
 * 首段、余段从行首覆写整行——生产链 fs 写审批「总是批准」行 label 被路径
 * hint 劈半灭失的同根坏形）；左段（前缀 + label）以右段实占后余宽为帽 …
 * 收口。两段各自整字截断（truncateToWidth——不撕宽字符）。
 */
function fitRowSegments(
  left: string,
  right: string | undefined,
  width: number,
): { left: string; right: string; rightWidth: number } {
  // 左段保留位 = 左段宽与半窗取小（右段预算的下限保证——label 至多让半窗）
  const leftReserve = Math.max(0, Math.min(stringWidth(left), Math.floor(width / 2)));
  const rightBudget = right !== undefined && right.length > 0 ? Math.max(0, width - 1 - leftReserve) : 0;
  const rightFull = right ?? '';
  const fittedRight =
    rightBudget === 0 || stringWidth(rightFull) <= rightBudget
      ? rightFull
      : `${truncateToWidth(rightFull, Math.max(0, rightBudget - 1))}…`;
  const rightWidth = stringWidth(fittedRight);
  // 左段帽 = 总宽 - 右段实占 - 间隔 1 列（无右段即总宽；右段已按预算截断，
  // 此处帽内通常已适——label 自身极长时 … 收口）
  const maxLeft = rightWidth > 0 ? width - rightWidth - 1 : width;
  const fittedLeft = stringWidth(left) <= maxLeft ? left : `${truncateToWidth(left, Math.max(0, maxLeft - 1))}…`;
  return { left: fittedLeft, right: fittedRight, rightWidth };
}

/** 单段超宽 … 收口（title / message 呈现帽——裸裁会静默丢失段尾无省略形） */
function ellipsize(text: string, width: number): string {
  return stringWidth(text) <= width ? text : `${truncateToWidth(text, Math.max(0, width - 1))}…`;
}

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

/**
 * 视口帽感知面板协议（fx2-B）：装配层（renderFixed）栈低到高逐层注入「本层
 * 可用高帽」——支持本协议的面板在选项数超帽时开滚动窗自适收缩，固定区总高
 * 恒 ≤ 截断预算（绝不让固定区超高触发 MainScreen 陈货守卫整段不写——模态
 * 开屏即黑）。未实现本协议的面板（ConfirmPanel 等矮面板）不受扰恒满高。
 */
export interface ViewportCapAware {
  /** 可用高帽（行——重复注入按最新值收敛；帽内恒满高原样呈现） */
  setMaxHeight(rows: number): void;
}

/** select 面板选项集 */
export interface SelectPanelOptions {
  readonly title?: string;
  readonly options: readonly SelectOption[];
  /** 主题（一次性面板构造期定值——accent 派生标题样式；缺省 = DEFAULT_THEME） */
  readonly theme?: ResolvedTheme;
}

/**
 * 选择面板：单选浮层。onFinish 后赋（装配在 open 句柄后接线——闭包里关层）。
 *
 * 视口帽（fx2-B——ViewportCapAware 实装）：选项数超帽时开滚动窗——光标
 * 居中可视 + 顶/底「↑ N more」/「↓ N more」指示行（隐藏侧才显）；键面与
 * 选值语义不变（窗口只是呈现取景，activeIndex 恒在全集上移动）。
 */
export class SelectPanel implements Renderable, ViewportCapAware {
  /** 完成回调（Enter 选定 value / Esc 取消收 ''）——装配接线 */
  onFinish?: (value: string) => void;
  private activeIndex = 0;
  private done = false;
  private readonly title: string | undefined;
  private readonly options: readonly SelectOption[];
  /** 标题样式（accent 派生——构造期主题定值，一次性面板无换装面） */
  private readonly titleStyle: Readonly<CellStyle>;
  /** 视口帽（null = 未注入——恒满高不窗口化；装配层逐帧注入最新值） */
  private maxHeight: number | null = null;

  constructor(options: SelectPanelOptions) {
    this.title = options.title;
    this.options = options.options;
    this.titleStyle = Object.freeze({ fg: (options.theme ?? DEFAULT_THEME).accent });
  }

  /** 帽注入（ViewportCapAware——renderFixed 栈低到高逐层调用） */
  setMaxHeight(rows: number): void {
    this.maxHeight = rows;
  }

  /**
   * 取景窗口（measure / render 单源）：未超帽恒全景；超帽开窗——窗行 =
   * 帽 - 标题行 - 上下指示行 2（下限 1——光标行恒可视），窗顶 = 光标 -
   * 半窗居中钳 [0, 末窗顶]；above/below = 窗外隐藏数（指示行渲染依据）。
   */
  private view(): { windowed: boolean; titleRows: number; start: number; count: number; above: number; below: number } {
    const titleRows = this.title !== undefined ? 1 : 0;
    const total = this.options.length;
    const full = titleRows + total;
    if (this.maxHeight === null || full <= this.maxHeight) {
      return { windowed: false, titleRows, start: 0, count: total, above: 0, below: 0 };
    }
    const count = Math.max(1, this.maxHeight - titleRows - 2); // 1 = 光标行保底
    // 光标居中（半窗偏移钳窗界——首项贴顶 / 末项沉底自然涌现）
    const start = Math.min(Math.max(0, this.activeIndex - Math.floor(count / 2)), Math.max(0, total - count));
    return { windowed: true, titleRows, start, count, above: start, below: Math.max(0, total - start - count) };
  }

  /** 量高：标题（有则 1）+ 选项行数（超帽窗口化——实显窗行 + 实显指示行） */
  measure(width: number): number {
    void width; // 高与宽无关（截断不折行）
    const v = this.view();
    if (!v.windowed) return v.titleRows + this.options.length;
    // 帽内如实（实显指示行才计——above/below 隐藏侧为 0 时不占行）
    return Math.min(
      Math.max(1, this.maxHeight ?? 1),
      v.titleRows + v.count + (v.above > 0 ? 1 : 0) + (v.below > 0 ? 1 : 0),
    );
  }

  /** 落位：铺底空格 → 标题 →（窗口化时顶指示）→ 选项行（窗内切片）→（底指示） */
  render(buffer: CellBuffer, region: Region): void {
    // 铺底空格（写格覆盖——未写格会透出主树文字）
    for (let r = 0; r < region.height; r++) {
      for (let c = 0; c < region.width; c++) {
        buffer.setCell(region.row + r, region.col + c, ' ');
      }
    }
    const v = this.view();
    const bottom = region.row + region.height; // 区域界（防御——measure 钳帽后行数可少于内容需求）
    let row = region.row;
    if (this.title !== undefined && row < bottom) {
      // 标题超宽 … 收口（区域 = 全终端宽——无帽裸裁会静默丢失段尾）
      buffer.writeText(row, region.col, ellipsize(this.title, region.width), this.titleStyle);
      row += 1;
    }
    if (v.windowed && v.above > 0 && row < bottom) {
      buffer.writeText(row, region.col, `↑ ${v.above} more`, HINT_STYLE);
      row += 1;
    }
    const end = v.start + v.count;
    for (let i = v.start; i < end && row < bottom; i++, row++) {
      const active = i === this.activeIndex;
      const option = this.options[i]!;
      // 前缀 + label 段（高亮行整段反色）
      const prefix = active ? '❯ ' : '  ';
      // 行预算排版：label 段与 hint 段各自 … 收口不交叠——极长 hint 原宽右
      // 对齐会负起列覆写整行（生产链 fs 写审批路径 hint 的修前坏形）
      const { left, right, rightWidth } = fitRowSegments(`${prefix}${option.label}`, option.hint, region.width);
      buffer.writeText(row, region.col, left, active ? ACTIVE_STYLE : undefined);
      // 说明段右对齐（dim 恒态——不随高亮变脸；按显示宽——CJK 段宽 ≠ 码位数）
      if (rightWidth > 0) {
        buffer.writeText(row, region.col + region.width - rightWidth, right, HINT_STYLE);
      }
    }
    if (v.windowed && v.below > 0 && row < bottom) {
      buffer.writeText(row, region.col, `↓ ${v.below} more`, HINT_STYLE);
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
    // 消息与键提示行超宽 … 收口（区域 = 全终端宽——无帽裸裁静默丢段尾）
    buffer.writeText(region.row, region.col, ellipsize(this.message, region.width));
    buffer.writeText(
      region.row + 1,
      region.col,
      ellipsize(`${this.confirmHint} · ${this.cancelHint}`, region.width),
      HINT_STYLE,
    );
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
