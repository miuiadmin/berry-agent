import { describe, expect, it } from 'vitest';
import {
  BaseError,
  CORE_EVENT_TYPE_NAMES,
  EVENT_CATEGORIES,
  getEventTypeMeta,
  isKnownEventType,
  listEventTypes,
  parseEventSource,
  registerEventType,
} from './index.js';

describe('事件词汇注册表', () => {
  it('核心 16 词全注册（05 篇 §1.1 表格全列——逐词点名）', () => {
    const expected = [
      'turn/start',
      'turn/end',
      'user/message',
      'assistant/message',
      'tool/call',
      'tool/result',
      'todo/write',
      'request/header',
      'session/end-seed',
      'approval/asked',
      'approval/decided',
      'gate/decision',
      'sandbox/mode',
      'llm/usage',
      'llm/retry',
      'plugin/uninstalled',
    ];
    expect([...CORE_EVENT_TYPE_NAMES].sort()).toEqual([...expected].sort());
    for (const type of expected) expect(isKnownEventType(type)).toBe(true);
  });

  it('类别四分法闭集与核心词类别锚（structure/snapshot/log-only/surface 各点名）', () => {
    expect([...EVENT_CATEGORIES]).toEqual(['surface', 'snapshot', 'log-only', 'structure']);
    expect(getEventTypeMeta('turn/end')?.category).toBe('structure');
    expect(getEventTypeMeta('request/header')?.category).toBe('snapshot');
    expect(getEventTypeMeta('llm/usage')?.category).toBe('log-only');
    expect(getEventTypeMeta('user/message')?.category).toBe('surface');
  });

  it('owner 归属按表注（gate/decision→tools、llm/usage→llm、llm/retry→session、plugin/uninstalled→host）', () => {
    expect(getEventTypeMeta('gate/decision')?.owner).toBe('tools');
    expect(getEventTypeMeta('llm/usage')?.owner).toBe('llm');
    expect(getEventTypeMeta('llm/retry')?.owner).toBe('session');
    expect(getEventTypeMeta('plugin/uninstalled')?.owner).toBe('host');
    expect(getEventTypeMeta('todo/write')?.owner).toBe('conversation');
  });

  it('核心词全部不 ignorable（读侧必须认识）', () => {
    for (const meta of listEventTypes()) {
      if (CORE_EVENT_TYPE_NAMES.includes(meta.type)) expect(meta.ignorable).toBeUndefined();
    }
  });

  it('registerEventType 扩展入口：插件词注册后可查（双入口纪律的第二入口）', () => {
    registerEventType({
      type: 'test-plugin/custom',
      category: 'log-only',
      owner: 'test-plugin',
      description: '测试用例临时词',
      ignorable: true,
    });
    expect(isKnownEventType('test-plugin/custom')).toBe(true);
    expect(getEventTypeMeta('test-plugin/custom')?.ignorable).toBe(true);
  });

  it('核心词身份拒装载面注册（SESSION_CORE_TYPE_FORBIDDEN——双闸之一）', () => {
    expect(() =>
      registerEventType({ type: 'user/message', category: 'surface', owner: 'evil-plugin', description: '伪造核心词' }),
    ).toThrowError(BaseError);
    try {
      registerEventType({ type: 'turn/end', category: 'structure', owner: 'evil-plugin', description: '伪造核心词' });
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('SESSION_CORE_TYPE_FORBIDDEN');
        expect(err.message).toContain('核心词汇');
        return;
      }
      expect.unreachable();
    }
  });

  it('同型重复注册抛 HOST_EVENT_TYPE_CONFLICT', () => {
    try {
      registerEventType({ type: 'test-plugin/custom', category: 'log-only', owner: 'another', description: '撞型' });
      expect.unreachable();
    } catch (err) {
      if (err instanceof BaseError) {
        expect(err.code).toBe('HOST_EVENT_TYPE_CONFLICT');
        expect(err.message).toContain('test-plugin/custom');
        return;
      }
      expect.unreachable();
    }
  });
});

describe('source 归因闭集判别（05 §3.1）', () => {
  it('五字面量各归其位', () => {
    expect(parseEventSource('user')).toEqual({ kind: 'user', raw: 'user', treatedAsUser: true });
    expect(parseEventSource('schedule')).toEqual({ kind: 'schedule', raw: 'schedule', treatedAsUser: true });
    expect(parseEventSource('subagent-settled')).toEqual({
      kind: 'subagent-settled',
      raw: 'subagent-settled',
      treatedAsUser: true,
    });
    // compaction 是摘要载体：不以用户话语位展开
    expect(parseEventSource('compaction')).toEqual({ kind: 'compaction', raw: 'compaction', treatedAsUser: false });
  });

  it('channel: 前缀任意后缀按通道行展开——投影同视 user', () => {
    const parsed = parseEventSource('channel:webui');
    expect(parsed.kind).toBe('channel');
    expect(parsed.treatedAsUser).toBe(true);
    // 已知前缀的未知后缀（未来通道）同样合法
    expect(parseEventSource('channel:future-gateway').kind).toBe('channel');
  });

  it('plugin: 前缀任意后缀按插件行展开——投影不视为用户话语', () => {
    expect(parseEventSource('plugin:core:memory').kind).toBe('plugin');
    expect(parseEventSource('plugin:core:memory').treatedAsUser).toBe(false);
    // 已知前缀的未知后缀（未来插件）同样合法——前缀自描述承载注入者 id
    expect(parseEventSource('plugin:future-plugin').kind).toBe('plugin');
  });

  it('未知字面量按 user 同视（旧日志向前兼容——读侧宽容）', () => {
    const parsed = parseEventSource('legacy-unknown-value');
    expect(parsed).toEqual({ kind: 'user', raw: 'legacy-unknown-value', treatedAsUser: true });
  });
});
