/**
 * 通道核全景测试（07 §4.1/§4.3、04 §9——批 10a）：多会话信封分流 / 焦点与
 * 投影拉取 / ui 原语降级链 / 多后端竞速 / 提问队列 FIFO 与收口 / widget 单槽。
 *
 * 假后端是 UiBackend 接口的内存测试替身（本仓接口——非模型层 mock，纪律
 * 不破）；阻塞应答经 deferred 手控，模拟真实后端「signal abort 收保守值」。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { createChannels } from './service.js';
import type { ApprovalAskAnswer, SessionEnvelope, UiBackend, UiCapabilities } from './types.js';
import type { AgentEvent } from '../agent/index.js';

/** 单次阻塞问询的手控柄（resolve/reject + 该次收到的 signal） */
interface AskHandle<T> {
  readonly message: string;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

/** 可编程假后端：记录一切调用；阻塞应答 deferred 手控；abort 自动保守值收场。
 * withAlt = 带件 8 副屏可选钩（收起 / 开回看 / 开记忆管理面——缺席即无副屏
 * 后端的零义务形）；openMemory 返值经 setMemoryOpen 编程（缺省 false） */
function fakeBackend(id: string, capsOverride: Partial<UiCapabilities> = {}, withAlt = false) {
  const capabilities: UiCapabilities = {
    notify: true,
    confirm: true,
    select: true,
    input: true,
    setStatus: true,
    setWidget: true,
    approval: true,
    ...capsOverride,
  };
  const notified: { message: string; level?: string }[] = [];
  const confirmAsks: AskHandle<boolean>[] = [];
  const selectAsks: AskHandle<string>[] = [];
  const inputAsks: AskHandle<string>[] = [];
  const approvalAsks: AskHandle<ApprovalAskAnswer>[] = [];
  const statusSet: { sessionId: string; status: string }[] = [];
  const widgets: { sessionId: string; node: unknown }[] = [];
  const envelopes: { env: SessionEnvelope; focused: boolean }[] = [];
  const repaints: { sessionId: string; projection: readonly unknown[]; widget: { node: unknown } | null }[] = [];
  const collapses: number[] = [];
  const historyOpens: { sessionId: string; messages: readonly unknown[] }[] = [];
  const memoryOpens: number[] = [];
  let memoryOpenReturn = false;
  const sessionsOpens: { sessions: readonly unknown[]; onSelect: (sessionId: string) => void; totalCount?: number }[] =
    [];
  let sessionsOpenReturn = false;
  const usageOpens: { sessionId: string; summary: unknown }[] = [];
  let usageOpenReturn = false;
  let audience = true;

  function deferredPush<T>(asks: AskHandle<T>[], message: string, signal: AbortSignal | undefined): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      asks.push({ message, signal, resolve, reject });
      // 模拟真实后端：abort 撤销收保守值（撤销说明行的核侧证据 = signal 已传到）
      signal?.addEventListener('abort', () => resolve(null as unknown as T), { once: true });
    });
  }

  const backend: UiBackend<never> = {
    id,
    capabilities,
    hasAudience: () => audience,
    notify: (message, opts) => notified.push({ message, level: opts?.level }),
    confirm: (message, opts) => deferredPush(confirmAsks, message, opts?.signal),
    select: (message, _choices, opts) => deferredPush(selectAsks, message, opts?.signal),
    input: (message, opts) => deferredPush(inputAsks, message, opts?.signal),
    askApproval: (_sessionId, request, opts) =>
      deferredPush(approvalAsks, request.summary, opts?.signal) as Promise<ApprovalAskAnswer>,
    setStatus: (sessionId, status) => statusSet.push({ sessionId, status }),
    setWidget: (sessionId, node) => widgets.push({ sessionId, node }),
    onEnvelope: (env, focused) => envelopes.push({ env, focused }),
    onRepaint: (sessionId, projection, widget) => repaints.push({ sessionId, projection, widget }),
    // 件 8 副屏可选钩 + mm 批 openMemory（在场即能力——withAlt 才挂，缺席形零义务）
    ...(withAlt
      ? {
          collapseAltScreen: () => collapses.push(collapses.length),
          openHistory: (sessionId: string, messages: readonly never[]) => historyOpens.push({ sessionId, messages }),
          openMemory: () => {
            memoryOpens.push(memoryOpens.length);
            return memoryOpenReturn;
          },
          openSessions: (sessions: readonly never[], onSelect: (sessionId: string) => void, totalCount?: number) => {
            sessionsOpens.push({ sessions, onSelect, totalCount });
            return sessionsOpenReturn;
          },
          openUsage: (sessionId: string, summary: never) => {
            usageOpens.push({ sessionId, summary });
            return usageOpenReturn;
          },
        }
      : {}),
  };
  return {
    backend,
    capabilities,
    setAudience(v: boolean) {
      audience = v;
    },
    /** openMemory 返值编程（缺省 false——降级提示路的诚实位） */
    setMemoryOpen(v: boolean) {
      memoryOpenReturn = v;
    },
    /** openSessions/openUsage 返值编程（缺省 false） */
    setSessionsOpen(v: boolean) {
      sessionsOpenReturn = v;
    },
    setUsageOpen(v: boolean) {
      usageOpenReturn = v;
    },
    notified,
    confirmAsks,
    selectAsks,
    inputAsks,
    approvalAsks,
    statusSet,
    widgets,
    envelopes,
    repaints,
    collapses,
    historyOpens,
    memoryOpens,
    sessionsOpens,
    usageOpens,
  };
}

/** 最小信封构造 */
function env(sessionId: string, event: AgentEvent): SessionEnvelope {
  return { sessionId, event };
}

