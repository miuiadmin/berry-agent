/**
 * host/plugin-node-builtins 组合根测试——R3 grants 第二维 nodeBuiltins 全链
 * （03 §3.3 道②分级 / §4.2 第二维；05 §1.1 行 80 载荷扩形）。
 *
 * 覆盖面（任务清单逐项）：
 *  - 深校验三拒（非 node: 词形/不在册/重复）：装机态行级隔离 + 拒载零审计 +
 *    兄弟行不连坐；开发态试件同执法 fail-loud（PLUGIN_ROW_INVALID）；
 *  - 生效集两方交集（03 §4.2）：声明 ∩ opens `grants.node-builtins` 开门
 *    ——声明+开门全量、声明未开门空集收口形、未声明键缺席（写式三态）；
 *    试件行动作即授予（opens 位结构性缺席——生效集 = 声明全量）；
 *  - 门禁管线（boot 全链真 jiti）：受门档生效集外 import 拒载
 *    PLUGIN_NODE_BUILTIN_FORBIDDEN（分码分归因）、放行档免门零声明装载、
 *    声明+开门装载成功（node:os 真可达）；
 *  - diff 三元组（recordPluginGrantsDiff——anchor+roots+nodeBuiltins）：
 *    首落含维、幂等、单维变迁新笔、撤声明 [] 收口、撤位收口扩形（任一维
 *    非空即触发）、空面首记不落两维同判。
 *
 * 组合根全栈惯例：真装载管线 + HostRuntime 结构化替身；零码行用内存 fs
 * （免真盘真 jiti——装载管线全真）、码行用真盘临时目录（jiti 读真文件）；
 * 审计面真库真面（audit_events 读写往返零 mock）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';
import { EventDispatch, Scope } from '../context/index.js';
import { AUDIT_MIGRATION, createAuditFace, openStore } from '../persist/index.js';
import type { AuditFace, Store } from '../persist/index.js';

import { bootPlugins, QUICK_TEST_ROW_ID, recordPluginGrantsDiff } from './plugin-boot.js';
import type { PluginBootFs, PluginBootOptions } from './plugin-boot.js';
import type { HostRuntime } from './runtime.js';

/** 临时目录族（统一清） */
const dirs: string[] = [];
const stores: Store[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  for (const s of stores) s.close();
});

/** 内存 fs（Map 背书——零码行三源注入） */
function memoryFs(files: Record<string, string> = {}): PluginBootFs {
  const map = new Map(Object.entries(files));
  return { read: (path) => map.get(path) ?? null, write: (path, text) => void map.set(path, text) };
}

/** HostRuntime 结构化替身（装配序消费面 = dataDir + registerCloser + memory 位） */
function stubRuntime(dataDir: string | null): HostRuntime {
  return {
    memory: dataDir === null,
    dataDir,
    persistence: {} as HostRuntime['persistence'], // 装配序不消费——占位
    abortSignal: new AbortController().signal,
    disclosure: () => null,
    registerCloser: () => undefined,
    registerShutdownHook: () => undefined,
    registerDisposer: () => undefined,
    shutdown: async () => undefined,
    writeCrashLog: () => undefined,
  };
}

/** 装配选项速记（恒带 grantsFence——R3 生效集虽零 fence 参与，记账面仍随 fence 在场） */
function rigBoot(overrides: Partial<PluginBootOptions> & { fs?: PluginBootFs } = {}): PluginBootOptions {
  return {
    runtime: overrides.runtime ?? stubRuntime('/h/data'),
    scope: Scope.createRoot(),
    dispatch: new EventDispatch(),
    commands: { register: () => () => undefined },
    llm: { registerProvider: () => () => undefined },
    version: '9.9.9-test',
    warn: () => undefined,
    grantsFence: { workspace: '/data/wk', mode: 'workspace-write' },
    ...overrides,
  };
}

