/**
 * goal 服务面（03 §10.5 + 04 §12 调度条 goal 挂钟节）。
 *
 * 编舞总览：
 *  - 生命周期：activate（单 active 撞席守卫 + 挂钟注册）/ resume（重绑锚 +
 *    复活挂钟）/ complete（完成否决律机器面：open 项在或 gate 未全绿即拒）/
 *    abandon（终态同笔停摆）；
 *  - 续跑触发：wake 双道（clock/manual）——重绑护栏（关闭后旧唤醒不落地）+
 *    wakeGate 双帽（停滞判定帽 + 唤醒预算帽 §4）+ 停滞硬停（连续无进展即
 *    停摆报告）+ 归因轮身份 durable 落账（goal_wakes 表——跨进程可审计）；
 *  - 预算双轨（04 §5）：记账刹停腿（recordTurn 前台计数 + foldDelegation
 *    委派结算折叠——两腿先到先刹）+ budgetExceeded 复验面（agent_pre_step
 *    消费——防记账腿与执行腿竞速漏刹）；
 *  - 挂钟行管理：GoalJobsFace 窄面单漏斗 + 第五槽迟到注入（先 goal 后
 *    scheduler 装载序的补接线——effect 可逆双序对称）。
 */
import { randomUUID } from 'node:crypto';
import { BaseError } from '../contracts/index.js';
import type { SqliteDatabase } from '../persist/index.js';
import { foldGoalTodos, openGoalItems, progressFingerprint } from './fold.js';
import { evaluateGoalGates, type GoalGateDeps } from './gates.js';
import type {
  GoalRow,
  GoalSessionFace,
  GoalSummarizerFace,
  GoalTodoItem,
  GoalWakeRow,
  GoalJobsFace,
  WakeDecision,
} from './types.js';

/** objective 硬帽（16KiB——与 scheduler prompt 帽同值） */
const OBJECTIVE_MAX_BYTES = 16 * 1024;
/** 停滞判定帽缺省（连续无进展唤醒轮数——超过即硬停报告） */
export const DEFAULT_STALL_LIMIT = 5;
/** 唤醒预算帽缺省（§4 maxConsecutiveWakes 同值——连续 clock 唤醒无进展即拒） */
export const DEFAULT_WAKE_BUDGET_LIMIT = 3;
/** 轮间沉淀摘要帽（04 §3.7 complete 单发 maxChars——注入面单条消息量级） */
export const GOAL_DEPOSIT_MAX_CHARS = 2000;

/** 沉淀单发提示词（objective + 计划态两段——单发即弃零会话态） */
function depositPrompt(row: GoalRow, items: readonly GoalTodoItem[]): string {
  const completed = items.filter((item) => item.status === 'completed').length;
  return [
    '为长期目标的下一轮工作生成一段简短沉淀摘要（供下一轮对话开局注入）。',
    `目标：${row.objective}`,
    `当前计划态：open ${items.length - completed} 项 / completed ${completed} 项。`,
    '要求：概括目标、当前进度与下一步建议，不含多余客套。',
  ].join('\n');
}

/** activate 请求形 */
export interface ActivateGoalRequest {
  sessionId: string;
  objective: string;
  /** 挂钟 schedule 串（词法解释权在 scheduler——本件经窄面注册回执判好坏） */
  schedule: string;
  /** 续跑提示词快照（缺省由 objective 派生——挂钟行 prompt 面） */
  promptSnapshot?: string;
  /** needsWrite 申报（command 判据门可用性——申报+人面批准后置 true） */
  needsWrite?: boolean;
  /** 前台记账帽（null/缺席 = 无帽） */
  budgetMessagesCap?: number | null;
}

/** 服务装配依赖 */
export interface GoalServiceDeps {
  db: SqliteDatabase;
  /** ISO UTC 时钟 */
  now: () => string;
  warn: (message: string) => void;
  /** 会话日志读面（宿主单源长度面——组合根闭包注入） */
  session: GoalSessionFace;
  /** goal id 生成器（缺省 randomUUID——测试注固定序列） */
  newId?: () => string;
  /** 判据门评测依赖（完成否决律消费面——workspaceRoot 必填，exec/lsp 缺席即该源 fail） */
  gates: Omit<GoalGateDeps, 'commandGateAllowed'>;
  /** 停滞判定帽（缺省 5） */
  stallLimit?: number;
  /** 唤醒预算帽（缺省 3——§4 maxConsecutiveWakes） */
  wakeBudgetLimit?: number;
  /**
   * 沉淀摘要窄面（批 #99——词面独立律：goal 席 DAG 无 llm 边，适配器归装配
   * 根注入）。缺席 = depositFor 恒走确定性回退（零 LLM 依赖保底）。
   */
  summarizer?: GoalSummarizerFace;
}

