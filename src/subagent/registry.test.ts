/**
 * JobRegistry 测试——状态机全集（04 §10）：registerKind 词汇闸/first-wins
 * 结算/done 永不 reject/stop 协作幂等/closeOwner 归属围栏/并行帽/终态帽
 * 256 FIFO/emit 活体通知。
 */
import { describe, expect, it, vi } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { createJobRegistry, JOB_RETENTION_CAP } from './registry.js';

/** 断言同步抛指定码 */
function expectCodeSync(fn: () => unknown, code: string): BaseError {
  try {
    fn();
    expect.unreachable(`应抛 ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
    return err as BaseError;
  }
}

describe('JobRegistry 词汇闸', () => {
  it('未登记 kind 拒注册（JOB_KIND_UNKNOWN）；登记后放行且幂等', () => {
    const registry = createJobRegistry();
    expect(registry.hasKind('subagent')).toBe(false);
    expectCodeSync(() => registry.register({ kind: 'subagent', name: 'x', owner: 's1' }), 'JOB_KIND_UNKNOWN');
    registry.registerKind('subagent');
    registry.registerKind('subagent'); // 幂等——词汇集是 Set 语义
    expect(registry.hasKind('subagent')).toBe(true);
    expect(registry.register({ kind: 'subagent', name: 'x', owner: 's1' }).entry.id).toBe('job-1');
  });
});

describe('JobRegistry 状态机', () => {
  it('注册即 running；settle 落终态、done resolve 终值、条目移入保留列', async () => {
    let clock = 1000;
    const registry = createJobRegistry({ now: () => clock });
    registry.registerKind('subagent');
    const handle = registry.register({ kind: 'subagent', name: '探索', owner: 's1' });
    expect(handle.entry).toMatchObject({ id: 'job-1', name: '探索', kind: 'subagent', owner: 's1', status: 'running' });
    expect(handle.entry.startedAt).toBe(1000);
    expect(registry.running()).toHaveLength(1);

    clock = 2000;
    expect(handle.settle({ status: 'completed' })).toBe(true);
    expect(handle.entry.status).toBe('completed');
    expect(handle.entry.terminal).toMatchObject({ status: 'completed', at: 2000 });
    await expect(handle.done).resolves.toMatchObject({ status: 'completed', at: 2000 });
    expect(registry.running()).toHaveLength(0);
    expect(registry.get('job-1')?.status).toBe('completed'); // 终态可查（保留列）
  });

  it('first-wins：首终态封口，后续结算静默弃（返 false + warn）', async () => {
    const warn = vi.fn();
    const registry = createJobRegistry({ warn });
    registry.registerKind('subagent');
    const handle = registry.register({ kind: 'subagent', name: 'x', owner: 's1' });
    expect(handle.settle({ status: 'failed', detail: '首因' })).toBe(true);
    expect(handle.settle({ status: 'completed' })).toBe(false);
    expect(handle.entry.terminal?.status).toBe('failed'); // 首终态不可变
    expect(handle.entry.terminal?.detail).toBe('首因');
    await expect(handle.done).resolves.toMatchObject({ status: 'failed' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('job-1');
  });

  it('done 永不 reject：failed/killed 终态均只 resolve 终值', async () => {
    const registry = createJobRegistry();
    registry.registerKind('subagent');
    const a = registry.register({ kind: 'subagent', name: 'a', owner: 's1' });
    const b = registry.register({ kind: 'subagent', name: 'b', owner: 's1' });
    a.settle({ status: 'failed', detail: 'boom' });
    b.settle({ status: 'killed' });
    await expect(a.done).resolves.toMatchObject({ status: 'failed' });
    await expect(b.done).resolves.toMatchObject({ status: 'killed' });
  });

  it('stop 协作停止：running→stopping 幂等；终态后零动作；结算权归 runner', () => {
    const registry = createJobRegistry();
    registry.registerKind('subagent');
    const handle = registry.register({ kind: 'subagent', name: 'x', owner: 's1' });
    handle.stop();
    expect(handle.entry.status).toBe('stopping');
    handle.stop(); // 幂等——不重复迁移
    expect(handle.entry.status).toBe('stopping');
    expect(registry.running()).toHaveLength(1); // stopping 仍在飞（等 runner 结算）
    handle.settle({ status: 'killed' });
    handle.stop(); // 已终态零动作
    expect(handle.entry.status).toBe('killed');
  });
});

describe('JobRegistry closeOwner 归属围栏', () => {
  it('按 owner 收口其在飞 Job 落 killed（detail 载归因）；他人条目不动', async () => {
    const registry = createJobRegistry();
    registry.registerKind('subagent');
    const mine1 = registry.register({ kind: 'subagent', name: 'a', owner: 's1' });
    const mine2 = registry.register({ kind: 'subagent', name: 'b', owner: 's1' });
    const other = registry.register({ kind: 'subagent', name: 'c', owner: 's2' });
    const closed = await registry.closeOwner('s1');
    expect(closed.map((entry) => entry.id)).toEqual(['job-1', 'job-2']);
    expect(mine1.entry).toMatchObject({ status: 'killed' });
    expect(mine1.entry.terminal?.detail).toContain('s1');
    expect(mine2.entry.status).toBe('killed');
    expect(other.entry.status).toBe('running'); // 围栏只收自己的
    await expect(mine1.done).resolves.toMatchObject({ status: 'killed' });
    expect(await registry.closeOwner('s1')).toEqual([]); // 二次收口零在飞
  });
});

describe('JobRegistry 并行帽', () => {
  it('按 kind 分帽：在飞数达帽拒新注册；结算释放后再放行', () => {
    const registry = createJobRegistry({ parallelLimits: { subagent: 2 } });
    registry.registerKind('subagent');
    registry.registerKind('process');
    const a = registry.register({ kind: 'subagent', name: 'a', owner: 's1' });
    registry.register({ kind: 'subagent', name: 'b', owner: 's1' });
    expectCodeSync(() => registry.register({ kind: 'subagent', name: 'c', owner: 's1' }), 'JOB_LIMIT_REACHED');
    // 异 kind 不受 subagent 帽约束（分帽语义）
    registry.register({ kind: 'process', name: 'p', owner: 's1' });
    a.settle({ status: 'completed' });
    registry.register({ kind: 'subagent', name: 'c', owner: 's1' }); // 释放后放行
    expect(registry.running().filter((entry) => entry.kind === 'subagent')).toHaveLength(2);
  });

  it('缺省无帽', () => {
    const registry = createJobRegistry();
    registry.registerKind('subagent');
    for (let i = 0; i < 5; i += 1) {
      registry.register({ kind: 'subagent', name: `j${i}`, owner: 's1' });
    }
    expect(registry.running()).toHaveLength(5);
  });
});

describe('JobRegistry 终态保留帽', () => {
  it('FIFO 截尾：超 256 条最旧终态逐出（get 查不到、list 不含）', () => {
    const registry = createJobRegistry();
    registry.registerKind('subagent');
    for (let i = 0; i < JOB_RETENTION_CAP + 2; i += 1) {
      registry.register({ kind: 'subagent', name: `j${i}`, owner: 's1' }).settle({ status: 'completed' });
    }
    const settled = registry.list().filter((entry) => entry.terminal !== undefined);
    expect(settled).toHaveLength(JOB_RETENTION_CAP);
    expect(registry.get('job-1')).toBeUndefined(); // 最旧两条逐出
    expect(registry.get('job-2')).toBeUndefined();
    expect(registry.get('job-3')?.id).toBe('job-3'); // 帽内最旧仍在
    expect(registry.get(`job-${JOB_RETENTION_CAP + 2}`)?.id).toBe(`job-${JOB_RETENTION_CAP + 2}`);
  });
});

describe('JobRegistry emit 活体通知', () => {
  it('settle 落定即发射 job_settled（载荷 = 终态条目快照）；emit 异常不反卷终态', async () => {
    const emit = vi.fn();
    const registry = createJobRegistry({ emit });
    registry.registerKind('subagent');
    const handle = registry.register({ kind: 'subagent', name: 'x', owner: 's1' });
    handle.settle({ status: 'completed' });
    await vi.waitFor(() => {
      expect(emit).toHaveBeenCalledTimes(1);
    });
    expect(emit.mock.calls[0]![0].entry).toMatchObject({ id: 'job-1', status: 'completed' });
    // first-wins 弃结算不重复发射
    handle.settle({ status: 'failed' });
    expect(emit).toHaveBeenCalledTimes(1);
  });
});

describe('JobRegistry list 读面', () => {
  it('注册序：在飞在前、终态保留在后', () => {
    const registry = createJobRegistry();
    registry.registerKind('subagent');
    registry.register({ kind: 'subagent', name: 'a', owner: 's1' }).settle({ status: 'completed' });
    registry.register({ kind: 'subagent', name: 'b', owner: 's1' });
    registry.register({ kind: 'subagent', name: 'c', owner: 's1' });
    expect(registry.list().map((entry) => entry.name)).toEqual(['b', 'c', 'a']);
    expect(registry.get('nope')).toBeUndefined();
  });
});
