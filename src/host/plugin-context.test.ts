import { describe, expect, it, vi } from 'vitest';
import { BaseError } from '../contracts/index.js';
import type { ProgrammaticSubagentDef } from '../contracts/index.js';
import type { UiBackend } from '../contracts/index.js';
import { getErrorCodeInfo } from '../contracts/index.js';
import { EventDispatch, Scope } from '../context/index.js';
import type { Disposer } from '../context/index.js';
import { CommandRegistry, createChannels } from '../channels/index.js';
import { createToolRegistry } from '../tools/index.js';
import { createJobRegistry, createSubagentService } from '../subagent/index.js';
import { SESSION_LIFECYCLE_EVENT } from '../conversation/index.js';
// 归因两律机制件（U4-3——session_before_compact 接管缝测试的种箱位）
import { BEFORE_COMPACT_ATTRIB } from '../compaction/index.js';
import type { BeforeCompactAttribution } from '../compaction/index.js';
import { createPluginContext, PLUGIN_HOOK_VOCABULARY } from './plugin-context.js';
import type { AuditSink, ChannelsUiFace, PluginContextHandle, PluginToolLedger } from './plugin-context.js';
import { createHookDispatchGuard } from './hook-dispatch-guard.js';
import { runWithSessionAnchor, withoutSessionAnchor, readSessionAnchor } from './session-anchor.js';
import { PromptSectionRegistry } from './prompt-sections.js';
import { TriggerRegistry } from './triggers.js';
// 错误码册注册腿（「import 发生才注册」——门关码注册断言的前置副作用）
import './codes.js';

/** 宿主自省面测试替身（materializeHostFace 形——纯数据即可） */
const HOST_FACE = {
  version: '0.1.0-alpha.1',
  apiVersion: '1.0',
  capabilities: { has: () => false, list: () => [] as string[] },
  experimental: { enabled: () => false },
} as const;

/** 测试装配（真源注册表 + 可调小护栏参数——mock 只停在时钟面） */
function assemble(overrides?: {
  pluginId?: string;
  rateLimit?: { windowMs: number; max: number };
  hookTimeoutMs?: number;
  opens?: readonly string[];
  crossDoors?: () => ReadonlySet<string>;
  auditSink?: AuditSink;
  sessionLineage?: { isSameTree(a: string, b: string): boolean };
  toolLedger?: PluginToolLedger;
  subagentToolMaterializer?: (def: ProgrammaticSubagentDef) => Disposer;
  channelsUi?: ChannelsUiFace;
  hookDispatchGuard?: ReturnType<typeof createHookDispatchGuard>;
  uiWarn?: (message: string) => void;
  /** 通道核外注（ix-2 消费腿用例——channelsUi 适配闭包需先于 assemble 引用） */
  channels?: ReturnType<typeof createChannels>;
}): {
  handle: PluginContextHandle;
  dispatch: EventDispatch;
  scope: Scope;
  promptSections: PromptSectionRegistry;
  triggers: TriggerRegistry;
  subagents: ReturnType<typeof createSubagentService>;
  channels: ReturnType<typeof createChannels>;
  tools: ReturnType<typeof createToolRegistry>;
} {
  const scope = Scope.createRoot();
  const dispatch = new EventDispatch();
  // 钩子词汇预注册（装配批 12f-2b 的职责在此以主表全量模拟）
  dispatch.registerEventNames(PLUGIN_HOOK_VOCABULARY.map((h) => h.name));
  const promptSections = new PromptSectionRegistry();
  // 触发器注册表真源（全开门——门检三态在 triggers.test 域；starter 替身空转）
  const triggers = new TriggerRegistry({
    getOpens: () => new Set(['triggers.start-run']),
    makeStarter: () => () => undefined,
  });
  // 子代理注册面真源（两闸执法在 service.test 域——此处只验委派与归因）
  const subagents = createSubagentService({ registry: createJobRegistry() });
  // 通道核真源（U3 批 U3-4——插件域腿 registerPluginBackend 委派目标；
  // 撞名/分域执法在 channels.test 域，此处只验门检/窗口/委派/落账）
  const channels = overrides?.channels ?? createChannels();
  // 工具注册表真源（受理壳铸造例的 owner 断言面——listFor 读已铸定义）
  const tools = createToolRegistry(dispatch);
  const handle = createPluginContext({
    pluginId: overrides?.pluginId ?? 'acme-widgets',
    scope,
    dispatch,
    tools,
    commands: new CommandRegistry(),
    uiBackends: channels,
    llm: { registerProvider: () => () => undefined },
    promptSections,
    triggers,
    subagents,
    hostFace: HOST_FACE,
    ...(overrides?.rateLimit ? { rateLimit: overrides.rateLimit } : {}),
    ...(overrides?.hookTimeoutMs ? { hookTimeoutMs: overrides.hookTimeoutMs } : {}),
    ...(overrides?.opens !== undefined ? { opens: overrides.opens } : {}),
    ...(overrides?.crossDoors !== undefined ? { crossDoors: overrides.crossDoors } : {}),
    ...(overrides?.auditSink !== undefined ? { auditSink: overrides.auditSink } : {}),
    ...(overrides?.sessionLineage !== undefined ? { sessionLineage: overrides.sessionLineage } : {}),
    ...(overrides?.toolLedger !== undefined ? { toolLedger: overrides.toolLedger } : {}),
    ...(overrides?.subagentToolMaterializer !== undefined
      ? { subagentToolMaterializer: overrides.subagentToolMaterializer }
      : {}),
    ...(overrides?.channelsUi !== undefined ? { channelsUi: overrides.channelsUi } : {}),
    ...(overrides?.hookDispatchGuard !== undefined ? { hookDispatchGuard: overrides.hookDispatchGuard } : {}),
    ...(overrides?.uiWarn !== undefined ? { uiWarn: overrides.uiWarn } : {}),
  });
  return { handle, dispatch, scope, promptSections, triggers, subagents, channels, tools };
}

/** BaseError 码断言辅助（错码即契约——修 bug 必带回归锁的判据面） */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable();
  } catch (err) {
    if (err instanceof BaseError) {
      expect(err.code).toBe(code);
      return;
    }
    throw err;
  }
}

describe('钩子主表镜像（03 §2.4）', () => {
  it('41 词全量（七层 35 + 生命周期组 6）且无重词', () => {
    expect(PLUGIN_HOOK_VOCABULARY.length).toBe(41);
    const names = PLUGIN_HOOK_VOCABULARY.map((h) => h.name);
    expect(new Set(names).size).toBe(41);
  });

  it('模式分布：waterfall 15 / serial 3 / parallel 1 / emit 22', () => {
    const count = (mode: string) => PLUGIN_HOOK_VOCABULARY.filter((h) => h.mode === mode).length;
    expect(count('waterfall')).toBe(15);
    expect(count('serial')).toBe(3);
    expect(count('parallel')).toBe(1);
    expect(count('emit')).toBe(22);
  });
});

describe('装载窗口律（03 §2.1）', () => {
  it('构造即窗开——apply 期注册动词合法', () => {
    const { handle } = assemble();
    const dispose = handle.ctx.tools.register({
      name: 'acme_probe',
      description: '窗口内注册合法',
      parameters: { type: 'object' as const },
      execute: async () => ({ content: [] }),
    });
    expect(typeof dispose).toBe('function');
    dispose();
  });

  it('关窗后注册动词族七路全拒（PLUGIN_WINDOW_CLOSED）', () => {
    const { handle } = assemble();
    handle.closeWindow();
    const ctx = handle.ctx;
    expectCode(
      () =>
        ctx.tools.register({
          name: 'x-one',
          description: '',
          parameters: { type: 'object' as const },
          execute: async () => ({ content: [] }),
        }),
      'PLUGIN_WINDOW_CLOSED',
    );
    expectCode(() => ctx.channels.registerCommand('x-two', () => undefined), 'PLUGIN_WINDOW_CLOSED');
    expectCode(() => ctx.llm.registerProvider({ id: 'x' } as never), 'PLUGIN_WINDOW_CLOSED');
    expectCode(
      () =>
        ctx.events.registerSessionEventType({
          type: 'x/three',
          category: 'log-only',
          owner: 'x',
          tier: 'stable',
          description: '',
        }),
      'PLUGIN_WINDOW_CLOSED',
    );
    expectCode(() => ctx.agent.registerMessageRole('x/four', {}), 'PLUGIN_WINDOW_CLOSED');
    expectCode(() => ctx.prompts.registerSection('x/five', () => ''), 'PLUGIN_WINDOW_CLOSED');
    expectCode(() => ctx.on('session_start', () => undefined), 'PLUGIN_WINDOW_CLOSED');
  });

  it('回调窗内注册合法（钩子 handler 执行期——窗口延伸条款，§2.4 第 3 条）', () => {
    const { handle } = assemble();
    handle.closeWindow();
    const restore = handle.enterHostCallback();
    try {
      handle.ctx.prompts.registerSection('acme-widgets/callback-leg', () => '回调窗内注册');
    } finally {
      restore();
    }
  });

  it('嵌套回调窗（深度计数——内外层各自恢复）', () => {
    const { handle } = assemble();
    handle.closeWindow();
    const outer = handle.enterHostCallback();
    const inner = handle.enterHostCallback();
    inner();
    // 内层已恢复但外层仍在——注册仍合法
    handle.ctx.channels.registerCommand('acme-nested', () => undefined);
    outer();
    expectCode(() => handle.ctx.channels.registerCommand('acme-after', () => undefined), 'PLUGIN_WINDOW_CLOSED');
  });

  it('回调窗恢复闭包幂等（异常路径双调防御不减穿零）', () => {
    const { handle } = assemble();
    handle.closeWindow();
    const restore = handle.enterHostCallback();
    restore();
    restore(); // 幂等
    expectCode(() => handle.ctx.channels.registerCommand('x-after-restore', () => undefined), 'PLUGIN_WINDOW_CLOSED');
  });

  it('inLoadWindow 镜像窗位（c-6——宿主面专用 getter：构造即 true，关窗 false，回调窗不回落装载位）', () => {
    const { handle } = assemble();
    expect(handle.inLoadWindow).toBe(true); // apply 期（plugin-boot 绑 registerOAuthFlow 窗判据）
    handle.closeWindow();
    expect(handle.inLoadWindow).toBe(false);
    const restore = handle.enterHostCallback(); // 回调窗开的是注册动词族——装载位不回落
    try {
      expect(handle.inLoadWindow).toBe(false); // 流注册严于通律：回调窗内不可 registerOAuthFlow
    } finally {
      restore();
    }
    expect(handle.inLoadWindow).toBe(false);
  });

  it('读面免窗：关窗后 get/tryGet/host 照常', () => {
    const { handle, scope } = assemble();
    scope.provide('svc-a', 42);
    handle.closeWindow();
    expect(handle.ctx.get<number>('svc-a')).toBe(42);
    expect(handle.ctx.tryGet('svc-b')).toBeUndefined();
    expect(handle.ctx.host.pluginId).toBe('acme-widgets');
    expect(handle.ctx.host.apiVersion).toBe('1.0');
    expect(handle.ctx.host.version).toBe('0.1.0-alpha.1');
  });
});

