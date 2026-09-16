/**
 * /debug 调试信息副屏件测试（07 §4.1 命令面增补批）：maskDaemonLogLines
 * Bearer 形掩码（凭证/token 恒不入面）直锁 + buildDebugLines 行集（段序 /
 * 缺席两形 / warn 汇总）+ 副屏键面三件套 + 开屏锚顶。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import { buildDebugLines, DebugViewer, maskDaemonLogLines } from './debug-viewer.js';
import type { DebugPanelData } from './debug-viewer.js';

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

/** daemon token 披露行原形（serve-daemon 自动生成回执——掩码目标真形） */
const TOKEN_LINE = 'daemon token（自动生成——本地调用方接入凭证，已进本日志不再复现）：Bearer tok_abc123xyz';

/** 全量数据夹具（各缺席形测试局部覆写） */
const DATA: DebugPanelData = {
  daemonLogPath: '/tmp/berry-home/serve/daemon.log',
  daemonLogTail: ['daemon 启动（pid 123）', TOKEN_LINE, '面开：127.0.0.1:8080'],
  logLevel: 'info（缺省）',
  settingsKeys: ['theme', 'keybindings'],
  settingsWarnings: ['settings.json：theme 值「neon」不在档——回退 dark', '键位覆盖未生效：unknown-action foo'],
  sqlitePath: '/tmp/berry-home/agent.db',
  pluginIds: ['core:skills', 'plugin:demo'],
};

describe('maskDaemonLogLines Bearer 形掩码（凭证恒不入面）', () => {
  it('Bearer 形尾段掩码、行内其余原文保持', () => {
    const masked = maskDaemonLogLines([TOKEN_LINE]);
    expect(masked[0]).toContain('Bearer ****');
    expect(masked[0]).not.toContain('tok_abc123xyz'); // 明文尾段不再现
    expect(masked[0]).toContain('daemon token（自动生成'); // 前缀原文保持（行义可辨识）
  });

  it('非 token 形行零改写；一行多 Bearer 形全掩', () => {
    const lines = ['普通日志行', 'a Bearer x1 b Bearer x2'];
    expect(maskDaemonLogLines(lines)).toEqual(['普通日志行', 'a Bearer **** b Bearer ****']);
  });
});

describe('buildDebugLines 行集构造（纯函数）', () => {
  it('段序与行集：运行时（logLevel/sqlite）→ 插件清单 → daemon.log（路径+掩码尾快照）→ settings（键+warn）', () => {
    const lines = buildDebugLines(DATA);
    expect(lines[0]).toBe('── 运行时 ──');
    expect(lines.some((line) => line.startsWith('日志级别 logLevel') && line.includes('info（缺省）'))).toBe(true);
    expect(lines.some((line) => line.startsWith('sqlite 库 dbPath') && line.includes('agent.db'))).toBe(true);
    // 插件清单段（计数头 + 逐 id 行）
    expect(lines).toContain('── 已装载插件（2 件）──');
    expect(lines).toContain('· core:skills');
    expect(lines).toContain('· plugin:demo');
    // daemon.log 段：路径 + 尾快照（token 行已掩码——行集构造内执法）
    expect(lines).toContain('── daemon.log ──');
    expect(lines.some((line) => line.startsWith('路径 logPath') && line.includes('serve/daemon.log'))).toBe(true);
    expect(lines.some((line) => line.includes('Bearer ****'))).toBe(true);
    expect(lines.some((line) => line.includes('tok_abc123xyz'))).toBe(false); // 明文恒不入面
    // settings 段：有效键 + warn 汇总
    expect(lines).toContain('── settings ──');
    expect(lines.some((line) => line.startsWith('有效键 keys') && line.includes('theme、keybindings'))).toBe(true);
    expect(lines.some((line) => line.startsWith('⚠') && line.includes('neon'))).toBe(true);
  });

  it('缺席两形：:memory: 无数据目录路径行；非 daemon 跑法快照缺席行', () => {
    const memoryForm = buildDebugLines({ ...DATA, daemonLogPath: null, daemonLogTail: null });
    expect(memoryForm.some((line) => line.startsWith('路径 logPath') && line.includes(':memory:'))).toBe(true);
    const absentForm = buildDebugLines({ ...DATA, daemonLogTail: null });
    expect(absentForm).toContain('（非 daemon 跑法或文件尚未生成——daemon.log 缺席）');
  });

  it('空清单形：无插件 / 无配置键 / 无 warn 各自如实', () => {
    const lines = buildDebugLines({ ...DATA, pluginIds: [], settingsKeys: [], settingsWarnings: [] });
    expect(lines).toContain('（无插件装载——--no-plugins 跑法或启用清单空）');
    expect(lines.some((line) => line.startsWith('有效键 keys') && line.includes('全走缺省'))).toBe(true);
    expect(lines).toContain('坏值/拒载 warn：无');
  });
});

describe('DebugViewer 副屏件', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  it('落位：头行 + 首段行集 + 底行提示；开屏锚顶（长内容 offset 0）', () => {
    const viewer = new DebugViewer({ data: DATA, sessionId: 'sess-1', onExit: () => {} });
    const grid = new CellGrid(60, Math.max(3, viewer.measure(60)));
    viewer.render(grid, { row: 0, col: 0, width: 60, height: grid.rows });
    expect(readRow(grid, 0, 60)).toBe('⚙ 调试信息');
    expect(readRow(grid, 1, 60)).toBe('── 运行时 ──'); // 开屏锚顶
    expect(readRow(grid, grid.rows - 1, 60)).toBe('q/esc 返回 · ↑↓/pgup/pgdn/home/end 滚动');
    expect(viewer.scrollOffset).toBe(0); // 全量行集超出视口——锚顶律直锁
  });

  it('q 退出（key 轨 + text 轨两形）——闭锁单次', () => {
    const onExit = vi.fn();
    const viewer = new DebugViewer({ data: DATA, sessionId: 's', onExit });
    expect(viewer.handleEvent(k('q'))).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(viewer.handleEvent({ kind: 'text', text: 'q' } as InputEvent)).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1); // 闭锁——竞发防御
  });

  it('Ctrl+C = 打断在飞（收会话 id 透传）不退屏', () => {
    const onExit = vi.fn();
    const onInterrupt = vi.fn();
    const viewer = new DebugViewer({ data: DATA, sessionId: 'sess-1', onExit, onInterrupt });
    viewer.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-1');
    expect(onExit).not.toHaveBeenCalled();
  });

  it('Ctrl+D = 先收副屏再转退出柄（两柄都到、序 = exit 先）', () => {
    const calls: string[] = [];
    const viewer = new DebugViewer({
      data: DATA,
      sessionId: 's',
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    viewer.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });
});
