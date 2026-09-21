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

import { BaseError, parseEventSource } from '../contracts/index.js';
import type { SessionEvent } from '../contracts/index.js';
import { EventDispatch, LogLevelState, Scope, canonicalWorkspaceRoot, createLogger } from '../context/index.js';
import type { Logger, Scope as ScopeType } from '../context/index.js';
import type { Provider } from '../llm/index.js';
import { SUBAGENT_RESERVE_THRESHOLD } from '../llm/index.js';
import { llmTextOf } from '../memory/index.js';
import type { MemoryLlmFace } from '../memory/index.js';
import type { GoalSummarizerFace } from '../goal/index.js';
import type { GoalService } from '../goal/index.js';
import type { RewindForkFace, SessionContextFace } from '../checkpoint/index.js';
import type { ApprovalPolicyMode, SandboxMode, ToolPolicyDraft } from '../safety/index.js';
import {
  DEFAULT_SUBAGENT_PROVIDER,
  createJobRegistry,
  createSubagentService,
  provideJobsService,
} from '../subagent/index.js';
import { createDirProvider } from '../skills/index.js';
import type { SkillsRegistry } from '../skills/index.js';
import { createSsrfGuardedFetch, pinnedFetch } from '../web/index.js';

import { appendToolPolicyEntry, readToolPolicy } from './tool-policy-store.js';
import { readHostSettings } from './settings-store.js';
import { APPROVAL_USAGE, parseApprovalArgv, runApprovalCommand } from './approval-cmd.js';
import { createCorePlugins } from './core-plugins.js';
import type { GoalFace, SubagentLayerResyncHook } from './core-plugins.js';
import { createSessionsFace } from './sessions-face.js';
import { createSandboxDisclosureSource } from './disclosure.js';
import type { ConversationStack } from './conversation-stack.js';
import { createConversationStack } from './conversation-stack.js';
// B3 联动腿装配 seam 工厂（04 §3.3 条 8——authFamily/refreshNow/notify 三注入单点）
import { createHostAuthRefreshSeam } from './auth-refresh-seam.js';
import type { RefreshChainHandle } from '../credentials/index.js';
import { SESSION_LIFECYCLE_EVENT } from '../conversation/index.js';
import type { AgentService, ControlCaller } from '../conversation/index.js';
import { AGENT_SERVICE_NAME } from '../conversation/index.js';
// 工具渲染器注册表受理真源（收官批③——ctx.ui.registerRenderer 委派位；与
// TUI 消费位 lookupToolRenderer 同册两钉——channels 模块级单册）
import { registerToolRenderer } from '../channels/index.js';
import { createWorktreeService } from '../tools/index.js';
import type { CorePluginReference } from './loader.js';
import { createHookDispatchGuard } from './hook-dispatch-guard.js';
import { enabledYamlPath, parseEnabledRows } from './manifest.js';
import type { PluginBootHandle, PluginUnloadReceipt } from './plugin-boot.js';
import { bootPlugins, defaultFs, readEnabledRows } from './plugin-boot.js';
import { createPluginReloader, emptyRollbackReceipt, rollbackFromReport } from './plugin-reload.js';
import type { PluginReloader } from './plugin-reload.js';
import { PLUGINS_CMD_USAGE, runPluginsCommand } from './plugins-command.js';
import { runSessionExportCommand, SESSION_EXPORT_USAGE } from './session-export.js';
import { runPluginConfigForm } from './plugins-config.js';
import { DOORS_USAGE, parseDoorsArgv, runDoorsCommand } from './doors-cmd.js';
import { createDefaultSpawnRunner, createPluginLifecycleTools } from './plugin-tools.js';
import { createPluginStoreFs } from './plugin-store.js';
import type { HostRuntime, HostRuntimeOptions } from './runtime.js';
import { createHostRuntime } from './runtime.js';
import { createIssueSessionFactory } from './issue-session.js';
import { createBudgetBroadcast } from './budget-broadcast.js';
import { createDelegationSessionTracker, createInProcessSubagentProvider } from './subagent-factory.js';
import { budgetAdvisoryMessage } from './budget-advisory.js';
import { TRIGGER_JOB_PARALLEL_LIMIT, TriggerRegistry, createTriggerStarterFactory } from './triggers.js';
// 批 19e HTTP 面族接线：sdk 面工厂（件承载真身）+ issue 并行帽常量 +
// webui 挂载闭包（assembly→webui-bridge→serve-entry→assembly 系声明式
// 函数引用环——顶层零副作用，boot 后才调值，ESM live binding 安全）
import { createSdkHttpFace } from '../sdk/index.js';
import { createPluginRouteRegistry } from '../sdk/index.js';
import { ISSUE_GITHUB_TOKEN_NAME, ISSUE_PARALLEL_LIMIT_DEFAULT, ISSUE_WEBHOOK_SECRET_NAME } from '../issue/index.js';
import { HOST_NAMESPACE, createOAuthFlowRegistry } from '../credentials/index.js';
// 进程级 durable 审计流面（05 §9 audit_events——U3 批 U3-5 载体真接线）
import { createAuditFace, createLoadHistoryFace } from '../persist/index.js';
import { mountWebuiOnFace } from './webui-bridge.js';

/** 装配阶段词汇（TUI 启动动画「加载 XXX」的骨架刻度——装配序既有边界词汇化） */
export type HostBootStage = 'runtime' | 'stack' | 'plugins' | 'skills' | 'subagents' | 'ready';

/** 装配阶段事件（start/end 两相位 + 可选 detail——如 plugins 尾事件携计数） */
export interface HostBootStageEvent {
  readonly stage: HostBootStage;
  readonly phase: 'start' | 'end';
  readonly detail?: string;
}

/** 装配阶段监听器（启动动画消费面；回调异常由装配根隔离不反噬装配序） */
export type HostBootStageListener = (event: HostBootStageEvent) => void;

