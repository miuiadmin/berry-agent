/**
 * host/plugin-boot 组合根测试——装载装配序全景（读侧三源两律 + core overlay +
 * 装机账本解析 + --no-plugins 短路 + 生命周期事件 + closer 回卷）。
 *
 * 组合根全栈惯例：真装载管线（真 Kahn/真 jiti/真注册表）+ HostRuntime 结构
 * 化替身（装配序只消费 dataDir/registerCloser 两面）+ fs 注入内存 Map（读侧
 * 三源与记账面）；磁盘行端到端一条用真盘临时目录（jiti 读真实 entry 文件）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';
import { EventDispatch, Scope } from '../context/index.js';

import { readBootFailures } from './boot-failures.js';
import type { CorePluginReference } from './loader.js';
import { bootPlugins } from './plugin-boot.js';
import type { PluginBootFs, PluginBootOptions } from './plugin-boot.js';
import type { HostRuntime } from './runtime.js';

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 内存 fs（Map 背书——读侧三源 + boot-failures 记账面全注入） */
function memoryFs(files: Record<string, string> = {}): PluginBootFs & { map: Map<string, string> } {
  const map = new Map(Object.entries(files));
  return { map, read: (path) => map.get(path) ?? null, write: (path, text) => void map.set(path, text) };
}

/** HostRuntime 结构化替身（装配序消费面 = dataDir + registerCloser + memory 位） */
function stubRuntime(
  dataDir: string | null,
): HostRuntime & { closers: Array<{ label: string; fn: () => Promise<void> }> } {
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

/** 装配选项速记（共享根 + 总线 + 受局面替身——core 引用缺省空） */
function rigBoot(
  dataDir: string | null,
  overrides: Partial<PluginBootOptions> & { fs?: PluginBootFs } = {},
): { options: PluginBootOptions; dispatch: EventDispatch; scope: Scope; warnings: string[] } {
  const warnings: string[] = [];
  const scope = Scope.createRoot();
  const dispatch = new EventDispatch();
  const options: PluginBootOptions = {
    runtime: overrides.runtime ?? stubRuntime(dataDir),
    scope,
    dispatch,
    commands: { register: () => () => undefined },
    llm: { registerProvider: () => () => undefined },
    version: '9.9.9-test',
    warn: (message) => warnings.push(message),
    ...overrides,
  };
  return { options, dispatch, scope, warnings };
}

/** yaml 启用清单文本速记 */
const enabledYaml = (rows: string): `plugins:\n${string}` => `plugins:\n${rows}`;

describe('enabled.yaml 读侧两律（03 §5.3）', () => {
  it('缺席 = 全 core: 内置态（零文件零负担——core 注册表照装）', async () => {
    const applied: string[] = [];
    const ref: CorePluginReference = { name: 'demo', apply: async () => void applied.push('demo') };
    const { options } = rigBoot('/data', { corePlugins: [ref], fs: memoryFs() });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:demo']);
    expect(applied).toEqual(['demo']);
    expect(boot.counts).toEqual({ total: 1, enabled: 1, failed: 0 });
  });

  it('yaml 解析坏形 = fail-loud 拒启（PLUGIN_ROW_INVALID + 修复指引）', async () => {
    const fs = memoryFs({ '/data/enabled.yaml': 'plugins: [ Oops' });
    try {
      await bootPlugins(rigBoot('/data', { fs }).options);
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('PLUGIN_ROW_INVALID');
        expect(err.message).toContain('修复或删除'); // 修复指引在场
        return;
      }
      throw err;
    }
  });

  it('行 schema 违例 = fail-loud 拒启（未知键点名）', async () => {
    const fs = memoryFs({ '/data/enabled.yaml': enabledYaml('  - id: acme\n    unknown: 1\n') });
    try {
      await bootPlugins(rigBoot('/data', { fs }).options);
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('PLUGIN_ROW_INVALID');
        expect(err.message).toContain('unknown'); // 违例键点名
        return;
      }
      throw err;
    }
  });

  it('memory 形（dataDir null）= 缺席同构——core 内置态', async () => {
    const ref: CorePluginReference = { name: 'demo', apply: async () => undefined };
    const fs = memoryFs();
    const { options } = rigBoot(null, { corePlugins: [ref], fs });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:demo']);
    expect(fs.map.has('/boot-failures.json')).toBe(false); // 诊断面整跳——零写
  });
});

