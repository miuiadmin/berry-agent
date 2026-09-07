/**
 * obs 模块公开面（L4 观测面——02 §4.1 席 #24；机制真源 03 §10.8）。
 *
 * 本批落码（批 18b）：rollup 自管库（经 persist aux 面开库——主库零
 * schema 残迹、可禁用 = 文件不在场）+ 两粒度三表一视图 + 水位−1h 重叠窗
 * 幂等摄取 + 闭日物化 + 告警「只通知不执法」（hasAudience 前置不耗冷却）
 * + obs_query 只读工具。装载态集成（mount config alerts 注入 / 事件面
 * 直传 Store / notify·audience 接 ctx.ui / 工具注册）归批 12 装配面。
 */
import './codes.js';

export { createObsService } from './service.js';
export { createObsQueryTool } from './tool.js';
export { OBS_SCHEMA_VERSION } from './db.js';
export { aggregateHours, hourBucketMs, dayBucketMs, bucketClosed, HOUR_MS, DAY_MS } from './rollup.js';
export type {
  ObsEventsFace,
  ObsNotifyFace,
  ObsAudienceFace,
  ObsAlertRule,
  ObsQueryInput,
  ObsEventsRow,
  ObsUsageRow,
  ObsQueryRow,
  ObsService,
  ObsServiceDeps,
} from './types.js';