describe('频率护栏（03 §3.4——滑动窗）', () => {
  it('窗内第 max 次过、第 max+1 次拒（PLUGIN_RATE_LIMITED）', () => {
    const { handle } = assemble({ rateLimit: { windowMs: 1000, max: 3 } });
    const ctx = handle.ctx;
    ctx.channels.registerCommand('acme-a', () => undefined);
    ctx.channels.registerCommand('acme-b', () => undefined);
    ctx.channels.registerCommand('acme-c', () => undefined); // 第 3 次 = max 次过
    expectCode(() => ctx.channels.registerCommand('acme-d', () => undefined), 'PLUGIN_RATE_LIMITED');
  });

  it('注册动词与 on/emit/effect 同池计数', () => {
    const { handle } = assemble({ rateLimit: { windowMs: 1000, max: 4 } });
    const ctx = handle.ctx;
    ctx.channels.registerCommand('acme-a', () => undefined); // 1
    expect(typeof ctx.on('session_start', () => undefined)).toBe('function'); // 2
    ctx.effect(() => () => undefined); // 3
    void ctx.emit('acme-widgets/first'); // 4 = max 次过
    expectCode(() => ctx.channels.registerCommand('acme-b', () => undefined), 'PLUGIN_RATE_LIMITED');
  });

  it('滑动窗滑出后重新可计（窗内旧动作剪枝）', () => {
    vi.useFakeTimers();
    try {
      const { handle } = assemble({ rateLimit: { windowMs: 50, max: 1 } });
      handle.ctx.channels.registerCommand('acme-a', () => undefined);
      expectCode(() => handle.ctx.channels.registerCommand('acme-b', () => undefined), 'PLUGIN_RATE_LIMITED');
      vi.advanceTimersByTime(60); // 滑出窗口
      expect(() => handle.ctx.channels.registerCommand('acme-c', () => undefined)).not.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('钩子订阅路由（03 §2.4）', () => {
  it('未知钩子 fail-closed（PLUGIN_HOOK_UNKNOWN）', () => {
    const { handle } = assemble();
    expectCode(() => handle.ctx.on('no_such_hook', () => undefined), 'PLUGIN_HOOK_UNKNOWN');
  });

  it('emit 词挂通知面、waterfall 词挂管线面（路由判据 = 主表 mode）', async () => {
    const { handle, dispatch } = assemble();
    const seen: string[] = [];
    handle.ctx.on('session_start', () => {
      seen.push('emit-leg');
    });
    handle.ctx.on('context_transform', (messages, next) => {
      seen.push('waterfall-leg');
      return next(messages);
    });
    await dispatch.emit('session_start', {});
    expect(seen).toEqual(['emit-leg']);
    const out = await dispatch.waterfall('context_transform', ['m1']);
    expect(out).toEqual(['m1']);
    expect(seen).toEqual(['emit-leg', 'waterfall-leg']);
  });

  it('退订闭包生效（on 返回值即退订柄）', async () => {
    const { handle, dispatch } = assemble();
    let fired = 0;
    const off = handle.ctx.on('session_start', () => {
      fired++;
    });
    off();
    await dispatch.emit('session_start', {});
    expect(fired).toBe(0);
  });

  it('notify 腿真异常抛回 dispatch 隔离上报（吞并档只收超时腿）', async () => {
    const reported: unknown[] = [];
    const dispatch = new EventDispatch({ onListenerError: (_name, err) => reported.push(err) });
    dispatch.registerEventNames(['session/event']);
    const handle = createPluginContext({
      pluginId: 'acme-inner',
      scope: Scope.createRoot(),
      dispatch,
      hostFace: HOST_FACE,
    });
    handle.ctx.on('session/event', () => {
      throw new Error('真异常');
    });
    await dispatch.emit('session/event', {});
    expect(reported.length).toBe(1);
    expect((reported[0] as Error).message).toBe('真异常');
  });

  it('钩子消费点时钟：notify 腿超时上报后吞并收口不悬挂', async () => {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(['session_start']);
    const timeouts: string[] = [];
    const handle = createPluginContext({
      pluginId: 'acme-slow',
      scope: Scope.createRoot(),
      dispatch,
      hookTimeoutMs: 20,
      onHookTimeout: (pluginId, hookName) => timeouts.push(`${pluginId}:${hookName}`),
      hostFace: HOST_FACE,
    });
    handle.ctx.on('session_start', () => new Promise(() => undefined)); // 挂死 handler
    // emit 收口不悬挂（20ms 钟到点放行——超时腿吞并）
    await dispatch.emit('session_start', {});
    expect(timeouts).toEqual(['acme-slow:session_start']);
  });

  it('钩子 handler 执行期回调窗开（handler 内注册合法——窗口延伸）', async () => {
    const { handle, dispatch } = assemble();
    handle.ctx.on('session_start', () => {
      // wrapper 已开回调窗——handler 内注册动词合法
      handle.ctx.channels.registerCommand('acme-in-handler', () => undefined);
    });
    handle.closeWindow(); // 订阅在窗内完成，此后仅回调窗内可注册
    await dispatch.emit('session_start', {});
    // handler 毕恢复——窗再度关死
    expectCode(() => handle.ctx.channels.registerCommand('acme-after', () => undefined), 'PLUGIN_WINDOW_CLOSED');
  });

  it('hook/registered 受理账（T9 案一批 t-2——05 §1.1）：waterfall/notify 两腿成功尾逐笔、载荷无 rank', () => {
    const events: { type: string; data: Record<string, unknown> }[] = [];
    const { handle } = assemble({ auditSink: { append: (type, data) => events.push({ type, data }) } });
    handle.ctx.on('context_transform', (messages, next) => next(messages)); // waterfall 腿
    handle.ctx.on('session_start', () => undefined); // notify 腿
    // 落账形 = 05 §1.1 载荷（pluginId 归因 + hook 词；无 rank——03 §2.4 两参
    // 签名恒定、注册序由受理时序承载）
    expect(events).toEqual([
      { type: 'hook/registered', data: { pluginId: 'acme-widgets', hook: 'context_transform' } },
      { type: 'hook/registered', data: { pluginId: 'acme-widgets', hook: 'session_start' } },
    ]);
  });

  it('hook/registered 拒路径零审计（未知钩子/窗外被拒——被拒的注册不是行为）', () => {
    const events: { type: string; data: Record<string, unknown> }[] = [];
    const { handle } = assemble({ auditSink: { append: (type, data) => events.push({ type, data }) } });
    expectCode(() => handle.ctx.on('no_such_hook', () => undefined), 'PLUGIN_HOOK_UNKNOWN');
    handle.closeWindow();
    expectCode(() => handle.ctx.on('session_start', () => undefined), 'PLUGIN_WINDOW_CLOSED');
    expect(events).toEqual([]); // 两拒路径均不落账
  });

  it('hook/registered auditSink 缺席不炸（诚实缺席律——无审计面时注册语义不变）', () => {
    const { handle } = assemble(); // 无 auditSink
    expect(() => handle.ctx.on('session_start', () => undefined)).not.toThrow();
  });
});

describe('ctx.emit 域名律（03 §2.2 尾注）', () => {
  it('自域词首发射自动注册、可再发', async () => {
    const { handle, dispatch } = assemble();
    await handle.ctx.emit('acme-widgets/ping', { n: 1 });
    expect(dispatch.isRegistered('acme-widgets/ping')).toBe(true);
    await handle.ctx.emit('acme-widgets/ping', { n: 2 }); // 二发不撞 EVENT_DUPLICATE
  });

  it('非本域词拒（EVENT_NOT_REGISTERED——域名前缀纪律执法）', () => {
    const { handle } = assemble();
    expectCode(() => void handle.ctx.emit('other-plugin/ping'), 'EVENT_NOT_REGISTERED');
    expectCode(() => void handle.ctx.emit('裸词'), 'EVENT_NOT_REGISTERED');
  });

  it('自域词广播真达监听者（首发自动注册后宿主侧可挂听）', async () => {
    const { handle, dispatch } = assemble();
    await handle.ctx.emit('acme-widgets/ping', { n: 1 }); // 首发自动注册词
    const got: unknown[] = [];
    dispatch.on('acme-widgets/ping', (data) => got.push(data));
    await handle.ctx.emit('acme-widgets/ping', { n: 7 });
    expect(got).toEqual([{ n: 7 }]);
  });
});

describe('注册动词委派真源', () => {
  it('tools.register → ToolRegistry（撞名执法在真源——TOOL_NAME_CONFLICT 透传）', () => {
    const { handle } = assemble();
    const def = {
      name: 'acme_probe',
      description: '探针',
      parameters: { type: 'object' as const },
      execute: async () => ({ content: [] }),
    };
    handle.ctx.tools.register(def);
    expectCode(() => handle.ctx.tools.register(def), 'TOOL_NAME_CONFLICT');
  });

  it('tools.register agent_ 前缀保留字闸（03 §2.7 行 254——TOOL_NAME_CONFLICT 同码；边界词放行）', () => {
    const { handle } = assemble();
    const make = (name: string) => ({
      name,
      description: '探针',
      parameters: { type: 'object' as const },
      execute: async () => ({ content: [] }),
    });
    try {
      handle.ctx.tools.register(make('agent_daily'));
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('TOOL_NAME_CONFLICT');
        expect(err.message).toContain('保留'); // 保留字段拒绝语义（区别于撞名档）
        return;
      }
      throw err;
    }
    // 边界：无下划线的 'agent' 与非头位前缀不属保留段——放行
    expect(() => handle.ctx.tools.register(make('agent'))).not.toThrow();
    expect(() => handle.ctx.tools.register(make('my_agent_tool'))).not.toThrow();
  });

  it('tools.register 工具名账包壳（装载史批 h-3——注册成功入账、disposer 出账；撞名拒不入账）', () => {
    const added: Array<[string, string]> = [];
    const removed: Array<[string, string]> = [];
    const ledger: PluginToolLedger = {
      add: (pluginId, toolName) => void added.push([pluginId, toolName]),
      remove: (pluginId, toolName) => void removed.push([pluginId, toolName]),
    };
    const { handle } = assemble({ toolLedger: ledger });
    const dispose = handle.ctx.tools.register({
      name: 'acme_probe',
      description: '名账探针',
      parameters: { type: 'object' as const },
      execute: async () => ({ content: [] }),
    });
    expect(added).toEqual([['acme-widgets', 'acme_probe']]); // 归因键 = 本插件 id
    expect(removed).toEqual([]); // 注册不触发出账
    // 撞名拒（真源执法）不入账——包壳只在真源 register 返回后才 add
    expectCode(
      () =>
        handle.ctx.tools.register({
          name: 'acme_probe',
          description: '撞名',
          parameters: { type: 'object' as const },
          execute: async () => ({ content: [] }),
        }),
      'TOOL_NAME_CONFLICT',
    );
    expect(added).toHaveLength(1);
    dispose();
    expect(removed).toEqual([['acme-widgets', 'acme_probe']]); // 撤注出账不留残影
  });

  it('tools.register 无账形（toolLedger 缺席）注册语义不变（诚实缺席律）', () => {
    const { handle } = assemble();
    const dispose = handle.ctx.tools.register({
      name: 'acme_probe',
      description: '无账形',
      parameters: { type: 'object' as const },
      execute: async () => ({ content: [] }),
    });
    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();
  });

  it('tools.register owner 归因铸造（T9 案一批 R1——受理壳无条件覆写：自报值恒不达注册表）', () => {
    const { handle, tools } = assemble({ pluginId: 'demo:plug' });
    handle.ctx.tools.register({
      name: 'probe_a',
      description: '正常注册（无自报）',
      parameters: { type: 'object' as const },
      execute: async () => ({ content: [] }),
    });
    // 自报 owner（冒名尝试——'core:host' 保留位为最强冒名面）：覆写律的判据位
    // （类型面上 ToolDefinition.owner 是契约铸造位、传值合法——运行时恒覆写）
    handle.ctx.tools.register({
      name: 'probe_b',
      description: '自报归因（应被无条件覆写）',
      parameters: { type: 'object' as const },
      execute: async () => ({ content: [] }),
      owner: 'core:host',
    });
    const owners = new Map(
      tools
        .listFor('any-session')
        .filter((d) => d.name.startsWith('probe_'))
        .map((d) => [d.name, d.owner]),
    );
    // 两形同铸注册者 pluginId——覆写无条件非缺省补齐（冒名结构性不存在）
    expect(owners.get('probe_a')).toBe('demo:plug');
    expect(owners.get('probe_b')).toBe('demo:plug'); // 自报 'core:host' 恒不达注册表
  });

  it('channels.registerCommand → CommandRegistry（后写胜出——disposer 不误摘接任者）', async () => {
    const registry = new CommandRegistry();
    const { handle, dispatch } = assemble();
    const inner = createPluginContext({
      pluginId: 'acme-cmd',
      scope: Scope.createRoot(),
      dispatch,
      commands: registry,
      hostFace: HOST_FACE,
    });
    const calls: string[] = [];
    inner.ctx.channels.registerCommand('acme-do', () => {
      calls.push('v1');
    });
    const offV1 = inner.ctx.channels.registerCommand('acme-do', () => {
      calls.push('v2');
    }); // 后写胜出
    offV1(); // 注销现任 v2
    await registry.dispatch('/acme-do');
    expect(calls).toEqual([]); // v2 已注、v1 被覆盖不复活（§2.7 三律③）
    handle.closeWindow();
  });

  it('受局面缺位响亮（CONTEXT_SERVICE_MISSING——装配缺陷不静默）', () => {
    const handle = createPluginContext({
      pluginId: 'acme-bare',
      scope: Scope.createRoot(),
      dispatch: new EventDispatch(),
      hostFace: HOST_FACE,
    });
    expectCode(
      () =>
        handle.ctx.tools.register({
          name: 't',
          description: '',
          parameters: { type: 'object' as const },
          execute: async () => ({ content: [] }),
        }),
      'CONTEXT_SERVICE_MISSING',
    );
    expectCode(() => handle.ctx.channels.registerCommand('c', () => undefined), 'CONTEXT_SERVICE_MISSING');
    expectCode(() => handle.ctx.llm.registerProvider({ id: 'p' } as never), 'CONTEXT_SERVICE_MISSING');
    expectCode(() => handle.ctx.prompts.registerSection('acme-bare/s', () => ''), 'CONTEXT_SERVICE_MISSING');
    expectCode(
      () => handle.ctx.triggers.register({ name: 'acme-bare/t', description: '', fire: () => undefined }),
      'CONTEXT_SERVICE_MISSING',
    );
    expectCode(
      () => handle.ctx.agent.registerSubagentProvider({ name: 'd', description: '', systemPrompt: '' }),
      'CONTEXT_SERVICE_MISSING',
    );
  });

  it('agent.registerMessageRole → contracts 真源（AGENT_ROLE_EXISTS 透传 + disposer 摘除释放名）', () => {
    const { handle } = assemble();
    const off = handle.ctx.agent.registerMessageRole('acme-widgets/recall', { render: { intent: 'inline' } });
    expectCode(() => handle.ctx.agent.registerMessageRole('acme-widgets/recall', {}), 'AGENT_ROLE_EXISTS');
    off();
    // 摘除后可重注册（卸载回卷即释放名）
    expect(() => handle.ctx.agent.registerMessageRole('acme-widgets/recall', {})).not.toThrow();
  });

  it('events.registerSessionEventType → contracts 真源（不可逆——void 返回 + 撞名透传）', () => {
    const { handle } = assemble();
    const meta = {
      type: 'acme-widgets/custom-thing',
      category: 'log-only' as const,
      owner: 'acme-widgets',
      tier: 'stable' as const,
      description: '测试词',
    };
    const out = handle.ctx.events.registerSessionEventType(meta);
    expect(out).toBeUndefined(); // 无 disposer——词汇注册进程生命周期（§2.2 明文例外）
    expectCode(
      () => handle.ctx.events.registerSessionEventType({ ...meta, description: '' }),
      'PLUGIN_EVENT_TYPE_CONFLICT',
    );
  });

  it('prompts.registerSection 返回注销器（注销后位可再注）', () => {
    const { handle, promptSections } = assemble();
    const off = handle.ctx.prompts.registerSection('acme-widgets/hints', () => '一');
    off();
    expect(promptSections.materialize()).toBe('');
    expect(() => handle.ctx.prompts.registerSection('acme-widgets/hints', () => '二')).not.toThrow();
  });
});

describe('提示词段注册表（prompt-sections——03 §2.5/§2.7）', () => {
  it('合法注册 + slot 字典序物化（与装载序解耦）', () => {
    const { handle, promptSections } = assemble();
    handle.ctx.prompts.registerSection('acme-widgets/zeta', () => 'Z');
    handle.ctx.prompts.registerSection('acme-widgets/alpha', () => 'A');
    expect(promptSections.materialize()).toBe('A\n\nZ');
    expect(promptSections.slotList()).toEqual(['acme-widgets/alpha', 'acme-widgets/zeta']);
  });

  it('第三参 options 透传 registry（volatile 声明经 ctx 面——cache 经济批 ca-2/m7）', () => {
    const { handle, promptSections } = assemble();
    handle.ctx.prompts.registerSection('acme-widgets/clock', () => 'V', {
      volatile: { reason: '时间戳类' },
    });
    // volatile 段物化位恒段区尾（两段律）——经 ctx 面声明与直注 registry 同效
    handle.ctx.prompts.registerSection('acme-widgets/steady', () => 'S');
    expect(promptSections.materialize()).toBe('S\n\nV');
    expectCode(
      () =>
        handle.ctx.prompts.registerSection('acme-widgets/bad', () => '', {
          volatile: { reason: '' },
        }),
      'PLUGIN_PROMPT_SLOT_INVALID',
    );
  });

  it('slot 非域前缀两段式拒（PLUGIN_PROMPT_SLOT_INVALID 四档）', () => {
    const { handle } = assemble();
    expectCode(() => handle.ctx.prompts.registerSection('裸段', () => ''), 'PLUGIN_PROMPT_SLOT_INVALID'); // 无 /
    expectCode(() => handle.ctx.prompts.registerSection('other-domain/seg', () => ''), 'PLUGIN_PROMPT_SLOT_INVALID'); // 域前缀 ≠ 插件 id
    expectCode(() => handle.ctx.prompts.registerSection('acme-widgets/a/b', () => ''), 'PLUGIN_PROMPT_SLOT_INVALID'); // 双 /
    expectCode(() => handle.ctx.prompts.registerSection('acme-widgets/', () => ''), 'PLUGIN_PROMPT_SLOT_INVALID'); // 段名空
  });

  it('同 slot 撞位拒（PLUGIN_PROMPT_SECTION_CONFLICT）', () => {
    const { handle } = assemble();
    handle.ctx.prompts.registerSection('acme-widgets/hints', () => '一');
    expectCode(
      () => handle.ctx.prompts.registerSection('acme-widgets/hints', () => '二'),
      'PLUGIN_PROMPT_SECTION_CONFLICT',
    );
  });

  it('core: 件域前缀去前缀比对（core:foo ↔ foo/段）', () => {
    const { handle } = assemble({ pluginId: 'core:foo' });
    expect(() => handle.ctx.prompts.registerSection('foo/bar', () => '')).not.toThrow();
    expectCode(() => handle.ctx.prompts.registerSection('core:foo/bar', () => ''), 'PLUGIN_PROMPT_SLOT_INVALID');
  });
});

describe('触发器注册面（ctx.triggers——03 §2.2 行 108 第十一动词，C 批 C-2）', () => {
  it('triggers.register 委派真源（pluginId 注入 + 注销器透传摘册）', () => {
    const { handle, triggers } = assemble();
    const off = handle.ctx.triggers.register({
      name: 'acme-widgets/daily',
      description: '日结',
      fire: () => undefined,
    });
    expect(triggers.list()).toEqual([{ name: 'acme-widgets/daily', owner: 'acme-widgets', description: '日结' }]);
    off();
    expect(triggers.list()).toEqual([]);
  });

  it('装载窗关后注册拒（PLUGIN_WINDOW_CLOSED——第十一动词同窗律）', () => {
    const { handle } = assemble();
    handle.closeWindow();
    expectCode(
      () => handle.ctx.triggers.register({ name: 'acme-widgets/x', description: '', fire: () => undefined }),
      'PLUGIN_WINDOW_CLOSED',
    );
  });

  it('回调窗内注册合法（§2.4 钩子豁免条款同律）', () => {
    const { handle } = assemble();
    handle.closeWindow();
    const restore = handle.enterHostCallback();
    expect(() =>
      handle.ctx.triggers.register({ name: 'acme-widgets/y', description: '', fire: () => undefined }),
    ).not.toThrow();
    restore();
  });
});

describe('子代理注册面（ctx.agent.registerSubagentProvider——03 §2.2 行 109 第十二动词，D 批 D-2）', () => {
  it('委派真源：owner = pluginId 闭包注入（防冒名——插件不可自报他人 id）+ 注销器透传摘册', () => {
    const { handle, subagents } = assemble();
    const off = handle.ctx.agent.registerSubagentProvider({
      name: 'daily',
      description: '日结',
      systemPrompt: '你是日结员',
    });
    expect(subagents.programmaticProviders()).toEqual([
      { def: { name: 'daily', description: '日结', systemPrompt: '你是日结员' }, owner: 'acme-widgets' },
    ]);
    off();
    expect(subagents.programmaticProviders()).toEqual([]);
    // 摘除后名可再注（卸载回卷即释放名）
    expect(() =>
      handle.ctx.agent.registerSubagentProvider({ name: 'daily', description: '日结', systemPrompt: '你是日结员' }),
    ).not.toThrow();
  });

  it('两闸透传（执法在 SubagentService 真源）：撞名 SUBAGENT_PROVIDER_EXISTS / 词法 SUBAGENT_NAME_INVALID', () => {
    const { handle } = assemble();
    handle.ctx.agent.registerSubagentProvider({ name: 'daily', description: '', systemPrompt: '' });
    expectCode(
      () => handle.ctx.agent.registerSubagentProvider({ name: 'daily', description: '', systemPrompt: '' }),
      'SUBAGENT_PROVIDER_EXISTS',
    );
    expectCode(
      () => handle.ctx.agent.registerSubagentProvider({ name: 'Acme/Daily', description: '', systemPrompt: '' }),
      'SUBAGENT_NAME_INVALID',
    );
  });

  it('消费腿物化（注册即派生——04 §10 程序化注册槽遗漏审计批 G）：service 位落册后物化回调派生工具，注销器两撤', () => {
    const materialized: ProgrammaticSubagentDef[] = [];
    let toolDisposed = 0;
    const { handle, subagents } = assemble({
      subagentToolMaterializer: (def) => {
        materialized.push(def);
        return () => {
          toolDisposed++;
        };
      },
    });
    const off = handle.ctx.agent.registerSubagentProvider({
      name: 'daily',
      description: '日结',
      systemPrompt: '你是日结员',
    });
    // 物化回调吃注册 def 原文（派生 agent_<name> 的单源）；service 位已同落
    expect(materialized).toEqual([{ name: 'daily', description: '日结', systemPrompt: '你是日结员' }]);
    expect(subagents.programmaticProviders()).toHaveLength(1);
    off();
    expect(toolDisposed).toBe(1); // 工具注册位撤
    expect(subagents.programmaticProviders()).toEqual([]); // service 注册位同撤（同生共死）
  });

  it('物化拒整体拒：回调抛错 → service 位回滚 + 原错误直传（不留半注册）', () => {
    let calls = 0;
    const { handle, subagents } = assemble({
      subagentToolMaterializer: () => {
        calls++;
        if (calls === 1) throw new BaseError('TOOL_NAME_CONFLICT', 'agent_daily 派生名重影');
        return () => {};
      },
    });
    expectCode(
      () => handle.ctx.agent.registerSubagentProvider({ name: 'daily', description: '', systemPrompt: '' }),
      'TOOL_NAME_CONFLICT',
    );
    expect(subagents.programmaticProviders()).toEqual([]); // 回滚——半注册结构性不存在
    // 回滚后名可再注（无残留占用；第二次物化放行证明落册从头走）
    expect(() =>
      handle.ctx.agent.registerSubagentProvider({ name: 'daily', description: '', systemPrompt: '' }),
    ).not.toThrow();
    expect(subagents.programmaticProviders()).toHaveLength(1);
  });

  it('装载窗关后注册拒（PLUGIN_WINDOW_CLOSED——第十二动词同窗律）；回调窗内合法', () => {
    const { handle } = assemble();
    handle.closeWindow();
    expectCode(
      () => handle.ctx.agent.registerSubagentProvider({ name: 'x', description: '', systemPrompt: '' }),
      'PLUGIN_WINDOW_CLOSED',
    );
    const restore = handle.enterHostCallback();
    expect(() =>
      handle.ctx.agent.registerSubagentProvider({ name: 'y', description: '', systemPrompt: '' }),
    ).not.toThrow();
    restore();
  });
});

/** 界面后端最小实装形（UiBackend<never>——能力全关、原语缺席的最小后端替身） */
function makeBackend(id: string): UiBackend<never> {
  return {
    id,
    capabilities: {
      notify: true,
      confirm: false,
      select: false,
      input: false,
      approval: false,
      setStatus: false,
      setWidget: false,
    },
    hasAudience: () => true,
    notify: () => undefined,
  };
}

describe('界面后端注册面（ctx.channels.registerUiBackend——03 §2.2 行 110 第十三动词，U3 批 U3-4）', () => {
  it('门检前置：未开门拒 PLUGIN_CAPABILITY_DOOR_CLOSED——连受局面都不可达（默认关语义）', () => {
    const { handle, channels } = assemble();
    expectCode(() => handle.ctx.channels.registerUiBackend(makeBackend('alt')), 'PLUGIN_CAPABILITY_DOOR_CLOSED');
    expect(channels.listPluginBackendIds()).toEqual([]);
  });

  it('开门后委派真源：插件域在册 + 注销器透传摘册 + capability/used 审计落账', () => {
    const events: { type: string; data: Record<string, unknown> }[] = [];
    const { handle, channels } = assemble({
      opens: ['channels.ui-backend'],
      auditSink: { append: (type, data) => events.push({ type, data }) },
    });
    const off = handle.ctx.channels.registerUiBackend(makeBackend('alt'));
    expect(channels.listPluginBackendIds()).toEqual(['alt']);
    // 落账形 = 05 §1.1 载荷（pluginId 归因 + capability 面）
    expect(events).toEqual([
      { type: 'capability/used', data: { pluginId: 'acme-widgets', capability: 'channels.ui-backend' } },
    ]);
    off();
    expect(channels.listPluginBackendIds()).toEqual([]);
  });

  it('门关时审计词不落（落账只在门检通过+受理成功后——拒笔不记使用）', () => {
    const events: { type: string; data: Record<string, unknown> }[] = [];
    const { handle } = assemble({ auditSink: { append: (type, data) => events.push({ type, data }) } });
    expectCode(() => handle.ctx.channels.registerUiBackend(makeBackend('alt')), 'PLUGIN_CAPABILITY_DOOR_CLOSED');
    expect(events).toEqual([]);
  });

  it('执法序：门检先于受局面缺位（开门+受局面缺席 → CONTEXT_SERVICE_MISSING；未开门同配 → 门关码）', () => {
    // 直接构造（不走 assemble——后者恒接真源）：开门下受局面缺席响亮缺位
    const handle = createPluginContext({
      pluginId: 'p',
      scope: Scope.createRoot(),
      dispatch: new EventDispatch(),
      hostFace: HOST_FACE,
      opens: ['channels.ui-backend'],
    });
    expectCode(() => handle.ctx.channels.registerUiBackend(makeBackend('alt')), 'CONTEXT_SERVICE_MISSING');
    // 对照：同配未开门先吃门关码——门检在受局面之前（03 §2.7 执法序）
    const handle2 = createPluginContext({
      pluginId: 'p',
      scope: Scope.createRoot(),
      dispatch: new EventDispatch(),
      hostFace: HOST_FACE,
    });
    expectCode(() => handle2.ctx.channels.registerUiBackend(makeBackend('alt')), 'PLUGIN_CAPABILITY_DOOR_CLOSED');
  });

  it('装载窗关后注册拒（PLUGIN_WINDOW_CLOSED——第十三动词同窗律）；回调窗内合法', () => {
    const { handle } = assemble({ opens: ['channels.ui-backend'] });
    handle.closeWindow();
    expectCode(() => handle.ctx.channels.registerUiBackend(makeBackend('alt')), 'PLUGIN_WINDOW_CLOSED');
    const restore = handle.enterHostCallback();
    expect(() => handle.ctx.channels.registerUiBackend(makeBackend('alt2'))).not.toThrow();
    restore();
  });

  it('sink 缺席不阻拦（:memory: 诊断形零成本缺席——受理照常）', () => {
    const { handle, channels } = assemble({ opens: ['channels.ui-backend'] });
    expect(() => handle.ctx.channels.registerUiBackend(makeBackend('alt'))).not.toThrow();
    expect(channels.listPluginBackendIds()).toEqual(['alt']);
  });
});

describe('ctx.effect 与服务目录', () => {
  it('effect 计频率数 + LIFO 回卷经插件作用域', async () => {
    const { handle, scope } = assemble();
    const order: string[] = [];
    handle.ctx.effect(() => () => order.push('one'));
    handle.ctx.effect(() => () => order.push('two'));
    await scope.dispose();
    expect(order).toEqual(['two', 'one']);
  });

  it('get 缺席报错附现行服务目录名单（message 含名单 + 插件归因）', () => {
    const { handle, scope } = assemble();
    scope.provide('known-svc', 1);
    try {
      handle.ctx.get('typo-name');
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('CONTEXT_SERVICE_MISSING');
        expect(err.message).toContain('known-svc'); // 目录名单在场——点名错误当场可诊
        expect(err.message).toContain('acme-widgets'); // 归因插件 id
        return;
      }
      throw err;
    }
  });
});

describe('ctx.provide（03 §2.2 表行——Kahn 解锁动词）', () => {
  /** 装配带 provide 委派位（目标 = 独立记录面——委派真达的判据） */
  const assembleWithProvide = () => {
    const provided: Array<[string, unknown]> = [];
    const base = assemble();
    const handle = createPluginContext({
      pluginId: 'acme-widgets',
      scope: base.scope,
      dispatch: base.dispatch,
      hostFace: HOST_FACE,
      provide: (name, service) => provided.push([name, service]),
    });
    return { ...base, handle, provided };
  };

  it('窗内委派真达共享根（name/service 透传 + 无返回值）', () => {
    const { handle, provided } = assembleWithProvide();
    handle.ctx.provide('acme-svc', { answer: 42 });
    expect(provided).toEqual([['acme-svc', { answer: 42 }]]);
  });

  it('关窗后拒（PLUGIN_WINDOW_CLOSED——注册动词族窗口律随行）', () => {
    const { handle, provided } = assembleWithProvide();
    handle.closeWindow();
    expectCode(() => handle.ctx.provide('late-svc', 1), 'PLUGIN_WINDOW_CLOSED');
    expect(provided).toEqual([]); // 拒于受理前——委派不发生
  });

  it('计频率护栏动作数（与注册动词同池——超限拒）', () => {
    const scope = Scope.createRoot();
    const dispatch = new EventDispatch();
    const handle = createPluginContext({
      pluginId: 'acme-widgets',
      scope,
      dispatch,
      hostFace: HOST_FACE,
      provide: () => undefined,
      rateLimit: { windowMs: 1000, max: 3 },
    });
    handle.ctx.provide('a', 1);
    handle.ctx.provide('b', 2);
    handle.ctx.provide('c', 3);
    expectCode(() => handle.ctx.provide('d', 4), 'PLUGIN_RATE_LIMITED');
  });

  it('受局面缺位响亮（CONTEXT_SERVICE_MISSING——装配缺陷不静默）', () => {
    const { handle } = assemble(); // assemble 不接 provide 位 = 缺席态
    expectCode(() => handle.ctx.provide('any-svc', 1), 'CONTEXT_SERVICE_MISSING');
  });
});

describe('高危面门检挂载（03 §4.6 批 U2——handle 门检面）', () => {
  it('授予集物化：opens 注入 → grantedOpens 精确集合；缺席 → 空集（全默认关）', () => {
    const { handle } = assemble({ opens: ['channels.ui-backend', 'sdk.register-route'] });
    expect(handle.grantedOpens.size).toBe(2);
    expect(handle.grantedOpens.has('channels.ui-backend')).toBe(true);
    expect(handle.grantedOpens.has('sdk.register-route')).toBe(true);
    const bare = assemble();
    expect(bare.handle.grantedOpens.size).toBe(0);
  });

  it('assertDoor 授予位含此名即过（不抛）', () => {
    const { handle } = assemble({ opens: ['sdk.register-route'] });
    expect(() => handle.assertDoor('sdk.register-route')).not.toThrow();
  });

  it('assertDoor 高危面未授予 → PLUGIN_CAPABILITY_DOOR_CLOSED（message 指路 opens 写法 + 点名插件）', () => {
    const { handle } = assemble({ opens: ['sdk.register-route'] });
    try {
      handle.assertDoor('channels.ui-backend');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      if (err instanceof BaseError) {
        expect(err.code).toBe('PLUGIN_CAPABILITY_DOOR_CLOSED');
        expect(err.message).toContain('channels.ui-backend');
        expect(err.message).toContain('opens');
        expect(err.message).toContain('acme-widgets');
      }
    }
  });

  it('assertDoor 非高危面名同码分流拒（not-a-door 装配缺陷面——message 含名单指路）', () => {
    const { handle } = assemble({ opens: ['channels.ui-backend'] });
    try {
      handle.assertDoor('channels.render');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      if (err instanceof BaseError) {
        expect(err.code).toBe('PLUGIN_CAPABILITY_DOOR_CLOSED');
        expect(err.message).toContain('不在高危面名单');
      }
    }
  });

  it('门检面不进 ctx 插件面（结构性——开门是宿主裁决面，插件探测不到门检存在）', () => {
    const { handle } = assemble({ opens: ['sdk.register-route'] });
    const ctx = handle.ctx as unknown as Record<string, unknown>;
    expect('grantedOpens' in ctx).toBe(false);
    expect('assertDoor' in ctx).toBe(false);
    expect('opens' in ctx).toBe(false);
  });

  it('关窗后门检照常（宿主裁决面不吃装载窗律——回调窗内换装场景〔U3〕可判）', () => {
    const { handle } = assemble({ opens: ['sdk.register-route'] });
    handle.closeWindow();
    expect(() => handle.assertDoor('sdk.register-route')).not.toThrow();
    expectCode(() => handle.assertDoor('channels.ui-backend'), 'PLUGIN_CAPABILITY_DOOR_CLOSED');
  });

  it('门关码已注册错误码册（import 发生才注册——host 域 PLUGIN_ 族）', () => {
    expect(getErrorCodeInfo('PLUGIN_CAPABILITY_DOOR_CLOSED')?.module).toBe('host');
    expect(getErrorCodeInfo('PLUGIN_CAPABILITY_DOOR_CLOSED')?.description).toBeTruthy();
  });
});

/* ---------------- 会话活体订阅（04 §6 e-2 观测腿订阅动词） ---------------- */

describe('会话活体订阅（ctx.events.subscribeSessionLifecycle——04 §6 e-2）', () => {
  /** 本组装配：session/lifecycle 词预注册（装配根预注册位的测试模拟——驱动
   * 自举双源在 driver.test 域；词汇注册纪律：dispatch.on 未注册词 fail-loud） */
  function assembleSub(overrides?: Parameters<typeof assemble>[0]) {
    const assembled = assemble(overrides);
    if (!assembled.dispatch.isRegistered(SESSION_LIFECYCLE_EVENT)) {
      assembled.dispatch.registerEventNames([SESSION_LIFECYCLE_EVENT]);
    }
    return assembled;
  }

  it('self 档：锚会话事件透投、他会话滤除（树内白给——零开门零审计）', async () => {
    const events: unknown[] = [];
    const { handle, dispatch } = assembleSub();
    handle.ctx.events.subscribeSessionLifecycle((event) => void events.push(event), {
      scope: 'self',
      sessionId: 'anchor-1',
    });
    await dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 'anchor-1', phase: 'run-started' });
    await dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 'other-9', phase: 'run-started' });
    expect(events).toEqual([{ sessionId: 'anchor-1', phase: 'run-started' }]);
  });

  it('tree 档：isSameTree 判真透投、判假滤除（血缘受局面消费；同 id 特例含于链上溯）', async () => {
    const events: unknown[] = [];
    const { handle, dispatch } = assembleSub({
      sessionLineage: { isSameTree: (a, b) => a.startsWith('t-') && b.startsWith('t-') },
    });
    handle.ctx.events.subscribeSessionLifecycle((event) => void events.push(event), {
      scope: 'tree',
      sessionId: 't-anchor',
    });
    await dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 't-anchor', phase: 'run-settled' });
    await dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 't-child', phase: 'run-started' });
    await dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 'other-9', phase: 'run-started' });
    expect(events).toEqual([
      { sessionId: 't-anchor', phase: 'run-settled' },
      { sessionId: 't-child', phase: 'run-started' },
    ]);
  });

  it('tree 档受局面缺席响亮拒（CONTEXT_SERVICE_MISSING——装配缺陷非插件错）', () => {
    const { handle } = assembleSub();
    expectCode(
      () => handle.ctx.events.subscribeSessionLifecycle(() => undefined, { scope: 'tree', sessionId: 'x' }),
      'CONTEXT_SERVICE_MISSING',
    );
  });

  it('all 档门检：默认关拒 PLUGIN_CAPABILITY_DOOR_CLOSED；开门受理 + 全会话透投', async () => {
    const events: unknown[] = [];
    const denied = assembleSub();
    expectCode(
      () => denied.handle.ctx.events.subscribeSessionLifecycle(() => undefined),
      'PLUGIN_CAPABILITY_DOOR_CLOSED',
    );
    const granted = assembleSub({ opens: ['sessions.observe-cross'] });
    granted.handle.ctx.events.subscribeSessionLifecycle((event) => void events.push(event));
    await granted.dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 'any-1', phase: 'run-started' });
    await granted.dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 'any-2', phase: 'run-settled' });
    expect(events).toHaveLength(2);
  });

  it('doors 段单独开门即过（双源并集律第二源——行 opens 空不阻）+ 审计同落', () => {
    const audit: { type: string; data: Record<string, unknown> }[] = [];
    const { handle } = assembleSub({
      crossDoors: () => new Set(['sessions.observe-cross']),
      auditSink: { append: (type, data) => audit.push({ type, data }) },
    });
    expect(() => handle.ctx.events.subscribeSessionLifecycle(() => undefined)).not.toThrow();
    expect(audit).toEqual([
      {
        type: 'capability/used',
        data: {
          pluginId: 'acme-widgets',
          capability: 'sessions.observe-cross',
          verb: 'subscribeSessionLifecycle',
          scope: 'all',
        },
      },
    ]);
  });

  it('两源皆不含拒（doors 段在场但无此门——并判非段即全开）', () => {
    const { handle } = assembleSub({
      opens: ['sdk.register-route'],
      crossDoors: () => new Set(['sessions.control-cross']),
    });
    expectCode(() => handle.ctx.events.subscribeSessionLifecycle(() => undefined), 'PLUGIN_CAPABILITY_DOOR_CLOSED');
  });

  it('doors 撤位即收回（活体现读现判——同一装配两次受理两次判）', () => {
    let live = new Set(['sessions.observe-cross']);
    const { handle } = assembleSub({ crossDoors: () => live });
    expect(() => handle.ctx.events.subscribeSessionLifecycle(() => undefined)).not.toThrow();
    live = new Set<string>(); // /reload 撤位（撤 doors 段行）
    expectCode(() => handle.ctx.events.subscribeSessionLifecycle(() => undefined), 'PLUGIN_CAPABILITY_DOOR_CLOSED');
  });

  it('crossDoors 缺席只吃行 opens（旧装配兼容——第二源缺席不凭空开门）', () => {
    const { handle } = assembleSub({ opens: ['sessions.observe-cross'] });
    expect(() => handle.ctx.events.subscribeSessionLifecycle(() => undefined)).not.toThrow();
  });

  it('doors 命中不污染 grantedOpens（分立判定位——局部合成集只喂裁决核）', () => {
    const { handle } = assembleSub({ crossDoors: () => new Set(['sessions.observe-cross']) });
    expect(() => handle.ctx.events.subscribeSessionLifecycle(() => undefined)).not.toThrow();
    expect(handle.grantedOpens.has('sessions.observe-cross')).toBe(false); // 全局面维持装载期物化
    expect(handle.grantedOpens.size).toBe(0);
  });

  it('all 档审计恰一笔（受理成功时——逐事件不追加：推送非使用动作）', async () => {
    const audit: { type: string; data: Record<string, unknown> }[] = [];
    const { handle, dispatch } = assembleSub({
      opens: ['sessions.observe-cross'],
      auditSink: { append: (type, data) => audit.push({ type, data }) },
    });
    handle.ctx.events.subscribeSessionLifecycle(() => undefined);
    await dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 's', phase: 'run-started' });
    await dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 's', phase: 'run-settled' });
    expect(audit).toEqual([
      {
        type: 'capability/used',
        data: {
          pluginId: 'acme-widgets',
          capability: 'sessions.observe-cross',
          verb: 'subscribeSessionLifecycle',
          scope: 'all',
        },
      },
    ]);
  });

  it('门关拒笔不落账（拒不记使用——registerUiBackend 同律）', () => {
    const audit: { type: string; data: Record<string, unknown> }[] = [];
    const { handle } = assembleSub({ auditSink: { append: (type, data) => audit.push({ type, data }) } });
    expectCode(() => handle.ctx.events.subscribeSessionLifecycle(() => undefined), 'PLUGIN_CAPABILITY_DOOR_CLOSED');
    expect(audit).toEqual([]);
  });

  it('坏形拒 SESSION_OBSERVE_SCOPE_INVALID：非三值词面 / self·tree 缺锚（不静默升降档）', () => {
    const { handle } = assembleSub();
    expectCode(
      () => handle.ctx.events.subscribeSessionLifecycle(() => undefined, { scope: 'global' as never }),
      'SESSION_OBSERVE_SCOPE_INVALID',
    );
    expectCode(
      () => handle.ctx.events.subscribeSessionLifecycle(() => undefined, { scope: 'self' }),
      'SESSION_OBSERVE_SCOPE_INVALID',
    );
    expectCode(
      () => handle.ctx.events.subscribeSessionLifecycle(() => undefined, { scope: 'tree' }),
      'SESSION_OBSERVE_SCOPE_INVALID',
    );
    expectCode(
      () => handle.ctx.events.subscribeSessionLifecycle(() => undefined, { scope: 'self', sessionId: '' }),
      'SESSION_OBSERVE_SCOPE_INVALID',
    );
  });

  it('回卷律：返回退订器即撤；插件作用域 dispose 撤订（effect 挂载——unload 撤订）', async () => {
    const events: unknown[] = [];
    const { handle, dispatch, scope } = assembleSub();
    const off = handle.ctx.events.subscribeSessionLifecycle((event) => void events.push(event), {
      scope: 'self',
      sessionId: 'a',
    });
    // 第二订阅不持返回器（回卷腿走作用域 dispose——effect 挂载位的正身验证）
    handle.ctx.events.subscribeSessionLifecycle((event) => void events.push(event), {
      scope: 'self',
      sessionId: 'b',
    });
    off();
    await dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 'a', phase: 'run-started' });
    await dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 'b', phase: 'run-started' });
    expect(events).toEqual([{ sessionId: 'b', phase: 'run-started' }]); // a 已显式退订
    await scope.dispose(); // effect 回卷——b 随插件作用域撤订
    await dispatch.emit(SESSION_LIFECYCLE_EVENT, { sessionId: 'b', phase: 'run-settled' });
    expect(events).toHaveLength(1);
  });

  it('装载窗关后拒（PLUGIN_WINDOW_CLOSED——订阅动词同窗律）', () => {
    const { handle } = assembleSub();
    handle.closeWindow();
    expectCode(
      () => handle.ctx.events.subscribeSessionLifecycle(() => undefined, { scope: 'self', sessionId: 'x' }),
      'PLUGIN_WINDOW_CLOSED',
    );
  });
});

