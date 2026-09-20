/**
 * /themes 主题切换副屏件测试（07 §4.1 R2 挂账解挂批 + 命令面增补批）：条目
 * 呈现（当前档 ● 标记 / 坏文件 ⚠ 标注）、键面（移动/翻页/home/end/enter 选定
 * 先收副屏再回调——SessionPicker 同序律）、退出族（q 双轨/esc/Ctrl+C 打断/
 * Ctrl+D 先收屏再退柄）、闭锁单次、空条目诚实形。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent } from '../../engine/index.js';
import { CellGrid, stringWidth } from '../../engine/index.js';
import { ThemePicker } from './theme-picker.js';
import type { ThemePickEntry, ThemePickerOptions } from './theme-picker.js';

/** key 事件夹具 */
const k = (key: string, mods: Partial<KeyEvent> = {}): KeyEvent => ({
  kind: 'key',
  key,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  phase: 'press',
  ...mods,
});

/** 条目夹具：内置三档 + 自定义两枚（其一坏文件） */
const ENTRIES: readonly ThemePickEntry[] = [
  { name: 'auto', detail: '跟随终端明暗（OSC 11 探测）', broken: false },
  { name: 'dark', detail: '内置暗色', broken: false },
  { name: 'light', detail: '内置亮色', broken: false },
  { name: 'my-theme', detail: '自定义（themes/<名>.json 键级覆盖）', broken: false },
  { name: 'broken-one', detail: '自定义（themes/<名>.json 键级覆盖）', broken: true },
];

