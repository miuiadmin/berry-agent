/**
 * Markdown 块布局分派件（批 10h 自 markdown.ts 拆出——块型 → 渲染行集）。
 *
 * 新增面（R1 批 10h）：GFM 表格（自适应列宽 + 等分帽 + tableRule 框线 +
 * 逐列对齐 + 单元格级折行）；闭栏代码块自研高亮（五类 token → 主题键族；
 * 开栏/未知语言诚实退单色——未闭不高亮防样式回翻闪烁）。
 */
import { graphemeWidth, splitGraphemes, type CellStyle } from '../../engine/index.js';
import type { ResolvedTheme } from '../theme/index.js';
import type { MarkdownBlock } from './blocks.js';
import { highlight, tokenStyle } from './highlight/index.js';
import {
  DIM_STYLE,
  layoutParts,
  layoutPlain,
  layoutSpans,
  prefixCells,
  spansWidth,
  type StylePart,
  type StyledGrapheme,
} from './layout.js';

/** 表格列最小宽（三连定界形下限） */
const TABLE_MIN_COL = 3;

/** 行显示宽（字素宽求和——列宽 padding 算术） */
function rowWidth(row: readonly StyledGrapheme[]): number {
  return row.reduce((sum, cell) => sum + graphemeWidth(cell.grapheme), 0);
}

/** 空格格位填充（对齐 padding——无边样式） */
function padCells(count: number): StyledGrapheme[] {
  return count > 0 ? splitGraphemes(' '.repeat(count)).map((grapheme) => ({ grapheme, style: undefined })) : [];
}

/** 单元格视觉行按对齐位补齐到列宽（续行同对齐律） */
function alignCellRow(
  row: readonly StyledGrapheme[],
  colWidth: number,
  align: 'left' | 'center' | 'right' | null,
): StyledGrapheme[] {
  const pad = Math.max(0, colWidth - rowWidth(row));
  if (align === 'right') return [...padCells(pad), ...row];
  if (align === 'center') return [...padCells(Math.floor(pad / 2)), ...row, ...padCells(pad - Math.floor(pad / 2))];
  return [...row, ...padCells(pad)]; // null/left 缺省左
}

/** 表格框线样式（tableRule 单源——所有 │ ├ ┬ ┤ ─ 框线字符同键） */
function ruleStyle(theme: Readonly<ResolvedTheme>): Readonly<CellStyle> {
  return { fg: theme.tableRule };
}

/** 表格块 → 渲染行集（框线全走 tableRule；内容正常样式） */
function tableRows(
  block: Extract<MarkdownBlock, { type: 'table' }>,
  width: number,
  theme: Readonly<ResolvedTheme>,
): StyledGrapheme[][] {
  const cols = Math.max(block.header.length, ...block.rows.map((row) => row.length), 1);
  // 自然列宽 = 表头 + 数据行整格宽最大值（min 3）
  const natural: number[] = [];
  for (let j = 0; j < cols; j++) {
    const cells = [block.header[j], ...block.rows.map((row) => row[j])];
    natural[j] = Math.max(TABLE_MIN_COL, ...cells.map((spans) => (spans === undefined ? 0 : spansWidth(spans))));
  }
  // 可用内容预算 = 总宽 - 竖线数（cols+1） - 每列两侧空格（2×cols）；超
  // 预算走等分帽（更精的贪心再分配 v1 不做——列宽等分律）
  const avail = Math.max(cols * TABLE_MIN_COL, width - (cols + 1) - 2 * cols);
  const total = natural.reduce((sum, w) => sum + w, 0);
  const cap = total > avail ? Math.max(TABLE_MIN_COL, Math.floor(avail / cols)) : Number.POSITIVE_INFINITY;
  const colWidths = natural.map((w) => Math.min(w, cap));

  const rule = ruleStyle(theme);
  const bar = prefixCells('│', rule);
  const gap = prefixCells(' ');
  // 一行渲染：│ cell │ cell │（cell = 空格 + 内容补齐列宽 + 空格）
  const renderLine = (cells: StyledGrapheme[][]): StyledGrapheme[] => {
    const line: StyledGrapheme[] = [...bar];
    for (let j = 0; j < cols; j++) {
      if (j > 0) line.push(...bar);
      const cell = cells[j] ?? [];
      line.push(...gap, ...cell, ...gap, ...padCells(colWidths[j]! - rowWidth(cell)));
    }
    line.push(...bar);
    return line;
  };
  // 分隔行 ├─┬─┤（横杠宽 = 列宽 + 两侧空格）
  const sep: StyledGrapheme[] = prefixCells('├', rule);
  for (let j = 0; j < cols; j++) {
    if (j > 0) sep.push(...prefixCells('┬', rule));
    sep.push(...prefixCells('─'.repeat(colWidths[j]! + 2), rule));
  }
  sep.push(...prefixCells('┤', rule));

  // 表头（整格 bold 位；单行呈现——折行头形 v1 退化不折）+ 分隔 + 数据行
  const headerCells = block.header.map(
    (spans, j) => layoutSpans(spans ?? [], colWidths[j]!, theme, { bold: true })[0]!,
  );
  const rows: StyledGrapheme[][] = [renderLine(headerCells), sep];
  for (const row of block.rows) {
    const laid = row.map((spans, j) => layoutSpans(spans ?? [], colWidths[j] ?? TABLE_MIN_COL, theme));
    const height = Math.max(1, ...laid.map((cells) => cells.length));
    for (let r = 0; r < height; r++) {
      const lineCells = laid.map((cells, j) =>
        alignCellRow(cells[r] ?? [], colWidths[j] ?? TABLE_MIN_COL, block.align[j] ?? null),
      );
      rows.push(renderLine(lineCells));
    }
  }
  return rows;
}

