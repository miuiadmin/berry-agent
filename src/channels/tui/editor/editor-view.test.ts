/**
 * 编辑器视图单测：CellGrid 真身读回——composer 形（V-0 注③ 框退役：`› `
 * 提示符 + 底色染色块 + 框线零占位；聚焦 accent / 非聚焦 secondary 两态）、
 * 长行字素硬折落格、滚动指示 overlay、视口滚动光标恒可视、光标声明
 * （聚焦独占）、IME 预编辑下划线段。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid, sanitizeDisplayText } from '../../engine/index.js';
import { builtinPalette, DEFAULT_THEME, resolveTheme } from '../theme/index.js';
import { EditorModel } from './editor-model.js';
import { EditorView } from './editor-view.js';

/** 读回一行（未写格按空格、trimEnd 对齐视觉行） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 便捷：模型灌文 + 建视图 */
function viewOf(
  text: string,
  opts: { maxVisibleLines?: number; layoutWidth?: number } = {},
): { view: EditorView; model: EditorModel } {
  const model = new EditorModel();
  model.setText(text);
  model.setLayoutWidth(opts.layoutWidth ?? 200);
  return { view: new EditorView(model, opts), model };
}

describe('EditorView 量高', () => {
  it('空输入量高 1（composer 形——框线零占位）', () => {
    const { view } = viewOf('');
    expect(view.measure(20)).toBe(1);
  });

  it('视觉行数夹 maxVisibleLines', () => {
    const { view } = viewOf('a\nb\nc\nd\ne', { maxVisibleLines: 2 });
    expect(view.measure(20)).toBe(2);
  });

  it('迟滞带（R3 批 10j）：恰降 1 行保持上次、降 2 行才缩', () => {
    const { view, model } = viewOf('a\nb\nc\nd', { maxVisibleLines: 8 });
    expect(view.measure(20)).toBe(4); // 4 行即时
    model.setText('a\nb\nc'); // 降 1 行——保持 4（空白垫底）
    expect(view.measure(20)).toBe(4);
    model.setText('a\nb'); // 降 2 行——缩
    expect(view.measure(20)).toBe(2);
  });

  it('长行折行计入量高（字素硬折）', () => {
    const { view } = viewOf('aaaaaaaaaa', { layoutWidth: 8 });
    expect(view.measure(10)).toBe(2); // 8 列折两行
  });
});

describe('EditorView composer 形（V-0 注③——全宽框退役）', () => {
  it('› 前缀 + 正文落位、region 内零框字符', () => {
    const { view } = viewOf('ab');
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 6, height: 3 });
    expect(readRow(grid, 0, 10)).toBe('› ab');
    expect(readRow(grid, 1, 10)).toBe(''); // 框退役——上下边框行零占位
    expect(readRow(grid, 2, 10)).toBe('');
    // 框字符全 region 扫缺席（┌┐└┘─│ 六件）
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 6; c++) {
        expect('┌┐└┘─│').not.toContain(grid.getCell(r, c)?.grapheme ?? ' ');
      }
    }
  });

  it('聚焦态 › accent、非聚焦 › secondary（焦点指示新载体——V-0 注③）', () => {
    const { view } = viewOf('ab');
    const focused = new CellGrid(10, 5);
    view.setFocused(true);
    view.render(focused, { row: 0, col: 0, width: 6, height: 1 });
    expect(focused.getCell(0, 0)?.grapheme).toBe('›');
    expect(focused.getCell(0, 0)?.style.fg).toEqual(DEFAULT_THEME.accent);
    const plain = new CellGrid(10, 5);
    view.setFocused(false);
    view.render(plain, { row: 0, col: 0, width: 6, height: 1 });
    expect(plain.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.secondary);
  });

  it('region 平移：起点非零', () => {
    const { view } = viewOf('ab');
    const grid = new CellGrid(12, 5);
    view.render(grid, { row: 1, col: 3, width: 6, height: 1 });
    expect(readRow(grid, 1, 12)).toBe('   › ab');
  });

  it('底色染色块（userMessageBg 在场）：整块铺底全宽带 + 正文/› 携底色', () => {
    // 探测背景在场（OSC 11 混合腿）——resolveTheme 产出 userMessageBg 定值
    //（混合腿入参 = RgbChannels 探测值——transcript.test 同形；256 色深可表底色）
    const theme = resolveTheme(builtinPalette('dark'), '256', { r: 32, g: 32, b: 32 });
    expect(theme.userMessageBg).toBeDefined(); // rig 自证：混合腿确产底色键
    const { view } = viewOf('ab');
    view.setTheme(theme);
    view.setFocused(true);
    const grid = new CellGrid(10, 3);
    view.render(grid, { row: 0, col: 0, width: 10, height: 1 });
    expect(readRow(grid, 0, 10)).toBe('› ab');
    // 全宽带：正文格 / 尾部空白格 / › 前缀格皆携 bg
    expect(grid.getCell(0, 2)?.style?.bg).toEqual(theme.userMessageBg);
    expect(grid.getCell(0, 9)?.style?.bg).toEqual(theme.userMessageBg);
    expect(grid.getCell(0, 0)?.style?.bg).toEqual(theme.userMessageBg);
    expect(grid.getCell(0, 0)?.style?.fg).toEqual(theme.accent); // 聚焦 › 仍携 accent（fg+bg 合成）
  });

  it('底色缺席（探测缺席/降采形）：零背景带诚实回退—— › 前缀独挑边界', () => {
    const { view } = viewOf('ab');
    const grid = new CellGrid(10, 3);
    view.render(grid, { row: 0, col: 0, width: 10, height: 1 });
    expect(grid.getCell(0, 2)?.style).toEqual({}); // 正文裸写（style 空对象——无 fg/bg）
    expect(grid.getCell(0, 9)).toBeNull(); // 尾部格未写（透明——无带可铺）
  });
});