/** goal 服务公开面 */
export interface GoalService {
  /** 建 goal（单 active 撞席守卫 + 挂钟注册/迟到暂存） */
  activate(req: ActivateGoalRequest): Promise<GoalRow>;
  /** 重绑锚（易主/同会话皆重落 activatedSeq）+ 复活挂钟 + 停滞复位 */
  resume(goalId: string, opts?: { sessionId?: string }): Promise<GoalRow>;
  /** 终态 completed（机器否决：open 项在/gate 未全绿/缺 evidence 即拒——响亮列原因） */
  complete(goalId: string, evidence: string): Promise<GoalRow>;
  /** 终态 abandoned（同笔停摆挂钟） */
  abandon(goalId: string, reason?: string): Promise<GoalRow>;
  /** 唤醒裁决（重绑护栏 + wakeGate 双帽 + 停滞硬停 + 归因落账） */
  wake(goalId: string, opts: { trigger: 'clock' | 'manual'; attribution: string }): Promise<WakeDecision>;
  get(goalId: string): GoalRow | undefined;
  /** 会话当前 active goal（goalScopeFor 的取值面——undefined = fold 退化 run-scoped） */
  activeFor(sessionId: string): GoalRow | undefined;
  list(): GoalRow[];
  /** 归因审计面（/goal show 渲染） */
  wakes(goalId: string): GoalWakeRow[];
  /** 记账刹停腿：一轮记一笔（userInitiated 轮复位唤醒预算——用户在场才复位）；messages = 本窗 durable assistant/message 计数（04 §176 记账单位——批 #99 驱动窗扫供给，缺省 1 兼容单笔形） */
  recordTurn(
    goalId: string,
    opts?: { userInitiated?: boolean; messages?: number },
  ): { braked: boolean; used: number; cap: number | null };
  /** 委派结算折叠腿（subagent 结算喂入——批 15c 接线） */
  foldDelegation(goalId: string, units: number): void;
  /** agent_pre_step 复验面（两腿合计对帽——防竞速漏刹） */
  budgetExceeded(goalId: string): boolean;
  /**
   * 轮间沉淀读面（04 §3.7——批 #99 驱动 goalDeposit 供给）：同步返回缓存
   * 文本（缓存冷 = 确定性回退立即承载），指纹变化时后台单发刷新（fire-
   * and-forget——同指纹零 LLM 调用，刷新完成前回退值兜底）。undefined
   * active goal = null 零注入。
   */
  depositFor(sessionId: string): string | null;
  /** chat↔goal 数据通道窄面工厂（组合根闭包注入 conversation——零拓扑边） */
  goalScopeFor(sessionId: string): { goalId: string; activatedSeq: number } | undefined;
  /** 第五槽迟到注入（scheduler 装载晚于 goal 件的补接线——冲洗暂存挂钟需求） */
  attachGoalJobsFace(face: GoalJobsFace): Promise<void>;
  /** effect 可逆回卷（scheduler 卸载摘面——双序对称；后续注册再暂存） */
  detachGoalJobsFace(): void;
}

// ── goals 表族 DAO（行映射蛇 ↔ 驼峰单源） ─────────────────────────────────

interface GoalDbRow {
  id: string;
  session_id: string;
  objective: string;
  status: string;
  activated_seq: number;
  schedule: string;
  prompt_snapshot: string;
  needs_write: number;
  budget_messages_cap: number | null;
  budget_messages_used: number;
  budget_folded_units: number;
  stall_streak: number;
  wake_streak: number;
  last_fingerprint: string | null;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
  ending_note: string | null;
}

/** goals 表行查列清单（单源——get/list/activeFor 共用） */
const GOAL_COLUMNS = `id, session_id, objective, status, activated_seq, schedule, prompt_snapshot,
                      needs_write, budget_messages_cap, budget_messages_used, budget_folded_units,
                      stall_streak, wake_streak, last_fingerprint, created_at, updated_at,
                      ended_at, ending_note`;

