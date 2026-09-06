/**
 * 声明式子代理物化测试（06 §11.6）：defBoundProvider 缺省合流（请求已有值
 * 胜出）/late-binding 基工厂缺席拒/物化产物（named provider + 静态工具族）/
 * 静态工具 def 字段全闭包绑定。
 */
import { describe, expect, it } from 'vitest';
import { BaseError, type SubagentProvider, type SubagentRequest, type SubagentResult } from '../contracts/index.js';
import { createJobRegistry } from './registry.js';
import { createSubagentService } from './service.js';
import { defBoundProvider, materializeDeclarativeSubagents } from './declarative.js';
import { createAgentTool } from './tool.js';
import { IN_PROCESS_CAPABILITIES } from './types.js';

/** 断言 async 抛指定码 */
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
    expect.unreachable(`应抛 ${code}`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

const DEF = {
  name: 'researcher',
  description: '深度调研员',
  tools: ['grep', 'web'],
  requires: ['grep'],
  model: 'm1',
  systemPrompt: '你是调研员。',
  filePath: '/x/researcher.md',
} as const;

/** 录请求的直通基工厂 */
function recordingBase(): { provider: SubagentProvider; requests: SubagentRequest[] } {
  const requests: SubagentRequest[] = [];
  return {
    requests,
    provider: {
      capabilities: { ...IN_PROCESS_CAPABILITIES },
      async run(request) {
        requests.push(request);
        return { output: '子栈结果', stopReason: 'stop' } satisfies SubagentResult;
      },
    },
  };
}

function makeService(provider?: SubagentProvider) {
  const registry = createJobRegistry();
  const service = createSubagentService({ registry });
  if (provider !== undefined) service.registerProvider('in-process', provider);
  return service;
}

describe('defBoundProvider 缺省合流', () => {
  it('late-binding：基工厂缺席抛 SUBAGENT_PROVIDER_UNKNOWN（host 装配批接线位）', async () => {
    const service = makeService(); // 无 'in-process'
    const bound = defBoundProvider(DEF, service);
    await expectCode(bound.run({ prompt: 'p', depth: 1 }), 'SUBAGENT_PROVIDER_UNKNOWN');
  });

  it('能力面恒真（in-process 真工厂独立装配全套）', () => {
    const bound = defBoundProvider(DEF, makeService());
    expect(bound.capabilities).toEqual(IN_PROCESS_CAPABILITIES);
  });

  it('def 缺省合流：请求缺字段由 def 补；请求已有值胜出（幂等）', async () => {
    const base = recordingBase();
    const service = makeService(base.provider);
    const bound = defBoundProvider(DEF, service);
    await bound.run({ prompt: 'p', depth: 1 });
    expect(base.requests[0]).toMatchObject({
      model: 'm1',
      systemPrompt: '你是调研员。',
      tools: ['grep', 'web'],
      name: 'researcher',
    });
    await bound.run({ prompt: 'p2', depth: 1, model: 'm2', tools: ['lsp'], name: '别名' });
    expect(base.requests[1]).toMatchObject({ model: 'm2', tools: ['lsp'], name: '别名' });
    expect(base.requests[1]!.systemPrompt).toBe('你是调研员。'); // 系统提示无请求位——恒 def 值
  });
});

describe('materializeDeclarativeSubagents 物化', () => {
  it('每 def 一 named provider + 一静态工具（agent_<name>；description = 文件 description）', () => {
    const base = recordingBase();
    const service = makeService(base.provider);
    const materialized = materializeDeclarativeSubagents([DEF], service, {
      parentSessionId: 's1',
      depth: 1,
    });
    expect(materialized.names).toEqual(['researcher']);
    expect(materialized.tools).toHaveLength(1);
    expect(materialized.tools[0]!.name).toBe('agent_researcher');
    expect(materialized.tools[0]!.description).toBe('深度调研员');
    expect(service.providerNames()).toContain('researcher');
  });

  it('重复物化同名 def：named provider 撞名拒 SUBAGENT_PROVIDER_EXISTS（跨层冲突走注册面）', () => {
    const service = makeService(recordingBase().provider);
    materializeDeclarativeSubagents([DEF], service, { parentSessionId: 's1' });
    expect(() => materializeDeclarativeSubagents([DEF], service, { parentSessionId: 's1' })).toThrow(BaseError);
  });
});

describe('静态工具 def 字段闭包绑定', () => {
  it('execute → service.run 路由 named provider；tools/requires/model/systemPrompt 全 def 值', async () => {
    const base = recordingBase();
    const service = makeService(base.provider);
    const { tools } = materializeDeclarativeSubagents([DEF], service, {
      parentSessionId: 's1',
      depth: 1,
      availableTools: () => ['read', 'grep', 'web', 'lsp'],
    });
    const result = await tools[0]!.execute({ prompt: '查一下' }, {} as never);
    expect(result.isError).toBeUndefined();
    expect(base.requests).toHaveLength(1);
    expect(base.requests[0]).toMatchObject({
      prompt: '查一下',
      tools: ['grep', 'web'], // 白名单 ∩ 派生面
      model: 'm1',
      systemPrompt: '你是调研员。',
      name: 'researcher',
    });
    // requires=['grep'] 已过预检闸（availableTools 含 grep）——正常起跑
    expect(result.content[0]).toMatchObject({ type: 'text' });
  });

  it('预检闸缺口：requires 缺席工具 → isError 回执 SUBAGENT_PRECHECK_FAILED（坏 def 不炸调用面）', async () => {
    const service = makeService(recordingBase().provider);
    const { tools } = materializeDeclarativeSubagents([DEF], service, {
      parentSessionId: 's1',
      depth: 1,
      availableTools: () => ['read', 'web'], // grep 缺席——requires 拒
    });
    const result = await tools[0]!.execute({ prompt: 'p' }, {} as never);
    expect(result.isError).toBe(true);
    expect(result.content[0]).toMatchObject({ text: expect.stringContaining('SUBAGENT_PRECHECK_FAILED') });
  });
});

describe('通用 agent 工具（对照组）', () => {
  it('工具名位 = agent；缺省路由 in-process；模型面只见 prompt/background/name', async () => {
    const base = recordingBase();
    const service = makeService(base.provider);
    const tool = createAgentTool({ service, parentSessionId: 's1', depth: 1 });
    expect(tool.name).toBe('agent');
    const result = await tool.execute({ prompt: '去做', background: false }, {} as never);
    expect(result.isError).toBeUndefined();
    expect(base.requests[0]!.prompt).toBe('去做');
  });
});
