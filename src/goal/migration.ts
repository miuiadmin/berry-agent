/**
 * goals 表族迁移（迁移 v3——批 15b 占号；05 §6.4「号随注册序顺延」：批 15a
 * scheduler 占 v2 后本件顺占 v3）。
 *
 * DDL 裁形（03 §10.5 + 04 §12）：
 *   - goals 主表：id 主键（挂钟行名 `goal-<id>` 同型合法——id 生成面约束
 *     ≤59 字符）；activated_seq 激活锚（fold 边界——resume 重绑即改写）；
 *     预算双轨三列（cap/前台已用/委派折叠——两腿先到先刹的持久面）；
 *     停滞判定两列（stall_streak/wake_streak——wakeGate 双帽计数面）+
 *     last_fingerprint（fold 投影指纹——进展判据）；
 *   - goal_wakes 副表：归因轮身份 durable 落账（04 §12 续跑触发条款——
 *     哪个 run 为哪个 goal 醒的，跨进程可审计）。
 */
import type { MigrationSpec } from '../persist/index.js';

export const GOAL_MIGRATION: MigrationSpec = {
  version: 3,
  name: 'goal-goals',
  sql: `
    CREATE TABLE goals (
      id                    TEXT PRIMARY KEY,
      session_id            TEXT NOT NULL,
      objective             TEXT NOT NULL,
      status                TEXT NOT NULL CHECK (status IN ('active', 'completed', 'abandoned')),
      activated_seq         INTEGER NOT NULL,
      schedule              TEXT NOT NULL,
      prompt_snapshot       TEXT NOT NULL,
      needs_write           INTEGER NOT NULL DEFAULT 0,
      budget_messages_cap   INTEGER,
      budget_messages_used  INTEGER NOT NULL DEFAULT 0,
      budget_folded_units   INTEGER NOT NULL DEFAULT 0,
      stall_streak          INTEGER NOT NULL DEFAULT 0,
      wake_streak           INTEGER NOT NULL DEFAULT 0,
      last_fingerprint      TEXT,
      created_at            TEXT NOT NULL,
      updated_at            TEXT NOT NULL,
      ended_at              TEXT,
      ending_note           TEXT
    );
    CREATE INDEX idx_goals_session_active ON goals (session_id) WHERE status = 'active';
    CREATE TABLE goal_wakes (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      goal_id       TEXT NOT NULL REFERENCES goals (id),
      woke_at       TEXT NOT NULL,
      trigger       TEXT NOT NULL CHECK (trigger IN ('clock', 'manual')),
      attribution   TEXT NOT NULL,
      fingerprint   TEXT NOT NULL,
      progressed    INTEGER NOT NULL
    );
    CREATE INDEX idx_goal_wakes_goal ON goal_wakes (goal_id);
  `,
};
