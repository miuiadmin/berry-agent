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
  it('框线形：顶线封口 + 表头行 + ├─┼─┤ 分隔 + 数据行 + 底线封口（tableRule 单源）', () => {
    const rows = blockRows(first('| a | b |\n| :- | -: |\n| 1 | 2 |'), 20, DEFAULT_THEME);
    const lines = texts(rows);
    // 界面美化役批 §⑥ 封口律：首尾对称封口；分隔行十字形（列线上通下达）
    expect(lines).toEqual([
      '┌─────┬─────┐',
      '│ a   │ b   │',
      '├─────┼─────┤',
      '│ 1   │   2 │', // 左/右对齐 padding
      '└─────┴─────┘',
    ]);
    // 框线字符全走 tableRule 键（含数据行边框与顶底封口）
    for (const row of rows) {
      for (const cell of row) {
        if ('│├┬┤─┌┐┼└┴'.includes(cell.grapheme)) expect(cell.style?.fg).toBe(DEFAULT_THEME.tableRule);
      }
    }
    // 表头 bold 位
    expect(rows[1]!.find((c) => c.grapheme === 'a')?.style?.bold).toBe(true);
  });

  it('对齐三形：左/中/右数据列 padding 就位', () => {
    const rows = blockRows(first('| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |'), 24, DEFAULT_THEME);
    expect(texts(rows)[3]).toBe('│ 1   │  2  │   3 │'); // 中列两空格均分
  });

  it('单元格行内样式入场（code 键不因表格丢样式；定界反引号同入列宽）', () => {
    const rows = blockRows(first('| a |\n| --- |\n| `c` |'), 20, DEFAULT_THEME);
    expect(texts(rows)[3]).toBe('│ `c` │'); // code 定界形入格（列宽测量含定界两列）
    expect(rows[3]!.find((cell) => cell.grapheme === 'c')?.style?.fg).toBe(DEFAULT_THEME.codeInline);
  });

  it('等分帽：窄宽列宽封帽 + 数据格折行（行高 = 行内最大；头格宽内不折）', () => {
    const rows = blockRows(first('| aaaa |\n| --- |\n| bbbbbbbb |'), 10, DEFAULT_THEME);
    const lines = texts(rows);
    // avail = 10 - 2 - 2 = 6 < 自然宽 8 → 帽 6；数据格 8 字折两视行
    expect(lines[0]).toBe('┌────────┐'); // 顶线封口
    expect(lines[1]).toBe('│ aaaa   │'); // 头格宽 4 ≤ 帽 6——不折单行呈现
    expect(lines).toHaveLength(6); // 顶 + 头 + 分隔 + 数据格折两视行 + 底
    expect(lines[3]).toBe('│ bbbbbb │');
    expect(lines[4]).toBe('│ bb     │');
    expect(lines[5]).toBe('└────────┘'); // 底线封口
  });

  it('等分帽触发：两列总自然宽超预算 → 列宽等分封帽', () => {
    const rows = blockRows(first('| aaaa | bbbb |\n| --- | --- |\n| 1 | 2 |'), 13, DEFAULT_THEME);
    const lines = texts(rows);
    // 两列自然宽 4+4 > avail 6 → 帽 3；头格 aaaa/bbbb 各折两行（头区整体两行高）
    expect(lines[0]).toBe('┌─────┬─────┐');
    expect(lines[1]).toBe('│ aaa │ bbb │');
    expect(lines[2]).toBe('│ a   │ b   │');
    expect(lines[3]).toBe('├─────┼─────┤');
    expect(lines[4]).toBe('│ 1   │ 2   │'); // 短数据格不折
    expect(lines[5]).toBe('└─────┴─────┘');
  });

  it('头格折两行：超宽头格同法 cell 级折行，bold 位跨视行保持', () => {
    const rows = blockRows(first('| aaaaaaaa |\n| --- |\n| 1 |'), 10, DEFAULT_THEME);
    const lines = texts(rows);
    // avail = 10 - 2 - 2 = 6 → 帽 6；头格 8 字折两视行（表头两行折行升格）
    expect(lines).toEqual(['┌────────┐', '│ aaaaaa │', '│ aa     │', '├────────┤', '│ 1      │', '└────────┘']);
    // 折出的第二视行仍是表头——整格 bold 位跨折行保持
    expect(rows[2]!.find((cell) => cell.grapheme === 'a')?.style?.bold).toBe(true);
  });

  it('头格两行仍超则截断：第三段不入场', () => {
    const rows = blockRows(first('| aaaaaaaaaaaaa |\n| --- |\n| 1 |'), 10, DEFAULT_THEME);
    const lines = texts(rows);
    // 头格 13 字帽 6 → 折三段 [aaaaaa / aaaaaa / a]——取前两行，第三段截断不加高
    expect(lines).toEqual(['┌────────┐', '│ aaaaaa │', '│ aaaaaa │', '├────────┤', '│ 1      │', '└────────┘']);
  });

  it('任一头格折行即表头区整体两行高（列头对齐律）：不折头格第二行空补齐', () => {
    const rows = blockRows(first('| aaaaaaaa | b |\n| --- | --- |\n| 1 | 2 |'), 13, DEFAULT_THEME);
    const lines = texts(rows);
    // 自然宽 [8,3] 总 11 > avail 6 → 帽 3；头格 aaaaaaaa 折两行、b 不折——头区整体两行高
    expect(lines).toEqual([
      '┌─────┬─────┐',
      '│ aaa │ b   │',
      '│ aaa │     │',
      '├─────┼─────┤',
      '│ 1   │ 2   │',
      '└─────┴─────┘',
    ]);
  });
});

