/**
 * Markdown 块布局分派件（批 10h 自 markdown.ts 拆出——块型 → 渲染行集）。
 *
 * 新增面（R1 批 10h）：GFM 表格（codex 双线制 + 自适应列宽 + 等分帽 +
 * weakRule 优先线色 + 逐列对齐 + 单元格级折行——V-3 注⑨④）；闭栏代码块自研
 * 高亮（五类 token → 主题键族；开栏/未知语言诚实退单色——未闭不高亮防样式
 * 回翻闪烁）。
 *
 * 观感定值（2026-10-10 R-3 观感翻档——codex markdown 渲染同构，规范 07
 * §4.3 ⑨；2026-10-01 界面美化役批 §⑥ 全项重定值承此）：标题 = 字面 #
 * 前缀保留呈现（渲染层重建）+ 六级属性梯度（H1 bold+underline / H2 bold /
 * H3 bold+italic / H4-6 italic）；代码块裸文本形（│ 沟线与语言标签收尾双
 * 退役、超宽不折行截断——每源行单视觉行）；引用块 > 前缀 + 整行 quoteText
 * 行级基础色；列表每层 4 列缩进 + 无序全深度统一 '- '（BULLET_LADDER 轮换
 * 退役）+ 有序数字右对齐两位 link 键色；hr 固定三 em-dash。表格 codex 双线
 * 制维持（表头 ━ 重线 + 表体行间 ─ 轻线、无纵向线——V-3 注⑨④）。
 */
import { ellipsize, graphemeWidth, sanitizeDisplayText, splitGraphemes, type CellStyle } from '../../engine/index.js';
import type { ResolvedTheme } from '../theme/index.js';
import type { MarkdownBlock } from './blocks.js';
import { highlight, tokenStyle } from './highlight/index.js';
import { DIM_STYLE, layoutSpans, prefixCells, spansWidth, type StylePart, type StyledGrapheme } from './layout.js';

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

/** 表格线样式（V-3 注⑨——weakRule 混合现算弱线优先，键缺席回退 tableRule） */
function ruleStyle(theme: Readonly<ResolvedTheme>): Readonly<CellStyle> {
  return { fg: theme.weakRule ?? theme.tableRule };
}

/** 行尾无样式空白裁（V-3 注⑨④——padding 空格不入行集：字节面/断言面双赢） */
function trimTrailingSpaces(line: StyledGrapheme[]): void {
  while (line.length > 0) {
    const last = line[line.length - 1]!;
    if (last.grapheme !== ' ' || last.style !== undefined) break; // 有样式位（内容空格）不裁
    line.pop();
  }
}

/**
 * 表格块 → 渲染行集（V-3 注⑨④ codex 双线制）：表头分隔 ━ 重线 + 表体逻辑行
 * 间 ─ 轻线、无纵向线（全框形 ┌┐└┘┬┴┼├┤│ 退役）、线色 weakRule 优先
 * tableRule 回退；列宽预算不扣纵线列（avail = width − 2×cols，列随纵线退役
 * 回收变宽）；行尾空白裁。
 */
