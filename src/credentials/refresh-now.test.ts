/**
 * refreshNow targeted 强刷测试（B3 联动半——03 §10.9 refreshNow 条 / 04 §3.3
 * 条 8；立项档 §三裁决四三律）。
 *
 * 真库全环（refresh.test 同形：临时目录库 + ephemeralSecretKey +
 * CREDENTIALS_MIGRATION 链）+ 流注册表真身 + 脚本化/手动放行 fetch + 可推进
 * 假钟（mock 只停模型层——refresh 流是外部 OAuth 端点，桩在流注册表/fetch
 * 注入位合法，参照既有 refresh 测试体例）。
 *
 * 覆盖面（裁决四三律 + 立项档 §五之 1 竞态合流半 / 之 7 三振共账）：
 *  - targeted 强刷：绕 5min 提前量门（挂钟 tick 对同一行零动作、refreshNow
 *    照发）+ 成功尾共账（rotate 审计 seam + failures 随整列换清零 + 绑定键
 *    附加键保全）；
 *  - 不可行形（fail-closed 响亮——向调用方表达不可行非静默跳过）：绑定行
 *    缺席 / 无刷新面（无 refreshName、无 expiresAt〔refreshOne :90 同形不
 *    归链管——B3 冷读 N5 定形〕、对应 oauth 流未注册）/ expired 告示位在案
 *    ——一律零 fetch 零三振动作；
 *  - 绑定行撞终权（B3 冷读 M5 落码批定形）：host 域行优先 + 插件域两行撞取
 *    namespace 字典序稳定首行 + warn 留痕；
 *  - per-flow 单飞（RFC 6749 §6 refresh token 单次使用互废防护——§五.1 竞态
 *    合流半）：并发两 refreshNow 同凭证合流恰一次 refresh POST；refreshNow
 *    与挂钟 tick 同窗两序（各先起飞一序）合流；
 *  - 三振共账（§五.7）：refreshNow 失败计 failures durable、与挂钟失败跨源
 *    连续计数、三振 notify 转换位不刷屏（挂钟续败只 warn、refreshNow 报
 *    expired 不再 POST）、invalid_grant 直落、值保留律。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
// seam 形状真源（04 §3.3 条 8 契约笔在他 lane 的 conversation/types.ts）——
// type-only import 不进运行面（拓扑两账分离豁免 *.test.*；types 是「三名」
// 公开面之一——本导入只做结构兼容编译锁，不破 credentials → contracts+persist 边）
import type { AuthRefreshOutcome } from '../conversation/types.js';
import { HOST_NAMESPACE, pluginNamespace, type CredentialMeta } from './types.js';
import { CREDENTIALS_MIGRATION } from './migration.js';
import { createOAuthFlowRegistry, type OAuthFetchLike, type OAuthFlowDef, type OAuthFlowRegistry } from './oauth.js';
import { createRefreshChain, type RefreshChainHandle, type RefreshNowOutcome } from './refresh.js';

/**
 * seam 结构兼容锁（编译期）：件内窄形 outcome 可赋 seam 宽形
 * AuthRefreshOutcome（窄三 reason ⊂ 宽四 reason——'env-static' 归宿主装配
 * 根闭包判，件内不产）。host 装配位 `chain.refreshNow` 直填 seam.refreshNow
 * 的赋值形由此型锁保证。
 */
const widenOutcome: (outcome: RefreshNowOutcome) => AuthRefreshOutcome = (outcome) => outcome;

