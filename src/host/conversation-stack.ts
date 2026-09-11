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
import {
  createCompactionService,
  createCompactionSlots,
  createCcrRetrieveTool,
  BEFORE_COMPACT_ATTRIB,
} from '../compaction/index.js';
import type {
  BeforeCompactAttribution,
  BeforeCompactResult,
  CompactionService,
  CompactionSlotsHandle,
  SessionBeforeCompactInput,
} from '../compaction/index.js';
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
  ControlCaller,
  ControlUsedRecord,
  DriverFactory,
  RunSettledReceipt,
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
  /**
   * lane 帽容量显式覆盖位（04 §4 宿主级 run 并发帽——channels 消息语义批
   * m-2）：优先于 env `BERRY_AGENT_MAX_CONCURRENT_RUNS` 与缺省 16（测试/
   * 装配覆盖用——与 model 覆盖序同形）。
   */
  readonly maxConcurrentRuns?: number;
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
  /**
   * goal 轮间沉淀取值器（批 #99——04 §3.7 complete 单发件供给）：驱动每请求
   * 组装时经 onTransformContext 取用、注入于 todo 快照之前（瞬态 UserMessage
   * 不落 durable）；返回 null = 零注入（goal 未装载/无 active goal）。
   */
  readonly goalDeposit?: (sessionId: string) => string | null;
  /**
   * 预算预警取值器（04 §5 软着陆层——遗漏审计批 H）：root/subagent 分族
   * 文案铸造归装配根（origin 判据 + llm 后台池投影——host/budget-advisory
   * 纯函数族）；驱动每请求组装时经 onTransformContext 取用注入瞬态层。
   * per-session 位在穿线时 sessionId 落格绑定（goalDeposit 同形）。
   * 缺席/返回 null = 零注入（前台会话无池可警同形）。
   */
  readonly budgetAdvisory?: (sessionId: string) => string | null;
  /**
   * run 结算回执钩（批 #99——goal 前台记账腿三入口统一）：驱动 launch settled
   * 链内嵌发射（assistant/message 窗扫计数 + userInitiated 归因——04 §176
   * 记账单位），组合根闭包接 recordTurn；钩内异常驱动侧自防炸（warn 不炸收场）。
   */
  readonly onRunSettled?: (sessionId: string, receipt: RunSettledReceipt) => void;
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
   * 腿宿主注入位；开门制扩展批 2026-09-09 授予面接线）：getOpens = 模型道
   * 门检输入 = doors 段单独（装配根接活体读——插件道订阅走 plugin-context
   * 分立判定位不经本 seam）；onCapabilityUsed = 开门后逐次审计 seam（05 §1.1
   * ——装配根接 audit 单写者位；缺席 = 零审计）。
   */
  readonly observeCross?: {
    readonly getOpens: () => ReadonlySet<string>;
    readonly onCapabilityUsed?: (record: SessionObserveUsedRecord) => void;
  };
  /**
   * 跨会话操控门检接线（e-4 操控腿——03 §4.6 第六枚 sessions.control-cross
   * 双面同门；开门制扩展批 2026-09-09 授予面接线）：getOpensFor = caller
   * 感知合成取值器（03 §4.6 双源并集律——插件道 caller = doors 段 ∪ 该插件行
   * opens、模型道 caller = doors 段单独；受理器门检位逐次现读现判，撤位即
   * 收回）；onCapabilityUsed = 开门后逐次审计 seam（05 §1.1——装配根接 audit
   * 单写者位；缺席 = 零审计）。受理器真身经 ConversationStack.sessionsControl
   * 读面外露（plugin-boot fork 绑定位消费——与工具族同一实例，双面同源）。
   */
  readonly controlCross?: {
    readonly getOpensFor: (caller: ControlCaller) => ReadonlySet<string>;
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
  /**
   * 压缩席位容器（U4-3——03 §2.2 第十二面 ctx.get("compaction") 消费面的
   * 服务真源）：plugin-boot fork 绑定位消费（bindForPlugin 逐插件面 + 卸载
   * 回收 releaseFor）；容器与服务面三 seam 同源（getConfig/getProvider/
   * onBeforeCompact 在栈内接线）。
   */
  readonly compactionSlots: CompactionSlotsHandle;
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
  // lane 帽（04 §4 宿主级 run 并发帽——channels 消息语义批 m-2）：全宿主
  // 单例信号量，driver 装配位 seam 注入（acquireRunSlot——kick 同步试位/
  // 排队段两面消费；steer/inject 腿不经闸）。容量解析序：显式覆盖位 > env > 缺省 16。
  const runLane = createRunLaneGate(resolveRunLaneCapacity(options.maxConcurrentRuns, options.env ?? process.env));
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
  // U4-3 三 seam 容器位：席位容器（getConfig/getProvider 晚绑定——plugin-boot
  // fork 绑定装载面）+ 接管缝派发包装（waterfall + 归因箱种子/读末位）。
  // 注：options.compaction 注入覆盖时席位容器仍外露（绑定面照常可达）——注入
  // 替身不走 seam，容器位对其无效果（测试覆盖语义）。
  const compactionSlots = createCompactionSlots();
  const dispatchBeforeCompact = async (input: SessionBeforeCompactInput): Promise<BeforeCompactResult> => {
    // 零监听器直通（boot 未跑/词未注册形——waterfall 面词缺席即拒，守卫免炸）
    if (!dispatch.isRegistered('session_before_compact')) return { value: input };
    // 归因箱种子：symbol 键随值链 spread 传播（改写必新建对象律）——plugin-context
    // 钩子包装层逐跳记名（mark）/铸造（forge），出口读末位改写者
    const box: BeforeCompactAttribution = {};
    const seeded = Object.assign({}, input, { [BEFORE_COMPACT_ATTRIB]: box });
    const value = await dispatch.waterfall<SessionBeforeCompactInput>('session_before_compact', seeded);
    return box.lastAdjustedBy === undefined ? { value } : { value, lastAdjustedBy: box.lastAdjustedBy };
  };
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
      getConfig: compactionSlots.getConfig,
      getProvider: compactionSlots.getProvider,
      onBeforeCompact: dispatchBeforeCompact,
      warn,
    });

  // ④ channels 通道核（投影源在⑤驱动登记之后才被调用——闭包前向引用安全）
  const channels = createChannels<AgentMessage>({
    fetchProjection: (sessionId) => Promise.resolve(projectionOf(sessionId)),
    history: (sessionId) => Promise.resolve(projectionOf(sessionId)),
    // /memory 注册位（06 §7——mm 批）：库座在位即注册（persistence 在场 ⇒
    // memory 件将装载；件缺席形由命令 handler 的 notify 降级提示诚实兜底）
    memory: true,
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
  // in-process 子代理工厂消费位：系统提示覆盖、派生面白名单整形、审批升父面；
  // extraTools = 会话维追加工具面（成熟度缺口 #5——issue 起会腿消费位：件注册
  // 的只读工具面经 open 域管道注册位并入，真三段管道零旁路）
  const createDriver: DriverFactory = ({
    session,
    model: sessionModel,
    systemPrompt,
    shapeTools,
    askApproval,
    extraTools,
  }) => {
    const sessionId = session.sessionId;
    // 审批桥：driver 与 open 域工具共用同一 per-session ask 面（07 §4.3 提问队列）；
    // 工厂注入覆盖在场时胜出（委派边界①——子会话审批落父会话呈现面，04 §10）
    const askFace =
      askApproval ??
      ((request: ApprovalAskRequest, opts?: { signal?: AbortSignal }) =>
        channels.askApproval(sessionId, request, opts));
    let tools: readonly AgentTool[] | undefined;
    let settleApprovals: (() => void) | undefined;
    // 工具归因取值器（T9 案一批 t-1——tool/call 载荷 owner 位）：assembly
    // 在场时从会话注册表构造（listFor 两层并集 live 查询——覆盖装配后动态
    // 注册）；memory 形（无工具面）保持 undefined——纯对话 run 无 tool/call
    let resolveToolOwner: ((name: string) => string | undefined) | undefined;
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
      // observeCross seam——装配已接 doors 段活体真源 + capability/used
      // 审计〔assembly；缺席形 ?? 空集 = 测试/未装配兜底〕）
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
        // 时点装配已完成）；门态 = 与门检同吃 caller 感知合成源（开门制扩展批
        // ——本会话即模型道 caller：观测门 doors 段单独、操控门 getOpensFor
        // session caller 形；reason 与执行时拒绝 message 同源——先查后用）
        env: {
          listTools: () => (tools ?? []).map((entry) => ({ name: entry.name })),
          doorStates: () => {
            const opens = options.observeCross?.getOpens() ?? new Set<string>();
            const verdict = adjudicateCapabilityDoor(opens, OBSERVE_CROSS_CAPABILITY);
            const controlVerdict = adjudicateCapabilityDoor(
              options.controlCross?.getOpensFor({ kind: 'session', sessionId }) ?? new Set<string>(),
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
        // 操控三件同位并入（e-4——恒挂载，门检在受理器内执法）；
        // ccr_retrieve 同位并入（05 §2.1 压缩可逆性——恒挂载：压缩归档原文
        // 回取面，turn 1 起在场永不摘除；memory 形随工具整面缺席）；
        // extraTools 会话维追加位（缺口 #5——issue 工具面经管道注册并入，
        // boot 全局层之后、会话族之前：宿主全局面 → 本会话编排面 → 观测族）
        extraTools: () => [
          ...(options.bootTools?.() ?? []),
          ...(extraTools?.() ?? []),
          ...sessionTools,
          ...createControlTools({ callerSessionId: sessionId, control: sessionsControl }),
          ...createCcrRetrieveTool({ events: () => session.events() }),
        ],
        ...(goalTodo !== undefined ? { todoTool: goalTodo } : {}),
        sensitiveValues, // 出口消毒值基腿（栈级单闭包——多会话装配共享，live 读）
      });
      options.runtime.registerDisposer(assembly.dispose); // LIFO 拆解进运行时退出序
      // 整形钩子（批 19c-1）：装配产物进驱动前整形（语义归调用方——子代理
      // 派生面执法；fullTools 快照即整形后面——孙代委派以子实面为基准）
      tools = shapeTools !== undefined ? [...shapeTools(assembly.tools)] : assembly.tools;
      // owner 取数闭包：装配产物 registry 即会话注册表——宿主直构件已盖
      // 'core:host'、extraTools 重放的插件定义携插件 id owner，listFor 全量
      // 可查（live 形——named provider 程序化注册等后续注册天然覆盖）
      resolveToolOwner = (name) => assembly.registry.listFor(sessionId).find((def) => def.name === name)?.owner;
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
      // tool/call 载荷 owner 位取数（T9 案一批 t-1——memory 形 undefined 不带）
      ...(resolveToolOwner !== undefined ? { resolveToolOwner } : {}),
      // lane 帽取位器（04 §4——channels 消息语义批 m-2）：followUp 起跑前
      // 取位、run 终态释放；排队不计在飞（冷读闸 M1 裁决）。栈级单 gate
      // 全会话共享——「宿主级」并发数的真源。
      acquireRunSlot: runLane,
      ...(options.thinkingLevel !== undefined ? { thinkingLevel: options.thinkingLevel } : {}),
      // per-session 覆盖 ?? 栈基线（open/resume 不携带——回落基线同 model 律）
      ...((systemPrompt ?? options.systemPrompt) !== undefined
        ? { systemPrompt: systemPrompt ?? options.systemPrompt }
        : {}),
      ...(options.pluginSections !== undefined ? { pluginSections: options.pluginSections } : {}),
      // goal 段升格锚穿线（批 19c-3——驱动 fold 升格消费位 driver.ts）
      ...(options.goalScopeFor !== undefined ? { goalScopeFor: options.goalScopeFor } : {}),
      // goal 轮间沉淀 + 记账回执穿线（批 #99——sessionId 位在此落格绑定）
      ...(options.goalDeposit !== undefined ? { goalDeposit: () => options.goalDeposit!(sessionId) } : {}),
      // 预算预警穿线（批 H——04 §5 软着陆层）：sessionId 落格绑定同 goalDeposit 形
      ...(options.budgetAdvisory !== undefined ? { budgetAdvisory: () => options.budgetAdvisory!(sessionId) } : {}),
      ...(options.onRunSettled !== undefined
        ? { onRunSettled: (receipt) => options.onRunSettled!(sessionId, receipt) }
        : {}),
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
  // 同一实例。门检 caller 感知合成 + 审计经 controlCross seam（开门制扩展批
  // ——装配根接 doors 段 ∪ 行 opens 双源，模型道 doors 段单独）
  const sessionsControl = createSessionsControl({
    manager,
    getOpensFor: (caller) => options.controlCross?.getOpensFor(caller) ?? new Set<string>(),
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
    compactionSlots,
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

/**
 * lane 帽缺省容量（04 §4——码面缺省参数非契约常数，观测证据可再裁；
 * 对齐常见 LLM 供应商并发档量级）。
 */
export const DEFAULT_RUN_LANE_CAPACITY = 16;

/**
 * lane 帽容量解析（04 §4 宿主级 run 并发帽——channels 消息语义批 m-2）：
 * 解析序 = 显式覆盖位 > env `BERRY_AGENT_MAX_CONCURRENT_RUNS` > 缺省 16。
 * 非正整数 fail-loud 拒（RangeError）——空帽/坏帽是死配置（queue capacity
 * 同律）。
 */
export function resolveRunLaneCapacity(override: number | undefined, env: Record<string, string | undefined>): number {
  const raw = override ?? env['BERRY_AGENT_MAX_CONCURRENT_RUNS'];
  if (raw === undefined) return DEFAULT_RUN_LANE_CAPACITY;
  // 字串形全串 /^\d+$/ 判——parseInt 截停会把 '16x'/'16.5'/'0x10'/'+16'/' 16' 类
  // 尾随垃圾静默放行成 16，与「空帽/坏帽是死配置」的 fail-loud 自述相悖
  let value: number;
  if (typeof raw === 'number') {
    value = raw;
  } else if (/^\d+$/.test(raw)) {
    value = Number.parseInt(raw, 10);
  } else {
    value = Number.NaN;
  }
  if (!Number.isInteger(value) || value < 1) {
    throw new RangeError(
      `lane 帽容量须为正整数，收到 ${String(raw)}——空帽/坏帽是死配置（BERRY_AGENT_MAX_CONCURRENT_RUNS / maxConcurrentRuns）`,
    );
  }
  return value;
}

/** 宿主级 run 并发闸（04 §4 lane 帽）：计数信号量 + FIFO 等位队列 */
export interface RunLaneGate {
  /**
   * 同步试位（04 §4——受理即落账的同步段保持）：帽内有空位即取并返释放器；
   * 帽满返 undefined。不变量：等位队列非空 ⟺ 帽满（释放即 FIFO 补位）——
   * 试位成功时必无排队者，公平性不破。
   */
  tryAcquire(): (() => void) | undefined;
  /** 取位（帽内有空位即 resolve 释放器；帽满挂起排 FIFO——背压不拒服务） */
  acquire(): Promise<() => void>;
  /** 在飞计数（诊断/测试面） */
  readonly inFlight: number;
  /** 排队计数（诊断/测试面——logger 观测位，v1 不立事件词） */
  readonly queued: number;
}

/**
 * 造宿主级 run 并发闸（04 §4——排队非拒收：帽满排队 FIFO、释放依序续跑；
 * openclaw CommandLane 先例的宿主级对位）。lane 队列是内存态：退出 drain
 * 不等待排队件（与 PendingMessageQueue 崩溃即丢同语义——04 §1）。释放器
 * 幂等（双调安全——driver kick 的 finally 腿防御）。
 */
export function createRunLaneGate(capacity: number): RunLaneGate {
  if (!Number.isInteger(capacity) || capacity < 1) {
    throw new RangeError(`lane 帽容量须为正整数，收到 ${capacity}——空帽是死配置`);
  }
  let inFlight = 0;
  /** FIFO 等位队列（帽满时的挂起取位——resolve 载释放器） */
  const waiting: Array<(release: () => void) => void> = [];

  /** 释放在飞位；有等位者则依 FIFO 直接移交（等位者即刻在飞——无缝续跑） */
  const releaseSlot = (): void => {
    inFlight -= 1;
    const next = waiting.shift();
    if (next === undefined) return;
    inFlight += 1;
    next(makeRelease());
  };

  /** 造幂等释放器（每次取位独立一枚——双调只是无操作，不双扣在飞位） */
  const makeRelease = (): (() => void) => {
    let used = false;
    return () => {
      if (used) return;
      used = true;
      releaseSlot();
    };
  };

  return {
    tryAcquire(): (() => void) | undefined {
      if (inFlight >= capacity) return undefined;
      inFlight += 1;
      return makeRelease();
    },
    acquire(): Promise<() => void> {
      return new Promise((resolve) => {
        if (inFlight < capacity) {
          inFlight += 1;
          resolve(makeRelease());
          return;
        }
        waiting.push(resolve);
      });
    },
    get inFlight(): number {
      return inFlight;
    },
    get queued(): number {
      return waiting.length;
    },
  };
}
