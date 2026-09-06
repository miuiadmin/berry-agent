/**
 * 文本件单测（Text 单行截断 / Paragraph 字素折行）——CellGrid 真身读回
 * 断言（半字 / 悬挂由引擎整字三原语结构性排除，本测试锁组件接线的端到端
 * 形：写入落格 + 两段协商同一 wrapText 单源）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid } from '../engine/index.js';
import { Paragraph, Text } from './text.js';

/** 读回一行（未写格按空格、trimEnd 对齐视觉行） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

describe('Text（单行截断）', () => {
  it('写入落格：region 起点起写、measure 恒 1', () => {
    const grid = new CellGrid(10, 3);
    const text = new Text({ content: 'hello' });
    expect(text.measure(10)).toBe(1);
    text.render(grid, { row: 1, col: 2, width: 10, height: 1 });
    expect(readRow(grid, 1, 10)).toBe('  hello');
  });

  it('超宽截断：宽度帽内截断', () => {
    const grid = new CellGrid(10, 1);
    new Text({ content: 'hello world' }).render(grid, { row: 0, col: 0, width: 5, height: 1 });
    expect(readRow(grid, 0, 10)).toBe('hello');
  });

  it('CJK 双宽截断整字不产半字：末位恰剩一列放不下双宽字素', () => {
    const grid = new CellGrid(10, 1);
    // 5 列帽：'ab'（2 列）+ '中'（2 列）= 4 列，'文' 再 2 列超帽整字丢弃
    new Text({ content: 'ab中文' }).render(grid, { row: 0, col: 0, width: 5, height: 1 });
    expect(readRow(grid, 0, 10)).toBe('ab中');
    // 半字防线：第 4 列（'文' 若产半字会占）为空
    expect(grid.getCell(0, 4)).toBeNull();
  });

  it('零宽 / 零高区域：无操作不炸', () => {
    const grid = new CellGrid(4, 2);
    expect(() => new Text({ content: 'x' }).render(grid, { row: 0, col: 0, width: 0, height: 1 })).not.toThrow();
    expect(() => new Text({ content: 'x' }).render(grid, { row: 0, col: 0, width: 4, height: 0 })).not.toThrow();
  });
});

describe('Paragraph（字素折行）', () => {
  it('显式 \\n 分段：空行语义保留', () => {
    const grid = new CellGrid(10, 3);
    const p = new Paragraph({ content: 'a\n\nb' });
    expect(p.measure(10)).toBe(3);
    p.render(grid, { row: 0, col: 0, width: 10, height: 3 });
    expect(readRow(grid, 0, 10)).toBe('a');
    expect(readRow(grid, 1, 10)).toBe('');
    expect(readRow(grid, 2, 10)).toBe('b');
  });

  it('列宽折行：满行整字下移', () => {
    const grid = new CellGrid(5, 2);
    const p = new Paragraph({ content: 'abcdef' });
    expect(p.measure(5)).toBe(2);
    p.render(grid, { row: 0, col: 0, width: 5, height: 2 });
    expect(readRow(grid, 0, 5)).toBe('abcde');
    expect(readRow(grid, 1, 5)).toBe('f');
  });

  it('CJK 折行：行末剩一列遇双宽字素整字下移不悬挂', () => {
    const grid = new CellGrid(5, 2);
    // 5 列：'ab'（2）+ '中'（2）= 4 列，'文' 需 2 列——整字下移
    const p = new Paragraph({ content: 'ab中文' });
    expect(p.measure(5)).toBe(2);
    p.render(grid, { row: 0, col: 0, width: 5, height: 2 });
    expect(readRow(grid, 0, 5)).toBe('ab中');
    expect(readRow(grid, 1, 5)).toBe('文');
    // 不悬挂：第 4 列空（半字 / 悬挂双防线）
    expect(grid.getCell(0, 4)).toBeNull();
  });

  it('两段协商单源：measure(width) 与 render 行数同源（换宽度同判）', () => {
    const content = '一二三四五六七八九十';
    for (const width of [4, 5, 6, 20]) {
      const p = new Paragraph({ content });
      const expected = Math.ceil(10 / Math.floor(width / 2)); // 每行可容双宽字素数 = floor(width/2)（奇数宽末列放不下双宽字素）
      expect(p.measure(width)).toBe(expected);
      const grid = new CellGrid(width, expected + 1);
      p.render(grid, { row: 0, col: 0, width, height: expected + 1 });
      const written = Array.from({ length: expected + 1 }, (_, r) => readRow(grid, r, width)).filter(
        (line) => line !== '',
      ).length;
      expect(written).toBe(expected);
    }
  });

  it('超高截断：只写 region.height 内行（grid 单行——第 2 行物理无处落）', () => {
    const grid = new CellGrid(3, 1);
    const p = new Paragraph({ content: 'abcdef' }); // 3 列折 2 行
    p.render(grid, { row: 0, col: 0, width: 3, height: 1 });
    expect(readRow(grid, 0, 3)).toBe('abc');
  });
});
