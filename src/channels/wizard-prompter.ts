/**
 * 配置向导提问器接口（07 §4.1 onboarding ob-3——/setup 三步轻向导的交互
 * 契约）：流程件（host/setup-wizard）纯函数化——一切呈现经本接口注入，
 * 流程分支直锁测试零 TUI 渲染依赖；TUI 实装（tui/panels/setup-wizard 副屏
 * 相态机件）实现本接口。接口居 channels 公开面（host → channels 既有边，
 * 实装件内消费同模块零新边）。
 *
 * 语义约定（两消费面共守）：
 * - select/text/confirm 的取消（Esc/q）= 回 **undefined**——流程侧解释为
 *   中止该步（保存前中止 = 零改动）；confirm 的明确应答回 boolean；
 * - 敏感录入（text sensitive）呈现面**掩码不回显明文**——值只经回值进
 *   流程，态可入面、值恒不入面（/status 凭证态行同律）；
 * - preview（头4尾4形）在场时空录入 = 沿用当前值（重入默认值语义——
 *   流程侧解释，呈现面只呈预览）；
 * - intro 非阻塞（fire-and-forget）；outro 阻塞至用户确认（任意键收尾）。
 */

/** 单选项（id = 流程回值；label = 呈现行） */
export interface WizardSelectItem {
  readonly id: string;
  readonly label: string;
}

/** 列表选择请求 */
export interface WizardSelectRequest {
  readonly title: string;
  readonly items: readonly WizardSelectItem[];
  /** 预选项 id（重入默认值——光标初始位；缺席 = 首项） */
  readonly preselect?: string;
  /** 尾注行（dim 呈现——指路/说明；缺席不呈） */
  readonly note?: string;
}

/** 文本录入请求 */
export interface WizardTextRequest {
  readonly title: string;
  /** 敏感录入（掩码呈现——键入不回显明文） */
  readonly sensitive?: boolean;
  /** 已存值头尾预览（`sk-1…wxyz` 形——在场时空录入 = 沿用当前值） */
  readonly preview?: string;
  /** 输入提示（dim——粘贴容错说明等；缺席不呈） */
  readonly hint?: string;
}

/** 是非确认请求 */
export interface WizardConfirmRequest {
  readonly title: string;
  /** enter 直取的缺省选择（重入敏感步缺省 false——防误触改配置） */
  readonly defaultYes: boolean;
}

/** 提问器五法（流程件唯一交互面——TUI 实装消费同一接口） */
export interface WizardPrompter {
  /** 开场（非阻塞——流程随即进入首问） */
  intro(title: string, lines: readonly string[]): void;
  /** 列表选择（undefined = 取消该步） */
  select(req: WizardSelectRequest): Promise<string | undefined>;
  /** 文本录入（undefined = 取消该步；回值原样——剥前缀归流程侧单源） */
  text(req: WizardTextRequest): Promise<string | undefined>;
  /** 是非确认（undefined = 取消该步） */
  confirm(req: WizardConfirmRequest): Promise<boolean | undefined>;
  /** 收尾（阻塞至用户确认——任意键关屏；流程终局唯一出口） */
  outro(title: string, lines: readonly string[]): Promise<void>;
}
