/**
 * 跨件兼容互证（*.test.ts 拓扑豁免位——跨公开面互证唯一合法形）：
 *  - type-level：SubagentNotifyFace ↔ conversation driver 双方法形——
 *    driver.notifySubagentApprovalPending 可直赋 face.notifyApprovalPending
 *    （参数逆变成立 + 回执 Promise<unknown> 宽位）；notifySettled 适配器
 *    闭包（submit 三通道 + source='subagent-settled' 归因 + 后台唤醒位）
 *    编译期验。
 *  - behavioral：结构 fake driver 承接适配器——submit 收到结算文案与
 *    source/backgroundWake 语义位。
 *  - behavioral：goal foldDelegation 喂入 seam（词面独立律：subagent 经
 *    DAG 不可达 goal）——真 goal 服务（真 sqlite + 迁移）+ 真委派机器
 *    background 结算 → onSettled 适配器折叠 → budgetExceeded 翻真。
 *  - behavioral：provideJobsService scope round-trip（ctx.jobs 服务词汇）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionEvent, SubagentProvider, SubagentResult } from '../contracts/index.js';
import { Scope } from '../context/index.js';
import type { SubmitResult } from '../conversation/index.js';
import type { ConversationDriver } from '../conversation/index.js';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { GOAL_MIGRATION } from '../goal/migration.js';
import { createGoalService, type GoalService } from '../goal/service.js';
import type { GoalSessionFace } from '../goal/types.js';
import { createJobRegistry, type JobRegistry } from './registry.js';
import { createSubagentService } from './service.js';
import { JOBS_SERVICE_NAME, provideJobsService } from './provide.js';
import type { DelegationSettlement, SubagentNotifyFace } from './types.js';

// ── type-level：face ↔ driver 双方法形（组合根注入位——零运行时） ──

// driver 的审批挂起方法可直接充当 face 同名方法（参数同形 + 回执宽位）
const _driverServesFace: SubagentNotifyFace['notifyApprovalPending'] =
  null as unknown as ConversationDriver['notifySubagentApprovalPending'];

// notifySettled 适配器闭包：submit 已带 source 宽位（13c 落）+ 三通道单源
// routeMessage——结算通知走 steer/followUp 按父 run 状态自路由
const _settledAdapter: SubagentNotifyFace['notifySettled'] = (input) =>
  (null as unknown as ConversationDriver).submit(input.content, {
    source: 'subagent-settled',
    backgroundWake: true,
  });

// 编译期消费（防 tree-shake 假绿——两断言物在运行时被触碰）
void _driverServesFace;
void _settledAdapter;

describe('SubagentNotifyFace ↔ driver 适配器（结构 fake 承接）', () => {
  it('结算通知：适配器落 submit，携带 source 归因与后台唤醒位；审批挂起：直赋形可桥', async () => {
    const submits: Array<{ content: string; source?: string; backgroundWake?: boolean }> = [];
    const approvals: Array<{ jobName: string; approvalId: string; toolName: string }> = [];
    // 结构 fake（Pick 面——只承被桥的两方法，回执 SubmitResult 形）
    const fakeDriver = {
      submit: async (
        content: string,
        options?: { source?: string; backgroundWake?: boolean },
      ): Promise<SubmitResult> => {
        submits.push({ content, source: options?.source, backgroundWake: options?.backgroundWake });
        return { status: 'injected', seq: 1 };
      },
      notifySubagentApprovalPending: async (input: {
        approvalId: string;
        jobName: string;
        toolName: string;
      }): Promise<SubmitResult> => {
        approvals.push(input);
        return { status: 'injected', seq: 2 };
      },
    };
    // 组合根桥示范（与 type-level 适配器同形——真实接线位写的就是这两行）
    const face: SubagentNotifyFace = {
      notifySettled: (input) => fakeDriver.submit(input.content, { source: 'subagent-settled', backgroundWake: true }),
      notifyApprovalPending: (input) => fakeDriver.notifySubagentApprovalPending(input),
    };
    const registry = createJobRegistry();
    const service = createSubagentService({ registry, notify: face });
    service.registerProvider('in-process', {
      capabilities: { tools: true, streaming: true, cancel: true, background: true, structuredOutput: true },
      run: async (request) => {
        await request.notifyApproval?.({ approvalId: 'ap-9', toolName: 'write' });
        return { output: '后台产物', stopReason: 'stop' } satisfies SubagentResult;
      },
    });
    const outcome = await service.run({
      prompt: 'p',
      parentSessionId: 's1',
      depth: 1,
      background: true,
      name: '桥接员',
    });
    expect(outcome.mode).toBe('background');
    await vi.waitFor(() => {
      expect(submits).toHaveLength(1);
    });
    expect(submits[0]!).toMatchObject({ source: 'subagent-settled', backgroundWake: true });
    expect(submits[0]!.content).toContain('桥接员');
    expect(submits[0]!.content).toContain('后台产物');
    expect(approvals).toEqual([{ jobName: '桥接员', approvalId: 'ap-9', toolName: 'write' }]);
  });
});

describe('provideJobsService scope round-trip', () => {
  it('registry 经 scope.provide（词汇 jobs）入册，get/tryGet 同引用', () => {
    const scope = Scope.createRoot();
    const registry = createJobRegistry();
    expect(provideJobsService(scope, registry)).toBe(registry); // provide 返原物
    expect(scope.get<JobRegistry>(JOBS_SERVICE_NAME)).toBe(registry);
    expect(scope.tryGet<JobRegistry>(JOBS_SERVICE_NAME)).toBe(registry);
  });
});

// ── goal foldDelegation 喂入 seam（真 goal 服务 + 真委派机器） ──

let dir: string;
let store: Store | null = null;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-subagent-compat-'));
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 假会话日志读面（goal/service.test.ts 同 idiom） */
class FakeSession implements GoalSessionFace {
  private readonly logs = new Map<string, SessionEvent[]>();
  events(sessionId: string): readonly SessionEvent[] {
    return this.logs.get(sessionId) ?? [];
  }
  length(sessionId: string): number {
    return (this.logs.get(sessionId) ?? []).length;
  }
  push(sessionId: string, type: string, data: unknown): void {
    const arr = this.logs.get(sessionId) ?? [];
    arr.push({ type, seq: arr.length, time: 0, data });
    this.logs.set(sessionId, arr);
  }
}

