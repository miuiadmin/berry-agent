/**
 * host/runtime — 装配序生命周期骨架（04 篇 §1 进程模型；07 §1.1 表 #10 host 席）。
 *
 * 启动序：解析数据目录（memory 形豁免）→ 单活跃机占标记（先占标记再开库——
 * 拒双开于开库之前）→ Persistence 开库（openStore 门禁序内嵌）→ 披露段组装。
 * 退出序（04 §1 六步全序有界）：① abort 置位（在飞 run 收打断信号）→
 * ② closer 队列 drain（有界 5s = drain 全程总帽——在飞子代理/子进程结算，超时强杀）→
 * ③ write-behind flush（durable 落盘）→ ④ session_shutdown 并行有界 2s
 * （件级收口钩子）→ ⑤ 作用域 LIFO 回卷（dispose 全序）→ ⑥ 释放活跃标记 +
 * 关库。一步崩不阻后续步（退出序容错——落盘步永达）；落盘两步（③ flush /
 * ⑥ close）吞错续行但记入 shutdownFlushFailure 观测位——入口层折非零退出
 * 码（05 §6.3#6「flush 失败 = 退出非零码」；十六役补扫 N3）。SIGINT②→130 /
 * SIGTERM 同① / crash.log 崩溃取证 = 进程编舞归 CLI 分派层（批 12c）——
 * 本件只提供编舞本体（不 process.exit，可测）。
 *
 * :memory: 同构纪律（05 §6.6/07 §5）：dump-config 类诊断不开真库、不动活跃
 * 标记——memory 形走同一运行时装配入口、会话主库零落盘。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { release as osRelease } from 'node:os';
import { join } from 'node:path';

import {
  AUDIT_MIGRATION,
  INPUT_HISTORY_MIGRATION,
  LOAD_GENERATIONS_MIGRATION,
  MEMORY_DB_PATH,
  Persistence,
  resolveDataDir,
  resolveDatabasePathIn,
  SESSION_ARCHIVE_MIGRATION,
} from '../persist/index.js';
import type { PersistenceOptions } from '../persist/index.js';
// core: 表族迁移声明（05 §6.4 机械聚合——声明来自插件、执行在宿主；host 行
// 拓扑边在册）。版本升序：scheduler v2 → goal v3 → memory v4-6·9·11 →
// credentials v7 → audit v8 → load-generations v10 → goal v12 → session-archive
// v13 → input-history v14（audit v8 / load-generations v10 / session-archive
// v13 / input-history v14 = 宿主域表——persist export-only 声明，非 core: 表族）。
import { MEMORY_MIGRATIONS } from '../memory/index.js';
import { GOAL_MIGRATION, GOAL_APPROVAL_MIGRATION } from '../goal/index.js';
import { SCHEDULER_MIGRATION } from '../scheduler/index.js';
import { CREDENTIALS_MIGRATION } from '../credentials/index.js';
import type { MigrationSpec } from '../persist/index.js';

import { collectDate, collectPlatform, renderEnvironmentDisclosure } from './disclosure.js';
import { acquireActiveMarker } from './single-instance.js';
import type { ActiveMarkerLease } from './single-instance.js';

/**
 * 宿主迁移链尾（core: 插件表族声明 + 审计流表——05 §6.4 机械聚合单源）。
 * sessions-cmd 读侧/维护动词开库同源复用：开库门禁按链 head 校验
 * user_version（降级运行拒开），读侧动词若带短链开真库会被同库拒——链必须
 * 与运行时全同。
 */
