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
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { canonicalWorkspaceRoot, EventDispatch, Scope } from '../context/index.js';
import type { Disposer } from '../context/index.js';
import { createChannels } from '../channels/index.js';
import type { ChannelsService } from '../channels/index.js';
import type {
  AgentMessage,
  AgentTool,
  ApprovalAskRequest,
  StreamFn,
  ThinkingLevel,
  ToolDefinition,
  Usage,
} from '../contracts/index.js';
import { getMessageRoleDefinition, isStandardMessage } from '../contracts/index.js';
import {
  createCompactionService,
  createCompactionSlots,
  createCcrRetrieveTool,
  BEFORE_COMPACT_ATTRIB,
  DEFAULT_COMPACTION_CONFIG,
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
  foldCallLedger,
  foldSessionSandboxMode,
  foldSessionThinkingLevel,
  foldSessionUsage,
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
import { HOST_NAMESPACE } from '../credentials/index.js';
import type { AuthRefreshSeam } from '../conversation/types.js';
import type { AgentEvent } from '../agent/index.js';
import {
  classifyError,
  createLlmRuntime,
  builtinProviderIds,
  createLlmService,
  createStreamFn,
  diagnoseProviderFailure,
  InFlightTracker,
  resolveDefaultModelSpec,
  usageBucketsOf,
} from '../llm/index.js';
import type { LlmRuntime, LlmService, LlmUsageEventData, Provider } from '../llm/index.js';
import type { QueryEventsFilter, QueryEventsResult } from '../persist/index.js';
import { clampTitleText, createAttachmentStore, sessionDisplayTitleOf } from '../persist/index.js';
import type { AttachmentStore } from '../persist/index.js';
import { rehydrateImageRefsForLlm } from './attachment-intake.js';
import type { ApprovalPolicyMode, SandboxMode, ToolPolicyDraft, ToolPolicyEntry } from '../safety/index.js';
import { matchToolPolicy } from '../safety/index.js';
import { deriveMessages } from '../session/index.js';
import type { SessionLog } from '../session/index.js';
import type { WorktreeService } from '../tools/index.js';

import type { HostRuntime } from './runtime.js';
import type { HookDispatchGuardFace } from './hook-dispatch-guard.js';
import type { GoalFace } from './core-plugins.js';
import { TOOL_POLICY_BASENAME } from './tool-policy-store.js';
// /compact 回执文案与 end 载荷采数单源（B2 批 2——onManualQueuedSettled
// 排队兑现接线消费；命令腿本体在 host/compact-cmd.ts，assembly 装配位直引）
import { compactOutcomeText, lastCompactionEndFactsOf } from './compact-cmd.js';
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
  /**
   * 审批策略档（04 §9 两旋钮之二——ask/never；缺省不注入 = approval 服务
   * 内缺省 'ask'。装配根四层解析胜者注入：CLI --preset/旗标 > settings.json
   * > 代码常量；会话策略层在驱动面另有 override，不经本位）
   */
  readonly approvalPolicy?: ApprovalPolicyMode;
  /** 工作区锚取值器（缺省 canonicalWorkspaceRoot——git 根回退字面 cwd；批 12f-4 注入面与 sandboxMode 同形态，e2e 隔离位） */
  readonly workspace?: () => string;
  /**
   * worktree 服务面（04 §7 补钉① + 03 §10.7 六役定形注）：在场则每会话
   * open 域装配挂载 worktree 三工具 + fs fence 并入本会话授予根（live
   * callback——每次可写性检查现取 grantedRoots(sessionId)）。缺省缺席 =
   * 三工具诚实缺席、无授予并入（exec 服务面同律）。装配根应注入与 issue
   * 件共享的同一实例（授予记账单源——件侧编排授予与会话内工具消费同台账）。
   */
  readonly worktree?: WorktreeService;
  /** 系统提示词基线（04 §11：披露段由驱动在 transformContext 关口另行追加） */
  readonly systemPrompt?: string;
  /** 装载工具定义取值器（批 19a 消费腿：boot 全局层定义快照——每会话装配时调用；闭包晚绑定：装配根 stack 先建、boot 后跑，会话首开时 boot 已定型） */
  readonly bootTools?: () => readonly ToolDefinition[];
  /** 插件提示词段物化取值器（批 19a 消费腿：PromptSectionRegistry.materialize 的闭包——每请求组装时重取，注册即生效面；sessionId 参透传 builder〔cache 经济批 ca-2——每会话懒冻结类段〕；空串 = 零段） */
  readonly pluginSections?: (sessionId: string) => string;
  /**
   * 钩子派发段 guard 只读面（03 §3.4 执法——cache 经济批 ca-3：host 装配根
   * 全局 guard 的只读窄面注入 llm 双入口〔StreamFn + complete〕前置查，钩子
   * handler 执行段内模型调用拒 LLM_CALL_IN_HOOK；缺席 = 该执法缺席〔测试形〕
   * ——guard 真身与 enter/exit 开合在装配根/boot 侧，本件只穿只读面）
   */
  readonly hookDispatchGuard?: HookDispatchGuardFace;
  /**
   * 自定义渠道 id 集（2026-09-28 模型渠道批 C-3——07 §8.4 env 豁免裁决）：
   * 在集 id = settings customProviders 注册的自定义渠道——**env 键不合成不
   * 供血**（`${ID}_API_KEY` 合成判据对自定义渠道是假遮蔽/假 ready 源），绑定
   * 行是其唯一供血源。装配根从 settingsLoad 供键集（boot 快照）；向导路
   * 活注册经 {@link registerCustomProvider} 同步扩集（本会话即刻）。缺省
   * 缺席 = 零豁免（无自定义渠道的常形态，判据面零变）。
   */
  readonly customProviderIds?: readonly string[];
  /**
   * 宿主凭证刷新联动腿 seam 注入位（04 §3.3 条 8——B3 批）：形状单源 =
   * conversation/types AuthRefreshSeam（authFamily 判定 / refreshNow 强刷 /
   * notify 告警三面）。真值源三面（llm authFamily 导入、credentials 刷新链
   * refreshNow 桥接、产品级 notify 文案闭包）归装配根收口位组装成整面后
   * 注入——本栈**恒等透传**进 driver options（不复制不包装）；**缺席 =
   * 联动腿整体短路**（既有三腿行为零变——渐进增强零破口，与 seam JSDoc
   * 缺席语义同源）。
   */
  readonly authRefresh?: AuthRefreshSeam;
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
   * 预算预警取值器（04 §5 软着陆层——遗漏审计批 H + 2026-09-13 修复批）：
   * root/subagent 分族文案铸造归装配根（origin 判据 + backgroundLane run 级
   * 后台性声明位 + llm 后台池投影——host/budget-advisory 纯函数族）；驱动每
   * 请求组装时经 onTransformContext 取用注入瞬态层（携当前 run 车道）。
   * per-session 位在穿线时 sessionId 落格绑定（goalDeposit 同形）。
   * 缺席/返回 null = 零注入（前台 run 无池可警同形）。
   */
  readonly budgetAdvisory?: (sessionId: string, backgroundLane: boolean) => string | null;
  /**
   * run 结算回执钩（批 #99——goal 前台记账腿三入口统一）：驱动 launch settled
   * 链内嵌发射（assistant/message 窗扫计数 + userInitiated 归因——04 §176
   * 记账单位），组合根闭包接 recordTurn；钩内异常驱动侧自防炸（warn 不炸收场）。
   */
  readonly onRunSettled?: (sessionId: string, receipt: RunSettledReceipt) => void;
  /** 跨会话工具策略表条目（04 §9 粘性第 3 款 + 审批分档批双面；装配层读 tool-policy.json 载入——缺省功能关闭） */
  readonly toolPolicy?: readonly ToolPolicyEntry[];
  /** 「始终允许」条目写入回调（04 §9 粘性段定形③——装配层接 tool-policy-store 文件写，只产 allow 条目；缺省 always 面关闭） */
  readonly persistToolPolicy?: (draft: ToolPolicyDraft) => void;
  /**
   * compaction 服务注入位（缺省内部组装真身——SummaryChannel 适配 + 缺省配置；
   * 测试注入计量替身观察阈值触发入参，未来装配覆盖位与 providers/model 同形）
   */
  readonly compaction?: CompactionService;
  /**
   * 附件库注入位（03 §10.4 ③ 2026-10-08 剪贴板附件批）：缺省 = 数据目录
   * 在场时自铸（`<dataDir>/attachments` 内容寻址旁路）；内存模式（dataDir
   * null）= undefined 诚实缺席——受理链在桥侧拒（400 数据目录族）、再水化
   * 降「[图片已不可用]」占位。显式注入 = 测试形/装配覆盖（与 providers/model
   * 同形）。受理（桥）与再水化（convertToLlm）共享同一实例。
   */
  readonly attachments?: AttachmentStore;
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
  /**
   * 单会话收口观察穿线位（宿主内部——SessionManager.onRetired 的装配透传，
   * 2026-09-13 复盘发现 ⑯）：retire 成功路发射（dismantle + 摘登记后；
   * 观察者异常吞隔离）。消费位 = 装配根订阅面（memory 件简报冻结缓存收口
   * 摘除）。缺席 = 无外部观察（测试替身形——帽 256 FIFO 兜底仍在）。
   * 第十一轮 retire 清账批（05 retire 清账律定形注）起：装配位恒装内部
   * 观察者先走清账三步（排干屏障 → 摘计量持有 → persist 登记面出册，
   * 见 manager 装配段），本外部观察者退居尾调——发射时点不变、语义不变。
   */
  readonly onSessionRetired?: (sessionId: string) => void;
  /**
   * 会话关闭收口穿线位（宿主内部——SessionManager.onSessionClosed 的装配
   * 透传，六役 CL-C ④——04 §10 closeOwner 段）：retire 成功路 + dispose
   * 全量拆解路两路逐会话发射（区别于 onSessionRetired 只走 retire 路）。
   * 消费位 = 装配根注入 () => void jobs.closeOwner(sessionId) 形闭包（Job
   * 归属围栏会话腿——宿主位两路同源：插件卸载 closer + 会话 dispose）。
   * 缺席 = 零行为（测试替身形）。
   */
  readonly onSessionClosed?: (sessionId: string) => void;
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

/**
 * 自定义渠道注册回执（R-1 评审修复役——保留字执法单源化）：拒注不抛、回执
 * 点名原因（消费位 = 装配 boot 腿 warn 跳条 + 向导活注册注记分档）。
 */
export type CustomProviderRegistration = { readonly ok: true } | { readonly ok: false; readonly reason: string };

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
   * 附件库读面（03 §10.4 ③ 剪贴板附件批）：受理链（装配桥 submitPrompt
   * images 位）与再水化（convertToLlm）共享的同一实例；内存模式 =
   * undefined 诚实缺席（受理拒 400 数据目录族/再水化降占位）。
   */
  readonly attachments: AttachmentStore | undefined;
  /**
   * 会话生效模型读面（03 §10.4 ② 能力门供源）：per-session 显式覆盖 ??
   * 栈基线旋钮——受理链能力门按本值点查模型目录 input 声明（缺声明不拦，
   * 诚实失败不臆断）。与驱动装配取值器同语义的只读投影。
   */
  sessionModelOf(sessionId: string): string;
  /**
   * 思考档位栈基线活读（2026-09-17 会话档位切换面批 F1）：装配面原始值的
   * 透传读面——会话生效档以 `foldSessionThinkingLevel(session.events()) ??
   * 本基线` 为准（驱动取值器闭包单源，run 起现取钉定），本面只供 picker
   * 锚显等宿主位读栈基线；会话级切档事件改 fold 面不改本值。缺席 = undefined
   * （无基线锚——picker 恰当诚实无锚显示）。
   */
  readonly thinkingLevel: ThinkingLevel | undefined;
  /**
   * 沙箱档位 boot 解析值活读（2026-09-17 会话档位切换面批 F2）：TUI
   * /sandbox 副屏 current 锚（picker ● 标）的栈级读面——会话生效档以
   * `foldSessionSandboxMode(session.events(), boot)` 为准（:850 三面单源
   * 闭包——守门行/fence/bash 同源执法），本面只供宿主位读 boot 锚；会话级
   * 切档事件改 fold 面不改本值（boot 恒定——settings 解析产物）。
   */
  readonly sandboxMode: SandboxMode;
  /**
   * 模型旋钮（07 §4.1 R5——挂账解挂批 2026-09-15 ctrl+p 模型循环数据路）：
   * 会话级内存旋钮换档——不写盘（持久化不在此面，重启回落装配基线）。换档
   * 后读面 {@link model} 即时随动；已开会话的下一 run 起跑现取新值（驱动
   * 装配取值器形——run 内恒定不中途换）；per-session 显式覆盖会话不受栈级
   * 旋钮影响（覆盖序既有律：sessionModel ?? 栈基线）。
   */
  setModel(id: string): void;
  /**
   * 自定义渠道活注册（2026-09-28 模型渠道批 C-3——07 §8.4 生效时点双路的
   * 向导路）：llmRuntime.registerProvider 单源透传 + **env 豁免集同步扩**
   * （本会话即刻生效——07 §8.4 裁决：自定义渠道 env 键不合成不供血，绑定行
   * 唯一源；不扩集则环境同名 `${ID}_API_KEY` 键会假遮蔽真供血）。手编
   * settings 路经装配期注册 + customProviderIds 快照——两路同判据。
   *
   * R-1 评审修复役（2026-09-28）：**保留字执法单源下沉本口**——两腿并集：
   * ① 内置目录 id（builtinProviderIds 单源——判据不依赖运行时装配形，注入
   * 形下内置全集不在册仍是保留字）；② 运行时在册 id（插件/其他渠道）且非
   * env 豁免集自己人（在场 = 同 id upsert 更新合法）——拒注回执不抛；装配
   * boot 腿/向导活注册/编辑重入三腿同口（04 §9 ⑥ 评审修复批注①——
   * setProvider 按 id upsert 会静默顶掉内置注册，执法不得只住装配腿单侧）。
   */
  registerCustomProvider(provider: Provider): CustomProviderRegistration;
  /**
   * 自定义渠道活除名（R-1 删除腿三联动第三步）：runtime 除名 + env 豁免集
   * 同步收缩——与活注册对称的「当场失效」（删除后目录/env 判据两不见）。
   * 当前模型停在被删渠道时的复位编排归装配位（运行时目录活读——本面纯除名）。
   */
  unregisterCustomProvider(id: string): void;
  /**
   * env 豁免集成员判据（07 §8.4——#12 豁免同步）：id 是否以自定义渠道身份
   * 在豁免集（装配快照源 + 活注册扩/活除名收缩，与 envApiKeyNamesOf 同集
   * 单源）。消费位 = 呈现/指路面的「该渠道 env 是否供血」判断（如启动引导
   * 面板对自定义渠道免呈 `${ID}_API_KEY` 例键——env 永不生效的指路即误导）；
   * 官方渠道恒 false（env 合成键供血判据原样）。
   */
  isCustomProvider(id: string): boolean;
  /**
   * 模型凭证态现算（ob-2——07 §4.1 呈现面件 11 检测腿）：供血判据的纯读
   * 投影非第二实现（env 键非空 ∨ 绑定行命中——liveBindingApiKey 同判据布尔
   * 回投，含 env 遮蔽/撞绑全序/空值行不供血全执法）。派生态零哨兵——每次
   * 现算，修配置即解锁（credentials/changed 订阅不设）；态入面（值入面见
   * modelCredentialKeyOf——**全明文翻裁 2026-09-28**：人面呈现面态+完整值
   * 同入，模型读侧 carve-out 分权维持）。消费位：TUI boot 启动面板判定、
   * /status 呈现位。
   * @param modelSpec 现算锚（缺省 = 栈当前 model——旋钮换档随动）
   */
  modelCredentialStatus(modelSpec?: string): 'ready' | 'unconfigured';
  /**
   * 当前模型凭证完整值读面（C-4 全明文翻裁——/status 人面完整值入面）：
   * **值取序与供血判据同序同源**（#26——修前 env 先行，插件域行不受 env
   * 遮蔽的供血真相被 env 值覆盖）：绑定行胜出值优先（liveBindingApiKey 供血
   * 面透传——插件域行恒透传，host 域行 env 在场时供血面回 undefined），
   * env 键回落（env 胜位——host 域行遮蔽形与无行形；envApiKeyNamesOf 豁免
   * 判据同源内化，custom 渠道不合成假键恒走绑定行）；两源皆缺席回 undefined
   * （装配位折 null——面板只呈态）。只进人面呈现行集；模型读侧 carve-out
   * （04 §7）与注入腿净化分权维持不动。
   * @param modelSpec 现算锚（缺省 = 栈当前 model——与 modelCredentialStatus 同锚）
   */
  modelCredentialKeyOf(modelSpec?: string): string | undefined;
  /**
   * 当前绑定行 key 原值读面（ob-3 向导重入默认值）：供血胜出行原值——
   * env 遮蔽位/行缺席位回 undefined（与供血判据同执法双分立）；值只进向导
   * 流程（录入预览/回执——**全明文翻裁 2026-09-28**：人面所见即所存）。
   */
  bindingApiKeyOf(modelSpec: string): string | undefined;
  /**
   * 连通微探针（ob-3——07 ob-3 改裁注机制形）：与主对话同一 StreamFn 传输
   * 路的 1-token 探针（专用工厂 maxTokens=1 帽支出 + 显式 apiKey 位携向导
   * 新录 key——供血真路单源，非第二传输实现）；15s 双帽（AbortSignal 请求
   * 级 + timeoutMs 连接级）；usage 入 llm/usage 账（priority foreground、
   * callId `probe:` 形——账面零盲区；metering 缺席 = 丢账 warn 不静默）。
   * 失败回 {ok:false, detail}——错误是数据（StreamFn 永不抛契约同守）。
   */
  probeModelConnectivity(
    modelSpec: string,
    apiKey: string,
    metering?: { sessionId: string },
  ): Promise<{ ok: boolean; detail: string }>;
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
  /**
   * 压缩服务真身（07 §4.1 ZCode TUI 对标批 B2 批 2——/compact 命令面消费位）：
   * assembly 通道命令 register('compact') 经本面调 compactNow（busy 判据 =
   * 命令 handler 层读驱动 running 位后随参传入——05 §2.2「服务层无驱动边」，
   * 服务真身与席位容器同源接线不另铸）。注入替身形（options.compaction）经
   * 本面同透传——测试覆盖语义与席位容器一致。
   */
  readonly compaction: CompactionService;
  /**
   * 流活性 watchdog 双帽读面（04 §3.8——批 A）：流层 idle 帽已闭包装进
   * streamFn（本栈内部接线），编排层时滞帽由装配根经 issue 工厂注入第三
   * 判据消费。0 = 显式关（装配位已 warn 留痕）；两值经 env 双键可调、
   * 「编排 ≥ 流层」不变式装配期交叉校验 fail-loud。
   */
  readonly watchdog: {
    readonly llmIdleTimeoutMs: number;
    readonly sessionStallTimeoutMs: number;
  };
  /** 投影拉取（焦点重画与 /history 同源——驱动活体优先，未开回库装载） */
  projectionOf(sessionId: string): Promise<readonly AgentMessage[]>;
  /**
   * 投影拉取带 seq（卡② 腿①——03 §10.4 卡② 定谳版「投影拉取腿」）：GET
   * 读面局部增位——返回副本贴 seq（每消息 seq = 对应投影源事件锚位 seq，
   * 三型都在场）；reseedTimeline 共享输出与 Message 契约形零改动（模型
   * timeline 种子与 GET 读面共用同一函数，「天然不携 seq」结构性依据保持
   * ——seq 不进模型上下文）。
   */
  projectionWithSeqOf(sessionId: string): Promise<readonly (AgentMessage & { readonly seq: number })[]>;
  driverOf(sessionId: string): ConversationDriver | undefined;
  /** 提交入口（fire-and-forget 形——回执经信封回流；无该会话驱动时 undefined）。
   * content 宽形（03 §10.4 ② 剪贴板附件批）：string 原样（既有流零漂移）；
   * 块数组 = 受理链铸形的 text/image-ref 引用块族（image-only 合法——空文本
   * 不铸空块）；内联 image 块 = read 工具/MCP 桥既有路径不变。 */
  submitText(
    sessionId: string,
    content: UserMessage['content'],
    options?: SubmitOptions & { source?: UserMessage['source'] },
  ): Promise<SubmitResult> | undefined;
  /** 协作中止（在飞 run 的打断柄） */
  interrupt(sessionId: string): void;
  /**
   * 栈级工作区锚取值器（03 §10.7 会话锚源律——会话行无 workspaceRoot 的
   * 回落位）：装配根显式锚优先，缺省归一根（canonical）。委派子会话
   * 「子承父锚」的父行无锚回落消费位（六役子承父锚律）。
   */
  workspaceAnchor(): string;
  /** 启动会话策略（07 §5：cwd 归一根取最新会话——有则续接无则新建） */
  openStartupSession(cwd?: string): StartupSession;
  /**
   * 会话累计读面（07 §4.1 注⑪⑥a——V-4 底栏供数链）：指定会话 llm/usage
   * durable 事件聚合 SUM(input+output) 主计费桶（呈现口径——车道不过滤；
   * 与件 6 run 级供应商直报 totalTokens 口径分立——彼直报此现算，呈现位
   * 分职不互校）。sessionId 键控缓存 + 落账增量直推（与当日全道读面同形引用）。
   */
  sessionSpentOf(sessionId: string): number;
  /**
   * 会话累计落账通知（07 §4.1 注⑪⑥a）：run 结算桥接落账尾、complete 单发
   * 落账尾与连通探针落账尾各发零载荷信号（多笔窗一次），通知后于缓存推进
   * ——订阅者经 sessionSpentOf 现拉必含本笔。有笔才通知（无计量不造零信号
   * ）。注：V-4 注⑪⑤ 今日段退役迁 /status 快照档后，今日读面的推送订阅面
   * （onSpentTodayLedgered）生产消费归零整体退役——/status 开屏现读
   * allLanesSpentToday 直取零推送依赖，本面是落账通知唯一存活面。
   */
  onSessionUsageLedgered(handler: () => void): Disposer;
}

