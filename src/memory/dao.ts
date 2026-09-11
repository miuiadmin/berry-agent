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
 * **TTL 读面谓词两形**（06 §3 单一来源；批 ev-1 生效起点条扩形——冷读闸 M2
 * 拆形）：注入形 = `status='active' AND (frozen=1 OR expires_at IS NULL OR
 * expires_at > now) AND (valid_from IS NULL OR valid_from <= now)`——一切进
 * 模型上下文与效用计量的面；管理形 = TTL 段 only（/memory 活体区、谱系、
 * 导出）。合并目标扫描管理形 + frozen=0 叠加（frozen 豁免三分支——候选撞
 * 冻结行作独立新条目；起点段同样不过滤——新证据并入未生效 keep 行）。
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
  MEMORY_ACCESS_WINDOW_DAYS,
  MEMORY_CONTENT_MAX_CHARS,
  MEMORY_DAY_MS,
  MEMORY_KINDS,
  MEMORY_RECENT_LIMIT,
  MEMORY_SEARCH_DEFAULT_LIMIT,
  MEMORY_SEARCH_MAX_LIMIT,
  MEMORY_SKILL_NAME_MAX,
  MEMORY_SKILL_NAME_RE,
  MEMORY_SOURCE_REFS_CAP,
  MEMORY_STATUSES,
  MEMORY_SUMMARY_MAX_CHARS,
  type IngestOutcome,
  type MemoryAccessAggregate,
  type MemoryAccessFlowRow,
  type MemoryAccessLogQuery,
  type MemoryAccessLogResult,
  type MemoryCandidate,
  type MemoryExportRow,
  type MemoryKind,
  type MemoryLineage,
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
  /** 可见条目清单（**注入形**——TTL 段 AND 起点段；ownerKeys 限定 = owner 并集读；常驻简报与 memory_read 无 id 腿消费） */
  listVisible(ownerKeys?: readonly string[]): MemoryRow[];
  /** 可见条目清单管理形（TTL 段 only——未生效行可见；/memory 活体区消费——批 ev-1 M2 拆形） */
  listVisibleForManagement(ownerKeys?: readonly string[]): MemoryRow[];
  /** 版本链读面（revision 升序） */
  versions(memoryId: string): MemoryVersionRow[];
  /** 谱系查询（id → 现行值 + 版本链 + 前身链 + 后继解析三链一读——管理面直读不过滤；批 ev-1） */
  lineage(id: string): MemoryLineage;
  /** FTS 全量重建（投影卫生面——可丢弃可重建纪律） */
  rebuildFts(): void;

  /* —— 持有面动词（06 §7——工具九件与 /memory 管理面同 DAO 单实现律） —— */

  /**
   * 软删（纯状态变更；frozen 拒；**终态短路**——已 dismissed 行幂等返回现行行
   * 不覆写 superseded_by，06 §5 触发与护栏第四件配套）。终态来源三消费形：
   * 'user'（用户口信缺省）/ 'skill:<名>'（晋升搬家）/ 'llm:<keepId>'
   * （consolidation 执行腿——supersededBy 直取值，批 18c-5 落码定形注）。
   */
  forget(id: string, opts?: { promotedToSkill?: string; supersededBy?: string }): MemoryRow;
  /** 复活（缺省 = 状态复活；带 revision = 内容回滚 + cause='rollback' 版本追加；两腿都按 ttl_days 重算续期） */
  restore(id: string, revision?: number): MemoryRow;
  /** 冻结（幂等——恒简报/免 TTL/免覆写/免整理全档开闸） */
  freeze(id: string): MemoryRow;
  /** 解冻（幂等——按 ttl_days 重算钟） */
  unfreeze(id: string): MemoryRow;
  /** 清/设留存（null = 永久；有效可见行物化重算立即生效、已过期/终态行仅改未来策略不复活；frozen 拒） */
  setTtl(id: string, days: number | null): MemoryRow;

  /* —— 整理面四法（批 18c-5——06 §5 落码定形注；consolidation 执行腿物理承载） —— */

  /**
   * 显式合并物理动作（consolidation 执行腿）：keep 条 evidence += drop 全数、
   * confidence 取 max、source_refs 并集（帽 50）、updated_at 刷新（证据合并即
   * 摄入面）、keep 版本链 cause='merge' 追加；drop 同事务终态
   * forget('llm:<keepId>')。自指/frozen 任一侧/非在册行拒。FTS 零触达
   * （summary/content 不变——external-content 只同步文本面变更）。
   */
  absorb(keepId: string, dropId: string, reason?: string | null): MemoryRow;
  /**
   * 降权物化：confidence × factor，**不刷 updated_at**（降权不是新证据——防
   * 反复 decay 把条目「洗新」出老化候选集）；版本链追加 cause='decay'。
   * factor ∈ (0,1]；frozen/非在册拒。
   */
  decay(id: string, factor: number, reason?: string | null): MemoryRow;
  /**
   * TTL 物化 + 访问日志窗口清扫（批 18c-8 双清同拍单事务——06 §3 定形注）：
   * ① active 且非 frozen 且 expires_at ≤ now 的行 → status='expired'、
   * superseded_by='ttl'（纯状态变更——不动 updated_at 不追加版本）；
   * ② memory_access ts ≤ now - 90d 流水行删除（聚合列不随清扫回退——
   * 流水是可丢弃审计面）。返回双计数 { expired, accessPruned }。
   */
  sweepExpired(): { expired: number; accessPruned: number };

  /* —— 检索与读面 —— */

  /** FTS 检索（记忆库腿——跨会话 union 归 18c-6；命中落 memory_access 流水：缺省 op='search'，按需检索注入路注入 op='recall' + 会话键） */
  search(query: string, opts?: MemorySearchOptions): MemorySearchHit[];
  /** memory_read 无 id 腿整面（简报取数基础版 + 最近变更 + 健康面） */
  overview(ownerKeys?: readonly string[]): MemoryReadOverview;
  /** 访问日志双面查询（聚合 top-N + 流水） */
  accessLog(query?: MemoryAccessLogQuery): MemoryAccessLogResult;

  /* —— 效用回写面（批 18c-7——06 §6 cite 引用闭环） —— */

  /**
   * 短 id 归责（substr 定长前缀比对——不做可见性过滤，身份解析非读面）：
   * 返回前缀命中全集，归责三态由消费侧判——零命中 = 未知引用忽略、
   * 多命中 = 歧义全部忽略、恰一命中 = 唯一归属。
   */
  resolveShortId(shortId: string): readonly string[];
  /**
   * 效用回写批量（单事务四写一体：usage_count+1、last_used_at=now、
   * ttl_days 非 NULL 行 expires_at 同点重算〔被引用即续命——复活唯 restore，
   * 续期只作用活体〕、access 行 op='cite' 带会话键）。`status='expired'`
   * 已物化行**整行跳过含流水**（对终态行续期 = 静默复活漏洞）；dismissed
   * 行照计（cite 是审计事实）。返回实记条数（聚合不变式
   * usage_count ≡ cite 行数的物理承载）。
   */
  markUsed(ids: readonly string[], sessionId?: string | null): number;
  /**
   * 纠正负效用回写批量（2026-09-08 消化批——06 §3「纠正负效用回写」条，markUsed
   * 同族计量面写点）：单事务两写一体 = corrected_count+1 + access 行 op=
   * 'corrected-cite' 带**纠正发生会话**键。守卫与 markUsed 分立处：①**不保活**
   * ——不动 usage_count/last_used_at/expires_at（无续期语义，「被纠正」不是使用）；
   * ③**终态行照记**——无 `status != 'expired'` 过滤（负效用无续期复活面，
   * 流水是审计事实不因终态蒸发；restore 后 corrected_count 延续）。缺席 id
   * 零命中跳过；同事件同条目一次的守卫④在调用侧解析面（同消息同短 id 去重）。
   * 返回实记条数（corrected_count ≡ corrected-cite 行数的物理承载）。
   */
  markCorrected(ids: readonly string[], sessionId?: string | null): number;

  /* —— 导入导出面（批 18c-8——06 §3 文件导入导出条 + 落码定形注） —— */

  /**
   * 导出取数：全状态现行值（active/dismissed/expired 三值——恢复式备份
   * 语义，读面 TTL 谓词不适用于导出面）含 TTL 不可见行，按 id 升序确定性
   * 排列（可 diff）；ownerKey 限定 = 单键导出。
   */
  listForExport(ownerKey?: string): MemoryRow[];
  /**
   * 导入直插（状态面第二写点——内容面插入/合并路径唯一不变）：单事务三写
   * = memories 全列直插（id/owner_key/状态列原值含 dismissed/expired/frozen）
   * + FTS 投影 + 版本链（批 ev-1 双路：随包 versions 非空 → 按 revision 升序
   * 原值直搬重建链〔id/revision/cause/reason/created_at 全原值——revision 原值
   * 是 restore 参数跨机互操作的前提〕；无链 → 首版快造 cause='insert'〔快照
   * 内容面取导入行原值，版本行 id/created_at 用本库 now——本库时间线不自外来
   * 钟〕）。id 已在库 → 整行跳过返回 false（恢复式幂等零合并零覆写**含链**）。
   * 行形校验归 port.parseMemoryImportRow（词法判定单点）；写前 secret 扫描
   * 在此单点执法（导入面即写入面——没有绕过扫描的写入方）。
   */
  importInsert(row: MemoryExportRow): boolean;
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
  corrected_count: number;
  frozen: number;
  ttl_days: number | null;
  expires_at: number | null;
  valid_from: number | null;
}

