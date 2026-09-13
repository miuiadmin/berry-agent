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
import type { ToolDefinition } from '../contracts/index.js';
import type { UiBackend } from '../contracts/index.js';
import { EventDispatch, Scope } from '../context/index.js';
import { createChannels } from '../channels/index.js';
import {
  AUDIT_MIGRATION,
  LOAD_GENERATIONS_MIGRATION,
  createAuditFace,
  createLoadHistoryFace,
  openStore,
} from '../persist/index.js';
import type { AuditFace, LoadHistoryFace, Store } from '../persist/index.js';
// 子代理 service 真身（物化消费腿 e2e——遗漏审计批 G）
import { createJobRegistry, createSubagentService } from '../subagent/index.js';

import { readBootFailures } from './boot-failures.js';
import type { CorePluginReference } from './loader.js';
import {
  bootPlugins,
  createPluginToolLedger,
  recordDoorsDiff,
  recordPluginLifecycleDiff,
  recordPluginOpensDiff,
} from './plugin-boot.js';
import type { PluginBootFs, PluginBootOptions, PluginUnloadReceipt } from './plugin-boot.js';
import type { HostRuntime } from './runtime.js';
import { createCompactionSlots } from '../compaction/index.js';
import { DEFAULT_COMPACTION_CONFIG } from '../compaction/types.js';
import { createPluginRouteRegistry } from '../sdk/index.js';
import type { PluginRouteDescriptor, SdkRoutesPluginFace } from '../sdk/index.js';

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
    // 记账面：boot-failures.json 落失败行（obs-a——含 lastError 错误文本与
    // lastFailedAt 时点；合成失败行同批扩形）
    const failures = readBootFailures('/data/boot-failures.json', { read: fs.read, write: fs.write });
    expect(failures.failures['acme']).toEqual({
      version: '',
      count: 1,
      lastError: expect.stringContaining('装机账本无此 id'),
      lastFailedAt: expect.any(String),
    });
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
    expect(boot.report.activated[0]!.skillDirs).toEqual([join('/data/plugins/node_modules/acme-door', 'door-skill')]);
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
  it('loader 行失败启动横幅点名（obs-a——装载序尾逐行 warn 与合成失败行同形 + 账本落错误文本）', async () => {
    const fs = memoryFs({
      '/data/enabled.yaml': enabledYaml('  - id: acme-bad\n'),
      '/data/plugins/ledger.json': JSON.stringify({ 'acme-bad': { installPath: 'plugins/node_modules/acme-bad' } }),
      // 清单声明 entry 而文件缺席——装载步（jiti）失败 = loader 路径非合成路径
      '/data/plugins/node_modules/acme-bad/package.json': JSON.stringify({
        name: 'acme-bad',
        version: '1.0.0',
        berryAgent: { entry: 'entry.js' },
      }),
    });
    const { options, warnings } = rigBoot('/data', { fs });
    const boot = await bootPlugins(options);
    expect(boot.report.failed.map((f) => f.id)).toEqual(['acme-bad']);
    // 修前：loader 行失败零 warn（错误文本只在 failed 面静默——「横幅」仅存于
    // 注释与规范文本）；修后：装载序尾逐行点名，与合成失败行同形
    expect(warnings.some((w) => w.startsWith('插件装载失败（acme-bad）：['))).toBe(true);
    // 账本 lastError = [码] 报文（修前条目只有 {version, count}——错误文本在
    // 装载器 seam 丢弃）
    const failures = readBootFailures('/data/boot-failures.json', { read: fs.read, write: fs.write });
    expect(failures.failures['acme-bad']?.lastError).toMatch(/^\[[A-Z_]+\] /);
    expect(failures.failures['acme-bad']?.lastFailedAt).toEqual(expect.any(String));
  });

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

describe('注入腿席位接线（c-4——03 §10.9 注入腿：credentials-env-ref 共享根服务）', () => {
  /** 内存凭证窄面替身（c-3 块同形——assembly 真源 = persistence.store 凭证投影） */
  function memorySecretsStore() {
    const rows = new Map<string, { apiKey: string; meta?: unknown }>();
    return {
      rows,
      getCredential: (ns: string, provider: string) => rows.get(`${ns} ${provider}`),
      setCredential: (ns: string, provider: string, entry: { apiKey: string; meta?: unknown }) =>
        void rows.set(`${ns} ${provider}`, entry),
    };
  }

  it('席位在场 + 注入在场：共享根供展开器，exec 件 fork 拾取可展开 host 域', async () => {
    const store = memorySecretsStore();
    store.setCredential('host', 'github-token', { apiKey: 'sk-host' }); // host 域行——注入腿单域
    store.setCredential('plugin:other', 'github-token', { apiKey: 'sk-plugin' }); // 同名插件域行——隔离判据
    const seen: unknown[] = [];
    const credentials: CorePluginReference = { name: 'credentials', apply: async () => undefined };
    // exec 件拾取形同真身（core-plugins.ts apply 期 context.tryGet）
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        seen.push((ctx as { tryGet: (n: string) => unknown }).tryGet('credentials-env-ref'));
      },
    };
    const { options, scope } = rigBoot('/data', {
      corePlugins: [credentials, probe],
      fs: memoryFs(),
      secrets: { store },
    });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:credentials', 'core:probe']);
    // fork 拾取真达：展开 host 域行、插件域同名行不可见
    const resolve = seen[0] as (name: string) => string;
    expect(resolve('github-token')).toBe('sk-host');
    expect(scope.tryGet('credentials-env-ref')).toBe(resolve); // 共享根直证（fork 透传同引用）
  });

  it('禁用 core:credentials → 展开器缺席（席位门同 ctx.secrets——单一名册语义）', async () => {
    const seen: unknown[] = [];
    const credentials: CorePluginReference = { name: 'credentials', apply: async () => undefined };
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        seen.push((ctx as { tryGet: (n: string) => unknown }).tryGet('credentials-env-ref'));
      },
    };
    const fs = memoryFs({
      '/data/enabled.yaml': enabledYaml('  - id: core:credentials\n    disabled: true\n'),
    });
    const { options, scope } = rigBoot('/data', {
      corePlugins: [credentials, probe],
      fs,
      secrets: { store: memorySecretsStore() }, // 注入在场但席位禁用
    });
    await bootPlugins(options);
    expect(seen).toEqual([undefined]); // fork 透传共享根——服务不在场
    expect(scope.tryGet('credentials-env-ref')).toBeUndefined();
  });

  it('secrets 注入缺席 → 展开器缺席（门判另一半——fail-loud 归 exec 侧执法）', async () => {
    const seen: unknown[] = [];
    const credentials: CorePluginReference = { name: 'credentials', apply: async () => undefined };
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        seen.push((ctx as { tryGet: (n: string) => unknown }).tryGet('credentials-env-ref'));
      },
    };
    const { options, scope } = rigBoot('/data', { corePlugins: [credentials, probe], fs: memoryFs() }); // 无 secrets 注入
    await bootPlugins(options);
    expect(seen).toEqual([undefined]);
    expect(scope.tryGet('credentials-env-ref')).toBeUndefined();
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

  it('Job 归属围栏收口腿（Job 消费面批桥二）：disposer 回卷后对 activated 逐插件 closeOwner；受局面缺席 = 诚实缺位不炸', async () => {
    const events: string[] = [];
    const first: CorePluginReference = { name: 'first', apply: async () => () => events.push('first-disposer') };
    const second: CorePluginReference = { name: 'second', apply: async () => () => events.push('second-disposer') };
    const closedOwners: string[] = [];
    const runtime = stubRuntime('/data');
    const { options } = rigBoot('/data', {
      runtime,
      corePlugins: [first, second],
      fs: memoryFs(),
      jobs: {
        closeOwner: async (owner) => {
          closedOwners.push(owner);
          return [];
        },
      },
    });
    await bootPlugins(options);
    await runtime.closers[0]!.fn();
    // 内序：插件侧事件源先停（disposer 回卷），归属围栏收口后置（owner = 插件
    // id——activated 注册序）；jobs 缺席形（受局面诚实缺位）下方自证
    expect(events).toEqual(['second-disposer', 'first-disposer']);
    expect(closedOwners).toEqual(['core:first', 'core:second']);
    // jobs 受局面缺席：同一 closer 照常收口（disposer/effect 回卷不依赖收口腿）
    const bare = stubRuntime('/data');
    const { options: bareOptions } = rigBoot('/data', {
      runtime: bare,
      corePlugins: [first],
      fs: memoryFs(),
    });
    await bootPlugins(bareOptions);
    await expect(bare.closers[0]!.fn()).resolves.toBeUndefined();
  });
});

