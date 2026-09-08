/**
 * safety/sensitive 测试 — 敏感件读集单源（04 §7 读侧 carve-out——2026-09-08
 * P0①）。
 *
 * 对拍律：SENSITIVE_READ_BASENAMES 与两字面锚（persist/secret-box 的
 * SECRET_KEY_BASENAME、host/allowlist-store 的 ALLOWLIST_BASENAME）互证——
 * safety 不 import persist/host（DAG 边表），字面漂移在对拍处变红。测试文件
 * 豁免边表（*.test.* 两账分离）。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SENSITIVE_READ_BASENAMES, sensitiveReadFiles } from './sensitive.js';
import { SECRET_KEY_BASENAME } from '../persist/secret-box.js';
import { ALLOWLIST_BASENAME } from '../host/allowlist-store.js';

describe('SENSITIVE_READ_BASENAMES 对拍锚（字面同步互证——漂移即红）', () => {
  it('secret.key ≡ persist/secret-box SECRET_KEY_BASENAME', () => {
    expect(SENSITIVE_READ_BASENAMES).toContain(SECRET_KEY_BASENAME);
  });
  it('allowlist.json ≡ host/allowlist-store ALLOWLIST_BASENAME', () => {
    expect(SENSITIVE_READ_BASENAMES).toContain(ALLOWLIST_BASENAME);
  });
  it('恰两件（新敏感件入册须同步扩对拍锚——防无锚字面漂入）', () => {
    expect(SENSITIVE_READ_BASENAMES).toHaveLength(2);
  });
});

describe('sensitiveReadFiles canonical 派生', () => {
  it('dataDir 直下逐件派生（件在场——realpath 解析后的真实路径）', () => {
    const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sens-')));
    writeFileSync(join(dir, 'secret.key'), 'k');
    writeFileSync(join(dir, 'allowlist.json'), '{}');
    expect(sensitiveReadFiles(dir)).toEqual([join(dir, 'secret.key'), join(dir, 'allowlist.json')]);
  });

  it('符号链 dataDir 解析到真实位置（literal deny 字面 miss 防线——/tmp → /private/tmp 同族）', () => {
    // 真实目录 + 指向它的符号链别名：派生必须落在真实路径上（别名入 = 真实出）
    const real = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sens-real-')));
    const alias = join(realpathSync(tmpdir()), `sens-alias-${process.pid}-${Date.now()}`);
    symlinkSync(real, alias);
    try {
      expect(sensitiveReadFiles(alias)).toEqual(sensitiveReadFiles(real));
    } finally {
      unlinkSync(alias);
    }
  });

  it('敏感件缺席不虚构路径（回退最近在场祖先 + 尾段——与 canonicalPath 同律）', () => {
    const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sens-absent-')));
    expect(sensitiveReadFiles(dir)).toEqual([join(dir, 'secret.key'), join(dir, 'allowlist.json')]);
  });
});
