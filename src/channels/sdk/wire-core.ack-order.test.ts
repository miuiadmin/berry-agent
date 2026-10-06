/**
 * wire-core prompt 应答序锁（sweep12 L1 竞态修的根因位回归——核级钉死）。
 *
 * 不变量：**ack 恒为 prompt 应答首帧**——回执先于副作用外推。自动订阅位的
 * deps.onSubscribed 钩（backend 侧对未决 ask pushFrame 的重连重推腿——本
 * 文件按同构接线复现）若先于 ack 落帧，请求作用域收集器（HTTP 面 POST
 * /prompt 的 postVerb / MCP 面 roundTrip）会先收 ask 后收 ack：
 * - 首帧判 ack 的观众同步守卫被击穿 → 零观众空订阅残留 → 该会话后续审批
 *   ask fail-open 挂死（帧落空扇出、promise 永悬）；
 * - 200 应答体变 ask 帧（客户端按协议解析 ack 拿到异型帧、丢幂等回执）。
 *
 * 端到端交错形（SSE 末流撤订 + POST prompt + 后续 ask fail-closed）在
 * src/sdk/http.test.ts 另锁；本件只钉核内帧序——传输面无需再持首帧假设。
 */
import { describe, expect, it } from 'vitest';

import type { SdkAskFrame, SdkWireFrame } from './protocol.js';
import { SdkWireCore } from './wire-core.js';

describe('prompt 应答序（ack 恒先于 onSubscribed 副作用外推）', () => {
  it('fresh prompt 有未决 ask 重推：帧序 [ack, ask]——回执先落收集器', () => {
    /** 出站帧账（sink 恒可写——直写即序，等价请求作用域收集器所见） */
    const frames: SdkWireFrame[] = [];
    // backend.ts onSubscribed 位同构：订阅受理即把未决 ask 帧同步外推——
    // 正是要与 ack 竞速的副作用（闭包迟绑定，同 backend.ts 装配形）
    const core = new SdkWireCore({
      sink: {
        write: (frame) => {
          frames.push(frame);
          return true;
        },
      },
      submitPrompt: () => ({ sessionId: 's1' }),
      lookupDedupeKey: () => undefined,
      interruptSession: () => {},
      queryEntries: () => ({ entries: [] }),
      listSessions: () => [],
      countSessions: () => 0,
      highWaterOf: () => 0,
      sessionStateOf: () => 'open',
      retryProbeOf: () => null,
      decideApproval: () => 'superseded',
      onSubscribed: (sessionId) => {
        const ask: SdkAskFrame = { kind: 'ask', sessionId, approvalId: 'sdk-1', summary: '未决' };
        core.pushFrame(ask, sessionId);
      },
    });
    core.handleRequest({ verb: 'prompt', sessionId: 's1', messageId: 'm-1', content: '问' });
    // 帧序锁：ack 首帧 + 重推 ask 随后（修前序 [ask, ack]——首帧异型即红）
    expect(frames.map((f) => f.kind)).toEqual(['ack', 'ask']);
    expect(frames[0]).toMatchObject({ kind: 'ack', sessionId: 's1', messageId: 'm-1', duplicate: false });
    expect(frames[1]).toMatchObject({ kind: 'ask', sessionId: 's1', approvalId: 'sdk-1' });
  });

  it('既有订阅（无重挂）时 fresh prompt：ack 仍是唯一外推帧、onSubscribed 不重发', () => {
    const frames: SdkWireFrame[] = [];
    /** onSubscribed 触发账（hello 首挂一发 + prompt 不重发 = 恰一） */
    const subscribed: string[] = [];
    const core = new SdkWireCore({
      sink: {
        write: (frame) => {
          frames.push(frame);
          return true;
        },
      },
      submitPrompt: () => ({ sessionId: 's1' }),
      lookupDedupeKey: () => undefined,
      interruptSession: () => {},
      queryEntries: () => ({ entries: [] }),
      listSessions: () => [],
      countSessions: () => 0,
      highWaterOf: () => 0,
      sessionStateOf: () => 'open',
      retryProbeOf: () => null,
      decideApproval: () => 'superseded',
      onSubscribed: (sessionId) => {
        subscribed.push(sessionId);
      },
    });
    core.handleRequest({ verb: 'hello', protocolVersion: 1, sessionId: 's1' });
    frames.length = 0; // 剥离 hello 三步帧——只看 prompt 段
    subscribed.length = 0; // hello 首挂的一发剥账——prompt 段应零新发
    core.handleRequest({ verb: 'prompt', sessionId: 's1', messageId: 'm-1', content: '问' });
    expect(frames.map((f) => f.kind)).toEqual(['ack']);
    expect(subscribed).toEqual([]); // 既有订阅不重挂——副作用零外推
  });
});
