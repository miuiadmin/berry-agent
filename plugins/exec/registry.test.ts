/**
 * 子进程登记簿与孤儿清扫测试（04 §11：写面容错/tmp+rename 原子写/回填后清扫/
 * hostPid 判活/命令行验真 pid 复用防线）。
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { Logger } from '../../src/context/index.js';
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

/**
 * 轮询直至登记簿文件解析形过谓词（跨实例增量持久化测试的确定性等待面：
 * persistChain 是 fire-and-forget——文件即终态观测位）。
 */
async function untilFile(file: string, predicate: (parsed: ProcessEntry[]) => boolean, ms = 2000): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as ProcessEntry[];
      if (predicate(parsed)) return;
    } catch {
      // 未落地/写入竞态窗内中间态——重试
    }
    if (Date.now() > deadline) expect.unreachable('轮询超时（文件未达谓词形）');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * 轮询直至文件内容跨两次间隔读相等后返回终态文本（fire-and-forget 持久化链
 * 的排干面——字节级断言前必排干，立即比对会撞「写未落地」假形）。
 */
async function untilStableFile(file: string, intervalMs = 150): Promise<string> {
  let prev = await readFile(file, 'utf8');
  for (;;) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const next = await readFile(file, 'utf8');
    if (next === prev) return next;
    prev = next;
  }
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
// 清理带 retries：持久化是容错 fire-and-forget（persistChain 承诺链），
// 测试体返回后链上仍可能有在飞的 tmp 写+rename——与 rm(recursive) 并发时
// node 的 rimraf 形末步 rmdir 会撞 ENOTEMPTY（macOS CI run 35180264294 偶发
// 红实证；本机 2000 轮复现撞率 26%）。maxRetries/retryDelay 让目录删除对
// 瞬态非空自动重试（node:fs rm 对 ENOTEMPTY/EBUSY/EPERM 目录错生效——键名
// 是 retryDelay 非 retryAfter，RmOptions 无 after 键，笔误即 TS2353 红）。
afterEach(async () => {
  await Promise.all(cleanups.map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })));
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
    // 再轮询终态空数组——remove 触发的末笔持久化也是 fire-and-forget，若不
    // 排干就进 afterEach，迟到的 tmp 写+rename 会与目录清理并发（ENOTEMPTY
    // 竞态主源——registry 无 close/flush 面，轮询终态即测试侧的确定性排干）；
    // 兼作断言强化：出册同样走 tmp+rename 落正身
    await (async () => {
      for (let i = 0; i < 100; i++) {
        try {
          const parsed = JSON.parse(await readFile(file, 'utf8')) as ProcessEntry[];
          if (parsed.length === 0) return;
        } catch {
          // 末笔未落地重试（写入竞态窗内可能读到中间态）
        }
        await new Promise((r) => setTimeout(r, 10));
      }
      expect.unreachable('remove 的持久化终态未落地');
    })();
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

  it('敏感产物落盘 0600（05 §6.6——60 轮 L2 批扩列）：登记簿 tmp 写位 mode 随 rename 承袭终名', async () => {
    // 修前红：persist writeFile(tmp, …, 'utf8') 无 mode——缺省 0666 & ~umask
    //（钉 022 下即 0644）。登记簿是全量 argv 审计面（命令行即操作者意图明
    // 文）——05 §6.6 敏感产物族建即 0600：mode 落 tmp 写位、随 rename 承袭
    // 终名；「建即」辖建时点，在场旧文件不追溯。钉宽 umask 防 CI 窄 umask
    //（077）下修前形恰好 0600 假绿；修后显式 0600 位不受 umask 放宽。
    const dir = await mkdtemp(join(tmpdir(), 'berry-exec-mode-'));
    cleanups.push(dir);
    const file = join(dir, 'children.json');
    const prevUmask = process.umask(0o022);
    try {
      const registry = createProcessRegistry({ filePath: file, logger: testLogger() });
      registry.add(entry({ pid: 55 }));
      // 持久化是容错 fire-and-forget——轮询正身落地即 tmp+rename 已完成
      await until(() => existsSync(file));
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(prevUmask);
    }
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

  // ── 清扫收尾投影（04 §11 73 轮批注「清扫回执呈现链兑现」）──────────────
  // 修前红：killed/removed 两档零呈现——SweepReport 唯一调用位被 void 吞、
  // 树杀成功路径零日志，「上代遗留孤儿被本代树杀 N 个」与「无孤儿」启动后
  // 同形不可区分（无人值守产品对进程组 SIGKILL 零痕迹可审计）。修后：收尾
  // 投影 warn 恰一笔汇总行（标签 [EXEC_ORPHAN_SWEEP]——日志标签形）。
  it('树杀非零 → 收尾投影恰一笔汇总行：三计数 + 被杀条目 pid/命令行随行', async () => {
    const logger = testLogger();
    const deps = stubDeps({
      // pid 100 = 活孤儿（命令行相符树杀）；pid 101 = 活孤儿但命令行不符（跳过档）
      isAlive: (pid) => pid === 100 || pid === 101,
      readCmdline: (pid) => (pid === 100 ? '/bin/sleep 30' : '/usr/sbin/httpd -DFOREGROUND'),
    });
    const registry = createProcessRegistry({ hostPid: 2, logger });
    registry.add(entry({ pid: 100, hostPid: 1, argv: ['/bin/sleep', '30'] }));
    registry.add(entry({ pid: 101, hostPid: 1, argv: ['/bin/sleep', '60'] }));
    await sweepOrphans(registry, { hostPid: 2, logger }, deps);
    // 恰一笔：标签行全 warn 流恰一条（skipped 档逐条 warn 不带标签——不并笔）
    const summaries = logger.warns.filter((w) => w.includes('[EXEC_ORPHAN_SWEEP]'));
    expect(summaries).toHaveLength(1);
    // 三计数随行（killed/skipped/removed——SweepReport 汇总面）
    expect(summaries[0]).toContain('树杀 1');
    expect(summaries[0]).toContain('跳过 1');
    expect(summaries[0]).toContain('出册 1');
    // 被杀条目 pid + 命令行随行（审计载荷——登记簿快照覆写后前态不可考）
    expect(summaries[0]).toContain('pid=100');
    expect(summaries[0]).toContain('/bin/sleep 30');
  });

  it('killed=0 且 removed>0（孤儿本身已死纯出册）→ 汇总行仍恰一笔、无被杀条目尾段', async () => {
    const logger = testLogger();
    const deps = stubDeps({ isAlive: () => false, readCmdline: () => null });
    const registry = createProcessRegistry({ hostPid: 2, logger });
    registry.add(entry({ pid: 100, hostPid: 1 }));
    await sweepOrphans(registry, { hostPid: 2, logger }, deps);
    const summaries = logger.warns.filter((w) => w.includes('[EXEC_ORPHAN_SWEEP]'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('出册 1');
    expect(summaries[0]).not.toContain('被杀条目'); // 零杀纯出册——无条目尾段
  });

  // ── 清扫汇总行尾段帽（04 §11 75 轮批注——尾段留样帽 5）──────────────────
  // 修前红：被杀条目全量 map·join 无帽——上代崩溃遗留大量孤儿时单行 warn 数十
  // KB 起（cmdline 全长 KB 级/条），进程日志（树杀动作唯一可审计面）可读性双损。
  it('尾段留样帽 5：清扫 7 孤儿 → 汇总行恰含前 5 条 + 「另 2 条未列」，句首 killed 计数恒全量 7（修前红：全量列出无帽语）', async () => {
    const logger = testLogger();
    const pids = [100, 101, 102, 103, 104, 105, 106];
    // 宿主 pid 1 已死、孤儿 pid 全活且命令行相符（stub 桩——注入位 mock 合规）
    const deps = stubDeps({ isAlive: (pid) => pid >= 100, readCmdline: () => '/bin/sleep 30' });
    const registry = createProcessRegistry({ hostPid: 2, logger });
    for (const pid of pids) registry.add(entry({ pid, hostPid: 1, argv: ['/bin/sleep', '30'] }));
    await sweepOrphans(registry, { hostPid: 2, logger }, deps);
    const summaries = logger.warns.filter((w) => w.includes('[EXEC_ORPHAN_SWEEP]'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('树杀 7'); // 句首计数恒全量（计数保全）
    expect(deps.killed).toHaveLength(7); // 树杀动作本身不受帽影响（帽只辖呈现）
    for (const pid of pids.slice(0, 5)) expect(summaries[0]).toContain(`pid=${pid}`); // 前 5 留样
    for (const pid of pids.slice(5)) expect(summaries[0]).not.toContain(`pid=${pid}`); // 超量不列
    expect(summaries[0]).toContain('另 2 条未列'); // 超量段（N = 7 - 5）
  });

  it('恰 5 条边界：5 条全列、无「另 N」段（帽 = 计数——零省略零帽语）', async () => {
    const logger = testLogger();
    const deps = stubDeps({ isAlive: (pid) => pid >= 100, readCmdline: () => '/bin/sleep 30' });
    const registry = createProcessRegistry({ hostPid: 2, logger });
    for (let pid = 100; pid < 105; pid += 1) registry.add(entry({ pid, hostPid: 1, argv: ['/bin/sleep', '30'] }));
    await sweepOrphans(registry, { hostPid: 2, logger }, deps);
    const summaries = logger.warns.filter((w) => w.includes('[EXEC_ORPHAN_SWEEP]'));
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toContain('树杀 5');
    for (let pid = 100; pid < 105; pid += 1) expect(summaries[0]).toContain(`pid=${pid}`); // 5 条全列
    expect(summaries[0]).not.toContain('未列'); // 恰帽——无超量段
  });

  it('全零（无孤儿常态）→ 零投影零噪声', async () => {
    const logger = testLogger();
    const registry = createProcessRegistry({ hostPid: 2, logger });
    await sweepOrphans(registry, { hostPid: 2, logger }, stubDeps());
    expect(logger.warns).toHaveLength(0);
  });
});

/* ── 锁内增量持久化 + 回填零写（03 §5.3 74 轮件1 批注——修前红区）──────────
 * 修前形：persist 整快照覆写（内存 Map 视图即写盘内容）——多宿主并集账被单
 * 进程快照洗掉；sweep 回填走 add 的 persist 路径（回填即重写文件）。
 * 修后形：每笔持久化 = 异步编辑锁 → 锁内重读文件 → 施增量（add=upsert 单条
 * /remove=出册单条）→ tmp+rename 写回；回填 = 纯内存写零持久化。 */
describe('锁内增量持久化（跨进程丢更新防护——74 轮件1）', () => {
  it('跨实例丢更新锁：B 的 add 落账不抹 A 已落账条目（锁内重读并集账——修前红：整快照覆写只剩 B 的条目）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-exec-lost-'));
    cleanups.push(dir);
    const file = join(dir, 'children.json');
    // 实例 A（宿主 1）先落账 pid 11——文件 = 多宿主并集账的既有内容
    const a = createProcessRegistry({ filePath: file, logger: testLogger() });
    a.add(entry({ pid: 11, hostPid: 1 }));
    await untilFile(file, (parsed) => parsed.some((e) => e.pid === 11));
    // 实例 B（同文件、内存账互不可见——并发进程形）add pid 22：修前 B 以己方
    // 快照 [22] 整覆写、A 的 11 被吞；修后锁内重读 [11] 施增量得 [11,22]
    const b = createProcessRegistry({ filePath: file, logger: testLogger() });
    b.add(entry({ pid: 22, hostPid: 1 }));
    await untilFile(file, (parsed) => parsed.some((e) => e.pid === 22));
    const final = JSON.parse(await readFile(file, 'utf8')) as ProcessEntry[];
    expect(final.map((e) => e.pid).sort((x, y) => x - y)).toEqual([11, 22]);
  });

  it('remove 保他账：B 出册自家条目不抹 A 的条目（锁内增量 remove——修前红：整快照覆写终态 []、他账全程不保）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-exec-rmkeep-'));
    cleanups.push(dir);
    const file = join(dir, 'children.json');
    const a = createProcessRegistry({ filePath: file, logger: testLogger() });
    a.add(entry({ pid: 11, hostPid: 1 }));
    await untilFile(file, (parsed) => parsed.some((e) => e.pid === 11));
    const b = createProcessRegistry({ filePath: file, logger: testLogger() });
    b.add(entry({ pid: 22, hostPid: 1 }));
    await untilFile(file, (parsed) => parsed.some((e) => e.pid === 22));
    b.remove(22); // B 内存只有自家 22——修前覆写 [] 吞 11；修后增量 remove 只出 22
    const finalText = await untilStableFile(file);
    const final = JSON.parse(finalText) as ProcessEntry[];
    expect(final.map((e) => e.pid)).toEqual([11]);
  });

  it('sweep 回填零持久化：并发活账回填不重写文件（字节不变——修前红：回填走 add 即整快照紧凑形重写）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-exec-backfill-'));
    cleanups.push(dir);
    const file = join(dir, 'children.json');
    // pretty-print 初文件：任何整快照重写必变字节（紧凑形）——回填零写的红锚
    const original = `${JSON.stringify([entry({ pid: 100, hostPid: 999 })], null, 2)}\n`;
    await writeFile(file, original, 'utf8');
    // 宿主 999 活——该条目是并发实例活账，清扫不动（零裁剪 = 零写位）
    const deps = stubDeps({ isAlive: (pid) => pid === 999 });
    const registry = createProcessRegistry({ filePath: file, hostPid: 2, logger: testLogger() });
    const report = await sweepOrphans(registry, { hostPid: 2, filePath: file, logger: testLogger() }, deps);
    expect(report).toEqual({ killed: 0, skipped: 0, removed: 0 });
    expect(registry.list().map((e) => e.pid)).toEqual([100]); // 回填进内存账
    // 排干后字节原样（修前红：回填 add 触发整快照重写 → 紧凑形 ≠ pretty 初文件）
    expect(await untilStableFile(file)).toBe(original);
  });

  it('锁忙跳过：编辑锁在场（活 pid）→ 本笔持久化跳过 warn 不抛、文件不被无锁写（修前红：无锁直写零 warn）', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'berry-exec-lockbusy-'));
    cleanups.push(dir);
    const file = join(dir, 'children.json');
    const logger = testLogger();
    // 预置活 pid 编辑锁（本进程 pid——判活真；与 plugin-store 修前红锚同构）
    await writeFile(`${file}.lock`, `${process.pid}\n`, 'utf8');
    const registry = createProcessRegistry({ filePath: file, logger });
    expect(() => registry.add(entry({ pid: 44 }))).not.toThrow(); // 写面容错——锁忙不抛
    expect(registry.list().map((e) => e.pid)).toEqual([44]); // 内存账仍准
    // 锁重试帽 21 轮 × 100ms ≈ 2.1s 后 warn 才落——until 预算须高于重试帽
    await until(() => logger.warns.some((w) => w.includes('跳过')), 5000); // 修前红：无锁零 warn
    expect(existsSync(file)).toBe(false); // 拒写不退化为无锁写——修前红：true
  });
});
