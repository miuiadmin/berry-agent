/**
 * persist — SQLite 物理层 Store（05 篇 §6 物理存储 / §9 schema 的落码面）。
 *
 * 职责边界：本文件只做「表的读写与库的治理」——事件批写（含 FTS 同批对账与
 * sessions 行 upsert）/ 读原语（loadEvents 撕裂尾 heal、queryEvents 过滤维）/
 * store_state·credentials·model_catalog·incidents 四小面 / FTS 重建与抽样审计 /
 * 开库门禁序（版本链 + 备份 + 权限）。队列编舞（节流/退避/毒丸分类）在
 * write-behind.ts——两文件经 WriteTarget 窄接口耦合。
 */
import Database from 'better-sqlite3';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BaseError, getEventTypeMeta, type SessionEvent, type SessionOrigin } from '../contracts/index.js';
import { snapshotJsonValue } from '../session/index.js';
import { normalizeMigrations, type MigrationSpec } from './migrations.js';
import { ensureDataDir, MEMORY_DB_PATH, repairFileMode, resolveDataDir } from './paths.js';
import { decryptSecret, encryptSecret, ephemeralSecretKey, loadOrCreateSecretKey } from './secret-box.js';
import { APPLICATION_ID, CANONICAL_DDL, SCHEMA_VERSION } from './schema.js';

/** 会话登记信息（sessions 行身份列——enqueue 时快照，首登为准不回改） */
export interface SessionRegistration {
  /** 血缘形态（origin 闭集四值） */
  readonly origin: SessionOrigin;
  /** 血缘父会话（根会话 = undefined） */
  readonly parentId: string | undefined;
  /** 种子前缀长度 */
  readonly seedLength: number;
  /** 工作区根（「按 cwd 取最新会话」选取键；无工作区会话 = undefined） */
  readonly workspaceRoot: string | undefined;
  /** 标题（可空——auto-title 后经 updateSessionTitle 独立更新） */
  readonly title: string | undefined;
}

/** 写队列条目（write-behind → Store 的窄载荷：事件 + 所属会话登记快照） */
export interface EventWrite {
  readonly sessionId: string;
  readonly event: SessionEvent;
  readonly registration: SessionRegistration;
}

/** 毒丸隔离 durable 标记条目（persist_incidents 行——§6.3） */
export interface IncidentEntry {
  readonly time: number;
  readonly sessionId?: string;
  readonly seq?: number;
  readonly type?: string;
  readonly reason: string;
}

/**
 * write-behind 的写入目标窄接口（注入缝——测试用假目标编排断言；Store 是
 * 唯一真身实现）。
 */
export interface WriteTarget {
  /** 批写：单事务写一组条目（events + fts 同批 + sessions upsert + 连续性校验） */
  writeEvents(writes: readonly EventWrite[]): void;
  /** 行写：毒丸诊断模式下单条独立事务（失败原样抛，分类归 write-behind） */
  writeEventSingle(write: EventWrite): void;
  /** 毒丸记账：不落行但推进该会话游标（seq 连续律账面对齐——后续事件可续写） */
  accountDropped(sessionId: string, seq: number): void;
  /** 毒丸 durable 标记落账（persist_incidents 只增不删） */
  recordIncident(entry: IncidentEntry): void;
}

/** queryEvents 过滤维（05 §3.4：会话 id / 时间窗 / 类型 / seq 窗口 + 游标） */
export interface QueryEventsFilter {
  readonly sessionId?: string;
  readonly types?: readonly string[];
  readonly sinceMs?: number;
  readonly untilMs?: number;
  readonly fromSeq?: number;
  readonly toSeq?: number;
  /** 上限（缺省 1000，硬帽 10000——越帽值截到帽） */
  readonly limit?: number;
  /** 分页游标（上页 nextCursor 原样回传；null/undefined = 首页） */
  readonly cursor?: string | null;
}

/** queryEvents 结果（游标 = 下一页起点的不透明令牌；null = 无更多） */
export interface QueryEventsResult {
  readonly events: SessionEvent[];
  readonly nextCursor: string | null;
}

/** sessions 行读形态 */
export interface SessionRow {
  readonly id: string;
  readonly title: string | undefined;
  readonly origin: SessionOrigin;
  readonly parentId: string | undefined;
  readonly seedLength: number;
  readonly workspaceRoot: string | undefined;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastSeq: number;
}

/** store_state 读形态 */
export interface StoreStateEntry {
  readonly key: string;
  readonly value: unknown;
  readonly kind: string;
  readonly expiresAt: number | undefined;
}

/** credentials 读形态（api_key 已解密——持有面在内存，勿外泄日志） */
export interface CredentialEntry {
  /** 归属域（'host' | 'plugin:<id>'——值域词面单源在 core:credentials 件，物理层不执法） */
  readonly namespace: string;
  readonly provider: string;
  readonly apiKey: string;
  readonly meta: unknown;
  readonly updatedAt: number;
}

/** model_catalog 行读形态 */
export interface ModelRow {
  readonly id: string;
  readonly provider: string;
  readonly label: string | undefined;
  readonly meta: unknown;
  readonly updatedAt: number;
}

/** FTS 抽样审计结果（05 §9 对账第三档——启动时抽样；发现缺口即全量重建） */
export interface FtsAuditResult {
  readonly checked: number;
  readonly mismatches: readonly { sessionId: string; expected: number; actual: number }[];
}

/** FTS 全量重建结果（派生物不修不补——重建即修复） */
export interface FtsRebuildResult {
  readonly sessions: number;
  readonly events: number;
}

