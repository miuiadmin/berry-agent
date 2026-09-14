/**
 * JobRegistry 测试——状态机全集（04 §10）：registerKind 词汇闸/first-wins
 * 结算/done 永不 reject/stop 协作幂等/onStop 协作中止路由（Job 消费面批）/
 * closeOwner 归属围栏/并行帽/终态帽 256 FIFO/emit 活体通知。
 * 六役 CL-C 执法批（03 §2.2 第九面）：帽值归属律（异主重登 def 不落）+
 * fork owner 固化（register owner 绑定闭包注入）+ def 值域校验
 * （JOB_DEF_INVALID fail-loud）。
 */
import { describe, expect, it, vi } from 'vitest';
import { BaseError, type JobKind } from '../contracts/index.js';
import { createJobRegistry, JOB_KIND_HOST_OWNER, JOB_RETENTION_CAP } from './registry.js';

/**
 * 第三方自定义 kind 模拟词（六役 F 簇单点 cast）：JobKind 联合是宿主预登记
 * 闭集（'subagent'|'issue'|'trigger' 三值——04 §10 kind 行），第三方插件经
 * registerKind 自登的 kind 天然在联合外（运行期词汇开放面）。归属/登记面
 * 测试需要一个非宿主词，以单点 cast 模拟开放面语义——值任意（取 cron 词
 * 仅示意，与 scheduler 的 cron 类型族无涉），后续测试词族皆引本常量。
 */
const customKind = 'cron' as JobKind;

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

describe('JobRegistry kind 归属记录（五役 d3-1——谱系执法）', () => {
  it('宿主直调 = 宿主席归属；fork 绑定注入插件 id（真身同表）；未登记 undefined', () => {
    const registry = createJobRegistry();
    registry.registerKind('trigger'); // 宿主直调（assembly 装配序形）
    expect(registry.ownerOfKind('trigger')).toBe(JOB_KIND_HOST_OWNER);
    expect(registry.hasKind('trigger')).toBe(true);
    expect(registry.ownerOfKind(customKind)).toBeUndefined(); // 未登记无归属
    // fork 绑定形（'secrets' 席同构——plugin-boot 装载序逐插件 fork 'jobs' 面）：
    // registerKind 携本插件 id，归属记录落真身同表
    const bound = registry.bindForPlugin('acme');
    bound.registerKind(customKind);
    expect(registry.ownerOfKind(customKind)).toBe('acme');
    expect(bound.hasKind(customKind)).toBe(true); // 委托真身读面
    expect(bound.ownerOfKind('trigger')).toBe(JOB_KIND_HOST_OWNER);
  });

  it('归属 first-wins：异主重登不夺籍（warn 可观测）——词汇面维持幂等', () => {
    const warns: string[] = [];
    const registry = createJobRegistry({ warn: (message) => warns.push(message) });
    registry.bindForPlugin('acme').registerKind(customKind);
    registry.bindForPlugin('beta').registerKind(customKind); // 异主重登——不夺籍
    expect(registry.ownerOfKind(customKind)).toBe('acme'); // 首登者定籍
    expect(warns.join('\n')).toContain('不夺籍');
    registry.bindForPlugin('acme').registerKind(customKind); // 同主重登幂等零 warn
    expect(warns).toHaveLength(1);
  });

  it('fork 绑定面委托真身：register/settle 与真身同表互见（改写位 = registerKind 归属 + register owner 固化——六役 ② 后两改写位）', () => {
    const registry = createJobRegistry();
    const bound = registry.bindForPlugin('acme');
    bound.registerKind(customKind);
    const handle = bound.register({ kind: customKind, name: 'a', owner: 's1' });
    // 绑定面注册的条目真身读面可见（单表委托非副本）
    expect(registry.running().map((entry) => entry.id)).toEqual(['job-1']);
    handle.settle({ status: 'completed' });
    expect(registry.get('job-1')?.status).toBe('completed');
  });
});

