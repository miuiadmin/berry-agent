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

describe('runRecapLine 收尾行整行', () => {
  it('段头段尾横线包壳 + 段串接（无色裸形——tui 侧 SGR 色壳在调用侧）', () => {
    expect(runRecapLine({ durationMs: 62_000, toolCount: 3, retryCount: 0 })).toBe('── 用时 1m 02s · 工具 3 次 ──');
  });

  it('双零防御形：空段集 → 空段头（调用侧双零判据已拦，仅防御在位）', () => {
    expect(runRecapLine({ durationMs: null, toolCount: 0, retryCount: 0 })).toBe('──  ──');
  });
});