/** 代码块 → 渲染行集（闭栏 + 已知语言走五类高亮；开栏/未知退单色） */
function codeRows(
  block: Extract<MarkdownBlock, { type: 'code' }>,
  width: number,
  theme: Readonly<ResolvedTheme>,
): StyledGrapheme[][] {
  const bodyWidth = Math.max(1, width - 2);
  // 每原文行的样式段序列（高亮 token 按换行位切块分发；串接恒等原文律）
  const partsByLine: StylePart[][] = [];
  const tokens = block.open === true ? null : highlight(block.lines.join('\n'), block.language);
  if (tokens !== null) {
    let current: StylePart[] = [];
    for (const token of tokens) {
      const style = token.type === 'plain' ? undefined : tokenStyle(token.type, theme);
      const pieces = token.text.split('\n');
      for (let k = 0; k < pieces.length; k++) {
        if (k > 0) {
          partsByLine.push(current);
          current = [];
        }
        if (pieces[k]! !== '') current.push({ text: pieces[k]!, style });
      }
    }
    partsByLine.push(current);
  }
  // 折行在 bodyWidth 内先行、│ 前缀列恒 2 格贯通（含续行）
  const rows: StyledGrapheme[][] = [];
  const lineCount = tokens !== null ? partsByLine.length : block.lines.length;
  for (let i = 0; i < lineCount; i++) {
    const laid =
      tokens !== null ? layoutParts(partsByLine[i] ?? [], bodyWidth) : layoutPlain(block.lines[i] ?? '', bodyWidth);
    for (const row of laid) rows.push([...prefixCells('│ '), ...row]);
  }
  return rows;
}

/** 单块布局 → 渲染行集（块型分派；行首前缀 + 折行 + 层级缩进） */
export function blockRows(block: MarkdownBlock, width: number, theme: Readonly<ResolvedTheme>): StyledGrapheme[][] {
  switch (block.type) {
    case 'heading': {
      // 标题：整行强制 bold（行内样式位叠加保留——code 色不丢）；H1/H2 尾随分隔线
      const rows = layoutSpans(block.spans, width, theme, { bold: true });
      if (block.level <= 2) {
        rows.push(splitGraphemes('─'.repeat(width)).map((grapheme) => ({ grapheme, style: DIM_STYLE })));
      }
      return rows;
    }
    case 'paragraph':
      return layoutSpans(block.spans, width, theme);
    case 'list-item': {
      // 前缀 = 嵌套缩进 + 标记 + 空格；续行对齐前缀宽（视觉续挂）
      const prefix = `${'  '.repeat(block.indent)}${block.marker} `;
      const prefixWidth = splitGraphemes(prefix).reduce((sum, g) => sum + graphemeWidth(g), 0);
      const body = layoutSpans(block.spans, Math.max(1, width - prefixWidth), theme);
      return body.map((row, index) => [
        ...(index === 0 ? prefixCells(prefix) : prefixCells(' '.repeat(prefixWidth))),
        ...row,
      ]);
    }
    case 'code':
      return codeRows(block, width, theme);
    case 'quote': {
      // 引用：首列竖线 + dim 基础样式（行内样式位叠加）
      const rows: StyledGrapheme[][] = [];
      for (const line of block.lines) rows.push(...layoutSpans(line, Math.max(1, width - 2), theme, DIM_STYLE));
      return rows.map((row) => [...prefixCells('┆ ', DIM_STYLE), ...row]);
    }
    case 'table':
      return tableRows(block, width, theme);
    case 'hr':
      return [splitGraphemes('─'.repeat(width)).map((grapheme) => ({ grapheme, style: DIM_STYLE }))];
  }
}
