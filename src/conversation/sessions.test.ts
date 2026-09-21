/**
 * SessionManager 测试——多会话编排面（临时目录真 Persistence + 真驱动构造，
 * mock 只停 streamFn 注入位——组合根口径同 driver 测试台）。
 *
 * 断言面：create/list 登记与幂等 open / open resume 的 closer 合成（崩溃
 * 收形消费位）/ fork 种子形状（end-seed 尾条 + 血缘 + 不返回幻影 id + 源日志
 * 零污染 + 活体优先事实源）/ session_before_fork 否决联合回执 / search 的
 * flush 屏障先行 + 会话内 FTS / dispose 全量拆解 + 封印位（create/fork 拒
 * SESSION_MANAGER_DISPOSED——六役停机窗补钉 02 §5.3 + 挂账收口笔 04 §1）+
 * 会话关闭收口 seam（六役 CL-C ④——onSessionClosed retire/dispose 两路同发）+
 * listActive 尾键判据三语义（cs-D1——currentSessionId 判据 v1：首次入册序 /
 * 幂等复开不移尾 / 删后重开新尾插）。
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
import { SESSION_ARCHIVE_MIGRATION } from '../persist/index.js';
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
    migrations: [SESSION_ARCHIVE_MIGRATION], // writeTuple 硬依赖 v13 专列（05 §9）
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
  it('workspaceRootOf 活体锚读面：create 即可读（未 append 未 flush——「锚不能走库读」律）+ 无锚/未知 id 诚实 undefined（六役子承父锚消费位）', () => {
    const { manager } = makeManager();
    const withAnchor = manager.create({ workspaceRoot: '/parent-ws' });
    // 行未落库（createSession 零 I/O——行首事件才落库）亦可读：活体镜像自
    // 日志登记值 adopt 时入册（SessionLog.workspaceRoot 活体载体）
    expect(manager.workspaceRootOf(withAnchor.sessionId)).toBe('/parent-ws');
    const bare = manager.create();
    expect(manager.workspaceRootOf(bare.sessionId)).toBeUndefined(); // 无锚形
    expect(manager.workspaceRootOf('nope')).toBeUndefined(); // 未知 id 诚实缺席
  });

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

  it('活体源锚不经 listSessions 反查：行落 limit=100 截断窗外（长驻进程 resume 旧会话零 append 不 bump updated_at）fork 子会话仍承锚——修前红：反查落空恒 undefined 子会话静默丢工作区锚', async () => {
    // 独立持久层 + 假钟：updated_at 严格受控（源行恒落窗外——不依赖真实时钟毫秒竞速）
    const anchorDir = mkdtempSync(join(tmpdir(), 'berry-agent-fork-anchor-'));
    let tick = 1000;
    const clocked = Persistence.open({
      dbPath: join(anchorDir, 'main.db'),
      dataDir: join(anchorDir, 'data'),
      secretKey: ephemeralSecretKey(),
      migrations: [SESSION_ARCHIVE_MIGRATION], // writeTuple 硬依赖 v13 专列（05 §9）
      clock: () => tick,
    });
    try {
      const dispatch = new EventDispatch();
      const manager = new SessionManager({ persistence: clocked, dispatch, createDriver: makeFactory(dispatch) });
      const source = manager.create({ workspaceRoot: '/ws' });
      closedTurn(source.driver.session, '旧会话一轮'); // 行随首事件落库（updated_at = tick 1000）
      await clocked.flush();
      // 预垫 101 行（单批同刻 2000 落库——updated_at 全体晚于源行，源行被挤出前 100）
      tick += 1000;
      for (let i = 0; i < 101; i++) {
        clocked.createSession({ origin: 'conversation' }).append('turn/start', {});
      }
      await clocked.flush();
      // 反证铺设到位：默认列表面（limit=100）不见源行——活体源 fork 的反查向量成立
      expect(clocked.listSessions().find((row) => row.id === source.sessionId)).toBeUndefined();
      // 源会话活体在场（resume 旧会话形态：flush 后零新 append、updated_at 不 bump）
      expect(manager.isOpen(source.sessionId)).toBe(true);
      const outcome = await manager.fork(source.sessionId);
      expect(outcome.status).toBe('forked');
      if (outcome.status !== 'forked') return;
      // 子会话行必承源锚（「/ws 传播」既有意图——修前反查落空恒丢锚）
      expect(clocked.store.getSessionRow(outcome.sessionId)?.workspaceRoot).toBe('/ws');
    } finally {
      await clocked.close().catch(() => undefined);
      rmSync(anchorDir, { recursive: true, force: true });
    }
  });

  it('零 append 活体源（createSession 零 I/O——行未落库）fork 子会话仍承锚：修前红：行缺席反查同样落空', async () => {
    const { manager } = makeManager();
    const source = manager.create({ workspaceRoot: '/ws2' }); // 零 append——库中无行（「锚不能走库读」律的原生形态）
    const outcome = await manager.fork(source.sessionId);
    expect(outcome.status).toBe('forked');
    if (outcome.status !== 'forked') return;
    expect(persistence.store.getSessionRow(outcome.sessionId)?.workspaceRoot).toBe('/ws2');
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

  it('封印位：dispose 后 create 拒 SESSION_MANAGER_DISPOSED（六役停机窗补钉——02 §5.3；修前红：现状不拒重造驱动）', () => {
    const { manager } = makeManager();
    manager.dispose();
    // 停机 drain 窗封印位：会话管理器已 dispose 后 create 响亮拒——原
    // 「closer 序先 dispose、自持钟后停」窗口内 scheduler tick 重造驱动防线
    expect(() => manager.create()).toThrowError(expect.objectContaining({ code: 'SESSION_MANAGER_DISPOSED' }));
  });

  it('封印位：dispose 后 fork 拒（封印面辖铸新会话两动词——durable 源在场亦拒，04 §1 六役挂账收口笔；修前红：现状走 durable 源重载仍铸新会话）', async () => {
    const { manager } = makeManager();
    const source = manager.create();
    closedTurn(source.driver.session, '一轮'); // durable 行随首事件落库
    await persistence.flush();
    manager.dispose(); // 清登记——fork 事实源将回落 loadSession durable 路
    // 缺陷向量：durable 行在场时 fork 原可在已 dispose 管理器上铸新会话
    // （走 loadSession 重载仍系铸新——与 create 同一 drain 窗向量，故同辖）
    await expect(manager.fork(source.sessionId)).rejects.toThrowError(
      expect.objectContaining({ code: 'SESSION_MANAGER_DISPOSED' }),
    );
  });

  it('封印幂等语义：重复 dispose 无害 + 重复 dispose 后 create 仍拒 + open 不受封印辖（封印面只辖 create/fork 铸新两动词）', async () => {
    const { manager } = makeManager();
    const a = manager.create({ workspaceRoot: '/ws' });
    a.driver.session.append('turn/start', {}); // durable 行随首事件落库
    await persistence.flush();
    manager.dispose();
    expect(() => manager.dispose()).not.toThrow(); // 幂等语义保持——重复 dispose 无害
    expect(() => manager.create()).toThrowError(expect.objectContaining({ code: 'SESSION_MANAGER_DISPOSED' }));
    // open/resume 不在封印面（封印面 = create/fork 铸新两动词；durable 复续照旧）
    const resumed = manager.open(a.sessionId);
    expect(manager.isOpen(a.sessionId)).toBe(true);
    resumed.driver.dismantle();
  });
});

/* ---------------- retire（05 §7 retire 律——单会话收口动词） ---------------- */

