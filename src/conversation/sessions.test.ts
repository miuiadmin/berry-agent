/**
 * SessionManager 测试——多会话编排面（临时目录真 Persistence + 真驱动构造，
 * mock 只停 streamFn 注入位——组合根口径同 driver 测试台）。
 *
 * 断言面：create/list 登记与幂等 open / open resume 的 closer 合成（崩溃
 * 收形消费位）/ fork 种子形状（end-seed 尾条 + 血缘 + 不返回幻影 id + 源日志
 * 零污染 + 活体优先事实源）/ session_before_fork 否决联合回执 / search 的
 * flush 屏障先行 + 会话内 FTS / dispose 全量拆解。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Message } from '../contracts/index.js';
import { isStandardMessage } from '../contracts/index.js';
import { EventDispatch, Scope } from '../context/index.js';
import type { SessionLog } from '../session/index.js';
import { ephemeralSecretKey } from '../persist/secret-box.js';
import { Persistence } from '../persist/persistence.js';
import { SessionManager } from './sessions.js';
import type { DriverFactory, SessionBeforeForkInput } from './sessions.js';
import { ConversationDriver } from './driver.js';

/* ---------------- 测试台 ---------------- */

let dir: string;
let persistence: Persistence;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-sessions-test-'));
  persistence = Persistence.open({
    dbPath: join(dir, 'main.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
  });
});

