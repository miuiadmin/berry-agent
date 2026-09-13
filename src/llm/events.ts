/**
 * llm — llm/usage 事件载荷类型（05 篇 §1.1 表；owner=llm——核心词汇已列
 * contracts/events.ts 核心表，本文件只补载荷形状）。
 *
 * 写入者两路（05 §1.1 表注——2026-09-13 复盘修复批 #41 覆盖面扩形）：①
 * complete 单发路 onUsage 回调（生产 v1 未接线——有意边界，04 §5 同笔注）；
 * ②主对话 run 路桥接 = 组合根 settled 订阅窗扫 assistant/message 逐条转抄
 * （真源仍是 assistant 落账位，桥接投影零改写）。底账 = 本事件跨会话时间窗
 * 聚合投影（canAfford 数据源，04 §5：余额不存、查询推导）。
 */
import type { Usage, UsageBuckets } from '../contracts/index.js';

/** llm/usage 事件 data 形状（05 §1.1 表：callId/model/usage/priority?/elapsedMs?） */
export interface LlmUsageEventData {
  /**
   * settlement 幂等身份（write-behind 批落重试去重的锚点）：
   * complete 路每次调用唯一生成（随机 UUID）；委派结算折叠路 'delegation:'+
   * jobId 为预留形（v1 零生产者零消费者——子代理用量走 run 路桥接已覆盖归账；
   * 消费位出生随委派结算单发化另题——04 §5 结算折叠与 mq 立题档 3-A 同源）；run 路桥接 =
   * 'run:<sessionId>:<seq>'（窗内 assistant 落账 seq 天然唯一——同会话跨
   * run 不撞，与 run CLI 旧桥接方案同形平移）。
   */
  callId: string;
  /** 模型标识（实录优先——响应自带 provider+model 拼全形；请求标识兜底） */
  model: string;
  /** token 四桶（input/output/cacheRead/cacheWrite 必落；cacheWrite1h/reasoning 上报才落——totalTokens/cost 不入账） */
  usage: UsageBuckets;
  /** 预算道（聚合只计 background——前台花销照入账但不进闸门） */
  priority?: 'background' | 'foreground';
  /** 墙钟耗时毫秒（complete 路 = 全调用耗时含重试；缺席不计） */
  elapsedMs?: number;
}

/**
 * Usage → 计量桶单源映射（05 §1.1——四桶必落、cacheWrite1h/reasoning 上报
 * 才落、totalTokens/cost 不入账）。run 路桥接与 complete 路 onUsage 共用
 * （run-entry/scheduler-tick 旧扫退役后本函数是唯一映射位）。
 */
export function usageBucketsOf(usage: Usage): UsageBuckets {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    ...(usage.cacheWrite1h !== undefined ? { cacheWrite1h: usage.cacheWrite1h } : {}),
    ...(usage.reasoning !== undefined ? { reasoning: usage.reasoning } : {}),
  };
}
