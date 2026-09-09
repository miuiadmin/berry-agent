/**
 * host/plugin-boot — 插件装载装配序（03 §5.3/§5.4/§5.7/§2.4 生命周期组；批 12f-2b）。
 *
 * 职责链（11 步序——读侧三源 → 合成 → 装载 → 收口）：
 *  ① enabled.yaml 读侧（§5.3）：缺席 = 全 core: 内置态（首启零文件零负担）；
 *     损坏 = **fail-loud 拒启给修复指引**（yaml 解析错/行校验败 → PLUGIN_ROW_INVALID
 *     抛——与装机账本 warn 降级分立两律）；memory 形无数据目录同缺席语义。
 *  ② core: 内置全启 + 用户行覆盖（§5.3）：core 注册表成员全进计划；用户行
 *     core: 同名行字段级后写胜出（config/disabled——config 整值替换非合并）。
 *  ③ 装机账本读侧（§5.4）：损坏 = warn 点名 + 空账本降级（不 brick）；
 *     条目 `installPath` 解析磁盘行装机目录（绝对直用/相对 join 数据目录）。
 *  ④ 磁盘行合成（§5.4 boot 读侧消费）：package.json 过清单校验
 *     （parseManifest official:false）成装载计划行；账本缺席/目录不可读/
 *     清单坏形 = 行级隔离降级（§5.7 档②——失败面 + boot-failures 记账）。
 *  ⑤ 钩子词汇预注册（§2.4 主表 41 词镜像——已注册词过滤幂等；与 open 域
 *     工具词集无交叠，共存安全）。
 *  ⑥ ServiceBag 接共享根作用域（§2.2 provide 表行——跨插件可见面；get 走
 *     tryGet——Kahn 轮次可用性判定；'secrets' fork 级席位以标记位应答，c-3）。
 *  ⑦ 逐插件 ctx 装配（12f-2a 件）：per-plugin fork（effect 回卷隔离）+
 *     createPluginContext + secrets 面自域绑定（c-3——03 §2.2 第十面，
 *     core:credentials 席在场且 store 注入时 fork.provide）+ sessions-
 *     control（e4-3）/compaction（U4-3）两席位 fork 绑定；
 *     onApplySettled → closeWindow（行收口即关窗）。
 *  ⑧ loadPlugins 接线：onBootFailure → recordBootFailure 记账、activated →
 *     clearBootFailure 清名（横幅只报仍坏行）；memory 形诊断面整跳。
 *  ⑨ closer 'plugin-unload'：report.unload()（apply disposer LIFO）后 fork
 *     作用域逆序 dispose（ctx.effect 回卷）——注册序在 conversation 栈之后 =
 *     插件卸载晚于对话栈拆解（drain 序即注册序）；Job 归属围栏收口腿（Job
 *     消费面批桥二）夹在两序间——activated 逐插件 closeOwner（04 §10 定形）。
 *  ⑩ --no-plugins 短路（07 §六/§5.7）：装载面整跳——core: 与用户行都不装，
 *     空报告/零计数/不注册 closer/不发生命周期事件；注册表仍交空形（消费面稳定）。
 *  ⑪ 生命周期事件（§2.4 生命周期组）：装载收口**批量补发**（report 迭代发
 *     plugin/activated·failed·skipped + composition/reloaded 三清单载荷）——
 *     逐行时点发射位装载器未开（挂账 /reload 批）；合成失败行并入 failed 面。
 *
 * 挂账注记：boot 级工具注册表无 pipeline（driver 工具面合流腿随 agent 批）；
 * promptSections 消费腿（systemPrompt 装配位）随 conversation 装配批接线。
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { BaseError } from '../contracts/index.js';
import type { HostFace } from '../contracts/index.js';
// internal 桶机制符号深导（02 §4.3 #2 深挖面册首条——API 治理批 2 分桶：
// 机制符号非插件 API 不进公开根，内核消费全深导 contracts/api.js）
import { materializeHostFace } from '../contracts/api.js';
import { EventDispatch } from '../context/index.js';
import type { Scope } from '../context/index.js';
import { createToolRegistry } from '../tools/index.js';
import type { ToolRegistry } from '../tools/index.js';
import type { LlmRuntime } from '../llm/index.js';
import { createEnvRefResolver, createSecretsFace } from '../credentials/index.js';
import type { SecretsFaceOptions } from '../credentials/index.js';
import type { OAuthFlowRegistry } from '../credentials/index.js';
// 跨会话操控受理器（e4-3——sessions-control fork 绑定；host→conversation 边在册）
import { bindControlForPlugin, SESSIONS_CONTROL_SERVICE } from '../conversation/index.js';
import type { SessionsControlFace } from '../conversation/index.js';
// 压缩席位容器（U4-3——compaction fork 绑定；host→compaction 边在册）
import type { CompactionSlotsHandle } from '../compaction/index.js';
// 审计流面 + 装载史世代面类型（U3 批 U3-5 / 装载史批 h-3——05 §9 两宿主域表
// 载体真身；host→persist 边在册）
import type { AuditFace, LoadHistoryFace } from '../persist/index.js';
// Job 收口窄面类型（Job 消费面批桥二——插件卸载归属围栏收口；host→subagent 边在册）
import type { JobRegistry } from '../subagent/index.js';

import { clearBootFailure, recordBootFailure } from './boot-failures.js';
import type { CorePluginReference, FailedPlugin, LoaderPlanRow, LoadReport, ServiceBag } from './loader.js';
import { loadPlugins } from './loader.js';
import type { DiskPluginSpec } from './loader.js';
import { enabledYamlPath, parseEnabledRows, parseManifest } from './manifest.js';
import type { EnabledRow } from './manifest.js';
import { PLUGIN_HOOK_VOCABULARY, createPluginContext } from './plugin-context.js';
import type {
  CommandRegistryLike,
  PluginContextHandle,
  PluginToolLedger,
  SubagentRegistryLike,
  TriggerRegistryLike,
  UiBackendRegistryLike,
} from './plugin-context.js';
import { PromptSectionRegistry } from './prompt-sections.js';
import type { HostRuntime } from './runtime.js';

/**
 * fs 注入面（enabled.yaml/装机账本/package.json/boot-failures 四读侧 + 记账
 * 写侧统一注入——测试注内存 Map；缺省真盘）。
 */
