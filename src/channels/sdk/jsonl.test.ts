/**
 * NDJSON 编解码测试（03 §10.6 线协议⑦ NDJSON 行安全 + 分帧纪律——批 13a）。
 *
 * 锁四面：①全帧型/全请求型编解码往返零损；②U+2028/U+2029 行安全（编码后
 * 单行锁——按 \n 分行恰得一行、字符经转义不撕行）；③fail-loud 解码（非
 * JSON/判别缺席/闭集外/必填缺失各自报因）；④流式分帧跨 chunk 零半帧零丢失。
 */
import { describe, expect, it } from 'vitest';
import { decodeWireLine, encodeWireLine, isSdkFrame, isSdkRequest, SdkDecodeError, splitWireLines } from './jsonl.js';
import type { SdkRequest, SdkWireFrame } from './protocol.js';

/** 全帧型样本（九 kind 各一——往返测试的穷举面） */
const FRAME_SAMPLES: SdkWireFrame[] = [
  { kind: 'event', seq: 3, sessionId: 's1', event: { type: 'agent_start' } },
  { kind: 'hello', protocolVersion: 1, sessionId: 's1', highWaterSeq: 4 },
  { kind: 'heartbeat', sessionId: 's1', runState: 'running', stage: { type: 'thinking' }, elapsedMs: 1200 },
  {
    kind: 'ack',
    sessionId: 's1',
    messageId: 'm-1',
    duplicate: false,
    routedChannel: 'followUp',
    highWaterSeq: 4,
  },
  { kind: 'replay-end', sessionId: 's1', lastReplayedSeq: 3 },
  { kind: 'error', code: 'SDK_CURSOR_INVALID', message: '游标非法', willRetry: false },
  { kind: 'entries', sessionId: 's1', entries: [{ seq: 2, event: { type: 'turn_start', turn: 1 } }] },
  { kind: 'sessions', sessions: [{ id: 's1', title: null, lastActivityAt: 1690000000000 }] },
  { kind: 'decide-result', approvalId: 'a-1', outcome: 'applied' },
];

/** 全请求型样本（六动词各一） */
const REQUEST_SAMPLES: SdkRequest[] = [
  { verb: 'hello', protocolVersion: 1, sessionId: 's1', after: 2 },
  { verb: 'prompt', messageId: 'm-1', content: '帮我看看', sessionId: 's1' },
  { verb: 'interrupt', sessionId: 's1' },
  { verb: 'decide', approvalId: 'a-1', answer: 'approve', note: '允许' },
  { verb: 'getEntries', sessionId: 's1', since: 0, cursor: 'c-1' },
  { verb: 'sessions' },
];

describe('编解码往返（全帧型 + 全请求型）', () => {
  it.each(FRAME_SAMPLES.map((frame) => [frame.kind, frame] as const))('线帧 %s 编码→解码零损', (_kind, frame) => {
    const decoded = decodeWireLine(encodeWireLine(frame).trimEnd());
    expect(decoded).toEqual(frame);
    expect(isSdkFrame(decoded)).toBe(true);
  });

  it.each(REQUEST_SAMPLES.map((req) => [req.verb, req] as const))('请求 %s 编码→解码零损', (_verb, req) => {
    const decoded = decodeWireLine(encodeWireLine(req).trimEnd());
    expect(decoded).toEqual(req);
    expect(isSdkRequest(decoded)).toBe(true);
  });

  it('编码产出恰一行（末尾恰一个 \\n，体内无换行）', () => {
    const line = encodeWireLine(FRAME_SAMPLES[0]!);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.split('\n')).toHaveLength(2); // 体 + 尾空串
    expect(line.slice(0, -1)).not.toContain('\n');
  });
});

describe('U+2028/U+2029 行安全（⑦ NDJSON——Claude gh-28405）', () => {
  // 两位行终止符经码点构造（字面量在编辑/传输中易丢——同 jsonl.ts 显式转义同律）
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  it('载荷含两行终止符：编码后按 \\n 分行恰一行（转义不撕行）', () => {
    const req: SdkRequest = {
      verb: 'prompt',
      messageId: 'm-u',
      content: `第一段${LS}第二段${PS}第三段`,
    };
    const line = encodeWireLine(req);
    // 行安全锁：整行（去尾 \n）内无裸 U+2028/U+2029、无 \n
    const body = line.slice(0, -1);
    expect(body).not.toContain('\n');
    expect(body).not.toContain(LS);
    expect(body).not.toContain(PS);
    // 转义形在串（JSON 转义序列，非裸字符）
    expect(body).toContain('\\u2028');
    expect(body).toContain('\\u2029');
  });

  it('解码侧 JSON.parse 原生还原裸字符（往返零损）', () => {
    const req: SdkRequest = {
      verb: 'prompt',
      messageId: 'm-u',
      content: `a${LS}b${PS}c`,
    };
    expect(decodeWireLine(encodeWireLine(req).trimEnd())).toEqual(req);
  });
});

