/**
 * credentials 迁移与词面测试（c-2 存储腿）。
 *
 * 迁移腿：真 better-sqlite3 临时目录库走全链——先无链开基线 v1 库、物理
 * SQL 造旧形凭证行（provider 单键主键 + 真密文），再带 CREDENTIALS_MIGRATION
 * 重开验证重建四步舞：user_version=7 / 旧行回填 'host' / 复合主键
 * (namespace, provider) 下两域同名共存 / 真密文无损迁移后解密往返 /
 * 迁移前备份件在场（05 §6.4 缺口备份律）。
 *
 * 词面腿：namespace 值域三函数（构造/判定/反解）纯函数全分支——值域执法
 * 位在 c-3 读腿受理位，本件先锁词面行为。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ephemeralSecretKey, encryptSecret, openStore, type Store } from '../persist/index.js';
import { CREDENTIALS_MIGRATION } from './migration.js';
import { HOST_NAMESPACE, isPluginNamespace, parsePluginNamespace, pluginNamespace } from './types.js';

let dir: string;
let stores: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-cred-mig-test-'));
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('credentials 表扩容迁移 v7（03 §10.9 存储 bullet / 05 §6.4）', () => {
  it('旧形 v1 库升级：回填 host + 复合主键 + 真密文无损 + 备份件在场', () => {
    const dbPath = join(dir, 'migrate.db');
    const key = ephemeralSecretKey();
    // ① 无链开基线 v1 库（provider 单键旧形——迁移前世界）
    const v1 = openStore({ dbPath, dataDir: join(dir, 'data'), secretKey: key });
    stores.push(v1);
    // 物理 SQL 造旧形行：真密文（迁移只搬不加密——密文须先真）
    const boxed = encryptSecret(key, 'sk-legacy-token');
    v1.connection
      .prepare(`INSERT INTO credentials (provider, api_key, meta, updated_at) VALUES (?, ?, ?, ?)`)
      .run('anthropic', boxed, null, 1_000);
    v1.close();

    // ② 带迁移链重开——缺口备份 + 重建四步舞执行
    const v7 = openStore({ dbPath, dataDir: join(dir, 'data'), secretKey: key, migrations: [CREDENTIALS_MIGRATION] });
    stores.push(v7);
    expect(v7.headVersion).toBe(7);
    // 迁移前备份件在场（05 §6.4：version < head 时先备份库文件再动刀）
    expect(existsSync(`${dbPath}.bak-v1`)).toBe(true);
    // 旧行回填 'host'（模型 API key 射程界桩——v1 表即其终态，扩容后语义不变）
    const row = v7.connection.prepare(`SELECT namespace, provider, api_key FROM credentials`).get() as {
      namespace: string;
      provider: string;
      api_key: string;
    };
    expect(row.namespace).toBe('host');
    expect(row.provider).toBe('anthropic');
    expect(row.api_key).toBe(boxed);
    // 真密文无损迁移——解密往返成立（宿主域读）
    expect(v7.getCredential('host', 'anthropic')?.apiKey).toBe('sk-legacy-token');
    // 主键已复合：表 SQL 含 (namespace, provider) 双列形
    const ddl = (
      v7.connection.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'credentials'`).get() as {
        sql: string;
      }
    ).sql;
    expect(ddl).toContain('PRIMARY KEY (namespace, provider)');
  });

  it('扩容后 plugin 域可写读——与宿主域同名 provider 两行独立', () => {
    const dbPath = join(dir, 'domains.db');
    const key = ephemeralSecretKey();
    // 全新库直带链开（宿主真实路径：bootstrap v1 → 链上逐级至 v7）
    const store = openStore({
      dbPath,
      dataDir: join(dir, 'data'),
      secretKey: key,
      migrations: [CREDENTIALS_MIGRATION],
    });
    stores.push(store);
    store.setCredential('host', 'gh', { apiKey: 'host-token', meta: { source: 'manual' } });
    store.setCredential('plugin:demo', 'gh', { apiKey: 'plugin-token', meta: { source: 'oauth' } });
    // 复合主键下同名 provider 两行共存，读各归各域
    expect(store.getCredential('host', 'gh')?.apiKey).toBe('host-token');
    expect(store.getCredential('plugin:demo', 'gh')?.apiKey).toBe('plugin-token');
    expect(store.getCredential('plugin:demo', 'gh')?.meta).toEqual({ source: 'oauth' });
    // meta 键约定可自由附加（CredentialMeta 开放键——c-6 oauth 定形前的自由 JSON）
    expect((store.connection.prepare(`SELECT count(*) AS n FROM credentials`).get() as { n: number }).n).toBe(2);
  });
});

describe('namespace 值域词面（types 单源——c-3 读腿受理位消费）', () => {
  it('构造器：插件 id → plugin: 前缀域', () => {
    expect(pluginNamespace('demo')).toBe('plugin:demo');
    expect(pluginNamespace('a.b-c')).toBe('plugin:a.b-c');
  });

  it('判定器：host 与坏形前缀均非插件域', () => {
    expect(isPluginNamespace('plugin:demo')).toBe(true);
    expect(isPluginNamespace('host')).toBe(false);
    expect(isPluginNamespace('plugin:')).toBe(false); // 空插件 id 坏形
    expect(isPluginNamespace('plugindemo')).toBe(false);
    expect(isPluginNamespace('')).toBe(false);
  });

  it('反解器：插件域取 id，非插件域返回 null', () => {
    expect(parsePluginNamespace('plugin:demo')).toBe('demo');
    expect(parsePluginNamespace('host')).toBeNull();
    expect(parsePluginNamespace('plugin:')).toBeNull();
  });

  it('宿主域常量即词面（host——射程界桩单源）', () => {
    const ns: 'host' = HOST_NAMESPACE;
    expect(ns).toBe('host');
  });
});