/** 跨会话 FTS 命中行（05 §9 追记①——查询面限定解除：无 session 过滤；body 为索引投影原文，消费侧自切 snippet） */
export interface FtsGlobalHit {
  readonly sessionId: string;
  readonly seq: number;
  readonly body: string;
}

/** openStore 选项 */
export interface OpenStoreOptions {
  /** 库文件路径（':memory:' = 内存库——诊断形态；缺省 :memory:——host 装配根才落梯子） */
  readonly dbPath?: string;
  /** 数据目录（secret.key 归属地与 0700 治理位；缺省 resolveDataDir()） */
  readonly dataDir?: string;
  /** 聚合迁移链（host 装配根机械聚合 core: 插件声明；本批恒空） */
  readonly migrations?: readonly MigrationSpec[];
  /** 告警面（权限修复/撕裂尾 heal 等——缺省 console.error） */
  readonly warn?: (message: string) => void;
  /** 时间注入（缺省 Date.now——测试假钟） */
  readonly clock?: () => number;
  /** 凭证密钥注入（测试位；缺省：文件库 = 数据目录 loadOrCreateSecretKey，内存库 = 临时密钥） */
  readonly secretKey?: Buffer;
}

/** queryEvents 缺省页帽与硬帽 */
const QUERY_LIMIT_DEFAULT = 1000;
const QUERY_LIMIT_MAX = 10000;

/** store_state LRU 帽（05 §6.2） */
const STORE_STATE_LRU_CAP = 256;

/**
 * 打开库（门禁序，05 §6.4/§6.5/§6.6）：
 * 目录确保（数据目录 0700 + 库父目录存在）→ 开库 → WAL 编舞（busy_timeout +
 * 探测 + 同步退避）→ 库文件 0600 自检修复 → 版本门禁（全新库单事务建链 /
 * 高于 head 拒开 / 低于 head 备份后逐版迁移）→ 密钥装配。
 * @returns 就绪的 Store（调用方负责 close——退出 checkpoint 编舞在 close 内）
 */
export function openStore(options: OpenStoreOptions = {}): Store {
  const warn = options.warn ?? ((message) => console.error(message));
  const dbPath = options.dbPath ?? MEMORY_DB_PATH;
  const dataDir = options.dataDir ?? resolveDataDir();
  const inMemory = dbPath === MEMORY_DB_PATH;
  const chain = normalizeMigrations(options.migrations ?? [], SCHEMA_VERSION);
  const headVersion = chain.length > 0 ? chain[chain.length - 1]!.version : SCHEMA_VERSION;

  if (!inMemory) {
    // 库父目录须在场（better-sqlite3 不代建目录）；0700 治理只打数据目录——
    // tier-2（DB_PATH 指库文件到别处）时库父目录不是数据目录，不越权改权限
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  ensureDataDir(dataDir, warn);

  const db = new Database(dbPath);
  prepareWal(db, warn);

  if (!inMemory) {
    // 库文件 0600 自检修复（05 §6.6——credentials 表所在库文件）
    repairFileMode(dbPath, '库文件', warn);
  }

  // 版本门禁（先读后判；全新库单事务 = 建链原子性，05 §6.5）
  let version = readUserVersion(db);
  if (version > headVersion) {
    db.close();
    throw new BaseError(
      'PERSIST_SCHEMA_TOO_NEW',
      `库 ${dbPath} 的 user_version=${version} 高于宿主迁移链 head=${headVersion}（降级运行拒开——先升级宿主再开此库）`,
    );
  }
  if (version === 0) {
    if (!databaseIsEmpty(db)) {
      db.close();
      throw new BaseError(
        'PERSIST_SCHEMA_UNRECOGNIZED',
        `库 ${dbPath} 非空但 user_version=0（外来 SQLite 文件或损坏残卷）——宁拒绝不误读`,
      );
    }
    const bootstrap = db.transaction(() => {
      db.exec(CANONICAL_DDL);
      db.pragma(`application_id = ${APPLICATION_ID}`);
      db.pragma(`user_version = ${SCHEMA_VERSION}`);
    });
    bootstrap();
    version = SCHEMA_VERSION;
  }
  if (version < headVersion) {
    // 低于 head：迁移前备份库文件（用户数据主权，05 §6.4）——内存库无从备份
    if (!inMemory) {
      checkpointTruncate(db, warn);
      const backupPath = `${dbPath}.bak-v${version}`;
      copyFileSync(dbPath, backupPath);
      warn(`[persist] 迁移前备份：${dbPath} → ${backupPath}（从 v${version} 升到 v${headVersion}）`);
    }
    for (const migration of chain) {
      if (migration.version <= version) continue;
      const step = db.transaction(() => {
        db.exec(migration.sql);
        db.pragma(`user_version = ${migration.version}`);
      });
      step();
    }
  }

  // 凭证密钥：注入位 > 数据目录自举（文件库）/ 临时密钥（内存库——库亡密亡，
  // 不在盘上留无主密钥文件）
  const secretKey = options.secretKey ?? (inMemory ? ephemeralSecretKey() : loadOrCreateSecretKey(dataDir, warn));
  return new Store(db, dbPath, headVersion, secretKey, warn, options.clock ?? (() => Date.now()));
}

/** 读 user_version（PRAGMA 读 simple 形态直回数值） */
function readUserVersion(db: Database.Database): number {
  const row = db.pragma('user_version', { simple: true });
  return typeof row === 'number' ? row : 0;
}

/** 空库判定：无用户表（sqlite_% 内部对象不算；影子表属用户域但新库必无） */
function databaseIsEmpty(db: Database.Database): boolean {
  const row = db
    .prepare(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)
    .get() as { n: number };
  return row.n === 0;
}

/**
 * WAL 编舞（承 berry prepareWalConnection 三拍）：
 * ① busy_timeout 5000（跨进程短锁等待面）→ ② journal_mode=WAL 幂等探测
 * （换模被并发连接占住时 SQLITE_BUSY——同步退避重试 5 轮）→ ③ synchronous=FULL
 * （批落事务的落盘语义是「flush 返回 = 已持久」）。
 *
 * 件内导出（非公开面）：aux.ts 开派生库复用同一卫生拍——主库与派生库
 * 连接治理单源（批 18b openAuxDatabase 消费位）。
 */
export function prepareWal(db: Database.Database, warn: (message: string) => void): void {
  db.pragma('busy_timeout = 5000');
  for (let attempt = 0; ; attempt++) {
    try {
      db.pragma('journal_mode = WAL');
      break;
    } catch (err) {
      // 结构化判别 SQLITE_BUSY（@types 的 SqliteError instanceof 收窄面失真——
      // 稳定契约是 code 字符串）
      const code =
        typeof err === 'object' && err !== null && 'code' in err ? (err as { code: unknown }).code : undefined;
      if (code !== 'SQLITE_BUSY' || attempt >= 5) {
        warn(`[persist] journal_mode=WAL 设置失败（继续以缺省日志模式运行）：${String(err)}`);
        break;
      }
      syncSleep(Math.min(20 * 3 ** attempt, 500));
    }
  }
  db.pragma('synchronous = FULL');
}

/** 同步睡眠（主线程 Atomics.wait——busy 退避等锁场景专用，勿作通用 sleep 用） */
function syncSleep(ms: number): void {
  const cell = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(cell, 0, 0, ms);
}

/** 退出前 checkpoint（TRUNCATE——干净退出不留 -wal 残卷，05 §6.5） */
function checkpointTruncate(db: Database.Database, warn: (message: string) => void): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
  } catch (err) {
    warn(`[persist] wal_checkpoint(TRUNCATE) 失败（残卷由下次打开自动恢复——WAL 设计内行为）：${String(err)}`);
  }
}

