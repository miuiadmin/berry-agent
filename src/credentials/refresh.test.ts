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
 *    expiresAt 新值）+ 附加键保全（主行与刷新行同律——轮换动刷新行时插件
 *    自记 meta 键不抹掉）+ 新 refresh token 才动刷新行 +
 *    审计 seam rotate/oauth-flow + 值不入 notify/warn 文本；
 *  - 失败保留旧值：值不动 failures++ durable；三振 notify-once（第四拍
 *    不重复告警——wasExpired 守卫）；
 *  - 授权态坏直落三振：invalid_grant（EXPIRED 码）与 refresh 行缺席
 *    两形——首拍即 expired + notify（不空转三拍）；
 *  - 重入护栏：上一拍未收口跳过本拍；start/stop 自驱（假钟推进）；
 *  - 刷新窗与消费读交织（B3 行为锁半——竞态窗口锁）：deferred fetch 由
 *    测试手动放行（全确定性，无 sleep），锁「refresh 在飞窗内消费面恒读
 *    完整旧三元组 / rotate 收口即原子换新（一次读见旧一次读见新、无撕裂
 *    中间态）/ 失败收口保持完整旧值 / 流在飞期间 rotate 收口后 401 时刻
 *    读到的恒为完整新值或完整旧值」。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import type { CredentialsCommandStore } from './commands.js';
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
 * 手动放行 fetch（B3 竞态窗锁专用）：调用即入悬停（不自动 resolve），
 * 应答由测试在任意时刻 settle——「refresh 在飞窗」的开与关全由测试驱动，
 * 全确定性（无 sleep/无真挂钟等待；与 scriptedFetch 的 stall 形分立——
 * stall 永不放行只能观察护栏，本件可放行可编舞收口相位）。
 * 调用链同步性：refreshOne → refreshOAuthToken → fetchFn 全同步到达
 * （首个 await 在 fetch 结果上），故 tick() 返回时 settle 句柄已就绪。
 */
function deferredFetch(): {
  readonly fetch: OAuthFetchLike & { readonly calls: readonly unknown[] };
  /** 放行本次应答（应答形体与 scriptedFetch 同构；未开窗调用即编舞错） */
  readonly settle: (s: Scripted) => void;
} {
  const calls: unknown[] = [];
  let release: ((s: Scripted) => void) | undefined;
  const fn = (async (url: string) => {
    return new Promise<{ ok: boolean; status: number; text: () => Promise<string> }>((resolvePromise) => {
      calls.push(url);
      // resolve 句柄交测试持有——settle 即放行（一次调用配一次放行）
      release = (s: Scripted) =>
        resolvePromise({
          ok: s.ok,
          status: s.status,
          text: async () => (s.text !== undefined ? s.text : JSON.stringify(s.json ?? {})),
        });
    });
  }) as OAuthFetchLike;
  const fetch = Object.assign(fn, { calls });
  return {
    fetch,
    settle: (s: Scripted) => {
      if (release === undefined) throw new Error('settle 早于 fetch 调用——测试编舞错');
      release(s);
    },
  };
}

/**
 * 消费面读一致性断言（B3 竞态窗锁的判据单源）：行完整在场且恰为期望整行
 * （值 + meta 全键 toEqual）——undefined/半刷新撕裂形（新值配旧 meta、
 * meta 键丢失、值清空）任一都在此红。
 */
function expectRow(
  row: { readonly apiKey: string; readonly meta?: unknown } | undefined,
  expected: { readonly apiKey: string; readonly meta: CredentialMeta },
): void {
  expect(row).toBeDefined();
  expect(row?.apiKey).toBe(expected.apiKey);
  expect(row?.meta).toEqual(expected.meta);
}

/**
 * 装配速记：真库 + 单流域注册表 + 链（notify/warn 收集器内置）。
 * 返回 rig 全件供逐案驱动。
 */
