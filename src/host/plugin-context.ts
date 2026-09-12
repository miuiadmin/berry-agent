/**
 * host/plugin-context — 插件上下文装配件（03 §2.1/§2.2/§2.4/§3.1/§3.4/§8.5；批 12f-2a）。
 *
 * 一件三面：
 *  - **ctx 十路注册动词 + 三动词 + provide**（§2.2/§3.1）：tools.register（拒绝式）/ channels.
 *    registerCommand（后写胜出）/ channels.registerUiBackend（拒绝式·门检前置
 *    ——第十三动词，U3 批 U3-4：channels.ui-backend 开门制先于撞名律，分域
 *    执法在 ChannelsService）/ llm.registerProvider（后写胜出 upsert）/ events.
 *    registerSessionEventType（拒绝式·不可逆）/ agent.registerMessageRole（拒绝式）/
 *    agent.registerSubagentProvider（拒绝式——第十二动词，D 批 D-2：执法序与
 *    owner 分域在 SubagentService）/ prompts.
 *    registerSection（拒绝式——本件 prompt-sections）/ triggers.register（拒绝式
 *    ·门检三闸——本件 triggers，C 批 C-2）/ ctx.on（fail-closed）/ ctx.emit +
 *    ctx.get·tryGet·effect + ctx.provide（§2.2 表行——委派共享根作用域，Kahn 解锁动词）
 *    ——逐动词冲突律真源 03 §2.7（本件只执法窗口与频率，撞名执法归各真源注册表）。
 *  - **装载窗口律**（§2.1）：注册动词只在 apply 执行期间合法；窗口外抛
 *    `PLUGIN_WINDOW_CLOSED`。唯一例外 = 宿主回调上下文内（钩子 handler/工具执行期
 *    ——§2.4 主表注记「钩子内注册面变更同注册即生效」的钩子豁免条款），判定形 =
 *    回调窗重入计数（enterHostCallback 开合）。get/tryGet/host 免窗——读面不设限。
 *  - **频率护栏 + 钩子消费点 5s 时钟**（§3.4 遗漏审计批三项挂账之余二）：单插件
 *    注册/事件动作滑动窗 1000ms 内 >1000 次即拒（`PLUGIN_RATE_LIMITED`——计数位 =
 *    注册动词 + ctx.on + ctx.emit + ctx.effect）；钩子 handler 包 5s 竞速钟（超时上报
 *    onHookTimeout——notify 腿超时放行收口不悬挂、waterfall 腿超时按管线失败传播）。
 *
 * 装配关系：装载器（loader.ts）createContext 注入位消费本件——apply 前 create、
 * apply 收口后 closeWindow；钩子词汇 registerEventNames 预注册归装配批（12f-2b），
 * 本件只按主表路由不注册词。
 *
 * 挂账注记（消费面未齐暂缓，随各自消费腿定形）：registerRenderer（07 §4.1
 * 渲染签名未钉——随 TUI/SPA 消费腿）；ctx.sessions/ctx.host 动词包装
 * （§4.4/§4.5——随 core:memory 消费腿）；tools 管道 waterfall 派发位（pipeline.ts
 * 归 tools 域——宿主发射位接线随装配批）。ctx.ui 七原语已随交互动词族批
 * ix-2 兑销（消费腿条款 07 §4.3——会话锚定档位表/钩子窗禁律/护栏增位）。
 */
import { BaseError, registerEventType, registerMessageRole } from '../contracts/index.js';
// internal 桶机制符号深导（门检裁决核——03 §4.6；开门是宿主裁决面非插件 API）
import { adjudicateCapabilityDoor } from '../contracts/api.js';
// 接管缝归因铸造两律（U4-3——compaction 公开面机制件；host→compaction 边在册）
import { forgeBeforeCompactIdentity, markBeforeCompactRewrite } from '../compaction/index.js';
import type {
  EventTypeMeta,
  HostFace,
  MessageRoleDefinition,
  NotifyLevel,
  ProgrammaticSubagentDef,
  ToolDefinition,
  UiAskOptions,
  UiBackend,
  UiInputOptions,
  UiSelectChoice,
} from '../contracts/index.js';
import type { LlmRuntime } from '../llm/index.js';
import type { CommandHandler } from '../channels/index.js';
import { AGENT_TOOL_PREFIX } from '../subagent/types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { Disposer, EventDispatch, Scope, WaterfallListener } from '../context/index.js';
import { SESSION_LIFECYCLE_EVENT } from '../conversation/index.js';
import type { SessionLifecycleEvent } from '../conversation/index.js';
import type { PromptSectionBuilder, PromptSectionRegisterOptions, PromptSectionRegistry } from './prompt-sections.js';
import type { TriggerDef } from './triggers.js';
import { readSessionAnchor, withoutSessionAnchor } from './session-anchor.js';

/** 钩子分派模式（03 §2.4——模式是钩子公开契约的一部分） */
export type HookMode = 'emit' | 'waterfall' | 'serial' | 'parallel';

/** 钩子主表条目（词汇 + 模式——41 词真源镜像，登记面在 03 §2.4 主表） */
export interface PluginHookSpec {
  readonly name: string;
  readonly mode: HookMode;
}

/**
 * 钩子主表词汇镜像（03 §2.4：七层 35 + 生命周期与刷新组 6 = 41 词）。
 * 词清单增删 = 规范主表先改再同步本表（词汇真源单点在规范；本表是 fail-closed
 * 执法面 PLUGIN_HOOK_UNKNOWN 的判据源）。
 */
export const PLUGIN_HOOK_VOCABULARY: readonly PluginHookSpec[] = [
  // session 层（7）
  { name: 'session/event', mode: 'emit' },
  { name: 'session_start', mode: 'emit' },
  { name: 'session_before_fork', mode: 'waterfall' },
  { name: 'session_before_compact', mode: 'waterfall' },
  { name: 'session_compact', mode: 'emit' },
  { name: 'session_flush', mode: 'serial' },
  { name: 'session_shutdown', mode: 'parallel' },
  // agent 层（6）
  { name: 'agent_before_start', mode: 'waterfall' },
  { name: 'agent_start', mode: 'emit' },
  { name: 'agent_pre_step', mode: 'waterfall' },
  { name: 'agent_request_error', mode: 'waterfall' },
  { name: 'agent_end', mode: 'emit' },
  { name: 'agent_idle', mode: 'emit' },
  // turn 层（3）
  { name: 'turn_start', mode: 'emit' },
  { name: 'turn_stopping', mode: 'serial' },
  { name: 'turn_end', mode: 'emit' },
  // message 层（5）
  { name: 'message_start', mode: 'emit' },
  { name: 'message_update', mode: 'emit' },
  { name: 'message_end', mode: 'waterfall' },
  { name: 'context_transform', mode: 'waterfall' },
  { name: 'user_input', mode: 'waterfall' },
  // tool 层（7）
  { name: 'tools_pre_execute', mode: 'waterfall' },
  { name: 'tools_execute', mode: 'waterfall' },
  { name: 'tools_post_execute', mode: 'waterfall' },
  { name: 'tool_execution_start', mode: 'emit' },
  { name: 'tool_execution_update', mode: 'emit' },
  { name: 'tool_execution_end', mode: 'emit' },
  { name: 'tools_change', mode: 'emit' },
  // provider 层（4）
  { name: 'provider_before_request', mode: 'waterfall' },
  { name: 'provider_before_headers', mode: 'waterfall' },
  { name: 'provider_after_response', mode: 'emit' },
  { name: 'model_select', mode: 'waterfall' },
  // 插件层（3）
  { name: 'resources_discover', mode: 'serial' },
  { name: 'project_trust', mode: 'waterfall' },
  { name: 'job_settled', mode: 'emit' },
  // 生命周期与刷新组（6——plugin/activated 三词主表同排一行，此处拆三条目）
  { name: 'plugin/activated', mode: 'emit' },
  { name: 'plugin/failed', mode: 'emit' },
  { name: 'plugin/skipped', mode: 'emit' },
  { name: 'composition/reloaded', mode: 'emit' },
  { name: 'prompts_change', mode: 'emit' },
  { name: 'skills_change', mode: 'emit' },
];

