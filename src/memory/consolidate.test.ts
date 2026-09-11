/**
 * 批 18c-5 整理面测试——DAO 增面四法（forget 终态短路〔修前必红〕/absorb/
 * decay/sweepExpired）+ consolidation 编排（候选集三源/anchor 与水位双短路/
 * 理由护栏/候选集外 id 忽略/存活重验）。
 *
 * LLM 全桩（计划注入式——零真网络）；时钟可拨（anchor/stale/水位全确定性）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { createMemoryDao, type MemoryDao } from './dao.js';
import { createConsolidator } from './consolidate.js';
import { MEMORY_MIGRATIONS } from './migration.js';
import type { MemoryCandidate, MemoryLlmFace } from './types.js';

let dir: string;
let store: Store | null = null;
/** 可拨毫秒时钟 */
let nowMs: number;
let idSeq = 0;
let dbSeq = 0;
const warn = vi.fn();
const DAY = 86_400_000;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-memory-consol-'));
  nowMs = Date.parse('2026-09-08T08:00:00.000Z');
  idSeq = 0;
  dbSeq = 0;
  warn.mockClear();
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 开库+迁移链+DAO（一 setup 一库文件——同测试多 setup 免同文件连坐） */
function openDao(): MemoryDao {
  store = openStore({
    dbPath: join(dir, `test-${++dbSeq}.db`),
    dataDir: dir,
    secretKey: ephemeralSecretKey(),
    migrations: [...MEMORY_MIGRATIONS],
  });
  return createMemoryDao({
    db: store.sqlite(),
    now: () => nowMs,
    warn,
    newId: () => `m${++idSeq}`,
  });
}

/** 标准候选（override 面覆盖各形） */
function candidate(overrides: Partial<MemoryCandidate> = {}): MemoryCandidate {
  return {
    ownerKey: 'global',
    kind: 'preference',
    summary: 'user prefers pnpm for package management',
    content: 'user prefers pnpm for package management in all repositories',
    confidence: 0.8,
    sourceRefs: [{ sessionId: 's1', seq: 1 }],
    ...overrides,
  };
}

/** 落一条并取 id */
function seed(dao: MemoryDao, overrides: Partial<MemoryCandidate> = {}): string {
  return dao.ingest(candidate(overrides)).id;
}

/** 直改列（测试专用——制造 stale 前置态） */
function sql(text: string, ...params: (string | number)[]): void {
  store!
    .sqlite()
    .prepare(text)
    .run(...params);
}

/** LLM 桩（计划注入式——complete 回 plan 的 JSON 串；onCall 钩子模拟拍间变更；预算闸可拨；
 *  空计划归一为规范空形 {merges:[],decays:[]}） */
function llmStub(opts: { plan?: unknown; raw?: string; affordable?: boolean; onCall?: () => void } = {}): {
  face: MemoryLlmFace;
  prompts: string[];
  setAffordable: (v: boolean) => void;
} {
  const prompts: string[] = [];
  let affordable = opts.affordable ?? true;
  const normalizePlan = (p: unknown): unknown =>
    p === undefined || (typeof p === 'object' && p !== null && !Array.isArray(p) && Object.keys(p).length === 0)
      ? { merges: [], decays: [] }
      : p;
  const face: MemoryLlmFace = {
    async complete(req) {
      prompts.push(req.messages[0]!.content);
      opts.onCall?.();
      return { message: { content: opts.raw ?? JSON.stringify(normalizePlan(opts.plan)) } };
    },
    canAfford: () => affordable,
  };
  return { face, prompts, setAffordable: (v) => (affordable = v) };
}

/** 整理器便捷装配（缺省参全起草值；override 面拨容量/老化/anchor） */
function consolidator(
  dao: MemoryDao,
  face: MemoryLlmFace,
  overrides: { capacity?: number; staleDays?: number; decayFactor?: number; anchorMs?: number } = {},
) {
  return createConsolidator({
    dao,
    llm: face,
    warn,
    now: () => nowMs,
    ...(overrides.capacity !== undefined ? { capacity: overrides.capacity } : {}),
    ...(overrides.staleDays !== undefined ? { staleDays: overrides.staleDays } : {}),
    ...(overrides.decayFactor !== undefined ? { decayFactor: overrides.decayFactor } : {}),
    ...(overrides.anchorMs !== undefined ? { anchorMs: overrides.anchorMs } : {}),
  });
}