/**
 * Store——库级单例（进程内多会话共用，05 §6.1 律 2）。
 *
 * 写路径 per-session 游标（cursors Map）做连续性断言：期望 seq = 游标 + 1，
 * 不符即 PERSIST_DATA_CORRUPT（入队序 = 事务序的结构性违约——bug 指示器，
 * fail-loud 不猜）。游标首遇从 sessions.last_seq 初始化（seeded 会话续写衔接）。
 */
export class Store implements WriteTarget {
  readonly dbPath: string;
  readonly headVersion: number;
  private readonly db: Database.Database;
  private readonly secretKey: Buffer;
  private readonly warn: (message: string) => void;
  private readonly clock: () => number;
  /** per-session 已落账最大 seq（含毒丸 accountDropped 的跳记账） */
  private readonly cursors = new Map<string, number>();
  /** 预编译语句缓存（热路径免重复 prepare） */
  private readonly statements = new Map<string, Database.Statement>();
  private closed = false;

  constructor(
    db: Database.Database,
    dbPath: string,
    headVersion: number,
    secretKey: Buffer,
    warn: (message: string) => void,
    clock: () => number,
  ) {
    this.db = db;
    this.dbPath = dbPath;
    this.headVersion = headVersion;
    this.secretKey = secretKey;
    this.warn = warn;
    this.clock = clock;
  }

