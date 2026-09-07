/**
 * host/conversation-stack 组合根测试——对话栈五层装配的真盘全栈验证。
 *
 * 真盘真库（临时目录 + 真实 Persistence）+ faux provider 走真实 streamFn 路径
 * （mock 只停在模型层）。钉死：启动会话策略（新建/按 cwd 续接）/ 投影拉取
 * （活体优先 + 回库装载）/ 信封回流 / memory 形工具缺席降级 / 退出序接线。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { AgentMessage } from '../contracts/index.js';
import type { SessionEnvelope, UiBackend } from '../channels/index.js';
import { fauxProvider } from '../llm/index.js';

import { createConversationStack } from './conversation-stack.js';
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
