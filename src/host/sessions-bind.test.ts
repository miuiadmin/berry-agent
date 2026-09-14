/**
 * sessions 受理面 fork 绑定测试（ag 批 cs-D2——03 §4.5 定形注）。
 *
 * 覆盖三维（绑定件 bindSessionsForPlugin + bootPlugins fork 级接线）：
 *  - 归因闸：插件道 appendEventFor 落账事件 data.source 归因 plugin:<id>
 *    （宿主单方拼装——传入面无 caller 位，插件自供 source 键覆写）；
 *  - 行籍闸：行不在活装载代（generationDead / isRowActive=false）即残句柄
 *    拒写 PLUGIN_WINDOW_CLOSED（「行不在活计划即无写径」执法位）；
 *  - 结构前提：data 非纯对象拒（SESSION_EVENT_DATA_INVALID——归因键恒在
 *    的结构前提）；宿主道（无 caller 的基础面）零变——归因只发生在绑定面。
 *
 * 另含 ag 批 DP3 锁：core: 注册表 16 件 api 块对宿主 1.0 恒 admit（同仓同
 * 版本锁形态——CorePluginReference.api 即官方清单载体）。
 *
 * 分层纪律：绑定件纯单元（真 SessionLog 零 mock）+ 组合根 fork 级（真装载
 * 管线 + HostRuntime 结构化替身）。
 */
import { describe, expect, it } from 'vitest';

import { BaseError, registerEventType } from '../contracts/index.js';
import { adjudicateApiGate } from '../contracts/api.js';
import { EventDispatch, Scope } from '../context/index.js';
import { SessionLog } from '../session/index.js';
import type { SessionLog as SessionLogType } from '../session/index.js';

import { createCorePlugins } from './core-plugins.js';
import type { CorePluginReference } from './loader.js';
import { bootPlugins } from './plugin-boot.js';
import type { PluginBootFs, PluginBootOptions } from './plugin-boot.js';
import { bindSessionsForPlugin, createSessionsFace } from './sessions-face.js';
import type { SessionsDriverOf } from './sessions-face.js';
import type { HostRuntime } from './runtime.js';

// 测试用插件词（词汇注册表单源——过闸正路样本）
registerEventType({
  type: 'sessions-bind.test/note',
  category: 'surface',
  owner: 'sessions-bind.test',
  tier: 'stable',
  description: 'sessions fork 绑定测试用事件词',
});

/** 断言抛指定码 */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('未拒绝');
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

/** 内存驱动表（活引用语义受控样本） */
function tableOf(): { table: Map<string, { session: SessionLogType }>; driverOf: SessionsDriverOf } {
  const table = new Map<string, { session: SessionLogType }>();
  return { table, driverOf: (sessionId) => table.get(sessionId) };
}

/** 内存 fs（boot 读侧注入） */
function memoryFs(files: Record<string, string> = {}): PluginBootFs {
  const map = new Map(Object.entries(files));
  return { read: (path) => map.get(path) ?? null, write: (path, text) => void map.set(path, text) };
}

/** HostRuntime 结构化替身（装配序消费面 = dataDir + registerCloser） */
function stubRuntime(dataDir: string | null): HostRuntime & {
  closers: Array<{ label: string; fn: () => Promise<void> }>;
} {
  const closers: Array<{ label: string; fn: () => Promise<void> }> = [];
  return {
    memory: dataDir === null,
    dataDir,
    closers,
    persistence: {} as HostRuntime['persistence'], // 装配序不消费——占位
    abortSignal: new AbortController().signal,
    disclosure: () => null,
    registerCloser: (closer) => closers.push(closer as { label: string; fn: () => Promise<void> }),
    registerShutdownHook: () => undefined,
    registerDisposer: () => undefined,
    shutdown: async () => undefined,
    writeCrashLog: () => undefined,
  };
}

/** 装配选项速记 */
function rigBoot(
  dataDir: string | null,
  overrides: Partial<PluginBootOptions> = {},
): { options: PluginBootOptions; dispatch: EventDispatch; scope: Scope } {
  const scope = Scope.createRoot();
  const dispatch = new EventDispatch();
  const options: PluginBootOptions = {
    runtime: stubRuntime(dataDir),
    scope,
    dispatch,
    commands: { register: () => () => undefined },
    llm: { registerProvider: () => () => undefined },
    version: '9.9.9-test',
    ...overrides,
  };
  return { options, dispatch, scope };
}

