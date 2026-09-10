/**
 * paths 测试——主库归属三级梯子（05 §6.7）+ 数据目录权限自检（05 §6.6）。
 */
import { mkdtempSync, rmSync, statSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DATA_DIR_ENV,
  DB_PATH_ENV,
  ensureDataDir,
  repairFileMode,
  resolveDataDir,
  resolveDatabasePath,
  resolveDatabasePathIn,
} from './paths.js';

/** 测试期改 env 须存还原（vitest 单 node 轨进程共享——勿污染兄弟用例） */
const savedDataDir = process.env[DATA_DIR_ENV];
const savedDbPath = process.env[DB_PATH_ENV];

beforeEach(() => {
  delete process.env[DATA_DIR_ENV];
  delete process.env[DB_PATH_ENV];
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env[DATA_DIR_ENV];
  else process.env[DATA_DIR_ENV] = savedDataDir;
  if (savedDbPath === undefined) delete process.env[DB_PATH_ENV];
  else process.env[DB_PATH_ENV] = savedDbPath;
});

describe('主库归属三级梯子', () => {
  it('缺省层：~/.berry-agent/sessions.db', () => {
    expect(resolveDataDir()).toBe(join(process.env.HOME ?? '', '.berry-agent'));
    expect(resolveDatabasePath()).toBe(join(resolveDataDir(), 'sessions.db'));
  });

  it('第 1 级：BERRY_AGENT_DATA_DIR 整目录覆盖', () => {
    process.env[DATA_DIR_ENV] = '/tmp/custom-dir';
    expect(resolveDataDir()).toBe('/tmp/custom-dir');
    expect(resolveDatabasePath()).toBe('/tmp/custom-dir/sessions.db');
  });

  it('第 2 级：BERRY_AGENT_DB_PATH 完整文件路径优先于数据目录拼接', () => {
    process.env[DATA_DIR_ENV] = '/tmp/dir-a';
    process.env[DB_PATH_ENV] = '/elsewhere/other.db';
    expect(resolveDatabasePath()).toBe('/elsewhere/other.db');
    // 数据目录解析不受库文件覆盖影响（secret.key 归属地仍是数据目录）
    expect(resolveDataDir()).toBe('/tmp/dir-a');
  });

  it('空白 env 值视为未设置（trim 判空）', () => {
    process.env[DATA_DIR_ENV] = '   ';
    expect(resolveDataDir()).toBe(join(process.env.HOME ?? '', '.berry-agent'));
  });
});

describe('锚定数据目录形（resolveDatabasePathIn——装配根显式 dataDir 位）', () => {
  it('显式 dataDir 锚定库位（显式参数 > env DATA_DIR——库与 secret.key 同目录不分家）', () => {
    // env 指向别处也不吞显式目录（原先装配根只传 dataDir 而 dbPath 走 env
    // 梯子——库开错位、与 secret.key 分家；本例即其回归锁）
    process.env[DATA_DIR_ENV] = '/tmp/env-dir';
    expect(resolveDatabasePathIn('/tmp/explicit-dir')).toBe('/tmp/explicit-dir/sessions.db');
  });

  it('DB_PATH 单文件级覆盖在场恒赢（tier-2 不被目录锚定吞掉）', () => {
    process.env[DB_PATH_ENV] = '/elsewhere/tier2.db';
    expect(resolveDatabasePathIn('/tmp/explicit-dir')).toBe('/elsewhere/tier2.db');
    // 空白值视为未设置——回落目录锚定
    process.env[DB_PATH_ENV] = '  ';
    expect(resolveDatabasePathIn('/tmp/explicit-dir')).toBe('/tmp/explicit-dir/sessions.db');
  });
});

describe('数据目录与文件权限自检修复', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'berry-agent-paths-test-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('ensureDataDir 建目录并执法 0700', () => {
    const target = join(dir, 'nested', 'data');
    const warns: string[] = [];
    ensureDataDir(target, (m) => warns.push(m));
    expect(statSync(target).mode & 0o777).toBe(0o700);
    expect(warns).toEqual([]);
  });

  it('权限偏宽的在场目录被修复 + warn', () => {
    const target = join(dir, 'loose');
    ensureDataDir(target, () => undefined);
    chmodSync(target, 0o755);
    const warns: string[] = [];
    ensureDataDir(target, (m) => warns.push(m));
    expect(statSync(target).mode & 0o777).toBe(0o700);
    expect(warns.join('\n')).toContain('已修复');
  });

  it('repairFileMode 文件 0600 修复', async () => {
    const { writeFileSync } = await import('node:fs');
    const file = join(dir, 'secret.key');
    writeFileSync(file, Buffer.alloc(32), { mode: 0o644 });
    const warns: string[] = [];
    repairFileMode(file, '密钥文件', (m) => warns.push(m));
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(warns.length).toBe(1);
  });
});
