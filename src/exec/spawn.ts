/**
 * spawn 管道真身（04 §11 六条款的执行体：失败二分/进程组树杀/超时归因/
 * 输出保尾/env 白名单/子进程登记）。
 *
 * 编排单入口 run()：空 argv 与预中止两防御 → spawn（detached 独立进程组）
 * → 登记入册 → 三源竞速（自然退出/超时/打断——先到者落归因即封，其余源
 * 结算即摘监听）→ close 结算保尾产出。spawn 'error'（进程从未存在）走
 * BaseError EXEC_SPAWN_FAILED 抛出面——与 exitCode ≠ 0（执行阶段失败，正常
 * 结算进 result）构成失败二分。
 *
 * 树杀纪律：超时/打断即进程组树杀（SIGKILL 直杀不递进 TERM——预算已燃尽，
 * 可捕获信号的优雅退出窗会拉长超时尾；组杀失败〔组不在〕降杀进程本体）。
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { BaseError } from '../contracts/index.js';
import { createLogger } from '../context/index.js';
import type { Logger } from '../context/index.js';
import { buildChildEnv } from './env.js';
import { createProcessRegistry, type RegistryOptions } from './registry.js';
import { OutputTail } from './tail.js';
import type { ExecResult, ExecOutcome, SpawnPipeline, SpawnRequest } from './types.js';

/** 管道构造依赖（全可注入——测试零真终端/真时钟依赖） */
export interface SpawnPipelineOptions extends RegistryOptions {
  /** 宿主环境拷贝源（env 白名单消费；缺省 process.env） */
  readonly hostEnv?: NodeJS.ProcessEnv;
}

/** run() 内部依赖束（工厂闭包传形——不进公共面） */
interface RunDeps {
  readonly logger: Logger;
  readonly now: () => number;
  readonly hostEnv: NodeJS.ProcessEnv;
  readonly hostPid: number;
  readonly registry: ReturnType<typeof createProcessRegistry>;
}

/**
 * 建 spawn 管道（登记簿随建——宿主启动期孤儿清扫消费 pipeline.registry）。
 */
export function createSpawnPipeline(options: SpawnPipelineOptions = {}): SpawnPipeline {
  const logger = options.logger ?? createLogger('exec');
  const now = options.now ?? Date.now;
  const hostEnv = options.hostEnv ?? process.env;
  const hostPid = options.hostPid ?? process.pid;
  const registry = createProcessRegistry(options);
  const deps: RunDeps = { logger, now, hostEnv, hostPid, registry };
  return {
    registry,
    run: (request) => runSpawn(request, deps),
  };
}

