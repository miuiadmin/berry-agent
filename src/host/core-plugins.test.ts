/**
 * host/core-plugins 注册表单源测试（批 19a/19b-1）——exec/web/skills 三件
 * 装载全环：createCorePlugins 产物经真 bootPlugins 装载（真 Kahn/真装载
 * 管线/零 jiti——core 行对象直调）→ scope 共享根服务面 → openTools 会话
 * 装配消费（会话装配期工厂求值——批 19a 契约形）→ bash 工具真执行（真
 * spawn echo，组合根全栈惯例）；enabled.yaml core:exec disabled 行 =
 * bash 静默缺席（诚实缺席律回归锁）。skills 件（19b-1）：标准六位层真扫
 * 描（project 层真落 SKILL.md）+ skill_manage 工具 bootTools 面 +
 * 'skills/manifest' 提示词段物化 + :memory: 形 dataDir null 跳 user 层。
 *
 * 纪律：mock 只停在装载 fs 注入位（内存 Map——读侧零真盘）；装载管线/
 * spawn 管道/bash 工具/守门/审批/技能扫描全走真实现。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { EventDispatch, Scope } from '../context/index.js';
import type { SessionEvent } from '../contracts/index.js';
import type { CommandHandler } from '../channels/index.js';
import { MEMORY_MIGRATIONS } from '../memory/index.js';
import type { MemoryCycle, MemoryDao, MemoryLlmFace } from '../memory/index.js';
import { MEMORY_DB_PATH, Persistence } from '../persist/index.js';
import { SCHEDULER_MIGRATION } from '../scheduler/index.js';
import { SessionLog } from '../session/index.js';

import { createCorePlugins } from './core-plugins.js';
import type { SchedulerFace } from './core-plugins.js';
import { bootPlugins } from './plugin-boot.js';
import type { PluginBootFs } from './plugin-boot.js';
import type { HostRuntime } from './runtime.js';
import { assembleOpenTools } from '../conversation/open-tools.js';
import type { ExecToolService } from '../conversation/index.js';
import type { SkillsRegistry } from '../skills/index.js';

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 内存 fs（装载读侧注入——enabled.yaml 缺席/禁用两形零真盘） */
function memoryFs(files: Record<string, string> = {}): PluginBootFs {
  const map = new Map(Object.entries(files));
  return { read: (path) => map.get(path) ?? null, write: (path, text) => void map.set(path, text) };
}

/** HostRuntime 结构化替身（装载序消费面 = dataDir + registerCloser + memory 位） */
function stubRuntime(dataDir: string | null): HostRuntime {
  const stub = {
    memory: dataDir === null,
    dataDir,
    persistence: {} as HostRuntime['persistence'], // 装载序不消费——占位
    abortSignal: new AbortController().signal,
    disclosure: () => null,
    registerCloser: () => undefined,
    registerShutdownHook: () => undefined,
    registerDisposer: () => undefined,
    shutdown: async () => undefined,
    writeCrashLog: () => undefined,
  };
  return stub as unknown as HostRuntime; // closers 等私有位不在公开类型——结构替身
}

/** core 件 deps 注入面（批 19b-2 起——sqlite 主闸为 memory/scheduler 共用；三 seam + 命令输出归 memory，scheduler 增闸事实位） */
interface DepsForTest {
  sqlite?: () => ReturnType<Persistence['store']['sqlite']>;
  fetchEvents?: (sessionId: string) => readonly SessionEvent[];
  llm?: () => MemoryLlmFace;
  notify?: (source: string, message: string) => void;
}

