/**
 * memory 引用回写件测试（批 18c-7——06 §6 效用闭环）：
 * parseCitations（同消息去重/首现序/lastIndex 复位）+ 消费件全档
 * （text 块提取 thinking 不取/前缀归责三态/markUsed 四写一体语义/
 * TTL 续期/expired 整行跳过/dismissed 照计/尽力而为不炸事件通道）+
 * dao 两法直测（resolveShortId 三态、markUsed 批量实记数）。
 *
 * 真库全环（openStore + MEMORY_MIGRATIONS）；LLM 零参与（纯消费面）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { MEMORY_DAY_MS } from './types.js';
import { createMemoryDao, type MemoryDao } from './dao.js';
import { MEMORY_MIGRATIONS } from './migration.js';
import { shortIdOf } from './inject.js';
import { createCiteRecorder, parseCitations } from './cite.js';

let dir: string;
let store: Store | null = null;
let nowMs: number;
let idSeq = 0;
let dbSeq = 0;
const warns: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-memory-cite-'));
  nowMs = Date.parse('2026-09-08T08:00:00.000Z');
  idSeq = 0;
  dbSeq = 0;
  warns.length = 0;
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 真库装配（id = uuid v7 拼形递增——前缀互异，归责恰一态的干净基线） */
function setup(): MemoryDao {
  dbSeq += 1;
  store = openStore({
    dbPath: join(dir, `test-${dbSeq}.db`),
    dataDir: dir,
    secretKey: ephemeralSecretKey(),
    migrations: [...MEMORY_MIGRATIONS],
  });
  return createMemoryDao({
    db: store.sqlite(),
    now: () => nowMs,
    warn: (m) => warns.push(m),
    newId: () => {
      idSeq += 1;
      const head = idSeq.toString(16).padStart(8, '0');
      return `${head}-0000-7000-8000-000000000000`;
    },
  });
}

/** 直改 memories 真身（制造归责歧态/expired 物化态等前置） */
function sql(statement: string, ...params: unknown[]): void {
  store!
    .sqlite()
    .prepare(statement)
    .run(...params);
}

/** 写入一条候选（返回完整 id） */
function seed(dao: MemoryDao, overrides: Record<string, unknown> = {}): string {
  return dao.ingest({
    ownerKey: 'global',
    kind: 'fact',
    summary: `fact entry ${idSeq}`,
    content: `content of fact entry ${idSeq}`,
    confidence: 0.8,
    sourceRefs: [{ sessionId: 's1', seq: 1 }],
    ...overrides,
  }).id;
}

/** assistant/message durable data 形（wiring 落 data.content = (text|thinking 块)[]） */
function assistantMessage(blocks: unknown[]): unknown {
  return { content: blocks, usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'stop' };
}

describe('parseCitations（同消息同短 id 去重——一条消息对一条记忆计一次）', () => {
  it('去重 + 首现序保序；/g 共享 lastIndex 连续调用复位', () => {
    expect(parseCitations('[m:11111111] a [m:22222222] b [m:11111111]')).toEqual(['11111111', '22222222']);
    expect(parseCitations('无引用文本')).toEqual([]);
    expect(parseCitations('x [m:11111111] y')).toEqual(['11111111']); // 复位——不残留上轮末位
  });
});

