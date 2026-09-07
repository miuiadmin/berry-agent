/**
 * host/runtime 组合根测试——装配序生命周期 + 退出序六步编舞（04 §1）。
 *
 * 真盘真库（临时目录 + 真实 Persistence）——组合根全栈惯例；不 mock（分层
 * 纪律：mock 只停在模型层，本组无模型调用）。单活跃机真路径、:memory: 同构、
 * shutdown 全序、closer 超时强杀逐路覆盖。
 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';

import { ACTIVE_MARKER_BASENAME } from './single-instance.js';
import { createHostRuntime } from './runtime.js';
import type { HostRuntime } from './runtime.js';

/** 临时数据目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 新临时目录 + runtime 速记 */
function rig(options: Parameters<typeof createHostRuntime>[0] = {}): { dir: string; rt: HostRuntime } {
  const dir = mkdtempSync(join(tmpdir(), 'host-runtime-'));
  dirs.push(dir);
  const rt = createHostRuntime({ dataDir: dir, ...options });
  return { dir, rt };
}

describe('createHostRuntime 启动序', () => {
  it('真目录形：占标记 + 开真库 + dataDir 报告', async () => {
    const { dir, rt } = rig();
    expect(rt.memory).toBe(false);
    expect(rt.dataDir).toBe(dir);
    expect(existsSync(join(dir, ACTIVE_MARKER_BASENAME))).toBe(true); // 启动即写活跃标记
    expect(rt.persistence).toBeDefined(); // 开库产物（openStore 门禁序内嵌）
    await rt.shutdown();
  });

  it('单活跃机拒入：同目录二次启动 HOST_DATA_DIR_BUSY（首 runtime 在飞持锁）', async () => {
    const { dir, rt } = rig();
    try {
      createHostRuntime({ dataDir: dir });
      expect.unreachable('未拒绝');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('HOST_DATA_DIR_BUSY'); // 码身份（惯例 expectCode 形）
    }
    await rt.shutdown();
  });

  it('shutdown 后标记释放——同目录可再启动（接管无残留）', async () => {
    const { dir, rt } = rig();
    await rt.shutdown();
    const rt2 = createHostRuntime({ dataDir: dir }); // 释放后直入（非接管——标记已删）
    expect(existsSync(join(dir, ACTIVE_MARKER_BASENAME))).toBe(true);
    await rt2.shutdown();
  });

  it(':memory: 同构：不开真库不动标记（dump-config 类诊断豁免）', async () => {
    const rt = createHostRuntime({ memory: true });
    expect(rt.memory).toBe(true);
    expect(rt.dataDir).toBeNull();
    // 会话主库零落盘：createSession 全链真跑（内存库真装配非桩）
    const log = rt.persistence.createSession({ origin: 'conversation', workspaceRoot: '/w' });
    expect(log).toBeDefined();
    await rt.shutdown();
  });

  it('迁移链机械聚合（05 §6.4——批 19c-2 回归锁）：core: 表族并入宿主单链真应用', async () => {
    const { rt } = rig();
    // jobs 表（SCHEDULER_MIGRATION v2——本批聚合）与 memory 表族（v4-6——19b-2
    // 先例）都在主库 schema 在场：插件建表经宿主单链执行的结构证据
    const db = rt.persistence.store.sqlite();
    const tables = (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
      (row) => row.name,
    );
    expect(tables).toContain('jobs');
    expect(tables.some((name) => name.startsWith('memory_'))).toBe(true);
    await rt.shutdown();
  });

  it(':memory: 同构诊断形（memory + 显式 dataDir——07 §5 dump-config 纪律）：真数据目录读侧保留 + 主库零落盘 + 不占标记', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'host-runtime-memdir-'));
    dirs.push(dir);
    const rt = createHostRuntime({ memory: true, dataDir: dir });
    expect(rt.memory).toBe(true);
    expect(rt.dataDir).toBe(dir); // 真数据目录保留（enabled.yaml/装机账本读侧归属地）
    expect(existsSync(join(dir, ACTIVE_MARKER_BASENAME))).toBe(false); // 不占活跃标记
    // 主库零落盘：真开内存会话 + flush 后数据目录无 .db 文件（目录创建类动作被容忍）
    const log = rt.persistence.createSession({ origin: 'conversation', workspaceRoot: '/w' });
    await rt.persistence.flush();
    expect(log).toBeDefined();
    const dbFiles = readdirSync(dir).filter((name) => name.endsWith('.db'));
    expect(dbFiles).toEqual([]);
    await rt.shutdown();
  });
});

