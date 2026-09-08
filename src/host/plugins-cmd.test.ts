/**
 * host/plugins-cmd 子命令族测试——list 同构装载 / check 纯只读骨架 / 写侧
 * 六动词真链 e2e（07 §5 命令族语义；成熟度缺口 #10 装机面落码批写真身）。
 *
 * list 走 assembly 公共段（memory 同构诊断形——与 dump-config 同一合成代码
 * 路径）；check 零装配直读装机账本；写侧动词走 local fixture 真链——install
 * 真收割 → mount/toggle/unmount 行编辑 → uninstall 双相（inspect/execute），
 * spawn 注假件零真网络、Persistence 真开 tmp 数据目录。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { runPluginsEntry } from './plugins-cmd.js';
import type { CorePluginReference } from './loader.js';

/** 临时数据目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 新临时目录速记 */
function tmpDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 输出面速记（捕获行族） */
function capture(): { out: string[]; err: string[]; writeOut: (t: string) => void; writeErr: (t: string) => void } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, writeOut: (t) => void out.push(t), writeErr: (t) => void err.push(t) };
}

describe('plugins list——同构装载态清单（三分区）', () => {
  it('三分区齐活：core 件启用 + disabled 覆盖行入禁用区 + 磁盘行无账本入失败区', async () => {
    const dir = tmpDir('plug-list-3zone-');
    // core:two 被 enabled.yaml disabled 行覆盖（overlay 字段级后写胜出）；
    // user-x 磁盘行无装机账本——两路失败/禁用各有来源
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins:\n  - id: core:two\n    disabled: true\n  - id: user-x\n');
    const one: CorePluginReference = { name: 'one', apply: async () => undefined };
    const two: CorePluginReference = { name: 'two', apply: async () => undefined };
    const io = capture();
    const code = await runPluginsEntry({ sub: 'list' }, { version: 'x', dataDir: dir, corePlugins: [one, two], ...io });
    expect(code).toBe(0);
    const text = io.out.join('\n');
    expect(text).toContain('启用（1）：');
    expect(text).toContain('core:one');
    expect(text).toContain('禁用（1）：');
    expect(text).toContain('core:two');
    expect(text).toContain('disabled（启用行禁用位）'); // 禁用 reason 字面量（loader 真源）
    expect(text).toContain('失败（1）：');
    expect(text).toContain('user-x');
    expect(text).toContain('装机账本无此 id'); // 失败行诊断信息透出
  });

  it('缺省装载形：空目录 = core 内置态全装（批 19a—19e——exec/web/skills/memory/subagent/scheduler/mcp/browser/lsp/goal/checkpoint/sdk/webui/obs/issue 十五件 + c-3 credentials 增席十六件齐册，清单缺席）', async () => {
    const dir = tmpDir('plug-list-empty-');
    const io = capture();
    const code = await runPluginsEntry({ sub: 'list' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0);
    const text = io.out.join('\n');
    // core 注册表非空（十六件入册）——装载态集成回归锁（件数随逐纵切笔增长）
    expect(text).toContain('启用（16）：');
    expect(text).toContain('core:exec');
    expect(text).toContain('core:web');
    expect(text).toContain('core:skills');
    expect(text).toContain('core:memory');
    expect(text).toContain('core:subagent');
    expect(text).toContain('core:scheduler');
    expect(text).toContain('core:mcp');
    expect(text).toContain('core:browser');
    expect(text).toContain('core:lsp');
    expect(text).toContain('core:goal');
    expect(text).toContain('core:checkpoint');
    expect(text).toContain('core:sdk');
    expect(text).toContain('core:webui');
    expect(text).toContain('core:obs');
    expect(text).toContain('core:issue');
    expect(text).toContain('core:credentials');
    expect(text).toContain('失败（0）：');
    expect(text).toContain('禁用（0）：');
  });

  it('装配失败档透传：坏形清单退 1 + stderr 启动失败', async () => {
    const dir = tmpDir('plug-list-bad-');
    writeFileSync(join(dir, 'enabled.yaml'), 'plugins: [ Oops');
    const io = capture();
    const code = await runPluginsEntry({ sub: 'list' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('启动失败');
  });
});

describe('plugins check——纯只读零装配骨架（07 §5「数据面纯只读」）', () => {
  it('账本缺席 = 零装机无可体检项（exit 0——「无断裂」成立）', async () => {
    const dir = tmpDir('plug-check-absent-');
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('无可体检项');
  });

  it('账本为空对象 = 同缺席（exit 0）', async () => {
    const dir = tmpDir('plug-check-empty-');
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(join(dir, 'plugins', 'ledger.json'), '{}');
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0);
    expect(io.out.join('\n')).toContain('无可体检项');
  });

  it('账本非空：三色体检面挂账诚实退 1（归 API 治理批——03 §8.4/§8.9）', async () => {
    const dir = tmpDir('plug-check-full-');
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(join(dir, 'plugins', 'ledger.json'), '{"plugins":{"user-x":{"installPath":"/tmp/x"}}}');
    const io = capture();
    const code = await runPluginsEntry({ sub: 'check' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(1); // 非空账本形态本批不覆盖——不静默吞
    expect(io.out.join('\n')).toContain('尚未装配');
  });
});

describe('plugins 写侧六动词——local fixture 真链 e2e（装机面落码批 #10）', () => {
  /** local fixture 插件（default-export 入口 + events 导出——install 收割真跑） */
  function localFixturePlugin(name: string): string {
    const dir = join(tmpdir(), `berry-cmd-fixture-${name}-${process.pid}`);
    dirs.push(dir);
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      `${JSON.stringify({ name, version: '1.0.0', main: 'index.js', berryAgent: {} }, null, 2)}\n`,
    );
    writeFileSync(
      join(dir, 'index.js'),
      `export const events = ['demo/event-a'];\nexport default function apply() {}\n`,
    );
    return dir;
  }

  it('全链：install 真收割 → mount → toggle → unmount → uninstall inspect → execute', async () => {
    const dir = tmpDir('plug-write-chain-');
    const io = capture();
    const opts = { version: 'x', dataDir: dir, ...io };
    const fixture = localFixturePlugin('chain-pkg');

    // install：local 直引真收割 + 落账
    expect(await runPluginsEntry({ sub: 'install', ref: `local:${fixture}` }, opts)).toBe(0);
    expect(io.out.join('\n')).toContain('已装机：chain-pkg');
    const ledger = JSON.parse(readFileSync(join(dir, 'plugins', 'ledger.json'), 'utf8')) as { id: string }[];
    expect(ledger.map((e) => e.id)).toEqual(['chain-pkg']);

    // mount：装机在场过前置查 → 启用行落盘
    expect(await runPluginsEntry({ sub: 'mount', id: 'chain-pkg' }, opts)).toBe(0);
    expect(readFileSync(join(dir, 'enabled.yaml'), 'utf8')).toContain('chain-pkg');

    // toggle：翻禁用 → 再翻回
    expect(await runPluginsEntry({ sub: 'toggle', id: 'chain-pkg' }, opts)).toBe(0);
    expect(readFileSync(join(dir, 'enabled.yaml'), 'utf8')).toContain('disabled: true');
    expect(await runPluginsEntry({ sub: 'toggle', id: 'chain-pkg' }, opts)).toBe(0);
    expect(readFileSync(join(dir, 'enabled.yaml'), 'utf8')).not.toContain('disabled');

    // unmount：删行保装机
    expect(await runPluginsEntry({ sub: 'unmount', id: 'chain-pkg' }, opts)).toBe(0);
    expect(readFileSync(join(dir, 'enabled.yaml'), 'utf8')).not.toContain('chain-pkg');
    expect(JSON.parse(readFileSync(join(dir, 'plugins', 'ledger.json'), 'utf8')) as unknown[]).toHaveLength(1);

    // uninstall 无 --confirm = inspect 只读报告（exit 0）
    io.out.length = 0;
    expect(await runPluginsEntry({ sub: 'uninstall', id: 'chain-pkg', confirm: false }, opts)).toBe(0);
    expect(io.out.join('\n')).toContain('卸载预检');
    expect(JSON.parse(readFileSync(join(dir, 'plugins', 'ledger.json'), 'utf8')) as unknown[]).toHaveLength(1); // 只读

    // uninstall --confirm = execute 四段清算
    io.out.length = 0;
    expect(await runPluginsEntry({ sub: 'uninstall', id: 'chain-pkg', confirm: true }, opts)).toBe(0);
    expect(io.out.join('\n')).toContain('已卸载');
    expect(JSON.parse(readFileSync(join(dir, 'plugins', 'ledger.json'), 'utf8')) as unknown[]).toHaveLength(0);
    // local 直引：用户 fixture 目录不删
    expect(existsSync(join(fixture, 'index.js'))).toBe(true);
  });

  it('--data 单独在场（无 --confirm）即拒退 1——execute 载荷不静默猜', async () => {
    const dir = tmpDir('plug-write-data-alone-');
    const io = capture();
    const code = await runPluginsEntry(
      { sub: 'uninstall', id: 'x', confirm: false, dataAction: 'purge' },
      { version: 'x', dataDir: dir, ...io },
    );
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('--confirm 同场');
  });

  it('mount 前置两查：坏 id 词法拒；未装机 id 拒（防 brick 下次 boot 读侧）', async () => {
    const dir = tmpDir('plug-write-mount-gate-');
    const io = capture();
    const opts = { version: 'x', dataDir: dir, ...io };
    const bad = (await runPluginsEntry({ sub: 'mount', id: 'Bad_Id' }, opts)) as number;
    expect(bad).toBe(1);
    expect(io.err.join('\n')).toContain('词法违例');
    io.err.length = 0;
    expect(await runPluginsEntry({ sub: 'mount', id: 'not-installed' }, opts)).toBe(1);
    expect(io.err.join('\n')).toContain('未装机');
    expect(existsSync(join(dir, 'enabled.yaml'))).toBe(false); // 拒路径零落盘
  });

  it('install ref 坏形（无源前缀）退 1 呈词法指路；update 查无退 1', async () => {
    const dir = tmpDir('plug-write-badref-');
    const io = capture();
    const opts = { version: 'x', dataDir: dir, ...io };
    expect(await runPluginsEntry({ sub: 'install', ref: 'bare-pkg' }, opts)).toBe(1);
    expect(io.err.join('\n')).toContain('源前缀');
    io.err.length = 0;
    expect(await runPluginsEntry({ sub: 'update', id: 'ghost' }, opts)).toBe(1);
    expect(io.err.join('\n')).toContain('未装机');
  });
  // npm 执行器失败档/argv 族由 plugin-install.test.ts 假 spawn 覆盖（零真网络纪律）
});
