/**
 * /jobs 后台任务副屏件测试（界面美化役批6）：jobEntryLine 行文组装纯函数
 * （状态词/时长口径/归属短 id）+ JobsViewer 呈现（分段组装/降序/光标域跳
 * 分段头/定位/滚动钉随/空态/退出族）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent, MouseEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import { JobsViewer, jobEntryLine } from './jobs-viewer.js';
import type { JobsViewerOptions } from './jobs-viewer.js';
import type { JobEntry, JobStatus } from '../../../contracts/index.js';
import { DEFAULT_THEME } from '../theme/index.js';

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

/** kitty text 事件夹具 */
const text = (value: string): InputEvent & { kind: 'text' } => ({ kind: 'text', text: value });

/** 条目夹具（epoch ms 定值——时长口径确定性） */
function entry(id: string, overrides: Partial<JobEntry> = {}): JobEntry {
  const status: JobStatus = overrides.status ?? 'running';
  return {
    id,
    name: `任务 ${id}`,
    kind: 'subagent',
    owner: 'sess-abcdef1234567890',
    status,
    startedAt: 1_000_000,
    ...overrides,
  };
}

/** 终态条目夹具（settle 于给定时刻） */
function settled(id: string, status: 'completed' | 'killed' | 'failed', at: number): JobEntry {
  return entry(id, { status, terminal: { status, at } });
}

const NOW = 1_065_000; // 起跑后 65s——活时 '1m 05s'

/** 常用清单（两运行 + 两终态） */
const ENTRIES: readonly JobEntry[] = [
  entry('job-1'),
  entry('job-2', { status: 'stopping', kind: 'trigger', owner: 'cron-nightly' }),
  settled('job-3', 'completed', 1_050_000), // 50s
  settled('job-4', 'failed', 1_040_000), // 40s
];

function makeViewer(overrides: Partial<JobsViewerOptions> = {}) {
  const onExit = vi.fn();
  const viewer = new JobsViewer({
    entries: ENTRIES,
    now: () => NOW,
    theme: DEFAULT_THEME,
    sessionId: 'sess-abcdef1234567890',
    onExit,
    ...overrides,
  });
  return { viewer, onExit };
}

describe('jobEntryLine 行文组装纯函数', () => {
  it('运行中：活时口径（now - startedAt）+ 状态词 + 子代理归属短 id', () => {
    expect(jobEntryLine(entry('job-1'), NOW)).toBe('任务 job-1 · 运行中 · 1m 05s · sess-abc');
  });

  it('stopping / 非 subagent 归属原样（owner 非会话 id 不截）', () => {
    expect(jobEntryLine(entry('job-2', { status: 'stopping', kind: 'trigger', owner: 'cron-nightly' }), NOW)).toBe(
      '任务 job-2 · 停止中 · 1m 05s · cron-nightly',
    );
  });

  it('终态：冻结时长口径（terminal.at - startedAt）+ 三终态词', () => {
    expect(jobEntryLine(settled('job-3', 'completed', 1_050_000), NOW)).toBe('任务 job-3 · 已完成 · 50s · sess-abc');
    expect(jobEntryLine(settled('job-4', 'failed', 1_040_000), NOW)).toBe('任务 job-4 · 失败 · 40s · sess-abc');
    expect(jobEntryLine(settled('job-5', 'killed', 1_030_000), NOW)).toBe('任务 job-5 · 已停止 · 30s · sess-abc');
  });
});

