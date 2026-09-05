/**
 * llm — per-provider 在飞请求计数器（04 §3.6：缺省 4）。
 *
 * 主对话流 + complete 单发 + 子代理多驱动并发是现实形态，在飞帽 = 进程内
 * 背压：达帽**显式拒绝**（不造排队口子——背压不排队爆仓）。
 *
 * 两出口同源计数（知 provider 的调用点恰两个）：
 * - createStreamFn 主对话路：达帽编码为流内 error 事件（永不抛契约保持，
 *   errorCode=LLM_INFLIGHT_LIMIT 归 transient 桶——会话层 auto-retry 退避后
 *   槽已释放重试成功，拒绝与重试天然咬合）；
 * - complete 单发路：达帽同拒——错误终态经 pi-ai 正则归 non-retryable 即刻
 *   上抛 LLM_COMPLETE_FAILED；过载期单发失败由调用方自然重试（记忆提取下轮
 *   / compaction 下次触发）。
 *
 * 释放三路保险（幂等）：消费面 for-await 自然耗尽（next() 返回 done）或中途
 * 退出（迭代 return()/throw()）、不迭代的终态路径 result() finally 兜底——
 * 任一路先到即减计数，重复调用无害。
 */

/** 在飞帽缺省值（04 §3.6：每 provider 并发上限 4） */
export const DEFAULT_MAX_INFLIGHT_PER_PROVIDER = 4;

/** 在飞名额：一次性句柄，release 幂等（多次调用只减一次） */
export interface InFlightSlot {
  release(): void;
}

/**
 * per-provider 在飞计数器（host 装配根构造一份、两出口共享传入——「唯一知
 * provider 的层」以模块内共享面形式成立，per-provider 名实相符）。
 */
export class InFlightTracker {
  /** 每 provider 在飞上限（0 = 不限） */
  private readonly max: number;
  /** provider → 当前在飞数（0 时删键防泄漏增长） */
  private readonly counts = new Map<string, number>();

  /** @param maxPerProvider 每 provider 并发上限（缺省 4，04 §3.6；0 = 不限） */
  constructor(maxPerProvider: number = DEFAULT_MAX_INFLIGHT_PER_PROVIDER) {
    this.max = maxPerProvider;
  }

  /**
   * 尝试占一个名额（达帽返回 null = 显式拒绝信号，调用方按各自出口编码错误）。
   * @param provider 供应商标识（模型解析所得）
   */
  tryAcquire(provider: string): InFlightSlot | null {
    if (this.max <= 0) return NOOP_SLOT; // 0 = 不限：恒成功且不计数
    const current = this.counts.get(provider) ?? 0;
    if (current >= this.max) return null;
    this.counts.set(provider, current + 1);
    let released = false;
    return {
      release: () => {
        if (released) return; // 幂等：迭代 return() 与 result() 双路径只生效一次
        released = true;
        const now = this.counts.get(provider) ?? 1;
        if (now <= 1) this.counts.delete(provider);
        else this.counts.set(provider, now - 1);
      },
    };
  }

  /** 当前某 provider 在飞数（诊断面/测试断言；不限档恒 0） */
  inFlight(provider: string): number {
    return this.counts.get(provider) ?? 0;
  }
}

/** 不限档的空名额（release 无操作——不计数也不减） */
const NOOP_SLOT: InFlightSlot = { release: () => undefined };
