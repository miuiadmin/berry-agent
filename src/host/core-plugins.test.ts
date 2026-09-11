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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { EventDispatch, Scope } from '../context/index.js';
import { BaseError } from '../contracts/index.js';
import type { GateInput, SessionEvent, UserMessage } from '../contracts/index.js';
import type { CommandHandler } from '../channels/index.js';
import { openCheckpointStore } from '../checkpoint/index.js';
import type { RewindForkFace, SessionContextFace } from '../checkpoint/index.js';
import { CREDENTIALS_MIGRATION, createOAuthFlowRegistry } from '../credentials/index.js';
import type {
  CredentialChangedPayload,
  CredentialsCommandStore,
  OAuthFetchLike,
  OAuthFlowRegistry,
} from '../credentials/index.js';
import { GOAL_MIGRATION } from '../goal/index.js';
import type { GoalSessionFace, GoalSummarizerFace } from '../goal/index.js';
import type { IssueBudgetFace, IssueSessionFace, IssueStoreStateFace } from '../issue/index.js';
import { MEMORY_MIGRATIONS } from '../memory/index.js';
import type { MemoryCycle, MemoryDao, MemoryLlmFace } from '../memory/index.js';
import type { ObsAudienceFace, ObsEventsFace, ObsNotifyFace } from '../obs/index.js';
import { MEMORY_DB_PATH, Persistence } from '../persist/index.js';
import { SCHEDULER_MIGRATION } from '../scheduler/index.js';
import { createSdkHttpFace } from '../sdk/index.js';
import type { SdkHttpFaceHandle } from '../sdk/index.js';
import { SessionLog } from '../session/index.js';
import { createJobRegistry, provideJobsService } from '../subagent/index.js';

import { createCorePlugins } from './core-plugins.js';
import type { GoalFace, SchedulerFace } from './core-plugins.js';
import type { WebuiFaceMount } from './webui-bridge.js';
import { bootPlugins } from './plugin-boot.js';
import type { PluginBootFs } from './plugin-boot.js';
import type { HostRuntime } from './runtime.js';
import { assembleOpenTools } from '../conversation/open-tools.js';
import type { ContextTransformInput, ExecToolService, PreStepInput } from '../conversation/index.js';
import { AGENT_PRE_STEP_EVENT, CONTEXT_TRANSFORM_EVENT } from '../conversation/index.js';
import type { SkillsRegistry } from '../skills/index.js';
import { createSessionsFace, type SessionsFace } from './sessions-face.js';

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

/** core 件 deps 注入面（批 19b-2 起——sqlite 主闸为 memory/scheduler/goal 共用；三 seam + 命令输出归 memory，scheduler 增闸事实位，goal 增会话读面主闸二；checkpoint 增语境/fork 两 seam + 焦点会话位——批 19c-4；19e 增 HTTP 面族十位——sdk/webui/obs/issue 四件） */
interface DepsForTest {
  sqlite?: () => ReturnType<Persistence['store']['sqlite']>;
  fetchEvents?: (sessionId: string) => readonly SessionEvent[];
  llm?: () => MemoryLlmFace;
  notify?: (source: string, message: string) => void;
  goalSession?: GoalSessionFace;
  /** goal 沉淀摘要窄面（批 #99——GoalSummarizerFace 注入面） */
  goalSummarizer?: GoalSummarizerFace;
  checkpointSession?: SessionContextFace;
  checkpointFork?: RewindForkFace;
  focusSessionId?: () => string | undefined;
  sdkFaceFactory?: typeof createSdkHttpFace;
  webuiFaceMount?: (face: SdkHttpFaceHandle, options?: { staticDir?: string }) => WebuiFaceMount;
  obsEvents?: ObsEventsFace;
  obsNotify?: ObsNotifyFace;
  obsAudience?: ObsAudienceFace;
  issueSession?: IssueSessionFace;
  issueState?: IssueStoreStateFace;
  issueBudget?: IssueBudgetFace;
  issueGithubToken?: string;
  issueWebhookSecret?: string;
  credentialsStore?: CredentialsCommandStore;
  credentialsOnChanged?: (payload: CredentialChangedPayload) => void;
  /** oauth 流受局面（c-6）：CorePluginHostDeps.credentialsOAuth 同形——intervalMs 0 = 刷新链不自驱 */
  credentialsOAuth?: {
    registry: OAuthFlowRegistry;
    fetchFn: OAuthFetchLike;
    intervalMs?: number;
    warn?: (message: string) => void;
  };
  /** sessions 服务面（批 19 销账笔——assembly 同构 provide：memory 差分落账腿消费） */
  sessionsFace?: SessionsFace;
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
  // issue 件前件（批 19e）：真 Job 注册表 provide（assembly 同构——件
  // tryGet 'jobs' 消费；emit 总线腿测试态省略）
  if (coreDeps.issueSession !== undefined) {
    provideJobsService(scope, createJobRegistry({ warn: () => undefined }));
  }
  // sessions 服务面（批 19 销账笔——assembly 同构 provide：boot 前在场供
  // memory 件 tryGet 消费）
  if (coreDeps.sessionsFace !== undefined) {
    scope.provide('sessions', coreDeps.sessionsFace);
  }
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
      ...(coreDeps.goalSession !== undefined ? { goalSession: coreDeps.goalSession } : {}),
      ...(coreDeps.goalSummarizer !== undefined ? { goalSummarizer: coreDeps.goalSummarizer } : {}),
      ...(coreDeps.checkpointSession !== undefined ? { checkpointSession: coreDeps.checkpointSession } : {}),
      ...(coreDeps.checkpointFork !== undefined ? { checkpointFork: coreDeps.checkpointFork } : {}),
      ...(coreDeps.focusSessionId !== undefined ? { focusSessionId: coreDeps.focusSessionId } : {}),
      ...(coreDeps.sdkFaceFactory !== undefined ? { sdkFaceFactory: coreDeps.sdkFaceFactory } : {}),
      ...(coreDeps.webuiFaceMount !== undefined ? { webuiFaceMount: coreDeps.webuiFaceMount } : {}),
      ...(coreDeps.obsEvents !== undefined ? { obsEvents: coreDeps.obsEvents } : {}),
      ...(coreDeps.obsNotify !== undefined ? { obsNotify: coreDeps.obsNotify } : {}),
      ...(coreDeps.obsAudience !== undefined ? { obsAudience: coreDeps.obsAudience } : {}),
      ...(coreDeps.issueSession !== undefined ? { issueSession: coreDeps.issueSession } : {}),
      ...(coreDeps.issueState !== undefined ? { issueState: coreDeps.issueState } : {}),
      ...(coreDeps.issueBudget !== undefined ? { issueBudget: coreDeps.issueBudget } : {}),
      ...(coreDeps.issueGithubToken !== undefined ? { issueGithubToken: coreDeps.issueGithubToken } : {}),
      ...(coreDeps.issueWebhookSecret !== undefined ? { issueWebhookSecret: coreDeps.issueWebhookSecret } : {}),
      ...(coreDeps.credentialsStore !== undefined ? { credentialsStore: coreDeps.credentialsStore } : {}),
      ...(coreDeps.credentialsOnChanged !== undefined ? { credentialsOnChanged: coreDeps.credentialsOnChanged } : {}),
      ...(coreDeps.credentialsOAuth !== undefined ? { credentialsOAuth: coreDeps.credentialsOAuth } : {}),
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
    expect(assembly.tools).toHaveLength(24); // fs 四 + 检索两 + bash + todo + fetch + skill_manage + lsp 静态四 + browser 十（批 19d 三桥入册）
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

