/**
 * goal 域错误码注册（03 §10.5 + 04 §12——GOAL_ 前缀族；02 §5.3 批 15b
 * 明列四码，前两码承 berry 同名码〔03 §10 章头指认〕、后两码本仓新立）。
 *
 * 码语义分层：GOAL_TRANSITION_INVALID 管状态迁转机器否决（完成否决律/
 * 撞席守卫/挂钟注册失败回执同折）；GOAL_TODO_SCOPE 管 todo/write 段约束
 * 双向执法（goal 段缺字段/坏词法、非段申报扩字段、gate 申报位 fail-closed）；
 * GOAL_NOT_FOUND 管幽灵 goalId；GOAL_GOAL_INVALID 管行载荷词法。
 * 本文件由模块公开面 index.ts 引入（注册纪律：import 发生才注册）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'GOAL_TRANSITION_INVALID',
    module: 'goal',
    description:
      'goal 状态迁转机器否决——goal_update 终态 completed 必附 evidence 且 open 项在/携 gate 项未全绿即拒（响亮回执列 open 项）、同会话既有 active goal 撞席拒、GoalJobsFace register 坏串回执同折',
  },
  {
    code: 'GOAL_TODO_SCOPE',
    module: 'goal',
    description:
      'todo/write 段约束双向执法——goal 段内 deferred 缺 resume_when、completed 缺后继二择一（follow_up/noFollowUp）、resume_when 词法坏形拒；非 goal 段申报扩字段亦拒；gate 声明申报位 fail-closed（command 未过 needsWrite 批准、diagnostics 缺 lsp 面）',
  },
  {
    code: 'GOAL_NOT_FOUND',
    module: 'goal',
    description: '幽灵 goalId 零行守卫——update/complete/abandon/wake 作用行缺席响亮拒',
  },
  {
    code: 'GOAL_GOAL_INVALID',
    module: 'goal',
    description: 'goal 行载荷坏——objective 空/超 16KiB',
  },
]);
