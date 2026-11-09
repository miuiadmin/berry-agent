/**
 * mcp 客户端管理族测试（03 §10.1 B5 条·CLI/SDK 进化批）。
 *
 * 零装配直读写侧锁：memoryFs 注入（零真盘）+ 行编辑写者家族单源消费
 * （setRowConfig 既有面——零新写通道的结构锁即测试本身走的同一条路）。
 */
import { describe, expect, it } from 'vitest';

import { runMcpManageEntry, type McpManageSub } from './mcp-cmd.js';
import type { PluginStoreFs } from './plugin-store.js';
import { parse as parseYaml } from 'yaml';

/** 内存 fs（enabled.yaml 单文件宇宙——行编辑写者家族的注入面；含锁机用的 openExclusive/mkdir） */
function memoryFs(files: Record<string, string> = {}): PluginStoreFs & { map: Map<string, string> } {
  const map = new Map(Object.entries(files));
  return {
    map,
    read: (path) => map.get(path) ?? null,
    write: (path, text) => void map.set(path, text),
    // O_EXCL 探测内存形（在场 = false；建成 = true）
    openExclusive: (path, text) => {
      if (map.has(path)) return false;
      map.set(path, text);
      return true;
    },
    unlink: (path) => void map.delete(path),
    mkdir: () => undefined,
    rm: () => undefined,
    readdir: () => [] as string[],
    size: () => 0,
    rename: (from, to) => {
      const text = map.get(from);
      if (text === undefined) throw new Error(`ENOENT: ${from}`);
      map.set(to, text);
      map.delete(from);
    },
  } as PluginStoreFs & { map: Map<string, string> };
}

const DATA_DIR = '/data';

function rig(files: Record<string, string> = {}) {
  const fs = memoryFs(files);
  const out: string[] = [];
  const err: string[] = [];
  const run = (sub: McpManageSub): Promise<number> =>
    runMcpManageEntry(sub, { dataDir: DATA_DIR, fs, writeOut: (t) => out.push(t), writeErr: (t) => err.push(t) });
  const enabledYaml = (): Record<string, unknown> =>
    parseYaml(fs.map.get(`${DATA_DIR}/enabled.yaml`) ?? 'plugins: []\n') as Record<string, unknown>;
  return { fs, out, err, run, enabledYaml };
}

/** 造 core:mcp 行 servers 种子（enabled.yaml 文本形） */
function seedServers(servers: Record<string, unknown>, extra = ''): string {
  return `plugins:\n  - id: core:mcp\n    config:\n      servers:\n${Object.entries(servers)
    .map(([name, entry]) => `        ${name}: ${JSON.stringify(entry)}`)
    .join('\n')}\n${extra}`;
}

describe('berry mcp list（零装配读面）', () => {
  it('行缺席 = 诚实空清单退 0', async () => {
    const r = rig();
    expect(await r.run({ sub: 'list' })).toBe(0);
    expect(r.out).toHaveLength(1);
    expect(r.out[0]).toContain('无登记');
  });

  it('在场清单呈名/命令/工具双表档', async () => {
    const r = rig({
      [`${DATA_DIR}/enabled.yaml`]: seedServers({
        fs: { command: '/bin/fs-mcp', args: ['--stdio'] },
        tools: { command: '/bin/tools-mcp', enabled_tools: ['a', 'b'] },
      }),
    });
    expect(await r.run({ sub: 'list' })).toBe(0);
    expect(r.out.join('\n')).toContain('fs');
    expect(r.out.join('\n')).toContain('/bin/fs-mcp --stdio');
    expect(r.out.join('\n')).toContain('白名单 2 项');
  });

  it('行 config 非对象 = 读侧行校验拒退 1 指路修文件（零动作——fail-loud 不静默视空）', async () => {
    const r = rig({ [`${DATA_DIR}/enabled.yaml`]: 'plugins:\n  - id: core:mcp\n    config: 42\n' });
    expect(await r.run({ sub: 'list' })).toBe(1);
    expect(r.err[0]).toContain('修复指引');
  });
});