describe('多会话注册与信封分流', () => {
  it('emit 按聚焦位路由扇出：聚焦 true / 非聚焦 false / 焦点空悬全体 false', () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    s.registerSession('a');
    s.registerSession('b');
    void s.focus('a');

    s.emit(env('a', { type: 'agent_start' }));
    s.emit(env('b', { type: 'agent_start' }));
    expect(b.envelopes.map((e) => [e.env.sessionId, e.focused])).toEqual([
      ['a', true],
      ['b', false],
    ]);

    // 聚焦会话退场 → 焦点空悬（不自动接续）——余者全非聚焦
    s.unregisterSession('a');
    s.emit(env('b', { type: 'agent_end', status: 'completed' }));
    expect(b.envelopes[2]?.focused).toBe(false);
    expect(s.focusedId).toBeNull();
  });

  it('removeBackend 后不再收事件（后端管理面）', () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    s.emit(env('x', { type: 'agent_start' }));
    s.removeBackend('tui');
    s.emit(env('x', { type: 'agent_start' }));
    expect(b.envelopes.length).toBe(1);
  });
});

describe('焦点与投影拉取', () => {
  it('focus 拉投影 → repaint 扇出全后端并重放 widget 槽值', async () => {
    const projection = [{ role: 'user' }, { role: 'assistant' }];
    const s = createChannels({ fetchProjection: async (id) => (id === 'a' ? projection : []) });
    const b1 = fakeBackend('tui');
    const b2 = fakeBackend('web');
    s.addBackend(b1.backend);
    s.addBackend(b2.backend);
    s.setWidget('a', { kind: 'demo' });

    await s.focus('a');
    expect(b1.repaints).toEqual([{ sessionId: 'a', projection, widget: { node: { kind: 'demo' } } }]);
    expect(b2.repaints.length).toBe(1);
  });

  it('投影拉取缺席 → 空投影重画（诚实缺席不假装）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    await s.focus('fresh');
    expect(b.repaints).toEqual([{ sessionId: 'fresh', projection: [], widget: null }]);
  });

  it('拉取异常 fail-loud 上抛（不降级为「无历史」谎言）', async () => {
    const s = createChannels({
      fetchProjection: async () => {
        throw new Error('store broken');
      },
    });
    await expect(s.focus('a')).rejects.toThrow('store broken');
  });

  it('快速切焦：迟到的旧投影不落画（只为本焦点重画）', async () => {
    let releaseA: (v: readonly unknown[]) => void = () => {};
    const s = createChannels({
      fetchProjection: (id): Promise<readonly unknown[]> =>
        id === 'a'
          ? new Promise((r) => {
              releaseA = r;
            })
          : Promise.resolve(['b-proj']),
    });
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    const focusA = s.focus('a');
    await s.focus('b'); // A 的投影还在飞
    releaseA(['a-proj']);
    await focusA;
    expect(b.repaints.map((r) => r.sessionId)).toEqual(['b']);
  });
});

describe('confirm 竞速与降级链', () => {
  it('多后端竞速先答先得，败腿经 signal 撤销（04 §9 跨入口竞速）', async () => {
    const s = createChannels();
    const b1 = fakeBackend('tui');
    const b2 = fakeBackend('web');
    s.addBackend(b1.backend);
    s.addBackend(b2.backend);

    const p = s.confirm('s1', '做吗？');
    expect(b1.confirmAsks.length).toBe(1);
    expect(b2.confirmAsks.length).toBe(1);
    b1.confirmAsks[0]?.resolve(true);

    expect(await p).toBe(true);
    expect(b2.confirmAsks[0]?.signal?.aborted).toBe(true);
  });

  it('confirm→input 降级：y/yes 解析为真、其余假', async () => {
    const s = createChannels();
    const b = fakeBackend('web', { confirm: false });
    s.addBackend(b.backend);

    const p1 = s.confirm('s1', '继续？');
    expect(b.inputAsks.length).toBe(1);
    expect(b.inputAsks[0]?.message).toContain('(y/n)');
    b.inputAsks[0]?.resolve('  yes ');
    expect(await p1).toBe(true);

    const p2 = s.confirm('s1', '再继续？');
    b.inputAsks[1]?.resolve('n');
    expect(await p2).toBe(false);
  });

  it('降级到底（零后端）：notify 呈现 + 保守值 false（无人可答 fail-closed）', async () => {
    const s = createChannels();
    expect(await s.confirm('s1', '有人吗？')).toBe(false);
  });

  it('后端异常折保守值（fail-closed）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    const p = s.confirm('s1', 'Q');
    b.confirmAsks[0]?.reject(new Error('backend crash'));
    expect(await p).toBe(false);
  });
});

describe('select 与 input', () => {
  it('select 原生路：回传 value', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    const p = s.select('s1', '选一个', [
      { value: 'a', label: '甲' },
      { value: 'b', label: '乙' },
    ]);
    expect(b.selectAsks.length).toBe(1);
    b.selectAsks[0]?.resolve('b');
    expect(await p).toBe('b');
  });

  it('select→input 降级：编号列表提示；答案不在 value 集保守值 ""', async () => {
    const s = createChannels();
    const b = fakeBackend('web', { select: false });
    s.addBackend(b.backend);
    const p = s.select('s1', '选一个', [{ value: 'a', label: '甲' }]);
    expect(b.inputAsks[0]?.message).toContain('1. 甲 → a');
    b.inputAsks[0]?.resolve('不存在');
    expect(await p).toBe('');
  });

  it('input 直通 placeholder', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    const p = s.input('s1', '名字？', { placeholder: '可选' });
    b.inputAsks[0]?.resolve('berry');
    expect(await p).toBe('berry');
  });
});

