/**
 * 补全弹层件单测（2026-09-20 TUI 视觉品质战役·组 2 起）：
 * - escape 关层通知（onDismiss 回调）：popup 消费 escape 关本轮时恰回调一次
 *   ——backend 接线 autocompleteCompleter.cancel()（撤 20ms 防抖窗 + 在途
 *   作废），堵「关层后窗内迟到 fire 重开弹层」的建议框闪回（修前红在
 *   tui-backend.test.ts 纵切锁——本件锁件内回调契约面）；
 * - 行预算排版（2026-10-10 Codex 样式复刻批 R-6 翻档后 = label 帽 + desc
 *   列对齐制）：label 段行宽帽 … 收口、desc 段起列 = 全集 max(label 宽)+4
 *   （缩进 2 + 间隔 2）、段右界帽 ≤ 区域宽 70%、desc 无位诚实不显——右对齐
 *   制（row-segments）已退役本件位。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { EditorModel } from '../editor/editor-model.js';
import { AutocompletePopup } from './popup.js';
import { builtinPalette, DEFAULT_THEME, resolveTheme } from '../theme/index.js';

/** 键事件便捷构造 */
function key(k: string): {
  kind: 'key';
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
  phase: 'press' | 'release';
} {
  return { kind: 'key', key: k, ctrl: false, alt: false, shift: false, meta: false, phase: 'press' };
}

