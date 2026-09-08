/**
 * L3 safety — 沙箱 seam（04 §8 执行 seam 与 fail-closed 条）。
 *
 * confine(argv, policy) → ConfinedArgv 是纯包装接口：后端无状态、策略逐调用
 * 携带、消费方（bash 工具等）自行 spawn——沙箱不造进程，只约束进程。后端
 * 差异数据化下发（denialSignatures / runnerFailureRules），消费方零后端知识。
 * 无可用后端抛 SANDBOX_UNAVAILABLE——fail-closed，绝不静默裸跑。
 *
 * 本文件同时持有：effective mode 三级解析的 fold 半边（显式档是调用方的
 * 事，会话 override 事件与部署缺省在此折叠）+ 升权词汇（严格变宽阶梯 /
 * 成对必填校验 / 统一拒绝标记）——bash 与 fs 两族工具共享同一 home，防文
 * 案与顺序漂移。
 *
 * 与 berry 分叉注记：①第三档定名 `danger`（短名——04 §8 拍板）；②折叠
 * 缺省档 = workspace-write（04 §8「个人开发机形态的实用缺省」；berry 的
 * read-only 兜底不承）。
 */

import { BaseError } from '../contracts/index.js';
import type { AllowlistDraft, ApprovalOutcome, ApprovalRequest, SandboxBackend, SandboxMode } from './types.js';
import { deriveWritableRoots } from './roots.js';
import { sensitiveReadFiles } from './sensitive.js';
// 平台链引用（函数体内才调用，无顶层互调——与后端文件的双向引用安全）
import { createSeatbeltBackend } from './seatbelt.js';
import { createBwrapBackend } from './bwrap.js';

/* ------------------------------------------------------------------ */
/* 策略与结果类型                                                       */
/* ------------------------------------------------------------------ */

/**
 * 沙箱策略（逐调用携带）。三档一律进 confine（04 §8 定形②「任何档一律」
 * 字面执法——2026-09-08 P0①）：danger 档同过最小读 deny profile（受限两
 * 档额外叠拒写与根允许），无「不进沙箱」的档位。
 */
export interface SandboxPolicy {
  /** 请求档位（三档全词汇；danger 形 = 最小读 deny——后端件分支定形） */
  readonly mode: SandboxMode;
  /** 工作区根（canonical 绝对路径；可写根推导锚点） */
  readonly workspaceRoot: string;
  /** 可写根显式覆盖（缺省 deriveWritableRoots(workspaceRoot, mode)——与 fs fence 同源） */
  readonly writableRoots?: readonly string[];
  /**
   * 读 deny 集显式覆盖（canonical 绝对路径；缺省由服务侧 dataDir 派生
   * enrich——调用方零敏感集知识。空数组 = 显式无读 deny；与 undefined
   * 「未携带」语义分立）。
   */
  readonly denyReadFiles?: readonly string[];
}

/**
 * 策略实际生效的可写根列表（缺省按档位推导；两个后端与 fs fence 共用同一
 * 来源。read-only 档空根——Seatbelt read-only profile 本就全拒写（不吃根列
 * 表）、Bwrap 空根即无 rw bind）。
 */
export function resolvePolicyRoots(policy: SandboxPolicy): readonly string[] {
  return policy.writableRoots ?? deriveWritableRoots(policy.workspaceRoot, policy.mode);
}

/** 后端强制完整性（04 §8：如实上报，上层裁决——runner 在场且策略全装 = full；缺席/部分装 = partial 回声拒绝） */
export type SandboxEnforcement = 'full' | 'partial';

/** runner 自身失败分类规则：fatalSignatures 命中 = runner 没跑起来（区别于策略拒绝生效） */
export interface RunnerFailureRule {
  readonly fatalSignatures: readonly string[];
}

/** confine 产物：受限 argv + 后端差异元数据（消费方 spawn 后据此分类 stderr） */
export interface ConfinedArgv {
  /** 包装后的 argv（含 runner 前缀；消费方直接 spawn） */
  readonly argv: string[];
  /** 所用后端的强制完整性 */
  readonly enforcement: SandboxEnforcement;
  /** 本后端「策略拒绝了」的 stderr 识别特征（大小写不敏感子串） */
  readonly denialSignatures: readonly string[];
  /** runner 自身失败的分类规则 */
  readonly runnerFailureRules: readonly RunnerFailureRule[];
}

