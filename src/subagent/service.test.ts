/**
 * SubagentService 测试——委派机器编舞（04 §10）：深度帽/静态路由/预检闸/
 * 派生面交集/one-shot 黑盒不重试/background「通知先落、Job 条目后销」
 * 结算序/审批挂起注入（one-shot 不注入）/协作停止观察/terminalOf 三映射。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  BaseError,
  type ProgrammaticSubagentDef,
  type SubagentProvider,
  type SubagentRequest,
  type SubagentResult,
} from '../contracts/index.js';
import { createJobRegistry, type JobHandle, type JobRegistry } from './registry.js';
import { createSubagentService, type SubagentService } from './service.js';
import { createDeclarativeAgentTool } from './tool.js';
import type { SubagentNotifyFace } from './types.js';

/** 断言 async 抛指定码（返错误供 message 断言） */
async function expectCode(promise: Promise<unknown>, code: string): Promise<BaseError> {
  try {
    await promise;
    expect.unreachable(`应抛 ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
    return err as BaseError;
  }
}

/** 全能力面（与 IN_PROCESS_CAPABILITIES 同形——测试本地铸，不依赖机器常量） */
const FULL_CAPS = { tools: true, streaming: true, cancel: true, background: true, structuredOutput: true } as const;

/**
 * 可控假 provider：run 收集请求、结算由测试方推杆；auto 形立即收场
 * （one-shot 同步腿/深度帽等无需挂起的用例）。
 */
class FakeProvider implements SubagentProvider {
  readonly requests: SubagentRequest[] = [];
  readonly capabilities = FULL_CAPS;
  private resolveRun?: (result: SubagentResult) => void;
  private rejectRun?: (err: unknown) => void;

  constructor(private readonly auto?: SubagentResult) {}

  run(request: SubagentRequest): Promise<SubagentResult> {
    this.requests.push(request);
    if (this.auto !== undefined) return Promise.resolve(this.auto);
    return new Promise<SubagentResult>((resolve, reject) => {
      this.resolveRun = resolve;
      this.rejectRun = reject;
    });
  }

  /** 推杆：正常收场 */
  settle(result: SubagentResult): void {
    this.resolveRun?.(result);
  }

  /** 推杆：异常收场 */
  fail(err: unknown): void {
    this.rejectRun?.(err);
  }
}

/** 装配体（registry + service + 全能力假 provider 已注册 'in-process'） */
function assemble(options: { auto?: SubagentResult; registry?: JobRegistry } = {}): {
  service: SubagentService;
  registry: JobRegistry;
  provider: FakeProvider;
  order: string[];
} {
  const registry = options.registry ?? createJobRegistry();
  const provider = new FakeProvider(options.auto);
  const order: string[] = [];
  const notify: SubagentNotifyFace = {
    async notifySettled(input) {
      order.push('notify');
      order.push(`notify:${input.parentSessionId}`);
    },
    async notifyApprovalPending(input) {
      order.push(`approval:${input.jobName}:${input.approvalId}`);
    },
  };
  const service = createSubagentService({
    registry,
    notify,
    onSettled: (settlement) => {
      order.push('onSettled');
      expect(settlement.parentSessionId).toBe('s1');
    },
  });
  service.registerProvider('in-process', provider);
  return { service, registry, provider, order };
}

/** 句柄捕手：包装注册表截留 register 返回柄（stopRequested 腿用） */
function captureHandles(registry: JobRegistry): { wrapped: JobRegistry; handles: JobHandle[] } {
  const handles: JobHandle[] = [];
  const wrapped: JobRegistry = {
    registerKind: (kind) => registry.registerKind(kind),
    hasKind: (kind) => registry.hasKind(kind),
    register: (input) => {
      const handle = registry.register(input);
      handles.push(handle);
      return handle;
    },
    closeOwner: (owner) => registry.closeOwner(owner),
    list: () => registry.list(),
    running: () => registry.running(),
    get: (id) => registry.get(id),
  };
  return { wrapped, handles };
}

const BASE_INPUT = {
  prompt: '去找东西',
  parentSessionId: 's1',
  depth: 1,
} as const;

describe('委派边界执法', () => {
  it('撞名拒：registerProvider 同名二次抛 SUBAGENT_PROVIDER_EXISTS', () => {
    const { service } = assemble();
    const dupe: SubagentProvider = { capabilities: FULL_CAPS, run: async () => ({ output: '', stopReason: 'stop' }) };
    expect(() => service.registerProvider('in-process', dupe)).toThrow(BaseError);
    try {
      service.registerProvider('in-process', dupe);
    } catch (err) {
      expect((err as BaseError).code).toBe('SUBAGENT_PROVIDER_EXISTS');
    }
  });

  it('深度帽：depth 4 > 帽 3 拒 SUBAGENT_DEPTH_EXCEEDED；帽内放行且 request.depth = 父深度 + 1', async () => {
    const { service, provider } = assemble({ auto: { output: '', stopReason: 'stop' } });
    const err = await expectCode(service.run({ ...BASE_INPUT, depth: 4 }), 'SUBAGENT_DEPTH_EXCEEDED');
    expect(err.message).toContain('3');
    await service.run({ ...BASE_INPUT, depth: 3 }); // 合法末层
    expect(provider.requests[0]!.depth).toBe(4); // 子栈工具深度位——再委派即超帽
  });

  it('静态路由：未注册 provider 拒 SUBAGENT_PROVIDER_UNKNOWN', async () => {
    const { service } = assemble({ auto: { output: '', stopReason: 'stop' } });
    await expectCode(service.run({ ...BASE_INPUT, providerName: 'ghost' }), 'SUBAGENT_PROVIDER_UNKNOWN');
  });

  it('预检闸：requiresTools 缺口拒 SUBAGENT_PRECHECK_FAILED 并回执缺口清单', async () => {
    const { service } = assemble({ auto: { output: '', stopReason: 'stop' } });
    const err = await expectCode(
      service.run({ ...BASE_INPUT, requiresTools: ['lsp', 'mcp'], availableTools: ['read', 'grep', 'lsp'] }),
      'SUBAGENT_PRECHECK_FAILED',
    );
    expect(err.message).toContain('mcp');
    expect(err.message).not.toContain('lsp'); // 已在场者不入缺口清单
  });

  it('预检闸 fail-closed：availableTools 缺席 + requires 在场 → 全列缺口 + 注记', async () => {
    const { service } = assemble({ auto: { output: '', stopReason: 'stop' } });
    const err = await expectCode(
      service.run({ ...BASE_INPUT, requiresTools: ['lsp', 'mcp'] }),
      'SUBAGENT_PRECHECK_FAILED',
    );
    expect(err.message).toContain('lsp');
    expect(err.message).toContain('mcp');
    expect(err.message).toContain('不可枚举');
  });

  it('background 能力不匹配折预检闸（同族伞）', async () => {
    const registry = createJobRegistry();
    const service = createSubagentService({ registry });
    service.registerProvider('in-process', {
      capabilities: { tools: true, streaming: true, cancel: true, background: false, structuredOutput: false },
      run: async () => ({ output: '', stopReason: 'stop' }),
    });
    await expectCode(service.run({ ...BASE_INPUT, background: true }), 'SUBAGENT_PRECHECK_FAILED');
  });
});

describe('派生工具面 + 白名单交集', () => {
  it('availableTools 在场：request.tools = 派生面（父面−五名）∩ 白名单', async () => {
    const { service, provider } = assemble({ auto: { output: 'ok', stopReason: 'stop' } });
    await service.run({
      ...BASE_INPUT,
      tools: ['grep', 'bash', 'web'],
      availableTools: ['read', 'write', 'grep', 'bash'],
    });
    expect(provider.requests[0]!.tools).toEqual(['grep']);
  });

  it('availableTools 缺席：白名单透传（交集执法归 in-process 工厂）', async () => {
    const { service, provider } = assemble({ auto: { output: 'ok', stopReason: 'stop' } });
    await service.run({ ...BASE_INPUT, tools: ['bash', 'grep'] });
    expect(provider.requests[0]!.tools).toEqual(['bash', 'grep']);
  });
});

describe('one-shot 收场（黑盒）', () => {
  it('同步回执结果；request 不注入 notifyApproval（父已知情）', async () => {
    const { service, provider, order } = assemble({ auto: { output: 'ok-result', stopReason: 'stop' } });
    const outcome = await service.run({ ...BASE_INPUT, systemPrompt: '你是搜索员', model: 'm1' });
    expect(outcome.mode).toBe('one-shot');
    if (outcome.mode === 'one-shot') {
      expect(outcome.result.output).toBe('ok-result');
      expect(outcome.result.stopReason).toBe('stop');
    }
    const request = provider.requests[0]!;
    expect(request.systemPrompt).toBe('你是搜索员');
    expect(request.model).toBe('m1');
    expect(request.notifyApproval).toBeUndefined(); // one-shot 不注入
    expect(request.background).toBeUndefined();
    expect(request.parentSessionId).toBeUndefined(); // 机器注入位仅 background 形携带
    expect(order).toEqual([]); // 零通知零钩子
  });

  it('provider 异常折 error 结果不重试（run 恰一次）', async () => {
    const { service, provider } = assemble();
    const pending = service.run(BASE_INPUT);
    provider.fail(new Error('子栈崩了'));
    const outcome = await pending;
    expect(outcome.mode).toBe('one-shot');
    if (outcome.mode === 'one-shot') {
      expect(outcome.result.stopReason).toBe('error');
      expect(outcome.result.diagnostic).toContain('子栈崩了');
    }
    expect(provider.requests).toHaveLength(1); // 结果不重试——重试是父的策略
  });

  it('diagnostic 帽 4096 截断（契约面 ≤4096 单点执法）', async () => {
    const { service, provider } = assemble();
    const pending = service.run(BASE_INPUT);
    provider.settle({ output: 'o', stopReason: 'error', diagnostic: '炸'.repeat(5000) });
    const outcome = await pending;
    if (outcome.mode === 'one-shot') {
      expect(outcome.result.diagnostic!.length).toBeLessThanOrEqual(4096 + '…（截断）'.length);
      expect(outcome.result.diagnostic!.endsWith('…（截断）')).toBe(true);
    }
  });
});

describe('background 收场编舞', () => {
  it('回执只携 Job 身份；结算序 = 通知先落 → onSettled → Job 条目后销', async () => {
    const { service, provider, order, registry } = assemble();
    const outcome = await service.run({ ...BASE_INPUT, background: true, name: '后台探索' });
    expect(outcome).toMatchObject({ mode: 'background', jobName: '后台探索' });
    if (outcome.mode !== 'background') return;
    expect(outcome.jobId).toMatch(/^job-\d+$/);
    provider.settle({ output: '后台结果', stopReason: 'stop' });
    await vi.waitFor(() => {
      expect(order).toEqual(['notify', 'notify:s1', 'onSettled']);
    });
    expect(registry.get(outcome.jobId)?.terminal?.status).toBe('completed');
  });

  it('通知先于归属释放的硬序：notify 未 resolve 前 Job 条目不终态（推杆侧证）', async () => {
    const registry = createJobRegistry();
    const provider = new FakeProvider();
    let releaseNotify: (() => void) | undefined;
    const service = createSubagentService({
      registry,
      notify: {
        notifySettled: () =>
          new Promise<void>((resolve) => {
            releaseNotify = resolve;
          }),
        notifyApprovalPending: async () => undefined,
      },
    });
    service.registerProvider('in-process', provider);
    const outcome = await service.run({ ...BASE_INPUT, background: true });
    if (outcome.mode !== 'background') return;
    provider.settle({ output: 'o', stopReason: 'stop' });
    await vi.waitFor(() => {
      expect(releaseNotify).toBeDefined(); // 通知已被唤起（处于在飞态）
    });
    // 通知未 resolve——Job 条目仍 running（通知无条件先于归属释放）
    expect(registry.get(outcome.jobId)?.status).toBe('running');
    releaseNotify!();
    await vi.waitFor(() => {
      expect(registry.get(outcome.jobId)?.terminal?.status).toBe('completed');
    });
  });

  it('审批挂起注入：request.notifyApproval 闭包绑定 jobName 路由到通知面', async () => {
    const { service, provider, order } = assemble();
    const outcome = await service.run({ ...BASE_INPUT, background: true, name: '审批员' });
    if (outcome.mode !== 'background') return;
    const request = provider.requests[0]!;
    expect(request.background).toBe(true);
    expect(request.parentSessionId).toBe('s1');
    expect(typeof request.notifyApproval).toBe('function');
    await request.notifyApproval!({ approvalId: 'ap-1', toolName: 'write', reason: '越界' });
    expect(order).toContain('approval:审批员:ap-1');
    provider.settle({ output: '', stopReason: 'stop' });
    await vi.waitFor(() => {
      expect(order).toContain('onSettled');
    });
  });

  it('协作停止观察：JobHandle.stop 置 stopping 后 request.stopRequested() 翻真', async () => {
    const inner = createJobRegistry();
    const { wrapped, handles } = captureHandles(inner);
    const provider = new FakeProvider();
    const service = createSubagentService({ registry: wrapped });
    service.registerProvider('in-process', provider);
    const outcome = await service.run({ ...BASE_INPUT, background: true });
    if (outcome.mode !== 'background') return;
    const request = provider.requests[0]!;
    expect(typeof request.stopRequested).toBe('function');
    expect(request.stopRequested!()).toBe(false);
    handles[0]!.stop();
    expect(request.stopRequested!()).toBe(true); // 子栈协作中止观察位
    provider.settle({ output: '', stopReason: 'aborted' });
    await vi.waitFor(() => {
      expect(inner.get(outcome.jobId)?.terminal?.status).toBe('killed');
    });
  });

  it('terminalOf 三映射：stop→completed / aborted→killed / error→failed（detail=diagnostic）', async () => {
    for (const [stopReason, status] of [
      ['stop', 'completed'],
      ['aborted', 'killed'],
      ['error', 'failed'],
    ] as const) {
      const registry = createJobRegistry();
      const provider = new FakeProvider();
      const service = createSubagentService({ registry });
      service.registerProvider('in-process', provider);
      const outcome = await service.run({ ...BASE_INPUT, background: true });
      if (outcome.mode !== 'background') continue;
      provider.settle({ output: 'o', stopReason, ...(stopReason !== 'stop' ? { diagnostic: `d-${stopReason}` } : {}) });
      await vi.waitFor(() => {
        expect(registry.get(outcome.jobId)?.terminal?.status).toBe(status);
      });
      if (stopReason !== 'stop') {
        expect(registry.get(outcome.jobId)?.terminal?.detail).toBe(`d-${stopReason}`);
      }
    }
  });

  it('通知面缺席：warn 降级不拒，结算仍落（注册表条目是最低承载）', async () => {
    const registry = createJobRegistry();
    const provider = new FakeProvider();
    const warn = vi.fn();
    const service = createSubagentService({ registry, warn });
    service.registerProvider('in-process', provider);
    const outcome = await service.run({ ...BASE_INPUT, background: true });
    if (outcome.mode !== 'background') return;
    expect(warn).toHaveBeenCalledTimes(1); // 起跑即降级注记
    expect(warn.mock.calls[0]![0]).toContain('通知面缺席');
    provider.settle({ output: 'o', stopReason: 'stop' });
    await vi.waitFor(() => {
      expect(registry.get(outcome.jobId)?.terminal?.status).toBe('completed');
    });
  });

  it('notifySettled 抛错不吞结算（warn + 条目仍终态）', async () => {
    const registry = createJobRegistry();
    const provider = new FakeProvider();
    const warn = vi.fn();
    const service = createSubagentService({
      registry,
      warn,
      notify: {
        notifySettled: async () => {
          throw new Error('通知通道炸了');
        },
        notifyApprovalPending: async () => undefined,
      },
    });
    service.registerProvider('in-process', provider);
    const outcome = await service.run({ ...BASE_INPUT, background: true });
    if (outcome.mode !== 'background') return;
    provider.settle({ output: 'o', stopReason: 'stop' });
    await vi.waitFor(() => {
      expect(registry.get(outcome.jobId)?.terminal?.status).toBe('completed');
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('结算通知失败'));
  });

  it('onSettled 抛错不吞结算（warn 隔离）', async () => {
    const registry = createJobRegistry();
    const provider = new FakeProvider();
    const warn = vi.fn();
    const service = createSubagentService({
      registry,
      warn,
      onSettled: () => {
        throw new Error('钩子炸了');
      },
    });
    service.registerProvider('in-process', provider);
    const outcome = await service.run({ ...BASE_INPUT, background: true });
    if (outcome.mode !== 'background') return;
    provider.settle({ output: 'o', stopReason: 'stop' });
    await vi.waitFor(() => {
      expect(registry.get(outcome.jobId)?.terminal?.status).toBe('completed');
    });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('结算钩子异常'));
  });
});

/* ---------------- 程序化注册面（D 批 D-2——04 §10 程序化注册槽） ---------------- */

/** 程序化 def 构造辅助（镜像 frontmatter 形） */
function defOf(name: string, overrides: Partial<ProgrammaticSubagentDef> = {}): ProgrammaticSubagentDef {
  return {
    name,
    description: `${name} 测试子代理`,
    systemPrompt: `你是 ${name}`,
    ...overrides,
  };
}

/** 断言同步抛指定码（返回错误供 message 断言） */
function expectSyncCode(fn: () => unknown, code: string): BaseError {
  try {
    fn();
    expect.unreachable(`应抛 ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
    return err as BaseError;
  }
}

describe('程序化 named provider 注册面（registerProgrammatic——04 §10 程序化注册槽）', () => {
  it('合法注册：落册入路由 + 读面按注册序；注销即释放名（再注不残留占用）', () => {
    const { service } = assemble();
    const off = service.registerProgrammatic('acme', defOf('daily'));
    expect(service.providerNames()).toContain('daily');
    expect(service.programmaticProviders()).toEqual([{ def: defOf('daily'), owner: 'acme' }]);
    off();
    expect(service.providerNames()).not.toContain('daily');
    expect(service.programmaticProviders()).toEqual([]);
    expect(() => service.registerProgrammatic('other', defOf('daily'))).not.toThrow(); // 名可再注
  });

  it('撞名拒（闸一）：兄弟插件同名 SUBAGENT_PROVIDER_EXISTS——message 携在册方 owner（分域归因）+ 派生名比对载体', () => {
    const { service } = assemble();
    service.registerProgrammatic('acme', defOf('daily'));
    const err = expectSyncCode(() => service.registerProgrammatic('rival', defOf('daily')), 'SUBAGENT_PROVIDER_EXISTS');
    expect(err.message).toContain('acme'); // 在册方 owner 入 message——分域存名的归因兑现
    expect(err.message).toContain('agent_daily'); // 比对经派生工具名（前缀单射）
  });

  it('跨层撞名两向：程序化撞声明式既有位 / 声明式撞程序化既有位（动态 mount 场景）统一同码拒', () => {
    // 向一：声明式先在册（core:skills 物化位），程序化后到
    const a = assemble();
    a.service.registerProvider('daily', {
      capabilities: FULL_CAPS,
      run: async () => ({ output: '', stopReason: 'stop' }),
    });
    expectSyncCode(() => a.service.registerProgrammatic('acme', defOf('daily')), 'SUBAGENT_PROVIDER_EXISTS');
    // 向二：程序化先在册，声明式装载撞已注册程序化位——装载面拒载的注册面根源（04 §10）
    const b = assemble();
    b.service.registerProgrammatic('acme', defOf('daily'));
    expectSyncCode(
      () =>
        b.service.registerProvider('daily', {
          capabilities: FULL_CAPS,
          run: async () => ({ output: '', stopReason: 'stop' }),
        }),
      'SUBAGENT_PROVIDER_EXISTS',
    );
  });

  it('裸词词法拒（闸二）：字符集/首尾连字符/连续连字符/超长各红 SUBAGENT_NAME_INVALID 且零记账', () => {
    const { service } = assemble();
    const bad = ['acme/daily', 'Acme', 'daily!', '-daily', 'daily-', 'da--ily', 'a'.repeat(65)];
    for (const name of bad) {
      expectSyncCode(() => service.registerProgrammatic('acme', defOf(name)), 'SUBAGENT_NAME_INVALID');
    }
    expect(service.providerNames()).toEqual(['in-process']); // 全拒零记账（在册名必已合法——撞名前置格式的结构性根基）
  });

  it('注销器三律②：双调幂等 + 旧注销器不误摘接任者', () => {
    const { service } = assemble();
    const offA = service.registerProgrammatic('acme', defOf('daily'));
    offA();
    offA(); // 幂等
    expect(service.providerNames()).not.toContain('daily');
    void service.registerProgrammatic('rival', defOf('daily')); // 重注接任
    offA(); // 旧注销器不摘接任者（过期时序守卫）
    expect(service.providerNames()).toContain('daily');
  });

  it('run 路由 + def 合流：程序化名经 late-binding 桥路由 in-process 基厂——请求缺席字段由 def 兜底、显式值胜出', async () => {
    const { service, provider } = assemble({ auto: { output: '完成', stopReason: 'stop' } });
    service.registerProgrammatic('acme', defOf('daily', { model: 'm/x' }));
    await service.run({ providerName: 'daily', prompt: '跑', parentSessionId: 's1', depth: 1 });
    expect(provider.requests[0]).toMatchObject({ systemPrompt: '你是 daily', model: 'm/x', name: 'daily' });
    // 请求显式值胜出（late-binding 合流幂等律——与声明式腿同折）
    await service.run({
      providerName: 'daily',
      prompt: '再跑',
      parentSessionId: 's1',
      depth: 1,
      model: 'm/y',
      systemPrompt: '覆盖',
    });
    expect(provider.requests[1]).toMatchObject({ model: 'm/y', systemPrompt: '覆盖' });
  });

  it('物化：createDeclarativeAgentTool 单条派生 agent_<name> 静态工具（注册即派生的机器层——动词层消费腿同函数单源）', async () => {
    const { service, provider } = assemble({ auto: { output: '完成', stopReason: 'stop' } });
    service.registerProgrammatic('acme', defOf('daily'));
    service.registerProgrammatic('core:issue', defOf('scan'));
    const entries = service.programmaticProviders();
    expect(entries.map((entry) => entry.def.name)).toEqual(['daily', 'scan']); // 注册序
    const tools = entries.map((entry) => createDeclarativeAgentTool(entry.def, { service, parentSessionId: 's1' }));
    expect(tools.map((tool) => tool.name)).toEqual(['agent_daily', 'agent_scan']);
    expect(tools[0]!.description).toBe('daily 测试子代理');
    // execute 走委派链：路由到 def 名 + def 缺省合流
    const result = await tools[0]!.execute({ prompt: '跑' }, { toolCallId: 'test' });
    expect(result.isError).toBeUndefined(); // one-shot 完成回执（renderOutcome 形）
    expect(provider.requests.at(-1)).toMatchObject({ name: 'daily', systemPrompt: '你是 daily' });
  });
});
