/**
 * llm — complete 单发受托管补全测试（04 §3.7 + §5 预算两维）。
 *
 * faux provider 零网络走真实 pi-ai streamSimple + retryAssistantCall 路径。
 * 钉死：预算拒发位（请求发出前）/ 错误终态上抛 LLM_COMPLETE_FAILED /
 * 计量 seam（onUsage + onUsageError 隔离）/ 达帽同拒 / 目录投影。
 */
import { describe, expect, it } from 'vitest';
import { fauxProvider } from './index.js';
import type {
  AssistantMessage as PiAssistantMessage,
  Context as PiContext,
  SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { AssistantMessage, Message } from '../contracts/index.js';
import { BaseError } from '../contracts/index.js';
import { createLlmRuntime } from './runtime.js';
import { createLlmService, type LlmServiceOptions } from './complete.js';
import { budgetAdvisoryLevel, BUDGET_ADVISORY_THRESHOLDS, SUBAGENT_RESERVE_THRESHOLD } from './complete.js';
import { InFlightTracker } from './inflight.js';

/* ---------------- 测试基建 ---------------- */

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** 用户消息工厂 */
const userMsg = (text: string): Message => ({ role: 'user', content: text, timestamp: 1 });

/** 组装指定终态的 assistant 消息（faux 响应脚本用——pi-ai 面形状） */
function messageOf(stopReason: 'stop' | 'error' | 'aborted', opts: { errorMessage?: string } = {}): PiAssistantMessage {
  return {
    role: 'assistant',
    content: stopReason === 'stop' ? [{ type: 'text', text: 'ok' }] : [],
    usage: NO_USAGE,
    stopReason,
    errorMessage: opts.errorMessage,
    timestamp: 1,
  } as unknown as PiAssistantMessage; // contracts 形状同构缺 pi-ai 元数据字段——faux 脚本面收口在此
}

/** 服务组装（faux 两模型 + 缺省模型 m1 + 可选覆盖项） */
function makeService(overrides: Partial<LlmServiceOptions> = {}, providerName = 'faux-test') {
  const faux = fauxProvider({ provider: providerName, models: [{ id: 'm1' }, { id: 'm2' }] });
  const runtime = createLlmRuntime({ providers: [faux.provider] });
  const service = createLlmService({
    runtime,
    defaultModel: () => `${providerName}/m1`,
    // 缺省关重试——单响应脚本的确定性断言不受退避时序干扰（重试语义单测在别处）
    retry: { enabled: false, maxRetries: 0, baseDelayMs: 1 },
    ...overrides,
  });
  return { faux, runtime, service };
}

/** 捕获型响应工厂：记录 pi-ai 请求面，恒回固定终态消息 */
function capturing(
  captures: Array<{ context: PiContext; options: SimpleStreamOptions | undefined }>,
  message: PiAssistantMessage,
) {
  return (context: PiContext, options: SimpleStreamOptions | undefined) => {
    captures.push({ context, options });
    return message;
  };
}

/* ---------------- 请求面组装与直通 ---------------- */

describe('complete：请求面组装与直通', () => {
  it('messages 引用相等（零转换）、systemPrompt 原样、defaults 打底可被具名覆盖', async () => {
    const captures: Array<{ context: PiContext; options: SimpleStreamOptions | undefined }> = [];
    const { faux, service } = makeService({ defaults: { timeoutMs: 11111 } });
    const messages = [userMsg('摘要这段')];
    faux.setResponses([capturing(captures, messageOf('stop'))]);
    const result = await service.complete({ systemPrompt: '你是分类器', messages, timeoutMs: 22222 });
    expect(result.message.stopReason).toBe('stop');
    const seen = captures[0]!;
    expect(seen.context.messages).toBe(messages); // 同一数组——零拷贝直通
    expect(seen.context.systemPrompt).toBe('你是分类器');
    // 参数合并序：defaults.timeoutMs=11111 打底 → req.timeoutMs=22222 覆盖
    expect(seen.options?.timeoutMs).toBe(22222);
  });

  it('模型缺省继承 defaultModel()；req.model 显式覆盖优先', async () => {
    // defaultModel 指向不存在 m9；req.model 用 m2——成功即证明显式覆盖生效
    const { faux, service } = makeService({ defaultModel: () => 'faux-test/m9' });
    faux.setResponses([() => messageOf('stop')]);
    await expect(service.complete({ messages: [userMsg('x')], model: 'faux-test/m2' })).resolves.toBeTruthy();
    // 不传 model → 走 defaultModel() 的 m9 → fail-loud（可观察）
    faux.setResponses([() => messageOf('stop')]);
    await expect(service.complete({ messages: [userMsg('x')] })).rejects.toMatchObject({
      code: 'LLM_MODEL_NOT_FOUND',
    });
  });

  it('模型解析 fail-loud 在重试环外：解析错直抛 LLM_MODEL_NOT_FOUND（非 COMPLETE_FAILED 包装）', async () => {
    const { faux, service } = makeService({ retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 } });
    faux.setResponses([() => messageOf('stop')]);
    const err = await service.complete({ messages: [userMsg('x')], model: 'faux-test/nope' }).catch((e) => e);
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe('LLM_MODEL_NOT_FOUND');
    expect(faux.state.callCount).toBe(0); // 解析失败未发出任何请求
  });
});