describe('plugin/opens 幂等落（recordPluginOpensDiff——05 §1.1 boot 装载序 diff，U3 批 U3-5）', () => {
  // 真库真面（audit_events 表由 AUDIT_MIGRATION 建就——读写往返零 mock）
  const stores: Store[] = [];
  afterAll(() => {
    for (const s of stores) s.close();
  });
  function openFace(): AuditFace {
    const dir = mkdtempSync(join(tmpdir(), 'berry-agent-opens-diff-'));
    dirs.push(dir);
    const store = openStore({ dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
    stores.push(store);
    return createAuditFace(store.connection);
  }
  /** 某插件最新授予面（listRecent id 降序——首见即尾条） */
  const opensOf = (face: AuditFace, pluginId: string): readonly unknown[] => {
    const hit = face.listRecent().find((r) => r.data['pluginId'] === pluginId);
    return hit ? (hit.data['opens'] as readonly unknown[]) : [];
  };
  const rowsOf = (rows: readonly { id: string; opens?: readonly string[] }[]) =>
    rows.map((r) => ({ id: r.id, opens: r.opens ?? [] }));

  it('首落：有 opens 行落实际面；空面不首记（无记录 ≡ 空面——[] 笔恒为撤位收口形）', () => {
    const face = openFace();
    recordPluginOpensDiff(face, rowsOf([{ id: 'acme', opens: ['channels.ui-backend'] }, { id: 'beta' }]));
    const recent = face.listRecent();
    expect(recent).toHaveLength(1); // beta 空面零事实——不为从未开门的插件造基线噪声
    expect(opensOf(face, 'acme')).toEqual(['channels.ui-backend']);
    expect(recent.some((r) => r.data['pluginId'] === 'beta')).toBe(false);
  });

  it('幂等：同面再 diff 零新笔（有变才落——不重复记账）', () => {
    const face = openFace();
    const rows = rowsOf([{ id: 'acme', opens: ['channels.ui-backend', 'triggers.start-run'] }]);
    recordPluginOpensDiff(face, rows);
    recordPluginOpensDiff(face, rows); // 同面重放
    expect(face.listRecent()).toHaveLength(1);
  });

  it('有变才落（增量）：单行变更只落该行；行序漂移 + 排序漂移零假记账', () => {
    const face = openFace();
    recordPluginOpensDiff(
      face,
      rowsOf([
        { id: 'acme', opens: ['channels.ui-backend'] },
        { id: 'beta', opens: [] },
      ]),
    );
    // 首轮只记 acme（beta 空面不首记）
    expect(face.listRecent()).toHaveLength(1);
    // 增量：acme 关门（→ [] 撤位形）、beta 开门（无记录 ≡ 空面 → 有变）；
    // 行序对调——集合语义不受行序影响
    recordPluginOpensDiff(
      face,
      rowsOf([
        { id: 'beta', opens: ['triggers.start-run'] },
        { id: 'acme', opens: [] },
      ]),
    );
    expect(face.listRecent()).toHaveLength(3); // 1 首记 + 2 变更笔
    expect(opensOf(face, 'acme')).toEqual([]);
    expect(opensOf(face, 'beta')).toEqual(['triggers.start-run']);
    // 再同面重放（排序后的稳态形）——零新笔
    recordPluginOpensDiff(
      face,
      rowsOf([
        { id: 'acme', opens: [] },
        { id: 'beta', opens: ['triggers.start-run'] },
      ]),
    );
    expect(face.listRecent()).toHaveLength(3);
  });

  it('撤位收口：曾记账行从计划面消失 → 空数组形；已空再 diff 幂等不重放', () => {
    const face = openFace();
    recordPluginOpensDiff(face, rowsOf([{ id: 'acme', opens: ['channels.ui-backend'] }]));
    recordPluginOpensDiff(face, []); // 计划面空（行删除/换装新 id）
    expect(opensOf(face, 'acme')).toEqual([]);
    expect(face.listRecent()).toHaveLength(2);
    recordPluginOpensDiff(face, []); // 已空——撤位笔不重放
    expect(face.listRecent()).toHaveLength(2);
  });
});

describe('doors/updated 幂等落（recordDoorsDiff——05 §1.1 行 72 进程级开门位 diff，开门制扩展批；幂等同 plugin/opens 律）', () => {
  // 真库真面（audit_events 表由 AUDIT_MIGRATION 建就——读写往返零 mock）
  const stores: Store[] = [];
  afterAll(() => {
    for (const s of stores) s.close();
  });
  function openFace(): AuditFace {
    const dir = mkdtempSync(join(tmpdir(), 'berry-agent-doors-diff-'));
    dirs.push(dir);
    const store = openStore({ dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
    stores.push(store);
    return createAuditFace(store.connection);
  }
  /** 全部已落词形（type + data 投影——词形断言面） */
  const callsOf = (face: AuditFace): Array<{ type: string; data: Record<string, unknown> }> =>
    [...face.listRecent()].reverse().map((r) => ({ type: r.type, data: r.data }));

  it('首落：有段落全量快照 {doors, origin: boot-diff}；空面首记不落（无记录 ≡ 空面）', () => {
    const face = openFace();
    recordDoorsDiff(face, ['sessions.observe-cross']);
    expect(callsOf(face)).toEqual([
      { type: 'doors/updated', data: { doors: ['sessions.observe-cross'], origin: 'boot-diff' } },
    ]);
    // 空面首启零基线噪声（首启默认关）
    const bare = openFace();
    recordDoorsDiff(bare, []);
    expect(callsOf(bare)).toEqual([]);
  });

  it('幂等：同面再 diff 零新笔（有变才落）；排序漂移零假记账', () => {
    const face = openFace();
    recordDoorsDiff(face, ['sessions.observe-cross', 'sessions.control-cross']);
    recordDoorsDiff(face, ['sessions.control-cross', 'sessions.observe-cross']); // 排序漂移
    expect(face.listRecent()).toHaveLength(1);
  });

  it('有变才落（增量）：开门落新快照；撤位 → doors:[] 收口形；再空幂等不重放', () => {
    const face = openFace();
    recordDoorsDiff(face, ['sessions.observe-cross']);
    // 开第二门：落新全量快照
    recordDoorsDiff(face, ['sessions.observe-cross', 'sessions.control-cross']);
    // 撤位收口：全撤 → 空数组形（撤位即收回的事实账）
    recordDoorsDiff(face, []);
    expect(callsOf(face)).toEqual([
      { type: 'doors/updated', data: { doors: ['sessions.observe-cross'], origin: 'boot-diff' } },
      {
        type: 'doors/updated',
        // 排序后的稳态形（去重排序比对同 plugin/opens——集合语义不受手编序影响）
        data: { doors: ['sessions.control-cross', 'sessions.observe-cross'], origin: 'boot-diff' },
      },
      { type: 'doors/updated', data: { doors: [], origin: 'boot-diff' } },
    ]);
    // 已空再 diff——撤位笔不重放
    recordDoorsDiff(face, []);
    expect(face.listRecent()).toHaveLength(3);
  });
});

describe('生命周期五词 boot diff 补播（recordPluginLifecycleDiff——05 §1.1 生命周期归因面行，audit 落账批写点②）', () => {
  // 真库真面（audit_events 表由 AUDIT_MIGRATION 建就——读写往返零 mock）
  const stores: Store[] = [];
  afterAll(() => {
    for (const s of stores) s.close();
  });
  function openFace(): AuditFace {
    const dir = mkdtempSync(join(tmpdir(), 'berry-agent-lifecycle-diff-'));
    dirs.push(dir);
    const store = openStore({ dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
    stores.push(store);
    return createAuditFace(store.connection);
  }
  /** 计划面行速记（disabled 缺省 false——plan 行 disabled === true 的读法同形） */
  const rowsOf = (rows: readonly { id: string; disabled?: boolean }[]) =>
    rows.map((r) => ({ id: r.id, disabled: r.disabled === true }));
  /** 全部已落词形（type + data 投影——词形断言面） */
  const callsOf = (face: AuditFace): Array<{ type: string; data: Record<string, unknown> }> =>
    [...face.listRecent()].reverse().map((r) => ({ type: r.type, data: r.data }));

  it('首启零基线噪声：core: 行 enabled 零落（内置基线态）；非 core absent→enabled 落 mounted', () => {
    const face = openFace();
    recordPluginLifecycleDiff(face, rowsOf([{ id: 'core:webui' }, { id: 'acme' }]));
    expect(callsOf(face)).toEqual([{ type: 'plugin/mounted', data: { id: 'acme' } }]);
  });

  it('absent→disabled 手编一步到位 = mounted + toggled{true}（命令两步的序列等价）', () => {
    const face = openFace();
    recordPluginLifecycleDiff(face, rowsOf([{ id: 'acme', disabled: true }]));
    expect(callsOf(face)).toEqual([
      { type: 'plugin/mounted', data: { id: 'acme' } },
      { type: 'plugin/toggled', data: { id: 'acme', disabled: true } },
    ]);
  });

  it('enabled↔disabled 双向 + 幂等：同态重放零新笔', () => {
    const face = openFace();
    recordPluginLifecycleDiff(face, rowsOf([{ id: 'acme' }])); // mounted
    recordPluginLifecycleDiff(face, rowsOf([{ id: 'acme', disabled: true }])); // toggled true
    expect(callsOf(face)).toEqual([
      { type: 'plugin/mounted', data: { id: 'acme' } },
      { type: 'plugin/toggled', data: { id: 'acme', disabled: true } },
    ]);
    recordPluginLifecycleDiff(face, rowsOf([{ id: 'acme', disabled: true }])); // 重放——零新笔
    expect(face.listRecent()).toHaveLength(2);
    recordPluginLifecycleDiff(face, rowsOf([{ id: 'acme' }])); // toggled false（翻回启用）
    const calls = callsOf(face);
    expect(calls[2]).toEqual({ type: 'plugin/toggled', data: { id: 'acme', disabled: false } });
    recordPluginLifecycleDiff(face, rowsOf([{ id: 'acme' }])); // 重放——零新笔
    expect(face.listRecent()).toHaveLength(3);
  });

  it('core: 手编漂移落账：基线 enabled → 手编 disabled 落 toggled{true}（core: 在本账内——与 opens diff 排除 core: 分立）', () => {
    const face = openFace();
    recordPluginLifecycleDiff(face, rowsOf([{ id: 'core:webui', disabled: true }]));
    expect(callsOf(face)).toEqual([{ type: 'plugin/toggled', data: { id: 'core:webui', disabled: true } }]);
  });

  it('在场→absent 落 unmounted（用户插件行删）；core: 计划面缺席不落（宿主侧裁撤非用户动作，防噪声）', () => {
    const face = openFace();
    recordPluginLifecycleDiff(face, rowsOf([{ id: 'acme' }])); // mounted
    recordPluginLifecycleDiff(face, []); // 行删（unmount 的手编等价）
    const calls = callsOf(face);
    expect(calls[1]).toEqual({ type: 'plugin/unmounted', data: { id: 'acme' } });
    recordPluginLifecycleDiff(face, []); // 重放——零新笔
    expect(face.listRecent()).toHaveLength(2);
    // core: 曾落 toggled 后从计划面消失（官件裁撤病理态）——不落 unmounted
    const face2 = openFace();
    recordPluginLifecycleDiff(face2, rowsOf([{ id: 'core:webui', disabled: true }]));
    recordPluginLifecycleDiff(face2, []);
    expect(face2.listRecent()).toHaveLength(1); // 只有 toggled 一笔
  });

  it('尾态 fold 三词首见即最新：旧 toggled 被新 mounted 盖过、坏形条目跳过', () => {
    const face = openFace();
    recordPluginLifecycleDiff(face, rowsOf([{ id: 'acme', disabled: true }])); // mounted + toggled{true}
    expect(face.listRecent()).toHaveLength(2);
    // 人面动词写点①再落一笔 mounted（CLI mount 命令）——尾态翻 enabled
    face.append('plugin/mounted', { id: 'acme' });
    // boot diff 以 enabled 行对账——尾态（首见 mounted 盖旧 toggled）与计划面
    // 一致：零新笔（长度只多出 append 那笔）
    recordPluginLifecycleDiff(face, rowsOf([{ id: 'acme' }]));
    expect(face.listRecent()).toHaveLength(3);
    // 坏形条目（id 非字符串——库被手编）跳过不建态不抛；尾态回退到更旧的有效条目
    face.append('plugin/toggled', { noId: true });
    expect(() => recordPluginLifecycleDiff(face, rowsOf([{ id: 'acme' }]))).not.toThrow();
    expect(face.listRecent()).toHaveLength(4); // 坏形笔本身在库，diff 零新笔
  });
});

/* ---------------- U3-6 收官 e2e：registerUiBackend 全链（U3-0 底稿 #7） ---------------- */

describe('registerUiBackend 全链 e2e（U3 批 U3-6——opens→门检→注册→审计词三链绿 + 门关红 + 分域红）', () => {
  // 真库真面（audit_events 表由 AUDIT_MIGRATION 建就）+ 真 channels 服务 +
  // 真盘真 jiti 磁盘插件（三链跨 loader/plugin-context/channels/persist 四件）
  const stores: Store[] = [];
  afterAll(() => {
    for (const s of stores) s.close();
  });
  function openFace(): AuditFace {
    const dir = mkdtempSync(join(tmpdir(), 'berry-agent-u3-e2e-'));
    dirs.push(dir);
    const store = openStore({ dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
    stores.push(store);
    return createAuditFace(store.connection);
  }
  /** 某插件最新授予面（listRecent id 降序——首见即尾条） */
  const opensOf = (face: AuditFace, pluginId: string): readonly unknown[] => {
    const hit = face.listRecent().find((r) => r.data['pluginId'] === pluginId && r.type === 'plugin/opens');
    return hit ? (hit.data['opens'] as readonly unknown[]) : [];
  };

  /** 磁盘插件铺设（真盘真 jiti——entry 体由用例注入） */
  const layDiskPlugin = (dataDir: string, id: string, opensLine: string, entryBody: readonly string[]): void => {
    const pluginDir = join(dataDir, 'plugins', 'node_modules', id);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: id, version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    );
    writeFileSync(
      join(pluginDir, 'entry.js'),
      ['export const inject = [];', 'export default async (ctx) => {', ...entryBody, '};'].join('\n'),
    );
    writeFileSync(join(dataDir, 'enabled.yaml'), enabledYaml(`  - id: ${id}\n${opensLine}`));
    writeFileSync(
      join(dataDir, 'plugins', 'ledger.json'),
      JSON.stringify({ [id]: { installPath: `plugins/node_modules/${id}` } }),
    );
  };

  /** 插件后端 entry 体（JS 字面——UiBackend 最小形：id/capabilities/hasAudience/notify） */
  const backendBody = (id: string): readonly string[] => [
    '  ctx.channels.registerUiBackend({',
    `    id: '${id}',`,
    '    capabilities: { notify: true, confirm: false, select: false, input: false, approval: false, setStatus: false, setWidget: false },',
    '    hasAudience: () => true,',
    '    notify: () => {},',
    '  });',
  ];

  /** 宿主域后端（分域红前置——真 channels addBackend 同 assembly 形） */
  const hostBackendOf = (id: string): UiBackend<never> => ({
    id,
    capabilities: {
      notify: true,
      confirm: false,
      select: false,
      input: false,
      approval: false,
      setStatus: false,
      setWidget: false,
    },
    hasAudience: () => true,
    notify: () => undefined,
  });

  it('三链绿：opens 授予 → 门检过 → 插件域注册 → capability/used 落审计流（+ plugin/opens 装载序落账）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-agent-u3-ok-'));
    dirs.push(dataDir);
    layDiskPlugin(dataDir, 'acme-ui', '    opens: [channels.ui-backend]\n', backendBody('acme-panel'));
    const channels = createChannels();
    const face = openFace();
    const { options } = rigBoot(dataDir, { uiBackends: channels, audit: face });
    const boot = await bootPlugins(options);
    // 链一：opens 行解析 + 装载零失败
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['acme-ui']);
    // 链二：插件域注册面（分域后端集合——宿主域零染指）
    expect(channels.listPluginBackendIds()).toEqual(['acme-panel']);
    // 链三：capability/used 审计词（受理成功才记——拒笔不记使用）
    const used = face.listRecent().find((r) => r.type === 'capability/used');
    expect(used?.data).toMatchObject({ pluginId: 'acme-ui', capability: 'channels.ui-backend' });
    // 附证：plugin/opens 装载序幂等落（U3-5 diff 在真 boot 织入——行即真源）
    expect(opensOf(face, 'acme-ui')).toEqual(['channels.ui-backend']);
  });

  it('门关红：opens 缺位 → DOOR_CLOSED 拒 → 行级隔离 + 零 capability/used（没发生的使用不是使用）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-agent-u3-door-'));
    dirs.push(dataDir);
    layDiskPlugin(dataDir, 'acme-closed', '', backendBody('acme-panel')); // 无 opens 行——默认关
    const channels = createChannels();
    const face = openFace();
    const { options } = rigBoot(dataDir, { uiBackends: channels, audit: face });
    const boot = await bootPlugins(options);
    // 行级隔离：动词拒 → PLUGIN_APPLY_FAILED 包裹（内层 DOOR_CLOSED 指路 opens）
    expect(boot.report.activated).toEqual([]);
    expect(boot.report.failed).toHaveLength(1);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_APPLY_FAILED');
    expect(boot.report.failed[0]!.message).toContain('opens');
    // 零注册 + 零使用账（拒笔不记）
    expect(channels.listPluginBackendIds()).toEqual([]);
    expect(face.listRecent().some((r) => r.type === 'capability/used')).toBe(false);
  });

  it('分域红：宿主域 id 顶替拒（{id:"tui"} → CHANNEL_BACKEND_RESERVED——07 §4 宿主后端恒在场）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-agent-u3-dom-'));
    dirs.push(dataDir);
    // 门开但撞宿主域 id——执法序门检过后即撞分域律（开门不隐含顶替权）
    layDiskPlugin(dataDir, 'acme-hijack', '    opens: [channels.ui-backend]\n', backendBody('tui'));
    const channels = createChannels();
    channels.addBackend(hostBackendOf('tui')); // 宿主域后端在场（assembly TUI 同位）
    const face = openFace();
    const { options } = rigBoot(dataDir, { uiBackends: channels, audit: face });
    const boot = await bootPlugins(options);
    expect(boot.report.failed).toHaveLength(1);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_APPLY_FAILED');
    expect(boot.report.failed[0]!.message).toContain('宿主域'); // 分域律指路（换 id 注册）
    // 插件域零注册；宿主域后端原位（顶替拒的对称面）
    expect(channels.listPluginBackendIds()).toEqual([]);
    expect(face.listRecent().some((r) => r.type === 'capability/used')).toBe(false); // 受理败不记使用
    // 授予面照落（plugin/opens 真源是行本身——装载成败不抹授予事实）
    expect(opensOf(face, 'acme-hijack')).toEqual(['channels.ui-backend']);
  });
});

