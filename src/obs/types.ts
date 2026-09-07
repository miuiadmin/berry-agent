/**
 * obs — 契约面（03 §10.8 core:obs 件章；02 §4.1 席 #24）。
 *
 * 词面独立律：本件不 import persist 类型面重导出——三窄面（events/notify/
 * audience）以本件自有词面声明，结构兼容宿主真身（Store.queryEvents /
 * ctx.ui.notify / ctx.ui.hasAudience），装配批直传即可（compat 互证归
 * host 装配批）。obs deps = {contracts, persist}——persist 边只消费
 * openAuxDatabase 开库面，事件流经 ObsEventsFace 窄面注入。
 */
import type { SessionEvent } from '../contracts/index.js';

/* ---------------- 三窄面（装配注入缝） ---------------- */

/**
 * 事件流读面（结构兼容 Store.queryEvents——05 §3.4 原语的宿主面消费位；
 * 装配批直传 Store 实例）。obs 一切数据是 durable 事件流的派生物。
 */
export interface ObsEventsFace {
  /** 跨会话事件查询（过滤维 + 游标分页；签名与 Store.queryEvents 同构） */
  queryEvents(filter: {
    readonly sessionId?: string;
    readonly types?: readonly string[];
    readonly sinceMs?: number;
    readonly untilMs?: number;
    readonly fromSeq?: number;
    readonly toSeq?: number;
    readonly limit?: number;
    readonly cursor?: string | null;
  }): { readonly events: SessionEvent[]; readonly nextCursor: string | null };
}

/** 通知面（结构兼容 ctx.ui.notify——告警「只通知不执法」的唯一出口） */
export interface ObsNotifyFace {
  /** 一次性通知（level 三档子集——success 档与告警语义无关不收） */
  notify(message: string, opts?: { level?: 'info' | 'warn' | 'error' }): void;
}

/** 观众探针面（结构兼容 ctx.ui.hasAudience——无观众跳过评估且不耗冷却） */
export interface ObsAudienceFace {
  /** 本刻是否有观众（false = 告警评估整跳） */
  hasAudience(): boolean;
}

/* ---------------- 告警规则族 ---------------- */

/**
 * 告警规则（mount config 键 `alerts` 数组元素；v1 单规则）。
 * 执法禁律（03 §10.8）：告警路径只 notify——不 block、不 interrupt、
 * 不写 durable、不改任何闸门。
 */
export interface ObsAlertRule {
  /** 规则种（v1 单值——判别位，扩规则族不改消费面形状） */
  readonly kind: 'token_spend_hourly';
  /** 当前小时主计费桶（input+output；cache 桶不进阈值）超阈即告警 */
  readonly thresholdTokens: number;
  /** 冷却窗毫秒（缺省 1h——与规则小时粒度对齐；窗内抑制不重复通知） */
  readonly cooldownMs?: number;
}

/* ---------------- 查询面 ---------------- */

/** obs_query 输入（granularity 必填、其余可选过滤） */
export interface ObsQueryInput {
  /** 粒度：小时桶 / 日桶（闭日物化） */
  readonly granularity: 'hour' | 'day';
  /** 指标：事件计数（缺省）/ llm 用量聚合 */
  readonly metric?: 'events' | 'usage';
  /** 窗口下界（epoch ms 含；缺省无下界） */
  readonly from?: number;
  /** 窗口上界（epoch ms 含；缺省无上界） */
  readonly to?: number;
  /** 事件类型过滤（仅 metric='events' 有效） */
  readonly eventType?: string;
  /** 行上限（缺省 100、硬帽 1000） */
  readonly limit?: number;
}

/** 事件计数行（metric='events'） */
export interface ObsEventsRow {
  /** 桶起点（UTC 整点/整日对齐——epoch ms） */
  readonly bucket: number;
  /** durable 事件类型 */
  readonly eventType: string;
  /** 桶内事件数 */
  readonly count: number;
}

/**
 * 用量聚合行（metric='usage'；token 原始值聚合——货币折算在呈现投影做，
 * 本面不折算）。主计费桶 input+output 与 cache 桶分列（04 §5 预算闸门口径）。
 */
export interface ObsUsageRow {
  /** 桶起点（UTC 整点/整日对齐——epoch ms） */
  readonly bucket: number;
  /** llm/usage 事件数 */
  readonly calls: number;
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  /** cacheWrite 中 1h 保留子集（未上报聚合为 0） */
  readonly cacheWrite1h: number;
  /** 推理 token 子集（未上报聚合为 0；已含于 output） */
  readonly reasoning: number;
}

/** 查询结果行二态 */
export type ObsQueryRow = ObsEventsRow | ObsUsageRow;

/* ---------------- 服务面 ---------------- */

/** obs 服务句柄（装配批持；dispose 幂等） */
export interface ObsService {
  /**
   * 增量摄取 + 闭日物化 + 告警评估（单入口编舞——自驱 interval 与手动
   * 调用同路径）。脏桶整体重算幂等（03 §10.8：水位−1h 重叠窗）。
   */
  refresh(): void;
  /** 只读聚合查询（坏行 fail-loud = OBS_ROLLUP_CORRUPT） */
  query(input: ObsQueryInput): readonly ObsQueryRow[];
  /** 注销：停 interval + 关库；再调 refresh/query 拒（fail-loud） */
  dispose(): void;
}

/** createObsService 依赖注入面（全缝可注入——测试零真网络零真挂钟） */
export interface ObsServiceDeps {
  /** rollup 自管库文件路径（`<dataDir>/data/obs/rollup.db`——装配面算好） */
  readonly dbPath: string;
  /** 事件流读面（结构兼容 Store——装配批直传） */
  readonly events: ObsEventsFace;
  /** 通知面（装配批接 ctx.ui.notify） */
  readonly notify: ObsNotifyFace;
  /** 观众探针面（装配批接 ctx.ui.hasAudience） */
  readonly audience: ObsAudienceFace;
  /** 告警规则（缺省空 = 告警面在场而静默——诚实缺省） */
  readonly alerts?: readonly ObsAlertRule[];
  /** 自驱 interval 毫秒（缺省 60s；0 = 不自驱——测试手动驱动） */
  readonly refreshMs?: number;
  /** 时间注入（缺省 Date.now——测试假钟） */
  readonly clock?: () => number;
  /** 告警面（开库/WAL 降级等——缺省 console.error） */
  readonly warn?: (message: string) => void;
}
