/**
 * 凭证 env 引用形（03 §10.9 注入腿——c-4 落码批）。
 *
 * 词面：`@credentials:<name>`（值位整串精确匹配——sigil 前缀 + 凭证名）。
 * 用户在 MCP/LSP server config 的 env 声明里以引用形代替明文：
 * `{ "GITHUB_TOKEN": "@credentials:github-token" }`——配置与 durable 面恒
 * 只见引用形原文，明文值只在 spawn 时刻经宿主展开进子进程环境（exec
 * buildChildEnv 单点——模型面/插件码面/工具结果结构性不见值）。
 *
 * 本文件是词面**单源**（跨模块契约词汇：exec 执法消费 + credentials
 * resolver 消费 + 用户 config 书写三方法源）：放 contracts 使两消费方均
 * 零新 DAG 边（exec 与 credentials 均既有 contracts 边）。纯数据/纯函数、
 * jiti 可载——与 api.ts 同族纪律。
 *
 * v1 无转义形：以 `@credentials:` 起头的 env 值一律视为引用形（该形在
 * env 值位无正当字面用途——逃生口挂账不需要）。
 */

/** 引用形 sigil 前缀（含冒号——`@credentials:`；名 = 前缀后的非空余段） */
export const CREDENTIALS_ENV_REF_PREFIX = '@credentials:';

/** 引用形解析结果（三态：非引用形 / 引用形携名 / 前缀命中而坏形） */
export type CredentialEnvRef =
  /** 非引用形——字面值原样放行 */
  | { readonly kind: 'none' }
  /** 引用形——name 为凭证作用名（host 域 provider 名） */
  | { readonly kind: 'ref'; readonly name: string }
  /** 坏形——前缀命中而名空（意图明确是引用形，fail-loud 拒字面注入） */
  | { readonly kind: 'invalid' };

/**
 * 解析 env 值是否为凭证引用形。
 * @param value env 声明值（set 面单值）
 * @returns 三态解析结果——'none' 字面放行 / 'ref' 交宿主展开 / 'invalid'
 *          前缀命中而名空（调用方以 CREDENTIALS_ENV_REF_INVALID 响亮拒）
 */
export function parseCredentialEnvRef(value: string): CredentialEnvRef {
  if (!value.startsWith(CREDENTIALS_ENV_REF_PREFIX)) {
    return { kind: 'none' };
  }
  const name = value.slice(CREDENTIALS_ENV_REF_PREFIX.length);
  return name === '' ? { kind: 'invalid' } : { kind: 'ref', name };
}
