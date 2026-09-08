/**
 * oauth 刷新链测试（c-6——03 §10.9 刷新/轮换三振细则）。
 *
 * 真库全环（commands.test 同形：临时目录库 + ephemeralSecretKey +
 * CREDENTIALS_MIGRATION 链）+ 流注册表真身 + 脚本化 fetch + 可推进假钟。
 * intervalMs 0 不可达（tick 手动驱动为主——链形态测试不依赖真挂钟）。
 *
 * 覆盖面（三律 + 跳过族 + 护栏）：
 *  - 跳过族：行缺席 / 无 expiresAt（manual 静态形）/ 未到提前量 /
 *    单 token 形（无 refreshName——到期不自动续）；
 *  - 成功 rotate：主行换新（source 'refresh' + failures/expired 清位 +
 *    expiresAt 新值）+ 附加键保全 + 新 refresh token 才动刷新行 +
 *    审计 seam rotate/oauth-flow + 值不入 notify/warn 文本；
 *  - 失败保留旧值：值不动 failures++ durable；三振 notify-once（第四拍
 *    不重复告警——wasExpired 守卫）；
 *  - 授权态坏直落三振：invalid_grant（EXPIRED 码）与 refresh 行缺席
 *    两形——首拍即 expired + notify（不空转三拍）；
 *  - 重入护栏：上一拍未收口跳过本拍；start/stop 自驱（假钟推进）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { CREDENTIALS_MIGRATION } from './migration.js';
import { createOAuthFlowRegistry, type OAuthFetchLike, type OAuthFlowDef, type OAuthFlowRegistry } from './oauth.js';
import { createRefreshChain, type RefreshChainHandle } from './refresh.js';
import { pluginNamespace, type CredentialMeta } from './types.js';

let dir: string;
let stores: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-cred-refresh-test-'));
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.close();
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** 开真库（credentials v7 表在场） */
function openTestStore(): Store {
  const store = openStore({
    dbPath: join(dir, 'refresh.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
    migrations: [CREDENTIALS_MIGRATION],
  });
  stores.push(store);
  return store;
}

/** 测试流声明（token 端点 = 刷新腿消费的唯一点） */
const DEF: OAuthFlowDef = {
  name: 'github',
  deviceAuthUrl: 'https://github.example/login/device/code',
  tokenUrl: 'https://github.example/login/oauth/access_token',
  clientId: 'client-abc',
};

/**
 * 脚本化假 fetch（oauth.test 同形——应答队列按序消费；text 缺省 JSON.stringify）。
 * `stall: true` 形返回手动可控 promise（重入护栏测试用）。调用数以记录数组长度断言。
 */
type Scripted = {
  readonly ok: boolean;
  readonly status: number;
  readonly json?: unknown;
  readonly text?: string;
  readonly stall?: boolean;
};

function scriptedFetch(script: readonly Scripted[]): OAuthFetchLike & { calls: unknown[] } {
  const calls: unknown[] = [];
  let index = 0;
  const fn = (async (_url: string) => {
    if (index >= script.length) throw new Error(`脚本应答队尽（第 ${index + 1} 次——测试配置错）`);
    const s = script[index++]!;
    calls.push(s);
    if (s.stall === true) {
      // 悬停应答：resolve 永不自动——测试手动放行（重入护栏观察窗）
      return new Promise<{ ok: boolean; status: number; text: () => Promise<string> }>(() => undefined);
    }
    return {
      ok: s.ok,
      status: s.status,
      text: async () => (s.text !== undefined ? s.text : JSON.stringify(s.json ?? {})),
    };
  }) as OAuthFetchLike;
  return Object.assign(fn, { calls });
}

/** 可推进假钟 */
function fakeClock(startMs = 0): { now: () => number; advance: (ms: number) => void } {
  let at = startMs;
  return { now: () => at, advance: (ms) => (at += ms) };
}

/**
 * 装配速记：真库 + 单流域注册表 + 链（notify/warn 收集器内置）。
 * 返回 rig 全件供逐案驱动。
 */
function rig(opts?: {
  readonly aheadMs?: number;
  readonly maxFailures?: number;
  readonly script?: readonly Scripted[];
}): {
  store: Store;
  registry: OAuthFlowRegistry;
  chain: RefreshChainHandle;
  fetch: ReturnType<typeof scriptedFetch>;
  clock: ReturnType<typeof fakeClock>;
  notifies: string[];
  warns: string[];
  changed: Array<{ namespace: string; name: string; action: string; origin: string }>;
} {
  const store = openTestStore();
  const registry = createOAuthFlowRegistry();
  registry.register('demo', { def: DEF, handler: async () => undefined }, () => () => undefined);
  const fetch = scriptedFetch(opts?.script ?? []);
  const clock = fakeClock();
  const notifies: string[] = [];
  const warns: string[] = [];
  const changed: Array<{ namespace: string; name: string; action: string; origin: string }> = [];
  const chain = createRefreshChain({
    store,
    registry,
    fetchFn: fetch,
    now: clock.now,
    notify: (message) => notifies.push(message),
    warn: (message) => warns.push(message),
    onCredentialChanged: (payload) => changed.push(payload),
    ...(opts?.aheadMs !== undefined ? { aheadMs: opts.aheadMs } : {}),
    ...(opts?.maxFailures !== undefined ? { maxFailures: opts.maxFailures } : {}),
  });
  return { store, registry, chain, fetch, clock, notifies, warns, changed };
}

/** 主行速写（缺省 = 到期待刷形：expiresAt 已入提前量） */
function seedMain(store: Store, entry: { readonly apiKey?: string; readonly meta: CredentialMeta }): void {
  store.setCredential(pluginNamespace('demo'), 'github', { apiKey: entry.apiKey ?? 'at-old', meta: entry.meta });
}

describe('跳过族（不归链管的行——零 fetch）', () => {
  it('行缺席（未授权过）', async () => {
    const r = rig();
    await r.chain.tick();
    expect(r.fetch.calls).toHaveLength(0);
  });

  it('无 expiresAt（manual/静态形）', async () => {
    const r = rig();
    seedMain(r.store, { meta: { source: 'manual', refreshName: 'github.refresh' } });
    await r.chain.tick();
    expect(r.fetch.calls).toHaveLength(0);
  });

  it('未到提前量（expiresAt 远）', async () => {
    const r = rig({ aheadMs: 5 * 60 * 1000 });
    seedMain(r.store, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 60 * 60 * 1000 } });
    await r.chain.tick();
    expect(r.fetch.calls).toHaveLength(0);
  });

  it('单 token 形（无 refreshName——到期不自动续）', async () => {
    const r = rig();
    seedMain(r.store, { meta: { source: 'oauth', expiresAt: 1_000 } }); // 已过期仍跳
    await r.chain.tick();
    expect(r.fetch.calls).toHaveLength(0);
  });
});

