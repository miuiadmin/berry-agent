/**
 * host/cli 契约测试——CLI 解析面执法律五条逐条 + 命令族全路（07 §5）。
 *
 * 解析器是纯函数（argv → tagged union 不抛）：用法错断言 ok=false +
 * exitCode=2 + message 指路关键词；成功路断言命令形与旗标缺省值。
 */
import { describe, expect, it } from 'vitest';

import { parseCli } from './cli.js';
import type { CliCommand } from './cli.js';

/** 用法错断言速记（exitCode 恒 2——07 §5 退出码三态之「用法错」档） */
function expectUsage(argv: readonly string[], keyword: string): void {
  const r = parseCli(argv);
  expect(r.ok).toBe(false);
  if (!r.ok) {
    expect(r.exitCode).toBe(2);
    expect(r.message).toContain(keyword);
  }
}

/** 成功路速记：断言 ok 后返回命令形（tagged union 收窄助手） */
function expectCommand(argv: readonly string[]): CliCommand {
  const r = parseCli(argv);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(r.message);
  return r.command;
}

describe('执法① 未识别 -- 词全入口用法错退 2', () => {
  it('TUI 入口未识别旗标', () => {
    expectUsage(['--verbos'], '未识别旗标');
  });

  it('run 入口未识别旗标', () => {
    expectUsage(['run', 'hi', '--colours'], '未识别旗标');
  });

  it('子命令内部未识别旗标', () => {
    expectUsage(['plugins', 'list', '--all'], '未识别旗标');
    expectUsage(['sessions', 'list', '--json'], '未识别旗标');
  });

  it('自动化入口不透传 --no-plugins（serve/mcp 收面即未识别）', () => {
    expectUsage(['serve', '--no-plugins'], '未识别旗标');
    expectUsage(['mcp', '--no-plugins'], '未识别旗标');
  });

  it('未知子命令退 2（非旗标首词不入 TUI）', () => {
    expectUsage(['frobnicate'], '未知子命令');
    // 回归锁：指路「合法集」词面必须与 parseCli 分派 switch 全覆盖同步（c-5 加
    // credentials 分派时漏改本提示词面——用户敲错命令会被指去一个不含该命令的
    // 合法集；断言修复前必红）
    const r = parseCli(['frobnicate']);
    expect(!r.ok && r.message).toContain('credentials');
  });
});

describe('执法② 裸 -- 终结符后全字面', () => {
  it('正当以 -- 起头的消息内容保真送达（不当旗标解析）', () => {
    const r = parseCli(['run', '--', '--read-only']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'run') {
      expect(r.command.message).toBe('--read-only');
      expect(r.command.flags.readOnly).toBe(false); // 字面参数不落旗标语义
    } else {
      expect.unreachable('run 解析应成功');
    }
  });

  it('终结符后多词 = 多位置参数（run 恰一即退 2）', () => {
    expectUsage(['run', '--', '--a', '--b'], '位置参数数目不符');
  });

  it('消息本体以 -- 起头且旗标在前（混合形）', () => {
    const r = parseCli(['run', '--debug', '--', '--help']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'run') {
      expect(r.command.message).toBe('--help');
      expect(r.command.flags.debug).toBe(true);
    } else {
      expect.unreachable('run 解析应成功');
    }
  });
});

describe('执法③ 取值旗标空串占位/值域外退 2', () => {
  it('值缺席（下一词是另一旗标 → 占位缺失）', () => {
    expectUsage(['run', 'hi', '--session', '--debug'], '须带值');
  });

  it('值空串占位', () => {
    expectUsage(['run', 'hi', '--session', ''], '须带值');
  });

  it('--port 值域（正整数 ≤ 65535）', () => {
    expectUsage(['--port', '0'], '整数');
    expectUsage(['--port', '65536'], '整数');
    expectUsage(['--port', 'abc'], '整数');
  });

  it('--output-format 值域枚举', () => {
    expectUsage(['run', 'hi', '--output-format', 'xml'], '值域外');
  });

  it('--data 值域枚举（uninstall）', () => {
    expectUsage(['plugins', 'uninstall', 'x', '--data', 'nuke'], '值域外');
  });

  it('--max-turns 正整数域（0 拒）', () => {
    expectUsage(['run', 'hi', '--max-turns', '0'], '整数');
  });
});

