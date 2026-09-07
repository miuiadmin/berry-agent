/**
 * host/serve-entry — serve 常驻宿主装配（批 13c；07 §5 serve 子命令 =
 * stdio JSONL 传输的缺省形态）。
 *
 * 装配序（承 tui-entry 模板）：--daemon 诚实拒（HTTP 面归 core:sdk 件 13e，
 * 不可静默吞）→ createHostRuntime（单活跃机占标记 → 开库 → 披露段）→
 * logger 装配（--debug 让位律）→ createConversationStack → 装配桥（把
 * ConversationStack 映射成 SdkWireDeps——05 §3.5 serve 外推三腿的桥接位）
 * → createSdkBackend → channels.addBackend（信封回流经 conversation-stack
 * onEvent → emit 自动馈送——桥零订阅代码）→ stdio 传输环 + 心跳定时 →
 * EOF/信号/过载三路收场。
 *
 * 传输环（03 §10.6 件身份条：stdio JSONL 归宿主 serve）：入站
 * splitWireLines 分帧 → decodeWireLine → core.handleRequest（坏行 warn 跳过
 * 不杀连接）；出站 sink = stdout 直写，`write` 返回 false 即背压（帧入线核
 * 有界队列），'drain' 事件 → core.drain()；ENOBUFS/EAGAIN 族按瞬时拥塞退避
 * 重试（pi output-guard 三件套执法位——宿主 serve 即执法宿主），其余写错
 * 传输面坏死收场退 1。
 *
 * 旗标：--no-delta 作连接缺省 noDelta（07 §5——hello 显式携值胜出）；
 * --port 开统一 HTTP 面 TCP 人面（18a-3' 三入口咬合——stdio 线与 TCP 面
 * 并存双活；dump-config 同构诊断命令忽略该旗标不起监听维持）；--debug
 * logger 提级（env 已设时让位）。
 *
 * 退出码（07 §5 三态）：0 = EOF/信号优雅收场；1 = 组装失败 / 传输面坏死 /
 * 过载断连（SDK_OVERLOADED 已尽力直写后关传输——错误必及时非零退出）。
 *
 * 13c 边界注：serve status / serve stop 管理动词语义钉在 daemon 形态
 * （13e 随 HTTP 面落码）——13c 前台 stdio 形不装配两动词（dispatch 诚实
 * 退 1「尚未装配」）。routedChannel 由桥按受理时刻驱动 running 态推导
 * （03 §10.6 注记——观察非控制）；closed 档 v1 = 进程内 dismantle 态
 * （无用户面 close 动词，跨重启闭态承载随需再裁）。
 */
import type { Writable } from 'node:stream';
import { Readable } from 'node:stream';
import { stdin, stdout, stderr } from 'node:process';

import { createLogger, LogLevelState } from '../context/index.js';
import type { Provider } from '../llm/index.js';
import type { SandboxMode } from '../safety/index.js';
import { createSdkBackend, decodeWireLine, encodeWireLine, isSdkRequest, splitWireLines } from '../channels/index.js';
import type {
  SdkDurableEntry,
  SdkOutboundSink,
  SdkSessionState,
  SdkSubmitInput,
  SdkSubmitOutcome,
  SdkWireDeps,
  SdkWireFrame,
} from '../channels/index.js';
import type { SessionEvent } from '../contracts/index.js';

import type { ServeFlags } from './cli.js';
import type { ConversationStack } from './conversation-stack.js';
import { createConversationStack } from './conversation-stack.js';
import type { HostRuntime } from './runtime.js';
import { createHostRuntime } from './runtime.js';
import { openWebuiFace } from './webui-bridge.js';
import type { WebuiOpenInfo } from './webui-bridge.js';

/** stdio 注入面（缺省 process stdin/stdout——测试以 PassThrough 驱动全环） */
export interface ServeIo {
  readonly input: Readable;
  readonly output: Writable;
}