describe('EditorView 长行字素硬折', () => {
  it('超宽逻辑行折入多行（整字下移、续行两空格缩进对齐）', () => {
    const { view } = viewOf('中中中中', { layoutWidth: 4 });
    const grid = new CellGrid(6, 5);
    view.render(grid, { row: 0, col: 0, width: 6, height: 2 });
    // 每视觉行恰 2 个 CJK（4 列），共 2 行；续行缩进 2 与 › 前缀同宽对齐
    expect(readRow(grid, 0, 6)).toBe('› 中中');
    expect(readRow(grid, 1, 6)).toBe('  中中');
  });
});

describe('EditorView 滚动指示 overlay（框退役——指示写内容行右端）', () => {
  it('下方溢出：底行右端 ↓N（宽区全形——覆盖内容行非边框行）', () => {
    const { view, model } = viewOf('a\nb\nc\nd\ne', { maxVisibleLines: 2 });
    model.moveHome(); // 归列
    for (let i = 0; i < 4; i++) model.moveUp(); // 光标归首行行首
    const grid = new CellGrid(10, 2);
    view.render(grid, { row: 0, col: 0, width: 10, height: 2 });
    expect(readRow(grid, 0, 10)).toBe('› a');
    expect(readRow(grid, 1, 10)).toBe(' ↓ 3 更多'); // 全形恰 10 宽右贴（dim overlay）
    expect(grid.getCell(1, 1)?.style.dim).toBe(true); // 指示段 dim
  });

  it('光标滚出下方沉底 + 上方溢出：顶行右端 ↑N', () => {
    // setText 光标归尾（末行 'e'）——渲染须滚到光标可视
    const { view } = viewOf('a\nb\nc\nd\ne', { maxVisibleLines: 2 });
    const grid = new CellGrid(10, 2);
    view.render(grid, { row: 0, col: 0, width: 10, height: 2 });
    // 上方溢出 3 行且全形恰 10 宽 = region 宽——顶行整行被指示覆盖（右贴即满行）
    expect(readRow(grid, 0, 10)).toBe(' ↑ 3 更多');
    expect(readRow(grid, 1, 10)).toBe('  e');
    const up = new CellGrid(24, 2);
    view.render(up, { row: 0, col: 0, width: 24, height: 2 });
    expect(readRow(up, 0, 24).startsWith('› d')).toBe(true);
    expect(readRow(up, 0, 24).endsWith(' ↑ 3 更多')).toBe(true);
  });

  it('窄区回退紧凑 ↑N（全形放不下——按视口宽度阈值不再依框形）', () => {
    const { view } = viewOf('a\nb\nc\nd\ne', { maxVisibleLines: 2 });
    const narrow = new CellGrid(8, 2);
    view.render(narrow, { row: 0, col: 0, width: 8, height: 2 });
    expect(readRow(narrow, 0, 8)).toBe('› d   ↑3');
  });
});

