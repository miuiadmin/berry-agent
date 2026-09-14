/**
 * host/quick-test —— `--plugin-file` 快速试件八不变式（03 §7）。
 *
 * 生态启动批 eco-3a 测试先行笔（落码前必红——防实现倒挂）：八不变式逐条
 * 锁优先序与语义边界；真盘真 jiti（试件插件目录真盘写就，装载管线全真）。
 * 不变式 7（dump-config 互斥）在 cli.test.ts 解析层；不变式 4（/reload
 * 丢失）的装配侧结构事实 = reapply 闭包恒以 runBoot(false) 单参调用
 * （assembly.ts 不传 pluginFile——类型可选 + 调用点唯一性双保证），本件
 * 锁其语义基元：options.pluginFile 缺席时零合成。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { BaseError } from '../contracts/index.js';
import { EventDispatch, Scope } from '../context/index.js';

import { bootPlugins } from './plugin-boot.js';
import type { PluginBootOptions } from './plugin-boot.js';
import type { HostRuntime } from './runtime.js';

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** HostRuntime 结构化替身（plugin-boot.test 同形——装配序只消费 dataDir/registerCloser） */
function stubRuntime(
  dataDir: string | null,
): HostRuntime & { closers: Array<{ label: string; fn: () => Promise<void> }> } {
  const closers: Array<{ label: string; fn: () => Promise<void> }> = [];
  return {
    memory: dataDir === null,
    dataDir,
    closers,
    persistence: {} as HostRuntime['persistence'],
    abortSignal: new AbortController().signal,
    disclosure: () => null,
    registerCloser: (closer) => closers.push(closer as { label: string; fn: () => Promise<void> }),
    registerShutdownHook: () => undefined,
    registerDisposer: () => undefined,
    shutdown: async () => undefined,
    writeCrashLog: () => undefined,
  };
}

/** 装配选项速记（真盘 fs——jiti 真求值；warn 收集供装载门诊断面断言） */
function rigBoot(
  dataDir: string | null,
  overrides: Partial<PluginBootOptions> = {},
): { options: PluginBootOptions; dispatch: EventDispatch; warnings: string[] } {
  const dispatch = new EventDispatch();
  const warnings: string[] = [];
  const options: PluginBootOptions = {
    runtime: stubRuntime(dataDir),
    scope: Scope.createRoot(),
    dispatch,
    commands: { register: () => () => undefined },
    llm: { registerProvider: () => () => undefined },
    version: '9.9.9-test',
    warn: (message) => warnings.push(message),
    ...overrides,
  };
  return { options, dispatch, warnings };
}

/** 真盘试件插件目录速记（目录形——含真清单 + entry） */
function makeQuickPluginDir(manifestBlock: Record<string, unknown> = { entry: 'entry.js' }): string {
  const dir = mkdtempSync(join(tmpdir(), 'host-quick-test-'));
  dirs.push(dir);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'quick-demo', version: '1.0.0', berryAgent: manifestBlock }),
  );
  writeFileSync(
    join(dir, 'entry.js'),
    ['export const inject = [];', 'export default async () => undefined;'].join('\n'),
  );
  return dir;
}