function rig(opts?: {
  readonly aheadMs?: number;
  readonly maxFailures?: number;
  readonly script?: readonly Scripted[];
  /** 外供 fetch（B3 竞态窗锁专用——deferredFetch 产物直入；与 script 互斥） */
  readonly fetchFn?: OAuthFetchLike & { readonly calls: readonly unknown[] };
}): {
  store: Store;
  registry: OAuthFlowRegistry;
  chain: RefreshChainHandle;
  /** fetch 面（scripted/外供同形——calls 只读面消费） */
  fetch: OAuthFetchLike & { readonly calls: readonly unknown[] };
  clock: ReturnType<typeof fakeClock>;
  notifies: string[];
  warns: string[];
  changed: Array<{ namespace: string; name: string; action: string; origin: string }>;
} {
  const store = openTestStore();
  const registry = createOAuthFlowRegistry();
  registry.register('demo', { def: DEF, handler: async () => undefined }, () => () => undefined);
  const fetch = opts?.fetchFn ?? scriptedFetch(opts?.script ?? []);
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

  it('轮换动刷新行时附加键保全（主行同形——插件自记 meta 键不因链写抹掉）', async () => {
    const r = rig({
      script: [
        { ok: true, status: 200, json: { access_token: 'at-2', refresh_token: 'rt-rotated', expires_in: 1800 } },
      ],
    });
    seedMain(r.store, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000 } });
    // 刷新行携带插件 oauth handler 自记附加键（写窗内 ctx.secrets.set 自决 meta
    // ——SDK 契约不禁止附加键；RFC 6749 §6 轮换形端点常态触发刷新行换新）
    r.store.setCredential(pluginNamespace('demo'), 'github.refresh', {
      apiKey: 'rt-old',
      meta: { source: 'oauth', account: 'alice@example.com' },
    });
    await r.chain.tick();
    const refreshRow = r.store.getCredential(pluginNamespace('demo'), 'github.refresh');
    expect(refreshRow?.apiKey).toBe('rt-rotated'); // token 值本身照换（轮换语义不变）
    // 附加键保全：refresh 行 meta 只换链管 source 键，account 键不得被整列抹掉
    expect(refreshRow?.meta).toEqual({ source: 'refresh', account: 'alice@example.com' });
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

/* ---------------- rotate 两笔写序（03 §10.9 定形——先刷新行后主行） ---------------- */

describe('rotate 两笔写序（先刷新行后主行——03 §10.9 定形补笔：第二笔失败可自愈）', () => {
  const NS = pluginNamespace('demo');

  it('第二笔（主行）写失败：新 refresh token 已 durable 落刷新行——下一拍自愈不落 EXPIRED（修前红：先主行序下主行写先抛，刷新行写永不达——新 refresh token 仅存内存即丢、旧 token 已被服务端作废，下一拍 invalid_grant 直落不可恢复）', async () => {
    const real = openTestStore();
    // 两拍应答：① 轮换形 grant（端点下发新 refresh token）② 自愈拍（经新
    // refresh token 换得新 access token——不带 refresh_token 即不动刷新行）
    const fetch = scriptedFetch([
      { ok: true, status: 200, json: { access_token: 'at-new', refresh_token: 'rt-rotated', expires_in: 1800 } },
      { ok: true, status: 200, json: { access_token: 'at-healed' } },
    ]);
    // 毒化写面：主行位写新 access token（'at-new'）即抛——模拟第二笔独立
    // autocommit 失败（磁盘满/锁竞争/进程中断同族）。判别键 = 值（失败保留
    // 旧值写的是 'at-old'、刷新行写的是 'rt-rotated'、自愈拍写的是
    // 'at-healed'——均不触毒，毒恰只落在「rotate 主行写」这一笔上）
    const poisoned: CredentialsCommandStore = {
      getCredential: (ns, name) => real.getCredential(ns, name),
      setCredential: (ns, name, entry) => {
        if (entry.apiKey === 'at-new') throw new Error('模拟主行写失败（第二笔 autocommit 失败形）');
        real.setCredential(ns, name, entry);
      },
      deleteCredential: (ns, name) => real.deleteCredential(ns, name),
      listCredentialProviders: () => real.listCredentialProviders(),
    };
    const registry = createOAuthFlowRegistry();
    registry.register('demo', { def: DEF, handler: async () => undefined }, () => () => undefined);
    const notifies: string[] = [];
    const chain = createRefreshChain({
      store: poisoned,
      registry,
      fetchFn: fetch,
      now: () => 0,
      notify: (message) => notifies.push(message),
      warn: () => undefined,
    });
    // 种子行走真库（毒化面只拦 'at-new' 写——种子 'at-old'/'rt-old' 直落）
    seedMain(real, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000 } });
    real.setCredential(NS, 'github.refresh', { apiKey: 'rt-old', meta: { source: 'oauth' } });

    // 第一拍：轮换应答到达 → 第二笔（主行）写抛 → 失败保留旧值收拍
    await chain.tick();
    // 核心断言（写序定形执法）：新 refresh token 已 durable 落刷新行——修前
    // 红（先主行序）：主行写先抛，刷新行写永不达，本读仍是旧值 'rt-old'
    expect(real.getCredential(NS, 'github.refresh')?.apiKey).toBe('rt-rotated');
    // 主行保留旧 access token（铁律）+ 记一败（可重试形——不落 EXPIRED 位）
    const row = real.getCredential(NS, 'github');
    expect(row?.apiKey).toBe('at-old');
    expect((row?.meta as CredentialMeta).failures).toBe(1);
    expect((row?.meta as CredentialMeta).expired).not.toBe(true);

    // 第二拍自愈：新 refresh token 换得新 access token——不落「旧 token 已被
    // 服务端作废 → invalid_grant 一拍直落 EXPIRED」的不可恢复形
    await chain.tick();
    const healed = real.getCredential(NS, 'github');
    expect(healed?.apiKey).toBe('at-healed');
    expect((healed?.meta as CredentialMeta).expired).not.toBe(true);
    expect(notifies).toEqual([]); // 全程无三振告警（授权态未坏）
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

  it('挂钟拍零 unhandled rejection + 记账异常 warn 留痕（H1 治本随迁：失败记账写已在 flight catch 体内包防御壳——异常折「记账异常」warn 不再穿透 tick 整拍；修前谱 = 记账写穿透 catch 体 → tick 整拍 reject → void tick() 丢弃 rejected promise 落 unhandled 形，c43e50f 曾以挂钟拍收口 catch 单腿补位）', async () => {
    vi.useRealTimers(); // 真钟驱动（unref 钟不阻拍——测试在途即活）；防同文件 fake 钟泄漏
    const real = openTestStore();
    // 到期形主行 + 刷新行直种真库（毒化面只拦主行写位）
    seedMain(real, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000 } });
    real.setCredential(pluginNamespace('demo'), 'github.refresh', { apiKey: 'rt-old', meta: { source: 'oauth' } });
    // 毒化写面：主行位写即抛——失败记账写（catch 体内的 setCredential）同步
    // 抛洞穿 catch（catch 内再抛不被同 try 收）→ flight 破约 reject → tick 整拍 reject
    const poisoned: CredentialsCommandStore = {
      getCredential: (ns, name) => real.getCredential(ns, name),
      setCredential: (ns, name, entry) => {
        if (name === 'github') throw new Error('模拟记账写失败（磁盘满形）');
        real.setCredential(ns, name, entry);
      },
      deleteCredential: (ns, name) => real.deleteCredential(ns, name),
      listCredentialProviders: () => real.listCredentialProviders(),
    };
    const registry = createOAuthFlowRegistry();
    registry.register('demo', { def: DEF, handler: async () => undefined }, () => () => undefined);
    // 恒 500 应答（可重试形——逐拍走失败记账写位）
    const fetchFn = (async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'server_error' }),
    })) as OAuthFetchLike;
    const warns: string[] = [];
    const chain = createRefreshChain({
      store: poisoned,
      registry,
      fetchFn,
      now: () => 0,
      notify: () => undefined,
      warn: (message) => warns.push(message),
    });
    // unhandled rejection 侦听面（判据一的真源）：process 级事件捕获——修前
    // 每拍一条（void tick() 丢弃 rejected promise），修后零条
    const unhandled: unknown[] = [];
    const onUnhandled = (err: unknown): void => {
      unhandled.push(err);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      chain.start(10);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 60); // 真钟数拍（10ms 间隔——多拍全落同断言面）
      });
      chain.stop();
      // 判据一：零 unhandled rejection（修前红——unhandled 数组非空）
      expect(unhandled).toEqual([]);
      // 判据二（H1 随迁）：记账异常折 warn 留痕（不静默吞——挂钟面可见性；
      // 治本后异常在 flight catch 体内收口，warn 落「记账异常」位非挂钟拍位）
      expect(warns.some((w) => w.includes('记账异常'))).toBe(true);
    } finally {
      process.off('unhandledRejection', onUnhandled);
      chain.stop();
    }
  });
});

