/**
 * compaction 类型面（05 §2.1 长会话压缩——契约先行；机制承 berry 同名模块，
 * 码面新写）。
 *
 * 本文件持本模块全部对外类型与缺省配置：
 *  - SummaryChannel：complete 单发通道的结构注入面（host 装配经 llm provide，
 *    本模块零 llm import——拓扑边仅 contracts + session 的关键）；
 *  - CompactionConfig：阈值/区间/冷却/摘要参数全量（05 §2.1 摘要参数段定值）；
 *  - SegmentPlan：区间规划产物（policy.planSegment 输出——五步骨架的区间输入）；
 *  - CompactionService：服务面三入口（阈值触发 / 溢出应急 / 排空收口）。
 */
import type { ProjectedMessage, SessionLog } from '../session/index.js';

/**
 * 摘要通道（complete 单发——04 篇 §3.7）：结构注入而非模块依赖，host 装配
 * 时经 llm provide 接线。请求带 maxChars（摘要预算——字符制）；计量（llm/usage）
 * 由通道真身照章入账，本模块不经手。
 */
export interface SummaryChannel {
  /** 单发补全：prompt 进、text 出（失败抛错——五步骨架落 end-failed 闭段） */
  complete(request: { prompt: string; maxChars: number }): Promise<{ text: string }>;
}

/** SummarizerFn 输入（05 §2.1 U4 provider 槽——素材给足、输出只要文本） */
export interface SummarizerInput {
  /** 目标会话（归因与诊断面） */
  readonly sessionId: string;
  /** 遮蔽区间消息本体（与 plan.occluded 同源——素材便捷入口，算法最常用件） */
  readonly occluded: readonly ProjectedMessage[];
  /** 上次压缩的摘要文本（无前次则 undefined——续摘素材） */
  readonly previousSummary: string | undefined;
  /** 摘要预算字符上限（宿主 policy 单源——与宿主通道同一预算口径） */
  readonly maxChars: number;
  /** 区间规划全形（SegmentPlan——宿主 policy 单源，provider 槽只换算法不换区间策略） */
  readonly plan: SegmentPlan;
}

/**
 * 摘要算法位（05 §2.1 U4——签名定名 SummarizerFn）：provider 槽常设注册与
 * takeover 逐次声明共用此签名（两路失败按 pluginId 同账三振）。空文本产物
 * 同宿主通道失败律（fiveStep 既有——计入三振）。
 */
export type SummarizerFn = (input: SummarizerInput) => Promise<{ text: string }>;

/**
 * session_before_compact 钩子载荷（05 §2.1 U4 接管缝——waterfall 值链）。
 * 位制四途（宿主只认位——置位后不调 next〔短路〕或置位照常 next 等价，
 * session_before_fork veto 位同律）；宿主检查序 = veto 先检 → takeover 次之
 * → 两位皆空时终值 plan 生效（先行监听者的有效调整随值链传入）。
 */
export interface SessionBeforeCompactInput {
  /** 目标会话 */
  readonly sessionId: string;
  /** 触发路径（U4 溢出应急路不派发——恒宿主缺省算法） */
  readonly reason: 'threshold';
  /** 宿主规划器产出的区间（SegmentPlan 全形——调整途改写此位后 next） */
  plan: SegmentPlan;
  /** 触发判据快照（阈值路必在——evaluateThreshold 产物） */
  readonly basis?: ThresholdBasis;
  /** 否决位（意见位无三振——落 start{willRetry:true} + end{vetoed} 对） */
  veto?: { reason: string };
  /**
   * 接管位（携 summarize——当次压缩算法由该函数执行；60s 后台任务段预算）。
   * pluginId 由宿主钩子包装层强制覆写（e-4 caller 闭包同律——插件自填被
   * 覆写，冒名结构性不存在）。
   */
  takeover?: { pluginId?: string; summarize: SummarizerFn };
}

/**
 * 派发 seam 返回形（U4 接管缝——service 的 onBeforeCompact 出口）：value =
 * 值链终值（veto/takeover/plan 位照位制）；lastAdjustedBy = 最后改写 plan 的
 * 监听者 pluginId（装配层逐跳记录——非法调整的 fallback 记账归因面；全程
 * 无调整则缺席）。
 */
export interface BeforeCompactResult {
  readonly value: SessionBeforeCompactInput;
  readonly lastAdjustedBy?: string;
}

/** 压缩配置（05 §2.1 各参数段单源；全字段可经 host 覆盖） */
export interface CompactionConfig {
  /** 阈值比例：真 token 计量（缺席时估算）达窗口此比例触发（缺省 0.5） */
  readonly thresholdRatio: number;
  /** tail 保留投影消息条数（缺省 6——最近交互原文保留） */
  readonly tailKeep: number;
  /** 冷却：两次压缩最小间隔毫秒（缺省 10 分钟——防连续触发抖动） */
  readonly cooldownMs: number;
  /** 摘要目标压缩率（缺省 0.2——目标长度 = 被遮蔽字符数 × 此率） */
  readonly summaryRatio: number;
  /** 摘要长度下限字符（缺省 2000） */
  readonly summaryMinChars: number;
  /** 摘要长度上限字符（缺省 12000） */
  readonly summaryMaxChars: number;
  /** 兜底窗口 token 数：真 contextUsage 缺席时的换算分母（缺省 200_000） */
  readonly fallbackWindowTokens: number;
}

