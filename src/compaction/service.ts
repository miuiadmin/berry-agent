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
 *
 * U4 槽位化（2026-09-09 落码）：三 seam 晚绑定——getConfig（配置槽·两路同
 * 生效）、getProvider（摘要 provider 槽·只作用阈值路）、onBeforeCompact
 * （接管缝·阈值路排队体内区间规划后派发——本模块零 context 边，host 装配把
 * dispatch.waterfall 接进来）。算法执行段 60s 预算、回落三律、三振熔断
 * （pluginId 合并计数、任一路成功复位）皆本件执法。
 */
import type { ProjectedMessage, SessionLog } from '../session/index.js';
import type {
  BeforeCompactResult,
  CompactionConfig,
  CompactionService,
  OverflowOutcome,
  RunUsageFact,
  SegmentPlan,
  SessionBeforeCompactInput,
  SummarizerFn,
  SummaryChannel,
  ThresholdBasis,
} from './types.js';
import { DEFAULT_COMPACTION_CONFIG } from './types.js';
import {
  buildSummaryPrompt,
  evaluateThreshold,
  planFromRange,
  planSegment,
  previousSummaryText,
  SUMMARY_PREFIX,
  summaryBudgetFor,
  validateAdjustedRange,
} from './policy.js';
import { ccrDirectoryOf, ccrHashOf, withCcrSection } from './ccr.js';

/** per-session 防抖状态（内存态——重启清零即丢冷却锚，无正确性损失） */
interface SessionCompactionState {
  /** 上次成功压缩时间（冷却锚；null = 尚未压过） */
  lastCompactAt: number | null;
  /** 进行中/已排队标志（防重入——触发层检查，排队体 finally 清） */
  pending: boolean;
}

/** 空闲态逐出帽（在飞/排队态不逐——只逐空闲） */
const IDLE_STATES_CAP = 256;

/** 三振阈值（05 §2.1 回落三律第 3 律——同一 pluginId 进程级连续 3 次失败停用） */
const STRIKE_LIMIT = 3;

/** fallback 词错误摘要截断长度（防单条爆账——审计面够诊断即可） */
const FALLBACK_ERROR_MAX = 500;

/**
 * 当轮算法选择（05 §2.1 竞争裁决——生效序 takeover > provider 槽 > 宿主
 * complete 通道；「回落直达宿主不串联」= 失败回落射界，熔断忽略是资格除名后
 * 重选、不走该条款）。
 */
type Algo = { kind: 'host' } | { kind: 'plugin'; pluginId: string; fn: SummarizerFn };

/** 算法执行段超时标记（fallback stage='timeout' 判型用） */
class AlgoTimeoutError extends Error {}

/** 插件路空文本产物标记（fallback stage='rejected' 判型用——同宿主通道失败律计入三振） */
class AlgoEmptyTextError extends Error {}

/** 组装选项（host 装配面） */
export interface CompactionServiceOptions {
  /** 摘要通道（complete 单发注入；缺省缺席——阈值路停用、溢出面恒报 failed） */
  readonly channel?: SummaryChannel;
  /** 配置覆盖（缺省 DEFAULT_COMPACTION_CONFIG） */
  readonly config?: Partial<CompactionConfig>;
  /**
   * 配置取值器（U4 配置槽——晚绑定）：每次判阈/规划/预算现取，boot 后 mount
   * 覆盖 settle、/reload 重跑自然生效。两路同生效（数值是宿主机制参数非策略
   * 算法）。缺省 = options.config 装配时常量合并（host 装配未接配置槽的直装形）。
   */
  readonly getConfig?: () => CompactionConfig;
  /**
   * 摘要 provider 槽容器（U4 算法换装·常设）：host 装配把
   * ctx.compaction.registerSummarizer 的登记容器接进来。只作用阈值路（溢出
   * 兜底恒宿主缺省算法系既有立法，槽不可及）。缺省无槽。
   */
  readonly getProvider?: () => { pluginId: string; fn: SummarizerFn } | undefined;
  /**
   * 接管缝派发 seam（U4 session_before_compact）：只在阈值路排队体内、区间
   * 规划后、start 落账前派发。host 装配包 dispatch.waterfall（pluginId 铸造
   * 覆写与 lastAdjustedBy 逐跳记录在装配层包装）——本模块零 context 边。
   */
  readonly onBeforeCompact?: (input: SessionBeforeCompactInput) => Promise<BeforeCompactResult>;
  /** 算法执行段预算毫秒（U4 两帽分立之算法段——缺省 60s；provider 槽同帽） */
  readonly algoTimeoutMs?: number;
  /** 时钟注入（缺省 Date.now——测试假钟面） */
  readonly now?: () => number;
  /** 失败可观测面（缺省 stderr 直写；装配根接 logger.warn） */
  readonly warn?: (message: string) => void;
}

