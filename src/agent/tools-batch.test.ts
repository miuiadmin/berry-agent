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

/* ---------------- 单响应工具批护栏（04 §2——闸①call_id 幂等 + 闸②批调用帽） ---------------- */

describe('单响应工具批护栏（消费序前插 limiter——零改 loop 骨架）', () => {
  it('闸②缺省帽 32：34 条 → 前 32 执行、末 2 逐条 isError 配对（原因注明超限）+ droppedCount 暴露', async () => {
    const started: string[] = [];
    const { config, context, emit } = rig([gatedTool('echo', started, undefined)]);
    const calls = Array.from({ length: 34 }, (_, i) => callOf(`c${i + 1}`, 'echo'));
    const outcome = await executeToolBatch(config, context, calls, emit);
    expect(started).toHaveLength(32); // 丢尾不执行
    expect(outcome.results).toHaveLength(34); // 配对完整——被丢 calls 不悬空（防孤儿 toolUse）
    expect(outcome.droppedCount).toBe(2); // 丢弃计数暴露（非静默）
    expect(outcome.results[32]).toMatchObject({ toolCallId: 'c33', isError: true });
    expect(outcome.results[33]).toMatchObject({ toolCallId: 'c34', isError: true });
    const tailText = outcome.results[32]!.content[0] as { type: 'text'; text: string };
    expect(tailText.text).toContain('超'); // 原因注明超限
    expect(outcome.results[0]).toMatchObject({ toolCallId: 'c1', isError: false });
    expect(outcome.results[31]).toMatchObject({ toolCallId: 'c32', isError: false });
  });

  it('闸②可配置：maxToolCallsPerResponse=2 时 3 条 → 2 执行 1 丢尾', async () => {
    const started: string[] = [];
    const { context, emit } = rig([gatedTool('echo', started, undefined)]);
    const config = {
      model: 'test/model',
      maxToolCallsPerResponse: 2,
    } as unknown as AgentLoopConfig; // 外层收口断言（单元面只需 model + 帽位子集）
    const outcome = await executeToolBatch(
      config,
      context,
      [callOf('c1', 'echo'), callOf('c2', 'echo'), callOf('c3', 'echo')],
      emit,
    );
    expect(started).toEqual(['echo', 'echo']);
    expect(outcome.droppedCount).toBe(1);
    expect(outcome.results[2]).toMatchObject({ toolCallId: 'c3', isError: true });
  });

  it('闸①批内同 id 重现：第二条不重执行——直接回执既有结果（单条 tool_execution_start）', async () => {
    const started: string[] = [];
    const { config, context, emit, events } = rig([gatedTool('echo', started, undefined)]);
    const outcome = await executeToolBatch(config, context, [callOf('x', 'echo'), callOf('x', 'echo')], emit);
    expect(started).toEqual(['echo']); // 只执行一次
    expect(outcome.results).toHaveLength(2); // 同 id 两块 toolUse 各得一条配对
    expect(outcome.results[0]).toMatchObject({ isError: false });
    expect(outcome.results[1]).toMatchObject({ isError: false });
    const first = outcome.results[0]!.content[0] as { type: 'text'; text: string };
    const second = outcome.results[1]!.content[0] as { type: 'text'; text: string };
    expect(second.text).toBe(first.text); // 回执既有结果（内容一致）
    expect(events.filter((e) => e.type === 'tool_execution_start')).toHaveLength(1); // 回执腿不发执行活体事件
  });

  it('闸①跨轮同 id：同 context 第二批重发已执行 id → 不重执行（strix wait→check 轮询防回归锁）', async () => {
    const started: string[] = [];
    const { config, context, emit } = rig([gatedTool('check', started, undefined)]);
    await executeToolBatch(config, context, [callOf('x', 'check')], emit);
    const outcome2 = await executeToolBatch(config, context, [callOf('x', 'check')], emit);
    expect(started).toEqual(['check']); // 跨轮同律——重放不重执行
    expect(outcome2.results[0]).toMatchObject({ isError: false });
    expect(outcome2.droppedCount).toBe(0);
  });

  it('闸①丢尾腿不进账本：被超帽丢弃的 id 重发时按新调用执行（非回执超限错误）', async () => {
    const started: string[] = [];
    const { context, emit } = rig([gatedTool('echo', started, undefined)]);
    const config = { model: 'test/model', maxToolCallsPerResponse: 1 } as unknown as AgentLoopConfig;
    await executeToolBatch(config, context, [callOf('a', 'echo'), callOf('b', 'echo')], emit);
    expect(started).toEqual(['echo']); // b 被丢尾（isError 配对但未执行）
    const outcome2 = await executeToolBatch(config, context, [callOf('b', 'echo')], emit);
    expect(started).toEqual(['echo', 'echo']); // b 未进账本——重发按新调用执行
    expect(outcome2.results[0]).toMatchObject({ isError: false });
  });

  it('闸①回执腿不否决 terminate：纯回执批空真通过恒 terminate（重放循环卡死的停跑兜底——strix 病理）', async () => {
    const started: string[] = [];
    const { config, context, emit } = rig([gatedTool('poll', started, undefined)]);
    // 首批：真实执行腿 terminate:false → 一票续跑律（terminate false）
    const first = await executeToolBatch(config, context, [callOf('x', 'poll')], emit);
    expect(first.terminate).toBe(false); // 真实执行腿投了 false
    // 纯回执批：非执行腿不否决——空真通过与零执行中止批同律，恒 terminate
    //（不停跑则模型每轮空转重放烧 token——正是要兜的病理）
    const replayed = await executeToolBatch(config, context, [callOf('x', 'poll')], emit);
    expect(replayed.terminate).toBe(true); // 纯回执批停跑
    expect(replayed.results[0]).toMatchObject({ isError: false });
    // 混合批：一条真实执行腿 false 一票即续跑（回执腿不放大也不否决）
    const mixed = await executeToolBatch(config, context, [callOf('x', 'poll'), callOf('y', 'poll')], emit);
    expect(mixed.terminate).toBe(false); // y 真实执行投 false
    expect(started).toEqual(['poll', 'poll']); // y 执行了（x 回执不重执行）
  });
});
