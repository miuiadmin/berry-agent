/**
 * rollup 纯数学件测试（桶对齐律 + 单遍聚合——零 IO 全真断言）。
 */
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import { aggregateHours, bucketClosed, DAY_MS, dayBucketMs, HOUR_MS, hourBucketMs } from './rollup.js';

/** 测试事件构造（time 必填、其余缺省） */
function ev(type: string, time: number, data?: unknown): SessionEvent<number> {
  return { type, seq: 1, time, data: data ?? {} } as SessionEvent<number>;
}

describe('桶对齐（UTC 整点/整日）', () => {
  it('hourBucketMs 下取整到小时边界（UTC——不随时区漂移）', () => {
    const base = Date.UTC(2026, 8, 7, 8, 0, 0);
    expect(hourBucketMs(base)).toBe(base);
    expect(hourBucketMs(base + 3_599_999)).toBe(base);
    expect(hourBucketMs(base + HOUR_MS)).toBe(base + HOUR_MS);
    // 负时间轴（epoch 前）同样对齐——floor 语义不破
    expect(hourBucketMs(-1)).toBe(-HOUR_MS);
  });

  it('dayBucketMs 下取整到日边界', () => {
    const day = Date.UTC(2026, 8, 7, 0, 0, 0);
    expect(dayBucketMs(day + 86_399_999)).toBe(day);
    expect(dayBucketMs(Date.UTC(2026, 8, 7, 23, 59, 59))).toBe(day);
    expect(dayBucketMs(Date.UTC(2026, 8, 8, 0, 0, 0))).toBe(day + DAY_MS);
  });

  it('bucketClosed 桶终点 <= now 判闭合（闭日物化的判据面）', () => {
    const day = Date.UTC(2026, 8, 6);
    expect(bucketClosed(day, day + DAY_MS - 1, DAY_MS)).toBe(false); // 差 1ms 未闭
    expect(bucketClosed(day, day + DAY_MS, DAY_MS)).toBe(true); // 恰过终点即闭
  });
});

describe('aggregateHours 单遍聚合', () => {
  it('全类型入计数、多桶多类型分组正确', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    const agg = aggregateHours([
      ev('user/message', h0 + 1000),
      ev('user/message', h0 + 2000),
      ev('llm/usage', h0 + 3000, { usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2 } }),
      ev('tool/result', h0 + HOUR_MS + 1000),
    ]);
    expect(agg.counts.get(h0)?.get('user/message')).toBe(2);
    expect(agg.counts.get(h0)?.get('llm/usage')).toBe(1);
    expect(agg.counts.get(h0 + HOUR_MS)?.get('tool/result')).toBe(1);
    expect(agg.touchedBuckets).toEqual(new Set([h0, h0 + HOUR_MS]));
  });

  it('usage 只认 llm/usage 型；四桶累计、可选桶缺省折 0', () => {
    const h0 = Date.UTC(2026, 8, 7, 9);
    const agg = aggregateHours([
      ev('llm/usage', h0 + 1000, { usage: { input: 10, output: 5, cacheRead: 1, cacheWrite: 2 } }),
      // 第二发不带可选桶（供应商不报）——cacheWrite1h/reasoning 折 0
      ev('llm/usage', h0 + 2000, {
        usage: { input: 100, output: 50, cacheRead: 10, cacheWrite: 20, cacheWrite1h: 7, reasoning: 3 },
      }),
      // 非用量型不进 usage 聚合
      ev('user/message', h0 + 3000),
    ]);
    expect(agg.usage.get(h0)).toEqual({
      calls: 2,
      input: 110,
      output: 55,
      cacheRead: 11,
      cacheWrite: 22,
      cacheWrite1h: 7,
      reasoning: 3,
    });
  });

  it('坏形载荷防御：非数桶值折 0、坏 data 不炸（计数仍全量）', () => {
    const h0 = Date.UTC(2026, 8, 7, 10);
    const agg = aggregateHours([
      ev('llm/usage', h0 + 1000, { usage: { input: 'x', output: 5, cacheRead: -3, cacheWrite: 2 } }),
      ev('llm/usage', h0 + 2000, null),
      ev('', h0 + 3000), // 空类型归一 (unknown)——计数不丢行
    ]);
    expect(agg.usage.get(h0)?.input).toBe(0); // 'x' 非数折 0
    expect(agg.usage.get(h0)?.cacheRead).toBe(0); // 负数折 0
    expect(agg.usage.get(h0)?.calls).toBe(2); // null data 仍计一发调用
    expect(agg.counts.get(h0)?.get('(unknown)')).toBe(1);
  });
});
