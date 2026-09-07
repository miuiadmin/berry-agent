/**
 * /goal 命令处理器（04 §12——/goal wake 手动起闹的纯程序面；list/show 观察面）。
 *
 * 形态律与 /tick 同族（tick.ts 先例）：六动词 argv → 人读文本；服务面守卫错
 * （BaseError）折文本不抛（命令面是用户面不是异常面）；唤醒裁决（WakeDecision）
 * 渲染落地/拒因。真正把唤醒消息投进会话的编舞归宿主装配（批 12）——本面只
 * 裁决与呈现。
 */
import { BaseError, type SessionEvent } from '../contracts/index.js';
import { foldGoalTodos, openGoalItems } from './fold.js';
import type { GoalService } from './service.js';

export const GOAL_USAGE = [
  '用法：/goal wake <goalId> —— 手动起闹（停滞/预算双复位 + 挂钟复活）',
  '　　　/goal list —— 全部 goal（状态/挂钟/预算速览）',
  '　　　/goal show <goalId> —— 单 goal 详情（计划态 + 归因唤醒审计）',
].join('\n');

/** 命令装配依赖 */
export interface GoalCommandDeps {
  service: GoalService;
  /** goal 段计划态 fold 面（open 项计数渲染——service.goalScopeFor 取锚；readonly = GoalSessionFace.events 同形直传） */
  eventsFor: (sessionId: string) => readonly SessionEvent[];
}

/** /goal 处理器（argv → 人读文本；守卫错折文本） */
export async function runGoalCommand(argv: readonly string[], deps: GoalCommandDeps): Promise<string> {
  const [verb, ...rest] = argv;
  try {
    switch (verb) {
      case 'wake': {
        const goalId = rest[0];
        if (!goalId) return `缺 goalId。\n${GOAL_USAGE}`;
        const decision = await deps.service.wake(goalId, { trigger: 'manual', attribution: '/goal wake' });
        return decision.landed
          ? `已手动唤醒 goal「${goalId}」（停滞/唤醒预算双复位，挂钟复活）。${decision.message}`
          : `唤醒未落地：${decision.message}`;
      }
      case 'list': {
        const rows = deps.service.list();
        if (rows.length === 0) return '无 goal。';
        const lines = rows.map((row) => {
          const budget =
            row.budgetMessagesCap === null
              ? '无预算帽'
              : `预算 ${row.budgetMessagesUsed + row.budgetFoldedUnits}/${row.budgetMessagesCap}`;
          const clock =
            row.status === 'active' ? (row.stallStreak > 0 ? `挂钟（停滞 ${row.stallStreak}）` : '挂钟在跑') : '已停摆';
          return `- ${row.id}〔${row.status}〕${row.objective.slice(0, 40)} —— ${clock} · ${budget}`;
        });
        return `共 ${rows.length} 个 goal：\n${lines.join('\n')}`;
      }
      case 'show': {
        const goalId = rest[0];
        if (!goalId) return `缺 goalId。\n${GOAL_USAGE}`;
        const row = deps.service.get(goalId);
        if (!row) return `goal「${goalId}」不存在。`;
        const scope = deps.service.goalScopeFor(row.sessionId);
        const items =
          scope !== undefined && scope.goalId === goalId
            ? openGoalItems(foldGoalTodos(deps.eventsFor(row.sessionId), row.activatedSeq))
            : [];
        const openLine =
          items.length === 0
            ? 'open 项：0'
            : `open 项：${items.length}（${items.map((i) => `[${i.status}] ${i.content}`).join('；')}）`;
        const wakes = deps.service.wakes(goalId);
        const wakeLines =
          wakes.length === 0
            ? '（无唤醒记录）'
            : wakes
                .slice(-5)
                .map(
                  (w) =>
                    `- ${w.wokeAt} ${w.trigger} 道 · ${w.progressed ? '有进展' : '无进展'} · 归因 ${w.attribution}`,
                )
                .join('\n');
        return [
          `goal「${goalId}」〔${row.status}〕`,
          `目标：${row.objective}`,
          `挂钟：${row.schedule}（激活锚 seq=${row.activatedSeq}，会话 ${row.sessionId}）`,
          `预算：前台 ${row.budgetMessagesUsed} + 委派折叠 ${row.budgetFoldedUnits}${row.budgetMessagesCap === null ? '（无帽）' : ` / 帽 ${row.budgetMessagesCap}`}`,
          `停滞计数：${row.stallStreak}（帽内复位靠进展或手动）`,
          openLine,
          row.endingNote !== null ? `终态回执：${row.endingNote}` : '',
          `唤醒审计（末 5 条）：\n${wakeLines}`,
        ]
          .filter((line) => line !== '')
          .join('\n');
      }
      case undefined:
      case 'help':
        return GOAL_USAGE;
      default:
        return `未知动词「${verb}」。\n${GOAL_USAGE}`;
    }
  } catch (err) {
    // 守卫错折文本（命令面是用户面——BaseError 码与人读原因直呈）
    if (err instanceof BaseError) return `${err.code}：${err.message}`;
    throw err;
  }
}
