/**
 * host/core-plugins — core: 官方件注册表单源（批 19a 装载态集成）。
 *
 * 16 件权威清单 = 02 篇 §4.1 core: 行（skills/memory/subagent/exec/mcp/
 * web/browser/lsp/checkpoint/scheduler/goal/obs/webui/sdk/issue +
 * credentials〔c-3 增席 #16——02 §4.1 #28 席〕）——v1 全量
 * 带上默认启用，经同一插件装载面（第一方禁私有车道：对象直调 apply 零
 * jiti 零 import 门禁，03 §1.4 官方引用形）。本件逐件入册（批 19a 起，
 * 每纵切笔入册一批——**批 19e 齐 15 件**，此销账注记兑现：exec/web/
 * skills/memory/subagent/scheduler〔19a/19b/19c-1/2〕→ goal/checkpoint
 * 〔19c-3/4〕→ mcp/browser/lsp〔19d〕→ sdk/webui/obs/issue〔19e〕→
 * credentials〔c-3 件席占位〕）。
 *
 * **apply 壳归宿主侧**（与磁盘件「件自持入口文件」分道）：件保持纯库
 * 不 import host（DAG 单向不破——host 是装配根有权 import 各件公开面），
 * 装配逻辑（何时 provide 何服务/注册何工具）属宿主裁决权面（判据面与
 * 接口面之分——02 篇理念节）。ctx 真身在 host 侧直用 PluginContext 类型
 * narrow（零跨件窄面重复——与磁盘件的 unknown 契约面不同，本侧无漂移面）。
 *
 * 会话级 deps（档位/审批/工作区）经服务面工厂形求值：装载期固定构造会
 * 丢会话面（批 19a 定形——ExecToolService 契约见 conversation/types.ts）。
 */
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import * as fsp from 'node:fs/promises';
import { join } from 'node:path';

import type { GateInput, SessionEvent, ToolDefinition } from '../contracts/index.js';
import { BaseError } from '../contracts/index.js';
import { getEventTypeMeta } from '../contracts/index.js';
import type { AgentService, ContextTransformInput, ExecToolService, PreStepInput } from '../conversation/index.js';
import { canonicalWorkspaceRoot, createLogger, LogLevelState } from '../context/index.js';
import type { SpawnPipeline } from '../exec/index.js';
import { createMcpService, normalizeMcpConfig } from '../mcp/index.js';
import type { McpConfig } from '../mcp/index.js';
import { createLspService, normalizeLspSettings } from '../lsp/index.js';
import type { LspService } from '../lsp/index.js';
import {
  createBrowserService,
  defaultDownloadFace,
  defaultWsFace,
  engineEgressProxy,
  installBrowserEngine,
  normalizeBrowserConfig,
} from '../browser/index.js';
import {
  createCapture,
  createCheckpointGate,
  openCheckpointStore,
  runRewindCommand,
  REWIND_USAGE,
} from '../checkpoint/index.js';
import type { RewindForkFace, SessionContextFace } from '../checkpoint/index.js';
import { createBashTool, createGateExec, createSpawnPipeline, buildChildEnv } from '../exec/index.js';
import {
  createGoalService,
  createGoalTodoTool,
  createGoalUpdateTool,
  runGoalCommand,
  GOAL_USAGE,
} from '../goal/index.js';
import type {
  GateExecSeam,
  GoalRow,
  GoalService,
  GoalSessionFace,
  GoalSummarizerFace,
  GoalTodoItem,
} from '../goal/index.js';
import type { ConversationStack } from './conversation-stack.js';
import type { BudgetBroadcastEntry, BudgetBroadcastFace } from './budget-broadcast.js';
import type { SqliteDatabase } from '../persist/index.js';
import { createDangerGate, createSandboxService, DANGER_V1_ACTIONS, normalizeDangerMandate } from '../safety/index.js';
import {
  createOsCronRegistrar,
  createProcessRunnerFactory,
  createSchedulerEngine,
  createSchedulerService,
  runTickCommand,
  TICK_USAGE,
} from '../scheduler/index.js';
import type {
  GateFacts,
  GoalJobsFace,
  JobRow,
  JobsDao,
  SchedulerEngine,
  SchedulerService,
} from '../scheduler/index.js';
import { createSchedulerTickRunner, type IssuePollFace } from './scheduler-tick.js';
import { createFetchTool, createInFlightGate, createWebFetchService, DEFAULT_WEB_LIMITS } from '../web/index.js';
import type { InFlightGate, WebFetchService } from '../web/index.js';
import {
  createLoadSkillTool,
  createSkillManageTool,
  createSkillsRegistry,
  createStandardLayers,
  renderAvailableSkills,
} from '../skills/index.js';
import {
  briefBaseline,
  buildCoreBrief,
  createCiteRecorder,
  createDiffTracker,
  createImmediateExtractor,
  createLastAssistantTextCache,
  createMemoryCycle,
  createMemoryDao,
  createMemoryTools,
  diffInjectionMessage,
  ensureDiffRole,
  ensureFtsIndex,
  ensureRecallRole,
  faceOf,
  MEMORY_DIFF_EVENT_META,
  MEMORY_EXPORT_USAGE,
  MEMORY_IMPORT_USAGE,
  recallForQuery,
  recallInjectionMessage,
  runMemoryExportCommand,
  runMemoryImportCommand,
} from '../memory/index.js';
import type {
  ExtractableUserMessage,
  FtsMaintenanceFace,
  MemoryDiffData,
  MemoryDiffEntry,
  MemoryLlmFace,
  SessionFtsSearchFace,
} from '../memory/index.js';
import type { SessionsFace } from './sessions-face.js';
import { collectAgentDefs, createAgentLayerProvider, createStandardAgentLayers } from '../skills/index.js';
import { createAgentTool, materializeDeclarativeSubagents, JOBS_SERVICE_NAME } from '../subagent/index.js';
import type { DelegationToolDeps, SubagentService } from '../subagent/index.js';
// 批 19e HTTP 面族四件（sdk/webui/issue/obs——core 15 件齐册）
import { createSdkHttpFace } from '../sdk/index.js';
import type { PluginRouteRegistry, SdkHttpFaceHandle } from '../sdk/index.js';
import { createObsQueryTool, createObsService } from '../obs/index.js';
import type { ObsAlertRule, ObsAudienceFace, ObsEventsFace, ObsNotifyFace } from '../obs/index.js';
import { createGithubBackend, createIssueService, mountIssueWebhook, normalizeIssueConfig } from '../issue/index.js';
import { ISSUE_VERIFY_TAIL_BYTES } from '../issue/index.js';
import type {
  IssueBudgetFace,
  IssueDangerFace,
  IssueDangerStatusFace,
  IssueJobsFace,
  IssueSchedulerFace,
  IssueSessionFace,
  IssueStoreStateFace,
  IssueVerifyResult,
  IssueWebhookMountFace,
} from '../issue/index.js';
import { createWorktreeService } from '../tools/index.js';
import type { WorktreeService } from '../tools/index.js';
// c 批 credentials 件（c-3 席占位入册 / c-5 人面命令注册——03 §10.9）
import {
  CREDENTIALS_USAGE,
  parseCredentialsArgv,
  runCredentialsCommand,
  runDeviceCodeFlow,
  resolveOAuthFlow,
  createRefreshChain,
} from '../credentials/index.js';
import type {
  CredentialChangedPayload,
  CredentialsCommandStore,
  OAuthFetchLike,
  OAuthFlowRegistry,
  RefreshChainHandle,
} from '../credentials/index.js';

import type { PluginContext } from './plugin-context.js';
import type { CorePluginReference } from './loader.js';
import type { WebuiFaceMount } from './webui-bridge.js';

/**
 * core:exec——spawn 管道装载期自持（进程级单例：登记簿/孤儿清扫随管道
 * 同生命周期）+ 'exec' 服务面供给（会话装配期工厂形——exec 禁用 = bash
 * 静默缺席，对话本体仍通）。bash 工具件经 openTools 既有消费位拾取
 * （scope.tryGet 诚实缺席律），不走 ctx.tools.register 散装注册（双路
 * 会撞名——装载面单路执法）。
 *
 * 'exec-pipeline' 第二供给位（批 19d）：SpawnPipeline 真身——三桥（mcp/
 * browser/lsp）子进程「spawn 管道 + 登记簿同册」的单源（04 §11 spawn
 * 管道注释明文「三桥共用」）。exec 件禁用 = 管道缺席 = 三桥 spawn 主闸
 * 缺席零装载（诚实缺席——单册单源不旁路自建）。
 *
 * c-4 注入腿拾取：apply 期经共享根 tryGet('credentials-env-ref') 取凭证
 * 引用形展开器（plugin-boot 席位接线——与 ctx.secrets 席位门同一双条件；
 * 03 §10.9 注入腿）——MCP/LSP server config env 的 `@credentials:<name>`
 * 在 spawn 时刻单点展开。
 *
 * 工厂形（批 19b-1 deps 聚落律同款）：沙箱服务持 dataDir——敏感件读集
 * 单源注入（04 §7 读侧 carve-out 的 profile 腿，2026-09-08 P0①）。
 * dataDir null（:memory: 诊断形）= 无敏感集（confine 零读 deny 行）。
 */
function makeExecPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'exec',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx) {
      const context = ctx as PluginContext;
      // 管道/沙箱服务进程级单例：spawn 登记簿与后端链探测缓存（probe 有
      // spawn 开销——单例缓存一次）均无会话态；沙箱后端链缺省平台链
      // （macOS seatbelt / Linux bwrap——safety 单源）。
      // 凭证引用形展开器（c-4 注入腿）：plugin-boot 席位在场时供入共享根
      // （先于 loadPlugins 全程——装载序无关拾取）；缺席 = undefined = 引用形
      // fail-loud（CREDENTIALS_NOT_FOUND——拒以字面值注入，席位缺席律）
      const pipeline = createSpawnPipeline({
        resolveEnvRef: context.tryGet<(name: string) => string>('credentials-env-ref'),
      });
      const sandboxService = createSandboxService({
        // dataDir null = 诊断形无敏感集（skills 工厂同款条件展开形）
        ...(deps.dataDir !== null ? { dataDir: deps.dataDir } : {}),
      });
      context.provide('exec-pipeline', pipeline);
      const service: ExecToolService = {
        // 会话装配期工厂：进程级单例闭包自持 + 会话级 deps（档位/审批/工作
        // 区）由消费位注入求值——结构契约单源在 conversation/types.ts；
        // deps.sandboxService 显式在场时胜出（测试/宿主覆盖位——展开序在后）
        createBashTool: (deps2) => createBashTool({ pipeline, sandboxService, ...deps2 }),
        // goal gates command 源 seam 工厂（03 §10.5 ex 批——exec 判据门真
        // 接线）：装载期单例闭包供入（pipeline/sandbox 自持 + goal 侧
        // workspaceRoot 注入——恒 workspace-write/无升权/30s 帽，细则归
        // exec/gate-exec.ts）；goal 件 tryGet 序内前件消费
        createGateExec: (workspaceRoot) => createGateExec({ pipeline, sandboxService, workspaceRoot }),
      };
      context.provide('exec', service);
    },
  };
}

/**
 * core:web——fetch 工具（effect 'read'，经 ctx.tools.register 散装注册走
 * bootTools 重放消费腿）+ 'web-fetch' 服务面供给（02 §4.1 席 18「ctx.fetch」
 * 词面落形：服务名带域防裸名撞位）。v1 归因面诚实缺席（sink 缺省
 * no-op——观测面无消费位，随真实需求再启窗）。
 */
const webPlugin: CorePluginReference = {
  name: 'web',
  // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
  // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
  api: { minApiVersion: '1.0' },
  async apply(ctx) {
    const context = ctx as PluginContext;
    // 在飞门单例（容量缺省单源 DEFAULT_WEB_LIMITS.maxConcurrent = 4——fetch
    // 工具/服务面/browser 导航三消费位同一实例；browser 件经 'web-fetch'
    // 服务闭包共享 gate，不另立 'web-gate' 供给位）
    const gate: InFlightGate = createInFlightGate(DEFAULT_WEB_LIMITS.maxConcurrent);
    const service = createWebFetchService({ gate });
    context.provide('web-fetch', service);
    // 工具注册（boot 全局层——openTools 会话装配重放走真三段管道）
    return context.tools.register(createFetchTool(service));
  },
};

/**
 * 宿主真身注入面（批 19b-1 工厂形升级——19a 尾注预留兑现）：件内自足构造
 * 覆盖不了的装配期事实经此入件（dataDir 是首位——skills user 层锚 /
 * memory 件数据面等后续件逐笔扩展）。工厂形 vs 静态数组：deps 装配期才
 * 定形（runtime.dataDir 先于装载），静态数组装不进运行时事实。
 *
 * W7 分片（2026-09-15 四问评估架构批落地）：41 位成员按消费 core 件拆
 * 十二子接口（共享位 + 十一件专属位），本接口聚合 extends 形保持名字与
 * 成员结构恒等（结构类型不变 ⇒ 消费位零改动——webui-bridge/issue-
 * session 两处仅注释提及，assembly 为内联构造位、index 为类型再导出，
 * 均不感知分片；core-plugins 内件工厂参数仍收本聚合型）。子接口序随
 * 文件件工厂序；无专属位件不立子接口（web 零 deps；exec/skills/
 * browser/lsp 需求全在共享位）。新成员落位纪律：件专属语义随件入子
 * 接口、跨件共享入共享位，JSDoc 注明归属件与来源批——20+ 成员逐笔
 * 扩位的合并冲突热点与认知瓶颈由此收口。
 */
export interface CorePluginHostDeps
  extends
    SharedPluginHostDeps,
    MemoryPluginHostDeps,
    SubagentPluginHostDeps,
    SchedulerPluginHostDeps,
    GoalPluginHostDeps,
    CheckpointPluginHostDeps,
    SdkPluginHostDeps,
    WebuiPluginHostDeps,
    ObsPluginHostDeps,
    IssuePluginHostDeps,
    McpPluginHostDeps,
    CredentialsPluginHostDeps {}

/**
 * 宿主真身注入面——共享位（W7 分片）：两件以上 core 件共同消费的装配期
 * 宿主事实六位。逐位消费件账：dataDir 八件（exec/skills/memory/
 * subagent/checkpoint/obs/issue/browser——:memory: 诊断形判据同源）；cwd
 * 六件（skills/memory/subagent/goal/issue/lsp）；homeDir 三件（skills/
 * subagent/browser）；notify 九件（memory/scheduler/goal/checkpoint/
 * issue/mcp/browser/lsp/credentials——命令输出面单源）；sqlite 三件主闸
 * （memory 原文注；scheduler/goal 同律复用——各件头注互见）；
 * conversationStack 两件（scheduler 进程内推进 / goal 停靠唤醒）。件专属
 * 语义成员随件入各自子接口，不入此。
 */
interface SharedPluginHostDeps {
  /** 数据目录（null = :memory: 诊断形——skills user 层跳过等件内分支判据） */
  readonly dataDir: string | null;
  /**
   * 工作目录（缺省 process.cwd——skills project 层锚；测试注入隔离形）。
   * 注意此处传原始 cwd：project 层锚定用 canonicalWorkspaceRoot（.git 上溯）
   * 在 createStandardLayers 件内执法。
   */
  readonly cwd?: string;
  /** 家目录（缺省 os.homedir——skills 跨库层锚；测试注入隔离形防扫真实 HOME） */
  readonly homeDir?: string;
  /**
   * SQLite 座工厂（批 19b-2——memory 件主闸：宿主库同库同事务面，生产装配
   * 恒接线 persistence.store.sqlite()）。缺席 = memory 件整体零装载（诚实
   * 缺席律——测试替身形/:memory: 诊断形无库座即无记忆面，对话本体仍通）。
   */
  readonly sqlite?: () => SqliteDatabase;
  /**
   * 命令输出面（core 件命令结算文本投递——memory-export/import 与 /tick 共用；
   * source = 归因字面〔命令域〕——呈现侧路由后端自决，语义面 = 可辨识命令
   * 来源。缺席即静默，命令仍注册）。TUI 第四役 finding A 起另承件内失败诊断
   * warn 的 transient 呈现腿（memory/subagent 先例 + F1 收编批扫尾
   * scheduler/goal/checkpoint/obs/issue 五件入列——leveled logger 之外的
   * 双发位；boot 期通道未挂时静默扇出零观众属常态）。
   */
  readonly notify?: (source: string, message: string) => void;
  /**
   * 宿主对话栈（u-2 无人值守深化批——04 §12 定形注①进程内推进律）：在场 =
   * 引擎 runner 换进程内实装（scheduler-tick——宿主进程内经 conversation-stack
   * 起 headless run，fire 不 spawn）；缺席 = 测试替身形降级 process runner
   * （spawn 诚实收场）。**生产装配根恒注入**（assembly 单源——本位缺席即
   * 装配残缺，e2e 回归锁锁死生产可达形恒进程内）。
   */
  readonly conversationStack?: ConversationStack;
}

/**
 * core:memory 件 deps 专属位（W7 分片；来源批 19b-2 + 2026-09-13 复盘
 * 发现 ⑯）：周期腿（review 窗取源 / LLM 窄面）与工具族检索五 seam。
 * 另消费共享位：sqlite（主闸一）+ cwd + dataDir + notify。
 */