/** 真装载速记（createCorePlugins 工厂单源注入——缺省路径的等价形；boot 柄暴露供消费腿断言。cwd/homeDir 注入隔离面——skills 跨库层不扫真实 HOME） */
async function bootCore(
  dataDir: string | null,
  fs: PluginBootFs = memoryFs(),
  anchors: { cwd?: string; homeDir?: string } = {},
  coreDeps: DepsForTest = {},
): Promise<{
  scope: Scope;
  dispatch: EventDispatch;
  warnings: string[];
  commands: string[];
  commandSpecs: { name: string; handler: CommandHandler }[];
  boot: Awaited<ReturnType<typeof bootPlugins>>;
}> {
  const warnings: string[] = [];
  const commands: string[] = [];
  const commandSpecs: { name: string; handler: CommandHandler }[] = [];
  const scope = Scope.createRoot();
  const dispatch = new EventDispatch();
  const boot = await bootPlugins({
    runtime: stubRuntime(dataDir),
    scope,
    dispatch,
    commands: {
      // 命令注册捕获桩（memory-export/import 与 /tick 注册面断言 + handler
      // 真调用用——通道行为面归 channels 域）
      register: (name: string, handler: CommandHandler) => {
        commands.push(name);
        commandSpecs.push({ name, handler });
        return () => undefined;
      },
    },
    llm: { registerProvider: () => () => undefined },
    corePlugins: createCorePlugins({
      dataDir,
      ...(anchors.cwd !== undefined ? { cwd: anchors.cwd } : {}),
      ...(anchors.homeDir !== undefined ? { homeDir: anchors.homeDir } : {}),
      ...(coreDeps.sqlite !== undefined ? { sqlite: coreDeps.sqlite } : {}),
      ...(coreDeps.fetchEvents !== undefined ? { fetchEvents: coreDeps.fetchEvents } : {}),
      ...(coreDeps.llm !== undefined ? { llm: coreDeps.llm } : {}),
      ...(coreDeps.notify !== undefined ? { notify: coreDeps.notify } : {}),
    }),
    version: '9.9.9-test',
    warn: (message) => warnings.push(message),
    fs,
  });
  return { scope, dispatch, warnings, commands, commandSpecs, boot };
}

/** 恒答审批呈现面（write 类工具守门放行桩——审批装配测试同款，应答 = 'approve' 字面） */
const approveAll = async () => 'approve' as const;