describe('createCiteRecorder（durable 事件消费）', () => {
  it('恰一归属回写四写一体：usage_count/last_used_at/流水 op=cite 带会话键/聚合计数', () => {
    const dao = setup();
    const id = seed(dao);
    const rec = createCiteRecorder({ dao, warn: (m) => warns.push(m) });
    rec.onEvent(
      'sess-1',
      'assistant/message',
      assistantMessage([{ type: 'text', text: `答案依据 [m:${shortIdOf(id)}] 条目` }]),
    );
    expect(dao.get(id)!.usageCount).toBe(1);
    expect(dao.get(id)!.lastUsedAt).toBe(nowMs);
    const flow = dao.accessLog().flow;
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({ memoryId: id, op: 'cite', sessionId: 'sess-1' });
    expect(dao.accessLog().aggregates[0]).toMatchObject({ memoryId: id, cite: 1, total: 1 }); // 聚合只随 cite
  });

  it('thinking 块不取（引用只发生在呈现面文本）+ 同消息同短 id 去重', () => {
    const dao = setup();
    const thoughtId = seed(dao);
    const citedId = seed(dao, { summary: 'second entry', content: 'second' });
    const rec = createCiteRecorder({ dao, warn: (m) => warns.push(m) });
    rec.onEvent(
      null,
      'assistant/message',
      assistantMessage([
        { type: 'thinking', text: `心里引用 [m:${shortIdOf(thoughtId)}] 不算` },
        { type: 'text', text: `正文引用 [m:${shortIdOf(citedId)}] 与再引 [m:${shortIdOf(citedId)}]` },
      ]),
    );
    expect(dao.get(thoughtId)!.usageCount).toBe(0);
    expect(dao.get(citedId)!.usageCount).toBe(1); // 一条消息对一条记忆计一次
    expect(dao.accessLog().flow).toHaveLength(1);
  });

  it('前缀归责三态：零命中 = 未知引用忽略；多命中 = 歧义全部忽略；恰一 = 唯一归属', () => {
    const dao = setup();
    const id = seed(dao);
    const otherId = seed(dao, { summary: 'other entry', content: 'other' });
    // 制造同 8 hex 前缀第二行（直改 id 后段——substr(1,8) 撞前缀）
    const collidingId = `${shortIdOf(id)}-0000-7000-8000-ffffffffffff`;
    sql('UPDATE memories SET id = ? WHERE id = ?', collidingId, otherId);
    expect(dao.resolveShortId(shortIdOf(id))).toHaveLength(2); // 前置——歧义态在场

    const rec = createCiteRecorder({ dao, warn: (m) => warns.push(m) });
    rec.onEvent(null, 'assistant/message', assistantMessage([{ type: 'text', text: `歧义 [m:${shortIdOf(id)}]` }]));
    expect(dao.get(id)!.usageCount).toBe(0); // 多命中全部忽略
    expect(dao.get(collidingId)!.usageCount).toBe(0);
    rec.onEvent(null, 'assistant/message', assistantMessage([{ type: 'text', text: '未知 [m:ffffffff]' }]));
    expect(dao.accessLog().flow).toEqual([]); // 零命中忽略——零流水

    // 恰一态：去掉撞前行后同引用唯一归属
    sql('UPDATE memories SET id = ? WHERE id = ?', otherId, collidingId);
    rec.onEvent(null, 'assistant/message', assistantMessage([{ type: 'text', text: `唯一 [m:${shortIdOf(id)}]` }]));
    expect(dao.get(id)!.usageCount).toBe(1);
  });

  it('TTL 续期：被引用即续命（expires_at = now + ttl_days 同点重算）；永久行钟不动', () => {
    const dao = setup();
    const ttlId = seed(dao, { ttlDays: 7 });
    const foreverId = seed(dao, { summary: 'forever entry', content: 'forever' });
    sql('UPDATE memories SET expires_at = ? WHERE id = ?', nowMs - 1000, ttlId); // 钟已过未物化
    const rec = createCiteRecorder({ dao, warn: (m) => warns.push(m) });
    rec.onEvent(
      's',
      'assistant/message',
      assistantMessage([{ type: 'text', text: `[m:${shortIdOf(ttlId)}] 与 [m:${shortIdOf(foreverId)}]` }]),
    );
    expect(dao.get(ttlId)!.expiresAt).toBe(nowMs + 7 * MEMORY_DAY_MS); // 续命
    expect(dao.get(foreverId)!.expiresAt).toBeNull(); // ttl NULL 钟不动
  });

  it('expired 已物化行整行跳过含流水（复活唯 restore）；dismissed 行照计（审计事实）', () => {
    const dao = setup();
    const expiredId = seed(dao);
    sql("UPDATE memories SET status = 'expired', superseded_by = 'ttl' WHERE id = ?", expiredId);
    const dismissedId = seed(dao, { summary: 'dismissed entry', content: 'dismissed' });
    dao.forget(dismissedId);
    const applied = dao.markUsed([expiredId, dismissedId], 'sess-7');
    expect(applied).toBe(1); // 实记数 = dismissed 一条
    expect(dao.get(expiredId)!.usageCount).toBe(0);
    expect(dao.get(dismissedId)!.usageCount).toBe(1);
    const flow = dao.accessLog().flow;
    expect(flow).toHaveLength(1); // expired 不落流水
    expect(flow[0]).toMatchObject({ memoryId: dismissedId, op: 'cite', sessionId: 'sess-7' });
  });

  it('非 assistant/message 零动作；坏形 data 静默跳过；dao 异常尽力而为 warn 不炸', () => {
    const dao = setup();
    const rec = createCiteRecorder({ dao, warn: (m) => warns.push(m) });
    rec.onEvent(null, 'user/message', { content: '[m:11111111]' });
    rec.onEvent(null, 'assistant/message', { nope: 1 }); // content 缺席 → 坏形跳过
    rec.onEvent(null, 'assistant/message', '字符串 data'); // 非对象跳过
    rec.onEvent(null, 'assistant/message', assistantMessage([{ type: 'text', text: '无引用' }]));
    expect(dao.accessLog().flow).toEqual([]);

    // dao 抛异常 → warn 止步不外炸（消费件挂在事件通道上——计量失败不炸通道）
    const boom = createCiteRecorder({
      dao: {
        resolveShortId: () => {
          throw new Error('boom');
        },
      } as unknown as MemoryDao,
      warn: (m) => warns.push(m),
    });
    expect(() =>
      boom.onEvent(null, 'assistant/message', assistantMessage([{ type: 'text', text: '[m:11111111]' }])),
    ).not.toThrow();
    expect(warns.some((w) => w.includes('引用回写尽力而为止步'))).toBe(true);
  });

  it('resolveShortId 直测：substr 定长前缀（短于 8 位不命中——长度面即词法面）', () => {
    const dao = setup();
    const id = seed(dao);
    expect(dao.resolveShortId(shortIdOf(id))).toEqual([id]);
    expect(dao.resolveShortId(shortIdOf(id).slice(0, 7))).toEqual([]); // 定长比对
    expect(dao.resolveShortId('ffffffff')).toEqual([]); // 零命中
  });
});
