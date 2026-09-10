/**
 * host/subagent-factory 测试——in-process 真工厂（批 19c-1）。
 *
 * 真盘真库（临时目录 + 真实 Persistence）+ faux provider 走真实 streamFn 路径
 * （mock 只停在模型层）。钉死：整形律（bash 恒弃 / fs 四恒留 / 白名单滤余）、
 * 深度登记表生命周期、one-shot 全环（origin 'delegation' durable 行 + 结果
 * 映射 + 输出尾扫 + 子工具面整形）、错误映射（errorMessage → diagnostic）、
 * 审批升父面桥（one-shot 直落父面 / background 先发挂起通知）、stopRequested
 * 协作停止桥（轮询 → abort → aborted 收场）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { AgentTool, ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';
import type { SessionEnvelope, UiBackend } from '../channels/index.js';
import { fauxProvider } from '../llm/index.js';

import type { AgentMessage } from '../contracts/index.js';
import { createConversationStack } from './conversation-stack.js';
import { createHostRuntime } from './runtime.js';
import type { HostRuntime } from './runtime.js';
import {
  createDelegationSessionTracker,
  createInProcessSubagentProvider,
  shapeDerivedTools,
} from './subagent-factory.js';

/* ---------------- 测试基建（conversation-stack.test.ts 同款形） ---------------- */

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** 组装指定终态的 assistant 消息（faux 响应脚本用——pi-ai 面形状） */
function messageOf(stopReason: 'stop' | 'error' | 'aborted'): PiAssistantMessage {
  return {
    role: 'assistant',
    content: stopReason === 'stop' ? [{ type: 'text', text: 'ok' }] : [],
    usage: NO_USAGE,
    stopReason,
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

/** 审批应答后端（记录路由 sessionId + 请求——恒答配置值） */
class RoutingApprovalBackend implements UiBackend<AgentMessage> {
  readonly id = 'approver';
  readonly capabilities = {
    notify: true,
    confirm: false,
    select: false,
    input: false,
    approval: true,
    setStatus: true,
    setWidget: false,
  };
  readonly asks: Array<{ sessionId: string; request: ApprovalAskRequest }> = [];
  constructor(private readonly answer: ApprovalAskAnswer) {}
  hasAudience(): boolean {
    return true;
  }
  notify(): void {}
  onEnvelope(_env: SessionEnvelope): void {}
  onRepaint(): void {}
  async askApproval(sessionId: string, request: ApprovalAskRequest): Promise<ApprovalAskAnswer> {
    this.asks.push({ sessionId, request });
    return this.answer;
  }
}

/** 临时目录族 */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 新数据目录 + 真运行时速记 */
function rigRuntime(): { dir: string; rt: HostRuntime } {
  const dir = mkdtempSync(join(tmpdir(), 'subagent-factory-data-'));
  dirs.push(dir);
  const rt = createHostRuntime({ dataDir: dir });
  return { dir, rt };
}

/** 新工作区目录（非 git——canonical 回退字面 cwd） */
function rigWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'subagent-factory-ws-'));
  dirs.push(ws);
  return ws;
}

/** faux provider + 栈组装速记（工作区锚定隔离 ws） */
function rigStack(rt: HostRuntime, ws: string) {
  const faux = fauxProvider({ provider: 'faux-sub', models: [{ id: 'm1' }] });
  const stack = createConversationStack({
    runtime: rt,
    providers: [faux.provider],
    model: 'faux-sub/m1',
    env: {},
    workspace: () => ws,
  });
  return { faux, stack };
}

/** 最小工具形（整形律单测用——名位唯一消费面） */
const toolOf = (name: string): AgentTool => ({ name }) as AgentTool;

/* ---------------- 整形律（纯函数） ---------------- */

describe('shapeDerivedTools 派生面整形律（批 19c-1 工厂侧执法）', () => {
  const surface = () => ['read', 'find', 'bash', 'grep', 'todo', 'write', 'edit', 'ls'].map(toolOf);

  it('bash 恒弃（永不升格总则——白名单含 bash 亦弃）', () => {
    const shaped = shapeDerivedTools(['find', 'bash'])(surface());
    expect(shaped.map((t) => t.name)).not.toContain('bash');
  });

  it('fs 四名恒留（子自建结构性——白名单不含亦在）', () => {
    const shaped = shapeDerivedTools([])(surface());
    expect(shaped.map((t) => t.name)).toEqual(['read', 'write', 'edit', 'ls']);
  });

  it('白名单滤余（保注册序）+ 缺省全留（透传形）', () => {
    expect(shapeDerivedTools(['find'])(surface()).map((t) => t.name)).toEqual(['read', 'find', 'write', 'edit', 'ls']);
    expect(shapeDerivedTools(undefined)(surface()).map((t) => t.name)).toEqual([
      'read',
      'find',
      'grep',
      'todo',
      'write',
      'edit',
      'ls',
    ]);
  });
});

/* ---------------- 深度登记表 ---------------- */

