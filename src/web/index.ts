/**
 * web 模块公开面（L3 core: 官方插件 15 之 #6——02 §4.1 席 18 / 07 §1.1
 * core:web 行：fetch 工具 + ctx.fetch 服务 + SSRF 五卫生件〔两消费面同一
 * execute〕）。
 *
 * 本批（14c）纯逻辑腿：卫生件纯函数 + 在飞门 + 服务（唯一 execute 编排）+
 * fetch 工具定义。装载态集成（core:web 官方引用形 apply——注册工具 + provide
 * ctx.fetch 服务 + 归因 sink 接 durable 落账面 + 与 browser 共享同一在飞门
 * 实例）归批 12 装载面后装配批（03 §1.4 官方引用形；批序档装载面前置律）。
 */
import './codes.js';

export type {
  WebConsumer,
  WebFetchLimits,
  WebFetchInit,
  WebFetchResponse,
  WebAttributionRecord,
  WebAttributionSink,
  DnsResolver,
  FetchLike,
  WebFetchDeps,
  WebFetchService,
  InFlightGate,
} from './types.js';
export { createInFlightGate } from './gate.js';
export { WEB_PROTOCOLS, defaultDnsResolver, parseWebUrl, isPrivateHostLiteral, assertPublicHost } from './hygiene.js';
export { createWebFetchService, DEFAULT_WEB_LIMITS } from './service.js';
export { createFetchTool } from './tool.js';
