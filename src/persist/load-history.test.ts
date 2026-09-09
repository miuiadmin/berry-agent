/**
 * 装载史测试（h-2 persist 笔——05 §9 load_generations）。
 *
 * 四面：迁移项形（v10 占号 + STRICT 五列 DDL 准绳 + 迁移链注册过闸）/
 * 同事务换代（首代开放窗·换代回填同刻·空三分区行照落·真库 v1 缺口带链
 * 重开 v10）/ 时间窗 join 推算（共现计数 DISTINCT 去重·判据恒 activated·
 * 窗不相交不计·当代开放窗 COALESCE 归一·闭区间端点相触即计）/ 零面
 * （无世代/从未激活 → 0）。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  LOAD_GENERATIONS_MIGRATION,
  createLoadHistoryFace,
  type LoadHistoryFace,
  type LoadGenerationSnapshot,
} from './load-history.js';
import { normalizeMigrations } from './migrations.js';
import { openStore, type Store } from './index.js';

let dir: string;
let stores: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-load-history-test-'));
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 开真库并构造装载史面（load_generations 表由迁移链建就） */
function openFace(clock?: () => number): { store: Store; face: LoadHistoryFace } {
  const store = openStore({ dataDir: join(dir, 'data'), migrations: [LOAD_GENERATIONS_MIGRATION] });
  stores.push(store);
  return { store, face: createLoadHistoryFace(store.connection, clock) };
}

/** 直插 sessions 行（durable 存活窗两列——write-behind 落库后的最终形态） */
function seedSession(store: Store, id: string, createdAt: number, updatedAt: number): void {
  store.connection
    .prepare('INSERT INTO sessions (id, origin, created_at, updated_at, last_seq) VALUES (?, ?, ?, ?, 0)')
    .run(id, 'conversation', createdAt, updatedAt);
}

/** 三分区全空快照（--no-plugins 安全模式 boot 形——世代存在且为空） */
const EMPTY_SNAPSHOT: LoadGenerationSnapshot = { activated: [], skipped: [], failed: [] };

describe('迁移项形（v10 占号——audit v8 之后顺延）', () => {
  it('version 10 / name / STRICT 五列 DDL 准绳齐备', () => {
    expect(LOAD_GENERATIONS_MIGRATION.version).toBe(10);
    expect(LOAD_GENERATIONS_MIGRATION.name).toBe('load-generations');
    const sql = LOAD_GENERATIONS_MIGRATION.sql;
    expect(sql).toContain('STRICT');
    for (const column of ['id', 'started_at', 'ended_at', 'activated', 'skipped', 'failed']) {
      expect(sql).toContain(column);
    }
  });

  it('迁移链注册过闸（normalizeMigrations 接受且升序居尾）', () => {
    expect(() => normalizeMigrations([LOAD_GENERATIONS_MIGRATION], 1)).not.toThrow();
    const chain = normalizeMigrations([LOAD_GENERATIONS_MIGRATION], 1);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.version).toBe(10);
  });
});

describe('recordLoadGeneration 同事务换代', () => {
  it('首代：id=1、started_at=挂钟、ended_at NULL 开放窗、三分区 JSON 往返', () => {
    let now = 1_000;
    const { store, face } = openFace(() => now);
    const snapshot: LoadGenerationSnapshot = {
      activated: [{ id: 'demo', tools: ['demo_tool_a', 'demo_tool_b'] }],
      skipped: [{ id: 'skipped-one', reason: 'disabled' }],
      failed: [{ id: 'failed-one', code: 'PLUGIN_LOAD_FAILED' }],
    };
    expect(face.recordLoadGeneration(snapshot)).toBe(1);
    const row = store.connection
      .prepare('SELECT started_at, ended_at, activated, skipped, failed FROM load_generations')
      .get() as Record<string, unknown>;
    expect(row.started_at).toBe(1_000);
    expect(row.ended_at).toBeNull();
    expect(JSON.parse(row.activated as string)).toEqual(snapshot.activated);
    expect(JSON.parse(row.skipped as string)).toEqual(snapshot.skipped);
    expect(JSON.parse(row.failed as string)).toEqual(snapshot.failed);
  });

  it('换代回填：前代 ended_at = 新行 started_at 同刻；新代开放窗', () => {
    let now = 1_000;
    const { store, face } = openFace(() => now);
    face.recordLoadGeneration(EMPTY_SNAPSHOT);
    now = 2_000;
    expect(face.recordLoadGeneration(EMPTY_SNAPSHOT)).toBe(2);
    const rows = store.connection
      .prepare('SELECT id, started_at, ended_at FROM load_generations ORDER BY id')
      .all() as Array<{ id: number; started_at: number; ended_at: number | null }>;
    expect(rows).toHaveLength(2);
    // 同刻律：回填值 = 新行 started_at（同事务同刻——不虚构收口时刻）
    expect(rows[0]?.ended_at).toBe(rows[1]?.started_at);
    expect(rows[0]?.ended_at).toBe(2_000);
    expect(rows[1]?.ended_at).toBeNull();
  });

  it('--no-plugins 空三分区行照落（世代存在且为空）', () => {
    const { store, face } = openFace(() => 1_000);
    expect(face.recordLoadGeneration(EMPTY_SNAPSHOT)).toBe(1);
    const row = store.connection.prepare('SELECT activated, skipped, failed FROM load_generations').get() as Record<
      string,
      string
    >;
    expect(row.activated).toBe('[]');
    expect(row.skipped).toBe('[]');
    expect(row.failed).toBe('[]');
    // 空世代下任何插件计数恒零
    expect(face.querySessionsWithPlugin('any')).toBe(0);
  });

  it('真库迁移腿：v1 缺口库带链重开 v10（备份件在场 + user_version + 写读成立）', () => {
    const dbPath = join(dir, 'data', 'sessions.db');
    // 第一开：无链——基线 v1（无 load_generations 表）
    const v1 = openStore({ dbPath, dataDir: join(dir, 'data') });
    v1.close();
    // 重开：带链——迁移补跑建表
    const { store, face } = (() => {
      const store = openStore({ dbPath, dataDir: join(dir, 'data'), migrations: [LOAD_GENERATIONS_MIGRATION] });
      stores.push(store);
      return { store, face: createLoadHistoryFace(store.connection, () => 1_000) };
    })();
    expect(Number(store.connection.pragma('user_version', { simple: true }))).toBe(10);
    // 迁移备份件在场（缺口迁移先备份——05 §6.4；命名 .bak-v1）
    expect(existsSync(`${dbPath}.bak-v1`)).toBe(true);
    face.recordLoadGeneration(EMPTY_SNAPSHOT);
    seedSession(store, 's1', 900, 1_100);
    expect(face.querySessionsWithPlugin('any')).toBe(0);
  });
});

