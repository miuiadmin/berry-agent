/**
 * gate-exec 工厂单元测试（ex 批落码锁——03 §10.5 ex 定形注）。
 *
 * 覆盖面：守门三族折非 0（背景命令拒/git 重定向硬拒/沙箱缺席 fail-closed
 * ——不炸评测循环）+ 结算折形三分（exit 原值/timeout → timedOut/exit-null
 * → 非 0 + outcome 名）+ stderrTail 末行取行 + pipeline 收抵断言（owner
 * 'goal-gate' + 30s 帽 + cwd 锚）+ confine 恒 workspace-write 档 + 跨域
 * 同值对拍锁（exec 域 GATE_EXEC_TIMEOUT_MS ≡ goal 域 GATE_COMMAND_
 * TIMEOUT_MS——分域自持两常量不得漂移，测试面 import 两域合法）+
 * git 豁免两分支策略组装收抵（ex-2 + test/ex-1——豁免主仓形不携 deny/
 * 豁免 worktree 锚定形补 backing gitdir 可写根；对照 bash.test.ts 只读
 * 先例同构，锁 gate-exec.ts 独立抄写面不漂移）。
 *
 * 桩位：pipeline 全桩（捕获 request 返钦定 ExecResult）+ confine 捕获桩
 * （policy 断言面）——mock 只停在注入位（守门函数族全真）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { SandboxPolicy, SandboxService, ConfinedArgv } from '../safety/index.js';
import { canonicalPath } from '../safety/index.js';
import { GATE_COMMAND_TIMEOUT_MS } from '../goal/gates.js';
import { worktreeGitDir } from './git-guard.js';
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

/* ---------------- git 豁免两分支策略组装（04 §252 腿二抄写面收抵——ex-2 + test/ex-1） ---------------- */

describe('createGateExec git 豁免策略组装（独立抄写面不漂移）', () => {
  it('豁免命令 + 主仓形：不携 denyWritePaths/writableRoots（裸 workspace-write 形）', async () => {
    const { pipeline } = stubPipeline(execResult());
    const captured: { policy?: SandboxPolicy; argv?: readonly string[] } = {};
    const deps = factoryDeps({ pipeline, sandboxService: captureSandbox(captured) });
    const gate = createGateExec(deps);
    // 白名单命令（'git commit -m x'——首词 git + 次词 commit ∈ GIT_METADATA_COMMANDS，无展开无子壳）
    await gate.execCommand('git commit -m x');
    // 豁免形：策略不携 workspace .git 写 deny（白名单命令放行面——对照 bash.test.ts :459 先例）
    expect(captured.policy?.mode).toBe('workspace-write');
    expect(captured.policy?.workspaceRoot).toBe(deps.ws);
    expect(captured.policy?.denyWritePaths).toBeUndefined();
    // 主仓形无 worktree 授予腿（tmpWs 无 .git → worktreeGitDir 探测 undefined）——writableRoots 同不携
    expect(captured.policy?.writableRoots).toBeUndefined();
  });

  it('豁免命令 + worktree 锚定：backing common git dir 入 writableRoots', async () => {
    // worktree 夹具（同构 bash.test.ts :476-497 先例——其夹具私有不可 import，手搭同形）：
    // 主仓预置 .git/worktrees/<名> backing 目录 + worktree 根 .git 文件指针（gitdir: 指回 backing）
    const repo = mkdtempSync(join(tmpdir(), 'gate-exec-wt-repo-'));
    dirs.push(repo);
    const backing = join(repo, '.git', 'worktrees', 'wt');
    mkdirSync(backing, { recursive: true });
    const wt = mkdtempSync(join(tmpdir(), 'gate-exec-wt-ws-'));
    dirs.push(wt);
    writeFileSync(join(wt, '.git'), `gitdir: ${backing}\n`);

    const { pipeline } = stubPipeline(execResult());
    const captured: { policy?: SandboxPolicy; argv?: readonly string[] } = {};
    const gate = createGateExec({ pipeline, sandboxService: captureSandbox(captured), workspaceRoot: () => wt });
    await gate.execCommand('git commit -m x');

    // 豁免 + worktree 锚定：不携 deny、backing（common git dir）入可写根
    // （gate 档恒 workspace-write——bash.ts 的 worktreeGitDir 消费 mode 判在此恒真，
    //  等价省略；原注锚 :253 已漂移、现位 :354——行号免锚防漂移，以判定语义定位）
    expect(captured.policy?.mode).toBe('workspace-write');
    expect(captured.policy?.denyWritePaths).toBeUndefined();
    expect(captured.policy?.writableRoots).toBeDefined();
    // common git dir（主仓 .git——对象库/refs/backing 共享落点）在可写根内（修 worktree git 沙箱断链）
    expect(captured.policy?.writableRoots).toContain(worktreeGitDir(wt));
    // 缺省可写根族保全（workspace 本根不被授予腿顶替——追加律非覆盖律；
    // canonical 归一对拍——macOS /var → /private/var 符号链解析同形）
    expect(captured.policy?.writableRoots).toContain(canonicalPath(wt));
  });
});

/* ---------------- git push 截获（03 :823 六役消费位接线——纯增序） ---------------- */

describe('createGateExec git push 截获（03 :823 六役——守门缺位收口；修前红锚：push 形照常放行进执行段）', () => {
  // 词干变形矩阵与 bash.test.ts 腿三硬拒矩阵同源对拍（isGitPushAttempt
  // 真身单源——gate 侧只锁「守门消费位在场」这一件事，词干判覆盖面归 git-guard 测试辖）
  it.each([
    ['git push origin main', '主形带 remote/分支参'],
    ['git -C sub push', '全局旗 -C 变形'],
    ['git --git-dir=.git push', '--git-dir= 自包含形'],
    ['GIT_DIR=.git git push', '段首 env 赋值前缀形'],
    ['git status && git push', '分段组合形'],
  ])('push 形命令 %s（%s）硬拒：exitCode 1 + stderrTail 带 EXEC_GIT_PUSH_DENIED，pipeline 零收抵', async (command) => {
    const { pipeline, requests } = stubPipeline(execResult());
    const deps = factoryDeps({ pipeline });
    const gate = createGateExec(deps);
    const result = await gate.execCommand(command);
    expect(result.exitCode).toBe(1);
    expect(result.timedOut).toBe(false);
    expect(result.stderrTail).toContain('EXEC_GIT_PUSH_DENIED');
    expect(requests).toHaveLength(0); // 截获在 spawn 之前（远端史不可逆写——全档无升权出路）
  });

  it('不误伤：git commit -m push（-m 参值非子命令位）照常进执行段', async () => {
    const { pipeline, requests } = stubPipeline(execResult());
    const deps = factoryDeps({ pipeline });
    const gate = createGateExec(deps);
    const result = await gate.execCommand('git commit -m push');
    expect(result.stderrTail).not.toContain('EXEC_GIT_PUSH_DENIED');
    expect(requests).toHaveLength(1); // 未截获——照常 spawn
  });
});
