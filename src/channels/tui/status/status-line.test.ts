/**
 * 状态行动画件单测：启停驱动（agent_start/end）/ 转轮帧推进（tick）/
 * 工具名实时段（tool_execution_start）/ setStatus last-writer-wins /
 * accent 着色断言 / onChange 通知面。
 */
import { describe, expect, it, vi } from 'vitest';
import { ansiColor, CellGrid } from '../../engine/index.js';
import { ACCENT_INDEX } from '../theme.js';
import { StatusLine } from './status-line.js';

/** 读回一行（未写格按空格、trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) {
    const cell = grid.getCell(row, col);
    out += cell ? cell.grapheme : ' ';
  }
  return out.trimEnd();
}

/** 渲染到单行网格 */
function renderLine(line: StatusLine, width = 30): CellGrid {
  const grid = new CellGrid(width, 1);
  line.render(grid, { row: 0, col: 0, width, height: 1 });
  return grid;
}

describe('StatusLine', () => {
  it('量高恒 1（状态行单行制）', () => {
    expect(new StatusLine().measure(80)).toBe(1);
  });

  it('初始闲态空行（零写出）', () => {
    const grid = renderLine(new StatusLine());
    expect(readRow(grid, 0, 30)).toBe('');
  });

  it('start 进忙态：转轮 accent 着色 + 活动文案', () => {
    const line = new StatusLine();
    line.start('思考中');
    const grid = renderLine(line);
    expect(readRow(grid, 0, 30)).toBe('⠋ 思考中');
    // 转轮 = accent 定值（theme 单源）——着色纪律的两个 accent 载体之一
    expect(grid.getCell(0, 0)?.style.fg).toBe(ansiColor(ACCENT_INDEX));
    expect(grid.getCell(0, 2)?.style.fg).toBeUndefined(); // 文案段不着色
  });

  it('tick 帧推进（braille 十帧循环）', () => {
    const line = new StatusLine();
    line.start();
    expect(line.frame).toBe('⠋');
    line.tick();
    expect(line.frame).toBe('⠙');
    line.tick();
    expect(line.frame).toBe('⠹');
    for (let i = 0; i < 8; i++) line.tick(); // 共 10 tick 回到首帧
    expect(line.frame).toBe('⠋');
  });

  it('setTool 工具名段（ ⚙ <工具名> … ）且优先于活动文案', () => {
    const line = new StatusLine();
    line.start('思考中');
    line.setTool('read_file');
    const grid = renderLine(line);
    expect(readRow(grid, 0, 30)).toBe('⠋ ⚙ read_file …');
  });

  it('stop 回闲态：转轮清 + 工具名清', () => {
    const line = new StatusLine();
    line.start();
    line.setTool('read_file');
    line.stop();
    expect(line.isBusy).toBe(false);
    const grid = renderLine(line);
    expect(readRow(grid, 0, 30)).toBe('');
  });

  it('setStatus 闲态文案显（last-writer-wins）', () => {
    const line = new StatusLine();
    line.setStatus('✓ 用量 12,345');
    expect(readRow(renderLine(line), 0, 30)).toBe('✓ 用量 12,345');
    line.setStatus('自定义状态'); // 后写覆盖
    expect(readRow(renderLine(line), 0, 30)).toBe('自定义状态');
  });

  it('忙时 setStatus 挂起——转轮段让位规则不破、闲时呈现', () => {
    const line = new StatusLine();
    line.start('思考中');
    line.setStatus('✓ 用量 1'); // 忙时写入
    expect(readRow(renderLine(line), 0, 30)).toBe('⠋ 思考中'); // 忙态转轮优先
    line.stop();
    expect(readRow(renderLine(line), 0, 30)).toBe('✓ 用量 1'); // 闲时呈现挂起文案
  });

  it('onChange 通知：启停/换工具/换文案/忙态推帧均触发；闲态推帧零通知', () => {
    const line = new StatusLine();
    const spy = vi.fn();
    line.onChange = spy;
    line.tick(); // 闲态推帧——零变化零通知
    expect(spy).not.toHaveBeenCalled();
    line.start();
    expect(spy).toHaveBeenCalledTimes(1);
    line.setTool('grep');
    expect(spy).toHaveBeenCalledTimes(2);
    line.tick();
    expect(spy).toHaveBeenCalledTimes(3);
    line.setStatus('文案');
    expect(spy).toHaveBeenCalledTimes(4);
    line.stop();
    expect(spy).toHaveBeenCalledTimes(5);
  });
});
