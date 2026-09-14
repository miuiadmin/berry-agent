/**
 * host/triggers 注册表测试（03 §2.2 行 108 第十一动词 + §2.7 冲突律 + §4.6 开门制；
 * C 批 C-2 注册面笔 + C-3 starter 笔）。
 *
 * 注册面 = 纯逻辑（getOpens/makeStarter 双闭包注入替身——三闸执法序/一次性
 * 交接/回滚与注销器守卫）；starter 真身 = 假栈 + 真 Job 注册表（受理帽执法与
 * 终态映射走真件，起会/提交窄面替身免建全栈）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';
import { BaseError } from '../contracts/index.js';
import type { JobKind, JobSettledEvent, SessionOrigin } from '../contracts/index.js';
import type { ConversationDriver, SubmitOptions, SubmitResult } from '../conversation/index.js';
import { fauxProvider } from '../llm/index.js';
import { createJobRegistry } from '../subagent/index.js';
import type { JobHandle } from '../subagent/index.js';
import { TRIGGER_JOB_PARALLEL_LIMIT, TriggerRegistry, createTriggerStarterFactory } from './triggers.js';
import type { TriggerDef, TriggerStackFace, TriggerStarter } from './triggers.js';
import { createConversationStack } from './conversation-stack.js';
import { createHostRuntime } from './runtime.js';
import type { HostRuntime } from './runtime.js';
// 错误码册注册腿（「import 发生才注册」——TRIGGER_ 两码断言的前置副作用）
import './codes.js';

/**
 * 第三方自定义 kind 模拟词（六役 F 簇单点 cast）：JobKind 联合是宿主预登记
 * 闭集（'subagent'|'issue'|'trigger' 三值），第三方插件经 fork 绑定面
 * registerKind 自登的 kind 天然在联合外——谱系闸正道腿需要一个非宿主词，
 * 以单点 cast 模拟运行期词汇开放面（值任意，取 cron 词仅示意）。
 */
const customKind = 'cron' as JobKind;

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
 * 由测试手动结算（终态映射逐档驱动）；submitUndefined 档模拟驱动缺席。每会话
 * 配一枚假驱动（abort 计数——stop→interrupt 桥的到达证据面）。manager.retire
 * 调用全记录（五役 d2-1——run 终态 retire 收口的断言面）。
 */
function makeFakeStack(mode: { submitUndefined?: boolean } = {}) {
  const creates: FakeCreateInit[] = [];
  const submits: Array<{ sessionId: string; text: string; source?: string; backgroundLane?: boolean }> = [];
  const resolvers: Array<(result: SubmitResult) => void> = [];
  /** 逐会话假驱动（abort 计数——与 creates 序对应） */
  const drivers: Array<{ abortCount: number }> = [];
  /** retire 调用记录（d2-1——起会成功后终态路径收口的证据面） */
  const retires: string[] = [];
  const stack: TriggerStackFace = {
    manager: {
      create(init: FakeCreateInit = {}) {
        creates.push(init);
        const driver = { abortCount: 0 };
        drivers.push(driver);
        return {
          sessionId: `s-${creates.length}`,
          driver: {
            abort: () => {
              driver.abortCount += 1;
            },
          } as unknown as ConversationDriver,
          origin: init.origin ?? 'conversation',
        };
      },
      retire(sessionId: string) {
        retires.push(sessionId);
        return true;
      },
    },
    submitText(sessionId: string, text: string, options?: SubmitOptions & { source?: string }) {
      submits.push({
        sessionId,
        text,
        ...(options?.source !== undefined ? { source: options.source } : {}),
        ...(options?.backgroundLane !== undefined ? { backgroundLane: options.backgroundLane } : {}),
      });
      if (mode.submitUndefined === true) return undefined;
      return new Promise<SubmitResult>((resolve) => resolvers.push(resolve));
    },
  };
  return { stack, creates, submits, resolvers, drivers, retires };
}

