/**
 * memory 表族 DAO（06 §3/§5/§8.1——入库单点 + 合并三分支落库 + 版本链拍照；
 * 批 18c-1）。
 *
 * **入库单点**（06 §8.1——一切写路径的物理汇入面）：§4 即时路提取（经合并
 * 管线）、§4 周期路候选（经合并管线）、memory_write 直写、导入直插四写点
 * 汇入 `ingest()` 同一入口——写前 secret 扫描与坏形校验在此单点执法，没有
 * 绕过的写入方。插入路径唯一：候选必经三分支合并（没有绕过合并的直通道）。
 *
 * **事务纪律**：ingest 全程单事务（目标扫描 + 裁决 + 双写〔主表 UPDATE 与
 * 版本链 INSERT 同事务——06 §3「不许只写一边」〕）；better-sqlite3 同步 API，
 * 全件同步零 await。
 *
 * **TTL 读面谓词**（06 §3 单一来源）：一切读面统一过滤
 * `status='active' AND (frozen=1 OR expires_at IS NULL OR expires_at > now)`；
 * 合并目标扫描叠加 frozen=0（frozen 豁免三分支——候选撞冻结行作独立新条目）。
 *
 * 时钟与 id 生成注入（goal 先例同律——测试确定性）；uuid v7 手卷（时间有序
 * 主键，06 §3 DDL 注——crypto 随机位、无第三方依赖）。
 */
import { randomBytes } from 'node:crypto';
import { BaseError } from '../contracts/index.js';
import type { SqliteDatabase } from '../persist/index.js';
import { decideMerge, unionSourceRefs, utilityScore } from './merge.js';
import { scanForSecrets } from './scan.js';
import {
  MEMORY_ACCESS_AGGREGATE_TOP_N,
  MEMORY_ACCESS_LOG_DEFAULT_LIMIT,
  MEMORY_ACCESS_LOG_MAX_LIMIT,
  MEMORY_CONTENT_MAX_CHARS,
  MEMORY_DAY_MS,
  MEMORY_KINDS,
  MEMORY_RECENT_LIMIT,
  MEMORY_SEARCH_DEFAULT_LIMIT,
  MEMORY_SEARCH_MAX_LIMIT,
  MEMORY_SKILL_NAME_MAX,
  MEMORY_SKILL_NAME_RE,
  MEMORY_SOURCE_REFS_CAP,
  MEMORY_SUMMARY_MAX_CHARS,
  type IngestOutcome,
  type MemoryAccessAggregate,
  type MemoryAccessFlowRow,
  type MemoryAccessLogQuery,
  type MemoryAccessLogResult,
  type MemoryCandidate,
  type MemoryKind,
  type MemoryReadOverview,
  type MemoryRow,
  type MemorySearchHit,
  type MemorySearchOptions,
  type MemorySourceRef,
  type MemoryStatus,
  type MemoryVersionRow,
} from './types.js';

/* ---------------- uuid v7（时间有序主键——手卷，标准位布局） ---------------- */

