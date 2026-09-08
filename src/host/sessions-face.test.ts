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

describe('surfaceOp 信封参数腿（03 §4.5 修缝批——改道 appendWithSurfaceOp 正门）', () => {
  it('正路：携带信封经正门落账——指令事件携带 surfaceOp + 溯源数组 + 投影遮蔽生效', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-surf' });
    table.set('s-surf', { session: log });
    const face = createSessionsFace({ driverOf });
    const append = face.appendEventFor('s-surf')!;
    // 底座两条真投影事件（宿主侧直 append——核心词写入权属宿主，测试即宿主位）
    log.append('user/message', { content: '旧消息一' });
    log.append('user/message', { content: '旧消息二' });
    const charsBefore = log.projectedChars();
    expect(charsBefore).toBeGreaterThan(0);
    // 遮 [0,1]：插件自定义压缩类操作形（受理注入词携信封——区间起点 0 对齐
    // turn 边界、无 tool 对可切，通用形全判据过）
    const returned = append(
      'sessions-face.test/note',
      { note: '归并摘要' },
      { op: 'replace', start: 0, end: 1 },
      [0, 1],
    );
    // 返回值 = 正门落账事件本体（信封随事件携带——回传消费方做溯源）
    expect(returned).toMatchObject({
      type: 'sessions-face.test/note',
      seq: 2,
      surfaceOp: { op: 'replace', start: 0, end: 1 },
      sourceEventSeqs: [0, 1],
    });
    expect(log.events()).toHaveLength(3);
    // 增量遮蔽摘除已在正门内执行（chars 减法腿——两条被遮消息的字符数已扣）
    expect(log.projectedChars()).toBeLessThan(charsBefore);
    expect(log.projection().some((m) => m.type === 'user')).toBe(false); // 被遮消息离投影
  });

  it('surfaceOp 路同过二道闸：核心词携信封照拦（词面收窄）+ 未注册词携信封照拦', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-gate' });
    table.set('s-gate', { session: log });
    const face = createSessionsFace({ driverOf });
    const append = face.appendEventFor('s-gate')!;
    append('sessions-face.test/note', { note: '底座' });
    // 宿主核心词（compaction/surface 是宿主件词汇）携信封——受理面闸一先拦
    expectCode(
      () => append('compaction/surface', { summarySeq: 0 }, { op: 'replace', start: 0, end: 0 }, [0]),
      'SESSION_CORE_TYPE_FORBIDDEN',
    );
    expectCode(
      () => append('no-such/word', {}, { op: 'replace', start: 0, end: 0 }, [0]),
      'SESSION_UNKNOWN_EVENT_TYPE',
    );
    expect(log.events()).toHaveLength(1); // 两拒零落账（信封不豁免词汇闸）
  });

  it('正门同码执法：非法区间/溯源缺列经 SESSION_SURFACE_OP_INVALID 拒（受理面无第二校验面）', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-inv' });
    table.set('s-inv', { session: log });
    const face = createSessionsFace({ driverOf });
    const append = face.appendEventFor('s-inv')!;
    append('sessions-face.test/note', { note: '底座' });
    // 区间越界（end 超日志尾）
    expectCode(
      () => append('sessions-face.test/note', {}, { op: 'replace', start: 0, end: 5 }),
      'SESSION_SURFACE_OP_INVALID',
    );
    // 溯源缺列（sourceEventSeqs 未传——溯源完整性律正门执法）
    expectCode(
      () => append('sessions-face.test/note', {}, { op: 'replace', start: 0, end: 0 }),
      'SESSION_SURFACE_OP_INVALID',
    );
    expect(log.events()).toHaveLength(1);
  });

  it('不携信封形零变化：旧调用面（两参）行为与返回值同前', () => {
    const { table, driverOf } = tableOf();
    const log = new SessionLog({ sessionId: 's-plain' });
    table.set('s-plain', { session: log });
    const face = createSessionsFace({ driverOf });
    const append = face.appendEventFor('s-plain')!;
    const returned = append('sessions-face.test/note', { note: '普通' });
    expect(returned).toMatchObject({ type: 'sessions-face.test/note', seq: 0 });
    expect(log.events()[0]).not.toHaveProperty('surfaceOp');
  });
});
