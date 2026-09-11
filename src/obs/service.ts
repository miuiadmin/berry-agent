/**
 * obs — 服务面（03 §10.8 增量摄取/告警条款的编舞位）。
 *
 * refresh() 单入口三段：①增量摄取（水位−1h 重叠窗扫事件流 → 脏桶整窗重查
 * 重算替换——幂等自愈）②闭日物化（日桶只在日闭合后从小时桶聚合落账，
 * 重算幂等）③告警评估（只通知不执法 + hasAudience 前置不耗冷却）。
 * 已知边界（如实注记，不虚构保证）：时钟回拨超 1h 重叠窗的旧事件不回补
 * ——单写者 append-only 事件流的 time 单调性使其实际不发生。
 *
 * 聚合呈现两维分立（07 §4.2）：本件数据面只有会话客观态聚合；用户已读
 * 游标不入观测库（住通道侧本地状态）。
 */
import { BaseError, type SessionEvent } from '../contracts/index.js';
import type { SqliteDatabase } from '../persist/index.js';
import { openRollupDatabase } from './db.js';
import { aggregateHours, bucketClosed, DAY_MS, dayBucketMs, HOUR_MS, hourBucketMs } from './rollup.js';
import type {
  ObsAlertRule,
  ObsEventsRow,
  ObsQueryInput,
  ObsQueryRow,
  ObsService,
  ObsServiceDeps,
  ObsUsageRow,
} from './types.js';

/** 摄取水位 obs_meta 键（上次扫描推进到的 now 毫秒） */
const META_WATERMARK = 'ingest_watermark_ms';

/** 重叠窗（迟到事件/时钟回拨自愈面——1 小时） */
const OVERLAP_MS = HOUR_MS;

/** 告警冷却缺省（规则小时粒度——冷却缺省与粒度对齐） */
const DEFAULT_COOLDOWN_MS = HOUR_MS;

/** 扫描页参数（与 Store.queryEvents 硬帽一致；页数护栏防坏游标死循环） */
const SCAN_PAGE_LIMIT = 10_000;
const SCAN_PAGE_GUARD = 1_000;

/** 查询行帽（缺省 100、硬帽 1000——模型消费面） */
const QUERY_LIMIT_DEFAULT = 100;
const QUERY_LIMIT_MAX = 1_000;

/** createObsService 工厂（装载面/测试唯一入口） */
export function createObsService(deps: ObsServiceDeps): ObsService {
  return new ObsServiceImpl(deps);
}

/** 服务实现（类私有——外界只经 ObsService 面） */
class ObsServiceImpl implements ObsService {
  private readonly db: SqliteDatabase;
  private readonly events: ObsServiceDeps['events'];
  private readonly notify: ObsServiceDeps['notify'];
  private readonly audience: ObsServiceDeps['audience'];
  private readonly alerts: readonly ObsAlertRule[];
  private readonly clock: () => number;
  private readonly warn: (message: string) => void;
  private readonly timer: ReturnType<typeof setInterval> | undefined;
  private disposed = false;

  constructor(deps: ObsServiceDeps) {
    // 开库即抛 OBS_DB_OPEN_FAILED（fail-loud——装载面降级跳件消费）
    this.db = openRollupDatabase(deps.dbPath, deps.warn);
    this.events = deps.events;
    this.notify = deps.notify;
    this.audience = deps.audience;
    this.alerts = deps.alerts ?? [];
    this.clock = deps.clock ?? (() => Date.now());
    this.warn = deps.warn ?? ((message) => console.error(message));

    const refreshMs = deps.refreshMs ?? 60_000;
    if (refreshMs > 0) {
      // 自驱挂钟（obs deps 无 scheduler 边——件内自持合法；dispose 注销。
      // 定时腿异常不炸进程：吞进 warn，下一拍重试）
      this.timer = setInterval(() => {
        try {
          this.refresh();
        } catch (err) {
          this.warn(`[obs] 自驱 refresh 失败（下一拍重试）：${err instanceof Error ? err.message : String(err)}`);
        }
      }, refreshMs);
      // unref：观测挂钟不锚进程生命周期（诊断形装载本件后进程可自然退
      // ——dump-config/plugins-list :memory: 同构纪律；长驻形不受影响，
      // 收口恒走 dispose 注销）
      (this.timer as unknown as { unref?: () => void }).unref?.();
    }
  }

