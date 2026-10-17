/**
 * R1 落码回归锁（沙箱立题批次 3——03 §10.1:915-918 / §10.2:935）：MCP/LSP
 * 两桥 server spawn argv 过 src/safety/sandbox confine（exec bash 工具链
 * 之后的第二消费位）。
 *
 * confine 位定谳 = 组合根包一层（core-plugins.ts confinedSpawnFace——三式
 * 择一理由见该 helper 头注）。本文件四组锁：
 * ①confine 注桩锁（两桥各一组——argv/policy 断言 + ConfinedArgv.argv 才是
 *   子进程 argv + 观测面语义不变）；
 * ③fail-closed 锁（exec-sandbox 缺席 = spawn 零调用 + 归并连接失败族——
 *   禁静默裸 spawn，与 gate-exec.ts:134 沙箱缺席同律）；
 * ④confine 拒归并 + LSP 熔断计数承接锁（confine 拒 = 进程事故，下用再试
 *   并计熔断一败——3 连败熔断开既有律承接）。
 *
 * 装配面 = 真 loadPlugins + 真 createPluginContext（core-plugins-mcp-window
 * 同款 harness），假 pipeline/假沙箱注入根 scope（exec 行不入册——单桥行
 * 装载隔离形）。browser 桥（03 §10.3）零条款不动——本文件不涉。
 */
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EventDispatch, Scope, canonicalWorkspaceRoot } from '../context/index.js';
import { BaseError } from '../contracts/index.js';
import { CommandRegistry, createChannels } from '../channels/index.js';
import { createToolRegistry } from '../tools/index.js';
import type { SandboxMode, SandboxPolicy } from '../safety/index.js';
import { FrameDecoder, encodeFrame } from '../../plugins/lsp/index.js';
import type { LspChildFace, LspService } from '../../plugins/lsp/index.js';
import type { McpChildFace, McpServerConfig, McpService } from '../../plugins/mcp/index.js';
import { createCorePlugins } from './core-plugins.js';
import { createPluginContext, PLUGIN_HOOK_VOCABULARY } from './plugin-context.js';
import type { PluginContextHandle } from './plugin-context.js';
import { createPluginToolLedger } from './plugin-boot.js';
import { loadPlugins } from './loader.js';
import type { CorePluginReference, LoaderPlanRow } from './loader.js';
import { PromptSectionRegistry } from './prompt-sections.js';
import { TriggerRegistry } from './triggers.js';
import { createJobRegistry, createSubagentService } from '../../plugins/subagent/index.js';
// 错误码册注册腿（「import 发生才注册」——LSP_CIRCUIT_OPEN 等码文本断言前置副作用）
import './codes.js';

/* ---------------- 假件（pipeline / 沙箱 / 两桥脚本化子进程） ---------------- */

/** confine 记账行（argv 副本 + 收到的 policy——注桩锁断言面） */
interface ConfineCall {
  readonly argv: readonly string[];
  readonly policy: SandboxPolicy;
}

/** spawnInteractive 记账行（pipeline 实收——ConfinedArgv.argv 才应到达此面） */
interface SpawnRecord {
  readonly argv: readonly string[];
  readonly owner: string;
}

/** 沙箱供给形（三档：透传记账 / 缺席 / 记账后抛——后端链空 fail-closed 形） */
type SandboxMode4Test = 'passthrough' | 'absent' | 'throwing';

/** MCP 脚本化子进程（newline JSON 帧——initialize/tools/list 应答，握手零竞速） */
class ScriptedMcpChild implements McpChildFace {
  readonly written: string[] = [];
  private readonly dataCallbacks: ((chunk: Buffer) => void)[] = [];
  private readonly exitCallbacks: ((info: { code: number | null; spawnError?: Error }) => void)[] = [];

