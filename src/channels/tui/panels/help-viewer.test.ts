/**
 * /help 帮助副屏件测试（批 10k R7）：buildHelpLines 双源行集（命令册对齐 /
 * 键位册按域分组 + 不可覆盖注记）直锁 + 副屏键面三件套（Ctrl+C 打断 /
 * Ctrl+D 先收屏再退出柄 / q 双轨退出闭锁）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import type { ActionView } from '../keys/registry.js';
import { buildHelpLines, HelpViewer } from './help-viewer.js';

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

/** 键位册投影夹具（两域三条——分组头与注记断言用） */
const ACTIONS: readonly ActionView[] = [
  { id: 'global.interrupt', scope: 'global', label: '中断当前 run', keys: ['ctrl+c'] },
  { id: 'global.quit', scope: 'global', label: '退出（空框时）', keys: ['ctrl+d'] },
  { id: 'thinking.toggle', scope: 'thinking', label: '思考块折叠/展开', keys: ['ctrl+t'] },
];

describe('buildHelpLines 行集构造（纯函数）', () => {
  it('命令册段：/name 对齐 + 描述；空册如实（无在册命令）', () => {
    const lines = buildHelpLines(
      [
        { name: 'help', description: '帮助面' },
        { name: 'exit', description: '退出' },
      ],
      [],
    );
    const cmdIndex = lines.indexOf('── 命令 ──');
    expect(cmdIndex).toBe(0);
    expect(lines[1]).toBe('/help 帮助面'); // 名列宽 = max(4,4)+2 = 6 → '/help' + 1 空格
    expect(lines[2]).toBe('/exit 退出');
    // 空册形
    const empty = buildHelpLines([], []);
    expect(empty[1]).toBe('（无在册命令）');
  });

  it('键位册段：按域分组头 + 全局域不可覆盖注记', () => {
    const lines = buildHelpLines([], ACTIONS);
    const keyIndex = lines.indexOf('── 键位 ──');
    expect(keyIndex).toBeGreaterThan(0);
    // 两全局条目共享一个组头，thinking 域换组头
    expect(lines.slice(keyIndex + 1)).toEqual([
      '· 全局',
      'ctrl+c  中断当前 run（不可覆盖）',
      'ctrl+d  退出（空框时）（不可覆盖）',
      '· 思考块',
      'ctrl+t  思考块折叠/展开',
    ]);
  });

  it('命令描述缺席 = 裸名行（trimEnd 不留尾随空格）', () => {
    const lines = buildHelpLines([{ name: 'usage' }], []);
    expect(lines[1]).toBe('/usage');
  });
});

describe('HelpViewer 副屏件', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  it('落位：头行（会话短 id）+ 视口行集 + 底行提示', () => {
    const viewer = new HelpViewer({
      commands: [{ name: 'help', description: '帮助面' }],
      actions: ACTIONS,
      sessionId: '1234567890abcdef',
      onExit: () => {},
    });
    const grid = new CellGrid(60, Math.max(3, viewer.measure(60)));
    viewer.render(grid, { row: 0, col: 0, width: 60, height: grid.rows });
    expect(readRow(grid, 0, 60)).toBe('❓ 命令与键位帮助 · 会话 12345678');
    expect(readRow(grid, 1, 60)).toBe('── 命令 ──');
    expect(readRow(grid, grid.rows - 1, 60)).toBe('q/esc 返回 · ↑↓/pgup/pgdn/home/end 滚动');
  });

  it('q 退出（key 轨 + text 轨两形）——闭锁单次', () => {
    const onExit = vi.fn();
    const viewer = new HelpViewer({ commands: [], actions: [], sessionId: 's', onExit });
    expect(viewer.handleEvent(k('q'))).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(viewer.handleEvent({ kind: 'text', text: 'q' } as InputEvent)).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1); // 闭锁——竞发防御
  });

  it('Esc 同 q 退出', () => {
    const onExit = vi.fn();
    const viewer = new HelpViewer({ commands: [], actions: [], sessionId: 's', onExit });
    viewer.handleEvent(k('escape'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C = 打断在飞（收会话 id 透传）不退屏', () => {
    const onExit = vi.fn();
    const onInterrupt = vi.fn();
    const viewer = new HelpViewer({ commands: [], actions: [], sessionId: 'sess-1', onExit, onInterrupt });
    viewer.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-1');
    expect(onExit).not.toHaveBeenCalled(); // 打断不退副屏
  });

  it('Ctrl+D = 先收副屏再转退出柄（两柄都到、序 = exit 先）', () => {
    const calls: string[] = [];
    const viewer = new HelpViewer({
      commands: [],
      actions: [],
      sessionId: 's',
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    viewer.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });

  it('未消费键终局吞（模态独占）——enter 不逃逸', () => {
    const viewer = new HelpViewer({ commands: [], actions: [], sessionId: 's', onExit: () => {} });
    expect(viewer.handleEvent(k('enter'))).toBe(true);
  });
});