describe('session_before_compact 归因两律（U4-3——05 §2.1 接管缝）', () => {
  /**
   * 归因 rig：单 dispatch 双插件 ctx（词汇预注册同源——两监听挂同管线，
   * 注册序 [first, second] = 值链上游/下游）。
   */
  function assembleTwo() {
    const dispatch = new EventDispatch();
    dispatch.registerEventNames(PLUGIN_HOOK_VOCABULARY.map((h) => h.name));
    const make = (pluginId: string) =>
      createPluginContext({ pluginId, scope: Scope.createRoot(), dispatch, hostFace: HOST_FACE });
    return { first: make('p-first'), second: make('p-second'), dispatch };
  }

  /** 种箱 + 派发 + 读末位（conversation-stack dispatchBeforeCompact 同构） */
  async function dispatchSeeded(dispatch: EventDispatch, value: Record<string, unknown>) {
    const box: BeforeCompactAttribution = {};
    const seeded = Object.assign({}, value, { [BEFORE_COMPACT_ATTRIB]: box });
    const out = await dispatch.waterfall('session_before_compact', seeded);
    return { out, lastAdjustedBy: box.lastAdjustedBy };
  }

  it('值链改写记名末位胜：两插件先后改 plan——箱记下游者；放行者不记名', async () => {
    const { first, second, dispatch } = assembleTwo();
    first.ctx.on('session_before_compact', (value, next) => next({ ...(value as object), plan: { start: 2 } }));
    second.ctx.on('session_before_compact', (value, next) => next(value)); // 原值透传
    const { out, lastAdjustedBy } = await dispatchSeeded(dispatch, { sessionId: 's', plan: { start: 1 } });
    expect((out as unknown as { plan: { start: number } }).plan.start).toBe(2);
    expect(lastAdjustedBy).toBe('p-first'); // 透传者不记名——只有改写者记
  });

  it('末位改写者胜：两插件皆改写——箱记下游（末位 = 最后改写者）', async () => {
    const { first, second, dispatch } = assembleTwo();
    first.ctx.on('session_before_compact', (value, next) => next({ ...(value as object), plan: { start: 2 } }));
    second.ctx.on('session_before_compact', (value, next) => next({ ...(value as object), plan: { start: 3 } }));
    const { out, lastAdjustedBy } = await dispatchSeeded(dispatch, { sessionId: 's', plan: { start: 1 } });
    expect((out as unknown as { plan: { start: number } }).plan.start).toBe(3);
    expect(lastAdjustedBy).toBe('p-second');
  });

  it('接管位铸造：自填 pluginId 被覆写为本插件；下游透传不夺上游接管归因', async () => {
    const { first, second, dispatch } = assembleTwo();
    const summarize = async () => ({ text: '接管摘要' });
    first.ctx.on('session_before_compact', (value, next) =>
      next({ ...(value as object), takeover: { pluginId: 'p-forged', summarize } }),
    );
    second.ctx.on('session_before_compact', (value, next) => next(value)); // 透传——归因不夺
    const { out } = await dispatchSeeded(dispatch, { sessionId: 's', plan: { start: 1 } });
    expect((out as unknown as { takeover: { pluginId: string } }).takeover.pluginId).toBe('p-first'); // 铸造覆写
  });

  it('短路形同律：未委托直接返回——返回值即管线终值，同律记名铸造', async () => {
    const { first, second, dispatch } = assembleTwo();
    const summarize = async () => ({ text: '短路摘要' });
    first.ctx.on('session_before_compact', (value) => ({
      ...(value as object),
      plan: { start: 9 },
      takeover: { pluginId: 'p-forged', summarize },
    }));
    let downstreamRan = false;
    second.ctx.on('session_before_compact', (value) => {
      downstreamRan = true;
      return next0(value);
    });
    const { out, lastAdjustedBy } = await dispatchSeeded(dispatch, { sessionId: 's', plan: { start: 1 } });
    expect(downstreamRan).toBe(false); // 短路——后段不执行
    expect((out as unknown as { plan: { start: number } }).plan.start).toBe(9);
    expect((out as unknown as { takeover: { pluginId: string } }).takeover.pluginId).toBe('p-first');
    expect(lastAdjustedBy).toBe('p-first');
  });

  it('非接管缝 waterfall 零接触：通用钩子值无箱——改写不记名不铸造（结构判据 = 箱在场）', async () => {
    const { handle, dispatch } = assemble();
    handle.ctx.on('context_transform', (value, next) => next([...(value as string[]), 'acme']));
    const out = await dispatch.waterfall('context_transform', ['m1']);
    expect(out).toEqual(['m1', 'acme']); // 通用管线行为不变
  });
});