describe('sessions-control 面装配（e4-3——03 §2.2 第十一面 fork 级绑定）', () => {
  /** 受理器替身（caller 录——归因断言位；assembly 真源 = conversation-stack 栈级单例） */
  function recordingControl() {
    const callers: unknown[] = [];
    return {
      callers,
      send: async (input: { caller: unknown }) => {
        callers.push(input.caller);
        return { status: 'delivered', messageId: 'msg-1' } as const;
      },
      interrupt: async (input: { caller: unknown }) => {
        callers.push(input.caller);
        return { status: 'interrupted', targetSessionId: 's-x' } as const;
      },
      withdraw: async (input: { caller: unknown }) => {
        callers.push(input.caller);
        return { status: 'delivered', messageId: 'msg-1' } as const;
      },
    };
  }

  it('在场绑定：探针 fork 见绑定版，caller 闭包 {kind:"plugin"} 归因单源', async () => {
    const control = recordingControl();
    const seen: unknown[] = [];
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        const face = (ctx as { get: (n: string) => unknown }).get('sessions-control') as {
          send(input: { targetSessionId: string; text: string }): Promise<unknown>;
        };
        seen.push(face);
        await face.send({ targetSessionId: 's-x', text: 'hi' }); // 插件道调用无 caller 位
      },
    };
    const { options, scope } = rigBoot('/data', {
      corePlugins: [probe],
      fs: memoryFs(),
      sessionsControl: control as never,
    });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:probe']);
    expect(seen).toHaveLength(1); // 消费面真达（fork 绑定版非标记位）
    // caller 闭包铸造：插件道归因 plugin:<装载 id>——传入面无 caller 位
    expect(control.callers).toEqual([{ kind: 'plugin', pluginId: 'core:probe' }]);
    expect(scope.tryGet('sessions-control')).toBeUndefined(); // 共享根无此名（fork 独见）
  });

  it('Kahn 可满足标记：inject: ["sessions-control"] 声明合法可解', async () => {
    const control = recordingControl();
    const seen: unknown[] = [];
    const consumer: CorePluginReference = {
      name: 'consumer',
      inject: ['sessions-control'], // 声明硬依赖——标记位应答使其可装载
      apply: async (ctx) => {
        seen.push((ctx as { tryGet: (n: string) => unknown }).tryGet('sessions-control'));
      },
    };
    const { options } = rigBoot('/data', {
      corePlugins: [consumer],
      fs: memoryFs(),
      sessionsControl: control as never,
    });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:consumer']);
    expect(typeof (seen[0] as { send: unknown }).send).toBe('function'); // 消费面真达
  });

  it('缺席 = ctx.get 响亮 CONTEXT_SERVICE_MISSING（诚实缺席律）', async () => {
    const errs: unknown[] = [];
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        try {
          (ctx as { get: (n: string) => unknown }).get('sessions-control');
        } catch (err) {
          errs.push(err);
        }
      },
    };
    const { options } = rigBoot('/data', { corePlugins: [probe], fs: memoryFs() });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:probe']);
    expect(errs).toHaveLength(1);
    expect((errs[0] as { code: string }).code).toBe('CONTEXT_SERVICE_MISSING');
  });
});

