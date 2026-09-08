/**
 * credentials 读腿服务面测试（c-3——03 §2.2 第十面 / §10.9 读腿）。
 *
 * 真库全环：临时目录库 + ephemeralSecretKey + CREDENTIALS_MIGRATION 链
 * （migration.test.ts 同惯例）——工厂产出的 SecretsService 直接打真
 * persist store（compat 面即装配面：assembly 接的就是这个投影）。
 *
 * 覆盖面（执法序逐序锁）：
 *  - get 缺省/显式自域等价（不开门不审计——同物理键）；
 *  - 自域缺席拒 CREDENTIALS_NOT_FOUND（message 指路人面录入路径）；
 *  - 越域坏形拒 CREDENTIALS_NAMESPACE_DENIED（同码分流第一档）；
 *  - 未开门越域拒（message 含 opens 授予位指路——门检 verdict 原文）；
 *  - 开门后跨域读 host 域 + capability/used 审计载荷逐字段；
 *  - core: 官方件直开豁免（无 opens 也读得成）但审计照记（豁免免的是门不是账）；
 *  - 开门后越域空名同响亮拒（NOT_FOUND 且不审计——审计只记真读命中）；
 *  - set 受理窗 fail-closed（缺省/显式 false 均拒 CREDENTIALS_WRITE_WINDOW_CLOSED）；
 *  - 窗内写恒自域（物理行落 plugin:<本插件> 域）+ changed 审计载荷；
 *  - meta 整列换（非合并）；
 *  - compat 互证：persist Store 结构可赋值 CredentialsStoreFace（词面独立律）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { CREDENTIALS_MIGRATION } from './migration.js';
import {
  createSecretsFace,
  type CapabilityUsedPayload,
  type CredentialChangedPayload,
  type CredentialsStoreFace,
  type SecretsService,
} from './secrets.js';

let dir: string;
let stores: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-cred-read-test-'));
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** BaseError 码断言辅助（错码即契约）——triggers.test.ts 同形 */
function expectCode(fn: () => unknown, code: string): BaseError {
  try {
    fn();
    expect.unreachable();
  } catch (err) {
    if (err instanceof BaseError) {
      expect(err.code).toBe(code);
      return err;
    }
    throw err;
  }
}