/** 短路例第二监听者的直通占位（形态满足——不会被执行） */
function next0(value: unknown): Promise<unknown> {
  return Promise.resolve(value);
}

// ---- ctx.ui 消费腿（ix-2——07 §4.3 消费腿条款：会话锚定档位表） ----

/**
 * 全能力记录型通道后端（mock 只停通道后端层——AskQueue/降级链核层真身直用，
 * 立题档测试纪律）：confirm/select/input 三形 + setStatus 记录位。
 * resolveAsks = true 时阻塞原语立即应答（成功往返断言）；false 时永挂
 * （挂起入队 per-session 断言——测试尾 catch 防未处理拒绝）。
 */
function makeFullBackend(opts?: { resolveAsks?: boolean; audience?: boolean }): {
  backend: UiBackend<never>;
  calls: { notify: Array<{ message: string; level?: string }>; setStatus: string[] };
} {
  const calls = { notify: [] as Array<{ message: string; level?: string }>, setStatus: [] as string[] };
  const resolveAsks = opts?.resolveAsks ?? false;
  const pending = new Promise<never>(() => undefined);
  return {
    calls,
    backend: {
      id: 'fake-full',
      capabilities: {
        notify: true,
        confirm: true,
        select: true,
        input: true,
        approval: true,
        setStatus: true,
        setWidget: true,
      },
      hasAudience: () => opts?.audience ?? true,
      notify: (message, notifyOpts) => {
        calls.notify.push({ message, level: notifyOpts?.level });
      },
      confirm: () => (resolveAsks ? Promise.resolve(true) : pending),
      select: () => (resolveAsks ? Promise.resolve('a') : pending),
      input: () => (resolveAsks ? Promise.resolve('typed') : pending),
      setStatus: (_sid, status) => {
        calls.setStatus.push(status);
      },
      setWidget: () => undefined,
    },
  };
}

