/**
 * host/triggers 注册表测试（03 §2.2 行 108 第十一动词 + §2.7 冲突律 + §4.6 开门制；
 * C 批 C-2 注册面笔 + C-3 starter 笔）。
 *
 * 注册面 = 纯逻辑（getOpens/makeStarter 双闭包注入替身——三闸执法序/一次性
 * 交接/回滚与注销器守卫）；starter 真身 = 假栈 + 真 Job 注册表（受理帽执法与
 * 终态映射走真件，起会/提交窄面替身免建全栈）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import type { JobSettledEvent, SessionOrigin } from '../contracts/index.js';
import type { ConversationDriver, SubmitOptions, SubmitResult } from '../conversation/index.js';
import { createJobRegistry } from '../subagent/index.js';
import { TRIGGER_JOB_PARALLEL_LIMIT, TriggerRegistry, createTriggerStarterFactory } from './triggers.js';
import type { TriggerDef, TriggerStackFace, TriggerStarter } from './triggers.js';
// 错误码册注册腿（「import 发生才注册」——TRIGGER_ 两码断言的前置副作用）
import './codes.js';

/** 测试装配：可变开门集（活体读取源语义——测试直接 mutate 造 /reload 收门）+ starter 工厂记录仪 */
function assemble(initialOpens?: readonly string[]) {
  const opens = new Set(initialOpens ?? []);
  const factoryCalls: Array<{ pluginId: string; name: string }> = [];
  const starterSpecs: unknown[] = [];
  const firedStarters: TriggerStarter[] = [];
  const registry = new TriggerRegistry({
    getOpens: () => opens, // 全插件同源（本件测试域——分插件读取属装配面）
    makeStarter: (pluginId, name) => {
      factoryCalls.push({ pluginId, name });
      return (spec) => {
        starterSpecs.push(spec);
      };
    },
  });
  return { registry, opens, factoryCalls, starterSpecs, firedStarters };
}

/** def 构造辅助（fire 缺省记录收到的 starter——一次性交接断言面） */
function defOf(name: string, firedStarters: TriggerStarter[], fire?: TriggerDef['fire']): TriggerDef {
  return {
    name,
    description: '测试触发器',
    ...(fire !== undefined ? { fire } : { fire: (starter) => firedStarters.push(starter) }),
  };
}

/** BaseError 码断言辅助（错码即契约——修 bug 必带回归锁的判据面） */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable();
  } catch (err) {
    if (err instanceof BaseError) {
      expect(err.code).toBe(code);
      return;
    }
    throw err;
  }
}

