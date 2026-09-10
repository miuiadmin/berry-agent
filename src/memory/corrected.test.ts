/**
 * 纠正负效用回写 + 晋升判据六维测试（2026-09-08 消化批——06 §3 corrected-cite /
 * §4 即时路第二动作 / §5 净用形效用分 / §9.1 六维判据）。
 *
 * 「修复前必红」种子三断言（§9.1 delta 钉死）：
 *  ① 单会话命中条目不入候选（跨会话维——source_refs **证据来源会话多样数** ≥ 2；
 *    命名循冷读闸观察注：防与 cite 使用命中面混读）；
 *  ② corrected_count > 0 条目不入候选（负效用排除——刚被证错的知识不晋升）；
 *  ③ corrected-cite 不动 last_used_at / usage_count / TTL（§3 守卫①不保活——
 *    「被使用」与「被纠正」在保活面分立）。
 *
 * 其余覆盖：markCorrected 守卫（终态照记/流水归位/缺席 id 跳过）、迁移 v9 两动作
 * （补列 + memory_access 表重建扩 op CHECK——冷读闸 blocker 销账的回归锁）、
 * 导出 18 列与旧 17 列容错位、净用形效用分、polluted 同闸（派生面从严）、
 * 两动作失败路径分立（候选被拒不连带）、归责三态复用、回看缓存 LRU 与
 * 紧邻前一条语义、纪律句强化文案。真库全环（openStore 迁移链 + createMemoryDao）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { MEMORY_BRIEF_TOP_N, MEMORY_DAY_MS, MEMORY_EXPORT_MAGIC, type MemoryCandidate } from './types.js';
import { createMemoryDao, type MemoryDao } from './dao.js';
import { MEMORY_MIGRATIONS } from './migration.js';
import { briefBaseline, renderCoreBrief, shortIdOf } from './inject.js';
import { createImmediateExtractor } from './extract.js';
import { parseCitations } from './cite.js';
import { parseMemoryImportRow, runMemoryImport, serializeMemoryExport } from './port.js';
import { utilityScore } from './merge.js';

let dir: string;
let store: Store | null = null;
let nowMs: number;
let idSeq = 0;
let dbSeq = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-memory-corrected-'));
  nowMs = Date.parse('2026-09-09T08:00:00.000Z');
  idSeq = 0;
  dbSeq = 0;
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 真库装配（一 setup 一库文件——inject.test 同款 idiom；id 拼形保字典序 = 注入序） */
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
    warn: () => {},
    newId: () => {
      idSeq += 1;
      const head = idSeq.toString(16).padStart(8, '0');
      return `${head}-0000-7000-8000-000000000000`;
    },
  });
}

/** 直改 memories 真身（制造历史状态——绕写前扫描） */
function sql(statement: string, ...params: unknown[]): void {
  store!
    .sqlite()
    .prepare(statement)
    .run(...params);
}

/** NATO 词表（≥ MEMORY_BRIEF_TOP_N=20——词根互异防归一合并；归一化剥数字故不可用序号造异） */
const WORDS: readonly string[] = [
  'alpha',
  'bravo',
  'charlie',
  'delta',
  'echo',
  'foxtrot',
  'golf',
  'hotel',
  'india',
  'juliet',
  'kilo',
  'lima',
  'mike',
  'november',
  'oscar',
  'papa',
  'quebec',
  'romeo',
  'sierra',
  'tango',
  'uniform',
  'victor',
  'whiskey',
  'xray',
  'yankee',
  'zulu',
];

/** 撑满竞争面（top N 条 preference 填满正文，后续条目挤出入候选池——inject.test 同律） */
function fillCompetitive(dao: MemoryDao): void {
  for (let i = 0; i < MEMORY_BRIEF_TOP_N; i += 1) {
    dao.ingest({
      ownerKey: 'global',
      kind: 'preference',
      summary: `competitive pref ${WORDS[i]}`,
      content: `competitive pref body ${WORDS[i]}`,
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's1', seq: i }],
    });
  }
}

/**
 * 跨会话双摄入（六维判据的正例造法）：两次摄入携带**不同会话**溯源——精确合并
 * 后 evidence=2 且证据来源会话多样数=2（单会话双摄入只造前者不造后者——恰是
 * 种子断言①的反例素材）。
 */