  /** 语句缓存取用（同 SQL 全生命期一个 prepared 对象） */
  private stmt(sql: string): Database.Statement {
    let s = this.statements.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this.statements.set(sql, s);
    }
    return s;
  }

  /**
   * 同实例 better-sqlite3 句柄窄面（core: 插件 DAO 接线位——批 15a 起生效；
   * 03 §3.2 `berry-agent/sqlite` SqliteFace 同源同律：宿主 core: 件建自有表走
   * 同一实例、better-sqlite3 裸导入仍只准 persist——消费侧以类型导入取得
   * `SqliteDatabase` 形、零运行时依赖）。
   *
   * 调用方纪律：只建自有表族/只读写自有表——主库七表（schema.ts CANONICAL_DDL）
   * 的读写恒走 Store 方法面，本面不为绕开写链门禁而开。
   */
  sqlite(): Database.Database {
    this.ensureOpen();
    return this.db;
  }

  /** 关库守卫（调用序 bug——编程错误面，非注册码语义） */
  private ensureOpen(): void {
    if (this.closed) throw new Error('persist Store 已关闭（close 后不得再读写——调用序 bug）');
  }

  // ── 写路径（write-behind 消费面）──────────────────────────────────────────

  /** 批写：单事务（events + FTS 同批 + sessions upsert + 连续性断言） */
  writeEvents(writes: readonly EventWrite[]): void {
    this.ensureOpen();
    if (writes.length === 0) return;
    const now = this.clock();
    const tx = this.db.transaction(() => {
      for (const write of writes) this.writeTuple(write, now);
    });
    tx();
  }

  /** 行写：毒丸诊断模式（单条独立事务——失败原样抛，分类归 write-behind） */
  writeEventSingle(write: EventWrite): void {
    this.ensureOpen();
    const now = this.clock();
    const tx = this.db.transaction(() => {
      this.writeTuple(write, now);
    });
    tx();
  }

  /** 单事件元组写（批/行两模式共用体：events 行 + fts 对账 + sessions 推进） */
  private writeTuple(write: EventWrite, now: number): void {
    const { sessionId, event, registration } = write;
    const expected = this.cursorFor(sessionId) + 1;
    if (event.seq !== expected) {
      throw new BaseError(
        'PERSIST_DATA_CORRUPT',
        `会话 ${sessionId} 写序违约：期望 seq=${expected} 实得 ${event.seq}（入队序 = 事务序被破坏——bug 指示器）`,
      );
    }
    this.stmt(
      `INSERT INTO events (session_id, seq, type, time, data, ignorable, surface_op, source_event_seqs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      sessionId,
      event.seq,
      event.type,
      event.time,
      JSON.stringify(event.data),
      event.ignorable ? 1 : 0,
      event.surfaceOp ? JSON.stringify(event.surfaceOp) : null,
      event.sourceEventSeqs ? JSON.stringify(event.sourceEventSeqs) : null,
    );
    // FTS 写入对账（同批同事务）：surface 类别入索引；遮蔽指令同步删区间行
    const body = ftsBodyOf(event);
    if (body !== null) {
      this.stmt(`INSERT INTO session_fts (session_id, seq, body) VALUES (?, ?, ?)`).run(sessionId, event.seq, body);
    }
    if (event.surfaceOp) {
      this.stmt(`DELETE FROM session_fts WHERE session_id = ? AND seq BETWEEN ? AND ?`).run(
        sessionId,
        event.surfaceOp.start,
        event.surfaceOp.end,
      );
    }
    // sessions 行：身份列首登为准（冲突只推进），updated_at/last_seq 批写推进
    this.stmt(
      `INSERT INTO sessions (id, title, origin, parent_id, seed_length, workspace_root, created_at, updated_at, last_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, last_seq = MAX(last_seq, excluded.last_seq)`,
    ).run(
      sessionId,
      registration.title ?? null,
      registration.origin,
      registration.parentId ?? null,
      registration.seedLength,
      registration.workspaceRoot ?? null,
      now,
      now,
      event.seq,
    );
    this.cursors.set(sessionId, event.seq);
  }

  /** 毒丸记账：不落行但推进游标（后续事件 seq 续账不撞连续性断言） */
  accountDropped(sessionId: string, seq: number): void {
    const current = this.cursorFor(sessionId);
    if (seq > current) this.cursors.set(sessionId, seq);
  }

  /** 游标取用（首遇从库内 sessions.last_seq 初始化） */
  private cursorFor(sessionId: string): number {
    let cursor = this.cursors.get(sessionId);
    if (cursor === undefined) {
      const row = this.stmt(`SELECT last_seq FROM sessions WHERE id = ?`).get(sessionId) as
        { last_seq: number } | undefined;
      cursor = row ? row.last_seq : -1;
      this.cursors.set(sessionId, cursor);
    }
    return cursor;
  }

  /** 毒丸 durable 标记落账（只增不删——审计面 select 即阅） */
  recordIncident(entry: IncidentEntry): void {
    this.ensureOpen();
    this.stmt(`INSERT INTO persist_incidents (time, session_id, seq, type, reason) VALUES (?, ?, ?, ?, ?)`).run(
      entry.time,
      entry.sessionId ?? null,
      entry.seq ?? null,
      entry.type ?? null,
      entry.reason,
    );
  }

  /** 审计读面（诊断/CLI 消费——倒序最新在前） */
  listIncidents(limit = 100): (IncidentEntry & { id: number })[] {
    this.ensureOpen();
    const rows = this.stmt(
      `SELECT id, time, session_id, seq, type, reason FROM persist_incidents ORDER BY id DESC LIMIT ?`,
    ).all(limit) as RawIncidentRow[];
    return rows.map((row) => ({
      id: row.id,
      time: row.time,
      sessionId: row.session_id ?? undefined,
      seq: row.seq ?? undefined,
      type: row.type ?? undefined,
      reason: row.reason,
    }));
  }

  // ── events 读原语 ──────────────────────────────────────────────────────────

  /**
   * 全量读会话事件（恢复重放面）：
   *  - 中段损坏（坏位之后仍有好行）→ PERSIST_DATA_CORRUPT fail-loud（宁拒勿删）；
   *  - 撕裂尾（坏位之后无行 = 尾部残卷）→ heal：删除坏位起的 events+fts 行、
   *    sessions.last_seq 回退 + warn，返回干净前缀（§4 步 1）。
   */
  loadEvents(sessionId: string): SessionEvent[] {
    this.ensureOpen();
    const rows = this.stmt(
      `SELECT seq, type, time, data, ignorable, surface_op, source_event_seqs FROM events WHERE session_id = ? ORDER BY seq`,
    ).all(sessionId) as RawEventRow[];
    const events: SessionEvent[] = [];
    let firstBadSeq: number | null = null;
    for (const row of rows) {
      if (row.seq !== events.length) {
        firstBadSeq = events.length; // 洞：期望位缺行
        break;
      }
      try {
        events.push(parseEventRow(row));
      } catch {
        firstBadSeq = row.seq; // 坏行：JSON 残卷
        break;
      }
    }
    if (firstBadSeq !== null) {
      if (rows.some((row) => row.seq > firstBadSeq!)) {
        throw new BaseError(
          'PERSIST_DATA_CORRUPT',
          `会话 ${sessionId} 日志中段损坏（首个坏位 seq=${firstBadSeq}，其后仍有行）——宁拒勿删，请人工检视`,
        );
      }
      // 撕裂尾 heal（§2.5 例外一：尾部残卷截断）
      const heal = this.db.transaction(() => {
        this.stmt(`DELETE FROM events WHERE session_id = ? AND seq >= ?`).run(sessionId, firstBadSeq!);
        this.stmt(`DELETE FROM session_fts WHERE session_id = ? AND seq >= ?`).run(sessionId, firstBadSeq!);
        this.stmt(`UPDATE sessions SET last_seq = ? WHERE id = ? AND last_seq >= ?`).run(
          firstBadSeq! - 1,
          sessionId,
          firstBadSeq!,
        );
      });
      heal();
      this.cursors.set(sessionId, firstBadSeq - 1);
      this.warn(
        `[persist] 会话 ${sessionId} 撕裂尾截断：seq>=${firstBadSeq} 的 ${rows.length - events.length} 行残卷已清（恢复按干净前缀重放）`,
      );
    }
    return events;
  }

  /** 跨会话事件查询（05 §3.4——过滤维 + 游标分页；坏行跳过 + warn） */
  queryEvents(filter: QueryEventsFilter): QueryEventsResult {
    this.ensureOpen();
    const limit = Math.min(Math.max(1, filter.limit ?? QUERY_LIMIT_DEFAULT), QUERY_LIMIT_MAX);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filter.sessionId !== undefined) {
      clauses.push('session_id = ?');
      params.push(filter.sessionId);
    }
    if (filter.types !== undefined && filter.types.length > 0) {
      clauses.push(`type IN (${filter.types.map(() => '?').join(', ')})`);
      params.push(...filter.types);
    }
    if (filter.sinceMs !== undefined) {
      clauses.push('time >= ?');
      params.push(filter.sinceMs);
    }
    if (filter.untilMs !== undefined) {
      clauses.push('time <= ?');
      params.push(filter.untilMs);
    }
    if (filter.fromSeq !== undefined) {
      clauses.push('seq >= ?');
      params.push(filter.fromSeq);
    }
    if (filter.toSeq !== undefined) {
      clauses.push('seq <= ?');
      params.push(filter.toSeq);
    }
    if (filter.cursor) {
      // 游标 = 上一页末行 (time, session_id, seq) 的不透明令牌——行值比较续页
      clauses.push('(time, session_id, seq) > (?, ?, ?)');
      params.push(...decodeCursor(filter.cursor));
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = this.stmt(
      `SELECT seq, session_id, type, time, data, ignorable, surface_op, source_event_seqs
       FROM events ${where} ORDER BY time, session_id, seq LIMIT ?`,
    ).all(...params, limit + 1) as (RawEventRow & { session_id: string })[];
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const events: SessionEvent[] = [];
    let last: (RawEventRow & { session_id: string }) | undefined;
    for (const row of page) {
      try {
        events.push(parseEventRow(row));
        last = row;
      } catch (err) {
        // 查询面不做 heal（那是 loadEvents 的恢复语义）——坏行跳过 + warn
        this.warn(`[persist] queryEvents 跳过坏行（${row.session_id}#${row.seq}）：${String(err)}`);
      }
    }
    return {
      events,
      nextCursor: hasMore && last ? encodeCursor(last.time, last.session_id, last.seq) : null,
    };
  }

  // ── sessions 行面 ──────────────────────────────────────────────────────────

  /** 会话行查询（loadSession 的登记信息源） */
  getSessionRow(sessionId: string): SessionRow | undefined {
    this.ensureOpen();
    const row = this.stmt(
      `SELECT id, title, origin, parent_id, seed_length, workspace_root, created_at, updated_at, last_seq
       FROM sessions WHERE id = ?`,
    ).get(sessionId) as RawSessionRow | undefined;
    return row ? parseSessionRow(row) : undefined;
  }

  /** 会话列表（updated_at 倒序；workspaceRoot 过滤 = 「按 cwd 取最新会话」选取面） */
  listSessions(options: { workspaceRoot?: string; limit?: number } = {}): SessionRow[] {
    this.ensureOpen();
    const limit = options.limit ?? 100;
    const rows =
      options.workspaceRoot !== undefined
        ? (this.stmt(
            `SELECT id, title, origin, parent_id, seed_length, workspace_root, created_at, updated_at, last_seq
             FROM sessions WHERE workspace_root = ? ORDER BY updated_at DESC LIMIT ?`,
          ).all(options.workspaceRoot, limit) as RawSessionRow[])
        : (this.stmt(
            `SELECT id, title, origin, parent_id, seed_length, workspace_root, created_at, updated_at, last_seq
             FROM sessions ORDER BY updated_at DESC LIMIT ?`,
          ).all(limit) as RawSessionRow[]);
    return rows.map(parseSessionRow);
  }

  /** 会话登记先行落行（空种子形态——last_seq=-1 无事件语义，与游标起点一致；
   *  有事件走写路径。0 是「seq 0 已落」——空档若记 0，首事件 seq 0 会被连续性
   *  断言当跳号拒写，恰成毒丸） */
  registerSessionRow(sessionId: string, registration: SessionRegistration): void {
    this.ensureOpen();
    const now = this.clock();
    this.stmt(
      `INSERT INTO sessions (id, title, origin, parent_id, seed_length, workspace_root, created_at, updated_at, last_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, -1)
       ON CONFLICT(id) DO NOTHING`,
    ).run(
      sessionId,
      registration.title ?? null,
      registration.origin,
      registration.parentId ?? null,
      registration.seedLength,
      registration.workspaceRoot ?? null,
      now,
      now,
    );
  }

  /** 标题独立更新（auto-title 面——非事件路径，同步小写） */
  updateSessionTitle(sessionId: string, title: string): boolean {
    this.ensureOpen();
    return this.stmt(`UPDATE sessions SET title = ? WHERE id = ?`).run(title, sessionId).changes > 0;
  }

  /** 会话删除（§2.5 物理删除：events + fts + 行 三删同事务——FTS 删除对账第二档） */
  deleteSession(sessionId: string): boolean {
    this.ensureOpen();
    const tx = this.db.transaction(() => {
      const gone = this.stmt(`DELETE FROM events WHERE session_id = ?`).run(sessionId).changes > 0;
      this.stmt(`DELETE FROM session_fts WHERE session_id = ?`).run(sessionId);
      this.stmt(`DELETE FROM sessions WHERE id = ?`).run(sessionId);
      return gone;
    });
    const gone = tx();
    this.cursors.delete(sessionId);
    return gone;
  }

  // ── session_fts 面（对账三档：写入档在写路径 / 删除档在 deleteSession）──────

  /** 会话内全文检索（首发口径：查询面限定 session_id——06 §10 引此为源） */
  searchSessionFts(sessionId: string, pattern: string, limit = 50): number[] {
    this.ensureOpen();
    // 检索式消毒：整体作为 FTS5 字符串字面量（内嵌引号双写）——任意用户输入
    // 都成合法查询且语义 = 子串匹配（trigram）；<3 字符 trigram 无从匹配返回空
    const literal = `"${pattern.replace(/"/g, '""')}"`;
    const rows = this.stmt(
      `SELECT seq FROM session_fts WHERE session_fts MATCH ? AND session_id = ? ORDER BY seq LIMIT ?`,
    ).all(literal, sessionId, limit) as { seq: number }[];
    return rows.map((row) => row.seq);
  }

  /** 跨会话全文检索（05 §9 追记①——查询面限定解除、索引面同源同索引；bm25 序；
   *  返回命中行原文供消费侧切 snippet；消毒同会话内变体（字符串字面量引号双写）） */
  searchFtsGlobal(pattern: string, limit = 50): FtsGlobalHit[] {
    this.ensureOpen();
    const literal = `"${pattern.replace(/"/g, '""')}"`;
    return this.stmt(
      `SELECT session_id AS sessionId, seq, body FROM session_fts
       WHERE session_fts MATCH ? ORDER BY rank LIMIT ?`,
    ).all(literal, limit) as FtsGlobalHit[];
  }

  /** 全量重建（派生物不修不补——重建即修复；CLI 手动命令与审计缺口共用腿） */
  rebuildFts(): FtsRebuildResult {
    this.ensureOpen();
    let sessions = 0;
    let events = 0;
    const tx = this.db.transaction(() => {
      this.stmt(`DELETE FROM session_fts`).run();
      const rows = this.stmt(`SELECT session_id, seq, type, data FROM events ORDER BY session_id, seq`).all() as {
        session_id: string;
        seq: number;
        type: string;
        data: string;
      }[];
      const insert = this.stmt(`INSERT INTO session_fts (session_id, seq, body) VALUES (?, ?, ?)`);
      let currentSession: string | undefined;
      for (const row of rows) {
        if (row.session_id !== currentSession) {
          currentSession = row.session_id;
          sessions++;
        }
        const body = ftsBodyOfRaw(row.type, row.data);
        if (body !== null) {
          insert.run(row.session_id, row.seq, body);
          events++;
        }
      }
    });
    tx();
    return { sessions, events };
  }

  /** 启动抽样对账（随机 N 会话行数比对——发现缺口由调用方触发全量重建） */
  auditFts(sampleCount = 8): FtsAuditResult {
    this.ensureOpen();
    const sampled = this.stmt(`SELECT DISTINCT session_id FROM events ORDER BY RANDOM() LIMIT ?`).all(sampleCount) as {
      session_id: string;
    }[];
    const mismatches: { sessionId: string; expected: number; actual: number }[] = [];
    for (const { session_id } of sampled) {
      const rows = this.stmt(`SELECT seq, type, data FROM events WHERE session_id = ? ORDER BY seq`).all(
        session_id,
      ) as { seq: number; type: string; data: string }[];
      let expected = 0;
      for (const row of rows) {
        if (ftsBodyOfRaw(row.type, row.data) !== null) expected++;
      }
      const actual = (
        this.stmt(`SELECT count(*) AS n FROM session_fts WHERE session_id = ?`).get(session_id) as { n: number }
      ).n;
      if (expected !== actual) mismatches.push({ sessionId: session_id, expected, actual });
    }
    return { checked: sampled.length, mismatches };
  }

  // ── store_state 面（插件持久键值统一面——受理执法在装载层，此处只供表与治理）──

  /** 键值读（过期即视为缺 + 顺手清扫；读触达刷新 last_accessed_at——LRU 依据） */
  getStoreState(key: string): StoreStateEntry | undefined {
    this.ensureOpen();
    this.sweepExpiredState();
    const row = this.stmt(`SELECT key, value, expires_at, kind FROM store_state WHERE key = ?`).get(key) as
      RawStoreStateRow | undefined;
    if (!row) return undefined;
    if (row.expires_at !== null && row.expires_at <= this.clock()) {
      // 竞速兜底（清扫窗口后又到点——读路径当场删）
      this.stmt(`DELETE FROM store_state WHERE key = ?`).run(key);
      return undefined;
    }
    this.stmt(`UPDATE store_state SET last_accessed_at = ? WHERE key = ?`).run(this.clock(), key);
    return {
      key: row.key,
      value: JSON.parse(row.value),
      kind: row.kind,
      expiresAt: row.expires_at ?? undefined,
    };
  }

  /** 键值写（upsert + LRU 帽执法 + 过期清扫三治一体，05 §6.2） */
  setStoreState(key: string, value: unknown, options: { ttlMs?: number; kind?: string } = {}): void {
    this.ensureOpen();
    const safeValue = snapshotJsonValue(value, 'store_state.value');
    const now = this.clock();
    const expiresAt = options.ttlMs !== undefined ? now + options.ttlMs : null;
    this.stmt(
      `INSERT INTO store_state (key, value, expires_at, kind, last_accessed_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at,
         kind = excluded.kind, last_accessed_at = excluded.last_accessed_at`,
    ).run(key, JSON.stringify(safeValue), expiresAt, options.kind ?? 'kv', now);
    this.sweepExpiredState();
    // LRU 帽：超帽即逐出最久未触达（新写键永不在逐出集——刚 touch 过）
    const total = (this.stmt(`SELECT count(*) AS n FROM store_state`).get() as { n: number }).n;
    if (total > STORE_STATE_LRU_CAP) {
      this.stmt(
        `DELETE FROM store_state WHERE key IN (
           SELECT key FROM store_state ORDER BY last_accessed_at ASC, key ASC LIMIT ?
         ) AND key != ?`,
      ).run(total - STORE_STATE_LRU_CAP, key);
    }
  }

  /** 键值删（终态删除面——job 条目结算即删的物理腿） */
  deleteStoreState(key: string): boolean {
    this.ensureOpen();
    return this.stmt(`DELETE FROM store_state WHERE key = ?`).run(key).changes > 0;
  }

  /** 过期清扫（顺手腿——读写路径捎带，无独立定时器） */
  private sweepExpiredState(): void {
    this.stmt(`DELETE FROM store_state WHERE expires_at IS NOT NULL AND expires_at <= ?`).run(this.clock());
  }

  // ── credentials 面（密文盒消费——api_key 列只存密文；namespace 归属维
  //    2026-09-08 c-2 扩容——03 §10.9/05 §9；'host' 宿主域 = 模型 key 与
  //    静态人面凭证，'plugin:<id>' 插件域经 c-3 读腿受理位写入）────────────

  /** 凭证写（加密 upsert；meta 须纯 JSON；namespace 归属域显式传） */
  setCredential(namespace: string, provider: string, entry: { apiKey: string; meta?: unknown }): void {
    this.ensureOpen();
    const meta = entry.meta !== undefined ? snapshotJsonValue(entry.meta, 'credentials.meta') : null;
    this.stmt(
      `INSERT INTO credentials (namespace, provider, api_key, meta, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(namespace, provider) DO UPDATE SET api_key = excluded.api_key, meta = excluded.meta,
         updated_at = excluded.updated_at`,
    ).run(
      namespace,
      provider,
      encryptSecret(this.secretKey, entry.apiKey),
      meta === null ? null : JSON.stringify(meta),
      this.clock(),
    );
  }

  /** 凭证读（解密——密钥丢失/不匹配 fail-loud PERSIST_SECRET_UNREADABLE） */
  getCredential(namespace: string, provider: string): CredentialEntry | undefined {
    this.ensureOpen();
    const row = this.stmt(
      `SELECT namespace, provider, api_key, meta, updated_at FROM credentials
       WHERE namespace = ? AND provider = ?`,
    ).get(namespace, provider) as RawCredentialRow | undefined;
    if (!row) return undefined;
    return {
      namespace: row.namespace,
      provider: row.provider,
      apiKey: decryptSecret(this.secretKey, row.api_key),
      meta: row.meta === null ? undefined : JSON.parse(row.meta),
      updatedAt: row.updated_at,
    };
  }

  /** 凭证删（撤销唯一路径 = 人面 rm / 插件 revoke——保留律的对面） */
  deleteCredential(namespace: string, provider: string): boolean {
    this.ensureOpen();
    return (
      this.stmt(`DELETE FROM credentials WHERE namespace = ? AND provider = ?`).run(namespace, provider).changes > 0
    );
  }

  /** 凭证清单（不回 api_key——枚举面零密文零明文；全域列示：人面命令恒可
   *  列示/撤销一切域——03 §10.9，namespace 分权不进治理面。meta 随行回
   *  〔parsed JSON——c-5 人面 list 来源列 / expired 呈现位消费；写侧
   *  snapshotJsonValue 保证纯 JSON 可解析〕） */
  listCredentialProviders(): { namespace: string; provider: string; meta: unknown; updatedAt: number }[] {
    this.ensureOpen();
    return (
      this.stmt(`SELECT namespace, provider, meta, updated_at FROM credentials ORDER BY namespace, provider`).all() as {
        namespace: string;
        provider: string;
        meta: string | null;
        updated_at: number;
      }[]
    ).map((row) => ({
      namespace: row.namespace,
      provider: row.provider,
      meta: row.meta === null ? undefined : JSON.parse(row.meta),
      updatedAt: row.updated_at,
    }));
  }

  // ── model_catalog 面 ────────────────────────────────────────────────────────

  /** 模型目录写（06/07 篇消费的物理 CRUD 面） */
  upsertModel(model: { id: string; provider: string; label?: string; meta?: unknown }): void {
    this.ensureOpen();
    const meta = model.meta !== undefined ? snapshotJsonValue(model.meta, 'model.meta') : null;
    this.stmt(
      `INSERT INTO model_catalog (id, provider, label, meta, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, label = excluded.label,
         meta = excluded.meta, updated_at = excluded.updated_at`,
    ).run(model.id, model.provider, model.label ?? null, meta === null ? null : JSON.stringify(meta), this.clock());
  }

  /** 模型目录读（provider 过滤可选） */
  listModels(provider?: string): ModelRow[] {
    this.ensureOpen();
    const rows =
      provider !== undefined
        ? (this.stmt(
            `SELECT id, provider, label, meta, updated_at FROM model_catalog WHERE provider = ? ORDER BY id`,
          ).all(provider) as RawModelRow[])
        : (this.stmt(
            `SELECT id, provider, label, meta, updated_at FROM model_catalog ORDER BY id`,
          ).all() as RawModelRow[]);
    return rows.map((row) => ({
      id: row.id,
      provider: row.provider,
      label: row.label ?? undefined,
      meta: row.meta === null ? undefined : JSON.parse(row.meta),
      updatedAt: row.updated_at,
    }));
  }

  /** 模型目录删 */
  deleteModel(id: string): boolean {
    this.ensureOpen();
    return this.stmt(`DELETE FROM model_catalog WHERE id = ?`).run(id).changes > 0;
  }

  // ── 生命周期 ────────────────────────────────────────────────────────────────

  /** 关库（flush 由调用方先行——persistence.close 编舞；此处只管收尾） */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.dbPath !== MEMORY_DB_PATH) {
      checkpointTruncate(this.db, this.warn);
    }
    this.db.close();
  }

  /** 原生连接（宿主内消费位 = assembly createAuditFace〔audit_events 单写者〕；跨件勿散用——走 Store 方法面） */
  get connection(): Database.Database {
    return this.db;
  }

  /** 内存库判别（:memory: 形态的执法位消费——createSeededSession 拒绝面） */
  get inMemory(): boolean {
    return this.dbPath === MEMORY_DB_PATH;
  }
}

