/**
 * 命令面测试（03 §2.2 签名定形 + §2.7 冲突律——批 10a）：
 * 词法闸（CHANNEL_COMMAND_INVALID）/ 后写胜出 / disposer 防误注 /
 * parse 输入行 / tokenize 引号感知切分 / dispatch 命中与未命中。
 */
import { describe, expect, it } from 'vitest';
import { CommandRegistry, tokenize } from './commands.js';
import { BaseError } from '../contracts/index.js';

describe('CommandRegistry 词法闸', () => {
  it('合法词形注册通过：单段 / 连字符 / 冒号子段', () => {
    const reg = new CommandRegistry();
    expect(() => reg.register('help', () => {})).not.toThrow();
    expect(() => reg.register('memory-export', () => {})).not.toThrow();
    expect(() => reg.register('skill:name', () => {})).not.toThrow();
  });

  it('词法违例拒注册：大写 / 空串 / 空白 / 斜杠 / 数字开头 / 下划线', () => {
    const reg = new CommandRegistry();
    for (const bad of ['Help', '', 'a b', 'a/b', '1st', 'a_b', '/x', 'a:']) {
      try {
        reg.register(bad, () => {});
        expect.unreachable(`应拒绝：${JSON.stringify(bad)}`);
      } catch (err) {
        expect(err).toBeInstanceOf(BaseError);
        expect((err as BaseError).code).toBe('CHANNEL_COMMAND_INVALID');
      }
    }
  });
});

describe('CommandRegistry 后写胜出与 disposer', () => {
  it('撞名后写覆盖：dispatch 走新 handler', async () => {
    const reg = new CommandRegistry();
    const calls: string[] = [];
    reg.register('cmd', () => {
      calls.push('first');
    });
    reg.register('cmd', () => {
      calls.push('second');
    });
    expect(await reg.dispatch('/cmd')).toBe(true);
    expect(calls).toEqual(['second']);
  });

  it('被覆盖的旧 disposer 是 no-op（不误注接任者）；现任 disposer 正常注销', async () => {
    const reg = new CommandRegistry();
    let who = '';
    const disposeFirst = reg.register('cmd', () => {
      who = 'first';
    });
    const disposeSecond = reg.register('cmd', () => {
      who = 'second';
    });
    // 旧 disposer：已被后写覆盖——调用是 no-op（接任者仍在任，dispatch 走接任者）
    disposeFirst();
    await reg.dispatch('/cmd');
    expect(who).toBe('second');
    // 现任 disposer 注销
    disposeSecond();
    expect(await reg.dispatch('/cmd')).toBe(false);
  });

  it('list 报注册序与 description', () => {
    const reg = new CommandRegistry();
    reg.register('a', () => {}, 'desc-a');
    reg.register('b', () => {});
    const names = reg.list().map((c) => c.name);
    expect(names).toEqual(['a', 'b']);
    expect(reg.list()[0]?.description).toBe('desc-a');
  });
});

describe('parse 输入行', () => {
  const reg = new CommandRegistry();

  it('非 / 开头 → null（普通消息路——处置归驱动侧）', () => {
    expect(reg.parse('hello world')).toBeNull();
    expect(reg.parse('')).toBeNull();
  });

  it('/name 与 /name rest… 解析', () => {
    expect(reg.parse('/help')).toEqual({ name: 'help', args: { raw: '', argv: [] } });
    expect(reg.parse('/memory-export keep "a b"')).toEqual({
      name: 'memory-export',
      args: { raw: 'keep "a b"', argv: ['keep', 'a b'] },
    });
  });

  it('词法非法名（大写等）→ null：非命令形收场，不当命令执行', () => {
    expect(reg.parse('/Bad name')).toBeNull();
    expect(reg.parse('/')).toBeNull();
  });
});

describe('dispatch', () => {
  it('命中注册命令 → 执行（raw/argv 双轨）返回 true', async () => {
    const reg = new CommandRegistry();
    let got: { raw: string; argv: readonly string[] } | undefined;
    reg.register('do', (args) => {
      got = { raw: args.raw, argv: args.argv };
    });
    expect(await reg.dispatch('/do x "y z"')).toBe(true);
    expect(got).toEqual({ raw: 'x "y z"', argv: ['x', 'y z'] });
  });

  it('未注册名与非命令形 → false（不抛）', async () => {
    const reg = new CommandRegistry();
    expect(await reg.dispatch('/nope arg')).toBe(false);
    expect(await reg.dispatch('plain text')).toBe(false);
  });

  it('异步 handler 等待完成（void/Promise 双形）', async () => {
    const reg = new CommandRegistry();
    let flag = false;
    reg.register('slow', async () => {
      await Promise.resolve();
      flag = true;
    });
    await reg.dispatch('/slow');
    expect(flag).toBe(true);
  });

  // ix-2——07 §4.3 档位 2：发起会话显式位（CLI 面缺席 / TUI 注入聚焦会话）
  it('dispatch 第二参 sessionId 透传 CommandArgs（缺席时 args 不含该位）', async () => {
    const reg = new CommandRegistry();
    let withSid: string | undefined;
    let withoutSid: boolean | undefined;
    reg.register('anchored', (args) => {
      withSid = (args as { sessionId?: string }).sessionId;
    });
    reg.register('bare', (args) => {
      withoutSid = 'sessionId' in args;
    });
    await reg.dispatch('/anchored', 's-42');
    expect(withSid).toBe('s-42');
    await reg.dispatch('/bare');
    expect(withoutSid).toBe(false);
  });
});

describe('tokenize 引号感知切分', () => {
  it('裸词按空白切（多空白折叠）', () => {
    expect(tokenize('a  b\tc')).toEqual(['a', 'b', 'c']);
  });

  it('双引号保内部空格；单引号保字面', () => {
    expect(tokenize('a "b c" d')).toEqual(['a', 'b c', 'd']);
    // 裸词中途遇引号 = shell 拼接语义（'it's → it 拼接 s，行尾宽容收口）
    expect(tokenize("it's")).toEqual(['its']);
  });

  it('相邻引号段拼接（shell 语义）；空引号段产出空串', () => {
    expect(tokenize("'it''s'")).toEqual(['its']);
    expect(tokenize('"" x')).toEqual(['', 'x']);
  });

  it('未闭合引号行尾宽容收口', () => {
    expect(tokenize('a "unclosed tail')).toEqual(['a', 'unclosed tail']);
  });

  it('空输入与纯空白 → 空数组', () => {
    expect(tokenize('')).toEqual([]);
    expect(tokenize('   ')).toEqual([]);
  });
});