interface MemoryPluginHostDeps {
  /**
   * 单会话收口订阅面（2026-09-13 复盘发现 ⑯——简报冻结缓存收口摘除）：
   * memory 件 apply 期订阅，feed(sessionId) 在该会话 retire 成功路调用
   * （dismantle + 摘登记后——观察者异常吞隔离在发射侧）。订阅位语义 =
   * 末位覆写（/reload 换代 boot 重跑、新件重订阅即顶替旧代 feed——旧代
   * 缓存随旧件废弃，无累积）。缺席 = 无摘除腿（测试替身形——帽 256 FIFO
   * 兜底仍在）。
   */
  readonly subscribeSessionRetire?: (feed: (sessionId: string) => void) => void;
  /**
   * durable 事件读 seam（周期路 review 窗取源——活体日志优先、落盘读兜底；
   * 装配序见 assembly.ts）。缺席 = memory 周期腿整体缺席（即时提取仍通）。
   */
  readonly fetchEvents?: (sessionId: string) => readonly SessionEvent[];
  /** 跨会话检索 seam（memory 工具族联合检索腿——缺席退化纯记忆库检索） */
  readonly ftsSearch?: SessionFtsSearchFace;
  /** FTS 维护 seam（激活期对账 ensureFtsIndex——缺席跳过对账） */
  readonly ftsMaintenance?: FtsMaintenanceFace;
  /**
   * LLM 服务窄面工厂（周期路 review——词面独立律：memory 席 DAG 无 llm 边，
   * 适配器归装配根。缺席 = 周期腿整体缺席（与 fetchEvents 同闸）。
   */
  readonly llm?: () => MemoryLlmFace;
}

/**
 * core:subagent 件 deps 专属位（W7 分片；来源批 19c-1 + RP5 物化腿）：
 * 委派服务 + 执行时会话语境解析 + 插件层物化钩子接收位三 seam。另消费
 * 共享位：cwd/dataDir/homeDir（skills 三层锚同款注入形）。
 */
interface SubagentPluginHostDeps {
  /**
   * 子代理委派服务（批 19c-1——assembly 根建 createSubagentService 并接线
   * in-process 真工厂后传入）。缺席 = subagent 件整体零装载（诚实缺席律
   * ——测试替身形无委派面，对话本体仍通）。
   */
  readonly subagents?: SubagentService;
  /**
   * 委派工具执行时会话语境解析（boot 全局层形真源）：sessionId → 委派深度
   * （登记表）+ 全量工具名快照（driverOf().toolNames）。缺席 = 工具静态
   * 闭包位兜底、两源俱缺席诚实拒（tool.ts resolveToolContext 律）。
   */
  readonly subagentSessionContext?: (sessionId: string) => {
    readonly depth: number;
    readonly availableTools?: readonly string[];
  };
  /**
   * 子代理插件层物化钩子接收位（RP5 物化腿——03 §6.3 兑现）：core:subagent
   * apply 上挂 resync 钩子经本 sink 交 assembly 编排（boot 后首调 + /reload
   * reapply 内重调——镜像 resyncPluginSkillLayers 时序位）。缺席 = 插件层
   * agentDirs 物化腿不接线（测试替身形——标准层物化照常）。
   */
  readonly subagentLayerResyncSink?: (hook: SubagentLayerResyncHook) => void;
}

/**
 * core:scheduler 件 deps 专属位（W7 分片；来源批 19c-2 + 20c）：调度闸
 * 事实收集器 + 真 bin + cron 乙案开关/执行器四位。另消费共享位：sqlite
 * （主闸——同 memory 律）+ conversationStack（u-2 进程内推进）+ notify
 * （/tick 归因 'tick'）。
 */
interface SchedulerPluginHostDeps {
  /**
   * 调度闸事实收集器（批 19c-2——04 §12 DiscoveryGates 装配位）：engine 到点
   * fire 前逐行求值（agentBusy/lastUserMessageAt/canAfford 从宿主面收集——
   * 在飞 run 查询/最近用户消息/当日后台预算三源）。缺席 = 引擎空事实全门
   * 放行（fail-open 属实——gates 头注：打扰礼仪与预算面非安全边界）。
   * 批 20c 装配根接线兑现（宿主三面齐——assembly 侧闭包单源）。
   */
  readonly schedulerGateFacts?: (row: JobRow) => GateFacts;
  /**
   * run 子进程可执行（批 20c 真 bin 出厂——runner spawn 与 cron 行命令段
   * 共用单源；装配根解析 env BERRY_AGENT_BIN 注入，缺席 'berry'
   * PATH 名解析——bin 缺席诚实归 spawn_failed 结局）。
   */
  readonly schedulerBinCommand?: string;
  /**
   * cron 乙案开启位（批 20c——04 §12 已裁乙案「用户显式开启的增强面」）：
   * true = 装配 OS cron 注册器（service 启停/删行同步 OS 注册态 + 装载期
   * 既有启用行对账回填）；缺席/false = 纯进程内挂钟（缺省形态）。env 载体
   * BERRY_AGENT_CRON=1（显式置值即人面授权链的 env 形——写系统 crontab
   * 的授权凭据，装配根解析注入本位）。
   */
  readonly schedulerCronEnabled?: boolean;
  /**
   * crontab 执行器注入（批 20c 测试接缝——缺省 spawnSync 真身；测试注假件
   * 零真系统写。生产装配根不置位）。
   */
  readonly schedulerCronExec?: (args: string[], input?: string) => { stdout: string; stderr: string; code: number };
}

/**
 * core:goal 件 deps 专属位（W7 分片；来源批 19c-3 / #99 / s 批 / u-3）：
 * 预算广播 + 会话日志读面（主闸二）+ 沉淀摘要窄面 + 全环服务捕获位四位。
 * 另消费共享位：sqlite（主闸一）+ cwd（gates workspaceRoot 锚）+ notify
 * （/goal 归因 'goal'）+ conversationStack（u-3 停靠唤醒链）。
 */
interface GoalPluginHostDeps {
  /**
   * 宿主级 budget-extended 广播件（u-3——04 §5 定形注①：canAfford 恢复
   * watcher 升格宿主件装配根单真身）。在场 = goal 停靠项登记广播面（预算
   * 恢复时 enable 挂钟行 + submit 唤醒——§12 唤醒判定链同链）；缺席 = goal
   * 停靠无自动唤醒腿（落词 + disable 挂钟行仍执法——与「硬停等人工」等价
   * 的诚实降级，测试替身形零广播）。
   */
  readonly budgetBroadcast?: BudgetBroadcastFace;
  /**
   * goal 会话日志读面（批 19c-3——GoalSessionFace：goal 段 fold 重放面 +
   * 激活锚长度单源「位置类数值取宿主单源长度面」）。缺席 = goal 件整体零
   * 装载（主闸二——同 sqlite 律；/goal 命令 eventsFor 面同源派生）。
   */
  readonly goalSession?: GoalSessionFace;
  /**
   * goal 沉淀摘要窄面（批 #99——GoalSummarizerFace：04 §3.7 complete 单发
   * 件；词面独立律 goal 席 DAG 无 llm 边，LlmService 适配器归装配根注入）。
   * 缺席 = depositFor 恒走确定性回退（objective + 计划态计数——零 LLM 保底）。
   */
  readonly goalSummarizer?: GoalSummarizerFace;
  /**
   * goal 全环服务宿主捕获位（s 批——provide 投影律〔03 §10.5 s 批补注②〕的
   * 装配域例外通道）：boot 件内 service 创建后单发回调（全量 GoalService——
   * 写动词在内）。**生产装配恒缺席**（宿主消费面全经六法投影/件内闭包——
   * provide 面插件只见投影；创建写面 = /goal create 人面命令〔U10 批——03
   * §10.5 U10 落码定形注①〕，CLI 形随定形注④重开条件挂账）；消费方 =
   * e2e rig（approve/complete 等生命周期全环位的测试通道）。回调时点 =
   * service 创建后、provide 前。
   */
  readonly goalServiceSink?: (service: GoalService) => void;
}

/**
 * core:checkpoint 件 deps 专属位（W7 分片；来源批 19c-4——05 §5.3 词面
 * 独立三 seam）：会话语境读面（主闸二）+ fork 面（主闸三）+ 焦点会话
 * 取值器。另消费共享位：dataDir（主闸一）+ notify（/rewind 归因）。
 */
interface CheckpointPluginHostDeps {
  /**
   * checkpoint 会话语境读面（批 19c-4——05 §5.3 词面独立 seam：
   * contextOf(sessionId) → {末闭合边界, 工作区锚}——gate per-run 判据与
   * manifest 锚的唯一真源）。缺席 = checkpoint 件整体零装载（主闸二——
   * 同 dataDir 律）。
   */
  readonly checkpointSession?: SessionContextFace;
  /**
   * checkpoint fork 面（批 19c-4——05 §5.3 词面独立 seam：restore 三步序
   * 第③腿，SessionManager.fork 判别子集形可直赋）。缺席 = checkpoint 件
   * 整体零装载（主闸三——半装载的 gate 会拍快照但 /rewind 无法恢复 = 伪
   * 承诺，整体不装）。
   */
  readonly checkpointFork?: RewindForkFace;
  /**
   * 焦点会话取值器（批 19c-4——/rewind 发起会话真源：命令分派时点
   * channels.focusedId；list 按其工作区锚列点、保底快照归属同源）。
   * 缺席 = /rewind 诚实拒（无焦点会话上下文），gate 不受影响。
   */
  readonly focusSessionId?: () => string | undefined;
}

/**
 * core:sdk 件 deps 专属位（W7 分片；来源批 19e + U5-2）：HTTP 面工厂
 * （件主闸）+ 插件道路由受理器 kit 透传位两位（stdio JSONL 不依赖件
 * 装载态〔F16〕归宿主 serve 子命令，不入件 deps）。
 */
interface SdkPluginHostDeps {
  /**
   * SDK HTTP 面工厂（批 19e——core:sdk 件主闸：HTTP 传输适配 + MCP 包装
   * 的件承载真身。stdio JSONL 不依赖件装载态〔F16〕归宿主 serve 子命令）。
   * 缺席 = sdk 件零装载——daemon 形态必开面由此拒启退 2（07 §5），TUI/
   * serve 的 --port 开面消费件在场性（kit 缺席 = /v1/* 仍可开）。
   */
  readonly sdkFaceFactory?: typeof createSdkHttpFace;
  /**
   * 插件道路由受理器（U5-2——core:sdk 件 kit 透传位）：assembly 单真身
   * createPluginRouteRegistry 经本位进 'sdk-http-face' kit——三入口开面
   * 消费 snapshot（构造期 replay）/ attachFace（面开后受理晚注册位）。
   * 缺席 = 测试替身形（kit 不含该位——受理账无人 replay，装配根不接
   * 插件道路由的形）。fork 绑定真源在 bootPlugins options.sdkRoutes
   * （此处只透传面开面消费位——两腿同真身）。
   */
  readonly sdkPluginRoutes?: PluginRouteRegistry;
}

/**
 * core:webui 件 deps 专属位（W7 分片；来源批 19e）：webui 挂载 kit 一位
 * （件主闸）。另消费共享位：无（路由挂载外零 deps）。
 */
interface WebuiPluginHostDeps {
  /**
   * webui 挂载 kit（批 19e——core:webui 件主闸：路由挂载闭包（面级
   * handle + 可选 staticDir → 挂载产物窄面）。件零自持监听（全库唯一
   * 监听族住 core:sdk 面）。缺席 = webui 件零装载 = /api/* 404 而面
   * 仍在（两件禁用语义族——03 §10.4/07 §4.2）。
   */
  readonly webuiFaceMount?: (face: SdkHttpFaceHandle, options?: { staticDir?: string }) => WebuiFaceMount;
}

/**
 * core:obs 件 deps 专属位（W7 分片；来源批 19e）：事件读面（主闸二）+
 * 告警通知面 + 观众探针三位。另消费共享位：dataDir（主闸一）。
 */
interface ObsPluginHostDeps {
  /**
   * obs 事件读面（批 19e——obs 件主闸二：durable 事件流摄取源 =
   * Store.queryEvents 真身直传〔结构兼容 ObsEventsFace——05 §3.4 宿主面
   * 消费位〕）。缺席 = obs 件零装载（主闸一 = dataDir）。
   */
  readonly obsEvents?: ObsEventsFace;
  /** obs 告警通知面（缺席 = 告警腿静默降级——非主闸，摄取/查询面仍通） */
  readonly obsNotify?: ObsNotifyFace;
  /** obs 观众探针（缺席 = 恒无观众——告警评估跳过且不耗冷却，07 §4.3 原句语义） */
  readonly obsAudience?: ObsAudienceFace;
}

/**
 * core:issue 件 deps 专属位（W7 分片；来源批 19e + c-5 迁移 + 04 §7
 * 补钉①）：headless 起会面（主闸三）+ 轮询水位读写 + 全局预算窄面 +
 * GitHub token/webhook secret + worktree 共享位六位。另消费共享位：
 * dataDir（主闸一）+ cwd（worktree 件内自建回落锚）+ notify（issue
 * 人面命令输出归因）。
 */
interface IssuePluginHostDeps {
  /**
   * issue headless 起会面（批 19e——issue 件主闸三：IssueSessionFace
   * 装配位真身，host/issue-session.ts createIssueSessionFactory in-process
   * 工厂产物、assembly 装配根接线）。缺席 = issue 件零装载。〔2026-09-13
   * f-3 注记勘正：原「挂账改道 ctx.triggers.register」注已过时——03 §10.7
   * 2026-09-09 改向注记定形：起会腿归宿主装配直连（cwd 绑定/工具面追加/
   * 终局四态映射/停靠-唤醒循环系编排语义非触发语义，TriggerStartSpec 四位
   * 形状不匹配），不经动词面即无门检面——装配注入位本身即宿主裁决权〕
   */
  readonly issueSession?: IssueSessionFace;
  /**
   * issue 轮询水位读写面（批 19e——store_state 受理制键值面：Store 三法
   * 〔getStoreState/setStoreState/deleteStoreState〕同名同形真身直传可赋
   * IssueStoreStateFace——不自建账本〔宪章二〕）。
   */
  readonly issueState?: IssueStoreStateFace;
  /** issue 全局预算窄面（批 19e——04 §5 日池判适配：canAfford('background')） */
  readonly issueBudget?: IssueBudgetFace;
  /**
   * GitHub token（env `BERRY_AGENT_GITHUB_TOKEN`——凭证盒未立前 env 载体
   * 先行，03 §10.7 触发面 19e 装载定形注）。缺席 = issue 件零装载（后端
   * 契约 token 必填——公开仓亦然，诚实缺席非故障）。
   */
  readonly issueGithubToken?: string;
  /**
   * webhook HMAC secret（env `BERRY_AGENT_ISSUE_WEBHOOK_SECRET`——同上注）。
   * 缺席/空 = webhook 面未开启（挂路由守卫 400 形——空密钥 HMAC 确定性
   * 可伪造，禁值守卫）。
   */
  readonly issueWebhookSecret?: string;
  /**
   * worktree 服务共享注入位（04 §7 补钉① + 03 §10.7 六役定形注）：issue
   * 件编排授予（create 自动授予 / grant 补授）与会话内工具消费（三工具
   * 挂载 + fence grantedRoots 并入）必须同台账——装配根建单实例经本位与
   * ConversationStackOptions.worktree 双注。**生产装配恒注入**；缺席 = issue
   * 件内自建（件内真身构造——直接测试形保独立可跑，生产同源律由装配根
   * 承担）。
   */
  readonly worktree?: WorktreeService;
}

/**
 * core:mcp 件 deps 专属位（W7 分片；来源批 19d）：宿主版本披露一位。
 * 另消费共享位：notify（mcp 命令输出归因）。
 */
interface McpPluginHostDeps {
  /**
   * 宿主版本（批 19d——mcp 件 initialize 握手 clientInfo.version 披露，
   * 「装配批对齐 package.json」兑现位：装配根 options.version 单源）。
   * 缺席 = mcp 桥内缺省 '0.1.0'。
   */
  readonly version?: string;
}

/**
 * core:credentials 件 deps 专属位（W7 分片；来源批 c-5/c-6——03 §10.9）：
 * 凭证存储窄面 + credentials/changed 审计 seam + oauth 流受局三位。
 * 另消费共享位：notify（/credentials 人面命令输出归因）。
 */
interface CredentialsPluginHostDeps {
  /**
   * 凭证存储窄面（c-5——03 §10.9 写入面：/credentials add|list|rm 人面
   * 命令读写真源。词面独立律：CredentialsCommandStore 结构兼容 persist
   * Store 凭证方法子集四法，assembly 直传 persistence.store）。缺席 = 件
   * 人面命令零注册（空闲占席维持——装载计数与禁用位语义不受影响）。
   */
  readonly credentialsStore?: CredentialsCommandStore;
  /**
   * credentials/changed 审计 seam（c-5——人面 add/rm 发射位；05 §1.1 载荷
   * 值域单源。缺省 no-op = 测试形；生产装配已接线 audit_events 真发射
   * ——assembly U3 批 U3-5，2026-09-13 勘正旧挂账注记）。
   */
  readonly credentialsOnChanged?: (payload: CredentialChangedPayload) => void;
  /**
   * oauth 流受局面（c-6——03 §10.9 oauth 案）：流注册表（assembly 单真身，
   * 与 plugin-boot fork 绑定共用）+ fetch 注入（生产 = SSRF 守卫包裹 fetch
   * ——assembly oauthFetch 单源，2026-09-09 守卫批已收口；缺省/测试形 =
   * globalThis.fetch 直传）+ 刷新链节奏（缺省
   * 60s 自驱；0 = 不自驱——测试手动 tick）+ 单败 warn 去向（缺省丢弃——
   * 三振 notify 告警腿恒在场）。缺席 = oauth 动词不启用 + 刷新链不起
   * （/credentials 命令三动词不受影响）。
   */
  readonly credentialsOAuth?: {
    readonly registry: OAuthFlowRegistry;
    readonly fetchFn: OAuthFetchLike;
    readonly intervalMs?: number;
    readonly warn?: (message: string) => void;
  };
  /**
   * 刷新链句柄外露位（B3 联动批——04 §3.3 条 8 宿主凭证刷新联动腿）：
   * 受局面在场链创建后回调一次（装配根收句柄桥 authRefresh seam 的
   * refreshNow 面）；受局面缺席链未建 = 不回调（seam 侧链缺席恒
   * unavailable/no-refresh-face——零刷新面如实）。换代重装载 = 末位胜出
   * （新链句柄覆写旧代，旧链随件 dispose 停钟）。
   */
  readonly credentialsChainSink?: (handle: RefreshChainHandle) => void;
}