describe('提问队列 FIFO 与收口', () => {
  it('同会话严格串行：队首在飞时后继排队，应答后继顶上', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);

    const p1 = s.confirm('s1', '一');
    const p2 = s.confirm('s1', '二');
    expect(s.pendingAsks('s1')).toEqual(['confirm', 'confirm']);
    expect(b.confirmAsks.length).toBe(1); // 只有队首呈现

    b.confirmAsks[0]?.resolve(true);
    expect(await p1).toBe(true);
    expect(b.confirmAsks.length).toBe(2); // 二顶上
    b.confirmAsks[1]?.resolve(false);
    expect(await p2).toBe(false);
    expect(s.pendingAsks('s1')).toEqual([]);
  });

  it('异会话队列独立（各自队首并行呈现）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    void s.confirm('s1', '甲会话问');
    void s.confirm('s2', '乙会话问');
    expect(b.confirmAsks.length).toBe(2);
  });

  it('外部 signal abort → 保守值收场 + 队列推进（撤销面）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    const ac = new AbortController();

    const p1 = s.confirm('s1', '一', { signal: ac.signal });
    const p2 = s.confirm('s1', '二');
    ac.abort();
    expect(await p1).toBe(false);
    expect(b.confirmAsks.length).toBe(2); // 二已顶上
    b.confirmAsks[1]?.resolve(true);
    expect(await p2).toBe(true);
  });

  it('unregisterSession 收口：在飞与排队全保守值 + widget 槽清空', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    s.setWidget('s1', { kind: 'demo' });

    const p1 = s.confirm('s1', '一');
    const p2 = s.select('s1', '二', [{ value: 'x', label: 'X' }]);
    s.unregisterSession('s1');

    expect(await p1).toBe(false);
    expect(await p2).toBe('');
    expect(s.pendingAsks('s1')).toEqual([]);
    // 槽已清：焦点重画不带旧 widget
    const b2 = fakeBackend('tui2');
    s.addBackend(b2.backend);
    await s.focus('s1');
    expect(b2.repaints[0]?.widget).toBeNull();
  });
});

describe('非阻塞原语', () => {
  it('notify 扇出全后端；setStatus/setWidget 扇出 capable 后端', () => {
    const s = createChannels();
    const b1 = fakeBackend('tui');
    const b2 = fakeBackend('web', { setStatus: false, setWidget: false });
    s.addBackend(b1.backend);
    s.addBackend(b2.backend);

    s.notify('s1', '好了', { level: 'success' });
    expect(b1.notified).toEqual([{ message: '好了', level: 'success' }]);
    expect(b2.notified.length).toBe(1);

    s.setStatus('s1', '思考中');
    expect(b1.statusSet).toEqual([{ sessionId: 's1', status: '思考中' }]);
    expect(b2.statusSet).toEqual([]);

    s.setWidget('s1', { n: 1 });
    s.setWidget('s1', { n: 2 }); // 单槽后写胜前写
    s.setWidget('s1', null); // 清空
    expect(b1.widgets.map((w) => w.node)).toEqual([{ n: 1 }, { n: 2 }, null]);
    expect(b2.widgets).toEqual([]);
  });

  it('hasAudience 聚合：零后端假 / 任一后端真即真', () => {
    const s = createChannels();
    expect(s.hasAudience()).toBe(false);
    const b1 = fakeBackend('tui');
    b1.setAudience(false);
    const b2 = fakeBackend('web');
    s.addBackend(b1.backend);
    s.addBackend(b2.backend);
    expect(s.hasAudience()).toBe(true);
    b2.setAudience(false);
    expect(s.hasAudience()).toBe(false);
  });
});

describe('审批 ask（askApproval——07 §4.3 提问队列条款，批 10e-2 契约先行）', () => {
  /** 最小审批载荷（呈现侧形——safety ApprovalRequest 经装配映射） */
  function req(summary: string, suggestedEntry?: string) {
    return suggestedEntry === undefined ? { summary } : { summary, suggestedEntry };
  }

  it('与阻塞三件同队同收口律：FIFO 排队、队首才呈现、应答后继顶上', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);

    const pA = s.askApproval('s1', req('写文件'));
    const pC = s.confirm('s1', '顺手确认？');
    expect(s.pendingAsks('s1')).toEqual(['approval', 'confirm']);
    expect(b.approvalAsks.length).toBe(1); // 审批是队首——confirm 排队
    expect(b.confirmAsks.length).toBe(0);

    b.approvalAsks[0]?.resolve('approve');
    expect(await pA).toBe('approve');
    expect(b.confirmAsks.length).toBe(1); // confirm 顶上
    b.confirmAsks[0]?.resolve(true);
    expect(await pC).toBe(true);
    expect(s.pendingAsks('s1')).toEqual([]);
  });

  it('四值直通（approve/reject/cancel/always——always 带草案才直通）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    const answers: ApprovalAskAnswer[] = [];
    for (const value of ['approve', 'reject', 'cancel', 'always'] as const) {
      const p = s.askApproval('s1', req('Q', '/tmp/x.txt')); // 带草案——always 不防御收口
      b.approvalAsks.at(-1)?.resolve(value);
      answers.push(await p);
    }
    expect(answers).toEqual(['approve', 'reject', 'cancel', 'always']);
  });

  it('always + 草案 → onApprovalAlways 回写回调以草案条目调用（04 §9 ③ 通道侧接法）', async () => {
    const written: string[] = [];
    const s = createChannels({ onApprovalAlways: (entry) => written.push(entry) });
    const b = fakeBackend('tui');
    s.addBackend(b.backend);

    const p = s.askApproval('s1', req('写文件', '/tmp/target.txt'));
    b.approvalAsks[0]?.resolve('always');
    expect(await p).toBe('always');
    expect(written).toEqual(['/tmp/target.txt']);
  });

  it('无草案 always 防御收口视同 approve（零草案零副作用——回写不触发）', async () => {
    const written: string[] = [];
    const s = createChannels({ onApprovalAlways: (entry) => written.push(entry) });
    const b = fakeBackend('tui');
    s.addBackend(b.backend);

    const p = s.askApproval('s1', req('无草案动作'));
    b.approvalAsks[0]?.resolve('always');
    expect(await p).toBe('approve');
    expect(written).toEqual([]);
  });

  it('会话收口与外部 signal abort → cancel（非 unavailable；run 信号透传 ask 链对齐）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);

    const p1 = s.askApproval('s1', req('一'));
    s.unregisterSession('s1');
    expect(await p1).toBe('cancel');

    const ac = new AbortController();
    const p2 = s.askApproval('s2', req('二'), { signal: ac.signal });
    ac.abort();
    expect(await p2).toBe('cancel');
  });

  it('降级到底（零 capable 后端）：notify 呈现摘要 + unavailable（headless 结构态——04 §9 无应答者非用户取消）', async () => {
    const s = createChannels();
    const b = fakeBackend('web', { approval: false });
    s.addBackend(b.backend);
    // 2026-09-13 真模型实测批：修前误答 'cancel'（decided 错标 cancel/user）
    expect(await s.askApproval('s1', req('危险写'))).toBe('unavailable');
    expect(b.approvalAsks).toEqual([]);
    expect(b.notified.map((n) => n.message)).toEqual(['危险写']);
  });

  it('capabilities.approval=false 的后端不吃 askApproval（能力门与阻塞三件同律）', async () => {
    const s = createChannels();
    const b1 = fakeBackend('web', { approval: false });
    const b2 = fakeBackend('tui');
    s.addBackend(b1.backend);
    s.addBackend(b2.backend);

    const p = s.askApproval('s1', req('写文件'));
    expect(b1.approvalAsks.length).toBe(0);
    expect(b2.approvalAsks.length).toBe(1);
    b2.approvalAsks[0]?.resolve('reject');
    expect(await p).toBe('reject');
  });
});

