/**
 * host/core-plugins 注册表单源测试（批 19a）——exec 件装载全环：
 * CORE_PLUGINS 经真 bootPlugins 装载（真 Kahn/真装载管线/零 jiti——core 行
 * 对象直调）→ scope 共享根服务面 → openTools 会话装配消费（会话装配期工厂
 * 求值——批 19a 契约形）→ bash 工具真执行（真 spawn echo，组合根全栈惯例）；
 * enabled.yaml core:exec disabled 行 = bash 静默缺席（诚实缺席律回归锁）。
 *
 * 纪律：mock 只停在装载 fs 注入位（内存 Map——读侧零真盘）；装载管线/
 * spawn 管道/bash 工具/守门/审批全走真实现。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { EventDispatch, Scope } from '../context/index.js';
import { SessionLog } from '../session/index.js';

import { CORE_PLUGINS } from './core-plugins.js';
import { bootPlugins } from './plugin-boot.js';
import type { PluginBootFs } from './plugin-boot.js';
import type { HostRuntime } from './runtime.js';
import { assembleOpenTools } from '../conversation/open-tools.js';
import type { ExecToolService } from '../conversation/index.js';

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

/** 真装载速记（CORE_PLUGINS 单源注入——缺省路径的等价形） */
async function bootCore(
  dataDir: string,
  fs: PluginBootFs = memoryFs(),
): Promise<{ scope: Scope; dispatch: EventDispatch; warnings: string[] }> {
  const warnings: string[] = [];
  const scope = Scope.createRoot();
  const dispatch = new EventDispatch();
  await bootPlugins({
    runtime: stubRuntime(dataDir),
    scope,
    dispatch,
    commands: { register: () => () => undefined },
    llm: { registerProvider: () => () => undefined },
    corePlugins: CORE_PLUGINS,
    version: '9.9.9-test',
    warn: (message) => warnings.push(message),
    fs,
  });
  return { scope, dispatch, warnings };
}

/** 恒答审批呈现面（write 类工具守门放行桩——审批装配测试同款，应答 = 'approve' 字面） */
const approveAll = async () => 'approve' as const;

describe('CORE_PLUGINS 注册表单源（批 19a）', () => {
  it('exec 件装载全环：真装载 → 共享根服务面 → 工厂产出 bash → openTools 拾取 → 真执行', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-coreplug-'));
    dirs.push(dataDir);
    const { scope, dispatch } = await bootCore(dataDir); // enabled.yaml 缺席 = 全 core 内置态

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
    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-ws-'));
    dirs.push(workspace);
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
    const { scope, dispatch } = await bootCore(
      dataDir,
      memoryFs({ [join(dataDir, 'enabled.yaml')]: 'plugins:\n  - id: core:exec\n    disabled: true\n' }),
    );
    expect(scope.tryGet('exec')).toBeUndefined(); // 服务面缺席

    const workspace = mkdtempSync(join(tmpdir(), 'berry-coreplug-off-ws-'));
    dirs.push(workspace);
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

  it('注册表单源形：件名清单（逐纵切笔入册——本批 exec 一件）', () => {
    expect(CORE_PLUGINS.map((ref) => ref.name)).toEqual(['exec']);
  });
});