/**
 * core:skills——技能注册表装载（06 §11 渐进披露装载态兑现）：标准六位层
 * 构造 + 全量 refresh 落快照 + 'skills' 服务面供给（插件 tryGet 消费）+
 * skill_manage 管理工具 + load_skill 装载工具（boot 全局层散装注册——
 * bootTools 重放消费腿；06 §11.5(a) 按需拉取模）+ 'skills/manifest'
 * 提示词段（每请求物化——registry 快照变化即生效，06 §11.3 渐进披露的
 * 「披露清单」半边；装载半边 = load_skill 具名通道 / read FS 通道归
 * agent 工具面）。
 *
 * 磁盘件技能目录载荷层（06 §11.4 位 4）不在此 apply——装载序结构性晚到
 * （synthesizePlan core 行先入 plan，磁盘件 manifest.skills 此刻未激活），
 * 补注册编舞（摘 factory → 位 4 逐插件插入 → factory 重挂保序）落 assembly
 * boot 后段（2026-09-08 批 19 skills 销账笔兑现——06 §11.3 插件层压出厂层）。
 *
 * skills_change 事件桥不在此（ctx.emit 域名律强制 `core:skills/` 前缀
 * ——全局词结构性不可达）：桥落 assembly boot 后段（宿主侧
 * dispatch.emit 直发——03 §3.4 汇流点同形）。
 */
function makeSkillsPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'skills',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx) {
      const context = ctx as PluginContext;
      // 标准六位层（project/user/跨库/出厂——插件层装载收口后于 assembly 补
      // 注册见上注；dataDir null 跳过 user 层；cwd/homeDir 缺省真跑形）
      const registry = createSkillsRegistry();
      const layers = createStandardLayers({
        ...(deps.cwd !== undefined ? { cwd: deps.cwd } : {}),
        ...(deps.dataDir !== null ? { dataDir: deps.dataDir } : {}),
        ...(deps.homeDir !== undefined ? { homeDir: deps.homeDir } : {}),
      });
      for (const layer of layers) registry.registerProvider(layer);
      await registry.refresh(); // 装载期落首版快照（诊断 warn 不杀装载）
      context.provide('skills', registry);
      // skill_manage：workspaceRoot = canonical 工作区根（create 落点锚）；
      // 可写面 = project `.agents/skills`（06 §11 用户/跨库层只读——写点
      // 前置断言面在件内）
      const workspaceRoot = () => canonicalWorkspaceRoot();
      const disposeManageTool = context.tools.register(
        createSkillManageTool({
          registry,
          workspaceRoot,
          writableRoots: () => [join(workspaceRoot(), '.agents', 'skills')],
        }),
      );
      // load_skill：按需拉取模装载工具（06 §11.5(a) 具名通道——只读无审批对）
      const disposeLoadTool = context.tools.register(createLoadSkillTool({ registry }));
      // 披露清单段：builder 每请求物化时重取快照（PromptSectionBuilder
      // 求值即取——refresh 后变化自然生效）
      const disposeSection = context.prompts.registerSection(
        'skills/manifest',
        () => renderAvailableSkills(registry.list()).text,
      );
      return () => {
        disposeSection();
        disposeLoadTool();
        disposeManageTool();
      };
    },
  };
}

/**
 * 当轮 query 取数（06 §294——recall 注入腿消费位）：durable 日志尾扫最后一条
 * user/message 的 string content（非 string 形〔parts 数组〕不作 query——宁缺
 * 毋滥）。从 durable 日志取而非 LLM batch 尾扫：diff handler 先注入的 user 形
 * 消息会污染 batch 尾扫判据（注入序依赖）。fetchEvents 缺席/读失败/扫到头 →
 * null（零 query 即零注入）。
 */
function lastUserQueryText(
  fetchEvents: ((sessionId: string) => readonly SessionEvent[]) | undefined,
  sessionId: string,
): string | null {
  if (fetchEvents === undefined) return null;
  try {
    const events = fetchEvents(sessionId);
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!;
      if (event.type !== 'user/message') continue;
      const content = (event.data as { content?: unknown } | null)?.content;
      return typeof content === 'string' ? content : null;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * core:memory（批 19b-2）——06 篇记忆面全环装载：DAO（宿主库同库——05 §6.4
 * 迁移链已由 runtime 机械聚合）+ 九工具散装注册（boot 全局层）+ 'memory/core'
 * 常驻简报段（每请求物化）+ session/event 三消费腿（即时提取/引用记录/周期
 * 计数——03 §146 活体镜像的汇入点，发射位在 Persistence.onDurableEvent 桥）+
 * run 终态 due→fire（06 §5 计数挂件拍点 = 会话空闲即审）+ 激活期 FTS 对账 +
 * memory/diff 词汇注册（不可逆装配面）+ memory-export/import 两命令 +
 * 'memory' 服务面供给。
 *
 * 路 2（recallForQuery 按需检索）已接线（批 19 销账笔——06 §6 路 2 消费腿：
 * minScore 水位旋钮缺省不设位〔拍板维持〕——检索路本身在场）；diff 发射位
 * （sessions.appendEventFor 绑会话闭包）与 diff/recall 两注入腿
 * （context_transform 瀑布——06 §328 注入序 diff 先 recall 后）同批收口。
 *
 * 降级梯：sqlite 缺席 = 件整体零装载（主闸）；llm/fetchEvents 缺席 = 周期腿
 * 缺席（即时提取仍通）；ftsSearch/ftsMaintenance/notify 各自缺席各腿静默降级；
 * sessions 服务缺席 = 差分降级只渲染不落账（mirror 不锁步）。
 */
function makeMemoryPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'memory',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx) {
      const context = ctx as PluginContext;
      const db = deps.sqlite?.();
      if (db === undefined) return; // 主闸——库座缺席零装载（诚实缺席律）

      // 件内 warn 出口（TUI 第四役 finding A 修复）：leveled logger 单源 +
      // 通道 notify 双发。修前 console.error 裸文本直写 stderr——与 TUI
      // 渲染共端子同 tty，落当前光标位 + \r\n 物理下移而 cursorRow 账不感知
      // → durable 块按陈账定位整体错行、覆写编辑器盒边框（tmux 活体三复现
      // 定谳）。两腿分立：
      //  - logger 腿：BERRY_AGENT_LOG_LEVEL 辖内（silent 全静默；缺省 info
      //    下 warn 可见——失败面默认可见级），结构化 JSON 行（07 §6 自写
      //    logger；apply 期建盒读 env，与宿主 logger 同 env 单源）；
      //  - notify 腿（在场时）：通道 transient 呈现（TUI 后端受控写出路/
      //    webui 同扇出）——呈现面与日志面分立，不随日志级消音；notify
      //    缺席（测试替身形）纯 logger。
      const warnLogger = createLogger('core:memory', LogLevelState.fromEnv(process.env.BERRY_AGENT_LOG_LEVEL));
      const warn = (message: string) => {
        warnLogger.warn(message);
        deps.notify?.('memory', message);
      };
      const now = () => Date.now();
      // owner 并集（06 §3/§6）：global + project:<canonical 根 sha256 前 16 hex>。
      // 哈希公式属装配侧约定（spec 只钉根语义未钉公式——同根同键跨会话稳定
      // 即要求；dao 侧 regex 容 8-64 hex）
      const workspaceRoot = () => canonicalWorkspaceRoot(deps.cwd);
      const projectKey = `project:${createHash('sha256').update(workspaceRoot()).digest('hex').slice(0, 16)}`;
      const ownerKeys = ['global', projectKey] as const;

      const dao = createMemoryDao({ db, now, warn });

      // 激活期 FTS 对账（06 §10——抽样缺缝全量重建；维护 seam 缺席跳过）
      if (deps.ftsMaintenance !== undefined) {
        ensureFtsIndex({ face: deps.ftsMaintenance, warn });
      }

      // 工具面九件（boot 全局层散装注册——bootTools 会话装配重放消费腿）
      const memoryToolDefs = createMemoryTools({
        dao,
        ownerKeys,
        ...(deps.ftsSearch !== undefined ? { sessionFts: deps.ftsSearch } : {}),
      });
      const disposeMemoryTools = memoryToolDefs.map((def) => context.tools.register(def));

      // 周期路在场判（llm + fetchEvents 双在场才建——缺一即周期腿整体缺席）
      const cycle =
        deps.llm !== undefined && deps.fetchEvents !== undefined
          ? createMemoryCycle({ dao, llm: deps.llm(), fetchEvents: deps.fetchEvents, warn })
          : undefined;
      // 周期 fire 窄面入服务面（五篇研究批 A——06 §4 第三腿：goal 件 tryGet
      // 序内前件消费，注册表序 memory 居 goal 前。void 吞 promise——fire 内部
      // catch 全吞永不抛，goal 终态回调由此零反噬；周期腿缺席不 provide =
      // goal 件 tryGet 诚实缺席，goal 环独立完整不因 memory 缺席降级）
      if (cycle !== undefined) {
        context.provide('memory-cycle-fire', (sessionId: string) => {
          void cycle.fire(sessionId);
        });
      }
      // per-session 最近 assistant 文本回看缓存（§4 即时路第二动作——2026-09-08
      // 消化批；同一 session/event 消费点内喂入零新事件通道，LRU 帽族同 §6 epochs）
      const lastAssistant = createLastAssistantTextCache();
      // 即时提取（isSessionPolluted 与周期路共享同源追踪器——周期腿缺席时
      // 无污染判定源，提取不滤 = 保守多提取，不丢纠正信号）
      const extractor = createImmediateExtractor({
        dao,
        ...(cycle !== undefined ? { isSessionPolluted: (id) => cycle.pollution.isPolluted(id) } : {}),
        // 回看位（§4 即时路第二动作——2026-09-08 消化批）：同会话紧邻前一条
        // assistant 文本（负效用回写消费；喂入腿在下方 session/event 消费点内）
        lastAssistantText: lastAssistant.get,
        warn,
      });
      const cite = createCiteRecorder({ dao, warn });

      // session/event 三消费腿（03 §146——user/message→即时提取；assistant/
      // message→引用记录（件内自滤）+ 回看缓存喂入（§4 第二动作——空文本面
      // 同覆写，「紧邻前一条」语义忠实）；全事件→周期计数（件内自滤 turn/end +
      // tool/call）。surfaceOp 遮蔽指令不进消费面（surface 事件滤除）。
      // 观察者异常隔离双保险：dispatch.emit 监听器互隔离 + 发射侧 try/catch）
      const disposeHook = context.on('session/event', (data) => {
        const { sessionId, event } = data as { sessionId: string; event: SessionEvent };
        if (event.surfaceOp !== undefined) return;
        if (event.type === 'user/message') {
          extractor.onUserMessage(sessionId, event.seq, event.data as ExtractableUserMessage);
        } else if (event.type === 'assistant/message') {
          lastAssistant.observe(sessionId, event.data);
        }
        cite.onEvent(sessionId, event.type, event.data);
        cycle?.onDurableEvent(sessionId, event);
      });

      // run 终态 due→fire（06 §5——会话空闲即审拍点；只 fire 本会话：他会话
      // 各在其自身 settle 拍点 fire。inFlight 单飞锁 + fire 永不抛归件内）
      const agent = context.tryGet<AgentService>('agent');
      const disposeSettle = agent?.onRunSettled((event) => {
        if (cycle !== undefined && cycle.dueSessions().includes(event.sessionId)) {
          void cycle.fire(event.sessionId);
        }
      });

      // 常驻简报段（每请求物化——06 §6 路 1；cache 经济批 ca-2 定形：volatile
      // 声明 + 每会话懒冻结两律合用——03 §2.5 既有宿主段归类基线②）。简报含
      // O1 批时效词面（freshnessLabel 随 nowMs 派生——inject.ts），跨日/TTL
      // 阈值穿越即代内漂移：缺省承诺稳定面下日界一过即 warn 噪声 + 前缀失效
      // ——两律合用取两全：
      //  - volatile 声明 = 跨请求可变诚实化（免漂移 warn + 物化位恒段区尾
      //    ——豁免多会话宿主下交替物化的跨会话锚噪声）；
      //  - 每会话懒冻结 = 会话内字节恒定兑现缓存价值：首请求物化即冻结该会话
      //    简报文本，时效词面取冻结时点值（跨会话各自冻结；会话内记忆变更经
      //    memory/diff 瞬态注入腿呈现——06 §6 差分通道，简报本体不追新）；
      //    sessionId 缺席形〔诊断直物化〕活体物化不冻结。冻结缓存帽 256 会话
      //    逐最旧为兜底位（装载代内闭包——/reload 换代新实例自然重置；批 19
      //    「简报每会话冻结管道改造」挂账随本笔兑销）；主摘除腿 = 会话收口
      //    经宿主订阅面摘条目（发现 ⑯——收口后复续首物化重冻结取新值，见下）
      const briefFreezeCache = new Map<string, string>();
      // 收口摘除订阅（发现 ⑯）：retire 成功路摘该会话冻结条目——下次 open
      // 复续首物化重冻结（收口后的记忆变更不困在旧冻结里）。订阅位缺席形
      // （测试替身）无此腿——帽 256 FIFO 兜底仍在
      deps.subscribeSessionRetire?.((sessionId) => briefFreezeCache.delete(sessionId));
      const disposeBrief = context.prompts.registerSection(
        'memory/core',
        (sessionId?: string) => {
          // sessionId 缺席 = 诊断直物化形——无会话身份可冻结，活体物化
          if (sessionId === undefined) return buildCoreBrief({ dao, now, ownerKeys });
          const frozen = briefFreezeCache.get(sessionId);
          if (frozen !== undefined) return frozen;
          const brief = buildCoreBrief({ dao, now, ownerKeys });
          // 帽 256 逐最旧（Map 插入序 = 首冻结序）
          if (briefFreezeCache.size >= 256) {
            const oldest = briefFreezeCache.keys().next().value;
            if (oldest !== undefined) briefFreezeCache.delete(oldest);
          }
          briefFreezeCache.set(sessionId, brief);
          return brief;
        },
        {
          volatile: {
            reason: '简报时效词面与懒基线随会话/时间自然变化（03 §2.5 归类基线②——每会话懒冻结兜会话内稳定）',
          },
        },
      );

      // memory/diff 词汇注册（不可逆装配面——06 §329 装载面作用域化注册）。
      // 注册表进程级单例（contracts/events 模块态）：同进程多次装配（测试多例
      // /热重启形）同 owner 已在场 = 幂等跳过；异 owner 在场则注册动词保持
      // 响亮冲突（PLUGIN_EVENT_TYPE_CONFLICT 拒收语义不软化——03 §2.7 指派）
      if (getEventTypeMeta(MEMORY_DIFF_EVENT_META.type)?.owner !== MEMORY_DIFF_EVENT_META.owner) {
        context.events.registerSessionEventType(MEMORY_DIFF_EVENT_META);
      }

      // —— memory/diff 发射位 + 两注入腿（批 19 销账笔——06 §6 三件收口）——
      // sessions 服务活引用（03 §4.4 appendEvent 最小面；tryGet 诚实缺席：
      // 服务缺席 = 差分降级只渲染不落账——mirror 不锁步）。ag 批 cs-D2 改形
      // （03 §4.5 定形注）：本 tryGet 消费位不变，取到的恒为 fork 绑定面
      // （bindSessionsForPlugin——宿主单方铸 caller）——落账 data 携
      // source: 'plugin:core:memory' 归因键（caller 归因同律不匿名；MemoryDiff
      // Data 增源键对回放侧透传无感）。基线纪元采 sync 懒立
      // （件内自述语义零变）：纪元首请求即事实上的重建时点边界——boot//reload/
      // /new 三态自然覆盖（新进程/新装配/新会话首请求重立基线），显式
      // materialize 挂点不接（PromptSectionRegistry 每请求重跑 builder——挂其
      // 内即每请求重立纪元，差分恒零）
      const sessions = context.tryGet<SessionsFace>('sessions');
      // 绑会话发射位：DiffAppendEvent seam 无 sessionId 参（词面独立律），
      // handler 调用时点置 appendSession + try/finally 清位（waterfall 串行 +
      // JS 单线程零竞态）；会话无活体驱动 → 抛错让 diff.ts commit() 捕获降级
      // （appendEventFor 的 undefined 语义——本拍不落账不锁步，非致命）
      let appendSession: string | undefined;
      const diffTracker = createDiffTracker({
        face: () => faceOf(briefBaseline(dao, now(), ownerKeys)),
        ...(sessions !== undefined
          ? {
              appendEvent: (type: string, data: MemoryDiffData) => {
                const append = sessions.appendEventFor(appendSession!);
                if (append === undefined) {
                  throw new Error(`会话 ${appendSession} 无活体驱动——差分落账本拍降级`);
                }
                append(type, data);
              },
            }
          : {}),
        ...(deps.fetchEvents !== undefined ? { fetchEvents: deps.fetchEvents } : {}),
        warn,
      });
      // 注入角色两枚（幂等注册——进程级角色注册表多次装配常态）
      ensureDiffRole();
      ensureRecallRole();
      // 注入序（06 §328）：diff handler 注册先于 recall——权威修正先于查询提示
      // 进请求尾；todo 恒最后（驱动侧瀑布后追加——05 §1.1）。两腿体内 try/catch
      // 全包 warn 放行（铁律 3——注入失败不影响会话主路径）；每 handler 每请求
      // 至多一条（零差分/零命中 = 零注入不打扰请求面）
      const disposeDiffInject = context.on('context_transform', (data, next) => {
        const payload = data as ContextTransformInput;
        try {
          appendSession = payload.sessionId;
          let entries: readonly MemoryDiffEntry[];
          try {
            entries = diffTracker.sync(payload.sessionId);
          } finally {
            appendSession = undefined;
          }
          const text = diffTracker.renderInjection(entries);
          if (text !== null) {
            const message = diffInjectionMessage(text, Date.now());
            if (message !== null) payload.messages.push(message);
          }
        } catch (err) {
          warn(`[memory] 差分注入腿尽力而为止步：${err instanceof Error ? err.message : String(err)}`);
        }
        return next(payload);
      });
      const disposeRecallInject = context.on('context_transform', (data, next) => {
        const payload = data as ContextTransformInput;
        try {
          const query = lastUserQueryText(deps.fetchEvents, payload.sessionId);
          if (query !== null) {
            // minScore 不设位 = 水位旋钮缺省关（06 §6 拍板——检索路本身在场）
            const injection = recallForQuery({ dao, now, ownerKeys, sessionId: payload.sessionId }, query);
            if (injection !== null) {
              const message = recallInjectionMessage(injection.text, Date.now());
              if (message !== null) payload.messages.push(message);
            }
          }
        } catch (err) {
          warn(`[memory] 检索注入腿尽力而为止步：${err instanceof Error ? err.message : String(err)}`);
        }
        return next(payload);
      });

      // 命令两件（结算文本 = 人读面，经 notify 归因 'memory' 投递；BaseError
      // 面已在命令内折文本，非 BaseError 兜底折呈不炸通道）
      const runCommand = async (run: () => Promise<string>) => {
        try {
          deps.notify?.('memory', await run());
        } catch (err) {
          deps.notify?.('memory', err instanceof Error ? err.message : String(err));
        }
      };
      const disposeExport = context.channels.registerCommand(
        'memory-export',
        (args) =>
          runCommand(() =>
            runMemoryExportCommand(args.argv, {
              dao,
              writableRoots: () => (deps.dataDir !== null ? [deps.dataDir, workspaceRoot()] : [workspaceRoot()]),
              ownerRoots: () => ({ [projectKey]: workspaceRoot() }),
              now,
            }),
          ),
        MEMORY_EXPORT_USAGE,
      );
      const disposeImport = context.channels.registerCommand(
        'memory-import',
        (args) => runCommand(() => runMemoryImportCommand(args.argv, { dao })),
        MEMORY_IMPORT_USAGE,
      );

      // 服务面：dao/cycle（既有消费面）+ 管理面材料位（mm 批——装配根 boot 后
      // 经 TuiBackend.setMemoryScreen 后置注入 /memory 副屏：ownerKeys 呈现过滤
      // 面 + runExport = /memory-export 处理器同一装配闭包〔真身同一函数〕）
      context.provide('memory', {
        dao,
        cycle: cycle ?? null,
        ownerKeys,
        runExport: (argv: readonly string[]) =>
          runMemoryExportCommand(argv, {
            dao,
            writableRoots: () => (deps.dataDir !== null ? [deps.dataDir, workspaceRoot()] : [workspaceRoot()]),
            ownerRoots: () => ({ [projectKey]: workspaceRoot() }),
            now,
          }),
      });

      return () => {
        disposeRecallInject();
        disposeDiffInject();
        disposeSettle?.();
        disposeHook();
        disposeImport();
        disposeExport();
        disposeBrief();
        for (const dispose of disposeMemoryTools.reverse()) dispose();
      };
    },
  };
}

