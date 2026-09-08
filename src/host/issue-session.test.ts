/**
 * host/issue-session 测试——issue headless 会话真工厂（成熟度缺口 #5——
 * 04 §5 停靠/唤醒腿 + 03 §10.7 起会腿）。
 *
 * 真盘真库（临时目录 + 真实 Persistence + 真栈）+ faux provider 走真实
 * streamFn 路径（mock 只停在模型层）；canAfford 窄面注入可翻旗（词面独立律
 * 的测试红利——不碰真实 LlmService 预算态）。钉死六景：
 * ① 起跑全环（origin 'trigger' durable 行 + extraTools 管道注册 + completed
 *    映射 messagesUsed/summary + 首跑 source 'plugin:core:issue'）；
 * ② 起跑前池尽停靠（不 submit 零事件）+ budget_extended 唤醒续跑同会话
 *    （durable user/message source 'budget-extended'——05 §3.1 第六字面量）；
 * ③ run 中日池尽 watchdog 协作中止 → 停靠（outcome 悬置）→ dispose 收口
 *    paused（retain 语义）+ 终态 dismantle；
 * ④ 鲸鱼循环：连三唤醒后再唤醒 → driver 三帽 wake-refused → failed
 *    『连续后台唤醒超帽』（诚实边界）；
 * ⑤ 每 issue 消息帽：assistant 计数达帽 → abort → failed『每 issue 预算帽
 *    耗尽』（两层分账的 run 侧执法）；
 * ⑥ needs-human：completed 但存在被拒审批（无审批后端 notify 化到底即答
 *    cancel——approval/decided 闭集载荷判定）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { ToolDefinition } from '../contracts/index.js';
import { fauxProvider } from '../llm/index.js';

import { createConversationStack } from './conversation-stack.js';
import { createHostRuntime } from './runtime.js';
import type { HostRuntime } from './runtime.js';
import { createIssueSessionFactory } from './issue-session.js';

/* ---------------- 测试基建（subagent-factory.test.ts 同款形） ---------------- */

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** 组装指定终态的 assistant 消息（faux 响应脚本用——pi-ai 面形状） */
function messageOf(text = 'ok'): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text }],
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 工具调用 assistant 消息（faux 响应脚本用） */
function toolCallOf(id: string, name: string, args: Record<string, unknown>): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: args }],
    usage: NO_USAGE,
    stopReason: 'toolUse',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 挂起响应脚本（honor signal——abort 时以 aborted 终态收口） */
function hangHonoringSignal(): (ctx: unknown, opts: unknown) => Promise<PiAssistantMessage> {
  return (_ctx, opts) =>
    new Promise((resolve) => {
      const signal = (opts as { signal?: AbortSignal } | undefined)?.signal;
      if (signal === undefined || signal.aborted) {
        resolve({
          ...messageOf(),
          content: [],
          stopReason: signal?.aborted ? 'aborted' : 'stop',
        } as unknown as PiAssistantMessage);
        return;
      }
      signal.addEventListener(
        'abort',
        () => resolve({ ...messageOf(), content: [], stopReason: 'aborted' } as unknown as PiAssistantMessage),
        {
          once: true,
        },
      );
    });
}

/** 临时目录族 */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 新数据目录 + 真运行时速记 */
function rigRuntime(): { dir: string; rt: HostRuntime } {
  const dir = mkdtempSync(join(tmpdir(), 'issue-session-data-'));
  dirs.push(dir);
  const rt = createHostRuntime({ dataDir: dir });
  return { dir, rt };
}

/** 新工作区目录（非 git——canonical 回退字面 cwd） */
function rigWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'issue-session-ws-'));
  dirs.push(ws);
  return ws;
}

/** faux provider + 栈组装速记（工作区锚定隔离 ws） */
function rigStack(rt: HostRuntime, ws: string) {
  const faux = fauxProvider({ provider: 'faux-issue', models: [{ id: 'm1' }] });
  const stack = createConversationStack({
    runtime: rt,
    providers: [faux.provider],
    model: 'faux-issue/m1',
    env: {},
    workspace: () => ws,
  });
  return { faux, stack };
}

/** 可翻旗日池判（canAfford 窄面注入——词面独立律的测试红利） */
function mutableAfford(initial: boolean): { canAfford: () => boolean; set: (v: boolean) => void } {
  let ok = initial;
  return { canAfford: () => ok, set: (v) => (ok = v) };
}

/** 测试探针工具（extraTools 管道注册断言位——最小只读形） */
function probeTool(): ToolDefinition {
  return {
    name: 'issue_probe',
    description: '测试探针（extraTools 管道注册断言位）',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({ content: [{ type: 'text', text: 'ok' }] }),
  };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** outcome 落定等待（超时即测试失败——停靠悬置景的守卫位在 isPending） */
async function settle<T>(p: Promise<T>, ms = 4000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('测试超时：outcome 未落定')), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** promise 悬置判定（停靠语义的核心断言——04 §5 不落终态） */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  return await Promise.race([Promise.resolve(p).then(() => false), sleep(30).then(() => true)]);
}

