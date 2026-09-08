/**
 * host/scheduler-clock 编舞接线测试（批 20c——20a 三笔的三面回归锁）：
 *
 * 1. startSchedulerClock 起停编舞：件在场 → 起钟 + 停钟 closer 注册（结构化
 *    替身 runtime 捕获——真挂钟起停经 engine 公开面）；noPlugins 件缺席 →
 *    no-op 零 closer（件禁用语义族）。
 * 2. GateFacts 宿主三源接线（assembly 闭包单源）：user 源消息 → recent_
 *    user_msg 闸拦（engine fireNow clock 道诚实 gated）；schedule 源注入
 *    不计数（闸放行——run --tick 回流的 user/message 非人语，不打扰礼仪门
 *    只认真人）。
 * 3. 真 bin 出厂 + cron 乙案开启位：BERRY_AGENT_BIN env → runner spawn 命令
 *    真值（/usr/bin/true 收场 exit_code 0——缺席缺省形 spawn ENOENT 可判别）；
 *    BERRY_AGENT_CRON 开启形装载期对账回填（既有启用行补注册 OS 面、禁用行
 *    零动作、命令段 = bin 单源）——execCrontab 注入假件零真系统写。
 *
 * 纪律：mock 只停在模型层（faux provider）与 crontab 执行器注入位；装载
 * 管线/引擎闸评估/spawn 全走真实现。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import { EventDispatch, Scope, canonicalWorkspaceRoot } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';
import { MEMORY_MIGRATIONS } from '../memory/index.js';
import { MEMORY_DB_PATH, Persistence } from '../persist/index.js';
import { SCHEDULER_MIGRATION } from '../scheduler/index.js';

import { assembleHostStack } from './assembly.js';
import { createCorePlugins, startSchedulerClock } from './core-plugins.js';
import type { SchedulerFace } from './core-plugins.js';
import { bootPlugins } from './plugin-boot.js';
import type { HostRuntime } from './runtime.js';

/* ---------------- 测试基建 ---------------- */

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 造临时目录（统一入清账） */
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 零用量终态 assistant 消息（faux 响应脚本用） */
function messageOf(): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/**
 * 编舞测试装配（faux provider + BERRY_AGENT_BIN 注入 /usr/bin/true——
 * spawn 命令真值可判：缺省 'berry-agent' PATH 缺席归 spawn 失败形）
 */
async function clockRig() {
  const faux = fauxProvider({ provider: 'faux-clock', models: [{ id: 'm1' }] });
  faux.setResponses([() => messageOf()]);
  const dataDir = tmpDir('clock-data-');
  const ws = tmpDir('clock-ws-');
  const assembly = await assembleHostStack({
    runtime: { dataDir },
    noPlugins: false,
    debug: false,
    version: 'test',
    providers: [faux.provider],
    model: 'faux-clock/m1',
    env: { BERRY_AGENT_BIN: '/usr/bin/true' },
  });
  if (!assembly.ok) throw new Error(`装配失败：${assembly.message}`);
  const sched = assembly.scope.tryGet<SchedulerFace>('scheduler');
  if (sched === undefined) throw new Error('scheduler 件未装载');
  return { assembly, sched, ws, shutdown: () => assembly.runtime.shutdown() };
}

/** HostRuntime 结构化替身（装载序消费面——同 core-plugins.test 同款） */
function stubRuntime(): HostRuntime {
  return {
    memory: true,
    dataDir: null,
    persistence: {} as HostRuntime['persistence'],
    abortSignal: new AbortController().signal,
    disclosure: () => null,
    registerCloser: () => undefined,
    registerShutdownHook: () => undefined,
    registerDisposer: () => undefined,
    shutdown: async () => undefined,
    writeCrashLog: () => undefined,
  } as unknown as HostRuntime;
}

/** 内存 fs（装载读侧注入——enabled.yaml 缺席全 core 内置态） */
function memoryFs(): { read: () => null; write: () => void } {
  return { read: () => null, write: () => undefined };
}

/* ---------------- startSchedulerClock 起停编舞 ---------------- */