describe('成功 rotate（三律一）', () => {
  it('主行换新全环：source refresh + 链键清位 + expiresAt 新值 + 附加键保全 + 审计 seam', async () => {
    const r = rig({ script: [{ ok: true, status: 200, json: { access_token: 'at-new', expires_in: 3600 } }] });
    seedMain(r.store, {
      meta: {
        source: 'oauth',
        refreshName: 'github.refresh',
        expiresAt: 1_000,
        failures: 2, // 历史失败计数——rotate 后清零
        account: 'alice@example.com', // 插件自记附加键——保全
      },
    });
    r.store.setCredential(pluginNamespace('demo'), 'github.refresh', { apiKey: 'rt-old', meta: { source: 'oauth' } });
    await r.chain.tick();

    const row = r.store.getCredential(pluginNamespace('demo'), 'github');
    expect(row?.apiKey).toBe('at-new');
    expect(row?.meta).toEqual({
      source: 'refresh',
      expiresAt: 3_600_000, // now=0 + 3600s
      refreshName: 'github.refresh',
      account: 'alice@example.com', // 附加键保全（failures 随整列换消失）
    });
    // 刷新行未动（端点未下发新 refresh token——复用旧值律）
    expect(r.store.getCredential(pluginNamespace('demo'), 'github.refresh')?.apiKey).toBe('rt-old');
    // 审计 seam 载荷（05 §1.1：刷新轮换 = rotate/oauth-flow）
    expect(r.changed).toEqual([
      { namespace: pluginNamespace('demo'), name: 'github', action: 'rotate', origin: 'oauth-flow' },
    ]);
    expect(r.notifies).toEqual([]); // 成功不打扰用户
  });

  it('端点下发新 refresh token（≠旧值）才动刷新行', async () => {
    const r = rig({
      script: [
        { ok: true, status: 200, json: { access_token: 'at-2', refresh_token: 'rt-rotated', expires_in: 1800 } },
      ],
    });
    seedMain(r.store, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000 } });
    r.store.setCredential(pluginNamespace('demo'), 'github.refresh', { apiKey: 'rt-old', meta: { source: 'oauth' } });
    await r.chain.tick();
    expect(r.store.getCredential(pluginNamespace('demo'), 'github.refresh')?.apiKey).toBe('rt-rotated');
  });

  it('端点未给 expires_in——保留旧到期位（?? 兜底）', async () => {
    const r = rig({ script: [{ ok: true, status: 200, json: { access_token: 'at-2' } }] });
    seedMain(r.store, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 42_000 } });
    r.store.setCredential(pluginNamespace('demo'), 'github.refresh', { apiKey: 'rt-old', meta: { source: 'oauth' } });
    await r.chain.tick();
    const row = r.store.getCredential(pluginNamespace('demo'), 'github');
    expect(row?.meta).toEqual({ source: 'refresh', expiresAt: 42_000, refreshName: 'github.refresh' });
  });
});

