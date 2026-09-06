/**
 * goal 段 todo 工具测试——GOAL_TODO_SCOPE 双向执法（段内必携纪律/段外申报
 * 拒/gate 申报位 fail-closed）+ 合法载荷透传（扩展字段入 durable）+ 回执。
 * append 桩捕获（mock 停在注入位）；schema 校验走 typebox Value。
 */
import { describe, expect, it } from 'vitest';
import { Value } from 'typebox/value';
import { BaseError } from '../contracts/index.js';
import { createGoalTodoTool, type GoalTodoToolDeps } from './todo-tool.js';

const SCOPE = { goalId: 'g-1', activatedSeq: 0 };

/** 装配依赖（scope 可编排） */
function deps(overrides: Partial<GoalTodoToolDeps> & { scope?: typeof SCOPE | null } = {}) {
  const appended: { items: unknown[] }[] = [];
  const deps: GoalTodoToolDeps = {
    append: (data) => appended.push(data as { items: unknown[] }),
    getScope: () => (overrides.scope === undefined ? SCOPE : overrides.scope),
    commandGateAllowed: false,
    hasLsp: false,
    nowMs: () => Date.parse('2026-09-07T08:00:00.000Z'),
    ...overrides,
  };
  return { deps, appended };
}

/** 断言 execute 抛指定码 */
async function expectCode(promise: Promise<unknown>, code: string): Promise<BaseError> {
  try {
    await promise;
    expect.unreachable(`应抛 ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
    return err as BaseError;
  }
}

/** 直呼 execute（绕过管道——schema 校验独立测） */
async function run(tool: ReturnType<typeof createGoalTodoTool>, items: unknown[]) {
  return tool.execute({ items }, {} as never);
}

describe('GOAL_TODO_SCOPE 段内执法', () => {
  it('deferred 必携 resume_when；词法坏形拒（可 parse 可判窗）', async () => {
    const { deps: d, appended } = deps();
    const tool = createGoalTodoTool(d);
    await expectCode(run(tool, [{ status: 'deferred', content: '缺窗' }]), 'GOAL_TODO_SCOPE');
    await expectCode(run(tool, [{ status: 'deferred', content: '坏窗', resume_when: 'tomorrow' }]), 'GOAL_TODO_SCOPE');
    expect(appended).toHaveLength(0); // 半批不入 durable
    const ok = await run(tool, [{ status: 'deferred', content: '缓办', resume_when: 'after@+30m' }]);
    expect(appended).toHaveLength(1);
    expect((ok.content as Array<{ type: string }>).length).toBeGreaterThan(0);
  });

  it('completed 必携后继二择一（follow_up 或 no_follow_up）', async () => {
    const { deps: d } = deps();
    const tool = createGoalTodoTool(d);
    await expectCode(run(tool, [{ status: 'completed', content: '失联完成' }]), 'GOAL_TODO_SCOPE');
    await run(tool, [{ status: 'completed', content: '带后继', follow_up: '回访验证' }]);
    await run(tool, [{ status: 'completed', content: '明示无后继', no_follow_up: true }]);
  });

  it('gate 申报位 fail-closed：command 未过 needsWrite/空命令、diagnostics 缺 lsp/空目标集、files 空目标集', async () => {
    const { deps: d } = deps(); // commandGateAllowed: false, hasLsp: false
    const tool = createGoalTodoTool(d);
    const err1 = await expectCode(
      run(tool, [
        { status: 'completed', content: 'x', no_follow_up: true, gate: { kind: 'command', command: 'make' } },
      ]),
      'GOAL_TODO_SCOPE',
    );
    expect(err1.message).toContain('needsWrite');
    const { deps: d2 } = deps();
    const tool2 = createGoalTodoTool({ ...d2, commandGateAllowed: true });
    await expectCode(
      run(tool2, [{ status: 'completed', content: 'x', no_follow_up: true, gate: { kind: 'command', command: '  ' } }]),
      'GOAL_TODO_SCOPE',
    );
    const err2 = await expectCode(
      run(tool2, [
        { status: 'completed', content: 'x', no_follow_up: true, gate: { kind: 'diagnostics', files: ['a.ts'] } },
      ]),
      'GOAL_TODO_SCOPE',
    );
    expect(err2.message).toContain('lsp');
    const { deps: d3 } = deps({ hasLsp: true, commandGateAllowed: true, scope: SCOPE });
    const tool3 = createGoalTodoTool(d3);
    await expectCode(
      run(tool3, [{ status: 'completed', content: 'x', no_follow_up: true, gate: { kind: 'diagnostics', files: [] } }]),
      'GOAL_TODO_SCOPE',
    );
    await expectCode(
      run(tool3, [{ status: 'completed', content: 'x', no_follow_up: true, gate: { kind: 'files', paths: [] } }]),
      'GOAL_TODO_SCOPE',
    );
  });

  it('合法扩展载荷透传 append（扩展字段入 durable todo/write）+ 回执段标记', async () => {
    const { deps: d, appended } = deps({ commandGateAllowed: true });
    const tool = createGoalTodoTool(d);
    const result = await run(tool, [
      {
        status: 'deferred',
        content: '等窗',
        resume_when: 'after@2026-12-01T00:00:00.000Z',
        role: 'user',
        task_class: 'verify',
      },
      { status: 'completed', content: '完', follow_up: '回访', gate: { kind: 'files', paths: ['out/a.txt'] } },
    ]);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.items).toEqual([
      {
        status: 'deferred',
        content: '等窗',
        resumeWhen: 'after@2026-12-01T00:00:00.000Z',
        role: 'user',
        taskClass: 'verify',
      },
      { status: 'completed', content: '完', followUp: '回访', gate: { kind: 'files', paths: ['out/a.txt'] } },
    ]);
    const text = (result.content as Array<{ type: string; text: string }>).map((c) => c.text).join('');
    expect(text).toContain('2 项');
    expect(text).toContain('goal g-1 段');
    expect(text).toContain('判据门 1 项');
  });
});

describe('GOAL_TODO_SCOPE 段外执法（goal 段词汇不悬空）', () => {
  it('非 goal 段申报任何扩展字段即拒；核心四字段照常放行', async () => {
    const { deps: d, appended } = deps({ scope: null });
    const tool = createGoalTodoTool(d);
    const err = await expectCode(
      run(tool, [{ status: 'pending', content: '带悬空字段', resume_when: 'after@+1m' }]),
      'GOAL_TODO_SCOPE',
    );
    expect(err.message).toContain('不在 goal 段');
    await run(tool, [{ status: 'pending', content: '普通条目', activeForm: '做' }]);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.items).toEqual([{ status: 'pending', content: '普通条目', activeForm: '做' }]);
  });
});

describe('schema 面（第一道闸的 goal 段形态）', () => {
  it('扩展字段全列 schema：合法载荷过、未知字段拒（additionalProperties: false）', () => {
    const tool = createGoalTodoTool(deps().deps);
    const schema = tool.parameters;
    expect(
      Value.Check(schema as never, {
        items: [
          {
            status: 'deferred',
            content: 'x',
            resume_when: 'after@+5m',
            role: 'user',
            task_class: 't',
            follow_up: 'f',
            no_follow_up: false,
            gate: { kind: 'files', paths: ['a'] },
            activeForm: 'a',
          },
        ],
      }),
    ).toBe(true);
    expect(Value.Check(schema as never, { items: [{ status: 'pending', content: 'x', mystery: true }] })).toBe(false);
    expect(Value.Check(schema as never, { items: [{ status: 'bogus', content: 'x' }] })).toBe(false);
  });
});