describe('卸载换代槽（/reload 批——03 §5.7 换代执法位）', () => {
  it('unloadRef 在场：closer 不直注册（closers 空）+ 槽写入 + 调槽跑完整卸载序', async () => {
    const disposed: string[] = [];
    const ref: CorePluginReference = { name: 'demo', apply: async () => () => void disposed.push('demo') };
    const runtime = stubRuntime('/data');
    const unloadRef: { current: (() => Promise<PluginUnloadReceipt>) | null } = { current: null };
    const { options } = rigBoot('/data', { runtime, corePlugins: [ref], fs: memoryFs(), unloadRef });
    const boot = await bootPlugins(options);
    expect(runtime.closers).toEqual([]); // 直注册形态让位——槽承载
    expect(unloadRef.current).not.toBeNull();
    const receipt = await unloadRef.current!();
    expect(disposed).toEqual(['demo']); // 完整卸载序（disposer 回卷）
    expect(receipt.disposed).toEqual(['core:demo']); // 回执形（/reload 档③数据源）
    expect(receipt.failed).toEqual([]);
    expect(boot.counts.enabled).toBe(1);
  });

  it('boot 两代（热重载模拟）：第二袋改写槽——调槽只跑最新代回卷（旧代不重跑）', async () => {
    const disposed: string[] = [];
    const mk = (name: string): CorePluginReference => ({
      name,
      apply: async () => () => void disposed.push(name),
    });
    const runtime = stubRuntime('/data');
    const unloadRef: { current: (() => Promise<PluginUnloadReceipt>) | null } = { current: null };
    // 第一代：two 插件
    await bootPlugins(
      rigBoot('/data', { runtime, corePlugins: [mk('g1-a'), mk('g1-b')], fs: memoryFs(), unloadRef }).options,
    );
    // 第二代（盘面已漂移形）：单插件——bootPlugins 重跑即换代写槽
    await bootPlugins(rigBoot('/data', { runtime, corePlugins: [mk('g2-a')], fs: memoryFs(), unloadRef }).options);
    await unloadRef.current!();
    // 只回卷第二代（g1 代 disposer 不重复跑——第一代在换代时已由调用方 rollback 收口）
    expect(disposed).toEqual(['g2-a']);
  });

  it('unloadRef 缺席 = 维持直注册现状（单次 boot 形——CLI/测试/诊断）', async () => {
    const ref: CorePluginReference = { name: 'demo', apply: async () => undefined };
    const runtime = stubRuntime('/data');
    const { options } = rigBoot('/data', { runtime, corePlugins: [ref], fs: memoryFs() });
    await bootPlugins(options);
    expect(runtime.closers.map((c) => c.label)).toEqual(['plugin-unload']); // 直注册在场
  });
});