describe('退出序六步编舞（04 §1 全序有界）', () => {
  it('全序执法：abort → closers 注册序 → flush → hooks 并行 → disposers LIFO', async () => {
    const seq: string[] = [];
    const { rt } = rig();
    rt.registerCloser({ label: 'a', fn: () => void seq.push('closer-a') });
    rt.registerCloser({
      label: 'b',
      fn: async () => {
        await Promise.resolve();
        seq.push('closer-b');
      },
    });
    rt.registerShutdownHook(() => void seq.push('hook-1'));
    rt.registerDisposer(() => void seq.push('dispose-1'));
    rt.registerDisposer(() => void seq.push('dispose-2')); // 后注册——LIFO 先回卷
    await rt.shutdown();
    expect(rt.abortSignal.aborted).toBe(true); // ① abort 置位
    expect(seq.indexOf('closer-a')).toBeLessThan(seq.indexOf('closer-b')); // ② 注册序串行
    expect(seq).toContain('hook-1'); // ④
    const d1 = seq.indexOf('dispose-1');
    const d2 = seq.indexOf('dispose-2');
    expect(d2).toBeLessThan(d1); // ⑤ LIFO
    expect(seq.indexOf('closer-b')).toBeLessThan(d2); // ④⑤ 钩子先于回卷
  });

  it('幂等：二次 shutdown 直返零重放', async () => {
    const { rt } = rig();
    let closes = 0;
    rt.registerCloser({ label: 'c', fn: () => void closes++ });
    await rt.shutdown();
    await rt.shutdown();
    expect(closes).toBe(1);
  });

  it('closer 超时强杀：帽 10ms + 慢 closer 100ms → shutdown 不挂死', async () => {
    const { rt } = rig({ exitBudget: { closersMs: 10 } });
    rt.registerCloser({
      label: 'slow',
      fn: () => new Promise<void>((resolve) => setTimeout(resolve, 100)),
    });
    const t0 = Date.now();
    await rt.shutdown();
    expect(Date.now() - t0).toBeLessThan(90); // 未等满慢 closer
  });

  it('一步崩不阻后续：closer 抛错 → flush/标记释放照达', async () => {
    const { dir, rt } = rig();
    rt.registerCloser({
      label: 'bad',
      fn: () => {
        throw new Error('boom');
      },
    });
    await rt.shutdown(); // 不抛——容错继续
    expect(existsSync(join(dir, ACTIVE_MARKER_BASENAME))).toBe(false); // ⑥ 标记释放仍达
  });

  it('关库执法：shutdown 后 Persistence 拒再开新会话', async () => {
    const { rt } = rig();
    await rt.shutdown();
    expect(() => rt.persistence.createSession({ origin: 'conversation', workspaceRoot: '/w' })).toThrowError(/已关闭/);
  });
});

describe('崩溃取证与披露段', () => {
  it('writeCrashLog：数据目录 crash.log 追加时戳行（memory 形跳过）', async () => {
    const { dir, rt } = rig();
    rt.writeCrashLog(new Error('kaboom'));
    const text = readFileSync(join(dir, 'crash.log'), 'utf8');
    expect(text).toContain('kaboom');
    const rtMem = createHostRuntime({ memory: true });
    expect(() => rtMem.writeCrashLog(new Error('x'))).not.toThrow(); // 无真库归属地——静默跳过
    await rtMem.shutdown();
    await rt.shutdown();
  });

  it('disclosure：恒三件 + 注入位（git/plugins provider）每请求重算', async () => {
    let git = 'main clean';
    const { rt } = rig({
      gitSummaryProvider: () => git,
      pluginsProvider: () => ({ total: 5, enabled: 4, failed: 1 }),
    });
    const first = rt.disclosure();
    expect(first).toContain('- git: main clean');
    expect(first).toContain('- 插件: 5 个（启用 4 · 失败 1）');
    git = 'dev dirty'; // 每请求重算——环境变了下一请求自然看见
    expect(rt.disclosure()).toContain('- git: dev dirty');
    await rt.shutdown();
  });
});