describe('/history 命令面（07 §4.1 件 8——批 10f-4：在场即注册、缺席不注册不虚报）', () => {
  it('history() 在场：/history 注册 + 分发拉全量投影扇出 openHistory（聚焦会话为真源）', async () => {
    const projection = [{ role: 'user' }, { role: 'assistant' }];
    const fetched: string[] = [];
    const s = createChannels({
      history: async (sessionId) => {
        fetched.push(sessionId);
        return projection;
      },
    });
    const b1 = fakeBackend('tui', {}, true); // 带副屏两钩
    const b2 = fakeBackend('web'); // 无副屏钩——缺席零义务
    s.addBackend(b1.backend);
    s.addBackend(b2.backend);
    s.registerSession('a');
    await s.focus('a');

    expect(s.listCommands().map((c) => c.name)).toContain('history'); // 在场即注册
    expect(await s.dispatchCommand('/history')).toBe(true);
    expect(fetched).toEqual(['a']); // 聚焦会话为真源
    expect(b1.historyOpens).toEqual([{ sessionId: 'a', messages: projection }]); // 扇出带钩后端
  });

  it('history() 缺席：不注册不虚报（/history 不在命令面，分发返 false）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    expect(s.listCommands().map((c) => c.name)).not.toContain('history');
    expect(await s.dispatchCommand('/history')).toBe(false);
    expect(b.historyOpens).toEqual([]);
  });

  it('焦点空悬：分发即返（无回看对象——不拉取不虚报不报错）', async () => {
    const s = createChannels({ history: async () => [{ role: 'user' }] });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    expect(await s.dispatchCommand('/history')).toBe(true); // 命令在场被消费
    expect(b.historyOpens).toEqual([]); // 无聚焦会话——零扇出
  });
});

describe('/memory 命令面（06 §7 形态定形注①——在场即注册、缺席不注册；扇出 falsy 降级 notify）', () => {
  it('memory 位在场：/memory 注册 + 分发扇出 openMemory（返 true 即成功、零 notify）', async () => {
    const s = createChannels({ memory: true });
    const b1 = fakeBackend('tui', {}, true); // 带副屏钩——openMemory 返 true
    b1.setMemoryOpen(true);
    const b2 = fakeBackend('web'); // 无副屏钩——缺席零义务
    s.addBackend(b1.backend);
    s.addBackend(b2.backend);
    expect(s.listCommands().map((c) => c.name)).toContain('memory'); // 在场即注册
    expect(await s.dispatchCommand('/memory')).toBe(true);
    expect(b1.memoryOpens).toHaveLength(1); // 扇出带钩后端
    expect(b1.notified).toEqual([]); // 已开不降级
  });

  it('全体 falsy（后端返 false——件缺席/不支持形）：notify warn 降级提示（不静默假装已开）', async () => {
    const s = createChannels({ memory: true });
    const b = fakeBackend('tui', {}, true); // 有钩但返 false（材料缺席形）
    s.addBackend(b.backend);
    expect(await s.dispatchCommand('/memory')).toBe(true); // 命令在场被消费
    expect(b.memoryOpens).toHaveLength(1); // 扇出照走——返值诚实
    expect(b.notified).toEqual([{ message: '当前界面不支持记忆管理页（或 memory 插件未安装）', level: 'warn' }]);
  });

  it('无 openMemory 钩后端（如 web）：同为 falsy 位——notify 降级', async () => {
    const s = createChannels({ memory: true });
    const b = fakeBackend('web'); // 无副屏钩
    s.addBackend(b.backend);
    await s.dispatchCommand('/memory');
    expect(b.notified).toHaveLength(1);
    expect(b.notified[0]?.level).toBe('warn');
  });

  it('memory 位缺席：不注册不虚报（/memory 不在命令面，分发返 false）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    expect(s.listCommands().map((c) => c.name)).not.toContain('memory');
    expect(await s.dispatchCommand('/memory')).toBe(false);
    expect(b.memoryOpens).toEqual([]);
    expect(b.notified).toEqual([]);
  });
});