let dir: string;
let stores: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-cred-refresh-now-test-'));
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 开真库（credentials v7 表在场） */
function openTestStore(): Store {
  const store = openStore({
    dbPath: join(dir, 'refresh-now.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
    migrations: [CREDENTIALS_MIGRATION],
  });
  stores.push(store);
  return store;
}

/** 测试流声明（token 端点 = 刷新腿消费的唯一点；词面中性无品牌） */
const FLOW_NAME = 'models';
const DEF: OAuthFlowDef = {
  name: FLOW_NAME,
  deviceAuthUrl: 'https://acme.example/oauth/device',
  tokenUrl: 'https://acme.example/oauth/token',
  clientId: 'client-x',
};

/** 脚本化应答（refresh.test 同形） */
type Scripted = {
  readonly ok: boolean;
  readonly status: number;
  readonly json?: unknown;
  readonly text?: string;
};

function scriptedFetch(script: readonly Scripted[]): OAuthFetchLike & { calls: unknown[] } {
  const calls: unknown[] = [];
  let index = 0;
  const fn = (async (_url: string) => {
    if (index >= script.length) throw new Error(`脚本应答队尽（第 ${index + 1} 次——测试配置错）`);
    const s = script[index++]!;
    calls.push(s);
    return {
      ok: s.ok,
      status: s.status,
      text: async () => (s.text !== undefined ? s.text : JSON.stringify(s.json ?? {})),
    };
  }) as OAuthFetchLike;
  return Object.assign(fn, { calls });
}

/**
 * 手动放行 fetch（refresh.test 同形——「refresh 在飞窗」的开与关全由测试
 * 驱动，全确定性无 sleep；单飞合流观察窗专用）。
 */
function deferredFetch(): {
  readonly fetch: OAuthFetchLike & { readonly calls: readonly unknown[] };
  readonly settle: (s: Scripted) => void;
} {
  const calls: unknown[] = [];
  let release: ((s: Scripted) => void) | undefined;
  const fn = (async (url: string) => {
    return new Promise<{ ok: boolean; status: number; text: () => Promise<string> }>((resolvePromise) => {
      calls.push(url);
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

/** 可推进假钟 */
function fakeClock(startMs = 0): { now: () => number; advance: (ms: number) => void } {
  let at = startMs;
  return { now: () => at, advance: (ms) => (at += ms) };
}

/**
 * 装配速记：真库 + 流注册表（可指定注册流的插件 id 集——撞绑案多插件）+
 * 链（notify/warn 收集器内置）。
 */
function rig(opts?: {
  readonly script?: readonly Scripted[];
  /** 外供 fetch（单飞合流观察窗专用——deferredFetch 产物直入；与 script 互斥） */
  readonly fetchFn?: OAuthFetchLike & { readonly calls: readonly unknown[] };
  /** 注册流的插件 id 集（缺省 ['demo']；空数组 = 全不注册——流未注册案用） */
  readonly plugins?: readonly string[];
}): {
  store: Store;
  registry: OAuthFlowRegistry;
  chain: RefreshChainHandle;
  fetch: OAuthFetchLike & { readonly calls: readonly unknown[] };
  clock: ReturnType<typeof fakeClock>;
  notifies: string[];
  warns: string[];
  changed: Array<{ namespace: string; name: string; action: string; origin: string }>;
} {
  const store = openTestStore();
  const registry = createOAuthFlowRegistry();
  for (const id of opts?.plugins ?? ['demo']) {
    registry.register(id, { def: DEF, handler: async () => undefined }, () => () => undefined);
  }
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
  });
  return { store, registry, chain, fetch, clock, notifies, warns, changed };
}

/**
 * 401 形底座主行速写：meta.modelProvider 绑定键 + refresh 行在场；缺省
 * expiresAt 远未到 5min 提前量（证 targeted 绕门）——到期形（合流/三振案）
 * 显式给 expiresAt: 1_000。
 */
function seedBound(
  store: Store,
  o?: {
    readonly pluginId?: string;
    readonly namespace?: string;
    readonly apiKey?: string;
    readonly expiresAt?: number;
    readonly failures?: number;
    readonly expired?: boolean;
    readonly noRefreshName?: boolean;
    readonly noExpiresAt?: boolean;
    readonly noModelProvider?: boolean;
  },
): { readonly ns: string; readonly name: string } {
  const ns = o?.namespace ?? pluginNamespace(o?.pluginId ?? 'demo');
  const meta: CredentialMeta = {
    source: 'oauth',
    ...(o?.noModelProvider ? {} : { modelProvider: 'acme' }),
    ...(o?.noRefreshName ? {} : { refreshName: 'models.refresh' }),
    ...(o?.noExpiresAt ? {} : { expiresAt: o?.expiresAt ?? 60 * 60 * 1000 }),
    ...(o?.failures !== undefined ? { failures: o.failures } : {}),
    ...(o?.expired ? { expired: true } : {}),
  };
  store.setCredential(ns, FLOW_NAME, { apiKey: o?.apiKey ?? 'at-old', meta });
  if (!o?.noRefreshName) {
    store.setCredential(ns, 'models.refresh', { apiKey: 'rt-old', meta: { source: 'oauth' } });
  }
  return { ns, name: FLOW_NAME };
}

describe('seam 结构兼容锁（件内窄形 ⊂ conversation 面宽形）', () => {
  it('三态结算均可经 widen 填入 AuthRefreshOutcome 位（编译期型锁的运行侧见证）', () => {
    expect(widenOutcome({ status: 'refreshed' }).status).toBe('refreshed');
    expect(widenOutcome({ status: 'unavailable', reason: 'expired' }).status).toBe('unavailable');
    expect(widenOutcome({ status: 'failed', errorMessage: 'upstream 5xx' }).status).toBe('failed');
  });
});

describe('targeted 强刷（裁决四·1——绕提前量门）与成功尾共账（·3）', () => {
  it('挂钟未到提前量零动作；refreshNow 照发并 rotate（failures 清零 + 绑定键保全 + 审计 seam）', async () => {
    const r = rig({ script: [{ ok: true, status: 200, json: { access_token: 'at-new', expires_in: 3600 } }] });
    seedBound(r.store, { expiresAt: 60 * 60 * 1000, failures: 2 }); // 远未到期 + 历史失败账
    await r.chain.tick();
    expect(r.fetch.calls).toHaveLength(0); // 挂钟腿：未到提前量不巡检（既有跳过族律不破）
    const outcome = await r.chain.refreshNow('acme');
    expect(outcome).toEqual({ status: 'refreshed' });
    expect(r.fetch.calls).toHaveLength(1); // targeted 腿：绕提前量门照发
    const row = r.store.getCredential(pluginNamespace('demo'), FLOW_NAME);
    expect(row?.apiKey).toBe('at-new');
    // 成功尾共账：failures/expired 随整列换消失；modelProvider 绑定键 = 附加键保全
    expect(row?.meta).toEqual({
      source: 'refresh',
      modelProvider: 'acme',
      refreshName: 'models.refresh',
      expiresAt: 3_600_000, // now=0 + 3600s
    });
    expect(r.changed).toEqual([
      { namespace: pluginNamespace('demo'), name: FLOW_NAME, action: 'rotate', origin: 'oauth-flow' },
    ]);
    expect(r.notifies).toEqual([]); // 成功不打扰用户
  });
});

describe('不可行形（fail-closed 响亮——向调用方表达不可行，非静默跳过）', () => {
  it('绑定行缺席（全表无 modelProvider 绑定行）→ unavailable/binding-absent，零 fetch', async () => {
    const r = rig();
    // 不种任何绑定行
    await expect(r.chain.refreshNow('acme')).resolves.toEqual({ status: 'unavailable', reason: 'binding-absent' });
    expect(r.fetch.calls).toHaveLength(0);
  });

  it('无 refreshName（单 token 形）→ unavailable/no-refresh-face，零 fetch', async () => {
    const r = rig();
    seedBound(r.store, { noRefreshName: true });
    await expect(r.chain.refreshNow('acme')).resolves.toEqual({ status: 'unavailable', reason: 'no-refresh-face' });
    expect(r.fetch.calls).toHaveLength(0);
  });

  it('有 refreshName 无 expiresAt（refreshOne :90 同形不归链管——N5 定形）→ no-refresh-face', async () => {
    const r = rig();
    seedBound(r.store, { noExpiresAt: true });
    await expect(r.chain.refreshNow('acme')).resolves.toEqual({ status: 'unavailable', reason: 'no-refresh-face' });
    expect(r.fetch.calls).toHaveLength(0);
  });

  it('流未注册（换代摘除/未装载形）→ no-refresh-face，零 fetch（死域不续刷）', async () => {
    const r = rig({ plugins: [] }); // 注册表空——绑定行在场但流不在
    seedBound(r.store, {});
    await expect(r.chain.refreshNow('acme')).resolves.toEqual({ status: 'unavailable', reason: 'no-refresh-face' });
    expect(r.fetch.calls).toHaveLength(0);
  });

  it('expired 告示位在案 → unavailable/expired——不 POST、不计三振、不 notify（位在案不重发）', async () => {
    const r = rig();
    const seeded = seedBound(r.store, { expiresAt: 1_000, failures: 3, expired: true });
    await expect(r.chain.refreshNow('acme')).resolves.toEqual({ status: 'unavailable', reason: 'expired' });
    expect(r.fetch.calls).toHaveLength(0);
    expect(r.notifies).toHaveLength(0);
    // 行整不动（值保留律——三振收敛后的告示位不被强刷腿翻案）
    expect(r.store.getCredential(seeded.ns, seeded.name)?.meta).toEqual({
      source: 'oauth',
      modelProvider: 'acme',
      refreshName: 'models.refresh',
      expiresAt: 1_000,
      failures: 3,
      expired: true,
    });
  });
});

describe('绑定行撞终权（M5 落码批定形——确定性优先链 + warn 留痕）', () => {
  it('插件域两行撞绑——namespace 字典序稳定首行胜出，另一行整不动', async () => {
    const r = rig({
      plugins: ['aaa', 'bbb'],
      script: [{ ok: true, status: 200, json: { access_token: 'at-new', expires_in: 3600 } }],
    });
    const first = seedBound(r.store, { pluginId: 'aaa', apiKey: 'at-aaa' });
    const second = seedBound(r.store, { pluginId: 'bbb', apiKey: 'at-bbb' });
    await expect(r.chain.refreshNow('acme')).resolves.toEqual({ status: 'refreshed' });
    expect(r.fetch.calls).toHaveLength(1);
    expect(r.store.getCredential(first.ns, first.name)?.apiKey).toBe('at-new'); // 首行刷新
    expect(r.store.getCredential(second.ns, second.name)?.apiKey).toBe('at-bbb'); // 落选行不动
    expect(r.warns.some((w) => w.includes('撞绑'))).toBe(true); // 歧义留痕
    expect(r.changed).toEqual([{ namespace: first.ns, name: first.name, action: 'rotate', origin: 'oauth-flow' }]);
  });

  it('host 域行优先胜出——胜出行无刷新面即如实报 no-refresh-face（fail-closed 不回落）', async () => {
    const r = rig({ plugins: ['demo'] });
    r.store.setCredential(HOST_NAMESPACE, FLOW_NAME, {
      apiKey: 'at-host',
      meta: { source: 'manual', modelProvider: 'acme' },
    });
    const pluginRow = seedBound(r.store, {});
    await expect(r.chain.refreshNow('acme')).resolves.toEqual({ status: 'unavailable', reason: 'no-refresh-face' });
    expect(r.fetch.calls).toHaveLength(0); // 胜出的 host 行无刷新面——不回落到插件域行
    expect(r.store.getCredential(pluginRow.ns, pluginRow.name)?.apiKey).toBe('at-old');
    expect(r.warns.some((w) => w.includes('撞绑'))).toBe(true);
  });
});

/* ---------------- §五.1 竞态合流半（per-flow 单飞——RFC 6749 §6） ---------------- */

describe('per-flow 单飞（refresh token 单次使用互废防护）', () => {
  it('并发两 refreshNow 同凭证 → 合流恰一次 refresh POST、两调用同结局', async () => {
    const d = deferredFetch();
    const r = rig({ fetchFn: d.fetch });
    seedBound(r.store, { expiresAt: 1_000 }); // 到期形（两路门全过）
    const first = r.chain.refreshNow('acme'); // 首班起飞——fetch 已同步到达
    expect(d.fetch.calls).toHaveLength(1);
    const second = r.chain.refreshNow('acme'); // 后到 401——须搭同一航班
    expect(d.fetch.calls).toHaveLength(1); // 未重发 POST（单次使用互废防护断言）
    d.settle({ ok: true, status: 200, json: { access_token: 'at-new', expires_in: 3600 } });
    const [outcomeFirst, outcomeSecond] = await Promise.all([first, second]);
    expect(outcomeFirst).toEqual({ status: 'refreshed' });
    expect(outcomeSecond).toEqual({ status: 'refreshed' }); // 后到者同享首班结局
    expect(d.fetch.calls).toHaveLength(1);
    expect(r.store.getCredential(pluginNamespace('demo'), FLOW_NAME)?.apiKey).toBe('at-new');
  });

  it('refreshNow 先起飞、挂钟 tick 同窗合流——两路一航班', async () => {
    const d = deferredFetch();
    const r = rig({ fetchFn: d.fetch });
    seedBound(r.store, { expiresAt: 1_000 });
    const targeted = r.chain.refreshNow('acme');
    expect(d.fetch.calls).toHaveLength(1);
    const wall = r.chain.tick(); // 挂钟整拍同窗——巡检腿须合流不叠发
    d.settle({ ok: true, status: 200, json: { access_token: 'at-new', expires_in: 3600 } });
    await Promise.all([targeted, wall]);
    expect(d.fetch.calls).toHaveLength(1); // 恰一次 refresh POST
    expect(r.store.getCredential(pluginNamespace('demo'), FLOW_NAME)?.apiKey).toBe('at-new');
  });

  it('挂钟 tick 先起飞、refreshNow 后到合流（两序各证）', async () => {
    const d = deferredFetch();
    const r = rig({ fetchFn: d.fetch });
    seedBound(r.store, { expiresAt: 1_000 });
    const wall = r.chain.tick(); // 挂钟先开拍——fetch 悬停
    expect(d.fetch.calls).toHaveLength(1);
    const targeted = r.chain.refreshNow('acme'); // 401 后到——合流进挂钟航班
    expect(d.fetch.calls).toHaveLength(1);
    d.settle({ ok: true, status: 200, json: { access_token: 'at-new', expires_in: 3600 } });
    await expect(targeted).resolves.toEqual({ status: 'refreshed' }); // 后到者享挂钟航班结局
    await wall;
    expect(d.fetch.calls).toHaveLength(1);
    expect(r.store.getCredential(pluginNamespace('demo'), FLOW_NAME)?.apiKey).toBe('at-new');
  });
});

/* ---------------- §五.7 三振共账（failures/expired/notify 一本账） ---------------- */

describe('三振共账（refreshNow 与挂钟跨源连续计数）', () => {
  /** 连续失败应答速写（500 server_error——可重试形，逐拍计账） */
  const fails = (n: number): Scripted[] =>
    Array.from({ length: n }, () => ({ ok: false, status: 500, json: { error: 'server_error' } }));

  it('refreshNow 单败：值保留 + failures durable 记一 + warn 无 notify + failed 结局', async () => {
    const r = rig({ script: fails(1) });
    seedBound(r.store, { expiresAt: 1_000 });
    const outcome = await r.chain.refreshNow('acme');
    expect(outcome.status).toBe('failed');
    expect(typeof (outcome as { errorMessage?: string }).errorMessage).toBe('string'); // 结构断言（不咬自然语句）
    const row = r.store.getCredential(pluginNamespace('demo'), FLOW_NAME);
    expect(row?.apiKey).toBe('at-old'); // 保留上次有效值
    expect(row?.meta).toEqual({
      source: 'oauth',
      modelProvider: 'acme',
      refreshName: 'models.refresh',
      expiresAt: 1_000,
      failures: 1,
    });
    expect(r.warns).toHaveLength(1);
    expect(r.notifies).toEqual([]);
  });

  it('跨源连续计数成三振：refreshNow→tick→refreshNow 同账到阈值 + notify 转换位恰一次', async () => {
    const r = rig({ script: fails(4) });
    seedBound(r.store, { expiresAt: 1_000 });
    await r.chain.refreshNow('acme'); // 第 1 败（targeted 源）
    await r.chain.tick(); // 第 2 败（挂钟源）——连续计数不因触发源清零
    await r.chain.refreshNow('acme'); // 第 3 败 = 三振（targeted 源）
    const row = r.store.getCredential(pluginNamespace('demo'), FLOW_NAME);
    expect(row?.meta).toEqual({
      source: 'oauth',
      modelProvider: 'acme',
      refreshName: 'models.refresh',
      expiresAt: 1_000,
      failures: 3,
      expired: true,
    });
    expect(r.notifies).toHaveLength(1);
    expect(r.notifies[0]).toContain('/credentials oauth demo models'); // 指路重授权
    expect(r.notifies[0]).not.toContain('at-old'); // 值不入告警文本（铁律）
    expect(r.notifies[0]).not.toContain('rt-old');
  });

  it('三振后不刷屏：挂钟续败只 warn（failures 续计）、refreshNow 报 expired 不再 POST', async () => {
    const r = rig({ script: fails(4) });
    seedBound(r.store, { expiresAt: 1_000 });
    await r.chain.refreshNow('acme'); // 第 1 败
    await r.chain.tick(); // 第 2 败
    await r.chain.refreshNow('acme'); // 第 3 败 = 三振（expired 告示位落案）
    await r.chain.tick(); // 第 4 败——挂钟续巡：warn 不重复 notify（既有 wasExpired 守卫）
    expect(r.store.getCredential(pluginNamespace('demo'), FLOW_NAME)?.meta).toEqual({
      source: 'oauth',
      modelProvider: 'acme',
      refreshName: 'models.refresh',
      expiresAt: 1_000,
      failures: 4,
      expired: true,
    });
    expect(r.warns.at(-1)).toContain('已过期告示在案');
    // targeted 腿遇告示位在案：不可形响亮拒绝——不 POST、不 notify（位不重发）
    await expect(r.chain.refreshNow('acme')).resolves.toEqual({ status: 'unavailable', reason: 'expired' });
    expect(r.fetch.calls).toHaveLength(4); // 四次 POST 全来自失败巡检——refreshNow 未叠发
    expect(r.notifies).toHaveLength(1);
  });

  it('invalid_grant 经 refreshNow 直落三振（授权态坏不空转三拍）', async () => {
    const r = rig({ script: [{ ok: false, status: 400, json: { error: 'invalid_grant' } }] });
    seedBound(r.store, { expiresAt: 1_000 });
    const outcome = await r.chain.refreshNow('acme');
    expect(outcome.status).toBe('failed');
    const row = r.store.getCredential(pluginNamespace('demo'), FLOW_NAME);
    expect(row?.meta).toEqual({
      source: 'oauth',
      modelProvider: 'acme',
      refreshName: 'models.refresh',
      expiresAt: 1_000,
      failures: 1,
      expired: true, // 首拍即三振语义
    });
    expect(r.notifies).toHaveLength(1);
    expect(r.notifies[0]).toContain('授权态坏');
  });
});
