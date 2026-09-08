/**
 * 金样录制器（07 篇 §7.4 #4——金样回放轨的 record-once 腿）。
 *
 * 人工动作：`npm run golden:record`（需要 ANTHROPIC_API_KEY——缺 key
 * fail-loud 退 1）。真模型经 src/llm 真 StreamFn 路径（createLlmRuntime +
 * createStreamFn——录的正是产品出口的事件序）；每场景一个 JSONL 落
 * `tools/golden/<场景名>.jsonl`：首行 meta（场景/模型/录制时间），后续
 * 每行一个 AssistantStreamEvent。
 *
 * 回放腿（replay-deterministic）收在 `src/llm/golden.test.ts`——vitest
 * 零网络只读 JSONL；回放红 = 行为演进信号重录（人工裁决后重跑本脚本）。
 * 本脚本不进 vitest、不进 CI、不进发布物（tsconfig.build exclude 点名）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { CredentialStore } from '@earendil-works/pi-ai';
import { createLlmRuntime } from '../src/llm/runtime.js';
import { createStreamFn } from '../src/llm/stream-fn.js';
import type { AssistantStreamEvent, LlmContext, UserMessage } from '../src/contracts/index.js';

/** 仓库根（脚本位于 tools/ 下一级） */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
/** 金样输出目录 */
const GOLDEN_DIR = join(REPO_ROOT, 'tools/golden');
/** 缺省模型（与产品缺省一致；BERRY_AGENT_MODEL 可覆盖） */
const MODEL = process.env.BERRY_AGENT_MODEL ?? 'anthropic/claude-sonnet-5';

/**
 * 环境变量直读型凭证存储——录制器专用（anthropic 一家：生态变量
 * ANTHROPIC_API_KEY 直读为 ApiKeyCredential；无持久化、无 OAuth 交互）。
 */
const envOnlyCredentialStore: CredentialStore = {
  async read(providerId) {
    const key = process.env.ANTHROPIC_API_KEY;
    if (providerId === 'anthropic' && key) return { type: 'api_key', key };
    return undefined;
  },
  async list() {
    return [];
  },
  async modify() {
    return undefined;
  },
  async delete() {},
};

/** 固定冒烟场景（system + user 全定死——重录可比） */
const SCENARIOS: { name: string; system: string; user: string }[] = [
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
  },
];

async function main(): Promise<number> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('金样录制缺 ANTHROPIC_API_KEY——真模型录制是 record-once 人工动作，凭证经生态变量供给');
    return 1;
  }
  const runtime = createLlmRuntime({ credentials: envOnlyCredentialStore });
  const streamFn = createStreamFn(runtime);

  for (const scenario of SCENARIOS) {
    const userMessage: UserMessage = { role: 'user', content: scenario.user, timestamp: 0 };
    const context: LlmContext = { systemPrompt: scenario.system, messages: [userMessage] };
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
