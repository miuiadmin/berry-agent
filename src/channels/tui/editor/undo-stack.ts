/**
 * 泛型 undo 栈（多行输入件 Editor 件族基件——07 §4.1 引擎节件 6（组件与呈现装配件）
 * 「undo 上限收 v1」条款的载体）。
 *
 * clone-on-push：入栈即深拷贝快照（structuredClone），弹出直付（已脱钩
 * 无需再拷）；上限超量丢最旧（上限值码面定 100——与输入历史帽同值，
 * 规范只钉「有上限」不收数字）。
 */
/** 快照类型约束：可 structuredClone 的纯数据形 */
// （泛型约束不写死——structuredClone 接受任意可克隆值，调用面以类型保证）

/** undo 栈：深拷贝快照栈 + 上帽丢最旧 */
export class UndoStack<S> {
  private readonly stack: S[] = [];

  constructor(private readonly limit: number = 100) {}

  /** 深拷贝入栈（超帽丢最旧——最近编辑永远可撤） */
  push(state: S): void {
    this.stack.push(structuredClone(state));
    if (this.stack.length > this.limit) this.stack.shift();
  }

  /** 弹出最近快照（空栈 undefined） */
  pop(): S | undefined {
    return this.stack.pop();
  }

  /** 清空（提交后弃撤回域） */
  clear(): void {
    this.stack.length = 0;
  }

  get length(): number {
    return this.stack.length;
  }
}
