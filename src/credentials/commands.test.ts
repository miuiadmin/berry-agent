/**
 * credentials 人面命令测试（c-5——03 §10.9 写入面复合案·静态凭证人面唯写）。
 *
 * 真库全环：临时目录库 + ephemeralSecretKey + CREDENTIALS_MIGRATION 链
 * （secrets.test.ts 同惯例）——CredentialsCommandStore 窄面接真 persist
 * store（compat 面即装配面：assembly/credentials-cmd 直传的就是这个投影）。
 *
 * 覆盖面（铁律逐条锁）：
 *  - add 缺省 host 全环：upsert 落行 + meta {source:'manual'} + 审计载荷
 *    逐字段 + **值不入结算文本**（模型可见性铁律回归锁）；
 *  - add 覆写整行（meta 整列换非合并）；
 *  - add plugin:<id> 域 + 坏形 namespace 折文本 CREDENTIALS_NAMESPACE_DENIED
 *    （同码分流律——读腿同码）；
 *  - list 全域列示 + expired 标注 + **永不呈值** + 空表诚实空；
 *  - rm 命中（+审计 remove）与缺席（CREDENTIALS_NOT_FOUND 折文本 ok:false）；
 *  - parseCredentialsArgv 各失败形与成功形（TUI 面解析律）；
 *  - compat 互证：persist Store 结构可赋 CredentialsCommandStore（词面独立律）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { CREDENTIALS_MIGRATION } from './migration.js';
import { parseCredentialsArgv, runCredentialsCommand, type CredentialsCommandStore } from './commands.js';
import type { CredentialChangedPayload } from './secrets.js';

let dir: string;
let stores: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-cred-cmd-test-'));
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 开真库（credentials v7 表在场） */
function openTestStore(): Store {
  const store = openStore({
    dbPath: join(dir, 'cmd.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
    migrations: [CREDENTIALS_MIGRATION],
  });
  stores.push(store);
  return store;
}

/** 装配速记（审计载荷收集器内置——store 与 seam 闭包注入，调用面只剩动词） */
function rig(store: Store): {
  run: (sub: Parameters<typeof runCredentialsCommand>[0]) => ReturnType<typeof runCredentialsCommand>;
  changed: CredentialChangedPayload[];
} {
  const changed: CredentialChangedPayload[] = [];
  return {
    run: (sub) => runCredentialsCommand(sub, { store, onCredentialChanged: (payload) => changed.push(payload) }),
    changed,
  };
}

describe('add 动词', () => {
  it('缺省 host 域全环：落行 + meta manual + 审计 add/human 逐字段 + 值不入结算文本', () => {
    const store = openTestStore();
    const { run, changed } = rig(store);
    const result = run({ sub: 'add', name: 'anthropic', value: 'sk-super-secret-9f2a' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('host/anthropic');
    expect(result.text).toContain('manual');
    // 模型可见性铁律：值永不呈现（含指路注入引用形——引用形是名不是值）
    expect(result.text).not.toContain('sk-super-secret-9f2a');
    // 落行往返（解密后明文 == 录入值）+ meta 整列
    const row = store.getCredential('host', 'anthropic');
    expect(row?.apiKey).toBe('sk-super-secret-9f2a');
    expect(row?.meta).toEqual({ source: 'manual' });
    // 审计 seam 载荷逐字段（05 §1.1 值域：人面 = action 'add' / origin 'human'）
    expect(changed).toEqual([{ namespace: 'host', name: 'anthropic', action: 'add', origin: 'human' }]);
  });

  it('覆写 = 整行换（meta 整列换非合并——oauth 历史行被人面覆写后归 manual）', () => {
    const store = openTestStore();
    const { run } = rig(store);
    // 预置 oauth 来源行（c-6 流将产出的形态）
    store.setCredential('host', 'github', { apiKey: 'ghu_old', meta: { source: 'oauth', expired: true } });
    const result = run({ sub: 'add', name: 'github', value: 'gh-token-new' });
    expect(result.ok).toBe(true);
    const row = store.getCredential('host', 'github');
    expect(row?.apiKey).toBe('gh-token-new');
    expect(row?.meta).toEqual({ source: 'manual' }); // expired 位随整列换消失
  });

  it('plugin:<id> 域显式可写 + 坏形 namespace 折文本同码分流', () => {
    const store = openTestStore();
    const { run, changed } = rig(store);
    const okResult = run({ sub: 'add', name: 'deploy-key', value: 'v-1', namespace: 'plugin:demo' });
    expect(okResult.ok).toBe(true);
    expect(okResult.text).toContain('plugin:demo/deploy-key');
    expect(store.getCredential('plugin:demo', 'deploy-key')?.apiKey).toBe('v-1');
    expect(changed).toEqual([{ namespace: 'plugin:demo', name: 'deploy-key', action: 'add', origin: 'human' }]);

    const bad = run({ sub: 'add', name: 'x', value: 'v', namespace: 'team' });
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('CREDENTIALS_NAMESPACE_DENIED'); // BaseError 码直呈（折文本不炸）
    expect(bad.text).toContain('team');
  });

  it('空值兜底拒（TUI tokenize 可产空段——CLI 解析律已拦后的第二道闸）', () => {
    const store = openTestStore();
    const { run } = rig(store);
    const result = run({ sub: 'add', name: 'x', value: '' });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('值不得为空');
  });
});

describe('list 动词', () => {
  it('全域列示（host + plugin 域同行）+ expired 标注 + 永不呈值', () => {
    const store = openTestStore();
    const { run } = rig(store);
    run({ sub: 'add', name: 'anthropic', value: 'sk-live-777c' });
    run({ sub: 'add', name: 'deploy-key', value: 'v-2', namespace: 'plugin:demo' });
    // oauth 三振形态（c-6 将产出——保留上次有效值 + expired 告示位）
    store.setCredential('host', 'github', { apiKey: 'ghu_stale', meta: { source: 'oauth', expired: true } });

    const result = run({ sub: 'list' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('共 3 条凭证');
    expect(result.text).toContain('host  anthropic  来源 manual');
    expect(result.text).toContain('plugin:demo  deploy-key  来源 manual');
    expect(result.text).toContain('github  来源 oauth（已过期——保留上次有效值）');
    expect(result.text).toMatch(/更新 \d{4}-\d{2}-\d{2}T/); // ISO 时间列在场
    // 铁律：三条明文值全不入文本
    expect(result.text).not.toContain('sk-live-777c');
    expect(result.text).not.toContain('v-2');
    expect(result.text).not.toContain('ghu_stale');
  });

  it('meta 缺席行来源列「未记」（历史行/迁移回填行容错）', () => {
    const store = openTestStore();
    store.setCredential('host', 'legacy', { apiKey: 'v-old' }); // 无 meta
    const result = runCredentialsCommand({ sub: 'list' }, { store });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('legacy  来源 未记');
  });

  it('空表诚实空', () => {
    const store = openTestStore();
    const result = runCredentialsCommand({ sub: 'list' }, { store });
    expect(result.ok).toBe(true); // 空表非失败
    expect(result.text).toContain('无凭证');
  });
});

describe('rm 动词', () => {
  it('命中：删行 + 审计 remove/human + 回执只含域与名', () => {
    const store = openTestStore();
    const { run, changed } = rig(store);
    run({ sub: 'add', name: 'anthropic', value: 'sk-x' });
    const result = run({ sub: 'rm', name: 'anthropic' });
    expect(result.ok).toBe(true);
    expect(result.text).toContain('host/anthropic');
    expect(result.text).not.toContain('sk-x');
    expect(store.getCredential('host', 'anthropic')).toBeUndefined();
    // collector 含前序 add 载荷——断言末位（remove 是最后动作）
    expect(changed[changed.length - 1]).toEqual({
      namespace: 'host',
      name: 'anthropic',
      action: 'remove',
      origin: 'human',
    });
  });

  it('缺席：CREDENTIALS_NOT_FOUND 折文本 ok:false（退出码 1 档）', () => {
    const store = openTestStore();
    const result = runCredentialsCommand({ sub: 'rm', name: 'ghost' }, { store });
    expect(result.ok).toBe(false);
    expect(result.text).toContain('CREDENTIALS_NOT_FOUND');
    expect(result.text).toContain('ghost');
    expect(result.text).toContain('host'); // 指路在册域
  });
});

describe('parseCredentialsArgv（TUI 面解析律）', () => {
  it('成功形：add 全形（含 namespace 旗标）/ list / rm', () => {
    expect(parseCredentialsArgv(['add', 'name-a', 'value-a'])).toEqual({
      ok: true,
      sub: { sub: 'add', name: 'name-a', value: 'value-a' },
    });
    expect(parseCredentialsArgv(['add', 'n', 'v', '--namespace', 'plugin:demo'])).toEqual({
      ok: true,
      sub: { sub: 'add', name: 'n', value: 'v', namespace: 'plugin:demo' },
    });
    // 旗标与位置参数可交错（宽容形——动词后任意序；旗标起头 = 缺子命令拒）
    expect(parseCredentialsArgv(['rm', '--namespace', 'plugin:x', 'n'])).toEqual({
      ok: true,
      sub: { sub: 'rm', name: 'n', namespace: 'plugin:x' },
    });
    expect(parseCredentialsArgv(['list'])).toEqual({ ok: true, sub: { sub: 'list' } });
  });

  it('失败形：缺子命令 / 未知动词 / arity 错 / --namespace 无值', () => {
    const cases: readonly [readonly string[], string][] = [
      [[], '缺子命令'],
      [['--namespace', 'host'], '缺子命令'], // 旗标起头不算动词
      [['bogus'], '未知子命令'],
      [['list', 'extra'], 'list 不收位置参数'],
      [['add', 'only-name'], 'add 须带 <name> <value>'],
      [['add', 'a', 'b', 'c'], 'add 须带 <name> <value>'],
      [['rm'], 'rm 须带 <name>'],
      [['rm', 'a', 'b'], 'rm 须带 <name>'],
      [['add', 'n', 'v', '--namespace'], '--namespace 须带值'],
    ];
    for (const [argv, keyword] of cases) {
      const parsed = parseCredentialsArgv(argv);
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.message).toContain(keyword);
    }
  });
});

describe('compat 互证（词面独立律）', () => {
  it('persist Store 结构可赋 CredentialsCommandStore 四法投影', () => {
    const store = openTestStore();
    const face: CredentialsCommandStore = store; // 结构兼容——assembly 直传真身
    face.setCredential('host', 'compat-check', { apiKey: 'v', meta: { source: 'manual' } });
    expect(face.getCredential('host', 'compat-check')?.apiKey).toBe('v');
    expect(face.deleteCredential('host', 'compat-check')).toBe(true);
    expect(face.listCredentialProviders()).toEqual([]);
  });
});
