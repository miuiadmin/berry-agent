/**
 * 委派机器（04 §10 两种收场/委派边界三层/静默退化防御的执法面）。
 *
 * 编舞序钉死：background 终态「通知先落、Job 条目后销」（结算通知
 * 无条件先于归属释放——「完成了但父永远不知道」不存在）；one-shot
 * 父同步等结果（黑盒——结果不重试，error 形立即结算给父）。
 *
 * 委派边界三层执法位：① 审批路由 = notifyApproval 闭包注入 request
 * （组合根桥父会话审批面）；② 档位快照 = in-process 工厂自带（host
 * 装配位——本件不立法）；③ 深度帽 + bash 排除 = 本件（深度拒 +
 * 派生面结构性剔除五名）。
 *
 * 注册面两腿（04 §10）：声明式腿 registerProvider（core:skills 解析层
 * 物化调用——词法在解析层执法）；程序化腿 registerProgrammatic（03 §2.2
 * 第十二动词 ctx.agent.registerSubagentProvider 受局面——D 批 D-2）。
 * 两腿同一 providers 册（run 路由单源）：**按注册者 id 分域存名**（owner
 * 维度——归因与防冒名载体，name 镜像裸词无域前缀）；撞名比对经派生
 * 工具名 `agent_<name>`（前缀单射——同名即同派生名）：跨层〔撞声明式
 * first-wins 全序既有位〕与跨插件同名统一经此拒。
 */
import {
  BaseError,
  SUBAGENT_DEPTH_MAX,
  type ProgrammaticSubagentDef,
  type SubagentProvider,
  type SubagentRequest,
  type SubagentResult,
} from '../contracts/index.js';
import type { Disposer } from '../context/index.js';
import type { JobRegistry } from './registry.js';
import { defBoundProvider } from './declarative.js';
import { subagentSettledContent } from './notify.js';
import { deriveToolSurface, findPrecheckGaps, intersectToolWhitelist } from './surface.js';
import {
  DEFAULT_SUBAGENT_PROVIDER,
  type DelegationInput,
  type DelegationOutcome,
  type DelegationSettlement,
  type SubagentNotifyFace,
} from './types.js';

/** diagnostic 上报帽（04 §10——≤4096 截断；契约面截断执法位在机器） */
const DIAGNOSTIC_MAX = 4096;

/** 子代理名词法帽（06 §11.2 name ≤64——与技能词法同源同值） */
const PROVIDER_NAME_MAX = 64;

/**
 * 单父在飞子代理扇出帽缺省值（04 §10 扇出帽段——码面缺省参数非契约
 * 常数：细节包值 20 对交互场景，本宿主子代理面向编排/调研，取向 8 与
 * Job per-kind 帽〔issue 2/trigger 4〕量级相称、宿主 lane 帽 16 内留
 * 交互余量；与委派深度帽〔缺省 3〕正交——深度拦嵌套、本帽拦扇出）。
 */
export const DEFAULT_SUBAGENT_FANOUT_LIMIT = 8;

/** 扇出帽 env 旋钮名（07 §8 env 表——与 BERRY_AGENT_MAX_CONCURRENT_RUNS 同形族） */
export const ENV_MAX_CONCURRENT_SUBAGENTS = 'BERRY_AGENT_MAX_CONCURRENT_SUBAGENTS';

/**
 * 扇出帽容量解析（04 §10 扇出帽段）：解析序 = 显式覆盖位 >
 * env `BERRY_AGENT_MAX_CONCURRENT_SUBAGENTS` > 缺省 8。非正整数
 * fail-loud 拒（RangeError）——空帽/坏帽是死配置（字串形全串 /^\d+$/
 * 判防 parseInt 截停，同 resolveRunLaneCapacity 律）。
 */
export function resolveSubagentFanoutLimit(
  override: number | undefined,
  env: Record<string, string | undefined>,
): number {
  const raw = override ?? env[ENV_MAX_CONCURRENT_SUBAGENTS];
  if (raw === undefined) return DEFAULT_SUBAGENT_FANOUT_LIMIT;
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
      `子代理扇出帽须为正整数，收到 ${String(raw)}——空帽/坏帽是死配置（${ENV_MAX_CONCURRENT_SUBAGENTS} / maxConcurrentPerParent）`,
    );
  }
  return value;
}

