/**
 * ObsService 测试——摄取/物化/告警/查询四线全真（真 sqlite 临时文件库；
 * 03 §10.8 条款逐条执法锚）。
 *
 * 锁八环——①首拍全量摄取 + 重扫幂等（DELETE+INSERT 替换语义）②水位−1h
 * 重叠窗（迟到事件自愈 + 扫描窗不回吃全史）③闭日物化只在闭日后（跨日
 * 无新事件也物化）④告警只通知不执法 + 冷却 + hasAudience 前置不耗冷却 +
 * notify 失败不烧冷却 + cache 桶不进阈值⑤查询过滤维（粒度/类型/窗口对齐/
 * limit）⑥坏行 OBS_ROLLUP_CORRUPT 拒误读⑦开库失败/已 dispose 拒用
 * OBS_DB_OPEN_FAILED⑧自驱 interval 挂钟 + deprecation_rollup_hour 视图。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BaseError, type SessionEvent } from '../contracts/index.js';
import { openAuxDatabase } from '../persist/index.js';
import { openRollupDatabase } from './db.js';
import { createObsService } from './service.js';
import type { ObsAlertRule, ObsEventsFace, ObsNotifyFace, ObsService } from './types.js';

/* ---------------- 桩件（全缝注入——零真网络零真挂钟） ---------------- */

/** 假事件流（内存数组 + 游标分页——sinceMs/untilMs/types 三维过滤） */
class FakeEvents implements ObsEventsFace {
  readonly rows: SessionEvent[] = [];
  /** 各次调用收到的 sinceMs（扫描窗断言面） */
  readonly seenSince: number[] = [];

  push(type: string, time: number, data?: unknown): void {
    this.rows.push({ type, seq: this.rows.length + 1, time, data: data ?? {} } as SessionEvent);
    this.rows.sort((a, b) => a.time - b.time);
  }

  queryEvents(filter: {
    sinceMs?: number;
    untilMs?: number;
    types?: readonly string[];
    limit?: number;
    cursor?: string | null;
  }): { events: SessionEvent[]; nextCursor: string | null } {
    this.seenSince.push(filter.sinceMs ?? 0);
    const filtered = this.rows.filter(
      (event) =>
        (filter.sinceMs === undefined || event.time >= filter.sinceMs) &&
        (filter.untilMs === undefined || event.time <= filter.untilMs) &&
        (filter.types === undefined || filter.types.includes(event.type)),
    );
    const limit = filter.limit ?? 1000;
    let offset = 0;
    if (filter.cursor !== null && filter.cursor !== undefined) {
      offset = JSON.parse(Buffer.from(filter.cursor, 'base64url').toString('utf8')).offset as number;
    }
    const page = filtered.slice(offset, offset + limit);
    const next =
      offset + limit < filtered.length
        ? Buffer.from(JSON.stringify({ offset: offset + limit }), 'utf8').toString('base64url')
        : null;
    return { events: page, nextCursor: next };
  }
}

/** 假通知面（记录调用；可编程抛错一发） */
class FakeNotify implements ObsNotifyFace {
  readonly calls: { message: string; level?: string }[] = [];
  throwNext = false;

  notify(message: string, opts?: { level?: 'info' | 'warn' | 'error' }): void {
    if (this.throwNext) {
      this.throwNext = false;
      throw new Error('notify 面炸了');
    }
    this.calls.push({ message, ...(opts?.level !== undefined ? { level: opts.level } : {}) });
  }
}

/**
 * 护栏耗尽形事件源（页护栏截断回归锁专用桩）：infiniteCursor = true 时
 * 游标恒非空（坏游标/超大窗形——服务侧 1000 页护栏耗尽）；false 时真分页
 * 尾页收 null。setRows 可编程改写（模拟「护栏外尾部事件」在回补拍现身）。
 */
class GuardExhaustingEvents implements ObsEventsFace {
  infiniteCursor = true;
  readonly seenSince: number[] = [];
  private rows: SessionEvent[] = [];

