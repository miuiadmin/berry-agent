/**
 * /thinking 会话思考档位切换全链测试（2026-09-17 会话档位切换面批 F1——
 * 立项档测试计划 1/2/6/7/9/10 的 thinking 半边）。
 *
 * 纪律：mock 只停模型层（streamFn 注入位记录请求 options——scripted 终值序
 * 列）；SessionLog / DurableWiring / driver 全走真实现（组合根口径）；禁断言
 * AI 生成文本——只断言结构与编舞行为。
 *
 * 覆盖锁（每条修前必红）：
 *  - 选定 → durable 事件 append（词 session/thinking-level + 载荷 level）；
 *  - fold → run 起首请求携带（thinkingLevel 进 request config——wiring
 *    RequestEnvelope :45 形对照 + streamFn options 直证）；
 *  - run 在飞切档 = 下一 run 生效（toolUse 两轮形锁 run 内钉定）；
 *  - resume 重放恢复（fork 前缀/重启 seed 形——档位随事件流回来）+ fork
 *    双向隔离（事件面隔离）；
 *  - 坏词 fail-loud（THINKING_LEVEL_INVALID——append 校验与 fold 各一）；
 *  - 不支持 thinking 的 provider 选定不炸（静默无效归 llm 层——stream-fn
 *    既有 'off'→undefined 锁，driver 级只锁透传与不炸）。
 */
import { describe, expect, it } from 'vitest';
import type {
  AgentTool,
  AssistantMessage,
  AssistantStream,
  AssistantStreamEvent,
  LlmContext,
  Message,
  StreamFn,
  StreamFnOptions,
  TextContent,
  ThinkingLevel,
  ToolCallBlock,
} from '../contracts/index.js';
import { isStandardMessage } from '../contracts/index.js';
import { EventDispatch, Scope } from '../context/index.js';
import { SessionLog } from '../session/index.js';
import { forkPrefix } from '../session/index.js';
import { BaseError } from '../contracts/index.js';
import { ConversationDriver } from './driver.js';
import type { ConversationDriverOptions } from './types.js';
import { foldSessionThinkingLevel, setSessionThinkingLevel, THINKING_LEVELS } from './thinking-level.js';

/* ---------------- 测试构造件（driver.test.ts 同族轻量台） ---------------- */

/** assistant 终值构造（缺省 stop 空内容） */
function assistant(partial: Partial<AssistantMessage>): AssistantMessage {
  return {
    role: 'assistant',
    content: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 0,
    ...partial,
  };
}

/** toolCall 块构造 */
function call(id: string, name: string): ToolCallBlock {
  return { type: 'toolCall', id, name, arguments: {} };
}

/** 最小真工具（可覆写 execute） */
function makeTool(name: string, execute?: AgentTool['execute']): AgentTool {
  return {
    name,
    description: '测试工具',
    parameters: { type: 'object' },
    execute: execute ?? (async () => ({ content: [{ type: 'text', text: 'ok' } satisfies TextContent] })),
  };
}

/** 单次流（真协议形状：start → delta → done） */
function makeStream(final: AssistantMessage): AssistantStream {
  const partial = { ...final, content: [...final.content] };
  return {
    async *[Symbol.asyncIterator](): AsyncIterator<AssistantStreamEvent> {
      yield { type: 'start', partial };
      yield { type: 'text_delta', contentIndex: 0, delta: 'x', partial };
      yield { type: 'done', reason: final.stopReason as 'stop', message: final };
    },
    result: async () => final,
  };
}

/**
 * scripted streamFn：第 i 次调用产 scripts[i] 终值；每次请求的
 * StreamFnOptions（含 thinkingLevel）记入 seenOptions——断言面。
 */
function scriptedStreamFn(scripts: AssistantMessage[], seenOptions: StreamFnOptions[]): StreamFn {
  let i = 0;
  return (context: LlmContext, options: StreamFnOptions): AssistantStream => {
    void context;
    seenOptions.push(options);
    const final = scripts[i];
    i += 1;
    if (!final) throw new Error(`脚本耗尽（第 ${i} 次调用无终值）`);
    return makeStream(final);
  };
}

/** 缺省 convertToLm：标准直通、自定义剥离（null） */
const passthrough = (m: Parameters<ConversationDriverOptions['convertToLlm']>[0]): Message | null =>
  isStandardMessage(m) ? m : null;

/** 抓错误码（danger.test.ts :94 先例——BaseError 码位断言形） */
function catchCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof BaseError ? e.code : `非 BaseError：${String(e)}`;
  }
  return undefined;
}

