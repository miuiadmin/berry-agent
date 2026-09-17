/**
 * /sandbox 三面单源 per-session 翻换测试（2026-09-17 会话档位切换面批 F2——
 * 立项档测试计划 4/5/8 sandbox 半边）。
 *
 * 锁的机制：取档真源 = OpenToolsOptions.mode 单源闭包喂三执法消费面
 * （fs fence / 守门行 / bash currentMode）——per-session 经 ToolContext.sessionId
 * 穿线（M1 裁决：管道签名本有，消费面沿调用链显式补传；boot 解析值恒作
 * fold 基线〔M2——会话无切档事件时恒 boot 解析值〕）。禁止只翻 bash 侧
 * （执法分裂——冷读 IMPL-F1 定谳）。
 *
 * 纪律：mock 只停在 askApproval 呈现注入位（恒答桩）；管道 / 守门 / 审批
 * 服务 / 注册表 / fs 工具全走真实现（组合根口径）；fold 用 safety 既有
 * resolveEffectiveMode 局部构式（conversation-stack 装配位同构表达式——
 * 单源闭包在 createDriver 内闭包自有 session）。
 *
 * 覆盖锁（修前必红——消费面今天不问 sessionId，闭包收到 undefined 恒走
 * boot 腿，per-session 断言即红）：
 *  - 三面齐动：切 read-only 后 write 被守门让棒 + fence 拒（FS_OUTSIDE_
 *    WRITABLE_ROOTS + 零审批交互）；
 *  - 多会话隔离：两会话异档各自执法；
 *  - 缺席 fallback 恒 boot 解析值（M2——danger boot 不被吞，回归锁形）；
 *  - 坏词 fail-loud 工具位：守门行 fold 抛 → 管道 fail-closed 拒执行；
 *  - 升权缓存收紧向失效：workspace-write 下 always 已批同指纹，切 read-only
 *    后不复活写执行（档位判定先于缓存查询——gate read-only skip 位在一切
 *    粘性/策略表咨询之前）；条目与粘性不随切档清（往返后免问面复活）。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventDispatch, Scope } from '../context/index.js';
import { SessionLog } from '../session/index.js';
import { resolveEffectiveMode } from '../safety/index.js';
import type { SandboxMode } from '../safety/index.js';
import { assembleOpenTools } from './open-tools.js';
import type { OpenToolsOptions } from './open-tools.js';

/* ---------------- 测试构造件（open-tools.test 同族装配台） ---------------- */

type AskFace = NonNullable<OpenToolsOptions['askApproval']>;

/** 恒答呈现面（open-tools.test 同款） */
const answer =
  (value: Awaited<ReturnType<AskFace>>): AskFace =>
  async () =>
    value;

/**
 * 局部 fold（conversation-stack 装配位同构表达式）：预过滤 sandbox/mode
 * 事件 → safety resolveEffectiveMode（全量正扫坏词抛）+ 显式传 boot。
 * 纯逻辑细节由 session-mode.test 另锁——本文件只锁穿线与执法面。
 */
function foldSandbox(events: readonly { type: string; data: unknown }[], boot: SandboxMode): SandboxMode {
  return resolveEffectiveMode(
    events
      .filter((event) => event.type === 'sandbox/mode')
      .map((event) => {
        const data = event.data as { mode?: string } | null;
        return { mode: typeof data?.mode === 'string' ? data.mode : '' };
      }),
    boot,
  );
}

/**
 * 单源闭包（conversation-stack createDriver 装配位同构表达式——恒折本会话）：
 * per-session 装配下闭包自有 session，收到键与否同折本会话事件流；boot
 * 解析值 = fold 基线（无切档事件时恒 boot——M2「fallback 恒 boot 解析值」
 * 的落位 = fold 基线形参，非闭包分支位）。
 */
function modeClosure(session: SessionLog, boot: SandboxMode): (sessionId?: string) => SandboxMode {
  return (_sessionId?: string) => foldSandbox(session.events(), boot);
}

