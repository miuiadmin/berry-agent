/**
 * host/run-entry — `berry run` 单次执行入口装配（批 20b；07 §5 run
 * 权威条文全量兑现）。
 *
 * 定位：CLI 单发的薄编舞层——装配公共段（assembly——与 TUI/serve 同一合成
 * 代码路径）+ tick 双形态预解析 + 会话选取四形 + `cli-run` 通道后端（事件
 * 消费与输出三档）+ max-turns 到帽收场 + 退出码三态。模型循环本体归
 * conversation 驱动，本件零侵入（maxTurns/输出档均为装配层消费位）。
 *
 * 输出三档（07 §5）：
 * - text（缺省）：stdout 只出末条 assistant 文本——CI 管道友好的「问一句得
 *   一句」；run 进行中的 keepalive 与一切诊断走 stderr（stdout 纯净律）。
 * - json：终值单对象（sessionId/status/turns/usage 汇总/末条 assistant 文本）
 *   一行 NDJSON——机器消费面；活体增量不出 stdout。
 * - stream：AgentEvent NDJSON 直出（每事件一行）——与 serve 线协议同源的
 *   事件流面；心跳即事件流一员（工具/turn 族事件自带节拍）不另设 keepalive。
 * --no-delta：三档共用的线面退订（message_update 增量滤除；整消息事件仍在）。
 *
 * 退出码三态（07 §5）：0 成功收场；1 执行失败（failed·aborted·truncated
 * 同档）；2 用法错。2 档除解析层 argv 执法外，本层再收运行期才能判定的
 * 配置态：tick 行缺席 = jobs 配置漂移（add 过的行被删改）、件缺席形
 * （--no-plugins 下 --tick 不可用）。
 * 铁律：错误路径必及时非零退出（挂死即 P0）。
 *
 * headless 审批无挂死（04 §9 无静默审批）：本后端 capabilities 阻塞原语
 * 全 false——capability false 即不参与竞速；waterfall 无人应答 → 立即
 * unavailable（source='timeout'），run 不挂。
 *
 * --background 记账（04 §5 后台道入口）：起跑前 canAfford('background')
 * 预检（拒在起跑前——零跑零账）；settle 后对本次 run 新增的各 assistant
 * 消息落 llm/usage 底账（deterministic callId `run:<sessionId>:<seq>`——
 * write-behind 批落重试的去重锚点；priority background——聚合只计后台道）。
 *
 * goal 编舞（19c-3 挂账批 #99 全数兑现——驱动侧三件落 driver/assembly）：
 * recordTurn 记账/agent_pre_step 预算复验/轮间沉淀全经 driver 层 seam，本
 * 入口零 goal 感知（三入口统一——TUI/webui/issue 同律零重复挂点）。
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { cwd as processCwd, pid, stderr as processStderr, stdout as processStdout } from 'node:process';
import type { Writable } from 'node:stream';

import type { TSchema } from 'typebox';
import { Value } from 'typebox/value';

import { canonicalWorkspaceRoot } from '../context/index.js';
import type { AgentEvent, EventSource, UiBackend, Usage } from '../contracts/index.js';
import { isStandardMessage } from '../contracts/index.js';
import type { SubmitResult } from '../conversation/index.js';
import { diagnoseProviderFailure } from '../llm/index.js';
import type { Provider } from '../llm/index.js';
import { FIRE_WALL_TIMEOUT_MS, nextFireAt, realIsPidAlive } from '../scheduler/index.js';
import type { JobRow, RunOutcome } from '../scheduler/index.js';
import type { SandboxMode } from '../safety/index.js';
import { approvalPresetOf } from '../safety/index.js';

import { assembleHostStack } from './assembly.js';
import type { AssemblySuccess } from './assembly.js';
import type { RunFlags } from './cli.js';
import type { GoalFace, SchedulerFace, SchedulerTickSettleFace } from './core-plugins.js';
import type { HostRuntime } from './runtime.js';
import type { ConversationStack } from './conversation-stack.js';
import { openWebuiFace } from './webui-bridge.js';
import type { WebuiMountKit, WebuiOpenInfo } from './webui-bridge.js';

/** run 入口选项（main 分派接线 + 测试注入面——stdout/stderr 注入供三档输出断言） */
export interface RunEntryOptions {
  /** 提示词（tick 形为空串——提示词在 jobs 行内，本层经行读取不消费此位） */
  readonly message: string;
  readonly flags: RunFlags;
  /** 工作区锚（缺省 process.cwd()；tick 用户行 cwd 优先于此位） */
  readonly cwd?: string;
  /** 数据目录（HostRuntimeOptions 透传；缺省 resolveDataDir() 三级梯子） */
  readonly dataDir?: string;
  /** 初始 provider 集（测试注入 faux provider） */
  readonly providers?: readonly Provider[];
  /** 模型标识（缺省 BERRY_AGENT_MODEL 覆盖律——栈内解析） */
  readonly model?: string;
  /** env 面（缺省 process.env；测试隔离 BERRY_AGENT_MODEL） */
  readonly env?: Record<string, string | undefined>;
  /** 版本串（HostFace 物化位；缺席 = 裸 0.0.0-unknown） */
  readonly version?: string;
  /** 运行时组装后回调（main.ts attachRuntime——信号/崩溃编舞切运行时本体） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** 出站（缺省 process.stdout——text 末条/json 终值/stream NDJSON） */
  readonly stdout?: Writable;
  /** 诊断面（缺省 process.stderr——keepalive/notify/失败文案/--port 披露行） */
  readonly stderr?: Writable;
  /** keepalive 节拍毫秒（text/json 档 stderr 活体行；缺省 5000；测试提速注入位） */
  readonly keepaliveIntervalMs?: number;
  /** webui 开面回执（`--port` 在场时开面后回调——测试拿实配端口与 token） */
  readonly onWebuiOpen?: (info: WebuiOpenInfo) => void;
}

