/**
 * memory DAO 全环测试（批 18c-1——真 better-sqlite3 临时目录库跑 v4/v5/v6
 * 迁移链；入库单点执法〔secret 扫描/坏形校验〕+ 三分支落库语义 + TTL 读面
 * 谓词 + 版本链拍照 + FTS 投影同步——goal/service.test.ts 同 idiom）。
 *
 * 持有面动词（pin/freeze/setTtl）18c-8 才落码——本批前置态（frozen/
 * expires_at/dismissed）一律 SQL 直改制造，读面谓词由此可单测。
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../../src/persist/index.js';
import { createMemoryDao, uuidv7, type MemoryDao } from './dao.js';
import { MEMORY_MIGRATIONS } from './migration.js';
import type { MemoryCandidate, MemoryExportRow } from './types.js';

let dir: string;
let store: Store | null = null;
/** 可拨毫秒时钟 */
let nowMs: number;
let idSeq = 0;
const warn = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-memory-test-'));
  nowMs = Date.parse('2026-09-08T08:00:00.000Z');
  idSeq = 0;
  warn.mockClear();
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 开库+迁移链+DAO 装配（newId 固定序列——条目行与版本行共用同一序列，id
 * 交错递增；故多轮断言一律锚定 ingest 返回的 outcome.id 而非硬编码序号） */
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
    warn,
    newId: () => `m${++idSeq}`,
  });
}

/** 标准候选（缺省 global/preference——override 面覆盖各形） */
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

/** 直改列（测试专用——制造 frozen/expires_at/dismissed 前置态） */
function sql(text: string, ...params: (string | number)[]): void {
  store!
    .sqlite()
    .prepare(text)
    .run(...params);
}

/** 表行数 */
function count(table: 'memories' | 'memory_versions' | 'memory_fts' | 'memory_access'): number {
  return (store!.sqlite().prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
}

/** FTS trigram 命中行数（查询 token ≥3 字符——trigram 最小面） */
function ftsHits(query: string): number {
  return (
    store!.sqlite().prepare(`SELECT count(*) AS n FROM memory_fts WHERE memory_fts MATCH ?`).get(query) as {
      n: number;
    }
  ).n;
}

describe('迁移链（五槽顺跑）', () => {
  it('user_version=11、表族四件在场（批 ev-1 v11 只 ALTER 不建表——valid_from/reason 落列）', () => {
    openDao();
    const db = store!.sqlite();
    expect(db.pragma('user_version', { simple: true })).toBe(11);
    const names = new Set(
      (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]).map(
        (r) => r.name,
      ),
    );
    for (const t of ['memories', 'memory_fts', 'memory_versions', 'memory_access']) {
      expect(names.has(t)).toBe(true);
    }
  });
});

