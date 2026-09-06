/**
 * 在飞门（限流卫生件——07 §1.1 core:web 行「限流」；03 §10.3 browser 件章
 * 「导航限流与 fetch 共享同一在飞门实例」）。
 *
 * 形态：并发计数 + 满即拒（fail-fast 不排队——排队会在卫生件内积压 Promise，
 * 与超时预算相互作用产生迟到风暴；拒是可重试档，调用方自决退避）。实例经
 * 装配根共享给 browser 导航（第三消费位）——门身份即共享点，非全局单例。
 */
import { BaseError } from '../contracts/index.js';
import type { InFlightGate } from './types.js';

/** 在飞门构造（容量 ≤0 视为 1——保守钳制，配置坏形不放大并发面） */
export function createInFlightGate(capacity: number): InFlightGate {
  const effective = Math.max(1, Math.floor(capacity));
  let inFlight = 0;
  return {
    get inFlight() {
      return inFlight;
    },
    get capacity() {
      return effective;
    },
    acquire() {
      if (inFlight >= effective) {
        throw new BaseError('WEB_RATE_LIMITED', `在飞门满（并发 ${inFlight}/${effective}）——稍后重试或降低并发`);
      }
      inFlight += 1;
    },
    release() {
      // 配对义务面：release 多于 acquire 不负计数（防御调用方 bug，不 fail-loud
      // ——放门在 finally 路径，抛错会吞业务异常）
      if (inFlight > 0) inFlight -= 1;
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      this.acquire();
      try {
        return await task();
      } finally {
        this.release();
      }
    },
  };
}