/** 读回一行（未写格按空格、宽字素续格空串——trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

describe('AutocompletePopup escape 关层通知（组 2）', () => {
  it('escape 消费关本轮 → onDismiss 恰回调一次；不可见时 escape 穿透不回调', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    let dismissed = 0;
    popup.onDismiss = () => {
      dismissed += 1;
    };
    popup.applyResult({ items: [{ label: '/help', replacement: '/help' }], query: '', replaceStart: 0, replaceEnd: 2 });
    expect(popup.handleEvent(key('escape'))).toBe(true); // 消费关本轮
    expect(popup.visible).toBe(false);
    expect(dismissed).toBe(1); // 修前红：escape 路无任何关层通知——backend 撤窗无从接线
    // 不可见期 escape 穿透（不消费也不通知——无「本轮」可关）
    expect(popup.handleEvent(key('escape'))).toBe(false);
    expect(dismissed).toBe(1);
  });

  it('enter 应用代换关层不走通知（应用即隐属新轮编舞——dismiss 专指用户撤销本轮）', () => {
    const model = new EditorModel();
    model.setText('/h'); // 光标落尾——token 区间 [0,2) 与 result 对拍新鲜
    const popup = new AutocompletePopup(model);
    let dismissed = 0;
    popup.onDismiss = () => {
      dismissed += 1;
    };
    popup.applyResult({ items: [{ label: '/help', replacement: '/help' }], query: '', replaceStart: 0, replaceEnd: 2 });
    expect(popup.handleEvent(key('enter'))).toBe(true); // 应用代换即隐
    expect(popup.visible).toBe(false);
    expect(model.getText()).toBe('/help');
    expect(dismissed).toBe(0); // 应用路不回调（代换触发 onChange 自然重开新查）
  });
});

describe('AutocompletePopup 行预算排版（组 2 起；R-6 翻档锚）', () => {
  it('极长 label + 极长 detail：label 行宽帽 … 收口 + desc 无位诚实不显（修前〔右对齐制〕detail 负起列从行首覆写整行红；翻档后结构性封堵——descAvail ≤ 0 不写）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: 'x'.repeat(70), replacement: 'x', detail: 'd'.repeat(60) }],
      query: '',
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(30, 1);
    popup.render(grid, { row: 0, col: 0, width: 30, height: 1 });
    // maxLabelW = 70 → descCol = 74；descCap = ⌊30×0.7⌋ = 21 → descAvail < 0
    // ——desc 诚实不显；label 段 = 缩进 2 + x×27 + …（行宽帽 30 … 收口）
    expect(readRow(grid, 0, 30)).toBe(`  ${'x'.repeat(27)}…`);
  });

  it('无 detail：label 独占全宽 … 截断（修前裸裁到缓冲界红）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: 'y'.repeat(40), replacement: 'y' }],
      query: '',
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(20, 1);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 1 });
    expect(readRow(grid, 0, 20)).toBe(`  ${'y'.repeat(17)}…`);
  });

  it('极窄窗（宽 2）：label 按帽 … 收口、desc 隐（起列越帽结构性封堵——右对齐制时代「预算 0 放行原宽」坏形的同位收口）', () => {
    // 宽 2：descCap = ⌊2×0.7⌋ = 1 < descCol ——desc 不放行；label 段
    // '  cmd'（5 列）按帽 2 收口 = ' …'
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: 'cmd', replacement: 'cmd', detail: 'info' }],
      query: '',
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(2, 1);
    popup.render(grid, { row: 0, col: 0, width: 2, height: 1 });
    expect(readRow(grid, 0, 2)).toBe(' …');
  });
});

describe('AutocompletePopup 选中行 accent bold（R-6 翻档——光标符/inverse 退役）', () => {
  it('选中行整行 accent bold、无 › 前缀符无 inverse；未选中行 2 空格缩进无样式', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [
        { label: '/help', replacement: '/help' },
        { label: '/hint', replacement: '/hint' },
      ],
      query: '',
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(20, 2);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 2 });
    // 选中行（item 0）：首格 = 空格（2 空格缩进——› 光标前缀符退役）、
    // label 格 accent + bold、无 inverse（修前红：inverse 反色 + › 符位）
    expect(grid.getCell(0, 0)?.grapheme).toBe(' ');
    expect(grid.getCell(0, 2)?.style?.fg).toBe(DEFAULT_THEME.accent);
    expect(grid.getCell(0, 2)?.style?.bold).toBe(true);
    expect(grid.getCell(0, 2)?.style?.inverse).toBeUndefined();
    // 未选中行（item 1）：label 格默认前景（无 fg/bold——空样式对象）
    expect(grid.getCell(1, 2)?.style?.fg).toBeUndefined();
    expect(grid.getCell(1, 2)?.style?.bold).toBeUndefined();
  });

  it('setTheme 换装后选中行前景随迁（activeStyle 重建）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({ items: [{ label: '/help', replacement: '/help' }], query: '', replaceStart: 0, replaceEnd: 1 });
    const light = resolveTheme(builtinPalette('light'), DEFAULT_THEME.depth);
    popup.setTheme(light);
    const grid = new CellGrid(20, 1);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 1 });
    expect(grid.getCell(0, 2)?.style?.fg).toBe(light.accent);
  });
});

describe('AutocompletePopup 弹层观感四点（Codex 样式复刻批 R-6 修前红）', () => {
  it('可见行帽 8：12 条候选 measure = 8（修前红位：帽 10 → measure 10）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: Array.from({ length: 12 }, (_, i) => ({ label: `cmd${i}`, replacement: `cmd${i}` })),
      query: '',
      replaceStart: 0,
      replaceEnd: 1,
    });
    expect(popup.measure(80)).toBe(8);
  });

  it('空态行 dim + italic（修前红：accent 空态档——fg=accent 无 dim/italic）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({ items: [], query: '', replaceStart: 0, replaceEnd: 2 });
    const grid = new CellGrid(10, 1);
    popup.render(grid, { row: 0, col: 0, width: 10, height: 1 });
    const style = grid.getCell(0, 0)?.style;
    expect(style?.dim).toBe(true);
    expect(style?.italic).toBe(true);
    expect(style?.fg).toBeUndefined();
  });

  it('desc 列对齐制：起列 = 全集 max(label 宽)+4、段 dim、选中行覆盖 accent bold；desc 超可用宽 … 收口', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [
        { label: 'cmd', replacement: 'cmd', detail: 'info' },
        { label: 'x', replacement: 'x', detail: 'y' },
      ],
      query: '',
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(20, 2);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 2 });
    // maxLabelW = 3 → descCol = 2+3+2 = 7；descCap = ⌊20×0.7⌋ = 14 →
    // descAvail = 7。两行 desc 同列 7 起（列对齐——修前右对齐制锚退役）
    expect(readRow(grid, 0, 20)).toBe('  cmd  info');
    expect(readRow(grid, 1, 20)).toBe('  x    y');
    // 选中行（item 0）desc 段 accent bold 覆盖；未选中行 desc dim
    expect(grid.getCell(0, 7)?.style?.fg).toBe(DEFAULT_THEME.accent);
    expect(grid.getCell(1, 7)?.style?.dim).toBe(true);
  });

  it('desc 段右界帽 ≤ 区域宽 70%：超帽 … 收口（descAvail 内收口不越 70% 界）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: 'ab', replacement: 'ab', detail: 'd'.repeat(10) }],
      query: '',
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(20, 1);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 1 });
    // maxLabelW = 2 → descCol = 6；descCap = 14 → descAvail = 8 →
    // 'd'×7 + …（8 列，尾列 13 ≤ 帽 14——右对齐制时代右贴 region 边形退役）
    expect(readRow(grid, 0, 20)).toBe(`  ab  ${'d'.repeat(7)}…`);
  });

  it('滚动不挪列：desc 起列按全集 max(label 宽)（不可见长 label 也在基准内——修前右对齐制无列概念，本测锁全集基准语义）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: Array.from({ length: 12 }, (_, i) => ({ label: `cmd${i}`, replacement: `cmd${i}`, detail: 'd' })),
      query: '',
      replaceStart: 0,
      replaceEnd: 1,
    });
    // 高亮移到 item 8 → 窗口滚动（windowStart = 1），可见窗 [1..8]
    for (let i = 0; i < 8; i++) popup.handleEvent(key('down'));
    const grid = new CellGrid(20, 8);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 8 });
    // 全集 maxLabelW = 5（cmd10/cmd11）→ descCol = 9（若按可见窗算会挪到
    // col 8——锁全集基准〔滚动不挪列〕）；可见首行 item 1 = '  cmd1' + 3 空 + 'd'
    expect(readRow(grid, 0, 20)).toBe('  cmd1   d');
  });
});

describe('AutocompletePopup 命中字符 bold（挖掘 29 轮批 C 件 a——挂账兑现）', () => {
  it('未选中行 per-char 命中 bold：query 命中格 bold、未中格默认前景（修前红：整行单样式零命中分档）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    // '/plg-x' 位序：/(col2) p(3) l(4) g(5) -(6) x(7)——'plg' 命中 p/l/g（非邻接位）
    popup.applyResult({
      items: [
        { label: '/plugins', replacement: '/plugins' },
        { label: '/plg-x', replacement: '/plg-x' },
      ],
      query: 'plg',
      replaceStart: 0,
      replaceEnd: 4,
    });
    const grid = new CellGrid(20, 2);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 2 });
    // 未选中行（row 1 = item 1）：'/'(col2) 默认、p(3)/l(4)/g(5) 命中 bold、'-'(6) 默认
    expect(grid.getCell(1, 2)?.style?.bold).toBeUndefined(); // 未中格 /
    expect(grid.getCell(1, 3)?.style?.bold).toBe(true); // 命中格 p
    expect(grid.getCell(1, 4)?.style?.bold).toBe(true); // 命中格 l
    expect(grid.getCell(1, 5)?.style?.bold).toBe(true); // 命中格 g
    expect(grid.getCell(1, 6)?.style?.bold).toBeUndefined(); // 未中格 -
    // 命中格无 fg（bold 不着色——accent 属选中行整行档）
    expect(grid.getCell(1, 3)?.style?.fg).toBeUndefined();
  });

  it('选中行整行 accent bold 覆盖命中 bold（bold 叠 bold 不分档）；缩进 2 空格恒默认前景', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: '/plugins', replacement: '/plugins' }],
      query: 'plg',
      replaceStart: 0,
      replaceEnd: 4,
    });
    const grid = new CellGrid(20, 1);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 1 });
    // 选中行：整行所有 span accent bold（缩进空格同辖——「整行」义；含未命中格）
    expect(grid.getCell(0, 2)?.style?.fg).toBe(DEFAULT_THEME.accent);
    expect(grid.getCell(0, 2)?.style?.bold).toBe(true);
    expect(grid.getCell(0, 3)?.style?.fg).toBe(DEFAULT_THEME.accent); // 命中格同为整行档（bold 叠 bold 不分档）
  });

  it('空 query 与无命中形零 bold（源以非 label 键过滤〔id 形〕诚实不加亮）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [
        { label: '/help', replacement: '/help' },
        { label: '/model', replacement: '/model' },
      ],
      query: '',
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(20, 2);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 2 });
    expect(grid.getCell(1, 2)?.style?.bold).toBeUndefined(); // 空 query 零 bold
    // 无命中形：query 与 label 无子序列关系（现算无命中即诚实不加亮）
    popup.applyResult({
      items: [
        { label: '完全不同', replacement: 'x' },
        { label: '/model', replacement: '/model' },
      ],
      query: 'zzz',
      replaceStart: 0,
      replaceEnd: 3,
    });
    const grid2 = new CellGrid(20, 2);
    popup.render(grid2, { row: 0, col: 0, width: 20, height: 2 });
    expect(grid2.getCell(1, 2)?.style?.bold).toBeUndefined(); // 无命中零 bold
  });

  it('label 截断形（… 收口）诚实降级整行默认前景（命中位越界不半亮）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [
        { label: 'x'.repeat(70), replacement: 'x' },
        { label: 'y'.repeat(70), replacement: 'y' },
      ],
      query: 'xy',
      replaceStart: 0,
      replaceEnd: 2,
    });
    const grid = new CellGrid(30, 2);
    popup.render(grid, { row: 0, col: 0, width: 30, height: 2 });
    // 未选中行（row 1）截断 → 零 bold（… 收口形命中位失真——诚实降级）
    for (let col = 2; col < 30; col++) {
      expect(grid.getCell(1, col)?.style?.bold).toBeUndefined();
    }
  });
});

/* ---------------- 命中游程字素对齐（67 轮——游程最小单元改字素） ---------------- */

