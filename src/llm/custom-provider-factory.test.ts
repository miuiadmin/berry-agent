/**
 * llm — 自定义渠道 provider 工厂测试（2026-09-28 模型渠道批 C-1）。
 *
 * 核心回归锁 = **裸 id 注册律**（评审致命项 #1）：工厂产物 Model.id 恒裸形，
 * 注册后 `resolveModel('<渠道id>/<裸模型id>')` 必命中——注册侧填全形则
 * parseModelSpec 分割后 getModel(provider, bareId) 恒 miss，此断言即炸
 * （防未来重构再踩）。其余锁：两协议腿分派 / auth resolve 注入形 / 占位
 * 元数据 / headers 透传。零网络（lazy api 工厂构造零副作用——流不触）。
 */
import { describe, expect, it } from 'vitest';
import {
  createCustomChannelProvider,
  customCompatProblem,
  customSamplingParamsByThinkingLevelProblem,
  customSamplingParamsProblem,
  customThinkingBudgetsFor,
  customThinkingBudgetsProblem,
  fauxProvider,
  resolveModel,
  unregisterCustomProviderDef,
  type CustomProviderDef,
} from './index.js';
import { createLlmRuntime } from './runtime.js';
import { BaseError } from '../contracts/index.js';

/** 最小渠道定义件（两协议共用形状） */
function makeDef(protocol: CustomProviderDef['protocol']): CustomProviderDef {
  return { protocol, baseUrl: 'https://gw.example.test/v1', models: ['model-a', 'model-b'] };
}

describe('createCustomChannelProvider（两协议腿 + 目录同权）', () => {
  it('anthropic-messages 腿：getModels 裸 id + api 字段=协议枚举 + provider/baseUrl 渠道级同值', () => {
    const provider = createCustomChannelProvider('my-gw', makeDef('anthropic-messages'), () => 'sk-test');
    expect(provider.id).toBe('my-gw');
    expect(provider.name).toBe('my-gw'); // 缺省名 = 渠道 id
    expect(provider.baseUrl).toBe('https://gw.example.test/v1');
    const models = provider.getModels();
    expect(models.map((m) => m.id)).toEqual(['model-a', 'model-b']); // 裸形——非全形
    for (const m of models) {
      expect(m.api).toBe('anthropic-messages');
      expect(m.provider).toBe('my-gw');
      expect(m.baseUrl).toBe('https://gw.example.test/v1');
    }
  });

  it('openai-completions 腿：api 字段分派 openai 协议（wire format 两主流腿齐锁）', () => {
    const provider = createCustomChannelProvider('oa-gw', makeDef('openai-completions'), () => 'sk-test');
    for (const m of provider.getModels()) expect(m.api).toBe('openai-completions');
  });

  it('name 覆盖与 headers 透传（provider 级 + model 级双位）', () => {
    const def: CustomProviderDef = {
      ...makeDef('openai-completions'),
      name: '中转站',
      headers: { 'X-Custom': 'v1' },
    };
    const provider = createCustomChannelProvider('relay', def, () => 'sk-test');
    expect(provider.name).toBe('中转站');
    expect(provider.headers).toEqual({ 'X-Custom': 'v1' });
    expect(provider.getModels()[0]?.headers).toEqual({ 'X-Custom': 'v1' });
  });
});

describe('裸 id 注册律（评审致命项 #1 回归锁——注册后全形 spec 必达）', () => {
  it('registerProvider 后 resolveModel("<渠道>/<裸id>") 命中且 model.id 恒裸形', () => {
    const provider = createCustomChannelProvider('my-gw', makeDef('anthropic-messages'), () => 'sk-test');
    const runtime = createLlmRuntime({
      providers: [provider, fauxProvider({ provider: 'faux-test', models: [{ id: 'm1' }] }).provider],
    });
    const model = resolveModel(runtime.models, 'my-gw/model-b');
    // 命中即证裸 id（注册填全形 'my-gw/model-b' 则 getModel('my-gw','model-b') 恒 miss）
    expect(model.id).toBe('model-b');
    expect(model.provider).toBe('my-gw');
  });

  it('未注册渠道仍 fail-loud LLM_MODEL_NOT_FOUND（fail-loud 面不因工厂软化）', () => {
    const runtime = createLlmRuntime({
      providers: [fauxProvider({ provider: 'faux-test', models: [{ id: 'm1' }] }).provider],
    });
    try {
      resolveModel(runtime.models, 'my-gw/model-a');
      expect.unreachable('未拒绝');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('LLM_MODEL_NOT_FOUND');
    }
  });
});

