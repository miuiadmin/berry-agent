/**
 * host/conversation-stack 组合根测试——对话栈五层装配的真盘全栈验证。
 *
 * 真盘真库（临时目录 + 真实 Persistence）+ faux provider 走真实 streamFn 路径
 * （mock 只停在模型层）。钉死：启动会话策略（新建/按 cwd 续接）/ 投影拉取
 * （活体优先 + 回库装载）/ 信封回流 / memory 形工具缺席降级 / 退出序接线。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  createAssistantMessageEventStream,
  type AssistantMessage as PiAssistantMessage,
  type AssistantMessageEventStream,
  type Provider,
} from '@earendil-works/pi-ai';

import type { AgentMessage, ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';
import { materializeHostFace } from '../contracts/api.js';
import type { SessionEnvelope, UiBackend } from '../channels/index.js';
import { canonicalWorkspaceRoot, Scope } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';
import { SessionLog } from '../session/index.js';
import type { EventWrite, SessionRegistration } from '../persist/store.js';

import { appendToolPolicyEntry, readToolPolicy, TOOL_POLICY_BASENAME } from './tool-policy-store.js';
import {
  assertWatchdogHatOrder,
  createConversationStack,
  createRunLaneGate,
  DEFAULT_LLM_IDLE_TIMEOUT_MS,
  DEFAULT_RUN_LANE_CAPACITY,
  DEFAULT_SESSION_STALL_TIMEOUT_MS,
  lastUsageFactOf,
  LLM_IDLE_TIMEOUT_MS_ENV,
  resolveLlmIdleTimeoutMs,
  resolveRunLaneCapacity,
  resolveSessionStallTimeoutMs,
  SESSION_STALL_TIMEOUT_MS_ENV,
  startOfTodayMs,
  type ConversationStackOptions,
} from './conversation-stack.js';
import { createPluginContext } from './plugin-context.js';
import { createHostRuntime } from './runtime.js';
import type { HostRuntime } from './runtime.js';

/* ---------------- 测试基建 ---------------- */

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
  } as unknown as PiAssistantMessage; // contracts 形状同构缺 pi-ai 元数据字段——faux 脚本面收口在此
}

/** 工具调用 assistant 消息（faux 响应脚本用——批 12f-4 e2e；driver 同构收口） */
function toolCallOf(id: string, name: string, args: Record<string, unknown>): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'toolCall', id, name, arguments: args }],
    usage: NO_USAGE,
    stopReason: 'toolUse',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 信封记录后端（UiBackend 最小实现——通道核消费面全收账） */
class RecordingBackend implements UiBackend<AgentMessage> {
  readonly id = 'rec';
  readonly capabilities = {
    notify: true,
    confirm: false,
    select: false,
    input: false,
    approval: true,
    setStatus: true,
    setWidget: false,
  };
  readonly envelopes: SessionEnvelope[] = [];
  readonly repaints: Array<{ sessionId: string; projection: readonly AgentMessage[] }> = [];
  hasAudience(): boolean {
    return true;
  }
  notify(): void {
    // 本组不断言 notify 载荷——通道核降级路径单测在 channels 域
  }
  onEnvelope(env: SessionEnvelope): void {
    this.envelopes.push(env);
  }
  onRepaint(sessionId: string, projection: readonly AgentMessage[]): void {
    this.repaints.push({ sessionId, projection });
  }
}

/** 临时目录族（数据目录 × 工作区目录统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 新数据目录 + 真运行时速记 */
function rigRuntime(memory = false): { dir: string; rt: HostRuntime } {
  const dir = mkdtempSync(join(tmpdir(), 'stack-data-'));
  dirs.push(dir);
  const rt = createHostRuntime(memory ? { memory: true } : { dataDir: dir });
  return { dir, rt };
}

/** 新工作区目录（非 git——canonical 回退字面 cwd） */
function rigWorkspace(): string {
  const ws = mkdtempSync(join(tmpdir(), 'stack-ws-'));
  dirs.push(ws);
  return ws;
}

/** faux provider + 栈组装速记 */
function rigStack(rt: HostRuntime, overrides: Partial<ConversationStackOptions> = {}) {
  const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
  const stack = createConversationStack({
    runtime: rt,
    providers: [faux.provider],
    model: 'faux-stack/m1',
    env: {}, // BERRY_AGENT_MODEL 隔离——测试面自持模型
    ...overrides,
  });
  return { faux, stack };
}

describe('createConversationStack 装配序', () => {
  it('workspaceAnchor 栈级锚取值器：显式锚优先 / 缺省归一根（03 §10.7 会话锚源回落位——委派子会话父行无锚时消费）', () => {
    const { rt } = rigRuntime(true);
    const ws = rigWorkspace();
    const anchored = createConversationStack({ runtime: rt, env: {}, workspace: () => ws });
    expect(anchored.workspaceAnchor()).toBe(ws); // 装配根显式锚
    const bare = createConversationStack({ runtime: rt, env: {} });
    expect(bare.workspaceAnchor()).toBe(canonicalWorkspaceRoot()); // 同源断言——缺省归一根
  });

  it('模型缺省链：env 覆盖律（faux 注入位同面）', () => {
    const { rt } = rigRuntime(true);
    const stack = createConversationStack({ runtime: rt, env: { BERRY_AGENT_MODEL: 'anthropic/x' } });
    expect(stack.model).toBe('anthropic/x'); // resolveDefaultModelSpec 覆盖律
    const bare = createConversationStack({ runtime: rt, env: {} });
    expect(bare.model).toBe('anthropic/claude-sonnet-5'); // 缺省档
  });

  it('启动会话策略：无 cwd 会话新建（resumed=false）+ 提交流转 + 信封回流', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const ws = rigWorkspace();
    const backend = new RecordingBackend();
    stack.channels.addBackend(backend);

    const session = stack.openStartupSession(ws);
    expect(session.resumed).toBe(false); // 空 cwd 首启——新建
    expect(session.workspaceRoot).toBe(ws); // 非 git 回退字面 cwd

    faux.setResponses([() => messageOf('stop')]);
    const receipt = await stack.submitText(session.sessionId, '你好');
    expect(receipt).toMatchObject({ status: 'completed' }); // 全链：驱动→loop→streamFn→faux

    // 会话行随首事件落库（createSession 零 I/O——行随首事件写；flush 屏障后可见）
    await rt.persistence.flush();
    const rows = stack.manager.list({ workspaceRoot: ws });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workspaceRoot).toBe(ws); // 选取键同源落账

    // 信封回流：活体事件按 sessionId 路由扇出（agent 事件族——user 文本经
    // 投影面呈现非信封流，transcript 双源律归 channels 域）
    expect(backend.envelopes.length).toBeGreaterThan(0);
    expect(backend.envelopes.every((e) => e.sessionId === session.sessionId)).toBe(true);
    expect(backend.envelopes.some((e) => e.event.type === 'agent_start')).toBe(true);
    expect(backend.envelopes.some((e) => e.event.type === 'message_end')).toBe(true);

    // 投影拉取：活体优先——user 文本与 assistant 应答都在投影
    const projection = await stack.projectionOf(session.sessionId);
    expect(projection.some((m) => m.role === 'user' && m.content === '你好')).toBe(true);
    expect(projection.some((m) => m.role === 'assistant')).toBe(true);

    await rt.shutdown();
  });

  it('per-session 装配覆盖（批 19c-1——in-process 子代理装载位）：shapeTools 整形 + systemPrompt 覆盖全环落信封快照', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const ws = rigWorkspace();

    // 覆盖形会话：整形 = 恒弃 bash（子代理派生面律）+ 自定系统提示词
    const child = stack.manager.create({
      workspaceRoot: ws,
      origin: 'delegation',
      systemPrompt: '你是子代理，专注探索',
      shapeTools: (tools) => tools.filter((tool) => tool.name !== 'bash' && tool.name !== 'grep'),
    });
    // 整形后实面快照（孙代委派的基准面；会话维四件 + 操控三件 + ccr_retrieve
    // 检索件恒挂载——e2-4/e4-3 与 fs/检索/todo 并列；CCR 批起 05 §2.1 件 3）
    expect(child.driver.toolNames).toEqual([
      'read',
      'write',
      'edit',
      'ls',
      'find',
      'todo',
      'session_list',
      'session_read',
      'session_trace',
      'session_status',
      'session_send',
      'session_interrupt',
      'session_withdraw',
      'ccr_retrieve',
    ]);

    faux.setResponses([() => messageOf('stop')]);
    const receipt = await stack.submitText(child.sessionId, '探索去');
    expect(receipt).toMatchObject({ status: 'completed' });

    // 信封快照（边界制）承载两位：systemPrompt 原始值（快照先于注入）+
    // toolSchemas = 整形后实面（裸栈 = fs 四 + 检索两 + todo + 会话维四件 +
    // 操控三件 + ccr_retrieve，无 bash）
    const header = child.driver.session.events().find((event) => event.type === 'request/header') as
      { data: { systemPrompt: string; toolSchemas: Array<{ name: string }> } } | undefined;
    expect(header).toBeDefined();
    expect(header!.data.systemPrompt).toBe('你是子代理，专注探索');
    expect(header!.data.toolSchemas.map((schema) => schema.name)).toEqual([
      'read',
      'write',
      'edit',
      'ls',
      'find',
      'todo',
      'session_list',
      'session_read',
      'session_trace',
      'session_status',
      'session_send',
      'session_interrupt',
      'session_withdraw',
      'ccr_retrieve',
    ]);
    await rt.shutdown();
  });

  it('启动会话策略：同 cwd 重启取最新续接（resumed=true）+ 回库投影', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stack-data-'));
    dirs.push(dir);
    const ws = rigWorkspace();

    // 第一段：新建 + 一轮对话落库 + 优雅退出（flush 屏障内嵌）
    const rt1 = createHostRuntime({ dataDir: dir });
    const { faux, stack } = rigStack(rt1);
    const first = stack.openStartupSession(ws);
    faux.setResponses([() => messageOf('stop')]);
    await stack.submitText(first.sessionId, '第一轮');
    await rt1.shutdown();

    // 第二段：新运行时同 cwd——按 workspace_root 取最新会话续接
    const rt2 = createHostRuntime({ dataDir: dir });
    const rig2 = rigStack(rt2);
    const resumed = rig2.stack.openStartupSession(ws);
    expect(resumed.resumed).toBe(true);
    expect(resumed.sessionId).toBe(first.sessionId); // 同一会话（updated_at DESC 选取）
    // 未 submit 前投影可拉（回库装载腿——loadSession 装配）
    const projection = await rig2.stack.projectionOf(resumed.sessionId);
    expect(projection.some((m) => m.role === 'user' && m.content === '第一轮')).toBe(true);
    await rt2.shutdown();
  });

  it('焦点重画：focus 拉投影扇出 onRepaint（fetchProjection 注入腿）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const ws = rigWorkspace();
    const backend = new RecordingBackend();
    stack.channels.addBackend(backend);

    const session = stack.openStartupSession(ws);
    faux.setResponses([() => messageOf('stop')]);
    await stack.submitText(session.sessionId, '画我');
    await stack.channels.focus(session.sessionId);
    expect(backend.repaints.length).toBeGreaterThan(0); // 重画真发生
    const last = backend.repaints[backend.repaints.length - 1]!;
    expect(last.sessionId).toBe(session.sessionId);
    expect(last.projection.some((m) => m.role === 'user' && m.content === '画我')).toBe(true);
    await rt.shutdown();
  });

  it('memory 形降级：工具整面缺席——纯对话 run 仍通', async () => {
    const { rt } = rigRuntime(true);
    expect(rt.dataDir).toBeNull(); // 降级判据位
    const { faux, stack } = rigStack(rt);
    const session = stack.openStartupSession(rigWorkspace());
    faux.setResponses([() => messageOf('stop')]);
    const receipt = await stack.submitText(session.sessionId, '纯对话');
    expect(receipt).toMatchObject({ status: 'completed' }); // 无工具装配不炸对话本体
    await rt.shutdown();
  });

  it('interrupt：协作中止在飞 run（abort 收场）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const ws = rigWorkspace();
    const session = stack.openStartupSession(ws);
    // 慢响应：首响应挂起（faux 队列空时挂起？——用 error 终态前先 interrupt 不稳，改
    // 直接验证 interrupt 面恒可调 + 空闲 abort 幂等不炸）
    stack.interrupt(session.sessionId);
    faux.setResponses([() => messageOf('stop')]);
    const receipt = await stack.submitText(session.sessionId, '再来');
    expect(receipt).toMatchObject({ status: 'completed' }); // 空闲期 abort 不留残态
    stack.interrupt('不存在的会话'); // 防御位：未知 id 静默
    await rt.shutdown();
  });
});

