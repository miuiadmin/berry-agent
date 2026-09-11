/**
 * host/loader 组合根测试——装载管线全景（Kahn 轮次 + 双轨装载 + 失败三档 +
 * jiti 门禁 + 虚拟面直注）。
 *
 * 真盘真 jiti（临时目录插件 fixture + 真实转译装载——组合根全栈惯例，不
 * mock）；manifest 经真校验器 parseManifest 产出（12a 面复用非手搓）。core:
 * 直调轨 / 磁盘轨 jiti 装载 / 字面量腿拒载 / node_modules 子树豁免 / 虚拟键
 * 同实例身份（防双实例）/ 时钟帽 / LIFO 回卷逐路覆盖。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';
import { providerApiFace } from '../llm/index.js';

import { CorePluginBootError, loadPlugins } from './loader.js';
import type { CorePluginSpec, DiskPluginSpec, LoadPluginsOptions, LoaderPlanRow, ServiceBag } from './loader.js';
import { parseManifest } from './manifest.js';
import type { PluginManifest } from './manifest.js';

/** 临时插件目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 建一个插件目录（package.json 可定制 + 逐文件写入） */
function makePluginDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'host-loader-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    const target = join(dir, rel);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, content);
  }
  return dir;
}

/** 真校验器产 manifest（fixture 面复用 12a——不手搓） */
function manifestOf(pkg: Record<string, unknown>): PluginManifest {
  const result = parseManifest(pkg);
  if (!result.ok) throw new Error(`fixture manifest 坏形：${result.message}`);
  return result.manifest;
}

/** 磁盘行速记（fixture pkg + 目录 → DiskPluginSpec） */
function diskRow(
  id: string,
  dir: string,
  pkg: Record<string, unknown>,
  extra: Partial<DiskPluginSpec> = {},
): DiskPluginSpec {
  return { kind: 'disk', id, pluginDir: dir, manifest: manifestOf(pkg), ...extra };
}

/** 服务袋速记（Map 背书） */
function makeServices(): ServiceBag & { map: Map<string, unknown> } {
  const map = new Map<string, unknown>();
  return { map, get: (name) => map.get(name), provide: (name, value) => void map.set(name, value) };
}

/** 装载选项速记（ctx = 服务袋投影——provide/get 直连） */
function rigOptions(plan: readonly LoaderPlanRow[], overrides: Partial<LoadPluginsOptions> = {}): LoadPluginsOptions {
  const services = makeServices();
  return {
    plan,
    services,
    createContext: () => ({ provide: services.provide, get: services.get }),
    ...overrides,
  };
}

/** core: 引用形速记 */
function coreRow(
  id: string,
  apply: CorePluginSpec['reference']['apply'],
  extra: Partial<CorePluginSpec['reference']> = {},
): CorePluginSpec {
  return { kind: 'core', id, reference: { name: id.slice('core:'.length), apply, ...extra } };
}

describe('loadPlugins core: 直调轨（§1.4——零 jiti 零门禁）', () => {
  it('apply 收 ctx+config；返回 disposer 入栈；skills 随行激活', async () => {
    const seen: unknown[] = [];
    const row = coreRow(
      'core:demo',
      async (ctx, config) => {
        seen.push(ctx, config);
        return () => void seen.push('disposed');
      },
      { config: { a: 1 }, skills: ['core-skill'] },
    );
    const report = await loadPlugins(rigOptions([row]));
    expect(report.activated.map((a) => a.id)).toEqual(['core:demo']);
    // core 行 skillDirs 解析形归专用 describe（基 = 宿主包根上推两级）
    expect(report.activated[0]!.skillDirs).toHaveLength(1);
    expect(isAbsolute(report.activated[0]!.skillDirs[0]!)).toBe(true);
    expect(seen[1]).toEqual({ a: 1 }); // config 缺省取引用形宿主侧默认
    expect(report.failed).toEqual([]);
    await report.unload();
    expect(seen).toContain('disposed');
  });

  it('行 config 在场胜引用形默认（字段级后写胜出）', async () => {
    let got: unknown;
    const row: CorePluginSpec = {
      kind: 'core',
      id: 'core:demo',
      config: { mine: true },
      reference: { name: 'demo', config: { mine: false }, apply: async (_c, config) => void (got = config) },
    };
    await loadPlugins(rigOptions([row]));
    expect(got).toEqual({ mine: true });
  });

  it('core: fail-loud——apply 抛错回卷已活行后抛（不留半装配）', async () => {
    const disposed: string[] = [];
    const plan: LoaderPlanRow[] = [
      coreRow('core:first', async () => () => void disposed.push('first')),
      coreRow('core:bad', async () => {
        throw new Error('狗粮炸了');
      }),
    ];
    try {
      await loadPlugins(rigOptions(plan));
      expect.unreachable('未拒启');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('PLUGIN_APPLY_FAILED'); // 失败码原样透传
      expect((err as BaseError).message).toContain('core:bad');
    }
    expect(disposed).toEqual(['first']); // 已活行 LIFO 回卷
  });
});

