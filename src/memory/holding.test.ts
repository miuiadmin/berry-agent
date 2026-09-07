/**
 * memory DAO 持有面动词与检索/访问面测试（批 18c-2——真 better-sqlite3 临时
 * 目录库跑 v4/v5/v6 迁移链；forget/restore/freeze/unfreeze/setTtl 全语义 +
 * FTS 检索过滤面 + 访问流水落账 + overview 整面；dao.test.ts 同 idiom）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { createMemoryDao, type MemoryDao } from './dao.js';
import { MEMORY_MIGRATIONS } from './migration.js';
import type { MemoryCandidate } from './types.js';

let dir: string;
let store: Store | null = null;
/** 可拨毫秒时钟 */
let nowMs: number;
let idSeq = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-memory-holding-'));
  nowMs = Date.parse('2026-09-08T08:00:00.000Z');
  idSeq = 0;
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 开库+迁移链+DAO 装配（多轮断言锚定 ingest 返回的 outcome.id——序列交错纪律同 dao.test.ts） */
function openDao(): MemoryDao {
  store = openStore({
    dbPath: join(dir, 'test.db'),
    dataDir: dir,
    secretKey: ephemeralSecretKey(),
    migrations: [...MEMORY_MIGRATIONS],
  });
  return createMemoryDao({
    db: store.sqlite(),
    now: () => nowMs,
    warn: () => {},
    newId: () => `m${++idSeq}`,
  });
}

/** 标准候选（缺省 global/preference） */
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

/** 直改列（制造 frozen/expires_at/dismissed/无版本链等前置态） */
function sql(text: string, ...params: (string | number | null)[]): void {
  store!
    .sqlite()
    .prepare(text)
    .run(...params);
}

/** memory_access 行数 */
function accessCount(): number {
  return (store!.sqlite().prepare(`SELECT count(*) AS n FROM memory_access`).get() as { n: number }).n;
}

/** FTS trigram 命中行数 */
function ftsHits(query: string): number {
  return (
    store!.sqlite().prepare(`SELECT count(*) AS n FROM memory_fts WHERE memory_fts MATCH ?`).get(query) as {
      n: number;
    }
  ).n;
}

describe('forget（软删）', () => {
  it('缺席守卫：MEMORY_NOT_FOUND', () => {
    const dao = openDao();
    expect(() => dao.forget('ghost')).toThrowError(expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }));
  });

  it('user 腿：dismissed + superseded_by=user——纯状态变更（updated_at/版本链不动）+ 读面排除', () => {
    const dao = openDao();
    const out = dao.ingest(candidate());
    const before = dao.get(out.id)!;
    nowMs += 1000;
    const row = dao.forget(out.id);
    expect(row.status).toBe('dismissed');
    expect(row.supersededBy).toBe('user');
    expect(row.updatedAt).toBe(before.updatedAt); // 纯状态变更
    expect(dao.versions(out.id)).toHaveLength(1); // 不追加版本
    expect(dao.listVisible()).toHaveLength(0);
  });

  it('promotedToSkill 搬家腿：superseded_by=skill:<名>；词法/超长拒 MEMORY_ENTRY_INVALID 且零写入', () => {
    const dao = openDao();
    const out = dao.ingest(candidate());
    const row = dao.forget(out.id, { promotedToSkill: 'pnpm-conventions' });
    expect(row.supersededBy).toBe('skill:pnpm-conventions');

    const second = dao.ingest(candidate({ summary: 'repo uses vitest', content: 'vitest' }));
    for (const bad of ['Bad_Name', '-leading', 'trailing-', 'a--double', 'x'.repeat(65)]) {
      expect(() => dao.forget(second.id, { promotedToSkill: bad })).toThrowError(
        expect.objectContaining({ code: 'MEMORY_ENTRY_INVALID' }),
      );
    }
    expect(dao.get(second.id)!.status).toBe('active'); // 零写入
  });

  it('撞 frozen：MEMORY_FROZEN——解冻-再忘唯一路径', () => {
    const dao = openDao();
    const out = dao.ingest(candidate());
    dao.freeze(out.id);
    expect(() => dao.forget(out.id)).toThrowError(expect.objectContaining({ code: 'MEMORY_FROZEN' }));
    expect(dao.get(out.id)!.status).toBe('active');
    // 解冻-再忘通
    dao.unfreeze(out.id);
    expect(dao.forget(out.id).status).toBe('dismissed');
  });
});

