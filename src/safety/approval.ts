/**
 * L3 safety — ApprovalService（04 §9 审批与动作安全）。
 *
 * 机制全景：
 * - 粘性短路（04 §9 粘性段定形①）：ask 前先查会话粘性表——同指纹（粘性
 *   第 1 款）或子集预批（第 2 款：同目标更严档位请求被既有放行包含）命中
 *   即免问放行，**不产生审批对**（没有问就没有 asked/decided——审计诚实）；
 * - ask 档：经 approval/answer waterfall 派发给已注册 answerer（通道面短路
 *   返回四值答案）；无人应答 fail-closed → unavailable（source=timeout——
 *   headless 无人挂与超时同源）；answerer 自身抛错先落 decided 闭合审计对
 *   再上抛（功能面 fail-closed 由管道守门段承担，本 catch 只护审计对完整）；
 * - never 档：确定性拒绝回执（不发起问询——策略面定死「问都不问」；落
 *   decided 单腿带 source=policy-never，审计可分辨）。
 *
 * 审批对 durable 落账（05 篇词汇 approval/asked + approval/decided）：经注入
 * sink 接 session.append（装配层接线）——回放时决策已是既成事实，不重问。
 *
 * 升权审批（04 §8 严格变宽条）与守门审批共用本服务，reason 区分。
 */

import { randomUUID } from 'node:crypto';
import type { EventDispatch } from '../context/events.js';
import type {
  ToolPolicyDraft,
  ApprovalAnswer,
  ApprovalOutcome,
  ApprovalPolicyMode,
  ApprovalRequest,
  DecisionSource,
  SandboxMode,
} from './types.js';

/** answerer 监听的活体事件名（waterfall 语义：能答者置 envelope.answer 且不调 next 短路；调 next() = 本行不接） */
export const APPROVAL_ANSWER_EVENT = 'approval/answer';

/**
 * approval/answer 派发信封（与守门段 GateInput.outcome 同构——本仓 waterfall
 * 是同型流经管线，「答案」作为载荷可变字段传播）：answerer 能答则写 answer
 * 并返回（不调 next 即已答短路）；全链无人写 answer = 无应答（fail-closed）。
 */
export interface ApprovalAnswerEnvelope {
  /** 审批请求（只读参考——answerer 呈现面与 signal 桥接的载荷源） */
  readonly req: ApprovalRequest;
  /** 答案（能答的 answerer 置；undefined = 无人应答） */
  answer?: ApprovalAnswer;
}

/**
 * run 信号桥接（04 §9 run 信号透传条款——answerer 实现共用单源工具）：把
 * ApprovalRequest.signal（发起 run 的取消信号）桥进 answerer 的 per-request
 * controller——abort 同 reason，run abort 与竞速败腿收束汇入同一撤销面。
 * 已 abort 的 signal 同步触发（abort 事件只发一次，只挂监听则死路）。
 * @returns 监听摘除函数（ask 结算时调用——迟到 abort 落在已结算提问上
 * no-op 无害，摘除是「任何结算路径摘监听」不变式纪律非正确性依赖）
 */
export function bridgeApprovalSignal(req: ApprovalRequest, controller: AbortController): () => void {
  const runSignal = req.signal;
  if (runSignal === undefined) return () => {};
  const relay = (): void => controller.abort(runSignal.reason);
  if (runSignal.aborted) relay();
  else runSignal.addEventListener('abort', relay, { once: true });
  return () => runSignal.removeEventListener('abort', relay);
}

/**
 * 审批对落 durable 的形态（与 05 篇会话事件 approval/asked + approval/decided
 * 一一对应；装配层接线 session.append）。
 */
export interface ApprovalDecisionSink {
  /** approval/asked 载荷（落日志时机 = 请求发出时；粘性命中免问不落本腿） */
  asked(payload: { readonly approvalId: string; readonly summary: string }): void;
  /**
   * approval/decided 载荷（落日志时机 = 决议产生时）。decision = durable
   * 决议五值；source = 决策理由来源闭集五值（04 §9 粘性段定形②——审计面
   * 可分辨「谁放的行」）。
   */
  decided(payload: {
    readonly approvalId: string;
    readonly decision: ApprovalDecisionValue;
    readonly source: DecisionSource;
  }): void;
}

