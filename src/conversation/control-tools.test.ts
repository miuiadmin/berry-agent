/**
 * 跨会话操控工具族测试（03 §2.2 第十一面模型道——e-4 操控腿）。
 *
 * 薄包装面：三件在场恒挂载 / caller 闭包归因（execute 铸
 * {kind:'session', sessionId}——模型不可伪造送话身份）/ 受理器 BaseError
 * 折 `[CODE] message` isError（obs guard 同形）/ 回执 JSON 结构化呈报 /
 * 非 BaseError 透传。动词语义/执法序归 control.test（受理器全景）——
 * 层分立：本测受理器替身受控入参断言。
 */
import { describe, expect, it } from 'vitest';
import { BaseError, type ToolDefinition } from '../contracts/index.js';
import { createControlTools } from './control-tools.js';
import type { ControlCaller, SessionsControlFace } from './control.js';

/** 受控受理器替身（入参全录——caller 归因断言位） */
function recordingControl(opts?: { sendError?: Error }): {
  face: SessionsControlFace;
  calls: Array<{ verb: string; input: unknown }>;
} {
  const calls: Array<{ verb: string; input: unknown }> = [];
  return {
    calls,
    face: {
      async send(input) {
        calls.push({ verb: 'send', input });
        if (opts?.sendError !== undefined) throw opts.sendError;
        return { status: 'queued', messageId: 'msg-1' };
      },
      async interrupt(input) {
        calls.push({ verb: 'interrupt', input });
        return { status: 'interrupted', targetSessionId: (input as { targetSessionId: string }).targetSessionId };
      },
      async withdraw(input) {
        calls.push({ verb: 'withdraw', input });
        return { status: 'withdrawn', messageId: (input as { messageId: string }).messageId };
      },
    },
  };
}

/** 工具集速构 */
function toolsFor(control: SessionsControlFace, callerSessionId = 's-caller'): readonly ToolDefinition[] {
  return createControlTools({ callerSessionId, control });
}

/** 工具名取件 */
const tool = (defs: readonly ToolDefinition[], name: string): ToolDefinition => {
  const found = defs.find((def) => def.name === name);
  if (found === undefined) throw new Error(`工具 ${name} 不在族中`);
  return found;
};

/** 执行参数速构（ToolDefinition execute 入参宽松形——toolCtx 以 any 填） */
const arg = (value: Record<string, unknown>): Parameters<ToolDefinition['execute']> => [value, expect.anything()];

describe('操控工具族——三件在场与薄包装', () => {
  it('三件恒挂载（session_send/interrupt/withdraw）+ effect=write（模型可见清单恒在）', () => {
    const defs = toolsFor(recordingControl().face);
    expect(defs.map((def) => def.name)).toEqual(['session_send', 'session_interrupt', 'session_withdraw']);
    for (const def of defs) expect(def.effect).toBe('write');
  });

  it('session_send：caller 闭包归因 {kind:"session",sessionId}——模型传不进身份', async () => {
    const rec = recordingControl();
    const send = tool(toolsFor(rec.face, 's-a'), 'session_send');
    // 入参无 caller 位（schema additionalProperties:false）——受理面收到的
    // caller 恒为装配位闭包值
    const result = await send.execute(...arg({ sessionId: 's-b', text: 'hi', expectedTurnId: 3 }));
    expect(rec.calls).toEqual([
      {
        verb: 'send',
        input: { caller: { kind: 'session', sessionId: 's-a' }, targetSessionId: 's-b', text: 'hi', expectedTurnId: 3 },
      },
    ]);
    expect(result).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ status: 'queued', messageId: 'msg-1' }) }],
    });
  });

  it('session_send 拒码折呈：受理器 BaseError → [CODE] message isError（obs guard 同形）', async () => {
    const rec = recordingControl({
      sendError: new BaseError('SESSION_CONTROL_DENIED', '高危面未开门（sessions.control-cross）'),
    });
    const send = tool(toolsFor(rec.face), 'session_send');
    const result = await send.execute(...arg({ sessionId: 's-b', text: 'hi' }));
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      { type: 'text', text: '[SESSION_CONTROL_DENIED] 高危面未开门（sessions.control-cross）' },
    ]);
  });

  it('受理器普通 Error 透传 throw（guard 只折 BaseError——调用方 bug 不吞）', async () => {
    const rec = recordingControl({ sendError: new Error('send 拒收空文本（调用方 bug——注入文本非空是调用方契约）') });
    const send = tool(toolsFor(rec.face), 'session_send');
    await expect(send.execute(...arg({ sessionId: 's-b', text: '  ' }))).rejects.toThrowError(/空文本/);
  });

  it('session_interrupt / session_withdraw：入参透传 + caller 闭包同源', async () => {
    const rec = recordingControl();
    const defs = toolsFor(rec.face, 's-a');
    const interruptResult = await tool(defs, 'session_interrupt').execute(...arg({ sessionId: 's-b' }));
    expect(interruptResult).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ status: 'interrupted', targetSessionId: 's-b' }) }],
    });
    const withdrawResult = await tool(defs, 'session_withdraw').execute(
      ...arg({ sessionId: 's-b', messageId: 'msg-1' }),
    );
    expect(withdrawResult).toEqual({
      content: [{ type: 'text', text: JSON.stringify({ status: 'withdrawn', messageId: 'msg-1' }) }],
    });
    expect(rec.calls.map((c) => (c.input as { caller: ControlCaller }).caller)).toEqual([
      { kind: 'session', sessionId: 's-a' },
      { kind: 'session', sessionId: 's-a' },
    ]);
  });
});