/** 钩子词汇查 mode（未知词返回 undefined——ctx.on fail-closed 判据） */
const HOOK_MODES: ReadonlyMap<string, HookMode> = new Map(PLUGIN_HOOK_VOCABULARY.map((h) => [h.name, h.mode]));

/** 钩子 handler 公开形（notify 腿〔emit/serial/parallel〕只读 data、next 为直通占位；waterfall 腿必调 next 委托——不调即短路，03 §2.4 分派四模式） */
export type PluginHookHandler = (data: unknown, next: (value: unknown) => Promise<unknown>) => unknown;

/**
 * 插件 ctx 面（apply 第一参——03 §2.2 十一路注册动词 + §3.1 三动词 + §8.5 host 自省）。
 * 读面（get/tryGet/host）免窗；注册动词受窗口律 + 频率护栏双闸。
 */
export interface PluginContext {
  /** 取服务（缺席 fail-loud——message 附现行服务目录名单，§3.1「服务目录运行时可枚举」） */
  get<T>(name: string): T;
  /** 可选消费（诚实缺席档——缺席返回 undefined） */
  tryGet<T>(name: string): T | undefined;
  /**
   * 服务目录注册（§3.1/§2.2 表行——装载器 Kahn 轮次的解锁动词：apply 期间落
   * 新服务、后续轮次自然解锁依赖方）。委派目标 = 共享根作用域（跨插件可见
   * 面——同批插件互见才可排装载序，04 §6 fork 语义）；撞名 = 撞名闸前置
   * （CONTEXT_SERVICE_DUPLICATE，§2.7 尾注）。无 un-provide——进程级单册
   * （§2.2 尾注明文例外；服务撤回面挂账 /reload 批）。
   */
  provide(name: string, service: unknown): void;
  /** 可逆注册（LIFO 回卷——计频率护栏动作数；§3.1 三动词消费面，不吃窗口闸） */
  effect(register: () => Disposer): void;
  /** 钩子订阅（fail-closed：词不在主表拒；按 mode 路由 on/onWaterfall；handler 包 5s 钟） */
  on(hookName: string, handler: PluginHookHandler): () => void;
  /** 活体事件发射（自域词 `${pluginId}/` 起头——自动注册一次；计频率护栏动作数） */
  emit(name: string, data?: unknown): Promise<void>;
  /** 工具面注册（拒绝式撞名执法在 ToolRegistry——本面只过窗/频率闸） */
  readonly tools: { register(def: ToolDefinition, opts?: { driver?: string }): Disposer };
  /** 命令面注册（后写胜出——执法在 CommandRegistry）+ 界面后端注册（门检前置） */
  readonly channels: {
    registerCommand(name: string, handler: CommandHandler, description?: string): Disposer;
    /**
     * 界面后端注册（第十三动词——U3 批 U3-4）：执法序 = 窗/频率 → 门检
     * （channels.ui-backend 高危面开门制〔03 §4.6〕**前置先于撞名律**——未开门
     * 插件连分域名单都探测不到，默认关语义的门检面兑现）→ 受局面委派（撞名/
     * 分域执法在 ChannelsService〔§2.7〕）→ capability/used 审计落账（05
     * §1.1）。插件实装形 = UiBackend<never>（投影泛型宿主钉入——插件后端走
     * 信封驱动呈现不参与投影重画）。
     */
    registerUiBackend(backend: UiBackend<never>): Disposer;
  };
  /** 模型层 provider 注册（后写胜出 upsert——执法在 LlmRuntime） */
  readonly llm: { registerProvider(provider: ProviderInput): () => void };
  /** durable 事件词汇注册（拒绝式且**不可逆**——进程生命周期词汇，无 disposer） */
  readonly events: {
    registerSessionEventType(meta: EventTypeMeta): void;
    /**
     * 跨会话活体订阅（04 §6 e-2——session/lifecycle run 起/终态广播，作用域
     * 三档）：self/tree 档零开门（锚 sessionId 必填——self = 锚会话自身、
     * tree = 锚会话血缘树〔parent_id 链同根〕）；all 档走高危面
     * sessions.observe-cross 门检（拉取/订阅一枚统摄——防「查询走门、订阅
     * 白给」旁路）+ 受理成功落 capability/used 审计一次。回卷律：装载窗注册
     * 即挂 scope effect（LIFO——unload 自动撤订）。**活体不落日志**（durable
     * 真源 = 事件流尾条推导 03 §10.8——本订阅是推导的投影消费面）。
     */
    subscribeSessionLifecycle(
      handler: (event: SessionLifecycleEvent) => void,
      opts?: { scope?: 'self' | 'tree' | 'all'; sessionId?: string },
    ): Disposer;
  };
  /** 自定义消息角色注册（拒绝式） */
  readonly agent: {
    registerMessageRole(role: string, definition: MessageRoleDefinition): () => void;
    /** 程序化 named provider 注册（拒绝式——撞名/词法两闸执法在 SubagentService，D 批 D-2） */
    registerSubagentProvider(def: ProgrammaticSubagentDef): Disposer;
  };
  /** 系统提示词段注册（拒绝式——slot 域前缀两段式执法在 PromptSectionRegistry；options.volatile = 逃生门声明〔03 §2.5〕） */
  readonly prompts: {
    registerSection(slot: string, builder: PromptSectionBuilder, options?: PromptSectionRegisterOptions): Disposer;
  };
  /** 触发器注册（拒绝式——门检/撞名/格式三闸执法在 TriggerRegistry，C 批 C-2） */
  readonly triggers: { register(def: TriggerDef): Disposer };
  /**
   * 通道交互面（ix-2——07 §4.3 消费腿条款）：七原语 + 会话锚定档位执法。
   * 阻塞三件判序 = 频率护栏 → 钩子窗禁（窗判前置锚判）→ 受局面 → 锚解析
   * （显式 sessionId 优先 / ambient 命令锚〔ALS〕回落 / 缺席拒
   * UI_ASK_UNANCHORED / 不在册拒 UI_ASK_SESSION_CLOSED）；单向原语无锚
   * 降档 no-op warn。notify/hasAudience 无会话位恒可。
   */
  readonly ui: PluginUiFace;
  /** 宿主自省面（§8.5——装配根一次物化、fork 级联共享；附本插件 id） */
  readonly host: HostFace & { readonly pluginId: string };
}

/** provider 入参形（经 LlmRuntime 公开面取——host 不直依赖 pi-ai 类型，07 栈纪律） */
export type ProviderInput = Parameters<LlmRuntime['registerProvider']>[0];

/**
 * ctx.ui 消费腿通道核窄面（ix-2——07 §4.3 消费腿条款的受理委派面）。
 * 手写结构相容 ChannelsService 七原语子集 + hasSession（锚时效真源）——
 * 不 import ChannelsService 全型防 DAG 新边（mm 批 memory-viewer 同先例）。
 * notify 不带 sessionId 首参（核层 void 掉该位——恒扇出语义，装配位适配
 * 闭包注空位）。
 */
export interface ChannelsUiFace {
  /** 一次性通知（恒扇出——无会话归属，07 §4.3 档位 1） */
  notify(message: string, opts?: { level?: NotifyLevel }): void;
  confirm(sessionId: string, message: string, opts?: UiAskOptions): Promise<boolean>;
  select(sessionId: string, message: string, choices: readonly UiSelectChoice[], opts?: UiAskOptions): Promise<string>;
  input(sessionId: string, message: string, opts?: UiInputOptions): Promise<string>;
  setStatus(sessionId: string, status: string): void;
  setWidget(sessionId: string, node: unknown | null): void;
  /** 观众探针（进程级——与核层同形） */
  hasAudience(): boolean;
  /** 在册判定（锚时效——受理时检查，陈年锚不悬死） */
  hasSession(sessionId: string): boolean;
}