describe('compaction 面装配（U4-3——03 §2.2 ctx 面册 compaction 席 fork 级绑定）', () => {
  it('在场绑定：探针 fork 见席位面，setConfig 真达容器（共享根无此名——fork 独见）', async () => {
    const slots = createCompactionSlots();
    const seen: unknown[] = [];
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        const face = (ctx as { get: (n: string) => unknown }).get('compaction') as {
          setConfig(input: { tailKeep: number }): () => void;
        };
        seen.push(face);
        face.setConfig({ tailKeep: 4 });
      },
    };
    const { options, scope } = rigBoot('/data', { corePlugins: [probe], fs: memoryFs(), compaction: slots });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:probe']);
    expect(seen).toHaveLength(1); // 消费面真达（fork 绑定版非标记位）
    expect(slots.getConfig().tailKeep).toBe(4); // 席位容器真见（零漂移）
    expect(scope.tryGet('compaction')).toBeUndefined(); // 共享根无此名（fork 独见）
  });

  it('卸载回收：runtime closer plugin-unload 回卷 fork effect 摘席回落基线（双保险兜底——动词 disposer 之外）', async () => {
    const slots = createCompactionSlots();
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        const face = (ctx as { get: (n: string) => unknown }).get('compaction') as {
          setConfig(input: { tailKeep: number }): () => void;
        };
        face.setConfig({ tailKeep: 4 });
      },
    };
    const { options } = rigBoot('/data', { corePlugins: [probe], fs: memoryFs(), compaction: slots });
    await bootPlugins(options);
    expect(slots.getConfig().tailKeep).toBe(4);
    // fork.effect 回卷真源位 = runtime closer 'plugin-unload'（report.unload 只回
    // 卷 apply disposer——动词手动面；fork 逆序 dispose 挂 closer，rt.shutdown 同道）
    const closers = (options.runtime as unknown as { closers: Array<{ label: string; fn: () => Promise<void> }> })
      .closers;
    const unload = closers.find((c) => c.label === 'plugin-unload');
    await unload!.fn();
    expect(slots.getConfig().tailKeep).toBe(DEFAULT_COMPACTION_CONFIG.tailKeep); // 摘席回落基线
  });

  it('缺席 = ctx.get 响亮 CONTEXT_SERVICE_MISSING（诚实缺席律）', async () => {
    const errs: unknown[] = [];
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        try {
          (ctx as { get: (n: string) => unknown }).get('compaction');
        } catch (err) {
          errs.push(err);
        }
      },
    };
    const { options } = rigBoot('/data', { corePlugins: [probe], fs: memoryFs() });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:probe']);
    expect(errs).toHaveLength(1);
    expect((errs[0] as { code: string }).code).toBe('CONTEXT_SERVICE_MISSING');
  });

  // 磁盘轨全链（四轮真模型批补锁——U4-3 当时只锁 core 轨；磁盘轨 inject 声明
  // → Kahn 可满足标记位 → fork 绑定 → ctx.get 消费 → 席位容器见值，五段缺一
  // 即红）。真模型四轮实测踩坑：试件属性直访 ctx.compaction ≠ ctx.get('compaction')
  // 消费形（03 §2.2 第十二面正规动词）——apply 内 TypeError 属行级隔离降级、
  // 唯一痕迹是 boot-failures 计数，此锁同时钉住「消费形正确时全链真达」。
  it('磁盘轨全链：inject 声明 + ctx.get("compaction") 消费 + setConfig 真达容器（合并语义）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'host-plugin-boot-cpt-'));
    dirs.push(dataDir);
    const pluginDir = join(dataDir, 'plugins', 'node_modules', 'acme-cpt');
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'acme-cpt', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    );
    writeFileSync(
      join(pluginDir, 'entry.js'),
      [
        "export const inject = ['compaction'];",
        'export default async (ctx) => {',
        '  ctx.get("compaction").setConfig({ thresholdRatio: 0.0005 });',
        '};',
      ].join('\n'),
    );
    writeFileSync(join(dataDir, 'enabled.yaml'), enabledYaml('  - id: acme-cpt\n'));
    writeFileSync(
      join(dataDir, 'plugins', 'ledger.json'),
      JSON.stringify({ 'acme-cpt': { installPath: 'plugins/node_modules/acme-cpt' } }),
    );
    const slots = createCompactionSlots();
    const { options } = rigBoot(dataDir, { compaction: slots });
    const boot = await bootPlugins(options);
    expect(boot.report.failed).toEqual([]); // 装载零失败（apply 内消费形正确）
    expect(boot.report.activated.map((a) => a.id)).toEqual(['acme-cpt']); // 磁盘行 id 原样
    // 单键注入合并语义：注入键生效、其余键缺省保底（partial 合并非整替）
    expect(slots.getConfig()).toMatchObject({ thresholdRatio: 0.0005, tailKeep: 6, cooldownMs: 600_000 });
  });
});