  refresh(): void {
    this.ensureOpen();
    const now = this.clock();
    const prevWatermark = this.readMetaNumber(META_WATERMARK) ?? 0;

    // ① 增量摄取：水位−1h 重叠窗、窗起点下取整到小时边界——窗内每桶被
    // 完整重扫，产物即各桶完整真值（当前桶覆盖到 now 为止，恰为「事件
    // 至此」的正确计数；迟到在 1h 窗内的旧桶下一拍整窗重算自愈）
    const scanSince = hourBucketMs(Math.max(0, prevWatermark - OVERLAP_MS));
    const aggregation = this.scanEvents(scanSince, now);

    // ②③ 同事务落账（摄取替换 + 闭日物化 + 水位推进——单事务幂等）
    const write = this.db.transaction(() => {
      this.replaceHourBuckets(aggregation);
      this.materializeClosedDays(aggregation.touchedBuckets, prevWatermark, now);
      // 水位只进不退（时钟回拨不回吃扫描窗——下拍以旧水位+重叠窗续扫）
      this.setMeta(META_WATERMARK, String(Math.max(prevWatermark, now)));
    });
    write();

    // 告警评估挂 refresh 尾（03 §10.8——只通知不执法）
    this.evaluateAlerts(now);
  }

  query(input: ObsQueryInput): readonly ObsQueryRow[] {
    this.ensureOpen();
    const granularity = input.granularity === 'day' ? 'day' : 'hour';
    const metric = input.metric === 'usage' ? 'usage' : 'events';
    const limit = Math.min(Math.max(1, input.limit ?? QUERY_LIMIT_DEFAULT), QUERY_LIMIT_MAX);

    // 窗口对齐到桶边界（from/to 都是「含」语义）
    const span = granularity === 'day' ? DAY_MS : HOUR_MS;
    const from = input.from !== undefined ? Math.floor(input.from / span) * span : undefined;
    const to = input.to !== undefined ? Math.floor(input.to / span) * span : undefined;

    if (metric === 'usage') {
      const table = granularity === 'day' ? 'usage_day' : 'usage_hour';
      const clauses: string[] = [];
      const params: unknown[] = [];
      if (from !== undefined) {
        clauses.push('bucket >= ?');
        params.push(from);
      }
      if (to !== undefined) {
        clauses.push('bucket <= ?');
        params.push(to);
      }
      params.push(limit);
      const rows = this.db
        .prepare(
          `SELECT bucket, calls, input, output, cache_read, cache_write, cache_write_1h, reasoning
           FROM ${table}${clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''}
           ORDER BY bucket ASC LIMIT ?`,
        )
        .all(...params) as unknown[];
      return rows.map((row) => this.toUsageRow(row, table));
    }

    const table = granularity === 'day' ? 'events_day' : 'events_hour';
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (from !== undefined) {
      clauses.push('bucket >= ?');
      params.push(from);
    }
    if (to !== undefined) {
      clauses.push('bucket <= ?');
      params.push(to);
    }
    if (input.eventType !== undefined) {
      clauses.push('event_type = ?');
      params.push(input.eventType);
    }
    params.push(limit);
    const rows = this.db
      .prepare(
        `SELECT bucket, event_type, count FROM ${table}${
          clauses.length > 0 ? ` WHERE ${clauses.join(' AND ')}` : ''
        } ORDER BY bucket ASC, event_type ASC LIMIT ?`,
      )
      .all(...params) as unknown[];
    return rows.map((row) => this.toEventsRow(row, table));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    this.db.close();
  }

  /* ---------------- 私有腿 ---------------- */

  /** dispose 后拒用（fail-loud——归 OBS_DB_OPEN_FAILED 族：库已闭） */
  private ensureOpen(): void {
    if (this.disposed) {
      throw new BaseError('OBS_DB_OPEN_FAILED', 'obs 服务已 dispose——refresh/query 拒用');
    }
  }

  /** 页游标遍历事件流（untilMs 含 now——不吞 now 时刻事件） */
  private scanEvents(scanSince: number, now: number): ReturnType<typeof aggregateHours> {
    const collected: SessionEvent[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < SCAN_PAGE_GUARD; page++) {
      const result = this.events.queryEvents({
        sinceMs: scanSince,
        untilMs: now,
        limit: SCAN_PAGE_LIMIT,
        ...(cursor !== null ? { cursor } : {}),
      });
      collected.push(...result.events);
      if (result.nextCursor === null) break;
      cursor = result.nextCursor;
    }
    return aggregateHours(collected);
  }

