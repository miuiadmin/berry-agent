/**
 * SDK 通道后端件内聚合面（channels 通道核第三后端——03 篇 §10.6 件身份条：
 * 协议核心代码位与 channels 通道核同体，UiBackend 多后端接口位既有）。
 *
 * 批 13a 契约先行笔 = 协议词汇/信封 + NDJSON 编解码 + admit/游标纯逻辑；
 * 批 13b = 线协议核心（wire-core 单连接状态机：六动词受理/活体外推/心跳
 * 装配面/出站有界队列背压）+ 后端实装（13b-3）。stdio 传输归宿主 serve
 * （07 §5）；HTTP+SSE 与 MCP 包装归 core:sdk 件（src/sdk/ 批 13e）。
 *
 * SDK_ 五码注册在 contracts 错误码注册表 CORE_ERROR_CODES（规范定名码直入
 * contracts 的仓内先例——CHANNEL_/AGENT_ 同款；注册笔系并行会话〔批 12 泳道〕
 * 先行落、本批收编，勿在本件重复注册）。
 */
export * from './protocol.js';
export * from './jsonl.js';
export * from './admit.js';
export * from './cursor.js';
export * from './wire-core.js';
export * from './backend.js';
