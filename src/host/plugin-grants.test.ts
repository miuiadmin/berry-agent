/**
 * host/plugin-grants 组合根测试——grants 装载深校验 + 交集入账（05 §1.1 行 80
 * plugin/grants 审计词，2026-10-16 硬伤处置第三批·①段一——销 12a 欠账）。
 *
 * 覆盖面（任务清单逐项）：
 *  - 深校验四拒（".."/绝对路径/空串/Windows 形）：装机态行级隔离 + 拒载行
 *    零审计（未获装载不记账——05 §1.1）；开发态试件同执法 fail-loud；
 *  - 双锚两态交集（03 §4.2 双锚定形注）：开发态 --plugin-file 锚插件目录、
 *    装机态磁盘行锚 workspace；锚定根在 fence 根外 = 交集恒空（布局事实
 *    非缺陷）；read-only 恒空 / danger 全盘根非空 / 数据目录 carve-out 恒优先；
 *  - canonical 形：./x ≡ x ≡ ./x/ 同锚同 canonical、排序去重、清单原文
 *    不入载荷（05 §1.1 值律）；
 *  - diff 幂等（recordPluginGrantsDiff——律同 plugin/opens）：有变才落、
 *    锚切换/根变落新条（diff 键 = anchor+roots 二元组）、交集变空落 []、
 *    撤位收口不重放；
 *  - core: 行不豁免于账面纪律（段一无豁免面——core 引用行结构性无 grants
 *    申请面；§4.6 官方件豁免是段二执法闸事非本段事）。
 *
 * 组合根全栈惯例：真装载管线 + HostRuntime 结构化替身 + fs 注入内存 Map；
 * 审计面真库真面（audit_events 表由 AUDIT_MIGRATION 建就——读写往返零 mock）。
 * 平台鲁棒性：内存 fs 用不存在路径（canonicalPath 最近既有祖先解析到 '/' 后
 * 原样拼回——期望值两平台同串）；fence 外/数据目录用真盘临时目录（两侧同经
 * canonicalPath 求交，无裸串假设）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';
import { EventDispatch, Scope } from '../context/index.js';
import { AUDIT_MIGRATION, createAuditFace, openStore } from '../persist/index.js';
import type { AuditFace, Store } from '../persist/index.js';

import type { CorePluginReference } from './loader.js';
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

/** 内存 fs（Map 背书——读侧三源 + boot-failures 记账面全注入） */
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

/**
 * 装配选项速记——本文件恒带 grantsFence（grants 腿接线 = fence 快照输入：
 * workspace 锚根 + boot 解析档位；缺席 = grants 腿整跳诚实缺席律——另有
 * 缺席专项断言不在本文件）。
 */
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

/** 真库真审计面（audit_events 读写往返——拒载零审计/落账形状断言判据源） */
function openFace(): AuditFace {
  const dir = mkdtempSync(join(tmpdir(), 'berry-agent-grants-'));
  dirs.push(dir);
  const store = openStore({ dataDir: join(dir, 'data'), migrations: [AUDIT_MIGRATION] });
  stores.push(store);
  return createAuditFace(store.connection);
}

/** 审计流中 plugin/grants 笔（本词专属滤面） */
const grantsPens = (face: AuditFace) => face.listRecent().filter((r) => r.type === 'plugin/grants');

/** 某插件最新装载账（listRecent id 降序——首见即尾条） */
const grantsOfRows = (face: AuditFace, pluginId: string) =>
  grantsPens(face).find((r) => r.data['pluginId'] === pluginId)?.data;

/**
 * 装机态行装填速记：启用行 + 账本 + package.json（declared-payload 零码形
 * 免真盘真 jiti——装载管线全真）。可多次调用（启用行/账本条目累加——共享
 * 行隔离对照用）；数据目录 '/h/data' 与 workspace '/data/wk' 分立（真实布局
 * 数据目录不含工作区——内存路径同构）；dataDir 参可换真盘临时目录（carve-out
 * 对照用）。
 */