/**
 * durable 决议五值：approve = 批一次、always = 批本次且常驻条目真实写入
 * （审计语义不同不合并）；无草案 always 视同 approve 落账——decision 记
 * 有效行为，'always' 值仅当条目真实写入时使用。
 */
export type ApprovalDecisionValue = 'approve' | 'reject' | 'cancel' | 'unavailable' | 'always';

/** ask 的返回元数据：outcome 闭集四值 + 决策理由来源（调用方按需消费/透传落账） */
export interface ApprovalAskResult {
  readonly outcome: ApprovalOutcome;
  readonly source: DecisionSource;
}

/** ctx 审批服务面（消费方：守门行 / bash 升权 / host 装配） */
export interface ApprovalService {
  /** 动作级审批：一次请求 → 一个 outcome（闭集，绝不悬空）；粘性命中短路免问 */
  ask(req: ApprovalRequest): Promise<ApprovalAskResult>;
  /** 当前策略档（诊断/审计输出用） */
  readonly policyMode: ApprovalPolicyMode;
}

/** 组装选项 */
export interface ApprovalServiceOptions {
  /** 策略档（缺省 'ask'；never = 无人值守确定性拒绝） */
  readonly policy?: ApprovalPolicyMode;
  /** durable 审批对接线（缺省不落——测试/无会话场景；装配层接 session.append） */
  readonly sink?: ApprovalDecisionSink;
  /** 归属闭包（04 §9 恰一键条款：装配期织入 ask 载荷的 ownership 标签——驱动层传本会话 {sessionId}） */
  readonly ownership?: { readonly sessionId: string };
  /**
   * 「始终允许」条目写入回调（04 §9 粘性段定形③织入位）：answerer 返回
   * 'always' 且载荷带草案时调用——装配层接用户配置层策略表写入（幂等——tool-policy.json）。
   * 缺省不传 = always 面关闭（视同 approve，零副作用）。
   */
  readonly persistToolPolicy?: (draft: ToolPolicyDraft) => void;
}

/** 沙箱档宽度偏序秩（read-only ⊂ workspace-write ⊂ danger）——子集预批判定用 */
const TIER_RANK: Readonly<Record<SandboxMode, number>> = {
  'read-only': 0,
  'workspace-write': 1,
  danger: 2,
};

/** 会话粘性表条目（粘性第 1/2 款的机器面：目标 + 已授档宽度） */
interface StickyGrant {
  readonly target: string;
  readonly grantedTier: SandboxMode;
}

/**
 * outcome → durable 决议值映射。allowed-once 落日志记 approve——「批了这
 * 一次」；always 单列（第二参数，条目真实写入时的决议值——与 approve 审计
 * 语义不同）。
 */
function outcomeToDecision(outcome: ApprovalOutcome, alwaysWritten: boolean): ApprovalDecisionValue {
  if (outcome === 'allowed-once') return alwaysWritten ? 'always' : 'approve';
  switch (outcome) {
    case 'rejected':
      return 'reject';
    case 'cancelled':
      return 'cancel';
    case 'unavailable':
      return 'unavailable';
  }
}

/**
 * 组装审批服务。每次 ask 独立 approvalId（randomUUID）——审批对以此为关联
 * 键落日志。构造时注册 approval/answer 事件词汇（幂等跳过——批 19c-1 修正：
 * 「同 dispatch 重复组装是装配 bug」前提随多会话同栈装配废止〔in-process
 * 子代理真工厂首例——每会话各装配一份审批服务共享词汇〕；归属路由恰一键
 * 在 answerer 侧隔离他会话 ask，词汇层不承担装配检测）。
 */