describe('core: 装载与 Kahn provide（03 §1.3/§2.2 表行）', () => {
  it('ctx.provide 落共享根——后续轮次解锁依赖方（inject 行后装且 get 真达）', async () => {
    const seen: unknown[] = [];
    const provider: CorePluginReference = {
      name: 'provider',
      apply: async (ctx) => {
        (ctx as { provide: (n: string, v: unknown) => void }).provide('demo-svc', { v: 7 });
      },
    };
    // consumer 声明硬依赖——Kahn 须排到 provider 之后（计划序故意反排证真排序）
    const consumer: CorePluginReference = {
      name: 'consumer',
      inject: ['demo-svc'],
      apply: async (ctx) => {
        seen.push((ctx as { get: (n: string) => unknown }).get('demo-svc'));
      },
    };
    const { options, scope } = rigBoot('/data', { corePlugins: [consumer, provider], fs: memoryFs() });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:provider', 'core:consumer']);
    expect(seen).toEqual([{ v: 7 }]);
    expect(scope.tryGet('demo-svc')).toEqual({ v: 7 }); // 共享根可见（跨插件面）
  });

  it('hostFace 物化（version 透传 + pluginId 附身）', async () => {
    const faces: unknown[] = [];
    const ref: CorePluginReference = {
      name: 'demo',
      apply: async (ctx) => void faces.push((ctx as { host: unknown }).host),
    };
    const { options } = rigBoot('/data', { corePlugins: [ref], fs: memoryFs() });
    await bootPlugins(options);
    const host = faces[0] as { version: string; pluginId: string };
    expect(host.version).toBe('9.9.9-test');
    expect(host.pluginId).toBe('core:demo');
  });

  it('core: 行 apply 抛错 = fail-loud（CorePluginBootError 拒启）', async () => {
    const bad: CorePluginReference = {
      name: 'bad',
      apply: async () => {
        throw new Error('boom');
      },
    };
    await expect(bootPlugins(rigBoot('/data', { corePlugins: [bad], fs: memoryFs() }).options)).rejects.toThrow(
      'core: 官方件装载失败拒启',
    );
  });
});

