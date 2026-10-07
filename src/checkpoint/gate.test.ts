/**
 * gate 测试——pre-mutation 守门监听器语义回归锁（05 §5.3 批 15d）：
 * effect/read 放行、无会话放行、无锚放行+warn 两分、per-run 边界游标
 * （同 run 不重拍/推进触发新拍）、捕获失败 fail-closed block、拍摄前屏障
 * （05 §5.3 D② 治本批——drain seam 排干先于拍摄/排干失败同折 block）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GateInput, ToolDefinition } from '../contracts/index.js';
import { CHECKPOINT_SESSION_CURSOR_CAP, createCheckpointGate } from './gate.js';
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

  it('per-session 游标逐出帽——超帽逐最旧，被逐会话同 run 再写重拍（防长开无界累积）', async () => {
    const cap = fakeCapture();
    const contexts = new Map<string, { lastClosedBoundary: number; workspaceRoot: string }>();
    const face: SessionContextFace = { contextOf: (id) => contexts.get(id) };
    const gate = createCheckpointGate({ capture: cap.fn, session: face });
    // 填帽 + 1 个新会话——第 CAP+1 个入册时最旧的 s0 被逐（帽值单源 = gate.ts 常量）
    const last = `s${CHECKPOINT_SESSION_CURSOR_CAP}`;
    for (let i = 0; i <= CHECKPOINT_SESSION_CURSOR_CAP; i++) {
      contexts.set(`s${i}`, { lastClosedBoundary: 1, workspaceRoot: '/ws' });
      await gate(input('write', `s${i}`), pass);
    }
    expect(cap.calls).toHaveLength(CHECKPOINT_SESSION_CURSOR_CAP + 1);
    // s0 已被逐（游标缺席）——同 run 段（边界不动）再触发写工具 = 重拍
    await gate(input('write', 's0'), pass);
    expect(cap.calls).toHaveLength(CHECKPOINT_SESSION_CURSOR_CAP + 2);
    // 帽内最近会话不逐——同 run 段不重拍
    await gate(input('write', last), pass);
    expect(cap.calls).toHaveLength(CHECKPOINT_SESSION_CURSOR_CAP + 2);
  });
});

describe('拍摄前屏障（05 §5.3 D② 治本批——drain seam）', () => {
  it('drain 在场：对判据会话先排干后拍摄（boundarySeq 拍下即有 durable 承载——修前红：drain 永不被调）', async () => {
    const cap = fakeCapture();
    const order: string[] = [];
    const gate = createCheckpointGate({
      // capture 经包装记序（drain 与 capture 同册断言调用序）
      capture: async (inp) => {
        order.push('capture');
        return cap.fn(inp);
      },
      session: fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' }).face,
      drain: (sessionId) => {
        order.push(`drain:${sessionId}`);
      },
    });
    await gate(input('write', 's1'), pass);
    // 序断言：排干先行——活体边界可领先 durable 日志，先排干才保「拍下即有承载」
    expect(order).toEqual(['drain:s1', 'capture']);
    expect(cap.calls).toHaveLength(1);
  });

  it('边界未推进（同 run 段）不排干不拍——屏障只在拍摄位（判据 4 之后）', async () => {
    const cap = fakeCapture();
    const drain = vi.fn();
    const gate = createCheckpointGate({
      capture: cap.fn,
      session: fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' }).face,
      drain,
    });
    await gate(input('write', 's1'), pass); // 首拍（排干一次）
    expect(drain).toHaveBeenCalledTimes(1);
    drain.mockClear();
    cap.calls.length = 0;
    await gate(input('write', 's1'), pass); // 同边界 = 同 run 段——不重拍不排干
    expect(drain).not.toHaveBeenCalled();
    expect(cap.calls).toEqual([]);
  });

  it('read 工具/无会话键不触排干（屏障只在写意图的会话拍摄位）', async () => {
    const drain = vi.fn();
    const gate = createCheckpointGate({
      capture: fakeCapture().fn,
      session: fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' }).face,
      drain,
    });
    await gate(input('read', 's1'), pass);
    await gate(input('write'), pass); // 无 sessionId
    expect(drain).not.toHaveBeenCalled();
  });

  it('drain 抛错折 fail-closed block（码复用 CHECKPOINT_CAPTURE_FAILED——排干失败与拍摄失败同构语义）、capture 不被调（修前红：无此路径恒放行）', async () => {
    const cap = fakeCapture();
    const gate = createCheckpointGate({
      capture: cap.fn,
      session: fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' }).face,
      drain: () => {
        throw new Error('PERSIST_WRITE_EXHAUSTED：写链已熔断');
      },
    });
    const out = await gate(input('write', 's1'), pass);
    expect(pass).not.toHaveBeenCalled(); // 短路——拍不了 durable 一致的快照即拒变异
    expect(cap.calls).toEqual([]); // 排干失败不得进拍摄
    expect(out.outcome).toMatchObject({ action: 'block' });
    expect(out.outcome?.action === 'block' && out.outcome.reason.startsWith('[CHECKPOINT_CAPTURE_FAILED]')).toBe(true);
  });

  it('drain 缺席（不传）= 诚实降级：拍摄照常（无持久化环境的测试形态）', async () => {
    const cap = fakeCapture();
    const gate = createCheckpointGate({
      capture: cap.fn,
      session: fakeSession({ lastClosedBoundary: 5, workspaceRoot: '/ws' }).face,
    });
    const out = await gate(input('write', 's1'), pass);
    expect(pass).toHaveBeenCalledTimes(1); // 放行
    expect(cap.calls).toHaveLength(1); // 拍照常
    expect(out.outcome).toBeUndefined();
  });
});