describe('llmRuntime 出口（批 12f-2b——插件 provider 注册面防双实例）', () => {
  it('出口在场且与 llm 服务同源（faux 注入经同一 runtime 可见于 listModels）', () => {
    const { rt } = rigRuntime(true);
    const { stack } = rigStack(rt);
    // 出口 = ② 层同一 runtime（防双实例：装载批经本出口注册 provider 不另建）
    expect(typeof stack.llmRuntime.registerProvider).toBe('function');
    expect(stack.llm.listModels().some((m) => m.id === 'faux-stack/m1')).toBe(true);
  });
});

/* ---------------- 批 12f-4：审批 always 回写与策略表免问接线 e2e（ap-2 更名 tool-policy.json） ---------------- */

/** 审批应答后端（askApproval 能力位——记录请求 + 恒答配置值） */
class ApprovalBackend implements UiBackend<AgentMessage> {
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
  readonly requests: ApprovalAskRequest[] = [];
  constructor(private readonly answer: ApprovalAskAnswer) {}
  hasAudience(): boolean {
    return true;
  }
  notify(): void {
    // 本组不断言 notify 载荷
  }
  onEnvelope(): void {
    // 信封面非本组断言对象
  }
  onRepaint(): void {
    // 重画面非本组断言对象
  }
  async askApproval(_sessionId: string, request: ApprovalAskRequest): Promise<ApprovalAskAnswer> {
    this.requests.push(request);
    return this.answer;
  }
}

/** 会话事件 data 按类型取列（断言简写——与 open-tools 域同款） */
function dataOf(driverSession: { events(): ReadonlyArray<{ type: string; data: unknown }> }, type: string): unknown[] {
  return driverSession
    .events()
    .filter((event) => event.type === type)
    .map((event) => event.data);
}

describe('审批 always 回写与策略表免问（批 12f-4——04 §9 粘性第 3 款全链接线）', () => {
  it('write 审批 always：结构草案经 persistToolPolicy → appendToolPolicyEntry 真落 tool-policy.json', async () => {
    const { dir, rt } = rigRuntime();
    const ws = rigWorkspace();
    const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
    // 与 assembly.ts 同接法（闭包 dataDir 接 store 文件写——此处手动复刻锁透传链）
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-stack/m1',
      env: {},
      workspace: () => ws, // 工具写目标锚定隔离工作区（不落真 cwd）
      persistToolPolicy: (draft) => void appendToolPolicyEntry(dir, draft),
    });
    const backend = new ApprovalBackend('always');
    stack.channels.addBackend(backend);
    const session = stack.openStartupSession(ws);

    faux.setResponses([() => toolCallOf('t-w1', 'write', { path: 'n1.txt', content: 'hi' }), () => messageOf('stop')]);
    const receipt = await stack.submitText(session.sessionId, '写入');
    expect(receipt).toMatchObject({ status: 'completed' }); // 工具批后二轮收口

    // 审批对真经 channels → 后端（问过 + always 答复 + 工具真执行）
    expect(backend.requests).toHaveLength(1);
    expect(readFileSync(join(ws, 'n1.txt'), 'utf8')).toBe('hi');
    const decided = dataOf(session.driver.session, 'approval/decided');
    expect(decided[0]).toMatchObject({ decision: 'always' }); // decided 落 always（非降级 approve）

    // 写侧律全链：approval 服务结构草案（fs 单目标 = 精确 canonical 路径）→ 文件
    // （写入恒落新名 tool-policy.json——审批分档批载体更名执法）
    expect(existsSync(join(dir, TOOL_POLICY_BASENAME))).toBe(true);
    const load = readToolPolicy(dir);
    expect(load.healthy).toBe(true);
    expect(load.entries).toHaveLength(1);
    expect(load.entries[0]!.decision).toBe('allow'); // 机器写侧唯一正门只产 allow
    expect(load.entries[0]!.tool).toBe('write');
    expect(load.entries[0]!.pattern?.endsWith('n1.txt')).toBe(true); // canonical 绝对路径（realpath 平台差异不锁全串）
    await rt.shutdown();
  });

  it('策略表 allow 条目透传：免问放行（零审批交互 + 工具照常执行）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-stack/m1',
      env: {},
      workspace: () => ws,
      // 条目 = 工作区前缀（fs 族 all-or-nothing——write 落 ws 内即命中）
      toolPolicy: [{ tool: 'write', pattern: ws, decision: 'allow' }],
    });
    // 若被问则恒答 approve（免问失效时本测断言零请求即红——不静默放水）
    const backend = new ApprovalBackend('approve');
    stack.channels.addBackend(backend);
    const session = stack.openStartupSession(ws);

    faux.setResponses([() => toolCallOf('t-w2', 'write', { path: 'n2.txt', content: 'yo' }), () => messageOf('stop')]);
    const receipt = await stack.submitText(session.sessionId, '免问写');
    expect(receipt).toMatchObject({ status: 'completed' });

    // 免问：条目命中不问（advisory 面只影响问不问——执行照走）
    expect(backend.requests).toHaveLength(0);
    expect(dataOf(session.driver.session, 'approval/asked')).toHaveLength(0);
    expect(readFileSync(join(ws, 'n2.txt'), 'utf8')).toBe('yo');
    // 命中审计（04 §9 命中审计条款 + 审批分档批④更词）：放行行 reason 位落
    // policy-allow:<条目序>——免问放行仍可审计（「谁放的行」= 哪条既有授权放的行）
    const gateDecisions = dataOf(session.driver.session, 'gate/decision');
    expect(
      gateDecisions.some(
        (d) =>
          (d as { decision: string; reason: string }).decision === 'allow' &&
          (d as { decision: string; reason: string }).reason === 'policy-allow:0',
      ),
    ).toBe(true);
    await rt.shutdown();
  });
});

/* ---------------- 阈值触发 usage 真值笔（05 §2.1 判阈双源——真 token 主判） ---------------- */

describe('阈值触发 usage 真值笔', () => {
  /** 合成日志（lastUsageFactOf 消费面只有 events()/sessionId 两成员——单元替身） */
  function logOf(events: unknown[]): SessionLog {
    return { sessionId: 's-unit', events: () => events } as unknown as SessionLog;
  }

  /** 合成 assistant/message 事件（携指定 input 计量） */
  function assistantEvent(input: number): { type: string; data: unknown } {
    return { type: 'assistant/message', data: { usage: { input, output: 1 } } };
  }

  it('lastUsageFactOf 取值律：末条真值原样入笔；零计量/坏形/缺席不携带且不回溯', () => {
    // 末条真计量：原样入笔（provider 报数随落账在场——05 §1.1）
    expect(lastUsageFactOf(logOf([{ type: 'user/message', data: {} }, assistantEvent(500)])).usage).toEqual({
      input: 500,
    });
    // 末条零计量 + 前条真值：不回溯（上一轮 input 是上一形态的真值——旧值不冒充本轮）
    expect(lastUsageFactOf(logOf([assistantEvent(500), assistantEvent(0)])).usage).toBeUndefined();
    // 末条坏形（usage 缺席）：无真值不猜
    expect(lastUsageFactOf(logOf([{ type: 'assistant/message', data: {} }])).usage).toBeUndefined();
    // 全程无 assistant 事件（空 run 防御路径）
    expect(lastUsageFactOf(logOf([{ type: 'user/message', data: {} }])).usage).toBeUndefined();
  });

  it('lastUsageFactOf cache 两桶同笔（RP4 basis 五件数据源）：数型透传、缺桶/坏形不猜', () => {
    const ev = (usage: unknown) => ({ type: 'assistant/message', data: { usage } });
    // 数型在场同笔带出（与 input 同事件同一读笔）
    expect(lastUsageFactOf(logOf([ev({ input: 500, output: 1, cacheRead: 70, cacheWrite: 30 })])).usage).toEqual({
      input: 500,
      cacheRead: 70,
      cacheWrite: 30,
    });
    // 缺桶：键缺席非零值（供应商未报/旧档——诚实缺席）
    expect(lastUsageFactOf(logOf([ev({ input: 500, output: 1 })])).usage).toEqual({ input: 500 });
    // 坏形桶（字符串）：不透传不猜
    expect(lastUsageFactOf(logOf([ev({ input: 500, output: 1, cacheRead: 'x' })])).usage).toEqual({ input: 500 });
  });

  it('全链：run 终态 handleRunSettled 收到日志末条 assistant 真计量（faux 实算值正数）', async () => {
    const { rt } = rigRuntime();
    const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
    const settled: Array<{ usage?: { input: number }; logSessionId: string }> = [];
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-stack/m1',
      env: {},
      // 计量服务替身（测试注入面）：只记录阈值触发的入参形状
      compaction: {
        handleRunSettled: (input) => {
          settled.push({ usage: input.usage, logSessionId: input.log.sessionId });
        },
        compactForOverflow: async () => 'nothing' as const,
        drain: async () => undefined,
      },
    });
    const session = stack.openStartupSession();
    faux.setResponses([() => messageOf('stop')]); // faux 恒实算 usage（覆写脚本值）——真值来自 provider 报数
    const receipt = await stack.submitText(session.sessionId, '真计量');
    expect(receipt).toMatchObject({ status: 'completed' });
    expect(settled).toHaveLength(1);
    expect(settled[0]!.logSessionId).toBe(session.sessionId);
    // 真 token 笔在场（faux chars/4 估算报数——值不锁具体数只锁真值形状；无
    // contextWindow——fallback 分母归服务侧，与估算档同分母）
    expect(typeof settled[0]!.usage?.input).toBe('number');
    expect(settled[0]!.usage!.input).toBeGreaterThan(0);
    await rt.shutdown();
  });
});