describe('/sessions 命令面（07 §4.1 R7 批 10k——注入在场即注册；选定走 registry.focus 权威路）', () => {
  const list = [
    { id: 's2', title: '乙', updatedAt: 1, active: false },
    { id: 's1', updatedAt: 2, active: true },
  ];

  it('sessions 注入在场：注册 + 分发拉清单扇出 openSessions（返 true 零 notify）', async () => {
    const s = createChannels({ sessions: async () => list });
    const b1 = fakeBackend('tui', {}, true);
    b1.setSessionsOpen(true);
    const b2 = fakeBackend('web'); // 无副屏钩——缺席零义务
    s.addBackend(b1.backend);
    s.addBackend(b2.backend);
    expect(s.listCommands().map((c) => c.name)).toContain('sessions'); // 在场即注册
    expect(await s.dispatchCommand('/sessions')).toBe(true);
    expect(b1.sessionsOpens).toHaveLength(1);
    expect(b1.sessionsOpens[0]!.sessions).toEqual(list); // 清单原样透传
    expect(b1.notified).toEqual([]); // 已开不降级
  });

  it('sessionsTotal 注入在场：总数第三参透传；缺席回退清单长度（B2 截断披露——不虚报全量）', async () => {
    const s = createChannels({ sessions: async () => list, sessionsTotal: async () => 150 });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    expect(b.sessionsOpens[0]!.totalCount).toBe(150); // 全量总数原样透传（超窗切换器头行注记）
    // 缺席腿：不注入 sessionsTotal → 回退清单长度（= 全量已呈现，头行原形）
    const s2 = createChannels({ sessions: async () => list });
    const b2 = fakeBackend('tui', {}, true);
    b2.setSessionsOpen(true);
    s2.addBackend(b2.backend);
    await s2.dispatchCommand('/sessions');
    expect(b2.sessionsOpens[0]!.totalCount).toBe(list.length);
  });

  it('选定回调 = registry.focus 权威路（未注册会话视同注册——焦点即活跃声明）', async () => {
    const s = createChannels({ sessions: async () => list });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    s.registerSession('s1');
    await s.focus('s1');
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('s2'); // 选定未注册会话 s2
    expect(s.focusedId).toBe('s2'); // 焦点同步置位（focus 前半同步）
  });

  it('全体 falsy：notify warn 降级提示（不静默假装已开）', async () => {
    const s = createChannels({ sessions: async () => list });
    const b = fakeBackend('web'); // 无钩后端
    s.addBackend(b.backend);
    expect(await s.dispatchCommand('/sessions')).toBe(true);
    expect(b.notified).toEqual([{ message: '当前界面不支持会话切换', level: 'warn' }]);
  });

  it('sessions 注入缺席：不注册不虚报（/sessions 不在命令面，分发返 false）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    expect(s.listCommands().map((c) => c.name)).not.toContain('sessions');
    expect(await s.dispatchCommand('/sessions')).toBe(false);
    expect(b.sessionsOpens).toEqual([]);
  });
});

describe('/rename 命令面（07 §4.1 2026-09-30 会话管理命令批——renameSession 注入在场即注册；核透传原始名、三态回执路由）', () => {
  /**
   * 改名注入记录 rig：calls 收核透传的 (sessionId, rawTitle)——核不懂净化
   * （写面数据律归注入侧装配层），原始名原样透传；result 编程三态（ok 态
   * title 字段即注入侧净化+帽后的回传名）。
   */
  function renameRig(result: 'ok' | 'empty' | 'missing', okTitle = '净化后新名') {
    const calls: { sessionId: string; title: string }[] = [];
    return {
      calls,
      renameSession: async (sessionId: string, title: string) => {
        calls.push({ sessionId, title });
        return result === 'ok' ? ({ status: 'ok', title: okTitle } as const) : ({ status: result } as const);
      },
    };
  }

  it('注入在场：注册 + 带参直通（argv 重拼多词名）+ ok 回执呈净化后名', async () => {
    const rig = renameRig('ok', '新名 甲乙');
    const s = createChannels({ renameSession: rig.renameSession });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    s.registerSession('s1');
    await s.focus('s1');
    expect(s.listCommands().map((c) => c.name)).toContain('rename'); // 在场即注册
    expect(await s.dispatchCommand('/rename 新名 甲乙', 's1')).toBe(true);
    expect(rig.calls).toEqual([{ sessionId: 's1', title: '新名 甲乙' }]); // argv 重拼——引号感知已拆
    expect(b.notified).toEqual([{ message: '已改名：新名 甲乙', level: undefined }]); // 回执名=注入回传净化后名
  });

  it('核不懂净化：ANSI/超长原始名原样透传；empty 态 warn 拒落库回执', async () => {
    const rig = renameRig('empty');
    const s = createChannels({ renameSession: rig.renameSession });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    const raw = `\x1b[2J${'甲'.repeat(210)}`;
    expect(await s.dispatchCommand(`/rename ${raw}`, 's1')).toBe(true);
    expect(rig.calls).toEqual([{ sessionId: 's1', title: raw }]); // 原样透传——净化+帽归注入侧
    expect(b.notified).toEqual([{ message: '新名字只含不可见字符——换一个再试', level: 'warn' }]);
  });

  it('无参：input ask 主屏输入框——回答直通改名；空输入=取消不落库', async () => {
    const rig = renameRig('ok', '回答名');
    const s = createChannels({ renameSession: rig.renameSession });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    const first = s.dispatchCommand('/rename', 's1');
    b.inputAsks[0]!.resolve('回答名');
    expect(await first).toBe(true);
    expect(rig.calls).toEqual([{ sessionId: 's1', title: '回答名' }]);
    const second = s.dispatchCommand('/rename', 's1');
    b.inputAsks[1]!.resolve('   '); // 全空白输入=取消（注入不触）
    expect(await second).toBe(true);
    expect(rig.calls).toHaveLength(1); // 未再写入
    expect(b.notified).toEqual([
      { message: '已改名：回答名', level: undefined },
      { message: '已取消改名（未输入新名）', level: undefined },
    ]);
  });

  it('missing 态（会话不存在）：诚实拒 warn notify 不静默', async () => {
    const rig = renameRig('missing');
    const s = createChannels({ renameSession: rig.renameSession });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/rename 新名', 's1');
    expect(rig.calls).toEqual([{ sessionId: 's1', title: '新名' }]);
    expect(b.notified).toEqual([{ message: '会话不存在：s1——改名未保存', level: 'warn' }]);
  });

  it('无聚焦会话：warn 诚实拒 + 写面零调用（透传位空且 focusedId 空悬）', async () => {
    const rig = renameRig('ok');
    const s = createChannels({ renameSession: rig.renameSession });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    // 无 registerSession/focus——focusedId 空悬且无 sessionId 透传位
    expect(await s.dispatchCommand('/rename 新名')).toBe(true);
    expect(rig.calls).toEqual([]); // 写面零调用（守卫先行）
    expect(b.notified).toEqual([{ message: '无聚焦会话——先选定会话再改名', level: 'warn' }]);
  });

  it('sessionId 缺席兜底 focusedId：透传位空且焦点在 s2——写面收 s2', async () => {
    const rig = renameRig('ok');
    const s = createChannels({ renameSession: rig.renameSession });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    s.registerSession('s2');
    await s.focus('s2');
    expect(await s.dispatchCommand('/rename 新名')).toBe(true); // 无 sessionId 透传
    expect(rig.calls).toEqual([{ sessionId: 's2', title: '新名' }]); // focusedId 兜底
  });

  it('注入缺席：不注册不虚报（/rename 不在命令面，分发返 false）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    expect(s.listCommands().map((c) => c.name)).not.toContain('rename');
    expect(await s.dispatchCommand('/rename x')).toBe(false);
    expect(b.notified).toEqual([]);
  });
});

