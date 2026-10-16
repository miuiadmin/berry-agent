/**
 * 通道核全景测试（07 §4.1/§4.3、04 §9——批 10a）：多会话信封分流 / 焦点与
 * 投影拉取 / ui 原语降级链 / 多后端竞速 / 提问队列 FIFO 与收口 / widget 单槽。
 *
 * 假后端是 UiBackend 接口的内存测试替身（本仓接口——非模型层 mock，纪律
 * 不破）；阻塞应答经 deferred 手控，模拟真实后端「signal abort 收保守值」。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { createChannels, foldErrorText } from './service.js';
import type {
  ApprovalAskAnswer,
  SessionEnvelope,
  UiBackend,
  UiCapabilities,
  UiCallLedger,
  UiClipboardResult,
  UiSessionDeleteResult,
  UiSessionArchiveResult,
  UiSessionPreviewLine,
} from './types.js';
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
function fakeBackend(
  id: string,
  capsOverride: Partial<UiCapabilities> = {},
  withAlt = false,
  /** writeClipboard 回执编程（null = 能力面缺席——webui 挂账形；挖掘 36 轮批 [2]） */
  clipboard: UiClipboardResult | null = { status: 'written' },
) {
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
  const historyOpens: {
    sessionId: string;
    messages: readonly unknown[];
    fork?: unknown;
    reopen?: unknown;
  }[] = [];
  const memoryOpens: number[] = [];
  let memoryOpenReturn = false;
  const sessionsOpens: {
    sessions: readonly unknown[];
    onSelect: (sessionId: string) => void;
    totalCount?: number;
    onDelete?: (sessionId: string) => Promise<UiSessionDeleteResult>;
    onPreview?: (sessionId: string) => Promise<readonly UiSessionPreviewLine[]>;
    onOpenHistory?: (sessionId: string, cursorAt: number) => void;
    initialCursor?: number;
    onLoadMore?: (cursor: string) => Promise<{
      rows: readonly unknown[];
      nextCursor: string | null;
    }>;
    moreCursor?: string | null;
    onArchive?: (sessionId: string, archive: boolean) => Promise<UiSessionArchiveResult>;
    onSwitchView?: (view: 'active' | 'archived') => Promise<{
      rows: readonly unknown[];
      nextCursor: string | null;
      total: number;
    }>;
  }[] = [];
  let sessionsOpenReturn = false;
  const usageOpens: { sessionId: string; summary: unknown }[] = [];
  let usageOpenReturn = false;
  const callsOpens: { sessionId: string; entries: readonly unknown[]; totalCount?: number }[] = [];
  let callsOpenReturn = false;
  const clipboardWrites: { sessionId: string; text: string }[] = [];
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
    // 剪贴板能力面（挖掘 36 轮批 [2]——clipboard 参数 null = 缺席形零义务）
    ...(clipboard !== null
      ? {
          writeClipboard: (sessionId: string, text: string) => {
            clipboardWrites.push({ sessionId, text });
            return clipboard;
          },
        }
      : {}),
    // 件 8 副屏可选钩 + mm 批 openMemory（在场即能力——withAlt 才挂，缺席形零义务）
    ...(withAlt
      ? {
          collapseAltScreen: () => collapses.push(collapses.length),
          openHistory: (
            sessionId: string,
            messages: readonly never[],
            onForkEdit?: (anchor: never) => Promise<unknown>,
            onCloseReopen?: () => void,
          ) => historyOpens.push({ sessionId, messages, fork: onForkEdit, reopen: onCloseReopen }),
          openMemory: () => {
            memoryOpens.push(memoryOpens.length);
            return memoryOpenReturn;
          },
          openSessions: (
            sessions: readonly never[],
            onSelect: (sessionId: string) => void,
            totalCount?: number,
            onDelete?: (sessionId: string) => Promise<UiSessionDeleteResult>,
            onPreview?: (sessionId: string) => Promise<readonly UiSessionPreviewLine[]>,
            onOpenHistory?: (sessionId: string, cursorAt: number) => void,
            initialCursor?: number,
            onLoadMore?: (cursor: string) => Promise<{
              rows: readonly never[];
              nextCursor: string | null;
            }>,
            moreCursor?: string | null,
            onArchive?: (sessionId: string, archive: boolean) => Promise<UiSessionArchiveResult>,
            onSwitchView?: (view: 'active' | 'archived') => Promise<{
              rows: readonly never[];
              nextCursor: string | null;
              total: number;
            }>,
          ) => {
            sessionsOpens.push({
              sessions,
              onSelect,
              totalCount,
              onDelete,
              onPreview,
              onOpenHistory,
              initialCursor,
              onLoadMore,
              moreCursor,
              onArchive,
              onSwitchView,
            });
            return sessionsOpenReturn;
          },
          openUsage: (sessionId: string, summary: never) => {
            usageOpens.push({ sessionId, summary });
            return usageOpenReturn;
          },
          openCalls: (sessionId: string, entries: readonly never[], totalCount?: number) => {
            callsOpens.push({ sessionId, entries, totalCount });
            return callsOpenReturn;
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
    /** openCalls 返值编程（缺省 false） */
    setCallsOpen(v: boolean) {
      callsOpenReturn = v;
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
    callsOpens,
    clipboardWrites,
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

describe('命令完成尾强制重画 refresh（07 §4.1 ZCode TUI 对标批 B2 定形注挂账销账——B2R）', () => {
  it('聚焦者 refresh：现拉投影重画 + widget 槽重放 + 焦点位不动', async () => {
    const first = [{ role: 'user' }, { role: 'assistant' }];
    const second = [{ role: 'assistant' }];
    let calls = 0;
    const s = createChannels({
      fetchProjection: (id): Promise<readonly unknown[]> => {
        calls += 1;
        return Promise.resolve(id === 'a' ? (calls === 1 ? first : second) : []);
      },
    });
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    s.setWidget('a', { kind: 'demo' });
    await s.focus('a');
    expect(b.repaints).toEqual([{ sessionId: 'a', projection: first, widget: { node: { kind: 'demo' } } }]);
    await s.refresh('a');
    // 新拉投影落画（投影已变即时可见）+ widget 槽同笔重放 + 焦点不动
    //（refresh 是纯呈现位非活跃声明——与 focus 的置位分职）
    expect(s.focusedId).toBe('a');
    expect(b.repaints[1]).toEqual({ sessionId: 'a', projection: second, widget: { node: { kind: 'demo' } } });
  });

  it('非聚焦会话 refresh no-op：不重画、不注册、焦点不动', async () => {
    const s = createChannels({ fetchProjection: async (id) => (id === 'a' ? ['a-proj'] : ['b-proj']) });
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    await s.focus('a');
    const before = b.repaints.length;
    await s.refresh('b');
    expect(b.repaints.length).toBe(before); // 只有首聚焦那一笔
    expect(s.hasSession('b')).toBe(false); // 不注册（纯呈现位非活跃声明）
    expect(s.focusedId).toBe('a');
  });

  it('焦点空悬 refresh no-op（无聚焦者无重画对象）', async () => {
    const s = createChannels({ fetchProjection: async () => ['p'] });
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    await s.refresh('a');
    expect(b.repaints).toEqual([]);
    expect(s.focusedId).toBeNull();
  });

  it('refresh 拉取期间切焦：迟到的旧画不落（迟到的旧画弃同律）', async () => {
    let releaseRefresh: (v: readonly unknown[]) => void = () => {};
    let calls = 0;
    const s = createChannels({
      fetchProjection: (id): Promise<readonly unknown[]> => {
        calls += 1;
        if (id === 'a' && calls === 2)
          return new Promise((r) => {
            releaseRefresh = r; // 第二次拉取（refresh 位）挂起——拉取期间切焦
          });
        return Promise.resolve(id === 'a' ? ['a-proj'] : ['b-proj']);
      },
    });
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    await s.focus('a');
    const refreshing = s.refresh('a');
    await s.focus('b'); // refresh 的投影还在飞
    releaseRefresh(['a-proj-2']);
    await refreshing;
    expect(b.repaints.map((r) => r.sessionId)).toEqual(['a', 'b']); // refresh 的迟到画被弃
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

  it('回溯回调注入律（挖掘 36 轮末件——修前红）：forkBeforeMessage 在场才铸第三参、缺席 = undefined', async () => {
    // 在场：openHistory 收函数形第三参（修前红锚——改前扇出仅两参恒 undefined）
    const s1 = createChannels({
      history: async () => [{ role: 'user' }],
      forkBeforeMessage: async () => ({ status: 'vetoed' }),
    });
    const b1 = fakeBackend('tui', {}, true);
    s1.addBackend(b1.backend);
    s1.registerSession('a');
    await s1.focus('a');
    await s1.dispatchCommand('/history');
    expect(typeof b1.historyOpens[0]?.fork).toBe('function');
    // 缺席：/history 照注册照扇出，第三参 undefined（缺席注入律——注册面只系 history）
    const s2 = createChannels({ history: async () => [{ role: 'user' }] });
    const b2 = fakeBackend('tui', {}, true);
    s2.addBackend(b2.backend);
    s2.registerSession('a');
    await s2.focus('a');
    await s2.dispatchCommand('/history');
    expect(b2.historyOpens[0]?.fork).toBeUndefined();
  });
});

describe('/history 回溯回执三态路由（挖掘 36 轮末件——session-rewind-fork：forked 切焦透传 / vetoed·error·异常折 failed + notify）', () => {
  /** 装配捷径：开屏一次取回溯回调（闭包钉开屏时聚焦会话） */
  async function openWithFork(
    forkBefore: (
      sessionId: string,
      beforeSeq: number,
    ) => Promise<{ status: string; sessionId?: string; message?: string }>,
  ) {
    const s = createChannels({
      history: async () => [{ role: 'user' }],
      forkBeforeMessage: forkBefore as never,
    });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    s.registerSession('a');
    await s.focus('a');
    await s.dispatchCommand('/history');
    const fork = b.historyOpens[0]?.fork as (anchor: { seq: number; text: string }) => Promise<{
      status: string;
      sessionId?: string;
    }>;
    return { s, b, fork };
  }

  it('forked：切焦新会话（registry.focus 权威路）+ 回执透传 + 零 notify（成功通告归 TUI 侧）', async () => {
    const { s, b, fork } = await openWithFork(async (sessionId, beforeSeq) => {
      expect(sessionId).toBe('a'); // 闭包钉开屏会话（回调投递真源）
      expect(beforeSeq).toBe(3); // 锚 seq 直传（beforeSeq 语义）
      return { status: 'forked', sessionId: 'fork-1' };
    });
    const receipt = await fork({ seq: 3, text: '原文' });
    expect(receipt).toEqual({ status: 'forked', sessionId: 'fork-1' });
    expect(s.focusedId).toBe('fork-1'); // 切焦生效（未注册 focus 视同注册）
    expect(b.notified).toEqual([]); // 核侧零 notify
  });

  it('vetoed：warn 通告 + failed 回执 + 焦点不迁（钩子否决面）', async () => {
    const { s, b, fork } = await openWithFork(async () => ({ status: 'vetoed' }));
    const receipt = await fork({ seq: 3, text: '原文' });
    expect(receipt).toEqual({ status: 'failed' });
    expect(s.focusedId).toBe('a'); // 不切焦
    expect(b.notified).toEqual([{ message: '回溯被会话钩子否决（session_before_fork）', level: 'warn' }]);
  });

  it('error：error 通告折面（foldErrorText）+ failed 回执', async () => {
    const { b, fork } = await openWithFork(async () => ({ status: 'error', message: '洪水闸超限' }));
    const receipt = await fork({ seq: 3, text: '原文' });
    expect(receipt).toEqual({ status: 'failed' });
    expect(b.notified).toEqual([{ message: '回溯失败：洪水闸超限', level: 'error' }]);
  });

  it('异步 reject：就地折 error notify + failed（不直穿杀 TUI——selectSession 同律）', async () => {
    const { s, b, fork } = await openWithFork(() => Promise.reject(new Error('磁盘满')));
    const receipt = await fork({ seq: 3, text: '原文' });
    expect(receipt).toEqual({ status: 'failed' });
    expect(b.notified.map((n) => n.level)).toEqual(['error']);
    expect(b.notified[0]?.message).toContain('磁盘满'); // foldErrorText 折面非空
    expect(s.focusedId).toBe('a'); // 焦点不动
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
  // 分页形注入 fixture（挖掘 51 轮件 A）：单页全集 + nextCursor null（已到最早）
  const fetchList = async () => ({ rows: list, nextCursor: null as string | null });

  it('sessions 注入在场：注册 + 分发拉清单扇出 openSessions（返 true 零 notify）', async () => {
    const s = createChannels({ sessions: fetchList });
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
    const s = createChannels({ sessions: fetchList, sessionsTotal: async () => 150 });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    expect(b.sessionsOpens[0]!.totalCount).toBe(150); // 全量总数原样透传（超窗切换器头行注记）
    // 缺席腿：不注入 sessionsTotal → 回退清单长度（= 全量已呈现，头行原形）
    const s2 = createChannels({ sessions: fetchList });
    const b2 = fakeBackend('tui', {}, true);
    b2.setSessionsOpen(true);
    s2.addBackend(b2.backend);
    await s2.dispatchCommand('/sessions');
    expect(b2.sessionsOpens[0]!.totalCount).toBe(list.length);
  });

  it('选定回调 = registry.focus 权威路（未注册会话视同注册——焦点即活跃声明）', async () => {
    const s = createChannels({ sessions: fetchList });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    s.registerSession('s1');
    await s.focus('s1');
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('s2'); // 选定未注册会话 s2
    expect(s.focusedId).toBe('s2'); // 焦点同步置位（focus 前半同步）
  });

  it('全体 falsy：notify warn 降级提示（不静默假装已开）', async () => {
    const s = createChannels({ sessions: fetchList });
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

  // —— deleteSession 注入（05 §2.5 会话删除编排定形注①——/sessions 面板删除键：
  // 注入在场即接 picker 删除回调，缺席 = 键无效零行为变；回执三态路由归核 wrapper）——
  it('deleteSession 注入在场：第四参 onDelete 透传后端（注入在场即接键行为）', async () => {
    const s = createChannels({
      sessions: fetchList,
      deleteSession: async () => ({ status: 'deleted' as const }),
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    expect(b.sessionsOpens[0]!.onDelete).toBeInstanceOf(Function); // 透传在场
  });

  it('deleteSession 注入缺席：第四参 undefined（键无效零行为变——不虚报）', async () => {
    const s = createChannels({ sessions: fetchList });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    expect(b.sessionsOpens[0]!.onDelete).toBeUndefined();
  });

  it('删除回执三态路由归核 wrapper：deleted 成功回执 / busy warn 指路等待或先打断 / missing warn 诚实拒', async () => {
    const cases = [
      { status: 'deleted' as const, level: undefined, text: '已删除会话：s1' },
      { status: 'busy' as const, level: 'warn', text: '等待完成或先打断' },
      { status: 'missing' as const, level: 'warn', text: '会话不存在：s1' },
    ];
    for (const { status, level, text } of cases) {
      const s = createChannels({
        sessions: fetchList,
        deleteSession: async () => ({ status }),
      });
      const b = fakeBackend('tui', {}, true);
      b.setSessionsOpen(true);
      s.addBackend(b.backend);
      await s.dispatchCommand('/sessions');
      const onDelete = b.sessionsOpens[0]!.onDelete!;
      await expect(onDelete('s1')).resolves.toEqual({ status }); // 回执原样透传（picker 消费）
      expect(b.notified).toEqual([{ message: expect.stringContaining(text), level }]);
    }
  });

  it('删除回调异常就地折 error notify 不直穿（直穿沿 onSelect 链成 uncaughtException 杀 TUI——selectSession 同律）', async () => {
    const s = createChannels({
      sessions: fetchList,
      deleteSession: async () => {
        throw new Error('库炸了');
      },
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    const onDelete = b.sessionsOpens[0]!.onDelete!;
    // 回执面折非 deleted 值（联合无 error 档——notify 已承载因，回执只需「未删」事实）
    await expect(onDelete('s1')).resolves.toEqual({ status: 'missing' });
    expect(b.notified).toEqual([{ message: expect.stringContaining('删除失败'), level: 'error' }]);
  });

  it('sessionPreview 注入在场：onPreview 第五参原样透传（回执不经核路由——呈现件直消费）；缺席 undefined', async () => {
    // 挖掘 35 轮 B5——尾段预览注入：与 deleteSession 第四参同位同律（注入
    // 在场才透传；异步回执归呈现件缓存+请帧，通道核零路由零包装）
    const onPreview = async (sessionId: string): Promise<readonly UiSessionPreviewLine[]> => [
      { speaker: 'user', text: sessionId },
    ];
    const s = createChannels({ sessions: fetchList, sessionPreview: onPreview });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    expect(b.sessionsOpens[0]!.onPreview).toBe(onPreview); // 闭包原样透传（非包装副本）
    await expect(b.sessionsOpens[0]!.onPreview!('s1')).resolves.toEqual([{ speaker: 'user', text: 's1' }]);
    // 缺席腿：不注入 sessionPreview → 第五参 undefined（面板 tab 键无效零行为变）
    const s2 = createChannels({ sessions: fetchList });
    const b2 = fakeBackend('tui', {}, true);
    b2.setSessionsOpen(true);
    s2.addBackend(b2.backend);
    await s2.dispatchCommand('/sessions');
    expect(b2.sessionsOpens[0]!.onPreview).toBeUndefined();
  });

  // —— 跨工作区切焦告知（挖掘 39 轮件 III——选定回调两路同挂：双侧根在场
  // 且 resolve 归一后不等才发；chosen/prevRoot 均 focus 调用前捕获——focus
  // 入口 await 前同步置位新焦点，事后读恒新值判据恒假）——
  /** 跨库清单（workspaceRoot/title 齐——件 III 告知判据供数面） */
  const wsList = [
    { id: 'a1', title: '题一', workspaceRoot: '/w/alpha', updatedAt: 2, active: true },
    { id: 'b2', title: '题二', workspaceRoot: '/w/beta', updatedAt: 1, active: false },
    { id: 'b3', workspaceRoot: '/w/beta/', updatedAt: 0, active: false }, // 同库尾斜杠变体（resolve 归一锁）+ 无题
  ];
  // 分页形注入 fixture（挖掘 51 轮件 A）——fetchList 同形
  const fetchWsList = async () => ({ rows: wsList, nextCursor: null as string | null });
  /** onSelect 后 notify 在 focus 的 .then 内（异步链）——微任务冲净再断言 */
  const settle = async (): Promise<void> => {
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  it('跨工作区选定：notify 告知新根（@ 引用与命令以新工作区为根——用户预期锚定）', async () => {
    const s = createChannels({ sessions: fetchWsList });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true); // 已开不降级（notify 断言纯净面）
    s.addBackend(b.backend);
    s.registerSession('a1');
    await s.focus('a1'); // 旧焦点 = 库 alpha
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('b2');
    await settle();
    expect(s.focusedId).toBe('b2');
    expect(b.notified).toEqual([
      { message: expect.stringContaining('已切到『题二』——工作区 /w/beta'), level: undefined },
    ]);
  });

  it('同库选定（尾斜杠变体）：resolve 归一后同根零噪音', async () => {
    const s = createChannels({ sessions: fetchWsList });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true); // 已开不降级（notify 断言纯净面）
    s.addBackend(b.backend);
    s.registerSession('b2');
    await s.focus('b2');
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('b3'); // /w/beta/ 对 /w/beta——尾斜杠归一同库
    await settle();
    expect(b.notified).toEqual([]); // 同库零噪音
  });

  it('根缺席诚实不发（旧焦点不在清单——双侧在场才判，宁缺勿谎）', async () => {
    const s = createChannels({ sessions: fetchWsList });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true); // 已开不降级（notify 断言纯净面）
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions'); // 无旧焦点（清单外）——prevRoot 缺席
    b.sessionsOpens[0]!.onSelect('b2');
    await settle();
    expect(b.notified).toEqual([]);
  });

  it('无题形：题严格同 picker 词汇（（无题）占位）', async () => {
    const s = createChannels({ sessions: fetchWsList });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true); // 已开不降级（notify 断言纯净面）
    s.addBackend(b.backend);
    s.registerSession('a1');
    await s.focus('a1');
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('b3'); // 无题会话
    await settle();
    expect(b.notified).toEqual([
      { message: expect.stringContaining('已切到『（无题）』——工作区 /w/beta/'), level: undefined },
    ]);
  });

  it('resumeSession 续接路同挂：open+focus 成功位后告知（两路同挂律）', async () => {
    const s = createChannels({
      sessions: fetchWsList,
      resumeSession: async () => true,
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true); // 已开不降级（notify 断言纯净面）
    s.addBackend(b.backend);
    s.registerSession('a1');
    await s.focus('a1');
    await s.dispatchCommand('/sessions');
    b.sessionsOpens[0]!.onSelect('b2');
    await settle();
    await settle(); // resume 回执 → focus → then 告知（双层异步链）
    expect(s.focusedId).toBe('b2');
    expect(b.notified).toEqual([
      { message: expect.stringContaining('已切到『题二』——工作区 /w/beta'), level: undefined },
    ]);
  });

  // —— 'o' 开史闭包（挖掘 50 轮件 C——两段开合：第六参 openHistoryAt 铸闭包
  // 拉投影开回看器；键面退出 reopen 重发 openSessions 带光标复原位）——
  it('history 注入在场：第六参铸闭包——任意 id 拉投影扇出 openHistory 带 reopen（onForkEdit 诚实缺席）；reopen 重发 openSessions 带 cursorAt 且链自续', async () => {
    const s = createChannels({
      sessions: fetchList,
      history: async (id) => [{ role: 'user', content: id }],
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    const open = b.sessionsOpens[0]!.onOpenHistory!;
    expect(open).toBeInstanceOf(Function); // 注入在场才铸（缺席键无效零行为变）
    open('s2', 1); // picker 光标位 1（任意 id——签名本支持非焦点会话）
    await Promise.resolve(); // fetch 微任务冲刷（.then 链同步扇出）
    await Promise.resolve();
    expect(b.historyOpens[b.historyOpens.length - 1]).toMatchObject({
      sessionId: 's2',
      messages: [{ role: 'user', content: 's2' }],
      fork: undefined, // 'o' 路快照查看语义——回溯编辑是 /history 焦点路独有面
    });
    const reopen = b.historyOpens[b.historyOpens.length - 1]!.reopen as () => void;
    expect(reopen).toBeInstanceOf(Function);
    reopen(); // 键面退出复原（清屏重发非原地复用——快照档原班）
    expect(b.sessionsOpens).toHaveLength(2); // 重发 openSessions
    expect(b.sessionsOpens[1]!.initialCursor).toBe(1); // 光标复原位透传
    expect(b.sessionsOpens[1]!.onOpenHistory).toBe(open); // 链自续——复原后 'o' 仍可用
  });

  // —— 分页两参扇出（挖掘 51 轮件 A——首开与 reopen 两扇出位同带；正向断言
  // 修前红锚：旧代码扇出零第八/九参 = undefined 恒红；53 轮件 B 起 moreCursor
  // 服务层包装 token 单形 v:<view>:<storeCursor>，续页拉剥标记还原真拉）——
  it('分页两参扇出：第八参 onLoadMore 为 Function + 第九参 moreCursor 首拉值（token 包装形）；续页拉剥标记还原 (view, storeCursor) 真拉；reopen 重发同带两参', async () => {
    const pulls: Array<[string, string | undefined]> = [];
    const fetchPage = async (cursor?: string, view?: 'active' | 'archived' | 'all') => {
      pulls.push([cursor ?? '(first)', view]);
      return { rows: list, nextCursor: 'next-1' as string | null };
    };
    const s = createChannels({ sessions: fetchPage, history: async (id) => [{ role: 'user', content: id }] });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    expect(pulls).toEqual([['(first)', undefined]]); // 首拉腿（cursor 缺席；view 缺省=装配侧钉）
    const open = b.sessionsOpens[0]!;
    expect(open.onLoadMore).toBeInstanceOf(Function); // 修前红锚：旧扇出零此参
    expect(open.moreCursor).toBe('v:active:next-1'); // 53 轮件 B：token 单形包装（首开恒活跃视图）
    // 续页拉：剥标记还原 (view, storeCursor)——store cursor 原样真拉 + view 随 token 还原
    const page = await open.onLoadMore!('v:active:next-1');
    expect(page).toEqual({ rows: list, nextCursor: 'v:active:next-1' }); // 回执 nextCursor 同视图再包装
    expect(pulls).toEqual([
      ['(first)', undefined],
      ['next-1', 'active'],
    ]);
    // reopen 重发同带两参（'o' 开史退出复原后分页活——漏带即复原后分页死键）
    open.onOpenHistory!('s2', 0);
    await Promise.resolve();
    await Promise.resolve();
    const reopen = b.historyOpens[b.historyOpens.length - 1]!.reopen as () => void;
    reopen();
    expect(b.sessionsOpens[1]!.onLoadMore).toBeInstanceOf(Function);
    expect(b.sessionsOpens[1]!.moreCursor).toBe('v:active:next-1');
  });

  // —— 归档/视图切换三参扇出（53 轮件 B——onArchive wrapper 三态路由 +
  // onSwitchView 自合成同源 + 坏 token 宽容回落；正向断言修前红锚：旧代码
  // 扇出零第 10/11 参 = undefined 恒红）——
  it('归档与视图切换扇出：archiveSession 注入在场即第十参 wrapper（missing→warn、成功静默、异常折 error）；onSwitchView 第十一参自合成（同 sessions 注入真拉 + 视图域 total + token 包装）；两注入缺席两参 undefined', async () => {
    const archived: Array<[string, boolean]> = [];
    const s = createChannels({
      sessions: async (cursor?: string, view?: 'active' | 'archived' | 'all') => ({
        rows: view === 'archived' ? list.slice(0, 1) : list,
        nextCursor: cursor === undefined ? ('more:' as string | null) : null,
      }),
      sessionsTotal: async () => 42,
      archiveSession: async (id: string, archive: boolean) => {
        archived.push([id, archive]);
        return archive ? { status: 'archived' as const } : { status: 'missing' as const };
      },
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    const open = b.sessionsOpens[0]!;
    // 修前红锚：第十/十一参在位（注入在场）
    expect(open.onArchive).toBeInstanceOf(Function);
    expect(open.onSwitchView).toBeInstanceOf(Function);
    // 归档成功：静默（零 notify——就地滤行归呈现件）+ 回执原样透传
    const ok = await open.onArchive!('s1', true);
    expect(ok).toEqual({ status: 'archived' });
    expect(archived).toEqual([['s1', true]]);
    expect(b.notified).toEqual([]);
    // missing：warn 诚实拒 + 回执透传（picker 留行不滤）
    const miss = await open.onArchive!('s2', false);
    expect(miss).toEqual({ status: 'missing' });
    expect(b.notified).toEqual([{ message: expect.stringContaining('会话不存在'), level: 'warn' }]);
    b.notified.length = 0;
    // 视图切换：同 sessions 注入真拉（首拉腿 view=archived）+ total 视图域 + token 包装
    const switched = await open.onSwitchView!('archived');
    expect(switched).toEqual({ rows: list.slice(0, 1), nextCursor: 'v:archived:more:', total: 42 });
    // 注入缺席形：archiveSession 缺席 → 第十参 undefined（键无效零行为变）
    const s2 = createChannels({ sessions: fetchList });
    const b2 = fakeBackend('tui', {}, true);
    b2.setSessionsOpen(true);
    s2.addBackend(b2.backend);
    await s2.dispatchCommand('/sessions');
    expect(b2.sessionsOpens[0]!.onArchive).toBeUndefined();
    expect(b2.sessionsOpens[0]!.onSwitchView).toBeInstanceOf(Function); // sessions 注入在场即自合成——不依赖 archiveSession
  });

  it('归档回调异常折 error notify 不直穿（回执折 missing——沿 picker 链不成 uncaughtException）', async () => {
    const s = createChannels({
      sessions: fetchList,
      archiveSession: () => Promise.reject(new Error('库炸了')),
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    const receipt = await b.sessionsOpens[0]!.onArchive!('s1', true);
    expect(receipt).toEqual({ status: 'missing' });
    expect(b.notified).toEqual([{ message: expect.stringContaining('归档失败'), level: 'error' }]);
  });

  it('坏 token 宽容回落：非 v: 前缀/坏 view 段视作 active 视图原样 cursor 真拉', async () => {
    const pulls: string[] = [];
    const s = createChannels({
      sessions: async (cursor?: string) => {
        pulls.push(cursor ?? '(first)');
        return { rows: list, nextCursor: null as string | null };
      },
    });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    const open = b.sessionsOpens[0]!;
    // 非 v: 前缀（旧形/坏形）→ active 视图原样透传
    await open.onLoadMore!('raw-cursor');
    // v: 前缀但 view 段坏 → 同宽容（整串原样透传）
    await open.onLoadMore!('v:bogus:x:y');
    expect(pulls).toEqual(['(first)', 'raw-cursor', 'v:bogus:x:y']);
  });

  it('history 注入缺席：第六参 undefined（o 键无效零行为变——不虚报）；拉取失败折 error notify 不直穿', async () => {
    const s = createChannels({ sessions: fetchList });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    await s.dispatchCommand('/sessions');
    expect(b.sessionsOpens[0]!.onOpenHistory).toBeUndefined();
    // 失败腿：fetch reject → error notify（直穿沿 alt 输入链成 uncaughtException
    // 杀 TUI——selectSession 同律防）
    let rejectFetch!: (err: Error) => void;
    const s2 = createChannels({
      sessions: fetchList,
      history: () =>
        new Promise<readonly unknown[]>((_resolve, reject) => {
          rejectFetch = reject;
        }),
    });
    const b2 = fakeBackend('tui', {}, true);
    b2.setSessionsOpen(true);
    s2.addBackend(b2.backend);
    await s2.dispatchCommand('/sessions');
    b2.sessionsOpens[0]!.onOpenHistory!('s1', 0);
    rejectFetch(new Error('库炸了'));
    await Promise.resolve();
    await Promise.resolve();
    expect(b2.notified).toEqual([{ message: expect.stringContaining('回看拉取失败'), level: 'error' }]);
    expect(b2.historyOpens).toEqual([]); // 未开回看器（失败诚实不假装已开）
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
  // 分页形注入 fixture（挖掘 51 轮件 A）——同 /sessions describe 形
  const fetchList = async () => ({ rows: list, nextCursor: null as string | null });

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
    const s = createChannels({ resumeSession: rig.resumeSession, sessions: fetchList });
    const b = fakeBackend('tui', {}, true);
    b.setSessionsOpen(true);
    s.addBackend(b.backend);
    expect(await s.dispatchCommand('/resume', 's1')).toBe(true);
    expect(b.sessionsOpens).toHaveLength(1); // 同一副屏扇出
    expect(b.sessionsOpens[0]!.sessions).toEqual(list);
  });

  it('/sessions 选定回调升级：resumeSession 在场 → open+focus（选定即续接可写）', async () => {
    const rig = resumeRig(true);
    const s = createChannels({ resumeSession: rig.resumeSession, sessions: fetchList });
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
    const s = createChannels({ sessions: fetchList }); // 无 resume 注入
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
      sessions: fetchList,
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
      sessions: fetchList,
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
      sessions: fetchList,
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
      sessions: fetchList,
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
      sessions: fetchList,
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
      sessions: fetchList,
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
    const s = createChannels({ resumeSession: rig.resumeSession, sessions: fetchList });
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

describe('/calls 命令面（07 §4.1 ZCode TUI 对标批 B3——调用台账副屏：注入在场即注册；快照档 dispatch 现读）', () => {
  /** fold 尾窗产物夹具（CallLedger 结构兼容形——两路行 + 截断披露位；注解
   * 钉形防 source/status 字面量宽化成 string） */
  const ledger: UiCallLedger = {
    entries: [
      { source: 'conversation', time: 2, seq: 4, model: 'faux/m1', status: 'stop', attempt: 1, tokens: 30 },
      {
        source: 'oneshot',
        time: 3,
        seq: 7,
        status: 'stop',
        attempt: 1,
        tokens: 12,
        elapsedMs: 800,
        attribution: 'probe',
      },
    ],
    total: 60,
  };

  it('calls 注入在场：注册 + 分发拉聚焦会话台账扇出 openCalls（entries/totalCount 透传，返 true 零 notify）', async () => {
    const fetched: string[] = [];
    const s = createChannels({
      calls: async (sessionId) => {
        fetched.push(sessionId);
        return ledger;
      },
    });
    const b1 = fakeBackend('tui', {}, true);
    b1.setCallsOpen(true);
    const b2 = fakeBackend('web');
    s.addBackend(b1.backend);
    s.addBackend(b2.backend);
    s.registerSession('a');
    await s.focus('a');
    expect(s.listCommands().map((c) => c.name)).toContain('calls');
    expect(await s.dispatchCommand('/calls')).toBe(true);
    expect(fetched).toEqual(['a']); // 聚焦会话为真源（dispatch 时现读——快照档）
    expect(b1.callsOpens).toEqual([{ sessionId: 'a', entries: ledger.entries, totalCount: 60 }]); // 台账透传（尾窗 + 全量计数）
    expect(b1.notified).toEqual([]);
  });

  it('焦点空悬：分发即返静默（无台账对象不拉取不虚报不报错）', async () => {
    const fetched: string[] = [];
    const s = createChannels({
      calls: async (sessionId) => {
        fetched.push(sessionId);
        return ledger;
      },
    });
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    expect(await s.dispatchCommand('/calls')).toBe(true); // 命令在场被消费
    expect(fetched).toEqual([]); // 零拉取
    expect(b.callsOpens).toEqual([]); // 零扇出
    expect(b.notified).toEqual([]); // 静默——非降级提示面
  });

  it('全体 falsy：notify warn 降级提示（文案红锚——调用台账词面）', async () => {
    const s = createChannels({ calls: async () => ledger });
    const b = fakeBackend('web');
    s.addBackend(b.backend);
    s.registerSession('a');
    await s.focus('a');
    await s.dispatchCommand('/calls');
    expect(b.notified).toEqual([{ message: '当前界面不支持调用台账', level: 'warn' }]);
  });

  it('calls 注入缺席：不注册不虚报（/calls 不在命令面，分发返 false）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui', {}, true);
    s.addBackend(b.backend);
    expect(s.listCommands().map((c) => c.name)).not.toContain('calls');
    expect(await s.dispatchCommand('/calls')).toBe(false);
  });
});

describe('/copy 命令面（挖掘 36 轮批 [2]——整轮回复复制：注入在场即注册；回执三态路由归核）', () => {
  it('lastResponse 注入在场：注册 + 分发拉聚焦会话末条回复扇出 writeClipboard（info 回执红锚）', async () => {
    const fetched: string[] = [];
    const s = createChannels({
      lastResponse: async (sessionId) => {
        fetched.push(sessionId);
        return sessionId === 'a' ? '末条回复正文' : null;
      },
    });
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    s.registerSession('a');
    await s.focus('a');
    expect(s.listCommands().map((c) => c.name)).toContain('copy');
    expect(await s.dispatchCommand('/copy')).toBe(true);
    expect(fetched).toEqual(['a']); // 聚焦会话为真源（快照档现读）
    expect(b.clipboardWrites).toEqual([{ sessionId: 'a', text: '末条回复正文' }]); // 注入文本透传
    expect(b.notified).toEqual([{ message: '已复制最近一条回复', level: undefined }]); // info 档回执
  });

  it('注入返 null：warn 红锚「还没有可复制的回复」非静默零写', async () => {
    const s = createChannels({ lastResponse: async () => null });
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    s.registerSession('a');
    await s.focus('a');
    await s.dispatchCommand('/copy');
    expect(b.clipboardWrites).toEqual([]); // 零写
    expect(b.notified).toEqual([{ message: '还没有可复制的回复——发一条消息后再试', level: 'warn' }]);
  });

  it('后端能力面缺席（writeClipboard 不挂）：warn 降级「当前界面不支持剪贴板复制」', async () => {
    const s = createChannels({ lastResponse: async () => '正文' });
    const b = fakeBackend('web', {}, false, null); // null = 能力面缺席（webui 走 SPA 复制径不经 writeClipboard——挖掘 37 轮件 5 后维持缺席形）
    s.addBackend(b.backend);
    s.registerSession('a');
    await s.focus('a');
    await s.dispatchCommand('/copy');
    expect(b.clipboardWrites).toEqual([]);
    expect(b.notified).toEqual([{ message: '当前界面不支持剪贴板复制', level: 'warn' }]);
  });

  it('返 too-large：warn 指路 /export（帽拒写不炸）', async () => {
    const s = createChannels({ lastResponse: async () => '超长正文' });
    const b = fakeBackend('tui', {}, false, { status: 'too-large' });
    s.addBackend(b.backend);
    s.registerSession('a');
    await s.focus('a');
    await s.dispatchCommand('/copy');
    expect(b.clipboardWrites).toEqual([{ sessionId: 'a', text: '超长正文' }]); // 扇出已达（帽在后端判）
    expect(b.notified).toEqual([{ message: '内容过长未复制——可用 /export 导出全文', level: 'warn' }]);
  });

  it('lastResponse 注入缺席：不注册不虚报（/copy 不在命令面，分发返 false）', async () => {
    const s = createChannels();
    const b = fakeBackend('tui');
    s.addBackend(b.backend);
    expect(s.listCommands().map((c) => c.name)).not.toContain('copy');
    expect(await s.dispatchCommand('/copy')).toBe(false);
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

describe('foldErrorText 码单写律（07 §4.1 V-0 注⑤——前缀码 XOR 消息内码）', () => {
  it('message 内嵌 [码] 前缀 → 不再前缀（双写禁——`码：[码] …` 病灶）', () => {
    // 修前红锚：产出「码：[码] …」同码双写（实录病灶 TOOL_TIMEOUT: [TOOL_TIMEOUT] …）
    const err = new BaseError('SESSION_EVENT_OVER_BUDGET', '[SESSION_EVENT_OVER_BUDGET] 事件面超预算');
    expect(foldErrorText(err)).toBe('[SESSION_EVENT_OVER_BUDGET] 事件面超预算');
  });

  it('message 内嵌 `码：` 前缀 → 不再前缀', () => {
    const err = new BaseError('SESSION_NOT_FOUND', 'SESSION_NOT_FOUND：会话未找到');
    expect(foldErrorText(err)).toBe('SESSION_NOT_FOUND：会话未找到');
  });

  it('message 内嵌 `码:`（半角冒号）前缀 → 同律不再前缀', () => {
    const err = new BaseError('SDK_DECODE', 'SDK_DECODE: 帧解码失败');
    expect(foldErrorText(err)).toBe('SDK_DECODE: 帧解码失败');
  });

  it('message 无码形 → 前缀码单写形维持（既有 wf_3c8b00b8 组α律不回退）', () => {
    expect(foldErrorText(new BaseError('PLUGIN_APPLY_FAILED', '装载失败具名'))).toBe(
      'PLUGIN_APPLY_FAILED：装载失败具名',
    );
  });

  it('message 含码但非前缀位（中段引用）→ 前缀维持（判据锚前缀非全文含）', () => {
    const err = new BaseError('SESSION_CLOSED', '会话已关，他处码可查注册表');
    expect(foldErrorText(err)).toBe('SESSION_CLOSED：会话已关，他处码可查注册表');
  });
});