/**
 * 档位消费测试台：driver options.thinkingLevel 注入**取值器闭包**
 * `() => foldSessionThinkingLevel(log.events()) ?? 栈基线`——与
 * conversation-stack 装配位（createDriver 内）的表达式同构，锁机制与闭包
 * 语义两半。
 */
function makeKnobDriver(options: {
  baseline?: ThinkingLevel;
  scripts: AssistantMessage[];
  log?: SessionLog;
  tool?: AgentTool;
}): { driver: ConversationDriver; seenOptions: StreamFnOptions[]; log: SessionLog } {
  const seenOptions: StreamFnOptions[] = [];
  const log = options.log ?? new SessionLog({ sessionId: 's-thinking' });
  const baseline = options.baseline;
  const driver = new ConversationDriver({
    session: log,
    scope: Scope.createRoot(),
    dispatch: new EventDispatch(),
    streamFn: scriptedStreamFn(options.scripts, seenOptions),
    convertToLlm: passthrough,
    model: 'test/model',
    systemPrompt: 'sys',
    // 装配位同构表达式：fold 现值 ?? 栈基线（run 起现取——07 §4.1 会话档位
    // 切换面批）
    thinkingLevel: () => foldSessionThinkingLevel(log.events()) ?? baseline,
    ...(options.tool !== undefined ? { tools: [options.tool] } : {}),
  });
  return { driver, seenOptions, log };
}

/* ---------------- 档位切换面 · append + fold（conversation 件） ---------------- */

describe('档位切换面 · append + fold（conversation 件）', () => {
  it('选定 → durable 事件 append：词 session/thinking-level + 载荷 level', () => {
    const log = new SessionLog({ sessionId: 's-append' });
    const returned = setSessionThinkingLevel(log, 'high');
    expect(returned).toBe('high');
    const events = log.events();
    const appended = events.filter((event) => event.type === 'session/thinking-level');
    expect(appended).toHaveLength(1);
    expect((appended[0]!.data as { level: string }).level).toBe('high');
  });

  it('append 坏词 fail-loud：THINKING_LEVEL_INVALID（七档词表外不入账）', () => {
    const log = new SessionLog({ sessionId: 's-bad-append' });
    expect(() => setSessionThinkingLevel(log, 'ultra')).toThrowError(BaseError);
    expect(catchCode(() => setSessionThinkingLevel(log, 'ultra'))).toBe('THINKING_LEVEL_INVALID');
    // 坏词不入账——日志零 session/thinking-level 事件
    expect(log.events().filter((event) => event.type === 'session/thinking-level')).toHaveLength(0);
  });

  it('fold：全量正扫尾值胜；无事件返 undefined', () => {
    const log = new SessionLog({ sessionId: 's-fold' });
    expect(foldSessionThinkingLevel(log.events())).toBeUndefined();
    setSessionThinkingLevel(log, 'low');
    setSessionThinkingLevel(log, 'xhigh');
    expect(foldSessionThinkingLevel(log.events())).toBe('xhigh'); // 尾值胜
  });

  it('fold 坏词 fail-loud：任一位置坏词抛 THINKING_LEVEL_INVALID（非倒扫静默取尾）', () => {
    const log = new SessionLog({ sessionId: 's-bad-fold' });
    setSessionThinkingLevel(log, 'medium');
    // 直接落一条坏词事件（模拟持久层坏行——手改库/异源写入形）
    log.append('session/thinking-level', { level: 'TURBO' });
    setSessionThinkingLevel(log, 'max');
    // 全量正扫：坏词在中段也要抛——倒扫会静默取合法尾档 max，属 fail-open
    expect(() => foldSessionThinkingLevel(log.events())).toThrowError(BaseError);
    expect(catchCode(() => foldSessionThinkingLevel(log.events()))).toBe('THINKING_LEVEL_INVALID');
  });

  it('resume 重放恢复：事件前缀 seed 新 SessionLog → 档位随事件流回来（重启形）', () => {
    const original = new SessionLog({ sessionId: 's-resume' });
    setSessionThinkingLevel(original, 'medium');
    // 重启形：活体日志事件前缀 → 新 SessionLog seed 重放（冷启动恢复 = 折叠重放）
    const replayed = new SessionLog({ sessionId: 's-resume-2', seed: [...original.events()] });
    expect(foldSessionThinkingLevel(replayed.events())).toBe('medium');
  });

  it('fork 事件面隔离：forkPrefix 前缀双日志各自 append 互不影', () => {
    const parent = new SessionLog({ sessionId: 's-parent' });
    setSessionThinkingLevel(parent, 'low');
    // fork 形：事件前缀拷贝成子会话（forkPrefix——fork 种子语义）
    const child = new SessionLog({
      sessionId: 's-child',
      seed: forkPrefix(parent.events(), parent.events().length - 1),
    });
    expect(foldSessionThinkingLevel(child.events())).toBe('low'); // 继承母档位
    // 双向隔离：各自切档互不影
    setSessionThinkingLevel(parent, 'high');
    setSessionThinkingLevel(child, 'off');
    expect(foldSessionThinkingLevel(parent.events())).toBe('high');
    expect(foldSessionThinkingLevel(child.events())).toBe('off');
  });

  it('七档词表恰七值（off/minimal/low/medium/high/xhigh/max——contracts 同源）', () => {
    expect(THINKING_LEVELS).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);
  });

  it('不支持 thinking 的 provider 选定不炸：xhigh/off append 成功（静默无效归 llm 层）', () => {
    const log = new SessionLog({ sessionId: 's-provider' });
    // xhigh/max 仅部分模型家族支持——选定与落账不因 provider 能力而炸
    expect(() => setSessionThinkingLevel(log, 'xhigh')).not.toThrow();
    expect(() => setSessionThinkingLevel(log, 'off')).not.toThrow();
    expect(foldSessionThinkingLevel(log.events())).toBe('off');
  });
});