describe('blockRows 标题梯度（界面美化役批 §⑥——弃全宽横幅形）', () => {
  it('H1 = bold + 文本宽下划线（宽随标题文字非全宽）', () => {
    const rows = blockRows(first('# 标题文本'), 20, DEFAULT_THEME);
    expect(texts(rows)).toEqual(['标题文本', '────────']);
    expect(rows[0]!.every((cell) => cell.style?.bold === true)).toBe(true);
    expect(rows[1]!.every((cell) => cell.style?.dim === true)).toBe(true);
  });

  it('H2 = 纯 bold 无下划线', () => {
    const rows = blockRows(first('## 标题二'), 20, DEFAULT_THEME);
    expect(texts(rows)).toEqual(['标题二']);
    expect(rows[0]![0]!.style?.bold).toBe(true);
  });

  it('H3/H4 = bold + 行首 dim 深度前缀（▍ 缩梯）', () => {
    const rows3 = blockRows(first('### 三级'), 20, DEFAULT_THEME);
    expect(texts(rows3)).toEqual(['▍ 三级']);
    expect(rows3[0]![0]!.style?.dim).toBe(true); // 前缀 dim
    expect(rows3[0]![2]!.style?.bold).toBe(true); // 正文 bold
    const rows4 = blockRows(first('#### 四级'), 20, DEFAULT_THEME);
    expect(texts(rows4)).toEqual(['▍▍ 四级']);
    expect(rows4[0]![0]!.style?.dim).toBe(true);
    expect(rows4[0]![3]!.style?.bold).toBe(true);
  });

  it('H5/H6 = 平文（无 bold）', () => {
    const rows5 = blockRows(first('##### 五级'), 20, DEFAULT_THEME);
    expect(texts(rows5)).toEqual(['五级']);
    expect(rows5[0]![0]!.style).toBeUndefined();
    const rows6 = blockRows(first('###### 六级'), 20, DEFAULT_THEME);
    expect(texts(rows6)).toEqual(['六级']);
    expect(rows6[0]![0]!.style).toBeUndefined();
  });
});