/** 真库真审计面（audit_events 读写往返） */
function openFace(): AuditFace {
  const dir = mkdtempSync(join(tmpdir(), 'berry-agent-nodebi-'));
  dirs.push(dir);
  const store = openStore({ dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
  stores.push(store);
  return createAuditFace(store.connection);
}

/** 审计流中 plugin/grants 笔 */
const grantsPens = (face: AuditFace) => face.listRecent().filter((r) => r.type === 'plugin/grants');
/** 某插件最新装载账（listRecent id 降序——首见即尾条） */
const grantsOfRows = (face: AuditFace, pluginId: string) =>
  grantsPens(face).find((r) => r.data['pluginId'] === pluginId)?.data;

/**
 * 零码装机行速记（内存 fs——declared-payload 免真盘）：grants 两维 + 行 opens
 * 可定制。数据目录 '/h/data' 与 workspace '/data/wk' 分立（同 plugin-grants 惯例）。
 */
function installRow(
  fsMap: Record<string, string>,
  id: string,
  grants?: { readonly writableRoots?: readonly string[]; readonly nodeBuiltins?: readonly string[] },
  opens?: readonly string[],
  dataDir = '/h/data',
): void {
  fsMap[`${dataDir}/enabled.yaml`] =
    (fsMap[`${dataDir}/enabled.yaml`] ?? 'plugins:\n') +
    (opens === undefined
      ? `  - id: ${id}\n`
      : `  - id: ${id}\n    opens:\n${opens.map((o) => `      - ${o}\n`).join('')}`);
  const ledgerText = fsMap[`${dataDir}/plugins/ledger.json`];
  const ledger: Record<string, unknown> = ledgerText === undefined ? {} : JSON.parse(ledgerText);
  ledger[id] = { installPath: `plugins/node_modules/${id}` };
  fsMap[`${dataDir}/plugins/ledger.json`] = JSON.stringify(ledger);
  const berryAgent: Record<string, unknown> = { skills: ['nb-skill'] };
  if (grants !== undefined && (grants.writableRoots !== undefined || grants.nodeBuiltins !== undefined)) {
    const g: Record<string, unknown> = {};
    if (grants.writableRoots !== undefined) g['writableRoots'] = [...grants.writableRoots];
    if (grants.nodeBuiltins !== undefined) g['nodeBuiltins'] = [...grants.nodeBuiltins];
    berryAgent['grants'] = g;
  }
  fsMap[`${dataDir}/plugins/node_modules/${id}/package.json`] = JSON.stringify({
    name: id,
    version: '1.0.0',
    berryAgent,
  });
}

/** 开发态试件目录 package.json 速记（--plugin-file 目录形——内存 fs） */
function devRow(fsMap: Record<string, string>, pluginDir: string, nodeBuiltins?: readonly string[]): void {
  const berryAgent: Record<string, unknown> = { skills: ['nb-dev-skill'] };
  if (nodeBuiltins !== undefined) berryAgent['grants'] = { nodeBuiltins: [...nodeBuiltins] };
  fsMap[join(pluginDir, 'package.json')] = JSON.stringify({ name: 'dev-nb', version: '1.0.0', berryAgent });
}

/**
 * 真盘码行速记（boot 全链真 jiti——transform 门禁只对真文件执法）：真数据
 * 目录 + enabled.yaml/账本/package.json/entry.js 全真盘写，bootOptions 不注
 * fs（缺省真盘读侧）。
 */
function codeRow(
  dataDir: string,
  id: string,
  entry: string,
  nodeBuiltins?: readonly string[],
  opens?: readonly string[],
): void {
  const yaml =
    'plugins:\n' +
    (opens === undefined
      ? `  - id: ${id}\n`
      : `  - id: ${id}\n    opens:\n${opens.map((o) => `      - ${o}\n`).join('')}`);
  writeFileSync(join(dataDir, 'enabled.yaml'), yaml);
  const ledgerPath = join(dataDir, 'plugins', 'ledger.json');
  const ledger: Record<string, unknown> = { [id]: { installPath: `plugins/node_modules/${id}` } };
  mkdirSync(join(dataDir, 'plugins', 'node_modules', id), { recursive: true });
  writeFileSync(ledgerPath, JSON.stringify(ledger));
  const berryAgent: Record<string, unknown> = { entry: 'entry.js' };
  if (nodeBuiltins !== undefined) berryAgent['grants'] = { nodeBuiltins: [...nodeBuiltins] };
  writeFileSync(
    join(dataDir, 'plugins', 'node_modules', id, 'package.json'),
    JSON.stringify({ name: id, version: '1.0.0', berryAgent }),
  );
  writeFileSync(join(dataDir, 'plugins', 'node_modules', id, 'entry.js'), entry);
}

describe('grants.nodeBuiltins 深校验三拒（03 §4.2——修前红：装载序零第二维校验）', () => {
  it('拒非 node: 前缀词形：行级隔离（兄弟行照装）+ 拒载零审计', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', { nodeBuiltins: ['fs'] }); // 裸名形——词形即失配
    installRow(fsMap, 'beta', { nodeBuiltins: ['node:fs'] }); // 兄弟合法行
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap), audit: face }));
    expect(boot.report.failed.map((f) => f.id)).toEqual(['acme']);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_SHAPE_INVALID');
    expect(boot.report.failed[0]!.message).toContain('nodeBuiltins');
    expect(boot.report.failed[0]!.message).toContain('node:');
    expect(boot.report.activated.map((a) => a.id)).toEqual(['beta']);
    expect(grantsOfRows(face, 'acme')).toBeUndefined(); // 拒载零审计
    expect(boot.grantsOf('beta')).toBeDefined(); // 兄弟行账面照建（隔离不连坐）
  });

  it('拒未知内建名（拼错名/虚构名 fail-closed 不静默出集）', async () => {
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', { nodeBuiltins: ['node:fsx'] });
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap) }));
    expect(boot.report.failed.map((f) => f.id)).toEqual(['acme']);
    expect(boot.report.failed[0]!.message).toContain('未知内建名');
    expect(boot.report.failed[0]!.message).toContain('node:fsx');
  });

  it('拒重复项（声明面规范形）', async () => {
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', { nodeBuiltins: ['node:fs', 'node:fs'] });
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap) }));
    expect(boot.report.failed.map((f) => f.id)).toEqual(['acme']);
    expect(boot.report.failed[0]!.message).toContain('重复');
  });

  it('浅校验形状拒在先：非字符串数组行级隔离（manifest 形状门）', async () => {
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', { nodeBuiltins: ['node:fs'] });
    // 手搓坏形（浅校验面——string[] 形状在 parseManifest）
    const pkg = JSON.parse(fsMap['/h/data/plugins/node_modules/acme/package.json']!) as {
      berryAgent: { grants: Record<string, unknown> };
    };
    pkg.berryAgent.grants['nodeBuiltins'] = [1, 2];
    fsMap['/h/data/plugins/node_modules/acme/package.json'] = JSON.stringify(pkg);
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap) }));
    expect(boot.report.failed.map((f) => f.id)).toEqual(['acme']);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_SHAPE_INVALID');
    expect(boot.report.failed[0]!.message).toContain('nodeBuiltins');
  });

  it('开发态试件同执法：--plugin-file 三拒 fail-loud（PLUGIN_ROW_INVALID）', async () => {
    const fsMap: Record<string, string> = {};
    devRow(fsMap, '/data/wk/plugins/qtest-nb', ['os']); // 非 node: 词形
    try {
      await bootPlugins(rigBoot({ pluginFile: '/data/wk/plugins/qtest-nb', fs: memoryFs(fsMap) }));
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('PLUGIN_ROW_INVALID');
        expect(err.message).toContain('nodeBuiltins');
        return;
      }
      expect.unreachable();
    }
  });
});

