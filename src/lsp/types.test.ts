/**
 * normalizeLspSettings 归一器测试（03 §10.2「config 坏形装载期归一响亮拒」
 * 条——2026-09-13 f-2 批）。镜像 mcp 归一器测试律：空形缺省/整值对象形/
 * 逐字段坏形响亮拒（LSP_CONFIG_INVALID——/reload 时刻可修的行级装载失败
 * 前件）。纯函数直击零装配。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { normalizeLspSettings } from './types.js';

/** 断言归一抛 LSP_CONFIG_INVALID 并返错误（文案断言用） */
async function expectInvalid(input: unknown): Promise<BaseError> {
  try {
    normalizeLspSettings(input);
    expect.unreachable('应抛 LSP_CONFIG_INVALID');
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe('LSP_CONFIG_INVALID');
    return err as BaseError;
  }
}

/** 合法单服务器条目（缺省基线——languages 必携） */
function entry(partial: Record<string, unknown> = {}): Record<string, unknown> {
  return { command: '/usr/local/bin/tsserver', languages: ['ts', 'tsx'], ...partial };
}

describe('normalizeLspSettings 空形缺省', () => {
  it('null/undefined → 空形 {servers:{}}（行惰性无害零 spawn）', () => {
    expect(normalizeLspSettings(undefined)).toEqual({ servers: {} });
    expect(normalizeLspSettings(null)).toEqual({ servers: {} });
  });

  it('空对象/servers 键缺席 → 空表（件级 diagnostics_timeout_ms 可独行）', () => {
    expect(normalizeLspSettings({})).toEqual({ servers: {} });
    expect(normalizeLspSettings({ diagnostics_timeout_ms: 1200 })).toEqual({
      servers: {},
      diagnostics_timeout_ms: 1200,
    });
  });
});

describe('normalizeLspSettings 整值形', () => {
  it('合法全字段条目归一透传（键声明序保插入序——路由裁决序物理前提）', () => {
    const out = normalizeLspSettings({
      servers: {
        typescript: entry({
          args: ['--stdio'],
          env: { NODE_OPTIONS: '--max-old-space-size=4096' },
          startup_timeout_sec: 45,
          request_timeout_sec: 20,
        }),
        python: entry({ command: '/usr/bin/pylsp', languages: ['py'] }),
      },
    });
    expect(out).toEqual({
      servers: {
        typescript: {
          command: '/usr/local/bin/tsserver',
          languages: ['ts', 'tsx'],
          args: ['--stdio'],
          env: { NODE_OPTIONS: '--max-old-space-size=4096' },
          startup_timeout_sec: 45,
          request_timeout_sec: 20,
        },
        python: { command: '/usr/bin/pylsp', languages: ['py'] },
      },
    });
    expect(Object.keys(out.servers)).toEqual(['typescript', 'python']); // 键序 = 声明序
  });

  it('非法整值（字符串/数组）响亮拒', async () => {
    const err1 = await expectInvalid('oops');
    expect(err1.message).toContain('config 须为对象');
    await expectInvalid(['a', 'b']);
  });
});

describe('normalizeLspSettings 逐字段坏形', () => {
  it('servers 非对象拒（文案与 mcp 同族——config.servers 须为对象）', async () => {
    const err = await expectInvalid({ servers: 'oops' });
    expect(err.message).toContain('config.servers 须为对象');
    await expectInvalid({ servers: [] });
  });

  it('单服务器条目非对象拒', async () => {
    const err = await expectInvalid({ servers: { ts: 'oops' } });
    expect(err.message).toContain('servers.ts 须为对象');
  });

  it('command 非绝对路径/空/非串拒（v1 只收绝对路径——mcp 同口径）', async () => {
    const rel = await expectInvalid({ servers: { ts: entry({ command: 'relative/path' }) } });
    expect(rel.message).toContain('servers.ts.command 须为绝对路径');
    await expectInvalid({ servers: { ts: entry({ command: '' }) } });
    await expectInvalid({ servers: { ts: entry({ command: 42 }) } });
  });

  it('languages 缺席/空表/非字串数组/空串元素拒（空表 = 路由永不命中的死行）', async () => {
    const absent = await expectInvalid({
      servers: { ts: { command: '/usr/local/bin/tsserver' } },
    });
    expect(absent.message).toContain('servers.ts.languages 须为非空字符串数组');
    await expectInvalid({ servers: { ts: entry({ languages: [] }) } });
    await expectInvalid({ servers: { ts: entry({ languages: 'ts' }) } });
    await expectInvalid({ servers: { ts: entry({ languages: ['ts', 42] }) } });
    await expectInvalid({ servers: { ts: entry({ languages: ['ts', ''] }) } });
  });

  it('args/env 坏形拒（字串数组/字串记录域）', async () => {
    const args = await expectInvalid({ servers: { ts: entry({ args: '--stdio' }) } });
    expect(args.message).toContain('servers.ts.args 须为字符串数组');
    await expectInvalid({ servers: { ts: entry({ args: [1] }) } });
    const env = await expectInvalid({ servers: { ts: entry({ env: { A: 1 } }) } });
    expect(env.message).toContain('servers.ts.env.A 须为 string');
    await expectInvalid({ servers: { ts: entry({ env: 'oops' }) } });
  });

  it('两超时与件级诊断钟非正数拒（0/负/非数同拒；正数放行）', async () => {
    const startup = await expectInvalid({ servers: { ts: entry({ startup_timeout_sec: 0 }) } });
    expect(startup.message).toContain('servers.ts.startup_timeout_sec 须为正数');
    await expectInvalid({ servers: { ts: entry({ request_timeout_sec: -1 }) } });
    await expectInvalid({ servers: { ts: entry({ request_timeout_sec: 'fast' }) } });
    const diag = await expectInvalid({ diagnostics_timeout_ms: 0 });
    expect(diag.message).toContain('diagnostics_timeout_ms 须为正数');
    // 正数三面全放行
    expect(
      normalizeLspSettings({
        servers: { ts: entry({ startup_timeout_sec: 1, request_timeout_sec: 1 }) },
        diagnostics_timeout_ms: 1,
      }),
    ).toEqual({
      servers: {
        ts: {
          command: '/usr/local/bin/tsserver',
          languages: ['ts', 'tsx'],
          startup_timeout_sec: 1,
          request_timeout_sec: 1,
        },
      },
      diagnostics_timeout_ms: 1,
    });
  });
});
