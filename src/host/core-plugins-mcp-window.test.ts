import { describe, expect, it } from 'vitest';
import { EventDispatch, Scope } from '../context/index.js';
import { CommandRegistry, createChannels } from '../channels/index.js';
import { createToolRegistry } from '../tools/index.js';
import type { McpChildFace, McpServerConfig } from '../mcp/index.js';
import { createCorePlugins } from './core-plugins.js';
import { createPluginContext, PLUGIN_HOOK_VOCABULARY } from './plugin-context.js';
import type { PluginContextHandle } from './plugin-context.js';
import { createPluginToolLedger } from './plugin-boot.js';
import { loadPlugins } from './loader.js';
import type { CorePluginReference, LoaderPlanRow } from './loader.js';
import { PromptSectionRegistry } from './prompt-sections.js';
import { TriggerRegistry } from './triggers.js';
import { createJobRegistry, createSubagentService } from '../subagent/index.js';
// 错误码册注册腿（「import 发生才注册」——窗闸拒码文本断言的前置副作用）
import './codes.js';

/**
 * core:mcp 异步发现续段注册通道回归锁（真模型四轮 C 组——2026-09-13）。
 *
 * 病灶：makeMcpPlugin 的 registry 闭包绑 ctx.tools.register，discover 异步握手
 * 完成时装载窗已收口（onApplySettled 关窗）→ assertWindow 拒
 * PLUGIN_WINDOW_CLOSED → resurface 的 per-def 降 warn 吞掉 → 真装配下 MCP
 * 工具注册 100% 失败（mcp/service.test 的 FakeRegistry 无窗闸绕过故绿——
 * 本锁换真窗闸面复现，真实时序 = loadPlugins 收口关窗后异步发现续段注册）。
 *
 * 通道（03 §2.1/§10.1 同日定形注）：装载器对 core: 行 apply 传宿主面第三参
 * （openHostCallback 开窗器——开本插件回调窗、返回恢复闭包），register 闭包
 * 经宿主回调窗注册——注册链全语义保留（owner 覆写 core:mcp/工具名账/复合名）。
 * 磁盘行结构性不传 = 第三方插件无此通道（有意禁区）。
 */

/** 宿主自省面测试替身（materializeHostFace 形——纯数据即可） */
const HOST_FACE = {
  version: '0.1.0-alpha.1',
  apiVersion: '1.0',
  capabilities: { has: () => false, list: () => [] as string[] },
  experimental: { enabled: () => false },
} as const;

/** 脚本化假子进程（spawn 时预置工具清单——握手走到 tools/list 即应答，测试零竞速） */
class ScriptedChild implements McpChildFace {
  readonly written: string[] = [];
  private readonly dataCallbacks: ((chunk: Buffer) => void)[] = [];
  private readonly exitCallbacks: ((info: { code: number | null; spawnError?: Error }) => void)[] = [];

  constructor(private readonly presetTools: readonly { name: string }[]) {}

  readonly stdin = {
    write: (data: string) => {
      this.written.push(data);
      for (const piece of data.split('\n')) {
        if (piece.trim() === '') continue;
        const msg = JSON.parse(piece) as { id?: number; method?: string };
        // 应答恒走宏任务边界（真实子进程时序：跨进程 IO——装载窗收口
        // onApplySettled 关窗后应答才到，发现续段结构性窗外。同步应答会把
        // 整条发现链压进 apply 微任务收口前 = 窗内注册，复现失真）
        if (msg.method === 'initialize' && msg.id !== undefined) {
          setTimeout(() => this.emit(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} })), 0);
        } else if (msg.method === 'tools/list' && msg.id !== undefined) {
          const tools = this.presetTools.map((t) => ({ ...t, inputSchema: { type: 'object' } }));
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
    // 最小形——本测试不触树杀路径（McpChildFace.kill(): void 形状满足用）
  }
}

/**
 * 真装载链装配：loadPlugins + createCorePlugins + 真 createPluginContext（真
 * 窗闸 + 真 toolRegistry + 真工具名账）+ 假 spawn 面（exec-pipeline 服务位）。
 * coreHostChannel 缺席形与在场形由用例自选——在场形复刻 bootPlugins 的
 * 「查 handle 铸开窗器」闭包（03 §2.1 官方件宿主面）。
 */