/* ---------------- 档位切换面 · driver run 起消费 ---------------- */

describe('档位切换面 · driver run 起消费（生效 = 下一 run 起）', () => {
  it('run 起首请求携带：fold 现值进 streamFn options + durable request/header config（wiring :45 形）', async () => {
    const { driver, seenOptions, log } = makeKnobDriver({ scripts: [assistant({})] });
    setSessionThinkingLevel(log, 'high');
    await driver.submit('hi');
    // 请求携带：streamFn 第二参 options.thinkingLevel（agent/stream.ts :51 直证）
    expect(seenOptions[0]!.thinkingLevel).toBe('high');
    // durable 信封快照同源携带：request/header data.config.thinkingLevel（wiring :45）
    const header = log.events().find((event) => event.type === 'request/header');
    expect(header).toBeDefined();
    expect((header!.data as { config: { thinkingLevel?: string } }).config.thinkingLevel).toBe('high');
  });

  it('无事件回落栈基线：fold ?? 栈基线闭包语义（boot 静态注入位退役为 fallback）', async () => {
    const { driver, seenOptions } = makeKnobDriver({ baseline: 'low', scripts: [assistant({})] });
    await driver.submit('hi');
    expect(seenOptions[0]!.thinkingLevel).toBe('low');
  });

  it('run 在飞切档 = 下一 run 生效：toolUse 两轮形锁 run 内钉定 + run 间现取', async () => {
    // 编舞：run1 = toolUse 轮（第一请求）+ 工具执行窗内切档 + stop 轮（第二请求）
    // ——第二请求仍用 run 起钉定值（run 内不可变）；run2 起才取新档。
    let switchLevel: (() => void) | undefined;
    const probe = makeTool('probe', async () => {
      switchLevel?.(); // 工具执行窗 = run1 在飞期——此窗切档不打断本 run
      return { content: [{ type: 'text', text: 'ok' } satisfies TextContent] };
    });
    const { driver, seenOptions, log } = makeKnobDriver({
      baseline: 'medium',
      scripts: [assistant({ stopReason: 'toolUse', content: [call('t1', 'probe')] }), assistant({}), assistant({})],
      tool: probe,
    });
    switchLevel = () => setSessionThinkingLevel(log, 'max');
    await driver.submit('run1');
    // run 内两请求同钉定 medium（在飞切 max 不换——04 §5「run 内不可变」）
    expect(seenOptions.map((options) => options.thinkingLevel)).toEqual(['medium', 'medium']);
    expect(foldSessionThinkingLevel(log.events())).toBe('max'); // 事件已落账
    await driver.submit('run2');
    // 下一 run 起生效：run2 请求取 fold 现值 max
    expect(seenOptions[2]!.thinkingLevel).toBe('max');
  });

  it("run 起取值器 undefined（无事件无基线）= 请求不带 thinkingLevel（'off' 由 llm 层转关闭）", async () => {
    const { driver, seenOptions, log } = makeKnobDriver({ scripts: [assistant({}), assistant({})] });
    await driver.submit('hi');
    expect(seenOptions[0]!.thinkingLevel).toBeUndefined();
    // off 档透传（llm 层转 undefined 关闭——stream-fn 既有锁）；选定不炸
    setSessionThinkingLevel(log, 'off');
    await driver.submit('hi2');
    expect(seenOptions[1]!.thinkingLevel).toBe('off');
  });
});
