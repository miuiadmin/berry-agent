/**
 * host/conversation-stack — 对话栈组合根（批 12e 装配序核心件；07 §1.1
 * 表 #10 host 席「装配序」条的本体，channels/service.ts 头注装配序真源）。
 *
 * 一次成型装配五层：
 *  ① context 基座——Scope 根 + EventDispatch + ctx.agent 服务面（先于一切
 *     驱动起跑——onRunSettled 订阅面的供给前提）；
 *  ② llm 运行时——Models 宿主 + StreamFn（永不抛）+ complete 单发服务，
 *     两出口共享同一 InFlightTracker（04 §3.6 同源计数）；
 *  ③ compaction 服务——SummaryChannel 适配 LlmService（maxChars 预算入
 *     prompt 指令、输出防御性截断）+ 阈值触发器经 onRunSettled 接线
 *     （05 §2 装配挂账兑现；usage 真值笔仍挂账——RunSettledEvent 不携计量，
 *     缺省估算档收口）；
 *  ④ channels 通道核——fetchProjection/history 同源投影注入（07 §4.1 边表
 *     执法：核零 session 依赖，数据源在此闭包注入）；
 *  ⑤ SessionManager——DriverFactory 注入：open 域工具一次成型（assembleOpenTools
 *     + 审批桥）+ ConversationDriver 装配注入族全接线 + 活体事件信封汇入
 *     channels.emit（per-run sink 的归汇处）。
 *
 * 装配循环依赖解法：channels 的投影源要驱动登记、驱动的审批 ask 要 channels
 * 队列——channels 创建收进本件内部（组合根自持），TUI 入口只 addBackend。
 *
 * memory 形降级（05 §6.6/07 §5）：runtime.dataDir === null 时 open 域工具整面
 * 缺席（守门恒排除位必填真 dataDir）——纯对话 run，工具面类型可选的诚实降级。
 */
import { canonicalWorkspaceRoot, EventDispatch, Scope } from '../context/index.js';
import { createChannels } from '../channels/index.js';
import type { ChannelsService } from '../channels/index.js';
import type { AgentMessage, AgentTool, ApprovalAskRequest, ThinkingLevel } from '../contracts/index.js';
import { getMessageRoleDefinition, isStandardMessage } from '../contracts/index.js';
import { createCompactionService } from '../compaction/index.js';
import type { CompactionService } from '../compaction/index.js';
import {
  assembleOpenTools,
  ConversationDriver,
  DEFAULT_RETRY_POLICY,
  ensureTodoRole,
  provideAgentService,
  reseedTimeline,
  SessionManager,
} from '../conversation/index.js';
import type { DriverFactory, SubmitOptions, SubmitResult } from '../conversation/index.js';
import type { UserMessage } from '../contracts/index.js';
import {
  classifyError,
  createLlmRuntime,
  createLlmService,
  createStreamFn,
  InFlightTracker,
  resolveDefaultModelSpec,
} from '../llm/index.js';
import type { LlmService, Provider } from '../llm/index.js';
import type { SandboxMode } from '../safety/index.js';
import { deriveMessages } from '../session/index.js';
import type { SessionLog } from '../session/index.js';

import type { HostRuntime } from './runtime.js';

/** 组合根选项（TUI 入口与测试的注入面） */
export interface ConversationStackOptions {
  readonly runtime: HostRuntime;
  /** 初始 provider 集（缺省 pi-ai 内置全家桶；测试注入 faux provider） */
  readonly providers?: readonly Provider[];
  /** 模型标识（缺省 resolveDefaultModelSpec——BERRY_AGENT_MODEL 覆盖律） */
  readonly model?: string;
  /** env 面（缺省 process.env；测试注入隔离 BERRY_AGENT_MODEL） */
  readonly env?: Record<string, string | undefined>;
  /** 根作用域（缺省新建——插件装载层共用时注入） */
  readonly scope?: Scope;
  /** 事件总线（缺省新建） */
  readonly dispatch?: EventDispatch;
  /** 沙箱档位取值器（缺省 workspace-write——04 §7 缺省档） */
  readonly sandboxMode?: () => SandboxMode;
  /** 系统提示词基线（04 §11：披露段由驱动在 transformContext 关口另行追加） */
  readonly systemPrompt?: string;
  /** 思考档位（会话态） */
  readonly thinkingLevel?: ThinkingLevel;
  /** 警示面（缺省 stderr——驱动护栏与压缩 warn 的落点） */
  readonly warn?: (message: string) => void;
}

