/**
 * fresh 作用域审批三件之①②（04 §9 审批与动作安全）——会话级审批装配：
 * ApprovalService 组装（①）+ answerer（②：呈现面接线 + 归属路由 + run 信号
 * 桥 + 挂起收口）。
 *
 * 机制全景（04 §9 条款逐条执法位）：
 *  - **审批对 durable**（05 §1.1 approval/asked + approval/decided 词行）：
 *    sink 接 session.append——问询真实发生时落 asked、决议产生时落 decided，
 *    回放时决策已是既成事实不重问；
 *  - **归属恰一键 {sessionId}**：本会话 answerer 只接 ownership 命中的 ask
 *    （子代理在父会话呈现面被问——他会话的 ask 交棒下游不越权代答）；
 *  - **run 信号透传**（04 §9）：ask 载荷携带的 run signal 经
 *    bridgeApprovalSignal 桥进呈现面的 per-ask signal——run abort → 呈现面
 *    收 'cancel'（打断非拒绝的诚实落账，decision=cancel）；
 *  - **turn 界闭合**（04 §9 审批对条款：turn 终结时未决 ask 统一 unavailable
 *    ——通道没了问也无从答）：settlePending() 收口挂起簿记里的全部 ask 为
 *    「无答案」（全链无答 = service 落 unavailable/source=timeout），迟到的
 *    呈现面答案不回写；驱动侧在 run 终态（结算边界）调用（settleApprovals
 *    注入面，driver 本体）；
 *  - 呈现面缺席/抛错：answerer 不答交棒（全链无答 = unavailable
 *    fail-closed——审批不可静默通过）。
 *
 * 词汇注册纪律：createApprovalService 构造即注册 approval/answer（撞名
 * fail-loud）——dispatch 与服务同生命周期（per-session dispatch），dispose
 * 只摘 answerer 不撤销词汇注册。
 */
import type { ApprovalAskAnswer, ApprovalAskRequest, SessionEvent } from '../contracts/index.js';
import type { EventDispatch } from '../context/index.js';
import type { SessionLog } from '../session/index.js';
import { occludedSeqs } from '../session/index.js';
import { APPROVAL_ANSWER_EVENT, bridgeApprovalSignal, createApprovalService } from '../safety/index.js';
import type {
  ToolPolicyDraft,
  ApprovalAnswerEnvelope,
  ApprovalDecisionValue,
  ApprovalPolicyMode,
  ApprovalRequest,
  ApprovalService,
  DecisionSource,
} from '../safety/index.js';

/**
 * 审批决议活体总线词（挖掘 31 轮 [1]——07 §4.1 审批决策落史行词条）：decided
 * durable 落账后广播，消费位 = TUI 直播腿决策行追加（job_settled 同族——活体
 * 通知词汇非 durable 词行；durable 对仍 asked/decided 两词零变）。emit 全部
 * decided 不滤——谓词滤除（isUserApprovalDecision）在消费侧单源。
 */
export const APPROVAL_SETTLED_EVENT = 'approval/settled';

/**
 * 决议广播载荷：durable decided 载荷 + 会话归属键 + 配对 summary（asked 腿
 * 簿记取——单腿形 asked 未落则空串诚实）。
 */
export interface ApprovalSettledNotice {
  readonly sessionId: string;
  readonly approvalId: string;
  readonly decision: ApprovalDecisionValue;
  readonly source: DecisionSource;
  readonly summary: string;
}

/** 会话审批装配选项（host 装配根 / 驱动测试面注入） */
export interface SessionApprovalOptions {
  readonly sessionId: string;
  readonly dispatch: EventDispatch;
  readonly session: SessionLog;
  /**
   * 审批 ask 呈现面（channels UiBackend.askApproval 同构经装配注入；缺席 =
   * 无应答者 fail-closed——headless 无人挂同归 unavailable）。
   */
  readonly askApproval?: (request: ApprovalAskRequest, opts?: { signal?: AbortSignal }) => Promise<ApprovalAskAnswer>;
  /** 策略档（缺省 'ask'；never = 无人值守确定性拒绝） */
  readonly policy?: ApprovalPolicyMode;
  /** 「始终允许」条目写入回调（04 §9 粘性段定形③织入位；缺省 always 面关闭） */
  readonly persistToolPolicy?: (draft: ToolPolicyDraft) => void;
}

