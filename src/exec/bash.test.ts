/**
 * bash 工具件测试（04 §8：发现序/后台化截获/超时/失败二分/沙箱消费三分类/
 * 升权 allowed-once）。真 bash 腿走系统 bash（PATH 在场——CI/dev 机恒真）；
 * 沙箱分类腿用 stub SandboxService（node 脚本伪 runner 打签名——不依赖平台
 * 真沙箱后端）。
 */
import { describe, expect, it } from 'vitest';
import { execPath } from 'node:process';
import type { ToolContext } from '../contracts/index.js';
import { BaseError } from '../contracts/index.js';
import type { ConfinedArgv, SandboxMode, SandboxService } from '../safety/index.js';
import { assertNoBackgroundCommand, createBashTool, discoverBash } from './bash.js';
import { createSpawnPipeline } from './spawn.js';
import type { SpawnPipeline } from './types.js';

const CTX: ToolContext = { toolCallId: 'tc-bash-test' };

/** 工具文本腿提取 */
const textOf = (result: { content: { type: string; text?: string }[] }): string => {
  const first = result.content[0];
  return first !== undefined && first.type === 'text' ? (first.text ?? '') : '';
};

/** 直跑危险档工具（无沙箱服务依赖——danger 透传腿） */
function dangerTool(pipeline: SpawnPipeline, env?: NodeJS.ProcessEnv) {
  return createBashTool({
    pipeline,
    workspaceRoot: () => process.cwd(),
    currentMode: () => 'danger',
    ...(env !== undefined ? { env } : {}),
  });
}

describe('assertNoBackgroundCommand 后台化截获', () => {
  it.each(['sleep 5 &', 'sleep 5 &  ', 'foo | bar &'])('拒：尾部单 & —— %s', (cmd) => {
    expect(() => assertNoBackgroundCommand(cmd)).toThrowError(BaseError);
    try {
      assertNoBackgroundCommand(cmd);
      expect.unreachable();
    } catch (error) {
      expect(error instanceof BaseError && error.code).toBe('EXEC_BACKGROUND_REJECTED');
    }
  });

  it.each(['nohup sleep 5', 'disown foo'])('拒：命令位脱管语义 —— %s', (cmd) => {
    expect(() => assertNoBackgroundCommand(cmd)).toThrowError(/脱管/);
  });

  it.each(['echo "a & b"', 'cd /tmp && ls', 'echo nohup', 'grep nohup file.txt', 'a && b && c'])(
    '放：非后台形态 —— %s',
    (cmd) => {
      expect(() => assertNoBackgroundCommand(cmd)).not.toThrow();
    },
  );
});

describe('discoverBash 发现序', () => {
  it('BERRY_AGENT_BASH_PATH 显式指名优先（指谁用谁——X_OK 即收）', () => {
    const found = discoverBash({ BERRY_AGENT_BASH_PATH: execPath, PATH: '/nonexistent' });
    expect(found).toBe(execPath);
  });

  it('显式指名不可执行 → fail-loud 带修复提示（不静默回落 PATH）', () => {
    try {
      discoverBash({ BERRY_AGENT_BASH_PATH: '/nonexistent/bash-xyz', PATH: '/bin' });
      expect.unreachable();
    } catch (error) {
      expect(error instanceof BaseError && error.code).toBe('EXEC_SPAWN_FAILED');
      expect(error instanceof Error && error.message).toContain('BERRY_AGENT_BASH_PATH');
    }
  });

  it('PATH 扫描命中真 bash', () => {
    const found = discoverBash({ PATH: process.env.PATH });
    expect(found.endsWith('bash')).toBe(true);
  });

  it('全链缺席 → fail-loud（不降级 cmd）', () => {
    expect(() => discoverBash({ PATH: '/nonexistent-dir-xyz' })).toThrowError(BaseError);
  });
});