/** 启动会话回执（07 §5 启动会话策略的产物面） */
export interface StartupSession {
  readonly sessionId: string;
  readonly driver: ConversationDriver;
  /** true = 续接既有会话（按 cwd 取最新）；false = 全新会话 */
  readonly resumed: boolean;
  /** 归一工作区根（会话表 workspace_root 选取键同源） */
  readonly workspaceRoot: string;
}

/** 对话栈面（TUI 入口的消费面） */
export interface ConversationStack {
  readonly manager: SessionManager;
  readonly channels: ChannelsService<AgentMessage>;
  readonly llm: LlmService;
  readonly scope: Scope;
  readonly dispatch: EventDispatch;
  readonly model: string;
  /** 投影拉取（焦点重画与 /history 同源——驱动活体优先，未开回库装载） */
  projectionOf(sessionId: string): Promise<readonly AgentMessage[]>;
  driverOf(sessionId: string): ConversationDriver | undefined;
  /** 提交入口（fire-and-forget 形——回执经信封回流；无该会话驱动时 undefined） */
  submitText(
    sessionId: string,
    text: string,
    options?: SubmitOptions & { source?: UserMessage['source'] },
  ): Promise<SubmitResult> | undefined;
  /** 协作中止（在飞 run 的打断柄） */
  interrupt(sessionId: string): void;
  /** 启动会话策略（07 §5：cwd 归一根取最新会话——有则续接无则新建） */
  openStartupSession(cwd?: string): StartupSession;
}

/**
 * 组装对话栈。副作用注册：两 closer（manager 拆解 → compaction 排空）按注册
 * 序进运行时退出序（abort 之后、write-behind flush 之前）。
 */
