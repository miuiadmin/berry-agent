/**
 * host/plugin-tools 模型面工具族测试——03 §5.6 八件（task #89 笔三）。
 *
 * 单元面锁三件事：①面结构（八件在场/三档分级声明/审批对触发键）；②各工具
 * 参数→回执编舞（复用执行件的单源行为只锁接线面——install/update/uninstall
 * 深行为归各自测试文件）；③§5.6 执法律（模型面不自动链 reload 的回执词面 /
 * uninstall 只到 inspect / addedToolNames 通道恒在位值诚实空）。
 *
 * 真盘真库 fixture：行编辑与账本真落盘（plugin-store fs）；卸载预检用真
 * Persistence（HOST_MIGRATION_TAIL 全链——store_state/sqlite_master 面真在）；
 * events_query 的 flush/query 两窄面注入计数替身（纯接线面——真查询归
 * persist 测试）。spawn 假件零真网络（npm 腿只走失败/词法档，成功腿用
 * local 源零网络）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { AgentToolResult, ToolDefinition } from '../contracts/index.js';
import type { QueryEventsFilter, QueryEventsResult } from '../persist/index.js';
import { Persistence } from '../persist/index.js';

import type { LoadReport } from './loader.js';
import { createPluginLifecycleTools } from './plugin-tools.js';
import type { PluginLifecycleToolsDeps } from './plugin-tools.js';
import type { SpawnRunner } from './plugin-install.js';
import { upsertLedgerEntry } from './plugin-store.js';
import { createPluginStoreFs, readEnabledRowsForEdit } from './plugin-store.js';
import type { LifecycleAuditSink, PluginLedgerEntry } from './plugin-store.js';
import { HOST_MIGRATION_TAIL } from './runtime.js';

/** 测试根 tmp（vitest 每文件钉数据目录纪律——自管 tmp 收尾自清） */
const testRoot = mkdtempSync(join(tmpdir(), 'berry-plugin-tools-'));
afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(testRoot, prefix));
  return dir;
}

/** 最小 LoadReport 替身（unload no-op——list 只读三分区投影） */
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
  } as never; // 结构子集（三分区即本面消费全集）
}

/** 拒绝一切 spawn 的假件（成功腿全走 local 源零网络） */
const refuseSpawn: SpawnRunner = {
  run: (cmd) => Promise.reject(new Error(`测试不受理 spawn（${cmd}）——成功腿须走 local 源`)),
};

/** rig：deps 全受局（flush 计数 + queryEvents 替身 + 审计/账本真盘真库） */
function rig(overrides: Partial<PluginLifecycleToolsDeps> & { dir?: string } = {}): {
  deps: PluginLifecycleToolsDeps;
  tools: readonly ToolDefinition[];
  audits: Array<[string, Record<string, unknown>]>;
  flushes: () => number;
  queries: () => QueryEventsFilter[];
  close: () => void;
} {
  const dir = overrides.dir ?? tmpDir('rig-');
  const audits: Array<[string, Record<string, unknown>]> = [];
  let flushes = 0;
  const queried: QueryEventsFilter[] = [];
  const sink: LifecycleAuditSink = (type, data) => void audits.push([type, data]);
  // 真 Persistence（卸载预检 store_state/sqlite_master 面——HOST_MIGRATION_TAIL 全链）
  const persistence = Persistence.open({ dataDir: dir, migrations: HOST_MIGRATION_TAIL, warn: () => undefined });
  const deps: PluginLifecycleToolsDeps = {
    dataDir: dir,
    fs: createPluginStoreFs(),
    auditSink: sink,
    spawn: refuseSpawn,
    report: () => undefined,
    flush: () => {
      flushes += 1;
      return Promise.resolve();
    },
    queryEvents: (filter) => {
      queried.push(filter);
      return { events: [], nextCursor: null };
    },
    db: persistence.store.sqlite(),
    ...overrides,
  };
  return {
    deps,
    tools: createPluginLifecycleTools(deps),
    audits,
    flushes: () => flushes,
    queries: () => queried,
    close: () => persistence.close(),
  };
}

/** 工具按名取（缺位抛错——测试自证八件齐） */
function toolOf(tools: readonly ToolDefinition[], name: string): ToolDefinition {
  const found = tools.find((tool) => tool.name === name);
  if (found === undefined) throw new Error(`工具 ${name} 缺位`);
  return found;
}

