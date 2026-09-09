/**
 * core:sdk 件域（批 13e 起域——03 §10.6 件身份条：HTTP+SSE 传输与 MCP
 * server 包装归本件；协议核心与 stdio 归宿主/channels 侧既有）。
 *
 * 本笔（13e-1）= 契约先行：HTTP 面端点词面（03 §10.6 批 13e 落码定形注①）
 * + 开面配置形（07 §5 serve 旗标族落码定名——sock 缺省接入点/TCP 可选位/
 * 凭证双载体）+ 三防线判定器与 token 生成（10.4 回环钉死条款同律复用 +
 * 差异面④ Host 扩集谓词）。传输实装（node:http 微路由 + SSE + 一核多流
 * 扇出）随 13e-2 兑现（本域 http 件）；daemon 编舞（pid/sock/log 三足迹 +
 * serve status/stop）随 13e-3；MCP server 包装（行帧 JSON-RPC 反向位、
 * 工具面收窄两件——`berry-agent`/`berry-agent-reply`）随 13f 兑现（本域
 * mcp 件）。
 *
 * 装配纪律（件不 import 宿主实现——webui claim 桥晚绑同款）：协议核经
 * channels 公开面消费（SdkWireDeps 由宿主装配桥注入），本域零 host 依赖。
 */
export * from './types.js';
export * from './security.js';
export * from './http.js';
export * from './mcp.js';
export * from './plugin-routes.js';
