/**
 * host/core-plugins — core: 官方件注册表单源（批 19a 装载态集成）。
 *
 * 15 件权威清单 = 02 篇 §4.1 core: 行（skills/memory/subagent/exec/mcp/web/
 * browser/lsp/checkpoint/scheduler/goal/obs/webui/sdk/issue）——v1 全量
 * 带上默认启用，经同一插件装载面（第一方禁私有车道：对象直调 apply 零
 * jiti 零 import 门禁，03 §1.4 官方引用形）。本件逐件入册（批 19a 起，
 * 每纵切笔入册一批——入册齐 15 件时本注记销账）。
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
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import type { SessionEvent } from '../contracts/index.js';
import { getEventTypeMeta } from '../contracts/index.js';
import type { AgentService, ExecToolService } from '../conversation/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { createBashTool, createSpawnPipeline, buildChildEnv } from '../exec/index.js';
import type { SqliteDatabase } from '../persist/index.js';
import { createSandboxService } from '../safety/index.js';
import {
  createProcessRunnerFactory,
  createSchedulerEngine,
  createSchedulerService,
  runTickCommand,
  TICK_USAGE,
} from '../scheduler/index.js';
import type { GateFacts, GoalJobsFace, JobRow, SchedulerEngine, SchedulerService } from '../scheduler/index.js';
import { createFetchTool, createInFlightGate, createWebFetchService, DEFAULT_WEB_LIMITS } from '../web/index.js';
import type { InFlightGate } from '../web/index.js';
import {
  createSkillManageTool,
  createSkillsRegistry,
  createStandardLayers,
  renderAvailableSkills,
} from '../skills/index.js';
import {
  buildCoreBrief,
  createCiteRecorder,
  createImmediateExtractor,
  createMemoryCycle,
  createMemoryDao,
  createMemoryTools,
  ensureFtsIndex,
  MEMORY_DIFF_EVENT_META,
  MEMORY_EXPORT_USAGE,
  MEMORY_IMPORT_USAGE,
  runMemoryExportCommand,
  runMemoryImportCommand,
} from '../memory/index.js';
import type {
  ExtractableUserMessage,
  FtsMaintenanceFace,
  MemoryLlmFace,
  SessionFtsSearchFace,
} from '../memory/index.js';
import { collectAgentDefs, createStandardAgentLayers } from '../skills/index.js';
import { createAgentTool, materializeDeclarativeSubagents } from '../subagent/index.js';
import type { DelegationToolDeps, SubagentService } from '../subagent/index.js';

import type { PluginContext } from './plugin-context.js';
import type { CorePluginReference } from './loader.js';

/**
 * core:exec——spawn 管道装载期自持（进程级单例：登记簿/孤儿清扫随管道
 * 同生命周期）+ 'exec' 服务面供给（会话装配期工厂形——exec 禁用 = bash
 * 静默缺席，对话本体仍通）。bash 工具件经 openTools 既有消费位拾取
 * （scope.tryGet 诚实缺席律），不走 ctx.tools.register 散装注册（双路
 * 会撞名——装载面单路执法）。
 */
const execPlugin: CorePluginReference = {
  name: 'exec',
  async apply(ctx) {
    const context = ctx as PluginContext;
    // 管道/沙箱服务进程级单例：spawn 登记簿与后端链探测缓存（probe 有
    // spawn 开销——单例缓存一次）均无会话态；沙箱后端链缺省平台链
    // （macOS seatbelt / Linux bwrap——safety 单源）
    const pipeline = createSpawnPipeline();
    const sandboxService = createSandboxService();
    const service: ExecToolService = {
      // 会话装配期工厂：进程级单例闭包自持 + 会话级 deps（档位/审批/工作
      // 区）由消费位注入求值——结构契约单源在 conversation/types.ts；
      // deps.sandboxService 显式在场时胜出（测试/宿主覆盖位——展开序在后）
      createBashTool: (deps) => createBashTool({ pipeline, sandboxService, ...deps }),
    };
    context.provide('exec', service);
  },
};

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
   * 放行（fail-open 属实——gates 头注：打扰礼仪与预算面非安全边界）。装配
   * 根接线挂账 run 入口批（宿主三面未齐）。
   */
  readonly schedulerGateFacts?: (row: JobRow) => GateFacts;
}

