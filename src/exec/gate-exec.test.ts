/**
 * gate-exec 工厂单元测试（ex 批落码锁——03 §10.5 ex 定形注）。
 *
 * 覆盖面：守门三族折非 0（背景命令拒/git 重定向硬拒/沙箱缺席 fail-closed
 * ——不炸评测循环）+ 结算折形三分（exit 原值/timeout → timedOut/exit-null
 * → 非 0 + outcome 名）+ stderrTail 末行取行 + pipeline 收抵断言（owner
 * 'goal-gate' + 30s 帽 + cwd 锚）+ confine 恒 workspace-write 档 + 跨域
 * 同值对拍锁（exec 域 GATE_EXEC_TIMEOUT_MS ≡ goal 域 GATE_COMMAND_
 * TIMEOUT_MS——分域自持两常量不得漂移，测试面 import 两域合法）。
 *
 * 桩位：pipeline 全桩（捕获 request 返钦定 ExecResult）+ confine 捕获桩
 * （policy 断言面）——mock 只停在注入位（守门函数族全真）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { SandboxPolicy, SandboxService, ConfinedArgv } from '../safety/index.js';
import { GATE_COMMAND_TIMEOUT_MS } from '../goal/gates.js';
import { createGateExec, GATE_EXEC_OWNER, GATE_EXEC_TIMEOUT_MS, type GateExecFactoryDeps } from './gate-exec.js';
import type { ExecResult, SpawnPipeline, SpawnRequest } from './types.js';

/* ---------------- 测试基建 ---------------- */

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 临时工作区（git 重定向扫描与 cwd 锚真目录） */
function tmpWs(): string {
  const dir = mkdtempSync(join(tmpdir(), 'gate-exec-'));
  dirs.push(dir);
  return dir;
}

/** 钦定 ExecResult（缺省 exit 0 全字段形） */
function execResult(over: Partial<ExecResult> = {}): ExecResult {
  return {
    outcome: 'exit',
    exitCode: 0,
    stdout: '',
    stderr: '',
    truncated: false,
    bytes: 0,
    durationMs: 1,
    ...over,
  };
}

/**
 * pipeline 桩：捕获收抵 request、返钦定结果（或按序队列）。gate-exec 只
 * 消费 run 面——spawnInteractive/registry 缺省桩形（as 断言窄桩）。
 */
function stubPipeline(result: ExecResult | ExecResult[]): {
  pipeline: SpawnPipeline;
  requests: SpawnRequest[];
} {
  const requests: SpawnRequest[] = [];
  const queue = Array.isArray(result) ? [...result] : null;
  const single = Array.isArray(result) ? undefined : result;
  const pipeline = {
    run: async (req: SpawnRequest): Promise<ExecResult> => {
      requests.push(req);
      if (queue !== null) {
        const next = queue.shift();
        if (next === undefined) throw new Error('pipeline 桩结果队列耗尽');
        return next;
      }
      return single!;
    },
    spawnInteractive: () => {
      throw new Error('gate-exec 不消费 spawnInteractive——测试桩不可达');
    },
    registry: { entries: () => [] },
  } as unknown as SpawnPipeline;
  return { pipeline, requests };
}

/** confine 捕获桩（恒等 argv + policy 落捕获格——档位断言面） */
function captureSandbox(captured: { policy?: SandboxPolicy; argv?: readonly string[] }): SandboxService {
  return {
    confine: (argv, policy): ConfinedArgv => {
      captured.argv = [...argv];
      captured.policy = policy;
      return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] };
    },
    registerBackend: () => () => {},
    listBackends: () => [],
  };
}

/** 组工厂依赖（缺省 identity 形——sandbox 缺席专项例独立覆盖） */
function factoryDeps(over: Partial<GateExecFactoryDeps> & { ws?: string } = {}): GateExecFactoryDeps & { ws: string } {
  const ws = over.ws ?? tmpWs();
  return {
    pipeline: stubPipeline(execResult()).pipeline,
    sandboxService: captureSandbox({}),
    workspaceRoot: () => ws,
    ...over,
    ws,
  };
}

/* ---------------- 跨域同值对拍锁（分域自持律） ---------------- */

describe('GATE_EXEC_TIMEOUT_MS 跨域同值对拍', () => {
  it('exec 域与 goal 域两常量相等（分域自持不得漂移——exec 席 DAG 无 goal 边）', () => {
    expect(GATE_EXEC_TIMEOUT_MS).toBe(30_000);
    expect(GATE_COMMAND_TIMEOUT_MS).toBe(GATE_EXEC_TIMEOUT_MS);
  });
});

/* ---------------- 守门三族折非 0（裁决 3——不炸评测循环） ---------------- */

