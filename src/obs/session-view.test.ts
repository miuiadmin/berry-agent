/**
 * 会话维视图服务测试（03 §10.8 会话维扩展——e-2 观测腿）。
 *
 * 纯逻辑层：假 deps 内存实现（零真库零挂钟），四数据面 + 尾条推导映射
 * 全分支 + 树判定 fail-closed + 查询帽值锁（03 §10.8 e-2 定形注的回归
 * 锁载体——帽值/映射表变更先改规范再改本测试）。
 */
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '../contracts/index.js';
import { createSessionView } from './session-view.js';
import type { ObsLiveSessionInfo, ObsSessionRow, SessionViewDeps } from './types.js';

/** 内存假 deps 构造（queryEvents 语义对齐 store：fromSeq 含边界升序 limit） */
function fakeDeps(init?: {
  sessions?: readonly ObsSessionRow[];
  events?: readonly { sessionId: string; event: SessionEvent }[];
  active?: readonly ObsLiveSessionInfo[];
  workspaceRoot?: () => string | undefined;
}): SessionViewDeps & { sessionsMap: Map<string, ObsSessionRow> } {
  const sessionsMap = new Map((init?.sessions ?? []).map((row) => [row.id, row]));
  const events = init?.events ?? [];
  return {
    sessionsMap,
    sessions: {
      getSessionRow: (sessionId) => sessionsMap.get(sessionId),
    },
    events: {
      queryEvents: (filter) => {
        let rows = events.filter((entry) => entry.sessionId === filter.sessionId);
        if (filter.types !== undefined && filter.types.length > 0) {
          rows = rows.filter((entry) => filter.types!.includes(entry.event.type));
        }
        if (filter.fromSeq !== undefined) {
          rows = rows.filter((entry) => entry.event.seq >= filter.fromSeq!);
        }
        rows = [...rows].sort((a, b) => a.event.seq - b.event.seq);
        const limit = Math.min(Math.max(1, filter.limit ?? 1000), 10_000);
        return { events: rows.slice(0, limit).map((entry) => entry.event), nextCursor: null };
      },
    },
    liveSessions: {
      listActive: () => init?.active ?? [],
    },
    ...(init?.workspaceRoot !== undefined ? { workspaceRoot: init.workspaceRoot } : {}),
  };
}

/** 会话行速构 */
function row(overrides: Partial<ObsSessionRow> & { id: string }): ObsSessionRow {
  return {
    title: undefined,
    origin: 'conversation',
    parentId: undefined,
    updatedAt: 1_000,
    lastSeq: -1,
    ...overrides,
  };
}

/** 事件速构 */
function ev(type: string, seq: number, data: unknown = {}): SessionEvent {
  return { type, seq, time: seq * 10, data };
}

describe('尾条推导映射（03 §10.8 e-2 定形注单源）', () => {
  it.each([
    ['turn/end', 'idle'],
    ['approval/asked', 'waiting-approval'],
    ['session/paused', 'paused'],
    ['turn/start', 'running'],
    ['user/message', 'running'],
    ['assistant/message', 'running'],
    ['tool/call', 'running'],
    ['tool/result', 'running'],
    ['request/header', 'running'],
    ['llm/usage', 'running'],
    ['gate/decision', 'running'],
    ['approval/decided', 'running'],
    ['custom/word', 'running'],
  ])('尾条 %s → %s', (tailType, expected) => {
    const deps = fakeDeps({
      sessions: [row({ id: 's1', lastSeq: 3 })],
      events: [
        { sessionId: 's1', event: ev('turn/start', 0) },
        { sessionId: 's1', event: ev(tailType, 3) },
      ],
    });
    expect(createSessionView(deps).trace('s1').live).toBe(expected);
  });

  it('turn/end 各 reason 全归 idle（粗状态不分终态细分档）', () => {
    for (const reason of ['completed', 'aborted', 'error', 'interrupted']) {
      const deps = fakeDeps({
        sessions: [row({ id: 's1', lastSeq: 1 })],
        events: [{ sessionId: 's1', event: ev('turn/end', 1, { reason }) }],
      });
      expect(createSessionView(deps).trace('s1').live).toBe('idle');
    }
  });

  it('u-3 停靠翻位：session/paused 尾条 → paused；唤醒消息落账（尾条翻位）→ running——恢复不设对称词的推导侧表达', () => {
    const parked = fakeDeps({
      sessions: [row({ id: 's1', lastSeq: 2 })],
      events: [
        { sessionId: 's1', event: ev('turn/start', 0) },
        { sessionId: 's1', event: ev('session/paused', 2, { reason: 'budget' }) },
      ],
    });
    expect(createSessionView(parked).trace('s1').live).toBe('paused');
    const woken = fakeDeps({
      sessions: [row({ id: 's1', lastSeq: 3 })],
      events: [
        { sessionId: 's1', event: ev('turn/start', 0) },
        { sessionId: 's1', event: ev('session/paused', 2, { reason: 'budget' }) },
        { sessionId: 's1', event: ev('user/message', 3, { source: 'budget-extended' }) },
      ],
    });
    expect(createSessionView(woken).trace('s1').live).toBe('running'); // 尾条翻位即恢复
  });

  it('零事件会话（lastSeq=-1）→ idle', () => {
    const deps = fakeDeps({
      sessions: [row({ id: 's1', lastSeq: -1 })],
      active: [{ sessionId: 's1', origin: 'trigger' }],
    });
    expect(createSessionView(deps).trace('s1').live).toBe('idle');
  });

  it('行缺席但进程内在管 → exists=true 且 idle（零事件新会话形）', () => {
    const deps = fakeDeps({ active: [{ sessionId: 'fresh', origin: 'delegation' }] });
    const trace = createSessionView(deps).trace('fresh');
    expect(trace.exists).toBe(true);
    expect(trace.live).toBe('idle');
  });
});