describe('JobsViewer 副屏件', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  it('分段组装：运行中（注册序）在前 + 近期结束（terminal.at 降序）+ 头/提示行', () => {
    const { viewer } = makeViewer();
    const width = 64;
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 0, width)).toBe('◉ 后台任务 /jobs');
    expect(readRow(grid, 1, width)).toBe('── 运行中（2）──');
    expect(readRow(grid, 2, width)).toContain('任务 job-1 · 运行中');
    expect(readRow(grid, 3, width)).toContain('任务 job-2 · 停止中');
    expect(readRow(grid, 4, width)).toBe('── 近期结束（2）──');
    // 降序：job-3（at=1_050_000）先于 job-4（at=1_040_000）
    expect(readRow(grid, 5, width)).toContain('任务 job-3 · 已完成');
    expect(readRow(grid, 6, width)).toContain('任务 job-4 · 失败');
    expect(readRow(grid, 7, width)).toBe('↑↓ 移动 · q/esc 返回');
  });

  it('光标域 = 条目行（分段头不可选）：↓ 逐条目行移动、跨段跳分段头', () => {
    const { viewer } = makeViewer();
    const width = 64;
    // 缺省光标 = 首条目（job-1）→ ↓ → 第二条目（job-2）→ ↓ 跨「近期结束」
    // 分段头 → 第三条目（job-3，不驻留分段头）
    let grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 2, width).startsWith('▸ 任务 job-1')).toBe(true);
    viewer.handleEvent(k('down'));
    grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 3, width).startsWith('▸ 任务 job-2')).toBe(true);
    viewer.handleEvent(k('down')); // 跨分段头——光标落 job-3
    grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 5, width).startsWith('▸ 任务 job-3')).toBe(true);
    // ↑ 回跨分段头同样跳过
    viewer.handleEvent(k('up'));
    grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 3, width).startsWith('▸ 任务 job-2')).toBe(true);
  });

  it('在选行 ▸ 记 + accent 着色；未选行光标位空格占列（对齐几何）', () => {
    const { viewer } = makeViewer();
    const width = 64;
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(grid.getCell(2, 0)?.style?.fg).toBe(DEFAULT_THEME.accent); // job-1 在选
    expect(grid.getCell(3, 0)?.grapheme).toBe(' '); // 未选行光标位空格
    expect(grid.getCell(3, 0)?.style?.fg).toBeUndefined();
  });

  it('失败行 error 着色 / 其余终态行 dim / 运行行裸（在选 accent 之外的常态三档）', () => {
    const { viewer } = makeViewer();
    const width = 64;
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(grid.getCell(3, 1)?.style?.fg).toBeUndefined(); // job-2 停止中（运行段）——裸
    expect(grid.getCell(5, 1)?.style?.dim).toBe(true); // job-3 已完成——dim
    expect(grid.getCell(6, 1)?.style?.fg).toBe(DEFAULT_THEME.error); // job-4 失败——error
  });

  it('initialJobId 定位：光标直落该任务行（JobPanel enter 进屏面）', () => {
    const { viewer } = makeViewer({ initialJobId: 'job-4' });
    const width = 64;
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 6, width).startsWith('▸ 任务 job-4')).toBe(true);
  });

  it('长清单滚动：滚轮只滚视口不挪光标（自由滚位），键盘 ↓ 复位钉随（光标恒可见）', () => {
    const many: readonly JobEntry[] = Array.from({ length: 12 }, (_, i) => entry(`job-${i + 1}`));
    const { viewer } = makeViewer({ entries: many });
    const width = 64;
    const height = 8; // 视口高 6 < 13 行（头 + 12 条目）——滚动态
    const grid = new CellGrid(width, height);
    viewer.render(grid, { row: 0, col: 0, width, height });
    viewer.handleEvent(wheel('wheel-down'));
    viewer.render(grid, { row: 0, col: 0, width, height });
    // 自由滚位：视口前移 3 行（头行滚出窗，屏 1 行 = job-3），光标仍在首条目
    // （可暂出窗——不钉随）
    expect(readRow(grid, 1, width)).toContain('任务 job-3');
    viewer.handleEvent(k('down')); // 键盘动作复位钉随
    viewer.render(grid, { row: 0, col: 0, width, height });
    expect(readRow(grid, 1, width)).toContain('▸ 任务 job-2');
  });

  it('home/end/page 翻越（域内夹取）；上界即末条目行', () => {
    const { viewer } = makeViewer();
    const width = 64;
    viewer.handleEvent(k('end'));
    let grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 6, width).startsWith('▸ 任务 job-4')).toBe(true);
    viewer.handleEvent(k('home'));
    grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 2, width).startsWith('▸ 任务 job-1')).toBe(true);
    // 光标 0 之上零路（首按 down 才激活语义在此恒驻——up 不越 0）
    viewer.handleEvent(k('up'));
    grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 2, width).startsWith('▸ 任务 job-1')).toBe(true);
  });

  it('空清单 = 诚实空态行 + 提示行缩为「q/esc 返回」；移动键不动作不炸', () => {
    const { viewer } = makeViewer({ entries: [] });
    const width = 64;
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 1, width)).toBe('（当前没有后台任务）');
    expect(readRow(grid, 2, width)).toBe('q/esc 返回');
    expect(viewer.handleEvent(k('down'))).toBe(true);
    expect(viewer.handleEvent(k('home'))).toBe(true);
  });

  it('退出族：q / esc / kitty text q 收口恰一次（闭锁）；Ctrl+C 打断不退屏、Ctrl+D 先收屏再退', () => {
    const onInterrupt = vi.fn();
    const onQuit = vi.fn();
    const { viewer, onExit } = makeViewer({ onInterrupt, onQuit });
    viewer.handleEvent(k('q'));
    expect(onExit).toHaveBeenCalledTimes(1);
    viewer.handleEvent(k('escape')); // 闭锁——单次收口
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onInterrupt).not.toHaveBeenCalled();
    expect(onQuit).not.toHaveBeenCalled();

    const viewer2 = new JobsViewer({
      entries: ENTRIES,
      now: () => NOW,
      theme: DEFAULT_THEME,
      sessionId: 'sess-abcdef1234567890',
      onExit: vi.fn(),
      onInterrupt,
      onQuit,
    });
    viewer2.handleEvent(text('q')); // kitty 轨纯键打字走 text 事件
    expect(viewer2.handleEvent(k('escape'))).toBe(true);

    const viewer3 = new JobsViewer({
      entries: ENTRIES,
      now: () => NOW,
      theme: DEFAULT_THEME,
      sessionId: 'sess-abcdef1234567890',
      onExit: vi.fn(),
      onInterrupt,
      onQuit,
    });
    viewer3.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-abcdef1234567890'); // 打断不退屏
    viewer3.handleEvent(k('d', { ctrl: true }));
    expect(onQuit).toHaveBeenCalledTimes(1); // 先收屏再退
  });

  it('初始光标 = 首条目（initialJobId 缺席缺省位）', () => {
    const { viewer } = makeViewer();
    const width = 64;
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    expect(readRow(grid, 2, width).startsWith('▸ 任务 job-1')).toBe(true);
  });
});