/** 单次执行真身（run 入口的自由函数形——闭包依赖束显式传） */
async function runSpawn(request: SpawnRequest, deps: RunDeps): Promise<ExecResult> {
  const argv0 = request.argv[0];
  if (argv0 === undefined || argv0 === '') {
    throw new BaseError('EXEC_SPAWN_FAILED', 'argv 为空——无可执行（spawn 阶段失败前置防御）');
  }
  // 预中止请求：不造进程直接结算（打断先到——竞速的时序前移态）
  if (request.signal?.aborted) {
    return {
      outcome: 'abort',
      exitCode: null,
      stdout: '',
      stderr: '',
      truncated: false,
      bytes: 0,
      durationMs: 0,
    };
  }
  const start = deps.now();
  const child = spawn(argv0, request.argv.slice(1), {
    cwd: request.cwd,
    // 独立进程组（posix）——树杀的组锚；win32 语义为 CREATE_NEW_PROCESS_GROUP
    detached: true,
    // 04 §8 无 stdin：bash 工具面不喂输入；后续桥件自定 stdio 时不走本管道缺省
    stdio: ['ignore', 'pipe', 'pipe'],
    env: buildChildEnv(request.env, deps.hostEnv),
  });
  if (child.pid !== undefined) {
    deps.registry.add({
      pid: child.pid,
      argv: request.argv,
      owner: request.owner ?? 'exec',
      hostPid: deps.hostPid,
      startedAt: deps.now(),
    });
  }
  return await new Promise<ExecResult>((resolve, reject) => {
    const tail = new OutputTail();
    let settled = false;
    let outcome: ExecOutcome = 'exit';
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;

    // 摘源（先到者结算即封后，其余源到达即摘——timer 清除 + abort 摘监听）
    const detachSources = (): void => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (onAbort !== undefined && request.signal !== undefined) {
        request.signal.removeEventListener('abort', onAbort);
        onAbort = undefined;
      }
    };
    const settle = (o: ExecOutcome): void => {
      if (settled) return;
      settled = true;
      outcome = o;
      detachSources();
      // 超时/打断即树杀（close 随后到达完成结算——归因已封不改写）
      if (o !== 'exit' && child.pid !== undefined) killProcessTree(child.pid, deps.logger);
    };

    child.stdout?.on('data', (chunk: Buffer) => tail.append('stdout', chunk));
    child.stderr?.on('data', (chunk: Buffer) => tail.append('stderr', chunk));

    // 失败二分前者：error 事件 = spawn 阶段失败（进程从未存在——ENOENT/EACCES）；
    // 结算后的迟到 error（stdio EPIPE 类）不改写已封归因
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      detachSources();
      if (child.pid !== undefined) deps.registry.remove(child.pid);
      reject(
        new BaseError('EXEC_SPAWN_FAILED', `spawn 失败（进程从未存在）：${request.argv.join(' ')}——${error.message}`, {
          cause: error,
        }),
      );
    });

    if (request.timeoutMs !== undefined && request.timeoutMs > 0) {
      timer = setTimeout(() => settle('timeout'), request.timeoutMs);
    }
    if (request.signal !== undefined) {
      onAbort = () => settle('abort');
      request.signal.addEventListener('abort', onAbort);
    }

    // close（非 exit）——stdio 全闭才是输出终值点；自然退出也经 settle 收编
    // （已封则 no-op，归因保留先到者）
    child.on('close', (code) => {
      settle('exit');
      detachSources();
      if (child.pid !== undefined) deps.registry.remove(child.pid);
      const finished = tail.finish();
      resolve({
        outcome,
        exitCode: outcome === 'exit' ? (code ?? child.exitCode ?? null) : null,
        ...finished,
        durationMs: deps.now() - start,
      });
    });
  });
}

/* ------------------------------------------------------------------ */
/* 平台真身（孤儿清扫 SweepDeps 与树杀的平台实现——装配/测试注入桩替身可测） */
/* ------------------------------------------------------------------ */

/**
 * 进程组树杀（04 §11）：posix 负 pid 组杀（SIGKILL 直杀——预算已燃尽不递进
 * TERM，可捕获信号会拉长超时尾）；组不在（子未成组长）降杀本体。win32 走
 * taskkill /T /F（树形递归强杀）。
 */
export function killProcessTree(pid: number, logger: Logger = createLogger('exec')): void {
  if (process.platform === 'win32') {
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    killer.on('error', (error) => logger.warn('taskkill 树杀失败', { pid, error: error.message }));
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // 本体也已不在——树杀幂等语义，静默（close 随后到达）
    }
  }
}

/** pid 判活（posix 惯例 kill(pid, 0)；EPERM = 存在但非本主——仍算活） */
export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * 读进程命令行（pid 复用防线比对源）：linux 走 /proc/<pid>/cmdline（NUL 分隔
 * argv），其余平台走 ps -o command=（同步一次性——仅宿主启动期清扫用，不进
 * 热路径）。读不到返回 null（清扫面视为不匹配跳过）。
 */
export function readCmdlineSync(pid: number): string | null {
  if (process.platform === 'linux') {
    try {
      const raw = readFileSync(`/proc/${pid}/cmdline`, 'utf8');
      return raw.split('\0').filter(Boolean).join(' ').trim();
    } catch {
      return null;
    }
  }
  try {
    return execSync(`ps -o command= -p ${pid}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
