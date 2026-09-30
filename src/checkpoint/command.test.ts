/**
 * command 测试——/rewind 处理器（/goal 同族 idiom：argv → 人读文本、
 * BaseError 折文本不抛；三动词 + 守卫错直呈）。
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runRewindCommand, REWIND_USAGE } from './command.js';
import { createCapture } from './capture.js';
import { openCheckpointStore, type CheckpointStore } from './store.js';
import type { RewindForkFace, SessionContextFace } from './types.js';

let dataDir: string;
let ws: string;
let store: CheckpointStore;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'berry-rewind-cmd-data-'));
  ws = await mkdtemp(join(tmpdir(), 'berry-rewind-cmd-ws-'));
  store = openCheckpointStore(dataDir);
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
  await rm(ws, { recursive: true, force: true });
});

/** 恒放行 fork 假件 */
const fork: RewindForkFace = { fork: async () => ({ status: 'forked', sessionId: 'new-session' }) };

/** 命令依赖快捷形 */
function deps(session: SessionContextFace, sessionId = 's1') {
  return { store, fork, session, sessionId };
}

describe('runRewindCommand', () => {
  it('无参/help = 用法文本', async () => {
    expect(await runRewindCommand([], deps({ contextOf: () => undefined }))).toBe(REWIND_USAGE);
    expect(await runRewindCommand(['help'], deps({ contextOf: () => undefined }))).toBe(REWIND_USAGE);
  });

  it('未知动词 = 提示 + 用法', async () => {
    const out = await runRewindCommand(['fly'], deps({ contextOf: () => undefined }));
    expect(out).toContain('未知动词「fly」');
    expect(out).toContain(REWIND_USAGE);
  });

  it('list：无工作区锚的诚实回执', async () => {
    const out = await runRewindCommand(
      ['list'],
      deps({ contextOf: () => ({ lastClosedBoundary: 0, workspaceRoot: '' }) }),
    );
    expect(out).toContain('无工作区锚');
  });

  it('list：列本工作区回退点（新在前）且过滤他工作区', async () => {
    const wsOther = await mkdtemp(join(tmpdir(), 'berry-rewind-cmd-other-'));
    const capture = createCapture(store, { now: () => 1_000, newId: () => 'm-first' });
    await capture({ sessionId: 's1', boundarySeq: 2, workspaceRoot: ws, trigger: 'mutation' });
    await writeFile(join(ws, 'a.txt'), 'x', 'utf8'); // 撑起第二条有文件的
    const capture2 = createCapture(store, { now: () => 2_000, newId: () => 'm-second' });
    await capture2({ sessionId: 's1', boundarySeq: 5, workspaceRoot: ws, trigger: 'mutation' });
    // 他工作区 manifest——不该出现
    await createCapture(store, { now: () => 3_000, newId: () => 'm-other' })({
      sessionId: 's9',
      boundarySeq: 0,
      workspaceRoot: wsOther,
      trigger: 'mutation',
    });
    const out = await runRewindCommand(
      ['list'],
      deps({ contextOf: () => ({ lastClosedBoundary: 5, workspaceRoot: ws }) }),
    );
    expect(out).toContain('m-second');
    expect(out).toContain('m-first');
    expect(out).not.toContain('m-other');
    expect(out).toContain('变异前拍');
  });

  it('preview：对账三账 + 确认指引', async () => {
    await writeFile(join(ws, 'a.txt'), 'v1', 'utf8');
    await createCapture(store, { now: () => 1_000, newId: () => 'snap01' })({
      sessionId: 's1',
      boundarySeq: 3,
      workspaceRoot: ws,
      trigger: 'mutation',
    });
    await writeFile(join(ws, 'a.txt'), 'v2', 'utf8');
    await mkdir(join(ws, 'extra'), { recursive: true });
    await writeFile(join(ws, 'extra/new.txt'), 'n', 'utf8');
    const out = await runRewindCommand(
      ['preview', 'snap01'],
      deps({ contextOf: () => ({ lastClosedBoundary: 3, workspaceRoot: ws }) }),
    );
    expect(out).toContain('恢复 1 · 删除 1 · 不动 0');
    expect(out).toContain('/rewind restore snap01');
    expect(out).toContain('seq=3');
  });

  it('restore：三步序回执 + fork 会话 id', async () => {
    await writeFile(join(ws, 'a.txt'), 'v1', 'utf8');
    await createCapture(store, { now: () => 1_000, newId: () => 'snap01' })({
      sessionId: 's1',
      boundarySeq: 3,
      workspaceRoot: ws,
      trigger: 'mutation',
    });
    await writeFile(join(ws, 'a.txt'), 'v2', 'utf8');
    const out = await runRewindCommand(
      ['restore', 'snap01'],
      deps({ contextOf: () => ({ lastClosedBoundary: 3, workspaceRoot: ws }) }),
    );
    expect(out).toContain('恢复 1 · 删除 0 · 不动 0');
    expect(out).toContain('new-session');
    expect(out).toContain('保底快照');
    // 文件真恢复
    expect(await import('node:fs/promises').then((fs) => fs.readFile(join(ws, 'a.txt'), 'utf8'))).toBe('v1');
  });

  it('restore：veto 折诚实回执（文件已恢复字样）', async () => {
    await writeFile(join(ws, 'a.txt'), 'v1', 'utf8');
    await createCapture(store, { now: () => 1_000, newId: () => 'snap01' })({
      sessionId: 's1',
      boundarySeq: 3,
      workspaceRoot: ws,
      trigger: 'mutation',
    });
    await writeFile(join(ws, 'a.txt'), 'v2', 'utf8');
    const vetoFork: RewindForkFace = { fork: async () => ({ status: 'vetoed', reason: '在飞' }) };
    const out = await runRewindCommand(['restore', 'snap01'], {
      store,
      fork: vetoFork,
      session: { contextOf: () => ({ lastClosedBoundary: 3, workspaceRoot: ws }) },
      sessionId: 's1',
    });
    expect(out).toContain('fork 未成');
    expect(out).toContain('在飞');
  });

  it('坏 id = NOT_FOUND 折文本（不抛）', async () => {
    const out = await runRewindCommand(
      ['preview', 'ghost'],
      deps({ contextOf: () => ({ lastClosedBoundary: 0, workspaceRoot: ws }) }),
    );
    expect(out).toContain('CHECKPOINT_NOT_FOUND');
  });

  it('restore：跨工作区回退点 = fail-loud 拒（发起会话锚 ≠ 回退点锚——防误靶）', async () => {
    const wsA = await mkdtemp(join(tmpdir(), 'berry-rewind-cmd-wsA-'));
    try {
      // 工作区 A 的回退点 + 快照后变异（若误执行会被回写 v1）
      await writeFile(join(wsA, 'a.txt'), 'v1', 'utf8');
      await createCapture(store, { now: () => 1_000, newId: () => 'snapA' })({
        sessionId: 'sA',
        boundarySeq: 3,
        workspaceRoot: wsA,
        trigger: 'mutation',
      });
      await writeFile(join(wsA, 'a.txt'), 'v2', 'utf8');
      // 工作区 B 的会话误贴 A 的 id 发起 restore
      const out = await runRewindCommand(['restore', 'snapA'], {
        store,
        fork,
        session: { contextOf: () => ({ lastClosedBoundary: 5, workspaceRoot: ws }) },
        sessionId: 'sB',
      });
      expect(out).toContain('不属于当前会话工作区');
      // A 的文件零触碰（误靶零执行——修前：被恢复回 v1 且回执「已回退」）
      expect(await readFile(join(wsA, 'a.txt'), 'utf8')).toBe('v2');
    } finally {
      await rm(wsA, { recursive: true, force: true });
    }
  });

  it('preview：跨工作区回退点同拒（只读面同判——预演也不越区对账）', async () => {
    const wsA = await mkdtemp(join(tmpdir(), 'berry-rewind-cmd-wsA2-'));
    try {
      await writeFile(join(wsA, 'a.txt'), 'v1', 'utf8');
      await createCapture(store, { now: () => 1_000, newId: () => 'snapA2' })({
        sessionId: 'sA',
        boundarySeq: 3,
        workspaceRoot: wsA,
        trigger: 'mutation',
      });
      const out = await runRewindCommand(['preview', 'snapA2'], {
        store,
        fork,
        session: { contextOf: () => ({ lastClosedBoundary: 5, workspaceRoot: ws }) },
        sessionId: 'sB',
      });
      expect(out).toContain('不属于当前会话工作区');
    } finally {
      await rm(wsA, { recursive: true, force: true });
    }
  });

  it('缺 id = 用法提示', async () => {
    const out = await runRewindCommand(['preview'], deps({ contextOf: () => undefined }));
    expect(out).toContain('缺回退点 id');
  });

  // —— 批3（2026-09-30 会话管理命令批——05 §5.3 翻案笔）——

  it('restore：fork 成功后 adoptSession 切前台（参数=forkedSessionId——修前：位缺席不被调）', async () => {
    await writeFile(join(ws, 'a.txt'), 'v1', 'utf8');
    await createCapture(store, { now: () => 1_000, newId: () => 'snap01' })({
      sessionId: 's1',
      boundarySeq: 3,
      workspaceRoot: ws,
      trigger: 'mutation',
    });
    await writeFile(join(ws, 'a.txt'), 'v2', 'utf8');
    const adoptCalls: string[] = [];
    // spread 形进 deps（excess-property 不触发——修前位缺席 vitest 可跑、tsc 干净）
    const extra = { adoptSession: async (id: string) => void adoptCalls.push(id) };
    const out = await runRewindCommand(['restore', 'snap01'], {
      ...deps({ contextOf: () => ({ lastClosedBoundary: 3, workspaceRoot: ws }) }),
      ...extra,
    });
    expect(out).toContain('恢复 1');
    // 主锁：adopt 恰一次且参数=fork 回执 id（修前红：位不被读 → []）
    expect(adoptCalls).toEqual(['new-session']);
    // 回执仍完整（切焦不改回执面）
    expect(out).toContain('保底快照');
  });

  it('restore：焦点会话在飞 = busy 守卫拒（零执行实证——修前：放行且文件被恢复）', async () => {
    await writeFile(join(ws, 'a.txt'), 'v1', 'utf8');
    await createCapture(store, { now: () => 1_000, newId: () => 'snap01' })({
      sessionId: 's1',
      boundarySeq: 3,
      workspaceRoot: ws,
      trigger: 'mutation',
    });
    await writeFile(join(ws, 'a.txt'), 'v2', 'utf8');
    const adoptCalls: string[] = [];
    const extra = { focusRunning: () => true, adoptSession: async (id: string) => void adoptCalls.push(id) };
    const out = await runRewindCommand(['restore', 'snap01'], {
      ...deps({ contextOf: () => ({ lastClosedBoundary: 3, workspaceRoot: ws }) }),
      ...extra,
    });
    // 拒文本（05 §5.3 批3 翻案笔③——在飞 run 继续写会覆盖恢复产物）
    expect(out).toContain('运行中');
    expect(out).toContain('Ctrl+C');
    // 零执行实证：三步序未跑（文件仍 v2 未被恢复回 v1）+ adopt 零调
    expect(await readFile(join(ws, 'a.txt'), 'utf8')).toBe('v2');
    expect(adoptCalls).toEqual([]);
  });

  it('restore：busy 守卫缺席位语义（focusRunning 未注入 = 无守卫放行——纯诊断形兼容）', async () => {
    await writeFile(join(ws, 'a.txt'), 'v1', 'utf8');
    await createCapture(store, { now: () => 1_000, newId: () => 'snap01' })({
      sessionId: 's1',
      boundarySeq: 3,
      workspaceRoot: ws,
      trigger: 'mutation',
    });
    await writeFile(join(ws, 'a.txt'), 'v2', 'utf8');
    // focusRunning 缺席（旧调用方零破坏——serve/诊断形）
    const out = await runRewindCommand(
      ['restore', 'snap01'],
      deps({ contextOf: () => ({ lastClosedBoundary: 3, workspaceRoot: ws }) }),
    );
    expect(out).toContain('恢复 1'); // 放行（守卫缺席不误拒）
  });
});