  readonly stdin = {
    write: (data: string) => {
      this.written.push(data);
      for (const piece of data.split('\n')) {
        if (piece.trim() === '') continue;
        const msg = JSON.parse(piece) as { id?: number; method?: string };
        // 应答恒走宏任务边界（真实子进程跨进程 IO 时序）
        if (msg.method === 'initialize' && msg.id !== undefined) {
          setTimeout(() => this.emit(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} })), 0);
        } else if (msg.method === 'tools/list' && msg.id !== undefined) {
          const tools = [{ name: 'boom', inputSchema: { type: 'object' } }];
          setTimeout(() => this.emit(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools } })), 0);
        }
      }
    },
    end: () => {
      setTimeout(() => this.exitCallbacks.forEach((cb) => cb({ code: 0 })), 5);
    },
  };
  readonly stdout = {
    on: (_e: 'data', cb: (chunk: Buffer) => void) => {
      this.dataCallbacks.push(cb);
    },
    destroy: () => undefined,
  };
  readonly stderr = { on: () => undefined };
  emit(line: string): void {
    for (const cb of [...this.dataCallbacks]) cb(Buffer.from(`${line}\n`));
  }
  onExit(cb: (info: { code: number | null; spawnError?: Error }) => void): void {
    this.exitCallbacks.push(cb);
  }
  kill(): void {
    // 最小形——本测试不触树杀路径
  }
}

/** LSP 脚本化子进程（Content-Length 帧——真 FrameDecoder 编解码） */
class ScriptedLspChild implements LspChildFace {
  private readonly decoder = new FrameDecoder();
  private dataCb: ((chunk: Buffer) => void) | undefined;
  private exitCb: ((info: { code: number | null; spawnError?: Error }) => void) | undefined;

  readonly stdin = {
    write: (data: Buffer): void => {
      const { frames } = this.decoder.feed(data);
      for (const f of frames) {
        const msg = JSON.parse(f) as { id?: number; method?: string; params?: unknown };
        if (msg.method === 'initialize' && msg.id !== undefined) {
          this.serverSend({ jsonrpc: '2.0', id: msg.id, result: { capabilities: {} } });
        } else if (msg.method === 'textDocument/didOpen') {
          // 首触 didOpen 即回空诊断帧（version 对齐——waitDiagnostics 零等待解锁）
          const p = (msg.params ?? {}) as { textDocument?: { uri?: unknown; version?: unknown } };
          this.serverSend({
            method: 'textDocument/publishDiagnostics',
            params: { uri: p.textDocument?.uri, version: p.textDocument?.version, diagnostics: [] },
          });
        } else if (msg.method === 'shutdown' && msg.id !== undefined) {
          this.serverSend({ jsonrpc: '2.0', id: msg.id, result: null });
        } else if (msg.method === 'exit') {
          this.exitCb?.({ code: 0 });
        }
      }
    },
    end: (): void => {},
  };
  readonly stdout = {
    on: (_e: 'data', cb: (chunk: Buffer) => void): void => {
      this.dataCb = cb;
    },
    destroy: (): void => {},
  };
  readonly stderr = { on: (): void => {} };
  onExit(cb: (info: { code: number | null; spawnError?: Error }) => void): void {
    this.exitCb = cb;
  }
  kill(): void {}
  serverSend(obj: unknown): void {
    this.dataCb?.(encodeFrame(JSON.stringify(obj)));
  }
}

/** 宿主自省面测试替身（materializeHostFace 形——纯数据即可） */
const HOST_FACE = {
  version: '0.1.0-alpha.1',
  apiVersion: '1.0',
  capabilities: { has: () => false, list: () => [] as string[] },
  experimental: { enabled: () => false },
} as const;

/** 桥行选择（mcp / lsp / both——both 形两行同册共享根） */
type RowPick = 'mcp' | 'lsp' | 'both';

/** rig 装配产物（断言面全集中） */
interface Rig {
  readonly tmpCwd: string;
  readonly confineCalls: ConfineCall[];
  readonly spawnRecords: SpawnRecord[];
  readonly notifications: Array<{ source: string; message: string }>;
  mcpService(): McpService | undefined;
  lspService(): LspService | undefined;
  until(predicate: () => boolean, ms?: number): Promise<void>;
}

/**
 * 真装载链装配：loadPlugins + createCorePlugins（桥行按需挑册）+ 真
 * createPluginContext（真窗闸/真工具注册面）+ 假 pipeline/假沙箱注入根 scope
 * （exec 行不入册——confine 位在组合根包装面，装配形与生产 exec 件同构）。
 * 沙箱三档：passthrough = 记账后回 runner 前缀形；absent = 不供给（fail-closed
 * 面）；throwing = 记账后抛 SANDBOX_UNAVAILABLE（后端链空形）。
 */
