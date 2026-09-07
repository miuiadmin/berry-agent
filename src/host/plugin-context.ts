/**
 * host/plugin-context — 插件上下文装配件（03 §2.1/§2.2/§2.4/§3.1/§3.4/§8.5；批 12f-2a）。
 *
 * 一件三面：
 *  - **ctx 九路注册动词 + 三动词 + provide**（§2.2/§3.1）：tools.register（拒绝式）/ channels.
 *    registerCommand（后写胜出）/ llm.registerProvider（后写胜出 upsert）/ events.
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
 * 挂账注记（消费面未齐暂缓，随各自消费腿定形）：ctx.ui 七原语 + registerRenderer
 * （07 §4.1 渲染签名未钉——随 TUI/SPA 消费腿）；ctx.sessions/ctx.host 动词包装
 * （§4.4/§4.5——随 core:memory 消费腿）；tools 管道 waterfall 派发位（pipeline.ts
 * 归 tools 域——宿主发射位接线随装配批）。
 */
import { BaseError, registerEventType, registerMessageRole } from '../contracts/index.js';
// internal 桶机制符号深导（门检裁决核——03 §4.6；开门是宿主裁决面非插件 API）
import { adjudicateCapabilityDoor } from '../contracts/api.js';
import type {
  EventTypeMeta,
  HostFace,
  MessageRoleDefinition,
  ProgrammaticSubagentDef,
  ToolDefinition,
} from '../contracts/index.js';
import type { LlmRuntime } from '../llm/index.js';
import type { CommandHandler } from '../channels/index.js';
import { AGENT_TOOL_PREFIX } from '../subagent/types.js';
import type { ToolRegistry } from '../tools/index.js';
import type { Disposer, EventDispatch, Scope, WaterfallListener } from '../context/index.js';
import type { PromptSectionBuilder, PromptSectionRegistry } from './prompt-sections.js';
import type { TriggerDef } from './triggers.js';

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
  /** 命令面注册（后写胜出——执法在 CommandRegistry） */
  readonly channels: { registerCommand(name: string, handler: CommandHandler, description?: string): Disposer };
  /** 模型层 provider 注册（后写胜出 upsert——执法在 LlmRuntime） */
  readonly llm: { registerProvider(provider: ProviderInput): () => void };
  /** durable 事件词汇注册（拒绝式且**不可逆**——进程生命周期词汇，无 disposer） */
  readonly events: { registerSessionEventType(meta: EventTypeMeta): void };
  /** 自定义消息角色注册（拒绝式） */
  readonly agent: {
    registerMessageRole(role: string, definition: MessageRoleDefinition): () => void;
    /** 程序化 named provider 注册（拒绝式——撞名/词法两闸执法在 SubagentService，D 批 D-2） */
    registerSubagentProvider(def: ProgrammaticSubagentDef): Disposer;
  };
  /** 系统提示词段注册（拒绝式——slot 域前缀两段式执法在 PromptSectionRegistry） */
  readonly prompts: { registerSection(slot: string, builder: PromptSectionBuilder): Disposer };
  /** 触发器注册（拒绝式——门检/撞名/格式三闸执法在 TriggerRegistry，C 批 C-2） */
  readonly triggers: { register(def: TriggerDef): Disposer };
  /** 宿主自省面（§8.5——装配根一次物化、fork 级联共享；附本插件 id） */
  readonly host: HostFace & { readonly pluginId: string };
}

/** provider 入参形（经 LlmRuntime 公开面取——host 不直依赖 pi-ai 类型，07 栈纪律） */
export type ProviderInput = Parameters<LlmRuntime['registerProvider']>[0];

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
  /** 命令注册表（缺席同上） */
  readonly commands?: CommandRegistryLike;
  /** llm 运行时（缺席同上——只取 registerProvider 一面） */
  readonly llm?: Pick<LlmRuntime, 'registerProvider'>;
  /** 提示词段注册表（缺席同上） */
  readonly promptSections?: PromptSectionRegistry;
  /** 触发器注册表（缺席同上——starter 真身随 C-3 装配批注入） */
  readonly triggers?: TriggerRegistryLike;
  /** 子代理注册面（缺席同上——SubagentService 程序化腿，D 批 D-2 装配批注入） */
  readonly subagents?: SubagentRegistryLike;
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
   * 高危面门检（03 §4.6 fail-loud）：裁决核 contracts adjudicateCapabilityDoor
   * （两序判：非高危面 → not-a-door 装配缺陷面；高危面未授予 → door-closed
   * 默认关正当拒绝面），verdict 失败即抛 `PLUGIN_CAPABILITY_DOOR_CLOSED`
   * （同码分流——message 底稿即 verdict.message）。**宿主注入位专用**——
   * 吃不吃装载窗律？不吃：门检是宿主裁决面非插件注册动词（回调窗内换装
   * 场景〔U3 钩子内重装界面〕照常可判）。throw 位消费面 = 换装缝/路由
   * 受理面（随批 U3/U5 落地接线——本笔挂载面先行）。
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

  /** 回调窗包裹：handler 体前后开合（同步/异步腿都收口——finally 恢复） */
  const withCallbackWindow = async <T>(fn: () => T | Promise<T>): Promise<T> => {
    hostCallbackDepth++;
    try {
      return await fn();
    } finally {
      hostCallbackDepth--;
    }
  };

  /** 值保真竞速钟（§3.4 钩子消费点 5s——超时 reject 携标记位；notify 腿据此吞并收口、waterfall 腿按管线失败传播） */
  const raceTimeout = <T>(p: Promise<T>, hookName: string): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        // 时钟语义非域码语义（不占错误码册位）——标记位供 notify 腿区分吞并档
        reject(
          Object.assign(new Error(`插件 ${pluginId} 钩子 ${hookName} 消费超时（${hookTimeoutMs}ms——03 §3.4 时钟）`), {
            hookTimedOut: true,
          } as const),
        );
      }, hookTimeoutMs);
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
        // 传播（宿主发射位决定处置），另经 onHookTimeout 上报观测面
        const wrapped = ((value: unknown, next: (v: unknown) => Promise<unknown>) =>
          withCallbackWindow(() =>
            raceTimeout(Promise.resolve(handler(value, next)), hookName),
          )) as WaterfallListener<unknown>;
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
        return registry.register(def, opts);
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
        // 身份由 ctx 闭包携带不假手插件自报——防冒名）
        return required(options.subagents, 'subagents', 'ctx.agent.registerSubagentProvider').registerProgrammatic(
          pluginId,
          def,
        );
      },
    },
    prompts: {
      registerSection(slot: string, builder: PromptSectionBuilder): Disposer {
        assertWindow('ctx.prompts.registerSection');
        countAction();
        return required(options.promptSections, 'promptSections', 'ctx.prompts.registerSection').register(
          slot,
          pluginId,
          builder,
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
    assertDoor,
  };
}
