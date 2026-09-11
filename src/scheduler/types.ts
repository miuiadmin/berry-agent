/**
 * scheduler 域契约类型（04 §12 调度条——jobs 表行形 / 触发结局 / 服务面；
 * 02 §4.1 #22 席：L3、deps contracts+context+persist）。
 */
import type { Schedule } from './schedule.js';

/** jobs 表行（迁移 v2 建表；列名蛇形入表、驼峰出表——DAO 层做映射） */
export interface JobRow {
  /** 行名（主键；`^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$`——goal 挂钟行 goal-<goalId> 同型） */
  name: string;
  /** 每次触发的任务提示词（≤16KiB；goal 挂钟行为 promptSnapshot） */
  prompt: string;
  /** 任务工作目录（绝对路径；run 子进程 cwd；建行时须存在） */
  cwd: string | null;
  /** canonical schedule（JSON 序列化入表 schedule 列） */
  schedule: Schedule;
  /** 启停位（add 缺省 false——「存在 ≠ 启用」防注册即自治；enable/disable 直打） */
  enabled: boolean;
  /** 内置任务标记（goal 挂钟/记忆 review 编排 = true；用户任务 false——04 §12 归属列已裁形态） */
  builtin: boolean;
  /** 建行时刻（ISO UTC） */
  createdAt: string;
  /** 末次行更新时刻（ISO UTC） */
  updatedAt: string;
  /** 下次到点（ISO UTC；null = 不再 due——once 已过或未排） */
  nextFireAt: string | null;
  /** 上次触发时刻（ISO UTC；null = 从未触发） */
  lastFireAt: string | null;
  /** 上次触发结局摘要（JSON；null = 从未触发/从未被闸拦） */
  lastOutcome: RunOutcome | null;
  /**
   * 跨进程在飞占用面（claim-then-advance 接线律——04 §12 无人值守执行链
   * 定形注③，u-2 接线兑现）：fire 起跑经引擎 setActive 记账（甲案进程内
   * runner = 宿主 pid；乙案 spawn 形 = 子进程 pid）、settle 清。消费位 =
   * 乙案并存窗双向让位（引擎 fire 前跨进程在飞判定 + run-entry --tick
   * 读行让位律）与 start() 僵行清扫（pid 死 + 超墙钟 → 行回 idle）。
   */
  activePid: number | null;
  /** 在飞 run 起跑时刻（ISO UTC；activePid 判活后的僵行清扫依据） */
  activeStartedAt: string | null;
}

/** 触发来源三值（04 §12：进程内挂钟 / 手动 / OS cron 后端 --tick 载体） */
export type TriggerKind = 'clock' | 'manual' | 'cron';

/** 触发结局（行内摘要形——终态镜像落 jobs 行；§10 ctx.jobs 的「终态不落库」豁免不辖此面） */
export interface RunOutcome {
  trigger: TriggerKind;
  /**
   * 结局分类：exit_code 正常收场 / timeout / killed / preempted 被新实例
   * 占 / gated 触发前置门拦（含 runner 内零跑判定——wake 未落地/分派处理
   * 器缺席/跨进程在飞让位）/ yielded 乙案子进程让位形（诚实退出非失败——
   * u-2 定形注③让位律载体）/ spawn 子进程没起来
   */
  reason: 'exit_code' | 'timeout' | 'killed' | 'preempted' | 'gated' | 'yielded' | 'spawn';
  /** 退出码（exit_code 形在场；其余形缺席） */
  exitCode?: number;
  /** gated 形携带拦截门 id；他形缺席 */
  gate?: string;
  /** 人读错误摘要（≤200 字符） */
  error?: string;
  /** 结算时刻（ISO UTC） */
  finishedAt: string;
  /** 末条 assistant 文本预览（≤200 字符——/tick list 观察面） */
  finalTextPreview?: string;
}

/** 服务装配依赖（全注入——零全局态；测试假件同面） */
export interface SchedulerDeps {
  /** 同实例库句柄（persist Store.sqlite()——better-sqlite3 裸导入只准 persist） */
  db: import('../persist/index.js').SqliteDatabase;
  /** 时钟（ISO UTC 字符串——与 persist clock 同形） */
  now: () => string;
  /** 日志面（warn 级——装配接 createLogger） */
  warn: (message: string) => void;
}
