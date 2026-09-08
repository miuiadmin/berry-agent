/**
 * conversation — 跨会话操控工具族（03 §2.2 第十一面模型道——e-4 落码）：
 * 宿主内建固定三件 `session_send` / `session_interrupt` / `session_withdraw`
 * （`session_` 前缀保留字〔03 §2.7〕的宿主侧落位，与 obs 观测四件同段）。
 *
 * **双面同源**（题 7 拍板）：本族 = sessions-control 受理器（control.ts
 * createSessionsControl——动词语义/执法序单源）的**薄包装**——工具 execute
 * 只做 caller 归因闭包（{kind:'session', sessionId}——per-session 装配位
 * 注入，模型无法伪造送话身份）+ 回执 JSON 呈报；幽灵守卫/门检/链深帽/
 * TURN_STALE 全在受理器（拒码 BaseError 经 guard 折 `[CODE] message`
 * isError——与 obs 工具族同形）。
 *
 * 恒挂载律（03 §2.2 第十一面同款）：模型可见清单恒在，不随门开合动态挂载
 * ——门检在受理器内执法（拒 = SESSION_CONTROL_DENIED 自描述文案）。
 */
import { BaseError, type AgentToolResult, type ToolDefinition } from '../contracts/index.js';
import { Type } from 'typebox';
import type { SessionsControlFace } from './control.js';

/** createControlTools 依赖注入面（装配根 per-session 构造闭包） */
export interface ControlToolsDeps {
  /** 调用方会话 id（provenance 归因锚——per-session 闭包，受理面铸 source 用） */
  readonly callerSessionId: string;
  /** 操控受理器真身（栈级单例——与插件服务面同一实例，双面同源） */
  readonly control: SessionsControlFace;
}

/** execute 统一包装：受理器 BaseError 折 `[CODE] message` isError（obs guard 同形） */
function guard(body: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
  return body().catch((error: unknown) => {
    if (error instanceof BaseError) {
      return {
        content: [{ type: 'text', text: `[${error.code}] ${error.message}` }],
        isError: true,
      };
    }
    throw error;
  });
}

/** 回执 JSON 呈报（类型化回执词结构化转写——不虚构不改写） */
function receiptText(receipt: unknown): AgentToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(receipt) }] };
}

/** createControlTools 工厂（装载位/测试唯一入口）——三件定义数组 */
export function createControlTools(deps: ControlToolsDeps): readonly ToolDefinition[] {
  const { callerSessionId, control } = deps;
  return [
    {
      name: 'session_send',
      description:
        '向另一会话发送消息（跨会话 a2a 协作）。回执三态：delivered（已投递起跑/停摆落账）、' +
        'queued（目标忙已入列——可经 session_withdraw 撤回）、dropped（拒收）。' +
        '需高危面 sessions.control-cross 开门（全域同门——同树目标同样要开门）。' +
        'a2a 链深帽缺省 5（连续代理互搏拒 SESSION_ROUND_LIMIT——目标会话收到人面输入即重置）；' +
        'expectedTurnId 可选乐观并发位（= 目标最近 turn/start 事件 seq——不匹配拒 SESSION_TURN_STALE）；' +
        'dedupeKey 可选幂等位（重试场景携稳定键——同键重复发送返原回执不重复注入）。',
      parameters: Type.Object(
        {
          sessionId: Type.String({ description: '目标会话 id' }),
          text: Type.String({ description: '注入文本（非空）' }),
          expectedTurnId: Type.Optional(
            Type.Number({ description: '乐观并发位：目标 durable 日志最近 turn/start 事件 seq（可选）' }),
          ),
          dedupeKey: Type.Optional(
            Type.String({ description: '幂等键（可选——同键重复 send 返原回执不重复注入；须调用方自铸唯一）' }),
          ),
        },
        { additionalProperties: false },
      ),
      effect: 'write',
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          const receipt = await control.send({
            caller: { kind: 'session', sessionId: callerSessionId },
            targetSessionId: args.sessionId as string,
            text: args.text as string,
            ...(args.expectedTurnId !== undefined ? { expectedTurnId: args.expectedTurnId as number } : {}),
            ...(args.dedupeKey !== undefined ? { dedupeKey: args.dedupeKey as string } : {}),
          });
          return receiptText(receipt);
        }),
    },
    {
      name: 'session_interrupt',
      description:
        '打断目标会话的在飞 run（协作中止——目标 turn 以 interrupted 收口）。' +
        '目标无在飞 run 拒 SESSION_INACTIVE（响亮拒不静默 no-op）。' +
        '回执含 stillQueued（打断后在队操控件 id 清单——可逐件 session_withdraw 撤回）' +
        '与 queuedCount（在队总数——在队件保留在队、下次续跑作种子，打断不清队）。' +
        '需高危面 sessions.control-cross 开门（全域同门）。',
      parameters: Type.Object(
        { sessionId: Type.String({ description: '目标会话 id' }) },
        { additionalProperties: false },
      ),
      effect: 'write',
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          const receipt = await control.interrupt({
            caller: { kind: 'session', sessionId: callerSessionId },
            targetSessionId: args.sessionId as string,
          });
          return receiptText(receipt);
        }),
    },
    {
      name: 'session_withdraw',
      description:
        '撤回本会话先前经 session_send 排入目标队列的消息（在队撤回对称闭环）。' +
        'messageId 取 session_send 回执。回执两态：withdrawn（在队已移除）、' +
        'delivered（已出队/从未在队——诚实呈报不虚构撤回成功）。' +
        '需高危面 sessions.control-cross 开门（全域同门）。',
      parameters: Type.Object(
        {
          sessionId: Type.String({ description: '目标会话 id' }),
          messageId: Type.String({ description: 'send 回执所铸消息 id（msg-<n> 形）' }),
        },
        { additionalProperties: false },
      ),
      effect: 'write',
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          const receipt = await control.withdraw({
            caller: { kind: 'session', sessionId: callerSessionId },
            targetSessionId: args.sessionId as string,
            messageId: args.messageId as string,
          });
          return receiptText(receipt);
        }),
    },
  ];
}
