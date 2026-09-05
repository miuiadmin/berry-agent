/**
 * llm — 模型标识解析（04 §5 模型标识解析细则：model 为字符串 id，解析归 llm 模块）。
 *
 * 约定形式：`"provider/model-id"`，**首斜杠分割**——provider 不得含斜杠，
 * model-id 允许再含斜杠（openrouter 路径式 id 如 `openrouter/qwen/qwen3-coder`
 * → provider=openrouter、id=qwen/qwen3-coder）。agent loop 全程只传字符串，
 * Model 对象在 LLM 调用边界才解析。
 *
 * 同文件承载缺省模型声明与 env 覆盖（04 §5 + 07 篇表 #4/#6）：缺省
 * `anthropic/claude-sonnet-5` 随包声明，BERRY_AGENT_MODEL 覆盖（用户级一次性
 * 换脑，不落库）。
 */

import { BaseError } from '../contracts/index.js';
import type { Model, Models } from '@earendil-works/pi-ai';

/** 缺省模型（07 篇表 #6 拍板：anthropic/claude-sonnet-5——随包声明） */
export const DEFAULT_MODEL_SPEC = 'anthropic/claude-sonnet-5';

/**
 * 解析缺省模型标识（04 §5：BERRY_AGENT_MODEL 覆盖缺省模型）。
 * @param env 环境变量面（缺省 process.env——测试注入）
 * @returns 生效模型标识（env 未设/空串回落 DEFAULT_MODEL_SPEC；env 值本身的
 *          合法性留给 resolveModel fail-loud——此处不做二次校验）
 */
export function resolveDefaultModelSpec(env: Record<string, string | undefined> = process.env): string {
  const override = env.BERRY_AGENT_MODEL;
  return override !== undefined && override !== '' ? override : DEFAULT_MODEL_SPEC;
}

/** 解析产物：provider 名 + 该 provider 目录内的模型 id */
export interface ModelSpec {
  provider: string;
  id: string;
}

/**
 * 解析模型标识字符串（纯语法层，不查目录）。
 * @param spec 形如 "provider/model-id"；provider 段与 id 段均须非空
 * @throws BaseError(LLM_MODEL_SPEC_INVALID) 格式非法时
 */
export function parseModelSpec(spec: string): ModelSpec {
  const slashIndex = spec.indexOf('/');
  if (slashIndex <= 0 || slashIndex >= spec.length - 1) {
    throw new BaseError(
      'LLM_MODEL_SPEC_INVALID',
      `模型标识格式非法："${spec}"——必须是 "provider/model-id" 形式（如 ${DEFAULT_MODEL_SPEC}，首斜杠分割）`,
    );
  }
  return { provider: spec.slice(0, slashIndex), id: spec.slice(slashIndex + 1) };
}

/**
 * 组回标准形式（与 parseModelSpec 互逆；目录清单展示用）。
 */
export function formatModelId(provider: string, id: string): string {
  return `${provider}/${id}`;
}

/**
 * 在 Models 目录中解析模型标识为具体 Model 对象（fail-loud 路径，供 UI/装配层用）。
 * @throws BaseError(LLM_MODEL_NOT_FOUND) provider 未注册或模型不在目录时
 */
export function resolveModel(models: Models, spec: string): Model<string> {
  const { provider, id } = parseModelSpec(spec);
  if (!models.getProvider(provider)) {
    throw new BaseError('LLM_MODEL_NOT_FOUND', `provider 未注册：${provider}（标识 "${spec}"）`);
  }
  const model = models.getModel(provider, id);
  if (!model) {
    throw new BaseError('LLM_MODEL_NOT_FOUND', `模型不存在：${spec}——该 provider 目录中的模型 id 无此条目`);
  }
  return model;
}