describe('createBashTool 工具面', () => {
  it('schema 形：五参数面 + additionalProperties:false + effect write', () => {
    const tool = dangerTool(createSpawnPipeline());
    expect(tool.name).toBe('bash');
    expect(tool.effect).toBe('write');
    const schema = tool.parameters as { properties: Record<string, unknown>; additionalProperties: boolean };
    expect(Object.keys(schema.properties).sort()).toEqual(
      ['command', 'cwd', 'justification', 'sandbox_permissions', 'timeoutMs'].sort(),
    );
    expect(schema.additionalProperties).toBe(false);
  });

  it('真 bash——echo 回执（exit 0 非 isError）', { timeout: 15_000 }, async () => {
    const result = await dangerTool(createSpawnPipeline()).execute({ command: "echo 'hello-bash'" }, CTX);
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('Exit code: 0');
    expect(textOf(result)).toContain('hello-bash');
  });

  it('执行阶段失败分报——exit 3 → isError 带退出码（不抛）', { timeout: 15_000 }, async () => {
    const result = await dangerTool(createSpawnPipeline()).execute({ command: 'exit 3' }, CTX);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Exit code: 3');
  });

  it('stderr 段在场', { timeout: 15_000 }, async () => {
    const result = await dangerTool(createSpawnPipeline()).execute({ command: "echo 'boom' >&2; true" }, CTX);
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('--- stderr ---');
    expect(textOf(result)).toContain('boom');
  });

  it('超时——EXEC_TIMEOUT 归因 + 树杀', { timeout: 15_000 }, async () => {
    const result = await dangerTool(createSpawnPipeline()).execute({ command: 'sleep 30', timeoutMs: 300 }, CTX);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('EXEC_TIMEOUT');
  });

  it('后台化截获——EXEC_BACKGROUND_REJECTED 数据面（不 spawn）', async () => {
    const result = await dangerTool(createSpawnPipeline()).execute({ command: 'sleep 30 &' }, CTX);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('EXEC_BACKGROUND_REJECTED');
  });

  it('env 白名单继承面——宿主凭证缺席、PATH 在场', { timeout: 15_000 }, async () => {
    const pipeline = createSpawnPipeline({
      hostEnv: { ...process.env, BERRY_TEST_SECRET_SENTINEL: 'leak-me' },
    });
    const result = await dangerTool(pipeline).execute(
      { command: 'printenv BERRY_TEST_SECRET_SENTINEL || echo NO_SECRET' },
      CTX,
    );
    expect(textOf(result)).toContain('NO_SECRET');
    expect(textOf(result)).not.toContain('leak-me');
  });

  it('cwd 缺省 = 工作区根（workspaceRoot 取值面）', { timeout: 15_000 }, async () => {
    const result = await createBashTool({
      pipeline: createSpawnPipeline(),
      workspaceRoot: () => '/tmp',
      currentMode: () => 'danger',
    }).execute({ command: 'pwd' }, CTX);
    // macOS /tmp → /private/tmp 符号链解析
    expect(textOf(result)).toMatch(/\/(private\/)?tmp/);
  });
});

