/**
 * host/goal-gate-exec e2e——ex 批收口锁（03 §10.5 ex 定形注：exec 判据门
 * 真接线全链兑现）。
 *
 * 修前形态（挂账真源）：makeGoalPlugin gateExec 恒 undefined——command gate
 * 申报即拒（GOAL_TODO_SCOPE「exec 执行面缺席」）+ 评测恒 fail。本件锁真接线
 * 后全链：activate needsWrite 申报 → /goal approve 批准 → todo 工具申报
 * command gate **过申报位**（hasCommandExec 翻真主锁）→ goal_update complete
 * 评测**真跑命令**（真 pipeline + 平台沙箱 + 恒 workspace-write 档——exit 0
 * 放行/非 0 拒/多门串行 fix #5）。
 *
 * 双拦维持锁：exec 件禁用（enabled.yaml core:exec disabled——生产真实形）
 * → 申报位照旧拒「exec 执行面缺席」（真接线不放开缺席形态——诚实缺席律）。
 *
 * 纪律：mock 只停模型层（faux provider——本件零模型调用，备量防装配方
 * 意外起跑）；装配/装载管线/守门/沙箱/spawn 全真。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import { fauxProvider } from '../llm/index.js';
import { BaseError } from '../contracts/index.js';

import { assembleHostStack } from './assembly.js';
import type { GoalFace } from './core-plugins.js';
import type { GoalService } from '../goal/index.js';
import type { ToolDefinition } from '../contracts/index.js';

/* ---------------- 测试基建（goal-budget-park.test rig 同族） ---------------- */

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