describe('入库与三分支落库', () => {
  it('独立插入：行形状 + 首版版本链 + FTS 投影同步', () => {
    const dao = openDao();
    const out = dao.ingest(candidate());
    expect(out).toEqual({ action: 'inserted', id: 'm1' });
    expect(dao.get('m1')).toMatchObject({
      ownerKey: 'global',
      kind: 'preference',
      status: 'active',
      supersededBy: null,
      evidenceCount: 1,
      frozen: false,
      ttlDays: null,
      expiresAt: null,
      createdAt: nowMs,
      updatedAt: nowMs,
      sourceRefs: [{ sessionId: 's1', seq: 1 }],
    });
    const vs = dao.versions('m1');
    expect(vs).toHaveLength(1);
    expect(vs[0]).toMatchObject({ revision: 1, cause: 'insert', evidenceCount: 1, confidence: 0.8 });
    expect(ftsHits('pnpm')).toBe(1);
  });

  it('exact 合并：evidence/confidence/refs/updated_at + 版本 merge；FTS 投影零触达（文本面未变）', () => {
    const dao = openDao();
    dao.ingest(candidate({ confidence: 0.5, sourceRefs: [{ sessionId: 's1', seq: 1 }] }));
    nowMs += 5000;
    const out = dao.ingest(
      candidate({
        summary: 'User prefers PNPM for package management',
        confidence: 0.8,
        sourceRefs: [{ sessionId: 's2', seq: 9 }],
      }),
    );
    expect(out).toEqual({ action: 'merged-exact', id: 'm1' });
    const row = dao.get('m1')!;
    expect(row.evidenceCount).toBe(2);
    expect(row.confidence).toBe(0.8); // 合并取 max
    expect(row.updatedAt).toBe(nowMs);
    expect(row.sourceRefs).toEqual([
      { sessionId: 's1', seq: 1 },
      { sessionId: 's2', seq: 9 },
    ]);
    const vs = dao.versions('m1');
    expect(vs).toHaveLength(2);
    expect(vs[1]).toMatchObject({ revision: 2, cause: 'merge', evidenceCount: 2, confidence: 0.8 });
    expect(count('memories')).toBe(1);
    expect(ftsHits('pnpm')).toBe(1);
  });

  it('fuzzy 合并（Jaccard ≥0.74 变体）：同律吸收', () => {
    const dao = openDao();
    const a = 'user prefers dark mode in editor windows';
    const b = 'user prefers dark mode in editor and windows';
    dao.ingest(candidate({ summary: a, content: a, confidence: 0.6, sourceRefs: [{ sessionId: 's1', seq: 1 }] }));
    nowMs += 1000;
    const out = dao.ingest(
      candidate({ summary: b, content: b, confidence: 0.7, sourceRefs: [{ sessionId: 's3', seq: 2 }] }),
    );
    expect(out).toEqual({ action: 'merged-fuzzy', id: 'm1' });
    const row = dao.get('m1')!;
    expect(row.evidenceCount).toBe(2);
    expect(row.confidence).toBe(0.7);
    expect(row.sourceRefs).toEqual([
      { sessionId: 's1', seq: 1 },
      { sessionId: 's3', seq: 2 },
    ]);
    expect(count('memories')).toBe(1);
  });

  it('极性新胜：旧条纯状态变更（updated_at 不动、证据与版本链不追加）；新条继承证据与 refs（溯源不死）', () => {
    const dao = openDao();
    const first = dao.ingest(
      candidate({
        summary: '用户偏好深色主题界面',
        content: '用户偏好深色主题界面',
        confidence: 0.5,
        sourceRefs: [{ sessionId: 's1', seq: 1 }],
      }),
    );
    const before = dao.get(first.id)!;
    nowMs += 5000;
    const out = dao.ingest(
      candidate({
        summary: '用户 not 偏好深色主题界面',
        content: '用户 not 偏好深色主题界面',
        confidence: 0.9,
        sourceRefs: [{ sessionId: 's2', seq: 3 }],
      }),
    );
    expect(out.action).toBe('inserted');
    expect(out.supersededId).toBe(first.id);
    // 旧条：dismissed + auto_resolved，纯状态变更——不动 updated_at / 证据 / 版本链
    const old = dao.get(first.id)!;
    expect(old.status).toBe('dismissed');
    expect(old.supersededBy).toBe('auto_resolved');
    expect(old.updatedAt).toBe(before.updatedAt);
    expect(old.evidenceCount).toBe(1);
    expect(dao.versions(first.id)).toHaveLength(1);
    // 新条：继承双方证据计数与 refs 并集，首版 cause='insert'
    const fresh = dao.get(out.id)!;
    expect(fresh.evidenceCount).toBe(2);
    expect(fresh.confidence).toBe(0.9);
    expect(fresh.sourceRefs).toEqual([
      { sessionId: 's1', seq: 1 },
      { sessionId: 's2', seq: 3 },
    ]);
    expect(dao.versions(out.id)[0]).toMatchObject({ revision: 1, cause: 'insert', evidenceCount: 2 });
  });

  it('极性旧胜对称吸收：原位 evidence+1、refs 并集、confidence 不动、无新行', () => {
    const dao = openDao();
    dao.ingest(
      candidate({
        summary: '用户偏好深色主题界面',
        content: '用户偏好深色主题界面',
        confidence: 0.9,
        sourceRefs: [{ sessionId: 's1', seq: 1 }],
      }),
    );
    nowMs += 5000;
    const out = dao.ingest(
      candidate({
        summary: '用户 not 偏好深色主题界面',
        content: '用户 not 偏好深色主题界面',
        confidence: 0.5,
        sourceRefs: [{ sessionId: 's5', seq: 8 }],
      }),
    );
    expect(out).toEqual({ action: 'polarity-kept-existing', id: 'm1' });
    const row = dao.get('m1')!;
    expect(row.status).toBe('active'); // 旧胜不终态化
    expect(row.evidenceCount).toBe(2);
    expect(row.confidence).toBe(0.9);
    expect(row.sourceRefs).toEqual([
      { sessionId: 's1', seq: 1 },
      { sessionId: 's5', seq: 8 },
    ]);
    expect(count('memories')).toBe(1);
    expect(dao.versions('m1')[1]).toMatchObject({ revision: 2, cause: 'merge' });
  });

  it('frozen 豁免：撞冻结行作独立新条目（三分支全跳过）', () => {
    const dao = openDao();
    const first = dao.ingest(candidate());
    sql('UPDATE memories SET frozen = 1 WHERE id = ?', first.id);
    nowMs += 1000;
    const out = dao.ingest(candidate({ confidence: 0.9 }));
    expect(out.action).toBe('inserted');
    expect(out.id).not.toBe(first.id);
    expect(dao.get(first.id)!.evidenceCount).toBe(1); // 冻结行零触达
    expect(count('memories')).toBe(2);
  });

  it('TTL 过期：非合并目标 + listVisible 排除；frozen 压倒 TTL 仍可见（谓词首段）', () => {
    const dao = openDao();
    const first = dao.ingest(candidate());
    sql('UPDATE memories SET expires_at = ? WHERE id = ?', nowMs - 1, first.id);
    nowMs += 1000;
    // 过期行不是合并目标 → 候选独立成条
    const out = dao.ingest(candidate({ confidence: 0.6 }));
    expect(out.action).toBe('inserted');
    // listVisible：过期未冻结排除、新条可见
    expect(dao.listVisible().map((r) => r.id)).toEqual([out.id]);
    // 冻结压倒 TTL——冻结行即使过期仍可见
    sql('UPDATE memories SET frozen = 1 WHERE id = ?', first.id);
    expect(
      dao
        .listVisible()
        .map((r) => r.id)
        .sort(),
    ).toEqual([first.id, out.id].sort());
  });

  it('dismissed 目标不参与扫描（终态行不再吸收）', () => {
    const dao = openDao();
    const first = dao.ingest(candidate());
    sql(`UPDATE memories SET status = 'dismissed', superseded_by = 'user' WHERE id = ?`, first.id);
    const out = dao.ingest(candidate());
    expect(out.action).toBe('inserted');
    expect(out.id).not.toBe(first.id);
    expect(count('memories')).toBe(2);
  });

  it('跨 owner / 跨 kind 独立不合并（两层隔离执法）', () => {
    const dao = openDao();
    dao.ingest(candidate());
    dao.ingest(candidate({ ownerKey: 'project:abcd1234abcd1234' }));
    dao.ingest(candidate({ kind: 'fact' }));
    expect(count('memories')).toBe(3);
  });

  it('扫描序 updated_at DESC 首中（两条同 summary 均活——合并落最新行）', () => {
    const dao = openDao();
    const first = dao.ingest(candidate());
    sql('UPDATE memories SET frozen = 1 WHERE id = ?', first.id);
    nowMs += 1000;
    const second = dao.ingest(candidate()); // 冻结豁免 → 独立新行（updated_at 更新）
    sql('UPDATE memories SET frozen = 0 WHERE id = ?', first.id); // 人工解冻制造双活同文
    nowMs += 1000;
    const out = dao.ingest(candidate());
    expect(out).toEqual({ action: 'merged-exact', id: second.id });
    expect(dao.get(second.id)!.evidenceCount).toBe(2);
    expect(dao.get(first.id)!.evidenceCount).toBe(1); // 旧行零触达
  });
});