describe('loadPlugins Kahn 轮次（服务可用性驱动排序）', () => {
  it('依赖方排前也被后置——提供方先装载落服务解锁依赖方', async () => {
    const order: string[] = [];
    const services = makeServices();
    // plan 序故意倒置：consumer 在前（inject svc）、provider 在后
    const consumer: CorePluginSpec = {
      kind: 'core',
      id: 'core:consumer',
      reference: { name: 'consumer', inject: ['svc'], apply: async () => void order.push('consumer') },
    };
    const providerRow: CorePluginSpec = {
      kind: 'core',
      id: 'core:provider',
      reference: {
        name: 'provider',
        apply: async (ctx) => {
          order.push('provider');
          (ctx as { provide: (n: string, v: unknown) => void }).provide('svc', { n: 1 });
        },
      },
    };
    const report = await loadPlugins(rigOptions([consumer, providerRow]));
    expect(order).toEqual(['provider', 'consumer']); // 轮次重排
    expect(report.activated.map((a) => a.id)).toEqual(['core:provider', 'core:consumer']);
    void services;
  });

  it('不动点余行 core: inject 不可达——fail-loud 拒启（狗粮纪律）', async () => {
    const orphan = coreRow('core:orphan', async () => {}, { inject: ['never-provided'] });
    try {
      await loadPlugins(rigOptions([orphan]));
      expect.unreachable('未拒启');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('PLUGIN_INJECT_UNRESOLVED');
      expect((err as BaseError).message).toContain('core:orphan');
    }
  });

  it('用户行 inject 不可达——隔离降级 + onBootFailure 记账（其余行照常）', async () => {
    const bootCalls: Array<[string, string]> = [];
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-orphan', version: '3.1.4', berryAgent: { entry: 'entry.js' } }),
      'entry.js': `export default async function apply() {}`,
    });
    const orphan = diskRow(
      'plug-orphan',
      dir,
      {
        name: 'plug-orphan',
        version: '3.1.4',
        berryAgent: { entry: 'entry.js' },
      },
      { inject: ['never-provided'] },
    );
    const healthy = coreRow('core:healthy', async () => {});
    const report = await loadPlugins({
      ...rigOptions([orphan, healthy]),
      onBootFailure: (id, version) => void bootCalls.push([id, version]),
    });
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.code).toBe('PLUGIN_INJECT_UNRESOLVED');
    expect(report.activated.map((a) => a.id)).toEqual(['core:healthy']); // 其余行照常（档②）
    expect(bootCalls).toEqual([['plug-orphan', '3.1.4']]); // 记账面收 id+version
  });
});