/**
 * 插件声明子代理层行（RP5 物化腿——assembly resync 喂入载荷：activated 行
 * 滤 agentDirs > 0 的投影形；id = 插件 id 原形，层 id 以 `plugin:<id>` 分域）。
 */
export interface SubagentPluginLayerRow {
  readonly id: string;
  readonly agentDirs: readonly string[];
}

/**
 * 插件层物化钩子（RP5——core:subagent apply 上挂、assembly 编排时序调用：
 * boot 装载收口后首调 + /reload reapply 内重调）。幂等律：重入先全摘旧代
 * 插件层（provider 位 + 工具位两撤）再物化新代。
 */
export type SubagentLayerResyncHook = (rows: readonly SubagentPluginLayerRow[]) => Promise<void>;

/**
 * core:subagent（批 19c-1）——委派面装载态兑现：通用 `agent` 工具（boot
 * 全局层散装注册——执行时会话语境解析，toolCtx.sessionId → 深度/父面
 * 枚举）+ 声明式子代理腿（agents 层发现 [skills/agents.ts 解析层镜像律]
 * → materializeDeclarativeSubagents 物化 named provider + `agent_<name>`
 * 静态工具——前缀保留字闸豁免 core:subagent 域，plugin-context 注记条款）。
 *
 * in-process 真工厂本体在 assembly 根（subagent-factory.ts——真工厂需
 * ConversationStack 真身，件内不可达）；本 apply 只消费 service 面 +
 * sessionContext 解析闭包（deps 两新位）。缺席 = 件整体零装载。
 *
 * 两阶段物化（RP5——③ §6.3 兑现注）：标准层在 apply 内物化（boot 窗内、
 * durable 世代行工具账全）；插件层经 resync 钩子在装载收口后物化（活体
 * 工具账在、durable 世代行缺席 = core:mcp 异步工具同一诚实边界）。disposer
 * 两撤（provider 位 + 工具位）——/reload 重放 boot 时撞名修复的撤位律。
 */
function makeSubagentPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'subagent',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx, _config, host) {
      const context = ctx as PluginContext;
      const service = deps.subagents;
      if (service === undefined) return; // 缺席零装载（诚实缺席律——assembly 未接线形）

      // 件内 warn 出口（TUI 第四役 finding A 同族位）：同 core:memory 律——
      // leveled logger（BERRY_AGENT_LOG_LEVEL 辖内；缺省 info 下 warn 可见）
      // + 通道 notify 双发（transient 呈现；缺席纯 logger）。console.error
      // 裸文本直落 TUI 屏的写出路根除（坏 agent 文件诊断/resync 物化拒族）。
      const warnLogger = createLogger('core:subagent', LogLevelState.fromEnv(process.env.BERRY_AGENT_LOG_LEVEL));
      const warn = (message: string) => {
        warnLogger.warn(message);
        deps.notify?.('subagent', message);
      };
      // 工具 deps：boot 全局层形只携 sessionContext（执行时解析——静态位
      // 全缺席；两源俱缺席时 resolveToolContext 诚实拒）
      const toolDeps: DelegationToolDeps = {
        service,
        ...(deps.subagentSessionContext !== undefined ? { sessionContext: deps.subagentSessionContext } : {}),
      };
      const disposeAgent = context.tools.register(createAgentTool(toolDeps));

      // 声明式腿：标准层发现（project/user/跨库——dataDir null 跳 user 层，
      // 同 skills 律）→ 坏文件诊断 warn（不炸装配——skills 纪律镜像）→
      // def 物化（named provider 注册 + 静态工具族）。owner 显式
      // 'core:subagent'（物化执行方归因——plugin-boot 物化回调同律；层来源
      // 分域在发现层 id 表达）
      const layers = createStandardAgentLayers({
        ...(deps.cwd !== undefined ? { cwd: deps.cwd } : {}),
        ...(deps.dataDir !== null ? { dataDir: deps.dataDir } : {}),
        ...(deps.homeDir !== undefined ? { homeDir: deps.homeDir } : {}),
      });
      const collection = await collectAgentDefs(layers);
      for (const diagnostic of collection.diagnostics) {
        warn(`[subagent] ${diagnostic.type}：${diagnostic.message}（${diagnostic.path}）`);
      }
      const materialized = materializeDeclarativeSubagents(collection.defs, service, toolDeps, {
        owner: 'core:subagent',
      });
      const disposeDeclarative = materialized.tools.map((tool) => context.tools.register(tool));

      // ── 插件层物化钩子（RP5）：assembly 在装载收口后调（boot 尾/reapply）；
      // 重入先全摘旧代（reload 换代对称——provider 位 + 工具位两撤，首跑
      // 零层幂等）。层 id `plugin:<id>` 分域（与标准层结构性不撞——skills
      // resync 同律）；插件层间 first-wins = 装载序（collectAgentDefs 单源）；
      // 跨层撞标准层名走注册面拒 → warn 降级逐 def 隔离（不炸 resync）。
      let pluginPhaseDisposers: Array<() => void> = [];
      const resyncPluginAgentLayers: SubagentLayerResyncHook = async (rows) => {
        for (const dispose of pluginPhaseDisposers.reverse()) dispose();
        pluginPhaseDisposers = [];
        if (rows.length === 0) return;
        const providers = rows.map((row) =>
          createAgentLayerProvider({ id: `plugin:${row.id}`, roots: [...row.agentDirs] }),
        );
        const pluginCollection = await collectAgentDefs(providers);
        for (const diagnostic of pluginCollection.diagnostics) {
          warn(`[subagent] ${diagnostic.type}：${diagnostic.message}（${diagnostic.path}）`);
        }
        for (const def of pluginCollection.defs) {
          try {
            const phase = materializeDeclarativeSubagents([def], service, toolDeps, { owner: 'core:subagent' });
            const disposeTools: Array<() => void> = [];
            try {
              for (const tool of phase.tools) {
                // 注册经宿主回调窗（core:mcp 后窗通道同律——resync 时点在装载
                // 窗收口后，直调必撞 PLUGIN_WINDOW_CLOSED；窗语义全保留：owner
                // 覆写/工具名账/撞名闸照走。host 缺席〔测试替身〕维持直调）
                const restore = host?.openHostCallback?.();
                try {
                  disposeTools.push(context.tools.register(tool));
                } finally {
                  restore?.();
                }
              }
            } catch (err) {
              // 整体拒 + 回滚（c2bb147 注销器律）：工具位部分注册回卷 + provider 位回卷
              for (const dispose of disposeTools.reverse()) dispose();
              phase.dispose();
              throw err;
            }
            pluginPhaseDisposers.push(...disposeTools, phase.dispose);
          } catch (err) {
            warn(`[subagent] 插件子代理「${def.name}」物化拒：${err instanceof Error ? err.message : String(err)}`);
          }
        }
      };
      deps.subagentLayerResyncSink?.(resyncPluginAgentLayers);

      return () => {
        for (const dispose of pluginPhaseDisposers.reverse()) dispose(); // 插件层两撤
        for (const dispose of disposeDeclarative.reverse()) dispose(); // 标准层工具位撤
        materialized.dispose(); // 标准层 provider 位撤（/reload 重放撞名修复——RP5 撤位律）
        disposeAgent();
      };
    },
  };
}

/**
 * 让位/清账三动词窄面（04 §12 定形注律 3 乙案执行面——settleGated/settleFire/
 * setActive；2026-09-13 复盘发现 ⑩ 收窄）：provide 域只裸这三法，jobs 表
 * 其余动词（insert/remove/setEnabled/advanceNextFire/读面族）经 service 正门
 * （幽灵名守卫/审计面在彼）不裸 DAO。
 */
export type SchedulerTickSettleFace = Pick<JobsDao, 'settleGated' | 'settleFire' | 'setActive'>;

/**
 * 'scheduler' 服务面（批 19c-2——goal 件迟到注入与宿主入口的消费位）。
 * goal 件吃 goalJobs 窄面（词面独立零 import——GoalJobsFace 契约真源在
 * scheduler 域，goal 侧自有词面 + 结构兼容互证归 19c-3）；宿主入口吃
 * engine（起钟/停钟编舞）；issue 件吃 service.addBuiltinJob/removeJob
 * （装配闭包适配 IssueSchedulerFace 归 19e）。
 */
export interface SchedulerFace {
  readonly service: SchedulerService;
  readonly goalJobs: GoalJobsFace;
  readonly engine: SchedulerEngine;
  /**
   * jobs 表让位/清账窄面（u-2 定形注③ + 04 §12 律 3 乙案执行面——发现 ⑩
   * 收窄为三动词 SchedulerTickSettleFace）：run-entry --tick 让位律的清账
   * 消费位（乙案子进程读行判 activePid：活体未超钟 → yielded 让位；死/超钟
   * → setActive 清账照跑）。引擎侧对偶判定在 engine.fireRow（同律单源
   * realIsPidAlive）。运行时真身仍是 JobsDao 实例（结构满足窄面）——收窄
   * 在类型面：provide 域插件消费只见三动词。
   */
  readonly dao: SchedulerTickSettleFace;
}

/**
 * core:scheduler（批 19c-2）——04 §12 调度条装载态兑现：jobs 表六动词服务面
 * （/tick 与 CLI 对等单源）+ GoalJobsFace 第五槽 + 进程内挂钟引擎 + /tick
 * 命令注册（输出经 deps.notify 归因 'tick'）。
 *
 * 引擎**构造不自启**：启钟/停钟编舞（含重启补推进拍点）归宿主入口——TUI/
 * serve 长驻形经 startSchedulerClock 起钟、诊断形/测试装载不起钟（未起跑的
 * 引擎全惰性：poke/排轮均守 running 位；manual fireNow 直通不依赖钟）。
 *
 * 批 20c 编舞接线三笔兑现（19c-2 挂账销账）：① GateFacts 宿主三源收集
 * （deps.schedulerGateFacts——装配根闭包单源）② 真 bin 出厂（deps.
 * schedulerBinCommand——runner spawn 与 cron 行命令段单源；缺席
 * 'berry' PATH 名解析，bin 缺席诚实归 spawn_failed）③ cron 乙案开启位
 * （deps.schedulerCronEnabled——true 时装配 OS cron 注册器 + 装载期既有启用
 * 行对账回填〔per-row try/catch——once 形/不可表达形不炸装载〕）。
 *
 * 主闸 = sqlite seam（同 memory 律）：缺席 = 件整体零装载（诚实缺席律）。
 */
function makeSchedulerPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'scheduler',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx) {
      const context = ctx as PluginContext;
      const db = deps.sqlite?.();
      if (db === undefined) return; // 主闸——库座缺席零装载（诚实缺席律）

      // 件内 warn 出口（F1 收编——第四役挂账① 扫尾）：同 core:memory 律——
      // leveled logger（BERRY_AGENT_LOG_LEVEL 辖内；缺省 info 下 warn 可见）
      // + 通道 notify 双发（transient 呈现；缺席纯 logger）。console.error
      // 裸文本直落 TUI 屏的写出路根除（cron 对账跳过/僵行清扫/补推进诊断族）。
      const warnLogger = createLogger('core:scheduler', LogLevelState.fromEnv(process.env.BERRY_AGENT_LOG_LEVEL));
      const warn = (message: string) => {
        warnLogger.warn(message);
        deps.notify?.('scheduler', message);
      };
      const now = () => new Date().toISOString();
      // 真 bin 单源（批 20c）：runner spawn 命令与 cron 行命令段共用——装配根
      // 解析 env BERRY_AGENT_BIN 注入；缺席 'berry' PATH 名解析
      const binCommand = deps.schedulerBinCommand ?? 'berry';
      // cron 乙案开启位（批 20c）：env BERRY_AGENT_CRON=1 显式置值即人面授权链
      // 的 env 形（写系统 crontab 的授权凭据）——authorize 恒 true 的凭据在
      // 装配根的 env 判定本身，此处不再二次盘问；缺席 = 纯进程内挂钟。
      // execCrontab 注入位 = 测试接缝（缺省 spawnSync 真身——测试注假件零真
      // 系统写）
      const cron =
        deps.schedulerCronEnabled === true
          ? createOsCronRegistrar({
              command: binCommand,
              authorize: () => true,
              ...(deps.schedulerCronExec !== undefined ? { execCrontab: deps.schedulerCronExec } : {}),
            })
          : undefined;
      const { service, dao, goalJobs } = createSchedulerService({
        db,
        now,
        warn,
        ...(cron !== undefined ? { cronRegistrar: cron } : {}),
      });
      const engine = createSchedulerEngine({
        dao,
        // 引擎 runner 两形（04 §12 无人值守执行链定形注①）：
        // - 宿主 stack 在场（生产恒真——assembly 单源注入）= 甲案进程内推进
        //   （scheduler-tick：fire 不 spawn——经 conversation-stack 起 headless
        //   run + builtin 行程序化分派零模型；kill = interrupt 协作中止）；
        // - stack 缺席 = 测试替身形降级 process runner（spawn 子进程形——
        //   乙案 OS cron 触发腿的执行入口，run --read-only --tick）
        ...(deps.conversationStack !== undefined
          ? {
              runner: createSchedulerTickRunner({
                stack: deps.conversationStack,
                // 分派处理器 fire 时动态解析（装载序无关——goal/issue 可后装）
                resolveGoal: () => context.tryGet<GoalFace>('goal')?.service,
                // u-3 唤醒起跑前池检腿（04 §5 定形注③第二形态——goal 件停靠投影）
                resolveGoalPark: () => context.tryGet<GoalFace>('goal')?.parkIfBudgetExhausted,
                resolveIssuePoll: () => context.tryGet<IssuePollFace>('issue'),
                now,
                warn,
              }),
            }
          : {
              runner: createProcessRunnerFactory({
                // 子进程 env 走 exec 白名单基座（deny-by-default 同律——
                // PATH/locale 最小集，零宿主环境继承）
                env: buildChildEnv(),
                command: binCommand,
              }),
            }),
        now,
        warn,
        ...(deps.schedulerGateFacts !== undefined ? { gateFacts: deps.schedulerGateFacts } : {}),
      });

      // cron 对账回填（批 20c）：装载期既有启用行逐行补注册 OS 面——addJob/
      // addBuiltinJob 的 insertRow 不挂 OS（开启 env 前已 enabled 的行不在
      // crontab），开面即对账；per-row try/catch warn——once 形/不可表达形/
      // win32 不炸装载（进程内挂钟仍辖该行）
      if (cron !== undefined) {
        for (const row of service.listJobs()) {
          if (!row.enabled) continue;
          try {
            cron.register(row);
          } catch (error) {
            warn(`scheduler cron 对账跳过「${row.name}」：${error instanceof Error ? error.message : String(error)}`);
          }
        }
      }

      // /tick 命令（argv → 人读文本——runTickCommand 错误已折文本不抛；
      // 输出面经 notify 归因 'tick'，缺席静默命令仍注册）
      const disposeTick = context.channels.registerCommand(
        'tick',
        async (args) => {
          const text = await runTickCommand(args.argv, { service, engine });
          deps.notify?.('tick', text);
        },
        TICK_USAGE,
      );

      context.provide('scheduler', { service, goalJobs, engine, dao } satisfies SchedulerFace);

      // 迟到序对称腿（04 §12 第五槽双序合法）：goal 件先装载（注册表序倒置
      // 或本件单件复活）时此处补接线；先行腿在 goal 件 apply 内 tryGet 本面。
      // 附着者回卷律——本腿 attach 则本腿 detach（goal 件先行腿自理对称）
      let attachedGoal: GoalHostServiceFace | undefined;
      const goalEarly = context.tryGet<GoalFace>('goal');
      if (goalEarly !== undefined) {
        await goalEarly.service.attachGoalJobsFace(goalJobs);
        attachedGoal = goalEarly.service;
      }

      return () => {
        attachedGoal?.detachGoalJobsFace();
        disposeTick();
      };
    },
  };
}

