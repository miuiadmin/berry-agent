/**
 * Markdown 件单测：行内解析四标记 + 块解析七形 + MarkdownDoc 渲染落位
 * （中性配色样式位断言 / 折行算术 / 块间空行 / blockCount 帽单位）。
 */
import { describe, expect, it } from 'vitest';
import { ansiColor, CellGrid } from '../../engine/index.js';
import { DEFAULT_THEME } from '../theme/index.js';
import { blockEquals, parseMarkdown } from './blocks.js';
import { parseInline } from './inline.js';
import { MarkdownDoc } from './markdown.js';

/* ---------------- 助手 ---------------- */

/** 读回一行（未写格按空格、trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 渲染到新网格（量高协商简化形——region 高给足） */
function renderDoc(doc: MarkdownDoc, width: number): CellGrid {
  const grid = new CellGrid(width, Math.max(1, doc.measure(width)));
  doc.render(grid, { row: 0, col: 0, width, height: grid.rows });
  return grid;
}

/* ---------------- parseInline ---------------- */

describe('parseInline 行内解析', () => {
  it('普通文本单段无样式', () => {
    expect(parseInline('hello world')).toEqual([{ text: 'hello world' }]);
  });

  it('四标记各解析（bold/italic/code/link）', () => {
    expect(parseInline('**重要**')).toEqual([{ text: '重要', bold: true }]);
    expect(parseInline('*斜体*')).toEqual([{ text: '斜体', italic: true }]);
    expect(parseInline('`code`')).toEqual([{ text: 'code', code: true }]);
    expect(parseInline('[文档](https://example.com)')).toEqual([{ text: '文档', underline: true }]);
  });

  it('** 优先于 *（前缀撞车 bold 赢）', () => {
    expect(parseInline('**b**')).toEqual([{ text: 'b', bold: true }]);
  });

  it('未闭合标记回退普通文本（坏输入不丢字）', () => {
    expect(parseInline('*abc')).toEqual([{ text: '*abc' }]);
    expect(parseInline('`unclosed')).toEqual([{ text: '`unclosed' }]);
    expect(parseInline('[label no url')).toEqual([{ text: '[label no url' }]);
  });

  it('混合序列保序分段', () => {
    expect(parseInline('a *b* `c` **d**')).toEqual([
      { text: 'a ' },
      { text: 'b', italic: true },
      { text: ' ' },
      { text: 'c', code: true },
      { text: ' ' },
      { text: 'd', bold: true },
    ]);
  });

  /* -------- 翼判据回归锁（坏配对不吞标记——坏输入不丢字契约） -------- */

  it('翼判据：开标记后空白不吞（a * b * c 无 italic、星号全保留拼接还原）', () => {
    const spans = parseInline('a * b * c');
    // 修前：纯 indexOf 配对命中 → ' b ' 成 italic 段、两个 '*' 被吞（丢字）
    expect(spans.some((s) => s.italic === true)).toBe(false);
    expect(spans.map((s) => s.text).join('')).toBe('a * b * c');
  });

  it('翼判据：闭标记前空白同不吞（a *b * c 全文还原）', () => {
    const spans = parseInline('a *b * c');
    expect(spans.some((s) => s.italic === true)).toBe(false);
    expect(spans.map((s) => s.text).join('')).toBe('a *b * c');
  });

  it('翼判据：bold 两侧空白同不吞（a ** b ** c 全文还原）', () => {
    const spans = parseInline('a ** b ** c');
    expect(spans.some((s) => s.bold === true)).toBe(false);
    expect(spans.map((s) => s.text).join('')).toBe('a ** b ** c');
  });

  it('翼判据：散文乘号形零丢字（总价 = 单价 * 3 * 数量）', () => {
    const spans = parseInline('总价 = 单价 * 3 * 数量');
    expect(spans.some((s) => s.italic === true)).toBe(false);
    expect(spans.map((s) => s.text).join('')).toBe('总价 = 单价 * 3 * 数量');
  });

  it('翼判据：好形零扰动（**bold** / *em* 贴邻非空白仍成 span）', () => {
    expect(parseInline('**b**')).toEqual([{ text: 'b', bold: true }]);
    expect(parseInline('*e*')).toEqual([{ text: 'e', italic: true }]);
  });
});

/* ---------------- parseMarkdown ---------------- */