describe('blockRows 代码块高亮', () => {
  it('闭栏 + 已知语言：五类 token 着高亮键族（keyword/number 各验一）+ 沟线 dim + 收尾语言标签', () => {
    const rows = blockRows(first('```ts\nconst x = 1;\n```'), 40, DEFAULT_THEME);
    expect(texts(rows)).toEqual(['│ const x = 1;', '└─ ts']); // 收尾行 = 语言标签位
    const flat = rows[0]!;
    expect(flat.find((c) => c.grapheme === 'c')?.style?.fg).toBe(DEFAULT_THEME.codeKeyword); // const 段首字
    expect(flat.find((c) => c.grapheme === '1')?.style?.fg).toBe(DEFAULT_THEME.codeNumber);
    expect(flat.find((c) => c.grapheme === 'x')?.style?.fg).toBeUndefined(); // plain 不着色
    // 沟线 dim（界面美化役批 §⑥——结构线弱存在感）
    expect(rows[0]![0]!.style?.dim).toBe(true);
    expect(rows[1]!.every((cell) => cell.style?.dim === true)).toBe(true);
  });

  it('开栏期退单色（未闭不高亮——防样式回翻闪烁）+ 无收尾行（半闭合期修剪律）', () => {
    const rows = blockRows(first('```ts\nconst x = 1;'), 40, DEFAULT_THEME);
    expect(texts(rows)).toEqual(['│ const x = 1;']); // 开栏不加收尾——闭栏帧才落标签
    for (const cell of rows[0]!) expect(cell.style?.fg).toBeUndefined();
    expect(rows[0]![0]!.style?.dim).toBe(true); // 沟线 dim 同律
  });

  it('未知语言退单色（诚实不发明半高亮）+ 语言标签照显', () => {
    const rows = blockRows(first('```txt\nconst x = 1;\n```'), 40, DEFAULT_THEME);
    expect(texts(rows)).toEqual(['│ const x = 1;', '└─ txt']);
    for (const cell of rows[0]!) expect(cell.style?.fg).toBeUndefined();
  });

  it('注释整行着色 + 多行代码 │ 前缀贯通', () => {
    const rows = blockRows(first('```ts\n// 注\nx\n```'), 40, DEFAULT_THEME);
    expect(texts(rows)).toEqual(['│ // 注', '│ x', '└─ ts']);
    expect(rows[0]!.find((c) => c.grapheme === '/')?.style?.fg).toBe(DEFAULT_THEME.codeComment);
  });

  it('空代码块零行（无收尾——孤线无沟可收）', () => {
    const rows = blockRows(first('```\n```'), 40, DEFAULT_THEME);
    expect(rows).toHaveLength(0);
  });
});

/* ---------------- 渲染热路径 D4：尾代码块增量承接 ---------------- */

