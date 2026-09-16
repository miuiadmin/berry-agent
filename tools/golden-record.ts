/**
 * 金样录制器（07 篇 §7.4 #4——金样回放轨的 record-once 腿）。
 *
 * 人工动作：`npm run golden:record`。金样源 = GLM 中转（anthropic-messages
 * 兼容网关）——凭证经 `GLM_RELAY_API_KEY`、网关经 `GLM_RELAY_BASE_URL` 双
 * env 注入，缺任一 fail-loud 退 1；**key 与网关地址永不入仓**（自持注入壳
 * 谱见知识域 ~/.berry-glm-test/，同真模型六轮试件纪律）。真模型经 src/llm
 * 真 StreamFn 路径（createLlmRuntime + createStreamFn——录的正是产品出口的
 * 事件序）；每场景一个 JSONL 落 `tools/golden/<场景名>.jsonl`：首行 meta
 * （场景/模型/录制时间），后续每行一个 AssistantStreamEvent。
 *
 * 回放腿（replay-deterministic）收在 `src/llm/golden.test.ts`——vitest
 * 零网络只读 JSONL；回放红 = 行为演进信号重录（人工裁决后重跑本脚本）。
 * 本脚本不进 vitest、不进 CI、不进发布物（tsconfig.build exclude 点名）。
 *
 * 场景面（批 C A3 扩容）：plain-answer / tool-call（首录两件已入库）+
 * multi-tool / mixed / abort（扩三场景——loop 消费面已由合成夹具先锁
 * 〔src/agent/loop.test.ts「金样喂 loop」〕，真录属 record-once 人工动作
 * 待 GLM 凭证；abort 场景编排 = 首个增量事件到达即 abort，收口形录到什么
 * 是什么）。
 *
 * 重录成规（批 D）：既有金样在座时重录，先归档前朝为 `<场景名>.prev.jsonl`
 * （只保一层——prev 恒为「本次重录前的那版」），写后对新旧打印机器 diff
 * 摘要（事件数/事件型序首分歧/终值形状——只比形状不比文本内容，同回放腿
 * 断言纪律）；回放腿枚举排除 .prev（前朝账非回放真源）+ recordedAt 过 90
 * 天线软报告催重录（三面同源自洽）。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLlmRuntime } from '../src/llm/runtime.js';
import { createStreamFn } from '../src/llm/stream-fn.js';
import { providerApiFace } from '../src/llm/provider-face.js';
import type { AssistantStreamEvent, LlmContext, LlmTool, UserMessage } from '../src/contracts/index.js';

/** 仓库根（脚本位于 tools/ 下一级） */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** 金样输出目录 */
const GOLDEN_DIR = join(REPO_ROOT, 'tools/golden');
/** 缺省模型（六轮实机实证形；BERRY_AGENT_MODEL 可覆盖） */
const MODEL = process.env.BERRY_AGENT_MODEL ?? 'glm-relay/glm-5.3-flash';
// 经宿主 provider 聚合面解构（provider-face 唯一导出 = providerApiFace 对象
// ——个体名非直接导出；走聚合面 = 与宿主同版本 pi-ai 工厂族，防双实例）
const { createProvider, anthropicMessagesApi } = providerApiFace;