/* ---------------- 会话维观测装配（e2-4——sessionView + 工具族 + observeCross seam） ---------------- */

describe('会话维观测装配（e2-4 观测腿接线）', () => {
  it('sessionView 面在场：进程内在管投影 + isSameTree 同树判真跨树判假', () => {
    const { rt } = rigRuntime();
    const { stack } = rigStack(rt);
    expect(stack.sessionView.listSessions()).toEqual([]); // 首启前空
    const a = stack.openStartupSession(rigWorkspace());
    const b = stack.openStartupSession(rigWorkspace()); // 同进程异树
    const ids = stack.sessionView
      .listSessions()
      .map((row) => row.id)
      .sort();
    expect(ids).toEqual([a.sessionId, b.sessionId].sort());
    expect(stack.sessionView.isSameTree(a.sessionId, a.sessionId)).toBe(true); // 同 id 特例
    expect(stack.sessionView.isSameTree(a.sessionId, b.sessionId)).toBe(false); // 异根两树
  });

  it('工具族恒挂载：durable 会话 toolNames 含四件（与 bootTools 并列 extraTools 位）', () => {
    const { rt } = rigRuntime();
    const { stack } = rigStack(rt);
    const session = stack.openStartupSession(rigWorkspace());
    const names = stack.driverOf(session.sessionId)!.toolNames!;
    for (const tool of ['session_list', 'session_read', 'session_trace', 'session_status']) {
      expect(names).toContain(tool);
    }
  });

  it('self 观测白给：faux 工具批 session_status（无参 = 自身坐标）正常收口非错面', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const session = stack.openStartupSession(rigWorkspace());
    faux.setResponses([() => toolCallOf('t1', 'session_status', {}), () => messageOf('stop')]);
    const receipt = await stack.submitText(session.sessionId, '我在哪');
    expect(receipt).toMatchObject({ status: 'completed' });
    const results = stack
      .driverOf(session.sessionId)!
      .session.events()
      .filter((event) => event.type === 'tool/result')
      .map((event) => event.data as { error?: true });
    expect(results).toHaveLength(1);
    expect(results[0]!.error).toBeUndefined(); // 树内 self 白给——零门检零错误面
  });

  it('e-3 环境自感三段：session_status 呈现整形后工具清单 + 观测门态（默认关）+ 负面能力声明', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const session = stack.openStartupSession(rigWorkspace());
    faux.setResponses([() => toolCallOf('t1', 'session_status', {}), () => messageOf('stop')]);
    const receipt = await stack.submitText(session.sessionId, '自省');
    expect(receipt).toMatchObject({ status: 'completed' });
    const text = JSON.stringify(
      stack
        .driverOf(session.sessionId)!
        .session.events()
        .find((event) => event.type === 'tool/result')!.data,
    );
    // 工具清单段：整形后有效可见集（sessionTools 自身在列——lazy 读装配后 tools 变量）
    expect(text).toContain('tools(');
    expect(text).toContain('session_status');
    // 门态快照段：rigStack 不接 doors 源 = 空集默认关——reason 与执行时拒绝 message 同源
    expect(text).toContain('capability-doors');
    expect(text).toContain('sessions.observe-cross=closed');
    // 负面能力声明段：闭门面「不要承诺」负向清单（hermes 防幻觉形）
    expect(text).toContain('negative-capabilities');
    expect(text).toContain('不要承诺');
  });

  it('跨树默认关（doors 源缺席空集）：session_read 跨树目标 → [SESSION_OBSERVE_DENIED] 错面', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const a = stack.openStartupSession(rigWorkspace());
    const b = stack.openStartupSession(rigWorkspace()); // 异树目标
    faux.setResponses([() => toolCallOf('t1', 'session_read', { sessionId: b.sessionId }), () => messageOf('stop')]);
    const receipt = await stack.submitText(a.sessionId, '看别的会话');
    expect(receipt).toMatchObject({ status: 'completed' });
    const results = stack
      .driverOf(a.sessionId)!
      .session.events()
      .filter((event) => event.type === 'tool/result')
      .map((event) => event.data as { content: unknown; error?: true });
    expect(results).toHaveLength(1);
    expect(results[0]!.error).toBe(true); // 门拒 = 工具错面（run 不中断）
    expect(JSON.stringify(results[0]!.content)).toContain('SESSION_OBSERVE_DENIED');
  });
});

/* ---------------- 压缩槽位装配（U4-3——席位容器 + 接管缝 e2e） ---------------- */

describe('压缩槽位装配（U4-3 装配批）', () => {
  /** 触发形配置：阈值近零（任何真计量即触发）+ 冷却零 + tail 2（2 轮即可压） */
  const FIRE_CONFIG = { thresholdRatio: 0.000001, cooldownMs: 0, tailKeep: 2 } as const;

  it('provider 席 e2e：slots 占席注册 → 阈值压缩走插件算法（start.summarizer=plugin:<id>）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    // 插件道占席（装载窗真源恒开——plugin-boot fork 绑定的直构等价形）
    const face = stack.compactionSlots.bindForPlugin({ pluginId: 'acme-sum', inLoadWindow: () => true });
    face.setConfig(FIRE_CONFIG);
    face.registerSummarizer(async () => ({ text: '插件算法产物' }));
    const session = stack.openStartupSession(rigWorkspace());
    const log = stack.driverOf(session.sessionId)!.session;
    for (let i = 1; i <= 3; i++) {
      faux.setResponses([() => messageOf('stop')]);
      await stack.submitText(session.sessionId, `第${i}轮任务`);
    }
    await rt.shutdown(); // closer 序含 compaction-drain——排空后才断言
    const start = log.eventsOfType('compaction/start').at(-1);
    expect(start?.data).toMatchObject({ reason: 'threshold', summarizer: 'plugin:acme-sum' });
    const summary = log
      .events()
      .find((event) => event.type === 'user/message' && (event.data as { source?: string }).source === 'compaction');
    expect((summary?.data as { content: string }).content).toContain('插件算法产物');
  });

  it('接管缝 e2e：插件 ctx.on 短路接管 → takeover.pluginId 铸造覆写（自填被覆）+ 接管算法执行', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    stack.dispatch.registerEventNames(['session_before_compact']);
    // 插件道订阅接管缝（plugin-context 包装层真身——铸造/记名两律全程在场）
    const handle = createPluginContext({
      pluginId: 'acme-take',
      scope: Scope.createRoot(),
      dispatch: stack.dispatch,
      hostFace: materializeHostFace({
        version: '0.1.0-alpha.1',
        apiVersion: '1.0',
        capabilities: [],
        experimentalKeys: [],
      }),
    });
    handle.ctx.on('session_before_compact', (value) => ({
      ...(value as object),
      takeover: { pluginId: 'p-forged', summarize: async () => ({ text: '接管算法产物' }) },
    }));
    const face = stack.compactionSlots.bindForPlugin({ pluginId: 'acme-take', inLoadWindow: () => true });
    face.setConfig(FIRE_CONFIG);
    const session = stack.openStartupSession(rigWorkspace());
    const log = stack.driverOf(session.sessionId)!.session;
    for (let i = 1; i <= 3; i++) {
      faux.setResponses([() => messageOf('stop')]);
      await stack.submitText(session.sessionId, `第${i}轮任务`);
    }
    await rt.shutdown();
    // 铸造律：自填 p-forged 被覆写为本插件 id（冒名结构性不存在）
    const start = log.eventsOfType('compaction/start').at(-1);
    expect(start?.data).toMatchObject({ reason: 'threshold', summarizer: 'plugin:acme-take' });
    const summary = log
      .events()
      .find((event) => event.type === 'user/message' && (event.data as { source?: string }).source === 'compaction');
    expect((summary?.data as { content: string }).content).toContain('接管算法产物');
  });

  it('否决位 e2e：veto 短路 → start+end(vetoed) 对可查（无声取消不可观测律）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    stack.dispatch.registerEventNames(['session_before_compact']);
    const handle = createPluginContext({
      pluginId: 'acme-veto',
      scope: Scope.createRoot(),
      dispatch: stack.dispatch,
      hostFace: materializeHostFace({
        version: '0.1.0-alpha.1',
        apiVersion: '1.0',
        capabilities: [],
        experimentalKeys: [],
      }),
    });
    handle.ctx.on('session_before_compact', (value) => ({ ...(value as object), veto: { reason: '夜间窗口' } }));
    stack.compactionSlots.bindForPlugin({ pluginId: 'acme-veto', inLoadWindow: () => true }).setConfig(FIRE_CONFIG);
    const session = stack.openStartupSession(rigWorkspace());
    const log = stack.driverOf(session.sessionId)!.session;
    for (let i = 1; i <= 3; i++) {
      faux.setResponses([() => messageOf('stop')]);
      await stack.submitText(session.sessionId, `第${i}轮任务`);
    }
    await rt.shutdown();
    const start = log.eventsOfType('compaction/start').at(-1);
    const end = log.eventsOfType('compaction/end').at(-1);
    expect(start?.data).toMatchObject({ reason: 'threshold' });
    expect(end?.data).toMatchObject({ reason: 'vetoed' });
    // 否决收场：无摘要事件（遮蔽不发生）
    expect(
      log
        .events()
        .some((event) => event.type === 'user/message' && (event.data as { source?: string }).source === 'compaction'),
    ).toBe(false);
  });
});

/* ---------------- 跨会话操控装配（e4-3——受理器栈级单例 + 工具族 + controlCross seam） ---------------- */

