/**
 * Markdown 块布局分派件（批 10h 自 markdown.ts 拆出——块型 → 渲染行集）。
 *
 * 新增面（R1 批 10h）：GFM 表格（codex 双线制 + 自适应列宽 + 等分帽 +
 * weakRule 优先线色 + 逐列对齐 + 单元格级折行——V-3 注⑨④）；代码块自研
 * 高亮（五类 token → 主题键族）：闭栏全量重排 + **开栏增量高亮**（41 轮
 * 件 II——tokenizeLine 逐行续算同词法器单源；codex 开栏即高亮对标）；
 * 未知语言（开栏/闭栏同判据）诚实退单色。开栏防闪烁律的残理由 = 流式粘字
 * 回翻（streaming 件 tailSafe），样式回翻已随增量高亮消失。
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
import { blockGap, type MarkdownBlock } from './blocks.js';
import type { InlineSpan } from './inline.js';
import { highlight, resolveSpec, tokenizeLine, tokenStyle } from './highlight/index.js';
import type { CarryState, LanguageSpec } from './highlight/index.js';
import { DIM_STYLE, layoutSpans, prefixCells, spansWidth, type StylePart, type StyledGrapheme } from './layout.js';

/** 表格列最小宽（三连定界形下限） */
const TABLE_MIN_COL = 3;

/** 对齐档值列最小宽（42 轮件 B——键值退化两档判据；codex MIN_ALIGNED_COMPACT_VALUE_WIDTH 对应位。撞名异值警示：codex 另有 MIN_VALUE_WIDTH=3 是另一量——本仓不采） */
const MIN_ALIGNED_VALUE_WIDTH = 12;

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

/** 单元格最长 token 显示宽（空白分词、字素宽求和——键值退化判据的碎片计量） */
function maxTokenWidth(spans: readonly InlineSpan[]): number {
  const text = spans.map((span) => span.text).join('');
  let max = 0;
  for (const token of text.split(/\s+/)) {
    if (token === '') continue;
    let w = 0;
    for (const g of splitGraphemes(token)) w += graphemeWidth(g);
    max = Math.max(max, w);
  }
  return max;
}

/**
 * 键值记录卡形（42 轮件 B——窄表格键值退化形）：碎片判据命中后全表退化——
 * 每条数据行一张记录卡（卡内逐列 label/value）、全列呈现无指路行。
 * 两档：对齐档（labelWidth + 2 + MIN_ALIGNED_VALUE_WIDTH ≤ width——label
 * bold 补齐 + ': ' + 值列折行续行拼前缀〔list-item 支路先例同形〕）/ 堆叠档
 * （label 行 bold 缩进 1 + 值行缩进 2——label 超宽 layoutSpans 折行不静默
 * 裁）；记录间 ─ 细线（ruleStyle 单源、随宽伸展形）；每视觉行尾空白裁；
 * 对齐位放弃（codex 签名同构——退化形无列宽概念）。
 */
