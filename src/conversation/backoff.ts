/**
 * turn 级 auto-retry 的退避与睡眠原语（04 §3.3 条 4）。
 *
 * 纯函数 + 可注入随机源：抖动半幅（0.5 + random·0.5）防共振错峰——
 * delay = base·2^(n-1)·(0.5 + random·0.5)，下界恒 > 0；sleep 挂驱动
 * abort signal，打断即取消重试（phase=aborted）。
 */
import type { RetryPolicyConfig } from './types.js';

/**
 * 指数退避 + 等比半幅抖动（04 §3.3 条 4 定式）。
 * @param base 基值 ms（RetryPolicyConfig.baseDelayMs）
 * @param attempt 第几次重试（1 起——指数位 n-1）
 * @param random 随机源（缺省 Math.random；测试注确定性源）
 * @returns 实延迟 ms——恒 ∈ [base·2^(n-1)·0.5, base·2^(n-1)），下界恒 > 0
 */
export function jitteredBackoff(base: number, attempt: number, random: () => number = Math.random): number {
  const scale = base * 2 ** (attempt - 1);
  return scale * (0.5 + random() * 0.5);
}

/** 按策略计算某次重试的实延迟（抖动内联——runTurns 重试腿的取值口） */
export function retryDelay(policy: RetryPolicyConfig, attempt: number, random: () => number = Math.random): number {
  return jitteredBackoff(policy.baseDelayMs, attempt, random);
}

/**
 * 可中止睡眠（退避挂 abort signal 的执法位）。
 * @param ms 时长 @param signal 中止信号（已中止/中途触发都即时收场）
 * @returns true = 睡满；false = 被中止（打断即取消重试）
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(false);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      signal!.removeEventListener('abort', onAbort);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