describe('quick-test 八不变式（03 §7——测试先行，落码前必红）', () => {
  it('不变式 1+2：纯内存注入 _quick_test 行 + 同装载管线（真 jiti 装载/注册动词真达/零落盘/退出即消失）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'host-quick-boot-'));
    dirs.push(dataDir);
    const pluginDir = makeQuickPluginDir({ entry: 'entry.js' });
    writeFileSync(
      join(pluginDir, 'entry.js'),
      [
        'export const inject = [];',
        'export default async (ctx) => {',
        '  ctx.channels.registerCommand("quick-hello", () => {}, "试件命令");',
        '};',
      ].join('\n'),
    );
    const registered: string[] = [];
    const { options } = rigBoot(dataDir, {
      commands: {
        register: (name) => {
          registered.push(name);
          return () => undefined;
        },
      },
      pluginFile: pluginDir,
    });
    const boot = await bootPlugins(options);
    // 行 id 固定 _quick_test（装载计划保留字——非插件身份位）
    expect(boot.report.activated.map((a) => a.id)).toEqual(['_quick_test']);
    expect(boot.report.failed).toEqual([]);
    // 同装载管线：真 jiti 求值 + ctx 注册动词真达（禁专用旁路）
    expect(registered).toEqual(['quick-hello']);
    // 零落盘：enabled.yaml 与 ledger.json 皆不因试件而写（纯内存注入）
    expect(exists(join(dataDir, 'enabled.yaml'))).toBe(false);
    expect(exists(join(dataDir, 'plugins', 'ledger.json'))).toBe(false);
    // 退出即消失：不带 pluginFile 再 boot 同一数据目录——试件行不再合成
    const second = await bootPlugins(rigBoot(dataDir).options);
    expect(second.report.activated).toEqual([]);
  });

  it('不变式 3a：路径不存在 = 响亮报错拒启（fail-loud，message 指路两形）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'host-quick-miss-'));
    dirs.push(dataDir);
    try {
      await bootPlugins(rigBoot(dataDir, { pluginFile: join(dataDir, 'nope') }).options);
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('PLUGIN_ROW_INVALID');
        expect(err.message).toContain('插件目录');
        expect(err.message).toContain('单文件入口');
        return;
      }
      throw err;
    }
  });

  it('不变式 3b：单文件入口形（无 package.json 裸 entry）= 合成隐式清单装载成功', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'host-quick-file-'));
    dirs.push(dataDir);
    writeFileSync(
      join(dataDir, 'lone-entry.js'),
      ['export const inject = [];', 'export default async () => undefined;'].join('\n'),
    );
    const boot = await bootPlugins(rigBoot(dataDir, { pluginFile: join(dataDir, 'lone-entry.js') }).options);
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['_quick_test']);
  });

  it('不变式 5：--no-plugins 优先——两者同给安全模式胜（坏路径亦不炸）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'host-quick-safe-'));
    dirs.push(dataDir);
    const boot = await bootPlugins(rigBoot(dataDir, { pluginFile: join(dataDir, 'nope'), noPlugins: true }).options);
    expect(boot.report.activated).toEqual([]); // 装载面整跳——逃生门不被试件顶掉
    expect(boot.counts).toEqual({ total: 0, enabled: 0, failed: 0 });
  });

  it('不变式 6：注入 id（清单声明值）撞已装插件 = 启动断言 PLUGIN_ROW_INVALID', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'host-quick-clash-'));
    dirs.push(dataDir);
    // 已装插件 acme-dup（真盘行——账本 + 启用行）
    const installed = join(dataDir, 'plugins', 'node_modules', 'acme-dup');
    mkdirSync(installed, { recursive: true });
    writeFileSync(
      join(installed, 'package.json'),
      JSON.stringify({ name: 'acme-dup', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    );
    writeFileSync(join(installed, 'entry.js'), 'export default async () => undefined;');
    writeFileSync(join(dataDir, 'enabled.yaml'), 'plugins:\n  - id: acme-dup\n');
    writeFileSync(
      join(dataDir, 'plugins', 'ledger.json'),
      JSON.stringify({ 'acme-dup': { installPath: 'plugins/node_modules/acme-dup' } }),
    );
    // 试件清单声明同 id（name 缺省 = 声明值）→ 冒名顶替拒启
    const quickDir = makeQuickPluginDir({ entry: 'entry.js' });
    writeFileSync(
      join(quickDir, 'package.json'),
      JSON.stringify({ name: 'acme-dup', version: '0.0.1', berryAgent: { entry: 'entry.js' } }),
    );
    try {
      await bootPlugins(rigBoot(dataDir, { pluginFile: quickDir }).options);
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('PLUGIN_ROW_INVALID');
        expect(err.message).toContain('acme-dup');
        expect(err.message).toContain('撞名');
        return;
      }
      throw err;
    }
  });

  it('不变式 6 单文件形：注入 id = 保留字（合法插件结构性不可能持此名）恒不撞', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'host-quick-lone-'));
    dirs.push(dataDir);
    writeFileSync(join(dataDir, 'solo.js'), 'export default async () => undefined;');
    const boot = await bootPlugins(rigBoot(dataDir, { pluginFile: join(dataDir, 'solo.js') }).options);
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.activated.map((a) => a.id)).toEqual(['_quick_test']);
  });

  it('不变式 8：api 装载门同律——api 块在场时试件行与磁盘行同态裁决（无判据分叉）', async () => {
    // 装载门已接线（ag 批——adjudicateApiGate 装载循环逐行裁决）：本例原
    // 「两行皆过」现状锁随接线同笔翻档（min 99.0 > 宿主 1.0 → 两行同进
    // failed 携 API_VERSION_MISMATCH——:204 挂账注记就此兑销，同态裁决不变式
    // 仍锁「无分叉」：试件行不得因试件身份被私设额外拒载或额外豁免）。
    const dataDir = mkdtempSync(join(tmpdir(), 'host-quick-api-'));
    dirs.push(dataDir);
    // 磁盘行 acme 携 api 块（min 99.0 形状合法、版本高于宿主）
    const installed = join(dataDir, 'plugins', 'node_modules', 'acme-api');
    mkdirSync(installed, { recursive: true });
    writeFileSync(
      join(installed, 'package.json'),
      JSON.stringify({
        name: 'acme-api',
        version: '1.0.0',
        berryAgent: { entry: 'entry.js', api: { minApiVersion: '99.0' } },
      }),
    );
    writeFileSync(join(installed, 'entry.js'), 'export default async () => undefined;');
    writeFileSync(join(dataDir, 'enabled.yaml'), 'plugins:\n  - id: acme-api\n');
    writeFileSync(
      join(dataDir, 'plugins', 'ledger.json'),
      JSON.stringify({ 'acme-api': { installPath: 'plugins/node_modules/acme-api' } }),
    );
    // 试件行携同一 api 块——两行同态（同进 activated 或同进 failed，无分叉）
    const quickDir = makeQuickPluginDir({ entry: 'entry.js', api: { minApiVersion: '99.0' } });
    const boot = await bootPlugins(rigBoot(dataDir, { pluginFile: quickDir }).options);
    const diskAcme = boot.report.activated.some((a) => a.id === 'acme-api');
    const quickRow = boot.report.activated.some((a) => a.id === '_quick_test');
    expect(diskAcme).toBe(quickRow); // 同态裁决——分叉即违不变式 8
    expect(quickRow).toBe(false); // 装载门已接线：min 99.0 > 宿主 1.0——两行同拒（ag 批同笔翻档）
    // 同进 failed 分区携 API_VERSION_MISMATCH（三段 message 直呈——行级隔离不拒启）
    expect(boot.report.failed.map((f) => f.id).sort()).toEqual(['_quick_test', 'acme-api']);
    expect(boot.report.failed.every((f) => f.code === 'API_VERSION_MISMATCH')).toBe(true);
  });

  it('装载门出口 1：磁盘行 min 1.5 宿主 1.0 → failed 分区行级隔离（三段 message 直呈）', async () => {
    // ag 批接线红证锚点②（立项档 §四——修前已录红：接线前本行照常进
    // activated）；接线后 = failed 分区 + 行级隔离
    const dataDir = mkdtempSync(join(tmpdir(), 'host-quick-gate-red-'));
    dirs.push(dataDir);
    const installed = join(dataDir, 'plugins', 'node_modules', 'acme-future');
    mkdirSync(installed, { recursive: true });
    writeFileSync(
      join(installed, 'package.json'),
      JSON.stringify({
        name: 'acme-future',
        version: '2.0.0',
        berryAgent: { entry: 'entry.js', api: { minApiVersion: '1.5' } },
      }),
    );
    writeFileSync(join(installed, 'entry.js'), 'export default async () => undefined;');
    writeFileSync(join(dataDir, 'enabled.yaml'), 'plugins:\n  - id: acme-future\n');
    writeFileSync(
      join(dataDir, 'plugins', 'ledger.json'),
      JSON.stringify({ 'acme-future': { installPath: 'plugins/node_modules/acme-future' } }),
    );
    const boot = await bootPlugins(rigBoot(dataDir).options);
    // 拒载行进 failed 分区（不 fail-loud 拒启——行级隔离）
    expect(boot.report.activated).toEqual([]);
    const fail = boot.report.failed.find((f) => f.id === 'acme-future');
    expect(fail?.code).toBe('API_VERSION_MISMATCH');
    // 三段 message 直呈（expected/actual/升级指引——03 §8.9 红形态）
    expect(fail?.message).toContain('minApiVersion 1.5');
    expect(fail?.message).toContain('宿主 API 面版本 1.0');
    expect(fail?.message).toContain('升级指引');
    expect(fail?.message).toContain('COMPATIBILITY.md');
    expect(boot.counts).toEqual({ total: 1, enabled: 0, failed: 1 }); // 拒载行不入 enabled（失败非启用）
  });

  it('装载门出口 4：api 块缺席 → boot 诊断面聚合一条 legacy warn（per boot 一次、N 缺块聚一条）', async () => {
    // ag 批接线红证锚点③（立项档 §四——修前已录红：聚合 warn 未落时零 warn）；
    // 接线后 = 磁盘行与试件行各缺 api 块，boot 诊断面恰一条聚合 warn 点名两行
    // （不进 durable 账——容忍态非失败）。
    const dataDir = mkdtempSync(join(tmpdir(), 'host-quick-legacy-red-'));
    dirs.push(dataDir);
    const installed = join(dataDir, 'plugins', 'node_modules', 'acme-old');
    mkdirSync(installed, { recursive: true });
    writeFileSync(
      join(installed, 'package.json'),
      JSON.stringify({ name: 'acme-old', version: '1.0.0', berryAgent: { entry: 'entry.js' } }),
    );
    writeFileSync(join(installed, 'entry.js'), 'export default async () => undefined;');
    writeFileSync(join(dataDir, 'enabled.yaml'), 'plugins:\n  - id: acme-old\n');
    writeFileSync(
      join(dataDir, 'plugins', 'ledger.json'),
      JSON.stringify({ 'acme-old': { installPath: 'plugins/node_modules/acme-old' } }),
    );
    // 试件行同缺 api 块（目录形缺省——两行同态触发聚一条）
    const quickDir = makeQuickPluginDir({ entry: 'entry.js' });
    const { options, warnings } = rigBoot(dataDir, { pluginFile: quickDir });
    const boot = await bootPlugins(options);
    // 容忍态照常装载（legacy 不拒载——点火前）
    expect(boot.report.activated.map((a) => a.id).sort()).toEqual(['_quick_test', 'acme-old']);
    expect(boot.report.failed).toEqual([]);
    // per boot 恰一条聚合 warn：N 缺块聚一条、两 id 齐点名
    const legacyWarns = warnings.filter((w) => w.includes('api 块'));
    expect(legacyWarns).toHaveLength(1);
    expect(legacyWarns[0]).toContain('acme-old');
    expect(legacyWarns[0]).toContain('_quick_test');
  });

  it('试件清单坏形 = 响亮拒启（试件显式指定——不静默隔离）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'host-quick-shape-'));
    dirs.push(dataDir);
    const bad = mkdtempSync(join(tmpdir(), 'host-quick-bad-'));
    dirs.push(bad);
    writeFileSync(join(bad, 'package.json'), JSON.stringify({ name: 'bad-quick', berryAgent: { entrytypo: 'x' } }));
    try {
      await bootPlugins(rigBoot(dataDir, { pluginFile: bad }).options);
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('PLUGIN_ROW_INVALID');
        expect(err.message).toContain('entrytypo');
        return;
      }
      throw err;
    }
  });
});

/** 文件在场判定（零落盘断言用） */
function exists(path: string): boolean {
  try {
    readFileSync(path, 'utf8');
    return true;
  } catch {
    return false;
  }
}
