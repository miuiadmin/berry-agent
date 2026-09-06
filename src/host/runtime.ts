/**
 * host/runtime — 装配序生命周期骨架（04 篇 §1 进程模型；07 §1.1 表 #10 host 席）。
 *
 * 启动序：解析数据目录（memory 形豁免）→ 单活跃机占标记（先占标记再开库——
 * 拒双开于开库之前）→ Persistence 开库（openStore 门禁序内嵌）→ 披露段组装。
 * 退出序（04 §1 六步全序有界）：① abort 置位（在飞 run 收打断信号）→
 * ② closer 队列 drain（有界 5s——在飞子代理/子进程结算，超时强杀）→
 * ③ write-behind flush（durable 落盘）→ ④ session_shutdown 并行有界 2s
 * （件级收口钩子）→ ⑤ 作用域 LIFO 回卷（dispose 全序）→ ⑥ 释放活跃标记 +
 * 关库。一步崩不阻后续步（退出序容错——落盘步永达）。SIGINT②→130 /
 * SIGTERM 同① / crash.log 崩溃取证 = 进程编舞归 CLI 分派层（批 12c）——
 * 本件只提供编舞本体（不 process.exit，可测）。
 *
 * :memory: 同构纪律（05 §6.6/07 §5）：dump-config 类诊断不开真库、不动活跃
 * 标记——memory 形走同一运行时装配入口、会话主库零落盘。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { release as osRelease } from 'node:os';
import { join } from 'node:path';

import { MEMORY_DB_PATH, Persistence, resolveDataDir } from '../persist/index.js';
import type { PersistenceOptions } from '../persist/index.js';

import { collectDate, collectPlatform, renderEnvironmentDisclosure } from './disclosure.js';
import { acquireActiveMarker } from './single-instance.js';
import type { ActiveMarkerLease } from './single-instance.js';

/** closer 项（收口动作 + 标签——drain 超时强杀的 warn 载荷） */
export interface HostCloser {
  readonly label: string;
  readonly fn: () => Promise<void> | void;
}

/** 退出序时间帽（04 §1 钉值——测试可调小） */
export interface ExitSequenceBudget {
  /** closer drain 帽（缺省 5000——超时强杀） */
  readonly closersMs?: number;
  /** session_shutdown 并行帽（缺省 2000） */
  readonly shutdownHooksMs?: number;
}

/** 运行时选项（12c 分派层/12e TUI 装配的消费面） */
export interface HostRuntimeOptions {
  /** 数据目录（缺省 resolveDataDir() 三级梯子） */
  readonly dataDir?: string;
  /** :memory: 同构形态（dump-config 类——不开真库不占标记） */
  readonly memory?: boolean;
  /** Persistence 旋钮透传（warn/clock/write-behind 调参；dbPath/dataDir 由本件裁定） */
  readonly persistence?: Omit<PersistenceOptions, 'dbPath' | 'dataDir'>;
  /** git 状态摘要真源（每请求重算——exec 件批 14a 接线；缺席行省略） */
  readonly gitSummaryProvider?: () => string | null;
  /** 插件装载计数真源（每请求重算——装载器批 12d 接线；缺席行省略） */
  readonly pluginsProvider?: () => { total: number; enabled: number; failed: number } | null;
  /** 退出序时间帽注入（测试位） */
  readonly exitBudget?: ExitSequenceBudget;
}

/** 运行时柄（全宿主横切面——后续笔逐批充实 conversation/装载器/TUI 组装） */
export interface HostRuntime {
  /** :memory: 形态位（诊断命令豁免面判定用） */
  readonly memory: boolean;
  /** 实际数据目录（memory 形 = null——无真库归属地） */
  readonly dataDir: string | null;
  readonly persistence: Persistence;
  /** 在飞 run 打断信号（SIGINT① → abort；run 消费接线随 conversation 组装笔） */
  readonly abortSignal: AbortSignal;
  /** 环境披露段（每请求重算——04 §environment 装配注入条款） */
  readonly disclosure: () => string | null;
  /** 注册收口动作（drain 序 = 注册序，有界 5s） */
  readonly registerCloser: (closer: HostCloser) => void;
  /** 注册件级收口钩子（并行有界 2s） */
  readonly registerShutdownHook: (hook: () => Promise<void> | void) => void;
  /** 注册作用域回卷（LIFO——dispose 全序） */
  readonly registerDisposer: (fn: () => void) => void;
  /** 退出序编舞（六步全序有界；幂等——二次调用直返） */
  readonly shutdown: () => Promise<void>;
  /** 崩溃取证（数据目录 crash.log 同步追加——崩溃路径先写再退；memory 形跳过） */
  readonly writeCrashLog: (error: unknown) => void;
}

/**
 * 装配运行时（启动序一站式——分派层唯一入口）。
 *
 * 单活跃机拒入（HOST_DATA_DIR_BUSY）与开库失败（TOO_NEW/UNRECOGNIZED/密钥
 * 不可读）都 fail-loud 抛出——半装配不留残（标记先占后开库，开库抛时标记
 * 已释放）。
 */