describe('loadPlugins 磁盘轨（真 jiti 装载）', () => {
  it('entry-file ESM：default apply 执行 + 模块 inject 执法 + disposer 回卷', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-disk', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      'entry.js': `
import os from 'node:os';
import { platform } from './helper.js';
export const inject = ['svc-x'];
export default async function apply(ctx) {
  ctx.provide('seen', { platform, osType: typeof os.release, hasSvc: ctx.get('svc-x') });
  return () => ctx.provide('unloaded', true);
}
`,
      'helper.js': `import os from 'node:os';\nexport const platform = os.platform();\n`,
    });
    const svc = { tag: 'svc' };
    const options = rigOptions([
      diskRow('plug-disk', dir, { name: 'plug-disk', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    ]);
    (options.services as ServiceBag & { map: Map<string, unknown> }).map.set('svc-x', svc); // 预置服务
    const report = await loadPlugins(options);
    expect(report.failed).toEqual([]);
    const seen = options.services.get('seen') as { platform: NodeJS.Platform; osType: string; hasSvc: unknown };
    expect(seen.hasSvc).toBe(svc); // 模块 inject 声明执法通过 + ctx 投影同袋
    expect(seen.osType).toBe('function'); // node: 内建在道内真可达
    await report.unload();
    expect(options.services.get('unloaded')).toBe(true);
  });

  it('虚拟键同实例直注（防双实例）——插件拿到的 BaseError === 宿主 BaseError', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-virtual', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      'entry.js': `
import { BaseError } from 'berry-agent';
import { Value } from 'typebox/value';
export default async function apply(ctx) {
  ctx.provide('plugBaseError', BaseError);
  ctx.provide('plugValueCheck', typeof Value.Check);
}
`,
    });
    const options = rigOptions([
      diskRow('plug-virtual', dir, { name: 'plug-virtual', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    ]);
    const report = await loadPlugins(options);
    expect(report.failed).toEqual([]);
    expect(options.services.get('plugBaseError')).toBe(BaseError); // 身份断言：同模块实例非二次求值
    expect(options.services.get('plugValueCheck')).toBe('function'); // typebox/value 三键直注可用
  });

  it('字面量腿拒载——入口 import 裸 fs 即 PLUGIN_IMPORT_FORBIDDEN（行级隔离）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-bad-import', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      'entry.js': `import fs from 'fs';\nexport default async function apply() {}\n`,
    });
    const options = rigOptions([
      diskRow('plug-bad-import', dir, { name: 'plug-bad-import', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    ]);
    const report = await loadPlugins(options);
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]?.code).toBe('PLUGIN_IMPORT_FORBIDDEN');
    expect(report.failed[0]?.message).toContain('plug-bad-import'); // 报文点名插件
  });

  it('node_modules 子树豁免——自捆依赖内裸内建装载成功（生态惯例）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-with-dep', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      'entry.js': `
import dep from './node_modules/tiny-dep/index.js';
export default async function apply(ctx) { ctx.provide('depFs', dep); }
`,
      'node_modules/tiny-dep/index.js': `import fs from 'fs';\nexport default typeof fs.readFileSync;\n`,
    });
    const options = rigOptions([
      diskRow('plug-with-dep', dir, { name: 'plug-with-dep', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    ]);
    const report = await loadPlugins(options);
    expect(report.failed).toEqual([]);
    expect(options.services.get('depFs')).toBe('function'); // 依赖内裸 fs 按惯例放行（语义等价 node: 形）
  });

  it('default-export 态：entry 缺席走包主入口（package.json main）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-main', version: '1.0.0', main: './lib/start.js', berryAgent: {} }),
      'lib/start.js': `export default async function apply(ctx) { ctx.provide('viaMain', true); }\n`,
    });
    const options = rigOptions([diskRow('plug-main', dir, { name: 'plug-main', version: '1.0.0', berryAgent: {} })]);
    const report = await loadPlugins(options);
    expect(report.failed).toEqual([]);
    expect(options.services.get('viaMain')).toBe(true);
  });

  it('纯声明包（declared-payload）：零码装载——skills 随行激活', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({
        name: 'plug-skills',
        version: '1.0.0',
        berryAgent: { skills: ['s-one', 's-two'] },
      }),
    });
    const report = await loadPlugins(
      rigOptions([
        diskRow('plug-skills', dir, {
          name: 'plug-skills',
          version: '1.0.0',
          berryAgent: { skills: ['s-one', 's-two'] },
        }),
      ]),
    );
    expect(report.activated).toEqual([
      // 磁盘行 skillDirs 相对 pluginDir 解析（批 19 skills——03 §6.1 相对包根声明；
      // agentDirs 随行同律——eco-1 agents 键收下，未声明 = 空清单）
      { id: 'plug-skills', skillDirs: [resolve(dir, 's-one'), resolve(dir, 's-two')], agentDirs: [] },
    ]);
    expect(report.failed).toEqual([]);
  });

  it('default export 缺席 → PLUGIN_SHAPE_INVALID（行级隔离）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-no-default', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      'entry.js': `export const notApply = 1;\n`,
    });
    const report = await loadPlugins(
      rigOptions([
        diskRow('plug-no-default', dir, {
          name: 'plug-no-default',
          version: '1.0.0',
          berryAgent: { entry: 'entry.js' },
        }),
      ]),
    );
    expect(report.failed[0]?.code).toBe('PLUGIN_SHAPE_INVALID');
  });

  it('named export 坏形（inject 非字符串数组）→ PLUGIN_SHAPE_INVALID', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-bad-inject', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      'entry.js': `export const inject = 'svc-not-array';\nexport default async function apply() {}\n`,
    });
    const report = await loadPlugins(
      rigOptions([
        diskRow('plug-bad-inject', dir, {
          name: 'plug-bad-inject',
          version: '1.0.0',
          berryAgent: { entry: 'entry.js' },
        }),
      ]),
    );
    expect(report.failed[0]?.code).toBe('PLUGIN_SHAPE_INVALID');
  });

  it('模块内 inject 硬依赖缺席 → PLUGIN_INJECT_UNRESOLVED（装载位执法腿）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-need-svc', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      'entry.js': `export const inject = ['svc-not-there'];\nexport default async function apply() {}\n`,
    });
    const report = await loadPlugins(
      rigOptions([
        diskRow('plug-need-svc', dir, { name: 'plug-need-svc', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      ]),
    );
    expect(report.failed[0]?.code).toBe('PLUGIN_INJECT_UNRESOLVED');
  });

  it('入口文件不存在 → PLUGIN_ENTRY_UNRESOLVED', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-ghost', version: '1.0.0', berryAgent: { entry: 'missing.js' } }),
    });
    const report = await loadPlugins(
      rigOptions([
        diskRow('plug-ghost', dir, { name: 'plug-ghost', version: '1.0.0', berryAgent: { entry: 'missing.js' } }),
      ]),
    );
    expect(report.failed[0]?.code).toBe('PLUGIN_ENTRY_UNRESOLVED');
  });
});

describe('loadPlugins config 合成执法（ix-3——03 §1.2 configSchema 装载接线）', () => {
  /** 四型字段齐备的声明面 fixture（text/secret/select/boolean） */
  const fields = [
    { key: 'name', type: 'text', required: true },
    { key: 'token', type: 'secret', required: true },
    {
      key: 'mode',
      type: 'select',
      default: 'fast',
      options: [
        { value: 'fast', label: '快' },
        { value: 'slow', label: '慢' },
      ],
    },
    { key: 'verbose', type: 'boolean', default: false },
  ];

  function schemaRow(dir: string, config: unknown): DiskPluginSpec {
    return diskRow(
      'plug-cfg',
      dir,
      {
        name: 'plug-cfg',
        version: '1.0.0',
        berryAgent: { entry: 'entry.js', configSchema: fields },
      },
      { config },
    );
  }

  it('合成序四步齐验：行值过校验 + default 兜底 + secret 凭证直取 + 未声明键透传', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({
        name: 'plug-cfg',
        version: '1.0.0',
        berryAgent: { entry: 'entry.js', configSchema: fields },
      }),
      'entry.js': `export default async function apply(ctx, config) { ctx.provide('got', config); }\n`,
    });
    const options = rigOptions([schemaRow(dir, { name: 'alice', undeclared: true })], {
      getConfigSecret: (_id, key) => (key === 'token' ? 'sekret-from-vault' : undefined),
    });
    const report = await loadPlugins(options);
    expect(report.failed).toEqual([]);
    expect(options.services.get('got')).toEqual({
      name: 'alice',
      token: 'sekret-from-vault',
      mode: 'fast', // select default 兜底
      verbose: false, // boolean default 兜底
      undeclared: true, // 未声明键原样透传
    });
  });

  it('值违例三型 → PLUGIN_CONFIG_INVALID（text 非串 / select 出值域 / boolean 非布）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({
        name: 'plug-cfg',
        version: '1.0.0',
        berryAgent: { entry: 'entry.js', configSchema: fields },
      }),
      'entry.js': `export default async function apply() {}\n`,
    });
    for (const bad of [{ name: 42 }, { name: 'a', mode: 'warp' }, { name: 'a', verbose: 'yes' }]) {
      const report = await loadPlugins(rigOptions([schemaRow(dir, bad)]));
      expect(report.failed[0]?.code, JSON.stringify(bad)).toBe('PLUGIN_CONFIG_INVALID');
    }
  });

  it('configSchema 缺席 = 行为零变化：行 config 原值直传零校验（旧 typebox 消费路径拆除的回归锁）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-cfg', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      'entry.js': `export default async function apply(ctx, config) { ctx.provide('got', config); }\n`,
    });
    const options = rigOptions([
      diskRow(
        'plug-cfg',
        dir,
        { name: 'plug-cfg', version: '1.0.0', berryAgent: { entry: 'entry.js' } },
        { config: { undeclared: true } },
      ),
    ]);
    const report = await loadPlugins(options);
    expect(report.failed).toEqual([]);
    expect(options.services.get('got')).toEqual({ undeclared: true });
  });

  it('行 config 携 secret 明文值拒（PLUGIN_CONFIG_INVALID + 报文指路表单）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({
        name: 'plug-cfg',
        version: '1.0.0',
        berryAgent: { entry: 'entry.js', configSchema: fields },
      }),
      'entry.js': `export default async function apply() {}\n`,
    });
    const report = await loadPlugins(rigOptions([schemaRow(dir, { name: 'a', token: 'plain-leak' })]));
    expect(report.failed[0]?.code).toBe('PLUGIN_CONFIG_INVALID');
    expect(report.failed[0]?.message).toContain('/plugins config');
  });

  it('required secret 凭证缺席 → 拒（getConfigSecret 缺席位 = secret 恒缺席）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({
        name: 'plug-cfg',
        version: '1.0.0',
        berryAgent: { entry: 'entry.js', configSchema: fields },
      }),
      'entry.js': `export default async function apply() {}\n`,
    });
    const report = await loadPlugins(rigOptions([schemaRow(dir, { name: 'a' })]));
    expect(report.failed[0]?.code).toBe('PLUGIN_CONFIG_INVALID');
    expect(report.failed[0]?.message).toContain('凭证盒');
  });

  it('allowMissingRequiredSecret 豁免（:memory: 诊断形）→ warn 提示行 + 装载照走', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({
        name: 'plug-cfg',
        version: '1.0.0',
        berryAgent: { entry: 'entry.js', configSchema: fields },
      }),
      'entry.js': `export default async function apply(ctx, config) { ctx.provide('got', config); }\n`,
    });
    const warns: string[] = [];
    const options = rigOptions([schemaRow(dir, { name: 'a' })], {
      allowMissingRequiredSecret: true,
      warn: (m) => void warns.push(m),
    });
    const report = await loadPlugins(options);
    expect(report.failed).toEqual([]); // 降级不拒
    expect(warns.join('\n')).toContain('豁免');
    expect(options.services.get('got')).toEqual({ name: 'a', mode: 'fast', verbose: false }); // token 缺席不注
  });

  it('core: 轨同链：configSchema 合成 + 行 config 胜引用形默认', async () => {
    let got: unknown;
    const row: CorePluginSpec = {
      kind: 'core',
      id: 'core:cfg',
      config: { endpoint: 'row.example' },
      reference: {
        name: 'cfg',
        config: { endpoint: 'default.example' },
        configSchema: [{ key: 'endpoint', type: 'text', required: true }],
        apply: async (_c, config) => void (got = config),
      },
    };
    await loadPlugins(rigOptions([row]));
    expect(got).toEqual({ endpoint: 'row.example' });
  });

  it('core: 轨 required 缺席 → fail-loud（CorePluginBootError 载 PLUGIN_CONFIG_INVALID）', async () => {
    const row: CorePluginSpec = {
      kind: 'core',
      id: 'core:cfg',
      reference: {
        name: 'cfg',
        configSchema: [{ key: 'endpoint', type: 'text', required: true }],
        apply: async () => {},
      },
    };
    await expect(loadPlugins(rigOptions([row]))).rejects.toMatchObject({
      failure: { code: 'PLUGIN_CONFIG_INVALID' },
    });
  });
});

describe('loadPlugins 时钟帽（§3.4）与回卷（§5.7 档③）', () => {
  it('apply 超时 → 行级隔离 PLUGIN_APPLY_FAILED（不悬挂）；core: 超时同码 fail-loud', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-hang', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      'entry.js': `export default function apply() { return new Promise(() => {}); }\n`, // 永不解决
    });
    const report = await loadPlugins({
      ...rigOptions([
        diskRow('plug-hang', dir, { name: 'plug-hang', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      ]),
      applyBudgetMs: 40,
    });
    expect(report.failed[0]?.code).toBe('PLUGIN_APPLY_FAILED');
    expect(report.failed[0]?.message).toContain('40ms'); // 报文载帽值
    // core: 形态同因由走 fail-loud 拒启（狗粮纪律）
    try {
      await loadPlugins({ ...rigOptions([coreRow('core:hang', () => new Promise(() => {}))]), applyBudgetMs: 40 });
      expect.unreachable('未拒启');
    } catch (err) {
      expect((err as BaseError).code).toBe('PLUGIN_APPLY_FAILED');
    }
  });

  it('disposer 超时 → 档③降级存活（unload 聚合失败不炸 + 幂等）', async () => {
    const ok = coreRow('core:ok', async () => () => void 0);
    const hang = coreRow('core:hang-dispose', async () => () => new Promise(() => {})); // disposer 悬挂
    const report = await loadPlugins({ ...rigOptions([ok, hang]), disposerBudgetMs: 40 });
    expect(report.failed).toEqual([]);
    const result = await report.unload();
    expect(result.disposed).toEqual(['core:ok']); // 好 disposer 正常收
    expect(result.failed.map((f) => f.id)).toEqual(['core:hang-dispose']); // 悬挂者聚合不炸
    const again = await report.unload(); // 幂等
    expect(again).toEqual({ disposed: [], failed: [] });
  });

  it('unload LIFO 序（后激活先回卷）', async () => {
    const order: string[] = [];
    const first = coreRow('core:a', async () => () => void order.push('a'));
    const second = coreRow('core:b', async () => () => void order.push('b'));
    const report = await loadPlugins(rigOptions([first, second]));
    await report.unload();
    expect(order).toEqual(['b', 'a']); // LIFO
  });

  it('disabled 行跳过不装载（skipped 面）', async () => {
    const row: CorePluginSpec = {
      kind: 'core',
      id: 'core:off',
      disabled: true,
      reference: {
        name: 'off',
        apply: async () => {
          throw new Error('不应执行');
        },
      },
    };
    const report = await loadPlugins(rigOptions([row]));
    expect(report.skipped).toEqual([{ id: 'core:off', reason: expect.stringContaining('disabled') }]);
    expect(report.activated).toEqual([]);
  });
});

describe('loadPlugins jitiFactory 注入位（测试替身 seam）', () => {
  it('工厂收 pluginDir + 门禁件；替身 namespace 直供 default apply', async () => {
    const seen: Array<{ dir: string; hasTransform: boolean }> = [];
    const row = diskRow('plug-fake', '/tmp/berry-fake-plug', {
      name: 'plug-fake',
      version: '1.0.0',
      berryAgent: { entry: 'entry.js' },
    });
    const options = rigOptions([row], {
      jitiFactory: (dir, opts) => {
        seen.push({ dir, hasTransform: typeof opts.transform === 'function' });
        return {
          import: async () => ({
            default: async (ctx: { provide: (n: string, v: unknown) => void }) => ctx.provide('fakeLoaded', true),
          }),
        } as never;
      },
    });
    const report = await loadPlugins(options);
    expect(report.failed).toEqual([]);
    expect(seen).toEqual([{ dir: '/tmp/berry-fake-plug', hasTransform: true }]);
    expect(options.services.get('fakeLoaded')).toBe(true);
  });
});

describe('onApplySettled 行收口回调（finally 语义——关窗接线位）', () => {
  it('成功/失败/零码行皆达（三态全覆盖）', async () => {
    const settled: string[] = [];
    const ok = coreRow('core:ok', async () => undefined);
    const fail: CorePluginSpec = {
      kind: 'core',
      id: 'core:fail',
      reference: {
        name: 'fail',
        apply: async () => {
          throw new Error('boom');
        },
      },
    };
    // 失败 core: 行会 fail-loud 抛——单独装载验「失败也达」
    await expect(loadPlugins(rigOptions([fail], { onApplySettled: (id) => settled.push(id) }))).rejects.toThrow();
    expect(settled).toEqual(['core:fail']);
    // disabled 行不走装载步——不回调（收口 = apply 收口语义）
    const report = await loadPlugins(
      rigOptions(
        [
          ok,
          { kind: 'core', id: 'core:off', disabled: true, reference: { name: 'off', apply: async () => undefined } },
        ],
        {
          onApplySettled: (id) => settled.push(id),
        },
      ),
    );
    expect(report.activated.map((a) => a.id)).toEqual(['core:ok']);
    expect(settled).toEqual(['core:fail', 'core:ok']);
  });

  it('纯声明包零码行也收口（declared-payload 态）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'declared-pkg', version: '1.0.0', berryAgent: { skills: ['sk'] } }),
    });
    const row = diskRow('declared-pkg', dir, {
      name: 'declared-pkg',
      version: '1.0.0',
      berryAgent: { skills: ['sk'] },
    });
    const settled: string[] = [];
    const report = await loadPlugins(rigOptions([row], { onApplySettled: (id) => settled.push(id) }));
    expect(report.activated.map((a) => a.id)).toEqual(['declared-pkg']);
    expect(settled).toEqual(['declared-pkg']);
  });
});

describe('optionalInject 软依赖缺席 warn（03 §1.3——诚实降级不拒启）', () => {
  it('core: 引用形缺席名逐名点名 warn；present 名不记', async () => {
    const warnings: string[] = [];
    const services = makeServices();
    services.map.set('present-svc', 1);
    const row = coreRow('core:soft', async () => undefined, {
      optionalInject: ['present-svc', 'absent-svc'],
    });
    const report = await loadPlugins(rigOptions([row], { services, warn: (m) => warnings.push(m) }));
    expect(report.activated.map((a) => a.id)).toEqual(['core:soft']); // 不拒启
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('absent-svc');
    expect(warnings[0]).not.toContain('present-svc');
    expect(warnings[0]).toContain('core:soft'); // 归因插件 id
  });

  it('磁盘轨模块导出 optionalInject 同律；warn 落点缺席时不记', async () => {
    const row = diskRow(
      'plug-soft',
      makePluginDir({
        'package.json': JSON.stringify({ name: 'plug-soft', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
        'entry.js': 'export const optionalInject = ["ghost-svc"];\nexport default async () => undefined;\n',
      }),
      { name: 'plug-soft', version: '1.0.0', berryAgent: { entry: 'entry.js' } },
    );
    const report = await loadPlugins(rigOptions([row])); // 无 warn 落点——静默合法
    expect(report.failed).toEqual([]);
    expect(report.activated.map((a) => a.id)).toEqual(['plug-soft']);
  });
});

describe('createContext 开门授予集透传（03 §4.6 批 U2）', () => {
  it('磁盘行 opens 二参直达；core: 行/无 opens 磁盘行 = undefined', async () => {
    const seen: Array<{ id: string; opens: readonly string[] | undefined }> = [];
    const doorPkg = { name: 'plug-door', version: '1.0.0', berryAgent: { skills: ['door-skill'] } };
    const withOpens = diskRow('plug-door', makePluginDir({ 'package.json': JSON.stringify(doorPkg) }), doorPkg, {
      opens: ['sdk.register-route'],
    });
    const plainPkg = { name: 'plug-plain', version: '1.0.0', berryAgent: { skills: ['plain-skill'] } };
    const withoutOpens = diskRow('plug-plain', makePluginDir({ 'package.json': JSON.stringify(plainPkg) }), plainPkg);
    const report = await loadPlugins(
      rigOptions([withOpens, coreRow('core:demo', async () => undefined), withoutOpens], {
        createContext: (id, opens) => {
          seen.push({ id, opens });
          return {};
        },
      }),
    );
    expect(report.failed).toEqual([]);
    expect(seen).toEqual([
      { id: 'plug-door', opens: ['sdk.register-route'] }, // 磁盘行 opens 直达注入位
      { id: 'core:demo', opens: undefined }, // core: 行结构性无授予位
      { id: 'plug-plain', opens: undefined }, // 磁盘行缺席 opens = 全默认关
    ]);
  });
});

describe('ActivatedPlugin skillDirs 装载位解析（批 19 skills——03 §6.1 相对包根声明 → 绝对路径）', () => {
  it('磁盘两态同律：纯声明包与 entry 形都相对 pluginDir 解析（./ 前缀归一、多清单保序）', async () => {
    const declared = makePluginDir({
      'package.json': JSON.stringify({
        name: 'p-decl',
        version: '1.0.0',
        berryAgent: { skills: ['./skills', 'extras'] },
      }),
    });
    const coded = makePluginDir({
      'package.json': JSON.stringify({
        name: 'p-code',
        version: '1.0.0',
        berryAgent: { entry: 'entry.js', skills: ['./skills'] },
      }),
      'entry.js': 'export default async () => undefined;\n',
    });
    const report = await loadPlugins(
      rigOptions([
        diskRow('p-decl', declared, {
          name: 'p-decl',
          version: '1.0.0',
          berryAgent: { skills: ['./skills', 'extras'] },
        }),
        diskRow('p-code', coded, {
          name: 'p-code',
          version: '1.0.0',
          berryAgent: { entry: 'entry.js', skills: ['./skills'] },
        }),
      ]),
    );
    expect(report.failed).toEqual([]);
    expect(report.activated).toEqual([
      // './skills' 与裸段名同归一（resolve 语义）；清单序即注册面序
      { id: 'p-decl', skillDirs: [resolve(declared, 'skills'), resolve(declared, 'extras')], agentDirs: [] },
      { id: 'p-code', skillDirs: [resolve(coded, 'skills')], agentDirs: [] },
    ]);
  });

  it('core 行基 = 宿主包根（loader 件上推两级）绝对解析；无声明 = 空清单', async () => {
    const report = await loadPlugins(
      rigOptions([
        coreRow('core:a', async () => undefined, { skills: ['./skills'] }),
        coreRow('core:b', async () => undefined),
      ]),
    );
    expect(report.activated[0]!.skillDirs).toHaveLength(1);
    const dir = report.activated[0]!.skillDirs[0]!;
    expect(isAbsolute(dir)).toBe(true); // 相对声明已在装载位解析
    expect(basename(dir)).toBe('skills'); // './skills' 归一（非粘字符串）
    expect(report.activated[1]!.skillDirs).toEqual([]); // 无声明零清单
  });
});

describe('生态启动批 eco-1 三锁（修复前必红）——llm 虚拟键接线 / agents 键收下 / 声明载荷包根包含执法', () => {
  it('锁① berry-agent/llm 虚拟键真装载：provider 插件 import 可达且同实例（修复前红 = 装载失败于模块解析）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({ name: 'plug-llm', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
      'entry.js': `
import { createProvider, hasApi } from 'berry-agent/llm';
export default async function apply(ctx) {
  ctx.provide('llmCreateProvider', createProvider);
  ctx.provide('llmHasApi', hasApi);
}
`,
    });
    const options = rigOptions([
      diskRow('plug-llm', dir, { name: 'plug-llm', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    ]);
    const report = await loadPlugins(options);
    expect(report.failed).toEqual([]);
    // 身份断言：与宿主 providerApiFace 同模块实例（防双实例——03 §3.2 纪律，
    // 接线前 jiti 解析 'berry-agent/llm' 落自然失败 → failed 行非空）
    expect(options.services.get('llmCreateProvider')).toBe(providerApiFace.createProvider);
    expect(options.services.get('llmHasApi')).toBe(providerApiFace.hasApi);
  });

  it('锁② agents 键装载收集：磁盘行 agents-only 纯声明包零码装载、agentDirs 相对 pluginDir 解析（修复前红 = 键被闭集拒载）', async () => {
    const dir = makePluginDir({
      'package.json': JSON.stringify({
        name: 'plug-agents',
        version: '1.0.0',
        berryAgent: { agents: ['./agents', 'more-agents'] },
      }),
    });
    const report = await loadPlugins(
      rigOptions([
        diskRow('plug-agents', dir, {
          name: 'plug-agents',
          version: '1.0.0',
          berryAgent: { agents: ['./agents', 'more-agents'] },
        }),
      ]),
    );
    expect(report.failed).toEqual([]);
    expect(report.activated).toEqual([
      {
        id: 'plug-agents',
        skillDirs: [], // skills 缺席 = 空清单（agents-only 声明形）
        agentDirs: [resolve(dir, 'agents'), resolve(dir, 'more-agents')], // './' 前缀归一 + 清单序保真
      },
    ]);
  });

  it('锁②' + 'b core 行 agents 同律：基 = 宿主包根绝对解析', async () => {
    const report = await loadPlugins(
      rigOptions([
        coreRow('core:ag', async () => undefined, { agents: ['./agents'] }),
        coreRow('core:plain', async () => undefined),
      ]),
    );
    expect(report.activated[0]!.agentDirs).toHaveLength(1);
    expect(isAbsolute(report.activated[0]!.agentDirs[0]!)).toBe(true);
    expect(basename(report.activated[0]!.agentDirs[0]!)).toBe('agents');
    expect(report.activated[1]!.agentDirs).toEqual([]); // 无声明零清单
  });

  it('锁③ 声明载荷目录逃逸装载基拒——`../../` 出界即 PLUGIN_SHAPE_INVALID（修复前红 = 裸 resolve 逃逸装载成功；pi-lens 反面实证）', async () => {
    const escapeSkills = makePluginDir({
      'package.json': JSON.stringify({
        name: 'plug-esc-skills',
        version: '1.0.0',
        berryAgent: { skills: ['../../escape'] },
      }),
    });
    const escapeAgents = makePluginDir({
      'package.json': JSON.stringify({
        name: 'plug-esc-agents',
        version: '1.0.0',
        berryAgent: { agents: ['../outside'] },
      }),
    });
    const report = await loadPlugins(
      rigOptions([
        diskRow('plug-esc-skills', escapeSkills, {
          name: 'plug-esc-skills',
          version: '1.0.0',
          berryAgent: { skills: ['../../escape'] },
        }),
        diskRow('plug-esc-agents', escapeAgents, {
          name: 'plug-esc-agents',
          version: '1.0.0',
          berryAgent: { agents: ['../outside'] },
        }),
      ]),
    );
    // 两行各自隔离降级（档②）——逃逸不装载、不注册任何目录
    expect(report.activated).toEqual([]);
    expect(report.failed).toHaveLength(2);
    for (const failure of report.failed) {
      expect(failure.code).toBe('PLUGIN_SHAPE_INVALID');
      expect(failure.message).toContain('逃逸');
    }
    expect(report.failed.map((f) => f.id)).toEqual(['plug-esc-skills', 'plug-esc-agents']);
  });

  it('锁③b 界内 `..` 归一不误伤（a/../skills 仍在基内 = 放行）+ core 行逃逸 fail-loud', async () => {
    const inside = makePluginDir({
      'package.json': JSON.stringify({
        name: 'plug-inside',
        version: '1.0.0',
        berryAgent: { skills: ['a/../skills'] },
      }),
    });
    const report = await loadPlugins(
      rigOptions([
        diskRow('plug-inside', inside, {
          name: 'plug-inside',
          version: '1.0.0',
          berryAgent: { skills: ['a/../skills'] },
        }),
      ]),
    );
    expect(report.failed).toEqual([]);
    expect(report.activated[0]!.skillDirs).toEqual([resolve(inside, 'skills')]); // resolve 归一后在界内

    // core 行同律顺手执法：宿主包根逃逸 = fail-loud 拒启（不留半装配）
    await expect(
      loadPlugins(rigOptions([coreRow('core:esc', async () => undefined, { skills: ['../../..'] })])),
    ).rejects.toBeInstanceOf(CorePluginBootError);
  });
});