describe('querySessionsWithPlugin 时间窗 join 推算', () => {
  it('共现计数：存活窗与激活窗相交即计；DISTINCT 跨代去重（长眠会话只计一）', () => {
    let now = 1_000;
    const { store, face } = openFace(() => now);
    face.recordLoadGeneration({ activated: [{ id: 'p1', tools: [] }], skipped: [], failed: [] });
    now = 2_000;
    face.recordLoadGeneration({ activated: [{ id: 'p1', tools: [] }], skipped: [], failed: [] });
    // A：仅与第一代相交（500-1500 ⊂ 1000-2000 边缘搭接）
    seedSession(store, 'a', 500, 1_500);
    // B：仅与第二代（开放窗）相交
    seedSession(store, 'b', 2_500, 2_600);
    // C：长眠横跨两代——DISTINCT 只计一
    seedSession(store, 'c', 500, 2_500);
    now = 3_000;
    expect(face.querySessionsWithPlugin('p1')).toBe(3);
    // 从未激活的插件恒零
    expect(face.querySessionsWithPlugin('p2')).toBe(0);
  });

  it('判据恒 activated：skipped/failed 分区成员不算「装载过」', () => {
    let now = 1_000;
    const { store, face } = openFace(() => now);
    face.recordLoadGeneration({
      activated: [{ id: 'p-act', tools: [] }],
      skipped: [{ id: 'p-skip', reason: 'disabled' }],
      failed: [{ id: 'p-fail', code: 'PLUGIN_LOAD_FAILED' }],
    });
    seedSession(store, 's1', 1_200, 1_300);
    now = 2_000;
    expect(face.querySessionsWithPlugin('p-act')).toBe(1);
    expect(face.querySessionsWithPlugin('p-skip')).toBe(0);
    expect(face.querySessionsWithPlugin('p-fail')).toBe(0);
  });

  it('窗不相交不计：会话终于世代开始前 / 始于世代结束后', () => {
    let now = 1_000;
    const { store, face } = openFace(() => now);
    face.recordLoadGeneration({ activated: [{ id: 'p1', tools: [] }], skipped: [], failed: [] });
    now = 2_000;
    // 第二代不含 p1——第一代就此闭合（1000-2000）
    face.recordLoadGeneration(EMPTY_SNAPSHOT);
    // E：终于世代开始前（900 < 1000）
    seedSession(store, 'e', 100, 900);
    // F：始于世代结束后（2100 > 2000）
    seedSession(store, 'f', 2_100, 2_200);
    now = 3_000;
    expect(face.querySessionsWithPlugin('p1')).toBe(0);
  });

  it('当代开放窗 COALESCE 归一：查询时刻推进 → 开放窗随钟延展', () => {
    let now = 1_000;
    const { store, face } = openFace(() => now);
    face.recordLoadGeneration({ activated: [{ id: 'p1', tools: [] }], skipped: [], failed: [] });
    seedSession(store, 'a', 1_200, 1_300);
    // G：存活窗在挂钟 3500 之后——此刻归一窗（1000..3500）未及，不计
    seedSession(store, 'g', 4_000, 4_500);
    now = 3_500;
    expect(face.querySessionsWithPlugin('p1')).toBe(1);
    // 挂钟推进到 5000：开放窗延展覆盖 G 存活窗起点——计入
    now = 5_000;
    expect(face.querySessionsWithPlugin('p1')).toBe(2);
  });

  it('闭区间端点相触即计：created_at=ended_at / updated_at=started_at', () => {
    let now = 1_000;
    const { store, face } = openFace(() => now);
    face.recordLoadGeneration({ activated: [{ id: 'p1', tools: [] }], skipped: [], failed: [] });
    now = 2_000;
    face.recordLoadGeneration(EMPTY_SNAPSHOT);
    // T1：created_at 恰等于第一代 ended_at（尾端相触）
    seedSession(store, 't1', 2_000, 2_500);
    // T2：updated_at 恰等于第一代 started_at（首端相触）
    seedSession(store, 't2', 500, 1_000);
    now = 3_000;
    expect(face.querySessionsWithPlugin('p1')).toBe(2);
  });
});

describe('零面诚实', () => {
  it('无世代库（表在而零行）恒零——不虚构共现', () => {
    const { store, face } = openFace(() => 1_000);
    seedSession(store, 's1', 500, 1_500);
    expect(face.querySessionsWithPlugin('p1')).toBe(0);
  });
});