export function createConversationStack(options: ConversationStackOptions): ConversationStack {
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
  const scope = options.scope ?? Scope.createRoot();
  const dispatch = options.dispatch ?? new EventDispatch();
  const model = options.model ?? resolveDefaultModelSpec(options.env ?? process.env);
  const sandboxMode = options.sandboxMode ?? (() => 'workspace-write' as SandboxMode);
  const workspaceAnchor = () => canonicalWorkspaceRoot();

  // ① ctx.agent 服务面先于一切驱动起跑（onRunSettled 订阅供给前提）
  const agentService = provideAgentService(scope);
  // todo 回看角色幂等注册（进程级单表——convertToLlm 消费前置）
  ensureTodoRole();

  // ② llm 运行时：两出口共享同一 InFlightTracker（04 §3.6 同源计数名实相符）
  const llmRuntime = createLlmRuntime(options.providers !== undefined ? { providers: options.providers } : {});
  const tracker = new InFlightTracker();
  const streamFn = createStreamFn(llmRuntime, {}, tracker);
  const llm = createLlmService({ runtime: llmRuntime, tracker, defaultModel: () => model });

  // ③ compaction：SummaryChannel 适配（maxChars 由 prompt 指令承载——complete
  // 单发面无 maxTokens 参数；输出防御性截断兜底）。阈值触发器接线：run 终态
  // 订阅 → handleRunSettled（usage 真值笔挂账——现缺省估算档）。
  const compaction: CompactionService = createCompactionService({
    channel: {
      complete: async ({ prompt, maxChars }) => {
        const result = await llm.complete({
          messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
          priority: 'foreground',
        });
        // 文本块拼接 + 预算截断（防御位——prompt 指令是主预算通道）
        const text = result.message.content
          .filter((block): block is { type: 'text'; text: string } => block.type === 'text')
          .map((block) => block.text)
          .join('');
        return { text: text.length > maxChars ? text.slice(0, maxChars) : text };
      },
    },
    warn,
  });

  // ④ channels 通道核（投影源在⑤驱动登记之后才被调用——闭包前向引用安全）
  const channels = createChannels<AgentMessage>({
    fetchProjection: (sessionId) => Promise.resolve(projectionOf(sessionId)),
    history: (sessionId) => Promise.resolve(projectionOf(sessionId)),
  });

  // ⑤ SessionManager：DriverFactory 装配注入族全接线
  const createDriver: DriverFactory = ({ session }) => {
    const sessionId = session.sessionId;
    // 审批桥：driver 与 open 域工具共用同一 per-session ask 面（07 §4.3 提问队列）
    const askApproval = (request: ApprovalAskRequest, opts?: { signal?: AbortSignal }) =>
      channels.askApproval(sessionId, request, opts);
    let tools: readonly AgentTool[] | undefined;
    let settleApprovals: (() => void) | undefined;
    if (options.runtime.dataDir !== null) {
      const assembly = assembleOpenTools({
        sessionId,
        dispatch,
        session,
        scope,
        mode: sandboxMode,
        dataDir: options.runtime.dataDir,
        workspace: workspaceAnchor,
        askApproval,
      });
      options.runtime.registerDisposer(assembly.dispose); // LIFO 拆解进运行时退出序
      tools = assembly.tools;
      settleApprovals = assembly.settlePending;
    } // memory 形：工具整面缺席——纯对话 run（件头注降级语义）
    const driver = new ConversationDriver({
      session,
      scope,
      dispatch,
      streamFn,
      convertToLlm: (message: AgentMessage) =>
        isStandardMessage(message) ? message : (getMessageRoleDefinition(message.role)?.toLlm?.(message) ?? null),
      model,
      ...(tools !== undefined ? { tools } : {}),
      ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
      ...(options.systemPrompt !== undefined ? { systemPrompt: options.systemPrompt } : {}),
      classifyError,
      compactForOverflow: (log: SessionLog) => compaction.compactForOverflow(log),
      environmentDisclosure: options.runtime.disclosure,
      askApproval,
      ...(settleApprovals !== undefined ? { settleApprovals } : {}),
      warn,
      onEvent: (event) => channels.emit({ sessionId, event }),
      retry: DEFAULT_RETRY_POLICY,
    });
    return driver;
  };
  const manager = new SessionManager({ persistence: options.runtime.persistence, dispatch, createDriver });

  // 阈值触发器：run 终态 → 该会话日志入阈值判定（fire-and-forget；缺 usage 走估算）
  agentService.onRunSettled((event) => {
    const driver = manager.driverOf(event.sessionId);
    if (driver !== undefined) compaction.handleRunSettled({ log: driver.session });
  });

  /** 投影拉取：驱动活体优先（内存最新鲜），未开回库装载（双事实源纪律同律） */
  async function projectionOf(sessionId: string): Promise<readonly AgentMessage[]> {
    const log = manager.driverOf(sessionId)?.session ?? options.runtime.persistence.loadSession(sessionId).log;
    const events = log.events();
    return reseedTimeline(deriveMessages(events), (seq) => events[seq]?.time ?? 0);
  }

  // 退出序接线：closer 注册序即 drain 序——先拆驱动（打断在飞 run）再排空压缩链
  options.runtime.registerCloser({ label: 'conversation-manager', fn: () => manager.dispose() });
  options.runtime.registerCloser({
    label: 'compaction-drain',
    fn: () => compaction.drain(),
  });

  return {
    manager,
    channels,
    llm,
    scope,
    dispatch,
    model,
    projectionOf,
    driverOf: (sessionId) => manager.driverOf(sessionId),
    submitText(sessionId, text, submitOptions) {
      const driver = manager.driverOf(sessionId);
      if (driver === undefined) return undefined; // 未开会话——上层提交序不达（理论不达防御位）
      const run = driver.submit(text, submitOptions);
      // 回执面错误经 notify 回流呈现面（fire-and-forget 无未处理拒绝；await 方仍得真回执）
      void run.catch((err: unknown) => {
        channels.notify(sessionId, `提交失败：${err instanceof Error ? err.message : String(err)}`, {
          level: 'error',
        });
      });
      return run;
    },
    interrupt(sessionId) {
      manager.driverOf(sessionId)?.abort();
    },
    openStartupSession(cwd?: string): StartupSession {
      const workspaceRoot = canonicalWorkspaceRoot(cwd);
      // 按 cwd 归一根取最新会话（会话表 workspace_root 选取键——07 §5 策略真源）
      const [latest] = manager.list({ workspaceRoot, limit: 1 });
      if (latest !== undefined) {
        const opened = manager.open(latest.id);
        return { ...opened, resumed: true, workspaceRoot };
      }
      const created = manager.create({ workspaceRoot });
      return { ...created, resumed: false, workspaceRoot };
    },
  };
}
