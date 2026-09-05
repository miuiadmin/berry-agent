/**
 * llm — llm/usage 事件载荷类型（05 篇 §1.1 表；owner=llm——核心词汇已列
 * contracts/events.ts 核心表，本文件只补载荷形状）。
 *
 * 写入者 = host 装配根计量服务：complete 的 onUsage 回调在此接线进 session
 * 写入面（append 异常不静默——warn 落日志带 callId/model，丢账可观测、不拖垮
 * 补全结果）。底账 = 本事件跨会话时间窗聚合投影（canAfford 数据源，04 §5：
 * 余额不存、查询推导）。
 */
import type { UsageBuckets } from '../contracts/index.js';

/** llm/usage 事件 data 形状（05 §1.1 表：callId/model/usage/priority?/elapsedMs?） */
export interface LlmUsageEventData {
  /**
   * settlement 幂等身份（write-behind 批落重试去重的锚点）：
   * complete 路每次调用唯一生成（随机 UUID）；委派结算折叠路 = 'delegation:'
   * + jobId（04 §5 结算折叠——子代理用量归账不重复计）。
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
