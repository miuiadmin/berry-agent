/**
 * 子进程登记簿与孤儿清扫测试（04 §11：写面容错/tmp+rename 原子写/回填后清扫/
 * hostPid 判活/命令行验真 pid 复用防线）。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Logger } from '../context/index.js';
import { createProcessRegistry, sweepOrphans } from './registry.js';
import type { ProcessEntry, SweepDeps } from './types.js';

/** 测试 logger 桩（warn 收集面） */
function testLogger(): Logger & { warns: string[] } {
  const warns: string[] = [];
  return {
    module: 'exec',
    debug: () => {},
    info: () => {},
    warn: (msg: string) => {
      warns.push(msg);
    },
    error: () => {},
    warns,
  };
}

/** 轮询直至谓词真或超时（容错异步持久化的确定性等待面） */
async function until(predicate: () => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect.unreachable('轮询超时');
}

/** 夹具条目工厂 */
function entry(overrides: Partial<ProcessEntry> = {}): ProcessEntry {
  return {
    pid: 100,
    argv: ['/bin/sleep', '30'],
    owner: 'test',
    hostPid: 1,
    startedAt: 0,
    ...overrides,
  };
}

/** 可编程清扫依赖桩 */
function stubDeps(overrides: Partial<SweepDeps> = {}): SweepDeps & { killed: number[] } {
  const killed: number[] = [];
  return {
    isAlive: () => false,
    readCmdline: () => null,
    killTree: (pid) => {
      killed.push(pid);
    },
    killed,
    ...overrides,
  };
}

const cleanups: string[] = [];
afterEach(async () => {
  await Promise.all(cleanups.map((dir) => rm(dir, { recursive: true, force: true })));
  cleanups.length = 0;
});

describe('createProcessRegistry 登记簿', () => {
  it('add/list/remove 基本面（remove 幂等）', () => {
    const registry = createProcessRegistry();
    const e1 = entry({ pid: 11 });
    const e2 = entry({ pid: 22 });
    registry.add(e1);
    registry.add(e2);
    expect(registry.list().map((e) => e.pid)).toEqual([11, 22]);
    registry.remove(11);
    registry.remove(11); // 幂等
    expect(registry.list().map((e) => e.pid)).toEqual([22]);
  });

  it('持久化走 tmp+rename（正身文件即终态 JSON 数组）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-exec-reg-'));
    cleanups.push(dir);
    const file = join(dir, 'registry.json');
    const registry = createProcessRegistry({ filePath: file, logger: testLogger() });
    registry.add(entry({ pid: 33 }));
    // 轮询文件出现（持久化是容错异步——写终态即证 tmp+rename 落正身）
    await (async () => {
      for (let i = 0; i < 100; i++) {
        try {
          const raw = await readFile(file, 'utf8');
          const parsed = JSON.parse(raw) as ProcessEntry[];
          expect(parsed.map((e) => e.pid)).toEqual([33]);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 10));
        }
      }
      expect.unreachable('持久化文件未落地');
    })();
    registry.remove(33);
  });

  it('写面容错：持久化失败降 warn 不抛（内存账仍准）', async () => {
    const logger = testLogger();
    // 不存在目录下的文件——writeFile 必败
    const registry = createProcessRegistry({
      filePath: '/nonexistent-dir-xyz/registry.json',
      logger,
    });
    expect(() => registry.add(entry({ pid: 44 }))).not.toThrow();
    expect(registry.list().map((e) => e.pid)).toEqual([44]);
    await until(() => logger.warns.length > 0);
    expect(logger.warns[0]).toContain('登记簿持久化失败');
  });
});

