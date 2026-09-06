/**
 * 编辑器视图单测：CellGrid 真身读回——边框两态（accent / 普通）、
 * 长行字素硬折落格、滚动指示入边框、视口滚动光标恒可视、光标声明
 * （聚焦独占）、IME 预编辑下划线段。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid, ansiColor } from '../../engine/index.js';
import { ACCENT_INDEX } from '../theme.js';
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
  it('空框量高 3（边框 2 + 单行）', () => {
    const { view } = viewOf('');
    expect(view.measure(20)).toBe(3);
  });

  it('视觉行数夹 maxVisibleLines', () => {
    const { view } = viewOf('a\nb\nc\nd\ne', { maxVisibleLines: 2 });
    expect(view.measure(20)).toBe(4); // 2 边框 + 2 行
  });

  it('长行折行计入量高（字素硬折）', () => {
    const { view } = viewOf('aaaaaaaaaa', { layoutWidth: 8 });
    expect(view.measure(10)).toBe(4); // 8 列折两行
  });
});

describe('EditorView 边框', () => {
  it('边框形与正文落位', () => {
    const { view } = viewOf('ab');
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 6, height: 3 });
    expect(readRow(grid, 0, 10)).toBe('┌────┐');
    expect(readRow(grid, 1, 10)).toBe('│ab  │');
    expect(readRow(grid, 2, 10)).toBe('└────┘');
  });

  it('聚焦态边框 accent 高亮、非聚焦普通', () => {
    const { view } = viewOf('ab');
    const focused = new CellGrid(10, 5);
    view.setFocused(true);
    view.render(focused, { row: 0, col: 0, width: 6, height: 3 });
    expect(focused.getCell(0, 0)?.style.fg).toEqual(ansiColor(ACCENT_INDEX));
    const plain = new CellGrid(10, 5);
    view.setFocused(false);
    view.render(plain, { row: 0, col: 0, width: 6, height: 3 });
    expect(plain.getCell(0, 0)?.style.fg).toBeUndefined();
  });

  it('region 平移：起点非零', () => {
    const { view } = viewOf('ab');
    const grid = new CellGrid(12, 5);
    view.render(grid, { row: 1, col: 3, width: 6, height: 3 });
    expect(readRow(grid, 1, 12)).toBe('   ┌────┐');
    expect(readRow(grid, 2, 12)).toBe('   │ab  │');
  });
});

describe('EditorView 长行字素硬折', () => {
  it('超宽逻辑行折入多行（整字下移）', () => {
    const { view } = viewOf('中中中中', { layoutWidth: 4 });
    const grid = new CellGrid(6, 5);
    view.render(grid, { row: 0, col: 0, width: 6, height: 5 });
    // 每视觉行恰 2 个 CJK（4 列），共 2 行
    expect(readRow(grid, 1, 6)).toBe('│中中│');
    expect(readRow(grid, 2, 6)).toBe('│中中│');
  });
});

describe('EditorView 滚动指示与视口', () => {
  it('下方溢出显 ↓n 入底边框', () => {
    const { view, model } = viewOf('a\nb\nc\nd\ne', { maxVisibleLines: 2 });
    model.moveHome(); // 归列
    for (let i = 0; i < 4; i++) model.moveUp(); // 光标归首行行首
    const grid = new CellGrid(10, 4);
    view.render(grid, { row: 0, col: 0, width: 10, height: 4 });
    expect(readRow(grid, 1, 10)).toBe('│a       │');
    expect(readRow(grid, 2, 10)).toBe('│b       │');
    expect(readRow(grid, 3, 10)).toBe('└───── ↓3┘');
  });

  it('光标滚出下方沉底 + 上方溢出显 ↑n', () => {
    // setText 光标归尾（末行 'e'）——渲染须滚到光标可视
    const { view } = viewOf('a\nb\nc\nd\ne', { maxVisibleLines: 2 });
    const grid = new CellGrid(10, 4);
    view.render(grid, { row: 0, col: 0, width: 10, height: 4 });
    expect(readRow(grid, 1, 10)).toBe('│d       │');
    expect(readRow(grid, 2, 10)).toBe('│e       │');
    expect(readRow(grid, 0, 10)).toBe('┌───── ↑3┐');
  });
});

describe('EditorView 光标声明', () => {
  it('聚焦声明本帧光标（正文区 + 显示列）', () => {
    const { view } = viewOf('ab');
    view.setFocused(true);
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 6, height: 3 });
    expect(grid.cursor).toEqual({ row: 1, col: 3, visible: true }); // 1 边框 + 2 字符
  });

  it('非聚焦不声明', () => {
    const { view } = viewOf('ab');
    view.setFocused(false);
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 6, height: 3 });
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
    view.render(grid, { row: 0, col: 0, width: 10, height: 3 });
    expect(grid.cursor).toEqual({ row: 1, col: 5, visible: true }); // 1 边框 + 显示列 4
  });
});

describe('EditorView IME 预编辑', () => {
  it('组字段下划线呈现于光标处、不并入正文', () => {
    const { view, model } = viewOf('ab');
    model.moveHome(); // 光标归首
    model.setPreedit('中');
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 10, height: 3 });
    const preeditCell = grid.getCell(1, 1); // '中' 占 col 1-2（双宽一格铺续格）
    expect(preeditCell?.grapheme).toBe('中');
    expect(preeditCell?.style.underline).toBe(true);
    expect(grid.getCell(1, 3)?.grapheme).toBe('a'); // 正文后移未删
    expect(grid.getCell(1, 4)?.grapheme).toBe('b');
    expect(model.getText()).toBe('ab'); // 正文不含组字段
  });

  it('组字期光标声明含预编辑宽', () => {
    const { view, model } = viewOf('');
    model.setPreedit('中');
    view.setFocused(true);
    const grid = new CellGrid(10, 5);
    view.render(grid, { row: 0, col: 0, width: 10, height: 3 });
    expect(grid.cursor).toEqual({ row: 1, col: 3, visible: true }); // 1 边框 + 2 显示列
  });
});