describe('入库单点执法（写前闸）', () => {
  it('secret 命中拒写：MEMORY_SECRET_DETECTED、零行写入、warn 诊断不带密钥本体（结构锁）', () => {
    const dao = openDao();
    const secret = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz0123';
    let err: unknown;
    try {
      dao.ingest(candidate({ content: `token 是 ${secret} 请记住` }));
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: 'MEMORY_SECRET_DETECTED' });
    expect(count('memories')).toBe(0);
    expect(count('memory_versions')).toBe(0);
    expect(warn).toHaveBeenCalledTimes(1);
    // 诊断只报 pattern 名与面位——疑似密钥本体不入 log-only 通道（06 §8.1 字面律）
    expect(warn.mock.calls[0]![0]).not.toContain(secret);
  });

  it('坏形拒五形：MEMORY_ENTRY_INVALID、零写入', () => {
    const dao = openDao();
    const badForms: MemoryCandidate[] = [
      candidate({ kind: 'mood' as MemoryCandidate['kind'] }), // kind 非七值闭集
      candidate({ ownerKey: 'team' }), // owner_key 两形外
      candidate({ confidence: 1.5 }), // confidence 越界 [0,1]
      candidate({ summary: '   ' }), // summary 空
      candidate({ sourceRefs: [{ sessionId: '', seq: 1 }] }), // source_refs 元素坏形
    ];
    for (const bad of badForms) {
      expect(() => dao.ingest(bad)).toThrowError(expect.objectContaining({ code: 'MEMORY_ENTRY_INVALID' }));
    }
    expect(count('memories')).toBe(0);
  });
});