/**
 * 子代理名词法违例清单（空 = 合法）。裸词四查：字符集/长度/首尾连字符/
 * 连续连字符——与 skills validateSkillName 同形本地复刻（02 §4.1 无
 * subagent→skills 边，词法真源 06:386 frontmatter name 行，不经 import 共享）。
 */
function validateProviderName(name: string): string[] {
  const violations: string[] = [];
  if (name.length > PROVIDER_NAME_MAX) {
    violations.push(`超 ${PROVIDER_NAME_MAX} 字符（现 ${name.length}）`);
  }
  if (!/^[a-z0-9-]+$/.test(name)) {
    violations.push('含非法字符（只许小写字母/数字/连字符）');
  }
  if (name.startsWith('-') || name.endsWith('-')) {
    violations.push('首尾不得为连字符');
  }
  if (name.includes('--')) {
    violations.push('不得含连续连字符');
  }
  return violations;
}

/** 注册条目（分域存名载体：owner 归因面 + def 物化读面——04 §10） */
interface ProviderEntry {
  readonly provider: SubagentProvider;
  /** 注册者（程序化腿 = 插件 id；声明式腿 = 层位标签——归因与防冒名） */
  readonly owner: string;
  /** 程序化注册 def（物化读面载荷——声明式腿缺席此位） */
  readonly def?: ProgrammaticSubagentDef;
}

/** 程序化注册条目（注册册读面载荷——def 供动词层物化消费腿单条派生） */
export interface ProgrammaticProviderEntry {
  readonly def: ProgrammaticSubagentDef;
  /** 注册者插件 id（core: 含前缀原形） */
  readonly owner: string;
}

/** SubagentService 构造选项 */
export interface SubagentServiceOptions {
  /** Job 注册表（ctx.jobs 服务面本体——kind 'subagent' 由本服务构造时自登） */
  readonly registry: JobRegistry;
  /**
   * 单父在飞子代理扇出帽（04 §10 扇出帽段——per-parentSessionId 内存位，
   * 与 SESSION_ROUND_LIMIT 同律不进 durable；one-shot 与 background 同池
   * 同帽）。缺省经 resolveSubagentFanoutLimit（env 旋钮 > 8）。
   */
  readonly maxConcurrentPerParent?: number;
  /**
   * env 面（扇出帽旋钮解析取数——组合根注入 process.env；测试替身注入字典）。
   */
  readonly env?: Record<string, string | undefined>;
  /** 父会话通知面（组合根注入——词面独立律；background 结算/审批挂起两通知的落通道桥） */
  readonly notify?: SubagentNotifyFace;
  /** 结算钩子（goal foldDelegation 喂入 seam——组合根接线位；通知后、settle 前调） */
  readonly onSettled?: (settlement: DelegationSettlement) => void | Promise<void>;
  /** warn 面（缺省 console.warn） */
  readonly warn?: (message: string) => void;
}

/** 委派机器公开面 */
export interface SubagentService {
  /** 注册 named provider（声明式腿——撞名拒 SUBAGENT_PROVIDER_EXISTS，静态绑定面）
   * @returns 注销器（只摘本人条目——镜像 registerProgrammatic 三律②；RP5 物化
   *   腿 reload 全摘重挂的撤位载体） */
  registerProvider(name: string, provider: SubagentProvider, opts?: { owner?: string }): Disposer;
  /**
   * 程序化 named provider 注册（03 §2.2 第十二动词受局面——拒绝式两闸，
   * 执法序撞名前置格式：撞名经派生工具名 agent_<name> 比对 SUBAGENT_PROVIDER_EXISTS
   * → 裸词词法 SUBAGENT_NAME_INVALID；D 批 D-2）。
   * @returns 注销器（只摘本人条目——重注后旧注销器不误摘接任者）
   */
  registerProgrammatic(owner: string, def: ProgrammaticSubagentDef): Disposer;
  /** 程序化注册读面（注册序——注册册标准读面/测试断言位；物化消费腿在动词层即时派生〔遗漏审计批 G〕） */
  programmaticProviders(): readonly ProgrammaticProviderEntry[];
  /** provider 在册读面（声明式层 late-binding 消费位） */
  getProvider(name: string): SubagentProvider | undefined;
  /** 在册 provider 名单（诊断面） */
  providerNames(): readonly string[];
  /** 委派入口（两收场判别联合——one-shot 同步回执 / background 回执 Job 身份） */
  run(input: DelegationInput): Promise<DelegationOutcome>;
}