describe('parseMarkdown 块解析', () => {
  it('标题 level 识别（# 数）', () => {
    const blocks = parseMarkdown('## 标题二\n### 标题三');
    expect(blocks).toEqual([
      { type: 'heading', level: 2, spans: [{ text: '标题二' }] },
      { type: 'heading', level: 3, spans: [{ text: '标题三' }] },
    ]);
  });

  it('段落软换行拼接（两行一段）+ 空行断段', () => {
    const blocks = parseMarkdown('第一行\n第二行\n\n第二段');
    expect(blocks).toEqual([
      { type: 'paragraph', spans: [{ text: '第一行 第二行' }] },
      { type: 'paragraph', spans: [{ text: '第二段' }] },
    ]);
  });

  it('无序列表（marker • + 缩进层级）', () => {
    const blocks = parseMarkdown('- 甲\n  - 乙（嵌套）\n- 丙');
    expect(blocks).toEqual([
      { type: 'list-item', ordered: false, marker: '•', indent: 0, spans: [{ text: '甲' }] },
      { type: 'list-item', ordered: false, marker: '•', indent: 1, spans: [{ text: '乙（嵌套）' }] },
      { type: 'list-item', ordered: false, marker: '•', indent: 0, spans: [{ text: '丙' }] },
    ]);
  });

  it('有序列表 marker 原样', () => {
    const blocks = parseMarkdown('1. 甲\n2. 乙');
    expect(blocks[0]).toEqual({ type: 'list-item', ordered: true, marker: '1.', indent: 0, spans: [{ text: '甲' }] });
    expect(blocks[1]).toEqual({ type: 'list-item', ordered: true, marker: '2.', indent: 0, spans: [{ text: '乙' }] });
  });

  it('围栏代码块（language 记名 + 多行体 + 行内标记不解析）', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1;\nnot **bold**\n```');
    expect(blocks).toEqual([{ type: 'code', lines: ['const a = 1;', 'not **bold**'], language: 'ts' }]);
  });

  it('多词 info 围栏：首词记语言、行尾剩余忽略（修前整块退化段落 + 尾闭栏成空 open 块）', () => {
    // '```python title=x' 旧 FENCE_RE 单词 + $ 行尾锚定不匹配 → 整代码块按段落
    // 解析（软换行折叠 + 反引号裸露）；尾部真闭栏行反被解析成 lines=[] 的空
    // open code 块。CommonMark 语义：info 串取首词为语言、其余忽略。
    const blocks = parseMarkdown('```python title=x\nprint(1)\n```');
    expect(blocks).toEqual([{ type: 'code', lines: ['print(1)'], language: 'python' }]);
  });

  it('多词 info 波浪围栏同律（~~~js foo=bar）', () => {
    const blocks = parseMarkdown('~~~js foo=bar\nlet x;\n~~~');
    expect(blocks).toEqual([{ type: 'code', lines: ['let x;'], language: 'js' }]);
  });

  it('未闭围栏收至文末（防御——open 标记位在场，高亮冻结判据消费）', () => {
    const blocks = parseMarkdown('```\nabc');
    expect(blocks).toEqual([{ type: 'code', lines: ['abc'], language: undefined, open: true }]);
  });

  it('围栏内反引号起首行不闭栏（B-render 批——修前只查首字符与总长，`bold` 行误闭栏、后续行外泄成块）', () => {
    // CommonMark 闭栏形：trim 后整行全为围栏字符——'`bold` means emphasis'
    // 首字符同、总长 ≥3 但非全反引号，不得闭栏（markdown-about-markdown /
    // 围栏内模板串场景高频）
    const blocks = parseMarkdown('```markdown\n`bold` means emphasis\n| a | b |\n```');
    expect(blocks).toEqual([{ type: 'code', lines: ['`bold` means emphasis', '| a | b |'], language: 'markdown' }]);
  });

  it('闭栏混合形不闭（``x 非全同字符）；更长同字符闭栏仍闭（````` ≥ ```)', () => {
    // '``x'：首字符同、总长 3——修前误闭栏（块被截断丢 open 位）
    expect(parseMarkdown('```\nabc\n``x')).toEqual([
      { type: 'code', lines: ['abc', '``x'], language: undefined, open: true },
    ]);
    // 等长以上：5 个反引号闭 3 个反引号开栏
    expect(parseMarkdown('```\nabc\n`````')).toEqual([{ type: 'code', lines: ['abc'], language: undefined }]);
  });

  it('异字符围栏不互闭（``` 体内 ~~~ 行不闭反栏——marker 首字符单源）', () => {
    expect(parseMarkdown('```\n~~~\n```')).toEqual([{ type: 'code', lines: ['~~~'], language: undefined }]);
  });

  it('引用连续行归块（行内解析入块）', () => {
    const blocks = parseMarkdown('> 引用一\n> 引用 *二*\n\n正文');
    expect(blocks[0]).toEqual({
      type: 'quote',
      lines: [[{ text: '引用一' }], [{ text: '引用 ' }, { text: '二', italic: true }]],
    });
    expect(blocks[1]).toEqual({ type: 'paragraph', spans: [{ text: '正文' }] });
  });

  it('水平线三形', () => {
    expect(parseMarkdown('---')[0]).toEqual({ type: 'hr' });
    expect(parseMarkdown('***')[0]).toEqual({ type: 'hr' });
    expect(parseMarkdown('___')[0]).toEqual({ type: 'hr' });
  });

  it('CRLF / CR 统一 LF', () => {
    expect(parseMarkdown('a\r\nb\rc')).toEqual([{ type: 'paragraph', spans: [{ text: 'a b c' }] }]);
  });

  it('空文本零块', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n')).toEqual([]);
  });

  it('GFM 表格：表头 + 定界 + 数据行（单元格行内解析、剥外缘竖线）', () => {
    const blocks = parseMarkdown('| 名 | 值 |\n| --- | --- |\n| 甲 | `code` |\n| 乙 | 2 |');
    expect(blocks).toEqual([
      {
        type: 'table',
        header: [[{ text: '名' }], [{ text: '值' }]],
        rows: [
          [[{ text: '甲' }], [{ text: 'code', code: true }]],
          [[{ text: '乙' }], [{ text: '2' }]],
        ],
        align: [null, null],
      },
    ]);
  });

  it('GFM 表格对齐位三形（:--- 左 / :---: 中 / ---: 右）', () => {
    const blocks = parseMarkdown('| a | b | c |\n|:-|:-:|-:|');
    expect((blocks[0] as { align: unknown }).align).toEqual(['left', 'center', 'right']);
  });

  it('非定界次行不判表（含竖线段落回退——坏输入不丢字）', () => {
    const blocks = parseMarkdown('a | b\nc | d');
    expect(blocks[0]).toEqual({ type: 'paragraph', spans: [{ text: 'a | b c | d' }] });
  });

  it('表格数据行止于空行/无竖线行（GFM 行连续律）', () => {
    const blocks = parseMarkdown('| a |\n| --- |\n| 1 |\n\n正文');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'table' });
    expect(blocks[1]).toEqual({ type: 'paragraph', spans: [{ text: '正文' }] });
  });
});