describe('core overlay（§5.3 用户行覆盖——字段级后写胜出）', () => {
  it('config 整值替换（宿主默认让位）+ 省略字段沿用内置值', async () => {
    const configs: unknown[] = [];
    const ref: CorePluginReference = {
      name: 'demo',
      config: { builtIn: true },
      apply: async (_ctx, config) => void configs.push(config),
    };
    const fs = memoryFs({ '/data/enabled.yaml': enabledYaml('  - id: core:demo\n    config: { user: 1 }\n') });
    const boot = await bootPlugins(rigBoot('/data', { corePlugins: [ref], fs }).options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:demo']);
    expect(configs).toEqual([{ user: 1 }]); // 整值替换非合并
  });

  it('disabled 覆盖 → skipped 面（内置全启的用户否决腿）', async () => {
    const ref: CorePluginReference = {
      name: 'demo',
      apply: async () => {
        throw new Error('不应执行');
      },
    };
    const fs = memoryFs({ '/data/enabled.yaml': enabledYaml('  - id: core:demo\n    disabled: true\n') });
    const boot = await bootPlugins(rigBoot('/data', { corePlugins: [ref], fs }).options);
    expect(boot.report.activated).toEqual([]);
    expect(boot.report.skipped).toEqual([{ id: 'core:demo', reason: expect.stringContaining('disabled') }]);
  });

  it('用户行 core: 前缀而无注册表成员 = 合成失败（档②隔离不 brick）', async () => {
    const ok: CorePluginReference = { name: 'demo', apply: async () => undefined };
    const fs = memoryFs({ '/data/enabled.yaml': enabledYaml('  - id: core:ghost\n') });
    const { options, warnings } = rigBoot('/data', { corePlugins: [ok], fs });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:demo']); // 其余行照常
    expect(boot.report.failed.map((f) => f.id)).toEqual(['core:ghost']);
    expect(boot.counts).toEqual({ total: 2, enabled: 1, failed: 1 });
    expect(warnings.some((w) => w.includes('core:ghost'))).toBe(true); // warn 横幅点名
  });
});

describe('装机账本读侧（03 §5.4——warn 降级与 installPath 解析）', () => {
  const diskPkg = (name: string): string =>
    JSON.stringify({ name, version: '1.0.0', berryAgent: { entry: 'entry.js' } });

  it('账本缺席条目 = 行级隔离（failed 面 + boot-failures 记账）', async () => {
    const fs = memoryFs({
      '/data/enabled.yaml': enabledYaml('  - id: acme\n'),
    });
    const { options } = rigBoot('/data', { fs });
    const boot = await bootPlugins(options);
    expect(boot.report.failed).toHaveLength(1);
    expect(boot.report.failed[0]!.id).toBe('acme');
    expect(boot.report.failed[0]!.message).toContain('装机账本无此 id');
    // 记账面：boot-failures.json 落失败行
    const failures = readBootFailures('/data/boot-failures.json', { read: fs.read, write: fs.write });
    expect(failures.failures['acme']).toEqual({ version: '', count: 1 });
  });

  it('installPath 相对/绝对两式解析（相对 join 数据目录；declared-payload 零码形免真盘）', async () => {
    const fs = memoryFs({
      '/data/enabled.yaml': enabledYaml('  - id: acme-rel\n  - id: acme-abs\n'),
      '/data/plugins/ledger.json': JSON.stringify({
        'acme-rel': { installPath: 'plugins/node_modules/acme-rel' },
        'acme-abs': { installPath: '/opt/abs/acme-abs' },
      }),
      '/data/plugins/node_modules/acme-rel/package.json': JSON.stringify({
        name: 'acme-rel',
        version: '1.0.0',
        berryAgent: { skills: ['rel-skill'] },
      }),
      '/opt/abs/acme-abs/package.json': JSON.stringify({
        name: 'acme-abs',
        version: '1.0.0',
        berryAgent: { skills: ['abs-skill'] },
      }),
    });
    const boot = await bootPlugins(rigBoot('/data', { fs }).options);
    expect(boot.report.failed.map((f) => f.id)).toEqual([]);
    expect(boot.report.activated.map((a) => a.id).sort()).toEqual(['acme-abs', 'acme-rel']);
  });

  it('磁盘行 opens 全链绿灯（批 U2：parse 行校验 → spec 透传 → ctx 装配不破坏装载）', async () => {
    const fs = memoryFs({
      '/data/enabled.yaml': enabledYaml('  - id: acme-door\n    opens: [sdk.register-route, channels.ui-backend]\n'),
      '/data/plugins/ledger.json': JSON.stringify({ 'acme-door': { installPath: 'plugins/node_modules/acme-door' } }),
      '/data/plugins/node_modules/acme-door/package.json': JSON.stringify({
        name: 'acme-door',
        version: '1.0.0',
        berryAgent: { skills: ['door-skill'] },
      }),
    });
    const boot = await bootPlugins(rigBoot('/data', { fs }).options);
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['acme-door']);
    expect(boot.report.activated[0]!.skills).toEqual(['door-skill']);
  });

  it('目录不可读 = 行级隔离（无 package.json 点名）', async () => {
    const fs = memoryFs({
      '/data/enabled.yaml': enabledYaml('  - id: acme\n'),
      '/data/plugins/ledger.json': JSON.stringify({ acme: { installPath: 'plugins/node_modules/acme' } }),
      // 装机目录缺席——package.json 读不到
    });
    const boot = await bootPlugins(rigBoot('/data', { fs }).options);
    expect(boot.report.failed[0]!.message).toContain('package.json');
  });

  it('清单坏形 = PLUGIN_SHAPE_INVALID 分流（行级隔离）', async () => {
    const fs = memoryFs({
      '/data/enabled.yaml': enabledYaml('  - id: acme\n'),
      '/data/plugins/ledger.json': JSON.stringify({ acme: { installPath: 'plugins/node_modules/acme' } }),
      '/data/plugins/node_modules/acme/package.json': JSON.stringify({ name: 'acme' }), // 无 berryAgent 清单
    });
    const boot = await bootPlugins(rigBoot('/data', { fs }).options);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_SHAPE_INVALID');
  });

  it('账本损坏 = warn 点名 + 空账本降级（不 brick——core 行照装）', async () => {
    const ok: CorePluginReference = { name: 'demo', apply: async () => undefined };
    const fs = memoryFs({
      '/data/enabled.yaml': enabledYaml('  - id: acme\n'),
      '/data/plugins/ledger.json': '{ broken json',
    });
    const { options, warnings } = rigBoot('/data', { corePlugins: [ok], fs });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:demo']);
    expect(warnings.some((w) => w.includes('ledger.json') && w.includes('空账本'))).toBe(true);
  });

  it('磁盘行端到端（真盘真 jiti：entry-file 装载 + ctx 注册动词真达）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'host-plugin-boot-'));
    dirs.push(dataDir);
    const pluginDir = join(dataDir, 'plugins', 'node_modules', 'acme-e2e');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(join(pluginDir, 'package.json'), diskPkg('acme-e2e'));
    // 真入口：注册一条命令（CommandRegistryLike 替身收执）——jiti 转译真装载
    writeFileSync(
      join(pluginDir, 'entry.js'),
      [
        'export const inject = [];',
        'export default async (ctx) => {',
        '  ctx.channels.registerCommand("acme-hello", () => {}, "端到端命令");',
        '};',
      ].join('\n'),
    );
    writeFileSync(join(dataDir, 'enabled.yaml'), enabledYaml('  - id: acme-e2e\n'));
    writeFileSync(
      join(dataDir, 'plugins', 'ledger.json'),
      JSON.stringify({ 'acme-e2e': { installPath: 'plugins/node_modules/acme-e2e' } }),
    );
    const registered: string[] = [];
    const { options } = rigBoot(dataDir, {
      commands: {
        register: (name) => {
          registered.push(name);
          return () => undefined;
        },
      },
    });
    const boot = await bootPlugins(options);
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['acme-e2e']);
    expect(registered).toEqual(['acme-hello']); // 真装载 + ctx 注册动词真达
  });
});

