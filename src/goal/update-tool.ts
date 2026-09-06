/**
 * goal_update 工具件（03 §10.5 open 项完成否决律——模型面的终态申报通道）。
 *
 * 申报与验证分离在工具管道内闭环（schema → 守门 → 执行段机器否决）——
 * 模型自报文本不再是完成唯一通道：completed 申报由服务层 fold open 项 +
 * 判据门评测机器否决（GOAL_TRANSITION_INVALID 响亮回执列原因），工具件
 * 只做通道与收尾渲染。
 */
import { Type } from 'typebox';
import { BaseError, type ToolDefinition } from '../contracts/index.js';
import type { GoalService } from './service.js';

/** 工具装配依赖 */
export interface GoalUpdateToolDeps {
  service: GoalService;
  /** 当前会话 id（goal 解析面——active goal 寻径） */
  getSessionId: () => string;
}

/** goal_update 工具件（终态申报——机器否决在服务层） */
export function createGoalUpdateTool(deps: GoalUpdateToolDeps): ToolDefinition {
  return {
    name: 'goal_update',
    description:
      '申报 goal 终态。status=completed 必附 evidence（完成证据——机器会独立核验：' +
      '任务清单不得有 open 项〔一切非 completed 项，含 deferred〕、判据门须全绿，' +
      '不符即拒并回执原因）；status=abandoned 可附 reason。当前会话的 active goal 作用。',
    parameters: Type.Object(
      {
        status: Type.Union([Type.Literal('completed'), Type.Literal('abandoned')]),
        evidence: Type.Optional(Type.String()),
        reason: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    effect: 'read',
    execute: async (args) => {
      const status = args.status as 'completed' | 'abandoned';
      const active = deps.service.activeFor(deps.getSessionId());
      if (active === undefined) {
        throw new BaseError('GOAL_TRANSITION_INVALID', '当前会话无 active goal——无可申报终态');
      }
      const row =
        status === 'completed'
          ? await deps.service.complete(active.id, typeof args.evidence === 'string' ? args.evidence : '')
          : await deps.service.abandon(active.id, typeof args.reason === 'string' ? args.reason : undefined);
      const note = row.endingNote ?? '';
      return {
        content: [
          {
            type: 'text',
            text:
              status === 'completed'
                ? `goal 已完成（机器核验通过：open 项清零 + 判据门全绿）。证据：${note}`
                : `goal 已放弃。理由：${note}`,
          },
        ],
      };
    },
  };
}