describe('blockRows 代码块增量承接（渲染热路径 D4——尾块 open 期逐帧重折承接）', () => {
  it('增长承接：前缀行折叠结果引用复用（修前红锚——每帧全量重折产新数组）', () => {
    // 流式开栏尾块逐帧增长：帧一三行 → 帧二追加一行。承接后前三行折叠结果
    // 是同对象引用（引用复用 = 未重折），仅新增行重折入列
    const rows1 = blockRows(first('```ts\nconst a = 1;\nconst b = 2;'), 40, DEFAULT_THEME);
    const rows2 = blockRows(first('```ts\nconst a = 1;\nconst b = 2;\nconst c = 3;'), 40, DEFAULT_THEME);
    expect(rows2[0]).toBe(rows1[0]); // 前缀行引用复用——非重算新数组
    expect(rows2[1]).toBe(rows1[1]);
    expect(rows2).toHaveLength(3);
    expect(texts(rows2)[2]).toBe('│ const c = 3;'); // 新增行重折内容正确
  });

  it('承接跨帧连续增长链：多帧逐行追加全链引用复用', () => {
    let prev: StyledGrapheme[][] = [];
    for (let n = 1; n <= 6; n++) {
      const lines = Array.from({ length: n }, (_, i) => `line ${i}`);
      const rows = blockRows(first('```txt\n' + lines.join('\n')), 30, DEFAULT_THEME);
      if (n > 1) {
        for (let i = 0; i < n - 1; i++) expect(rows[i]).toBe(prev[i]); // 前缀全复用
      }
      expect(texts(rows)[n - 1]).toBe(`│ line ${n - 1}`);
      prev = rows;
    }
  });

  it('闭栏翻档帧：闭栏后输出与无承接直算逐格一致（开栏承接账不污染闭栏高亮）', () => {
    // 先铺开栏承接账（两行），再闭栏——闭栏帧整体高亮重排须全量重折
    blockRows(first('```ts\nconst x = 1;\nlet y = 2;'), 40, DEFAULT_THEME);
    const closedAfterGrowth = blockRows(first('```ts\nconst x = 1;\nlet y = 2;\n```'), 40, DEFAULT_THEME);
    const closedFresh = blockRows(first('```ts\nconst x = 1;\nlet y = 2;\n```'), 40, DEFAULT_THEME);
    expect(closedAfterGrowth).toEqual(closedFresh); // 逐格深等（含高亮样式位）
  });

  it('闭栏后再开新栏：开栏单色输出不染闭栏高亮（闭栏帧不读不写承接账）', () => {
    // 闭栏（同宽同语言）后紧接新开栏尾块——闭栏帧走整体高亮重排、不触碰
    // 承接账，新开栏输出仍是单色折叠形、与直算一致
    blockRows(first('```ts\nconst x = 1;\n```'), 40, DEFAULT_THEME);
    const reopened = blockRows(first('```ts\nconst x = 1;\nmore'), 40, DEFAULT_THEME);
    const fresh = blockRows(first('```ts\nconst x = 1;\nmore'), 40, DEFAULT_THEME);
    expect(reopened).toEqual(fresh);
    expect(texts(reopened)).toEqual(['│ const x = 1;', '│ more']);
  });

  it('中行改写（非追加形）：自分歧行起重折——输出与全量重折一致', () => {
    blockRows(first('```ts\naaa\nbbb\nccc'), 40, DEFAULT_THEME);
    const edited = blockRows(first('```ts\naaa\nXXX\nccc\nddd'), 40, DEFAULT_THEME);
    const fresh = blockRows(first('```ts\naaa\nXXX\nccc\nddd'), 40, DEFAULT_THEME);
    expect(edited).toEqual(fresh); // 坏输入不丢字——分歧行后全重折
  });

  it('换宽帧：全量重折（承接账按宽失配不错位命中）', () => {
    blockRows(first('```ts\nconst value = 1;'), 40, DEFAULT_THEME);
    const narrow = blockRows(first('```ts\nconst value = 1;\nmore'), 20, DEFAULT_THEME);
    const fresh = blockRows(first('```ts\nconst value = 1;\nmore'), 20, DEFAULT_THEME);
    expect(narrow).toEqual(fresh);
    // 窄宽折行算术 sanity：bodyWidth 18——'const value = 1;'（16 列）单行 + 'more' 单行
    expect(texts(narrow)).toEqual(['│ const value = 1;', '│ more']);
  });

  it('空行与超长折行混合语料：承接后输出与全量重折一致（对拍）', () => {
    const g1 = '```txt\nfirst\n\n' + 'x'.repeat(50);
    const g2 = '```txt\nfirst\n\n' + 'x'.repeat(50) + '\nsecond\n\nth' + '中'.repeat(30);
    blockRows(first(g1), 30, DEFAULT_THEME);
    const carried = blockRows(first(g2), 30, DEFAULT_THEME);
    const fresh = blockRows(first(g2), 30, DEFAULT_THEME);
    expect(carried).toEqual(fresh); // 空行折行 + CJK 折行 + 超长折行承接后零漂移
  });
});
