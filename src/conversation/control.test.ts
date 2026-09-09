/**
 * 操控受理器测试——createSessionsControl 全景（03 §2.2 第十一面 e-4：
 * 临时目录真 Persistence + 真 SessionManager + 真驱动，mock 只停 streamFn
 * 注入位——组合根口径同 sessions/driver 测试台）。
 *
 * 断言面：三动词受理序（幽灵守卫→门检→链深帽→TURN_STALE 对拍→投递→审计）
 * / provenance 双道盖章（session:/plugin:）/ send 三态回执（delivered/queued/
 * 停摆 inject 携 seq）/ auto-open 投递腿 / interrupt 守卫与打断 / withdraw
 * 幂等诚实呈报 / a2a 链深帽缺省 5 与人面重置。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssistantMessage, Message } from '../contracts/index.js';
import { isStandardMessage } from '../contracts/index.js';
import { EventDispatch, Scope } from '../context/index.js';
import { ephemeralSecretKey } from '../persist/secret-box.js';
import { Persistence } from '../persist/persistence.js';
import { ConversationDriver } from './driver.js';
import type { DriverFactory } from './sessions.js';
import { SessionManager } from './sessions.js';
import { createSessionsControl, bindControlForPlugin } from './control.js';
import type { ControlUsedRecord, PluginControlFace, SessionsControlFace } from './control.js';

/* ---------------- 测试台 ---------------- */

let dir: string;
let persistence: Persistence;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-control-test-'));
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

/** assistant 终值（空内容 stop 收尾） */
function assistantDone(): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 0,
  };
}

/**
 * 测试台：gate per-session（每会话首次流调用挂起；releaseAll 置放行标志后
 * 既有与后续 gate 全直通——放行早于流调用到达的时序安全形）。
 */
function makeHarness() {
  const dispatch = new EventDispatch();
  let releasedAll = false;
  const gates = new Map<string, Promise<void>>();
  const releases: Array<() => void> = [];
  const gateFor = (sessionId: string): Promise<void> => {
    let gate = gates.get(sessionId);
    if (gate === undefined) {
      if (releasedAll) {
        gate = Promise.resolve();
      } else {
        let release!: () => void;
        gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        releases.push(release);
      }
      gates.set(sessionId, gate);
    }
    return gate;
  };
  const createDriver: DriverFactory = ({ session }) =>
    new ConversationDriver({
      session,
      scope: Scope.createRoot(),
      dispatch,
      streamFn: () => {
        const gate = gateFor(session.sessionId);
        const final = assistantDone();
        return {
          async *[Symbol.asyncIterator]() {
            await gate;
            yield { type: 'start', partial: { ...final, content: [...final.content] } };
            yield { type: 'done', reason: 'stop' as const, message: final };
          },
          result: async () => final,
        };
      },
      convertToLlm: passthrough,
      model: 'test/model',
    });
  const manager = new SessionManager({ persistence, dispatch, createDriver });
  const used: ControlUsedRecord[] = [];
  const opens = new Set<string>();
  const control = createSessionsControl({
    manager,
    // caller 感知合成测试位（开门制扩展批）：单集直通——两道 caller 同集；
    // caller 分道合成律归 assembly 侧（getOpensFor 装配真源）测试
    getOpensFor: () => opens,
    onCapabilityUsed: (record) => used.push(record),
  });
  return {
    manager,
    control,
    opens,
    used,
    /** 置放行标志 + 放行全部已挂 gate（后续流调用恒直通） */
    releaseAll: () => {
      releasedAll = true;
      releases.splice(0).forEach((release) => release());
    },
  };
}

/** 目标 durable 日志最近 turn/start seq（expectedTurnId 断言简写） */
function lastTurnStart(driver: ConversationDriver): number | undefined {
  const events = driver.session.events();
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]!.type === 'turn/start') return events[i]!.seq;
  }
  return undefined;
}

/* ---------------- 插件道 fork 绑定（caller 闭包铸造） ---------------- */

