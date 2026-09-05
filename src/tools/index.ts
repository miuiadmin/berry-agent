/**
 * tools 件公开面（三段管道 + 两层注册表 + fs 工具族；04 篇 §7）。
 *
 * 单向 DAG：tools → contracts + context（02 篇 §4 模块表 L2 席）。conversation
 * /safety/exec 等后续件经本面消费：safety 守门行订阅 tools_pre_execute、
 * conversation 经注册表 agentToolsFor 取 loop 工具面、exec/bash 复用写串行
 * 链。错误码注册（codes.ts）随本面引入生效——与 llm/session 的 codes.ts 同
 * 款纪律（写入点文件实际 import 注册才发生）。
 */
import './codes.js';

export { createToolPipeline, OUTPUT_GUARD_BYTES } from './pipeline.js';
export type { ToolPipelineOptions } from './pipeline.js';
export { createToolRegistry, scanToolDescription, toAgentTool, TOOL_TIMEOUT_FLOOR_MS } from './registry.js';
export type { ToolRegistry, ToolRegistryOptions } from './registry.js';
export { ObservedFiles, statVersion, resolveWriteIntent, requireObservedForEdit } from './observed.js';
export type { ObservedState, WriteIntent } from './observed.js';
export { parseApplyPatch, applyUpdateLines, addLinesToContent } from './apply-patch.js';
export type { PatchOperation, PatchLine } from './apply-patch.js';
export { createFsTools, canonicalize, serializeWrites, assertTargetStable } from './fs.js';
export type { FsTools, FsToolsOptions } from './fs.js';