describe('SessionManager retire', () => {
  it('单会话收口：dismantle + 摘登记（isOpen false / driverOf 缺席 / listActive 退出）+ durable 行仍可 open 复续', async () => {
    const { manager } = makeManager();
    const a = manager.create({ workspaceRoot: '/ws' });
    const b = manager.create({ workspaceRoot: '/ws' });
    closedTurn(a.driver.session, '收口前一轮');
    await persistence.flush(); // durable 行在场（retire 不动 durable 面）

    expect(manager.retire(a.sessionId)).toBe(true);
    expect(a.driver.dismantled).toBe(true); // 终态停摆（driver 专测面行为，此处锁旗标）
    expect(manager.isOpen(a.sessionId)).toBe(false);
    expect(manager.driverOf(a.sessionId)).toBeUndefined();
    expect(manager.listActive().map((s) => s.sessionId)).toEqual([b.sessionId]); // 活体清单退出
    // 邻位不受牵连
    expect(manager.isOpen(b.sessionId)).toBe(true);
    // durable 面不受影响：行仍在库、open 复续重造活体（幂等 open 对已摘行）
    expect(manager.exists(a.sessionId)).toBe(true);
    const resumed = manager.open(a.sessionId);
    expect(manager.isOpen(a.sessionId)).toBe(true);
    resumed.driver.dismantle();
  });

  it('幂等：不在册回 false 零副作用（未建 id / 重复 retire / dispose 后再 retire）', () => {
    const { manager } = makeManager();
    expect(manager.retire('no-such-session')).toBe(false);
    const a = manager.create();
    expect(manager.retire(a.sessionId)).toBe(true);
    expect(manager.retire(a.sessionId)).toBe(false); // 重复收口幂等
    manager.dispose();
    expect(manager.retire(a.sessionId)).toBe(false); // 全量拆解后再 retire 无害
  });

  it('收口观察 seam（2026-09-13 复盘发现 ⑯ 接线位）：成功路恰一笔发射 onRetired；不在册零发射；观察者异常吞隔离不回卷收口序', () => {
    const observed: string[] = [];
    const dispatch = new EventDispatch();
    const manager = new SessionManager({
      persistence,
      dispatch,
      createDriver: makeFactory(dispatch),
      onRetired: (sessionId) => {
        observed.push(sessionId);
        throw new Error('观察者炸');
      },
    });
    expect(manager.retire('no-such-session')).toBe(false);
    expect(observed).toEqual([]); // 不在册零发射（幂等 false 路无观察）
    const a = manager.create();
    expect(manager.retire(a.sessionId)).toBe(true); // 观察者炸不回卷——收口主流程（dismantle + 摘登记）已完成
    expect(observed).toEqual([a.sessionId]); // 成功路恰一笔
    expect(manager.retire(a.sessionId)).toBe(false); // 重复收口零再发射
    expect(observed).toEqual([a.sessionId]);
  });
});