/** 固定冒烟场景（system + user + tools 全定死——重录可比） */
const SCENARIOS: {
  name: string;
  system: string;
  user: string;
  tools?: LlmTool[];
  /** true = 首个增量事件（*_delta）到达即 abort——流中段确定性击杀点（进度驱动非 sleep 赌时序）；收口形录到什么是什么（error aborted / AbortError 文案皆合法终态，回放腿 assertGolden 容受） */
  abortAfterFirstDelta?: boolean;
}[] = [
  {
    name: 'plain-answer',
    system: '你是一个测试助手。始终用一句简短的中文回答。',
    user: '用一句话说明什么是数组。',
  },
  {
    name: 'tool-call',
    system: '你是测试助手。查天气必须调用 weather 工具（参数 {"city": string}），不要凭记忆编造天气。',
    user: '帮我看下北京的天气。',
    // 工具面必须注册——否则模型无从发 tool_use，场景退化为纯文本（首录实证
    // 模型自述「没有天气工具」）。此场景的存在意义 = 锁 tool_use 发射路径的事件序。
    tools: [
      {
        name: 'weather',
        description: '查询指定城市的实时天气。',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string', description: '城市名（如「北京」）' } },
          required: ['city'],
        },
      },
    ],
  },
  {
    // 批 C A3 扩三场景之一：一条消息并行多 tool_use（批语义的事件序形——
    // multi-tool 消费面已由合成夹具先锁〔src/agent/loop.test.ts〕，真录补真形）
    name: 'multi-tool',
    system:
      '你是测试助手。用户要查多个城市天气时，必须在同一条回复里对每个城市各调用一次 weather 工具（参数 {"city": string}），不要逐城分多轮，也不要凭记忆编造。',
    user: '帮我看下北京和上海的天气。',
    tools: [
      {
        name: 'weather',
        description: '查询指定城市的实时天气。',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string', description: '城市名（如「北京」）' } },
          required: ['city'],
        },
      },
    ],
  },
  {
    // 批 C A3 扩三场景之二：thinking+text+toolCall 混合块序（loop 尾替换语义
    // 对混合块序的正确性已由合成夹具锁，真录补真形——GLM 自动带 thinking 块）
    name: 'mixed',
    system:
      '你是测试助手。回答时先用一句话说明你的查询思路，然后必须调用 weather 工具（参数 {"city": string}）查证，不要凭记忆编造。',
    user: '查一下上海的天气，先说说你怎么查。',
    tools: [
      {
        name: 'weather',
        description: '查询指定城市的实时天气。',
        parameters: {
          type: 'object',
          properties: { city: { type: 'string', description: '城市名（如「上海」）' } },
          required: ['city'],
        },
      },
    ],
  },
  {
    // 批 C A3 扩三场景之三：流中段 abort 收口形（中止恒走 error 事件腿——
    // contracts 12 型 done 四 reason 不含 aborted；loop 终态映射 aborted 已由
    // 合成夹具锁，真录补真形。若 abort 后流不yield 终事件，录制器按既有
    // 「未以 done/error 收尾不落盘」拒收——人工裁决面）
    name: 'abort',
    system: '你是测试助手。始终写一段三句话以上的中文回答。',
    user: '介绍一下数组这种数据结构。',
    abortAfterFirstDelta: true,
  },
];

/** 事件形状提取（diff 面——只取型序与终值形状，禁文本内容比对，同回放腿纪律） */
function shapeOfEvents(events: unknown[]): {
  types: string[];
  finalType: string;
  stopReason: string;
  blockTypes: string[];
} {
  const types = events.map((e) => String((e as { type?: unknown }).type));
  const final = events[events.length - 1] as
    | {
        type?: unknown;
        message?: { stopReason?: unknown; content?: { type: unknown }[] };
        error?: { stopReason?: unknown; content?: { type: unknown }[] };
      }
    | undefined;
  const finalBody = final?.message ?? final?.error ?? {};
  return {
    types,
    finalType: String(final?.type),
    stopReason: String(finalBody.stopReason),
    blockTypes: (finalBody.content ?? []).map((b) => String(b.type)),
  };
}

/** 机器 diff 摘要：事件数 / 型序首分歧位 / 终值形状（重录两版差异可见——人工裁决面） */
function diffSummary(prevText: string, nextEvents: AssistantStreamEvent[]): string {
  const prevLines = prevText.split('\n').filter((l) => l.trim().length > 0);
  if (prevLines.length < 2) return '前朝归档形状异常（行数不足）——跳过 diff';
  let prevShape: ReturnType<typeof shapeOfEvents>;
  try {
    prevShape = shapeOfEvents(prevLines.slice(1).map((l) => JSON.parse(l)));
  } catch {
    return '前朝归档解析失败——跳过 diff';
  }
  const nextShape = shapeOfEvents(nextEvents);
  const parts: string[] = [`事件 ${prevShape.types.length}→${nextShape.types.length}`];
  // 型序逐位比（首分歧位即止——摘要面向人工裁决，非逐行账）
  const divergeAt = prevShape.types.findIndex((t, i) => nextShape.types[i] !== t);
  if (divergeAt === -1 && prevShape.types.length === nextShape.types.length) {
    parts.push('型序一致');
  } else if (divergeAt === -1) {
    parts.push(`型序前缀一致（${Math.min(prevShape.types.length, nextShape.types.length)} 位后长度分叉）`);
  } else {
    parts.push(`型序首分歧 @${divergeAt}（${prevShape.types[divergeAt]}→${nextShape.types[divergeAt] ?? '截短'}）`);
  }
  const prevFinal = `${prevShape.finalType}/${prevShape.stopReason}/[${prevShape.blockTypes.join(',')}]`;
  const nextFinal = `${nextShape.finalType}/${nextShape.stopReason}/[${nextShape.blockTypes.join(',')}]`;
  parts.push(prevFinal === nextFinal ? `终值形状同（${nextFinal}）` : `终值形状 ${prevFinal}→${nextFinal}`);
  return parts.join('；');
}