/* ------------------------------------------------------------------ */
/* 三级解析的 fold 半边（04 §8 策略三级解析条）                          */
/* ------------------------------------------------------------------ */

/** 三档词汇守卫（fold 与配置解析共用；拼错档位必须响亮失败） */
export function isSandboxMode(value: string): value is SandboxMode {
  return value === 'read-only' || value === 'workspace-write' || value === 'danger';
}

/**
 * 折叠会话 sandbox/mode 事件序列 → 生效档（最后一条胜出）。缺省档 =
 * workspace-write（04 §8「个人开发机形态的实用缺省」——与 berry 的
 * read-only 兜底分叉）。载荷不在三档词汇内直接抛 SANDBOX_MODE_INVALID——
 * 静默跳过坏事件会沿用旧档，是 fail-open。
 */
export function resolveEffectiveMode(
  events: readonly { readonly mode: string }[],
  fallback: SandboxMode = 'workspace-write',
): SandboxMode {
  let mode = fallback;
  for (const event of events) {
    if (!isSandboxMode(event.mode)) {
      throw new BaseError(
        'SANDBOX_MODE_INVALID',
        `sandbox/mode 事件档位非法：${JSON.stringify(event.mode)}（三档词汇：read-only / workspace-write / danger）`,
      );
    }
    mode = event.mode;
  }
  return mode;
}

/* ------------------------------------------------------------------ */
/* 沙箱服务（confine fail-closed；后端链可替换）                        */
/* ------------------------------------------------------------------ */

/** 沙箱服务面（消费方：bash 工具件 / host 装配） */
export interface SandboxService {
  /** 纯包装：三档一律（04 §8 定形②）把消费方 argv 变为受限 argv（消费方自行 spawn） */
  confine(argv: readonly string[], policy: SandboxPolicy): ConfinedArgv;
  /** 注册沙箱后端（后端可替换面；返回注销器，幂等） */
  registerBackend(backend: SandboxBackend): () => void;
  /** 当前后端链快照（诊断/审计输出用） */
  listBackends(): readonly SandboxBackend[];
}

/** 沙箱服务选项 */
export interface SandboxServiceOptions {
  /** 初始后端链（缺省 createDefaultBackends() 平台链；传 [] 显式空链 = 测试用） */
  readonly backends?: readonly SandboxBackend[];
  /**
   * 数据目录（敏感件读集派生源——04 §7 读侧 carve-out）。缺省 null = 无敏
   * 感集（诊断形 :memory:：confine 零读 deny 行）。与 gate.dataDir 同注入
   * 律（safety 不 import persist——DAG 边表，装配层必填真 dataDir）。
   */
  readonly dataDir?: string | null;
}

/**
 * 组装沙箱服务。选后端规则（单候选链不预探测）：
 * - 空链 → confine 抛 SANDBOX_UNAVAILABLE（fail-closed）；
 * - 单候选 → 直接使用不预探测（探测有 spawn 开销，且坏了 spawn 会响亮
 *   失败，runnerFailureRules 负责分类）；
 * - 多候选 → 按注册序找首个 probe 通过者（无 probe 视为可用）——探测结果
 *   按后端缓存一次，探测失败的候选不重试。
 */