/* ---------------- MarkdownDoc 渲染 ---------------- */

describe('MarkdownDoc 渲染', () => {
  it('blockCount = 块数（滚动帽额度单位）', () => {
    const doc = MarkdownDoc.of('段落一\n\n## 标题\n\n- 列表');
    expect(doc.blockCount).toBe(3);
  });

  it('标题渲染：bold 位 + H1 尾线（H1/H2）/ H3 无尾线', () => {
    const doc = MarkdownDoc.of('# 大标题\n\n### 小标题');
    const grid = renderDoc(doc, 20);
    expect(grid.getCell(0, 0)?.style.bold).toBe(true);
    expect(readRow(grid, 1, 20)).toBe('────────────────────'); // H1 尾线
    expect(readRow(grid, 3, 20)).toBe('小标题');
    expect(readRow(grid, 4, 20)).toBe(''); // H3 无尾线
  });

  it('行内代码着 codeInline 键（缺省主题 16 档 #7ee787 → 绿 2——七役扫描批 ExactColor 覆写；与 accent〔cyan 6〕分立）', () => {
    const doc = MarkdownDoc.of('看 `npm test` 命令');
    const grid = renderDoc(doc, 40);
    const codeCell = grid.getCell(0, 3); // '看' 宽 2 占 col 0-1、空格 col 2、code 首字 col 3
    expect(codeCell?.style.fg).toBe(ansiColor(2)); // 覆写位 2（修前最近邻塌缩 7 亮灰）
    expect(codeCell?.grapheme).toBe('n');
    expect(grid.getCell(0, 0)?.style.fg).toBeUndefined(); // 普通文本不着色
  });

  it('链接 underline 呈现 label（URL 不外显）', () => {
    const doc = MarkdownDoc.of('见 [文档](https://x.dev) 说明');
    const grid = renderDoc(doc, 40);
    expect(readRow(grid, 0, 40)).toBe('见 文档 说明');
    expect(grid.getCell(0, 3)?.style.underline).toBe(true); // '见' 宽 2 + 空格 → label 首字 col 3
  });

  it('引用块：┆ 前缀 + 整块 dim', () => {
    const doc = MarkdownDoc.of('> 引用行');
    const grid = renderDoc(doc, 20);
    expect(readRow(grid, 0, 20)).toBe('┆ 引用行');
    expect(grid.getCell(0, 2)?.style.dim).toBe(true);
  });

  it('代码块：│ 前缀 + 原样呈现（**bold** 不解析）', () => {
    const doc = MarkdownDoc.of('```\n**raw**\n```');
    const grid = renderDoc(doc, 20);
    expect(readRow(grid, 0, 20)).toBe('│ **raw**');
    expect(grid.getCell(0, 2)?.style.bold).toBeUndefined();
  });

  it('列表：• 前缀 + 嵌套缩进 + 续行对齐前缀宽', () => {
    const doc = MarkdownDoc.of('- 长列表项内容折行续挂对齐前缀列的位置测试样例文本');
    const grid = renderDoc(doc, 14);
    expect(readRow(grid, 0, 14)).toBe('• 长列表项内容'); // 前缀 '• ' 2 格 + body 12 列 = 6 字
    expect(readRow(grid, 1, 14)).toBe('  折行续挂对齐'); // 续行缩进 = 前缀宽 2 + body 12 列同样 6 字
  });

  it('块间空行分隔（n 块 n-1 空行）+ measure 含间距', () => {
    const doc = MarkdownDoc.of('段落甲\n\n段落乙');
    expect(doc.measure(20)).toBe(3); // 两行正文 + 一空行
    const grid = renderDoc(doc, 20);
    expect(readRow(grid, 0, 20)).toBe('段落甲');
    expect(readRow(grid, 1, 20)).toBe('');
    expect(readRow(grid, 2, 20)).toBe('段落乙');
  });

  it('CJK 折行按显示宽（宽字不产半字、恰折点空格跳过）', () => {
    const doc = MarkdownDoc.of('中文折行算术测试文本宽度恰好超过限制宽度时按显示宽硬折'); // 26 字 = 52 列
    const grid = renderDoc(doc, 20);
    expect(readRow(grid, 0, 20)).toBe('中文折行算术测试文本'); // 10 字 20 列满折
    expect(readRow(grid, 1, 20)).toBe('宽度恰好超过限制宽度'); // 10 字续折
    expect(doc.measure(20)).toBe(3);
  });

  it('折点空格游程跳过（行首不悬挂空格）', () => {
    const doc = MarkdownDoc.of('alpha beta gamma delta epsilon zeta');
    const grid = renderDoc(doc, 11);
    expect(readRow(grid, 0, 11)).toBe('alpha beta');
    expect(readRow(grid, 1, 11)).toBe('gamma delta'); // 折点后空格跳过——非 ' gamma'
  });

  it('量高承诺：measure = render 行数（同宽一致）', () => {
    const doc = MarkdownDoc.of('# 标题\n\n段落正文\n\n- 列表项\n\n```\ncode\n```\n\n> 引用\n\n---');
    const h = doc.measure(30);
    const grid = new CellGrid(30, h);
    expect(() => doc.render(grid, { row: 0, col: 0, width: 30, height: h })).not.toThrow();
    // 逐行至少有一行非空（渲染确发生）
    let anyText = false;
    for (let r = 0; r < h; r++) if (readRow(grid, r, 30) !== '') anyText = true;
    expect(anyText).toBe(true);
  });

  it('宽字素游程起点正确（样式段接宽字符不错位——回归锁）', () => {
    // 行内代码段以宽字开头：前缀普通文本 1 列 + 空格 1 列 → code 段起点 col 2
    const doc = MarkdownDoc.of('a `中文码`');
    const grid = renderDoc(doc, 20);
    expect(readRow(grid, 0, 20)).toBe('a 中文码');
    expect(grid.getCell(0, 2)?.style.fg).toBe(ansiColor(2)); // 起点按格位不按码位（codeInline 覆写位 2）
    expect(grid.getCell(0, 2)?.grapheme).toBe('中');
  });

  it('accent 色不入场（正文不混用——引擎节件 3 纪律）', () => {
    const doc = MarkdownDoc.of('# 标题\n\n正文 `code` **粗** [链](u)\n\n> 引用\n\n---');
    const grid = renderDoc(doc, 30);
    const accent = DEFAULT_THEME.accent;
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.columns; c++) {
        const cell = grid.getCell(r, c);
        if (cell !== null) expect(cell.style.fg === accent).toBe(false);
      }
    }
  });
});

