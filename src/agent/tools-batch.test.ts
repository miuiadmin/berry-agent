/**
 * agent/tools-batch 测试 — 读写批调度（03 §2.3 尾注——effect 一位两用的消费执法）。
 *
 * 纪律：直测 executeToolBatch 单元面（分层——纯逻辑先于全栈；loop.test.ts 已覆盖
 * 集成路径）。并发/屏障断言用受控门（deferred promise）：起跑序与在飞重叠
 * 由事件序证明，不依赖真实时钟。
 */
import { describe, it, expect } from 'vitest';
import { executeToolBatch } from './tools-batch.js';
import type { AgentEvent } from './events.js';
import type { AgentTool } from '../contracts/index.js';
import type { AgentContext, AgentLoopConfig, EmitFn } from './types.js';

/* ---------------- 测试构造件 ---------------- */

/** 受控门：resolved 前执行体挂起（并发/屏障断言的时序探针） */
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * 记录起跑序的门控工具：execute 先记 name 再挂门。
 * @param log 起跑序收集数组 @param effect 效果面（缺省 read）@param hold 门（缺省即时过）
 */
function gatedTool(
  name: string,
  log: string[],
  effect: 'read' | 'write' | undefined,
  hold?: { promise: Promise<void> },
) {
  return {
    name,
    description: '测试工具',
    parameters: { type: 'object' },
    ...(effect !== undefined ? { effect } : {}),
    execute: async () => {
      log.push(name);
      if (hold) await hold.promise;
      return { content: [{ type: 'text' as const, text: name }] };
    },
  };
}

/** 直测台：最小 config + 事件收集（无 streamFn/钩子——单元面不需要） */
function rig(tools: AgentTool[]) {
  const events: AgentEvent[] = [];
  const emit: EmitFn = (e) => void events.push(e);
  const config = { model: 'test/model' } as AgentLoopConfig;
  const context: AgentContext = { messages: [], tools };
  return { config, context, emit, events };
}

/** 调用块 */
function callOf(id: string, name: string) {
  return { type: 'toolCall' as const, id, name, arguments: {} };
}

/* ---------------- 读写批调度 ---------------- */