describe('执法④ help/version 越位短路（执法位在未识别旗标闸之后）', () => {
  it('子命令位之后的 --help 记录越位词 → help 命令形（分派层统一短路退 0）', () => {
    const r = parseCli(['run', 'hi', '--help']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'help') {
      expect(r.command.overreach).toBe('--help');
    } else {
      expect.unreachable('应短路为 help');
    }
  });

  it('TUI 入口 --version 短路', () => {
    const r = parseCli(['--version']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.kind).toBe('version');
  });

  it('首个越位词生效（--version 在前不随后到 --help 改道）', () => {
    const r = parseCli(['run', 'hi', '--version', '--help']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'version') {
      expect(r.command.overreach).toBe('--version');
    } else {
      expect.unreachable('首个越位词应生效');
    }
  });

  it('解析错误先于 help/version 短路（拼错旗标时错误比帮助更有用——本笔裁量）', () => {
    expectUsage(['run', 'hi', '--bogus', '--help'], '未识别旗标');
    expectUsage(['run', '--ephemeral', '--help'], '位置参数数目不符');
  });

  it('越位后旗标解析继续不误收（--help 后 --port 仍执法）', () => {
    expectUsage(['--help', '--port', '99999'], '整数');
  });
});

describe('执法⑤ 互斥组违例退 2', () => {
  it('--ephemeral × 续接族 + --tick + --background', () => {
    for (const extra of [['--session', 's1'], ['--continue'], ['--fork'], ['--background']] as const) {
      expectUsage(['run', 'hi', '--ephemeral', ...extra], '互斥');
    }
    // --tick 取值形先过 tick×message 互斥闸——ephemeral 冲突例须用零位置参数形
    expectUsage(['run', '--ephemeral', '--tick', 'myjob'], '互斥');
  });

  it('--session / --continue / --fork 三者互斥', () => {
    expectUsage(['run', 'hi', '--session', 's1', '--continue'], '互斥');
    expectUsage(['run', 'hi', '--session', 's1', '--fork'], '互斥');
    expectUsage(['run', 'hi', '--continue', '--fork'], '互斥');
  });
});

describe('TUI 入口（无参主入口）', () => {
  it('空 argv = TUI；旗标缺省全闭', () => {
    const r = parseCli([]);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'tui') {
      expect(r.command.flags).toEqual({ port: undefined, noPlugins: false, debug: false });
    } else {
      expect.unreachable('空 argv 应为 tui');
    }
  });

  it('三旗标收面 + 数值化', () => {
    const r = parseCli(['--port', '8080', '--no-plugins', '--debug']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'tui') {
      expect(r.command.flags).toEqual({ port: 8080, noPlugins: true, debug: true });
    } else {
      expect.unreachable('tui 解析应成功');
    }
  });

  it('TUI 不收位置参数（裸终结符送达——防误打 run 语义静默入 TUI）', () => {
    expectUsage(['--', 'hello'], '位置参数数目不符');
    // 非旗标首词不入 TUI 路——未知子命令指路（比位置参数错更指向根因）
    expectUsage(['hello'], '未知子命令');
  });
});

