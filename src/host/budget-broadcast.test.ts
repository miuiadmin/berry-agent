/**
 * host/budget-broadcast 测试——u-3 停靠笔（04 §5 定形注①宿主级广播件的
 * 回归锁）。
 *
 * 升格律：canAfford 恢复 watcher 自 issue 工厂私有升格宿主件——电平判语义
 * 逐字平移（有停靠项且可负担即触发；非边沿——wake 责任自摘登记，不自摘
 * 的 entry 每 tick 重复触发）。三面（issue/goal/会话级）共享同一登记面。
 *
 * 纪律：纯单元——canAfford 注假电平（可翻旗），pollMs 5ms 真定时器驱动。
 */
import { afterAll, describe, expect, it } from 'vitest';

import { createBudgetBroadcast } from './budget-broadcast.js';

/** 窄轮询 + 真定时器等待（pollMs 5 下 30ms 足跨多个 tick） */
const POLL_MS = 5;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 可翻旗日池判 */
function mutableAfford(initial: boolean): { canAfford: () => boolean; set: (v: boolean) => void } {
  let ok = initial;
  return { canAfford: () => ok, set: (v: boolean) => (ok = v) };
}

/** 广播件实例账（dispose 幂等双跑无害的观测位） */
const instances: Array<ReturnType<typeof createBudgetBroadcast>> = [];
afterAll(() => {
  for (const bc of instances) bc.dispose();
});

function rig(initial: boolean) {
  const afford = mutableAfford(initial);
  const broadcast = createBudgetBroadcast({ canAfford: afford.canAfford, pollMs: POLL_MS });
  instances.push(broadcast);
  return { afford, broadcast };
}

describe('budget-broadcast（04 §5 定形注①——宿主级广播件）', () => {
  it('电平判：登记项在场而日池尽 → 静默；翻真即唤醒（恢复判据覆盖日池翻转形）', async () => {
    const { afford, broadcast } = rig(false);
    const wakes: string[] = [];
    broadcast.register({
      wake: () => wakes.push('a'),
      dispose: () => undefined,
    });
    await sleep(30);
    expect(wakes).toEqual([]); // 日池尽静默——有停靠项不等于可触发
    afford.set(true);
    await sleep(30);
    expect(wakes.length).toBeGreaterThan(0); // 电平翻真即触发
    broadcast.dispose();
  });

  it('电平判非边沿：不自摘的 entry 每 tick 重复触发——wake 责任自摘登记（三面同律）', async () => {
    const { broadcast } = rig(true);
    let count = 0;
    broadcast.register({ wake: () => (count += 1) }); // 不自摘——电平判语义直接表达
    await sleep(30);
    expect(count).toBeGreaterThan(1); // 连续 tick 连续触发（非一次性边沿）
    broadcast.dispose();
  });

  it('unregister 摘面 + 空登记零判（canAfford 翻真也不扫）', async () => {
    const { broadcast } = rig(true);
    let count = 0;
    const entry = { wake: () => (count += 1) };
    broadcast.register(entry);
    broadcast.unregister(entry);
    await sleep(30);
    expect(count).toBe(0);
    expect(broadcast.size()).toBe(0);
    broadcast.dispose();
  });

  it('dispose：逐项 dispose?.() + 幂等双跑 + dispose 后 register 诚实抛', async () => {
    const { afford, broadcast } = rig(false);
    const disposed: string[] = [];
    broadcast.register({ wake: () => undefined, dispose: () => disposed.push('a') });
    broadcast.register({ wake: () => undefined }); // dispose 可缺席（goal 面 durable 形）
    broadcast.dispose();
    expect(disposed).toEqual(['a']); // 逐项停机收口（缺席 dispose 无害）
    broadcast.dispose(); // 幂等双跑
    afford.set(true);
    await sleep(30); // watcher 已清——无唤醒
    expect(broadcast.size()).toBe(0);
    expect(() => broadcast.register({ wake: () => undefined })).toThrow(/已 dispose/); // 装配序错位防御
  });
});