/**
 * ctx.ui 七原语面（07 §4.3 签名块定稿形——缺省无会话位，本批增可选
 * sessionId 显式位）：notify/hasAudience 无会话位恒可（档位 1）；阻塞三件
 * + setStatus/setWidget 携可选 sessionId（档位 2/3——显式位优先、ambient
 * 命令锚〔ALS〕回落）。
 */
export interface PluginUiFace {
  /** 一次性通知（'success' = 任务完成语义档）——无会话位恒可 */
  notify(message: string, opts?: { level?: NotifyLevel }): void;
  /** 是/否确认——sessionId = 会话锚显式位（缺席按调用语境档位裁决） */
  confirm(message: string, opts?: { signal?: AbortSignal; sessionId?: string }): Promise<boolean>;
  /** 单选（Enter 选定 / Esc 取消收 ''） */
  select(
    message: string,
    choices: readonly UiSelectChoice[],
    opts?: { signal?: AbortSignal; sessionId?: string },
  ): Promise<string>;
  /** 自由文本输入（placeholder 可选） */
  input(message: string, opts?: { signal?: AbortSignal; placeholder?: string; sessionId?: string }): Promise<string>;
  /** 状态行更新（无锚语境 = no-op warn 一行——单向原语降档不炸装载） */
  setStatus(status: string, opts?: { sessionId?: string }): void;
  /** 自定义渲染槽呈现（会话级单槽——同 setStatus 降档律） */
  setWidget(node: unknown | null, opts?: { sessionId?: string }): void;
  /** 观众探针（无人值守降档判据——只读免护栏计数） */
  hasAudience(): boolean;
}

/** 钩子超时上报面（缺省 stderr 直写——装配根接 logger） */
export type HookTimeoutReporter = (pluginId: string, hookName: string, err: unknown) => void;

/** 构造选项（装配根逐插件注入——服务面/注册表全走公开面类型） */
export interface PluginContextOptions {
  /** 本插件 id（core: 件含前缀——域名律比对基准） */
  readonly pluginId: string;
  /** 本插件作用域（fork 产物——effect/回卷挂此） */
  readonly scope: Scope;
  /** 事件分派器（钩子词汇预注册归装配批——本件只路由） */
  readonly dispatch: EventDispatch;
  /** 工具注册表（缺席 = 本面 tools.register 抛 CONTEXT_SERVICE_MISSING——装配缺陷响亮） */
  readonly tools?: ToolRegistry;
  /**
   * per-plugin 工具名账（装载史批 h-3——05 §9 世代行 activated 成员 tools
   * 列真值源）：ctx.tools.register 注册成功后入账、disposer 出账（代内撤注
   * 不留残影）。boot 周期单实例由装配序注入（bootPlugins 构造——/reload
   * 换代即新账不串代）。缺席 = 不记账不影响注册语义（测试替身零成本缺席
   * ——诚实缺席律）。
   */
  readonly toolLedger?: PluginToolLedger;
  /** 命令注册表（缺席同上） */
  readonly commands?: CommandRegistryLike;
  /**
   * 钩子派发段 guard 开合面（03 §3.4 执法形——cache 经济批 ca-3）：全局
   * guard 真身住装配根（host/hook-dispatch-guard 单实例），此处收 enter/exit
   * 窄面——withCallbackWindow（钩子派发两腿专用包裹）随回调窗同步开合深度
   * 计数；llm 双入口只读面经装配另路注入（本面不持）。**只包钩子派发不包
   * 工具执行体**（03 §3.4 只禁钩子段——enterHostCallback 外包的工具执行期
   * 不经本面）。缺席 = 不计数（直测形）——llm 侧执法面亦缺席时整体不执法。
   */
  readonly hookDispatchGuard?: {
    readonly enter: () => void;
    readonly exit: () => void;
    /**
     * 窗内只读判定（ix-2——ctx.ui 阻塞三件钩子窗禁律）：真身 createHookDispatchGuard
     * 本有此读位（HookDispatchGuardFace 同形）；窄面此前只收开合两法，本批扩
     * 只读位供 ctx.ui 窗判（判序窗判前置锚判——窗内即使显式 sessionId 亦拒）。
     * 可选 = 测试替身零成本缺席（缺席 = 不执法窗判，同 llm 面缺席律）。
     */
    readonly inHookDispatch?: () => boolean;
  };
  /** llm 运行时（缺席同上——只取 registerProvider 一面） */
  readonly llm?: Pick<LlmRuntime, 'registerProvider'>;
  /** 提示词段注册表（缺席同上） */
  readonly promptSections?: PromptSectionRegistry;
  /**
   * ctx.ui 消费腿通道核窄面（ix-2——07 §4.3 消费腿条款）：缺席 = 阻塞三件
   * /notify/hasAudience 抛 CONTEXT_SERVICE_MISSING（受局面缺席响亮——同
   * tools 先例）；setStatus/setWidget 缺席降档 no-op warn（单向原语不炸
   * 装载/不炸派发）。装配根恒注（fork 级联共享单真身）。
   */
  readonly channelsUi?: ChannelsUiFace;
  /**
   * ctx.ui 降档 warn 出口（setStatus/setWidget 无锚 no-op、受局面缺席降档
   * 的呈现位）：缺省 console.warn（短命/测试形零依赖）；装配根接 logger.warn。
   */
  readonly uiWarn?: (message: string) => void;
  /** 触发器注册表（缺席同上——starter 真身随 C-3 装配批注入） */
  readonly triggers?: TriggerRegistryLike;
  /** 子代理注册面（缺席同上——SubagentService 程序化腿，D 批 D-2 装配批注入） */
  readonly subagents?: SubagentRegistryLike;
  /**
   * 程序化子代理物化面（消费腿——遗漏审计批 G：03 §2.2 行 109「注册即派生
   * 静态工具」的动词层兑现）。真身 = 装配链注入的 registry.register 闭包
   * （bootPlugins 构造 toolRegistry 后铸造——owner 恒 'core:subagent'，
   * agent_ 派生族域归属〔03 §2.7 前缀闸豁免域〕；注册者归因由 service
   * providers 册 owner 分域键承载，两层各司其职）。动词编排序 = service 位
   * 落册 → 物化；物化拒整体拒（service 位回滚不留半注册）。缺席 = 动词只落
   * service 位（诊断形/测试替身——与 subagents 位缺席分级）。
   */
  readonly subagentToolMaterializer?: (def: ProgrammaticSubagentDef) => Disposer;
  /**
   * 界面后端注册面受局面（缺席同上——ChannelsService 插件域腿，U3 批 U3-4
   * 装配批注入）。注：受局面缺席与门检的先后 = 门检在前（03 §2.7 执法序）——
   * 未开门插件先吃门关码，探测不到受局面在否。
   */
  readonly uiBackends?: UiBackendRegistryLike;
  /**
   * 进程级审计流写入位（05 §9 audit_events——U3 批）：高危面动词受理成功后
   * 落 capability/used {pluginId, capability}（05 §1.1 载荷形）。真身 = 装配根
   * 注入 AuditFace（U3-5 接线）；缺席 = 不落账不阻拦（:memory: 诊断形/测试
   * 替身零成本缺席——诚实缺席律）。
   */
  readonly auditSink?: AuditSink;
  /**
   * 会话血缘判定面（e-2 观测腿——04 §6 订阅 tree 档过滤消费；真身 = 装配根
   * 注入 SessionView.isSameTree〔05 §9 parent_id 链单源〕）。缺席 = tree 档
   * 订阅抛 CONTEXT_SERVICE_MISSING（装配缺陷响亮——self/all 档不消费本面）。
   */
  readonly sessionLineage?: { isSameTree(a: string, b: string): boolean };
  /**
   * provide 委派位（共享根作用域——本件只过窗/频率闸，撞名与 stale 执法归
   * Scope.provide）。缺席 = ctx.provide 抛 CONTEXT_SERVICE_MISSING（装配缺陷响亮）。
   */
  readonly provide?: (name: string, service: unknown) => void;
  /** 宿主自省面（materializeHostFace 产物——fork 共享） */
  readonly hostFace: HostFace;
  /** 频率护栏参数（缺省 {windowMs: 1000, max: 1000}——§3.4 钉值；测试面可调小） */
  readonly rateLimit?: { readonly windowMs: number; readonly max: number };
  /** 钩子消费点时钟帽（缺省 5000ms——§3.4；测试面可调小） */
  readonly hookTimeoutMs?: number;
  /** 钩子超时上报（缺省 stderr 直写） */
  readonly onHookTimeout?: HookTimeoutReporter;
  /**
   * 高危面开门授予集（03 §4.6 批 U2——启用清单行 opens 经计划行透传至此；
   * 值域已过 parseEnabledRows 行校验，此处零复验）。缺席 = 空集 = 全默认关。
   * **只进 handle 门检面不进 ctx**——开门是宿主裁决面，插件结构性不可见
   * （不获授予的插件探测不到门检存在，恰是默认关语义）。
   */
  readonly opens?: readonly string[];
  /**
   * 进程级 doors 段活体取值器（开门制扩展批 2026-09-09——03 §4.6 双源并集律
   * 第二源）：observe-cross 专属分立判定位消费（订阅 all 档门检 grantedOpens
   * ∥ doors 并判——**不并入 grantedOpens 全局面**，防波及共用该集的四枚插件
   * 道面〔ui-backend/路由受理/secrets/操控绑定〕）。真身 = 装配根活体读
   * enabled.yaml 顶层 doors 段（受理时点现读现判——撤位即收回）；缺席 =
   * doors 支路恒空（订阅门检只吃行 opens——诊断形/测试替身）。
   */
  readonly crossDoors?: () => ReadonlySet<string>;
}