/** 装配台：mode 闭包按装配位同构表达式注入（三消费面同单源的断言前提） */
function makeSession(options: {
  sessionId: string;
  boot?: SandboxMode;
  dispatch?: EventDispatch;
  askApproval?: AskFace;
  persistToolPolicy?: OpenToolsOptions['persistToolPolicy'];
}) {
  const workspace = mkdtempSync(join(tmpdir(), 'berry-sb-ws-'));
  const dataDir = mkdtempSync(join(tmpdir(), 'berry-sb-data-'));
  const session = new SessionLog({ sessionId: options.sessionId });
  const boot = options.boot ?? 'workspace-write';
  const assembly = assembleOpenTools({
    sessionId: options.sessionId,
    dispatch: options.dispatch ?? new EventDispatch(),
    session,
    scope: Scope.createRoot(),
    mode: modeClosure(session, boot),
    dataDir,
    workspace: () => workspace,
    ...(options.askApproval !== undefined ? { askApproval: options.askApproval } : {}),
    ...(options.persistToolPolicy !== undefined ? { persistToolPolicy: options.persistToolPolicy } : {}),
  });
  return { workspace, dataDir, session, assembly, boot };
}

/** 会话事件 data 按类型取列（断言简写） */
function dataOf(session: SessionLog, type: string): unknown[] {
  return session
    .events()
    .filter((event) => event.type === type)
    .map((event) => event.data);
}

/** 按名取工具（注册面 agentToolsFor 已绑 sessionId——管道穿线的真源） */
function toolOf(assembly: ReturnType<typeof assembleOpenTools>, name: string) {
  const tool = assembly.tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`工具 ${name} 不在装配面`);
  return tool;
}

/* ---------------- 三面单源 per-session 翻换 ---------------- */