/**
 * provider 失败指路的通道呈现面 enrich（07 §5 扩面笔——`berry run` stderr 面
 * 同律推及 TUI ✗ 错误块/webui 转录等通道信封消费位）。
 *
 * 判据与文案单源 = llm/recovery diagnoseProviderFailure（run 入口 stderr 消费
 * 先例）；**只 enrich unconfigured 族**（模型缺席/pi-ai 原生「Provider is not
 * configured」两形）——auth 族不入：auth-refresh seam 联动指路 + per-provider
 * 去重已在（M4），通道面再附即双指路刷屏。
 *
 * 返回**副本**（message_end 消息 errorMessage 换产品级指路——点名 provider +
 * 配置途径 + 上游原文降附注截断，指路前置保截断帽下可行动信息先见）；档案
 * 实录与投影重建（切焦/回看）仍走原文——enrich 只发生在 onEvent 通道信封
 * 适配位（与 auth seam 通知同律：即时指路非档案事实）。非命中形返 undefined
 * ——调用位直发原件。
 */
export function providerGuidanceForMessageEvent(event: AgentEvent, modelSpec: string): AgentEvent | undefined {
  if (event.type !== 'message_end') return undefined;
  const message = event.message as { errorMessage?: string };
  const raw = message.errorMessage;
  if (raw === undefined || raw === '') return undefined;
  const diagnostic = diagnoseProviderFailure({ errorMessage: raw }, modelSpec);
  if (diagnostic === undefined || diagnostic.kind !== 'unconfigured') return undefined;
  return { ...event, message: { ...message, errorMessage: diagnostic.hint } } as AgentEvent;
}

/**
 * 组装对话栈。副作用注册：两 closer（manager 拆解 + 在飞 run 结算等待 →
 * compaction 排空）按注册序进运行时退出序（abort 之后、write-behind flush
 * 之前——件D1：manager closer 帽内等待 run 闸归零，在飞 run 收尾事件先于
 * 关库入队，04 §1②「closer 收口 drain」码面兑现）。
 */