/** 等条件真（有界轮询——watchdog/watcher 均为轮询执法，测试注 5ms 档） */
async function until(cond: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('测试超时：条件未达成');
    await sleep(10);
  }
}

/* ---------------- 真工厂全环（六景） ---------------- */

describe('createIssueSessionFactory（成熟度缺口 #5——真工厂全环）', () => {
  it('① 起跑全环：origin trigger durable 行 + extraTools 管道注册 + completed 映射 + 首跑 source 盖章', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const afford = mutableAfford(true);
    const factory = createIssueSessionFactory({
      stack,
      canAfford: afford.canAfford,
      warn: () => {},
      pollMs: 5,
    });

    faux.setResponses([() => messageOf('修好了')]);
    const { sessionId, outcome } = await factory.startHeadless({
      cwd: ws,
      prompt: '修复 issue #1',
      budgetMessages: 50,
      tools: [probeTool()],
    });
    const result = await settle(outcome);
    expect(result).toEqual({ status: 'completed', messagesUsed: 1, summary: '修好了' });

    // durable 行：origin 'trigger' + title（触发谱系归并——SessionOrigin 闭集）
    await rt.persistence.flush();
    const row = stack.manager.list({}).find((r) => r.id === sessionId);
    expect(row?.origin).toBe('trigger');
    // extraTools 经真三段管道注册（模型可见清单恒在律）
    expect(stack.manager.driverOf(sessionId)?.toolNames).toContain('issue_probe');
    // 首跑 source 盖章（03 §2.2 provenance——plugin: 域谱系归 1 跳）
    const userMsg = stack.manager
      .driverOf(sessionId)!
      .session.events()
      .find((e) => e.type === 'user/message');
    expect((userMsg?.data as { source?: string } | undefined)?.source).toBe('plugin:core:issue');
    // 终态收口：dismantle 停摆（驱动活体不残留）
    expect(stack.manager.driverOf(sessionId)?.dismantled).toBe(true);
    factory.dispose();
    await rt.shutdown();
  });

  it('② 起跑前池尽停靠（零事件不 submit）+ budget_extended 唤醒续跑同会话（durable source 第六字面量）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const afford = mutableAfford(false); // 起跑前日池尽
    const warns: string[] = [];
    const factory = createIssueSessionFactory({
      stack,
      canAfford: afford.canAfford,
      warn: (m) => warns.push(m),
      pollMs: 5,
    });

    faux.setResponses([() => messageOf('续跑完成')]);
    const { sessionId, outcome } = await factory.startHeadless({
      cwd: ws,
      prompt: '修复 issue #2',
      budgetMessages: 50,
      tools: [],
    });
    // 停靠即刻成立：outcome 悬置 + 零事件（未 submit——无 user/message）
    expect(await isPending(outcome)).toBe(true);
    expect(stack.manager.driverOf(sessionId)!.session.events()).toHaveLength(0);
    expect(warns.join()).toContain('停靠');

    // 唤醒腿：日池恢复（覆盖日池翻转与提额两形的电平判）→ watcher 起跑全部停靠 run
    afford.set(true);
    const result = await settle(outcome);
    expect(result).toEqual({ status: 'completed', messagesUsed: 1, summary: '续跑完成' });
    // 唤醒消息 durable 落账：source 'budget-extended'（05 §3.1 第六字面量）
    const events = stack.manager.driverOf(sessionId)!.session.events();
    const wake = events.find((e) => (e.data as { source?: string } | undefined)?.source === 'budget-extended');
    expect(wake?.type).toBe('user/message');
    // 零 submit 泄漏：首跑 prompt 未落账（起跑前已停靠——只有唤醒消息进日志）
    expect(events.filter((e) => e.type === 'user/message')).toHaveLength(1);
    factory.dispose();
    await rt.shutdown();
  });

  it('③ run 中日池尽：watchdog 协作中止 → 停靠悬置 → dispose 收口 paused（retain 语义）+ 终态 dismantle', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const afford = mutableAfford(true);
    const factory = createIssueSessionFactory({
      stack,
      canAfford: afford.canAfford,
      warn: () => {},
      pollMs: 5,
    });

    faux.setResponses([hangHonoringSignal()]);
    const { sessionId, outcome } = await factory.startHeadless({
      cwd: ws,
      prompt: '长活',
      budgetMessages: 50,
      tools: [],
    });
    // run 真起跑（在飞）后再翻池尽——watchdog 轮询执法窗内协作中止
    await until(() => stack.manager.driverOf(sessionId)!.running);
    afford.set(false);
    await until(() => !stack.manager.driverOf(sessionId)!.running);
    // 停靠成立：outcome 悬置（04 §5 不落终态）+ 会话上下文保留（driver 活体）
    expect(await isPending(outcome)).toBe(true);
    expect(stack.manager.driverOf(sessionId)?.dismantled).toBe(false);

    // 停机收口：resolve paused（retain——worktree/授予归 orphanScan 重入）+ dismantle
    factory.dispose();
    const result = await settle(outcome);
    expect(result.status).toBe('paused');
    expect(result.status === 'paused' && result.reason).toContain('宿主停机');
    expect(stack.manager.driverOf(sessionId)?.dismantled).toBe(true);
    await rt.shutdown();
  });

  it('④ 鲸鱼循环：连三唤醒后再唤醒 → driver 三帽拒收 wake-refused → failed『连续后台唤醒超帽』', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const afford = mutableAfford(true);
    const factory = createIssueSessionFactory({
      stack,
      canAfford: afford.canAfford,
      warn: () => {},
      pollMs: 5,
    });

    // 每轮都挂起（honor signal）——run 起跑 → 池尽 abort → 停靠 → 恢复唤醒，
    // 循环四次：第 4 次唤醒件 driver 三帽拒收（04 §4 maxConsecutiveWakes=3）
    faux.setResponses([hangHonoringSignal(), hangHonoringSignal(), hangHonoringSignal(), hangHonoringSignal()]);
    const { sessionId, outcome } = await factory.startHeadless({
      cwd: ws,
      prompt: '鲸鱼任务',
      budgetMessages: 5000,
      tools: [],
    });
    for (let round = 0; round < 4; round += 1) {
      await until(() => stack.manager.driverOf(sessionId)!.running); // 本轮起跑
      afford.set(false); // 池尽 → watchdog abort → 停靠
      await until(() => !stack.manager.driverOf(sessionId)!.running);
      afford.set(true); // 恢复 → watcher 唤醒下一轮（第 4 轮 wake-refused 收口）
    }
    const result = await settle(outcome);
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toContain('连续后台唤醒超帽');
    expect(result.status === 'failed' && result.reason).toContain('人工介入');
    factory.dispose();
    await rt.shutdown();
  });

  it('⑤ 每 issue 消息帽：assistant 计数达帽 → abort → failed『每 issue 预算帽耗尽』', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const afford = mutableAfford(true);
    const factory = createIssueSessionFactory({
      stack,
      canAfford: afford.canAfford,
      warn: () => {},
      pollMs: 5,
    });

    // 首拍工具调用（assistant/message #1 落账）→ 工具执行后二次调用挂起——
    // 在飞窗内计数达帽（budgetMessages=1）→ cap abort
    faux.setResponses([() => toolCallOf('t-read', 'read', { path: 'note.txt' }), hangHonoringSignal()]);
    const { outcome } = await factory.startHeadless({
      cwd: ws,
      prompt: '超帽任务',
      budgetMessages: 1,
      tools: [],
    });
    const result = await settle(outcome);
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toContain('每 issue 预算帽耗尽');
    expect(result.status === 'failed' && result.messagesUsed).toBeGreaterThanOrEqual(1);
    factory.dispose();
    await rt.shutdown();
  });

  it('⑥ needs-human：completed 但存在被拒审批（无后端 notify 化到底即答 cancel）→ 改判 needs-human', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const afford = mutableAfford(true);
    const factory = createIssueSessionFactory({
      stack,
      canAfford: afford.canAfford,
      warn: () => {},
      pollMs: 5,
    });

    // write 需审批 + 零审批后端 → askFace notify 化到底即答 cancel（无人值守
    // fail-closed）→ approval/decided {decision:'cancel'} durable 落账；拒后
    // 模型收口 stop → completed 改判 needs-human（闭集载荷判定不猜文本）
    faux.setResponses([
      () => toolCallOf('t-write', 'write', { path: 'out.txt', content: 'x' }),
      () => messageOf('写不了，收工'),
    ]);
    const { sessionId, outcome } = await factory.startHeadless({
      cwd: ws,
      prompt: '写文件任务',
      budgetMessages: 50,
      tools: [],
    });
    const result = await settle(outcome);
    expect(result.status).toBe('needs-human');
    expect(result.status === 'needs-human' && result.reason).toContain('审批被拒');
    // 判据纯事件载荷：approval/decided decision 'cancel' 在场（不是文本猜测）
    const decided = stack.manager
      .driverOf(sessionId)!
      .session.events()
      .filter((e) => e.type === 'approval/decided');
    expect(decided.length).toBeGreaterThanOrEqual(1);
    expect((decided[0]?.data as { decision?: string } | undefined)?.decision).toBe('cancel');
    factory.dispose();
    await rt.shutdown();
  });
});
