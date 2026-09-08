/**
 * env 白名单构造测试（04 §11 deny-by-default：零继承 + 声明式变更表 +
 * deny 冲突 fail-loud；03 §10.9 注入腿——c-4 引用形展开执法位）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { buildChildEnv, DEFAULT_ENV_ALLOW } from './env.js';

/** 夹具宿主环境（含凭证类哨兵——泄漏面探针） */
const HOST_ENV: NodeJS.ProcessEnv = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/tester',
  LANG: 'zh_CN.UTF-8',
  AWS_SECRET_ACCESS_KEY: 'AKIA-SENTINEL',
  GITHUB_TOKEN: 'ghp-SENTINEL',
  TERM: 'xterm-256color',
};

describe('buildChildEnv env 白名单', () => {
  it('缺省腿：零继承——只有 DEFAULT_ENV_ALLOW 命中项，凭证类全缺席', () => {
    const env = buildChildEnv({}, HOST_ENV);
    expect(env.PATH).toBe('/usr/bin:/bin');
    expect(env.HOME).toBe('/home/tester');
    expect(env.LANG).toBe('zh_CN.UTF-8');
    // 凭证泄漏面封死（deny-by-default 基底）
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it('宿主没有的 allow 名静默跳过（名单是愿望不是要求）', () => {
    const env = buildChildEnv({}, HOST_ENV);
    // HOST_ENV 无 LOGNAME——名单项缺席不造键
    expect('LOGNAME' in env).toBe(false);
  });

  it('显式 allow 覆写缺省白名单', () => {
    const env = buildChildEnv({ allow: ['HOME'] }, HOST_ENV);
    expect(Object.keys(env)).toEqual(['HOME']);
  });

  it('set 显式注入', () => {
    const env = buildChildEnv({ set: { BERRY_AGENT_TASK: '42' } }, HOST_ENV);
    expect(env.BERRY_AGENT_TASK).toBe('42');
    // set 不开继承后门——其余仍按白名单
    expect(env.GITHUB_TOKEN).toBeUndefined();
  });

  it('deny 命中 allow 名 = 策略自冲突 fail-loud（EXEC_ENV_FORBIDDEN）', () => {
    expect(() => buildChildEnv({ allow: ['PATH'], deny: ['PATH'] }, HOST_ENV)).toThrowError(BaseError);
    try {
      buildChildEnv({ allow: ['PATH'], deny: ['PATH'] }, HOST_ENV);
      expect.unreachable('须抛 EXEC_ENV_FORBIDDEN');
    } catch (error) {
      expect(error instanceof BaseError && error.code).toBe('EXEC_ENV_FORBIDDEN');
    }
  });

  it('deny 封死 set 注入（防内部调用方绕白名单塞凭证）', () => {
    expect(() =>
      buildChildEnv({ set: { AWS_SECRET_ACCESS_KEY: 'leak' }, deny: ['AWS_SECRET_ACCESS_KEY'] }, HOST_ENV),
    ).toThrowError();
    try {
      buildChildEnv({ set: { AWS_SECRET_ACCESS_KEY: 'leak' }, deny: ['AWS_SECRET_ACCESS_KEY'] }, HOST_ENV);
      expect.unreachable('须抛 EXEC_ENV_FORBIDDEN');
    } catch (error) {
      expect(error instanceof BaseError && error.code).toBe('EXEC_ENV_FORBIDDEN');
    }
  });

  it('deny 未命中任何面 = 纯排除（继承面收窄，不抛）', () => {
    const env = buildChildEnv({ deny: ['TERM'] }, HOST_ENV);
    expect(env.TERM).toBeUndefined();
    expect(env.PATH).toBe('/usr/bin:/bin');
  });

  it('缺省白名单不含凭证类/XDG 族（防名单腐化回归锁）', () => {
    const lowered = DEFAULT_ENV_ALLOW.map((n) => n.toLowerCase());
    for (const name of lowered) {
      expect(name.startsWith('aws_')).toBe(false);
      expect(name.startsWith('github_')).toBe(false);
      expect(name.startsWith('xdg_')).toBe(false);
      expect(name.includes('token')).toBe(false);
      expect(name.includes('secret')).toBe(false);
    }
  });
});

describe('buildChildEnv 凭证引用形展开（03 §10.9 注入腿——c-4 唯一执法点）', () => {
  /** BaseError 码断言辅助（错码即契约） */
  function expectCode(fn: () => unknown, code: string): BaseError {
    try {
      fn();
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe(code);
        return err;
      }
      throw err;
    }
  }

  it('引用形经展开器取明文（值只进返回 env——spawn env 实参直达子进程）', () => {
    const env = buildChildEnv({ set: { GITHUB_TOKEN: '@credentials:github-token' } }, HOST_ENV, (name) =>
      name === 'github-token' ? 'sk-expanded' : 'nope',
    );
    expect(env.GITHUB_TOKEN).toBe('sk-expanded');
  });

  it('展开器在场而值非引用形 = 字面原样（不误伤普通注入）', () => {
    const env = buildChildEnv({ set: { BERRY_AGENT_TASK: '42' } }, HOST_ENV, () => {
      throw new Error('unreachable——非引用形不进展开器');
    });
    expect(env.BERRY_AGENT_TASK).toBe('42');
  });

  it('前缀未完整命中（无冒号）= 字面原样', () => {
    const env = buildChildEnv({ set: { NOTE: '@credentials' } }, HOST_ENV, () => 'sk-never');
    expect(env.NOTE).toBe('@credentials');
  });

  it('引用形在场而展开器缺席 = 席位缺席 fail-loud（CREDENTIALS_NOT_FOUND）', () => {
    const err = expectCode(() => buildChildEnv({ set: { T: '@credentials:tok' } }, HOST_ENV), 'CREDENTIALS_NOT_FOUND');
    // message 指路修复（core:credentials 未装载/禁用 + 拒字面注入语义）
    expect(err.message).toContain('core:credentials');
    expect(err.message).toContain('字面值');
  });

  it('坏形：前缀命中而名空 = CREDENTIALS_ENV_REF_INVALID', () => {
    const err = expectCode(
      () => buildChildEnv({ set: { T: '@credentials:' } }, HOST_ENV, () => 'sk-never'),
      'CREDENTIALS_ENV_REF_INVALID',
    );
    expect(err.message).toContain('@credentials:');
  });

  it('展开器对缺席凭证名抛出如实穿透（credentials 侧 NOT_FOUND 语义）', () => {
    expectCode(
      () =>
        buildChildEnv({ set: { T: '@credentials:missing' } }, HOST_ENV, (name) => {
          throw new BaseError('CREDENTIALS_NOT_FOUND', `env 引用形 @credentials:${name} 在 host 域缺席`);
        }),
      'CREDENTIALS_NOT_FOUND',
    );
  });

  it('deny 封死引用形载体名（EXEC_ENV_FORBIDDEN 先于展开——凭证名在 deny 即拒）', () => {
    expectCode(
      () =>
        buildChildEnv({ set: { GITHUB_TOKEN: '@credentials:tok' }, deny: ['GITHUB_TOKEN'] }, HOST_ENV, () => 'sk-x'),
      'EXEC_ENV_FORBIDDEN',
    );
  });

  it('混装：引用形与字面值同 set 各走各路', () => {
    const env = buildChildEnv({ set: { A: '@credentials:a', B: 'plain' } }, HOST_ENV, (name) => `sk-${name}`);
    expect(env.A).toBe('sk-a');
    expect(env.B).toBe('plain');
  });
});
