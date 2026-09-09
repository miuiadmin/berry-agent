/**
 * persist — 装载史 durable 载体（05 篇 §9 load_generations 表——装载史批 h-2）。
 *
 * 载体定位：宿主形态镜像落账面——记「系统何时处于什么装载形态」（状态时间线），
 * 与 audit_events 动作归因面（谁何时做了什么）正交分立。每次 boot 完成点 /
 * /reload reapply 成功尾写一行世代快照；世代线性承 05 §6.6 单活跃机（本表
 * 不执法并立——异常并立的重叠窗在查询语义下偏保守无害，05 §9 表注）。
 *
 * 两方法窄面（单写者 = 宿主装配根；CLI 卸载腿只读消费）：
 *  - recordLoadGeneration 同事务换代：回填当代开放窗（ended_at IS NULL 行，
 *    值 = 新行 started_at 同刻——诚实律不虚构收口时刻）+ 写新行；进程退出
 *    不补写，NULL = 当代开放窗，查询侧 COALESCE 归一。
 *  - querySessionsWithPlugin 时间窗 join 推算：目标插件 ∈ activated 的世代
 *    与会话 durable 存活窗（created_at..updated_at——write-behind 写窗）相交
 *    计数 COUNT(DISTINCT s.id)。语义 = 「装载过」= 共现，非「使用过」
 *    （03 §5.5 ④ 回执措辞据此）；判据恒 activated——skipped/failed 不算
 *    「装载过」（立题档裁决 2）。
 *
 * 边沿形态（05 §9 定形）：--no-plugins 安全模式 boot 照落空三分区行（世代
 * 存在且为空）；reload reapply 失败不换代（不写行，旧代开放窗偏保守覆盖——
 * 写与否归 h-3 编舞层裁决，本件只提供原语）。
 *
 * 不随 uninstall 删：装载史是宿主全域账本非插件域资产——历史世代引用已卸
 * id = 历史事实保留；「不在册-曾卸载」分支判据由 plugin/uninstalled 落账
 * 承载，两源不混（立题档裁决 4）。
 *
 * 表形：id INTEGER PRIMARY KEY（自增世代号——线性序）/ started_at（epoch
 * 毫秒——与 sessions.created_at/updated_at 同单位，时间窗 join 两边可比）/
 * ended_at（NULL = 当代开放窗；回填值 = 新行 started_at）/ activated·skipped·
 * failed 三分区 JSON 列（activated 成员含 tools 名账——addedToolNames 真值
 * 通道，立题档裁决 3 案 i）。STRICT；无索引（年千行级顺序扫，量级证据再立）。
 */
import type Database from 'better-sqlite3';
import type { MigrationSpec } from './migrations.js';

/**
 * load_generations 建表迁移项（05 §9）。占号 v10——号随注册序顺延：scheduler
 * v2 / goal v3 / memory v4-6·9 / credentials v7 / audit v8 之后。声明
 * export-only：宿主装配根 HOST_MIGRATION_TAIL 机械聚合（05 §6.4——声明来自
 * 件、执行在宿主；audit_events v8 同形）。
 */
export const LOAD_GENERATIONS_MIGRATION: MigrationSpec = {
  version: 10,
  name: 'load-generations',
  sql: 'CREATE TABLE load_generations (id INTEGER PRIMARY KEY, started_at INTEGER NOT NULL, ended_at INTEGER, activated TEXT NOT NULL, skipped TEXT NOT NULL, failed TEXT NOT NULL) STRICT',
};

/** activated 分区成员（tools 名账 = addedToolNames 真值源——宿主包壳层记账，h-3 接线） */
export interface LoadGenerationActivated {
  /** 插件 id */
  readonly id: string;
  /** 该插件本代经 ctx.tools.register 注册的工具名清单 */
  readonly tools: readonly string[];
}

/** skipped 分区成员（装载器跳过——reason 词面单源在装载器） */
export interface LoadGenerationSkipped {
  readonly id: string;
  readonly reason: string;
}

/** failed 分区成员（装载失败——code 词面单源在装载器） */
export interface LoadGenerationFailed {
  readonly id: string;
  readonly code: string;
}

/** 世代快照（写面入参——三分区全录；空分区 = 空数组非缺省） */
export interface LoadGenerationSnapshot {
  readonly activated: readonly LoadGenerationActivated[];
  readonly skipped: readonly LoadGenerationSkipped[];
  readonly failed: readonly LoadGenerationFailed[];
}

/** 装载史两方法窄面（createLoadHistoryFace 构造） */
export interface LoadHistoryFace {
  /**
   * 同事务换代：回填当代开放窗 + 写新行（原子性——不出现双开放窗/零开放窗）。
   * @returns 新世代号（主键自增，线性序）
   */
  recordLoadGeneration(snapshot: LoadGenerationSnapshot): number;
  /**
   * 时间窗 join 推算「装载过该插件的会话」计数：pluginId ∈ activated 的世代
   * 激活窗与会话 durable 存活窗相交的会话数（DISTINCT 去重——长眠会话跨代
   * 只计一）。无世代/插件从未激活 → 0。
   */
  querySessionsWithPlugin(pluginId: string): number;
}

/**
 * 构造装载史面。
 * @param db 已开库句柄（load_generations 表须已由迁移链建就——表不在则首笔
 *   即 SQLite 报错，fail-loud 不静默；sessions 表为 v1 基线恒在）
 * @param clock 挂钟注入（测试假钟；缺省 Date.now——started_at 落笔与查询侧
 *   开放窗 COALESCE 归一共用此钟）
 */
export function createLoadHistoryFace(db: Database.Database, clock: () => number = Date.now): LoadHistoryFace {
  // 三语句构造期预编译（better-sqlite3 惯例——句柄复用免逐笔 parse）
  const closeOpenStmt = db.prepare('UPDATE load_generations SET ended_at = ? WHERE ended_at IS NULL');
  const insertStmt = db.prepare(
    'INSERT INTO load_generations (started_at, ended_at, activated, skipped, failed) VALUES (?, NULL, ?, ?, ?)',
  );
  // 时间窗 join 推算（05 §9 定形语义）：世代激活窗 [started_at,
  // COALESCE(ended_at, :now)] ∩ 会话存活窗 [created_at, updated_at] 非空即
  // 共现（闭区间——端点相触即计）；成员判据恒 activated——json_each 展开
  // 三分区列比对 id（SQLite JSON1 内建，非外部依赖）。
  const countStmt = db.prepare(`
    SELECT COUNT(DISTINCT s.id) AS cnt
    FROM sessions s
    JOIN load_generations g
      ON s.created_at <= COALESCE(g.ended_at, ?)
     AND s.updated_at >= g.started_at
    WHERE EXISTS (SELECT 1 FROM json_each(g.activated) m WHERE m.value ->> '$.id' = ?)
  `);
  // 换代双写单事务：回填与插新同成同败——半途崩不产生双开放窗或丢前代收口
  const rotateTx = db.transaction((snapshot: LoadGenerationSnapshot, now: number): number => {
    closeOpenStmt.run(now);
    const info = insertStmt.run(
      now,
      JSON.stringify(snapshot.activated),
      JSON.stringify(snapshot.skipped),
      JSON.stringify(snapshot.failed),
    );
    return Number(info.lastInsertRowid);
  });

  return {
    recordLoadGeneration(snapshot) {
      return rotateTx(snapshot, clock());
    },

    querySessionsWithPlugin(pluginId) {
      const row = countStmt.get(clock(), pluginId) as { cnt: number };
      return row.cnt;
    },
  };
}
