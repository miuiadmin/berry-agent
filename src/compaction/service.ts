/**
 * compaction 服务面（05 §2.1 五步骨架 + §2.3 溢出兜底——编排层）。
 *
 * 三入口（types.CompactionService）：handleRunSettled（阈值路 fire-and-forget）、
 * compactForOverflow（溢出应急可等待）、drain（排空收口）。
 *
 * 并发模型（05 §2.1「多会话分账」）：后台压缩任务并发上限 = 1——全局串行链
 * ⊇ per-session 互斥；溢出路入同一链（「先排空已排队压缩再执行」由 FIFO 天然
 * 达成）。per-session 防抖状态（冷却锚/进行中标志）内存态、重启清零——丢一次
 * 压缩无正确性损失（下轮触发补上）；空闲态逐出帽 256（04 篇 Job 注册表同款
 * 帽值纪律——防长开进程无界累积）。
 */
import type { SessionLog } from '../session/index.js';
import type {
  CompactionConfig,
  CompactionService,
  OverflowOutcome,
  RunUsageFact,
  SegmentPlan,
  SummaryChannel,
  ThresholdBasis,
} from './types.js';
import { DEFAULT_COMPACTION_CONFIG } from './types.js';
import {
  buildSummaryPrompt,
  evaluateThreshold,
  inCooldown,
  planSegment,
  previousSummaryText,
  SUMMARY_PREFIX,
  summaryBudgetFor,
} from './policy.js';

/** per-session 防抖状态（内存态——重启清零即丢冷却锚，无正确性损失） */
interface SessionCompactionState {
  /** 上次成功压缩时间（冷却锚；null = 尚未压过） */
  lastCompactAt: number | null;
  /** 进行中/已排队标志（防重入——触发层检查，排队体 finally 清） */
  pending: boolean;
}

/** 空闲态逐出帽（在飞/排队态不逐——只逐空闲） */
const IDLE_STATES_CAP = 256;

/** 组装选项（host 装配面） */
export interface CompactionServiceOptions {
  /** 摘要通道（complete 单发注入；缺省缺席——阈值路停用、溢出面恒报 failed） */
  readonly channel?: SummaryChannel;
  /** 配置覆盖（缺省 DEFAULT_COMPACTION_CONFIG） */
  readonly config?: Partial<CompactionConfig>;
  /** 时钟注入（缺省 Date.now——测试假钟面） */
  readonly now?: () => number;
  /** 失败可观测面（缺省 stderr 直写；装配根接 logger.warn） */
  readonly warn?: (message: string) => void;
}

/**
 * 组装压缩服务。五步骨架两事件形（05 §2.1 步 3 勘正）：摘要 user/message
 * 普通 append（不带 surfaceOp——孤儿摘要处置条款依赖此形）；遮蔽指令
 * compaction/surface 经 appendWithSurfaceOp 正门独携信封。
 */