/** 执行速记（空 toolCtx——本族无 per-session 消费面） */
async function run(tool: ToolDefinition, args: Record<string, unknown> = {}): Promise<AgentToolResult> {
  return tool.execute(args, { toolCallId: 'test' });
}

/** 回执文本速记（单 text content 形——本族恒单段） */
function textOf(result: AgentToolResult): string {
  return result.content[0]!.type === 'text' ? result.content[0]!.text : '';
}

/** 账本条目速记（npm 源形） */
function seedEntry(dir: string, id: string, overrides: Partial<PluginLedgerEntry> = {}): void {
  upsertLedgerEntry(
    dir,
    {
      id,
      source: 'npm',
      ref: `npm:${id}`,
      version: '1.0.0',
      installedAt: '2026-09-09T00:00:00.000Z',
      installPath: join('plugins', 'node_modules', id),
      declaredEvents: [],
      ...overrides,
    },
    createPluginStoreFs(),
  );
}

/** local 源 fixture（真目录 + 合法清单 + 入口零依赖——收割真跑零网络） */
function localFixture(name: string, pkgOverrides: Record<string, unknown> = {}): string {
  const dir = join(testRoot, 'fixtures', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    `${JSON.stringify({ name: `${name}-pkg`, version: '1.0.0', main: 'index.js', berryAgent: {}, ...pkgOverrides }, null, 2)}\n`,
  );
  writeFileSync(
    join(dir, 'index.js'),
    `export const events = ['${name}/event'];\nexport default function apply() {}\n`,
  );
  return dir;
}

describe('面结构（八件在场 + 三档分级声明锁）', () => {
  it('八件齐名（§5.6 表全列）', async () => {
    const rig_ = rig();
    try {
      expect(rig_.tools.map((tool) => tool.name)).toEqual([
        'plugins_list',
        'events_query',
        'plugin_uninstall_inspect',
        'plugin_install',
        'plugin_mount',
        'plugin_unmount',
        'plugin_toggle',
        'plugin_update',
      ]);
    } finally {
      rig_.close();
    }
  });

  it('分级声明：只读三件 effect read、写类五件 effect write（审批对触发键——§5.6 钉死成对）', async () => {
    const rig_ = rig();
    try {
      for (const name of ['plugins_list', 'events_query', 'plugin_uninstall_inspect']) {
        expect(toolOf(rig_.tools, name).effect).toBe('read');
      }
      for (const name of ['plugin_install', 'plugin_mount', 'plugin_unmount', 'plugin_toggle', 'plugin_update']) {
        expect(toolOf(rig_.tools, name).effect).toBe('write');
      }
    } finally {
      rig_.close();
    }
  });

  it('plugin_toggle repeatable false（翻旗标非幂等——重放即翻回）；install/update 长动作帽在位', async () => {
    const rig_ = rig();
    try {
      expect(toolOf(rig_.tools, 'plugin_toggle').repeatable).toBe(false);
      expect(toolOf(rig_.tools, 'plugin_mount').repeatable).toBeUndefined(); // 幂等族走缺省
      expect(toolOf(rig_.tools, 'plugin_install').timeoutMs).toBe(600_000);
      expect(toolOf(rig_.tools, 'plugin_update').timeoutMs).toBe(600_000);
    } finally {
      rig_.close();
    }
  });
});