describe('生效集两方交集（03 §4.2——声明 ∩ opens 开门；写式三态）', () => {
  it('声明+开门 → 生效集全量入账（排序去重）+ 审计笔含维', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', { nodeBuiltins: ['node:os', 'node:fs'] }, ['grants.node-builtins']);
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap), audit: face }));
    expect(boot.report.activated.map((a) => a.id)).toEqual(['acme']);
    expect(boot.grantsOf('acme')).toEqual({
      pluginId: 'acme',
      anchor: 'workspace',
      roots: [],
      nodeBuiltins: ['node:fs', 'node:os'], // 排序稳定形
    });
    expect(grantsOfRows(face, 'acme')).toEqual({
      pluginId: 'acme',
      anchor: 'workspace',
      roots: [],
      nodeBuiltins: ['node:fs', 'node:os'],
    });
  });

  it('声明未开门 → 空集收口形（nodeBuiltins: []——已声明未开门如实入账）', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', { nodeBuiltins: ['node:os'] }); // 无 opens
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap), audit: face }));
    expect(boot.grantsOf('acme')).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: [], nodeBuiltins: [] });
    // 空面首记不落（两维同判——roots 与生效集皆空，[] 笔恒为收口形非首记基线）
    expect(grantsPens(face)).toEqual([]);
  });

  it('未声明 → 账面键缺席（无声明零参与——不为未声明维造键）', async () => {
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', { writableRoots: ['./assets'] });
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap) }));
    const account = boot.grantsOf('acme');
    expect(account).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] });
    expect('nodeBuiltins' in (account ?? {})).toBe(false); // 键缺席（非 undefined 值位）
  });

  it('试件行动作即授予：opens 位结构性缺席——生效集 = 声明全量；零落盘', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    devRow(fsMap, '/data/wk/plugins/qtest-nb', ['node:os']);
    const boot = await bootPlugins(
      rigBoot({ pluginFile: '/data/wk/plugins/qtest-nb', fs: memoryFs(fsMap), audit: face }),
    );
    expect(boot.grantsOf(QUICK_TEST_ROW_ID)).toEqual({
      pluginId: QUICK_TEST_ROW_ID,
      anchor: 'plugin-dir',
      roots: [],
      nodeBuiltins: ['node:os'],
    });
    expect(grantsPens(face)).toEqual([]); // 试件行零落盘（不变式 1）
  });

  it('开门名值域单源共变：node:os 在第七枚 grants.node-builtins 值域内合法——拒载方向（值域外）由 opens 值域两向锁承载', async () => {
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', { nodeBuiltins: ['node:os'] }, ['grants.node-builtins']);
    // 值域内合法（第七枚）——装载成活即证 opens 值域自动共变（目录扩枚举校验面共变）
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap) }));
    expect(boot.report.activated.map((a) => a.id)).toEqual(['acme']);
    expect(boot.grantsOf('acme')?.nodeBuiltins).toEqual(['node:os']);
  });
});