  setRows(rows: SessionEvent[]): void {
    this.rows = [...rows];
  }

  queryEvents(filter: {
    sinceMs?: number;
    untilMs?: number;
    types?: readonly string[];
    limit?: number;
    cursor?: string | null;
  }): { events: SessionEvent[]; nextCursor: string | null } {
    this.seenSince.push(filter.sinceMs ?? 0);
    const filtered = this.rows.filter(
      (event) =>
        (filter.sinceMs === undefined || event.time >= filter.sinceMs) &&
        (filter.untilMs === undefined || event.time <= filter.untilMs) &&
        (filter.types === undefined || filter.types.includes(event.type)),
    );
    const limit = filter.limit ?? 1000;
    let offset = 0;
    if (filter.cursor !== null && filter.cursor !== undefined) {
      offset = JSON.parse(Buffer.from(filter.cursor, 'base64url').toString('utf8')).offset as number;
    }
    const page = filtered.slice(offset, offset + limit);
    const more = offset + limit < filtered.length;
    // 无限游标形：即使无更多数据也谎报有后继（可解码真游标——空页恒续），
    // 服务侧页护栏耗尽形即「游标永不 null」
    const nextCursor =
      more || this.infiniteCursor
        ? Buffer.from(JSON.stringify({ offset: offset + limit }), 'utf8').toString('base64url')
        : null;
    return { events: page, nextCursor };
  }
}

/** 快捷事件构造（护栏耗尽桩的行构造面） */
function stubEvent(type: string, time: number): SessionEvent {
  return { type, seq: time, time, data: {} } as SessionEvent;
}

/** 直读 obs_meta 水位（第二连接——与坏行注毒测试同法；缺席 null） */
function readWatermark(root: string): number | null {
  const probe = openAuxDatabase(join(root, 'rollup.db'));
  const row = probe.prepare("SELECT value FROM obs_meta WHERE key = 'ingest_watermark_ms'").get() as
    { value: string } | undefined;
  probe.close();
  return row === undefined ? null : Number(row.value);
}

/* ---------------- 夹具 ---------------- */

let dir: string;
let events: FakeEvents;
let notify: FakeNotify;
let audienceFlag: boolean;
let nowMs: number;
const warn = vi.fn();

const H = 3_600_000;
const D = 86_400_000;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-obs-test-'));
  events = new FakeEvents();
  notify = new FakeNotify();
  audienceFlag = true;
  nowMs = Date.UTC(2026, 8, 7, 8, 30);
  warn.mockClear();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 服务构造（缺省零规则、零自驱——手动驱动 refresh） */
function make(overrides?: { alerts?: readonly ObsAlertRule[] }): ObsService {
  return createObsService({
    dbPath: join(dir, 'rollup.db'),
    events,
    notify,
    audience: { hasAudience: () => audienceFlag },
    ...(overrides?.alerts !== undefined ? { alerts: overrides.alerts } : {}),
    refreshMs: 0,
    clock: () => nowMs,
    warn,
  });
}

/** llm/usage 事件快捷构造（四桶必落形） */
function usage(
  time: number,
  buckets: { input: number; output: number; cacheRead?: number; cacheWrite?: number },
): void {
  events.push('llm/usage', time, {
    callId: `c-${events.rows.length}`,
    model: 'test/model',
    usage: {
      input: buckets.input,
      output: buckets.output,
      cacheRead: buckets.cacheRead ?? 0,
      cacheWrite: buckets.cacheWrite ?? 0,
    },
  });
}

