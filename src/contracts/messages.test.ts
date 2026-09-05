/**
 * contracts/messages 测试 — 自定义角色注册面（04 §2 + 03 §2.7 消息面行）。
 *
 * 覆盖：注册/查询/枚举、域名前缀两段式执法（AGENT_ROLE_INVALID 三形）、撞名
 * 拒绝式（AGENT_ROLE_EXISTS——标准角色与在册自定义角色双向）、disposer
 * 「仅当仍是本定义时移除」守卫、标准消息窄化。
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  registerMessageRole,
  getMessageRoleDefinition,
  listMessageRoleNames,
  isStandardMessage,
  type CustomMessage,
  type MessageRoleDefinition,
} from './messages.js';
import { BaseError } from './errors.js';

/** 每用例后清注册表残留（disposer 收集器——注册面用例间不串味） */
const disposers: Array<() => void> = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
});

/** 断言抛出为指定码的 BaseError */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`应抛 ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

describe('registerMessageRole 注册面', () => {
  it('注册/查询/枚举 + 返回定义原对象', () => {
    const def: MessageRoleDefinition = { toLlm: () => null, render: { intent: 'hidden' } };
    disposers.push(registerMessageRole('memory/recall', def));
    expect(getMessageRoleDefinition('memory/recall')).toBe(def);
    expect(listMessageRoleNames()).toContain('memory/recall');
  });

  it('域名前缀两段式执法三形红（无斜杠/大写段/双斜杠）', () => {
    expectCode(() => registerMessageRole('memory', {}), 'AGENT_ROLE_INVALID');
    expectCode(() => registerMessageRole('Memory/recall', {}), 'AGENT_ROLE_INVALID');
    expectCode(() => registerMessageRole('a/b/c', {}), 'AGENT_ROLE_INVALID');
  });

  it('撞名拒绝式：标准角色名与在册自定义角色双向', () => {
    // 标准角色名单段形——撞名闸前置（「名字被占用」先于「格式违例」，03 §2.7）
    expectCode(() => registerMessageRole('user', {}), 'AGENT_ROLE_EXISTS');
    expectCode(() => registerMessageRole('toolResult', {}), 'AGENT_ROLE_EXISTS');
    disposers.push(registerMessageRole('acme/recall', {}));
    expectCode(() => registerMessageRole('acme/recall', {}), 'AGENT_ROLE_EXISTS');
  });

  it('disposer：仅当仍是本定义时移除 + 注销后可重注册', () => {
    const disposeA = registerMessageRole('acme/one', { render: { intent: 'status' } });
    disposeA();
    expect(getMessageRoleDefinition('acme/one')).toBeUndefined();
    // 注销后同名可重注册（卸载回卷即释放名——03 §2.7 对齐三律）
    const disposeB = registerMessageRole('acme/one', { render: { intent: 'hidden' } });
    // 过期 disposer（A）再调：注册表内是 B 的定义——不误摘
    disposeA();
    expect(getMessageRoleDefinition('acme/one')).toBeDefined();
    disposeB();
  });
});

describe('isStandardMessage 窄化守卫', () => {
  it('标准三角色 true / 自定义角色 false', () => {
    expect(isStandardMessage({ role: 'user', content: 'hi', timestamp: 0 })).toBe(true);
    expect(
      isStandardMessage({
        role: 'assistant',
        content: [],
        usage: undefined as never,
        stopReason: 'stop',
        timestamp: 0,
      }),
    ).toBe(true);
    const custom: CustomMessage = { role: 'acme/note', content: 1, timestamp: 0 };
    expect(isStandardMessage(custom)).toBe(false);
  });
});