/**
 * TTL 读面谓词**两形**（批 ev-1——06 §3「生效起点」条落码切分面，冷读闸 M2
 * 钉死；承冷读闸 o3 先抽单源再扩段——四处内联手抄自此归一）：
 *
 *   管理形 = TTL 段 only——管理与审计读面可见未生效行（/memory 活体区、谱系、
 *            导出、访问流水）；合并目标扫描同形（§5 起点段不过滤——新证据
 *            并入未生效 keep 行、起点不漂移）。
 *   注入形 = TTL 段 AND 起点段——一切进模型上下文与效用计量的面（常驻简报、
 *            memory_read 无 id 腿、memory_search 命中）。frozen **不豁免**
 *            起点段（OR 只包住 TTL 段、AND 结构天然执法——m10 一锁双杀位）。
 *
 * 两形均带一个 now 绑定参数（注入形共两个——TTL 一个 + 起点一个）。
 */
const TTL_COND_MANAGEMENT = `(frozen = 1 OR expires_at IS NULL OR expires_at > ?)`;
const TTL_COND_INJECT = `(frozen = 1 OR expires_at IS NULL OR expires_at > ?)
       AND (valid_from IS NULL OR valid_from <= ?)`;

/** memories 查列清单（单源——get/listVisible/目标扫描共用） */
const MEMORY_COLUMNS = `id, owner_key, kind, summary, content, confidence, evidence_count, status,
                        superseded_by, source_refs, created_at, updated_at, usage_count,
                        last_used_at, corrected_count, frozen, ttl_days, expires_at, valid_from`;

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
    correctedCount: row.corrected_count,
    frozen: row.frozen === 1,
    ttlDays: row.ttl_days,
    expiresAt: row.expires_at,
    validFrom: row.valid_from,
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
  reason: string | null;
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
    reason: row.reason,
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
  // 注入形（listVisible 本体——常驻简报与 memory_read 无 id 腿共用的读面）
  const stmtListAll = db.prepare(
    `SELECT ${MEMORY_COLUMNS} FROM memories
     WHERE status = 'active' AND ${TTL_COND_INJECT}
     ORDER BY updated_at DESC`,
  );
  // 合并目标扫描（落码定形注：同 owner+kind、active、frozen=0、TTL 可见、updated_at DESC 首中即断；
  // **管理形**——起点段不过滤〔§5：新证据并入未生效 keep 行、起点不漂移〕）
  const stmtScanTargets = db.prepare(
    `SELECT ${MEMORY_COLUMNS} FROM memories
     WHERE owner_key = ? AND kind = ? AND status = 'active' AND frozen = 0
       AND ${TTL_COND_MANAGEMENT}
     ORDER BY updated_at DESC`,
  );
  const stmtInsertMemory = db.prepare(
    `INSERT INTO memories (id, owner_key, kind, summary, content, confidence, evidence_count,
                           status, superseded_by, source_refs, created_at, updated_at,
                           ttl_days, expires_at, valid_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'active', NULL, ?, ?, ?, ?, ?, ?)`,
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
                                  confidence, evidence_count, cause, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const stmtVersions = db.prepare(
    `SELECT id, memory_id, revision, owner_key, kind, summary, content, confidence,
            evidence_count, cause, reason, created_at
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

  /* ---------------- 整理面语句（18c-5——absorb/decay/sweepExpired） ---------------- */

  // absorb 物理形（与三分支吸收合并同族但 evidence 全数过继——非 +1 象征位）
  const stmtAbsorbFull = db.prepare(
    `UPDATE memories SET confidence = ?, evidence_count = ?, source_refs = ?, updated_at = ?
     WHERE id = ?`,
  );
  // decay 物化（只动 confidence——不刷 updated_at，防洗新出老化候选集）
  const stmtDecay = db.prepare(`UPDATE memories SET confidence = ? WHERE id = ?`);
  // TTL 物化（纯状态变更——frozen 免、不动 updated_at 不追加版本）
  const stmtSweepExpired = db.prepare(
    `UPDATE memories SET status = 'expired', superseded_by = 'ttl'
     WHERE status = 'active' AND frozen = 0 AND expires_at IS NOT NULL AND expires_at <= ?`,
  );
  // 访问日志窗口清扫（批 18c-8——与 TTL 物化同拍同事务；窗口下界整行删，聚合列不回退）
  const stmtSweepAccess = db.prepare(`DELETE FROM memory_access WHERE ts <= ?`);
  const stmtGetVersion = db.prepare(
    `SELECT id, memory_id, revision, owner_key, kind, summary, content, confidence,
            evidence_count, cause, reason, created_at
     FROM memory_versions WHERE memory_id = ? AND revision = ?`,
  );
  const stmtInsertAccess = db.prepare(
    `INSERT INTO memory_access (id, memory_id, op, session_id, ts) VALUES (?, ?, ?, ?, ?)`,
  );
  // 效用回写（批 18c-7——cite 四写一体）：expired 已物化行整行跳过（WHERE 拒改），
  // 续期仅 ttl_days 非 NULL 行重算 now + ttl_days × 天毫秒（NULL 永久行钟不动——
  // CASE 保 expires_at 原值；天毫秒经参数绑定——MEMORY_DAY_MS 单源不落 SQL 字面量）
  const stmtMarkUsed = db.prepare(
    `UPDATE memories SET usage_count = usage_count + 1, last_used_at = ?,
                         expires_at = CASE WHEN ttl_days IS NOT NULL THEN ? + ttl_days * ? ELSE expires_at END
     WHERE id = ? AND status != 'expired'`,
  );
  // 短 id 归责（substr 定长前缀比对——与 accessLog 前缀过滤同法，免 LIKE 通配转义面）
  const stmtResolvePrefix = db.prepare(`SELECT id FROM memories WHERE substr(id, 1, 8) = ?`);
  // 纠正负效用回写（2026-09-08 消化批——§3 守卫①③）：**只动 corrected_count**——
  // 不保活（usage/last_used/expires 全不动）；**无状态过滤**（终态行照记——
  // 对照 markUsed 的 expired 跳过：那是防续期复活，负效用无此面）
  const stmtMarkCorrected = db.prepare(`UPDATE memories SET corrected_count = corrected_count + 1 WHERE id = ?`);
  // 健康面计数（/memory 管理面同源——按状态逐状态取数；全库不分 owner 假精度）
  const stmtHealthStatuses = db.prepare(`SELECT status, count(*) AS n FROM memories GROUP BY status`);
  const stmtHealthFrozen = db.prepare(`SELECT count(*) AS n FROM memories WHERE frozen = 1`);
  const stmtHealthTotal = db.prepare(`SELECT count(*) AS n FROM memories`);

  /* ---------------- 导入导出语句（18c-8——listForExport/importInsert） ---------------- */

  // 导出取数（全状态含终态行 + TTL 不可见行——恢复式备份语义；id 升序确定性排列〔可 diff〕）
  const stmtListForExportAll = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories ORDER BY id`);
  const stmtListForExportOwner = db.prepare(`SELECT ${MEMORY_COLUMNS} FROM memories WHERE owner_key = ? ORDER BY id`);
  // 导入直插（全列 INSERT——id/owner_key/状态列原值；stmtInsertMemory 硬编码
  // 'active'/NULL 不可复用，导入是状态面第二写点故独立语句）；corrected_count
  // 为容错位（旧 17 列文件缺席按 DEFAULT 0 收——port 解析面单点判定）、
  // valid_from 同律容错（旧 18 列文件缺席按 NULL 收）
  const stmtImportInsert = db.prepare(
    `INSERT INTO memories (id, owner_key, kind, summary, content, confidence, evidence_count,
                           status, superseded_by, source_refs, created_at, updated_at,
                           usage_count, last_used_at, corrected_count, frozen, ttl_days,
                           expires_at, valid_from)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // 导入链行直插（批 ev-1——随包 versions 原值直搬：id/revision/cause/reason/
  // 快照六列/created_at 全原值。**revision 原值直搬是 restore 参数跨机互操作的
  // 前提**；与无链行首版快造用本库 now 分立——历史事实不自造钟）
  const stmtImportInsertVersion = db.prepare(
    `INSERT INTO memory_versions (id, memory_id, revision, owner_key, kind, summary, content,
                                  confidence, evidence_count, cause, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // 谱系前身反查（superseded_by 以 'llm:<本id>' 形指向本条的终态行——合并吸收
  // 面与搬家前身；audit 面不过滤 valid_from——未生效行谱系照可查）
  const stmtPredecessors = db.prepare(
    `SELECT ${MEMORY_COLUMNS} FROM memories WHERE superseded_by = ? ORDER BY created_at DESC`,
  );

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
    // valid_from 形（批 ev-1——Unix 毫秒整数或 null/缺席；ISO→毫秒转换在工具面，
    // 此处只收毫秒形。工具面坏 ISO 拒 MEMORY_ENTRY_INVALID 与本判定同码同判据族）
    if (candidate.validFrom !== undefined && candidate.validFrom !== null && !Number.isInteger(candidate.validFrom)) {
      problems.push(`valid_from 形违例（Unix 毫秒整数或 null）：${String(candidate.validFrom)}`);
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
    /** 因由叙述（批 ev-1 reason 入链——LLM absorb 携护栏校验后的建议 reason /
     * decay 携判据描述；缺省 null：insert/rollback 与确定性三分支合并无自由文本） */
    reason?: string | null,
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
      reason ?? null,
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
    // 生效起点原值落库（批 ev-1——与 ttlDays 同律仅独立插入腿；合并吸收腿
    // stmtMergeAbsorb 不写 valid_from，起点不漂移）
    const validFrom = candidate.validFrom ?? null;
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
      validFrom,
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

  /**
   * forget：软删纯状态变更（不动 updated_at、不追加版本——§3 纪律）。
   * 检查序 = missing → frozen 拒 → **dismissed 终态短路**（幂等返回现行行，
   * 不覆写 superseded_by——用户终审 'user'/'skill:<名>' 不被后到 'llm:<id>'
   * 腿覆盖；06 §5 触发与护栏第四件配套，批 18c-5 兑现）。
   * 终态来源优先级：supersededBy 直取值（'llm:<keepId>' 消费形）> promotedToSkill
   * 搬家腿（词法前置校验）> 'user' 缺省。
   */
  const forgetTx = db.transaction(
    (id: string, promotedToSkill: string | undefined, supersededBy: string | undefined): MemoryRow => {
      const row = mustGet(id);
      if (row.frozen) {
        throw new BaseError('MEMORY_FROZEN', `条目已冻结（forget 撞 frozen 拒——解冻-再忘唯一路径）：${id}`);
      }
      if (row.status === 'dismissed') return row; // 终态短路——先到终审定格
      const origin =
        supersededBy !== undefined
          ? supersededBy
          : promotedToSkill === undefined
            ? 'user'
            : `skill:${validSkillName(promotedToSkill)}`;
      stmtDismissUser.run(origin, id);
      return reload(id);
    },
  );

  /** absorb：显式合并物理动作（consolidation 执行腿——单事务：过继 + 版本 + drop 终态） */
  const absorbTx = db.transaction((keepId: string, dropId: string, reason?: string | null): MemoryRow => {
    if (keepId === dropId) {
      throw new BaseError('MEMORY_ENTRY_INVALID', `absorb 自指拒（keep 与 drop 同 id）：${keepId}`);
    }
    const keep = mustGet(keepId);
    const drop = mustGet(dropId);
    // frozen 免整理全档（任一侧）；整理面只作用在册行
    if (keep.frozen || drop.frozen) {
      throw new BaseError('MEMORY_FROZEN', `absorb 撞冻结拒（frozen 免整理）：keep=${keepId} drop=${dropId}`);
    }
    if (keep.status !== 'active' || drop.status !== 'active') {
      throw new BaseError(
        'MEMORY_ENTRY_INVALID',
        `absorb 只作用在册行：keep=${keepId}(${keep.status}) drop=${dropId}(${drop.status})`,
      );
    }
    const now = deps.now();
    // 过继四件：evidence 全数（非 +1 象征位）/ confidence max / refs 并集（帽内——血缘继承）/ updated_at 刷新
    const mergedRefs = unionSourceRefs(keep.sourceRefs, drop.sourceRefs);
    const mergedConfidence = Math.max(keep.confidence, drop.confidence);
    const mergedEvidence = keep.evidenceCount + drop.evidenceCount;
    stmtAbsorbFull.run(mergedConfidence, mergedEvidence, JSON.stringify(mergedRefs), now, keepId);
    appendVersion(
      keepId,
      {
        ownerKey: keep.ownerKey,
        kind: keep.kind,
        summary: keep.summary,
        content: keep.content,
        confidence: mergedConfidence,
        evidenceCount: mergedEvidence,
      },
      'merge',
      now,
      // 批 ev-1 reason 入链：consolidation 携 §5 护栏校验后的 LLM 建议组 reason
      reason ?? null,
    );
    // drop 终态（同事务内联——active 前置检查已等价 forget 终态短路的检查面）
    stmtDismissUser.run(`llm:${keepId}`, dropId);
    return reload(keepId);
  });

  /** decay：降权物化（confidence × factor + 版本 cause='decay'——不刷 updated_at） */
  const decayTx = db.transaction((id: string, factor: number, reason?: string | null): MemoryRow => {
    if (!Number.isFinite(factor) || factor <= 0 || factor > 1) {
      throw new BaseError('MEMORY_ENTRY_INVALID', `decay factor 形违例（(0,1] 区间）：${factor}`);
    }
    const now = deps.now();
    const row = mustGet(id);
    if (row.frozen) {
      throw new BaseError('MEMORY_FROZEN', `条目已冻结（frozen 免整理——decay 拒）：${id}`);
    }
    if (row.status !== 'active') {
      throw new BaseError('MEMORY_ENTRY_INVALID', `decay 只作用在册行（${row.status}）：${id}`);
    }
    const next = row.confidence * factor;
    stmtDecay.run(next, id);
    appendVersion(
      id,
      {
        ownerKey: row.ownerKey,
        kind: row.kind,
        summary: row.summary,
        content: row.content,
        confidence: next,
        evidenceCount: row.evidenceCount,
      },
      'decay',
      now,
      // 批 ev-1 reason 入链：consolidation decay 判据描述（自由文本）
      reason ?? null,
    );
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

  /** markUsed：效用回写批量（批 18c-7——单事务四写一体；流水与聚合同事务） */
  const markUsedTx = db.transaction((ids: readonly string[], sessionId: string | null): number => {
    const now = deps.now();
    let applied = 0;
    for (const id of ids) {
      const info = stmtMarkUsed.run(now, now, MEMORY_DAY_MS, id);
      // expired 已物化行 changes=0 整行跳过（含流水——终态行不计数不续期）
      if (info.changes > 0) {
        applied += 1;
        stmtInsertAccess.run(newId(), id, 'cite', sessionId, now);
      }
    }
    return applied;
  });

  /**
   * markCorrected：纠正负效用回写批量（2026-09-08 消化批——单事务两写一体：
   * corrected_count+1 + op='corrected-cite' 流水）。无状态过滤（终态照记——
   * 守卫③）、零保活面（守卫①——语句本体即防线）；缺席 id changes=0 跳过。
   */
  const markCorrectedTx = db.transaction((ids: readonly string[], sessionId: string | null): number => {
    const now = deps.now();
    let applied = 0;
    for (const id of ids) {
      const info = stmtMarkCorrected.run(id);
      if (info.changes > 0) {
        applied += 1;
        stmtInsertAccess.run(newId(), id, 'corrected-cite', sessionId, now);
      }
    }
    return applied;
  });

  /** sweep 双清同拍单事务（批 18c-8——TTL 物化 + 访问日志窗口清扫，06 §3「同节拍同拍」兑现） */
  const sweepTx = db.transaction((now: number): { expired: number; accessPruned: number } => {
    const expired = stmtSweepExpired.run(now).changes;
    // 窗口下界 = now - 90d（天毫秒经参数绑定——MEMORY_ACCESS_WINDOW_DAYS 单源不落 SQL 字面量）
    const accessPruned = stmtSweepAccess.run(now - MEMORY_ACCESS_WINDOW_DAYS * MEMORY_DAY_MS).changes;
    return { expired, accessPruned };
  });

  /**
   * 导入直插事务体（批 18c-8——状态面第二写点）：secret 扫描单点执法 →
   * 幂等判定（id 已在整行跳过）→ 三写一体（全列直插 + FTS 投影 + 首版快照）。
   * 行形校验归 port.parseMemoryImportRow（词法判定单点）——本事务只兜
   * 闭集/区间防线（直调误用不破库）。
   */
  const importInsertTx = db.transaction((row: MemoryExportRow): boolean => {
    // —— 写前 secret 扫描（入库单点执法——导入面即写入面；诊断不回写疑似密钥本体）
    const summaryHits = scanForSecrets(row.summary);
    const contentHits = scanForSecrets(row.content);
    if (summaryHits.length > 0 || contentHits.length > 0) {
      const patterns = [...summaryHits, ...contentHits].map((h) => h.pattern).join(', ');
      warn(`[memory] 导入行写前 secret 扫描命中拒写：pattern=${patterns}（id：${row.id}）——疑似密钥本体不入诊断`);
      throw new BaseError('MEMORY_SECRET_DETECTED', `导入行写前 secret 扫描命中拒写（pattern：${patterns}）`);
    }
    // —— 域不变量兜底（闭集/owner 形/区间——词法全清单在 port；此处防直调坏形破库）
    const problems: string[] = [];
    if (!MEMORY_KINDS.includes(row.kind)) problems.push(`kind 非七值闭集：${String(row.kind)}`);
    if (!MEMORY_STATUSES.includes(row.status)) problems.push(`status 非三值闭集：${String(row.status)}`);
    if (row.owner_key !== 'global' && !OWNER_KEY_RE.test(row.owner_key)) {
      problems.push(`owner_key 形违例：${row.owner_key}`);
    }
    if (row.summary.trim() === '' || row.content.trim() === '') problems.push('summary/content 空');
    if (!Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) {
      problems.push(`confidence 越界 [0,1]：${row.confidence}`);
    }
    if (problems.length > 0) {
      throw new BaseError('MEMORY_ENTRY_INVALID', `导入行坏形拒：${problems.join('；')}`);
    }
    // —— 幂等判定：id 已在库整行跳过（恢复式语义——零合并零覆写，**含链**：
    // 在库行的随包版本链不重放不覆盖）
    if (stmtGet.get(row.id) !== undefined) return false;
    // —— 三写一体（同事务：主表全列直插 + FTS external-content 投影 + 版本链）
    const info = stmtImportInsert.run(
      row.id,
      row.owner_key,
      row.kind,
      row.summary,
      row.content,
      row.confidence,
      row.evidence_count,
      row.status,
      row.superseded_by,
      JSON.stringify(row.source_refs),
      row.created_at,
      row.updated_at,
      row.usage_count,
      row.last_used_at,
      row.corrected_count ?? 0,
      row.frozen ? 1 : 0,
      row.ttl_days,
      row.expires_at,
      row.valid_from ?? null,
    );
    stmtInsertFts.run(Number(info.lastInsertRowid), row.summary, row.content);
    if (row.versions && row.versions.length > 0) {
      // 批 ev-1 随包链重建：按 revision 升序逐行原值直搬（id/revision/cause/
      // reason/快照六列/created_at 全原值——历史事实不自造钟；revision 原值是
      // restore 参数跨机互操作的前提）。解析面已保证升序与词法，此处排序兜底。
      for (const v of [...row.versions].sort((a, b) => a.revision - b.revision)) {
        stmtImportInsertVersion.run(
          v.id,
          row.id,
          v.revision,
          v.owner_key,
          v.kind,
          v.summary,
          v.content,
          v.confidence,
          v.evidence_count,
          v.cause,
          v.reason ?? null,
          v.created_at,
        );
      }
    } else {
      // 无链行首版快造（18c-8 既有律）：快照内容面取导入行原值，版本行
      // id/created_at 用本库 now——本库时间线不自外来钟
      appendVersion(
        row.id,
        {
          ownerKey: row.owner_key,
          kind: row.kind,
          summary: row.summary,
          content: row.content,
          confidence: row.confidence,
          evidenceCount: row.evidence_count,
        },
        'insert',
        deps.now(),
      );
    }
    return true;
  });

  /* ---------------- 检索与读面实装 ---------------- */
  /**
   * listVisible 本体（**注入形**——批 ev-1 M2 拆形：常驻简报与 memory_read 无
   * id 腿共用的读面，TTL 段 AND 起点段）。管理形消费方（/memory 活体区）走
   * listVisibleForManagementImpl——两法同 SQL 骨架不同谓词形，直在本法扩段
   * 会把管理面未生效行一并滤掉、静默违反 06 §6 呈现边界，故拆形。
   */
  function listVisibleImpl(ownerKeys: readonly string[] | undefined): MemoryRow[] {
    const now = deps.now();
    if (!ownerKeys || ownerKeys.length === 0) {
      return (stmtListAll.all(now, now) as MemoryDbRow[]).map(mapRow);
    }
    // owner 并集读（单语句按需 prepare——owner 键组合开放、缓存无意义）
    const placeholders = ownerKeys.map(() => '?').join(', ');
    const stmt = db.prepare(
      `SELECT ${MEMORY_COLUMNS} FROM memories
       WHERE status = 'active' AND ${TTL_COND_INJECT}
         AND owner_key IN (${placeholders})
       ORDER BY updated_at DESC`,
    );
    return (stmt.all(now, now, ...ownerKeys) as MemoryDbRow[]).map(mapRow);
  }

  /** listVisible 管理形（TTL 段 only——/memory 活体区：未生效行可见〔「N天后生效」标注位〕） */
  function listVisibleForManagementImpl(ownerKeys: readonly string[] | undefined): MemoryRow[] {
    const now = deps.now();
    if (!ownerKeys || ownerKeys.length === 0) {
      const stmt = db.prepare(
        `SELECT ${MEMORY_COLUMNS} FROM memories
         WHERE status = 'active' AND ${TTL_COND_MANAGEMENT}
         ORDER BY updated_at DESC`,
      );
      return (stmt.all(now) as MemoryDbRow[]).map(mapRow);
    }
    const placeholders = ownerKeys.map(() => '?').join(', ');
    const stmt = db.prepare(
      `SELECT ${MEMORY_COLUMNS} FROM memories
       WHERE status = 'active' AND ${TTL_COND_MANAGEMENT}
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
    // 注入形谓词（memory_search 命中进模型上下文——起点段同过滤；两 now：TTL + 起点）
    const conds = [
      `m.status = 'active'`,
      `(m.frozen = 1 OR m.expires_at IS NULL OR m.expires_at > ?)
       AND (m.valid_from IS NULL OR m.valid_from <= ?)`,
    ];
    const params: unknown[] = [`"${sanitized}"`, now, now];
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

  /**
   * 谱系查询（批 ev-1 06 §7 memory_lineage——id 一站三链一读）。纯只读零迁移；
   * 管理面直读语义：不做起点/终态过滤（未生效行谱系照可查——audit 面不过滤
   * valid_from）。successor 解析三形：'llm:<id>' 可导航直取（缺席回退 marker
   * 诚实呈现原记号——链断不造钟）；'skill:<名>' 指路名不导航；'user'/
   * 'auto_resolved'/'ttl' 无目标形字面量呈现。active 行 null。
   */
  function lineageImpl(id: string): MemoryLineage {
    const row = mustGet(id);
    const versions = (stmtVersions.all(id) as VersionDbRow[]).map(mapVersionRow);
    const predecessors = (stmtPredecessors.all(`llm:${id}`) as MemoryDbRow[]).map(mapRow);
    let successor: MemoryLineage['successor'] = null;
    if (row.supersededBy !== null) {
      const llmTarget = row.supersededBy.startsWith('llm:') ? row.supersededBy.slice('llm:'.length) : null;
      successor =
        llmTarget !== null
          ? (stmtGet.get(llmTarget) as MemoryDbRow | undefined) !== undefined
            ? mapRow(stmtGet.get(llmTarget) as MemoryDbRow)
            : { marker: row.supersededBy } // 链断（目标行缺席）——原记号诚实呈现
          : { marker: row.supersededBy }; // 'skill:<名>'/'user'/'auto_resolved'/'ttl' 无目标形
    }
    return { row, versions, predecessors, successor };
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
    /** 管理形（批 ev-1 M2 拆形——/memory 活体区消费；未生效行可见） */
    listVisibleForManagement(ownerKeys) {
      return listVisibleForManagementImpl(ownerKeys);
    },
    versions(memoryId) {
      return (stmtVersions.all(memoryId) as VersionDbRow[]).map(mapVersionRow);
    },
    rebuildFts() {
      stmtRebuildFts.run();
    },
    forget(id, opts) {
      return forgetTx(id, opts?.promotedToSkill, opts?.supersededBy);
    },
    absorb(keepId, dropId, reason) {
      return absorbTx(keepId, dropId, reason);
    },
    decay(id, factor, reason) {
      return decayTx(id, factor, reason);
    },
    lineage(id) {
      return lineageImpl(id);
    },
    sweepExpired() {
      // 双清同拍单事务（TTL 物化 + 访问日志窗口清扫——纯状态变更不动 updated_at 不追加版本）
      return sweepTx(deps.now());
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
    resolveShortId(shortId) {
      return (stmtResolvePrefix.all(shortId) as { id: string }[]).map((r) => r.id);
    },
    markUsed(ids, sessionId) {
      return markUsedTx(ids, sessionId ?? null);
    },
    markCorrected(ids, sessionId) {
      return markCorrectedTx(ids, sessionId ?? null);
    },
    listForExport(ownerKey) {
      const rows =
        ownerKey === undefined
          ? (stmtListForExportAll.all() as MemoryDbRow[])
          : (stmtListForExportOwner.all(ownerKey) as MemoryDbRow[]);
      return rows.map(mapRow);
    },
    importInsert(row) {
      return importInsertTx(row);
    },
  };
}
