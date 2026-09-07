/**
 * host/plugins-cmd 子命令族测试——list 同构装载 / check 纯只读骨架 / 写侧
 * 六动词诚实退 1（07 §5 命令族语义；批 12f-3 分账如实）。
 *
 * list 走 assembly 公共段（memory 同构诊断形——与 dump-config 同一合成代码
 * 路径）；check 零装配直读装机账本；写侧动词解析面已就绪执行面诚实缺席。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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

  it('缺省装载形：空目录 = core 内置态全装（批 19a/19b-1/19b-2——exec/web/skills/memory 入册，清单缺席）', async () => {
    const dir = tmpDir('plug-list-empty-');
    const io = capture();
    const code = await runPluginsEntry({ sub: 'list' }, { version: 'x', dataDir: dir, ...io });
    expect(code).toBe(0);
    const text = io.out.join('\n');
    // core 注册表非空（exec/web/skills/memory 入册）——装载态集成回归锁（件数随逐纵切笔增长）
    expect(text).toContain('启用（4）：');
    expect(text).toContain('core:exec');
    expect(text).toContain('core:web');
    expect(text).toContain('core:skills');
    expect(text).toContain('core:memory');
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

describe('plugins 写侧六动词——诚实退 1（执行面随后续批）', () => {
  it.each([
    { sub: 'install', source: 'npm', ref: 'some-pkg' } as const,
    { sub: 'uninstall', id: 'user-x', confirm: false } as const,
    { sub: 'mount', id: 'user-x' } as const,
    { sub: 'unmount', id: 'user-x' } as const,
    { sub: 'toggle', id: 'user-x' } as const,
    { sub: 'update', id: 'user-x' } as const,
  ])('$sub：退 1 + stderr 尚未装配（解析面已就绪不静默）', async (command) => {
    const io = capture();
    const code = await runPluginsEntry(command, { version: 'x', ...io });
    expect(code).toBe(1);
    expect(io.err.join('\n')).toContain('尚未装配');
    expect(io.err.join('\n')).toContain(`plugins ${command.sub}`); // 子动词点名
  });
});
