/**
 * llm — 模型标识解析测试（04 §5 模型标识解析细则 + 缺省模型 env 覆盖）。
 *
 * faux provider 注入 Models 目录（零网络的真实 pi-ai 代码路径）。
 */
import { describe, expect, it } from 'vitest';
import { fauxProvider } from './index.js';
import { createLlmRuntime } from './runtime.js';
import {
  DEFAULT_MODEL_SPEC,
  formatModelId,
  parseModelSpec,
  resolveDefaultModelSpec,
  resolveModel,
} from './model-id.js';
import { BaseError } from '../contracts/index.js';

/** 断言抛指定码（同步路径） */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('未拒绝');
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

/** faux 运行时（models m1/m2 入目录——resolveModel 的目录判定面） */
function makeFauxRuntime() {
  const faux = fauxProvider({ provider: 'faux-test', models: [{ id: 'm1' }, { id: 'm2' }] });
  const runtime = createLlmRuntime({ providers: [faux.provider] });
  return { faux, runtime };
}

describe('parseModelSpec / formatModelId（纯语法层）', () => {
  it('合法：provider/model-id；model-id 允许再含斜杠（openrouter 路径式——首斜杠分割）', () => {
    expect(parseModelSpec('anthropic/claude-sonnet-5')).toEqual({ provider: 'anthropic', id: 'claude-sonnet-5' });
    expect(parseModelSpec('openrouter/qwen/qwen3-coder')).toEqual({ provider: 'openrouter', id: 'qwen/qwen3-coder' });
    // 组回标准形与解析互逆
    expect(formatModelId('openrouter', 'qwen/qwen3-coder')).toBe('openrouter/qwen/qwen3-coder');
  });

  it('非法格式：无斜杠 / 空 provider / 空 id → LLM_MODEL_SPEC_INVALID', () => {
    for (const bad of ['gpt4', '/model', 'provider/', '/']) {
      expectCode(() => parseModelSpec(bad), 'LLM_MODEL_SPEC_INVALID');
    }
  });
});

describe('resolveDefaultModelSpec（env 覆盖）', () => {
  it('未设 / 空串回落缺省；非空值透传（值本身合法性留给 resolveModel fail-loud）', () => {
    expect(resolveDefaultModelSpec({})).toBe(DEFAULT_MODEL_SPEC);
    expect(resolveDefaultModelSpec({ BERRY_AGENT_MODEL: '' })).toBe(DEFAULT_MODEL_SPEC);
    expect(resolveDefaultModelSpec({ BERRY_AGENT_MODEL: 'x/y' })).toBe('x/y');
    // 非法值不在本层拦截——resolveModel 层统一 fail-loud（单一拒绝面）
    expect(resolveDefaultModelSpec({ BERRY_AGENT_MODEL: 'no-slash' })).toBe('no-slash');
  });
});

describe('resolveModel（目录判定，fail-loud）', () => {
  it('在册模型 → 返回 Model（provider 内 id 定位）', () => {
    const { runtime } = makeFauxRuntime();
    const model = resolveModel(runtime.models, 'faux-test/m2');
    expect(model.id).toBe('m2');
    expect(model.provider).toBe('faux-test');
  });

  it('provider 未注册 / 模型不在目录 → LLM_MODEL_NOT_FOUND（文案区分两种缺席）', () => {
    const { runtime } = makeFauxRuntime();
    expectCode(() => resolveModel(runtime.models, 'nope/m1'), 'LLM_MODEL_NOT_FOUND');
    expectCode(() => resolveModel(runtime.models, 'faux-test/m9'), 'LLM_MODEL_NOT_FOUND');
  });

  it('格式非法先于目录判定 → LLM_MODEL_SPEC_INVALID（语法层先行）', () => {
    const { runtime } = makeFauxRuntime();
    expectCode(() => resolveModel(runtime.models, 'faux-test'), 'LLM_MODEL_SPEC_INVALID');
  });
});