/** serve 入口选项（main 分派接线 + 测试注入面——承 TuiEntryOptions 同族） */
export interface ServeEntryOptions {
  readonly flags: ServeFlags;
  /** 传输流对（缺省 process stdin/stdout） */
  readonly io?: ServeIo;
  /** 新会话工作区根锚点（缺省 process.cwd()——sessions.workspace_root 落账位） */
  readonly cwd?: string;
  /** 数据目录（HostRuntimeOptions 透传；缺省 resolveDataDir() 三级梯子） */
  readonly dataDir?: string;
  /** :memory: 同构形态（诊断测试） */
  readonly memory?: boolean;
  /** 初始 provider 集（测试注入 faux provider） */
  readonly providers?: readonly Provider[];
  /** 模型标识（组合根透传；缺省 BERRY_AGENT_MODEL 覆盖律） */
  readonly model?: string;
  /** 沙箱档位取值器（透传组合根） */
  readonly sandboxMode?: () => SandboxMode;
  /** env 面（缺省 process.env；测试隔离 BERRY_AGENT_MODEL） */
  readonly env?: Record<string, string | undefined>;
  /** 已组运行时（测试注入；缺省现场组装） */
  readonly runtime?: HostRuntime;
  /** 运行时组装后回调（main.ts attachRuntime——信号/崩溃编舞切运行时本体） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** 心跳节拍毫秒（线核静默判据与装配层定时共用——测试提速注入位；缺省 5000） */
  readonly heartbeatIntervalMs?: number;
  /** webui 开面回执（`--port` 在场时开面后回调——测试拿实配端口与 token） */
  readonly onWebuiOpen?: (info: WebuiOpenInfo) => void;
}

/**
 * 会话事件 → durable 平铺投影（双轨律重放段载体——type/seq/time/data 四字段
 * 原样平铺，词汇零二校验〔05 §3.5 第一腿〕）。
 */
function toDurableEntry(event: SessionEvent): SdkDurableEntry {
  return { type: event.type, seq: event.seq, time: event.time, data: event.data };
}

/** 装配桥注入面（SdkWireDeps 除 decideApproval/onSubscribed〔后端自持〕与 sink〔传输环自持〕） */
export type ServeBridgeDeps = Omit<SdkWireDeps, 'decideApproval' | 'onSubscribed' | 'sink'>;

/**
 * 装配桥：ConversationStack → SdkWireDeps 桥接（05 §3.5 serve 外推三腿的
 * 桥接位；导出面供 serve-entry 传输环消费与组装级测试直测）。
 *
 * 映射律（在册会话内存日志优先——write-behind 在飞事件的权威源；未开会话
 * 走库面纯读不 attach）：
 * - submitPrompt：sessionId 缺席 manager.create 新建（workspaceRoot 锚 cwd）、
 *   显式携带 manager.open 落驱动（幂等续接；missing/closed 已被线核先决门
 *   拦截）；routedChannel 按受理时刻 driver.running 推导（03 §10.6 注记）；
 *   归因 `channel:sdk` + messageId→dedupeKey 落账（05 §3.5 两词一字段两面）。
 * - queryEntries：单页全窗（重放腿跟尽 nextCursor 义务由桥并页兑现——cursor
 *   形参 v1 无第二页可续）。
 * - highWaterOf：在册 = 内存日志长度；未开 = 行 lastSeq（= 末次落账事件数）。
 */