/* ---------------- 错误终态上抛（Promise 面回到异常形态） ---------------- */

describe('complete：钩子派发段前置查（LLM_CALL_IN_HOOK，ca-3）', () => {
  it('窗内命中 → BaseError(LLM_CALL_IN_HOOK)，先于预算闸/模型解析（无响应脚本也不触达 provider）', async () => {
    // 不设 faux 响应脚本——前置查若漏位将落到 provider 面报错而非本码
    const { service } = makeService({ hookDispatch: { inHookDispatch: () => true } });
    const err = await service.complete({ messages: [userMsg('x')] }).catch((e) => e);
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe('LLM_CALL_IN_HOOK');
    expect((err as BaseError).message).toContain('钩子执行段禁模型调用');
  });

  it('窗外放行（inHookDispatch false）与执法缺席（不传 hookDispatch）均正常路', async () => {
    const a = makeService({ hookDispatch: { inHookDispatch: () => false } });
    a.faux.setResponses([() => messageOf('stop')]);
    const okA = await a.service.complete({ messages: [userMsg('x')] });
    expect(okA.message.stopReason).toBe('stop');
    const b = makeService(); // 缺席形
    b.faux.setResponses([() => messageOf('stop')]);
    const okB = await b.service.complete({ messages: [userMsg('x')] });
    expect(okB.message.stopReason).toBe('stop');
  });
});

describe('complete：错误终态上抛 LLM_COMPLETE_FAILED', () => {
  it('stopReason=error → BaseError(LLM_COMPLETE_FAILED)，errorMessage 透传', async () => {
    const { faux, service } = makeService();
    faux.setResponses([() => messageOf('error', { errorMessage: 'provider 500' })]);
    const err = await service.complete({ messages: [userMsg('x')] }).catch((e) => e);
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe('LLM_COMPLETE_FAILED');
    expect((err as BaseError).message).toContain('provider 500');
  });

  it('stopReason=aborted 同上抛（取消也是终态错误）', async () => {
    const { faux, service } = makeService();
    faux.setResponses([() => messageOf('aborted', { errorMessage: 'cancelled' })]);
    await expect(service.complete({ messages: [userMsg('x')] })).rejects.toMatchObject({
      code: 'LLM_COMPLETE_FAILED',
    });
  });

  it('transient 错误按 retry 策略有界重试后成功', async () => {
    const { faux, service } = makeService({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 1 } });
    faux.setResponses([() => messageOf('error', { errorMessage: 'rate limit exceeded' }), () => messageOf('stop')]);
    const result = await service.complete({ messages: [userMsg('x')] });
    expect(result.message.stopReason).toBe('stop');
    expect(faux.state.callCount).toBe(2);
  });
});

/* ---------------- 预算两维（04 §5） ---------------- */