export interface PluginBootFs {
  /** 读文本（缺席 = null——ENOENT 同义） */
  readonly read: (path: string) => string | null;
  readonly write: (path: string, text: string) => void;
}

/**
 * 'secrets' 席位可满足标记（c-3）：ServiceBag Kahn 可满足判专用占位——
 * secrets 真身是 fork 级逐插件绑定（createContext 落绑定），共享根结构性
 * 无此名，标记位使 inject: ['secrets'] 声明可解。恒真值非 undefined 即可，
 * 结构性不出装载器（插件消费面只见 fork 绑定真身）。
 */
const SECRETS_SEAT_MARKER = { seat: 'secrets' } as const;

/**
 * 'sessions-control' 席位可满足标记（e4-3）：与 SECRETS_SEAT_MARKER 同构——
 * 受理器真身是 fork 级逐插件绑定（caller 闭包铸归因），共享根结构性无此名，
 * 标记位使 inject: ['sessions-control'] 声明可解。
 */
const SESSIONS_CONTROL_SEAT_MARKER = { seat: 'sessions-control' } as const;

/**
 * 'compaction' 席位可满足标记（U4-3——03 §2.2 第十二面）：与 SECRETS_SEAT_
 * MARKER 同构——压缩策略面真身是 fork 级逐插件绑定（席位执法/窗口真源绑本
 * 插件 handle），共享根结构性无此名，标记位使 inject: ['compaction'] 声明
 * 可解。
 */
const COMPACTION_SEAT_MARKER = { seat: 'compaction' } as const;

/** 缺省真盘实现（读失败一律 null——文件缺席语义）；导出 = /reload 预检装配位复用（单源） */
export function defaultFs(): PluginBootFs {
  return {
    read: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    write: (path, text) => writeFileSync(path, text),
  };
}

/**
 * per-plugin 工具名账工厂（装载史批 h-3——05 §9 世代行 activated 成员
 * tools 列真值源）：bootPlugins 每周期新实例（/reload 换代即新账不串代）。
 * toolsOf = 收口时点在册集快照（世代行落笔即冻结——历史代不受后续回卷影响）。
 */
export function createPluginToolLedger(): PluginToolLedger & { toolsOf(pluginId: string): readonly string[] } {
  const account = new Map<string, Set<string>>();
  return {
    add: (pluginId, toolName) => {
      let names = account.get(pluginId);
      if (names === undefined) {
        names = new Set();
        account.set(pluginId, names);
      }
      names.add(toolName);
    },
    remove: (pluginId, toolName) => {
      account.get(pluginId)?.delete(toolName);
    },
    toolsOf: (pluginId) => [...(account.get(pluginId) ?? [])],
  };
}