describe('失败保留旧值（三律二）与三振（三律三）', () => {
  it('单败：值不动 + failures durable 记一 + warn 一条 + 无 notify', async () => {
    const r = rig({ script: [{ ok: false, status: 500, json: { error: 'server_error' } }] });
    seedMain(r.store, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000 } });
    r.store.setCredential(pluginNamespace('demo'), 'github.refresh', { apiKey: 'rt-old', meta: { source: 'oauth' } });
    await r.chain.tick();
    const row = r.store.getCredential(pluginNamespace('demo'), 'github');
    expect(row?.apiKey).toBe('at-old'); // 保留上次有效值
    expect(row?.meta).toEqual({ source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000, failures: 1 });
    expect(r.warns).toHaveLength(1);
    expect(r.warns[0]).toContain('第 1 次');
    expect(r.notifies).toEqual([]);
  });

  it('三振 notify-once：第三拍置 expired + notify 指路；第四拍不重复告警只 warn', async () => {
    const script: Scripted[] = Array.from({ length: 4 }, () => ({
      ok: false,
      status: 500,
      json: { error: 'server_error' },
    }));
    const r = rig({ script });
    seedMain(r.store, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000 } });
    r.store.setCredential(pluginNamespace('demo'), 'github.refresh', { apiKey: 'rt-old', meta: { source: 'oauth' } });
    await r.chain.tick();
    await r.chain.tick();
    await r.chain.tick(); // 第三拍 = 阈值（缺省 3）
    let row = r.store.getCredential(pluginNamespace('demo'), 'github');
    expect(row?.meta).toEqual({
      source: 'oauth',
      refreshName: 'github.refresh',
      expiresAt: 1_000,
      failures: 3,
      expired: true,
    });
    expect(r.notifies).toHaveLength(1);
    // notify 文案：指路重授权 + 值不入文本（铁律）
    expect(r.notifies[0]).toContain('/credentials oauth demo github');
    expect(r.notifies[0]).not.toContain('at-old');
    expect(r.notifies[0]).not.toContain('rt-old');
    await r.chain.tick(); // 第四拍——已 expired 行继续失败：warn 不重复 notify
    row = r.store.getCredential(pluginNamespace('demo'), 'github');
    expect((row?.meta as CredentialMeta).failures).toBe(4);
    expect(r.notifies).toHaveLength(1);
    expect(r.warns.at(-1)).toContain('已过期告示在案');
  });

  it('invalid_grant（EXPIRED 码）授权态坏——首拍直落三振', async () => {
    const r = rig({ script: [{ ok: false, status: 400, json: { error: 'invalid_grant' } }] });
    seedMain(r.store, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000 } });
    r.store.setCredential(pluginNamespace('demo'), 'github.refresh', { apiKey: 'rt-dead', meta: { source: 'oauth' } });
    await r.chain.tick();
    const row = r.store.getCredential(pluginNamespace('demo'), 'github');
    expect(row?.meta).toEqual({
      source: 'oauth',
      refreshName: 'github.refresh',
      expiresAt: 1_000,
      failures: 1,
      expired: true,
    });
    expect(r.notifies).toHaveLength(1);
    expect(r.notifies[0]).toContain('授权态坏');
  });

  it('refresh 行缺席（人面 rm 后）——EXPIRED 直落 + notify 指路', async () => {
    const r = rig({ script: [] }); // 行缺席在读侧拦截——零 fetch
    seedMain(r.store, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000 } });
    await r.chain.tick();
    const row = r.store.getCredential(pluginNamespace('demo'), 'github');
    expect(row?.meta).toEqual({
      source: 'oauth',
      refreshName: 'github.refresh',
      expiresAt: 1_000,
      failures: 1,
      expired: true,
    });
    expect(r.fetch.calls).toHaveLength(0);
    expect(r.notifies).toHaveLength(1);
    expect(r.notifies[0]).toContain('授权态坏'); // stateBroken 通用文案
    expect(r.notifies[0]).toContain('/credentials oauth demo github'); // 指路重授权
  });
});

describe('护栏与自驱', () => {
  it('重入护栏：上一拍未收口跳过本拍（零叠拍）', async () => {
    const r = rig({ script: [{ ok: true, status: 200, json: { access_token: 'at' }, stall: true }] });
    seedMain(r.store, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000 } });
    r.store.setCredential(pluginNamespace('demo'), 'github.refresh', { apiKey: 'rt', meta: { source: 'oauth' } });
    void r.chain.tick(); // 第一拍——悬停在 fetch（永不放行；不 await——挂起即护栏观察窗）
    const second = r.chain.tick(); // 重入——直接返回
    await second;
    expect(r.fetch.calls).toHaveLength(1); // 第二拍未叠请求
  });

  it('start/stop 自驱：假钟推进触发巡检，stop 幂等', async () => {
    vi.useFakeTimers();
    const r = rig({ script: [{ ok: true, status: 200, json: { access_token: 'at-2', expires_in: 3600 } }] });
    seedMain(r.store, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000 } });
    r.store.setCredential(pluginNamespace('demo'), 'github.refresh', { apiKey: 'rt', meta: { source: 'oauth' } });
    r.chain.start(1_000);
    await vi.advanceTimersByTimeAsync(1_000); // 首拍自驱触发
    expect(r.store.getCredential(pluginNamespace('demo'), 'github')?.apiKey).toBe('at-2');
    r.chain.stop();
    r.chain.stop(); // 幂等
  });
});
