/**
 * persist — 派生库开库面（aux 面；03 §10.8 件身份条款 + 05 §6.4 表族入主库
 * 迁移链例外清单〔memory/goal/scheduler〕不含 obs 的执法位）。
 *
 * 面向「可禁用 core: 件的派生存储」：调用方（obs 等）经本公开面拿
 * better-sqlite3 Database 实例，自建表、自管版本（PRAGMA user_version 归
 * 调用方——与主库 user_version 门禁分立不串档）。本函数只做物理卫生三拍：
 * 父目录代建 + WAL 编舞（busy_timeout/WAL/synchronous=FULL——与主库开库
 * 同一拍单源复用 store.prepareWal）+ 库文件 0600 自检修复。
 *
 * better-sqlite3 只准出现在 persist（02 §4.2 native 隔离律）——本面是
 * 该律对派生库场景的延伸出口：obs 件经公开面拿实例、自身不 import
 * better-sqlite3。
 */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { repairFileMode } from './paths.js';
import { prepareWal } from './store.js';

/** openAuxDatabase 选项 */
export interface OpenAuxDatabaseOptions {
  /** 告警面（权限修复/WAL 降级——缺省 console.error） */
  readonly warn?: (message: string) => void;
}

/**
 * 打开派生库（物理卫生三拍；无版本门禁——schema 主权归调用方）。
 * @param dbPath 库文件路径（':memory:' 内存形态同样支持——诊断/测试位）
 * @returns 就绪的 Database（调用方负责建表与 close）
 */
export function openAuxDatabase(dbPath: string, options: OpenAuxDatabaseOptions = {}): Database.Database {
  const warn = options.warn ?? ((message) => console.error(message));
  const inMemory = dbPath === ':memory:';

  if (!inMemory) {
    // 库父目录须在场（better-sqlite3 不代建目录；openStore 同款）
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  prepareWal(db, warn);

  if (!inMemory) {
    // 库文件 0600 自检修复（派生库同持操作者数据——权限面与主库一致）
    repairFileMode(dbPath, '派生库文件', warn);
  }

  return db;
}