describe('complete：预算两维（foreground 恒放行 / background 软闸门）', () => {
  const spent = (n: number) => () => n;

  it('canAfford：foreground 恒 true；background = 当日已耗 < 限额', () => {
    const { service } = makeService({ backgroundBudgetTokens: 1000, backgroundSpentToday: spent(999) });
    expect(service.canAfford('foreground')).toBe(true);
    expect(service.canAfford('background')).toBe(true); // 999 < 1000
    const { service: drained } = makeService({ backgroundBudgetTokens: 1000, backgroundSpentToday: spent(1000) });
    expect(drained.canAfford('background')).toBe(false); // 恰达限额即拒
  });

  it('后台拒发在请求发出前（callCount 0——不是花完才发现超）', async () => {
    const { faux, service } = makeService({ backgroundBudgetTokens: 1000, backgroundSpentToday: spent(1000) });
    const err = await service.complete({ messages: [userMsg('x')], priority: 'background' }).catch((e) => e);
    expect((err as BaseError).code).toBe('LLM_BUDGET_EXCEEDED');
    expect(faux.state.callCount).toBe(0);
  });

  it('foreground 在已耗尽时仍放行（用户可见请求永远优先）', async () => {
    const { faux, service } = makeService({ backgroundBudgetTokens: 1000, backgroundSpentToday: spent(1000) });
    faux.setResponses([() => messageOf('stop')]);
    const result = await service.complete({ messages: [userMsg('x')], priority: 'foreground' });
    expect(result.message.stopReason).toBe('stop');
  });

  it('缺省无已耗接线 = background 可用（lib 形态零装配零闸）', async () => {
    const { faux, service } = makeService();
    faux.setResponses([() => messageOf('stop')]);
    const result = await service.complete({ messages: [userMsg('x')], priority: 'background' });
    expect(result.message.stopReason).toBe('stop');
  });

  it('backgroundUsage 投影：spent/limit 与 canAfford 同源同账（数值面）', () => {
    const { service } = makeService({ backgroundBudgetTokens: 4_000_000, backgroundSpentToday: spent(3_000_000) });
    expect(service.backgroundUsage()).toEqual({ spent: 3_000_000, limit: 4_000_000, ratio: 0.75 });
    // 缺省无装配 = 零已耗零比值（lib 形态投影零异常）
    const { service: bare } = makeService();
    expect(bare.backgroundUsage()).toEqual({ spent: 0, limit: 4_000_000, ratio: 0 });
  });
});

/* ---------------- 预警三档（04 §5 软着陆层——遗漏审计批 H） ---------------- */

describe('complete：预算预警三档（budgetAdvisoryLevel 单源判定）', () => {
  it('档位边界：70/85/95% 三档闭开区间（达线即档、档内不跃档）', () => {
    expect(budgetAdvisoryLevel(0)).toBeNull();
    expect(budgetAdvisoryLevel(0.699)).toBeNull(); // 未达 notice 线零预警
    expect(budgetAdvisoryLevel(0.7)).toBe('notice'); // 达线即档
    expect(budgetAdvisoryLevel(0.849)).toBe('notice');
    expect(budgetAdvisoryLevel(0.85)).toBe('urgent');
    expect(budgetAdvisoryLevel(0.949)).toBe('urgent');
    expect(budgetAdvisoryLevel(0.95)).toBe('critical');
    expect(budgetAdvisoryLevel(1)).toBe('critical'); // 池尽仍 critical（exhausted 不设档——硬拒归 canAfford）
  });

  it('三档线常量：70/85/95 与 reserve 线 90（常量可配置不入库——04 §5）', () => {
    expect(BUDGET_ADVISORY_THRESHOLDS).toEqual({ notice: 0.7, urgent: 0.85, critical: 0.95 });
    expect(SUBAGENT_RESERVE_THRESHOLD).toBe(0.9);
  });
});

/* ---------------- 在飞帽同拒（04 §3.6 两出口同源） ---------------- */

describe('complete：在飞帽同拒', () => {
  it('达帽 → LLM_COMPLETE_FAILED（文案含 LLM_INFLIGHT_LIMIT）、不发请求、不占名额', async () => {
    const tracker = new InFlightTracker(1);
    const { faux, service } = makeService({ tracker });
    // 预占满帽：主对话路持有的形态
    const held = tracker.tryAcquire('faux-test');
    expect(held).not.toBeNull();
    const err = await service.complete({ messages: [userMsg('x')] }).catch((e) => e);
    expect((err as BaseError).code).toBe('LLM_COMPLETE_FAILED');
    expect((err as BaseError).message).toContain('LLM_INFLIGHT_LIMIT');
    expect(faux.state.callCount).toBe(0);
    expect(tracker.inFlight('faux-test')).toBe(1); // 我方名额不动
    held!.release();
  });

  it('成功路名额取还（finally 必达）', async () => {
    const tracker = new InFlightTracker(1);
    const { faux, service } = makeService({ tracker });
    faux.setResponses([() => messageOf('stop'), () => messageOf('stop')]);
    await expect(service.complete({ messages: [userMsg('x')] })).resolves.toBeTruthy();
    expect(tracker.inFlight('faux-test')).toBe(0);
    // 帽 1 下第二次成功 = 第一次确已释放
    await expect(service.complete({ messages: [userMsg('y')] })).resolves.toBeTruthy();
  });
});

/* ---------------- 计量 seam（onUsage / onUsageError） ---------------- */