describe('boot-failures 记账与清名（§5.7 档②）', () => {
  it('装载成功行清名（报捷即抹账——横幅只报仍坏行）', async () => {
    const fs = memoryFs({
      // 先前失败遗留的账
      '/data/boot-failures.json': JSON.stringify({
        failures: { acme: { version: '', count: 3 }, ghost: { version: '', count: 1 } },
      }),
      '/data/enabled.yaml': enabledYaml('  - id: acme\n'),
      '/data/plugins/ledger.json': JSON.stringify({ acme: { installPath: 'plugins/node_modules/acme' } }),
      '/data/plugins/node_modules/acme/package.json': JSON.stringify({
        name: 'acme',
        version: '1.0.0',
        berryAgent: { skills: ['acme-skill'] },
      }),
    });
    const boot = await bootPlugins(rigBoot('/data', { fs }).options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['acme']);
    const failures = readBootFailures('/data/boot-failures.json', { read: fs.read, write: fs.write });
    expect(failures.failures['acme']).toBeUndefined(); // 成功行清名
    expect(failures.failures['ghost']).toBeDefined(); // 未装载行留账
  });
});

describe('--no-plugins 短路（07 §六）', () => {
  it('装载面整跳：空报告/零计数/零 closer/钩子词不注册/注册表空形在场', async () => {
    const ref: CorePluginReference = {
      name: 'demo',
      apply: async () => {
        throw new Error('不应执行');
      },
    };
    const runtime = stubRuntime('/data');
    const { options, dispatch } = rigBoot('/data', { runtime, corePlugins: [ref], noPlugins: true, fs: memoryFs() });
    const boot = await bootPlugins(options);
    expect(boot.report.activated).toEqual([]);
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.skipped).toEqual([]);
    expect(boot.counts).toEqual({ total: 0, enabled: 0, failed: 0 });
    expect(runtime.closers).toEqual([]);
    expect(dispatch.isRegistered('plugin/activated')).toBe(false); // 词汇不预注册
    expect(boot.tools).toBeDefined(); // 注册表空形在场（消费面形态统一）
    expect(boot.promptSections).toBeDefined();
  });
});