describe('DAO forget 终态短路（06 §5 第四件护栏——修前必红回归锁）', () => {
  it('已 dismissed 行再 forget 幂等短路返回现行行——不覆写 superseded_by（用户终审不被后到腿覆盖）', () => {
    const dao = openDao();
    const id = seed(dao);
    // 首腿 = 搬家终审（skill:<名>）——后到任何腿不得覆写（user→user 撞形掩盖不了）
    const first = dao.forget(id, { promotedToSkill: 'pnpm-rules' });
    expect(first.supersededBy).toBe('skill:pnpm-rules');
    // 后到 user 腿：短路返回——现行行原样、superseded_by 保持搬家终审
    const second = dao.forget(id);
    expect(second.status).toBe('dismissed');
    expect(second.supersededBy).toBe('skill:pnpm-rules');
    expect(dao.get(id)!.supersededBy).toBe('skill:pnpm-rules');
    // 后到 llm 腿：同样短路
    const third = dao.forget(id, { supersededBy: 'llm:m99' });
    expect(third.supersededBy).toBe('skill:pnpm-rules');
  });

  it('supersededBy 直取值落位（llm:<keepId> 消费形——consolidation 执行腿）', () => {
    const dao = openDao();
    const id = seed(dao);
    const row = dao.forget(id, { supersededBy: 'llm:m1' });
    expect(row.status).toBe('dismissed');
    expect(row.supersededBy).toBe('llm:m1');
    // promotedToSkill 腿既有语义不变（词法校验照走）
    const id2 = seed(dao, { summary: 'second entry', content: 'second' });
    expect(dao.forget(id2, { promotedToSkill: 'pnpm-rules' }).supersededBy).toBe('skill:pnpm-rules');
  });
});

