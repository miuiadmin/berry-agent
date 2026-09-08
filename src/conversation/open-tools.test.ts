/**
 * open 域工具装配测试 — 组装面（exec 诚实缺席/在场）+ 真三段管道执法
 * （审批对放行 / fail-closed 拒 / carve-out 硬拒 / 数据目录恒拒 / fence 分工）+
 * LIFO 拆解 + todo durable 落账。
 *
 * 纪律：mock 只停在 askApproval 呈现注入位（审批装配测试同款恒答桩）；
 * 管道 / 守门 / 审批服务 / 注册表 / fs 工具全走真实现（组合根口径——
 * 04 §7 「管道是唯一执行路径」的结构保证位即本测试的断言对象）。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventDispatch, Scope } from '../context/index.js';
import { SessionLog } from '../session/index.js';
import type { ToolDefinition } from '../contracts/index.js';
import { assembleOpenTools } from './open-tools.js';
import type { OpenToolsOptions } from './open-tools.js';

/* ---------------- 测试构造件 ---------------- */

type AskFace = NonNullable<OpenToolsOptions['askApproval']>;

/** 恒答呈现面（审批装配测试同款） */
const answer =
  (value: Awaited<ReturnType<AskFace>>): AskFace =>
  async () =>
    value;

function makeAssembly(overrides?: Partial<OpenToolsOptions>) {
  const workspace = mkdtempSync(join(tmpdir(), 'berry-open-ws-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'berry-open-data-'));
  const session = new SessionLog({ sessionId: 's-open' });
  const dispatch = new EventDispatch();
  const scope = Scope.createRoot();
  const assembly = assembleOpenTools({
    sessionId: 's-open',
    dispatch,
    session,
    scope,
    mode: () => 'workspace-write',
    dataDir,
    workspace: () => workspace,
    ...overrides,
  });
  return { workspace, dataDir, session, dispatch, scope, assembly };
}

/** 会话事件 data 按类型取列（断言简写） */
function dataOf(session: SessionLog, type: string): unknown[] {
  return session
    .events()
    .filter((event) => event.type === type)
    .map((event) => event.data);
}

/** 按名取工具（组成断言与执行入口共用） */
function toolOf(assembly: ReturnType<typeof assembleOpenTools>, name: string) {
  const tool = assembly.tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`工具 ${name} 不在装配面`);
  return tool;
}

/** exec 服务面假件（结构契约 ExecToolService 的最小实现——组成面专用不执行；批 19a 工厂形） */
function fakeExecService(): { createBashTool: (deps: unknown) => ToolDefinition } {
  return {
    createBashTool: () => ({
      name: 'bash',
      description: '执行 shell 命令',
      parameters: { type: 'object', properties: {} },
      effect: 'write',
      execute: async () => ({ content: [] }),
    }),
  };
}

/* ---------------- 组装面 ---------------- */

describe('assembleOpenTools 组装面', () => {
  it('exec 缺席：fs 四件 + 检索两件 + todo 一件（bash 静默缺席——对话本体仍通）', () => {
    const { assembly } = makeAssembly();
    expect(assembly.tools.map((tool) => tool.name).sort()).toEqual([
      'edit',
      'find',
      'grep',
      'ls',
      'read',
      'todo',
      'write',
    ]);
  });

  it('exec 在场：scope.provide 后装配拾取——8 件含 bash', () => {
    const scope = Scope.createRoot();
    scope.provide('exec', fakeExecService());
    const { assembly } = makeAssembly({ scope });
    expect(assembly.tools.map((tool) => tool.name)).toContain('bash');
    expect(assembly.tools).toHaveLength(8);
  });

  it('一词两册装配序（03 §2.4）：boot 预注册工具词在先——自举注册幂等跳过不炸', () => {
    const pre = new EventDispatch();
    pre.registerEventNames(['tools_pre_execute', 'tools_execute', 'tools_post_execute', 'tools_change']); // 装载批主表镜像预注册（共享 4 词）
    const { assembly } = makeAssembly({ dispatch: pre }); // 后到面自举——跳过已注册词
    expect(assembly.tools.length).toBeGreaterThan(0); // 装配照常完成
    expect(pre.isRegistered('tools_pre_execute')).toBe(true); // 词已达（共享登记）
  });

  it('同 dispatch 多会话装配 → 幂等合法（批 19c-1 语义修正）：哨兵词跳过不炸、两会话工具面各自独立', () => {
    const dispatch = new EventDispatch();
    const first = makeAssembly({ dispatch, sessionId: 's-a' });
    // 二次装配合法形：in-process 子代理真工厂首例（同栈父子两会话各装配一次）。
    // 旧「二次装配 fail-loud」前提随多会话装配废止——同会话重复装配检测归
    // SessionManager records 幂等守卫（sessions.test 哨兵词另锁）
    const second = makeAssembly({ dispatch, sessionId: 's-b' });
    expect(first.assembly.tools.length).toBe(second.assembly.tools.length); // 两会话各自完整工具面
    expect(dispatch.isRegistered('conversation/open-tools-mounted')).toBe(true); // 哨兵词恰一册
  });
});

/* ---------------- 真三段管道执法 ---------------- */

describe('assembleOpenTools 真管道执法', () => {
  it('ls 经真三段管道：读工具放行 + gate/decision allow 落账', async () => {
    const made = makeAssembly();
    writeFileSync(join(made.workspace, 'a.txt'), 'x', 'utf8');
    const result = await toolOf(made.assembly, 'ls').execute('c-ls', { path: '.' });
    const text = result.content[0] as { type: string; text: string };
    expect(text.type).toBe('text');
    expect(text.text).toContain('a.txt');
    expect(result.isError).toBeUndefined();
    expect(dataOf(made.session, 'gate/decision')).toEqual([{ toolCallId: 'c-ls', decision: 'allow', reason: 'ok' }]);
  });

  it('write 审批 approve：真文件落盘 + 审批对成对 + gate/decision allow', async () => {
    const made = makeAssembly({ askApproval: answer('approve') });
    const result = await toolOf(made.assembly, 'write').execute('c-w1', {
      path: 'n1.txt',
      content: 'hi',
    });
    expect(result.isError).toBeUndefined();
    expect(readFileSync(join(made.workspace, 'n1.txt'), 'utf8')).toBe('hi');
    // 审批对：asked/decided 各一笔同 approvalId，decided=approve/user
    const asked = dataOf(made.session, 'approval/asked');
    const decided = dataOf(made.session, 'approval/decided');
    expect(asked).toHaveLength(1);
    expect(decided).toEqual([expect.objectContaining({ decision: 'approve', source: 'user' })]);
    expect((asked[0] as { approvalId: string }).approvalId).toBe((decided[0] as { approvalId: string }).approvalId);
    expect(dataOf(made.session, 'gate/decision')).toEqual([{ toolCallId: 'c-w1', decision: 'allow', reason: 'ok' }]);
  });

  it('askApproval 缺席 write：TOOL_BLOCKED 拒（fail-closed）+ decided unavailable + gate/decision block', async () => {
    const made = makeAssembly();
    await expect(
      toolOf(made.assembly, 'write').execute('c-w2', { path: 'n2.txt', content: 'x' }),
    ).rejects.toMatchObject({ code: 'TOOL_BLOCKED' });
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(1); // 问过——无人应答
    expect(dataOf(made.session, 'approval/decided')).toEqual([expect.objectContaining({ decision: 'unavailable' })]);
    const gate = dataOf(made.session, 'gate/decision');
    expect(gate).toHaveLength(1);
    expect(gate[0]).toMatchObject({ toolCallId: 'c-w2', decision: 'block' });
    expect((gate[0] as { reason: string }).reason).toContain('unavailable');
  });

  it('carve-out 硬拒：danger 档写 .git/config——block 无审批交互（无升权出路）', async () => {
    const made = makeAssembly({ mode: () => 'danger', askApproval: answer('approve') });
    await expect(
      toolOf(made.assembly, 'write').execute('c-git', { path: '.git/config', content: 'x' }),
    ).rejects.toMatchObject({ code: 'TOOL_BLOCKED' });
    // 硬拒在审批之前：零审批对（问了也白问——不存在可批的出路）
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(0);
    expect(dataOf(made.session, 'approval/decided')).toHaveLength(0);
    const gate = dataOf(made.session, 'gate/decision');
    expect(gate[0]).toMatchObject({ toolCallId: 'c-git', decision: 'block' });
    expect((gate[0] as { reason: string }).reason).toContain('carve-out');
  });

  it('数据目录恒拒：写 dataDir 内绝对路径——carve-out 条目任何档生效', async () => {
    const made = makeAssembly({ askApproval: answer('approve') });
    await expect(
      toolOf(made.assembly, 'write').execute('c-data', {
        path: join(made.dataDir, 'x.txt'),
        content: 'x',
      }),
    ).rejects.toMatchObject({ code: 'TOOL_BLOCKED' });
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(0);
    expect((dataOf(made.session, 'gate/decision')[0] as { reason: string }).reason).toContain('carve-out');
  });

  it('读侧 carve-out 装配 e2e：read 点名 dataDir/secret.key → FS_READ_PROTECTED（敏感集注入回归锁——漏注入即红）', async () => {
    const made = makeAssembly();
    writeFileSync(join(made.dataDir, 'secret.key'), 'k3y-material', 'utf8');
    await expect(
      toolOf(made.assembly, 'read').execute('c-sec', { path: join(made.dataDir, 'secret.key') }),
    ).rejects.toMatchObject({ code: 'FS_READ_PROTECTED' });
    // 读脸硬拒无审批交互（04 §7——fail-closed 无审批出路）
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(0);
  });

  it('读侧 carve-out 装配 e2e：grep 单文件点名 secret.key 同拒（检索脸同源注入）', async () => {
    const made = makeAssembly();
    writeFileSync(join(made.dataDir, 'secret.key'), 'k3y-material', 'utf8');
    await expect(
      toolOf(made.assembly, 'grep').execute('c-gsec', {
        pattern: 'k3y',
        path: join(made.dataDir, 'secret.key'),
      }),
    ).rejects.toMatchObject({ code: 'FS_READ_PROTECTED' });
  });

  it('邻件不殃及：dataDir 内非敏感件 read 照常（保护面精确到 basename）', async () => {
    const made = makeAssembly();
    writeFileSync(join(made.dataDir, 'notes.txt'), 'fine', 'utf8');
    const result = await toolOf(made.assembly, 'read').execute('c-note', { path: join(made.dataDir, 'notes.txt') });
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toBe('fine');
  });

  it('read-only 档 write：守门行跳过（不产审批交互），fence 执法拒', async () => {
    const made = makeAssembly({ mode: () => 'read-only', askApproval: answer('approve') });
    await expect(
      toolOf(made.assembly, 'write').execute('c-ro', { path: 'n3.txt', content: 'x' }),
    ).rejects.toMatchObject({ code: 'FS_OUTSIDE_WRITABLE_ROOTS' });
    // 执法分工的落账证据：gate 放行（read-only 不问），fence 拒（denial 回执）
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(0);
    expect(dataOf(made.session, 'gate/decision')).toEqual([{ toolCallId: 'c-ro', decision: 'allow', reason: 'ok' }]);
  });

  it('todo 经真管道：全量快照 durable 落 todo/write 一笔', async () => {
    const made = makeAssembly();
    const items = [
      { status: 'in-progress', content: '接线审批三件' },
      { status: 'pending', content: '落 open 域工具装配' },
    ] as const;
    const result = await toolOf(made.assembly, 'todo').execute('c-todo', { items: [...items] });
    const text = result.content[0] as { text: string };
    expect(text.text).toContain('已更新任务清单');
    const writes = dataOf(made.session, 'todo/write');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ items: [{ status: 'in-progress' }, { status: 'pending' }] });
    expect(dataOf(made.session, 'gate/decision')).toEqual([{ toolCallId: 'c-todo', decision: 'allow', reason: 'ok' }]);
  });
});