/* ---------------- refreshNow 腿「永不 reject」契约（第七轮 H1 治本锁） ---------------- */

describe('refreshNow 腿「永不 reject」契约（记账写/notify 抛不洞穿）', () => {
  const NS = pluginNamespace('demo');

  /**
   * 毒化编舞底座（上方挂钟案 :487 同手法换消费位——消费位 = refreshNow
   * 直待而非挂钟 start）：主行绑定 modelProvider（refreshNow 解析面）+
   * 到期形 + 刷新行在库；恒 500 应答（可重试形——逐次走失败记账位）。
   * 毒面可插两形：主行记账写抛 / notify 注入形抛。
   */
  function rigPoisoned(opts?: {
    /** 三振位 notify 抛（true 时主行写不毒——单毒 notify 面；seed failures 2 使一败即三振） */
    readonly notifyThrows?: boolean;
  }): {
    readonly real: Store;
    readonly chain: RefreshChainHandle;
    readonly warns: string[];
  } {
    const real = openTestStore();
    // failures 2 预垫（notifyThrows 形一败即到阈值 3——notify 转换位必经）
    const failures = opts?.notifyThrows === true ? 2 : undefined;
    seedMain(real, {
      meta: {
        source: 'oauth',
        modelProvider: 'anthropic', // refreshNow provider→绑定行解析键
        refreshName: 'github.refresh',
        expiresAt: 1_000,
        ...(failures !== undefined ? { failures } : {}),
      },
    });
    real.setCredential(NS, 'github.refresh', { apiKey: 'rt-old', meta: { source: 'oauth' } });
    const poisoned: CredentialsCommandStore = {
      getCredential: (ns, name) => real.getCredential(ns, name),
      setCredential:
        opts?.notifyThrows === true
          ? (ns, name, entry) => real.setCredential(ns, name, entry)
          : (ns, name, entry) => {
              // 主行位写即抛——失败记账写（catch 体内 setCredential）同步抛洞穿形
              if (name === 'github') throw new Error('模拟记账写失败（磁盘满形）');
              real.setCredential(ns, name, entry);
            },
      deleteCredential: (ns, name) => real.deleteCredential(ns, name),
      listCredentialProviders: () => real.listCredentialProviders(),
    };
    const registry = createOAuthFlowRegistry();
    registry.register('demo', { def: DEF, handler: async () => undefined }, () => () => undefined);
    const fetchFn = (async () => ({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ error: 'server_error' }),
    })) as OAuthFetchLike;
    const warns: string[] = [];
    const chain = createRefreshChain({
      store: poisoned,
      registry,
      fetchFn,
      now: () => 0,
      notify:
        opts?.notifyThrows === true
          ? () => {
              throw new Error('模拟 notify 投递失败（通知面抛形）');
            }
          : () => undefined,
      warn: (message) => warns.push(message),
    });
    return { real, chain, warns };
  }

  it('失败记账写同步抛——refreshNow 不 reject 折 failed + warn 留痕（修前红：catch 体内记账写抛洞穿 flight catch 体 → 破约 reject → 下游 driver 按契约 await 无 catch 直穿）', async () => {
    const { real, chain, warns } = rigPoisoned();
    // 契约锁：refreshNow 永不 reject——修前 reject 红（本行 await 即抛）
    const outcome = await chain.refreshNow('anthropic');
    expect(outcome).toMatchObject({ status: 'failed' });
    // 记账失败折 warn 留痕（不静默吞——写面可见性）
    expect(warns.some((w) => w.includes('记账异常'))).toBe(true);
    // 主行保留旧值：记账写未落（值与三振账均未动，下拍重计——不自欺计数）
    expect(real.getCredential(NS, 'github')?.apiKey).toBe('at-old');
  });

  it('三振位 notify 同步抛——同折 failed 不洞穿（记账先落账、notify 折 warn 补位）', async () => {
    const { real, chain, warns } = rigPoisoned({ notifyThrows: true });
    const outcome = await chain.refreshNow('anthropic');
    expect(outcome).toMatchObject({ status: 'failed' });
    expect(warns.some((w) => w.includes('记账异常'))).toBe(true);
    // 记账写先于 notify——三振账已 durable（failures 3 + expired 位在案）
    const meta = real.getCredential(NS, 'github')?.meta as CredentialMeta;
    expect(meta.failures).toBe(3);
    expect(meta.expired).toBe(true);
  });
});

