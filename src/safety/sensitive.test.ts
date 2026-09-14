/**
 * safety/sensitive 测试 — 敏感件读集单源（04 §7 读侧 carve-out——2026-09-08
 * P0①；2026-09-11 审批分档批载体更名——新名 tool-policy.json + 旧名留置
 * 保护两名同列；2026-09-14 五役 CL-1——serve/daemon.log 入集，集员自
 * 「直下 basename」扩为「dataDir 相对路径」，数组名随之勘正）。
 *
 * 对拍律：SENSITIVE_READ_DATA_PATHS 与四锚（persist/secret-box 的
 * SECRET_KEY_BASENAME、host/tool-policy-store 的 TOOL_POLICY_BASENAME 与
 * LEGACY_ALLOWLIST_BASENAME、host/serve-daemon 的 daemonPaths().logPath
 * ——daemon.log 产侧真源）互证——safety 不 import persist/host（DAG 边
 * 表），字面漂移在对拍处变红。测试文件豁免边表（*.test.* 两账分离）。
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { SENSITIVE_READ_DATA_PATHS, sensitiveReadFiles } from './sensitive.js';
import { canonicalPath } from './roots.js';
import { SECRET_KEY_BASENAME } from '../persist/secret-box.js';
import { LEGACY_ALLOWLIST_BASENAME, TOOL_POLICY_BASENAME } from '../host/tool-policy-store.js';
import { daemonPaths } from '../host/serve-daemon.js';

describe('SENSITIVE_READ_DATA_PATHS 对拍锚（字面同步互证——漂移即红）', () => {
  it('secret.key ≡ persist/secret-box SECRET_KEY_BASENAME', () => {
    expect(SENSITIVE_READ_DATA_PATHS).toContain(SECRET_KEY_BASENAME);
  });
  it('tool-policy.json ≡ host/tool-policy-store TOOL_POLICY_BASENAME（新载体名）', () => {
    expect(SENSITIVE_READ_DATA_PATHS).toContain(TOOL_POLICY_BASENAME);
  });
  it('allowlist.json ≡ host/tool-policy-store LEGACY_ALLOWLIST_BASENAME（旧名留置保护——遗存期同不可读）', () => {
    expect(SENSITIVE_READ_DATA_PATHS).toContain(LEGACY_ALLOWLIST_BASENAME);
  });
  it('serve/daemon.log 入集（04 §7 五役 CL-1——daemon 形自动生成 SDK token 的明文披露位，读集缺席即「读凭证 → 公开外泄」链的读腿）', () => {
    expect(SENSITIVE_READ_DATA_PATHS).toContain('serve/daemon.log');
  });
  it('serve/daemon.log ≡ host/serve-daemon daemonPaths logPath（产侧对拍——serve/ 目录名或 daemon.log 文件名在产侧漂移即红；daemonPaths 纯路径演算零 fs 动作，测试文件豁免边表先例同上）', () => {
    const dataDir = join(realpathSync(tmpdir()), 'sens-anchor-');
    expect(SENSITIVE_READ_DATA_PATHS).toContain(relative(dataDir, daemonPaths(dataDir).logPath));
  });
  it('恰四件（新敏感件入册须同步扩对拍锚——防无锚字面漂入；daemon.log 直锁字面由上上例、产侧由上例 daemonPaths 对拍）', () => {
    expect(SENSITIVE_READ_DATA_PATHS).toHaveLength(4);
  });
});

describe('sensitiveReadFiles canonical 派生', () => {
  it('dataDir 相对路径逐件派生——含子路径员（件在场——realpath 解析后的真实路径）', () => {
    const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sens-')));
    writeFileSync(join(dir, 'secret.key'), 'k');
    writeFileSync(join(dir, TOOL_POLICY_BASENAME), '{}');
    writeFileSync(join(dir, LEGACY_ALLOWLIST_BASENAME), '{}'); // 旧名遗存同保护
    // 子路径员在场形：serve/ 子目录 + daemon.log（daemon 形真实落位形态）
    mkdirSync(join(dir, 'serve'), { recursive: true });
    writeFileSync(join(dir, 'serve/daemon.log'), 'log');
    expect(sensitiveReadFiles(dir)).toEqual([
      join(dir, 'secret.key'),
      join(dir, TOOL_POLICY_BASENAME),
      join(dir, LEGACY_ALLOWLIST_BASENAME),
      join(dir, 'serve/daemon.log'),
    ]);
  });

  it('serve/daemon.log 子路径员 canonical 派生（CL-1——集员自「直下 basename」扩为「dataDir 相对路径」，serve/ 目录缺席时回退最近在场祖先仍稳定）', () => {
    const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sens-daemon-')));
    expect(sensitiveReadFiles(dir)).toContain(canonicalPath(join(dir, 'serve/daemon.log')));
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
      join(dir, 'serve/daemon.log'),
    ]);
  });
});
