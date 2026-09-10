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
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import * as fsp from 'node:fs/promises';
import { join } from 'node:path';

import type { GateInput, SessionEvent, ToolDefinition } from '../contracts/index.js';
import { BaseError } from '../contracts/index.js';
import { getEventTypeMeta } from '../contracts/index.js';
import type { AgentService, ContextTransformInput, ExecToolService, PreStepInput } from '../conversation/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import type { SpawnPipeline } from '../exec/index.js';
import { createMcpService, normalizeMcpConfig } from '../mcp/index.js';
import type { McpConfig } from '../mcp/index.js';
import { createLspService } from '../lsp/index.js';
import type { LspConfig, LspService } from '../lsp/index.js';
import {
  createBrowserService,
  defaultDownloadFace,
  defaultWsFace,
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
import { createBashTool, createSpawnPipeline, buildChildEnv } from '../exec/index.js';
import {
  createGoalService,
  createGoalTodoTool,
  createGoalUpdateTool,
  runGoalCommand,
  GOAL_USAGE,
} from '../goal/index.js';
import type { GoalService, GoalSessionFace, GoalSummarizerFace, GoalTodoItem } from '../goal/index.js';
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
import type { GateFacts, GoalJobsFace, JobRow, SchedulerEngine, SchedulerService } from '../scheduler/index.js';
import { createFetchTool, createInFlightGate, createWebFetchService, DEFAULT_WEB_LIMITS } from '../web/index.js';
import type { InFlightGate, WebFetchService } from '../web/index.js';
import {
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
import { collectAgentDefs, createStandardAgentLayers } from '../skills/index.js';
import { createAgentTool, materializeDeclarativeSubagents, JOBS_SERVICE_NAME } from '../subagent/index.js';
import type { DelegationToolDeps, SubagentService } from '../subagent/index.js';
// 批 19e HTTP 面族四件（sdk/webui/issue/obs——core 15 件齐册）
import { createSdkHttpFace } from '../sdk/index.js';
import type { PluginRouteRegistry, SdkHttpFaceHandle } from '../sdk/index.js';
import { createObsQueryTool, createObsService } from '../obs/index.js';
import type { ObsAlertRule, ObsAudienceFace, ObsEventsFace, ObsNotifyFace } from '../obs/index.js';
import { createGithubBackend, createIssueService, mountIssueWebhook, normalizeIssueConfig } from '../issue/index.js';
import type {
  IssueBudgetFace,
  IssueDangerFace,
  IssueDangerStatusFace,
  IssueJobsFace,
  IssueSchedulerFace,
  IssueSessionFace,
  IssueStoreStateFace,
  IssueWebhookMountFace,
} from '../issue/index.js';
import { createWorktreeService } from '../tools/index.js';
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
      };
      context.provide('exec', service);
    },
  };
}

/**
 * core:web——fetch 工具（effect 'read'，经 ctx.tools.register 散装注册走
 * bootTools 重放消费腿）+ 'web-fetch' 服务面供给（02 §4.1 席 18「ctx.fetch」
 * 词面落形：服务名带域防裸名撞位）+ 'web-gate' 在飞门单例供给（03 §10.3
 * browser 件共享同一实例——装配根经共享根传实例的装载面形态）。归因 sink
 * 缺省 no-op（观测面挂账归 obs 纵切笔——sink 不绑架数据面）。
 */
const webPlugin: CorePluginReference = {
  name: 'web',
  async apply(ctx) {
    const context = ctx as PluginContext;
    // 在飞门单例（容量缺省单源 DEFAULT_WEB_LIMITS.maxConcurrent = 4——fetch
    // 工具/服务面/browser 导航三消费位同一实例）
    const gate: InFlightGate = createInFlightGate(DEFAULT_WEB_LIMITS.maxConcurrent);
    const service = createWebFetchService({ gate });
    context.provide('web-fetch', service);
    context.provide('web-gate', gate);
    // 工具注册（boot 全局层——openTools 会话装配重放走真三段管道）
    return context.tools.register(createFetchTool(service));
  },
};

/**
 * 宿主真身注入面（批 19b-1 工厂形升级——19a 尾注预留兑现）：件内自足构造
 * 覆盖不了的装配期事实经此入件（dataDir 是首位——skills user 层锚 /
 * memory 件数据面等后续件逐笔扩展）。工厂形 vs 静态数组：deps 装配期才
 * 定形（runtime.dataDir 先于装载），静态数组装不进运行时事实。
 */