describe('插件道 fork 绑定——bindControlForPlugin（caller 覆写防冒名）', () => {
  /** 受理器替身（全动词入参录——caller 断言位） */
  function recordingFace(): { face: SessionsControlFace; received: Array<{ verb: string; caller: unknown }> } {
    const received: Array<{ verb: string; caller: unknown }> = [];
    return {
      received,
      face: {
        async send(input) {
          received.push({ verb: 'send', caller: input.caller });
          return { status: 'delivered', messageId: 'msg-1' };
        },
        async interrupt(input) {
          received.push({ verb: 'interrupt', caller: input.caller });
          return { status: 'interrupted', targetSessionId: input.targetSessionId, stillQueued: [], queuedCount: 0 };
        },
        async withdraw(input) {
          received.push({ verb: 'withdraw', caller: input.caller });
          return { status: 'delivered', messageId: input.messageId };
        },
      },
    };
  }

  it('三动词 caller 恒 {kind:"plugin", pluginId} 闭包值——插件道归因单源', async () => {
    const rec = recordingFace();
    const bound: PluginControlFace = bindControlForPlugin('demo', rec.face);
    await bound.send({ targetSessionId: 's-b', text: 'hi' });
    await bound.interrupt({ targetSessionId: 's-b' });
    await bound.withdraw({ targetSessionId: 's-b', messageId: 'msg-1' });
    expect(rec.received).toEqual([
      { verb: 'send', caller: { kind: 'plugin', pluginId: 'demo' } },
      { verb: 'interrupt', caller: { kind: 'plugin', pluginId: 'demo' } },
      { verb: 'withdraw', caller: { kind: 'plugin', pluginId: 'demo' } },
    ]);
  });

  it('PluginControlFace 类型面无 caller 位（传入即被覆写——伪造结构性不存在）', async () => {
    const rec = recordingFace();
    const bound = bindControlForPlugin('real', rec.face) as unknown as {
      send(input: Record<string, unknown>): Promise<unknown>;
    };
    // 恶意插件运行时强塞 caller（类型面之外）——覆写律：闭包值恒胜
    await bound.send({ caller: 'session:victim', targetSessionId: 's-b', text: 'hi' });
    expect(rec.received[0]!.caller).toEqual({ kind: 'plugin', pluginId: 'real' });
  });
});

/* ---------------- 受理序与拒码族 ---------------- */