function tableRows(
  block: Extract<MarkdownBlock, { type: 'table' }>,
  width: number,
  theme: Readonly<ResolvedTheme>,
): StyledGrapheme[][] {
  const allCols = Math.max(block.header.length, ...block.rows.map((row) => row.length), 1);
  // 窄屏列收缩（挖掘 27 轮 [1]）：每列最窄占位 = TABLE_MIN_COL 3 + 两侧空
  // 2 = 5——双地板（avail≥cols×3 / cap≥3）保列宽下限使窄屏 tableWidth 恒
  // ≥5×cols 溢出视口，越界列下游 writeText 静默丢（markdown 逐游程无钳制
  // + cell 越界静默吸收）——整列裁失无指路。收缩到屏幕可容纳列数
  // floor(width/5)（≥1 下限），余列丢弃 + 末行「+ N 列更多」dim 指路
  //（诚实边界优于静默裁失；列宽地板是反退化取舍不动）
  const maxCols = Math.max(1, Math.floor(width / (TABLE_MIN_COL + 2)));
  const droppedCols = Math.max(0, allCols - maxCols);
  const cols = allCols - droppedCols;
  // 自然列宽 = 表头 + 数据行整格宽最大值（min 3）
  const natural: number[] = [];
  for (let j = 0; j < cols; j++) {
    const cells = [block.header[j], ...block.rows.map((row) => row[j])];
    natural[j] = Math.max(TABLE_MIN_COL, ...cells.map((spans) => (spans === undefined ? 0 : spansWidth(spans))));
  }
  // 可用内容预算 = 总宽 - 每列两侧空格（2×cols——V-3 注⑨④ 纵线退役零扣）；
  // 超预算走等分帽（更精的贪心再分配 v1 不做——列宽等分律）
  const avail = Math.max(cols * TABLE_MIN_COL, width - 2 * cols);
  const total = natural.reduce((sum, w) => sum + w, 0);
  const cap = total > avail ? Math.max(TABLE_MIN_COL, Math.floor(avail / cols)) : Number.POSITIVE_INFINITY;
  const colWidths = natural.map((w) => Math.min(w, cap));

  const rule = ruleStyle(theme);
  // 一行渲染：open-gap cell close-gap（cell 内容补齐列宽；列间 = close+open
  // 双空格分隔——无纵向线）+ 行尾无样式空白裁
  const renderLine = (cells: StyledGrapheme[][]): StyledGrapheme[] => {
    const line: StyledGrapheme[] = [];
    for (let j = 0; j < cols; j++) {
      const cell = cells[j] ?? [];
      line.push(...prefixCells(' '), ...cell, ...padCells(colWidths[j]! - rowWidth(cell)), ...prefixCells(' '));
    }
    trimTrailingSpaces(line);
    return line;
  };
  // 线行（双线制）：全表宽 = Σ列宽 + 2×cols 连续单字符——heavy ━（表头分隔
  // 重线）/ light ─（表体逻辑行间轻线），同键线色
  const tableWidth = colWidths.reduce((sum, w) => sum + w, 0) + 2 * cols;
  const ruleLine = (char: string): StyledGrapheme[] => prefixCells(char.repeat(tableWidth), rule);
  const heavy = ruleLine('━');
  const light = ruleLine('─');

  // 表头（整格 bold 位；头格同法 cell 级折行取前两行——两行仍超截断；任一
  // 头格折行即表头区整体两行高·列头对齐律）+ 重线 + 数据行（逻辑行间轻线；
  // 空表无轻线——头 + 重线即收）
  const laidHeader = block.header.map((spans, j) =>
    layoutSpans(spans ?? [], colWidths[j]!, theme, { bold: true }).slice(0, 2),
  );
  const rows: StyledGrapheme[][] = [];
  const headerHeight = Math.max(1, ...laidHeader.map((cells) => cells.length));
  for (let r = 0; r < headerHeight; r++) {
    rows.push(renderLine(laidHeader.map((cells) => cells[r] ?? [])));
  }
  rows.push(heavy); // 表头分隔重线（V-3 注⑨④——顶线随全框退役）
  for (let i = 0; i < block.rows.length; i++) {
    if (i > 0) rows.push(light); // 表体逻辑行间轻线（首行贴重线、末行后无底线）
    const row = block.rows[i]!;
    const laid = row.map((spans, j) => layoutSpans(spans ?? [], colWidths[j] ?? TABLE_MIN_COL, theme));
    const height = Math.max(1, ...laid.map((cells) => cells.length));
    for (let r = 0; r < height; r++) {
      const lineCells = laid.map((cells, j) =>
        alignCellRow(cells[r] ?? [], colWidths[j] ?? TABLE_MIN_COL, block.align[j] ?? null),
      );
      rows.push(renderLine(lineCells));
    }
  }
  // 收缩指路行：余列丢弃的诚实边界（溢出指示统一律「+ N 更多」族——列向形）。
  // 指路行文本自宽（CJK 宽 10 起步）在 width ≤9 时自身溢出被 cell 越界静默
  // 吸收——ellipsize 单源收口到 width（挖掘 28 轮 [12]：截断指路行对截断
  // 几何也诚实，省略号在场而非硬切口）
  if (droppedCols > 0) rows.push(prefixCells(ellipsize(`+ ${droppedCols} 列更多`, width), DIM_STYLE));
  return rows;
}

/**
 * 开栏代码块呈现承接账（渲染热路径 D4——流式尾块逐帧增量承接）。
 *
 * 问题形：流式开栏尾块每帧文本增长，blockEquals 的 code 支路先比
 * lines.length（blocks.ts）恒不相等 → MarkdownDoc 块级缓存每帧 miss →
 * 每帧对全量源行逐行重算呈现（尾块越长每帧白算越多）。
 *
 * 修法：呈现按源行独立——行产出只依赖（该行文本, bodyWidth），不随后续
 * 行增长变化，故按源行粒度承接（R-3 裸文本形下每源行恰一视觉行，账目
 * 与源行 1:1）：
 * - 命中判据（内容键）= 记账 bodyWidth 相同 + 源行前缀逐行全等——跨块对象
 *   成立（capPartsLine 纯函数确定性：同键同产出，引用复用即字节等价）；
 * - 前缀行呈现结果按**引用复用**（零重算零分配——与 MarkdownDoc.fromBlocks
 *   块级承接同律的引用复用），自分歧行起增量重算（缩量/中行改写同样自
 *   分歧行起重算，不丢字不错位）；
 * - 闭栏帧**不读不写**本账（闭栏 = 整体高亮重排全量重算——产出形与开栏
 *   单色不同，互承即污染样式回翻）；换宽帧 bodyWidth 键失配自然全量重算；
 * - 单条目记账：开栏围栏必吃到文末 → 每文档至多一个开栏块；多文档交错
 *   渲染时键失配仅退化为全量重算（性能回退、无正确性风险）。
 */
