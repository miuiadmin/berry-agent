/**
 * host/scheduler-tick — 甲案进程内 tick 执行腿（u-2 G0 修复笔——04 §12
 * 「无人值守执行链定形注」①②的码面兑现）。
 *
 * 定位：RunnerFactory 接缝的**进程内第二实装**（第一实装 = runner.ts 进程
 * spawn 形，乙案 OS cron 触发腿/CLI 手动形专用）。引擎编舞（抢占/闸评估/
 * 墙钟/settle）零改动——只换装配位注入的 runner 真身：
 *
 * - **进程内推进律（定形注①）**：fire 不 spawn——宿主进程内经
 *   conversation-stack 起 headless run（与 `run --read-only --tick` 同语义
 *   链）。既有护栏全执法照常：RunLaneGate 宿主级 run 并发帽（经
 *   stack.submitText 与前台 run 同池同帽）、§5 预算闸（settle 后记后台道
 *   ——与 run-entry --background 记账律同形）、§9 审批（走宿主审批瀑布
 *   ——无人应答时 unavailable fail-closed 语义不变）。
 * - **builtin 行程序化分派律（定形注②）**：builtin 标记行按名程序化分派
 *   件内处理器——零模型调用零 spawn；行 prompt 字段 = 审计呈现占位
 *   （占位串不进模型面）。goal 挂钟行 → goal 件唤醒判定链、`issue-poll`
 *   → IssueService.pollOnce、`memory-review` → 件内编排入口（v1 前瞻位
 *   ——处理器缺席诚实 gated 拒）。
 * - **墙钟守卫两形（定形注④）**：kill = stack.interrupt 协作中止
 *   （driver.abort()——乙案 kill 形归 process runner 实装，两形互不代偿）。
 *
 * 分派处理器 fire 时动态解析（装载序无关——goal/issue 件可后装）；
 * 处理器缺席 = 配置漂移形，gated 结局诚实拒（不动 last_fire_at——引擎
 * settled 段按 reason==='gated' 分流 settleGated）。
 */
import { cwd as processCwd } from 'node:process';

import { canonicalWorkspaceRoot } from '../context/index.js';
import type { Usage, UsageBuckets } from '../contracts/index.js';
import type { LlmUsageEventData } from '../llm/index.js';

import type { ConversationStack } from './conversation-stack.js';
import type { RunnerFactory, RunnerHandle, RunnerRequest } from '../scheduler/index.js';
import type { JobRow, RunOutcome } from '../scheduler/types.js';

/** goal 件唤醒判定链窄面（GoalService.wake 投影——词面独立律，GoalJobsFace 同形） */
export interface GoalWakeFace {
  wake(
    goalId: string,
    opts: { trigger: 'clock' | 'manual'; attribution: string },
  ): Promise<{
    landed: boolean;
    reason: string;
    message: string;
    goal: { sessionId: string };
  }>;
}

/** issue 件轮询窄面（IssueService.pollOnce 投影——PollReport 摘要字段） */
export interface IssuePollFace {
  pollOnce(): Promise<{
    repos: readonly string[];
    seen: number;
    candidates: number;
    enqueued: number;
    duplicates: number;
    rejected: number;
  }>;
}

/** memory-review 编排入口窄面（v1 前瞻位——件内编排入口装载态未提供） */
export type MemoryReviewFace = () => Promise<void>;

/** 结局预览截断（process runner 同值——RunOutcome.finalTextPreview 帽） */
const PREVIEW_CAP = 200;

/** 依赖注入面（装配位接线真身——测试注假件零模型零进程） */
export interface SchedulerTickDeps {
  /** 宿主对话栈（headless run 提交/中断/事件流真源） */
  readonly stack: ConversationStack;
  /** goal 件唤醒判定链（fire 时动态解析；缺席 = goal 行漂移 gated 形） */
  readonly resolveGoal: () => GoalWakeFace | undefined;
  /**
   * goal 唤醒起跑前池检（u-3——04 §5 定形注③第二形态）：wake 落地而日池
   * 已尽时不硬拒——改停靠-唤醒（goal 件编舞：disable 挂钟行 + 会话落
   * session/paused + 广播登记）。fire 时动态解析；缺席 = 池检腿缺席直接
   * 起跑（run 期 agent_pre_step 复验刹停仍兜底在——独立装配形零降级）。
   */
  readonly resolveGoalPark?: () => GoalParkFace | undefined;
  /** issue 件轮询入口（fire 时动态解析；缺席 = issue-poll 行漂移 gated 形） */
  readonly resolveIssuePoll: () => IssuePollFace | undefined;
  /** memory-review 编排入口（v1 恒缺席——前瞻分派位，04 §12 定形注②第三员） */
  readonly resolveMemoryReview?: () => MemoryReviewFace | undefined;
  /** ISO UTC 时钟（缺省 new Date().toISOString()） */
  readonly now?: () => string;
  /** 告警面（缺省 console.error） */
  readonly warn?: (message: string) => void;
}