describe('onSettled → goal.foldDelegation 喂入 seam', () => {
  it('background 结算折叠入 active goal 预算：budgetExceeded 随折叠翻真', async () => {
    store = openStore({
      dbPath: join(dir, 'test.db'),
      dataDir: join(dir, 'data'),
      secretKey: ephemeralSecretKey(),
      migrations: [GOAL_MIGRATION],
    });
    const goal: GoalService = createGoalService({
      db: store.sqlite(),
      now: () => '2026-09-07T08:00:00.000Z',
      warn: () => undefined,
      session: new FakeSession(),
      newId: () => 'g-1',
      gates: { workspaceRoot: '/ws', statFile: () => ({ exists: false, size: 0 }) },
    });
    const row = await goal.activate({
      sessionId: 's1',
      objective: '调研三仓',
      schedule: 'x',
      budgetMessagesCap: 2,
    });
    expect(goal.budgetExceeded(row.id)).toBe(false);

    // 组合根接线示范：onSettled 钩子桥 goal 折叠腿（词面独立律——subagent
    // 经 DAG 不可达 goal，组合根闭包是唯一通道；单位换算率归装配批定夺，
    // 此处 1 结算 = 1 折叠单位的 seam 示范值）
    const foldOnSettled = (settlement: DelegationSettlement): void => {
      const scope = goal.goalScopeFor(settlement.parentSessionId);
      if (scope === undefined) return; // 无 active goal——run-scoped 退化零折叠
      goal.foldDelegation(scope.goalId, 1);
    };

    const registry = createJobRegistry();
    const service = createSubagentService({ registry, onSettled: foldOnSettled });
    const provider: SubagentProvider = {
      capabilities: { tools: true, streaming: true, cancel: true, background: true, structuredOutput: true },
      run: async () => ({ output: 'o', stopReason: 'stop' }) as SubagentResult,
    };
    service.registerProvider('in-process', provider);

    // 两笔 background 结算 → 折叠 2 单位 ≥ 帽 2 → 刹停面翻真
    for (let i = 0; i < 2; i += 1) {
      await service.run({ prompt: `p${i}`, parentSessionId: 's1', depth: 1, background: true });
    }
    await vi.waitFor(() => {
      expect(goal.budgetExceeded(row.id)).toBe(true);
    });
    expect(goal.get(row.id)?.budgetFoldedUnits).toBe(2);

    // 无 active goal 会话（s2）：钩子零折叠不炸
    await service.run({ prompt: 'p', parentSessionId: 's2', depth: 1, background: true });
    await vi.waitFor(() => {
      expect(registry.running()).toHaveLength(0);
    });
    expect(goal.get(row.id)?.budgetFoldedUnits).toBe(2);
  });
});
