/**
 * host/plugin-server-form 组合根测试——MCP-server 形插件装载位 + confine
 * grants 交集维 + plugin/server-loaded 审计词（05 §1.1 ⑤C 发射位兑现，
 * 2026-10-18 沙箱立题批次 3·R2——03 §10.1 R2 条款）。
 *
 * 覆盖面（任务清单逐项）：
 *  - 审计词恰一笔：server 形磁盘行装载成功尾逐行恰一笔（非 diff 幂等——
 *    provenance 行为流，每次装载 = 一次事实）+ confine? v1 恒缺席（写点
 *    时点早于异步 confine 执行——时序差定谳）；失败路径零落账（清单坏形
 *    拒载在合成序即拒）；试件行零落盘（--plugin-file 不变式 1）；
 *  - confine grants 数据源锁：spawn 面策略 writableRoots = 本插件 ①段一
 *    grants 装载账交集（与 plugin/grants 账面同值同源——两用非同一物）；
 *    交集空 = 空数组显式覆盖（写面全关仍只读供工具）；
 *  - grantsFence 缺席 = server 位 spawn 面不铸（受理走桥装配缺省档位维
 *    面——grants 腿整体静默律同族；生产装配恒传 fence）；
 *  - server 位 = manifest 声明 id（试件行 row id 含 '_' 不合服务器键词法，
 *    恒用 manifest.id 入桥）。
 *
 * 组合根全栈惯例（plugin-grants.test.ts 同 harness）：真装载管线 +
 * HostRuntime 结构化替身 + fs 注入内存 Map；审计面真库真面（audit_events
 * 读写往返——词汇闸随真面执法）；core:mcp 桥/exec 管道/沙箱服务以真形窄面
 * 替身预注入共享根作用域（装配根 serverSpawnFace 消费的就是这三席）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { EventDispatch, Scope } from '../context/index.js';
import { AUDIT_MIGRATION, createAuditFace, openStore } from '../persist/index.js';
import type { AuditFace, Store } from '../persist/index.js';
import type { SandboxPolicy, SandboxService } from '../safety/index.js';
import type { SpawnPipeline } from '../../plugins/exec/index.js';
import type { McpServerConfig, McpSpawnFace } from '../../plugins/mcp/index.js';

import { bootPlugins, QUICK_TEST_ROW_ID } from './plugin-boot.js';
import type { PluginBootFs, PluginBootOptions } from './plugin-boot.js';
import type { HostRuntime } from './runtime.js';

/** 临时目录族（统一清） */
const dirs: string[] = [];
const stores: Store[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  for (const s of stores) s.close();
});

/** 内存 fs（Map 背书——读侧三源全注入） */
function memoryFs(files: Record<string, string> = {}): PluginBootFs {
  const map = new Map(Object.entries(files));
  return { read: (path) => map.get(path) ?? null, write: (path, text) => void map.set(path, text) };
}

/** HostRuntime 结构化替身（装配序消费面 = dataDir + registerCloser + memory 位） */
function stubRuntime(dataDir: string | null): HostRuntime {
  return {
    memory: dataDir === null,
    dataDir,
    persistence: {} as HostRuntime['persistence'], // 装配序不消费——占位
    abortSignal: new AbortController().signal,
    disclosure: () => null,
    registerCloser: () => undefined,
    registerShutdownHook: () => undefined,
    registerDisposer: () => undefined,
    shutdown: async () => undefined,
    writeCrashLog: () => undefined,
  };
}

/** 装配选项速记——grantsFence 可显式置 undefined（缺席定谳锁用） */
function rigBoot(overrides: Partial<PluginBootOptions> & { fs?: PluginBootFs } = {}): PluginBootOptions {
  const options: PluginBootOptions = {
    runtime: overrides.runtime ?? stubRuntime('/h/data'),
    scope: Scope.createRoot(),
    dispatch: new EventDispatch(),
    commands: { register: () => () => undefined },
    llm: { registerProvider: () => () => undefined },
    version: '9.9.9-test',
    warn: () => undefined,
    grantsFence: { workspace: '/data/wk', mode: 'workspace-write' },
    ...overrides,
  };
  return options;
}

