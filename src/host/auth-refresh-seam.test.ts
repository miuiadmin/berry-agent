/**
 * B3 宿主凭证刷新联动腿——装配 seam 工厂测试（04 §3.3 条 8 装配面）。
 *
 * 被测 = createHostAuthRefreshSeam 装配闭包三面：env-static 前判（N2）/
 * 链句柄惰性取（缺席 = no-refresh-face 如实）/ notify M4 转换位去重
 * （expired 静默 + per-provider×outcome 进程内恰一次）。链与通知通道均
 * 结构桩（注入位即被测层）；authFamily 真 llm 源直填（行为透传断言）。
 */
import { describe, expect, it } from 'vitest';

import type { RefreshChainHandle } from '../credentials/index.js';
import { authFamily } from '../llm/index.js';
import { createHostAuthRefreshSeam } from './auth-refresh-seam.js';

/** 结构桩链：refreshNow 计数 + 可配置结局（窄三 reason 形与真件同构） */
function stubChain(
  outcome:
    | { status: 'refreshed' }
    | { status: 'unavailable'; reason: 'binding-absent' | 'no-refresh-face' | 'expired' }
    | { status: 'failed'; errorMessage?: string },
): { chain: RefreshChainHandle; calls: string[] } {
  const calls: string[] = [];
  const chain = {
    refreshNow: async (provider: string) => {
      calls.push(provider);
      return outcome;
    },
  } as unknown as RefreshChainHandle;
  return { chain, calls };
}

/** 通道桩：source+message 收集（去重断言面） */
function stubChannel(): { channel: (s: 'credentials', m: string) => void; sent: Array<[string, string]> } {
  const sent: Array<[string, string]> = [];
  return { channel: (s, m) => sent.push([s, m]), sent };
}

describe('createHostAuthRefreshSeam——env-static 前判与链桥接', () => {
  it('authFamily 真源直填（llm 纯函数引用级透传——分面判定行为两立）', () => {
    const { channel } = stubChannel();
    const seam = createHostAuthRefreshSeam({ getChain: () => undefined, env: {}, notifyChannel: channel });
    expect(seam.authFamily).toBe(authFamily);
    expect(seam.authFamily('x', 'LLM_AUTH_INVALID')).toBe(true);
    expect(seam.authFamily('unrelated text')).toBe(false);
  });

  it('env 静态 key 在场 → unavailable/env-static（前判先于链触达——链零调用）', async () => {
    const { chain, calls } = stubChain({ status: 'refreshed' });
    const { channel } = stubChannel();
    const seam = createHostAuthRefreshSeam({
      // 装配根 env 面：provider 名 SNAKE 化 + _API_KEY 尾（providerApiKeyEnvNames 一般律）
      env: { OPENROUTER_API_KEY: 'sk-static' },
      getChain: () => chain,
      notifyChannel: channel,
    });
    await expect(seam.refreshNow('openrouter')).resolves.toEqual({ status: 'unavailable', reason: 'env-static' });
    expect(calls).toEqual([]);
  });

  it('链缺席（受局面不起链）→ unavailable/no-refresh-face（零刷新面如实）', async () => {
    const { channel } = stubChannel();
    const seam = createHostAuthRefreshSeam({ getChain: () => undefined, env: {}, notifyChannel: channel });
    await expect(seam.refreshNow('any-provider')).resolves.toEqual({
      status: 'unavailable',
      reason: 'no-refresh-face',
    });
  });

  it('env 未占 + 链在场 → 透传链产物（refreshed/failed/unavailable 窄形直返）', async () => {
    const { chain: okChain, calls } = stubChain({ status: 'refreshed' });
    const { channel } = stubChannel();
    const seam = createHostAuthRefreshSeam({ getChain: () => okChain, env: {}, notifyChannel: channel });
    await expect(seam.refreshNow('glm')).resolves.toEqual({ status: 'refreshed' });
    expect(calls).toEqual(['glm']);
    const failed = stubChain({ status: 'failed', errorMessage: 'boom' });
    const seam2 = createHostAuthRefreshSeam({ getChain: () => failed.chain, env: {}, notifyChannel: channel });
    await expect(seam2.refreshNow('glm')).resolves.toEqual({ status: 'failed', errorMessage: 'boom' });
  });
});

describe('createHostAuthRefreshSeam——notify M4 转换位去重', () => {
  it('expired 形静默（链侧 wasExpired 三振 notify 已含指路——腿不重发）', () => {
    const { channel, sent } = stubChannel();
    const seam = createHostAuthRefreshSeam({ getChain: () => undefined, env: {}, notifyChannel: channel });
    seam.notify({ provider: 'glm', outcome: { status: 'unavailable', reason: 'expired' } });
    seam.notify({ provider: 'glm', outcome: { status: 'unavailable', reason: 'expired' } });
    expect(sent).toEqual([]);
  });

  it('三无位形 per-provider×reason 进程内恰一次（跨 runTurns 重复 401 不刷屏）', () => {
    const { channel, sent } = stubChannel();
    const seam = createHostAuthRefreshSeam({ getChain: () => undefined, env: {}, notifyChannel: channel });
    for (let i = 0; i < 3; i++) {
      seam.notify({ provider: 'glm', outcome: { status: 'unavailable', reason: 'binding-absent' } });
    }
    // 异 reason 各一次（同 provider 不同归因独立告示）；异 provider 各一次
    seam.notify({ provider: 'glm', outcome: { status: 'unavailable', reason: 'no-refresh-face' } });
    seam.notify({ provider: 'kimi', outcome: { status: 'unavailable', reason: 'binding-absent' } });
    expect(sent).toHaveLength(3);
    expect(sent.every(([source]) => source === 'credentials')).toBe(true);
  });

  it('failed 形带 errorMessage 尾注、同 provider 恰一次', () => {
    const { channel, sent } = stubChannel();
    const seam = createHostAuthRefreshSeam({ getChain: () => undefined, env: {}, notifyChannel: channel });
    seam.notify({ provider: 'glm', outcome: { status: 'failed', errorMessage: 'invalid_grant' } });
    seam.notify({ provider: 'glm', outcome: { status: 'failed', errorMessage: 'second-failure-tail' } });
    expect(sent).toHaveLength(1);
    expect(sent[0]![1]).toContain('invalid_grant');
    expect(sent[0]![1]).toContain('glm');
  });
});
