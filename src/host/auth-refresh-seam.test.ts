/**
 * B3 宿主凭证刷新联动腿——装配 seam 工厂测试（04 §3.3 条 8 装配面）。
 *
 * 被测 = createHostAuthRefreshSeam 装配闭包三面：env-static 前判（N2）/
 * 链句柄惰性取（缺席 = no-refresh-face 如实）/ notify M4 转换位去重
 * （expired 静默 + per-provider×outcome 进程内恰一次）。链与通知通道均
 * 结构桩（注入位即被测层）；authFamily 真 llm 源直填（行为透传断言）。
 */
import { describe, expect, it } from 'vitest';

import { HOST_NAMESPACE, type RefreshChainHandle } from '../../plugins/credentials/index.js';
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
    const seam = createHostAuthRefreshSeam({
      getChain: () => undefined,
      env: {},
      notifyChannel: channel,
      isCustomProvider: () => false,
    });
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
      isCustomProvider: () => false,
    });
    await expect(seam.refreshNow('openrouter')).resolves.toEqual({ status: 'unavailable', reason: 'env-static' });
    expect(calls).toEqual([]);
  });

  it('链缺席（受局面不起链）→ unavailable/no-refresh-face（零刷新面如实）', async () => {
    const { channel } = stubChannel();
    const seam = createHostAuthRefreshSeam({
      getChain: () => undefined,
      env: {},
      notifyChannel: channel,
      isCustomProvider: () => false,
    });
    await expect(seam.refreshNow('any-provider')).resolves.toEqual({
      status: 'unavailable',
      reason: 'no-refresh-face',
    });
  });

  it('env 未占 + 链在场 → 透传链产物（refreshed/failed/unavailable 窄形直返）', async () => {
    const { chain: okChain, calls } = stubChain({ status: 'refreshed' });
    const { channel } = stubChannel();
    const seam = createHostAuthRefreshSeam({
      getChain: () => okChain,
      env: {},
      notifyChannel: channel,
      isCustomProvider: () => false,
    });
    await expect(seam.refreshNow('glm')).resolves.toEqual({ status: 'refreshed' });
    expect(calls).toEqual(['glm']);
    const failed = stubChain({ status: 'failed', errorMessage: 'boom' });
    const seam2 = createHostAuthRefreshSeam({
      getChain: () => failed.chain,
      env: {},
      notifyChannel: channel,
      isCustomProvider: () => false,
    });
    await expect(seam2.refreshNow('glm')).resolves.toEqual({ status: 'failed', errorMessage: 'boom' });
  });

  // #13（minor——07 §8.4 豁免同步）：自定义渠道 env 不供血（绑定行唯一源），
  // env-static 前判对自定义渠道是谎报（「由环境变量供血」永不成立）——刷新面
  // 判据前加自定义渠道短路，链缺席时如实 no-refresh-face
  it('自定义渠道短路 env-static 前判（#13）：env 同名键在场不入「环境变量供血」谎报——链触达照常；官方渠道前判原样（修前红：my-gw 回 env-static）', async () => {
    const { chain, calls } = stubChain({ status: 'refreshed' });
    const { channel } = stubChannel();
    const seam = createHostAuthRefreshSeam({
      // env 面：MY_GW_API_KEY / OPENAI_API_KEY 双占位（两判据各自的触发位）
      env: { MY_GW_API_KEY: 'sk-env', OPENAI_API_KEY: 'sk-static' },
      getChain: () => chain,
      notifyChannel: channel,
      // 装配根注入位：stack.isCustomProvider 豁免集成员判据（同集单源）
      isCustomProvider: (id) => id === 'my-gw',
    });
    // 自定义渠道：env-static 不适用——链触达不受 env 前判拦截（修前红 = env-static 零链调用）
    await expect(seam.refreshNow('my-gw')).resolves.toEqual({ status: 'refreshed' });
    expect(calls).toEqual(['my-gw']);
    // 官方渠道对照面：env-static 前判原样执法（豁免同步不外溢）
    await expect(seam.refreshNow('openai')).resolves.toEqual({ status: 'unavailable', reason: 'env-static' });
    expect(calls).toEqual(['my-gw']);
    // 链缺席 + 自定义渠道 → 如实 no-refresh-face（诚实降级非 env 谎报）
    const { channel: channel2 } = stubChannel();
    const bare = createHostAuthRefreshSeam({
      env: { MY_GW_API_KEY: 'sk-env' },
      getChain: () => undefined,
      notifyChannel: channel2,
      isCustomProvider: (id) => id === 'my-gw',
    });
    await expect(bare.refreshNow('my-gw')).resolves.toEqual({ status: 'unavailable', reason: 'no-refresh-face' });
  });
});