/** fallback 词统一落账形（05 §1.1——回落三律第 3 律响亮记账；circuit 位末次记三振停用） */
function appendFallback(
  log: SessionLog,
  source: string,
  stage: 'throw' | 'timeout' | 'rejected',
  error: unknown,
  circuit = false,
): void {
  log.append('compaction/fallback', {
    source,
    stage,
    error: String(error).slice(0, FALLBACK_ERROR_MAX),
    ...(circuit ? { circuit: true } : {}),
  });
}

/**
 * obs-b 五门 skip 统一落账形（05 §1.1 compaction/skip + §2.1 判序定形注）：
 * fire 而被门挡才落（below 恒不落）；basis 五件 = fire 判据快照（与 start
 * 同律——触发时刻判据素材）；remainMs 仅 cooldown 门随行（窗余值）；五门
 * 均不动冷却锚（skip 非 completed——下轮触发照常参与判阈）。
 */
function appendSkip(
  log: SessionLog,
  gate: 'pending' | 'cooldown' | 'no-segment' | 'retracted' | 'no-channel',
  basis: ThresholdBasis,
  remainMs?: number,
): void {
  log.append('compaction/skip', {
    gate,
    ...basis,
    ...(remainMs !== undefined ? { remainMs } : {}),
  });
}

/**
 * 组装压缩服务。五步骨架两事件形（05 §2.1 步 3 勘正）：摘要 user/message
 * 普通 append（不带 surfaceOp——孤儿摘要处置条款依赖此形）；遮蔽指令
 * compaction/surface 经 appendWithSurfaceOp 正门独携信封。
 */
