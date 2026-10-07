/**
 * persist 模块公开面（L2 物理存储——02 篇模块清单席 11；机制真源 05 篇 §6/§9）。
 *
 * 本批落码：SQLite 单后端 WAL + v1 基线 schema（七对象）+ user_version 迁移
 * 门禁（TOO_NEW 拒开/缺口备份迁移/冷启动单事务）+ write-behind 批落链（微任务
 * 节流/批帽 64/指数退避/毒丸隔离·durable 标记/flush 屏障）+ Persistence 门面
 * （SessionLog 接线/种子会话同步落库）+ 凭证密文盒（AES-256-GCM）+ 主库
 * 归属三级梯子 + store_state LRU 治理 + session_fts 对账三档。
 * 消费面（host 装配根 Persistence 门面 / ctx.sessions 'sessions' 服务面 /
 * core:memory 插件 DAO）均已接线。
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
  resolveDatabasePathIn,
  ensureDataDir,
} from './paths.js';
export {
  SECRET_KEY_BASENAME,
  loadOrCreateSecretKey,
  encryptSecret,
  decryptSecret,
  ephemeralSecretKey,
} from './secret-box.js';
export { openStore, Store, sanitizeTitleText, clampTitleText, sessionDisplayTitleOf } from './store.js';
// sessions 档案两列迁移项（05 §9 专列兑现注——v13，2026-09-21）：export-only
// （宿主装配根 HOST_MIGRATION_TAIL 机械聚合——audit v8 / load-generations v10
// 同形）；读路合并单源 sessionDisplayTitleOf 同批导出（八装配位消费）
export { SESSION_ARCHIVE_MIGRATION } from './store.js';
// 进程级 durable 审计流（05 §9 audit_events——U3 落码批 U3-2）：迁移项声明
// export-only（宿主装配根 HOST_MIGRATION_TAIL 机械聚合——同 credentials v7
// 形）；写入面经库句柄构造，单写者 = 宿主固定件（boot 幂等 diff/高危面记账）
export { AUDIT_MIGRATION, createAuditFace } from './audit.js';
export type { AuditFace, AuditEventRow } from './audit.js';
// 装载史 durable 载体（05 §9 load_generations——装载史批 h-2）：迁移项声明
// export-only（宿主装配根 HOST_MIGRATION_TAIL 机械聚合——audit v8 同形）；
// 写点 = 宿主装配根（boot 完成点 + /reload reapply 尾，h-3 接线），CLI 卸载
// 腿只读消费（uninstall 双回执有源化，h-4 接线）
export { LOAD_GENERATIONS_MIGRATION, createLoadHistoryFace } from './load-history.js';
export type {
  LoadGenerationActivated,
  LoadGenerationSkipped,
  LoadGenerationFailed,
  LoadGenerationSnapshot,
  LoadHistoryFace,
} from './load-history.js';
// 分项目输入历史（05 §9 input_history——2026-10-05 ZCode TUI 对标批 B1）：
// 迁移项声明 export-only（宿主装配根 HOST_MIGRATION_TAIL 机械聚合——audit
// v8 / load-generations v10 同形）；两方法窄面 record/recentTexts 经库句柄
// 构造，单写者 = 宿主装配根（Editor onHistoryAdd 闭包镜像位——种写双路的
// 写路；种子路 = recentTexts 启动播种）
export { INPUT_HISTORY_MIGRATION, INPUT_HISTORY_CAP, createInputHistoryFace } from './input-history.js';
export type { InputHistoryFace, InputHistoryRecordInput } from './input-history.js';
// 附件库读写面（03 §10.4 ③ 2026-10-08 剪贴板附件批——sha256 内容寻址文件
// 旁路，零新表零迁移）：write 幂等落盘 / read 按 ref 读回两方法窄面经
// dataDir 注入构造；ext→MIME 单源映射随面导出（webui 读回端点 ③ 消费位
// Content-Type 派生源）；零新错误注册码（拒形态与 fail-loud 上抛形见模块头注）
export { ATTACHMENT_EXT_WHITELIST, ATTACHMENT_MIME_BY_EXT, createAttachmentStore } from './attachment-store.js';
export type { AttachmentStore, AttachmentExt, AttachmentWriteResult, AttachmentRecord } from './attachment-store.js';
// 派生库开库面（批 18b——03 §10.8 obs 自管库文件的执法位：物理卫生三拍
// 单源复用，schema 主权归调用方）
export { openAuxDatabase } from './aux.js';
export type { OpenAuxDatabaseOptions } from './aux.js';
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
  FtsGlobalHit,
  OpenStoreOptions,
} from './store.js';
export { WriteBehind } from './write-behind.js';
export type { WriteBehindOptions } from './write-behind.js';
export { Persistence } from './persistence.js';
export type { PersistenceOptions, CreateSessionInit, LoadedSession } from './persistence.js';