describe('读面与工具', () => {
  it('listVisible owner 过滤（owner 并集读）', () => {
    const dao = openDao();
    dao.ingest(candidate());
    dao.ingest(
      candidate({
        ownerKey: 'project:abcd1234abcd1234',
        summary: 'repo uses vitest for unit tests',
        content: 'vitest',
      }),
    );
    expect(dao.listVisible()).toHaveLength(2);
    expect(dao.listVisible(['global']).map((r) => r.id)).toEqual(['m1']);
    expect(dao.listVisible(['global', 'project:abcd1234abcd1234'])).toHaveLength(2);
    expect(dao.listVisible(['project:ffffffffffffffff'])).toEqual([]);
  });

  it('独立插入 refs 帽 50（超出截断——铁律 5 溯源帽同罩）', () => {
    const dao = openDao();
    const refs = Array.from({ length: 60 }, (_, i) => ({ sessionId: 's', seq: i }));
    dao.ingest(candidate({ sourceRefs: refs }));
    expect(dao.get('m1')!.sourceRefs).toHaveLength(50);
  });

  it('rebuildFts：投影清空后全量重建（可丢弃可重建纪律）', () => {
    const dao = openDao();
    dao.ingest(candidate());
    sql(`INSERT INTO memory_fts (memory_fts) VALUES ('delete-all')`);
    expect(ftsHits('pnpm')).toBe(0);
    dao.rebuildFts();
    expect(ftsHits('pnpm')).toBe(1);
  });
});

describe('批 ev-1 valid_from 起点段（注入形/管理形两形拆分）', () => {
  const DAY = 86_400_000;

  it('种子 a：frozen=1 未生效行不入注入面三处（listVisible/overview/search）——frozen 不豁免起点段一锁双杀', () => {
    const dao = openDao();
    const id = dao.ingest(candidate({ validFrom: nowMs + 7 * DAY })).id;
    sql('UPDATE memories SET frozen = 1 WHERE id = ?', id); // frozen=1 → TTL 段恒过——红绿只取决于起点段
    expect(dao.listVisible()).toHaveLength(0); // 注入形遮蔽
    expect(dao.overview().core).toHaveLength(0); // 常驻简报同注入形
    expect(dao.overview().recent).toHaveLength(0);
    expect(dao.search('pnpm')).toHaveLength(0); // 检索腿同注入形
    // 种子 d（dao 半边）：管理形可见（/memory 活体区不过滤起点）+ 直读不过滤
    expect(dao.listVisibleForManagement().map((r) => r.id)).toEqual([id]);
    expect(dao.get(id)!.validFrom).toBe(nowMs + 7 * DAY);
    // 拨钟过起点 → 注入面浮现（到点可见——副解语义正主）
    nowMs += 8 * DAY;
    expect(dao.listVisible()).toHaveLength(1);
  });

  it('合并腿起点不漂移（m7）：keep 既有起点合并后不动；候选携带 validFrom 合并入不落', () => {
    const dao = openDao();
    // 正向：keep 未生效，新证据 exact 合并并入——起点保持（新证据并入未生效行合法）
    const keepId = dao.ingest(candidate({ validFrom: nowMs + 3 * DAY })).id;
    const out = dao.ingest(candidate({ sourceRefs: [{ sessionId: 's2', seq: 9 }] }));
    expect(out.action).toBe('merged-exact');
    expect(out.id).toBe(keepId);
    expect(dao.get(keepId)!.validFrom).toBe(nowMs + 3 * DAY); // 起点不漂移
    expect(dao.listVisible()).toHaveLength(0); // 合并不改变注入面不可见性
    // 反向：keep 无起点，候选带未来 validFrom 合并——起点不采纳（仅独立插入腿生效）
    const keep2 = dao.ingest(candidate({ summary: 'repo uses npm mirrors', content: 'npm mirrors body' })).id;
    const out2 = dao.ingest(
      candidate({ summary: 'repo uses npm mirrors', content: 'npm mirrors body', validFrom: nowMs + 3 * DAY }),
    );
    expect(out2.action).toBe('merged-exact');
    expect(out2.id).toBe(keep2);
    expect(dao.get(keep2)!.validFrom).toBeNull();
  });

  it('TTL×起点组合：钟先到 sweep 照物化（正交推论——TTL 钟不因未生效暂停）', () => {
    const dao = openDao();
    const id = dao.ingest(candidate({ validFrom: nowMs + 30 * DAY, ttlDays: 1 })).id;
    nowMs += 2 * DAY; // TTL 钟已过、起点尚远
    const swept = dao.sweepExpired();
    expect(swept.expired).toBe(1);
    expect(dao.get(id)!.status).toBe('expired');
    expect(dao.get(id)!.supersededBy).toBe('ttl');
  });
});