async function bootMcpRow(withHostChannel: boolean) {
  const handles = new Map<string, PluginContextHandle>();
  const warns: string[] = [];
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
  // 假 exec-pipeline：spawn 即建预置工具的脚本化子进程（owner = mcp:<server>）
  const children = new Map<string, ScriptedChild>();
  const fakePipeline = {
    spawnInteractive: (request: { owner: string }) => {
      const child = new ScriptedChild([{ name: 'boom' }]);
      children.set(request.owner, child);
      return child;
    },
  };
  scope.provide('exec-pipeline', fakePipeline);

  const refs = createCorePlugins({ dataDir: null });
  const mcpRef = refs.find((r) => r.name === 'mcp') as CorePluginReference;
  const serverConfig: McpServerConfig = { command: '/usr/local/bin/fake-mcp' };
  const plan: LoaderPlanRow[] = [
    { kind: 'core', id: 'core:mcp', reference: mcpRef, config: { servers: { demo: serverConfig } } },
  ];
  const services = (() => {
    const bag = new Map<string, unknown>();
    return {
      get: (name: string) => bag.get(name),
      provide: (name: string, value: unknown) => {
        bag.set(name, value);
      },
    };
  })();
  // 共享根与插件 fork 分立：fork 才是 ctx 消费的服务面（exec-pipeline 已入根）
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
        provide: services.provide, // ctx.provide 委派共享根（plugin-boot 同款——'mcp' 服务面供给）
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
    onApplySettled: (pluginId) => handles.get(pluginId)?.closeWindow(), // 真实时序——行收口即关窗
    warn: (message) => warns.push(message),
    // 官方件宿主面通道（在场形）：查 handle 铸开窗器——bootPlugins 同款闭包
    ...(withHostChannel
      ? {
          coreHostChannel: (pluginId: string) => {
            const handle = handles.get(pluginId);
            return handle === undefined ? undefined : { openHostCallback: () => handle.enterHostCallback() };
          },
        }
      : {}),
  });

  return { tools, toolLedger, children, warns };
}

/** 轮询直至谓词真（2s 帽——异步发现续段微任务+宏任务链收口） */
async function until(predicate: () => boolean, ms = 2_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  expect.unreachable('轮询超时——异步发现续段未完成注册');
}

describe('core:mcp 装载窗收口后异步发现续段注册（真窗闸面——真模型四轮 C 组）', () => {
  it('宿主面通道在场：发现续段经回调窗注册成功——owner 铸 core:mcp + 工具名账记账（修前红主锁）', async () => {
    const { tools, toolLedger, children } = await bootMcpRow(true);
    // 装载已收口（onApplySettled 关窗在 loadPlugins 返回前）——发现续段窗外到达
    expect(children.get('mcp:demo')).toBeDefined(); // spawn 已发（apply 内同步）
    await until(() => tools.listFor('model').some((d) => d.name === 'demo__boom'));
    // 注册链全语义：owner 覆写 core:mcp（fork 闭包单源——插件自报不达）
    const def = tools.listFor('model').find((d) => d.name === 'demo__boom');
    expect(def?.owner).toBe('core:mcp');
    // 工具名账同笔入账（装载史批 h-3——世代行 tools 列真值源）
    expect(toolLedger.toolsOf('core:mcp')).toContain('demo__boom');
  });

  it('宿主面通道缺席：直调形被窗闸拒——注册面恒空（对面锁·窗闸现状执法）', async () => {
    const { tools } = await bootMcpRow(false);
    // 留足异步续段跑完的窗口——缺席形注册恒被拒（现状锁：窗闸对无通道形照执法；
    // 拒后 per-def 降 warn 在 service 内部 logger——本面只锁注册面恒空）
    await new Promise((r) => setTimeout(r, 200));
    expect(tools.listFor('model').some((d) => d.name === 'demo__boom')).toBe(false);
  });
});
