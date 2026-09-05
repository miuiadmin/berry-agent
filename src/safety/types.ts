/**
 * L3 safety — 公共类型词汇（04 §8 沙箱栈 / §9 审批与动作安全）。
 *
 * 两个正交旋钮（04 §9）：sandbox 档（三档文件效果）× 审批策略档（ask /
 * never）——两闸独立，不合成一个「安全级别」糊面。预设只是用户面打包，
 * 组合逻辑不进执行路径。
 *
 * 与 berry 分叉注记：三档第三席本仓定名 `danger`（04 §8 拍板句「机器面
 * 枚举字面以短名为准」——berry 的 `danger-full-access` 不承，两名并存已
 * 于 2026-09-06 终结）；审批请求归属恰一键 `{sessionId}`（立项改造裁决：
 * 承 berry 删插件位）。
 */

import type { RunnerFailureRule, SandboxEnforcement, SandboxPolicy } from './sandbox.js';

/** 三档文件效果词汇（04 §8）：只管文件效果——网络与进程可见性显式排除在词汇外 */
export type SandboxMode = 'read-only' | 'workspace-write' | 'danger';

/** 受限档（danger 之外的档位——SandboxPolicy 能携带的 mode；danger 不进 confine 直接透传） */
export type ConfinedSandboxMode = Exclude<SandboxMode, 'danger'>;

/** 审批策略档位闭集恰两值（04 §9）：ask 悬置问询（无人应答 fail-closed）/ never 确定性拒绝回执 */
export type ApprovalPolicyMode = 'ask' | 'never';

/** 审批结局闭集恰四值（04 §9 审批对条款；allowed-once 只授予当次调用） */
export type ApprovalOutcome = 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable';

/**
 * 审批决策理由来源闭集恰五值（04 §9 粘性段 2026-09-06 定形②）：审计面可
 * 分辨「谁放的行」——无第六值；粘性/子集命中短路在 ask 之前（无审批对），
 * 本字段出现在 ask 返回元数据与 approval/decided 落账载荷两处。
 */
export type DecisionSource =
  | 'user' // 用户按键裁决（approve / reject / cancel / always 四值答案）
  | 'sticky' // 会话键缓存命中（粘性第 1 款——同指纹 always 后免问）
  | 'subset' // 子集预批命中（粘性第 2 款——同目标更严档位请求被既有放行包含）
  | 'timeout' // 超时或无应答者收口（headless 无人挂同归此源——fail-closed）
  | 'policy-never'; // never 档确定性拒绝（策略面定死「问都不问」）

/**
 * answerer（审批应答者）的四值答案闭集（04 §9）——经 approval/answer
 * waterfall 短路返回。`always` = 该指纹粘性放行：批准本次 + 经装配注入的
 * 写入回调落跨会话 allowlist 条目（04 §9 粘性段定形③草案条款）；载荷必须
 * 携带 suggestedEntry 草案才呈现该选项——无草案的 always 防御收口视同
 * approve（零草案零副作用）。
 */
export type ApprovalAnswer = 'approve' | 'reject' | 'cancel' | 'always';

/**
 * 审批推荐规则候选（04 §9 粘性段定形③草案条款）：由请求动作生成的
 * allowlist 条目草案——用户选 always 即按此形状写用户配置层。生成规则：
 * fs 族 = 该次写目标的精确 canonical 路径（不取公共目录——批这一次不升格
 * 批全仓）；bash 族 = 剥壳命令词干（≤2 词「命令 [子命令]」，剥不出干净
 * 词干即无草案）；升权目标为 danger 的高位动作恒不携带（选项不呈现）。
 */
export interface AllowlistDraft {
  /** 目标工具名（宿主面统一词汇——与 AllowlistEntry.tool 同源） */
  readonly tool: string;
  /** 条目模式：fs = 精确 canonical 路径 / bash = 剥壳词干 */
  readonly pattern: string;
}

