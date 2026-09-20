/**
 * /skills 技能清单副屏件测试（07 §4.1 命令面增补批）：行呈现（光标 / 隐藏
 * 标记 / 来源层右段）+ 光标选择模型（移动 / 翻选 / 夹取）+ enter 回填序律
 * （先收副屏再 onSelect——回填不执行）+ 副屏键面三件套。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent } from '../../engine/index.js';
import { CellGrid, stringWidth } from '../../engine/index.js';
import { SkillsViewer } from './skills-viewer.js';
import type { SkillListEntry } from './skills-viewer.js';

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

/** 清单夹具（含隐藏件——含入不滤标记呈现） */
const ENTRIES: readonly SkillListEntry[] = [
  { name: 'commit-style', description: '提交信息风格', layer: 'project', hidden: false },
  { name: 'dataviz', description: '图表建议', layer: 'user', hidden: true },
  { name: 'review', description: '代码评审', layer: 'plugin:demo', hidden: false },
];

describe('SkillsViewer 副屏件', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  /** 渲染夹具：指定视口高落位 */
  function render(viewer: SkillsViewer, height: number, width = 60): CellGrid {
    const grid = new CellGrid(width, Math.max(3, viewer.measure(width), height));
    viewer.render(grid, { row: 0, col: 0, width, height: Math.min(height, grid.rows) });
    return grid;
  }

  it('落位：头行计数 + 首行光标标记 + 隐藏件层名前缀 + 底行提示', () => {
    const viewer = new SkillsViewer({ entries: ENTRIES, onSelect: () => {}, sessionId: 's', onExit: () => {} });
    const grid = render(viewer, 6);
    expect(readRow(grid, 0, 60)).toBe('✦ 技能清单 · 3 件');
    // 首行 = 光标（▸）+ 名 + 描述 + 右段层名
    expect(readRow(grid, 1, 60)).toContain('▸ commit-style');
    expect(readRow(grid, 1, 60)).toContain('提交信息风格');
    expect(readRow(grid, 1, 60)).toContain('project');
    expect(readRow(grid, 1, 60)).not.toContain('▸▸'); // 光标唯一
    // 非光标行两空格缩进；隐藏件行右段 = 隐 · 层名
    expect(readRow(grid, 2, 60).startsWith('  dataviz')).toBe(true);
    expect(readRow(grid, 2, 60)).toContain('隐 · user');
    expect(readRow(grid, 3, 60)).toContain('plugin:demo'); // 插件层名原样
    expect(readRow(grid, 5, 60)).toBe('↑↓ 移动 · enter 回填调用形 · q/esc 返回');
  });

  it('空清单：无技能行 + 提示缩位（q/esc 返回）', () => {
    const viewer = new SkillsViewer({ entries: [], onSelect: () => {}, sessionId: 's', onExit: () => {} });
    const grid = render(viewer, 4);
    expect(readRow(grid, 0, 60)).toBe('✦ 技能清单 · 无技能');
    expect(readRow(grid, 1, 60)).toContain('skills 件未装载');
    expect(readRow(grid, 3, 60)).toBe('q/esc 返回');
  });

  it('窄窗右段预算律：插件层 id 右段先按预算 … 截断再右对齐——负起列劈毁技能名坏形封堵（修前红）', () => {
    // 层 id 无界（插件 id 自由文本）——窗 20 < 层 id 宽 31：修前 rightCol = -11，
    // CellGrid 吸收负列首段后余段从行首覆写，光标标记与技能名全毁
    const entries: readonly SkillListEntry[] = [
      { name: 'commit-style', description: '提交信息风格', layer: 'plugin:demo-plugin-with-long-id', hidden: false },
    ];
    const viewer = new SkillsViewer({ entries, onSelect: () => {}, sessionId: 's', onExit: () => {} });
    const width = 20;
    const grid = new CellGrid(width, viewer.measure(width));
    viewer.render(grid, { row: 0, col: 0, width, height: grid.rows });
    const line = readRow(grid, 1, width);
    expect(line.startsWith('▸')).toBe(true); // 行首光标标记不被右段尾覆写
    expect(line).toContain('commit'); // 技能名前段存活（左段保留位 ≥ 半窗下限）
    expect(line).toContain('…'); // 右段按预算 … 收口
    expect(stringWidth(line)).toBeLessThanOrEqual(width); // 行宽不越窗
  });

  it('光标移动：↓ 下移、↑ 夹首、end 到尾 + 光标驱动视口夹取', () => {
    const viewer = new SkillsViewer({ entries: ENTRIES, onSelect: () => {}, sessionId: 's', onExit: () => {} });
    viewer.handleEvent(k('down'));
    let grid = render(viewer, 4); // 视口 2 行（头 + 提示占 2）——初测视口高 1 时已夹窗到光标
    expect(readRow(grid, 1, 60)).toContain('▸ dataviz'); // 光标下移一行——提窗跟随
    expect(readRow(grid, 2, 60).startsWith('  review')).toBe(true); // 非光标行缩进
    viewer.handleEvent(k('end'));
    grid = render(viewer, 4);
    expect(readRow(grid, 2, 60)).toContain('▸ review'); // 光标到尾——末条恒可见
    viewer.handleEvent(k('up'));
    viewer.handleEvent(k('up'));
    viewer.handleEvent(k('up')); // 越界夹首不循环
    grid = render(viewer, 6);
    expect(readRow(grid, 1, 60)).toContain('▸ commit-style');
  });

  it('首渲染前击键的过深视口在 render 回写真实窗高后回拉（maxOffset 上界）', () => {
    // 修前红实证位：同 theme-picker 家族缺陷——面板打开后、首渲染前发 end，
    // viewportHeight 还是构造初值 1，offset 被夹到 cursor 3；首渲染回写真实
    // 窗高 2 后应回拉到「尾行恰贴窗底」位（maxOffset = 4-2 = 2）。修前无上界
    // 分支：cursor=3 仍在 [3, 3+2) 窗内，offset=3 原样保持——首行尾条目、
    // 第二行空窗。
    const four = [...ENTRIES, { name: 'writer', description: '写作风格', layer: 'project', hidden: false }];
    const viewer = new SkillsViewer({ entries: four, onSelect: () => {}, sessionId: 's', onExit: () => {} });
    viewer.handleEvent(k('end')); // 首渲染前击键（陈窗高夹深位）
    const grid = render(viewer, 4); // 头 + 2 行视口 + 提示
    expect(readRow(grid, 1, 60)).toContain('review'); // 回拉后首行（offset=2——倒数第二）
    expect(readRow(grid, 2, 60)).toContain('writer'); // 尾条目恰贴窗底
  });

  it('enter 选定：先收副屏再 onSelect（索引位透传——回填文本装配位铸）', () => {
    const calls: string[] = [];
    const viewer = new SkillsViewer({
      entries: ENTRIES,
      onSelect: (index) => calls.push(`select:${index}`),
      sessionId: 's',
      onExit: () => calls.push('exit'),
    });
    viewer.handleEvent(k('down'));
    viewer.handleEvent(k('enter'));
    expect(calls).toEqual(['exit', 'select:1']); // 序 = exit 先（收屏）再回填回调
  });

  it('q 退出（key 轨 + text 轨两形）——闭锁单次；选定后竞发不再回调', () => {
    const onExit = vi.fn();
    const viewer = new SkillsViewer({ entries: ENTRIES, onSelect: () => {}, sessionId: 's', onExit });
    expect(viewer.handleEvent(k('q'))).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(viewer.handleEvent({ kind: 'text', text: 'q' } as InputEvent)).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1); // 闭锁——竞发防御
  });

  it('Esc 同 q 退出', () => {
    const onExit = vi.fn();
    const viewer = new SkillsViewer({ entries: ENTRIES, onSelect: () => {}, sessionId: 's', onExit });
    viewer.handleEvent(k('escape'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C = 打断在飞（收会话 id 透传）不退屏', () => {
    const onExit = vi.fn();
    const onInterrupt = vi.fn();
    const viewer = new SkillsViewer({ entries: ENTRIES, onSelect: () => {}, sessionId: 'sess-9', onExit, onInterrupt });
    viewer.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-9');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Ctrl+D = 先收副屏再转退出柄（两柄都到、序 = exit 先）', () => {
    const calls: string[] = [];
    const viewer = new SkillsViewer({
      entries: ENTRIES,
      onSelect: () => {},
      sessionId: 's',
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    viewer.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });

  it('未消费键终局吞（模态独占）——左右字母键不逃逸', () => {
    const viewer = new SkillsViewer({ entries: ENTRIES, onSelect: () => {}, sessionId: 's', onExit: () => {} });
    expect(viewer.handleEvent(k('x'))).toBe(true);
    expect(viewer.handleEvent({ kind: 'text', text: 'x' } as InputEvent)).toBe(true);
  });
});
