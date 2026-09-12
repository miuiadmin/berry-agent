/**
 * 审批 ask 跨模块词汇（07 §4.3 提问队列条款 + 04 §9 审批链的呈现载荷）。
 *
 * 属地裁决（批 11b 契约先行）：原住 channels/types.ts（批 10e-2 通道核
 * askApproval 面定稿时落）——conversation 件（fresh 作用域审批三件）消费
 * 同形而依 02 §4.1 边表不可达 channels，闭集词汇归位 contracts 单源；
 * channels 侧改 import + re-export，公开面零变化。
 */

/**
 * 审批 ask 应答闭集（07 §4.3 提问队列条款——审批入队契约）：approve/reject/
 * cancel/always/unavailable。收口语义两分立（对齐 04 §9 run 信号透传 ask 链）：
 * 会话关闭 / run 打断收口 → `'cancel'`（用户主动终止语境）；降级到底（全部
 * 后端无 approval capability——headless 单发形态的结构态）→ `'unavailable'`
 * （呈现面结构性无人可答——ApprovalService 侧落 outcome unavailable +
 * source timeout，04 §9 无应答者语义；2026-09-13 真模型实测批增，修前误答
 * `'cancel'` 致 decided 错标 cancel/user 双失真）；`always` + 草案的策略表
 * 回写经装配注入回调（onApprovalAlways）。
 */
export type ApprovalAskAnswer = 'approve' | 'reject' | 'cancel' | 'always' | 'unavailable';

/**
 * 审批 ask 呈现载荷（07 §4.3——通道侧形）：channels 与 safety 边表互无边
 * （02 §4.1），safety 侧 ApprovalRequest 经装配根映射注入本形；`suggestedEntry`
 * = 「始终允许」草案条目（04 §9 ③ 策略表 allow 条目回写目标；无草案 = always 选项
 * 语义上不呈现、防御收口视同 approve）。
 */
export interface ApprovalAskRequest {
  /** 目标动作摘要（人可读一行——面板标题） */
  readonly summary: string;
  /** 请求方/理由（有则呈现说明段） */
  readonly reason?: string;
  /** 发起审批的工具名（有则呈现） */
  readonly toolName?: string;
  /** 挂起身份短形（多驱动单输入框下防串答） */
  readonly approvalId?: string;
  /** 「始终允许」草案条目（策略表 allow 条目回写目标；缺席 = always 防御收口视同 approve） */
  readonly suggestedEntry?: string;
}
