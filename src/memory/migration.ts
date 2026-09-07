/**
 * memory 表族迁移（三槽——06 §3 表族三迁移槽；05 §6.4「号随注册序顺延」：
 * 批 15a scheduler 占 v2、批 15b goal 占 v3 后本件顺占 v4/v5/v6。obs 自管库
 * 〔批 18b〕不入主库迁移链、无占号）。
 *
 * 槽次序恒定（06 §3 拍板——表族主迁移 → 效用两列 → 持有面三列 + 两新表）：
 *   v4 memory-family   —— memories 主表 + memory_fts 全文检索投影；
 *   v5 memory-utility  —— usage_count / last_used_at 效用两列（存量行
 *                          DEFAULT 0 / NULL 自然回填——行为零变）；
 *   v6 memory-holding —— frozen / ttl_days / expires_at 持有面三列（存量行
 *                          0 / NULL / NULL 回填——无 TTL，行为零变）+
 *                          memory_versions 版本链 + memory_access 访问日志。
 *
 * DDL 真源 = 06 §3（列级以彼为准绳）；memories 主表 v4 起建即含 CHECK 闭集
 * （kind 七值 / status 三值——physical 层防线，与 02 §5.3 MEMORY_ENTRY_INVALID
 * 候选校验互为两道闸）；索引 idx_memories_owner_kind_status 为本批落码定形
 * （合并目标扫描 + 可见清单读面的服务索引，06 §3 未钉——物理细节件自决）。
 */
import type { MigrationSpec } from '../persist/index.js';

/** v4：表族主迁移（memories + memory_fts——external-content 投影，可丢弃可重建） */
const MEMORY_FAMILY_MIGRATION: MigrationSpec = {
  version: 4,
  name: 'memory-family',
  sql: `
    CREATE TABLE memories (
      id              TEXT PRIMARY KEY,      -- uuid v7（时间有序，排序免索引）
      owner_key       TEXT NOT NULL,         -- 'global' | 'project:<根路径哈希>'
      kind            TEXT NOT NULL CHECK (kind IN ('preference', 'fact', 'convention', 'correction', 'failure', 'insight', 'profile')),
      summary         TEXT NOT NULL,         -- 一句话摘要——合并与冲突判定的比较面
      content         TEXT NOT NULL,         -- 全文（注入用）
      confidence      REAL NOT NULL,         -- 0..1，合并取 max
      evidence_count  INTEGER NOT NULL DEFAULT 1,
      status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'dismissed', 'expired')),
      superseded_by   TEXT,                  -- 终态来源记号（active 行 NULL）
      source_refs     TEXT NOT NULL DEFAULT '[]',  -- JSON [{sessionId, seq}]（铁律 5 溯源）
      created_at      INTEGER NOT NULL,      -- Unix 毫秒
      updated_at      INTEGER NOT NULL       -- Unix 毫秒（老化判定基准）
    ) STRICT;
    CREATE INDEX idx_memories_owner_kind_status ON memories (owner_key, kind, status);
    -- 全文检索投影：external-content（真身 = memories.rowid；trigram 中英混排
    -- substring 检索——unicode61 会把连续中文段切成整 token，06 §3 权衡注）
    CREATE VIRTUAL TABLE memory_fts USING fts5(
      summary,
      content,
      content=memories,
      content_rowid=rowid,
      tokenize='trigram'
    );
  `,
};

/** v5：效用两列（§5 效用维度的计量面——聚合列权威、流水面归 v6 访问日志表） */
const MEMORY_UTILITY_MIGRATION: MigrationSpec = {
  version: 5,
  name: 'memory-utility',
  sql: `
    ALTER TABLE memories ADD COLUMN usage_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE memories ADD COLUMN last_used_at INTEGER;
  `,
};

/** v6：持有面三列 + 版本链 + 访问日志（承 berry 持有面优先拍板） */
const MEMORY_HOLDING_MIGRATION: MigrationSpec = {
  version: 6,
  name: 'memory-holding',
  sql: `
    ALTER TABLE memories ADD COLUMN frozen INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE memories ADD COLUMN ttl_days INTEGER;
    ALTER TABLE memories ADD COLUMN expires_at INTEGER;
    -- 条目级版本链（append-only——插入即落首版；快照六列与触发清单严格同集）
    CREATE TABLE memory_versions (
      id              TEXT PRIMARY KEY,      -- uuid v7
      memory_id       TEXT NOT NULL,
      revision        INTEGER NOT NULL,      -- 条目内递增（1 起）
      owner_key       TEXT NOT NULL,         -- 以下六列 = 快照内容面
      kind            TEXT NOT NULL,
      summary         TEXT NOT NULL,
      content         TEXT NOT NULL,
      confidence      REAL NOT NULL,
      evidence_count  INTEGER NOT NULL,
      cause           TEXT NOT NULL CHECK (cause IN ('insert', 'merge', 'decay', 'rollback')),
      created_at      INTEGER NOT NULL       -- Unix 毫秒
    ) STRICT;
    CREATE INDEX idx_versions_memory ON memory_versions (memory_id, revision);
    -- 访问日志（效用计量流水——recall/search/cite 三写点，聚合面 §6 引用回写）
    CREATE TABLE memory_access (
      id              TEXT PRIMARY KEY,      -- uuid v7
      memory_id       TEXT NOT NULL,
      op              TEXT NOT NULL CHECK (op IN ('recall', 'search', 'cite')),
      session_id      TEXT,                  -- search 行恒 NULL（工具上下文无会话键）
      ts              INTEGER NOT NULL       -- Unix 毫秒
    ) STRICT;
    CREATE INDEX idx_access_memory_ts ON memory_access (memory_id, ts);
  `,
};

/** 表族三迁移槽（host 装配根机械聚合入宿主单链——05 §6.4；export-only 本面） */
export const MEMORY_MIGRATIONS: readonly MigrationSpec[] = [
  MEMORY_FAMILY_MIGRATION,
  MEMORY_UTILITY_MIGRATION,
  MEMORY_HOLDING_MIGRATION,
];