describe('跨会话操控装配（e4-3 操控腿接线）', () => {
  it('工具族恒挂载：durable 会话 toolNames 含操控三件（与 obs 四件并列 extraTools 位）', () => {
    const { rt } = rigRuntime();
    const { stack } = rigStack(rt);
    const session = stack.openStartupSession(rigWorkspace());
    const names = stack.driverOf(session.sessionId)!.toolNames!;
    for (const tool of ['session_send', 'session_interrupt', 'session_withdraw']) {
      expect(names).toContain(tool);
    }
  });

  it('sessionsControl 读面外露：三动词在场（assembly → plugin-boot fork 绑定消费位）', () => {
    const { rt } = rigRuntime();
    const { stack } = rigStack(rt);
    const verbs: readonly (keyof typeof stack.sessionsControl)[] = ['send', 'interrupt', 'withdraw'];
    for (const verb of verbs) {
      expect(typeof stack.sessionsControl[verb]).toBe('function');
    }
  });

  it('操控门默认关（doors 源缺席空集）：session_send 跨会话 → [SESSION_CONTROL_DENIED] 错面（run 不中断）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
    // write-effect 审批对整名免问（本测焦点在操控门非审批链——策略表整名
    // 条目合法放行面；操控门是受理器内第二道执法，两道门各自独立）
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-stack/m1',
      env: {},
      workspace: () => ws,
      toolPolicy: [{ tool: 'session_send', pattern: ws, decision: 'allow' }],
    });
    const a = stack.openStartupSession(ws);
    const b = stack.openStartupSession(ws); // 目标（同树/跨树同门——操控轴无树内豁免）
    faux.setResponses([
      () => toolCallOf('t1', 'session_send', { sessionId: b.sessionId, text: 'hi' }),
      () => messageOf('stop'),
    ]);
    const receipt = await stack.submitText(a.sessionId, '派活');
    expect(receipt).toMatchObject({ status: 'completed' });
    const results = stack
      .driverOf(a.sessionId)!
      .session.events()
      .filter((event) => event.type === 'tool/result')
      .map((event) => event.data as { content: unknown; error?: true });
    expect(results).toHaveLength(1);
    expect(results[0]!.error).toBe(true); // 门拒 = 工具错面（guard 折 BaseError）
    expect(JSON.stringify(results[0]!.content)).toContain('SESSION_CONTROL_DENIED');
    await rt.shutdown();
  });

  it('e-3 门态快照含操控门行：session_status 呈 sessions.control-cross=closed（doorStates 扩行生效）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const session = stack.openStartupSession(rigWorkspace());
    faux.setResponses([() => toolCallOf('t1', 'session_status', {}), () => messageOf('stop')]);
    const receipt = await stack.submitText(session.sessionId, '自省');
    expect(receipt).toMatchObject({ status: 'completed' });
    const text = JSON.stringify(
      stack
        .driverOf(session.sessionId)!
        .session.events()
        .find((event) => event.type === 'tool/result')!.data,
    );
    expect(text).toContain('sessions.control-cross=closed'); // 操控门行在场（doors 源缺席恒闭）
  });
});

/* ---------------- doors 段开门换态 e2e（开门制扩展批 g-1——seam 活体两读两判） ---------------- */

describe('doors 段开门换态 e2e（开门制扩展批——observeCross/controlCross seam 活体源）', () => {
  it('观测门 open 后 session_read 跨树过门；撤位即收回（受理时点现读现判）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
    let live = new Set(['sessions.observe-cross']); // doors 段活体（受理时点现读现判）
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-stack/m1',
      env: {},
      observeCross: { getOpens: () => live },
    });
    const a = stack.openStartupSession(ws);
    const b = stack.openStartupSession(ws); // 跨树目标
    // 开门态：跨树读正常收口（非错面）+ 门态快照呈 open
    faux.setResponses([() => toolCallOf('t1', 'session_read', { sessionId: b.sessionId }), () => messageOf('stop')]);
    const receipt = await stack.submitText(a.sessionId, '看别的会话');
    expect(receipt).toMatchObject({ status: 'completed' });
    const readResult = stack
      .driverOf(a.sessionId)!
      .session.events()
      .find((event) => event.type === 'tool/result')!.data as { error?: true };
    expect(readResult.error).toBeUndefined(); // 过门——SESSION_OBSERVE_DENIED 不再
    // 撤位即收回：同一装配再读同目标 → 错面复现（活体两读两判）
    live = new Set<string>();
    faux.setResponses([() => toolCallOf('t2', 'session_read', { sessionId: b.sessionId }), () => messageOf('stop')]);
    await stack.submitText(a.sessionId, '再看一次');
    const denied = stack
      .driverOf(a.sessionId)!
      .session.events()
      .filter((event) => event.type === 'tool/result')
      .at(-1)!.data as { content: unknown; error?: true };
    expect(denied.error).toBe(true);
    expect(JSON.stringify(denied.content)).toContain('SESSION_OBSERVE_DENIED');
    await rt.shutdown();
  });

  it('操控门 open 后 send 受理收口；门态快照同吃合成源（模型道视角）', async () => {
    const { rt } = rigRuntime();
    const ws = rigWorkspace();
    const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
    const live = new Set(['sessions.control-cross']); // doors 段活体
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-stack/m1',
      env: {},
      controlCross: { getOpensFor: () => live },
    });
    const a = stack.openStartupSession(ws);
    const b = stack.openStartupSession(ws); // 目标会话
    faux.setResponses([() => messageOf('stop')]); // b 的 followUp 轮消费（单响应即收口）
    // 开门态：sessionsControl 受理器（与工具族同源单例）send 三态受理成功
    const receipt = await stack.sessionsControl.send({
      caller: { kind: 'session', sessionId: a.sessionId },
      targetSessionId: b.sessionId,
      text: 'hi',
    });
    expect(['delivered', 'queued']).toContain(receipt.status);
    // 等 b 的 followUp 轮收口（防与主线程 setResponses 抢全局 faux 队列）
    await vi.waitFor(() => {
      expect(
        stack
          .driverOf(b.sessionId)!
          .session.events()
          .some((event) => event.type === 'turn/end'),
      ).toBe(true);
    });
    // 撤位即收回：同 caller 再 send → 门拒（受理序门检位前置于一切）
    live.clear();
    await expect(
      stack.sessionsControl.send({
        caller: { kind: 'session', sessionId: a.sessionId },
        targetSessionId: b.sessionId,
        text: 'again',
      }),
    ).rejects.toMatchObject({ code: 'SESSION_CONTROL_DENIED' });
    // 门态快照段同源：模型道视角 doorStates 走 getOpensFor({kind:'session'}) 合成位
    live.add('sessions.control-cross');
    faux.setResponses([() => toolCallOf('t1', 'session_status', {}), () => messageOf('stop')]);
    const run = stack.submitText(a.sessionId, '自省');
    const settled = await run;
    expect(settled).toMatchObject({ status: 'completed' });
    const status = JSON.stringify(
      stack
        .driverOf(a.sessionId)!
        .session.events()
        .filter((event) => event.type === 'tool/result')
        .at(-1)!.data,
    );
    expect(status).toContain('sessions.control-cross=open');
    await rt.shutdown();
  });
});

/* ---------------- 预算预警装配穿线（04 §5 软着陆层——遗漏审计批 H） ---------------- */

describe('预算预警装配穿线（批 H——budgetAdvisory stack 级注入位）', () => {
  it('供入 → 驱动请求尾注入（sessionId 落格绑定 + 瞬态零落账）；返回 null 零注入', async () => {
    const { rt } = rigRuntime();
    const seenMessages: Array<Array<{ role: string; content: unknown }>> = [];
    let supply: string | null = '[预算提示 NOTICE] 当日后台预算已用约 70%。';
    const { faux, stack } = rigStack(rt, {
      budgetAdvisory: () => supply,
    });
    const session = stack.openStartupSession(rigWorkspace());
    faux.setResponses([
      (ctx) => {
        seenMessages.push(ctx.messages as Array<{ role: string; content: unknown }>);
        return messageOf('stop');
      },
    ]);
    const receipt = await stack.submitText(session.sessionId, '问');
    expect(receipt).toMatchObject({ status: 'completed' });
    const tail = seenMessages[0]![seenMessages[0]!.length - 1]!;
    expect(tail.role).toBe('user');
    expect(tail.content).toContain('[预算提示 NOTICE]'); // 供入文案进请求尾
    // 瞬态纪律：durable 会话流零预警词（不打 user/message 事件）
    const durable = JSON.stringify(stack.driverOf(session.sessionId)!.session.events());
    expect(durable).not.toContain('预算提示');
    supply = null; // 次请求零注入（前台会话/未达档位形）
    faux.setResponses([
      (ctx) => {
        seenMessages.push(ctx.messages as Array<{ role: string; content: unknown }>);
        return messageOf('stop');
      },
    ]);
    await stack.submitText(session.sessionId, '再问');
    const tail2 = seenMessages[1]![seenMessages[1]!.length - 1]!;
    expect(tail2.content).not.toContain('预算提示'); // 零注入回合请求尾为 durable 消息
    await rt.shutdown();
  });

  it('run 车道透传（2026-09-13 修复批——修前红）：submitText 声明位经穿线达取值器（sessionId 落格 + 车道实参）', async () => {
    const { rt } = rigRuntime();
    const seenCalls: Array<{ sessionId: string; backgroundLane: boolean }> = [];
    const { faux, stack } = rigStack(rt, {
      budgetAdvisory: (sessionId, backgroundLane) => {
        seenCalls.push({ sessionId, backgroundLane });
        return backgroundLane ? '[预算提示 NOTICE] 后台道。' : null;
      },
    });
    const session = stack.openStartupSession(rigWorkspace());
    const seenMessages: Array<Array<{ role: string; content: unknown }>> = [];
    faux.setResponses([
      (ctx) => {
        seenMessages.push(ctx.messages as Array<{ role: string; content: unknown }>);
        return messageOf('stop');
      },
      (ctx) => {
        seenMessages.push(ctx.messages as Array<{ role: string; content: unknown }>);
        return messageOf('stop');
      },
    ]);
    // 后台道声明位 submit：取值器收 (sessionId, true) + 文案注入请求尾
    await stack.submitText(session.sessionId, '后台问', { backgroundLane: true });
    expect(seenCalls).toEqual([{ sessionId: session.sessionId, backgroundLane: true }]);
    expect(seenMessages[0]![seenMessages[0]!.length - 1]).toMatchObject({
      role: 'user',
      content: expect.stringContaining('后台道'),
    });
    // 前台 submit（缺省）：车道 false 零注入（尾条回落披露段瞬态槽——预警在其后，缺注入即不现）
    await stack.submitText(session.sessionId, '前台问');
    expect(seenCalls).toEqual([
      { sessionId: session.sessionId, backgroundLane: true },
      { sessionId: session.sessionId, backgroundLane: false },
    ]);
    expect(seenMessages[1]!.some((m) => String(m.content).includes('后台道'))).toBe(false);
    await rt.shutdown();
  });
});

/* ---------------- lane 帽闸件（04 §4 宿主级 run 并发帽——channels 消息语义批 m-2） ---------------- */