/* ---------------- 刷新窗与消费读交织（B3 行为锁半——竞态窗口锁） ---------------- */

describe('刷新窗与消费读交织（refresh 在飞期间消费面恒读完整行）', () => {
  /** 旧三元组（在飞窗内消费面应恒读到的完整形——account 附加键加宽撕裂检测面） */
  const OLD_META: CredentialMeta = {
    source: 'oauth',
    refreshName: 'github.refresh',
    expiresAt: 1_000,
    account: 'alice@example.com',
  };
  /** 新三元组（rotate 收口后的完整新形——source 换 refresh、到期位新、附加键保全） */
  const NEW_META: CredentialMeta = {
    source: 'refresh',
    expiresAt: 3_600_000,
    refreshName: 'github.refresh',
    account: 'alice@example.com',
  };
  const NS = pluginNamespace('demo');

  /** 造刷新到期形主行 + 刷新行（三案共用编舞底座） */
  function seedDue(r: ReturnType<typeof rig>): void {
    seedMain(r.store, { meta: OLD_META });
    r.store.setCredential(NS, 'github.refresh', { apiKey: 'rt-old', meta: { source: 'oauth' } });
  }

  it('(a) refresh 在飞窗内消费读恒得完整旧值（无 undefined/无半刷新撕裂）', async () => {
    const d = deferredFetch();
    const r = rig({ fetchFn: d.fetch });
    seedDue(r);
    const inflight = r.chain.tick(); // 开拍——挂停在 token 端点应答未决窗
    expect(d.fetch.calls).toHaveLength(1); // 在飞窗已开（调用链同步到达 fetch）
    // 窗内多次消费读（流式消费面此刻仍在用旧 token 的形态）：恒完整旧三元组
    for (let i = 0; i < 3; i++) {
      expectRow(r.store.getCredential(NS, 'github'), { apiKey: 'at-old', meta: OLD_META });
    }
    d.settle({ ok: true, status: 200, json: { access_token: 'at-new', expires_in: 3600 } });
    await inflight; // 收口（防挂死——悬停应答不释放即红）
  });

  it('(b) rotate 收口后读取原子换新：一次读见完整新值——旧值/撕裂形不可见', async () => {
    const d = deferredFetch();
    const r = rig({ fetchFn: d.fetch });
    seedDue(r);
    const inflight = r.chain.tick();
    expect(d.fetch.calls).toHaveLength(1);
    // 收口前读 = 完整旧值（换新只发生在收口点——收口前新值不可见）
    expectRow(r.store.getCredential(NS, 'github'), { apiKey: 'at-old', meta: OLD_META });
    d.settle({ ok: true, status: 200, json: { access_token: 'at-new', expires_in: 3600 } });
    await inflight; // rotate 收口
    // 收口后读 = 完整新值（整行原子换：值 + meta 全键——附加键保全、到期位新、
    // failures 随整列换消失；新值配旧 meta/键丢失的撕裂形在 expectRow 红）
    expectRow(r.store.getCredential(NS, 'github'), { apiKey: 'at-new', meta: NEW_META });
    // 刷新行未动（端点未下发新 refresh token——复用旧值律不因交织形改变）
    expect(r.store.getCredential(NS, 'github.refresh')?.apiKey).toBe('rt-old');
  });

  it('(c) refresh 失败收口后读取保持完整旧值（值不动 + failures durable 记一）', async () => {
    const d = deferredFetch();
    const r = rig({ fetchFn: d.fetch });
    seedDue(r);
    const inflight = r.chain.tick();
    expect(d.fetch.calls).toHaveLength(1);
    d.settle({ ok: false, status: 500, json: { error: 'server_error' } });
    await inflight; // 失败收口
    // 保留上次有效值律：值保持旧值完整续用，meta 只多 failures 计数键
    expectRow(r.store.getCredential(NS, 'github'), {
      apiKey: 'at-old',
      meta: { ...OLD_META, failures: 1 },
    });
  });

  it('(d) 全交织：流在飞期间 rotate 收口——401 到达时刻读到的恒为完整新值或完整旧值', async () => {
    const d = deferredFetch();
    const r = rig({ fetchFn: d.fetch });
    seedDue(r);
    // 相位一：流起飞（在飞请求此刻带出 at-old）——消费面读 = 完整旧值
    const readAtStreamStart = r.store.getCredential(NS, 'github');
    const inflight = r.chain.tick(); // 流在飞期间刷新链开拍（fetch 未决窗）
    expect(d.fetch.calls).toHaveLength(1);
    const readInRefreshWindow = r.store.getCredential(NS, 'github'); // 刷新窗内读
    d.settle({ ok: true, status: 200, json: { access_token: 'at-new', expires_in: 3600 } });
    await inflight; // rotate 在流仍在飞期间收口（旧 token 随即被上游撤销）
    // 相位二：流收 401 终值（at-old 已失效）——此刻消费面读 = 完整新值
    const readAt401 = r.store.getCredential(NS, 'github');
    // 竞态窗一致性锁：三相位读各自完整在场（无 undefined/撕裂），取值只
    // ∈ {完整旧, 完整新} 且恰在收口点翻转一次（旧→旧→新）——无中间态可见
    expectRow(readAtStreamStart, { apiKey: 'at-old', meta: OLD_META });
    expectRow(readInRefreshWindow, { apiKey: 'at-old', meta: OLD_META });
    expectRow(readAt401, { apiKey: 'at-new', meta: NEW_META });
  });
});