describe('门禁管线（boot 全链真 jiti——03 §3.3 道②分级执法）', () => {
  /** 真盘数据目录速记 */
  function realDataDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'berry-agent-nb-code-'));
    dirs.push(dir);
    return dir;
  }

  it('未声明受门档 import → 拒载 PLUGIN_NODE_BUILTIN_FORBIDDEN（默认关 fail-closed + 拒载零审计）', async () => {
    const dataDir = realDataDir();
    const face = openFace();
    codeRow(dataDir, 'plug-gated', `import os from 'node:os';\nexport default async function apply() {}\n`);
    const boot = await bootPlugins(rigBoot({ runtime: stubRuntime(dataDir), audit: face }));
    expect(boot.report.failed.map((f) => f.id)).toEqual(['plug-gated']);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN'); // 分码分归因（非 PLUGIN_IMPORT_FORBIDDEN）
    expect(boot.report.failed[0]!.message).toContain('node:os');
    expect(grantsPens(face)).toEqual([]); // 拒载零审计
  });

  it('声明+开门 → node:os 真可达装载成活（生效集内放行）', async () => {
    const dataDir = realDataDir();
    codeRow(
      dataDir,
      'plug-ok',
      `import os from 'node:os';\nexport default async function apply(ctx) { ctx.provide('nb-platform', os.platform()); }\n`,
      ['node:os'],
      ['grants.node-builtins'],
    );
    const boot = await bootPlugins(rigBoot({ runtime: stubRuntime(dataDir) }));
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['plug-ok']);
  });

  it('声明未开门 → 同拒（两方交集缺一即空——开门维独立执法位）', async () => {
    const dataDir = realDataDir();
    codeRow(dataDir, 'plug-closed', `import os from 'node:os';\nexport default async function apply() {}\n`, [
      'node:os',
    ]);
    const boot = await bootPlugins(rigBoot({ runtime: stubRuntime(dataDir) }));
    expect(boot.report.failed.map((f) => f.id)).toEqual(['plug-closed']);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN');
  });

  it('放行档免门：node:path 零声明零开门装载成活（三道白名单叙事对此集零变化）', async () => {
    const dataDir = realDataDir();
    codeRow(
      dataDir,
      'plug-pure',
      `import { join } from 'node:path';\nexport default async function apply(ctx) { ctx.provide('nb-joined', join('a', 'b')); }\n`,
    );
    const boot = await bootPlugins(rigBoot({ runtime: stubRuntime(dataDir) }));
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['plug-pure']);
  });

  it('试件行未声明受门档 import 同拒（动作即授予只授声明面——默认关两态同律）', async () => {
    const pluginDir = mkdtempSync(join(tmpdir(), 'berry-agent-nb-dev-'));
    dirs.push(pluginDir);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({ name: 'dev-nb-code', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    );
    writeFileSync(join(pluginDir, 'entry.js'), `import os from 'node:os';\nexport default async function apply() {}\n`);
    const boot = await bootPlugins(rigBoot({ pluginFile: pluginDir }));
    expect(boot.report.failed.map((f) => f.id)).toEqual([QUICK_TEST_ROW_ID]);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN');
  });

  it('试件行声明即授予：--plugin-file 声明 node:os → 装载成活', async () => {
    const pluginDir = mkdtempSync(join(tmpdir(), 'berry-agent-nb-dev2-'));
    dirs.push(pluginDir);
    mkdirSync(pluginDir, { recursive: true });
    writeFileSync(
      join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'dev-nb-code2',
        version: '1.0.0',
        berryAgent: { entry: 'entry.js', grants: { nodeBuiltins: ['node:os'] } },
      }),
    );
    writeFileSync(join(pluginDir, 'entry.js'), `import os from 'node:os';\nexport default async function apply() {}\n`);
    const boot = await bootPlugins(rigBoot({ pluginFile: pluginDir }));
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.activated.map((a) => a.id)).toEqual([QUICK_TEST_ROW_ID]);
  });
});