// —— 66 轮件 H（03 §10.6 B3 条 8 批注「401 联动 env-static 前判以实际供血
// 胜者域为准」）：env-static 前判的前提（「env 静态 key = 刷新成功也不会被
// 采用」）只对 env 实际供血的形（无绑定行 / 宿主域胜者行被 env 遮蔽）成立；
// 供血胜者在插件域绑定行时该行恒透传不受 env 遮蔽——实际供血来自绑定行，
// env 在场不构成「刷新不会被采用」，前判对其是「由环境变量供血」谎报（整链
// 错杀 + 通知指路无效循环）。修形 = 前判先咨询供血胜者域探测
// （winnerNamespaceOf——装配位 stack.bindingWinnerNamespaceOf 闭包，与
// liveBindingApiKey 扫描同源单源），胜者域非宿主域即放行至链。
describe('createHostAuthRefreshSeam——env-static 前判以实际供血胜者域为准（66 轮件 H）', () => {
  it('插件域供血胜者 + env 占位 → 前判放行至链（修前红：env-static 谎报零链触达）+ 链恰调一次', async () => {
    const { chain, calls } = stubChain({ status: 'refreshed' });
    const { channel } = stubChannel();
    const seam = createHostAuthRefreshSeam({
      env: { OPENAI_API_KEY: 'sk-static' },
      getChain: () => chain,
      notifyChannel: channel,
      isCustomProvider: () => false,
      // 胜者域探测桩：openai 的供血胜者在插件域绑定行（链路活、env 非供血源）
      winnerNamespaceOf: (id) => (id === 'openai' ? 'plugin:demo' : undefined),
    });
    await expect(seam.refreshNow('openai')).resolves.toEqual({ status: 'refreshed' });
    expect(calls).toEqual(['openai']); // 链恰调一次——401 联动对活链路不再跳过刷新
  });

  it('宿主域供血胜者 + env 占位 → 仍 env-static（env 遮蔽形 env 实供血——不变锁）+ 链零调用', async () => {
    const { chain, calls } = stubChain({ status: 'refreshed' });
    const { channel } = stubChannel();
    const seam = createHostAuthRefreshSeam({
      env: { OPENAI_API_KEY: 'sk-static' },
      getChain: () => chain,
      notifyChannel: channel,
      isCustomProvider: () => false,
      winnerNamespaceOf: () => HOST_NAMESPACE,
    });
    await expect(seam.refreshNow('openai')).resolves.toEqual({ status: 'unavailable', reason: 'env-static' });
    expect(calls).toEqual([]);
  });

  it('无绑定行（探测返 undefined）+ env 占位 → env-static（env 即实际供血位——现行判维持）', async () => {
    const { chain, calls } = stubChain({ status: 'refreshed' });
    const { channel } = stubChannel();
    const seam = createHostAuthRefreshSeam({
      env: { OPENAI_API_KEY: 'sk-static' },
      getChain: () => chain,
      notifyChannel: channel,
      isCustomProvider: () => false,
      winnerNamespaceOf: () => undefined,
    });
    await expect(seam.refreshNow('openai')).resolves.toEqual({ status: 'unavailable', reason: 'env-static' });
    expect(calls).toEqual([]);
  });

  it('胜者域探测缺席（库/测试注入形向后兼容）+ env 占位 → env-static 现行判原样', async () => {
    const { chain, calls } = stubChain({ status: 'refreshed' });
    const { channel } = stubChannel();
    const seam = createHostAuthRefreshSeam({
      env: { OPENAI_API_KEY: 'sk-static' },
      getChain: () => chain,
      notifyChannel: channel,
      isCustomProvider: () => false,
      // winnerNamespaceOf 缺席——seam 不咨询胜者域，前判维持修前现行判
    });
    await expect(seam.refreshNow('openai')).resolves.toEqual({ status: 'unavailable', reason: 'env-static' });
    expect(calls).toEqual([]);
  });
});

