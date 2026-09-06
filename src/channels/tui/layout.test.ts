/**
 * 布局组合子单测（Flex / Column / Row / Inset——分配算法锁）。
 *
 * probe 替身记录每次落位 region（分配结果的直接证据——不依赖文本渲染）；
 * 端到端组合（Column + Row + Paragraph）验真组件接线。
 */
import { describe, expect, it } from 'vitest';
import type { Region, Renderable } from '../engine/index.js';
import { CellGrid } from '../engine/index.js';
import { Column, Flex, Inset, Row, isFlexRenderable } from './layout.js';
import { Paragraph, Text } from './text.js';

/** 落位记录替身（固定高可设——固定子形） */
function probe(height: number): Renderable & { regions: Region[] } {
  const regions: Region[] = [];
  return {
    measure: () => height,
    render(_buffer, region) {
      regions.push(region);
    },
    regions,
  };
}

describe('isFlexRenderable（结构判据）', () => {
  it('Flex 包装真值 / 普通件假值', () => {
    expect(isFlexRenderable(new Flex({ child: probe(1) }))).toBe(true);
    expect(isFlexRenderable(probe(1))).toBe(false);
  });
});

describe('Flex（吸收余量信号位）', () => {
  it('measure 最小占位 1 / 落位全透传子件', () => {
    const child = probe(5);
    const flex = new Flex({ child });
    expect(flex.measure(10)).toBe(1); // 协商最小占位（真高度由 Column 分配）
    const grid = new CellGrid(10, 5);
    flex.render(grid, { row: 1, col: 2, width: 6, height: 4 });
    expect(child.regions).toEqual([{ row: 1, col: 2, width: 6, height: 4 }]);
  });
});

describe('Column（垂直堆叠分配）', () => {
  it('固定子顺排：measure 合计 / 落位依序无空隙', () => {
    const a = probe(2);
    const b = probe(1);
    const col = new Column({ children: [a, b] });
    expect(col.measure(10)).toBe(3);
    const grid = new CellGrid(10, 5);
    col.render(grid, { row: 1, col: 0, width: 10, height: 5 });
    expect(a.regions).toEqual([{ row: 1, col: 0, width: 10, height: 2 }]);
    expect(b.regions).toEqual([{ row: 3, col: 0, width: 10, height: 1 }]);
  });

  it('Flex 子吸收余量：固定子定高后余量全给 Flex（断言落位透传到 child）', () => {
    const fixed = probe(1);
    const growChild = probe(1);
    const grow = new Flex({ child: growChild });
    const col = new Column({ children: [fixed, grow] });
    expect(col.measure(10)).toBe(2); // Flex 按最小占位 1 计
    const grid = new CellGrid(10, 10);
    col.render(grid, { row: 0, col: 0, width: 10, height: 10 });
    expect(fixed.regions).toEqual([{ row: 0, col: 0, width: 10, height: 1 }]);
    expect(growChild.regions[0]?.height).toBe(9); // 10 - 1 固定 = 余量全吸收
  });

  it('双 Flex 均分 + 整除余数给末子：余 9 → 4 + 5', () => {
    const firstChild = probe(1);
    const lastChild = probe(1);
    const first = new Flex({ child: firstChild });
    const last = new Flex({ child: lastChild });
    const col = new Column({ children: [probe(1), first, last] });
    const grid = new CellGrid(10, 10);
    col.render(grid, { row: 0, col: 0, width: 10, height: 10 });
    expect(firstChild.regions[0]?.height).toBe(4); // floor(9/2)
    expect(lastChild.regions[0]?.height).toBe(5); // 末子收余数
    expect(lastChild.regions[0]?.row).toBe(5); // 1 固定 + 4 首份——顺排
  });

  it('底部溢出截断：固定子合计超区域高，末子收截断', () => {
    const a = probe(3);
    const b = probe(3);
    const col = new Column({ children: [a, b] });
    const grid = new CellGrid(10, 4);
    col.render(grid, { row: 0, col: 0, width: 10, height: 4 });
    expect(a.regions).toEqual([{ row: 0, col: 0, width: 10, height: 3 }]);
    expect(b.regions).toEqual([{ row: 3, col: 0, width: 10, height: 1 }]); // 截断到 1
  });

  it('溢出后的子零渲染（row 已越底）', () => {
    const a = probe(4);
    const b = probe(1);
    const col = new Column({ children: [a, b] });
    const grid = new CellGrid(10, 4);
    col.render(grid, { row: 0, col: 0, width: 10, height: 4 });
    expect(b.regions).toEqual([]); // a 占满——b 不再渲染
  });

  it('零子measure最小1：measure(空子列表) 恒 ≥1', () => {
    expect(new Column({ children: [] }).measure(10)).toBe(1);
  });
});

