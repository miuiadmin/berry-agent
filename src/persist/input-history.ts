/**
 * persist — 分项目输入历史（05 篇 §9 input_history 表——B1 持久化批，07
 * §4.1 呈现面件 2 B1 定形注）。
 *
 * 载体定位：宿主输入历史读模型的 durable 位——编辑器内建输入历史的跨进程
 * 存活层（↑/↓ 翻阅召回集含非事件文本〔退出词/本地命令不入 events〕，非纯
 * 投影可派生——05 §3.2 显式例外、sessions 档案两列先例同 class）。多项目
 * 同库域隔离：域键 = workspace_root 列（canonicalWorkspaceRoot 归一形，与
 * sessions.workspace_root /「按 cwd 取最新会话」启动策略同键同源）——域键
 * 非库键（BERRY_AGENT_DATA_DIR 可覆盖、多项目共享一库）。
 *
 * 两方法窄面（单写者 = 宿主装配根——Editor onHistoryAdd 闭包镜像位）：
 *  - record 入册：trim 空不入 + 连续去重（同域 top-1 text 全等）+ 按域帽
 *    100（帽删除 delete-not-in-top-100 子查询**带域过滤**——ZCode 全库帽
 *    跨项目互挤 quirk 本仓不取）；真入册返 true、闸下返 false（编辑器镜像
 *    位判据）。
 *  - recentTexts 读面：按域新→旧序 text 清单（启动播种源——host 装配根
 *    构造期一次满灌 EditorOptions.historySeed）。
 *
 * 写失败 best-effort 归调用方（host 闭包 try/catch + warn，不阻塞提交）；
 * 05 §6.6 单活跃机下无双写竞速——库侧连续去重即跨进程首条的衔接闸（内存
 * 闸为主、库侧同判兜底）。直写非 write-behind：用户提交低频（audit /
 * load_generations 直写同形）。
 *
 * 表形：id INTEGER PRIMARY KEY（自增）/ workspace_root TEXT NOT NULL 域键 /
 * session_id TEXT（溯源列、NULL 允许——记录时点聚焦会话，非选取键：不建
 * 索引不过滤）/ text TEXT NOT NULL（全量正文——粘贴标记提交时已展开、@引用
 * 内联于文本，无独立附件位）/ created_at INTEGER（epoch 毫秒——与 sessions
 * 同单位）；STRICT；索引 (workspace_root, id DESC)。kind 不入首版（召回面
 * 无 kind 过滤——07 B1 注⑥；后续分型走 ALTER ADD COLUMN v13 先例）。
 */
import type Database from 'better-sqlite3';
import type { MigrationSpec } from './migrations.js';

/**
 * 按域帽（07 §4.1 呈现面件 2「按域百条帽」——B1 定形注④）。与编辑器
 * HISTORY_LIMIT（channels/tui/editor/editor-model.ts）同值两镜像位：persist
 * 不依赖 channels（28 席 DAG 单向），两侧各持常量注释互指，值动两处同笔。
 */
export const INPUT_HISTORY_CAP = 100;

/**
 * input_history 建表迁移项（05 §9 表行）。占号 v14——号随注册序顺延：
 * sessions 档案两列 v13 之后。声明 export-only：宿主装配根
 * HOST_MIGRATION_TAIL 机械聚合（05 §6.4——声明来自件、执行在宿主；audit
 * v8 / load-generations v10 同形）。建表在各自迁移、不入正典 DDL（表清单
 * 在册、DDL 后追——表族先例）。
 */
export const INPUT_HISTORY_MIGRATION: MigrationSpec = {
  version: 14,
  name: 'input-history',
  sql: `
    CREATE TABLE input_history (
      id INTEGER PRIMARY KEY,
      workspace_root TEXT NOT NULL,
      session_id TEXT,
      text TEXT NOT NULL,
      created_at INTEGER NOT NULL
    ) STRICT;
    CREATE INDEX idx_input_history_domain ON input_history (workspace_root, id DESC);
  `,
};