function installRow(
  fsMap: Record<string, string>,
  id: string,
  writableRoots?: readonly string[],
  dataDir = '/h/data',
): void {
  fsMap[`${dataDir}/enabled.yaml`] = (fsMap[`${dataDir}/enabled.yaml`] ?? 'plugins:\n') + `  - id: ${id}\n`;
  const ledgerText = fsMap[`${dataDir}/plugins/ledger.json`];
  const ledger: Record<string, unknown> = ledgerText === undefined ? {} : JSON.parse(ledgerText);
  ledger[id] = { installPath: `plugins/node_modules/${id}` };
  fsMap[`${dataDir}/plugins/ledger.json`] = JSON.stringify(ledger);
  const berryAgent: Record<string, unknown> = { skills: ['grant-skill'] };
  if (writableRoots !== undefined) berryAgent['grants'] = { writableRoots: [...writableRoots] };
  fsMap[`${dataDir}/plugins/node_modules/${id}/package.json`] = JSON.stringify({
    name: id,
    version: '1.0.0',
    berryAgent,
  });
}

/** 开发态试件目录 package.json 装填速记（--plugin-file 目录形） */
function devRow(fsMap: Record<string, string>, pluginDir: string, writableRoots?: readonly string[]): void {
  const berryAgent: Record<string, unknown> = { skills: ['dev-skill'] };
  if (writableRoots !== undefined) berryAgent['grants'] = { writableRoots: [...writableRoots] };
  fsMap[join(pluginDir, 'package.json')] = JSON.stringify({ name: 'dev-q', version: '1.0.0', berryAgent });
}

describe('grants 深校验四拒（03 §4.2——清单校验拒绝式同门；修前浅校验只覆 string[] 形状）', () => {
  it('拒 ".." 段：行级隔离（兄弟行照装照记账）+ 拒载行零审计', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', ['../escape']);
    installRow(fsMap, 'beta', ['./assets']); // 兄弟合法行——隔离判据
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap), audit: face }));
    // 拒载行进 failed 面（行级隔离——03 §5.4/§5.7），失败码/message 点名根因
    expect(boot.report.failed.map((f) => f.id)).toEqual(['acme']);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_SHAPE_INVALID');
    expect(boot.report.failed[0]!.message).toContain('writableRoots');
    expect(boot.report.failed[0]!.message).toContain('../escape');
    expect(boot.report.activated.map((a) => a.id)).toEqual(['beta']);
    // 拒载零审计（05 §1.1——未获装载不记账）；兄弟行账面照落（隔离不连坐）
    expect(grantsOfRows(face, 'acme')).toBeUndefined();
    expect(grantsOfRows(face, 'beta')).toEqual({ pluginId: 'beta', anchor: 'workspace', roots: ['/data/wk/assets'] });
  });

  it('拒绝对路径：行级隔离 + 零审计', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', ['/etc']);
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap), audit: face }));
    expect(boot.report.failed.map((f) => f.id)).toEqual(['acme']);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_SHAPE_INVALID');
    expect(boot.report.failed[0]!.message).toContain('绝对路径');
    expect(boot.report.activated).toEqual([]);
    expect(grantsPens(face)).toEqual([]);
  });

  it('拒空串：行级隔离 + 零审计', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', ['./assets', '']);
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap), audit: face }));
    expect(boot.report.failed.map((f) => f.id)).toEqual(['acme']);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_SHAPE_INVALID');
    expect(boot.report.failed[0]!.message).toContain('空串');
    expect(boot.report.activated).toEqual([]);
    expect(grantsPens(face)).toEqual([]);
  });

  it('拒 Windows 形：行级隔离 + 零审计', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', ['C:\\work']);
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap), audit: face }));
    expect(boot.report.failed.map((f) => f.id)).toEqual(['acme']);
    expect(boot.report.failed[0]!.code).toBe('PLUGIN_SHAPE_INVALID');
    expect(boot.report.failed[0]!.message).toContain('Windows');
    expect(boot.report.activated).toEqual([]);
    expect(grantsPens(face)).toEqual([]);
  });

  it('开发态试件同执法：--plugin-file grants 四拒 fail-loud（PLUGIN_ROW_INVALID）', async () => {
    const fsMap: Record<string, string> = {};
    devRow(fsMap, '/data/wk/plugins/qtest', ['../escape']);
    await expect(bootPlugins(rigBoot({ pluginFile: '/data/wk/plugins/qtest', fs: memoryFs(fsMap) }))).rejects.toThrow(
      BaseError,
    );
    // 词面点名（试件坏形 fail-loud 同磁盘行执法面全套——resolveQuickTestRow 律）
    try {
      await bootPlugins(rigBoot({ pluginFile: '/data/wk/plugins/qtest', fs: memoryFs(fsMap) }));
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('PLUGIN_ROW_INVALID');
        expect(err.message).toContain('writableRoots');
        return;
      }
      expect.unreachable();
    }
  });
});

