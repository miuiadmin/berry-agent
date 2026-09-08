/**
 * host/credentials-cmd 测试（c-5——CLI 入口全环）。
 *
 * 真库全环：临时目录 + 真数据目录（secret.key 由入口路径真生成——
 * loadOrCreateSecretKey 同 CLI 真路径）+ 注入输出面收集。逐动词走
 * runCredentialsEntry 完整开库/关库编舞——跨调用落盘耐久（每次入口独立
 * 开关库，add 后另起入口 list 仍见 = 真磁盘往返铁证）。
 *
 * 退出码三态锁：0 成功（含空清单——诚实空非失败）/ 1 执行失败（名缺席、
 * namespace 坏形）/ 用法错归解析层（cli.test.ts 域——本件不重测）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { runCredentialsEntry } from './credentials-cmd.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-cred-cli-test-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 入口速记（输出面收集 + 临时库/数据目录注入） */
async function runCli(
  sub: Parameters<typeof runCredentialsEntry>[0],
): Promise<{ code: number; out: string[]; errLines: string[] }> {
  const out: string[] = [];
  const errLines: string[] = [];
  const code = await runCredentialsEntry(sub, {
    dbPath: join(dir, 'cli.db'),
    dataDir: join(dir, 'data'),
    writeOut: (text) => out.push(text),
    writeErr: (text) => errLines.push(text),
  });
  return { code, out, errLines };
}

describe('credentials CLI 入口全环', () => {
  it('空表 list 退 0（诚实空非失败）', async () => {
    const { code, out } = await runCli({ sub: 'list' });
    expect(code).toBe(0);
    expect(out[out.length - 1]).toContain('无凭证');
  });

  it('add 退 0 → 跨入口 list 见名（真磁盘耐久）+ 值永不入输出', async () => {
    const added = await runCli({ sub: 'add', name: 'anthropic', value: 'sk-cli-secret-31d' });
    expect(added.code).toBe(0);
    expect(added.out[added.out.length - 1]).toContain('host/anthropic');
    expect(added.out.join('\n')).not.toContain('sk-cli-secret-31d'); // 铁律：值不回显

    // 另起入口（独立开/关库）——落盘耐久铁证
    const listed = await runCli({ sub: 'list' });
    expect(listed.code).toBe(0);
    const text = listed.out.join('\n');
    expect(text).toContain('host  anthropic  来源 manual');
    expect(text).not.toContain('sk-cli-secret-31d');
  });

  it('add plugin 域旗标 + rm 命中退 0 → list 归空', async () => {
    expect((await runCli({ sub: 'add', name: 'deploy', value: 'v', namespace: 'plugin:demo' })).code).toBe(0);
    expect((await runCli({ sub: 'rm', name: 'deploy', namespace: 'plugin:demo' })).code).toBe(0);
    const listed = await runCli({ sub: 'list' });
    expect(listed.out[listed.out.length - 1]).toContain('无凭证');
  });

  it('rm 缺席退 1（CREDENTIALS_NOT_FOUND 折文本——结算文本含原因不另打行）', async () => {
    const { code, out, errLines } = await runCli({ sub: 'rm', name: 'ghost' });
    expect(code).toBe(1);
    expect(out[out.length - 1]).toContain('CREDENTIALS_NOT_FOUND');
    // stderr 只容 persist 迁移/权限自检 warn（新库首开 v1→v7 链）——无失败行
    expect(errLines.filter((line) => !line.startsWith('warn：'))).toEqual([]);
  });

  it('坏形 namespace 退 1（值域执法归命令件单源——同码分流）', async () => {
    const { code, out } = await runCli({ sub: 'add', name: 'x', value: 'v', namespace: 'team' });
    expect(code).toBe(1);
    expect(out[out.length - 1]).toContain('CREDENTIALS_NAMESPACE_DENIED');
  });
});
