/**
 * host/workspace-anchor 测试——issue 会话工作区锚接线 + grantedRoots 消费
 * （03 §10.7 隔离条六役定形注的回归锁，CL-A1）。
 *
 * 真盘真库（临时目录 + 真实 Persistence + 真栈）+ faux provider 走真实
 * streamFn 路径（mock 只停在模型层）。两簇缺陷的修前红位：
 *  ① 锚接线：登记行携 workspaceRoot（issue 起 headless 会话形）→ 驱动工具
 *     装配的 workspace() 必须等于该路径（修前恒 canonical 仓根——相对路径
 *     解析落错根即红）；
 *  ② 消费接线：worktree 服务注入 → 三工具挂载 + create 授予经 grantedRoots
 *     live callback 并入 fence（grant 起于会话起后——活取非装配快照；修前
 *     grantedRoots 零消费、三工具零挂载即红）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage, Provider } from '@earendil-works/pi-ai';

import type { AgentMessage, ApprovalAskAnswer, ApprovalAskRequest } from '../contracts/index.js';
import type { SessionEnvelope, UiBackend } from '../channels/index.js';
import { fauxProvider } from '../llm/index.js';
import type { WorktreeService } from '../tools/index.js';

import { createConversationStack } from './conversation-stack.js';
import type { ConversationStackOptions } from './conversation-stack.js';
import { createHostRuntime } from './runtime.js';
import type { HostRuntime } from './runtime.js';

/* ---------------- 测试基建（issue-session.test.ts 同款形） ---------------- */

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** 组装指定终态的 assistant 消息（faux 响应脚本用） */
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

/** 审批应答后端（write 效果族的问面——恒答 approve；conversation-stack.test 同款） */
class ApproveBackend implements UiBackend<AgentMessage> {
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
  constructor(private readonly answer: ApprovalAskAnswer) {}
  hasAudience(): boolean {
    return true;
  }
  notify(): void {}
  onEnvelope(_env: SessionEnvelope): void {}
  onRepaint(): void {}
  async askApproval(_sessionId: string, _request: ApprovalAskRequest): Promise<ApprovalAskAnswer> {
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
  const dir = mkdtempSync(join(tmpdir(), 'anchor-data-'));
  dirs.push(dir);
  const rt = createHostRuntime({ dataDir: dir });
  return { dir, rt };
}

/**
 * faux provider + 栈组装速记。**不注入 workspace 覆盖位**——栈级锚走缺省
 * canonicalWorkspaceRoot()（生产 daemon 同形），会话行锚的胜出关系才可观察。
 */
function rigStack(rt: HostRuntime, overrides: Partial<ConversationStackOptions> = {}) {
  const faux = fauxProvider({ provider: 'faux-anchor', models: [{ id: 'm1' }] });
  const stack = createConversationStack({
    runtime: rt,
    providers: [faux.provider] as readonly Provider[],
    model: 'faux-anchor/m1',
    env: {},
    ...overrides,
  });
  return { faux, stack };
}

/**
 * worktree 服务结构假件（记账面真实现形——git 腿不跑：本测面只锁装配接线
 * 与授予/fence 消费，不锁 git 行为〔tools/worktree.test.ts 域〕）。create
 * 产物路径由注入的派生器给出（测试指向 HOME 下仓外目录——缺省可写根之外，
 * fence 并入与否才可观察）。
 */
function fakeWorktreeService(pathFor: (name: string) => string): WorktreeService {
  const grants = new Map<string, Set<string>>();
  const addGrant = (sessionId: string, path: string): void => {
    let set = grants.get(sessionId);
    if (set === undefined) {
      set = new Set();
      grants.set(sessionId, set);
    }
    set.add(path);
  };
  return {
    async create(req) {
      const path = pathFor(req.name);
      // 授予记账与真身同律（04 §7 补钉①——create 成功即自动授予本会话）
      if (req.sessionId !== undefined) addGrant(req.sessionId, path);
      return { name: req.name, path, branch: req.name };
    },
    async list() {
      return [];
    },
    async clean() {
      throw new Error('不在本测面（git 腿归 tools/worktree.test.ts）');
    },
    async diffPatch() {
      throw new Error('不在本测面（git 腿归 tools/worktree.test.ts）');
    },
    async grant(req) {
      addGrant(req.sessionId, req.path);
    },
    grantedRoots(sessionId) {
      return [...(grants.get(sessionId) ?? [])];
    },
    releaseSession(sessionId) {
      const released = [...(grants.get(sessionId) ?? [])];
      grants.delete(sessionId);
      return released;
    },
  };
}

/** 工具结果事件 data 按调用 id 取（断言简写） */
function resultOf(
  events: ReadonlyArray<{ type: string; data: unknown }>,
  toolCallId: string,
): { toolCallId: string; error?: boolean; content: unknown } | undefined {
  for (const event of events) {
    if (event.type !== 'tool/result') continue;
    const data = event.data as { toolCallId?: string };
    if (data.toolCallId === toolCallId) return event.data as { toolCallId: string; error?: boolean; content: unknown };
  }
  return undefined;
}

/* ---------------- ① 锚接线（登记行 workspaceRoot → 驱动工具装配） ---------------- */

describe('issue 会话工作区锚接线（03 §10.7 六役定形注）', () => {
  it('登记行携 workspaceRoot：驱动工具面锚定该路径——相对路径 read 落 worktree 内（修前恒 canonical 仓根即红）', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt); // 无 workspace 覆盖——栈级锚 = canonical 仓根（生产 daemon 同形）
    // 「worktree」目录 + 锚探针件（只在 worktree 内在场——仓根内无此名）
    const fakeWt = mkdtempSync(join(tmpdir(), 'berry-anchor-wt-'));
    dirs.push(fakeWt);
    writeFileSync(join(fakeWt, 'anchor-probe.txt'), 'wt-anchor-probe', 'utf8');

    // issue 起 headless 会话同形：manager.create({ workspaceRoot: worktree 路径 })
    const child = stack.manager.create({ workspaceRoot: fakeWt, origin: 'trigger', title: 'issue（headless）' });
    faux.setResponses([
      () => toolCallOf('t-anchor', 'read', { path: 'anchor-probe.txt' }), // 相对路径——resolve 基准即锚
      () => messageOf('收口'),
    ]);
    const receipt = await stack.submitText(child.sessionId, '读探针');
    expect(receipt).toMatchObject({ status: 'completed' });
    const probe = resultOf(child.driver.session.events(), 't-anchor');
    expect(probe).toBeDefined();
    // 修前红位：锚落 canonical 仓根 → 文件不在 → error:true；接线后锚 = 登记行路径
    expect(probe!.error).toBeUndefined();
    expect(JSON.stringify(probe!.content)).toContain('wt-anchor-probe');
    await rt.shutdown();
  });