describe('createDelegationSessionTracker（执行时语境真源）', () => {
  it('record / depthOf / release（终态释放防无界增长）', () => {
    const tracker = createDelegationSessionTracker();
    expect(tracker.depthOf('s-1')).toBeUndefined(); // 未登记 = 根会话兜底位（工具侧 ?? 1）
    tracker.record('s-1', 2);
    expect(tracker.depthOf('s-1')).toBe(2);
    tracker.release('s-1');
    expect(tracker.depthOf('s-1')).toBeUndefined();
  });
});

/* ---------------- in-process 真工厂（真盘全环） ---------------- */

describe('createInProcessSubagentProvider（批 19c-1——真工厂全环）', () => {
  it('one-shot 全环：origin delegation durable 行 + 结果映射 + 输出尾扫 + 子工具面整形', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({ stack, tracker, warn: () => {} });
    const parent = stack.openStartupSession(ws);

    faux.setResponses([() => messageOf('stop')]);
    // 白名单 ['find']：子实面 = fs 四恒留 + find（bash/grep/todo 滤除——裸栈
    // 无 bash，滤除断言走 grep/todo 位）
    const result = await provider.run({
      prompt: '探索',
      tools: ['find'],
      parentSessionId: parent.sessionId,
      depth: 1,
      name: '探索员',
    });
    expect(result.stopReason).toBe('stop');
    expect(result.output).toBe('ok'); // 尾扫末条 assistant text 块
    expect(result.diagnostic).toBeUndefined();

    // 子会话 durable 行（origin 'delegation' + title = 诊断名）
    await rt.persistence.flush();
    const rows = stack.manager.list({});
    const child = rows.find((row) => row.origin === 'delegation');
    expect(child).toBeDefined();
    expect(child!.title).toBe('探索员');
    // 子工具面快照 = 整形后实面（孙代委派以此为基准面）
    expect(stack.driverOf(child!.id)?.toolNames).toEqual(['read', 'write', 'edit', 'ls', 'find']);
    // 终态释放（finally teardown）
    expect(tracker.depthOf(child!.id)).toBeUndefined();
    await rt.shutdown();
  });

  it('深度登记：在飞期 depthOf = 请求深度（孙代语境解析真源）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({ stack, tracker, warn: () => {} });
    const parent = stack.openStartupSession(ws);

    // 挂起响应（手工 resolve——在飞窗内探深度登记）
    let release!: (message: PiAssistantMessage) => void;
    const pending = new Promise<PiAssistantMessage>((resolve) => {
      release = resolve;
    });
    faux.setResponses([() => pending]);
    const runP = provider.run({ prompt: '挂着', parentSessionId: parent.sessionId, depth: 2 });
    await new Promise((resolve) => setImmediate(resolve)); // 微任务排空——让 submit 真起跑
    await rt.persistence.flush();
    const child = stack.manager.list({}).find((row) => row.origin === 'delegation');
    expect(child).toBeDefined();
    expect(tracker.depthOf(child!.id)).toBe(2); // 在飞期 = 子栈深度位
    release(messageOf('stop'));
    expect((await runP).stopReason).toBe('stop');
    expect(tracker.depthOf(child!.id)).toBeUndefined(); // 终态释放
    await rt.shutdown();
  });

  it('错误映射：errorMessage → diagnostic + stopReason error（黑盒不重试）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({ stack, tracker, warn: () => {} });
    const parent = stack.openStartupSession(ws);

    faux.setResponses([
      () =>
        ({
          role: 'assistant',
          content: [],
          usage: NO_USAGE,
          stopReason: 'error',
          errorMessage: '模型炸了',
          timestamp: 1,
        }) as unknown as PiAssistantMessage,
    ]);
    const result = await provider.run({ prompt: '会炸的', parentSessionId: parent.sessionId, depth: 1 });
    expect(result.stopReason).toBe('error');
    expect(result.diagnostic).toBe('模型炸了');
    await rt.shutdown();
  });

  it('审批升父面（one-shot）：子 write 审批落父会话呈现面（backend 见父 sessionId）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const backend = new RoutingApprovalBackend('approve');
    stack.channels.addBackend(backend);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({ stack, tracker, warn: () => {} });
    const parent = stack.openStartupSession(ws);

    faux.setResponses([
      () => toolCallOf('t-cw', 'write', { path: 'child-note.txt', content: 'x' }),
      () => messageOf('stop'),
    ]);
    const result = await provider.run({ prompt: '写文件', parentSessionId: parent.sessionId, depth: 1 });
    expect(result.stopReason).toBe('stop');
    // 审批真落父面：恰一问 + 路由位 = 父 sessionId（委派边界①执法）
    expect(backend.asks).toHaveLength(1);
    expect(backend.asks[0]!.sessionId).toBe(parent.sessionId);
    await rt.shutdown();
  });

  it('审批升父面（background 形）：先发挂起通知（approvalId 在场）再落父面', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const backend = new RoutingApprovalBackend('approve');
    stack.channels.addBackend(backend);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({ stack, tracker, warn: () => {} });
    const parent = stack.openStartupSession(ws);

    const pending: Array<{ approvalId: string; toolName: string }> = [];
    faux.setResponses([
      () => toolCallOf('t-bw', 'write', { path: 'bg-note.txt', content: 'y' }),
      () => messageOf('stop'),
    ]);
    const result = await provider.run({
      prompt: '后台写',
      parentSessionId: parent.sessionId,
      depth: 1,
      background: true,
      notifyApproval: async (info) => {
        pending.push({ approvalId: info.approvalId, toolName: info.toolName });
      },
    });
    expect(result.stopReason).toBe('stop');
    // 挂起通知先落（恰一条——approvalId 由 safety 审批服务织入后在场）
    expect(pending).toHaveLength(1);
    expect(pending[0]!.approvalId).toBeTruthy();
    expect(pending[0]!.toolName).toBe('write');
    // 审批本体仍落父面
    expect(backend.asks).toHaveLength(1);
    expect(backend.asks[0]!.sessionId).toBe(parent.sessionId);
    await rt.shutdown();
  });

  it('stopRequested 协作停止桥：轮询真 → abort 子 run → aborted 收场', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({ stack, tracker, warn: () => {} });
    const parent = stack.openStartupSession(ws);

    // 挂起流：honor signal——abort 时以 aborted 终态消息收口
    faux.setResponses([
      (_ctx, opts) =>
        new Promise((resolve) => {
          const signal = (opts as { signal?: AbortSignal } | undefined)?.signal;
          if (signal === undefined || signal.aborted) {
            resolve(messageOf(signal?.aborted ? 'aborted' : 'stop'));
            return;
          }
          signal.addEventListener('abort', () => resolve(messageOf('aborted')), { once: true });
        }),
    ]);
    const result = await provider.run({
      prompt: '长活',
      parentSessionId: parent.sessionId,
      depth: 1,
      stopRequested: () => true, // 立即停——首拍轮询（500ms）即 abort
    });
    expect(result.stopReason).toBe('aborted');
    await rt.shutdown();
  });

  it('reserve 线起跑前执法（批 H——04 §5 90% 线）：已越线不起跑 + aborted 诚实回执 + 零会话', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({
      stack,
      tracker,
      warn: () => {},
      reserveBreached: () => true, // 起跑前已越线（总预算 ≥ 90%）
    });
    const parent = stack.openStartupSession(ws);

    const result = await provider.run({ prompt: '不跑了', parentSessionId: parent.sessionId, depth: 1 });
    expect(result.stopReason).toBe('aborted');
    expect(result.diagnostic).toContain('90% reserve 线');
    // 零会话零请求——余量留给主循环写终态（不建子会话不耗预算）
    expect(faux.state.callCount).toBe(0);
    await rt.persistence.flush();
    expect(stack.manager.list({}).find((row) => row.origin === 'delegation')).toBeUndefined();
    await rt.shutdown();
  });

  it('reserve 线在飞期执法（批 H）：越线翻位 → 轮询 abort → aborted + diagnostic 归因预算', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    let breached = false;
    const provider = createInProcessSubagentProvider({
      stack,
      tracker,
      warn: () => {},
      reserveBreached: () => breached,
    });
    const parent = stack.openStartupSession(ws);

    // 挂起流（honor signal——abort 时 aborted 终态收口；stopRequested 缺席，
    // 走 reserve 轮询腿）：翻位在起跑后——首拍轮询（500ms）触发 abort
    faux.setResponses([
      (_ctx, opts) =>
        new Promise((resolve) => {
          const signal = (opts as { signal?: AbortSignal } | undefined)?.signal;
          if (signal === undefined || signal.aborted) {
            resolve(messageOf(signal?.aborted ? 'aborted' : 'stop'));
            return;
          }
          signal.addEventListener('abort', () => resolve(messageOf('aborted')), { once: true });
          setImmediate(() => {
            breached = true; // 起跑后越线（模拟总预算爬过 90% 线）
          });
        }),
    ]);
    const result = await provider.run({ prompt: '跑到线', parentSessionId: parent.sessionId, depth: 1 });
    expect(result.stopReason).toBe('aborted');
    // diagnostic 归因预算（reserve 触发的 abort——非泛 aborted 回执）
    expect(result.diagnostic).toContain('90% reserve 线');
    await rt.shutdown();
  });

  it('reserve 判定缺席 = 不执法（缺省形零破口——预警软着陆层另走 driver 注入位）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({ stack, tracker, warn: () => {} });
    const parent = stack.openStartupSession(ws);

    faux.setResponses([() => messageOf('stop')]);
    const result = await provider.run({ prompt: '照常跑', parentSessionId: parent.sessionId, depth: 1 });
    expect(result.stopReason).toBe('stop'); // 无 reserve 判定面即无强停腿
    await rt.shutdown();
  });
});