describe('批 ev-1 lineage 谱系查询（三链一读）', () => {
  it('absorb 后：keep 前身链含 drop；drop 后继解析为 keep 行（llm:<id> 可导航形）+ reason 入链', () => {
    const dao = openDao();
    const keepId = dao.ingest(candidate()).id;
    const dropId = dao.ingest(candidate({ summary: 'repo uses npm mirrors', content: 'npm mirrors' })).id;
    dao.absorb(keepId, dropId, '主题一致的重复条目');
    const keepLin = dao.lineage(keepId);
    expect(keepLin.row.id).toBe(keepId);
    expect(keepLin.predecessors.map((p) => p.id)).toEqual([dropId]); // 前身反查 superseded_by='llm:<keep>'
    expect(keepLin.versions.at(-1)!.cause).toBe('merge');
    expect(keepLin.versions.at(-1)!.reason).toBe('主题一致的重复条目'); // 种子 c（dao 侧）
    const dropLin = dao.lineage(dropId);
    expect('id' in dropLin.successor! ? dropLin.successor.id : null).toBe(keepId); // 可导航 successor
  });

  it('后继三形：在册 null / skill·user 字面量 marker / llm 链断回退 marker（诚实呈现不伪造）', () => {
    const dao = openDao();
    const active = dao.ingest(candidate()).id;
    expect(dao.lineage(active).successor).toBeNull(); // 在册行无后继
    const skilled = dao.ingest(candidate({ summary: 'skill entry summary', content: 'skill body' })).id;
    dao.forget(skilled, { promotedToSkill: 'pnpm-rules' });
    expect(dao.lineage(skilled).successor).toEqual({ marker: 'skill:pnpm-rules' }); // 指路形
    const userGone = dao.ingest(candidate({ summary: 'user removed entry', content: 'gone body' })).id;
    dao.forget(userGone);
    expect(dao.lineage(userGone).successor).toEqual({ marker: 'user' }); // 字面量形
    // 链断：llm: 指向缺席行 → 原记号 marker 呈现（不静默吞、不伪造目标）
    const orphan = dao.ingest(candidate({ summary: 'orphan successor entry', content: 'orphan body' })).id;
    sql(`UPDATE memories SET status = 'dismissed', superseded_by = ? WHERE id = ?`, 'llm:m_absent', orphan);
    expect(dao.lineage(orphan).successor).toEqual({ marker: 'llm:m_absent' });
  });
});