function seedCrossSession(dao: MemoryDao, overrides: Partial<MemoryCandidate> = {}): string {
  const base: MemoryCandidate = {
    ownerKey: 'global',
    kind: 'failure',
    summary: 'cross session lesson',
    content: 'cross session lesson body',
    confidence: 0.8,
    sourceRefs: [{ sessionId: 's1', seq: 1 }],
  };
  const { id } = dao.ingest({ ...base, ...overrides, sourceRefs: [{ sessionId: 's1', seq: 1 }] });
  dao.ingest({ ...base, ...overrides, sourceRefs: [{ sessionId: 's2', seq: 1 }] });
  return id;
}

describe('种子三断言（§9.1 delta——修复前必红）', () => {
  it('① 单会话命中条目不入候选（跨会话维：source_refs 证据来源会话多样数 ≥ 2）', () => {
    const dao = setup();
    fillCompetitive(dao);
    // 单会话双摄入：evidence=2 反复命中，但证据来源会话多样数=1（同一任务重试面）
    const base: MemoryCandidate = {
      ownerKey: 'global',
      kind: 'failure',
      summary: 'single session retry lesson',
      content: 'single session retry lesson body',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's1', seq: 1 }],
    };
    dao.ingest(base);
    dao.ingest({ ...base, sourceRefs: [{ sessionId: 's1', seq: 2 }] });
    expect(briefBaseline(dao, nowMs, ['global']).candidates).toEqual([]);
    // 对照组：跨会话双摄入（多样数=2）照常入候选——判据收紧不误伤正例
    const crossId = seedCrossSession(dao, { summary: 'cross session lesson', content: 'cross session lesson body' });
    expect(briefBaseline(dao, nowMs, ['global']).candidates.map((e) => e.id)).toEqual([crossId]);
  });

  it('② corrected_count > 0 条目不入候选（负效用排除——刚被证错的知识不晋升）', () => {
    const dao = setup();
    fillCompetitive(dao);
    const id = seedCrossSession(dao, { summary: 'corrected lesson', content: 'corrected lesson body' });
    expect(briefBaseline(dao, nowMs, ['global']).candidates.map((e) => e.id)).toEqual([id]); // 纠正前在场
    dao.markCorrected([id], 's9');
    expect(briefBaseline(dao, nowMs, ['global']).candidates).toEqual([]); // 纠正后退场
  });

  it('③ corrected-cite 不动 last_used_at / usage_count / TTL（守卫①不保活）', () => {
    const dao = setup();
    const id = seedCrossSession(dao, { summary: 'guard lesson', content: 'guard lesson body' });
    const usedAt = nowMs - 1000;
    const expiresAt = nowMs + 30 * MEMORY_DAY_MS;
    sql(
      'UPDATE memories SET usage_count = 2, last_used_at = ?, ttl_days = 30, expires_at = ? WHERE id = ?',
      usedAt,
      expiresAt,
      id,
    );
    const applied = dao.markCorrected([id], 's9');
    expect(applied).toBe(1);
    const row = dao.get(id)!;
    expect(row.correctedCount).toBe(1); // 负账投影 +1
    expect(row.usageCount).toBe(2); // 不动 usage_count
    expect(row.lastUsedAt).toBe(usedAt); // 不动 last_used_at
    expect(row.ttlDays).toBe(30); // 不动 TTL 策略
    expect(row.expiresAt).toBe(expiresAt); // 不续期（保活只随 cite 正向引用）
  });
});