describe('双锚两态交集入账（03 §4.2 双锚定形注 + 05 §1.1 行 80）', () => {
  it('装机态 workspace 锚：canonical 入账 + boot 二次幂等零新笔', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', ['./assets']);
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap), audit: face }));
    expect(boot.report.activated.map((a) => a.id)).toEqual(['acme']);
    // 装载账取值器（在程视图）与 durable 审计流尾条同源同值
    expect(boot.grantsOf('acme')).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] });
    expect(grantsOfRows(face, 'acme')).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] });
    // 同面再 boot（/reload 形）——有变才落，零新笔
    await bootPlugins(rigBoot({ fs: memoryFs(fsMap), audit: face }));
    expect(grantsPens(face)).toHaveLength(1);
  });

  it('开发态 plugin-dir 锚：试件目录在 fence 内 → 交集非空；试件行零落盘（不变式 1）', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    devRow(fsMap, '/data/wk/plugins/qtest', ['./assets']);
    const boot = await bootPlugins(rigBoot({ pluginFile: '/data/wk/plugins/qtest', fs: memoryFs(fsMap), audit: face }));
    expect(boot.report.activated.map((a) => a.id)).toEqual([QUICK_TEST_ROW_ID]);
    // 锚 = 插件目录（非 workspace）——交集相对试件目录求交后在 workspace-write
    // fence 根内（试件目录在 workspace 内），非空入账
    expect(boot.grantsOf(QUICK_TEST_ROW_ID)).toEqual({
      pluginId: QUICK_TEST_ROW_ID,
      anchor: 'plugin-dir',
      roots: ['/data/wk/plugins/qtest/assets'],
    });
    // durable 审计流零试件笔（--plugin-file 零落盘面——opens/lifecycle 同律滤除）
    expect(grantsPens(face)).toEqual([]);
  });

  it('开发态 plugin-dir 锚：插件目录在 fence 根外 = 交集恒空（布局事实非缺陷）', async () => {
    // homedir 下试件目录（真存在锚根、在 fence 三根之外——两平台皆然）
    const outside = join(homedir(), 'berry-agent-grants-outside');
    const fsMap: Record<string, string> = {};
    devRow(fsMap, outside, ['./assets']);
    const boot = await bootPlugins(rigBoot({ pluginFile: outside, fs: memoryFs(fsMap) }));
    expect(boot.grantsOf(QUICK_TEST_ROW_ID)).toEqual({ pluginId: QUICK_TEST_ROW_ID, anchor: 'plugin-dir', roots: [] });
  });

  it('read-only 档恒空交集（空面首记不落——无记录 ≡ 空面）', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', ['./assets']);
    const boot = await bootPlugins(
      rigBoot({ fs: memoryFs(fsMap), audit: face, grantsFence: { workspace: '/data/wk', mode: 'read-only' } }),
    );
    expect(boot.grantsOf('acme')).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: [] });
    expect(grantsPens(face)).toEqual([]);
  });

  it('danger 档全盘根交集非空（workspace 内申请面照入账——档位是裁决面）', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', ['./assets']);
    const boot = await bootPlugins(
      rigBoot({ fs: memoryFs(fsMap), audit: face, grantsFence: { workspace: '/data/wk', mode: 'danger' } }),
    );
    expect(boot.grantsOf('acme')).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] });
  });

  it('数据目录 carve-out 恒优先：锚定根落数据目录族即出交集（同 boot 对照——fence 内申请面出账）', async () => {
    // 真盘数据目录（mkdtemp）下开发态试件：试件目录在 tmpdir fence 根内
    // （workspace-write 含 tmpdir）——若无 carve-out 该申请面必入账；carve-out
    // （数据目录族任何档恒排除——04 §7 fence 条款）出交集。同 boot 装机行
    // （锚 workspace、不在数据目录内）对照入账——证明出账根因是 carve-out 非 fence。
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-agent-grants-carve-'));
    dirs.push(dataDir);
    const face = openFace();
    const fsMap: Record<string, string> = {};
    // 装机行挂真盘数据目录（enabled.yaml/账本随 dataDir 解析——与试件同根
    // 便于单 boot 对照；其锚仍是 workspace '/data/wk' 不受数据目录影响）
    installRow(fsMap, 'acme', ['./assets'], dataDir);
    devRow(fsMap, join(dataDir, 'plugins', 'qtest-carve'), ['./assets']);
    const boot = await bootPlugins(
      rigBoot({
        runtime: stubRuntime(dataDir),
        fs: memoryFs(fsMap),
        audit: face,
        pluginFile: join(dataDir, 'plugins', 'qtest-carve'),
      }),
    );
    expect(boot.report.activated.map((a) => a.id).sort()).toEqual([QUICK_TEST_ROW_ID, 'acme'].sort());
    // 开发态试件（锚定根在数据目录内）：carve-out 出交集——恒空
    expect(boot.grantsOf(QUICK_TEST_ROW_ID)).toEqual({ pluginId: QUICK_TEST_ROW_ID, anchor: 'plugin-dir', roots: [] });
    // 装机行（锚 workspace）：同 boot 对照入账非空——排除根因是 carve-out 而非 fence 收窄
    expect(boot.grantsOf('acme')).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] });
    expect(grantsOfRows(face, 'acme')).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] });
  });

  it('core: 行不豁免于账面纪律（段一无豁免面——core 引用行结构性无 grants 申请面）', async () => {
    const face = openFace();
    const applied: string[] = [];
    const ref: CorePluginReference = { name: 'demo', apply: async () => void applied.push('demo') };
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', ['./assets']);
    const boot = await bootPlugins(rigBoot({ corePlugins: [ref], fs: memoryFs(fsMap), audit: face }));
    expect(boot.report.activated.map((a) => a.id).sort()).toEqual(['acme', 'core:demo'].sort());
    // core 引用行无清单面——结构性无 grants 申请位（非豁免分支：段一无豁免
    // 面，§4.6 官方件豁免属段二执法闸事——本段只记不裁）
    expect(boot.grantsOf('core:demo')).toBeUndefined();
    // durable 账面只有磁盘行一笔——core 行零噪声
    expect(grantsPens(face)).toHaveLength(1);
    expect(grantsOfRows(face, 'acme')).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] });
  });
});