/**
 * 宿主入口钟表编舞面（批 20c——引擎构造不自启的消费位）：长驻形入口
 * （TUI/serve/daemon）装载后调本函数起钟，停钟挂运行时 closer（drain 序 =
 * 注册序）。**必须挂 closer**：engine 定时器走真身 setTimeout 非 unref——
 * 不停钟会把进程拖活到 60s belt 定时器（shutdown 返回后进程不退）。
 * 诊断形（dump-config/run/测试装载）不调即不起钟（全惰性）。
 *
 * 六役停机窗补钉（04 §1 退出序 step2 补钉）——abort 即停自持钟：除 closer
 * 兜位腿外，起钟时订阅运行时 abort 信号，置位即刻停摆（见函数体选形注）。
 * drain 窗内不得再起会话——closer 序先 dispose 会话管理器、后停钟的窗口内
 * tick 不得再 fire。
 *
 * @param scope 装配产物共享根（tryGet 'scheduler'——件缺席/禁用时 no-op：
 * 起钟属长驻编舞非正确性前提，诚实零动作）
 * @param runtime 运行时（registerCloser 挂停钟兜位腿 + abortSignal 即停订阅）
 * @returns 是否起钟（件在场且已 start——测试观察面；件缺席 false）
 */
export function startSchedulerClock(
  scope: { tryGet<T>(name: string): T | undefined },
  runtime: {
    registerCloser: (closer: { label: string; fn: () => void }) => void;
    /** 在飞 run 打断信号（04 §1 退出序①置位——订阅位即停自持钟） */
    abortSignal: AbortSignal;
  },
): boolean {
  const face = scope.tryGet<SchedulerFace>('scheduler');
  if (face === undefined) return false; // 件缺席/禁用——no-op（长驻编舞非正确性前提）
  face.engine.start(); // 重启补推进（missed 静默 advance）+ 排首轮轮询
  // —— 六役停机窗补钉（04 §1 退出序 step2 补钉）：abort 置位即停自持钟 ——
  // 选形说明：取「abort 信号订阅即停」形（startSchedulerClock 单点订阅覆盖
  // serve/TUI/daemon 三长驻入口），不取「每 tick 前查 abort」形（须把信号
  // 穿进 engine/doSweep 逐拍判——穿线面大且引擎域被迫知宿主信号越界）。
  // engine 自持轮询定时器无裸 interval 句柄——stop() 即其 clearInterval 位
  // （摘 pollHandle + running 落 false，幂等）。
  // 缺陷账：原「closer drain 才停钟」形下，退出序① abort 与② closer 队列
  // 之间（会话管理器 closer 先 dispose、scheduler-engine 后停）drain 窗内
  // tick 可继续 fire——在已 dispose 管理器上重造驱动。订阅后 abort 即刻
  // 停摆：drain 窗内不得再起会话（规范笔 04 §1 同批）。
  const stopClock = (): void => {
    face.engine.stop(); // 只摘轮询定时器（在飞自然收场——engine 头注；幂等重复停无害）
  };
  if (runtime.abortSignal.aborted) {
    // 起钟位晚于 abort 置位的边角形（生产不可达——三长驻入口起钟都在退出序
    // 启动前；防御位）：起后即停——start→stop 间为同步码零定时器窗，一 tick 不漏
    stopClock();
  } else {
    // abort 订阅（once——abort 一次性信号自摘听）；信号生命周期与 runtime
    // 同寿，closer 停钟后再触发/再调 stop 均幂等无害
    runtime.abortSignal.addEventListener('abort', stopClock, { once: true });
  }
  runtime.registerCloser({
    label: 'scheduler-engine',
    fn: stopClock, // 兜位腿：abort 订阅形外的收口保障（幂等再停——closer 序即 drain 序）
  });
  return true;
}

/**
 * 'goal' 服务面 service 腿宿主投影形（03 §10.5 s 批补注②——provide 投影律）：
 * 宿主消费面白名单六法。写动词（approve/activate/complete/abandon/park 族）
 * **不进投影**——人面命令（/goal）与模型工具（goal_update/todo）在 goal 件
 * 内闭包消费全量 GoalService（danger 件 dangerFace 从不 provide 先例同律）。
 */
export type GoalHostServiceFace = Pick<
  GoalService,
  'wake' | 'goalScopeFor' | 'depositFor' | 'recordTurn' | 'attachGoalJobsFace' | 'detachGoalJobsFace'
>;

/**
 * 'goal' 服务面（批 19c-3——conversation-stack 换装消费位 + 宿主入口面）。
 * todoFactory = per-session 扩展 todo 工具构造（03 §10.5 换装律——append/
 * getScope 会话闭包由调用方注入，件内补段约束执法三判据）；service =
 * 宿主消费面投影 GoalHostServiceFace（s 批补注②——运行时白名单投影非仅
 * 类型收窄：goalScopeFor 锚 = chat↔goal 数据通道零服务面例外位，组合根经
 * 本面取锚，driver fold 升格与收口域判共用；wake/recordTurn 宿主入口两法
 * 已接线〔批 #99 三入口统一——挂点上移驱动层 settled 链〕；挂钟双序迟到
 * 注入对称腿两法 scheduler 件消费）。
 */
export interface GoalFace {
  readonly service: GoalHostServiceFace;
  /**
   * 预算停靠投影（u-3——04 §5 定形注③：scheduler 池检腿消费〔scheduler-
   * tick GoalParkFace 结构兼容〕）。查池（stack.llm.canAfford('background')
   * ——件内闭包）+ 停靠编舞内聚单动词：日池尽 = 停靠-唤醒返回 true，可负担
   * = false 正常起跑。stack 缺席（测试替身形）恒 false——池检腿零降级。
   */
  readonly parkIfBudgetExhausted: (goalId: string) => Promise<boolean>;
  /** per-session 扩展 todo 工具构造（换装产物同名 'todo'——模型面无感） */
  readonly todoFactory: (deps: {
    readonly append: (data: { items: GoalTodoItem[] }) => void;
    readonly getScope: () => { goalId: string; activatedSeq: number } | null;
  }) => ToolDefinition;
}

/**
 * core:goal（批 19c-3）——03 §10.5 计划态机器装载态兑现：GoalService 全环
 * （goals 表族 v3 已由宿主聚合；件内闭包消费）+ goal_update 终态申报工具
 * （boot 全局层——执行时会话解析包装：toolCtx.sessionId 先落可变格再入
 * 件，多会话共享一 def）+ /goal 命令（输出经 notify 归因 'goal'）+ 挂钟
 * 迟到注入先行腿（tryGet scheduler 面——注册表序 scheduler 先装载即挂即
 * 用；倒置序对称腿在 scheduler 件内）+ 'goal' 服务面供给（todoFactory +
 * service 宿主投影〔s 批补注②——写动词不进投影〕）。
 *
 * gates 接线形（ex 批真接线后）：workspaceRoot 真值 + exec seam 经
 * tryGet('exec') 服务面翻真（03 §10.5 ex 定形注：恒 workspace-write/无升权/
 * 30s 帽；exec 缺席时 hasCommandExec 判据拒照旧——诚实缺席律双拦维持）。
 * lsp seam 接线真诊断面（批 19d 回补——queryDiagnostics 窄面，lsp 件缺席
 * 即缺席 fail-closed）；todo 换装 commandGateStatus 活查双位合取（f-1 已
 * 接线——申报位 seam→双位两档全拒文案分档）+ hasCommandExec/hasLsp 双在场判据。
 *
 * 驱动侧接线三件（批 #99 兑现——预算刹停腿由 inert 转执法）：本件装载
 * agent_pre_step 复验监听（waterfall 链——budgetExceeded 现判置 stop，驱动
 * 发射位在 driver.ts）；轮间沉淀 complete 单发（deps.goalSummarizer 注入
 * GoalService——缺席确定性回退）与 recordTurn 记账腿（驱动 onRunSettled 窗
 * 扫回执 → 组合根闭包 recordTurn——三入口统一经驱动层，本件不再自带挂点）。
 *
 * 主闸双位 = sqlite seam + goalSession face（同 memory 律）：任一缺席 = 件
 * 整体零装载（诚实缺席律）。
 */
function makeGoalPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'goal',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx) {
      const context = ctx as PluginContext;
      const db = deps.sqlite?.();
      const sessionFace = deps.goalSession;
      if (db === undefined || sessionFace === undefined) return; // 主闸双位

      // 件内 warn 出口（F1 收编——第四役挂账① 扫尾）：同 core:memory 律——
      // leveled logger（BERRY_AGENT_LOG_LEVEL 辖内；缺省 info 下 warn 可见）
      // + 通道 notify 双发（transient 呈现；缺席纯 logger）。console.error
      // 裸文本直落 TUI 屏的写出路根除（停靠/停滞/唤醒审计 warn 族——service
      // 注入位单源；下方广播唤醒编舞内两处直写同 sink 同律收编）。
      const warnLogger = createLogger('core:goal', LogLevelState.fromEnv(process.env.BERRY_AGENT_LOG_LEVEL));
      const warn = (message: string) => {
        warnLogger.warn(message);
        deps.notify?.('goal', message);
      };
      const now = () => new Date().toISOString();
      // lsp 诊断查询窄面（批 19d hasLsp 回补——注册表序 lsp 必居本件前，
      // tryGet 序内前件；lsp 件缺席/disabled = GateLspSeam 缺席 = diagnostics
      // gate 申报即拒 fail-closed〔03 §10.5〕，todoFactory hasLsp 同源）
      const lsp = context.tryGet<LspService>('lsp');
      // exec 判据门真接线（03 §10.5 ex 批——原「v1 诚实缺席」挂账收口）：
      // exec 件 tryGet 序内前件（装载序 exec 居 goal 前，lsp 同律）；在场即
      // createGateExec 翻真（单一声明位供 gates 评测面与 todo 申报位
      // 〔hasCommandExec〕同源——两处随本笔自动翻真）；exec 禁用/缺席 =
      // gateExec 维持 undefined，申报位拒照旧（诚实缺席律双拦不变）
      const execService = context.tryGet<ExecToolService>('exec');
      const gateExec: GateExecSeam | undefined =
        execService?.createGateExec !== undefined
          ? execService.createGateExec(() => canonicalWorkspaceRoot(deps.cwd))
          : undefined;
      // memory 周期 fire 窄面（五篇研究批 A——06 §4 第三腿：goal 终态即拍一轮
      // 周期 review；memory 件注册表序居本件前、周期腿缺席不 provide——
      // tryGet 诚实缺席 = onTerminal 不挂，goal 环独立完整）
      const memoryCycleFire = context.tryGet<(sessionId: string) => void>('memory-cycle-fire');
      const service = createGoalService({
        db,
        now,
        warn,
        session: sessionFace,
        // 判据门 v1 接线形：files 源真 stat；exec 诚实缺席 = 该源申报即拒 +
        // 评测恒 fail；lsp seam 接线真诊断面（queryDiagnostics——词面独立律
        // 适配在装配侧收口，goal 席 DAG 无 lsp 边）
        gates: {
          workspaceRoot: canonicalWorkspaceRoot(deps.cwd),
          ...(gateExec !== undefined ? { exec: gateExec } : {}),
          ...(lsp !== undefined ? { lsp: { queryDiagnostics: (files: string[]) => lsp.queryDiagnostics(files) } } : {}),
        },
        // 沉淀摘要窄面（批 #99——缺席 = depositFor 确定性回退，零 LLM 保底）
        ...(deps.goalSummarizer !== undefined ? { summarizer: deps.goalSummarizer } : {}),
        // 终态回调（五篇研究批 A——06 §4 第三腿装配面适配：goal→memory 无
        // DAG 边，窄 seam 经 tryGet 在此收口；fire-and-forget 契约由 goal 件
        // 侧防御吞 + memory fire 永不抛双保险）
        ...(memoryCycleFire !== undefined ? { onTerminal: (goal: GoalRow) => memoryCycleFire(goal.sessionId) } : {}),
      });
      // 全环捕获位单发（s 批——生产恒缺席；e2e rig lifecycle 通道，见
      // CorePluginHostDeps.goalServiceSink 注）
      deps.goalServiceSink?.(service);

      // goal_update：boot 全局层 + 执行时会话解析包装（deps.getSessionId 是
      // 工厂期闭包——包装在 execute 前以 toolCtx.sessionId 落格）
      let currentSessionId = '';
      const updateDef = createGoalUpdateTool({ service, getSessionId: () => currentSessionId });
      const goalUpdate: ToolDefinition = {
        ...updateDef,
        execute: (args, toolCtx) => {
          if (toolCtx.sessionId !== undefined) currentSessionId = toolCtx.sessionId;
          return updateDef.execute(args, toolCtx);
        },
      };
      const disposeUpdate = context.tools.register(goalUpdate);

      // /goal 命令（argv → 人读文本——守卫错已折文本不抛；eventsFor 与
      // service.session 同源读面；输出面经 notify 归因 'goal'）。sessionId
      // 透传（U10 定形注③——goal 锚 = 命令发起会话；缺席仅 create 受影响
      // 〔诚实拒〕，观察动词不辖）
      const disposeGoal = context.channels.registerCommand(
        'goal',
        async (args) => {
          const text = await runGoalCommand(
            args.argv,
            { service, eventsFor: (sid) => sessionFace.events(sid) },
            args.sessionId,
          );
          deps.notify?.('goal', text);
        },
        GOAL_USAGE,
      );

      // 挂钟迟到注入先行腿（scheduler 先装载 = 即挂即用；disposer 对称回卷）
      const sched = context.tryGet<SchedulerFace>('scheduler');
      if (sched !== undefined) await service.attachGoalJobsFace(sched.goalJobs);

      // agent_pre_step 预算复验腿（批 #99——04 §5 双轨第二腿）：驱动每模型
      // 请求前发射 waterfall（driver.ts onPreModelRequest），本监听现判
      // budgetExceeded——已超帽即置 stop 刹停本 turn（零 dangling turn；run
      // 收场 stopReason 'stop' → completed）。与起跑位预验同判据双保险
      const offPreStep = context.on('agent_pre_step', (value, next) => {
        const input = value as PreStepInput;
        const goalScope = service.goalScopeFor(input.sessionId);
        if (goalScope !== undefined && service.budgetExceeded(goalScope.goalId)) {
          input.stop = { reason: 'goal 前台预算帽已到（budgetExceeded 复验刹停）' };
        }
        return next(input) as Promise<PreStepInput>;
      });

      // —— u-3 停靠化编舞（04 §5 定形注③「goal 停靠化律」码面兑现）——
      // 预算语境两形态（记账刹停〔含 budgetExceeded 复验〕、唤醒起跑前池检
      // 拒）改停靠-唤醒：service.parkForBudget（disable 挂钟行 + 会话落
      // session/paused + 幂等登记）+ 广播件登记（恢复时 enable 复活 + submit
      // 唤醒——§12 唤醒判定链同链）。防环不靠边沿靠 driver 三帽：唤醒轮若
      // 复超帽，收口现判再停靠复登记，canAfford 仍真再唤醒，第 4 次
      // backgroundWake 拒收 wake-refused → 摘登记 warn 人工（挂钟行保持
      // disabled）。非预算语境维持既有：停滞硬停（人工 /goal wake）与
      // wake_budget 拒收（warn 不硬停）两形态皆非停靠。
      const broadcast = deps.budgetBroadcast;
      const stack = deps.conversationStack;
      /** 唤醒消息文本（durable user/message 载体——issue 面 WAKE_MESSAGE 同律） */
      const GOAL_WAKE_MESSAGE =
        '后台预算日池已恢复（budget_extended）——goal 挂钟唤醒，请继续推进当前目标，完成后按 goal_update 纪律收口。';
      /** goal 停靠项登记表（goalId → 广播 entry——复停靠同键换新防泄漏） */
      const wakeEntries = new Map<string, BudgetBroadcastEntry>();

      /** 广播唤醒编舞：摘双侧登记 → submit（backgroundWake 吃三帽防环）→ 收口分诊 */
      const wakeGoalFromPark = (goalId: string, sessionId: string): void => {
        const entry = wakeEntries.get(goalId);
        if (entry !== undefined) {
          broadcast?.unregister(entry);
          wakeEntries.delete(goalId);
        }
        service.unparkForBudget(goalId); // service 侧登记同笔摘（再停靠时复登记）
        if (stack === undefined) return; // 测试替身形无提交面——durable 停靠在，人工道 /goal wake
        // 车道随起跑方声明位单源（04 §5 机器注入轮枚举扩——第四役）：goal 挂钟
        // 唤醒轮（budget-extended 广播）是机器注入轮，submit 恒置 backgroundLane
        // ——桥接 llm/usage 记账进后台日池（修前恒 foreground，日池对 goal 唤醒
        // 轮 token 失明）；预警判族与记账车道自此同向
        const run = stack.submitText(sessionId, GOAL_WAKE_MESSAGE, {
          source: 'budget-extended',
          backgroundWake: true,
          backgroundLane: true,
        });
        if (run === undefined) {
          // F1 收编：直写改走件内 warn 出口（logger + notify 双发——停靠保持
          // 人工道语义不变，只换呈现路）
          warn(`[goal] 广播唤醒提交失败：会话 ${sessionId} 无驱动在册——停靠保持，人工道 /goal wake`);
          return;
        }
        void run
          .then(async (receipt) => {
            // 再停靠检查先行：onRunSettled 收口现判（同步先于本 receipt）若已
            // 复停靠（又超帽），挂钟行保持 disabled 不复活——复登记已由收口位完成
            if (service.isParkedForBudget(goalId)) return;
            // wake-refused 收口（三帽兜底——鲸鱼任务诚实边界）：自动唤醒路尽，
            // 挂钟行保持 disabled + 摘登记 + warn 人工路径（issue 面同律）
            if (receipt.status === 'wake-refused') {
              service.unparkForBudget(goalId);
              // F1 收编：直写改走件内 warn 出口（logger + notify 双发——自动唤醒
              // 路尽语义不变，只换呈现路）
              warn(
                `[goal] 连续后台唤醒超帽（04 §4 maxConsecutiveWakes=3）：goal「${goalId}」停自动唤醒——挂钟保持停摆，/goal wake 手动复位或提帽`,
              );
              return;
            }
            // 正常收口：复活挂钟行（下轮 due 经 §12 唤醒判定链自然重入）
            await service.reviveClock(goalId);
          })
          .catch((err: unknown) => {
            // 唤醒链拒绝面（第六役转交 cross-cutting#2）：栈内 catch 只兜原
            // run promise，.then 派生 promise 无人接 → unhandledRejection →
            // 崩溃编舞 exit(1) 杀整个 daemon（在飞会话连坐——坏词形每次预算
            // 唤醒都崩）。warn 走件内 warn 出口（logger + notify 双发——停靠
            // 已摘，人工道 /goal wake 同唤醒失败形）
            warn(`[goal] 广播唤醒轮失败：${err instanceof Error ? err.message : String(err)}`);
          });
      };

      /** 预算停靠编舞包装：service 三动作 + 广播登记（复停靠同键换新） */
      const parkGoalForBudget = async (goalId: string): Promise<boolean> => {
        const landed = await service.parkForBudget(goalId);
        if (!landed) return false; // 终态/幂等复入——无新登记面
        if (broadcast !== undefined) {
          const prior = wakeEntries.get(goalId);
          if (prior !== undefined) broadcast.unregister(prior); // 旧 entry 防泄漏（复停靠换新）
          const row = service.get(goalId);
          if (row !== undefined && row.status === 'active') {
            const entry: BudgetBroadcastEntry = {
              wake: () => wakeGoalFromPark(goalId, row.sessionId),
            };
            wakeEntries.set(goalId, entry);
            broadcast.register(entry);
          }
        }
        return true;
      };

      /** 池检投影（GoalFace.parkIfBudgetExhausted 真身——scheduler tick 池检腿消费）：
       *  查池（04 §5 background 档）+ 停靠内聚单动词；stack 缺席恒 false（测试替身形零降级） */
      const parkIfBudgetExhausted = async (goalId: string): Promise<boolean> => {
        if (stack === undefined) return false;
        if (stack.llm.canAfford('background')) return false; // 可负担——正常起跑
        return parkGoalForBudget(goalId); // 日池尽——改停靠-唤醒（gated 零跑由 tick 侧收场）
      };

      // run 收口现判停靠位（04 §5 定形注②「触发形态非穷尽」判据式）：记账
      // 刹停（run 完成记账超帽）与复验刹停（agent_pre_step stop → completed）
      // 两形态同收口位一网打尽——goal 域会话 run 终态即现判 budgetExceeded
      const agent = context.tryGet<AgentService>('agent');
      const offSettlePark = agent?.onRunSettled((event) => {
        const scope = service.goalScopeFor(event.sessionId);
        if (scope === undefined) return; // 非 goal 域会话不辖
        if (!service.budgetExceeded(scope.goalId)) return; // 未超帽——正常收口
        void parkGoalForBudget(scope.goalId);
      });

      // provide 投影律（03 §10.5 s 批补注②——danger 先例同律）：service 腿按
      // 宿主消费面白名单运行时投影（六法——非仅类型收窄）；写动词
      // （approve/activate/complete/abandon/park 族）不进投影——人面 /goal 与
      // 模型工具 goal_update/todo 在本件闭包消费全量 service，插件道 tryGet
      // 只见投影（写动词的插件可连性就此闭合——ΔA⇏ΔC 判据面执法）
      const hostServiceFace: GoalHostServiceFace = {
        wake: (goalId, opts) => service.wake(goalId, opts),
        goalScopeFor: (sessionId) => service.goalScopeFor(sessionId),
        depositFor: (sessionId) => service.depositFor(sessionId),
        recordTurn: (goalId, opts) => service.recordTurn(goalId, opts),
        attachGoalJobsFace: (face) => service.attachGoalJobsFace(face),
        detachGoalJobsFace: () => service.detachGoalJobsFace(),
      };
      context.provide('goal', {
        service: hostServiceFace,
        parkIfBudgetExhausted,
        todoFactory: (todoDeps) =>
          createGoalTodoTool({
            ...todoDeps,
            // f-1 批接线活查——执行期按当前 goal 行求值双位合取（申报位 seam→
            // 双位两档全拒 + 文案分档指路；旧「恒 false 接线形」挂账就此销账）
            commandGateStatus: (goalId) => service.commandGateStatus(goalId),
            // s 批补注①——exec seam 在场判据（诚实缺席律，hasLsp 同律镜像）：
            // 与 gates.exec 同源单声明位（gateExec），真接线两处同笔翻真
            hasCommandExec: gateExec !== undefined,
            hasLsp: lsp !== undefined, // 批 19d 回补——真诊断面在场否（申报面 fail-closed 判据）
          }),
      } satisfies GoalFace);

      return () => {
        offSettlePark?.();
        offPreStep();
        // 停靠项广播登记逐摘（件卸载——广播件宿主生命周期不随件回卷，登记面须自清）
        if (broadcast !== undefined) for (const entry of wakeEntries.values()) broadcast.unregister(entry);
        wakeEntries.clear();
        if (sched !== undefined) service.detachGoalJobsFace();
        disposeGoal();
        disposeUpdate();
      };
    },
  };
}