describe('restore（复活）', () => {
  it('缺席守卫：MEMORY_NOT_FOUND', () => {
    const dao = openDao();
    expect(() => dao.restore('ghost')).toThrowError(expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }));
  });

  it('状态复活腿：active + superseded_by 清空 + 按 ttl_days 重算续期；updated_at/版本链不动', () => {
    const dao = openDao();
    const out = dao.ingest(candidate({ ttlDays: 7 })); // expires = T0+7d
    const before = dao.get(out.id)!;
    nowMs += 3 * 86_400_000;
    dao.forget(out.id);
    nowMs += 86_400_000;
    const row = dao.restore(out.id);
    expect(row.status).toBe('active');
    expect(row.supersededBy).toBeNull();
    expect(row.expiresAt).toBe(nowMs + 7 * 86_400_000); // 复活即按 ttl_days 重算续期
    expect(row.updatedAt).toBe(before.updatedAt); // 纯状态变更
    expect(dao.versions(out.id)).toHaveLength(1);
  });

  it('内容回滚腿：以快照追加 rollback 版本并复活（evidence/confidence 回落 + FTS 投影同步）', () => {
    const dao = openDao();
    const out = dao.ingest(candidate({ confidence: 0.5 })); // v1: conf 0.5 / evidence 1
    nowMs += 1000;
    dao.ingest(candidate({ confidence: 0.9 })); // exact 合并 → v2: conf 0.9 / evidence 2
    expect(dao.get(out.id)!.evidenceCount).toBe(2);
    nowMs += 1000;
    const row = dao.restore(out.id, 1); // 回滚到 v1
    expect(row.evidenceCount).toBe(1);
    expect(row.confidence).toBe(0.5);
    expect(row.status).toBe('active');
    expect(row.updatedAt).toBe(nowMs); // 内容面变更刷新
    const vs = dao.versions(out.id);
    expect(vs).toHaveLength(3);
    expect(vs[2]).toMatchObject({ revision: 3, cause: 'rollback', evidenceCount: 1, confidence: 0.5 });
    expect(ftsHits('pnpm')).toBe(1); // 投影同步——回滚后仍可命中
  });

  it('revision 越界 / 无链条目带版本：MEMORY_REVISION_NOT_FOUND', () => {
    const dao = openDao();
    const out = dao.ingest(candidate());
    expect(() => dao.restore(out.id, 9)).toThrowError(expect.objectContaining({ code: 'MEMORY_REVISION_NOT_FOUND' }));
    sql(`DELETE FROM memory_versions WHERE memory_id = ?`, out.id); // 制造无链条目
    expect(() => dao.restore(out.id, 1)).toThrowError(expect.objectContaining({ code: 'MEMORY_REVISION_NOT_FOUND' }));
  });

  it('内容回滚腿撞 frozen：MEMORY_FROZEN（状态复活腿不动内容面——无此拒）', () => {
    const dao = openDao();
    const out = dao.ingest(candidate());
    dao.ingest(candidate({ confidence: 0.9 }));
    dao.freeze(out.id);
    expect(() => dao.restore(out.id, 1)).toThrowError(expect.objectContaining({ code: 'MEMORY_FROZEN' }));
    // 纯状态复活腿在 frozen 行上不动内容——不拒
    expect(dao.restore(out.id).frozen).toBe(true);
  });

  it('复活唯 restore：过期行经 restore 复活（setTtl 不复活的对称面）', () => {
    const dao = openDao();
    const out = dao.ingest(candidate({ ttlDays: 1 }));
    nowMs += 2 * 86_400_000; // 已过期
    expect(dao.listVisible()).toHaveLength(0);
    const row = dao.restore(out.id); // 状态复活 + 按 ttl_days 重算续期
    expect(row.status).toBe('active');
    expect(row.expiresAt).toBe(nowMs + 86_400_000);
    expect(dao.listVisible()).toHaveLength(1);
  });
});

describe('freeze / unfreeze', () => {
  it('冻结幂等 + frozen 压倒 TTL 仍可见 + 不动 updated_at（不污染老化锚）', () => {
    const dao = openDao();
    const out = dao.ingest(candidate({ ttlDays: 1 }));
    const before = dao.get(out.id)!;
    nowMs += 2 * 86_400_000; // 已过期
    dao.freeze(out.id);
    dao.freeze(out.id); // 幂等
    const row = dao.get(out.id)!;
    expect(row.frozen).toBe(true);
    expect(row.updatedAt).toBe(before.updatedAt);
    expect(dao.listVisible()).toHaveLength(1); // frozen 压倒 TTL
  });

  it('unfreeze 幂等 + 按 ttl_days 重算钟（冻结期不计时——重算非续算）；无 ttl → 不过期', () => {
    const dao = openDao();
    const withTtl = dao.ingest(candidate({ ttlDays: 7 }));
    const forever = dao.ingest(candidate({ summary: 'repo uses vitest', content: 'vitest' }));
    nowMs += 10 * 86_400_000;
    dao.freeze(withTtl.id);
    dao.freeze(forever.id);
    nowMs += 5 * 86_400_000;
    const row = dao.unfreeze(withTtl.id); // 重算 = now + 7d（非原钟顺延）
    expect(row.frozen).toBe(false);
    expect(row.expiresAt).toBe(nowMs + 7 * 86_400_000);
    expect(dao.unfreeze(withTtl.id).frozen).toBe(false); // 幂等
    expect(dao.unfreeze(forever.id).expiresAt).toBeNull();
  });

  it('缺席守卫：MEMORY_NOT_FOUND', () => {
    const dao = openDao();
    expect(() => dao.freeze('ghost')).toThrowError(expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }));
    expect(() => dao.unfreeze('ghost')).toThrowError(expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }));
  });
});