describe('createCorePlugins 注册表单源（批 19a/19b-1）', () => {
  it('exec 件装载全环：真装载 → 共享根服务面 → 工厂产出 bash → openTools 拾取 → 真执行', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-'));
    dirs.push(dataDir);
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'berry-coreplug-home-'));
    dirs.push(workspace, home);
    const { scope, dispatch } = await bootCore(dataDir, memoryFs(), { cwd: workspace, homeDir: home }); // enabled.yaml 缺席 = 全 core 内置态

    // 装载报告面（core:exec 单件入册——缺省单源回归锁）
    const service = scope.tryGet<ExecToolService>('exec');
    expect(service).toBeDefined();

    // 工厂真值：会话装配期求值（会话级 deps 注入——workspace-write 档）
    const bash = service!.createBashTool({
      workspaceRoot: () => dataDir,
      currentMode: () => 'workspace-write',
    });
    expect(bash.name).toBe('bash');

    // openTools 会话装配拾取（同共享根——tryGet 诚实缺席律的正例腿）
    const session = new SessionLog({ sessionId: 's-coreplug' });
    const assembly = assembleOpenTools({
      sessionId: 's-coreplug',
      dispatch,
      session,
      scope, // 装载共享根同根同源
      mode: () => 'workspace-write',
      dataDir,
      workspace: () => workspace,
      askApproval: approveAll, // bash effect=write——守门走审批恒答放行
    });
    expect(assembly.tools.map((tool) => tool.name)).toContain('bash');
    expect(assembly.tools).toHaveLength(8); // fs 四 + 检索两 + bash + todo

    // 真执行（真 spawn——echo 走真三段管道；断言输出不含 AI 生成文本面）
    const bashTool = assembly.tools.find((tool) => tool.name === 'bash');
    if (bashTool === undefined) throw new Error('bash 工具不在装配面');
    const result = await bashTool.execute('c-echo', { command: 'echo core-plugs-ok' });
    const text = JSON.stringify(result);
    expect(text).toContain('core-plugs-ok');
    assembly.dispose();
  });

  it('core:exec disabled 行 → bash 静默缺席（诚实缺席律——对话本体仍通）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-off-'));
    dirs.push(dataDir);
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-off-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'berry-coreplug-off-home-'));
    dirs.push(workspace, home);
    const { scope, dispatch } = await bootCore(
      dataDir,
      memoryFs({ [join(dataDir, 'enabled.yaml')]: 'plugins:\n  - id: core:exec\n    disabled: true\n' }),
      { cwd: workspace, homeDir: home },
    );
    expect(scope.tryGet('exec')).toBeUndefined(); // 服务面缺席

    const session = new SessionLog({ sessionId: 's-coreplug-off' });
    const assembly = assembleOpenTools({
      sessionId: 's-coreplug-off',
      dispatch,
      session,
      scope,
      mode: () => 'workspace-write',
      dataDir,
      workspace: () => workspace,
    });
    expect(assembly.tools.map((tool) => tool.name)).not.toContain('bash');
    expect(assembly.tools).toHaveLength(7); // fs 四 + 检索两 + todo——对话本体仍通
    assembly.dispose();
  });

  it('web 件装载全环：工具走 bootTools 消费腿重放 + web-fetch/web-gate 服务面同 gate 实例', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-web-'));
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-web-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'berry-coreplug-web-home-'));
    dirs.push(dataDir, workspace, home);
    const { scope, dispatch, boot } = await bootCore(dataDir, memoryFs(), { cwd: workspace, homeDir: home });

    // 服务面：fetch 服务与 gate 单例双供给（03 §10.3 browser 共享位）
    const service = scope.tryGet<{ fetch(url: string): Promise<unknown> }>('web-fetch');
    const gate = scope.tryGet<{ readonly capacity: number }>('web-gate');
    expect(service).toBeDefined();
    expect(gate?.capacity).toBe(4); // DEFAULT_WEB_LIMITS.maxConcurrent 单源

    // 工具消费腿：boot 全局层定义快照含 fetch（effect 'read'）
    const defs = boot.tools.definitions();
    expect(defs.map((d) => d.name)).toContain('fetch');

    // openTools 会话装配重放（extraTools 取值器——与装载定义同一实例面）
    const session = new SessionLog({ sessionId: 's-web' });
    const assembly = assembleOpenTools({
      sessionId: 's-web',
      dispatch,
      session,
      scope,
      mode: () => 'workspace-write',
      dataDir,
      workspace: () => workspace,
      extraTools: () => boot.tools.definitions(),
    });
    expect(assembly.tools.map((tool) => tool.name)).toContain('fetch');
    expect(assembly.tools).toHaveLength(10); // fs 四 + 检索两 + bash + todo + fetch + skill_manage
    assembly.dispose();
  });

  it('skills 件装载全环（批 19b-1）：六位层真扫描 → registry 服务面 → skill_manage 工具 → 提示词段物化', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-sk-'));
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-sk-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'berry-coreplug-sk-home-'));
    dirs.push(dataDir, workspace, home);
    // project 层真落一枚技能（canonical 根 = workspace——无 .git 即自身）
    const skillDir = join(workspace, '.agents', 'skills', 'hello-skill');
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      '---\nname: hello-skill\ndescription: 测试技能——core 装载全环\n---\n\n正文。\n',
      'utf8',
    );
    const { scope, dispatch, boot } = await bootCore(dataDir, memoryFs(), { cwd: workspace, homeDir: home });

    // 服务面：registry 真身 + project 层技能入快照（装载期 refresh 已落）
    const registry = scope.tryGet<SkillsRegistry>('skills');
    expect(registry).toBeDefined();
    expect(registry!.list().map((s) => s.name)).toContain('hello-skill');
    expect(registry!.providerIds()).toEqual(['project', 'user', 'cross-repo', 'factory']); // 六位层缺位 4（挂账磁盘件）

    // 工具消费腿：skill_manage 在 boot 全局层（会话装配重放同 fetch 形）
    expect(boot.tools.definitions().map((d) => d.name)).toContain('skill_manage');

    // 提示词段：'skills/manifest' 物化含技能名（渐进披露清单半边）
    expect(boot.promptSections.materialize()).toContain('hello-skill');

    // openTools 会话装配重放（skill_manage 在装配面）
    const session = new SessionLog({ sessionId: 's-skills' });
    const assembly = assembleOpenTools({
      sessionId: 's-skills',
      dispatch,
      session,
      scope,
      mode: () => 'workspace-write',
      dataDir,
      workspace: () => workspace,
      extraTools: () => boot.tools.definitions(),
    });
    expect(assembly.tools.map((tool) => tool.name)).toContain('skill_manage');
    assembly.dispose();
  });

  it('skills :memory: 形（dataDir null）：user 层跳过不炸——providerIds 无 user 席', async () => {
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-mem-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'berry-coreplug-mem-home-'));
    dirs.push(workspace, home);
    const { scope } = await bootCore(null, memoryFs(), { cwd: workspace, homeDir: home });
    const registry = scope.tryGet<SkillsRegistry>('skills');
    expect(registry!.providerIds()).toEqual(['project', 'cross-repo', 'factory']);
  });

  it('memory 件装载全环（批 19b-2）：真 :memory: 座 → 服务面/九工具/简报段/三消费腿/命令注册', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-mem2-'));
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-mem2-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'berry-coreplug-mem2-home-'));
    dirs.push(dataDir, workspace, home);
    // 真 :memory: 座 + 聚合迁移链（宿主库同构——DAO 建表走 MEMORY_MIGRATIONS）
    const persistence = Persistence.open({ dbPath: MEMORY_DB_PATH, migrations: MEMORY_MIGRATIONS });
    const notified: string[] = [];
    const { scope, dispatch, boot, commands } = await bootCore(
      dataDir,
      memoryFs(),
      { cwd: workspace, homeDir: home },
      {
        sqlite: () => persistence.store.sqlite(),
        fetchEvents: () => [],
        llm: () => ({
          // 周期路 LLM 桩（due→fire 拍点需 agent 服务——替身形无 run 终态，恒不触发）
          complete: async () => ({ message: { content: '' } }),
          canAfford: () => false,
        }),
        notify: (_source, message) => notified.push(message),
      },
    );

    // 服务面：'memory' 在场（dao + cycle 双柄——llm+fetchEvents 双在场 = 周期腿在）
    const memoryService = scope.tryGet<{ dao: MemoryDao; cycle: MemoryCycle | null }>('memory');
    expect(memoryService).toBeDefined();
    expect(memoryService!.cycle).not.toBeNull();

    // 九工具注册（boot 全局层——bootTools 重放消费腿同 fetch 形）
    const names = boot.tools.definitions().map((d) => d.name);
    for (const tool of [
      'memory_write',
      'memory_forget',
      'memory_restore',
      'memory_read',
      'memory_search',
      'memory_freeze',
      'memory_unfreeze',
      'memory_ttl',
      'memory_access_log',
    ]) {
      expect(names).toContain(tool);
    }

    // 简报段物化挂接位（条目在库后断言——空库渲染空串属件内拍板「空段跳过」，
    // 见下方 ingest 后断言）

    // 命令注册两件（经 ctx.channels.registerCommand——桩捕获名单）
    expect(commands).toContain('memory-export');
    expect(commands).toContain('memory-import');

    // —— 三消费腿（dispatch 直发——发射位物理腿在 Persistence 桥，assembly 域测）——
    // ① 引用记录腿先行落一行（cite 归责要唯一短 id 命中）
    const ingested = memoryService!.dao.ingest({
      ownerKey: 'global',
      kind: 'convention',
      summary: '构建走 vitest',
      content: '构建走 npm test（vitest run）',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's-mem', seq: 0 }],
    });
    expect(ingested.action).toBe('inserted');
    // 简报段物化（条目在库 = 标记 + 摘要行——06 §6 路 1 常驻；空库渲染空串
    // 属件内拍板「空段跳过」，故断言置 ingest 后）
    expect(boot.promptSections.materialize()).toContain('<!-- memory:core -->');
    expect(boot.promptSections.materialize()).toContain('构建走 vitest');
    const cited = memoryService!.dao.listVisible()[0]!;

    // ② 引用记录腿（先于提取腿发——库内单行 = 短 id 前缀唯一无歧义；同毫秒
    // 双 uuidv7 共享 8-hex 时间戳前缀会触发「歧义全部忽略」归责三态）：
    // assistant/message 携 [m:短id] → usageCount 回写
    await dispatch.emit('session/event', {
      sessionId: 's-mem',
      event: {
        type: 'assistant/message',
        seq: 2,
        ts: 2,
        data: { content: [{ type: 'text', text: `测试命令引用见 [m:${cited.id.slice(0, 8)}]` }] },
      },
    });
    expect(memoryService!.dao.get(cited.id)!.usageCount).toBe(1);

    // ③ 即时提取腿：纠正触发词 → dao 落行（纯函数提取零 LLM）
    await dispatch.emit('session/event', {
      sessionId: 's-mem',
      event: {
        type: 'user/message',
        seq: 1,
        ts: 1,
        data: { content: '不对，构建命令是 npm test，下次记住', source: 'user' },
      },
    });
    expect(memoryService!.dao.listVisible().length).toBe(2); // 纠正提取行入册

    // ④ 周期计数腿：10× turn/end（缺省阈值）→ due 含会话
    for (let i = 0; i < 10; i++) {
      await dispatch.emit('session/event', {
        sessionId: 's-mem',
        event: { type: 'turn/end', seq: 3 + i, ts: 3 + i, data: {} },
      });
    }
    expect(memoryService!.cycle!.dueSessions()).toContain('s-mem');

    await persistence.close();
  });

  it('memory 主闸（sqlite 缺席）：件零装载——服务面缺席 + 零工具注册 + 计数不变', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-gate-'));
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-gate-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'berry-coreplug-gate-home-'));
    dirs.push(dataDir, workspace, home);
    const { scope, boot } = await bootCore(dataDir, memoryFs(), { cwd: workspace, homeDir: home }); // 无 memoryDeps = sqlite 缺席
    expect(scope.tryGet('memory')).toBeUndefined(); // 诚实缺席律
    expect(boot.tools.definitions().map((d) => d.name)).not.toContain('memory_write'); // 零工具
    expect(boot.promptSections.materialize()).not.toContain('<!-- memory:core -->'); // 零简报段
  });

  it('scheduler 件装载全环（批 19c-2）：sqlite 在场 → 服务面三柄 + /tick 注册 + goalJobs 第五槽委派真行', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-sched-'));
    dirs.push(dataDir);
    // 真 :memory: 座 + 聚合迁移链（宿主库同构——jobs 表建行走 SCHEDULER_MIGRATION）
    // 迁移链 = 宿主聚合同构（sqlite seam 共用主闸——memory 件随 scheduler 同装载，
    // 两族表全在链：scheduler v2 + memory v4-6，runtime.ts 聚合形镜像）
    const persistence = Persistence.open({
      dbPath: MEMORY_DB_PATH,
      migrations: [SCHEDULER_MIGRATION, ...MEMORY_MIGRATIONS],
    });
    const { scope, commands } = await bootCore(dataDir, memoryFs(), {}, { sqlite: () => persistence.store.sqlite() });

    // 服务面三柄（service 六动词 + goalJobs 第五槽 + engine 起停编舞位）
    const face = scope.tryGet<SchedulerFace>('scheduler');
    expect(face).toBeDefined();
    expect(typeof face!.service.addJob).toBe('function');
    expect(typeof face!.goalJobs.register).toBe('function');
    expect(typeof face!.engine.start).toBe('function');
    expect(face!.engine.inFlightCount).toBe(0); // 构造不自启——装载态零在飞（起钟编舞归宿主入口）

    // goalJobs 委派真行：register → goal-<goalId> builtin 行落 jobs 表
    const registered = await face!.goalJobs.register({
      goalId: 'g1',
      sessionId: 's-g',
      schedule: 'every:60s',
      promptSnapshot: '推进目标 g1',
    });
    expect(registered.ok).toBe(true);
    const goalRow = face!.service.getJob('goal-g1');
    expect(goalRow?.builtin).toBe(true);
    expect(goalRow?.enabled).toBe(true); // goal 挂钟行建行即启（区别于 add 缺省停用）

    // /tick 命令注册（桩捕获名单）
    expect(commands).toContain('tick');
    await persistence.close();
  });

  it('/tick handler 真调（批 19c-2）：add → 行在场（缺省停用）+ list → 输出面归因 tick 的结算文本', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-tick-'));
    dirs.push(dataDir);
    // 迁移链 = 宿主聚合同构（sqlite seam 共用主闸——memory 件随 scheduler 同装载，
    // 两族表全在链：scheduler v2 + memory v4-6，runtime.ts 聚合形镜像）
    const persistence = Persistence.open({
      dbPath: MEMORY_DB_PATH,
      migrations: [SCHEDULER_MIGRATION, ...MEMORY_MIGRATIONS],
    });
    const notified: string[] = [];
    const { scope, commandSpecs } = await bootCore(
      dataDir,
      memoryFs(),
      {},
      {
        sqlite: () => persistence.store.sqlite(),
        notify: (source, message) => {
          if (source === 'tick') notified.push(message); // 归因位可辨（notify 双参化的装载面回归锁）
        },
      },
    );
    const tick = commandSpecs.find((spec) => spec.name === 'tick');
    if (tick === undefined) throw new Error('/tick 命令不在捕获面');

    // add：全守卫真走（schedule 词法 + prompt 非空）→ 建行缺省停用（存在 ≠ 启用）
    await tick.handler({ raw: '', argv: ['add', 'demo', 'every:120s', '构建巡查'] });
    expect(notified[notified.length - 1]!).toContain('demo');
    const face = scope.tryGet<SchedulerFace>('scheduler')!;
    expect(face.service.getJob('demo')?.enabled).toBe(false);

    // list：行名进渲染文本
    await tick.handler({ raw: '', argv: ['list'] });
    expect(notified[notified.length - 1]!).toContain('demo');

    // 守卫执法透传：坏 schedule 串折文本不抛（runTickCommand 错误面）
    await tick.handler({ raw: '', argv: ['add', 'bad', 'not-a-schedule', 'x'] });
    expect(notified[notified.length - 1]!).toContain('✗');
    await persistence.close();
  });

  it('scheduler 主闸（sqlite 缺席）：件零装载——服务面缺席 + /tick 不注册', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-sgate-'));
    dirs.push(dataDir);
    const { scope, commands } = await bootCore(dataDir); // 无 coreDeps = sqlite 缺席
    expect(scope.tryGet('scheduler')).toBeUndefined(); // 诚实缺席律
    expect(commands).not.toContain('tick');
  });

  it('注册表单源形：件名清单（逐纵切笔入册——本批 exec/web/skills/memory/subagent/scheduler 六件）', () => {
    expect(createCorePlugins({ dataDir: null }).map((ref) => ref.name)).toEqual([
      'exec',
      'web',
      'skills',
      'memory',
      'subagent',
      'scheduler',
    ]);
  });
});
