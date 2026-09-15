/**
 * /sessions 会话切换器测试（批 10k R7）：光标模型（移动夹取/翻页/home-end/
 * 视口跟随 clamp）+ 选定序（先收副屏再 onSelect）+ 空表如实 + 行呈现
 * （光标/活跃位/无题/截断/右段时间短 id）+ 副屏键面三件套。
 */
import { describe, expect, it, vi } from 'vitest';
import type { KeyEvent } from '../../engine/index.js';
import { CellGrid, stringWidth } from '../../engine/index.js';
import type { UiSessionSummary } from '../../../contracts/index.js';
import { SessionPicker } from './session-picker.js';

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

/** 本地时确定时间戳（formatStamp 本地时呈现——构造用本地分量保跨机确定） */
const stamp = (h: number, m: number): number => new Date(2026, 8, 15, h, m).getTime();

/** 会话行夹具 */
const row = (over: Partial<UiSessionSummary> & { id: string }): UiSessionSummary => ({
  title: '标题',
  updatedAt: stamp(10, 30),
  active: false,
  ...over,
});

/** 读回一行（trimEnd） */
function readRow(grid: CellGrid, rowNumber: number, width: number): string {
  let out = '';
  for (let col = 0; col < width; col++) out += grid.getCell(rowNumber, col)?.grapheme ?? ' ';
  return out.trimEnd();
}

/** 装配便捷（全回调 vi 记录） */
function makePicker(sessions: readonly UiSessionSummary[]) {
  const onSelect = vi.fn();
  const onExit = vi.fn();
  const onInterrupt = vi.fn();
  const picker = new SessionPicker({ sessions, onSelect, onExit, onInterrupt });
  return { picker, onSelect, onExit, onInterrupt };
}

