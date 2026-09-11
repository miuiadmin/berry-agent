/**
 * obs — 会话维工具族（03 §10.8 会话维扩展——e-2 观测腿 + e-3 环境自感；
 * 宿主固定工具族四件 `session_list` / `session_read` / `session_trace` /
 * `session_status`，`session_` 前缀保留字〔03 §2.7〕的宿主侧落位）。
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
 * **e-3 环境自感**（普查候选 E——03 §10.8 session_status 条并入注）：
 * session_status 扩工具清单（整形后有效可见集）/ 能力门态快照（闭门
 * 附诊断 reason——与执行时拒绝 message 同源）/ 负面能力声明文案
 * （hermes「你没有 X——不要承诺」防幻觉负向清单）三段；数据经 env
 * 窄面注入（装配现场事实非 durable 派生——与 SessionView 分立）。
 *
 * 恒挂载律（03 §2.2 第十一面同款）：工具族模型可见清单恒在，不随门开合
 * 动态挂载——门检在 execute 内执法。per-session 闭包由装配位构造
 * （callerSessionId 注入——todoTool 换装 seam 同构先例）。
 */
import { BaseError, type AgentToolResult, type ToolDefinition } from '../contracts/index.js';
import { adjudicateCapabilityDoor } from '../contracts/api.js';
import { Type } from 'typebox';
import type {
  SessionDoorStateEntry,
  SessionEnvFace,
  SessionSummaryRow,
  SessionToolPolicySnapshot,
  SessionView,
} from './types.js';

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
  /**
   * 环境自感面（e-3——session_status 工具清单/门态快照/负面声明的数据源；
   * 装配根注入。缺席 = 基础坐标档诚实降级：相关段整体不呈现，不虚构）。
   */
  readonly env?: SessionEnvFace;
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
        '查询自身坐标与环境自感（「我是谁在哪、有什么、没有什么」）：本会话 id、血缘 origin 与父会话、' +
        '工作区根、在飞粗状态、近次模型，以及可用工具清单（整形后有效可见集）、能力门态快照（高危面开/闭与' +
        '闭门理由）、负面能力声明（未开门面/无工作区等「不要承诺」负向清单——防幻觉）、工具策略表快照' +
        '（allow/deny 条目 + 整名族干跑裁决——装配期快照，/approval explain 为活体试解析）。' +
        '零参数——目标恒为本会话（树内 self 档，零开门）。',
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
          // e-3 环境自感三段（env 缺席 = 基础坐标档——段整体不呈现，诚实降级不虚构）
          if (deps.env !== undefined) {
            const listing = deps.env.listTools();
            lines.push(`tools(${listing.length})=${listing.map((entry) => entry.name).join(', ')}`);
            const doors = deps.env.doorStates();
            lines.push('capability-doors:');
            for (const door of doors) {
              lines.push(doorLine(door));
            }
            const negatives = negativeLines(doors, status.workspaceRoot);
            lines.push('negative-capabilities:', ...negatives);
            // ap-3 第四段：工具策略表（toolPolicy 缺席 = 段不呈现——与 doorStates
            // 同缺席语义；装配期快照诚实，/approval entries/explain 才是活体面）
            const policy = deps.env.toolPolicy?.();
            if (policy !== undefined) {
              lines.push(...policyLines(policy));
            }
          }
          return { content: [{ type: 'text', text: lines.join('\n') }] };
        }),
    },
  ];
}

/** 门态行（能力自省快照——闭门附诊断 reason：与执行时拒绝 message 同源，先查后用） */
function doorLine(door: SessionDoorStateEntry): string {
  const state = door.open ? 'open' : 'closed';
  if (door.open) return `  ${door.capability}=${state}（${door.scope}）`;
  return `  ${door.capability}=${state}（${door.reason ?? '未开门'}）——${door.scope}`;
}

/**
 * 负面能力声明文案（hermes「你没有 X——不要承诺」防幻觉负向清单；
 * 普查候选 E D4 缺缝③）。v1 两锚：闭门面（对应操作将被拒）+ 无工作区
 * （文件工具结构性不可用）。全开 + 有工作区 = 显式「无缺失」收口行
 * （负向清单的价值在显式闭合——「查过且无」不等于「没查」）。
 */
