/**
 * channels 模块公开面（L4 宿主固定件——02 篇席 10；机制真源 07 篇 §4.1/§4.3、
 * 03 篇 §2.2 命令面、04 篇 §4/§9）。
 *
 * 批 10a 落通道核（多会话信封分流 + 投影拉取注入 + 命令面 + ui 原语分发 +
 * 提问队列——零 pi-tui import）。TUI 实装：呈现面九件（07 §4.1 定稿——件 9
 * 非聚焦会话摘要行含内）与交互/补全族已落批 10e/10f；件 8 /history 副屏
 * 回看器归批 10f-4 未落（现状陈述——本面暂无其注册位）；host 装配接线
 * （bin 入口/启动会话策略）归批 12。
 */
export type {
  SessionEnvelope,
  UiCapabilities,
  UiBackend,
  UiAskOptions,
  UiSelectChoice,
  UiInputOptions,
  NotifyLevel,
  AskKind,
  ApprovalAskAnswer,
  ApprovalAskRequest,
  TodoItem,
  CommandArgs,
  CommandHandler,
  CommandSpec,
  ChannelsOptions,
} from './types.js';
export { CommandRegistry, tokenize } from './commands.js';
export { AskQueue } from './ask-queue.js';
export type { AskHooks } from './ask-queue.js';
export { UiCore } from './ui-core.js';
export { SessionChannels } from './registry.js';
export { createChannels } from './service.js';
export type { ChannelsService } from './service.js';
// TUI 后端实装（批 10e 落呈现纵切、批 10e-2/10f 扩交互与撤销面——host 装配
// 批 12 addBackend 消费；件内组件族〔engine/tui〕仍走各自聚合面，本面只进
// 后端装配物）
export type { TuiBackendOptions } from './tui/index.js';
export { TuiBackend } from './tui/index.js';
// SDK 线协议（批 13a 契约先行——03 §10.6 件身份条：协议核心代码位与 channels
// 通道核同体，SDK 通道后端 = UiBackend 第三后端；本面出协议词汇/信封 + NDJSON
// 编解码 + admit/游标纯逻辑四件。后端实装（事件外推/请求受理/出站队列）随批
// 13b；stdio 传输归宿主 serve、HTTP+SSE/MCP 归 core:sdk 件〔src/sdk/ 13e〕）
export * from './sdk/index.js';