/**
 * core:checkpoint——工作区快照/回退件（批 19c-4 装载态入册，05 §5.3）：
 * 守门监听（插件钩子正门 ctx.on('tools_pre_execute') waterfall——03 §2.4
 * 不私开管道接缝）+ /rewind 命令（两段事务用户呈现面——argv → 人读文本，
 * /goal 同族；发起会话 = 焦点会话）。
 *
 * 装配序注记（装载态实况 vs 15d 落码时假设）：safety 守门行自 19a 起 per-
 * session 于 open-tools 装配位注册（会话 open 晚于 boot），本行装载期注册
 * 必居其前——waterfall 注册序即执行序。序差无害：safety 拦截/让棒后的
 * 已拍快照 = 状态未变仍有效（gate.ts 头注容忍条款对本形适用；被拦 run 的
 * 白拍由 per-workspace 保留帽 10 收敛）。钩子消费点 5s 钟与本件 10 万文件
 * walk 帽是两道各自真实的预算线——谁先触谁执法（超时按管线失败 fail-closed
 * 传播，03 §3.4）。
 *
 * 主闸三位 = dataDir + checkpointSession + checkpointFork（任一缺席 = 件
 * 整体零装载诚实缺席律——纯 :memory: 诊断形/测试替身形快照特性整体缺席，
 * 对话本体仍通）。gate 单实例跨会话共享游标（per-session Map——「同一
 * dispatch 生命周期内复用一个实例」）。
 *
 * adopt 切前台编舞 v1 未落（restore 回执的新会话 id 先经命令输出面呈报
 * ——焦点切换是 channels/host 的事随 TUI adopt 命令立题，本件零越界；
 * 05 §5.3 命令面条款。原注指向已飞的 run 入口批，2026-09-11 勘正）。
 */
function makeCheckpointPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'checkpoint',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx) {
      const context = ctx as PluginContext;
      const dataDir = deps.dataDir;
      const sessionFace = deps.checkpointSession;
      const forkFace = deps.checkpointFork;
      if (dataDir === null || sessionFace === undefined || forkFace === undefined) return; // 主闸三位

      // 件内 warn 出口（F1 收编——第四役挂账① 扫尾）：同 core:memory 律——
      // leveled logger（BERRY_AGENT_LOG_LEVEL 辖内；缺省 info 下 warn 可见）
      // + 通道 notify 双发（transient 呈现；缺席纯 logger）。console.error
      // 裸文本直落 TUI 屏的写出路根除（gate 无工作区锚/边界诊断族）。
      const warnLogger = createLogger('core:checkpoint', LogLevelState.fromEnv(process.env.BERRY_AGENT_LOG_LEVEL));
      const warn = (message: string) => {
        warnLogger.warn(message);
        deps.notify?.('checkpoint', message);
      };
      const store = openCheckpointStore(dataDir);
      const capture = createCapture(store);
      // 装载态可见性面（批 19e——issue 件 capabilities 预检 'checkpoint'
      // 探测位：在场判据纯 provide，无消费面扩展——store 即本件真身服务的
      // 最小可见面）
      context.provide('checkpoint', { store });

      // 守门监听（effect:'write' + 会话边界推进判据——per-run 一 manifest；
      // 类型适配在边界收口：PluginHookHandler unknown 面与 GateInput 收窄一处）
      const gate = createCheckpointGate({ capture, session: sessionFace, warn });
      const offGate = context.on('tools_pre_execute', (value, next) =>
        gate(value as GateInput, (v) => next(v) as Promise<GateInput>),
      );

      // /rewind 命令（守卫错已折文本不抛；发起会话 = 焦点会话〔channels.
      // focusedId〕缺席诚实拒；保底快照归属发起会话〔invokingSessionId——
      // 15d deps 既有位装配侧接线〕；输出面经 notify 归因 'checkpoint'）
      const disposeRewind = context.channels.registerCommand(
        'rewind',
        async (args) => {
          const sessionId = deps.focusSessionId?.();
          if (sessionId === undefined || sessionId === '') {
            deps.notify?.('checkpoint', `当前无焦点会话——/rewind 需在会话上下文执行。\n${REWIND_USAGE}`);
            return;
          }
          const text = await runRewindCommand(args.argv, {
            store,
            session: sessionFace,
            fork: forkFace,
            sessionId,
            invokingSessionId: sessionId,
          });
          deps.notify?.('checkpoint', text);
        },
        REWIND_USAGE,
      );

      return () => {
        disposeRewind();
        offGate();
      };
    },
  };
}

/**
 * core:sdk（批 19e——03 §10.6 件身份 = 对外被调用面插件承载位）：HTTP
 * 传输适配 + MCP server 包装的件承载真身供给。协议核与 channels 通道核
 * 同体（件承载的是传输/包装层）；stdio JSONL 归宿主 serve 子命令不依赖
 * 件装载态（F16——零行为耦合）。
 *
 * 主闸 = sdkFaceFactory seam（装配根注入 createSdkHttpFace——缺席 = 件
 * 零装载：测试替身形/诊断形）。件只 provide 'sdk-http-face' kit（面工厂
 * 单源供给位）；开面/监听/披露编舞归宿主入口（07 §5：daemon 形态必开
 * HTTP 面，件被禁用时 daemon 拒启退 2 由入口执法——「装载在场 ≠ 开面
 * 监听」消歧律同 webui）。
 */
function makeSdkPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'sdk',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx) {
      const context = ctx as PluginContext;
      const createFace = deps.sdkFaceFactory;
      if (createFace === undefined) return; // 主闸——面工厂 seam 缺席零装载
      // U5-2：受理器随 kit 透传（三入口开面消费位——snapshot/attachFace；
      // fork 绑定真源在 bootPlugins，两腿同真身）。缺席形 = 测试替身（kit
      // 不含该位——开面方 optional 链消费）
      context.provide('sdk-http-face', {
        createFace,
        ...(deps.sdkPluginRoutes !== undefined ? { pluginRoutes: deps.sdkPluginRoutes } : {}),
      });
    },
  };
}

/**
 * core:webui（批 19e——03 §10.4 + 07 §4.2 两件禁用语义族兑现）：Web 通
 * 道路由族的挂载 kit 供给。件零自持 node:http 监听（全库唯一监听族住
 * core:sdk 面）——「装载在场 ⇒ 面开时路由已注册（惰性零监听）；件禁用
 * ⇒ /api/* 404 而面仍在（/v1/* 在场）；面未开 ⇒ 全然无监听」。
 *
 * 主闸 = webuiFaceMount seam（装配根闭包 = mountWebuiOnFace 同签名）。
 * kit 晚绑：面开面晚于装载（入口在 assembleHostStack 之后开面），件
 * apply 期只 provide kit 不触面——webui claim 桥晚绑同款先例。
 */
function makeWebuiPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'webui',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx) {
      const context = ctx as PluginContext;
      const mountOnFace = deps.webuiFaceMount;
      if (mountOnFace === undefined) return; // 主闸——挂载闭包 seam 缺席零装载
      context.provide('webui-face-mount', { mountOnFace });
    },
  };
}

/**
 * alerts 单条归一（批 19e——03 §10.8 坏规则降级律：告警只通知不执法，
 * 坏条 warn 跳过不整件失败——与 mcp/browser 的 config 坏形响亮拒行级
 * 失败分立两律，彼系能力/安全承载面）。
 */
function normalizeObsAlerts(raw: unknown, warn: (message: string) => void): ObsAlertRule[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    warn('[obs] config.alerts 须为数组——告警面按空装载（坏形降级律，摄取/查询面不受累）');
    return [];
  }
  const rules: ObsAlertRule[] = [];
  raw.forEach((item, index) => {
    const candidate = item as { kind?: unknown; thresholdTokens?: unknown; cooldownMs?: unknown };
    const kindOk = candidate?.kind === 'token_spend_hourly';
    const threshold = candidate?.thresholdTokens;
    const thresholdOk = typeof threshold === 'number' && Number.isFinite(threshold) && threshold > 0;
    const cooldown = candidate?.cooldownMs;
    const cooldownOk =
      cooldown === undefined || (typeof cooldown === 'number' && Number.isFinite(cooldown) && cooldown >= 0);
    if (kindOk && thresholdOk && cooldownOk) {
      rules.push({
        kind: 'token_spend_hourly',
        thresholdTokens: threshold,
        ...(cooldown !== undefined ? { cooldownMs: cooldown } : {}),
      });
    } else {
      warn(`[obs] config.alerts[${index}] 坏形跳过（kind/thresholdTokens/cooldownMs 形不符——03 §10.8 坏规则降级律）`);
    }
  });
  return rules;
}

/**
 * core:obs（批 19e——03 §10.8 观测面装载态）：rollup 自管库 + obs_query
 * 只读工具 + 告警（只通知不执法）。主闸 = dataDir + obsEvents seam 双位
 * （库座/事件源缺席零装载——诚实缺席律）。
 *
 * 自管库路径 `<dataDir>/data/obs/rollup.db`（父目录代建/WAL/0600 归
 * rollup 开库链——OBS_DB_OPEN_FAILED 构造即抛由装载面行级降级跳件，其
 * 余 core 件不受累）。装载即首拍 refresh（连接即当下——水位−1h 重叠窗
 * 幂等，不等挂钟首拍）；notify/audience seam 缺席 = 告警腿静默降级非主
 * 闸（摄取/查询面仍通）。
 */
function makeObsPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'obs',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx, config) {
      const context = ctx as PluginContext;
      const dataDir = deps.dataDir;
      const events = deps.obsEvents;
      if (dataDir === null || events === undefined) return; // 主闸双位

      // 件内 warn 出口（F1 收编——第四役挂账① 扫尾）：同 core:memory 律——
      // leveled logger（BERRY_AGENT_LOG_LEVEL 辖内；缺省 info 下 warn 可见）
      // + 通道 notify 双发（transient 呈现；缺席纯 logger）。console.error
      // 裸文本直落 TUI 屏的写出路根除（坏条告警降级/自驱 refresh 失败诊断族）。
      const warnLogger = createLogger('core:obs', LogLevelState.fromEnv(process.env.BERRY_AGENT_LOG_LEVEL));
      const warn = (message: string) => {
        warnLogger.warn(message);
        deps.notify?.('obs', message);
      };
      const alerts = normalizeObsAlerts((config as { alerts?: unknown } | undefined)?.alerts, warn);
      const service = createObsService({
        dbPath: join(dataDir, 'data', 'obs', 'rollup.db'),
        events,
        notify: deps.obsNotify ?? { notify: () => undefined },
        audience: deps.obsAudience ?? { hasAudience: () => false },
        ...(alerts.length > 0 ? { alerts } : {}),
        warn,
      });
      service.refresh(); // 首拍即摄取
      const disposeTool = context.tools.register(createObsQueryTool(service));
      context.provide('obs', service);
      return () => {
        disposeTool();
        service.dispose();
      };
    },
  };
}