  it('memory/core 归类基线②：volatile 声明 + 每会话懒冻结（cache 经济批 ca-2——批 19 简报冻结挂账兑销）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-frz-'));
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-frz-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'berry-coreplug-frz-home-'));
    dirs.push(dataDir, workspace, home);
    const persistence = Persistence.open({ dbPath: MEMORY_DB_PATH, migrations: MEMORY_MIGRATIONS });
    const { scope, boot } = await bootCore(
      dataDir,
      memoryFs(),
      { cwd: workspace, homeDir: home },
      {
        sqlite: () => persistence.store.sqlite(),
        fetchEvents: () => [],
        llm: () => ({ complete: async () => ({ message: { content: '' } }), canAfford: () => false }),
      },
    );
    const memoryService = scope.tryGet<{ dao: MemoryDao }>('memory')!;

    // ① volatile 声明在册（03 §2.5 既有宿主段归类基线②——免漂移 warn + 物化位恒段区尾）
    const entry = boot.promptSections.list().find((e) => e.slot === 'memory/core');
    expect(entry?.volatileReason).toBeDefined();

    // ② 每会话懒冻结：首物化即冻结该会话简报；库变更后会话内再物化零漂移
    //    （时效词面取冻结时点值——会话内前缀缓存兑现）
    memoryService.dao.ingest({
      ownerKey: 'global',
      kind: 'convention',
      summary: '冻结前',
      content: '冻结前行内容',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's-frz', seq: 0 }],
    });
    const frozen = boot.promptSections.materialize('s-frz');
    expect(frozen).toContain('冻结前');
    memoryService.dao.ingest({
      ownerKey: 'global',
      kind: 'convention',
      summary: '冻结后',
      content: '冻结后行内容',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's-frz', seq: 1 }],
    });
    expect(boot.promptSections.materialize('s-frz')).toBe(frozen); // 同会话恒冻结文本
    // ③ 异会话各自冻结（新会话首物化见新行）；④ 诊断形（sessionId 缺席）活体物化
    expect(boot.promptSections.materialize('s-other')).toContain('冻结后');
    expect(boot.promptSections.materialize()).toContain('冻结后');
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

  it('memory 两注入腿全环（批 19 销账笔）：context_transform 瀑布 → 差分懒立基线 → 变更拍绑会话落账 + 注入序 diff 先 recall 后 + 幂等零追写', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-inj-'));
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-inj-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'berry-coreplug-inj-home-'));
    dirs.push(dataDir, workspace, home);
    const persistence = Persistence.open({ dbPath: MEMORY_DB_PATH, migrations: MEMORY_MIGRATIONS });
    // 会话附件：真 SessionLog 纯内存形（appendEventFor 过闸后的 durable 落点）
    const log = new SessionLog({ sessionId: 's-inj' });
    const { scope, dispatch, warnings } = await bootCore(
      dataDir,
      memoryFs(),
      { cwd: workspace, homeDir: home },
      {
        sqlite: () => persistence.store.sqlite(),
        // durable 读脸：recall query 尾扫形（最后一条 user/message string content；
        // search 短语包裹防 MATCH 注入——query 须为 summary 连续子串）
        fetchEvents: (sid) =>
          sid === 's-inj' ? [{ type: 'user/message', seq: 0, time: 0, data: { content: 'npm test' } }] : [],
        llm: () => ({ complete: async () => ({ message: { content: '' } }), canAfford: () => false }),
        sessionsFace: createSessionsFace({ driverOf: (sid) => (sid === 's-inj' ? { session: log } : undefined) }),
      },
    );
    const dao = scope.tryGet<{ dao: MemoryDao }>('memory')!.dao;
    // 库内一行（recall 命中源——FTS ASCII 词稳命中）
    dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'build runs npm test vitest',
      content: 'build runs npm test (vitest run)',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's-inj', seq: 0 }],
    });

    // 拍 1：懒立基线——差分恒零（零落账 + 零 diff 注入）；recall 按需注入在
    const out1 = await dispatch.waterfall<ContextTransformInput>(CONTEXT_TRANSFORM_EVENT, {
      sessionId: 's-inj',
      messages: [],
    });
    expect(out1.messages).toHaveLength(1); // 仅 recall 注入
    expect(out1.messages[0]).toMatchObject({ role: 'user' });
    expect(out1.messages[0]!.content).toContain('以下来自历史记忆'); // 防注入框架句
    expect(log.events().filter((e) => e.type === 'memory/diff')).toHaveLength(0);

    // 变更库：新行入册 → 相对基线差分非零
    dao.ingest({
      ownerKey: 'global',
      kind: 'insight',
      summary: 'diff lane probe row',
      content: 'diff lane probe row',
      confidence: 0.7,
      sourceRefs: [{ sessionId: 's-inj', seq: 1 }],
    });

    // 拍 2：差分落账（绑会话发射位经 sessions 服务面过闸）+ 注入两条（06 §328 序）
    const out2 = await dispatch.waterfall<ContextTransformInput>(CONTEXT_TRANSFORM_EVENT, {
      sessionId: 's-inj',
      messages: [],
    });
    expect(out2.messages).toHaveLength(2);
    expect(out2.messages[0]!.content).toContain('记忆简报自本会话基线以来的变化'); // DIFF_FRAME（diff 先）
    expect(out2.messages[1]!.content).toContain('以下来自历史记忆'); // recall 后
    const diffEvents = log.events().filter((e) => e.type === 'memory/diff');
    expect(diffEvents).toHaveLength(1);
    const payload = diffEvents[0]!.data as { entries?: { op?: string; summary?: string }[]; fingerprint?: string };
    expect(payload.entries).toHaveLength(1); // 基线后单行 = 单 '+' 条目
    expect(payload.entries![0]).toMatchObject({ op: '+', summary: 'diff lane probe row' });
    expect(typeof payload.fingerprint).toBe('string'); // 重启自愈判据位在场

    // 拍 3（库无变更）：mirror 已锁步——幂等零追写（注入仍渲染，落账不重复）
    const out3 = await dispatch.waterfall<ContextTransformInput>(CONTEXT_TRANSFORM_EVENT, {
      sessionId: 's-inj',
      messages: [],
    });
    expect(out3.messages).toHaveLength(2);
    expect(log.events().filter((e) => e.type === 'memory/diff')).toHaveLength(1);

    // 两腿零失败（warn 面无 '[memory]' 止步行）
    expect(warnings.filter((w) => w.includes('[memory]'))).toHaveLength(0);
    await persistence.close();
  });

  it('用户主权零干涉反向测试（P2 收口批）：两腿在场尽力注入——种子用户消息 byte-identical + durable 用户输入零篡改', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-sov-'));
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-sov-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'berry-coreplug-sov-home-'));
    dirs.push(dataDir, workspace, home);
    const persistence = Persistence.open({ dbPath: MEMORY_DB_PATH, migrations: MEMORY_MIGRATIONS });
    // durable 侧真 SessionLog：宿主位预置一条用户输入（注入腿只读不写的受护对象）
    const log = new SessionLog({ sessionId: 's-sov' });
    log.append('user/message', { content: '用户原话一字不改' });
    const durableBefore = JSON.stringify(log.events());
    const { scope, dispatch } = await bootCore(
      dataDir,
      memoryFs(),
      { cwd: workspace, homeDir: home },
      {
        sqlite: () => persistence.store.sqlite(),
        // durable 读脸：尾扫面供 recall query（与真实装配同形）
        fetchEvents: (sid) =>
          sid === 's-sov' ? [{ type: 'user/message', seq: 0, time: 0, data: { content: 'npm test' } }] : [],
        llm: () => ({ complete: async () => ({ message: { content: '' } }), canAfford: () => false }),
        sessionsFace: createSessionsFace({ driverOf: (sid) => (sid === 's-sov' ? { session: log } : undefined) }),
      },
    );
    const dao = scope.tryGet<{ dao: MemoryDao }>('memory')!.dao;
    dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'build runs npm test vitest',
      content: 'build runs npm test (vitest run)',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's-sov', seq: 0 }],
    });

    // 尽力注入形态：种子用户消息在批内 + recall 命中注入追加批尾（显式 UserMessage 注解锁 role 字面量）
    const seed: UserMessage = { role: 'user', content: 'npm test', timestamp: 1 };
    const out = await dispatch.waterfall<ContextTransformInput>(CONTEXT_TRANSFORM_EVENT, {
      sessionId: 's-sov',
      messages: [seed],
    });
    // ① 注入确实发生（recall 追加在批尾——「尽力注入」前提成立，反向断言才有载荷）
    expect(out.messages).toHaveLength(2);
    expect(out.messages[1]!.content).toContain('以下来自历史记忆');
    // ② 种子用户消息原条目零触碰（对象同一 + 字段不变——注入只追加不改写既有条目）
    expect(out.messages[0]).toBe(seed);
    expect(out.messages[0]).toMatchObject({ role: 'user', content: 'npm test' });
    // ③ durable 用户输入零篡改：事件序列字节不变（无新词、无改写——瞬态纪律的件级反向锁）
    expect(JSON.stringify(log.events())).toBe(durableBefore);
    expect(log.events()).toHaveLength(1);
    expect((log.events()[0]!.data as { content: string }).content).toBe('用户原话一字不改');
    await persistence.close();
  });

  it('memory 差分降级两形（批 19 销账笔）：sessions 服务缺席 = 只渲染不落账（mirror 不锁步）；无活体驱动拍 = 落账降级 warn + 恢复拍自续', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-deg-'));
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-deg-ws-'));
    const home = mkdtempSync(join(tmpdir(), 'berry-coreplug-deg-home-'));
    dirs.push(dataDir, workspace, home);
    const persistence = Persistence.open({ dbPath: MEMORY_DB_PATH, migrations: MEMORY_MIGRATIONS });
    const { scope, dispatch } = await bootCore(
      dataDir,
      memoryFs(),
      { cwd: workspace, homeDir: home },
      {
        sqlite: () => persistence.store.sqlite(),
        fetchEvents: () => [],
        llm: () => ({ complete: async () => ({ message: { content: '' } }), canAfford: () => false }),
        // sessions 服务缺席（assembly 不 provide 形）——差分只渲染不落账
      },
    );
    const dao = scope.tryGet<{ dao: MemoryDao }>('memory')!.dao;
    dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'baseline row',
      content: 'baseline row',
      confidence: 0.8,
      sourceRefs: [],
    });
    // 拍 1 懒立基线 + 变更库
    await dispatch.waterfall<ContextTransformInput>(CONTEXT_TRANSFORM_EVENT, { sessionId: 's-deg', messages: [] });
    dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'second row',
      content: 'second row',
      confidence: 0.7,
      sourceRefs: [],
    });
    // 拍 2：appendEvent seam 缺席——commit 返回 false 不锁步；注入随 mirror 旧值（零差分视角）缺席
    const out2 = await dispatch.waterfall<ContextTransformInput>(CONTEXT_TRANSFORM_EVENT, {
      sessionId: 's-deg',
      messages: [],
    });
    expect(out2.messages).toHaveLength(0); // recall 零命中 + diff 降级（mirror 未锁步回零）= 零注入
    await persistence.close();

    // —— 无活体驱动拍（sessions 在场但 driverOf 缺席）——
    const persistence2 = Persistence.open({ dbPath: MEMORY_DB_PATH, migrations: MEMORY_MIGRATIONS });
    const log2 = new SessionLog({ sessionId: 's-deg2' });
    const { scope: scope2, dispatch: dispatch2 } = await bootCore(
      dataDir,
      memoryFs(),
      { cwd: workspace, homeDir: home },
      {
        sqlite: () => persistence2.store.sqlite(),
        fetchEvents: () => [],
        llm: () => ({ complete: async () => ({ message: { content: '' } }), canAfford: () => false }),
        sessionsFace: createSessionsFace({
          // 会话表热切换形：拍 2 前「无活体驱动」、拍 3 前恢复在场
          driverOf: (sid) => (sid === 's-deg2' && driverTable.has(sid) ? { session: log2 } : undefined),
        }),
      },
    );
    const driverTable = new Map<string, true>();
    const dao2 = scope2.tryGet<{ dao: MemoryDao }>('memory')!.dao;
    dao2.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'baseline row 2',
      content: 'baseline row 2',
      confidence: 0.8,
      sourceRefs: [],
    });
    // 拍 1 懒立基线（sessions 无该会话——零差分拍不触发射位）+ 变更库
    await dispatch2.waterfall<ContextTransformInput>(CONTEXT_TRANSFORM_EVENT, { sessionId: 's-deg2', messages: [] });
    dao2.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'late row',
      content: 'late row',
      confidence: 0.7,
      sourceRefs: [],
    });
    // 拍 2：差分非零但 appendEventFor undefined（无活体驱动）→ commit 降级 warn、mirror 不锁步
    // （件内 warn 直写 console.error——spy 收窄断言「降级不静默」）
    const stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let stderrText = '';
    stderrSpy.mockImplementation((msg) => void (stderrText += `${msg}\n`));
    const outLate = await dispatch2.waterfall<ContextTransformInput>(CONTEXT_TRANSFORM_EVENT, {
      sessionId: 's-deg2',
      messages: [],
    });
    stderrSpy.mockRestore();
    expect(outLate.messages).toHaveLength(0); // 降级拍零注入（mirror 未锁步）
    expect(log2.events().filter((e) => e.type === 'memory/diff')).toHaveLength(0);
    expect(stderrText).toContain('差分落账'); // 降级 warn 不静默
    // 拍 3：会话恢复在场——差分仍非零（不锁步语义），落账自续 + 注入在场
    driverTable.set('s-deg2', true);
    const out3 = await dispatch2.waterfall<ContextTransformInput>(CONTEXT_TRANSFORM_EVENT, {
      sessionId: 's-deg2',
      messages: [],
    });
    expect(out3.messages).toHaveLength(1); // diff 注入补上（recall 零命中）
    expect(out3.messages[0]!.content).toContain('记忆简报自本会话基线以来的变化');
    expect(log2.events().filter((e) => e.type === 'memory/diff')).toHaveLength(1);
    await persistence2.close();
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

  it('credentials 件装载全环（c-5）：store 注入 → /credentials 注册 + handler 真调 add/rm/用法错 → 归因 credentials + 值不入文本；store 缺席 → 零注册（主闸）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-cred-'));
    dirs.push(dataDir);
    // 真库（credentials v7 表在场——:memory: 形自动 ephemeral 密钥）
    const persistence = Persistence.open({ dbPath: MEMORY_DB_PATH, migrations: [CREDENTIALS_MIGRATION] });
    const notified: string[] = [];
    const changed: CredentialChangedPayload[] = [];
    const { commands, commandSpecs } = await bootCore(
      dataDir,
      memoryFs(),
      {},
      {
        credentialsStore: persistence.store,
        credentialsOnChanged: (payload) => changed.push(payload),
        notify: (source, message) => {
          if (source === 'credentials') notified.push(message); // 归因位可辨
        },
      },
    );
    expect(commands).toContain('credentials');
    const cred = commandSpecs.find((spec) => spec.name === 'credentials');
    if (cred === undefined) throw new Error('/credentials 命令不在捕获面');

    // add 全环：真写库 + 结算文本归因投递 + 值不入文本（铁律）+ 审计载荷
    await cred.handler({ raw: '', argv: ['add', 'anthropic', 'sk-tui-secret-77e'] });
    expect(notified[notified.length - 1]).toContain('host/anthropic');
    expect(notified.join('\n')).not.toContain('sk-tui-secret-77e');
    expect(persistence.store.getCredential('host', 'anthropic')?.apiKey).toBe('sk-tui-secret-77e');
    expect(changed).toEqual([{ namespace: 'host', name: 'anthropic', action: 'add', origin: 'human' }]);

    // rm 命中 + 审计 remove
    await cred.handler({ raw: '', argv: ['rm', 'anthropic'] });
    expect(notified[notified.length - 1]).toContain('已撤销凭证 host/anthropic');
    expect(changed[changed.length - 1]).toEqual({
      namespace: 'host',
      name: 'anthropic',
      action: 'remove',
      origin: 'human',
    });

    // 用法错与执行错折文本（命令面是用户面——守卫错不炸通道）
    await cred.handler({ raw: '', argv: ['bogus'] });
    expect(notified[notified.length - 1]).toContain('未知子命令');
    await cred.handler({ raw: '', argv: ['rm', 'ghost'] });
    expect(notified[notified.length - 1]).toContain('CREDENTIALS_NOT_FOUND');

    // 主闸：store seam 缺席 = 零注册（空闲占席——装载计数/禁用位语义不受影响）
    const bare = await bootCore(dataDir, memoryFs());
    expect(bare.commands).not.toContain('credentials');
    await persistence.close();
  });

  it('credentials oauth 全环（c-6）：人面动词 → 流解析 → invoke 宿主回调窗 → device-code 舞步（假 fetch）→ 插件窗内写自域 + present 含 user_code + 值不入文本 + 完成回执；未装配 → 诚实文本', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-oauth-'));
    dirs.push(dataDir);
    // 真库（:memory: 形自动 ephemeral 密钥）+ 流注册表真身（与 bootCore 注入
    // 同一实例——assembly 单真身等价形）
    const persistence = Persistence.open({ dbPath: MEMORY_DB_PATH, migrations: [CREDENTIALS_MIGRATION] });
    const registry = createOAuthFlowRegistry();
    const notified: string[] = [];
    // 脚本化 fetch：发起 → pending（interval 0 = sleep 0 即返）→ 成功
    const script = [
      {
        json: {
          device_code: 'dev-77',
          user_code: 'WDJB-MJHT',
          verification_uri: 'https://github.example/device',
          expires_in: 600,
          interval: 0,
        },
      },
      { json: { error: 'authorization_pending' }, ok: false, status: 400 },
      { json: { access_token: 'gho dance-secret-a1', refresh_token: 'ghr dance-refresh-b2', expires_in: 3600 } },
    ];
    let scriptIndex = 0;
    const fetchFn = (async (_url: string) => {
      const s = script[scriptIndex++]!;
      return { ok: s.ok ?? true, status: s.status ?? 200, text: async () => JSON.stringify(s.json) };
    }) as OAuthFetchLike;

    // 开窗器替身：invoke 期间旗标开（宿主回调窗语义——handler 体内断言用）
    let inWindow = false;
    let seenInHandler = false;
    // 预注册流（形式 (b)：手工入册共享 registry + handler 直写 store 模拟窗内
    // ctx.secrets.set——face→窗集成归 secrets.test；bootCore 无 secrets 装配）
    registry.register(
      'demo',
      {
        def: {
          name: 'github',
          deviceAuthUrl: 'https://github.example/login/device/code',
          tokenUrl: 'https://github.example/login/oauth/access_token',
          clientId: 'client-abc',
        },
        handler: async (io) => {
          seenInHandler = inWindow; // handler 体内 = 宿主回调窗内
          const grant = await io.runDeviceCode();
          // 窗内写自域（token 经 io 返回值内存过手——主行 + 独立加密刷新行，
          // meta 永不持值铁律）
          persistence.store.setCredential('plugin:demo', 'github', {
            apiKey: grant.accessToken,
            meta: { source: 'oauth', refreshName: 'github.refresh', expiresAt: grant.expiresAt },
          });
          if (grant.refreshToken !== undefined) {
            persistence.store.setCredential('plugin:demo', 'github.refresh', {
              apiKey: grant.refreshToken,
              meta: { source: 'oauth' },
            });
          }
        },
      },
      () => ((inWindow = true), () => (inWindow = false)),
    );

    const { commandSpecs } = await bootCore(
      dataDir,
      memoryFs(),
      {},
      {
        credentialsStore: persistence.store,
        credentialsOAuth: { registry, fetchFn, intervalMs: 0 }, // 0 = 刷新链不自驱（行为面归 refresh.test）
        notify: (source, message) => {
          if (source === 'credentials') notified.push(message);
        },
      },
    );
    const cred = commandSpecs.find((spec) => spec.name === 'credentials');
    if (cred === undefined) throw new Error('/credentials 命令不在捕获面');

    // 缺省名解析（demo 单流自动选中）→ dance 全环 → 完成回执
    await cred.handler({ raw: '', argv: ['oauth', 'demo'] });
    const joined = notified.join('\n');
    expect(joined).toContain('WDJB-MJHT'); // present 用户码直达
    expect(joined).toContain('https://github.example/device');
    expect(joined).toContain('oauth 授权流完成');
    expect(joined).toContain('plugin:demo/github'); // 回执指路（名不是值）
    expect(joined).not.toContain('gho dance-secret-a1'); // 值不入文本（铁律）
    expect(joined).not.toContain('ghr dance-refresh-b2');
    expect(seenInHandler).toBe(true); // handler 体内窗开
    expect(inWindow).toBe(false); // 收口即合窗
    // 落行断言：主行 + 刷新行分立（meta 永不持值——refreshName 是名不是值）
    const main = persistence.store.getCredential('plugin:demo', 'github');
    expect(main?.apiKey).toBe('gho dance-secret-a1');
    expect((main?.meta as { source: string; refreshName: string }).refreshName).toBe('github.refresh');
    expect(persistence.store.getCredential('plugin:demo', 'github.refresh')?.apiKey).toBe('ghr dance-refresh-b2');

    // 指名未命中 → 指路在册流
    await cred.handler({ raw: '', argv: ['oauth', 'demo', 'gitlab'] });
    expect(notified[notified.length - 1]).toContain('不在插件 demo 名下');

    // 受局面缺席（store 在、oauth 槽不在）→ 诚实文本不炸
    const noOauthNotified: string[] = [];
    const noOauthDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-oauth2-'));
    dirs.push(noOauthDir);
    const noOauth = await bootCore(
      noOauthDir,
      memoryFs(),
      {},
      {
        credentialsStore: persistence.store,
        notify: (source, message) => {
          if (source === 'credentials') noOauthNotified.push(message);
        },
      },
    );
    const credBare = noOauth.commandSpecs.find((spec) => spec.name === 'credentials');
    if (credBare === undefined) throw new Error('/credentials 命令不在捕获面（noOauth）');
    await credBare.handler({ raw: '', argv: ['oauth', 'demo'] });
    expect(noOauthNotified[noOauthNotified.length - 1]).toContain('oauth 流面未装配');
    await persistence.close();
  });

  it('scheduler 主闸（sqlite 缺席）：件零装载——服务面缺席 + /tick 不注册', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-sgate-'));
    dirs.push(dataDir);
    const { scope, commands } = await bootCore(dataDir); // 无 coreDeps = sqlite 缺席
    expect(scope.tryGet('scheduler')).toBeUndefined(); // 诚实缺席律
    expect(commands).not.toContain('tick');
  });

  it('goal 件装载全环（批 19c-3）：主闸双位在场 → 服务面 + goal_update + /goal 注册 + 挂钟委派真行 + todoFactory 换装 + 完成否决律', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-goal-'));
    dirs.push(dataDir);
    // 迁移链 = 宿主聚合同构（v2 scheduler + v3 goal + v4-6 memory 全在链，
    // runtime.ts 聚合形镜像）
    const persistence = Persistence.open({
      dbPath: MEMORY_DB_PATH,
      migrations: [SCHEDULER_MIGRATION, GOAL_MIGRATION, ...MEMORY_MIGRATIONS],
    });
    const notified: string[] = [];
    // goalSession 面：内存 SessionLog 单会话真身（events 视图 + 长度真值）
    const session = new SessionLog({ sessionId: 's-goal' });
    const goalSession: GoalSessionFace = {
      events: (sid) => (sid === 's-goal' ? session.events() : []),
      length: (sid) => (sid === 's-goal' ? session.events().length : 0),
    };
    const { scope, boot, commands, commandSpecs } = await bootCore(
      dataDir,
      memoryFs(),
      {},
      {
        sqlite: () => persistence.store.sqlite(),
        goalSession,
        notify: (source, message) => {
          if (source === 'goal') notified.push(message); // 归因位可辨（notify 双参化回归锁）
        },
      },
    );

    // 服务面：'goal' 在场（service 全环 + todoFactory 换装工厂）
    const face = scope.tryGet<GoalFace>('goal');
    expect(face).toBeDefined();
    // goal_update 在 boot 全局层（执行时会话解析包装 def）+ /goal 命令注册
    expect(boot.tools.definitions().map((d) => d.name)).toContain('goal_update');
    expect(commands).toContain('goal');

    // 挂钟委派真行（迟到注入先行腿——注册表序 scheduler 先装载即挂即用）：
    // activate → jobs 表 goal-<id> builtin 建行即启
    const row = await face!.service.activate({
      sessionId: 's-goal',
      objective: '测试目标——装载全环',
      schedule: 'every:60s',
    });
    const schedFace = scope.tryGet<SchedulerFace>('scheduler')!;
    expect(schedFace.service.getJob(`goal-${row.id}`)?.builtin).toBe(true);
    expect(schedFace.service.getJob(`goal-${row.id}`)?.enabled).toBe(true); // 建行即启

    // goalScopeFor 锚：active goal 会话取 {goalId, activatedSeq}（锚 = 激活时
    // 会话日志长度——空会话 0）
    expect(face!.service.goalScopeFor('s-goal')).toEqual({ goalId: row.id, activatedSeq: 0 });

    // todoFactory 换装产物：同名 'todo' + 段内扩展字段过闸 + durable 同词承载
    const todo = face!.todoFactory({
      append: (data) => session.append('todo/write', data),
      getScope: () => ({ goalId: row.id, activatedSeq: 0 }),
    });
    expect(todo.name).toBe('todo');
    await todo.execute(
      { items: [{ status: 'in-progress', content: '推进装载批', resume_when: 'after@+5m' }] },
      { toolCallId: 'c-goal-todo' },
    );
    const todoWrite = session.events().find((event) => event.type === 'todo/write');
    expect(JSON.stringify(todoWrite?.data)).toContain('推进装载批');

    // 完成否决律（03 §10.5 open 项 = 一切非 completed，deferred 含内）：
    // goal_update 经 toolCtx.sessionId 解析会话 → activeFor → 机器否决
    const updateDef = boot.tools.definitions().find((d) => d.name === 'goal_update')!;
    const veto = await updateDef
      .execute({ status: 'completed', evidence: '自报完成' }, { toolCallId: 'c-goal-upd', sessionId: 's-goal' })
      .catch((err: unknown) => err);
    expect(veto).toBeInstanceOf(BaseError);
    expect((veto as BaseError).code).toBe('GOAL_TRANSITION_INVALID');

    // 清表后真完成（全绿：空 open 项 + 无 gate 声明）→ 终态同笔停摆 + 锚失活
    await todo.execute(
      { items: [{ status: 'completed', content: '推进装载批', no_follow_up: true }] },
      { toolCallId: 'c-goal-todo2' },
    );
    const done = await updateDef.execute(
      { status: 'completed', evidence: '全绿完成' },
      { toolCallId: 'c-goal-upd2', sessionId: 's-goal' },
    );
    expect(JSON.stringify(done)).toContain('已完成');
    expect(schedFace.service.getJob(`goal-${row.id}`)?.enabled).toBe(false); // 终态停摆
    expect(face!.service.goalScopeFor('s-goal')).toBeUndefined(); // 锚失活

    // /goal handler 真调：list → 输出面归因 goal 的结算文本
    const goalCmd = commandSpecs.find((spec) => spec.name === 'goal');
    if (goalCmd === undefined) throw new Error('/goal 命令不在捕获面');
    await goalCmd.handler({ raw: '', argv: ['list'] });
    expect(notified[notified.length - 1]!).toContain('共 1 个 goal');
    await persistence.close();
  });

  it('goal agent_pre_step 复验监听 + 沉淀摘要注入面（批 #99）：超帽置 stop、未超帽/无 goal/卸载后直通；goalSummarizer 透传单发', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-goal2-'));
    dirs.push(dataDir);
    const persistence = Persistence.open({
      dbPath: MEMORY_DB_PATH,
      migrations: [SCHEDULER_MIGRATION, GOAL_MIGRATION, ...MEMORY_MIGRATIONS],
    });
    const session = new SessionLog({ sessionId: 's-goal2' });
    const goalSession: GoalSessionFace = {
      events: (sid) => (sid === 's-goal2' ? session.events() : []),
      length: (sid) => (sid === 's-goal2' ? session.events().length : 0),
    };
    const prompts: string[] = [];
    const { scope, dispatch, boot } = await bootCore(
      dataDir,
      memoryFs(),
      {},
      {
        sqlite: () => persistence.store.sqlite(),
        goalSession,
        goalSummarizer: {
          complete: async (req) => {
            prompts.push(req.prompt);
            return { text: '沉淀摘要体' };
          },
        },
      },
    );
    expect(dispatch.isRegistered(AGENT_PRE_STEP_EVENT)).toBe(true); // boot 预注册词表（词自举律前置位）

    const face = scope.tryGet<GoalFace>('goal')!;
    const row = await face.service.activate({
      sessionId: 's-goal2',
      objective: '复验目标',
      schedule: 'every:60s',
      budgetMessagesCap: 1,
    });

    // 未超帽直通：stop 缺席
    const pass = await dispatch.waterfall<PreStepInput>(AGENT_PRE_STEP_EVENT, { sessionId: 's-goal2', reminders: [] });
    expect(pass.stop).toBeUndefined();
    // 无 goal 会话直通（他域零打扰——goalScopeFor undefined）
    const other = await dispatch.waterfall<PreStepInput>(AGENT_PRE_STEP_EVENT, { sessionId: 's-other', reminders: [] });
    expect(other.stop).toBeUndefined();

    // 超帽刹停：recordTurn 到帽 → budgetExceeded 复验置 stop（waterfall 值直改）
    face.service.recordTurn(row.id);
    const braked = await dispatch.waterfall<PreStepInput>(AGENT_PRE_STEP_EVENT, {
      sessionId: 's-goal2',
      reminders: [],
    });
    expect(braked.stop).toMatchObject({ reason: expect.stringContaining('预算帽') });

    // 沉淀摘要注入面：deps.goalSummarizer 透传 depositFor（回退先承载 → 后台单发落地缓存）
    expect(face.service.depositFor('s-goal2')).toContain('目标：复验目标');
    await new Promise((resolve) => void setTimeout(resolve, 0));
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('复验目标');
    expect(face.service.depositFor('s-goal2')).toBe('沉淀摘要体');

    // disposer 回卷：卸载后监听器离场（budget 事实仍在而 waterfall 直通——stop 不再置）
    await boot.report.unload();
    const after = await dispatch.waterfall<PreStepInput>(AGENT_PRE_STEP_EVENT, { sessionId: 's-goal2', reminders: [] });
    expect(after.stop).toBeUndefined();
    await persistence.close();
  });

  it('goal 主闸二缺席（goalSession 缺席）：件零装载——服务面缺席 + 零工具 + /goal 不注册（scheduler 不连坐）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-ggate-'));
    dirs.push(dataDir);
    const persistence = Persistence.open({
      dbPath: MEMORY_DB_PATH,
      migrations: [SCHEDULER_MIGRATION, GOAL_MIGRATION, ...MEMORY_MIGRATIONS],
    });
    // sqlite 在场、goalSession 缺席——主闸二独立执法（goalSession 是会话
    // 读面缺席即无 fold 重放源，件整体不装）
    const { scope, boot, commands } = await bootCore(
      dataDir,
      memoryFs(),
      {},
      {
        sqlite: () => persistence.store.sqlite(),
      },
    );
    expect(scope.tryGet('goal')).toBeUndefined();
    expect(boot.tools.definitions().map((d) => d.name)).not.toContain('goal_update');
    expect(commands).not.toContain('goal');
    expect(scope.tryGet('scheduler')).toBeDefined(); // 主闸二不连坐主闸一
    await persistence.close();
  });

  it('checkpoint 件装载全环：gate 捕获（per-run 一 manifest）→ /rewind list/preview/restore 三动词真调（fork 面 + 焦点会话 + 保底拍）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-cpgate-'));
    dirs.push(dataDir);
    // 独立工作区（capture 真 walk/真哈希/真落仓——restore 真恢复）
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-ws-'));
    dirs.push(workspace);
    writeFileSync(join(workspace, 'a.txt'), 'v1');

    const notified: string[] = [];
    // 语境面：可变边界格（closure 内推进——模拟 turn 闭合）+ 工作区锚
    let boundary = 3;
    const checkpointSession: SessionContextFace = {
      contextOf: (sid) => (sid === 's-rew' ? { lastClosedBoundary: boundary, workspaceRoot: workspace } : undefined),
    };
    // fork 面：调用记录桩（restore 第③腿——回执 forked 会话 id）
    const forkCalls: { source: string; upToSeq: number }[] = [];
    const checkpointFork: RewindForkFace = {
      fork: async (source, options) => {
        forkCalls.push({ source, upToSeq: options.upToSeq });
        return { status: 'forked', sessionId: 'fork-1' };
      },
    };
    const { dispatch, commands, commandSpecs } = await bootCore(
      dataDir,
      memoryFs(),
      {},
      {
        checkpointSession,
        checkpointFork,
        focusSessionId: () => 's-rew',
        notify: (source, message) => {
          if (source === 'checkpoint') notified.push(message); // 归因位可辨
        },
      },
    );
    expect(commands).toContain('rewind');

    // gate 真捕获：write 效果 + 会话可解 + 边界推进 → manifest 落仓（真 walk/哈希/blob）
    const fireGate = (effect: 'read' | 'write', sessionId?: string) =>
      dispatch.waterfall<GateInput>('tools_pre_execute', {
        tool: { name: 'probe', effect } as GateInput['tool'],
        args: {},
        toolCallId: `c-${effect}`,
        mutated: false,
        ...(sessionId !== undefined ? { sessionId } : {}),
      });
    await fireGate('write', 's-rew');
    const store = openCheckpointStore(dataDir);
    let manifests = await store.listManifests();
    expect(manifests).toHaveLength(1);
    expect(manifests[0]!.trigger).toBe('mutation');
    expect(manifests[0]!.boundarySeq).toBe(3);
    expect(manifests[0]!.workspaceRoot).toBe(workspace);
    expect(manifests[0]!.files.map((f) => f.path)).toContain('a.txt');

    // per-run 判据：同边界再写不重拍；read 效果不拍；他会话/无会话不拍
    await fireGate('write', 's-rew');
    await fireGate('read', 's-rew');
    await fireGate('write', 's-other');
    await fireGate('write');
    expect(await store.listManifests()).toHaveLength(1);

    // 新 run（turn 闭合边界推进）+ 文件已变异 → 新拍
    boundary = 6;
    writeFileSync(join(workspace, 'a.txt'), 'v2');
    await fireGate('write', 's-rew');
    manifests = await store.listManifests();
    expect(manifests).toHaveLength(2);
    const first = manifests.find((m) => m.boundarySeq === 3)!;

    // /rewind handler 真调：list 按焦点会话工作区锚列点
    const rewindCmd = commandSpecs.find((spec) => spec.name === 'rewind');
    if (rewindCmd === undefined) throw new Error('/rewind 命令不在捕获面');
    await rewindCmd.handler({ raw: 'list', argv: ['list'] });
    expect(notified[notified.length - 1]!).toContain('本工作区共 2 个回退点');

    // preview：零改动对账（当前 v2 vs 快照 v1 → 恢复 1）
    await rewindCmd.handler({ raw: `preview ${first.id}`, argv: ['preview', first.id] });
    expect(notified[notified.length - 1]!).toContain('预演对账（零改动）：恢复 1');

    // restore：保底拍 + 文件真恢复 v1 + fork 面（upToSeq = 回退点 seq）
    await rewindCmd.handler({ raw: `restore ${first.id}`, argv: ['restore', first.id] });
    const restoreText = notified[notified.length - 1]!;
    expect(restoreText).toContain('已回退至');
    expect(restoreText).toContain('已 fork 新会话 fork-1');
    expect(readFileSync(join(workspace, 'a.txt'), 'utf8')).toBe('v1');
    expect(forkCalls).toEqual([{ source: 's-rew', upToSeq: 3 }]);
    // 保底拍在场（trigger 'pre-rewind'——rewind 自身可回退）+ 计 3 份
    const after = await store.listManifests();
    expect(after.some((m) => m.trigger === 'pre-rewind')).toBe(true);
    expect(after).toHaveLength(3);
  });

  it('checkpoint 主闸三位：dataDir null 或任一 seam 缺席 = 件零装载（/rewind 不注册 + gate 零捕获）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-cpoff-'));
    dirs.push(dataDir);
    const sessionFace: SessionContextFace = { contextOf: () => undefined };
    const forkFace: RewindForkFace = { fork: async () => ({ status: 'vetoed', reason: '桩' }) };
    // 主闸一（dataDir null——纯 :memory: 诊断形，两 seam 在场仍不装）
    const bootedNull = await bootCore(
      null,
      memoryFs(),
      {},
      { checkpointSession: sessionFace, checkpointFork: forkFace },
    );
    expect(bootedNull.commands).not.toContain('rewind');
    // 主闸二/三（seam 缺席——dataDir 在场仍不装）
    const bootedSeamless = await bootCore(dataDir, memoryFs(), {});
    expect(bootedSeamless.commands).not.toContain('rewind');
    // gate 零捕获：write 瀑布直通无 manifest（仓目录未建零副作用）
    const out = await bootedSeamless.dispatch.waterfall<GateInput>('tools_pre_execute', {
      tool: { name: 'probe', effect: 'write' } as GateInput['tool'],
      args: {},
      toolCallId: 'c-off',
      mutated: false,
      sessionId: 's-any',
    });
    expect(out.outcome).toBeUndefined(); // 放行直通（无本件行）
    expect(await openCheckpointStore(dataDir).listManifests()).toHaveLength(0);
  });

  it('/rewind 无焦点会话：focusSessionId 缺席 = 诚实拒（输出面含指引非静默）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-cpfocus-'));
    dirs.push(dataDir);
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-wsf-'));
    dirs.push(workspace);
    const notified: string[] = [];
    const checkpointSession: SessionContextFace = {
      contextOf: () => ({ lastClosedBoundary: 1, workspaceRoot: workspace }),
    };
    const { commands, commandSpecs } = await bootCore(
      dataDir,
      memoryFs(),
      {},
      {
        checkpointSession,
        checkpointFork: { fork: async () => ({ status: 'vetoed', reason: '桩' }) },
        notify: (source, message) => {
          if (source === 'checkpoint') notified.push(message);
        },
      },
    );
    expect(commands).toContain('rewind'); // gate/命令照装——焦点位缺席只拒本动词
    const rewindCmd = commandSpecs.find((spec) => spec.name === 'rewind')!;
    await rewindCmd.handler({ raw: 'list', argv: ['list'] });
    expect(notified[notified.length - 1]!).toContain('无焦点会话');
  });

  it('三桥零 config 惰性装载全环（批 19d）：三服务面 + LSP 静态四件 + browser 十件 + /browser 命令 + 零 spawn 零网络', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-bridges-'));
    dirs.push(dataDir);
    const { scope, boot, commands } = await bootCore(dataDir);

    // 三服务面 provide（mcp 观测面 / browser 编排件 / lsp 诊断面）
    expect(scope.tryGet('mcp')).toBeDefined();
    expect(scope.tryGet('browser')).toBeDefined();
    expect(scope.tryGet('lsp')).toBeDefined();

    // LSP 静态四件（注册不依赖服务器在线——与 MCP「装配后异步发现」的结构性差异）
    const names = boot.tools.definitions().map((d) => d.name);
    for (const tool of ['diagnostics', 'symbols', 'definitions', 'references']) {
      expect(names).toContain(tool);
    }
    // browser 工具面十件（惰性首用——apply 零 spawn 零连接即注册）
    for (const tool of ['navigate', 'snapshot', 'click', 'type', 'press', 'screenshot']) {
      expect(names).toContain(tool);
    }
    // /browser 命令注册（下载原语不进模型工具面——人面显式命令）
    expect(commands).toContain('browser');

    // 惰性执法全环：零 config = 零子进程（mcp servers 空 + lsp servers 空 +
    // browser 零引擎发现）——装载期间无真 spawn/真网络（测试零网络纪律）；
    // counts 口径 = activated 数：19e 四件（sdk/webui/obs/issue）在零 seam
    // 测试形下主闸早退仍计 activated——16 件齐册全计（c-3 credentials 增席）
    expect(boot.counts).toEqual({ total: 16, enabled: 16, failed: 0 });
  });

  it('exec 禁用 = 三桥连坐零装载（spawn 单源不自建——04 §11）：三服务面缺席 + LSP 静态四件不注册 + /browser 不注册', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-broff-'));
    dirs.push(dataDir);
    const { scope, boot, commands } = await bootCore(
      dataDir,
      memoryFs({ [join(dataDir, 'enabled.yaml')]: 'plugins:\n  - id: core:exec\n    disabled: true\n' }),
    );
    // 三桥主闸 = 'exec-pipeline' 供给缺席——诚实缺席律（单册单源不旁路自建）
    expect(scope.tryGet('mcp')).toBeUndefined();
    expect(scope.tryGet('browser')).toBeUndefined();
    expect(scope.tryGet('lsp')).toBeUndefined();
    const names = boot.tools.definitions().map((d) => d.name);
    expect(names).not.toContain('diagnostics'); // LSP 静态四件连坐
    expect(names).not.toContain('navigate'); // browser 十件连坐
    expect(commands).not.toContain('browser');
    // 其余件不连坐（counts 口径 = activated 数：三桥 apply 早退无操作仍计
    // activated——诚实缺席在服务面/工具面，不在行计；exec 1 行 skipped）
    expect(boot.counts).toEqual({ total: 16, enabled: 15, failed: 0 });
  });

  it('browser 主闸 dataDir 位：纯 :memory: 形零装载（mcp/lsp 不连坐——两桥无 dataDir 闸）', async () => {
    const { scope, boot } = await bootCore(null);
    expect(scope.tryGet('browser')).toBeUndefined(); // 引擎目录/截图落点/安装账本皆无归属地
    expect(boot.tools.definitions().map((d) => d.name)).not.toContain('navigate');
    expect(scope.tryGet('mcp')).toBeDefined(); // mcp/lsp 只闸 exec 管道——不连坐
    expect(scope.tryGet('lsp')).toBeDefined();
    expect(boot.tools.definitions().map((d) => d.name)).toContain('diagnostics');
  });

  it('MCP 坏形 config（core:mcp 行 servers 非对象）→ core 行 fail-loud 拒启（MCP_CONFIG_INVALID）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-mcpcfg-'));
    dirs.push(dataDir);
    // enabled.yaml core:mcp 行 config 整值替换——servers 坏形（字符串）
    const fs = memoryFs({
      [join(dataDir, 'enabled.yaml')]: 'plugins:\n  - id: core:mcp\n    config:\n      servers: oops\n',
    });
    const err = await bootCore(dataDir, fs).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BaseError);
    // invokeApply 三态包装律：apply 抛错归一 PLUGIN_APPLY_FAILED（cause 保真
    // MCP_CONFIG_INVALID）；core 行 fail-loud 再包 CorePluginBootError（报文含件 id）
    expect((err as BaseError).code).toBe('PLUGIN_APPLY_FAILED');
    expect((err as BaseError).message).toContain('core:mcp'); // core 行 fail-loud 拒启（已活行 LIFO 回卷不留半装配）
    expect((err as BaseError).message).toContain('config.servers 须为对象'); // 归一器响亮拒文本透出
    const cause = (err as BaseError).cause;
    expect(cause).toBeInstanceOf(BaseError);
    // cause 链双层：CorePluginBootError.cause = invokeApply 包装层（同码
    // PLUGIN_APPLY_FAILED），其 cause = 归一器真因 MCP_CONFIG_INVALID
    expect((cause as BaseError).code).toBe('PLUGIN_APPLY_FAILED');
    const rootCause = (cause as BaseError).cause;
    expect(rootCause).toBeInstanceOf(BaseError);
    expect((rootCause as BaseError).code).toBe('MCP_CONFIG_INVALID'); // 坏形真因可溯
  });

  it('goal hasLsp 回补（批 19d）：lsp 序内前件在场 → diagnostics 判据门申报过闸；core:lsp 禁用 → 申报即拒（fail-closed）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-lspgoal-'));
    dirs.push(dataDir);
    const persistence = Persistence.open({
      dbPath: MEMORY_DB_PATH,
      migrations: [SCHEDULER_MIGRATION, GOAL_MIGRATION, ...MEMORY_MIGRATIONS],
    });
    const session = new SessionLog({ sessionId: 's-lg' });
    const goalSession: GoalSessionFace = {
      events: (sid) => (sid === 's-lg' ? session.events() : []),
      length: (sid) => (sid === 's-lg' ? session.events().length : 0),
    };

    // 形 A：全 core 装载（lsp 序内前件在场）——diagnostics 门申报过闸 + durable 承载
    const booted = await bootCore(dataDir, memoryFs(), {}, { sqlite: () => persistence.store.sqlite(), goalSession });
    const face = booted.scope.tryGet<GoalFace>('goal')!;
    expect(face).toBeDefined();
    const row = await face.service.activate({
      sessionId: 's-lg',
      objective: 'hasLsp 回补回归锁',
      schedule: 'every:60s',
    });
    const todo = face.todoFactory({
      append: (data) => session.append('todo/write', data),
      getScope: () => ({ goalId: row.id, activatedSeq: 0 }),
    });
    // diagnostics 门在场 = 申报过闸（hasLsp true——lsp provide 面真接线）
    await todo.execute(
      {
        items: [{ status: 'in-progress', content: '诊断门条目', gate: { kind: 'diagnostics', files: ['src/a.ts'] } }],
      },
      { toolCallId: 'c-lg-todo' },
    );
    expect(JSON.stringify(session.events().find((event) => event.type === 'todo/write')?.data)).toContain('诊断门条目');

    // 形 B：core:lsp 禁用（exec 在场 = mcp 照装）——hasLsp false = 申报即拒
    const sessionB = new SessionLog({ sessionId: 's-lg2' });
    const bootedB = await bootCore(
      dataDir,
      memoryFs({ [join(dataDir, 'enabled.yaml')]: 'plugins:\n  - id: core:lsp\n    disabled: true\n' }),
      {},
      {
        sqlite: () => persistence.store.sqlite(),
        goalSession: {
          events: (sid) => (sid === 's-lg2' ? sessionB.events() : []),
          length: (sid) => (sid === 's-lg2' ? sessionB.events().length : 0),
        },
      },
    );
    expect(bootedB.scope.tryGet('lsp')).toBeUndefined(); // 禁用行生效
    expect(bootedB.scope.tryGet('mcp')).toBeDefined(); // exec 在场 = mcp 不连坐
    const faceB = bootedB.scope.tryGet<GoalFace>('goal')!;
    const todoB = faceB.todoFactory({
      append: (data) => sessionB.append('todo/write', data),
      getScope: () => ({ goalId: 'g-any', activatedSeq: 0 }),
    });
    const rejected = await todoB
      .execute(
        {
          items: [{ status: 'in-progress', content: '诊断门条目', gate: { kind: 'diagnostics', files: ['src/a.ts'] } }],
        },
        { toolCallId: 'c-lg-todo2' },
      )
      .catch((e: unknown) => e);
    expect(rejected).toBeInstanceOf(BaseError);
    expect((rejected as BaseError).code).toBe('GOAL_TODO_SCOPE');
    expect((rejected as BaseError).message).toContain('lsp 诊断查询面缺席'); // fail-closed 非静默跳过
    await persistence.close();
  });

  it('/browser 未知动词：usage 拒（人面文案含指引非静默）——install 动词不真调（零网络）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-brcmd-'));
    dirs.push(dataDir);
    const notified: string[] = [];
    const { commands, commandSpecs } = await bootCore(
      dataDir,
      memoryFs(),
      {},
      {
        notify: (source, message) => {
          if (source === 'browser') notified.push(message);
        },
      },
    );
    expect(commands).toContain('browser');
    const browserCmd = commandSpecs.find((spec) => spec.name === 'browser')!;
    await browserCmd.handler({ raw: 'foo', argv: ['foo'] });
    expect(notified[notified.length - 1]!).toContain('/browser install'); // usage 指引
  });

  it('sdk/webui 两件 kit 供给（批 19e）：seam 在场 → 双 kit provide 透传真身；缺席 → 零装载（诚实缺席律）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-kit-'));
    dirs.push(dataDir);
    let mountCalls = 0;
    const fakeMount: WebuiFaceMount = {
      webui: {} as unknown as WebuiFaceMount['webui'], // kit 供给例不真挂载——结构占位
      deps: {} as unknown as WebuiFaceMount['deps'],
      detach: () => undefined,
    };
    const { scope } = await bootCore(
      dataDir,
      memoryFs(),
      {},
      {
        sdkFaceFactory: createSdkHttpFace,
        webuiFaceMount: () => {
          mountCalls += 1;
          return fakeMount;
        },
      },
    );
    // 双 kit provide：sdk 面工厂同引用透传（装配闭包直传——零第二套包装）
    const sdkKit = scope.tryGet<{ createFace: typeof createSdkHttpFace }>('sdk-http-face');
    expect(sdkKit).toBeDefined();
    expect(sdkKit!.createFace).toBe(createSdkHttpFace);
    expect(scope.tryGet('webui-face-mount')).toBeDefined();
    expect(mountCalls).toBe(0); // kit 晚绑——apply 期零触面（装载 ≠ 开面）

    // seam 缺席形：两件零装载——kit 缺席 = daemon 拒启/前台不开面的执法源
    const bare = await bootCore(dataDir);
    expect(bare.scope.tryGet('sdk-http-face')).toBeUndefined();
    expect(bare.scope.tryGet('webui-face-mount')).toBeUndefined();
  });

  it('obs 件装载全环（批 19e）：双主闸在场 → 服务面 + obs_query 工具 + 首拍摄取 + rollup.db 落盘 + 坏条告警降级不炸件', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-obs-'));
    dirs.push(dataDir);
    let queryCount = 0;
    const events: ObsEventsFace = {
      queryEvents: () => {
        queryCount += 1;
        return { events: [], nextCursor: null };
      },
    };
    // enabled.yaml core:obs 行 config：一好一坏两条告警——坏条降级律（03 §10.8：
    // warn 跳过该条、不整件失败——与 mcp/browser 坏形响亮拒分立两律）
    const { scope, boot } = await bootCore(
      dataDir,
      memoryFs({
        [join(dataDir, 'enabled.yaml')]:
          'plugins:\n  - id: core:obs\n    config:\n      alerts:\n        - kind: token_spend_hourly\n          thresholdTokens: 1000\n        - kind: bad_kind\n          thresholdTokens: -1\n',
      }),
      {},
      { obsEvents: events },
    );
    expect(scope.tryGet('obs')).toBeDefined(); // 坏条未炸件——摄取/查询面照装
    expect(boot.tools.definitions().map((d) => d.name)).toContain('obs_query');
    expect(queryCount).toBeGreaterThan(0); // 装载即首拍 refresh（连接即当下——不等挂钟）
    expect(existsSync(join(dataDir, 'data', 'obs', 'rollup.db'))).toBe(true); // 自管库落盘（03 §10.8 容忍条款——data/obs/ 子目录）
    expect(boot.counts).toEqual({ total: 16, enabled: 16, failed: 0 });

    // 主闸缺席形：dataDir null（:memory: 诊断形）→ 零装载
    const bare = await bootCore(null, memoryFs(), {}, { obsEvents: events });
    expect(bare.scope.tryGet('obs')).toBeUndefined();
  });

  it('issue 件双形（批 19e）：session seam 缺席主闸三早退零装载；全环形 = 服务面 + webhook kit（config 经 enabled.yaml 注入 + 真前件链）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-issue-'));
    dirs.push(dataDir);
    // 真 :memory: 座 + 聚合迁移链（scheduler 件装载 → tryGet 'scheduler' 前件在场）
    const persistence = Persistence.open({
      dbPath: MEMORY_DB_PATH,
      migrations: [SCHEDULER_MIGRATION, ...MEMORY_MIGRATIONS],
    });
    const session: IssueSessionFace = {
      startHeadless: async () => ({
        sessionId: 's-issue-1',
        outcome: Promise.resolve({ status: 'completed', messagesUsed: 1, summary: 'ok' }),
      }),
    };
    const state: IssueStoreStateFace = {
      getStoreState: () => undefined,
      setStoreState: () => undefined,
      deleteStoreState: () => false,
    };
    const budget: IssueBudgetFace = { canAffordIssue: () => ({ ok: true }) };
    const issueYaml = 'plugins:\n  - id: core:issue\n    config:\n      repos:\n        - owner/repo\n';

    // 形 A：session seam 缺席（挂账形——assembly 不传 issueSession）→ 主闸三早退
    const bare = await bootCore(
      dataDir,
      memoryFs({ [join(dataDir, 'enabled.yaml')]: issueYaml }),
      {},
      {
        sqlite: () => persistence.store.sqlite(),
        issueGithubToken: 'gh-token',
        issueState: state,
        issueBudget: budget,
      },
    );
    expect(bare.scope.tryGet('issue')).toBeUndefined();
    expect(bare.scope.tryGet('issue-webhook-mount')).toBeUndefined();
    expect(bare.boot.counts).toEqual({ total: 16, enabled: 16, failed: 0 }); // 早退仍计 activated（counts 口径）

    // 形 B：全环（config + token + session seam + scheduler 件〔sqlite〕+ jobs〔bootCore 内建〕）
    const full = await bootCore(
      dataDir,
      memoryFs({ [join(dataDir, 'enabled.yaml')]: issueYaml }),
      {},
      {
        sqlite: () => persistence.store.sqlite(),
        issueGithubToken: 'gh-token',
        issueState: state,
        issueBudget: budget,
        issueSession: session,
      },
    );
    expect(full.scope.tryGet('issue')).toBeDefined(); // 服务面（含 enqueue 公开位——19e）
    expect(full.scope.tryGet('issue-webhook-mount')).toBeDefined(); // webhook 挂点 kit（daemon 消费位）
  });

  it('issue 件危险闸人面（04 §13）：dataDir 在场 → /danger 注册 + approve/status 两动词真跑（consent 落 dataDir）+ 未知动词指路', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-danger-'));
    dirs.push(dataDir);
    const persistence = Persistence.open({
      dbPath: MEMORY_DB_PATH,
      migrations: [SCHEDULER_MIGRATION, ...MEMORY_MIGRATIONS],
    });
    const session: IssueSessionFace = {
      startHeadless: async () => ({
        sessionId: 's-danger-1',
        outcome: Promise.resolve({ status: 'completed', messagesUsed: 1, summary: 'ok' }),
      }),
    };
    const state: IssueStoreStateFace = {
      getStoreState: () => undefined,
      setStoreState: () => undefined,
      deleteStoreState: () => false,
    };
    const budget: IssueBudgetFace = { canAffordIssue: () => ({ ok: true }) };
    const notifyLog: { source: string; message: string }[] = [];
    const issueYaml =
      'plugins:\n  - id: core:issue\n    config:\n      repos:\n        - owner/repo\n      mode: auto\n      maxDeliveriesPerDay: 3\n';
    const booted = await bootCore(
      dataDir,
      memoryFs({ [join(dataDir, 'enabled.yaml')]: issueYaml }),
      {},
      {
        sqlite: () => persistence.store.sqlite(),
        issueGithubToken: 'gh-token',
        issueState: state,
        issueBudget: budget,
        issueSession: session,
        notify: (source, message) => notifyLog.push({ source, message }),
      },
    );
    // /danger 注册在场（危险闸人面——dataDir 在场即组机制件）
    expect(booted.commands).toContain('danger');
    const dangerCmd = booted.commandSpecs.find((c) => c.name === 'danger');
    expect(dangerCmd).toBeDefined();

    // approve 7：consent 签发——notify 投递 + 文件落 dataDir（consumer 'core:issue'）
    await dangerCmd!.handler({ raw: '/danger approve 7', argv: ['approve', '7'] });
    expect(notifyLog.at(-1)!.source).toBe('issue');
    expect(notifyLog.at(-1)!.message).toContain('已签发');
    const consentFile = JSON.parse(readFileSync(join(dataDir, 'danger-consent.json'), 'utf8')) as {
      consumers: Record<string, { mandateHash: string; expiresAt: number }>;
    };
    expect(Object.keys(consentFile.consumers)).toEqual(['core:issue']);
    expect(consentFile.consumers['core:issue']!.mandateHash).toMatch(/^[0-9a-f]{64}$/);

    // status：五呈文案（mandate 值域 + consent 有效 + 账本健康）
    await dangerCmd!.handler({ raw: '/danger status', argv: ['status'] });
    const statusText = notifyLog.at(-1)!.message;
    expect(statusText).toContain('危险闸状态');
    expect(statusText).toContain('owner/repo');
    expect(statusText).toContain('有效');
    expect(statusText).toContain('账本：0 笔');

    // 坏 ttlDays 与未知动词：指路文案不炸
    await dangerCmd!.handler({ raw: '/danger approve 0', argv: ['approve', '0'] });
    expect(notifyLog.at(-1)!.message).toContain('1..3650');
    await dangerCmd!.handler({ raw: '/danger nuke', argv: ['nuke'] });
    expect(notifyLog.at(-1)!.message).toContain('未知动词');

    // dispose 收口：件卸载后命令摘除（disposer 进 apply 返回值——bootCore 桩不验，此处结构已证）
  });

  it('注册表单源形：件名清单（逐纵切笔入册——批 19a—19e 十五件 + c-3 credentials 增席：exec/web/skills/memory/subagent/scheduler/mcp/browser/lsp/goal/checkpoint/sdk/webui/obs/issue/credentials 十六件齐册）', () => {
    expect(createCorePlugins({ dataDir: null }).map((ref) => ref.name)).toEqual([
      'exec',
      'web',
      'skills',
      'memory',
      'subagent',
      'scheduler',
      'mcp',
      'browser',
      'lsp',
      'goal',
      'checkpoint',
      'sdk',
      'webui',
      'obs',
      'issue',
      'credentials',
    ]);
  });
});