describe('操控受理器——受理序与拒码族', () => {
  it('幽灵守卫先于门检：幽灵 id 闭门也报 SESSION_TARGET_NOT_FOUND（守卫序①）', async () => {
    const h = makeHarness();
    await expect(
      h.control.send({ caller: { kind: 'plugin', pluginId: 'demo' }, targetSessionId: 'ghost', text: 'hi' }),
    ).rejects.toMatchObject({ code: 'SESSION_TARGET_NOT_FOUND' });
  });

  it('操控门检拒（守卫序②）：真实目标 + 门未开 → SESSION_CONTROL_DENIED 全动词同码', async () => {
    const h = makeHarness();
    const target = h.manager.create();
    for (const attempt of [
      () =>
        h.control.send({ caller: { kind: 'plugin', pluginId: 'demo' }, targetSessionId: target.sessionId, text: 'hi' }),
      () => h.control.interrupt({ caller: { kind: 'plugin', pluginId: 'demo' }, targetSessionId: target.sessionId }),
      () =>
        h.control.withdraw({
          caller: { kind: 'plugin', pluginId: 'demo' },
          targetSessionId: target.sessionId,
          messageId: 'msg-1',
        }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: 'SESSION_CONTROL_DENIED' });
    }
    // 拒路径零审计（未获许可不记使用账——与 obs 轴同律）
    expect(h.used).toEqual([]);
  });

  it('send 空文本拒收（调用方 bug 面——普通 Error 非业务码）', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const target = h.manager.create();
    await expect(
      h.control.send({ caller: { kind: 'plugin', pluginId: 'demo' }, targetSessionId: target.sessionId, text: '   ' }),
    ).rejects.toThrowError(/空文本/);
  });

  it('expectedTurnId 乐观并发：翻页拒 SESSION_TURN_STALE、对上即投递（codex 形）', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const caller = h.manager.create();
    const target = h.manager.create();
    // 目标日志已有两 turn（最近 turn/start seq=1）
    const t = h.manager.driverOf(target.sessionId)!;
    t.session.append('turn/start', {});
    t.session.append('turn/end', { reason: 'completed' });
    t.session.append('turn/start', {});
    t.session.append('turn/end', { reason: 'completed' });
    await expect(
      h.control.send({
        caller: { kind: 'session', sessionId: caller.sessionId },
        targetSessionId: target.sessionId,
        text: 'hi',
        expectedTurnId: 99,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_TURN_STALE' });
    // 对上（最近 turn/start seq=1）→ 投递
    const receipt = await h.control.send({
      caller: { kind: 'session', sessionId: caller.sessionId },
      targetSessionId: target.sessionId,
      text: 'hi',
      expectedTurnId: lastTurnStart(t),
    });
    expect(receipt.status).toBe('delivered');
    h.releaseAll();
  });
});

/* ---------------- send 三态与 provenance ---------------- */

describe('操控受理器——send 三态回执与 provenance 双道', () => {
  it('idle 腿投递：delivered + messageId 栈级自增 + durable 落账 source=session:<送话会话>', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const caller = h.manager.create();
    const target = h.manager.create();
    const receipt = await h.control.send({
      caller: { kind: 'session', sessionId: caller.sessionId },
      targetSessionId: target.sessionId,
      text: '跨会话指令',
    });
    expect(receipt).toMatchObject({ status: 'delivered', messageId: 'msg-1' });
    // fire-and-forget 起跑收口（放行 gate 后 run 结算）+ durable 盖章形
    h.releaseAll();
    await vi.waitFor(() => expect(h.manager.driverOf(target.sessionId)!.running).toBe(false));
    const userData = h.manager
      .driverOf(target.sessionId)!
      .session.events()
      .filter((event) => event.type === 'user/message')
      .map((event) => event.data);
    expect(userData).toEqual([{ content: '跨会话指令', source: `session:${caller.sessionId}` }]);
  });

  it('busy 腿投递：queued 即席回执 + 入列件撤回闭环（withdrawn → delivered 诚实幂等）', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const caller = h.manager.create();
    const target = h.manager.create();
    const t = h.manager.driverOf(target.sessionId)!;
    const run = t.submit('首问'); // gate 挂住 → 在飞窗口
    await vi.waitFor(() => expect(t.running).toBe(true));
    const receipt = await h.control.send({
      caller: { kind: 'session', sessionId: caller.sessionId },
      targetSessionId: target.sessionId,
      text: '插话',
    });
    expect(receipt).toMatchObject({ status: 'queued', messageId: 'msg-1' });
    // 在队撤回 → withdrawn；同 id 再撤 → delivered（已出队 no-op 诚实呈报）
    await expect(
      h.control.withdraw({
        caller: { kind: 'session', sessionId: caller.sessionId },
        targetSessionId: target.sessionId,
        messageId: 'msg-1',
      }),
    ).resolves.toEqual({ status: 'withdrawn', messageId: 'msg-1' });
    await expect(
      h.control.withdraw({
        caller: { kind: 'session', sessionId: caller.sessionId },
        targetSessionId: target.sessionId,
        messageId: 'msg-1',
      }),
    ).resolves.toEqual({ status: 'delivered', messageId: 'msg-1' });
    h.releaseAll();
    await run;
  });

  it('停摆腿投递：delivered 携 seq（inject 落账不唤醒）+ 插队件从未入队撤回恒 delivered', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const caller = h.manager.create();
    const target = h.manager.create();
    h.manager.driverOf(target.sessionId)!.dismantle();
    const receipt = await h.control.send({
      caller: { kind: 'session', sessionId: caller.sessionId },
      targetSessionId: target.sessionId,
      text: '停摆注入',
    });
    expect(receipt.status).toBe('delivered');
    if (receipt.status === 'delivered') expect(typeof receipt.seq).toBe('number');
    // 停摆清队后撤回：恒 delivered（队列是内存态）
    await expect(
      h.control.withdraw({
        caller: { kind: 'session', sessionId: caller.sessionId },
        targetSessionId: target.sessionId,
        messageId: 'msg-1',
      }),
    ).resolves.toEqual({ status: 'delivered', messageId: 'msg-1' });
  });

  it('插件服务道：source=plugin:<插件id> 盖章 + 起跳链深 1', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const target = h.manager.create();
    const receipt = await h.control.send({
      caller: { kind: 'plugin', pluginId: 'demo' },
      targetSessionId: target.sessionId,
      text: '插件注入',
    });
    expect(receipt.status).toBe('delivered');
    h.releaseAll();
    await vi.waitFor(() => expect(h.manager.driverOf(target.sessionId)!.running).toBe(false));
    expect(h.manager.driverOf(target.sessionId)!.a2aDepth).toBe(1); // 插件直唤即第一跳
    const userData = h.manager
      .driverOf(target.sessionId)!
      .session.events()
      .filter((event) => event.type === 'user/message')
      .map((event) => event.data);
    expect(userData).toEqual([{ content: '插件注入', source: 'plugin:demo' }]);
  });

  it('auto-open 投递腿：durable-only 目标（未 open 有历史行）send 即 resume 打开', async () => {
    // 阶段一：建会话落事件 → flush 落库（行随首事件经写队列；origin 必传——
    // 裸 createSession 缺 origin 会 NOT NULL 毒丸）
    const dispatchA = new EventDispatch();
    const mk = (): ConversationDriver =>
      new ConversationDriver({
        session: persistence.createSession({ origin: 'conversation' }),
        scope: Scope.createRoot(),
        dispatch: dispatchA,
        streamFn: async () => {
          throw new Error('不驱动 run');
        },
        convertToLlm: passthrough,
        model: 'test/model',
      });
    const seeded = mk();
    seeded.session.append('user/message', { content: '历史', source: 'user' });
    await persistence.flush();
    expect(persistence.hasSession(seeded.session.sessionId)).toBe(true); // durable 行在场前提
    // 阶段二：新管理器（目标 durable-only）→ send 即 auto-open（loadSession 路径）
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    expect(h.manager.driverOf(seeded.session.sessionId)).toBeUndefined(); // 未 open 前提
    const receipt = await h.control.send({
      caller: { kind: 'plugin', pluginId: 'demo' },
      targetSessionId: seeded.session.sessionId,
      text: '唤醒注入',
    });
    expect(receipt.status).toBe('delivered');
    expect(h.manager.driverOf(seeded.session.sessionId)).toBeDefined(); // auto-open 后活体在场
    h.releaseAll();
  });
});