describe('createHostAuthRefreshSeam——notify M4 转换位去重', () => {
  it('expired 形静默（链侧 wasExpired 三振 notify 已含指路——腿不重发）', () => {
    const { channel, sent } = stubChannel();
    const seam = createHostAuthRefreshSeam({
      getChain: () => undefined,
      env: {},
      notifyChannel: channel,
      isCustomProvider: () => false,
    });
    seam.notify({ provider: 'glm', outcome: { status: 'unavailable', reason: 'expired' } });
    seam.notify({ provider: 'glm', outcome: { status: 'unavailable', reason: 'expired' } });
    expect(sent).toEqual([]);
  });

  it('三无位形 per-provider×reason 进程内恰一次（跨 runTurns 重复 401 不刷屏）', () => {
    const { channel, sent } = stubChannel();
    const seam = createHostAuthRefreshSeam({
      getChain: () => undefined,
      env: {},
      notifyChannel: channel,
      isCustomProvider: () => false,
    });
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
    const seam = createHostAuthRefreshSeam({
      getChain: () => undefined,
      env: {},
      notifyChannel: channel,
      isCustomProvider: () => false,
    });
    seam.notify({ provider: 'glm', outcome: { status: 'failed', errorMessage: 'invalid_grant' } });
    seam.notify({ provider: 'glm', outcome: { status: 'failed', errorMessage: 'second-failure-tail' } });
    expect(sent).toHaveLength(1);
    expect(sent[0]![1]).toContain('invalid_grant');
    expect(sent[0]![1]).toContain('glm');
  });

  // —— TUI 第四役 finding B（minor）：联动腿判据只看 authFamily（401/403 同族
  // 同触发），文案却把触发状态写死「401」——403 实错（如 unsupported_country_
  // region_territory）仍提示「本次 401」误导排查。修复 = 状态中立化措辞
  // （AuthRefreshOutcome 不增字段——最小面）。断言对象是宿主固定模板文案。
  it('unavailable 三 reason 文案状态中立（finding B）：不含写死的触发状态「401」', () => {
    const { channel, sent } = stubChannel();
    const seam = createHostAuthRefreshSeam({
      getChain: () => undefined,
      // env-static 形同生产触发位：env 在场前判（OPENAI_API_KEY 占位）
      env: { OPENAI_API_KEY: 'sk-static' },
      notifyChannel: channel,
      isCustomProvider: () => false,
    });
    seam.notify({ provider: 'openai', outcome: { status: 'unavailable', reason: 'env-static' } });
    seam.notify({ provider: 'glm', outcome: { status: 'unavailable', reason: 'binding-absent' } });
    seam.notify({ provider: 'kimi', outcome: { status: 'unavailable', reason: 'no-refresh-face' } });
    expect(sent).toHaveLength(3);
    for (const [source, text] of sent) {
      expect(source).toBe('credentials');
      expect(text).not.toContain('401'); // 修前三文案均含字面量 401 必红
    }
    // 去谎报不丢指路：env-static 形仍指路环境变量更新
    expect(sent[0]![1]).toContain('环境变量');
  });
});
