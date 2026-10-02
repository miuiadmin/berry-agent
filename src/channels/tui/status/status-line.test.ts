/**
 * 状态行件单测（V-3 注⑦② footer 左右分栏重做 + 注⑧③ 忙态族退役）：
 * 存留面 = 闲态文案（setStatus last-writer-wins——尾注让位族优先占右槽）/
 * FooterSegments 分栏（坍缩梯五档 / secondary 弱化 / hint dim / 截断帽 /
 * null 可逆切换）/ setTheme 派生重建 / onChange 通知面。
 */
import { describe, expect, it, vi } from 'vitest';
import { CellGrid } from '../../engine/index.js';
import { builtinPalette, DEFAULT_THEME, resolveTheme } from '../theme/index.js';
import { StatusLine, type FooterSegments } from './status-line.js';

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

/** 段集工厂（缺省全形——各测试按需覆写触发坍缩梯各档） */
function seg(over: Partial<FooterSegments> = {}): FooterSegments {
  return {
    tiers: '无沙箱 · 思考高', // 15 列（6 + 3 + 6）
    tiersSafety: '无沙箱', // 6 列
    danger: true,
    hint: '? 快捷键', // 8 列（1 + 1 + 6）
    right: '今日 $0.12', // 10 列（4 + 1 + 5）
    ...over,
  };
}