class GoalDao {
  constructor(private readonly db: SqliteDatabase) {}

  get(id: string): GoalRow | undefined {
    const row = this.db.prepare(`SELECT ${GOAL_COLUMNS} FROM goals WHERE id = ?`).get(id) as GoalDbRow | undefined;
    return row ? goalFromDb(row) : undefined;
  }

  activeFor(sessionId: string): GoalRow | undefined {
    const row = this.db
      .prepare(`SELECT ${GOAL_COLUMNS} FROM goals WHERE session_id = ? AND status = 'active' LIMIT 1`)
      .get(sessionId) as GoalDbRow | undefined;
    return row ? goalFromDb(row) : undefined;
  }

  list(): GoalRow[] {
    const rows = this.db.prepare(`SELECT ${GOAL_COLUMNS} FROM goals ORDER BY created_at DESC`).all() as GoalDbRow[];
    return rows.map(goalFromDb);
  }

  insert(goal: GoalRow): void {
    this.db
      .prepare(
        `INSERT INTO goals (id, session_id, objective, status, activated_seq, schedule, prompt_snapshot,
                            needs_write, budget_messages_cap, budget_messages_used, budget_folded_units,
                            stall_streak, wake_streak, last_fingerprint, created_at, updated_at,
                            ended_at, ending_note)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        goal.id,
        goal.sessionId,
        goal.objective,
        goal.status,
        goal.activatedSeq,
        goal.schedule,
        goal.promptSnapshot,
        goal.needsWrite ? 1 : 0,
        goal.budgetMessagesCap,
        goal.budgetMessagesUsed,
        goal.budgetFoldedUnits,
        goal.stallStreak,
        goal.wakeStreak,
        goal.lastFingerprint,
        goal.createdAt,
        goal.updatedAt,
        goal.endedAt,
        goal.endingNote,
      );
  }

  /** 行更新（patch 形——updatedAt 调用方供） */
  update(id: string, patch: Partial<Omit<GoalRow, 'id' | 'createdAt'>>, updatedAt: string): void {
    const current = this.get(id);
    if (!current) return;
    const next = { ...current, ...patch, updatedAt };
    this.db
      .prepare(
        `UPDATE goals SET session_id = ?, objective = ?, status = ?, activated_seq = ?, schedule = ?,
                          prompt_snapshot = ?, needs_write = ?, budget_messages_cap = ?,
                          budget_messages_used = ?, budget_folded_units = ?, stall_streak = ?,
                          wake_streak = ?, last_fingerprint = ?, updated_at = ?, ended_at = ?,
                          ending_note = ?
         WHERE id = ?`,
      )
      .run(
        next.sessionId,
        next.objective,
        next.status,
        next.activatedSeq,
        next.schedule,
        next.promptSnapshot,
        next.needsWrite ? 1 : 0,
        next.budgetMessagesCap,
        next.budgetMessagesUsed,
        next.budgetFoldedUnits,
        next.stallStreak,
        next.wakeStreak,
        next.lastFingerprint,
        next.updatedAt,
        next.endedAt,
        next.endingNote,
        id,
      );
  }

  remove(id: string): void {
    this.db.prepare(`DELETE FROM goals WHERE id = ?`).run(id);
  }

  insertWake(
    goalId: string,
    wokeAt: string,
    trigger: 'clock' | 'manual',
    attribution: string,
    fingerprint: string,
    progressed: boolean,
  ): GoalWakeRow {
    const result = this.db
      .prepare(
        `INSERT INTO goal_wakes (goal_id, woke_at, trigger, attribution, fingerprint, progressed) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(goalId, wokeAt, trigger, attribution, fingerprint, progressed ? 1 : 0);
    return {
      id: Number(result.lastInsertRowid),
      goalId,
      wokeAt,
      trigger,
      attribution,
      fingerprint,
      progressed,
    };
  }

  wakes(goalId: string): GoalWakeRow[] {
    const rows = this.db
      .prepare(
        `SELECT id, goal_id, woke_at, trigger, attribution, fingerprint, progressed
                FROM goal_wakes WHERE goal_id = ? ORDER BY id`,
      )
      .all(goalId) as Array<{
      id: number;
      goal_id: string;
      woke_at: string;
      trigger: string;
      attribution: string;
      fingerprint: string;
      progressed: number;
    }>;
    return rows.map((r) => ({
      id: r.id,
      goalId: r.goal_id,
      wokeAt: r.woke_at,
      trigger: r.trigger as 'clock' | 'manual',
      attribution: r.attribution,
      fingerprint: r.fingerprint,
      progressed: r.progressed === 1,
    }));
  }
}

/** DB 行 → 契约行 */
function goalFromDb(row: GoalDbRow): GoalRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    objective: row.objective,
    status: row.status as GoalRow['status'],
    activatedSeq: row.activated_seq,
    schedule: row.schedule,
    promptSnapshot: row.prompt_snapshot,
    needsWrite: row.needs_write === 1,
    budgetMessagesCap: row.budget_messages_cap,
    budgetMessagesUsed: row.budget_messages_used,
    budgetFoldedUnits: row.budget_folded_units,
    stallStreak: row.stall_streak,
    wakeStreak: row.wake_streak,
    lastFingerprint: row.last_fingerprint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
    endingNote: row.ending_note,
  };
}

