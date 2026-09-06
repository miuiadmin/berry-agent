/**
 * 任务执行 runner（04 §12：任务执行入口 = `berry-agent run --read-only`
 * ——headless 无应答者、审批天然 fail-closed〔§9 无静默审批单发形〕）。
 *
 * 两层：RunnerFactory 接缝（引擎只认接缝——spawn 编舞装配可换、测试注假件）
 * + 进程实装（node:child_process spawn、argv = `run --read-only --tick <名>`
 * ——子进程按名读行自跑 prompt；07 §5 --tick 旗标 = 触发载体、--read-only =
 * sandboxMode 只读单发）。
 *
 * kill 语义（pi-tick createRunControls 同律）：kill(reason) 幂等——首杀
 * SIGTERM、宽限后 SIGKILL 升级；调用方传的 reason 原样进 settled 结局。
 * settled 永不 reject：一切收场（正常/信号/spawn 失败/被杀）都归 RunOutcome。
 */
import { type ChildProcess, spawn } from 'node:child_process';
import type { JobRow, RunOutcome, TriggerKind } from './types.js';

/** 单次触发请求（引擎 → runner） */
export interface RunnerRequest {
  row: JobRow;
  trigger: TriggerKind;
  /** 引擎墙钟超时判据已裁（fire 起算毫秒）——runner 不再自设 */
  wallTimeoutMs: number;
}

/** 在飞 run 句柄（引擎的抢占与结算面） */
export interface RunnerHandle {
  /** 子进程 pid（spawn 失败形 null——判活与跨进程账面用） */
  readonly pid: number | null;
  /** 杀（幂等）：首杀 TERM、grace 后 KILL 升级；reason 进 settled 结局 */
  kill(reason: 'timeout' | 'preempted'): void;
  /** 结算 Promise（永不 reject——一切收场归 RunOutcome） */
  readonly settled: Promise<RunOutcome>;
}

/** runner 工厂接缝（引擎唯一执行出入口） */
export interface RunnerFactory {
  spawn(req: RunnerRequest): Promise<RunnerHandle>;
}

/** 进程实装装配面（全注入缺省真身——测试注假件零进程） */
export interface ProcessRunnerOptions {
  /** berry-agent 可执行（缺省 'berry-agent'——PATH 解析；装配批可指绝对径） */
  command?: string;
  /** argv 构造（缺省 run --read-only --tick <名>；装配批可换形） */
  buildArgv?: (row: JobRow, trigger: TriggerKind) => string[];
  /** spawn 函数（缺省 node:child_process.spawn——测试注入假进程） */
  spawnFn?: typeof spawn;
  /** TERM→KILL 宽限（缺省 5s） */
  killGraceMs?: number;
  /** 子进程环境（缺省白名单基座 env——host 装配批接线 exec env 同律） */
  env?: Record<string, string>;
  /** 时钟（结局 finishedAt 用——ISO UTC 字符串；缺省 new Date().toISOString()） */
  now?: () => string;
}

/** 结局预览截断（pi-tick TRANSCRIPT_FINAL_TEXT_PREVIEW 同值） */
const PREVIEW_CAP = 200;
/** 输出尾窗（字节——只保尾部供预览，防长输出吃内存） */
const OUTPUT_TAIL_BYTES = 4096;

/**
 * 进程 runner 工厂实装。
 *
 * stdout 取尾窗作 finalTextPreview（run --output-format text 缺省只出末条
 * assistant 文本——07 §5；尾窗即足）；stderr 尾窗作错误摘要源。
 */