describe('68 轮件 E 版本链两闸（写前扫描辖 versions 嵌套列 + 回滚腿兜闸）', () => {
  /** 导入行构造件（缺省现行面干净形） */
  function exportRow(overrides: Partial<MemoryExportRow> = {}): MemoryExportRow {
    return {
      id: 'm-import-1',
      owner_key: 'global',
      kind: 'preference',
      summary: 'imported clean summary',
      content: 'imported clean content',
      confidence: 0.8,
      evidence_count: 1,
      status: 'active',
      superseded_by: null,
      source_refs: [],
      created_at: nowMs,
      updated_at: nowMs,
      usage_count: 0,
      last_used_at: null,
      frozen: false,
      ttl_days: null,
      expires_at: null,
      ...overrides,
    };
  }

  it('红锁A：随包版本链行 summary 含密钥样串 → 导入整行拒 MEMORY_SECRET_DETECTED（修前嵌套链行零扫描直插）', () => {
    const dao = openDao();
    const secret = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz0123';
    let err: unknown;
    try {
      dao.importInsert(
        exportRow({
          versions: [
            {
              id: 'mv-import-1',
              revision: 1,
              cause: 'insert',
              reason: null,
              owner_key: 'global',
              kind: 'preference',
              summary: `token 是 ${secret}`,
              content: 'legacy clean body',
              confidence: 0.8,
              evidence_count: 1,
              created_at: nowMs,
            },
          ],
        }),
      );
    } catch (e) {
      err = e;
    }
    expect(err).toMatchObject({ code: 'MEMORY_SECRET_DETECTED' });
    // 整行拒写（事务回滚）——主表与版本链零落库
    expect(count('memories')).toBe(0);
    expect(count('memory_versions')).toBe(0);
    // warn 诊断不带密钥本体（log-only 通道说面不说值——与现行面同律）
    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.flat().join('\n')).not.toContain(secret);
  });

  it('对照正锁：干净随包链照常导入重建（链行原值直搬零受影响）', () => {
    const dao = openDao();
    const ok = dao.importInsert(
      exportRow({
        versions: [
          {
            id: 'mv-ok-1',
            revision: 1,
            cause: 'insert',
            reason: null,
            owner_key: 'global',
            kind: 'preference',
            summary: 'clean chain summary',
            content: 'clean chain body',
            confidence: 0.8,
            evidence_count: 1,
            created_at: nowMs,
          },
        ],
      }),
    );
    expect(ok).toBe(true);
    expect(dao.versions('m-import-1')).toHaveLength(1);
  });

  it('红锁B：存量遗留未扫链行回滚 → 拒 MEMORY_SECRET_DETECTED（修前版本内容直升现行面 + FTS 投影）', () => {
    const dao = openDao();
    const out = dao.ingest(candidate()); // v1 干净（现行面干净）
    const secret = 'ghp_0123456789abcdefghijklmnopqrstuvwxyz0123';
    // 直改 SQL 预置未扫版本行（模拟件 E①闸上线前的存量遗留链行）
    sql(
      `INSERT INTO memory_versions (id, memory_id, revision, owner_key, kind, summary, content,
                                    confidence, evidence_count, cause, reason, created_at)
       VALUES (?, ?, 2, 'global', 'preference', ?, 'legacy body', 0.8, 1, 'merge', NULL, ?)`,
      'mv-legacy-2',
      out.id,
      `token 是 ${secret}`,
      nowMs,
    );
    expect(() => dao.restore(out.id, 2)).toThrowError(expect.objectContaining({ code: 'MEMORY_SECRET_DETECTED' }));
    // 回滚被拒——现行面未被密钥串覆写、FTS 投影未写入
    expect(dao.get(out.id)!.summary).toBe('user prefers pnpm for package management');
    expect(ftsHits('token')).toBe(0);
  });

  it('对照正锁：干净链行回滚照常（回滚腿兜闸不吞正常恢复面）', () => {
    const dao = openDao();
    const out = dao.ingest(candidate({ confidence: 0.5 }));
    nowMs += 1000;
    dao.ingest(candidate({ confidence: 0.9 })); // exact 合并 → v2
    nowMs += 1000;
    const row = dao.restore(out.id, 1); // 回滚到干净 v1
    expect(row.confidence).toBe(0.5);
  });
});