describe('生命周期事件（§2.4 生命周期组——收口批量补发）', () => {
  it('plugin/activated·failed + composition/reloaded（插件侧订阅收执——装载序内挂听）', async () => {
    const activated: string[] = [];
    const failed: string[] = [];
    const compositions: unknown[] = [];
    const observer: CorePluginReference = {
      name: 'observer',
      apply: async (ctx) => {
        const c = ctx as {
          on: (name: string, handler: (data: unknown) => unknown) => () => void;
        };
        c.on('plugin/activated', (data) => void activated.push((data as { id: string }).id));
        c.on('plugin/failed', (data) => void failed.push((data as { id: string }).id));
        c.on('composition/reloaded', (data) => void compositions.push(data));
      },
    };
    const later: CorePluginReference = { name: 'later', apply: async () => undefined };
    const fs = memoryFs({ '/data/enabled.yaml': enabledYaml('  - id: core:ghost\n') });
    const { options, dispatch } = rigBoot('/data', { corePlugins: [observer, later], fs });
    const boot = await bootPlugins(options);
    // observer 自身与 later 的 activated 皆达（批量补发在全部行装载后）
    expect(activated.sort()).toEqual(['core:later', 'core:observer']);
    expect(failed).toEqual(['core:ghost']); // 合成失败行并入 failed 面
    const composition = compositions[0] as { activated: string[]; failed: string[]; skipped: string[] };
    expect(composition.activated.sort()).toEqual(['core:later', 'core:observer']);
    expect(composition.failed).toEqual(['core:ghost']);
    expect(composition.skipped).toEqual([]);
    // 词面已注册（宿主侧也可挂听——/reload 观测面）
    expect(dispatch.isRegistered('composition/reloaded')).toBe(true);
    expect(boot.counts.enabled).toBe(2);
  });

  it('disabled 行 → plugin/skipped（reason 随行）', async () => {
    const skipped: string[] = [];
    const observer: CorePluginReference = {
      name: 'observer',
      apply: async (ctx) => {
        (ctx as { on: (n: string, h: (d: unknown) => unknown) => () => void }).on(
          'plugin/skipped',
          (data) => void skipped.push((data as { id: string }).id),
        );
      },
    };
    const off: CorePluginReference = { name: 'off', apply: async () => undefined };
    const fs = memoryFs({ '/data/enabled.yaml': enabledYaml('  - id: core:off\n    disabled: true\n') });
    await bootPlugins(rigBoot('/data', { corePlugins: [observer, off], fs }).options);
    expect(skipped).toEqual(['core:off']);
  });
});

