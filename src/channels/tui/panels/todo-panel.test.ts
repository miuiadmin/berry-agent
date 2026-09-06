/**
 * todo 面板单测（07 §4.1 呈现面件 4）：四态记号 / activeForm 优先 /
 * 帽 6 条 + 溢出行 / 空表与 null 同为清板 / 内容截断（码点安全）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import type { TodoItem } from '../../types.js';
import { TodoPanel } from './todo-panel.js';

const WIDTH = 40;

/** 读回一行（未写格按空格、trimEnd） */
function readRow(grid: CellGrid, row: number, width = WIDTH): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 渲染到面板量高网格 */
function renderPanel(panel: TodoPanel, width = WIDTH): CellGrid {
  const grid = new CellGrid(width, panel.measure(width));
  panel.render(grid, { row: 0, col: 0, width, height: grid.rows });
  return grid;
}

const item = (status: TodoItem['status'], content: string, activeForm?: string): TodoItem =>
  activeForm === undefined ? { status, content } : { status, content, activeForm };

describe('TodoPanel 清板语义', () => {
  it('初始零行；null / undefined / 空表同为清板（量高归 0）', () => {
    const panel = new TodoPanel();
    expect(panel.measure(WIDTH)).toBe(0);
    panel.update([item('pending', '任务')]);
    expect(panel.measure(WIDTH)).toBe(1);
    panel.update(null);
    expect(panel.measure(WIDTH)).toBe(0);
    panel.update([item('pending', '又来了')]);
    panel.update(undefined);
    expect(panel.measure(WIDTH)).toBe(0);
    panel.update([item('pending', '再来了')]);
    panel.update([]);
    expect(panel.measure(WIDTH)).toBe(0);
  });
});

describe('TodoPanel 条目呈现', () => {
  it('四态记号：☐ 待办 / ◐ 进行中 / ☑ 已完成 / ⊙ 缓办', () => {
    const panel = new TodoPanel();
    panel.update([
      item('pending', '写规范'),
      item('in-progress', '码实现'),
      item('completed', '过冷读'),
      item('deferred', '挂账项'),
    ]);
    const grid = renderPanel(panel);
    expect(readRow(grid, 0)).toBe('☐ 写规范');
    expect(readRow(grid, 1)).toBe('◐ 码实现');
    expect(readRow(grid, 2)).toBe('☑ 过冷读');
    expect(readRow(grid, 3)).toBe('⊙ 挂账项');
  });

  it('进行中 activeForm 优先于 content（CC 式文案）', () => {
    const panel = new TodoPanel();
    panel.update([item('in-progress', '落码交互', '正在落码交互纵切')]);
    expect(readRow(renderPanel(panel), 0)).toBe('◐ 正在落码交互纵切');
  });

  it('已完成与缓办暗淡（dim 样式位——待办/进行中不带）', () => {
    const panel = new TodoPanel();
    panel.update([item('pending', '亮'), item('completed', '暗'), item('deferred', '也暗')]);
    const grid = renderPanel(panel);
    expect(grid.getCell(0, 0)?.style?.dim).toBeFalsy();
    expect(grid.getCell(1, 0)?.style?.dim).toBe(true);
    expect(grid.getCell(2, 0)?.style?.dim).toBe(true);
  });

  it('长内容截断（码点安全——不越网格宽、宽字不产半字）', () => {
    const panel = new TodoPanel();
    panel.update([item('pending', '一'.repeat(60))]);
    const grid = renderPanel(panel, WIDTH);
    // 宽 40 - 记号 2 = 38 列 → 19 个汉字整字截断（第 20 个不产半字）
    expect(readRow(grid, 0, WIDTH)).toBe('☐ ' + '一'.repeat(19));
  });
});

describe('TodoPanel 帽与溢出', () => {
  it('帽 6 条 + 溢出行「+ N 更多」', () => {
    const panel = new TodoPanel();
    panel.update(Array.from({ length: 7 }, (_, i) => item('pending', `条 ${i}`)));
    expect(panel.measure(WIDTH)).toBe(7); // 6 条 + 溢出行
    const grid = renderPanel(panel);
    expect(readRow(grid, 5)).toBe('☐ 条 5'); // 帽内末条在场
    expect(readRow(grid, 6)).toBe('+ 1 更多');
  });
});