describe('EditorView 光标声明', () => {
  it('聚焦声明本帧光标（前缀 2 + 显示列）', () => {
    const { view } = viewOf('ab');
    view.setFocused(true);
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 6, height: 1 });
    expect(grid.cursor).toEqual({ row: 0, col: 4, visible: true }); // › 前缀 2 + 2 字符
  });

  it('非聚焦不声明', () => {
    const { view } = viewOf('ab');
    view.setFocused(false);
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 6, height: 1 });
    expect(grid.cursor).toBeNull();
  });

  it('CJK 光标落宽字素后（显示列算术）', () => {
    const { view, model } = viewOf('ab中');
    model.moveHome();
    model.moveRight();
    model.moveRight();
    model.moveRight(); // col 3 = '中' 之后（显示列 4）
    view.setFocused(true);
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 10, height: 1 });
    expect(grid.cursor).toEqual({ row: 0, col: 6, visible: true }); // 前缀 2 + 显示列 4
  });
});

describe('EditorView IME 预编辑', () => {
  it('组字段下划线呈现于光标处、不并入正文', () => {
    const { view, model } = viewOf('ab');
    model.moveHome(); // 光标归首
    model.setPreedit('中');
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 10, height: 1 });
    const preeditCell = grid.getCell(0, 2); // '中' 占 col 2-3（双宽一格铺续格）
    expect(preeditCell?.grapheme).toBe('中');
    expect(preeditCell?.style.underline).toBe(true);
    expect(grid.getCell(0, 4)?.grapheme).toBe('a'); // 正文后移未删
    expect(grid.getCell(0, 5)?.grapheme).toBe('b');
    expect(model.getText()).toBe('ab'); // 正文不含组字段
  });

  it('组字期光标声明含预编辑宽', () => {
    const { view, model } = viewOf('');
    model.setPreedit('中');
    view.setFocused(true);
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 10, height: 1 });
    expect(grid.cursor).toEqual({ row: 0, col: 4, visible: true }); // 前缀 2 + 2 显示列
  });

  it('组字三段路含粘贴 tab：tab 展开两空格——与正文路/模型账同律（cell 新 tab 律随迁）', () => {
    // fx1 后模型账 graphemeWidth('\t')=2 + cell.writeText 把 tab 展开两空格格——
    // 正文路 drawContent 直走 writeText 已同律；组字三段路 writeTextClamped
    // 修前仍把 tab 随 C0 跳过（渲染 'abc' 每丢一 tab 2 列，光标声明
    // prefixDisplayWidth 记 2 漂在渲染文本右侧）——同框两副面孔。修后
    // tab 豁免吃进 take（宽 2 入账）走 writeText 展开，渲染与账合一
    const { view, model } = viewOf('a\tbc');
    model.setPreedit('x');
    view.setFocused(true);
    const grid = new CellGrid(12, 5);
    view.render(grid, { row: 0, col: 0, width: 10, height: 1 });
    // 派生锚（tab 四面互证——第五役 S2 建议①）：渲染行不孤立硬编码，tab 展开
    // 段直锚消毒单源 sanitizeDisplayText——消毒层 tab 语义一动而 writeTextClamped 渲染
    // 未随（四面漂移），此锁即红
    expect(readRow(grid, 0, 12)).toBe('› ' + sanitizeDisplayText('a\tbc') + 'x');
    expect(grid.cursor).toEqual({ row: 0, col: 8, visible: true }); // 模型账前缀 2 + 5 显示列（a=1, tab=2, bc=2）+ 预编辑 1——恰缀组字段尾
  });
});

