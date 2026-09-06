/**
 * 协议词汇与信封定形锁（03 §10.6 线事件词汇条 + 请求面动词族条——批 13a）。
 *
 * 锁三面：①请求动词六件闭集 + 三通道词不在场（驱动侧单源律的结构锁）；
 * ②线帧 kind 闭集（线控四件 + 活体事件帧 + 应答三件 + 错误帧）；③信封形
 * 恰三载荷字段 {seq, sessionId, event}（「信封词面随落码批定形」——本批
 * 定形，此后不漂移）。
 */
import { describe, expect, it } from 'vitest';
import { SDK_FRAME_KINDS, SDK_PROTOCOL_VERSION, SDK_REQUEST_VERBS, type SdkEventFrame } from './protocol.js';
import { getErrorCodeInfo } from '../../contracts/index.js';

describe('SDK 协议词汇闭集（03 §10.6）', () => {
  it('请求动词恰六件（v1 收窄律——hello/prompt/interrupt/decide/getEntries/sessions）', () => {
    expect([...SDK_REQUEST_VERBS]).toEqual(['hello', 'prompt', 'interrupt', 'decide', 'getEntries', 'sessions']);
  });

  it('三通道词不出现在请求面（04 §4 驱动侧单源律执法锁）', () => {
    const banned = ['steer', 'followUp', 'inject'] as const;
    for (const word of banned) {
      expect(SDK_REQUEST_VERBS).not.toContain(word);
    }
  });

  it('线帧 kind 闭集恰九件（活体事件帧 + 线控四件 + 应答三件 + 错误帧）', () => {
    expect([...SDK_FRAME_KINDS]).toEqual([
      'event',
      'hello',
      'heartbeat',
      'ack',
      'replay-end',
      'error',
      'entries',
      'sessions',
      'decide-result',
    ]);
  });

  it('线协议版本为正整数（③⑤ 版本握手比对可用）', () => {
    expect(Number.isInteger(SDK_PROTOCOL_VERSION)).toBe(true);
    expect(SDK_PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});

describe('信封定形（03 §10.6「{seq, sessionId, event} 形随落码批定形」——本批定形锁）', () => {
  it('活体事件帧恰三载荷字段 + 判别字段 kind', () => {
    const frame: SdkEventFrame = {
      kind: 'event',
      seq: 7,
      sessionId: 's-1',
      event: { type: 'agent_start' },
    };
    // 载荷键恰 {seq, sessionId, event}——多一字段（信封漂移）即红
    expect(Object.keys(frame).sort()).toEqual(['event', 'kind', 'seq', 'sessionId']);
  });
});

describe('SDK_ 五码在册（02 §5.3——注册笔系并行会话先行落、本批收编）', () => {
  it('五码 module 段 sdk 且可从 contracts 注册表查得', () => {
    for (const code of [
      'SDK_PROTOCOL_MISMATCH',
      'SDK_SESSION_BUSY',
      'SDK_MESSAGE_CONFLICT',
      'SDK_OVERLOADED',
      'SDK_CURSOR_INVALID',
    ]) {
      const info = getErrorCodeInfo(code);
      expect(info, code).toBeDefined();
      expect(info?.module, code).toBe('sdk');
    }
  });
});