export const HOST_MIGRATION_TAIL: readonly MigrationSpec[] = [
  SCHEDULER_MIGRATION,
  GOAL_MIGRATION,
  // 2026-09-13 f-1 批聚合（goals 增列 write_approved 人面批准位 v12——03 §10.5
  // f-1 定形注①；goal 表族第二条迁移，号随注册序顺延）
  GOAL_APPROVAL_MIGRATION,
  ...MEMORY_MIGRATIONS,
  // 2026-09-08 c-2 存储腿聚合（credentials 表 namespace 扩容 v7——03 §10.9；
  // 声明在 core:credentials 件、执行在宿主——05 §6.4 机械聚合单源）
  CREDENTIALS_MIGRATION,
  // 2026-09-08 U3 落码批 U3-5 聚合（audit_events 进程级 durable 审计流 v8
  // ——05 §9；宿主域表单写者 = 装配根，persist export-only 声明同形）
  AUDIT_MIGRATION,
  // 2026-09-09 装载史批 h-2 聚合（load_generations 宿主形态镜像落账面 v10
  // ——05 §9；单写者 = 装配根〔boot 完成点 + /reload reapply 尾，h-3 接线〕，
  // persist export-only 声明同形）
  LOAD_GENERATIONS_MIGRATION,
  // 2026-09-21 v13 聚合（sessions 档案两列 first_question_summary/model_summary
  // ——05 §9 专列兑现注：title/专列分家，读路合并单源 sessionDisplayTitleOf；
  // ALTER ADD COLUMN 迁移链首例，DDL 有意不折列）
  SESSION_ARCHIVE_MIGRATION,
  // 2026-10-05 ZCode TUI 对标批 B1 聚合（input_history 分项目输入历史 v14
  // ——05 §9 / 07 §4.1 呈现面件 2 B1 定形注：宿主输入历史读模型，单写者 =
  // 装配根〔Editor onHistoryAdd 闭包镜像位〕，persist export-only 声明同形）
  INPUT_HISTORY_MIGRATION,
];

/** closer 项（收口动作 + 标签——drain 超时强杀的 warn 载荷） */
export interface HostCloser {
  readonly label: string;
  readonly fn: () => Promise<void> | void;
}

/** 退出序时间帽（04 §1 钉值——测试可调小） */
export interface ExitSequenceBudget {
  /** closer drain 帽（缺省 5000——drain 全程总帽非逐 closer 各享；超时强杀） */
  readonly closersMs?: number;
  /** session_shutdown 并行帽（缺省 2000） */
  readonly shutdownHooksMs?: number;
}

/** 运行时选项（12c 分派层/12e TUI 装配的消费面） */
export interface HostRuntimeOptions {
  /** 数据目录（缺省 resolveDataDir() 三级梯子；memory 形下显式传入 = 同构诊断形——见 memory 行） */
  readonly dataDir?: string;
  /** :memory: 同构形态（dump-config 类——不开真库不占标记）。显式携 dataDir
   *  = 同构诊断形（07 §5 dump-config 纪律：真数据目录读侧〔enabled.yaml/
   * 装机账本〕+ 主库 :memory: 零落盘 + 不占活跃标记；数据目录侧目录创建类
   * 动作被容忍为同构纪律固有代价）；未携 = 纯诊断测试形（无真库归属地——
   * enabled.yaml 同缺席语义） */
  readonly memory?: boolean;
  /** Persistence 旋钮透传（warn/clock/write-behind 调参；dbPath/dataDir 由本件裁定） */
  readonly persistence?: Omit<PersistenceOptions, 'dbPath' | 'dataDir'>;
  /**
   * git 状态摘要真源（04 §11 批 C-1 定形注——seam 升格带参会话键：git 状态
   * per-session 工作区，对齐 sandboxModeProvider 形；sessionId 缺席 =
   * canonicalWorkspaceRoot 进程域）。装配侧铸 SWR provider（boot 预热 +
   * TTL 60s 返旧 kick 刷新——spawn 秒级不得进同步回调，「每请求重算」的
   * git 半边定形为每请求重取缓存）；缺席行省略（fail-soft 同插件行降级律）。
   */
  readonly gitSummaryProvider?: (sessionId?: string) => string | null;
  /** 插件装载计数真源（每请求重算——装载器批 12d 接线；缺席行省略） */
  readonly pluginsProvider?: () => { total: number; enabled: number; failed: number } | null;
  /**
   * 沙箱档位行真源（第六件——F2；每请求重算 per-session）：装配侧经
   * createSandboxDisclosureSource 铸造（fold 复用 conversation
   * foldSessionSandboxMode；坏词 warn 降级返 undefined 行省略）。晚绑定注入
   * （stack 建后重赋值——会话事件读面装配在 runtime 之后）；缺席行省略。
   */
  readonly sandboxModeProvider?: (sessionId?: string) => string | undefined;
  /** 退出序时间帽注入（测试位） */
  readonly exitBudget?: ExitSequenceBudget;
}

