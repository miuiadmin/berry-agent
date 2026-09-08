/**
 * tools/pipeline 测试 — 三段编舞全路径（04 §7：schema → 守门 → 执行 → 后处理）。
 *
 * 纪律：mock 零件——EventDispatch 全真（context 件）、工具 execute 为最小真
 * 执行体；守门/执行/后处理监听器即被测编舞的参与者（注入的是行为不是替身）。
 */
import { describe, it, expect } from 'vitest';
import { Type } from 'typebox';
import { EventDispatch } from '../context/index.js';
import { BaseError, TOOL_EVENT_NAMES } from '../contracts/index.js';
import type {
  ExecuteInput,
  GateDecisionRecord,
  GateInput,
  PostExecuteInput,
  TextContent,
  ToolDefinition,
} from '../contracts/index.js';
import { createToolPipeline } from './pipeline.js';

/* ---------------- 测试构造件 ---------------- */

/** 组装一套「分派器 + 管道」并注册 tools 词汇（每个用例独立一套——监听器互不渗漏） */
function makeRig(pipelineOpts?: Parameters<typeof createToolPipeline>[1]) {
  const dispatch = new EventDispatch();
  dispatch.registerEventNames(TOOL_EVENT_NAMES);
  const decisions: GateDecisionRecord[] = [];
  const executor = createToolPipeline(dispatch, {
    onGateDecision: (record) => decisions.push(record),
    ...pipelineOpts,
  });
  return { dispatch, executor, decisions };
}

/** 最小真工具（typebox schema + 可覆写 execute） */
function makeTool(overrides?: Partial<ToolDefinition>): ToolDefinition {
  return {
    name: 'demo',
    description: '测试工具',
    parameters: Type.Object({ n: Type.Integer() }),
    execute: async () => ({ content: [{ type: 'text', text: 'ok' } satisfies TextContent] }),
    ...overrides,
  };
}

/** 断言管道拒绝形：BaseError 且码相符（异步腿两查——类型 + 码） */
async function expectCode(p: Promise<unknown>, code: string): Promise<void> {
  await expect(p).rejects.toThrow(BaseError);
  await expect(p).rejects.toMatchObject({ code });
}

describe('第 0 段：schema 校验（前置步）', () => {
  it('参数不合 schema → TOOL_INVALID_ARGS，不进守门段', async () => {
    const { dispatch, executor, decisions } = makeRig();
    let gateSeen = false;
    dispatch.onWaterfall<GateInput>('tools_pre_execute', (input, next) => {
      gateSeen = true;
      return next(input);
    });
    await expect(executor(makeTool(), 'call-1', { n: '不是整数' })).rejects.toMatchObject({
      code: 'TOOL_INVALID_ARGS',
    });
    expect(gateSeen).toBe(false);
    expect(decisions).toHaveLength(0);
  });

  it('错误信息含 code 首缀与具体问题（可纠正回执）', async () => {
    const { executor } = makeRig();
    const p = executor(makeTool(), 'call-1', {});
    await expect(p).rejects.toThrow(/\[TOOL_INVALID_ARGS\]/);
  });
});

