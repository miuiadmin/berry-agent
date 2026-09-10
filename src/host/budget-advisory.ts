/**
 * host/budget-advisory — 预算预警文案铸造（04 §5 软着陆层——遗漏审计批 H）。
 *
 * 04 §5 预算预警条款的文案本体位：档位判定与投影读面在 llm 件单源
 * （budgetAdvisoryLevel / backgroundUsage），本件只做两件事——
 *  1. 预算帽下活判据：本层只对预算帽下的活生效（headless root run 与子代理；
 *     前台会话恒放行无池可警——'conversation' / 'import' / 'fork' 三 origin
 *     不注入）；
 *  2. root 与 subagent 各配分级 wrap-up 文案（三档 × 两族）：CRITICAL 档指令
 *     「收尾：陈述当前结论与未竟项」而非续开新腿——预算尽头的最后 token
 *     花在收口上。
 *
 * 产物 = 纯文本（经 driver 的 budgetAdvisory 注入位以瞬态 UserMessage 进请求
 * 组装尾——不落 durable 不进快照，与披露段/todo 回看同律）。本件零状态零 IO
 * （纯函数族），装配根闭包消费（assembly）。
 */
import { budgetAdvisoryLevel, type BackgroundBudgetUsage } from '../llm/index.js';
import type { SessionOrigin } from '../contracts/index.js';

/** 百分比渲染（四舍五入取整——文案显示位非账面值） */
function pctOf(ratio: number): number {
  return Math.round(ratio * 100);
}

/**
 * root 档文案族（headless 主循环——issue 道 / 触发器道 / goal 续跑道）：
 * 面向「任务的所有者」——三档递进收敛（收敛探索面 → 停开新腿 → 立即收尾）。
 */
function rootMessage(level: 'notice' | 'urgent' | 'critical', usage: BackgroundBudgetUsage): string {
  const pct = pctOf(usage.ratio);
  const scale = `当日后台预算已用约 ${pct}%（${usage.spent}/${usage.limit} tokens）`;
  if (level === 'notice') {
    return `[预算提示 NOTICE] ${scale}。请收敛探索面，优先主线任务。`;
  }
  if (level === 'urgent') {
    return `[预算预警 URGENT] ${scale}。请停止开启新的工作腿，专注完成当前任务。`;
  }
  return `[预算临界 CRITICAL] ${scale}。请立即收尾：陈述当前结论与未竟项，不要再开启新的工作腿。`;
}

/**
 * subagent 档文案族（委派子代理——任务黑盒）：面向「单任务的执行者」——
 * 收敛本任务范围；CRITICAL 档汇报归路（父会话将据此结算）。子代理另有 90%
 * reserve 线强停（subagent-factory 执法），本层是强停之前的软着陆带。
 */
function subagentMessage(level: 'notice' | 'urgent' | 'critical', usage: BackgroundBudgetUsage): string {
  const pct = pctOf(usage.ratio);
  const scale = `当日后台预算池已用约 ${pct}%`;
  if (level === 'notice') {
    return `[预算提示 NOTICE] ${scale}。请收敛本任务范围，避免不必要的大范围探索。`;
  }
  if (level === 'urgent') {
    return `[预算预警 URGENT] ${scale}。请停止扩展任务面，专注完成当前子任务。`;
  }
  return `[预算临界 CRITICAL] ${scale}。请立即收尾：汇报当前结论与未竟项（父会话将据此结算），不要再开启新的工作腿。`;
}

/**
 * 预算预警文案总入口（04 §5——root/subagent 分族）：
 *  - 未达 notice 线（< 70%）→ null 零注入；
 *  - origin 'trigger'（headless root 两道：issue-session / triggers）→ root 族；
 *  - origin 'delegation'（in-process 子代理）→ subagent 族；
 *  - 其余 origin（'conversation' / 'import' / 'fork' = 前台恒放行无池可警）
 *    → null；不在册会话（origin undefined，如 dismantle 后）同 null。
 */
export function budgetAdvisoryMessage(usage: BackgroundBudgetUsage, origin: SessionOrigin | undefined): string | null {
  const level = budgetAdvisoryLevel(usage.ratio);
  if (level === null) return null;
  if (origin === 'trigger') return rootMessage(level, usage);
  if (origin === 'delegation') return subagentMessage(level, usage);
  return null;
}