describe('读写批调度（effect 一位两用——03 §2.3 尾注）', () => {
  it('read 段内并发：两个门控 read 均已起跑才放行（重叠证明），结果按原序落位', async () => {
    const started: string[] = [];
    const r1Gate = gate();
    const r2Gate = gate();
    const { config, context, emit } = rig([
      gatedTool('r1', started, undefined, r1Gate),
      gatedTool('r2', started, undefined, r2Gate),
    ]);
    // r1 先起跑、r2 随后起跑——旧串行路径下 r2 必等 r1 结算，永不到齐
    const pending = executeToolBatch(config, context, [callOf('c1', 'r1'), callOf('c2', 'r2')], emit);
    await Promise.resolve(); // 让 r1 起跑挂门
    r2Gate.release(); // r2 未起跑即放行也无效——但并发路径会自己起跑
    await new Promise((r) => setTimeout(r, 0)); // 微任务两拍：两腿都进入 execute
    expect(started).toEqual(['r1', 'r2']); // 两者都在飞（r1 仍挂门）
    r1Gate.release();
    const outcome = await pending;
    expect(outcome.results.map((m) => m.toolName)).toEqual(['r1', 'r2']); // 原序
    expect(outcome.terminate).toBe(false);
  });

  it('write 屏障：r1 在飞时 w 不起跑；w 在飞时 r2 不起跑；结算序 = r1 → w → r2', async () => {
    const started: string[] = [];
    const r1Gate = gate();
    const wGate = gate();
    const { config, context, emit } = rig([
      gatedTool('r1', started, undefined, r1Gate),
      gatedTool('w', started, 'write', wGate),
      gatedTool('r2', started, undefined),
    ]);
    const pending = executeToolBatch(
      config,
      context,
      [callOf('c1', 'r1'), callOf('c2', 'w'), callOf('c3', 'r2')],
      emit,
    );
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(['r1']); // w 未起跑（写前清空在飞只读）
    r1Gate.release();
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(['r1', 'w']); // r1 结算后 w 才起跑；r2 未起跑
    wGate.release();
    const outcome = await pending;
    expect(started).toEqual(['r1', 'w', 'r2']); // w 结算后 r2 起跑（写后 read 待其结算）
    expect(outcome.results.map((m) => m.toolName)).toEqual(['r1', 'w', 'r2']); // 原序
  });

  it('连续 write 各自独立屏障：w1 → w2 严格串行', async () => {
    const started: string[] = [];
    const w1Gate = gate();
    const { config, context, emit } = rig([
      gatedTool('w1', started, 'write', w1Gate),
      gatedTool('w2', started, 'write'),
    ]);
    const pending = executeToolBatch(config, context, [callOf('c1', 'w1'), callOf('c2', 'w2')], emit);
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toEqual(['w1']); // w2 未起跑
    w1Gate.release();
    const outcome = await pending;
    expect(started).toEqual(['w1', 'w2']);
    expect(outcome.results.map((m) => m.toolName)).toEqual(['w1', 'w2']);
  });

  it('工具不在场（lookup 失败）视同 read 入段——回配置漂移 isError 不炸批', async () => {
    const started: string[] = [];
    const { config, context, emit } = rig([gatedTool('real', started, undefined)]);
    const outcome = await executeToolBatch(config, context, [callOf('c1', 'ghost'), callOf('c2', 'real')], emit);
    expect(started).toEqual(['real']); // ghost 不在场但批仍执行到 real
    expect(outcome.results[0]).toMatchObject({ toolName: 'ghost', isError: true });
    expect(outcome.results[1]).toMatchObject({ toolName: 'real', isError: false });
  });
});

/* ---------------- 错误腿出口消毒（出口治理③ 定形③） ---------------- */

describe('错误腿出口消毒（错误即结果 ⑤ 与正常结果同一出口语义——纯模式腿）', () => {
  it('execute 抛错携秘密（stderr env dump 形）→ 包装位同过模式消毒', async () => {
    const boom = {
      name: 'boom',
      description: '测试工具',
      parameters: { type: 'object' },
      execute: async () => {
        throw new Error('命令失败：GITHUB_TOKEN=ghp_abcdef123456 未授权');
      },
    };
    const { config, context, emit } = rig([boom]);
    const outcome = await executeToolBatch(config, context, [callOf('c1', 'boom')], emit);
    expect(outcome.results[0]).toMatchObject({ isError: true });
    const text = outcome.results[0]!.content[0] as { type: 'text'; text: string };
    expect(text.text).toContain('GITHUB_TOKEN=[REDACTED:secret]');
    expect(text.text).not.toContain('ghp_abcdef123456');
  });

  it('beforeToolCall block 拒因携秘密 → buildResult 扼点同过模式消毒', async () => {
    const tool = {
      name: 't',
      description: '测试工具',
      parameters: { type: 'object' },
      execute: async () => ({ content: [{ type: 'text' as const, text: 'ok' }] }),
    };
    const { context, emit } = rig([tool]);
    const config = {
      model: 'test/model',
      beforeToolCall: async () => ({ block: '危险参数：api_key=sk-blockme123456' }),
      // 外层收口断言（as unknown as）：单元面只需 model + beforeToolCall 子集——
      // streamFn/convertToLlm 缺席是本测试构造件的常态（rig 同族单向收口形）
    } as unknown as AgentLoopConfig;
    const outcome = await executeToolBatch(config, context, [callOf('c1', 't')], emit);
    expect(outcome.results[0]).toMatchObject({ isError: true });
    const text = outcome.results[0]!.content[0] as { type: 'text'; text: string };
    expect(text.text).toContain('api_key=[REDACTED:secret]');
    expect(text.text).not.toContain('sk-blockme123456');
  });
});
