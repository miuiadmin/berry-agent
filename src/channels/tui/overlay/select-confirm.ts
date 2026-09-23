/**
 * 一次性问答面板两枚（07 §4.3）：select / confirm 的主屏浮层实装。
 *
 * - select：↑/↓ 移动高亮（循环）、pagedown/pageup/home/end 翻页直达（钳首末
 *   不循环）、Enter 选定、Esc 取消收 ''（与撤销面保守值同语义）；
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
import { ellipsize } from '../../engine/index.js';
import { fitRowSegments } from '../row-segments.js';

/** 保守取消值（select——空串与撤销面同语义） */
export const SELECT_CANCELLED = '';

/** 高亮行样式（整行反色——面板内最强存在感） */
const ACTIVE_STYLE: Readonly<CellStyle> = Object.freeze({ inverse: true });
/** 说明段样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });

/**
 * 单行左右双段预算排版已迁件外单源 row-segments（2026-09-21 TUI 第四役挂账②
 * 私拷贝收尾——两处私拷贝删除，本件只消费）：hint 段先按预算截成 … 省略形再
 * 右对齐、label 段以右段实占后余宽为帽 … 收口。单源较私拷贝收紧一处——
 * 预算 0（窗宽 ≤ 2 且右段非空）由放行原宽（右对齐起列为负、尾段从行首
 * 覆写整行）收紧为丢弃右段（负起列结构性封堵）。
 */

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
      // 行预算排版（件外单源 row-segments）：label 段与 hint 段各自 … 收口
      // 不交叠——极长 hint 原宽右对齐会负起列覆写整行（生产链 fs 写审批
      // 路径 hint 的修前坏形）；预算 0（窗宽 ≤ 2）丢右段不放行原宽
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

  /** 事件分发：完成态静默；↑/↓ 循环移动、pagedown/pageup/home/end 直达翻页、Enter 选定、Esc 取消 */
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
    // 翻页键族（pagedown/pageup/home/end——与 TUI 其余选择器键面对齐）：直达
    // 键语义，越界钳首末不循环（循环节律保留在 ↑/↓ 单步键——两族分立）。
    // 页幅 = 取景窗行数（view() 单源）：窗口化 = 窗行（视口一屏恰一翻）；
    // 未窗口化 = 全集行数（无帽直用形恒满高——全集即一页的视口行数量级）。
    // 取景跟随零改：view() 居中钳以 activeIndex 为锚——翻页后自动重取景。
    if (e.key === 'pagedown' || e.key === 'pageup') {
      const page = Math.max(1, this.view().count); // 空集窗行下限 1 兜底
      const next = this.activeIndex + (e.key === 'pagedown' ? page : -page);
      this.activeIndex = Math.min(Math.max(0, next), Math.max(0, this.options.length - 1));
      return true;
    }
    if (e.key === 'home') {
      this.activeIndex = 0;
      return true;
    }
    if (e.key === 'end') {
      this.activeIndex = Math.max(0, this.options.length - 1); // 空集防御（-1 → 0 钳位）
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
  /** 确认键提示文案（缺省 'enter/y 确认'——双轨真可达后缺省明示 y） */
  readonly confirmHint?: string;
  /** 取消键提示文案（缺省 'esc/n 取消'——双轨真可达后缺省明示 n） */
  readonly cancelHint?: string;
}

/**
 * 确认面板：两键问答浮层（Enter/y → true、Esc/n → false——保守值 = 不动原状态）。
 *
 * 缺省键提示双轨明示（'enter/y 确认 · esc/n 取消'——2026-09-23 B2 翻档：
 * y/n text 轨修复后裸字母双轨真可达，缺省单键提示隐藏了实际可用键面；措辞
 * 与 memory-viewer 确认态行对齐）。显式传参覆盖能力保留（两 hint 各自可选）。
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
    this.confirmHint = options.confirmHint ?? 'enter/y 确认';
    this.cancelHint = options.cancelHint ?? 'esc/n 取消';
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

  /**
   * 事件分发：Enter/y 确认、Esc/n 取消（保守值）。
   *
   * y/n 双轨同判：裸字母两轨都以 kind:'text' 事件到达（legacy 地面态
   * textRun 冲刷；kitty flag 1 下纯文本键也不产 CSI u）——text 轨判先于
   * asKey 短路（memory-viewer 确认态同形），否则 isPlainKey 分支永不可达
   * 即死键。
   */
  handleEvent(event: InputEvent): boolean {
    // text 轨双判：单字符整串等值（y/n）应答；其余 text 层内终局（模态独占）
    if (event.kind === 'text') {
      if (this.done) return true; // 完成态静默（单次语义）
      if (event.text === 'y') {
        this.finish(true);
        return true;
      }
      if (event.text === 'n') {
        this.finish(false);
        return true;
      }
      return true;
    }
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
