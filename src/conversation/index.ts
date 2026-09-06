/**
 * conversation 模块公开面（02 §4.1 #11 对话本体——裁决①并入不可卸）。
 *
 * 批 11b 契约先行起面：构造契约（ConversationDriverOptions + 注入族）与
 * 重播种纯函数；批 11c 起 driver 本体入此面（durable 接线 + runTurns 重试
 * 循环 + 溢出兜底 + 队列通道机制面）；三通道路由收口/取消模型/resume 续接
 * 归 11d，open 域工具与审批三件归 11e，ctx.agent / 多会话 / 披露段注入归
 * 11f；批 12 host 装配根消费。
 */
export type { ConversationDriverOptions, ReseededTimeline, RetryPolicyConfig, SubmitOptions } from './types.js';
export { DEFAULT_RETRY_POLICY } from './types.js';
export { reseedTimeline } from './reseed.js';
export { ConversationDriver } from './driver.js';
export type { SubmitResult } from './driver.js';
