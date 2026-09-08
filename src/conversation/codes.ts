/**
 * conversation 域操控面错误码注册（02 §5.3 SESSION_ 族操控四码——2026-09-08
 * e-1 规范先行批明列；03 §2.2 第十一面三动词执法承载；本批 e-4 落码兑现
 * 「词先锚定、落码随 e-4」）。
 *
 * 四码分层：SESSION_TARGET_NOT_FOUND 是三动词共同幽灵守卫（目标会话 id 无
 * 对应行——GOAL_NOT_FOUND 同构；词面避撞批 13b SDK 面 SESSION_NOT_FOUND
 * 〔module 段 session〕，e-1 冷读闸 blocker 处置案 a）；SESSION_INACTIVE 管
 * interrupt 打断无对象（响亮拒不静默 no-op）；SESSION_TURN_STALE 管
 * expectedTurnId 乐观并发位翻页拒（codex expected_turn_id 形）；SESSION_ROUND_LIMIT
 * 管 a2a 回合护栏帽拒（缺省 5、人面输入重置链深）。第五码 SESSION_CONTROL_DENIED
 * 管操控门检拒（sessions.control-cross 全域同门——操控轴无树内豁免；e-4
 * 落码批 02 §5.3 同笔扩册，SESSION_OBSERVE_DENIED 同构先例）。
 *
 * module 段 conversation——SESSION_ 前缀系跨功能域共用前缀（session 模块
 * 既有码族/批 13b SDK 面裸码〔module 段 session〕/obs 观测两码〔module 段
 * obs〕与本族四码分域并存——02 §5.3 跨功能域共用前缀注）。
 * 本文件由模块公开面 index.ts 引入（注册纪律：import 发生才注册）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'SESSION_TARGET_NOT_FOUND',
    module: 'conversation',
    description:
      '操控动词目标会话 id 无对应行——幽灵守卫（GOAL_NOT_FOUND 同构；send/interrupt/withdraw 三动词共同前置，03 §2.2 第十一面。词面避撞：批 13b SDK 面 SESSION_NOT_FOUND 在册〔module 段 session——prompt 显式 sessionId 无对应会话〕，两码语义分立故带 TARGET 段）',
  },
  {
    code: 'SESSION_INACTIVE',
    module: 'conversation',
    description: 'interrupt 作用目标无在飞 run 拒——打断无对象，响亮拒不静默 no-op（03 §2.2 第十一面 interrupt）',
  },
  {
    code: 'SESSION_TURN_STALE',
    module: 'conversation',
    description:
      '乐观并发位 expectedTurnId 给定而目标 turn 已翻页拒（「说完话世界已变」显式化——静默错投比响亮拒更险；codex expected_turn_id 形，03 §2.2 第十一面 send）',
  },
  {
    code: 'SESSION_ROUND_LIMIT',
    module: 'conversation',
    description: 'a2a 回合护栏帽拒——跨会话 send 链深超帽（缺省 5、人面输入重置链深，03 §2.2 第十一面回合护栏）',
  },
  {
    code: 'SESSION_CONTROL_DENIED',
    module: 'conversation',
    description:
      '操控门未开门拒——高危面 sessions.control-cross（03 §4.6 v1 首批第六枚）门检执法位拒：操控轴无树内豁免、全域同门（03 §2.2 第十一面门制句），send/interrupt/withdraw 三动词共同前置（幽灵守卫之后）；SESSION_OBSERVE_DENIED 同构门检拒码先例（2026-09-08 e-4 落码批 02 §5.3 同笔扩册）',
  },
]);
