/**
 * /usage 用量副屏件测试（批 10k R7）：buildUsageLines 行集（口径注记 /
 * 千位分组 / 费用两态）直锁 + 副屏键面三件套（与 HelpViewer 同律——只锁
 * 差异面：头行文案与数据行）。
 */
import { describe, expect, it, vi } from 'vitest';
import type { KeyEvent } from '../../engine/index.js';
import { stringWidth } from '../../engine/index.js';
import type { UiUsageSummary } from '../../../contracts/index.js';
import { buildUsageLines, formatTokensCompact, UsageViewer } from './usage-viewer.js';

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
  const label = (text: string): string => text + ' '.repeat(Math.max(0, 8 - stringWidth(text)));
  it('口径注记 + 分表行（标签列 8 显示宽对齐 + 千位分组）', () => {
    const lines = buildUsageLines(summary());
    expect(lines[0]).toBe('本会话累计（含未显示的重试——重试同样消耗 token）');
    expect(lines[2]).toBe(`${label('轮次')}3`);
    expect(lines[3]).toBe(`${label('输入')}12,345`);
    expect(lines[4]).toBe(`${label('输出')}6,789`);
    expect(lines[5]).toBe(`${label('缓存读')}100,000`);
    expect(lines[6]).toBe(`${label('缓存写')}2,500`);
    expect(lines[7]).toBe(`${label('合计')}121,634`);
  });

  it('费用行两态：无上报（currency null 且 cost 0）/ 四位小数 + 币种', () => {
    expect(buildUsageLines(summary({ cost: 0, currency: null }))[9]).toBe(`${label('费用')}无上报`);
    expect(buildUsageLines(summary({ cost: 0.12345, currency: 'CNY' }))[9]).toBe(`${label('费用')}0.1235 CNY`);
  });

  it('cost 在场而 currency 缺席 = 数值裸呈（trimEnd 不留尾随空格）', () => {
    expect(buildUsageLines(summary({ cost: 2, currency: null }))[9]).toBe(`${label('费用')}2.0000`);
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

describe('formatTokensCompact 紧凑格式（footer 行1 上下文三件套单源）', () => {
  it('三档分界 + K 档先舍入后分档：rounded 达 1000 升 M 档（修前红——999,500 显「1000 K」与 1 M 双单位并置）', () => {
    expect(formatTokensCompact(999)).toBe('999'); // <1K 原值
    expect(formatTokensCompact(1_000)).toBe('1 K'); // K 档下界
    expect(formatTokensCompact(12_345)).toBe('12 K'); // K 档千位整数
    expect(formatTokensCompact(999_499)).toBe('999 K'); // K 档上界（对照组——修前后同绿）
    expect(formatTokensCompact(999_500)).toBe('1 M'); // 修前红：Math.round(999.5)=1000 →「1000 K」
    expect(formatTokensCompact(999_999)).toBe('1 M'); // K 档顶缘（round 进 1000——升档同族）
    expect(formatTokensCompact(1_000_000)).toBe('1 M'); // M 档下界（与升档形衔接单值连续）
    expect(formatTokensCompact(1_500_000)).toBe('1.5 M'); // M 档一位小数（尾零剥除）
  });

  it('M 档无更高档：千位续形保留（1e9 显「1000 M」单档续形——非 K/M 双单位并置失真）', () => {
    // 函数现状无 G 档：M 档舍入入千位无处可升，与 1.5e9「1500 M」同族单档续形
    expect(formatTokensCompact(999_500_000)).toBe('999.5 M');
    expect(formatTokensCompact(1_000_000_000)).toBe('1000 M');
    expect(formatTokensCompact(1_500_000_000)).toBe('1500 M');
  });
});

describe('UsageViewer 副屏件', () => {
  it('q 退出闭锁单次（key 轨 + text 轨）', () => {
    const onExit = vi.fn();
    const viewer = new UsageViewer({ sessionId: 's', summary: summary(), onExit });
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
