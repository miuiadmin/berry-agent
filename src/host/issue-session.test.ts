/**
 * host/issue-session 测试——issue headless 会话真工厂（成熟度缺口 #5——
 * 04 §5 停靠/唤醒腿 + 03 §10.7 起会腿）。
 *
 * 真盘真库（临时目录 + 真实 Persistence + 真栈）+ faux provider 走真实
 * streamFn 路径（mock 只停在模型层）；canAfford 窄面注入可翻旗（词面独立律
 * 的测试红利——不碰真实 LlmService 预算态）。钉死六景：
 * ① 起跑全环（origin 'trigger' durable 行 + extraTools 管道注册 + completed
 *    映射 messagesUsed/summary + 首跑 source 'plugin:core:issue'）；
 * ② 起跑前池尽停靠（不 submit 零模型事件）+ budget_extended 唤醒续跑同
 *    会话（durable user/message source 'budget-extended'——05 §3.1 第六
 *    字面量）+ session/paused 落词锁（u-3——04 §5 定形注②，daemon 猝死
 *    后冷启动可恢复呈现）；
 * ③ run 中日池尽 watchdog 协作中止 → 停靠（outcome 悬置）+ 落词 → dispose
 *    收口 paused（retain 语义）+ 终态 dismantle；
 * ④ 鲸鱼循环：连三唤醒后再唤醒 → driver 三帽 wake-refused → failed
 *    『连续后台唤醒超帽』（诚实边界）+ 逐轮落词恰 4 条（第 5 次唤醒被拒
 *    未起跑不落词）；
 * ⑤ 每 issue 消息帽：assistant 计数达帽 → abort → failed『每 issue 预算帽
 *    耗尽』（两层分账的 run 侧执法）；
 * ⑥ needs-human：completed 但存在被拒审批（无审批后端 notify 化到底自报
 *    unavailable——approval/decided 闭集载荷判定）。
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
import { createBudgetBroadcast } from './budget-broadcast.js';

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
    // 在飞期捕获驱动引用（settle 尾 manager.retire 摘登记——05 §7 retire 律，
    // 终态后 driverOf 缺席；断言面改持捕获引用）
    const driver = stack.manager.driverOf(sessionId)!;
    const result = await settle(outcome);
    expect(result).toEqual({ status: 'completed', messagesUsed: 1, summary: '修好了' });

    // durable 行：origin 'trigger' + title（触发谱系归并——SessionOrigin 闭集）
    await rt.persistence.flush();
    const row = stack.manager.list({}).find((r) => r.id === sessionId);
    expect(row?.origin).toBe('trigger');
    // extraTools 经真三段管道注册（模型可见清单恒在律）
    expect(driver.toolNames).toContain('issue_probe');
    // 首跑 source 盖章（03 §2.2 provenance——plugin: 域谱系归 1 跳）
    const userMsg = driver.session.events().find((e) => e.type === 'user/message');
    expect((userMsg?.data as { source?: string } | undefined)?.source).toBe('plugin:core:issue');
    // 终态收口：retire（dismantle 停摆 + 摘活体登记——驱动无界驻留修复）
    expect(driver.dismantled).toBe(true);
    expect(stack.manager.isOpen(sessionId)).toBe(false);
    factory.dispose();
    await rt.shutdown();
  });

  it('② 起跑前池尽停靠（零模型事件不 submit + session/paused 落词）+ budget_extended 唤醒续跑同会话（durable source 第六字面量）', async () => {
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
    // 停靠即刻成立：outcome 悬置 + 零模型事件（未 submit——无 user/message）
    // + session/paused 落词（u-3 锁——04 §5 定形注②：daemon 猝死后冷启动
    // 可恢复呈现；修复前无此词必红）
    expect(await isPending(outcome)).toBe(true);
    const driver = stack.manager.driverOf(sessionId)!; // 停靠态活体（收口前捕获——settle 尾 retire）
    const parkedEvents = driver.session.events();
    expect(parkedEvents.filter((e) => e.type === 'user/message')).toHaveLength(0);
    const paused = parkedEvents.find((e) => e.type === 'session/paused');
    expect((paused?.data as { reason?: string } | undefined)?.reason).toBe('budget');
    expect(warns.join()).toContain('停靠');

    // 唤醒腿：日池恢复（覆盖日池翻转与提额两形的电平判）→ watcher 起跑全部停靠 run
    afford.set(true);
    const result = await settle(outcome);
    expect(result).toEqual({ status: 'completed', messagesUsed: 1, summary: '续跑完成' });
    // 唤醒消息 durable 落账：source 'budget-extended'（05 §3.1 第六字面量）
    const events = driver.session.events();
    const wake = events.find((e) => (e.data as { source?: string } | undefined)?.source === 'budget-extended');
    expect(wake?.type).toBe('user/message');
    // 零 submit 泄漏：首跑 prompt 未落账（起跑前已停靠——只有唤醒消息进日志）
    expect(events.filter((e) => e.type === 'user/message')).toHaveLength(1);
    factory.dispose();
    await rt.shutdown();
  });

  it('③ run 中日池尽：watchdog 协作中止 → 停靠悬置 → dispose 收口 paused（retain 语义）+ 单会话收口 retire', async () => {
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
    const driver = stack.manager.driverOf(sessionId)!; // 在飞期捕获（dispose 收口 retire 后 driverOf 缺席）
    // run 真起跑（在飞）后再翻池尽——watchdog 轮询执法窗内协作中止
    await until(() => driver.running);
    afford.set(false);
    await until(() => !driver.running);
    // 停靠成立：outcome 悬置（04 §5 不落终态）+ 会话上下文保留（driver 活体）
    // + session/paused 落词（u-3——run 中池尽与起跑前池尽同词承载，fold
    // 语义 = 尾条即停靠）
    expect(await isPending(outcome)).toBe(true);
    expect(driver.dismantled).toBe(false);
    const pausedMid = driver.session.events().find((e) => e.type === 'session/paused');
    expect((pausedMid?.data as { reason?: string } | undefined)?.reason).toBe('budget');

    // 停机收口：resolve paused（retain——worktree/授予归 orphanScan 重入）+ 单会话收口
    factory.dispose();
    const result = await settle(outcome);
    expect(result.status).toBe('paused');
    expect(result.status === 'paused' && result.reason).toContain('宿主停机');
    expect(driver.dismantled).toBe(true); // retire 面一：dismantle 停摆
    expect(stack.manager.isOpen(sessionId)).toBe(false); // retire 面二：摘活体登记
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
    const driver = stack.manager.driverOf(sessionId)!; // 在飞期捕获（wake-refused 收口即 retire）
    for (let round = 0; round < 4; round += 1) {
      await until(() => driver.running); // 本轮起跑
      afford.set(false); // 池尽 → watchdog abort → 停靠
      await until(() => !driver.running);
      afford.set(true); // 恢复 → watcher 唤醒下一轮（第 4 轮 wake-refused 收口）
    }
    const result = await settle(outcome);
    expect(result.status).toBe('failed');
    expect(result.status === 'failed' && result.reason).toContain('连续后台唤醒超帽');
    expect(result.status === 'failed' && result.reason).toContain('人工介入');
    // 逐轮落词恰 4 条：四轮起跑-停靠各落一笔（第 4 次唤醒仍成功起跑——
    // 三帽拒的是循环结束后的第 5 次 submit）；wake-refused 收口未起跑不
    // 落词（词与行为同账）
    expect(driver.session.events().filter((e) => e.type === 'session/paused')).toHaveLength(4);
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

    // write 需审批 + 零审批后端 → askFace notify 化到底自报 unavailable（无人
    // 值守结构态，2026-09-13 真模型实测批修——修前误答 cancel）→ approval/
    // decided {decision:'unavailable'} durable 落账；拒后模型收口 stop →
    // completed 改判 needs-human（闭集载荷判定不猜文本）
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
    const driver = stack.manager.driverOf(sessionId)!; // 在飞期捕获（终态 retire 后 driverOf 缺席）
    const result = await settle(outcome);
    expect(result.status).toBe('needs-human');
    expect(result.status === 'needs-human' && result.reason).toContain('审批被拒');
    // 判据纯事件载荷：approval/decided decision 'unavailable' 在场（不是文本猜测）
    const decided = driver.session.events().filter((e) => e.type === 'approval/decided');
    expect(decided.length).toBeGreaterThanOrEqual(1);
    expect((decided[0]?.data as { decision?: string } | undefined)?.decision).toBe('unavailable');
    factory.dispose();
    await rt.shutdown();
  });

  it('⑦ 广播注入形（u-3——04 §5 定形注①）：停靠登记入宿主件 + 宿主件唤醒续跑 + 工厂 dispose 不连坐宿主件', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const afford = mutableAfford(false); // 起跑前日池尽
    // 宿主级单真身（装配根同构注入——ownsBroadcast=false 形）：与工厂同源
    // canAfford 电平，pollMs 5
    const broadcast = createBudgetBroadcast({ canAfford: afford.canAfford, pollMs: 5 });
    const factory = createIssueSessionFactory({
      stack,
      canAfford: afford.canAfford,
      warn: () => {},
      pollMs: 5,
      broadcast, // 注入形——工厂只持登记面，不自建不代管
    });

    faux.setResponses([() => messageOf('注入形续跑')]);
    const { sessionId, outcome } = await factory.startHeadless({
      cwd: ws,
      prompt: '注入形任务',
      budgetMessages: 50,
      tools: [],
    });
    // 停靠成立：登记入宿主件（size 1——三停靠面同播的正位）+ 落词
    expect(await isPending(outcome)).toBe(true);
    await until(() => broadcast.size() === 1);
    expect(
      stack.manager
        .driverOf(sessionId)!
        .session.events()
        .some((e) => e.type === 'session/paused'),
    ).toBe(true);

    // 宿主件电平判唤醒（升格后真源——非工厂私有 watcher）→ 续跑完成
    afford.set(true);
    const result = await settle(outcome);
    expect(result).toEqual({ status: 'completed', messagesUsed: 1, summary: '注入形续跑' });
    expect(broadcast.size()).toBe(0); // 唤醒侧同笔摘——空登记面

    // 工厂 dispose 不连坐宿主件（注入形 ownsBroadcast=false——宿主件归
    // 装配根 registerCloser 收口；缺省形才自建自收）
    factory.dispose();
    expect(() => broadcast.register({ wake: () => {} })).not.toThrow();
    broadcast.dispose(); // 测试自收口
    await rt.shutdown();
  });

  it('⑧ 车道兑现（修前红——04 §5 车道兑现笔射程勘正 + 四役补笔）：首跑与唤醒轮桥接落账 priority=background + 后台日池如实计入', async () => {
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

    // 带计量的 faux assistant（桥接窗扫的计量源——usage 非零可断言池计入面）
    const metered = (input: number, output: number): PiAssistantMessage =>
      ({
        role: 'assistant',
        content: [{ type: 'text', text: 'ok' }],
        usage: { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output },
        stopReason: 'stop',
        timestamp: 1,
      }) as unknown as PiAssistantMessage;

    // —— 首跑腿（runRound 首跑分支：source plugin:core:issue 不带唤醒位）——
    faux.setResponses([() => metered(30, 12)]);
    const first = await factory.startHeadless({ cwd: ws, prompt: '车道首跑', budgetMessages: 50, tools: [] });
    expect((await settle(first.outcome)).status).toBe('completed');

    // —— 唤醒腿（runRound 唤醒分支全路径：起跑前池尽停靠 → budget_extended
    //    唤醒续跑同会话——backgroundWake:true 腿同置车道）——
    afford.set(false);
    faux.setResponses([() => metered(10, 5)]);
    const second = await factory.startHeadless({ cwd: ws, prompt: '车道唤醒', budgetMessages: 50, tools: [] });
    expect(await isPending(second.outcome)).toBe(true); // 停靠悬置（未 submit）
    afford.set(true); // 日池恢复 → 广播件唤醒续跑
    expect((await settle(second.outcome)).status).toBe('completed');

    // 事件字面锁：两会话流 llm/usage 笔 priority = background（修前红锚：
    // 起跑未声明车道 → 桥接 receipt.backgroundLane 恒 false → foreground——
    // 起跑前池检/watchdog 与预警 ratio 消费的后台日池对 issue 自身消耗失明）
    await rt.persistence.flush();
    const pensOf = (sessionId: string): Record<string, unknown>[] =>
      rt.persistence.store
        .queryEvents({ sessionId, types: ['llm/usage'], sinceMs: 0 })
        .events.map((e) => e.data as Record<string, unknown>);
    const firstPens = pensOf(first.sessionId);
    const secondPens = pensOf(second.sessionId);
    expect(firstPens).toHaveLength(1);
    expect(secondPens).toHaveLength(1);
    for (const pen of [firstPens[0]!, secondPens[0]!]) {
      expect(pen['priority']).toBe('background');
      expect(String(pen['callId'])).toMatch(/^run:.+:\d+$/); // run 路桥接同源
    }

    // 消费面闭环：当日后台池如实计入（修前红锚：spent 恒 0；数值面与转抄笔
    // 同源断言——faux 计量动态取转抄值，不硬编）
    const ledgerTotal = [firstPens[0]!, secondPens[0]!].reduce((sum, pen) => {
      const usage = pen['usage'] as { input: number; output: number };
      return sum + usage.input + usage.output;
    }, 0);
    expect(stack.llm.backgroundUsage().spent).toBe(ledgerTotal);
    expect(stack.llm.backgroundUsage().spent).toBeGreaterThan(0); // 计入面非零（主锁）
    factory.dispose();
    await rt.shutdown();
  });

  it('⑨ 停机窗 inject 回执 = 停靠保持（修前红——03 §10.7 五役定形补笔）：dismantle 态广播唤醒 → inject 收执 → paused-retain 非 failed', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const afford = mutableAfford(false); // 起跑前日池尽 → 停靠
    const factory = createIssueSessionFactory({
      stack,
      canAfford: afford.canAfford,
      warn: () => {},
      pollMs: 5,
    });

    faux.setResponses([() => messageOf('不应起跑')]); // 若误起跑即露馅（inject 不起 run 零消费）
    const { sessionId, outcome } = await factory.startHeadless({
      cwd: ws,
      prompt: '停机窗任务',
      budgetMessages: 50,
      tools: [],
    });
    expect(await isPending(outcome)).toBe(true); // 停靠成立（outcome 悬置）
    const driver = stack.manager.driverOf(sessionId)!; // 停靠态捕获（dismantle 后 driverOf 缺席——断言面持引用）

    // 停机 closer drain 窗复刻（装配根注册序即 drain 序的真窗）：conversation-
    // manager closer 已跑（全量 dismantle——driver 停摆）而 budget-broadcast
    // closer 未跑（工厂私有广播件仍活）——正是两 closer 之间的窗
    stack.manager.dispose();
    expect(driver.dismantled).toBe(true);

    // 窗内电平翻真：广播 watcher 唤醒停靠项 → runRound 起跑 → dismantle 态
    // driver.submit 经 inject 通道（04 §4 三通道路由单源）返 {status:'injected'}
    // ——只落 durable 账不起 run
    afford.set(true);
    const result = await settle(outcome);
    // 修前红锚：此形落 failed『提交未起跑（injected——理论不达防御位…）』
    // → issue 服务 failed 收口 = worktree clean + 失败回执——丢失停靠保留
    // 语义；修后 = paused-retain（worktree 与授予保留、orphanScan 再入——
    // issue 服务 paused 分现成承载）
    expect(result.status).toBe('paused');
    expect(result.status === 'paused' && result.reason).toContain('停靠保留');
    // 唤醒输入非丢失（规范笔「随下次启动带入」）：inject 通道 durable 落账
    // user/message（source 'budget-extended'——下次启动 timeline 重播种带入）
    const injected = driver.session
      .events()
      .find((e) => (e.data as { source?: string } | undefined)?.source === 'budget-extended');
    expect(injected?.type).toBe('user/message');
    factory.dispose();
    await rt.shutdown();
  });
});