/** 命令注册表受局面（CommandRegistry 的结构面——测试替身免建全量） */
export interface CommandRegistryLike {
  register(name: string, handler: CommandHandler, description?: string): Disposer;
}

/** 触发器注册表受局面（TriggerRegistry 的结构面——测试替身免建全量） */
export interface TriggerRegistryLike {
  register(pluginId: string, def: TriggerDef): Disposer;
}

/** 子代理注册面受局面（SubagentService 程序化腿的结构面——测试替身免建全量） */
export interface SubagentRegistryLike {
  registerProgrammatic(owner: string, def: ProgrammaticSubagentDef): Disposer;
}

/**
 * 界面后端注册面受局面（ChannelsService 插件域腿的结构面——U3 批 U3-4；
 * 撞名/分域执法在 ChannelsService 真源，本面只承载委派签名）。
 */
export interface UiBackendRegistryLike {
  registerPluginBackend(backend: UiBackend<never>): Disposer;
}

/**
 * 审计流写入位结构面（AuditFace.append 子集——U3 批）：高危面动词的
 * capability/used 落账消费位。窄面注入（宿主可传 AuditFace 真身——结构
 * 兼容；测试替身收数组即可）。
 */
export interface AuditSink {
  append(type: string, data: Record<string, unknown>): void;
}

/**
 * per-plugin 工具名账结构面（装载史批 h-3——05 §9 load_generations 世代行
 * activated 成员 tools 列真值源）：宿主包壳层记账，与 ToolRegistry 注册
 * 语义正交（记账缺席不影响注册）。真身工厂 = bootPlugins 的
 * createPluginToolLedger（boot 每周期新实例——换代即新账）。
 */
export interface PluginToolLedger {
  /** 注册成功入账（同名重复入账幂等——Set 背书） */
  add(pluginId: string, toolName: string): void;
  /** disposer 出账（代内撤注不留残影；未知名出账 no-op） */
  remove(pluginId: string, toolName: string): void;
}

/** ctx 装配产物（装载器消费：ctx 交 apply、闭包柄归装载序） */
export interface PluginContextHandle {
  /** 交插件 apply 的上下文本体 */
  readonly ctx: PluginContext;
  /** 关闭装载窗（apply 收口后调用——此后注册动词仅回调窗内合法；幂等） */
  closeWindow(): void;
  /**
   * 宿主回调窗开合（钩子 handler/工具执行体前后包裹——返回恢复闭包，须成对调用）。
   * 窗内注册动词合法（§2.4 主表注记钩子豁免条款）；深度计数支持嵌套回调。
   */
  enterHostCallback(): () => void;
  /**
   * 本插件开门授予集读面（03 §4.6——宿主注入位消费：U3 界面后端换装缝/U5
   * 路由受理面判「该插件被用户开了哪些门」）。只读集合语义。
   */
  readonly grantedOpens: ReadonlySet<string>;
  /**
   * 宿主回调窗判定只读面（true = 当前处于回调窗内——钩子 handler/工具执行期；
   * 嵌套回调取「深度 > 0」语义）。credentials 件 set 受理窗执法的装配源
   * （03 §10.9 写入面复合案：受理窗 = 宿主回调窗——c-3 落码批接线）。宿主
   * 面专用不进 ctx——插件窗态自查无正当消费位（窗律是执法面非插件 API）。
   */
  readonly inHostCallback: boolean;
  /**
   * 装载窗判定只读面（true = 装载窗未关——apply 期）。credentials 件
   * registerOAuthFlow 装载窗执法的装配源（03 §10.9 oauth 案——c-6 落码批
   * 接线；流注册只在 apply 期合法，回调窗内动态注册不开放）。宿主面专用
   * 不进 ctx——同 inHostCallback 窗律执法面语义。
   */
  readonly inLoadWindow: boolean;
  /**
   * 高危面门检（03 §4.6 fail-loud）：裁决核 contracts adjudicateCapabilityDoor
   * （两序判：非高危面 → not-a-door 装配缺陷面；高危面未授予 → door-closed
   * 默认关正当拒绝面），verdict 失败即抛 `PLUGIN_CAPABILITY_DOOR_CLOSED`
   * （同码分流——message 底稿即 verdict.message）。**宿主注入位专用**——
   * 吃不吃装载窗律？不吃：门检是宿主裁决面非插件注册动词（回调窗内换装
   * 场景〔U3 钩子内重装界面〕照常可判）。throw 位消费面 = 换装缝
   * （ctx.channels.registerUiBackend 第十三动词——U3 批 U3-4 已接线）/路由
   * 受理面（U5）。
   */
  assertDoor(capability: string): void;
}

/** 缺省钩子超时上报（stderr 直写——装配根接 logger 前的先有鸡缺省） */
const defaultHookTimeoutReport: HookTimeoutReporter = (pluginId, hookName, err) => {
  console.error(`[host] 插件 ${pluginId} 钩子 ${hookName} 超时/异常`, err);
};

/**
 * 构造插件上下文（装载器 createContext 注入位——每插件一枚）。
 * 窗口初态 = 开（构造即 apply 前——装载序紧邻）；closeWindow 后走回调窗律。
 */