describe('bindSessionsForPlugin 归因闸（单元——03 §4.5 cs-D2）', () => {
  it('source 归因：绑定面 appendEventFor 落账 data.source = plugin:<id>（宿主单方拼装 + 原对象零突变）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-attr' });
    table.set('s-attr', { session: log });
    const bound = bindSessionsForPlugin('demo', createSessionsFace({ driverOf }));
    const data = { note: '甲' };
    bound.appendEventFor('s-attr')!('sessions-bind.test/note', data);
    expect(log.events()).toHaveLength(1);
    expect(log.events()[0]!.data).toEqual({ note: '甲', source: 'plugin:demo' }); // 归因键恒在
    expect(data).toEqual({ note: '甲' }); // 原对象零突变（浅拷贝盖章）
  });

  it('覆写律：插件自供 source 键被覆写（传入面无归因参数位——伪造结构性不存在）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-forge' });
    table.set('s-forge', { session: log });
    const bound = bindSessionsForPlugin('demo', createSessionsFace({ driverOf }));
    bound.appendEventFor('s-forge')!('sessions-bind.test/note', { note: '乙', source: 'plugin:core:memory' });
    expect(log.events()[0]!.data).toEqual({ note: '乙', source: 'plugin:demo' }); // 冒名键覆写
  });

  it('结构前提：data 非纯对象拒 SESSION_EVENT_DATA_INVALID（数组/原始值/null 均拒——归因键无处落）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-shape' });
    table.set('s-shape', { session: log });
    const bound = bindSessionsForPlugin('demo', createSessionsFace({ driverOf }));
    const append = bound.appendEventFor('s-shape')!;
    expectCode(() => append('sessions-bind.test/note', ['数组']), 'SESSION_EVENT_DATA_INVALID');
    expectCode(() => append('sessions-bind.test/note', '字符串'), 'SESSION_EVENT_DATA_INVALID');
    expectCode(() => append('sessions-bind.test/note', null), 'SESSION_EVENT_DATA_INVALID');
    expect(log.events()).toHaveLength(0); // 拒写零落账
  });

  it('行籍闸：isRowActive=false → 残句柄写拒 PLUGIN_WINDOW_CLOSED（行不在活计划即无写径）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-stale' });
    table.set('s-stale', { session: log });
    let active = true;
    const bound = bindSessionsForPlugin('demo', createSessionsFace({ driverOf }), () => active);
    const append = bound.appendEventFor('s-stale')!; // 行活期取引用
    active = false; // 行回卷（scope dispose / 装载代翻死）
    expectCode(() => append('sessions-bind.test/note', { note: '残' }), 'PLUGIN_WINDOW_CLOSED');
    expectCode(() => bound.appendEventFor('s-stale'), 'PLUGIN_WINDOW_CLOSED'); // 取引用拍同拒
    expect(log.events()).toHaveLength(0);
  });

  it('surfaceOp 信封腿同盖章：绑定面携信封经正门落账——事件 data 归因随行', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-surf' });
    table.set('s-surf', { session: log });
    const bound = bindSessionsForPlugin('demo', createSessionsFace({ driverOf }));
    // 底座两条真投影事件（测试即宿主位直 append）
    log.append('user/message', { content: '旧消息一' });
    log.append('user/message', { content: '旧消息二' });
    const returned = bound.appendEventFor('s-surf')!(
      'sessions-bind.test/note',
      { note: '归并' },
      { op: 'replace', start: 0, end: 1 },
      [0, 1],
    );
    expect(returned).toMatchObject({
      type: 'sessions-bind.test/note',
      seq: 2,
      data: { note: '归并', source: 'plugin:demo' }, // 信封腿盖章同律
    });
  });

  it('宿主道零变：无 caller 的基础面（宿主直用形）落账 data 原样——归因只发生在绑定面', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-host' });
    table.set('s-host', { session: log });
    const face = createSessionsFace({ driverOf }); // 基础面（宿主位）
    face.appendEventFor('s-host')!('sessions-bind.test/note', { note: '宿主' });
    expect(log.events()[0]!.data).toEqual({ note: '宿主' }); // 无 source 键——零变
  });
});

