/**
 * host/dispatch 契约测试——分派面逐路（07 §5 退出码三态 + 非 TTY 卫兵 +
 * help/version 短路 + 执行器缺席 fail-loud）。
 *
 * 输出/TTY 全注入——零 process 依赖纯分派逻辑；执行器在席路径用注入桩
 * （非模型层 mock——分层纪律允许）。
 */
import { describe, expect, it } from 'vitest';

import { parseCli } from './cli.js';
import { dispatchCli, HELP_TEXT } from './dispatch.js';
import type { CommandHandlers, DispatchEnv } from './dispatch.js';
import { BaseError } from '../contracts/index.js';

/** 分派环境速记（双 TTY + 输出收集；字段可覆写） */
function env(over: Partial<DispatchEnv> = {}): DispatchEnv & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    stdinIsTTY: true,
    stdoutIsTTY: true,
    writeOut: (t) => void out.push(t),
    writeErr: (t) => void err.push(t),
    version: '0.1.0-alpha.1',
    ...over,
    out,
    err,
  };
}

/** 分派速记（parse → dispatch 一条龙） */
async function run(
  argv: readonly string[],
  handlers: CommandHandlers = {},
  over: Partial<DispatchEnv> = {},
): Promise<{ code: number; env: ReturnType<typeof env> }> {
  const e = env(over);
  const code = await dispatchCli(parseCli([...argv]), handlers, e);
  return { code, env: e };
}

describe('dispatchCli 用法错与短路', () => {
  it('用法错 → stderr 报文 + 退 2（解析面执法同源）', async () => {
    const { code, env: e } = await run(['run', '--bad-flag', 'hi']);
    expect(code).toBe(2);
    expect(e.err.join('\n')).toContain('--bad-flag');
    expect(e.out).toEqual([]); // stdout 零污染
  });

  it('help → stdout 帮助文案 + 退 0', async () => {
    const { code, env: e } = await run(['--help']);
    expect(code).toBe(0);
    expect(e.out[0]).toBe(HELP_TEXT);
  });

  it('version → stdout 裸 semver + 退 0', async () => {
    const { code, env: e } = await run(['--version']);
    expect(code).toBe(0);
    expect(e.out).toEqual(['0.1.0-alpha.1']);
  });

  it('越位 help（子命令位之后）→ 帮助照打 + stderr 注记越位词 + 退 0', async () => {
    const { code, env: e } = await run(['--debug', '--help']);
    expect(code).toBe(0);
    expect(e.out[0]).toBe(HELP_TEXT);
    expect(e.err.join('\n')).toContain('不再落位置参数');
  });
});

describe('dispatchCli 非 TTY 卫兵（TUI 入口单源谓词）', () => {
  it('stdin 非 TTY → stderr 指引 run/serve + 退 2', async () => {
    const { code, env: e } = await run([], {}, { stdinIsTTY: false });
    expect(code).toBe(2);
    expect(e.err.join('\n')).toContain('run');
    expect(e.err.join('\n')).toContain('serve');
  });

  it('stdout 非 TTY（stdin 是 TTY）→ 同卫兵退 2——谓词取或', async () => {
    const { code } = await run([], {}, { stdoutIsTTY: false });
    expect(code).toBe(2);
  });

  it('双 TTY → 卫兵不触发（交执行器缺席面）', async () => {
    const { code } = await run([]);
    expect(code).toBe(1); // 执行器缺席档（非卫兵 2）
  });

  it('run 命令不做 TTY 卫兵（headless 天生——无降级条款必要）', async () => {
    const { code, env: e } = await run(['run', 'hi'], {}, { stdinIsTTY: false, stdoutIsTTY: false });
    expect(code).toBe(1); // 走执行器缺席档非卫兵
    expect(e.err.join('\n')).not.toContain('非交互环境');
  });
});

describe('dispatchCli 执行器派发', () => {
  it('缺席执行器 → stderr 诚实告知 + 退 1（fail-loud 不静默挂死）', async () => {
    for (const argv of [['run', 'hi'], ['serve'], ['serve', 'status'], ['mcp'], ['dump-config'], ['upgrade']]) {
      const { code, env: e } = await run(argv);
      expect(code, argv.join(' ')).toBe(1);
      expect(e.err.join('\n'), argv.join(' ')).toContain('尚未装配');
    }
  });

  it('在席执行器 → 返回码直通（0/1 各验）', async () => {
    const handlers: CommandHandlers = {
      run: async () => 0,
      serveStatus: async () => 1, // 探活否定应答 = 1（非执行失败）
    };
    expect((await run(['run', 'hi'], handlers)).code).toBe(0);
    expect((await run(['serve', 'status'], handlers)).code).toBe(1);
  });

  it('执行器抛 BaseError → stderr 码身份 + 报文 + 退 1', async () => {
    const handlers: CommandHandlers = {
      run: async () => {
        throw new BaseError('HOST_DATA_DIR_BUSY', '数据目录已有活跃进程');
      },
    };
    const { code, env: e } = await run(['run', 'hi'], handlers);
    expect(code).toBe(1);
    expect(e.err.join('\n')).toContain('HOST_DATA_DIR_BUSY');
    expect(e.err.join('\n')).toContain('数据目录已有活跃进程');
  });

  it('执行器抛裸 Error → stderr message + 退 1（无码不虚标）', async () => {
    const handlers: CommandHandlers = { mcp: async () => Promise.reject(new Error('boom')) };
    const { code, env: e } = await run(['mcp'], handlers);
    expect(code).toBe(1);
    expect(e.err.join('\n')).toContain('boom');
    expect(e.err.join('\n')).not.toContain('undefined');
  });

  it('plugins/sessions 子命令透传解析产物（载荷直达执行器）', async () => {
    const seen: string[] = [];
    const handlers: CommandHandlers = {
      plugins: async (sub) => {
        seen.push(`plugins:${sub.sub}`);
        return 0;
      },
      sessions: async (sub) => {
        seen.push(`sessions:${sub.sub}`);
        return 0;
      },
    };
    await run(['plugins', 'list'], handlers);
    await run(['plugins', 'uninstall', 'x', '--confirm', '--data', 'purge'], handlers);
    await run(['sessions', 'reindex'], handlers);
    expect(seen).toEqual(['plugins:list', 'plugins:uninstall', 'sessions:reindex']);
  });
});