export function createSandboxService(opts: SandboxServiceOptions = {}): SandboxService {
  /** 后端链（注册序即优先序） */
  const chain: SandboxBackend[] = [...(opts.backends ?? createDefaultBackends())];
  /** probe 结果缓存（backend.id → 布尔；注销即清除） */
  const probeCache = new Map<string, boolean>();

  /**
   * 策略读 deny enrich：未显式携带 denyReadFiles 且装配持有 dataDir 时，
   * 以敏感件集单源补位（04 §7 读侧 carve-out 的 profile 腿数据源）。显式
   * 携带（含空数组）恒胜出——测试/宿主覆盖位不与单源打架。
   */
  const enrichPolicy = (policy: SandboxPolicy): SandboxPolicy =>
    policy.denyReadFiles === undefined && opts.dataDir != null
      ? { ...policy, denyReadFiles: sensitiveReadFiles(opts.dataDir) }
      : policy;

  /** 单个后端的可用性判定（无 probe = 视为可用；结果缓存一次） */
  const isAvailable = (backend: SandboxBackend): boolean => {
    if (!backend.probe) return true;
    if (!probeCache.has(backend.id)) {
      // 功能性探测：真跑一次 read-only 包装（后端实现负责），status 0 才证明内核确实执行
      probeCache.set(backend.id, backend.probe(PROBE_TIMEOUT_MS));
    }
    return probeCache.get(backend.id)!;
  };

  const service: SandboxService = {
    confine(argv, policy) {
      if (chain.length === 0) {
        // fail-closed：没有后端就拒绝执行，绝不静默裸跑（04 §8——任何档一律，
        // danger 不豁免：换档不是绕后端的路）
        throw new BaseError(
          'SANDBOX_UNAVAILABLE',
          `无可用沙箱后端，拒绝裸跑（后端链为空；${policy.mode} 档一律经沙箱——可安装沙箱后端）`,
        );
      }
      // 单候选直接用；多候选按 probe 仲裁
      const backend = chain.length === 1 ? chain[0]! : (chain.find((b) => isAvailable(b)) ?? undefined);
      if (!backend) {
        throw new BaseError(
          'SANDBOX_UNAVAILABLE',
          `后端链全部探测失败（${chain.map((b) => b.id).join(' → ')}），拒绝以 ${policy.mode} 档裸跑`,
        );
      }
      return {
        argv: backend.wrap(argv, enrichPolicy(policy)),
        enforcement: backend.enforcement,
        denialSignatures: backend.denialSignatures,
        runnerFailureRules: backend.runnerFailureRules,
      };
    },

    registerBackend(backend) {
      chain.push(backend);
      let done = false;
      return () => {
        if (done) return;
        done = true;
        // 同位注销护栏：仅当链尾仍是本后端时弹出（防误撤他者注册的同 id 后端）
        if (chain[chain.length - 1] === backend) {
          chain.pop();
          probeCache.delete(backend.id);
        }
      };
    },

    listBackends() {
      return [...chain];
    },
  };
  return service;
}

/** 功能性探测超时（毫秒）：真跑一次包装不该超过这个时长，超过视为不可用 */
const PROBE_TIMEOUT_MS = 5_000;

/** 平台默认后端链（04 §8：macOS Seatbelt / Linux bwrap；其余平台无后端——confine fail-closed，如实空链不假装覆盖） */
export function createDefaultBackends(): SandboxBackend[] {
  if (process.platform === 'darwin') return [createSeatbeltBackend()];
  if (process.platform === 'linux') return [createBwrapBackend()];
  return [];
}

/* ------------------------------------------------------------------ */
/* 升权词汇（04 §8 严格变宽升权条；bash 与 fs 共享同一 home）            */
/* ------------------------------------------------------------------ */

/** 严格变宽阶梯：只许变宽不许变窄绕行（read-only→两档 / workspace-write→danger / danger 无更宽） */
export const WIDER_MODES: Readonly<Record<SandboxMode, readonly SandboxMode[]>> = {
  'read-only': ['workspace-write', 'danger'],
  'workspace-write': ['danger'],
  danger: [],
};

/** 可请求的升权目标档（= 比受限两档更宽的「两档受限/全放」词汇中更宽者） */
export const ESCALATION_TARGETS: readonly SandboxMode[] = ['workspace-write', 'danger'];

/** 升权请求参数（模型经工具参数携带；current 由运行时注入防伪造） */
export interface EscalationArgs {
  /** 当前生效档（运行时注入——不是模型自报的「我现在什么档」） */
  readonly current: SandboxMode;
  /** 工具参数 sandbox_permissions（目标档；模型填写） */
  readonly sandboxPermissions: string | undefined;
  /** 工具参数 justification（升权理由；模型填写） */
  readonly justification: string | undefined;
}

/** 校验通过的升权请求 */
export interface ValidEscalation {
  readonly target: SandboxMode;
  readonly justification: string;
}

/**
 * 升权参数校验（04 §8 严格变宽条全在此）：sandbox_permissions 与
 * justification 强制成对非空（空句同非法）；目标必须是合法升权档；必须
 * 严格变宽（非变宽请求不弹窗直接拒，防窄绕行与同档重试噪音）。
 */
