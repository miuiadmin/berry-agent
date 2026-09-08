/**
 * credentials — 契约词面件（03 §10.9 凭证代管面）。
 *
 * namespace 值域与 meta 键约定的**单源**（物理载体在 persist 的 credentials
 * 表——05 §9 扩形列；本件只立词面，值域执法在 c-3 读腿受理位）：
 *   - namespace 列即归属列（立题档「namespace / 归属列」合取定形）：'host'
 *     （宿主自用域——模型 API key 与静态人面凭证）| 'plugin:<id>'（插件域）；
 *   - meta 列住条目来源（manual / oauth / refresh）与 expired 状态位
 *     （保留上次有效值律——条目不清删，撤销唯一路径 = 人面 rm）。
 *
 * persist 面签名用裸 string（DAG：credentials → persist 单向——persist 不
 * import 本件，值域类型不回流物理层）。
 */

/** 宿主域 namespace（模型 API key 射程界桩 + 静态人面凭证归属——03 §10.9） */
export const HOST_NAMESPACE = 'host' as const;

/** 插件域 namespace 形（模板字面量类型——'plugin:' 前缀 + 插件 id） */
export type PluginNamespace = `plugin:${string}`;

/** namespace 值域（归属判据即字面形——一列承载两概念，无需第二列） */
export type CredentialNamespace = typeof HOST_NAMESPACE | PluginNamespace;

/**
 * 插件域 namespace 构造器（c-3 读腿「恒自域」的物理键合成位——受理面以
 * 本插件 id 构造，插件面永不手拼字符串）。
 */
export function pluginNamespace(pluginId: string): PluginNamespace {
  return `plugin:${pluginId}`;
}

/** 插件域判定（值域窄化——'host' 与坏形前缀均 false） */
export function isPluginNamespace(namespace: string): namespace is PluginNamespace {
  return namespace.startsWith('plugin:') && namespace.length > 'plugin:'.length;
}

/** 插件域反解（取插件 id；非插件域返回 null——跨域审计/列示面消费） */
export function parsePluginNamespace(namespace: string): string | null {
  return isPluginNamespace(namespace) ? namespace.slice('plugin:'.length) : null;
}

/**
 * meta 列键约定（物理自由 JSON——本件钉两键语义，附加键开放）。
 * c-5 人面 / c-6 oauth 写入位按来源落 source；刷新失败缺省三振后置
 * expired（只标记不清删——保留上次有效值律）。
 */
export interface CredentialMeta {
  /** 条目来源（缺省未记——历史行/迁移回填行可无此键） */
  readonly source?: 'manual' | 'oauth' | 'refresh';
  /** 过期呈现位（true = 刷新三振后保留旧值的告示态） */
  readonly expired?: boolean;
  // 附加键开放（oauth 端点/账号句柄等 c-6 定形）
  readonly [key: string]: unknown;
}
