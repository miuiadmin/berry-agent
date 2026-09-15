/**
 * emacs kill-ring（07 §4.1 R3 批 10j——批 10i 前挂账解挂）。
 *
 * 语义（规范定值）：kill 族动作（ctrl+w / alt+backspace 词删、ctrl+u / ctrl+k
 * 行删）被删段压环；ctrl+y yank 取环头插入；alt+y yankPop 环游标步进替换刚
 * yank 的段。环帽 32（最旧淘汰）；kill 入 undo（删除动作本身的 undo 编排归
 * 模型原语——本件只管环），yank / yankPop 不入 undo（恢复非破坏）。
 *
 * yank 区间账 = 位置 + 文本自校验形：yankPop 前校验「区间现文本 === 记账
 * 文本」——任何编辑（改该段 / 行结构变化 / 全清）自然失效，无需在各编辑
 * 原语散布清态点。环条目恒单行段或换行符（三 kill 原语的被删段皆行内形
 * ——多行粘贴不入环），区间账单行 [start,end) 即覆盖全部实际来源。
 */

/** 环帽（07 §4.1 R3 定值：kill-ring 环帽 32） */
export const KILL_RING_LIMIT = 32;

/** 刚 yank 的区间账（yankPop 替换位 + 自校验锚） */
export interface YankSpan {
  readonly line: number;
  readonly start: number;
  readonly end: number;
  /** 校验锚——区间现文本与此值不符即失效（被编辑） */
  readonly text: string;
}

/** kill 环：条目栈 + 环游标 + yank 区间账 */
export class KillRing {
  private readonly entries: string[] = [];
  /** 环游标（0 = 环头 = 最近 kill；yankPop 步进回绕） */
  private cursor = 0;
  private span: YankSpan | null = null;

  /** kill 压入（空段不入；压头、游标归零、超帽淘汰最旧） */
  push(text: string): void {
    if (text === '') return;
    this.entries.unshift(text);
    if (this.entries.length > KILL_RING_LIMIT) this.entries.pop();
    this.cursor = 0;
  }

  /** 游标位条目（yank 取值——空环 null） */
  current(): string | null {
    return this.entries[this.cursor] ?? null;
  }

  /** yankPop 步进（游标 +1 回绕）返回新条目（空环 null） */
  step(): string | null {
    if (this.entries.length === 0) return null;
    this.cursor = (this.cursor + 1) % this.entries.length;
    return this.entries[this.cursor] ?? null;
  }

  /** yank 区间账记（yank / yankPop 后调——pop 的替换位） */
  markYank(span: YankSpan): void {
    this.span = span;
  }

  /** 在案区间账（null = 无可 pop） */
  get activeSpan(): YankSpan | null {
    return this.span;
  }

  /** 区间账与行集吻合判（pop 前置——文本或行结构已变即失效） */
  spanIsValid(lines: readonly string[]): boolean {
    const span = this.span;
    if (span === null) return false;
    const line = lines[span.line];
    if (line === undefined) return false;
    return line.slice(span.start, span.end) === span.text;
  }

  /** 游标位条目判等（测试观测面——步进后取值核对） */
  entryAt(index: number): string | null {
    return this.entries[index] ?? null;
  }

  /** 条目数（测试观测面） */
  get size(): number {
    return this.entries.length;
  }
}
