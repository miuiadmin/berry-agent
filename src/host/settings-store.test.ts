/**
 * host/settings-store 测试——数据目录用户配置文件读写件（04 §9 ⑥·M3 兜缝
 * ——ap-3）。覆盖：读侧缺席/好形/文件级坏 JSON 降级/键级坏值忽略点名/
 * 未知键 warn 不动文件；写侧合并保留未知键/原子替换不留 tmp 残/坏形期拒写。
 *
 * 真盘临时目录（文件 IO 件全栈惯例——tool-policy-store.test 同形）。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { readHostSettings, SETTINGS_BASENAME, writeHostSettings } from './settings-store.js';

/** 临时数据目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function captureWarn(): { warnings: string[]; warn: (m: string) => void } {
  const warnings: string[] = [];
  return { warnings, warn: (m) => void warnings.push(m) };
}

describe('readHostSettings（读侧——缺席零负担 + 坏形降级）', () => {
  it('文件缺席 = {} + healthy（零负担首启）', () => {
    const dir = tmpDir('settings-absent-');
    const load = readHostSettings(dir);
    expect(load.settings).toEqual({});
    expect(load.healthy).toBe(true);
  });
  it('好形两键读入', () => {
    const dir = tmpDir('settings-good-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ sandboxMode: 'read-only', approvalPolicy: 'ask' }));
    const load = readHostSettings(dir);
    expect(load.settings).toEqual({ sandboxMode: 'read-only', approvalPolicy: 'ask' });
    expect(load.healthy).toBe(true);
  });
  it('文件级坏 JSON = 降级 {} + unhealthy + warn 点名（回写拒依据）', () => {
    const dir = tmpDir('settings-badjson-');
    writeFileSync(join(dir, SETTINGS_BASENAME), '{not json');
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings).toEqual({});
    expect(load.healthy).toBe(false);
    expect(warnings.some((w) => w.includes('JSON 解析失败'))).toBe(true);
  });
  it('顶层非对象 = 坏形同降级', () => {
    const dir = tmpDir('settings-array-');
    writeFileSync(join(dir, SETTINGS_BASENAME), '[1,2]');
    const { warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.healthy).toBe(false);
    expect(load.settings).toEqual({});
  });
  it('键级坏值 = 忽略该键 + warn 点名（好键照常生效）', () => {
    const dir = tmpDir('settings-badkey-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ sandboxMode: 'yolo', approvalPolicy: 'never' }));
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.healthy).toBe(true);
    expect(load.settings).toEqual({ approvalPolicy: 'never' });
    expect(warnings.some((w) => w.includes('sandboxMode 值域外'))).toBe(true);
  });
  it('未知键 = warn 不动文件（读侧不消费不剔除）', () => {
    const dir = tmpDir('settings-unknown-');
    const raw = JSON.stringify({ sandboxMode: 'danger', futureKnob: 42 });
    writeFileSync(join(dir, SETTINGS_BASENAME), raw);
    const { warnings, warn } = captureWarn();
    const load = readHostSettings(dir, { warn });
    expect(load.settings).toEqual({ sandboxMode: 'danger' });
    expect(warnings.some((w) => w.includes('futureKnob'))).toBe(true);
    // 文件未被动——原始字节往返保真
    expect(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')).toBe(raw);
  });
});

describe('writeHostSettings（写侧——合并保留 + 原子 + 坏形拒）', () => {
  it('合并写只动两键：未知键原样保留（用户手编面不损毁）', () => {
    const dir = tmpDir('settings-merge-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ futureKnob: 42, sandboxMode: 'read-only' }, null, 2));
    const result = writeHostSettings(dir, { sandboxMode: 'workspace-write', approvalPolicy: 'ask' });
    expect(result).toBe('written');
    const doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ futureKnob: 42, sandboxMode: 'workspace-write', approvalPolicy: 'ask' });
  });
  it('缺席键不动现状（预设展开只写该预设携带的旋钮）', () => {
    const dir = tmpDir('settings-partial-');
    writeFileSync(join(dir, SETTINGS_BASENAME), JSON.stringify({ approvalPolicy: 'never' }));
    writeHostSettings(dir, { sandboxMode: 'read-only' });
    const doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ approvalPolicy: 'never', sandboxMode: 'read-only' });
  });
  it('文件缺席直接造（首启落盘）', () => {
    const dir = tmpDir('settings-create-');
    const result = writeHostSettings(dir, { sandboxMode: 'workspace-write' });
    expect(result).toBe('written');
    const doc = JSON.parse(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')) as Record<string, unknown>;
    expect(doc).toEqual({ sandboxMode: 'workspace-write' });
  });
  it('原子替换不留 tmp 残（撕裂窗口不暴露半文件）', () => {
    const dir = tmpDir('settings-atomic-');
    writeHostSettings(dir, { sandboxMode: 'danger' });
    const leftovers = readdirSync(dir).filter((name) => name.includes('.tmp'));
    expect(leftovers).toEqual([]);
    // 尾随换行稳定（prettier 式 JSON 落盘面）
    expect(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8').endsWith('\n')).toBe(true);
  });
  it('文件级坏形期拒写（rejected——机器不在坏文件上覆写扩大破坏）', () => {
    const dir = tmpDir('settings-reject-');
    writeFileSync(join(dir, SETTINGS_BASENAME), '{broken');
    expect(writeHostSettings(dir, { sandboxMode: 'read-only' })).toBe('rejected');
    // 原文件字节不动
    expect(readFileSync(join(dir, SETTINGS_BASENAME), 'utf8')).toBe('{broken');
  });
  it('非敏感件自证：文件名不在 settings 面（SENSITIVE_READ_BASENAMES 恰三件锁不动——此例锁对面）', () => {
    // settings.json 非敏感（两旋钮无秘密）——可读性自证：写后文件存在且可读
    const dir = tmpDir('settings-plain-');
    writeHostSettings(dir, { approvalPolicy: 'ask' });
    expect(existsSync(join(dir, SETTINGS_BASENAME))).toBe(true);
  });
});