describe('第 1 段：守门（waterfall + fail-closed）', () => {
  it('无监听器直通：执行 + 决策落账 allow', async () => {
    const { executor, decisions } = makeRig();
    const result = await executor(makeTool(), 'call-1', { n: 1 });
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'ok' });
    expect(decisions).toEqual([{ toolCallId: 'call-1', decision: 'allow', reason: 'ok' }]);
  });

  it('block 短路：执行体不被调、TOOL_BLOCKED、决策落账 block', async () => {
    const { dispatch, executor, decisions } = makeRig();
    let executed = false;
    dispatch.onWaterfall<GateInput>('tools_pre_execute', (input, next) => {
      if (input.tool.name === 'demo') {
        input.outcome = { action: 'block', reason: '守门测试拒绝' };
        return Promise.resolve(input); // 不调 next = 短路
      }
      return next(input);
    });
    await expectCode(
      executor(
        makeTool({
          execute: async () => {
            executed = true;
            return { content: [] };
          },
        }),
        'call-1',
        { n: 1 },
      ),
      'TOOL_BLOCKED',
    );
    expect(executed).toBe(false);
    expect(decisions).toEqual([{ toolCallId: 'call-1', decision: 'block', reason: '守门测试拒绝' }]);
  });

  it('mutate 改参：执行体收到改后参数、决策落账 mutate', async () => {
    const { dispatch, executor, decisions } = makeRig();
    let seenN: unknown;
    dispatch.onWaterfall<GateInput>('tools_pre_execute', (input, next) => {
      input.args = { ...input.args, n: 42 };
      input.mutated = true;
      return next(input);
    });
    const tool = makeTool({
      execute: async (args) => {
        seenN = args.n;
        return { content: [] };
      },
    });
    await executor(tool, 'call-1', { n: 1 });
    expect(seenN).toBe(42);
    expect(decisions).toEqual([{ toolCallId: 'call-1', decision: 'mutate', reason: 'ok' }]);
  });

  it('放行来源标注（04 §9 命中审计）：守门者置 allowReason → gate/decision reason 承接（缺省仍 ok）', async () => {
    const { dispatch, executor, decisions } = makeRig();
    dispatch.onWaterfall<GateInput>('tools_pre_execute', (input, next) => {
      input.allowReason = 'allowlist:0'; // 免问面命中的守门者置（safety gate 同形）
      return next(input);
    });
    await executor(makeTool(), 'call-1', { n: 1 });
    expect(decisions).toEqual([{ toolCallId: 'call-1', decision: 'allow', reason: 'allowlist:0' }]);
  });

  it('守门载荷透传 sessionId（04 §7 批 15d 补注——checkpoint 按会话判 per-run）', async () => {
    const { dispatch, executor } = makeRig();
    let seen: string | undefined;
    dispatch.onWaterfall<GateInput>('tools_pre_execute', (input, next) => {
      seen = input.sessionId;
      return next(input);
    });
    await executor(makeTool(), 'call-1', { n: 1 }, undefined, undefined, 'sess-42');
    expect(seen).toBe('sess-42');
  });

  it('无会话调用不带 sessionId 字段（缺省形态——守门面 undefined 判据）', async () => {
    const { dispatch, executor } = makeRig();
    let seen: string | undefined;
    dispatch.onWaterfall<GateInput>('tools_pre_execute', (input, next) => {
      seen = input.sessionId;
      return next(input);
    });
    await executor(makeTool(), 'call-1', { n: 1 });
    expect(seen).toBeUndefined();
  });

  it('守门监听器抛错 → fail-closed：TOOL_GATE_FAILED + 决策落账 block（审计链不断头）', async () => {
    const { dispatch, executor, decisions } = makeRig();
    dispatch.onWaterfall<GateInput>('tools_pre_execute', async () => {
      throw new Error('监听器自身故障');
    });
    await expectCode(executor(makeTool(), 'call-1', { n: 1 }), 'TOOL_GATE_FAILED');
    expect(decisions).toEqual([
      { toolCallId: 'call-1', decision: 'block', reason: expect.stringContaining('TOOL_GATE_FAILED') },
    ]);
  });
});

describe('第 2 段：执行（around-dispatch + 预算竞速）', () => {
  it('def.timeoutMs 超时 → TOOL_TIMEOUT（预算先到即拒，不杀 promise）', async () => {
    const { executor } = makeRig();
    const slow = makeTool({
      timeoutMs: 30,
      execute: () => new Promise((resolve) => setTimeout(() => resolve({ content: [] }), 400)),
    });
    await expectCode(executor(slow, 'call-1', { n: 1 }), 'TOOL_TIMEOUT');
  });

  it('缺省预算走管道 defaultTimeoutMs（未设 timeoutMs 的工具同受管）', async () => {
    const { executor } = makeRig({ defaultTimeoutMs: 30 });
    const slow = makeTool({
      execute: () => new Promise((resolve) => setTimeout(() => resolve({ content: [] }), 400)),
    });
    await expectCode(executor(slow, 'call-1', { n: 1 }), 'TOOL_TIMEOUT');
  });

  it('around-dispatch 包装：执行监听者可前置/后置包住真执行', async () => {
    const { dispatch, executor } = makeRig();
    const trace: string[] = [];
    dispatch.onWaterfall<ExecuteInput>('tools_execute', (next, downstream) => {
      // 包装闭包：前置 → 调原闭包 → 后置
      return downstream(async () => {
        trace.push('before');
        const result = await next();
        trace.push('after');
        return result;
      });
    });
    const result = await executor(makeTool(), 'call-1', { n: 1 });
    expect(trace).toEqual(['before', 'after']);
    expect(result.content[0]).toMatchObject({ type: 'text', text: 'ok' });
  });

  it('ToolContext 透传：toolCallId/signal/onUpdate/sessionId 到达执行体', async () => {
    const { executor } = makeRig();
    const seen: Array<Record<string, unknown>> = [];
    const tool = makeTool({
      execute: async (_args, toolCtx) => {
        seen.push({ toolCallId: toolCtx.toolCallId, onUpdate: typeof toolCtx.onUpdate, sessionId: toolCtx.sessionId });
        return { content: [] };
      },
    });
    await executor(tool, 'call-9', { n: 1 }, undefined, () => undefined, 'sess-A');
    expect(seen[0]).toEqual({ toolCallId: 'call-9', onUpdate: 'function', sessionId: 'sess-A' });
  });
});

