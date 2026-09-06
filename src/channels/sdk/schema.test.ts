/**
 * channels/sdk/schema 请求面深校验测试（批 13e-1——13a 挂账「typebox 深校验」
 * 销账的回归锁）。
 *
 * 钉死：六动词合法形全过 / 必填缺失·型错·未知字段·闭集外值各自拒收并报因 /
 * 非对象与判别缺席诚实拒 / decodeWireLine 集成（结构层过后深校验层接管——
 * 未知字段拒收是深校验层独有执法位）。
 */
import { describe, expect, it } from 'vitest';

import { validateSdkRequest } from './schema.js';
import { SdkDecodeError, decodeWireLine } from './jsonl.js';

describe('validateSdkRequest 六动词合法形', () => {
  it('六动词最小合法形全过（选填缺席合法）', () => {
    expect(validateSdkRequest({ verb: 'hello', protocolVersion: 1 })).toEqual({
      ok: true,
      value: { verb: 'hello', protocolVersion: 1 },
    });
    expect(validateSdkRequest({ verb: 'prompt', messageId: 'm-1', content: '问' }).ok).toBe(true);
    expect(validateSdkRequest({ verb: 'interrupt', sessionId: 's-1' }).ok).toBe(true);
    expect(validateSdkRequest({ verb: 'decide', approvalId: 'a-1', answer: 'approve' }).ok).toBe(true);
    expect(validateSdkRequest({ verb: 'getEntries', sessionId: 's-1', since: -1 }).ok).toBe(true);
    expect(validateSdkRequest({ verb: 'sessions' }).ok).toBe(true);
  });

  it('选填字段合法形（hello 三选填/prompt sessionId/decide note/getEntries cursor）', () => {
    expect(validateSdkRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's', after: 3, noDelta: true }).ok).toBe(
      true,
    );
    expect(validateSdkRequest({ verb: 'prompt', messageId: 'm', content: 'c', sessionId: 's' }).ok).toBe(true);
    expect(validateSdkRequest({ verb: 'decide', approvalId: 'a', answer: 'always', note: '备注' }).ok).toBe(true);
    expect(validateSdkRequest({ verb: 'getEntries', sessionId: 's', since: 0, cursor: 'c-1' }).ok).toBe(true);
  });
});

describe('validateSdkRequest 拒收档', () => {
  it('必填缺失/型错各自拒收并报因', () => {
    const noVersion = validateSdkRequest({ verb: 'hello' });
    expect(noVersion.ok).toBe(false);
    if (!noVersion.ok) expect(noVersion.reason).toContain('hello');

    expect(validateSdkRequest({ verb: 'prompt', messageId: 'm' }).ok).toBe(false); // content 缺
    expect(validateSdkRequest({ verb: 'prompt', messageId: 1, content: 'c' }).ok).toBe(false); // messageId 型错
    expect(validateSdkRequest({ verb: 'interrupt' }).ok).toBe(false); // sessionId 缺
    expect(validateSdkRequest({ verb: 'getEntries', sessionId: 's', since: 1.5 }).ok).toBe(false); // 非整數
  });

  it('未知字段拒收（收窄律执法——请求面六动词载荷即全集）', () => {
    const r = validateSdkRequest({ verb: 'sessions', extra: 'x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('schema');
  });

  it('decide.answer 四值闭集外拒收', () => {
    expect(validateSdkRequest({ verb: 'decide', approvalId: 'a', answer: 'yolo' }).ok).toBe(false);
  });

  it('非对象/判别缺席/闭集外动词诚实拒', () => {
    expect(validateSdkRequest(null).ok).toBe(false);
    expect(validateSdkRequest('prompt').ok).toBe(false);
    expect(validateSdkRequest({}).ok).toBe(false);
    expect(validateSdkRequest({ verb: 'steer' }).ok).toBe(false); // 三通道词不在请求面（结构锁）
    expect(validateSdkRequest({ verb: 'followUp' }).ok).toBe(false);
    expect(validateSdkRequest({ verb: 'inject' }).ok).toBe(false);
  });
});

describe('decodeWireLine 深校验集成（结构层过后接管）', () => {
  it('未知字段行抛 SdkDecodeError（深校验层独有执法位）', () => {
    expect(() => decodeWireLine('{"verb":"sessions","extra":1}')).toThrow(SdkDecodeError);
  });

  it('answer 闭集外行抛 SdkDecodeError', () => {
    expect(() => decodeWireLine('{"verb":"decide","approvalId":"a","answer":"maybe"}')).toThrow(SdkDecodeError);
  });

  it('合法请求行照常解码（回归——深校验接入不破既有解码面）', () => {
    expect(decodeWireLine('{"verb":"prompt","messageId":"m-1","content":"问"}')).toEqual({
      verb: 'prompt',
      messageId: 'm-1',
      content: '问',
    });
  });

  it('合法线帧行不经请求深校验（帧族结构校验独立——不引入动词 schema）', () => {
    const frame = decodeWireLine('{"kind":"sessions","sessions":[]}');
    expect(frame).toEqual({ kind: 'sessions', sessions: [] });
  });
});