/** uuid v7 生成（48-bit 毫秒时间戳 + ver 7 + variant 10 + 随机位） */
export function uuidv7(nowMs: number): string {
  const ts = BigInt(Math.floor(nowMs));
  const b = randomBytes(16);
  b[0] = Number((ts >> 40n) & 0xffn);
  b[1] = Number((ts >> 32n) & 0xffn);
  b[2] = Number((ts >> 24n) & 0xffn);
  b[3] = Number((ts >> 16n) & 0xffn);
  b[4] = Number((ts >> 8n) & 0xffn);
  b[5] = Number(ts & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10xx
  const hex = b.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/* ---------------- 依赖与公开面 ---------------- */

/** DAO 装配依赖（组合根注入——测试桩确定性） */
export interface MemoryDaoDeps {
  readonly db: SqliteDatabase;
  /** Unix 毫秒时钟 */
  readonly now: () => number;
  /** 日志诊断位（log-only——secret 命中拒写诊断走此面，不落 durable） */
  readonly warn: (message: string) => void;
  /** id 生成器（缺省 uuidv7(now())——测试注固定序列） */
  readonly newId?: () => string;
}

/** memory DAO 公开面（18c-1 域 = 入库单点 + 读面；18c-2 域 = 持有面动词 + 检索/访问面；周期路/晋升桥随后续批扩） */
export interface MemoryDao {
  /** 入库单点（校验 → 写前扫描 → 三分支合并/插入——单事务） */
  ingest(candidate: MemoryCandidate): IngestOutcome;
  /** 按 id 直取（不过滤——管理面用，含终态行） */
  get(id: string): MemoryRow | undefined;
  /** 可见条目清单（TTL 谓词统一过滤；ownerKeys 限定 = owner 并集读） */
  listVisible(ownerKeys?: readonly string[]): MemoryRow[];
  /** 版本链读面（revision 升序） */
  versions(memoryId: string): MemoryVersionRow[];
  /** FTS 全量重建（投影卫生面——可丢弃可重建纪律） */
  rebuildFts(): void;

  /* —— 持有面动词（06 §7——工具九件与 /memory 管理面同 DAO 单实现律） —— */

  /** 软删（status=dismissed + superseded_by='user'/'skill:<名>'；纯状态变更；frozen 拒） */
  forget(id: string, opts?: { promotedToSkill?: string }): MemoryRow;
  /** 复活（缺省 = 状态复活；带 revision = 内容回滚 + cause='rollback' 版本追加；两腿都按 ttl_days 重算续期） */
  restore(id: string, revision?: number): MemoryRow;
  /** 冻结（幂等——恒简报/免 TTL/免覆写/免整理全档开闸） */
  freeze(id: string): MemoryRow;
  /** 解冻（幂等——按 ttl_days 重算钟） */
  unfreeze(id: string): MemoryRow;
  /** 清/设留存（null = 永久；有效可见行物化重算立即生效、已过期/终态行仅改未来策略不复活；frozen 拒） */
  setTtl(id: string, days: number | null): MemoryRow;

  /* —— 检索与读面 —— */

  /** FTS 检索（记忆库腿——跨会话 union 归 18c-6；命中落 memory_access 流水：缺省 op='search'，按需检索注入路注入 op='recall' + 会话键） */
  search(query: string, opts?: MemorySearchOptions): MemorySearchHit[];
  /** memory_read 无 id 腿整面（简报取数基础版 + 最近变更 + 健康面） */
  overview(ownerKeys?: readonly string[]): MemoryReadOverview;
  /** 访问日志双面查询（聚合 top-N + 流水） */
  accessLog(query?: MemoryAccessLogQuery): MemoryAccessLogResult;
}

/* ---------------- 行映射（蛇 ↔ 驼峰单源） ---------------- */

interface MemoryDbRow {
  id: string;
  owner_key: string;
  kind: string;
  summary: string;
  content: string;
  confidence: number;
  evidence_count: number;
  status: string;
  superseded_by: string | null;
  source_refs: string;
  created_at: number;
  updated_at: number;
  usage_count: number;
  last_used_at: number | null;
  frozen: number;
  ttl_days: number | null;
  expires_at: number | null;
}

/** memories 查列清单（单源——get/listVisible/目标扫描共用） */
const MEMORY_COLUMNS = `id, owner_key, kind, summary, content, confidence, evidence_count, status,
                        superseded_by, source_refs, created_at, updated_at, usage_count,
                        last_used_at, frozen, ttl_days, expires_at`;

/** source_refs 解析（坏形 JSON 按 [] 兜底——读面不炸、写面才执法） */
function parseSourceRefs(raw: string): MemorySourceRef[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as MemorySourceRef[]) : [];
  } catch {
    return [];
  }
}

/** DB 行 → 驼峰行 */
function mapRow(row: MemoryDbRow): MemoryRow {
  return {
    id: row.id,
    ownerKey: row.owner_key,
    kind: row.kind as MemoryKind,
    summary: row.summary,
    content: row.content,
    confidence: row.confidence,
    evidenceCount: row.evidence_count,
    status: row.status as MemoryStatus,
    supersededBy: row.superseded_by,
    sourceRefs: parseSourceRefs(row.source_refs),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    usageCount: row.usage_count,
    lastUsedAt: row.last_used_at,
    frozen: row.frozen === 1,
    ttlDays: row.ttl_days,
    expiresAt: row.expires_at,
  };
}

/** memory_versions DB 行（蛇形） */
interface VersionDbRow {
  id: string;
  memory_id: string;
  revision: number;
  owner_key: string;
  kind: string;
  summary: string;
  content: string;
  confidence: number;
  evidence_count: number;
  cause: string;
  created_at: number;
}

/** 版本 DB 行 → 驼峰行 */
function mapVersionRow(row: VersionDbRow): MemoryVersionRow {
  return {
    id: row.id,
    memoryId: row.memory_id,
    revision: row.revision,
    ownerKey: row.owner_key,
    kind: row.kind as MemoryKind,
    summary: row.summary,
    content: row.content,
    confidence: row.confidence,
    evidenceCount: row.evidence_count,
    cause: row.cause as MemoryVersionRow['cause'],
    createdAt: row.created_at,
  };
}

/** owner_key 两形判据（'global' | 'project:<根路径哈希>'——06 §3 两层） */
const OWNER_KEY_RE = /^project:[0-9a-f]{8,64}$/i;

