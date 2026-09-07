/**
 * host/assembly — 宿主装配序公共段（批 12f-3；07 §5 dump-config `:memory:`
 * 同构纪律的码面承载件——纪律原文：「禁 fork 诊断侧门——不许为『只打印不
 * 落库』写第二条装配路径，必须复用同一运行时装配入口」）。
 *
 * 从 tui-entry 抽出装配序前段（TUI 入口与 dump-config / plugins list 诊断
 * 命令**同一合成代码路径**——本件是唯一装配序真源，诊断命令只换运行时形
 * 〔memory 同构诊断形：真数据目录读侧 + 主库 :memory: + 不占活跃标记〕，
 * 不换代码路径）：pluginCounts 披露匣 → 运行时组装（单活跃机 + 开库
 * fail-loud）→ logger（--debug 让位律）→ 共享根作用域/事件总线 →
 * conversation 栈五层 → 插件装载（enabled.yaml 读侧 + core: 注册表 +
 * 装载管线全跑）→ 披露匣回写。
 *
 * 失败三档归一 {ok:false}（不抛——呈报面归调用方）：
 *  - 运行时组装失败（单活跃机拒入/开库失败）= 干净退出档退 1（运行时未
 *    建成，无资源待收——不写 crash.log）；
 *  - 启用清单损坏 PLUGIN_ROW_INVALID = 用户可自修配置错退 1（同干净退出
 *    档——message 已含修复指引；运行时先收口再返回）；
 *  - 意外异常 = 崩溃取证档（crash.log 已在收口前写入——memory 形内建跳过；
 *    crashed: true 供调用方区分文案前缀，不再重复取证）。
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

import { BaseError } from '../contracts/index.js';
import { EventDispatch, LogLevelState, Scope, canonicalWorkspaceRoot, createLogger } from '../context/index.js';
import type { Logger, Scope as ScopeType } from '../context/index.js';
import type { Provider } from '../llm/index.js';
import type { MemoryLlmFace } from '../memory/index.js';
import type { AllowlistDraft, SandboxMode } from '../safety/index.js';
import {
  DEFAULT_SUBAGENT_PROVIDER,
  createJobRegistry,
  createSubagentService,
  provideJobsService,
} from '../subagent/index.js';
import type { SkillsRegistry } from '../skills/index.js';

import { appendAllowlistEntry, readAllowlist } from './allowlist-store.js';
import { createCorePlugins } from './core-plugins.js';
import type { ConversationStack } from './conversation-stack.js';
import { createConversationStack } from './conversation-stack.js';
import type { CorePluginReference } from './loader.js';
import { enabledYamlPath, parseEnabledRows } from './manifest.js';
import type { PluginBootHandle } from './plugin-boot.js';
import { bootPlugins } from './plugin-boot.js';
import type { HostRuntime, HostRuntimeOptions } from './runtime.js';
import { createHostRuntime } from './runtime.js';
import { createDelegationSessionTracker, createInProcessSubagentProvider } from './subagent-factory.js';
import { TRIGGER_JOB_PARALLEL_LIMIT, TriggerRegistry, createTriggerStarterFactory } from './triggers.js';

/** 装配选项（TUI 入口与诊断命令共用面——runtime 子面透传 createHostRuntime） */
export interface AssembleHostOptions {
  /** 运行时组装选项（dataDir/memory 组合形由此定形：memory+dataDir = 同构诊断形） */
  readonly runtime: Omit<HostRuntimeOptions, 'pluginsProvider'>;
  /** 安全模式（--no-plugins——装载面整跳） */
  readonly noPlugins: boolean;
  /** 日志提级（--debug——env 已设时让位律在件内执法） */
  readonly debug: boolean;
  /** 宿主版本（HostFace 物化位） */
  readonly version: string;
  /** 初始 provider 集（缺省真 provider 全家桶——与 TUI 入口同路） */
  readonly providers?: readonly Provider[];
  /** 模型标识（缺省 BERRY_AGENT_MODEL 覆盖律——栈内解析） */
  readonly model?: string;
  /** env 面（缺省 process.env——日志级解析与模型覆盖律同源） */
  readonly env?: Record<string, string | undefined>;
  /** 沙箱档位取值器（透传组合根） */
  readonly sandboxMode?: () => SandboxMode;
  /** 运行时组装后回调（信号/崩溃编舞切运行时本体——main attachRuntime） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** core: 官方件注册表（缺省 CORE_PLUGINS 单源——批 19a 起逐纵切笔入册；测试注入面/诊断覆盖经本位） */
  readonly corePlugins?: readonly CorePluginReference[];
  /** 警示面（缺省 stderr 直写） */
  readonly warn?: (message: string) => void;
}