describe('触发器注册表（triggers——03 §2.2 行 108/§2.7/§4.6）', () => {
  it('合法注册：落册 + makeStarter 以 (pluginId, name) 造 starter + def.fire 一次性交接', () => {
    const t = assemble(['triggers.start-run']);
    t.registry.register('acme', defOf('acme/daily-digest', t.firedStarters));
    expect(t.registry.list()).toEqual([{ name: 'acme/daily-digest', owner: 'acme', description: '测试触发器' }]);
    expect(t.factoryCalls).toEqual([{ pluginId: 'acme', name: 'acme/daily-digest' }]);
    expect(t.firedStarters).toHaveLength(1); // 一次性注入（重装载经重注册再注入）
  });

  it('门关拒：opens 缺位 → PLUGIN_CAPABILITY_DOOR_CLOSED（message 指路 opens 写法）', () => {
    const t = assemble();
    try {
      t.registry.register('acme', defOf('acme/x', t.firedStarters));
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      const e = err as BaseError;
      expect(e.code).toBe('PLUGIN_CAPABILITY_DOOR_CLOSED');
      expect(e.message).toContain('opens');
      expect(e.message).toContain('acme'); // 归因插件位
    }
    expect(t.registry.list()).toEqual([]); // 拒绝零记账
  });

  it('core: 官方件直开豁免（装配即用户意图——03 §4.6 勘补判据；域前缀去 core: 前缀比对）', () => {
    const t = assemble(); // 全默认关
    t.registry.register('core:issue', defOf('issue/scan', t.firedStarters));
    expect(t.registry.list().map((entry) => entry.owner)).toEqual(['core:issue']);
  });

  it('执法序锁：门检前置撞名（收门后撞名重注红的是门关码非撞名码）', () => {
    const t = assemble(['triggers.start-run']);
    t.registry.register('acme', defOf('acme/x', t.firedStarters));
    t.opens.clear(); // 模拟 /reload 撤位（活体读取源——同一次册内现判现拒）
    expectCode(() => t.registry.register('acme', defOf('acme/x', t.firedStarters)), 'PLUGIN_CAPABILITY_DOOR_CLOSED');
  });

  it('撞名拒：TRIGGER_NAME_EXISTS（message 含在册方——core: 域与生态域同册互斥）', () => {
    const t = assemble(['triggers.start-run']);
    t.registry.register('core:issue', defOf('issue/scan', t.firedStarters));
    // 生态插件 issue 与官方件 core:issue 域前缀同形（都归一 issue）——同册撞名互斥
    expectCode(() => t.registry.register('issue', defOf('issue/scan', t.firedStarters)), 'TRIGGER_NAME_EXISTS');
  });

  it('名词法拒：TRIGGER_NAME_INVALID（无 // 双 /、段空、大写、域前缀 ≠ 插件 id 各红）', () => {
    const t = assemble(['triggers.start-run']);
    expectCode(() => t.registry.register('acme', defOf('裸名', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('acme', defOf('acme/a/b', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('acme', defOf('acme/', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('acme', defOf('Acme/x', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('acme', defOf('acme/x_y', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('acme', defOf('other/x', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expectCode(() => t.registry.register('core:issue', defOf('other/x', t.firedStarters)), 'TRIGGER_NAME_INVALID');
    expect(t.registry.list()).toEqual([]); // 全拒零记账
  });

  it('fire 抛错回滚：注册未完成——在册面回滚 + 错误透传（零半注册残留）', () => {
    const t = assemble(['triggers.start-run']);
    const boom = new Error('事件源接入失败');
    expect(() =>
      t.registry.register(
        'acme',
        defOf('acme/x', t.firedStarters, () => {
          throw boom;
        }),
      ),
    ).toThrow(boom);
    expect(t.registry.list()).toEqual([]);
    expect(() => t.registry.register('acme', defOf('acme/x', t.firedStarters))).not.toThrow(); // 名可再注
  });

  it('注销器：摘本人条目 + 双调幂等 + 旧注销器不误摘接任者', () => {
    const t = assemble(['triggers.start-run']);
    const offA = t.registry.register('acme', defOf('acme/x', t.firedStarters));
    offA();
    offA(); // 幂等
    expect(t.registry.list()).toEqual([]);
    const offFirst = t.registry.register('acme', defOf('acme/x', t.firedStarters)); // 重注接任
    void offFirst;
    offA(); // 旧注销器不误摘接任者（过期时序守卫）
    expect(t.registry.list()).toHaveLength(1);
  });
});

/* ---------------- starter 真身（C-3——起无头会话 + Job 托管编舞） ---------------- */

/** 假栈 create 入参记录形（TriggerStackFace.manager.create 同形） */
interface FakeCreateInit {
  readonly origin?: SessionOrigin;
  readonly workspaceRoot?: string;
  readonly title?: string;
  readonly model?: string;
}

/**
 * 假栈（TriggerStackFace 替身）：create/submit 入参全记录；submit 回执 Promise
 * 由测试手动结算（终态映射逐档驱动）；submitUndefined 档模拟驱动缺席。
 */
function makeFakeStack(mode: { submitUndefined?: boolean } = {}) {
  const creates: FakeCreateInit[] = [];
  const submits: Array<{ sessionId: string; text: string; source?: string }> = [];
  const resolvers: Array<(result: SubmitResult) => void> = [];
  const stack: TriggerStackFace = {
    manager: {
      create(init: FakeCreateInit = {}) {
        creates.push(init);
        return {
          sessionId: `s-${creates.length}`,
          driver: null as unknown as ConversationDriver,
          origin: init.origin ?? 'conversation',
        };
      },
    },
    submitText(sessionId: string, text: string, options?: SubmitOptions & { source?: string }) {
      submits.push({ sessionId, text, ...(options?.source !== undefined ? { source: options.source } : {}) });
      if (mode.submitUndefined === true) return undefined;
      return new Promise<SubmitResult>((resolve) => resolvers.push(resolve));
    },
  };
  return { stack, creates, submits, resolvers };
}

/** starter 测试台：真 Job 注册表（帽执法真件）+ 假栈 + 可变开门集 + warn/settled 记录仪 */
function assembleStarter(initialOpens?: readonly string[]) {
  const opens = new Set(initialOpens ?? []);
  const warns: string[] = [];
  const settled: JobSettledEvent[] = [];
  const order: string[] = []; // 受理先于起会的编舞序证据面
  const jobs = createJobRegistry({
    parallelLimits: { trigger: TRIGGER_JOB_PARALLEL_LIMIT },
    emit: (event) => {
      settled.push(event);
    },
    warn: (message) => warns.push(message),
  });
  jobs.registerKind('trigger');
  const fake = makeFakeStack();
  const makeStarter = createTriggerStarterFactory({
    stack: {
      manager: {
        create: (init: FakeCreateInit = {}) => {
          order.push('create');
          return fake.stack.manager.create(init);
        },
      },
      submitText: fake.stack.submitText,
    },
    jobs: {
      register: (input) => {
        order.push('job');
        return jobs.register(input);
      },
    },
    getOpens: () => opens,
    workspaceRoot: () => '/ws',
    warn: (message) => warns.push(message),
  });
  return { opens, warns, settled, order, jobs, fake, makeStarter };
}

/** 微任务排空（回执 .then → settle → emit 链走完） */
const flush = async (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe('starter 真身（createTriggerStarterFactory——C 批 C-3 编舞序与终态映射）', () => {
  it('编舞全链：Job 受理先于起会 → origin trigger + source plugin 归因 → 完成即 Job completed', async () => {
    const t = assembleStarter(['triggers.start-run']);
    t.makeStarter(
      'acme',
      'acme/daily',
    )({
      prompt: '跑日报',
      title: '日报',
      model: 'm/x',
    });
    // 编舞序：受理先于起会（fire 受理先过帽再起会话——帽满不造孤儿会话）
    expect(t.order).toEqual(['job', 'create']);
    expect(t.fake.creates).toEqual([{ origin: 'trigger', workspaceRoot: '/ws', title: '日报', model: 'm/x' }]);
    expect(t.fake.submits).toEqual([{ sessionId: 's-1', text: '跑日报', source: 'plugin:acme' }]);
    expect(t.jobs.running()).toHaveLength(1); // run 未终态前在飞
    expect(t.jobs.running()[0]).toMatchObject({ kind: 'trigger', owner: 'acme', name: '日报' });
    t.fake.resolvers[0]!({ status: 'completed' });
    await flush();
    expect(t.settled).toHaveLength(1);
    expect(t.settled[0]!.entry.terminal).toMatchObject({ status: 'completed' });
    expect(t.warns).toEqual([]);
  });

  it('title 缺省机器派生（触发器名 + 起会时刻）；model 缺省不传（栈缺省回落）', () => {
    const t = assembleStarter(['triggers.start-run']);
    t.makeStarter('acme', 'acme/daily')({ prompt: '跑' });
    expect(t.fake.creates[0]!.title).toMatch(/^acme\/daily \d{4}-\d{2}-\d{2}T/);
    expect(t.fake.creates[0]!.model).toBeUndefined();
  });

  it('fire 复检拒：opens 撤位 → warn 可观测 + 零 Job + 零起会（开门可收回——starter 永不抛）', () => {
    const t = assembleStarter(['triggers.start-run']);
    t.opens.clear(); // /reload 撤位模拟
    expect(() => t.makeStarter('acme', 'acme/daily')({ prompt: '跑' })).not.toThrow();
    expect(t.warns.join('\n')).toContain('fire 复检');
    expect(t.fake.creates).toEqual([]);
    expect(t.jobs.list()).toEqual([]);
  });

  it('core: 官方件直开豁免：opens 空集照常起会（装配即用户意图）', () => {
    const t = assembleStarter();
    t.makeStarter('core:issue', 'issue/scan')({ prompt: '扫' });
    expect(t.fake.creates).toHaveLength(1);
    expect(t.fake.submits[0]!.source).toBe('plugin:core:issue');
  });

  it('帽满：4 在飞后第 5 次受理拒 JOB_LIMIT_REACHED——warn + 不起会不留孤儿', () => {
    const t = assembleStarter(['triggers.start-run']);
    for (let i = 0; i < TRIGGER_JOB_PARALLEL_LIMIT; i++) {
      t.makeStarter('acme', 'acme/daily')({ prompt: `跑${i}` });
    }
    expect(t.fake.creates).toHaveLength(TRIGGER_JOB_PARALLEL_LIMIT);
    t.makeStarter('acme', 'acme/daily')({ prompt: '第5次' }); // 前四 run 未终态——帽满
    expect(t.warns.join('\n')).toContain('JOB_LIMIT_REACHED');
    expect(t.fake.creates).toHaveLength(TRIGGER_JOB_PARALLEL_LIMIT); // 零孤儿会话
    expect(t.fake.submits).toHaveLength(TRIGGER_JOB_PARALLEL_LIMIT);
  });

  it('显式 jobKind 未登记 → JOB_KIND_UNKNOWN 拒（受理失败不起会）', () => {
    const t = assembleStarter(['triggers.start-run']);
    t.makeStarter('acme', 'acme/daily')({ prompt: '跑', jobKind: 'issue' }); // 测试台只自登 trigger
    expect(t.warns.join('\n')).toContain('JOB_KIND_UNKNOWN');
    expect(t.fake.creates).toEqual([]);
  });

  it('提交缺席（驱动 undefined）→ Job 落 failed 终态（受理先行的对称收口）', async () => {
    const fake = makeFakeStack({ submitUndefined: true });
    const settled: JobSettledEvent[] = [];
    const jobs = createJobRegistry({
      emit: (e) => {
        settled.push(e);
      },
    });
    jobs.registerKind('trigger');
    const starter = createTriggerStarterFactory({
      stack: fake.stack,
      jobs,
      getOpens: () => new Set(['triggers.start-run']),
      workspaceRoot: () => '/ws',
      warn: () => undefined,
    })('acme', 'acme/daily');
    starter({ prompt: '跑' });
    await flush();
    expect(settled[0]!.entry.terminal).toMatchObject({ status: 'failed' });
    expect(settled[0]!.entry.terminal?.detail).toContain('run 未起');
  });

  it('回执三终态映射：aborted→killed / failed→failed（detail 携 errorMessage）/ injected·wake-refused→failed（run 未起交代去向）', async () => {
    const t = assembleStarter(['triggers.start-run']);
    const starter = t.makeStarter('acme', 'acme/daily');
    starter({ prompt: 'a' });
    starter({ prompt: 'b' });
    starter({ prompt: 'c' });
    starter({ prompt: 'd' });
    t.fake.resolvers[0]!({ status: 'aborted' });
    t.fake.resolvers[1]!({ status: 'failed', errorMessage: '模型 500' });
    t.fake.resolvers[2]!({ status: 'injected', seq: 7 });
    t.fake.resolvers[3]!({ status: 'wake-refused', reason: 'wake-budget' });
    await flush();
    const terminals = t.settled.map((e) => e.entry.terminal);
    expect(terminals.map((x) => x?.status)).toEqual(['killed', 'failed', 'failed', 'failed']);
    expect(terminals[1]?.detail).toBe('模型 500');
    expect(terminals[2]?.detail).toContain('seq 7');
    expect(terminals[3]?.detail).toContain('唤醒');
  });

  it('prompt 坏形（空串）→ warn + 零受理零起会（运行期传参防御）', () => {
    const t = assembleStarter(['triggers.start-run']);
    expect(() => t.makeStarter('acme', 'acme/daily')({ prompt: '' })).not.toThrow();
    expect(t.warns.join('\n')).toContain('prompt');
    expect(t.fake.creates).toEqual([]);
    expect(t.jobs.list()).toEqual([]);
  });
});
