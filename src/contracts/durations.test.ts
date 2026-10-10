/**
 * durations 单源行为锁（2026-10-04 收尾行段拼装双站单源化批）：段串接/收尾
 * 行段集/整行构造三面——段形知识（三段序/重试无「次」字/双零缺席）自双站
 * 注释收进单源后的行为锁，翻档时此锁先红。
 */
import { describe, expect, it } from 'vitest';
import { joinSegments, runRecapLine, runRecapSegments } from './durations.js';

describe('joinSegments 用户面段串接', () => {
  it('各段以「 · 」串接（前后各一空格的全角间隔号）', () => {
    expect(joinSegments('用时 1m 02s', '工具 3 次')).toBe('用时 1m 02s · 工具 3 次');
  });

  it('空串段跳过（调用侧守卫省写）', () => {
    expect(joinSegments('a', '', 'b', '')).toBe('a · b');
  });

  it('全空段 → 空串（调用侧按需省行）', () => {
    expect(joinSegments('', '')).toBe('');
  });
});

describe('runRecapSegments 收尾行段集', () => {
  it('三段序：用时/工具次数/重试——重试段无「次」字（段形随规范真源）', () => {
    expect(runRecapSegments({ durationMs: 62_000, toolCount: 3, retryCount: 2 })).toEqual([
      '用时 1m 02s',
      '工具 3 次',
      '重试 2',
    ]);
  });

  it('耗时缺席（null）→ 用时段缺席（诚实缺席不虚报）', () => {
    expect(runRecapSegments({ durationMs: null, toolCount: 1, retryCount: 0 })).toEqual(['工具 1 次']);
  });

  it('工具/重试双零 → 双段缺席（纯对话轮整行缺席的段集半边）', () => {
    expect(runRecapSegments({ durationMs: 5_000, toolCount: 0, retryCount: 0 })).toEqual(['用时 5s']);
    expect(runRecapSegments({ durationMs: null, toolCount: 0, retryCount: 0 })).toEqual([]);
  });
});

describe('runRecapSegments 部分观察加注（收尾行中途附着计数段加注形——口径披露律）', () => {
  it('partialObserved：工具/重试计数段逐段尾注「（自本次接入起算）」——耗时段恒不加注（口径分立）', () => {
    expect(runRecapSegments({ durationMs: 62_000, toolCount: 3, retryCount: 2, partialObserved: true })).toEqual([
      '用时 1m 02s',
      '工具 3 次（自本次接入起算）',
      '重试 2（自本次接入起算）',
    ]);
  });

  it('耗时缺席形（null）：计数段独场仍加注（中途附着无起点——耗时段诚实缺席）', () => {
    expect(runRecapSegments({ durationMs: null, toolCount: 1, retryCount: 0, partialObserved: true })).toEqual([
      '工具 1 次（自本次接入起算）',
    ]);
  });

  it('重试独场形：重试段带注且无「次」字（段形随规范真源）', () => {
    expect(runRecapSegments({ durationMs: null, toolCount: 0, retryCount: 1, partialObserved: true })).toEqual([
      '重试 1（自本次接入起算）',
    ]);
  });

  it('缺席 / false → 零加注（完整观察整 run 口径——向后兼容形）', () => {
    expect(runRecapSegments({ durationMs: 62_000, toolCount: 3, retryCount: 2 })).toEqual([
      '用时 1m 02s',
      '工具 3 次',
      '重试 2',
    ]);
    expect(runRecapSegments({ durationMs: 62_000, toolCount: 3, retryCount: 2, partialObserved: false })).toEqual([
      '用时 1m 02s',
      '工具 3 次',
      '重试 2',
    ]);
  });

  it('runRecapLine 整行带注（段头段尾横线包壳不变——色壳仍归调用侧）', () => {
    expect(runRecapLine({ durationMs: null, toolCount: 1, retryCount: 0, partialObserved: true })).toBe(
      '── 工具 1 次（自本次接入起算） ──',
    );
  });
});

describe('runRecapLine 收尾行整行', () => {
  it('段头段尾横线包壳 + 段串接（无色裸形——tui 侧 SGR 色壳在调用侧）', () => {
    expect(runRecapLine({ durationMs: 62_000, toolCount: 3, retryCount: 0 })).toBe('── 用时 1m 02s · 工具 3 次 ──');
  });

  it('双零防御形：空段集 → 空段头（调用侧双零判据已拦，仅防御在位）', () => {
    expect(runRecapLine({ durationMs: null, toolCount: 0, retryCount: 0 })).toBe('──  ──');
  });
});

describe('runRecapLine 文案标签门（⑧ 两级门制——挖掘 29 轮批 B 规范立法兑现）', () => {
  it('>60s 显文案段（62s 门外语照常）；恰 60s 属 ≤60s 档纯线', () => {
    expect(runRecapLine({ durationMs: 62_000, toolCount: 1, retryCount: 0 })).toBe('── 用时 1m 02s · 工具 1 次 ──');
    // 恰 60s = ≤60s（>60s 严格大于）——纯线空串
    expect(runRecapLine({ durationMs: 60_000, toolCount: 1, retryCount: 0 })).toBe('');
  });

  it('≤60s 无标签纯线（59s → 空串——修前红：旧形恒返文案）', () => {
    expect(runRecapLine({ durationMs: 59_000, toolCount: 3, retryCount: 2 })).toBe('');
  });

  it('耗时缺席（null）门不可判 → 文案段照常（诚实缺席不升级纯线——部分观察加注形可见性保位）', () => {
    expect(runRecapLine({ durationMs: null, toolCount: 1, retryCount: 0, partialObserved: true })).toBe(
      '── 工具 1 次（自本次接入起算） ──',
    );
  });
});
