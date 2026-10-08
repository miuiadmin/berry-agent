/**
 * 固定区段优先级截断（07 §4.1 挂账解挂批 C②）——量高分配纯函数单源。
 *
 * 极小终端形（固定区各段量高总和 > 视口行数）依规范牺牲步序截断：
 * - 截断目标：固定区总高 ≤ 视口 - 1（正文滚动区至少 1 行）；
 * - 编辑器收缩制度位先行（2026-10-08 TUI 对标 Codex 五件批 A+B 语义收窄的
 *   态判定形）：进入截断态即先收编辑器至内容高（弃上下垫与最小高 3 铺垫
 *   ——**饰高最先行让**；下限 = max(EDITOR_MIN_HEIGHT, 内容高)，空稿形即 1
 *   ——V-0 注③ 框退役后框线零占位，composer 形下限即 1 不变）。序位定谳据：
 *   若编辑器收缩滞留梯内后段（旧序形），中间 sum 按量高原值（含垫与铺垫）
 *   虚高，梯先噬低段〔工具/todo/状态行2〕整段而编辑器终态仍收至内容高——
 *   空垫噬内容段，违「不噬内容行」与低段先让的优先级精神；故「预算不足时
 *   收缩至内容高」是编辑器段的态判定制度位而非梯内先后步，编辑器**内容行**
 *   是硬地板（梯永不噬——低段全让后才轮到弹层）；
 * - 低段牺牲梯（制度位后依序逐级让位）：工具进度缩→隐 → todo 缩→隐（低段
 *   「先缩后隐」——缩 = 帽内行数再降、隐 = 整段缺席零高度）→ 状态行行2 隐
 *   （V-4 注⑪⑧ 垂直牺牲梯：环境栈先于对话本体让位，行1 仪表恒保底）
 *   → 补全弹层隐（梯末位）；
 * - 段隐即零高度不虚报；overlay / input-ask 恒满高不截（模态栈与应答行
 *   是交互承诺面——残余溢出归 MainScreen baseRow 钳 0 兜底）。
 *
 * 补全弹层档序：07 条款未列档（弹层瞬态辅助面），落码定值 = 牺牲梯末位
 * （编辑器已收至内容高、低段全让后仍超预算才隐——梯内最后让位）。
 *
 * 本件纯函数零副作用零 IO——量高输入 / 分配输出，接线与生效锚（段高重算
 * 既有路 + repaint/resize 全量重画同收敛）归装配层 renderFixed。
 */

/** 输入框（编辑器）截断下限：内容 1 行——V-0 注③ 框退役（框线零占位）后「内容最小高」的落码定值；五件批 A+B 语义收窄后即空稿形（内容 1）的收缩目标 */
export const EDITOR_MIN_HEIGHT = 1;

/**
 * 截断预算（视口 - 1——正文滚动区至少 1 行；视口 1 行形下限兜 1）单源。
 * 装配层 overlay 视口帽（fx2-B）与本件分配梯共用同一预算算术——两处
 * 各自内联会漂（帽按旧预算放宽 = 固定区又可超高）。
 */
export function fixedBudgetRows(viewportRows: number): number {
  return Math.max(1, viewportRows - 1);
}

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
  /** 输入框（编辑器）量高（measure 原值——含帽钳呈现高与上下空行垫） */
  readonly editor: number;
  /**
   * 输入框帽内内容行数（裸视觉行数夹呈现帽、无垫——五件批 A+B 梯收缩目标：
   * 预算不足时 editor 收缩至 max(EDITOR_MIN_HEIGHT, 内容高)，弃垫与最小高铺
   * 垫不噬内容行。sweep23-件1：超帽内容不可呈现（编辑器内部滚动）——供数须
   * 夹帽，裸值令垫行借内容地板地位永不退让、固定区超屏）。
   */
  readonly editorContent: number;
  /** todo 面板量高 */
  readonly todo: number;
  /** 工具进度面板量高 */
  readonly tool: number;
  /**
   * 状态行想占行数（V-4 注⑪⑧ 笔3——三行栈量高原值：仪表行恒 1 + 环境行
   * 数据在场 1，即 1-2；无 footer 旧形恒 1）。行1 恒保底（截断钳 ≥1），
   * 行2 属垂直牺牲梯可让（todo 隐后隐去）。
   */
  readonly statusWanted: number;
}