/* ---------------- listActive 尾键判据（cs-D1——currentSessionId 判据 v1 三语义） ---------------- */

describe('SessionManager listActive 尾键判据（cs-D1——装配根 currentSessionId 判据 v1 三语义：首次入册序 / 幂等复开不移尾 / 删后重开新尾插）', () => {
  it('三语义一锁：入册序 = create 序；open 已在册早退不移尾（尾键仍 B）；retire 摘除后 open 复续 = 新尾插（尾键变 A）', async () => {
    const { manager } = makeManager();
    const a = manager.create({ workspaceRoot: '/ws' });
    const b = manager.create({ workspaceRoot: '/ws' });
    // durable 铺设：A 需在 retire 前落行（createSession 零 I/O——行随首事件
    // 落库；未落库 id 在 open 复续腿上 loadSession fail-loud）
    closedTurn(a.driver.session, '尾键判据一轮');
    await persistence.flush();

    // 语义一（首次入册序）：create A → create B → listActive 序 [A,B]——
    // Map 插入序即活体清单序，尾键 = 最新首次入册者（非「最近触碰」）
    expect(manager.listActive().map((s) => s.sessionId)).toEqual([a.sessionId, b.sessionId]);

    // 语义二（幂等复开不移尾）：open A（已在册）→ 早退回同一活体驱动，
    // 登记序零变——尾键仍 B（「最新首次入册」判据对复开不敏感）
    const reopened = manager.open(a.sessionId);
    expect(reopened.driver).toBe(a.driver); // 早退回同一活体（不造第二附着）
    expect(manager.listActive().map((s) => s.sessionId)).toEqual([a.sessionId, b.sessionId]);
    expect(manager.listActive().at(-1)?.sessionId).toBe(b.sessionId); // 尾键 = B

    // 语义三（删后重开 = 新尾插）：retire A 摘登记（[B]）→ open A 复续走
    // loadSession 重造活体 → Map.set 尾插——序 [B,A]、尾键 = A
    expect(manager.retire(a.sessionId)).toBe(true);
    expect(manager.listActive().map((s) => s.sessionId)).toEqual([b.sessionId]);
    const resumed = manager.open(a.sessionId);
    expect(resumed.driver).not.toBe(a.driver); // 新活体（旧驱动已 dismantle 收口）
    expect(manager.listActive().map((s) => s.sessionId)).toEqual([b.sessionId, a.sessionId]);
    expect(manager.listActive().at(-1)?.sessionId).toBe(a.sessionId); // 尾键 = A（新尾插）
    resumed.driver.dismantle(); // 测试台收口（活体复续不回卷 durable 面）
  });
});

