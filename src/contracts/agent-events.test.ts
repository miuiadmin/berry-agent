/**
 * AgentEvent 活体事件词汇锁（04 §2 E-0 扩型注 + E-1 落码批——2026-09-30
 * UX 五问题批）。锁三面：
 * 1. **联合成员名**——retry_wait_start/retry_wait_end 两型在册（修前红锚：
 *    扩型前本处构造即 tsc 红——「两名并存词汇门禁必炸」的反面锁：无
 *    agent_retry 名）；字段形（attempt/maxAttempts/nextAt 绝对时刻律、
 *    outcome 三值闭集）逐位点名；
 * 2. **durable 零新词红线**——活体新词不得泄入 durable 词汇注册表
 *    （05 §7 分层不变式：活体呈现与 durable 真相永不合流）；
 * 3. **agent_end 载荷扩**——durationMs/usage/cost 可选带出形（A-3 唯一
 *    真源语义：在场必用、缺席零迁移——可选字段不强制铸造方携带）。
 */
import { describe, expect, it } from 'vitest';
import type { AgentEvent } from './agent-events.js';
import { CORE_EVENT_TYPE_NAMES } from './events.js';

/** 样例构造（编译面即词汇锁——联合外成员名 tsc 红） */
const retryStart: AgentEvent = { type: 'retry_wait_start', attempt: 2, maxAttempts: 3, nextAt: 1_767_000_000_000 };
const retryEnd: AgentEvent = { type: 'retry_wait_end', outcome: 'resumed' };

describe('AgentEvent 活体词汇（E-1 落码批——重试窗口两型）', () => {
  it('retry_wait_start 在册：attempt/maxAttempts/nextAt 三字段点名（绝对时刻律——nextAt 是 Unix 毫秒非 tick）', () => {
    expect(retryStart).toMatchObject({ type: 'retry_wait_start', attempt: 2, maxAttempts: 3 });
    expect(typeof (retryStart as { nextAt: number }).nextAt).toBe('number');
  });

  it('retry_wait_end 在册：outcome 三值闭集（resumed/aborted/exhausted）', () => {
    const outcomes = ['resumed', 'aborted', 'exhausted'] as const;
    for (const outcome of outcomes) {
      const ev: AgentEvent = { type: 'retry_wait_end', outcome };
      expect(ev).toMatchObject({ type: 'retry_wait_end', outcome });
    }
    expect(retryEnd).toMatchObject({ type: 'retry_wait_end', outcome: 'resumed' });
  });

  it('无 agent_retry 名（E-0 定名消歧锁——两名并存词汇门禁必炸）', () => {
    // 联合面穷举成员名（样例 type 字段全列——新词入册须同步本清单）
    const knownTypes = [
      'agent_start',
      'agent_end',
      'turn_start',
      'turn_end',
      'message_start',
      'message_update',
      'message_end',
      'tool_execution_start',
      'tool_execution_update',
      'tool_execution_end',
      'retry_wait_start',
      'retry_wait_end',
    ];
    expect(knownTypes).not.toContain('agent_retry');
    expect(knownTypes).toContain('retry_wait_start');
    expect(knownTypes).toContain('retry_wait_end');
  });

  it('durable 零新词红线：活体重试词不入 durable 词汇注册表', () => {
    for (const word of ['retry_wait_start', 'retry_wait_end']) {
      expect([...CORE_EVENT_TYPE_NAMES], `活体词 ${word} 不得泄入 durable 注册表`).not.toContain(word);
    }
  });

  it('agent_end 载荷扩：durationMs/usage/cost 可选带出形（A-3——在场必用、缺席零迁移）', () => {
    // 缺席形：既有 10 型调用位零迁移（不携带新字段即合法）
    const bare: AgentEvent = { type: 'agent_end', status: 'completed' };
    expect(bare).toMatchObject({ type: 'agent_end', status: 'completed' });
    // 在场形：run 累计值三件（durationMs 毫秒数 / usage 用量 / cost 货币额）
    const enriched: AgentEvent = {
      type: 'agent_end',
      status: 'completed',
      durationMs: 90_000,
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3 },
      cost: { total: 0.01, currency: 'USD' },
    };
    expect(enriched).toMatchObject({ durationMs: 90_000, cost: { currency: 'USD' } });
  });
});