/** 枚举行内孤立代理半格（长度 1 的 UTF-16 代理码元——游程劈半病真身） */
function loneSurrogateCells(grid: CellGrid, row: number, width: number): string[] {
  const found: string[] = [];
  for (let col = 0; col < width; col++) {
    const g = grid.getCell(row, col)?.grapheme;
    if (g !== undefined && g.length === 1) {
      const code = g.charCodeAt(0);
      if (code >= 0xd800 && code <= 0xdfff) found.push(g); // 高/低代理码区
    }
  }
  return found;
}

/** 枚举行内独立组合符格（U+0300-036F 单独占格——幻影格病真身） */
function loneCombiningCells(grid: CellGrid, row: number, width: number): string[] {
  const found: string[] = [];
  for (let col = 0; col < width; col++) {
    const g = grid.getCell(row, col)?.grapheme;
    if (g !== undefined && g.length === 1) {
      const code = g.charCodeAt(0);
      if (code >= 0x0300 && code <= 0x036f) found.push(g); // 组合附加符号区
    }
  }
  return found;
}

describe('AutocompletePopup 命中游程字素对齐（67 轮）', () => {
  // 修前病：游程按 UTF-16 码元推进，而 fuzzy 回射位只含码点起点——星面字素
  // （emoji 代理对）在起点+1 断段、slice 劈孤立代理（终端出两 U+FFFD 替换
  // 符）；组合簇劈两段（独立组合符占幻影格、cursor 多推一格、desc 列右漂）。
  // 修后游程最小单元 = 字素（整素成段、素内任一码元起点命中即整素 bold——
  // 组合符不可独立呈现，整簇同档是显示层正形）。断言锁 cell 层文本与样式档
  // （HIT_STYLE 施加面），不锁实现内部结构。
  it('锁1 代理对整素不劈半：query 命中 emoji → 完整字素成段且命中格 bold、行内零孤立代理半（修前红：🎉 被劈成两半格）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    // 'a🎉b'：🎉 = U+1F389 两码元代理对；query '🎉' 命中其起点码元（fuzzy
    // 回射只含码点起点——次码元不在 hit 集，修前游程在起点+1 断段）
    popup.applyResult({
      items: [
        { label: 'other', replacement: 'other' },
        { label: 'a🎉b', replacement: 'a🎉b' },
      ],
      query: '🎉',
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(20, 2);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 2 });
    // 逐格枚举断言（行文本拼接会把两代理半拼回伪合法串——必须按格判）
    expect(loneSurrogateCells(grid, 1, 20)).toEqual([]); // 修前红：['\ud83c', '\udf89']
    // 完整 🎉 在场（首格 col 3 = 缩进 2 + 'a' 1）且命中段整素 bold
    expect(grid.getCell(1, 3)?.grapheme).toBe('🎉');
    expect(grid.getCell(1, 3)?.style?.bold).toBe(true);
    // 宽字素续格（col 4，宽 2 第二列）同 bold 档——整素两格同受 HIT_STYLE
    expect(grid.getCell(1, 4)?.style?.bold).toBe(true);
    expect(grid.getCell(1, 4)?.grapheme).toBe(''); // 续格空串占位（width 0——网格契约）
    // 'b' 紧随续格落 col 5（cursor 按整素显示宽 2 推进）
    expect(grid.getCell(1, 5)?.grapheme).toBe('b');
    expect(grid.getCell(1, 5)?.style?.bold).toBeUndefined(); // b 未命中默认前景
  });

  it('锁2 组合簇整簇同档：query 命中簇首码元 → 整簇串同格同 bold、cursor 按整簇宽推进零幻影格', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    // 'caféx'：e（U+0065）+ 组合锐音符（U+0301）合成一字素；query 'e'
    // 命中簇首码元——修前游程把簇劈成 'e'（bold）+ 独立组合符（非 bold 幻影格）
    popup.applyResult({
      items: [
        { label: 'other', replacement: 'other' },
        { label: 'caféx', replacement: 'x' },
      ],
      query: 'e',
      replaceStart: 0,
      replaceEnd: 1,
    });
    const grid = new CellGrid(20, 2);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 2 });
    // 簇格（col 5 = 缩进 2 + caf 3）：整簇串一格且 bold（修前红：格内只 'e'、
    // 组合符漂到次格非 bold）
    expect(grid.getCell(1, 5)?.grapheme).toBe('é');
    expect(grid.getCell(1, 5)?.style?.bold).toBe(true);
    // cursor 按整簇显示宽推进（stringWidth('é') = 1）：'x' 紧邻簇格落
    // col 6（修前红：独立组合符占 col 6 幻影格、x 漂到 col 7——desc 列右漂同源）
    expect(grid.getCell(1, 6)?.grapheme).toBe('x');
    expect(grid.getCell(1, 6)?.style?.bold).toBeUndefined(); // x 未命中默认前景
    expect(grid.getCell(1, 7)?.grapheme).toBe(' '); // 幻影格防线：col 7 回归空格（未写）
    // 行内零独立组合符格（组合符不可独立呈现——整簇同档的显示层正形）
    expect(loneCombiningCells(grid, 1, 20)).toEqual([]);
  });

  it('锁3 ASCII 路不漂：纯 ASCII 命中游程逐格 bold 档不变（防过修回归锁）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [
        { label: '/plugins', replacement: '/plugins' },
        { label: '/plg-x', replacement: '/plg-x' },
      ],
      query: 'plg',
      replaceStart: 0,
      replaceEnd: 4,
    });
    const grid = new CellGrid(20, 2);
    popup.render(grid, { row: 0, col: 0, width: 20, height: 2 });
    // 语义等价性：ASCII 逐码点即逐字素——游程单元改字素后档位分布不得漂移
    //（与上方「挖掘 29 轮批 C 件 a」例同形互证）
    expect(grid.getCell(1, 2)?.style?.bold).toBeUndefined(); // '/' 未中
    expect(grid.getCell(1, 3)?.style?.bold).toBe(true); // p 命中
    expect(grid.getCell(1, 4)?.style?.bold).toBe(true); // l 命中
    expect(grid.getCell(1, 5)?.style?.bold).toBe(true); // g 命中
    expect(grid.getCell(1, 6)?.style?.bold).toBeUndefined(); // '-' 未中
    expect(grid.getCell(1, 7)?.style?.bold).toBeUndefined(); // 'x' 未中
  });
});