// ── 行形态与解析 ─────────────────────────────────────────────────────────────

interface RawEventRow {
  seq: number;
  type: string;
  time: number;
  data: string;
  ignorable: number;
  surface_op: string | null;
  source_event_seqs: string | null;
}

interface RawSessionRow {
  id: string;
  title: string | null;
  origin: string;
  parent_id: string | null;
  seed_length: number;
  workspace_root: string | null;
  created_at: number;
  updated_at: number;
  last_seq: number;
}

interface RawStoreStateRow {
  key: string;
  value: string;
  expires_at: number | null;
  kind: string;
}

interface RawCredentialRow {
  namespace: string;
  provider: string;
  api_key: string;
  meta: string | null;
  updated_at: number;
}

interface RawModelRow {
  id: string;
  provider: string;
  label: string | null;
  meta: string | null;
  updated_at: number;
}

interface RawIncidentRow {
  id: number;
  time: number;
  session_id: string | null;
  seq: number | null;
  type: string | null;
  reason: string;
}

/** 事件行 → 事件信封（JSON 列解析——失败即抛，调用方决定截断/跳过） */
function parseEventRow(row: RawEventRow): SessionEvent {
  const data = JSON.parse(row.data) as unknown;
  const surfaceOp = row.surface_op === null ? undefined : (JSON.parse(row.surface_op) as SessionEvent['surfaceOp']);
  const sourceEventSeqs = row.source_event_seqs === null ? undefined : (JSON.parse(row.source_event_seqs) as number[]);
  return {
    type: row.type,
    seq: row.seq,
    time: row.time,
    data,
    ...(row.ignorable ? { ignorable: true } : {}),
    ...(surfaceOp ? { surfaceOp } : {}),
    ...(sourceEventSeqs ? { sourceEventSeqs } : {}),
  };
}