export function createServeBridge(
  stack: ConversationStack,
  runtime: HostRuntime,
  anchors: { cwd: string },
): ServeBridgeDeps {
  /** 会话日志权威读（在册走内存——含 write-behind 在飞；未开走库面纯读） */
  const logOf = (sessionId: string): readonly SessionEvent[] => {
    const driver = stack.driverOf(sessionId);
    if (driver !== undefined) return driver.session.events();
    return runtime.persistence.store.loadEvents(sessionId);
  };

  return {
    submitPrompt: (input: SdkSubmitInput): SdkSubmitOutcome => {
      let sessionId = input.sessionId;
      if (sessionId === undefined) {
        sessionId = stack.manager.create({ workspaceRoot: anchors.cwd }).sessionId;
      }
      // 显式会话可能仅库面在册——open 幂等落驱动（线核先决门已拦 missing/closed）
      const driver = stack.driverOf(sessionId) ?? stack.manager.open(sessionId).driver;
      // routedChannel 观察推导（03 §10.6 注记：受理时刻在飞 run → steer、否则
      // followUp——驱动侧单源路由的受理时刻投影，非控制位）
      const routedChannel = driver.running ? ('steer' as const) : ('followUp' as const);
      // 起跑让位一拍（queueMicrotask）：线核在 submitPrompt 返回后才同步挂
      // 自动订阅——同步起跑会让 agent_start 先于订阅点入空（首帧丢）。让位
      // 一拍保证订阅点先落、直播自 agent_start 起。回执经信封回流；回执面
      // 错误经 submitText 内部 notify 收口（无未处理拒绝）
      queueMicrotask(() => {
        stack.submitText(sessionId, input.content, {
          source: 'channel:sdk',
          dedupeKey: input.messageId,
        });
      });
      return { sessionId, routedChannel };
    },
    lookupDedupeKey: (sessionId: string, messageId: string): string | undefined => {
      // durable 档查重（05 §3.5 第二腿）：返回原内容串——admit 同键异内容
      // 判定源；块形内容（非 serve 线来源理论不达）JSON 稳定化兜底
      for (const event of logOf(sessionId)) {
        if (event.type !== 'user/message') continue;
        const data = event.data as { dedupeKey?: string; content?: unknown };
        if (data.dedupeKey !== messageId) continue;
        return typeof data.content === 'string' ? data.content : (JSON.stringify(data.content) ?? '');
      }
      return undefined;
    },
    interruptSession: (sessionId: string): void => {
      stack.interrupt(sessionId);
    },
    queryEntries: (sessionId: string, since: number): { entries: SdkDurableEntry[] } => {
      const log = logOf(sessionId);
      // (since, 高水位) 窗口（高水位 = 日志长度 = 下一 seq——线核同式）
      return { entries: log.filter((e) => e.seq > since && e.seq < log.length).map(toDurableEntry) };
    },
    listSessions: () =>
      stack.manager.list().map((row) => ({
        id: row.id,
        title: row.title ?? null, // 无标题不造占位串（03 §10.6 sessions 词面）
        lastActivityAt: row.updatedAt,
      })),
    highWaterOf: (sessionId: string): number | undefined => {
      const driver = stack.driverOf(sessionId);
      if (driver !== undefined) return driver.session.events().length;
      const row = runtime.persistence.store.getSessionRow(sessionId);
      return row === undefined ? undefined : row.lastSeq;
    },
    sessionStateOf: (sessionId: string): SdkSessionState => {
      const driver = stack.driverOf(sessionId);
      if (driver !== undefined) return driver.dismantled ? 'closed' : 'open';
      // 库面在册 = 可续（prompt/订阅经 manager.open 落驱动）
      return runtime.persistence.store.getSessionRow(sessionId) === undefined ? 'missing' : 'open';
    },
    retryProbeOf: (sessionId: string) => stack.driverOf(sessionId)?.retryState ?? null,
  };
}

/**
 * serve 主入口。阻塞至调用方收线（stdin EOF）/ 信号（经 main 编舞 →
 * runtime.shutdown → closer）/ 传输面坏死 / 过载断连；返回进程退出码。
 */
