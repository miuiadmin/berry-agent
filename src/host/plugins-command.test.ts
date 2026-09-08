/**
 * host/plugins-command TUI 命令面测试——03 §5.8 三面同源之 TUI 面
 * （task #88 笔二）。
 *
 * 真盘 fixture（tmpdir 真链：行编辑真落盘 + 账本真读）；与 CLI 面
 * （plugins-cmd runRowVerb）的分立三面各自锁：成功尾自动链恰一次 /
 * 回执文案指向自动链 / 审计 sink 由装配方包装（纯逻辑件零包装责任）。
 * list 读内存投影（换代取值器语义——report 取值器换值即换面）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { PLUGINS_CMD_USAGE, runPluginsCommand } from './plugins-command.js';
import type { PluginsCommandDeps } from './plugins-command.js';
import type { LoadReport } from './loader.js';
import { createPluginStoreFs } from './plugin-store.js';
import type { LifecycleAuditSink, PluginStoreFs } from './plugin-store.js';

/** 最小 LoadReport 替身（unload no-op——命令面只读三分区投影） */
function fakeReport(
  activated: Array<{ id: string; skillDirs: string[] }>,
  failed: Array<{ id: string; code: string; message: string }>,
  skipped: Array<{ id: string; reason: string }>,
): LoadReport {
  return {
    activated,
    failed,
    skipped,
    unload: () => Promise.resolve({ disposed: [], failed: [] }),
  } as never; // 结构子集（activated/failed/skipped 三面即命令面消费全集）
}

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** 命令面 rig：审计/链两面全录（fs 真盘——行编辑真链） */
function rig(overrides: Partial<PluginsCommandDeps> & { dir?: string } = {}): {
  deps: PluginsCommandDeps;
  audits: Array<[string, Record<string, unknown>]>;
  reloads: () => number;
} {
  const audits: Array<[string, Record<string, unknown>]> = [];
  let reloads = 0;
  const fs: PluginStoreFs = createPluginStoreFs();
  const sink: LifecycleAuditSink = (type, data) => void audits.push([type, data]);
  const deps: PluginsCommandDeps = {
    dataDir: overrides.dir ?? tmpDir('plug-cmd-'),
    fs,
    auditSink: sink,
    requestReload: () => (reloads += 1),
    report: () => undefined,
    ...overrides,
  };
  return { deps, audits, reloads: () => reloads };
}

