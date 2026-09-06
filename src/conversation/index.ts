/**
 * conversation 模块公开面（02 §4.1 #11 对话本体——裁决①并入不可卸）。
 *
 * 批 11b 契约先行起面：构造契约（ConversationDriverOptions + 注入族）与
 * 重播种纯函数；driver 本体（loop 驱动 / 三通道路由 / 取消模型 / durable
 * 接线 / open 域工具 / 审批三件 / ctx.agent / 多会话）随 11c-11f 纵切
 * 逐批入此面，批 12 host 装配根消费。
 */
export type { ConversationDriverOptions, ReseededTimeline, RetryPolicyConfig, SubmitOptions } from './types.js';
export { DEFAULT_RETRY_POLICY } from './types.js';
export { reseedTimeline } from './reseed.js';
