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
 */
import { mkdirSync, writeFileSync } from 'node:fs';
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
const SCENARIOS: { name: string; system: string; user: string; tools?: LlmTool[] }[] = [
  {
    name: 'plain-answer',
    system: '你是一个测试助手。始终用一句简短的中文回答。',
    user: '用一句话说明什么是数组。',
  },
  {
    name: 'tool-call',
    system:
      '你是测试助手。查天气必须调用 weather 工具（参数 {"city": string}），不要凭记忆编造天气。',
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
];

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
    try {
      const stream = await streamFn(context, { model: MODEL });
      for await (const event of stream) events.push(event);
    } catch (error) {
      // StreamFn 契约是「错误是数据不是异常」——到达这里的异常属装配级失败
      console.error(`场景 ${scenario.name} 流装配失败：${error instanceof Error ? error.message : String(error)}`);
      return 1;
    }
    const final = events[events.length - 1];
    if (!final || (final.type !== 'done' && final.type !== 'error')) {
      console.error(`场景 ${scenario.name} 事件序未以 done/error 收尾（终事件 ${final?.type ?? '无'}）——不落盘半成品金样`);
      return 1;
    }
    const outPath = join(GOLDEN_DIR, `${scenario.name}.jsonl`);
    mkdirSync(dirname(outPath), { recursive: true });
    const lines = [
      JSON.stringify({ meta: { scenario: scenario.name, model: MODEL, recordedAt: new Date().toISOString(), source: 'golden-record' } }),
      ...events.map((event) => JSON.stringify(event)),
    ];
    writeFileSync(outPath, `${lines.join('\n')}\n`);
    const finalType = final.type;
    console.log(`金样落盘：${outPath}（${events.length} 事件，终事件 ${finalType}）`);
  }
  console.log('全部场景录制完成——回放腿见 src/llm/golden.test.ts');
  return 0;
}

main().then((code) => {
  process.exitCode = code;
});