describe('run 命令族', () => {
  it('全旗标 happy path', () => {
    const r = parseCli([
      'run',
      'fix the bug',
      '--read-only',
      '--output-format',
      'json',
      '--no-delta',
      '--output-last-message',
      '/tmp/out.txt',
      '--max-turns',
      '5',
      '--session',
      's-42',
      '--port',
      '9000',
      '--debug',
      '--no-plugins',
    ]);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'run') {
      expect(r.command.message).toBe('fix the bug');
      expect(r.command.flags).toEqual({
        port: 9000,
        noPlugins: true,
        debug: true,
        readOnly: true,
        tick: undefined,
        background: false,
        outputFormat: 'json',
        noDelta: true,
        outputLastMessage: '/tmp/out.txt',
        ephemeral: false,
        maxTurns: 5,
        session: 's-42',
        continueLatest: false,
        fork: undefined,
      });
    } else {
      expect.unreachable('run 解析应成功');
    }
  });

  it('恰一个位置参数（零个/两个均退 2——不静默 join）', () => {
    expectUsage(['run'], '位置参数数目不符');
    expectUsage(['run', 'a', 'b'], '位置参数数目不符');
  });

  it('--fork 不带值 = 取 cwd 最新分叉', () => {
    const r = parseCli(['run', 'hi', '--fork']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'run') {
      expect(r.command.flags.fork).toEqual({ id: undefined });
    } else {
      expect.unreachable('fork 解析应成功');
    }
  });

  it('--fork <id> 带值分叉 + 尾随旗标不被误食为值', () => {
    const r = parseCli(['run', 'hi', '--fork', 's-7', '--debug']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'run') {
      expect(r.command.flags.fork).toEqual({ id: 's-7' });
      expect(r.command.flags.debug).toBe(true);
    } else {
      expect.unreachable('fork 带值解析应成功');
    }
    const r2 = parseCli(['run', 'hi', '--fork', '--debug']);
    expect(r2.ok).toBe(true);
    if (r2.ok && r2.command.kind === 'run') {
      expect(r2.command.flags.fork).toEqual({ id: undefined }); // --debug 不当 fork 值
      expect(r2.command.flags.debug).toBe(true);
    } else {
      expect.unreachable('fork 尾随旗标解析应成功');
    }
  });

  it('--output-schema 未实现：显式传入即用法错不静默忽略', () => {
    expectUsage(['run', 'hi', '--output-schema', 'out.json'], '尚未实现');
  });

  it('--tick <名> 取值形收面（批 20a——15a runner argv 契约跟齐）', () => {
    const r = parseCli(['run', '--read-only', '--tick', 'myjob']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'run') {
      expect(r.command.flags.tick).toBe('myjob');
      expect(r.command.flags.readOnly).toBe(true);
      expect(r.command.message).toBe(''); // tick 形 message 置空串——提示词在 jobs 行内
    } else {
      expect.unreachable('tick 取值形解析应成功');
    }
  });

  it('--tick 与 message 位置参数互斥退 2（到点形态提示词在行内不在 argv）', () => {
    expectUsage(['run', '--tick', 'myjob', 'hi'], '互斥');
    expectUsage(['run', 'hi', '--tick', 'myjob'], '互斥');
  });

  it('--tick 缺值 = 取值旗标占位缺失退 2', () => {
    expectUsage(['run', 'hi', '--tick'], '须带值');
  });
});

describe('serve 族 + 管理动词', () => {
  it('serve 本体旗标面（daemon/port/no-delta——无 noPlugins）', () => {
    const r = parseCli(['serve', '--daemon', '--port', '9000', '--no-delta']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'serve') {
      expect(r.command.flags).toEqual({
        port: 9000,
        debug: false,
        daemon: true,
        noDelta: true,
        sdkPort: undefined,
        sdkHost: undefined,
      });
    } else {
      expect.unreachable('serve 解析应成功');
    }
  });

  it('daemon 形 sdk TCP 两旗标（--sdk-port/--sdk-host——07 §5 落码定名批）', () => {
    const r = parseCli(['serve', '--daemon', '--sdk-port', '8080', '--sdk-host', '127.0.0.1']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'serve') {
      expect(r.command.flags.sdkPort).toBe(8080);
      expect(r.command.flags.sdkHost).toBe('127.0.0.1');
    } else {
      expect.unreachable('serve daemon 解析应成功');
    }
  });

  it('--sdk-port/--sdk-host 为 daemon 形专属：前台 stdio 形传即退 2（防静默吞）', () => {
    expectUsage(['serve', '--sdk-port', '8080'], '--daemon 形态专属');
    expectUsage(['serve', '--sdk-host', '127.0.0.1'], '--daemon 形态专属');
  });

  it('--sdk-port 值域：非正整数/超 65535 退 2（执法③）', () => {
    expectUsage(['serve', '--daemon', '--sdk-port', '0'], '1–65535');
    expectUsage(['serve', '--daemon', '--sdk-port', '70000'], '1–65535');
    expectUsage(['serve', '--daemon', '--sdk-port', 'abc'], '1–65535');
  });

  it('serve status / serve stop 管理动词（零旗标零参）', () => {
    expect(expectCommand(['serve', 'status'])).toMatchObject({ kind: 'serve-status' });
    expect(expectCommand(['serve', 'stop'])).toMatchObject({ kind: 'serve-stop' });
  });

  it('serve 未知第三词按位置参数执法退 2', () => {
    expectUsage(['serve', 'foo'], '位置参数数目不符');
    expectUsage(['serve', 'status', 'extra'], '位置参数数目不符');
  });
});