export function createCompactionService(options: CompactionServiceOptions = {}): CompactionService {
  const channel = options.channel;
  const config: CompactionConfig = { ...DEFAULT_COMPACTION_CONFIG, ...options.config };
  const now = options.now ?? Date.now;
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));

  /** per-session 防抖分账（插入序即逐出序——Map 迭代序保真） */
  const states = new Map<string, SessionCompactionState>();
  /** 全局串行链尾（并发上限 1 的单点；链身永不 reject——尾接吞异常） */
  let chain: Promise<unknown> = Promise.resolve();
  /** 通道缺席告警旗（只告警一次——缺配是装配错误不是运行抖动） */
  let warnedNoChannel = false;

  /** 全局串行入队：前序成败不阻断后继；result 即刻挂 handler 防 unhandledRejection */
  function enqueue<T>(body: () => Promise<T>): Promise<T> {
    const result = chain.then(body, body);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  /** 取（或建）per-session 状态；建前按帽逐出空闲态 */
  function stateOf(sessionId: string): SessionCompactionState {
    let state = states.get(sessionId);
    if (state === undefined) {
      // 帽前逐出：只逐空闲态（在飞/排队的删了会破防重入账）；全在飞时暂超帽
      // 可接受——帽执法不破在飞正确性
      if (states.size >= IDLE_STATES_CAP) {
        for (const [key, value] of states) {
          if (states.size < IDLE_STATES_CAP) break;
          if (!value.pending) states.delete(key);
        }
      }
      state = { lastCompactAt: null, pending: false };
      states.set(sessionId, state);
    }
    return state;
  }

  /** 末条 compaction/end 的 seq（-1 = 从未压缩）——溢出路「他路已缩量」对账锚 */
  function lastEndSeq(log: SessionLog): number {
    const ends = log.eventsOfType('compaction/end');
    return ends.length > 0 ? ends[ends.length - 1]!.seq : -1;
  }

  /**
   * 五步骨架（05 §2.1）：start → complete 单发摘要 → 摘要普通 append →
   * compaction/surface 经正门携信封 → end。失败即 end-failed 闭段（防孤
   * start 悬挂）后原样上抛——上层按路收口（阈值路 warn、溢出路 'failed'）。
   */
  async function fiveStep(
    log: SessionLog,
    reason: 'threshold' | 'overflow',
    plan: SegmentPlan,
    basis?: ThresholdBasis,
  ): Promise<void> {
    // 步 1：压缩意图与判据快照（basis 三件仅阈值路落账）；willRetry——阈值路
    // 失败后下轮触发自然重做，溢出路一次性（失败=驱动终态，重试归驱动编舞）
    log.append('compaction/start', { reason, willRetry: reason === 'threshold', ...(basis ?? {}) });
    let text: string;
    try {
      // 步 2：complete 单发（prompt 五段结构 + 迭代链前次摘要；预算字符制）；
      // llm/usage 计量由通道真身照章入账
      const response = await channel!.complete({
        prompt: buildSummaryPrompt({
          occluded: plan.occluded,
          previousSummary: previousSummaryText(log.events()),
          maxChars: summaryBudgetFor(plan.occludedChars, config),
        }),
        maxChars: summaryBudgetFor(plan.occludedChars, config),
      });
      text = response.text;
      // 空摘要 = 通道质量异常——按通道失败收口（把内容遮在空摘要后是静默信息丢失）
      if (text.trim().length === 0) throw new Error('摘要通道返回空文本');
    } catch (err) {
      // 失败即时闭段（防孤 start 悬挂——§4 恢复协议按未完成压缩重做）
      log.append('compaction/end', { reason: 'failed', error: String(err) });
      throw err;
    }
    // 步 3：摘要落账——两事件形：普通 append、不带 surfaceOp（孤儿摘要按普通
    // user/message 同视的处置条款依赖此形）；载体前缀防注入
    const summaryEvent = log.append('user/message', {
      content: `${SUMMARY_PREFIX} ${text}`,
      source: 'compaction',
    });
    // 步 4：遮蔽指令——正门独携信封；溯源 = 区间全部 seq + 摘要事件 seq
    const sourceEventSeqs: number[] = [];
    for (let seq = plan.start; seq <= plan.end; seq++) sourceEventSeqs.push(seq);
    sourceEventSeqs.push(summaryEvent.seq);
    log.appendWithSurfaceOp(
      'compaction/surface',
      {
        summarySeq: summaryEvent.seq,
        occludedMessages: plan.occludedMessages,
        occludedChars: plan.occludedChars,
      },
      { op: 'replace', start: plan.start, end: plan.end },
      sourceEventSeqs,
    );
    // 步 5：完成收尾（载荷 = 规模审计对账面）
    log.append('compaction/end', {
      reason: 'completed',
      occludedMessages: plan.occludedMessages,
      occludedChars: plan.occludedChars,
    });
  }

  return {
    handleRunSettled(input: { log: SessionLog; usage?: RunUsageFact }): void {
      // 通道缺席：阈值路停用（告警一次——缺配是装配错误不是运行抖动）
      if (channel === undefined) {
        if (!warnedNoChannel) {
          warnedNoChannel = true;
          warn('[COMPACTION_NO_CHANNEL] 摘要通道缺席——阈值压缩停用（溢出面将报 failed）');
        }
        return;
      }
      const state = stateOf(input.log.sessionId);
      if (state.pending) return; // 防重入（进行中/已排队）
      if (inCooldown(state.lastCompactAt, now(), config)) return; // 冷却防抖
      // 判阈双源：真 token 主判（usage.input）、投影字符兜底（chars/4）
      const verdict = evaluateThreshold({
        usageInput: input.usage?.input ?? null,
        contextWindow: input.usage?.contextWindow,
        projectedChars: input.log.projectedChars(),
        config,
      });
      if (verdict === null || !verdict.fire) return;
      state.pending = true;
      // fire-and-forget：排队体内部全收口（不外抛）；冷却锚只在成功时推进
      void enqueue(async () => {
        try {
          // 锁内新投影（全局串行链 = 互斥锁——排队期间他路压缩可能已改写投影，
          // 规划与落账同账零迟滞窗）
          const plan = planSegment({
            events: input.log.events(),
            messages: input.log.projection(),
            tailKeep: config.tailKeep,
          });
          if (plan === null) return; // 区间不足——诚实无操作（不动冷却锚）
          await fiveStep(input.log, 'threshold', plan, {
            basis: verdict.basis,
            estTokens: verdict.estTokens,
            effectiveWindow: verdict.effectiveWindow,
          });
          state.lastCompactAt = now();
        } catch (err) {
          // fiveStep 已落 end-failed 闭段——此处只兜五步之外的意外（可观测不静默）
          warn(`[COMPACTION_FAILED] ${input.log.sessionId}: ${String(err)}`);
        } finally {
          state.pending = false;
        }
      });
    },

    async compactForOverflow(log: SessionLog): Promise<OverflowOutcome> {
      // 门三道之三（归驱动执法面）：通道不可用直接终态——无摘要则无压缩
      if (channel === undefined) return 'failed';
      // 入队锚：等待期间他路压缩若已落账，缩量已达成（归因不问路——恢复目标
      // 是「缩了可续入」，谁压的不重要；FIFO 链保证本任务在他路之后执行）
      const endSeqAtEntry = lastEndSeq(log);
      return enqueue(async () => {
        if (lastEndSeq(log) !== endSeqAtEntry) return 'compacted';
        const plan = planSegment({
          events: log.events(),
          messages: log.projection(),
          tailKeep: config.tailKeep,
        });
        if (plan === null) return 'nothing'; // 区间不足（应急档也压无可压）
        try {
          await fiveStep(log, 'overflow', plan);
        } catch {
          return 'failed'; // fiveStep 已落 end-failed 闭段——诚实报败，重试编舞归驱动
        }
        // 溢出压缩同样推进冷却锚：防紧随的阈值触发对刚压过的区间重复开工
        stateOf(log.sessionId).lastCompactAt = now();
        return 'compacted';
      });
    },

    async drain(): Promise<void> {
      // 快照语义：等此刻前已入队/在飞的一切（chain 永不 reject——尾接吞异常）；
      // 等待期间新入队的不在本方法承诺内
      await chain;
    },
  };
}
