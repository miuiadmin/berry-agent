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
 *     （05 §2 装配挂账 + 判阈双源真值笔全兑现——run 终态从日志末条
 *     assistant 计量供笔〔lastUsageFactOf，末条不回溯〕，真 token 主判、
 *     缺真值回落投影字符估算）；
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
import type { AgentMessage, AgentTool, ApprovalAskRequest, ThinkingLevel, ToolDefinition } from '../contracts/index.js';
import { getMessageRoleDefinition, isStandardMessage } from '../contracts/index.js';
import { createCompactionService } from '../compaction/index.js';
import type { CompactionService } from '../compaction/index.js';
import {
  assembleOpenTools,
  ConversationDriver,
  createSessionsControl,
  createControlTools,
  CONTROL_CROSS_CAPABILITY,
  DEFAULT_RETRY_POLICY,
  ensureTodoRole,
  provideAgentService,
  reseedTimeline,
  SessionManager,
} from '../conversation/index.js';
import type {
  ControlUsedRecord,
  DriverFactory,
  SubmitOptions,
  SubmitResult,
  SessionsControlFace,
} from '../conversation/index.js';
import type { UserMessage } from '../contracts/index.js';
import {
  classifyError,
  createLlmRuntime,
  createLlmService,
  createStreamFn,
  InFlightTracker,
  resolveDefaultModelSpec,
} from '../llm/index.js';
import type { LlmRuntime, LlmService, Provider } from '../llm/index.js';
import type { AllowlistDraft, AllowlistEntry, SandboxMode } from '../safety/index.js';
import { deriveMessages } from '../session/index.js';
import type { SessionLog } from '../session/index.js';