describe('DAO absorb（显式合并物理动作——06 §5 落码定形注）', () => {
  it('证据全数过继 + confidence max + refs 并集 + updated_at 刷新 + keep 版本 cause=merge + drop 终态 llm:<keep>', () => {
    const dao = openDao();
    const keepId = seed(dao, { confidence: 0.8, sourceRefs: [{ sessionId: 'sk', seq: 1 }] });
    const dropId = seed(dao, {
      summary: 'repo uses npm registry mirrors for installs',
      content: 'npm mirrors',
      confidence: 0.9,
      sourceRefs: [{ sessionId: 'sd', seq: 5 }],
    });
    nowMs += 3_600_000; // 拨钟 1h——absorb 后 updated_at 取新钟
    const keep = dao.absorb(keepId, dropId);
    expect(keep.evidenceCount).toBe(2); // 1 + 1 全数过继（非象征性 +1）
    expect(keep.confidence).toBe(0.9); // max
    expect(keep.sourceRefs).toEqual([
      { sessionId: 'sk', seq: 1 },
      { sessionId: 'sd', seq: 5 },
    ]); // 血缘继承：并集过继
    expect(keep.updatedAt).toBe(nowMs); // 同三分支合并物理形——刷新
    expect(keep.status).toBe('active');
    const drop = dao.get(dropId)!;
    expect(drop.status).toBe('dismissed');
    expect(drop.supersededBy).toBe(`llm:${keepId}`);
    // keep 版本链追加 cause='merge'（快照取变更后值）
    const versions = dao.versions(keepId);
    expect(versions.at(-1)!.cause).toBe('merge');
    expect(versions.at(-1)!.evidenceCount).toBe(2);
    expect(versions.at(-1)!.confidence).toBe(0.9);
  });

  it('多证据条目过继全数（evidence 累加非清零）', () => {
    const dao = openDao();
    const keepId = seed(dao);
    dao.ingest(candidate()); // exact 合并 → keep evidence 2
    const dropId = seed(dao, { summary: 'repo uses npm mirrors', content: 'npm mirrors' });
    dao.ingest(candidate({ summary: 'repo uses npm mirrors', content: 'npm mirrors' })); // drop evidence 2
    const keep = dao.absorb(keepId, dropId);
    expect(keep.evidenceCount).toBe(4);
  });

  it('护栏：自指拒 / frozen 任一侧拒 / 非在册 drop 拒（码面断言——dao.test idiom）', () => {
    const dao = openDao();
    const a = seed(dao);
    const b = seed(dao, { summary: 'repo uses npm mirrors', content: 'npm mirrors' });
    expect(() => dao.absorb(a, a)).toThrowError(expect.objectContaining({ code: 'MEMORY_ENTRY_INVALID' }));
    dao.freeze(b);
    expect(() => dao.absorb(a, b)).toThrowError(expect.objectContaining({ code: 'MEMORY_FROZEN' }));
    dao.freeze(a);
    const c = seed(dao, { summary: 'third entry here', content: 'third' });
    expect(() => dao.absorb(a, c)).toThrowError(expect.objectContaining({ code: 'MEMORY_FROZEN' })); // keep 冻结同拒
    dao.unfreeze(a);
    dao.forget(c);
    expect(() => dao.absorb(a, c)).toThrowError(expect.objectContaining({ code: 'MEMORY_ENTRY_INVALID' })); // drop 已终态拒
  });

  it('批 ev-1 种子 c：合并 reason 随版本行持久化（用完即弃 → durable 因由）；缺省 NULL', () => {
    const dao = openDao();
    const keepId = seed(dao);
    const dropId = seed(dao, { summary: 'repo uses npm registry mirrors', content: 'npm mirrors body' });
    dao.absorb(keepId, dropId, '同主题重复：同一偏好的两种表述');
    const versions = dao.versions(keepId);
    expect(versions.at(-1)!.cause).toBe('merge');
    expect(versions.at(-1)!.reason).toBe('同主题重复：同一偏好的两种表述');
    // 缺省不带 reason（机器可推导的因由是 cause 的职责）
    const keep2 = seed(dao, { summary: 'third distinct entry', content: 'third body' });
    const drop2 = seed(dao, { summary: 'fourth distinct entry', content: 'fourth body' });
    dao.absorb(keep2, drop2);
    expect(dao.versions(keep2).at(-1)!.reason).toBeNull();
  });

  it('批 ev-1：decay 判据描述入链；缺省 NULL', () => {
    const dao = openDao();
    const id = seed(dao, { confidence: 0.8 });
    dao.decay(id, 0.7, '30 天零引用老化降权');
    const v = dao.versions(id).at(-1)!;
    expect(v.cause).toBe('decay');
    expect(v.reason).toBe('30 天零引用老化降权');
    const id2 = seed(dao, { summary: 'another distinct entry', content: 'another body' });
    dao.decay(id2, 0.7);
    expect(dao.versions(id2).at(-1)!.reason).toBeNull();
  });
});

describe('DAO decay（降权物化——06 §5 落码定形注）', () => {
  it('confidence × factor 物化 + 版本 cause=decay + 不刷 updated_at（防洗新出老化候选集）', () => {
    const dao = openDao();
    const id = seed(dao, { confidence: 0.8 });
    const before = dao.get(id)!.updatedAt;
    nowMs += 7 * DAY;
    const row = dao.decay(id, 0.7);
    expect(row.confidence).toBeCloseTo(0.56, 10);
    expect(row.updatedAt).toBe(before); // 不刷
    expect(dao.versions(id).at(-1)!.cause).toBe('decay');
    expect(dao.versions(id).at(-1)!.confidence).toBeCloseTo(0.56, 10);
  });

  it('factor 越界/非有限拒；frozen 拒；非在册拒', () => {
    const dao = openDao();
    const id = seed(dao);
    const invalid = expect.objectContaining({ code: 'MEMORY_ENTRY_INVALID' });
    expect(() => dao.decay(id, 0)).toThrowError(invalid);
    expect(() => dao.decay(id, 1.5)).toThrowError(invalid);
    expect(() => dao.decay(id, Number.NaN)).toThrowError(invalid);
    dao.freeze(id);
    expect(() => dao.decay(id, 0.7)).toThrowError(expect.objectContaining({ code: 'MEMORY_FROZEN' }));
    dao.unfreeze(id);
    dao.forget(id);
    expect(() => dao.decay(id, 0.7)).toThrowError(invalid);
  });
});