describe('createGateExec 守门执法（折非 0 形）', () => {
  it('背景命令拒：折 exitCode 1 + stderrTail 带码名，pipeline 零收抵', async () => {
    const { pipeline, requests } = stubPipeline(execResult());
    const deps = factoryDeps({ pipeline });
    const gate = createGateExec(deps);
    const result = await gate.execCommand('sleep 100 &');
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.stderrTail).toContain('EXEC_BACKGROUND_REJECTED');
    expect(requests).toHaveLength(0); // 守门拦截在 spawn 之前
  });

  it('git 重定向硬拒：.git 内目标折非 0 + EXEC_GIT_REDIRECT_DENIED', async () => {
    const deps = factoryDeps();
    const gate = createGateExec(deps);
    const result = await gate.execCommand(`echo x > ${join(deps.ws, '.git', 'config')}`);
    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toContain('EXEC_GIT_REDIRECT_DENIED');
  });

  it('沙箱缺席 fail-closed：折非 0 + SANDBOX_UNAVAILABLE（不静默裸跑）', async () => {
    const deps = factoryDeps();
    const gate = createGateExec({ pipeline: deps.pipeline, workspaceRoot: deps.workspaceRoot });
    const result = await gate.execCommand('echo ok');
    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toContain('SANDBOX_UNAVAILABLE');
  });

  it('非 BaseError 抛错（confine 桩炸）折非 0 无码前缀——评测循环不炸', async () => {
    const boom: SandboxService = {
      confine: () => {
        throw new Error('后端链病理');
      },
      registerBackend: () => () => {},
      listBackends: () => [],
    };
    const deps = factoryDeps({ sandboxService: boom });
    const gate = createGateExec(deps);
    const result = await gate.execCommand('echo ok');
    expect(result.exitCode).toBe(1);
    expect(result.stderrTail).toContain('后端链病理');
    expect(result.stderrTail).not.toMatch(/^\[/); // 无码前缀（非 BaseError）
  });
});

/* ---------------- 结算折形三分（裁决 3 细则） ---------------- */

describe('createGateExec 结算折形', () => {
  it('exit 0 / exit 非 0：退出码原值透传 + timedOut false', async () => {
    const gate = createGateExec(
      factoryDeps({
        pipeline: stubPipeline([
          execResult({ exitCode: 0, stderr: 'warn 噪声\n' }),
          execResult({ exitCode: 3, stderr: 'boom' }),
        ]).pipeline,
      }),
    );
    const ok = await gate.execCommand('printf ok');
    expect(ok).toEqual({ exitCode: 0, timedOut: false, stderrTail: 'warn 噪声' }); // 尾换行剥除取末行
    const bad = await gate.execCommand('exit 3');
    expect(bad).toEqual({ exitCode: 3, timedOut: false, stderrTail: 'boom' });
  });

  it('timeout 形：exitCode 折非 0 + timedOut true（评测判超时门）', async () => {
    const gate = createGateExec(
      factoryDeps({ pipeline: stubPipeline(execResult({ outcome: 'timeout', exitCode: null, stderr: '' })).pipeline }),
    );
    const result = await gate.execCommand('sleep 999');
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(true);
  });

  it('exit-null 形（被杀/abort）：exitCode 折非 0 + stderrTail 带 outcome 名', async () => {
    const gate = createGateExec(
      factoryDeps({
        pipeline: stubPipeline(execResult({ outcome: 'abort', exitCode: null, stderr: '第一行\n信号终止' })).pipeline,
      }),
    );
    const result = await gate.execCommand('anything');
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.stderrTail).toBe('[outcome: abort] 信号终止'); // 末行 + outcome 名前缀
  });

  it('stderrTail 末行取行：多行保尾段取末行、纯空白归空串', async () => {
    const gate = createGateExec(
      factoryDeps({
        pipeline: stubPipeline([
          execResult({ exitCode: 2, stderr: 'line1\nline2\nline3' }),
          execResult({ exitCode: 2, stderr: '\n  \n' }),
        ]).pipeline,
      }),
    );
    const multi = await gate.execCommand('a');
    expect(multi.stderrTail).toBe('line3');
    const blank = await gate.execCommand('b');
    expect(blank.stderrTail).toBe('');
  });
});

/* ---------------- pipeline 收抵断言（裁决 2/4——档位/帽/owner/cwd） ---------------- */

describe('createGateExec 执行段收抵（pipeline.request 断言）', () => {
  it('owner 恒 goal-gate + timeoutMs 恒 30s 帽 + cwd 锚工作区根 + confine 恒 workspace-write', async () => {
    const { pipeline, requests } = stubPipeline(execResult());
    const captured: { policy?: SandboxPolicy; argv?: readonly string[] } = {};
    const deps = factoryDeps({ pipeline, sandboxService: captureSandbox(captured) });
    const gate = createGateExec(deps);
    await gate.execCommand('printf ok');

    expect(requests).toHaveLength(1);
    const req = requests[0]!;
    expect(req.owner).toBe(GATE_EXEC_OWNER);
    expect(req.owner).toBe('goal-gate');
    expect(req.timeoutMs).toBe(30_000);
    expect(req.cwd).toBe(deps.ws);
    // bash -lc 编舞同源（confine 前 argv 三件：bash 发现位 + -lc + 命令）
    expect(captured.argv?.[1]).toBe('-lc');
    expect(captured.argv?.[2]).toBe('printf ok');
    // 恒 workspace-write（裁决 2——不随会话档；deny 面 = workspace .git）
    expect(captured.policy?.mode).toBe('workspace-write');
    expect(captured.policy?.workspaceRoot).toBe(deps.ws);
    const deny = (captured.policy as { denyWritePaths?: readonly string[] }).denyWritePaths;
    expect(deny).toBeDefined();
    expect(deny!.join('\n')).toContain('.git');
  });

  it('workspaceRoot 取值器活查（多次调用重求值非快照）', async () => {
    const ws1 = tmpWs();
    const ws2 = tmpWs();
    const { pipeline, requests } = stubPipeline([execResult(), execResult()]);
    let current = ws1;
    const gate = createGateExec({ pipeline, sandboxService: captureSandbox({}), workspaceRoot: () => current });
    await gate.execCommand('echo 1');
    current = ws2;
    await gate.execCommand('echo 2');
    expect(requests[0]?.cwd).toBe(ws1);
    expect(requests[1]?.cwd).toBe(ws2);
  });
});