export function createApprovalService(dispatch: EventDispatch, opts: ApprovalServiceOptions = {}): ApprovalService {
  const policy = opts.policy ?? 'ask';
  const sink: ApprovalDecisionSink = opts.sink ?? { asked: () => {}, decided: () => {} };
  if (!dispatch.isRegistered(APPROVAL_ANSWER_EVENT)) {
    dispatch.registerEventNames([APPROVAL_ANSWER_EVENT]);
  }
  /** 会话粘性表（粘性第 1/2 款内存面——随服务生命周期即会话生命周期） */
  const stickyGrants = new Map<string, StickyGrant>(); // 键 = target

  const service: ApprovalService = {
    policyMode: policy,

    async ask(req) {
      // 粘性短路（04 §9 粘性段定形①——ask 之前）：同目标命中且请求档宽
      // ≤ 已授档宽（第 1 款同指纹 = 恰等；第 2 款子集预批 = 请求更严被
      // 宽批包含）→ 免问放行。不产生审批对（没有问就没有 asked/decided）。
      const key = req.stickyKey;
      if (key !== undefined) {
        const grant = stickyGrants.get(key.target);
        if (grant !== undefined && TIER_RANK[key.tier] <= TIER_RANK[grant.grantedTier]) {
          return {
            outcome: 'allowed-once',
            source: key.tier === grant.grantedTier ? 'sticky' : 'subset',
          };
        }
      }

      const approvalId = randomUUID();
      // 审批对第一腿：请求落日志（问询真实发生的开头；never 档不问不落）
      if (policy !== 'never') {
        sink.asked({ approvalId, summary: req.summary });
      }

      // 归属织入（恰一键 {sessionId}）+ approvalId——answerer 的消费面载荷
      const enriched: ApprovalRequest = {
        ...req,
        approvalId,
        ...(opts.ownership !== undefined ? { ownership: opts.ownership } : {}),
      };

      let outcome: ApprovalOutcome;
      let source: DecisionSource;
      // always 是否真实写入条目（决议落账值分流：真写入才落 'always'）
      let alwaysWritten = false;
      if (policy === 'never') {
        // never：确定性拒绝，不派发 answerer（无人值守姿态没有「问谁」）；
        // decided 单腿落账（source=policy-never——审计可分辨策略拒与人拒）
        outcome = 'rejected';
        source = 'policy-never';
      } else {
        try {
          // ask：waterfall 派发——answerer 能答者写 envelope.answer 且短路
          // （不调 next 即已答）；全链无人写 = answer 字段 undefined
          const envelope = await dispatch.waterfall<ApprovalAnswerEnvelope>(APPROVAL_ANSWER_EVENT, { req: enriched });
          const answer = envelope.answer;
          if (answer === 'always') {
            // 「始终允许」：批准本次 + 授权写跨会话条目 + 会话粘性表入账。
            // 载荷无草案或写入回调未装配 = answerer 面本不该呈现该选项，防御
            // 收口视同 approve（零草案零副作用——含粘性表：一次性批准不产生
            // 会话免问面，与「decided 落 approve 而非 always」同口径）
            if (enriched.suggestedEntry !== undefined && opts.persistToolPolicy !== undefined) {
              opts.persistToolPolicy(enriched.suggestedEntry);
              alwaysWritten = true;
              // 粘性表入账（stickyKey 在场时）——会话内同指纹/子集后续免问
              if (key !== undefined) {
                stickyGrants.set(key.target, { target: key.target, grantedTier: key.tier });
              }
            }
            outcome = 'allowed-once';
            source = 'user';
          } else {
            outcome =
              answer === 'approve'
                ? 'allowed-once'
                : answer === 'reject'
                  ? 'rejected'
                  : answer === 'cancel'
                    ? 'cancelled'
                    : // 无人应答 fail-closed：unavailable 不是「稍后再试」，是本次
                      // 不放行（超时/无应答者同归 timeout 源——04 §9 无静默审批条）
                      'unavailable';
            source = 'user';
            if (outcome === 'unavailable') source = 'timeout';
          }
        } catch (cause) {
          // answerer 自身缺陷的错误路收口：先落 decided 闭合审批对
          // （unavailable = 确定收场，不留 asked 无 decided 的悬空审计记录）
          // 再原样上抛——功能面 fail-closed 由管道守门段承担（TOOL_GATE_FAILED
          // block），本 catch 只护审计对完整
          sink.decided({ approvalId, decision: 'unavailable', source: 'timeout' });
          throw cause;
        }
      }

      // 审批对第二腿：决议落日志（never 档 asked 未落但 decided 单腿在——
      // 审计面据 source=policy-never 分辨「问都没问」）
      sink.decided({ approvalId, decision: outcomeToDecision(outcome, alwaysWritten), source });
      return { outcome, source };
    },
  };

  return service;
}