describe('门禁管线 ESM 形（type:module 原生求值路径——2026-10-18 勘正修前红：jiti 原生 ESM 零调 transform，受门内建整体绕行；前置源扫腿封堵）', () => {
  /** 真盘数据目录速记 */
  function realDataDir(): string {
    const dir = mkdtempSync(join(tmpdir(), 'berry-agent-nb-esm-'));
    dirs.push(dir);
    return dir;
  }

  /**
   * 真盘 ESM 码行速记（type:module 清单——jiti 走原生 import() 的装载形态）：
   * 多文件 map 落盘（相对导入图形），行件三源（enabled.yaml/账本/清单）同
   * codeRow 惯例。
   */
  function codeRowEsm(
    dataDir: string,
    id: string,
    files: Readonly<Record<string, string>>,
    nodeBuiltins?: readonly string[],
    opens?: readonly string[],
  ): void {
    const yaml =
      'plugins:\n' +
      (opens === undefined
        ? `  - id: ${id}\n`
        : `  - id: ${id}\n    opens:\n${opens.map((o) => `      - ${o}\n`).join('')}`);
    writeFileSync(join(dataDir, 'enabled.yaml'), yaml);
    const ledgerPath = join(dataDir, 'plugins', 'ledger.json');
    const ledger: Record<string, unknown> = { [id]: { installPath: `plugins/node_modules/${id}` } };
    mkdirSync(join(dataDir, 'plugins', 'node_modules', id), { recursive: true });
    writeFileSync(ledgerPath, JSON.stringify(ledger));
    const berryAgent: Record<string, unknown> = { entry: 'entry.js' };
    if (nodeBuiltins !== undefined) berryAgent['grants'] = { nodeBuiltins: [...nodeBuiltins] };
    // 差异位：type:module（触发 jiti 原生 ESM 求值——transform 钩子零调用的形态）
    writeFileSync(
      join(dataDir, 'plugins', 'node_modules', id, 'package.json'),
      JSON.stringify({ name: id, version: '1.0.0', type: 'module', berryAgent }),
    );
    for (const [rel, source] of Object.entries(files)) {
      writeFileSync(join(dataDir, 'plugins', 'node_modules', id, rel), source);
    }
  }

  it('type:module + 未声明受门档 import → 拒载 PLUGIN_NODE_BUILTIN_FORBIDDEN（修前红：原生 ESM 求值绕过 transform 腿整体放行）', async () => {
    const dataDir = realDataDir();
    codeRowEsm(dataDir, 'plug-esm-bad', {
      'entry.js': `import os from 'node:os';\nexport default async function apply() {}\n`,
    });
    const boot = await bootPlugins(rigBoot({ runtime: stubRuntime(dataDir) }));
    expect(boot.report.failed.map((f) => f.id)).toEqual(['plug-esm-bad']);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN'); // 分码分归因
    expect(boot.report.failed[0]!.message).toContain('node:os');
  });

  it('type:module + 声明+开门 → 原生 ESM 装载成活（node:os 真可达——源扫腿对在道形零误伤）', async () => {
    const dataDir = realDataDir();
    codeRowEsm(
      dataDir,
      'plug-esm-ok',
      {
        'entry.js': `import os from 'node:os';\nexport default async function apply(ctx) { ctx.provide('nb-esm', os.platform()); }\n`,
      },
      ['node:os'],
      ['grants.node-builtins'],
    );
    const boot = await bootPlugins(rigBoot({ runtime: stubRuntime(dataDir) }));
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['plug-esm-ok']);
  });

  it('type:module 相对导入子文件违规同拒（源扫腿图遍历——违规点在 helper.js 孙位）', async () => {
    const dataDir = realDataDir();
    codeRowEsm(dataDir, 'plug-esm-deep', {
      'entry.js': `import './helper.js';\nexport default async function apply() {}\n`,
      'helper.js': `import cp from 'node:child_process';\nexport const probe = cp;\n`,
    });
    const boot = await bootPlugins(rigBoot({ runtime: stubRuntime(dataDir) }));
    expect(boot.report.failed.map((f) => f.id)).toEqual(['plug-esm-deep']);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_NODE_BUILTIN_FORBIDDEN');
    expect(boot.report.failed[0]!.message).toContain('node:child_process'); // 归因到子文件说明符
  });
});

