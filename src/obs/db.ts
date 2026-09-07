/**
 * obs — rollup 自管库 DDL 与开库（03 §10.8 rollup 表族条款）。
 *
 * 库文件 = `<dataDir>/data/obs/rollup.db`（路径由装配面算好传入——本件
 * 不解析数据目录梯子）。开库经 persist 公开面 openAuxDatabase（物理卫生
 * 三拍单源）；schema 主权归本件：PRAGMA user_version 自管（本库文件私有
 * ——与主库 user_version 门禁物理分立不串档）。
 *
 * 版本编舞：0（全新/空）→ 单事务建全表 + 落 v1；1 → 直通；>1 → 拒开
 * （OBS_DB_OPEN_FAILED——旧程序开新库宁拒不误读，openStore 的
 * PERSIST_SCHEMA_TOO_NEW 同律）。
 */
import { BaseError } from '../contracts/index.js';
import { openAuxDatabase, type SqliteDatabase } from '../persist/index.js';

/** rollup schema 版本（本件唯一版本位——自管，随表族演进递增） */
export const OBS_SCHEMA_VERSION = 1;

/**
 * rollup 表族 DDL（两粒度三表一视图一元表；桶列恒 UTC 整点/整日对齐的
 * epoch ms——存储客观、时区换算归呈现层）。
 *
 * - events_hour/events_day：全 durable 事件类型按桶计数（PRIMARY KEY
 *   (bucket, event_type)——脏桶重算 DELETE+INSERT 的替换单元）；
 * - usage_hour/usage_day：llm/usage 计量聚合（token 原始值；四桶必列 +
 *   两可选列缺省 0——行级非空，坏行的拒读判据在查询面）；
 * - deprecation_rollup_hour 视图：plugin/deprecation-used 单型投影
 *   （03 §2 命名兑现零第二张表）；
 * - obs_meta：水位与告警冷却键值位。
 */
const CANONICAL_DDL = `
CREATE TABLE events_hour (
  bucket INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, event_type)
);
CREATE TABLE usage_hour (
  bucket INTEGER NOT NULL,
  calls INTEGER NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  cache_write_1h INTEGER NOT NULL DEFAULT 0,
  reasoning INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket)
);
CREATE TABLE events_day (
  bucket INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (bucket, event_type)
);
CREATE TABLE usage_day (
  bucket INTEGER NOT NULL,
  calls INTEGER NOT NULL,
  input INTEGER NOT NULL,
  output INTEGER NOT NULL,
  cache_read INTEGER NOT NULL,
  cache_write INTEGER NOT NULL,
  cache_write_1h INTEGER NOT NULL DEFAULT 0,
  reasoning INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket)
);
CREATE VIEW deprecation_rollup_hour AS
  SELECT bucket, count FROM events_hour WHERE event_type = 'plugin/deprecation-used';
CREATE TABLE obs_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

/**
 * 打开 rollup 库（开库 + 版本编舞；失败抛 OBS_DB_OPEN_FAILED——装载面
 * 降级跳件）。
 * @param dbPath 库文件路径（':memory:' 支持——测试位）
 * @param warn 告警面（透传 openAuxDatabase——权限修复/WAL 降级）
 */
export function openRollupDatabase(
  dbPath: string,
  warn: (message: string) => void = (message) => console.error(message),
): SqliteDatabase {
  let db: SqliteDatabase;
  try {
    db = openAuxDatabase(dbPath, { warn });
  } catch (err) {
    // 开库/建链失败 fail-loud（03 §10.8——不拖垮宿主由装载面消费本码降级）
    throw new BaseError(
      'OBS_DB_OPEN_FAILED',
      `rollup 库开库失败（${dbPath}）：${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? { cause: err } : undefined,
    );
  }

  const row = db.pragma('user_version', { simple: true });
  const version = typeof row === 'number' ? row : 0;

  try {
    if (version > OBS_SCHEMA_VERSION) {
      db.close();
      throw new BaseError(
        'OBS_DB_OPEN_FAILED',
        `rollup 库 ${dbPath} 的 user_version=${version} 高于本件 head=${OBS_SCHEMA_VERSION}（旧程序开新库拒开——宁拒不误读）`,
      );
    }
    if (version === 0) {
      // 全新库单事务建链（原子性——openStore 冷启动同律）
      const bootstrap = db.transaction(() => {
        db.exec(CANONICAL_DDL);
        db.pragma(`user_version = ${OBS_SCHEMA_VERSION}`);
      });
      bootstrap();
    }
  } catch (err) {
    // 建链中途失败：关库再抛 OBS 码（不留半开句柄）
    try {
      db.close();
    } catch {
      /* close 自身失败不掩原错误 */
    }
    if (err instanceof BaseError) throw err;
    throw new BaseError(
      'OBS_DB_OPEN_FAILED',
      `rollup 库建链失败（${dbPath}）：${err instanceof Error ? err.message : String(err)}`,
      err instanceof Error ? { cause: err } : undefined,
    );
  }

  return db;
}
