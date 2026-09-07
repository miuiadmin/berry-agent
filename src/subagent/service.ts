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

/** 程序化注册条目（物化读面——会话工具面组装时快照派生工具清单） */
export interface ProgrammaticProviderEntry {
  readonly def: ProgrammaticSubagentDef;
  /** 注册者插件 id（core: 含前缀原形） */
  readonly owner: string;
}

/** SubagentService 构造选项 */
export interface SubagentServiceOptions {
  /** Job 注册表（ctx.jobs 服务面本体——kind 'subagent' 由本服务构造时自登） */
  readonly registry: JobRegistry;
  /** 父会话通知面（组合根注入——词面独立律；background 结算/审批挂起两通知的落通道桥） */
  readonly notify?: SubagentNotifyFace;
  /** 结算钩子（goal foldDelegation 喂入 seam——组合根接线位；通知后、settle 前调） */
  readonly onSettled?: (settlement: DelegationSettlement) => void | Promise<void>;
  /** warn 面（缺省 console.warn） */
  readonly warn?: (message: string) => void;
}

/** 委派机器公开面 */
export interface SubagentService {
  /** 注册 named provider（声明式腿——撞名拒 SUBAGENT_PROVIDER_EXISTS，静态绑定面） */
  registerProvider(name: string, provider: SubagentProvider): void;
  /**
   * 程序化 named provider 注册（03 §2.2 第十二动词受局面——拒绝式两闸，
   * 执法序撞名前置格式：撞名经派生工具名 agent_<name> 比对 SUBAGENT_PROVIDER_EXISTS
   * → 裸词词法 SUBAGENT_NAME_INVALID；D 批 D-2）。
   * @returns 注销器（只摘本人条目——重注后旧注销器不误摘接任者）
   */
  registerProgrammatic(owner: string, def: ProgrammaticSubagentDef): Disposer;
  /** 程序化注册读面（注册序——物化消费：会话工具面组装时派生 agent_<name> 静态工具） */
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

  const service: SubagentService = {
    registerProvider(name, provider) {
      // 声明式腿（core:skills 物化调用）：词法在解析层执法（agents.ts——
      // name 是注册键不宽容），此处只管词法身份面撞名
      if (providers.has(name)) {
        throw new BaseError(
          'SUBAGENT_PROVIDER_EXISTS',
          `named provider「${name}」已注册（注册方 ${providers.get(name)?.owner}）——撞名拒（静态绑定面）`,
        );
      }
      providers.set(name, { provider, owner: 'declarative' });
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
        // 后台收场编舞（fire-and-forget——回执只携 Job 身份）：先 provider 黑盒
        // 跑完 → 通知先落（无条件先于归属释放）→ 结算钩子 → Job 条目后销
        void (async () => {
          let result: SubagentResult;
          try {
            result = normalizeResult(await provider.run(backgroundRequest));
          } catch (err) {
            result = errorResult(err);
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
      try {
        const result = normalizeResult(await provider.run(request));
        return { mode: 'one-shot', result };
      } catch (err) {
        return { mode: 'one-shot', result: errorResult(err) };
      }
    },
  };
  return service;
}
