/**
 * 多行输入件（Editor 件族组装件）：模型 + 视图组合 + 输入事件分发。
 *
 * 事件面（07 §4.1 引擎节件 6（组件与呈现装配件） 输入件条款 + 批 10c 输入事件模型）：
 * - handleEvent 四路分发（key / text / ime / paste），返回是否消费；
 * - mouse 事件零消费直达 false（主屏零鼠标——到达即吞归上层；2026-09-11
 *   鼠标解码批输入模型扩五分，本件非 mouse 消费方）；
 * - ctrl+c 不消费（返 false 归上层 abort 路——复制语义在无选区模型下无承接）；
 * - 键位 dispatch 走 keys/registry 册单源（批 10j 迁册——本件内部键表退役；
 *   动作 id 与缺省键位见 ACTION_CATALOG；用户覆盖装配归 10k）；
 * - jump 词向两态（ctrl+] / ctrl+alt+] 进入待靶态、下一可打印字符为靶）；
 * - ↑ 在首视觉行且（空框 / 浏览态 / 行首）触发历史回溯，否则视觉行上移；
 *   ↓ 在末视觉行触发历史回新，否则下移；
 * - kill-ring 消费键（R3 批 10j）：ctrl+y yank / alt+y yankPop——模型原语
 *   直调（环账与 undo 编排归模型）。
 */
import type { CellBuffer, InputEvent, KeyEvent, Region, Renderable } from '../../engine/index.js';
import { EditorModel } from './editor-model.js';
import { EditorView } from './editor-view.js';
import { Keymap } from '../keys/registry.js';

/** 提交选项（候跑位——挂账解挂批 2026-09-15） */
export interface EditorSubmitOptions {
  /**
   * 候跑标记（alt+enter 提交形）：true = busy 期本条显式排队候 run 终态种子
   * 新 run（04 §4 SubmitOptions.queueFollowUp 同名位）；idle 期与普通提交同形。
   */
  readonly queueFollowUp?: boolean;
}

/** 组件装配面 */
export interface EditorOptions {
  /** 提交回调（trim 后非空才触发；历史入册在组件内先于回调完成） */
  onSubmit?: (text: string, opts?: EditorSubmitOptions) => void;
  /** 内容变更通知（装配层接重绘请求） */
  onChange?: (text: string) => void;
  /** 最大可视行数（装配层按终端高 30% 注入；缺省 8） */
  maxVisibleLines?: number;
  /** 键位册（批 10j 迁册——缺省缺省册；用户覆盖形装配注入归 10k） */
  keymap?: Keymap;
}

/** 可打印字符键判（jump 待靶态的靶字符判据——无修饰或仅 shift） */
function isPlainCharKey(e: KeyEvent): boolean {
  return e.key.length === 1 && !e.ctrl && !e.alt && !e.meta;
}

/**
 * 多行输入组件：状态归模型、呈现归视图、本件只做事件分发与装配面。
 */
export class Editor implements Renderable {
  readonly model: EditorModel;
  readonly view: EditorView;
  /** jump 待靶方向（null = 常态） */
  private jumpPending: 'forward' | 'backward' | null = null;
  private readonly onSubmit: ((text: string, opts?: EditorSubmitOptions) => void) | undefined;
  /** 翻页步幅（= 呈现帽——帽随 resize 重算时同步，见 setMaxVisibleLines） */
  private pageSize: number;
  private readonly keymap: Keymap;

  constructor(options: EditorOptions = {}) {
    this.onSubmit = options.onSubmit;
    this.pageSize = Math.max(1, options.maxVisibleLines ?? 8);
    this.keymap = options.keymap ?? new Keymap();
    this.model = new EditorModel();
    this.model.onChange = (text) => options.onChange?.(text);
    this.view = new EditorView(this.model, { maxVisibleLines: options.maxVisibleLines });
  }

  /**
   * 帽随几何重设（批 10k 遗漏修——装配层 resize 编舞调）：呈现帽与翻页步幅
   * 同源随动（page 键步幅 = 视口高整页——帽变步幅不变会翻过头/翻不足）。
   */
  setMaxVisibleLines(cap: number): void {
    const next = Math.max(1, cap);
    this.pageSize = next;
    this.view.setMaxVisibleLines(next);
  }

  /* ---------------- 装配面便捷委托 ---------------- */

  /** 聚焦态切换（事件路由器裁决） */
  setFocused(focused: boolean): void {
    this.view.setFocused(focused);
  }

  getText(): string {
    return this.model.getText();
  }

  setText(text: string): void {
    this.model.setText(text);
  }

  /* ---------------- 渲染委托（两段协商直通视图） ---------------- */

  measure(width: number): number {
    return this.view.measure(width);
  }

  render(buffer: CellBuffer, region: Region): void {
    this.view.render(buffer, region);
  }

  /* ---------------- 输入事件分发 ---------------- */

  /** 四路分发：返回是否消费（false = 归上层，如 ctrl+c 的 abort 路） */
  handleEvent(event: InputEvent): boolean {
    switch (event.kind) {
      case 'key':
        return this.handleKey(event);
      case 'text': {
        // jump 待靶态：首字符为跳转靶（kitty / legacy 可打印均走 text 事件）
        if (this.jumpPending !== null && event.text.length > 0) {
          this.model.jumpToChar([...event.text][0]!, this.jumpPending);
          this.jumpPending = null;
          return true;
        }
        this.model.insertText(event.text);
        return true;
      }
      case 'ime':
        if (event.committed) {
          this.model.setPreedit(null);
          this.model.insertText(event.text);
        } else {
          this.model.setPreedit(event.text);
        }
        return true;
      case 'paste': {
        // 粘贴分阈（R3 批 10j）：超阈大段走粘贴标记原子段、阈内整段入框
        // ——分阈与标记化编舞归模型 insertPaste 单源
        this.jumpPending = null;
        this.model.insertPaste(event.text);
        return true;
      }
      case 'mouse':
        return false; // 主屏零鼠标（07 屏模型注）——到达即吞不消费（副屏选区路不经本件）
    }
  }