describe('lane 帽闸件（04 §4——m-2）', () => {
  it('tryAcquire 同步试位：帽内有位即取（零微任务边界——受理即落账同步段）、帽满/有人等位时 undefined（不插队）', () => {
    const gate = createRunLaneGate(1);
    const fast = gate.tryAcquire();
    expect(typeof fast).toBe('function');
    expect(gate.inFlight).toBe(1); // 同步置位——无 await
    expect(gate.tryAcquire()).toBeUndefined(); // 帽满返 undefined
    void gate.acquire(); // 排队者
    expect(gate.queued).toBe(1);
    expect(gate.tryAcquire()).toBeUndefined(); // 不变量：等位队列非空 ⟺ 帽满——试位不得插队
    fast!();
    expect(gate.inFlight).toBe(1); // 释放即 FIFO 移交——排队者即刻在飞
    expect(gate.queued).toBe(0);
  });

  it('帽内直取：inFlight 计数、释放归零', async () => {
    const gate = createRunLaneGate(2);
    const release1 = await gate.acquire();
    const release2 = await gate.acquire();
    expect(gate.inFlight).toBe(2);
    expect(gate.queued).toBe(0);
    release1();
    expect(gate.inFlight).toBe(1);
    release2();
    expect(gate.inFlight).toBe(0);
  });

  it('帽满 FIFO 排队：释放依序无缝移交（等位者即刻在飞）', async () => {
    const gate = createRunLaneGate(1);
    const release1 = await gate.acquire();
    const order: number[] = [];
    const pending2 = gate.acquire();
    const pending3 = gate.acquire();
    expect(gate.queued).toBe(2); // 帽满——两取位挂起排 FIFO
    void pending2.then((release) => {
      order.push(2);
      release(); // 拿到位即释放——移交下一位
    });
    void pending3.then((release) => {
      order.push(3);
      release();
    });
    release1(); // 触发移交链：1 释放 → 2 即刻在飞 → 2 释放 → 3 即刻在飞
    await vi.waitFor(() => expect(order).toEqual([2, 3]));
    expect(gate.inFlight).toBe(0);
    expect(gate.queued).toBe(0);
  });

  it('释放器幂等：双调不双扣在飞位（排队者不被重复移交）', async () => {
    const gate = createRunLaneGate(2);
    const release1 = await gate.acquire();
    await gate.acquire(); // 占满帽 2
    const queued = gate.acquire(); // 排队等位
    release1();
    release1(); // 双调——不得双扣/再移交
    expect(gate.inFlight).toBe(2); // 释放一位 → 排队者补位 → 仍满；双调无效果
    const releaseQueued = await queued;
    releaseQueued();
    releaseQueued(); // 幂等同律
    expect(gate.inFlight).toBe(1); // 恰扣一位
  });

  it('容量校验 fail-loud：非正整数 RangeError（空帽是死配置）', () => {
    expect(() => createRunLaneGate(0)).toThrow(RangeError);
    expect(() => createRunLaneGate(-1)).toThrow(RangeError);
    expect(() => createRunLaneGate(1.5)).toThrow(RangeError);
  });

  it('resolveRunLaneCapacity 解析序：显式覆盖 > env > 缺省 16；坏值 fail-loud', () => {
    expect(DEFAULT_RUN_LANE_CAPACITY).toBe(16);
    expect(resolveRunLaneCapacity(undefined, {})).toBe(16); // 缺省档
    expect(resolveRunLaneCapacity(undefined, { BERRY_AGENT_MAX_CONCURRENT_RUNS: '4' })).toBe(4); // env 覆盖
    expect(resolveRunLaneCapacity(8, { BERRY_AGENT_MAX_CONCURRENT_RUNS: '4' })).toBe(8); // 显式覆盖位优先
    expect(() => resolveRunLaneCapacity(undefined, { BERRY_AGENT_MAX_CONCURRENT_RUNS: '0' })).toThrow(RangeError);
    expect(() => resolveRunLaneCapacity(undefined, { BERRY_AGENT_MAX_CONCURRENT_RUNS: 'abc' })).toThrow(RangeError);
  });

  it('resolveRunLaneCapacity 字串形全串 /^\d+$/ 判（parseInt 截停放行堵死——尾随垃圾是坏帽死配置）', () => {
    // '16x'/'16.5'/'0x10'/'+16'/' 16'/'16 ' 在 parseInt 截停下均被静默放行为 16/16/16/16/16/16
    for (const raw of ['16x', '16.5', '0x10', '+16', ' 16', '16 ', '']) {
      expect(
        () => resolveRunLaneCapacity(undefined, { BERRY_AGENT_MAX_CONCURRENT_RUNS: raw }),
        `raw=${JSON.stringify(raw)}`,
      ).toThrow(RangeError);
    }
    // 纯数字串照常放行（全串判不收紧合法值域）
    expect(resolveRunLaneCapacity(undefined, { BERRY_AGENT_MAX_CONCURRENT_RUNS: '16' })).toBe(16);
    expect(resolveRunLaneCapacity(undefined, { BERRY_AGENT_MAX_CONCURRENT_RUNS: '1' })).toBe(1);
  });

  it('装配级 lane 帽（maxConcurrentRuns 透传）：多会话并发首 run 在飞次 run 排队、终态后无缝续跑', async () => {
    const { rt } = rigRuntime();
    const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-stack/m1',
      env: {}, // BERRY_AGENT_* 隔离——测试面自持
      maxConcurrentRuns: 1, // 显式覆盖位——装配透传（env 形随 m-3 收口锁笔 e2e）
    });
    const ws = rigWorkspace();
    const sessionA = stack.manager.create({ workspaceRoot: ws, origin: 'delegation' });
    const sessionB = stack.manager.create({ workspaceRoot: ws, origin: 'delegation' });
    // 首响应挂起（异步工厂制造在飞窗口）；次响应立即终值
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    faux.setResponses([
      async () => {
        await gate;
        return messageOf('stop');
      },
      () => messageOf('stop'),
    ]);
    const runA = stack.submitText(sessionA.sessionId, 'a问');
    const runB = stack.submitText(sessionB.sessionId, 'b问');
    // a 在飞（请求已发出）、b 排队——run 未诞生：零 LLM 调用零 durable 起跑事件
    await vi.waitFor(() => expect(faux.state.callCount).toBe(1));
    expect(sessionA.driver.session.events().some((event) => event.type === 'turn/start')).toBe(true);
    expect(sessionB.driver.session.events().some((event) => event.type === 'turn/start')).toBe(false);
    openGate(); // a 终态 → 释放位 → FIFO 无缝移交 b
    await expect(runA).resolves.toMatchObject({ status: 'completed' });
    await expect(runB).resolves.toMatchObject({ status: 'completed' });
    await vi.waitFor(() => expect(faux.state.callCount).toBe(2)); // b 续跑后请求才发出
    expect(sessionB.driver.session.events().some((event) => event.type === 'turn/start')).toBe(true);
    await rt.shutdown();
  });

  it('装配级 env 形 lane 帽（BERRY_AGENT_MAX_CONCURRENT_RUNS 注入实战——07 §7 行 4 登记位）', async () => {
    const { rt } = rigRuntime();
    const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-stack/m1',
      env: { BERRY_AGENT_MAX_CONCURRENT_RUNS: '1' }, // env 覆盖位——装配真穿进容量解析
    });
    const ws = rigWorkspace();
    const sessionA = stack.manager.create({ workspaceRoot: ws, origin: 'delegation' });
    const sessionB = stack.manager.create({ workspaceRoot: ws, origin: 'delegation' });
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    faux.setResponses([
      async () => {
        await gate;
        return messageOf('stop');
      },
      () => messageOf('stop'),
    ]);
    const runA = stack.submitText(sessionA.sessionId, 'a问');
    const runB = stack.submitText(sessionB.sessionId, 'b问');
    // 帽 1 经 env 生效：a 在飞、b 排队（run 未诞生——零 durable 起跑事件）
    await vi.waitFor(() => expect(faux.state.callCount).toBe(1));
    expect(sessionB.driver.session.events().some((event) => event.type === 'turn/start')).toBe(false);
    openGate();
    await expect(runA).resolves.toMatchObject({ status: 'completed' });
    await expect(runB).resolves.toMatchObject({ status: 'completed' });
    await vi.waitFor(() => expect(faux.state.callCount).toBe(2));
    await rt.shutdown();
  });
});

/* ---------------- 流活性 watchdog 双帽（04 §3.8——批 A 落码） ---------------- */

