/**
 * persist — 凭证密文盒（05 篇 §9 credentials 行加密细则，2026-09-05 persist
 * 落码批补细则的落码面）。
 *
 * AES-256-GCM：
 *  - 密钥 = 数据目录 secret.key（32 字节随机，0600，缺失自动生成——首启自举）；
 *  - 密文自描述 `v1:<base64(iv|tag|ct)>`（iv 12 字节随机 / tag 16 字节 / ct 明文等长）；
 *  - 解密失败（密钥丢失/不匹配/密文损坏）→ fail-loud `PERSIST_SECRET_UNREADABLE`
 *    ——重录凭证即恢复（旧密文作废，不静默降级为明文存储）。
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { BaseError } from '../contracts/index.js';
import { dataFilePath, repairFileMode } from './paths.js';

/** 密钥文件名（数据目录内） */
export const SECRET_KEY_BASENAME = 'secret.key';

/** 密钥长度（AES-256 位） */
const SECRET_KEY_LENGTH = 32;

/** GCM 推荐 iv 长度（12 字节） */
const IV_LENGTH = 12;

/** GCM 认证标签长度（16 字节） */
const TAG_LENGTH = 16;

/** 密文版本前缀（自描述格式——未来算法升级走 v2 前缀，v1 读侧永在） */
const BOX_PREFIX = 'v1:';

/**
 * 加载或生成数据密钥（幂等自举）：
 *  - 在场：读出并校验长度（长度异常 = 密钥文件损坏 → fail-loud，宁拒勿猜）；
 *  - 缺席：randomBytes(32) 落盘（0600——写入即带权限，勿先宽后收留窗口）。
 * @param dataDir 数据目录（须已存在——ensureDataDir 前置）
 * @param warn 权限修复告警面（0600 自检修复 + warn，05 §6.6 同款纪律）
 * @returns 32 字节密钥
 */
export function loadOrCreateSecretKey(dataDir: string, warn: (message: string) => void): Buffer {
  const keyPath = dataFilePath(dataDir, SECRET_KEY_BASENAME);
  if (existsSync(keyPath)) {
    const key = readFileSync(keyPath);
    if (key.length !== SECRET_KEY_LENGTH) {
      throw new BaseError(
        'PERSIST_SECRET_UNREADABLE',
        `密钥文件 ${keyPath} 长度 ${key.length} ≠ ${SECRET_KEY_LENGTH} 字节（损坏或手编）——移除该文件并重录凭证可恢复（旧密文作废）`,
      );
    }
    repairFileMode(keyPath, '密钥文件', warn);
    return key;
  }
  const key = randomBytes(SECRET_KEY_LENGTH);
  // mode 0600 在创建时即生效（open(2) O_CREAT 权限位——umask 只会收紧不会放宽）
  writeFileSync(keyPath, key, { mode: 0o600 });
  return key;
}

/**
 * 明文 → 自描述密文（`v1:<base64(iv|tag|ct)>`）。每次加密随机 iv——同明文
 * 两次加密密文不同（GCM nonce 复用是灾难，结构性排除）。
 * @param key 32 字节密钥（loadOrCreateSecretKey 产物）
 * @param plaintext 凭证明文（api_key 等）
 */
export function encryptSecret(key: Buffer, plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return BOX_PREFIX + Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * 自描述密文 → 明文。任何一步失败（前缀不认识/base64 损坏/认证标签不过）
 * 统一抛 `PERSIST_SECRET_UNREADABLE`——调用方对用户的话术是「重录凭证」。
 * @param key 32 字节密钥
 * @param boxed encryptSecret 产物（或其存储态）
 */
export function decryptSecret(key: Buffer, boxed: string): string {
  const fail = (detail: string): BaseError =>
    new BaseError('PERSIST_SECRET_UNREADABLE', `凭证密文不可解读（${detail}）——密钥丢失或不匹配；重录凭证即恢复`);
  if (!boxed.startsWith(BOX_PREFIX)) throw fail('密文缺 v1: 版本前缀');
  let packed: Buffer;
  try {
    packed = Buffer.from(boxed.slice(BOX_PREFIX.length), 'base64');
  } catch {
    throw fail('base64 损坏');
  }
  if (packed.length < IV_LENGTH + TAG_LENGTH + 1) throw fail('密文长度不足');
  const iv = packed.subarray(0, IV_LENGTH);
  const tag = packed.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = packed.subarray(IV_LENGTH + TAG_LENGTH);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  } catch (err) {
    throw fail(`认证失败：${err instanceof Error ? err.message : String(err)}`);
  }
}

/** 测试/诊断面：生成临时内存密钥（:memory: 形态的凭证面用——库亡密亡） */
export function ephemeralSecretKey(): Buffer {
  return randomBytes(SECRET_KEY_LENGTH);
}
