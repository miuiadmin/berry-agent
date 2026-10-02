/**
 * 后台任务面板单测（界面美化役批6）：清板语义（终态防御性滤除）/ 行形
 * （kind 图标 + 时长单源）/ 帽 5 + 溢出行指路 / 光标翻页态（激活/移动/
 * 夹取/清除 + ▸ 记与 accent）/ 低段高缩形（先缩后隐梯末位）。
 */
import { describe, expect, it } from 'vitest';
import { CellGrid, ansiColor } from '../../engine/index.js';
import type { JobEntry, JobStatus } from '../../../contracts/index.js';
import { DEFAULT_THEME } from '../theme/index.js';
import { JobPanel } from './job-panel.js';

const WIDTH = 40;
const NOW = 1_065_000; // 定值钟——时长确定性（起跑后 65s = 1m 05s）

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
function renderPanel(panel: JobPanel, width = WIDTH): CellGrid {
  const grid = new CellGrid(width, panel.measure(width));
  panel.render(grid, { row: 0, col: 0, width, height: grid.rows });
  return grid;
}

/** 条目夹具（起跑 1_000_000——NOW 下时长 1m 05s） */
function job(id: string, overrides: Partial<JobEntry> = {}): JobEntry {
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

/** 终态条目夹具（settle 于起跑 +40s） */
function settledJob(id: string, status: 'completed' | 'killed' | 'failed'): JobEntry {
  return job(id, { status, terminal: { status, at: 1_040_000 } });
}

function makePanel(): JobPanel {
  return new JobPanel({ now: () => NOW });
}

describe('JobPanel 清板与终态防御性滤除', () => {
  it('初始零行；null / undefined / 空表同为清板', () => {
    const panel = makePanel();
    expect(panel.measure(WIDTH)).toBe(0);
    panel.update([job('job-1')]);
    expect(panel.measure(WIDTH)).toBe(1);
    panel.update(null);
    expect(panel.measure(WIDTH)).toBe(0);
    panel.update([job('job-2')]);
    panel.update(undefined);
    expect(panel.measure(WIDTH)).toBe(0);
    panel.update([job('job-3')]);
    panel.update([]);
    expect(panel.measure(WIDTH)).toBe(0);
  });

  it('终态条目不进段（防闪烁约件内自守——数据面混入不破形）', () => {
    const panel = makePanel();
    panel.update([job('job-1'), settledJob('job-2', 'completed'), settledJob('job-3', 'failed'), job('job-4')]);
    expect(panel.measure(WIDTH)).toBe(2);
    const grid = renderPanel(panel);
    expect(readRow(grid, 0)).toContain('任务 job-1');
    expect(readRow(grid, 1)).toContain('任务 job-4');
  });
});

describe('JobPanel 行形', () => {
  it('`{图标} {名} · {时长}`——kind 图标三符 + 时长 formatElapsedCompact 单源', () => {
    const panel = makePanel();
    panel.update([
      job('job-1'),
      job('job-2', { kind: 'issue', owner: 'cron-nightly' }),
      job('job-3', { kind: 'trigger', owner: 'cron-nightly' }),
    ]);
    const grid = renderPanel(panel);
    expect(readRow(grid, 0)).toBe('◆ 任务 job-1 · 1m 05s');
    expect(readRow(grid, 1)).toBe('■ 任务 job-2 · 1m 05s');
    expect(readRow(grid, 2)).toBe('○ 任务 job-3 · 1m 05s');
  });

  it('长名省略形收口（… 记号——截断省略号全域统一律）', () => {
    const panel = makePanel();
    panel.update([job('job-1', { name: '一'.repeat(60) })]);
    const grid = renderPanel(panel);
    // 宽 40 - 图标 2 = 38 列内容预算 → 37 列整字 + '…' = 18 个汉字 + 省略号
    expect(readRow(grid, 0)).toBe('◆ ' + '一'.repeat(18) + '…');
  });
});

describe('JobPanel 帽 5 与溢出行', () => {
  it('帽 5 行 + 溢出行「+ N 更多 · /jobs 查看」（dim）', () => {
    const panel = makePanel();
    panel.update(Array.from({ length: 7 }, (_, i) => job(`job-${i + 1}`)));
    expect(panel.measure(WIDTH)).toBe(6); // 帽 5 + 溢出行
    const grid = renderPanel(panel);
    expect(readRow(grid, 4)).toContain('任务 job-5'); // 帽内末行在场
    expect(readRow(grid, 5)).toBe('+ 2 更多 · /jobs 查看');
    expect(grid.getCell(5, 0)?.style?.dim).toBe(true);
  });

  it('恰帽内无溢出行', () => {
    const panel = makePanel();
    panel.update(Array.from({ length: 5 }, (_, i) => job(`job-${i + 1}`)));
    expect(panel.measure(WIDTH)).toBe(5);
    const grid = renderPanel(panel);
    expect(readRow(grid, 4)).toContain('任务 job-5');
  });

  it('低段高缩形（先缩后隐梯末位）：段高容量收行 + 溢出行对截断几何诚实', () => {
    const panel = makePanel();
    panel.update(Array.from({ length: 4 }, (_, i) => job(`job-${i + 1}`)));
    const grid = new CellGrid(WIDTH, 2); // 分配段高 2（低于量高 4）
    panel.render(grid, { row: 0, col: 0, width: WIDTH, height: 2 });
    expect(readRow(grid, 0)).toContain('任务 job-1');
    expect(readRow(grid, 1)).toBe('+ 3 更多 · /jobs 查看'); // 帽/段高外未显行数
  });
});

describe('JobPanel 光标翻页态（批6 问题②一期直接做）', () => {
  it('未激活零光标列（无光标帧不缩内容预算）；首按 moveCursor 激活置 0（▸ 记 + accent）', () => {
    const panel = makePanel();
    panel.update([job('job-1'), job('job-2')]);
    expect(panel.cursorActive).toBe(false);
    let grid = renderPanel(panel);
    expect(readRow(grid, 0)).toBe('◆ 任务 job-1 · 1m 05s'); // 无光标列——图标直起
    expect(panel.moveCursor(1)).toBe(true);
    grid = renderPanel(panel);
    expect(readRow(grid, 0)).toBe('▸ ◆ 任务 job-1 · 1m 05s'); // 光标期 ▸ 记 + 空光标位
    expect(readRow(grid, 1)).toBe('  ◆ 任务 job-2 · 1m 05s');
    expect(panel.selectedId).toBe('job-1');
    expect(grid.getCell(0, 0)?.style?.fg).toBe(DEFAULT_THEME.accent);
    expect(grid.getCell(1, 0)?.style?.fg).toBeUndefined();
  });

  it('↑ 首按同激活置 0；激活后按 delta 界夹取（不越帽）', () => {
    const panel = makePanel();
    panel.update(Array.from({ length: 3 }, (_, i) => job(`job-${i + 1}`)));
    expect(panel.moveCursor(-1)).toBe(true); // ↑ 首按——激活置 0（首行之上无路）
    expect(panel.selectedId).toBe('job-1');
    panel.moveCursor(5); // 越界夹取到末行
    expect(panel.selectedId).toBe('job-3');
    panel.moveCursor(-5);
    expect(panel.selectedId).toBe('job-1');
  });

  it('空集 moveCursor 返 false 零动作（调用位不劫键——编辑器既有键零让位）', () => {
    const panel = makePanel();
    expect(panel.moveCursor(1)).toBe(false);
    panel.update([job('job-1')]);
    panel.update(null); // 行集收缩清板
    expect(panel.moveCursor(1)).toBe(false);
  });

  it('clearCursor：在场才返 true；清除后恢复无光标帧形', () => {
    const panel = makePanel();
    panel.update([job('job-1')]);
    expect(panel.clearCursor()).toBe(false);
    panel.moveCursor(1);
    expect(panel.clearCursor()).toBe(true);
    expect(panel.cursorActive).toBe(false);
    expect(panel.selectedId).toBeNull();
    const grid = renderPanel(panel);
    expect(readRow(grid, 0)).toBe('◆ 任务 job-1 · 1m 05s');
  });

  it('行集收缩光标夹取（update 后自守——越界即收到新末行）', () => {
    const panel = makePanel();
    panel.update([job('job-1'), job('job-2'), job('job-3')]);
    panel.moveCursor(1); // 首按激活置 0
    panel.moveCursor(5); // 激活后大 delta——夹取到末行 job-3
    expect(panel.selectedId).toBe('job-3');
    panel.update([job('job-1'), job('job-2')]); // 收缩——夹取到 job-2
    expect(panel.selectedId).toBe('job-2');
    panel.update(null); // 清板——光标收敛 null
    panel.update([job('job-9')]);
    expect(panel.cursorActive).toBe(false); // 清板即光标离场（再激活须再按键）
  });

  it('溢出行不可选（光标域 = 帽内行）', () => {
    const panel = makePanel();
    panel.update(Array.from({ length: 8 }, (_, i) => job(`job-${i + 1}`)));
    panel.moveCursor(1); // 首按激活置 0
    panel.moveCursor(99); // 大 delta——夹取到帽内末行 job-5（非溢出行）
    expect(panel.selectedId).toBe('job-5');
  });

  it('setTheme 重建在选行 accent（换装随动）', () => {
    const panel = makePanel();
    panel.update([job('job-1')]);
    panel.moveCursor(1);
    panel.setTheme({ ...DEFAULT_THEME, accent: ansiColor(9) }); // 换 accent 色号（16 色档）
    const grid = renderPanel(panel);
    expect(grid.getCell(0, 0)?.style?.fg).toBe(9);
  });
});

describe('JobPanel 重试计数段（TUI 视觉重设计批 V-1——07 §4.1 V-0 注①聚合律）', () => {
  it('retry>0 行形 `◆ 名 · 时长 · 重试 ×N`；零重试无段（缺席形不显 ×0）', () => {
    const panel = makePanel();
    panel.update([job('job-1', { retry: 2 })]);
    expect(readRow(renderPanel(panel), 0)).toBe('◆ 任务 job-1 · 1m 05s · 重试 ×2');
    // 零重试回落既有行形（无段不显「重试 ×0」）
    panel.update([job('job-1')]);
    expect(readRow(renderPanel(panel), 0)).toBe('◆ 任务 job-1 · 1m 05s');
  });
});
