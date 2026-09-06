/**
 * env 白名单构造测试（04 §11 deny-by-default：零继承 + 声明式变更表 +
 * deny 冲突 fail-loud）。
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