describe('auth resolve 注入形（凭证闭包 → checkAuth 判据位）', () => {
  it('key 在场：resolve 产 {auth:{apiKey}} + source 标注凭证供血', async () => {
    const provider = createCustomChannelProvider('my-gw', makeDef('openai-completions'), () => 'sk-live-key');
    const apiAuth = provider.auth.apiKey!;
    const result = await apiAuth.resolve({ ctx: {} as never, signal: new AbortController().signal });
    expect(result?.auth).toEqual({ apiKey: 'sk-live-key' });
    expect(result?.source).toBe('credentials');
  });

  it('key 缺席：resolve 产 undefined（未配置态——checkAuth 判 unconfigured 的供数源）', async () => {
    const provider = createCustomChannelProvider('my-gw', makeDef('openai-completions'), () => undefined);
    const apiAuth = provider.auth.apiKey!;
    const result = await apiAuth.resolve({ ctx: {} as never, signal: new AbortController().signal });
    expect(result).toBeUndefined();
  });

  it('空串 key 同缺席（凭证空值不构成配置态）', async () => {
    const provider = createCustomChannelProvider('my-gw', makeDef('openai-completions'), () => '');
    const apiAuth = provider.auth.apiKey!;
    expect(await apiAuth.resolve({ ctx: {} as never, signal: new AbortController().signal })).toBeUndefined();
  });
});