/** 装配选项（TUI/serve 入口逐项注入——全部走公开面类型） */
export interface PluginBootOptions {
  readonly runtime: HostRuntime;
  /** 共享根作用域（与对话栈同根——服务面跨插件可见，§2.2 provide 表行） */
  readonly scope: Scope;
  /** 事件总线（与对话栈同源——钩子词汇预注册 + 生命周期组发射） */
  readonly dispatch: EventDispatch;
  /** 命令注册表（受局面注入——缺省通道核 commands） */
  readonly commands: CommandRegistryLike;
  /** llm 运行时（provider 注册面——对话栈出口防双实例） */
  readonly llm: Pick<LlmRuntime, 'registerProvider'>;
  /**
   * 触发器注册表（受局面注入——C 批 C-2 接线；starter 真身随 C-3 装配批由
   * 入口创建注入。缺席 = ctx.triggers.register 抛 CONTEXT_SERVICE_MISSING）
   */
  readonly triggers?: TriggerRegistryLike;
  /**
   * 子代理注册面（受局面注入——D 批 D-2 接线：SubagentService 程序化腿。
   * 缺席 = ctx.agent.registerSubagentProvider 抛 CONTEXT_SERVICE_MISSING）
   */
  readonly subagents?: SubagentRegistryLike;
  /**
   * 界面后端注册面受局面（U3 批 U3-4——ChannelsService 插件域腿）：ctx.
   * channels.registerUiBackend 的委派目标（门检 channels.ui-backend 前置在
   * 动词内执法）。缺席 = 该动词响亮 CONTEXT_SERVICE_MISSING。
   */
  readonly uiBackends?: UiBackendRegistryLike;
  /**
   * 会话血缘判定面（e2-4——04 §6 订阅 tree 档过滤受局面）：真身 = 装配根
   * 注入 SessionView.isSameTree（05 §9 parent_id 链单源）。在场时透传
   * createPluginContext 的 sessionLineage 位；缺席 = tree 档订阅响亮
   * CONTEXT_SERVICE_MISSING（self/all 档不消费本面——诚实缺席律）。
   */
  readonly sessionLineage?: { isSameTree(a: string, b: string): boolean };
  /**
   * 进程级审计流面（U3 批 U3-5——05 §9 audit_events 载体真身，persist
   * AuditFace）：装载序两用——① 逐插件 auditSink 透传（append 窄面结构
   * 兼容——高危面动词 capability/used 落账）；② boot 序 plugin/opens 幂等
   * diff（读写两用）。单写者 = 宿主装配根（audit 流单写者律）。缺席 = 两腿
   * 静默缺席不阻拦（:memory: 诊断形/测试替身——诚实缺席律）。
   */
  readonly audit?: AuditFace;
  /**
   * 装载史世代面（装载史批 h-3——05 §9 load_generations 写点）：boot 完成
   * 尾落一行世代快照（三分区全录 + activated 成员携本代 tools 名账）；
   * /reload reapply 重跑本函数 = 同点覆盖（换代 = 前代 ended_at 回填同刻 +
   * 新行——boot 与 reload 双点单写点同源）。单写者 = 宿主装配根。缺席 =
   * 不落行不阻拦（:memory: 诊断形/测试替身——诚实缺席律，audit 同律）；
   * 装载失败（装载管线抛错）到不了写点 = 不落行不换代（05 §9 边沿定形）。
   */
  readonly loadHistory?: LoadHistoryFace;
  /**
   * Job 收口面（受局面注入——Job 消费面批桥二：04 §10 归属围栏 owner =
   * 插件 id 的卸载收口腿）。卸载 closer 序对 activated 逐插件 closeOwner
   * （先协作中止路由再兜底 killed——run 不留孤儿烧钱）。缺席 = 诚实缺位
   * 不收口（测试替身形/:memory: 诊断形——Job 注册表本进程内语义）。
   */
  readonly jobs?: Pick<JobRegistry, 'closeOwner'>;
  /**
   * 插件凭证面装配位（c-3——03 §2.2 第十面/§10.9 读腿）：store 在场且
   * core:credentials 件席在场（计划行未禁用）时，装载序逐插件 fork 绑定
   * 'secrets' 自域版（ctx.get("secrets") 消费面——服务闭包携 pluginId 防
   * 冒名）。开门集/受理窗由本件接线 handle 真源（grantedOpens/
   * inHostCallback）；两审计 seam 缺省 no-op（audit_events 载体挂账 U3-2）。
   * 缺席 = secrets 面整体不提供（ctx.get 响亮 CONTEXT_SERVICE_MISSING——
   * 诚实缺席律：测试替身形/:memory: 诊断形）。
   */
  readonly secrets?: Pick<SecretsFaceOptions, 'store' | 'onCapabilityUsed' | 'onCredentialChanged'> & {
    /**
     * oauth 流注册表（c-6——03 §10.9 oauth 案）：assembly 单真身（与人面
     * 动词/刷新链共用同表）。在场且 secrets 席在场时，装载序逐插件 fork 绑
     * 完整 oauth 受局面（开窗器/装载窗判定绑本插件 handle 真源——
     * enterHostCallback/inLoadWindow）。缺席 = registerOAuthFlow 响亮缺位拒。
     */
    readonly oauthRegistry?: OAuthFlowRegistry;
  };
  /**
   * 跨会话操控受理器真身（e4-3——03 §2.2 第十一面 sessions-control 服务
   * 面）：在场时装载序逐插件 fork 绑定（bindControlForPlugin 铸 caller
   * {kind:'plugin', pluginId} 闭包——归因单源，传入面无 caller 位）。缺席 =
   * ctx.get("sessions-control") 响亮 CONTEXT_SERVICE_MISSING（诚实缺席律：
   * 测试替身形/:memory: 诊断形）。
   */
  readonly sessionsControl?: SessionsControlFace;
  /**
   * 压缩席位容器（U4-3——03 §2.2 第十二面 compaction 服务面）：真身 =
   * conversation-stack 装配的 createCompactionSlots 单真身（stack.
   * compactionSlots）。在场时装载序逐插件 fork 绑定 bindForPlugin 产物
   * （ctx.get("compaction") 消费——两动词装载窗 only 严于通律，窗真源绑本
   * 插件 handle.inLoadWindow）；fork.effect 兜底卸载回收（动词 disposer 是
   * 手动面——双保险）。缺席 = ctx.get 响亮 CONTEXT_SERVICE_MISSING（诚实
   * 缺席律：测试替身形/:memory: 诊断形）。
   */
  readonly compaction?: CompactionSlotsHandle;
  /** core: 官方引用注册表（内置全启；缺省空——core 件随各件装配批入册） */
  readonly corePlugins?: readonly CorePluginReference[];
  /** 安全模式（--no-plugins——装载面整跳，07 §六） */
  readonly noPlugins?: boolean;
  /**
   * 卸载换代槽（/reload 批——03 §5.7 热重载换代执法位）：在场时本代卸载
   * 序不走 runtime closers 直注册，改写槽内 current（装配根一次性注册读
   * 槽 closer——shutdown 恒跑**最新代**回卷，reload 换代不累积重复
   * closer）。缺席 = 维持直注册现状（单次 boot 形——CLI/测试/诊断）。
   */
  readonly unloadRef?: { current: (() => Promise<PluginUnloadReceipt>) | null };
  /** 宿主版本（HostFace 物化位——main.readVersion 产物） */
  readonly version: string;
  /** API 面版本（缺省 '1.0'——package.json apiVersion 同步维护） */
  readonly apiVersion?: string;
  /** 警示面（缺省 stderr 直写） */
  readonly warn?: (message: string) => void;
  /** fs 注入（缺省真盘） */
  readonly fs?: PluginBootFs;
}

/**
 * 卸载回执形（LoadReport.unload 产物直通——disposed/failed 清单；/reload
 * 档③聚合报告数据源。failed 带 error 未知形——呈现层自截取 id 呈报）。
 */
export type PluginUnloadReceipt = {
  readonly disposed: readonly string[];
  readonly failed: readonly { id: string; error: unknown }[];
};

/** 披露段计数（pluginsProvider 接线位——runtime 装配时持有可变匣） */
export interface PluginBootCounts {
  readonly total: number;
  readonly enabled: number;
  readonly failed: number;
}

/** 装载装配产物（TUI 入口消费面） */
export interface PluginBootHandle {
  /** 装载报告（合成失败行已并入 failed 面；unload 含 fork 逆序 dispose） */
  readonly report: LoadReport;
  /** 披露段计数（counts 口径见 bootPlugins 注释） */
  readonly counts: PluginBootCounts;
  /** boot 级工具注册表（注册语义全执法；消费腿挂账 driver 工具面合流） */
  readonly tools: ToolRegistry;
  /** 提示词段注册表（消费腿挂账 systemPrompt 装配位） */
  readonly promptSections: PromptSectionRegistry;
}

/**
 * 插件装载主入口（async——装载管线内含 jiti ESM 求值）。
 *
 * counts 口径：total = 计划行数 + 合成失败行数；enabled = report.activated
 * 行数；failed = 合成失败 + report.failed 行数（skipped 行不入三数——禁用
 * 非失败非启用，披露段不虚报）。
 */