export interface CorePluginHostDeps {
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
  /**
   * 命令输出面（core 件命令结算文本投递——memory-export/import 与 /tick 共用；
   * source = 归因字面〔命令域〕——呈现侧路由后端自决，语义面 = 可辨识命令
   * 来源。缺席即静默，命令仍注册）。
   */
  readonly notify?: (source: string, message: string) => void;
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
   * 调度闸事实收集器（批 19c-2——04 §12 DiscoveryGates 装配位）：engine 到点
   * fire 前逐行求值（agentBusy/lastUserMessageAt/canAfford 从宿主面收集——
   * 在飞 run 查询/最近用户消息/当日后台预算三源）。缺席 = 引擎空事实全门
   * 放行（fail-open 属实——gates 头注：打扰礼仪与预算面非安全边界）。
   * 批 20c 装配根接线兑现（宿主三面齐——assembly 侧闭包单源）。
   */
  readonly schedulerGateFacts?: (row: JobRow) => GateFacts;
  /**
   * run 子进程可执行（批 20c 真 bin 出厂——runner spawn 与 cron 行命令段
   * 共用单源；装配根解析 env BERRY_AGENT_BIN 注入，缺席 'berry-agent'
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
  /**
   * 宿主版本（批 19d——mcp 件 initialize 握手 clientInfo.version 披露，
   * 「装配批对齐 package.json」兑现位：装配根 options.version 单源）。
   * 缺席 = mcp 桥内缺省 '0.1.0'。
   */
  readonly version?: string;
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
  /**
   * webui 挂载 kit（批 19e——core:webui 件主闸：路由挂载闭包（面级
   * handle + 可选 staticDir → 挂载产物窄面）。件零自持监听（全库唯一
   * 监听族住 core:sdk 面）。缺席 = webui 件零装载 = /api/* 404 而面
   * 仍在（两件禁用语义族——03 §10.4/07 §4.2）。
   */
  readonly webuiFaceMount?: (face: SdkHttpFaceHandle, options?: { staticDir?: string }) => WebuiFaceMount;
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
  /**
   * issue headless 起会面（批 19e——issue 件主闸三：IssueSessionFace
   * 装配位真身）。缺席 = issue 件零装载（挂账：起会接线改道
   * ctx.triggers.register 随 issue 件扩展批——03 §10.7 运行条）。
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
   * 凭证存储窄面（c-5——03 §10.9 写入面：/credentials add|list|rm 人面
   * 命令读写真源。词面独立律：CredentialsCommandStore 结构兼容 persist
   * Store 凭证方法子集四法，assembly 直传 persistence.store）。缺席 = 件
   * 人面命令零注册（空闲占席维持——装载计数与禁用位语义不受影响）。
   */
  readonly credentialsStore?: CredentialsCommandStore;
  /**
   * credentials/changed 审计 seam（c-5——人面 add/rm 发射位；05 §1.1 载荷
   * 值域单源。缺省 no-op——audit_events 载体挂账 U3-2 真发射位接线）。
   */
  readonly credentialsOnChanged?: (payload: CredentialChangedPayload) => void;
  /**
   * oauth 流受局面（c-6——03 §10.9 oauth 案）：流注册表（assembly 单真身，
   * 与 plugin-boot fork 绑定共用）+ fetch 注入（生产 = globalThis.fetch——
   * credentials 件无 web 边，SSRF 守卫挂账安全批注记）+ 刷新链节奏（缺省
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
}

/**
 * core:skills——技能注册表装载（06 §11 渐进披露装载态兑现）：标准六位层
 * 构造 + 全量 refresh 落快照 + 'skills' 服务面供给（插件 tryGet 消费）+
 * skill_manage 工具（boot 全局层散装注册——bootTools 重放消费腿）+
 * 'skills/manifest' 提示词段（每请求物化——registry 快照变化即生效，
 * 06 §11.3 渐进披露的「披露清单」半边；激活半边 = 模型显式读 SKILL.md
 * 归 agent 工具面）。
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
      const disposeTool = context.tools.register(
        createSkillManageTool({
          registry,
          workspaceRoot,
          writableRoots: () => [join(workspaceRoot(), '.agents', 'skills')],
        }),
      );
      // 披露清单段：builder 每请求物化时重取快照（PromptSectionBuilder
      // 求值即取——refresh 后变化自然生效）
      const disposeSection = context.prompts.registerSection(
        'skills/manifest',
        () => renderAvailableSkills(registry.list()).text,
      );
      return () => {
        disposeSection();
        disposeTool();
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
    async apply(ctx) {
      const context = ctx as PluginContext;
      const db = deps.sqlite?.();
      if (db === undefined) return; // 主闸——库座缺席零装载（诚实缺席律）

      const warn = (message: string) => console.error(message);
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

      // 常驻简报段（每请求物化——06 §6 路 1；重建时点求值见 inject.ts 注记）
      const disposeBrief = context.prompts.registerSection('memory/core', () =>
        buildCoreBrief({ dao, now, ownerKeys }),
      );

      // memory/diff 词汇注册（不可逆装配面——06 §329 装载面作用域化注册）。
      // 注册表进程级单例（contracts/events 模块态）：同进程多次装配（测试多例
      // /热重启形）同 owner 已在场 = 幂等跳过；异 owner 在场则注册动词保持
      // 响亮冲突（HOST_EVENT_TYPE_CONFLICT 拒收语义不软化）
      if (getEventTypeMeta(MEMORY_DIFF_EVENT_META.type)?.owner !== MEMORY_DIFF_EVENT_META.owner) {
        context.events.registerSessionEventType(MEMORY_DIFF_EVENT_META);
      }

      // —— memory/diff 发射位 + 两注入腿（批 19 销账笔——06 §6 三件收口）——
      // sessions 服务活引用（03 §4.4 appendEvent 最小面；tryGet 诚实缺席：
      // 服务缺席 = 差分降级只渲染不落账——mirror 不锁步）。基线纪元采 sync 懒立
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

      context.provide('memory', { dao, cycle: cycle ?? null });

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
 * core:subagent（批 19c-1）——委派面装载态兑现：通用 `agent` 工具（boot
 * 全局层散装注册——执行时会话语境解析，toolCtx.sessionId → 深度/父面
 * 枚举）+ 声明式子代理腿（agents 层发现 [skills/agents.ts 解析层镜像律]
 * → materializeDeclarativeSubagents 物化 named provider + `agent_<name>`
 * 静态工具——前缀保留字闸豁免 core:subagent 域，plugin-context 注记条款）。
 *
 * in-process 真工厂本体在 assembly 根（subagent-factory.ts——真工厂需
 * ConversationStack 真身，件内不可达）；本 apply 只消费 service 面 +
 * sessionContext 解析闭包（deps 两新位）。缺席 = 件整体零装载。
 */
function makeSubagentPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'subagent',
    async apply(ctx) {
      const context = ctx as PluginContext;
      const service = deps.subagents;
      if (service === undefined) return; // 缺席零装载（诚实缺席律——assembly 未接线形）

      const warn = (message: string) => console.error(message);
      // 工具 deps：boot 全局层形只携 sessionContext（执行时解析——静态位
      // 全缺席；两源俱缺席时 resolveToolContext 诚实拒）
      const toolDeps: DelegationToolDeps = {
        service,
        ...(deps.subagentSessionContext !== undefined ? { sessionContext: deps.subagentSessionContext } : {}),
      };
      const disposeAgent = context.tools.register(createAgentTool(toolDeps));

      // 声明式腿：标准层发现（project/user/跨库——dataDir null 跳 user 层，
      // 同 skills 律）→ 坏文件诊断 warn（不炸装配——skills 纪律镜像）→
      // def 物化（named provider 注册 + 静态工具族）
      const layers = createStandardAgentLayers({
        ...(deps.cwd !== undefined ? { cwd: deps.cwd } : {}),
        ...(deps.dataDir !== null ? { dataDir: deps.dataDir } : {}),
        ...(deps.homeDir !== undefined ? { homeDir: deps.homeDir } : {}),
      });
      const collection = await collectAgentDefs(layers);
      for (const diagnostic of collection.diagnostics) {
        warn(`[subagent] ${diagnostic.type}：${diagnostic.message}（${diagnostic.path}）`);
      }
      const materialized = materializeDeclarativeSubagents(collection.defs, service, toolDeps);
      const disposeDeclarative = materialized.tools.map((tool) => context.tools.register(tool));

      return () => {
        for (const dispose of disposeDeclarative.reverse()) dispose();
        disposeAgent();
      };
    },
  };
}

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
 * 'berry-agent' PATH 名解析，bin 缺席诚实归 spawn_failed）③ cron 乙案开启位
 * （deps.schedulerCronEnabled——true 时装配 OS cron 注册器 + 装载期既有启用
 * 行对账回填〔per-row try/catch——once 形/不可表达形不炸装载〕）。
 *
 * 主闸 = sqlite seam（同 memory 律）：缺席 = 件整体零装载（诚实缺席律）。
 */
function makeSchedulerPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'scheduler',
    async apply(ctx) {
      const context = ctx as PluginContext;
      const db = deps.sqlite?.();
      if (db === undefined) return; // 主闸——库座缺席零装载（诚实缺席律）

      const warn = (message: string) => console.error(message);
      const now = () => new Date().toISOString();
      // 真 bin 单源（批 20c）：runner spawn 命令与 cron 行命令段共用——装配根
      // 解析 env BERRY_AGENT_BIN 注入；缺席 'berry-agent' PATH 名解析
      const binCommand = deps.schedulerBinCommand ?? 'berry-agent';
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
        // 真 bin spawn 接线：子进程 env 走 exec 白名单基座（deny-by-default
        // 同律——PATH/locale 最小集，零宿主环境继承）
        runner: createProcessRunnerFactory({ env: buildChildEnv(), command: binCommand }),
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

      context.provide('scheduler', { service, goalJobs, engine } satisfies SchedulerFace);

      // 迟到序对称腿（04 §12 第五槽双序合法）：goal 件先装载（注册表序倒置
      // 或本件单件复活）时此处补接线；先行腿在 goal 件 apply 内 tryGet 本面。
      // 附着者回卷律——本腿 attach 则本腿 detach（goal 件先行腿自理对称）
      let attachedGoal: GoalService | undefined;
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
 * @param scope 装配产物共享根（tryGet 'scheduler'——件缺席/禁用时 no-op：
 * 起钟属长驻编舞非正确性前提，诚实零动作）
 * @param runtime 运行时（registerCloser 挂停钟腿）
 * @returns 是否起钟（件在场且已 start——测试观察面；件缺席 false）
 */
export function startSchedulerClock(
  scope: { tryGet<T>(name: string): T | undefined },
  runtime: { registerCloser: (closer: { label: string; fn: () => void }) => void },
): boolean {
  const face = scope.tryGet<SchedulerFace>('scheduler');
  if (face === undefined) return false; // 件缺席/禁用——no-op（长驻编舞非正确性前提）
  face.engine.start(); // 重启补推进（missed 静默 advance）+ 排首轮轮询
  runtime.registerCloser({
    label: 'scheduler-engine',
    fn: () => face.engine.stop(), // 只摘轮询定时器（在飞自然收场——engine 头注）
  });
  return true;
}

/**
 * 'goal' 服务面（批 19c-3——conversation-stack 换装消费位 + 宿主入口面）。
 * todoFactory = per-session 扩展 todo 工具构造（03 §10.5 换装律——append/
 * getScope 会话闭包由调用方注入，件内补段约束执法三判据）；service =
 * GoalService 全环（goalScopeFor 锚 = chat↔goal 数据通道零服务面例外位
 * ——组合根经本面取锚，driver fold 升格与 /goal show 渲染共用）。宿主入口
 * recordTurn/wake 消费已接线（批 #99 三入口统一——挂点上移驱动层 settled 链）。
 */
export interface GoalFace {
  readonly service: GoalService;
  /** per-session 扩展 todo 工具构造（换装产物同名 'todo'——模型面无感） */
  readonly todoFactory: (deps: {
    readonly append: (data: { items: GoalTodoItem[] }) => void;
    readonly getScope: () => { goalId: string; activatedSeq: number } | null;
  }) => ToolDefinition;
}

/**
 * core:goal（批 19c-3）——03 §10.5 计划态机器装载态兑现：GoalService 全环
 * （goals 表族 v3 已由宿主聚合）+ goal_update 终态申报工具（boot 全局层
 * ——执行时会话解析包装：toolCtx.sessionId 先落可变格再入件，多会话共享
 * 一 def）+ /goal 命令（输出经 notify 归因 'goal'）+ 挂钟迟到注入先行腿
 * （tryGet scheduler 面——注册表序 scheduler 先装载即挂即用；倒置序对称
 * 腿在 scheduler 件内）+ 'goal' 服务面供给（todoFactory + service）。
 *
 * gates v1 接线形：workspaceRoot 真值 + exec seam 缺席 fail-closed（files
 * 源真 statSync 件内缺省）+ lsp seam 接线真诊断面（批 19d 回补——query-
 * Diagnostics 窄面，lsp 件缺席即缺席 fail-closed）；todo 换装 command-
 * GateAllowed 恒 false（needsWrite 申报+人面批准链路未建——拒申报即拒
 * 评测双拦位）+ hasLsp 同源 lsp 在场否。
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
    async apply(ctx) {
      const context = ctx as PluginContext;
      const db = deps.sqlite?.();
      const sessionFace = deps.goalSession;
      if (db === undefined || sessionFace === undefined) return; // 主闸双位

      const warn = (message: string) => console.error(message);
      const now = () => new Date().toISOString();
      // lsp 诊断查询窄面（批 19d hasLsp 回补——注册表序 lsp 必居本件前，
      // tryGet 序内前件；lsp 件缺席/disabled = GateLspSeam 缺席 = diagnostics
      // gate 申报即拒 fail-closed〔03 §10.5〕，todoFactory hasLsp 同源）
      const lsp = context.tryGet<LspService>('lsp');
      const service = createGoalService({
        db,
        now,
        warn,
        session: sessionFace,
        // 判据门 v1 接线形：files 源真 stat；exec 缺席 = 该源评测恒 fail；
        // lsp seam 接线真诊断面（queryDiagnostics——词面独立律适配在装配
        // 侧收口，goal 席 DAG 无 lsp 边）
        gates: {
          workspaceRoot: canonicalWorkspaceRoot(deps.cwd),
          ...(lsp !== undefined ? { lsp: { queryDiagnostics: (files: string[]) => lsp.queryDiagnostics(files) } } : {}),
        },
        // 沉淀摘要窄面（批 #99——缺席 = depositFor 确定性回退，零 LLM 保底）
        ...(deps.goalSummarizer !== undefined ? { summarizer: deps.goalSummarizer } : {}),
      });

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
      // service.session 同源读面；输出面经 notify 归因 'goal'）
      const disposeGoal = context.channels.registerCommand(
        'goal',
        async (args) => {
          const text = await runGoalCommand(args.argv, { service, eventsFor: (sid) => sessionFace.events(sid) });
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

      context.provide('goal', {
        service,
        todoFactory: (todoDeps) =>
          createGoalTodoTool({
            ...todoDeps,
            commandGateAllowed: false, // v1 接线形——needsWrite 批准链路挂账
            hasLsp: lsp !== undefined, // 批 19d 回补——真诊断面在场否（申报面 fail-closed 判据）
          }),
      } satisfies GoalFace);

      return () => {
        offPreStep();
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
    async apply(ctx) {
      const context = ctx as PluginContext;
      const dataDir = deps.dataDir;
      const sessionFace = deps.checkpointSession;
      const forkFace = deps.checkpointFork;
      if (dataDir === null || sessionFace === undefined || forkFace === undefined) return; // 主闸三位

      const warn = (message: string) => console.error(message);
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
    async apply(ctx, config) {
      const context = ctx as PluginContext;
      const dataDir = deps.dataDir;
      const events = deps.obsEvents;
      if (dataDir === null || events === undefined) return; // 主闸双位

      const warn = (message: string) => console.error(message);
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

      const warn = (message: string) => console.error(message);
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
        worktree: createWorktreeService({ repoRoot: canonicalWorkspaceRoot(deps.cwd) }),
        session,
        budget,
        capabilities,
        ...(danger !== undefined ? { danger } : {}),
        ...(webhookSecret !== '' ? { webhookSecret } : {}),
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
    async apply(ctx, config) {
      const context = ctx as PluginContext;
      const pipeline = context.tryGet<SpawnPipeline>('exec-pipeline');
      if (pipeline === undefined) return; // 主闸——exec 管道缺席零装载（诚实缺席律）

      const servers: McpConfig = normalizeMcpConfig((config as { servers?: unknown } | undefined)?.servers);
      const service = createMcpService({
        spawn: pipeline,
        registry: { register: (def) => context.tools.register(def as ToolDefinition) },
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
 * BROWSER_CONFIG_INVALID → 行级装载失败。
 */
function makeBrowserPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'browser',
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
 * （{servers, diagnostics_timeout_ms} 整值替换；坏形无装载期归一器——
 * LSP_CONFIG_INVALID 未立码，坏服务器配置走运行期降级语义〔连接失败计
 * 熔断 + notify warn，03 §10.2 既有条款〕，归一器挂账随真实需求裁）。
 * rootUri 锚 = canonical 工作区根（canonicalWorkspaceRoot——rootPath 位）
 * 。'lsp' 服务面供给（goal 件 gates 消费 queryDiagnostics 窄面）。
 */
function makeLspPlugin(deps: CorePluginHostDeps): CorePluginReference {
  return {
    name: 'lsp',
    async apply(ctx, config) {
      const context = ctx as PluginContext;
      const pipeline = context.tryGet<SpawnPipeline>('exec-pipeline');
      if (pipeline === undefined) return; // 主闸——exec 管道缺席零装载（诚实缺席律）

      const raw = config as { servers?: unknown; diagnostics_timeout_ms?: unknown } | undefined;
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
      service.apply({
        servers: (raw?.servers as LspConfig | undefined) ?? {},
        ...(raw?.diagnostics_timeout_ms !== undefined
          ? { diagnostics_timeout_ms: raw.diagnostics_timeout_ms as number }
          : {}),
      });
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