/* ---------------- 竞窗守卫：在飞刷新不复活已删行（第九轮 F2） ---------------- */

/**
 * 竞窗机理（第九轮 F2）：flight 起飞快照行值 → await POST 让出事件环 →
 * 人面 /credentials rm 可在窗内删行（deleteCredential 唯一撤销道）→ POST
 * 收口后无条件 setCredential（upsert）把已删行重写回库——用户撤销意图被
 * 静默推翻。修形：三写位（成功腿刷新行/主行两笔 + 失败记账腿一笔）写前
 * 查目标行在场，已删跳写 + warn 留痕（用户撤销优先）。编舞与 B3 竞态窗锁
 * 同法（deferredFetch 手动开/关窗——全确定性）。
 */
describe('竞窗守卫：刷新窗内人面 rm——收口不复活已删行（用户撤销优先）', () => {
  const NS = pluginNamespace('demo');

  /** 造到期形主行 + 刷新行（三案共用编舞底座） */
  function seedDueRow(r: ReturnType<typeof rig>): void {
    seedMain(r.store, { meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: 1_000 } });
    r.store.setCredential(NS, 'github.refresh', { apiKey: 'rt-old', meta: { source: 'oauth' } });
  }

  it('成功腿：POST 成功 + 主行窗内 rm——主行不复活 + 审计 seam 不发（修前红：行被整行写回复活 apiKey at-new）', async () => {
    const d = deferredFetch();
    const r = rig({ fetchFn: d.fetch });
    seedDueRow(r);
    const inflight = r.chain.tick();
    expect(d.fetch.calls).toHaveLength(1); // 飞行窗开（调用链同步到达 fetch）
    r.store.deleteCredential(NS, 'github'); // 人面 rm 主行（窗内）
    d.settle({ ok: true, status: 200, json: { access_token: 'at-new', expires_in: 3600 } });
    await inflight;
    // 修前红位：修前无条件 upsert 把主行写回（apiKey at-new + source refresh）
    expect(r.store.getCredential(NS, 'github')).toBeUndefined();
    expect(r.warns.some((w) => w.includes('已删除——放弃落库'))).toBe(true);
    expect(r.changed).toEqual([]); // rotate 未落主行——credentials/changed 审计不发
  });

  it('失败腿：POST 失败 + 主行窗内 rm——记账不复活 + 三振 notify 不发（修前红：行被写回复活带 failures 1）', async () => {
    const d = deferredFetch();
    const r = rig({ fetchFn: d.fetch });
    seedDueRow(r);
    const inflight = r.chain.tick();
    expect(d.fetch.calls).toHaveLength(1);
    r.store.deleteCredential(NS, 'github');
    d.settle({ ok: false, status: 500, json: { error: 'server_error' } });
    await inflight;
    // 修前红位：修前失败记账写把旧行（apiKey at-old + failures 1）整行写回
    expect(r.store.getCredential(NS, 'github')).toBeUndefined();
    expect(r.warns.some((w) => w.includes('已删除——放弃记账'))).toBe(true);
    expect(r.notifies).toEqual([]); // 行既删——三振 notify 无的放矢不发
  });

  it('成功腿刷新行半边：POST 成功 + 刷新行窗内 rm——新 refresh token 弃落不复活刷新行；主行未被删照常换新', async () => {
    const d = deferredFetch();
    const r = rig({ fetchFn: d.fetch });
    seedDueRow(r);
    const inflight = r.chain.tick();
    expect(d.fetch.calls).toHaveLength(1);
    r.store.deleteCredential(NS, 'github.refresh'); // 人面 rm 刷新行（窗内）
    d.settle({ ok: true, status: 200, json: { access_token: 'at-new', refresh_token: 'rt-rotated', expires_in: 3600 } });
    await inflight;
    expect(r.store.getCredential(NS, 'github.refresh')).toBeUndefined(); // 不复活
    expect(r.store.getCredential(NS, 'github')?.apiKey).toBe('at-new'); // 主行未被删——照常换新
    expect(r.warns.some((w) => w.includes('github.refresh') && w.includes('已删除'))).toBe(true);
    expect(r.changed).toEqual([
      { namespace: NS, name: 'github', action: 'rotate', origin: 'oauth-flow' }, // 主行 rotate 照发
    ]);
  });
});
