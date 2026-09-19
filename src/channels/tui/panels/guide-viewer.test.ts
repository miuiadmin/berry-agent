/**
 * /guide 快速上手参考副屏件测试（07 §8.5 第 2 条——2026-09-19 启动版本检查
 * 批）：buildGuideLines 行集（版本行首 / 段头形 / 段间空行）直锁 + 副屏键面
 * 三件套（Ctrl+C 打断 / Ctrl+D 先收屏再退出柄 / q 双轨退出闭锁）+ 落位三行
 * （头行 / 首段行 / 底行提示）与开屏锚顶。
 */
import { describe, expect, it, vi } from 'vitest';
import type { InputEvent, KeyEvent } from '../../engine/index.js';
import { CellGrid } from '../../engine/index.js';
import { buildGuideLines, GuideViewer } from './guide-viewer.js';
import type { GuidePanelData } from './guide-viewer.js';

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

/** 段集夹具（段序与文案真源在装配位——此处只锁拼接形，不锁文案内容） */
const DATA: GuidePanelData = {
  version: '0.2.0',
  sections: [
    { title: '快速上手', lines: ['输入提问，回车提交。'] },
    { title: '核心命令', lines: ['/upgrade 检查更新', '/exit 退出'] },
    { title: '升级与卸载', lines: ['berry upgrade 升级到最新版。'] },
  ],
};

describe('buildGuideLines 行集构造（纯函数）', () => {
  it('版本行居首 + 各段「── 标题 ──」分隔头 + 行集 + 段间空行', () => {
    const lines = buildGuideLines(DATA);
    expect(lines[0]).toBe('版本 version    0.2.0'); // 首行契约位（版本行先于一切段）
    expect(lines[1]).toBe('');
    expect(lines[2]).toBe('── 快速上手 ──');
    expect(lines[3]).toBe('输入提问，回车提交。');
    expect(lines[4]).toBe(''); // 段间空行
    expect(lines).toContain('── 核心命令 ──');
    expect(lines).toContain('/upgrade 检查更新');
    expect(lines[lines.length - 1]).toBe(''); // 尾段后收空行（快照末行锚）
  });

  it('空段集容受（版本行 + 空行即全集——装配位缺段形不炸）', () => {
    const lines = buildGuideLines({ version: '1.0.0', sections: [] });
    expect(lines).toEqual(['版本 version    1.0.0', '']);
  });
});

describe('GuideViewer 副屏件', () => {
  /** 读回一行（trimEnd） */
  function readRow(grid: CellGrid, row: number, width: number): string {
    let out = '';
    for (let col = 0; col < width; col++) out += grid.getCell(row, col)?.grapheme ?? ' ';
    return out.trimEnd();
  }

  it('落位：头行 + 首段行集 + 底行提示；开屏锚顶（首段是上手指引——贴尾语义反）', () => {
    const viewer = new GuideViewer({ data: DATA, sessionId: 'sess-12345678', onExit: () => {} });
    const grid = new CellGrid(60, Math.max(3, viewer.measure(60)));
    viewer.render(grid, { row: 0, col: 0, width: 60, height: grid.rows });
    expect(readRow(grid, 0, 60)).toBe('◉ 快速上手 /guide');
    expect(readRow(grid, 1, 60)).toBe('版本 version    0.2.0'); // 开屏锚顶——版本行是第一行
    expect(readRow(grid, grid.rows - 1, 60)).toBe('q/esc 返回 · ↑↓/pgup/pgdn/home/end 滚动');
    expect(viewer.scrollOffset).toBe(0);
  });

  it('q 退出（key 轨 + text 轨两形）——闭锁单次', () => {
    const onExit = vi.fn();
    const viewer = new GuideViewer({ data: DATA, sessionId: 's', onExit });
    expect(viewer.handleEvent(k('q'))).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(viewer.handleEvent({ kind: 'text', text: 'q' } as InputEvent)).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1); // 闭锁——竞发防御
  });

  it('Esc 同 q 退出', () => {
    const onExit = vi.fn();
    const viewer = new GuideViewer({ data: DATA, sessionId: 's', onExit });
    viewer.handleEvent(k('escape'));
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C = 打断在飞（收会话 id 透传）不退屏', () => {
    const onExit = vi.fn();
    const onInterrupt = vi.fn();
    const viewer = new GuideViewer({ data: DATA, sessionId: 'sess-guide-1', onExit, onInterrupt });
    viewer.handleEvent(k('c', { ctrl: true }));
    expect(onInterrupt).toHaveBeenCalledWith('sess-guide-1');
    expect(onExit).not.toHaveBeenCalled(); // 打断不退副屏
  });

  it('Ctrl+D = 先收副屏再转退出柄（两柄都到、序 = exit 先）', () => {
    const calls: string[] = [];
    const viewer = new GuideViewer({
      data: DATA,
      sessionId: 's',
      onExit: () => calls.push('exit'),
      onQuit: () => calls.push('quit'),
    });
    viewer.handleEvent(k('d', { ctrl: true }));
    expect(calls).toEqual(['exit', 'quit']);
  });

  it('未消费键终局吞（模态独占）——enter 不逃逸', () => {
    const viewer = new GuideViewer({ data: DATA, sessionId: 's', onExit: () => {} });
    expect(viewer.handleEvent(k('enter'))).toBe(true);
  });
});
