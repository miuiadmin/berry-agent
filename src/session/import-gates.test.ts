/**
 * 导入四闸单元测试（05 篇 §5.1——身份/词汇/配对/洪水）。
 *
 * 执法面红锁：自描述不认识拒整批、撕裂行拒载、未知词汇且非 ignorable 拒整批、
 * 多余闭合不可合成拒载、洪水闸滑动窗限速（假钟确定性）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import {
  messageShapeGate,
  pairingGate,
  parseImportFile,
  runImportGates,
  SessionSpawnLimiter,
  vocabularyGate,
} from './import-gates.js';
import type { SessionEvent } from '../contracts/index.js';

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

/** 造合法事件行（seq 连续 + 核心词汇） */
function line(seq: number, type: string, data: unknown = {}): string {
  return JSON.stringify({ type, seq, time: 1000 + seq, data });
}

/** 合法导入文件样例：_meta 首行 + 一轮完整对话 */
function validFile(): string {
  return [
    JSON.stringify({ format: 'berry-agent/session', version: 1, exportedAt: 123 }),
    line(0, 'turn/start'),
    line(1, 'user/message', { content: 'hi' }),
    line(2, 'assistant/message', { content: [{ type: 'text', text: 'yo' }] }),
    line(3, 'turn/end', { reason: 'completed' }),
  ].join('\n');
}