describe('EditorView IME 预编辑折点归属（与 findVisualLineAt 同律）', () => {
  it('折点光标组字：预编辑恰呈现一行（归后段视觉行——前段不双呈现）', () => {
    // 'abcd中' 布局宽 5：'中'(2 列) 在段 0 放不下整字下移——段 0 'abcd'(宽 4
    // 留白 1 列) + 段 1 '中'。光标 col 4 = 折点：定位律 findVisualLineAt 对
    // 非行末段末位不收编（col 恒归后段视觉行）——组字分支须同律单源。
    // 修前 `<=` 边界两段同命中：段 0 呈现 'abcd'+preedit（前段留白恰容
    // 'x'——可见）+ 段 1 呈现 preedit+'中'，预编辑双呈现两行
    const { view, model } = viewOf('abcd中', { layoutWidth: 5 });
    model.moveHome();
    for (let i = 0; i < 4; i++) model.moveRight(); // 光标 col 4（折点）
    model.setPreedit('x');
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 7, height: 4 });
    // 内容区（两视觉行 × 5 列，前缀 2 起）扫下划线字形——恰一处（后段行首），
    // 修前 [{row:0,col:5},{row:1,col:2}] 双现
    const hits: Array<{ row: number; col: number }> = [];
    for (let r = 0; r <= 1; r++) {
      for (let c = 2; c <= 6; c++) {
        if (grid.getCell(r, c)?.style.underline) hits.push({ row: r, col: c });
      }
    }
    expect(hits).toEqual([{ row: 1, col: 2 }]);
    // 前段行 = 纯文本呈现（无组字混入）——修前 'abcdx'
    expect(readRow(grid, 0, 10)).toBe('› abcd');
    expect(readRow(grid, 1, 10)).toBe('  x中');
  });
});

describe('EditorView IME 预编辑宽度钳制', () => {
  // 网格恒比 region 宽 2 列——region 右界（无右边框列后右界即 region 边）与
  // 界外残迹（网格内）分别可读回
  it('光标近满行尾组字：组字段不越 region 右界（右界整字截断）', () => {
    // 内容区宽 8、正文恰满段 8 字符、光标归段尾——组字 '中'（宽 2）合成宽超界
    const { view, model } = viewOf('abcdefgh');
    model.setPreedit('中');
    const grid = new CellGrid(12, 5);
    view.render(grid, { row: 0, col: 0, width: 10, height: 1 });
    // region 右界外（col 10-11）无组字残迹（续格/越界写均不得落）
    expect(grid.getCell(0, 10)).toBeNull();
    expect(grid.getCell(0, 11)).toBeNull();
    expect(readRow(grid, 0, 12)).toBe('› abcdefgh'); // 组字段放不下整字——整字截断
  });

  it('光标段中组字：prefix 完整 + 预编辑按剩余宽整字截断 + suffix 让位', () => {
    const { view, model } = viewOf('abcdefgh');
    model.moveHome();
    for (let i = 0; i < 4; i++) model.moveRight(); // 光标 col 4（段中）
    model.setPreedit('中中中'); // 宽 6——prefix 后剩余 4 列恰容 '中中'，第三字整字截断
    const grid = new CellGrid(12, 5);
    view.render(grid, { row: 0, col: 0, width: 10, height: 1 });
    expect(readRow(grid, 0, 12)).toBe('› abcd中中');
    expect(grid.getCell(0, 6)?.style.underline).toBe(true); // 呈现的组字段仍是下划线样式
    expect(grid.getCell(0, 8)?.style.underline).toBe(true);
  });

  it('组字期光标声明钳 region 右界（预编辑宽计入后不越界）', () => {
    // 满段尾 + 组字宽 6：未钳制光标列 = 2 + 8 + 6 = 16——越网格右界（12 列）
    const { view, model } = viewOf('abcdefgh');
    model.setPreedit('中中中');
    view.setFocused(true);
    const grid = new CellGrid(12, 5);
    view.render(grid, { row: 0, col: 0, width: 10, height: 1 });
    expect(grid.cursor).toEqual({ row: 0, col: 9, visible: true }); // 钳到 region 末格
  });
});

describe('EditorView 焦点提示符随换装（V-0 注③——框退役后焦点载体）', () => {
  it('setTheme 后两态 › 各随主题键取值：聚焦 accent / 非聚焦 secondary', () => {
    const light = resolveTheme(builtinPalette('light'), DEFAULT_THEME.depth);
    const { view } = viewOf('ab');
    view.setTheme(light);
    view.setFocused(true);
    const focused = new CellGrid(10, 5);
    view.render(focused, { row: 0, col: 0, width: 10, height: 1 });
    expect(focused.getCell(0, 0)?.style.fg).toBe(light.accent);
    view.setFocused(false);
    const plain = new CellGrid(10, 5);
    view.render(plain, { row: 0, col: 0, width: 10, height: 1 });
    expect(plain.getCell(0, 0)?.style.fg).toBe(light.secondary); // 降档色随换装重建
  });
});