/** 开真库（迁移链全带——credentials v7 表在场） */
function openTestStore(): Store {
  const store = openStore({
    dbPath: join(dir, 'read.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
    migrations: [CREDENTIALS_MIGRATION],
  });
  stores.push(store);
  return store;
}

/** 工厂速记（载荷收集器内置——审计 seam 断言面） */
function rigFace(options: Partial<Parameters<typeof createSecretsFace>[0]> & { store: Store }): {
  face: SecretsService;
  used: CapabilityUsedPayload[];
  changed: CredentialChangedPayload[];
} {
  const used: CapabilityUsedPayload[] = [];
  const changed: CredentialChangedPayload[] = [];
  const face = createSecretsFace({
    pluginId: 'demo',
    onCapabilityUsed: (p) => void used.push(p),
    onCredentialChanged: (p) => void changed.push(p),
    ...options,
  });
  return { face, used, changed };
}

describe('get 自域读（缺省形——物理键恒 plugin:<本插件>）', () => {
  it('自域命中返回明文值（in-process TCB——§10.9 诚实成文）', () => {
    const store = openTestStore();
    store.setCredential('plugin:demo', 'token', { apiKey: 'sk-demo-token' });
    const { face } = rigFace({ store });
    expect(face.get('token')).toBe('sk-demo-token');
  });

  it('显式指定自域等价缺省形——不开门不审计（opens 空集照读）', () => {
    const store = openTestStore();
    store.setCredential('plugin:demo', 'token', { apiKey: 'sk-demo-token' });
    const { face, used } = rigFace({ store }); // getOpens 缺省 = 恒空集
    expect(face.get('token', { namespace: 'plugin:demo' })).toBe('sk-demo-token');
    expect(used).toEqual([]); // 自域读不进高危面审计
  });

  it('自域缺席拒 CREDENTIALS_NOT_FOUND（message 指路人面录入路径）', () => {
    const { face } = rigFace({ store: openTestStore() });
    const err = expectCode(() => face.get('missing'), 'CREDENTIALS_NOT_FOUND');
    expect(err.message).toContain('plugin:demo');
    expect(err.message).toContain('/credentials add');
  });

  it('自域读不越域旁听：他域同名不可见（隔离律缺省）', () => {
    const store = openTestStore();
    store.setCredential('plugin:other', 'token', { apiKey: 'sk-other' });
    const { face } = rigFace({ store });
    expectCode(() => face.get('token'), 'CREDENTIALS_NOT_FOUND');
  });
});

describe('get 越域读——namespace 值域好形判（同码分流第一档）', () => {
  it.each(['plugindemo', 'plugin:', '', 'Plugin:demo', 'host:extra'])(
    '坏形 %j 拒 CREDENTIALS_NAMESPACE_DENIED',
    (ns) => {
      const { face } = rigFace({ store: openTestStore() });
      const err = expectCode(() => face.get('token', { namespace: ns }), 'CREDENTIALS_NAMESPACE_DENIED');
      expect(err.message).toContain('坏形');
    },
  );
});

describe('get 越域读——高危面门检 credentials.read-cross（§4.6 第四枚）', () => {
  it('非 core 插件未开门拒（message 含 opens 授予位指路——门检 verdict 原文）', () => {
    const store = openTestStore();
    store.setCredential('host', 'model-key', { apiKey: 'sk-host' });
    const { face, used } = rigFace({ store }); // getOpens 缺省 = 恒空集（全默认关）
    const err = expectCode(() => face.get('model-key', { namespace: 'host' }), 'CREDENTIALS_NAMESPACE_DENIED');
    expect(err.message).toContain('credentials.read-cross');
    expect(err.message).toContain('opens'); // 指路 enabled.yaml 授予位写法
    expect(used).toEqual([]); // 被拒的读不进审计（审计只记真读命中）
  });

  it('开门后跨域读 host 域成功 + capability/used 载荷逐字段', () => {
    const store = openTestStore();
    store.setCredential('host', 'model-key', { apiKey: 'sk-host', meta: { source: 'manual' } });
    const { face, used } = rigFace({
      store,
      getOpens: () => new Set(['credentials.read-cross']),
    });
    expect(face.get('model-key', { namespace: 'host' })).toBe('sk-host');
    expect(used).toEqual([
      { pluginId: 'demo', capability: 'credentials.read-cross', namespace: 'host', name: 'model-key' },
    ]);
  });

  it('开门后越域空名同响亮拒 CREDENTIALS_NOT_FOUND（且不审计）', () => {
    const store = openTestStore();
    store.setCredential('host', 'model-key', { apiKey: 'sk-host' });
    const { face, used } = rigFace({
      store,
      getOpens: () => new Set(['credentials.read-cross']),
    });
    expectCode(() => face.get('nope', { namespace: 'host' }), 'CREDENTIALS_NOT_FOUND');
    expect(used).toEqual([]);
  });

  it('开门逐次现读 getOpens——撤位即拒（装载代重建承载 /reload 语义）', () => {
    const store = openTestStore();
    store.setCredential('host', 'model-key', { apiKey: 'sk-host' });
    let open = true;
    const { face } = rigFace({
      store,
      getOpens: () => (open ? new Set(['credentials.read-cross']) : new Set<string>()),
    });
    expect(face.get('model-key', { namespace: 'host' })).toBe('sk-host');
    open = false;
    expectCode(() => face.get('model-key', { namespace: 'host' }), 'CREDENTIALS_NAMESPACE_DENIED');
  });
});

describe('core: 官方件直开豁免（豁免免的是门不是账）', () => {
  it('core: 插件无 opens 跨域读成功 + 审计照记（豁免免的是门不是账）', () => {
    const store = openTestStore();
    store.setCredential('plugin:demo', 'token', { apiKey: 'sk-demo-token' });
    const used: CapabilityUsedPayload[] = [];
    const face = createSecretsFace({
      store,
      pluginId: 'core:issue', // core: 前缀——装配即用户意图（triggers.ts 同律）
      onCapabilityUsed: (p) => void used.push(p),
      // 无 getOpens——豁免判据是 id 前缀，与开门集无关
    });
    expect(face.get('token', { namespace: 'plugin:demo' })).toBe('sk-demo-token');
    expect(used).toEqual([
      { pluginId: 'core:issue', capability: 'credentials.read-cross', namespace: 'plugin:demo', name: 'token' },
    ]);
  });

  it('core: 自域读不开门不审计（豁免只对越域面）', () => {
    const store = openTestStore();
    store.setCredential('plugin:core:issue', 'self', { apiKey: 'sk-self' });
    const used: CapabilityUsedPayload[] = [];
    const face = createSecretsFace({ store, pluginId: 'core:issue', onCapabilityUsed: (p) => void used.push(p) });
    expect(face.get('self')).toBe('sk-self');
    expect(used).toEqual([]);
  });
});

describe('set 受理窗执法（恒自域写）', () => {
  it('缺省窗外拒（fail-closed：无窗态位即无写面）', () => {
    const store = openTestStore();
    const { face, changed } = rigFace({ store }); // inWriteWindow 缺省 = 恒 false
    const err = expectCode(() => face.set('token', 'v1'), 'CREDENTIALS_WRITE_WINDOW_CLOSED');
    expect(err.message).toContain('demo');
    expect(store.getCredential('plugin:demo', 'token')).toBeUndefined(); // 未落行
    expect(changed).toEqual([]);
  });

  it('显式 false 同拒（窗关闭的显式形态）', () => {
    const { face } = rigFace({ store: openTestStore(), inWriteWindow: () => false });
    expectCode(() => face.set('token', 'v1'), 'CREDENTIALS_WRITE_WINDOW_CLOSED');
  });

  it('窗内写恒自域（物理行落 plugin:<本插件>）+ changed 审计载荷逐字段', () => {
    const store = openTestStore();
    const { face, changed } = rigFace({ store, inWriteWindow: () => true });
    face.set('oauth-token', 'sk-fresh', { source: 'oauth' });
    // 真 store 返回整行（含 namespace/provider/updatedAt 物理列——超集合法）
    const row = store.getCredential('plugin:demo', 'oauth-token');
    expect(row?.apiKey).toBe('sk-fresh');
    expect(row?.meta).toEqual({ source: 'oauth' });
    expect(changed).toEqual([
      // 值域 05 §1.1 单源：oauth 首写计 rotate、流内写 = 'oauth-flow'
      { namespace: 'plugin:demo', name: 'oauth-token', action: 'rotate', origin: 'oauth-flow' },
    ]);
  });

  it('set 无跨域面：写名永落自域（调用方无从指定 namespace）', () => {
    const store = openTestStore();
    const face = createSecretsFace({ store, pluginId: 'demo', inWriteWindow: () => true });
    face.set('token', 'v1');
    expect(store.getCredential('host', 'token')).toBeUndefined(); // host 域无此行
    expect(store.getCredential('plugin:demo', 'token')?.apiKey).toBe('v1');
  });

  it('meta 整列换（非合并——第二次 set 的 meta 覆盖首写）', () => {
    const store = openTestStore();
    const face = createSecretsFace({ store, pluginId: 'demo', inWriteWindow: () => true });
    face.set('token', 'a', { source: 'oauth' });
    face.set('token', 'b', { expired: true });
    const row = store.getCredential('plugin:demo', 'token');
    expect(row?.apiKey).toBe('b');
    expect(row?.meta).toEqual({ expired: true }); // 整列换：source 键不在了
  });

  it('窗内读回自写值全环（写→读同键往返）', () => {
    const store = openTestStore();
    const { face } = rigFace({ store, inWriteWindow: () => true });
    face.set('token', 'sk-roundtrip');
    expect(face.get('token')).toBe('sk-roundtrip');
  });
});

describe('compat 互证（词面独立律——CredentialsStoreFace vs persist Store）', () => {
  it('persist Store 结构可赋值凭证窄面（编译期执法 + 运行时往返）', () => {
    const store = openTestStore();
    const narrow: CredentialsStoreFace = store; // typecheck 门禁执法此行
    expect(typeof narrow.getCredential).toBe('function');
    expect(typeof narrow.setCredential).toBe('function');
    // 双键投影运行时真达（assembly 接的就是这个投影）
    narrow.setCredential('plugin:compat', 'k', { apiKey: 'v', meta: { source: 'oauth' } });
    expect(narrow.getCredential('plugin:compat', 'k')?.apiKey).toBe('v');
  });
});