export function validateEscalationArgs(args: EscalationArgs): ValidEscalation {
  const perm = args.sandboxPermissions?.trim();
  const just = args.justification?.trim();
  // 成对非空：一边有一边无 = 参数残缺，不给问询机会（04 §8「拒在 schema 段」）
  if (!perm && !just) {
    throw new BaseError(
      'SANDBOX_ESCALATION_INVALID',
      '升权请求缺 sandbox_permissions 与 justification（两者必须成对提供）',
    );
  }
  if (!perm || !just) {
    throw new BaseError(
      'SANDBOX_ESCALATION_INVALID',
      `升权参数不成对：sandbox_permissions=${JSON.stringify(perm ?? '')} justification=${JSON.stringify(just ?? '')}（两者必须成对非空）`,
    );
  }
  if (!isSandboxMode(perm) || !ESCALATION_TARGETS.includes(perm)) {
    throw new BaseError(
      'SANDBOX_ESCALATION_INVALID',
      `升权目标档非法：${perm}（合法目标：${ESCALATION_TARGETS.join(' / ')}）`,
    );
  }
  if (!WIDER_MODES[args.current].includes(perm)) {
    // 非严格变宽（变窄或同档）：不问询直接拒——变窄绕行与无意义重试都不进审批
    throw new BaseError(
      'SANDBOX_ESCALATION_INVALID',
      `升权请求非严格变宽：${args.current} → ${perm}（当前档只可升至 ${WIDER_MODES[args.current].join(' / ') || '（已是最高档）'}）`,
    );
  }
  return { target: perm, justification: just };
}

/** 统一拒绝标记：被策略拒绝时回给模型的固定句式（工具结果与守门 block 共用） */
export function sandboxDenialMarker(mode: SandboxMode): string {
  return `[sandbox: file access denied under ${mode}]`;
}

/** 升权提示标记：拒绝后引导模型基于真实 denial 走正道（明确不许投机） */
export function escalationHintMarker(): string {
  return '[sandbox hint: 若确需本次访问，在同一工具调用中同时提供 sandbox_permissions（workspace-write 或 danger）与 justification 发起升权；拒绝是最终的——不许绕路、不许无真实拒绝依据的投机升权]';
}

/** 升权审批请求输入（ask 载荷组装源；allowed-once 只授予当次调用） */
export interface EscalationApprovalInput extends ValidEscalation {
  /** 升权起点档（审批 reason 注明） */
  readonly current: SandboxMode;
  /** 发起升权的工具名/调用 id（有则随审批记录） */
  readonly toolName?: string;
  readonly toolCallId?: string;
  /**
   * 推荐规则候选（04 §9 粘性段定形③）：bash 升权的「始终允许」草案（命令
   * 词干），仅 workspace-write 目标携带——danger 是 safety 高位，恒不带
   * 草案（「始终允许」选项不呈现）。
   */
  readonly suggestedEntry?: AllowlistDraft;
  /** 发起 run 的取消信号（调用方语境字段——answerer 桥接消费，机制不按它分支） */
  readonly signal?: AbortSignal;
}

/**
 * 走审批的升权序列：校验产物 → approval.ask（reason 注明目标档与理由）→
 * 原样返回结果元数据。allowed-once 的「只授予当次调用」由调用方保证（把
 * 返回的 target 仅用于本次 spawn，不写回会话 override）。
 */
export function requestEscalation(
  approval: { ask(req: ApprovalRequest): Promise<{ outcome: ApprovalOutcome }> },
  input: EscalationApprovalInput,
): Promise<{ outcome: ApprovalOutcome }> {
  return approval.ask({
    summary: `沙箱升权 ${input.current} → ${input.target}`,
    reason: `目标档 ${input.target}；理由：${input.justification}`,
    toolName: input.toolName,
    toolCallId: input.toolCallId,
    // run 取消信号随 ask 载荷透传（undefined 不携带）
    ...(input.signal !== undefined ? { signal: input.signal } : {}),
    ...(input.suggestedEntry !== undefined ? { suggestedEntry: input.suggestedEntry } : {}),
  });
}