/** 会话审批装配产物 */
export interface SessionApprovalWiring {
  /** 审批服务（守门行 / bash 升权共用） */
  readonly approval: ApprovalService;
  /** 挂起 ask 收口面（04 §9 turn 界闭合——统一无答案 → unavailable） */
  settlePending(): void;
  /** 摘 answerer（会话拆除；词汇注册不可逆——dispatch 同生命周期） */
  dispose(): void;
}

/** 挂起簿记条目（settlePending 的收口对象） */
interface PendingAsk {
  /** 收口：undefined = 无答案（通道没了）；有值 = 呈现面迟到前的保守短路 */
  settle(answer: ApprovalAskAnswer | undefined): void;
}

/**
 * 组装会话审批三件的前两件。@returns 装配产物（settlePending 归驱动 run 终态
 * 调用——04 §3 终态=结算边界；dispose 归会话拆除）。
 */
export function wireSessionApproval(opts: SessionApprovalOptions): SessionApprovalWiring {
  /** 挂起 ask 簿记（本会话 answerer 在身的问询——settlePending 收口对象） */
  const pending = new Set<PendingAsk>();

  // 决议总线词双保险注册（挖掘 31 轮 [1]）：独立装配（不经 assembly 预注册）
  // 的测试形/嵌入形也活体可订阅——撞名 fail-loud 兜底（EventDispatch 同词
  // 二次注册抛 EVENT_DUPLICATE，isRegistered 先查避免）
  if (!opts.dispatch.isRegistered(APPROVAL_SETTLED_EVENT)) {
    opts.dispatch.registerEventNames([APPROVAL_SETTLED_EVENT]);
  }

  /** asked 腿 summary 簿记（per-approvalId——decided 配对后 consume 即清，两问两答不串账） */
  const askedSummaries = new Map<string, string>();

  const service = createApprovalService(opts.dispatch, {
    ownership: { sessionId: opts.sessionId },
    ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
    ...(opts.persistToolPolicy !== undefined ? { persistToolPolicy: opts.persistToolPolicy } : {}),
    // 审批对 durable 落账（05 §1.1 词行 data 形与 sink 载荷一一对应）+ 决议
    // 活体广播（挖掘 31 轮 [1]——append 先于 emit：durable 是真源，直播腿与
    // 折面（foldApprovalDecisions）两路同构的前提）
    sink: {
      asked: (payload) => {
        opts.session.append('approval/asked', payload);
        askedSummaries.set(payload.approvalId, payload.summary);
      },
      decided: (payload) => {
        opts.session.append('approval/decided', payload);
        const summary = askedSummaries.get(payload.approvalId) ?? '';
        askedSummaries.delete(payload.approvalId); // consume 即清
        // 通知型监听器同步起跑（emit 同步进腿）——不 await 不阻塞审批主路
        void opts.dispatch.emit(APPROVAL_SETTLED_EVENT, {
          sessionId: opts.sessionId,
          ...payload,
          summary,
        } satisfies ApprovalSettledNotice);
      },
    },
  });

  const off = opts.dispatch.onWaterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, async (input, next) => {
    // 归属路由（恰一键条款）：他会话的 ask 不接——交棒下游（他会的 answerer
    // 或全链无答 unavailable），不越权代答
    if (input.req.ownership?.sessionId !== opts.sessionId) return next(input);
    // 呈现面缺席：本行不答（交棒；全链无答 = fail-closed unavailable）
    if (opts.askApproval === undefined) return next(input);

    // run 信号桥（04 §9 run 信号透传）：已 abort 的 signal 同步触发
    const controller = new AbortController();
    const unbridge = bridgeApprovalSignal(input.req, controller);

    // 挂起簿记 + 收口竞速：settlePending 先胜 = 无答案（迟到答案被弃）
    let settleAsk!: (answer: ApprovalAskAnswer | undefined) => void;
    const settled = new Promise<ApprovalAskAnswer | undefined>((resolve) => {
      settleAsk = resolve;
    });
    const entry: PendingAsk = { settle: settleAsk };
    pending.add(entry);
    let answer: ApprovalAskAnswer | undefined;
    try {
      answer = await Promise.race([
        // 呈现面异常 = 无答案（不答交棒——fail-closed 由 service 全链无答承担）
        opts.askApproval(toAskRequest(input.req), { signal: controller.signal }).catch(() => undefined),
        settled,
      ]);
    } finally {
      pending.delete(entry);
      unbridge();
    }
    if (answer !== undefined) {
      input.answer = answer; // 能答短路（不调 next——本链应答位；可变载荷就地写）
      return input;
    }
    return next(input);
  });

  return {
    approval: service,
    settlePending() {
      // turn 界闭合：统一无答案（service 落 unavailable）——通道没了问也无从答
      for (const entry of [...pending]) entry.settle(undefined);
    },
    dispose() {
      off();
    },
  };
}

