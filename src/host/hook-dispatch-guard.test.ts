/**
 * host — 钩子派发段 guard 集成测试（03 §3.4 执法形定形注；cache 经济批 ca-3）。
 *
 * 钉死四面：
 * 1. guard 深度计数单元（初值 false / 嵌套取「在段内」/ 异常收口不减穿零）；
 * 2. 钩子 handler 执行段内 llm 双入口拒（LLM_CALL_IN_HOOK——waterfall/notify
 *    两腿各证：guard 经 createPluginContext 注入，withCallbackWindow 随派发
 *    开合，handler 内 await 单发即命中）；
 * 3. fire-and-forget 窗外合法（handler 内 queueMicrotask 起异步任务、派发
 *    收口后跑——「起异步任务不等结果合法、await 耦合违法」条款的合法面）；
 * 4. 工具执行体分界（enterHostCallback 下 guard 不开窗——只禁钩子段）。
 */
import { describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import type { Message } from '../contracts/index.js';
import { EventDispatch, Scope } from '../context/index.js';
import { CommandRegistry, createChannels } from '../channels/index.js';
import { createToolRegistry } from '../tools/index.js';
import { createJobRegistry, createSubagentService } from '../subagent/index.js';
import { fauxProvider } from '../llm/index.js';
import { createLlmRuntime } from '../llm/runtime.js';
import { createLlmService } from '../llm/complete.js';
import { createStreamFn } from '../llm/stream-fn.js';
import { createPluginContext, PLUGIN_HOOK_VOCABULARY } from './plugin-context.js';
import type { PluginContextHandle } from './plugin-context.js';
import { PromptSectionRegistry } from './prompt-sections.js';
import { TriggerRegistry } from './triggers.js';
import { createHookDispatchGuard } from './hook-dispatch-guard.js';
// 错误码册注册腿（import 发生才注册——拒码断言的前置副作用）
import './codes.js';

/** 宿主自省面测试替身（plugin-context.test 同形） */
const HOST_FACE = {
  version: '0.1.0-alpha.1',
  apiVersion: '1.0',
  capabilities: { has: () => false, list: () => [] as string[] },
  experimental: { enabled: () => false },
} as const;

/**
 * 装配（plugin-context.test 精简形 + guard 注入）：返回真派发面与插件 ctx，
 * 与 faux llm 服务（真 createLlmService——mock 只停模型层）。
 */
function assembleWithGuard() {
  const guard = createHookDispatchGuard();
  const scope = Scope.createRoot();
  const dispatch = new EventDispatch();
  dispatch.registerEventNames(PLUGIN_HOOK_VOCABULARY.map((h) => h.name));
  const handle: PluginContextHandle = createPluginContext({
    pluginId: 'acme-guard',
    scope,
    dispatch,
    tools: createToolRegistry(dispatch),
    commands: new CommandRegistry(),
    uiBackends: createChannels(),
    llm: { registerProvider: () => () => undefined },
    promptSections: new PromptSectionRegistry(),
    triggers: new TriggerRegistry({ getOpens: () => new Set(), makeStarter: () => () => undefined }),
    subagents: createSubagentService({ registry: createJobRegistry() }),
    hostFace: HOST_FACE,
    hookDispatchGuard: guard,
  });
  // llm 双入口（与生产同形：同一 guard 只读面注入 complete + streamFn）
  const faux = fauxProvider({ provider: 'faux-guard', models: [{ id: 'm1' }] });
  const runtime = createLlmRuntime({ providers: [faux.provider] });
  const complete = createLlmService({
    runtime,
    defaultModel: () => 'faux-guard/m1',
    retry: { enabled: false, maxRetries: 0, baseDelayMs: 1 },
    hookDispatch: guard,
  });
  const streamFn = createStreamFn(runtime, {}, undefined, guard);
  return { guard, handle, dispatch, faux, complete, streamFn };
}

/* ---------------- guard 单元：深度计数 ---------------- */

describe('HookDispatchGuard 深度计数单元', () => {
  it('初值窗外（inHookDispatch false）；enter/exit 成对开合', () => {
    const guard = createHookDispatchGuard();
    expect(guard.inHookDispatch()).toBe(false);
    guard.enter();
    expect(guard.inHookDispatch()).toBe(true);
    guard.exit();
    expect(guard.inHookDispatch()).toBe(false);
  });

  it('嵌套取「在段内」语义——两层 enter 一层 exit 仍在段内', () => {
    const guard = createHookDispatchGuard();
    guard.enter();
    guard.enter();
    guard.exit();
    expect(guard.inHookDispatch()).toBe(true); // 跨插件嵌套钩子——深度 1 仍属段内
    guard.exit();
    expect(guard.inHookDispatch()).toBe(false);
  });
});

/* ---------------- 集成：钩子段内双入口拒 ---------------- */

describe('钩子派发段内 llm 双入口拒（LLM_CALL_IN_HOOK）', () => {
  it('notify 腿（session_start）：handler 内 await complete → BaseError 携码；派发收口后窗外归 false', async () => {
    const { guard, handle, dispatch, complete } = assembleWithGuard();
    let caught: unknown;
    handle.ctx.on('session_start', async () => {
      caught = await complete.complete({ messages: [{ role: 'user', content: 'x', timestamp: 1 }] }).catch((e) => e);
    });
    await dispatch.emit('session_start', {});
    expect(caught).toBeInstanceOf(BaseError);
    expect((caught as BaseError).code).toBe('LLM_CALL_IN_HOOK');
    expect(guard.inHookDispatch()).toBe(false); // 派发收口即闭窗
  });

  it('waterfall 腿（context_transform）：handler 内 await 流式 → 错误流携码', async () => {
    const { handle, dispatch, streamFn } = assembleWithGuard();
    let errorCode: string | undefined;
    handle.ctx.on('context_transform', async (messages, next) => {
      // ctx.on 宽型签名——此处 messages 即投影消息（waterfall 值链原样透传）
      const stream = await streamFn(
        { systemPrompt: 'sys', messages: messages as Message[] },
        { model: 'faux-guard/m1' },
      );
      errorCode = (await stream.result()).errorCode;
      return next(messages);
    });
    const out = await dispatch.waterfall('context_transform', [{ role: 'user', content: 'x', timestamp: 1 }]);
    expect(out).toHaveLength(1); // waterfall 语义不受执法影响——拒的是模型调用不是钩子结果
    expect(errorCode).toBe('LLM_CALL_IN_HOOK');
  });

  it('handler 抛异常路径守恒：finally 收口深度归零（开窗不因异常漏收）', async () => {
    const { guard, handle, dispatch } = assembleWithGuard();
    handle.ctx.on('session_start', () => {
      throw new Error('handler 炸了');
    });
    await dispatch.emit('session_start', {}).catch(() => undefined); // 钩子异常被派发面收口
    expect(guard.inHookDispatch()).toBe(false); // withCallbackWindow finally 兜底——异常路径 enter/exit 守恒
  });
});

/* ---------------- fire-and-forget：窗外合法面 ---------------- */

describe('fire-and-forget 窗外合法（起异步任务不等结果）', () => {
  it('handler 内 setTimeout 起 complete——宏任务在派发收口后窗外跑，正常完成（非 LLM_CALL_IN_HOOK）', async () => {
    const { handle, dispatch, faux, complete } = assembleWithGuard();
    faux.setResponses([
      () =>
        ({
          role: 'assistant',
          content: [{ type: 'text', text: 'ok' }],
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
          stopReason: 'stop',
          timestamp: 1,
        }) as never,
    ]);
    let settled: { ok: boolean; code?: string } | undefined;
    handle.ctx.on('session_start', () => {
      // 条款合法形（03 §3.4「Job / 子代理 / 定时器自理活」）：**宏任务**形——
      // 微任务形（queueMicrotask）不保证窗外：派发面内部任何 await 让出点
      // 都会先清微任务队列（派发 Promise 未收口、窗仍开）；宏任务必在微任务
      // 链清空后跑 = 派发已收口 = 窗外。
      setTimeout(() => {
        void complete
          .complete({ messages: [{ role: 'user', content: 'x', timestamp: 1 }] })
          .then(() => {
            settled = { ok: true };
          })
          .catch((e: unknown) => {
            settled = { ok: false, code: e instanceof BaseError ? e.code : 'unknown' };
          });
      }, 0);
    });
    await dispatch.emit('session_start', {});
    expect(settled).toBeUndefined(); // 宏任务未跑——handler 返回时确实没起没等
    // 排干宏任务（派发已收口 = 窗外）：调用正常完成证明执法未误伤合法面
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
    await new Promise<void>((resolve) => setTimeout(() => resolve(), 0));
    expect(settled).toEqual({ ok: true });
  });

  it('对照锁：handler 内直接 void complete（不等结果）仍拒——调用本身在 handler 同步段即窗内', async () => {
    const { handle, dispatch, complete } = assembleWithGuard();
    let settled: { ok: boolean; code?: string } | undefined;
    handle.ctx.on('session_start', () => {
      // 违例形：不等结果 ≠ 窗外——async 函数被调用的瞬间同步执行前置查，
      // 此刻仍在 withCallbackWindow 窗内 → 拒；「起」必须整体推迟（上例宏任务形）
      void complete
        .complete({ messages: [{ role: 'user', content: 'x', timestamp: 1 }] })
        .then(() => {
          settled = { ok: true };
        })
        .catch((e: unknown) => {
          settled = { ok: false, code: e instanceof BaseError ? e.code : 'unknown' };
        });
    });
    await dispatch.emit('session_start', {});
    expect(settled).toEqual({ ok: false, code: 'LLM_CALL_IN_HOOK' });
  });

  it('对照锁二：微任务形（queueMicrotask）不保证窗外——派发面 await 让出点即清微任务队列，窗仍开照拒', async () => {
    const { handle, dispatch, complete } = assembleWithGuard();
    let settled: { ok: boolean; code?: string } | undefined;
    handle.ctx.on('session_start', () => {
      // 窗界 = 派发 Promise 收口（03 §3.4 执法定形注）：queueMicrotask 排的
      // 微任务在派发面内部首个 await 让出点就跑——彼时派发未收口、深度 > 0，
      // 调用照拒。窗外的判据是「派发收口后」不是「handler 返回后」。
      queueMicrotask(() => {
        void complete
          .complete({ messages: [{ role: 'user', content: 'x', timestamp: 1 }] })
          .then(() => {
            settled = { ok: true };
          })
          .catch((e: unknown) => {
            settled = { ok: false, code: e instanceof BaseError ? e.code : 'unknown' };
          });
      });
    });
    await dispatch.emit('session_start', {});
    expect(settled).toEqual({ ok: false, code: 'LLM_CALL_IN_HOOK' });
  });
});

/* ---------------- 工具执行体分界 ---------------- */

describe('工具执行体不在执法面（enterHostCallback ≠ 钩子派发段）', () => {
  it('enterHostCallback 下 guard 不开窗——工具执行期模型调用不受限', () => {
    const { guard, handle } = assembleWithGuard();
    const restore = handle.enterHostCallback(); // 工具执行体走 loader 侧回调窗——不经 guard
    expect(guard.inHookDispatch()).toBe(false); // 只禁钩子段（03 §3.4）；工具段模型调用合法
    restore();
    expect(guard.inHookDispatch()).toBe(false);
  });
});