/** record 入参（sessionId 溯源列可选——记录时点聚焦会话 id） */
export interface InputHistoryRecordInput {
  /** 域键（canonicalWorkspaceRoot 归一形——与 sessions.workspace_root 同键同源） */
  readonly workspaceRoot: string;
  /** 溯源列（记录时点聚焦会话 id；允许缺省 NULL——溯源非选取键） */
  readonly sessionId?: string;
  /** 正文全量（trim 后入册——与编辑器内存史同语义） */
  readonly text: string;
}

/** 分项目输入历史两方法窄面（createInputHistoryFace 构造；单写者 = 宿主装配根） */
export interface InputHistoryFace {
  /**
   * 入册（提交成功路径镜像位调用）。三闸与编辑器内存史同语义：trim 空不
   * 入 / 连续去重（同域 top-1 text 全等）/ 按域帽 100（越帽即删，域过滤）。
   * @returns 真入册 true；trim 空或连续重复 false（镜像位判据——编辑器
   *   内存闸已过仍以库侧同判兜底，跨进程首条衔接同闸）
   */
  record(input: InputHistoryRecordInput): boolean;
  /**
   * 按域读面：新→旧序 text 清单（启动播种源）。
   * @param limit 帽（缺省 INPUT_HISTORY_CAP=100——与编辑器 HISTORY_LIMIT 同值）
   */
  recentTexts(workspaceRoot: string, limit?: number): readonly string[];
}

/**
 * 构造输入历史面。
 * @param db 已开库句柄（input_history 表须已由迁移链建就——表不在则首笔
 *   即 SQLite 报错，fail-loud 不静默）
 * @param clock 挂钟注入（测试假钟；缺省 Date.now——created_at epoch 毫秒）
 */
export function createInputHistoryFace(db: Database.Database, clock: () => number = Date.now): InputHistoryFace {
  // 四语句构造期预编译（better-sqlite3 惯例——句柄复用免逐笔 parse）
  const insertStmt = db.prepare(
    'INSERT INTO input_history (workspace_root, session_id, text, created_at) VALUES (?, ?, ?, ?)',
  );
  const topStmt = db.prepare('SELECT text FROM input_history WHERE workspace_root = ? ORDER BY id DESC LIMIT 1');
  const recentStmt = db.prepare('SELECT text FROM input_history WHERE workspace_root = ? ORDER BY id DESC LIMIT ?');
  // 按域帽删除：delete-not-in-top-100 子查询带 workspace_root 域过滤——
  // 只裁本域越帽行，他域行不挤删（ZCode 全库帽 quirk 修正位，07 B1 注④）
  const capStmt = db.prepare(`
    DELETE FROM input_history
    WHERE workspace_root = ?
      AND id NOT IN (
        SELECT id FROM input_history WHERE workspace_root = ? ORDER BY id DESC LIMIT ${INPUT_HISTORY_CAP}
      )
  `);
  // 入册 + 帽裁同事务：行数上限不变式（半途崩不产生越帽残窗）
  const recordTx = db.transaction((workspaceRoot: string, sessionId: string | null, text: string, now: number) => {
    insertStmt.run(workspaceRoot, sessionId, text, now);
    capStmt.run(workspaceRoot, workspaceRoot);
  });

  return {
    record({ workspaceRoot, sessionId, text }) {
      // 闸一：trim 空不入（与编辑器 addToHistory 同判）
      const trimmed = text.trim();
      if (!trimmed) return false;
      // 闸二：连续去重——同域 top-1 全等（库侧同判兜底：单活跃机下无双写
      // 竞速，此闸即跨进程首条与本进程内存闸的衔接位）
      const top = topStmt.get(workspaceRoot) as { text: string } | undefined;
      if (top !== undefined && top.text === trimmed) return false;
      recordTx(workspaceRoot, sessionId ?? null, trimmed, clock());
      return true;
    },

    recentTexts(workspaceRoot, limit = INPUT_HISTORY_CAP) {
      const rows = recentStmt.all(workspaceRoot, limit) as { text: string }[];
      return rows.map((row) => row.text);
    },
  };
}