describe('① 摄取：首拍全量 + 幂等替换', () => {
  it('全类型入小时计数、llm/usage 入用量聚合；重跑同拍零漂移', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    const hPrev = h0 - H;
    events.push('user/message', hPrev + 1000);
    events.push('user/message', h0 + 1000);
    events.push('user/message', h0 + 2000);
    usage(h0 + 3000, { input: 10, output: 5 });

    const service = make();
    service.refresh();
    let rows = service.query({ granularity: 'hour' });
    expect(rows).toEqual([
      { bucket: hPrev, eventType: 'user/message', count: 1 },
      { bucket: h0, eventType: 'llm/usage', count: 1 },
      { bucket: h0, eventType: 'user/message', count: 2 },
    ]);
    let usageRows = service.query({ granularity: 'hour', metric: 'usage' });
    expect(usageRows).toEqual([
      {
        bucket: h0,
        calls: 1,
        input: 10,
        output: 5,
        cacheRead: 0,
        cacheWrite: 0,
        cacheWrite1h: 0,
        reasoning: 0,
        hitRate: 0,
      },
    ]);

    // 同拍重跑（幂等——DELETE+INSERT 替换语义零重复）
    service.refresh();
    rows = service.query({ granularity: 'hour' });
    expect(rows).toHaveLength(3);
    usageRows = service.query({ granularity: 'hour', metric: 'usage' });
    expect(usageRows).toHaveLength(1);
    service.dispose();
  });

  it('水位−1h 重叠窗：迟到事件自愈（桶计数翻正）+ 窗不回吃全史', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    events.push('user/message', h0 + 1000);
    const service = make();
    nowMs = h0 + 30 * 60_000;
    service.refresh();
    expect(events.seenSince[0]).toBe(0); // 首拍全量

    // 迟到 20 分钟的事件落在已摄取桶内——重叠窗下一拍整桶重算自愈
    events.push('user/message', h0 + 5 * 60_000);
    nowMs = h0 + 50 * 60_000;
    service.refresh();
    const rows = service.query({ granularity: 'hour', eventType: 'user/message' });
    expect(rows).toEqual([{ bucket: h0, eventType: 'user/message', count: 2 }]);

    // 第二拍扫描窗 = hourFloor(水位 − 1h)——不回吃全史
    expect(events.seenSince[1]).toBe(h0 - H);
    service.dispose();
  });
});

describe('② 闭日物化：只在闭日后、跨日无新事件也物化', () => {
  it('当前日在飞不落 day 表；次日闭日后补物化', () => {
    const day4 = Date.UTC(2026, 8, 4);
    const day5 = Date.UTC(2026, 8, 5);
    events.push('user/message', day4 + 1000);
    events.push('user/message', day5 + 1000);

    const service = make();
    nowMs = Date.UTC(2026, 8, 5, 10); // Sep 4 已闭、Sep 5 在飞
    service.refresh();
    expect(service.query({ granularity: 'day' })).toEqual([{ bucket: day4, eventType: 'user/message', count: 1 }]);

    // 跨到次日：Sep 5 无新事件也闭日——水位跨日候选物化
    nowMs = Date.UTC(2026, 8, 6, 1);
    service.refresh();
    expect(service.query({ granularity: 'day' })).toEqual([
      { bucket: day4, eventType: 'user/message', count: 1 },
      { bucket: day5, eventType: 'user/message', count: 1 },
    ]);
    service.dispose();
  });

  it('日用量 = 小时桶求和（物化聚合正确性）', () => {
    const day3 = Date.UTC(2026, 8, 3);
    usage(day3 + 1000, { input: 10, output: 5 });
    usage(day3 + H + 1000, { input: 100, output: 50, cacheRead: 7 });
    const service = make();
    nowMs = day3 + D + 1000; // 次日——day3 已闭
    service.refresh();
    expect(service.query({ granularity: 'day', metric: 'usage' })).toEqual([
      {
        bucket: day3,
        calls: 2,
        input: 110,
        output: 55,
        cacheRead: 7,
        cacheWrite: 0,
        cacheWrite1h: 0,
        reasoning: 0,
        hitRate: 7 / 117,
      },
    ]);
    service.dispose();
  });

  it('hitRate 派生列（RP5）：桶内聚合比值 cacheRead/(input+cacheRead+cacheWrite)；分母零 null', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    usage(h0 + 1000, { input: 50, output: 5, cacheRead: 30, cacheWrite: 20 }); // 30/100
    usage(h0 + 2000, { input: 10, output: 5, cacheRead: 30, cacheWrite: 0 }); // 累计 60/140
    const h1 = h0 + H;
    usage(h1 + 1000, { input: 0, output: 0 }); // 桶内零 token 流——分母零
    const service = make();
    nowMs = h1 + 10 * 60_000;
    service.refresh();
    const rows = service.query({ granularity: 'hour', metric: 'usage' }) as unknown as Array<{
      bucket: number;
      hitRate: number | null;
    }>;
    // 桶内聚合比值（非均值）：h0 桶 = 60/(60+60+20)——两发合计 cacheRead 60、分母 140
    expect(rows.map((r) => [r.bucket, r.hitRate])).toEqual([
      [h0, 60 / 140],
      [h1, null], // 分母零守卫——诚实缺席非 0%
    ]);
    service.dispose();
  });
});