  /** 脏桶整体替换（DELETE+INSERT——幂等自愈的执法位） */
  private replaceHourBuckets(aggregation: ReturnType<typeof aggregateHours>): void {
    const delEvents = this.db.prepare('DELETE FROM events_hour WHERE bucket = ?');
    const delUsage = this.db.prepare('DELETE FROM usage_hour WHERE bucket = ?');
    const insEvents = this.db.prepare('INSERT INTO events_hour (bucket, event_type, count) VALUES (?, ?, ?)');
    const insUsage = this.db.prepare(
      'INSERT INTO usage_hour (bucket, calls, input, output, cache_read, cache_write, cache_write_1h, reasoning) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    for (const bucket of aggregation.touchedBuckets) {
      delEvents.run(bucket);
      delUsage.run(bucket);
      const byType = aggregation.counts.get(bucket);
      if (byType) {
        for (const [eventType, count] of byType) insEvents.run(bucket, eventType, count);
      }
      const usage = aggregation.usage.get(bucket);
      if (usage) {
        insUsage.run(
          bucket,
          usage.calls,
          usage.input,
          usage.output,
          usage.cacheRead,
          usage.cacheWrite,
          usage.cacheWrite1h,
          usage.reasoning,
        );
      }
    }
  }

  /**
   * 闭日物化：候选 = 本拍触达桶的日 + 水位以来跨过的日（末拍后闭日的桶
   * 无新事件也要物化）。只做闭日（bucketClosed——当前日在飞不落），从
   * 小时桶表聚合重算（DELETE+INSERT 幂等）。
   */
  private materializeClosedDays(touchedHourBuckets: Set<number>, prevWatermark: number, now: number): void {
    const candidates = new Set<number>();
    for (const bucket of touchedHourBuckets) candidates.add(dayBucketMs(bucket));
    if (prevWatermark > 0) {
      // 水位以来跨过的日（首拍 prevWatermark=0 不走全史迭代——触达桶的日
      // 已覆盖有数据的日）
      for (let day = dayBucketMs(prevWatermark); day <= dayBucketMs(now); day += DAY_MS) {
        candidates.add(day);
      }
    }

    const delEvents = this.db.prepare('DELETE FROM events_day WHERE bucket = ?');
    const delUsage = this.db.prepare('DELETE FROM usage_day WHERE bucket = ?');
    const insEvents = this.db.prepare('INSERT INTO events_day (bucket, event_type, count) VALUES (?, ?, ?)');
    const selEvents = this.db.prepare(
      'SELECT event_type, SUM(count) AS count FROM events_hour WHERE bucket >= ? AND bucket < ? GROUP BY event_type',
    );
    const insUsage = this.db.prepare(
      'INSERT INTO usage_day (bucket, calls, input, output, cache_read, cache_write, cache_write_1h, reasoning) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    );
    const selUsage = this.db.prepare(
      `SELECT SUM(calls) AS calls, SUM(input) AS input, SUM(output) AS output, SUM(cache_read) AS cache_read,
              SUM(cache_write) AS cache_write, SUM(cache_write_1h) AS cache_write_1h, SUM(reasoning) AS reasoning
       FROM usage_hour WHERE bucket >= ? AND bucket < ?`,
    );

    for (const day of candidates) {
      if (!bucketClosed(day, now, DAY_MS)) continue;
      delEvents.run(day);
      delUsage.run(day);
      for (const row of selEvents.all(day, day + DAY_MS) as unknown[]) {
        const typed = row as { event_type: unknown; count: unknown };
        const eventType = typeof typed.event_type === 'string' ? typed.event_type : '(unknown)';
        const count = typeof typed.count === 'number' && Number.isFinite(typed.count) ? typed.count : 0;
        insEvents.run(day, eventType, count);
      }
      const usage = selUsage.get(day, day + DAY_MS) as
        | {
            calls: unknown;
            input: unknown;
            output: unknown;
            cache_read: unknown;
            cache_write: unknown;
            cache_write_1h: unknown;
            reasoning: unknown;
          }
        | undefined;
      // 全天零行时 SUM 全 NULL——不落 usage_day 行（无调用日无行）
      if (usage && typeof usage.calls === 'number') {
        const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
        insUsage.run(
          day,
          usage.calls,
          num(usage.input),
          num(usage.output),
          num(usage.cache_read),
          num(usage.cache_write),
          num(usage.cache_write_1h),
          num(usage.reasoning),
        );
      }
    }
  }

  /** 告警评估（refresh 尾；hasAudience 前置——无观众整跳且不耗冷却） */
  private evaluateAlerts(now: number): void {
    if (this.alerts.length === 0) return;
    // 观众探针前置（03 §10.8）：false 时跳过整次评估——冷却不烧、观众回场
    // 仍可响（07 §4.3 无头不耗告警冷却原句语义）
    if (!this.audience.hasAudience()) return;

    const bucket = hourBucketMs(now);
    const row = this.db.prepare('SELECT input, output FROM usage_hour WHERE bucket = ?').get(bucket) as
      { input: unknown; output: unknown } | undefined;
    const mainBillable =
      row && typeof row.input === 'number' && typeof row.output === 'number' ? row.input + row.output : 0;

    this.alerts.forEach((rule, index) => {
      // v1 单规则种：未知种跳过 + warn（配置校验主责在装载面——此处防御
      // 不炸宿主）；坏阈值（非正数）同理跳过
      if (rule.kind !== 'token_spend_hourly') {
        this.warn(`[obs] 跳过未知告警规则种：${String(rule.kind)}（规则 #${index}）`);
        return;
      }
      if (!(rule.thresholdTokens > 0)) {
        this.warn(`[obs] 跳过坏阈值告警规则（thresholdTokens=${String(rule.thresholdTokens)}，规则 #${index}）`);
        return;
      }
      if (mainBillable < rule.thresholdTokens) return;

      // 冷却判定（per-规则 lastFiredAt；notify 失败不烧冷却——下一拍重试）
      const cooldownMs = rule.cooldownMs ?? DEFAULT_COOLDOWN_MS;
      const key = `alert:${index}:lastFiredAt`;
      const lastFiredAt = this.readMetaNumber(key) ?? 0;
      if (now - lastFiredAt < cooldownMs) return;

      try {
        // ObsNotifyFace 面（词面独立——notify(message, opts) 单方法）
        this.notify.notify(
          `[obs] 当前小时 token 花销 ${mainBillable} 已超阈值 ${rule.thresholdTokens}（主计费桶 input+output；cache 桶不计）`,
          { level: 'warn' },
        );
      } catch (err) {
        this.warn(`[obs] 告警通知失败（不烧冷却，下一拍重试）：${err instanceof Error ? err.message : String(err)}`);
        return;
      }
      this.setMeta(key, String(now));
    });
  }

  /** obs_meta 读（字符串值；缺席 null） */
  private readMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM obs_meta WHERE key = ?').get(key) as { value: unknown } | undefined;
    return row && typeof row.value === 'string' ? row.value : null;
  }