interface CodeFoldCarry {
  /** 记账时的代码体可用宽（R-3 裸文本形 = 全宽；换宽失配键） */
  readonly bodyWidth: number;
  /** 记账时的源行文本（前缀比对键——slice 防外側改写） */
  readonly lines: readonly string[];
  /** 每源行呈现产出的视觉行组（R-3 恰单行——引用复用单元；外层账本不可改写，内层行集账面约定只读） */
  readonly rowsByLine: readonly StyledGrapheme[][][];
}

/** 模块级单条目承接账（上次开栏路径呈现结果；闭栏路径不触碰） */
let codeFoldCarry: CodeFoldCarry | null = null;

/**
 * 单视觉行截断（R-3 代码块裸文本形——不折行律）：段序列按显示宽截断、
 * 截断时帽内省 1 位让给省略号（ellipsize 律同族——'abcdefg…' 形）；适装
 * 整行直出零截断。段文本先消毒（与 layoutParts 同律）；样式随段携带
 *（高亮 token 跨截断点按段边界保留）。
 */
function capPartsLine(parts: readonly StylePart[], width: number): StyledGrapheme[] {
  const cells: StyledGrapheme[] = [];
  let used = 0;
  for (const part of parts) {
    for (const g of splitGraphemes(sanitizeDisplayText(part.text))) {
      const w = graphemeWidth(g);
      if (used + w > width) {
        // 已满仍遇内容：退尾腾 1 位（帽内省 1 位给 '…'——宽 1）再收口
        while (used > width - 1 && cells.length > 0) {
          const last = cells.pop()!;
          used -= graphemeWidth(last.grapheme);
        }
        cells.push({ grapheme: '…', style: part.style });
        return cells;
      }
      cells.push({ grapheme: g, style: part.style });
      used += w;
    }
  }
  return cells;
}

/**
 * 开栏单源行呈现 → 单视觉行（R-3 裸文本形：无 │ 前缀、不折行截断——
 * D4 承接的增量单元每帧只对新增/分歧行调用，前缀行引用复用不经本函数；
 * 每源行恰一行故承接账 rowsByLine 与源行 1:1）。
 */
function foldOpenCodeLine(line: string, width: number): StyledGrapheme[][] {
  return [capPartsLine([{ text: line, style: undefined }], width)];
}

/** 代码块 → 渲染行集（闭栏 + 已知语言走五类高亮；开栏/未知退单色——R-3
 * 裸文本形：无 │ 沟线、无语言标签收尾、超宽不折行截断每源行单视觉行） */
function codeRows(
  block: Extract<MarkdownBlock, { type: 'code' }>,
  width: number,
  theme: Readonly<ResolvedTheme>,
): StyledGrapheme[][] {
  const bodyWidth = Math.max(1, width);
  // 开栏路径（流式半截尾块）：逐源行增量承接（D4）——见 codeFoldCarry 头注
  if (block.open === true) {
    const prev = codeFoldCarry !== null && codeFoldCarry.bodyWidth === bodyWidth ? codeFoldCarry : null;
    // 前缀比对：与账目逐源行文本全等比对，首个分歧行前全部命中（纯增长
    // 热路 = O(前缀行数) 字符串引用比对 + O(新增行) 截断呈现）
    let reuse = 0;
    if (prev !== null) {
      const maxReuse = Math.min(prev.lines.length, block.lines.length);
      while (reuse < maxReuse && prev.lines[reuse] === block.lines[reuse]) reuse++;
    }
    const rows: StyledGrapheme[][] = [];
    const rowsByLine: StyledGrapheme[][][] = [];
    if (prev !== null) {
      for (let i = 0; i < reuse; i++) {
        // 前缀行呈现结果引用直入——零重算零分配（消费面只读不改行数组）
        const carried = prev.rowsByLine[i]!;
        rows.push(...carried);
        rowsByLine.push(carried);
      }
    }
    for (let i = reuse; i < block.lines.length; i++) {
      // 分歧行起增量呈现（含纯增长的新增行——每帧只算新增/分歧行）
      const lineRows = foldOpenCodeLine(block.lines[i] ?? '', bodyWidth);
      rows.push(...lineRows);
      rowsByLine.push(lineRows);
    }
    // 写回新账：承接段引用直入 + 新算段（下帧前缀比对的键与值）
    codeFoldCarry = { bodyWidth, lines: block.lines.slice(), rowsByLine };
    return rows;
  }
  // 闭栏路径：整体高亮重排（每原文行的样式段序列——token 按换行位切块
  // 分发；串接恒等原文律）+ 全量单行呈现；不读不写承接账（防闭开互承染样式）
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
  // 每源行单视觉行（R-3 不折行律——超宽截断 capPartsLine 单源收口；高亮
  // token 段跨截断点保留、无前缀列）
  const rows: StyledGrapheme[][] = [];
  const lineCount = tokens !== null ? partsByLine.length : block.lines.length;
  for (let i = 0; i < lineCount; i++) {
    const parts = tokens !== null ? (partsByLine[i] ?? []) : [{ text: block.lines[i] ?? '', style: undefined }];
    rows.push(capPartsLine(parts, bodyWidth));
  }
  return rows;
}