/** 缺省配置（05 §2.1「摘要参数」+「防抖三件」+「阈值」段定值——首版实测后调） */
export const DEFAULT_COMPACTION_CONFIG: CompactionConfig = {
  thresholdRatio: 0.5,
  tailKeep: 6,
  cooldownMs: 600_000,
  summaryRatio: 0.2,
  summaryMinChars: 2000,
  summaryMaxChars: 12000,
  fallbackWindowTokens: 200_000,
};

/**
 * 阈值判据快照（compaction/start 的 basis 五件——仅阈值路落账，05 §2.1；
 * 2026-09-11 cache 经济批 RP4：三件扩五件 +cacheRead/+cacheWrite）。
 * 溢出应急路无判阈过程，不落。
 */
export interface ThresholdBasis {
  /** 判据来源：真 token 计量（usage）或投影字符估算（estimate——chars/4） */
  readonly basis: 'usage' | 'estimate';
  /** 参与比较的 token 估算值（usage 路 = 真 input 值） */
  readonly estTokens: number;
  /** 实际生效的窗口大小（真 contextWindow 或 fallbackWindowTokens） */
  readonly effectiveWindow: number;
  /**
   * 触发时点主 loop 最近计量的 cacheRead 桶（RP4——压缩即前缀缓存全毁，
   * 毁前成本快照记账可见；与 estTokens 同事件同笔〔lastUsageFactOf〕快照
   * 自洽。estimate 兜底路无真值笔恒缺省）。
   */
  readonly cacheRead?: number;
  /** 同上 cacheWrite 桶（同笔同源） */
  readonly cacheWrite?: number;
}

/** 区间规划产物（policy.planSegment 输出；start/end 为事件 seq 闭区间） */
export interface SegmentPlan {
  /** 遮蔽区间起始 seq（含）——对齐 turn 边界（head 保首个完整 turn / 紧接上次遮蔽终点） */
  readonly start: number;
  /** 遮蔽区间结束 seq（含）——不越最近完整 turn 边界、不侵入 tail */
  readonly end: number;
  /** 区间内投影消息条数（审计面——compaction/surface 载荷） */
  readonly occludedMessages: number;
  /** 区间内投影字符量（与 fold.chars 同尺：逐消息 JSON 长度和——审计面） */
  readonly occludedChars: number;
  /** 区间内投影消息本体（摘要提示词的素材——纯内存，不入账） */
  readonly occluded: readonly ProjectedMessage[];
}

/** 溢出兜底出口三值（05 §2.3——门三道归驱动执法，服务面只如实报结果） */
export type OverflowOutcome = 'compacted' | 'nothing' | 'failed';

/** run 结算计量事实（handleRunSettled 入参——主 loop 的真 token 笔） */
export interface RunUsageFact {
  /** 本轮请求的 input token 真值（provider 报数） */
  readonly input: number;
  /** 模型上下文窗口（缺省用 fallbackWindowTokens） */
  readonly contextWindow?: number;
  /**
   * 同笔 cacheRead 桶（RP4——basis 五件的数据源；与 input 同一事件同一读笔，
   * 快照同源自洽。缺省 = 计量事件未带该桶）。
   */
  readonly cacheRead?: number;
  /** 同上 cacheWrite 桶 */
  readonly cacheWrite?: number;
}

/** 压缩服务面（三入口——阈值触发 fire-and-forget / 溢出应急可等待 / 排空收口） */
export interface CompactionService {
  /**
   * 阈值触发面（05 §2.1 触发两段式段 1）：run 结算钩子里判阈（真 token 主判、
   * 投影字符数兜底），超过则排队压缩。异步执行与下一 turn 不竞速——本方法
   * 同步返回（fire-and-forget；失败面在内部收口不外抛）。
   */
  handleRunSettled(input: { log: SessionLog; usage?: RunUsageFact }): void;
  /**
   * 溢出应急面（05 §2.3——恒提供，agent 缺席同）：不等冷却、不等 onRunSettled；
   * 与阈值路共享全局串行队列（在飞互斥；排空语义=先排完已排队压缩再执行）。
   * 返回三值：compacted=已缩量（含排队期间他路已压——归因不问路）/
   * nothing=区间不足无可压 / failed=摘要通道失败（已落 end-failed 闭段）。
   */
  compactForOverflow(log: SessionLog): Promise<OverflowOutcome>;
  /** 排空收口面：等此刻前已入队/在飞的一切压缩完成（快照语义；进程收口用） */
  drain(): Promise<void>;
}
