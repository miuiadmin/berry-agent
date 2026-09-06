/**
 * 派生工具面计算（04 §10）：子代理工具面 = 父会话工具面 − 五名
 * （fs read/write/edit/ls + bash）∩ 白名单。纯函数——机器与测试共用。
 */
import { EXCLUDED_FROM_DERIVED_SURFACE } from './types.js';

/**
 * 派生面：父工具名序列 − 结构性排除五名。
 * 五名剔除语义：fs 四名子自建（驱动层注册——结构性不入派生集）；bash 系
 * 「永不升格」总则的特例条款（子管道无人在场应答 def 内部升权）。
 * 保序（父注册序）；白名单含被排除名 → 该名被结构性剔除而非报错
 * （结构性条款优先于声明面——不产生「声明了但拿不到」的歧义回执，
 * 交集结果本身即回执）。
 */
export function deriveToolSurface(parentToolNames: readonly string[]): string[] {
  const excluded = new Set(EXCLUDED_FROM_DERIVED_SURFACE);
  return parentToolNames.filter((name) => !excluded.has(name));
}

/**
 * 白名单交集执法（04 §10 请求含工具白名单——与 def 的 tools 交集）：
 * 有效面 = 派生面 ∩ 白名单（保派生面注册序）。白名单缺省（undefined）=
 * 全派生面；空白名单（[]）= 空面（合法——纯提示词子代理）。
 */
export function intersectToolWhitelist(
  derivedSurface: readonly string[],
  whitelist: readonly string[] | undefined,
): string[] {
  if (whitelist === undefined) return [...derivedSurface];
  const allow = new Set(whitelist);
  return derivedSurface.filter((name) => allow.has(name));
}

/**
 * 前置要求预检（04 §10 静默退化防御②）：缺口 = requires 中不在可用面
 * （父会话全工具名——注意判据是**全父面**非派生面：前置要求声明的是
 * 「宿主工具面的前置要求」，与派生面剔除正交——模型若前置要求 bash
 * 而父面有 bash，预检过（bash 的结构性剔除走派生面另一层））。
 * 返回缺口清单（空 = 预检过）。
 */
export function findPrecheckGaps(
  requiresTools: readonly string[] | undefined,
  availableToolNames: readonly string[] | undefined,
): string[] {
  if (requiresTools === undefined || requiresTools.length === 0) return [];
  // 可用面缺席 = 宿主工具面不可枚举——fail-closed 全列（不降级瞎跑）
  if (availableToolNames === undefined) return [...requiresTools];
  const available = new Set(availableToolNames);
  return requiresTools.filter((name) => !available.has(name));
}
