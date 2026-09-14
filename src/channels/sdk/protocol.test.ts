/**
 * 协议词汇与信封定形锁（03 §10.6 线事件词汇条 + 请求面动词族条——批 13a）。
 *
 * 锁三面：①请求动词六件闭集 + 三通道词不在场（驱动侧单源律的结构锁）；
 * ②线帧 kind 闭集（线控四件 + 活体事件帧 + 应答三件 + 错误帧）；③信封形
 * 恰三载荷字段 {seq, sessionId, event}（「信封词面随落码批定形」——本批
 * 定形，此后不漂移）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  SDK_FRAME_KINDS,
  SDK_PROTOCOL_VERSION,
  SDK_REQUEST_VERBS,
  type SdkAskFrame,
  type SdkEventFrame,
} from './protocol.js';
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

  it('线帧 kind 闭集恰十件（活体事件帧 + 线控四件 + 应答三件 + 错误帧 + ask 审批外推帧）', () => {
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
      'ask',
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

  it('ask 审批外推帧必填恰 {sessionId, approvalId, summary} + 判别字段 kind（13b-1 定形锁）', () => {
    const frame: SdkAskFrame = {
      kind: 'ask',
      sessionId: 's-1',
      approvalId: 'a-1',
      summary: '写文件 /tmp/x',
    };
    // 最小形恰四键——reason/toolName/suggestedEntry 均可选位；多必填即信封漂移红
    expect(Object.keys(frame).sort()).toEqual(['approvalId', 'kind', 'sessionId', 'summary']);
  });

  it('replay-end 帧零 nextCursor 位——死契约字段删除锁（2026-09-14 四役定形，03 §10.6 注记）', () => {
    // 定形背景：v1 serve 桥单页全窗成文定案（重放腿跟尽义务由桥并页兑现），
    // replay-end 的 nextCursor 声明后永不发射（wire-core handleHello 唯一发射
    // 位恒不携带）即死契约字段——消费方据类型面写「截断续读」逻辑永远等不到
    // 它，已删；跟尽语义活位在 entries 帧的 nextCursor（getEntries 腿续读位）。
    // 接口无运行时投影（擦除），锁落源面：接口块内不得再出现 nextCursor 词面。
    const src = readFileSync(new URL('./protocol.ts', import.meta.url), 'utf8');
    const block = /export interface SdkReplayEndFrame \{[\s\S]*?\n\}/.exec(src)?.[0];
    // 切片锚：块必须切中（接口改名/删除时本锁失锚即红，不静默放行）
    expect(block).toContain('lastReplayedSeq');
    expect(block).not.toContain('nextCursor');
    // 语义活位锚：entries 帧仍携带 nextCursor（跟尽语义单源位——getEntries 腿）
    const entriesBlock = /export interface SdkEntriesFrame \{[\s\S]*?\n\}/.exec(src)?.[0];
    expect(entriesBlock).toContain('nextCursor');
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
