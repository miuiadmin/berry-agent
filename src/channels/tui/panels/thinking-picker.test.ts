/**
 * /thinking 档位选择副屏件测试（2026-09-17 会话档位切换面批 F1——立项档
 * 测试计划 10 picker 归约）：行集七档 / 当前档 ● 高亮锚 / 选中回调 /
 * 「先收副屏再回调」序（SessionPicker 同序律）/ 退出族（q 双轨 / Esc /
 * Ctrl+C 打断 / Ctrl+D 先收屏再退柄）/ 闭锁单次；矮窗滚动·夹取族（七档
 * 视口 <7 时 end 提窗 / 首渲染前击键 maxOffset 回拉 / pageup·pagedown
 * 翻选——theme-picker 同形锁）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent, MouseEvent } from '../../engine/index.js';
import { CellGrid, stringWidth } from '../../engine/index.js';
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

/** mouse 滚轮事件夹具 */
const wheel = (dir: 'wheel-up' | 'wheel-down'): MouseEvent => ({
  kind: 'mouse',
  phase: 'press',
  button: dir,
  col: 0,
  row: 1,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
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

  it('窄窗右段预算律：说明右段先按预算 … 截断再右对齐——负起列劈毁档名坏形封堵（修前红）', () => {
    // 词表七档 detail 均窄（不触阈值）——注入长 detail 条目逼出坏形窗：
    // 窗 20 << detail 宽 50——修前 rightCol 深负起列：CellGrid 吸收负列首段后
    // 余段从行首覆写，档名 'medium' 全毁
    const longDetail = '中等推理深度——平衡时延与质量，具体生效随模型能力';
    const entries = TEST_ENTRIES.map((e) => (e.level === 'medium' ? { ...e, detail: longDetail } : e));
    const { picker } = makePicker({ entries });
    const width = 20;
    const grid = new CellGrid(width, picker.measure(width));
    picker.render(grid, { row: 0, col: 0, width, height: grid.rows });
    const line = readRow(grid, 4, width); // medium 行（光标在 off、● 在 medium）
    expect(line.startsWith('  ')).toBe(true); // 非光标行缩进在位（行首不被右段尾覆写）
    expect(line).toContain('medium'); // 档名存活（左段保留位 ≥ 半窗下限）
    expect(line).toContain('…'); // 右段按预算 … 收口
    expect(stringWidth(line)).toBeLessThanOrEqual(width); // 行宽不越窗
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

  it('光标驱动滚动：矮窗 end 提窗（首行换 + 尾两档入窗）→ home 回锚顶', () => {
    const { picker } = makePicker();
    const width = 72;
    const paint = (): CellGrid => {
      const grid = new CellGrid(width, 4); // 头 + 2 行视口 + 提示（矮窗）
      picker.render(grid, { row: 0, col: 0, width, height: 4 });
      return grid;
    };
    expect(readRow(paint(), 1, width)).toContain('off'); // 首窗锚顶
    picker.handleEvent(k('end')); // 光标到尾（max）——提窗
    const grid2 = paint();
    expect(readRow(grid2, 1, width)).not.toContain('off'); // 首行换（窗已提，非首条目）
    expect(readRow(grid2, 1, width)).toContain('xhigh'); // 窗含尾两档之首（倒数第二档）
    expect(readRow(grid2, 2, width)).toContain('max'); // 尾条目在窗内
    expect(readRow(grid2, 2, width).startsWith('▸')).toBe(true); // 光标随尾条目贴窗底
    picker.handleEvent(k('home')); // 光标回首——压窗
    expect(readRow(paint(), 1, width)).toContain('off'); // 回锚顶
  });

  it('首渲染前击键的过深视口在 render 回写真实窗高后回拉（maxOffset 上界）', () => {
    // 补测锁位（实现 095baa1 出生自带 maxOffset 分支——锁此前缺席）：面板打开
    // 后、首渲染前发 end——此时 viewportHeight 还是构造初值 1，offset 被夹到
    // cursor 6；首渲染回写真实窗高 2 后应回拉到「尾行恰贴窗底」位（maxOffset
    // = 7-2 = 5）。若无上界分支：cursor=6 仍在 [6, 6+2) 窗内，offset=6 原样
    // 保持——首行越界空窗、max 孤行。
    const { picker } = makePicker();
    const width = 72;
    picker.handleEvent(k('end')); // 首渲染前击键（陈窗高夹深位）
    const grid = new CellGrid(width, 4); // 头 + 2 行视口 + 提示（矮窗）
    picker.render(grid, { row: 0, col: 0, width, height: 4 });
    expect(readRow(grid, 1, width)).toContain('xhigh'); // 回拉后首行（offset=5——倒数第二档）
    expect(readRow(grid, 2, width)).toContain('max'); // 尾条目恰贴窗底
  });

  it('pagedown/pageup 翻选：光标跳一屏夹取不越界 + 回跳（渲染面 ▸ 位）', () => {
    const { picker } = makePicker();
    const width = 72;
    const paint = (): CellGrid => {
      const grid = new CellGrid(width, 4); // 矮窗：2 行视口 = 页幅
      picker.render(grid, { row: 0, col: 0, width, height: 4 });
      return grid;
    };
    paint(); // 首渲染确立页幅（viewportHeight=2）
    picker.handleEvent(k('pagedown')); // 跳一屏：off → low（索引 2，光标贴窗底提窗）
    let g = paint();
    expect(readRow(g, 2, width).startsWith('▸')).toBe(true);
    expect(readRow(g, 2, width)).toContain('low');
    picker.handleEvent(k('pagedown')); // → high（索引 4）
    picker.handleEvent(k('pagedown')); // → max（索引 6）
    picker.handleEvent(k('pagedown')); // 尾夹取不越界——位不动（仍 max）
    g = paint();
    expect(readRow(g, 2, width).startsWith('▸')).toBe(true);
    expect(readRow(g, 2, width)).toContain('max');
    picker.handleEvent(k('pageup')); // 回跳一屏：max → high（索引 4，提窗回首行）
    g = paint();
    expect(readRow(g, 1, width).startsWith('▸')).toBe(true);
    expect(readRow(g, 1, width)).toContain('high');
    picker.handleEvent(k('pageup')); // → low（索引 2）
    picker.handleEvent(k('pageup')); // → off（索引 0）
    picker.handleEvent(k('pageup')); // 首夹取不越界——位不动（仍 off）
    g = paint();
    expect(readRow(g, 1, width).startsWith('▸')).toBe(true);
    expect(readRow(g, 1, width)).toContain('off');
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

  it('滚轮 = 光标 ±3 行（经既有夹取与视口跟随——↑↓ 同路；修前红：wheel 零动作）+ 闭锁后滚轮零动作', () => {
    const { picker, onSelect } = makePicker();
    const width = 72;
    const paint = (): CellGrid => {
      const grid = new CellGrid(width, 4); // 头 + 2 行视口 + 提示（矮窗）
      picker.render(grid, { row: 0, col: 0, width, height: 4 });
      return grid;
    };
    expect(readRow(paint(), 1, width)).toContain('off'); // 首窗锚顶
    picker.handleEvent(wheel('wheel-down')); // 光标 0 → 3（medium——夹取同 ↓×3）
    const grid = paint();
    expect(readRow(grid, 1, width)).toContain('low'); // 视口跟随提窗 offset 2——修前零动作红锚
    expect(readRow(grid, 1, width)).not.toContain('off');
    expect(readRow(grid, 2, width).startsWith('▸')).toBe(true); // 光标行（medium）贴窗底
    expect(readRow(grid, 2, width)).toContain('medium');
    picker.handleEvent(wheel('wheel-up')); // 光标 3 → 0——回锚顶
    expect(readRow(paint(), 1, width)).toContain('off');
    expect(onSelect).not.toHaveBeenCalled(); // 滚轮只挪光标不选定
    // 闭锁后滚轮照吞零动作（残轮防御位同键面）
    picker.handleEvent(k('q'));
    expect(picker.handleEvent(wheel('wheel-down'))).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
