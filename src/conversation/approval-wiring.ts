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
import type { ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';
import type { EventDispatch } from '../context/index.js';
import type { SessionLog } from '../session/index.js';
import { APPROVAL_ANSWER_EVENT, bridgeApprovalSignal, createApprovalService } from '../safety/index.js';
import type {
  ToolPolicyDraft,
  ApprovalAnswerEnvelope,
  ApprovalPolicyMode,
  ApprovalRequest,
  ApprovalService,
} from '../safety/index.js';

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

  const service = createApprovalService(opts.dispatch, {
    ownership: { sessionId: opts.sessionId },
    ...(opts.policy !== undefined ? { policy: opts.policy } : {}),
    ...(opts.persistToolPolicy !== undefined ? { persistToolPolicy: opts.persistToolPolicy } : {}),
    // 审批对 durable 落账（05 §1.1 词行 data 形与 sink 载荷一一对应）
    sink: {
      asked: (payload) => opts.session.append('approval/asked', payload),
      decided: (payload) => opts.session.append('approval/decided', payload),
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
