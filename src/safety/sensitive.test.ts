/**
 * safety/sensitive 测试 — 敏感件读集单源（04 §7 读侧 carve-out——2026-09-08
 * P0①；2026-09-11 审批分档批载体更名——新名 tool-policy.json + 旧名留置
 * 保护两名同列）。
 *
 * 对拍律：SENSITIVE_READ_BASENAMES 与三字面锚（persist/secret-box 的
 * SECRET_KEY_BASENAME、host/tool-policy-store 的 TOOL_POLICY_BASENAME 与
 * LEGACY_ALLOWLIST_BASENAME）互证——safety 不 import persist/host（DAG 边
 * 表），字面漂移在对拍处变红。测试文件豁免边表（*.test.* 两账分离）。
 */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SENSITIVE_READ_BASENAMES, sensitiveReadFiles } from './sensitive.js';
import { SECRET_KEY_BASENAME } from '../persist/secret-box.js';
import { LEGACY_ALLOWLIST_BASENAME, TOOL_POLICY_BASENAME } from '../host/tool-policy-store.js';

describe('SENSITIVE_READ_BASENAMES 对拍锚（字面同步互证——漂移即红）', () => {
  it('secret.key ≡ persist/secret-box SECRET_KEY_BASENAME', () => {
    expect(SENSITIVE_READ_BASENAMES).toContain(SECRET_KEY_BASENAME);
  });
  it('tool-policy.json ≡ host/tool-policy-store TOOL_POLICY_BASENAME（新载体名）', () => {
    expect(SENSITIVE_READ_BASENAMES).toContain(TOOL_POLICY_BASENAME);
  });
  it('allowlist.json ≡ host/tool-policy-store LEGACY_ALLOWLIST_BASENAME（旧名留置保护——遗存期同不可读）', () => {
    expect(SENSITIVE_READ_BASENAMES).toContain(LEGACY_ALLOWLIST_BASENAME);
  });
  it('恰三件（新敏感件入册须同步扩对拍锚——防无锚字面漂入）', () => {
    expect(SENSITIVE_READ_BASENAMES).toHaveLength(3);
  });
});

describe('sensitiveReadFiles canonical 派生', () => {
  it('dataDir 直下逐件派生（件在场——realpath 解析后的真实路径）', () => {
    const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sens-')));
    writeFileSync(join(dir, 'secret.key'), 'k');
    writeFileSync(join(dir, TOOL_POLICY_BASENAME), '{}');
    writeFileSync(join(dir, LEGACY_ALLOWLIST_BASENAME), '{}'); // 旧名遗存同保护
    expect(sensitiveReadFiles(dir)).toEqual([
      join(dir, 'secret.key'),
      join(dir, TOOL_POLICY_BASENAME),
      join(dir, LEGACY_ALLOWLIST_BASENAME),
    ]);
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
    expect(sensitiveReadFiles(dir)).toEqual([
      join(dir, 'secret.key'),
      join(dir, TOOL_POLICY_BASENAME),
      join(dir, LEGACY_ALLOWLIST_BASENAME),
    ]);
  });
});