function messageOf(text: string): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 断言 promise 拒并返 BaseError（码断言用） */
async function expectCode(promise: Promise<unknown>, code: string): Promise<BaseError> {
  try {
    await promise;
    expect.unreachable(`应抛 ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
    return err as BaseError;
  }
}

/**
 * e2e 装配（faux provider + 全真 assembleHostStack + goalServiceSink 捕获）。
 * disableExec = true 时 dataDir 预写 enabled.yaml 禁 core:exec（例 D 生产
 * 真实形态）。
 */
async function gateRig(disableExec = false) {
  const faux = fauxProvider({ provider: 'faux-gate', models: [{ id: 'm1' }] });
  faux.setResponses(Array.from({ length: 4 }, () => () => messageOf('ok')));
  const dataDir = tmpDir('gate-data-');
  if (disableExec) {
    writeFileSync(join(dataDir, 'enabled.yaml'), 'plugins:\n  - id: core:exec\n    disabled: true\n');
  }
  const ws = tmpDir('gate-ws-');
  let serviceRef: GoalService | undefined;
  const assembly = await assembleHostStack({
    runtime: { dataDir },
    noPlugins: false,
    debug: false,
    version: 'test',
    providers: [faux.provider],
    model: 'faux-gate/m1',
    goalServiceSink: (service) => {
      serviceRef = service;
    },
  });
  if (!assembly.ok) throw new Error(`装配失败：${assembly.message}`);
  const goal = assembly.scope.tryGet<GoalFace>('goal');
  if (goal === undefined) throw new Error('goal 件未装载');
  if (serviceRef === undefined) throw new Error('goal 全环服务未捕获');
  return { assembly, goal, service: serviceRef!, ws, shutdown: () => assembly.runtime.shutdown() };
}

/** 申报+批准一个 needsWrite goal（返 goalId + 真 session log 面） */
async function approvedGoal(
  rig: Awaited<ReturnType<typeof gateRig>>,
): Promise<{ goalId: string; sessionId: string; todoTool: ToolDefinition }> {
  const opened = rig.assembly.stack.manager.create({ workspaceRoot: rig.ws });
  const sessionId = opened.sessionId;
  const row = await rig.service.activate({
    sessionId,
    objective: 'ex 批 gate e2e 目标',
    schedule: 'every:30m',
    needsWrite: true,
  });
  await rig.service.approve(row.id);
  // 会话级 todo 工具真身（conversation-stack 装配同形：append → todo/write
  // 落真事件流；getScope → goalScopeFor 活查）
  const session = opened.driver.session;
  const todoTool = rig.goal.todoFactory({
    append: (data) => session.append('todo/write', data),
    getScope: () => rig.goal.service.goalScopeFor(sessionId) ?? null,
  });
  return { goalId: row.id, sessionId, todoTool };
}

/* ---------------- 全链绿：申报过 + 批准 + 评测真跑 exit 0 ---------------- */

describe('goal command gate 真接线 e2e（ex 批——03 §10.5）', () => {
  it('全链：needsWrite 批准后申报过申报位（修前恒拒「exec 执行面缺席」）→ complete 评测真跑 exit 0 放行', async () => {
    const rig = await gateRig();
    try {
      const { goalId, sessionId, todoTool } = await approvedGoal(rig);
      // 双位合取活查：申报 + 批准 → allowed（翻真前置条件真值确认）
      expect(rig.service.commandGateStatus(goalId)).toEqual({ allowed: true, reason: 'ok' });
      // 申报位（修前红主锁位：gateExec 恒 undefined → GOAL_TODO_SCOPE 拒）
      await todoTool.execute(
        {
          items: [
            {
              status: 'completed',
              content: '过门',
              no_follow_up: true,
              gate: { kind: 'command', command: 'printf gate-ok' },
            },
          ],
        },
        {} as never,
      );
      // 申报落账（todo/write 进真事件流——complete 评测 fold 的数据源）
      const wrote = opened_events(rig, sessionId).some((e) => e.type === 'todo/write');
      expect(wrote).toBe(true);
      // 评测真跑：真 pipeline + 平台沙箱 + 恒 workspace-write——printf exit 0 放行
      const row = await rig.service.complete(goalId, 'e2e 证据');
      expect(row.status).toBe('completed');
    } finally {
      rig.shutdown();
    }
  });

  it('评测拒形：gate 命令 exit 3 → complete 拒 GOAL_TRANSITION_INVALID（退出码 3 非 0）', async () => {
    const rig = await gateRig();
    try {
      const { goalId, todoTool } = await approvedGoal(rig);
      await todoTool.execute(
        {
          items: [
            { status: 'completed', content: '败门', no_follow_up: true, gate: { kind: 'command', command: 'exit 3' } },
          ],
        },
        {} as never,
      );
      const err = await expectCode(rig.service.complete(goalId, '证据'), 'GOAL_TRANSITION_INVALID');
      expect(err.message).toContain('判据门未全绿');
      expect(err.message).toContain('退出码 3');
    } finally {
      rig.shutdown();
    }
  });

  it('多 command gate 串行评测（fix #5）：一绿一红 → 拒且报红门详情；双绿 → 过', async () => {
    const rig = await gateRig();
    try {
      // 一绿一红：listing 含红门退出码（串行逐门评测——非短路首门即返）
      const mixed = await approvedGoal(rig);
      await mixed.todoTool.execute(
        {
          items: [
            {
              status: 'completed',
              content: '绿门',
              no_follow_up: true,
              gate: { kind: 'command', command: 'printf a' },
            },
            { status: 'completed', content: '红门', no_follow_up: true, gate: { kind: 'command', command: 'exit 7' } },
          ],
        },
        {} as never,
      );
      const err = await expectCode(rig.service.complete(mixed.goalId, '证据'), 'GOAL_TRANSITION_INVALID');
      expect(err.message).toContain('退出码 7');
      // 双绿：两门全过 → complete 成功（多门不短路）
      const green = await approvedGoal(rig);
      await green.todoTool.execute(
        {
          items: [
            {
              status: 'completed',
              content: '门一',
              no_follow_up: true,
              gate: { kind: 'command', command: 'printf one' },
            },
            {
              status: 'completed',
              content: '门二',
              no_follow_up: true,
              gate: { kind: 'command', command: 'printf two' },
            },
          ],
        },
        {} as never,
      );
      const row = await rig.service.complete(green.goalId, '双绿证据');
      expect(row.status).toBe('completed');
    } finally {
      rig.shutdown();
    }
  });

  it('双拦维持锁：exec 件禁用 → 申报位照旧拒「exec 执行面缺席」（真接线不放开缺席形态）', async () => {
    const rig = await gateRig(true);
    try {
      expect(rig.assembly.scope.tryGet('exec')).toBeUndefined(); // 禁用生效（服务面缺席）
      const { goalId, todoTool } = await approvedGoal(rig);
      // 批准照真（双位绿）——缺席判据仍先于双位（判序锁：todo-tool 单元例镜像）
      expect(rig.service.commandGateStatus(goalId)).toEqual({ allowed: true, reason: 'ok' });
      const err = await expectCode(
        todoTool.execute(
          {
            items: [
              {
                status: 'completed',
                content: '缺席门',
                no_follow_up: true,
                gate: { kind: 'command', command: 'printf x' },
              },
            ],
          },
          {} as never,
        ),
        'GOAL_TODO_SCOPE',
      );
      expect(err.message).toContain('exec 执行面缺席');
      expect(err.message).not.toContain('/goal approve'); // 判序先于双位文案
    } finally {
      rig.shutdown();
    }
  });
});

/** 读会话真事件流（driver 活体面——memoryFs 独立桩无涉） */
function opened_events(rig: Awaited<ReturnType<typeof gateRig>>, sessionId: string) {
  return rig.assembly.stack.driverOf(sessionId)?.session.events() ?? [];
}
