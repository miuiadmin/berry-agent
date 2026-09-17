/**
 * /thinking 档位选择副屏件测试（2026-09-17 会话档位切换面批 F1——立项档
 * 测试计划 10 picker 归约）：行集七档 / 当前档 ● 高亮锚 / 选中回调 /
 * 「先收副屏再回调」序（SessionPicker 同序律）/ 退出族（q 双轨 / Esc /
 * Ctrl+C 打断 / Ctrl+D 先收屏再退柄）/ 闭锁单次。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import { ThinkingPicker } from './thinking-picker.js';
import type { ThinkingPickerOptions } from './thinking-picker.js';

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

/** 读回一行（trimEnd） */
function readRow(grid: CellGrid, row: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
  return out.trimEnd();
}

/** 测试用七档条目（与 tui-entry 装配位同构——词序单源 THINKING_LEVELS） */
const TEST_ENTRIES: readonly { level: string; detail: string }[] = [
  { level: 'off', detail: '关思考' },
  { level: 'minimal', detail: '极简' },
  { level: 'low', detail: '低' },
  { level: 'medium', detail: '中' },
  { level: 'high', detail: '高' },
  { level: 'xhigh', detail: '超高' },
  { level: 'max', detail: '最大' },
];

function makePicker(overrides: Partial<ThinkingPickerOptions> = {}) {
  const onSelect = vi.fn();
  const onExit = vi.fn();
  const onInterrupt = vi.fn();
  const onQuit = vi.fn();
  const picker = new ThinkingPicker({
    entries: TEST_ENTRIES,
    current: 'medium',
    onSelect,
    onExit,
    sessionId: 'sess-abcdef1234567890',
    onInterrupt,
    onQuit,
    ...overrides,
  });
  return { picker, onSelect, onExit, onInterrupt, onQuit };
}

describe('ThinkingPicker 呈现', () => {
  it('行集恰七档（off..max 序）+ 头行计数 + 底行提示（下一 run 起生效语义）', () => {
    const { picker } = makePicker();
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 0, width)).toBe('◆ 思考档位 · 7 档');
    const levels = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];
    levels.forEach((level, index) => {
      expect(readRow(grid, 1 + index, width)).toContain(level);
    });
    expect(readRow(grid, grid.rows - 1, width)).toContain('下一 run 起生效');
  });

  it('当前档 ● 高亮锚：current 行带 ●，非当前行无 ●；光标 ▸ 首行', () => {
    const { picker } = makePicker({ current: 'high' });
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    // 光标与当前档分立：光标 ▸ 在首行（off），● 在 high 行（行 5）
    expect(readRow(grid, 1, width).startsWith('▸')).toBe(true);
    const highRow = readRow(grid, 5, width);
    expect(highRow).toContain('●');
    expect(highRow.startsWith('▸')).toBe(false);
    expect(readRow(grid, 1, width)).not.toContain('●');
  });

  it('current 缺席（boot 缺省未设）= 诚实无 ● 锚', () => {
    const { picker } = makePicker({ current: undefined });
    const width = 72;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    for (let row = 1; row <= 7; row++) {
      expect(readRow(grid, row, width)).not.toContain('●');
    }
  });
});

describe('ThinkingPicker 键面', () => {
  it('enter 选定：先收副屏（onExit）再回调（onSelect）——序律', () => {
    const { picker, onSelect, onExit } = makePicker({ current: 'off' });
    picker.handleEvent(k('down')); // off → minimal
    const order: string[] = [];
    onSelect.mockImplementation(() => order.push('select'));
    onExit.mockImplementation(() => order.push('exit'));
    expect(picker.handleEvent(k('enter'))).toBe(true);
    expect(order).toEqual(['exit', 'select']); // 先收副屏再回调
    expect(onSelect).toHaveBeenCalledWith('minimal');
  });

  it('光标移动：down/up + home/end（渲染面 ▸ 位随行）', () => {
    const { picker } = makePicker();
    const width = 72;
    const paint = (): CellGrid => {
      const grid = new CellGrid(width, picker.measure(width));
      picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
      return grid;
    };
    picker.handleEvent(k('end'));
    expect(readRow(paint(), 7, width).startsWith('▸')).toBe(true); // max 行
    picker.handleEvent(k('home'));
    expect(readRow(paint(), 1, width).startsWith('▸')).toBe(true); // off 行
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down'));
    expect(readRow(paint(), 3, width).startsWith('▸')).toBe(true); // low 行
    picker.handleEvent(k('up'));
    expect(readRow(paint(), 2, width).startsWith('▸')).toBe(true); // minimal 行
  });

  it('q / Esc 收屏零选定回调（q 双轨——kitty text 事件同收）', () => {
    const a = makePicker();
    expect(a.picker.handleEvent(k('escape'))).toBe(true);
    expect(a.onExit).toHaveBeenCalledTimes(1);
    expect(a.onSelect).not.toHaveBeenCalled();
    const b = makePicker();
    expect(b.picker.handleEvent(k('q'))).toBe(true);
    const c = makePicker();
    expect(c.picker.handleEvent({ kind: 'text', text: 'q' } as InputEvent)).toBe(true);
    expect(c.onExit).toHaveBeenCalledTimes(1);
    expect(c.onSelect).not.toHaveBeenCalled();
  });

  it('Ctrl+C = 打断在飞 run（不退屏）；Ctrl+D = 先收屏再转退柄', () => {
    const { picker, onExit, onInterrupt, onQuit } = makePicker();
    picker.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-abcdef1234567890');
    expect(onExit).not.toHaveBeenCalled(); // 打断不退副屏（件族同律）
    picker.handleEvent(k('d', { ctrl: true }));
    expect(onExit).toHaveBeenCalledTimes(1); // 先收屏
    expect(onQuit).toHaveBeenCalledTimes(1); // 再转退柄
  });

  it('闭锁单次：选定后后续键零二次回调', () => {
    const { picker, onSelect, onExit } = makePicker();
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    picker.handleEvent(k('enter'));
    picker.handleEvent(k('escape'));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('未消费键终局吞（模态独占——false 不外溢编辑器）', () => {
    const { picker } = makePicker();
    expect(picker.handleEvent(k('z'))).toBe(true);
  });
});