export async function bootPlugins(options: PluginBootOptions): Promise<PluginBootHandle> {
  const warn = options.warn ?? ((message) => process.stderr.write(`${message}\n`));
  const fs = options.fs ?? defaultFs();
  // boot 级注册表：两消费面（ctx 注册动词 + TUI 披露）同实例
  const tools = createToolRegistry(options.dispatch);
  const promptSections = new PromptSectionRegistry();
  const hostFace: HostFace = materializeHostFace({
    version: options.version,
    apiVersion: options.apiVersion ?? '1.0',
    capabilities: [],
    experimentalKeys: [],
  });

  // ⑩ 安全模式短路：装载面整跳；注册表仍交空形（消费面形态统一）
  if (options.noPlugins === true) {
    const emptyReport: LoadReport = {
      activated: [],
      failed: [],
      skipped: [],
      unload: async () => ({ disposed: [], failed: [] }),
    };
    // 世代快照照落（05 §9 边沿定形——世代存在且为空：--no-plugins 安全模式
    // 也是一次真实装载形态）；face 缺席 = 诊断形不落行（诚实缺席律）
    options.loadHistory?.recordLoadGeneration({ activated: [], skipped: [], failed: [] });
    return { report: emptyReport, counts: { total: 0, enabled: 0, failed: 0 }, tools, promptSections };
  }

  // ⑤ 钩子词汇预注册（03 §2.4 主表镜像——一词两册装配序律：预注册在前，
  // 各装配面〔open-tools/sessions〕自举注册幂等跳过已注册词；已注册词过滤幂等）
  const hookWords = PLUGIN_HOOK_VOCABULARY.map((h) => h.name).filter((name) => !options.dispatch.isRegistered(name));
  options.dispatch.registerEventNames(hookWords);

  // ① enabled.yaml 读侧（损坏 fail-loud——两律分立在件头注释）
  const rows = readEnabledRows(options.runtime.dataDir, fs);

  // ③ 装机账本读侧（损坏 warn 降级——与启用清单 fail-loud 分立）
  const ledger = readLedger(options.runtime.dataDir, fs, warn);

  // ②④ 计划合成（core 内置全启 + overlay + 磁盘行账本解析）
  const { plan, synthesisFailures } = synthesizePlan({
    rows,
    corePlugins: options.corePlugins ?? [],
    dataDir: options.runtime.dataDir,
    ledger,
    fs,
  });

  // ⑧ 记账路径（memory 形无数据目录——诊断面整跳）
  const bookkeepingPath = options.runtime.dataDir === null ? null : join(options.runtime.dataDir, 'boot-failures.json');
  const bookkeepingFs = toBootFailuresFs(fs);
  // 合成失败行：档②语义记账（装载未达——warn 横幅与 boot-failures 皆见）
  for (const failure of synthesisFailures) {
    warn(`插件装载失败（${failure.id}）：[${failure.code}] ${failure.message}`);
    if (bookkeepingPath !== null) recordBootFailure(bookkeepingPath, failure.id, '', bookkeepingFs);
  }

  // ⑥⑦ ctx 装配族：ServiceBag 接共享根 + 逐插件 fork + 行收口关窗
  const handles = new Map<string, PluginContextHandle>();
  const pluginScopes: Scope[] = []; // 激活序入栈——closer 逆序 dispose
  // core:credentials 件席在场判（c-3——03 §10.9 禁用语义：enabled.yaml 禁
  // core:credentials ⇒ plan 行 disabled ⇒ secrets 面整体缺席诚实缺席律；
  // plan 含禁用行〔loadPlugins 前置过滤〕，判 !row.disabled）
  const secretsWiring = options.secrets;
  const secretsSeatActive =
    secretsWiring !== undefined && plan.some((row) => row.id === 'core:credentials' && !row.disabled);
  // 注入腿席位接线（c-4——03 §10.9 注入腿）：与 ctx.secrets 席位门**同一双
  // 条件**（secrets 注入在场 × plan 行 core:credentials 未禁）⇒ 共享根供
  // 'credentials-env-ref' 展开器——exec 件 apply 期拾取进 spawn 管道（本
  // provide 先于 loadPlugins 全程，装载序无关）。缺席 ⇒ 服务缺席 ⇒ env
  // 引用形 fail-loud（exec 侧拒以字面值注入——单一名册语义：件在 = 凭证
  // 代管全腿在场，件去 = 全腿缺席，无半开态）
  if (secretsWiring !== undefined && secretsSeatActive) {
    options.scope.provide('credentials-env-ref', createEnvRefResolver(secretsWiring.store));
  }
  // 操控受理器席位判（e4-3——host 内建机制非 core 件，无件席门：在场即绑）
  const controlSeatActive = options.sessionsControl !== undefined;
  // 压缩席位容器判（U4-3——host 内建机制非 core 件，无件席门：在场即绑）
  const compactionSeatActive = options.compaction !== undefined;
  const services: ServiceBag = {
    get: (name) =>
      // 'secrets' 是 fork 级逐插件绑定面（本插件独见——createContext 落真身
      // 绑定），共享根结构性无此名。Kahn 可满足判以标记位应答：声明
      // inject: ['secrets'] 的磁盘行合法可解（服务自装载前即在场）。
      // 标记不外泄——ServiceBag 装载器私有，插件消费面走 fork 绑定真身。
      name === 'secrets' && secretsSeatActive
        ? SECRETS_SEAT_MARKER
        : name === SESSIONS_CONTROL_SERVICE && controlSeatActive
          ? SESSIONS_CONTROL_SEAT_MARKER
          : name === 'compaction' && compactionSeatActive
            ? COMPACTION_SEAT_MARKER
            : options.scope.tryGet(name),
    provide: (name, value) => options.scope.provide(name, value),
  };
  // per-plugin 工具名账（装载史批 h-3——05 §9 世代行 tools 列真值源）：本
  // boot 周期单实例，createContext 逐插件透传（ctx.tools.register 包壳层记
  // 账——注册成功入账、disposer 出账）；/reload reapply 重跑本函数 = 换代
  // 即新账，旧代 disposer 回卷只动旧代账（世代行已快照落笔，无害）
  const toolLedger = createPluginToolLedger();
  const createContext = (pluginId: string, opens?: readonly string[]) => {
    const fork = options.scope.fork();
    pluginScopes.push(fork);
    const handle = createPluginContext({
      pluginId,
      scope: fork,
      dispatch: options.dispatch,
      tools,
      // 工具名账透传（h-3——register 包壳层记账；缺席（本面不存在缺位）只
      // 发生在 createPluginContext 直测形，bootPlugins 恒注）
      toolLedger,
      commands: options.commands,
      llm: options.llm,
      promptSections,
      provide: services.provide, // ctx.provide 委派共享根（§2.2 表行——跨插件可见）
      hostFace,
      // 触发器注册表受局面透传（C 批 C-2——缺席时 ctx.triggers.register 响亮缺位）
      ...(options.triggers !== undefined ? { triggers: options.triggers } : {}),
      // 子代理注册面受局面透传（D 批 D-2——缺席时 ctx.agent.registerSubagentProvider 响亮缺位）
      ...(options.subagents !== undefined ? { subagents: options.subagents } : {}),
      // 界面后端注册面受局面透传（U3 批 U3-4——缺席时 ctx.channels.registerUiBackend 响亮缺位）
      ...(options.uiBackends !== undefined ? { uiBackends: options.uiBackends } : {}),
      // 会话血缘判定面透传（e2-4——缺席时 ctx.events.subscribeSessionLifecycle
      // tree 档响亮缺位；self/all 档不消费）
      ...(options.sessionLineage !== undefined ? { sessionLineage: options.sessionLineage } : {}),
      // 审计流写入位透传（U3 批 U3-5——AuditFace append 窄面结构兼容 auditSink）
      ...(options.audit !== undefined ? { auditSink: options.audit } : {}),
      // 高危面开门授予集（03 §4.6 批 U2——磁盘行 opens 经 loader 透传至此）
      ...(opens !== undefined ? { opens } : {}),
      onHookTimeout: (id, hookName, err) =>
        warn(`插件 ${id} 钩子 ${hookName} 超时：${err instanceof Error ? err.message : String(err)}`),
    });
    // secrets 面绑定（c-3——03 §2.2 第十面）：fork 级提供 = 本插件独见（共享
    // 根单槽容不下逐插件身份绑定——fork 遮蔽合法）。getOpens/inWriteWindow
    // 晚绑 handle 真源（装载代内授予面快照 / 回调窗深度计数）
    if (secretsSeatActive) {
      // oauth 受局面合流（c-6）：注册表来自 assembly（共享单真身），窗两源
      // 绑本插件 handle（enterHostCallback 开窗器 + inLoadWindow 装载窗判定）
      // ——registerOAuthFlow 的装载窗执法与 invoke 的回调窗包裹由此成完整形
      const { oauthRegistry, ...restWiring } = secretsWiring;
      fork.provide(
        'secrets',
        createSecretsFace({
          ...restWiring,
          pluginId,
          getOpens: () => handle.grantedOpens,
          inWriteWindow: () => handle.inHostCallback,
          ...(oauthRegistry !== undefined
            ? {
                oauth: {
                  registry: oauthRegistry,
                  openWriteWindow: () => handle.enterHostCallback(),
                  inLoadWindow: () => handle.inLoadWindow,
                },
              }
            : {}),
        }),
      );
    }
    // sessions-control 面绑定（e4-3——03 §2.2 第十一面）：fork 级提供 =
    // 本插件独见（caller 归因闭包铸造防冒名——传入面无 caller 位，覆写
    // 单源）。缺席 = ctx.get 响亮 CONTEXT_SERVICE_MISSING（诚实缺席律）
    if (controlSeatActive) {
      fork.provide(SESSIONS_CONTROL_SERVICE, bindControlForPlugin(pluginId, options.sessionsControl));
    }
    // compaction 面绑定（U4-3——03 §2.2 第十二面）：fork 级提供 = 本插件
    // 独见（席位执法在 slots 容器——两动词装载窗 only 严于通律，窗真源绑
    // 本插件 handle.inLoadWindow 晚绑真源）；fork.effect 兜底卸载回收
    // （动词 disposer 是手动面——双保险；effect 回卷随 fork dispose 序，
    // 晚于插件 apply disposer 的 LIFO 回卷）
    if (compactionSeatActive) {
      fork.provide(
        'compaction',
        options.compaction.bindForPlugin({ pluginId, inLoadWindow: () => handle.inLoadWindow }),
      );
      const slots = options.compaction;
      fork.effect(() => () => slots.releaseFor(pluginId));
    }
    handles.set(pluginId, handle);
    return handle.ctx;
  };

  const loaded = await loadPlugins({
    plan,
    services,
    createContext,
    warn,
    onApplySettled: (pluginId) => handles.get(pluginId)?.closeWindow(), // 行收口即关窗（finally 语义）
    ...(bookkeepingPath === null
      ? {}
      : {
          onBootFailure: (id: string, version: string) =>
            recordBootFailure(bookkeepingPath, id, version, bookkeepingFs),
        }),
  });
  // 装载成功行清名（横幅只报仍坏行——报捷即抹账）
  if (bookkeepingPath !== null) {
    for (const a of loaded.activated) clearBootFailure(bookkeepingPath, a.id, bookkeepingFs);
  }

  // —— plugin/opens 幂等落（05 §1.1 开门/关门审计腿——U3 批 U3-5）：boot
  // 装载序以计划面磁盘行授予面 diff 审计流尾条，有变才落（撤位空数组形收
  // 口——开门/关门全链可对账）；audit 面缺席 = 诊断形不落账（诚实缺席律）
  if (options.audit !== undefined) {
    recordPluginOpensDiff(
      options.audit,
      plan.flatMap((row) => (row.kind === 'disk' ? [{ id: row.id, opens: row.opens ?? [] }] : [])),
    );
    // —— 生命周期五词 boot diff 补播（05 §1.1 生命周期归因面行——audit 落账
    // 批写点②）：手编 enabled.yaml 漂移检测——「用户手改文件」与「用户按
    // 命令」同链可审计；对审计流尾最近态 diff、有变才落（幂等同律）。本账
    // 含 core: 行（mount/unmount/toggle 对 core: 是合法 overlay 动作——与
    // opens diff 排除 core: 分立）
    recordPluginLifecycleDiff(
      options.audit,
      plan.map((row) => ({ id: row.id, disabled: row.disabled === true })),
    );
  }

  // ⑪ 生命周期事件批量补发（合成失败行并入 failed 面——收口一致真相）
  const failedAll: readonly FailedPlugin[] = [...synthesisFailures, ...loaded.failed];
  for (const a of loaded.activated) await options.dispatch.emit('plugin/activated', { id: a.id });
  for (const f of failedAll) await options.dispatch.emit('plugin/failed', { id: f.id, code: f.code });
  for (const s of loaded.skipped) await options.dispatch.emit('plugin/skipped', { id: s.id, reason: s.reason });
  await options.dispatch.emit('composition/reloaded', {
    activated: loaded.activated.map((a) => a.id),
    failed: failedAll.map((f) => f.id),
    skipped: loaded.skipped.map((s) => s.id),
  });

  // ⑨ closer：apply disposer LIFO 后 fork 逆序 dispose（drain 序 = 注册序）；
  //    Job 归属围栏收口腿（Job 消费面批桥二）在 disposer 回卷后对 activated
  //    逐插件 closeOwner——插件侧事件源先停（不再新 fire），余在飞 Job 两拍
  //    收口（协作中止路由 + 兜底 killed——04 §10 定形）。
  //    换代槽双形态（/reload 批）：unloadRef 在场改写槽（shutdown 恒跑最新代，
  //    reload 换代不累积重复 closer）；缺席维持直注册（单次 boot 形）。
  const unloadAll = async (): Promise<PluginUnloadReceipt> => {
    const receipt = await loaded.unload();
    if (options.jobs !== undefined) {
      for (const a of loaded.activated) await options.jobs.closeOwner(a.id);
    }
    for (const fork of pluginScopes.reverse()) await fork.dispose(); // ctx.effect 回卷
    return receipt; // 回卷回执（/reload 档③聚合报告数据源——换代槽消费）
  };
  if (options.unloadRef !== undefined) {
    options.unloadRef.current = unloadAll;
  } else {
    // 直注册形回执丢弃（HostCloser 契约 void 形——单次 boot 无消费面）
    options.runtime.registerCloser({ label: 'plugin-unload', fn: async () => void (await unloadAll()) });
  }

  // failed 面合并后交付（单真相——消费方不见两源）
  const report: LoadReport = { ...loaded, failed: failedAll };

  // —— 世代快照落账（装载史批 h-3——05 §9 写点）：boot 完成点 = 世代生效
  // 点（/reload reapply 重跑本函数 = 同点双覆盖——boot 与 reload 换代单写
  // 点同源）；三分区全录、判据恒 activated；tools 名账 = 本代 register
  // 包壳层收口时点在册集（disposer 出账不留残影）。写失败 fail-loud 拒启
  // （世代账静默缺失比 boot 失败更糟——与开库失败同档）；装载失败到不了
  // 本点 = 不落行不换代（05 §9 边沿定形）。face 缺席 = 诊断形不落行
  if (options.loadHistory !== undefined) {
    options.loadHistory.recordLoadGeneration({
      activated: report.activated.map((a) => ({ id: a.id, tools: toolLedger.toolsOf(a.id) })),
      skipped: report.skipped.map((s) => ({ id: s.id, reason: s.reason })),
      failed: report.failed.map((f) => ({ id: f.id, code: f.code })),
    });
  }
  return {
    report,
    counts: {
      total: plan.length + synthesisFailures.length,
      enabled: loaded.activated.length,
      failed: failedAll.length,
    },
    tools,
    promptSections,
  };
}