/** 运行时柄（全宿主横切面——后续笔逐批充实 conversation/装载器/TUI 组装） */
export interface HostRuntime {
  /** :memory: 形态位（诊断命令豁免面判定用） */
  readonly memory: boolean;
  /** 实际数据目录（纯 memory 诊断形 = null 无真库归属地；同构诊断形 = 真值——读侧真盘/主库仍零落盘） */
  readonly dataDir: string | null;
  readonly persistence: Persistence;
  /** 在飞 run 打断信号（SIGINT① → abort；run 消费接线随 conversation 组装笔） */
  readonly abortSignal: AbortSignal;
  /** 环境披露段（每请求重算——04 §environment 装配注入条款；可选 sessionId =
   * per-session 解档消费键〔F2 第六件——沙箱行按会话现值〕） */
  readonly disclosure: (sessionId?: string) => string | null;
  /** 注册收口动作（drain 序 = 注册序，有界 5s 全程总帽） */
  readonly registerCloser: (closer: HostCloser) => void;
  /** 注册件级收口钩子（并行有界 2s） */
  readonly registerShutdownHook: (hook: () => Promise<void> | void) => void;
  /** 注册作用域回卷（LIFO——dispose 全序） */
  readonly registerDisposer: (fn: () => void) => void;
  /** 退出序编舞（六步全序有界；幂等——二调共享首调在飞 promise 等同一收口） */
  readonly shutdown: () => Promise<void>;
  /**
   * 退出序落盘失败态（十六役补扫 N3——05 §6.3#6「flush 失败 = 退出非零码」
   * 的观测位）：③ flush 与 ⑥ close（内含 write-behind 终批）吞错续行后由
   * 入口层读此位折非零退出码。undefined = 落盘两步皆净。**可选成员**——
   * 结构兼容位（各测试件字面量桩免同步改；真身恒供给）。
   */
  readonly shutdownFlushFailure?: () => unknown;
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
  // memory 形 dataDir 两态：显式传入 = 同构诊断形（真数据目录读侧 + 主库
  // :memory: + 不占标记——07 §5 dump-config 纪律）；未传 = 纯诊断测试形
  const dataDir = memory ? (options.dataDir ?? null) : (options.dataDir ?? defaultDataDir());
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
      // 非 memory 形库路径锚定显式 dataDir（bug 回归锁位：原先只传 dataDir
      // 而 Persistence 层 dbPath 缺省走 env 梯子——显式目录被无视，库开在
      // env/家目录位、secret.key 与库分家；resolveDatabasePathIn 保
      // BERRY_AGENT_DB_PATH 单文件覆盖恒赢——tier-2 不被目录锚定吞掉）
      ...(memory
        ? { dbPath: MEMORY_DB_PATH }
        : { dbPath: resolveDatabasePathIn(dataDir as string), dataDir: dataDir as string }),
      // 迁移链机械聚合（05 §6.4）：core: 插件表族声明并入宿主单链——调用方
      // 迁移在前、追加件按版本升序插队（scheduler v2 → goal v3 先于 memory
      // v4-6；调用方版本须全链严格递增——19c 追加件同律校验）
      migrations: [...(options.persistence?.migrations ?? []), ...HOST_MIGRATION_TAIL],
      // 关库终态晚到写失败折退出失败态（件D1——与 ③ flush/⑥ close 吞错并计
      // 同位：shutdownFlushFailure 读此位折非零退出码，05 §6.3#6 N3）。
      // 置尾保宿主折位赢过调用方透传；闭包引用 exitFlushFailure（TDZ 晚绑
      // 槽——回调只可能在 close 后触发，彼时早已声明）
      onLateWriteFailure: (err) => {
        exitFlushFailure ??= err;
      },
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
  // 在飞 shutdown promise 存柄（首调创建、二调共享——幂等的实体是同柄等待
  // 而非布尔早返，详见 shutdown 位注释）
  let shutdownInFlight: Promise<void> | null = null;
  // 落盘失败态（N3）：③ flush / ⑥ close 吞错续行时记首位失败——入口层经
  // shutdownFlushFailure 读此位折非零退出码（05 §6.3#6）。??= 保首位
  // （首因诊断——后续步失败不覆写）。
  let exitFlushFailure: unknown;