describe('/resume 命令面（2026-09-30 会话管理命令批批2——resumeSession 注入在场即注册；带参 open+focus 续接 / 无参复用 /sessions 扇出）', () => {
  const list = [
    { id: 's2', title: '乙', updatedAt: 1, active: false },
    { id: 's1', updatedAt: 2, active: true },
  ];

  /** 续接注入记录 rig（calls 收 id；returnValue 编程 open 成败） */
  function resumeRig(returnValue: boolean) {
    const calls: string[] = [];
    return {
      calls,
      resumeSession: async (sessionId: string) => {
        calls.push(sessionId);
        return returnValue;
      },
    };
  }

  it('注入在场：注册 + 带参直通（open → focus 切焦翻位 + 回执 notify）', async () => {
    const rig = resumeRig(true);
    const s = createChannels({ resumeSession: rig.resumeSession });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    s.registerSession('s1');
    await s.focus('s1');
    expect(s.listCommands().map((c) => c.name)).toContain('resume'); // 在场即注册
    expect(await s.dispatchCommand('/resume s2', 's1')).toBe(true);
    expect(rig.calls).toEqual(['s2']); // 首词即 id（带参直通）
    expect(s.focusedId).toBe('s2'); // open 成功 → registry.focus 权威路切焦
    expect(b.notified.map((n) => n.message)).toContain('已续接：s2');
  });

  it('带参直通后 focus 拒绝：折「切换会话失败」notify 不成 unhandledRejection', async () => {
    // 修前红位：`void registry.focus(id)`（切焦不打断注释位）弃接——拉投影失败
    // 沿 void 逃出成 unhandledRejection 经崩溃编舞 exit(1)；续接回执已发、切焦
    // 失败须诚实补 error 回执（焦点位已同步翻但重画未达——用户面不静默）
    const s = createChannels({
      resumeSession: async () => true,
      fetchProjection: () => Promise.reject(new BaseError('PERSIST_DATA_CORRUPT', '会话库损坏')),
    });
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    expect(await s.dispatchCommand('/resume s2', 's1')).toBe(true);
    await new Promise((r) => setTimeout(r, 0)); // 冲净 focus 拒绝微任务链
    expect(b.notified).toEqual([
      { message: '已续接：s2' },
      { message: '切换会话失败：PERSIST_DATA_CORRUPT：会话库损坏', level: 'error' },
    ]);
  });

  it('带参缺席 id：注入返 false 诚实拒 warn（焦点不动不虚报）', async () => {
    const rig = resumeRig(false);
    const s = createChannels({ resumeSession: rig.resumeSession });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    s.registerSession('s1');
    await s.focus('s1');
    await s.dispatchCommand('/resume no-such', 's1');
    expect(s.focusedId).toBe('s1'); // 切焦不达——open 失败焦点不动
    expect(b.notified).toEqual([{ message: '会话不存在：no-such——输入 /sessions 查看会话列表', level: 'warn' }]);
  });

  it('无参：复用 /sessions 扇出（清单+副屏零新造）', async () => {
    const rig = resumeRig(true);
    const s = createChannels({ resumeSession: rig.resumeSession, sessions: async () => list });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    expect(await s.dispatchCommand('/resume', 's1')).toBe(true);
    expect(b.sessionsOpens).toHaveLength(1); // 同一副屏扇出
    expect(b.sessionsOpens[0]!.sessions).toEqual(list);
  });

  it('/sessions 选定回调升级：resumeSession 在场 → open+focus（选定即续接可写）', async () => {
    const rig = resumeRig(true);
    const s = createChannels({ resumeSession: rig.resumeSession, sessions: async () => list });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('s2');
    expect(rig.calls).toEqual(['s2']); // 选定回调走续接路（open 被调——升级锁）
    await Promise.resolve(); // open.then(focus) 微任务冲刷（异步真源正确等待）
    expect(s.focusedId).toBe('s2');
  });

  it('resumeSession 缺席：/sessions 选定回调保持纯 focus（零行为变）', async () => {
    const rig = resumeRig(true);
    const s = createChannels({ sessions: async () => list }); // 无 resume 注入
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('s2');
    expect(rig.calls).toEqual([]); // open 不触——查看器语义原样
    expect(s.focusedId).toBe('s2'); // focus 仍达
  });

  it('选定回调注入同步抛：折 notify 不穿炸（副屏 onSelect 不许成崩溃入口）', async () => {
    // 生产形：注入闭包非 async、读面预检在会话库中段损坏时同步抛
    // PERSIST_DATA_CORRUPT——穿 onSelect/alt-screen/engine 的 uncaughtException
    // 会杀整个 TUI；选定回调须就地折 error notify（命令面是用户面不是异常面）
    const calls: string[] = [];
    const s = createChannels({
      sessions: async () => list,
      resumeSession: (sessionId: string): Promise<boolean> => {
        calls.push(sessionId);
        throw new BaseError('PERSIST_DATA_CORRUPT', '会话库损坏');
      },
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    s.registerSession('s1');
    await s.focus('s1');
    await s.dispatchCommand('/sessions');
    expect(() => b.sessionsOpens[0]!.onSelect('s2')).not.toThrow(); // 修前红位：同步抛直穿
    expect(calls).toEqual(['s2']);
    expect(b.notified).toEqual([{ message: '续接失败：PERSIST_DATA_CORRUPT：会话库损坏', level: 'error' }]); // Error 折 message（无 String 的 Error: 前缀）
  });

  it('选定回调注入拒绝态（异步 reject）：折 notify 不成 unhandledRejection', async () => {
    const s = createChannels({
      sessions: async () => list,
      resumeSession: async () => {
        throw new BaseError('PERSIST_DATA_CORRUPT', '会话库损坏');
      },
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('s2');
    await Promise.resolve();
    await Promise.resolve();
    expect(b.notified).toEqual([{ message: '续接失败：PERSIST_DATA_CORRUPT：会话库损坏', level: 'error' }]); // Error 折 message（同上随迁）
  });

  it('选定回调抛非 Error 值（裸串）：String 保底折叠不虚标', async () => {
    // instanceof Error 双腿之保底腿——裸值/裸串走 String()，不许因折叠改形而丢信息
    const s = createChannels({
      sessions: async () => list,
      resumeSession: () => {
        throw '读面预检裸串';
      },
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    expect(() => b.sessionsOpens[0]!.onSelect('s2')).not.toThrow();
    expect(b.notified).toEqual([{ message: '续接失败：读面预检裸串', level: 'error' }]);
  });

  it('选定回调抛 BaseError：码直呈折 notify（修前红位：Error 腿只折 message 丢码——wf_db273e73 seam-P2）', async () => {
    const s = createChannels({
      sessions: async () => list,
      resumeSession: () => {
        throw new BaseError('PERSIST_DATA_CORRUPT', '会话库损坏');
      },
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    expect(() => b.sessionsOpens[0]!.onSelect('s2')).not.toThrow();
    // 与 checkpoint 命令面折面同形（BaseError 码：人读原因——用户可引用错误码）
    expect(b.notified).toEqual([{ message: '续接失败：PERSIST_DATA_CORRUPT：会话库损坏', level: 'error' }]);
  });

  it('选定回调 open 成功后 focus 拒绝：折「切焦失败」notify 不成 unhandledRejection', async () => {
    // 修前红位：`if (ok) void registry.focus(...)` 弃接——focus 拒绝（拉投影失败）
    // 沿 void 逃出成 unhandledRejection；用户面须诚实回执（续接已成功、切焦失败）
    const s = createChannels({
      sessions: async () => list,
      resumeSession: async () => true,
      fetchProjection: () => Promise.reject(new BaseError('PERSIST_DATA_CORRUPT', '会话库损坏')),
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('s2');
    await new Promise((r) => setTimeout(r, 0)); // 冲净 focus 拒绝微任务链（macrotask 边界排空）
    expect(b.notified).toEqual([{ message: '切换会话失败：PERSIST_DATA_CORRUPT：会话库损坏', level: 'error' }]);
  });

  it('选定回调纯 focus 路（resume 缺席）focus 拒绝：折「切焦失败」notify 不成 unhandledRejection', async () => {
    // 修前红位：`else void registry.focus(...)` 同一弃接洞——查看器路同防
    const s = createChannels({
      sessions: async () => list,
      fetchProjection: () => Promise.reject(new BaseError('PERSIST_DATA_CORRUPT', '会话库损坏')),
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('s2');
    await new Promise((r) => setTimeout(r, 0));
    expect(b.notified).toEqual([{ message: '切换会话失败：PERSIST_DATA_CORRUPT：会话库损坏', level: 'error' }]);
  });

  it('选定回调 false 回执：焦点不动 + warn 诚实拒（true 才走 focus——契约对齐文本路）', async () => {
    const rig = resumeRig(false);
    const s = createChannels({ resumeSession: rig.resumeSession, sessions: async () => list });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    s.registerSession('s1');
    await s.focus('s1');
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('s2');
    await Promise.resolve();
    await Promise.resolve();
    expect(s.focusedId).toBe('s1'); // 修前红位：现实现无条件 focus（false 也切）
    expect(b.notified).toEqual([{ message: '会话不存在：s2——输入 /sessions 查看会话列表', level: 'warn' }]);
  });

  it('注入缺席：不注册不虚报（/resume 不在命令面，分发返 false）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    expect(s.listCommands().map((c) => c.name)).not.toContain('resume');
    expect(await s.dispatchCommand('/resume s2')).toBe(false);
    expect(b.notified).toEqual([]);
  });
});

describe('/usage 命令面（07 §4.1 R7 批 10k——聚焦会话为真源；焦点空悬静默）', () => {
  const summary = {
    turns: 2,
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: 0,
    currency: null,
  };

  it('usage 注入在场：注册 + 分发拉聚焦会话汇总扇出 openUsage（返 true 零 notify）', async () => {
    const fetched: string[] = [];
    const s = createChannels({
      usage: async (sessionId) => {
        fetched.push(sessionId);
        return summary;
      },
    });
    const b1 = fakeBackend('tui', {}, true);
    b1.setUsageOpen(true);
    const b2 = fakeBackend('web');
    s.addBackend(b1.backend);
    s.addBackend(b2.backend);
    s.registerSession('a');
    await s.focus('a');
    expect(s.listCommands().map((c) => c.name)).toContain('usage');
    expect(await s.dispatchCommand('/usage')).toBe(true);
    expect(fetched).toEqual(['a']); // 聚焦会话为真源
    expect(b1.usageOpens).toEqual([{ sessionId: 'a', summary }]); // 汇总透传
    expect(b1.notified).toEqual([]);
  });

  it('焦点空悬：分发即返静默（无汇总对象不拉取不虚报不报错）', async () => {
    const fetched: string[] = [];
    const s = createChannels({
      usage: async (sessionId) => {
        fetched.push(sessionId);
        return summary;
      },
    });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    expect(await s.dispatchCommand('/usage')).toBe(true); // 命令在场被消费
    expect(fetched).toEqual([]); // 零拉取
    expect(b.usageOpens).toEqual([]); // 零扇出
    expect(b.notified).toEqual([]); // 静默——非降级提示面
  });

  it('全体 falsy：notify warn 降级提示', async () => {
    const s = createChannels({ usage: async () => summary });
    const b = fakeBackend('web');
    s.addBackend(b.backend);
    s.registerSession('a');
    await s.focus('a');
    await s.dispatchCommand('/usage');
    expect(b.notified).toEqual([{ message: '当前界面不支持用量面板', level: 'warn' }]);
  });

  it('usage 注入缺席：不注册不虚报', async () => {
    const s = createChannels();
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    expect(s.listCommands().map((c) => c.name)).not.toContain('usage');
    expect(await s.dispatchCommand('/usage')).toBe(false);
  });
});

describe('ask 强制收副屏（07 §4.1 件 8——注意力优先级 ask > 回看）', () => {
  it('ask 入口先收副屏再入提问队列：阻塞四件扇出 collapseAltScreen', async () => {
    const s = createChannels();
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);

    const p = s.confirm('s1', '做吗？');
    expect(b.collapses.length).toBe(1); // 入队前已收副屏
    expect(b.confirmAsks.length).toBe(1); // 收副屏不入障——队首照常呈现
    b.confirmAsks[0]?.resolve(true);
    expect(await p).toBe(true);

    void s.select('s1', '选', [{ value: 'x', label: 'X' }]);
    void s.input('s1', '问');
    void s.askApproval('s1', { summary: '写' });
    expect(b.collapses.length).toBe(4); // 阻塞四件每入口各收（幂等归后端）
  });

  it('无副屏钩后端零义务：ask 流程不受影响', async () => {
    const s = createChannels();
    const b = fakeBackend('web'); // 缺席形——无 collapseAltScreen
    s.addBackend(b.backend);
    const p = s.confirm('s1', '做吗？');
    b.confirmAsks[0]?.resolve(true);
    expect(await p).toBe(true);
  });
});

describe('插件域后端注册面（03 §2.7 后端 id 分域律——U3 批 U3-3）', () => {
  it('插件域注册即入全量扇出：notify 恒扇出 + 信封路由达插件后端', () => {
    const s = createChannels();
    const host = fakeBackend('tui');
    const plugin = fakeBackend('webui');
    s.addBackend(host.backend);
    s.registerPluginBackend(plugin.backend);
    expect(s.listPluginBackendIds()).toEqual(['webui']);

    s.registerSession('a');
    s.emit(env('a', { type: 'agent_start' }));
    expect(plugin.envelopes.length).toBe(1); // 双域合流扇出
    s.notify('a', '插件后端在场');
    expect(plugin.notified.map((n) => n.message)).toContain('插件后端在场');
  });

  it('同 id 后写胜出（upsert 原位顶替）：旧实例不再收扇出、清单不增位', () => {
    const s = createChannels();
    const first = fakeBackend('webui');
    const second = fakeBackend('webui');
    s.registerPluginBackend(first.backend);
    s.registerPluginBackend(second.backend);
    expect(s.listPluginBackendIds()).toEqual(['webui']); // 一位不增

    s.registerSession('a');
    s.emit(env('a', { type: 'agent_start' }));
    expect(first.envelopes.length).toBe(0); // 顶替后旧实例出局
    expect(second.envelopes.length).toBe(1); // 后写者胜出
  });

  it('撞宿主域 id 拒 CHANNEL_BACKEND_RESERVED（分域律——宿主后端结构性不可顶替）', () => {
    const s = createChannels();
    s.addBackend(fakeBackend('tui').backend);
    expect(() => s.registerPluginBackend(fakeBackend('tui').backend)).toThrowError(BaseError);
    try {
      s.registerPluginBackend(fakeBackend('tui').backend);
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('CHANNEL_BACKEND_RESERVED');
        expect(err.message).toContain('tui');
        return;
      }
      expect.unreachable();
    }
  });

  it('disposer 三律②：摘除生效 + 同 id 顶替后旧 disposer 无操作', () => {
    const s = createChannels();
    const first = fakeBackend('webui');
    const second = fakeBackend('webui');
    const disposeFirst = s.registerPluginBackend(first.backend);
    disposeFirst();
    expect(s.listPluginBackendIds()).toEqual([]); // 摘除生效

    const disposeAgain = s.registerPluginBackend(first.backend);
    const disposeSecond = s.registerPluginBackend(second.backend); // 顶替 first
    disposeAgain(); // 旧 disposer——身份闸无操作（first 已不在册）
    expect(s.listPluginBackendIds()).toEqual(['webui']);
    disposeSecond();
    expect(s.listPluginBackendIds()).toEqual([]);
  });

  it('宿主域 removeBackend 不动插件域（分域分立——插件摘除只经 disposer）', () => {
    const s = createChannels();
    s.addBackend(fakeBackend('tui').backend);
    s.registerPluginBackend(fakeBackend('webui').backend);
    s.removeBackend('webui'); // 宿主域无此 id——零效果
    expect(s.listPluginBackendIds()).toEqual(['webui']);
    s.removeBackend('tui'); // 摘宿主后端不牵连插件域
    expect(s.listPluginBackendIds()).toEqual(['webui']);
  });
});
