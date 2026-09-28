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
import { createCustomChannelProvider, fauxProvider, resolveModel, type CustomProviderDef } from './index.js';
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