describe('parseImportFile 身份闸 + 解析', () => {
  it('合法文件：meta + 事件体解析', () => {
    const parsed = parseImportFile(validFile());
    expect(parsed.meta.format).toBe('berry-agent/session');
    expect(parsed.meta.version).toBe(1);
    expect(parsed.events.length).toBe(4);
    expect(parsed.events[1]!.type).toBe('user/message');
  });

  it('空文件拒绝（缺 _meta 首行）', () => {
    expectCode(() => parseImportFile(''), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('不认识的自描述拒绝（format 未知 / version 超支持）', () => {
    const foreign = [JSON.stringify({ format: 'other-tool/session', version: 1 }), line(0, 'turn/start')].join('\n');
    expectCode(() => parseImportFile(foreign), 'SESSION_IMPORT_BAD_FORMAT');
    const future = [JSON.stringify({ format: 'berry-agent/session', version: 2 }), line(0, 'turn/start')].join('\n');
    expectCode(() => parseImportFile(future), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('_meta 首行非 JSON 拒绝', () => {
    expectCode(() => parseImportFile('not json\n' + line(0, 'turn/start')), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('撕裂行（中途非 JSON）拒绝——不可静默截半', () => {
    const torn = [JSON.stringify({ format: 'berry-agent/session', version: 1 }), line(0, 'turn/start'), '{oops'].join(
      '\n',
    );
    expectCode(() => parseImportFile(torn), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('行非 SessionEvent 信封（缺 type/seq）拒绝', () => {
    const bad = [JSON.stringify({ format: 'berry-agent/session', version: 1 }), JSON.stringify({ hello: 1 })].join(
      '\n',
    );
    expectCode(() => parseImportFile(bad), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('空行跳过（导出器尾换行不炸）', () => {
    const padded = validFile() + '\n\n';
    expect(parseImportFile(padded).events.length).toBe(4);
  });
});

describe('vocabularyGate 词汇闸', () => {
  it('未知类型且未标 ignorable：拒整批（宁拒勿吞）', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'future/word', seq: 1, time: 2, data: {} },
    ];
    expectCode(() => vocabularyGate(events), 'SESSION_UNKNOWN_EVENT_TYPE');
  });

  it('未知类型但 ignorable：放行（向前兼容）', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'future/word', seq: 1, time: 2, data: {}, ignorable: true },
    ];
    expect(() => vocabularyGate(events)).not.toThrow();
  });

  it('核心词汇全过', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'llm/usage', seq: 1, time: 2, data: { input: 1 } },
    ];
    expect(() => vocabularyGate(events)).not.toThrow();
  });
});

describe('pairingGate 配对闸', () => {
  it('合法对话（含孤儿 call——可合成）通过', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'tool/call', seq: 1, time: 2, data: { toolCallId: 'c1', name: 't', arguments: '' } },
      // 崩溃残留：无 result——recoverClosers 能合成，放行
    ];
    expect(() => pairingGate(events)).not.toThrow();
  });

  it('seq 断号拒绝', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'user/message', seq: 2, time: 2, data: { content: '跳' } },
    ];
    expectCode(() => pairingGate(events), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('turn/end 无对应 start 拒绝（多余闭合不可合成）', () => {
    const events: SessionEvent[] = [{ type: 'turn/end', seq: 0, time: 1, data: { reason: 'completed' } }];
    expectCode(() => pairingGate(events), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('tool/result 无前置 call 拒绝', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'tool/result', seq: 1, time: 2, data: { toolCallId: 'ghost', content: 'x' } },
    ];
    expectCode(() => pairingGate(events), 'SESSION_IMPORT_BAD_FORMAT');
  });
});

describe('messageShapeGate 消息形状闸（词汇闸形状半句——05 §5.1）', () => {
  it('assistant/message 缺 content 拒（修前红：四闸全过 → derive 产 content=undefined → reseed 展开位裸 TypeError——错误现场远离导入位）', () => {
    const bad = [
      JSON.stringify({ format: 'berry-agent/session', version: 1 }),
      line(0, 'turn/start'),
      line(1, 'user/message', { content: 'hi' }),
      line(2, 'assistant/message', { stopReason: 'stop' }),
      line(3, 'turn/end', { reason: 'completed' }),
    ].join('\n');
    expectCode(() => runImportGates(bad), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('assistant/message content 非数组（字符串/数字）拒——错误消息携 seq 与词面', () => {
    const events: SessionEvent[] = [{ type: 'assistant/message', seq: 2, time: 1, data: { content: 'plain' } }];
    try {
      messageShapeGate(events);
      expect.unreachable('未拒绝');
    } catch (err) {
      expect(err).toBeInstanceOf(BaseError);
      expect((err as BaseError).code).toBe('SESSION_IMPORT_BAD_FORMAT');
      expect((err as BaseError).message).toContain('seq#2');
      expect((err as BaseError).message).toContain('assistant/message');
    }
    expectCode(
      () => messageShapeGate([{ type: 'assistant/message', seq: 0, time: 1, data: { content: 42 } }]),
      'SESSION_IMPORT_BAD_FORMAT',
    );
  });

  it('assistant/message content 空数组放行（生产 tool-only 响应合法形——filter 掉 toolCall 块后空数组落账，金样回环不误拒）', () => {
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: {} },
      { type: 'tool/call', seq: 1, time: 2, data: { toolCallId: 'c1', name: 't', arguments: '{}' } },
      { type: 'assistant/message', seq: 2, time: 3, data: { content: [] } },
      { type: 'tool/result', seq: 3, time: 4, data: { toolCallId: 'c1', content: 'ok' } },
      { type: 'turn/end', seq: 4, time: 5, data: { reason: 'completed' } },
    ];
    expect(() => messageShapeGate(events)).not.toThrow();
  });

  it('user/message 缺 content 拒；string 与块数组两契约形放行', () => {
    expectCode(
      () => messageShapeGate([{ type: 'user/message', seq: 0, time: 1, data: {} }]),
      'SESSION_IMPORT_BAD_FORMAT',
    );
    expectCode(
      () => messageShapeGate([{ type: 'user/message', seq: 0, time: 1, data: { content: 42 } }]),
      'SESSION_IMPORT_BAD_FORMAT',
    );
    expect(() =>
      messageShapeGate([
        { type: 'user/message', seq: 0, time: 1, data: { content: 'hi' } },
        { type: 'user/message', seq: 1, time: 2, data: { content: [{ type: 'text', text: 'yo' }] } },
      ]),
    ).not.toThrow();
  });

  it('data 缺席/null 容错拒（content 判缺席非炸读取）', () => {
    // data 整体缺席经原始 JSON 形构造（SessionEvent 信封面 data 必填——导入
    // 解析位不查 data，形状闸须对缺席形容错而非炸读取）
    const noData = JSON.parse('{"type":"assistant/message","seq":0,"time":1}') as SessionEvent;
    expectCode(() => messageShapeGate([noData]), 'SESSION_IMPORT_BAD_FORMAT');
    expectCode(
      () => messageShapeGate([{ type: 'user/message', seq: 0, time: 1, data: null }]),
      'SESSION_IMPORT_BAD_FORMAT',
    );
  });

  it('非射界事件不校验（形状闸射界 = 核心消息族 + 工具族四词——05 §5.1 第十轮补笔）', () => {
    expect(() => messageShapeGate([{ type: 'llm/usage', seq: 0, time: 1, data: { input: 1 } }])).not.toThrow();
  });

  describe('形状闸射界扩工具族 + 块元素细校（05 §5.1 第十轮补笔）', () => {
    it('tool/call data:null 嵌合法文件：修前四闸全过 → derive 消费位裸 TypeError；修后拒整批（携 seq 与词面）', () => {
      // data:null 过词汇闸（词面注册）、过配对闸（toolCallId 读取经 ?. 容错——
      // 非字符串 id 不入 seenCalls，无 result 即无多余闭合）——修前四闸全过，
      // derive 的 data.toolCallId 展开位裸 TypeError（错误现场远离导入位）
      const bad = [
        JSON.stringify({ format: 'berry-agent/session', version: 1 }),
        line(0, 'turn/start'),
        line(1, 'user/message', { content: 'hi' }),
        line(2, 'assistant/message', { content: [{ type: 'text', text: 'yo' }] }),
        line(3, 'tool/call', null),
        line(4, 'turn/end', { reason: 'completed' }),
      ].join('\n');
      try {
        runImportGates(bad);
        expect.unreachable('未拒绝');
      } catch (err) {
        expect(err).toBeInstanceOf(BaseError);
        expect((err as BaseError).code).toBe('SESSION_IMPORT_BAD_FORMAT');
        expect((err as BaseError).message).toContain('seq#3');
        expect((err as BaseError).message).toContain('tool/call');
      }
    });

    it('tool/call data 非对象（字符串/数组/缺席）拒；data.name 非字符串拒（投影 toolName 位）', () => {
      expectCode(
        () => messageShapeGate([{ type: 'tool/call', seq: 0, time: 1, data: 'oops' }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () => messageShapeGate([{ type: 'tool/call', seq: 0, time: 1, data: [{ toolCallId: 'c1' }] }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      // data 整体缺席经原始 JSON 形构造（信封面 data 必填——导入解析位不查，闸须容错拒）
      const noData = JSON.parse('{"type":"tool/call","seq":0,"time":1}') as SessionEvent;
      expectCode(() => messageShapeGate([noData]), 'SESSION_IMPORT_BAD_FORMAT');
      // data 是对象但 name 非字符串（null/数字）——derive 投影 toolName 位裸值
      expectCode(
        () => messageShapeGate([{ type: 'tool/call', seq: 0, time: 1, data: { toolCallId: 'c1', name: 42 } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () => messageShapeGate([{ type: 'tool/call', seq: 0, time: 1, data: { toolCallId: 'c1', name: null } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
    });

    it('tool/result data 非对象（null/字符串/数组）拒——derive 配对位 data.toolCallId 不可读', () => {
      const bad = [
        JSON.stringify({ format: 'berry-agent/session', version: 1 }),
        line(0, 'turn/start'),
        line(1, 'tool/call', { toolCallId: 'c1', name: 'read', arguments: '{}' }),
        line(2, 'tool/result', 'oops'),
        line(3, 'turn/end', { reason: 'completed' }),
      ].join('\n');
      // 修前：词汇闸过（词面注册）、配对闸过（字符串原语上读属性得 undefined——
      // 非字符串 id 不查前置）——四闸全过后 derive 读 data.toolCallId 裸 TypeError
      expectCode(() => runImportGates(bad), 'SESSION_IMPORT_BAD_FORMAT');
      expectCode(
        () => messageShapeGate([{ type: 'tool/result', seq: 0, time: 1, data: null }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () => messageShapeGate([{ type: 'tool/result', seq: 0, time: 1, data: ['x'] }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
    });

    it('user/message 块数组元素细校：非对象元素 / type 非字符串 / text 块 text 非字符串拒（修前只查「是数组」）', () => {
      // [{type:'text',text:42}] 修前过闸 → 导出面 sanitizeBodyText 的 .replace 位
      // 与预算刀 blockBytes 的字符串帽位裸 TypeError（错误现场远离导入位）
      expectCode(
        () =>
          messageShapeGate([
            { type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 'text', text: 42 }] } },
          ]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () => messageShapeGate([{ type: 'user/message', seq: 0, time: 1, data: { content: [42] } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () => messageShapeGate([{ type: 'user/message', seq: 0, time: 1, data: { content: [null] } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      // 块是对象但 type 缺席/非字符串——投影与导出面按 type 分派消费
      expectCode(
        () => messageShapeGate([{ type: 'user/message', seq: 0, time: 1, data: { content: [{ text: 'x' }] } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () =>
          messageShapeGate([{ type: 'user/message', seq: 0, time: 1, data: { content: [{ type: 7, text: 'x' }] } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
    });

    it('对照组：合法工具族（真实词面 + 真实 data 形）与合法块数组（text + image 块）照常过闸零误伤', () => {
      const good = [
        JSON.stringify({ format: 'berry-agent/session', version: 1 }),
        line(0, 'turn/start'),
        line(1, 'user/message', { content: [{ type: 'text', text: '帮我读文件' }] }),
        line(2, 'user/message', {
          source: 'user',
          content: [
            { type: 'text', text: '配图说明' },
            { type: 'image', data: 'aGk=', mimeType: 'image/png' },
          ],
        }),
        line(3, 'assistant/message', { content: [{ type: 'text', text: '这就去读' }] }),
        line(4, 'tool/call', { toolCallId: 'c1', name: 'fs_read', arguments: '{"path":"a.txt"}' }),
        line(5, 'tool/result', { toolCallId: 'c1', content: '文件内容', error: false }),
        line(6, 'turn/end', { reason: 'completed' }),
      ].join('\n');
      expect(() => runImportGates(good)).not.toThrow();
    });
  });

  describe('形状闸射界再扩三位（05 §5.1 第十一轮深扫补笔——assistant 块元素 / tool call arguments / tool result content）', () => {
    // 修前三形坏形全过四闸（词汇闸只认 type 注册面、形状闸射界不含此三位——
    // assistant 只查「是数组」、tool/call 只查 data 对象+name 字符串、tool/result
    // 只查 data 对象），导入成功后导出面 renderSessionMarkdown 裸 TypeError：
    // ① assistant text 块 sanitizeBodyText(block.text) 的 .replace 位；
    // ② tool/call 工具卡简行 foldLine(call.arguments, 160) 字符串方法位
    //   （session-export.ts:123——修前闸 JSDoc「其余键判形不预铺」半句为错误
    //   事实锚，随批勘正）；
    // ③ tool/result textOf(message.output) 的遍历位（session-export.ts:131）。
    // 错误现场远离导入位难归因——拦截钉回导入位（红锚 = 闸位断言形）。

    it('① assistant/message 块元素细校：元素非对象 / type 非字符串 / text 块 text 非字符串拒（修前只查「是数组」→ 过全闸放行，导出面按块分派与 .replace 位裸 TypeError）', () => {
      // 全文件红锚：text 块 text=42 修前过四闸——导出面 sanitizeBodyText(42).replace 裸 TypeError
      const bad = [
        JSON.stringify({ format: 'berry-agent/session', version: 1 }),
        line(0, 'turn/start'),
        line(1, 'user/message', { content: 'hi' }),
        line(2, 'assistant/message', { content: [{ type: 'text', text: 42 }] }),
        line(3, 'turn/end', { reason: 'completed' }),
      ].join('\n');
      try {
        runImportGates(bad);
        expect.unreachable('未拒绝');
      } catch (err) {
        expect(err).toBeInstanceOf(BaseError);
        expect((err as BaseError).code).toBe('SESSION_IMPORT_BAD_FORMAT');
        expect((err as BaseError).message).toContain('seq#2');
        expect((err as BaseError).message).toContain('assistant/message');
      }
      // 直闸单元变体：块元素非对象（数字/null）、块对象但 type 缺席/非字符串
      // ——判粒度对齐 user/message 既有同判
      expectCode(
        () => messageShapeGate([{ type: 'assistant/message', seq: 0, time: 1, data: { content: [42] } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () => messageShapeGate([{ type: 'assistant/message', seq: 0, time: 1, data: { content: [null] } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () => messageShapeGate([{ type: 'assistant/message', seq: 0, time: 1, data: { content: [{ text: 'x' }] } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () =>
          messageShapeGate([
            { type: 'assistant/message', seq: 0, time: 1, data: { content: [{ type: 7, text: 'x' }] } },
          ]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
    });

    it('② tool/call data.arguments 须字符串：数字/null/缺席拒（修前零校验过全闸——导出面 foldLine(call.arguments) 即字符串方法消费位，session-export.ts:123）', () => {
      // 全文件红锚：arguments=42 修前过四闸（data 对象 + name 字符串即放行）
      const bad = [
        JSON.stringify({ format: 'berry-agent/session', version: 1 }),
        line(0, 'turn/start'),
        line(1, 'user/message', { content: 'hi' }),
        line(2, 'assistant/message', { content: [{ type: 'text', text: 'yo' }] }),
        line(3, 'tool/call', { toolCallId: 'c1', name: 'fs_read', arguments: 42 }),
        line(4, 'turn/end', { reason: 'completed' }),
      ].join('\n');
      try {
        runImportGates(bad);
        expect.unreachable('未拒绝');
      } catch (err) {
        expect(err).toBeInstanceOf(BaseError);
        expect((err as BaseError).code).toBe('SESSION_IMPORT_BAD_FORMAT');
        expect((err as BaseError).message).toContain('seq#3');
        expect((err as BaseError).message).toContain('tool/call');
      }
      // 直闸单元变体：null / 缺席（契约必填键——缺席同坏形）
      expectCode(
        () =>
          messageShapeGate([
            { type: 'tool/call', seq: 0, time: 1, data: { toolCallId: 'c1', name: 't', arguments: null } },
          ]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () => messageShapeGate([{ type: 'tool/call', seq: 0, time: 1, data: { toolCallId: 'c1', name: 't' } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
    });

    it('③ tool/result data.content 须字符串或块数组：数字/null/缺席拒 + 块数组元素坏形拒（修前零校验过全闸——导出面 textOf 遍历位裸 TypeError）', () => {
      // 全文件红锚：content=42 修前过四闸——导出面 textOf 对非字符串非数组遍历位裸 TypeError
      const bad = [
        JSON.stringify({ format: 'berry-agent/session', version: 1 }),
        line(0, 'turn/start'),
        line(1, 'tool/call', { toolCallId: 'c1', name: 'fs_read', arguments: '{}' }),
        line(2, 'tool/result', { toolCallId: 'c1', content: 42 }),
        line(3, 'turn/end', { reason: 'completed' }),
      ].join('\n');
      try {
        runImportGates(bad);
        expect.unreachable('未拒绝');
      } catch (err) {
        expect(err).toBeInstanceOf(BaseError);
        expect((err as BaseError).code).toBe('SESSION_IMPORT_BAD_FORMAT');
        expect((err as BaseError).message).toContain('seq#2');
        expect((err as BaseError).message).toContain('tool/result');
      }
      // 直闸单元变体：content 缺席/null（契约必填键）、块数组元素坏形
      // （元素非对象 / text 块 text 非字符串——粒度随导出面 textOf 实读）
      expectCode(
        () => messageShapeGate([{ type: 'tool/result', seq: 0, time: 1, data: { toolCallId: 'c1' } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () => messageShapeGate([{ type: 'tool/result', seq: 0, time: 1, data: { toolCallId: 'c1', content: null } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () =>
          messageShapeGate([
            { type: 'tool/result', seq: 0, time: 1, data: { toolCallId: 'c1', content: [{ type: 'text', text: 42 }] } },
          ]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
      expectCode(
        () => messageShapeGate([{ type: 'tool/result', seq: 0, time: 1, data: { toolCallId: 'c1', content: [42] } }]),
        'SESSION_IMPORT_BAD_FORMAT',
      );
    });

    it('对照组：三位合法形照常过全闸零误伤（assistant thinking 块 / tool/call arguments 空串与 JSON 串 / tool/result content 两契约形）', () => {
      const good = [
        JSON.stringify({ format: 'berry-agent/session', version: 1 }),
        line(0, 'turn/start'),
        line(1, 'user/message', { content: '帮我查天气' }),
        line(2, 'assistant/message', {
          content: [
            { type: 'thinking', thinking: '先查再答' },
            { type: 'text', text: '这就去查' },
          ],
        }),
        line(3, 'tool/call', { toolCallId: 'c1', name: 'fs_read', arguments: '' }),
        line(4, 'tool/result', { toolCallId: 'c1', content: [{ type: 'text', text: '文件内容' }], error: false }),
        line(5, 'turn/end', { reason: 'completed' }),
      ].join('\n');
      expect(() => runImportGates(good)).not.toThrow();
      // tool/result content 纯字符串契约形（恢复合成 closer 同形——content 为串）
      const goodStringContent = [
        JSON.stringify({ format: 'berry-agent/session', version: 1 }),
        line(0, 'turn/start'),
        line(1, 'tool/call', { toolCallId: 'c1', name: 'fs_read', arguments: '{"path":"a.txt"}' }),
        line(2, 'tool/result', { toolCallId: 'c1', content: 'ok: session recovered before completion', error: true }),
        line(3, 'turn/end', { reason: 'completed' }),
      ].join('\n');
      expect(() => runImportGates(goodStringContent)).not.toThrow();
    });
  });
});

describe('SessionSpawnLimiter 洪水闸', () => {
  it('窗内超帽抛 SESSION_SPAWN_RATE_LIMIT（假钟确定性）', () => {
    let now = 0;
    const limiter = new SessionSpawnLimiter({ windowMs: 60_000, max: 3, clock: () => now });
    limiter.acquire();
    limiter.acquire();
    limiter.acquire();
    expectCode(() => limiter.acquire(), 'SESSION_SPAWN_RATE_LIMIT');
  });

  it('窗口滑出后名额恢复（滑动窗语义）', () => {
    let now = 0;
    const limiter = new SessionSpawnLimiter({ windowMs: 60_000, max: 2, clock: () => now });
    limiter.acquire(); // t=0
    now = 10_000;
    limiter.acquire(); // t=10s（窗满）
    expectCode(() => limiter.acquire(), 'SESSION_SPAWN_RATE_LIMIT');
    now = 60_001; // 首笔滑出窗（t=0 距今 ≥ 60s）
    limiter.acquire(); // 恢复
    expect(() => limiter.acquire()).toThrow(); // 又满（t=10s 与 t=60.001s 在窗）
  });

  it('窗口内恰好未超：不抛（边界 = 严格大于窗口时长才滑出）', () => {
    let now = 0;
    const limiter = new SessionSpawnLimiter({ windowMs: 1000, max: 1, clock: () => now });
    limiter.acquire();
    now = 1000; // 恰等窗口时长——严格 ≥ 判定滑出
    expect(() => limiter.acquire()).not.toThrow();
  });
});

describe('runImportGates 全闸组合', () => {
  it('合法文件过全闸（身份 → 词汇 → 配对）', () => {
    const parsed = runImportGates(validFile());
    expect(parsed.events.length).toBe(4);
  });

  it('身份闸先红（后面闸不跑）', () => {
    expectCode(() => runImportGates('garbage'), 'SESSION_IMPORT_BAD_FORMAT');
  });

  it('词汇闸红透传到组合面', () => {
    const evil = [
      JSON.stringify({ format: 'berry-agent/session', version: 1 }),
      line(0, 'turn/start'),
      line(1, 'virus/payload'),
    ].join('\n');
    expectCode(() => runImportGates(evil), 'SESSION_UNKNOWN_EVENT_TYPE');
  });
});
