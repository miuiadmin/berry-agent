/**
 * obs — 会话维工具族（03 §10.8 会话维扩展——e-2 观测腿；宿主固定工具族
 * 四件 `session_list` / `session_read` / `session_trace` / `session_status`，
 * `session_` 前缀保留字〔03 §2.7〕的宿主侧落位）。
 *
 * **可见性分轴执法**（03 §10.8——观测轴）：
 *  - 树内（self 同 id / parent_id 链同根——SessionView.isSameTree 单源）
 *    零开门白给；
 *  - 跨树/全会话维枚举与读走高危面 `sessions.observe-cross` 门检
 *    （03 §4.6 v1 首批第五枚——adjudicateCapabilityDoor；拒 =
 *    SESSION_OBSERVE_DENIED〔02 §5.3 e-2 补登〕）；门开后逐次
 *    capability/used 审计 seam（05 §1.1——真发射位 U3-2 挂账同律）。
 *  - session_list 的门未开形 = 只列树内会话（枚举本身即跨树信息——
 *    「枚举与读」同门同码防旁路）。
 *
 * **行为律带出**（立题档 §六「问当事人 vs 查档案」——oh-my-pi 先例：
 * 判断隔壁会话在做什么优先直接向当事会话发消息，档案查询归本工具族；
 * 提示词层面带出不立条款）：写进 session_read/session_trace description。
 *
 * 恒挂载律（03 §2.2 第十一面同款）：工具族模型可见清单恒在，不随门开合
 * 动态挂载——门检在 execute 内执法。per-session 闭包由装配位构造
 * （callerSessionId 注入——todoTool 换装 seam 同构先例）。
 */
import { BaseError, type AgentToolResult, type ToolDefinition } from '../contracts/index.js';
import { adjudicateCapabilityDoor } from '../contracts/api.js';
import { Type } from 'typebox';
import type { SessionSummaryRow, SessionView } from './types.js';

/** 观测轴高危面名（03 §4.6 v1 首批第五枚——拉取/订阅两形态一枚统摄） */
export const OBSERVE_CROSS_CAPABILITY = 'sessions.observe-cross';

/** capability/used 审计记录（观测轴载荷——e-2 定形：归因键含动词名与目标会话 id） */
export interface SessionObserveUsedRecord {
  readonly capability: typeof OBSERVE_CROSS_CAPABILITY;
  /** 调用方会话 id（观测轴 caller = 模型工具道——按所在会话归因） */
  readonly callerSessionId: string;
  /** 动词名（工具名——枚举形无单一目标时 targetSessionId 缺席） */
  readonly verb: string;
  /** 目标会话 id（session_list 全枚举形缺席） */
  readonly targetSessionId?: string;
}

/** createSessionTools 依赖注入面（装配根 per-session 构造闭包） */
export interface SessionToolsDeps {
  /** 会话维视图服务（与宿主装配同一实例） */
  readonly view: SessionView;
  /** 调用方会话 id（可见性分轴锚——per-session 闭包） */
  readonly callerSessionId: string;
  /** 启用清单 opens 取值器（宿主装配根注入——高危面门检输入；只读集契约） */
  readonly getOpens: () => ReadonlySet<string>;
  /** capability/used 审计 seam（05 §1.1——装配位接线，缺席 = 零审计） */
  readonly onCapabilityUsed?: (record: SessionObserveUsedRecord) => void;
}

