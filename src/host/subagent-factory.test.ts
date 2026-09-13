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
import type { Skill } from '../skills/index.js';
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

    // 白名单 ['find']：子实面 = fs 四恒留 + find（bash/grep/todo 滤除——裸栈
    // 无 bash，滤除断言走 grep/todo 位）。工具面快照在飞窗内捕获（run 终态
    // manager.retire 摘登记——05 §7 retire 律；toolNames 纯内存 create 期
    // 整形，终态后登记表不可观测）
    let childToolNames: readonly string[] | undefined;
    faux.setResponses([
      () => {
        const live = stack.manager.listActive().find((s) => s.origin === 'delegation');
        childToolNames = stack.manager.driverOf(live?.sessionId ?? '')?.toolNames;
        return messageOf('stop');
      },
    ]);
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
    // 子工具面快照 = 整形后实面（孙代委派以此为基准面——在飞窗捕获值）
    expect(childToolNames).toEqual(['read', 'write', 'edit', 'ls', 'find']);
    // 终态释放（finally teardown：tracker release + manager.retire 摘登记）
    expect(tracker.depthOf(child!.id)).toBeUndefined();
    expect(stack.manager.isOpen(child!.id)).toBe(false);
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

  it('机器账铸造（RP4）：one-shot 单轮——structured 六位/usage 同值双填/jobName 缺席', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({ stack, tracker, warn: () => {} });
    const parent = stack.openStartupSession(ws);

    faux.setResponses([() => messageOf('stop')]);
    const result = await provider.run({
      prompt: '记账',
      parentSessionId: parent.sessionId,
      depth: 1,
      name: '会计',
    });
    expect(result.stopReason).toBe('stop');
    // structured = 宿主机器账 v1 形（childSessionId + 计数 + usage 两桶 + stopReason）
    const structured = result.structured as {
      childSessionId?: unknown;
      jobName?: unknown;
      durationMs?: unknown;
      turnCount?: unknown;
      messageCount?: unknown;
      usage?: unknown;
      stopReason?: unknown;
    };
    expect(typeof structured.childSessionId).toBe('string');
    expect(structured.childSessionId).not.toBe('');
    expect('jobName' in structured).toBe(false); // one-shot 无 Job 身份——缺席
    expect(structured.durationMs).toBeGreaterThanOrEqual(0);
    expect(structured.turnCount).toBe(1); // 单轮一 turn/start
    expect(structured.messageCount).toBe(2); // user/message + assistant/message
    expect(structured.stopReason).toBe('stop');
    // usage 同值双填：structured.usage = 末条 assistant 两桶投影、顶层 usage =
    // 同源完整 Usage 透传（数值不硬编——真源是驱动运行期计量〔v 批镜像律〕，非 faux 消息面）
    expect(result.usage).toBeDefined();
    expect(structured.usage).toEqual({ input: result.usage!.input, output: result.usage!.output });
    await rt.shutdown();
  });

  it('机器账铸造（RP4）：background 形 jobName 在场（request.name 同源）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({ stack, tracker, warn: () => {} });
    const parent = stack.openStartupSession(ws);

    faux.setResponses([() => messageOf('stop')]);
    const result = await provider.run({
      prompt: '后台记账',
      parentSessionId: parent.sessionId,
      depth: 1,
      name: '夜班',
      background: true,
    });
    expect(result.stopReason).toBe('stop');
    expect((result.structured as { jobName?: unknown }).jobName).toBe('夜班'); // background 且 name 在场
    await rt.shutdown();
  });

  it('pre-spawn 拒径不铸账：reserve 线拒的回执无 structured（无会话无可归因）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { stack } = rigStack(rt, ws); // 不起跑——faux 零消费不取
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({
      stack,
      tracker,
      warn: () => {},
      reserveBreached: () => true,
    });
    const parent = stack.openStartupSession(ws);

    const result = await provider.run({ prompt: '不起跑', parentSessionId: parent.sessionId, depth: 1 });
    expect(result.stopReason).toBe('aborted');
    expect(result.structured).toBeUndefined(); // 未建会话——无 childSessionId 可铸（已起跑/未起跑分界）
    expect(result.usage).toBeUndefined();
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

/* ---------------- skills 键 spawn 永久注入（⑤ 批 06 §11.6） ---------------- */

describe('createInProcessSubagentProvider skills 键注入与执法', () => {
  /** 技能桩（工厂注入用——纯内存 resolve） */
  const skillOf = (name: string, content: string): Skill => ({
    name,
    description: `${name} 描述`,
    filePath: `/w/.agents/skills/${name}/SKILL.md`,
    baseDir: `/w/.agents/skills/${name}`,
    providerId: 'project',
    content,
    disableModelInvocation: false,
    sections: [],
  });

  /** 捕获型响应（F9 锁锚——外发 LLM 请求面 systemPrompt 非信封快照） */
  it('全命中注入：具名块拼入子 systemPrompt 尾（faux 外发面捕获）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({
      stack,
      tracker,
      warn: () => {},
      resolveSkill: (name) =>
        name === 'code-review'
          ? skillOf('code-review', '评审规则甲。')
          : name === 'commit-style'
            ? skillOf('commit-style', '提交风格乙。')
            : undefined,
    });
    const parent = stack.openStartupSession(ws);

    let outbound: string | undefined;
    faux.setResponses([
      (context) => {
        outbound = context.systemPrompt;
        return messageOf('stop');
      },
    ]);
    const result = await provider.run({
      prompt: '干活',
      systemPrompt: '你是守门员。',
      skills: ['code-review', 'commit-style'],
      parentSessionId: parent.sessionId,
      depth: 1,
    });
    expect(result.stopReason).toBe('stop');
    // 注入 = def systemPrompt 在前 + 具名块按引用序拼尾（与清单渐进披露并存）
    expect(outbound).toContain('你是守门员。');
    expect(outbound).toContain('<skill name="code-review"');
    expect(outbound).toContain('评审规则甲。');
    expect(outbound).toContain('<skill name="commit-style"');
    expect(outbound).toContain('提交风格乙。');
    expect(outbound!.indexOf('你是守门员。')).toBeLessThan(outbound!.indexOf('<skill name="code-review"'));
    expect(outbound!.indexOf('<skill name="code-review"')).toBeLessThan(
      outbound!.indexOf('<skill name="commit-style"'),
    );
    await rt.shutdown();
  });

  it('systemPrompt 缺席 = 空串起拼（注入不依赖其在场）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({
      stack,
      tracker,
      warn: () => {},
      resolveSkill: (name) => (name === 'solo' ? skillOf('solo', '独技正文。') : undefined),
    });
    const parent = stack.openStartupSession(ws);

    let outbound: string | undefined;
    faux.setResponses([
      (context) => {
        outbound = context.systemPrompt;
        return messageOf('stop');
      },
    ]);
    const result = await provider.run({
      prompt: '干活',
      skills: ['solo'],
      parentSessionId: parent.sessionId,
      depth: 1,
    });
    expect(result.stopReason).toBe('stop');
    expect(outbound).toContain('<skill name="solo"');
    expect(outbound).toContain('独技正文。');
    await rt.shutdown();
  });

  it('任一缺席 = 拒 spawn fail-ask：不建会话不耗预算 + 诊断列缺席名', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({
      stack,
      tracker,
      warn: () => {},
      resolveSkill: (name) => (name === 'present' ? skillOf('present', '在册。') : undefined),
    });
    const parent = stack.openStartupSession(ws);

    let consumed = 0;
    faux.setResponses([
      () => {
        consumed += 1;
        return messageOf('stop');
      },
    ]);
    const result = await provider.run({
      prompt: '干活',
      skills: ['present', 'ghost-skill'],
      parentSessionId: parent.sessionId,
      depth: 1,
    });
    expect(result.stopReason).toBe('aborted');
    expect(result.output).toBe('');
    expect(result.diagnostic).toContain('ghost-skill');
    expect(result.diagnostic).toContain('skills 键 fail-ask');
    expect(consumed).toBe(0); // 不耗预算——LLM 零调用
    await rt.persistence.flush();
    const delegation = stack.manager.list({}).filter((row) => row.origin === 'delegation');
    expect(delegation).toHaveLength(0); // 不建会话
    await rt.shutdown();
  });

  it('resolveSkill 缺席（--no-plugins 形）= fail-closed 拒', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({ stack, tracker, warn: () => {} });
    const parent = stack.openStartupSession(ws);

    const result = await provider.run({
      prompt: '干活',
      skills: ['any-skill'],
      parentSessionId: parent.sessionId,
      depth: 1,
    });
    expect(result.stopReason).toBe('aborted');
    expect(result.diagnostic).toContain('技能注册表不可达');
    await rt.shutdown();
  });

  it('形状违例工厂侧复验拒（直呼 request 绕过解析层的兜底执法）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const provider = createInProcessSubagentProvider({
      stack,
      tracker,
      warn: () => {},
      resolveSkill: (name) => (name === 'ok-skill' ? skillOf('ok-skill', 'x') : undefined),
    });
    const parent = stack.openStartupSession(ws);

    // 词法违例（大写）
    const badLex = await provider.run({
      prompt: '干活',
      skills: ['Bad_Name'],
      parentSessionId: parent.sessionId,
      depth: 1,
    });
    expect(badLex.stopReason).toBe('aborted');
    expect(badLex.diagnostic).toContain('形状违例');
    // 超帽 9 项
    const nine = Array.from({ length: 9 }, (_, i) => `skill-${i}`);
    const badCap = await provider.run({
      prompt: '干活',
      skills: nine,
      parentSessionId: parent.sessionId,
      depth: 1,
    });
    expect(badCap.stopReason).toBe('aborted');
    expect(badCap.diagnostic).toContain('形状违例');
    await rt.shutdown();
  });

  it('disable-model-invocation 隐藏件不受限（作者侧声明面——清单滤除律只限模型装载面）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const { faux, stack } = rigStack(rt, ws);
    const tracker = createDelegationSessionTracker();
    const hidden: Skill = { ...skillOf('hidden-gem', '隐藏技正文。'), disableModelInvocation: true };
    const provider = createInProcessSubagentProvider({
      stack,
      tracker,
      warn: () => {},
      resolveSkill: (name) => (name === 'hidden-gem' ? hidden : undefined),
    });
    const parent = stack.openStartupSession(ws);

    let outbound: string | undefined;
    faux.setResponses([
      (context) => {
        outbound = context.systemPrompt;
        return messageOf('stop');
      },
    ]);
    const result = await provider.run({
      prompt: '干活',
      skills: ['hidden-gem'],
      parentSessionId: parent.sessionId,
      depth: 1,
    });
    expect(result.stopReason).toBe('stop');
    expect(outbound).toContain('<skill name="hidden-gem"');
    await rt.shutdown();
  });
});
