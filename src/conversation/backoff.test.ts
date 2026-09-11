/**
 * 退避原语单测（04 §3.3 条 4 定式 + 可中止睡眠）。
 * 抖动半幅边界用注入随机源钉死（确定性——不赌 Math.random）。
 */
import { describe, it, expect } from 'vitest';
import { jitteredBackoff, retryDelay, abortableSleep } from './backoff.js';
import type { RetryPolicyConfig } from './types.js';

describe('jitteredBackoff 指数退避 + 等比半幅抖动', () => {
  it('定式：delay = base·2^(n-1)·(0.5 + random·0.5)——注入源钉上下界', () => {
    const base = 1000;
    // random=0 → 半幅下界；random→1 → 接近全幅上界（开区间）
    expect(jitteredBackoff(base, 1, () => 0)).toBe(500);
    expect(jitteredBackoff(base, 1, () => 0.999999)).toBeCloseTo(1000, 0);
    // 指数位：attempt 递增翻倍
    expect(jitteredBackoff(base, 2, () => 0)).toBe(1000);
    expect(jitteredBackoff(base, 3, () => 0)).toBe(2000);
    expect(jitteredBackoff(base, 4, () => 0.5)).toBe(6000);
  });

  it('下界恒 > 0（random 最小 0 也是半幅非零——不产零延迟忙转）', () => {
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      expect(jitteredBackoff(1, attempt, () => 0)).toBeGreaterThan(0);
    }
  });

  it('retryDelay 按策略取基值', () => {
    const policy: RetryPolicyConfig = { enabled: true, maxRetries: 3, baseDelayMs: 200 };
    expect(retryDelay(policy, 1, () => 0.5)).toBe(150);
  });
});

describe('abortableSleep 可中止睡眠', () => {
  it('睡满返回 true', async () => {
    // 时长 25ms + 阈值 20ms（绝对容差 5ms）：Node 定时器「不早于」非硬保证（libuv
    // 可提前约 1ms）+ Date.now 毫秒取整双端 ±1 + CI 慢机调度抖动——5ms 睡眠的
    // 零容差断言在 CI 必翻（run 34605274869 实测 4 < 5）；容差只放宽下界读数，
    // 「真睡了 20ms 量级而非零等返回」的语义不变
    const start = Date.now();
    expect(await abortableSleep(25)).toBe(true);
    expect(Date.now() - start).toBeGreaterThanOrEqual(20);
  });

  it('已中止信号：立即返回 false（零等待）', async () => {
    const controller = new AbortController();
    controller.abort();
    const start = Date.now();
    expect(await abortableSleep(60_000, controller.signal)).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('中途中止：即时返回 false（不等睡满）', async () => {
    const controller = new AbortController();
    const sleeping = abortableSleep(60_000, controller.signal);
    controller.abort(); // 挂起后立刻打断
    const start = Date.now();
    expect(await sleeping).toBe(false);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('无信号形：等价不可中止睡眠（退避缺省路径）', async () => {
    expect(await abortableSleep(1, undefined)).toBe(true);
  });
});