describe('占位元数据（v1 保守占位——注释定形见工厂常量头）', () => {
  it('contextWindow 128k / maxTokens 8k / cost 四率零 / input 恒 text / reasoning 恒 false', () => {
    const provider = createCustomChannelProvider('my-gw', makeDef('anthropic-messages'), () => 'sk-test');
    const m = provider.getModels()[0]!;
    expect(m.contextWindow).toBe(128_000);
    expect(m.maxTokens).toBe(8_192);
    expect(m.cost).toEqual({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
    expect(m.input).toEqual(['text']);
    expect(m.reasoning).toBe(false);
    // 占位值不共享引用（防未来单条改写污染整批）
    const m2 = provider.getModels()[1]!;
    expect(m2.cost).not.toBe(m.cost);
  });
});

describe('pi-8 批：compat/采样参三键注入（Model 级字段——读侧闭集执法后直挂）', () => {
  it('三键在场直挂 Model；缺席恒 undefined（开面零行为变化）', () => {
    const def: CustomProviderDef = {
      protocol: 'openai-completions',
      baseUrl: 'https://gw.example.test/v1',
      models: ['model-a'],
      compat: { supportsStore: true, thinkingFormat: 'zai' },
      samplingParams: { top_p: 0.9 },
      samplingParamsByThinkingLevel: { off: { top_k: 5 } },
    };
    const provider = createCustomChannelProvider('my-gw', def, () => 'sk-test');
    const m = provider.getModels()[0]!;
    expect(m.compat).toEqual({ supportsStore: true, thinkingFormat: 'zai' });
    expect(m.samplingParams).toEqual({ top_p: 0.9 });
    expect(m.samplingParamsByThinkingLevel).toEqual({ off: { top_k: 5 } });
    // 嵌套表深拷贝（内层 Record 不共享引用——防跨渠道条目串写）
    expect(m.samplingParamsByThinkingLevel?.off).not.toBe(def.samplingParamsByThinkingLevel?.off);
    // 缺席腿：三字段不设（开面零行为变化——与占位元数据同保守缺省）
    const bare = createCustomChannelProvider('bare-gw', makeDef('anthropic-messages'), () => 'sk-test');
    const bm = bare.getModels()[0]!;
    expect(bm.compat).toBeUndefined();
    expect(bm.samplingParams).toBeUndefined();
    expect(bm.samplingParamsByThinkingLevel).toBeUndefined();
  });
});

describe('pi-8 批判据单源（customCompatProblem——白名单按协议分家 + 值域 + 依赖执法）', () => {
  /** anthropic 腿 12 键全好形（全键设值——计数 12 由全键通过隐锁） */
  const FULL_ANTHROPIC = {
    supportsEagerToolInputStreaming: true,
    supportsLongCacheRetention: false,
    sendSessionAffinityHeaders: true,
    sessionAffinityFormat: 'openrouter',
    supportsCacheControlOnTools: true,
    supportsTemperature: false,
    forceAdaptiveThinking: true,
    allowEmptySignature: false,
    supportsStrictTools: true,
    supportsMidConvoEffort: false,
    supportsMidConvoSystemMessages: true,
    supportsMidConvoToolChanges: true,
  } as const;
  /** openai 腿 23 键全好形（枚举键取真值域成员；vllmPriority 数值） */
  const FULL_OPENAI = {
    supportsStore: true,
    supportsDeveloperRole: false,
    supportsReasoningEffort: true,
    supportsUsageInStreaming: true,
    supportsFinishReason: false,
    maxTokensField: 'max_completion_tokens',
    requiresToolResultName: true,
    requiresAssistantAfterToolResult: false,
    requiresThinkingAsText: true,
    requiresReasoningContentOnAssistantMessages: false,
    thinkingFormat: 'zai',
    zaiToolStream: true,
    thinkingTokenBudgetField: 'thinking_budget',
    supportsThinkingTokenBudget: true,
    supportsOpenAIGrammarTools: false,
    supportsMidConvoSystemMessages: true,
    supportsMidConvoToolAdditions: true,
    supportsStrictMode: true,
    cacheControlFormat: 'anthropic',
    sendSessionAffinityHeaders: true,
    sessionAffinityFormat: 'openai-nosession',
    supportsLongCacheRetention: false,
    vllmPriority: 1,
  } as const;

  it('两腿全键好形零问题（anthropic 12 键 / openai 23 键——计数由全键通过隐锁）', () => {
    expect(customCompatProblem('anthropic-messages', FULL_ANTHROPIC)).toBeUndefined();
    expect(customCompatProblem('openai-completions', FULL_OPENAI)).toBeUndefined();
  });

  it('白名单外键坏形丢条点名（anthropic 腿 allowedFallbackModels / openai 腿嵌套四键）', () => {
    expect(customCompatProblem('anthropic-messages', { allowedFallbackModels: [] })).toContain('不被支持');
    for (const key of ['chatTemplateKwargs', 'chatTemplateArgs', 'openRouterRouting', 'vercelGatewayRouting']) {
      expect(customCompatProblem('openai-completions', { [key]: {} })).toContain('不被支持');
    }
    // 腿分家：anthropic 腿开 openai 腿键 = 未知键（白名单不跨腿）
    expect(customCompatProblem('anthropic-messages', { supportsStrictMode: true })).toContain('不被支持');
  });

  it('值域执法：boolean 键拒非布尔 / 枚举键拒越域值 / 数值键拒字符串', () => {
    expect(customCompatProblem('anthropic-messages', { supportsStrictTools: 'yes' })).toContain('supportsStrictTools');
    // anthropic 腿 sessionAffinityFormat 单值闭集——openai 腿三值 'openai' 在此越域
    expect(customCompatProblem('anthropic-messages', { sessionAffinityFormat: 'openai' })).toContain(
      'sessionAffinityFormat',
    );
    expect(customCompatProblem('openai-completions', { thinkingFormat: 'not-a-format' })).toContain('thinkingFormat');
    expect(customCompatProblem('openai-completions', { vllmPriority: 'high' })).toContain('vllmPriority');
  });

  it('ToolChanges/ToolAdditions 单开依赖违例（两腿同形执法——齐开即好形）', () => {
    // anthropic 腿：ToolChanges 单开 = 静默 no-op → 坏形丢条点名
    expect(customCompatProblem('anthropic-messages', { supportsMidConvoToolChanges: true })).toContain(
      'supportsMidConvoToolChanges 需与 supportsMidConvoSystemMessages 同时开启',
    );
    // openai 腿对称件：ToolAdditions 单开同形
    expect(customCompatProblem('openai-completions', { supportsMidConvoToolAdditions: true })).toContain(
      'supportsMidConvoToolAdditions 需与 supportsMidConvoSystemMessages 同时开启',
    );
    // 齐开 = 好形（依赖满足——pi-3 件 B 原位增量块的联动开关）
    expect(
      customCompatProblem('anthropic-messages', {
        supportsMidConvoSystemMessages: true,
        supportsMidConvoToolChanges: true,
      }),
    ).toBeUndefined();
  });

  it('非对象形坏形点名', () => {
    expect(customCompatProblem('anthropic-messages', 'yes')).toContain('compat 须为对象');
    expect(customCompatProblem('openai-completions', [1])).toContain('compat 须为对象');
  });
});

describe('pi-8 批判据单源（采样参两函数——黑名单 25 键 + 标量 + 档位五档闭集〔pi-4 批升格〕）', () => {
  /** 黑名单 25 键全集（= pi-ai buildParams 具名赋位测绘闭集——升级随迁重测绘） */
  const FORBIDDEN_25 = [
    'model',
    'messages',
    'stream',
    'stream_options',
    'store',
    'prompt_cache_key',
    'prompt_cache_retention',
    'max_tokens',
    'max_completion_tokens',
    'temperature',
    'tools',
    'tool_stream',
    'tool_choice',
    'priority',
    'enable_thinking',
    'reasoning_effort',
    'reasoning',
    'thinking',
    'chat_template_kwargs',
    'chat_template_args',
    'provider',
    'providerOptions',
    'thinking_token_budget',
    'thinking_budget',
    'thinking_budget_tokens',
  ] as const;

  it('黑名单 25 键逐键恒拒（预算护栏旁路面——samplingParams 尾段 Object.assign 覆盖一切具名位）', () => {
    expect(FORBIDDEN_25).toHaveLength(25); // 全集计数锁（防例示截取）
    for (const key of FORBIDDEN_25) {
      expect(customSamplingParamsProblem({ [key]: 1 })).toContain(`键「${key}」不允许`);
    }
  });

  it('自由键好形（string/number/boolean 标量）+ 非标量值拒（防结构注入）', () => {
    expect(customSamplingParamsProblem({ top_p: 0.9, top_k: 5, frequency_penalty: 0.1, seed: 42 })).toBeUndefined();
    expect(customSamplingParamsProblem({ presence_penalty: true })).toBeUndefined();
    expect(customSamplingParamsProblem({ custom_flag: 'yes' })).toBeUndefined();
    expect(customSamplingParamsProblem({ nested: { a: 1 } })).toContain('JSON 标量');
    expect(customSamplingParamsProblem({ arr: [1] })).toContain('JSON 标量');
    expect(customSamplingParamsProblem({ nil: null })).toContain('JSON 标量');
  });

  it('按档表：档位键五档闭集（pi-4 批升格扩容）+ 叶值内外两层同执法', () => {
    expect(customSamplingParamsByThinkingLevelProblem({ off: { top_p: 0.9 } })).toBeUndefined();
    // pi-4 批升格：reasoning:true 后实际可产集恰五档——off/minimal/low/medium/high 全合法
    expect(customSamplingParamsByThinkingLevelProblem({ low: { top_p: 0.9 } })).toBeUndefined();
    expect(customSamplingParamsByThinkingLevelProblem({ high: { top_p: 0.9 } })).toBeUndefined();
    // 五档之外（xhigh/max 须 thinkingLevelMap 显式条目——自定义渠道恒不可产
    // = 静默死键，诚实律拒；随 map 声明面立题扩）+ 07 替词表「级别」形文案
    expect(customSamplingParamsByThinkingLevelProblem({ xhigh: { top_p: 0.9 } })).toContain('级别「xhigh」不支持');
    expect(customSamplingParamsByThinkingLevelProblem({ max: { top_p: 0.9 } })).toContain('级别「max」不支持');
    // 叶值同黑名单+标量两判据（内外两层同执法）
    expect(customSamplingParamsByThinkingLevelProblem({ off: { max_tokens: 999 } })).toContain(
      'samplingParamsByThinkingLevel.off 键「max_tokens」不允许',
    );
    expect(customSamplingParamsByThinkingLevelProblem({ off: { nested: {} } })).toContain(
      'samplingParamsByThinkingLevel.off.nested 值须为 JSON 标量',
    );
    expect(customSamplingParamsByThinkingLevelProblem('nope')).toContain('须为对象');
  });
});

describe('pi-4 批声明面（thinkingBudgets 判据 + reasoning 升格 + def 注册表承载面）', () => {
  it('思考预算判据（pi-4 批）：四键闭集+正整数——0/负数/非整数/xhigh 键全拒', () => {
    // 好形：四键闭集内子集+正整数
    expect(customThinkingBudgetsProblem({ low: 4096, high: 16384 })).toBeUndefined();
    expect(customThinkingBudgetsProblem({ minimal: 1 })).toBeUndefined();
    // 0 形两义拒收（openai 腿 ≤0 不发 / anthropic 腿 min 形）+ 负数 + 非整数
    expect(customThinkingBudgetsProblem({ low: 0 })).toContain('须为 ≥1 的整数');
    expect(customThinkingBudgetsProblem({ low: -100 })).toContain('须为 ≥1 的整数');
    expect(customThinkingBudgetsProblem({ low: 1.5 })).toContain('须为 ≥1 的整数');
    expect(customThinkingBudgetsProblem({ low: '4096' })).toContain('须为 ≥1 的整数');
    // 四键闭集外（xhigh/max 请求档预算侧由 pi-ai clampReasoning 降 high——不设键）
    expect(customThinkingBudgetsProblem({ xhigh: 8192 })).toContain('级别「xhigh」不支持');
    expect(customThinkingBudgetsProblem({ off: 8192 })).toContain('级别「off」不支持');
    expect(customThinkingBudgetsProblem('nope')).toContain('须为对象');
  });

  it('reasoning 升格 + def 注册表（pi-4 批承载面——工厂侧单点维护）', () => {
    const resolveKey = (): undefined => undefined;
    // 缺省占位维持 false（不宣称网关不可知的推理支持）
    const legacy = createCustomChannelProvider(
      'rg-legacy',
      { protocol: 'openai-completions', baseUrl: 'https://g.test/v1', models: ['m1'] },
      resolveKey,
    );
    expect(legacy.getModels()[0]!.reasoning).toBe(false);
    expect(customThinkingBudgetsFor('rg-legacy')).toBeUndefined(); // 未声明缺席形
    // 升格形：reasoning 直挂 Model + 预算进注册表（查询浅拷贝）
    const def: CustomProviderDef = {
      protocol: 'openai-completions',
      baseUrl: 'https://g.test/v1',
      models: ['m1'],
      reasoning: true,
      thinkingBudgets: { low: 4096, high: 16384 },
    };
    const upgraded = createCustomChannelProvider('rg-up', def, resolveKey);
    expect(upgraded.getModels()[0]!.reasoning).toBe(true);
    expect(customThinkingBudgetsFor('rg-up')).toEqual({ low: 4096, high: 16384 });
    // 浅拷贝锁：外改查询产物不串写注册表
    const leaked = customThinkingBudgetsFor('rg-up') as Record<string, number>;
    leaked['low'] = -1;
    expect(customThinkingBudgetsFor('rg-up')).toEqual({ low: 4096, high: 16384 });
    // 除名摘表（卸载腿同步——运行时除名与声明面除名同批回撤）
    unregisterCustomProviderDef('rg-up');
    expect(customThinkingBudgetsFor('rg-up')).toBeUndefined();
    // 重注册覆盖同 id（向导编辑 = 删除+重建形）
    createCustomChannelProvider('rg-up', def, resolveKey);
    expect(customThinkingBudgetsFor('rg-up')).toEqual({ low: 4096, high: 16384 });
    unregisterCustomProviderDef('rg-up'); // 测试收尾清表
    unregisterCustomProviderDef('rg-legacy');
  });
});
