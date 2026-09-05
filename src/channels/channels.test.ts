/**
 * 通道核全景测试（07 §4.1/§4.3、04 §9——批 10a）：多会话信封分流 / 焦点与
 * 投影拉取 / ui 原语降级链 / 多后端竞速 / 提问队列 FIFO 与收口 / widget 单槽。
 *
 * 假后端是 UiBackend 接口的内存测试替身（本仓接口——非模型层 mock，纪律
 * 不破）；阻塞应答经 deferred 手控，模拟真实后端「signal abort 收保守值」。
 */
import { describe, expect, it } from 'vitest';
import { createChannels } from './service.js';
import type { SessionEnvelope, UiBackend, UiCapabilities } from './types.js';
import type { AgentEvent } from '../agent/index.js';

/** 单次阻塞问询的手控柄（resolve/reject + 该次收到的 signal） */
interface AskHandle<T> {
  readonly message: string;
  readonly signal: AbortSignal | undefined;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
}

/** 可编程假后端：记录一切调用；阻塞应答 deferred 手控；abort 自动保守值收场 */
function fakeBackend(id: string, capsOverride: Partial<UiCapabilities> = {}) {
  const capabilities: UiCapabilities = {
    notify: true,
    confirm: true,
    select: true,
    input: true,
    setStatus: true,
    setWidget: true,
    ...capsOverride,
  };
  const notified: { message: string; level?: string }[] = [];
  const confirmAsks: AskHandle<boolean>[] = [];
  const selectAsks: AskHandle<string>[] = [];
  const inputAsks: AskHandle<string>[] = [];
  const statusSet: { sessionId: string; status: string }[] = [];
  const widgets: { sessionId: string; node: unknown }[] = [];
  const envelopes: { env: SessionEnvelope; focused: boolean }[] = [];
  const repaints: { sessionId: string; projection: readonly unknown[]; widget: { node: unknown } | null }[] = [];
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
    setStatus: (sessionId, status) => statusSet.push({ sessionId, status }),
    setWidget: (sessionId, node) => widgets.push({ sessionId, node }),
    onEnvelope: (env, focused) => envelopes.push({ env, focused }),
    onRepaint: (sessionId, projection, widget) => repaints.push({ sessionId, projection, widget }),
  };
  return {
    backend,
    capabilities,
    setAudience(v: boolean) {
      audience = v;
    },
    notified,
    confirmAsks,
    selectAsks,
    inputAsks,
    statusSet,
    widgets,
    envelopes,
    repaints,
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
