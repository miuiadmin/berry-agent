/**
 * jobs 表迁移（迁移 v2——批 15a 占号；05 §6.4「号随注册序顺延」勘正注的
 * 首个落码兑现：scheduler 先于 memory 落码即先占 v2）。
 *
 * DDL 裁形（04 §12 jobs 表条款 + pi-tick catalog 字段规则对账）：
 *   - name 主键（名即寻径——goal 挂钟行 goal-<goalId> 同型合法）；
 *   - schedule/last_outcome JSON 列（canonical 形由 schedule.ts 单源解释）；
 *   - active_pid/active_started_at 跨进程抢占判据面（OS cron 后端形态下
 *     `run --tick` 子进程建行占用；进程内挂钟在飞走引擎内存表）；
 *   - builtin 内置任务标记（04 §12 归属列已裁形态——系统任务内置标记、
 *     用户任务无 owner 位）。
 */
import type { MigrationSpec } from '../persist/index.js';

export const SCHEDULER_MIGRATION: MigrationSpec = {
  version: 2,
  name: 'scheduler-jobs',
  sql: `
    CREATE TABLE jobs (
      name               TEXT PRIMARY KEY,
      prompt             TEXT NOT NULL,
      cwd                TEXT,
      schedule           TEXT NOT NULL,
      enabled            INTEGER NOT NULL DEFAULT 0,
      builtin            INTEGER NOT NULL DEFAULT 0,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL,
      next_fire_at       TEXT,
      last_fire_at       TEXT,
      last_outcome       TEXT,
      active_pid         INTEGER,
      active_started_at  TEXT
    );
    CREATE INDEX idx_jobs_next_fire ON jobs (next_fire_at) WHERE enabled = 1 AND next_fire_at IS NOT NULL;
  `,
};