afterEach(async () => {
  await persistence.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

/** 缺省 convertToLlm：标准直通、自定义剥离 */
const passthrough = (m: import('../contracts/index.js').AgentMessage): Message | null =>
  isStandardMessage(m) ? m : null;

/** 驱动工厂（每会话独立 scope；dispatch 共用管理器总线——真装配形态） */
function makeFactory(dispatch: EventDispatch): DriverFactory {
  return ({ session }) =>
    new ConversationDriver({
      session,
      scope: Scope.createRoot(),
      dispatch,
      streamFn: async () => {
        throw new Error('本测试面不驱动 run（纯编排断言）');
      },
      convertToLlm: passthrough,
      model: 'test/model',
    });
}

/** 一轮闭合 turn 的 durable 形态（turn/start → user → assistant → turn/end） */
function closedTurn(log: SessionLog, text: string): void {
  log.append('turn/start', {});
  log.append('user/message', { content: text, source: 'user' });
  log.append('assistant/message', {
    content: [{ type: 'text', text: '答' }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
  });
  log.append('turn/end', { reason: 'completed' });
}

/** 新管理器（dispatch 可注入——钩子用例的挂点） */
function makeManager(dispatch = new EventDispatch()): { manager: SessionManager; dispatch: EventDispatch } {
  return { manager: new SessionManager({ persistence, dispatch, createDriver: makeFactory(dispatch) }), dispatch };
}

/* ---------------- create / list ---------------- */

describe('SessionManager create 与登记', () => {
  it('create：origin 缺省 conversation + 驱动入册（isOpen/driverOf）+ 行随首事件落库', async () => {
    const { manager } = makeManager();
    const opened = manager.create({ workspaceRoot: '/ws', title: '标题' });
    expect(opened.origin).toBe('conversation');
    expect(manager.isOpen(opened.sessionId)).toBe(true);
    expect(manager.driverOf(opened.sessionId)).toBe(opened.driver);
    // 零持久化承诺：未 append 未 flush——列表面无行
    expect(manager.list().find((row) => row.id === opened.sessionId)).toBeUndefined();
    opened.driver.session.append('turn/start', {});
    await persistence.flush();
    const row = manager.list({ workspaceRoot: '/ws' }).find((r) => r.id === opened.sessionId);
    expect(row?.title).toBe('标题');
    expect(row?.lastSeq).toBe(0);
  });

  it('同 dispatch 重复建管理器 → 装配哨兵撞名 fail-loud（装配 bug 不静默——03 §2.4）', () => {
    const dispatch = new EventDispatch();
    makeManager(dispatch);
    expect(() => makeManager(dispatch)).toThrow(); // 二次装配撞 conversation/session-manager-mounted
  });

  it('create init.model 透传 DriverFactory（缺席 undefined；open/resume 不携带——触发器 starter per-fresh-session 载体，C 批 C-3）', async () => {
    const seen: Array<string | undefined> = [];
    const dispatch = new EventDispatch();
    const manager = new SessionManager({
      persistence,
      dispatch,
      createDriver: (input) => {
        seen.push(input.model);
        return new ConversationDriver({
          session: input.session,
          scope: Scope.createRoot(),
          dispatch,
          streamFn: async () => {
            throw new Error('本测试面不驱动 run（纯编排断言）');
          },
          convertToLlm: passthrough,
          model: input.model ?? 'test/model',
        });
      },
    });
    const overridden = manager.create({ model: 'override/model' });
    manager.create({}); // 缺席 = undefined（栈缺省回落的判据位）
    // 零持久化承诺：resume 前落首事件（行随首事件落库）
    overridden.driver.session.append('turn/start', {});
    await persistence.flush();
    manager.dispose(); // 清登记走 open/resume 腿——resume 不携带模型
    manager.open(overridden.sessionId);
    expect(seen).toEqual(['override/model', undefined, undefined]);
  });

  it('create init.systemPrompt/shapeTools 透传 DriverFactory（批 19c-1 per-session 装配覆盖通道——in-process 子代理工厂装载位）', () => {
    // 整形探针面（名位唯一消费面——结构替身）
    const probe = [
      { name: 'read' },
      { name: 'bash' },
      { name: 'todo' },
    ] as unknown as import('../contracts/index.js').AgentTool[];
    const seen: Array<{ systemPrompt: string | undefined; shaped: string[] | undefined }> = [];
    const dispatch = new EventDispatch();
    const manager = new SessionManager({
      persistence,
      dispatch,
      createDriver: (input) => {
        seen.push({
          systemPrompt: input.systemPrompt,
          shaped: input.shapeTools?.(probe)?.map((tool) => tool.name),
        });
        return new ConversationDriver({
          session: input.session,
          scope: Scope.createRoot(),
          dispatch,
          streamFn: async () => {
            throw new Error('本测试面不驱动 run（纯编排断言）');
          },
          convertToLlm: passthrough,
          model: 'test/model',
        });
      },
    });
    // bash 恒弃整形（子代理派生面律）——形状可见性经透传闭包验证
    manager.create({ systemPrompt: '你是子代理', shapeTools: (tools) => tools.filter((tool) => tool.name !== 'bash') });
    manager.create({}); // 缺席双 undefined（不覆盖 = 栈缺省位）
    expect(seen).toEqual([
      { systemPrompt: '你是子代理', shaped: ['read', 'todo'] },
      { systemPrompt: undefined, shaped: undefined },
    ]);
  });
});

/* ---------------- open（resume） ---------------- */

describe('SessionManager open', () => {
  it('resume + closer 合成：孤儿 tool/call 与未闭合 turn 补形（05 §4 消费位）', async () => {
    // 崩溃态铺设：走裸 persistence（唯一附着——管理器零参与，重启语义）
    const log = persistence.createSession({ origin: 'conversation' });
    log.append('turn/start', {});
    log.append('user/message', { content: '问', source: 'user' });
    log.append('assistant/message', {
      content: [],
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
      stopReason: 'toolUse',
    });
    log.append('tool/call', { toolCallId: 'c1', name: 'read', arguments: '{}' });
    await persistence.flush(); // 崩溃前落库
    const { manager } = makeManager();
    const opened = manager.open(log.sessionId);
    expect(opened.origin).toBe('conversation');
    const types = opened.driver.session.events().map((event) => event.type);
    // 合成收形：孤儿 tool/call → tool/result（无 gate 证据 = NOT_STARTED 语义码）
    // + 未闭合 turn → turn/end(interrupted)
    expect(types).toEqual(['turn/start', 'user/message', 'assistant/message', 'tool/call', 'tool/result', 'turn/end']);
    const synthetic = opened.driver.session.events()[4]!;
    expect((synthetic.data as { content?: unknown[] }).content).toBeDefined();
    expect(opened.driver.session.events()[5]!.data).toEqual({ reason: 'interrupted' });
  });

  it('幂等 open：同 id 二开回同一活体驱动（单焦点——不造第二附着）', () => {
    const { manager } = makeManager();
    const first = manager.create();
    const again = manager.open(first.sessionId);
    expect(again.driver).toBe(first.driver);
    expect(again.origin).toBe(first.origin);
  });

  it('未知 id → fail-loud（PERSIST_DATA_CORRUPT 透传）', () => {
    const { manager } = makeManager();
    expect(() => manager.open('ghost-id')).toThrow(/ghost-id/);
  });
});

/* ---------------- fork ---------------- */

describe('SessionManager fork', () => {
  it('缺省边界（lastClosedBoundary）+ 种子形状 + 血缘 + 不返回幻影 id + 源日志零污染', async () => {
    const { manager } = makeManager();
    const source = manager.create({ workspaceRoot: '/ws' });
    closedTurn(source.driver.session, '第一轮');
    // 半轮进行中：缺省边界须切在闭合边界（不进行中 turn 中间切）
    source.driver.session.append('turn/start', {});
    source.driver.session.append('user/message', { content: '第二轮', source: 'user' });
    await persistence.flush();
    const sourceLen = source.driver.session.events().length; // 6

    const outcome = await manager.fork(source.sessionId, { title: '分叉' });
    expect(outcome.status).toBe('forked');
    if (outcome.status !== 'forked') return;
    // 种子形状：闭合前缀（4 条）+ end-seed 字面尾事件（seq=4、time 复用前缀尾）
    const seedTypes = outcome.driver.session.events().map((event) => event.type);
    expect(seedTypes).toEqual(['turn/start', 'user/message', 'assistant/message', 'turn/end', 'session/end-seed']);
    const endSeed = outcome.driver.session.events()[4]!;
    expect(endSeed.seq).toBe(4);
    expect(endSeed.time).toBe(source.driver.session.events()[3]!.time);
    expect(endSeed.data).toEqual({});
    // 露头三件：血缘 / 首条新 append seq / 行同步落库（未 flush 已可读）
    expect(outcome.lineage).toEqual({ parentId: source.sessionId, seedLength: 5, origin: 'fork' });
    expect(outcome.firstAppendSeq).toBe(5);
    expect(persistence.store.loadEvents(outcome.sessionId)).toHaveLength(5);
    const row = persistence.store.getSessionRow(outcome.sessionId);
    expect(row?.parentId).toBe(source.sessionId);
    expect(row?.seedLength).toBe(5);
    expect(row?.title).toBe('分叉');
    expect(row?.workspaceRoot).toBe('/ws');
    // 源日志零污染：长度不变、无 end-seed（内存种子组装——05 §5.0 落码裁决注记）
    expect(source.driver.session.events()).toHaveLength(sourceLen);
    expect(source.driver.session.events().some((event) => event.type === 'session/end-seed')).toBe(false);
    // 续写衔接：新 append 从 firstAppendSeq 起
    const appended = outcome.driver.session.append('turn/start', {});
    expect(appended.seq).toBe(5);
  });

  it('活体优先事实源：源在飞事件未 flush 仍进种子（内存读 + 同步写）', async () => {
    const { manager } = makeManager();
    const source = manager.create();
    source.driver.session.append('turn/start', {});
    source.driver.session.append('user/message', { content: '在飞', source: 'user' });
    // 未 flush：DB 侧源事件为空——fork 走活体内存流仍得全量（显式边界直证）
    expect(persistence.store.loadEvents(source.sessionId)).toHaveLength(0);
    const outcome = await manager.fork(source.sessionId, { upToSeq: 1 });
    expect(outcome.status).toBe('forked');
    if (outcome.status !== 'forked') return;
    expect(outcome.lineage.seedLength).toBe(3);
    expect(persistence.store.loadEvents(outcome.sessionId)).toHaveLength(3);
  });

  it('显式 upToSeq 中段切 + 越界 fail-loud', async () => {
    const { manager } = makeManager();
    const source = manager.create();
    closedTurn(source.driver.session, '一轮');
    await persistence.flush();
    const outcome = await manager.fork(source.sessionId, { upToSeq: 1 });
    expect(outcome.status).toBe('forked');
    if (outcome.status !== 'forked') return;
    // 前缀 [0..1] + end-seed
    expect(outcome.driver.session.events().map((e) => e.type)).toEqual([
      'turn/start',
      'user/message',
      'session/end-seed',
    ]);
    expect(outcome.firstAppendSeq).toBe(3);
    await expect(manager.fork(source.sessionId, { upToSeq: 99 })).rejects.toThrow(/越界/);
  });

  it('session_before_fork 否决：置位照常 next 与短路两形态 → 联合回执、零新会话', async () => {
    const { manager, dispatch } = makeManager();
    const source = manager.create();
    closedTurn(source.driver.session, '一轮');
    await persistence.flush();
    const rowsBefore = manager.list().length;
    // 形态一：置 veto 位后照常 next（管理器只认位）
    const off1 = dispatch.onWaterfall<SessionBeforeForkInput>('session_before_fork', (value, next) => {
      value.veto = { reason: '策略拒' };
      return next(value);
    });
    const vetoed = await manager.fork(source.sessionId);
    expect(vetoed).toEqual({ status: 'vetoed', reason: '策略拒' });
    expect(manager.list()).toHaveLength(rowsBefore);
    off1();
    // 形态二：不调 next 短路（管线语义——后段不执行，返回值即产出）
    let downstream = false;
    dispatch.onWaterfall<SessionBeforeForkInput>('session_before_fork', (value) => {
      value.veto = { reason: '短路拒' };
      return value;
    });
    dispatch.onWaterfall<SessionBeforeForkInput>('session_before_fork', (value, next) => {
      downstream = true;
      return next(value);
    });
    const shortCircuit = await manager.fork(source.sessionId);
    expect(shortCircuit).toEqual({ status: 'vetoed', reason: '短路拒' });
    expect(downstream).toBe(false);
    expect(manager.list()).toHaveLength(rowsBefore);
  });

  it('未知源 id → fail-loud（loadSession 透传）', async () => {
    const { manager } = makeManager();
    await expect(manager.fork('ghost-id')).rejects.toThrow(/ghost-id/);
  });
});

/* ---------------- search（会话内 FTS） ---------------- */

describe('SessionManager search', () => {
  it('flush 屏障先行：在飞事件经屏障入索引后命中（05 §9 首发——session_id 限定）', async () => {
    const { manager } = makeManager();
    const opened = manager.create();
    opened.driver.session.append('turn/start', {});
    const ev = opened.driver.session.append('user/message', { content: 'alphatriggerword', source: 'user' });
    // 未 flush：直查 FTS 空（write-behind 在飞不进索引）——屏障语义的反证
    expect(persistence.searchSessionFts(opened.sessionId, 'alphatriggerword')).toEqual([]);
    const hits = await manager.search(opened.sessionId, 'alphatriggerword');
    expect(hits).toEqual([ev.seq]);
    // 不命中词回空
    expect(await manager.search(opened.sessionId, 'zzz-not-there')).toEqual([]);
  });
});

/* ---------------- dispose ---------------- */

describe('SessionManager dispose', () => {
  it('全量拆解：清登记（dismantle 行为归 driver 专测）', () => {
    const { manager } = makeManager();
    const a = manager.create();
    manager.create();
    manager.dispose();
    expect(manager.isOpen(a.sessionId)).toBe(false);
    expect(manager.driverOf(a.sessionId)).toBeUndefined();
  });
});
