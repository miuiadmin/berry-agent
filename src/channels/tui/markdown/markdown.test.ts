/**
 * Markdown 件单测：行内解析四标记 + 块解析七形 + MarkdownDoc 渲染落位
 * （中性配色样式位断言 / 折行算术 / 块间空行 / blockCount 帽单位）。
 */
import { describe, expect, it } from 'vitest';
import { ansiColor, CellGrid } from '../../engine/index.js';
import { ACCENT_INDEX } from '../theme.js';
import { parseMarkdown } from './blocks.js';
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

  it('未闭围栏收至文末（防御）', () => {
    const blocks = parseMarkdown('```\nabc');
    expect(blocks).toEqual([{ type: 'code', lines: ['abc'] }]);
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

  it('行内代码着 ANSI 2 绿（与 accent〔cyan 6〕分立——正文不触 accent 家族）', () => {
    const doc = MarkdownDoc.of('看 `npm test` 命令');
    const grid = renderDoc(doc, 40);
    const codeCell = grid.getCell(0, 3); // '看' 宽 2 占 col 0-1、空格 col 2、code 首字 col 3
    expect(codeCell?.style.fg).toBe(ansiColor(2));
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
    expect(grid.getCell(0, 2)?.style.fg).toBe(ansiColor(2)); // 起点按格位不按码位
    expect(grid.getCell(0, 2)?.grapheme).toBe('中');
  });

  it('accent 色不入场（正文不混用——引擎节件 3 纪律）', () => {
    const doc = MarkdownDoc.of('# 标题\n\n正文 `code` **粗** [链](u)\n\n> 引用\n\n---');
    const grid = renderDoc(doc, 30);
    const accent = ansiColor(ACCENT_INDEX);
    for (let r = 0; r < grid.rows; r++) {
      for (let c = 0; c < grid.columns; c++) {
        const cell = grid.getCell(r, c);
        if (cell !== null) expect(cell.style.fg === accent).toBe(false);
      }
    }
  });
});
