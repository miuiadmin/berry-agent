/**
 * persist — v1 基线 schema（05 篇 §9 表清单的 DDL 真源）。
 *
 * 七对象：events / sessions / store_state / credentials / model_catalog /
 * session_fts（FTS5 虚表）/ persist_incidents（毒丸 durable 标记，§6.3）。
 * 列级以 05 §9 表为准绳；本文件是唯一 DDL 事实源（迁移链增量归 migrations
 * 注册面，宿主聚合 core: 插件表族声明后并入）。
 *
 * 身份印记：application_id 写入恒定值（仅 forensics 用途——门禁走 user_version
 * 版本链 + 空库判定，05 §6.4；不为它立第二道门）。
 */

/** 库身份印记（'bage' ASCII——数据值位非标识符；门禁不消费，仅助外部 forensics） */
export const APPLICATION_ID = 0x6261_6765;

/** 基线 schema 版本（迁移链起点——v1 即首版六表 + 毒丸标记表，05 §6.4「从 1 起」） */
export const SCHEMA_VERSION = 1;

/**
 * v1 基线 DDL（全新库单事务一次到位——冷启动原子性，05 §6.5）。
 * 注释里的中文段说明不参与任何比对（本仓 v1 无指纹比对门禁，版本链即门禁）。
 */
export const CANONICAL_DDL = `
-- ── events：会话事件日志物理表（append-only；主键 = 会话内 seq 连续律载体）──
-- type 索引服务 eventsOfType 面（05 §9 表注）；时间维查询 v1 不建索引
-- （单人量级顺序扫毫秒级，真实量级再加——承 berry 同款裁决）。
CREATE TABLE events (
  session_id        TEXT    NOT NULL,
  seq               INTEGER NOT NULL,
  type              TEXT    NOT NULL,
  time              INTEGER NOT NULL,
  data              TEXT    NOT NULL,             -- JSON 快照（写入侧已冻结的拷贝序列化）
  ignorable         INTEGER NOT NULL DEFAULT 0,   -- 读侧向前兼容位（0/1）
  surface_op        TEXT,                         -- 遮蔽指令 JSON（仅改历史事件携带）
  source_event_seqs TEXT,                         -- 溯源 seq 数组 JSON（仅遮蔽指令携带）
  PRIMARY KEY (session_id, seq)
) STRICT;
CREATE INDEX idx_events_type ON events(type);

-- ── sessions：会话登记行（血缘三元组 + 工作区选取键；无归属列——会话直归
--    agent，05 §0；行由 write-behind 首写登记，血缘首登为准不回改）────────────
CREATE TABLE sessions (
  id             TEXT    PRIMARY KEY,
  title          TEXT,                            -- 标题（缺省 NULL；会话列表呈现面消费）
  origin         TEXT    NOT NULL,                -- 'conversation' | 'delegation' | 'import' | 'fork' | 'trigger'
  parent_id      TEXT,                            -- 血缘父会话（根会话 NULL）
  seed_length    INTEGER NOT NULL DEFAULT 0,      -- 种子前缀长度（fork/导入切片）
  workspace_root TEXT,                            -- 工作区根（按 cwd 取最新会话的选取键）
  created_at     INTEGER NOT NULL,                -- 毫秒时间戳
  updated_at     INTEGER NOT NULL,                -- 最后写批时刻（首写登记、批写推进）
  last_seq       INTEGER NOT NULL DEFAULT 0       -- 已落库最大 seq（批写推进）
) STRICT;
CREATE INDEX idx_sessions_workspace ON sessions(workspace_root);

-- ── store_state：插件持久键值统一面（03 篇受理制写面——受理执法在装载层，
--    物理层只供表与治理：LRU 256 帽 + ttl 过期清扫，05 §6.2）──────────────────
CREATE TABLE store_state (
  key              TEXT    PRIMARY KEY,
  value            TEXT    NOT NULL,              -- JSON 值
  expires_at       INTEGER,                       -- ttl 到期时刻（NULL = 永不过期）
  kind             TEXT    NOT NULL DEFAULT 'kv', -- 值类别标签（消费方自释义）
  last_accessed_at INTEGER NOT NULL               -- 读写触达即刷新（LRU 逐出依据）
) STRICT;

-- ── credentials：凭证表（api_key 列 AES-256-GCM 密文；0600 纪律见 openStore）──
CREATE TABLE credentials (
  provider   TEXT    PRIMARY KEY,
  api_key    TEXT    NOT NULL,                    -- v1:<base64(iv|tag|ct)>（secret-box 加密产物）
  meta       TEXT,                                -- JSON 附加元数据（可空）
  updated_at INTEGER NOT NULL
) STRICT;

-- ── model_catalog：模型目录（06/07 篇消费；物理 CRUD 面在本模块）──────────────
CREATE TABLE model_catalog (
  id         TEXT PRIMARY KEY,                    -- 模型全名（provider/model 形）
  provider   TEXT NOT NULL,
  label      TEXT,                                -- 呈现名（可空）
  meta       TEXT,                                -- JSON 元数据（上下文窗/定价等，可空）
  updated_at INTEGER NOT NULL
) STRICT;
CREATE INDEX idx_model_catalog_provider ON model_catalog(provider);

-- ── session_fts：全文搜索索引（FTS5；派生索引可整体重建——对账三档，05 §9）──
-- tokenize=trigram：中英混排 substring 检索；session_id/seq UNINDEXED——MATCH
-- 只打 body，命中行携带定位（会话内检索查询面限定 session_id 过滤，首发口径）。
CREATE VIRTUAL TABLE session_fts USING fts5(
  session_id UNINDEXED,
  seq       UNINDEXED,
  body,
  tokenize='trigram'
);

-- ── persist_incidents：毒丸隔离 durable 标记（§6.3——物理层自账，只增不删）──
CREATE TABLE persist_incidents (
  id         INTEGER PRIMARY KEY,
  time       INTEGER NOT NULL,
  session_id TEXT,                                -- 被隔离事件所属会话（可空：非事件类故障）
  seq        INTEGER,                             -- 被隔离事件 seq
  type       TEXT,                                -- 被隔离事件类型
  reason     TEXT    NOT NULL                     -- 违例原因（SQLite 码 + 消息）
) STRICT;
`;
