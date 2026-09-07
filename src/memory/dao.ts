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
import { decideMerge, unionSourceRefs } from './merge.js';
import { scanForSecrets } from './scan.js';
import {
  MEMORY_CONTENT_MAX_CHARS,
  MEMORY_KINDS,
  MEMORY_SOURCE_REFS_CAP,
  MEMORY_SUMMARY_MAX_CHARS,
  type IngestOutcome,
  type MemoryCandidate,
  type MemoryKind,
  type MemoryRow,
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

/** memory DAO 公开面（18c-1 域 = 入库单点 + 读面；工具面九件/持有面动词随后批同 DAO 扩） */
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
                           status, superseded_by, source_refs, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?)`,
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
    if (problems.length > 0) {
      throw new BaseError('MEMORY_ENTRY_INVALID', `记忆候选坏形拒：${problems.join('；')}`);
    }
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
    cause: 'insert' | 'merge',
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
    },
    versions(memoryId) {
      return (stmtVersions.all(memoryId) as VersionDbRow[]).map(mapVersionRow);
    },
    rebuildFts() {
      stmtRebuildFts.run();
    },
  };
}
