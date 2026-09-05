import { describe, expect, it } from 'vitest';
import { childLogger, createLogger, LogLevelState } from './logger.js';

/** 内存 sink（收 JSON 行——测试断言面） */
function memorySink(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];
  return { lines, sink: (line) => lines.push(line) };
}

describe('级别过滤', () => {
  it('缺省 info：debug 不出、info/warn/error 出', () => {
    const { lines, sink } = memorySink();
    const log = createLogger('session', new LogLevelState(), sink, () => 0);
    log.debug('调试');
    log.info('信息');
    log.warn('警告');
    log.error('错误');
    expect(lines).toHaveLength(3);
    expect(lines.filter((l) => l.includes('"level":"debug"'))).toHaveLength(0);
  });

  it('silent 全静默（显式档压倒一切）', () => {
    const { lines, sink } = memorySink();
    const state = new LogLevelState();
    state.setGlobalLevel('silent');
    const log = createLogger('session', state, sink);
    log.error('错误也不出');
    expect(lines).toHaveLength(0);
  });

  it('JSON 行形态：time/level/module/msg + 上下文字段平铺', () => {
    const { lines, sink } = memorySink();
    const log = createLogger('tools', new LogLevelState(), sink, () => 12345);
    log.warn('守门决策', { tool: 'write', decision: 'allow' });
    const parsed = JSON.parse(lines[0]!);
    expect(parsed).toEqual({
      time: 12345,
      level: 'warn',
      module: 'tools',
      msg: '守门决策',
      tool: 'write',
      decision: 'allow',
    });
  });
});

describe('env 解析（BERRY_AGENT_LOG_LEVEL 语法）', () => {
  it('全局 + per-module 逗号条目', () => {
    const warnings: string[] = [];
    const state = LogLevelState.fromEnv('info,session:debug', (m) => warnings.push(m));
    expect(state.resolve('session')).toBe('debug');
    expect(state.resolve('session:sqlite')).toBe('debug'); // 前缀匹配命中子域
    expect(state.resolve('tools')).toBe('info');
    expect(warnings).toEqual([]);
  });

  it('模块名含冒号可表达（lastIndexOf 切分）', () => {
    const state = LogLevelState.fromEnv('debug,core:memory:error');
    expect(state.resolve('core:memory')).toBe('error'); // 冒号模块名单值命中
    expect(state.resolve('core:memory:fts')).toBe('error'); // 其子域同命中
    expect(state.resolve('core')).toBe('debug');
  });

  it('最长前缀胜出（多层覆盖）', () => {
    const state = LogLevelState.fromEnv('info,session:debug,session:sqlite:error');
    expect(state.resolve('session:sqlite')).toBe('error'); // 最长匹配
    expect(state.resolve('session:other')).toBe('debug'); // 次长匹配
    expect(state.resolve('session')).toBe('debug');
  });

  it('无效条目警告后跳过（视同未设——静默失效比无反馈更糟）', () => {
    const warnings: string[] = [];
    const state = LogLevelState.fromEnv('verbose,session:debug', (m) => warnings.push(m));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('verbose');
    expect(state.resolve('tools')).toBe('info'); // 无效全局条目不占位——落缺省
    expect(state.resolve('session')).toBe('debug'); // 有效条目照常生效
  });

  it('空串/undefined 零条目（缺省 info）', () => {
    expect(LogLevelState.fromEnv(undefined).resolve('any')).toBe('info');
    expect(LogLevelState.fromEnv('').resolve('any')).toBe('info');
  });
});

describe('共享阈值盒（全树即时生效）', () => {
  it('child 派生同盒——setGlobalLevel 改盒全树即时生效', () => {
    const { lines, sink } = memorySink();
    const state = new LogLevelState();
    const parent = createLogger('session', state, sink);
    const child = childLogger(parent, 'sqlite');
    expect(child.module).toBe('session:sqlite');
    child.debug('升级前不出现');
    state.setGlobalLevel('debug');
    child.debug('升级后出现');
    parent.debug('父同盒也出现');
    expect(lines).toHaveLength(2);
  });

  it('per-module 改盒只影响命中前缀的树成员', () => {
    const { lines, sink } = memorySink();
    const state = new LogLevelState();
    const a = createLogger('session', state, sink);
    const b = createLogger('tools', state, sink);
    state.setModuleLevel('session', 'debug');
    a.debug('a 出现');
    b.debug('b 不出现');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('"module":"session"');
  });

  it('childLogger 拒手工构造的 Logger（缺内部面）', () => {
    const fake = { module: 'fake', debug() {}, info() {}, warn() {}, error() {} };
    expect(() => childLogger(fake as never, 'sub')).toThrowError(/createLogger 产物/);
  });
});