/* ---------------- 工厂 ---------------- */

/** 建 memory DAO（迁移须已应用——openStore 聚合 MEMORY_MIGRATIONS 后传入） */
export function createMemoryDao(deps: MemoryDaoDeps): MemoryDao {
  const { db, warn } = deps;
  const newId = deps.newId ?? (() => uuidv7(deps.now()));

  const stmtGet = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE id = ?`);
  const stmtListAll = db.prepare(
    `SELECT ${MEMORY_COLUMNS} FROM memories
     WHERE status = 'active' AND (frozen = 1 OR expires_at IS NULL OR expires_at > ?)
     ORDER BY updated_at DESC`,
  );
  // 合并目标扫描（落码定形注：同 owner+kind、active、frozen=0、TTL 可见、updated_at DESC 首中即断）
  const stmtScanTargets = db.prepare(
    `SELECT ${MEMORY_COLUMNS} FROM memories
     WHERE owner_key = ? AND kind = ? AND status = 'active' AND frozen = 0
       AND (expires_at IS NULL OR expires_at > ?)
     ORDER BY updated_at DESC`,
  );
  const stmtInsertMemory = db.prepare(
    `INSERT INTO memories (id, owner_key, kind, summary, content, confidence, evidence_count,
                           status, superseded_by, source_refs, created_at, updated_at,
                           ttl_days, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?, ?)`,
  );
  const stmtInsertFts = db.prepare(`INSERT INTO memory_fts (rowid, summary, content) VALUES (?, ?, ?)`);
  const stmtMergeAbsorb = db.prepare(
    `UPDATE memories SET confidence = ?, evidence_count = evidence_count + 1,
                         source_refs = ?, updated_at = ?
     WHERE id = ?`,
  );
  const stmtDismiss = db.prepare(
    `UPDATE memories SET status = 'dismissed', superseded_by = 'auto_resolved' WHERE id = ?`,
  );
  const stmtNextRevision = db.prepare(
    `SELECT COALESCE(MAX(revision), 0) + 1 AS next FROM memory_versions WHERE memory_id = ?`,
  );
  const stmtInsertVersion = db.prepare(
    `INSERT INTO memory_versions (id, memory_id, revision, owner_key, kind, summary, content,
                                  confidence, evidence_count, cause, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const stmtVersions = db.prepare(
    `SELECT id, memory_id, revision, owner_key, kind, summary, content, confidence,
            evidence_count, cause, created_at
     FROM memory_versions WHERE memory_id = ? ORDER BY revision`,
  );
  const stmtRebuildFts = db.prepare(`INSERT INTO memory_fts (memory_fts) VALUES ('rebuild')`);

  /* ---------------- 持有面动词与访问面语句（18c-2） ---------------- */

  const stmtGetRowid = db.prepare(`SELECT rowid AS rid FROM memories WHERE id = ?`);
  // external-content 删除（携**旧值**——FTS5 投影同步的删除语义面，内容回滚前清旧投影）
  const stmtFtsDelete = db.prepare(
    `INSERT INTO memory_fts (memory_fts, rowid, summary, content) VALUES ('delete', ?, ?, ?)`,
  );
  const stmtDismissUser = db.prepare(`UPDATE memories SET status = 'dismissed', superseded_by = ? WHERE id = ?`);
  // 状态复活（纯状态变更——不动 updated_at 不追加版本，同极性新胜旧条纪律）
  const stmtRevive = db.prepare(
    `UPDATE memories SET status = 'active', superseded_by = NULL, expires_at = ? WHERE id = ?`,
  );
  // 内容回滚 + 复活一体（六列回写 + 状态面 + 续期 + updated_at——内容面变更腿）
  const stmtRollback = db.prepare(
    `UPDATE memories SET owner_key = ?, kind = ?, summary = ?, content = ?, confidence = ?,
                         evidence_count = ?, status = 'active', superseded_by = NULL,
                         expires_at = ?, updated_at = ?
     WHERE id = ?`,
  );
  const stmtFreeze = db.prepare(`UPDATE memories SET frozen = 1 WHERE id = ?`);
  const stmtUnfreeze = db.prepare(`UPDATE memories SET frozen = 0, expires_at = ? WHERE id = ?`);
  const stmtSetTtl = db.prepare(`UPDATE memories SET ttl_days = ?, expires_at = ? WHERE id = ?`);
  const stmtSetTtlPolicy = db.prepare(`UPDATE memories SET ttl_days = ? WHERE id = ?`);
  const stmtGetVersion = db.prepare(
    `SELECT id, memory_id, revision, owner_key, kind, summary, content, confidence,
            evidence_count, cause, created_at
     FROM memory_versions WHERE memory_id = ? AND revision = ?`,
  );
  const stmtInsertAccess = db.prepare(
    `INSERT INTO memory_access (id, memory_id, op, session_id, ts) VALUES (?, ?, ?, ?, ?)`,
  );
  // 健康面计数（/memory 管理面同源——按状态逐状态取数；全库不分 owner 假精度）
  const stmtHealthStatuses = db.prepare(`SELECT status, count(*) AS n FROM memories GROUP BY status`);
  const stmtHealthFrozen = db.prepare(`SELECT count(*) AS n FROM memories WHERE frozen = 1`);
  const stmtHealthTotal = db.prepare(`SELECT count(*) AS n FROM memories`);

  /** 坏形拒（MEMORY_ENTRY_INVALID——闭集/形状/越界判据全清单） */
  function validate(candidate: MemoryCandidate): void {
    const problems: string[] = [];
    if (!MEMORY_KINDS.includes(candidate.kind)) problems.push(`kind 非七值闭集：${candidate.kind}`);
    if (candidate.ownerKey !== 'global' && !OWNER_KEY_RE.test(candidate.ownerKey)) {
      problems.push(`owner_key 形违例（'global' | 'project:<根路径哈希>' 两形外）：${candidate.ownerKey}`);
    }
    if (candidate.summary.trim() === '') problems.push('summary 空');
    if (candidate.summary.length > MEMORY_SUMMARY_MAX_CHARS) problems.push('summary 超帽');
    if (candidate.content.trim() === '') problems.push('content 空');
    if (candidate.content.length > MEMORY_CONTENT_MAX_CHARS) problems.push('content 超帽');
    if (!Number.isFinite(candidate.confidence) || candidate.confidence < 0 || candidate.confidence > 1) {
      problems.push(`confidence 越界 [0,1]：${candidate.confidence}`);
    }
    for (const [i, ref] of candidate.sourceRefs.entries()) {
      if (typeof ref?.sessionId !== 'string' || ref.sessionId === '' || !Number.isInteger(ref.seq) || ref.seq < 0) {
        problems.push(`source_refs[${i}] 坏形（{sessionId, seq} 形外）`);
        break;
      }
    }
    // ttl_days 形（18c-2 扩——正整数或 null/缺席；标记即算 expires_at）
    if (
      candidate.ttlDays !== undefined &&
      candidate.ttlDays !== null &&
      (!Number.isInteger(candidate.ttlDays) || candidate.ttlDays < 1)
    ) {
      problems.push(`ttl_days 形违例（正整数或 null）：${candidate.ttlDays}`);
    }
    if (problems.length > 0) {
      throw new BaseError('MEMORY_ENTRY_INVALID', `记忆候选坏形拒：${problems.join('；')}`);
    }
  }

  /** 作用行守卫（MEMORY_NOT_FOUND——GOAL_NOT_FOUND 同构；工具动词与 /memory 管理面共用） */
  function mustGet(id: string): MemoryRow {
    const row = stmtGet.get(id) as MemoryDbRow | undefined;
    if (!row) throw new BaseError('MEMORY_NOT_FOUND', `记忆条目缺席：${id}`);
    return mapRow(row);
  }

  /** 晋升搬家技能名校验（^[a-z0-9]+(-[a-z0-9]+)*$ 且 ≤64——与技能侧 name 校验同源的纯字面量档） */
  function validSkillName(name: string): string {
    if (name.length > MEMORY_SKILL_NAME_MAX || !MEMORY_SKILL_NAME_RE.test(name)) {
      throw new BaseError(
        'MEMORY_ENTRY_INVALID',
        `promotedToSkill 技能名词法违例（^[a-z0-9]+(?:-[a-z0-9]+)*$ 且 ≤${MEMORY_SKILL_NAME_MAX}）：${name}`,
      );
    }
    return name;
  }

  /** 行帽钳制（1..max；非有限数走缺省） */
  function clampLimit(value: number | undefined, fallback: number, max: number): number {
    const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
    return Math.min(Math.max(n, 1), max);
  }

  /** 按 id 重取现行行（事务尾读——回执统一取变更后状态） */
  function reload(id: string): MemoryRow {
    return mapRow(stmtGet.get(id) as MemoryDbRow);
  }

  /** 版本链拍照（append-only——快照六列取**变更后**的现行值；单事务内由调用方保证） */
  function appendVersion(
    memoryId: string,
    face: {
      ownerKey: string;
      kind: MemoryKind;
      summary: string;
      content: string;
      confidence: number;
      evidenceCount: number;
    },
    cause: MemoryVersionRow['cause'],
    now: number,
  ): void {
    const revision = (stmtNextRevision.get(memoryId) as { next: number }).next;
    stmtInsertVersion.run(
      newId(),
      memoryId,
      revision,
      face.ownerKey,
      face.kind,
      face.summary,
      face.content,
      face.confidence,
      face.evidenceCount,
      cause,
      now,
    );
  }

  /** 新条目落库（独立插入 / 极性新胜同型——差异只在证据计数与 refs 继承，调用方定值） */
  function insertEntry(
    candidate: MemoryCandidate,
    evidenceCount: number,
    sourceRefs: readonly MemorySourceRef[],
    now: number,
  ): string {
    const id = newId();
    // ttl 标记即算（06 §7 memory_write 扩参——仅独立插入腿生效，合并腿不动既有策略）
    const ttlDays = candidate.ttlDays ?? null;
    const expiresAt = ttlDays !== null ? now + ttlDays * MEMORY_DAY_MS : null;
    const info = stmtInsertMemory.run(
      id,
      candidate.ownerKey,
      candidate.kind,
      candidate.summary,
      candidate.content,
      candidate.confidence,
      evidenceCount,
      JSON.stringify(sourceRefs),
      now,
      now,
      ttlDays,
      expiresAt,
    );
    // FTS external-content 同步：新行进投影（真身 rowid 即 lastInsertRowid）
    stmtInsertFts.run(Number(info.lastInsertRowid), candidate.summary, candidate.content);
    appendVersion(
      id,
      {
        ownerKey: candidate.ownerKey,
        kind: candidate.kind,
        summary: candidate.summary,
        content: candidate.content,
        confidence: candidate.confidence,
        evidenceCount,
      },
      'insert',
      now,
    );
    return id;
  }

  /** ingest 事务体（扫描 → 逐行裁决首中即断 → 分支落库） */
  const ingestTx = db.transaction((candidate: MemoryCandidate): IngestOutcome => {
    const now = deps.now();

    // —— 写前 secret 扫描（入库单点执法——四写点汇入面；诊断不回写疑似密钥本体）
    const summaryHits = scanForSecrets(candidate.summary);
    const contentHits = scanForSecrets(candidate.content);
    if (summaryHits.length > 0 || contentHits.length > 0) {
      const faces = [summaryHits.length > 0 && 'summary', contentHits.length > 0 && 'content']
        .filter(Boolean)
        .join('/');
      const patterns = [...summaryHits, ...contentHits].map((h) => h.pattern).join(', ');
      warn(`[memory] 写前 secret 扫描命中拒写：pattern=${patterns}（面：${faces}）——疑似密钥本体不入诊断`);
      throw new BaseError('MEMORY_SECRET_DETECTED', `写前 secret 扫描命中拒写（pattern：${patterns}；面：${faces}）`);
    }

    // —— 三分支：目标扫描（同 owner+kind、active、非 frozen、TTL 可见、最新摄入优先）
    const targets = stmtScanTargets.all(candidate.ownerKey, candidate.kind, now) as MemoryDbRow[];
    for (const target of targets) {
      const row = mapRow(target);
      const decision = decideMerge(row, candidate);

      if (decision.branch === 'exact' || decision.branch === 'fuzzy') {
        // 分支 1/2：吸收合并——evidence++、confidence 取 max、refs 并集、updated_at 刷新。
        // summary/content 不变 → FTS 投影零触达（external-content 只同步文本面变更）
        const mergedRefs = unionSourceRefs(row.sourceRefs, candidate.sourceRefs);
        const mergedConfidence = Math.max(row.confidence, candidate.confidence);
        stmtMergeAbsorb.run(mergedConfidence, JSON.stringify(mergedRefs), now, row.id);
        appendVersion(
          row.id,
          {
            ownerKey: row.ownerKey,
            kind: row.kind,
            summary: row.summary,
            content: row.content,
            confidence: mergedConfidence,
            evidenceCount: row.evidenceCount + 1,
          },
          'merge',
          now,
        );
        return { action: decision.branch === 'exact' ? 'merged-exact' : 'merged-fuzzy', id: row.id };
      }

      if (decision.branch === 'polarity') {
        if (decision.winner === 'incoming') {
          // 分支 3 新胜：旧条 dismissed+auto_resolved（纯状态变更——不动 updated_at
          // 防污染摄入水位与老化锚、不追加版本——06 §3「纯状态变更不追加」）；
          // 新条入库继承双方证据计数与 refs 并集（血缘继承：条目消亡，溯源不死）
          const inheritedRefs = unionSourceRefs(row.sourceRefs, candidate.sourceRefs);
          stmtDismiss.run(row.id);
          const id = insertEntry(candidate, row.evidenceCount + 1, inheritedRefs, now);
          return { action: 'inserted', id, supersededId: row.id };
        }
        // 分支 3 旧胜（对称吸收——落码定形注）：旧条原位吸收候选证据与 refs，
        // confidence 已高不动；候选不另立条目（落败来源不蒸腾）
        const absorbedRefs = unionSourceRefs(row.sourceRefs, candidate.sourceRefs);
        stmtMergeAbsorb.run(row.confidence, JSON.stringify(absorbedRefs), now, row.id);
        appendVersion(
          row.id,
          {
            ownerKey: row.ownerKey,
            kind: row.kind,
            summary: row.summary,
            content: row.content,
            confidence: row.confidence,
            evidenceCount: row.evidenceCount + 1,
          },
          'merge',
          now,
        );
        return { action: 'polarity-kept-existing', id: row.id };
      }
      // branch='none'——继续下一行（首中即断不成立时逐行比下去）
    }

    // —— 无中选行：独立新条目（插入即落首版 cause='insert'）
    const id = insertEntry(candidate, 1, candidate.sourceRefs.slice(0, MEMORY_SOURCE_REFS_CAP), now);
    return { action: 'inserted', id };
  });

  /* ---------------- 持有面动词事务体（18c-2——同 ingest 单事务纪律） ---------------- */

  /** forget：软删纯状态变更（不动 updated_at、不追加版本——§3 纪律）；搬家腿词法前置校验 */
  const forgetTx = db.transaction((id: string, promotedToSkill: string | undefined): MemoryRow => {
    const row = mustGet(id);
    if (row.frozen) {
      throw new BaseError('MEMORY_FROZEN', `条目已冻结（forget 撞 frozen 拒——解冻-再忘唯一路径）：${id}`);
    }
    // 终态来源：用户口信 'user' / 晋升搬家 'skill:<名>'（§3 闭集第五值，循 'llm:<id>' 先例）
    const supersededBy = promotedToSkill === undefined ? 'user' : `skill:${validSkillName(promotedToSkill)}`;
    stmtDismissUser.run(supersededBy, id);
    return reload(id);
  });

  /** restore：带版本 ⊃ 状态复活——两腿都按 ttl_days 重算续期；回滚腿 FTS 投影同步 + rollback 版本追加 */
  const restoreTx = db.transaction((id: string, revision: number | undefined): MemoryRow => {
    const now = deps.now();
    const row = mustGet(id);
    const expiresAt = row.ttlDays !== null ? now + row.ttlDays * MEMORY_DAY_MS : null;
    if (revision === undefined) {
      // 状态复活腿：现行内容不变——纯状态变更（复活唯 restore 的「复活」语义落位）
      stmtRevive.run(expiresAt, id);
      return reload(id);
    }
    // 内容回滚腿撞 frozen 免覆写（纯状态复活腿不动内容面——frozen 行无此拒）
    if (row.frozen) {
      throw new BaseError('MEMORY_FROZEN', `条目已冻结（restore 带 revision 内容回滚撞 frozen 免覆写）：${id}`);
    }
    const v = stmtGetVersion.get(id, revision) as VersionDbRow | undefined;
    if (!v) {
      // 无链条目带版本拒 / revision 越界——同码（版本缺席是统一执法面）
      throw new BaseError('MEMORY_REVISION_NOT_FOUND', `版本缺席：${id}#revision=${revision}`);
    }
    const rid = (stmtGetRowid.get(id) as { rid: number }).rid;
    // FTS external-content 同步：删旧投影（携旧值）→ 六列回写 → 插新投影
    stmtFtsDelete.run(rid, row.summary, row.content);
    stmtRollback.run(v.owner_key, v.kind, v.summary, v.content, v.confidence, v.evidence_count, expiresAt, now, id);
    stmtInsertFts.run(rid, v.summary, v.content);
    appendVersion(
      id,
      {
        ownerKey: v.owner_key,
        kind: v.kind as MemoryKind,
        summary: v.summary,
        content: v.content,
        confidence: v.confidence,
        evidenceCount: v.evidence_count,
      },
      'rollback',
      now,
    );
    return reload(id);
  });

  /** freeze：幂等（重复冻结无害）；纯持有面不动 updated_at（不污染老化锚） */
  const freezeTx = db.transaction((id: string): MemoryRow => {
    mustGet(id);
    stmtFreeze.run(id);
    return reload(id);
  });

  /** unfreeze：幂等；解冻即按 ttl_days 重算钟（冻结期不计时——重算非续算） */
  const unfreezeTx = db.transaction((id: string): MemoryRow => {
    const now = deps.now();
    const row = mustGet(id);
    const expiresAt = row.ttlDays !== null ? now + row.ttlDays * MEMORY_DAY_MS : null;
    stmtUnfreeze.run(expiresAt, id);
    return reload(id);
  });

  /** setTtl：有效可见行物化重算立即生效；已过期/终态行仅改未来策略（复活唯 restore） */
  const setTtlTx = db.transaction((id: string, days: number | null): MemoryRow => {
    const now = deps.now();
    if (days !== null && (!Number.isInteger(days) || days < 1)) {
      throw new BaseError('MEMORY_ENTRY_INVALID', `ttl days 形违例（正整数或 null）：${days}`);
    }
    const row = mustGet(id);
    if (row.frozen) {
      throw new BaseError('MEMORY_FROZEN', `条目已冻结（frozen 免 TTL——setTtl 拒；解冻-再设唯一路径）：${id}`);
    }
    if (row.status === 'active' && (row.expiresAt === null || row.expiresAt > now)) {
      stmtSetTtl.run(days, days === null ? null : now + days * MEMORY_DAY_MS, id);
    } else {
      // 终态/已过期行：expires_at 不动（读面谓词不因改策略复活），策略面供 restore/unfreeze 重算消费
      stmtSetTtlPolicy.run(days, id);
    }
    return reload(id);
  });

  /* ---------------- 检索与读面实装 ---------------- */

  /** listVisible 本体（方法面与 overview 共用——TTL 谓词单源） */
  function listVisibleImpl(ownerKeys: readonly string[] | undefined): MemoryRow[] {
    const now = deps.now();
    if (!ownerKeys || ownerKeys.length === 0) {
      return (stmtListAll.all(now) as MemoryDbRow[]).map(mapRow);
    }
    // owner 并集读（单语句按需 prepare——owner 键组合开放、缓存无意义）
    const placeholders = ownerKeys.map(() => '?').join(', ');
    const stmt = db.prepare(
      `SELECT ${MEMORY_COLUMNS} FROM memories
       WHERE status = 'active' AND (frozen = 1 OR expires_at IS NULL OR expires_at > ?)
         AND owner_key IN (${placeholders})
       ORDER BY updated_at DESC`,
    );
    return (stmt.all(now, ...ownerKeys) as MemoryDbRow[]).map(mapRow);
  }

  /** FTS 检索（记忆库腿——trigram 短语包裹防 MATCH 语法面；命中流水同事务落账） */
  function searchImpl(query: string, opts: MemorySearchOptions | undefined): MemorySearchHit[] {
    // 短语包裹：剥用户侧引号后整体成 phrase——防 FTS5 MATCH 语法注入（NEAR/AND 等运算符不生效）
    const sanitized = query.replaceAll('"', ' ').trim();
    if (sanitized === '') return [];
    const now = deps.now();
    const limit = clampLimit(opts?.limit, MEMORY_SEARCH_DEFAULT_LIMIT, MEMORY_SEARCH_MAX_LIMIT);
    const conds = [`m.status = 'active'`, `(m.frozen = 1 OR m.expires_at IS NULL OR m.expires_at > ?)`];
    const params: unknown[] = [`"${sanitized}"`, now];
    if (opts?.kind !== undefined) {
      conds.push(`m.kind = ?`);
      params.push(opts.kind);
    }
    if (opts?.ownerKeys && opts.ownerKeys.length > 0) {
      conds.push(`m.owner_key IN (${opts.ownerKeys.map(() => '?').join(', ')})`);
      params.push(...opts.ownerKeys);
    }
    const stmt = db.prepare(
      `SELECT m.id AS id, m.owner_key AS ownerKey, m.kind AS kind, m.summary AS summary,
              memory_fts.rank AS score
       FROM memory_fts JOIN memories m ON m.rowid = memory_fts.rowid
       WHERE memory_fts MATCH ? AND ${conds.join(' AND ')}
       ORDER BY memory_fts.rank
       LIMIT ?`,
    );
    const hits = stmt.all(...params, limit) as MemorySearchHit[];
    if (hits.length > 0) {
      // 命中流水落账（06 §7——缺省 op='search'/session_id NULL〔工具上下文无会话键〕；
      // 按需检索注入路注入 op='recall' + 当轮会话键〔06 §6 三写点单 DAO 实现律〕；
      // 读模型的计量写面，非领域状态变更——聚合只随 cite，流水面不动聚合）
      const op = opts?.accessOp ?? 'search';
      const sessionId = opts?.accessSessionId ?? null;
      const logTx = db.transaction((rows: readonly MemorySearchHit[]): void => {
        const ts = deps.now();
        for (const hit of rows) stmtInsertAccess.run(newId(), hit.id, op, sessionId, ts);
      });
      logTx(hits);
    }
    return hits;
  }

  /** memory_read 无 id 腿整面（frozen 恒驻在前 + 效用综合分降序——§5 一把尺；§6 权威 builder 随 18c-4） */
  function overviewImpl(ownerKeys: readonly string[] | undefined): MemoryReadOverview {
    const visible = listVisibleImpl(ownerKeys);
    const frozenFirst = visible.filter((r) => r.frozen);
    const scored = visible
      .filter((r) => !r.frozen)
      .map((row) => ({ row, score: utilityScore(row) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.row);
    const counts = stmtHealthStatuses.all() as { status: string; n: number }[];
    const byStatus = new Map(counts.map((c) => [c.status, c.n]));
    return {
      core: [...frozenFirst, ...scored],
      recent: visible.slice(0, MEMORY_RECENT_LIMIT), // listVisibleImpl 已按 updated_at DESC
      health: {
        active: byStatus.get('active') ?? 0,
        dismissed: byStatus.get('dismissed') ?? 0,
        expired: byStatus.get('expired') ?? 0,
        frozen: (stmtHealthFrozen.get() as { n: number }).n,
        total: (stmtHealthTotal.get() as { n: number }).n,
      },
    };
  }

  /** 访问日志双面查询（聚合 top-N + 流水——前缀/时间窗/op 过滤共用同一套 WHERE） */
  function accessLogImpl(query: MemoryAccessLogQuery | undefined): MemoryAccessLogResult {
    const q = query ?? {};
    const conds: string[] = [];
    const params: unknown[] = [];
    if (q.memoryIdPrefix !== undefined && q.memoryIdPrefix !== '') {
      // 前缀精确比对（substr 定长截取——免 LIKE 通配转义面）
      conds.push('substr(a.memory_id, 1, ?) = ?');
      params.push(q.memoryIdPrefix.length, q.memoryIdPrefix);
    }
    if (typeof q.from === 'number') {
      conds.push('a.ts >= ?');
      params.push(q.from);
    }
    if (typeof q.to === 'number') {
      conds.push('a.ts <= ?');
      params.push(q.to);
    }
    if (q.op !== undefined) {
      conds.push('a.op = ?');
      params.push(q.op);
    }
    const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : '';
    const limit = clampLimit(q.limit, MEMORY_ACCESS_LOG_DEFAULT_LIMIT, MEMORY_ACCESS_LOG_MAX_LIMIT);
    const flow = db
      .prepare(
        `SELECT a.id AS id, a.memory_id AS memoryId, a.op AS op, a.session_id AS sessionId, a.ts AS ts
         FROM memory_access a ${where}
         ORDER BY a.ts DESC LIMIT ?`,
      )
      .all(...params, limit) as MemoryAccessFlowRow[];
    const aggregates = db
      .prepare(
        `SELECT a.memory_id AS memoryId, m.summary AS summary,
                SUM(CASE WHEN a.op = 'recall' THEN 1 ELSE 0 END) AS recall,
                SUM(CASE WHEN a.op = 'search' THEN 1 ELSE 0 END) AS search,
                SUM(CASE WHEN a.op = 'cite' THEN 1 ELSE 0 END) AS cite,
                count(*) AS total
         FROM memory_access a JOIN memories m ON m.id = a.memory_id
         ${where}
         GROUP BY a.memory_id
         ORDER BY total DESC
         LIMIT ${MEMORY_ACCESS_AGGREGATE_TOP_N}`,
      )
      .all(...params) as MemoryAccessAggregate[];
    return { aggregates, flow };
  }

  return {
    ingest(candidate) {
      validate(candidate); // 坏形拒在事务外（不入库不改库——纯请求面校验）
      return ingestTx(candidate);
    },
    get(id) {
      const row = stmtGet.get(id) as MemoryDbRow | undefined;
      return row ? mapRow(row) : undefined;
    },
    listVisible(ownerKeys) {
      return listVisibleImpl(ownerKeys);
    },
    versions(memoryId) {
      return (stmtVersions.all(memoryId) as VersionDbRow[]).map(mapVersionRow);
    },
    rebuildFts() {
      stmtRebuildFts.run();
    },
    forget(id, opts) {
      return forgetTx(id, opts?.promotedToSkill);
    },
    restore(id, revision) {
      return restoreTx(id, revision);
    },
    freeze(id) {
      return freezeTx(id);
    },
    unfreeze(id) {
      return unfreezeTx(id);
    },
    setTtl(id, days) {
      return setTtlTx(id, days);
    },
    search(query, opts) {
      return searchImpl(query, opts);
    },
    overview(ownerKeys) {
      return overviewImpl(ownerKeys);
    },
    accessLog(query) {
      return accessLogImpl(query);
    },
  };
}