/* ---------------- a2a 回合护栏 ---------------- */

describe('操控受理器——a2a 回合护栏（缺省 5 + 人面重置）', () => {
  it('五跳合法第六跳拒 SESSION_ROUND_LIMIT、人面输入重置链深后放行', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    // 七会话链 s1..s7：s1→s2 起 s2 链深 1 …… s5→s6 链深 5（恰好帽内）
    const chain = Array.from({ length: 7 }, () => h.manager.create().sessionId);
    for (let i = 0; i < 5; i += 1) {
      const receipt = await h.control.send({
        caller: { kind: 'session', sessionId: chain[i]! },
        targetSessionId: chain[i + 1]!,
        text: `第 ${i + 1} 跳`,
      });
      expect(receipt.status).toBe('delivered');
      expect(h.manager.driverOf(chain[i + 1]!)!.a2aDepth).toBe(i + 1);
    }
    // 第六跳：s6（链深 5）→ s7 拒
    await expect(
      h.control.send({ caller: { kind: 'session', sessionId: chain[5]! }, targetSessionId: chain[6]!, text: '第六跳' }),
    ).rejects.toMatchObject({ code: 'SESSION_ROUND_LIMIT' });
    // 人面输入重置 s6 链深 → 同一跳放行（先放行链上挂住的 run，s6 转 idle
    // 再人面 submit——gate resolve 后恒直通，await 不挂）
    h.releaseAll();
    await vi.waitFor(() => expect(h.manager.driverOf(chain[5]!)!.running).toBe(false));
    await h.manager.driverOf(chain[5]!)!.submit('人面接管');
    expect(h.manager.driverOf(chain[5]!)!.a2aDepth).toBe(0);
    const ok = await h.control.send({
      caller: { kind: 'session', sessionId: chain[5]! },
      targetSessionId: chain[6]!,
      text: '重置后再发',
    });
    expect(ok.status).toBe('delivered');
  });
});