export function createPluginContext(options: PluginContextOptions): PluginContextHandle {
  const { pluginId, scope, dispatch, hostFace } = options;
  const rateWindowMs = options.rateLimit?.windowMs ?? 1_000;
  const rateMax = options.rateLimit?.max ?? 1_000;
  const hookTimeoutMs = options.hookTimeoutMs ?? 5_000;
  const onHookTimeout = options.onHookTimeout ?? defaultHookTimeoutReport;

  // 装载窗口态（§2.1）：初开——apply 期注册合法；closeWindow 后仅回调窗内合法
  let windowOpen = true;
  // 宿主回调窗重入计数（钩子 handler/工具执行期——嵌套回调支持）
  let hostCallbackDepth = 0;

  // 频率护栏滑动窗（§3.4：单插件注册/事件动作 1000 次/1000ms——数组剪枝）
  const recentActions: number[] = [];

  // 开门授予集物化（03 §4.6 批 U2——只进 handle 门检面，不进 ctx 插件面）
  const grantedOpens: ReadonlySet<string> = new Set(options.opens ?? []);

  /**
   * 高危面门检（§4.6 fail-loud）：裁决核拒绝即抛门关码（同码分流——
   * door-closed/not-a-door 两档共用 PLUGIN_CAPABILITY_DOOR_CLOSED，message
   * 底稿 = verdict.message 原文）。
   */
  const assertDoor = (capability: string): void => {
    const verdict = adjudicateCapabilityDoor(grantedOpens, capability);
    if (!verdict.ok) {
      throw new BaseError('PLUGIN_CAPABILITY_DOOR_CLOSED', `${verdict.message}（插件 ${pluginId}）`);
    }
  };

  /**
   * observe-cross 专属分立判定位（开门制扩展批 2026-09-09——03 §4.6 双源
   * 并集律）：行 opens（grantedOpens 物化）∥ doors 段活体**并判**——两源任一
   * 含该门即过。**不并入 grantedOpens 全局面**：grantedOpens 系四枚插件道面
   * （ui-backend 换装/路由受理/secrets/操控绑定）共用的装载期单集，doors 段
   * 是运行期活体源——只在此判定位合成局部集喂裁决核（message 单源
   * adjudicateCapabilityDoor），波及面结构性为零。
   */
  const assertObserveCrossDoor = (): void => {
    const doorsLive = options.crossDoors?.() ?? new Set<string>();
    const opened =
      grantedOpens.has('sessions.observe-cross') || doorsLive.has('sessions.observe-cross')
        ? new Set(['sessions.observe-cross'])
        : grantedOpens; // 两源皆不含——喂原集，裁决核判 door-closed（message 单源拒词）
    const verdict = adjudicateCapabilityDoor(opened, 'sessions.observe-cross');
    if (!verdict.ok) {
      throw new BaseError('PLUGIN_CAPABILITY_DOOR_CLOSED', `${verdict.message}（插件 ${pluginId}）`);
    }
  };

  /** 记一次动作：窗内已满即拒（fail-loud 先于受理——超限受理连动作都不发生） */
  const countAction = (): void => {
    const now = Date.now();
    // 剪枝：滑出窗口的旧动作丢弃（数组头即最旧——单调递增，剪到首个窗内即止）
    while (recentActions.length > 0 && now - recentActions[0]! > rateWindowMs) recentActions.shift();
    if (recentActions.length >= rateMax) {
      throw new BaseError(
        'PLUGIN_RATE_LIMITED',
        `插件 ${pluginId} 注册/事件动作超频率护栏（滑动窗 ${rateWindowMs}ms 内已达 ${rateMax} 次）——失控登记防线（03 §3.4）`,
      );
    }
    recentActions.push(now);
  };

  /** 注册动词窗口闸（§2.1——apply 窗或回调窗内合法；get/tryGet/host 免窗不经过本闸） */
  const assertWindow = (verb: string): void => {
    if (windowOpen || hostCallbackDepth > 0) return;
    throw new BaseError(
      'PLUGIN_WINDOW_CLOSED',
      `注册动词 ${verb} 在装载窗口外被拒（插件 ${pluginId}——03 §2.1：注册动词只在 apply 执行期间合法，唯一例外为宿主回调上下文内〔钩子 handler/工具执行期〕）`,
    );
  };

  /** 受局面缺位执法（装配缺陷响亮——与 agentToolsFor 同判据 CONTEXT_SERVICE_MISSING） */
  const required = <T>(face: T | undefined, name: string, verb: string): T => {
    if (face === undefined) {
      throw new BaseError(
        'CONTEXT_SERVICE_MISSING',
        `注册动词 ${verb} 的受局面 ${name} 缺席（插件 ${pluginId}——装配根未接线该注册表；装配缺陷 fail-loud）`,
      );
    }
    return face;
  };

  // ---- ctx.ui 消费腿（ix-2——07 §4.3 消费腿条款）----
  /** 降档 warn 出口（缺省 console.warn——装配根接 logger.warn） */
  const warnUi = (message: string): void => {
    (options.uiWarn ?? ((m: string) => console.warn(`[host] ${m}`)))(message);
  };

  /** 钩子窗禁律（判序窗判前置锚判——窗内即使显式 sessionId 亦拒：撞的是派发序非锚定面） */
  const assertNotInHookDispatch = (verb: string): void => {
    if (options.hookDispatchGuard?.inHookDispatch?.() ?? false) {
      throw new BaseError(
        'UI_ASK_WINDOW_INVALID',
        `ctx.ui ${verb} 在钩子派发窗内被拒（插件 ${pluginId}——07 §4.3 钩子窗条：阻塞挂起与钩子消费钟/waterfall 短路序相撞；窗内即使显式 sessionId 亦拒）`,
      );
    }
  };

  /**
   * 阻塞三件锚解析（档位 2）：显式 opts.sessionId 优先 → ambient 命令锚
   * （ALS 语境继承——命令 handler 及其异步尾链零自觉锚定）回落；缺席拒
   * UI_ASK_UNANCHORED（fail-loud——「问了没人答」不得伪装「用户答了否」）；
   * 锚时效：不在通道核在册集拒 UI_ASK_SESSION_CLOSED（陈年锚晚到不悬死）。
   */
  const resolveAskAnchor = (verb: string, explicit?: string): { ui: ChannelsUiFace; sessionId: string } => {
    const ui = required(options.channelsUi, 'channels-ui', `ctx.ui.${verb}`);
    const sessionId = explicit ?? readSessionAnchor();
    if (sessionId === undefined) {
      throw new BaseError(
        'UI_ASK_UNANCHORED',
        `ctx.ui ${verb} 无会话锚（插件 ${pluginId}——07 §4.3 档位 2：装载期/无锚后台语境 opts.sessionId 缺席且无 ambient 命令锚；命令 handler 内自动锚、尾链继承）`,
      );
    }
    if (!ui.hasSession(sessionId)) {
      throw new BaseError(
        'UI_ASK_SESSION_CLOSED',
        `ctx.ui ${verb} 会话锚已收口（插件 ${pluginId}，会话 ${sessionId}——未注册或已注销：命令尾链陈年锚晚到不悬死，与在队收口三则对称分立）`,
      );
    }
    return { ui, sessionId };
  };

  /**
   * 单向原语锚解析（档位 3）：缺席/不在册 = no-op warn 一行（降档不炸装载/
   * 不炸派发——问不到人可以不问，状态行更新炸装载属过罚失当）；受局面
   * 缺席同律降档（阻塞三件的 required 拒与此分档）。
   */
  const resolveStatusAnchor = (
    verb: string,
    explicit?: string,
  ): { ui: ChannelsUiFace; sessionId: string } | undefined => {
    const ui = options.channelsUi;
    if (ui === undefined) {
      warnUi(`ctx.ui ${verb} 受局面缺席（插件 ${pluginId}）——no-op（装配根未接通道核窄面）`);
      return undefined;
    }
    const sessionId = explicit ?? readSessionAnchor();
    if (sessionId === undefined || !ui.hasSession(sessionId)) {
      warnUi(
        `ctx.ui ${verb} 无有效会话锚（插件 ${pluginId}${sessionId === undefined ? '' : `，会话 ${sessionId} 已收口`}）——no-op（07 §4.3 档位 3：单向原语降档不炸装载）`,
      );
      return undefined;
    }
    return { ui, sessionId };
  };

  /**
   * 回调窗包裹：handler 体前后开合（同步/异步腿都收口——finally 恢复）。
   * 本包裹只用于钩子派发两腿（waterfall/notify）——回调窗与钩子派发段窗
   * （guard 深度计数，03 §3.4 执法）同开同合；工具执行体走 loader 侧
   * enterHostCallback 外包，不经本面（钩子段禁模型、工具段不禁的分界位）。
   */
  const withCallbackWindow = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    hostCallbackDepth++;
    options.hookDispatchGuard?.enter(); // 钩子派发段开窗（await 跨度覆盖 handler 全执行段）
    try {
      // 钩子派发段语境遮蔽（ix-2——07 §4.3 档位 2 两处遮蔽之一）：ambient
      // 命令锚不穿透进钩子 handler（钩子语境结构性无自动锚——单向原语 no-op
      // warn、阻塞三件另由窗判拒）。ALS.exit 语境跟随 async 执行：handler
      // 全执行段（含 await 续体）均在遮蔽内；fire-and-forget 尾链（派发收口
      // 后自起）在遮蔽外——ambient 锚自然恢复（「锚判随后自理」的边界即此）。
      return await withoutSessionAnchor(fn);
    } finally {
      options.hookDispatchGuard?.exit(); // 派发收口即闭窗（fire-and-forget 尾链窗外合法）
      hostCallbackDepth--;
    }
  };

  /** 超时错误构造（时钟语义非域码语义——不占错误码册位；标记位供 notify 腿区分吞并档） */
  const hookTimeoutError = (hookName: string) =>
    Object.assign(new Error(`插件 ${pluginId} 钩子 ${hookName} 消费超时（${hookTimeoutMs}ms——03 §3.4 时钟）`), {
      hookTimedOut: true,
    } as const);

  /** 值保真竞速钟（§3.4 钩子消费点 5s——超时 reject 携标记位；notify 腿据此吞并收口、waterfall 腿按管线失败传播） */
  const raceTimeout = <T>(p: Promise<T>, hookName: string): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(hookTimeoutError(hookName)), hookTimeoutMs);
      Promise.resolve(p).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  };

  /**
   * waterfall 腿分段钟（§3.4 射程精确化——2026-09-13 真模型五轮定罪件）：
   * 钟只测插件自有执行段——首段（进 handler 到首调 next）与回程段（next
   * resolve 后到返回）各 hookTimeoutMs；next 委派的下游链（宿主守门行/
   * 其余监听器——含审批 ask 悬置等待）是宿主管线时间，不归因本插件钟：
   * 首调即停钟、resolve 后重起。全程无 next（短路形）= 单段全程钟（与
   * notify 腿同射程）。曾用全程钟致交互审批结构性不可用（checkpoint 观察
   * 钩子 await next 包住 safety 审批等待，>5s 必 fail-closed block）。
   */
  const createWaterfallClock = (hookName: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false; // 派发已收口（成功/失败/超时）——此后停/起皆 no-op
    let paused = false; // 粘性暂停位：next 已委派、下游链在飞——arm 不生效（resume 清位）
    let rejectOuter: ((err: unknown) => void) | undefined;
    const arm = () => {
      if (settled || paused || rejectOuter === undefined || timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        settled = true; // 超时即收口——迟到结果弃置（与 raceTimeout 同语义）
        rejectOuter?.(hookTimeoutError(hookName));
      }, hookTimeoutMs);
    };
    const disarm = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    };
    return {
      /**
       * 段边界：next 委派时粘性停钟（下游链不归因插件钟——§3.4 射程精确化）。
       * 粘性 = handler 同步前缀即调 next 的形下 pause 先于 race/arm 执行，
       * 非粘性位会被随后的 arm 抵消（首段钟白起——下游等待仍被计时）。
       */
      pause: () => {
        disarm();
        paused = true;
      },
      /** 段边界：next 返回后重起钟（回程段自有执行再计时） */
      resume: () => {
        paused = false;
        arm();
      },
      /** 竞速入口（与 raceTimeout 同收口语义：settle 后迟到值弃置） */
      race<T>(p: Promise<T>): Promise<T> {
        return new Promise<T>((resolve, reject) => {
          rejectOuter = reject;
          arm();
          Promise.resolve(p).then(
            (value) => {
              disarm();
              settled = true;
              resolve(value);
            },
            (err) => {
              disarm();
              settled = true;
              reject(err);
            },
          );
        });
      },
    };
  };

  /** 钩子消费点超时判定（标记位判据——raceTimeout 超时腿专属） */
  const isHookTimeout = (err: unknown): err is Error & { hookTimedOut: true } =>
    err instanceof Error && (err as { hookTimedOut?: true }).hookTimedOut === true;

  const ctx: PluginContext = {
    get<T>(name: string): T {
      try {
        return scope.get<T>(name);
      } catch (err) {
        // 缺席报错附现行服务目录（§3.1「服务目录运行时可枚举」——点名错误当场可诊）
        if (err instanceof BaseError && err.code === 'CONTEXT_SERVICE_MISSING') {
          throw new BaseError(
            'CONTEXT_SERVICE_MISSING',
            `服务 ${name} 缺席（插件 ${pluginId}；现行服务目录：${scope.serviceNames().join('、') || '（空）'}——拼错名/装载序缺口，可选消费用 tryGet）`,
          );
        }
        throw err;
      }
    },
    tryGet<T>(name: string): T | undefined {
      return scope.tryGet<T>(name);
    },
    provide(name: string, service: unknown): void {
      // 注册动词族：吃窗口闸 + 计频率数；真实落库委派共享根（撞名/stale 归 Scope 执法）
      assertWindow('ctx.provide');
      countAction();
      required(options.provide, 'provide', 'ctx.provide')(name, service);
    },
    effect(register: () => Disposer): void {
      countAction();
      scope.effect(register);
    },
    on(hookName: string, handler: PluginHookHandler): () => void {
      // ctx.on 属注册动词族（§2.2 主表末行）——吃窗口闸；ctx.effect 属 §3.1 三动词
      // （消费面）不入闸，只计频率数（其自有护栏 = Scope stale/容量 + 本件计数）
      assertWindow('ctx.on');
      countAction();
      const mode = HOOK_MODES.get(hookName);
      if (mode === undefined) {
        // fail-closed：未知钩子不静默吞（03 §2.4/§2.7）
        throw new BaseError(
          'PLUGIN_HOOK_UNKNOWN',
          `钩子 ${hookName} 不在主表（插件 ${pluginId} 订阅被拒——词汇真源 03 §2.4，41 词清单见 PLUGIN_HOOK_VOCABULARY）`,
        );
      }
      if (mode === 'waterfall') {
        // waterfall 腿：真 next 委托链（不调即短路——管线语义）；超时按管线失败
        // 传播（宿主发射位决定处置），另经 onHookTimeout 上报观测面。
        // U4-3 归因铸造位（03 §2.4 session_before_compact 行/05 §2.1）：值链
        // 改写者记名（mark——末位改写者归因，非接管缝值零接触）+ takeover
        // .pluginId 铸造覆写（forge——插件自填被覆写，冒名结构性不存在）。
        // 两律只对携带归因箱的值生效（宿主派发包装层种子），通用 waterfall
        // 钩子结构性不受影响。
        const wrapped = ((value: unknown, next: (v: unknown) => Promise<unknown>) => {
          let delegated = false; // 委托标记：产物归因在入口侧完成，出口侧不重复记名（下游改写归下游）
          // 归因两律的单监听者应用位（U4-3）：改写值（引用变）→ 记名；接管位
          // 引用换 → 铸造覆写（原引用透传不覆写——防下游误夺上游接管归因）
          const attributed = (produced: unknown): unknown => {
            if (produced !== value) markBeforeCompactRewrite(produced, pluginId);
            return forgeBeforeCompactIdentity(produced, value, pluginId);
          };
          // 分段钟（§3.4 射程精确化）：包装 next——首调停钟（下游链是宿主
          // 管线时间不归因本插件钟），resolve 后重起（回程段自有执行再计时）
          const clock = createWaterfallClock(hookName);
          const gatedNext = (nextValue: unknown) => {
            delegated = true;
            clock.pause();
            return Promise.resolve(next(attributed(nextValue))).finally(() => clock.resume());
          };
          return withCallbackWindow(() =>
            clock.race(
              Promise.resolve(handler(value, gatedNext)).then((result) => {
                if (delegated) return result;
                // 短路形：未委托即返回——返回值即管线终值，同律记名铸造
                return attributed(result);
              }),
            ),
          );
        }) as WaterfallListener<unknown>;
        // 受理成功尾逐笔落账（T9 案一批 t-2——05 §1.1 hook/registered）：词汇
        // 闸/窗闸已过、dispatch.onWaterfall 返回即受理成功；「谁在挂瀑布」的
        // durable 归因（context_transform 全隐身注册就此有账）。拒路径
        // （上方 throw）零审计——被拒的注册不是行为
        options.auditSink?.append('hook/registered', { pluginId, hook: hookName });
        return dispatch.onWaterfall(hookName, wrapped);
      }
      // emit/serial/parallel 共用通知型监听面（dispatch.on）——next 为直通占位
      // （notify 腿无值语义，调用无害）；超时腿上报后吞并收口不悬挂（emit 隔离
      // 语义：单腿超时不波及他腿与调用方；迟到结果弃置）；真异常照抛——dispatch
      // 隔离腿上报（onListenerError）照常，与超时档分道
      const passthroughNext = (v: unknown) => Promise.resolve(v);
      const wrapped = (data: unknown) =>
        withCallbackWindow(() =>
          raceTimeout(Promise.resolve(handler(data, passthroughNext)), hookName).catch((err: unknown) => {
            if (!isHookTimeout(err)) throw err;
            onHookTimeout(pluginId, hookName, err);
          }),
        );
      // 受理成功尾逐笔落账（T9 案一批 t-2——同 waterfall 腿）：notify 族
      // （emit/serial/parallel）的受理账与瀑布腿同词同形
      options.auditSink?.append('hook/registered', { pluginId, hook: hookName });
      return dispatch.on(hookName, wrapped);
    },
    emit(name: string, data?: unknown): Promise<void> {
      countAction();
      // 域名律：活体事件词须以本插件域起头（03 §2.2 尾注「自定义事件名走域名前缀」——
      // 兄弟插件域词 emit 即冒名广播，结构性不可达）
      const prefix = `${pluginId}/`;
      if (!name.startsWith(prefix)) {
        throw new BaseError(
          'EVENT_NOT_REGISTERED',
          `事件词 ${name} 未以本插件域起头（须 ${prefix}…——域名前缀纪律，03 §2.2；emit 只广播自域词）`,
        );
      }
      // 自域词自动注册一次（活体事件注册面无词汇门禁——不落日志，03 §2.2 尾注；
      // 兄弟插件同域词不可能（域前缀互斥），重复注册仅发生在本插件重复 emit 首词）
      if (!dispatch.isRegistered(name)) dispatch.registerEventNames([name]);
      return dispatch.emit(name, data);
    },
    tools: {
      register(def: ToolDefinition, opts?: { driver?: string }): Disposer {
        assertWindow('ctx.tools.register');
        countAction();
        const registry = required(options.tools, 'tools', 'ctx.tools.register');
        // agent_ 前缀保留字闸（03 §2.7 行 254——拒绝式同码）：named provider
        // 派生工具名专属段（04 §10 程序化注册槽），插件先占 agent_xxx 位即
        // 反锁后续 named provider 注册（拒绝服务窗）——保留字在注册面执法、
        // 执法位写死注册侧（本动词；机器侧放行 host 物化腿的派生工具注册——
        // 豁免位 = core:subagent 件：声明式/程序化子代理 agent_<name> 静态
        // 工具经本动词物化，批 19c-1 注释条款兑现）
        if (def.name.startsWith(AGENT_TOOL_PREFIX) && pluginId !== 'core:subagent') {
          throw new BaseError(
            'TOOL_NAME_CONFLICT',
            `工具名「${def.name}」携 ${AGENT_TOOL_PREFIX} 前缀——保留字段（named provider 派生工具名专属段，03 §2.7/04 §10），请改名注册`,
          );
        }
        // 工具名账包壳（装载史批 h-3——05 §9 世代行 tools 列真值源）：注册
        // 成功才入账（前置闸全过 + 真源 register 返回即成功）；disposer 包装
        // 出账（代内撤注不留残影——世代行 tools = 收口时点在册集）
        // owner 归因铸造（03 §2.3 尾注——T9 案一批 R1）：无条件覆写为注册者
        // pluginId（fork 闭包单源）——插件自报 owner 值恒不达注册表（冒名
        // 结构性不存在；覆写无条件非「缺省补齐」）；agent_ 派生族经本动词
        // 注册（core:subagent 域物化）自然铸得 'core:subagent'，无需另立位
        const inner = registry.register({ ...def, owner: pluginId }, opts);
        options.toolLedger?.add(pluginId, def.name);
        return () => {
          inner();
          options.toolLedger?.remove(pluginId, def.name);
        };
      },
    },
    channels: {
      registerCommand(name: string, handler: CommandHandler, description?: string): Disposer {
        assertWindow('ctx.channels.registerCommand');
        countAction();
        return required(options.commands, 'commands', 'ctx.channels.registerCommand').register(
          name,
          handler,
          description,
        );
      },
      registerUiBackend(backend: UiBackend<never>): Disposer {
        assertWindow('ctx.channels.registerUiBackend');
        countAction();
        // 门检前置（03 §2.7 第十三动词执法序）：channels.ui-backend 高危面
        // 开门制先于撞名律——未开门插件连 ChannelsService 都不可达，探测不到
        // 宿主/插件两域名单（§4.6 默认关语义）
        assertDoor('channels.ui-backend');
        const disposer = required(
          options.uiBackends,
          'uiBackends',
          'ctx.channels.registerUiBackend',
        ).registerPluginBackend(backend);
        // capability/used 落账（05 §1.1）：门检通过 + 受理成功后落（拒笔不
        // 记使用——没发生的使用不是使用）；sink 缺席 = 诊断形不落账不阻拦
        options.auditSink?.append('capability/used', { pluginId, capability: 'channels.ui-backend' });
        return disposer;
      },
    },
    llm: {
      registerProvider(provider: ProviderInput): () => void {
        assertWindow('ctx.llm.registerProvider');
        countAction();
        return required(options.llm, 'llm', 'ctx.llm.registerProvider').registerProvider(provider);
      },
    },
    events: {
      registerSessionEventType(meta: EventTypeMeta): void {
        assertWindow('ctx.events.registerSessionEventType');
        countAction();
        // 不可逆动词：词汇注册进程生命周期（dispatch 同生命周期——open-tools 批已裁）；
        // 返回 void 无 disposer 是§2.2「每个注册动词返回 disposer 或记入 ctx.effect」的明文例外
        registerEventType(meta);
      },
      subscribeSessionLifecycle(
        handler: (event: SessionLifecycleEvent) => void,
        opts?: { scope?: 'self' | 'tree' | 'all'; sessionId?: string },
      ): Disposer {
        assertWindow('ctx.events.subscribeSessionLifecycle');
        countAction();
        // 局部名避开外层 scope（Scope 根实例）——观测作用域词面
        const observeScope = opts?.scope ?? 'all'; // 插件无「本会话」——缺省档唯一无锚形 all
        // 作用域坏形 fail-loud（04 §6 e-2 定形）：非三值词面 / self·tree 档锚
        // 缺席——静默升 all 档等价绕门、静默降 self 档等价丢事件，两向都拒
        if (observeScope !== 'self' && observeScope !== 'tree' && observeScope !== 'all') {
          throw new BaseError(
            'SESSION_OBSERVE_SCOPE_INVALID',
            `订阅作用域「${String(observeScope)}」非三值词面 self|tree|all（插件 ${pluginId}——04 §6 作用域参数闭集）`,
          );
        }
        const anchorId = observeScope === 'all' ? undefined : opts?.sessionId;
        if (observeScope !== 'all' && (anchorId === undefined || anchorId === '')) {
          throw new BaseError(
            'SESSION_OBSERVE_SCOPE_INVALID',
            `订阅作用域 ${observeScope} 需 sessionId 锚（插件 ${pluginId}——self 档 = 锚会话自身、tree 档 = 锚会话血缘树；缺锚不可过滤）`,
          );
        }
        // all 档门检 + 审计（sessions.observe-cross 高危面——拉取/订阅一枚统摄；
        // 审计一次于受理成功〔registerUiBackend 同形〕非逐事件——推送非使用动作）。
        // 门检走 observe-cross 专属分立判定位（开门制扩展批——行 opens ∥ doors
        // 段并判，见 assertObserveCrossDoor 注）
        if (observeScope === 'all') {
          assertObserveCrossDoor();
          options.auditSink?.append('capability/used', {
            pluginId,
            capability: 'sessions.observe-cross',
            verb: 'subscribeSessionLifecycle',
            scope: 'all',
          });
        }
        // tree 档过滤消费血缘判定面（装配根 SessionView.isSameTree 单源）
        const lineage =
          observeScope === 'tree'
            ? required(options.sessionLineage, 'sessionLineage', 'ctx.events.subscribeSessionLifecycle')
            : undefined;
        const unsubscribe = dispatch.on(SESSION_LIFECYCLE_EVENT, (event) => {
          const lifecycle = event as SessionLifecycleEvent;
          if (observeScope === 'all') {
            handler(lifecycle);
            return;
          }
          // self 档：同 id 判定；tree 档：同 id 特例天然含于 isSameTree（链上溯）。
          // anchorId 守卫 = 类型收窄位（受理时已验非空——此处恒真，不重复执法）
          if (lifecycle.sessionId === anchorId) {
            handler(lifecycle);
            return;
          }
          if (
            observeScope === 'tree' &&
            anchorId !== undefined &&
            lineage !== undefined && // 类型收窄位（tree 档受理时 lineage 必经 required——恒真）
            lineage.isSameTree(lifecycle.sessionId, anchorId)
          ) {
            handler(lifecycle);
          }
        });
        // 订阅回卷律（04 §6——unload 撤订）：LIFO effect 挂插件作用域（effect
        // 形参 = 注册函数返退订闭包；重复退订幂等——splice indexOf 二跑 no-op）
        scope.effect(() => unsubscribe);
        return unsubscribe;
      },
    },
    agent: {
      registerMessageRole(role: string, definition: MessageRoleDefinition): () => void {
        assertWindow('ctx.agent.registerMessageRole');
        countAction();
        return registerMessageRole(role, definition);
      },
      registerSubagentProvider(def: ProgrammaticSubagentDef): Disposer {
        assertWindow('ctx.agent.registerSubagentProvider');
        countAction();
        // 第十二动词（03 §2.2 行 109——注册者 id 即 owner 分域键，本插件
        // 身份由 ctx 闭包携带不假手插件自报——防冒名）；消费腿 = 注册即
        // 派生（04 §10 程序化注册槽）：service 位落册后物化 agent_<name>
        // 静态工具（物化面缺席 = 诊断形只落 service 位）；物化拒（撞名等）
        // 整体拒——service 位回滚，半注册结构性不存在
        const disposeProvider = required(
          options.subagents,
          'subagents',
          'ctx.agent.registerSubagentProvider',
        ).registerProgrammatic(pluginId, def);
        let disposeTool: Disposer | undefined;
        if (options.subagentToolMaterializer !== undefined) {
          try {
            disposeTool = options.subagentToolMaterializer(def);
          } catch (err) {
            disposeProvider(); // 回滚 service 位（注册整体拒）
            throw err;
          }
        }
        return () => {
          disposeProvider();
          disposeTool?.(); // 工具注册位与 service 位同生共死
        };
      },
    },
    prompts: {
      registerSection(
        slot: string,
        builder: PromptSectionBuilder,
        registerOptions?: PromptSectionRegisterOptions,
      ): Disposer {
        assertWindow('ctx.prompts.registerSection');
        countAction();
        return required(options.promptSections, 'promptSections', 'ctx.prompts.registerSection').register(
          slot,
          pluginId,
          builder,
          registerOptions,
        );
      },
    },
    triggers: {
      register(def: TriggerDef): Disposer {
        assertWindow('ctx.triggers.register');
        countAction();
        return required(options.triggers, 'triggers', 'ctx.triggers.register').register(pluginId, def);
      },
    },
    ui: {
      // 档位 1：notify 无会话位恒可（核层恒扇出）——只过护栏与受局面
      notify(message: string, opts?: { level?: NotifyLevel }): void {
        countAction();
        required(options.channelsUi, 'channels-ui', 'ctx.ui.notify').notify(message, opts);
      },
      // 档位 2：阻塞三件——判序护栏 → 窗判前置 → 锚解析（显式优先/ALS 回落
      // /缺席拒/不在册拒）；opts 剥 sessionId 后透传核层形（核层 sessionId 是首参）
      confirm(message: string, opts?: { signal?: AbortSignal; sessionId?: string }): Promise<boolean> {
        countAction();
        assertNotInHookDispatch('confirm');
        const { ui, sessionId } = resolveAskAnchor('confirm', opts?.sessionId);
        const { signal } = opts ?? {};
        return ui.confirm(sessionId, message, signal !== undefined ? { signal } : undefined);
      },
      select(
        message: string,
        choices: readonly UiSelectChoice[],
        opts?: { signal?: AbortSignal; sessionId?: string },
      ): Promise<string> {
        countAction();
        assertNotInHookDispatch('select');
        const { ui, sessionId } = resolveAskAnchor('select', opts?.sessionId);
        const { signal } = opts ?? {};
        return ui.select(sessionId, message, choices, signal !== undefined ? { signal } : undefined);
      },
      input(
        message: string,
        opts?: { signal?: AbortSignal; placeholder?: string; sessionId?: string },
      ): Promise<string> {
        countAction();
        assertNotInHookDispatch('input');
        const { ui, sessionId } = resolveAskAnchor('input', opts?.sessionId);
        const { signal, placeholder } = opts ?? {};
        const askOpts =
          signal !== undefined || placeholder !== undefined
            ? { ...(signal !== undefined ? { signal } : {}), ...(placeholder !== undefined ? { placeholder } : {}) }
            : undefined;
        return ui.input(sessionId, message, askOpts);
      },
      // 档位 3：单向原语——无有效锚 no-op warn（不炸装载/不炸派发）
      setStatus(status: string, opts?: { sessionId?: string }): void {
        countAction();
        const resolved = resolveStatusAnchor('setStatus', opts?.sessionId);
        if (resolved !== undefined) resolved.ui.setStatus(resolved.sessionId, status);
      },
      setWidget(node: unknown | null, opts?: { sessionId?: string }): void {
        countAction();
        const resolved = resolveStatusAnchor('setWidget', opts?.sessionId);
        if (resolved !== undefined) resolved.ui.setWidget(resolved.sessionId, node);
      },
      // 档位 1：观众探针——只读免护栏计数（03 §3.4 免计清单）
      hasAudience(): boolean {
        return required(options.channelsUi, 'channels-ui', 'ctx.ui.hasAudience').hasAudience();
      },
    },
    host: { ...hostFace, pluginId },
  };

  return {
    ctx,
    closeWindow(): void {
      windowOpen = false; // 幂等（重复关窗无副作用）
    },
    enterHostCallback(): () => void {
      hostCallbackDepth++;
      let restored = false;
      return () => {
        // 恢复闭包幂等（异常路径双调防御——深度不减穿零）
        if (restored) return;
        restored = true;
        hostCallbackDepth--;
      };
    },
    grantedOpens,
    // 回调窗判定只读面（深度 > 0 = 窗内——嵌套取「在窗内」语义）
    get inHostCallback(): boolean {
      return hostCallbackDepth > 0;
    },
    // 装载窗判定只读面（closeWindow 前 = apply 期 true）
    get inLoadWindow(): boolean {
      return windowOpen;
    },
    assertDoor,
  };
}