  const runtime: HostRuntime = {
    memory,
    dataDir,
    persistence,
    get abortSignal() {
      return abortController.signal;
    },
    disclosure: (sessionId?: string) =>
      renderEnvironmentDisclosure({
        platform: collectPlatform(() => osRelease(), process.platform),
        cwd: process.cwd(),
        date: collectDate(() => new Date()),
        gitSummary: options.gitSummaryProvider?.(sessionId) ?? null,
        plugins: options.pluginsProvider?.() ?? null,
        // 沙箱行第六件（F2）：provider 缺席（晚绑定前 / 注入缺席）= 行省略；
        // provider 返 undefined（坏词 warn 降级）同省略——行面零强求
        sandbox: options.sandboxModeProvider !== undefined ? (options.sandboxModeProvider(sessionId) ?? null) : null,
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
      // 幂等 = 共享在飞 promise（第十五役 α1 修）：首调创建收口 promise、
      // 一切二调 await 同柄——主序收尾（runRunEntry 尾段）与信号序（SIGINT①
      // onGraceful）并发时，二调不再布尔早返拿到已解决 promise 而不等首调
      // 收口（修前形：main().then(processExit) 在首调仍挂于 closer drain/
      // flush 真异步腿时提前 process.exit——③-⑥ 后四步被截断，write-behind
      // 尾批丢失、session_shutdown 钩子跳过）。SIGINT② 硬退语义不变（那路
      // 直接 process.exit(130) 不经本柄）。
      if (shutdownInFlight !== null) return shutdownInFlight;
      shutdownInFlight = (async () => {
        // ① abort 置位（在飞 run 收打断信号——不再收新输入）
        abortController.abort();
        // ② closer drain（注册序串行，有界 5s = drain 全程总帽——04 §1 第九轮
        // 深扫定形注：deadline 整段循环共享〔首 closer 起算〕非逐 closer 各
        // 5s〔修前 N closer 最坏 N×5s〕；超时强杀 = 放弃等待）
        const closersDeadline = Date.now() + closersMs;
        for (const closer of closers) {
          const remaining = closersDeadline - Date.now();
          if (remaining <= 0) {
            // 总帽已尽：剩余 closer 不再等待（放弃等待不放弃已执行标记——已
            // 执行的收口动作不回卷）；跳过行留诊断面
            console.error(`[exit] closer ${closer.label} 跳过（drain 总帽 ${closersMs}ms 已尽——剩余 closer 不再等待）`);
            break;
          }
          try {
            await withTimeout(Promise.resolve(closer.fn()), remaining, `closer ${closer.label}`);
          } catch (err) {
            console.error(`[exit] closer ${closer.label} 超时或抛错（强杀继续）: ${describe(err)}`);
          }
        }
        // ③ write-behind flush（durable 落盘——退出序永达步）。吞错续行（落盘
        // 步永达）但记失败态——入口层折非零退出码（05 §6.3#6，N3）。
        try {
          await persistence.flush();
        } catch (err) {
          exitFlushFailure ??= err;
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
        // ⑥ 释放活跃标记 + 关库（close 内含 write-behind 终批落账）——退出序
        // 容错（04 §1「一步崩不阻后续步」对齐②-⑤）：两动作各自吞错续行。
        // 第十五役 α4 起 release 的 tryUnlink fail-loud 化（EACCES 类数据目录
        // 病态如实 warn，不再伪装已清）——本层承接其抛出不截断 close 终批。
        try {
          lease?.release();
        } catch (err) {
          console.error(`[exit] 活跃标记释放抛错（继续关库）: ${describe(err)}`);
        }
        try {
          await persistence.close();
        } catch (err) {
          // close 内含 write-behind 终批落账——同记失败态（N3：两步任一抛即
          // 非零退出；??= 不覆写③首因）
          exitFlushFailure ??= err;
          console.error(`[exit] 关库抛错（收口已尽）: ${describe(err)}`);
        }
      })();
      return shutdownInFlight;
    },
    // 落盘失败观测位（N3——接口注释详）：入口层 `exitCode === 0 && failure
    // !== undefined → exitCode = 1` 折码。恒供给（真身非可选）。
    shutdownFlushFailure: () => exitFlushFailure,
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
    const timer = setTimeout(() => reject(new Error(`${label} 超时（上限 ${ms}ms——放弃等待）`)), ms);
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
