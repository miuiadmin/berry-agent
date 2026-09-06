/**
 * host/signals 契约测试——信号与崩溃编舞逐路（04 §1）。
 *
 * 信号注册/终局全注入（收调用序）——零真信号零真 exit；状态机三态
 * （quiet/draining/130）全覆盖。
 */
import { describe, expect, it } from 'vitest';

import { installCrashChoreography, installSignalChoreography } from './signals.js';

/** 编舞装配速记：收注册的监听器与 exit 调用 */
function rigSignals(onGraceful: () => Promise<number | void> = async () => 0) {
  const listeners = new Map<string, () => void>();
  const exits: number[] = [];
  installSignalChoreography({
    onGraceful,
    exit: (code) => void exits.push(code),
    register: (signal, listener) => listeners.set(signal, listener),
  });
  return {
    fire: (signal: 'SIGINT' | 'SIGTERM') => listeners.get(signal)?.(),
    exits,
  };
}

describe('installSignalChoreography', () => {
  it('SIGINT① → 优雅序起（onGraceful 调用）→ 优雅码终局', async () => {
    const rig = rigSignals(async () => 0);
    rig.fire('SIGINT');
    await Promise.resolve(); // 微任务冲刷（onGraceful promise 链）
    await Promise.resolve();
    expect(rig.exits).toEqual([0]);
  });

  it('优雅序返回码直通（非 0 码如实终局）', async () => {
    const rig = rigSignals(async () => 1);
    rig.fire('SIGINT');
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.exits).toEqual([1]);
  });

  it('SIGINT② → 立即 130（明示放弃优雅——不等优雅序）', async () => {
    let graceful = false;
    const rig = rigSignals(async () => {
      await new Promise((r) => setTimeout(r, 30));
      graceful = true;
      return 0;
    });
    rig.fire('SIGINT'); // ① 优雅序起（慢）
    rig.fire('SIGINT'); // ② 立即 130
    expect(rig.exits).toEqual([130]);
    await new Promise((r) => setTimeout(r, 40)); // 优雅序后续到——不追加终局
    expect(graceful).toBe(true);
    expect(rig.exits).toEqual([130]);
  });

  it('SIGTERM → 同 SIGINT① 优雅序（serve stop 管理动词正道）', async () => {
    const rig = rigSignals();
    rig.fire('SIGTERM');
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.exits).toEqual([0]);
  });

  it('优雅窗内 SIGTERM 幂等直返（不另起第二套停机）', async () => {
    let calls = 0;
    const rig = rigSignals(async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 10));
      return 0;
    });
    rig.fire('SIGINT');
    rig.fire('SIGTERM'); // draining 态——幂等吞
    await new Promise((r) => setTimeout(r, 20));
    expect(calls).toBe(1);
    expect(rig.exits).toEqual([0]);
  });

  it('优雅序自身抛错 → 退 1（执行失败档收场）', async () => {
    const rig = rigSignals(async () => {
      throw new Error('boom');
    });
    rig.fire('SIGINT');
    await Promise.resolve();
    await Promise.resolve();
    expect(rig.exits).toEqual([1]);
  });

  it('静默窗内零信号 → 零终局（不装配不触发）', () => {
    const rig = rigSignals();
    expect(rig.exits).toEqual([]);
  });
});

describe('installCrashChoreography', () => {
  /** 崩溃编舞速记：收注册监听器 + 取证与终局序 */
  function rigCrash() {
    const listeners = new Map<string, (error: unknown) => void>();
    const order: string[] = [];
    installCrashChoreography({
      writeCrashLog: () => void order.push('crash-log'),
      exit: (code) => void order.push(`exit:${code}`),
      register: (event, listener) => listeners.set(event, listener),
    });
    return {
      fire: (event: 'uncaughtException' | 'unhandledRejection', err: unknown) => listeners.get(event)?.(err),
      order,
    };
  }

  it('uncaughtException → 先同步写 crash.log 再退 1（序执法）', () => {
    const rig = rigCrash();
    rig.fire('uncaughtException', new Error('kaboom'));
    expect(rig.order).toEqual(['crash-log', 'exit:1']);
  });

  it('unhandledRejection → 同律（非 Error 载荷包装为 Error 指向根因）', () => {
    const seen: unknown[] = [];
    const listeners = new Map<string, (error: unknown) => void>();
    installCrashChoreography({
      writeCrashLog: (err) => void seen.push(err),
      exit: () => {},
      register: (event, listener) => listeners.set(event, listener),
    });
    listeners.get('unhandledRejection')?.('raw-string');
    expect(seen[0]).toBeInstanceOf(Error);
    expect((seen[0] as Error).message).toContain('未处理拒绝');
    expect((seen[0] as Error).message).toContain('raw-string');
  });
});
