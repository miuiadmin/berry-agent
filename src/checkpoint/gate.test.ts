/**
 * gate 测试——pre-mutation 守门监听器语义回归锁（05 §5.3 批 15d）：
 * effect/read 放行、无会话放行、无锚放行+warn 两分、per-run 边界游标
 * （同 run 不重拍/推进触发新拍）、捕获失败 fail-closed block。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateInput, ToolDefinition } from '../contracts/index.js';
import { createCheckpointGate } from './gate.js';
import type { CheckpointManifest, CheckpointTrigger, SessionContextFace } from './types.js';

/** 工具定义快捷形（effect 面） */
function tool(effect: 'read' | 'write' | undefined): ToolDefinition {
  return {
    name: 'demo',
    description: 'demo',
    parameters: { type: 'object', properties: {} },
    ...(effect !== undefined ? { effect } : {}),
    execute: async () => ({ content: [] }),
  };
}

/** 载荷快捷形 */
function input(effect: 'read' | 'write' | undefined, sessionId?: string): GateInput {
  return {
    tool: tool(effect),
    args: {},
    toolCallId: 'call-1',
    mutated: false,
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
}

/** 直通 next（放行断言基线——next 被调 = 放行） */
const pass = vi.fn(async (v: GateInput) => v);

beforeEach(() => {
  pass.mockClear();
});

/** 会话语境可变假件 */
function fakeSession(ctx: { lastClosedBoundary: number; workspaceRoot: string } | undefined) {
  const face: SessionContextFace = { contextOf: () => ctx };
  return { face, set: (next: typeof ctx) => (ctx = next === undefined ? undefined : { ...next }) };
}

/** 捕获假件（调用记录 + 可编程失败） */
function fakeCapture(opts: { fail?: boolean } = {}) {
  const calls: Array<{ sessionId: string; boundarySeq: number; workspaceRoot: string; trigger: CheckpointTrigger }> =
    [];
  const fn = async (inp: {
    sessionId: string;
    boundarySeq: number;
    workspaceRoot: string;
    trigger: CheckpointTrigger;
  }) => {
    if (opts.fail) throw new Error('磁盘满');
    calls.push(inp);
    const m: CheckpointManifest = {
      id: `m${calls.length}`,
      sessionId: inp.sessionId,
      boundarySeq: inp.boundarySeq,
      workspaceRoot: inp.workspaceRoot,
      capturedAt: calls.length,
      trigger: inp.trigger,
      files: [],
    };
    return m;
  };
  return { fn, calls };
}

describe('createCheckpointGate 守门语义', () => {
  it('read 工具放行不拍（effect 面——零名单）', async () => {
    const cap = fakeCapture();
    const gate = createCheckpointGate({
      capture: cap.fn,
      session: fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' }).face,
    });
    const out = await gate(input('read', 's1'), pass);
    expect(pass).toHaveBeenCalledTimes(1);
    expect(cap.calls).toEqual([]);
    expect(out.outcome).toBeUndefined();
  });

  it('缺省 effect（read）放行不拍', async () => {
    const cap = fakeCapture();
    const gate = createCheckpointGate({
      capture: cap.fn,
      session: fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' }).face,
    });
    await gate(input(undefined, 's1'), pass);
    expect(cap.calls).toEqual([]);
  });

  it('无 sessionId 放行不拍（系统/测试调用形态）', async () => {
    const cap = fakeCapture();
    const warn = vi.fn();
    const gate = createCheckpointGate({
      capture: cap.fn,
      session: fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' }).face,
      warn,
    });
    await gate(input('write'), pass);
    expect(cap.calls).toEqual([]);
    expect(warn).not.toHaveBeenCalled(); // 静默放行（非配置缺口）
  });

  it('会话语境不可解放行不拍不警（装配面事实）', async () => {
    const cap = fakeCapture();
    const warn = vi.fn();
    const gate = createCheckpointGate({ capture: cap.fn, session: fakeSession(undefined).face, warn });
    await gate(input('write', 'unknown-session'), pass);
    expect(cap.calls).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('无 workspaceRoot 锚 = 放行 + warn（配置缺口两分）', async () => {
    const cap = fakeCapture();
    const warn = vi.fn();
    const gate = createCheckpointGate({
      capture: cap.fn,
      session: fakeSession({ lastClosedBoundary: 5, workspaceRoot: '' }).face,
      warn,
    });
    const out = await gate(input('write', 's1'), pass);
    expect(pass).toHaveBeenCalledTimes(1);
    expect(cap.calls).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(out.outcome).toBeUndefined();
  });

  it('首次 write 拍 + 后续同边界（同 run）不重拍', async () => {
    const cap = fakeCapture();
    const session = fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' });
    const gate = createCheckpointGate({ capture: cap.fn, session: session.face });
    await gate(input('write', 's1'), pass);
    await gate(input('write', 's1'), pass);
    await gate(input('write', 's1'), pass);
    expect(cap.calls).toHaveLength(1);
    expect(cap.calls[0]).toMatchObject({ sessionId: 's1', boundarySeq: 5, workspaceRoot: '/ws', trigger: 'mutation' });
  });

  it('turn 闭合后边界推进——新 run 首变异触发新拍（per-run 一 manifest）', async () => {
    const cap = fakeCapture();
    const session = fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' });
    const gate = createCheckpointGate({ capture: cap.fn, session: session.face });
    await gate(input('write', 's1'), pass);
    session.set({ lastClosedBoundary: 9, workspaceRoot: '/ws' });
    await gate(input('write', 's1'), pass);
    session.set({ lastClosedBoundary: 9, workspaceRoot: '/ws' }); // 同 run 第二变异
    await gate(input('write', 's1'), pass);
    expect(cap.calls).toHaveLength(2);
    expect(cap.calls[1]!.boundarySeq).toBe(9);
  });

  it('首拍边界可为 -1（无闭合轮——run 在飞形态）且不重复', async () => {
    const cap = fakeCapture();
    const session = fakeSession({ lastClosedBoundary: -1, workspaceRoot: '/ws' });
    const gate = createCheckpointGate({ capture: cap.fn, session: session.face });
    await gate(input('write', 's1'), pass);
    await gate(input('write', 's1'), pass);
    expect(cap.calls).toHaveLength(1);
    expect(cap.calls[0]!.boundarySeq).toBe(-1);
  });

  it('多会话游标分立（互不串 run）', async () => {
    const cap = fakeCapture();
    const contexts = new Map<string, { lastClosedBoundary: number; workspaceRoot: string }>([
      ['s1', { lastClosedBoundary: 1, workspaceRoot: '/ws' }],
      ['s2', { lastClosedBoundary: 1, workspaceRoot: '/ws' }],
    ]);
    const face: SessionContextFace = { contextOf: (id) => contexts.get(id) };
    const gate = createCheckpointGate({ capture: cap.fn, session: face });
    await gate(input('write', 's1'), pass);
    await gate(input('write', 's2'), pass); // s2 边界同值但游标分立——仍拍
    contexts.set('s2', { lastClosedBoundary: 2, workspaceRoot: '/ws' });
    await gate(input('write', 's2'), pass); // s2 推进——新拍
    expect(cap.calls).toHaveLength(3);
  });

  it('捕获失败 fail-closed block（reason 首缀专属码、不调 next）', async () => {
    const cap = fakeCapture({ fail: true });
    const gate = createCheckpointGate({
      capture: cap.fn,
      session: fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' }).face,
    });
    const payload = input('write', 's1');
    const out = await gate(payload, pass);
    expect(pass).not.toHaveBeenCalled(); // 短路——block 语义
    expect(out.outcome).toMatchObject({ action: 'block' });
    expect(out.outcome?.action === 'block' && out.outcome.reason.startsWith('[CHECKPOINT_CAPTURE_FAILED]')).toBe(true);
  });

  it('捕获失败后游标不推进——同 run 下一写重试拍', async () => {
    const cap = fakeCapture({ fail: true });
    const gate = createCheckpointGate({
      capture: cap.fn,
      session: fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' }).face,
    });
    await gate(input('write', 's1'), pass);
    const second = await gate(input('write', 's1'), pass);
    expect(second.outcome).toMatchObject({ action: 'block' }); // 重试（游标未进）
  });
});