describe('complete：计量 seam', () => {
  it('onUsage 收到完整结果（callId/priority/elapsedMs/message 同源）', async () => {
    const seen: Array<{ callId: string; priority: string; elapsedMs: number; message: AssistantMessage }> = [];
    const { faux, service } = makeService({
      onUsage: (result) => seen.push({ ...result, message: result.message }),
    });
    faux.setResponses([() => messageOf('stop')]);
    const result = await service.complete({ messages: [userMsg('x')] });
    expect(seen).toHaveLength(1);
    expect(seen[0]!.callId).toBe(result.callId); // settlement 幂等身份
    expect(seen[0]!.priority).toBe('foreground'); // 缺省前台道
    expect(seen[0]!.message).toBe(result.message); // 同一终值对象
    expect(seen[0]!.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('priority 分道：background 调用入 background 道', async () => {
    const seen: Array<string> = [];
    const { faux, service } = makeService({ onUsage: (result) => seen.push(result.priority) });
    faux.setResponses([() => messageOf('stop')]);
    await service.complete({ messages: [userMsg('x')], priority: 'background' });
    expect(seen).toEqual(['background']);
  });

  it('onUsage 抛错被隔离（不拖垮补全结果）且 onUsageError 可观测（丢账不静默）', async () => {
    const usageErrors: Array<{ callId: string; model: string }> = [];
    const { faux, service } = makeService({
      onUsage: () => {
        throw new Error('账本写入失败');
      },
      onUsageError: (err, info) => {
        expect(err).toBeInstanceOf(Error);
        usageErrors.push(info);
      },
    });
    faux.setResponses([() => messageOf('stop')]);
    const result = await service.complete({ messages: [userMsg('x')] });
    expect(result.message.stopReason).toBe('stop'); // 补全照常成功
    expect(usageErrors).toHaveLength(1);
    expect(usageErrors[0]!.model).toBe('faux-test/m1');
    expect(usageErrors[0]!.callId).toBe(result.callId);
  });
});

/* ---------------- 目录投影与判定服务面 ---------------- */

describe('listModels / getModel / isContextOverflowFor', () => {
  /** 带元数据的模型目录（contextWindow 已知——静默溢出判定的窗口源） */
  function makeCatalogService() {
    const faux = fauxProvider({
      provider: 'faux-cat',
      models: [
        { id: 'm1', name: 'Model One', reasoning: true, input: ['text', 'image'], contextWindow: 1000, maxTokens: 500 },
        { id: 'm2' },
      ],
    });
    const runtime = createLlmRuntime({ providers: [faux.provider] });
    const service = createLlmService({
      runtime,
      defaultModel: () => 'faux-cat/m1',
      retry: { enabled: false, maxRetries: 0, baseDelayMs: 1 },
    });
    return { service };
  }

  it('投影形：id 全形 + 元数据直通；可选按 provider 过滤', () => {
    const { service } = makeCatalogService();
    const all = service.listModels();
    expect(all.map((m) => m.id).sort()).toEqual(['faux-cat/m1', 'faux-cat/m2']);
    const m1 = service.getModel('faux-cat/m1');
    expect(m1?.name).toBe('Model One');
    expect(m1?.provider).toBe('faux-cat');
    expect(m1?.reasoning).toBe(true);
    expect(m1?.contextWindow).toBe(1000);
    expect(m1?.maxTokens).toBe(500);
    expect(m1?.input).toContain('image');
    expect(service.listModels('faux-cat')).toHaveLength(2);
    expect(service.listModels('other')).toHaveLength(0);
  });

  it('getModel 点查缺席 = undefined（点查语义非 fail-loud）', () => {
    const { service } = makeCatalogService();
    expect(service.getModel('faux-cat/m9')).toBeUndefined();
  });

  it('isContextOverflowFor：窗口按目录活取（静默溢出可判）；缺模型诚实退化', () => {
    const { service } = makeCatalogService();
    const silentOverflow: AssistantMessage = {
      role: 'assistant',
      content: [],
      usage: { ...NO_USAGE, input: 1500 },
      stopReason: 'stop',
      timestamp: 1,
    };
    expect(service.isContextOverflowFor(silentOverflow, 'faux-cat/m1')).toBe(true); // 窗口 1000
    // 缺模型 → 窗口 undefined → 静默溢出路关闭（诚实退化仅错误正则一路）
    expect(service.isContextOverflowFor(silentOverflow, 'faux-cat/m9')).toBe(false);
    // 错误文案路不依赖窗口
    const explicit: AssistantMessage = {
      ...silentOverflow,
      stopReason: 'error',
      errorMessage: 'prompt is too long: 213462 tokens > 200000 maximum',
    };
    expect(service.isContextOverflowFor(explicit, 'faux-cat/m9')).toBe(true);
  });
});
