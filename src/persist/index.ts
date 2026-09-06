/**
 * persist 模块公开面（L2 物理存储——02 篇模块清单席 11；机制真源 05 篇 §6/§9）。
 *
 * 本批落码：SQLite 单后端 WAL + v1 基线 schema（七对象）+ user_version 迁移
 * 门禁（TOO_NEW 拒开/缺口备份迁移/冷启动单事务）+ write-behind 批落链（微任务
 * 节流/批帽 64/指数退避/毒丸隔离·durable 标记/flush 屏障）+ Persistence 门面
 * （SessionLog 接线/种子会话同步落库）+ 凭证密文盒（AES-256-GCM）+ 主库
 * 归属三级梯子 + store_state LRU 治理 + session_fts 对账三档。
 * 消费面（host 装配根/ctx.sessions 只读服务/core: 插件 DAO）随后续批接线。
 */
import './codes.js';

export { APPLICATION_ID, SCHEMA_VERSION, CANONICAL_DDL } from './schema.js';
export type { MigrationSpec } from './migrations.js';
export { normalizeMigrations } from './migrations.js';
export {
  DATA_DIR_ENV,
  DB_PATH_ENV,
  DEFAULT_DATA_DIR_BASENAME,
  DEFAULT_DB_BASENAME,
  MEMORY_DB_PATH,
  resolveDataDir,
  resolveDatabasePath,
  ensureDataDir,
} from './paths.js';
export {
  SECRET_KEY_BASENAME,
  loadOrCreateSecretKey,
  encryptSecret,
  decryptSecret,
  ephemeralSecretKey,
} from './secret-box.js';
export { openStore, Store } from './store.js';
// 同实例句柄窄面的类型出口（批 15a——core: 插件 DAO 接线位）：better-sqlite3
// 裸导入仍只准 persist（native 隔离律），消费侧经此类型导入取得 Database 形。
export type { Database as SqliteDatabase } from 'better-sqlite3';
export type {
  EventWrite,
  IncidentEntry,
  WriteTarget,
  QueryEventsFilter,
  QueryEventsResult,
  SessionRegistration,
  SessionRow,
  StoreStateEntry,
  CredentialEntry,
  ModelRow,
  FtsAuditResult,
  FtsRebuildResult,
  OpenStoreOptions,
} from './store.js';
export { WriteBehind } from './write-behind.js';
export type { WriteBehindOptions } from './write-behind.js';
export { Persistence } from './persistence.js';
export type { PersistenceOptions, CreateSessionInit, LoadedSession } from './persistence.js';