/** 执行体入参（装配成功后的全流程——闭包减参） */
interface ExecuteContext {
  readonly options: RunEntryOptions;
  /** 解析后的输出档（缺省 text 单源化——各步共用） */
  readonly outputFormat: 'text' | 'json' | 'stream';
  readonly out: Writable;
  readonly err: Writable;
  readonly runtime: HostRuntime;
  readonly stack: ConversationStack;
  /** 装配产物共享根作用域（插件服务面 tryGet 位） */
  readonly scope: AssemblySuccess['scope'];
}

/**
 * run 主入口：装配 → 执行体 → 六步退出序 → 退出码。装配失败两档呈报同
 * serve-entry（crashed = 意外异常，crash.log 已在装配件内写；干净退出档 =
 * 启动失败——单活跃机/开库/启用清单损坏）。一切执行体异常 = 崩溃取证 +
 * 退 1；shutdown 恒走（幂等——早退路径与信号路径同享 closer 保证）。
 */
export async function runRunEntry(options: RunEntryOptions): Promise<number> {
  const out = options.stdout ?? processStdout;
  const err = options.stderr ?? processStderr;
  const outputFormat = options.flags.outputFormat ?? 'text';

  // —— 装配公共段（批 19a-3 迁 assembly 件——与 TUI/serve 同一合成代码路径：
  // 运行时→logger→共享根→栈→**插件装载**〔core 注册表 + enabled.yaml 真跑〕；
  // --ephemeral → memory 形零落盘；--read-only → 沙箱档 read-only 单发覆盖；
  // --preset <名> → 权限预设两旋钮逐次覆盖（ap-3——逐次生效不写盘，与
  // --read-only 在解析层互斥；来源标注随旋钮注入供 /approval status 呈现）——
  const assembly = await assembleHostStack({
    runtime: {
      ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
      ...(options.flags.ephemeral ? { memory: true } : {}),
    },
    noPlugins: options.flags.noPlugins,
    // 快速试件透传（--plugin-file——03 §7 生态启动批 eco-3a；缺席形省键）
    ...(options.flags.pluginFile !== undefined ? { pluginFile: options.flags.pluginFile } : {}),
    debug: options.flags.debug,
    version: options.version ?? '0.0.0-unknown',
    ...(options.providers !== undefined ? { providers: options.providers } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.flags.readOnly
      ? { sandboxMode: (): SandboxMode => 'read-only', sandboxModeSource: 'CLI --read-only' }
      : options.flags.preset !== undefined
        ? {
            sandboxMode: (): SandboxMode => approvalPresetOf(options.flags.preset!)!.sandboxMode,
            sandboxModeSource: `CLI --preset ${options.flags.preset}`,
            approvalPolicy: approvalPresetOf(options.flags.preset!)!.approvalPolicy,
            approvalPolicySource: `CLI --preset ${options.flags.preset}`,
          }
        : {}),
    ...(options.onRuntime !== undefined ? { onRuntime: options.onRuntime } : {}),
  });
  if (!assembly.ok) {
    err.write(`${assembly.crashed ? `run 执行失败：${assembly.message}` : assembly.message}\n`);
    return assembly.exitCode;
  }
  const { runtime, stack, scope }: AssemblySuccess = assembly;

  let exitCode = 1;
  try {
    exitCode = await executeRun({ options, outputFormat, out, err, runtime, stack, scope });
  } catch (error) {
    runtime.writeCrashLog(error); // 崩溃取证先行（memory 形跳过——件内语义）
    err.write(`run 执行失败：${error instanceof Error ? error.message : String(error)}\n`);
    exitCode = 1;
  }
  // 六步退出序（幂等——manager 拆解/write-behind flush 必达；信号路径已走
  // shutdown 时同调无副作用）
  await runtime.shutdown().catch(() => {});
  return exitCode;
}

/** 执行体（装配成功后的全流程——一切 return 即本 run 的退出码） */

