/**
 * credentials 注入腿展开器测试（c-4——03 §10.9 注入腿）。
 *
 * 真库全环（secrets.test.ts 同惯例）：临时目录库 + ephemeralSecretKey +
 * CREDENTIALS_MIGRATION 链——createEnvRefResolver 直接打真 persist store。
 *
 * 覆盖面：
 *  - host 域命中返回明文（展开器结构契约 (name) => string）；
 *  - host 域缺席拒 CREDENTIALS_NOT_FOUND（message 指路人面录入路径）；
 *  - 插件域同名隔离不命中（namespace 恒 host——用户配置注入面单域，
 *    插件域凭证不进用户 server 配置注入面）；
 *  - 词面单源对拍：resolver 与 contracts parseCredentialEnvRef 联用全环
 *    （引用形原文 → 解析 → 展开 → 明文，只进调用方返回值）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseError, parseCredentialEnvRef } from '../contracts/index.js';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { CREDENTIALS_MIGRATION } from './migration.js';
import { createEnvRefResolver } from './env-ref.js';

let dir: string;
let stores: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-cred-envref-test-'));
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** BaseError 码断言辅助（错码即契约）——secrets.test.ts 同形 */
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
    dbPath: join(dir, 'envref.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
    migrations: [CREDENTIALS_MIGRATION],
  });
  stores.push(store);
  return store;
}

describe('createEnvRefResolver host 域展开（03 §10.9 注入腿）', () => {
  it('host 域命中返回明文值', () => {
    const store = openTestStore();
    store.setCredential('host', 'github-token', { apiKey: 'sk-host-token' });
    const resolve = createEnvRefResolver(store);
    expect(resolve('github-token')).toBe('sk-host-token');
  });

  it('host 域缺席拒 CREDENTIALS_NOT_FOUND（message 指路人面录入路径）', () => {
    const resolve = createEnvRefResolver(openTestStore());
    const err = expectCode(() => resolve('missing'), 'CREDENTIALS_NOT_FOUND');
    expect(err.message).toContain('@credentials:missing');
    expect(err.message).toContain('/credentials add');
  });

  it('插件域同名隔离不命中（namespace 恒 host——单域注入面）', () => {
    const store = openTestStore();
    store.setCredential('plugin:demo', 'github-token', { apiKey: 'sk-plugin-token' });
    const resolve = createEnvRefResolver(store);
    // host 域无行——插件域同名行不可见（隔离律）
    expectCode(() => resolve('github-token'), 'CREDENTIALS_NOT_FOUND');
  });

  it('词面单源联用全环：引用形原文 → parseCredentialEnvRef → 展开 → 明文', () => {
    const store = openTestStore();
    store.setCredential('host', 'api-key', { apiKey: 'sk-full-loop' });
    const resolve = createEnvRefResolver(store);
    // exec 侧同律：set 值先经词面单源解析，ref 形才进展开器
    const parsed = parseCredentialEnvRef('@credentials:api-key');
    expect(parsed).toEqual({ kind: 'ref', name: 'api-key' });
    if (parsed.kind === 'ref') {
      expect(resolve(parsed.name)).toBe('sk-full-loop');
    }
  });
});