/* ---------------- interrupt / 审计 ---------------- */

describe('操控受理器——interrupt 守卫与 capability/used 审计', () => {
  it('interrupt 在飞打断回执 interrupted；idle/休眠目标 SESSION_INACTIVE 响亮拒', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const caller = h.manager.create();
    const busyTarget = h.manager.create();
    const run = h.manager.driverOf(busyTarget.sessionId)!.submit('长任务');
    await vi.waitFor(() => expect(h.manager.driverOf(busyTarget.sessionId)!.running).toBe(true));
    await expect(
      h.control.interrupt({
        caller: { kind: 'session', sessionId: caller.sessionId },
        targetSessionId: busyTarget.sessionId,
      }),
    ).resolves.toMatchObject({
      status: 'interrupted',
      targetSessionId: busyTarget.sessionId,
      stillQueued: [],
      queuedCount: 0,
    });
    h.releaseAll();
    await run;
    // idle 目标：无在飞可打 → 响亮拒不静默 no-op
    const idleTarget = h.manager.create();
    await expect(
      h.control.interrupt({
        caller: { kind: 'session', sessionId: caller.sessionId },
        targetSessionId: idleTarget.sessionId,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_INACTIVE' });
    // 休眠目标（durable-only 未 open）同判——打断休眠会话无在飞 run
    const dormant = persistence.createSession({ origin: 'conversation' });
    dormant.append('user/message', { content: '历史', source: 'user' });
    await persistence.flush();
    await expect(
      h.control.interrupt({
        caller: { kind: 'session', sessionId: caller.sessionId },
        targetSessionId: dormant.sessionId,
      }),
    ).rejects.toMatchObject({ code: 'SESSION_INACTIVE' });
  });

  it('capability/used 逐次审计：三动词各记一笔、载荷含动词名/目标/双道归因键', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const caller = h.manager.create();
    const target = h.manager.create();
    const sendReceipt = await h.control.send({
      caller: { kind: 'session', sessionId: caller.sessionId },
      targetSessionId: target.sessionId,
      text: 'hi',
    });
    expect(sendReceipt.status).toBe('delivered');
    h.releaseAll();
    await vi.waitFor(() => expect(h.manager.driverOf(target.sessionId)!.running).toBe(false));
    // withdraw 一笔（从未入队 id——delivered 回执也记：许可已行使）
    await h.control.withdraw({
      caller: { kind: 'session', sessionId: caller.sessionId },
      targetSessionId: target.sessionId,
      messageId: 'msg-x',
    });
    // interrupt 一笔（idle 拒路径不记；再造在飞窗口）
    const run = h.manager.driverOf(target.sessionId)!.submit('再起');
    await vi.waitFor(() => expect(h.manager.driverOf(target.sessionId)!.running).toBe(true));
    await h.control.interrupt({ caller: { kind: 'plugin', pluginId: 'demo' }, targetSessionId: target.sessionId });
    h.releaseAll();
    await run;
    // 三笔：send（session 道归因）/ withdraw（session 道）/ interrupt（plugin 道归因）
    expect(h.used).toEqual([
      {
        capability: 'sessions.control-cross',
        verb: 'send',
        targetSessionId: target.sessionId,
        callerSessionId: caller.sessionId,
      },
      {
        capability: 'sessions.control-cross',
        verb: 'withdraw',
        targetSessionId: target.sessionId,
        callerSessionId: caller.sessionId,
      },
      { capability: 'sessions.control-cross', verb: 'interrupt', targetSessionId: target.sessionId, pluginId: 'demo' },
    ]);
  });
});

/* ---------------- e-5 收口：still_queued 后果清单 + send 幂等窗 ---------------- */
describe('操控受理器——e-5 收口（still_queued 后果清单与 send 幂等位）', () => {
  it('interrupt 回执清单+计数：操控件入清单（可 withdraw）、普通 steer 件只计数不入清单', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const caller = h.manager.create();
    const target = h.manager.create();
    // 目标起一个挂 gate 的 run（busy——steer 入列腿）
    const run = h.manager.driverOf(target.sessionId)!.submit('长任务');
    await vi.waitFor(() => expect(h.manager.driverOf(target.sessionId)!.running).toBe(true));
    const callerInput = {
      caller: { kind: 'session', sessionId: caller.sessionId } as const,
      targetSessionId: target.sessionId,
    };
    // 操控件 ×2（有撤回关联键）+ 普通人面 submit ×1（busy → steer 入列，无键）
    const first = await h.control.send({ ...callerInput, text: '操控件一' });
    const second = await h.control.send({ ...callerInput, text: '操控件二' });
    if (first.status !== 'queued' || second.status !== 'queued') {
      throw new Error(`busy 腿应 queued：${first.status}/${second.status}`);
    }
    // busy 腿 submit 搭在飞 run 结算（Promise 挂到 run 完成）——入列即席，
    // 这里只入队不等结算
    void h.manager.driverOf(target.sessionId)!.submit('普通件');
    // 打断：回执 stillQueued = 操控件 id 清单、queuedCount = 在队总数（含普通件）
    const receipt = await h.control.interrupt(callerInput);
    expect(receipt.status).toBe('interrupted');
    expect(receipt.stillQueued).toEqual([first.messageId, second.messageId]);
    expect(receipt.queuedCount).toBe(3);
    // 清单兑现：仍可对在队操控件 withdraw（打断不清队——对称闭环跨动词成立）
    await expect(h.control.withdraw({ ...callerInput, messageId: first.messageId })).resolves.toMatchObject({
      status: 'withdrawn',
    });
    h.releaseAll();
    await run;
  });

  it('send 幂等位：同键重试返原回执（零新注入零新审计）——命中前置不受世界变化影响', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const caller = h.manager.create();
    const target = h.manager.create();
    const input = {
      caller: { kind: 'session', sessionId: caller.sessionId } as const,
      targetSessionId: target.sessionId,
      text: '只此一条',
      dedupeKey: 'retry-1',
    };
    const first = await h.control.send(input);
    h.releaseAll();
    await vi.waitFor(() => expect(h.manager.driverOf(target.sessionId)!.running).toBe(false));
    const durableCount = () =>
      h.manager
        .driverOf(target.sessionId)!
        .session.events()
        .filter((e) => e.type === 'user/message').length;
    const afterFirst = durableCount();
    const usedAfterFirst = h.used.length;
    // 重试同键：返原回执（原 messageId）——idle 腿已成 delivered，幂等不因目标
    // 转 idle 而吃新路径（命中前置）
    const retry = await h.control.send(input);
    expect(retry).toEqual(first);
    expect(durableCount()).toBe(afterFirst); // 零新注入
    expect(h.used).toHaveLength(usedAfterFirst); // 零新审计（回执重放非新受理）
  });

  it('幂等键按调用方身份分域：session 道与 plugin 道同键不互撞（各成功各入窗）', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const target = h.manager.create();
    const run = h.manager.driverOf(target.sessionId)!.submit('长任务');
    await vi.waitFor(() => expect(h.manager.driverOf(target.sessionId)!.running).toBe(true));
    const sessionCaller = { kind: 'session', sessionId: h.manager.create().sessionId } as const;
    const bySession = await h.control.send({
      caller: sessionCaller,
      targetSessionId: target.sessionId,
      text: '会话道',
      dedupeKey: 'k',
    });
    const byPlugin = await h.control.send({
      caller: { kind: 'plugin', pluginId: 'demo' },
      targetSessionId: target.sessionId,
      text: '插件道',
      dedupeKey: 'k',
    });
    if (bySession.status !== 'queued' || byPlugin.status !== 'queued') {
      throw new Error(`busy 腿应 queued：${bySession.status}/${byPlugin.status}`);
    }
    // 插件道同键不被会话道窗吞——独立入列（busy 腿两件在队）
    expect(byPlugin.messageId).not.toBe(bySession.messageId);
    // 会话道重试仍命中自己的原回执
    await expect(
      h.control.send({ caller: sessionCaller, targetSessionId: target.sessionId, text: '会话道', dedupeKey: 'k' }),
    ).resolves.toEqual(bySession);
    h.releaseAll();
    await run;
  });

  it('拒路径不入窗：同键 send 被拒后重试重新走受理序（世界已变可成功）', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const caller = h.manager.create();
    const target = h.manager.create();
    const input = {
      caller: { kind: 'session', sessionId: caller.sessionId } as const,
      targetSessionId: target.sessionId,
      text: '乐观并发首投',
      dedupeKey: 'stale-1',
      expectedTurnId: 999, // 必不匹配（空会话 durable 无 turn/start → 恒 STALE）
    };
    await expect(h.control.send(input)).rejects.toMatchObject({ code: 'SESSION_TURN_STALE' });
    expect(h.used).toHaveLength(0); // 拒路径零审计
    // 同键重试（去掉乐观位）——拒未入窗，重新受理成功
    const retried = await h.control.send({ ...input, expectedTurnId: undefined });
    expect(retried.status).toBe('delivered');
    h.releaseAll();
  });

  it('幂等窗帽 100 逐最旧：第 101 键入窗逐出首键，首键重试即新受理', async () => {
    const h = makeHarness();
    h.opens.add('sessions.control-cross');
    const caller = h.manager.create();
    const target = h.manager.create();
    const callerOf = { kind: 'session', sessionId: caller.sessionId } as const;
    // 首键（idle 腿 delivered 入窗——随后目标 run 挂 gate 转 busy）
    const first = await h.control.send({
      caller: callerOf,
      targetSessionId: target.sessionId,
      text: '首键',
      dedupeKey: 'k-0',
    });
    if (first.status !== 'delivered') throw new Error(`首键应 delivered：${first.status}`);
    await vi.waitFor(() => expect(h.manager.driverOf(target.sessionId)!.running).toBe(true));
    // 余 100 键（busy 腿 queued 入窗——窗满逐最旧：k-0 被逐出）
    for (let i = 1; i <= 100; i += 1) {
      const receipt = await h.control.send({
        caller: callerOf,
        targetSessionId: target.sessionId,
        text: `t${i}`,
        dedupeKey: `k-${i}`,
      });
      expect(receipt.status).toBe('queued');
    }
    // 末键在窗内（重试幂等命中）；首键已被逐出（重试 = 新受理新 messageId）
    const last = await h.control.send({
      caller: callerOf,
      targetSessionId: target.sessionId,
      text: 't100',
      dedupeKey: 'k-100',
    });
    const firstAgain = await h.control.send({
      caller: callerOf,
      targetSessionId: target.sessionId,
      text: '首键',
      dedupeKey: 'k-0',
    });
    if (last.status !== 'queued' || firstAgain.status !== 'queued') {
      throw new Error(`末键/逐出键重试应 queued：${last.status}/${firstAgain.status}`);
    }
    expect(firstAgain.messageId).not.toBe(first.messageId);
    h.releaseAll();
  });
});
