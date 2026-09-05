/**
 * llm — per-provider 在飞计数器测试（04 §3.6：缺省 4、达帽显式拒绝、释放幂等）。
 *
 * 纯单元（无 pi-ai 依赖）：帽行为 / provider 隔离 / 双路径释放幂等 / 不限档。
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_INFLIGHT_PER_PROVIDER, InFlightTracker } from './inflight.js';

describe('InFlightTracker（达帽显式拒绝）', () => {
  it('缺省帽 = 4（DEFAULT_MAX_INFLIGHT_PER_PROVIDER）；第 5 个拒绝', () => {
    expect(DEFAULT_MAX_INFLIGHT_PER_PROVIDER).toBe(4);
    const tracker = new InFlightTracker();
    const slots = [1, 2, 3, 4].map(() => tracker.tryAcquire('p'));
    expect(slots.every((s) => s !== null)).toBe(true);
    expect(tracker.tryAcquire('p')).toBeNull();
    expect(tracker.inFlight('p')).toBe(4);
  });

  it('per-provider 隔离：p1 达帽不影响 p2 取位', () => {
    const tracker = new InFlightTracker(1);
    expect(tracker.tryAcquire('p1')).not.toBeNull();
    expect(tracker.tryAcquire('p1')).toBeNull(); // p1 达帽
    expect(tracker.tryAcquire('p2')).not.toBeNull(); // p2 独立计数
    expect(tracker.inFlight('p2')).toBe(1);
  });

  it('释放后可再取（计数回卷）', () => {
    const tracker = new InFlightTracker(1);
    const slot = tracker.tryAcquire('p');
    expect(slot).not.toBeNull();
    slot!.release();
    expect(tracker.inFlight('p')).toBe(0);
    expect(tracker.tryAcquire('p')).not.toBeNull();
  });
});

describe('释放幂等（双保险：迭代 return() 与 result() 只生效一次）', () => {
  it('重复 release 不多减（帽 1 下双释放后再取仍恰一次成功）', () => {
    const tracker = new InFlightTracker(1);
    const slot = tracker.tryAcquire('p');
    slot!.release();
    slot!.release(); // 双路径第二次——幂等
    slot!.release(); // 三次也无妨
    // 若多减会变负计数：帽 1 下应恰好又能取一次、再取拒绝
    expect(tracker.tryAcquire('p')).not.toBeNull();
    expect(tracker.tryAcquire('p')).toBeNull();
  });
});

describe('不限档（max <= 0）', () => {
  it('恒成功且不计数；release 无操作', () => {
    const tracker = new InFlightTracker(0);
    const a = tracker.tryAcquire('p');
    const b = tracker.tryAcquire('p');
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    a!.release();
    expect(tracker.inFlight('p')).toBe(0); // 不计数
  });
});