/**
 * boot 序 plugin/opens 幂等落（05 §1.1 开门/关门审计腿——U3 批 U3-5）：
 * 以计划面磁盘行 opens 为当前授予面，与审计流尾最近一条本词（per 插件——
 * fold = 尾条 = 该插件当前有效授予面）diff，**有变才落**（幂等不重复记账）；
 * 曾记账而今不在计划面（行删除/换装新 id）= 撤位，落 `opens: []` 空数组形
 * 收口。core: 行结构性无 opens（03 §5.3），不进本账。单写者 = 装配根装载
 * 序（audit 流单写者律——插件面零写入位）。
 *
 * 集合语义比对（排序后逐位）——enabled.yaml 行序漂移不触发假记账。空面
 * 首记不落：无记录 ≡ 空面（fold 语义一致），`[]` 笔恒为撤位收口形而非首记
 * 基线（零授予零事实——不为从未开门的插件造基线噪声）。历史尾条只扫近期窗
 * （listRecent 帽 100）：审计流里本词只增不删且每变才落，稳态下在册插件数
 * << 帽；超帽的极端态 = 最旧撤位事实滑出窗口（收口笔不重放，尾条语义不受
 * 损——非 durable 损失面）。
 * @param audit 审计流面（读写两用——尾读建 per 插件最新态，diff 后落账）
 * @param rows 计划面磁盘行（含禁用行——授予面真源是 enabled.yaml 行本身）
 */