describe('mcp / dump-config / upgrade', () => {
  it('mcp 零旗标面（--debug 亦不收——MCP stdio 面不落日志噪音）', () => {
    const r = parseCli(['mcp']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.kind).toBe('mcp');
    expectUsage(['mcp', '--debug'], '未识别旗标');
  });

  it('dump-config 三旗标（--port 收下不起监听）', () => {
    const r = parseCli(['dump-config', '--port', '8080', '--no-plugins']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'dump-config') {
      expect(r.command.flags).toEqual({ port: 8080, noPlugins: true, debug: false });
    } else {
      expect.unreachable('dump-config 解析应成功');
    }
  });

  it('upgrade 只收 --debug', () => {
    const r = parseCli(['upgrade', '--debug']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.kind).toBe('upgrade');
    expectUsage(['upgrade', '--port', '8080'], '未识别旗标');
  });
});

describe('plugins 子命令族', () => {
  it('list/check 零参', () => {
    expect(expectCommand(['plugins', 'list'])).toMatchObject({ kind: 'plugins', sub: { sub: 'list' } });
    expect(expectCommand(['plugins', 'check'])).toMatchObject({ kind: 'plugins', sub: { sub: 'check' } });
  });

  it('install <ref> 单参自含前缀（与账本 ref 同词法）+ --min-release-age 旗标', () => {
    expect(expectCommand(['plugins', 'install', 'npm:@scope/pkg@1.2.0'])).toMatchObject({
      kind: 'plugins',
      sub: { sub: 'install', ref: 'npm:@scope/pkg@1.2.0' },
    });
    expect(expectCommand(['plugins', 'install', 'git:https://example/x.git#v1'])).toMatchObject({
      kind: 'plugins',
      sub: { sub: 'install', ref: 'git:https://example/x.git#v1' },
    });
    // 旗标三级顶：值合法 / 0 显式关窗合法（nonNegativeInt 域）
    expect(expectCommand(['plugins', 'install', 'local:/tmp/p', '--min-release-age', '5'])).toMatchObject({
      sub: { sub: 'install', ref: 'local:/tmp/p', minReleaseAge: 5 },
    });
    expect(expectCommand(['plugins', 'install', 'local:/tmp/p', '--min-release-age', '0'])).toMatchObject({
      sub: { sub: 'install', minReleaseAge: 0 },
    });
    expectUsage(['plugins', 'install', 'local:/tmp/p', '--min-release-age', '-3'], '的整数');
    expectUsage(['plugins', 'install', 'local:/tmp/p', '--min-release-age', 'x'], '的整数');
    expectUsage(['plugins', 'install'], '位置参数数目不符');
    expectUsage(['plugins', 'install', 'httpd', 'x'], '位置参数数目不符'); // 单参形——双位置参即用法错
  });

  it('uninstall <id> [--confirm] [--data keep|purge]', () => {
    const r = parseCli(['plugins', 'uninstall', 'demo', '--confirm', '--data', 'purge']);
    expect(r.ok).toBe(true);
    if (r.ok && r.command.kind === 'plugins' && r.command.sub.sub === 'uninstall') {
      expect(r.command.sub).toEqual({ sub: 'uninstall', id: 'demo', confirm: true, dataAction: 'purge' });
    } else {
      expect.unreachable('uninstall 解析应成功');
    }
    const bare = parseCli(['plugins', 'uninstall', 'demo']);
    if (bare.ok && bare.command.kind === 'plugins' && bare.command.sub.sub === 'uninstall') {
      expect(bare.command.sub.confirm).toBe(false); // 人面确认位缺省显式
      expect(bare.command.sub.dataAction).toBeUndefined();
    } else {
      expect.unreachable('uninstall 缺省解析应成功');
    }
  });

  it('mount/unmount/toggle/update 恰一 id', () => {
    expect(expectCommand(['plugins', 'mount', 'demo'])).toMatchObject({
      kind: 'plugins',
      sub: { sub: 'mount', id: 'demo' },
    });
    expect(expectCommand(['plugins', 'toggle', 'core:exec'])).toMatchObject({
      kind: 'plugins',
      sub: { sub: 'toggle', id: 'core:exec' },
    });
    expectUsage(['plugins', 'update'], '位置参数数目不符');
    expectUsage(['plugins', 'unmount', 'a', 'b'], '位置参数数目不符');
  });

  it('缺子命令 / 未知子命令 / 越位 help', () => {
    expectUsage(['plugins'], '须带子命令');
    expectUsage(['plugins', 'enable', 'x'], '未知 plugins 子命令'); // enable/disable 弃用词——执法①同款防语义漂移
    const r = parseCli(['plugins', 'list', '--help']);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.command.kind).toBe('help');
  });
});

