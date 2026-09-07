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
import { SessionLog } from '../session/index.js';

import { createCorePlugins } from './core-plugins.js';
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

/** 真装载速记（createCorePlugins 工厂单源注入——缺省路径的等价形；boot 柄暴露供消费腿断言。cwd/homeDir 注入隔离面——skills 跨库层不扫真实 HOME） */
async function bootCore(
  dataDir: string | null,
  fs: PluginBootFs = memoryFs(),
  anchors: { cwd?: string; homeDir?: string } = {},
): Promise<{
  scope: Scope;
  dispatch: EventDispatch;
  warnings: string[];
  boot: Awaited<ReturnType<typeof bootPlugins>>;
}> {
  const warnings: string[] = [];
  const scope = Scope.createRoot();
  const dispatch = new EventDispatch();
  const boot = await bootPlugins({
    runtime: stubRuntime(dataDir),
    scope,
    dispatch,
    commands: { register: () => () => undefined },
    llm: { registerProvider: () => () => undefined },
    corePlugins: createCorePlugins({
      dataDir,
      ...(anchors.cwd !== undefined ? { cwd: anchors.cwd } : {}),
      ...(anchors.homeDir !== undefined ? { homeDir: anchors.homeDir } : {}),
    }),
    version: '9.9.9-test',
    warn: (message) => warnings.push(message),
    fs,
  });
  return { scope, dispatch, warnings, boot };
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

  it('注册表单源形：件名清单（逐纵切笔入册——本批 exec/web/skills 三件）', () => {
    expect(createCorePlugins({ dataDir: null }).map((ref) => ref.name)).toEqual(['exec', 'web', 'skills']);
  });
});