export function createConversationStack(options: ConversationStackOptions): ConversationStack {
  const warn = options.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
  // 自定义渠道 env 豁免集（07 §8.4 裁决——env 不合成不供血，绑定行唯一源）
  const customProviderIdSet = new Set(options.customProviderIds ?? []);
  /** env 键名族（自定义渠道豁免形——回空数组 = env 判据恒缺席，绑定行唯一供血判据） */
  const envApiKeyNamesOf = (providerId: string): readonly string[] =>
    customProviderIdSet.has(providerId) ? [] : providerApiKeyEnvNames(providerId);
  const scope = options.scope ?? Scope.createRoot();
  const dispatch = options.dispatch ?? new EventDispatch();
  const model = options.model ?? resolveDefaultModelSpec(options.env ?? process.env);
  // 模型旋钮基座（07 §4.1 R5 挂账解挂批——ctrl+p 模型循环）：可变持有与
  // const 基线同源单变量族——读面/defaultModel 闭包/驱动装配取值器三消费位
  // 活读同一持有（setModel 换档三面齐动，零第二事实源）。
  let currentModel = model;
  // 附件库单持有（03 §10.4 ③）：options 显式注入 ?? 数据目录在场自铸；内存
  // 模式 = undefined 诚实缺席（受理链拒/再水化降占位两消费位同判）
  const attachments =
    options.attachments ??
    (options.runtime.dataDir !== null ? createAttachmentStore(options.runtime.dataDir) : undefined);
  // per-session 模型覆盖登记（03 §10.4 ② 能力门读面供源）：驱动工厂每次
  // 起会镜像最新构造——create 携覆盖则记、open/resume/fork 不携则摘（与
  // 驱动装配「sessionModel ?? 栈基线」同语义的只读投影面）
  const sessionModelOverrides = new Map<string, string>();
  // lane 帽（04 §4 宿主级 run 并发帽——channels 消息语义批 m-2）：全宿主
  // 单例信号量，driver 装配位 seam 注入（acquireRunSlot——kick 同步试位/
  // 排队段两面消费；steer/inject 腿不经闸）。容量解析序：显式覆盖位 > env > 缺省 16。
  const runLane = createRunLaneGate(resolveRunLaneCapacity(options.maxConcurrentRuns, options.env ?? process.env));
  // 当日后台预算限额（04 §5 env 旋钮——2026-09-13 复盘修复 #44 F3）：
  // undefined = 缺省 4M（缺省值单源在 llm 件——本层只透传覆盖位）
  const backgroundBudgetTokens = resolveBackgroundBudgetTokens(options.env ?? process.env);
  const sandboxMode = options.sandboxMode ?? (() => 'workspace-write' as SandboxMode);
  const workspaceAnchor = options.workspace ?? (() => canonicalWorkspaceRoot());
  // worktree 服务栈级单持有（缺省 undefined = 诚实缺席）；grantedRoots 闭包
  // 每次可写性检查活取（04 §7 补钉①——授予记账在服务实例内，与 issue 件
  // 共享同实例即同台账）
  const worktreeService = options.worktree;

  // ① ctx.agent 服务面先于一切驱动起跑（onRunSettled 订阅供给前提）
  const agentService = provideAgentService(scope);
  // todo 回看角色幂等注册（进程级单表——convertToLlm 消费前置）
  ensureTodoRole();

  // ② llm 运行时：两出口共享同一 InFlightTracker（04 §3.6 同源计数名实相符）；
  // 钩子派发段只读面同注双入口（03 §3.4——LLM_CALL_IN_HOOK 前置查，ca-3）。
  // 预算读面同位接线（04 §5——2026-09-13 复盘修复 #44：修前 backgroundSpentToday
  // 缺省 () => 0 空转，canAfford/预警三档/reserve 线三消费面生产恒判未超）。
  const llmRuntime = createLlmRuntime(options.providers !== undefined ? { providers: options.providers } : {});
  const tracker = new InFlightTracker();
  // 流活性 watchdog 双帽（04 §3.8——批 A）：流层 idle 帽（主防，stream-fn
  // 闭包装）+ 编排层时滞帽（纵深，issue-session watchdog 第三判据消费）。
  // 0 = 显式关且关也留痕（warn 一笔不暗关）；「编排帽 ≥ 流层帽」不变式
  // 交叉校验 fail-loud（错配是误杀面的合法配置回归形——死配置先例同律）
  const llmIdleTimeoutMs = resolveLlmIdleTimeoutMs(options.env ?? process.env);
  const sessionStallTimeoutMs = resolveSessionStallTimeoutMs(options.env ?? process.env);
  assertWatchdogHatOrder(llmIdleTimeoutMs, sessionStallTimeoutMs);
  if (llmIdleTimeoutMs === 0) {
    warn(`流层 idle 帽显式关（${LLM_IDLE_TIMEOUT_MS_ENV}=0）——流停滞主防缺席，编排层时滞帽独走（04 §3.8）`);
  }
  if (sessionStallTimeoutMs === 0) {
    warn(`编排层时滞帽显式关（${SESSION_STALL_TIMEOUT_MS_ENV}=0）——流停滞纵深缺席（04 §3.8）`);
  }
  // —— B3 裁决三供血面：streamFn 凭证现取 wrapper ——
  // 每次请求现查绑定行（meta 绑定键 modelProvider = <providerId>，任意
  // namespace——消毒腿全表 live 读同律）经 StreamFnOptions.apiKey 既有 seam
  // 透传：无缓存即无陈值，刷新链 rotate 后重试拿到新值由结构性保证。
  const credentialEnvFace = options.env ?? process.env;
  // 撞绑 warn 每 provider 恰一笔（进程内不刷屏——配置歧义一次留痕即够）
  const bindingCollisionWarned = new Set<string>();
  // 库读失败 warn 首笔留痕后静默 fail-open（逐请求 live 读下重复 warn 只刷屏）
  let bindingScanFailureWarned = false;

  /**
   * 逐请求现取绑定行供血值：撞绑裁决（B3 冷读 M5 落码批定形——host 域
   * 优先、同域 namespace→行名字典序稳定全序，不随装载/插入序漂移）+
   * env 优先律两分立执法（03 §10.9「env 与库的优先级」条忠实落地：host
   * 域行 env 在场 env 胜〔静态值无刷新面——不透传走 pi-ai ambient 既有
   * 形〕；插件域行库优先〔env 无 per-plugin 归属位——不受 env 遮蔽恒
   * 透传〕）。绑定行缺席 → undefined 不透传（pi-ai env ambient 既有形
   * 零变）。StreamFn 永不抛契约：库读失败 catch 后 fail-open 不透传。
   */
  const liveBindingApiKey = (modelSpec: string): string | undefined => {
    // provider 前段宽松提取（无斜杠形透传原串查表——解析失败归 llm 层
    // resolveModel fail-loud 既有执法，本层不放大）
    const slash = modelSpec.indexOf('/');
    const providerId = slash === -1 ? modelSpec : modelSpec.slice(0, slash);
    // 全表 live 读（无缓存）：坏形 meta 行不参与绑定、空值行不供血（行级
    // 隔离——单行解密失败跳过不连坐，消毒腿 :591 同律）
    const hits: { readonly ns: string; readonly name: string; readonly apiKey: string }[] = [];
    try {
      for (const row of options.runtime.persistence.store.listCredentialProviders()) {
        const meta = row.meta;
        if (typeof meta !== 'object' || meta === null) continue;
        if ((meta as Record<string, unknown>).modelProvider !== providerId) continue;
        try {
          const entry = options.runtime.persistence.store.getCredential(row.namespace, row.provider);
          if (entry !== undefined && entry.apiKey.length > 0) {
            hits.push({ ns: row.namespace, name: row.provider, apiKey: entry.apiKey });
          }
        } catch {
          /* 单行坏跳过——供血面按行降级，不炸请求路 */
        }
      }
    } catch (err) {
      if (!bindingScanFailureWarned) {
        bindingScanFailureWarned = true;
        warn(
          `凭证绑定行扫描失败（provider=${providerId}，供血面 fail-open 不透传，后续同类失败静默）：` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
      return undefined;
    }
    if (hits.length === 0) return undefined;
    // 撞绑稳定全序：host 域 rank 0 → namespace 字典序 → 行名字典序
    const rank = (ns: string): number => (ns === HOST_NAMESPACE ? 0 : 1);
    hits.sort(
      (a, b) =>
        rank(a.ns) - rank(b.ns) ||
        (a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
    if (hits.length > 1 && !bindingCollisionWarned.has(providerId)) {
      bindingCollisionWarned.add(providerId);
      // 括号句随胜者域分形（纯插件域撞绑不印「host 域优先」——通则句与
      // 本例胜出原因分立，2026-09-16 装配簇核验微瑕修）
      const ruleText = hits[0]!.ns === HOST_NAMESPACE ? 'host 域优先' : '插件域字典序首行';
      warn(
        `provider ${providerId} 绑定行撞绑（${hits.length} 行声明 modelProvider）——取 ${hits[0]!.ns}/${hits[0]!.name}` +
          `（${ruleText}），其余行忽略`,
      );
    }
    const winner = hits[0]!;
    // env 优先律（host 域行）：env 键在场即 env 胜——静态无刷新面，401 后
    // 联动腿走 fail-closed（seam 消费侧）；插件域行不受 env 遮蔽恒透传
    if (winner.ns === HOST_NAMESPACE) {
      const envOccupied = envApiKeyNamesOf(providerId).some((name) => (credentialEnvFace[name] ?? '') !== '');
      if (envOccupied) return undefined;
    }
    return winner.apiKey;
  };

  const baseStreamFn = createStreamFn(
    llmRuntime,
    llmIdleTimeoutMs > 0 ? { idleTimeoutMs: llmIdleTimeoutMs } : {},
    tracker,
    options.hookDispatchGuard,
  );
  // —— ob-3 连通微探针专用工厂（07 ob-3 改裁注）：maxTokens=1 帽支出 +
  // 连接级 15s 帽——maxTokens 是 StreamFnDefaults 构造期键非 per-call，专用
  // 工厂是唯一帽支出法；与主链路 baseStreamFn 分立 defaults 不相扰（同一
  // createStreamFn 真供血路形，非第二传输实现）。消费位 probeModelConnectivity。
  const probeStreamFn = createStreamFn(
    llmRuntime,
    { maxTokens: 1, timeoutMs: SETUP_PROBE_TIMEOUT_MS },
    tracker,
    options.hookDispatchGuard,
  );
  // 外包闭包：现取面在 04 §3.8 watchdog 包装之外（请求装配最先到位）；
  // 上游显式 apiKey（complete 单发路/测试注入形）优先，不被绑定行改写
  const streamFn: StreamFn = (context, reqOptions, signal) => {
    if (reqOptions.apiKey !== undefined) return baseStreamFn(context, reqOptions, signal);
    const apiKey = liveBindingApiKey(reqOptions.model);
    if (apiKey === undefined) return baseStreamFn(context, reqOptions, signal);
    return baseStreamFn(context, { ...reqOptions, apiKey }, signal);
  };
  // 当日后台已耗读面：日键缓存 + 桥接增量（05 §1.1 口径——SUM(input+output)、
  // background 道过滤）。单写者进程（单活跃机收口）内首读聚合后只随本进程
  // 桥接落账增量推进；日翻转重聚合（昨账不跨日）。write-behind 未落盘窗内
  // 最近一笔偏松——软闸门既有语义（04 §5 定形注②）。
  let spentDayStart = -1;
  let spentCached = 0;
  const backgroundSpentToday = (): number => {
    const dayStart = startOfTodayMs();
    if (dayStart !== spentDayStart) {
      spentDayStart = dayStart;
      try {
        spentCached = aggregateBackgroundSpentToday(options.runtime.persistence.store, dayStart);
      } catch (err) {
        // 读面失败 fail-open + warn：预算是软闸门，db 抖动不应反噬请求路（欠账
        // 随下次日键重试/进程重启收口——丢弃的只是当次聚合精度）
        warn(
          `当日后台已耗聚合失败（fail-open 归既知值 ${spentCached}）：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return spentCached;
  };
  // 当日全道已耗读面（呈现口径——/status 副屏快照档消费〔V-4 注⑪⑤ 今日段
  // 退役迁位〕）：与上方闸门口径
  // 分立成对（日键缓存 + 桥接增量同形），差异只在聚合不过滤车道（前台笔照进）。
  // **只喂呈现**：allLanesSpentToday 服务读面的供数闭包，canAfford / 预警三档
  // / reserve 线仍只认 backgroundSpentToday——全道扩张不反噬任何执法面。
  let allSpentDayStart = -1;
  let allSpentCached = 0;
  const allLanesSpentToday = (): number => {
    const dayStart = startOfTodayMs();
    if (dayStart !== allSpentDayStart) {
      allSpentDayStart = dayStart;
      try {
        allSpentCached = aggregateSpentToday(options.runtime.persistence.store, dayStart);
      } catch (err) {
        // 读面失败 fail-open + warn：呈现面更不反噬请求路（归既知值——观测精度
        // 损失与闸门读面同语义，随下次日键重试/进程重启收口）
        warn(
          `当日全道已耗聚合失败（fail-open 归既知值 ${allSpentCached}）：${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return allSpentCached;
  };
  // 会话累计读面（07 §4.1 注⑪⑥a——V-4 底栏供数链）：sessionId 键控缓存
  // 多会话并存（路3 定谳形）。与当日全道读面**全形引用但键维不同**：日键承担
  // 跨午夜归零语义，会话累计无归零概念——条目终身有效，只承担跨进程写账
  // 陈旧界（本进程未读过的会话首读库扫现值）。落账增量直推（append 即推
  // 缓存、通知后于推进——订阅者现拉必含本笔）；刷新锚 = 三落账位 + 切焦
  // 现读（消费端首读/缓存路自会覆盖，repaint 高频路零聚合读）。
  const sessionSpentCache = new Map<string, { spent: number }>();
  const sessionUsageLedgerHandlers = new Set<() => void>();
  const notifySessionUsageLedgered = (): void => {
    // 拷贝迭代防遍历中摘除（agent-service 订阅面先例形）+ handler 逐个
    // try/catch 隔离（onRunSettled 订阅面同律——非总线词汇，订阅面服务形）
    for (const handler of [...sessionUsageLedgerHandlers]) {
      try {
        handler();
      } catch (err) {
        warn(`会话累计落账通知订阅者异常（隔离不炸落账链）：${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };
  /** 落账增量直推（两落账位共用）：仅已初始化条目推进——双计不生律（未初始化时磁盘聚合随后首读自会收编本笔） */
  const bumpSessionSpent = (sessionId: string, tokens: number): void => {
    if (tokens <= 0) return; // 零账不推（无计量不造零账同律）
    const entry = sessionSpentCache.get(sessionId);
    if (entry !== undefined) entry.spent += tokens;
  };
  /** 会话累计读面实现体：首读库扫聚合（游标翻页聚尽），已缓存直返（呈现面 fail-open） */
  const sessionSpentOf = (sessionId: string): number => {
    const cached = sessionSpentCache.get(sessionId);
    if (cached !== undefined) return cached.spent;
    try {
      // 成功才落缓存：条目 = 聚合现值快照（终身有效——见上头注）
      const spent = aggregateSessionSpent(options.runtime.persistence.store, sessionId);
      sessionSpentCache.set(sessionId, { spent });
      return spent;
    } catch (err) {
      // 读面失败 fail-open + warn：呈现面不反噬请求路（今日读面同语义），当次
      // 返 0 但**失败不落缓存**（日键缓存同形——条目保持缺席，下次拉取重聚合
      // 拿全量自愈）。反例是本缺陷修前形：把 0 无条件 set 进缓存 → 此后永命中
      // 缓存直返、历史账进程内恒漏——每会话仅一次首读，「随下次首读收口」是
      // 不可达承诺（ENOSPC/sqlite 瞬态只应损失当次精度，不应进程内永久失明）。
      // bumpSessionSpent 增量腿照旧只推进已初始化条目——失败后下次拉取的重
      // 聚合已含期间落账笔，全量自愈无双计。
      warn(
        `会话累计聚合失败（fail-open 当次归 0，失败不落缓存、下次拉取重聚合）：${err instanceof Error ? err.message : String(err)}`,
      );
      return 0;
    }
  };
  // 计量写位粘滞持有（04 §5 mq 定形注补律——mq-3 收口锁批 + 四役 mq-2 勘正）：
  // 持有入位随会话驱动创建/开（createDriver 工厂 seam——manager create/open/fork
  // 共尾 adopt 均经此，创建即持）；settle 观测逐次刷新取最新活体；onUsage 解析序
  // = 活体 → 粘滞持有 → detached 铸新。
  // 病灶（compaction 链 e2e 抓获）：onUsage 回调期才解析目标日志时，「会话
  // 退役落在 complete 在飞窗内」（shutdown closer 序 conversation-manager
  // dispose 先于 compaction-drain；单会话 retire 同窗）→ driverOf 转
  // undefined → loadSession 从滞后的库（write-behind 队列未冲刷）铸第二内存
  // 日志——per-session seq 双计数器撞车 = PERSIST_DATA_CORRUPT 写序违约。
  // mq-2 勘正：settle 观测补持有存在「首 run 在飞、尚无被观测 settle 即退役」
  // 窗（retire/dispose 同步摘登记后 settle 通知必经早退分支，hold 永不落；goal
  // 沉淀单发恰在 run 组装期发起、无先导 settle）——「见过活体」的认定时点 =
  // 驱动创建/开期即算，创建即持补齐该窗；本进程创建/开过的会话，其车道日志
  // 解析永不经 detached 铸新腿（活体或持有常在）。
  // 单追加者律（一会话同一时刻至多一个可追加日志对象）：持有在场 = 同对象
  // 同计数器，append 续既有写队列尾、序不破；「从未见过活体」（跨进程/从未
  // 开驱动）才铸新——该会话本进程队列必空，安全。持有驱逐（05 retire 清账
  // 律——第十一轮深扫定形注翻档，原 v1「持有不驱逐」边界废止）：retire 成功
  // 路尾同步排干〔队列已冲刷——drainSessionNow 屏障〕后摘持有〔dismantle 摘
  // 登记后除持有位外无强引用——无外部日志引用〕，双判据在 retire 收口序内
  // 可判定；此后迟到计量写笔走 detached 铸新腿（排干后队列空、铸新不撞 seq
  // 双计数器——单追加者律保持）。进程级全量 SessionLog 单调滞留就此收口
  //（清账编排位 = manager 装配 onRetired 三步，见 :1294 段）。
  const meteringLogHold = new Map<string, SessionLog>();
  const llm = createLlmService({
    runtime: llmRuntime,
    tracker,
    defaultModel: () => currentModel,
    ...(options.hookDispatchGuard !== undefined ? { hookDispatch: options.hookDispatchGuard } : {}),
    backgroundSpentToday,
    allLanesSpentToday,
    ...(backgroundBudgetTokens !== undefined ? { backgroundBudgetTokens } : {}),
    // —— 单发计量装配单点（04 §5 mq 定形——2026-09-14）：complete 路 onUsage
    // 落 llm/usage（compaction/memory/goal 三调用位经三中间面 sessionId 穿线
    // → metering 声明到此）。manager 前向引用安全（complete 调用期必已建）。
    onUsage: (result, modelSpec, metering) => {
      // 缺席 = 调用方未声明归因：不落账 + warn 丢账可观测（「不静默」律；
      // lib/测试形不传 onUsage 零行为变化——本回调只存在宿主装配形）
      if (metering === undefined) {
        warn(
          `llm/usage 单发落账跳过——complete 未声明 metering 归因（callId=${result.callId}, model=${modelSpec}）：丢账不静默（04 §5）`,
        );
        return;
      }
      // 写路径律：活体优先 + 粘滞持有（04 §5 mq 定形注）——活体观测即刷新
      //（复开换代取最新活体）；detached loadSession（:677 既有式——
      // loadSession.log append 直通写队列，durable）只在「从未见过活体」形
      //（真退役/跨进程）铸新
      const live = manager.driverOf(metering.sessionId)?.session;
      if (live !== undefined) meteringLogHold.set(metering.sessionId, live);
      const log =
        live ??
        meteringLogHold.get(metering.sessionId) ??
        options.runtime.persistence.loadSession(metering.sessionId).log;
      log.append('llm/usage', {
        callId: result.callId,
        // model 实录优先（05 §1.1）：响应自带 provider+model 拼全形（网关改道
        // 场景请求标识与实录分叉——实录入账），缺席回落请求标识 modelSpec
        model: ledgerModelOf(result.message.provider, result.message.model, modelSpec),
        usage: usageBucketsOf(result.usage),
        priority: result.priority,
        elapsedMs: result.elapsedMs,
      } satisfies LlmUsageEventData);
      // 进程内当日缓存随落账同推（仅 background——run 路桥接同式；先经读面
      // 确保日键已初始化——未初始化时磁盘聚合随后自会收编本笔，双计不生）
      if (result.priority === 'background') {
        void backgroundSpentToday();
        if (spentDayStart === startOfTodayMs()) spentCached += result.usage.input + result.usage.output;
      }
      // 全道呈现缓存同推（车道不过滤——前台单发笔也进今日账面；先经读面
      // 确保日键已初始化，同双计不生律）
      void allLanesSpentToday();
      if (allSpentDayStart === startOfTodayMs()) allSpentCached += result.usage.input + result.usage.output;
      // 会话累计增量直推（07 §4.1 注⑪⑥a——metering 归因会话；同双计不生律）
      bumpSessionSpent(metering.sessionId, result.usage.input + result.usage.output);
      // 落账即通知（07 §4.1 注⑪⑥a 会话累计订阅面——锚本回调全尾：上方缓存
      // 推进之后，订阅者现拉必含本笔；metering 缺席早退形不达此处 = 零信号
      // 自然成立）
      notifySessionUsageLedgered();
    },
    // onUsage 回调异常的观测交接（04 §3.7——丢账不静默；llm 件窄面回调落 ctx warn）
    onUsageError: (err, info) => {
      warn(
        `llm/usage 单发落账回调异常（丢账可观测）：callId=${info.callId} model=${info.model}——${err instanceof Error ? err.message : String(err)}`,
      );
    },
  });

  /**
   * usage 桥接落账（04 §5 记账桥接单点——2026-09-13 复盘修复 #41/#44 定形注①）：
   * settled 回执窗扫 (seqFromLaunch, settle] 的 assistant/message 逐条转抄
   * llm/usage（真源仍是 assistant 落账位——桥接投影零改写；05 §1.1 表注）。
   * callId `run:<sid>:<seq>`（与 run CLI 旧桥接同形平移零迁移）；priority 随
   * run 级 backgroundLane（「前台花销照入账」就此收口——TUI/webui/issue/SDK
   * /run CLI 五入口统一）。model 实录优先同律（05 §1.1）：载荷自带
   * provider+model 拼全形、缺席回落请求标识。run-entry --background 块与
   * scheduler-tick recordBackgroundUsage 两处旧扫已退役（同窗同键防双计）。
   */
  const bridgeUsageLedger = (log: SessionLog, modelSpec: string, receipt: RunSettledReceipt): void => {
    let ledgered = false;
    for (const event of log.events()) {
      if (event.seq <= receipt.seqFromLaunch || event.type !== 'assistant/message') continue;
      const data = event.data as { usage?: Usage; provider?: string; model?: string };
      const usage = data.usage;
      if (usage === undefined) continue; // 无计量不造零账
      ledgered = true; // 有笔标志（无计量 continue 形不置位——零账窗自然零信号）
      log.append('llm/usage', {
        callId: `run:${receipt.sessionId}:${event.seq}`,
        // model 实录优先（05 §1.1——与 complete 路 onUsage 同律）：载荷自带
        // provider+model 拼全形（响应实录随事件落位），缺席回落请求标识
        model: ledgerModelOf(data.provider, data.model, modelSpec),
        usage: usageBucketsOf(usage),
        priority: receipt.backgroundLane ? 'background' : 'foreground',
      } satisfies LlmUsageEventData);
      // 当日缓存增量（仅后台道进闸门口径；先经读面确保日键已初始化——
      // 未初始化时磁盘聚合随后自会收编本笔，双计不生）
      if (receipt.backgroundLane) {
        void backgroundSpentToday();
        if (spentDayStart === startOfTodayMs()) spentCached += usage.input + usage.output;
      }
      // 全道呈现缓存增量（车道不过滤——前台 run 笔也进今日账面；同双计
      // 不生律）
      void allLanesSpentToday();
      if (allSpentDayStart === startOfTodayMs()) allSpentCached += usage.input + usage.output;
      // 会话累计增量直推（07 §4.1 注⑪⑥a——本 run 归属会话，桥接单点窗扫
      // 同笔同源；仅已初始化条目推进——双计不生律同上）
      bumpSessionSpent(receipt.sessionId, usage.input + usage.output);
    }
    // 有笔才通知（07 §4.1 注⑪⑥a 会话累计订阅面——本函数同步、循环收尾即
    // 通知，通知时点后于全部缓存推进；多笔窗一次通知，订阅者现拉即窗终值）
    if (ledgered) {
      notifySessionUsageLedgered();
    }
  };

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
        complete: async ({ prompt, maxChars, sessionId }) => {
          const result = await llm.complete({
            messages: [{ role: 'user', content: prompt, timestamp: Date.now() }],
            priority: 'foreground',
            // 单发计量归因（04 §5 mq）：sessionId 穿线 → metering 声明（真源在
            // 调用方 service 侧 runHost——本适配器只透传）
            ...(sessionId !== undefined ? { metering: { sessionId } } : {}),
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
      // 排队兑现告知接线（07 B2 批 2——05 §2.2 第 6 条 onManualQueuedSettled
      // seam 的 host 消费位）：排干执行完成的回执经通道 notify 归因 'compact'
      // 回流（与 /export 回执同律）。三值档文案单源 host/compact-cmd：
      // compacted 档数字优先取事件载荷（end 载荷同笔携带）；failed 档原因句
      // 事件不携（载荷只三件）——经日志末条 end 同笔补读（driverOf 活体真源
      // ；回写后必在场）。channels/manager 均晚于本构造位声明——TDZ 晚绑
      // （回调只在 run 终态排干时触发，构造期零调用；channels 选项闭包同位
      // 先例）。回调异常已在服务侧隔离（emitManualSettled try/catch warn——
      // 单消费者故障不反噬排干路径，本处零包装）。'compacted' 兑现档另触
      // 完成尾强制重画（07 B2 定形注挂账销账——B2R：与命令腿 deps.repaint
      // 同位同义——投影已变，聚焦者清屏重画使分隔行即时呈现）；refresh 拉
      // 投影 fail-loud 拒绝折 warn 回执——emitManualSettled 的 try/catch 是
      // 同步隔离，裸 void 弃接会让异步 rejection 逃成 unhandledRejection
      //（focus 弃接洞同族——先例在案）
      onManualQueuedSettled: (event) => {
        const log = manager.driverOf(event.sessionId)?.session;
        const endFacts = log !== undefined ? lastCompactionEndFactsOf(log.events()) : undefined;
        const facts =
          event.outcome === 'compacted'
            ? { occludedMessages: event.occludedMessages ?? endFacts?.occludedMessages }
            : event.outcome === 'failed'
              ? { error: endFacts?.error }
              : undefined;
        void channels.notify(event.sessionId, compactOutcomeText(event.outcome, facts));
        if (event.outcome === 'compacted') {
          void channels.refresh(event.sessionId).catch((err: unknown) => {
            warn(`压缩后重画失败（${event.sessionId}）：${err instanceof Error ? err.message : String(err)}`);
          });
        }
      },
      warn,
    });

  // ④ channels 通道核（投影源在⑤驱动登记之后才被调用——闭包前向引用安全）
  const channels = createChannels<AgentMessage>({
    fetchProjection: (sessionId) => Promise.resolve(projectionOf(sessionId)),
    history: (sessionId) => Promise.resolve(projectionOf(sessionId)),
    // /memory 注册位（06 §7——mm 批）：库座在位即注册（persistence 在场 ⇒
    // memory 件将装载；件缺席形由命令 handler 的 notify 降级提示诚实兜底）
    memory: true,
    // /sessions 清单注入（07 §4.1 R7 批 10k）：manager 全量行 + 活跃位投影
    // （最新在前——切换器装配序；listActive 空集时全 inactive 如实呈现）
    sessions: () => {
      const active = new Set(manager.listActive().map((entry) => entry.sessionId));
      return Promise.resolve(
        [...manager.list({})]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .map((row) => ({
            id: row.id,
            // 读路合并单源（05 §9 v13 分家③）：显式题优先、首问快照兜底
            title: sessionDisplayTitleOf(row),
            workspaceRoot: row.workspaceRoot,
            updatedAt: row.updatedAt,
            active: active.has(row.id),
          })),
      );
    },
    // /sessions 总数注入（B2 截断披露）：manager.list 默认 100 窗，超窗时
    // 切换器头行注记「N/M（仅显示最近）」——总数独立单源不随窗走
    sessionsTotal: () => Promise.resolve(manager.countSessions()),
    // /usage 数据源注入（R7——同 projectionOf 双事实源纪律：驱动活体优先，
    // 未开回库装载；fold 口径 = 全 run 累计含被遮蔽 retry）
    usage: (sessionId) => {
      const log = manager.driverOf(sessionId)?.session ?? options.runtime.persistence.loadSession(sessionId).log;
      return Promise.resolve(foldSessionUsage(log.events()));
    },
    // /calls 数据源注入（07 §4.1 ZCode TUI 对标批 B3 定形注）：同 usage 双
    // 事实源纪律（驱动活体优先、未开回库装载——/rewind ③ 面板快照同谱）；
    // 快照档语义 = dispatch 时现读（开屏后新调用不进在场面板，重开重取）；
    // fold 产物 = 尾窗 50 行集 + 全量计数（截断披露真源）
    calls: (sessionId) => {
      const log = manager.driverOf(sessionId)?.session ?? options.runtime.persistence.loadSession(sessionId).log;
      return Promise.resolve(foldCallLedger(log.events()));
    },
    // /rename 写面注入（07 §4.1 2026-09-30 会话管理命令批）：净化+200 帽
    // 组合单源 clampTitleText（与 CLI `sessions rename` 第七动词同源——通道
    // 核只透传原始名，写面数据律归装配侧）；净化归空拒不落库；行在库即
    // updateSessionTitle 直写（changes>0），零消息活体会话（createSession
    // 零 I/O 行首事件才落库——TUI 刚开的新会话）走 stageSessionTitle 兜底
    // （活体挂题+行即预落），两路皆 miss 才诚实拒 missing
    renameSession: (sessionId, rawTitle) => {
      const clamped = clampTitleText(rawTitle);
      if (clamped === '') return Promise.resolve({ status: 'empty' } as const);
      return Promise.resolve(
        options.runtime.persistence.updateSessionTitle(sessionId, clamped) ||
          options.runtime.persistence.stageSessionTitle(sessionId, clamped)
          ? ({ status: 'ok', title: clamped } as const)
          : ({ status: 'missing' } as const),
      );
    },
    // /resume 续接注入（07 §4.1 2026-09-30 会话管理命令批批2）：manager.open
    // 幂等续接（已 open 直达活体零成本——切焦即续接可写）。缺席判定走读面
    // 预检（store.getSessionRow）——open 的 loadSession 缺席抛 PERSIST_
    // DATA_CORRUPT（存储层 fail-loud 调用序 bug 语义，非本面词），不吞码折
    // false：真数据腐坏仍上抛呈报、不误报「会话不存在」；预检缺席才诚实拒
    // （零消息新会话行未落库——无可续接内容，拒与 /sessions 清单同口径）
    resumeSession: (sessionId) => {
      if (options.runtime.persistence.store.getSessionRow(sessionId) === undefined) {
        return Promise.resolve(false);
      }
      manager.open(sessionId);
      return Promise.resolve(true);
    },
    // 会话删除注入（05 §2.5 会话删除编排定形注①②——注入模板 = resumeSession
    // 同款）：机器路 = manager.deleteSession 六步编排真身（busy 守卫→channels
    // 收口→登记拆除→物理三删→授予回收→焦点处置——seam 接线见 manager 构造
    // 位）；回执三态路由归通道核 wrapper（/sessions 面板删除键消费）
    deleteSession: (sessionId) => manager.deleteSession(sessionId),
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
    onEvent: externalEventSink,
  }) => {
    const sessionId = session.sessionId;
    // per-session 模型覆盖登记镜像（03 §10.4 ② 能力门读面）：携覆盖则记、
    // 不携则摘——sessionModelOf 读面与驱动装配同语义
    if (sessionModel !== undefined) sessionModelOverrides.set(sessionId, sessionModel);
    else sessionModelOverrides.delete(sessionId);
    // 会话锚源 = 登记行 workspaceRoot（03 §10.7 六役定形注）：驱动工厂每次
    // 起会（create/open/fork）自日志活体取锚传入工具装配——issue 起
    // headless 会话的 worktree 路径经此落位（修前恒栈级 canonical 仓根，
    // 相对路径解析锚错根）。行无 workspaceRoot（普通会话）回落栈级锚不变。
    // 锚自 durable 登记行经 SessionLog 活体直达——纯内存通道律不破（值源
    // 是行非新增通道；createSession 零 I/O，行首事件才落库，故不走库读）。
    const rowWorkspaceRoot = session.workspaceRoot;
    const sessionWorkspace = rowWorkspaceRoot !== undefined ? () => rowWorkspaceRoot : workspaceAnchor;
    // 粘滞持有入位前移（04 §5 mq-2 勘正——四役漏扫修复批）：「见过活体」自
    // 驱动创建/开期即算——manager create/open/fork 共尾 adopt 均经本工厂，
    // 创建即持，补齐「首 run 在飞、尚无被观测 settle 即退役」窗（该窗
    // live/hold 双空 → onUsage 走 detached loadSession 从滞后库铸第二内存
    // 日志 = per-session seq 双计数器撞车；goal 沉淀单发恰在 run 组装期发起、
    // 无先导 settle 同窗）。settle 观测保留「逐次刷新取最新活体」既有语义
    //（onRunSettled 订阅位）；持有驱逐随 retire 清账翻档（05 retire 清账律
    // ——第十一轮：retire 收口序内摘持有，头注见上）。
    meteringLogHold.set(sessionId, session);
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
          // ap-3 第四段数据源（03 §10.8 ap-3 定形注）：装配期快照 + 整名族
          // dryRun 闭包（matchToolPolicy 同源——obs 零 safety 依赖的桥位）；
          // 策略表功能缺席（options.toolPolicy undefined）= getter 返 undefined
          // ——obs 段不呈现。dryRun 只喂整名族条目（write/edit/bash 条目命中
          // 依赖调用实参，整名干跑恒 miss——闭包内过滤防假报）
          ...(options.toolPolicy !== undefined
            ? {
                toolPolicy: () => {
                  // memory 形降级防御：dataDir 缺席（正常装配下不共现——
                  // assembly 只在 dataDir 非空时穿 toolPolicy）= 段不呈现
                  if (options.runtime.dataDir === null) return undefined;
                  const wholeName = options.toolPolicy!.filter(
                    (e) => e.tool !== 'write' && e.tool !== 'edit' && e.tool !== 'bash',
                  );
                  return {
                    entries: options.toolPolicy!.map((entry, index) => ({
                      index,
                      tool: entry.tool,
                      ...(entry.pattern !== undefined ? { pattern: entry.pattern } : {}),
                      ...(entry.effect !== undefined ? { effect: entry.effect } : {}),
                      decision: entry.decision,
                      ...(entry.reason !== undefined ? { reason: entry.reason } : {}),
                      ...(entry.expiresAt !== undefined ? { expiresAt: entry.expiresAt } : {}),
                    })),
                    path: join(options.runtime.dataDir, TOOL_POLICY_BASENAME),
                    dryRun: (tool: string, effect: 'read' | 'write' | 'exec') => {
                      const hit = matchToolPolicy(wholeName, { tool, effect }, Date.now());
                      return hit === undefined ? undefined : { decision: hit.entry.decision, index: hit.index };
                    },
                  };
                },
              }
            : {}),
        },
      });
      const assembly = assembleOpenTools({
        sessionId,
        dispatch,
        session,
        scope,
        // 三面取档单源 per-session 翻换（F2 核心——冷读 IMPL-F1 定谳「一处翻
        // 三面齐动，禁只翻 bash 侧防执法分裂」）：mode 闭包是 assembleOpenTools
        // 的取档真源，守门行 installSafetyGate / fs fence createRootsProvider /
        // bash currentMode 三消费面同源同闭包。闭包捕获本会话 SessionLog——
        // fold 现值 fallback 恒 boot 解析值（M2：settings 显式 danger 属用户
        // 显式授权，非「非 danger」缺省）；_sessionId 形参 = 调用方会话锚
        // （gate input.sessionId / bash toolCtx.sessionId / fs fence 第二参），
        // per-session 装配下归属过滤保证与闭包会话一致，本形不另源查账（形参
        // 在位承 seam——签名统一由 SafetyGateOptions.mode 定形）。切档事件
        // append 即改 fold 现值：三面下一次调用齐动（「即刻生效于后续工具
        // 调用」的机制真身 = 取值器每次调用现取——07 §4.1 A4 勘正注）。坏词 fold 抛：gate 守门异常 →
        // TOOL_GATE_FAILED fail-closed；bash/fs 编码 isError
        // [SANDBOX_MODE_INVALID]——同一坏词工具位三面同拒。
        mode: (_sessionId?: string) => foldSessionSandboxMode(session.events(), sandboxMode()),
        dataDir: options.runtime.dataDir,
        // 会话锚（上文本工厂行锚——胜出栈级缺省；见 sessionWorkspace 注）
        workspace: sessionWorkspace,
        // worktree 消费接线（04 §7 补钉①）：三工具挂载 + 授予根 live 并入
        // fs fence（grantedRoots(sessionId) 每次可写性检查现取——授予起于
        // 会话起后，活取非快照）；服务缺席两腿同缺（诚实缺席）
        ...(worktreeService !== undefined
          ? { worktree: worktreeService, grantedRoots: () => worktreeService.grantedRoots(sessionId) }
          : {}),
        askApproval: askFace,
        ...(options.toolPolicy !== undefined ? { toolPolicy: options.toolPolicy } : {}),
        ...(options.persistToolPolicy !== undefined ? { persistToolPolicy: options.persistToolPolicy } : {}),
        // 审批策略档穿线（04 §9 两旋钮——装配根四层解析胜者；缺省不注入 =
        // approval 服务内缺省 'ask'）
        ...(options.approvalPolicy !== undefined ? { policy: options.approvalPolicy } : {}),
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
      // E-4 context_usage 供源（04 §2 E-4 批——07 §4.1 注⑪⑥b）：llm 目录
      // 点查闭包（getModel 面 contextWindow 字段——registerProvider 增补即刻
      // 可见）；目录缺席兜底走 compactionSlots 活槽（getConfig().fallback
      // WindowTokens——运行时 ctx.compaction.setConfig 调值即刻可见，晚绑定
      // 安全每次调用现取；07 §4.1 注⑪⑥(b) 拍板「缺席兜底 200k」+估算档与
      // 呈现档同分母——估算档（compaction 裁断）经同一活槽解析，调槽后两档
      // 随调值同走）。槽读异常/字段坏形降级静态常量（fail-open——呈现档不因
      // 配置坏形炸）。agent/conversation 零 llm import 经此闭包（getApiKey
      // 注入律同族）。
      contextWindowOf: (model: string) => {
        const fromDirectory = llm.getModel(model)?.contextWindow;
        if (fromDirectory !== undefined) return fromDirectory;
        // 兜底腿活槽取（分母单源不二设）；缺省/坏形降 DEFAULT 静态常量
        try {
          const tuned = compactionSlots.getConfig().fallbackWindowTokens;
          if (typeof tuned === 'number' && Number.isFinite(tuned) && tuned > 0) return tuned;
        } catch {
          // 槽读抛（席位容器坏形）——降级常量（呈现面 fail-open）
        }
        return DEFAULT_COMPACTION_CONFIG.fallbackWindowTokens;
      },
      convertToLlm: (message: AgentMessage) => {
        const converted = isStandardMessage(message)
          ? message
          : (getMessageRoleDefinition(message.role)?.toLlm?.(message) ?? null);
        // image-ref 再水化单点（03 §10.4 ⑤——请求组装转换位）：user 块数组
        // 中的引用块读附件库还原 base64 ImageContent（文件缺席/坏形降
        // 「[图片已不可用]」文本占位）；无引用块消息恒等直返零漂移——投影
        // 与 durable 恒引用形不动（重播种侧零改）。toLlm 扩张形（todo 角色
        // 一转多）逐枚再水化（非 user 腿恒等快路径，零开销）
        if (converted === null) return null;
        return Array.isArray(converted)
          ? converted.map((one) => rehydrateImageRefsForLlm(one, attachments))
          : rehydrateImageRefsForLlm(converted, attachments);
      },
      // 栈基线走取值器形（07 §4.1 R5）：每 run 起跑现取旋钮值——ctrl+p 换档
      // 下一 run 生效；per-session 显式覆盖保持定值快照（覆盖序不变，旋钮
      // 不越覆盖位）。
      model: sessionModel ?? (() => currentModel),
      ...(tools !== undefined ? { tools } : {}),
      // tool/call 载荷 owner 位取数（T9 案一批 t-1——memory 形 undefined 不带）
      ...(resolveToolOwner !== undefined ? { resolveToolOwner } : {}),
      // lane 帽取位器（04 §4——channels 消息语义批 m-2）：followUp 起跑前
      // 取位、run 终态释放；排队不计在飞（冷读闸 M1 裁决）。栈级单 gate
      // 全会话共享——「宿主级」并发数的真源。
      acquireRunSlot: runLane,
      // 思考档位装配（2026-09-17 会话档位切换面批 F1）：取值器形无条件装——
      // 每 run 起跑现取 fold(sessionId) 现值 ?? 栈基线（07 §4.1 该批批注；
      // model 取值器同构先例）。切档事件 append 即改 fold 现值，生效 = 下一
      // run 起跑；fold 坏词的 THINKING_LEVEL_INVALID 在 run 起钉定位上抛经
      // submit 回执面回流（构造期零求值——不连坐会话打开）。返回 undefined =
      // 本 run 不覆盖（缺席档零注入，llm 层走 provider 缺省）。
      thinkingLevel: () => foldSessionThinkingLevel(session.events()) ?? options.thinkingLevel,
      // per-session 覆盖 ?? 栈基线（open/resume 不携带——回落基线同 model 律）
      ...((systemPrompt ?? options.systemPrompt) !== undefined
        ? { systemPrompt: systemPrompt ?? options.systemPrompt }
        : {}),
      ...(options.pluginSections !== undefined ? { pluginSections: options.pluginSections } : {}),
      // goal 段升格锚穿线（批 19c-3——驱动 fold 升格消费位 driver.ts）
      ...(options.goalScopeFor !== undefined ? { goalScopeFor: options.goalScopeFor } : {}),
      // goal 轮间沉淀 + 记账回执穿线（批 #99——sessionId 位在此落格绑定）
      ...(options.goalDeposit !== undefined ? { goalDeposit: () => options.goalDeposit!(sessionId) } : {}),
      // 预算预警穿线（批 H——04 §5 软着陆层 + 修复批 run 车道透传）：sessionId
      // 落格绑定同 goalDeposit 形；backgroundLane = 驱动侧当前 run 声明位
      ...(options.budgetAdvisory !== undefined
        ? { budgetAdvisory: (backgroundLane: boolean) => options.budgetAdvisory!(sessionId, backgroundLane) }
        : {}),
      // run 结算回执链（无条件装——2026-09-13 复盘修复 #41/#44 记账桥接单点）：
      // 桥接落账先于消费侧钩（usage 底账近源先行；goal recordTurn 等
      // options.onRunSettled 消费者随后——批 #99 既有链不破）。session 直接
      // 取闭包本尊（settle 时点即本驱动日志——不经 manager 回查）
      onRunSettled: (receipt) => {
        bridgeUsageLedger(session, sessionModel ?? currentModel, receipt);
        options.onRunSettled?.(sessionId, receipt);
      },
      classifyError,
      compactForOverflow: (log: SessionLog) => compaction.compactForOverflow(log),
      // 宿主凭证刷新联动腿 seam（04 §3.3 条 8——B3 批）：装配根组装面恒等
      // 透传；缺席不注入 = 联动腿整体短路（渐进增强零破口）
      ...(options.authRefresh !== undefined ? { authRefresh: options.authRefresh } : {}),
      environmentDisclosure: options.runtime.disclosure,
      askApproval: askFace,
      ...(settleApprovals !== undefined ? { settleApprovals } : {}),
      warn,
      onEvent: (event) => {
        // provider 失败指路呈现面 enrich（07 §5 扩面笔——见
        // providerGuidanceForMessageEvent 头注；auth 族不入/档案实录原文同注）
        const guided = providerGuidanceForMessageEvent(event, sessionModel ?? currentModel);
        channels.emit({ sessionId, event: guided ?? event });
        // 外部汇尾调（07 §4.1 V-0 注①供数链——子代理重试计数供数桥）：
        // channels.emit 之后 + 异常隔离（warn 不反卷驱动事件流；sink 返回
        // Promise 的异步腿同样兜住——防 unhandledRejection）
        if (externalEventSink !== undefined) {
          try {
            Promise.resolve(externalEventSink(guided ?? event)).catch((err) =>
              warn(`会话事件外部汇异步抛错（已隔离）：${err instanceof Error ? err.message : String(err)}`),
            );
          } catch (err) {
            warn(`会话事件外部汇抛错（已隔离）：${err instanceof Error ? err.message : String(err)}`);
          }
        }
      },
      retry: DEFAULT_RETRY_POLICY,
    });
    return driver;
  };
  // 开机会话缺省策略（提取为函数声明——栈字面量 openStartupSession 与删除
  // 编排焦点处置 seam 两消费位单源；05 §2.5 定形注②「openStartupSession 缺省
  // 策略复用」）：cwd 归一根取最新续接 / 无则新建
  function openStartupSessionFor(cwd?: string): StartupSession {
    const workspaceRoot = canonicalWorkspaceRoot(cwd);
    // 按 cwd 归一根取最新会话（会话表 workspace_root 选取键——07 §5 策略真源）
    const [latest] = manager.list({ workspaceRoot, limit: 1 });
    if (latest !== undefined) {
      const opened = manager.open(latest.id);
      return { ...opened, resumed: true, workspaceRoot };
    }
    const created = manager.create({ workspaceRoot });
    return { ...created, resumed: false, workspaceRoot };
  }
  const manager = new SessionManager({
    persistence: options.runtime.persistence,
    dispatch,
    createDriver,
    // 单会话收口观察 + retire 清账三步（05 retire 清账律——第十一轮深扫
    // 定形注；规范先行笔 bec282b）：retire 成功路（dismantle + 摘登记后）
    // 同步执行——
    // ① drainSessionNow 单会话排干屏障（loadSession 读前屏障同 seam，第九轮
    //   c18cf65 既有面）：满足「队列已冲刷」判据，durable 前缀收齐；
    // ② meteringLogHold 摘持有：dismantle 摘登记后除持有位外无强引用
    //   （满足「无外部日志引用」判据——v1 边界翻档，头注见 :734 段）；此后
    //   迟到计量写笔走 detached 铸新腿（onUsage/probe 两写位既有形——排干
    //   后队列空，铸新不撞 seq 双计数器，单追加者律保持）；
    // ③ persistence.retireEntries 出册（registrations/cursors 死键清账）：
    //   排干后执行防在飞写笔回复活死键。
    // 清账三步整体 try 位：排干失败（写链熔断/同步写失败）即中止后续步骤
    // ——持有保持（迟到写笔仍走持有对象，单追加者律不破）+ 键保持，泄漏
    // 退居次位、失败不静默（warn 可观测）；manager 发射位另有吞隔离兜底。
    // 尾调外部观察者（发现 ⑯ 原穿线位——memory 件简报冻结缓存收口摘除）
    // 语义不变。goal 会话复用形不走 retire 不受辖；dispose 全拆位不发射本
    // seam（进程收尾随 close 终清，不另加全清）。
    onRetired: (sessionId) => {
      try {
        // ① 排干屏障（fail-loud 重抛——由下方 catch 收口，见上注；走
        // persistence 公开门面 drainSessionNow——与 ③ retireEntries 同门面形，
        // 不直走 writeBehind 成员〔checkpointDrain 装配位同门面先例〕）
        options.runtime.persistence.drainSessionNow(sessionId);
        // ② 粘滞持有摘除（迟到写笔转 detached 铸新腿）
        meteringLogHold.delete(sessionId);
        // ③ persist 登记面出册（排干后无在飞写——键不复活）
        options.runtime.persistence.retireEntries(sessionId);
      } catch (err) {
        warn(
          `retire 清账失败（持有与登记键保持不摘——迟到写笔仍走持有对象）：${err instanceof Error ? err.message : String(err)}`,
        );
      }
      // 外部观察者尾调（原 seam 消费位——异常由 manager 发射位吞隔离）
      options.onSessionRetired?.(sessionId);
    },
    // 会话关闭收口穿线（六役 CL-C ④——缺席形不设位保持测试替身零行为）
    ...(options.onSessionClosed !== undefined ? { onSessionClosed: options.onSessionClosed } : {}),
    // —— 删除编排三 seam（05 §2.5 会话删除编排定形注②——编排真身 =
    // manager.deleteSession，装配位在此接线；缺席形不设位保持测试替身零行为）——
    // ① channels 收口步：unregisterSession（提问队列收口 + widget 清空——
    // 编排②步发射，先于登记拆除〔守卫先于收口不可倒的次步〕）
    onSessionChannelsClosed: (sessionId) => {
      channels.unregisterSession(sessionId);
    },
    // ② 授予回收步：worktree 槽回收（槽缺席跳过——releaseSession 自幂等）；
    // worktree 注入缺席形不设位（纯库形态删除零授予面）
    ...(worktreeService !== undefined
      ? {
          onSessionGrantsReleased: (sessionId: string) => {
            worktreeService.releaseSession(sessionId);
          },
        }
      : {}),
    // ③ 焦点处置步：删聚焦会话 → openStartupSession 缺省策略复用（cwd = 被删
    // 会话工作区锚〔manager 随 seam 透传〕——归一根最新续接 / 无则新建）+
    // 焦点切达；删非聚焦焦点不动。判据 = channels.focusedId 空悬（非比对被删
    // id——编排②步 unregisterSession 删聚焦者时已把 focusedId 清 null，闭包内
    // 比对恒假不可用；他者聚焦〔非空〕即跳过）。「删非聚焦时焦点本就空悬」的
    // 理论不可达边：channels.unregisterSession 生产消费位唯本编排（删聚焦者恒
    // 复焦），openStartupSession 恒产会话恒复焦。
    onFocusCleared: (_sessionId, workspaceRoot) => {
      if (channels.focusedId !== null) return; // 他者聚焦 = 删非聚焦——焦点不动
      const next = openStartupSessionFor(workspaceRoot);
      void channels.focus(next.sessionId).catch((err: unknown) => {
        channels.notify(next.sessionId, `切换会话失败：${err instanceof Error ? err.message : String(err)}`, {
          level: 'error',
        });
      });
    },
  });

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
    if (driver === undefined) return;
    // 粘滞持有刷新（04 §5 mq 定形注）：settle 期活体日志存档——压缩链
    // fire-and-forget 异步执行，本钩子与 onUsage 回调之间会话可能退役
    //（shutdown dispose / 单会话 retire），持有保证计量写笔仍落同一日志
    // 对象（单追加者律——seq 双计数器撞车防线）
    meteringLogHold.set(event.sessionId, driver.session);
    compaction.handleRunSettled({ log: driver.session, ...lastUsageFactOf(driver.session) });
  });

  /** 投影拉取：驱动活体优先（内存最新鲜），未开回库装载（双事实源纪律同律） */
  async function projectionOf(sessionId: string): Promise<readonly AgentMessage[]> {
    const log = manager.driverOf(sessionId)?.session ?? options.runtime.persistence.loadSession(sessionId).log;
    const events = log.events();
    return reseedTimeline(deriveMessages(events), (seq) => events[seq]?.time ?? 0);
  }

  /**
   * 投影拉取带 seq（卡② 腿①——03 §10.4 卡② 定谳版「投影拉取腿」）：同一
   * 双事实源解析取 events → deriveMessages 产物（ProjectedMessage 每条已带
   * seq）→ reseedTimeline 铸 Message 后逐位回贴副本 seq。zip 结构性成立：
   * reseedTimeline 对每条投影消息恰铸一条 Message（1:1 保序——reseed.ts 三
   * 分支各恰一 push）。射界：只做副本增位——共享输出 reseedTimeline 与
   * Message 契约形零改动（projectionOf 供模型 timeline 种子天然不携 seq）。
   */
  async function projectionWithSeqOf(sessionId: string): Promise<readonly (AgentMessage & { readonly seq: number })[]> {
    const log = manager.driverOf(sessionId)?.session ?? options.runtime.persistence.loadSession(sessionId).log;
    const events = log.events();
    const derived = deriveMessages(events);
    return reseedTimeline(derived, (seq) => events[seq]?.time ?? 0).map((message, i) => ({
      ...message,
      seq: derived[i]!.seq,
    }));
  }

  // —— ob-3 连通微探针（07 ob-3 改裁注机制形）：真供血路 StreamFn 1-token
  // 探针——专用工厂（maxTokens=1 + 连接级帽）+ 显式 apiKey 位（向导新录
  // key 直供血，不经绑定行回读——录入前即可验证）。15s 请求级双帽由
  // AbortSignal 承担；失败折 {ok:false, detail} 数据（StreamFn 永不抛契约
  // 同守 + 迭代竞速防御位兜底）。usage 入 llm/usage 账（账面零盲区——
  // callId `probe:` 形、foreground、实录模型优先；零用量不造零账〔错误
  // 合成消息 NO_USAGE 形——bridgeUsageLedger 同律〕；metering 缺席 = 丢账
  // warn 不静默〔onUsage 同律〕）。
  async function probeModelConnectivity(
    modelSpec: string,
    apiKey: string,
    metering?: { sessionId: string },
  ): Promise<{ ok: boolean; detail: string }> {
    const startedAt = Date.now();
    const signal = AbortSignal.timeout(SETUP_PROBE_TIMEOUT_MS);
    try {
      const stream = await probeStreamFn(
        { messages: [{ role: 'user', content: 'ping', timestamp: Date.now() }] },
        { model: modelSpec, apiKey },
        signal,
      );
      // 消费至终态（agent/stream.ts 同范式——for await 自然耗尽后 result() 终值）
      for await (const _event of stream) void _event;
      const result = await stream.result();
      const spent = result.usage.input + result.usage.output;
      if (spent > 0) {
        if (metering === undefined) {
          warn(
            `llm/usage 探针落账跳过——probeModelConnectivity 未声明 metering 归因（model=${modelSpec}）：丢账不静默（04 §5）`,
          );
        } else {
          // 写路径律同 onUsage：活体优先 + 粘滞持有 → detached 铸新（mq 定形注）
          const live = manager.driverOf(metering.sessionId)?.session;
          if (live !== undefined) meteringLogHold.set(metering.sessionId, live);
          const log =
            live ??
            meteringLogHold.get(metering.sessionId) ??
            options.runtime.persistence.loadSession(metering.sessionId).log;
          log.append('llm/usage', {
            callId: `probe:${randomUUID()}`,
            // 实录优先（05 §1.1——网关改道场景请求标识与实录分叉）
            model: ledgerModelOf(result.provider, result.model, modelSpec),
            usage: usageBucketsOf(result.usage),
            priority: 'foreground',
            elapsedMs: Date.now() - startedAt,
          } satisfies LlmUsageEventData);
          // 全道呈现缓存同推（车道不过滤——前台探针笔也进今日账面；先经读面
          // 确保日键已初始化，双计不生）
          void allLanesSpentToday();
          if (allSpentDayStart === startOfTodayMs()) allSpentCached += spent;
          // 会话累计增量直推 + 落账即通知（双同步形对齐另两落账位——onUsage/
          // 桥接路同律；通知后于缓存推进，订阅者现拉必含本笔）
          bumpSessionSpent(metering.sessionId, spent);
          notifySessionUsageLedgered();
        }
      }
      if (result.stopReason === 'error' || result.stopReason === 'aborted') {
        return { ok: false, detail: result.errorMessage ?? `stopReason=${result.stopReason}` };
      }
      // stop/length/toolUse 均 = 供血通——1-token 帽下 length 是正常收尾形
      return {
        ok: true,
        detail: `${ledgerModelOf(result.provider, result.model, modelSpec)} 返回正常（${spent} tokens）`,
      };
    } catch (err) {
      // 防御位：永不抛契约下的兜底（abort 竞速/底层异常一律折数据）
      return { ok: false, detail: `探针异常：${err instanceof Error ? err.message : String(err)}` };
    }
  }

  // 退出序接线：closer 注册序即 drain 序——先拆驱动（打断在飞 run）再排空压缩链。
  // manager closer 不止拆解（件D1——04 §1②「closer 收口 drain——在飞子代理/
  // 子进程结算及在飞后台 LLM 链」条款码面兑现）：dispose 后帽内自持等待 run
  // 闸归零——run 位释放附在结算尾段（turn/end / llm/usage 桥接等收尾事件
  // 入队之后，driver 结算序），闸归零 ⟺ 收尾事件已在 write-behind 队列，
  // ③ flush 才收得到它们（修前形：closer 同步 dispose 即返，收尾事件竞速
  // 输给 ⑥ 关库 → 对已关库重试耗尽 → 未捕获拒绝进程带栈崩溃）。
  options.runtime.registerCloser({
    label: 'conversation-manager',
    fn: async () => {
      manager.dispose();
      const settled = await waitForRunLaneIdle(runLane);
      if (!settled) {
        // 到帽放弃等待（帽子语义非杀 run——残余收尾事件由 ②层关库终态折失败态兜底）
        warn(`[exit] 停机等待在飞 run 结算到帽（${RUN_SETTLE_WAIT_HAT_MS}ms）放弃——残余收尾事件可能折关库后失败态`);
      }
    },
  });
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
    // 读面 getter 活读（属性快照形不随旋钮换档——测试实证抓获）
    get model() {
      return currentModel;
    },
    // 附件库读面（03 §10.4 ③）：受理/再水化共享单实例（内存模式诚实缺席）
    attachments,
    // 会话生效模型读面（03 §10.4 ② 能力门供源）：覆盖登记 ?? 栈基线旋钮
    sessionModelOf(sessionId: string): string {
      return sessionModelOverrides.get(sessionId) ?? currentModel;
    },
    // 模型旋钮（07 §4.1 R5 挂账解挂批）：内存换档——读面/驱动取值器/defaultModel
    // 三消费位闭包活读同一持有，本面零广播零事件（纯拉取面——换档回执由
    // 调用方（TUI ctrl+p）自行 notify）。
    setModel(id: string) {
      currentModel = id;
    },
    // 自定义渠道活注册（C-3 向导路 + R-1 执法单源）——保留字判据两腿并集：
    // ① 内置目录 id（builtinProviderIds 单源——判据不依赖运行时装配形：
    // 注入形〔测试/诊断 providers 整体替代内置全集〕下内置全集不在册，
    // 但内置 id 仍是保留字，撞名条不得借道注册冒充官方渠道）；
    // ② 运行时在册且非豁免集自己人（在场 = 同 id upsert 更新合法——防撞
    // 插件注册的其他渠道 id）。拒注回执——装配 boot 腿/向导活注册/编辑
    // 重入三腿同口（04 §9 ⑥ 评审修复批注①）；透传 + env 豁免集同步扩
    // （本会话即刻）。
    registerCustomProvider(provider: Provider): CustomProviderRegistration {
      if (builtinProviderIds().includes(provider.id)) {
        return {
          ok: false,
          reason: `渠道 id「${provider.id}」撞内置渠道（保留字）——换个 id`,
        };
      }
      if (llmRuntime.models.getProvider(provider.id) !== undefined && !customProviderIdSet.has(provider.id)) {
        return {
          ok: false,
          reason: `渠道 id「${provider.id}」已被内置渠道或其他渠道占用`,
        };
      }
      customProviderIdSet.add(provider.id);
      llmRuntime.registerProvider(provider);
      return { ok: true };
    },
    // 自定义渠道活除名（R-1 删除腿三联动）：runtime 除名 + env 豁免集同步收缩
    // ——与活注册对称的「当场失效」（目录/env 判据两不见）。
    unregisterCustomProvider(id: string) {
      customProviderIdSet.delete(id);
      llmRuntime.unregisterProvider(id);
    },
    // env 豁免集成员判据（07 §8.4 豁免同步——#12）：与 envApiKeyNamesOf 同集
    // 单源薄包——呈现/指路面「自定义渠道 env 不供血」判断不得各自重算。
    isCustomProvider(id: string) {
      return customProviderIdSet.has(id);
    },
    // 模型凭证态现算（ob-2——07 §4.1 呈现面件 11 检测腿）：供血判据纯读投影
    // ——env 键非空（pi-ai ambient 供血位，与供血 wrapper env 优先律同判据面）
    // ∨ liveBindingApiKey 布尔回投（绑定行命中含遮蔽/撞绑全判据——只取在场
    // 不外泄值）。派生态零哨兵：每次现算，修配置即解锁。
    modelCredentialStatus(modelSpec) {
      const spec = modelSpec ?? currentModel;
      const slash = spec.indexOf('/');
      const providerId = slash === -1 ? spec : spec.slice(0, slash);
      const envReady = envApiKeyNamesOf(providerId).some((name) => (credentialEnvFace[name] ?? '') !== '');
      if (envReady) return 'ready';
      return liveBindingApiKey(spec) !== undefined ? 'ready' : 'unconfigured';
    },
    // 当前绑定行 key 原值（ob-3 向导重入默认值）：liveBindingApiKey 公开薄包
    // ——遮蔽/缺席同判据回 undefined，胜出行原值只进流程「空录入沿用」位
    bindingApiKeyOf(modelSpec: string): string | undefined {
      return liveBindingApiKey(modelSpec);
    },
    // 当前模型凭证完整值（C-4 全明文翻裁——人面呈现面专用）：**值取序与供血
    // 判据同序同源**（#26——修前 env 先行：插件域行不受 env 遮蔽恒透传的供血
    // 真相被 env 值覆盖，/status 呈 env 值而实际供血是绑定行值）。绑定行胜出
    // 值优先（liveBindingApiKey 供血面透传——host 域行 env 在场时其回 undefined
    // 即 env 胜位，自然落 env 回落）；env 键回落（envApiKeyNamesOf 豁免判据
    // 同源——custom 渠道不合成假键恒走绑定行）；两源皆缺席回 undefined
    modelCredentialKeyOf(modelSpec) {
      const spec = modelSpec ?? currentModel;
      const fromBinding = liveBindingApiKey(spec);
      if (fromBinding !== undefined) return fromBinding;
      const slash = spec.indexOf('/');
      const providerId = slash === -1 ? spec : spec.slice(0, slash);
      for (const name of envApiKeyNamesOf(providerId)) {
        const value = credentialEnvFace[name];
        if (value !== undefined && value !== '') return value;
      }
      return undefined;
    },
    // 连通微探针（ob-3 改裁注机制形）——实装见上方函数体注释
    probeModelConnectivity,
    // 思考档位栈基线活读（会话档位切换面批 F1——ConversationStack 面）：透传
    // 装配面原始值；会话生效档读面 = 会话 fold（驱动取值器闭包单源）
    get thinkingLevel() {
      return options.thinkingLevel;
    },
    // 沙箱档位 boot 解析值活读（会话档位切换面批 F2——ConversationStack 面）：
    // TUI /sandbox 副屏 current 锚（picker ● 标 = boot 值；切档回执的「当前
    // 档」= 会话 fold 现值，tui-entry 侧取）。会话生效档读面 = 会话 fold
    // （:850 三面单源闭包）——本 getter 只回 boot，不是执法面。
    get sandboxMode() {
      return sandboxMode();
    },
    sessionView,
    sessionsControl,
    compactionSlots,
    compaction,
    // watchdog 双帽读面（04 §3.8——装配根单次解析单源；issue-session 工厂
    // 第三判据经 assembly 接线消费 stack.watchdog.sessionStallTimeoutMs）
    watchdog: {
      llmIdleTimeoutMs,
      sessionStallTimeoutMs,
    },
    projectionOf,
    // 卡② 腿①：GET 读面带 seq 投影（副本增位——共享输出零改动）
    projectionWithSeqOf,
    driverOf: (sessionId) => manager.driverOf(sessionId),
    submitText(sessionId, content, submitOptions) {
      const driver = manager.driverOf(sessionId);
      if (driver === undefined) return undefined; // 未开会话——上层提交序不达（理论不达防御位）
      const run = driver.submit(content, submitOptions);
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
    // 栈级锚取值器（闭包 const 同名 shorthand——:306 装配锚优先/缺省归一根）
    workspaceAnchor,
    // 开机会话缺省策略（提取单源 openStartupSessionFor——删除编排焦点处置
    // seam 同源消费，05 §2.5 定形注②）
    openStartupSession: openStartupSessionFor,
    // 会话累计读面 + 落账通知（07 §4.1 注⑪⑥a——V-4 底栏供数链；实现体
    // 在当日读面同域定义，同 fail-open/增量直推形）
    sessionSpentOf,
    onSessionUsageLedgered(handler: () => void): Disposer {
      sessionUsageLedgerHandlers.add(handler);
      return () => {
        sessionUsageLedgerHandlers.delete(handler);
      };
    },
  };
}

/**
 * llm/usage 记账 model 字段解析（05 §1.1「model 实录优先」——四役漏扫修复批
 * mq-3）：响应自带 provider+model 双真值在场 → 拼全形 'provider/model'（仓内
 * 全形惯例——llm/model-id.ts formatModelId 同形；网关改道场景请求标识与响应
 * 实录分叉，实录入账）；任一缺席（含空串）→ 回落请求标识兜底——半形不拼，
 * 缺席就诚实记请求标识。
 */
function ledgerModelOf(provider: string | undefined, model: string | undefined, fallback: string): string {
  return provider && model ? `${provider}/${model}` : fallback;
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
export function lastUsageFactOf(log: SessionLog): {
  usage?: { input: number; cacheRead?: number; cacheWrite?: number };
} {
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
      // cache 两桶同笔带出（cache 经济批 RP4——basis 五件的数据源）：与 input
      // 同一事件同一读笔，缺桶/非数不猜（透传面收敛 number 判）
      const record = usage as { input: number; cacheRead?: unknown; cacheWrite?: unknown };
      return {
        usage: {
          input: record.input,
          ...(typeof record.cacheRead === 'number' ? { cacheRead: record.cacheRead } : {}),
          ...(typeof record.cacheWrite === 'number' ? { cacheWrite: record.cacheWrite } : {}),
        },
      };
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
      `lane 并发容量须为正整数，收到 ${String(raw)}——空值/坏值是死配置（BERRY_AGENT_MAX_CONCURRENT_RUNS / maxConcurrentRuns）`,
    );
  }
  return value;
}

/** env 名（04 §5——2026-09-13 复盘修复 #44 F3；07 环境变量 BERRY_AGENT_* 前缀族） */
export const BACKGROUND_BUDGET_TOKENS_ENV = 'BERRY_AGENT_BACKGROUND_BUDGET_TOKENS';

/**
 * 当日后台预算限额解析（04 §5 env 旋钮）：env 缺席 = undefined（缺省 4M 由
 * llm 件单源持有——本函数只产覆盖位）。坏形 fail-loud 启动当场红（与 lane
 * 帽/静置窗两旋钮同律：坏预算值是死配置，静默回落缺省会吞掉用户显式
 * 降额/提额意图）。零值合法（显式关池——canAfford 恒 false，停靠腿承接）。
 */
export function resolveBackgroundBudgetTokens(env: Record<string, string | undefined>): number | undefined {
  const raw = env[BACKGROUND_BUDGET_TOKENS_ENV];
  if (raw === undefined || raw === '') return undefined;
  // 字串形全串 /^\d+$/ 判（同 resolveRunLaneCapacity——parseInt 截停防）
  if (!/^\d+$/.test(raw)) {
    throw new RangeError(
      `当日后台预算限额须为非负整数字串，收到 "${raw}"——格式不对，已停止启动（${BACKGROUND_BUDGET_TOKENS_ENV}）`,
    );
  }
  return Number.parseInt(raw, 10);
}

/* ---------------- 流活性 watchdog 双帽（04 §3.8——批 A 落码） ---------------- */

/** 流层 idle 帽 env 名（04 §3.8.1——主防线：流事件间隔监视） */
export const LLM_IDLE_TIMEOUT_MS_ENV = 'BERRY_AGENT_LLM_IDLE_TIMEOUT_MS';

/** 流层 idle 帽缺省 5 分钟（04 §3.8.1——正常流事件间隔毫秒-秒级，5min 零事件 = 网关半死/连接黑洞） */
export const DEFAULT_LLM_IDLE_TIMEOUT_MS = 300_000;

/** 编排层时滞帽 env 名（04 §3.8.3——纵深层：issue-session watchdog 第三判据） */
export const SESSION_STALL_TIMEOUT_MS_ENV = 'BERRY_AGENT_SESSION_STALL_TIMEOUT_MS';

/**
 * 编排层时滞帽缺省 15 分钟（04 §3.8.3 冷读定谳——独立键独立缺省）：须 ≥ 流层
 * 帽且 ≥ 工具单跑上限（§8 bash timeoutMs 上限 600s）+ 余量，保分层序恒立
 * 「编排帽 > 流层帽——流层先响（delta 级灵敏），编排兜底（durable 级迟钝）」。
 */
export const DEFAULT_SESSION_STALL_TIMEOUT_MS = 900_000;

/**
 * 流层 idle 帽解析（04 §3.8.1 env 解析律）：缺席 = 缺省 5min；`0` = 显式关
 * （「缺席」与「0」两态分明——关也留痕，warn 在装配位非本纯函数）；坏形
 * fail-loud 启动红（死配置同律——旋钮写错须当场可见）。
 */
export function resolveLlmIdleTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = env[LLM_IDLE_TIMEOUT_MS_ENV];
  if (raw === undefined || raw === '') return DEFAULT_LLM_IDLE_TIMEOUT_MS;
  // 字串形全串 /^\d+$/ 判（同 resolveBackgroundBudgetTokens——parseInt 截停防）
  if (!/^\d+$/.test(raw)) {
    throw new RangeError(
      `流式空闲超时须为非负整数字串（毫秒），收到 "${raw}"——格式不对，已停止启动（${LLM_IDLE_TIMEOUT_MS_ENV}）`,
    );
  }
  return Number.parseInt(raw, 10);
}

/**
 * 编排层时滞帽解析（04 §3.8.3——解析律与流层键同族）：缺席 = 缺省 15min；
 * `0` = 显式关（纵深缺席，warn 留痕同款）；坏形 fail-loud 启动红。
 */
export function resolveSessionStallTimeoutMs(env: Record<string, string | undefined>): number {
  const raw = env[SESSION_STALL_TIMEOUT_MS_ENV];
  if (raw === undefined || raw === '') return DEFAULT_SESSION_STALL_TIMEOUT_MS;
  if (!/^\d+$/.test(raw)) {
    throw new RangeError(
      `会话停滞超时须为非负整数字串（毫秒），收到 "${raw}"——格式不对，已停止启动（${SESSION_STALL_TIMEOUT_MS_ENV}）`,
    );
  }
  return Number.parseInt(raw, 10);
}

/**
 * watchdog 双帽交叉校验（04 §3.8.3 执法点——装配根 fail-loud）：两键独立可调，
 * 「编排帽 ≥ 流层帽」不变式在此执法——stall < idle 即启动红（resolveRunLaneCapacity
 * 「死配置 fail-loud」先例同律：错配是误杀面的合法配置回归形）。流层帽 0 = 关
 * 时编排帽独立存在不受交叉校验约束（纵深独走合法——主防缺席纵深在场）；两关
 * 态各自由装配位 warn 留痕（§3.8.1 关也留痕同款）。
 */
export function assertWatchdogHatOrder(llmIdleTimeoutMs: number, sessionStallTimeoutMs: number): void {
  if (llmIdleTimeoutMs > 0 && sessionStallTimeoutMs > 0 && sessionStallTimeoutMs < llmIdleTimeoutMs) {
    throw new RangeError(
      `会话停滞超时（${sessionStallTimeoutMs}ms）须不小于流式空闲超时（${llmIdleTimeoutMs}ms）` +
        `——此序为防误杀设计，不可颠倒（${LLM_IDLE_TIMEOUT_MS_ENV} / ${SESSION_STALL_TIMEOUT_MS_ENV}）`,
    );
  }
}

/** 当日零点毫秒（本地时区——「当日」语义随用户挂钟；04 §5 日池窗） */
export function startOfTodayMs(now: number = Date.now()): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * pi-ai env 静态 key 键名镜像（B3 联动批——裁决三供血面 env 优先律判定位）。
 *
 * pi-ai 的 getApiKeyEnvVars 映射不在 package exports（不可 import）——此处
 * 同源自写镜像（recovery.ts QUOTA_TEXT_PATTERN「模块内私有不导出，此处同款
 * 自写」同律先例）。特例表钉定 pi-ai 钉定 commit env-api-keys 偏离一般律的
 * 键面（anthropic 三键族 / github-copilot / gemini 缩名等）；一般律 =
 * provider id kebab → snake 大写 + 后缀 `_API_KEY`（pi-ai 未知 provider 不
 * 查 env，本镜像按宿主命名约定外推——03 §10.9「模型 key env 缺省位」的
 * 自定义 provider 常规命名形）。消费位 = 供血 wrapper env 占位判 + 装配根
 * seam refreshNow 的 env-static 前判（N2：env 面不在 credentials 件内注入）。
 */
const PROVIDER_API_KEY_ENV_SPECIALS: Readonly<Record<string, readonly string[]>> = {
  'github-copilot': ['COPILOT_GITHUB_TOKEN'],
  anthropic: ['ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_OAUTH_TOKEN', 'ANTHROPIC_API_KEY'],
  google: ['GEMINI_API_KEY'],
  'google-vertex': ['GOOGLE_CLOUD_API_KEY'],
  'azure-openai-responses': ['AZURE_OPENAI_API_KEY'],
  huggingface: ['HF_TOKEN'],
  'vercel-ai-gateway': ['AI_GATEWAY_API_KEY'],
  'moonshotai-cn': ['MOONSHOT_API_KEY'],
  'opencode-go': ['OPENCODE_API_KEY'],
  'kimi-coding': ['KIMI_API_KEY'],
  'cloudflare-workers-ai': ['CLOUDFARE_API_KEY'],
  'cloudflare-ai-gateway': ['CLOUDFARE_API_KEY'],
  'qwen-token-plan-individual': ['QWEN_TOKEN_PLAN_API_KEY'],
};

/**
 * ob-3 连通微探针双帽值（毫秒）：AbortSignal 请求级（消费位铸）+
 * timeoutMs 连接级（探针工厂 defaults）——07 ob-3 改裁注「15s 双帽」。
 */
export const SETUP_PROBE_TIMEOUT_MS = 15_000;

/** provider → env 静态 key 键名族（占位判 = 任一键非空值在场） */
export function providerApiKeyEnvNames(provider: string): readonly string[] {
  const special = PROVIDER_API_KEY_ENV_SPECIALS[provider];
  if (special !== undefined) return special;
  return [`${provider.replace(/-/g, '_').toUpperCase()}_API_KEY`];
}

/**
 * llm/usage 聚合共享核（三读面单源——04 §5 聚合读面/07 §4.1 注⑪⑥a 会话
 * 累计读面）：queryEvents 窗过滤形参化（时间窗 sinceMs / 会话域 sessionId
 * 两维随调用方）+ 车道口径参数化（05 §1.1 口径）。SUM(input+output) 主计费
 * 桶（cache 桶进观察面板不进闸门/呈现）。lane：'background' = 闸门口径
 * （priority 过滤——canAfford/预警三档/reserve 线消费）；'all' = 全道呈现
 * 口径（车道不过滤——/status 副屏快照档消费〔V-4 注⑪⑤ 今日段退役迁位〕，
 * 前台笔照进）。分页游标走满（页帽顶格 10000——当日调用密度远不及帽，走满
 * 是完整性防御非热路径；超长会话笔数可越单页帽，聚合沿 nextCursor 翻页至
 * 尽、不做帽内近似——05 §3.4 对端注）。读失败上抛由调用方定姿态（装配位
 * fail-open + warn——预算软闸门/呈现面均不反噬请求路）。
 *
 * callId 去重（data-integrity L2——fork/导入种子前缀去重语义）：fork
 * （forkPrefix 逐字复制）、goal 切片续跑（slicePrefix）与同日导出再导入
 * 都会把源会话前缀的 llm/usage 连同**原 callId** 复制进新会话（time 原值
 * 保留）——同一笔真实开销在多会话副本中各存一份。callId 是 settlement
 * 幂等身份（complete 路随机 UUID / run 路 `run:<sessionId>:<seq>`——同
 * id 即同一笔），故按 callId 去重：副本同 id 只计一次（Set 跨分页页外
 * 持——页边界不丢身份）；无 callId 的旧事件照计不回退（字段引入前形态）。
 */
function aggregateUsageEvents(
  store: { queryEvents(filter: QueryEventsFilter): QueryEventsResult },
  window: { sinceMs?: number; sessionId?: string },
  lane: 'background' | 'all',
): number {
  let sum = 0;
  const seenCallIds = new Set<string>();
  let cursor: string | null | undefined = undefined;
  do {
    const page = store.queryEvents({
      types: ['llm/usage'],
      ...(window.sinceMs !== undefined ? { sinceMs: window.sinceMs } : {}),
      ...(window.sessionId !== undefined ? { sessionId: window.sessionId } : {}),
      limit: 10_000,
      ...(cursor !== undefined ? { cursor } : {}),
    });
    for (const event of page.events) {
      const data = event.data as {
        priority?: string;
        callId?: string;
        usage?: { input?: number; output?: number };
      };
      // 前台照入账不进闸门——仅 background 口径过滤；全道呈现口径照计。
      // 去重位在车道过滤之后：副本与原件同 priority（逐字复制）先后无影响
      if (lane === 'background' && data.priority !== 'background') continue;
      const callId = data.callId;
      if (callId !== undefined && callId !== '') {
        // fork/导入副本——同笔已计（跨会话副本在时间窗/全库聚合中相遇）
        if (seenCallIds.has(callId)) continue;
        seenCallIds.add(callId);
      }
      sum += (data.usage?.input ?? 0) + (data.usage?.output ?? 0);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined);
  return sum;
}

/** 当日后台已耗聚合（闸门口径——canAfford/预警三档/reserve 线的读侧单源） */
export function aggregateBackgroundSpentToday(
  store: { queryEvents(filter: QueryEventsFilter): QueryEventsResult },
  sinceMs: number,
): number {
  return aggregateUsageEvents(store, { sinceMs }, 'background');
}

/** 当日全道已耗聚合（呈现口径——allLanesSpentToday 读面的聚合腿：前台笔照进） */
export function aggregateSpentToday(
  store: { queryEvents(filter: QueryEventsFilter): QueryEventsResult },
  sinceMs: number,
): number {
  return aggregateUsageEvents(store, { sinceMs }, 'all');
}

/**
 * 会话累计聚合（07 §4.1 注⑪⑥a——V-4 底栏供数链）：指定会话 llm/usage
 * durable 事件聚合 SUM(input+output) 主计费桶。与当日双读面同族但**维度
 * 分立**——按 sessionId 域（非时间窗）、车道不过滤（呈现口径，同
 * aggregateSpentToday 的 all 腿）；翻页聚尽语义同共享核头注。
 */
export function aggregateSessionSpent(
  store: { queryEvents(filter: QueryEventsFilter): QueryEventsResult },
  sessionId: string,
): number {
  return aggregateUsageEvents(store, { sessionId }, 'all');
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
    throw new RangeError(`lane 并发容量须为正整数，收到 ${capacity}——空值是死配置`);
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

/** closer 内在飞 run 结算等待帽（件D1——须小于运行时 closer 总帽 5s：留强杀余量） */
export const RUN_SETTLE_WAIT_HAT_MS = 4000;

/** 结算等待轮询步长（件D1——结算在微任务链毫秒级完成，10ms 步长观测足够细） */
export const RUN_SETTLE_POLL_MS = 10;

/**
 * 帽内自持等待 run 闸归零（件D1——04 §1②「closer 收口 drain——在飞子代理/
 * 子进程结算及在飞后台 LLM 链」条款的码面兑现）：run 位释放附在结算尾段
 * （turn/end / llm/usage 桥接等收尾事件入队之后，driver 结算序——释放器
 * 挂 settled 链尾），故闸归零 ⟺ 收尾事件已在 write-behind 队列——closer
 * 等到这里才返，③ flush 才能把这些事件落 durable（修前形：无人等在飞
 * run，收尾事件在 ⑥ 关库后才入队）。
 *
 * @returns false = 到帽未归零（调用方 warn 后放行——帽子语义是放弃等待
 *   不是杀 run；残余事件由 write-behind 关库终态折失败态兜底〔件D1 ②层〕）
 */
export async function waitForRunLaneIdle(
  gate: { readonly inFlight: number },
  options: { hatMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  const hatMs = options.hatMs ?? RUN_SETTLE_WAIT_HAT_MS;
  const pollMs = options.pollMs ?? RUN_SETTLE_POLL_MS;
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let waited = 0;
  while (gate.inFlight > 0) {
    if (waited >= hatMs) return false;
    const slice = Math.min(pollMs, hatMs - waited);
    await sleep(slice);
    waited += slice;
  }
  return true;
}