async function bootBridgeRow(pick: RowPick, sandbox: SandboxMode4Test, bootSandboxMode?: SandboxMode): Promise<Rig> {
  const tmpCwd = await mkdtemp(join(tmpdir(), 'berry-bridge-confine-'));
  // LSP 诊断腿读盘真相——样本文件落 tmp 工作区（didOpen 全文同步面）
  await writeFile(join(tmpCwd, 'sample.ts'), 'const x = 1;\n', 'utf8');

  const handles = new Map<string, PluginContextHandle>();
  const warns: string[] = [];
  const confineCalls: ConfineCall[] = [];
  const spawnRecords: SpawnRecord[] = [];
  const notifications: Array<{ source: string; message: string }> = [];
  const dispatch = new EventDispatch();
  dispatch.registerEventNames(PLUGIN_HOOK_VOCABULARY.map((h) => h.name));
  const tools = createToolRegistry(dispatch);
  const toolLedger = createPluginToolLedger();
  const promptSections = new PromptSectionRegistry();
  const triggers = new TriggerRegistry({
    getOpens: () => new Set(['triggers.start-run']),
    makeStarter: () => () => undefined,
  });
  const subagents = createSubagentService({ registry: createJobRegistry() });
  const channels = createChannels();
  const scope = Scope.createRoot();

  // 假 pipeline：按 owner 前缀分派两桥脚本化子进程（argv/owner 全记账）
  const fakePipeline = {
    spawnInteractive: (request: { argv: readonly string[]; owner: string }) => {
      spawnRecords.push({ argv: [...request.argv], owner: request.owner });
      if (request.owner.startsWith('lsp:')) return new ScriptedLspChild();
      return new ScriptedMcpChild();
    },
  };
  scope.provide('exec-pipeline', fakePipeline);
  if (sandbox === 'passthrough') {
    // 透传记账形：runner 前缀 ['/usr/bin/fake-runner', ...]——ConfinedArgv.argv
    // 直达 pipeline 的可见锚
    scope.provide('exec-sandbox', {
      confine: (argv: readonly string[], policy: SandboxPolicy) => {
        confineCalls.push({ argv: [...argv], policy });
        return {
          argv: ['/usr/bin/fake-runner', ...argv],
          enforcement: 'full' as const,
          denialSignatures: [],
          runnerFailureRules: [],
        };
      },
      registerBackend: () => () => undefined,
      listBackends: () => [],
    });
  } else if (sandbox === 'throwing') {
    // 后端链空形（sandbox.ts confine 空链真源行为同形——记账后抛）
    scope.provide('exec-sandbox', {
      confine: (argv: readonly string[], policy: SandboxPolicy) => {
        confineCalls.push({ argv: [...argv], policy });
        throw new BaseError(
          'SANDBOX_UNAVAILABLE',
          `无可用沙箱后端，拒绝裸跑（后端链为空；${policy.mode} 模式一律经沙箱——可安装沙箱后端）`,
        );
      },
      registerBackend: () => () => undefined,
      listBackends: () => [],
    });
  }
  // sandbox === 'absent'：不供给——fail-closed 断言面

  const refs = createCorePlugins({
    dataDir: null,
    cwd: tmpCwd,
    notify: (source, message) => notifications.push({ source, message }),
    ...(bootSandboxMode !== undefined ? { bootSandboxMode } : {}),
  });
  const serverConfig: McpServerConfig = { command: '/usr/local/bin/fake-mcp-server', args: ['--stdio'] };
  const plan: LoaderPlanRow[] = [];
  if (pick === 'mcp' || pick === 'both') {
    plan.push({
      kind: 'core',
      id: 'core:mcp',
      reference: refs.find((r) => r.name === 'mcp') as CorePluginReference,
      config: { servers: { demo: serverConfig } },
    });
  }
  if (pick === 'lsp' || pick === 'both') {
    plan.push({
      kind: 'core',
      id: 'core:lsp',
      reference: refs.find((r) => r.name === 'lsp') as CorePluginReference,
      config: { servers: { demo: { command: '/bin/fake-lsp-server', languages: ['ts'] } } },
    });
  }
  const services = (() => {
    const bag = new Map<string, unknown>();
    return {
      get: (name: string) => bag.get(name),
      provide: (name: string, value: unknown) => {
        bag.set(name, value);
      },
    };
  })();
  // 共享根与插件 fork 分立：fork 才是 ctx 消费的服务面（假件已入根）
  const fork = scope.fork();

  await loadPlugins({
    plan,
    services,
    createContext: (pluginId) => {
      const handle = createPluginContext({
        pluginId,
        scope: fork,
        dispatch,
        tools,
        toolLedger,
        provide: services.provide,
        commands: new CommandRegistry(),
        uiBackends: channels,
        llm: { registerProvider: () => () => undefined },
        promptSections,
        triggers,
        subagents,
        hostFace: HOST_FACE,
      });
      handles.set(pluginId, handle);
      return handle.ctx;
    },
    onApplySettled: (pluginId) => handles.get(pluginId)?.closeWindow(),
    warn: (message) => warns.push(message),
    // 官方件宿主面通道（MCP 异步发现续段注册位——bootPlugins 同款闭包）
    coreHostChannel: (pluginId: string) => {
      const handle = handles.get(pluginId);
      return handle === undefined ? undefined : { openHostCallback: () => handle.enterHostCallback() };
    },
  });

  return {
    tmpCwd,
    confineCalls,
    spawnRecords,
    notifications,
    mcpService: () => services.get('mcp') as McpService | undefined,
    lspService: () => services.get('lsp') as LspService | undefined,
    until: async (predicate, ms = 2_000) => {
      const deadline = Date.now() + ms;
      while (Date.now() < deadline) {
        if (predicate()) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      expect.unreachable('轮询超时——异步发现续段未完成');
    },
  };
}

/** 工具结果首文本段（errResult/文结果两容——断言用便捷取法） */
function firstText(result: { readonly content: ReadonlyArray<{ type: string; text?: string }> }): string {
  const first = result.content[0];
  return first !== undefined && first.type === 'text' && first.text !== undefined ? first.text : '';
}

describe('R1 confine 注桩锁（两桥 spawn argv 过沙箱——03 §10.1/§10.2）', () => {
  it('MCP：confine 先于 spawn 收 argv + policy 档位维（boot 解析档位/live fence 根缺省派生）+ ConfinedArgv.argv 才是子进程 argv + 观测面语义不变', async () => {
    const rig = await bootBridgeRow('mcp', 'passthrough', 'read-only');
    // spawn 在 apply 内同步发——装载收口即已过 confine
    expect(rig.confineCalls.length).toBe(1);
    expect(rig.confineCalls[0]!.argv).toEqual(['/usr/local/bin/fake-mcp-server', '--stdio']);
    // policy.mode = boot 解析档位透传（CLI > settings > 代码常量——assembly 单源）
    expect(rig.confineCalls[0]!.policy.mode).toBe('read-only');
    // workspaceRoot = canonical 工作区根（.git 上溯缺省回退字面 cwd）
    expect(rig.confineCalls[0]!.policy.workspaceRoot).toBe(canonicalWorkspaceRoot(rig.tmpCwd));
    // writableRoots 缺省派生 = deriveWritableRoots(workspaceRoot, mode) 档位维
    // （live fence 根——config 形口径非 grants 交集，03 §10.1:918）
    expect(rig.confineCalls[0]!.policy.writableRoots).toBeUndefined();
    // ConfinedArgv.argv（runner 前缀形）直达 pipeline——裸 argv 不达子进程面
    expect(rig.spawnRecords.length).toBe(1);
    expect(rig.spawnRecords[0]!.argv).toEqual(['/usr/bin/fake-runner', '/usr/local/bin/fake-mcp-server', '--stdio']);
    expect(rig.spawnRecords[0]!.owner).toBe('mcp:demo'); // owner/env 原样透传
    // 观测面语义不变：发现完成后 liveServers 含 demo（confine 不扰动桥编排）
    const mcp = rig.mcpService();
    expect(mcp).toBeDefined();
    await rig.until(() => mcp!.liveServers().some((s) => s.server === 'demo'));
    expect(mcp!.liveServers().find((s) => s.server === 'demo')!.toolCount).toBe(1);
  });

  it('LSP：惰性首用 spawn 过 confine（装载零 spawn——argv/policy 同律）', async () => {
    const rig = await bootBridgeRow('lsp', 'passthrough', 'workspace-write');
    // 装载零 spawn（静态四件先注册——confine 只在首用 spawn 腿发生）
    expect(rig.confineCalls.length).toBe(0);
    expect(rig.spawnRecords.length).toBe(0);
    const lsp = rig.lspService();
    expect(lsp).toBeDefined();
    // 首用腿：diagnostics 触发惰性 spawn（握手 + didOpen + 诊断回流全真链）
    const result = await lsp!.tools.diagnostics('sample.ts');
    expect(rig.confineCalls.length).toBe(1);
    expect(rig.confineCalls[0]!.argv).toEqual(['/bin/fake-lsp-server']);
    expect(rig.confineCalls[0]!.policy.mode).toBe('workspace-write');
    expect(rig.confineCalls[0]!.policy.workspaceRoot).toBe(canonicalWorkspaceRoot(rig.tmpCwd));
    expect(rig.confineCalls[0]!.policy.writableRoots).toBeUndefined();
    expect(rig.spawnRecords.length).toBe(1);
    expect(rig.spawnRecords[0]!.argv).toEqual(['/usr/bin/fake-runner', '/bin/fake-lsp-server']);
    expect(rig.spawnRecords[0]!.owner).toBe('lsp:demo');
    // 全链通（握手成功 + 空诊断回流非降级面）+ 观测面 live
    expect(result.isError).not.toBe(true);
    expect(firstText(result)).toContain('[lsp 诊断]');
    expect(lsp!.liveServers()).toEqual([{ server: 'demo', state: 'live' }]);
  });
});

describe('R1 fail-closed 锁（exec-sandbox 缺席 = 拒裸起，禁静默裸 spawn）', () => {
  it('两桥同律：spawn 零调用 + MCP 连接失败族降级（notify）+ LSP errResult 归并 LSP_CONNECT_FAILED 并计熔断一败', async () => {
    const rig = await bootBridgeRow('both', 'absent');
    // MCP：confine 面先拒（包装层 throw → 桥 catch 漏斗 → MCP_CONNECT_FAILED
    // → discover catch 降级 notify——不炸装配）
    await rig.until(() => rig.notifications.some((n) => n.source === 'mcp' && n.message.includes('沙箱服务缺席')));
    expect(rig.notifications.some((n) => n.source === 'mcp' && n.message.includes('MCP 服务器 demo 连接失败'))).toBe(
      true,
    );
    // LSP：errResult 归并（instance catch → LSP_CONNECT_FAILED spawn 失败面）
    const lsp = rig.lspService();
    const result = await lsp!.tools.diagnostics('sample.ts');
    expect(result.isError).toBe(true);
    const text = firstText(result);
    expect(text).toContain('spawn 失败（demo）'); // 连接失败族归并锚
    expect(text).toContain('沙箱服务缺席'); // fail-closed 拒因可辨识
    // confine 拒 = 进程事故：下用再试并计熔断一败（既有律承接——第 1/3 次）
    expect(rig.notifications.some((n) => n.source === 'lsp' && n.message.includes('第 1/3 次'))).toBe(true);
    // 铁律：两桥 spawn 面零调用（禁静默裸 spawn——pipeline 恒无裸 argv）
    expect(rig.spawnRecords.length).toBe(0);
  });
});

describe('R1 confine 拒归并 + LSP 熔断承接锁（confine 拒 × 熔断计数定形）', () => {
  it('后端链空 confine 抛：3 连调 diagnostics → 3 计败熔断开 → 第 4 调熔断闸先拒（confine 零再调）', async () => {
    const rig = await bootBridgeRow('lsp', 'throwing');
    const lsp = rig.lspService();
    for (let i = 0; i < 3; i++) {
      const r = await lsp!.tools.diagnostics('sample.ts');
      expect(r.isError).toBe(true); // 每次都归并 LSP_CONNECT_FAILED（errResult）
      expect(firstText(r)).toContain('无可用沙箱后端'); // 拒因透传可辨识
    }
    // 计败序全落 notify：1/3 → 2/3 → 熔断开（同 server 3 连败熔断）
    const lspNotes = rig.notifications
      .filter((n) => n.source === 'lsp')
      .map((n) => n.message)
      .join('\n');
    expect(lspNotes).toContain('第 1/3 次');
    expect(lspNotes).toContain('第 2/3 次');
    expect(lspNotes).toContain('熔断开');
    // 第 4 调：熔断闸先拒（confine 面零再调——LSP_CIRCUIT_OPEN）
    const fourth = await lsp!.tools.diagnostics('sample.ts');
    expect(fourth.isError).toBe(true);
    expect(firstText(fourth)).toContain('已熔断');
    expect(rig.confineCalls.length).toBe(3); // 恰三次——熔断闸挡住第 4 次
    expect(rig.spawnRecords.length).toBe(0); // 拒路径零 spawn 恒成立
  });
});