describe('markCorrected（06 §3 纠正负效用回写——守卫面）', () => {
  it('终态行照记流水照计聚合（守卫③——frozen/dismissed/expired 一律；对照 markUsed 跳过 expired）', () => {
    const dao = setup();
    const frozenId = seedCrossSession(dao, { summary: 'frozen lesson', content: 'frozen lesson body' });
    const dismissedId = seedCrossSession(dao, { summary: 'dismissed lesson', content: 'dismissed lesson body' });
    const expiredId = seedCrossSession(dao, { summary: 'expired lesson', content: 'expired lesson body' });
    dao.freeze(frozenId);
    dao.forget(dismissedId);
    sql("UPDATE memories SET status = 'expired', superseded_by = 'ttl' WHERE id = ?", expiredId);

    expect(dao.markCorrected([frozenId, dismissedId, expiredId], 's9')).toBe(3); // 终态照记
    expect(dao.get(frozenId)!.correctedCount).toBe(1);
    expect(dao.get(dismissedId)!.correctedCount).toBe(1);
    expect(dao.get(expiredId)!.correctedCount).toBe(1);
    const ops = new Set(dao.accessLog().flow.map((f) => f.op));
    expect(ops.has('corrected-cite')).toBe(true);
    // 对照：markUsed 对 expired 整行跳过（复活唯 restore——续期语义不适用负效用腿）
    expect(dao.markUsed([expiredId], 's9')).toBe(0);
  });

  it('流水归位：corrected-cite 行带纠正发生会话键（§3 DDL 注）', () => {
    const dao = setup();
    const id = seedCrossSession(dao, { summary: 'session key lesson', content: 'session key lesson body' });
    dao.markCorrected([id], 'correction-session');
    const flow = dao.accessLog({ op: 'corrected-cite' }).flow;
    expect(flow).toHaveLength(1);
    expect(flow[0]!.memoryId).toBe(id);
    expect(flow[0]!.sessionId).toBe('correction-session');
  });

  it('缺席 id 零命中跳过（不立行不计数——markUsed 同族 idiom）', () => {
    const dao = setup();
    expect(dao.markCorrected(['no-such-id'], 's9')).toBe(0);
    expect(dao.accessLog({ op: 'corrected-cite' }).flow).toEqual([]);
  });

  it('同纠正事件同条目只记一次（守卫④——同消息同短 id 去重在解析面，DAO 侧幂等批）', () => {
    const dao = setup();
    const id = seedCrossSession(dao, { summary: 'dedup lesson', content: 'dedup lesson body' });
    // 同一 assistant 文本重复标注同短 id → parseCitations 去重 → 单次 markCorrected
    const shorts = parseCitations(`answer [m:${shortIdOf(id)}] again [m:${shortIdOf(id)}]`);
    expect(shorts).toHaveLength(1);
    dao.markCorrected([id], 's9');
    expect(dao.get(id)!.correctedCount).toBe(1);
  });
});

describe('迁移 v9 两动作（冷读闸 blocker 销账的回归锁）', () => {
  it('① memories 补列：全链升顶后 corrected_count 在场、存量行 DEFAULT 0 回填', () => {
    const dao = setup(); // 全链（v4..v9）经 openStore 应用
    const id = seedCrossSession(dao, { summary: 'v9 column lesson', content: 'v9 column lesson body' });
    expect(dao.get(id)!.correctedCount).toBe(0);
  });

  it('② memory_access 表重建：op CHECK 扩四词——corrected-cite 可插、旧词数据保全', () => {
    // 先建 head=6 旧库（三词 CHECK 时代）：raw SQL 造旧态（此时段新 DAO 已查
    // corrected_count 列——head=6 库上不可用，直插是对「旧库现场」的忠实造法）
    dbSeq += 1;
    const legacyPath = join(dir, `legacy-${dbSeq}.db`);
    const legacyId = '12345678-0000-7000-8000-00000000000f';
    const legacy = openStore({
      dbPath: legacyPath,
      dataDir: dir,
      secretKey: ephemeralSecretKey(),
      migrations: MEMORY_MIGRATIONS.filter((m) => m.version <= 6),
    });
    legacy
      .sqlite()
      .prepare(
        `INSERT INTO memories (id, owner_key, kind, summary, content, confidence, evidence_count,
                               status, superseded_by, source_refs, created_at, updated_at,
                               usage_count, last_used_at, frozen, ttl_days, expires_at)
         VALUES (?, 'global', 'fact', 'legacy fact survives rebuild', 'legacy fact body', 0.9, 1,
                 'active', NULL, '[]', 1, 1, 1, 1, 0, NULL, NULL)`,
      )
      .run(legacyId);
    legacy
      .sqlite()
      .prepare(
        "INSERT INTO memory_access (id, memory_id, op, session_id, ts) VALUES ('legacy-cite', ?, 'cite', 's0', 1)",
      )
      .run(legacyId);
    legacy.close();

    // 旧库直插第四词必被三词 CHECK 拒（blocker 实证——重建是唯一通路）
    const probe = openStore({
      dbPath: legacyPath,
      dataDir: dir,
      secretKey: ephemeralSecretKey(),
      migrations: MEMORY_MIGRATIONS.filter((m) => m.version <= 6),
    });
    expect(() =>
      probe
        .sqlite()
        .prepare(
          "INSERT INTO memory_access (id, memory_id, op, session_id, ts) VALUES ('probe', ?, 'corrected-cite', NULL, 0)",
        )
        .run(legacyId),
    ).toThrow(/CHECK/i);
    probe.close();

    // 重开全链 → v9 应用：旧词流水保全 + 第四词可插 + 索引在场
    const store2 = openStore({
      dbPath: legacyPath,
      dataDir: dir,
      secretKey: ephemeralSecretKey(),
      migrations: [...MEMORY_MIGRATIONS],
    });
    const dao2 = createMemoryDao({ db: store2.sqlite(), now: () => nowMs, warn: () => {} });
    expect(dao2.accessLog({ op: 'cite' }).flow).toHaveLength(1); // 搬数据保全
    expect(dao2.markCorrected([legacyId], 's9')).toBe(1); // 第四词经重建放行
    expect(dao2.get(legacyId)!.correctedCount).toBe(1); // 补列回填后可计
    const idx = store2
      .sqlite()
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_access_memory_ts'")
      .get();
    expect(idx).toBeDefined(); // 同事务重建索引
    store2.close();
  });
});

