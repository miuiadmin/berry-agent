/**
 * L3 safety 公开面（02 篇席 8：审批对 + 沙箱三档 + carve-out + 可写根推导 +
 * 权限预设 + 升权编舞）。
 *
 * 消费方：tools/fs 的 fence（createRootsProvider 数据源）、exec 的 bash 工具
 * 件（confine + 升权）、host 装配根（installSafetyGate + createApprovalService
 * + 持久/allowlist 接线）。权限预设（用户面打包）随 host 装配批落码。
 *
 * 引入 './codes.js' 触发 SANDBOX_ 三码注册（注册纪律：import 发生才注册——
 * 与 tools/llm/session 的 codes.ts 同款）。
 */
import './codes.js';

export * from './types.js';
export * from './roots.js';
export * from './allowlist.js';
export * from './approval.js';
export * from './sandbox.js';
export * from './seatbelt.js';
export * from './bwrap.js';
export * from './gate.js';
