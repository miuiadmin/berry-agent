/**
 * /status 状态汇总副屏件测试（07 §4.1 命令面增补批）：buildStatusLines 行集
 * （段序 / 标签对齐 / 缺席诚实形 / env 白名单三键）直锁 + 副屏键面三件套
 * （Ctrl+C 打断 / Ctrl+D 先收屏再退出柄 / q 双轨退出闭锁）+ 开屏锚顶。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import { buildStatusLines, StatusViewer } from './status-viewer.js';
import type { StatusPanelData } from './status-viewer.js';

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

/** 全量数据夹具（各缺席形测试局部覆写） */
const DATA: StatusPanelData = {
  version: '0.2.0',
  model: 'faux/test-model',
  modelCount: 3,
  sessionId: 'sess-1234567890abcdef',
  cwdLabel: 'berry-agent',
  turns: 7,
  dataDir: '/tmp/berry-home',
  theme: 'dark',
  env: [
    { key: 'BERRY_AGENT_MODEL', value: 'faux/test-model' },
    { key: 'BERRY_AGENT_DATA_DIR', value: null },
    { key: 'BERRY_AGENT_LOG_LEVEL', value: 'debug' },
  ],
};

describe('buildStatusLines 行集构造（纯函数）', () => {
  it('段序与行集：运行时（版本/模型+全集计数）→ 会话（短 id/cwd/轮次）→ 环境（数据目录/theme/env 三键）', () => {
    const lines = buildStatusLines(DATA);
    expect(lines[0]).toBe('── 运行时 ──');
    expect(lines[1]!.startsWith('版本 version')).toBe(true); // 非空断言——段首行契约位
    expect(lines[1]).toContain('0.2.0');
    // 模型行 = 当前 + 全集计数（ctrl+p 循环宇宙同源）
    const modelLine = lines.find((line) => line.startsWith('模型 model'))!;
    expect(modelLine).toContain('faux/test-model（全集 3 档）');
    // 会话段：短 id（8 字符）+ cwd 短名 + 轮次
    expect(lines).toContain('── 会话 ──');
    expect(lines.some((line) => line.startsWith('会话 session') && line.includes('sess-123'))).toBe(true);
    expect(lines.some((line) => line.startsWith('工作区 cwd') && line.endsWith('berry-agent'))).toBe(true);
    expect(lines.some((line) => line.startsWith('轮次 turns') && line.endsWith('7'))).toBe(true);
    // 环境段：数据目录 + theme 档
    expect(lines).toContain('── 环境 ──');
    expect(lines.some((line) => line.startsWith('数据目录 dataDir') && line.includes('/tmp/berry-home'))).toBe(true);
    expect(lines.some((line) => line.startsWith('主题 theme') && line.endsWith('dark'))).toBe(true);
    // env 三键：设值原样、缺席「未设」
    expect(lines.some((line) => line.startsWith('BERRY_AGENT_MODEL') && line.includes('faux/test-model'))).toBe(true);
    expect(lines.some((line) => line.startsWith('BERRY_AGENT_DATA_DIR') && line.includes('未设'))).toBe(true);
    expect(lines.some((line) => line.startsWith('BERRY_AGENT_LOG_LEVEL') && line.includes('debug'))).toBe(true);
  });

  it('缺席诚实形：dataDir null = :memory: 诊断形行；modelCount 0 = 模型目录空注记', () => {
    const lines = buildStatusLines({ ...DATA, dataDir: null, modelCount: 0 });
    expect(lines.some((line) => line.startsWith('数据目录 dataDir') && line.includes(':memory:'))).toBe(true);
    expect(lines.find((line) => line.startsWith('模型 model'))!).toContain('模型目录空');
  });

  it('标签对齐按显示宽（CJK 双宽标签 + 值列同列起）', () => {
    const lines = buildStatusLines(DATA);
    const versionLine = lines.find((line) => line.startsWith('版本 version'))!;
    const themeLine = lines.find((line) => line.startsWith('主题 theme'))!;
    // 两标签同为「宽度 4 CJK + 空格 + ASCII」——值列起始列一致（码元 padEnd 会右凸 1 格）
    expect(versionLine.indexOf('0')).toBe(themeLine.indexOf('d'));
  });
});

describe('StatusViewer 副屏件', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  it('落位：头行（会话短 id）+ 首段行集 + 底行提示；开屏锚顶（长内容 offset 0）', () => {
    const viewer = new StatusViewer({ data: DATA, onExit: () => {} });
    const grid = new CellGrid(60, Math.max(3, viewer.measure(60)));
    viewer.render(grid, { row: 0, col: 0, width: 60, height: grid.rows });
    expect(readRow(grid, 0, 60)).toBe('◉ 状态汇总 · 会话 sess-123');
    expect(readRow(grid, 1, 60)).toBe('── 运行时 ──'); // 开屏锚顶——首段是第一行（贴尾语义被 scrollToTop 破）
    expect(readRow(grid, grid.rows - 1, 60)).toBe('q/esc 返回 · ↑↓/pgup/pgdn/home/end 滚动');
    expect(viewer.scrollOffset).toBe(0); // 全量行集超出视口——锚顶律直锁
  });

  it('q 退出（key 轨 + text 轨两形）——闭锁单次', () => {
    const onExit = vi.fn();
    const viewer = new StatusViewer({ data: DATA, onExit });
    expect(viewer.handleEvent(k('q'))).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(viewer.handleEvent({ kind: 'text', text: 'q' } as InputEvent)).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1); // 闭锁——竞发防御
  });

  it('Esc 同 q 退出', () => {
    const onExit = vi.fn();
    const viewer = new StatusViewer({ data: DATA, onExit });
    viewer.handleEvent(k('escape'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C = 打断在飞（收会话 id 透传）不退屏', () => {
    const onExit = vi.fn();
    const onInterrupt = vi.fn();
    const viewer = new StatusViewer({ data: DATA, onExit, onInterrupt });
    viewer.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-1234567890abcdef');
    expect(onExit).not.toHaveBeenCalled(); // 打断不退副屏
  });

  it('Ctrl+D = 先收副屏再转退出柄（两柄都到、序 = exit 先）', () => {
    const calls: string[] = [];
    const viewer = new StatusViewer({
      data: DATA,
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    viewer.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });

  it('未消费键终局吞（模态独占）——enter 不逃逸', () => {
    const viewer = new StatusViewer({ data: DATA, onExit: () => {} });
    expect(viewer.handleEvent(k('enter'))).toBe(true);
  });
});