describe('diff 三元组（recordPluginGrantsDiff——anchor+roots+nodeBuiltins 扩形）', () => {
  it('首落含维 + 幂等零新笔 + nodeBuiltins 单独变迁亦落新笔（三元组 diff 键）', () => {
    const face = openFace();
    recordPluginGrantsDiff(face, [
      { pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'], nodeBuiltins: ['node:fs'] },
    ]);
    expect(grantsOfRows(face, 'acme')).toEqual({
      pluginId: 'acme',
      anchor: 'workspace',
      roots: ['/data/wk/assets'],
      nodeBuiltins: ['node:fs'],
    });
    // 同面重放零新笔（幂等）
    recordPluginGrantsDiff(face, [
      { pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'], nodeBuiltins: ['node:fs'] },
    ]);
    expect(grantsPens(face)).toHaveLength(1);
    // nodeBuiltins 单独变迁（roots 同）——三元组 diff 键捕捉 → 新笔
    recordPluginGrantsDiff(face, [
      { pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'], nodeBuiltins: ['node:fs', 'node:os'] },
    ]);
    expect(grantsPens(face)).toHaveLength(2);
    expect(grantsOfRows(face, 'acme')).toEqual({
      pluginId: 'acme',
      anchor: 'workspace',
      roots: ['/data/wk/assets'],
      nodeBuiltins: ['node:fs', 'node:os'],
    });
  });

  it('撤声明收口形：现无声明 + 尾条非空 → 显式 nodeBuiltins: []（键不缺席）', () => {
    const face = openFace();
    recordPluginGrantsDiff(face, [
      { pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'], nodeBuiltins: ['node:fs'] },
    ]);
    // 清单撤维（现无声明——账面键缺席）→ 收口笔显式 []
    recordPluginGrantsDiff(face, [{ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] }]);
    expect(grantsPens(face)).toHaveLength(2);
    expect(grantsOfRows(face, 'acme')).toEqual({
      pluginId: 'acme',
      anchor: 'workspace',
      roots: ['/data/wk/assets'],
      nodeBuiltins: [],
    });
    // listRecent id 降序——[0] 即最新笔（收口笔）
    const pen = grantsPens(face)[0]!.data;
    expect(pen['nodeBuiltins']).toEqual([]); // 显式收口键在场（非缺席）
  });

  it('现无声明 + 尾条空 → 变迁笔键缺席（未声明维不造键）', () => {
    const face = openFace();
    recordPluginGrantsDiff(face, [{ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] }]);
    // 根变（nodeBuiltins 两态皆无）——变迁笔只动 roots，nodeBuiltins 键缺席
    recordPluginGrantsDiff(face, [{ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/b'] }]);
    const pen = grantsPens(face)[0]!.data; // id 降序——[0] 最新笔
    expect(pen['roots']).toEqual(['/data/wk/b']);
    expect('nodeBuiltins' in pen).toBe(false); // 键缺席
  });

  it('撤位收口扩形：尾条任一维非空即触发（nodeBuiltins 单维非空形）', () => {
    const face = openFace();
    // 曾记账：roots 空 + nodeBuiltins 非空（仅内建维授予的插件形——修前撤位
    // 判只看 roots 非空，此形不触收口 = 修前红位）
    recordPluginGrantsDiff(face, [{ pluginId: 'acme', anchor: 'workspace', roots: [], nodeBuiltins: ['node:fs'] }]);
    expect(grantsPens(face)).toHaveLength(1); // 首记含维（roots 空亦落——nodeBuiltins 非空）
    recordPluginGrantsDiff(face, []); // 撤位
    expect(grantsPens(face)).toHaveLength(2);
    expect(grantsOfRows(face, 'acme')).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: [], nodeBuiltins: [] });
    // 已空再 diff——不重放
    recordPluginGrantsDiff(face, []);
    expect(grantsPens(face)).toHaveLength(2);
  });

  it('撤位笔 nodeBuiltins 尾条空 → 键缺席（roots 收口独走）；空面首记不落两维同判', () => {
    const face = openFace();
    recordPluginGrantsDiff(face, [{ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/a'] }]); // 无 nodeBuiltins 维
    recordPluginGrantsDiff(face, []); // 撤位——尾条 nodeBuiltins 空 → 键缺席
    const pen = grantsPens(face)[0]!.data; // id 降序——[0] 最新笔（撤位笔）
    expect(pen['roots']).toEqual([]);
    expect('nodeBuiltins' in pen).toBe(false);
    // 空面首记不落（两维皆空——不造基线噪声）
    const face2 = openFace();
    recordPluginGrantsDiff(face2, [{ pluginId: 'beta', anchor: 'workspace', roots: [], nodeBuiltins: [] }]);
    expect(grantsPens(face2)).toEqual([]);
  });
});