/**
 * 标题属性梯度（R-3 六级——规范 07 §4.3 ⑨）：H1 bold+underline 属性位 /
 * H2 bold / H3 bold+italic / H4-6 italic（缩梯 ▍ 与 ─ 下划线行双退役——
 * 属性位承载全部层级语义）。
 */
function headingBaseStyle(level: number): Readonly<CellStyle> {
  if (level <= 1) return { bold: true, underline: true };
  if (level === 2) return { bold: true };
  if (level === 3) return { bold: true, italic: true };
  return { italic: true };
}

/** 单块布局 → 渲染行集（块型分派；行首前缀 + 折行 + 层级缩进） */
export function blockRows(block: MarkdownBlock, width: number, theme: Readonly<ResolvedTheme>): StyledGrapheme[][] {
  switch (block.type) {
    case 'heading': {
      // R-3：字面 # 前缀保留呈现（渲染层重建——HEADING_RE 剥 # 的解析语义
      // 不动、spans 仍纯正文）+ 六级属性梯度（前缀与正文同属性——base 传播）
      const prefix = `${'#'.repeat(block.level)} `;
      const base = headingBaseStyle(block.level);
      const prefixWidth = prefix.length; // '#' 恒窄字符——长度即显示宽
      const body = layoutSpans(block.spans, Math.max(1, width - prefixWidth), theme, base);
      return body.map((row, index) => [
        ...(index === 0 ? prefixCells(prefix, base) : prefixCells(' '.repeat(prefixWidth))),
        ...row,
      ]);
    }
    case 'paragraph':
      return layoutSpans(block.spans, width, theme);
    case 'list-item': {
      // R-3：每层 4 列缩进 + 无序全深度统一 '- '（BULLET_LADDER 轮换退役）；
      // 有序 marker 数字右对齐两位（1-99 正文列恒对齐——≥100 退化不破）+
      // link 键色（codex LightBlue 档定值——cyan 族复用 link 键）；续行对齐
      // 前缀宽（视觉续挂）
      let prefix: string;
      let prefixStyle: Readonly<CellStyle> | undefined;
      if (block.ordered) {
        const digits = block.marker.replace(/[.)]$/, ''); // marker 原样（'1.'/'2)'）
        const punct = block.marker.slice(digits.length);
        prefix = `${' '.repeat(block.indent * 4)}${digits.padStart(2, ' ')}${punct} `;
        prefixStyle = { fg: theme.link };
      } else {
        prefix = `${' '.repeat(block.indent * 4)}- `;
      }
      const prefixWidth = splitGraphemes(prefix).reduce((sum, g) => sum + graphemeWidth(g), 0);
      const body = layoutSpans(block.spans, Math.max(1, width - prefixWidth), theme);
      return body.map((row, index) => [
        ...(index === 0 ? prefixCells(prefix, prefixStyle) : prefixCells(' '.repeat(prefixWidth))),
        ...row,
      ]);
    }
    case 'code':
      return codeRows(block, width, theme);
    case 'quote': {
      // R-3：> 前缀 + 整行 quoteText 行级基础色（┆ 沟线 + dim 退役——行内
      // 样式位叠加：spanStyle 行内位覆盖基础色同名位，code/link 色不丢）
      const base: Readonly<CellStyle> = { fg: theme.quoteText };
      const rows: StyledGrapheme[][] = [];
      for (const line of block.lines) rows.push(...layoutSpans(line, Math.max(1, width - 2), theme, base));
      return rows.map((row) => [...prefixCells('> ', base), ...row]);
    }
    case 'table':
      return tableRows(block, width, theme);
    case 'hr':
      // R-3：固定三 em-dash（不随宽伸展——全宽 ╌ 虚线形退役；dim 维持）
      return [prefixCells('———', DIM_STYLE)];
  }
}
