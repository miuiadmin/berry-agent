/**
 * 块布局分派件测试（批 10h——表格双线制 + 代码高亮渲染直锁）。
 *
 * 覆盖：表格 codex 双线制（V-3 注⑨④——全框退役 / 表头 ━ 重线 + 表体 ─ 轻线 /
 * 无纵向线 / 列宽回收）+ 线色 weakRule 优先 tableRule 回退 + 表头 bold + 逐列
 * 对齐 padding + 等分帽折行；代码块闭栏已知语言五类着色、开栏/未知语言诚实退
 * 单色。
 */
import { describe, expect, it } from 'vitest';
import { colorRgb } from '../../engine/index.js';
import { DARK_PALETTE, DEFAULT_THEME, resolveTheme } from '../theme/index.js';
import { parseMarkdown, type MarkdownBlock } from './blocks.js';
import { blockRows } from './block-rows.js';
import { DIM_STYLE, type StyledGrapheme } from './layout.js';

/** 行集 → 字符串行（样式另查） */
function texts(rows: StyledGrapheme[][]): string[] {
  return rows.map((row) => row.map((cell) => cell.grapheme).join(''));
}

/** 单块解析首块 */
function first(text: string): MarkdownBlock {
  return parseMarkdown(text)[0]!;
}

/** 自定义板（text 定义形——weakRule 混合基在场）：fg #e6edf3 混 bg #0d1117 */
const WEAK_THEME = resolveTheme(
  {
    dark: true,
    colors: { ...DARK_PALETTE.colors, text: { r: 230, g: 237, b: 243 }, userMessageBg: { r: 16, g: 16, b: 16 } },
  },
  'truecolor',
  { r: 13, g: 17, b: 23 },
);