/** --output-schema 根 type 值域（JSON Schema 基本类型七值——07 §5 定形注⑥值域笔） */
const SCHEMA_ROOT_TYPE_VALUES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

async function executeRun(ctx: ExecuteContext): Promise<number> {
  const { options, outputFormat, out, err, runtime, stack, scope } = ctx;
  const flags = options.flags;

  // —— ⓪' --output-schema 文件级坏形预检（07 §5 落码定形注②〔2026-09-15 批〕：
  // 不可读 / 非合法 JSON / 根非「带 type 字段对象」/ 根 type 值域外（⑥值域笔
  // 2026-09-15 补批——typebox 对未知 kind 恒真故须预拦）四形 = 用法错退 2，执
  // 行前拦——零会话创建零提交零 tick claim 残账（冷读②钉位：本段先于 ① tick
  // 预解析）。typebox Check 级失配不在此拦——那是模型输出的事，属收场校验档
  // 退 1〔定形注④〕；根形收窄（Union/Intersect 根不做）见定形注⑦——
  let schemaDoc: TSchema | undefined;
  let schemaRaw: string | undefined;
  if (flags.outputSchema !== undefined) {
    try {
      schemaRaw = readFileSync(flags.outputSchema, 'utf8');
    } catch (error) {
      err.write(
        `--output-schema 文件不可读：${flags.outputSchema}（${error instanceof Error ? error.message : String(error)}）\n`,
      );
      return 2;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(schemaRaw);
    } catch {
      err.write(`--output-schema 文件非合法 JSON：${flags.outputSchema}\n`);
      return 2;
    }
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as { type?: unknown }).type !== 'string'
    ) {
      err.write(`--output-schema 根须为带 type 字段的 JSON 对象（schema 文档形——v1 根形收窄见 usage）\n`);
      return 2;
    }
    // 根 type 值域执法（07 §5 定形注⑥值域笔——2026-09-15 补批）：typebox 对
    // 未知 kind 的 Check 恒真——域外值（手误形如 "objekt"）会使收场校验空转
    // 零告警，故文件级预检同用法错退 2 拦；嵌套层未知 type 深验不在 v1 射程
    //（与根形收窄同理留界）
    if (!SCHEMA_ROOT_TYPE_VALUES.has((parsed as { type: string }).type)) {
      err.write(
        `--output-schema 根 type 值域外："${(parsed as { type: string }).type}"（须为 object/array/string/number/integer/boolean/null 之一——手误形请核拼写）\n`,
      );
      return 2;
    }
    schemaDoc = parsed as TSchema;
  }

  // —— ⓪ tick settle 记账位（04 §12 无人值守执行链定形注律 3 乙案侧——
  // 2026-09-13 全面复盘修复批：乙案让位律原单向兑现——子进程读行让位而自跑
  // 零占用记账、收场零结算（lastOutcome 不落账/last_fire_at 不推进/僵行清扫
  // 空转）。本批兑现双向：起跑 claim（activePid = 本 CLI pid——引擎侧跨进程
  // 在飞判定与僵行清扫由此见本实例）+ 收场 settle（真跑 settleFire 三笔推进
  // / 零跑 gated settleGated 只推进 next）。乙案形态引擎不在环——CLI 是该
  // fire 的唯一记账方 ——
  let tickJob: { dao: SchedulerTickSettleFace; row: JobRow; firedAt: string } | undefined;
  /** 结算单点（单笔幂等——settle 后再呼零副作用；非 tick 形恒零副作用） */
  const settleTick = (outcome: RunOutcome): void => {
    if (tickJob === undefined) return;
    const { dao, row, firedAt } = tickJob;
    tickJob = undefined;
    const nowIso = new Date().toISOString();
    // next 从结算时刻取下一刻（错过不重放同律——引擎 settle 段同锚）
    const next = nextFireAt(row.schedule, new Date(nowIso));
    if (outcome.reason === 'gated') {
      dao.settleGated(row.name, outcome, next, nowIso);
    } else {
      dao.settleFire(row.name, firedAt, outcome, next, nowIso);
    }
    // claim 清账（settle 对偶——settleFire/settleGated 不动 active_pid 列，本侧补清）
    dao.setActive(row.name, null, null, nowIso);
  };
  /** tick 行早退收账（claim 后 run 未起跑形——spawn 形落账诚实记「没起来」） */
  const abortTick = (error: string): void => {
    settleTick({
      trigger: 'cron',
      reason: 'spawn',
      error: error.slice(0, 200),
      finishedAt: new Date().toISOString(),
    });
  };

  // —— ① tick 形预解析（jobs 行读取 + goal 挂钟行 wake 判定先行——提示词与
  // 会话归属都可能来自行内，须在会话选取前定形）——
  let message = options.message;
  let cwdAnchor = options.cwd ?? processCwd();
  let goalSessionId: string | undefined; // goal 挂钟行：提交目标 = goal 绑定会话
  if (flags.tick !== undefined) {
    const schedFace = scope.tryGet<SchedulerFace>('scheduler');
    if (schedFace === undefined) {
      err.write('--tick 需要 core:scheduler 件在场（--no-plugins 或件禁用形态不可用）\n');
      return 2;
    }
    const row = schedFace.service.getJob(flags.tick);
    if (row === undefined) {
      // 行缺席 = 配置漂移档（add 过的行被删/改名——cron/引擎侧 argv 过期）
      err.write(`--tick 行缺席：jobs 表无「${flags.tick}」行（检查行是否被删改——/tick list 可查在册行）\n`);
      return 2;
    }
    // —— 让位律（u-2 定形注③乙案并存窗子进程侧腿——与引擎 fire 前跨进程
    // 在飞判定双向对称）：行 activePid 非空非己且活体未超墙钟 = 宿主甲案/
    // 他乙案实例真在飞 → 本子进程诚实让位（yielded 结局、next 原样推进、
    // 不动 last_fire_at、退出码 0——让位非失败零新错误码）；死残账（占位
    // 进程已死）与超钟残账（活+超墙钟——pid 复用误判险不 yield）均清占用
    // 照跑。跨进程不 kill（pid 复用误杀险——「执行前抢占」条款对跨进程实例
    // 不越权）；残账兜底 = 引擎侧 start 僵行清扫与 fire 覆写自愈。
    if (row.activePid !== null && row.activePid !== pid) {
      const nowIso = new Date().toISOString();
      const startedAtMs = row.activeStartedAt !== null ? Date.parse(row.activeStartedAt) : 0;
      if (realIsPidAlive(row.activePid) && Date.now() - startedAtMs <= FIRE_WALL_TIMEOUT_MS) {
        const outcome: RunOutcome = {
          trigger: 'cron',
          reason: 'yielded',
          error: `他实例在飞（activePid ${row.activePid}）——诚实让位不双跑`,
          finishedAt: nowIso,
        };
        schedFace.dao.settleGated(row.name, outcome, row.nextFireAt, nowIso);
        err.write(`--tick 行「${row.name}」他实例在飞（activePid ${row.activePid}）——让位退出\n`);
        return 0;
      }
      // 死残账/超钟残账：清占用照跑（引擎侧覆写自愈兜底）
      schedFace.dao.setActive(row.name, null, null, nowIso);
    }
    if (row.builtin && row.name.startsWith('goal-')) {
      // goal 挂钟行：wake 判定先行（重绑护栏/唤醒预算/停滞硬停全在 goal 服务
      // 单源裁决）；goal 会话由裁决选取——续接族旗标显式拒（不静默忽略）
      const goalFace = scope.tryGet<GoalFace>('goal');
      if (goalFace === undefined) {
        err.write('goal 挂钟行在场而 core:goal 件未装载——配置漂移（goal 唤醒不可用）\n');
        return 2;
      }
      if (flags.session !== undefined || flags.continueLatest || flags.fork !== undefined) {
        err.write('--tick goal 挂钟行与 --session/--continue/--fork 不兼容（goal 会话由 wake 裁决选取）\n');
        return 2;
      }
      const goalId = row.name.slice('goal-'.length);
      const decision = await goalFace.service.wake(goalId, {
        // tick 载体即挂钟等价触发（CLI 手点与引擎 spawn 同 argv 不可分——归
        // clock 道落账，归因串带行名可审计）
        trigger: 'clock',
        attribution: `tick:${row.name}`,
      });
      if (!decision.landed) {
        // 诚实零跑：不落即本轮无事（inactive/stalled/wake_budget 各由 message
        // 说明）——零跑零账退 0。gated 结局照记 + next 推进（2026-09-13 修复批：
        // 引擎侧 spawnGoalRow gated 同律——乙案此前零 settle，行永 due 反复过
        // wake 判定面）
        const gatedAt = new Date().toISOString();
        schedFace.dao.settleGated(
          row.name,
          {
            trigger: 'cron',
            reason: 'gated',
            error: `goal「${goalId}」本轮未唤醒（${decision.reason}）`,
            finishedAt: gatedAt,
          },
          nextFireAt(row.schedule, new Date(gatedAt)),
          gatedAt,
        );
        err.write(`goal「${goalId}」本轮未唤醒（${decision.reason}）：${decision.message}\n`);
        return 0;
      }
      message = row.prompt; // 挂钟行 prompt = promptSnapshot 落账形
      goalSessionId = decision.goal.sessionId;
    } else {
      // 用户任务行：prompt 即提交文本；行内 cwd 锚优先（任务的工作区语义）
      message = row.prompt;
      if (row.cwd !== null) cwdAnchor = row.cwd;
    }
    // 起跑 claim（律 3 乙案侧——2026-09-13 修复批）：本 CLI 进程 pid 落占用面
    // + 起跑钟；此后本 run 期引擎侧跨进程在飞判定见他实例让位、kill -9 残账
    // 由僵行清扫回收（让位律由单向变双向真值）。收场对偶在 ⑨ settleTick。
    const firedAtIso = new Date().toISOString();
    schedFace.dao.setActive(row.name, pid, firedAtIso, firedAtIso);
    tickJob = { dao: schedFace.dao, row, firedAt: firedAtIso };
  }

  // —— ② --background 预检（04 §5 后台道预算闸门——拒在起跑前，零跑零账）——
  if (flags.background && !stack.llm.canAfford('background')) {
    // tick 形同步 gated 落账（2026-09-13 修复批：引擎 daily_budget 门同律——
    // 非真跑不动 last_fire_at、next 照推进；非 tick 形 settleTick 零副作用）
    settleTick({
      trigger: 'cron',
      reason: 'gated',
      gate: 'daily_budget',
      error: '当日后台道预算不可负担（canAfford 假）',
      finishedAt: new Date().toISOString(),
    });
    err.write('当日后台道预算已尽（LLM_BUDGET_EXCEEDED 语义——后台日池已满）：明日再跑或去 --background 走前台道\n');
    return 1;
  }

  // —— ③ 会话选取四形（缺省 = 新建——「每次 run 默认新会话」07 §5；goal 挂钟
  // 行的会话由 wake 裁决先行，此处只幂等 open 落驱动）——
  const workspaceRoot = canonicalWorkspaceRoot(cwdAnchor);
  let sessionId: string;
  if (goalSessionId !== undefined) {
    try {
      sessionId = stack.manager.open(goalSessionId).sessionId; // 幂等——goal 绑定会话续接
    } catch (error) {
      abortTick('goal 会话打开失败');
      err.write(`goal 会话打开失败：${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  } else if (flags.session !== undefined) {
    try {
      sessionId = stack.manager.open(flags.session).sessionId; // missing 即 throw（fail-loud）
    } catch {
      abortTick('--session 会话不存在');
      err.write(`--session 会话不存在：${flags.session}\n`);
      return 1;
    }
  } else if (flags.continueLatest) {
    // 与无参 TUI 同源选取键：cwd 归一根取最新——有则续接无则新建
    sessionId = stack.openStartupSession(cwdAnchor).sessionId;
  } else if (flags.fork !== undefined) {
    // 分叉目标：显式 id 或 cwd 最新；边界快照缺省 lastClosedBoundary
    let sourceId = flags.fork.id;
    if (sourceId === undefined) {
      const [latest] = stack.manager.list({ workspaceRoot, limit: 1 });
      if (latest === undefined) {
        abortTick('--fork 无源会话');
        err.write('--fork 未带 id 且当前工作区无既有会话——无从分叉\n');
        return 1;
      }
      sourceId = latest.id;
    }
    let forked: Awaited<ReturnType<typeof stack.manager.fork>>;
    try {
      forked = await stack.manager.fork(sourceId);
    } catch (error) {
      abortTick('--fork 失败');
      err.write(`--fork 失败：${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
    if (forked.status === 'vetoed') {
      // session_before_fork 钩子否决——非错误路径但 run 无法进行（退 1 执行失败档）
      abortTick('--fork 被钩子否决');
      err.write(`--fork 被钩子否决：${forked.reason}\n`);
      return 1;
    }
    sessionId = forked.sessionId;
  } else {
    sessionId = stack.manager.create({ workspaceRoot }).sessionId;
  }

  // —— ④ --port 咬合（18a-3' 三入口咬合——run 形与 serve 前台同段：面与 run
  // 并存双活，closer 挂退出序；sdk 件缺席 = warn 不开面〔件禁用语义族〕）——
  if (flags.port !== undefined) {
    const sdkKit = scope.tryGet<{ readonly createFace: unknown }>('sdk-http-face');
    if (sdkKit === undefined) {
      err.write('warn：core:sdk 件未装载——--port 人面不开（run 本体不受累）\n');
    } else {
      const mountKit = scope.tryGet<WebuiMountKit>('webui-face-mount');
      try {
        await openWebuiFace({
          stack,
          runtime,
          port: flags.port,
          ...(mountKit !== undefined ? { mountKit } : {}),
          ...(options.onWebuiOpen !== undefined ? { onOpen: options.onWebuiOpen } : {}),
        });
      } catch (error) {
        // 开面失败（如端口占用 EADDRINUSE）= 预期内环境态——干净呈报不写 crash.log
        abortTick('--port 开面失败');
        err.write(`--port 开面失败：${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
      }
    }
  }

  // —— ⑤ 事件消费位聚合态（onEnvelope 回调写、settle 段读——单后端单 run 单线程）——
  let turnsEnded = 0;
  let truncated = false; // --max-turns 到帽收场语义位（CLI 级——run 本体仍 aborted）
  let lastAssistantText: string | undefined;
  // 末条 assistant 消息是否含 ≥1 个 text 块（零 text 块收场 = 仅 thinking 块——
  // --output-schema 校验靶不存在的判据位：文本过滤产物为空串 ''（非 undefined），
  // 不能用 lastAssistantText !== undefined 简化判——07 §5 定形注④）
  let lastAssistantHadText = false;
  const usageSum: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

  const backend: UiBackend<never> = {
    id: 'cli-run',
    // 阻塞原语全 false：headless 单发无人在屏——capability false 即不参与竞速
    //（04 §9 无静默审批：waterfall 无人应答立即 unavailable，run 不挂死）
    capabilities: {
      notify: true,
      confirm: false,
      select: false,
      input: false,
      approval: false,
      setStatus: false,
      setWidget: false,
    },
    hasAudience: () => true, // stdout 消费者在场（管道/重定向/TTY 皆观众）
    notify: (text, nOpts) => {
      // stdout 纯净律：通知恒走 stderr；warn/error 带档前缀（人读分级）
      const prefix = nOpts?.level === 'warn' || nOpts?.level === 'error' ? `[${nOpts.level}] ` : '';
      err.write(`${prefix}${text}\n`);
    },
    onEnvelope: (env) => {
      if (env.sessionId !== sessionId) return; // 多会话信封——只消费本 run 的
      const event: AgentEvent = env.event;
      // --no-delta：线面退订 message_update（07 §5——整消息事件不受影响）
      if (flags.noDelta && event.type === 'message_update') return;
      // max-turns 执法位：turn_start 到达且已收满帽数 turn_end = 第 N+1 轮已
      // 起步——到帽收场（interrupt 协作中止；自然收场不开第 N+1 轮故无误伤；
      // turn_start 先于模型调用发射，abort 落位确定）
      if (event.type === 'turn_start' && flags.maxTurns !== undefined && turnsEnded >= flags.maxTurns && !truncated) {
        truncated = true;
        stack.interrupt(sessionId);
        return;
      }
      if (event.type === 'turn_end') turnsEnded += 1;
      if (event.type === 'message_end' && isStandardMessage(event.message) && event.message.role === 'assistant') {
        const assistant = event.message;
        // 末条 assistant 文本（text 块拼接——thinking 不入人读产物）；hadText 位
        // 独立记「块在场」（空 text 块形块在而文本空——校验靶仍在场走 PARSE_FAILED，
        // 与零 text 块的「靶不存在」分立——07 §5 定形注④）
        const textBlocks = assistant.content.filter(
          (block): block is { type: 'text'; text: string } => block.type === 'text',
        );
        lastAssistantHadText = textBlocks.length > 0;
        lastAssistantText = textBlocks.map((block) => block.text).join('');
        addUsageInto(usageSum, assistant.usage);
      }
      // stream 档：AgentEvent NDJSON 直出（07 §5——与 serve 线协议同源事件面）
      if (outputFormat === 'stream') out.write(`${JSON.stringify(event)}\n`);
    },
  };
  stack.channels.addBackend(backend);

  // keepalive（text/json 档——07 §5：stdout 纯净，活体行走 stderr；stream 档
  // 心跳即事件流一员不另设）
  const startedAt = Date.now();
  const keepaliveTimer =
    outputFormat === 'stream'
      ? undefined
      : setInterval(() => {
          err.write(`run 进行中（${Math.round((Date.now() - startedAt) / 1000)}s）\n`);
        }, options.keepaliveIntervalMs ?? 5_000);
  keepaliveTimer?.unref?.(); // 不拖进程生命周期（事件环外定时器）

  // —— ⑥ 提交（fire-and-forget 面的 await 侧——回执即收场凭据；source 归因：
  // tick 形 'schedule'〔挂钟调度触发〕、余 'channel:cli'〔CLI 管道喂入〕；
  // backgroundLane 声明与后台道记账同条件〔flags.background——04 §5 修复批：
  // 预警分族与记账同一车道判定〕）——
  const source: EventSource = flags.tick !== undefined ? 'schedule' : 'channel:cli';
  // —— ⑥' --output-schema 约束块注入（07 §5 落码定形注③）：附本轮用户消息尾
  // 的 fenced 自述块——schema 原文整嵌（单源：文件字节即注入字节，改写即失
  // 真）；只约束「末条 assistant 文本整体须单一 JSON 文档」，模型侧生成纪律
  // 靠此块传达，宿主侧收场校验兜底〔定形注④〕——
  const submitMessage =
    schemaDoc !== undefined && schemaRaw !== undefined
      ? `${message}

\`\`\`structured-output-constraint
本轮收场时，你的最终回复必须是单个 JSON 文档（整体只能是该 JSON，前后不得有其他文本或代码围栏），且严格符合以下 JSON Schema：

${schemaRaw}
\`\`\``
      : message;
  const runPromise = stack.submitText(sessionId, submitMessage, {
    source,
    ...(flags.background ? { backgroundLane: true } : {}),
  });
  if (runPromise === undefined) {
    // 理论不达防御：③四形必落驱动——到达即装配 bug，fail-loud（经外层崩溃档）
    throw new Error(`会话 ${sessionId} 无驱动在册——提交序不可达`);
  }
  let result: SubmitResult;
  try {
    result = await runPromise;
  } finally {
    if (keepaliveTimer !== undefined) clearInterval(keepaliveTimer);
    stack.channels.removeBackend('cli-run'); // 幂等——重复摘除 no-op
  }
  if (result.status === 'injected' || result.status === 'wake-refused') {
    // 本入口无 backgroundWake 载体/停摆期注入语义——到达即异常态，诚实退 1
    abortTick(`提交回执异常（${result.status}）`);
    err.write(`提交回执异常（${result.status}）——run 未起跑\n`);
    return 1;
  }
  // 此后 result 收窄为 RunResult（completed/aborted/failed 三终态）

  // —— ⑦ --background 记账：已上移组合根 settled 桥接单点（04 §5 2026-09-13
  // #41/#44 定形——五入口 run 路统一〔run/tick/TUI/webui/issue 前后台全入账〕，
  // priority 由回执 backgroundLane 声明；此处再扫即双计，旧段退役）——

  // —— ⑧ goal recordTurn 挂点已上移驱动层（批 #99 三入口统一：TUI/webui/
  // issue/run CLI 全经 driver launch settled 链的 onRunSettled 回执——此处
  // 再记一笔即双计，故移除；userInitiated 归因由回执 seeds 窗扫承载）——

  // —— ⑨ settle：CLI 级收场语义（truncated 到帽位在 run 本体 aborted 之上
  // 如实标注）+ 退出码三态映射（completed → 0；failed/aborted/truncated → 1）——
  const finalStatus = truncated ? 'truncated' : result.status;
  let exitCode: number;
  if (finalStatus === 'completed') {
    exitCode = 0;
  } else {
    exitCode = 1;
    if (finalStatus === 'truncated') {
      err.write(`已到 --max-turns ${flags.maxTurns} 帽收场（truncated——到帽截断非终态失败，收场语义位如实标注）\n`);
    } else if (result.status === 'failed') {
      // provider 两形态产品级文案（07 §5 provider 产品级文案律）；其余失败原文直出
      const diagnostic = diagnoseProviderFailure({ errorMessage: result.errorMessage }, stack.model);
      if (diagnostic !== undefined) {
        err.write(`${diagnostic.hint}\n`);
      } else if (result.errorMessage !== undefined && result.errorMessage !== '') {
        err.write(`run 失败：${result.errorMessage}\n`);
      } else {
        err.write('run 失败（无错误说明）\n');
      }
    } else if (result.errorMessage !== undefined && result.errorMessage !== '') {
      err.write(`run 中止：${result.errorMessage}\n`); // aborted 带说明时呈报（SIGINT 路径说明缺席为常态）
    }
  }

  // —— ⑨½ --output-schema 收场校验（07 §5 落码定形注④⑤〔2026-09-15 批〕）：
  // 仅 completed 档叠加（truncated/failed/aborted 不叠——run 本体已非成功态退 1
  // 已定）；completed 而无末条文本 = 校验靶不存在，同档不叠加（零 text 块收场
  // ——hadText 位判「块在场」：thinking-only 收场文本过滤产物是空串 ''（非
  // undefined），修前误走 PARSE_FAILED 退 1——同批修；空 text 块形块在而文本
  // 空仍属靶在场，照走 PARSE_FAILED）。失败两档：退出码叠加 1、stderr 载码呈
  // 报、json 档 summary 与 tick settle outcome 各载码（三面同源）——loop 真态
  // 不改写（status 仍 completed，只有退出码与错误位动）——
  let schemaErrorCode: 'STRUCTURED_OUTPUT_PARSE_FAILED' | 'STRUCTURED_OUTPUT_SCHEMA_MISMATCH' | undefined;
  let schemaErrorMessage: string | undefined;
  // 校验靶取值（hadText 联判收窄：零 text 块收场靶不存在——undefined 形语义）
  const finalAssistantText = lastAssistantHadText ? lastAssistantText : undefined;
  if (schemaDoc !== undefined && finalStatus === 'completed' && finalAssistantText !== undefined) {
    let parsedOutput: unknown;
    try {
      parsedOutput = JSON.parse(finalAssistantText);
    } catch {
      schemaErrorCode = 'STRUCTURED_OUTPUT_PARSE_FAILED';
      schemaErrorMessage = '末条 assistant 文本非合法 JSON（要求：整体单一 JSON 文档——前后不得有其他文本）';
    }
    if (schemaErrorCode === undefined && !Value.Check(schemaDoc, parsedOutput)) {
      schemaErrorCode = 'STRUCTURED_OUTPUT_SCHEMA_MISMATCH';
      const firstError = [...Value.Errors(schemaDoc, parsedOutput)][0];
      schemaErrorMessage =
        firstError !== undefined
          ? `输出不符合 schema（${firstError.instancePath || '(root)'}：${firstError.message}）`
          : '输出不符合 schema';
    }
    if (schemaErrorCode !== undefined) {
      exitCode = 1; // 叠加律：completed 档唯一可退 1 形（定形注⑤）
      err.write(`${schemaErrorCode}：${schemaErrorMessage}\n`);
    }
  }

  // —— ⑨' tick settle（律 3 乙案侧收场腿——2026-09-13 修复批）：终态镜像落
  // jobs 行（completed→exit_code 0+preview / failed→exit_code 1+error /
  // truncated·aborted→killed；preview 帽 200 与 RunOutcome 契约同值）。崩溃/
  // 信号路径不达本段——claim 残账由引擎僵行清扫回收（律 3 既有兜底语义）——
  if (tickJob !== undefined) {
    const finishedAt = new Date().toISOString();
    if (finalStatus === 'completed') {
      // 冷读①（2026-09-15 批）：exitCode 用计算后变量——schema 失败叠加退 1
      // 在 ⑨½ 落位，此前此处硬编码 0 即账实分离；error 位载码（200 帽同族）
      const outcome: RunOutcome = { trigger: 'cron', reason: 'exit_code', exitCode, finishedAt };
      if (schemaErrorCode !== undefined) {
        outcome.error = `${schemaErrorCode}：${schemaErrorMessage ?? ''}`.slice(0, 200);
      }
      if (lastAssistantText !== undefined) outcome.finalTextPreview = lastAssistantText.slice(0, 200);
      settleTick(outcome);
    } else if (finalStatus === 'truncated') {
      settleTick({
        trigger: 'cron',
        reason: 'killed',
        error: `--max-turns ${flags.maxTurns} 到帽截断（truncated）`,
        finishedAt,
      });
    } else if (result.status === 'failed') {
      settleTick({
        trigger: 'cron',
        reason: 'exit_code',
        exitCode: 1,
        error: (result.errorMessage ?? 'run 失败（无错误说明）').slice(0, 200),
        finishedAt,
      });
    } else {
      settleTick({ trigger: 'cron', reason: 'killed', error: 'run 中止（协作/信号 abort）', finishedAt });
    }
  }

  // —— ⑩ 输出三档的终值面（stream 档活体已直出——无终值行）——
  if (outputFormat === 'text') {
    if (lastAssistantText !== undefined) out.write(`${lastAssistantText}\n`);
  } else if (outputFormat === 'json') {
    // 终值单对象（07 §5——机器消费面：识别/计量/产物一屏尽收）
    const summary = {
      sessionId,
      status: finalStatus,
      ...(result.stopReason !== undefined ? { stopReason: result.stopReason } : {}),
      ...(result.status === 'failed' && result.errorMessage !== undefined ? { errorMessage: result.errorMessage } : {}),
      // --output-schema 校验失败位（07 §5 定形注⑤：status 不改写——loop 真态
      // 仍 completed，错误语义全在此两位 + 退出码叠加）
      ...(schemaErrorCode !== undefined ? { errorCode: schemaErrorCode, errorMessage: schemaErrorMessage ?? '' } : {}),
      turns: turnsEnded,
      usage: usageSum,
      ...(lastAssistantText !== undefined ? { lastMessage: lastAssistantText } : {}),
    };
    out.write(`${JSON.stringify(summary)}\n`);
  }
  if (flags.outputLastMessage !== undefined) {
    // 末条 assistant 文本原子写（同目录 tmp + rename——CI 取产物不解析 stdout；
    // 内容即纯文本零尾随换行——字节确定性读侧友好）
    const target = flags.outputLastMessage;
    try {
      const tmp = `${target}.tmp-${pid}`;
      writeFileSync(tmp, lastAssistantText ?? '');
      renameSync(tmp, target);
    } catch (error) {
      err.write(`--output-last-message 写入失败：${error instanceof Error ? error.message : String(error)}\n`);
      return 1;
    }
  }
  return exitCode;
}

/** usage 累加（totalTokens 派生重算——四桶和；可选子集上报才累加） */
function addUsageInto(sum: Usage, usage: Usage): void {
  sum.input += usage.input;
  sum.output += usage.output;
  sum.cacheRead += usage.cacheRead;
  sum.cacheWrite += usage.cacheWrite;
  if (usage.cacheWrite1h !== undefined) sum.cacheWrite1h = (sum.cacheWrite1h ?? 0) + usage.cacheWrite1h;
  if (usage.reasoning !== undefined) sum.reasoning = (sum.reasoning ?? 0) + usage.reasoning;
  sum.totalTokens = sum.input + sum.output + sum.cacheRead + sum.cacheWrite;
}

// 计量桶映射单源已上移 llm/events.ts usageBucketsOf（04 §5 #41/#44 桥接单点化——旧扫退役）
