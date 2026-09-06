/**
 * goal 件契约面（02 §4.1 席 23 / 机制真源 03 §10.5 + 04 §12 调度条）。
 *
 * 件形态：goals 表族 + 计划态跨轮 fold + 续跑触发（wakeGate 双帽/停滞硬停/
 * 重绑护栏/归因落账）+ 预算双轨 + 挂钟行管理（经 GoalJobsFace 窄面）。
 *
 * 词面独立律（04 §12）：本件与 scheduler/conversation 零 DAG 边——
 *  - `GoalJobsFace` 与 scheduler 件同名接口词面独立、结构兼容（组合根闭包
 *    注入窄面，编译期即验；兼容性互证测试在 goal.test.ts）；
 *  - `GoalTodoItem` 与 conversation `TodoItemData` 结构兼容（前四字段同形，
 *    扩展字段 goal 段独有——durable `todo/write` 载荷两向兼容：conversation
 *    fold 读侧剥离未知字段、goal fold 读侧收窄扩展字段）。
 */
import type { SessionEvent } from '../contracts/index.js';

/** goal 状态（迁转面——终态两值不复活，续跑重开走新 goal） */
export type GoalStatus = 'active' | 'completed' | 'abandoned';

/** goals 行（goals 表族主表——goals 表 dao 映射单源） */
export interface GoalRow {
  /** goal 标识（行名寻径 `goal-<id>` 合挂钟名型；生成位 = 服务 newId 依赖） */
  readonly id: string;
  /** 归属会话（resume 可易主重绑） */
  readonly sessionId: string;
  /** 目标陈述（objective 锚定——轮间沉淀 complete 单发的锚） */
  readonly objective: string;
  readonly status: GoalStatus;
  /**
   * 激活锚（03 §10.5）：激活/resume 重绑时落的会话日志长度（宿主单源长度面）
   * ——goal 段 fold 边界 = seq ≥ 本值。
   */
  readonly activatedSeq: number;
  /** 挂钟 schedule 串（词法解释权在 scheduler schedule 单源——经窄面注册） */
  readonly schedule: string;
  /** 续跑提示词快照（挂钟行 prompt 面） */
  readonly promptSnapshot: string;
  /** needsWrite 申报（command gate 可用性判据——申报且人面批准后 true） */
  readonly needsWrite: boolean;
  /** 前台记账帽（null = 无帽；两腿先到先刹——04 §5 goal 预算双轨） */
  readonly budgetMessagesCap: number | null;
  /** 前台记账已用（assistant/message 轮计数） */
  readonly budgetMessagesUsed: number;
  /** 委派结算折叠累计（subagent 结算腿喂入——批 15c 接线） */
  readonly budgetFoldedUnits: number;
  /** 连续无进展唤醒轮数（fold 投影指纹不变 +1、变则清零——停滞判定帽计数面） */
  readonly stallStreak: number;
  /** 连续 clock 唤醒数（无进展不复位——唤醒预算帽 §4 计数面；用户在场/进展/手动即清） */
  readonly wakeStreak: number;
  /** 最近 fold 投影指纹（停滞判据面） */
  readonly lastFingerprint: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly endedAt: string | null;
  /** 终态回执（completed evidence / abandoned 理由 / 停滞硬停报告） */
  readonly endingNote: string | null;
}

/** goal_wakes 行（归因轮身份 durable 落账——哪个 run 为哪个 goal 醒的，跨进程可审计） */
export interface GoalWakeRow {
  readonly id: number;
  readonly goalId: string;
  readonly wokeAt: string;
  /** 唤醒道（clock = 挂钟到点；manual = /goal wake 手动起闹） */
  readonly trigger: 'clock' | 'manual';
  /** 归因轮身份（唤醒发起方标识——挂钟行名/手动命令面，审计用自由文本） */
  readonly attribution: string;
  /** 唤醒时 fold 投影指纹 */
  readonly fingerprint: string;
  /** 对前轮是否有进展（指纹变否） */
  readonly progressed: boolean;
}

/**
 * goal 段 todo/write 条目形（03 §10.5 goal 段扩语义）。
 *
 * 前四字段与 conversation `TodoItemData` 同形（结构兼容）；扩展五字段 goal
 * 段独有——非 goal 段申报即拒（GOAL_TODO_SCOPE 双向执法，todo-tool.ts）。
 */
export interface GoalTodoItem {
  readonly status: 'pending' | 'in-progress' | 'completed' | 'deferred';
  readonly content: string;
  readonly activeForm?: string;
  /** deferred 必携——词法 `after@<ISO> | after@+<n>[mhd]`（可 parse 可判窗） */
  readonly resumeWhen?: string;
  /** 双区（user 区 = 验收面——依赖用数据不用结构） */
  readonly role?: 'agent' | 'user';
  /** 任务分类（自由词面——编排件归因用） */
  readonly taskClass?: string;
  /** completed 必携后继二择一（follow_up 或 noFollowUp——防完成即失联） */
  readonly followUp?: string;
  readonly noFollowUp?: boolean;
  /** 判据门声明（三源——evaluateGoalGates fail-closed 评测） */
  readonly gate?: GateSpec;
}

/** 判据门三源（03 §10.5 gates 条——{kind, spec} 形） */
export type GateSpec =
  { kind: 'command'; command: string } | { kind: 'files'; paths: string[] } | { kind: 'diagnostics'; files: string[] };

/** 可写构建形（收窄/构建面的局部载体——readonly 契约形由返回承载） */
export type WritableGoalTodoItem = { -readonly [K in keyof GoalTodoItem]: GoalTodoItem[K] };

/** 判据门评测结局（完成否决律消费——ok 全绿才放行） */
export interface GateOutcome {
  readonly ok: boolean;
  readonly kind: GateSpec['kind'];
  readonly detail: string;
}

/**
 * GoalJobsFace 四法契约面（04 §12——词面独立于 scheduler 同名接口，结构
 * 兼容编译期即验；组合根闭包注入，goal↔scheduler 不进拓扑边）。
 */
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
  /** 摘钟（删行；无行 = 静默 no-op） */
  remove(goalId: string): Promise<void>;
}

/**
 * goal 段窄面值形（03 §10.5 chat↔goal 数据通道）：组合根 `goalScopeFor
 * (sessionId)` 闭包的返回形——goal 未装载/无 active goal = undefined，
 * conversation fold 退化 run-scoped 现行为。
 */
export interface GoalScope {
  readonly goalId: string;
  readonly activatedSeq: number;
}

/** 会话日志读面（宿主单源长度面——组合根闭包注入；长度 = 激活锚取值面） */
export interface GoalSessionFace {
  /** 会话事件全集（goal 段 fold 的重放面） */
  events(sessionId: string): readonly SessionEvent[];
  /** 会话日志长度（= 下一写入 seq——激活锚落值单源） */
  length(sessionId: string): number;
}

/** 唤醒裁决（wake 公开面返回——落地与否与拒因，调用方决定后续编排） */
export interface WakeDecision {
  readonly landed: boolean;
  readonly reason: 'ok' | 'inactive' | 'stalled' | 'wake_budget';
  readonly message: string;
  /** 裁决后的 goal 行快照（停滞硬停等带内状态变化回读面） */
  readonly goal: GoalRow;
}