/* ---------------- 危险闸装配位三件（04 §13——/danger 呈现与 push 执行腿） ---------------- */

/** /danger 用法文案（命令注册面 description——两动词一闸面） */
const DANGER_CMD_USAGE =
  '用法：/danger approve [ttlDays]（缺省 30 天）签发危险闸 consent；/danger status 查看闸状态五呈';

/**
 * 交付验证执行腿（⑪ 裁决 5——IssueVerifyFace 真身，host spawn 家族：danger
 * push 腿同族，宿主编排动作不经模型工具管道〔verifyCommand 是用户 mount
 * config 整串命令非 argv 数组——shell 语义经 /bin/sh -c；无守门需求〕）。
 * 超时进程组 SIGKILL 击杀（detached 起 sh 自成组组长 + 负 pid 一发全组 +
 * 击杀即直收口——孙进程持管道写端不悬 close）；stdout+stderr 合并尾滚动收集
 * （内存帽保尾弃头——失败证据在尾）；**env 窄白名单**（03 §10.7 第四役补笔
 * 附段 a——与 c-4 凭证注入腿 buildChildEnv 机制族同源但方向相反：只给安全
 * 最小集、缺省零继承宿主 env——宿主凭证回落链值〔BERRY_AGENT_GITHUB_TOKEN
 * 等〕不泄进验证子进程，其输出尾直嵌公开回执的凭证外泄通道就此封死）；
 * spawn 失败折 exitCode null 不上抛——非 0 判据面在编排层收口（fail-closed：
 * 一切 seam 缺席 = fail）。
 */
function runIssueVerify(req: { cwd: string; command: string; timeoutMs: number }): Promise<IssueVerifyResult> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    // detached：sh 自成新进程组组长（pgid = child.pid）——超时负 pid 击杀全组
    // 的前提；孙进程（npm→vitest worker、`sleep 8 &` 后代等）继承组籍与 stdio
    // 管道写端，组灭则写端齐关、close 即放
    const child = spawn('/bin/sh', ['-c', req.command], {
      cwd: req.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      // env 窄白名单（03 §10.7 第四役附段 a）：buildChildEnv 缺省策略 = 零继承
      // 基底 + DEFAULT_ENV_ALLOW 白名单拷贝（PATH/HOME/TZ 类基座——npm test
      // 量级命令可跑；缺省不含任何 BERRY_AGENT_* 凭证位）。成员单源在 exec
      // 件（04 §11 deny-by-default 同族），此处不复造清单
      env: buildChildEnv(),
    });
    // 滚动收集窗（尾帽 4 倍——弃头保尾 + 截尾余量；巨型输出不积内存）
    const keepBytes = ISSUE_VERIFY_TAIL_BYTES * 4;
    let chunks: Buffer[] = [];
    let collected = 0;
    const collect = (stream: NodeJS.ReadableStream): void => {
      stream.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        collected += chunk.length;
        if (collected > keepBytes) {
          const merged = Buffer.concat(chunks);
          const kept = merged.subarray(merged.length - keepBytes);
          chunks = [kept];
          collected = kept.length;
        }
      });
    };
    collect(child.stdout!);
    collect(child.stderr!);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      // 路 A——进程组整体击杀：负 pid 形 -child.pid 一发杀全组（sh 与全体孙
      // 进程同组全灭）。单杀 sh 只断树根：孙进程继承的 stdout/stderr 管道写
      // 端不关 → 'close' 悬到最长孙进程自然退出才放——挂死型命令 = verify
      // promise 永不收口，Job 悬挂永占并行帽一席。
      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          // 组已空（全树先于此已退出/被收尸）→ ESRCH 容错；单 pid 补枪（kill 对死体恒安全不掷错）
          child.kill('SIGKILL');
        }
      } else {
        // spawn 失败形（pid undefined——error 腿已收口，此处兜底不掷错）
        child.kill('SIGKILL');
      }
      // 路 B——击杀即直收口：不候 'close'（逃组孙进程〔自 setsid 的守护形〕
      // 仍持管道写端时 close 可能悬到自然退出）。resolve 幂等先到先得：超时
      // 形由 timer 腿直落 finish，close 晚到自然落空、finish 幂等不变。
      finish(null, `超时击杀：时帽 ${req.timeoutMs}ms 到，进程组整体 SIGKILL（输出尾截于击杀时刻）`);
    }, req.timeoutMs);
    const finish = (exitCode: number | null, extraTail: string): void => {
      clearTimeout(timer);
      const merged = Buffer.concat(chunks);
      // 保尾截断（字节级——多字节字符边界前移，工具输出护栏 tailBytes 同律）
      let start = Math.max(0, merged.length - ISSUE_VERIFY_TAIL_BYTES);
      while (start > 0 && start < merged.length && (merged[start]! & 0xc0) === 0x80) start++;
      const tail = merged.subarray(start).toString('utf8');
      resolve({
        exitCode,
        timedOut,
        outputTail: extraTail !== '' ? `${extraTail}\n${tail}` : tail,
        durationMs: Date.now() - startedAt,
      });
    };
    // error（spawn 失败）后 close 可能再触发——resolve 幂等，先到先得
    child.on('close', (code) => finish(code, ''));
    child.on('error', (err) => finish(null, `执行体异常：${err.message}`));
  });
}

/**
 * push 执行腿（04 §13 create/push 执行面——宿主 spawn 真身）。token 经
 * `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` env 注入
 * `http.https://github.com/.extraheader`（`AUTHORIZATION: basic base64(
 * x-access-token:token)`）——明文只进子进程环境，argv/日志恒不见值（凭据
 * 纪律：值永不呈现）。URL 锚钉 https://github.com/——不污染其他远域。
 */