describe('导出 18 列与旧 17 列容错位（冷读闸 major 销账）', () => {
  /** 最小合法 17 列行（旧文件形——无 corrected_count） */
  const legacyRowJson = (id: string): string =>
    JSON.stringify({
      id,
      owner_key: 'global',
      kind: 'fact',
      summary: 'legacy seventeen columns',
      content: 'legacy body',
      confidence: 0.8,
      evidence_count: 1,
      status: 'active',
      superseded_by: null,
      source_refs: [{ sessionId: 's1', seq: 1 }],
      created_at: 1,
      updated_at: 2,
      usage_count: 1,
      last_used_at: 3,
      frozen: false,
      ttl_days: null,
      expires_at: null,
    });

  it('导出行 18 列含 corrected_count（恢复式备份不丢负效用历史）', () => {
    const dao = setup();
    const id = seedCrossSession(dao, { summary: 'export lesson', content: 'export lesson body' });
    dao.markCorrected([id], 's9');
    const text = serializeMemoryExport({ exportedAt: nowMs, ownerScope: 'all', ownerRoots: {} }, dao.listForExport());
    const dataLine = text.split('\n')[1]!;
    expect(JSON.parse(dataLine)['corrected_count']).toBe(1);
  });

  it('旧 17 列文件缺席按 DEFAULT 0 收（缺席不折 rejectedMalformed）；在场负值拒', () => {
    const dao = setup();
    const header = JSON.stringify({
      format: MEMORY_EXPORT_MAGIC,
      formatVersion: 1,
      exportedAt: nowMs,
      ownerScope: 'all',
      ownerRoots: {},
    });
    // 缺席 → 收（inserted，corrected_count 落 0）
    const outcomeAbsent = runMemoryImport(`${header}\n${legacyRowJson('legacy-0001')}\n`, dao);
    expect(outcomeAbsent).toEqual({ inserted: 1, skippedExisting: 0, rejectedSecret: 0, rejectedMalformed: 0 });
    expect(dao.get('legacy-0001')!.correctedCount).toBe(0);
    // 在场合法 → 随行入库
    const withCorrected = JSON.stringify({ ...JSON.parse(legacyRowJson('legacy-0002')), corrected_count: 3 });
    const outcomePresent = runMemoryImport(`${header}\n${withCorrected}\n`, dao);
    expect(outcomePresent.inserted).toBe(1);
    expect(dao.get('legacy-0002')!.correctedCount).toBe(3);
    // 在场坏形（负数）→ rejectedMalformed（行级宽容不弃批）
    const badCorrected = JSON.stringify({ ...JSON.parse(legacyRowJson('legacy-0003')), corrected_count: -1 });
    const outcomeBad = runMemoryImport(`${header}\n${badCorrected}\n`, dao);
    expect(outcomeBad.rejectedMalformed).toBe(1);
  });

  it('行解析：18 列全在场合法行直过 parseMemoryImportRow', () => {
    const row = parseMemoryImportRow(
      JSON.stringify({ ...JSON.parse(legacyRowJson('full-0001')), corrected_count: 2 }),
      2,
    );
    expect(row.corrected_count).toBe(2);
  });
});