/**
 * goal 预算停靠投影（goal 件闭包——查池+停靠内聚单动词，tick 侧零预算知识
 * 〔词面独立律〕；GoalFace.parkIfBudgetExhausted 函数形直配）。
 */
export type GoalParkFace = (goalId: string) => Promise<boolean>;

/**
 * 进程内 tick runner 工厂。编舞三路：builtin 分派（零模型）/ goal 挂钟行
 * （wake 判定 + 落地则提交 goal 会话）/ 用户行（到点跑其提示词）。
 */
export function createSchedulerTickRunner(deps: SchedulerTickDeps): RunnerFactory {
  const now = deps.now ?? (() => new Date().toISOString());
  const warn = deps.warn ?? ((message: string) => console.error(message));

  return {
    async spawn(req: RunnerRequest): Promise<RunnerHandle> {
      const { row, trigger } = req;

      // —— builtin 行：程序化分派（零模型零 spawn——占位串不进模型面） ——
      if (row.builtin) {
        if (row.name === 'issue-poll') return spawnIssuePoll(row, trigger);
        if (row.name.startsWith('goal-')) return spawnGoalRow(row, trigger);
        if (row.name === 'memory-review') return spawnMemoryReview(row, trigger);
        // 未知 builtin 名：行在册而分派表不识——配置漂移诚实拒（不猜处理器）
        return settledHandle(trigger, {
          reason: 'gated',
          error: `未知 builtin 行「${row.name}」——分派表无此名（goal-<id>/issue-poll/memory-review 三员之外）`,
        });
      }

      // —— 用户行：进程内 headless run（新建会话 + 行 prompt 提交） ——
      return spawnUserRow(row, trigger);
    },
  };

  /** 一次性结局句柄（零跑形态——gated 拒/spawn 同步失败等） */
  function settledHandle(
    trigger: RunnerRequest['trigger'],
    outcome: Omit<RunOutcome, 'trigger' | 'finishedAt'>,
  ): RunnerHandle {
    return {
      pid: process.pid,
      kill: () => {}, // 已收场——kill 幂等空放
      settled: Promise.resolve({ ...outcome, trigger, finishedAt: now() }),
    };
  }

  /** 在飞 run 句柄铸造（kill = 协作中止；killedReason 优先折结算局——trigger 已由 settle 载入 outcome） */
  function inflightHandle(sessionId: string | null, settle: () => Promise<RunOutcome>): RunnerHandle {
    let killedReason: 'timeout' | 'preempted' | null = null;
    const settled = settle().then((outcome) => {
      // kill 已先行（墙钟超时/新实例抢占）——reason 折 kill 形（process runner 同律）
      if (killedReason !== null) {
        return {
          ...outcome,
          reason: killedReason,
          exitCode: undefined,
          error: `被中止（${killedReason === 'timeout' ? '墙钟超时' : '新实例抢占'}）`,
        } satisfies RunOutcome;
      }
      return outcome;
    });
    return {
      pid: process.pid,
      kill(reason) {
        killedReason = reason;
        if (sessionId !== null) deps.stack.interrupt(sessionId); // 协作中止（driver.abort()——定形注④甲案形）
      },
      settled,
    };
  }

  /** 用户行编舞：新建会话 → submitText（source='schedule'）→ 三终态映射 + 后台道记账 */
  function spawnUserRow(row: JobRow, trigger: RunnerRequest['trigger']): RunnerHandle {
    const workspaceRoot = canonicalWorkspaceRoot(row.cwd ?? processCwd());
    let sessionId: string;
    try {
      sessionId = deps.stack.manager.create({ workspaceRoot }).sessionId;
    } catch (err) {
      return settledHandle(trigger, {
        reason: 'spawn',
        error: `会话创建失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return runSession(trigger, sessionId, row.prompt);
  }

  /** goal 挂钟行编舞：wake 判定先行（零模型）——落地则 goal 会话提交 promptSnapshot。判定段（毫秒级 DB 读）先于句柄铸造，kill 不可达窗可忽略 */
  async function spawnGoalRow(row: JobRow, trigger: RunnerRequest['trigger']): Promise<RunnerHandle> {
    const goalId = row.name.slice('goal-'.length);
    const goal = deps.resolveGoal();
    if (goal === undefined) {
      // goal 行在册而 goal 件未装载——配置漂移（run-entry 同款诚实拒语义）
      warn(`[SCHEDULER_GOAL_MISSING] goal 挂钟行「${row.name}」在册而 core:goal 件未装载——配置漂移，本轮诚实拒`);
      return settledHandle(trigger, {
        reason: 'gated',
        error: 'goal 件未装载——挂钟行配置漂移（wake 判定链不可用）',
      });
    }
    const decision = await goal.wake(goalId, {
      // 引擎载体归因（与 run-entry --tick 形同串——tick:<行名> 可审计）
      trigger: 'clock',
      attribution: `tick:${row.name}`,
    });
    if (!decision.landed) {
      // 诚实零跑：不落即本轮无事（inactive/stalled/wake_budget 各由 message 说明）
      return settledHandle(trigger, {
        reason: 'gated',
        error: `goal「${goalId}」本轮未唤醒（${decision.reason}）：${decision.message}`,
      });
    }
    // 唤醒起跑前池检（u-3——04 §5 定形注③第二形态）：wake 判定链只看 goal
    // 自身（停滞/唤醒预算），日池尽在此拦——改停靠-唤醒（disable 挂钟行 +
    // 会话落词 + 广播登记，budget_extended 恢复时同链唤醒），gated 零跑收场
    const park = deps.resolveGoalPark?.();
    if (park !== undefined && (await park(goalId))) {
      return settledHandle(trigger, {
        reason: 'gated',
        error: `goal「${goalId}」唤醒落地而起跑前日池尽——预算停靠（挂钟停摆 + session/paused 落词，待 budget_extended 广播唤醒）`,
      });
    }
    // 落地：goal 绑定会话幂等开驱动后提交 promptSnapshot（与 run-entry tick 形同链）
    try {
      const sessionId = deps.stack.manager.open(decision.goal.sessionId).sessionId;
      return runSession(trigger, sessionId, row.prompt);
    } catch (err) {
      return settledHandle(trigger, {
        reason: 'spawn',
        error: `goal 会话打开失败：${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  /** issue-poll 行编舞：直调 pollOnce（零模型——定形注②「占位串不进模型」正位） */
  function spawnIssuePoll(row: JobRow, trigger: RunnerRequest['trigger']): RunnerHandle {
    void row; // 行 prompt 恒为占位——分派只认名，prompt 不消费
    return inflightHandle(null, async () => {
      const poller = deps.resolveIssuePoll();
      if (poller === undefined) {
        // issue-poll 行在册而 issue 件未装载——配置漂移（处理器缺席诚实拒）
        warn('[SCHEDULER_POLL_MISSING] issue-poll 行在册而 core:issue 件未装载——配置漂移，本轮诚实拒');
        return {
          trigger,
          reason: 'gated',
          error: 'issue 件未装载——轮询处理器缺席（pollOnce 不可达）',
          finishedAt: now(),
        } satisfies RunOutcome;
      }
      try {
        const report = await poller.pollOnce();
        const preview = `轮询 ${report.repos.length} 仓：候选 ${report.candidates}、入队 ${report.enqueued}、互斥 ${report.duplicates}、拒 ${report.rejected}`;
        return {
          trigger,
          reason: 'exit_code',
          exitCode: 0,
          finalTextPreview: preview.slice(0, PREVIEW_CAP),
          finishedAt: now(),
        } satisfies RunOutcome;
      } catch (err) {
        return {
          trigger,
          reason: 'exit_code',
          exitCode: 1,
          error: err instanceof Error ? err.message : String(err),
          finishedAt: now(),
        } satisfies RunOutcome;
      }
    });
  }

  /** memory-review 行编舞：前瞻位——编排入口装载态未提供，诚实 gated（定形注②第三员） */
  function spawnMemoryReview(row: JobRow, trigger: RunnerRequest['trigger']): RunnerHandle {
    void row;
    return inflightHandle(null, async () => {
      const review = deps.resolveMemoryReview?.();
      if (review === undefined) {
        // v1 恒此路：件内编排入口未装载（行若在册即漂移）——零模型诚实拒
        warn('[SCHEDULER_REVIEW_MISSING] memory-review 行在册而编排入口未装载——前瞻分派位诚实拒');
        return {
          trigger,
          reason: 'gated',
          error: 'memory-review 编排入口未装载（v1 前瞻分派位）',
          finishedAt: now(),
        } satisfies RunOutcome;
      }
      try {
        await review();
        return { trigger, reason: 'exit_code', exitCode: 0, finishedAt: now() } satisfies RunOutcome;
      } catch (err) {
        return {
          trigger,
          reason: 'exit_code',
          exitCode: 1,
          error: err instanceof Error ? err.message : String(err),
          finishedAt: now(),
        } satisfies RunOutcome;
      }
    });
  }

  /**
   * 会话 run 编舞共用（用户行/goal 落地形单源）：起跑前 seq 锚 →
   * submitText（source='schedule'）→ 三终态映射 + 后台道记账。
   */
  function runSession(trigger: RunnerRequest['trigger'], sessionId: string, prompt: string): RunnerHandle {
    // 起跑前 seq 锚（后台道记账窗——本 run 新增 assistant 消息的 seq 下界）
    const seqBefore = deps.stack.driverOf(sessionId)?.session.events().length ?? 0;
    const runPromise = deps.stack.submitText(sessionId, prompt, { source: 'schedule' });
    if (runPromise === undefined) {
      // 驱动缺席（open/create 与提交间被拆——理论不达防御，诚实失败）
      return settledHandle(trigger, {
        reason: 'spawn',
        error: `会话 ${sessionId} 无驱动在册——提交序不可达`,
      });
    }
    return inflightHandle(sessionId, async () => {
      const result = await runPromise;
      // 后台道记账（run-entry --background ⑦ 段同律：本 run 新增 assistant
      // 消息逐条落 llm/usage——deterministic callId `tick:<sid>:<seq>` 幂等身份）
      recordBackgroundUsage(sessionId, seqBefore);
      if (result.status === 'completed') {
        const outcome: RunOutcome = { reason: 'exit_code', exitCode: 0, trigger, finishedAt: now() };
        const preview = lastAssistantText(sessionId);
        if (preview !== undefined) outcome.finalTextPreview = preview.slice(0, PREVIEW_CAP);
        return outcome;
      }
      if (result.status === 'failed') {
        return {
          reason: 'exit_code',
          exitCode: 1,
          error: (result.errorMessage ?? 'run 失败（无错误说明）').slice(0, PREVIEW_CAP),
          trigger,
          finishedAt: now(),
        };
      }
      // aborted（interrupt 协作中止——kill 未先行时为外部中止形）
      return { reason: 'killed', error: 'run 中止（协作 abort）', trigger, finishedAt: now() };
    });
  }

  /** 末条 assistant 文本（text 块拼接——run-entry 同律，thinking 不入产物） */
  function lastAssistantText(sessionId: string): string | undefined {
    const events = deps.stack.driverOf(sessionId)?.session.events() ?? [];
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev === undefined || ev.type !== 'assistant/message') continue;
      const content = (ev.data as { content?: { type: string; text?: string }[] }).content;
      if (!Array.isArray(content)) return undefined;
      const text = content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return text === '' ? undefined : text;
    }
    return undefined;
  }

  /** 后台道记账：seqBefore 起新增 assistant 消息逐条落 llm/usage（priority background） */
  function recordBackgroundUsage(sessionId: string, seqBefore: number): void {
    const driver = deps.stack.driverOf(sessionId);
    if (driver === undefined) return;
    for (const event of driver.session.events()) {
      if (event.seq < seqBefore || event.type !== 'assistant/message') continue;
      const usage = (event.data as { usage?: Usage }).usage;
      if (usage === undefined) continue; // 无计量不造零账
      const ledger: LlmUsageEventData = {
        callId: `tick:${sessionId}:${event.seq}`,
        model: deps.stack.model,
        usage: toBuckets(usage),
        priority: 'background',
      };
      driver.session.append('llm/usage', ledger);
    }
  }
}

/** Usage → 计量四桶（05 §1.1——totalTokens/cost 不入账，派生/折算在投影侧） */
function toBuckets(usage: Usage): UsageBuckets {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead,
    cacheWrite: usage.cacheWrite,
    ...(usage.cacheWrite1h !== undefined ? { cacheWrite1h: usage.cacheWrite1h } : {}),
    ...(usage.reasoning !== undefined ? { reasoning: usage.reasoning } : {}),
  };
}
