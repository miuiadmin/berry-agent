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
import { decodeWireLine, encodeWireLine } from './jsonl.js';
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

/* ---------------- 线帧金样（D3——wire-frames.golden.jsonl 全集逐行锁） ---------------- */

describe('线协议帧样金样（D3——16 行 NDJSON：十帧 kind + 六请求 verb）', () => {
  /** 金样真源（由真源 encodeWireLine 产出——录制器一次性生成入库） */
  const GOLDEN_URL = new URL('./wire-frames.golden.jsonl', import.meta.url);

  /** 逐行账（尾行过滤——文件恰以 \n 收尾零残留空串） */
  const goldenLines = readFileSync(GOLDEN_URL, 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);

  it('金样恰 16 行 = 十帧 + 六请求（全集覆盖数锁）', () => {
    expect(goldenLines).toHaveLength(SDK_FRAME_KINDS.length + SDK_REQUEST_VERBS.length);
  });

  it('逐行 decode→encode 回环字节恒等（key order 保真——深校验同对象往返律 + 行尾恰一 \\n）', () => {
    for (const line of goldenLines) {
      const decoded = decodeWireLine(line); // 全行须可解码（fail-loud——金样零坏行）
      // 回环字节恒等：JSON.parse 还原转义 → 再编码重转义 → 与金样同字节（键
      // 序漂移/载荷改形/转义丢失任一即红——typebox 深校验返回同对象是前提）
      expect(encodeWireLine(decoded)).toBe(`${line}\n`);
    }
  });

  it('U+2028/U+2029 行安全转义锁：金样字节含转义形、零裸 LS/PS（撕行防线 gh-28405）', () => {
    const raw = readFileSync(GOLDEN_URL, 'utf8');
    // 转义形 = 反斜杠-u 四十六进制六字符序列（金样文件内的字面文本）
    expect(raw).toContain('\\u2028');
    expect(raw).toContain('\\u2029');
    // 裸 LS/PS（真实码位字符——测试源用 fromCharCode 造，防编辑器吞隐形字符）
    const LS = String.fromCharCode(0x2028);
    const PS = String.fromCharCode(0x2029);
    expect(raw.includes(LS)).toBe(false);
    expect(raw.includes(PS)).toBe(false);
  });

  it('金样 hello 帧 protocolVersion === SDK_PROTOCOL_VERSION（版本换代忘更新金样即红）', () => {
    const hello = goldenLines
      .map((line) => decodeWireLine(line) as { kind?: string; protocolVersion?: number })
      .find((f) => f.kind === 'hello');
    expect(hello?.protocolVersion).toBe(SDK_PROTOCOL_VERSION);
  });

  it('金样判别词全集对拍：kind 集恰等 SDK_FRAME_KINDS、verb 集恰等 SDK_REQUEST_VERBS（增删词即红）', () => {
    const decoded = goldenLines.map((line) => decodeWireLine(line) as { kind?: string; verb?: string });
    const kinds = decoded.map((f) => f.kind).filter((k) => k !== undefined);
    const verbs = decoded.map((f) => f.verb).filter((v) => v !== undefined);
    expect([...new Set(kinds)].sort()).toEqual([...SDK_FRAME_KINDS].sort());
    expect([...new Set(verbs)].sort()).toEqual([...SDK_REQUEST_VERBS].sort());
  });
});