// ── 服务实装 ───────────────────────────────────────────────────────────────

export function createGoalService(deps: GoalServiceDeps): GoalService {
  const dao = new GoalDao(deps.db);
  const now = deps.now;
  const warn = deps.warn;
  const newId = deps.newId ?? randomUUID;
  const stallLimit = deps.stallLimit ?? DEFAULT_STALL_LIMIT;
  const wakeBudgetLimit = deps.wakeBudgetLimit ?? DEFAULT_WAKE_BUDGET_LIMIT;

  /** 挂钟窄面（迟到注入前 null——注册需求暂存） */
  let jobsFace: GoalJobsFace | null = null;
  /** 迟到暂存面（先 goal 后 scheduler 装载序的补接线队列） */
  const pendingClocks = new Set<string>();
  /** 轮间沉淀缓存（goalId → {指纹, 文本}——同指纹零 LLM 单发，批 #99） */
  const depositCache = new Map<string, { fingerprint: string; text: string }>();
  /** 沉淀单发在飞位（同 goal 至多一次在飞——请求组装路径不排队堆积） */
  const depositInFlight = new Set<string>();

  /** 单漏斗挂钟注册（activate 与 attach 冲洗共用；回执 {ok:false} 上抛响亮） */
  async function registerClock(goal: GoalRow): Promise<void> {
    if (jobsFace === null) {
      pendingClocks.add(goal.id);
      return;
    }
    const receipt = await jobsFace.register({
      goalId: goal.id,
      sessionId: goal.sessionId,
      schedule: goal.schedule,
      promptSnapshot: goal.promptSnapshot,
    });
    if (!receipt.ok) {
      throw new BaseError('GOAL_TRANSITION_INVALID', `挂钟注册失败（goal ${goal.id}）：${receipt.message}`);
    }
  }

  const service: GoalService = {
    async activate(req) {
      const bytes = Buffer.byteLength(req.objective, 'utf8');
      if (req.objective.length === 0 || bytes > OBJECTIVE_MAX_BYTES) {
        throw new BaseError('GOAL_GOAL_INVALID', `objective 须非空且 ≤16KiB（得 ${bytes} 字节）`);
      }
      if (dao.activeFor(req.sessionId)) {
        throw new BaseError(
          'GOAL_TRANSITION_INVALID',
          `会话 ${req.sessionId} 已有 active goal（单 active 守卫——先 complete/abandon 再建新）`,
        );
      }
      const ts = now();
      const goal: GoalRow = {
        id: newId(),
        sessionId: req.sessionId,
        objective: req.objective,
        status: 'active',
        activatedSeq: deps.session.length(req.sessionId),
        schedule: req.schedule,
        promptSnapshot: req.promptSnapshot ?? `继续推进目标：${req.objective}`,
        needsWrite: req.needsWrite === true,
        budgetMessagesCap: req.budgetMessagesCap ?? null,
        budgetMessagesUsed: 0,
        budgetFoldedUnits: 0,
        stallStreak: 0,
        wakeStreak: 0,
        lastFingerprint: null,
        createdAt: ts,
        updatedAt: ts,
        endedAt: null,
        endingNote: null,
      };
      dao.insert(goal);
      try {
        await registerClock(goal);
      } catch (err) {
        dao.remove(goal.id); // 注册失败回卷建行（不半态——goal 行与挂钟行同笔生死）
        throw err;
      }
      return dao.get(goal.id)!;
    },

    async resume(goalId, opts) {
      const row = dao.get(goalId);
      if (!row) throw new BaseError('GOAL_NOT_FOUND', `goal「${goalId}」不存在（resume 幽灵 id 零行守卫）`);
      if (row.status !== 'active') {
        throw new BaseError(
          'GOAL_TRANSITION_INVALID',
          `goal「${goalId}」已终态（${row.status}）——终态不复活，重开走新 goal`,
        );
      }
      const sessionId = opts?.sessionId ?? row.sessionId;
      // 易主守卫：目标会话已有别的 active goal 时拒绝重绑（单 active 不因易主破例）
      const incumbent = dao.activeFor(sessionId);
      if (incumbent !== undefined && incumbent.id !== goalId) {
        throw new BaseError(
          'GOAL_TRANSITION_INVALID',
          `会话 ${sessionId} 已有 active goal「${incumbent.id}」——重绑撞席拒`,
        );
      }
      dao.update(
        goalId,
        {
          sessionId,
          activatedSeq: deps.session.length(sessionId),
          stallStreak: 0,
          wakeStreak: 0,
          lastFingerprint: null,
        },
        now(),
      );
      await jobsFace?.enable(goalId); // 复活挂钟（停滞硬停后 resume 同律）
      return dao.get(goalId)!;
    },

    async complete(goalId, evidence) {
      const row = dao.get(goalId);
      if (!row) throw new BaseError('GOAL_NOT_FOUND', `goal「${goalId}」不存在（complete 幽灵 id 零行守卫）`);
      if (row.status !== 'active') {
        throw new BaseError('GOAL_TRANSITION_INVALID', `goal「${goalId}」已终态（${row.status}）——不可再迁转`);
      }
      if (evidence.trim().length === 0) {
        throw new BaseError(
          'GOAL_TRANSITION_INVALID',
          'goal_update 终态 completed 必附 evidence（非空——申报与验证分离，自报文本非唯一通道）',
        );
      }
      // 完成否决律：goal-scoped 计划态 open 项机器否决（响亮列 open 项）
      const items = foldGoalTodos(deps.session.events(row.sessionId), row.activatedSeq);
      const open = openGoalItems(items);
      if (open.length > 0) {
        const listing = open.map((item) => `[${item.status}] ${item.content}`).join('；');
        throw new BaseError(
          'GOAL_TRANSITION_INVALID',
          `完成否决——尚有 ${open.length} 个 open 项（open = 一切非 completed 项，deferred 含内无论窗到否）：${listing}`,
        );
      }
      // 携 gate 项须全绿（fail-closed 评测——seam 缺席即该门 fail）
      const outcomes = await evaluateGoalGates(items, { ...deps.gates, commandGateAllowed: row.needsWrite });
      const failed = outcomes.filter((o) => !o.ok);
      if (failed.length > 0) {
        const listing = failed.map((o) => `${o.kind} 门：${o.detail}`).join('；');
        throw new BaseError('GOAL_TRANSITION_INVALID', `完成否决——判据门未全绿（${listing}）`);
      }
      dao.update(goalId, { status: 'completed', endedAt: now(), endingNote: evidence }, now());
      await jobsFace?.disable(goalId); // 终态同笔停摆（行留史）
      return dao.get(goalId)!;
    },

    async abandon(goalId, reason) {
      const row = dao.get(goalId);
      if (!row) throw new BaseError('GOAL_NOT_FOUND', `goal「${goalId}」不存在（abandon 幽灵 id 零行守卫）`);
      if (row.status !== 'active') {
        throw new BaseError('GOAL_TRANSITION_INVALID', `goal「${goalId}」已终态（${row.status}）——不可再迁转`);
      }
      dao.update(goalId, { status: 'abandoned', endedAt: now(), endingNote: reason ?? 'abandoned' }, now());
      await jobsFace?.disable(goalId);
      return dao.get(goalId)!;
    },

    async wake(goalId, opts) {
      const row = dao.get(goalId);
      if (!row) throw new BaseError('GOAL_NOT_FOUND', `goal「${goalId}」不存在（wake 幽灵 id 零行守卫）`);
      // 重绑护栏：goal 关闭（终态）后旧唤醒不落地
      if (row.status !== 'active') {
        return {
          landed: false,
          reason: 'inactive',
          message: `goal「${goalId}」已终态（${row.status}）——唤醒不落地（重绑护栏）`,
          goal: row,
        };
      }
      const fingerprint = progressFingerprint(foldGoalTodos(deps.session.events(row.sessionId), row.activatedSeq));
      const progressed = row.lastFingerprint === null ? true : fingerprint !== row.lastFingerprint;

      // manual 道：手动起闹——停滞/预算双复位 + 挂钟复活（用户显式意图，双帽不辖）
      if (opts.trigger === 'manual') {
        dao.update(goalId, { stallStreak: 0, wakeStreak: 0, lastFingerprint: fingerprint }, now());
        await jobsFace?.enable(goalId);
        dao.insertWake(goalId, now(), 'manual', opts.attribution, fingerprint, progressed);
        const fresh = dao.get(goalId)!;
        return { landed: true, reason: 'ok', message: `手动唤醒已落地（停滞计数复位）`, goal: fresh };
      }

      // clock 道：wakeGate 双帽——进展即双复位直落；无进展走双帽判定
      if (progressed) {
        dao.update(goalId, { stallStreak: 0, wakeStreak: 0, lastFingerprint: fingerprint }, now());
        dao.insertWake(goalId, now(), 'clock', opts.attribution, fingerprint, true);
        return { landed: true, reason: 'ok', message: '唤醒落地（计划态有进展）', goal: dao.get(goalId)! };
      }
      const stallStreak = row.stallStreak + 1;
      if (stallStreak >= stallLimit) {
        // 停滞硬停：连续 N 轮无进展即停摆报告（不无限空转烧预算）——挂钟停摆
        // 留用户复位道（/goal wake 手动起闹 / resume 重绑），goal 行保持 active
        dao.update(goalId, { stallStreak, lastFingerprint: fingerprint }, now());
        await jobsFace?.disable(goalId);
        warn(`[goal] 停滞硬停：goal「${goalId}」连续 ${stallStreak} 轮唤醒无进展——挂钟停摆（/goal wake 可复位重跑）`);
        return {
          landed: false,
          reason: 'stalled',
          message: `停滞硬停：连续 ${stallStreak} 轮唤醒无进展（帽 ${stallLimit}）——挂钟已停摆，/goal wake 手动复位`,
          goal: dao.get(goalId)!,
        };
      }
      const wakeStreak = row.wakeStreak + 1;
      if (wakeStreak >= wakeBudgetLimit) {
        // 唤醒预算帽（§4 maxConsecutiveWakes）：连续 clock 唤醒无进展即拒再唤醒
        // （落 warn 不硬停——进展/用户轮/manual 任一即复位）
        dao.update(goalId, { stallStreak, wakeStreak, lastFingerprint: fingerprint }, now());
        warn(`[goal] 唤醒预算拒收：goal「${goalId}」连续 ${wakeStreak} 次无进展 clock 唤醒（帽 ${wakeBudgetLimit}）`);
        return {
          landed: false,
          reason: 'wake_budget',
          message: `唤醒预算拒收：连续 ${wakeStreak} 次无进展 clock 唤醒（帽 ${wakeBudgetLimit}）——本轮不起`,
          goal: dao.get(goalId)!,
        };
      }
      dao.update(goalId, { stallStreak, wakeStreak, lastFingerprint: fingerprint }, now());
      dao.insertWake(goalId, now(), 'clock', opts.attribution, fingerprint, false);
      return { landed: true, reason: 'ok', message: '唤醒落地（无进展——停滞/唤醒计数 +1）', goal: dao.get(goalId)! };
    },

    get: (goalId) => dao.get(goalId),
    activeFor: (sessionId) => dao.activeFor(sessionId),
    list: () => dao.list(),
    wakes: (goalId) => dao.wakes(goalId),

    recordTurn(goalId, opts) {
      const row = dao.get(goalId);
      if (!row)
        throw new BaseError('GOAL_NOT_FOUND', `goal「${goalId}」不存在（recordTurn 幽灵 id 零行守卫——装配接线错位）`);
      // 记账单位 = 本窗 durable assistant/message 条数（04 §176——批 #99 驱动
      // 窗扫供给；缺省 1 兼容旧单笔调用形）
      const used = row.budgetMessagesUsed + Math.max(1, Math.floor(opts?.messages ?? 1));
      dao.update(goalId, { budgetMessagesUsed: used, ...(opts?.userInitiated ? { wakeStreak: 0 } : {}) }, now());
      const folded = row.budgetFoldedUnits;
      return {
        braked: row.budgetMessagesCap !== null && used + folded >= row.budgetMessagesCap,
        used,
        cap: row.budgetMessagesCap,
      };
    },

    foldDelegation(goalId, units) {
      const row = dao.get(goalId);
      if (!row) throw new BaseError('GOAL_NOT_FOUND', `goal「${goalId}」不存在（foldDelegation 幽灵 id 零行守卫）`);
      dao.update(goalId, { budgetFoldedUnits: row.budgetFoldedUnits + Math.max(0, Math.floor(units)) }, now());
    },

    budgetExceeded(goalId) {
      const row = dao.get(goalId);
      if (!row) throw new BaseError('GOAL_NOT_FOUND', `goal「${goalId}」不存在（budgetExceeded 幽灵 id 零行守卫）`);
      return row.budgetMessagesCap !== null && row.budgetMessagesUsed + row.budgetFoldedUnits >= row.budgetMessagesCap;
    },

    depositFor(sessionId) {
      const row = dao.activeFor(sessionId);
      if (row === undefined) return null; // 无 active goal = 零注入（驱动同形降级）
      const items = foldGoalTodos(deps.session.events(sessionId), row.activatedSeq);
      const fingerprint = progressFingerprint(items);
      const cached = depositCache.get(row.id);
      if (cached !== undefined && cached.fingerprint === fingerprint) return cached.text;
      // 指纹已变（或缓存冷）：确定性回退立即承载 + 后台单发刷新（fire-and-
      // forget——请求组装路径零等待；同指纹失败也缓存回退，杜绝每请求重烧）
      const completed = items.filter((item) => item.status === 'completed').length;
      const fallback = `目标：${row.objective}\n计划态：open ${items.length - completed} 项 / completed ${completed} 项`;
      if (deps.summarizer !== undefined && !depositInFlight.has(row.id)) {
        depositInFlight.add(row.id);
        void deps.summarizer
          .complete({ prompt: depositPrompt(row, items), maxChars: GOAL_DEPOSIT_MAX_CHARS })
          .then((out) => {
            depositCache.set(row.id, { fingerprint, text: out.text.trim() === '' ? fallback : out.text });
          })
          .catch((err: unknown) => {
            warn(
              `[goal] 沉淀摘要单发失败（确定性回退承载同指纹缓存）：${err instanceof Error ? err.message : String(err)}`,
            );
            depositCache.set(row.id, { fingerprint, text: fallback });
          })
          .finally(() => depositInFlight.delete(row.id));
      }
      return cached !== undefined ? cached.text : fallback;
    },

    goalScopeFor(sessionId) {
      const row = dao.activeFor(sessionId);
      return row === undefined ? undefined : { goalId: row.id, activatedSeq: row.activatedSeq };
    },

    async attachGoalJobsFace(face) {
      jobsFace = face;
      // 迟到冲洗：暂存的挂钟需求逐笔补登记（失败 warn 亮拒不炸装配——goal 行
      // 留在场、挂钟缺席的事实交 /goal list 呈现与用户处置）
      const queued = [...pendingClocks];
      pendingClocks.clear();
      for (const goalId of queued) {
        const row = dao.get(goalId);
        if (!row || row.status !== 'active') continue; // 终态/已删行的迟到需求蒸发
        const receipt = await face.register({
          goalId: row.id,
          sessionId: row.sessionId,
          schedule: row.schedule,
          promptSnapshot: row.promptSnapshot,
        });
        if (!receipt.ok) {
          warn(
            `[goal] 迟到挂钟注册失败：goal「${goalId}」${receipt.message}（挂钟缺席——schedule 坏串请修正后 resume）`,
          );
        }
      }
    },

    detachGoalJobsFace() {
      jobsFace = null; // effect 可逆回卷（后续注册再暂存——双序对称）
    },
  };

  return service;
}