function dangerPushBranch(req: { token: string; worktreePath: string; branch: string }): Promise<void> {
  const header = `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${req.token}`).toString('base64')}`;
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['push', 'origin', req.branch],
      {
        cwd: req.worktreePath,
        env: {
          ...process.env,
          GIT_CONFIG_COUNT: '1',
          GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
          GIT_CONFIG_VALUE_0: header,
        },
      },
      (err, _stdout, stderr) => {
        if (err !== null) {
          const tail = stderr.length > 500 ? `…${stderr.slice(-500)}` : stderr;
          reject(new Error(`git push 失败（分支 ${req.branch}）：${tail}`));
          return;
        }
        resolve();
      },
    );
  });
}

/** /danger status 五呈中文文案（cap.used null = 链坏不可派生——如实呈现） */
function renderDangerStatus(s: IssueDangerStatusFace): string {
  const consentText =
    s.consent.state === 'valid'
      ? `有效（到期 ${new Date(s.consent.expiresAt ?? 0).toISOString()}）`
      : s.consent.state === 'absent'
        ? '缺席（须 /danger approve 签发）'
        : s.consent.state === 'expired'
          ? '已过期（重跑 /danger approve 重签）'
          : '配置漂移（mandate 变过——重跑 /danger approve 重签）';
  const haltText = s.halt.tripped
    ? `在场（kill switch 拉闸——首触发 ${s.halt.firstFiredAt ?? '未知时间'}，删 HALT 文件恢复）`
    : '不在场';
  const capText =
    s.cap.used === null
      ? '不可派生（账本链坏）'
      : `当日 ${s.cap.used}/${s.cap.max}（UTC ${s.cap.day}——allow-succeeded 计数）`;
  return [
    `危险闸状态（consumer ${s.consumer}）：`,
    `- mandate 哈希：${s.mandateHash}`,
    `- 值域：actions [${s.mandate.actions.join(', ')}] × targets [${s.mandate.targets.join(', ')}] × 日帽 ${s.mandate.maxPerDay}`,
    `- consent：${consentText}`,
    `- HALT：${haltText}`,
    `- 日帽：${capText}`,
    `- 账本：${s.ledger.total} 笔（链${s.ledger.healthy ? '健康' : '损坏——DANGER_LEDGER_CORRUPT 拒续写'}）`,
  ].join('\n');
}

/**
 * core:issue（批 19e——03 §10.7 无人值守编排件装载态）：件是既有件的
 * 组合消费方——scheduler 挂钟（tryGet 'scheduler'）+ Job 注册表（tryGet
 * 'jobs'——assembly provideJobsService 共享根，JobRegistry 真身结构可赋
 * IssueJobsFace）+ goal/exec/checkpoint capabilities（apply 期 tryGet 探
 * 测注入——预检语义在入队不在装载）+ store_state 水位（deps 直传真身）
 * + worktree 工具族（件内真身构造——canonical 工作区根锚）+ env 凭证双
 * 词面（token/webhook secret——凭证盒未立前 env 载体先行）。
 *
 * 主闸链（任一缺席 = 件零装载——诚实缺席律）：config 在场（缺省无编排
 * 面）→ GitHub token → session seam（成熟度缺口 #5——headless 会话真工厂
 * createIssueSessionFactory 装配根已接线）→ scheduler/jobs 前件 → state/
 * budget seam。config 在场但坏形 = 响亮拒 ISSUE_CONFIG_INVALID 行级装载失败
 * （/reload 时刻可修——mcp/browser 同律）。
 */
function makeIssuePlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'issue',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx, config) {
      const context = ctx as PluginContext;
      if (config === undefined || config === null) return; // 主闸一——缺省无编排面零装载
      const token = deps.issueGithubToken;
      if (token === undefined || token === '') return; // 主闸二——数据源凭证缺席零装载
      const session = deps.issueSession;
      if (session === undefined) return; // 主闸三——起会面未接线零装载（装配根常在——缺席即诊断形）
      const sched = context.tryGet<SchedulerFace>('scheduler');
      const jobs = context.tryGet<IssueJobsFace>(JOBS_SERVICE_NAME);
      const state = deps.issueState;
      const budget = deps.issueBudget;
      if (sched === undefined || jobs === undefined || state === undefined || budget === undefined) {
        return; // 主闸四——前件/装配 seam 缺席零装载
      }

      const normalized = normalizeIssueConfig(config);
      if (!normalized.ok) {
        // 显式配置坏形响亮拒（行级装载失败——与主闸缺席的静默零装载分立两档）
        throw new BaseError('ISSUE_CONFIG_INVALID', `[ISSUE_CONFIG_INVALID] ${normalized.message}`);
      }

      // 件内 warn 出口（F1 收编——第四役挂账① 扫尾）：同 core:memory 律——
      // leveled logger（BERRY_AGENT_LOG_LEVEL 辖内；缺省 info 下 warn 可见）
      // + 通道 notify 双发（transient 呈现；缺席纯 logger）。console.error
      // 裸文本直落 TUI 屏的写出路根除（轮询登记/受理/回执投递失败诊断族）。
      const warnLogger = createLogger('core:issue', LogLevelState.fromEnv(process.env.BERRY_AGENT_LOG_LEVEL));
      const warn = (message: string) => {
        warnLogger.warn(message);
        deps.notify?.('issue', message);
      };
      // scheduler 适配（IssueSchedulerFace ← SchedulerService：builtin 行登记
      // + enabled 显式——轮询是件的主通道非用户手动任务，pi-tick
      // default-disabled 缺省不适用本行）
      const schedulerFace: IssueSchedulerFace = {
        registerPollJob: (req) => sched.service.addBuiltinJob({ ...req, builtin: true, enabled: true }),
        removePollJob: (name) => void sched.service.removeJob(name),
      };
      // capabilities 探测（goal/exec/checkpoint 三名——注册表序保前件先装；
      // 探测缺席不阻装载：入队期预检拒 fail-ask 回执缺口〔03 §10.7 批 16 定形〕）
      const capabilities = [
        context.tryGet('goal') !== undefined ? 'goal' : undefined,
        context.tryGet('exec') !== undefined ? 'exec' : undefined,
        context.tryGet('checkpoint') !== undefined ? 'checkpoint' : undefined,
      ].filter((name): name is string => name !== undefined);
      const webhookSecret = deps.issueWebhookSecret ?? '';
      // 后端单真身（服务取数面与危险闸 create-pr 执行腿共用——同 token 同折叠律）
      const backend = createGithubBackend({ token });
      // 危险闸（04 §13——auto 档交付腿的预授权执法）：dataDir 在场即组机制件
      // （memory 诊断形 null 零闸——service auto 档维持「闸缺席转人审」原语
      // 义，fail-closed）。mandate 原料全部来自 normalize 后的用户配置层
      // （repos 原样 + maxDeliveriesPerDay）——装配期冻结只读注入，闸侧取
      // 规范化哈希作 consent 绑定面。
      const dangerDataDir = deps.dataDir;
      let danger: IssueDangerFace | undefined;
      let disposeDangerCmd: (() => void) | undefined;
      if (dangerDataDir !== null) {
        // mandate 经 normalizeDangerMandate 归一装配（DangerMandate「normalize 产物」
        // 契约兑现——原料虽经 normalizeIssueConfig 预归一，装配位仍走归一器兜底：
        // 第三方消费件接入时此位即唯一入口；坏形折 ISSUE_CONFIG_INVALID 行级失败）
        const mandate = normalizeDangerMandate({
          actions: DANGER_V1_ACTIONS,
          targets: normalized.config.repos,
          maxPerDay: normalized.config.maxDeliveriesPerDay,
        });
        if (!mandate.ok) {
          throw new BaseError('ISSUE_CONFIG_INVALID', `[ISSUE_CONFIG_INVALID] ${mandate.message}`);
        }
        const gate = createDangerGate({
          consumerId: 'core:issue',
          mandate: mandate.mandate,
          dataDir: dangerDataDir,
          warn,
        });
        // deliver = 闸包裹的执行腿（SSRF 批装配位包裹同款先例——消费件只见
        // 窄面不见裸腿）：push = 宿主 spawn git push（token 经 GIT_CONFIG_*
        // env 注入，argv/日志恒不见值）；create-pr = backend.createPullRequest
        // （REST POST /repos/:o/:r/pulls——postComment 同形 fetch-only 扩法）。
        const dangerFace: IssueDangerFace = {
          async deliver(req) {
            if (req.kind === 'push') {
              await gate.runGuarded({ action: 'push', target: req.repo, detail: `branch=${req.branch}` }, () =>
                dangerPushBranch({ token, worktreePath: req.worktreePath, branch: req.branch }),
              );
              return {};
            }
            const pr = await gate.runGuarded(
              { action: 'create-pr', target: req.repo, detail: `head=${req.branch}→${req.base ?? 'main'}` },
              () =>
                backend.createPullRequest({
                  repo: req.repo,
                  title: req.title ?? req.branch,
                  body: req.body ?? '',
                  head: req.branch,
                  base: req.base ?? 'main',
                }),
            );
            return { prNumber: pr.number, prUrl: pr.htmlUrl };
          },
          approve: (ttlDays) => gate.approve(ttlDays),
          status: () => gate.status(),
        };
        danger = dangerFace;
        // /danger 人面动词（04 §13：机制宿主有、人面动词件承载——/credentials
        // 同款先例。approve = consent 唯写面；status = 运维五呈单命令面）
        disposeDangerCmd = context.channels.registerCommand(
          'danger',
          async (args) => {
            const verb = args.argv[0];
            if (verb === 'approve') {
              let ttlDays: number | undefined;
              if (args.argv.length > 1) {
                const n = Number(args.argv[1]);
                if (!Number.isInteger(n) || n < 1 || n > 3650) {
                  deps.notify?.('issue', `/danger approve ttlDays 须 1..3650 正整数（得 ${args.argv[1]}）`);
                  return;
                }
                ttlDays = n;
              }
              const result = await dangerFace.approve(ttlDays);
              deps.notify?.(
                'issue',
                result.ok
                  ? `危险闸 consent 已签发（${new Date(result.expiresAt).toISOString()} 到期——绑当前 mandate 哈希，配置漂移即失效）`
                  : `危险闸 consent 签发失败：${result.message}`,
              );
            } else if (verb === 'status') {
              deps.notify?.('issue', renderDangerStatus(await dangerFace.status()));
            } else {
              deps.notify?.('issue', `未知动词——${DANGER_CMD_USAGE}`);
            }
          },
          DANGER_CMD_USAGE,
        );
      }
      const service = createIssueService({
        config: normalized.config,
        backend,
        jobs,
        scheduler: schedulerFace,
        state,
        // worktree 服务：装配根共享位胜出（04 §7 补钉①——issue 编排授予与
        // 会话内工具消费同台账单实例）；缺席 = 件内自建（直接测试形——生产
        // 装配恒注入同源实例）
        worktree: deps.worktree ?? createWorktreeService({ repoRoot: canonicalWorkspaceRoot(deps.cwd) }),
        session,
        budget,
        capabilities,
        ...(danger !== undefined ? { danger } : {}),
        // 交付验证执行面（⑪ 裁决 5——恒注入：verifyCommand 缺席时门 inert；
        // 真身 = host spawn 家族〔上方 runIssueVerify——danger push 腿同族〕）
        verify: { runVerify: runIssueVerify },
        ...(webhookSecret !== '' ? { webhookSecret } : {}),
        // 出口消毒活值源（03 §10.7 第四役附段 b——装配位注入件内已知凭证
        // 活值；就近最小集 = token+webhookSecret 两值，token 主闸二已滤恒在
        // 场、webhookSecret 缺席不进集；栈级全集闭包见 conversation-stack，
        // issue 件就近最小集是 v1 形；回执/detail 双面 verifyTail 消毒合流
        // 的值基腿原料，活值读保证 revoke 即失效）
        sensitiveValues: () => {
          const values = [token];
          if (webhookSecret !== '') values.push(webhookSecret);
          return values;
        },
        warn,
      });
      service.start();
      context.provide('issue', service);
      // webhook 挂点 kit（18a-4' mountIssueWebhook 的宿主消费位——serve/
      // daemon 开面后 tryGet 本面挂路由；secret 缺席 = kit 仍在而守卫 400
      // 形：面开而未启用，与「面未开 ⇒ 通道不在场」分立）
      context.provide('issue-webhook-mount', {
        mount: (face: IssueWebhookMountFace) =>
          mountIssueWebhook(
            { secret: webhookSecret, config: normalized.config, enqueue: (issue) => service.enqueue(issue) },
            face,
          ),
      });
      return () => {
        service.stop();
        disposeDangerCmd?.();
      };
    },
  };
}

/**
 * 插件件作用域 → 三桥 ScopeFace 适配（批 19d 共用 helper）：ctx 不暴露
 * 件作用域本体（effect 是唯一回卷正门），isDisposed 真源 = 回卷翻旗
 * disposer 自持闭包。回卷序：本 disposer 最先注册（LIFO 末位执行）——
 * 各桥 service 经本面登记的 shutdown effect 先收口、翻旗殿后。
 * 结构兼容 McpScopeFace/LspScopeFace/BrowserScopeFace（三面同构）。
 */
function scopeFaceOf(context: PluginContext): {
  effect(register: () => () => void): unknown;
  readonly isDisposed: boolean;
} {
  let disposed = false;
  context.effect(() => () => {
    disposed = true;
  });
  return {
    effect: (register) => context.effect(register),
    get isDisposed() {
      return disposed;
    },
  };
}

/**
 * /browser 命令 usage（人面文案位——产品名合法域）。
 */
const BROWSER_CMD_USAGE =
  '/browser install——下载 Chromium for Testing 引擎到数据目录（发现序③；约 150MB，下载域白名单钉 Chromium for Testing 官方两域，摘要账本 TOFU 锚定）';

/**
 * core:mcp（批 19d）——03 §10.1 装载态兑现：服务编排（装配后异步发现零
 * 阻塞——config 缺省 servers 空 = 行惰性无害零 spawn）+ 工具面全局合计
 * 定形态（≤20 原生注册 / >20 目录降级——重铺归 service 内部）+ 回卷绑
 * 件作用域（LIFO = stdin.end 协议化告别 → 宽限 → 树杀，service 自登记）。
 *
 * spawn 主闸 = 'exec-pipeline'（exec 件供给——04 §11「spawn 管道 + 登记
 * 簿同册」单源；exec 禁用 = 本件零装载诚实缺席）。config 线 = apply 第二
 * 参（enabled.yaml core:mcp 行 config 整值替换；坏形 normalizeMcpConfig
 * 响亮拒 MCP_CONFIG_INVALID → 行级装载失败，/reload 时刻可修）。
 * 'mcp' 服务面供给（liveServers 观测面）。
 */
function makeMcpPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'mcp',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx, config, host) {
      const context = ctx as PluginContext;
      const pipeline = context.tryGet<SpawnPipeline>('exec-pipeline');
      if (pipeline === undefined) return; // 主闸——exec 管道缺席零装载（诚实缺席律）

      const servers: McpConfig = normalizeMcpConfig((config as { servers?: unknown } | undefined)?.servers);
      const service = createMcpService({
        spawn: pipeline,
        // 注册闭包经宿主面开窗（2026-09-13 真模型四轮 C 组——03 §2.1 官方件
        // 异步续段通道/§10.1 连接语义定形注）：resurface 全部到达时点（discover
        // 续段/运行期 onDown 撤桥重铺）均在装载窗收口后——直调 ctx.tools.register
        // 100% 撞 PLUGIN_WINDOW_CLOSED（真装配 MCP 工具注册恒败；单测 FakeRegistry
        // 无窗闸绕过故绿）。经 host.openHostCallback 开本插件回调窗再注册——窗
        // 语义与钩子/工具执行期同律，注册链全语义保留（owner 覆写 core:mcp/
        // 工具名账/复合名撞名闸照走）。host 缺席（直调形/测试替身）维持直调。
        registry: {
          register: (def) => {
            const restore = host?.openHostCallback?.();
            try {
              return context.tools.register(def as ToolDefinition);
            } finally {
              restore?.();
            }
          },
        },
        scope: scopeFaceOf(context),
        notify: (message) => deps.notify?.('mcp', message),
        ...(deps.version !== undefined ? { clientVersion: deps.version } : {}),
      });
      service.apply(servers); // 零阻塞——发现后台跑（fire-and-forget 收口归 service 内部）
      context.provide('mcp', service);
    },
  };
}

/**
 * core:browser（批 19d）——03 §10.3 装载态兑现：编排件（惰性首用——apply
 * 零 spawn 零连接，扫掠链 unref 不阻退出）+ 工具面十件 + /browser install
 * 命令（下载原语不进模型工具面——人面显式命令；装载零网络，fetch 只在
 * 命令调用时发生）。
 *
 * 主闸三位 = 'exec-pipeline'（引擎 spawn 同册）+ 'web-fetch'（navigate 卫生
 * 单源——SSRF 红线与在飞门同一实例，web 件缺席 = 红线缺席 = 本件不装
 * fail-closed）+ dataDir 真值（纯 :memory: 诊断形零装载——引擎目录/截图
 * 落点/安装账本皆无归属地）。config 坏形 normalizeBrowserConfig 响亮拒
 * BROWSER_CONFIG_INVALID → 行级装载失败。引擎出口代理单例随件传真身
 * （03 §10.3 引擎网络栈出口钉死——engineEgressProxy 进程级惰性 listen）。
 */
function makeBrowserPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'browser',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx, config) {
      const context = ctx as PluginContext;
      const pipeline = context.tryGet<SpawnPipeline>('exec-pipeline');
      const web = context.tryGet<WebFetchService>('web-fetch');
      const dataDir = deps.dataDir;
      if (pipeline === undefined || web === undefined || dataDir === null) return; // 主闸三位

      const browserConfig = normalizeBrowserConfig(config);
      const service = createBrowserService({
        spawn: pipeline,
        ws: defaultWsFace(),
        fs: fsp, // BrowserFsFace 结构兼容 node:fs/promises 子面（compat 互证）
        readEnv: (name) => process.env[name],
        platform: process.platform,
        homeDir: deps.homeDir ?? homedir(),
        dataDir,
        config: browserConfig,
        web,
        // 引擎出口代理单例（03 §10.3 引擎网络栈出口钉死——dns-pin dispatcher
        // 单例同律：进程级、惰性 listen、unref 不阻退出；装载零网络——首个
        // 引擎启动才侦听）
        proxy: engineEgressProxy(),
        notify: (message) => deps.notify?.('browser', message),
        register: { register: (def) => context.tools.register(def as ToolDefinition) },
        scope: scopeFaceOf(context),
      });
      service.apply(); // 云端占位通知 + 工具面注册 + 扫掠链起——零 spawn

      // /browser install（下载原语——域白名单/TOFU 账本执法归 install 件；
      // 结果与错误均折人读文本经 notify 归因 'browser' 投递）
      context.channels.registerCommand(
        'browser',
        async (args) => {
          if (args.argv[0] !== 'install') {
            deps.notify?.('browser', `未知动词——${BROWSER_CMD_USAGE}`);
            return;
          }
          try {
            const result = await installBrowserEngine({
              fs: fsp,
              download: defaultDownloadFace(),
              platform: process.platform,
              arch: process.arch,
              dataDir,
            });
            deps.notify?.('browser', `已安装 Chromium for Testing ${result.version}：${result.executablePath}`);
          } catch (err) {
            deps.notify?.('browser', err instanceof Error ? err.message : String(err));
          }
        },
        BROWSER_CMD_USAGE,
      );

      context.provide('browser', service);
    },
  };
}

/**
 * core:lsp（批 19d）——03 §10.2 装载态兑现：静态四件先注册（注册不依赖
 * 服务器在线——与 MCP「装配后异步发现」的结构性差异）+ 惰性 per-(server,
 * rootUri) 实例 + 诊断注入器挂线（service 内部经 events 窄面挂
 * tools_post_execute waterfall——本侧适配面把 ctx.on 路由给它：词主表
 * mode=waterfall 自动走 onWaterfall 腿 + 5s 钩子钟；注入器内层竞速钟
 * 3500ms 硬帽先触即收，两道预算线谁先触谁执法，checkpoint 同论证）。
 *
 * 主闸 = 'exec-pipeline'（spawn 同册）。config 线 = apply 第二参
 * （{servers, diagnostics_timeout_ms} 整值替换；坏形 normalizeLspSettings
 * 响亮拒 LSP_CONFIG_INVALID → 行级装载失败，/reload 时刻可修——03 §10.2
 * config 坏形条，2026-09-13 f-2 批立）。
 * rootUri 锚 = canonical 工作区根（canonicalWorkspaceRoot——rootPath 位）
 * 。'lsp' 服务面供给（goal 件 gates 消费 queryDiagnostics 窄面）。
 */
function makeLspPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'lsp',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx, config) {
      const context = ctx as PluginContext;
      const pipeline = context.tryGet<SpawnPipeline>('exec-pipeline');
      if (pipeline === undefined) return; // 主闸——exec 管道缺席零装载（诚实缺席律）

      const service = createLspService({
        spawn: pipeline,
        registry: { register: (def) => context.tools.register(def) },
        scope: scopeFaceOf(context),
        events: {
          onWaterfall: (name, listener) =>
            context.on(name, (value, next) => listener(value as never, (v) => next(v) as Promise<never>)),
        },
        fs: fsp, // LspFsFace 结构兼容 node:fs/promises 子面（readFile/realpath）
        rootPath: canonicalWorkspaceRoot(deps.cwd),
        notify: (message) => deps.notify?.('lsp', message),
      });
      // 装载期归一（f-2 批立——坏形行级装载失败，不再走运行期降级语义）
      service.apply(normalizeLspSettings(config));
      context.provide('lsp', service);
    },
  };
}

/**
 * core:credentials（c-3——03 §10.9 件席）：件身份 = 判据面独立件，执法面
 * 三分他处——存储链 c-2 迁移聚合（runtime HOST_MIGRATION_TAIL）；读写
 * 执法件 secrets.ts（host 装配序 plugin-boot createContext 逐插件 fork
 * 绑定——非本 apply 职责：服务面绑定携插件身份，宿主装配位是唯一正口）；
 * 人面命令（c-5——本 apply 注册 /credentials add|list|rm，纯逻辑底座
 * commands.ts 单源）；oauth 流随 c-6 入本 apply。
 *
 * 本 apply 承载两位：装载计数（披露面「件在场」）+ 禁用位语义
 * （enabled.yaml 禁 core:credentials ⇒ 计划行 disabled ⇒ plugin-boot 侧
 * secrets 面整体缺席——诚实缺席律，判据在装配位不在件内）。
 */
function makeCredentialsPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'credentials',
    // 官方清单 api 块（ag 批 DP3——03 §8.4：装载门同律自证「官方也声明」，
    // min = 宿主地板 1.0——同仓同版本恒过；齐备性由 check-api 查 7 执法）
    api: { minApiVersion: '1.0' },
    async apply(ctx) {
      const context = ctx as PluginContext;
      const store = deps.credentialsStore;
      if (store === undefined) return; // 主闸——存储 seam 缺席 = 人面命令零注册（空闲占席维持）
      const oauth = deps.credentialsOAuth;

      // oauth 动词执行腿（c-6——03 §10.9 oauth 案）：流解析 → invoke（宿主
      // 回调窗包裹——窗内插件 ctx.secrets.set 写自域）→ 完成回执。token 只在
      // io 返回值内存过手（宿主不落值、回执永不呈值——模型可见性铁律同源）
      const runOAuth = async (pluginId: string, name: string | undefined): Promise<void> => {
        if (oauth === undefined) {
          deps.notify?.('credentials', 'oauth 流面未装配（运行时承载——CLI/零装配面不可用；TUI 面须流注册表在场）。');
          return;
        }
        const resolved = resolveOAuthFlow(oauth.registry, pluginId, name);
        if (resolved.flow === undefined) {
          deps.notify?.('credentials', resolved.message);
          return;
        }
        const flow = resolved.flow;
        try {
          await flow.invoke({
            runDeviceCode: () =>
              runDeviceCodeFlow(flow.def, {
                fetchFn: oauth.fetchFn,
                present: (text) => deps.notify?.('credentials', text), // 用户呈现面（user_code/验证页）
                now: () => Date.now(),
                sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
              }),
          });
          deps.notify?.(
            'credentials',
            `oauth 授权流完成——凭证由插件 ${pluginId} 写入自域（plugin:${pluginId}/${flow.def.name}）；/credentials list 查看。`,
          );
        } catch (err) {
          // 守卫错折文本不炸通道（命令面是用户面——DENIED/EXPIRED/FLOW_FAILED 码直呈）
          deps.notify?.(
            'credentials',
            err instanceof BaseError ? `${err.code}：${err.message}` : err instanceof Error ? err.message : String(err),
          );
        }
      };

      // 命令结算文本 = 人读面，经 notify 归因 'credentials' 投递（memory 件
      // runCommand 同形）；非 BaseError 兜底折呈不炸通道
      const runCommand = (run: () => string) => {
        try {
          deps.notify?.('credentials', run());
        } catch (err) {
          deps.notify?.('credentials', err instanceof Error ? err.message : String(err));
        }
      };
      const dispose = context.channels.registerCommand(
        'credentials',
        async (args) => {
          const parsed = parseCredentialsArgv(args.argv);
          if (!parsed.ok) {
            deps.notify?.('credentials', parsed.message);
            return;
          }
          // oauth 动词先行分流（异步执行腿——dance 轮询分钟级长 await，命令
          // 分派无超时面合法承载）
          if (parsed.sub.sub === 'oauth') {
            await runOAuth(parsed.sub.pluginId, parsed.sub.name);
            return;
          }
          runCommand(
            () =>
              runCredentialsCommand(parsed.sub, {
                store,
                ...(deps.credentialsOnChanged !== undefined ? { onCredentialChanged: deps.credentialsOnChanged } : {}),
              }).text,
          );
        },
        CREDENTIALS_USAGE,
      );

      // 刷新链（c-6）：受局面在场即起（件内自持挂钟 intervalMs 缺省 60s；
      // 0 = 不自驱——测试手动 tick；dispose 位停钟——装载代内生命周期）
      let chainStop: (() => void) | undefined;
      if (oauth !== undefined) {
        const chain = createRefreshChain({
          store,
          registry: oauth.registry,
          fetchFn: oauth.fetchFn,
          now: () => Date.now(),
          notify: (message) => deps.notify?.('credentials', message), // 三振告警（用户面）
          warn: (message) => oauth.warn?.(message), // 单败 warn（日志面——缺省丢弃，三振腿恒在场）
          ...(deps.credentialsOnChanged !== undefined ? { onCredentialChanged: deps.credentialsOnChanged } : {}),
        });
        const intervalMs = oauth.intervalMs ?? 60_000;
        if (intervalMs > 0) chain.start(intervalMs);
        chainStop = () => chain.stop();
        // B3 联动腿外露（04 §3.3 条 8）：装配根收句柄桥 authRefresh seam
        // ——末位胜出（换代重装载新链覆写旧代，旧链随件 dispose 停钟）
        deps.credentialsChainSink?.(chain);
      }
      return () => {
        chainStop?.();
        dispose();
      };
    },
  };
}

/**
 * core: 官方件注册表工厂（assembly.ts 缺省注入源——`options.corePlugins ??
 * createCorePlugins(deps)`；测试注入面/诊断命令经 options 覆盖）。
 * deps 聚落律（07 §7.4 #1）：宿主真身需求逐笔入 CorePluginHostDeps
 * （dataDir 首位——批 19b-1；memory 数据面六位——批 19b-2；subagent
 * 委派面两位——批 19c-1；调度闸事实位——批 19c-2；goal 会话读面——批
 * 19c-3；checkpoint 语境/fork 两 seam + 焦点会话位——批 19c-4；宿主
 * 版本位——批 19d；HTTP 面族十位〔sdk 面工厂/webui 挂载 kit/obs 三
 * seam/issue 五位〕——批 19e）。
 *
 * 注册表序 = tryGet 前件序（core 行对象直调按序 apply，序内后件可见前件
 * provide 面）：exec/web 双首件（三桥 spawn/卫生消费源）→ …… → 三桥
 * （批 19d——mcp/browser/lsp 依次）→ goal（gates lsp seam 消费 lsp
 * provide 面——必居其后）→ checkpoint → sdk/webui（面族两件——kit
 * 供给零件间依赖）→ obs（数据面自足）→ issue 居末（组合消费方：tryGet
 * scheduler/jobs 前件 + goal/exec/checkpoint capabilities 探测——必居
 * 四前件之后）。02 §4.1 core 表序是件册清单非装载序——装载序按依赖闭
 * 包排（批 19d 注记）。批 19e 起 15 件齐册——批 19a 头注「入册齐 15 件
 * 时本注记销账」兑现；c-3 增席 #16 credentials（件席占位——secrets 面
 * 绑定在 plugin-boot 装配位，与注册表序无依赖关系，居末）。
 */
export function createCorePlugins(deps: CorePluginHostDeps): readonly CorePluginReference[] {
  return [
    makeExecPlugin(deps),
    webPlugin,
    makeSkillsPlugin(deps),
    makeMemoryPlugin(deps),
    makeSubagentPlugin(deps),
    makeSchedulerPlugin(deps),
    makeMcpPlugin(deps),
    makeBrowserPlugin(deps),
    makeLspPlugin(deps),
    makeGoalPlugin(deps),
    makeCheckpointPlugin(deps),
    makeSdkPlugin(deps),
    makeWebuiPlugin(deps),
    makeObsPlugin(deps),
    makeIssuePlugin(deps),
    makeCredentialsPlugin(deps),
  ];
}