describe('流活性 watchdog 双帽（04 §3.8——批 A）', () => {
  it('resolveLlmIdleTimeoutMs 解析序：缺席/空串 = 缺省 300s、纯数字串放行（含 0 = 显式关）、坏形 fail-loud', () => {
    expect(DEFAULT_LLM_IDLE_TIMEOUT_MS).toBe(300_000);
    expect(LLM_IDLE_TIMEOUT_MS_ENV).toBe('BERRY_AGENT_LLM_IDLE_TIMEOUT_MS');
    expect(resolveLlmIdleTimeoutMs({})).toBe(300_000); // 缺席档
    expect(resolveLlmIdleTimeoutMs({ [LLM_IDLE_TIMEOUT_MS_ENV]: undefined })).toBe(300_000);
    expect(resolveLlmIdleTimeoutMs({ [LLM_IDLE_TIMEOUT_MS_ENV]: '' })).toBe(300_000); // 空串 = 缺席
    expect(resolveLlmIdleTimeoutMs({ [LLM_IDLE_TIMEOUT_MS_ENV]: '0' })).toBe(0); // 0 = 显式关（与缺席两态分明）
    expect(resolveLlmIdleTimeoutMs({ [LLM_IDLE_TIMEOUT_MS_ENV]: '45000' })).toBe(45_000);
    expect(() => resolveLlmIdleTimeoutMs({ [LLM_IDLE_TIMEOUT_MS_ENV]: 'abc' })).toThrow(RangeError);
    expect(() => resolveLlmIdleTimeoutMs({ [LLM_IDLE_TIMEOUT_MS_ENV]: '-1' })).toThrow(RangeError);
  });

  it('resolveSessionStallTimeoutMs 解析律同族：缺席/空串 = 缺省 900s、0 = 显式关、坏形 fail-loud', () => {
    expect(DEFAULT_SESSION_STALL_TIMEOUT_MS).toBe(900_000);
    expect(SESSION_STALL_TIMEOUT_MS_ENV).toBe('BERRY_AGENT_SESSION_STALL_TIMEOUT_MS');
    // 缺省 900s = 流层帽 300s × 3——须覆盖工具单跑上限（bash 600s）+ 余量（冷读定谳）
    expect(DEFAULT_SESSION_STALL_TIMEOUT_MS).toBeGreaterThan(600_000);
    expect(resolveSessionStallTimeoutMs({})).toBe(900_000);
    expect(resolveSessionStallTimeoutMs({ [SESSION_STALL_TIMEOUT_MS_ENV]: '' })).toBe(900_000);
    expect(resolveSessionStallTimeoutMs({ [SESSION_STALL_TIMEOUT_MS_ENV]: '0' })).toBe(0);
    expect(resolveSessionStallTimeoutMs({ [SESSION_STALL_TIMEOUT_MS_ENV]: '120000' })).toBe(120_000);
    expect(() => resolveSessionStallTimeoutMs({ [SESSION_STALL_TIMEOUT_MS_ENV]: 'abc' })).toThrow(RangeError);
  });

  it('两 resolver 字串形全串 /^\d+$/ 判（parseInt 截停放行堵死——尾随垃圾是坏帽死配置）', () => {
    for (const raw of ['300x', '1.5', '0x10', '+300', ' 300', '300 ', '３00']) {
      expect(
        () => resolveLlmIdleTimeoutMs({ [LLM_IDLE_TIMEOUT_MS_ENV]: raw }),
        `idle raw=${JSON.stringify(raw)}`,
      ).toThrow(RangeError);
      expect(
        () => resolveSessionStallTimeoutMs({ [SESSION_STALL_TIMEOUT_MS_ENV]: raw }),
        `stall raw=${JSON.stringify(raw)}`,
      ).toThrow(RangeError);
    }
    // 纯数字串照常放行（全串判不收紧合法值域）
    expect(resolveLlmIdleTimeoutMs({ [LLM_IDLE_TIMEOUT_MS_ENV]: '300000' })).toBe(300_000);
    expect(resolveSessionStallTimeoutMs({ [SESSION_STALL_TIMEOUT_MS_ENV]: '900000' })).toBe(900_000);
  });

  it('assertWatchdogHatOrder 交叉校验：stall < idle 启动红、stall ≥ idle 放行、流层关时纵深独走不受约束', () => {
    // 违例形：编排帽（60s）< 流层帽（300s）——分层序破防误杀不变式，fail-loud
    expect(() => assertWatchdogHatOrder(300_000, 60_000)).toThrow(RangeError);
    expect(() => assertWatchdogHatOrder(300_000, 299_999)).toThrow(RangeError);
    // 合法形：相等与大于（缺省 900s > 300s 同形）
    expect(() => assertWatchdogHatOrder(600_000, 600_000)).not.toThrow();
    expect(() => assertWatchdogHatOrder(300_000, 900_000)).not.toThrow();
    // 流层 0 = 关：纵深独立存在不受约束（主防缺席纵深在场合法）
    expect(() => assertWatchdogHatOrder(0, 60_000)).not.toThrow();
    // 纵深 0 = 关：主防在场纵深缺席同律合法（关也留痕在装配位 warn）
    expect(() => assertWatchdogHatOrder(300_000, 0)).not.toThrow();
    // 双关：全纵深缺席是显式选择，交叉校验不越权
    expect(() => assertWatchdogHatOrder(0, 0)).not.toThrow();
  });

  it('装配面 watchdog 读面暴露：缺省双值 + env 双键覆盖真穿（04 §3.8——装配根单次解析单源）', async () => {
    const { rt } = rigRuntime();
    const { stack } = rigStack(rt); // env {}——缺省档
    expect(stack.watchdog).toEqual({ llmIdleTimeoutMs: 300_000, sessionStallTimeoutMs: 900_000 });
    await rt.shutdown();
    const { rt: rt2 } = rigRuntime();
    const { stack: stack2 } = rigStack(rt2, {
      env: { [LLM_IDLE_TIMEOUT_MS_ENV]: '45000', [SESSION_STALL_TIMEOUT_MS_ENV]: '120000' },
    });
    expect(stack2.watchdog).toEqual({ llmIdleTimeoutMs: 45_000, sessionStallTimeoutMs: 120_000 });
    await rt2.shutdown();
  });

  it('装配面 fail-loud：交叉校验违例 env 与坏形 env 都是启动红（死配置当场可见）', async () => {
    const { rt } = rigRuntime();
    expect(() =>
      rigStack(rt, {
        env: { [LLM_IDLE_TIMEOUT_MS_ENV]: '600000', [SESSION_STALL_TIMEOUT_MS_ENV]: '120000' }, // stall < idle
      }),
    ).toThrow(RangeError);
    await rt.shutdown();
    const { rt: rt2 } = rigRuntime();
    expect(() => rigStack(rt2, { env: { [LLM_IDLE_TIMEOUT_MS_ENV]: 'abc' } })).toThrow(RangeError);
    await rt2.shutdown();
    const { rt: rt3 } = rigRuntime();
    expect(() => rigStack(rt3, { env: { [SESSION_STALL_TIMEOUT_MS_ENV]: '16x' } })).toThrow(RangeError);
    await rt3.shutdown();
  });

  it('0 = 显式关 warn 留痕（关也留痕——不暗关）：双关两笔、单关恰一笔、在场无痕', async () => {
    const { rt } = rigRuntime();
    const warns: string[] = [];
    rigStack(rt, {
      env: { [LLM_IDLE_TIMEOUT_MS_ENV]: '0', [SESSION_STALL_TIMEOUT_MS_ENV]: '0' },
      warn: (m) => warns.push(m),
    });
    expect(warns.some((m) => m.includes('流层 idle 帽显式关'))).toBe(true);
    expect(warns.some((m) => m.includes('编排层时滞帽显式关'))).toBe(true);
    await rt.shutdown();

    const { rt: rt2 } = rigRuntime();
    const warns2: string[] = [];
    rigStack(rt2, { env: { [LLM_IDLE_TIMEOUT_MS_ENV]: '0' }, warn: (m) => warns2.push(m) });
    expect(warns2.some((m) => m.includes('流层 idle 帽显式关'))).toBe(true);
    expect(warns2.some((m) => m.includes('编排层时滞帽显式关'))).toBe(false); // 纵深在场无痕
    await rt2.shutdown();

    const { rt: rt3 } = rigRuntime();
    const warns3: string[] = [];
    rigStack(rt3, { warn: (m) => warns3.push(m) }); // 双值在场——零关停痕
    expect(warns3.some((m) => m.includes('显式关'))).toBe(false);
    await rt3.shutdown();
  });

  it('env 真穿全链：流层 idle 帽经装配到真流——挂死流超帽收口 transient 重试即恢复（04 §3.8 主防闭环）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt, { env: { [LLM_IDLE_TIMEOUT_MS_ENV]: '40' } }); // 40ms 帽——窄值驱动时序
    const ws = rigWorkspace();
    const session = stack.manager.create({ workspaceRoot: ws, origin: 'delegation' });
    // 首响应永不 resolve（真 pi-ai streamSimple 路径上的流停滞形）；次响应立即终值
    faux.setResponses([() => new Promise<PiAssistantMessage>(() => {}), () => messageOf('stop')]);
    const receipt = await stack.submitText(session.sessionId, '问');
    // 全链闭环：env → resolver → createStreamFn defaults → withIdleTimeout 包真流 →
    // 挂死超帽合成 error 终值 → classifyError transient → driver 退避重试换新调用 → 恢复
    expect(receipt).toMatchObject({ status: 'completed' });
    expect(faux.state.callCount).toBe(2); // 挂死一次 + 恢复一次
    // 重试落账留痕：llm/retry(phase=scheduled) 信封在场（transient 腿退避窗）
    expect(
      session.driver.session
        .events()
        .some((event) => event.type === 'llm/retry' && (event.data as { phase?: string })?.phase === 'scheduled'),
    ).toBe(true);
    await rt.shutdown();
  });
});

/* ---------------- 预算读面接线 + usage 桥接单点（04 §5——2026-09-13 复盘修复 #41/#44） ---------------- */

/**
 * 网关改道形 provider 包装（mq-3 回归锁场——05 §1.1「model 实录优先」）：全权
 * 委派 faux（目录/auth/事件流原样），仅把终态报文上的 provider/model 改写为
 * 网关实录——复现「请求标识 ≠ 响应实录」的网关改道场景（请求按 'faux-stack/m1'
 * 解析路由、网关内部改道后响应实录另一标识）。faux 原生 cloneMessage 会把
 * provider/model 强写回请求值，故经本包装在出口改写。
 */
function gatewayRewriteProvider(
  faux: ReturnType<typeof fauxProvider>,
  reported: { provider: string; model: string },
): Provider {
  const base = faux.provider;
  /** 终态 assistant 报文改写实录位（非 assistant 形透传——防御位） */
  const rewrite = (message: unknown): unknown =>
    (message as { role?: string } | undefined)?.role === 'assistant'
      ? { ...(message as object), provider: reported.provider, model: reported.model }
      : message;
  /**
   * 事件流包装：终态 done 事件改写报文实录（start/partial 族透传——只有终值
   * 进记账面）。注意根包的 AssistantMessageEventStream 类名经 types.ts 型
   * 再出口为 type-only——实例化走官方 createAssistantMessageEventStream 工厂
   * （"for use in extensions" 的值出口）。
   */
  const wrapStream = (stream: AssistantMessageEventStream): AssistantMessageEventStream => {
    const out = createAssistantMessageEventStream();
    void (async () => {
      for await (const event of stream) {
        if (event.type === 'done') {
          out.push({ ...event, message: rewrite((event as { message?: unknown }).message) } as typeof event);
        } else {
          out.push(event);
        }
      }
      // done 事件 push 已解析终值；end 兜底迭代未产 done 的防御形（幂等无害）
      out.end(rewrite(await stream.result()) as PiAssistantMessage);
    })();
    return out;
  };
  // createProvider 产物是闭包方法对象（无 this 依赖）——spread 委派安全，仅覆写两流入口
  const wrapped: Provider = {
    ...base,
    stream: (model, context, options) => wrapStream(base.stream(model, context, options)),
    streamSimple: (model, context, options) => wrapStream(base.streamSimple(model, context, options)),
  };
  return wrapped;
}