/**
 * core:skills——技能注册表装载（06 §11 渐进披露装载态兑现）：标准六位层
 * 构造 + 全量 refresh 落快照 + 'skills' 服务面供给（插件 tryGet 消费）+
 * skill_manage 工具（boot 全局层散装注册——bootTools 重放消费腿）+
 * 'skills/manifest' 提示词段（每请求物化——registry 快照变化即生效，
 * 06 §11.3 渐进披露的「披露清单」半边；激活半边 = 模型显式读 SKILL.md
 * 归 agent 工具面）。
 *
 * 磁盘件技能目录载荷层（06 §11.4 位 4）挂账磁盘件装载面充实批——core 行
 * 先装（synthesizePlan core 行先入 plan）时磁盘件 manifest.skills 尚未
 * 激活，本 apply 构造 pluginLayers 空缺；补注册于出厂层之后有 06 §11.3
 * 优先序微差（插件层应压出厂层——挂账笔以 unregisterProvider + 位 4
 * 重插兑现，注记在案）。
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
      // 标准六位层（project/user/跨库/出厂——pluginLayers 空缺见上注；
      // dataDir null 跳过 user 层；cwd/homeDir 缺省真跑形）
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
 * core:memory（批 19b-2）——06 篇记忆面全环装载：DAO（宿主库同库——05 §6.4
 * 迁移链已由 runtime 机械聚合）+ 九工具散装注册（boot 全局层）+ 'memory/core'
 * 常驻简报段（每请求物化）+ session/event 三消费腿（即时提取/引用记录/周期
 * 计数——03 §146 活体镜像的汇入点，发射位在 Persistence.onDurableEvent 桥）+
 * run 终态 due→fire（06 §5 计数挂件拍点 = 会话空闲即审）+ 激活期 FTS 对账 +
 * memory/diff 词汇注册（不可逆装配面）+ memory-export/import 两命令 +
 * 'memory' 服务面供给。
 *
 * 路 2（recallForQuery 按需检索）1.0 缺省关（06 §6 拍板——minScore 水位旋钮
 * 不设位即不启用）；diff 注入腿（context_transform 族）与 appendEvent
 * 'sessions' 服务同挂账后续批——本批只注册 memory/diff 词汇（注册先于任何
 * 潜在发射，装配面作用域化）。
 *
 * 降级梯：sqlite 缺席 = 件整体零装载（主闸）；llm/fetchEvents 缺席 = 周期腿
 * 缺席（即时提取仍通）；ftsSearch/ftsMaintenance/notify 各自缺席各腿静默降级。
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
      // 即时提取（isSessionPolluted 与周期路共享同源追踪器——周期腿缺席时
      // 无污染判定源，提取不滤 = 保守多提取，不丢纠正信号）
      const extractor = createImmediateExtractor({
        dao,
        ...(cycle !== undefined ? { isSessionPolluted: (id) => cycle.pollution.isPolluted(id) } : {}),
        warn,
      });
      const cite = createCiteRecorder({ dao, warn });

      // session/event 三消费腿（03 §146——user/message→即时提取；assistant/
      // message→引用记录（件内自滤）；全事件→周期计数（件内自滤 turn/end +
      // tool/call）。surfaceOp 遮蔽指令不进消费面（surface 事件滤除）。
      // 观察者异常隔离双保险：dispatch.emit 监听器互隔离 + 发射侧 try/catch）
      const disposeHook = context.on('session/event', (data) => {
        const { sessionId, event } = data as { sessionId: string; event: SessionEvent };
        if (event.surfaceOp !== undefined) return;
        if (event.type === 'user/message') {
          extractor.onUserMessage(sessionId, event.seq, event.data as ExtractableUserMessage);
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

      // memory/diff 词汇注册（不可逆装配面——发射位挂账后续批，注册先行）。
      // 注册表进程级单例（contracts/events 模块态）：同进程多次装配（测试多例
      // /热重启形）同 owner 已在场 = 幂等跳过；异 owner 在场则注册动词保持
      // 响亮冲突（HOST_EVENT_TYPE_CONFLICT 拒收语义不软化）
      if (getEventTypeMeta(MEMORY_DIFF_EVENT_META.type)?.owner !== MEMORY_DIFF_EVENT_META.owner) {
        context.events.registerSessionEventType(MEMORY_DIFF_EVENT_META);
      }

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
 * serve 长驻形起钟、诊断形/测试装载不起钟（未起跑的引擎全惰性：poke/排轮
 * 均守 running 位；manual fireNow 直通不依赖钟——run 入口批接线）。挂账
 * run 入口批同笔：GateFacts 宿主三源收集接线、cron 乙案后端 CLI 旗标编舞、
 * 真 bin 出厂（runner spawn 缺省 PATH 解析——bin 缺席诚实归 spawn_failed）。
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
      const { service, dao, goalJobs } = createSchedulerService({ db, now, warn });
      const engine = createSchedulerEngine({
        dao,
        // 真 bin spawn 接线：子进程 env 走 exec 白名单基座（deny-by-default
        // 同律——PATH/locale 最小集，零宿主环境继承）
        runner: createProcessRunnerFactory({ env: buildChildEnv() }),
        now,
        warn,
        ...(deps.schedulerGateFacts !== undefined ? { gateFacts: deps.schedulerGateFacts } : {}),
      });

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

      return () => {
        disposeTick();
      };
    },
  };
}

/**
 * core: 官方件注册表工厂（assembly.ts 缺省注入源——`options.corePlugins ??
 * createCorePlugins(deps)`；测试注入面/诊断命令经 options 覆盖）。
 * deps 聚落律（07 §7.4 #1）：宿主真身需求逐笔入 CorePluginHostDeps
 * （dataDir 首位——批 19b-1；memory 数据面六位——批 19b-2；subagent
 * 委派面两位——批 19c-1；调度闸事实位——批 19c-2；store/exec 管道跨件
 * 复用等后续件随批扩展）。
 */
export function createCorePlugins(deps: CorePluginHostDeps): readonly CorePluginReference[] {
  return [
    execPlugin,
    webPlugin,
    makeSkillsPlugin(deps),
    makeMemoryPlugin(deps),
    makeSubagentPlugin(deps),
    makeSchedulerPlugin(deps),
  ];
}