export function createProcessRunnerFactory(options: ProcessRunnerOptions = {}): RunnerFactory {
  const command = options.command ?? 'berry-agent';
  const buildArgv = options.buildArgv ?? ((row: JobRow) => ['run', '--read-only', '--tick', row.name]);
  const spawnFn = options.spawnFn ?? spawn;
  const killGraceMs = options.killGraceMs ?? 5_000;
  const env = options.env ?? {};
  const now = options.now ?? (() => new Date().toISOString());

  return {
    async spawn(req: RunnerRequest): Promise<RunnerHandle> {
      const startedAtMs = Date.now();
      let child: ChildProcess;
      try {
        child = spawnFn(command, buildArgv(req.row, req.trigger), {
          cwd: req.row.cwd ?? undefined,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          // 独立进程组——kill 信号达子进程整树（exec spawn 管道同律）
          detached: true,
        });
      } catch (err) {
        // spawn 同步抛（可执行不存在等）——进程从未存在，直接归 spawn 结局
        const outcome: RunOutcome = {
          trigger: req.trigger,
          reason: 'spawn',
          error: describeError(err),
          finishedAt: now(),
        };
        return { pid: null, kill: () => {}, settled: Promise.resolve(outcome) };
      }

      let stdoutTail = '';
      let stderrTail = '';
      let settledResolve!: (outcome: RunOutcome) => void;
      const settled = new Promise<RunOutcome>((resolve) => {
        settledResolve = resolve;
      });
      let killedReason: 'timeout' | 'preempted' | null = null;
      let escalated = false;

      const appendTail = (current: string, chunk: string): string => (current + chunk).slice(-OUTPUT_TAIL_BYTES);

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutTail = appendTail(stdoutTail, chunk.toString('utf8'));
      });
      child.stderr?.on('data', (chunk: Buffer) => {
        stderrTail = appendTail(stderrTail, chunk.toString('utf8'));
      });

      const handle: RunnerHandle = {
        pid: child.pid ?? null,
        kill(reason) {
          if (killedReason !== null || settledResolve === undefined) return; // 幂等
          killedReason = reason;
          signalTree(child, 'SIGTERM');
          // 宽限后 KILL 升级（未收场才升——close 事件先到则定时器空放无害）
          setTimeout(() => {
            if (!escalated) {
              escalated = true;
              signalTree(child, 'SIGKILL');
            }
          }, killGraceMs).unref?.();
        },
        settled,
      };

      child.on('error', (err) => {
        if (settledResolve === undefined) return;
        const r = settledResolve;
        settledResolve = undefined as unknown as (o: RunOutcome) => void;
        r({
          trigger: req.trigger,
          reason: killedReason ?? 'spawn',
          error: describeError(err),
          finishedAt: now(),
        });
      });

      child.on('close', (code, signal) => {
        if (settledResolve === undefined) return;
        const r = settledResolve;
        settledResolve = undefined as unknown as (o: RunOutcome) => void;
        if (killedReason !== null) {
          r({
            trigger: req.trigger,
            reason: killedReason,
            error: `被杀（${killedReason === 'timeout' ? '墙钟超时' : '新实例抢占'}）`,
            finishedAt: now(),
          });
          return;
        }
        if (signal) {
          r({
            trigger: req.trigger,
            reason: 'killed',
            error: `外部信号 ${signal} 终止`,
            finishedAt: now(),
          });
          return;
        }
        const outcome: RunOutcome = {
          trigger: req.trigger,
          reason: 'exit_code',
          exitCode: code ?? 1,
          finishedAt: now(),
        };
        const preview = stdoutTail.trim();
        if (preview) outcome.finalTextPreview = preview.slice(0, PREVIEW_CAP);
        if ((code ?? 1) !== 0 && stderrTail.trim()) {
          outcome.error = lastLine(stderrTail).slice(0, PREVIEW_CAP);
        }
        void startedAtMs;
        r(outcome);
      });

      return handle;
    },
  };
}

/** 进程组信号（detached 子进程 pid 即组号——先组后单 pid 兜底） */
function signalTree(child: ChildProcess, sig: NodeJS.Signals): void {
  if (typeof child.pid === 'number') {
    try {
      process.kill(-child.pid, sig);
    } catch {
      /* 组不存在——单 pid 兜底 */
    }
  }
  try {
    child.kill(sig);
  } catch {
    /* 已死 */
  }
}

/** 错误转人读串 */
function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 尾行提取（错误摘要取末条非空行——pi-tick extractStderrSignature 保守档） */
function lastLine(text: string): string {
  const lines = text.trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]?.trim() ?? '';
    if (line) return line;
  }
  return '';
}