describe('startSchedulerClock 起停编舞（批 20c）', () => {
  it('件在场：起钟 true + 停钟 closer 注册（label 单源可辨）', async () => {
    const assembly = await assembleHostStack({
      runtime: { memory: true },
      noPlugins: false,
      debug: false,
      version: 'test',
    });
    if (!assembly.ok) throw new Error(`装配失败：${assembly.message}`);
    const closers: { label: string; fn: () => void }[] = [];
    expect(startSchedulerClock(assembly.scope, { registerCloser: (c) => closers.push(c) })).toBe(true);
    expect(closers).toHaveLength(1);
    expect(closers[0]!.label).toBe('scheduler-engine');
    closers[0]!.fn(); // 停钟——真定时器已摘（不留 60s belt 拖活测试进程）
    await assembly.runtime.shutdown();
  });

  it('件缺席（noPlugins 诊断形）：no-op false 零 closer', async () => {
    const assembly = await assembleHostStack({
      runtime: { memory: true },
      noPlugins: true,
      debug: false,
      version: 'test',
    });
    if (!assembly.ok) throw new Error(`装配失败：${assembly.message}`);
    const closers: { label: string; fn: () => void }[] = [];
    expect(startSchedulerClock(assembly.scope, { registerCloser: (c) => closers.push(c) })).toBe(false);
    expect(closers).toHaveLength(0);
    await assembly.runtime.shutdown();
  });
});

/* ---------------- GateFacts 宿主三源 + 真 bin 出厂 ---------------- */

describe('GateFacts 宿主三源接线（批 20c——assembly 闭包单源）', () => {
  it('user 源消息：recent_user_msg 闸拦（刚说过话的窗口期不打扰）', async () => {
    const rig = await clockRig();
    try {
      rig.sched.service.addJob({
        name: 'quiet-job',
        prompt: '例行巡检',
        cwd: rig.ws,
        schedule: 'every:30m',
        enabled: true,
      });
      const sessionId = rig.assembly.stack.manager.create({ workspaceRoot: canonicalWorkspaceRoot(rig.ws) }).sessionId;
      const run = rig.assembly.stack.submitText(sessionId, '用户在说话', { source: 'user' });
      if (run === undefined) throw new Error('提交无回执');
      await run; // settle——driver 收口后 agentBusy 归 false（单源闸只应咬 recent_user_msg）

      const outcome = await rig.sched.engine.fireNow('quiet-job', 'clock');
      expect(outcome.reason).toBe('gated');
      expect(outcome.gate).toBe('recent_user_msg');
    } finally {
      await rig.shutdown();
    }
  });

  it('schedule 源注入不计数：闸放行 + BERRY_AGENT_BIN 真值到 spawn（exit 0）', async () => {
    const rig = await clockRig();
    try {
      rig.sched.service.addJob({
        name: 'bin-job',
        prompt: '挂钟任务',
        cwd: rig.ws,
        schedule: 'every:30m',
        enabled: true,
      });
      const sessionId = rig.assembly.stack.manager.create({ workspaceRoot: canonicalWorkspaceRoot(rig.ws) }).sessionId;
      const run = rig.assembly.stack.submitText(sessionId, '挂钟注入', { source: 'schedule' });
      if (run === undefined) throw new Error('提交无回执');
      await run; // source='schedule' 的 user/message 非人语——lastUserMessageAt 不计

      const outcome = await rig.sched.engine.fireNow('bin-job', 'clock');
      expect(outcome.reason).toBe('exit_code'); // 闸全放行 → 真 spawn 起跑
      expect(outcome.exitCode).toBe(0); // /usr/bin/true——BERRY_AGENT_BIN 单源真值（缺省 PATH 名应归 spawn 失败形）
    } finally {
      await rig.shutdown();
    }
  });
});

/* ---------------- cron 乙案开启位（装载期对账回填） ---------------- */