describe('AutocompletePopup 空条目诚实反馈（空结果诚实行律）', () => {
  // 注（2026-10-04 空态反馈批）：本 describe 两件是直喂 applyResult 的单元面
  // 锁（measure/render 空分支形为）——生产链锁（provider 空条目透传 → 弹层
  // 在场「无匹配」+ 空态键面）经 autocomplete.test.ts 近端到端件覆盖，两件
  // 保留作单元基线
  it('空条目量高 1（修前红：Math.min(0, MAX)=0 → fixed-budget 归零 → backend `budget.popup > 0` 门控跳渲染——render 空分支死路）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    expect(popup.measure(80)).toBe(0); // 不在场零高（浮层不占布局——旧锚不漂）
    popup.applyResult({ items: [], query: '', replaceStart: 0, replaceEnd: 2 }); // 空结果（打错前缀）
    expect(popup.measure(80)).toBe(1); // 修前红位：0——「无匹配」行被预算链结构性抹除
  });

  it('空条目 render 行为锁：铺底 + 「无匹配」串在位（空态行也是信息——model-picker「（无匹配…）」行同律）', () => {
    const model = new EditorModel();
    const popup = new AutocompletePopup(model);
    popup.applyResult({ items: [], query: '', replaceStart: 0, replaceEnd: 2 });
    const grid = new CellGrid(10, 1);
    popup.render(grid, { row: 0, col: 0, width: 10, height: 1 });
    expect(readRow(grid, 0, 10)).toContain('无匹配'); // 空分支呈现（修前结构不可达）
  });

  it('空态在场 enter/tab 穿透不吞（修前红：applySelection 空转仍返 true——「无匹配」在场逼成双回车形）', () => {
    const model = new EditorModel();
    model.setText('/zz'); // 光标落尾——token 区间 [0,3) 与 result 对拍新鲜（排除陈旧守卫相位）
    const popup = new AutocompletePopup(model);
    popup.applyResult({ items: [], query: '', replaceStart: 0, replaceEnd: 3 });
    expect(popup.handleEvent(key('enter'))).toBe(false); // 修前红位：吞键 true——回车必须透传编辑器走提交
    expect(popup.handleEvent(key('tab'))).toBe(false); // 空态无可选可应用——tab 回编辑器键面（编辑器未绑 tab 归终局）
    expect(model.getText()).toBe('/zz'); // 无代换发生
    expect(popup.visible).toBe(true); // 穿透不关层（弹层随下次落位重算）
  });

  it('空态在场 ↑/↓ 穿透（无候选可导航——箭头归编辑器）；escape 消费关层并通知', () => {
    const model = new EditorModel();
    model.setText('/zz');
    const popup = new AutocompletePopup(model);
    let dismissed = 0;
    popup.onDismiss = () => {
      dismissed += 1;
    };
    popup.applyResult({ items: [], query: '', replaceStart: 0, replaceEnd: 3 });
    expect(popup.handleEvent(key('up'))).toBe(false); // 修前红位：moveActive 空转吞箭头 true——堵编辑器历史回溯
    expect(popup.handleEvent(key('down'))).toBe(false);
    expect(popup.visible).toBe(true); // 穿透不关层
    expect(popup.handleEvent(key('escape'))).toBe(true); // escape 显式收层（空态行也是信息层）
    expect(popup.visible).toBe(false);
    expect(dismissed).toBe(1); // 关层联动通知（backend 撤防抖窗——与有候选轮同契约）
  });
});