describe('fail-loud 解码（坏行不产半帧）', () => {
  it('非合法 JSON 报因', () => {
    expect(() => decodeWireLine('{oops')).toThrow(SdkDecodeError);
  });

  it('判别字段缺席（verb/kind 均无）报因', () => {
    expect(() => decodeWireLine('{"foo":1}')).toThrow(/判别字段缺席/);
  });

  it('判别值闭集外报因', () => {
    expect(() => decodeWireLine('{"verb":"steer"}')).toThrow(/闭集外/); // 三通道词不在请求面
    expect(() => decodeWireLine('{"kind":"mystery"}')).toThrow(/闭集外/);
  });

  it('必填缺失各自报因（结构性校验面）', () => {
    expect(() => decodeWireLine('{"verb":"prompt","content":"x"}')).toThrow(/messageId/);
    expect(() => decodeWireLine('{"verb":"hello"}')).toThrow(/protocolVersion/);
    expect(() => decodeWireLine('{"verb":"interrupt"}')).toThrow(/sessionId/);
    expect(() => decodeWireLine('{"verb":"getEntries","sessionId":"s"}')).toThrow(/since/);
    expect(() => decodeWireLine('{"verb":"decide","approvalId":"a"}')).toThrow(/answer/);
    expect(() => decodeWireLine('{"kind":"ack","sessionId":"s","messageId":"m"}')).toThrow(/duplicate/);
    expect(() => decodeWireLine('{"kind":"error","code":"X"}')).toThrow(/message/);
    expect(() => decodeWireLine('{"kind":"event","seq":1,"sessionId":"s"}')).toThrow(/event/);
  });

  it('非对象（标量 JSON）报因', () => {
    expect(() => decodeWireLine('42')).toThrow(SdkDecodeError);
  });

  it('行尾 \\r 容忍（CRLF 传输面统一 LF）', () => {
    const req = REQUEST_SAMPLES[5]; // sessions——无必填标量
    expect(decodeWireLine(`${JSON.stringify(req)}\r`)).toEqual(req);
  });
});

describe('窄卫判别（isSdkRequest / isSdkFrame）', () => {
  it('请求判别真、帧判别真、杂形双假', () => {
    expect(isSdkRequest(REQUEST_SAMPLES[0])).toBe(true);
    expect(isSdkFrame(FRAME_SAMPLES[0])).toBe(true);
    expect(isSdkRequest(null)).toBe(false);
    expect(isSdkRequest({})).toBe(false);
    expect(isSdkFrame('x')).toBe(false);
    expect(isSdkFrame({ verb: 'hello', protocolVersion: 1 })).toBe(false); // 请求非帧
  });
});

describe('流式分帧（跨 chunk 零半帧零丢失）', () => {
  it('半行跨 chunk 拼回（remainder 续入）', () => {
    const first = splitWireLines('{"verb":"hel');
    expect(first.lines).toEqual([]);
    expect(first.remainder).toBe('{"verb":"hel');
    const second = splitWireLines('lo","protocolVersion":1}\n', first.remainder);
    expect(second.lines).toEqual(['{"verb":"hello","protocolVersion":1}']);
    expect(second.remainder).toBe('');
    expect(decodeWireLine(second.lines[0]!)).toEqual({ verb: 'hello', protocolVersion: 1 });
  });

  it('一次多行全吐、末行无换行留 remainder', () => {
    const r = splitWireLines('{"verb":"sessions"}\n{"verb":"sess');
    expect(r.lines).toEqual(['{"verb":"sessions"}']);
    expect(r.remainder).toBe('{"verb":"sess');
  });

  it('空 chunk 与空行不产帧', () => {
    expect(splitWireLines('', 'abc')).toEqual({ lines: [], remainder: 'abc' });
    expect(splitWireLines('\n\n').lines).toEqual([]); // 空行跳过
  });

  it('CRLF 行尾剥离', () => {
    const r = splitWireLines('{"verb":"sessions"}\r\n');
    expect(r.lines).toEqual(['{"verb":"sessions"}']);
  });
});