describe('fork 级接线（bootPlugins options.sessions——03 §4.5 共享根废止形）', () => {
  it('插件 fork 内 ctx.get("sessions") = 绑定面：落账 source 归因 plugin:<行id>（宿主单方拼装）', async () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-fork' });
    table.set('s-fork', { session: log });
    const probe: CorePluginReference = {
      name: 'probe-sessions',
      apply: async (ctx) => {
        const face = (ctx as { get: (n: string) => unknown }).get('sessions') as {
          appendEventFor(id: string): ((type: string, data: unknown) => unknown) | undefined;
        };
        face.appendEventFor('s-fork')!('sessions-bind.test/note', { note: '插件道' });
      },
    };
    const { options, scope } = rigBoot('/data', {
      corePlugins: [probe],
      fs: memoryFs(),
      sessions: createSessionsFace({ driverOf }),
    });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:probe-sessions']);
    expect(log.events()).toHaveLength(1);
    expect(log.events()[0]!.data).toEqual({ note: '插件道', source: 'plugin:core:probe-sessions' }); // 归因键 = 行 id
    expect(scope.tryGet('sessions')).toBeUndefined(); // 共享根废止（fork 独见——03 §4.5 定形注）
  });

  it('行籍闸（装载代回卷）：closer plugin-unload 回卷后残句柄再写即拒 PLUGIN_WINDOW_CLOSED', async () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-gen' });
    table.set('s-gen', { session: log });
    let captured: ((type: string, data: unknown) => unknown) | undefined;
    const probe: CorePluginReference = {
      name: 'probe-gen',
      apply: async (ctx) => {
        const face = (ctx as { get: (n: string) => unknown }).get('sessions') as {
          appendEventFor(id: string): ((type: string, data: unknown) => unknown) | undefined;
        };
        captured = face.appendEventFor('s-gen'); // 行活期铸的句柄
      },
    };
    const runtime = stubRuntime('/data');
    const { options } = rigBoot('/data', {
      runtime,
      corePlugins: [probe],
      fs: memoryFs(),
      sessions: createSessionsFace({ driverOf }),
    });
    await bootPlugins(options);
    captured!('sessions-bind.test/note', { note: '活期' }); // 回卷前正写
    expect(log.events()).toHaveLength(1);
    const unload = runtime.closers.find((c) => c.label === 'plugin-unload');
    await unload!.fn(); // 装载代回卷（fork 逆序 dispose——generationDead 翻死）
    expectCode(() => captured!('sessions-bind.test/note', { note: '残句柄' }), 'PLUGIN_WINDOW_CLOSED');
    expect(log.events()).toHaveLength(1); // 拒写零落账
  });

  it('缺席 = ctx.get 响亮 CONTEXT_SERVICE_MISSING（诚实缺席律——共享根同无此名）', async () => {
    const errs: unknown[] = [];
    const probe: CorePluginReference = {
      name: 'probe-absent',
      apply: async (ctx) => {
        try {
          (ctx as { get: (n: string) => unknown }).get('sessions');
        } catch (err) {
          errs.push(err);
        }
      },
    };
    const { options } = rigBoot('/data', { corePlugins: [probe], fs: memoryFs() });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:probe-absent']);
    expect(errs).toHaveLength(1);
    expect((errs[0] as { code: string }).code).toBe('CONTEXT_SERVICE_MISSING');
  });
});

describe('core: 注册表 api 回填锁（ag 批 DP3——同仓同版本恒过形态）', () => {
  it('16 件 api 块齐备且对宿主 1.0 全 admit（官方清单载体 = CorePluginReference.api）', () => {
    const refs = createCorePlugins({ dataDir: null });
    expect(refs).toHaveLength(16);
    for (const ref of refs) {
      const verdict = adjudicateApiGate(ref.api, '1.0', `core:${ref.name}`);
      expect(verdict.status).toBe('admit'); // api 块在场 + min ≤ 宿主——legacy/拒载出口结构性不发生
    }
  });
});
