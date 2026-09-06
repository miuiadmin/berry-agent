/**
 * channels 模块公开面（L4 宿主固定件——02 篇席 10；机制真源 07 篇 §4.1/§4.3、
 * 03 篇 §2.2 命令面、04 篇 §4/§9）。
 *
 * 批 10a 落通道核（多会话信封分流 + 投影拉取注入 + 命令面 + ui 原语分发 +
 * 提问队列——零 pi-tui import）。TUI 实装（呈现面八件 + /history 副屏 +
 * @-mention 补全）归呈现批；host 装配接线（bin 入口/启动会话策略）归批 12。
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
// TUI 后端实装（批 10e 呈现纵切——host 装配批 12 addBackend 消费；件内
// 组件族〔engine/tui〕仍走各自聚合面，本面只进后端装配物）
export type { TuiBackendOptions } from './tui/index.js';
export { TuiBackend } from './tui/index.js';