describe('berry mcp add（两段词法执法 + 行编辑单源）', () => {
  it('合法登记：行缺席造行 + config 落 servers（重启/reload 生效提示）', async () => {
    const r = rig();
    expect(await r.run({ sub: 'add', name: 'fs', command: '/bin/fs-mcp', args: ['--stdio', '-v'] })).toBe(0);
    const doc = r.enabledYaml() as { plugins: Array<{ id: string; config?: { servers?: Record<string, unknown> } }> };
    const row = doc.plugins.find((entry) => entry.id === 'core:mcp');
    expect(row?.config?.servers?.['fs']).toEqual({ command: '/bin/fs-mcp', args: ['--stdio', '-v'] });
    expect(r.out[0]).toContain('reload');
  });

  it('既有行合并：他键 servers 不丢 + 他行不动 + doors 段保真往返', async () => {
    const r = rig({
      [`${DATA_DIR}/enabled.yaml`]: seedServers(
        { old: { command: '/bin/old' } },
        'doors:\n  - sessions.observe-cross\n',
      ),
    });
    expect(await r.run({ sub: 'add', name: 'new', command: '/bin/new', args: [] })).toBe(0);
    const doc = r.enabledYaml() as {
      plugins: Array<{ id: string; config?: { servers?: Record<string, unknown> } }>;
      doors?: string[];
    };
    const row = doc.plugins.find((entry) => entry.id === 'core:mcp');
    expect(Object.keys(row?.config?.servers ?? {})).toEqual(['old', 'new']); // 旧键保序保留
    expect(doc.doors).toEqual(['sessions.observe-cross']); // doors 段保真（写者家族律）
  });

  it('保留键 agent = 退 2 不落行（B-5 修前红锚：归一器不拒、boot 期才炸的配置面漂移形）', async () => {
    const r = rig();
    expect(await r.run({ sub: 'add', name: 'agent', command: '/bin/x', args: [] })).toBe(2);
    expect(r.err[0]).toContain('保留');
    expect(r.fs.map.has(`${DATA_DIR}/enabled.yaml`)).toBe(false); // 零落盘
  });

  it('command 相对路径 = 退 2；键词法违例 = 退 2（归一器段）', async () => {
    const r = rig();
    expect(await r.run({ sub: 'add', name: 'x', command: 'bin/x', args: [] })).toBe(2);
    expect(await r.run({ sub: 'add', name: 'bad_key', command: '/bin/x', args: [] })).toBe(2);
    expect(await r.run({ sub: 'add', name: 'x', command: '/bin/x', args: [] })).toBe(0); // 合法对照
  });

  it('重名 = 退 1 指路先 remove（读盘后才可判——不静默覆盖）', async () => {
    const r = rig({ [`${DATA_DIR}/enabled.yaml`]: seedServers({ dup: { command: '/bin/a' } }) });
    expect(await r.run({ sub: 'add', name: 'dup', command: '/bin/b', args: [] })).toBe(1);
    expect(r.err[0]).toContain('remove');
  });
});

describe('berry mcp remove（非幂等有意——指路优先）', () => {
  it('在场摘除：目标去、他键留、行 config 保形', async () => {
    const r = rig({
      [`${DATA_DIR}/enabled.yaml`]: seedServers({ a: { command: '/bin/a' }, b: { command: '/bin/b' } }),
    });
    expect(await r.run({ sub: 'remove', name: 'a' })).toBe(0);
    const doc = r.enabledYaml() as { plugins: Array<{ id: string; config?: { servers?: Record<string, unknown> } }> };
    const servers = doc.plugins.find((entry) => entry.id === 'core:mcp')?.config?.servers;
    expect(Object.keys(servers ?? {})).toEqual(['b']);
  });

  it('缺席 = 退 1 指路 list（非幂等——与 unmount 幂等分立的 N-3 注记形）', async () => {
    const r = rig();
    expect(await r.run({ sub: 'remove', name: 'ghost' })).toBe(1);
    expect(r.err[0]).toContain('list');
  });
});