describe('用法与 list 读面', () => {
  it('未知动词 → 用法回执（含 install 指路 CLI 句）', () => {
    const rig_ = rig();
    const out = runPluginsCommand(['frobnicate'], rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain(PLUGINS_CMD_USAGE);
    expect(rig_.reloads()).toBe(0); // 零链
  });

  it('mount 缺 <id> → 用法错', () => {
    const rig_ = rig();
    const out = runPluginsCommand(['mount'], rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('缺 <id>');
    expect(rig_.reloads()).toBe(0);
  });

  it('list：报告投影三分区渲染（含技能目录行与失败分区）', () => {
    const rig_ = rig();
    const deps: PluginsCommandDeps = {
      ...rig_.deps,
      report: () =>
        fakeReport(
          [
            { id: 'core:demo', skillDirs: ['/a/skills', '/b/skills'] },
            { id: 'user-x', skillDirs: [] },
          ],
          [{ id: 'core:bad', code: 'PLUGIN_BOOT_FAILED', message: 'apply 崩' }],
          [{ id: 'core:off', reason: 'disabled' }],
        ),
    };
    const out = runPluginsCommand(['list'], deps);
    expect(out.ok).toBe(true);
    expect(out.text).toContain('启用（2）：');
    expect(out.text).toContain('core:demo  技能目录：/a/skills、/b/skills');
    expect(out.text).toContain('失败（1）：');
    expect(out.text).toContain('core:bad  [PLUGIN_BOOT_FAILED] apply 崩');
    expect(out.text).toContain('禁用（1）：');
    expect(out.text).toContain('core:off  disabled');
    expect(out.text).not.toContain('user-x  技能目录'); // 空技能目录不带尾注
    expect(out.text).toContain('user-x');
  });

  it('list：报告缺席（noPlugins 形）诚实呈现', () => {
    const rig_ = rig();
    const out = runPluginsCommand(['list'], rig_.deps);
    expect(out.ok).toBe(true);
    expect(out.text).toContain('装载面未装配');
  });

  it('纯 memory 诊断形（dataDir null）：写动词拒、list 放行', () => {
    const rig_ = rig();
    const deps: PluginsCommandDeps = { ...rig_.deps, dataDir: null };
    expect(runPluginsCommand(['mount', 'user-x'], deps).text).toContain('无数据目录');
    expect(runPluginsCommand(['list'], deps).ok).toBe(true);
  });
});

describe('mount 前置两查（与 CLI 同律）', () => {
  it('id 词法违例拒（大写）', () => {
    const rig_ = rig();
    const out = runPluginsCommand(['mount', 'Bad_Id'], rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('词法违例');
    expect(rig_.reloads()).toBe(0);
    expect(rig_.audits).toEqual([]); // 零审计
  });

  it('用户 id 未装机拒（指路 install）', () => {
    const dir = tmpDir('plug-cmd-noinstall-');
    const rig_ = rig({ dir });
    const out = runPluginsCommand(['mount', 'user-x'], rig_.deps);
    expect(out.ok).toBe(false);
    expect(out.text).toContain('未装机');
    expect(out.text).toContain('install');
    expect(rig_.reloads()).toBe(0);
  });

  it('装机在场过查：ledger 有行 → 行编辑成功链生效', () => {
    const dir = tmpDir('plug-cmd-installed-');
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(
      join(dir, 'plugins', 'ledger.json'),
      `${JSON.stringify(
        [
          {
            id: 'user-x',
            source: 'local',
            ref: 'local:/tmp/x',
            installedAt: '2026-09-09T00:00:00Z',
            installPath: '/tmp/x',
          },
        ],
        null,
        2,
      )}\n`,
      'utf8',
    );
    const rig_ = rig({ dir });
    const out = runPluginsCommand(['mount', 'user-x'], rig_.deps);
    expect(out.ok).toBe(true);
    expect(rig_.reloads()).toBe(1);
    expect(rig_.audits).toEqual([['plugin/mounted', { id: 'user-x' }]]);
  });

  it('core: 前缀豁免装机查（内置态天然在场）', () => {
    const rig_ = rig();
    const out = runPluginsCommand(['mount', 'core:demo'], rig_.deps);
    expect(out.ok).toBe(true); // core: 无需 ledger
    expect(rig_.audits).toEqual([['plugin/mounted', { id: 'core:demo' }]]);
  });
});

describe('写动词成功尾三面（自动链/审计/回执）', () => {
  it('mount：行真落盘 + 审计恰一笔 + 链恰一次 + 回执指向自动链', () => {
    const dir = tmpDir('plug-cmd-mount-');
    const rig_ = rig({ dir });
    const out = runPluginsCommand(['mount', 'core:demo'], rig_.deps);
    expect(out.ok).toBe(true);
    expect(out.text).toContain('已挂载：core:demo');
    expect(out.text).toContain('已自动链 /reload'); // TUI 面文案——与 CLI「下次启动生效」分立
    expect(out.text).not.toContain('下次启动');
    // 行真落盘（enabled.yaml 增行）
    const yaml = readFileSync(join(dir, 'enabled.yaml'), 'utf8');
    expect(yaml).toContain('core:demo');
    expect(rig_.reloads()).toBe(1);
    expect(rig_.audits).toEqual([['plugin/mounted', { id: 'core:demo' }]]);
  });

  it('toggle：禁用旗翻转（absent ↔ true）+ plugin/toggled 审计双态载荷', () => {
    const dir = tmpDir('plug-cmd-toggle-');
    const rig_ = rig({ dir });
    runPluginsCommand(['mount', 'core:demo'], rig_.deps); // 先挂行（absent 启用态）
    const out = runPluginsCommand(['toggle', 'core:demo'], rig_.deps);
    expect(out.ok).toBe(true);
    expect(out.text).toContain('已切换：core:demo');
    expect(rig_.audits).toEqual([
      ['plugin/mounted', { id: 'core:demo' }],
      ['plugin/toggled', { id: 'core:demo', disabled: true }], // 首翻 = 禁用
    ]);
    expect(readFileSync(join(dir, 'enabled.yaml'), 'utf8')).toContain('disabled: true');
    expect(rig_.reloads()).toBe(2); // 每成功动词恰一次
  });

  it('unmount：删行保装机 + plugin/unmounted 审计 + 行缺席 core: 指路 toggle', () => {
    const dir = tmpDir('plug-cmd-unmount-');
    const rig_ = rig({ dir });
    // 挂行（core: 豁免装机查）→ 卸下（行在场真删）
    runPluginsCommand(['mount', 'core:demo'], rig_.deps);
    const out = runPluginsCommand(['unmount', 'core:demo'], rig_.deps);
    expect(out.ok).toBe(true);
    expect(out.text).toContain('已卸下：core:demo（装机保留）');
    expect(rig_.audits).toEqual([
      ['plugin/mounted', { id: 'core:demo' }],
      ['plugin/unmounted', { id: 'core:demo' }],
    ]);
    expect(rig_.reloads()).toBe(2); // 每成功动词恰一次
    expect(readFileSync(join(dir, 'enabled.yaml'), 'utf8')).not.toContain('core:demo'); // 行已删
    // 行不在场的 core: 卸下 → 指路 toggle（内置态不可删）
    const again = runPluginsCommand(['unmount', 'core:demo'], rig_.deps);
    expect(again.ok).toBe(false);
    expect(again.text).toContain('内置全启无启用行可删');
    expect(again.text).toContain('toggle');
  });
});

describe('失败零副作用（无变更不造账不链）', () => {
  it('unmount core: 行不在场拒 → 零审计零链', () => {
    const rig_ = rig();
    const out = runPluginsCommand(['unmount', 'core:demo'], rig_.deps);
    expect(out.ok).toBe(false);
    expect(rig_.audits).toEqual([]);
    expect(rig_.reloads()).toBe(0);
  });

  it('unmount 用户 id 幂等跳过（已不在启用面）→ 成功但零审计（无变更不造账）', () => {
    const rig_ = rig();
    const out = runPluginsCommand(['unmount', 'user-x'], rig_.deps);
    expect(out.ok).toBe(true);
    expect(rig_.audits).toEqual([]); // 幂等跳过腿库件零调用——同 CLI 律
    expect(out.text).toContain('已卸下');
  });
});