/** 截断后的段量高分配（status 钳 1-2——行1 恒保底，行2 极小终端让位） */
export interface FixedBudget {
  readonly overlay: number;
  readonly ask: number;
  readonly popup: number;
  readonly editor: number;
  readonly todo: number;
  readonly tool: number;
  /** 状态行高（1-2：行1 仪表恒 1 + 行2 环境——极小终端让位可 1） */
  readonly status: number;
  /** 分配后固定区总高（= 各段和；极端形下可仍超预算——兜底归 baseRow 钳 0） */
  readonly total: number;
}

/**
 * 依优先级序分配固定区段量高：预算充足恒等直通（零截断零扰动）；超预算
 * 先收编辑器至内容高（制度位——弃垫与最小高铺垫，下限 1 不变）再逐级
 * 牺牲（每步仅在仍超预算时执行）——工具进度缩 1 → 工具进度隐 → todo
 * 缩 1 → todo 隐 → 状态行行2 隐（V-4 注⑪⑧ 垂直牺牲梯——仪表行恒保底）
 * → 补全弹层隐。
 */
export function allocateFixedBudget(input: FixedBudgetInput): FixedBudget {
  // 截断目标：总高 ≤ 视口 - 1（正文滚动区至少 1 行；视口 1 行形下限兜 1）
  const budget = fixedBudgetRows(input.viewportRows);
  let { overlay, ask, popup, editor, todo, tool } = input;
  // 状态行 1-2（想占行数钳制：仪表行恒保底 1、环境行至多 1）
  let status = Math.max(1, Math.min(input.statusWanted, 2));
  const sum = (): number => overlay + ask + popup + editor + todo + tool + status;
  if (sum() > budget) {
    // 编辑器收缩制度位（五件批 A+B——态判定先于低段牺牲梯）：进入截断态即
    // 弃上下垫与最小高 3 铺垫、收缩至帽内内容高（editorContent 夹帽供数——
    // sweep23-件1 口径：长稿形收缩到帽值非裸值；下限 = 内容 1 行——空稿形
    // 即 1，到下限恒不再下压。挖 24 勘正：原句「裸内容高」系 18bb067 旧词
    // 漏迁）。饰高先行让位防梯贪心错位：中间 sum 按量高
    // 原值虚高会把低段整段隐去而编辑器终态仍收至内容高——空垫噬内容段
    editor = Math.min(editor, Math.max(EDITOR_MIN_HEIGHT, input.editorContent));
    // 低段「先缩后隐」之一：工具进度面板（低段中之最低——瞬时活动面）
    if (sum() > budget) tool = Math.min(tool, 1); // 缩：帽内行数再降至 1
    if (sum() > budget) tool = 0; // 隐：整段缺席零高度
    // 低段「先缩后隐」之二：todo 面板
    if (sum() > budget) todo = Math.min(todo, 1);
    if (sum() > budget) todo = 0;
    // 状态行行2 隐（V-4 注⑪⑧ 垂直牺牲梯档位——todo 隐后：环境栈属辅助信息，
    // 先于对话本体让位；行1 仪表栈 + 尾注恒保底不截）
    if (sum() > budget) status = Math.min(status, 1);
    // 补全弹层（档序落码定值——编辑器已收至内容高仍超预算才隐）
    if (sum() > budget) popup = 0;
    // overlay / ask / status 行1 恒满高：残余溢出如实返回（兜底归 baseRow 钳 0）
  }
  return { overlay, ask, popup, editor, todo, tool, status, total: sum() };
}