/** sessions 原始行 → 读形态（NULL 列归一 undefined） */
function parseSessionRow(row: RawSessionRow): SessionRow {
  return {
    id: row.id,
    title: row.title ?? undefined,
    origin: row.origin as SessionOrigin,
    parentId: row.parent_id ?? undefined,
    seedLength: row.seed_length,
    workspaceRoot: row.workspace_root ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeq: row.last_seq,
  };
}

// ── FTS body 抽取（索引面：全部 surface 类别事件——词汇注册表 category 判据）──

/** 事件信封 → FTS body（非 surface 类别返回 null 不入索引） */
function ftsBodyOf(event: SessionEvent): string | null {
  return ftsBodyOfRaw(event.type, JSON.stringify(event.data));
}

/** 行形态直达抽取（重建/审计面复用——避免先 parse 整信封再 stringify） */
function ftsBodyOfRaw(type: string, dataJson: string): string | null {
  const meta = getEventTypeMeta(type);
  if (!meta || meta.category !== 'surface') return null;
  const parts: string[] = [];
  collectStringValues(JSON.parse(dataJson), parts, 0);
  return parts.length > 0 ? parts.join(' ') : null;
}

/** 递归收集字符串值（只收值不收键——键名污染匹配面；深度帽防恶意嵌套） */
function collectStringValues(value: unknown, out: string[], depth: number): void {
  if (depth > 8) return;
  if (typeof value === 'string') {
    if (value.length > 0) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStringValues(item, out, depth + 1);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const item of Object.values(value)) collectStringValues(item, out, depth + 1);
  }
}

// ── 游标编解码（queryEvents 分页令牌——不透明：base64url(JSON)）──────────────

/** 游标编码（上一页末行三元组） */
function encodeCursor(time: number, sessionId: string, seq: number): string {
  return Buffer.from(JSON.stringify({ t: time, s: sessionId, q: seq }), 'utf8').toString('base64url');
}

/** 游标解码（坏令牌 = 面向调用方的输入错误，fail-loud） */
function decodeCursor(cursor: string): [number, string, number] {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      t: number;
      s: string;
      q: number;
    };
    if (typeof parsed.t !== 'number' || typeof parsed.s !== 'string' || typeof parsed.q !== 'number') {
      throw new Error('shape');
    }
    return [parsed.t, parsed.s, parsed.q];
  } catch {
    throw new BaseError('PERSIST_DATA_CORRUPT', `queryEvents 游标不可解码：${cursor.slice(0, 32)}…`);
  }
}