describe('StatusLine', () => {
  it('量高恒 1（状态行单行制——坍缩梯全空档行也保留防行跳动）', () => {
    expect(new StatusLine().measure(80)).toBe(1);
    const line = new StatusLine();
    line.setFooter(seg({ tiers: '', tiersSafety: '', hint: '', right: '' }));
    expect(line.measure(8)).toBe(1);
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

  it('onChange 通知：换文案/换 footer 段集均触发（通知面收敛两入口）', () => {
    const line = new StatusLine();
    const spy = vi.fn();
    line.onChange = spy;
    line.setStatus('文案');
    expect(spy).toHaveBeenCalledTimes(1);
    line.setFooter(seg());
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe('StatusLine footer 左右分栏（V-3 注⑦②）', () => {
  it('缺省 footer 缺席 = 旧形（idleText 居左满行——分栏路零进入）', () => {
    const line = new StatusLine();
    line.setStatus('思考中');
    expect(readRow(renderLine(line), 0, 30)).toBe('思考中'); // 居左旧形（分栏形会右对齐——此断言区分两路）
  });

  it('setFooter(null) 清除回旧形（可逆切换）', () => {
    const line = new StatusLine();
    line.setFooter(seg());
    line.setFooter(null);
    line.setStatus('思考中');
    expect(readRow(renderLine(line), 0, 30)).toBe('思考中'); // 旧形居左
  });

  it('rung0 全形：左段档位+教学提示 · 右段今日右对齐（1 列右缘垫）', () => {
    const line = new StatusLine();
    line.setFooter(seg()); // 全左 26 列 + 1 间隙 + 右 10 + 1 右缘垫 = 38 ≤ 40
    const grid = renderLine(line, 40);
    // 左段 col 0-25，右段 col 29-38（w-1-rW=29 起），col 39 右缘垫
    expect(readRow(grid, 0, 40)).toBe('无沙箱 · 思考高 · ? 快捷键   今日 $0.12');
  });

  it('rung0 样式面：档位段 secondary + 教学提示 dim + 今日段 secondary', () => {
    const line = new StatusLine();
    line.setFooter(seg());
    const grid = renderLine(line, 40);
    expect(grid.getCell(0, 0)?.style.fg).toBe(DEFAULT_THEME.secondary); // 档位段
    expect(grid.getCell(0, 18)?.style.dim).toBe(true); // '? 快捷键' 起点 col 18（15+3 段间）
    expect(grid.getCell(0, 29)?.style.fg).toBe(DEFAULT_THEME.secondary); // 今日段
  });

  it('尾注让位族：setStatus 尾注优先占右槽（正文前景——今日段退场）', () => {
    const line = new StatusLine();
    line.setFooter(seg());
    line.setStatus('✓ 完成'); // 6 列——右槽让位
    const grid = renderLine(line, 40);
    // 右槽 col 33-38（w-1-6=33 起）——左段尾 col 25 与右槽首 col 33 间 7 列空
    expect(readRow(grid, 0, 40)).toBe('无沙箱 · 思考高 · ? 快捷键       ✓ 完成');
    expect(grid.getCell(0, 33)?.style.fg).toBeUndefined(); // 尾注正文前景（非 secondary）
    expect(readRow(grid, 0, 40)).not.toContain('今日');
  });

  it('setTheme 派生重建：footerStyle 随主题档换装', () => {
    const line = new StatusLine();
    line.setFooter(seg());
    // truecolor 档取板原值（16 档两板 secondary 同降采 ANSI 8——重建断言取真异值档）
    const light = resolveTheme(builtinPalette('light'), 'truecolor');
    line.setTheme(light);
    const grid = renderLine(line, 40);
    expect(grid.getCell(0, 0)?.style.fg).toBe(light.secondary); // footer 随档重建
    expect(light.secondary).not.toBe(DEFAULT_THEME.secondary); // 两板真异值（重建断言有意义）
  });
});

describe('StatusLine footer 坍缩梯（V-3 注⑦③——自宽而窄段级丢弃）', () => {
  // 段宽常量：tiers 15 / safety 6 / hint 8 / 右 10（全左 15+3+8=26）
  it('rung1 教学提示先丢：全左不进但档位+右段进', () => {
    const line = new StatusLine();
    line.setFooter(seg());
    // w=27：全左 26 + 右 10 + 双垫 2 = 38 > 27 不进；tiers 15 + 1 + 10 + 1 = 27 ≤ 27 进
    expect(readRow(renderLine(line, 27), 0, 27)).toBe('无沙箱 · 思考高 今日 $0.12');
  });

  it('rung2 档位注缩词（仅沙箱安全词）', () => {
    const line = new StatusLine();
    line.setFooter(seg());
    // w=18：tiers 15 + 10 + 双垫不进；safety 6 + 1 + 10 + 1 = 18 ≤ 18 进
    expect(readRow(renderLine(line, 18), 0, 18)).toBe('无沙箱 今日 $0.12');
  });

  it('rung3 右段今日藏（尾注不藏——帽截断保底）', () => {
    const line = new StatusLine();
    line.setFooter(seg());
    // w=10：safety 6 + 右 10 + 垫不进；safety 单独 6 ≤ 10 → rung3（今日藏）
    const grid = renderLine(line, 10);
    expect(readRow(grid, 0, 10)).toBe('无沙箱');
    // 尾注在场时 rung3 让位门控跳过 → rung4 danger：双垫不容（6+1+6+1=14>10）
    // → 尾注独占右槽（danger 词几何不容时让位——尾注永不丢且不被覆写 garble）
    const tail = new StatusLine();
    tail.setFooter(seg());
    tail.setStatus('✓ 完成'); // 6 列
    expect(readRow(renderLine(tail, 10), 0, 10)).toBe('   ✓ 完成');
  });

  it('rung4 仅档位 danger 位（安全信息最后保真——非 danger 全空）', () => {
    const danger = new StatusLine();
    danger.setFooter(seg()); // w=5：safety 6 > 5 → ellipsize 整字截断
    expect(readRow(renderLine(danger, 5), 0, 5)).toBe('无沙…');
    const safe = new StatusLine();
    safe.setFooter(seg({ danger: false }));
    expect(readRow(renderLine(safe, 5), 0, 5)).toBe(''); // 非 danger rung4 不保——全空（行保留恒 1）
  });
});

describe('StatusLine 右段帽（B-render 批帽律承袭）', () => {
  it('超宽右段截断：首字素不丢且左段截断形在场', () => {
    const line = new StatusLine();
    line.setFooter(seg({ tiers: 'berry', tiersSafety: 'berry', hint: '', right: 'S'.repeat(15) }));
    // w=10：帽 w-2=8 → 右段 7S+'…'（col 2-9？——右对齐 w-1-8=1 起，col 1-8，col 9 垫）
    // 左段 berry 5 列 col 0-4 与右段 col 1-8 交叠——rung 判定：5+1+8+1=15 > 10
    // → rung2 berry 5+1+8+1 同不进 → rung3（今日藏）：berry 单独在场
    expect(readRow(renderLine(line, 10), 0, 10)).toBe('berry');
  });

  it('左段单独超宽：ellipsize 整字截断（CJK 双宽不产半字）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ tiers: '很长的档位词组测试', tiersSafety: '很长的档位词组测试', hint: '', right: '' }));
    // w=6：CJK 9 字 18 列 > 6 → 截 2 字 + …（4+… 恰 5? —— ellipsize 帽 6：4 字宽内整字前缀）
    const out = readRow(renderLine(line, 6), 0, 6);
    expect(out.startsWith('很长')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('尾注超宽：右槽帽截断保底（尾注永不丢——至少截断形在场）', () => {
    const line = new StatusLine();
    line.setFooter(seg({ tiers: '', tiersSafety: '', hint: '', right: '' }));
    line.setStatus('S'.repeat(15));
    // w=10：帽 8 → 7S+…，右对齐 col 1-8
    expect(readRow(renderLine(line, 10), 0, 10)).toBe(' SSSSSSS…');
  });
});
