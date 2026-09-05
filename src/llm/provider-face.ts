/**
 * llm — 虚拟键 `berry-agent/llm` 注入物（03 篇 §3.2 虚拟面六键之一：
 * 「LLM 工厂面（pi-ai 适配的 provider API face）——模型层正路」）。
 *
 * provider 插件的正确路径：用**宿主同版本**的 pi-ai 工厂族造 provider，再经
 * ctx.llm.registerProvider 入册——不自捆 pi-ai 副本（双实例 = 传输层行为分叉
 * 的温床，03 §3.2「防双实例」纪律）、不自拼 fetch。
 *
 * 拓扑护栏：本面对象由 host 装配根经 jiti transform 注入插件模块说明符
 * `berry-agent/llm`——pi-ai 裸导入纪律（仅 llm 模块）因此不破，模块 DAG 不变。
 */

import { createProvider, hasApi, lazyApi } from '@earendil-works/pi-ai';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';

/**
 * 虚拟键注入物：pi-ai provider 工厂族再导出对象。
 *
 * - createProvider / hasApi（models 出口）：造 provider 实例 + Model 的 api
 *   收窄守卫——插件 registerProvider 路径的两件套；
 * - lazyApi（api/lazy 出口）：动态 api 模块包装器（首调用才加载）；
 * - anthropicMessagesApi（Anthropic-first 直取便捷键）：其余 provider 的 lazy
 *   工厂（openai/google/…共十余家）经 pi-ai 子路径
 *   `@earendil-works/pi-ai/api/<name>.lazy` 可达——插件应优先走 createProvider
 *   全链而非裸拿 api 流；确需扩展时按需增键（单键解决一个 provider 的诉求，
 *   成批抄全 = 面无纪律）。
 */
export const providerApiFace = {
  createProvider,
  hasApi,
  lazyApi,
  anthropicMessagesApi,
} as const;
