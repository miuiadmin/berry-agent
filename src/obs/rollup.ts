/**
 * obs — rollup 纯数学件（03 §10.8 增量摄取条款的算法面——零 IO、全纯函数）。
 *
 * 桶对齐律：存储恒 UTC——小时桶 = epoch ms 下取整到 3_600_000 倍数、日桶
 * = 下取整到 86_400_000 倍数（时区换算归呈现层，与两维分立同精神）。
 */
import type { SessionEvent } from '../contracts/index.js';

/** 小时毫秒 */
export const HOUR_MS = 3_600_000;
/** 日毫秒 */
export const DAY_MS = 86_400_000;

/** 取事件时刻所在 UTC 小时桶起点 */
export function hourBucketMs(timeMs: number): number {
  return Math.floor(timeMs / HOUR_MS) * HOUR_MS;
}

/** 取事件时刻所在 UTC 日桶起点 */
export function dayBucketMs(timeMs: number): number {
  return Math.floor(timeMs / DAY_MS) * DAY_MS;
}

/** 桶是否已闭合（桶终点 <= now——日物化只做闭日） */
export function bucketClosed(bucketMs: number, nowMs: number, spanMs: number): boolean {
  return bucketMs + spanMs <= nowMs;
}

/** 事件小时计数聚合形（桶 → 类型 → 计数） */
export type HourCounts = Map<number, Map<string, number>>;

/** llm/usage 小时用量聚合形（桶 → 七列累计） */
export interface HourUsage {
  calls: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
  reasoning: number;
}

/** 事件用量双聚合结果（单遍扫描产出——脏桶重算的载荷面） */
export interface HourAggregation {
  readonly counts: HourCounts;
  readonly usage: Map<number, HourUsage>;
  /** 命中桶全集（含只有 usage 或只有 count 的桶——DELETE 范围判据） */
  readonly touchedBuckets: Set<number>;
}

/** llm/usage 事件载荷 usage 桶字段（宽收防御——坏形按缺席折 0 不误读） */
function usageNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * 单遍聚合事件流 → 小时桶计数 + llm/usage 用量累计（全 durable 事件类型
 * 入计数；用量只认 llm/usage 型）。扫描窗按小时边界对齐时本函数产物即
 * 各桶的完整真值——脏桶 DELETE+INSERT 整体替换即幂等自愈。
 */
export function aggregateHours(events: readonly SessionEvent[]): HourAggregation {
  const counts: HourCounts = new Map();
  const usage = new Map<number, HourUsage>();
  const touchedBuckets = new Set<number>();

  for (const event of events) {
    const bucket = hourBucketMs(event.time);
    touchedBuckets.add(bucket);

    // 计数面：全类型（事件类型缺字坏行按 '(unknown)' 归一——计数不丢行）
    const eventType = typeof event.type === 'string' && event.type !== '' ? event.type : '(unknown)';
    let byType = counts.get(bucket);
    if (!byType) {
      byType = new Map();
      counts.set(bucket, byType);
    }
    byType.set(eventType, (byType.get(eventType) ?? 0) + 1);

    // 用量面：只认 llm/usage（05 §1.1 载荷形——usage 四桶必落、两可选上报才落）
    if (eventType === 'llm/usage') {
      const data = event.data as { usage?: Record<string, unknown> } | null | undefined;
      const buckets = data && typeof data === 'object' ? data.usage : undefined;
      const raw = buckets && typeof buckets === 'object' ? buckets : {};
      let agg = usage.get(bucket);
      if (!agg) {
        agg = { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0, reasoning: 0 };
        usage.set(bucket, agg);
      }
      agg.calls += 1;
      agg.input += usageNumber(raw.input);
      agg.output += usageNumber(raw.output);
      agg.cacheRead += usageNumber(raw.cacheRead);
      agg.cacheWrite += usageNumber(raw.cacheWrite);
      agg.cacheWrite1h += usageNumber(raw.cacheWrite1h);
      agg.reasoning += usageNumber(raw.reasoning);
    }
  }

  return { counts, usage, touchedBuckets };
}