/** diagnostic 截断（保头——契约面 ≤4096 的单点执法） */
function truncateDiagnostic(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  if (text.length <= DIAGNOSTIC_MAX) return text;
  return `${text.slice(0, DIAGNOSTIC_MAX)}…（截断）`;
}

/** 结果归一（截断 diagnostic——黑盒回执面的机器侧整形） */
function normalizeResult(result: SubagentResult): SubagentResult {
  const diagnostic = truncateDiagnostic(result.diagnostic);
  if (diagnostic === result.diagnostic) return result;
  return { ...result, ...(diagnostic !== undefined ? { diagnostic } : {}) };
}

/** provider 异常 → 黑盒 error 结果（结果不重试——重试是父的策略不是子代理机制） */
function errorResult(err: unknown): SubagentResult {
  const message = err instanceof Error ? err.message : String(err);
  return { output: '', stopReason: 'error', diagnostic: message };
}

/** stopReason → Job 终态映射（stop→completed / error→failed / aborted→killed） */
function terminalOf(result: SubagentResult): { status: 'completed' | 'killed' | 'failed'; detail?: string } {
  if (result.stopReason === 'stop') return { status: 'completed' };
  if (result.stopReason === 'aborted')
    return { status: 'killed', ...(result.diagnostic !== undefined ? { detail: result.diagnostic } : {}) };
  return { status: 'failed', ...(result.diagnostic !== undefined ? { detail: result.diagnostic } : {}) };
}

/**
 * 建委派机器。kind 'subagent' 构造即登记（本件自有 kind——exec 'process' /
 * issue 'issue' 各消费件装载期自登，同注册表分立）。
 */
