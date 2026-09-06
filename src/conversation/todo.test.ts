/**
 * todo 机器测试 — fold 推导（遮蔽双向）/ 角色注册（幂等 + 域窃据）/ 快照
 * 渲染 / 工具件（append 收执 + schema 收紧）。
 *
 * 纪律：fold 测试走字面 SessionEvent 数组（纯函数直击语义，不经遮蔽正门的
 * 构造前置）；工具测试的 append 回调桩仅捕获值（mock 停在注入位）。禁断言
 * AI 生成文本——渲染面断言的是本件自产文案（回执/表头），非模型输出。
 */
import { describe, it, expect } from 'vitest';
import { Value } from 'typebox/value';
import type { SessionEvent } from '../contracts/index.js';
import { getMessageRoleDefinition, registerMessageRole } from '../contracts/index.js';
import {
  TODO_ROLE,
  createTodoTool,
  ensureTodoRole,
  foldTodoTable,
  renderTodoTable,
  todoSnapshotMessage,
  type TodoItemData,
} from './todo.js';

/* ---------------- 测试构造件 ---------------- */

/** 字面事件构造（fold 纯函数面——seq 字段不参与判定，占位 0） */
function ev(type: string, data: unknown, occlude?: { start: number; end: number }): SessionEvent {
  return {
    type,
    seq: 0,
    time: 0,
    data,
    ...(occlude !== undefined ? { surfaceOp: { op: 'replace', start: occlude.start, end: occlude.end } } : {}),
  };
}

/** 条目构造简写 */
function item(partial: Partial<TodoItemData> & Pick<TodoItemData, 'content'>): TodoItemData {
  return { status: 'pending', ...partial };
}

const TWO_ITEMS: TodoItemData[] = [item({ content: '甲' }), item({ status: 'completed', content: '乙' })];

/* ---------------- 角色注册 ---------------- */

describe('todo 角色（conversation/todo）', () => {
  // 文件首例先行：此刻注册表必空（vitest 文件隔离），可安全注入窃据定义
  it('域窃据 fail-loud：在册定义另有其身时 ensureTodoRole 抛错', () => {
    const dispose = registerMessageRole(TODO_ROLE, { render: { intent: 'inline' } });
    try {
      expect(() => ensureTodoRole()).toThrow(/占用/);
    } finally {
      dispose();
    }
  });

  it('注册后定义在册，render hidden（瞬态注入呈现面不可见）', () => {
    ensureTodoRole();
    expect(getMessageRoleDefinition(TODO_ROLE)?.render?.intent).toBe('hidden');
  });

  it('幂等：重复调用零异常（多驱动共享进程级注册表）', () => {
    ensureTodoRole();
    ensureTodoRole();
    expect(getMessageRoleDefinition(TODO_ROLE)).toBeDefined();
  });
});

/* ---------------- fold 推导（05 §1.1 倒扫规则，遮蔽感知） ---------------- */

describe('foldTodoTable', () => {
  it('空日志 → 空表', () => {
    expect(foldTodoTable([])).toEqual([]);
  });

  it('单条 todo/write → items 全量回（data 形收窄）', () => {
    expect(foldTodoTable([ev('todo/write', { items: TWO_ITEMS })])).toEqual(TWO_ITEMS);
  });

  it('last-write-wins：两条 todo/write 取后者', () => {
    const events = [ev('todo/write', { items: TWO_ITEMS }), ev('todo/write', { items: [item({ content: '丙' })] })];
    expect(foldTodoTable(events)).toEqual([item({ content: '丙' })]);
  });

  it('todo/write 之后的可见 user/message → 空表（重置语义由推导承载）', () => {
    const events = [ev('todo/write', { items: TWO_ITEMS }), ev('user/message', { content: '用户出手' })];
    expect(foldTodoTable(events)).toEqual([]);
  });

  it('assistant/message 不重置（清单跨 assistant 轮持续）', () => {
    const events = [
      ev('todo/write', { items: TWO_ITEMS }),
      ev('assistant/message', { stopReason: 'stop' }),
      ev('turn/end', { reason: 'completed' }),
    ];
    expect(foldTodoTable(events)).toEqual(TWO_ITEMS);
  });

  it('被遮蔽的 todo/write 不成表（对模型不可见即从未发生）', () => {
    // seq0 的 todo/write 被其后事件的 surfaceOp 区间 [0,0] 盖住
    const events = [
      ev('todo/write', { items: TWO_ITEMS }),
      ev('assistant/message', { stopReason: 'error' }, { start: 0, end: 0 }),
    ];
    expect(foldTodoTable(events)).toEqual([]);
  });

  it('被遮蔽的 user/message 不重置（遮蔽双向同律）', () => {
    // seq1 的 user/message 被遮蔽；倒扫跳过它，seq0 清单仍生效
    const events = [
      ev('todo/write', { items: TWO_ITEMS }),
      ev('user/message', { content: '被遮出手' }),
      ev('assistant/message', { stopReason: 'error' }, { start: 1, end: 1 }),
    ];
    expect(foldTodoTable(events)).toEqual(TWO_ITEMS);
  });

  it('读侧防御：坏条目丢弃、好条目保留；items 非数组 → 空表', () => {
    const events = [
      ev('todo/write', {
        items: [
          item({ content: '好条目' }),
          { status: 'bogus', content: 'status 出词表' },
          { status: 'pending', content: 42 },
          '非对象',
          { status: 'completed', content: '带合法 activeForm', activeForm: '进行文案' },
        ],
      }),
    ];
    expect(foldTodoTable(events)).toEqual([
      item({ content: '好条目' }),
      { status: 'completed', content: '带合法 activeForm', activeForm: '进行文案' },
    ]);
    expect(foldTodoTable([ev('todo/write', { items: 'not-array' })])).toEqual([]);
    expect(foldTodoTable([ev('todo/write', {})])).toEqual([]);
  });
});

