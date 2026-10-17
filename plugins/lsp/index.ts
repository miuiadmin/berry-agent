/**
 * core:lsp 公开面（02 §4.1 席位 core:lsp——Content-Length 帧手写 + 惰性
 * per-(server, rootUri) 实例 + 诊断回流，03 §10.2 六条款全兑现）。
 *
 * DAG deps = {contracts, context}；spawn/注册/作用域/事件/文件系统全经窄面
 * 注入（LspSpawnFace 等——compat.test 真 SpawnPipeline 结构互证）。装载态
 * 集成归批 12 装载面后的装配批。
 */
import './codes.js';

export * from './types.js';
export { FrameDecoder, encodeFrame } from './frame.js';
export { LspWire } from './connection.js';
export type { LspWireOptions, LspNotification } from './connection.js';
export { connectLspInstance } from './instance.js';
export type { LspInstance, LspInstanceDeps, LspDiagnosticItem } from './instance.js';
export { buildLspToolDefs } from './tools.js';
export type { LspToolFace } from './tools.js';
export { createDiagnosticsInjector } from './inject.js';
export type { LspInjectFace, LspInjectorDeps } from './inject.js';
export { createLspService } from './service.js';
export type { LspService, LspServiceDeps } from './service.js';