/** 真库真审计面（audit_events 读写往返——词汇闸随真面执法） */
function openFace(): AuditFace {
  const dir = mkdtempSync(join(tmpdir(), 'berry-agent-server-form-'));
  dirs.push(dir);
  const store = openStore({ dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
  stores.push(store);
  return createAuditFace(store.connection);
}

/** 审计流中 plugin/server-loaded 笔（本词专属滤面） */
const serverLoadedPens = (face: AuditFace) =>
  face
    .listRecent()
    .filter((r) => r.type === 'plugin/server-loaded')
    .map((r) => r.data);

/**
 * core:mcp 桥受理替身（真形窄面——attachServer 三参全录）。真桥的
 * spawn/发现/注册管道行为归 plugins/mcp/service.test.ts；本面只锁装配根
 * 铸给桥的入参（server 名/配置/spawn 面）。
 */
function makeAttachFace(): {
  face: { attachServer(server: string, config: McpServerConfig, spawn?: McpSpawnFace): void };
  attached: Array<{ server: string; config: McpServerConfig; spawn: McpSpawnFace | undefined }>;
} {
  const attached: Array<{ server: string; config: McpServerConfig; spawn: McpSpawnFace | undefined }> = [];
  return {
    attached,
    face: {
      attachServer(server: string, config: McpServerConfig, spawn?: McpSpawnFace) {
        attached.push({ server, config, spawn });
      },
    },
  };
}

/** exec 管道 + 沙箱服务替身（confine 策略/spawn argv 全录——数据源锁判据源） */
function makeSpawnStack(): {
  pipeline: SpawnPipeline;
  sandbox: SandboxService;
  policies: SandboxPolicy[];
  spawned: Array<{ argv: readonly string[]; owner?: string }>;
} {
  const policies: SandboxPolicy[] = [];
  const spawned: Array<{ argv: readonly string[]; owner?: string }> = [];
  const sandbox: SandboxService = {
    confine: (argv, policy) => {
      policies.push(policy);
      return { argv: ['sandbox-runner', ...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] };
    },
    registerBackend: () => () => undefined,
    listBackends: () => [],
  };
  const pipeline = {
    spawnInteractive: (request: { argv: readonly string[]; owner?: string }) => {
      spawned.push({ argv: request.argv, owner: request.owner });
      return {} as ReturnType<SpawnPipeline['spawnInteractive']>;
    },
  } as unknown as SpawnPipeline;
  return { pipeline, sandbox, policies, spawned };
}

/** 装机态 server 形行装填速记（enabled.yaml + 账本 + server 声明块清单） */
function installServerRow(
  fsMap: Record<string, string>,
  id: string,
  opts: { grants?: readonly string[]; command?: string } = {},
  dataDir = '/h/data',
): void {
  fsMap[`${dataDir}/enabled.yaml`] = (fsMap[`${dataDir}/enabled.yaml`] ?? 'plugins:\n') + `  - id: ${id}\n`;
  const ledgerText = fsMap[`${dataDir}/plugins/ledger.json`];
  const ledger: Record<string, unknown> = ledgerText === undefined ? {} : JSON.parse(ledgerText);
  ledger[id] = { installPath: `plugins/node_modules/${id}` };
  fsMap[`${dataDir}/plugins/ledger.json`] = JSON.stringify(ledger);
  const berryAgent: Record<string, unknown> = {
    server: { command: opts.command ?? '/usr/local/bin/mcp-srv', args: ['--tools'] },
  };
  if (opts.grants !== undefined) berryAgent['grants'] = { writableRoots: [...opts.grants] };
  fsMap[`${dataDir}/plugins/node_modules/${id}/package.json`] = JSON.stringify({
    name: id,
    version: '1.0.0',
    berryAgent,
  });
}

describe('plugin/server-loaded 恰一笔（05 §1.1 ⑤C——装载成功尾，非 diff 幂等）', () => {
  it('装载成功尾恰一笔：{pluginId, command}，confine? 恒缺席（v1 定谳——写点时点早于异步 confine 执行）', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installServerRow(fsMap, 'srv-acme', { grants: ['./cache'] });
    const { face: attach } = makeAttachFace();
    const options = rigBoot({ fs: memoryFs(fsMap), audit: face });
    options.scope.provide('mcp', attach);
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['srv-acme']);
    expect(serverLoadedPens(face)).toEqual([{ pluginId: 'srv-acme', command: '/usr/local/bin/mcp-srv' }]);
  });

  it('非 diff 幂等：同面再 boot（/reload 形）逐次落笔——每次装载 = 一次事实（plugin/grants fold 语义对照分立）', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installServerRow(fsMap, 'srv-acme');
    const { face: attach } = makeAttachFace();
    const options = rigBoot({ fs: memoryFs(fsMap), audit: face });
    options.scope.provide('mcp', attach);
    await bootPlugins(options);
    await bootPlugins(rigBoot({ fs: memoryFs(fsMap), audit: face, scope: options.scope }));
    expect(serverLoadedPens(face)).toHaveLength(2);
  });

  it('失败零落账：清单坏形（server 与 entry 同给）合成序即拒——拒路径零审计', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installServerRow(fsMap, 'srv-acme');
    // server 与 entry 同给 = 清单坏形（单形状禁双载体）——坏形拒载在合成序
    const pkgPath = '/h/data/plugins/node_modules/srv-acme/package.json';
    const pkg = JSON.parse(fsMap[pkgPath]!);
    pkg.berryAgent.entry = './x.ts';
    fsMap[pkgPath] = JSON.stringify(pkg);
    const { face: attach } = makeAttachFace();
    const options = rigBoot({ fs: memoryFs(fsMap), audit: face });
    options.scope.provide('mcp', attach);
    const boot = await bootPlugins(options);
    expect(boot.report.activated).toEqual([]);
    expect(boot.report.failed.map((f) => f.id)).toEqual(['srv-acme']);
    expect(serverLoadedPens(face)).toEqual([]);
  });

  it('试件行零落盘：--plugin-file server 形装载成功也不进 durable 审计（不变式 1——opens/lifecycle/grants 同律）', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    fsMap['/data/wk/plugins/qsrv/package.json'] = JSON.stringify({
      name: 'dev-srv',
      version: '1.0.0',
      berryAgent: { server: { command: '/usr/local/bin/dev-srv' } },
    });
    const { face: attach, attached } = makeAttachFace();
    const options = rigBoot({ fs: memoryFs(fsMap), audit: face, pluginFile: '/data/wk/plugins/qsrv' });
    options.scope.provide('mcp', attach);
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual([QUICK_TEST_ROW_ID]);
    // server 位 = manifest 声明 id（试件 row id 含 '_' 不合服务器键词法——恒用声明 id 入桥）
    expect(attached).toHaveLength(1);
    expect(attached[0]!.server).toBe('dev-srv');
    expect(serverLoadedPens(face)).toEqual([]);
  });
});

