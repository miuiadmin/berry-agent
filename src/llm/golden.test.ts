/**
 * 金样回放轨（07 篇 §7.4 #4——replay-deterministic 腿）。
 *
 * 零网络零真模型：只读 `tools/golden/*.jsonl`（录制腿 = `npm run
 * golden:record`，record-once 人工动作）。断言两层：
 * - 协议层：事件序合法（首 start、终 done/error、12 型闭集、start/done/
 *   error 单次性）——录制器或流装配静默退化在此红；
 * - 终值结构层：done 终值的块型序/stopReason/usage 形状——真模型行为
 *   演进在此红（红 = 重录信号，人工裁决后重跑录制器）。
 *
 * 纪律：禁断言 AI 生成的具体文本内容——只断形状（块型/序/计数/数值域）。
 * 内联合成金样一例保证零真金样时回放管线在 CI 恒有牙（真金样在场时
 * 照跑——管线对真/合成同管）。
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AssistantMessage, AssistantStreamEvent } from '../contracts/index.js';

/** 仓库根（src/llm 上两级） */
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
/** 金样目录（可能不在场——未录制态） */
const GOLDEN_DIR = join(REPO_ROOT, 'tools/golden');

/** 事件 12 型闭集（contracts/llm.ts AssistantStreamEvent 单源） */
const EVENT_TYPES = [
  'start',
  'text_start',
  'text_delta',
  'text_end',
  'thinking_start',
  'thinking_delta',
  'thinking_end',
  'toolcall_start',
  'toolcall_delta',
  'toolcall_end',
  'done',
  'error',
] as const;

/** 内容块型闭集（AssistantMessage.content） */
const BLOCK_TYPES = ['text', 'thinking', 'toolCall'] as const;

/** 枚举真金样（目录不在场 = 未录制态，诚实空数组） */
function listGoldenFiles(): string[] {
  try {
    return readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.jsonl'));
  } catch {
    return [];
  }
}

const GOLDENS = listGoldenFiles();

/** 解析金样 JSONL：首行 meta、后续行事件 */
function parseGolden(text: string): { meta: Record<string, unknown>; events: AssistantStreamEvent[] } {
  const lines = text.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length < 2) throw new Error('金样行数不足（至少 meta 头行 + start + 终事件）');
  const meta = JSON.parse(lines[0]!) as Record<string, unknown>;
  if (typeof meta.meta !== 'object' || meta.meta === null) throw new Error('首行不是 meta 头行');
  const events = lines.slice(1).map((line) => JSON.parse(line) as AssistantStreamEvent);
  return { meta: meta.meta as Record<string, unknown>, events };
}

/** 协议层 + 终值结构层断言（真/合成金样同管——回放确定性的机器面） */
function assertGolden(events: AssistantStreamEvent[]): void {
  expect(events.length).toBeGreaterThanOrEqual(2);
  // 首事件 start 先行；终事件 done/error 收尾
  expect(events[0]?.type).toBe('start');
  const last = events[events.length - 1]!;
  expect(['done', 'error']).toContain(last.type);
  // 全体 12 型闭集；start/done/error 只许出现在首尾（单次性）
  for (const event of events) expect(EVENT_TYPES).toContain(event.type);
  for (const event of events.slice(1, -1)) expect(['start', 'done', 'error']).not.toContain(event.type);
  // 终值结构（形状断言——零文本内容断言）；收窄到 done/error 二元再取值
  if (last.type !== 'done' && last.type !== 'error') throw new Error(`终事件非法：${String(last.type)}`);
  const final: AssistantMessage = last.type === 'done' ? last.message : last.error;
  expect(['stop', 'length', 'toolUse', 'deferred', 'aborted', 'error']).toContain(final.stopReason);
  for (const block of final.content) expect(BLOCK_TYPES).toContain(block.type);
  // usage 数值域（真模型金样 totalTokens > 0；合成金样可为 0）
  expect(final.usage.totalTokens).toBeGreaterThanOrEqual(final.usage.input + final.usage.output - 1);
  expect(Number.isFinite(final.usage.totalTokens)).toBe(true);
  // toolCall 块在闭集形状内（名字是非空字符串、参数是对象——不断言具体名字）
  for (const block of final.content) {
    if (block.type === 'toolCall') {
      expect(typeof block.name).toBe('string');
      expect(block.name.length).toBeGreaterThan(0);
      expect(typeof block.arguments).toBe('object');
    }
  }
}

/** 合成金样（零真金样时保管线有牙；协议形状对齐录制器产物） */
function syntheticGolden(): AssistantStreamEvent[] {
  const partial: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'text', text: 'x' }],
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 },
    stopReason: 'stop',
    timestamp: 0,
  };
  return [
    { type: 'start', partial },
    { type: 'text_delta', contentIndex: 0, delta: 'x', partial },
    {
      type: 'done',
      reason: 'stop',
      message: { ...partial, content: [{ type: 'text', text: 'synthetic' }] },
    },
  ];
}

describe('金样回放轨（07 §7.4 #4）', () => {
  it('回放管线自身有牙（合成金样走同一断言管线过）', () => {
    assertGolden(syntheticGolden());
  });

  it('协议退化红（缺 start / 终事件非 done-error 即 throw——守护回放面不空转）', () => {
    const noStart = syntheticGolden().slice(1);
    expect(() => assertGolden(noStart)).toThrow();
    const badTail = [...syntheticGolden().slice(0, -1)];
    expect(() => assertGolden(badTail)).toThrow();
  });

  it.skipIf(GOLDENS.length === 0)('真金样逐件回放（it.each——红即重录信号）', async () => {
    expect(GOLDENS.length).toBeGreaterThan(0);
    for (const name of GOLDENS) {
      const text = readFileSync(join(GOLDEN_DIR, name), 'utf8');
      const { meta, events } = parseGolden(text);
      // meta 形状（录制器单源字段——漂移即录制器与回放面失同步）
      expect(meta.scenario).toBe(name.replace(/\.jsonl$/, ''));
      expect(typeof meta.model).toBe('string');
      expect(typeof meta.recordedAt).toBe('string');
      assertGolden(events);
    }
  });
});