/** 装配选项（TUI 入口与诊断命令共用面——runtime 子面透传 createHostRuntime） */
export interface AssembleHostOptions {
  /** 运行时组装选项（dataDir/memory 组合形由此定形：memory+dataDir = 同构诊断形） */
  readonly runtime: Omit<HostRuntimeOptions, 'pluginsProvider'>;
  /** 安全模式（--no-plugins——装载面整跳） */
  readonly noPlugins: boolean;
  /**
   * 快速试件路径（--plugin-file——03 §7 生态启动批 eco-3a）：只管启动期注入
   * `_quick_test` 合成行；/reload 换代 reapply 恒单参调用（本旗标不随换代
   * ——不变式 4：全量重载后试件行不再合成）。与 noPlugins 同给 = 安全模式
   * 优先（bootPlugins 短路在前）。
   */
  readonly pluginFile?: string;
  /** 日志提级（--debug——env 已设时让位律在件内执法） */
  readonly debug: boolean;
  /** 宿主版本（HostFace 物化位） */
  readonly version: string;
  /**
   * 宿主 API 面版本（ag 批 DP2——03 §8.4 定形注④）：**测试注入面**——缺省
   * 恒从宿主 package.json 同文件补读 apiVersion（readHostApiVersion——与
   * readVersion 同文件同源；人工同步纪律消灭）。
   */
  readonly apiVersion?: string;
  /** 初始 provider 集（缺省真 provider 全家桶——与 TUI 入口同路） */
  readonly providers?: readonly Provider[];
  /** 模型标识（缺省 BERRY_AGENT_MODEL 覆盖律——栈内解析） */
  readonly model?: string;
  /** env 面（缺省 process.env——日志级解析与模型覆盖律同源） */
  readonly env?: Record<string, string | undefined>;
  /** 沙箱档位取值器（透传组合根） */
  readonly sandboxMode?: () => SandboxMode;
  /** 沙箱档来源标注（/approval status 呈现——CLI 层胜者由入口注入，如「CLI --read-only」/「CLI --preset open」） */
  readonly sandboxModeSource?: string;
  /** 审批策略档（04 §9 两旋钮之二——CLI --preset/--旗标层胜者；缺省走 settings.json 持久层或代码常量 'ask'） */
  readonly approvalPolicy?: ApprovalPolicyMode;
  /** 审批策略档来源标注（同 sandboxModeSource） */
  readonly approvalPolicySource?: string;
  /** 运行时组装后回调（信号/崩溃编舞切运行时本体——main attachRuntime） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** core: 官方件注册表（缺省 CORE_PLUGINS 单源——批 19a 起逐纵切笔入册；测试注入面/诊断覆盖经本位） */
  readonly corePlugins?: readonly CorePluginReference[];
  /**
   * goal 全环服务宿主捕获位透传（s 批——CorePluginHostDeps.goalServiceSink
   * 同形）：生产装配恒缺席；e2e rig 经 assembleHostStack 全真链捕获全环
   * service（provide 投影律下 tryGet 只见六法——写动词 lifecycle 测试通道，
   * U10「goal 生产创建入口缺席」立题前）。
   */
  readonly goalServiceSink?: (service: GoalService) => void;
  /** 警示面（缺省 stderr 直写） */
  readonly warn?: (message: string) => void;
  /**
   * 装配阶段回调（TUI 启动动画供数位——三反馈批 D 先行件2）：装配序既有边界
   * 发射六阶段（runtime/stack/plugins/skills/subagents/ready）start/end 两
   * 相位事件（ready 瞬时相位只发 end）。回调异常被装配根 try/catch 隔离降
   * warn（呈现面不反噬装配序——fail-open）。本面只覆盖 assembleHostStack
   * 内段——openStartupSession/backend.start 等装配后段归入口层续调同一
   * 回调（tui-entry 消费）。缺席 = 零行为变化。
   */
  readonly onBootStage?: HostBootStageListener;
  /**
   * 逐插件装载起步回调（loader onPluginStart 的装配根透传位——动画逐插件
   * 行供数：pluginId + 序号 1..N + 初始待装总数）。经 bootPlugins →
   * loadPlugins Kahn 轮每行装载前达；runBoot 每轮调用均供数（/reload 换代
   * 重跑同达——换代期动画呈现属入口层决策）。回调异常同被隔离降 warn。
   * 缺席 = 零行为变化。
   */
  readonly onPluginLoadStart?: (pluginId: string, index: number, total: number) => void;
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
  /**
   * /reload 编舞器（03 §5.7——busy 排队/失败三档/reloadChain 串行）：TUI
   * 命令面已在本装配根注册（'reload' 词）；本柄外露 = 测试与入口层直驱。
   */
  readonly reloader: PluginReloader;
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
  // 钩子派发段 guard（03 §3.4 执法形——cache 经济批 ca-3）：全局单实例深度
  // 计数；两窄面分路注入——enter/exit 随 bootPlugins 透传插件 ctx（钩子派发
  // 两腿开合）、只读面随 conversation-stack 注入 llm 双入口前置查
  // （LLM_CALL_IN_HOOK）。同一真身保证「谁开窗谁可见」跨插件嵌套正确
  const hookDispatchGuard = createHookDispatchGuard();
  // 披露第六件晚绑定槽（F2——2026-09-17 会话档位切换面批）：沙箱行数据源
  // 依赖 stack（会话事件读面 driverOf）与 logger（warn 降级位）——两者均在
  // runtime 之后创建，故闭包经本槽晚绑定（bootTools 同法先例）；runtime 的
  // sandboxModeProvider 每请求重算现取槽内值，undefined = 行省略（boot 前请
  // 求形）。坏词 fold 抛在源内 warn 降级返 undefined——披露位不炸请求。
  let sandboxDisclosureSource: ((sessionId?: string) => string | undefined) | undefined;
  let runtime: HostRuntime | undefined;
  // logger 晚绑定槽（装配阶段回调隔离 warn 的落点）：const logger 在 'runtime'
  // 阶段之后才创建——闭包直引在初始化前调用 = TDZ ReferenceError，故经本槽
  // 间接（bootTools/sandboxDisclosureSource 晚绑同法先例）
  let loggerRef: Logger | undefined;
  // 装配阶段回调发射口（TUI 启动动画供数——三反馈批 D 先行件2）：异常
  // try/catch 隔离降 warn（动画是呈现面，挂了启动照走——fail-open）。warn
  // 落点先 loggerRef（已建期）回退 options.warn（logger 未建期）
  const emitBootStage = (stage: HostBootStage, phase: 'start' | 'end', detail?: string): void => {
    if (options.onBootStage === undefined) return;
    try {
      options.onBootStage({ stage, phase, ...(detail !== undefined ? { detail } : {}) });
    } catch (err) {
      const message = `装配阶段回调异常（${stage}/${phase}，已隔离不反噬装配序）：${
        err instanceof Error ? err.message : String(err)
      }`;
      if (loggerRef !== undefined) loggerRef.warn(message);
      else options.warn?.(message);
    }
  };
  try {
    // —— 运行时组装（单活跃机 + 开库 fail-loud——干净退出档，非崩溃取证档）——
    emitBootStage('runtime', 'start');
    try {
      runtime = createHostRuntime({
        ...options.runtime,
        pluginsProvider: () => ({ ...pluginCounts }),
        // 沙箱行第六件真源（F2）：晚绑定槽取面（见上方槽注）——每请求重算
        sandboxModeProvider: (sessionId?: string) => sandboxDisclosureSource?.(sessionId),
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
    emitBootStage('runtime', 'end');

    // —— logger 装配：env 解析 + --debug 提级让位律（env 已设时让位）——
    const env = options.env ?? process.env;
    const logState = LogLevelState.fromEnv(env.BERRY_AGENT_LOG_LEVEL);
    if (options.debug && env.BERRY_AGENT_LOG_LEVEL === undefined) logState.setGlobalLevel('debug');
    const logger = createLogger('host', logState);
    loggerRef = logger; // 阶段回调隔离 warn 落点回填（上方晚绑槽）

    // —— 跨会话工具策略表装配期载入（04 §9 粘性第 3 款定形块读侧律——
    // dataDir 在场即真读〔含同构诊断形：报告真实装载会走到的路〕；纯 memory
    // 形 dataDir null 双缺〔无归属地〕。坏形 warn 降级 + 回写拒在 store 内执法；
    // 旧 allowlist.json 升格读入在 store 内执法——2026-09-11 审批分档批）——
    const dataDir = runtime.dataDir;
    const toolPolicyLoad = dataDir !== null ? readToolPolicy(dataDir, { warn: (m) => logger.warn(m) }) : null;

    // —— settings.json 持久缺省层（04 §9 ⑥ ap-3——§8 解析链第四层执法位：
    // 工具参数 > 会话策略 > CLI 旗标（逐次） > 本文件 > 代码常量。持久位
    // 只填 gaps：CLI 显式位在场即胜、本层不覆盖〔下方条件透传〕。dataDir
    // 在场即真读；坏形 warn 降级视同缺席〔配置层坏形取缺省非 fail-stop 面，
    // 与策略表坏形拒写分立——彼为用户资产写前校验、此为读侧降级〕）——
    const settingsLoad = dataDir !== null ? readHostSettings(dataDir, { warn: (m) => logger.warn(m) }) : null;
    const settingsMode = settingsLoad?.settings.sandboxMode;
    const settingsPolicy = settingsLoad?.settings.approvalPolicy;

    // —— 进程级 durable 审计流载体（05 §9 audit_events——U3 批 U3-5 真接线）：
    // 单写者 = 本装配根（boot plugin/opens 幂等 diff + 触发器/凭证/人面三
    // 受理 seam + 高危面动词 auditSink——插件面零写入位）；:memory: 诊断形
    // 同构接线（载体即内存库——durable 性诚实于载体）
    const audit = createAuditFace(runtime.persistence.store.connection);

    // —— 装载史世代面（05 §9 load_generations——装载史批 h-3 写点接线）：
    // boot 完成尾落行、/reload reapply 尾换代（写点收在 bootPlugins 完成尾
    // ——双点单写点同源）；:memory: 诊断形同构接线（载体即内存库——durable
    // 性诚实于载体，audit 同律）
    const loadHistory = createLoadHistoryFace(runtime.persistence.store.connection);

    // —— 插件道路由受理器（U5-2——03 §2.2 第十三面/§10.6 时序缝定形）：
    // host-owned 单真身（受理与挂载两时点解耦的账）；受理恰一笔审计落
    // capability/used（05 §1.1——method+path 全路径归因键，拒路径零审计）。
    // 消费两路：bootPlugins fork 绑定（装载序受理入账）+ 三入口开面
    // snapshot replay / attachFace 晚注册（kit 经 core:sdk 件透传——见
    // CorePluginHostDeps.sdkPluginRoutes）；:memory: 诊断形同构接线
    const pluginRoutes = createPluginRouteRegistry({
      onCapabilityUsed: (record) => audit.append('capability/used', { ...record }),
    });

    // —— 共享根作用域与事件总线已前移运行时组装之前（批 19b-2 活体镜像桥位）——
    // 装载柄前置声明（批 19a 消费腿闭包晚绑定：stack 先建、boot 后跑，会话
    // 首开/请求组装时闭包经此引用取已定型产物——boot.tools 全局层定义重放
    // 与 promptSections 物化两条消费腿同法）；/reload 换代 = 重新赋值本变量
    // （取值器每请求重取——热重载换入面结构性预埋，03 §5.7）
    let boot: PluginBootHandle | undefined;
    // 卸载换代槽（/reload 批——03 §5.7）：bootPlugins 每代改写槽内 current，
    // 下方一次性 closer 读槽——shutdown 恒跑最新代回卷，reload 换代不累积
    // 重复 closer（closer 数组无摘除面，间接层替代）
    const pluginUnloadRef: { current: (() => Promise<PluginUnloadReceipt>) | null } = {
      current: null,
    };
    // boot 重跑闭包（try 内定型——全部 seam 真身闭包捕获；/reload reapply 与
    // 首次 boot 同一函数 = 同一装载面，无第二装配序）
    // pluginFile 第二参（eco-3a——03 §7 不变式 4 单源保证）：reapply 恒单参
    // 调用即 pluginFile undefined = 试件行换代消失；类型可选 + 调用点唯一性
    let runBoot: ((noPluginsFlag: boolean, pluginFile?: string) => Promise<PluginBootHandle>) | undefined;
    // 最近真用户消息时刻（批 20c——scheduler GateFacts lastUserMessageAt 宿主
    // 源）：boot 后 session/event 监听器更新（user/channel 真人输入才计——
    // schedule/subagent-settled/compaction/plugin 注入不计数）；null = 无近期
    // 消息（recent_user_msg 门放行）
    let lastUserMessageAt: string | null = null;
    // —— 插件生命周期模型工具族（03 §5.6——task #89 笔三）：宿主固定八件
    // 恒挂载，boot 全局层并入（effect:'write' 五件经守门管道审批对自动执法）；
    // report 取值器 = 换代闭包（boot 后定型、/reload 后即新代投影）；审计
    // sink 与 TUI 命令面同一包装（进程内单写者 audit face——落账失败 warn
    // 不阻塞主流程，行编辑已生效不回滚）；spawn = execFile 真身（npm/git 装
    // 机走进程外——07 §5 用户显式动作族不进 exec 沙箱体系，与 CLI 同面）；
    // events_query 两窄面 = 同实例 persistence（flushFirst + queryEvents）；
    // db = store.sqlite()（卸载预检域面查询——宿主固定件正当消费）。纯
    // memory 形 dataDir null 时 conversation-stack 不消费 bootTools——本族
    // 自然缺席（memory 形工具整面缺席同律）。persistence 先收 const——下方
    // 闭包取值（let runtime 的流窄化不进闭包）
    const persistence = runtime.persistence;
    const pluginLifecycleTools = createPluginLifecycleTools({
      dataDir,
      fs: createPluginStoreFs(),
      auditSink: (type, payload) => {
        try {
          audit.append(type, payload);
        } catch (err) {
          logger.warn(
            `生命周期审计落账失败（${type}）：${err instanceof Error ? err.message : String(err)}——主流程不受影响`,
          );
        }
      },
      spawn: createDefaultSpawnRunner(),
      env,
      report: () => boot?.report,
      flush: () => persistence.flush(),
      queryEvents: (filter) => persistence.store.queryEvents(filter),
      db: persistence.store.sqlite(),
    });
    // 单会话收口订阅槽（2026-09-13 复盘发现 ⑯——memory 件简报冻结缓存收口
    // 摘除）：stack retire 观察 → 当前代 feed；core 件订阅 → 覆写槽。末位
    // 覆写语义：/reload 换代 boot 重跑、新 memory 件重订阅即顶替旧代 feed
    // （旧代缓存随旧件废弃，无累积无泄漏——槽消费懒取时点恒当前代）
    let sessionRetireFeed: ((sessionId: string) => void) | undefined;
    // B3 联动腿链句柄槽（04 §3.3 条 8）：core:credentials 受局面在场链创建后
    // 经 credentialsChainSink 填（装载期）；seam.refreshNow 运行期惰性取——
    // stack 创建（下方）先于 core 件装载，闭包捕获变量绑定零时序倒挂。
    // 换代重装载 = 末位胜出（新链覆写，旧链随件 dispose 停钟）
    let credentialsChain: RefreshChainHandle | undefined;
    // worktree 服务装配根单真身（04 §7 补钉① + 03 §10.7 六役定形注）：
    // ConversationStack.worktree（会话内三工具挂载 + fence grantedRoots
    // live 并入）与 core 件 issue 编排授予共享同一实例——授予记账单源
    // （件侧 grant 与会话内 create 自动授予同台账）；仓根锚 canonical 单源
    const worktreeService = createWorktreeService({ repoRoot: canonicalWorkspaceRoot() });
    emitBootStage('stack', 'start');
    const stack = createConversationStack({
      runtime,
      scope,
      dispatch,
      // B3 宿主凭证刷新联动腿 seam 真值（04 §3.3 条 8——authFamily 真 import
      // llm / refreshNow 桥链句柄〔env-static 前判 + 链缺席 no-refresh-face〕/
      // notify 产品级指路 + per-provider×outcome 进程内一次去重〔M4〕）
      authRefresh: createHostAuthRefreshSeam({
        getChain: () => credentialsChain,
        env,
        notifyChannel: (source, message) => stack.channels.notify(source, message),
      }),
      // 钩子派发段只读面（ca-3——llm 双入口 LLM_CALL_IN_HOOK 前置查）
      hookDispatchGuard,
      // worktree 消费接线（见上方单真身注——件/栈同源双注之一）
      worktree: worktreeService,
      ...(options.providers !== undefined ? { providers: options.providers } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
      // 第四层 gaps 填充（ap-3）：CLI 显式位缺席时 settings.json 持久缺省
      // 补位——两旋钮同律；settings 亦缺席 = 组合根代码常量缺省
      ...(options.sandboxMode === undefined && settingsMode !== undefined
        ? { sandboxMode: (): SandboxMode => settingsMode }
        : {}),
      ...(options.approvalPolicy !== undefined ? { approvalPolicy: options.approvalPolicy } : {}),
      ...(options.approvalPolicy === undefined && settingsPolicy !== undefined
        ? { approvalPolicy: settingsPolicy }
        : {}),
      // 装载工具定义重放取值器（会话装配时点 boot 已定型——noPlugins/装载
      // 失败形 boot.tools 为空注册表，取值器返回 [] 零打扰）；插件生命周期
      // 模型工具族八件恒并入宿主全局面（03 §5.6——先于插件注册面，插件侧
      // 撞名即装载失败 fail-loud）
      bootTools: () => [...(boot?.tools.definitions() ?? []), ...pluginLifecycleTools],
      // 插件提示词段物化取值器（每请求组装时重取——03 §2.5 注册即生效面；
      // sessionId 透传 materialize → builder〔cache 经济批 ca-2——每会话懒
      // 冻结类段消费〕）
      pluginSections: (sessionId: string) => boot?.promptSections.materialize(sessionId) ?? '',
      // 审批 always 回写透传（04 §9 定形块写侧律——闭包 dataDir 接 store
      // 文件写；坏形期拒写在 store 内执法，healthy 载入才接线）
      ...(toolPolicyLoad !== null
        ? {
            toolPolicy: toolPolicyLoad.entries,
            ...(dataDir !== null && toolPolicyLoad.healthy
              ? { persistToolPolicy: (draft: ToolPolicyDraft) => void appendToolPolicyEntry(dataDir, draft) }
              : {}),
          }
        : {}),
      // goal 段升格锚（批 19c-3——03 §10.5 组合根闭包）：lazy 共享根取面
      // （stack 先建 boot 后跑——goal 件未装载 = undefined，fold 退化
      // run-scoped 现行为；goalScopeFor 调用面 = 驱动每请求 fold）
      goalScopeFor: (sessionId) => scope.tryGet<GoalFace>('goal')?.service.goalScopeFor(sessionId),
      // goal 轮间沉淀取值器（批 #99——04 §3.7）：depositFor 同步返缓存/回退
      // （指纹缓存单发在 goal 件内——同指纹零 LLM），goal 未装载 = null 零注入
      goalDeposit: (sessionId) => scope.tryGet<GoalFace>('goal')?.service.depositFor(sessionId) ?? null,
      // 预算预警取值器（批 H——04 §5 三档软着陆 + 2026-09-13 修复批 run 级
      // 后台性判据）：origin 会话级两判（'trigger' headless root / 'delegation'
      // 子代理）+ backgroundLane run 级声明位（tick 用户行/goal 挂钟行/run
      // --background 的 conversation 会话后台 run）——前台 run 恒 null 零注入，
      // 文案分族铸造在 host/budget-advisory 纯函数族（投影读面 =
      // stack.llm.backgroundUsage 与 canAfford 同账）
      budgetAdvisory: (sessionId, backgroundLane) => {
        const origin = stack.manager.listActive().find((row) => row.sessionId === sessionId)?.origin;
        return budgetAdvisoryMessage(stack.llm.backgroundUsage(), origin, backgroundLane);
      },
      // goal 前台记账腿（批 #99——04 §5 双轨 + 三入口统一）：run settled 链
      // 回执（窗扫 assistant/message 计数 + userInitiated 归因）→ recordTurn；
      // braked 即 warn 呈现；钩内异常驱动 noteRunSettled 自防炸兜底
      onRunSettled: (sessionId, receipt) => {
        const face = scope.tryGet<GoalFace>('goal');
        const goalScope = face?.service.goalScopeFor(sessionId);
        if (face === undefined || goalScope === undefined) return;
        const turn = face.service.recordTurn(goalScope.goalId, {
          userInitiated: receipt.userInitiated,
          messages: receipt.assistantMessages,
        });
        if (turn.braked) {
          logger.warn(
            `goal「${goalScope.goalId}」前台预算帽已到（已用 ${turn.used}/${turn.cap ?? '∞'} 轮）——recordTurn 刹停（后续 agent_pre_step 复验拒新请求）`,
          );
        }
      },
      // 单会话收口观察穿线（发现 ⑯）：manager retire 成功路 → 当前代订阅 feed
      onSessionRetired: (sessionId) => sessionRetireFeed?.(sessionId),
      // 会话关闭收口接线（六役 CL-C ④——04 §10 closeOwner 段消费位）：owner =
      // 会话 id 形的围栏由会话终态收口序收口——retire 成功路 + dispose 全量
      // 拆解路两路逐会话 → closeOwner（与插件卸载 closer 宿主位两路同源）。
      // jobs 在 stack 后建（晚绑定闭包——发射时点恒在装配完成后，调用时点
      // jobs 必已初始化）；closeOwner 返回 Promise——同步收口序里
      // fire-and-forget（void 吞并：finalize 同步推进不留孤儿悬空，异步腿
      // 不阻塞会话收口）
      onSessionClosed: (sessionId) => void jobs.closeOwner(sessionId),
      // 跨树观测门检接线（e2-4——03 §4.6 第五枚 sessions.observe-cross 工具
      // 腿；开门制扩展批 2026-09-09 授予面接线）：模型道门检输入 = doors 段
      // 单独（活体读——受理时点现读现判，撤位即收回；插件道订阅走 plugin-context
      // 分立判定位不经本 seam）；onCapabilityUsed = 开门后逐次审计（05 §1.1
      // 键 = 动词名 + 目标会话 id——工具腿载荷原形透传）
      observeCross: {
        getOpens: () => readDoorsSegmentLive(dataDir),
        onCapabilityUsed: (record) => void audit.append('capability/used', { ...record }),
      },
      // 跨会话操控门检接线（e4-3——03 §4.6 第六枚 sessions.control-cross
      // 双面同门；开门制扩展批 2026-09-09 授予面接线）：getOpensFor = caller
      // 感知合成（03 §4.6 双源并集律——createControlOpensFor 单源；受理器门检
      // 位逐次现读现判）；onCapabilityUsed = 门开后逐次审计（05 §1.1
      // ControlUsedRecord——动词名 + 目标会话 id + 双道归因键原形透传）
      controlCross: {
        getOpensFor: createControlOpensFor(dataDir),
        onCapabilityUsed: (record) => void audit.append('capability/used', { ...record }),
      },
      warn: (message) => logger.warn(message),
    });
    emitBootStage('stack', 'end');

    // —— 披露第六件铸造（F2——2026-09-17 会话档位切换面批）：stack 既建、
    // logger/settingsMode 既得，晚绑定槽回填（runtime 侧 sandboxModeProvider
    // 此后每请求重算即见）。boot 解析 = CLI 旗标 > settings.json > 代码常量
    // workspace-write（M2：恒显式解析值传 fold fallback——settings 显式
    // danger 属用户显式授权，非「非 danger」缺省；与 /approval status 快照
    // 同序单源——effectiveMode 同法）。eventsOf = driverOf 活引用（未开会话
    // / 缺键 = 空数组 → fold 落 boot）；坏词 warn 降级在源内执法（披露位不
    // 炸请求——与工具位 fail-closed 分位）。
    const bootSandboxMode: SandboxMode =
      options.sandboxMode !== undefined
        ? options.sandboxMode()
        : settingsMode !== undefined
          ? settingsMode
          : 'workspace-write';
    sandboxDisclosureSource = createSandboxDisclosureSource({
      boot: bootSandboxMode,
      eventsOf: (sessionId?: string) =>
        sessionId !== undefined ? (stack.driverOf(sessionId)?.session.events() ?? []) : [],
      warn: (message) => logger.warn(message),
    });

    // —— 'sessions' 受理面基础面真身（ag 批 cs-D2——03 §4.5 定形注：共享根
    // provision 形态**废止**，本面改经 bootPlugins options.sessions 逐插件
    // fork 绑定〔bindSessionsForPlugin——caller 归因 plugin:<行id> 宿主单方
    // 拼装 + 行籍闸绑换代死域；共享根结构性无此名〕；cs-D1 sessions 完整
    // 受理面批 2026-09-15 扩面：只读四件 + storeStateFor 五件全接——currentSessionId
    // 判据 v1 = SessionManager 活体 Map 尾键〔listActive().at(-1)——最新首次
    // 入册、幂等复开不移尾〕；queryEvents/store_state 裸动词经 persistence
    // 透传〔帽/游标/LRU/ttl 治理单源在 persist〕；kv/written 审计面 = audit
    // 单写者〔05 §9〕）。活引用 driverOf（调用时点解析——/new 热切换安全）；
    // 无活体驱动 = undefined 降级（消费方 core:memory 差分落账腿捕获降级——
    // mirror 不锁步）；二道闸（核心词拒写 + 未注册词拒写）+ 归因盖章在绑定面
    // 闭包内执法。runtimeNow = let 联合型收窄入 const（闭包捕获用——原 :559
    // 位前移，本面 deps 闭包同为消费方）
    const runtimeNow = runtime;
    const sessionsFace = createSessionsFace({
      driverOf: (sessionId) => stack.driverOf(sessionId),
      currentSessionId: () => stack.manager.listActive().at(-1)?.sessionId,
      queryEvents: (filter) => runtimeNow.persistence.queryEvents(filter),
      storeState: {
        get: (key) => runtimeNow.persistence.store.getStoreState(key),
        set: (key, value, options) => runtimeNow.persistence.store.setStoreState(key, value, options),
        delete: (key) => runtimeNow.persistence.store.deleteStoreState(key),
      },
      onStateWritten: (payload) => audit.append('kv/written', { ...payload }),
    });

    // —— Job 注册表 + 触发器注册表（C 批 C-3——第十一动词宿主侧真源）：
    // job_settled 总线词先注册（活体事件发射前置——04 §10 内存直推不落库，
    // 幂等跳过已注册词）→ Job 注册表（trigger kind 自登 + 缺省并行帽 4）→
    // 服务面 provide（插件 tryGet('jobs') 消费）→ 触发器注册表（starter 真身
    // 工厂注入——活体开门读取源：/reload 撤位后 fire 复检现判现拒）——
    const jobs = createJobRegistry({
      parallelLimits: { trigger: TRIGGER_JOB_PARALLEL_LIMIT, issue: ISSUE_PARALLEL_LIMIT_DEFAULT },
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
        // capability/used 逐次落账（triggers.start-run 腿——C 批挂账 U3-5 兑现；
        // core: 豁免门检照记——豁免免的是门不是账）
        onCapabilityUsed: (pluginId, triggerName) =>
          audit.append('capability/used', { pluginId, capability: 'triggers.start-run', triggerName }),
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
      // 单父扇出帽旋钮面（RP2——04 §10 扇出帽段：env BERRY_AGENT_MAX_CONCURRENT_
      // SUBAGENTS > 缺省 8；坏形 fail-loud 启动当场红）
      env,
      notify: {
        notifySettled: ({ parentSessionId, content }) => {
          // 车道随起跑方声明位单源（04 §5 机器注入轮枚举扩——第四役）：结算
          // 通知轮是机器注入轮，submit 恒置 backgroundLane——桥接 llm/usage
          // 记账进后台日池（修前恒 foreground，日池对结算通知轮 token 失明）
          const run = stack.submitText(parentSessionId, content, {
            source: 'subagent-settled',
            backgroundWake: true,
            backgroundLane: true,
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

    // —— oauth 流注册表（c-6——03 §10.9 oauth 案）：host-owned 单真身
    // （createJobRegistry 同形先例——纯内存装载代内生命周期），三消费位共
    // 用同表：plugin-boot fork 绑定（ctx.secrets.registerOAuthFlow 注册面）+
    // core:credentials 人面动词（/credentials oauth 解析腿）+ 刷新链巡检面。
    // SSRF 守卫 fetch（2026-09-09 守卫批——挂账收口）：web 卫生单源包裹真身
    // fetch（协议白名单 + 字面/DNS 私网拒 + redirect 钉 manual 不跟随）——
    // credentials 件无 web 边（loop 只认 StreamFn 同律），守卫属宿主裁决权
    // 装配位注入；人面发起腿与刷新链腿共用同守卫实例。底层腿 = dns-pin
    // 同包 pinnedFetch（rb-2 勘正——fetch 与钉死 dispatcher 同包律；旧形
    // 全局 fetch × 包 Agent 在现役配对下确定性互斥必抛，跨包形禁区）
    const oauthFlows = createOAuthFlowRegistry();
    const oauthFetch = createSsrfGuardedFetch(pinnedFetch);
    // in-process 真工厂注册（批 19c-1 兑现）：委派深度登记表（boot 全局层
    // 工具执行时语境真源）+ DEFAULT_SUBAGENT_PROVIDER 位接线（声明式 def
    // bound provider late-binding 同位解析）
    const delegationSessions = createDelegationSessionTracker();
    subagents.registerProvider(
      DEFAULT_SUBAGENT_PROVIDER,
      createInProcessSubagentProvider({
        stack,
        tracker: delegationSessions,
        warn: (message) => logger.warn(message),
        // reserve 线判定（批 H——04 §5 非交互子代理 90% 线强停）：投影读面与
        // 预警三档同账（backgroundUsage 单源），阈值常量 SUBAGENT_RESERVE_THRESHOLD
        reserveBreached: () => stack.llm.backgroundUsage().ratio >= SUBAGENT_RESERVE_THRESHOLD,
        // skills 键解析位（⑤ 批——06 §11.6 skills 键存在性执法的装配位单
        // 真身）：scope 晚绑取用与 resyncPluginSkillLayers/closer 同形（换代
        // 自适——/reload 重挂 core:skills 即换新 registry 实例）；--no-plugins
        // 或 core:skills 缺席形 tryGet undefined → skills 键 spawn 拒
        //（fail-closed 同 requires 语义，不静默丢注入）
        resolveSkill: (name) => scope.tryGet<SkillsRegistry>('skills')?.get(name),
      }),
    );
    // boot 全局层工具执行时语境解析闭包（批 19c-1——深度登记表 ?? 根 1；
    // 父面枚举 = 活体驱动 toolNames 快照，纯对话形 undefined 不可枚举）：
    // 两消费位同源单闭包——core:subagent 件 deps 位与程序化腿物化 toolDeps
    // （遗漏审计批 G——注册即派生消费腿与声明式腿同语境同形）
    const subagentSessionContext = (sessionId: string) => {
      const depth = delegationSessions.depthOf(sessionId) ?? 1;
      const toolNames = stack.driverOf(sessionId)?.toolNames;
      return { depth, ...(toolNames !== undefined ? { availableTools: toolNames } : {}) };
    };
    // 插件层物化钩子槽（RP5 物化腿——runBoot 内 core:subagent apply 经 sink
    // 覆写本槽〔末位胜出——/reload 换代重挂〕；resyncPluginAgentLayers 于
    // 装载收口后经此取钩子喂 activated 行的 agentDirs 投影）
    let subagentLayerResyncHook: SubagentLayerResyncHook | undefined;

    // —— memory 件 LLM seam 适配器（批 19b-2——词面独立律：memory 席 DAG 无
    // llm 边，LlmService→MemoryLlmFace 的适配归装配根）。UserMessage.timestamp
    // 必填位适配器补（契约无时钟缺省）；priority 缺省 'background'（周期路属
    // 后台道——04 §5 预算闸门执法位）；result 结构超集直返（AssistantMessage
    // ⊇ {content}，文本面提取 llmTextOf 在件内）——
    const memoryLlm: MemoryLlmFace = {
      complete: (req) =>
        stack.llm.complete({
          ...(req.systemPrompt !== undefined ? { systemPrompt: req.systemPrompt } : {}),
          messages: req.messages.map((m) => ({ role: 'user' as const, content: m.content, timestamp: Date.now() })),
          priority: req.priority ?? 'background',
          // 单发计量归因（04 §5 mq）：sessionId 穿线 → metering 声明（真源在
          // review/consolidate 调用位——本适配器只透传）
          ...(req.sessionId !== undefined ? { metering: { sessionId: req.sessionId } } : {}),
        }),
      canAfford: (priority) => stack.llm.canAfford(priority),
    };

    // —— goal 件摘要 seam 适配器（批 #99——词面独立律同上：goal 席 DAG 无 llm
    // 边，LlmService→GoalSummarizerFace 适配归装配根）：04 §3.7 轮间沉淀
    // complete 单发；priority 恒 'background'（周期道预算闸门执法位——沉淀属
    // 后台道非用户可见请求）；结果文本面提取 llmTextOf（memory 件单源复用）
    // + maxChars 截断（超帽截断归实现侧——GoalSummarizerFace 契约）。
    const goalSummarizer: GoalSummarizerFace = {
      complete: async (req) => {
        const result = await stack.llm.complete({
          messages: [{ role: 'user', content: req.prompt, timestamp: Date.now() }],
          priority: 'background',
          // 单发计量归因（04 §5 mq）：goal 绑定会话穿线 → metering 声明
          ...(req.sessionId !== undefined ? { metering: { sessionId: req.sessionId } } : {}),
        });
        return { text: llmTextOf(result.message.content).slice(0, req.maxChars) };
      },
    };

    // —— issue 凭证迁移（c-5——03 §10.9「env 与库优先级」兑现）：插件凭证
    // 库优先（host 域两名 github-token / issue-webhook-secret——/credentials
    // add 录入即生效，词面收编入盒）、env 过渡载体回落（既有装机不破——
    // BERRY_AGENT_GITHUB_TOKEN / BERRY_AGENT_ISSUE_WEBHOOK_SECRET 19e 词面
    // 维持）；密钥腐坏 PERSIST_SECRET_UNREADABLE fail-loud 既有律维持（store
    // 读抛即装配失败档——不静默降级 env）
    const issueToken =
      runtimeNow.persistence.store.getCredential(HOST_NAMESPACE, ISSUE_GITHUB_TOKEN_NAME)?.apiKey ??
      (env.BERRY_AGENT_GITHUB_TOKEN !== '' ? env.BERRY_AGENT_GITHUB_TOKEN : undefined);
    const issueSecret =
      runtimeNow.persistence.store.getCredential(HOST_NAMESPACE, ISSUE_WEBHOOK_SECRET_NAME)?.apiKey ??
      (env.BERRY_AGENT_ISSUE_WEBHOOK_SECRET !== '' ? env.BERRY_AGENT_ISSUE_WEBHOOK_SECRET : undefined);

    // —— 宿主级 budget-extended 广播件（u-3——04 §5 定形注①：canAfford 恢复
    // watcher 自 issue 会话工厂私有升格宿主件，装配根单真身三停靠面同播
    // [issue 停靠项 / goal 停靠项 / 会话级停靠项]；电平判语义不变——有停靠
    // 项且 canAfford 恢复即触发，恢复判据覆盖日池翻转与提额两形）。
    // canAfford 窄面与 issue 工厂同源单点（stack.llm.canAfford('background')）
    const budgetBroadcast = createBudgetBroadcast({
      canAfford: () => stack.llm.canAfford('background'),
    });
    runtime.registerCloser({
      label: 'budget-broadcast',
      fn: () => Promise.resolve(budgetBroadcast.dispose()),
    });

    // —— issue headless 会话真工厂（成熟度缺口 #5——04 §5 停靠/唤醒腿的
    // 生产承载；subagent-factory 同族 in-process 形）：canAfford 窄面注入
    // background 档日池判（词面独立律——工厂不自持预算知识）；warn 走宿主
    // logger；广播件注入（唤醒 watcher 升格宿主件后工厂只持登记面）。closer
    // 注册序即 drain 序（注册序串行）：conversation-manager closer 先拆全部
    // 驱动（在飞 run 协作中止 → runRound 自然收口 failed『run 被外部中止』），
    // 本 closer 后到——停靠项 resolve paused（retain 语义：worktree/授予全
    // 保留归 orphanScan 重入），dismantle 幂等双跑无害
    const issueSessionFactory = createIssueSessionFactory({
      stack,
      canAfford: () => stack.llm.canAfford('background'),
      warn: (message) => logger.warn(message),
      broadcast: budgetBroadcast,
      // 编排层时滞帽（04 §3.8.3——watchdog 第三判据）：装配根单次解析单源
      //（stack.watchdog——「编排 ≥ 流层」不变式已在此前交叉校验）
      stallTimeoutMs: stack.watchdog.sessionStallTimeoutMs,
    });
    runtime.registerCloser({ label: 'issue-session-face', fn: () => Promise.resolve(issueSessionFactory.dispose()) });

    // —— session/lifecycle 活体词预注册（e2-4——04 §6 会话活体广播）：插件
    // 装载期订阅（ctx.events.subscribeSessionLifecycle）先于首会话起跑——驱动
    // 构造器自举够不着 boot 时点，装配根预注册兜底（job_settled 同律；驱动
    // 自举幂等跳过已注册词，独立装配形双源不撞）
    if (!dispatch.isRegistered(SESSION_LIFECYCLE_EVENT)) {
      dispatch.registerEventNames([SESSION_LIFECYCLE_EVENT]);
    }

    // —— 插件装载：启用清单损坏 fail-loud 属启动失败档（用户可自修配置错——
    // 干净退出不写 crash.log）；余装载失败走行级隔离不入本档 ——
    try {
      // 卸载换代槽的一次性 closer（注册序位 = 原 plugin-boot 直注册位：
      // conversation 栈之后 = 插件卸载晚于对话栈拆解；fn 读槽恒跑最新代）
      runtime.registerCloser({
        label: 'plugin-unload',
        fn: async () => {
          await pluginUnloadRef.current?.();
        },
      });
      // boot 重跑闭包定型（seam 真身全闭包捕获——/reload reapply 与首次
      // boot 同一函数同一装配面）；noPlugins 经参传入：救援环律（07 §5
      // 「/reload 读盘不受旗标影响」）——reload 恒以 false 形调用（旗标
      // 只管启动期短路，人面显式 reload 即显式装载请求）。rt = narrowed
      // 承接（let runtime 在闭包内失窄化——直线位 const 固化）
      const rt = runtime;
      runBoot = (noPluginsFlag, pluginFile) =>
        bootPlugins({
          runtime: rt,
          scope,
          dispatch,
          // 钩子派发段 guard 开合面（ca-3——全部插件 ctx 钩子派发两腿开合同
          // 一全局深度计数；只读面已随 stack 注入 llm 双入口，ctx.ui 窗判
          // 消费同一真身只读位〔ix-2〕）
          hookDispatchGuard,
          // ctx.ui 消费腿通道核窄面（ix-2——07 §4.3 消费腿条款）：ChannelsService
          // 七原语结构适配闭包（notify 首参空位——核层 void 该位恒扇出语义；
          // hasSession 锚时效真源）。fork 级联共享单真身。
          channelsUi: {
            notify: (message, opts) => stack.channels.notify('', message, opts),
            confirm: (sid, message, opts) => stack.channels.confirm(sid, message, opts),
            select: (sid, message, choices, opts) => stack.channels.select(sid, message, choices, opts),
            input: (sid, message, opts) => stack.channels.input(sid, message, opts),
            setStatus: (sid, status) => stack.channels.setStatus(sid, status),
            setWidget: (sid, node) => stack.channels.setWidget(sid, node),
            hasAudience: () => stack.channels.hasAudience(),
            hasSession: (sid) => stack.channels.hasSession(sid),
          },
          // ctx.ui 降档 warn 出口（setStatus/setWidget 无锚 no-op 一行的呈现位）
          uiWarn: (message) => logger.warn(message),
          // 渲染器注册面受局面（收官批③——ctx.ui.registerRenderer 受理委派
          // channels renderers 模块单册；后写胜出/受理不拒/disposer 现任守卫
          // 全在真源，装配只闭包注入——「装配根闭包注入」先例）
          renderers: { registerToolRenderer },
          commands: stack.channels.commands,
          llm: stack.llmRuntime,
          triggers, // ctx.triggers.register 受局面（C 批——缺席时该动词响亮缺位）
          subagents, // ctx.agent.registerSubagentProvider 受局面（D 批 D-2——同上）
          // 程序化子代理物化 toolDeps（消费腿——遗漏审计批 G：注册即派生的
          // 装配链接线；bootPlugins 内以 toolRegistry 铸造物化回调透传动词层）
          subagentToolDeps: { service: subagents, sessionContext: subagentSessionContext },
          // Job 归属围栏收口腿（Job 消费面批桥二——04 §10 定形）：卸载 closer 序
          // 对 activated 逐插件 closeOwner（owner = 插件 id 的收口执法位）
          jobs,
          // 界面后端注册面受局面（U3 批 U3-4——ctx.channels.registerUiBackend
          // 委派 ChannelsService 插件域腿；门检 channels.ui-backend 前置在动词内）
          uiBackends: stack.channels,
          // 会话血缘判定面（e2-4——ctx.events.subscribeSessionLifecycle tree 档
          // 过滤受局面）：真身 = 会话维视图 isSameTree（05 §9 parent_id 链单源）
          sessionLineage: { isSameTree: (a, b) => stack.sessionView.isSameTree(a, b) },
          // 跨会话操控受理器真身（e4-3——ctx.get("sessions-control") fork 绑定
          // 位）：plugin-boot 逐插件 bindControlForPlugin 铸 caller 闭包（插件
          // 道归因 plugin:<id>——传入面无 caller 位，伪造结构性不存在）
          sessionsControl: stack.sessionsControl,
          // 进程级 doors 段活体取值器（开门制扩展批 2026-09-09——observe-cross
          // 专属分立判定位消费：订阅 all 档门检行 opens ∥ doors 并判）
          crossDoors: () => readDoorsSegmentLive(dataDir),
          // 压缩席位容器（U4-3——ctx.get("compaction") fork 绑定位）：真身 =
          // conversation-stack 装配的 createCompactionSlots 单真身（服务三 seam
          // 中 getConfig/getProvider 两容器位已在 stack 内接线；此处逐插件
          // bindForPlugin 绑窗真源 + fork.effect 卸载回收兜底）
          compaction: stack.compactionSlots,
          // 插件道路由受理器（U5-2——fork 绑定位：窗/门真源绑本插件 handle +
          // fork.effect 卸载回收兜底；席位判 core:sdk 行在场在 plugin-boot）
          sdkRoutes: pluginRoutes,
          // sessions 受理面基础面真身（ag 批 cs-D2——03 §4.5 定形注：fork 绑
          // 定位。真身上方共享根废止位铸；plugin-boot 逐插件
          // bindSessionsForPlugin 绑 caller 归因 + 行籍闸——core:memory 差分
          // 落账腿同批随动，归因键 plugin:core:memory 不匿名）
          sessions: sessionsFace,
          // 插件凭证面装配位（c-3——store = persistence.store 凭证投影真身直传
          // 〔词面独立律 compat 面，对拍测试互证〕；core:credentials 席在场判在
          // plugin-boot；oauthRegistry = c-6 流注册表真身——fork 绑定成
          // registerOAuthFlow 面；两审计 seam 真接线（c-3 挂账 U3-5 兑现——
          // 05 §1.1）：越域读命中 → capability/used〔seam 载荷原形——含
          // namespace/name 归因键〕、oauth 流写/轮换 → credentials/changed）
          secrets: {
            store: runtimeNow.persistence.store,
            oauthRegistry: oauthFlows,
            onCapabilityUsed: (payload) => audit.append('capability/used', { ...payload }),
            onCredentialChanged: (payload) => audit.append('credentials/changed', { ...payload }),
          },
          // 进程级审计流面（U3 批 U3-5——auditSink 透传 + boot plugin/opens 幂等 diff）
          audit,
          // 装载史世代面（装载史批 h-3——boot 完成尾落行 + reapply 尾换代同点）
          loadHistory,
          noPlugins: noPluginsFlag,
          // 快速试件（eco-3a——启动期一次性注入；reapply 单参调用时 undefined）
          ...(pluginFile !== undefined ? { pluginFile } : {}),
          // 卸载换代槽（03 §5.7——本代卸载序改写槽，上方一次性 closer 读槽）
          unloadRef: pluginUnloadRef,
          version: options.version,
          // 宿主 API 面版本（ag 批 DP2——03 §8.4 定形注④）：运行时单源 =
          // 宿主 package.json 同文件补读 apiVersion（同文件双值 version +
          // apiVersion——人工同步纪律消灭）；options.apiVersion = 测试注入面
          apiVersion: options.apiVersion ?? readHostApiVersion(),
          // core: 官方件注册表缺省单源（批 19a——测试注入面/诊断覆盖经 options；
          // 工厂形升级批 19b-1：dataDir 等宿主真身经 CorePluginHostDeps 入件；
          // 16 件逐纵切笔入册，见 core-plugins.ts）
          corePlugins:
            options.corePlugins ??
            createCorePlugins({
              dataDir: rt.dataDir,
              // worktree 服务共享位（件/栈同源双注之二——issue 编排授予与
              // 会话内工具消费同台账；见 stack 前单真身注）
              worktree: worktreeService,
              // memory 件数据面（批 19b-2——sqlite 主闸恒接线；fts 双 seam 同
              // Store 直传——词面独立律 compat 面，对拍测试互证）
              sqlite: () => runtimeNow.persistence.store.sqlite(),
              // 单会话收口订阅面（发现 ⑯）：memory 件简报冻结缓存收口摘除
              // ——末位覆写（/reload 换代新件重订阅即顶替旧代 feed）
              subscribeSessionRetire: (feed) => {
                sessionRetireFeed = feed;
              },
              // 活体日志优先（write-behind 在飞事件不落盘——driver 在场时读
              // 内存面零缺口）；驱动已收口的外部会话兜底落盘读
              fetchEvents: (sessionId) =>
                stack.driverOf(sessionId)?.session.events() ??
                runtimeNow.persistence.loadSession(sessionId).log.events(),
              ftsSearch: rt.persistence.store,
              ftsMaintenance: rt.persistence.store,
              llm: () => memoryLlm,
              // 命令输出面（source = 归因字面——调用件自报：memory-export/import
              // 归因 'memory'、/tick 归因 'tick'；sessionId 位呈现侧路由后端自决）
              notify: (source, message) => stack.channels.notify(source, message),
              // B3 联动腿链句柄外露（04 §3.3 条 8——受局面在场链创建后回填
              // 上方槽位；seam.refreshNow 运行期惰性取）
              credentialsChainSink: (handle) => {
                credentialsChain = handle;
              },
              // 子代理委派面两位（批 19c-1）：service 真身 + boot 全局层工具
              // 执行时语境解析闭包（上方提取位——程序化腿物化 toolDeps 同源）
              subagents,
              subagentSessionContext,
              // 插件层物化钩子接收位（RP5 物化腿——03 §6.3 兑现）：core:subagent
              // apply 换代重挂即覆写本槽（末位胜出——同 subscribeSessionRetire
              // 律）；resyncPluginAgentLayers 装载收口后经此取钩子喂 activated 行
              subagentLayerResyncSink: (hook) => {
                subagentLayerResyncHook = hook;
              },
              // goal 会话日志读面（批 19c-3——goal 件主闸二）：活体日志优先
              // （driver 在场读内存面），驱动已收口的外部会话兜底落盘读；
              // 长度经 events() 视图取长（O(1)——内部数组直视图非拷贝）
              goalSession: {
                events: (sessionId) =>
                  stack.driverOf(sessionId)?.session.events() ??
                  runtimeNow.persistence.loadSession(sessionId).log.events(),
                length: (sessionId) => {
                  const log = stack.driverOf(sessionId)?.session ?? runtimeNow.persistence.loadSession(sessionId).log;
                  return log.events().length;
                },
                // u-3 停靠词落笔真身（04 §5 定形注②③）：幂等开驱动（冷会话
                // 落词前置——goal 停靠可在无在飞驱动时发生〔scheduler 池检
                // 形〕）+ session/paused 词落账（word 已随本批入册核心词表）
                appendPaused: (sessionId) => {
                  const driver = stack.driverOf(sessionId) ?? stack.manager.open(sessionId).driver;
                  driver.session.append('session/paused', { reason: 'budget' });
                },
              },
              // goal 沉淀摘要窄面（批 #99——上方适配器真身；缺席律不适用：
              // 适配器零依赖构造恒在场，goal 件内 summarizer 缺席走确定性回退）
              goalSummarizer,
              // 全环捕获位透传（s 批——生产恒缺席；e2e rig lifecycle 通道）
              ...(options.goalServiceSink !== undefined ? { goalServiceSink: options.goalServiceSink } : {}),
              // checkpoint 两 seam + 焦点会话位（批 19c-4——05 §5.3 词面独立律）：
              // 语境面 contextOf 活体双单源（lastClosedBoundary 取活体日志 +
              // workspaceRoot 取 manager 活体镜像 workspaceRootOf——03 §10.7
              // 「锚不能走库读」律）；活体缺席回退 loadSession 行值（undefined
              // 语义保真：hasSession 判在场，不走 listSessions limit=100 截断窗
              // 反查——行落窗外反查落空会误报「会话不存在」、gate 判据 2b 静默
              // 放行 pre-mutation 快照安全网）；fork 面 = SessionManager.fork
              // 直赋（05 §5.0 判别子集形；箭头包装保 this 绑定）；焦点会话 =
              // channels.focusedId（/rewind 发起会话真源）
              checkpointSession: {
                contextOf: (sessionId) => {
                  const liveLog = stack.driverOf(sessionId)?.session;
                  if (liveLog !== undefined) {
                    return {
                      lastClosedBoundary: liveLog.lastClosedBoundary(),
                      workspaceRoot: stack.manager.workspaceRootOf(sessionId) ?? '',
                    };
                  }
                  // 冷会话（无在飞驱动）：id 直读判在场（无截断窗）+ 行值回退
                  if (!runtimeNow.persistence.hasSession(sessionId)) return undefined;
                  const loaded = runtimeNow.persistence.loadSession(sessionId);
                  return {
                    lastClosedBoundary: loaded.log.lastClosedBoundary(),
                    workspaceRoot: loaded.row.workspaceRoot ?? '',
                  };
                },
              } satisfies SessionContextFace,
              checkpointFork: {
                fork: (sourceSessionId, options) => stack.manager.fork(sourceSessionId, options),
              } satisfies RewindForkFace,
              focusSessionId: () => stack.channels.focusedId ?? undefined,
              // 宿主版本（批 19d——mcp 件 initialize 握手 clientInfo.version
              // 披露「对齐 package.json」单源位：装配选项 version 同源）
              version: options.version,
              // —— HTTP 面族十位（批 19e——sdk/webui/obs/issue 件装载态接线）——
              // sdk 面工厂真身（core:sdk 件承载位：daemon/serve/TUI 开面消费
              // 件在场 kit；stdio 不依赖件装载态——F16）
              sdkFaceFactory: createSdkHttpFace,
              // 插件道路由受理器（U5-2——kit 透传位：三入口经 core:sdk 件
              // kit 'sdk-http-face' 消费 snapshot/attachFace；件禁用 ⇒ kit
              // 缺席 ⇒ daemon 拒启/TUI·前台 warn 不开面 ⇒ 受理账无人 replay
              // ——「sdk 禁 ⇒ 面亡 ⇒ 路由全灭」语义族闭环）
              sdkPluginRoutes: pluginRoutes,
              // webui 挂载闭包（core:webui 件 kit——面级 handle + 可选
              // staticDir；开面晚于装载的晚绑形，件 apply 期只透传闭包）
              webuiFaceMount: (face, mountOptions) =>
                mountWebuiOnFace({
                  stack,
                  face,
                  ...(mountOptions?.staticDir !== undefined ? { staticDir: mountOptions.staticDir } : {}),
                  // /export 端点拼装源（2026-09-17 TUI 余量收官批②——第三
                  // 消费位注入）：事件双事实源（驱动活体优先〔write-behind 未
                  // flush 事件也在场〕→ 库行回退 loadSession——已闭会话近史
                  // 兜底照常返体）+ 行面元数据现读；与 /export TUI 命令面
                  // eventsOf 同式（:1312 域内既有先例——双事实源纪律单源同构）
                  exportSource: {
                    rowOf: (sessionId) => runtimeNow.persistence.store.getSessionRow(sessionId),
                    eventsOf: (sessionId) => {
                      const driver = stack.driverOf(sessionId);
                      if (driver !== undefined) return driver.session.events(); // 活体真源
                      try {
                        return runtimeNow.persistence.loadSession(sessionId).log.events(); // durable 回退（近史兜底）
                      } catch {
                        return undefined; // 行不在场——端点 404 not_found
                      }
                    },
                  },
                }),
              // obs 三 seam：事件源 = Store 真身直传（结构兼容 ObsEventsFace——
              // 05 §3.4 宿主面消费位）；notify 走 channels 会话作用域（归因
              // 'obs'——呈现侧路由后端自决）；audience = channels 观众探针
              obsEvents: runtimeNow.persistence.store,
              obsNotify: {
                notify: (message, opts) => stack.channels.notify('obs', message, opts),
              },
              obsAudience: { hasAudience: () => stack.channels.hasAudience() },
              // issue 五位：state = store_state 三法真身直传（不自建账本——
              // 宪章二）；budget = 04 §5 日池判适配（background 档——停靠不
              // 落终态语义归件内）；token/secret = 凭证库优先 env 回落（c-5
              // 迁移——03 §10.9 优先级律，上方闭包单源）；session = headless
              // 会话真工厂（成熟度缺口 #5——主闸三起会面接线，生产面件装载
              // 解锁）
              issueState: runtimeNow.persistence.store,
              issueBudget: {
                canAffordIssue: () =>
                  stack.llm.canAfford('background')
                    ? { ok: true }
                    : { ok: false, reason: '当日后台预算池尽（04 §5 停靠待唤醒——不落终态）' },
              },
              issueSession: issueSessionFactory,
              ...(issueToken !== undefined && issueToken !== '' ? { issueGithubToken: issueToken } : {}),
              ...(issueSecret !== undefined && issueSecret !== '' ? { issueWebhookSecret: issueSecret } : {}),
              // —— credentials 人面命令两 seam（c-5——03 §10.9 写入面）——
              // store = persist 真身直传（CredentialsCommandStore 四法投影，
              // 词面独立律 compat 面）；审计 seam 真接线（c-5 挂账 U3-5 兑现——
              // 人面 add/rm 成功即落 credentials/changed，值恒不入载荷）
              credentialsStore: runtimeNow.persistence.store,
              credentialsOnChanged: (payload) => audit.append('credentials/changed', { ...payload }),
              // —— oauth 流受局面（c-6——03 §10.9 oauth 案）：注册表同真身 +
              // SSRF 守卫包裹 fetch（web 卫生单源——上方 oauthFetch 单源）+
              // 刷新链 60s 自驱缺省 + 单败 warn 走宿主 logger
              credentialsOAuth: {
                registry: oauthFlows,
                fetchFn: oauthFetch,
                warn: (message) => logger.warn(message),
              },
              // —— scheduler 编舞接线（批 20c 三位 + u-2 进程内推进一位）——
              // 宿主对话栈（u-2——04 §12 定形注①）：生产恒注入——引擎 runner
              // 换进程内实装（scheduler-tick：fire 不 spawn，经 stack 起
              // headless run + builtin 行程序化分派）；e2e 回归锁锁死此形
              conversationStack: stack,
              // 宿主级 budget-extended 广播件（u-3——04 §5 定形注①升格）：
              // goal 停靠项登记面（生产恒注入；与 issue 工厂共享同一真身——
              // 三停靠面同播单源）
              budgetBroadcast,
              // GateFacts 宿主三源收集闭包：行启停位 + 宿主在飞（anyRunning）+
              // 最近真用户消息（boot 后监听器维护）+ 行上次触发（JobRow 自带
              // lastFireAt 列）+ 当日后台预算（04 §5 canAfford）
              schedulerGateFacts: (row) => ({
                enabled: row.enabled,
                agentBusy: stack.manager.anyRunning(),
                lastUserMessageAt,
                lastFireAt: row.lastFireAt,
                canAfford: stack.llm.canAfford('background'),
              }),
              // 真 bin 出厂（BERRY_AGENT_BIN env 载体——缺席 'berry'
              // PATH 名解析归件内缺省）
              ...(env.BERRY_AGENT_BIN !== undefined && env.BERRY_AGENT_BIN !== ''
                ? { schedulerBinCommand: env.BERRY_AGENT_BIN }
                : {}),
              // cron 乙案开启位（BERRY_AGENT_CRON=1 显式置值 = 人面授权链的
              // env 形——授权凭据即显式置值本身）
              ...(env.BERRY_AGENT_CRON === '1' ? { schedulerCronEnabled: true } : {}),
            }),
          warn: (message) => logger.warn(message),
          // 逐插件装载起步回调透传（启动动画供数——三反馈批 D 先行件2）：装配
          // 根裹异常隔离（loader 层不隔离——onBootFailure/onApplySettled 同 seam
          // 惯例，调用方自裹）；runBoot 闭包定型晚于 logger 创建，直引无 TDZ
          ...(options.onPluginLoadStart !== undefined
            ? {
                onPluginStart: (pluginId: string, index: number, total: number) => {
                  try {
                    options.onPluginLoadStart?.(pluginId, index, total);
                  } catch (err) {
                    logger.warn(
                      `逐插件装载回调异常（${pluginId} ${index}/${total}，已隔离不反噬装载序）：${
                        err instanceof Error ? err.message : String(err)
                      }`,
                    );
                  }
                },
              }
            : {}),
        });
      emitBootStage('plugins', 'start');
      boot = await runBoot(options.noPlugins === true, options.pluginFile);
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
    // plugins 尾事件携计数 detail（动画「N/M 插件」行供数——与披露匣同账）
    emitBootStage('plugins', 'end', `enabled=${boot.counts.enabled},total=${boot.counts.total}`);

    // —— plugin-load-report 服务面（07 §4.1 命令面增补批 C2——挂账解挂批
    // R6 前段 deferred 兑现）：装载报告取值器入 scope（owner 'host:assembly'
    // ——装配级服务面，与 'checkpoint' 等同律；scope 是插件共享根作用域，
    // tui-entry 装配段 tryGet 消费）。LoadReport 不出 scope 面的旧律维持
    // ——本面只出「取值器」，真身仍 boot 闭包单源；取值器晚绑 boot 槽
    // （/reload reapply 换代写回 boot 后即新代投影——与 /plugins list 读面
    // `report: () => boot?.report` 同一闭包形），boot 槽空窗（结构上此刻
    // 已 boot 完毕，防御位）返回 undefined = 诚实缺席。
    scope.provide('plugin-load-report', { report: () => boot?.report }, 'host:assembly');

    // —— skills 桥 + 插件技能层重同步编舞（批 19 skills 销账 + /reload 批抽
    // 可重跑）：首次 boot 后与每轮 /reload 换入后同函数调用——桥挂接（ WeakSet
    // 防同 registry 重挂）+ 旧代 plugin: 层清场 + 新代层补注册。core:skills
    // 禁用档 tryGet 诚实缺席 → 零桥零层（缺席即未装载语义）。
    //
    // skills_change 事件桥（批 19b-1——03 §3.4 通知面汇流点）：registry
    // refresh 快照变化 → 全局词 skills_change 发射（41 钩子词已在 bootPlugins
    // 预注册——dispatch.emit 直用）。桥落宿主侧不落件内：ctx.emit 域名律强制
    // `core:skills/` 前缀——全局词对插件结构性不可达（域名律防插件伪造全局
    // 事件，官方件同受束——宿主侧 dispatch 才是正口）。
    //
    // 磁盘件技能目录载荷层补注册（批 19 skills 销账——06 §11.4 位 4 / 03
    // §6.1「mount 即注册」）：core:skills 先装（synthesizePlan core 行先入
    // plan）时磁盘件 manifest.skills 尚未激活——件内 apply 构造 pluginLayers
    // 结构性空缺，装载收口后于此补注册。序位执法（06 §11.3 注册序即优先序
    // ——插件层压出厂层）：摘 factory → 位 4 逐插件插入 → factory 原实例重挂
    // 末位。/reload 换代对称（03 §6.2 技能层摘除）：旧代 plugin: 前缀层先全
    // 摘再插新代（首跑零层清场幂等）。refresh 落新快照（披露段每请求物化
    // 即生效）+ 桥发射 skills_change（providers 变化可观测）。realpath 去重
    // 集 pass 域化（b288974 起）：registry 每 refresh 铸新集经 scan(passSeen)
    // 透传全部层（含 plugin: 层），层间同文件去重在 realpath 层静默完成；
    // 同名异文件才落 first-wins + collision 诊断（与 registry.ts/discovery.ts
    // 同源表述——2026-09-14 扫描三役 F19 勘正，修前注记系 b288974 前旧形态）。
    const wiredSkillRegistries = new WeakSet<object>();
    const resyncPluginSkillLayers = async (handle: PluginBootHandle): Promise<void> => {
      const registry = scope.tryGet('skills') as SkillsRegistry | undefined;
      if (registry === undefined) return;
      if (!wiredSkillRegistries.has(registry)) {
        wiredSkillRegistries.add(registry);
        registry.onChange(() => {
          // 载荷 = 现行 provider id 清单（06 §11.3——消费面 = 渐进披露清单重物化）
          void dispatch.emit('skills_change', { providers: registry.providerIds() });
        });
      }
      // 旧代层清场（plugin: 前缀全摘——reload 换代对称；首跑零层幂等）
      for (const id of registry.providerIds()) {
        if (id.startsWith('plugin:')) registry.unregisterProvider(id);
      }
      const pluginRows = handle.report.activated.filter((row) => row.skillDirs.length > 0);
      if (pluginRows.length > 0) {
        const factory = registry.getProvider('factory');
        registry.unregisterProvider('factory'); // 位 4 让位（原实例重挂见下）
        for (const row of pluginRows) {
          // plugin: 前缀 = 与标准层 id 结构性不撞
          registry.registerProvider(createDirProvider({ id: `plugin:${row.id}`, roots: [...row.skillDirs] }));
        }
        if (factory !== undefined) registry.registerProvider(factory); // 出厂层重挂末位（序保真）
      }
      await registry.refresh();
    };
    // 卸载对称 closer（一次性注册晚绑 tryGet——换代自适；序在 plugin-unload
    // 后 = 插件 disposer 先回卷；core:skills 禁用档 fn 内缺席零操作）
    runtime.registerCloser({
      label: 'skills-plugin-layers',
      fn: async () => {
        const registry = scope.tryGet('skills') as SkillsRegistry | undefined;
        if (registry === undefined) return;
        for (const id of registry.providerIds()) {
          if (id.startsWith('plugin:')) registry.unregisterProvider(id);
        }
        await registry.refresh();
      },
    });
    emitBootStage('skills', 'start');
    await resyncPluginSkillLayers(boot);
    emitBootStage('skills', 'end');

    // —— 插件声明子代理层重同步（RP5 物化腿——03 §6.3 兑现注）：镜像 skills
    // resync 时序位（boot 装载收口后首调 + /reload reapply 内重调）。钩子真身
    // 在 core:subagent apply 闭包（物化/撤位/后窗注册全在彼——assembly 只编排
    // 时序与喂 activated 行）；行滤 agentDirs > 0 投影为 SubagentPluginLayerRow。
    // 无独立 closer：件级 disposer（apply 返）即卸载对称位——provider 位 +
    // 工具位两撤。
    const resyncPluginAgentLayers = async (handle: PluginBootHandle): Promise<void> => {
      const rows = handle.report.activated
        .filter((row) => row.agentDirs.length > 0)
        .map((row) => ({ id: row.id, agentDirs: [...row.agentDirs] }));
      await subagentLayerResyncHook?.(rows);
    };
    emitBootStage('subagents', 'start');
    await resyncPluginAgentLayers(boot);
    emitBootStage('subagents', 'end');

    // —— session/event 用户消息追踪（批 20c——GateFacts lastUserMessageAt 宿主
    // 源维护）：真用户输入（user/channel:*）才更新最近时刻——schedule（挂钟
    // 触发的 user/message 非人语）/subagent-settled/compaction/plugin 注入不
    // 计数（不打扰礼仪门只认真人）。词汇在 bootPlugins 注册（41 词表）——
    // noPlugins 纯诊断形不注册即不挂（此时 scheduler 件亦未装载无消费面）；
    // dispatch.on 词未注册 fail-loud，故 isRegistered 守卫前置（同 session/
    // event 桥律）。监听器随 dispatch 进程级生命周期——不设卸载 closer ——
    if (dispatch.isRegistered('session/event')) {
      dispatch.on('session/event', (payload) => {
        const { event } = payload as { sessionId: string; event: SessionEvent };
        if (event.type !== 'user/message') return;
        // source 归因解析（闭集读侧判据）：user/channel = 真人输入；余类注入不计
        const parsed = parseEventSource(String((event.data as { source?: unknown }).source ?? 'user'));
        if (parsed.kind !== 'user' && parsed.kind !== 'channel') return;
        // event.time = ms epoch（05 §1.1）→ ISO UTC（GateFacts 时基同构）
        lastUserMessageAt = new Date(event.time).toISOString();
      });
    }

    // —— /reload 编舞接线（03 §5.7——本批）：busy 判据 = manager 级任一 run
    // 在飞（anyRunning 读面）；run 收场 = ctx.agent onRunSettled 订阅（多会话
    // 信封位在回调外——reloader 只消费「settled 边界到了」事实）；回执走
    // channels.notify（归因 'reload'——与 'tick'/'credentials' 同律）。
    // reapply = runBoot(false) + 换代写回（boot 变量/pluginCounts 披露匣/
    // skills 层重同步——闭包晚绑取值器下一请求即见新代）；救援环律在
    // runBoot 参位已注（旗标只管启动期）。
    const reloadReport = (text: string): void => {
      void stack.channels.notify('reload', text);
    };
    const reloader = createPluginReloader({
      // 档①预检：与装载读侧同一函数（单源——预检过装载必过清单面）
      preflight: () => void readEnabledRows(dataDir, defaultFs()),
      // 回卷旧代：换代槽当前代（noPlugins 首启形槽空 = no-op）；对象面经
      // rollbackFromReport 适配（failed → id 清单——error 细节走 boot-failures）
      rollback: async () => {
        const unload = pluginUnloadRef.current;
        if (unload === null) return emptyRollbackReceipt();
        return rollbackFromReport(await unload());
      },
      // 换入新代：runBoot + 三处换代写回（boot 定位/披露匣/skills 层）。
      // 单参调用（pluginFile 不传）= 03 §7 不变式 4 的机器落点：全量重载后
      // --plugin-file 试件行不再合成（换代面恒真实装载形）。
      reapply: async () => {
        const previous = boot; // 换代前旧代（工具面 diff 基线——03 §2.8 通道真值）
        const handle = await runBoot!(false);
        boot = handle;
        Object.assign(pluginCounts, handle.counts);
        await resyncPluginSkillLayers(handle);
        await resyncPluginAgentLayers(handle);
        // 新代工具面 diff（03 §2.8 定形——/reload 回执呈现新代 activated[].tools
        // 对前代 diff）：基线 = 旧代 activated 全体工具名并集；新代逐插件取
        // 差集、非空才呈现（不造噪声）。首启 noPlugins 短路形 previous 为空代
        // → 基线空集 = 新代工具全量呈新增（诚实形）。模型通道动作时点
        // addedToolNames 恒诚实空执法不变——真值只经本回执走人面。
        const previousTools = new Set<string>();
        if (previous !== undefined) {
          for (const a of previous.report.activated) for (const t of previous.toolsOf(a.id)) previousTools.add(t);
        }
        const addedTools = handle.report.activated
          .map((a) => ({ pluginId: a.id, tools: handle.toolsOf(a.id).filter((t) => !previousTools.has(t)) }))
          .filter((entry) => entry.tools.length > 0);
        return {
          total: handle.counts.total,
          enabled: handle.counts.enabled,
          failed: handle.counts.failed,
          // 行级失败附错误文本（obs-a——03 §5.7② 呈现三面之③；report.failed
          // 三键结构满足即透传，与 plugins list 失败分区同源同形）
          failures: handle.report.failed.map((f) => ({ id: f.id, code: f.code, message: f.message })),
          addedTools,
        };
      },
      isBusy: () => stack.manager.anyRunning(),
      onRunSettled: (handler) => {
        const agentService = scope.tryGet<AgentService>(AGENT_SERVICE_NAME);
        if (agentService === undefined) return () => undefined; // 结构性不可达（栈内先建）——防御位
        return agentService.onRunSettled(() => handler());
      },
      report: reloadReport,
      warn: (message) => logger.warn(message),
    });
    // TUI 命令面注册（03 §5.7 词面权威；fire-and-forget——回执走 notify，
    // handler 不 await 编舞〔busy 期排队等 run 收场，await 会卡输入流〕）
    stack.channels.commands.register(
      'reload',
      async () => reloader.request(),
      '重载插件装载态（会话运行中自动排队，run 收场后执行）',
    );

    // —— /plugins TUI 命令面（03 §5.8 三面同源之 TUI 面——task #88 笔二）：
    // 宿主级命令直注册（与 /reload 同位——非插件自带命令，不随换代卸除）；
    // 纯逻辑件单源（plugins-command.ts——argv 解析/前置两查/回执文本），
    // 装配面只接线四 seam：行编辑 fs、进程内 audit face（落账失败 warn 不
    // 阻塞——行编辑已生效）、成功尾自动链 reloader（03 §5.2）、内存装载
    // 报告取值器（list 读面——换代取值器闭包，/reload 后即新代投影）。
    // 回执经 notify 归因 'plugins'（与 'reload'/'tick'/'credentials' 同律）。
    // config 表单腿（ix-3b/c）：问询走本会话 ask 通道（args.sessionId 绑定
    // ——表单需会话锚，缺席诚实拒）；secret 写凭证盒 + credentials/changed
    // 审计与 c-5 人面同律（值恒不入载荷）。
    stack.channels.commands.register(
      'plugins',
      async (args) => {
        const outcome = await runPluginsCommand(args.argv, {
          dataDir,
          fs: createPluginStoreFs(),
          auditSink: (type, payload) => {
            try {
              audit.append(type, payload);
            } catch (err) {
              logger.warn(
                `生命周期审计落账失败（${type}）：${err instanceof Error ? err.message : String(err)}——主流程不受影响（行编辑已生效）`,
              );
            }
          },
          requestReload: () => void reloader.request(),
          report: () => boot?.report,
          configForm:
            dataDir === null
              ? undefined // 纯 memory 形在命令层已拒（此位结构性不达——防御缺省）
              : (id) => {
                  if (args.sessionId === undefined) {
                    return Promise.resolve({
                      ok: false,
                      text: 'config 表单需会话锚（此命令面无发起会话——问询无法投递）——TUI 会话内执行 /plugins config',
                    });
                  }
                  const sessionId = args.sessionId;
                  return runPluginConfigForm(id, {
                    dataDir,
                    fs: createPluginStoreFs(),
                    configFaceOf: (pluginId) => boot?.configFaceOf(pluginId),
                    ask: {
                      select: (message, choices, opts) => stack.channels.select(sessionId, message, choices, opts),
                      input: (message, opts) => stack.channels.input(sessionId, message, opts),
                    },
                    getCredential: (namespace, name) => runtimeNow.persistence.store.getCredential(namespace, name),
                    setCredential: (namespace, name, entry) =>
                      runtimeNow.persistence.store.setCredential(namespace, name, entry),
                    onCredentialChanged: (payload) => audit.append('credentials/changed', { ...payload }),
                    requestReload: () => void reloader.request(),
                  });
                },
        });
        void stack.channels.notify('plugins', outcome.text);
      },
      PLUGINS_CMD_USAGE,
    );

    // —— /doors TUI 命令面（03 §4.6 doors 段编辑腿的人面动词——g-2；07 §5
    // 定名：写动词 TUI 专属，CLI 面只读 list）：宿主级直注册（与 /reload、
    // /plugins 同位——机制宿主有，不随插件换代卸除）；纯逻辑件单源
    // （doors-cmd.ts——argv 解析/段编辑/回执文本）。写动词成功真变更尾落
    // doors/updated（origin 'tui-cmd'——recordDoorsDiff boot 序 'boot-diff'
    // 位的编辑道姊妹位；落账失败 warn 不阻塞——段编辑已生效）；不自动链
    // /reload（与 /plugins 成功尾自动链分立——g-1 门检输入 = 活体源，写回
    // 即门即时生效，reload 只刷新装载面快照/审计基线，回执已两时点诚实
    // 陈述）。回执经 notify 归因 'doors'（与 'plugins' 同律）。
    stack.channels.commands.register(
      'doors',
      async (args) => {
        const parsed = parseDoorsArgv(args.argv);
        if (!parsed.ok) {
          void stack.channels.notify('doors', parsed.message);
          return;
        }
        const outcome = runDoorsCommand(parsed.sub, {
          dataDir,
          fs: createPluginStoreFs(),
          onDoorsUpdated: (doors) => {
            try {
              audit.append('doors/updated', { doors: [...doors], origin: 'tui-cmd' });
            } catch (err) {
              logger.warn(
                `doors 审计落账失败：${err instanceof Error ? err.message : String(err)}——主流程不受影响（段编辑已生效）`,
              );
            }
          },
        });
        void stack.channels.notify('doors', outcome.text);
      },
      DOORS_USAGE,
    );

    // —— /approval TUI 命令面（04 §9 定形块⑤⑥——ap-3）：宿主级直注册
    // （与 /reload、/plugins、/doors 同位——机制宿主有，不随插件换代卸除）；
    // 纯逻辑件单源（approval-cmd.ts——四动词 status/entries/explain/preset）。
    // status 面 = 装配期四层解析胜者快照（来源标注由入口注入：CLI 层
    // sandboxModeSource/approvalPolicySource；settings/缺省层本装配根自证）；
    // preset 写盘成功尾落 preset/applied 审计恰一笔（05 §1.1——落账失败
    // warn 不阻塞，写盘已生效；CLI --preset 逐次形零审计——不经本面）。
    // 回执经 notify 归因 'approval'（与 'doors' 同律）。
    // boot 解析单源消费（F2）：与披露第六件 fallback 同 boot——上方
    // bootSandboxMode 一处解析（CLI > settings > 代码常量），status 快照免二次
    const effectiveMode: SandboxMode = bootSandboxMode;
    const modeSource =
      options.sandboxModeSource ??
      (options.sandboxMode !== undefined
        ? 'CLI 旗标（逐次）'
        : settingsMode !== undefined
          ? 'settings.json（持久缺省）'
          : '缺省（代码常量）');
    const effectivePolicy: ApprovalPolicyMode = options.approvalPolicy ?? settingsPolicy ?? 'ask';
    const policySource =
      options.approvalPolicySource ??
      (options.approvalPolicy !== undefined
        ? 'CLI --preset/旗标（逐次）'
        : settingsPolicy !== undefined
          ? 'settings.json（持久缺省）'
          : '缺省（代码常量）');
    stack.channels.commands.register(
      'approval',
      async (args) => {
        const parsed = parseApprovalArgv(args.argv);
        if (!parsed.ok) {
          void stack.channels.notify('approval', parsed.message);
          return;
        }
        const outcome = runApprovalCommand(parsed.sub, {
          dataDir,
          status: { mode: effectiveMode, policy: effectivePolicy, modeSource, policySource },
          workspace: () => canonicalWorkspaceRoot(),
          onPresetApplied: (preset, sandboxMode, approvalPolicy, appended) => {
            try {
              audit.append('preset/applied', { preset, sandboxMode, approvalPolicy, appended });
            } catch (err) {
              logger.warn(
                `preset 审计落账失败：${err instanceof Error ? err.message : String(err)}——主流程不受影响（写盘已生效）`,
              );
            }
          },
        });
        void stack.channels.notify('approval', outcome.text);
      },
      APPROVAL_USAGE,
    );

    // —— /export TUI 命令面（07 §4.1 命令面增补批 C2——I/O 族一件）：宿主级
    // 直注册（与 /reload、/plugins、/doors、/approval 同位——03 篇 /plugins
    // 定形注同位先例，机制宿主有不随插件换代卸除）；拼装/落盘/回执文本单源
    // session-export.ts（CLI `sessions export` 同一命令腿两消费——05 §3.4
    // 点名 CLI 导出为 queryEvents 宿主面消费者）。事件双事实源取值器：
    // 驱动活体优先（write-behind 未 flush 事件也在场）→ 库行回退 loadSession
    //（loadSession 缺席 throw 折 undefined = 会话不在场）；行面元数据 =
    // sessions 行现读（零事件活体会话行缺席照导出——文档头元数据行缺席）。
    // 回执经 notify 归因 'export'（与 'plugins'/'doors' 同律——一行路径，
    // /memory-export 同形）。无参形会话解析序在命令腿内单源（显式 id 参 >
    // args.sessionId 命令锚 > focusedId 现取）。
    stack.channels.commands.register(
      'export',
      async (args) => {
        const outcome = await runSessionExportCommand(args.argv, args.sessionId, {
          dataDir,
          rowOf: (sessionId) => runtimeNow.persistence.store.getSessionRow(sessionId),
          eventsOf: (sessionId) => {
            const driver = stack.driverOf(sessionId);
            if (driver !== undefined) return driver.session.events(); // 活体真源
            try {
              return runtimeNow.persistence.loadSession(sessionId).log.events(); // durable 回退
            } catch {
              return undefined; // 行不在场——SESSION_NOT_FOUND 归命令腿呈报
            }
          },
          focusedId: () => stack.channels.focusedId,
        });
        void stack.channels.notify('export', outcome.text);
      },
      SESSION_EXPORT_USAGE,
    );

    // ready 瞬时相位只发 end（start/end 成对落在耗时阶段——收尾行无起跑行）
    emitBootStage('ready', 'end');
    return { ok: true, runtime, logger, dispatch, scope, stack, boot, pluginCounts, reloader };
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

/**
 * 宿主 API 面版本补读（ag 批 DP2——03 §8.4 定形注④）：宿主 package.json
 * 同文件双值（version + apiVersion）的 apiVersion 腿，装配根消费位补读
 * （与 plugins-cmd readHostApiVersion 同文件同源同式；本件不 import
 * main.ts〔宿主入口归他件域〕）。缺席兜 '1.0'（package.json 常位恒在——
 * 兜底仅防御非常规装载形）。装载门裁决坐标的真源。
 */
function readHostApiVersion(): string {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
    apiVersion?: string;
  };
  return pkg.apiVersion ?? '1.0';
}

/**
 * 进程级 doors 段活体读取（开门制扩展批 2026-09-09——03 §4.6 双源并集律第二
 * 源的运行期取值面）：每次现读 enabled.yaml 现解析顶层 doors 段，受理时点
 * 现读现判（撤位即收回——readTriggerOpensLive 同律同位）。消费位两路：模型
 * 道两工具族门检输入（observeCross seam）+ 操控受理器 caller 感知合成的
 * doors 支路（controlCross seam 插件道并集项/模型道单独项）。
 *
 * **fail-closed 全失败档一律空集**（文件缺席/不可读/坏 yaml/段校验败——与
 * readTriggerOpensLive 同律：boot 读侧 fail-loud 拦启动期配置错，此处拦运行
 * 期判面宁拒不误放；memory 形 dataDir null 亦空集）。
 */
export function readDoorsSegmentLive(dataDir: string | null): ReadonlySet<string> {
  if (dataDir === null) return new Set<string>();
  let text: string;
  try {
    text = readFileSync(enabledYamlPath(dataDir), 'utf8');
  } catch {
    return new Set<string>(); // 缺席/不可读 = 段缺席 = 该源空集
  }
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return new Set<string>(); // 坏 yaml 宁拒不误放
  }
  const result = parseEnabledRows(doc);
  if (!result.ok) return new Set<string>();
  return new Set<string>(result.doors);
}

/** 双源并集（caller 感知合成的插件道支路——纯局部集，不改写两源只读集） */
function unionOpens(a: ReadonlySet<string>, b: ReadonlySet<string>): ReadonlySet<string> {
  const out = new Set<string>(a);
  for (const value of b) out.add(value);
  return out;
}

/**
 * caller 感知合成取值器工厂（开门制扩展批 2026-09-09——03 §4.6 双源并集律的
 * 装配单源）：插件道 caller = doors 段活体 ∪ 该插件行 opens 活体并集
 * （readTriggerOpensLive 同源——源①无插件 id 锚的结构性缺位由此补齐）、模型
 * 道 caller = doors 段单独。逐次现读现判（撤位即收回）。
 */
export function createControlOpensFor(dataDir: string | null): (caller: ControlCaller) => ReadonlySet<string> {
  return (caller) =>
    caller.kind === 'plugin'
      ? unionOpens(readDoorsSegmentLive(dataDir), readTriggerOpensLive(dataDir, caller.pluginId))
      : readDoorsSegmentLive(dataDir);
}