export function createCompactionService(options: CompactionServiceOptions = {}): CompactionService {
  const channel = options.channel;
  // 配置晚绑定：getConfig seam 优先（U4 配置槽）；缺省 = 装配时常量合并
  const defaultConfig: CompactionConfig = { ...DEFAULT_COMPACTION_CONFIG, ...options.config };
  const getConfig = options.getConfig ?? (() => defaultConfig);
  const getProvider = options.getProvider;
  const onBeforeCompact = options.onBeforeCompact;
  const algoTimeoutMs = options.algoTimeoutMs ?? 60_000;
  const now = options.now ?? Date.now;
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));

  /** per-session 防抖分账（插入序即逐出序——Map 迭代序保真） */
  const states = new Map<string, SessionCompactionState>();
  /** 全局串行链尾（并发上限 1 的单点；链身永不 reject——尾接吞异常） */
  let chain: Promise<unknown> = Promise.resolve();
  /** 通道缺席告警旗（只告警一次——缺配是装配错误不是运行抖动） */
  let warnedNoChannel = false;
  /**
   * 三振表（进程级）：按 pluginId 合并计数——接管缝声明者与 provider 槽注册
   * 者同账；复位 = 同 pluginId 任一路成功即清（「连续」的合并计数语义）。
   * 熔断复位走进程重启（05 §2.1 回落三律第 3 律）。
   */
  const strikes = new Map<string, number>();
  const isTripped = (pluginId: string): boolean => (strikes.get(pluginId) ?? 0) >= STRIKE_LIMIT;

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

  /** 宿主通道执行（直选路与回落位共用）：五段结构 prompt + 迭代链前次摘要 + 字符制预算 */
  async function runHost(log: SessionLog, plan: SegmentPlan): Promise<string> {
    const response = await channel!.complete({
      prompt: buildSummaryPrompt({
        occluded: plan.occluded,
        previousSummary: previousSummaryText(log.events()),
        maxChars: summaryBudgetFor(plan.occludedChars, getConfig()),
      }),
      maxChars: summaryBudgetFor(plan.occludedChars, getConfig()),
    });
    // 空摘要 = 通道质量异常——按通道失败收口（把内容遮在空摘要后是静默信息丢失）
    if (response.text.trim().length === 0) throw new Error('摘要通道返回空文本');
    return response.text;
  }

  /** 算法执行段预算帽（超时后原 promise 仍在跑——SummarizerFn 无 abort 面，产物弃用不采信） */
  function withTimeout(p: Promise<{ text: string }>, ms: number): Promise<{ text: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new AlgoTimeoutError(`算法执行段超预算 ${ms}ms`)), ms);
      p.then(
        (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        (e) => {
          clearTimeout(timer);
          reject(e);
        },
      );
    });
  }

  /**
   * 算法执行（U4）：host 直选失败原样上抛；插件路三段执法——60s 预算 → 失败
   * fallback 记账 + 三振推进 → 回落直达宿主（不串联试下一层）。回落成功记
   * summarizer='host'（谁失败由 fallback 词承载——05 §1.1 词表）；回落失败
   * 上抛（失败终局恒宿主通道失败）。
   */
  async function runAlgo(
    log: SessionLog,
    plan: SegmentPlan,
    algo: Algo,
  ): Promise<{ text: string; summarizer: string }> {
    if (algo.kind === 'host') {
      return { text: await runHost(log, plan), summarizer: 'host' };
    }
    try {
      const response = await withTimeout(
        algo.fn({
          sessionId: log.sessionId,
          occluded: plan.occluded,
          previousSummary: previousSummaryText(log.events()) ?? undefined,
          maxChars: summaryBudgetFor(plan.occludedChars, getConfig()),
          plan,
        }),
        algoTimeoutMs,
      );
      // 空文本产物同宿主通道失败律（fiveStep 既有）——计入三振
      if (response.text.trim().length === 0) throw new AlgoEmptyTextError('插件算法返回空文本');
      strikes.delete(algo.pluginId); // 复位：同 pluginId 任一路成功即清
      return { text: response.text, summarizer: `plugin:${algo.pluginId}` };
    } catch (err) {
      // 失败三形态判型：超预算 / 空文本产物 / 抛错（stage 词面 05 §1.1）
      const stage =
        err instanceof AlgoTimeoutError ? 'timeout' : err instanceof AlgoEmptyTextError ? 'rejected' : 'throw';
      const count = (strikes.get(algo.pluginId) ?? 0) + 1;
      const circuit = count >= STRIKE_LIMIT;
      strikes.set(algo.pluginId, count);
      appendFallback(log, `plugin:${algo.pluginId}`, stage, err, circuit);
      // 回落不失败：当轮直达宿主通道继续完成（策略可崩、机制不塌——三律第 1 律）
      return { text: await runHost(log, plan), summarizer: 'host' };
    }
  }

  /**
   * 五步骨架（05 §2.1）：算法解析先行 → start（携 summarizer 归因终局值）→
   * 摘要普通 append → compaction/surface 经正门携信封 → end。失败即 end-failed
   * 闭段（防孤 start 悬挂）后原样上抛——上层按路收口（阈值路 warn、溢出路
   * 'failed'）。start 后置于算法解析：归因位随执行终局定形（插件路成功记
   * plugin:<id>、回落后记 'host'；失败闭段归因恒 'host'——一切失败终局都是
   * 宿主通道失败，插件失败已由 fallback 词承载）。
   */
  async function fiveStep(
    log: SessionLog,
    reason: 'threshold' | 'overflow',
    plan: SegmentPlan,
    basis?: ThresholdBasis,
    algo: Algo = { kind: 'host' },
  ): Promise<void> {
    // 步 2 前置（算法解析——U4）：willRetry 语义不变（阈值路失败后下轮触发自然
    // 重做，溢出路一次性）
    let text: string;
    let summarizer: string;
    try {
      ({ text, summarizer } = await runAlgo(log, plan, algo));
    } catch (err) {
      // 失败即时闭段（防孤 start 悬挂——§4 恢复协议按未完成压缩重做）
      log.append('compaction/start', {
        reason,
        willRetry: reason === 'threshold',
        ...(basis ?? {}),
        summarizer: 'host',
      });
      log.append('compaction/end', { reason: 'failed', error: String(err) });
      throw err;
    }
    // 步 1：压缩意图与判据快照（basis 五件仅阈值路落账——RP4 扩值含 cache 两桶）+ 归因位
    log.append('compaction/start', {
      reason,
      willRetry: reason === 'threshold',
      ...(basis ?? {}),
      summarizer,
    });
    // 步 3：摘要落账——两事件形：普通 append、不带 surfaceOp（孤儿摘要按普通
    // user/message 同视的处置条款依赖此形）；载体前缀防注入。
    // CCR 标记段（05 §2.1 压缩可逆性）：宿主追加非算法产物——当次标记行 +
    // 目录恒链（此前历次 surface 事件全量：旧载体被遮蔽后历史哈希仍可达）
    const hash = ccrHashOf(plan.occluded);
    const directory = [
      ...ccrDirectoryOf(log.events()),
      { hash, messages: plan.occludedMessages, chars: plan.occludedChars },
    ];
    const summaryEvent = log.append('user/message', {
      content: `${SUMMARY_PREFIX} ${withCcrSection(text, directory)}`,
      source: 'compaction',
    });
    // 步 4：遮蔽指令——正门独携信封；溯源 = 区间全部 seq + 摘要事件 seq；
    // ccrHash = 归档映射位（本事件即「哈希 → 区间原文」映射记录——events 表
    // 即归档 store，检索面 ccr_retrieve 的匹配键）
    const sourceEventSeqs: number[] = [];
    for (let seq = plan.start; seq <= plan.end; seq++) sourceEventSeqs.push(seq);
    sourceEventSeqs.push(summaryEvent.seq);
    log.appendWithSurfaceOp(
      'compaction/surface',
      {
        summarySeq: summaryEvent.seq,
        occludedMessages: plan.occludedMessages,
        occludedChars: plan.occludedChars,
        ccrHash: hash,
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

  /**
   * 接管缝裁决（U4——宿主检查序，05 §2.1 位间裁决）：veto 先检（在场即否决
   * 收场，余位不问）→ takeover 次之（在场即接管；接管输入 = 管线终值 plan，
   * 先行监听者的有效调整自然随值链传入；熔断者忽略 = 资格除名后重选）→
   * 调整位（引用变即校验 + 素材重算；非法调整 = 忽略 + fallback 记账 +
   * 宿主原案续跑）。返回当轮算法与生效区间；veto 收场返回 null。
   */
  async function dispatchBeforeCompact(
    log: SessionLog,
    plan: SegmentPlan,
    basis: ThresholdBasis,
    messages: readonly ProjectedMessage[],
  ): Promise<{ algo: Algo; plan: SegmentPlan } | null> {
    const { value, lastAdjustedBy } = await onBeforeCompact!({
      sessionId: log.sessionId,
      reason: 'threshold',
      plan,
      basis,
    });
    // veto 先检：一票否决收场（判阈触发过是审计面事实——落 start+end 对可查、
    // 无声取消不可观测；意见位无三振）
    if (value.veto !== undefined) {
      log.append('compaction/start', { reason: 'threshold', willRetry: true, ...basis });
      log.append('compaction/end', { reason: 'vetoed' });
      return null;
    }
    let algo: Algo = { kind: 'host' };
    // takeover 次之：熔断者忽略（资格除名——当轮按生效序落 provider/host，
    // 非失败回落不走「直达宿主」条款；钩子本身不停派——veto/调整仍有效）
    if (value.takeover !== undefined) {
      const pid = value.takeover.pluginId ?? 'unknown';
      if (isTripped(pid)) warn(`[COMPACTION_CIRCUIT_IGNORE] takeover 位被熔断忽略: ${pid}`);
      else algo = { kind: 'plugin', pluginId: pid, fn: value.takeover.summarize };
    }
    // 调整位：值链改写必新建对象（引用比较）；生效区间素材三件宿主重算（区间
    // 主权 = 唯一采用面，不信载荷）；越宿主原案界 / 区间内无投影消息 = 非法调整
    if (value.plan !== plan) {
      const accepted =
        validateAdjustedRange(value.plan, plan) &&
        planFromRange(value.plan.start, value.plan.end, messages).occludedMessages >= 1;
      if (accepted) {
        plan = planFromRange(value.plan.start, value.plan.end, messages);
      } else {
        appendFallback(
          log,
          lastAdjustedBy !== undefined ? `plugin:${lastAdjustedBy}` : 'host',
          'rejected',
          `非法调整区间 [${value.plan.start}, ${value.plan.end}]（越宿主原案界或区间内无投影消息）`,
        );
        // 宿主原案续跑（忽略该调整）
      }
    }
    return { algo, plan };
  }

  return {
    handleRunSettled(input: { log: SessionLog; usage?: RunUsageFact }): void {
      // —— obs-b 判序定形（05 §2.1）：阈值评估先行（纯函数零副作用）——
      //    below 不落任何账（判据素材可后算，不为 below 防 durable 膨胀落
      //    skip）；fire 而被门挡才落 compaction/skip（五门词 05 §1.1）。
      // 判阈双源：真 token 主判（usage.input）、投影字符兜底（chars/4）
      const cfg = getConfig();
      const verdict = evaluateThreshold({
        usageInput: input.usage?.input ?? null,
        contextWindow: input.usage?.contextWindow,
        projectedChars: input.log.projectedChars(),
        config: cfg,
      });
      if (verdict === null || !verdict.fire) return;
      // basis 五件（RP4 扩值）：fire 判据快照——触发时刻判据素材（与 start
      // 同律；cache 两桶从主 loop 真值笔同笔透传，estimate 兜底路恒缺省不落）
      const basis: ThresholdBasis = {
        basis: verdict.basis,
        estTokens: verdict.estTokens,
        effectiveWindow: verdict.effectiveWindow,
        ...(input.usage?.cacheRead !== undefined ? { cacheRead: input.usage.cacheRead } : {}),
        ...(input.usage?.cacheWrite !== undefined ? { cacheWrite: input.usage.cacheWrite } : {}),
      };
      // 门① no-channel（装配级永久门最先呈报最诊断）：通道缺席——首触落
      // 一条 skip 后静默（与 warn-once 同锚——缺配是装配错误不是运行抖动）
      if (channel === undefined) {
        if (!warnedNoChannel) {
          warnedNoChannel = true;
          warn('[COMPACTION_NO_CHANNEL] 摘要通道缺席——阈值压缩停用（溢出面将报 failed）');
          appendSkip(input.log, 'no-channel', basis);
        }
        return;
      }
      const state = stateOf(input.log.sessionId);
      // 门② pending：防重入挡（进行中/已排队期重复 fire 可观测）
      if (state.pending) {
        appendSkip(input.log, 'pending', basis);
        return;
      }
      // 门③ cooldown：冷却窗挡（判据与 policy.inCooldown 同式就地展开——
      // remainMs 窗余值需要差值，单一 now() 采样点保证两值同账）
      if (state.lastCompactAt !== null && now() - state.lastCompactAt < cfg.cooldownMs) {
        appendSkip(input.log, 'cooldown', basis, cfg.cooldownMs - (now() - state.lastCompactAt));
        return;
      }
      state.pending = true;
      // fire-and-forget：排队体内部全收口（不外抛）；冷却锚只在成功时推进
      void enqueue(async () => {
        try {
          // 锁内复评（幻影触发闸）：全局串行链排队期间判据面可能已变（投影
          // 被他路压缩改写 / 配置槽翻值）；原 usage 笔不重放——真 token 计量
          // 是请求事实非投影派生，token-basis 复评不受投影影响
          const freshVerdict = evaluateThreshold({
            usageInput: input.usage?.input ?? null,
            contextWindow: input.usage?.contextWindow,
            projectedChars: input.log.projectedChars(),
            config: getConfig(),
          });
          if (freshVerdict === null || !freshVerdict.fire) {
            // 门④ retracted：入队时 fire、锁内已不 fire——幻影触发可查（basis
            // 用原 verdict 快照——触发时刻判据，非复评时刻）
            appendSkip(input.log, 'retracted', basis);
            return; // 不动冷却锚（skip 非 completed）
          }
          // 锁内新投影（全局串行链 = 互斥锁——排队期间他路压缩可能已改写投影，
          // 规划与落账同账零迟滞窗）
          const messages = input.log.projection();
          const plan = planSegment({
            events: input.log.events(),
            messages,
            tailKeep: getConfig().tailKeep,
          });
          if (plan === null) {
            // 门⑤ no-segment：fire 但区间规划无合法段（head+tail 全兜的薄会话形）
            appendSkip(input.log, 'no-segment', basis);
            return; // 不动冷却锚——诚实无操作可观测
          }
          // —— 接管缝（U4）：阈值路排队体内、区间规划后、start 落账前派发 ——
          let algo: Algo = { kind: 'host' };
          let effectivePlan = plan;
          if (onBeforeCompact !== undefined) {
            const dispatched = await dispatchBeforeCompact(input.log, plan, basis, messages);
            if (dispatched === null) return; // veto 收场（冷却锚不推进——否决非完成）
            ({ algo, plan: effectivePlan } = dispatched);
          }
          // provider 槽（常设注册——takeover 缺席/被熔断忽略时顶上；熔断视为空；
          // 只作用阈值路——溢出 路 compactForOverflow 不经此段）
          if (algo.kind === 'host' && getProvider !== undefined) {
            const provider = getProvider();
            if (provider !== undefined) {
              if (isTripped(provider.pluginId)) {
                warn(`[COMPACTION_CIRCUIT_IGNORE] provider 槽被熔断视为空: ${provider.pluginId}`);
              } else {
                algo = { kind: 'plugin', pluginId: provider.pluginId, fn: provider.fn };
              }
            }
          }
          await fiveStep(input.log, 'threshold', effectivePlan, basis, algo);
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
          tailKeep: getConfig().tailKeep, // 两路同生效（数值系宿主机制参数非策略算法）
        });
        if (plan === null) return 'nothing'; // 区间不足（应急档也压无可压）
        try {
          // 溢出 路：恒宿主缺省算法、不派发接管缝（应急自救通道不让渡策略层）
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