describe('Row（水平分列分配）', () => {
  it('等权分宽：10 宽两子各 5', () => {
    const a = probe(1);
    const b = probe(1);
    const row = new Row({ children: [a, b] });
    const grid = new CellGrid(10, 2);
    row.render(grid, { row: 0, col: 0, width: 10, height: 2 });
    expect(a.regions).toEqual([{ row: 0, col: 0, width: 5, height: 2 }]);
    expect(b.regions).toEqual([{ row: 0, col: 5, width: 5, height: 2 }]);
  });

  it('整除余数给末列：11 宽两子 → 5 + 6', () => {
    const a = probe(1);
    const b = probe(1);
    const grid = new CellGrid(11, 1);
    new Row({ children: [a, b] }).render(grid, { row: 0, col: 0, width: 11, height: 1 });
    expect(a.regions[0]?.width).toBe(5);
    expect(b.regions[0]?.width).toBe(6); // 末列收余数
  });

  it('权重分宽：2:1 于 9 宽 → 6 + 3', () => {
    const a = probe(1);
    const b = probe(1);
    const grid = new CellGrid(9, 1);
    new Row({ children: [a, b], weights: [2, 1] }).render(grid, { row: 0, col: 0, width: 9, height: 1 });
    expect(a.regions[0]?.width).toBe(6);
    expect(b.regions[0]?.width).toBe(3);
  });

  it('measure = 各子在分配宽下期望最大值（两段同一 allocate 单源）', () => {
    // 子 a 在窄列折 3 行、子 b 固定 1——Row 量高 = 3
    const a = new Paragraph({ content: 'abcdef' }); // 分到 2 列 → 3 行
    const b = probe(1);
    const row = new Row({ children: [a, b], weights: [2, 1] }); // 6 宽 → a 4 列 b 2 列
    expect(row.measure(6)).toBe(2); // a 在 4 列折 'abcd'/'ef' 2 行
  });

  it('零宽列不渲染（三列中列吃零）：col 推进不中断', () => {
    const a = probe(1);
    const b = probe(1);
    const c = probe(1);
    const grid = new CellGrid(2, 1);
    // 2 宽按 5:1:1 → a=floor(2*5/7)=1、b=floor(2/7)=0（零宽不渲染）、c 末列收余 1
    new Row({ children: [a, b, c], weights: [5, 1, 1] }).render(grid, { row: 0, col: 0, width: 2, height: 1 });
    expect(a.regions[0]?.width).toBe(1);
    expect(b.regions).toEqual([]); // 零宽列跳过渲染
    expect(c.regions[0]).toEqual({ row: 0, col: 1, width: 1, height: 1 }); // col 越过零宽列推进
  });
});

describe('Inset（四向收缩）', () => {
  it('measure 加边 / 落位收缩偏移', () => {
    const child = probe(2);
    const inset = new Inset({ child, top: 1, left: 2, right: 1, bottom: 1 });
    expect(inset.measure(10)).toBe(4); // 2 + 上 1 + 下 1
    const grid = new CellGrid(10, 6);
    inset.render(grid, { row: 0, col: 0, width: 10, height: 6 });
    expect(child.regions).toEqual([{ row: 1, col: 2, width: 7, height: 4 }]);
  });

  it('越界夹取：边距超区域——零交不渲染不炸', () => {
    const child = probe(1);
    const grid = new CellGrid(4, 4);
    new Inset({ child, top: 3, left: 3 }).render(grid, { row: 0, col: 0, width: 4, height: 4 });
    // 收缩后 {row:3,col:3,w:1,h:1} 与原区取交仍 1×1——渲染；
    // 再极端：全超
    const child2 = probe(1);
    new Inset({ child: child2, top: 5, left: 5 }).render(grid, { row: 0, col: 0, width: 4, height: 4 });
    expect(child2.regions).toEqual([]); // 零交——不渲染
  });
});

describe('端到端组合（Column + Row + Paragraph + Inset）', () => {
  it('组合树落位：顶行 Text 两列 + 底部 Paragraph 折行', () => {
    const grid = new CellGrid(20, 6);
    const col = new Column({
      children: [
        new Row({ children: [new Text({ content: 'L' }), probe(1)] }),
        new Inset({ child: new Paragraph({ content: '一二三四五六七八九十' }), left: 1 }),
      ],
    });
    col.render(grid, { row: 0, col: 0, width: 20, height: 6 });
    // Row 高 1（Text measure 1）；Inset 行 1..5、列 1..19——Paragraph 18 列折 2 行（20 双宽字素）
    const line1 = readRow(grid, 1, 20);
    expect(line1.startsWith(' ')).toBe(true); // left 1 边距
    expect(line1).toContain('一');
  });
});

/** 读回一行（组合端到端断言助手） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let c = 0; c < width; c++) {
    const cell = grid.getCell(row, c);
    out += cell ? cell.grapheme : ' ';
  }
  return out;
}