describe('R2 confine grants 交集维（03 §10.1 R2——写根白名单数据源 = ①段一装载账交集）', () => {
  it('spawn 面策略 = fence 档位 + workspaceRoot + writableRoots 交集（与 plugin/grants 账面同值同源）', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installServerRow(fsMap, 'srv-acme', { grants: ['./cache'] });
    const { face: attach, attached } = makeAttachFace();
    const stack = makeSpawnStack();
    const options = rigBoot({ fs: memoryFs(fsMap), audit: face });
    options.scope.provide('mcp', attach);
    options.scope.provide('exec-pipeline', stack.pipeline);
    options.scope.provide('exec-sandbox', stack.sandbox);
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['srv-acme']);
    // 受理入参三件：server 位 = manifest id、配置 = 归一声明块、spawn 面在场
    expect(attached).toHaveLength(1);
    expect(attached[0]!.server).toBe('srv-acme');
    expect(attached[0]!.config).toEqual({ command: '/usr/local/bin/mcp-srv', args: ['--tools'] });
    expect(attached[0]!.spawn).toBeDefined();
    // 装载账（在程视图）与 spawn 面策略同源：roots 同值（两用非同一物）
    expect(boot.grantsOf('srv-acme')).toEqual({
      pluginId: 'srv-acme',
      anchor: 'workspace',
      roots: ['/data/wk/cache'],
    });
    attached[0]!.spawn!.spawnInteractive({ argv: ['/usr/local/bin/mcp-srv', '--tools'], owner: 'mcp:srv-acme' });
    expect(stack.policies).toHaveLength(1);
    expect(stack.policies[0]).toEqual({
      mode: 'workspace-write',
      workspaceRoot: '/data/wk',
      writableRoots: ['/data/wk/cache'],
    });
    // confine 产物 argv 喂管道真身（受限 argv 消费方自行 spawn）
    expect(stack.spawned).toHaveLength(1);
    expect(stack.spawned[0]!.argv).toEqual(['sandbox-runner', '/usr/local/bin/mcp-srv', '--tools']);
  });

  it('交集空 = 空数组显式覆盖（无 grants 声明 = 白名单空——写面全关仍只读供工具；grants 坏形行合成序拒载零受理）', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installServerRow(fsMap, 'srv-bare'); // 无 grants 声明——交集恒空
    installServerRow(fsMap, 'srv-evil', { grants: ['../escape'] }); // ../ 段 = 深校验四拒——合成序行级隔离
    const { face: attach, attached } = makeAttachFace();
    const stack = makeSpawnStack();
    const options = rigBoot({ fs: memoryFs(fsMap), audit: face });
    options.scope.provide('mcp', attach);
    options.scope.provide('exec-pipeline', stack.pipeline);
    options.scope.provide('exec-sandbox', stack.sandbox);
    const boot = await bootPlugins(options);
    // 坏形行拒载不受理（拒载行级隔离）；获载行 spawn 策略 writableRoots =
    // 空数组显式覆盖（非 undefined 回落档位推导）
    expect(boot.report.activated.map((a) => a.id)).toEqual(['srv-bare']);
    expect(boot.report.failed.map((f) => f.id)).toEqual(['srv-evil']);
    expect(attached.map((a) => a.server)).toEqual(['srv-bare']);
    attached[0]!.spawn!.spawnInteractive({ argv: ['/usr/local/bin/mcp-srv'], owner: 'mcp:srv-bare' });
    expect(stack.policies.map((p) => p.writableRoots)).toEqual([[]]);
    expect(serverLoadedPens(face)).toEqual([{ pluginId: 'srv-bare', command: '/usr/local/bin/mcp-srv' }]);
  });

  it('grantsFence 缺席 = server 位 spawn 面不铸（受理走桥装配缺省档位维——grants 腿整体静默律同族）', async () => {
    const fsMap: Record<string, string> = {};
    installServerRow(fsMap, 'srv-acme', { grants: ['./cache'] });
    const { face: attach, attached } = makeAttachFace();
    const stack = makeSpawnStack();
    const options = rigBoot({ fs: memoryFs(fsMap), grantsFence: undefined });
    options.scope.provide('mcp', attach);
    options.scope.provide('exec-pipeline', stack.pipeline);
    options.scope.provide('exec-sandbox', stack.sandbox);
    const boot = await bootPlugins(options);
    // 装载照成（缺 fence 不阻装载——桥走装配缺省 spawn 面）；spawn 入参 undefined
    expect(boot.report.activated.map((a) => a.id)).toEqual(['srv-acme']);
    expect(attached).toHaveLength(1);
    expect(attached[0]!.spawn).toBeUndefined();
    expect(stack.policies).toEqual([]); // 本面零 confine 消费
    // grants 账面同静默（段一定谳对照——缺席 = 不记账不供值器）
    expect(boot.grantsOf('srv-acme')).toBeUndefined();
  });

  it('spawn 管道/沙箱席缺席 = spawnInteractive 即抛 SANDBOX_UNAVAILABLE（fail-closed 不静默裸起）', async () => {
    const fsMap: Record<string, string> = {};
    installServerRow(fsMap, 'srv-acme');
    const { face: attach, attached } = makeAttachFace();
    const options = rigBoot({ fs: memoryFs(fsMap) });
    options.scope.provide('mcp', attach); // 无 exec-pipeline/exec-sandbox 注入
    await bootPlugins(options);
    expect(attached[0]!.spawn).toBeDefined();
    expect(() =>
      attached[0]!.spawn!.spawnInteractive({ argv: ['/usr/local/bin/mcp-srv'], owner: 'mcp:srv-acme' }),
    ).toThrowError(/SANDBOX_UNAVAILABLE|沙箱/);
  });
});
