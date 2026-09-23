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

  // 表头（整格 bold 位；头格同法 cell 级折行取前两行——两行仍超截断；任一
  // 头格折行即表头区整体两行高·列头对齐律）+ 分隔 + 数据行
  const laidHeader = block.header.map((spans, j) =>
    layoutSpans(spans ?? [], colWidths[j]!, theme, { bold: true }).slice(0, 2),
  );
  const rows: StyledGrapheme[][] = [];
  const headerHeight = Math.max(1, ...laidHeader.map((cells) => cells.length));
  for (let r = 0; r < headerHeight; r++) {
    rows.push(renderLine(laidHeader.map((cells) => cells[r] ?? [])));
  }
  rows.push(sep);
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

/**
 * 开栏代码块折叠承接账（渲染热路径 D4——流式尾块逐帧增量承接）。
 *
 * 问题形：流式开栏尾块每帧文本增长，blockEquals 的 code 支路先比
 * lines.length（blocks.ts）恒不相等 → MarkdownDoc 块级缓存每帧 miss →
 * 每帧对全量源行逐行 layoutPlain 重折（尾块越长每帧白算越多）。
 *
 * 修法：layoutPlain 按源行独立——行折叠产出只依赖（该行文本, bodyWidth），
 * 不随后续行增长变化，故按源行粒度承接：
 * - 命中判据（内容键）= 记账 bodyWidth 相同 + 源行前缀逐行全等——跨块对象
 *   成立（layoutPlain 纯函数确定性：同键同产出，引用复用即字节等价）；
 * - 前缀行折叠结果按**引用复用**（零重折零分配——与 MarkdownDoc.fromBlocks
 *   块级承接同律的引用复用），自分歧行起增量重折（缩量/中行改写同样自
 *   分歧行起重折，不丢字不错位）；
 * - 闭栏帧**不读不写**本账（闭栏 = 整体高亮重排全量重折——产出形与开栏
 *   单色不同，互承即污染样式回翻）；换宽帧 bodyWidth 键失配自然全量重折；
 * - 单条目记账：开栏围栏必吃到文末 → 每文档至多一个开栏块；多文档交错
 *   渲染时键失配仅退化为全量重折（性能回退、无正确性风险）。
 */
interface CodeFoldCarry {
  /** 记账时的 bodyWidth（换宽失配键） */
  readonly bodyWidth: number;
  /** 记账时的源行文本（前缀比对键——slice 防外側改写） */
  readonly lines: readonly string[];
  /** 每源行折叠产出的视觉行组（已含 │ 前缀——引用复用单元；外层账本不可改写，内层行集账面约定只读） */
  readonly rowsByLine: readonly StyledGrapheme[][][];
}

/** 模块级单条目承接账（上次开栏路径折叠结果；闭栏路径不触碰） */
let codeFoldCarry: CodeFoldCarry | null = null;

/**
 * 开栏单源行折叠 → │ 前缀贯通视觉行组（D4 承接的增量折叠单元——
 * 每帧只对新增/分歧行调用，前缀行引用复用不经过本函数）。
 */
function foldOpenCodeLine(line: string, bodyWidth: number): StyledGrapheme[][] {
  const lineRows: StyledGrapheme[][] = [];
  for (const row of layoutPlain(line, bodyWidth)) lineRows.push([...prefixCells('│ '), ...row]);
  return lineRows;
}

/** 代码块 → 渲染行集（闭栏 + 已知语言走五类高亮；开栏/未知退单色） */
function codeRows(
  block: Extract<MarkdownBlock, { type: 'code' }>,
  width: number,
  theme: Readonly<ResolvedTheme>,
): StyledGrapheme[][] {
  const bodyWidth = Math.max(1, width - 2);
  // 开栏路径（流式半截尾块）：逐源行增量承接（D4）——见 codeFoldCarry 头注
  if (block.open === true) {
    const prev = codeFoldCarry !== null && codeFoldCarry.bodyWidth === bodyWidth ? codeFoldCarry : null;
    // 前缀比对：与账目逐源行文本全等比对，首个分歧行前全部命中（纯增长
    // 热路 = O(前缀行数) 字符串引用比对 + O(新增行) 折叠）
    let reuse = 0;
    if (prev !== null) {
      const maxReuse = Math.min(prev.lines.length, block.lines.length);
      while (reuse < maxReuse && prev.lines[reuse] === block.lines[reuse]) reuse++;
    }
    const rows: StyledGrapheme[][] = [];
    const rowsByLine: StyledGrapheme[][][] = [];
    if (prev !== null) {
      for (let i = 0; i < reuse; i++) {
        // 前缀行折叠结果引用直入——零重折零分配（消费面只读不改行数组）
        const carried = prev.rowsByLine[i]!;
        rows.push(...carried);
        rowsByLine.push(carried);
      }
    }
    for (let i = reuse; i < block.lines.length; i++) {
      // 分歧行起增量重折（含纯增长的新增行——每帧只折新增/分歧行）
      const lineRows = foldOpenCodeLine(block.lines[i] ?? '', bodyWidth);
      rows.push(...lineRows);
      rowsByLine.push(lineRows);
    }
    // 写回新账：承接段引用直入 + 新折段（下帧前缀比对的键与值）
    codeFoldCarry = { bodyWidth, lines: block.lines.slice(), rowsByLine };
    return rows;
  }
  // 闭栏路径：整体高亮重排（每原文行的样式段序列——token 按换行位切块
  // 分发；串接恒等原文律）+ 全量重折；不读不写承接账（防闭开互承染样式）
  const partsByLine: StylePart[][] = [];
  const tokens = highlight(block.lines.join('\n'), block.language);
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