/* ---------------- escape 粘滞（件 A——挖掘 46 轮：dismissed token 记忆） ---------------- */

describe('AutocompletePopup escape 粘滞（件 A——挖掘 46 轮）', () => {
  it('escape 记忆同 token 交付——续关不重开（修前红：无记忆恒落位重开）', () => {
    const model = new EditorModel();
    model.setText('/h'); // 光标落尾——token 区间 [0,2)
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: '/help', replacement: '/help' }],
      query: 'h',
      replaceStart: 0,
      replaceEnd: 2,
    });
    expect(popup.handleEvent(key('escape'))).toBe(true); // 拒——捕获身份 {line:0, start:0, text:'/h'}
    expect(popup.visible).toBe(false);
    // 同 token 后续交付（用户仍在该 token 上——backend 重查或迟到 fire 同形）
    popup.applyResult({
      items: [{ label: '/help', replacement: '/help' }],
      query: 'h',
      replaceStart: 0,
      replaceEnd: 2,
    });
    expect(popup.visible).toBe(false); // 身份全等丢弃交付——续关不闪回
  });

  it('续打扩展 token 断链清忆——重开（codex 语义：query 变更即新意图）', () => {
    const model = new EditorModel();
    model.setText('/h');
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: '/help', replacement: '/help' }],
      query: 'h',
      replaceStart: 0,
      replaceEnd: 2,
    });
    popup.handleEvent(key('escape')); // 记忆 {0, 0, '/h'}
    model.setText('/he'); // 续打扩展（光标落尾 col 3）
    popup.applyResult({
      items: [{ label: '/help', replacement: '/help' }],
      query: 'he',
      replaceStart: 0,
      replaceEnd: 3,
    });
    expect(popup.visible).toBe(true); // 身份不匹断链清忆——正常落位重开
  });

  it('清空后重打同形 token——首交付正常落位（token 消失 null 交付已断链清忆）', () => {
    const model = new EditorModel();
    model.setText('/h');
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: '/help', replacement: '/help' }],
      query: 'h',
      replaceStart: 0,
      replaceEnd: 2,
    });
    popup.handleEvent(key('escape')); // 记忆在身
    model.setText('');
    popup.applyResult(null); // 生产链 token 消失形：backend handleEditorChange 重查发 null
    model.setText('/h'); // 重打同形 token——新链
    popup.applyResult({
      items: [{ label: '/help', replacement: '/help' }],
      query: 'h',
      replaceStart: 0,
      replaceEnd: 2,
    });
    expect(popup.visible).toBe(true); // null 交付已清忆——首交付正常落位
  });

  it('同长置换编辑（光标 token 不变）——同 token 交付续关（修前红：无记忆恒落位重开）', () => {
    const model = new EditorModel();
    model.setText('x /h'); // token 区间 [2,4)，光标落尾 col 4 恰在 token 界
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: '/help', replacement: '/help' }],
      query: 'h',
      replaceStart: 2,
      replaceEnd: 4,
    });
    popup.handleEvent(key('escape')); // 记忆 {0, 2, '/h'}
    // 同长置换（置换 col 0 的 x——start 不移；setText 光标落行尾 col 4 仍在 token 界）
    model.setText('y /h');
    popup.applyResult({
      items: [{ label: '/help', replacement: '/help' }],
      query: 'h',
      replaceStart: 2,
      replaceEnd: 4,
    });
    expect(popup.visible).toBe(false); // 光标 token 与被拒身份全等——续关
  });

  it('tab 路不受记忆影响——恒应用；弹层关闭后 tab 穿透回编辑器', () => {
    const model = new EditorModel();
    model.setText('/h');
    const popup = new AutocompletePopup(model);
    popup.applyResult({
      items: [{ label: '/help', replacement: '/help' }],
      query: 'h',
      replaceStart: 0,
      replaceEnd: 2,
    });
    expect(popup.handleEvent(key('tab'))).toBe(true); // 正常轮 tab 恒应用（键面分离——记忆零涉）
    expect(model.getText()).toBe('/help');
    expect(popup.visible).toBe(false);
    // 弹层关闭（escape 记忆在场）后：无弹层可应用——tab 穿透归编辑器
    const model2 = new EditorModel();
    model2.setText('/h');
    const popup2 = new AutocompletePopup(model2);
    popup2.applyResult({
      items: [{ label: '/help', replacement: '/help' }],
      query: 'h',
      replaceStart: 0,
      replaceEnd: 2,
    });
    popup2.handleEvent(key('escape'));
    expect(popup2.handleEvent(key('tab'))).toBe(false); // 不在场不挡键
  });

  it('空态行 escape 也记身份——「无匹配」层同律续关（修前红：无记忆恒落位重开）', () => {
    const model = new EditorModel();
    model.setText('/zz'); // 打错前缀——空态行
    const popup = new AutocompletePopup(model);
    popup.applyResult({ items: [], query: 'zz', replaceStart: 0, replaceEnd: 3 });
    expect(popup.handleEvent(key('escape'))).toBe(true); // 空态层显式收层——身份同样捕获
    popup.applyResult({ items: [], query: 'zz', replaceStart: 0, replaceEnd: 3 }); // 同 token 再查仍空
    expect(popup.visible).toBe(false); // 空态层同律续关（被拒的是该 token 的补全——空非空无关）
  });
});