describe('净用形效用分（§5 修订——usage 位取 max(usage − corrected, 0)）', () => {
  it('被纠正引用从效用功勋扣除；净用回 0 即回 ×1 基线、不为负；证据维独立计功', () => {
    const base = { confidence: 0.8, evidenceCount: 2 };
    const plain = utilityScore({ ...base, usageCount: 3 });
    const net = utilityScore({ ...base, usageCount: 3, correctedCount: 2 });
    expect(net).toBeLessThan(plain); // 扣除后降档
    expect(net).toBeGreaterThan(utilityScore({ ...base, usageCount: 0 })); // 净用 1 仍高于基线
    // 净用回 0 = 基线；corrected 超 usage 不入负分区（惩罚有界）
    expect(utilityScore({ ...base, usageCount: 2, correctedCount: 2 })).toBe(
      utilityScore({ ...base, usageCount: 0, correctedCount: 0 }),
    );
    expect(utilityScore({ ...base, usageCount: 1, correctedCount: 5 })).toBe(utilityScore({ ...base, usageCount: 0 }));
    // 缺席 = 0（旧调用面零变）
    expect(utilityScore({ ...base, usageCount: 3 })).toBe(plain);
  });

  it('简报排序自动跟随净用（被纠正条目照常竞争常驻简报、排序分自然回落——零新排除谓词）', () => {
    const dao = setup();
    const cleanId = dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'clean ranked fact',
      content: 'clean ranked fact body',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's1', seq: 1 }],
    }).id;
    const correctedId = dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'corrected ranked fact',
      content: 'corrected ranked fact body',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's1', seq: 2 }],
    }).id;
    sql('UPDATE memories SET usage_count = 5 WHERE id = ?', correctedId);
    dao.markCorrected([correctedId, correctedId, correctedId, correctedId, correctedId], 's9'); // 净用 0
    expect(dao.get(correctedId)!.usageCount).toBe(5);
    expect(dao.get(correctedId)!.correctedCount).toBe(5);
    // 同 evidence 同 confidence：clean（usage 0 基线）vs corrected（净用 0）平 → id 字典序
    const baseline = briefBaseline(dao, nowMs, ['global']);
    expect(baseline.competitive.map((e) => e.id).sort()).toEqual([cleanId, correctedId].sort());
  });
});