export function createSubagentService(options: SubagentServiceOptions): SubagentService {
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const providers = new Map<string, ProviderEntry>();
  options.registry.registerKind('subagent');

  // ── 单父扇出闸（04 §10 扇出帽段——per-parentSessionId 内存位） ──
  // 同 lane 帽哲学：满帽排队非拒收 FIFO（工具执行体内等待、释放依序续跑）；
  // 分账 = lane 拦「新 run 诞生」全局，本帽拦「单父子代理扇出」；one-shot
  // 与 background 同池同帽（同父语义连续）。
  const maxConcurrentPerParent = resolveSubagentFanoutLimit(options.maxConcurrentPerParent, options.env ?? {});
  interface FanoutSlot {
    active: number;
    /** 排队等待者（FIFO——释放时位直接移交：active 不减不增） */
    waiters: Array<() => void>;
  }
  const fanout = new Map<string, FanoutSlot>();

  /**
   * 同步试位（true = 已得位——**零异步边界**：one-shot 受理面同步跑到
   * provider.run，不因取位引入微任务〔「调用后同步推杆」的既有时序假设
   * 不破坏〕；false = 满帽，经 waitSlot 排队）。
   */
  function tryAcquireSlot(parentSessionId: string): boolean {
    let slot = fanout.get(parentSessionId);
    if (slot === undefined) {
      slot = { active: 0, waiters: [] };
      fanout.set(parentSessionId, slot);
    }
    if (slot.active < maxConcurrentPerParent) {
      slot.active++;
      return true;
    }
    return false;
  }

  /** 满帽等待（FIFO 排队——释放时位直接移交：active 不减不增）；排队项无独立停止位〔stopRequested 桥排队中缺席 = 诚实边界，成文不隐藏〕 */
  function waitSlot(parentSessionId: string): Promise<void> {
    const slot = fanout.get(parentSessionId);
    if (slot === undefined) return Promise.resolve(); // 防御位（理论不可达——tryAcquire 失败必已建槽）
    return new Promise<void>((resolve) => {
      slot.waiters.push(resolve);
    });
  }

  /** 释放（等待队首直接接位——位移交不经过计数；队空归零删键防 Map 无界驻留） */
  function releaseSlot(parentSessionId: string): void {
    const slot = fanout.get(parentSessionId);
    if (slot === undefined) return; // 防御位（理论不可达——acquire 必先建槽）
    const waiter = slot.waiters.shift();
    if (waiter !== undefined) {
      waiter();
      return;
    }
    slot.active--;
    if (slot.active <= 0 && slot.waiters.length === 0) fanout.delete(parentSessionId);
  }

  const service: SubagentService = {
    registerProvider(name, provider, opts) {
      // 声明式腿（core:skills/core:subagent 物化调用）：词法在解析层执法
      // （agents.ts——name 是注册键不宽容），此处只管词法身份面撞名
      if (providers.has(name)) {
        throw new BaseError(
          'SUBAGENT_PROVIDER_EXISTS',
          `named provider「${name}」已注册（注册方 ${providers.get(name)?.owner}）——撞名拒（静态绑定面）`,
        );
      }
      const entry: ProviderEntry = { provider, owner: opts?.owner ?? 'declarative' };
      providers.set(name, entry);
      // 注销器只摘本人条目（三律②——镜像 registerProgrammatic；reload 全摘
      // 重挂的撤位载体〔RP5〕；在飞委派闭包持有 provider 引用跑完自灭）
      return () => {
        if (providers.get(name) === entry) providers.delete(name);
      };
    },
    registerProgrammatic(owner, def) {
      // ── 闸一 撞名（前置格式闸——在册名必已合法，「名字被占用」更指向根因；
      // AGENT_ROLE/TRIGGER 同序）：比对经派生工具名 agent_<name>（前缀单射，
      // 同名即同派生名）——撞声明式 first-wins 全序既有位或兄弟插件程序化
      // 注册位统一经此拒；在册方 owner 入 message（分域存名的归因兑现）
      const existing = providers.get(def.name);
      if (existing !== undefined) {
        throw new BaseError(
          'SUBAGENT_PROVIDER_EXISTS',
          `named provider「${def.name}」已注册（注册方 ${existing.owner}）——派生工具 agent_${def.name} 重影即契约面漂移，拒绝式（04 §10 程序化注册槽）`,
        );
      }
      // ── 闸二 裸词词法（06 §11.6 声明式 name 同形——词法真源 06 §11.2）
      const violations = validateProviderName(def.name);
      if (violations.length > 0) {
        throw new BaseError(
          'SUBAGENT_NAME_INVALID',
          `子代理名「${def.name}」非裸词：${violations.join('；')}（镜像 06 §11.6 声明式 name 同形——04 §10 程序化注册槽）`,
        );
      }
      const entry: ProviderEntry = { provider: defBoundProvider(def, service), owner, def };
      providers.set(def.name, entry);
      // 注销器只摘本人条目（三律②——防过期时序误摘接任者）；卸载回卷即
      // 释放名（同名重注册无残留占用）；在飞委派闭包持有 provider 引用
      // 跑完自灭（黑盒结果不重试律兼容——不撤运行中的委派只撤注册位）
      return () => {
        if (providers.get(def.name) === entry) providers.delete(def.name);
      };
    },
    programmaticProviders() {
      const entries: ProgrammaticProviderEntry[] = [];
      for (const entry of providers.values()) {
        if (entry.def !== undefined) entries.push({ def: entry.def, owner: entry.owner });
      }
      return entries;
    },
    getProvider(name) {
      return providers.get(name)?.provider;
    },
    providerNames() {
      return [...providers.keys()];
    },
    async run(input) {
      // ── 委派边界③：深度帽（根 = 1；超帽拒——防自嵌套爆栈） ──
      if (input.depth > SUBAGENT_DEPTH_MAX) {
        throw new BaseError(
          'SUBAGENT_DEPTH_EXCEEDED',
          `委派深度 ${input.depth} 超帽 ${SUBAGENT_DEPTH_MAX}——拒自嵌套爆栈（04 §10 委派边界③）`,
        );
      }
      // ── 静态绑定路由：provider 缺席拒（模型不可见动态选择器） ──
      const providerName = input.providerName ?? DEFAULT_SUBAGENT_PROVIDER;
      const provider = providers.get(providerName)?.provider;
      if (provider === undefined) {
        throw new BaseError(
          'SUBAGENT_PROVIDER_UNKNOWN',
          `委派路由「${providerName}」未注册——in-process 真工厂归 host 装配批接线`,
        );
      }
      // ── 静默退化防御②：spawn 前预检闸（fail-ask 不降级瞎跑） ──
      const gaps = findPrecheckGaps(input.requiresTools, input.availableTools);
      if (gaps.length > 0) {
        throw new BaseError(
          'SUBAGENT_PRECHECK_FAILED',
          `前置要求工具缺席——拒起跑并回执缺口：${gaps.join('、')}${input.availableTools === undefined ? '（宿主工具面不可枚举——fail-closed 全列）' : ''}`,
        );
      }
      // background 能力预检（同预检闸族——provider 声明不受理即拒）
      if (input.background === true && provider.capabilities.background !== true) {
        throw new BaseError(
          'SUBAGENT_PRECHECK_FAILED',
          `provider「${providerName}」不支持后台收场（capabilities.background=false）——预检拒`,
        );
      }
      // ── 派生工具面 + 白名单交集（04 §10：父面 − 五名 ∩ 白名单） ──
      const effectiveTools =
        input.availableTools !== undefined
          ? intersectToolWhitelist(deriveToolSurface(input.availableTools), input.tools)
          : input.tools; // 父面不可枚举（纯逻辑腿/无会话语境）——白名单透传，交集执法归 in-process 工厂
      const jobName = input.name ?? providerName;
      const request: SubagentRequest = {
        prompt: input.prompt,
        ...(effectiveTools !== undefined ? { tools: [...effectiveTools] } : {}),
        ...(input.model !== undefined ? { model: input.model } : {}),
        ...(input.systemPrompt !== undefined ? { systemPrompt: input.systemPrompt } : {}),
        name: jobName,
        depth: input.depth + 1, // 子栈委派工具的深度位（机器注入逐层 +1）
      };
      if (input.background === true) {
        if (options.notify === undefined) {
          warn('通知面缺席——background 结算通知将降级为注册表条目（装配残缺档；批 12 装配面接线位）');
        }
        const handle = options.registry.register({ kind: 'subagent', name: jobName, owner: input.parentSessionId });
        // 子栈机器注入位：审批挂起路由（one-shot 不注入）+ 协作停止观察
        const backgroundRequest: SubagentRequest = {
          ...request,
          background: true,
          parentSessionId: input.parentSessionId,
          ...(options.notify !== undefined
            ? {
                notifyApproval: (info) =>
                  options.notify!.notifyApprovalPending({
                    parentSessionId: input.parentSessionId,
                    jobName,
                    approvalId: info.approvalId,
                    toolName: info.toolName,
                    ...(info.reason !== undefined ? { reason: info.reason } : {}),
                  }),
              }
            : {}),
          stopRequested: () => handle.entry.status === 'stopping',
        };
        // 后台收场编舞（fire-and-forget——回执只携 Job 身份）：register 先行
        // （m5 定形——Job 条目先落 running〔帽满排队期状态面可见〕、run() 回执
        // jobId 不因帽满延后、取位等待在条目落账后的执行段）→ 取位 → provider
        // 黑盒跑完 → 通知先落（无条件先于归属释放）→ 结算钩子 → Job 条目后销
        void (async () => {
          // 同步 fast-path 优先（与 one-shot 同形——满帽才入异步 FIFO 等待）
          if (!tryAcquireSlot(input.parentSessionId)) {
            await waitSlot(input.parentSessionId);
          }
          let result: SubagentResult;
          try {
            result = normalizeResult(await provider.run(backgroundRequest));
          } catch (err) {
            result = errorResult(err);
          } finally {
            releaseSlot(input.parentSessionId);
          }
          if (options.notify !== undefined) {
            try {
              await options.notify.notifySettled({
                parentSessionId: input.parentSessionId,
                content: subagentSettledContent({ jobName, result }),
              });
            } catch (err) {
              warn(`结算通知失败（不吞结算——注册表条目仍终态）：${err instanceof Error ? err.message : String(err)}`);
            }
          }
          try {
            await options.onSettled?.({ parentSessionId: input.parentSessionId, jobName, result });
          } catch (err) {
            warn(`结算钩子异常（不吞结算）：${err instanceof Error ? err.message : String(err)}`);
          }
          handle.settle(terminalOf(result));
        })();
        return { mode: 'background', jobName, jobId: handle.entry.id };
      }
      // ── one-shot：父同步等结果（黑盒——异常折 error 结果不重试） ──
      // 校验闸（深度/路由/预检/能力）已全部跑完——取位在闸后（拒径不占位）；
      // 同步 fast-path 取位：有位情形零异步边界直达 provider.run（「run 调用
      // 后同步推杆」的既有调用时序不因闸引入微任务而破坏——m-2 受理即已落
      // 账律同族考量），满帽才入异步 FIFO 等待
      if (!tryAcquireSlot(input.parentSessionId)) {
        await waitSlot(input.parentSessionId);
      }
      try {
        const result = normalizeResult(await provider.run(request));
        return { mode: 'one-shot', result };
      } catch (err) {
        return { mode: 'one-shot', result: errorResult(err) };
      } finally {
        releaseSlot(input.parentSessionId);
      }
    },
  };
  return service;
}