export async function runServeEntry(options: ServeEntryOptions): Promise<number> {
  // —— daemon 防御拒（13e-3 起 daemon 编舞归 main 分派层 → serve-daemon 件：
  // spawner spawn 自镜像 + HTTP 面常驻。本入口只承载 stdio 前台形态——直调
  // 传 daemon:true = 绕过分派层的编程误用，诚实拒不静默降级。占标记前拒——
  // 不留半开场）——
  if (options.flags.daemon) {
    stderr.write('--daemon 归 main 分派层（serve-daemon 编舞件）——serve-entry 只承载 stdio 前台形态\n');
    return 1;
  }

  // —— 运行时组装（单活跃机 + 开库 fail-loud——干净退出档，非崩溃取证档）——
  let runtime: HostRuntime;
  try {
    runtime =
      options.runtime ??
      createHostRuntime({
        ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
        ...(options.memory === true ? { memory: true } : {}),
      });
  } catch (err) {
    stderr.write(`启动失败：${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  options.onRuntime?.(runtime);

  // —— logger 装配：env 解析 + --debug 提级让位律（tui-entry 同款）——
  const env = options.env ?? process.env;
  const logState = LogLevelState.fromEnv(env.BERRY_AGENT_LOG_LEVEL);
  if (options.flags.debug && env.BERRY_AGENT_LOG_LEVEL === undefined) logState.setGlobalLevel('debug');
  const logger = createLogger('host', logState);

  let exitCode = 0;
  try {
    const stack = createConversationStack({
      runtime,
      ...(options.providers !== undefined ? { providers: options.providers } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
      warn: (message) => logger.warn(message),
    });

    // —— --port 统一 HTTP 面 TCP 人面（18a-3' 三入口咬合；03 §10.4 host
    // 接线）：stdio 线与 TCP 面并存双活——面承载 SPA + /api/* + /v1/* 三族
    // （bridge 同走 createServeBridge 零第二套映射）；披露两行走 stderr
    // （serve 前台披露通道）；closer 挂运行时退出序——EOF/信号/过载三路
    // 收场同享面收口（LIFO 在 serve-backend 之前注册 = drain 晚于 stdio 线
    // 收口——网络面先关）——
    if (options.flags.port !== undefined) {
      await openWebuiFace({
        stack,
        runtime,
        port: options.flags.port,
        ...(options.onWebuiOpen !== undefined ? { onOpen: options.onWebuiOpen } : {}),
      });
    }

    const io = options.io ?? { input: stdin, output: stdout };
    const heartbeatIntervalMs = options.heartbeatIntervalMs ?? 5_000;

    // —— 传输环状态（收场单次性由 settled 门保证）——
    let settled = false;
    let remainder = '';
    let resolveExit!: (code: number) => void;
    const exited = new Promise<number>((resolve) => {
      resolveExit = resolve;
    });

    // 出站 sink：stdout 直写，false = 背压（帧入线核有界队列待 drain）
    const sink: SdkOutboundSink = {
      write: (frame: SdkWireFrame) => {
        try {
          return io.output.write(encodeWireLine(frame));
        } catch {
          // 同步写异常（ENOBUFS 族）按背压处理——'error' 事件位统一退避重试
          return false;
        }
      },
    };

    const bridge = createServeBridge(stack, runtime, { cwd: options.cwd ?? process.cwd() });
    const handle = createSdkBackend(
      { ...bridge, sink, onOverload: () => shutdown(1) }, // 过载直写后宿主关传输（错误档退 1）
      {
        heartbeatIntervalMs,
        initialConnectionNoDelta: options.flags.noDelta, // 07 §5 --no-delta 宿主立场缺省
      },
    );
    stack.channels.addBackend(handle.backend); // 信封回流自动馈送（conversation-stack onEvent → emit）

    // 心跳：装配层定时驱动（线核零自驱时钟——13b 纪律）；drain 同拍 belt
    //（'drain' 事件为主路，定时兜底防事件丢失挂队列）
    const heartbeatTimer = setInterval(() => {
      handle.core.heartbeatTick();
      handle.core.drain();
    }, heartbeatIntervalMs);

    // 收场序：清定时 → dispose（在飞 ask cancel + core.close）→ runtime 六步
    // 退出序（幂等——EOF 路径与信号路径同享，closer 保证信号路径同样执行）
    const shutdown = (code: number): void => {
      if (settled) return;
      settled = true;
      clearInterval(heartbeatTimer);
      handle.dispose();
      void runtime
        .shutdown()
        .catch(() => {}) // 六步退出序内部已 fail-loud 记账——收场不二次抛
        .then(() => resolveExit(code));
    };
    runtime.registerCloser({ label: 'serve-backend', fn: () => shutdown(0) }); // 信号路径优雅档（settled 门幂等——过载/坏死路径自带 1 不被覆写）

    // —— 入站环：分帧 → 解码 → 线核受理 ——
    io.input.setEncoding?.('utf8');
    io.input.on('data', (chunk: string) => {
      if (settled) return;
      const split = splitWireLines(chunk, remainder);
      remainder = split.remainder;
      for (const line of split.lines) {
        let decoded: unknown;
        try {
          decoded = decodeWireLine(line);
        } catch (err) {
          // 坏行不杀连接（fail-loud 诊断在 stderr——协议鲁棒位）
          logger.warn(`行解码失败跳过：${err instanceof Error ? err.message : String(err)}`);
          continue;
        }
        if (!isSdkRequest(decoded)) {
          logger.warn('收到帧形行（服务端只受理请求行）——跳过');
          continue;
        }
        handle.core.handleRequest(decoded);
      }
    });
    // EOF = 调用方收线——优雅收场；管道断裂同语义（无对端可写即服务终了）
    io.input.on('end', () => shutdown(0));
    io.input.on('close', () => shutdown(0));
    io.input.on('error', (err: Error) => {
      logger.warn(`stdin 异常：${err.message}`);
      shutdown(1);
    });

    // —— 出站背压恢复与传输面健康 ——
    io.output.on('drain', () => {
      if (!settled) handle.core.drain();
    });
    io.output.on('error', (err: NodeJS.ErrnoException) => {
      if (settled) return;
      // ENOBUFS/EAGAIN 族 = 管道瞬时拥塞（pi output-guard 三件套执法位——
      // 宿主 serve 即执法宿主）：退避重试 drain；其余 = 传输面坏死收场退 1
      if (err.code === 'ENOBUFS' || err.code === 'EAGAIN') {
        setTimeout(() => {
          if (!settled) handle.core.drain();
        }, 50);
        return;
      }
      logger.warn(`stdout 异常：${err.message}`);
      shutdown(1);
    });

    exitCode = await exited;
  } catch (err) {
    runtime.writeCrashLog(err); // 崩溃取证先行（memory 形跳过——件内语义）
    stderr.write(`serve 运行失败：${err instanceof Error ? err.message : String(err)}\n`);
    exitCode = 1;
  }
  return exitCode;
}