describe('sdk-routes 面装配（U5-2——03 §2.2 ctx 面册 sdk-routes 席 fork 级绑定 + core:sdk 件席双条件）', () => {
  /** 最小合法受理 descriptor（受理面纯函数已单测——此处只证装配线真达） */
  const route = (): PluginRouteDescriptor => ({ method: 'GET', path: '/ping', auth: 'token', handler: () => {} });
  /** core:sdk 件席占位引用（席位双条件第二腿——件在场且未禁用） */
  const sdkRef: CorePluginReference = { name: 'sdk', apply: async () => undefined };

  it('在场绑定：探针 fork 见受理面，register 真达受理器（core: 豁免门检——opens 空集仍过）', async () => {
    const registry = createPluginRouteRegistry();
    const seen: unknown[] = [];
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        const face = (ctx as { get: (n: string) => unknown }).get('sdk-routes') as SdkRoutesPluginFace;
        seen.push(face);
        face.register(route());
      },
    };
    const { options, scope } = rigBoot('/data', {
      corePlugins: [probe, sdkRef],
      fs: memoryFs(),
      sdkRoutes: registry,
    });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id).sort()).toEqual(['core:probe', 'core:sdk']);
    expect(seen).toHaveLength(1); // 消费面真达（fork 绑定版非标记位）
    expect(registry.snapshot().map((d) => d.path)).toEqual(['/plugins/core%3Aprobe/ping']); // 豁免免的是门不是账
    expect(scope.tryGet('sdk-routes')).toBeUndefined(); // 共享根无此名（fork 独见）
  });

  it('卸载回收：runtime closer plugin-unload 回卷 fork effect → releaseFor 摘账（/reload 换代双保险兜底）', async () => {
    const registry = createPluginRouteRegistry();
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        const face = (ctx as { get: (n: string) => unknown }).get('sdk-routes') as SdkRoutesPluginFace;
        face.register(route());
      },
    };
    const { options } = rigBoot('/data', { corePlugins: [probe, sdkRef], fs: memoryFs(), sdkRoutes: registry });
    await bootPlugins(options);
    expect(registry.snapshot()).toHaveLength(1);
    // fork.effect 回卷真源位 = runtime closer 'plugin-unload'（动词 disposer 之外的兜底腿）
    const closers = (options.runtime as unknown as { closers: Array<{ label: string; fn: () => Promise<void> }> })
      .closers;
    const unload = closers.find((c) => c.label === 'plugin-unload');
    await unload!.fn();
    expect(registry.snapshot()).toHaveLength(0); // releaseFor 摘账——旧路由不残留
  });

  it('core:sdk 件禁用 = 席位双条件不满足 → ctx.get 响亮 CONTEXT_SERVICE_MISSING（受理面缺席律）', async () => {
    const errs: unknown[] = [];
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        try {
          (ctx as { get: (n: string) => unknown }).get('sdk-routes');
        } catch (err) {
          errs.push(err);
        }
      },
    };
    // 件在场但启用行禁用（席位第二腿假——即使受理器已注入）
    const fs = memoryFs({ '/data/enabled.yaml': enabledYaml('  - id: core:sdk\n    disabled: true\n') });
    const registry = createPluginRouteRegistry();
    const { options } = rigBoot('/data', { corePlugins: [probe, sdkRef], fs, sdkRoutes: registry });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:probe']); // core:sdk skipped
    expect(errs).toHaveLength(1);
    expect((errs[0] as { code: string }).code).toBe('CONTEXT_SERVICE_MISSING');
  });

  it('受理器缺席（装配根未接线）同响 CONTEXT_SERVICE_MISSING——诚实缺席律同形', async () => {
    const errs: unknown[] = [];
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (ctx) => {
        try {
          (ctx as { get: (n: string) => unknown }).get('sdk-routes');
        } catch (err) {
          errs.push(err);
        }
      },
    };
    // 受理器未注入（sdkRoutes 缺席）——core:sdk 件在场也不影响缺席形
    const { options } = rigBoot('/data', { corePlugins: [probe, sdkRef], fs: memoryFs() });
    await bootPlugins(options);
    expect(errs).toHaveLength(1);
    expect((errs[0] as { code: string }).code).toBe('CONTEXT_SERVICE_MISSING');
  });
});

