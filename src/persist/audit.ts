/**
 * persist — 进程级 durable 审计流（05 篇 §9 audit_events 表——U3 落码批 U3-2）。
 *
 * 载体定位：非会话流的独立审计面——boot 装载序/开门制/高危面使用的记账词
 * （plugin/opens·capability/used 等）落此表；会话事件词落 session log，两流
 * 分立（05 §1.1 表注：审计词入词汇注册表得核心词身份，但载体是 audit_events
 * 非会话 append 面）。写入面三方法：
 *  - append 直写非 write-behind——审计崩溃安全优先：会话事件可批落（丢批可
 *    重放），审计事实落账即证据，批落延迟不可接受；
 *  - lastOf 尾读——boot 序 plugin/opens 幂等 diff 的判据源（fold = 审计流
 *    尾条 = 该插件当前有效授予面）；
 *  - listRecent 逆序近期清单——诊断/人面呈现用。
 *
 * 词汇闸（append 前置，fail-loud）：type 必须已在事件词汇注册表
 * （contracts/events.ts）且类别为 log-only——审计流不收 surface/snapshot/
 * structure 词（进模型历史或 fold 判定输入的词归会话流管辖）；违例抛普通
 * Error（编程错误档，与 normalizeMigrations 装配期错误同款——调用方是宿主
 * 固定件，无按码分派面，不占 PERSIST_ 码族）。
 *
 * 表形：id INTEGER PRIMARY KEY（单调自增即全局序）/ time / type / data，
 * STRICT；无索引（05 §9——量级极小：boot 幂等 diff + 高危面逐次记账，尾读/
 * 近期读全表扫代价可忽略，索引随量级证据再立）。
 */
import type Database from 'better-sqlite3';
import { BaseError, getEventTypeMeta } from '../contracts/index.js';
import type { MigrationSpec } from './migrations.js';

/**
 * audit_events 建表迁移项（05 §9）。占号 v8——号随注册序顺延：scheduler v2 /
 * goal v3 / memory v4-6 / credentials v7 之后。声明 export-only：宿主装配根
 * HOST_MIGRATION_TAIL 机械聚合（05 §6.4——声明来自件、执行在宿主）。
 */
export const AUDIT_MIGRATION: MigrationSpec = {
  version: 8,
  name: 'audit-events',
  sql: 'CREATE TABLE audit_events (id INTEGER PRIMARY KEY, time INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL) STRICT',
};

/** 审计流行（读面已解析形——data 为对象非 JSON 串） */
export interface AuditEventRow {
  /** 全局单调序（主键自增） */
  readonly id: number;
  /** 落账时刻（epoch 毫秒——写入面挂钟注入） */
  readonly time: number;
  /** 事件类型（词汇注册表 log-only 词） */
  readonly type: string;
  /** 载荷（词形由事件词汇注册表 description 定） */
  readonly data: Record<string, unknown>;
}

/** 审计流写入/读取面（createAuditFace 构造；单写者 = 宿主固定件） */
export interface AuditFace {
  /**
   * 直写落账。词汇闸在前（非注册词/非 log-only 词抛普通 Error——编程错误档，
   * 见文件头）；过闸即 INSERT，无缓冲。
   */
  append(type: string, data: Record<string, unknown>): void;
  /** 尾读：该词最近一条；从未落过 → undefined（幂等 diff 的判据源） */
  lastOf(type: string): AuditEventRow | undefined;
  /** 逆序近期清单（id 降序；limit 缺省 100） */
  listRecent(limit?: number): readonly AuditEventRow[];
}

/** listRecent 缺省帽（诊断/呈现面一屏量） */
const LIST_RECENT_DEFAULT = 100;

/** 库行原始形（data 列为 JSON 串——读面解析前） */
interface RawAuditRow {
  id: number;
  time: number;
  type: string;
  data: string;
}

/**
 * 构造审计流面。词汇闸以 contracts 事件注册表为判据（模块加载即含全部
 * 核心词——计数随批增长以注册表为单源，此处不复述数字防漂移；插件扩展
 * 词经 registerEventType 亦即时可达）。
 * @param db 已开库句柄（audit_events 表须已由迁移链建就——表不在则首笔
 *   INSERT 即 SQLite 报错，fail-loud 不静默）
 * @param clock 挂钟注入（测试假钟；缺省 Date.now）
 */
export function createAuditFace(db: Database.Database, clock: () => number = Date.now): AuditFace {
  // 三语句构造期预编译（better-sqlite3 惯例——句柄复用免逐笔 parse）
  const insertStmt = db.prepare('INSERT INTO audit_events (time, type, data) VALUES (?, ?, ?)');
  const lastByTypeStmt = db.prepare(
    'SELECT id, time, type, data FROM audit_events WHERE type = ? ORDER BY id DESC LIMIT 1',
  );
  const recentStmt = db.prepare('SELECT id, time, type, data FROM audit_events ORDER BY id DESC LIMIT ?');

  /** 单行解析：data JSON 串 → 对象形；坏形 fail-loud（宁崩不误读） */
  const parseRow = (row: RawAuditRow): AuditEventRow => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.data);
    } catch {
      throw new BaseError(
        'PERSIST_DATA_CORRUPT',
        `审计流行 #${row.id}（${row.type}）data 非法 JSON——库文件损坏，拒误读`,
      );
    }
    // JSON 合法但非对象形（串/数组/数字）同为坏形——data 词形恒为对象
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new BaseError('PERSIST_DATA_CORRUPT', `审计流行 #${row.id}（${row.type}）data 非对象形——拒误读`);
    }
    return { id: row.id, time: row.time, type: row.type, data: parsed as Record<string, unknown> };
  };

  return {
    append(type, data) {
      // 词汇闸两档（写入面前置——先于任何库操作）：
      const meta = getEventTypeMeta(type);
      if (meta === undefined) {
        throw new Error(`审计流 append 词汇闸红：事件类型 ${type} 未在词汇注册表——先注册再落账（fail-loud）`);
      }
      if (meta.category !== 'log-only') {
        throw new Error(
          `审计流 append 词汇闸红：事件类型 ${type} 类别为 ${meta.category}——审计流只收 log-only 词，surface/snapshot/structure 词归会话流管辖`,
        );
      }
      insertStmt.run(clock(), type, JSON.stringify(data));
    },

    lastOf(type) {
      const row = lastByTypeStmt.get(type) as RawAuditRow | undefined;
      return row === undefined ? undefined : parseRow(row);
    },

    listRecent(limit = LIST_RECENT_DEFAULT) {
      const rows = recentStmt.all(limit) as RawAuditRow[];
      return rows.map(parseRow);
    },
  };
}