/** starter 测试台：真 Job 注册表（帽执法真件）+ 假栈 + 可变开门集 + warn/settled/审计记录仪 */
function assembleStarter(initialOpens?: readonly string[]) {
  const opens = new Set(initialOpens ?? []);
  const warns: string[] = [];
  const settled: JobSettledEvent[] = [];
  // capability/used 落账记录仪（U3 批 U3-5——assembly 侧接 audit.append，此处收形）
  const used: Array<{ pluginId: string; triggerName: string }> = [];
  const order: string[] = []; // 受理先于起会的编舞序证据面
  /** starter 注册的 Job 句柄（透传捕获——stop→interrupt 桥测试的调用柄） */
  const handles: JobHandle[] = [];
  const jobs = createJobRegistry({
    parallelLimits: { trigger: TRIGGER_JOB_PARALLEL_LIMIT },
    emit: (event) => {
      settled.push(event);
    },
    warn: (message) => warns.push(message),
  });
  // 宿主预登记形（五役 d3-1——谱系闸真源模拟）：'trigger' = host 装配期自登
  // （缺省围栏 kind）；'subagent' = 宿主直调真身预登记（宿主席归属——fork 绑定
  // 形另经 bindForPlugin 单测模拟）；'issue'/'cron' 留未登记（JOB_KIND_UNKNOWN
  // 腿与 fork 绑定正道腿的测试面）
  jobs.registerKind('trigger');
  jobs.registerKind('subagent');
  const fake = makeFakeStack();
  const makeStarter = createTriggerStarterFactory({
    stack: {
      manager: {
        create: (init: FakeCreateInit = {}) => {
          order.push('create');
          return fake.stack.manager.create(init);
        },
        retire: (sessionId) => fake.stack.manager.retire(sessionId),
      },
      submitText: fake.stack.submitText,
    },
    jobs: {
      register: (input) => {
        order.push('job');
        const handle = jobs.register(input);
        handles.push(handle);
        return handle;
      },
      ownerOfKind: (kind) => jobs.ownerOfKind(kind),
    },
    getOpens: () => opens,
    workspaceRoot: () => '/ws',
    warn: (message) => warns.push(message),
    onCapabilityUsed: (pluginId, triggerName) => used.push({ pluginId, triggerName }),
  });
  return { opens, warns, settled, order, jobs, handles, fake, makeStarter, used };
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
    // 车道字面锁（修前红锚——04 §5 车道兑现笔射程勘正 + 四役补笔）：起跑
    // submitText 恒声明 backgroundLane:true（trigger run 是后台编排）——修前
    // 该键缺席（undefined）与本期望不等
    expect(t.fake.submits).toEqual([{ sessionId: 's-1', text: '跑日报', source: 'plugin:acme', backgroundLane: true }]);
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
    // 台自登 'trigger'（host 缺省 kind）与 'subagent'（宿主预登记形）；'issue'
    // 留未登记——本测走 JOB_KIND_UNKNOWN 腿（谱系闸只拦已登记异主，未登记照旧
    // 交 register 词汇闸——五役 d3-1 两闸分立）
    t.makeStarter('acme', 'acme/daily')({ prompt: '跑', jobKind: 'issue' });
    expect(t.warns.join('\n')).toContain('JOB_KIND_UNKNOWN');
    expect(t.fake.creates).toEqual([]);
  });

  it('宿主预登记 kind 谱系闸（d3-1 修前红）：jobKind「subagent」（宿主席归属）第三方 starter 复用即拒——warn + 零受理零起会', () => {
    const t = assembleStarter(['triggers.start-run']);
    expect(() => t.makeStarter('acme', 'acme/daily')({ prompt: '跑', jobKind: 'subagent' })).not.toThrow();
    expect(t.warns.join('\n')).toContain('已归属'); // 归属拒固定报文可观测
    expect(t.jobs.list()).toEqual([]); // 零受理（谱系闸在 Job 受理位之前——无条目）
    expect(t.fake.creates).toEqual([]); // 不起会话（防绕帽：'subagent' 无帽受理）
  });

  it('谱系闸正道：本插件 fork 绑定自登 kind 放行 + 他插件归属即拒 + 显式 trigger 恒放行（缺省隐式 kind 语义）', () => {
    const t = assembleStarter(['triggers.start-run']);
    // fork 绑定形（'secrets' 席同构——plugin-boot 装载序逐插件 fork 'jobs' 面）：
    // 本插件经绑定面自登 'cron'（携登记期帽），归属 = 本插件 id
    t.jobs.bindForPlugin('acme').registerKind(customKind, { parallelLimits: 2 });
    t.makeStarter('acme', 'acme/daily')({ prompt: '跑', jobKind: customKind });
    expect(t.fake.creates).toHaveLength(1); // 本插件自有 kind 放行
    expect(t.jobs.running()[0]).toMatchObject({ kind: 'cron', owner: 'acme' });
    // 他插件复用即拒（归属 ≠ 起会方——warn 可观测 + 零受理零起会）
    t.makeStarter('beta', 'beta/hourly')({ prompt: '跑', jobKind: customKind });
    expect(t.warns.join('\n')).toContain('beta');
    expect(t.fake.creates).toHaveLength(1);
    expect(t.jobs.running()).toHaveLength(1);
    // 显式 'trigger' 恒放行（宿主自登缺省 kind——缺省隐式语义同一面，非复用）
    t.makeStarter('acme', 'acme/daily')({ prompt: '再跑', jobKind: 'trigger' });
    expect(t.fake.creates).toHaveLength(2);
    expect(t.warns.join('\n')).not.toContain('再跑'); // 放行两形零归属 warn
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
    expect(fake.retires).toEqual(['s-1']); // 早退位同收口（起会成功后终态路径全覆盖）
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

  it('run 终态 retire 收口（d2-1 修前红——05 §7 retire 律补员笔）：completed/failed 两路径 settle 尾即 retire(sessionId)', async () => {
    const t = assembleStarter(['triggers.start-run']);
    t.makeStarter('acme', 'acme/daily')({ prompt: '跑a' });
    t.makeStarter('acme', 'acme/daily')({ prompt: '跑b' });
    expect(t.fake.retires).toEqual([]); // run 未终态前零收口
    t.fake.resolvers[0]!({ status: 'completed' });
    t.fake.resolvers[1]!({ status: 'failed', errorMessage: '模型 500' });
    await flush();
    expect(t.settled.map((e) => e.entry.terminal?.status)).toEqual(['completed', 'failed']);
    // settle 尾即 retire（scheduler-tick settled.finally 同形）——修前零调用即
    // records Map 无界驻留（活体登记收口缺口——fresh-per-fire 每次起会必收口）
    expect(t.fake.retires).toEqual(['s-1', 's-2']);
  });

  it('prompt 坏形（空串）→ warn + 零受理零起会（运行期传参防御）', () => {
    const t = assembleStarter(['triggers.start-run']);
    expect(() => t.makeStarter('acme', 'acme/daily')({ prompt: '' })).not.toThrow();
    expect(t.warns.join('\n')).toContain('prompt');
    expect(t.fake.creates).toEqual([]);
    expect(t.jobs.list()).toEqual([]);
  });

  it('capability/used 逐次落账（U3 批 U3-5）：run 真起后记 (pluginId, triggerName)', () => {
    const t = assembleStarter(['triggers.start-run']);
    t.makeStarter('acme', 'acme/daily')({ prompt: '跑日报' });
    expect(t.used).toEqual([{ pluginId: 'acme', triggerName: 'acme/daily' }]);
  });

  it('复检拒/受理拒不落账——没发生的使用不是使用', () => {
    // 门关（fire 复检拒）：零受理零起会零落账
    const closed = assembleStarter([]);
    closed.makeStarter('acme', 'acme/daily')({ prompt: '跑日报' });
    expect(closed.used).toEqual([]);
    // prompt 坏形（受理前拒）：同零落账
    const bad = assembleStarter(['triggers.start-run']);
    bad.makeStarter('acme', 'acme/daily')({ prompt: '' });
    expect(bad.used).toEqual([]);
  });

  it('core: 豁免门检照记（豁免免的是门不是账——§4.6 冷读闸判据）', () => {
    const t = assembleStarter([]); // 门关——core: 仍豁免直开
    t.makeStarter('core:issue', 'core:issue/board')({ prompt: '跑' });
    expect(t.used).toEqual([{ pluginId: 'core:issue', triggerName: 'core:issue/board' }]);
  });

  it('桥一 stop→interrupt：JobHandle.stop 置 stopping 即路由起会驱动 abort（run 协作中止）', () => {
    const t = assembleStarter(['triggers.start-run']);
    t.makeStarter('acme', 'acme/daily')({ prompt: '跑' });
    expect(t.handles).toHaveLength(1);
    expect(t.fake.drivers[0]!.abortCount).toBe(0); // 起会后未中止
    t.handles[0]!.stop();
    expect(t.handles[0]!.entry.status).toBe('stopping');
    expect(t.fake.drivers[0]!.abortCount).toBe(1); // 协作中止路由到达驱动
  });

  it('桥二 插件卸载收口：closeOwner(pluginId) 两拍——驱动 abort 路由 + Job 兜底 killed；回执晚到 first-wins 静默弃（warn 可观测）', async () => {
    const t = assembleStarter(['triggers.start-run']);
    t.makeStarter('acme', 'acme/daily')({ prompt: '跑' });
    await t.jobs.closeOwner('acme'); // 插件卸载收口（owner = 插件 id 围栏键）
    expect(t.fake.drivers[0]!.abortCount).toBe(1); // 「打断」拍：协作中止路由到达
    expect(t.handles[0]!.entry).toMatchObject({ status: 'killed' }); // 「杀并落 killed」拍
    // run 侧 aborted 回执晚到：first-wins 静默弃——warn 可观测属预期
    t.fake.resolvers[0]!({ status: 'aborted' });
    await flush();
    expect(t.settled).toHaveLength(1); // 唯一 emit = 收口那次（回执结算被弃）
    expect(t.settled[0]!.entry.terminal?.detail).toContain('归属围栏收口');
    expect(t.warns.join('\n')).toContain('静默弃');
    expect(t.jobs.running()).toHaveLength(0); // 无孤儿在飞
  });
});