describe('DAO sweepExpired（双清同拍单事务——TTL 物化 + 访问日志窗口清扫）', () => {
  it('过期行物化 status=expired + superseded_by=ttl；不动 updated_at 不追加版本；幂等', () => {
    const dao = openDao();
    const id = seed(dao, { ttlDays: 7 });
    nowMs += 8 * DAY;
    expect(dao.listVisible()).toHaveLength(0); // TTL 谓词先行遮蔽
    expect(dao.get(id)!.status).toBe('active'); // 未物化
    const versionsBefore = dao.versions(id).length;
    const updatedAtBefore = dao.get(id)!.updatedAt;
    expect(dao.sweepExpired().expired).toBe(1);
    const row = dao.get(id)!;
    expect(row.status).toBe('expired');
    expect(row.supersededBy).toBe('ttl');
    expect(row.updatedAt).toBe(updatedAtBefore); // 不动
    expect(dao.versions(id)).toHaveLength(versionsBefore); // 不追加
    expect(dao.sweepExpired().expired).toBe(0); // 幂等
  });

  it('frozen 过期行免物化（冻结免 TTL 全档）', () => {
    const dao = openDao();
    const id = seed(dao, { ttlDays: 7 });
    dao.freeze(id);
    nowMs += 8 * DAY;
    expect(dao.sweepExpired().expired).toBe(0);
    expect(dao.get(id)!.status).toBe('active');
    expect(dao.listVisible()).toHaveLength(1); // frozen 谓词腿仍可见
  });

  it('访问日志 90 天滚动窗口同拍清扫：老流水删、新流水留、聚合列不回退', () => {
    const dao = openDao();
    const oldId = seed(dao, { summary: 'old cited lesson', content: 'old cited lesson body' });
    const newId = seed(dao, { summary: 'new cited lesson', content: 'new cited lesson body' });
    dao.markUsed([oldId, newId], 's1'); // 两行 cite 流水 ts = nowMs
    // 制造老流水：oldId 流水行回拨 91 天（窗口外一刻——ts <= now - 90d 即删）
    sql('UPDATE memory_access SET ts = ? WHERE memory_id = ?', nowMs - 91 * DAY, oldId);
    expect(dao.accessLog().flow).toHaveLength(2); // 前置——双行在场
    const swept = dao.sweepExpired();
    expect(swept).toEqual({ expired: 0, accessPruned: 1 }); // 双清同拍——TTL 面零行 + 流水面一行
    const flow = dao.accessLog().flow;
    expect(flow).toHaveLength(1);
    expect(flow[0]).toMatchObject({ memoryId: newId }); // 新流水留
    expect(dao.get(oldId)!.usageCount).toBe(1); // 聚合列不随清扫回退（流水是可丢弃审计面）
  });
});