describe('cron 乙案开启位（批 20c——BERRY_AGENT_CRON env 形）', () => {
  it('开启形：既有启用行补注册 OS 面（bin 命令段单源）+ 禁用行零动作', async () => {
    // 预置两行（开启 env 前已 enabled 的行不在 crontab——对账回填的目标态）
    const persistence = Persistence.open({
      dbPath: MEMORY_DB_PATH,
      migrations: [SCHEDULER_MIGRATION, ...MEMORY_MIGRATIONS],
    });
    const db = persistence.store.sqlite();
    const insert = db.prepare(
      // schedule 列存 canonical JSON（fromDb 单源解析——非 DSL 串）
      `INSERT INTO jobs (name, prompt, cwd, schedule, enabled, builtin, created_at, updated_at, next_fire_at)
       VALUES (?, ?, NULL, ?, ?, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`,
    );
    insert.run('seed-on', '巡检', '{"kind":"daily","time":"09:00"}', 1);
    insert.run('seed-off', '停用行', '{"kind":"daily","time":"09:00"}', 0);

    const calls: { args: string[]; input?: string }[] = [];
    const exec = (args: string[], input?: string) => {
      calls.push({ args, input });
      // 读 '-l'：无 crontab 常态（exit 1 空输出）；写 '-'：成功
      return args[0] === '-' ? { stdout: '', stderr: '', code: 0 } : { stdout: '', stderr: '', code: 1 };
    };

    const ws = tmpDir('clock-cron-ws-');
    const home = tmpDir('clock-cron-home-');
    const scope = Scope.createRoot();
    await bootPlugins({
      runtime: stubRuntime(),
      scope,
      dispatch: new EventDispatch(),
      commands: { register: () => () => undefined },
      llm: { registerProvider: () => () => undefined },
      corePlugins: createCorePlugins({
        dataDir: null,
        cwd: ws,
        homeDir: home,
        sqlite: () => db,
        schedulerCronEnabled: true,
        schedulerBinCommand: 'test-bin',
        schedulerCronExec: exec,
      }),
      version: 'test',
      warn: () => undefined,
      fs: memoryFs(),
    });

    // 对账回填：启用行恰一组读写（读 '-l' + 写 '-'）；条目形 = cron 表达式 +
    // bin 命令段 + argv + 自有标记（命令段与 runner spawn 单源——test-bin）
    const writes = calls.filter((c) => c.args[0] === '-');
    expect(writes).toHaveLength(1);
    expect(writes[0]!.input).toContain('0 9 * * * test-bin run --read-only --tick seed-on # berry-agent:seed-on');
    expect(writes[0]!.input).not.toContain('seed-off'); // 禁用行零动作
  });

  it('缺省形（env 未置位）：纯进程内挂钟——crontab 零调用', async () => {
    const persistence = Persistence.open({
      dbPath: MEMORY_DB_PATH,
      migrations: [SCHEDULER_MIGRATION, ...MEMORY_MIGRATIONS],
    });
    const db = persistence.store.sqlite();
    db.prepare(
      `INSERT INTO jobs (name, prompt, cwd, schedule, enabled, builtin, created_at, updated_at, next_fire_at)
       VALUES ('seed-on2', '巡检', NULL, '{"kind":"daily","time":"09:00"}', 1, 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL)`,
    ).run();

    const calls: { args: string[]; input?: string }[] = [];
    const exec = (args: string[], input?: string) => {
      calls.push({ args, input });
      return { stdout: '', stderr: '', code: 0 };
    };

    const ws = tmpDir('clock-nocron-ws-');
    const home = tmpDir('clock-nocron-home-');
    const scope = Scope.createRoot();
    await bootPlugins({
      runtime: stubRuntime(),
      scope,
      dispatch: new EventDispatch(),
      commands: { register: () => () => undefined },
      llm: { registerProvider: () => () => undefined },
      corePlugins: createCorePlugins({
        dataDir: null,
        cwd: ws,
        homeDir: home,
        sqlite: () => db,
        schedulerCronExec: exec, // 执行器在场而开启位缺席——开启位是唯一闸
      }),
      version: 'test',
      warn: () => undefined,
      fs: memoryFs(),
    });
    expect(calls).toHaveLength(0); // 缺省 = 纯进程内挂钟（OS 面零动作）
  });
});
