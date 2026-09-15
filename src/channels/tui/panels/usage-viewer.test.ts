/**
 * /usage 用量副屏件测试（批 10k R7）：buildUsageLines 行集（口径注记 /
 * 千位分组 / 费用两态）直锁 + 副屏键面三件套（与 HelpViewer 同律——只锁
 * 差异面：头行文案与数据行）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { KeyEvent } from '../../engine/index.js';
import { stringWidth } from '../../engine/index.js';
import type { UiUsageSummary } from '../../../contracts/index.js';
import { buildUsageLines, UsageViewer } from './usage-viewer.js';

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

/** 汇总夹具 */
const summary = (over: Partial<UiUsageSummary> = {}): UiUsageSummary => ({
  turns: 3,
  input: 12345,
  output: 6789,
  cacheRead: 100000,
  cacheWrite: 2500,
  totalTokens: 121634,
  cost: 1.5,
  currency: 'USD',
  ...over,
});

describe('buildUsageLines 行集构造（纯函数）', () => {
  /** 标签段期望串（按显示宽补齐——批 10k 遗漏修后的真态） */
  const label = (text: string): string => text + ' '.repeat(Math.max(0, 18 - stringWidth(text)));
  it('口径注记 + 分表行（标签列 18 显示宽对齐 + 千位分组）', () => {
    const lines = buildUsageLines(summary());
    expect(lines[0]).toBe('全 run 累计（含被遮蔽重试——token 已真实花费）');
    expect(lines[2]).toBe(`${label('轮次 turns')}3`);
    expect(lines[3]).toBe(`${label('输入 input')}12,345`);
    expect(lines[4]).toBe(`${label('输出 output')}6,789`);
    expect(lines[5]).toBe(`${label('缓存读 cacheRead')}100,000`);
    expect(lines[6]).toBe(`${label('缓存写 cacheWrite')}2,500`);
    expect(lines[7]).toBe(`${label('合计 totalTokens')}121,634`);
  });

  it('费用行两态：无上报（currency null 且 cost 0）/ 四位小数 + 币种', () => {
    expect(buildUsageLines(summary({ cost: 0, currency: null }))[9]).toBe(`${label('费用 cost')}无上报`);
    expect(buildUsageLines(summary({ cost: 0.12345, currency: 'CNY' }))[9]).toBe(`${label('费用 cost')}0.1235 CNY`);
  });

  it('cost 在场而 currency 缺席 = 数值裸呈（trimEnd 不留尾随空格）', () => {
    expect(buildUsageLines(summary({ cost: 2, currency: null }))[9]).toBe(`${label('费用 cost')}2.0000`);
  });

  it('标签列按显示宽对齐（批 10k 遗漏修——padEnd 码元计量 CJK 错位 1 格）', () => {
    const lines = buildUsageLines(summary());
    // 数据行（轮次..合计）值首列显示位应恒同——标签段按显示宽补齐非码元
    const cols = lines.slice(2, 8).map((line) => {
      const value = /[\d,]+$/.exec(line)![0]!;
      return stringWidth(line.slice(0, line.length - value.length));
    });
    expect(new Set(cols).size).toBe(1);
  });
});

describe('UsageViewer 副屏件', () => {
  it('q 退出闭锁单次（key 轨 + text 轨）', () => {
    const onExit = vi.fn();
    const viewer = new UsageViewer({ sessionId: 's', summary: summary(), columns: 60, onExit });
    expect(viewer.handleEvent(k('q'))).toBe(true);
    expect(viewer.handleEvent({ kind: 'text', text: 'q' })).toBe(true);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('Ctrl+C 打断收 sessionId、Ctrl+D 先收屏再退出柄', () => {
    const onInterrupt = vi.fn();
    const calls: string[] = [];
    const viewer = new UsageViewer({
      sessionId: 'sess-9',
      summary: summary(),
      columns: 60,
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
