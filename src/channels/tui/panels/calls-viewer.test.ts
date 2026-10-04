/**
 * /calls 调用台账副屏件测试（07 §4.1 B3 定形注）：callEntryLine 行段构造
 * （状态词族/重试注记/归因段/tokens 与耗时缺席形）+ buildCallsLines 行集
 * （空态句逐字/分段线/最新在前）+ 副屏收帧（头行计数与截断披露/底行提示）
 * + 键面三件套（usage-viewer 同律）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { KeyEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import type { CallsViewerEntry } from './calls-viewer.js';
import { buildCallsLines, callEntryLine, CallsViewer, formatCallStamp } from './calls-viewer.js';

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

/** 本地分量时戳（呈现本地时形——构造用本地分量保跨机确定，session-picker 同律） */
const stamp = (h: number, m: number): number => new Date(2026, 9, 5, h, m).getTime();

/** 条目夹具 */
const entry = (over: Partial<CallsViewerEntry> = {}): CallsViewerEntry => ({
  time: stamp(14, 32),
  model: 'anthropic/claude-sonnet-5',
  status: 'stop',
  attempt: 1,
  tokens: 12345,
  ...over,
});

describe('formatCallStamp 时刻短形', () => {
  it('MM-DD HH:mm 本地时（feedback-viewer formatFeedbackStamp 同形自持）', () => {
    expect(formatCallStamp(new Date(2026, 8, 5, 9, 7).getTime())).toBe('09-05 09:07');
    expect(formatCallStamp(new Date(2026, 11, 31, 23, 59).getTime())).toBe('12-31 23:59');
  });
});

describe('callEntryLine 行段构造（纯函数）', () => {
  it('主对话基线：时刻 · 模型短名 · 状态词 · tokens 短形 · 耗时诚实缺席「—」', () => {
    expect(callEntryLine(entry())).toBe('10-05 14:32 · claude-sonnet-5 · 完成 · 12 K · —');
  });

  it('状态词族五档：完成/调工具/截断/失败/中止（toolUse 档显「调工具」）', () => {
    expect(callEntryLine(entry({ status: 'toolUse' }))).toContain('· 调工具 ·');
    expect(callEntryLine(entry({ status: 'length' }))).toContain('· 截断 ·');
    expect(callEntryLine(entry({ status: 'aborted' }))).toContain('· 中止 ·');
    const failed = callEntryLine(entry({ status: 'error', errorMessage: 'LLM_TIMEOUT 请求超时' }));
    expect(failed).toContain('· 失败 ·');
    expect(failed).toContain('LLM_TIMEOUT 请求超时'); // 失败行携 errorMessage 短因段
  });

  it('重试注记：attempt>1 才显段；配对帽在场 = 第n/N次形、缺席 = 第n次形', () => {
    expect(callEntryLine(entry({ attempt: 1, maxAttempts: 3 }))).not.toContain('第'); // 首试零段
    expect(callEntryLine(entry({ attempt: 3, maxAttempts: 3 }))).toContain('第3/3次');
    expect(callEntryLine(entry({ attempt: 2 }))).toContain('第2次');
  });

  it('单发行：耗时在场必显（formatElapsedCompact 形）+ 归因段（probe → 连通测试、未知前缀原样）', () => {
    expect(callEntryLine(entry({ attribution: 'probe', tokens: 155, elapsedMs: 2345 }))).toBe(
      '10-05 14:32 · claude-sonnet-5 · 连通测试 · 完成 · 155 · 2s',
    );
    expect(callEntryLine(entry({ attribution: 'future-site', elapsedMs: 62000 }))).toContain('future-site');
    expect(callEntryLine(entry({ attribution: 'future-site', elapsedMs: 62000 }))).toContain('1m 02s');
  });

  it('缺席形：模型「—」/ tokens「—」/ 状态「—」（字段缺席不虚构）', () => {
    const line = callEntryLine({ time: stamp(14, 32), attempt: 1 });
    expect(line).toBe('10-05 14:32 · — · — · — · —');
  });

  it('模型短名 = 全形尾段（openrouter 路径式 id 取尾段——footer modelShortOf 同律）', () => {
    expect(callEntryLine(entry({ model: 'openrouter/qwen/qwen3-coder' }))).toContain('· qwen3-coder ·');
  });
});