describe('blockRows 表格渲染（V-3 注⑨④ codex 双线制）', () => {
  it('双线形：表头行 + ━ 重线 + 数据行（全框退役——┌┐└┘┬┴┼├┤│ 零在场）', () => {
    const rows = blockRows(first('| a | b |\n| :- | -: |\n| 1 | 2 |'), 20, DEFAULT_THEME);
    const lines = texts(rows);
    expect(lines).toEqual([' a    b', '━━━━━━━━━━', ' 1      2']);
    // 全框字符零在场（退役锁——框全族不回潮）
    expect(lines.join('')).not.toMatch(/[┌┐└┘┬┴┼├┤│]/);
    // 线字符走线色键（weakRule 缺席回退 tableRule——16 档基线形）
    for (const cell of rows[1]!) expect(cell.style?.fg).toBe(DEFAULT_THEME.tableRule);
    // 表头 bold 位
    expect(rows[0]!.find((c) => c.grapheme === 'a')?.style?.bold).toBe(true);
  });

  it('表体行间 ─ 轻线（数据行之间逐段落线；线色同键；空表无轻线）', () => {
    const rows = blockRows(first('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'), 20, DEFAULT_THEME);
    const lines = texts(rows);
    // 双左对齐定界（--- ---）：数据格 pad 2 + 双空格分隔 → 1 与 2 间 4 空格
    expect(lines).toEqual([' a    b', '━━━━━━━━━━', ' 1    2', '──────────', ' 3    4']);
    for (const cell of rows[3]!) expect(cell.style?.fg).toBe(DEFAULT_THEME.tableRule); // 轻线同线色键
    // 空表边界形：头 + 重线即收（旧形底线封口随全框退役）
    const empty = blockRows(first('| a | b |\n| --- |'), 20, DEFAULT_THEME);
    expect(texts(empty)).toEqual([' a    b', '━━━━━━━━━━']);
  });

  it('窄屏列收缩 + 截断指路（挖掘 27 轮 [1]——修前红：双地板溢出整列静默裁失）', () => {
    // 5 列表 @ width 20：每列最窄占位 = 内容 3 + 两侧空 2 = 5——5 列须 25
    // 列宽。双地板（avail≥cols×3 / cap≥3）保列宽下限使 tableWidth 恒
    // ≥5×cols 溢出视口——越界列下游 writeText 静默丢（markdown 逐游程无
    // 钳制 + cell 越界静默吸收）——整列裁失无指路。修：收缩到屏幕可容纳
    // 列数 floor(width/5)，余列丢弃 + 末行「+ N 列更多」dim 指路（诚实
    // 边界优于静默裁失；列宽地板是反退化取舍不动）
    const table = '| a | b | c | d | e |\n| - | - | - | - | - |\n| 1 | 2 | 3 | 4 | 5 |';
    const rows = blockRows(first(table), 20, DEFAULT_THEME);
    const lines = texts(rows);
    expect(lines[0]).not.toContain('e'); // 可容纳 4 列（floor(20/5)）——第 5 列收缩让位
    expect(lines[0]).toContain('a');
    expect(lines[2]).not.toContain('5');
    expect(lines.at(-1)).toBe('+ 1 列更多'); // 末行截断指路
    // 指路行 dim 样式（同溢出指示族弱存在感——DIM_STYLE 单源）
    const mark = rows.at(-1)!.find((c) => c.grapheme === '+');
    expect(mark?.style).toBe(DIM_STYLE);
    // 宽屏零收缩零指路（floor(40/5)=8 ≥ 5 列——既有全量形不动）
    const wide = texts(blockRows(first(table), 40, DEFAULT_THEME));
    expect(wide[0]).toContain('e');
    expect(wide.at(-1)).not.toBe('+ 1 列更多');
  });

  it('指路行自身窄屏收口（挖掘 28 轮 [12]——修前红：自宽 10 在 width 8 被静默硬裁无省略号）', () => {
    // 「+ N 列更多」CJK 宽 10 起步——width ≤9 时指路行自身溢出被 cell 越界
    // 静默吸收（42fc328 要消灭的缺陷类在诚实指路行身上复发；width 8 实测
    // 只见硬切口）。修：ellipsize 单源收口到 width（省略号在场 = 截断指路
    // 行对截断几何也诚实）
    const table = '| a | b | c |\n| - | - | - |\n| 1 | 2 | 3 |';
    const rows = blockRows(first(table), 8, DEFAULT_THEME);
    expect(texts(rows).at(-1)).toBe('+ 2 列…'); // 修前红锚：'+ 2 列更多'（10 列裸直写）
    // 极窄形同源：width 4 → '+ 2…'（truncate 3 列整字 + 省略号——尾随空格随截除）
    expect(texts(blockRows(first(table), 4, DEFAULT_THEME)).at(-1)).toBe('+ 2…');
  });

  it('线色 = 混合现算弱线优先（weakRule 在场整线着弱线色；tableRule 回退位让渡）', () => {
    const rows = blockRows(first('| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |'), 20, WEAK_THEME);
    expect(WEAK_THEME.weakRule).toEqual(colorRgb('#383d43')); // 混合基自证（fg@20% 混 bg）
    for (const cell of rows[1]!) expect(cell.style?.fg).toBe(WEAK_THEME.weakRule); // ━ 重线
    for (const cell of rows[3]!) expect(cell.style?.fg).toBe(WEAK_THEME.weakRule); // ─ 轻线
  });

  it('对齐三形：左/中/右数据列 padding 就位', () => {
    const rows = blockRows(first('| a | b | c |\n|:-|:-:|-:|\n| 1 | 2 | 3 |'), 24, DEFAULT_THEME);
    expect(texts(rows)[2]).toBe(' 1     2     3'); // 中列两空格均分（列间双空格分隔）
  });

  it('单元格行内样式入场（code 键不因表格丢样式；定界反引号同入列宽）', () => {
    const rows = blockRows(first('| a |\n| --- |\n| `c` |'), 20, DEFAULT_THEME);
    expect(texts(rows)[2]).toBe(' `c`'); // code 定界形入格（列宽测量含定界两列）
    expect(rows[2]!.find((cell) => cell.grapheme === 'c')?.style?.fg).toBe(DEFAULT_THEME.codeInline);
  });

  it('列宽回收：纵线退役 avail 不再扣 (cols+1)——等宽内容不折行（V-3 注⑨④）', () => {
    const rows = blockRows(first('| aaaa |\n| --- |\n| bbbbbbbb |'), 10, DEFAULT_THEME);
    const lines = texts(rows);
    // avail = 10 - 2 = 8 ≥ 自然宽 8 → 不封帽不折行（修前红：全框形 avail 6 → 数据格折两视行）
    expect(lines).toEqual([' aaaa', '━━━━━━━━━━', ' bbbbbbbb']);
  });

  it('等分帽触发：两列总自然宽超预算 → 列宽等分封帽 + 头格折行', () => {
    const rows = blockRows(first('| aaaa | bbbb |\n| --- | --- |\n| 1 | 2 |'), 11, DEFAULT_THEME);
    const lines = texts(rows);
    // 两列自然宽 4+4 > avail 7 → 帽 3；头格 aaaa/bbbb 各折两行（头区整体两行高）
    expect(lines).toEqual([' aaa  bbb', ' a    b', '━━━━━━━━━━', ' 1    2']);
  });

  it('头格折两行：超宽头格同法 cell 级折行，bold 位跨视行保持', () => {
    const rows = blockRows(first('| aaaaaaaa |\n| --- |\n| 1 |'), 7, DEFAULT_THEME);
    const lines = texts(rows);
    // avail = 7 - 2 = 5 → 帽 5；头格 8 字折两视行（表头两行折行升格）
    expect(lines).toEqual([' aaaaa', ' aaa', '━━━━━━━', ' 1']);
    // 折出的第二视行仍是表头——整格 bold 位跨折行保持
    expect(rows[1]!.find((cell) => cell.grapheme === 'a')?.style?.bold).toBe(true);
  });

  it('头格两行仍超则截断：第三段不入场', () => {
    const rows = blockRows(first('| aaaaaaaaaaaaa |\n| --- |\n| 1 |'), 10, DEFAULT_THEME);
    const lines = texts(rows);
    // 头格 13 字帽 8 → 折三段 [aaaaaaaa / aaaaaa / a]——取前两行，第三段截断不加高
    expect(lines).toEqual([' aaaaaaaa', ' aaaaa', '━━━━━━━━━━', ' 1']);
  });

  it('任一头格折行即表头区整体两行高（列头对齐律）：不折头格第二行空补齐', () => {
    const rows = blockRows(first('| aaaaaaaa | b |\n| --- | --- |\n| 1 | 2 |'), 12, DEFAULT_THEME);
    const lines = texts(rows);
    // 自然宽 [8,3] 总 11 > avail 8 → 帽 4；头格 aaaaaaaa 折两行、b 不折——头区整体两行高
    expect(lines).toEqual([' aaaa  b', ' aaaa', '━━━━━━━━━━━', ' 1     2']);
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