describe('plugins_list 四态（装载真源 = 内存报告；装机真源 = 磁盘账本）', () => {
  it('四态全谱 + source 徽标（core/npm/git + 查无 ?）', async () => {
    const dir = tmpDir('list-full-');
    seedEntry(dir, 'user-x', { source: 'npm' });
    seedEntry(dir, 'user-y', { source: 'git', ref: 'git:https://x/y.git' });
    const rig_ = rig({
      dir,
      report: () =>
        fakeReport(
          [
            { id: 'core:demo', skillDirs: [] },
            { id: 'user-x', skillDirs: [] },
          ],
          [{ id: 'core:bad', code: 'PLUGIN_BOOT_FAILED', message: 'apply 崩' }],
          [{ id: 'core:off', reason: 'disabled' }],
        ),
    });
    try {
      const result = await run(toolOf(rig_.tools, 'plugins_list'));
      expect(result.isError).not.toBe(true);
      const text = textOf(result);
      expect(text).toContain('mounted（2）');
      expect(text).toContain('core:demo  [core]');
      expect(text).toContain('user-x  [npm]');
      expect(text).toContain('mounted-disabled（1）');
      expect(text).toContain('core:off  [core]  disabled');
      expect(text).toContain('failed（1）');
      expect(text).toContain('core:bad  [core]  [PLUGIN_BOOT_FAILED] apply 崩');
      expect(text).toContain('installed-unmounted（1）');
      expect(text).toContain('user-y  [git]');
    } finally {
      rig_.close();
    }
  });

  it('noPlugins 形（report undefined）：装载分区诚实缺席 + 装机面照呈', async () => {
    const dir = tmpDir('list-noplugins-');
    seedEntry(dir, 'user-x');
    const rig_ = rig({ dir, report: () => undefined });
    try {
      const text = textOf(await run(toolOf(rig_.tools, 'plugins_list')));
      expect(text).toContain('装载面未装配');
      expect(text).toContain('installed-unmounted（1）');
      expect(text).toContain('user-x  [npm]');
    } finally {
      rig_.close();
    }
  });

  it('坏账本：installed-unmounted 分区诚实缺席（不虚构）+ 徽标降 ?（core: 照判）', async () => {
    const dir = tmpDir('list-badledger-');
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(join(dir, 'plugins', 'ledger.json'), '{ Oops', 'utf8');
    const rig_ = rig({
      dir,
      report: () =>
        fakeReport(
          [
            { id: 'core:demo', skillDirs: [] },
            { id: 'user-x', skillDirs: [] },
          ],
          [],
          [],
        ),
    });
    try {
      const text = textOf(await run(toolOf(rig_.tools, 'plugins_list')));
      expect(text).toContain('core:demo  [core]');
      expect(text).toContain('user-x  [?]');
      expect(text).toContain('installed-unmounted：缺席');
    } finally {
      rig_.close();
    }
  });
});

