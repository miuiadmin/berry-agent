/**
 * 文本件两件（07 篇 §4.1 呈现面件 6 组件条款）：Text 单行截断 / Paragraph
 * 字素折行。
 *
 * 文本件构造后静态不可变（组件条款——状态归持有方自管，换内容即换实例）；
 * 整字三原语（truncateToWidth / wrapText）来自引擎 width 件——半字与悬挂
 * 由原语层结构性排除，本件零自研宽度算术。
 */
import type { CellBuffer, CellStyle, Region, Renderable } from '../engine/index.js';
import { truncateToWidth, wrapText } from '../engine/index.js';

/** Text props：单行不换行文本（超宽截断——状态行片段等静态行） */
export interface TextProps {
  readonly content: string;
  readonly style?: CellStyle;
}

/** 单行文本件（measure 恒 1；宽字符截断不产半字） */
export class Text implements Renderable {
  private readonly content: string;
  private readonly style?: CellStyle;

  constructor(props: TextProps) {
    this.content = props.content;
    this.style = props.style;
  }

  measure(_width: number): number {
    return 1;
  }

  render(buffer: CellBuffer, region: Region): void {
    if (region.width <= 0 || region.height <= 0) return;
    buffer.writeText(region.row, region.col, truncateToWidth(this.content, region.width), this.style);
  }
}

/** Paragraph props：多行折行文本（字素整字换行） */
export interface ParagraphProps {
  readonly content: string;
  readonly style?: CellStyle;
}

/** 折行文本件（显式 \n + 列宽折行；measure = 折行行数——两段同一 wrapText 单源） */
export class Paragraph implements Renderable {
  private readonly content: string;
  private readonly style?: CellStyle;

  constructor(props: ParagraphProps) {
    this.content = props.content;
    this.style = props.style;
  }

  measure(width: number): number {
    return wrapText(this.content, Math.max(1, width)).length;
  }

  render(buffer: CellBuffer, region: Region): void {
    if (region.width <= 0 || region.height <= 0) return;
    const lines = wrapText(this.content, region.width);
    for (let i = 0; i < Math.min(lines.length, region.height); i++) {
      buffer.writeText(region.row + i, region.col, lines[i] ?? '', this.style);
    }
  }
}
