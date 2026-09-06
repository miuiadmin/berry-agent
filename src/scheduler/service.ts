/**
 * scheduler 服务面（04 §12）：jobs 表 DAO + /tick 六动词的程序形态 +
 * GoalJobsFace 四法窄面（第五槽——goal 件挂钟行的单漏斗写路径）。
 *
 * 分工线（04 §12「同一 jobs 表两视角」）：本面管 **jobs 表行**（挂钟行的注册
 * 管理面）；运行中实例的 in-flight 记账归引擎内存表（§10 ctx.jobs 系另册，
 * 语义不在此）。enable/disable **直打 jobs 表行**（幽灵名零行守卫——
 * SCHEDULER_NOT_FOUND 响亮拒，2026-09-04 berry 侧同款守卫）；add **名冲突守卫**
 * （SCHEDULER_NAME_EXISTS）。cron 可选后端在场时启停/rm 与 OS 注册面联动
 * （联动细则 = 本件落码面裁决：行翻转与 crontab 同步两段——OS 段失败亮拒
 * 不半态）。
 */
import { statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { BaseError } from '../contracts/index.js';
import type { SqliteDatabase } from '../persist/index.js';
import { formatSchedule, nextFireAt, parseSchedule, resolveRelativeOnce, type Schedule } from './schedule.js';
import type { JobRow, RunOutcome } from './types.js';
import type { CronRegistrar } from './cron-backend.js';

/** 任务名词法（pi-tick id 规则同形——goal-<goalId> 挂钟行名同型合法） */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
/** prompt 硬帽（16KiB——pi-tick 同值） */
const PROMPT_MAX_BYTES = 16 * 1024;

/** add 请求形（schedule 串——词法见 schedule.ts 四形） */
export interface AddJobRequest {
  name: string;
  prompt: string;
  /** 工作目录（绝对路径、建行时须存在；缺省 null = runner 继承宿主 cwd） */
  cwd?: string | null;
  schedule: string;
  /** 缺省 false——「存在 ≠ 启用」（pi-tick default-disabled 安全缺省同律：防「注册即自治」误操作类） */
  enabled?: boolean;
  /** 内置任务标记（goal 挂钟经窄面 true；/tick 用户道恒 false） */
  builtin?: boolean;
}

/** 服务装配依赖 */
export interface SchedulerServiceDeps {
  db: SqliteDatabase;
  /** ISO UTC 时钟 */
  now: () => string;
  warn: (message: string) => void;
  /** cron 可选后端注册器（缺席 = 进程内挂钟缺省形态——OS 面零动作） */
  cronRegistrar?: CronRegistrar | null;
  /** cwd 存在性判（add 校验用——缺省 node:fs statSync；测试注假件） */
  pathExists?: (p: string) => boolean;
}

/** jobs 表 DAO（service/engine 共用——行映射蛇 ↔ 驼峰单源） */
export class JobsDao {
  private readonly db: SqliteDatabase;

  constructor(db: SqliteDatabase) {
    this.db = db;
  }

  /** 行查（名寻径；缺席 undefined） */
  get(name: string): JobRow | undefined {
    const row = this.db
      .prepare(
        `SELECT name, prompt, cwd, schedule, enabled, builtin, created_at, updated_at,
                next_fire_at, last_fire_at, last_outcome, active_pid, active_started_at
         FROM jobs WHERE name = ?`,
      )
      .get(name) as JobsDbRow | undefined;
    return row ? fromDb(row) : undefined;
  }

  /** 全行清单（名序——/tick list 观察面） */
  list(): JobRow[] {
    const rows = this.db
      .prepare(
        `SELECT name, prompt, cwd, schedule, enabled, builtin, created_at, updated_at,
                next_fire_at, last_fire_at, last_outcome, active_pid, active_started_at
         FROM jobs ORDER BY name`,
      )
      .all() as JobsDbRow[];
    return rows.map(fromDb);
  }

  /** due 集（启用且到点——挂钟推进轮询面；next_fire_at 升序） */
  due(now: string): JobRow[] {
    const rows = this.db
      .prepare(
        `SELECT name, prompt, cwd, schedule, enabled, builtin, created_at, updated_at,
                next_fire_at, last_fire_at, last_outcome, active_pid, active_started_at
         FROM jobs
         WHERE enabled = 1 AND next_fire_at IS NOT NULL AND next_fire_at <= ?
         ORDER BY next_fire_at`,
      )
      .all(now) as JobsDbRow[];
    return rows.map(fromDb);
  }

  /** 启用行的下次到点最小值（挂钟下轮调度间隔计算面；无启用行 null） */
  earliestNextFire(): string | null {
    const row = this.db
      .prepare(`SELECT MIN(next_fire_at) AS m FROM jobs WHERE enabled = 1 AND next_fire_at IS NOT NULL`)
      .get() as { m: string | null };
    return row.m;
  }

  /** 建行（名主键冲突由调用方守卫——DAO 不吞） */
  insert(row: JobRow): void {
    this.db
      .prepare(
        `INSERT INTO jobs (name, prompt, cwd, schedule, enabled, builtin, created_at,
                           updated_at, next_fire_at, last_fire_at, last_outcome,
                           active_pid, active_started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.name,
        row.prompt,
        row.cwd,
        JSON.stringify(row.schedule),
        row.enabled ? 1 : 0,
        row.builtin ? 1 : 0,
        row.createdAt,
        row.updatedAt,
        row.nextFireAt,
        row.lastFireAt,
        row.lastOutcome === null ? null : JSON.stringify(row.lastOutcome),
        row.activePid,
        row.activeStartedAt,
      );
  }

  /** 更新启停位与时间戳（enable/disable 直打） */
  setEnabled(name: string, enabled: boolean, updatedAt: string): void {
    this.db.prepare(`UPDATE jobs SET enabled = ?, updated_at = ? WHERE name = ?`).run(enabled ? 1 : 0, updatedAt, name);
  }

  /** 删行 */
  remove(name: string): void {
    this.db.prepare(`DELETE FROM jobs WHERE name = ?`).run(name);
  }

  /** 结算回写：last_fire_at + last_outcome + next_fire_at 推进（fire 收场单点） */
  settleFire(name: string, firedAt: string, outcome: RunOutcome, nextFireAt: string | null, updatedAt: string): void {
    this.db
      .prepare(
        `UPDATE jobs SET last_fire_at = ?, last_outcome = ?, next_fire_at = ?, updated_at = ?
         WHERE name = ?`,
      )
      .run(firedAt, JSON.stringify(outcome), nextFireAt, updatedAt, name);
  }

  /** next_fire_at 单列推进（重启补推进/闸拦跳过——不动 last_fire_at） */
  advanceNextFire(name: string, nextFireAt: string | null, updatedAt: string): void {
    this.db.prepare(`UPDATE jobs SET next_fire_at = ?, updated_at = ? WHERE name = ?`).run(nextFireAt, updatedAt, name);
  }

  /** gated 结算：记拦截结局 + 推进 next（不动 last_fire_at——gated 非真跑，冷却闸判据不被污染） */
  settleGated(name: string, outcome: RunOutcome, nextFireAt: string | null, updatedAt: string): void {
    this.db
      .prepare(`UPDATE jobs SET last_outcome = ?, next_fire_at = ?, updated_at = ? WHERE name = ?`)
      .run(JSON.stringify(outcome), nextFireAt, updatedAt, name);
  }

  /** 跨进程在飞占用面写/清（OS cron 后端 --tick 子进程建占用） */
  setActive(name: string, pid: number | null, startedAt: string | null, updatedAt: string): void {
    this.db
      .prepare(`UPDATE jobs SET active_pid = ?, active_started_at = ?, updated_at = ? WHERE name = ?`)
      .run(pid, startedAt, updatedAt, name);
  }
}

/** jobs 表 DB 行形（蛇形列——fromDb 单源映射） */
interface JobsDbRow {
  name: string;
  prompt: string;
  cwd: string | null;
  schedule: string;
  enabled: number;
  builtin: number;
  created_at: string;
  updated_at: string;
  next_fire_at: string | null;
  last_fire_at: string | null;
  last_outcome: string | null;
  active_pid: number | null;
  active_started_at: string | null;
}

/** DB 行 → 契约行（schedule/last_outcome JSON 解析坏值容错降级——行是自有面，坏值 warn 不炸读） */
function fromDb(row: JobsDbRow): JobRow {
  let schedule: Schedule;
  try {
    schedule = JSON.parse(row.schedule) as Schedule;
  } catch {
    schedule = { kind: 'once', at: new Date(0).toISOString() };
  }
  let lastOutcome: RunOutcome | null = null;
  if (row.last_outcome) {
    try {
      lastOutcome = JSON.parse(row.last_outcome) as RunOutcome;
    } catch {
      lastOutcome = null;
    }
  }
  return {
    name: row.name,
    prompt: row.prompt,
    cwd: row.cwd,
    schedule,
    enabled: row.enabled === 1,
    builtin: row.builtin === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    nextFireAt: row.next_fire_at,
    lastFireAt: row.last_fire_at,
    lastOutcome,
    activePid: row.active_pid,
    activeStartedAt: row.active_started_at,
  };
}

/**
 * scheduler 服务（六动词程序面）。命令文态渲染归 tick.ts；本面只管行管理
 * 与守卫——/tick 与 CLI 对等（07 §5）共用此单源。
 */
export interface SchedulerService {
  /** add：全守卫（名词法/名冲突/schedule 词法/payload/cwd 存在）→ 建行 */
  addJob(req: AddJobRequest): JobRow;
  /**
   * builtin 行建行（04 §12 归属列 builtin 标记的正门——core: 件挂钟行专用：
   * goal 走第五槽 attachGoalJobsFace、issue 走本门直建 'issue-poll' 行；
   * 守卫与 addJob 共核 insertRow 同律）。
   */
  addBuiltinJob(req: AddJobRequest): JobRow;
  /** list：全行（名序） */
  listJobs(): JobRow[];
  /** 名寻径（缺席 undefined——/tick 用法面自判 NOT_FOUND 文案） */
  getJob(name: string): JobRow | undefined;
  /** rm：幽灵名守卫；cron 后端在场先注销 OS 注册（失败亮拒不半态）再删行 */
  removeJob(name: string): void;
  /** enable/disable 直打行：幽灵名守卫；cron 后端在场同步 OS 注册（失败亮拒、行不翻转） */
  setJobEnabled(name: string, enabled: boolean): void;
  /** 行内 schedule 人读串（/tick list 渲染面） */
  describeSchedule(name: string): string;
}

/** GoalJobsFace 四法契约面（04 §12——goal↔scheduler 不进拓扑边，组合根闭包注入窄面） */
export interface GoalJobsFace {
  /** 挂钟/重挂：schedule 坏串 → {ok:false, message} 响亮拒不炸装配（不抛） */
  register(req: {
    goalId: string;
    sessionId: string;
    schedule: string;
    promptSnapshot: string;
  }): Promise<{ ok: boolean; message: string }>;
  /** 终态/降级同笔停摆（行留史、enable 可复活；无行 = 静默 no-op） */
  disable(goalId: string): Promise<void>;
  /** resume/重挂复活（无行 = 静默 no-op） */
  enable(goalId: string): Promise<void>;
  /** 摘钟（删行；cron 可选后端启用形态下同步注销 OS 注册态；无行 = 静默 no-op） */
  remove(goalId: string): Promise<void>;
}

/** 服务装配（cronRegistrar/pathExists 缺省形态见 deps 注释） */
export function createSchedulerService(deps: SchedulerServiceDeps): {
  service: SchedulerService;
  dao: JobsDao;
  goalJobs: GoalJobsFace;
} {
  const dao = new JobsDao(deps.db);
  const pathExists = deps.pathExists ?? ((p: string) => statExists(p));
  const now = deps.now;

  /** 建行共核（add 与 goalJobs.register 单源——守卫/next_fire 初值全同律） */
  function insertRow(req: AddJobRequest, builtin: boolean): JobRow {
    if (!NAME_RE.test(req.name)) {
      throw new BaseError(
        'SCHEDULER_NAME_INVALID',
        `任务名「${req.name}」违例：须匹配 ${NAME_RE.source}（首字符字母数字、总长 ≤64）`,
      );
    }
    if (dao.get(req.name)) {
      throw new BaseError('SCHEDULER_NAME_EXISTS', `任务名「${req.name}」已被占用（jobs 表既有行）`);
    }
    const promptBytes = Buffer.byteLength(req.prompt, 'utf8');
    if (req.prompt.length === 0 || promptBytes > PROMPT_MAX_BYTES) {
      throw new BaseError('SCHEDULER_JOB_INVALID', `prompt 须非空且 ≤16KiB（得 ${promptBytes} 字节）`);
    }
    if (req.cwd !== null && req.cwd !== undefined) {
      if (!isAbsolute(req.cwd)) {
        throw new BaseError('SCHEDULER_JOB_INVALID', `cwd 须绝对路径（得「${req.cwd}」）`);
      }
      if (!pathExists(req.cwd)) {
        throw new BaseError('SCHEDULER_JOB_INVALID', `cwd 不存在（建行时点判——「${req.cwd}」）`);
      }
    }
    const schedule = resolveRelativeOnce(parseSchedule(req.schedule), new Date(now()));
    const enabled = req.enabled === true;
    const ts = now();
    const row: JobRow = {
      name: req.name,
      prompt: req.prompt,
      cwd: req.cwd ?? null,
      schedule,
      enabled,
      builtin,
      createdAt: ts,
      updatedAt: ts,
      nextFireAt: enabled ? nextFireAt(schedule, new Date(ts)) : null,
      lastFireAt: null,
      lastOutcome: null,
      activePid: null,
      activeStartedAt: null,
    };
    dao.insert(row);
    return row;
  }

  const service: SchedulerService = {
    addJob(req) {
      return insertRow(req, false);
    },
    addBuiltinJob(req) {
      return insertRow(req, true);
    },
    listJobs() {
      return dao.list();
    },
    getJob(name) {
      return dao.get(name);
    },
    removeJob(name) {
      const row = dao.get(name);
      if (!row) throw new BaseError('SCHEDULER_NOT_FOUND', `任务「${name}」不存在（rm 幽灵名零行守卫）`);
      if (deps.cronRegistrar && row.enabled) {
        deps.cronRegistrar.unregister(name); // 失败抛 SCHEDULER_CRON_*——行不删（不半态）
      }
      dao.remove(name);
    },
    setJobEnabled(name, enabled) {
      const row = dao.get(name);
      if (!row) {
        throw new BaseError(
          'SCHEDULER_NOT_FOUND',
          `任务「${name}」不存在（${enabled ? 'enable' : 'disable'} 幽灵名零行守卫）`,
        );
      }
      if (deps.cronRegistrar) {
        if (enabled)
          deps.cronRegistrar.register(row); // OS 注册失败抛——行不翻转
        else deps.cronRegistrar.unregister(name);
      }
      dao.setEnabled(name, enabled, now());
      // 启用即刻排 next_fire（禁用期未排；once 相对形建行已锚定、every/daily/weekly 从现在取下一刻）
      if (enabled) {
        const fresh = dao.get(name);
        if (fresh) {
          dao.advanceNextFire(
            name,
            nextFireAt(fresh.schedule, new Date(now()), fresh.lastFireAt ? new Date(fresh.lastFireAt) : undefined),
            now(),
          );
        }
      } else {
        dao.advanceNextFire(name, null, now()); // 停用即摘排（行留史）
      }
    },
    describeSchedule(name) {
      const row = dao.get(name);
      return row ? formatSchedule(row.schedule) : '';
    },
  };

  // ── GoalJobsFace 四法（第五槽窄面——挂钟行一切写经此单漏斗） ─────────────
  const goalJobs: GoalJobsFace = {
    async register(req) {
      const name = `goal-${req.goalId}`;
      try {
        const row = insertRow(
          { name, prompt: req.promptSnapshot, schedule: req.schedule, enabled: true, builtin: true },
          true,
        );
        if (deps.cronRegistrar) deps.cronRegistrar.register(row); // 挂钟行启用即挂 OS（乙案形态）
        return { ok: true, message: `挂钟已挂：${name}（${formatSchedule(row.schedule)}）` };
      } catch (err) {
        // 响亮拒不炸装配——message 载码与原因（goal 件消费方落诊断面）
        const message = err instanceof BaseError ? `${err.code}: ${err.message}` : String(err);
        return { ok: false, message };
      }
    },
    async disable(goalId) {
      const name = `goal-${goalId}`;
      if (!dao.get(name)) return; // 无行 = 静默 no-op
      service.setJobEnabled(name, false); // 行留史（enable 可复活）
    },
    async enable(goalId) {
      const name = `goal-${goalId}`;
      if (!dao.get(name)) return; // 无行 = 静默 no-op
      service.setJobEnabled(name, true);
    },
    async remove(goalId) {
      const name = `goal-${goalId}`;
      const row = dao.get(name);
      if (!row) return; // 无行 = 静默 no-op
      if (deps.cronRegistrar && row.enabled) deps.cronRegistrar.unregister(name); // 同步注销 OS 注册态
      dao.remove(name);
    },
  };

  return { service, dao, goalJobs };
}

/** cwd 存在判真身（缺省形态——测试注 pathExists 假件后不触盘） */
function statExists(p: string): boolean {
  try {
    statSync(p);
    return true;
  } catch {
    return false;
  }
}
