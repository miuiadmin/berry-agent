/**
 * llm — 会话层恢复零件测试（04 §3.5 classifyError 单源纯函数表 + 判定序）。
 *
 * 判定序五步逐条钉死：①errorCode 码优先 ②overflow ③quota 文案族
 * ④transient 正则 ⑤保守 non-retryable。retryAssistantCall 语义三例。
 */
import { describe, expect, it } from 'vitest';
import type { AssistantMessage } from '../contracts/index.js';
import { classifyError, isContextOverflow, isRecoverableLength, retryAssistantCall } from './recovery.js';

/* ---------------- 测试基建 ---------------- */

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** 组装指定终态的 assistant 消息（纯数据——classifyError 是纯函数表） */
function messageOf(opts: {
  stopReason?: AssistantMessage['stopReason'];
  errorMessage?: string;
  errorCode?: string;
  usage?: AssistantMessage['usage'];
  content?: AssistantMessage['content'];
}): AssistantMessage {
  return {
    role: 'assistant',
    content: opts.content ?? [],
    usage: opts.usage ?? NO_USAGE,
    stopReason: opts.stopReason ?? 'error',
    ...(opts.errorMessage !== undefined ? { errorMessage: opts.errorMessage } : {}),
    ...(opts.errorCode !== undefined ? { errorCode: opts.errorCode } : {}),
    timestamp: 1,
  };
}

describe('classifyError 判定序（04 §3.5 单源表）', () => {
  it('① errorCode=LLM_INFLIGHT_LIMIT → transient（码优先——即便文案同时命中溢出/配额族）', () => {
    const msg = messageOf({
      errorCode: 'LLM_INFLIGHT_LIMIT',
      errorMessage: 'prompt is too long: 213462 tokens > 200000 maximum', // ② 族文案在场
    });
    expect(classifyError(msg)).toBe('transient');
  });

  it('② 溢出文案族 → overflow（provider 正则——Anthropic 实文）', () => {
    expect(classifyError(messageOf({ errorMessage: 'prompt is too long: 213462 tokens > 200000 maximum' }))).toBe(
      'overflow',
    );
    expect(classifyError(messageOf({ errorMessage: 'Your input exceeds the context window of this model' }))).toBe(
      'overflow',
    );
  });

  it('③ 配额文案族 → quota（在 transient 正则之前——rate limit 归 transient、quota 族细分诊断桶）', () => {
    for (const text of ['insufficient_quota: usage limit reached', 'billing hard limit exceeded', 'out of budget']) {
      expect(classifyError(messageOf({ errorMessage: text }))).toBe('quota');
    }
  });

  it('④ transient 正则（429/5xx/网络/流早断）→ transient', () => {
    expect(classifyError(messageOf({ errorMessage: 'rate limit exceeded, retry after 30s' }))).toBe('transient');
    expect(classifyError(messageOf({ errorMessage: '503 service unavailable' }))).toBe('transient');
    expect(classifyError(messageOf({ errorMessage: 'fetch failed: connection refused' }))).toBe('transient');
  });

  it('⑤ 其余 → non-retryable（保守：未知/auth/参数类不重试）', () => {
    expect(classifyError(messageOf({ errorMessage: 'invalid x-api-key' }))).toBe('non-retryable');
    expect(classifyError(messageOf({ errorMessage: '某个未知错误' }))).toBe('non-retryable');
  });

  it('文案取值面：errorMessage 缺席退 content 首文本块', () => {
    const msg = messageOf({ content: [{ type: 'text', text: 'insufficient_quota via content' }] });
    expect(classifyError(msg)).toBe('quota');
  });
});

describe('isContextOverflow（三路覆盖透传）', () => {
  it('静默溢出（stop + input+cacheRead 超窗）——传窗口才启用', () => {
    const msg = messageOf({
      stopReason: 'stop',
      usage: { ...NO_USAGE, input: 1500 },
    });
    expect(isContextOverflow(msg, 1000)).toBe(true);
    expect(isContextOverflow(msg)).toBe(false); // 无窗口 = 此路关闭
  });

  it('length 零输出且 input 填满窗口（截断填满型）', () => {
    const msg = messageOf({
      stopReason: 'length',
      usage: { ...NO_USAGE, input: 990 },
    });
    expect(isContextOverflow(msg, 1000)).toBe(true);
  });

  it('限流文案不误判溢出（NON_OVERFLOW 排除面）', () => {
    expect(isContextOverflow(messageOf({ errorMessage: 'rate limit: too many requests' }))).toBe(false);
  });
});

describe('isRecoverableLength', () => {
  it('length 且 output 低于预期上限 → true（允许一次有界 compact-and-retry）', () => {
    expect(isRecoverableLength(messageOf({ stopReason: 'length', usage: { ...NO_USAGE, output: 100 } }), 4000)).toBe(
      true,
    );
    // output 恰达上限 = 正常截断，不可恢复
    expect(isRecoverableLength(messageOf({ stopReason: 'length', usage: { ...NO_USAGE, output: 4000 } }), 4000)).toBe(
      false,
    );
  });
});

describe('retryAssistantCall（有界重试零件语义）', () => {
  it('非可重试（quota 文案）立即返回不重试', async () => {
    let calls = 0;
    const final = await retryAssistantCall(
      async () => {
        calls++;
        return messageOf({ errorMessage: 'insufficient_quota' });
      },
      { enabled: true, maxRetries: 2, baseDelayMs: 1 },
    );
    expect(calls).toBe(1);
    expect(final.stopReason).toBe('error');
  });

  it('transient（rate limit）按 maxRetries 重试后成功', async () => {
    let calls = 0;
    const final = await retryAssistantCall(
      async () => {
        calls++;
        return calls === 1 ? messageOf({ errorMessage: 'rate limit exceeded' }) : messageOf({ stopReason: 'stop' });
      },
      { enabled: true, maxRetries: 1, baseDelayMs: 1 },
    );
    expect(calls).toBe(2);
    expect(final.stopReason).toBe('stop');
  });

  it('aborted 终态永不重试原样返回', async () => {
    let calls = 0;
    const final = await retryAssistantCall(
      async () => {
        calls++;
        return messageOf({ stopReason: 'aborted', errorMessage: 'cancelled' });
      },
      { enabled: true, maxRetries: 2, baseDelayMs: 1 },
    );
    expect(calls).toBe(1);
    expect(final.stopReason).toBe('aborted');
  });

  it('policy 禁用 = 直通第一响应', async () => {
    let calls = 0;
    const final = await retryAssistantCall(
      async () => {
        calls++;
        return messageOf({ errorMessage: 'rate limit exceeded' });
      },
      { enabled: false, maxRetries: 3, baseDelayMs: 1 },
    );
    expect(calls).toBe(1);
    expect(final.stopReason).toBe('error');
  });
});