/* ---------------- blockEquals / fromBlocks 增量缓存（批 10h） ---------------- */

describe('blockEquals 块结构相等（块级缓存命中判据）', () => {
  it('同构同内容恒等（深比较无引用捷径）', () => {
    const a = parseMarkdown('# 标\n\n- 项 `c`\n\n```\nx\n```');
    const b = parseMarkdown('# 标\n\n- 项 `c`\n\n```\nx\n```');
    expect(a).toHaveLength(b.length);
    for (let i = 0; i < a.length; i++) expect(blockEquals(a[i]!, b[i]!)).toBe(true);
  });

  it('开栏标记位参与相等（open 差一票否决——样式回翻防线）', () => {
    const [closed] = parseMarkdown('```\nx\n```');
    const [open] = parseMarkdown('```\nx');
    expect(blockEquals(closed!, open!)).toBe(false);
  });

  it('内容差 / 类型差 / 表格行差各否决', () => {
    expect(blockEquals(parseMarkdown('a')[0]!, parseMarkdown('b')[0]!)).toBe(false);
    expect(blockEquals(parseMarkdown('# a')[0]!, parseMarkdown('a')[0]!)).toBe(false);
    const t1 = parseMarkdown('| a |\n| --- |\n| 1 |')[0]!;
    const t2 = parseMarkdown('| a |\n| --- |\n| 2 |')[0]!;
    expect(blockEquals(t1, t2)).toBe(false);
  });
});