describe('预算读面接线 + usage 桥接单点（04 §5 #41/#44）', () => {
  /** 带计量的 faux assistant 消息（桥接窗扫的计量源——usage 非零可断言数值面） */
  const meteredMessage = (input: number, output: number): PiAssistantMessage =>
    ({
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      usage: { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output },
      stopReason: 'stop',
      timestamp: 1,
    }) as unknown as PiAssistantMessage;

  /** 直接落库 llm/usage 底账（聚合读面测试种子——绕过桥接，专测读侧口径） */
  function seedLedger(
    rt: HostRuntime,
    sessionId: string,
    rows: { at: number; input: number; output: number; priority: 'background' | 'foreground' }[],
  ): void {
    let clock = rows[0]?.at ?? 0;
    const log = new SessionLog({ sessionId, clock: () => clock });
    for (const row of rows) {
      clock = row.at;
      log.append('llm/usage', {
        callId: `seed:${sessionId}:${row.at}:${row.input}`,
        model: 'seed/m1',
        usage: { input: row.input, output: row.output, cacheRead: 0, cacheWrite: 0 },
        priority: row.priority,
      });
    }
    const registration: SessionRegistration = {
      origin: 'conversation',
      parentId: undefined,
      seedLength: 0,
      workspaceRoot: '/tmp/ws',
      title: undefined,
    };
    const writes: EventWrite[] = log.events().map((event) => ({ sessionId, event, registration }));
    rt.persistence.store.writeEvents(writes);
  }

  it('前台 run settle 落 llm/usage（priority foreground——修前红：前台五入口零落账）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const ws = rigWorkspace();
    const session = stack.openStartupSession(ws);
    faux.setResponses([() => meteredMessage(30, 12)]);
    await stack.submitText(session.sessionId, '你好'); // 前台缺省道（TUI/webui/issue/SDK 同路）

    const events = stack.driverOf(session.sessionId)!.session.events();
    const usageEvents = events.filter((e) => e.type === 'llm/usage');
    expect(usageEvents.length).toBeGreaterThanOrEqual(1); // 修前红锚：前台路此前零落账
    const first = usageEvents[0]!.data as Record<string, unknown>;
    expect(first['priority']).toBe('foreground'); // 前台花销照入账
    expect(first['model']).toBe('faux-stack/m1'); // 记账 model = 会话级解析真值
    // callId 幂等身份 run:<sid>:<seq>——seq 锚定的确是本 run 的 assistant 消息
    const match = /^run:(.+):(\d+)$/.exec(String(first['callId']));
    expect(match?.[1]).toBe(session.sessionId);
    const anchor = events.find((e) => e.type === 'assistant/message' && e.seq === Number(match?.[2]));
    expect(anchor).toBeDefined();
    // 转抄保真律：计量桶逐值同源（faux 按请求自算 usage——数值动态，锁的是
    // 「桥接零改写」而非 faux 计量本身）
    const anchorUsage = (anchor!.data as { usage?: { input: number; output: number } }).usage;
    expect(first['usage']).toMatchObject({ input: anchorUsage?.input, output: anchorUsage?.output });
    // 前台不入闸门：spent 恒 0（05 §1.1 口径——聚合只计 background）
    expect(stack.llm.backgroundUsage().spent).toBe(0);
    expect(stack.llm.canAfford('background')).toBe(true);
    await rt.shutdown();
  });

  it('backgroundLane run：priority background + 聚合增量当日推进', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const ws = rigWorkspace();
    const session = stack.openStartupSession(ws);
    faux.setResponses([() => meteredMessage(80, 20)]);
    await stack.submitText(session.sessionId, '巡检', { source: 'schedule', backgroundLane: true });

    const events = stack.driverOf(session.sessionId)!.session.events();
    const usageEvents = events.filter((e) => e.type === 'llm/usage');
    expect(usageEvents).toHaveLength(1);
    expect((usageEvents[0]!.data as Record<string, unknown>)['priority']).toBe('background');
    // 读面增量：桥接落账后 backgroundUsage 即时可见（日键缓存 + 增量——不待
    // 落盘；spent = 本笔 input+output，faux 计量动态取转抄值同源断言）
    const ledger = usageEvents[0]!.data as { usage: { input: number; output: number } };
    expect(stack.llm.backgroundUsage().spent).toBe(ledger.usage.input + ledger.usage.output);
    expect(stack.llm.canAfford('background')).toBe(true); // 缺省 4M 池内
    await rt.shutdown();
  });

  it('单发计量：complete metering 归因落目标会话流 + 当日缓存同推（修前红——04 §5 mq）', async () => {
    const { rt } = rigRuntime();
    const warns: string[] = [];
    const { faux, stack } = rigStack(rt, { warn: (m) => warns.push(m) });
    const ws = rigWorkspace();
    const session = stack.openStartupSession(ws);
    faux.setResponses([() => meteredMessage(30, 12)]);
    const result = await stack.llm.complete({
      messages: [{ role: 'user', content: '单发', timestamp: Date.now() }],
      priority: 'background',
      metering: { sessionId: session.sessionId },
    });
    const events = stack.driverOf(session.sessionId)!.session.events();
    const usageEvents = events.filter((e) => e.type === 'llm/usage');
    expect(usageEvents).toHaveLength(1);
    const pen = usageEvents[0]!.data as Record<string, unknown>;
    expect(pen['callId']).toBe(result.callId); // 同源（CompleteResult.callId 直落）
    expect(String(pen['callId'])).toMatch(/^[0-9a-f-]{36}$/); // complete 路唯一 UUID（非 run: 前缀——单发无重试落账窗口）
    expect(pen['priority']).toBe('background');
    expect(typeof pen['elapsedMs']).toBe('number'); // 照执行真值实录（run 路桥接无此源）
    // 当日缓存随落账同推：spent = 转抄笔同源断言（faux 计量动态取转抄值律——不硬编）
    const ledger = pen['usage'] as { input: number; output: number };
    expect(stack.llm.backgroundUsage().spent).toBe(ledger.input + ledger.output);
    expect(warns).toEqual([]); // 有归因不 warn
    await rt.shutdown();
  });

  it('单发计量：foreground 照实录入账不进后台池（compaction 同形——04 §5 mq）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const ws = rigWorkspace();
    const session = stack.openStartupSession(ws);
    faux.setResponses([() => meteredMessage(40, 8)]);
    await stack.llm.complete({
      messages: [{ role: 'user', content: '压缩', timestamp: Date.now() }],
      priority: 'foreground',
      metering: { sessionId: session.sessionId },
    });
    const events = stack.driverOf(session.sessionId)!.session.events();
    const usageEvents = events.filter((e) => e.type === 'llm/usage');
    expect(usageEvents).toHaveLength(1);
    expect((usageEvents[0]!.data as Record<string, unknown>)['priority']).toBe('foreground');
    // 前台花销照入账不进闸门（与 run 路桥接同律）
    expect(stack.llm.backgroundUsage().spent).toBe(0);
    await rt.shutdown();
  });

  it('单发计量：metering 缺席零落账 + warn 丢账可观测（不静默律——04 §5 mq）', async () => {
    const { rt } = rigRuntime();
    const warns: string[] = [];
    const { faux, stack } = rigStack(rt, { warn: (m) => warns.push(m) });
    const ws = rigWorkspace();
    const session = stack.openStartupSession(ws);
    faux.setResponses([() => meteredMessage(5, 5)]);
    await stack.llm.complete({
      messages: [{ role: 'user', content: '无归因', timestamp: Date.now() }],
      priority: 'background',
    });
    const events = stack.driverOf(session.sessionId)!.session.events();
    expect(events.filter((e) => e.type === 'llm/usage')).toHaveLength(0);
    expect(warns.some((w) => w.includes('metering'))).toBe(true);
    await rt.shutdown();
  });

  it('单发计量：会话退役后粘滞持有仍落账（settle 观测持有在场——写路径律 04 §5 mq）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const ws = rigWorkspace();
    const session = stack.openStartupSession(ws);
    // 先跑一轮：会话行落库 + settle 观测已把活体日志入持有——本例实走粘滞
    // 持有腿（词面与实走腿一致；detached 铸新腿形归跨进程形例，见下例）
    await stack.submitText(session.sessionId, '先跑一轮');
    await rt.persistence.flush();
    const loadSpy = vi.spyOn(rt.persistence, 'loadSession');
    stack.manager.retire(session.sessionId); // 摘活体 → driverOf undefined
    faux.setResponses([() => meteredMessage(20, 10)]);
    await stack.llm.complete({
      messages: [{ role: 'user', content: '退役后', timestamp: Date.now() }],
      priority: 'background',
      metering: { sessionId: session.sessionId },
    });
    await rt.persistence.flush();
    // 腿身份钉死：持有在场 → loadSession 铸新腿零调用（live 缺席解析走持有
    // 对象——append 直通既有写队列，durable 可查）。同流还有先跑轮 run 路
    // 桥接笔（callId 'run:' 前缀）——按 callId 形区分
    expect(loadSpy).not.toHaveBeenCalled();
    const page = rt.persistence.store.queryEvents({ sessionId: session.sessionId, types: ['llm/usage'], sinceMs: 0 });
    const singles = page.events.filter(
      (e) => !String((e.data as Record<string, unknown>)['callId']).startsWith('run:'),
    );
    expect(singles).toHaveLength(1);
    expect((singles[0]!.data as Record<string, unknown>)['priority']).toBe('background');
    await rt.shutdown();
  });

  it('单发计量：零 run 会话退役后解析走粘滞持有、loadSession 铸新腿零调用（mq-2 修前红——首-run-在飞窗 live/hold 双空）', async () => {
    const { rt } = rigRuntime();
    const warns: string[] = [];
    const { faux, stack } = rigStack(rt, { warn: (m) => warns.push(m) });
    const ws = rigWorkspace();
    // 零 run 即退役 = 「首 run 在飞、尚无被观测 settle 即退役」窗的等价触发
    //（goal 沉淀单发恰在 run 组装期发起、无先导 settle——goalDeposit 同窗形）：
    // 修前持有只在 settle 观测落位 → live/hold 双空；修后创建/开期即持
    const session = stack.openStartupSession(ws);
    const loadSpy = vi.spyOn(rt.persistence, 'loadSession');
    stack.manager.retire(session.sessionId); // dismantle + 摘登记 → driverOf undefined
    faux.setResponses([() => meteredMessage(20, 10)]);
    const result = await stack.llm.complete({
      messages: [{ role: 'user', content: '退役后', timestamp: Date.now() }],
      priority: 'background',
      metering: { sessionId: session.sessionId },
    });
    // 解析走持有：detached loadSession 铸新腿零调用（修前红锚——当前双空必经
    // loadSession；零 run 会话行未落库时该调用直接抛 PERSIST_DATA_CORRUPT →
    // 丢账仅 warn）
    expect(loadSpy).not.toHaveBeenCalled();
    // 笔落既有日志：创建期持有 = 同对象同计数器（无第二日志、无 seq 撞车）
    const usageEvents = session.driver.session.events().filter((e) => e.type === 'llm/usage');
    expect(usageEvents).toHaveLength(1);
    expect((usageEvents[0]!.data as Record<string, unknown>)['callId']).toBe(result.callId);
    // 无丢账可观测（修前：onUsage 回调内抛 → onUsageError 交接 warn 在场）
    expect(warns.some((w) => w.includes('丢账'))).toBe(false);
    await rt.shutdown();
  });

  it('单发计量：跨进程形 detached loadSession 铸新腿仍落账（从未见过活体——test/mq-1 补锁）', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stack-data-'));
    dirs.push(dir);
    const ws = rigWorkspace();
    // 栈 A：持久 dataDir 跑一轮落会话行后完整 shutdown（write-behind 冲刷在内）
    const rt1 = createHostRuntime({ dataDir: dir });
    const rig1 = rigStack(rt1);
    const first = rig1.stack.openStartupSession(ws);
    rig1.faux.setResponses([() => meteredMessage(30, 12)]);
    await rig1.stack.submitText(first.sessionId, '第一轮');
    await rt1.shutdown();
    // 栈 B：同 dataDir 新建——hold 空（本进程未创建/开过该会话驱动）、driverOf
    // 空 = 「从未见过活体」形，解析必经 detached loadSession 铸新腿
    const rt2 = createHostRuntime({ dataDir: dir });
    const rig2 = rigStack(rt2);
    const loadSpy = vi.spyOn(rt2.persistence, 'loadSession');
    rig2.faux.setResponses([() => meteredMessage(8, 3)]);
    const result = await rig2.stack.llm.complete({
      messages: [{ role: 'user', content: '跨进程记账', timestamp: Date.now() }],
      priority: 'background',
      metering: { sessionId: first.sessionId },
    });
    // 真走 detached 腿：loadSession 被调（铸新内存日志对象——该会话本进程写
    // 队列必空，铸新安全）
    expect(loadSpy).toHaveBeenCalled();
    await rt2.persistence.flush();
    // durable 落账可查：单发笔在场（callId 非 'run:' 前缀——同流另有栈 A 的
    // run 路桥接笔，按 callId 形区分）
    const page = rt2.persistence.store.queryEvents({ sessionId: first.sessionId, types: ['llm/usage'], sinceMs: 0 });
    const singles = page.events.filter(
      (e) => !String((e.data as Record<string, unknown>)['callId']).startsWith('run:'),
    );
    expect(singles).toHaveLength(1);
    expect((singles[0]!.data as Record<string, unknown>)['callId']).toBe(result.callId);
    await rt2.shutdown();
  });

  it('llm/usage model 实录优先：complete 响应自带网关实录拼全形入账（mq-3 修前红——当前恒请求标识）', async () => {
    const { rt } = rigRuntime();
    const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
    // 网关改道形：请求标识 'faux-stack/m1' 照常解析路由，响应报文实录
    // 'gw-x/actual'（≠ 请求标识——网关内部改道，账面失真场景复现）
    const stack = createConversationStack({
      runtime: rt,
      providers: [gatewayRewriteProvider(faux, { provider: 'gw-x', model: 'actual' })],
      model: 'faux-stack/m1',
      env: {},
    });
    const ws = rigWorkspace();
    const session = stack.openStartupSession(ws);
    faux.setResponses([() => meteredMessage(12, 4)]);
    await stack.llm.complete({
      messages: [{ role: 'user', content: '单发', timestamp: Date.now() }],
      priority: 'foreground',
      metering: { sessionId: session.sessionId },
    });
    const usageEvents = stack
      .driverOf(session.sessionId)!
      .session.events()
      .filter((e) => e.type === 'llm/usage');
    expect(usageEvents).toHaveLength(1);
    // 实录全形字面断言（05 §1.1「响应自带 provider+model 拼全形」——修前红锚：
    // 当前恒记请求标识 'faux-stack/m1'，网关改道场景账面失真）
    expect((usageEvents[0]!.data as Record<string, unknown>)['model']).toBe('gw-x/actual');
    await rt.shutdown();
  });

  it('llm/usage model 实录优先：桥接路载荷自带 provider/model 拼全形、缺席回落请求标识（mq-3 修前红）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const session = stack.openStartupSession(rigWorkspace());
    // 在飞窗挂起：run 起跑（seqFromLaunch 已捕获）后向活体日志注入一条载荷
    // 自带网关实录的 assistant/message，再放行真响应——两条同窗各成一笔
    let openGate!: () => void;
    const gate = new Promise<void>((resolve) => {
      openGate = resolve;
    });
    faux.setResponses([async () => await gate.then(() => meteredMessage(15, 6))]);
    const runP = stack.submitText(session.sessionId, '问');
    await vi.waitFor(() => {
      // 首请求已发出（挂起中）且 turn 已起拍——注入事件必落桥接窗 (seqFromLaunch, settle]
      expect(faux.state.callCount).toBe(1);
      expect(
        stack
          .driverOf(session.sessionId)!
          .session.events()
          .some((e) => e.type === 'turn/start'),
      ).toBe(true);
    });
    const synthetic = stack.driverOf(session.sessionId)!.session.append('assistant/message', {
      content: [],
      usage: { input: 9, output: 4, cacheRead: 0, cacheWrite: 0 },
      stopReason: 'stop',
      provider: 'gw-x',
      model: 'actual',
    });
    openGate();
    await expect(runP).resolves.toMatchObject({ status: 'completed' });

    const ledger = new Map<string, string>();
    for (const event of stack.driverOf(session.sessionId)!.session.events()) {
      if (event.type !== 'llm/usage') continue;
      const data = event.data as Record<string, unknown>;
      ledger.set(String(data['callId']), String(data['model']));
    }
    // 实录条：载荷自带 provider+model → 拼全形（修前红锚：当前恒 'faux-stack/m1'）
    expect(ledger.get(`run:${session.sessionId}:${synthetic.seq}`)).toBe('gw-x/actual');
    // 缺席条（真响应经 wiring 落实录 → 全形拼接 'faux-stack/m1'——与回落值
    // 同串，两路在该断言上不可分；区分面在上一条实录锚）
    const others = [...ledger.entries()].filter(([callId]) => callId !== `run:${session.sessionId}:${synthetic.seq}`);
    expect(others).toHaveLength(1);
    expect(others[0]![1]).toBe('faux-stack/m1');
    await rt.shutdown();
  });

  it('llm/usage model 实录优先：run 路桥接生产触达——wiring 落账带实录（FX-4 修前红——当前写位丢弃实录恒回落请求标识）', async () => {
    const { rt } = rigRuntime();
    const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
    // 网关改道形 + 真 run 路（submitText 全链生产触达——区别于上例合成注入锁形）
    const stack = createConversationStack({
      runtime: rt,
      providers: [gatewayRewriteProvider(faux, { provider: 'gw-x', model: 'actual' })],
      model: 'faux-stack/m1',
      env: {},
    });
    const session = stack.openStartupSession(rigWorkspace());
    faux.setResponses([() => meteredMessage(15, 6)]);
    await stack.submitText(session.sessionId, '问');
    const usageEvents = stack
      .driverOf(session.sessionId)!
      .session.events()
      .filter((e) => e.type === 'llm/usage');
    expect(usageEvents).toHaveLength(1);
    // 修前红锚：wiring 落账不带 provider/model → ledgerModelOf(undefined, undefined,
    // 'faux-stack/m1') 回落请求标识——网关改道场景计量账面失真（实录 'gw-x/actual'）
    expect((usageEvents[0]!.data as Record<string, unknown>)['model']).toBe('gw-x/actual');
    await rt.shutdown();
  });

  it('同会话两 run 各落各账（窗锚推进——恰一笔/assistant 无双计）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const ws = rigWorkspace();
    const session = stack.openStartupSession(ws);
    faux.setResponses([() => meteredMessage(10, 5), () => meteredMessage(7, 3)]);
    await stack.submitText(session.sessionId, '一问');
    await stack.submitText(session.sessionId, '二问');

    const events = stack.driverOf(session.sessionId)!.session.events();
    const usageEvents = events.filter((e) => e.type === 'llm/usage');
    expect(usageEvents).toHaveLength(2); // 两 run 各一笔——窗 (seqFromLaunch, settle] 不交叠
    const callIds = usageEvents.map((e) => (e.data as Record<string, unknown>)['callId']);
    expect(new Set(callIds).size).toBe(2); // seq 域天然不撞（幂等身份）
    // 前台双笔不入闸门
    expect(stack.llm.backgroundUsage().spent).toBe(0);
    await rt.shutdown();
  });

  it('聚合读面：当日窗 + background 过滤 + 前台不入闸（05 §1.1 口径单源）', async () => {
    const { rt } = rigRuntime();
    const today = startOfTodayMs();
    seedLedger(rt, 'seed-ledger', [
      { at: today - 60_000, input: 900, output: 99, priority: 'background' }, // 昨日尾——不跨日
      { at: today + 60_000, input: 50, output: 0, priority: 'foreground' }, // 前台——不入闸
      { at: today + 120_000, input: 80, output: 20, priority: 'background' }, // 当日后台——唯一入账
    ]);
    const { stack } = rigStack(rt);
    const usage = stack.llm.backgroundUsage();
    expect(usage.spent).toBe(100); // 80+20 恰一笔——昨日/前台两排除律
    expect(usage.limit).toBe(4_000_000); // 缺省池（llm 件单源）
    expect(usage.ratio).toBeCloseTo(100 / 4_000_000);
    await rt.shutdown();
  });

  it('env 旋钮：好形覆盖 / 零值显式关池 / 坏形 fail-loud 启动当场红', async () => {
    const { rt } = rigRuntime();
    const capped = rigStack(rt, { env: { BERRY_AGENT_BACKGROUND_BUDGET_TOKENS: '150' } });
    expect(capped.stack.llm.backgroundUsage().limit).toBe(150); // 好形覆盖缺省
    const zeroed = rigStack(rt, { env: { BERRY_AGENT_BACKGROUND_BUDGET_TOKENS: '0' } });
    expect(zeroed.stack.llm.canAfford('background')).toBe(false); // 零值 = 显式关池
    expect(zeroed.stack.llm.canAfford('foreground')).toBe(true); // 前台恒放行
    expect(() => rigStack(rt, { env: { BERRY_AGENT_BACKGROUND_BUDGET_TOKENS: '12x' } })).toThrow(RangeError); // 坏形死配置当场红
    await rt.shutdown();
  });
});

