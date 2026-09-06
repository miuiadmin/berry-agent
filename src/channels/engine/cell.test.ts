/**
 * cell 缓冲件测试（07 引擎节件 3——三元网格 / 宽字符续格 / 覆写摘痕 /
 * 字素面差分自证 / 光标声明 / 越界吸收）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid, cellEquals, EMPTY_STYLE, styleEquals } from './cell.js';

describe('三元网格与宽字符续格', () => {
  it('常规字素：单格三元（码点面 + 样式 + 列宽 1）', () => {
    const grid = new CellGrid(10, 3);
    grid.setCell(0, 0, 'a');
    const cell = grid.getCell(0, 0);
    expect(cell).not.toBeNull();
    expect(cell?.grapheme).toBe('a');
    expect(cell?.width).toBe(1);
  });

  it('宽字符：首格 width 2 + 续格空字素 width 0（与主流终端续格形同构）', () => {
    const grid = new CellGrid(10, 3);
    grid.setCell(0, 2, '中');
    expect(grid.getCell(0, 2)?.width).toBe(2);
    const cont = grid.getCell(0, 3);
    expect(cont?.grapheme).toBe('');
    expect(cont?.width).toBe(0);
  });

  it('writeText 字素级推进：返回推进后列位（双宽字素占双列）', () => {
    const grid = new CellGrid(10, 3);
    expect(grid.writeText(0, 0, 'a中b')).toBe(4); // 1 + 2 + 1
    expect(grid.getCell(0, 3)?.grapheme).toBe('b');
    expect(grid.writeText(1, 0, '')).toBe(0); // 空串零推进
  });

  it('多码点字素整串入格（ZWJ 家庭 = 一格 + 一续格）', () => {
    const grid = new CellGrid(10, 3);
    grid.setCell(0, 0, '👨‍👩‍👧');
    expect(grid.getCell(0, 0)?.grapheme).toBe('👨‍👩‍👧'); // 整素串入格
    expect(grid.getCell(0, 1)?.width).toBe(0);
  });
});

describe('越界吸收与几何', () => {
  it('越界写静默吸收（渲染契约：越界写由缓冲吸收）', () => {
    const grid = new CellGrid(4, 2);
    expect(() => grid.setCell(0, 99, 'x')).not.toThrow();
    expect(() => grid.setCell(99, 0, 'x')).not.toThrow();
    expect(() => grid.setCell(0, -1, 'x')).not.toThrow();
    expect(grid.getCell(0, 99)).toBeNull();
  });

  it('宽字符右界越界：首格入格、续格界外截断（双保险兜底）', () => {
    const grid = new CellGrid(4, 2);
    grid.setCell(0, 3, '中'); // 末列写双宽——续格在界外
    expect(grid.getCell(0, 3)?.grapheme).toBe('中');
  });

  it('clear 摘格清屏（零分配语义——内容清、几何不变）', () => {
    const grid = new CellGrid(4, 2);
    grid.writeText(0, 0, 'ab');
    grid.clear();
    expect(grid.getCell(0, 0)).toBeNull();
    expect(grid.columns).toBe(4);
  });

  it('resize 唯一重分配点：内容弃置不搬运（弃旧换新归编排重绘）', () => {
    const grid = new CellGrid(4, 2);
    grid.writeText(0, 0, 'ab');
    grid.setCursor(0, 1);
    grid.resize(6, 4);
    expect(grid.getCell(0, 0)).toBeNull(); // 不搬运
    expect(grid.columns).toBe(6);
    expect(grid.rows).toBe(4);
    expect(grid.cursor).toBeNull(); // 光标声明随弃置
  });
});

describe('覆写摘痕（多码点 / 宽字素防新旧混叠）', () => {
  it('窄字覆写宽字首格：续格一并摘净（无残影）', () => {
    const grid = new CellGrid(10, 2);
    grid.setCell(0, 0, '中'); // 占 [0,1]
    grid.setCell(0, 0, 'a');
    expect(grid.getCell(0, 0)?.grapheme).toBe('a');
    expect(grid.getCell(0, 1)).toBeNull(); // 旧续格摘净
  });

  it('覆写落在旧宽字续格位：回溯首格整字摘除', () => {
    const grid = new CellGrid(10, 2);
    grid.setCell(0, 0, '中');
    grid.setCell(0, 1, 'b'); // 写在续格位——旧「中」整字摘
    expect(grid.getCell(0, 0)).toBeNull(); // 首格被摘
    expect(grid.getCell(0, 1)?.grapheme).toBe('b');
    expect(grid.getCell(0, 2)).toBeNull();
  });

  it('新宽字覆写旧宽字：旧右续格不残留（摘痕区间含右邻溢出格）', () => {
    const grid = new CellGrid(10, 2);
    grid.writeText(0, 0, '中x'); // 中占 [0,1] x 在 2
    grid.setCell(0, 1, '文'); // 覆在旧续格位——摘旧「中」再写「文」占 [1,2]
    expect(grid.getCell(0, 0)).toBeNull();
    expect(grid.getCell(0, 1)?.grapheme).toBe('文');
    expect(grid.getCell(0, 2)?.width).toBe(0); // 「文」的续格（旧 x 位被占）
    expect(grid.getCell(0, 3)).toBeNull();
  });
});

describe('字素面差分自证', () => {
  it('同首码点不同字素不得判等（VS16 呈现形与裸基字符）', () => {
    const plain = { grapheme: '✓', style: EMPTY_STYLE, width: 1 as const };
    const emojiForm = { grapheme: '✓️', style: EMPTY_STYLE, width: 2 as const };
    expect(cellEquals(plain, emojiForm)).toBe(false); // 字素串不同 → 不等
  });

  it('null 与「缺省空格格」语义归一判等（不产假变更帧）', () => {
    const blankCell = { grapheme: ' ', style: EMPTY_STYLE, width: 1 as const };
    expect(cellEquals(null, blankCell)).toBe(true);
    expect(cellEquals(null, null)).toBe(true);
  });

  it('续格与空格格判不等（宽字素占位语义不可丢）', () => {
    const cont = { grapheme: '', style: EMPTY_STYLE, width: 0 as const };
    const blank = { grapheme: ' ', style: EMPTY_STYLE, width: 1 as const };
    expect(cellEquals(cont, blank)).toBe(false);
  });

  it('样式参与格相等（同字素异样式判变）', () => {
    const a = { grapheme: 'a', style: EMPTY_STYLE, width: 1 as const };
    const b = { grapheme: 'a', style: { bold: true }, width: 1 as const };
    expect(cellEquals(a, b)).toBe(false);
    expect(styleEquals(EMPTY_STYLE, { bold: undefined })).toBe(true); // 缺省归一
  });
});

describe('本帧光标声明（竞声明以末次为准）', () => {
  it('多次声明取末次', () => {
    const grid = new CellGrid(10, 3);
    grid.setCursor(0, 0);
    grid.setCursor(2, 5);
    expect(grid.cursor).toEqual({ row: 2, col: 5, visible: true });
  });

  it('clearCursor 清除本帧声明', () => {
    const grid = new CellGrid(10, 3);
    grid.setCursor(0, 0);
    grid.clearCursor();
    expect(grid.cursor).toBeNull();
  });

  it('clear 后声明归零', () => {
    const grid = new CellGrid(10, 3);
    grid.setCursor(1, 1);
    grid.clear();
    expect(grid.cursor).toBeNull();
  });
});
