/**
 * 补全弹层件（07 §4.1 引擎节件 6（组件与呈现装配件））：候选列表浮层——输入框上方按多行输入件
 * 坐标定位（定位 anchor 由 TuiBackend 锚定注册表承载——批 10e-2 已落；
 * 本件是纯内容——只画列表）。
 *
 * - 结果落位驱动：R6 批 10j 异步形——backend 持防抖调度器（AutocompleteCompleter），
 *   onResult 回调调 applyResult 注入（无补全弹层不显）；候选窗口 10 行帽 +
 *   高亮跟随滚动；
 * - 键面：↑/↓ 循环换高亮、enter/tab 应用、escape 关本轮（后续输入再发新查
 *   重开；关层回调 onDismiss——backend 撤防抖窗作废在途，堵迟到 fire 重开
 *   闪回——2026-09-20 TUI 视觉品质战役·组 2）；其余键不消费（穿透回
 *   Editor 继续输入——弹层随下次落位重算）；
 *   enter 的全量输入穿透律——token 已是高亮项全文时 enter 不消费（穿透提交，
 *   归编辑器——2026-09-13 真模型五轮实测定罪补）、tab 恒应用；
 * - 陈旧窗守卫（R6 批 10j）：20ms 防抖窗内弹层可持上轮 result（输入已变更、
 *   新查未发），enter/tab 应用陈旧 replaceStart/End 会劈坏文本——应用前对拍
 *   光标 token 现区间，陈旧即收层穿透；
 * - 应用 = 整 token 代换（模型 replaceToken 原语——replacement 含触发前缀
 *   与引号形）。
 */
import type { CellBuffer, CellStyle, InputEvent, Region, Renderable } from '../../engine/index.js';
import { stringWidth, truncateToWidth } from '../../engine/index.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import type { EditorModel } from '../editor/editor-model.js';
import type { AutocompleteResult } from './provider.js';
import { tokenAtCursor } from './token.js';

/** 弹层可见条目帽（超出窗口滚动跟随高亮） */
const MAX_VISIBLE_ITEMS = 10;

/** 高亮行样式（整行反色——与 SelectPanel 同视觉语言） */
const ACTIVE_STYLE: Readonly<CellStyle> = Object.freeze({ inverse: true });
/** 补充说明段样式（dim） */
const DETAIL_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });

/**
 * 单行左右双段预算排版（market-picker renderRow 预算律同款——2026-09-20
 * TUI 视觉品质战役·组 2）：右段（detail）先按预算截成 … 省略形再右对齐——
 * 极长右段按原宽右对齐会把起列推成负值（首段被缓冲吸收、余段从行首覆写
 * 整行——label 被毁的同根坏形）；左段（前缀 + label）以右段实占后余宽为
 * 帽，超帽 … 收口。两段各自整字截断（truncateToWidth——不撕宽字符）。
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

/** 弹层件：结果落位面 + 模型代换原语调用（provider 归 backend 调度器持有） */
export class AutocompletePopup implements Renderable {
  private result: AutocompleteResult | null = null;
  private activeIndex = 0;
  private windowStart = 0;
  private readonly model: EditorModel;
  /** 无候选提示样式（accent 派生——主题单源，setTheme 整体重建） */
  private emptyStyle: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.accent });
  /**
   * escape 关层通知（2026-09-20 TUI 视觉品质战役·组 2）：popup 消费 escape
   * 关本轮时回调——backend 接线 autocompleteCompleter.cancel()（撤 20ms 防
   * 抖窗 + 在途作废），堵「关层后窗内迟到 fire 重开弹层」的建议框闪回
   * （kitty 轨 escape 即达即决，20ms 窗内已武装的查询会迟到落层）。仅
   * escape 路回调——enter 应用即隐属新轮编舞、陈旧守卫收层是穿透过渡，
   * 都不算「用户撤销本轮」。
   */
  onDismiss?: () => void;

  constructor(model: EditorModel) {
    this.model = model;
  }

  /** 主题换装（OSC 11 probe 裁定后 backend 注入——accent 派生样式重建） */
  setTheme(theme: ResolvedTheme): void {
    this.emptyStyle = Object.freeze({ fg: theme.accent });
  }

  /** 弹层在场态（无补全不显） */
  get visible(): boolean {
    return this.result !== null;
  }

  /** 高亮下标（测试观测面） */
  get activeItemIndex(): number {
    return this.activeIndex;
  }

  /** 结果落位（backend 防抖调度器 onResult 注入——无补全自然隐藏；高亮归零） */
  applyResult(result: AutocompleteResult | null): void {
    this.result = result;
    this.activeIndex = 0;
    this.windowStart = 0;
  }

  /** 量高：可见条目数（不可见 = 0——浮层不占布局） */
  measure(width: number): number {
    void width;
    const count = this.result?.items.length ?? 0;
    return Math.min(count, MAX_VISIBLE_ITEMS);
  }

  /** 落位：铺底空格 → 可见窗条目行（高亮反色 + 说明右对齐） */
  render(buffer: CellBuffer, region: Region): void {
    if (this.result === null) return;
    // 铺底空格（写格覆盖——未写格会透出主树文字）
    for (let r = 0; r < region.height; r++) {
      for (let c = 0; c < region.width; c++) {
        buffer.setCell(region.row + r, region.col + c, ' ');
      }
    }
    const items = this.result.items;
    if (items.length === 0) {
      buffer.writeText(region.row, region.col, '无匹配', this.emptyStyle);
      return;
    }
    const end = Math.min(items.length, this.windowStart + MAX_VISIBLE_ITEMS);
    for (let i = this.windowStart; i < end; i++) {
      const row = region.row + (i - this.windowStart);
      const item = items[i]!;
      const active = i === this.activeIndex;
      const prefix = active ? '❯ ' : '  ';
      // 行预算排版：label 段（前缀 + label）与 detail 段各自 … 收口不交叠
      // ——极长 detail 原宽右对齐会负起列覆写整行（组 2 修前坏形）
      const { left, right, rightWidth } = fitRowSegments(`${prefix}${item.label}`, item.detail, region.width);
      buffer.writeText(row, region.col, left, active ? ACTIVE_STYLE : undefined);
      if (rightWidth > 0) {
        buffer.writeText(row, region.col + region.width - rightWidth, right, DETAIL_STYLE);
      }
    }
  }

  /** 事件分发（弹层可见才有意义）：↑/↓ / enter / tab / escape，其余穿透 */
  handleEvent(event: InputEvent): boolean {
    if (this.result === null) return false; // 不在场不挡键
    if (event.kind !== 'key') return false; // 文本 / IME / 粘贴穿透回输入件
    if (event.phase === 'release') return false;
    if (event.ctrl || event.alt || event.shift || event.meta) return false; // 修饰组合穿透（编辑键面）
    if (event.key === 'up') {
      this.moveActive(-1);
      return true;
    }
    if (event.key === 'down') {
      this.moveActive(1);
      return true;
    }
    if (event.key === 'enter' || event.key === 'tab') {
      // 陈旧窗守卫（R6 批 10j）：防抖窗内弹层可持上轮 result——陈旧区间上
      // 代换会劈坏文本（'/help l' 形）。对拍光标 token 现区间，陈旧即收层
      // 穿透（enter 走提交语义、tab 回编辑器键面）。
      if (this.resultStale()) {
        this.applyResult(null);
        return false;
      }
      // 全量输入穿透律（2026-09-13 真模型五轮实测定罪修复）：当前 token 已是
      // 高亮项 replacement 全文时，enter 的「应用」是无净代换的空动作——吞键
      // 会把完整输入的斜杠命令逼成「先应用再提交」双 enter 形（且第二次输入
      // 与残留拼接进模型）。此处 enter 穿透回编辑器走提交语义；tab 专职填充
      // 无提交歧义、恒应用（键面分离）。
      if (event.key === 'enter' && this.selectionAlreadyTyped()) return false;
      this.applySelection();
      return true;
    }
    if (event.key === 'escape') {
      this.applyResult(null); // 关本轮（后续输入再发新查重开）
      // 关层联动通知：backend 撤防抖窗 + 作废在途——否则 kitty 轨 escape 即达
      // 即决后，窗内已武装的查询迟到 fire 会重开刚关的弹层（闪回）
      this.onDismiss?.();
      return true;
    }
    return false; // 其余键穿透（backspace / 字符等继续编辑——弹层随下次 refresh 重算）
  }

  /** 高亮循环移动 + 窗口跟随（10 行帽外的条目滚动入窗） */
  private moveActive(delta: number): void {
    const count = this.result?.items.length ?? 0;
    if (count === 0) return;
    this.activeIndex = (this.activeIndex + delta + count) % count;
    if (this.activeIndex < this.windowStart) this.windowStart = this.activeIndex;
    if (this.activeIndex >= this.windowStart + MAX_VISIBLE_ITEMS) {
      this.windowStart = this.activeIndex - MAX_VISIBLE_ITEMS + 1;
    }
  }

  /** 应用选中项：整 token 代换（模型原语——光标落代换尾） */
  private applySelection(): void {
    const result = this.result;
    if (result === null || result.items.length === 0) return;
    const item = result.items[this.activeIndex]!;
    this.result = null; // 应用即隐（先隐后代换——代换的 notify 可能再触发 refresh 重开，属新轮）
    const cursor = this.model.getCursor();
    this.model.replaceToken(cursor.line, result.replaceStart, result.replaceEnd, item.replacement);
  }

  /**
   * 全量输入判定：光标 token 现文本 === 高亮项 replacement 全文（enter 路径
   * 已过陈旧守卫——result 区间与 token 现区间一致，slice 取值即新鲜）。
   */
  private selectionAlreadyTyped(): boolean {
    const result = this.result;
    if (result === null || result.items.length === 0) return false;
    const item = result.items[this.activeIndex]!;
    const line = this.model.getLines()[this.model.getCursor().line];
    if (line === undefined) return false;
    return line.slice(result.replaceStart, result.replaceEnd) === item.replacement;
  }

  /**
   * 陈旧判定（R6 批 10j）：result 代换区间对拍光标 token 现区间。防抖窗内
   * 输入已变更而新查未发——token 现区间与上轮 result 区间失配即陈旧；
   * 无 token（光标在空白段）也判陈旧（上轮区间必不匹配空段）。
   */
  private resultStale(): boolean {
    const result = this.result;
    if (result === null) return false; // 不在场无陈旧可言（handleEvent 已挡）
    const cursor = this.model.getCursor();
    const line = this.model.getLines()[cursor.line] ?? '';
    const token = tokenAtCursor(line, cursor.col);
    return token === null || token.start !== result.replaceStart || token.end !== result.replaceEnd;
  }
}