describe('canonical 形（05 §1.1 值律——roots 恒 canonical 绝对路径、清单原文不入载荷）', () => {
  it('./x ≡ x ≡ ./x/ 同锚同 canonical；多根排序去重；清单原文不入载荷', async () => {
    const face = openFace();
    const fsMap: Record<string, string> = {};
    installRow(fsMap, 'acme', ['./assets', 'assets', './assets/', './b', './a']);
    const boot = await bootPlugins(rigBoot({ fs: memoryFs(fsMap), audit: face }));
    // 三形同 canonical 去重为一；排序稳定；载荷里无 './assets' 等清单原文
    expect(boot.grantsOf('acme')?.roots).toEqual(['/data/wk/a', '/data/wk/assets', '/data/wk/b']);
    const durable = JSON.stringify(grantsOfRows(face, 'acme'));
    expect(durable).not.toContain('./');
    expect(grantsOfRows(face, 'acme')).toEqual({
      pluginId: 'acme',
      anchor: 'workspace',
      roots: ['/data/wk/a', '/data/wk/assets', '/data/wk/b'],
    });
  });
});

describe('plugin/grants 幂等落（recordPluginGrantsDiff——05 §1.1 行 80，律同 plugin/opens）', () => {
  it('首落：非空交集落实际面；空面首记不落（无记录 ≡ 空面——[] 笔恒为收口形）', () => {
    const face = openFace();
    recordPluginGrantsDiff(face, [
      { pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] },
      { pluginId: 'beta', anchor: 'workspace', roots: [] },
    ]);
    const recent = grantsPens(face);
    expect(recent).toHaveLength(1); // beta 空面零事实——不为从未获交集的插件造基线噪声
    expect(grantsOfRows(face, 'acme')).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] });
  });

  it('幂等：同锚同根再 diff 零新笔（有变才落——不重复记账）', () => {
    const face = openFace();
    const rows = [{ pluginId: 'acme', anchor: 'workspace' as const, roots: ['/data/wk/assets'] }];
    recordPluginGrantsDiff(face, rows);
    recordPluginGrantsDiff(face, rows); // 同面重放
    expect(grantsPens(face)).toHaveLength(1);
  });

  it('有变才落：根变落新条；锚切换（同根）亦落新条——diff 键 = anchor+roots 二元组', () => {
    const face = openFace();
    recordPluginGrantsDiff(face, [{ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] }]);
    // 根变（申请面扩容）→ 新条
    recordPluginGrantsDiff(face, [{ pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets', '/data/wk/b'] }]);
    expect(grantsPens(face)).toHaveLength(2);
    // 锚切换（同根集）——锚形切换亦是授予面变迁，如实入账 → 新条
    recordPluginGrantsDiff(face, [
      { pluginId: 'acme', anchor: 'plugin-dir', roots: ['/data/wk/assets', '/data/wk/b'] },
    ]);
    expect(grantsPens(face)).toHaveLength(3);
    expect(grantsOfRows(face, 'acme')).toEqual({
      pluginId: 'acme',
      anchor: 'plugin-dir',
      roots: ['/data/wk/assets', '/data/wk/b'],
    });
  });

  it('交集变空落 []；撤位收口（计划面缺席且尾条非空）；已空幂等不重放', () => {
    const face = openFace();
    recordPluginGrantsDiff(face, [
      { pluginId: 'acme', anchor: 'workspace', roots: ['/data/wk/assets'] },
      { pluginId: 'beta', anchor: 'workspace', roots: ['/data/wk/b'] },
    ]);
    // 交集变空（fence 收窄/清单撤位）→ [] 收口形
    recordPluginGrantsDiff(face, [
      { pluginId: 'acme', anchor: 'workspace', roots: [] },
      { pluginId: 'beta', anchor: 'workspace', roots: ['/data/wk/b'] },
    ]);
    expect(grantsOfRows(face, 'acme')).toEqual({ pluginId: 'acme', anchor: 'workspace', roots: [] });
    // 撤位（行删除/换装/拒载——计划面缺席）且尾条非空 → [] 收口
    recordPluginGrantsDiff(face, []);
    expect(grantsOfRows(face, 'beta')).toEqual({ pluginId: 'beta', anchor: 'workspace', roots: [] });
    // 已空再 diff——撤位笔不重放
    recordPluginGrantsDiff(face, []);
    expect(grantsPens(face)).toHaveLength(4); // 2 首记 + 1 变空 + 1 撤位
  });
});