describe('装载史世代落账（05 §9——装载史批 h-3 写点：boot 完成尾落行 + noPlugins 空行 + 工具名账）', () => {
  // 真库真面（load_generations 表由 LOAD_GENERATIONS_MIGRATION 建就——audit 真库形同构）
  const stores: Store[] = [];
  afterAll(() => {
    for (const s of stores) s.close();
  });
  /** 开真库 + 构造装载史面（假钟可注——同刻律断言用） */
  function openHistoryFace(clock?: () => number): { store: Store; face: LoadHistoryFace } {
    const dir = mkdtempSync(join(tmpdir(), 'berry-agent-load-gen-'));
    dirs.push(dir);
    const store = openStore({ dataDir: join(dir, 'data'), migrations: [LOAD_GENERATIONS_MIGRATION] });
    stores.push(store);
    return { store, face: createLoadHistoryFace(store.connection, clock) };
  }
  /** 世代行直读（id 升序全列） */
  const rowsOf = (store: Store) =>
    store.connection
      .prepare('SELECT id, started_at, ended_at, activated, skipped, failed FROM load_generations ORDER BY id')
      .all() as Array<{
      id: number;
      started_at: number;
      ended_at: number | null;
      activated: string;
      skipped: string;
      failed: string;
    }>;

  it('boot 完成点落行：三分区全录（activated 携 tools 名账 / skipped reason / failed code 直传）', async () => {
    const demo: CorePluginReference = {
      name: 'demo',
      apply: async (ctx) => {
        const tools = (ctx as { tools: { register(def: ToolDefinition): () => void } }).tools;
        tools.register({
          name: 'demo_tool_a',
          description: '常驻',
          parameters: { type: 'object' },
          execute: async () => ({ content: [] }),
        });
        // 代内撤注——disposer 出账不留残影（世代行 tools = 收口时点在册集）
        tools.register({
          name: 'demo_tool_b',
          description: '撤注',
          parameters: { type: 'object' },
          execute: async () => ({ content: [] }),
        })();
      },
    };
    const sleeper: CorePluginReference = { name: 'sleeper', apply: async () => undefined };
    // sleeper 经 overlay 禁用 → skipped；core:ghost 未注册 → 合成失败行 → failed
    const fs = memoryFs({
      '/data/enabled.yaml': enabledYaml('  - id: core:sleeper\n    disabled: true\n  - id: core:ghost\n'),
    });
    const { store, face } = openHistoryFace(() => 1_000);
    const { options } = rigBoot('/data', { corePlugins: [demo, sleeper], loadHistory: face, fs });
    const boot = await bootPlugins(options);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['core:demo']); // 前置：三分区形态成立
    const rows = rowsOf(store);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0]!.activated)).toEqual([{ id: 'core:demo', tools: ['demo_tool_a'] }]);
    expect(JSON.parse(rows[0]!.skipped)).toEqual([{ id: 'core:sleeper', reason: 'disabled（启用行禁用位）' }]);
    expect(JSON.parse(rows[0]!.failed)).toEqual([{ id: 'core:ghost', code: 'PLUGIN_LOAD_FAILED' }]);
    expect(rows[0]!.started_at).toBe(1_000); // 完成点挂钟（假钟注入）
    expect(rows[0]!.ended_at).toBeNull(); // 当代开放窗
    // handle 只读面与世代行 tools 同源（h-4——/reload diff 取值源）
    expect(boot.toolsOf('core:demo')).toEqual(['demo_tool_a']);
    expect(boot.toolsOf('core:sleeper')).toEqual([]); // skipped 无名账
  });

  it('两 boot 周期 = 两世代：前代 ended_at 回填同刻（/reload reapply 重跑同点换代的直证）', async () => {
    let now = 1_000;
    const ref: CorePluginReference = { name: 'demo', apply: async () => undefined };
    const { store, face } = openHistoryFace(() => now);
    await bootPlugins(rigBoot('/data', { corePlugins: [ref], loadHistory: face, fs: memoryFs() }).options);
    now = 2_000;
    await bootPlugins(rigBoot('/data', { corePlugins: [ref], loadHistory: face, fs: memoryFs() }).options);
    const rows = rowsOf(store);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.ended_at).toBe(rows[1]!.started_at); // 同刻律：回填值 = 新行 started_at
    expect(rows[0]!.ended_at).toBe(2_000);
    expect(rows[1]!.ended_at).toBeNull(); // 新代开放窗
  });

  it('--no-plugins 短路照落空三分区行（世代存在且为空——05 §9 边沿定形）', async () => {
    const { store, face } = openHistoryFace(() => 1_000);
    await bootPlugins(rigBoot('/data', { noPlugins: true, loadHistory: face, fs: memoryFs() }).options);
    const rows = rowsOf(store);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.activated).toBe('[]');
    expect(rows[0]!.skipped).toBe('[]');
    expect(rows[0]!.failed).toBe('[]');
  });

  it('face 缺席 = 零落行不阻拦（诚实缺席律——真库在场不被动用）', async () => {
    const ref: CorePluginReference = { name: 'demo', apply: async () => undefined };
    const { store } = openHistoryFace();
    const boot = await bootPlugins(rigBoot('/data', { corePlugins: [ref], fs: memoryFs() }).options);
    expect(boot.report.activated).toHaveLength(1);
    expect(rowsOf(store)).toHaveLength(0);
  });

  it('createPluginToolLedger：同名重复入账幂等（Set 背书）+ 未知名出账 no-op + 缺席插件空集', () => {
    const ledger = createPluginToolLedger();
    ledger.add('p', 't1');
    ledger.add('p', 't1'); // 重复入账幂等
    ledger.remove('p', 'never'); // 未知名出账 no-op
    expect(ledger.toolsOf('p')).toEqual(['t1']);
    ledger.remove('p', 't1');
    expect(ledger.toolsOf('p')).toEqual([]);
    expect(ledger.toolsOf('absent')).toEqual([]);
  });
});