/**
 * 粘性动作指纹（04 §9 粘性第 1/2 款的键形）：策略 + 沙箱档 + 目标摘要的
 * 结构化形——调用方组装（gate/exec 各自的目标语义），ApprovalService 据此
 * 查会话键缓存与子集预批。目标字符串语义由调用方定义（fs = canonical 路径
 * / bash = 命令词干 / 升权 = 目标档词）；tier 参与子集判定（偏序：
 * read-only ⊂ workspace-write ⊂ danger——更严=更窄的请求被更宽的既有
 * 放行包含）。
 */
export interface StickyKey {
  /** 目标摘要（canonical 路径 / 命令词干等——同目标才谈得上免问） */
  readonly target: string;
  /** 请求档位（子集预批的偏序维度） */
  readonly tier: SandboxMode;
}

/**
 * 审批请求（04 §9：含 reason、请求方、目标动作摘要——审计自包含）。
 * 归属 ownership 由 approval 服务在装配闭包织入（恰一键 {sessionId}——
 * 子代理在父会话内发起的审批落回父会话呈现面）；approvalId 由服务 ask
 * 织入。
 */
export interface ApprovalRequest {
  /** 目标动作摘要（人可读一行；升权场景含目标档与理由） */
  readonly summary: string;
  /** 请求方/理由（升权审批注明目标档与 justification） */
  readonly reason?: string;
  /** 发起审批的工具名（有则记录） */
  readonly toolName?: string;
  /** 关联的工具调用 id（有则记录） */
  readonly toolCallId?: string;
  /** 挂起身份（服务 ask 织入——多驱动单输入框下 TUI 弹窗显示短形防串答） */
  readonly approvalId?: string;
  /** 归属标签（装配期闭包织入——恰一键 sessionId，answerer 渲染归属前缀的载荷源） */
  readonly ownership?: { readonly sessionId: string };
  /** 粘性指纹（在场则 ask 前先查会话键缓存/子集预批——命中免问放行） */
  readonly stickyKey?: StickyKey;
  /**
   * 推荐规则候选（04 §9 粘性段定形③）：在场时 answerer 呈现「始终允许」
   * 选项；用户选 always → 按此草案经写入回调落跨会话 allowlist。高位动作
   * （升权目标 danger）不携带。
   */
  readonly suggestedEntry?: AllowlistDraft;
  /**
   * 发起 run 的取消信号（04 §9 run 信号透传条款）：调用方语境字段——
   * answerer 桥接消费（run abort 即撤销在身提问，保守收场落 cancelled——
   * 打断非拒绝的诚实落账），守门/执行机制不按它分支。
   */
  readonly signal?: AbortSignal;
}

/** 沙箱后端统一接口（04 §8：后端可替换；seam 与强制点在宿主，后端是数据+包装） */
export interface SandboxBackend {
  /** 后端标识（'seatbelt' / 'bwrap' / 自定义） */
  readonly id: string;
  /** 本后端的强制完整性（如实上报——runner 在场且策略全装 = full；上层裁决 partial 的回声拒绝面） */
  readonly enforcement: SandboxEnforcement;
  /** 本后端被策略拒绝时的 stderr 识别特征（大小写不敏感子串） */
  readonly denialSignatures: readonly string[];
  /** runner 自身失败的分类规则（区别「runner 没跑起来」与「策略拒绝生效」） */
  readonly runnerFailureRules: readonly RunnerFailureRule[];
  /** 纯包装：消费方 argv → 受限 argv（消费方自行 spawn——沙箱不造进程） */
  wrap(argv: readonly string[], policy: SandboxPolicy): string[];
  /** 功能性探测：真跑一次 read-only 包装验证内核确实执行（可选；单候选链不预探测） */
  probe?(timeoutMs: number): boolean;
}

/** 可写根推导输入（04 §8 deriveWritableRoots 表：mode 一等输入——read-only 档空根才真拦写） */
export interface WritableRootsInput {
  /** 工作区根（会话锚定的工作目录） */
  readonly workspace: string;
  /** 当前生效档位取值器（与守门行同款 getter 形态——每次 fence 检查取最新） */
  readonly mode: () => SandboxMode;
}