describe('即时路第二动作（§4——纠正命中 → 回看紧邻前一条 assistant 文本）', () => {
  /** 装配 extractor + 指定前一条 assistant 文本（回看 seam 直喂） */
  function extractorWith(
    dao: MemoryDao,
    prevText: string | null,
    opts: { polluted?: boolean; ingestThrows?: boolean } = {},
  ) {
    const daoFace = opts.ingestThrows
      ? ({
          ...dao,
          ingest: () => {
            throw new Error('ingest rejected (secret scan)');
          },
        } as MemoryDao)
      : dao;
    return createImmediateExtractor({
      dao: daoFace,
      ...(opts.polluted !== undefined ? { isSessionPolluted: () => opts.polluted! } : {}),
      ...(prevText !== null ? { lastAssistantText: () => prevText } : {}),
      warn: () => {},
    });
  }

  const correctionMsg = { content: '不对，这个说法说错了' };

  it('纠正命中 → 前条 assistant 引用全复用解析 → corrected-cite 落账；correction 候选照常入库', () => {
    const dao = setup();
    const id = dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'cited then corrected fact',
      content: 'cited then corrected fact body',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's1', seq: 1 }],
    }).id;
    const extractor = extractorWith(dao, `based on [m:${shortIdOf(id)}] the answer is X`);
    const { extracted } = extractor.onUserMessage('sess-a', 7, correctionMsg);
    expect(extracted).toBe(true); // 第一动作（correction 提取）照常
    expect(dao.get(id)!.correctedCount).toBe(1); // 第二动作（负效用回写）落账
    expect(dao.accessLog({ op: 'corrected-cite' }).flow[0]!.sessionId).toBe('sess-a'); // 纠正发生会话键
  });

  it('两动作失败路径分立：候选 ingest 被拒不连带负效用（触发位 = 命中即记）', () => {
    const dao = setup();
    const id = dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'reject independent fact',
      content: 'reject independent fact body',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's1', seq: 1 }],
    }).id;
    const extractor = extractorWith(dao, `cite [m:${shortIdOf(id)}]`, { ingestThrows: true });
    expect(() => extractor.onUserMessage('sess-a', 7, correctionMsg)).not.toThrow(); // 尽力而为吞
    expect(dao.get(id)!.correctedCount).toBe(1); // 负效用不随候选被拒蒸发
  });

  it('polluted 同闸（§4.1 首步——派生面从严）：污染会话两动作同跳', () => {
    const dao = setup();
    const id = dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'polluted gate fact',
      content: 'polluted gate fact body',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's1', seq: 1 }],
    }).id;
    const extractor = extractorWith(dao, `cite [m:${shortIdOf(id)}]`, { polluted: true });
    expect(extractor.onUserMessage('sess-a', 7, correctionMsg)).toEqual({ extracted: false });
    expect(dao.get(id)!.correctedCount).toBe(0);
    expect(dao.accessLog().flow).toEqual([]); // 零流水（提取与回写同跳）
  });

  it('归责三态复用：零命中忽略 / 多命中歧义忽略 / 恰一命中归属', () => {
    const dao = setup();
    // 两条同 8 hex 前缀（歧义面）+ 一条独立（恰一命中面）
    sql(
      `INSERT INTO memories (id, owner_key, kind, summary, content, confidence, evidence_count, status, superseded_by, source_refs, created_at, updated_at)
       VALUES ('abcdef01-0000-7000-8000-000000000001', 'global', 'fact', 'amb one', 'amb one body', 0.8, 1, 'active', NULL, '[]', 1, 1)`,
    );
    sql(
      `INSERT INTO memories (id, owner_key, kind, summary, content, confidence, evidence_count, status, superseded_by, source_refs, created_at, updated_at)
       VALUES ('abcdef01-0000-7000-8000-000000000002', 'global', 'fact', 'amb two', 'amb two body', 0.8, 1, 'active', NULL, '[]', 1, 1)`,
    );
    const uniqueId = dao.ingest({
      ownerKey: 'global',
      kind: 'fact',
      summary: 'unique resolve fact',
      content: 'unique resolve fact body',
      confidence: 0.8,
      sourceRefs: [{ sessionId: 's1', seq: 1 }],
    }).id;
    const extractor = extractorWith(dao, `amb [m:abcdef01] unknown [m:ffffffff] unique [m:${shortIdOf(uniqueId)}]`);
    extractor.onUserMessage('sess-a', 7, correctionMsg);
    expect(dao.get('abcdef01-0000-7000-8000-000000000001')!.correctedCount).toBe(0); // 多命中歧义忽略
    expect(dao.get(uniqueId)!.correctedCount).toBe(1); // 恰一命中归属；零命中不炸
  });

  it('回看位空文本 / seam 缺席 → 负效用腿缺席不反噬提取主路', () => {
    const dao = setup();
    const blankFace = extractorWith(dao, '');
    expect(blankFace.onUserMessage('sess-a', 7, correctionMsg)).toEqual({ extracted: true });
    const noSeam = extractorWith(dao, null);
    expect(noSeam.onUserMessage('sess-a', 7, correctionMsg)).toEqual({ extracted: true });
    expect(dao.accessLog({ op: 'corrected-cite' }).flow).toEqual([]);
  });
});

describe('晋升纪律句强化（§9.1 第 4 件——2026-09-08 消化批）', () => {
  it('尾行携带可机械自检与复现成本定位；既有「做什么/为什么/怎么验」锚句保持', () => {
    const dao = setup();
    fillCompetitive(dao);
    seedCrossSession(dao, { summary: 'discipline lesson', content: 'discipline lesson body' });
    const text = renderCoreBrief(briefBaseline(dao, nowMs, ['global']), nowMs);
    expect(text).toContain('不写模型癖性自述'); // 既有锚句（旧回归锁不破）
    expect(text).toContain('可机械自检'); // 强化一：「怎么验」须可机械自检（挂 §11.7 自检环）
    expect(text).toContain('复现成本'); // 强化二：技能省复现成本不期失败→成功翻转
  });
});