describe('uuidv7（时间有序主键——手卷标准位布局）', () => {
  it('形状：ver 7 + variant 10xx + 48-bit 毫秒时间位', () => {
    const id = uuidv7(1_700_000_000_000);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    // 首 12 hex 位（去连字符）= 48-bit 毫秒时间戳
    expect(parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(1_700_000_000_000);
  });

  it('同毫秒两次生成互异（随机位区分）', () => {
    expect(uuidv7(1_700_000_000_000)).not.toBe(uuidv7(1_700_000_000_000));
  });
});

describe('真库双连接写锁窗（05 §6.6 写事务首语句写优先律——读先写后事务恒 immediate）', () => {
  /**
   * 子进程持写锁脚本（plain node + require——只碰物理层依赖无需 tsx；
   * store.test.ts 71 轮「双连接写锁窗」同款形）。行协议：BEGIN IMMEDIATE +
   * 真写一行（CLI 零装配写者形）→ stdout 打 LOCKED → 持锁 holdMs 毫秒后
   * COMMIT 退出——父进程据此在「写锁确已被他进程持有」的窗口内发起同步竞争写
   * （better-sqlite3 同步 API 下持锁方的释锁只能来自真跨进程连接）。
   */
  const WRITE_HOLDER_SCRIPT = `
    const Database = require('better-sqlite3');
    const db = new Database(process.argv[1]);
    db.pragma('busy_timeout = 5000');
    db.exec('BEGIN IMMEDIATE');
    db.prepare(
      "INSERT INTO memory_access (id, memory_id, op, session_id, ts) VALUES ('lock-probe', 'none', 'cite', NULL, 0)",
    ).run();
    console.log('LOCKED');
    setTimeout(() => { db.exec('COMMIT'); db.close(); }, Number(process.argv[2]));
  `;

  const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

  /** 等子进程 stdout 出现指定词（持锁确认后才发竞争写——否则测的是无锁直过） */
  function waitMarker(child: ChildProcess, marker: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let seen = false;
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        if (chunk.includes(marker)) {
          seen = true;
          resolve();
        }
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (!seen) reject(new Error(`持锁子进程未打标先退（code=${code}）`));
      });
    });
  }

  it('锁释后续接落账：他进程持写锁窗内提交后，ingest 在写锁获取位等锁、锁释后新快照落账（修前 deferred 读先写后升级位立即 BUSY 即红）', async () => {
    const dao = openDao();
    // 蓄底一行（不同 kind——竞争写走独立插入腿，合并扫描互不并轨）
    dao.ingest(candidate({ kind: 'fact', summary: 'seed fact row', content: 'seed fact row body' }));
    const path = join(dir, 'test.db');
    const child = spawn(process.execPath, ['-e', WRITE_HOLDER_SCRIPT, path, '700'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      await waitMarker(child, 'LOCKED');
      const t0 = Date.now();
      // 竞争写：immediate 形在事务顶 BEGIN IMMEDIATE 获取写锁——busy_timeout 在
      // 获取位生效（等持锁窗）→ 子进程 COMMIT 释锁后以新快照续接落账成功
      const out = dao.ingest(candidate());
      const waited = Date.now() - t0;
      // 真等了持锁窗（≥400ms 宽松下界 vs 700ms 持锁——非无锁直过假绿）
      expect(waited).toBeGreaterThanOrEqual(400);
      expect(out.action).toBe('inserted');
      expect(count('memories')).toBe(2);
      // 子进程写者那行随其 COMMIT 落库可见（新快照含他进程已提交面）
      expect(count('memory_access')).toBe(1);
    } finally {
      child.kill();
    }
  });

  it('busy_timeout 真等待：他进程持写锁跨过 busy_timeout（短窗 300ms）→ ingest 等满窗口后以 busy 形抛错（修前 deferred 升级位零等待立即抛即红）', async () => {
    const dao = openDao();
    // 短 busy_timeout（缩短测试时长；判据 = 真等满窗口，非消息形——实测
    // deferred 升级位立即 BUSY 与 immediate 等满后 BUSY 两形消息同为
    // "database is locked" 不可区分，耗时下界是唯一稳定判据）
    store!.sqlite().pragma('busy_timeout = 300');
    const path = join(dir, 'test.db');
    const child = spawn(process.execPath, ['-e', WRITE_HOLDER_SCRIPT, path, '10000'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      await waitMarker(child, 'LOCKED');
      const t0 = Date.now();
      let err: unknown = null;
      try {
        dao.ingest(candidate());
      } catch (e) {
        err = e;
      }
      const waited = Date.now() - t0;
      // 等满 busy_timeout 后 busy 形抛（消息与 deferred 立即 BUSY 同形——判据在耗时）
      expect(err).toBeTruthy();
      expect(String((err as { message?: string }).message)).toContain('database is locked');
      // 真等了窗口（≥150ms 宽松下界 vs 300ms 窗——修前 deferred 读先写后升级位
      // 不走 busy_handler 立即返回、耗时近零，此断言即红锚）
      expect(waited).toBeGreaterThanOrEqual(150);
    } finally {
      child.kill();
    }
  });
});