describe('程序化子代理物化消费腿（遗漏审计批 G——03 §2.2 行 109「注册即派生」全环）', () => {
  /** 真 service 速记（通知面零动作桩——物化链不触 run） */
  function makeService(): ReturnType<typeof createSubagentService> {
    return createSubagentService({
      registry: createJobRegistry({ warn: () => undefined }),
      notify: {
        notifySettled: () => Promise.resolve(),
        notifyApprovalPending: () => Promise.resolve(),
      },
      warn: () => undefined,
    });
  }

  it('插件 apply 内注册 provider → boot 全局层工具面见 agent_<name>（owner 恒 core:subagent）+ service 位同落', async () => {
    const service = makeService();
    const ref: CorePluginReference = {
      name: 'sub-user',
      apply: async (ctx) => {
        (ctx as { agent: { registerSubagentProvider(def: unknown): () => void } }).agent.registerSubagentProvider({
          name: 'daily',
          description: '日结员',
          systemPrompt: '你是日结员',
        });
      },
    };
    const { options } = rigBoot('/data', {
      corePlugins: [ref],
      fs: memoryFs(),
      subagents: service,
      subagentToolDeps: { service },
    });
    const boot = await bootPlugins(options);
    // 物化工具真进 boot 全局层（registry.definitions 消费腿重放位同源）
    const tool = boot.tools.definitions().find((t) => t.name === 'agent_daily');
    expect(tool).toMatchObject({ name: 'agent_daily', description: '日结员', owner: 'core:subagent' });
    // service 位同落（注册者归因 = 插件 id 分域键——两层各司其职）
    expect(service.programmaticProviders()).toEqual([
      { def: { name: 'daily', description: '日结员', systemPrompt: '你是日结员' }, owner: 'core:sub-user' },
    ]);
  });

  it('缺席分级：subagentToolDeps 缺席 = 动词只落 service 位（诊断形——工具面零新增）', async () => {
    const service = makeService();
    const ref: CorePluginReference = {
      name: 'sub-user',
      apply: async (ctx) => {
        (ctx as { agent: { registerSubagentProvider(def: unknown): () => void } }).agent.registerSubagentProvider({
          name: 'daily',
          description: '日结员',
          systemPrompt: '你是日结员',
        });
      },
    };
    const { options } = rigBoot('/data', { corePlugins: [ref], fs: memoryFs(), subagents: service });
    const boot = await bootPlugins(options);
    expect(boot.tools.definitions().some((t) => t.name === 'agent_daily')).toBe(false); // 无物化
    expect(service.programmaticProviders()).toHaveLength(1); // service 位照落
  });
});

describe('官方件宿主面开窗器死域 fail-closed（03 §10.1 异步续段开窗批连带定形）', () => {
  it('世代卸载后旧开窗器开窗即拒 PLUGIN_WINDOW_CLOSED（报文区分域死成因）——活期开窗照常', async () => {
    // 伪造 core 件：apply 捕获宿主面第三参铸的开窗器（模拟 core:mcp 式异步
    // 续段持旧开窗器形——开窗器是闭包常驻物，跨世代存活）
    let captured: (() => () => void) | undefined;
    const probe: CorePluginReference = {
      name: 'probe',
      apply: async (_ctx, _config, host) => {
        captured = host?.openHostCallback;
      },
    };
    const unloadRef: { current: (() => Promise<PluginUnloadReceipt>) | null } = { current: null };
    const { options } = rigBoot('/data', { corePlugins: [probe], fs: memoryFs(), unloadRef });
    await bootPlugins(options);
    expect(captured).toBeDefined();
    // 活期开窗照常（正向对照——C 组通道语义不回归；开即恢复不留深）
    captured!()();
    // 世代卸载（/reload rollback 腿与 shutdown 同一 unloadAll 真源）
    await unloadRef.current!();
    // 死域开窗即拒（域已死即窗恒闭——03 §10.1：与窗闸同码同语义，报文须
    // 区分域死成因非「装载窗口外」文案）
    try {
      captured!();
      expect.unreachable('死域开窗器照开 = owner 归已死代的幽灵注册行敞口（修前红）');
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('PLUGIN_WINDOW_CLOSED');
        expect(err.message).toContain('已卸载'); // 域死成因报文
        return;
      }
      throw err;
    }
  });
});