describe('③ 告警：只通知不执法 + 冷却 + 观众前置', () => {
  it('超阈 notify warn；冷却窗内抑制；窗过重发', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    usage(h0 + 1000, { input: 60, output: 50 }); // 主计费桶 110 > 100
    const service = make({ alerts: [{ kind: 'token_spend_hourly', thresholdTokens: 100, cooldownMs: 5 * 60_000 }] });
    nowMs = h0 + 10 * 60_000;
    service.refresh();
    expect(notify.calls).toHaveLength(1);
    expect(notify.calls[0]!.level).toBe('warn');
    expect(notify.calls[0]!.message).toContain('110');

    // 冷却窗内（+2min）重复超阈——抑制
    nowMs = h0 + 12 * 60_000;
    service.refresh();
    expect(notify.calls).toHaveLength(1);

    // 冷却窗过（+11min > 5min）且仍超阈——重发
    nowMs = h0 + 21 * 60_000;
    service.refresh();
    expect(notify.calls).toHaveLength(2);
    service.dispose();
  });

  it('hasAudience false：整跳且不耗冷却——观众回场同阈值即响', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    usage(h0 + 1000, { input: 60, output: 50 });
    const service = make({ alerts: [{ kind: 'token_spend_hourly', thresholdTokens: 100 }] }); // 冷却缺省 1h
    audienceFlag = false;
    nowMs = h0 + 10 * 60_000;
    service.refresh();
    expect(notify.calls).toHaveLength(0);

    // 观众回场（仍在缺省冷却窗内——若无头时误烧冷却则此处哑火）
    audienceFlag = true;
    nowMs = h0 + 15 * 60_000;
    service.refresh();
    expect(notify.calls).toHaveLength(1);
    service.dispose();
  });

  it('notify 失败不烧冷却——下一拍重试；cache 桶不进阈值', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    usage(h0 + 1000, { input: 10, output: 5, cacheRead: 100_000 }); // 主桶 15、cache 巨量
    const service = make({ alerts: [{ kind: 'token_spend_hourly', thresholdTokens: 100 }] });
    nowMs = h0 + 10 * 60_000;
    service.refresh();
    // cache 桶不进阈值：主桶 15 < 100 不告警
    expect(notify.calls).toHaveLength(0);

    // 拉过阈值 + notify 炸一发——不烧冷却
    usage(h0 + 20 * 60_000, { input: 100, output: 50 });
    notify.throwNext = true;
    nowMs = h0 + 25 * 60_000;
    service.refresh();
    expect(notify.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();

    // 下一拍（仍在 1h 冷却窗内）重试成功——证明失败未烧冷却
    nowMs = h0 + 30 * 60_000;
    service.refresh();
    expect(notify.calls).toHaveLength(1);
    service.dispose();
  });

  it('缺省空规则 = 告警面在场而静默（超阈零通知）', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    usage(h0 + 1000, { input: 1_000_000, output: 0 });
    const service = make();
    service.refresh();
    expect(notify.calls).toHaveLength(0);
    service.dispose();
  });
});

