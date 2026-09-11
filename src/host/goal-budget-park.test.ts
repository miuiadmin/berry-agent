/**
 * host/goal-budget-park e2e——无人值守深化批 u-5 收口锁（04 §5 定形注③
 * 「goal 停靠化律」收口现判腿：agent.onRunSettled 装配位接线）。
 *
 * bootCore 形不可测归 e2e：offSettlePark 挂点在 core:goal 件装载期经
 * ctx.agent 服务订阅（goalScopeFor + budgetExceeded + parkGoalForBudget
 * 组合根闭包），件级单测（core-plugins 唤醒三分诊例）与服务级单测
 * （goal-service 停靠三动作）各自为真，但订阅链只在全栈装配在场成立——
 * 本件以 assembleHostStack 全真装配锁全链。
 *
 * 链路时序（driver 终态链真源——时序差即本锁的靶心）：runTurns finally →
 * notifyRunSettled（agent 订阅——offSettlePark 现判）**先于** launch.then →
 * noteRunSettled（recordTurn 记账）。故「记账刹停」形态 = 跨帽 run 的
 * **下一** run 收口现判停靠：
 *   run₁ 真起跑（faux 应答）→ 收口时 offSettlePark 判未超（记账未入）→
 *   recordTurn 记账 1/1 跨帽（braked）→
 *   run₂ agent_pre_step 复验刹停（零模型请求 completed）→
 *   run₂ 收口 offSettlePark 现判已超 → parkGoalForBudget 全链（内存登记 +
 *   挂钟行 disable + 会话落 session/paused + 广播件登记〔不可达面——宿主
 *   级单真身不入 DI，durable 三面代证〕）。
 *
 * 纪律：mock 只停模型层（faux provider）；装配/装载管线/引擎编舞全真。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import { fauxProvider } from '../llm/index.js';

import { assembleHostStack } from './assembly.js';
import type { GoalFace, SchedulerFace } from './core-plugins.js';

/* ---------------- 测试基建（scheduler-tick.test tickRig 同族） ---------------- */

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 造临时目录（统一入清账） */
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 零用量终态 assistant 消息（faux 响应脚本用） */
function messageOf(text: string): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 等条件真（有界轮询——停靠链 fire-and-forget，durable 面异步落） */
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('测试超时：条件未达成');
    await sleep(10);
  }
}

/**
 * e2e 装配（faux provider + 全真 assembleHostStack）。响应脚本备足 8 发——
 * 首请求的 goal 沉淀后台单发（depositFor 冷指纹 fire-and-forget complete）
 * 与主 run 各耗一发，余量防脚本耗尽误红
 */
async function parkRig() {
  const faux = fauxProvider({ provider: 'faux-park', models: [{ id: 'm1' }] });
  faux.setResponses(Array.from({ length: 8 }, () => () => messageOf('推进了一步')));
  const dataDir = tmpDir('park-data-');
  const ws = tmpDir('park-ws-');
  const assembly = await assembleHostStack({
    runtime: { dataDir },
    noPlugins: false,
    debug: false,
    version: 'test',
    providers: [faux.provider],
    model: 'faux-park/m1',
  });
  if (!assembly.ok) throw new Error(`装配失败：${assembly.message}`);
  const goal = assembly.scope.tryGet<GoalFace>('goal');
  if (goal === undefined) throw new Error('goal 件未装载');
  const sched = assembly.scope.tryGet<SchedulerFace>('scheduler');
  if (sched === undefined) throw new Error('scheduler 件未装载');
  return { assembly, goal, sched, ws, shutdown: () => assembly.runtime.shutdown() };
}

/* ---------------- offSettlePark 收口现判全链（04 §5 定形注③） ---------------- */

describe('goal 预算停靠收口现判 e2e（u-5——agent 面装配位）', () => {
  it('记账刹停形态：run₁ 记账跨帽（收口不停靠——时序差锁定）→ run₂ 复验刹停收口 → 停靠三动作全落', async () => {
    const rig = await parkRig();
    try {
      const { sessionId } = rig.assembly.stack.manager.create({ workspaceRoot: rig.ws });
      const row = await rig.goal.service.activate({
        sessionId,
        objective: 'e2e 停靠锁目标',
        schedule: 'every:30m',
        budgetMessagesCap: 1, // 首 run 即跨帽
      });
      const goalId = row.id;
      // 挂钟行建行即启（goalJobs register 形——goal-<id> builtin 行）
      expect(rig.sched.service.getJob(`goal-${goalId}`)?.enabled).toBe(true);

      // run₁：真起跑——faux 应答 1 条 assistant；收口时 offSettlePark 判未超
      //（agent 订阅先于 recordTurn 记账——本 run 不停靠正是时序差的锁定面），
      // 随后 recordTurn 记账 1/1 → budgetExceeded 翻真
      const first = await rig.assembly.stack.submitText(sessionId, '推进目标', { source: 'user' });
      expect(first?.status).toBe('completed');
      expect(rig.goal.service.budgetExceeded(goalId)).toBe(true);
      expect(rig.goal.service.isParkedForBudget(goalId)).toBe(false);

      // run₂：agent_pre_step 复验刹停（零模型请求 completed）→ 收口现判已超 →
      // parkGoalForBudget 全链起跑（fire-and-forget——durable 面有界轮询等落）
      const second = await rig.assembly.stack.submitText(sessionId, '继续推进', { source: 'user' });
      expect(second?.status).toBe('completed');
      await until(() => rig.goal.service.isParkedForBudget(goalId));

      // 停靠动作一：内存停靠登记（幂等判据面）
      expect(rig.goal.service.isParkedForBudget(goalId)).toBe(true);
      // 停靠动作二：挂钟行 disable（goal 行 status 三值不动——行留史可复活）
      await until(() => rig.sched.service.getJob(`goal-${goalId}`)?.enabled === false);
      // 停靠动作三：会话落 durable session/paused（daemon 猝死后冷启动可恢复
      // 呈现——04 §5 定形注②；fold 语义 = 尾条即停靠）
      await until(() => {
        const events = rig.assembly.stack.driverOf(sessionId)?.session.events() ?? [];
        return events.some((e) => e.type === 'session/paused');
      });
      const paused = rig.assembly.stack
        .driverOf(sessionId)!
        .session.events()
        .find((e) => e.type === 'session/paused');
      expect((paused?.data as { reason?: string } | undefined)?.reason).toBe('budget');
      // run₂ 零模型请求（复验刹停形）：faux 只被 run₁（+沉淀后台单发）消费，
      // run₂ 无 assistant/message 落账
      const assistantCount = rig.assembly.stack
        .driverOf(sessionId)!
        .session.events()
        .filter((e) => e.type === 'assistant/message').length;
      expect(assistantCount).toBe(1);
    } finally {
      await rig.shutdown();
    }
  });
});