async function main(): Promise<number> {
  // 双 env fail-loud——录制器是 record-once 人工动作，key/网关经环境供给零入仓
  const relayBaseUrl = process.env.GLM_RELAY_BASE_URL;
  const relayApiKey = process.env.GLM_RELAY_API_KEY;
  if (!relayBaseUrl || !relayApiKey) {
    console.error(
      '金样录制缺 GLM_RELAY_BASE_URL / GLM_RELAY_API_KEY——真模型录制是 record-once 人工动作，凭证与网关经环境变量供给（注入壳谱见知识域）',
    );
    return 1;
  }
  // GLM 中转 provider（六轮实机同款形：anthropic-messages 兼容面 + 真窗口
  // 200k 不动——防 pi-ai 钳 max_tokens 截断输出；cost 全 0 = 中转侧不计费面）
  const glmRelayProvider = createProvider({
    id: 'glm-relay',
    name: 'GLM relay (anthropic-messages 兼容中转)',
    baseUrl: relayBaseUrl,
    auth: {
      apiKey: {
        name: 'GLM relay API key',
        resolve: async () => ({
          auth: { apiKey: relayApiKey },
          source: 'env GLM_RELAY_API_KEY',
        }),
      },
    },
    models: [
      {
        id: 'glm-5.3-flash',
        name: 'GLM 5.3 Flash',
        api: 'anthropic-messages',
        provider: 'glm-relay',
        baseUrl: relayBaseUrl,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 8192,
      },
    ],
    api: anthropicMessagesApi(),
  });
  const runtime = createLlmRuntime({ providers: [glmRelayProvider] });
  const streamFn = createStreamFn(runtime);

  for (const scenario of SCENARIOS) {
    const userMessage: UserMessage = { role: 'user', content: scenario.user, timestamp: 0 };
    const context: LlmContext = { systemPrompt: scenario.system, messages: [userMessage], tools: scenario.tools };
    const events: AssistantStreamEvent[] = [];
    // abort 场景编排：控制器只在场景声明时铸（signal 透传 = streamFn 第三参）
    const abortController = scenario.abortAfterFirstDelta === true ? new AbortController() : undefined;
    try {
      const stream = await streamFn(context, { model: MODEL }, abortController?.signal);
      for await (const event of stream) {
        events.push(event);
        // 流中段确定性击杀点：首个增量事件到达即 abort（此时流确已产出——
        // 非首事件前也非尾后；进度驱动非 sleep 赌时序，同 kill-recovery 谱）
        if (abortController !== undefined && !abortController.signal.aborted && event.type.endsWith('_delta')) {
          abortController.abort();
        }
      }
    } catch (error) {
      // StreamFn 契约是「错误是数据不是异常」——到达这里的异常属装配级失败
      console.error(`场景 ${scenario.name} 流装配失败：${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    const final = events[events.length - 1];
    if (!final || (final.type !== 'done' && final.type !== 'error')) {
      console.error(
        `场景 ${scenario.name} 事件序未以 done/error 收尾（终事件 ${final?.type ?? '无'}）——不落盘半成品金样`,
      );
      return 1;
    }
    const outPath = join(GOLDEN_DIR, `${scenario.name}.jsonl`);
    const prevPath = join(GOLDEN_DIR, `${scenario.name}.prev.jsonl`);
    mkdirSync(dirname(outPath), { recursive: true });
    // 重录成规：既有金样在座先归档前朝（只保一层——prev 恒为本次重录前那版）
    const hadPrev = existsSync(outPath);
    if (hadPrev) copyFileSync(outPath, prevPath);
    const lines = [
      JSON.stringify({
        meta: { scenario: scenario.name, model: MODEL, recordedAt: new Date().toISOString(), source: 'golden-record' },
      }),
      ...events.map((event) => JSON.stringify(event)),
    ];
    writeFileSync(outPath, `${lines.join('\n')}\n`);
    const finalType = final.type;
    console.log(`金样落盘：${outPath}（${events.length} 事件，终事件 ${finalType}）`);
    if (hadPrev) console.log(`重录 diff（${scenario.name}）：${diffSummary(readFileSync(prevPath, 'utf8'), events)}`);
  }
  console.log('全部场景录制完成——回放腿见 src/llm/golden.test.ts');
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