/** 读回一行（trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
  return out.trimEnd();
}

function makePicker(overrides: Partial<ThemePickerOptions> = {}) {
  const onSelect = vi.fn();
  const onExit = vi.fn();
  const picker = new ThemePicker({
    entries: ENTRIES,
    current: 'dark',
    onSelect,
    onExit,
    sessionId: 'sess-abcdef1234567890',
    ...overrides,
  });
  return { picker, onSelect, onExit };
}

describe('ThemePicker 呈现', () => {
  it('头行计数 + 条目行（当前档 ● 标记 / 坏文件 ⚠ 标注）+ 底行提示', () => {
    const { picker } = makePicker();
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 0, width)).toBe('◆ 主题切换 · 5 档');
    expect(readRow(grid, 1, width)).toContain('auto');
    // dark = 当前档——● 标记位（非光标行前缀两空格 + ● 段）
    const darkRow = readRow(grid, 2, width);
    expect(darkRow.startsWith('  ●')).toBe(true);
    expect(darkRow).toContain('dark');
    // 坏文件条目——⚠ 标注
    expect(readRow(grid, 5, width)).toContain('⚠');
    expect(readRow(grid, grid.rows - 1, width)).toContain('enter 选定');
  });

  it('非当前档行首无 ●（光标 ▸ 与当前标记分立）', () => {
    const { picker } = makePicker({ current: 'auto' });
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 2, width).startsWith('  ●')).toBe(false); // dark 非当前（当前 auto 在行 1）
    expect(readRow(grid, 1, width)).toContain('▸'); // 光标在首行（auto）
    expect(readRow(grid, 1, width)).toContain('●'); // auto 兼当前档——两标记同行
  });

  it('空条目 = 诚实空态行', () => {
    const { picker } = makePicker({ entries: [] });
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 0, width)).toBe('◆ 主题切换 · 无条目');
    expect(readRow(grid, 1, width)).toContain('无主题条目');
  });

  it('窄窗右段预算律：右段先按预算 … 截断再右对齐——负起列劈毁档名坏形封堵（修前红）', () => {
    const { picker } = makePicker();
    // 窗 20 < auto 行右段宽 27——修前 rightCol = 20-27 = -7：CellGrid 吸收负列
    // 首段后余段从行首覆写，光标标记与档名 'auto' 全毁（finding 实证坏形）
    const width = 20;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    const line = readRow(grid, 1, width); // auto 行（光标行 + 最宽 detail）
    expect(line.startsWith('▸')).toBe(true); // 行首光标标记不被右段尾覆写
    expect(line).toContain('auto'); // 档名存活（左段保留位 ≥ 半窗下限）
    expect(line).toContain('…'); // 右段按预算 … 收口（不再原宽右对齐）
    expect(stringWidth(line)).toBeLessThanOrEqual(width); // 行宽不越窗
  });
});

describe('ThemePicker 键面', () => {
  it('光标移动：down/up + home/end 夹取（▸ 位随行——渲染面断言）', () => {
    const { picker } = makePicker();
    const width = 72;
    const paint = (): CellGrid => {
      const grid = new CellGrid(width, picker.measure(width));
      picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
      return grid;
    };
    expect(readRow(paint(), 1, width).startsWith('▸')).toBe(true); // 首位 auto
    picker.handleEvent(k('down'));
    expect(readRow(paint(), 2, width).startsWith('▸')).toBe(true); // → dark
    picker.handleEvent(k('end'));
    expect(readRow(paint(), 5, width).startsWith('▸')).toBe(true); // → 尾条目
    picker.handleEvent(k('down')); // 尾夹取——位不动
    expect(readRow(paint(), 5, width).startsWith('▸')).toBe(true);
    picker.handleEvent(k('home'));
    expect(readRow(paint(), 1, width).startsWith('▸')).toBe(true); // 回首
    picker.handleEvent(k('up')); // 首夹取——位不动
    expect(readRow(paint(), 1, width).startsWith('▸')).toBe(true);
  });

  it('enter 选定：先收副屏（onExit）再回调（onSelect 名）——同序律；onExit 闭锁单次', () => {
    const calls: string[] = [];
    let exits = 0;
    const { picker } = makePicker({
      onSelect: (name) => calls.push(`select:${name}`),
      onExit: () => {
        exits += 1;
        calls.push('exit');
      },
    });
    picker.handleEvent(k('down')); // → dark（当前档再选 = 重落同档幂等）
    picker.handleEvent(k('enter'));
    expect(calls).toEqual(['exit', 'select:dark']);
    // onExit 闭锁（exit 收口单次）；onSelect 不经闭锁——SessionPicker 件族同律
    picker.handleEvent(k('q'));
    expect(exits).toBe(1);
    expect(calls).toEqual(['exit', 'select:dark']);
  });

  it('光标驱动滚动：光标滚出视口提窗（首行随窗换——渲染面断言）', () => {
    const { picker } = makePicker();
    const width = 72;
    const grid = new CellGrid(width, 4); // 头 + 2 行视口 + 提示（矮窗）
    picker.render(grid, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid, 1, width)).toContain('auto'); // 首窗锚顶
    picker.handleEvent(k('end')); // 光标到尾——提窗
    const grid2 = new CellGrid(width, 4);
    picker.render(grid2, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid2, 1, width)).not.toContain('auto'); // 首行换（窗已提）
    expect(readRow(grid2, 2, width)).toContain('broken-one'); // 尾条目在窗内
    picker.handleEvent(k('home')); // 光标回首——压窗
    const grid3 = new CellGrid(width, 4);
    picker.render(grid3, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid3, 1, width)).toContain('auto'); // 回锚顶
  });

  it('首渲染前击键的过深视口在 render 回写真实窗高后回拉（maxOffset 上界）', () => {
    // 修前红实证位：面板打开后、首渲染前发 end——此时 viewportHeight 还是
    // 构造初值 1，offset 被夹到 cursor 4；首渲染回写真实窗高 2 后应回拉到
    // 「尾行恰贴窗底」位（maxOffset = 5-2 = 3）。修前无上界分支：cursor=4
    // 仍在 [4, 4+2) 窗内，offset=4 原样保持——首行 broken-one、第二行空窗。
    const { picker } = makePicker();
    const width = 72;
    picker.handleEvent(k('end')); // 首渲染前击键（陈窗高夹深位）
    const grid = new CellGrid(width, 4); // 头 + 2 行视口 + 提示
    picker.render(grid, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid, 1, width)).toContain('my-theme'); // 回拉后首行（offset=3）
    expect(readRow(grid, 2, width)).toContain('broken-one'); // 尾条目恰贴窗底
  });

  it('q 退出（key 轨 + text 轨两形）——闭锁单次', () => {
    const { picker, onExit } = makePicker();
    expect(picker.handleEvent(k('q'))).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
    picker.handleEvent({ kind: 'text', text: 'q' } as InputEvent);
    expect(onExit).toHaveBeenCalledTimes(1); // 闭锁
  });

  it('Esc 同 q 退出', () => {
    const { picker, onExit } = makePicker();
    picker.handleEvent(k('escape'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C = 打断在飞（收会话 id）不退屏', () => {
    const onInterrupt = vi.fn();
    const { picker, onExit } = makePicker({ onInterrupt });
    picker.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-abcdef1234567890');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Ctrl+D = 先收副屏再转退出柄（两柄都到、序 = exit 先）', () => {
    const calls: string[] = [];
    const { picker } = makePicker({
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    picker.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });

  it('未消费键终局吞（模态独占）', () => {
    const { picker } = makePicker();
    expect(picker.handleEvent(k('x'))).toBe(true);
  });

  it('空条目形：移动/enter 不动作（无条目可循），q 退出照常', () => {
    const { picker, onSelect, onExit } = makePicker({ entries: [] });
    expect(picker.handleEvent(k('down'))).toBe(true);
    expect(picker.handleEvent(k('enter'))).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
    picker.handleEvent(k('q'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