describe('listSessions', () => {
  it('进程内记录为锚 join durable 行元数据', () => {
    const deps = fakeDeps({
      sessions: [
        row({ id: 'a', title: '主线', origin: 'conversation', parentId: undefined, updatedAt: 42, lastSeq: 5 }),
      ],
      events: [
        { sessionId: 'a', event: ev('request/header', 0, { config: { model: 'model-x' }, reason: 'initial' }) },
        { sessionId: 'a', event: ev('request/header', 3, { config: { model: 'model-y' }, reason: 'change' }) },
      ],
      active: [{ sessionId: 'a', origin: 'conversation' }],
    });
    const [summary] = createSessionView(deps).listSessions();
    expect(summary).toMatchObject({
      id: 'a',
      title: '主线',
      origin: 'conversation',
      model: 'model-y', // 尾条 request/header 胜出
      updatedAt: 42,
      live: 'idle', // 尾条 turn/end 缺——lastSeq=5 但 events 里尾是 seq 3？不：lastSeq=5 无 seq5 事件 → 尾取 undefined → idle
    });
  });

  it('行缺席（零事件新会话）：origin 兜底进程内记录、updatedAt=0、model=undefined', () => {
    const deps = fakeDeps({ active: [{ sessionId: 'fresh', origin: 'trigger' }] });
    const [summary] = createSessionView(deps).listSessions();
    expect(summary).toMatchObject({ id: 'fresh', origin: 'trigger', title: undefined, model: undefined, updatedAt: 0 });
  });

  it('进程内清单帽 100（第 101 条起不列）', () => {
    const active = Array.from({ length: 150 }, (_, i) => ({ sessionId: `s${i}`, origin: 'conversation' }));
    const deps = fakeDeps({ active });
    expect(createSessionView(deps).listSessions()).toHaveLength(100);
  });
});

describe('readTail 尾窗', () => {
  it('从 lastSeq 起回数缺省 50 条、升序', () => {
    const events = Array.from({ length: 80 }, (_, i) => ({
      sessionId: 's1',
      event: ev(i === 79 ? 'turn/end' : 'tool/call', i),
    }));
    const deps = fakeDeps({ sessions: [row({ id: 's1', lastSeq: 79 })], events });
    const window = createSessionView(deps).readTail('s1');
    expect(window.exists).toBe(true);
    expect(window.items).toHaveLength(50);
    expect(window.items[0]!.seq).toBe(30); // 79 - 50 + 1
    expect(window.items[49]!.seq).toBe(79);
  });

  it('limit 越硬帽 200 截到帽', () => {
    const events = Array.from({ length: 300 }, (_, i) => ({ sessionId: 's1', event: ev('tool/call', i) }));
    const deps = fakeDeps({ sessions: [row({ id: 's1', lastSeq: 299 })], events });
    expect(createSessionView(deps).readTail('s1', { limit: 999 }).items).toHaveLength(200);
  });

  it('目标双缺席（无行无进程内）→ exists=false 空窗——「查无此档」不冒充「空档案」', () => {
    const deps = fakeDeps();
    expect(createSessionView(deps).readTail('ghost')).toEqual({ exists: false, items: [] });
  });

  it('摘要事件型感知提取：文本截断 200 字符、name 优先、JSON 兜底', () => {
    const long = 'x'.repeat(500);
    const deps = fakeDeps({
      sessions: [row({ id: 's1', lastSeq: 3 })],
      events: [
        { sessionId: 's1', event: ev('user/message', 0, { content: long }) },
        { sessionId: 's1', event: ev('tool/call', 1, { name: 'fs_read' }) },
        { sessionId: 's1', event: ev('turn/end', 2, { reason: 'completed' }) },
        { sessionId: 's1', event: ev('custom/x', 3, { odd: { nested: true } }) },
      ],
    });
    const items = createSessionView(deps).readTail('s1', { limit: 4 }).items;
    expect(items[0]!.summary).toBe(`${'x'.repeat(200)}…`);
    expect(items[1]!.summary).toBe('name=fs_read');
    expect(items[2]!.summary).toBe('reason=completed');
    expect(items[3]!.summary).toContain('nested');
  });
});