describe('createBashTool 沙箱消费三分类（stub 后端）', () => {
  /** stub confine：用 node 脚本伪 runner（打签名——分类逻辑可测不依赖平台后端） */
  function stubSandbox(script: string, extra: Partial<ConfinedArgv> = {}): SandboxService {
    return {
      confine: (): ConfinedArgv => ({
        argv: [execPath, '-e', script],
        enforcement: 'full',
        denialSignatures: ['operation not permitted'],
        runnerFailureRules: [{ fatalSignatures: ['runner-init-failed'] }],
        ...extra,
      }),
      registerBackend: () => () => {},
      listBackends: () => [],
    };
  }
  const confinedTool = (sandbox: SandboxService, mode: SandboxMode = 'workspace-write') =>
    createBashTool({
      pipeline: createSpawnPipeline(),
      workspaceRoot: () => process.cwd(),
      currentMode: () => mode,
      sandboxService: sandbox,
    });

  it('干净退出——受限档透传结果', { timeout: 15_000 }, async () => {
    const result = await confinedTool(stubSandbox("process.stdout.write('confined-ok')")).execute(
      { command: 'echo hi' },
      CTX,
    );
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('confined-ok');
  });

  it('策略拒绝——denialSignatures 命中：拒绝标记 + 升权提示', { timeout: 15_000 }, async () => {
    const result = await confinedTool(
      stubSandbox("process.stderr.write('sandbox: operation not permitted\\n'); process.exit(1)"),
    ).execute({ command: 'touch /etc/x' }, CTX);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('[sandbox: file access denied under workspace-write]');
    expect(textOf(result)).toContain('[sandbox hint:');
    expect(textOf(result)).toContain('operation not permitted');
  });

  it('runner 自身失败——fatalSignatures 命中：EXEC_SPAWN_FAILED 分类', { timeout: 15_000 }, async () => {
    const result = await confinedTool(
      stubSandbox("process.stderr.write('seatbelt runner-init-failed: profile parse\\n'); process.exit(1)"),
    ).execute({ command: 'echo hi' }, CTX);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('[EXEC_SPAWN_FAILED] 沙箱 runner 未跑起来');
  });

  it('非零退出但签名不命中——普通执行失败（不误标沙箱腿）', { timeout: 15_000 }, async () => {
    const result = await confinedTool(stubSandbox('process.exit(2)')).execute({ command: 'exit 2' }, CTX);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Exit code: 2');
    expect(textOf(result)).not.toContain('[sandbox:');
  });

  it('受限档 + 沙箱服务缺席 → fail-closed 拒裸跑', async () => {
    const result = await createBashTool({
      pipeline: createSpawnPipeline(),
      workspaceRoot: () => process.cwd(),
      currentMode: () => 'workspace-write',
    }).execute({ command: 'echo hi' }, CTX);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('SANDBOX_UNAVAILABLE');
  });
});

describe('createBashTool 升权面（allowed-once 语义）', () => {
  const escalationArgs = {
    command: "echo 'escalated'",
    sandbox_permissions: 'danger',
    justification: '需要装依赖',
  };

  it('审批 allowed-once → 本调用以目标档执行', { timeout: 15_000 }, async () => {
    const asked: unknown[] = [];
    const result = await createBashTool({
      pipeline: createSpawnPipeline(),
      workspaceRoot: () => process.cwd(),
      currentMode: () => 'read-only',
      approval: {
        ask: async (req) => {
          asked.push(req);
          return { outcome: 'allowed-once' as const };
        },
      },
    }).execute(escalationArgs, CTX);
    // 审批载荷面（toolName/toolCallId 透传）
    expect(asked).toHaveLength(1);
    expect(result.isError).toBeUndefined();
    expect(textOf(result)).toContain('escalated');
  });

  it('审批 rejected → isError 且不带升权提示（拒绝是最终的）', async () => {
    const result = await createBashTool({
      pipeline: createSpawnPipeline(),
      workspaceRoot: () => process.cwd(),
      currentMode: () => 'read-only',
      approval: { ask: async () => ({ outcome: 'rejected' as const }) },
    }).execute(escalationArgs, CTX);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('升权审批未通过');
    expect(textOf(result)).not.toContain('[sandbox hint:');
  });

  it('审批面缺席 → fail-closed 拒（无「无审批静默放行」）', async () => {
    const result = await createBashTool({
      pipeline: createSpawnPipeline(),
      workspaceRoot: () => process.cwd(),
      currentMode: () => 'read-only',
    }).execute(escalationArgs, CTX);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('升权审批面缺席');
  });

  it('非严格变宽（同档请求）→ SANDBOX_ESCALATION_INVALID 前置拒', async () => {
    const result = await createBashTool({
      pipeline: createSpawnPipeline(),
      workspaceRoot: () => process.cwd(),
      currentMode: () => 'workspace-write',
      approval: { ask: async () => ({ outcome: 'allowed-once' as const }) },
    }).execute({ command: 'echo hi', sandbox_permissions: 'workspace-write', justification: '同档' }, CTX);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('SANDBOX_ESCALATION_INVALID');
  });

  it('参数不成对（只带 justification）→ 前置拒', async () => {
    const result = await dangerTool(createSpawnPipeline()).execute({ command: 'echo hi', justification: '半参' }, CTX);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('SANDBOX_ESCALATION_INVALID');
  });
});