/** createSessionTools 工厂（装载位/测试唯一入口）——四件定义数组 */
export function createSessionTools(deps: SessionToolsDeps): readonly ToolDefinition[] {
  const { view, callerSessionId } = deps;

  /** 跨树门检 + 开门后审计（执法序：树内白给前置由调用侧判，此处只管跨树档） */
  const enforceCrossTreeDoor = (verb: string, targetSessionId?: string): void => {
    const verdict = adjudicateCapabilityDoor(deps.getOpens(), OBSERVE_CROSS_CAPABILITY);
    if (!verdict.ok) {
      throw new BaseError(
        'SESSION_OBSERVE_DENIED',
        `${verdict.message}（调用方会话 ${callerSessionId}${targetSessionId !== undefined ? `，目标 ${targetSessionId}` : ''}）`,
      );
    }
    // 开门后逐次审计（core: 豁免面不适用于模型工具道——caller 恒为会话模型）
    deps.onCapabilityUsed?.({
      capability: OBSERVE_CROSS_CAPABILITY,
      callerSessionId,
      verb,
      ...(targetSessionId !== undefined ? { targetSessionId } : {}),
    });
  };

  /** 树内判定（self 同 id 特例天然含于 isSameTree） */
  const inOwnTree = (targetSessionId: string): boolean => view.isSameTree(targetSessionId, callerSessionId);

  return [
    {
      name: 'session_list',
      description:
        '列出本进程在管会话清单（id/标题/血缘 origin·parentId/在飞粗状态/近次模型/updatedAt）。' +
        '默认只列本会话血缘树内会话；跨树/全会话维枚举需高危面 sessions.observe-cross 开门（未开门时跨树会话不呈现）。' +
        '在飞粗状态由事件流尾条推导（idle = 回合闭合 / running = 回合进行中 / waiting-approval = 等待用户审批）。',
      parameters: Type.Object({}, { additionalProperties: false }),
      effect: 'read',
      execute: async (): Promise<AgentToolResult> =>
        guard(async () => {
          const summaries = view.listSessions();
          // 可见性分轴：门未开只列树内（含 self）；门开全列——先探门再裁
          const door = adjudicateCapabilityDoor(deps.getOpens(), OBSERVE_CROSS_CAPABILITY);
          const visible = door.ok ? summaries : summaries.filter((row) => inOwnTree(row.id));
          if (door.ok) {
            deps.onCapabilityUsed?.({ capability: OBSERVE_CROSS_CAPABILITY, callerSessionId, verb: 'session_list' });
          }
          if (visible.length === 0) {
            return { content: [{ type: 'text', text: '（无可见会话——进程内无在管会话，或跨树会话未开门不呈现）' }] };
          }
          const header = 'id  title  origin  parent  live  model  updatedAt';
          const lines = visible.map(summaryLine);
          return { content: [{ type: 'text', text: [header, ...lines].join('\n') }] };
        }),
    },
    {
      name: 'session_read',
      description:
        '读取指定会话事件流尾部窗口（有帽有界——缺省 50 条、上限 200 条，含事件类型/序号/摘要）。' +
        '树内会话（本会话及其血缘树）直接可读；跨树会话需高危面 sessions.observe-cross 开门。' +
        '行为律：判断隔壁会话当前在做什么，优先直接向当事会话发消息确认（对话协作同人类）；' +
        '本工具面向历史档案核查与事后回溯。',
      parameters: Type.Object(
        {
          sessionId: Type.String({ description: '目标会话 id' }),
          limit: Type.Optional(Type.Number({ description: '尾窗条数（缺省 50、硬帽 200）' })),
        },
        { additionalProperties: false },
      ),
      effect: 'read',
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          // schema 段已校验（typebox String）——execute 层直断窄读
          const sessionId = args.sessionId as string;
          if (!inOwnTree(sessionId)) enforceCrossTreeDoor('session_read', sessionId);
          const window =
            typeof args.limit === 'number' ? view.readTail(sessionId, { limit: args.limit }) : view.readTail(sessionId);
          if (!window.exists) {
            return { content: [{ type: 'text', text: `（目标会话 ${sessionId} 无对应行——查无此档）` }] };
          }
          if (window.items.length === 0) {
            return { content: [{ type: 'text', text: '（目标会话零事件——空档案）' }] };
          }
          const lines = window.items.map((item) => `${item.seq}  ${item.time}  ${item.type}  ${item.summary}`);
          return { content: [{ type: 'text', text: ['seq  time  type  summary', ...lines].join('\n') }] };
        }),
    },
    {
      name: 'session_trace',
      description:
        '查询指定会话当前进行态（在飞粗状态 + 当前回合尾窗 20 条 + 在飞工具清单）。' +
        '树内会话直接可查；跨树会话需高危面 sessions.observe-cross 开门。' +
        '行为律：判断隔壁会话当前在做什么，优先直接向当事会话发消息确认；本工具面向状态核查。',
      parameters: Type.Object(
        { sessionId: Type.String({ description: '目标会话 id' }) },
        { additionalProperties: false },
      ),
      effect: 'read',
      execute: async (args): Promise<AgentToolResult> =>
        guard(async () => {
          const sessionId = args.sessionId as string; // schema 段已校验——直断窄读
          if (!inOwnTree(sessionId)) enforceCrossTreeDoor('session_trace', sessionId);
          const report = view.trace(sessionId);
          if (!report.exists) {
            return { content: [{ type: 'text', text: `（目标会话 ${sessionId} 无对应行——查无此档）` }] };
          }
          const head = `live=${report.live}  inflight=${report.inflightTools.length > 0 ? report.inflightTools.join(',') : '（无）'}`;
          const lines = report.recent.map((item) => `${item.seq}  ${item.time}  ${item.type}  ${item.summary}`);
          return { content: [{ type: 'text', text: [head, 'seq  time  type  summary', ...lines].join('\n') }] };
        }),
    },
    {
      name: 'session_status',
      description:
        '查询自身坐标（「我是谁在哪」）：本会话 id、血缘 origin 与父会话、工作区根、' +
        '在飞粗状态、近次模型。零参数——目标恒为本会话（树内 self 档，零开门）。',
      parameters: Type.Object({}, { additionalProperties: false }),
      effect: 'read',
      execute: async (): Promise<AgentToolResult> =>
        guard(async () => {
          const status = view.selfStatus(callerSessionId);
          const lines = [
            `sessionId=${status.sessionId}`,
            `origin=${status.origin}`,
            `parent=${status.parentId ?? '（根会话）'}`,
            `workspaceRoot=${status.workspaceRoot ?? '（无工作区）'}`,
            `live=${status.live}`,
            `model=${status.model ?? '（未发起请求）'}`,
          ];
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }),
    },
  ];
}

/** 清单行文本（列对齐——模型消费面） */
function summaryLine(row: SessionSummaryRow): string {
  return [
    row.id,
    row.title ?? '（无标题）',
    row.origin,
    row.parentId ?? '-',
    row.live,
    row.model ?? '-',
    String(row.updatedAt),
  ].join('  ');
}

/** 统一异常编码（03 §2.3——BaseError 携码前置披露；obs_query 同款先例） */
async function guard(run: () => Promise<AgentToolResult>): Promise<AgentToolResult> {
  try {
    return await run();
  } catch (error) {
    const code = error instanceof BaseError ? error.code : undefined;
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: code ? `[${code}] ${message}` : message }],
      isError: true,
    };
  }
}