describe('secrets 面装配（c-3——03 §2.2 第十面 fork 级绑定 + 席位门）', () => {
  /** 内存凭证窄面替身（assembly 真源 = persistence.store 凭证投影——面形同构） */
  function memorySecretsStore() {
    const rows = new Map<string, { apiKey: string; meta?: unknown }>();
    return {
      rows,
      getCredential: (ns: string, provider: string) => rows.get(`${ns} ${provider}`),
      setCredential: (ns: string, provider: string, entry: { apiKey: string; meta?: unknown }) =>
        void rows.set(`${ns} ${provider}`, entry),
    };
  }

  it('席位在场 + 注入在场：探针 fork 见自域绑定版（pluginId 附身防冒名）', async () => {
    const store = memorySecretsStore();
    store.setCredential('plugin:core:probe', 'k', { apiKey: 'v-self' }); // core ref id 含前缀
    store.setCredential('plugin:other', 'k', { apiKey: 'v-other' }); // 同名他域行——隔离律判据
    const seen: unknown[] = [];
    const credentials: CorePluginReference = { name: 'credentials', apply: async () => undefined };
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        seen.push((ctx as { tryGet: (n: string) => unknown }).tryGet('secrets'));
      },
    };
    const { options, scope } = rigBoot('/data', {
      corePlugins: [credentials, probe],
      fs: memoryFs(),
      secrets: { store },
    });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:credentials', 'core:probe']);
    const face = seen[0] as { get(name: string): string };
    expect(face.get('k')).toBe('v-self'); // 自域绑定：probe 见 plugin:probe 域行
    expect(scope.tryGet('secrets')).toBeUndefined(); // 共享根无此名——fork 级独见（标记不外泄）
  });

  it('Kahn 可满足标记：inject: ["secrets"] 声明合法可解（fork 真身消费面）', async () => {
    const store = memorySecretsStore();
    const seen: unknown[] = [];
    const credentials: CorePluginReference = { name: 'credentials', apply: async () => undefined };
    const consumer: CorePluginReference = {
      name: 'consumer',
      inject: ['secrets'], // 声明硬依赖——标记位应答使其可装载
      apply: async (ctx) => {
        seen.push((ctx as { get: (n: string) => unknown }).get('secrets'));
      },
    };
    const { options } = rigBoot('/data', {
      corePlugins: [credentials, consumer],
      fs: memoryFs(),
      secrets: { store },
    });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:credentials', 'core:consumer']);
    expect(typeof (seen[0] as { get(name: string): string }).get).toBe('function'); // 消费面真达
  });

  it('enabled.yaml 禁 core:credentials 行 → secrets 面整体缺席（诚实缺席律）', async () => {
    const seen: unknown[] = [];
    const credentials: CorePluginReference = {
      name: 'credentials',
      apply: async () => {
        throw new Error('不应执行');
      },
    };
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        seen.push((ctx as { tryGet: (n: string) => unknown }).tryGet('secrets'));
      },
    };
    const fs = memoryFs({
      '/data/enabled.yaml': enabledYaml('  - id: core:credentials\n    disabled: true\n'),
    });
    const { options } = rigBoot('/data', {
      corePlugins: [credentials, probe],
      fs,
      secrets: { store: memorySecretsStore() }, // 注入在场但席位禁用——门判不满足
    });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:probe']);
    expect(boot.report.skipped.map((s) => s.id)).toEqual(['core:credentials']);
    expect(seen).toEqual([undefined]); // 探针 fork 无 secrets——缺席诚实
  });

  it('secrets 注入缺席 → 面不提供（core:credentials 席照常装载——门判另一半）', async () => {
    const seen: unknown[] = [];
    const credentials: CorePluginReference = { name: 'credentials', apply: async () => undefined };
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        seen.push((ctx as { tryGet: (n: string) => unknown }).tryGet('secrets'));
      },
    };
    const { options } = rigBoot('/data', { corePlugins: [credentials, probe], fs: memoryFs() }); // 无 secrets 注入
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:credentials', 'core:probe']);
    expect(seen).toEqual([undefined]);
  });

  it('写窗执法装配真源：set 在装载窗外拒（inWriteWindow = handle.inHostCallback）', async () => {
    const store = memorySecretsStore();
    const errs: string[] = [];
    const credentials: CorePluginReference = { name: 'credentials', apply: async () => undefined };
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        const face = (ctx as { tryGet: (n: string) => unknown }).tryGet('secrets') as {
          set(name: string, value: string): void;
        };
        try {
          face.set('k', 'v');
        } catch (err) {
          errs.push(err instanceof BaseError ? err.code : String(err));
        }
      },
    };
    await bootPlugins(
      rigBoot('/data', { corePlugins: [credentials, probe], fs: memoryFs(), secrets: { store } }).options,
    );
    // 装载窗（apply）非宿主回调窗——写面 fail-closed 拒
    expect(errs).toEqual(['CREDENTIALS_WRITE_WINDOW_CLOSED']);
    expect(store.rows.size).toBe(0);
  });
});

describe('closer plugin-unload（§5.7 档③ + effect 回卷）', () => {
  it('apply disposer LIFO + fork 作用域逆序 dispose（ctx.effect 回卷）', async () => {
    const order: string[] = [];
    const first: CorePluginReference = {
      name: 'first',
      apply: async (ctx) => {
        (ctx as { effect: (r: () => () => void) => void }).effect(() => () => order.push('first-effect'));
        return () => order.push('first-apply');
      },
    };
    const second: CorePluginReference = {
      name: 'second',
      apply: async (ctx) => {
        (ctx as { effect: (r: () => () => void) => void }).effect(() => () => order.push('second-effect'));
        return () => order.push('second-apply');
      },
    };
    const runtime = stubRuntime('/data');
    const { options } = rigBoot('/data', { runtime, corePlugins: [first, second], fs: memoryFs() });
    await bootPlugins(options);
    expect(runtime.closers.map((c) => c.label)).toEqual(['plugin-unload']);
    await runtime.closers[0]!.fn();
    // 两段清算：先 apply disposer 全栈 LIFO（second→first），后 fork 作用域逆序
    // dispose（second-effect→first-effect）——apply 面与 effect 面分两段各守 LIFO
    expect(order).toEqual(['second-apply', 'first-apply', 'second-effect', 'first-effect']);
    // 幂等：二调直返（loadPlugins.unload 幂等 + Scope.dispose 幂等）
    await runtime.closers[0]!.fn();
    expect(order).toHaveLength(4);
  });
});