describe('第 3 段：后处理 + 输出护栏（固定链尾）', () => {
  it('tools_post_execute 可就地改写 result（管道返回改写后）', async () => {
    const { dispatch, executor } = makeRig();
    dispatch.onWaterfall<PostExecuteInput>('tools_post_execute', (input, next) => {
      input.result = { ...input.result, content: [{ type: 'text', text: '被后处理改写' }] };
      return next(input);
    });
    const result = await executor(makeTool(), 'call-1', { n: 1 });
    expect(result.content[0]).toMatchObject({ text: '被后处理改写' });
  });

  it('输出护栏：文本超帽保尾截断 + spill 全文落临时目录 + 注记含路径', async () => {
    const { executor } = makeRig({ outputGuardBytes: 16 });
    const big = 'x'.repeat(200);
    const tool = makeTool({
      execute: async () => ({ content: [{ type: 'text', text: big }] }),
    });
    const result = await executor(tool, 'call-spill', { n: 1 });
    const text = (result.content[0] as TextContent).text;
    expect(text).toContain('已保尾截断');
    const spillMatch = text.match(/外溢至 (\S+\.txt)/);
    expect(spillMatch).not.toBeNull();
    const { readFile } = await import('node:fs/promises');
    const spillPath = spillMatch?.[1];
    expect(typeof spillPath).toBe('string');
    const spilled = await readFile(spillPath as string, 'utf8');
    expect(spilled).toBe(big);
  });

  it('护栏只钳文本 content：image 块原样保留', async () => {
    const { executor } = makeRig({ outputGuardBytes: 8 });
    const tool = makeTool({
      execute: async () => ({
        content: [
          { type: 'text', text: 'tiny' },
          { type: 'image', data: 'aGk=', mimeType: 'image/png' },
        ],
      }),
    });
    const result = await executor(tool, 'call-2', { n: 1 });
    expect(result.content.some((part) => part.type === 'image')).toBe(true);
  });

  it('未超帽零改动（无注记注入）', async () => {
    const { executor } = makeRig();
    const result = await executor(makeTool(), 'call-1', { n: 1 });
    expect((result.content[0] as TextContent).text).toBe('ok');
  });
});

describe('出口消毒（出口治理③——护栏之前一步）', () => {
  it('模式腿恒在场：provider 缺席时敏感键名赋值形仍消毒', async () => {
    const { executor } = makeRig();
    const tool = makeTool({
      execute: async () => ({ content: [{ type: 'text', text: 'GITHUB_TOKEN=ghp_abcdef1234 ok' }] }),
    });
    const result = await executor(tool, 'call-redact-1', { n: 1 });
    expect((result.content[0] as TextContent).text).toBe('GITHUB_TOKEN=[REDACTED:secret] ok');
  });

  it('值基腿注入：活值出现即整段置换（provider live 读）', async () => {
    let live = 'sk-live-first12345';
    const { executor } = makeRig({ sensitiveValues: () => [live] });
    const tool = makeTool({
      execute: async () => ({ content: [{ type: 'text', text: 'err at sk-live-first12345' }] }),
    });
    expect(((await executor(tool, 'call-r2', { n: 1 })).content[0] as TextContent).text).toBe(
      'err at [REDACTED:credential]',
    );
    // live 语义：provider 值变更后下一次调用用新值（工具执行期间轮换的凭证同覆盖）
    live = 'sk-live-second6789';
    const tool2 = makeTool({ execute: async () => ({ content: [{ type: 'text', text: 'x sk-live-second6789' }] }) });
    expect(((await executor(tool2, 'call-r3', { n: 1 })).content[0] as TextContent).text).toBe(
      'x [REDACTED:credential]',
    );
  });

  it('details 字符串叶同消毒（敏感键携裸值——对象键判定腿）', async () => {
    const { executor } = makeRig();
    const tool = makeTool({
      execute: async () => ({ content: [{ type: 'text', text: 'done' }], details: { apiKey: 'sk-bare-98765432' } }),
    });
    const result = await executor(tool, 'call-r4', { n: 1 });
    expect(result.details).toMatchObject({ apiKey: '[REDACTED:secret]' });
  });

  it('provider 故障降级纯模式腿：结果不炸 + 模式消毒仍执法', async () => {
    const { executor } = makeRig({
      sensitiveValues: () => {
        throw new Error('store boom');
      },
    });
    const tool = makeTool({
      execute: async () => ({ content: [{ type: 'text', text: 'GITHUB_TOKEN=ghp_abcdef1234' }] }),
    });
    const result = await executor(tool, 'call-r5', { n: 1 });
    expect((result.content[0] as TextContent).text).toBe('GITHUB_TOKEN=[REDACTED:secret]');
  });

  it('消毒先于截断：spill 外溢文件同持消毒产物（防旁路）', async () => {
    const secret = 'sk-spill-abcdefgh';
    const { executor } = makeRig({ outputGuardBytes: 16, sensitiveValues: () => [secret] });
    const big = `${secret} ${'x'.repeat(200)}`;
    const tool = makeTool({ execute: async () => ({ content: [{ type: 'text', text: big }] }) });
    const result = await executor(tool, 'call-spill-redact', { n: 1 });
    const text = (result.content[0] as TextContent).text;
    expect(text).not.toContain(secret);
    const spillMatch = text.match(/外溢至 (\S+\.txt)/);
    expect(spillMatch).not.toBeNull();
    const { readFile } = await import('node:fs/promises');
    const spilled = await readFile(spillMatch![1]!, 'utf8');
    expect(spilled).not.toContain(secret);
    expect(spilled).toContain('[REDACTED:credential]');
  });
});