import type { HostRuntime } from './runtime.js';
import type { GoalFace } from './core-plugins.js';
import { createSessionTools, createSessionView, OBSERVE_CROSS_CAPABILITY } from '../obs/index.js';
import type { SessionObserveUsedRecord, SessionView } from '../obs/index.js';
import { adjudicateCapabilityDoor } from '../contracts/api.js';

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
  /** 工作区锚取值器（缺省 canonicalWorkspaceRoot——git 根回退字面 cwd；批 12f-4 注入面与 sandboxMode 同形态，e2e 隔离位） */
  readonly workspace?: () => string;
  /** 系统提示词基线（04 §11：披露段由驱动在 transformContext 关口另行追加） */
  readonly systemPrompt?: string;
  /** 装载工具定义取值器（批 19a 消费腿：boot 全局层定义快照——每会话装配时调用；闭包晚绑定：装配根 stack 先建、boot 后跑，会话首开时 boot 已定型） */
  readonly bootTools?: () => readonly ToolDefinition[];
  /** 插件提示词段物化取值器（批 19a 消费腿：PromptSectionRegistry.materialize 的闭包——每请求组装时重取，注册即生效面；空串 = 零段） */
  readonly pluginSections?: () => string;
  /** 思考档位（会话态） */
  readonly thinkingLevel?: ThinkingLevel;
  /**
   * goal 段升格锚（批 19c-3——03 §10.5 chat↔goal 数据通道组合根闭包注入）：
   * 返 {goalId, activatedSeq} = 该会话 goal active，todo fold 边界升格
   * goal 生命周期段；缺席/返 undefined = fold 退化 run-scoped 现行为。
   * 双消费位：驱动 fold 升格（goalScopeFor seam）+ goal 件 todo 换装
   * getScope 判据面。
   */
  readonly goalScopeFor?: (sessionId: string) => { goalId: string; activatedSeq: number } | undefined;
  /** 跨会话 allowlist 条目（04 §9 粘性第 3 款 advisory 免问面；装配层读 allowlist.json 载入——缺省功能关闭） */
  readonly allowlist?: readonly AllowlistEntry[];
  /** 「始终允许」条目写入回调（04 §9 粘性段定形③——装配层接 allowlist-store 文件写；缺省 always 面关闭） */
  readonly persistAllowlist?: (draft: AllowlistDraft) => void;
  /**
   * compaction 服务注入位（缺省内部组装真身——SummaryChannel 适配 + 缺省配置；
   * 测试注入计量替身观察阈值触发入参，未来装配覆盖位与 providers/model 同形）
   */
  readonly compaction?: CompactionService;
  /**
   * 跨树观测门检接线（e-2 观测腿——03 §4.6 第五枚 sessions.observe-cross 工具
   * 腿宿主注入位）：getOpens = 开门授予集取值器（v1 装配根注空集——会话→插件
   * 归因未立，授予面接线挂账 e-4 provenance 落地时呈拍）；onCapabilityUsed =
   * 开门后逐次审计 seam（05 §1.1——装配根接 audit 单写者位；缺席 = 零审计）。
   */
  readonly observeCross?: {
    readonly getOpens: () => ReadonlySet<string>;
    readonly onCapabilityUsed?: (record: SessionObserveUsedRecord) => void;
  };
  /**
   * 跨会话操控门检接线（e-4 操控腿——03 §4.6 第六枚 sessions.control-cross
   * 双面同门）：getOpens = 开门授予集取值器（v1 装配根注空集——结构性默认
   * 关，授予面呈拍随 e-4 收官报告与 e-5 题 9 一起呈）；onCapabilityUsed =
   * 开门后逐次审计 seam（05 §1.1——装配根接 audit 单写者位；缺席 = 零审计）。
   * 受理器真身经 ConversationStack.sessionsControl 读面外露（plugin-boot fork
   * 绑定位消费——与工具族同一实例，双面同源）。
   */
  readonly controlCross?: {
    readonly getOpens: () => ReadonlySet<string>;
    readonly onCapabilityUsed?: (record: ControlUsedRecord) => void;
  };
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
  /** llm 运行时出口（provider 注册面——与 llm 服务同源同实例，防双实例；插件装载批接线位） */
  readonly llmRuntime: LlmRuntime;
  readonly scope: Scope;
  readonly dispatch: EventDispatch;
  readonly model: string;
  /**
   * 会话维视图（e-2 观测腿——SessionView 纯派生读面）：装配根消费位 =
   * 插件订阅 tree 档过滤（sessionLineage 注入 plugin-boot）。工具族装配在
   * 栈内 per-session 闭包（不经本面）。
   */
  readonly sessionView: SessionView;
  /**
   * 跨会话操控受理器真身（e-4 操控腿——双面同源单源位）：栈内工具族闭包
   * 直接引用（不经本面）；本读面外露给装配根 → plugin-boot 逐插件 fork
   * 绑定（sessions-control 服务面，caller 闭包铸造防冒名）。
   */
  readonly sessionsControl: SessionsControlFace;
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
  const workspaceAnchor = options.workspace ?? (() => canonicalWorkspaceRoot());

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
  // 订阅 → handleRunSettled（真 token 笔从日志末条 assistant 计量供笔——见
  // lastUsageFactOf；注入位在则为测试替身/装配覆盖）。
  const compaction: CompactionService =
    options.compaction ??
    createCompactionService({
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

  // ④½ 会话维视图（e-2 观测腿——SessionView 纯派生读面）：数据三窄面全结构
  // 兼容直传（store.queryEvents/getSessionRow + manager.listActive 投影——前向
  // 闭包同 channels 律，首会话起跑时 manager 必已建）；消费位两会话工具族
  // （durable 形 per-session 闭包）+ 装配根 sessionLineage（订阅 tree 档过滤）
  const sessionStore = options.runtime.persistence.store;
  const sessionView = createSessionView({
    events: sessionStore,
    sessions: sessionStore,
    liveSessions: { listActive: () => manager.listActive() },
    workspaceRoot: workspaceAnchor,
  });

  // ④' 出口治理③ 值基腿活值 provider（04 §7 执行段 2026-09-08 落码定形⑤）：
  // credentials 库 live 读——管道链尾消毒步每次调用现取（工具执行期间新入库
  // 凭证同受覆盖）。单行解密失败跳过不连坐（其余行照常参与——行级隔离）；
  // 库整体故障抛给管道侧 catch 降级纯模式腿（降级诚实）。长度 ≥8 过滤在
  // redactKnownSecretValues 内执法（短值误伤普通文本的灾难面控制）。
  const sensitiveValues = (): string[] => {
    const values: string[] = [];
    for (const row of options.runtime.persistence.store.listCredentialProviders()) {
      try {
        const entry = options.runtime.persistence.store.getCredential(row.namespace, row.provider);
        if (entry !== undefined && entry.apiKey.length > 0) values.push(entry.apiKey);
      } catch {
        /* 单行坏（解密不匹配等）跳过——消毒面按行降级，不炸 provider */
      }
    }
    return values;
  };

  // ⑤ SessionManager：DriverFactory 装配注入族全接线（model = per-fresh-session
  // 覆盖 ?? 栈缺省——create init.model 透传位，触发器 starter 载体，C 批 C-3；
  // systemPrompt/shapeTools/askApproval = 批 19c-1 per-session 装配覆盖通道——
  // in-process 子代理工厂消费位：系统提示覆盖、派生面白名单整形、审批升父面）
  const createDriver: DriverFactory = ({ session, model: sessionModel, systemPrompt, shapeTools, askApproval }) => {
    const sessionId = session.sessionId;
    // 审批桥：driver 与 open 域工具共用同一 per-session ask 面（07 §4.3 提问队列）；
    // 工厂注入覆盖在场时胜出（委派边界①——子会话审批落父会话呈现面，04 §10）
    const askFace =
      askApproval ??
      ((request: ApprovalAskRequest, opts?: { signal?: AbortSignal }) =>
        channels.askApproval(sessionId, request, opts));
    let tools: readonly AgentTool[] | undefined;
    let settleApprovals: (() => void) | undefined;
    if (options.runtime.dataDir !== null) {
      // goal 段换装（批 19c-3——03 §10.5）：goal 件在场 + 锚注入在位 →
      // per-session 扩展 todo 工具替换内置件（openTools todoTool 注入位——
      // 词面独立律 conversation 域零 goal 知识；未装载/锚缺席 = 内置件）
      const goalFace = scope.tryGet<GoalFace>('goal');
      const goalTodo =
        goalFace !== undefined && options.goalScopeFor !== undefined
          ? goalFace.todoFactory({
              append: (data) => session.append('todo/write', data),
              getScope: () => options.goalScopeFor?.(sessionId) ?? null,
            })
          : undefined;
      // 会话维工具族（e-2 观测腿——03 §10.8 恒挂载四件；per-session 闭包
      // callerSessionId 注入〔todoTool 换装 seam 同构〕；跨树门检输入经
      // observeCross seam——v1 空集 = 结构性默认关〔归因接线挂账 e-4〕）
      const sessionTools = createSessionTools({
        view: sessionView,
        callerSessionId: sessionId,
        getOpens: () => options.observeCross?.getOpens() ?? new Set<string>(),
        ...(options.observeCross?.onCapabilityUsed !== undefined
          ? { onCapabilityUsed: options.observeCross.onCapabilityUsed }
          : {}),
        // e-3 环境自感窄面（03 §10.8 session_status 并入注）：工具清单 =
        // 本会话整形后面（shapeTools 白名单后的可见面——子代理派生面自省
        // 即其子实面，04 §10「孙代委派以子实面为基准」同律；lazy 读，execute
        // 时点装配已完成）；门态 = 观测门经同一门检裁决（reason 与执行时拒
        // 绝 message 同源——先查后用）；操控门随 e-4 落位同 getter 扩
        env: {
          listTools: () => (tools ?? []).map((entry) => ({ name: entry.name })),
          doorStates: () => {
            const opens = options.observeCross?.getOpens() ?? new Set<string>();
            const verdict = adjudicateCapabilityDoor(opens, OBSERVE_CROSS_CAPABILITY);
            const controlVerdict = adjudicateCapabilityDoor(
              options.controlCross?.getOpens() ?? new Set<string>(),
              CONTROL_CROSS_CAPABILITY,
            );
            return [
              {
                capability: OBSERVE_CROSS_CAPABILITY,
                open: verdict.ok,
                ...(verdict.ok ? {} : { reason: verdict.message }),
                scope: '跨树会话枚举与读取（session_list/session_read/session_trace 跨树目标）',
              },
              {
                capability: CONTROL_CROSS_CAPABILITY,
                open: controlVerdict.ok,
                ...(controlVerdict.ok ? {} : { reason: controlVerdict.message }),
                scope: '跨会话操控三动词（session_send/session_interrupt/session_withdraw——全域同门无树内豁免）',
              },
            ];
          },
        },
      });
      const assembly = assembleOpenTools({
        sessionId,
        dispatch,
        session,
        scope,
        mode: sandboxMode,
        dataDir: options.runtime.dataDir,
        workspace: workspaceAnchor,
        askApproval: askFace,
        ...(options.allowlist !== undefined ? { allowlist: options.allowlist } : {}),
        ...(options.persistAllowlist !== undefined ? { persistAllowlist: options.persistAllowlist } : {}),
        // 会话维工具族并入扩展位（bootTools 同位——模型可见清单恒在律）；
        // 操控三件同位并入（e-4——恒挂载，门检在受理器内执法）
        extraTools: () => [
          ...(options.bootTools?.() ?? []),
          ...sessionTools,
          ...createControlTools({ callerSessionId: sessionId, control: sessionsControl }),
        ],
        ...(goalTodo !== undefined ? { todoTool: goalTodo } : {}),
        sensitiveValues, // 出口消毒值基腿（栈级单闭包——多会话装配共享，live 读）
      });
      options.runtime.registerDisposer(assembly.dispose); // LIFO 拆解进运行时退出序
      // 整形钩子（批 19c-1）：装配产物进驱动前整形（语义归调用方——子代理
      // 派生面执法；fullTools 快照即整形后面——孙代委派以子实面为基准）
      tools = shapeTools !== undefined ? [...shapeTools(assembly.tools)] : assembly.tools;
      settleApprovals = assembly.settlePending;
    } // memory 形：工具整面缺席——纯对话 run（件头注降级语义）
    const driver = new ConversationDriver({
      session,
      scope,
      dispatch,
      streamFn,
      convertToLlm: (message: AgentMessage) =>
        isStandardMessage(message) ? message : (getMessageRoleDefinition(message.role)?.toLlm?.(message) ?? null),
      model: sessionModel ?? model,
      ...(tools !== undefined ? { tools } : {}),
      ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
      // per-session 覆盖 ?? 栈基线（open/resume 不携带——回落基线同 model 律）
      ...((systemPrompt ?? options.systemPrompt) !== undefined
        ? { systemPrompt: systemPrompt ?? options.systemPrompt }
        : {}),
      ...(options.pluginSections !== undefined ? { pluginSections: options.pluginSections } : {}),
      // goal 段升格锚穿线（批 19c-3——驱动 fold 升格消费位 driver.ts）
      ...(options.goalScopeFor !== undefined ? { goalScopeFor: options.goalScopeFor } : {}),
      classifyError,
      compactForOverflow: (log: SessionLog) => compaction.compactForOverflow(log),
      environmentDisclosure: options.runtime.disclosure,
      askApproval: askFace,
      ...(settleApprovals !== undefined ? { settleApprovals } : {}),
      warn,
      onEvent: (event) => channels.emit({ sessionId, event }),
      retry: DEFAULT_RETRY_POLICY,
    });
    return driver;
  };
  const manager = new SessionManager({ persistence: options.runtime.persistence, dispatch, createDriver });

  // 操控受理器（e-4——03 §2.2 第十一面双面同源单源实现位）：栈级单例——
  // 工具族（模型道 per-session 闭包）与 plugin-boot fork 绑定（插件道）消费
  // 同一实例。门检/审计经 controlCross seam（v1 装配根注空集 = 结构性默认关）
  const sessionsControl = createSessionsControl({
    manager,
    getOpens: () => options.controlCross?.getOpens() ?? new Set<string>(),
    ...(options.controlCross?.onCapabilityUsed !== undefined
      ? { onCapabilityUsed: options.controlCross.onCapabilityUsed }
      : {}),
  });

  // 阈值触发器：run 终态 → 该会话日志入阈值判定（fire-and-forget）。判阈双源
  // 的真 token 主判在此供笔（lastUsageFactOf——日志末条 assistant 计量）；零计量
  // 不携带 → 服务侧回落投影字符估算（estimate 兜底档）
  agentService.onRunSettled((event) => {
    const driver = manager.driverOf(event.sessionId);
    if (driver !== undefined) compaction.handleRunSettled({ log: driver.session, ...lastUsageFactOf(driver.session) });
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
    llmRuntime,
    scope,
    dispatch,
    model,
    sessionView,
    sessionsControl,
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

/**
 * 末次真计量笔（05 §2.1 判阈双源「真 token 主判」的供笔侧）：取日志**末条**
 * assistant/message 事件的计量快照（provider 报数随落账原样在场——05 §1.1）。
 *
 * 取值律：
 * - 只看末条不回溯——上一轮的 input 是上一形态的真值、不是本轮的，回溯即拿
 *   旧值冒充新真值（真值可用时不猜，真值缺席就明说缺席）；
 * - 零值/坏形（中止早退、脚本零报形）= 无真值：返回不携带，调用方回落投影
 *   字符估算（chars/4——estimate 兜底档语义在此保底而非在服务侧猜测）；
 * - contextWindow 不供（栈面只有模型 id 无目录查询）——分母归服务侧
 *   fallbackWindowTokens 缺省，与估算档同分母。
 */
export function lastUsageFactOf(log: SessionLog): { usage?: { input: number } } {
  const events = log.events();
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]!;
    if (event.type !== 'assistant/message') continue;
    const data = event.data as { usage?: unknown } | null;
    const usage = typeof data === 'object' && data !== null ? data.usage : undefined;
    if (
      typeof usage === 'object' &&
      usage !== null &&
      typeof (usage as { input?: unknown }).input === 'number' &&
      (usage as { input: number }).input > 0
    ) {
      return { usage: { input: (usage as { input: number }).input } };
    }
    return {}; // 末条已见而无可信计量——无真值不猜（不回溯）
  }
  return {}; // 无 assistant 事件（空 run/纯消费防御路径）
}
