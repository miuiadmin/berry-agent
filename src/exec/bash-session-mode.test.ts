/**
 * bash currentMode per-session 穿线测试（2026-09-17 会话档位切换面批 F2——
 * 立项档测试计划 4 sandbox 半边的 bash 面）。
 *
 * 锁的机制：三面单源之三 = BashToolDeps.currentMode 沙箱档消费位——
 * `let mode = deps.currentMode()` 升为 `deps.currentMode(toolCtx.sessionId)`
 * （M1：管道 ToolContext.sessionId 已穿线到位，消费位沿调用链显式补传；
 * 缺席 = boot 解析值 fallback〔M2〕）。档位经 policy.mode 进 sandboxService
 * .confine——以 recording 沙箱服务捕获断言（零真 spawn 依赖）。
 *
 * 纪律：桩只停在 spawn 管道与沙箱服务注入位（执行面与本测无关——
 * 本测锁档位穿线不锁执行）；坏词 fail-loud 工具位锁 bash 形
 * （catch 段 BaseError 携码进 isError 数据面）。
 *
 * 覆盖锁（修前必红——今天 currentMode() 不传 sessionId，闭包收到
 * undefined 恒走 boot 腿，per-session 断言即红）：
 *  - per-session 穿线：两会话异档 → confine 捕获 policy.mode 各自正确；
 *  - 缺席 fallback 恒 boot 解析值（回归锁形——boot 档不被缺省吞）；
 *  - 坏词 fail-loud 工具位：fold 抛 SANDBOX_MODE_INVALID → isError
 *    文本携码拒执行（不裸跑不静默）。
 */
import { describe, expect, it } from 'vitest';
import type { ToolContext } from '../contracts/index.js';
import { BaseError } from '../contracts/index.js';
import type { ConfinedArgv, SandboxMode, SandboxPolicy, SandboxService } from '../safety/index.js';
import { createBashTool } from './bash.js';
import './codes.js';
import { createProcessRegistry } from './registry.js';
import type { ExecResult, SpawnPipeline } from './types.js';

/* ---------------- 测试构造件 ---------------- */

/** 恒成功假管道（零真 spawn——本测锁档位穿线不锁执行） */
function fakePipeline(): SpawnPipeline {
  return {
    run: async () =>
      ({
        outcome: 'exit',
        exitCode: 0,
        stdout: '',
        stderr: '',
        truncated: false,
        bytes: 0,
        durationMs: 0,
      }) satisfies ExecResult,
    spawnInteractive: () => {
      throw new Error('本测不消费 spawnInteractive');
    },
    registry: createProcessRegistry(),
  };
}

/** recording 沙箱服务：恒等 argv + 捕获每次 confine 的 policy（断言面） */
function recordingSandbox(): { service: SandboxService; policies: SandboxPolicy[] } {
  const policies: SandboxPolicy[] = [];
  const service: SandboxService = {
    confine: (argv, policy): ConfinedArgv => {
      policies.push(policy);
      return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] };
    },
    registerBackend: () => () => {},
    listBackends: () => [],
  };
  return { service, policies };
}

/**
 * seam 测试桩（非装配形复刻——生产装配位 = conversation-stack 恒折本会话
 * 闭包）：sessionId → 档位映射，锁 bash 侧传递契约——收到 toolCtx.sessionId
 * 则用之、缺席走 boot（M2 seam 形）；映射值坏词 = fold 抛形
 * （SANDBOX_MODE_INVALID——与 resolveEffectiveMode 坏词路径同语义）。
 */
function modeClosure(map: Record<string, string>, boot: SandboxMode): (sessionId?: string) => SandboxMode {
  return (sessionId?: string): SandboxMode => {
    if (sessionId === undefined) return boot;
    const value = map[sessionId];
    if (value === undefined) return boot;
    if (value !== 'read-only' && value !== 'workspace-write' && value !== 'danger') {
      throw new BaseError(
        'SANDBOX_MODE_INVALID',
        `sandbox/mode 事件档位非法：${JSON.stringify(value)}（三档词汇：read-only / workspace-write / danger）`,
      );
    }
    return value;
  };
}

/** 会话锚定 ToolContext */
function ctx(sessionId?: string): ToolContext {
  return { toolCallId: 'tc-sb-bash', ...(sessionId !== undefined ? { sessionId } : {}) };
}

/** 工具文本腿提取 */
const textOf = (result: { content: { type: string; text?: string }[] }): string => {
  const first = result.content[0];
  return first !== undefined && first.type === 'text' ? (first.text ?? '') : '';
};

/* ---------------- per-session 穿线 ---------------- */

describe('bash currentMode · per-session 穿线（三面单源之三）', () => {
  it('confine 捕获 policy.mode 随 toolCtx.sessionId：两会话异档各自正确', async () => {
    const { service, policies } = recordingSandbox();
    const tool = createBashTool({
      pipeline: fakePipeline(),
      workspaceRoot: () => process.cwd(),
      currentMode: modeClosure({ 's-a': 'read-only', 's-b': 'danger' }, 'workspace-write'),
      sandboxService: service,
    });
    await tool.execute({ command: 'echo a' }, ctx('s-a'));
    await tool.execute({ command: 'echo b' }, ctx('s-b'));
    // 修前红：currentMode() 不传 sessionId → 两次均 boot=workspace-write
    expect(policies.map((policy) => policy.mode)).toEqual(['read-only', 'danger']);
  });

  it('sessionId 缺席 = boot 解析值 fallback（M2 回归锁——boot 档不被缺省吞）', async () => {
    const { service, policies } = recordingSandbox();
    const tool = createBashTool({
      pipeline: fakePipeline(),
      workspaceRoot: () => process.cwd(),
      currentMode: modeClosure({ 's-a': 'read-only' }, 'danger'),
      sandboxService: service,
    });
    await tool.execute({ command: 'echo x' }, ctx());
    expect(policies.map((policy) => policy.mode)).toEqual(['danger']);
  });

  it('坏词 fail-loud 工具位：fold 抛 SANDBOX_MODE_INVALID → isError 携码拒执行', async () => {
    const { service, policies } = recordingSandbox();
    const tool = createBashTool({
      pipeline: fakePipeline(),
      workspaceRoot: () => process.cwd(),
      currentMode: modeClosure({ 's-bad': 'ULTRA' }, 'workspace-write'),
      sandboxService: service,
    });
    const result = await tool.execute({ command: 'echo bad' }, ctx('s-bad'));
    // 抛出面 catch 段：BaseError 携码前置披露——不裸跑不静默
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('[SANDBOX_MODE_INVALID]');
    expect(policies).toHaveLength(0); // 档都取不到——confine 未被调用
  });
});