/* ---------------- 快照渲染与注入体 ---------------- */

describe('renderTodoTable / todoSnapshotMessage', () => {
  it('空表 → null（不注入——从不建表/已重置语义不打扰上下文）', () => {
    expect(todoSnapshotMessage([], 1000)).toBeNull();
    expect(todoSnapshotMessage([ev('todo/write', { items: [] })], 1000)).toBeNull();
  });

  it('非空表 → 单条 UserMessage 尾注（timestamp 透传、内容含表头与条目行）', () => {
    const message = todoSnapshotMessage(
      [ev('todo/write', { items: [item({ status: 'in-progress', content: '写实现', activeForm: '正在写实现' })] })],
      1234,
    );
    expect(message).toMatchObject({ role: 'user', timestamp: 1234 });
    expect((message?.content as string) ?? '').toContain('当前任务清单');
  });

  it('渲染体：计数表头 + 连续编号 + status 标签 + 进行中 activeForm 优先', () => {
    const text = renderTodoTable([
      item({ status: 'in-progress', content: '写实现', activeForm: '正在写实现' }),
      item({ content: '补测试' }),
      item({ status: 'completed', content: 'fold 规则' }),
      item({ status: 'deferred', content: '缓办项' }),
    ]);
    const lines = text.split('\n');
    expect(lines[0]).toBe('当前任务清单（共 4 项：进行中 1 · 待办 1 · 已完成 1 · 缓办 1）：');
    expect(lines[1]).toBe('1. [in-progress] 正在写实现');
    expect(lines[2]).toBe('2. [pending] 补测试');
    expect(lines[3]).toBe('3. [completed] fold 规则');
    expect(lines[4]).toBe('4. [deferred] 缓办项');
    expect(renderTodoTable([])).toBe('');
  });
});

/* ---------------- 工具件 ---------------- */

describe('createTodoTool', () => {
  it('execute：全量快照落 append + 一行计数回执', async () => {
    const received: Array<{ items: TodoItemData[] }> = [];
    const tool = createTodoTool((data) => received.push(data));
    const result = await tool.execute(
      {
        items: [
          { status: 'pending', content: '甲' },
          { status: 'in-progress', content: '乙', activeForm: '正在乙' },
        ],
      },
      { toolCallId: 't-todo' },
    );
    expect(received).toEqual([
      {
        items: [
          { status: 'pending', content: '甲' },
          { status: 'in-progress', content: '乙', activeForm: '正在乙' },
        ],
      },
    ]);
    expect(result.content).toEqual([
      { type: 'text', text: '已更新任务清单：2 项（进行中 1 · 待办 1 · 已完成 0 · 缓办 0）' },
    ]);
    expect(result.isError).toBeUndefined();
  });

  it('append 收到独立拷贝（后续改原参数不回染 durable 面）', async () => {
    const received: Array<{ items: TodoItemData[] }> = [];
    const tool = createTodoTool((data) => received.push(data));
    const args = { items: [{ status: 'pending', content: '甲' }] };
    await tool.execute(args, { toolCallId: 't' });
    (args.items[0] as { content?: string }).content = '改后';
    expect(received[0]?.items[0]?.content).toBe('甲');
  });

  it('面恒量：name=todo、effect=read（surface 写非 fs 写，不触发审批对）', () => {
    const tool = createTodoTool(() => undefined);
    expect(tool.name).toBe('todo');
    expect(tool.effect).toBe('read');
  });

  it('schema 收紧：status 出词表/条目多余字段/外层多余字段均拒收', () => {
    const { parameters } = createTodoTool(() => undefined);
    // 合法四形
    expect(Value.Check(parameters, { items: [{ status: 'pending', content: 'x' }] })).toBe(true);
    expect(Value.Check(parameters, { items: [{ status: 'deferred', content: 'x' }] })).toBe(true);
    expect(Value.Check(parameters, { items: [] })).toBe(true);
    expect(Value.Check(parameters, { items: [{ status: 'completed', content: 'x', activeForm: 'y' }] })).toBe(true);
    // 拒收面
    expect(Value.Check(parameters, { items: [{ status: 'bogus', content: 'x' }] })).toBe(false);
    expect(Value.Check(parameters, { items: [{ status: 'pending' }] })).toBe(false);
    expect(Value.Check(parameters, { items: [{ status: 'pending', content: 'x', extra: 1 }] })).toBe(false);
    expect(Value.Check(parameters, { items: [], command: 'rm -rf' })).toBe(false);
    expect(Value.Check(parameters, {})).toBe(false);
  });
});