  /** 键事件路（release 相不动作；ctrl+c 显式透传；dispatch 走册单源——批 10j 迁册） */
  private handleKey(e: KeyEvent): boolean {
    if (e.phase === 'release') return false; // 释放相归上层（不消费）
    const km = this.keymap;
    const hit = (actionId: string): boolean => km.actionMatches(e, actionId);
    // jump 待靶态：escape 取消、可打印字符为靶（key 路防御位——text 路为主）
    if (this.jumpPending !== null) {
      if (e.key === 'escape' && !e.ctrl && !e.alt && !e.meta) {
        this.jumpPending = null;
        return true;
      }
      if (isPlainCharKey(e)) {
        this.model.jumpToChar(e.key, this.jumpPending);
        this.jumpPending = null;
        return true;
      }
    }
    if (e.ctrl && !e.alt && !e.shift && !e.meta && e.key === 'c') return false; // ctrl+c 透传上层 abort
    // 候跑提交（alt+enter——挂账解挂批 2026-09-15）：与 enter 键序分立（规范键串
    // 'alt+enter' ≠ 'enter'，两 hit 互不误触）；空框消费不回调与 submit 同判据
    if (hit('editor.queue-followup')) return this.handleSubmit({ queueFollowUp: true });
    if (hit('editor.submit')) return this.handleSubmit();
    if (hit('editor.new-line')) {
      this.jumpPending = null;
      this.model.addNewLine();
      return true;
    }
    if (hit('editor.undo')) {
      this.jumpPending = null;
      this.model.undo();
      return true;
    }
    if (hit('editor.yank')) {
      this.jumpPending = null;
      this.model.yank();
      return true;
    }
    if (hit('editor.yank-pop')) {
      this.jumpPending = null;
      this.model.yankPop();
      return true;
    }
    if (hit('editor.move-left')) {
      this.jumpPending = null;
      this.model.moveLeft();
      return true;
    }
    if (hit('editor.move-right')) {
      this.jumpPending = null;
      this.model.moveRight();
      return true;
    }
    if (hit('editor.move-word-left')) {
      this.jumpPending = null;
      this.model.moveWordBackward();
      return true;
    }
    if (hit('editor.move-word-right')) {
      this.jumpPending = null;
      this.model.moveWordForward();
      return true;
    }
    if (hit('editor.line-start')) {
      this.jumpPending = null;
      this.model.moveHome();
      return true;
    }
    if (hit('editor.line-end')) {
      this.jumpPending = null;
      this.model.moveEnd();
      return true;
    }
    if (hit('editor.jump-forward')) {
      this.jumpPending = 'forward';
      return true;
    }
    if (hit('editor.jump-backward')) {
      this.jumpPending = 'backward';
      return true;
    }
    if (hit('editor.page-up')) {
      this.jumpPending = null;
      this.model.pageUp(this.pageSize);
      return true;
    }
    if (hit('editor.page-down')) {
      this.jumpPending = null;
      this.model.pageDown(this.pageSize);
      return true;
    }
    if (hit('editor.delete-backward')) {
      this.jumpPending = null;
      this.model.backspace();
      return true;
    }
    if (hit('editor.delete-forward')) {
      this.jumpPending = null;
      this.model.deleteForward();
      return true;
    }
    if (hit('editor.delete-word-backward')) {
      this.jumpPending = null;
      this.model.deleteWordBackward();
      return true;
    }
    if (hit('editor.delete-word-forward')) {
      this.jumpPending = null;
      this.model.deleteWordForward();
      return true;
    }
    if (hit('editor.delete-to-line-start')) {
      this.jumpPending = null;
      this.model.deleteToLineStart();
      return true;
    }
    if (hit('editor.delete-to-line-end')) {
      this.jumpPending = null;
      this.model.deleteToLineEnd();
      return true;
    }
    if (hit('editor.history-prev')) {
      this.jumpPending = null;
      // 首视觉行 +（空框 / 已在浏览态 / 逻辑行首）→ 历史回溯；否则视觉行上移
      const cursor = this.model.getCursor();
      if (
        this.model.isOnFirstVisualLine() &&
        (this.model.isEmpty() || this.model.isBrowsingHistory() || cursor.col === 0)
      ) {
        this.model.navigateHistory(-1);
      } else {
        this.model.moveUp();
      }
      return true;
    }
    if (hit('editor.history-next')) {
      this.jumpPending = null;
      // 末视觉行 → 历史回新（含回草稿）；否则视觉行下移
      if (this.model.isOnLastVisualLine()) {
        this.model.navigateHistory(1);
      } else {
        this.model.moveDown();
      }
      return true;
    }
    return false; // 未绑定键归上层（escape / f 键 / tab…）
  }

  /** 提交：模型全清取文、非空才入册 + 回调（候跑形携标记——调用方按键序分派） */
  private handleSubmit(opts?: EditorSubmitOptions): boolean {
    this.jumpPending = null;
    const text = this.model.submit();
    if (text !== '') {
      this.model.addToHistory(text);
      this.onSubmit?.(text, opts);
    }
    return true;
  }
}