/* ---------------- 车道兑现（真栈——04 §5 车道兑现笔射程勘正 + 四役补笔） ---------------- */

/** 临时目录族（真盘真库形） */
const laneDirs: string[] = [];
afterAll(() => {
  for (const d of laneDirs) rmSync(d, { recursive: true, force: true });
});

/** 新数据目录 + 真运行时速记（issue-session.test.ts 同款形） */
function laneRigRuntime(): HostRuntime {
  const dir = mkdtempSync(join(tmpdir(), 'triggers-lane-data-'));
  laneDirs.push(dir);
  return createHostRuntime({ dataDir: dir });
}

/** 带计量的 faux assistant（桥接窗扫的计量源——usage 非零可断言池计入面） */
function laneMetered(input: number, output: number): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: { input, output, cacheRead: 0, cacheWrite: 0, totalTokens: input + output },
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

const laneSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** 等条件真（有界轮询——starter 回执 fire-and-forget，Job 终态即 run 已结算） */
async function laneUntil(cond: () => boolean, ms = 4000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > deadline) throw new Error('测试超时：条件未达成');
    await laneSleep(10);
  }
}

describe('starter 车道兑现（真栈——trigger 起跑 run 恒 background 道）', () => {
  it('桥接落账 priority=background（修前红）+ 当日后台池如实计入（起跑方消耗不再失明）', async () => {
    const rt = laneRigRuntime();
    const ws = mkdtempSync(join(tmpdir(), 'triggers-lane-ws-'));
    laneDirs.push(ws);
    const faux = fauxProvider({ provider: 'faux-trigger', models: [{ id: 'm1' }] });
    const stack = createConversationStack({
      runtime: rt,
      providers: [faux.provider],
      model: 'faux-trigger/m1',
      env: {},
      workspace: () => ws,
    });
    const settled: JobSettledEvent[] = [];
    const jobs = createJobRegistry({
      emit: (e) => {
        settled.push(e);
      },
      warn: () => {},
    });
    jobs.registerKind('trigger');
    const starter = createTriggerStarterFactory({
      stack, // 真栈（mock 只停在模型层——faux 走真实 streamFn/桥接/落账全链）
      jobs,
      getOpens: () => new Set(['triggers.start-run']),
      workspaceRoot: () => ws,
      warn: () => {},
    })('acme', 'acme/daily');

    faux.setResponses([() => laneMetered(30, 12)]);
    starter({ prompt: '跑日报', title: '车道锁' });
    // run 真起 + Job 终态映射链走完（settled 即 submit 回执已结算——桥接笔已落）
    await laneUntil(() => jobs.running().length === 0);
    expect(settled).toHaveLength(1);
    expect(settled[0]!.entry.terminal).toMatchObject({ status: 'completed' });

    // 事件字面锁：trigger 会话流 llm/usage 笔 priority = background
    // （修前红锚：起跑 submitText 未声明车道 → 桥接 receipt.backgroundLane
    // 恒 false → foreground——后台日池对 trigger 自身消耗失明即此读面不含本笔）
    await rt.persistence.flush();
    const row = stack.manager.list({}).find((r) => r.origin === 'trigger');
    expect(row).toBeDefined();
    const page = rt.persistence.store.queryEvents({
      sessionId: row!.id,
      types: ['llm/usage'],
      sinceMs: 0,
    });
    expect(page.events).toHaveLength(1);
    const pen = page.events[0]!.data as Record<string, unknown>;
    expect(pen['priority']).toBe('background');
    expect(String(pen['callId'])).toMatch(/^run:.+:\d+$/); // run 路桥接同源

    // 消费面闭环：当日后台池如实计入（修前红锚：spent 恒 0；数值面与转抄笔
    // 同源断言——不硬编计量值）
    const ledger = pen['usage'] as { input: number; output: number };
    expect(stack.llm.backgroundUsage().spent).toBe(ledger.input + ledger.output);
    expect(stack.llm.backgroundUsage().spent).toBeGreaterThan(0);
    await rt.shutdown();
  });
});