/** channelsUi 适配闭包（assembly 注入位同形——notify 首参空位：核层 void 恒扇出） */
function adaptChannelsUi(svc: ReturnType<typeof createChannels>): ChannelsUiFace {
  return {
    notify: (message, opts) => svc.notify('', message, opts),
    confirm: (sid, message, opts) => svc.confirm(sid, message, opts),
    select: (sid, message, choices, opts) => svc.select(sid, message, choices, opts),
    input: (sid, message, opts) => svc.input(sid, message, opts),
    setStatus: (sid, status) => svc.setStatus(sid, status),
    setWidget: (sid, node) => svc.setWidget(sid, node),
    hasAudience: () => svc.hasAudience(),
    hasSession: (sid) => svc.hasSession(sid),
  };
}

describe('ctx.ui 消费腿（ix-2——07 §4.3 会话锚定档位表）', () => {
  it('档位 2 无锚拒：装载期/无锚后台语境 confirm 缺席 sessionId 且无 ambient 锚 = UI_ASK_UNANCHORED', () => {
    const channels = createChannels();
    const { handle } = assemble({ channels, channelsUi: adaptChannelsUi(channels) });
    channels.registerSession('s1');
    expectCode(() => handle.ctx.ui.confirm('继续?'), 'UI_ASK_UNANCHORED');
  });

  it('受局面缺席分档：阻塞三件/notify/hasAudience 响亮 CONTEXT_SERVICE_MISSING，单向原语降档 no-op warn', () => {
    const warns: string[] = [];
    const { handle } = assemble({ uiWarn: (m) => warns.push(m) });
    expectCode(() => handle.ctx.ui.confirm('x'), 'CONTEXT_SERVICE_MISSING');
    expectCode(() => handle.ctx.ui.notify('x'), 'CONTEXT_SERVICE_MISSING');
    expectCode(() => handle.ctx.ui.hasAudience(), 'CONTEXT_SERVICE_MISSING');
    expect(() => handle.ctx.ui.setStatus('idle')).not.toThrow(); // 无受局面 + 无锚——双重降档仍 no-op
    expect(warns.length).toBe(1);
  });

  it('档位 2 命令执行窗自动锚：ALS 语境内 confirm 挂起进发起会话的 per-session 队', () => {
    const channels = createChannels();
    const { handle } = assemble({ channels, channelsUi: adaptChannelsUi(channels) });
    channels.registerSession('s1');
    const p = runWithSessionAnchor('s1', () => handle.ctx.ui.confirm('继续?'));
    p.catch(() => undefined); // 永挂后端——防会话收口腿的未处理拒绝
    expect(channels.pendingAsks('s1')).toHaveLength(1);
  });

  it('档位 2 锚随异步链继承：fire-and-forget 尾链（微任务续体）保留 ambient 锚', async () => {
    const channels = createChannels();
    const { handle } = assemble({ channels, channelsUi: adaptChannelsUi(channels) });
    channels.registerSession('s1');
    const { backend } = makeFullBackend(); // confirm 永挂——队列不收口（无 capability 后端的降级链会在微任务边界清队，测不到在队真值）
    channels.addBackend(backend);
    // 模拟命令 handler 的尾链：handler 已返回、任务稍后自起——锚仍在
    runWithSessionAnchor('s1', () => {
      void Promise.resolve().then(() => {
        handle.ctx.ui.confirm('任务完成，继续?').catch(() => undefined);
      });
    });
    await new Promise((r) => setTimeout(r, 0)); // 微任务落定
    expect(channels.pendingAsks('s1')).toHaveLength(1);
  });

  it('档位 2 显式位优先：ambient s1 在场而显式 s2 → 入 s2 队不入 s1 队', () => {
    const channels = createChannels();
    const { handle } = assemble({ channels, channelsUi: adaptChannelsUi(channels) });
    channels.registerSession('s1');
    channels.registerSession('s2');
    runWithSessionAnchor('s1', () => {
      handle.ctx.ui.confirm('问 s2', { sessionId: 's2' }).catch(() => undefined);
    });
    expect(channels.pendingAsks('s2')).toHaveLength(1);
    expect(channels.pendingAsks('s1')).toHaveLength(0);
  });

  it('锚时效：会话不在在册集（未注册/已注销）= UI_ASK_SESSION_CLOSED——陈年锚不悬死', () => {
    const channels = createChannels();
    const { handle } = assemble({ channels, channelsUi: adaptChannelsUi(channels) });
    expectCode(() => handle.ctx.ui.confirm('x', { sessionId: 'gone' }), 'UI_ASK_SESSION_CLOSED');
    channels.registerSession('s1');
    channels.unregisterSession('s1'); // 注销后再问（尾链晚到形）
    expectCode(() => handle.ctx.ui.confirm('x', { sessionId: 's1' }), 'UI_ASK_SESSION_CLOSED');
  });

  it('钩子窗禁律：guard 窗内阻塞三件拒 UI_ASK_WINDOW_INVALID——判序窗判前置锚判（显式 sessionId 亦拒）', () => {
    const guard = createHookDispatchGuard();
    const channels = createChannels();
    const { handle } = assemble({
      channels,
      channelsUi: adaptChannelsUi(channels),
      hookDispatchGuard: guard,
    });
    channels.registerSession('s1');
    guard.enter();
    try {
      expectCode(() => handle.ctx.ui.confirm('x', { sessionId: 's1' }), 'UI_ASK_WINDOW_INVALID');
      expectCode(
        () => handle.ctx.ui.select('x', [{ value: 'a', label: 'A' }], { sessionId: 's1' }),
        'UI_ASK_WINDOW_INVALID',
      );
      expectCode(() => handle.ctx.ui.input('x', { sessionId: 's1' }), 'UI_ASK_WINDOW_INVALID');
      expect(() => handle.ctx.ui.setStatus('busy', { sessionId: 's1' })).not.toThrow(); // 单向原语窗内合法
    } finally {
      guard.exit();
    }
    // 窗外恢复可挂
    handle.ctx.ui.confirm('x', { sessionId: 's1' }).catch(() => undefined);
    expect(channels.pendingAsks('s1')).toHaveLength(1);
  });

  it('档位 3 单向原语：无锚 no-op warn 一行不炸；显式锚透传真身', () => {
    const warns: string[] = [];
    const channels = createChannels();
    const { handle } = assemble({ channels, channelsUi: adaptChannelsUi(channels), uiWarn: (m) => warns.push(m) });
    const { backend, calls } = makeFullBackend();
    channels.addBackend(backend);
    channels.registerSession('s1');
    expect(() => handle.ctx.ui.setStatus('idle')).not.toThrow();
    expect(warns.length).toBe(1);
    handle.ctx.ui.setStatus('busy', { sessionId: 's1' }); // 显式锚在册——直传核层（槽位语义无锚时效拒）
    expect(calls.setStatus).toContain('busy');
  });

  it('档位 1 notify/hasAudience 无会话位恒可：后端扇出 + 探针直读', () => {
    const channels = createChannels();
    const { handle } = assemble({ channels, channelsUi: adaptChannelsUi(channels) });
    const { backend, calls } = makeFullBackend({ audience: false });
    channels.addBackend(backend);
    handle.ctx.ui.notify('部署完成', { level: 'success' });
    expect(calls.notify).toEqual([{ message: '部署完成', level: 'success' }]);
    expect(handle.ctx.ui.hasAudience()).toBe(false);
  });

  it('护栏增位：ctx.ui 动作计入滑动窗（第三动作拒），hasAudience 免计', () => {
    const channels = createChannels();
    const { handle } = assemble({
      channels,
      channelsUi: adaptChannelsUi(channels),
      rateLimit: { windowMs: 60_000, max: 2 },
    });
    channels.registerSession('s1');
    handle.ctx.ui.notify('a');
    handle.ctx.ui.notify('b');
    expectCode(() => handle.ctx.ui.notify('c'), 'PLUGIN_RATE_LIMITED');
    expect(handle.ctx.ui.hasAudience()).toBe(false); // 免计——超限后探针仍可
  });

  it('成功往返：解析后端 confirm/select/input 三值回传 + opts 剥 sessionId 透传核层形', async () => {
    const channels = createChannels();
    const { handle } = assemble({ channels, channelsUi: adaptChannelsUi(channels) });
    channels.registerSession('s1');
    const { backend } = makeFullBackend({ resolveAsks: true });
    channels.addBackend(backend);
    expect(await runWithSessionAnchor('s1', () => handle.ctx.ui.confirm('继续?'))).toBe(true);
    expect(await runWithSessionAnchor('s1', () => handle.ctx.ui.select('选', [{ value: 'a', label: 'A' }]))).toBe('a');
    expect(await runWithSessionAnchor('s1', () => handle.ctx.ui.input('输入'))).toBe('typed');
  });
});