export function createHostRuntime(options: HostRuntimeOptions = {}): HostRuntime {
  const memory = options.memory === true;
  const dataDir = memory ? null : (options.dataDir ?? defaultDataDir());
  if (dataDir === null && !memory) throw new Error('不变式破坏：非 memory 形必有数据目录');

  // 启动序①：单活跃机占标记（memory 形豁免——不开真库不动标记）
  let lease: ActiveMarkerLease | null = null;
  if (!memory) {
    lease = acquireActiveMarker(dataDir as string);
  }

  // 启动序②：开库（memory 形 dbPath 哨兵直通；失败释放标记不留残）
  let persistence: Persistence;
  try {
    persistence = Persistence.open({
      ...(options.persistence ?? {}),
      ...(memory ? { dbPath: MEMORY_DB_PATH } : { dataDir: dataDir as string }),
    });
  } catch (err) {
    lease?.release();
    throw err;
  }

  // 退出序基建：abort 柄 / closer 队列 / shutdown 钩子 / disposer 栈
  const abortController = new AbortController();
  const closers: HostCloser[] = [];
  const shutdownHooks: Array<() => Promise<void> | void> = [];
  const disposers: Array<() => void> = [];
  const closersMs = options.exitBudget?.closersMs ?? 5000;
  const shutdownHooksMs = options.exitBudget?.shutdownHooksMs ?? 2000;
  let shutDown = false;

  const runtime: HostRuntime = {
    memory,
    dataDir,
    persistence,
    get abortSignal() {
      return abortController.signal;
    },
    disclosure: () =>
      renderEnvironmentDisclosure({
        platform: collectPlatform(() => osRelease(), process.platform),
        cwd: process.cwd(),
        date: collectDate(() => new Date()),
        gitSummary: options.gitSummaryProvider?.() ?? null,
        plugins: options.pluginsProvider?.() ?? null,
      }),
    registerCloser: (closer) => {
      closers.push(closer);
    },
    registerShutdownHook: (hook) => {
      shutdownHooks.push(hook);
    },
    registerDisposer: (fn) => {
      disposers.push(fn);
    },
    shutdown: async () => {
      if (shutDown) return; // 幂等（SIGINT② 与优雅序并发到同一收口）
      shutDown = true;
      // ① abort 置位（在飞 run 收打断信号——不再收新输入）
      abortController.abort();
      // ② closer drain（注册序串行，有界 5s——超时强杀 = 放弃等待）
      for (const closer of closers) {
        try {
          await withTimeout(Promise.resolve(closer.fn()), closersMs, `closer ${closer.label}`);
        } catch (err) {
          console.error(`[exit] closer ${closer.label} 超时或抛错（强杀继续）: ${describe(err)}`);
        }
      }
      // ③ write-behind flush（durable 落盘——退出序永达步）
      try {
        await persistence.flush();
      } catch (err) {
        console.error(`[exit] write-behind flush 抛错（继续收口）: ${describe(err)}`);
      }
      // ④ session_shutdown 并行有界 2s（件级收口钩子）
      await Promise.allSettled(
        shutdownHooks.map((hook) =>
          withTimeout(Promise.resolve(hook()), shutdownHooksMs, 'session_shutdown 钩子').catch((err) => {
            console.error(`[exit] shutdown 钩子超时或抛错（继续收口）: ${describe(err)}`);
          }),
        ),
      );
      // ⑤ 作用域 LIFO 回卷（dispose 全序——后注册先回卷）
      for (const dispose of disposers.reverse()) {
        try {
          dispose();
        } catch (err) {
          console.error(`[exit] disposer 抛错（继续回卷）: ${describe(err)}`);
        }
      }
      // ⑥ 释放活跃标记 + 关库（close 内含 write-behind 终批落账）
      lease?.release();
      await persistence.close();
    },
    writeCrashLog: (error) => {
      if (memory || dataDir === null) return; // memory 形无真库归属地——跳过
      appendCrashLog(dataDir, error);
    },
  };
  return runtime;
}

/**
 * 崩溃取证直写（数据目录 crash.log 同步追加一行）。
 *
 * 独立于运行时导出——main 装配位在运行时尚未组装的前置窗口（解析/开库
 * 阶段）也能取证；写失败静默（崩溃路径唯一允许——进程将退再抛无消费方）。
 */
export function appendCrashLog(dataDir: string, error: unknown): void {
  try {
    mkdirSync(dataDir, { recursive: true });
    appendFileSync(join(dataDir, 'crash.log'), `[${new Date().toISOString()}] ${describe(error)}\n`);
  } catch {
    // 同上——崩溃路径唯一允许的静默
  }
}

/** 数据目录缺省解析（persist 三级梯子真源——BERRY_AGENT_DATA_DIR > ~/.berry-agent） */
function defaultDataDir(): string {
  return resolveDataDir();
}

/** 错误速写（退出序 warn 载荷） */
function describe(err: unknown): string {
  return err instanceof Error ? `${err.stack ?? err.message}` : String(err);
}

/** 有界等待（超时抛——超时后底层 promise 不取消，仅放弃等待 = 强杀语义）；导出共用于装载器三时钟（批 12d） */
export function withTimeout(p: Promise<void>, ms: number, label: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时（${ms}ms 帽——放弃等待）`)), ms);
    p.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
