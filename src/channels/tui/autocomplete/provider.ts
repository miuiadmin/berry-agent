/**
 * 补全协议件（07 §4.1 引擎节件 6（组件与呈现装配件））：多行坐标协议 + 候选条目 + 取补全接口。
 *
 * 多行坐标协议（承 berry @-mention 协议签名）：上下文带 lines/cursorLine/
 * cursorCol——按多行输入件坐标定位光标 token，弹层与源都只认本协议。
 * R6 批 10j：查询升**异步形**——源可返同步数组（union 快路）或 Promise
 * （重活源），signal 线传取消在途；同步源免包装同面。
 */

/** 补全上下文（多行输入件坐标——模型只读投影） */
export interface AutocompleteContext {
  readonly lines: readonly string[];
  readonly cursorLine: number;
  readonly cursorCol: number;
}

/** 补全候选条目 */
export interface AutocompleteItem {
  /** 呈现主文案 */
  readonly label: string;
  /** 右侧补充说明（弹层右对齐 dim 段） */
  readonly detail?: string;
  /**
   * 整 token 代换单位：完整新 token 文本（含触发前缀——'/model'、
   * '@"my file.txt"' 引号形防尾空格击穿：label 含空格时源侧以引号包裹，
   * 后续输入的空白不再把 token 劈开击穿补全）。
   */
  readonly replacement: string;
}

/** 取补全结果（token 代换区间 = 光标所在逻辑行的 [start,end)） */
export interface AutocompleteResult {
  readonly items: readonly AutocompleteItem[];
  /** 行内 UTF-16 起点（token 首） */
  readonly replaceStart: number;
  /** 行内 UTF-16 终点（= 光标位——只代换光标前段） */
  readonly replaceEnd: number;
}

/** 源返回形（union——同步数组快路 / Promise 异步源，R6 批 10j） */
export type AutocompleteItems = readonly AutocompleteItem[] | Promise<readonly AutocompleteItem[]>;

/** 取补全结果形（同 union 律——同步源同步交付、异步源微task 交付） */
export type AutocompleteOutcome = AutocompleteResult | null | Promise<AutocompleteResult | null>;

/** 补全源接口（组合件之外的独立源实现面） */
export interface AutocompleteProvider {
  /** 无补全返回 null（弹层不显）；signal = 取消在途（R6——源按需受理） */
  getCompletions(context: AutocompleteContext, signal?: AbortSignal): AutocompleteOutcome;
}