describe('events_query（flushFirst 恒 true + ISO 8601 + 摘要截断）', () => {
  it('查询前 flush 恰一次 + 过滤维全维透传', async () => {
    const rig_ = rig();
    try {
      const result = await run(toolOf(rig_.tools, 'events_query'), {
        session_id: 'sess-1',
        types: ['turn/end'],
        since: '2026-09-09T00:00:00Z',
        until: '2026-09-09T12:00:00Z',
        limit: 50,
      });
      expect(result.isError).not.toBe(true);
      expect(rig_.flushes()).toBe(1);
      expect(rig_.queries()).toEqual([
        {
          sessionId: 'sess-1',
          types: ['turn/end'],
          sinceMs: Date.parse('2026-09-09T00:00:00Z'),
          untilMs: Date.parse('2026-09-09T12:00:00Z'),
          limit: 50,
        },
      ]);
    } finally {
      rig_.close();
    }
  });

  it('渲染：事件行三列 + data 摘要 ~300 截断 + nextCursor 续页尾', async () => {
    const dir = tmpDir('eq-render-');
    const longData = { blob: 'x'.repeat(500) };
    let queried = 0;
    const rig_ = rig({
      dir,
      queryEvents: () => {
        queried += 1;
        return {
          events: [
            { type: 'turn/end', seq: 3, time: Date.parse('2026-09-09T12:00:00Z'), data: longData },
            { type: 'plugin/mounted', seq: 4, time: Date.parse('2026-09-09T12:01:00Z'), data: { id: 'user-x' } },
          ],
          nextCursor: 'cursor-token',
        } as QueryEventsResult;
      },
    });
    try {
      const text = textOf(await run(toolOf(rig_.tools, 'events_query')));
      expect(queried).toBe(1);
      expect(text).toContain('（2 条）');
      expect(text).toContain(`3  ${new Date(Date.parse('2026-09-09T12:00:00Z')).toISOString()}  turn/end`);
      expect(text).toContain('…（截断）');
      expect(text).toContain('4  ');
      expect(text).toContain('plugin/mounted');
      expect(text).toContain('nextCursor: cursor-token');
    } finally {
      rig_.close();
    }
  });

  it('坏 ISO 时窗：快拒 isError——零 flush 零查询（词形先行）', async () => {
    const rig_ = rig();
    try {
      const result = await run(toolOf(rig_.tools, 'events_query'), { since: 'not-a-date' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('非法 ISO 8601');
      expect(rig_.flushes()).toBe(0);
      expect(rig_.queries()).toEqual([]);
    } finally {
      rig_.close();
    }
  });

  it('零事件诚实空 + 空结果同样 flushFirst（在飞事件先落盘再判空）', async () => {
    const rig_ = rig();
    try {
      const text = textOf(await run(toolOf(rig_.tools, 'events_query')));
      expect(text).toContain('零事件');
      expect(rig_.flushes()).toBe(1);
    } finally {
      rig_.close();
    }
  });
});

describe('plugin_uninstall_inspect（§5.5——模型面只到 inspect 为止）', () => {
  it('core: 前缀专报非 uninstall 对象（指路 toggle）', async () => {
    const rig_ = rig();
    try {
      const result = await run(toolOf(rig_.tools, 'plugin_uninstall_inspect'), { id: 'core:demo' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('非 uninstall 对象');
      expect(textOf(result)).toContain('toggle');
    } finally {
      rig_.close();
    }
  });

  it('装机在场：UninstallReport 全量呈报（含 execute 指路 CLI 句——人面独占锁）', async () => {
    const dir = tmpDir('inspect-ok-');
    seedEntry(dir, 'user-x');
    const rig_ = rig({ dir });
    try {
      const result = await run(toolOf(rig_.tools, 'plugin_uninstall_inspect'), { id: 'user-x' });
      expect(result.isError).not.toBe(true);
      const text = textOf(result);
      expect(text).toContain('卸载预检（inspect）：user-x');
      expect(text).toContain('源：npm');
      expect(text).toContain('execute 走 --confirm（人面独占）');
    } finally {
      rig_.close();
    }
  });

  it('未装机 isError（uninstall 吃装机 id）', async () => {
    const rig_ = rig();
    try {
      const result = await run(toolOf(rig_.tools, 'plugin_uninstall_inspect'), { id: 'user-ghost' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('未装机');
    } finally {
      rig_.close();
    }
  });
});

describe('plugin_install（三源装机——执行件单源复用，此处锁接线面）', () => {
  it('local 源成功：回执已装机 + 审计 plugin/installed + addedToolNames 诚实空（§2.8）', async () => {
    const dir = tmpDir('install-local-');
    const src = localFixture('inst-demo');
    const rig_ = rig({ dir });
    try {
      const result = await run(toolOf(rig_.tools, 'plugin_install'), { ref: `local:${src}` });
      expect(result.isError).not.toBe(true);
      expect(textOf(result)).toContain('已装机');
      expect(textOf(result)).toContain('装机零生效');
      expect(result.addedToolNames).toEqual([]); // 通道在位值诚实空（§5.4 装机零生效）
      expect(rig_.audits).toEqual([
        ['plugin/installed', { id: 'inst-demo-pkg', source: 'local', version: '1.0.0' }], // id 缺省 = name
      ]);
    } finally {
      rig_.close();
    }
  });

  it('ref 词法坏：isError 快拒（无前缀不猜源）', async () => {
    const rig_ = rig();
    try {
      const result = await run(toolOf(rig_.tools, 'plugin_install'), { ref: 'acme-widgets' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('源前缀');
      expect(rig_.audits).toEqual([]);
    } finally {
      rig_.close();
    }
  });
});

describe('plugin_mount（前置两查 + 撞名拒 + 指路 /reload）', () => {
  it('装机在场过查：行真落盘（含 config）+ 审计 + 回执指路 /reload 不自动链', async () => {
    const dir = tmpDir('mount-ok-');
    seedEntry(dir, 'user-x');
    const rig_ = rig({ dir });
    try {
      const result = await run(toolOf(rig_.tools, 'plugin_mount'), { id: 'user-x', config: { key: 'v' } });
      expect(result.isError).not.toBe(true);
      const text = textOf(result);
      expect(text).toContain('已挂载：user-x');
      expect(text).toContain('/reload'); // 模型面指路句
      expect(text).not.toContain('已自动链'); // 与 TUI 面文案分立锁（§5.2）
      expect(rig_.audits).toEqual([['plugin/mounted', { id: 'user-x' }]]);
      // config 真落行
      const rows = readEnabledRowsForEdit(dir, createPluginStoreFs());
      expect(rows.ok && rows.rows[0]).toMatchObject({ id: 'user-x', config: { key: 'v' } });
    } finally {
      rig_.close();
    }
  });

  it('撞名拒（已有行含禁用行）——改配置指路 unmount 后重 mount', async () => {
    const dir = tmpDir('mount-clash-');
    seedEntry(dir, 'user-x');
    const rig_ = rig({ dir });
    try {
      await run(toolOf(rig_.tools, 'plugin_mount'), { id: 'user-x' });
      const again = await run(toolOf(rig_.tools, 'plugin_mount'), { id: 'user-x' });
      expect(again.isError).toBe(true);
      expect(textOf(again)).toContain('撞名');
      expect(textOf(again)).toContain('unmount');
    } finally {
      rig_.close();
    }
  });

  it('前置两查拒形：词法违例 / 未装机指路 install / core: 豁免装机查', async () => {
    const rig_ = rig();
    try {
      const bad = await run(toolOf(rig_.tools, 'plugin_mount'), { id: 'Bad_Id' });
      expect(bad.isError).toBe(true);
      expect(textOf(bad)).toContain('词法违例');
      const ghost = await run(toolOf(rig_.tools, 'plugin_mount'), { id: 'user-ghost' });
      expect(ghost.isError).toBe(true);
      expect(textOf(ghost)).toContain('未装机');
      expect(textOf(ghost)).toContain('plugin_install'); // 模型面指路词
      const core = await run(toolOf(rig_.tools, 'plugin_mount'), { id: 'core:demo' });
      expect(core.isError).not.toBe(true); // core: 豁免查账
    } finally {
      rig_.close();
    }
  });
});

describe('plugin_unmount / plugin_toggle（行编辑族 + 终态回读）', () => {
  it('unmount core: 行不在场拒（指路 toggle）；用户 id 幂等零审计', async () => {
    const rig_ = rig();
    try {
      const core = await run(toolOf(rig_.tools, 'plugin_unmount'), { id: 'core:demo' });
      expect(core.isError).toBe(true);
      expect(textOf(core)).toContain('toggle');
      const user = await run(toolOf(rig_.tools, 'plugin_unmount'), { id: 'user-x' });
      expect(user.isError).not.toBe(true);
      expect(textOf(user)).toContain('已卸下');
      expect(rig_.audits).toEqual([]); // 幂等跳过零审计（无变更不造账）
    } finally {
      rig_.close();
    }
  });

  it('toggle 两翻：回执终态诚实（禁用→启用）+ 审计双态载荷', async () => {
    const rig_ = rig();
    try {
      const first = await run(toolOf(rig_.tools, 'plugin_toggle'), { id: 'core:demo' });
      expect(textOf(first)).toContain('禁用态 → 禁用');
      const second = await run(toolOf(rig_.tools, 'plugin_toggle'), { id: 'core:demo' });
      expect(textOf(second)).toContain('禁用态 → 启用');
      expect(rig_.audits).toEqual([
        ['plugin/toggled', { id: 'core:demo', disabled: true }],
        ['plugin/toggled', { id: 'core:demo', disabled: false }],
      ]);
    } finally {
      rig_.close();
    }
  });
});

describe('plugin_update（按源分派——执行件单源复用）', () => {
  it('未装机 isError 无可更新', async () => {
    const rig_ = rig();
    try {
      const result = await run(toolOf(rig_.tools, 'plugin_update'), { id: 'user-ghost' });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain('未装机');
    } finally {
      rig_.close();
    }
  });

  it('local 源 no-op 成功 + /reload 指路尾', async () => {
    const dir = tmpDir('update-local-');
    const src = localFixture('upd-demo');
    seedEntry(dir, 'upd-demo-pkg', { source: 'local', ref: `local:${src}`, installPath: src }); // id = name 缺省
    const rig_ = rig({ dir });
    try {
      const result = await run(toolOf(rig_.tools, 'plugin_update'), { id: 'upd-demo-pkg' });
      expect(result.isError).not.toBe(true);
      expect(textOf(result)).toContain('直引不拷贝');
      expect(textOf(result)).toContain('/reload');
    } finally {
      rig_.close();
    }
  });
});

describe('纯 memory 诊断形（dataDir null）诚实拒', () => {
  it('写类/装机/预检动词拒；list 与 events_query 不经此形装配（消费位缺席）', async () => {
    const rig_ = rig({ dataDir: null, dir: tmpDir('memory-anchor-') });
    try {
      for (const [name, args] of [
        ['plugin_mount', { id: 'core:demo' }],
        ['plugin_unmount', { id: 'core:demo' }],
        ['plugin_toggle', { id: 'core:demo' }],
        ['plugin_install', { ref: 'npm:x' }],
        ['plugin_update', { id: 'x' }],
        ['plugin_uninstall_inspect', { id: 'x' }],
      ] as const) {
        const result = await run(toolOf(rig_.tools, name), { ...args });
        expect(result.isError, name).toBe(true);
        expect(textOf(result), name).toContain('纯 memory');
      }
    } finally {
      rig_.close();
    }
  });
});
