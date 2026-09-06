/**
 * spawn 管道测试（04 §11 六条款真进程腿：失败二分/树杀/三源竞速/保尾/env
 * 白名单/登记簿）。真 spawn 用 process.execPath（node 自身）——零外部依赖、
 * 零网络；进程组树杀用「孙进程存活证」（child 中转 spawn grandchild，超时后
 * 孙进程必须死——证明杀的是组不是单进程）。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execPath } from 'node:process';
import { realpathSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { createSpawnPipeline, isPidAlive } from './spawn.js';
import type { SpawnPipeline } from './types.js';

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.map((dir) => rm(dir, { recursive: true, force: true })));
  cleanups.length = 0;
});

/** 轮询直至谓词真（deadline 毫秒） */
async function until(predicate: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 20));
  }
  expect.unreachable('轮询超时');
}

/** 惰跑脚本（setInterval 空转——自然存活直到被杀） */
const SPIN = 'setInterval(() => {}, 1000);';

describe('createSpawnPipeline spawn 管道', () => {
  it('自然退出——stdout/stderr 归位、退出码透传', async () => {
    const pipeline = createSpawnPipeline();
    const result = await pipeline.run({
      argv: [execPath, '-e', "process.stdout.write('out-42'); process.stderr.write('err-7');"],
    });
    expect(result.outcome).toBe('exit');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('out-42');
    expect(result.stderr).toBe('err-7');
    expect(result.truncated).toBe(false);
  });

  it('执行阶段失败分报——exitCode 3 正常结算（不抛）', async () => {
    const pipeline = createSpawnPipeline();
    const result = await pipeline.run({ argv: [execPath, '-e', 'process.exit(3)'] });
    expect(result.outcome).toBe('exit');
    expect(result.exitCode).toBe(3);
  });

  it('失败二分前者——可执行不存在抛 EXEC_SPAWN_FAILED', async () => {
    const pipeline = createSpawnPipeline();
    await expect(pipeline.run({ argv: ['/nonexistent/binary-definitely-not-here', '--flag'] })).rejects.toMatchObject({
      code: 'EXEC_SPAWN_FAILED',
    });
  });

  it('空 argv 防御——EXEC_SPAWN_FAILED 前置', async () => {
    const pipeline = createSpawnPipeline();
    await expect(pipeline.run({ argv: [] })).rejects.toMatchObject({ code: 'EXEC_SPAWN_FAILED' });
  });

  it('cwd 生效（缺省进程 cwd）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-exec-cwd-'));
    cleanups.push(dir);
    const pipeline = createSpawnPipeline();
    const result = await pipeline.run({
      argv: [execPath, '-e', 'process.stdout.write(process.cwd())'],
      cwd: dir,
    });
    // macOS /var → /private/var 符号链解析——真值比对用 realpath
    expect(result.stdout).toBe(realpathSync(dir));
  });

  it('超时归因 timeout——预算到点进程组树杀、退出码 null', { timeout: 10_000 }, async () => {
    const pipeline = createSpawnPipeline();
    const result = await pipeline.run({
      argv: [execPath, '-e', SPIN],
      timeoutMs: 400,
    });
    expect(result.outcome).toBe('timeout');
    expect(result.exitCode).toBeNull();
    expect(result.durationMs).toBeGreaterThanOrEqual(390);
  });

  it('打断归因 abort——AbortSignal 三源竞速胜出', { timeout: 10_000 }, async () => {
    const pipeline = createSpawnPipeline();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const result = await pipeline.run({
      argv: [execPath, '-e', SPIN],
      signal: controller.signal,
      timeoutMs: 60_000,
    });
    expect(result.outcome).toBe('abort');
    expect(result.exitCode).toBeNull();
  });

  it('自然退出先到——timeout 到点时已结算即摘（归因不被改写）', { timeout: 10_000 }, async () => {
    const pipeline = createSpawnPipeline();
    // 短命进程 + 长预算：自然退出必胜，timer 在 close 时被清（不误报）
    const result = await pipeline.run({
      argv: [execPath, '-e', "process.stdout.write('done')"],
      timeoutMs: 30_000,
    });
    expect(result.outcome).toBe('exit');
    expect(result.stdout).toBe('done');
  });

  it('预中止请求——不造进程直接结算 abort', async () => {
    const pipeline = createSpawnPipeline();
    const controller = new AbortController();
    controller.abort();
    const result = await pipeline.run({ argv: [execPath, '-e', SPIN], signal: controller.signal });
    expect(result).toMatchObject({ outcome: 'abort', exitCode: null, durationMs: 0, bytes: 0 });
  });

  it('进程组树杀——孙进程随组死（杀的是组不是单进程）', { timeout: 15_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-exec-tree-'));
    cleanups.push(dir);
    const gpidFile = join(dir, 'gpid');
    const grandScript = join(dir, 'grand.cjs');
    const childScript = join(dir, 'child.cjs');
    await writeFile(
      grandScript,
      `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(gpidFile)}, String(process.pid)); ${SPIN}\n`,
      'utf8',
    );
    await writeFile(
      childScript,
      `const { spawn } = require('node:child_process'); spawn(process.execPath, [${JSON.stringify(grandScript)}], { stdio: 'ignore' }); ${SPIN}\n`,
      'utf8',
    );
    const pipeline = createSpawnPipeline();
    const result = await pipeline.run({ argv: [execPath, childScript], timeoutMs: 500 });
    expect(result.outcome).toBe('timeout');
    await (async () => {
      const deadline = Date.now() + 3_000;
      while (Date.now() < deadline) {
        try {
          const pid = Number(await readFile(gpidFile, 'utf8'));
          if (Number.isFinite(pid) && pid > 0) {
            // 孙进程 pid 落地后验死——组杀证明（孙非直接子，只有组杀够得着）
            await until(() => !isPidAlive(pid), 5_000);
            return;
          }
        } catch {
          // 文件未写完重试
        }
        await new Promise((r) => setTimeout(r, 20));
      }
      expect.unreachable('孙进程 pid 未落地或未被组杀');
    })();
  });

  it('env 白名单集成——子进程只见 allow 面，宿主凭证缺席', async () => {
    const pipeline = createSpawnPipeline({
      hostEnv: { ...process.env, BERRY_TEST_SECRET_SENTINEL: 'leak-me' },
    });
    const result = await pipeline.run({
      argv: [execPath, '-e', 'process.stdout.write(JSON.stringify(Object.keys(process.env)))'],
    });
    const keys = JSON.parse(result.stdout) as string[];
    expect(keys).not.toContain('BERRY_TEST_SECRET_SENTINEL');
    expect(keys).toContain('PATH');
  });

  it('登记簿生命周期——结算后出册（在册快照恒空）', { timeout: 10_000 }, async () => {
    const pipeline = createSpawnPipeline();
    expect(pipeline.registry.list()).toHaveLength(0);
    const running = pipeline.run({ argv: [execPath, '-e', SPIN], timeoutMs: 300 });
    // spawn 是同步发起——一拍后在册
    await new Promise((r) => setTimeout(r, 50));
    expect(pipeline.registry.list()).toHaveLength(1);
    await running;
    expect(pipeline.registry.list()).toHaveLength(0);
  });

  it('输出保尾集成——超帽输出截尾保后半', { timeout: 10_000 }, async () => {
    const pipeline = createSpawnPipeline();
    // 200KiB 输出（每行 1KiB × 200）——远超 60KiB 帽
    const result = await pipeline.run({
      argv: [
        execPath,
        '-e',
        "for (let i = 0; i < 200; i++) process.stdout.write(String(i).padStart(6, '0') + '.' + 'x'.repeat(1018) + '\\n')",
      ],
    });
    expect(result.outcome).toBe('exit');
    expect(result.truncated).toBe(true);
    expect(result.bytes).toBeGreaterThan(60 * 1024);
    // 保尾：尾部行号在场、头部行号缺席
    expect(result.stdout).toContain('000199');
    expect(result.stdout.startsWith('000000')).toBe(false);
  });
});

/** SpawnPipeline 类型锚（防公共面漂移的编译期断言） */
export type _PipelineShape = SpawnPipeline;
