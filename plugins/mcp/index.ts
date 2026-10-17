/**
 * core:mcp 公开面（02 §4.1 席 deps {contracts, context}——stdio 行帧
 * JSON-RPC 手写最小桥，03 §10.1）。
 *
 * 装载态集成归批 12 装载面后装配批：core:mcp 插件装载时组服务（spawn 窄面
 * 注入 exec 管道真身、registry 窄面注入 tools 注册表真身、scope = ctx 作
 * 用域、notify 接 ui.notify warn 面）→ config.servers 归一 → apply 异步发现
 * → 注册进全局层。
 */
import './codes.js';

// 类型与常量
export type {
  McpConfig,
  McpServerConfig,
  McpServerTool,
  McpChildFace,
  McpSpawnFace,
  McpRegisterToolsFace,
  McpScopeFace,
} from './types.js';
export {
  MCP_SERVER_NAME_RE,
  MCP_STARTUP_TIMEOUT_SEC_DEFAULT,
  MCP_TOOL_TIMEOUT_SEC_DEFAULT,
  MCP_LINE_LIMIT_BYTES,
  MCP_NATIVE_TOOL_LIMIT,
  MCP_CLOSE_GRACE_MS,
  MCP_PROTOCOL_VERSION,
  normalizeMcpConfig,
} from './types.js';

// 行帧 JSON-RPC 协议腿
export { LineDecoder, JsonRpcConnection, JsonRpcError } from './jsonrpc.js';
export type { JsonRpcConnectionOptions, JsonRpcErrorObject } from './jsonrpc.js';

// 服务器桥
export { connectMcpServer } from './bridge.js';
export type { McpBridge, McpBridgeDeps } from './bridge.js';

// 工具注册面
export { MCP_DIRECTORY_TOOL_NAME, mcpToolKey, splitMcpToolKey, filterServerTools, buildMcpToolDefs } from './tools.js';
export type { McpToolSource, McpToolSurface, McpBuildDef } from './tools.js';

// 服务编排
export { createMcpService } from './service.js';
export type { McpService, McpServiceDeps, McpLiveServer } from './service.js';