describe('setTtl（清/设留存）', () => {
  it('设天：ttl_days + expires_at 即时重算', () => {
    const dao = openDao();
    const out = dao.ingest(candidate());
    const row = dao.setTtl(out.id, 30);
    expect(row.ttlDays).toBe(30);
    expect(row.expiresAt).toBe(nowMs + 30 * 86_400_000);
  });

  it('null 转永久：两列清空', () => {
    const dao = openDao();
    const out = dao.ingest(candidate({ ttlDays: 30 }));
    const row = dao.setTtl(out.id, null);
    expect(row.ttlDays).toBeNull();
    expect(row.expiresAt).toBeNull();
  });

  it('坏形（0/负/小数）与缺席守卫', () => {
    const dao = openDao();
    const out = dao.ingest(candidate());
    for (const bad of [0, -5, 1.5]) {
      expect(() => dao.setTtl(out.id, bad)).toThrowError(expect.objectContaining({ code: 'MEMORY_ENTRY_INVALID' }));
    }
    expect(() => dao.setTtl('ghost', 5)).toThrowError(expect.objectContaining({ code: 'MEMORY_NOT_FOUND' }));
  });

  it('撞 frozen：MEMORY_FROZEN', () => {
    const dao = openDao();
    const out = dao.ingest(candidate());
    dao.freeze(out.id);
    expect(() => dao.setTtl(out.id, 30)).toThrowError(expect.objectContaining({ code: 'MEMORY_FROZEN' }));
  });

  it('已过期行仅改未来策略不复活：expires_at 不动 + 读面仍排除（复活唯 restore）', () => {
    const dao = openDao();
    const out = dao.ingest(candidate({ ttlDays: 1 }));
    const stale = dao.get(out.id)!.expiresAt!;
    nowMs += 2 * 86_400_000; // 已过期
    const row = dao.setTtl(out.id, 30);
    expect(row.ttlDays).toBe(30); // 策略面已改
    expect(row.expiresAt).toBe(stale); // 钟不动——不因改策略复活
    expect(dao.listVisible()).toHaveLength(0);
  });
});

describe('search（FTS 检索记忆库腿）', () => {
  it('命中 + 落账：access 行 op=search、session_id 恒 NULL', () => {
    const dao = openDao();
    const a = dao.ingest(candidate());
    dao.ingest(candidate({ summary: 'repo uses vitest for unit tests', content: 'vitest fast' }));
    const hits = dao.search('pnpm');
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ id: a.id, kind: 'preference' });
    expect(hits[0]!.summary).toContain('pnpm');
    expect(hits[0]!.score).toBeLessThan(0); // bm25 负值——越小越相关
    expect(accessCount()).toBe(1); // 命中流水落账
    const flow = dao.accessLog().flow;
    expect(flow[0]).toMatchObject({ memoryId: a.id, op: 'search', sessionId: null });
  });

  it('TTL/dismissed/owner/kind 过滤面', () => {
    const dao = openDao();
    const a = dao.ingest(candidate());
    const fact = dao.ingest(candidate({ kind: 'fact', summary: 'pnpm is a package manager', content: 'pnpm' }));
    // 过期排除（frozen 压倒 TTL 的对称面——非冻结过期行出局）
    sql(`UPDATE memories SET expires_at = ? WHERE id = ?`, nowMs - 1, a.id);
    // owner 过滤（project 域条目不进 global 域检索）
    const proj = dao.ingest(
      candidate({ ownerKey: 'project:abcd1234abcd1234', summary: 'pnpm workspace rules', content: 'pnpm' }),
    );
    // 缺省 = 不带 owner 过滤（DAO 面；工具面由工厂注入 ownerKeys 并集）
    expect(
      dao
        .search('pnpm')
        .map((h) => h.id)
        .sort(),
    ).toEqual([fact.id, proj.id].sort());
    expect(dao.search('pnpm', { ownerKeys: ['global'] }).map((h) => h.id)).toEqual([fact.id]);
    expect(dao.search('pnpm', { ownerKeys: ['project:abcd1234abcd1234'] })).toHaveLength(1);
    // kind 过滤：global 域 preference 面（唯一条目已过期）→ 零命中
    expect(dao.search('pnpm', { ownerKeys: ['global'], kind: 'preference' })).toEqual([]);
  });

  it('短语包裹：FTS 运算符不生效 + 空白/引号查询零命中零落账', () => {
    const dao = openDao();
    dao.ingest(candidate());
    dao.ingest(candidate({ summary: 'repo uses vitest for unit tests', content: 'vitest fast' }));
    // 运算符注入面：'pnpm OR vitest' 被整体当短语——无条目含该子串
    expect(dao.search('pnpm OR vitest')).toHaveLength(0);
    expect(dao.search('  ')).toEqual([]);
    expect(dao.search('"pnpm"')).toHaveLength(1); // 引号剥除后仍命中本体
    expect(accessCount()).toBe(1); // 仅一次命中落账
    // trigram 最小面：两字符词天然零命中（不报错）
    expect(dao.search('ab')).toHaveLength(0);
  });

  it('limit 钳制（1..50）', () => {
    const dao = openDao();
    dao.ingest(candidate());
    dao.ingest(candidate({ summary: 'pnpm workspace rules here', content: 'pnpm' }));
    expect(dao.search('pnpm', { limit: 1 })).toHaveLength(1);
    expect(dao.search('pnpm', { limit: 999 })).toHaveLength(2); // 钳到 50 不截真命中
  });
});