describe('session-anchor ALS 件（ix-2——命令执行窗自动锚载体）', () => {
  it('run 内可读、run 外无痕、exit 遮蔽、退出恢复', () => {
    expect(readSessionAnchor()).toBeUndefined(); // 外无痕
    runWithSessionAnchor('s1', () => {
      expect(readSessionAnchor()).toBe('s1');
      withoutSessionAnchor(() => {
        expect(readSessionAnchor()).toBeUndefined(); // 遮蔽位（装载 apply/钩子派发两包裹）
      });
      expect(readSessionAnchor()).toBe('s1'); // 遮蔽退出即恢复
    });
    expect(readSessionAnchor()).toBeUndefined();
  });

  it('async 语境跟随：run 派生的 await 续体保留锚（尾链继承机制本体）', async () => {
    const seen: Array<string | undefined> = [];
    await runWithSessionAnchor('tail', async () => {
      seen.push(readSessionAnchor());
      await Promise.resolve();
      seen.push(readSessionAnchor()); // await 恢复仍在锚内
    });
    seen.push(readSessionAnchor());
    expect(seen).toEqual(['tail', 'tail', undefined]);
  });

  it('exit 的 async 续体结构性无锚（装载期遮蔽覆盖 apply 全执行段）', async () => {
    const seen: Array<string | undefined> = [];
    await runWithSessionAnchor('cmd', async () => {
      await withoutSessionAnchor(async () => {
        seen.push(readSessionAnchor());
        await Promise.resolve();
        seen.push(readSessionAnchor()); // apply 内 await 恢复仍无锚
      });
      seen.push(readSessionAnchor()); // apply 返回后 ambient 恢复（fire-and-forget 尾链自理边界）
    });
    expect(seen).toEqual([undefined, undefined, 'cmd']);
  });
});