function negativeLines(doors: readonly SessionDoorStateEntry[], workspaceRoot: string | undefined): string[] {
  const lines: string[] = [];
  for (const door of doors) {
    if (!door.open) lines.push(`  - ${door.capability} 未开门——${door.scope}将被拒，不要承诺对应操作`);
  }
  if (workspaceRoot === undefined) {
    lines.push('  - 本会话无工作区根——文件读写工具不可用，不要承诺文件操作');
  }
  if (lines.length === 0) lines.push('  （无——当前能力面无缺失声明）');
  return lines;
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

/**
 * 实参绑定族工具名（write/edit/bash——条目命中依赖调用实参〔路径/命令〕，
 * 整名干跑恒 miss 不可判；字面 = host 工具词汇非 safety 域逻辑——obs 零
 * safety 依赖〔DAG〕，此处仅作呈现分族，判定真源在注入的 dryRun 闭包）。
 */
const ARG_BOUND_TOOLS: ReadonlySet<string> = new Set(['write', 'edit', 'bash']);

/**
 * 工具策略表段渲染（ap-3 第四段——03 §10.8 ap-3 定形注）：① 条目清单全列
 * （装配期快照 + 载体路径注明）；② 整名族条目经 dryRun（守门行同一
 * matchToolPolicy 注入）干跑呈行——deny/allow 命中含条目序与 reason，无
 * 命中不占行；③ 实参绑定族（fs/bash）计数注记指路 /approval explain——
 * 不假报无命中（诚实分形）。
 */
function policyLines(policy: SessionToolPolicySnapshot): string[] {
  const lines: string[] = [`tool-policy(${policy.entries.length}) [装配期快照 path=${policy.path}]:`];
  if (policy.entries.length === 0) {
    lines.push('  （空——无任何条目）');
    return lines;
  }
  for (const entry of policy.entries) {
    const bits = [`[${entry.index}]`, `tool=${entry.tool}`];
    if (entry.pattern !== undefined) bits.push(`pattern=${entry.pattern}`);
    bits.push(`decision=${entry.decision}`);
    if (entry.effect !== undefined) bits.push(`effect=${entry.effect}`);
    if (entry.reason !== undefined) bits.push(`reason=${entry.reason}`);
    if (entry.expiresAt !== undefined) bits.push(`expiresAt=${new Date(entry.expiresAt).toISOString()}`);
    lines.push(`  ${bits.join(' ')}`);
  }
  // ② 整名族干跑（每工具三档并列；同条目命中的档合并呈一行「全档」）
  const wholeNameTools = [...new Set(policy.entries.filter((e) => !ARG_BOUND_TOOLS.has(e.tool)).map((e) => e.tool))];
  const argBoundCount = policy.entries.filter((e) => ARG_BOUND_TOOLS.has(e.tool)).length;
  if (wholeNameTools.length > 0) {
    lines.push('  整名族干跑（装配期快照 + 守门行同一判定函数）：');
    for (const tool of wholeNameTools) {
      const hits = (['read', 'write', 'exec'] as const)
        .map((effect) => ({ effect, hit: policy.dryRun(tool, effect) }))
        .filter(
          (h): h is { effect: 'read' | 'write' | 'exec'; hit: { decision: 'allow' | 'deny'; index: number } } =>
            h.hit !== undefined,
        );
      if (hits.length === 0) continue; // 无命中不占行（如 allow 条目已过期）
      const sameEntry = hits.every((h) => h.hit.index === hits[0]!.hit.index);
      const verdict = (hit: { decision: 'allow' | 'deny'; index: number }) =>
        hit.decision === 'deny'
          ? `policy-deny:${hit.index}（硬拒——任何面不可翻转）`
          : `policy-allow:${hit.index}（免问放行）`;
      if (sameEntry) {
        const tiers = hits.length === 3 ? '全档' : hits.map((h) => h.effect).join('/');
        lines.push(`    ${tool}: ${tiers}命中 ${verdict(hits[0]!.hit)}`);
      } else {
        for (const { effect, hit } of hits) lines.push(`    ${tool}: ${effect}档命中 ${verdict(hit)}`);
      }
    }
  }
  // ③ 实参绑定族计数注记（不假报无命中——指路活体试解析）
  if (argBoundCount > 0) {
    lines.push(
      `  （另 ${argBoundCount} 条 write/edit/bash 族条目逐调用裁决——命中依赖路径/命令实参，/approval explain <tool> [pattern] 试解析）`,
    );
  }
  return lines;
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
