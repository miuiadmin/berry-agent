/**
 * sessions 服务面测试（批 19 销账笔——03 §4.4/§4.5 + 06 §318 appendEvent 最小面）。
 *
 * 覆盖四维：
 *  - 二道闸①：核心事件词伪造拒写（SESSION_CORE_TYPE_FORBIDDEN）；
 *  - 二道闸②：未注册词汇拒写（SESSION_UNKNOWN_EVENT_TYPE——前置闸与下游
 *    SessionLog.append 同判据，此处验证服务面先拦且错误信息带服务面上下文）；
 *  - 过闸正路：已注册插件词直达 log.append（durable 落账 + 返回值回传）；
 *  - 诚实缺席律：无活体驱动 undefined 降级 + 活引用调用时点解析（/new 热切换
 *    安全——取引用与调用两时点间驱动可能已闭）。
 *
 * 分层纪律：纯单元（真 SessionLog 纯内存形态——零 I/O 零 mock）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError, registerEventType } from '../contracts/index.js';
import { SessionLog } from '../session/index.js';
import { createSessionsFace, type SessionsDriverOf } from './sessions-face.js';

// 测试用插件词（过闸正路样本——词汇注册表单源）
registerEventType({
  type: 'sessions-face.test/note',
  category: 'surface',
  owner: 'sessions-face.test',
  tier: 'stable',
  description: 'sessions 服务面测试用事件词',
});

/** 断言抛指定码 */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('未拒绝');
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

/** 内存驱动表（活引用语义的受控样本——按 sessionId 增删） */
function tableOf(): { table: Map<string, { session: SessionLog }>; driverOf: SessionsDriverOf } {
  const table = new Map<string, { session: SessionLog }>();
  return { table, driverOf: (sessionId) => table.get(sessionId) };
}

describe('sessions 服务面（createSessionsFace——06 §318 appendEvent 最小面）', () => {
  it('二道闸①：核心事件词伪造拒写（核心词写入权属宿主驱动单源）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-core' });
    table.set('s-core', { session: log });
    const face = createSessionsFace({ driverOf });
    const append = face.appendEventFor('s-core');
    expect(append).toBeTypeOf('function');
    // 核心词样本三枚：消息族/请求族各取一 + 会话生命周期词
    expectCode(() => append!('user/message', { content: '伪造' }), 'SESSION_CORE_TYPE_FORBIDDEN');
    expectCode(() => append!('request/header', { systemPrompt: 'x' }), 'SESSION_CORE_TYPE_FORBIDDEN');
    expect(log.events()).toHaveLength(0); // 拒写零落账
  });

  it('二道闸②：未注册词汇拒写（前置闸先于下游——错误信息带服务面上下文）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-unknown' });
    table.set('s-unknown', { session: log });
    const face = createSessionsFace({ driverOf });
    const append = face.appendEventFor('s-unknown')!;
    try {
      append('no-such-thing/event', { any: true });
      expect.unreachable('未拒绝');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('SESSION_UNKNOWN_EVENT_TYPE');
      expect((err as BaseError).message).toContain('sessions.appendEventFor'); // 服务面上下文可辨
    }
    expect(log.events()).toHaveLength(0);
  });

  it('过闸正路：已注册插件词直达 log.append（同步落账 + 返回值回传）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-ok' });
    table.set('s-ok', { session: log });
    const face = createSessionsFace({ driverOf });
    const append = face.appendEventFor('s-ok')!;
    const returned = append('sessions-face.test/note', { note: '甲' });
    // 返回值 = append 落账事件本体（回传给消费方做溯源）
    expect(returned).toMatchObject({ type: 'sessions-face.test/note', seq: 0, data: { note: '甲' } });
    expect(log.events()).toHaveLength(1);
    expect(log.events()[0]).toMatchObject({ type: 'sessions-face.test/note', data: { note: '甲' } });
  });

  it('诚实缺席律：无活体驱动 undefined 降级（服务照常 provide——不造回库替身）', () => {
    const { driverOf } = tableOf();
    const face = createSessionsFace({ driverOf });
    expect(face.appendEventFor('s-absent')).toBeUndefined();
  });

  it('活引用调用时点解析：取引用与调用两时点间驱动闭死 → 闸仍在（append 调用拍执法）', () => {
    const { table, driverOf } = tableOf();
    table.set('s-hot', { session: new SessionLog({ sessionId: 's-hot' }) });
    const face = createSessionsFace({ driverOf });
    const append = face.appendEventFor('s-hot')!;
    // /new 热切换形：取引用后驱动表移除该会话（无活体驱动）——已取闭包仍可调
    // （其引用的 log 仍活体——闸执法在调用拍完成，词汇纪律不因热切换失效）
    table.delete('s-hot');
    expectCode(() => append('no-such/word', {}), 'SESSION_UNKNOWN_EVENT_TYPE');
    const log2 = new SessionLog({ sessionId: 's-hot-2' });
    table.set('s-hot-2', { session: log2 });
    const append2 = face.appendEventFor('s-hot-2')!;
    append2('sessions-face.test/note', { note: '乙' });
    expect(log2.events()).toHaveLength(1);
  });
});