function renderRecordRows(
  block: Extract<MarkdownBlock, { type: 'table' }>,
  width: number,
  theme: Readonly<ResolvedTheme>,
): StyledGrapheme[][] {
  const allCols = Math.max(block.header.length, ...block.rows.map((row) => row.length), 1);
  // labelWidth = max 表头显示宽（不帽——循 codex：键值形全列呈现须全名列宽）
  const labelWidth = Math.max(1, ...block.header.map((spans) => spansWidth(spans ?? [])));
  const aligned = labelWidth + 2 + MIN_ALIGNED_VALUE_WIDTH <= width;
  const valueWidth = Math.max(1, aligned ? width - labelWidth - 2 : width - 2);
  const rule = ruleStyle(theme);
  const rows: StyledGrapheme[][] = [];
  for (let i = 0; i < block.rows.length; i++) {
    if (i > 0) rows.push(prefixCells('─'.repeat(width), rule)); // 记录间细线（仅记录间；随宽伸展）
    const row = block.rows[i]!;
    for (let j = 0; j < allCols; j++) {
      const laidValue = layoutSpans(row[j] ?? [], valueWidth, theme);
      if (aligned) {
        // 对齐档：label 恒单行（表头宽 ≤ labelWidth = max——label 位不帽），
        // 首行 = label 补齐 + ': ' + 值首行；值续行拼 labelWidth+2 空格前缀
        //（前缀拼装形——list-item 支路先例同构）；空值至少 label 行一行
        const labelCells = (layoutSpans(block.header[j] ?? [], labelWidth, theme, { bold: true })[0] ?? []).slice();
        for (let r = 0; r < Math.max(1, laidValue.length); r++) {
          const line: StyledGrapheme[] = [];
          if (r === 0) line.push(...labelCells, ...padCells(labelWidth - rowWidth(labelCells)), ...prefixCells(': '));
          else line.push(...padCells(labelWidth + 2)); // 值续行对齐值列左缘
          if (r < laidValue.length) line.push(...laidValue[r]!);
          trimTrailingSpaces(line);
          rows.push(line);
        }
      } else {
        // 堆叠档：label 行（bold）缩进 1 + 值行缩进 2；label 超宽在 width−1
        //（下夹 1）布局折行不静默裁；空值零值行（仅 label 行）
        const laidLabel = layoutSpans(block.header[j] ?? [], Math.max(1, width - 1), theme, { bold: true });
        for (let r = 0; r < laidLabel.length; r++) {
          const line = [...prefixCells(' '), ...laidLabel[r]!];
          trimTrailingSpaces(line);
          rows.push(line);
        }
        for (let r = 0; r < laidValue.length; r++) {
          const line = [...prefixCells('  '), ...laidValue[r]!];
          trimTrailingSpaces(line);
          rows.push(line);
        }
      }
    }
  }
  return rows;
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
 * 引用基色贯通单格（42 轮件 C——B 腿后处理）：无显式 fg 的格补 quoteText、
 * 显式 fg/bold 等属性位原样保留（与 R-3 行级基色落 fg 位同构——行内
 * code/link 色与标题属性梯度不丢；href 随字素原样携带）。
 */
function tintQuoteCell(cell: StyledGrapheme, quoteText: Readonly<CellStyle>['fg']): StyledGrapheme {
  return cell.style !== undefined && cell.style.fg !== undefined
    ? cell
    : { grapheme: cell.grapheme, href: cell.href, style: { ...cell.style, fg: quoteText } };
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
  // 键值退化判据（42 轮件 B——codex 同语义：窄表格列帽收缩致碎片化时改键值
  // 记录呈现）：全列集（列收缩**前**——键值形全列呈现无丢列）先算等分帽，
  // 再逐数据行逐列「最长 token 显示宽 > 列帽宽 min(natural, cap)」碎片计量
  //（只扫数据行——表头断 token 不触发；宽表 capAll 无穷 → colCap =
  // natural ≥ 任意 token 宽恒不触发，宽表零退化）。碎片行数 ≥ threshold
  //（单行表 1 / 多行表 max(2, ceil(rows/3))——少数碎片行是噪音不整表陪葬）
  // → 整表提前退化 renderRecordRows；列帽宽 ≥ MIN_ALIGNED_VALUE_WIDTH 免
  //（列够宽自然折行，无碎片病理）
  const naturalAll: number[] = [];
  for (let j = 0; j < allCols; j++) {
    const cells = [block.header[j], ...block.rows.map((row) => row[j])];
    naturalAll[j] = Math.max(TABLE_MIN_COL, ...cells.map((spans) => (spans === undefined ? 0 : spansWidth(spans))));
  }
  const availAll = Math.max(allCols * TABLE_MIN_COL, width - 2 * allCols);
  const totalAll = naturalAll.reduce((sum, w) => sum + w, 0);
  const capAll =
    totalAll > availAll ? Math.max(TABLE_MIN_COL, Math.floor(availAll / allCols)) : Number.POSITIVE_INFINITY;
  let fragmentedRows = 0;
  for (const row of block.rows) {
    let fragmented = false;
    for (let j = 0; j < allCols; j++) {
      const colCap = Math.min(naturalAll[j]!, capAll);
      if (colCap >= MIN_ALIGNED_VALUE_WIDTH) continue;
      if (maxTokenWidth(row[j] ?? []) > colCap) {
        fragmented = true;
        break;
      }
    }
    if (fragmented) fragmentedRows++;
  }
  const dataRows = block.rows.length;
  const threshold = dataRows === 1 ? 1 : Math.max(2, Math.ceil(dataRows / 3));
  if (fragmentedRows >= threshold) return renderRecordRows(block, width, theme);
  // 窄屏列收缩（挖掘 27 轮 [1]）：每列最窄占位 = TABLE_MIN_COL 3 + 两侧空
  // 2 = 5——双地板（avail≥cols×3 / cap≥3）保列宽下限使窄屏 tableWidth 恒
  // ≥5×cols 溢出视口，越界列下游 writeText 静默丢（markdown 逐游程无钳制
  // + cell 越界静默吸收）——整列裁失无指路。收缩到屏幕可容纳列数
  // floor(width/5)（≥1 下限），余列丢弃 + 末行「+ N 列更多」dim 指路
  //（诚实边界优于静默裁失；列宽地板是反退化取舍不动）
  const maxCols = Math.max(1, Math.floor(width / (TABLE_MIN_COL + 2)));
  const droppedCols = Math.max(0, allCols - maxCols);
  const cols = allCols - droppedCols;
  // 自然列宽 = 表头 + 数据行整格宽最大值（min 3）——全列前缀切片复用
  //（件 B 省算形：判据段已算全列，保留列不再重扫）
  const natural = naturalAll.slice(0, cols);
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
 * 修法：呈现按源行独立——行产出只依赖（该行文本, bodyWidth, spec, theme,
 * 前行词法承载态），不随后续行增长变化，故按源行粒度承接（R-3 裸文本形
 * 下每源行恰一视觉行，账目与源行 1:1）：
 * - 命中判据（内容键）= 记账 bodyWidth / spec / theme 相同 + 源行前缀逐行
 *   全等——跨块对象成立（tokenizeLine + capPartsLine 纯函数确定性：同键
 *   同产出，引用复用即字节等价）。41 轮件 II 键扩四维：spec / theme 入键
 *   （语言表与主题均为单例引用比对；theme 对标 codex theme_revision）；
 * - 前缀行呈现结果按**引用复用**（零重算零分配——与 MarkdownDoc.fromBlocks
 *   块级承接同律的引用复用），自分歧行起增量重算（缩量/中行改写同样自
 *   分歧行起重算，不丢字不错位；词法承载链 per-line 入账——transducer 纯
 *   左到右：前缀行全等即承载链前缀全等，分歧行从账面承载态续算天然正确，
 *   免全量重算）；
 * - 闭栏帧**不读不写**本账（闭栏 = 整体高亮重排全量重算——产出形与开栏
 *   单色不同，互承即污染样式回翻）；换宽/换语言/换主题帧键失配自然全量
 *   重算；
 * - 单条目记账：开栏围栏必吃到文末 → 每文档至多一个开栏块；多文档交错
 *   渲染时键失配仅退化为全量重算（性能回退、无正确性风险）。
 */
interface CodeFoldCarry {
  /** 记账时的代码体可用宽（R-3 裸文本形 = 全宽；换宽失配键） */
  readonly bodyWidth: number;
  /** 记账时的语言表引用（null = 未知语言单色腿；spec 为 languages.ts 模块级单例——引用比对即语言同一性；41 轮件 II 入键） */
  readonly spec: LanguageSpec | null;
  /** 记账时的主题引用（对标 codex theme_revision——失配退全量重算无正确性风险；41 轮件 II 入键） */
  readonly theme: Readonly<ResolvedTheme>;
  /** 记账时的源行文本（前缀比对键——slice 防外側改写） */
  readonly lines: readonly string[];
  /** 每源行呈现产出的视觉行组（R-3 恰单行——引用复用单元；外层账本不可改写，内层行集账面约定只读） */
  readonly rowsByLine: readonly StyledGrapheme[][][];
  /** 每源行行尾词法承载态（carries[i] = 行 i 扫后 carry，行 i+1 续算入参；41 轮件 II 入账） */
  readonly carries: readonly (CarryState | null)[];
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
 * 每源行恰一行故承接账 rowsByLine 与源行 1:1）。parts 由调用方构造：
 * 已知语言 = tokenizeLine 单行 token 产出映射（plain→undefined、余四类
 * tokenStyle——与闭栏产出映射同一单源）；未知语言 = 整行单段无样式。
 */
function foldOpenCodeLine(parts: readonly StylePart[], width: number): StyledGrapheme[][] {
  return [capPartsLine(parts, width)];
}

/** 代码块 → 渲染行集（闭栏 + 已知语言走五类高亮全量重排；开栏已知语言
 * 增量高亮〔41 轮件 II〕、开栏未知语言退单色——R-3 裸文本形：无 │ 沟线、
 * 无语言标签收尾、超宽不折行截断每源行单视觉行） */
function codeRows(
  block: Extract<MarkdownBlock, { type: 'code' }>,
  width: number,
  theme: Readonly<ResolvedTheme>,
): StyledGrapheme[][] {
  const bodyWidth = Math.max(1, width);
  // 开栏路径（流式半截尾块）：逐源行增量承接（D4）+ 已知语言增量高亮
  //（41 轮件 II——tokenizeLine 单行续算，与闭栏同词法器单源；codex 开栏
  // 即高亮对标）——见 codeFoldCarry 头注。未知语言 spec = null 走整行单色
  // 腿（resolveSpec 同闭栏同一判据——诚实不发明半高亮）
  if (block.open === true) {
    const spec = resolveSpec(block.language);
    const prev =
      codeFoldCarry !== null &&
      codeFoldCarry.bodyWidth === bodyWidth &&
      codeFoldCarry.spec === spec &&
      codeFoldCarry.theme === theme
        ? codeFoldCarry
        : null;
    // 前缀比对：与账目逐源行文本全等比对，首个分歧行前全部命中（纯增长
    // 热路 = O(前缀行数) 字符串引用比对 + O(新增行) 词法+截断呈现）。词法
    // 承载链纯左到右：前缀行全等（同 spec）即各前行尾承载态与账面全等
    // ——前缀行呈现引用复用合法（同键同产出）
    let reuse = 0;
    if (prev !== null) {
      const maxReuse = Math.min(prev.lines.length, block.lines.length);
      while (reuse < maxReuse && prev.lines[reuse] === block.lines[reuse]) reuse++;
    }
    const rows: StyledGrapheme[][] = [];
    const rowsByLine: StyledGrapheme[][][] = [];
    const carries: (CarryState | null)[] = [];
    if (prev !== null) {
      for (let i = 0; i < reuse; i++) {
        // 前缀行呈现结果引用直入——零重算零分配（消费面只读不改行数组）
        const carried = prev.rowsByLine[i]!;
        rows.push(...carried);
        rowsByLine.push(carried);
        carries.push(prev.carries[i]!);
      }
    }
    // 分歧行起词法续算：承接段末位承载态作首行入参（无承接 = null 从零起）
    let carry: CarryState | null = reuse > 0 && prev !== null ? (prev.carries[reuse - 1] ?? null) : null;
    for (let i = reuse; i < block.lines.length; i++) {
      const line = block.lines[i] ?? '';
      let parts: StylePart[];
      if (spec === null) {
        // 未知语言：整行单段单色（每行独立——carry 恒 null）
        parts = [{ text: line, style: undefined }];
      } else {
        // 已知语言：单行词法续算 + 产出映射（plain→undefined 与闭栏同源）
        const r = tokenizeLine(line, spec, carry);
        carry = r.carryOut;
        parts = r.tokens.map((token) => ({
          text: token.text,
          style: token.type === 'plain' ? undefined : tokenStyle(token.type, theme),
        }));
      }
      const lineRows = foldOpenCodeLine(parts, bodyWidth);
      rows.push(...lineRows);
      rowsByLine.push(lineRows);
      carries.push(carry);
    }
    // 写回新账：承接段引用直入 + 新算段（下帧前缀比对的键与值）
    codeFoldCarry = { bodyWidth, spec, theme, lines: block.lines.slice(), rowsByLine, carries };
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
      // 子块化渲染（42 轮件 C——引用内嵌套块，codex 同语义）：children 逐块
      // blockRows 递归（子块宽 width−2）+ 块间 blockGap 空行行（判据循顶层
      // 组装律——同类相邻不隔，gap 行同 '> ' 前缀）；基色贯通 B 腿后处理
      //（不动 blockRows 签名——41 轮件 II 刚收口的全支路零波及）：子行集
      // 逐格无显式 fg 补 quoteText、显式 fg/属性位保留（code/link 色不丢，
      // 与 R-3 行级基色落 fg 位同构）；每视觉行行尾无样式空白裁；空块
      // 单行 '> ' 占位（空 children 占位行可被子块化改写——流式侧恒不稳）
      const base: Readonly<CellStyle> = { fg: theme.quoteText };
      const innerWidth = Math.max(1, width - 2);
      const rows: StyledGrapheme[][] = [];
      let prevRowCount = 0; // 前子块渲染行数（blockGap 第三参——多行列表项判据同律）
      for (let k = 0; k < block.children.length; k++) {
        const child = block.children[k]!;
        // 引用内空行 = 子块分隔（blockGap 单源；前缀已有行才补——零行块不改判据）
        if (k > 0 && prevRowCount > 0 && blockGap(block.children[k - 1]!, child, prevRowCount) === 1) {
          rows.push(prefixCells('> ', base));
        }
        const childRows = blockRows(child, innerWidth, theme);
        prevRowCount = childRows.length;
        for (const raw of childRows) {
          const row = [...raw];
          trimTrailingSpaces(row); // 裁在染色前（染色后无样式空白不可辨——内容空格不误伤）
          const line = prefixCells('> ', base);
          for (const cell of row) line.push(tintQuoteCell(cell, theme.quoteText));
          rows.push(line);
        }
      }
      if (rows.length === 0) return [prefixCells('> ', base)]; // 空 quote 单行占位
      return rows;
    }
    case 'table':
      return tableRows(block, width, theme);
    case 'hr':
      // R-3：固定三 em-dash（不随宽伸展——全宽 ╌ 虚线形退役；dim 维持）
      return [prefixCells('———', DIM_STYLE)];
  }
}