describe('sessions 子命令族', () => {
  it('list/reindex 零参 + resume/fork/search 恰一参', () => {
    expect(expectCommand(['sessions', 'list'])).toMatchObject({ kind: 'sessions', sub: { sub: 'list' } });
    expect(expectCommand(['sessions', 'reindex'])).toMatchObject({ kind: 'sessions', sub: { sub: 'reindex' } });
    expect(expectCommand(['sessions', 'resume', 's-42'])).toMatchObject({
      kind: 'sessions',
      sub: { sub: 'resume', id: 's-42' },
    });
    expect(expectCommand(['sessions', 'fork', 's-42'])).toMatchObject({
      kind: 'sessions',
      sub: { sub: 'fork', id: 's-42' },
    });
    expect(expectCommand(['sessions', 'search', 'grep 怎么写'])).toMatchObject({
      kind: 'sessions',
      sub: { sub: 'search', query: 'grep 怎么写' },
    });
  });

  it('缺参/未知子命令退 2', () => {
    expectUsage(['sessions', 'resume'], '位置参数数目不符');
    expectUsage(['sessions', 'rm', 'x'], '未知 sessions 子命令');
    expectUsage(['sessions'], '须带子命令');
  });
});

describe('credentials 子命令族（c-5——03 §10.9 人面命令 CLI 面）', () => {
  it('add 全形（含 --namespace）/list/rm 解析成功', () => {
    expect(expectCommand(['credentials', 'add', 'anthropic', 'sk-x'])).toMatchObject({
      kind: 'credentials',
      sub: { sub: 'add', name: 'anthropic', value: 'sk-x' },
    });
    expect(expectCommand(['credentials', 'add', 'deploy', 'v-1', '--namespace', 'plugin:demo'])).toMatchObject({
      kind: 'credentials',
      sub: { sub: 'add', name: 'deploy', value: 'v-1', namespace: 'plugin:demo' },
    });
    expect(expectCommand(['credentials', 'list'])).toMatchObject({ kind: 'credentials', sub: { sub: 'list' } });
    expect(expectCommand(['credentials', 'rm', 'ghost', '--namespace', 'plugin:demo'])).toMatchObject({
      kind: 'credentials',
      sub: { sub: 'rm', name: 'ghost', namespace: 'plugin:demo' },
    });
  });

  it('缺子命令/未知动词/arity 错/未识别旗标退 2（解析律——值域执法归命令件不在此层）', () => {
    expectUsage(['credentials'], '须带子命令');
    expectUsage(['credentials', '--namespace', 'host'], '须带子命令');
    expectUsage(['credentials', 'bogus'], '未知 credentials 子命令');
    expectUsage(['credentials', 'add', 'only-name'], '位置参数数目不符');
    expectUsage(['credentials', 'rm'], '位置参数数目不符');
    expectUsage(['credentials', 'list', 'extra'], '位置参数数目不符');
    expectUsage(['credentials', 'add', 'n', 'v', '--team', 'x'], '未识别旗标');
    // 坏形 namespace 在解析层放行（'team' 是合法词面）——执法在命令件（同码分流）
    expect(expectCommand(['credentials', 'add', 'n', 'v', '--namespace', 'team'])).toMatchObject({
      sub: { namespace: 'team' },
    });
  });
});