  it('普通会话（行无 workspaceRoot）：锚回落栈级缺省现状不变——相对路径 read 仍锚 canonical 仓根', async () => {
    const { rt } = rigRuntime();
    const { faux, stack } = rigStack(rt);
    const plain = stack.manager.create({ origin: 'conversation' }); // 无 workspaceRoot——普通会话形
    faux.setResponses([
      () => toolCallOf('t-plain', 'read', { path: 'anchor-probe.txt' }), // 仓根内无此名——锚正确即诚实拒
      () => messageOf('收口'),
    ]);
    const receipt = await stack.submitText(plain.sessionId, '读探针');
    expect(receipt).toMatchObject({ status: 'completed' });
    const probe = resultOf(plain.driver.session.events(), 't-plain');
    expect(probe).toBeDefined();
    expect(probe!.error).toBe(true); // 锚 = canonical 仓根（回落现状）→ 文件不在场诚实拒
    await rt.shutdown();
  });
});

/* ---------------- ② 消费接线（worktree 三工具挂载 + grantedRoots live 并入） ---------------- */

describe('worktree 服务消费接线（04 §7 补钉①——grantedRoots live callback）', () => {
  it('服务注入：三工具挂载 + create 自动授予 → fence 活取并入可写根（授予路径写放行；修前零挂载零消费即红）', async () => {
    const { rt } = rigRuntime();
    // 授予目录在 HOME 下——缺省三根（workspace + /tmp + tmpdir）之外，fence 并入与否才可观察
    const grantedDir = mkdtempSync(join(homedir(), 'berry-wt-grant-'));
    dirs.push(grantedDir);
    const service = fakeWorktreeService(() => grantedDir);
    const { faux, stack } = rigStack(rt, { worktree: service });
    const backend = new ApproveBackend('approve');
    stack.channels.addBackend(backend);

    const child = stack.manager.create({ origin: 'conversation' });
    // 三工具挂载（04 §7 通用面——服务在场则会话内模型可达；修前零挂载红）
    expect(child.driver.toolNames).toContain('worktree_create');
    expect(child.driver.toolNames).toContain('worktree_list');
    expect(child.driver.toolNames).toContain('worktree_clean');

    // create（自动授予本会话）→ 写授予路径（fence 活取 grantedRoots 并入）
    faux.setResponses([
      () => toolCallOf('t-wt', 'worktree_create', { name: 'issue-1' }),
      () => toolCallOf('t-write', 'write', { path: join(grantedDir, 'out.txt'), content: 'in-wt' }),
      () => messageOf('收口'),
    ]);
    const receipt = await stack.submitText(child.sessionId, '开工');
    expect(receipt).toMatchObject({ status: 'completed' });
    const created = resultOf(child.driver.session.events(), 't-wt');
    expect(created).toBeDefined();
    expect(created!.error).toBeUndefined(); // 三工具经真三段管道执行（修前未知工具即红在前）
    // 修前红位：grantedRoots 零消费 → fence 拒仓外路径（FS_OUTSIDE_WRITABLE_ROOTS）
    expect(readFileSync(join(grantedDir, 'out.txt'), 'utf8')).toBe('in-wt');
    await rt.shutdown();
  });

  it('服务缺席：三工具诚实缺席（会话面无 worktree 词——不虚构）', async () => {
    const { rt } = rigRuntime();
    const { stack } = rigStack(rt); // 不注入 worktree
    const child = stack.manager.create({ origin: 'conversation' });
    expect(child.driver.toolNames).not.toContain('worktree_create');
    expect(child.driver.toolNames).not.toContain('worktree_list');
    expect(child.driver.toolNames).not.toContain('worktree_clean');
    await rt.shutdown();
  });
});
