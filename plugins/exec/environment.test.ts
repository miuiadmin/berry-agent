/**
 * environment 披露段 git 摘要测试（真 git 本地仓——零网络；坏形/非仓库 → null
 * 降级不抛）。git 提交身份走 `-c` 内联配置（不写全局 config——测试零残留）。
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { gitSummary } from './environment.js';
import { createSpawnPipeline } from './spawn.js';

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.map((dir) => rm(dir, { recursive: true, force: true })));
  cleanups.length = 0;
});

/** 真仓夹具：init + 首提交（-c 内联身份） */
async function makeRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'berry-exec-git-'));
  cleanups.push(dir);
  const pipeline = createSpawnPipeline();
  const run = async (argv: readonly string[]) => {
    const result = await pipeline.run({ argv, cwd: dir });
    expect(result.exitCode).toBe(0);
  };
  await run(['git', 'init', '-q']);
  await writeFile(join(dir, 'README.md'), '# test\n', 'utf8');
  await run(['git', 'add', '-A']);
  await run(['git', '-c', 'user.email=test@test', '-c', 'user.name=test', 'commit', '-q', '-m', 'init']);
  return dir;
}

describe('gitSummary git 摘要', () => {
  it('干净仓——分支非空、零脏、零 ahead/behind', { timeout: 30_000 }, async () => {
    const dir = await makeRepo();
    const summary = await gitSummary(dir, createSpawnPipeline());
    expect(summary).not.toBeNull();
    expect(summary?.branch.length ?? 0).toBeGreaterThan(0);
    expect(summary?.dirtyCount).toBe(0);
    expect(summary?.ahead).toBe(0);
    expect(summary?.behind).toBe(0);
  });

  it('未跟踪文件计入脏数', { timeout: 30_000 }, async () => {
    const dir = await makeRepo();
    await writeFile(join(dir, 'untracked.txt'), 'x', 'utf8');
    const summary = await gitSummary(dir, createSpawnPipeline());
    expect(summary?.dirtyCount).toBe(1);
  });

  it('非 git 目录 → null（披露缺席不抛）', { timeout: 15_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-exec-nogit-'));
    cleanups.push(dir);
    const summary = await gitSummary(dir, createSpawnPipeline());
    expect(summary).toBeNull();
  });
});
