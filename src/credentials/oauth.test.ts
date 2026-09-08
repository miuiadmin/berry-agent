/**
 * oauth 流件测试（c-6——03 §10.9 oauth 案）。
 *
 * 零真网络铁律：fetch 全程脚本化假身（应答队列按序消费 + 调用记录断言）；
 * clock/sleep 同注入（sleep 即推进假钟——确定性轮询节奏断言）。
 *
 * 覆盖面：
 *  - device-code 编舞（RFC 8628）：成功路（pending→success + present 文案 +
 *    form 字段断言）/ slow_down 提速降频 / access_denied → DENIED /
 *    expired_token 与超窗 → EXPIRED / 载荷坏形·传输错 → FLOW_FAILED；
 *  - refresh 换新：成功（无新 refresh token 复用旧值形）/ invalid_grant →
 *    EXPIRED / 传输错 → FLOW_FAILED；
 *  - 流注册表：(pluginId,name) 分键后写胜出 / invoke 宿主回调窗包裹
 *    （异常路径同样合窗）/ resolveOAuthFlow 四形（唯一流自动/歧义/缺席/指名）。
 */
import { describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';
import {
  runDeviceCodeFlow,
  refreshOAuthToken,
  createOAuthFlowRegistry,
  resolveOAuthFlow,
  type OAuthFetchLike,
  type OAuthFlowDef,
} from './oauth.js';

/** 测试流声明（端点形断言用真词面） */
const DEF: OAuthFlowDef = {
  name: 'github',
  deviceAuthUrl: 'https://github.example/login/device/code',
  tokenUrl: 'https://github.example/login/oauth/access_token',
  clientId: 'client-abc',
  scopes: ['repo', 'gist'],
};

/** 脚本化应答（json 形——body 即 JSON.stringify；text 形直出裸文） */
type Scripted = { readonly ok: boolean; readonly status: number; readonly json?: unknown; readonly text?: string };

/**
 * 脚本化假 fetch：应答按序消费（队尽 = 测试配置错响亮 throw）；调用记录
 * （url + form 解析后字段）供断言。
 */
function scriptedFetch(
  script: readonly Scripted[],
): OAuthFetchLike & { calls: Array<{ url: string; body: Record<string, string> }> } {
  const calls: Array<{ url: string; body: Record<string, string> }> = [];
  let index = 0;
  const fn = (async (url: string, init?: { readonly body?: string }) => {
    if (index >= script.length) throw new Error(`脚本应答队尽（第 ${index + 1} 次调用无应答——测试配置错）`);
    const s = script[index++]!;
    calls.push({ url, body: Object.fromEntries(new URLSearchParams(init?.body ?? '')) });
    return {
      ok: s.ok,
      status: s.status,
      text: async () => (s.text !== undefined ? s.text : JSON.stringify(s.json ?? {})),
    };
  }) as OAuthFetchLike;
  return Object.assign(fn, { calls });
}

/** 假钟（sleep 即推进——轮询节奏确定性断言） */
function fakeClock(startMs = 0): { now: () => number; sleep: (ms: number) => Promise<void>; sleeps: number[] } {
  let at = startMs;
  const sleeps: number[] = [];
  return {
    now: () => at,
    sleep: (ms) => {
      at += ms;
      sleeps.push(ms);
      return Promise.resolve();
    },
    sleeps,
  };
}

/** BaseError 断言速记（码 + message 关键词） */
async function expectCode(fn: () => Promise<unknown>, code: string, keyword?: string): Promise<BaseError> {
  try {
    await fn();
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    const base = err as BaseError;
    expect(base.code).toBe(code);
    if (keyword !== undefined) expect(base.message).toContain(keyword);
    return base;
  }
  throw new Error(`期望抛 ${code}——未抛`);
}

describe('runDeviceCodeFlow（RFC 8628 编舞）', () => {
  it('成功路：发起 form 字段齐 + present 用户 + pending 续轮后 200 产 token', async () => {
    const fetch = scriptedFetch([
      {
        ok: true,
        status: 200,
        json: {
          device_code: 'dev-1',
          user_code: 'ABCD-1234',
          verification_uri: 'https://github.example/device',
          expires_in: 600,
          interval: 1,
        },
      },
      { ok: false, status: 400, json: { error: 'authorization_pending' } },
      { ok: true, status: 200, json: { access_token: 'at-xyz', refresh_token: 'rt-uvw', expires_in: 3600 } },
    ]);
    const clock = fakeClock();
    const presented: string[] = [];
    const grant = await runDeviceCodeFlow(DEF, {
      fetchFn: fetch,
      present: (t) => presented.push(t),
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(grant.accessToken).toBe('at-xyz');
    expect(grant.refreshToken).toBe('rt-uvw');
    // expiresAt = 成功应答时点 + expires_in（假钟：首睡 1000ms 后命中）
    expect(grant.expiresAt).toBe(1000 + 3600 * 1000);
    // 发起请求：端点 + form（client_id + scope 空格连缀——RFC 6749 §3.3）
    expect(fetch.calls[0]?.url).toBe(DEF.deviceAuthUrl);
    expect(fetch.calls[0]?.body).toEqual({ client_id: 'client-abc', scope: 'repo gist' });
    // 轮询请求：grant_type 真值 + device_code + client_id
    expect(fetch.calls[1]?.url).toBe(DEF.tokenUrl);
    expect(fetch.calls[1]?.body).toEqual({
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      device_code: 'dev-1',
      client_id: 'client-abc',
    });
    // present：验证页 + 用户码 + 有效期
    expect(presented).toHaveLength(1);
    expect(presented[0]).toContain('https://github.example/device');
    expect(presented[0]).toContain('ABCD-1234');
    // 轮询节奏：interval 1s（device 应答指定）
    expect(clock.sleeps).toEqual([1000]);
  });

  it('slow_down 提速降频（interval+5s）', async () => {
    const fetch = scriptedFetch([
      {
        ok: true,
        status: 200,
        json: { device_code: 'd', user_code: 'U', verification_uri: 'https://v', expires_in: 600, interval: 1 },
      },
      { ok: false, status: 400, json: { error: 'authorization_pending' } },
      { ok: false, status: 400, json: { error: 'slow_down' } },
      { ok: true, status: 200, json: { access_token: 'at' } },
    ]);
    const clock = fakeClock();
    const grant = await runDeviceCodeFlow(DEF, {
      fetchFn: fetch,
      present: () => undefined,
      now: clock.now,
      sleep: clock.sleep,
    });
    expect(grant.accessToken).toBe('at');
    expect(grant.expiresAt).toBeUndefined(); // 端点未给 expires_in——按不过期
    expect(clock.sleeps).toEqual([1000, 6000]); // 1s 起，slow_down 后 6s
  });

  it('access_denied → CREDENTIALS_OAUTH_DENIED', async () => {
    const fetch = scriptedFetch([
      {
        ok: true,
        status: 200,
        json: { device_code: 'd', user_code: 'U', verification_uri: 'https://v', expires_in: 600 },
      },
      { ok: false, status: 400, json: { error: 'access_denied' } },
    ]);
    const clock = fakeClock();
    await expectCode(
      () => runDeviceCodeFlow(DEF, { fetchFn: fetch, present: () => undefined, now: clock.now, sleep: clock.sleep }),
      'CREDENTIALS_OAUTH_DENIED',
      '拒绝',
    );
  });

  it('expired_token 与轮询超窗 → CREDENTIALS_OAUTH_EXPIRED（两形同码）', async () => {
    // 形一：端点明示 expired_token
    const fetchA = scriptedFetch([
      {
        ok: true,
        status: 200,
        json: { device_code: 'd', user_code: 'U', verification_uri: 'https://v', expires_in: 600 },
      },
      { ok: false, status: 400, json: { error: 'expired_token' } },
    ]);
    const clockA = fakeClock();
    await expectCode(
      () => runDeviceCodeFlow(DEF, { fetchFn: fetchA, present: () => undefined, now: clockA.now, sleep: clockA.sleep }),
      'CREDENTIALS_OAUTH_EXPIRED',
      'expired_token',
    );
    // 形二：expires_in 1s + pending 续轮推进假钟——下一轮询拍超窗
    const fetchB = scriptedFetch([
      {
        ok: true,
        status: 200,
        json: { device_code: 'd', user_code: 'U', verification_uri: 'https://v', expires_in: 1 },
      },
      { ok: false, status: 400, json: { error: 'authorization_pending' } },
      { ok: false, status: 400, json: { error: 'authorization_pending' } },
    ]);
    // 单一钟实例（now/sleep 必须共享同一 at——两实例各持一份则 now 恒初值永不超窗）
    const clockB = fakeClock();
    await expectCode(
      () => runDeviceCodeFlow(DEF, { fetchFn: fetchB, present: () => undefined, now: clockB.now, sleep: clockB.sleep }),
      'CREDENTIALS_OAUTH_EXPIRED',
      '轮询窗已过期',
    );
  });

  it('载荷坏形与非 200 → CREDENTIALS_OAUTH_FLOW_FAILED（发起面）', async () => {
    // 设备授权端点 500
    const fetchA = scriptedFetch([{ ok: false, status: 500, json: { error: 'server_error' } }]);
    await expectCode(
      () =>
        runDeviceCodeFlow(DEF, {
          fetchFn: fetchA,
          present: () => undefined,
          now: fakeClock().now,
          sleep: fakeClock().sleep,
        }),
      'CREDENTIALS_OAUTH_FLOW_FAILED',
      '非 200',
    );
    // 200 但四键不齐
    const fetchB = scriptedFetch([{ ok: true, status: 200, json: { device_code: 'd' } }]);
    await expectCode(
      () =>
        runDeviceCodeFlow(DEF, {
          fetchFn: fetchB,
          present: () => undefined,
          now: fakeClock().now,
          sleep: fakeClock().sleep,
        }),
      'CREDENTIALS_OAUTH_FLOW_FAILED',
      '坏形',
    );
    // 非 JSON 载荷
    const fetchC = scriptedFetch([{ ok: true, status: 200, text: '<html>not json</html>' }]);
    await expectCode(
      () =>
        runDeviceCodeFlow(DEF, {
          fetchFn: fetchC,
          present: () => undefined,
          now: fakeClock().now,
          sleep: fakeClock().sleep,
        }),
      'CREDENTIALS_OAUTH_FLOW_FAILED',
      '坏形',
    );
  });

  it('传输错（fetch 抛）与 200 缺 access_token → CREDENTIALS_OAUTH_FLOW_FAILED', async () => {
    // 发起面网络错
    const throwing: OAuthFetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    await expectCode(
      () =>
        runDeviceCodeFlow(DEF, {
          fetchFn: throwing,
          present: () => undefined,
          now: fakeClock().now,
          sleep: fakeClock().sleep,
        }),
      'CREDENTIALS_OAUTH_FLOW_FAILED',
      'ECONNREFUSED',
    );
    // token 端点 200 但缺 access_token
    const fetch = scriptedFetch([
      {
        ok: true,
        status: 200,
        json: { device_code: 'd', user_code: 'U', verification_uri: 'https://v', expires_in: 600 },
      },
      { ok: true, status: 200, json: { token_type: 'bearer' } },
    ]);
    await expectCode(
      () =>
        runDeviceCodeFlow(DEF, {
          fetchFn: fetch,
          present: () => undefined,
          now: fakeClock().now,
          sleep: fakeClock().sleep,
        }),
      'CREDENTIALS_OAUTH_FLOW_FAILED',
      '缺 access_token',
    );
  });
});

describe('refreshOAuthToken（刷新换新）', () => {
  it('成功：access_token + expires_in 折算；无新 refresh_token = 复用旧值形', async () => {
    const fetch = scriptedFetch([{ ok: true, status: 200, json: { access_token: 'at-2', expires_in: 1800 } }]);
    const grant = await refreshOAuthToken(DEF, 'rt-old', { fetchFn: fetch, now: () => 5_000 });
    expect(grant.accessToken).toBe('at-2');
    expect(grant.refreshToken).toBeUndefined();
    expect(grant.expiresAt).toBe(5_000 + 1_800_000);
    expect(fetch.calls[0]?.body).toEqual({
      grant_type: 'refresh_token',
      refresh_token: 'rt-old',
      client_id: 'client-abc',
    });
  });

  it('invalid_grant → CREDENTIALS_OAUTH_EXPIRED（授权态坏——指路重新发起）', async () => {
    const fetch = scriptedFetch([{ ok: false, status: 400, json: { error: 'invalid_grant' } }]);
    await expectCode(
      () => refreshOAuthToken(DEF, 'rt-dead', { fetchFn: fetch, now: () => 0 }),
      'CREDENTIALS_OAUTH_EXPIRED',
      'invalid_grant',
    );
  });

  it('传输错与其他非 200 → CREDENTIALS_OAUTH_FLOW_FAILED', async () => {
    const throwing: OAuthFetchLike = async () => {
      throw new Error('ETIMEDOUT');
    };
    await expectCode(
      () => refreshOAuthToken(DEF, 'rt', { fetchFn: throwing, now: () => 0 }),
      'CREDENTIALS_OAUTH_FLOW_FAILED',
      'ETIMEDOUT',
    );
    const fetch = scriptedFetch([{ ok: false, status: 500, json: { error: 'server_error' } }]);
    await expectCode(
      () => refreshOAuthToken(DEF, 'rt', { fetchFn: fetch, now: () => 0 }),
      'CREDENTIALS_OAUTH_FLOW_FAILED',
      'server_error',
    );
  });
});

describe('流注册表（host-owned）', () => {
  /** 开窗器替身（旗标语义——invoke 期间 true，异常路径 finally 合窗断言用） */
  function fakeWindow(): { open: () => boolean; opener: () => () => void } {
    let inWindow = false;
    return { open: () => inWindow, opener: () => ((inWindow = true), () => (inWindow = false)) };
  }

  it('分键 + 后写胜出：同插件同名覆写、跨插件同名不撞', () => {
    const registry = createOAuthFlowRegistry();
    const win = fakeWindow();
    const specA: Parameters<typeof registry.register>[1] = {
      def: { ...DEF, clientId: 'client-A' },
      handler: async () => undefined,
    };
    registry.register('demo', specA, win.opener);
    registry.register('demo', { def: DEF, handler: async () => undefined }, win.opener); // 同名后写胜出
    registry.register('other', specA, win.opener); // 跨插件分键
    expect(registry.get('demo', 'github')?.def.clientId).toBe('client-abc'); // 后写胜出
    expect(registry.get('other', 'github')?.def.clientId).toBe('client-A');
    expect(registry.flowsOf('demo')).toHaveLength(1);
    expect(registry.list()).toHaveLength(2);
  });

  it('invoke = 宿主回调窗包裹：handler 体内窗开、收口即合', async () => {
    const registry = createOAuthFlowRegistry();
    const win = fakeWindow();
    let seenInHandler = false;
    registry.register('demo', { def: DEF, handler: async () => void (seenInHandler = win.open()) }, win.opener);
    const flow = registry.get('demo', 'github');
    if (flow === undefined) throw new Error('流未入册');
    expect(win.open()).toBe(false); // invoke 前窗外
    await flow.invoke({ runDeviceCode: async () => ({ accessToken: 'at' }) });
    expect(seenInHandler).toBe(true); // handler 体内窗内
    expect(win.open()).toBe(false); // 收口即合
  });

  it('invoke 异常路径同样合窗（finally 语义——不拦异常只保窗）', async () => {
    const registry = createOAuthFlowRegistry();
    const win = fakeWindow();
    registry.register(
      'demo',
      {
        def: DEF,
        handler: async () => {
          throw new Error('插件 handler 故障');
        },
      },
      win.opener,
    );
    await expect(
      registry.get('demo', 'github')!.invoke({ runDeviceCode: async () => ({ accessToken: 'at' }) }),
    ).rejects.toThrow('插件 handler 故障');
    expect(win.open()).toBe(false); // 异常路径 finally 合窗
  });
});

describe('resolveOAuthFlow（人面流解析）', () => {
  const registry = createOAuthFlowRegistry();
  const win = { opener: () => () => undefined };
  registry.register('demo', { def: DEF, handler: async () => undefined }, win.opener);
  registry.register('demo', { def: { ...DEF, name: 'slack' }, handler: async () => undefined }, win.opener);

  it('指名命中', () => {
    const hit = resolveOAuthFlow(registry, 'demo', 'slack');
    expect(hit.flow?.def.name).toBe('slack');
  });

  it('指名未命中 → 指路在册流', () => {
    const miss = resolveOAuthFlow(registry, 'demo', 'gitlab');
    expect(miss.flow).toBeUndefined();
    expect(miss.message).toContain('gitlab');
    expect(miss.message).toContain('plugin:demo/github');
  });

  it('缺省名：唯一流自动选中 / 多流歧义指路 / 零流缺席', () => {
    expect(resolveOAuthFlow(registry, 'solo')!.flow).toBeUndefined(); // 零流
    expect(resolveOAuthFlow(registry, 'solo').message).toContain('未注册');
    const ambiguous = resolveOAuthFlow(registry, 'demo'); // 两流在册
    expect(ambiguous.flow).toBeUndefined();
    expect(ambiguous.message).toContain('指名其一');
    // 单流域：registry 分键天然成
    const soloReg = createOAuthFlowRegistry();
    soloReg.register('solo', { def: DEF, handler: async () => undefined }, win.opener);
    expect(resolveOAuthFlow(soloReg, 'solo').flow?.def.name).toBe('github');
  });
});
