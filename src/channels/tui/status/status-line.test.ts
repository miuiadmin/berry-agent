/**
 * 状态行动画件单测：启停驱动（agent_start/end）/ 转轮帧推进（tick）/
 * 工具名实时段（tool_execution_start）/ setStatus last-writer-wins /
 * accent 着色断言 / onChange 通知面。
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

  it('start 进忙态：转轮 accent 着色 + 活动文案', () => {
    const line = new StatusLine();
    line.start('思考中');
    const grid = renderLine(line);
    expect(readRow(grid, 0, 30)).toBe('⠋ 思考中');
    // 转轮 = accent 定值（theme 单源）——着色纪律的两个 accent 载体之一
    expect(grid.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.accent);
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

describe('StatusLine footer 分栏（R6 批 10k）', () => {
  it('缺省 footerText = 旧形（前块既有测试全锚——分栏路零进入）', () => {
    // 旧形锚点抽查：忙态转轮居左（分栏形会右对齐——此断言区分两路）
    const line = new StatusLine();
    line.start('思考中');
    expect(readRow(renderLine(line), 0, 30)).toBe('⠋ 思考中');
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

  it('footer 左段 + 忙态右对齐（转轮 accent + 活动文案随转轮）', () => {
    const line = new StatusLine();
    line.setFooter('berry · glm · a1b2c3');
    line.start('思考中');
    const grid = renderLine(line);
    expect(readRow(grid, 0, 30)).toBe('berry · glm · a1b2c3  ⠋ 思考中');
    expect(grid.getCell(0, 22)?.style.fg).toBe(DEFAULT_THEME.accent); // 转轮仍 accent
  });

  it('footer 左段 + 忙态工具段优先（ ⚙ name … 随转轮右对齐）', () => {
    const line = new StatusLine();
    line.setFooter('berry');
    line.start('思考中');
    line.setTool('read_file');
    // rest 14 列 → 转轮 col 15；footer 5 列 + 10 空格间隔
    expect(readRow(renderLine(line), 0, 30)).toBe('berry          ⠋ ⚙ read_file …');
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
    line.start('思考中');
    expect(readRow(renderLine(line), 0, 30)).toBe('⠋ 思考中'); // 旧形转轮居左
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

  it('忙态分栏：footer 段 secondary + 转轮 accent + 忙态文案保持正文前景（三档同屏分立）', () => {
    const line = new StatusLine();
    line.setFooter('berry · glm · a1b2c3');
    line.start('思考中');
    const grid = renderLine(line);
    expect(grid.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.secondary); // footer 弱化
    expect(grid.getCell(0, 22)?.style.fg).toBe(DEFAULT_THEME.accent); // 转轮 accent 维持
    expect(grid.getCell(0, 24)?.style.fg).toBeUndefined(); // 忙态文案全亮
  });

  it('闲态无右段（footer 独占）：整段 secondary', () => {
    const line = new StatusLine();
    line.setFooter('berry · glm · a1b2c3');
    const grid = renderLine(line);
    expect(grid.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.secondary);
    expect(grid.getCell(0, 10)?.style.fg).toBe(DEFAULT_THEME.secondary);
  });

  it('setTheme 派生重建：footerStyle 随主题档换装（与 spinnerStyle 同律）', () => {
    const line = new StatusLine();
    line.setFooter('berry');
    line.start('思考中');
    // truecolor 档取板原值（16 档两板 secondary 同降采 ANSI 8——重建断言取真异值档）
    const light = resolveTheme(builtinPalette('light'), 'truecolor');
    line.setTheme(light);
    const grid = renderLine(line);
    expect(grid.getCell(0, 0)?.style.fg).toBe(light.secondary); // footer 随档重建
    expect(grid.getCell(0, 22)?.style.fg).toBe(light.accent); // 转轮随档重建（rest 7 列 → col 22）
    expect(light.secondary).not.toBe(DEFAULT_THEME.secondary); // 两板真异值（重建断言有意义）
  });
});

describe('StatusLine 忙态工具段剩余宽帽（2026-09-20 TUI 修复组 1 批 F4）', () => {
  it('超长工具名整字截断——转轮恒在屏内（修前 restWidth 无界 spinnerCol 负、转轮整段消失）', () => {
    const line = new StatusLine();
    line.setFooter('cwd·model·s');
    line.start();
    line.setTool('n'.repeat(20));
    // 帽 = region.width - 1 = 11 列：rest ' ⚙ ' 3 列 + 7 个 n + '…' 恰满
    // （界面美化役 ellipsize 翻档——截断尾缀恒 …，修前硬切 8 个 n 无记号）；
    // 转轮落 col 0
    expect(readRow(renderLine(line, 12), 0, 12)).toBe('⠋ ⚙ nnnnnnn…');
  });

  it('忙态截断记号与进度记号撞形语义同向（界面美化役——切掉自带 … 进度记号后残句不伪装完整句）', () => {
    const line = new StatusLine();
    line.setFooter('berry');
    line.start();
    line.setTool('npm_run_tests');
    // raw = ' ⚙ npm_run_tests …' 宽 18 > 帽 17：修前硬切产 ' ⚙ npm_run_tests '
    // （尾缀 … 恰被切掉——工具名看似完整实为残句，「还在跑」不可辨）；
    // ellipsize 后尾缀恒 …（与进度记号形撞时语义同向——都是「未完」）
    expect(readRow(renderLine(line, 18), 0, 18)).toBe('⠋ ⚙ npm_run_tests…');
  });

  it('工具段未超帽——右对齐原样（帽是快路不扰既有几何）', () => {
    const line = new StatusLine();
    line.setFooter('berry');
    line.start();
    line.setTool('read_file');
    expect(readRow(renderLine(line, 30), 0, 30)).toBe('berry          ⠋ ⚙ read_file …');
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