describe('sandbox 档位 · 三面单源 per-session 翻换', () => {
  it('切 read-only 后三面齐动：守门行让棒（零审批交互）+ fence 拒写', async () => {
    const made = makeSession({ sessionId: 's-ro', askApproval: answer('approve') });
    made.session.append('sandbox/mode', { mode: 'read-only' });
    await expect(toolOf(made.assembly, 'write').execute('c-ro', { path: 'n.txt', content: 'x' })).rejects.toMatchObject(
      { code: 'FS_OUTSIDE_WRITABLE_ROOTS' },
    );
    // 执法分工落账证据：read-only 档 gate 让棒放行（不问），fence 执法拒
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(0);
    expect(dataOf(made.session, 'gate/decision')).toEqual([{ toolCallId: 'c-ro', decision: 'allow', reason: 'ok' }]);
  });

  it('edit 补丁同受 fence（S4——fs 第二写入位随档）：切 read-only 后 Add File 补丁拒', async () => {
    const made = makeSession({ sessionId: 's-edit', askApproval: answer('approve') });
    // 基线：boot workspace-write 下 Add File 补丁照落（修前红锚——fence 不问
    // sessionId 时 read-only 也照落的缺陷形即在此翻红）
    const ok = await toolOf(made.assembly, 'edit').execute('c-e0', {
      patch: '*** Begin Patch\n*** Add File: base.txt\n+hello\n*** End Patch',
    });
    expect(ok.isError).toBeUndefined();
    made.session.append('sandbox/mode', { mode: 'read-only' });
    await expect(
      toolOf(made.assembly, 'edit').execute('c-e1', {
        patch: '*** Begin Patch\n*** Add File: n.txt\n+x\n*** End Patch',
      }),
    ).rejects.toMatchObject({ code: 'FS_OUTSIDE_WRITABLE_ROOTS' });
  });

  it('多会话隔离：同 dispatch 两会话异档各自执法（s1 read-only 拒 / s2 照写）', async () => {
    const dispatch = new EventDispatch();
    const s1 = makeSession({ sessionId: 's-iso-1', dispatch, askApproval: answer('approve') });
    const s2 = makeSession({ sessionId: 's-iso-2', dispatch, askApproval: answer('approve') });
    s1.session.append('sandbox/mode', { mode: 'read-only' });
    await expect(toolOf(s1.assembly, 'write').execute('c-1', { path: 'a.txt', content: 'x' })).rejects.toMatchObject({
      code: 'FS_OUTSIDE_WRITABLE_ROOTS',
    });
    const ok = await toolOf(s2.assembly, 'write').execute('c-2', { path: 'b.txt', content: 'y' });
    expect(ok.isError).toBeUndefined();
    expect(readFileSync(join(s2.workspace, 'b.txt'), 'utf8')).toBe('y');
    // 隔离不串审批：s2 的写照走审批对（s1 的 read-only 不影响他会话）
    expect(dataOf(s2.session, 'approval/asked')).toHaveLength(1);
  });

  it('缺席 fallback 恒 boot 解析值：boot=danger（settings 显式授权形）不被缺省吞（M2 回归锁）', async () => {
    // 写 HOME 下探针（workspace/tmp 三根之外——workspace-write 必拒、danger [sep] 放行）
    const probe = join(homedir(), `berry-f2-boot-probe-${Date.now()}.txt`);
    try {
      const made = makeSession({ sessionId: 's-boot', boot: 'danger', askApproval: answer('approve') });
      // 无切档事件：fold 空 → 恒 boot=danger——「非 danger」缺省误用即红
      const result = await toolOf(made.assembly, 'write').execute('c-boot', { path: probe, content: 'p' });
      expect(result.isError).toBeUndefined();
      expect(readFileSync(probe, 'utf8')).toBe('p');
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it('坏词 fail-loud 工具位：fold 抛 → 管道 fail-closed 拒执行（TOOL_GATE_FAILED 携档位非法文）', async () => {
    const made = makeSession({ sessionId: 's-badword', askApproval: answer('approve') });
    made.session.append('sandbox/mode', { mode: 'ULTRA' }); // 持久层坏行形
    await expect(
      toolOf(made.assembly, 'write').execute('c-bad', { path: 'n.txt', content: 'x' }),
    ).rejects.toMatchObject({
      code: 'TOOL_GATE_FAILED',
      // BaseError message 不含码前缀——锚 SANDBOX_MODE_INVALID 的人读文
      message: expect.stringContaining('sandbox/mode 事件档位非法'),
    });
  });
});

/* ---------------- 升权缓存收紧向失效（立项档测试计划 8 sandbox 半边） ---------------- */

describe('sandbox 档位 · 升权缓存收紧向失效', () => {
  it('workspace-write→read-only 后同指纹已批写不复活；条目/粘性不随切档清（往返免问面存活）', async () => {
    const entries: { tool: string; pattern: string }[] = [];
    const made = makeSession({
      sessionId: 's-sticky',
      askApproval: answer('always'),
      persistToolPolicy: (draft) => entries.push({ tool: draft.tool, pattern: draft.pattern }),
    });
    // ① workspace-write 首写：always 答批 → 条目落账 + 会话粘性入账
    const first = await toolOf(made.assembly, 'write').execute('c-s1', { path: 't.txt', content: '1' });
    expect(first.isError).toBeUndefined();
    expect(entries).toHaveLength(1);
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(1);
    // ② 同指纹二写：粘性短路——免问放行（无第二笔审批对）
    const second = await toolOf(made.assembly, 'write').execute('c-s2', { path: 't.txt', content: '2' });
    expect(second.isError).toBeUndefined();
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(1);
    // ③ 收紧向：切 read-only 后同目标写不复活——档位判定（gate read-only
    //    skip 位）先于一切缓存/策略表咨询，fence 空根执法拒
    made.session.append('sandbox/mode', { mode: 'read-only' });
    await expect(toolOf(made.assembly, 'write').execute('c-s3', { path: 't.txt', content: '3' })).rejects.toMatchObject(
      { code: 'FS_OUTSIDE_WRITABLE_ROOTS' },
    );
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(1); // 无新问
    // ④ 切回 workspace-write：粘性与条目不随切档清——免问面存活（第三写仍零新问）
    made.session.append('sandbox/mode', { mode: 'workspace-write' });
    const fourth = await toolOf(made.assembly, 'write').execute('c-s4', { path: 't.txt', content: '4' });
    expect(fourth.isError).toBeUndefined();
    expect(dataOf(made.session, 'approval/asked')).toHaveLength(1);
    expect(readFileSync(join(made.workspace, 't.txt'), 'utf8')).toBe('4');
  });
});