/** 装配失败档（crashed = 意外异常——crash.log 已写，调用方只呈报不取证） */
export interface AssemblyFailure {
  readonly ok: false;
  readonly exitCode: number;
  readonly message: string;
  readonly crashed: boolean;
}

/** 装配产物（六柄一匣——TUI 段与诊断命令各取所需） */
export interface AssemblySuccess {
  readonly ok: true;
  readonly runtime: HostRuntime;
  readonly logger: Logger;
  readonly dispatch: EventDispatch;
  readonly scope: ScopeType;
  readonly stack: ConversationStack;
  readonly boot: PluginBootHandle;
  /** 披露匣（boot.counts 已回写——运行时披露段每请求重算即见） */
  readonly pluginCounts: { total: number; enabled: number; failed: number };
}

/** 宿主装配序主入口（async——装载管线内含 jiti ESM 求值） */
export async function assembleHostStack(options: AssembleHostOptions): Promise<AssemblySuccess | AssemblyFailure> {
  // —— 装载披露计数匣（pluginsProvider 先于运行时组装接线——披露段每请求重算读匣）——
  const pluginCounts = { total: 0, enabled: 0, failed: 0 };
  // —— 共享根作用域与事件总线（提前位——批 19b-2：session/event 活体镜像桥
  // 须在运行时组装期注入 Persistence.onDurableEvent，作用域/总线先于运行时建；
  // 对话栈与插件装载仍同根同源）——
  const scope = Scope.createRoot();
  const dispatch = new EventDispatch();
  let runtime: HostRuntime | undefined;
  try {
    // —— 运行时组装（单活跃机 + 开库 fail-loud——干净退出档，非崩溃取证档）——
    try {
      runtime = createHostRuntime({
        ...options.runtime,
        pluginsProvider: () => ({ ...pluginCounts }),
        // session/event 活体镜像桥（03 §146——批 19b-2）：durable append →
        // dispatch.emit。isRegistered 守卫 = 纯诊断形（noPlugins）词汇未注册
        // 零发射（41 词表在 bootPlugins 预注册——不装载即不注册）；观察者
        // 异常隔离双保险（Persistence 发射侧 try/catch + dispatch 监听器互
        // 隔离）。onDurableEvent 属装配根专属位——调用方旋钮透传不含此键
        persistence: {
          ...options.runtime.persistence,
          onDurableEvent: (payload) => {
            if (!dispatch.isRegistered('session/event')) return;
            void dispatch.emit('session/event', payload);
          },
        },
      });
    } catch (err) {
      return {
        ok: false,
        exitCode: 1,
        message: `启动失败：${err instanceof Error ? err.message : String(err)}`,
        crashed: false,
      };
    }
    options.onRuntime?.(runtime);

    // —— logger 装配：env 解析 + --debug 提级让位律（env 已设时让位）——
    const env = options.env ?? process.env;
    const logState = LogLevelState.fromEnv(env.BERRY_AGENT_LOG_LEVEL);
    if (options.debug && env.BERRY_AGENT_LOG_LEVEL === undefined) logState.setGlobalLevel('debug');
    const logger = createLogger('host', logState);

    // —— 跨会话 allowlist 装配期载入（04 §9 粘性第 3 款定形块读侧律——
    // dataDir 在场即真读〔含同构诊断形：报告真实装载会走到的路〕；纯 memory
    // 形 dataDir null 双缺〔无归属地〕。坏形 warn 降级 + 回写拒在 store 内执法）——
    const dataDir = runtime.dataDir;
    const allowlistLoad = dataDir !== null ? readAllowlist(dataDir, { warn: (m) => logger.warn(m) }) : null;

    // —— 共享根作用域与事件总线已前移运行时组装之前（批 19b-2 活体镜像桥位）——
    // 装载柄前置声明（批 19a 消费腿闭包晚绑定：stack 先建、boot 后跑，会话
    // 首开/请求组装时闭包经此引用取已定型产物——boot.tools 全局层定义重放
    // 与 promptSections 物化两条消费腿同法）
    let boot: PluginBootHandle | undefined;
    const stack = createConversationStack({
      runtime,
      scope,
      dispatch,
      ...(options.providers !== undefined ? { providers: options.providers } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
      // 装载工具定义重放取值器（会话装配时点 boot 已定型——noPlugins/装载
      // 失败形 boot.tools 为空注册表，取值器返回 [] 零打扰）
      bootTools: () => boot?.tools.definitions() ?? [],
      // 插件提示词段物化取值器（每请求组装时重取——03 §2.5 注册即生效面）
      pluginSections: () => boot?.promptSections.materialize() ?? '',
      // 审批 always 回写透传（04 §9 定形块写侧律——闭包 dataDir 接 store
      // 文件写；坏形期拒写在 store 内执法，healthy 载入才接线）
      ...(allowlistLoad !== null
        ? {
            allowlist: allowlistLoad.entries,
            ...(dataDir !== null && allowlistLoad.healthy
              ? { persistAllowlist: (draft: AllowlistDraft) => void appendAllowlistEntry(dataDir, draft) }
              : {}),
          }
        : {}),
      warn: (message) => logger.warn(message),
    });

    // —— Job 注册表 + 触发器注册表（C 批 C-3——第十一动词宿主侧真源）：
    // job_settled 总线词先注册（活体事件发射前置——04 §10 内存直推不落库，
    // 幂等跳过已注册词）→ Job 注册表（trigger kind 自登 + 缺省并行帽 4）→
    // 服务面 provide（插件 tryGet('jobs') 消费）→ 触发器注册表（starter 真身
    // 工厂注入——活体开门读取源：/reload 撤位后 fire 复检现判现拒）——
    const jobs = createJobRegistry({
      parallelLimits: { trigger: TRIGGER_JOB_PARALLEL_LIMIT },
      emit: (event) => dispatch.emit('job_settled', event),
      warn: (message) => logger.warn(message),
    });
    jobs.registerKind('trigger');
    provideJobsService(scope, jobs);
    const readOpens = (pluginId: string) => readTriggerOpensLive(dataDir, pluginId);
    const triggers = new TriggerRegistry({
      getOpens: readOpens,
      makeStarter: createTriggerStarterFactory({
        stack,
        jobs,
        getOpens: readOpens,
        workspaceRoot: () => canonicalWorkspaceRoot(),
        warn: (message) => logger.warn(message),
      }),
    });

    // —— 子代理委派机器（D 批 D-2——第十二动词宿主侧真源）：kind 'subagent'
    // 构造自登（与 trigger 同表分立——词汇注册表纪律）；程序化注册面
    // （ctx.agent.registerSubagentProvider 受局面）两闸执法在件内。通知面
    // 桥（批 19c-1 兑现——结算走 submitText source='subagent-settled'
    // backgroundWave 后台唤醒族〔唤醒预算防「父派子→子结算→父再派」自激励
    // 环〕；审批挂起走父驱动 notifySubagentApprovalPending 恰一条幂等面）；
    // 结算钩子 onSettled（goal foldDelegation 喂入 seam）挂 19c-3+ goal 笔
    const subagents = createSubagentService({
      registry: jobs,
      notify: {
        notifySettled: ({ parentSessionId, content }) => {
          const run = stack.submitText(parentSessionId, content, {
            source: 'subagent-settled',
            backgroundWake: true,
          });
          if (run === undefined) {
            logger.warn(`子代理结算通知无处投递（父会话 ${parentSessionId} 无活体驱动）——注册表条目仍终态`);
            return Promise.resolve();
          }
          return run;
        },
        notifyApprovalPending: ({ parentSessionId, jobName, approvalId, toolName, reason }) => {
          const driver = stack.driverOf(parentSessionId);
          if (driver === undefined) {
            logger.warn(
              `子代理审批挂起通知无处投递（父会话 ${parentSessionId} 无活体驱动；Job ${jobName}）——审批仍挂起待答`,
            );
            return Promise.resolve();
          }
          return driver.notifySubagentApprovalPending({
            jobName,
            approvalId,
            toolName,
            ...(reason !== undefined ? { reason } : {}),
          });
        },
      },
      warn: (message) => logger.warn(message),
    });
    // in-process 真工厂注册（批 19c-1 兑现）：委派深度登记表（boot 全局层
    // 工具执行时语境真源）+ DEFAULT_SUBAGENT_PROVIDER 位接线（声明式 def
    // bound provider late-binding 同位解析）
    const delegationSessions = createDelegationSessionTracker();
    subagents.registerProvider(
      DEFAULT_SUBAGENT_PROVIDER,
      createInProcessSubagentProvider({ stack, tracker: delegationSessions, warn: (message) => logger.warn(message) }),
    );

    // —— memory 件 LLM seam 适配器（批 19b-2——词面独立律：memory 席 DAG 无
    // llm 边，LlmService→MemoryLlmFace 的适配归装配根）。UserMessage.timestamp
    // 必填位适配器补（契约无时钟缺省）；priority 缺省 'background'（周期路属
    // 后台道——04 §5 预算闸门执法位）；result 结构超集直返（AssistantMessage
    // ⊇ {content}，文本面提取 llmTextOf 在件内）——
    const runtimeNow = runtime; // let 联合型收窄入 const（闭包捕获用——直接捕 runtime 联合型不进闭包）
    const memoryLlm: MemoryLlmFace = {
      complete: (req) =>
        stack.llm.complete({
          ...(req.systemPrompt !== undefined ? { systemPrompt: req.systemPrompt } : {}),
          messages: req.messages.map((m) => ({ role: 'user' as const, content: m.content, timestamp: Date.now() })),
          priority: req.priority ?? 'background',
        }),
      canAfford: (priority) => stack.llm.canAfford(priority),
    };

    // —— 插件装载：启用清单损坏 fail-loud 属启动失败档（用户可自修配置错——
    // 干净退出不写 crash.log）；余装载失败走行级隔离不入本档 ——
    try {
      boot = await bootPlugins({
        runtime,
        scope,
        dispatch,
        commands: stack.channels.commands,
        llm: stack.llmRuntime,
        triggers, // ctx.triggers.register 受局面（C 批——缺席时该动词响亮缺位）
        subagents, // ctx.agent.registerSubagentProvider 受局面（D 批 D-2——同上）
        noPlugins: options.noPlugins === true,
        version: options.version,
        // core: 官方件注册表缺省单源（批 19a——测试注入面/诊断覆盖经 options；
        // 工厂形升级批 19b-1：dataDir 等宿主真身经 CorePluginHostDeps 入件；
        // 15 件逐纵切笔入册，见 core-plugins.ts）
        corePlugins:
          options.corePlugins ??
          createCorePlugins({
            dataDir: runtime.dataDir,
            // memory 件数据面（批 19b-2——sqlite 主闸恒接线；fts 双 seam 同
            // Store 直传——词面独立律 compat 面，对拍测试互证）
            sqlite: () => runtimeNow.persistence.store.sqlite(),
            // 活体日志优先（write-behind 在飞事件不落盘——driver 在场时读
            // 内存面零缺口）；驱动已收口的外部会话兜底落盘读
            fetchEvents: (sessionId) =>
              stack.driverOf(sessionId)?.session.events() ?? runtimeNow.persistence.loadSession(sessionId).log.events(),
            ftsSearch: runtime.persistence.store,
            ftsMaintenance: runtime.persistence.store,
            llm: () => memoryLlm,
            // 命令输出面（source = 归因字面——调用件自报：memory-export/import
            // 归因 'memory'、/tick 归因 'tick'；sessionId 位呈现侧路由后端自决）
            notify: (source, message) => stack.channels.notify(source, message),
            // 子代理委派面两位（批 19c-1）：service 真身 + boot 全局层工具
            // 执行时语境解析闭包（深度登记表 ?? 根 1；父面枚举 = 活体驱动
            // toolNames 快照——纯对话形 undefined 不可枚举）
            subagents,
            subagentSessionContext: (sessionId) => {
              const depth = delegationSessions.depthOf(sessionId) ?? 1;
              const toolNames = stack.driverOf(sessionId)?.toolNames;
              return { depth, ...(toolNames !== undefined ? { availableTools: toolNames } : {}) };
            },
          }),
        warn: (message) => logger.warn(message),
      });
    } catch (err) {
      await runtime.shutdown(); // 已建资源先收口（幂等六步照走）
      if (err instanceof BaseError && err.code === 'PLUGIN_ROW_INVALID') {
        return {
          ok: false,
          exitCode: 1,
          message: `启动失败：${err.message}`,
          crashed: false,
        };
      }
      throw err; // 余异常走下方崩溃取证档
    }
    Object.assign(pluginCounts, boot.counts); // 披露匣回写（disclosure 后续请求即见）

    // —— skills_change 事件桥（批 19b-1——03 §3.4 通知面汇流点）：registry
    // refresh 快照变化 → 全局词 skills_change 发射（41 钩子词已在 bootPlugins
    // 预注册——dispatch.emit 直用）。桥落宿主侧不落件内：ctx.emit 域名律强制
    // `core:skills/` 前缀——全局词对插件结构性不可达（域名律防插件伪造全局
    // 事件，官方件同受束——宿主侧 dispatch 才是正口）。core:skills 禁用档
    // tryGet 诚实缺席——零桥零事件（缺席即未装载语义）——
    {
      const registry = scope.tryGet('skills') as SkillsRegistry | undefined;
      if (registry !== undefined) {
        const off = registry.onChange(() => {
          // 载荷 = 现行 provider id 清单（06 §11.3——消费面 = 渐进披露清单重物化）
          void dispatch.emit('skills_change', { providers: registry.providerIds() });
        });
        runtime.registerCloser({ label: 'skills-change-bridge', fn: () => Promise.resolve(off()) });
      }
    }

    return { ok: true, runtime, logger, dispatch, scope, stack, boot, pluginCounts };
  } catch (err) {
    // 意外异常 = 崩溃取证档：crash.log 先写（memory 形内建跳过）→ 资源收口 → 归一失败档
    runtime?.writeCrashLog(err);
    await runtime?.shutdown();
    return {
      ok: false,
      exitCode: 1,
      message: err instanceof Error ? err.message : String(err),
      crashed: true,
    };
  }
}

/**
 * 触发器开门授予集活体读取（F10 定形——注册闸与 fire 复检共用源）：每次
 * 现读 enabled.yaml 现解析，/reload 撤位后下一次判即拒。
 *
 * **fail-closed 全失败档一律空集**（文件缺席/不可读/坏 yaml/行校验败/行被
 * 禁用/id 未装载）——与 boot 读侧 fail-loud（PLUGIN_ROW_INVALID 拒启）分立
 * 两律：boot 拦的是启动期配置错；此处拦的是运行期判面，**宁拒不误放**
 * （memory 形 dataDir null 亦空集——core: 官方件直开豁免不经本面）。
 */
export function readTriggerOpensLive(dataDir: string | null, pluginId: string): ReadonlySet<string> {
  if (dataDir === null) return new Set<string>();
  let text: string;
  try {
    text = readFileSync(enabledYamlPath(dataDir), 'utf8');
  } catch {
    return new Set<string>(); // 缺席/不可读 = 全默认关
  }
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return new Set<string>(); // 坏 yaml 宁拒不误放（启动期已 fail-loud——此处防御运行期二次写坏）
  }
  const result = parseEnabledRows(doc);
  if (!result.ok) return new Set<string>();
  const row = result.rows.find((r) => r.id === pluginId);
  if (row === undefined || row.disabled === true) return new Set<string>();
  return new Set<string>(row.opens ?? []);
}