/* ---------------- LIFO 拆解 ---------------- */

describe('assembleOpenTools 拆解', () => {
  it('dispose 后 write 直通：守门已拆（无审批对），文件照落', async () => {
    const made = makeAssembly({ askApproval: answer('approve') });
    made.assembly.dispose();
    const result = await toolOf(made.assembly, 'write').execute('c-after', {
      path: 'n4.txt',
      content: 'after',
    });
    expect(result.isError).toBeUndefined();
    expect(readFileSync(join(made.workspace, 'n4.txt'), 'utf8')).toBe('after');
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(0);
    expect(dataOf(made.session, 'approval/decided')).toHaveLength(0);
  });
});

/* ---------------- 出口消毒（出口治理③） ---------------- */

describe('assembleOpenTools 出口消毒', () => {
  it('read 工具回读含 env dump 的文件：值基腿经装配透传执法——结果进 durable 前已消毒（server 回显单源锁）', async () => {
    const secret = 'sk-e2e-live-abcdef90';
    const made = makeAssembly({ sensitiveValues: () => [secret] });
    writeFileSync(
      join(made.workspace, 'env-dump.txt'),
      `GITHUB_TOKEN=ghp_abcdef123456\nlive=${secret}\nnormal=ok\n`,
      'utf8',
    );
    const result = await toolOf(made.assembly, 'read').execute('c-read-sec', { path: 'env-dump.txt' });
    const text = result.content[0] as { type: string; text: string };
    expect(text.type).toBe('text');
    // 两腿合流：模式腿收具名形（GITHUB_TOKEN=），值基腿收裸形（live=）
    expect(text.text).toContain('GITHUB_TOKEN=[REDACTED:secret]');
    expect(text.text).toContain('live=[REDACTED:credential]');
    expect(text.text).not.toContain('ghp_abcdef123456');
    expect(text.text).not.toContain(secret);
    expect(text.text).toContain('normal=ok'); // 非敏感行零误伤
  });

  it('provider 缺席（缺省装配）：模式腿恒在场——具名形仍消毒', async () => {
    const made = makeAssembly();
    writeFileSync(join(made.workspace, 'env2.txt'), 'GITHUB_TOKEN=ghp_abcdef123456\n', 'utf8');
    const result = await toolOf(made.assembly, 'read').execute('c-read-sec2', { path: 'env2.txt' });
    const text = result.content[0] as { type: string; text: string };
    expect(text.text).toContain('GITHUB_TOKEN=[REDACTED:secret]');
    expect(text.text).not.toContain('ghp_abcdef123456');
  });
});