/**
 * safety ApprovalRequest → 呈现载荷（contracts/approval 单源形）：
 * suggestedEntry 草案对象折人可读一行（`<tool> <pattern>`——面板展示面，
 * 回写走 persistToolPolicy 的结构形草案，不经本串）。
 */
function toAskRequest(req: ApprovalRequest): ApprovalAskRequest {
  return {
    summary: req.summary,
    ...(req.reason !== undefined ? { reason: req.reason } : {}),
    ...(req.toolName !== undefined ? { toolName: req.toolName } : {}),
    ...(req.approvalId !== undefined ? { approvalId: req.approvalId } : {}),
    ...(req.suggestedEntry !== undefined
      ? { suggestedEntry: `${req.suggestedEntry.tool} ${req.suggestedEntry.pattern}` }
      : {}),
  };
}

/* ---------------- 审批决策折面（挖掘 31 轮 [1]——投影/回看路数据源） ---------------- */

/** 折面记录：decided 事件 seq（决策行按 seq 归位锚）+ durable 载荷 + 配对 summary */
export interface FoldedApprovalDecision {
  /** 归位锚 = decided 事件的 durable seq（其后首条消息之前呈现） */
  readonly seq: number;
  readonly approvalId: string;
  readonly decision: ApprovalDecisionValue;
  readonly source: DecisionSource;
  /** asked 配对摘要（单腿形/遮蔽 asked → 空串诚实） */
  readonly summary: string;
}

/**
 * durable 审批对折面（纯函数——投影/回看路数据源）：单遍扫描 asked 建
 * per-approvalId 摘要簿记、decided 成记录（summary 现场配对 consume——与
 * 直播腿 sink 簿记同构）。落 surfaceOp 遮蔽区间（压缩——occludedSeqs 单源）
 * 的 asked/decided 事件跳过：决策行随消息遮蔽同语义消失（重建窗口外）。
 */
export function foldApprovalDecisions(events: readonly SessionEvent[]): readonly FoldedApprovalDecision[] {
  const occluded = occludedSeqs(events);
  const askedSummaries = new Map<string, string>();
  const out: FoldedApprovalDecision[] = [];
  for (const event of events) {
    if (occluded.has(event.seq)) continue; // 遮蔽窗口内——重建面缺席
    if (event.type === 'approval/asked') {
      const data = event.data as { approvalId: string; summary?: string };
      askedSummaries.set(data.approvalId, data.summary ?? '');
    } else if (event.type === 'approval/decided') {
      const data = event.data as { approvalId: string; decision: ApprovalDecisionValue; source: DecisionSource };
      out.push({
        seq: event.seq,
        approvalId: data.approvalId,
        decision: data.decision,
        source: data.source,
        summary: askedSummaries.get(data.approvalId) ?? '',
      });
      askedSummaries.delete(data.approvalId); // consume 即清（同 approvalId 复用时摘要不串账）
    }
  }
  return out;
}

/**
 * 呈现面子集谓词（单源——直播腿与回看注入位两路共用）：人批的三决议档
 * （approve/always/reject）落行；cancel（打断非拒绝）/unavailable（通道没了）
 * /sticky/subset/timeout/policy-never（非人决策）不落——粘性/子集命中根本
 * 无审批对产生（天然无对象非滤除），本谓词只辖有对时的 source 档。
 */
/**
 * 呈现面子集谓词（单源——直播腿与回看注入位两路共用）：人批的三决议档
 * （approve/always/reject）落行；cancel（打断非拒绝）/unavailable（通道没了）
 * /sticky/subset/timeout/policy-never（非人决策）不落——粘性/子集命中根本
 * 无审批对产生（天然无对象非滤除），本谓词只辖有对时的 source 档。
 * 泛型窄化（`T & {decision: 子集}`）：消费位 filter 后 decision 随窄——
 * 呈现载荷类型（ApprovalDecisionLineInput 三值）零再断言。
 */
export function isUserApprovalDecision<T extends { decision: ApprovalDecisionValue; source: DecisionSource }>(
  input: T,
): input is T & { decision: 'approve' | 'always' | 'reject' } {
  return (
    (input.decision === 'approve' || input.decision === 'always' || input.decision === 'reject') &&
    input.source === 'user'
  );
}