describe('overview（memory_read 无 id 腿）', () => {
  it('frozen 恒驻在前 + 效用综合分降序 + recent + 健康面', () => {
    const dao = openDao();
    const a = dao.ingest(candidate({ confidence: 0.5 })); // 低分
    nowMs += 1000; // 钟差锚定 recent 序（免 updated_at 平局不定序）
    const b = dao.ingest(candidate({ summary: 'repo uses vitest for unit tests', content: 'vitest' }));
    dao.freeze(a.id); // frozen 恒简报（不动 updated_at——不污染 recent 序）
    sql(`UPDATE memories SET usage_count = 3 WHERE id = ?`, b.id); // 高效用
    const o = dao.overview();
    expect(o.core.map((r) => r.id)).toEqual([a.id, b.id]); // frozen 在前、非冻结按效用分降序
    expect(o.recent[0]!.id).toBe(b.id); // updated_at DESC（b 后摄入）
    expect(o.health).toMatchObject({ active: 2, dismissed: 0, expired: 0, frozen: 1, total: 2 });
    // dismiss 一条 → 健康面即时跟随（b 未冻结——forget 合法）
    dao.forget(b.id);
    expect(dao.overview().health).toMatchObject({ active: 1, dismissed: 1, total: 2 });
  });

  it('owner 过滤（core/recent 限定 owner 并集；健康面全库）', () => {
    const dao = openDao();
    dao.ingest(candidate());
    dao.ingest(
      candidate({
        ownerKey: 'project:abcd1234abcd1234',
        summary: 'repo uses vitest for unit tests',
        content: 'vitest',
      }),
    );
    const o = dao.overview(['global']);
    expect(o.core).toHaveLength(1);
    expect(o.core[0]!.ownerKey).toBe('global');
    expect(o.health.total).toBe(2); // 健康面全库不分 owner 假精度
  });
});

describe('accessLog（聚合 + 流水双面）', () => {
  it('前缀/op/时间窗过滤 + 聚合 top-N + 流水 ts 降序', () => {
    const dao = openDao();
    const a = dao.ingest(candidate());
    const b = dao.ingest(candidate({ summary: 'repo uses vitest for unit tests', content: 'vitest fast' }));
    nowMs += 1000;
    dao.search('pnpm'); // a 命中 1 次
    nowMs += 1000;
    dao.search('vitest'); // b 命中 1 次
    nowMs += 1000;
    dao.search('vitest'); // b 再 1 次
    const full = dao.accessLog();
    expect(full.flow.map((f) => f.memoryId)).toEqual([b.id, b.id, a.id]); // ts 降序
    expect(full.aggregates[0]).toMatchObject({ memoryId: b.id, search: 2, cite: 0, total: 2 });
    expect(full.aggregates[1]).toMatchObject({ memoryId: a.id, total: 1 });
    // 前缀过滤
    expect(dao.accessLog({ memoryIdPrefix: a.id.slice(0, 4) }).flow).toHaveLength(1);
    // op 过滤零命中
    expect(dao.accessLog({ op: 'cite' }).flow).toHaveLength(0);
    // 时间窗（只含最后一次 search 之后）
    expect(dao.accessLog({ from: nowMs }).flow).toHaveLength(1);
  });

  it('空库零行：双面空（不炸）', () => {
    const dao = openDao();
    const r = dao.accessLog();
    expect(r.aggregates).toEqual([]);
    expect(r.flow).toEqual([]);
  });
});