describe('buildCallsLines 行集构造（纯函数）', () => {
  it('空态句逐字（07 §4.4 律五带下一步形）', () => {
    expect(buildCallsLines([])).toEqual(['本会话暂无模型调用——发起对话后自动记录']);
  });

  it('非空：分段线 + 条目最新在前（jobs-viewer 近期结束降序同律）', () => {
    const older = entry({
      time: stamp(14, 30),
      model: 'zai/glm-4.7',
      attribution: 'probe',
      tokens: 155,
      elapsedMs: 2345,
    });
    const lines = buildCallsLines([older, entry()]);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('── 最近调用（最新在前）──');
    expect(lines[1]).toBe('10-05 14:32 · claude-sonnet-5 · 完成 · 12 K · —'); // 最新在前
    expect(lines[2]).toBe('10-05 14:30 · glm-4.7 · 连通测试 · 完成 · 155 · 2s');
  });
});

describe('CallsViewer 副屏件（收帧断言）', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  it('落位：头行（短 id + 计数）→ 分段线 → 条目行 → 底行提示', () => {
    const viewer = new CallsViewer({
      sessionId: '1234567890abcdef',
      entries: [entry({ time: stamp(14, 30) }), entry()], // fold 产物 seq 升序（旧→新）
      onExit: () => {},
    });
    const grid = new CellGrid(72, Math.max(3, viewer.measure(72)));
    viewer.render(grid, { row: 0, col: 0, width: 72, height: grid.rows });
    expect(readRow(grid, 0, 72)).toBe('◉ 调用台账 · 12345678 · 2 条');
    expect(readRow(grid, 1, 72)).toBe('── 最近调用（最新在前）──');
    expect(readRow(grid, 2, 72)).toBe('10-05 14:32 · claude-sonnet-5 · 完成 · 12 K · —');
    expect(readRow(grid, grid.rows - 1, 72)).toBe('q/esc 返回 · ↑↓/pgup/pgdn/home/end 滚动');
  });

  it('空态帧：头行 0 条 + 空态句行', () => {
    const viewer = new CallsViewer({ sessionId: 's', entries: [], onExit: () => {} });
    const grid = new CellGrid(72, Math.max(3, viewer.measure(72)));
    viewer.render(grid, { row: 0, col: 0, width: 72, height: grid.rows });
    expect(readRow(grid, 0, 72)).toBe('◉ 调用台账 · s · 0 条');
    expect(readRow(grid, 1, 72)).toBe('本会话暂无模型调用——发起对话后自动记录');
  });

  it('截断披露：totalCount 超行集 = 「N 条（仅显示最近 50）」', () => {
    const entries = Array.from({ length: 50 }, (_v, i): CallsViewerEntry => entry({ time: stamp(14, 0) + i }));
    const viewer = new CallsViewer({ sessionId: '1234567890abcdef', entries, totalCount: 87, onExit: () => {} });
    const grid = new CellGrid(72, 4); // 头行 + 视口 2 行 + 底行——截断披露只锁头行
    viewer.render(grid, { row: 0, col: 0, width: 72, height: 4 });
    expect(readRow(grid, 0, 72)).toBe('◉ 调用台账 · 12345678 · 87 条（仅显示最近 50）');
  });

  it('q 退出闭锁单次（key 轨 + text 轨）', () => {
    const onExit = vi.fn();
    const viewer = new CallsViewer({ sessionId: 's', entries: [], onExit });
    expect(viewer.handleEvent(k('q'))).toBe(true);
    expect(viewer.handleEvent({ kind: 'text', text: 'q' })).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C 打断收 sessionId、Ctrl+D 先收屏再退出柄', () => {
    const onInterrupt = vi.fn();
    const calls: string[] = [];
    const viewer = new CallsViewer({
      sessionId: 'sess-9',
      entries: [],
      onExit: () => calls.push('exit'),
      onInterrupt,
      onQuit: () => calls.push('quit'),
    });
    viewer.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-9');
    viewer.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });
});