describe('trace 在飞进行态', () => {
  it('尾窗定值 20；call/result 配对收敛——未闭合 tool/call 呈报在飞', () => {
    const events: { sessionId: string; event: SessionEvent }[] = [];
    for (let i = 0; i < 25; i += 1) {
      events.push({ sessionId: 's1', event: ev('assistant/message', i, {}) });
    }
    events.push({ sessionId: 's1', event: ev('tool/call', 25, { toolCallId: 't1', name: 'fs_read' }) });
    events.push({ sessionId: 's1', event: ev('tool/result', 26, { toolCallId: 't1' }) });
    events.push({ sessionId: 's1', event: ev('tool/call', 27, { toolCallId: 't2', name: 'bash' }) });
    const deps = fakeDeps({ sessions: [row({ id: 's1', lastSeq: 27 })], events });
    const report = createSessionView(deps).trace('s1');
    expect(report.recent).toHaveLength(20); // 8..27
    expect(report.recent[0]!.seq).toBe(8);
    expect(report.inflightTools).toEqual(['bash']); // t2 未闭合
    expect(report.live).toBe('running');
  });
});

describe('selfStatus 自身坐标', () => {
  it('id/origin/parentId/workspaceRoot/live/model 全列', () => {
    const deps = fakeDeps({
      sessions: [row({ id: 'me', origin: 'delegation', parentId: 'root', lastSeq: 1 })],
      events: [
        { sessionId: 'me', event: ev('request/header', 0, { config: { model: 'm-1' }, reason: 'initial' }) },
        { sessionId: 'me', event: ev('turn/start', 1) },
      ],
      active: [{ sessionId: 'me', origin: 'delegation' }],
      workspaceRoot: () => '/work/root',
    });
    expect(createSessionView(deps).selfStatus('me')).toEqual({
      sessionId: 'me',
      origin: 'delegation',
      parentId: 'root',
      workspaceRoot: '/work/root',
      live: 'running',
      model: 'm-1',
    });
  });

  it('无 workspaceRoot 注入 → undefined；行缺席 origin 兜底进程内', () => {
    const deps = fakeDeps({ active: [{ sessionId: 'me', origin: 'fork' }] });
    const status = createSessionView(deps).selfStatus('me');
    expect(status.workspaceRoot).toBeUndefined();
    expect(status.origin).toBe('fork');
  });
});

describe('isSameTree 树内判定（parent_id 链同根单源）', () => {
  /** 三会话小树：root ← child ← grand；他树 other-root ← other-child */
  function treeDeps(): ReturnType<typeof fakeDeps> {
    return fakeDeps({
      sessions: [
        row({ id: 'root' }),
        row({ id: 'child', parentId: 'root' }),
        row({ id: 'grand', parentId: 'child' }),
        row({ id: 'other-root' }),
        row({ id: 'other-child', parentId: 'other-root' }),
      ],
    });
  }

  it('同 id 特例（self 天然含）', () => {
    expect(createSessionView(treeDeps()).isSameTree('child', 'child')).toBe(true);
  });

  it('同根父子链与兄弟子树皆同树', () => {
    const view = createSessionView(treeDeps());
    expect(view.isSameTree('grand', 'root')).toBe(true); // 祖先方向
    expect(view.isSameTree('root', 'grand')).toBe(true); // 对称
    expect(view.isSameTree('grand', 'child')).toBe(true);
    expect(view.isSameTree('child', 'other-root')).toBe(false); // 跨根
    expect(view.isSameTree('grand', 'other-child')).toBe(false);
  });

  it('链中段行缺席 → 不可判 = false（fail-closed 跨树）', () => {
    const deps = treeDeps();
    deps.sessionsMap.delete('child'); // grand 的父链断
    expect(createSessionView(deps).isSameTree('grand', 'root')).toBe(false);
  });

  it('行缺席的一侧 → false', () => {
    expect(createSessionView(treeDeps()).isSameTree('ghost', 'root')).toBe(false);
  });

  it('超帽深 64 → 不可判 = false', () => {
    const sessions: ObsSessionRow[] = [];
    for (let i = 0; i <= 70; i += 1) {
      sessions.push(row({ id: `n${i}`, parentId: i === 0 ? undefined : `n${i - 1}` }));
    }
    const deps = fakeDeps({ sessions });
    expect(createSessionView(deps).isSameTree('n70', 'n0')).toBe(false); // 链长 71 超帽
    expect(createSessionView(deps).isSameTree('n63', 'n0')).toBe(true); // 链长 64 恰在帽内
  });

  it('环链（脏数据）→ 超帽收场不吊死', () => {
    const deps = fakeDeps({
      sessions: [row({ id: 'a', parentId: 'b' }), row({ id: 'b', parentId: 'a' })],
    });
    expect(createSessionView(deps).isSameTree('a', 'b')).toBe(false);
  });
});