describe('④ 查询面：过滤维 + 拒误读', () => {
  it('eventType 过滤 / from·to 窗口桶对齐 / limit 帽 / 粒度路由', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    events.push('user/message', h0 + 1000);
    events.push('llm/usage', h0 + 2000);
    events.push('user/message', h0 + H + 1000);
    const service = make();
    nowMs = h0 + 2 * H;
    service.refresh();

    // eventType 过滤
    expect(service.query({ granularity: 'hour', eventType: 'user/message' })).toEqual([
      { bucket: h0, eventType: 'user/message', count: 1 },
      { bucket: h0 + H, eventType: 'user/message', count: 1 },
    ]);
    // from 落在桶中段——下取整对齐到桶边界（含该桶整桶：h0 桶内两型都进窗）
    expect(service.query({ granularity: 'hour', from: h0 + 1_800_000, to: h0 + H + 500 })).toEqual([
      { bucket: h0, eventType: 'llm/usage', count: 1 },
      { bucket: h0, eventType: 'user/message', count: 1 },
      { bucket: h0 + H, eventType: 'user/message', count: 1 },
    ]);
    // limit 帽
    expect(service.query({ granularity: 'hour', limit: 1 })).toHaveLength(1);
    // 大于硬帽的值截到帽不炸
    expect(Array.isArray(service.query({ granularity: 'hour', limit: 100_000 }))).toBe(true);
    service.dispose();
  });

  it('eventType 尾通配（u-4——03 §10.8 RP5）：<族前缀>/* 族计数一次可达 + 窗口正交 + LIKE 元字符按字面', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    events.push('compaction/start', h0 + 1000);
    events.push('compaction/end', h0 + 2000);
    events.push('compaction/fallback', h0 + 3000);
    events.push('user/message', h0 + 4000);
    // LIKE 元字符探针：前缀含 '_'——未转义则单字符通配会误中 plugAn/x
    events.push('plugAn/x', h0 + 5000);
    events.push('plug_n/y', h0 + 6000);
    events.push('compaction/start', h0 + H + 1000);
    const service = make();
    nowMs = h0 + 2 * H;
    service.refresh();

    // 族计数一次可达：compaction/* 全族四行（分型分桶），族外零收
    expect(service.query({ granularity: 'hour', eventType: 'compaction/*' })).toEqual([
      { bucket: h0, eventType: 'compaction/end', count: 1 },
      { bucket: h0, eventType: 'compaction/fallback', count: 1 },
      { bucket: h0, eventType: 'compaction/start', count: 1 },
      { bucket: h0 + H, eventType: 'compaction/start', count: 1 },
    ]);
    // 与窗口维正交组合：只取 h0+H 桶
    expect(service.query({ granularity: 'hour', from: h0 + H, to: h0 + H + 500, eventType: 'compaction/*' })).toEqual([
      { bucket: h0 + H, eventType: 'compaction/start', count: 1 },
    ]);
    // LIKE 元字符按字面：plug_n/* 只中 plug_n/y（'_' 转义——未转义必双中）
    expect(service.query({ granularity: 'hour', eventType: 'plug_n/*' })).toEqual([
      { bucket: h0, eventType: 'plug_n/y', count: 1 },
    ]);
    // day 粒度同路（table 变量切换——单码点覆盖两粒度的回归锚）：当日聚合
    // 未闭合不物化 events_day，但代码路径同分支——用次日闭合拍锁
    nowMs = h0 + 2 * D;
    service.refresh();
    expect(service.query({ granularity: 'day', eventType: 'compaction/*' })).toEqual([
      { bucket: Date.UTC(2026, 8, 7), eventType: 'compaction/end', count: 1 },
      { bucket: Date.UTC(2026, 8, 7), eventType: 'compaction/fallback', count: 1 },
      { bucket: Date.UTC(2026, 8, 7), eventType: 'compaction/start', count: 2 },
    ]);
    // 非约定 '*' 形兜底：服务侧精确匹配零行（诚实空——工具面 schema 段已
    // 前置拒，此为防御纵深注记的执法锚）
    expect(service.query({ granularity: 'hour', eventType: 'compaction/**' })).toEqual([]);
    service.dispose();
  });

  it('坏行 OBS_ROLLUP_CORRUPT 拒误读（第二连接注毒——派生物宁弃读）', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    events.push('user/message', h0 + 1000);
    const service = make();
    service.refresh();

    const poison = openAuxDatabase(join(dir, 'rollup.db'));
    poison.prepare("UPDATE events_hour SET count = 'x' WHERE bucket = ?").run(h0);
    poison.close();

    expect(() => service.query({ granularity: 'hour' })).toThrowError(BaseError);
    try {
      service.query({ granularity: 'hour' });
    } catch (err) {
      expect((err as BaseError).code).toBe('OBS_ROLLUP_CORRUPT');
    }
    service.dispose();
  });
});