export function recordPluginOpensDiff(
  audit: AuditFace,
  rows: readonly { id: string; opens: readonly string[] }[],
): void {
  // 尾读 → per 插件最新授予面（listRecent id 降序——首见即最新）
  const latest = new Map<string, readonly string[]>();
  for (const row of audit.listRecent()) {
    if (row.type !== 'plugin/opens') continue;
    const pluginId = row.data['pluginId'];
    const opens = row.data['opens'];
    // 词形防御（值域已过 parseEnabledRows 行校验——此处只防库被手编）
    if (typeof pluginId !== 'string' || !Array.isArray(opens)) continue;
    if (!latest.has(pluginId)) {
      latest.set(pluginId, opens.filter((o): o is string => typeof o === 'string').sort());
    }
  }
  // 有变才落：当前面（去重排序——尾条形稳定）vs 尾条
  const current = new Map(rows.map((r) => [r.id, [...new Set(r.opens)].sort()]));
  for (const [pluginId, opens] of current) {
    const prev = latest.get(pluginId) ?? [];
    if (prev.length !== opens.length || opens.some((o, i) => prev[i] !== o)) {
      audit.append('plugin/opens', { pluginId, opens });
    }
  }
  // 撤位收口：曾记账而今不在计划面，且尾条非空（已空则幂等不再落）
  for (const [pluginId, prev] of latest) {
    if (!current.has(pluginId) && prev.length > 0) {
      audit.append('plugin/opens', { pluginId, opens: [] });
    }
  }
}

