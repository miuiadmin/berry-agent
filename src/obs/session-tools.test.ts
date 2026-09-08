/**
 * 会话维工具族测试（03 §10.8 会话维扩展 / §4.6 第五枚——e-2 观测腿）。
 *
 * 工具层执法面：可见性分轴（树内白给 / 跨树门拒 SESSION_OBSERVE_DENIED /
 * 开门放行 + 逐次审计）、session_list 枚举同门裁、session_status 恒白给、
 * 「问当事人 vs 查档案」行为律 description 带出锁。数据面归
 * session-view.test（假 view 固定返回——层分立）。
 */
import { describe, expect, it } from 'vitest';
import type { ToolDefinition } from '../contracts/index.js';
import { createSessionTools, OBSERVE_CROSS_CAPABILITY } from './session-tools.js';
import type { SessionObserveUsedRecord, SessionToolsDeps } from './session-tools.js';
import type { SessionSummaryRow, SessionView } from './types.js';

/** 假 view（数据面固定——树判定受控：'in' 树内 / 其余跨树） */
function fakeView(opts?: { inTree?: readonly string[] }): SessionView {
  const inTree = new Set(opts?.inTree ?? ['caller']);
  const summaries: SessionSummaryRow[] = [
    {
      id: 'caller',
      title: '本会话',
      origin: 'conversation',
      parentId: undefined,
      live: 'idle',
      model: 'm-1',
      updatedAt: 10,
    },
    {
      id: 'child',
      title: '子代理',
      origin: 'delegation',
      parentId: 'caller',
      live: 'running',
      model: 'm-1',
      updatedAt: 20,
    },
    {
      id: 'other',
      title: '他树',
      origin: 'conversation',
      parentId: undefined,
      live: 'idle',
      model: undefined,
      updatedAt: 30,
    },
  ];
  return {
    listSessions: () => summaries,
    readTail: (sessionId) => ({
      exists: sessionId !== 'ghost',
      items:
        sessionId === 'ghost'
          ? []
          : [
              { seq: 0, time: 1, type: 'turn/start', summary: '' },
              { seq: 1, time: 2, type: 'tool/call', summary: 'name=fs_read' },
            ],
    }),
    trace: (sessionId) => ({
      sessionId,
      exists: true,
      live: 'running',
      recent: [{ seq: 5, time: 50, type: 'tool/call', summary: 'name=bash' }],
      inflightTools: ['bash'],
    }),
    selfStatus: (sessionId) => ({
      sessionId,
      origin: 'conversation',
      parentId: undefined,
      workspaceRoot: '/w',
      live: 'idle',
      model: 'm-1',
    }),
    isSameTree: (a, _b) => inTree.has(a) || a === 'caller',
  };
}

/** 工具集速构（opens 与审计收集器可注入） */
function toolsFor(opts?: {
  opens?: readonly string[];
  inTree?: readonly string[];
  used?: SessionObserveUsedRecord[];
}): readonly ToolDefinition[] {
  const deps: SessionToolsDeps = {
    view: fakeView(opts),
    callerSessionId: 'caller',
    getOpens: () => new Set(opts?.opens ?? []),
    ...(opts?.used !== undefined ? { onCapabilityUsed: (record) => opts.used!.push(record) } : {}),
  };
  return createSessionTools(deps);
}

/** 工具名取件 */
const tool = (defs: readonly ToolDefinition[], name: string): ToolDefinition => {
  const found = defs.find((def) => def.name === name);
  if (found === undefined) throw new Error(`工具 ${name} 不在族中`);
  return found;
};

describe('工具族形制', () => {
  it('四件齐备：session_ 前缀 + effect read + 恒挂载（工厂直出全量不随门裁挂载）', () => {
    const defs = toolsFor();
    expect(defs.map((def) => def.name)).toEqual(['session_list', 'session_read', 'session_trace', 'session_status']);
    for (const def of defs) expect(def.effect).toBe('read');
  });

  it('「问当事人 vs 查档案」行为律 description 带出（read/trace 两件）', () => {
    const defs = toolsFor();
    expect(tool(defs, 'session_read').description).toContain('向当事会话发消息');
    expect(tool(defs, 'session_trace').description).toContain('向当事会话发消息');
  });
});