describe('sweepOrphans 孤儿清扫', () => {
  it('宿主已死 + 命令行相符 → 树杀 + 出册；宿主仍活 → 保留', async () => {
    const deps = stubDeps({
      // pid 100 = 孤儿本身活着；pid 999 = 并发条目的宿主活着；宿主 1 已死
      isAlive: (pid) => pid === 100 || pid === 999,
      readCmdline: () => '/bin/sleep 30',
    });
    const registry = createProcessRegistry({ hostPid: 2, logger: testLogger() });
    const dead = entry({ pid: 100, hostPid: 1 });
    const live = entry({ pid: 200, hostPid: 999 });
    registry.add(dead);
    registry.add(live);
    const report = await sweepOrphans(registry, { hostPid: 2, logger: testLogger() }, deps);
    expect(report.killed).toBe(1);
    expect(report.removed).toBe(1);
    expect(deps.killed).toEqual([100]);
    expect(registry.list().map((e) => e.pid)).toEqual([200]);
  });

  it('本宿主条目（hostPid === 宿主）保留——并发实例活账同理', async () => {
    const deps = stubDeps({ isAlive: () => true });
    const registry = createProcessRegistry({ hostPid: 2, logger: testLogger() });
    registry.add(entry({ pid: 100, hostPid: 2 }));
    const report = await sweepOrphans(registry, { hostPid: 2, logger: testLogger() }, deps);
    expect(report).toEqual({ killed: 0, skipped: 0, removed: 0 });
    expect(deps.killed).toEqual([]);
    expect(registry.list()).toHaveLength(1);
  });

  it('命令行不符 → 跳过树杀（pid 复用防线——宁漏杀不误杀）且保留在册', async () => {
    const logger = testLogger();
    const deps = stubDeps({
      isAlive: (pid) => pid === 100,
      readCmdline: () => '/usr/sbin/httpd -DFOREGROUND', // pid 已被无辜进程复用
    });
    const registry = createProcessRegistry({ hostPid: 2, logger });
    registry.add(entry({ pid: 100, hostPid: 1 }));
    const report = await sweepOrphans(registry, { hostPid: 2, logger }, deps);
    expect(report.skipped).toBe(1);
    expect(report.killed).toBe(0);
    expect(deps.killed).toEqual([]);
    expect(logger.warns.some((w) => w.includes('pid 复用'))).toBe(true);
    // 跳过 = 保守保留（孤儿去向未知不丢账）
    expect(registry.list()).toHaveLength(1);
  });

  it('孤儿进程本身已死 → 纯出册不树杀', async () => {
    const deps = stubDeps({ isAlive: () => false, readCmdline: () => null });
    const registry = createProcessRegistry({ hostPid: 2, logger: testLogger() });
    registry.add(entry({ pid: 100, hostPid: 1 }));
    const report = await sweepOrphans(registry, { hostPid: 2, logger: testLogger() }, deps);
    expect(report.killed).toBe(0);
    expect(report.removed).toBe(1);
    expect(registry.list()).toHaveLength(0);
  });

  it('残留文件回填语义——清扫后活账仍在文件（不抹并发实例账本）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-exec-sweep-'));
    cleanups.push(dir);
    const file = join(dir, 'registry.json');
    // 上代遗产（宿主 1 已死、pid 100 已死）+ 并发实例活账（宿主 999 活）
    await writeFile(
      file,
      `${JSON.stringify([entry({ pid: 100, hostPid: 1 }), entry({ pid: 200, hostPid: 999 })])}\n`,
      'utf8',
    );
    const deps = stubDeps({ isAlive: (pid) => pid === 999 });
    const registry = createProcessRegistry({ filePath: file, hostPid: 2, logger: testLogger() });
    const report = await sweepOrphans(registry, { hostPid: 2, filePath: file, logger: testLogger() }, deps);
    expect(report.removed).toBe(1);
    // 文件终态只余活账（内存快照单源——回填语义的持久化腿）
    await (async () => {
      for (let i = 0; i < 100; i++) {
        try {
          const parsed = JSON.parse(await readFile(file, 'utf8')) as ProcessEntry[];
          if (parsed.length === 1) {
            expect(parsed[0]?.pid).toBe(200);
            return;
          }
        } catch {
          // 写入竞态重试
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect.unreachable('活账未保留在文件');
    })();
  });

  it('残留文件坏 JSON → 空册起步 warn 不抛', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-exec-sweep-'));
    cleanups.push(dir);
    const file = join(dir, 'registry.json');
    await writeFile(file, '{not-json', 'utf8');
    const logger = testLogger();
    const registry = createProcessRegistry({ hostPid: 2, logger });
    const deps = stubDeps();
    const report = await sweepOrphans(registry, { hostPid: 2, filePath: file, logger }, deps);
    expect(report).toEqual({ killed: 0, skipped: 0, removed: 0 });
    expect(logger.warns.some((w) => w.includes('空册起步'))).toBe(true);
    expect(registry.list()).toHaveLength(0);
  });

  it('无 filePath（纯内存账）→ 空扫不读不抛', async () => {
    const registry = createProcessRegistry({ hostPid: 2, logger: testLogger() });
    const report = await sweepOrphans(registry, { hostPid: 2 }, stubDeps());
    expect(report).toEqual({ killed: 0, skipped: 0, removed: 0 });
  });
});