/**
 * 生命周期五词 boot diff 补播（05 §1.1 生命周期归因面行——audit 落账批
 * 写点②）：对计划面全行（含 core: 行）以审计流尾最近态 diff，有变才落。
 *
 * 「用户手改 enabled.yaml」与「用户按 CLI 命令」同链可审计——CLI 人面
 * 成功尾已落账（写点①），本补播只兜文件面漂移（手编/外部工具改行）；
 * 与 plugin/opens diff 同幂等律：稳态零落，重启不重放。
 *
 * 态域三值：enabled / disabled / absent——
 *  - 审计尾态 fold：listRecent（id 降序）per id 三词（mounted/unmounted/
 *    toggled）首见即最新：mounted→enabled、unmounted→absent、toggled→
 *    disabled 位判别（true|false 双态——审计词形独立于行形）；
 *  - 计划面现态：行在场按 disabled === true 判、行缺席 = absent；
 *  - **core: 基线态**：无记录的 id——core: 前缀按 enabled 算（内置全启，
 *    防首启全 core: 件落 mounted 噪声——与 opens diff「不为从未开门的
 *    插件造基线噪声」同哲学）；非 core 按未上场算。
 *
 * diff 五形（动作序列还原）：
 *  absent→enabled 落 mounted；absent→disabled 落 mounted + toggled{true}
 *  （手编一步到位 = 命令两步的序列等价）；enabled↔disabled 落 toggled
 *  双态；在场→absent 落 unmounted；一致零落。core: 件计划面缺席（宿主
 *  侧官件裁撤——结构性恒在计划面，缺席非用户动作）不落账防噪声。
 * @param audit 审计流面（读写两用——尾读建 per id 最近态，diff 后落账）
 * @param rows 计划面全行（含 core: 行——本账与 opens diff 排除 core: 分立）
 */
export function recordPluginLifecycleDiff(audit: AuditFace, rows: readonly { id: string; disabled: boolean }[]): void {
  // 尾读 → per id 三词最近态（首见即最新；坏形条目无视——同 opens diff 词形防御律）
  const latest = new Map<string, 'enabled' | 'disabled' | 'absent'>();
  for (const row of audit.listRecent()) {
    if (row.type !== 'plugin/mounted' && row.type !== 'plugin/unmounted' && row.type !== 'plugin/toggled') {
      continue;
    }
    const id = row.data['id'];
    if (typeof id !== 'string' || latest.has(id)) continue;
    if (row.type === 'plugin/unmounted') latest.set(id, 'absent');
    else if (row.type === 'plugin/mounted') latest.set(id, 'enabled');
    else {
      const disabled = row.data['disabled'];
      if (disabled !== true && disabled !== false) continue; // 坏形跳过（不建态）
      latest.set(id, disabled ? 'disabled' : 'enabled');
    }
  }
  // 计划面现态 + diff 落账（循环域 = 计划面 ∪ 尾态 id 集——两侧单边差都覆盖）
  const planState = new Map(rows.map((r) => [r.id, r.disabled ? ('disabled' as const) : ('enabled' as const)]));
  for (const id of new Set([...planState.keys(), ...latest.keys()])) {
    const auditState = latest.get(id) ?? (id.startsWith('core:') ? 'enabled' : 'absent');
    const current = planState.get(id);
    if (current === undefined) {
      if (!id.startsWith('core:') && auditState !== 'absent') {
        audit.append('plugin/unmounted', { id });
      }
      continue;
    }
    if (auditState === current) continue; // 一致零落（幂等）
    if (auditState === 'absent') {
      audit.append('plugin/mounted', { id });
      if (current === 'disabled') audit.append('plugin/toggled', { id, disabled: true });
    } else {
      audit.append('plugin/toggled', { id, disabled: current === 'disabled' });
    }
  }
}

/**
 * enabled.yaml 读侧（§5.3）。缺席 = 全 core: 内置态（含 memory 形——无数据
 * 目录同缺席语义）；损坏 = fail-loud 拒启给修复指引（删除文件即回内置态）。
 *
 * 导出消费位 = /reload 预检（03 §5.7 档①——plugin-reload preflight 真源）：
 * 同一函数先于回卷跑一遍，校验失败即拒换——预检与装载读侧恒一致（单源，
 * 结构性不存在「预检过装载拒」的第二判据）。
 */
export function readEnabledRows(dataDir: string | null, fs: PluginBootFs): readonly EnabledRow[] {
  if (dataDir === null) return [];
  const path = enabledYamlPath(dataDir);
  const text = fs.read(path);
  if (text === null) return []; // 缺席 = 全 core: 内置态
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (err) {
    throw new BaseError(
      'PLUGIN_ROW_INVALID',
      `启用清单损坏（${path}）：${err instanceof Error ? err.message : String(err)}——修复或删除该文件后重启（删除即回全 core: 内置态；03 §5.3 损坏 fail-loud）`,
      { cause: err },
    );
  }
  const result = parseEnabledRows(doc);
  if (!result.ok) {
    throw new BaseError(
      'PLUGIN_ROW_INVALID',
      `启用清单校验失败（${path}）：${result.message}——修复指引：顶层 { plugins: [{ id, config?, disabled?, opens? }] }；删除文件即回全 core: 内置态`,
    );
  }
  return result.rows;
}

/** 装机账本条目（读侧最小面——只消费 installPath；完整条目形归 §5.4 install 批） */
interface LedgerEntryLike {
  readonly installPath?: unknown;
}

/**
 * 装机账本读侧（§5.4 尾：损坏 = warn 点名 + 空账本降级——账本是装机面非
 * 真相源，残缺不拦启动）。容器形宽容两式：条目数组形〔示例形——条目自带
 * id 字段〕/ id 键映射形；写侧定形归 install 批。
 */
function readLedger(
  dataDir: string | null,
  fs: PluginBootFs,
  warn: (message: string) => void,
): Readonly<Record<string, LedgerEntryLike>> {
  if (dataDir === null) return {};
  const path = join(dataDir, 'plugins', 'ledger.json');
  const text = fs.read(path);
  if (text === null) return {};
  const degrade = (reason: string): Readonly<Record<string, LedgerEntryLike>> => {
    warn(`装机账本损坏（${path}）：${reason}——空账本降级（03 §5.4：warn 不 brick 装机面）`);
    return {};
  };
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    return degrade(`坏 JSON（${err instanceof Error ? err.message : String(err)}）`);
  }
  const out: Record<string, LedgerEntryLike> = {};
  if (Array.isArray(doc)) {
    for (const entry of doc) {
      if (typeof entry !== 'object' || entry === null || typeof (entry as { id?: unknown }).id !== 'string') {
        return degrade('数组条目形含非带 id 对象');
      }
      out[(entry as { id: string }).id] = entry as LedgerEntryLike;
    }
    return out;
  }
  if (typeof doc === 'object' && doc !== null) {
    for (const [id, entry] of Object.entries(doc as Record<string, unknown>)) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return degrade(`条目 ${id} 非对象`);
      }
      out[id] = entry as LedgerEntryLike;
    }
    return out;
  }
  return degrade('顶层非数组/对象');
}