/* ---------------- 会话关闭收口 seam（六役 CL-C ④——closeOwner 消费位接线） ---------------- */

describe('SessionManager 会话关闭收口 seam（六役 CL-C ④——04 §10 closeOwner 段）', () => {
  it('retire 成功路逐会话发射 onSessionClosed（携 id）；不在册零发射；重复 retire 零再发射（修前红：回调位不存在）', () => {
    const closed: string[] = [];
    const dispatch = new EventDispatch();
    const manager = new SessionManager({
      persistence,
      dispatch,
      createDriver: makeFactory(dispatch),
      onSessionClosed: (sessionId) => closed.push(sessionId),
    });
    expect(manager.retire('no-such-session')).toBe(false);
    expect(closed).toEqual([]); // 不在册零发射
    const a = manager.create();
    expect(manager.retire(a.sessionId)).toBe(true);
    expect(closed).toEqual([a.sessionId]); // 成功路恰一笔、携会话 id
    expect(manager.retire(a.sessionId)).toBe(false);
    expect(closed).toEqual([a.sessionId]); // 幂等——零再发射
  });

  it('dispose 全量拆解路逐会话发射；已 retire 会话不重复（retire 路已发恰一笔）', () => {
    const closed: string[] = [];
    const dispatch = new EventDispatch();
    const manager = new SessionManager({
      persistence,
      dispatch,
      createDriver: makeFactory(dispatch),
      onSessionClosed: (sessionId) => closed.push(sessionId),
    });
    const a = manager.create();
    const b = manager.create();
    expect(manager.retire(a.sessionId)).toBe(true); // a 走 retire 路
    manager.dispose(); // b 走 dispose 路（a 已摘登记不在册）
    expect(closed).toEqual([a.sessionId, b.sessionId]); // 各恰一笔（同源两路不双发）
  });

  it('与 onRetired 分立两 seam：onRetired 只走 retire 路（发现 ⑯ 语义不动）、onSessionClosed 两路同发', () => {
    const retired: string[] = [];
    const closed: string[] = [];
    const dispatch = new EventDispatch();
    const manager = new SessionManager({
      persistence,
      dispatch,
      createDriver: makeFactory(dispatch),
      onRetired: (sessionId) => retired.push(sessionId),
      onSessionClosed: (sessionId) => closed.push(sessionId),
    });
    const a = manager.create();
    manager.retire(a.sessionId);
    const b = manager.create();
    manager.dispose();
    expect(retired).toEqual([a.sessionId]); // onRetired 不随 dispose 发射
    expect(closed).toEqual([a.sessionId, b.sessionId]);
  });

  it('收口观察者异常吞隔离不回卷收口序（retire 主流程已完成、dispose 拆解序继续）', () => {
    const dispatch = new EventDispatch();
    const manager = new SessionManager({
      persistence,
      dispatch,
      createDriver: makeFactory(dispatch),
      onSessionClosed: () => {
        throw new Error('收口观察炸');
      },
    });
    const a = manager.create();
    const b = manager.create();
    expect(manager.retire(a.sessionId)).toBe(true); // 观察炸不回卷——收口主流程已成
    expect(manager.isOpen(a.sessionId)).toBe(false);
    expect(() => manager.dispose()).not.toThrow(); // 拆解序不被单会话观察炸打断
    expect(manager.isOpen(b.sessionId)).toBe(false);
  });
});
