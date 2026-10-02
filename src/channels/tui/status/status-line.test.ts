/**
 * 状态行件单测（V-3 注⑧③ 忙态族整役退役——转轮/工具名/速度段/启停 API
 * 随批净除，忙态呈现归件 12 任务状态行）：存留面 = 闲态文案（setStatus
 * last-writer-wins）/ footer 常驻段分栏（secondary 弱化 / 截断帽 /
 * 可逆切换）/ setTheme 派生重建 / onChange 通知面。
 */
import { describe, expect, it, vi } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { builtinPalette, DEFAULT_THEME, resolveTheme } from '../theme/index.js';
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

  it('setStatus 闲态文案显（last-writer-wins）', () => {
    const line = new StatusLine();
    line.setStatus('✓ 用量 12,345');
    expect(readRow(renderLine(line), 0, 30)).toBe('✓ 用量 12,345');
    line.setStatus('自定义状态'); // 后写覆盖
    expect(readRow(renderLine(line), 0, 30)).toBe('自定义状态');
  });

  it('onChange 通知：换文案/换 footer 均触发（V-3 注⑧③——忙态推帧族退役后通知面收敛两入口）', () => {
    const line = new StatusLine();
    const spy = vi.fn();
    line.onChange = spy;
    line.setStatus('文案');
    expect(spy).toHaveBeenCalledTimes(1);
    line.setFooter('berry');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('StatusLine footer 分栏（R6 批 10k）', () => {
  it('缺省 footerText = 旧形（idleText 居左满行——分栏路零进入）', () => {
    const line = new StatusLine();
    line.setStatus('思考中');
    expect(readRow(renderLine(line), 0, 30)).toBe('思考中'); // 居左旧形（分栏形会右对齐——此断言区分两路）
  });

  it('footer 在场闲态独占（无右段文案——左段满行）', () => {
    const line = new StatusLine();
    line.setFooter('berry · glm · a1b2c3');
    expect(readRow(renderLine(line), 0, 30)).toBe('berry · glm · a1b2c3');
  });

  it('footer 左段 + 闲态文案右对齐（间隔 ≥1 列）', () => {
    const line = new StatusLine();
    line.setFooter('berry · glm · a1b2c3');
    line.setStatus('✓ 完成');
    // footer 20 列（0-19），空 20-23，右段 6 列（24-29）
    expect(readRow(renderLine(line), 0, 30)).toBe('berry · glm · a1b2c3    ✓ 完成');
  });

  it('footer 超宽整字截断加省略号（CJK 双宽不产半字）', () => {
    const line = new StatusLine();
    // footer 29 列 > 帽 25（30 - 右段「状态」4 - 间隔 1）→ 截 24 列 + 省略号
    line.setFooter('很长的目录名 · 模型 · a1b2c3d');
    line.setStatus('状态');
    expect(readRow(renderLine(line), 0, 30)).toBe('很长的目录名 · 模型 · a1… 状态');
  });

  it('setFooter 空串清除回旧形（可逆切换）', () => {
    const line = new StatusLine();
    line.setFooter('berry · glm · a1b2c3');
    line.setFooter('');
    line.setStatus('思考中');
    expect(readRow(renderLine(line), 0, 30)).toBe('思考中'); // 旧形居左
  });

  it('setFooter 触发 onChange（重绘请求面同族）', () => {
    const line = new StatusLine();
    const spy = vi.fn();
    line.onChange = spy;
    line.setFooter('berry');
    expect(spy).toHaveBeenCalledTimes(1);
    line.setFooter('');
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('StatusLine footer 常驻段 secondary 弱化（界面美化役）', () => {
  it('闲态分栏：footer 段 secondary 次文键 + 闲态文案保持正文前景（层级 = 状态信息 > footer 段）', () => {
    const line = new StatusLine();
    line.setFooter('berry · glm · a1b2c3');
    line.setStatus('✓ 完成');
    const grid = renderLine(line);
    // footer 段（col 0 起 20 列）走 secondary；右段「✓ 完成」col 24-29 保持缺省前景
    expect(grid.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.secondary);
    expect(grid.getCell(0, 24)?.style.fg).toBeUndefined();
  });

  it('闲态无右段（footer 独占）：整段 secondary', () => {
    const line = new StatusLine();
    line.setFooter('berry · glm · a1b2c3');
    const grid = renderLine(line);
    expect(grid.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.secondary);
    expect(grid.getCell(0, 10)?.style.fg).toBe(DEFAULT_THEME.secondary);
  });

  it('setTheme 派生重建：footerStyle 随主题档换装', () => {
    const line = new StatusLine();
    line.setFooter('berry');
    // truecolor 档取板原值（16 档两板 secondary 同降采 ANSI 8——重建断言取真异值档）
    const light = resolveTheme(builtinPalette('light'), 'truecolor');
    line.setTheme(light);
    const grid = renderLine(line);
    expect(grid.getCell(0, 0)?.style.fg).toBe(light.secondary); // footer 随档重建
    expect(light.secondary).not.toBe(DEFAULT_THEME.secondary); // 两板真异值（重建断言有意义）
  });
});

describe('StatusLine 闲态右段剩余宽帽（B-render 批）', () => {
  it('超宽 idleText 截断：无负列写（首字素不丢）且 footer 截断形在场（修前头部被网格吞 + footer 整段消失）', () => {
    const line = new StatusLine();
    line.setFooter('berry');
    line.setStatus('S'.repeat(15)); // 宽 15 > region 宽 10——修前右对齐起点 = 10 - 15 = -5
    // 帽 = width - 2（间隔 1 列 + footer 至少留 1 列截断形）：右段截到 8 列
    // （cols 2-9，7 S + '…'——界面美化役 ellipsize 翻档）、间隔 col 1、
    // footer 截断形 '…' 落 col 0
    expect(readRow(renderLine(line, 10), 0, 10)).toBe('… SSSSSSS…');
  });

  it('idleText 未超帽——既有分栏几何原样（帽是快路不扰）', () => {
    const line = new StatusLine();
    line.setFooter('berry · glm · a1b2c3');
    line.setStatus('✓ 完成');
    expect(readRow(renderLine(line, 30), 0, 30)).toBe('berry · glm · a1b2c3    ✓ 完成');
  });
});