/** 计划合成产物（plan 交装载管线；synthesisFailures = 档②行——装载未达） */
interface PlanSynthesis {
  readonly plan: readonly LoaderPlanRow[];
  readonly synthesisFailures: readonly FailedPlugin[];
}

/**
 * 计划合成（§5.3 合成纪律）：core 注册表全进计划（内置全启不占用户行）；
 * 用户行 core: 同名行字段级后写胜出；用户磁盘行走账本解析。core: 行无注册
 * 表成员 = 合成失败（引用了未编入件——版本不符提示）。
 */
function synthesizePlan(input: {
  readonly rows: readonly EnabledRow[];
  readonly corePlugins: readonly CorePluginReference[];
  readonly dataDir: string | null;
  readonly ledger: Readonly<Record<string, LedgerEntryLike>>;
  readonly fs: PluginBootFs;
}): PlanSynthesis {
  const plan: LoaderPlanRow[] = [];
  const synthesisFailures: FailedPlugin[] = [];
  const coreByName = new Map<string, CorePluginReference>();
  for (const ref of input.corePlugins) coreByName.set(`core:${ref.name}`, ref);
  const overlaid = new Set<string>(); // 用户行已覆盖的 core: 行 id

  // core: 内置全启（注册序即计划序）+ 用户行字段级 overlay
  for (const [id, ref] of coreByName) {
    const overlay = input.rows.find((row) => row.id === id);
    if (overlay === undefined) {
      plan.push({ kind: 'core', id, reference: ref });
      continue;
    }
    overlaid.add(id);
    // 字段级后写胜出（§5.3）：用户行省略的字段沿用内置值；config 整值替换非合并
    plan.push({
      kind: 'core',
      id,
      reference: ref,
      ...(overlay.config !== undefined ? { config: overlay.config } : {}),
      ...(overlay.disabled !== undefined ? { disabled: overlay.disabled } : {}),
    });
  }

  // 用户行：core: 未注册名拒；磁盘行走账本解析
  for (const row of input.rows) {
    if (overlaid.has(row.id)) continue; // 已并入 core overlay 腿
    if (row.id.startsWith('core:')) {
      synthesisFailures.push({
        id: row.id,
        code: 'PLUGIN_LOAD_FAILED',
        message: `官方件 ${row.id} 不在本构建 core: 注册表（版本不符或该件未编入）——移除该行或核对件名`,
      });
      continue;
    }
    const resolved = resolveDiskRow(row, input.dataDir, input.ledger, input.fs);
    if ('failure' in resolved) synthesisFailures.push(resolved.failure);
    else plan.push(resolved.spec);
  }
  return { plan, synthesisFailures };
}

/** 磁盘行解析产物（两态——成功入计划/失败进档②面） */
type DiskResolution = { readonly spec: DiskPluginSpec } | { readonly failure: FailedPlugin };

/**
 * 磁盘行账本解析（§5.4 boot 读侧消费）：installPath（绝对直用/相对 join
 * 数据目录）→ 装机目录 package.json 过清单校验（official:false）。三失败态
 * （账本缺席/目录不可读/清单坏形）皆行级隔离降级——码沿用 PLUGIN_LOAD_
 * FAILED/PLUGIN_SHAPE_INVALID 分流，新码语义挂账生命周期批。
 */
function resolveDiskRow(
  row: EnabledRow,
  dataDir: string | null,
  ledger: Readonly<Record<string, LedgerEntryLike>>,
  fs: PluginBootFs,
): DiskResolution {
  if (dataDir === null) {
    return {
      failure: {
        id: row.id,
        code: 'PLUGIN_LOAD_FAILED',
        message: 'memory 形无装机账本——用户磁盘行不可解析（:memory: 诊断同构只装 core:）',
      },
    };
  }
  const entry = ledger[row.id];
  if (entry === undefined) {
    return {
      failure: {
        id: row.id,
        code: 'PLUGIN_LOAD_FAILED',
        message: '装机账本无此 id（03 §5.4）——先 install 再启用，或从启用清单移除该行',
      },
    };
  }
  const rawPath = entry.installPath;
  if (typeof rawPath !== 'string' || rawPath.length === 0) {
    return {
      failure: {
        id: row.id,
        code: 'PLUGIN_LOAD_FAILED',
        message: '装机账本条目缺归一路径 installPath（03 §5.4）——账本坏形，重装修机可重建',
      },
    };
  }
  // 解析序：绝对直用（local 源表示）；相对 join 数据目录（npm/git 源表示）
  const pluginDir = isAbsolute(rawPath) ? rawPath : join(dataDir, rawPath);
  const pkgText = fs.read(join(pluginDir, 'package.json'));
  if (pkgText === null) {
    return {
      failure: {
        id: row.id,
        code: 'PLUGIN_LOAD_FAILED',
        message: `装机目录不可读（${pluginDir} 无 package.json）——重装可修复`,
      },
    };
  }
  let pkg: unknown;
  try {
    pkg = JSON.parse(pkgText);
  } catch (err) {
    return {
      failure: {
        id: row.id,
        code: 'PLUGIN_LOAD_FAILED',
        message: `装机目录 package.json 坏 JSON（${pluginDir}）：${err instanceof Error ? err.message : String(err)}`,
      },
    };
  }
  const manifestResult = parseManifest(pkg); // 用户插件缺省 official:false
  if (!manifestResult.ok) {
    return {
      failure: {
        id: row.id,
        code: 'PLUGIN_SHAPE_INVALID',
        message: `清单校验失败（${pluginDir}）：${manifestResult.message}`,
      },
    };
  }
  const spec: DiskPluginSpec = {
    kind: 'disk',
    id: row.id,
    manifest: manifestResult.manifest,
    pluginDir,
    ...(row.config !== undefined ? { config: row.config } : {}),
    ...(row.disabled !== undefined ? { disabled: row.disabled } : {}),
    // 开门授予位透传（批 U2 读侧——值域已过 parseEnabledRows 行校验，此处零复验）
    ...(row.opens !== undefined ? { opens: row.opens } : {}),
  };
  return { spec };
}

/** fs 面适配（PluginBootFs → BootFailuresFs——同构双方法直转） */
function toBootFailuresFs(fs: PluginBootFs): {
  read: (path: string) => string | null;
  write: (path: string, text: string) => void;
} {
  return { read: fs.read, write: fs.write };
}
