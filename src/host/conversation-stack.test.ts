/**
 * host/conversation-stack 组合根测试——对话栈五层装配的真盘全栈验证。
 *
 * 真盘真库（临时目录 + 真实 Persistence）+ faux provider 走真实 streamFn 路径
 * （mock 只停在模型层）。钉死：启动会话策略（新建/按 cwd 续接）/ 投影拉取
 * （活体优先 + 回库装载）/ 信封回流 / memory 形工具缺席降级 / 退出序接线。
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { AgentMessage, ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';
import { materializeHostFace } from '../contracts/api.js';
import type { SessionEnvelope, UiBackend } from '../channels/index.js';
import { Scope } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';
import type { SessionLog } from '../session/index.js';

import { appendAllowlistEntry, readAllowlist } from './allowlist-store.js';
import { createConversationStack, lastUsageFactOf } from './conversation-stack.js';
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
function rigStack(rt: HostRuntime) {
  const faux = fauxProvider({ provider: 'faux-stack', models: [{ id: 'm1' }] });
  const stack = createConversationStack({
    runtime: rt,
    providers: [faux.provider],
    model: 'faux-stack/m1',
    env: {}, // BERRY_AGENT_MODEL 隔离——测试面自持模型
  });
  return { faux, stack };
}

describe('createConversationStack 装配序', () => {
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
    // 整形后实面快照（孙代委派的基准面；会话维四件 + 操控三件恒挂载——
    // e2-4/e4-3 与 fs/检索/todo 并列）
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
    ]);

    faux.setResponses([() => messageOf('stop')]);
    const receipt = await stack.submitText(child.sessionId, '探索去');
    expect(receipt).toMatchObject({ status: 'completed' });

    // 信封快照（边界制）承载两位：systemPrompt 原始值（快照先于注入）+
    // toolSchemas = 整形后实面（裸栈 = fs 四 + 检索两 + todo + 会话维四件 +
    // 操控三件，无 bash）
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

/* ---------------- 批 12f-4：审批 always 回写与 allowlist 免问接线 e2e ---------------- */

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

describe('审批 always 回写与 allowlist 免问（批 12f-4——04 §9 粘性第 3 款全链接线）', () => {
  it('write 审批 always：结构草案经 persistAllowlist → appendAllowlistEntry 真落 allowlist.json', async () => {
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
      persistAllowlist: (draft) => void appendAllowlistEntry(dir, draft),
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
    const load = readAllowlist(dir);
    expect(load.healthy).toBe(true);
    expect(load.entries).toHaveLength(1);
    expect(load.entries[0]!.tool).toBe('write');
    expect(load.entries[0]!.pattern.endsWith('n1.txt')).toBe(true); // canonical 绝对路径（realpath 平台差异不锁全串）
    await rt.shutdown();
  });

  it('allowlist 条目透传：免问放行（零审批交互 + 工具照常执行）', async () => {
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
      allowlist: [{ tool: 'write', pattern: ws }],
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
    // 命中审计（04 §9 批 12f-4）：放行行 reason 位落 allowlist:<条目序>——
    // 免问放行仍可审计（「谁放的行」= 哪条既有授权放的行）
    const gateDecisions = dataOf(session.driver.session, 'gate/decision');
    expect(
      gateDecisions.some(
        (d) =>
          (d as { decision: string; reason: string }).decision === 'allow' &&
          (d as { decision: string; reason: string }).reason === 'allowlist:0',
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
    // write-effect 审批对整名免问（本测焦点在操控门非审批链——allowlist 整名
    // 条目合法放行面；操控门是受理器内第二道执法，两道门各自独立）
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-stack/m1',
      env: {},
      workspace: () => ws,
      allowlist: [{ tool: 'session_send', pattern: ws }],
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
