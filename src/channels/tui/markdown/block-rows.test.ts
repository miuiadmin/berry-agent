/**
 * 块布局分派件测试（批 10h——表格框线 + 代码高亮渲染直锁）。
 *
 * 覆盖：表格框线 tableRule 单源 + 表头 bold + 逐列对齐 padding + 等分帽
 * 折行；代码块闭栏已知语言五类着色、开栏/未知语言诚实退单色。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_THEME } from '../theme/index.js';
import { parseMarkdown, type MarkdownBlock } from './blocks.js';
import { blockRows } from './block-rows.js';
import type { StyledGrapheme } from './layout.js';

/** 行集 → 字符串行（样式另查） */
function texts(rows: StyledGrapheme[][]): string[] {
  return rows.map((row) => row.map((cell) => cell.grapheme).join(''));
}

/** 单块解析首块 */
function first(text: string): MarkdownBlock {
  return parseMarkdown(text)[0]!;
}

describe('blockRows 表格渲染', () => {
  it('框线形：表头行 + ├─┬─┤ 分隔 + 数据行（tableRule 单源）', () => {
    const rows = blockRows(first('| a | b |\n| :- | -: |\n| 1 | 2 |'), 20, DEFAULT_THEME);
    const lines = texts(rows);
    expect(lines).toEqual(['│ a   │ b   │', '├─────┬─────┤', '│ 1   │   2 │']); // 左/右对齐 padding
    // 框线字符全走 tableRule 键（含数据行边框）
    for (const row of rows) {
      for (const cell of row) {
        if ('│├┬┤─'.includes(cell.grapheme)) expect(cell.style?.fg).toBe(DEFAULT_THEME.tableRule);
      }
    }
    // 表头 bold 位
    expect(rows[0]!.find((c) => c.grapheme === 'a')?.style?.bold).toBe(true);
  });

  it('对齐三形：左/中/右数据列 padding 就位', () => {
    const rows = blockRows(first('| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |'), 24, DEFAULT_THEME);
    expect(texts(rows)[2]).toBe('│ 1   │  2  │   3 │'); // 中列两空格均分
  });

  it('单元格行内样式入场（code 键不因表格丢样式）', () => {
    const rows = blockRows(first('| a |\n| --- |\n| `c` |'), 20, DEFAULT_THEME);
    expect(rows[2]!.find((cell) => cell.grapheme === 'c')?.style?.fg).toBe(DEFAULT_THEME.codeInline);
  });

  it('等分帽：窄宽列宽封帽 + 数据格折行（行高 = 行内最大；表头单行呈现 v1 边界）', () => {
    const rows = blockRows(first('| aaaa |\n| --- |\n| bbbbbbbb |'), 10, DEFAULT_THEME);
    const lines = texts(rows);
    // avail = 10 - 2 - 2 = 6 < 自然宽 8 → 帽 6；数据格 8 字折两视行
    expect(lines[0]).toBe('│ aaaa   │'); // 表头单行呈现（折行头形 v1 退化不折——头注边界）
    expect(lines).toHaveLength(4); // 头 + 分隔 + 数据格折两视行
    expect(lines[2]).toBe('│ bbbbbb │');
    expect(lines[3]).toBe('│ bb     │');
  });

  it('等分帽触发：两列总自然宽超预算 → 列宽等分封帽', () => {
    const rows = blockRows(first('| aaaa | bbbb |\n| --- | --- |\n| 1 | 2 |'), 13, DEFAULT_THEME);
    const lines = texts(rows);
    expect(lines[0]).toBe('│ aaa │ bbb │'); // 两列自然宽 4+4 > avail 6 → 帽 3（表头截断单行）
    expect(lines[1]).toBe('├─────┬─────┤');
    expect(lines[2]).toBe('│ 1   │ 2   │'); // 短数据格不折
  });
});

describe('blockRows 代码块高亮', () => {
  it('闭栏 + 已知语言：五类 token 着高亮键族（keyword/number 各验一）', () => {
    const rows = blockRows(first('```ts\nconst x = 1;\n```'), 40, DEFAULT_THEME);
    expect(texts(rows)).toEqual(['│ const x = 1;']);
    const flat = rows[0]!;
    expect(flat.find((c) => c.grapheme === 'c')?.style?.fg).toBe(DEFAULT_THEME.codeKeyword); // const 段首字
    expect(flat.find((c) => c.grapheme === '1')?.style?.fg).toBe(DEFAULT_THEME.codeNumber);
    expect(flat.find((c) => c.grapheme === 'x')?.style?.fg).toBeUndefined(); // plain 不着色
  });

  it('开栏期退单色（未闭不高亮——防样式回翻闪烁）', () => {
    const rows = blockRows(first('```ts\nconst x = 1;'), 40, DEFAULT_THEME);
    expect(texts(rows)).toEqual(['│ const x = 1;']);
    for (const cell of rows[0]!) expect(cell.style?.fg).toBeUndefined();
  });

  it('未知语言退单色（诚实不发明半高亮）', () => {
    const rows = blockRows(first('```txt\nconst x = 1;\n```'), 40, DEFAULT_THEME);
    for (const cell of rows[0]!) expect(cell.style?.fg).toBeUndefined();
  });

  it('注释整行着色 + 多行代码 │ 前缀贯通', () => {
    const rows = blockRows(first('```ts\n// 注\nx\n```'), 40, DEFAULT_THEME);
    expect(texts(rows)).toEqual(['│ // 注', '│ x']);
    expect(rows[0]!.find((c) => c.grapheme === '/')?.style?.fg).toBe(DEFAULT_THEME.codeComment);
  });
});
