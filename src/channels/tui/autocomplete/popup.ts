/**
 * 补全弹层件（07 §4.1 引擎节件 6（组件与呈现装配件））：候选列表浮层——输入框上方按多行输入件
 * 坐标定位（定位 anchor 由 TuiBackend 锚定注册表承载——批 10e-2 已落；
 * 本件是纯内容——只画列表）。
 *
 * - refresh 驱动：装配层在每次输入变更后调（provider 取补全——无补全弹层
 *   不显）；候选窗口 10 行帽 + 高亮跟随滚动；
 * - 键面：↑/↓ 循环换高亮、enter/tab 应用、escape 关本轮（后续输入再 refresh
 *   重开）；其余键不消费（穿透回 Editor 继续输入——弹层随下次 refresh 重算）；
 *   enter 的全量输入穿透律——token 已是高亮项全文时 enter 不消费（穿透提交，
 *   归编辑器——2026-09-13 真模型五轮实测定罪补）、tab 恒应用；
 * - 应用 = 整 token 代换（模型 replaceToken 原语——replacement 含触发前缀
 *   与引号形）。
 */
import type { CellBuffer, CellStyle, InputEvent, Region, Renderable } from '../../engine/index.js';
import { ansiColor } from '../../engine/index.js';
import { ACCENT_INDEX } from '../theme.js';
import type { EditorModel } from '../editor/editor-model.js';
import { prefixDisplayWidth } from '../editor/visual-lines.js';
import type { AutocompleteProvider, AutocompleteResult } from './provider.js';

/** 弹层可见条目帽（超出窗口滚动跟随高亮） */
const MAX_VISIBLE_ITEMS = 10;

/** 高亮行样式（整行反色——与 SelectPanel 同视觉语言） */
const ACTIVE_STYLE: Readonly<CellStyle> = Object.freeze({ inverse: true });
/** 补充说明段样式（dim） */
const DETAIL_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 无候选提示样式（accent——theme 单源） */
const EMPTY_STYLE: Readonly<CellStyle> = Object.freeze({ fg: ansiColor(ACCENT_INDEX) });

/** 弹层件：provider 只读消费 + 模型代换原语调用 */
export class AutocompletePopup implements Renderable {
  private result: AutocompleteResult | null = null;
  private activeIndex = 0;
  private windowStart = 0;
  private readonly provider: AutocompleteProvider;
  private readonly model: EditorModel;

  constructor(provider: AutocompleteProvider, model: EditorModel) {
    this.provider = provider;
    this.model = model;
  }

  /** 弹层在场态（无补全不显） */
  get visible(): boolean {
    return this.result !== null;
  }

  /** 高亮下标（测试观测面） */
  get activeItemIndex(): number {
    return this.activeIndex;
  }

  /** 重取补全（每次输入变更后装配调——无补全自然隐藏） */
  refresh(): void {
    const cursor = this.model.getCursor();
    this.result = this.provider.getCompletions({
      lines: this.model.getLines(),
      cursorLine: cursor.line,
      cursorCol: cursor.col,
    });
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
      buffer.writeText(region.row, region.col, '无匹配', EMPTY_STYLE);
      return;
    }
    const end = Math.min(items.length, this.windowStart + MAX_VISIBLE_ITEMS);
    for (let i = this.windowStart; i < end; i++) {
      const row = region.row + (i - this.windowStart);
      const item = items[i]!;
      const active = i === this.activeIndex;
      const prefix = active ? '❯ ' : '  ';
      buffer.writeText(row, region.col, `${prefix}${item.label}`, active ? ACTIVE_STYLE : undefined);
      if (item.detail !== undefined && item.detail.length > 0) {
        // 右对齐按显示宽（CJK 段宽 ≠ 码位数）
        const detailCols = prefixDisplayWidth(item.detail, item.detail.length);
        buffer.writeText(row, region.col + region.width - detailCols, item.detail, DETAIL_STYLE);
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
      this.result = null; // 关本轮（后续输入再 refresh 重开）
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
   * 全量输入判定：光标 token 现文本 === 高亮项 replacement 全文（弹层可见期
   * 间输入变更必经 refresh 重开——本判定取值恒新鲜，无陈旧区间风险）。
   */
  private selectionAlreadyTyped(): boolean {
    const result = this.result;
    if (result === null || result.items.length === 0) return false;
    const item = result.items[this.activeIndex]!;
    const line = this.model.getLines()[this.model.getCursor().line];
    if (line === undefined) return false;
    return line.slice(result.replaceStart, result.replaceEnd) === item.replacement;
  }
}