describe('SessionPicker 光标与选择模型', () => {
  const sessions = [row({ id: 'aaa111111111' }), row({ id: 'bbb222222222', active: true })];

  it('enter 选定：先收副屏再 onSelect（序断言）+ 终局吞', () => {
    const calls: string[] = [];
    const picker = new SessionPicker({
      sessions,
      onSelect: (id) => calls.push(`select:${id}`),
      onExit: () => calls.push('exit'),
    });
    expect(picker.handleEvent(k('enter'))).toBe(true);
    expect(calls).toEqual(['exit', 'select:aaa111111111']); // 首行默认光标
  });

  it('↓↑ 移动 + 越界夹取不循环；enter 取光标行', () => {
    const { picker, onSelect } = makePicker(sessions);
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down')); // 越界夹取——停尾行
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('bbb222222222');
    picker.handleEvent(k('up'));
    picker.handleEvent(k('up')); // 越界夹取——停首行
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('aaa111111111');
  });

  it('home/end/pagedown 快捷移动', () => {
    const many = Array.from({ length: 12 }, (_, i) => row({ id: `id-${i}-00000000` }));
    const { picker, onSelect } = makePicker(many);
    picker.handleEvent(k('end'));
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('id-11-00000000');
    picker.handleEvent(k('home'));
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('id-0-00000000');
    // 翻选幅 = 视口高（render 回写后生效）——先画一次定视口 8（高 10 头尾各 1）
    const grid = new CellGrid(60, 10);
    picker.render(grid, { row: 0, col: 0, width: 60, height: 10 });
    picker.handleEvent(k('home'));
    picker.handleEvent(k('pagedown'));
    picker.handleEvent(k('enter'));
    expect(onSelect).toHaveBeenCalledWith('id-8-00000000'); // 0 + 8 视口幅
  });

  it('q/Esc 取消退出（不 onSelect）+ 闭锁单次', () => {
    const { picker, onSelect, onExit } = makePicker(sessions);
    picker.handleEvent(k('escape'));
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
    picker.handleEvent(k('q'));
    expect(onExit).toHaveBeenCalledTimes(1); // 闭锁
    picker.handleEvent({ kind: 'text', text: 'q' });
    expect(onExit).toHaveBeenCalledTimes(1); // text 轨同闭锁
  });

  it('空表：如实「无会话」+ 移动族跳过（不炸）+ enter 不选', () => {
    const { picker, onSelect } = makePicker([]);
    const grid = new CellGrid(40, 5);
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 0, 40)).toBe('⇄ 会话切换 · 无会话');
    expect(readRow(grid, 1, 40)).toBe('（无会话）');
    expect(readRow(grid, 4, 40)).toBe('q/esc 返回');
    expect(picker.handleEvent(k('down'))).toBe(true); // 吞而不动
    picker.handleEvent(k('enter'));
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe('SessionPicker 行呈现', () => {
  it('光标标记 + 活跃位 + 标题 + 右段时间短 id', () => {
    const sessions = [
      row({ id: 'aaa111111111', title: '调 TUI' }),
      row({ id: 'bbb222222222', title: '旧会话', active: true, updatedAt: stamp(9, 5) }),
    ];
    const { picker } = makePicker(sessions);
    const grid = new CellGrid(60, 6);
    picker.render(grid, { row: 0, col: 0, width: 60, height: 6 });
    expect(readRow(grid, 0, 60)).toBe('⇄ 会话切换 · 2 会话');
    // 左段 10 列 · 右段 20 列右对齐（col 40）→ 中间 30 空格
    expect(readRow(grid, 1, 60)).toBe('▸   调 TUI' + ' '.repeat(30) + '09-15 10:30 aaa11111');
    expect(readRow(grid, 2, 60)).toBe('  ● 旧会话' + ' '.repeat(30) + '09-15 09:05 bbb22222');
    expect(readRow(grid, 5, 60)).toBe('↑↓ 移动 · enter 切焦 · q/esc 返回');
  });

  it('标题缺席（undefined/空串）如实「（无题）」', () => {
    const { picker } = makePicker([row({ id: 'ccc333333333', title: undefined })]);
    const grid = new CellGrid(60, 4);
    picker.render(grid, { row: 0, col: 0, width: 60, height: 4 });
    expect(readRow(grid, 1, 60)).toContain('（无题）');
  });

  it('超宽左段整字截断加省略号（CJK 不产半字）+ 右段右对齐不被截', () => {
    const longTitle = '很长'.repeat(20); // 80 列 >> 剩余宽
    const { picker } = makePicker([row({ id: 'ddd444444444', title: longTitle })]);
    const grid = new CellGrid(40, 4);
    picker.render(grid, { row: 0, col: 0, width: 40, height: 4 });
    const line = readRow(grid, 1, 40);
    // 右段 20 列（时间 12 + 短 id 8）恒在行尾；左段截断帽 = 40-20-1
    expect(line.endsWith('09-15 10:30 ddd44444')).toBe(true);
    const left = line.slice(0, line.indexOf('09-15')).trimEnd(); // 剥截断段与右段间填充空格
    expect(left.endsWith('…')).toBe(true); // 省略号收尾
    expect(stringWidth(left) + 20 + 1).toBeLessThanOrEqual(40); // 总宽不越界
  });

  it('视口跟随：光标移出窗下沿 → 窗口下移（光标恒可见）', () => {
    const many = Array.from({ length: 10 }, (_, i) => row({ id: `id-${i}-00000000`, title: `行${i}` }));
    const { picker, onSelect } = makePicker(many);
    const grid = new CellGrid(40, 5); // 视口 3 行
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 1, 40)).toContain('行0'); // offset 0
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down'));
    picker.handleEvent(k('down')); // 光标 3 → 窗 [1,3]
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 1, 40)).toContain('行1'); // offset 1——行0 出窗
    expect(readRow(grid, 3, 40)).toContain('▸'); // 光标行在窗内末行
    picker.handleEvent(k('up'));
    picker.handleEvent(k('up'));
    picker.handleEvent(k('up')); // 光标 0 → 窗回 [0,2]
    picker.render(grid, { row: 0, col: 0, width: 40, height: 5 });
    expect(readRow(grid, 1, 40)).toContain('行0');
    void onSelect;
  });
});

describe('SessionPicker 副屏键面三件套', () => {
  it('Ctrl+C 打断目标 = 装配闭包（无参柄——聚焦会话自知）不退屏', () => {
    const { picker, onInterrupt, onExit } = makePicker([row({ id: 'a' })]);
    picker.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith(); // 无参
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Ctrl+D 先收副屏再退出柄（序断言）', () => {
    const calls: string[] = [];
    const picker = new SessionPicker({
      sessions: [row({ id: 'a' })],
      onSelect: () => calls.push('select'),
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    picker.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });

  it('未消费键终局吞（模态独占）', () => {
    const { picker } = makePicker([row({ id: 'a' })]);
    expect(picker.handleEvent(k('x'))).toBe(true);
    expect(picker.handleEvent({ kind: 'text', text: 'z' })).toBe(true);
  });
});