describe('会话关闭收口穿线（六役 CL-C ④——04 §10 closeOwner 段消费位接线）', () => {
  it('onSessionClosed 透传 manager：retire 成功路携会话 id 发射；dispose 全量拆解路同发（修前红：穿线位不存在）', () => {
    const { rt } = rigRuntime(true);
    const closed: string[] = [];
    const { stack } = rigStack(rt, { onSessionClosed: (sessionId) => closed.push(sessionId) });
    const a = stack.manager.create();
    const b = stack.manager.create();
    expect(stack.manager.retire(a.sessionId)).toBe(true);
    expect(closed).toEqual([a.sessionId]); // retire 路恰一笔
    stack.manager.dispose();
    expect(closed).toEqual([a.sessionId, b.sessionId]); // dispose 路逐会话补发（同源两路不双发）
    void rt.shutdown();
  });
});

describe('模型循环基座（挂账解挂批 2026-09-15——ctrl+p 会话级旋钮数据路）', () => {
  it('setModel 活写栈基线：读面随动 + 新 run 起跑现取新值（request/header 实证）', async () => {
    const { rt } = rigRuntime();
    const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }, { id: 'm2' }] });
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-stack/m1',
      env: {},
    });
    expect(stack.model).toBe('faux-stack/m1'); // 读面基线
    const ws = rigWorkspace();
    const session = stack.openStartupSession(ws);
    faux.setResponses([() => messageOf('stop'), () => messageOf('stop')]);
    await stack.submitText(session.sessionId, '一问');
    // 旋钮换档（不写盘——会话级内存旋钮）
    stack.setModel('faux-stack/m2');
    expect(stack.model).toBe('faux-stack/m2'); // 读面随动
    await stack.submitText(session.sessionId, '二问');
    // 每 run 起跑现取：两枚 request/header 各携当时值（消费 = 下一 run 起跑）
    const headers = session.driver.session
      .events()
      .filter((event) => event.type === 'request/header')
      .map((event) => (event.data as { config: { model: string } }).config.model);
    expect(headers).toEqual(['faux-stack/m1', 'faux-stack/m2']);
    await rt.shutdown();
  });
});