describe('⑤ 生命周期与开库面', () => {
  it('开库失败 OBS_DB_OPEN_FAILED（路径是目录）+ cause 保全', () => {
    const dirAsPath = join(dir, 'as-dir');
    mkdirSync(dirAsPath);
    expect(() =>
      createObsService({
        dbPath: dirAsPath,
        events,
        notify,
        audience: { hasAudience: () => true },
        refreshMs: 0,
        clock: () => nowMs,
      }),
    ).toThrowError(BaseError);
    try {
      createObsService({
        dbPath: dirAsPath,
        events,
        notify,
        audience: { hasAudience: () => true },
        refreshMs: 0,
        clock: () => nowMs,
      });
    } catch (err) {
      expect((err as BaseError).code).toBe('OBS_DB_OPEN_FAILED');
    }
  });

  it('dispose 后 refresh/query 拒用；dispose 幂等', () => {
    const service = make();
    service.refresh();
    service.dispose();
    service.dispose(); // 幂等
    expect(() => service.refresh()).toThrowError(BaseError);
    expect(() => service.query({ granularity: 'hour' })).toThrowError(BaseError);
  });

  it('schema 版本高于本件拒开（旧程序开新库宁拒不误读）', () => {
    const dbPath = join(dir, 'future.db');
    const raw = openAuxDatabase(dbPath);
    raw.pragma('user_version = 999');
    raw.close();
    try {
      createObsService({
        dbPath,
        events,
        notify,
        audience: { hasAudience: () => true },
        refreshMs: 0,
        clock: () => nowMs,
      });
      expect.unreachable('应抛 OBS_DB_OPEN_FAILED');
    } catch (err) {
      expect((err as BaseError).code).toBe('OBS_DB_OPEN_FAILED');
      expect((err as BaseError).message).toContain('999');
    }
  });
});

describe('⑥ 视图与自驱挂钟', () => {
  it('deprecation_rollup_hour 视图 = events_hour 单型投影（03 §2 命名兑现）', () => {
    const dbPath = join(dir, 'view.db');
    const db = openRollupDatabase(dbPath);
    db.prepare('INSERT INTO events_hour (bucket, event_type, count) VALUES (?, ?, ?)').run(
      100,
      'plugin/deprecation-used',
      7,
    );
    db.prepare('INSERT INTO events_hour (bucket, event_type, count) VALUES (?, ?, ?)').run(100, 'user/message', 3);
    const rows = db.prepare('SELECT bucket, count FROM deprecation_rollup_hour').all();
    expect(rows).toEqual([{ bucket: 100, count: 7 }]);
    db.close();
  });

  it('自驱 interval 挂钟驱动 refresh（真定时器短窗）', async () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    usage(h0 + 1000, { input: 60, output: 50 });
    const service = createObsService({
      dbPath: join(dir, 'rollup.db'),
      events,
      notify,
      audience: { hasAudience: () => true },
      alerts: [{ kind: 'token_spend_hourly', thresholdTokens: 100 }],
      refreshMs: 10,
      clock: () => nowMs,
      warn,
    });
    // 真定时器驱动（间隔 10ms）——首拍即摄取+告警
    await vi.waitFor(
      () => {
        expect(notify.calls.length).toBeGreaterThanOrEqual(1);
      },
      { timeout: 2_000 },
    );
    service.dispose();
  });
});

