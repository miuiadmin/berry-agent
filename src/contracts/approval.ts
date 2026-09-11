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
 * cancel/always。收口对齐 04 §9 run 信号透传 ask 链——会话关闭 / run 打断
 * 收口 → `'cancel'`（非 unavailable）；`always` + 草案的策略表回写经
 * 装配注入回调（onApprovalAlways）。
 */
export type ApprovalAskAnswer = 'approve' | 'reject' | 'cancel' | 'always';

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
