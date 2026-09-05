/**
 * secret-box 测试——AES-256-GCM 密文盒（05 §9 credentials 行加密细则）。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { decryptSecret, encryptSecret, loadOrCreateSecretKey, SECRET_KEY_BASENAME } from './secret-box.js';

/** 断言抛指定码 */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('未拒绝');
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-secret-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('密钥自举', () => {
  it('缺失自动生成（32 字节，0600 落盘）且幂等复用', () => {
    const key = loadOrCreateSecretKey(dir, () => undefined);
    expect(key).toHaveLength(32);
    const path = join(dir, SECRET_KEY_BASENAME);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path).equals(key)).toBe(true);
    // 二次加载 = 同一密钥（幂等）
    expect(loadOrCreateSecretKey(dir, () => undefined).equals(key)).toBe(true);
  });

  it('长度异常的密钥文件 fail-loud（PERSIST_SECRET_UNREADABLE）', () => {
    writeFileSync(join(dir, SECRET_KEY_BASENAME), Buffer.alloc(16));
    expectCode(() => loadOrCreateSecretKey(dir, () => undefined), 'PERSIST_SECRET_UNREADABLE');
  });
});

describe('加密往返', () => {
  it('v1: 前缀自描述 + 随机 iv（同明文两次密文不同）+ 往返保真', () => {
    const key = loadOrCreateSecretKey(dir, () => undefined);
    const boxed = encryptSecret(key, 'sk-test-12345');
    expect(boxed.startsWith('v1:')).toBe(true);
    expect(boxed).not.toBe(encryptSecret(key, 'sk-test-12345'));
    expect(decryptSecret(key, boxed)).toBe('sk-test-12345');
  });

  it('密钥不匹配 → PERSIST_SECRET_UNREADABLE（GCM 认证失败）', () => {
    const keyA = loadOrCreateSecretKey(dir, () => undefined);
    const boxed = encryptSecret(keyA, 'sk-test');
    const dirB = join(dir, 'b');
    mkdirSync(dirB);
    const keyB = loadOrCreateSecretKey(dirB, () => undefined);
    expectCode(() => decryptSecret(keyB, boxed), 'PERSIST_SECRET_UNREADABLE');
  });

  it('坏密文（无前缀/短密文/base64 损坏）一律 PERSIST_SECRET_UNREADABLE', () => {
    const key = loadOrCreateSecretKey(dir, () => undefined);
    expectCode(() => decryptSecret(key, 'plaintext'), 'PERSIST_SECRET_UNREADABLE');
    expectCode(() => decryptSecret(key, 'v1:AAAA'), 'PERSIST_SECRET_UNREADABLE');
    expectCode(() => decryptSecret(key, 'v1:!!!not-base64!!!'), 'PERSIST_SECRET_UNREADABLE');
  });

  it('密文被篡改（翻转一字节）→ 认证失败', () => {
    const key = loadOrCreateSecretKey(dir, () => undefined);
    const boxed = encryptSecret(key, 'sk-tamper-test');
    const raw = Buffer.from(boxed.slice(3), 'base64');
    const last = raw.length - 1;
    raw[last] = (raw[last] ?? 0) ^ 0xff;
    expectCode(() => decryptSecret(key, 'v1:' + raw.toString('base64')), 'PERSIST_SECRET_UNREADABLE');
  });
});