describe('MarkdownDoc.fromBlocks 增量装配（流式件帧路径）', () => {
  it('同构块承接旧行集（引用相等 = 缓存命中直锁——布局算术只跑增量块）', () => {
    const text = '# 标题\n\n段落一\n\n段落二';
    const prev = MarkdownDoc.of(text);
    const prevRows = prev.prefixRows(40, prev.blockCount); // 先开宽填基缓存
    const next = MarkdownDoc.fromBlocks(parseMarkdown(text + '\n\n段落三'), prev);
    const nextRows = next.prefixRows(40, prev.blockCount); // 同构前缀块承接
    let contentChecked = 0;
    for (let i = 0; i < prevRows.length; i++) {
      if (prevRows[i]!.length === 0) continue; // 块间空行每次新 []——只锁内容行
      expect(nextRows[i]).toBe(prevRows[i]); // 同对象——非重算
      contentChecked++;
    }
    expect(contentChecked).toBeGreaterThanOrEqual(3); // 三块内容行全走到（非空断言防伪绿）
  });

  it('渲染同源：fromBlocks 与文本直构同行集（增量路径零第二渲染形）', () => {
    const text = '# 标题\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n```ts\nconst x = 1;\n```';
    const direct = MarkdownDoc.of(text);
    const fromBlocks = MarkdownDoc.fromBlocks(parseMarkdown(text), null);
    expect(fromBlocks.measure(40)).toBe(direct.measure(40));
    const g1 = renderDoc(direct, 40);
    const g2 = renderDoc(fromBlocks, 40);
    for (let r = 0; r < g1.rows; r++) {
      expect(readRow(g2, r, 40)).toBe(readRow(g1, r, 40));
    }
  });

  it('换宽清缓存（防错位命中）', () => {
    const doc = MarkdownDoc.of('# 标题\n\n段落');
    doc.measure(40);
    doc.measure(30); // 换宽——重布局
    const grid = renderDoc(doc, 30);
    expect(readRow(grid, 0, 30)).toBe('标题');
    expect(grid.getCell(0, 0)?.style.bold).toBe(true);
  });
});