describe('⑦ 页护栏截断：fail-loud 报备 + 断点续扫', () => {
  /** 服务构造（护栏耗尽桩直注——手动驱动 refresh） */
  function makeWithSource(source: GuardExhaustingEvents): ObsService {
    return createObsService({
      dbPath: join(dir, 'rollup.db'),
      events: source,
      notify,
      audience: { hasAudience: () => false },
      refreshMs: 0,
      clock: () => nowMs,
      warn,
    });
  }

  it('护栏耗尽不静默：warn 报备截断 + 水位只推进到已扫尾部断点（不直推 now 定谳部分计数）', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    const source = new GuardExhaustingEvents();
    source.setRows([
      stubEvent('user/message', h0 + 1000),
      stubEvent('user/message', h0 + 2000),
      stubEvent('user/message', h0 + 3000),
    ]);
    nowMs = h0 + 2 * H; // 断点（h0 桶内）与 now（h0+2h 桶）异桶——续扫窗可区分
    const service = makeWithSource(source);
    service.refresh();

    // 修前红①：静默退出零 warn——截断不可见（修前此处即失败）
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('截断'));
    // 修前红②：水位直推 now（h0+2H）把部分计数当完整真值定谳——修后只
    // 推进到已扫尾部断点（末条已扫事件 time；事件流按 time 序分页）
    expect(readWatermark(dir)).toBe(h0 + 3000);
    service.dispose();
  });

  it('断点续扫：下一拍自断点−1h 重开窗——护栏外尾部事件回补入桶 + 水位恢复推进', () => {
    const h0 = Date.UTC(2026, 8, 7, 8);
    const source = new GuardExhaustingEvents();
    source.setRows([
      stubEvent('user/message', h0 + 1000),
      stubEvent('user/message', h0 + 2000),
      stubEvent('user/message', h0 + 3000),
    ]);
    nowMs = h0 + 2 * H;
    const service = makeWithSource(source);
    service.refresh(); // 截断拍：1000 页护栏耗尽（水位 = 断点 h0+3000、warn ×1）

    // 回补拍：游标转真（尾页收 null）+「护栏外尾部」两条现身（截断拍游标未达）
    source.infiniteCursor = false;
    source.setRows([
      stubEvent('user/message', h0 + 1000),
      stubEvent('user/message', h0 + 2000),
      stubEvent('user/message', h0 + 3000),
      stubEvent('user/message', h0 + 4000),
      stubEvent('user/message', h0 + 5000),
    ]);
    nowMs = h0 + 2 * H + 60_000;
    service.refresh();

    // 下一拍扫描窗自 hourFloor(断点−1h) = h0−H 起（截断拍恰 1000 页调用，
    // 末拍首查即 seenSince[1000]）——修前水位 = 旧 now（h0+2H）→ 窗自
    // h0+H 起、护栏外尾部桶在窗外永不回补
    expect(source.seenSince[1000]).toBe(h0 - H);
    // 断点桶整窗重算回补：护栏外尾部两条入桶（修前 = 截断拍部分计数 3 定谳）
    expect(service.query({ granularity: 'hour', eventType: 'user/message' })).toEqual([
      { bucket: h0, eventType: 'user/message', count: 5 },
    ]);
    // 水位恢复推进到本拍 now（截断只是该拍的降级，不永久卡死推进）
    expect(readWatermark(dir)).toBe(h0 + 2 * H + 60_000);
    // 回补拍无截断——不再追加截断 warn
    const truncationWarns = warn.mock.calls.filter(
      ([message]) => typeof message === 'string' && message.includes('截断'),
    );
    expect(truncationWarns).toHaveLength(1);
    service.dispose();
  });
});