describe('JobRegistry registerKind def 帽槽（五役 d3-2——03 §2.2「Job 登记面」def 槽兑现，行号免锚）', () => {
  it('登记期 parallelLimits 并入帽表即执法：第二笔 JOB_LIMIT_REACHED（修前红——无 def 形参即无帽受理）', () => {
    const registry = createJobRegistry();
    registry.registerKind(customKind, { parallelLimits: 1 }); // 登记期并帽（构造期无帽）
    registry.register({ kind: customKind, name: 'a', owner: 's1' });
    expectCodeSync(() => registry.register({ kind: customKind, name: 'b', owner: 's1' }), 'JOB_LIMIT_REACHED');
  });

  it('登记期值后写胜出：覆盖构造期帽（同表后写——登记期值生效即执法）', () => {
    const registry = createJobRegistry({ parallelLimits: { trigger: 4 } }); // 构造期帽 4
    registry.registerKind('trigger', { parallelLimits: 1 }); // 登记期并帽覆盖
    registry.register({ kind: 'trigger', name: 'a', owner: 's1' });
    expectCodeSync(() => registry.register({ kind: 'trigger', name: 'b', owner: 's1' }), 'JOB_LIMIT_REACHED');
  });
});

describe('JobRegistry 六役 CL-C 执法批（帽值归属律 + fork owner 固化 + def 值域——03 §2.2 第九面）', () => {
  it('①帽值归属律：异主重登不夺籍亦不夺帽——def 整体不落（修前红：异主 parallelLimits 99 last-write 生效夺帽）', () => {
    const warns: string[] = [];
    const registry = createJobRegistry({ warn: (message) => warns.push(message) });
    registry.bindForPlugin('acme').registerKind(customKind, { parallelLimits: 1 });
    registry.bindForPlugin('beta').registerKind(customKind, { parallelLimits: 99 }); // 异主重登——不夺籍亦不夺帽
    expect(registry.ownerOfKind(customKind)).toBe('acme'); // 籍 first-wins 维持
    // 帽仍 1（def 随籍 first-wins）：第一笔在飞后即达帽
    registry.register({ kind: customKind, name: 'a', owner: 's1' });
    expectCodeSync(() => registry.register({ kind: customKind, name: 'b', owner: 's1' }), 'JOB_LIMIT_REACHED');
    expect(warns.join('\n')).toContain('不夺籍'); // 既有 warn 路径维持可观测
  });

  it('①同主重登 def 更新照旧（last-write 保持）：acme 帽 1 → 同主携 2 生效', () => {
    const registry = createJobRegistry();
    registry.bindForPlugin('acme').registerKind(customKind, { parallelLimits: 1 });
    registry.bindForPlugin('acme').registerKind(customKind, { parallelLimits: 2 }); // 同主——后写胜出
    registry.register({ kind: customKind, name: 'a', owner: 's1' });
    registry.register({ kind: customKind, name: 'b', owner: 's1' });
    expectCodeSync(() => registry.register({ kind: customKind, name: 'c', owner: 's1' }), 'JOB_LIMIT_REACHED');
  });

  it('②fork owner 固化：fork 面 register 的 owner 由绑定闭包注入（自报值被忽略——修前红：自报 owner 直传生效）', async () => {
    const registry = createJobRegistry();
    const bound = registry.bindForPlugin('acme');
    bound.registerKind(customKind);
    const handle = bound.register({ kind: customKind, name: 'a', owner: 'spoofed-owner' }); // 自报形——不采信
    expect(handle.entry.owner).toBe('acme'); // 绑定 pluginId 固化
    // 围栏同源后果：closeOwner('acme')（插件卸载 closer 两路同源之一）收口该条目
    await registry.closeOwner('acme');
    expect(handle.entry.status).toBe('killed');
  });

  it('③def 值域运行期校验 fail-loud：parallelLimits -1/NaN/Infinity 均拒 JOB_DEF_INVALID（修前红：静默落表）；违例不半落登记', () => {
    const registry = createJobRegistry();
    expectCodeSync(() => registry.registerKind(customKind, { parallelLimits: -1 }), 'JOB_DEF_INVALID');
    expectCodeSync(() => registry.registerKind(customKind, { parallelLimits: Number.NaN }), 'JOB_DEF_INVALID');
    expectCodeSync(
      () => registry.registerKind(customKind, { parallelLimits: Number.POSITIVE_INFINITY }),
      'JOB_DEF_INVALID',
    );
    expect(registry.hasKind(customKind)).toBe(false); // 违例拒——登记册零半落
  });

  it('③构造期同律：options.parallelLimits 坏值同码拒（单源 helper——JS 直调形无 TS 位兜底）', () => {
    expectCodeSync(() => createJobRegistry({ parallelLimits: { subagent: -1 } }), 'JOB_DEF_INVALID');
    expectCodeSync(() => createJobRegistry({ parallelLimits: { subagent: Number.NaN } }), 'JOB_DEF_INVALID');
  });

  it('③组合序锁：值域校验先于归属判——异主重登携坏 def 亦 JOB_DEF_INVALID（非 ① 的 warn 不夺籍路径）', () => {
    const registry = createJobRegistry({ warn: () => undefined });
    registry.bindForPlugin('acme').registerKind(customKind, { parallelLimits: 1 });
    // 异主 + 坏 def 组合：fail-loud 优先（坏输入拒先于所有权问题——03 §2.2 第九面）
    expectCodeSync(
      () => registry.bindForPlugin('beta').registerKind(customKind, { parallelLimits: -1 }),
      'JOB_DEF_INVALID',
    );
    expect(registry.ownerOfKind(customKind)).toBe('acme'); // 籍不动（违例整体不落）
  });

  it('⑤ fork 绑面自报位除名（2026-09-15 ④ 笔——closeOwner/bindForPlugin 不入窄面，基面维持原成员集）', () => {
    const registry = createJobRegistry();
    const bound = registry.bindForPlugin('acme');
    expect('closeOwner' in bound).toBe(false); // 收口动词宿主单方执掌——fork 面暴露即任意 owner 收口直通（修前红：in 判 true）
    expect('bindForPlugin' in bound).toBe(false); // 为他人绑定直通同笔除名（修前红：in 判 true）
    // 基面不动：宿主自用/测试替身不受影响（卸载 closer 与会话 dispose 两路走真身）
    expect(typeof registry.closeOwner).toBe('function');
    expect(typeof registry.bindForPlugin).toBe('function');
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

describe('JobRegistry onStop 协作中止路由（Job 消费面批——04 §10 定形）', () => {
  it('stop 置 stopping 后触发 onStop（协作中止路由）；重复 stop/终态后不重复触发', () => {
    const registry = createJobRegistry();
    registry.registerKind('subagent');
    const routed: string[] = [];
    const handle = registry.register({
      kind: 'subagent',
      name: 'x',
      owner: 's1',
      onStop: () => routed.push('route'),
    });
    handle.stop();
    expect(handle.entry.status).toBe('stopping');
    expect(routed).toEqual(['route']); // 置 stopping 与路由同一拍
    handle.stop(); // 幂等——stopping 态不再路由
    expect(routed).toEqual(['route']);
    handle.settle({ status: 'killed' });
    handle.stop(); // 已终态零动作
    expect(routed).toEqual(['route']);
  });

  it('onStop 抛错 warn 隔离不反卷状态机（stopping 已落继续收口）', () => {
    const warns: string[] = [];
    const registry = createJobRegistry({ warn: (message) => warns.push(message) });
    registry.registerKind('subagent');
    const handle = registry.register({
      kind: 'subagent',
      name: 'x',
      owner: 's1',
      onStop: () => {
        throw new Error('路由失联');
      },
    });
    expect(() => handle.stop()).not.toThrow();
    expect(handle.entry.status).toBe('stopping'); // 停止语义不因路由失联而废
    expect(warns.join('\n')).toContain('协作中止路由抛错');
    expect(handle.settle({ status: 'completed' })).toBe(true); // 结算权仍归 runner
  });

  it('closeOwner 两拍序：先协作停止（onStop 路由 + stopping）再兜底 killed', async () => {
    const events: string[] = [];
    const registry = createJobRegistry();
    registry.registerKind('trigger');
    const handle = registry.register({
      kind: 'trigger',
      name: 'daily',
      owner: 'acme',
      // 路由拍时点条目态快照——两拍序证据面（路由时 killing 终态未落；
      // 闭包晚绑——closeOwner 调用时 handle 已赋值）
      onStop: () => events.push(`onStop@${handle.entry.status}`),
    });
    const closed = await registry.closeOwner('acme');
    expect(closed).toHaveLength(1);
    // 两拍证据：路由拍条目 = stopping（兜底 killed 未落）；收口后条目 = killed
    expect(events).toEqual(['onStop@stopping']);
    expect(handle.entry).toMatchObject({ status: 'killed' });
    expect(handle.entry.terminal?.detail).toContain('归属围栏收口');
    await expect(handle.done).resolves.toMatchObject({ status: 'killed' });
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
    registry.registerKind(customKind);
    const a = registry.register({ kind: 'subagent', name: 'a', owner: 's1' });
    registry.register({ kind: 'subagent', name: 'b', owner: 's1' });
    expectCodeSync(() => registry.register({ kind: 'subagent', name: 'c', owner: 's1' }), 'JOB_LIMIT_REACHED');
    // 异 kind 不受 subagent 帽约束（分帽语义）
    registry.register({ kind: customKind, name: 'p', owner: 's1' });
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