describe('session_read / session_trace 可见性分轴', () => {
  it('树内目标白给：零门检零审计，正常回执', async () => {
    const used: SessionObserveUsedRecord[] = [];
    const defs = toolsFor({ used, inTree: ['child'] });
    const result = await tool(defs, 'session_read').execute({ sessionId: 'child' }, {} as never);
    expect(result.isError).toBeUndefined();
    expect(used).toHaveLength(0);
  });

  it('self 特例白给（caller 自读）', async () => {
    const used: SessionObserveUsedRecord[] = [];
    const defs = toolsFor({ used });
    const result = await tool(defs, 'session_read').execute({ sessionId: 'caller' }, {} as never);
    expect(result.isError).toBeUndefined();
    expect(used).toHaveLength(0);
  });

  it('跨树未开门 → isError + [SESSION_OBSERVE_DENIED] 码前置 + 零审计', async () => {
    const used: SessionObserveUsedRecord[] = [];
    const defs = toolsFor({ used });
    const result = await tool(defs, 'session_read').execute({ sessionId: 'other' }, {} as never);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ type: 'text' });
    expect((result.content[0] as { text: string }).text).toContain('[SESSION_OBSERVE_DENIED]');
    expect(used).toHaveLength(0);
  });

  it('跨树开门 → 放行 + 逐次审计（归因键含动词名与目标会话 id）', async () => {
    const used: SessionObserveUsedRecord[] = [];
    const defs = toolsFor({ opens: [OBSERVE_CROSS_CAPABILITY], used });
    const result = await tool(defs, 'session_trace').execute({ sessionId: 'other' }, {} as never);
    expect(result.isError).toBeUndefined();
    expect(used).toEqual([
      {
        capability: OBSERVE_CROSS_CAPABILITY,
        callerSessionId: 'caller',
        verb: 'session_trace',
        targetSessionId: 'other',
      },
    ]);
  });

  it('开门态每次调用逐次审计（非 once）', async () => {
    const used: SessionObserveUsedRecord[] = [];
    const defs = toolsFor({ opens: [OBSERVE_CROSS_CAPABILITY], used });
    await tool(defs, 'session_read').execute({ sessionId: 'other' }, {} as never);
    await tool(defs, 'session_read').execute({ sessionId: 'other' }, {} as never);
    expect(used).toHaveLength(2);
  });

  it('查无此档诚实回执（exists=false 不冒充空档案）', async () => {
    const defs = toolsFor({ opens: [OBSERVE_CROSS_CAPABILITY] });
    const result = await tool(defs, 'session_read').execute({ sessionId: 'ghost' }, {} as never);
    expect(result.isError).toBeUndefined();
    expect((result.content[0] as { text: string }).text).toContain('查无此档');
  });
});

describe('session_list 枚举同门裁', () => {
  it('未开门：只列树内（跨树行滤除）+ 零审计', async () => {
    const used: SessionObserveUsedRecord[] = [];
    const defs = toolsFor({ used, inTree: ['child'] });
    const result = await tool(defs, 'session_list').execute({}, {} as never);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('caller');
    expect(text).toContain('child');
    expect(text).not.toContain('other'); // 跨树不呈现（标题「他树」含 other 字段行整行滤除）
    expect(used).toHaveLength(0);
  });

  it('开门：全列 + 审计（verb=session_list、无单一目标）', async () => {
    const used: SessionObserveUsedRecord[] = [];
    const defs = toolsFor({ opens: [OBSERVE_CROSS_CAPABILITY], used, inTree: ['child'] });
    const result = await tool(defs, 'session_list').execute({}, {} as never);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('other');
    expect(used).toEqual([{ capability: OBSERVE_CROSS_CAPABILITY, callerSessionId: 'caller', verb: 'session_list' }]);
  });
});

describe('session_status 自身坐标', () => {
  it('恒白给（全关门照常）+ 全列呈现', async () => {
    const used: SessionObserveUsedRecord[] = [];
    const defs = toolsFor({ used });
    const result = await tool(defs, 'session_status').execute({}, {} as never);
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain('sessionId=caller');
    expect(text).toContain('workspaceRoot=/w');
    expect(result.isError).toBeUndefined();
    expect(used).toHaveLength(0);
  });
});
