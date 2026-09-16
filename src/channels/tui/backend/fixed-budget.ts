/**
 * 固定区段优先级截断（07 §4.1 挂账解挂批 C②）——量高分配纯函数单源。
 *
 * 极小终端形（固定区各段量高总和 > 视口行数）依规范优先级序截断：
 * - 截断目标：固定区总高 ≤ 视口 - 1（正文滚动区至少 1 行）；
 * - 优先级序：状态行恒保底 > 输入框（随 R3 高度帽自适应收窄至内容最小高，
 *   下限 = 边框 2 + 内容 1 = 3）> todo 面板与工具进度面板（低段先缩后隐——
 *   缩 = 帽内行数再降、隐 = 整段缺席零高度）；
 * - 段隐即零高度不虚报；overlay / input-ask 恒满高不截（模态栈与应答行
 *   是交互承诺面——残余溢出归 MainScreen baseRow 钳 0 兜底）。
 *
 * 补全弹层档序：07 条款未列档（弹层瞬态辅助面），落码定值 = 牺牲梯居
 * 输入框收窄之后、其余低段之前（编辑器缩至下限仍超预算才隐弹层）。
 *
 * 本件纯函数零副作用零 IO——量高输入 / 分配输出，接线与生效锚（段高重算
 * 既有路 + repaint/resize 全量重画同收敛）归装配层 renderFixed。
 */

/** 输入框（编辑器）截断下限：边框 2 + 内容 1——「内容最小高」的落码定值 */
export const EDITOR_MIN_HEIGHT = 3;

/** 截断预算内的段量高输入（各段 measure 原值——分配前无预收窄） */
export interface FixedBudgetInput {
  /** 视口总行数（截断预算 = 视口 - 1） */
  readonly viewportRows: number;
  /** overlay 段合计量高（模态栈各层量高之和——恒满高不截） */
  readonly overlay: number;
  /** input-ask 提示行量高（在场恒 1——恒保不截） */
  readonly ask: number;
  /** 补全弹层量高（不可见恒 0） */
  readonly popup: number;
  /** 输入框（编辑器）量高（截断下限 EDITOR_MIN_HEIGHT） */
  readonly editor: number;
  /** todo 面板量高 */
  readonly todo: number;
  /** 工具进度面板量高 */
  readonly tool: number;
}

/** 截断后的段量高分配（status 恒 1——状态行恒保底） */
export interface FixedBudget {
  readonly overlay: number;
  readonly ask: number;
  readonly popup: number;
  readonly editor: number;
  readonly todo: number;
  readonly tool: number;
  /** 状态行高（恒 1） */
  readonly status: number;
  /** 分配后固定区总高（= 各段和；极端形下可仍超预算——兜底归 baseRow 钳 0） */
  readonly total: number;
}

/**
 * 依优先级序分配固定区段量高：预算充足恒等直通（零截断零扰动）；超预算
 * 逐级牺牲（每步仅在仍超预算时执行）——工具进度缩 1 → 工具进度隐 →
 * todo 缩 1 → todo 隐 → 输入框收窄至下限 → 补全弹层隐。
 */
export function allocateFixedBudget(input: FixedBudgetInput): FixedBudget {
  // 截断目标：总高 ≤ 视口 - 1（正文滚动区至少 1 行；视口 1 行形下限兜 1）
  const budget = Math.max(1, input.viewportRows - 1);
  let { overlay, ask, popup, editor, todo, tool } = input;
  const status = 1;
  const sum = (): number => overlay + ask + popup + editor + todo + tool + status;
  if (sum() > budget) {
    // 低段「先缩后隐」之一：工具进度面板（低段中之最低——瞬时活动面）
    if (sum() > budget) tool = Math.min(tool, 1); // 缩：帽内行数再降至 1
    if (sum() > budget) tool = 0; // 隐：整段缺席零高度
    // 低段「先缩后隐」之二：todo 面板
    if (sum() > budget) todo = Math.min(todo, 1);
    if (sum() > budget) todo = 0;
    // 输入框收窄至下限（对话本体——低段全隐后仍超才动；到下限恒不再下压）
    if (sum() > budget) editor = Math.min(editor, EDITOR_MIN_HEIGHT);
    // 补全弹层（档序落码定值——编辑器已收至下限仍超预算才隐）
    if (sum() > budget) popup = 0;
    // overlay / ask / status 恒满高：残余溢出如实返回（兜底归 baseRow 钳 0）
  }
  return { overlay, ask, popup, editor, todo, tool, status, total: sum() };
}