  /** obs_meta 数值读（坏值折 null——水位/冷却只信合法数） */
  private readMetaNumber(key: string): number | null {
    const raw = this.readMeta(key);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  /** obs_meta 写（upsert） */
  private setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO obs_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  /** 事件行拒误读校验（坏行 = OBS_ROLLUP_CORRUPT——派生物宁弃读不误读） */
  private toEventsRow(row: unknown, table: string): ObsEventsRow {
    const typed = row as { bucket: unknown; event_type: unknown; count: unknown };
    if (
      typeof typed.bucket !== 'number' ||
      !Number.isInteger(typed.bucket) ||
      typed.bucket < 0 ||
      typeof typed.event_type !== 'string' ||
      typeof typed.count !== 'number' ||
      !Number.isFinite(typed.count) ||
      typed.count < 0
    ) {
      throw new BaseError('OBS_ROLLUP_CORRUPT', `${table} 命中坏行（拒误读——重算即修复）：${JSON.stringify(row)}`);
    }
    return { bucket: typed.bucket, eventType: typed.event_type, count: typed.count };
  }

  /** 用量行拒误读校验（同上律——七列全数且非负） */
  private toUsageRow(row: unknown, table: string): ObsUsageRow {
    const typed = row as Record<string, unknown>;
    const fields = ['bucket', 'calls', 'input', 'output', 'cache_read', 'cache_write', 'cache_write_1h', 'reasoning'];
    for (const field of fields) {
      const value = typed[field];
      if (
        typeof value !== 'number' ||
        !Number.isFinite(value) ||
        value < 0 ||
        (field === 'bucket' && !Number.isInteger(value))
      ) {
        throw new BaseError('OBS_ROLLUP_CORRUPT', `${table} 命中坏行（拒误读——重算即修复）：${JSON.stringify(row)}`);
      }
    }
    return {
      bucket: typed.bucket as number,
      calls: typed.calls as number,
      input: typed.input as number,
      output: typed.output as number,
      cacheRead: typed.cache_read as number,
      cacheWrite: typed.cache_write as number,
      cacheWrite1h: typed.cache_write_1h as number,
      reasoning: typed.reasoning as number,
      // 命中率派生列（RP5——查询期派生零 rollup 列）：桶内聚合比值；分母零
      // = 无 token 流 → null（诚实缺席非 0%）
      hitRate: (() => {
        const input = typed.input as number;
        const cacheRead = typed.cache_read as number;
        const cacheWrite = typed.cache_write as number;
        const denominator = input + cacheRead + cacheWrite;
        return denominator > 0 ? cacheRead / denominator : null;
      })(),
    };
  }
}