describe('consolidation 编排（护栏四件 + 候选集三源）', () => {
  /** 老化前置：直改 updated_at 到 N 天前 */
  function makeStale(id: string, days: number): void {
    sql('UPDATE memories SET updated_at = ? WHERE id = ?', nowMs - days * DAY, id);
  }

  it('候选集三源：老化 ∪ 溢出最低分盈余 ∪ polluted 批；frozen 排除；跨源去重', async () => {
    const dao = openDao();
    const staleId = seed(dao, { summary: 'stale entry about pnpm tooling', content: 'stale' });
    makeStale(staleId, 91);
    const freshId = seed(dao, { summary: 'fresh entry about vitest runner', content: 'fresh' });
    // polluted 批：refs 命中 polluted 会话
    const pollutedId = seed(dao, {
      summary: 'note sourced from polluted session',
      content: 'polluted sourced',
      sourceRefs: [{ sessionId: 'spoll', seq: 3 }],
    });
    // frozen 免整理
    const frozenId = seed(dao, { summary: 'frozen entry never consolidated', content: 'frozen' });
    dao.freeze(frozenId);
    sql('UPDATE memories SET updated_at = ? WHERE id = ?', nowMs - 91 * DAY, frozenId); // frozen 虽老化仍排除

    const { face, prompts } = llmStub({ plan: {} });
    const c = consolidator(dao, face, { staleDays: 90 });
    const r = await c.run({ pollutedSessions: ['spoll'] });
    expect(r.outcome).toBe('ran');
    expect(prompts[0]).toContain(staleId);
    expect(prompts[0]).toContain(pollutedId);
    expect(prompts[0]).not.toContain(freshId);
    expect(prompts[0]).not.toContain(frozenId);
    // 去重：staleId 只出现一次（多源命中不重复计）
    expect(prompts[0]!.split(staleId).length - 1).toBe(1);
    expect(r.candidateCount).toBe(2);
  });

  it('溢出面：owner 超容量的最低效用分盈余入候选（同把尺反向——升序取低分）', async () => {
    const dao = openDao();
    // 三条同 owner：分数由 confidence 主导（evidence/usage 同基线）
    const lowId = seed(dao, { summary: 'low value alpha note', content: 'low', confidence: 0.1 });
    const midId = seed(dao, { summary: 'mid value beta note', content: 'mid', confidence: 0.5 });
    const highId = seed(dao, { summary: 'high value gamma note', content: 'high', confidence: 0.9 });
    const { face, prompts } = llmStub({ plan: {} });
    const c = consolidator(dao, face, { capacity: 2 });
    const r = await c.run();
    expect(r.outcome).toBe('ran');
    expect(r.candidateCount).toBe(1); // 3 - 2 = 1 盈余
    expect(prompts[0]).toContain(lowId);
    expect(prompts[0]).not.toContain(midId);
    expect(prompts[0]).not.toContain(highId);
  });

  it('anchor 短路：拍间间隔不足跳过；水位短路：无新摄入跳过——自身 absorb 写不构成新摄入', async () => {
    const dao = openDao();
    const keepId = seed(dao, { summary: 'keep entry pnpm baseline', content: 'keep' });
    const dropId = seed(dao, { summary: 'drop entry pnpm mirror', content: 'drop' });
    makeStale(keepId, 91);
    makeStale(dropId, 91);
    const { face } = llmStub({
      plan: { merges: [{ action: 'merge', keep: keepId, drop: dropId, reason: 'pnpm 主题重复条目合并' }], decays: [] },
    });
    const c = consolidator(dao, face, { staleDays: 90 });
    const first = await c.run();
    expect(first.outcome).toBe('ran');
    expect(first.merged).toBe(1);
    expect(dao.get(keepId)!.evidenceCount).toBe(2); // absorb 已执行

    nowMs += 60_000; // 1min < anchor 5min
    expect((await c.run()).outcome).toBe('skipped-anchor');

    nowMs += 10 * 60_000; // 过 anchor；无新摄入（absorb 自身写 ≤ 拍终基线）
    expect((await c.run()).outcome).toBe('skipped-watermark');

    dao.ingest(candidate({ summary: 'brand new intake after consolidation', content: 'new' }));
    nowMs += 10 * 60_000;
    const third = await c.run();
    // 新摄入解锁：过 anchor + 水位闸——新行未老化不溢出故候选面空（skipped-empty
    // 只在过两闸后可达，即水位解锁的证词）
    expect(third.outcome).toBe('skipped-empty');
  });

  it('预算不足跳过本轮且不烧 anchor（同一实例——预算恢复同刻可拍）', async () => {
    const dao = openDao();
    const id = seed(dao);
    makeStale(id, 91);
    const { face, setAffordable, prompts } = llmStub({ affordable: false });
    const c = consolidator(dao, face, { staleDays: 90 });
    expect((await c.run()).outcome).toBe('skipped-budget');
    setAffordable(true); // 预算恢复——不拨钟同刻重试
    expect((await c.run()).outcome).toBe('ran');
    expect(prompts).toHaveLength(1);
  });

  it('计划执行：merge 走 absorb（drop 终态 llm:<keep>）+ decay 走物化（cause=decay）', async () => {
    const dao = openDao();
    const keepId = seed(dao, { summary: 'user prefers pnpm package manager', content: 'keep' });
    const dropId = seed(dao, { summary: 'pnpm tooling duplicate note here', content: 'drop' });
    const decayId = seed(dao, { summary: 'outdated vitest configuration memory', content: 'old' });
    for (const id of [keepId, dropId, decayId]) makeStale(id, 91);
    const { face } = llmStub({
      plan: {
        merges: [{ action: 'merge', keep: keepId, drop: dropId, reason: 'pnpm 重复条目' }],
        decays: [{ action: 'decay', id: decayId, reason: 'vitest 配置已过时' }],
      },
    });
    const c = consolidator(dao, face, { staleDays: 90 });
    const r = await c.run();
    expect(r.outcome).toBe('ran');
    expect(r.merged).toBe(1);
    expect(r.decayed).toBe(1);
    expect(dao.get(keepId)!.evidenceCount).toBe(2);
    expect(dao.get(dropId)!.supersededBy).toBe(`llm:${keepId}`);
    const decayed = dao.get(decayId)!;
    expect(decayed.confidence).toBeCloseTo(0.8 * 0.7, 10);
    expect(dao.versions(decayId).at(-1)!.cause).toBe('decay');
  });

  it('理由护栏：reason 与 keep/drop 摘要 token 零交集 → 整组驳回不执行', async () => {
    const dao = openDao();
    const aId = seed(dao, { summary: 'user prefers pnpm package manager', content: 'a' });
    const bId = seed(dao, { summary: 'repo standard vitest test runner', content: 'b' });
    makeStale(aId, 91);
    makeStale(bId, 91);
    const { face } = llmStub({
      plan: { merges: [{ action: 'merge', keep: aId, drop: bId, reason: '完全无关的两条记录删掉' }], decays: [] },
    });
    const c = consolidator(dao, face, { staleDays: 90 });
    const r = await c.run();
    expect(r.merged).toBe(0);
    expect(r.rejectedGroups).toBe(1);
    expect(dao.get(aId)!.evidenceCount).toBe(1); // 未执行
    expect(dao.get(bId)!.status).toBe('active');
  });

  it('候选集外 id 忽略（幻觉护栏）+ 拍间失活的候选存活重验跳过', async () => {
    const dao = openDao();
    const liveId = seed(dao);
    makeStale(liveId, 91);
    const goneId = seed(dao, { summary: 'dismissed before execution time', content: 'gone' });
    makeStale(goneId, 91);
    dao.forget(goneId); // 候选构建时已终态——根本不入候选集
    // 拍间冻结：complete 回调里冻结 drop——存活重验面（执行前 get 复核）
    const keepId = liveId;
    const dropId = seed(dao, { summary: 'frozen during planning pnpm note', content: 'drop' });
    makeStale(dropId, 91);
    const { face } = llmStub({
      plan: {
        merges: [
          { action: 'merge', keep: keepId, drop: 'ghost-id', reason: 'pnpm' },
          { action: 'merge', keep: keepId, drop: dropId, reason: 'pnpm 重复' },
        ],
        decays: [{ action: 'decay', id: 'ghost-id', reason: 'pnpm' }],
      },
      onCall: () => dao.freeze(dropId),
    });
    const c = consolidator(dao, face, { staleDays: 90 });
    const r = await c.run();
    expect(r.outcome).toBe('ran');
    expect(r.merged).toBe(0);
    expect(r.ignoredSuggestions).toBe(3); // ghost drop + 拍间冻结 drop + ghost decay
    expect(dao.get(dropId)!.status).toBe('active'); // 吸收未执行（冻结拒被吞）
  });
});
