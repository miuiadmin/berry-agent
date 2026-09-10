/**
 * 多行输入件（Editor 件族组装件）：模型 + 视图组合 + 输入事件分发。
 *
 * 事件面（07 §4.1 引擎节件 6（组件与呈现装配件） 输入件条款 + 批 10c 输入事件模型）：
 * - handleEvent 四路分发（key / text / ime / paste），返回是否消费；
 * - mouse 事件零消费直达 false（主屏零鼠标——到达即吞归上层；2026-09-11
 *   鼠标解码批输入模型扩五分，本件非 mouse 消费方）；
 * - ctrl+c 不消费（返 false 归上层 abort 路——复制语义在无选区模型下无承接）；
 * - 键位表平移 pi keybindings（本仓化差异：undo 双绑 ctrl+- / ctrl+_ ——
 *   kitty 轨 ctrl+- 规范形、legacy 轨 0x1f 解码为 '_'）；
 * - jump 词向两态（ctrl+] / ctrl+alt+] 进入待靶态、下一可打印字符为靶）；
 * - ↑ 在首视觉行且（空框 / 浏览态 / 行首）触发历史回溯，否则视觉行上移；
 *   ↓ 在末视觉行触发历史回新，否则下移。
 */
import type { CellBuffer, InputEvent, KeyEvent, Region, Renderable } from '../../engine/index.js';
import { EditorModel } from './editor-model.js';
import { EditorView } from './editor-view.js';

/** 组件装配面 */
export interface EditorOptions {
  /** 提交回调（trim 后非空才触发；历史入册在组件内先于回调完成） */
  onSubmit?: (text: string) => void;
  /** 内容变更通知（装配层接重绘请求） */
  onChange?: (text: string) => void;
  /** 最大可视行数（装配层按终端高 30% 注入；缺省 8） */
  maxVisibleLines?: number;
}

/** 键位绑定描述（meta 恒不参与——绑定面无 meta 组合） */
interface Binding {
  key: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
}

/* ---------------- 键位表（pi 平移——见类注差异注记） ---------------- */

const SUBMIT: Binding[] = [{ key: 'enter' }];
const NEW_LINE: Binding[] = [
  { key: 'enter', shift: true },
  { key: 'j', ctrl: true },
];
const UNDO: Binding[] = [
  { key: '-', ctrl: true }, // kitty 轨规范形
  { key: '_', ctrl: true }, // legacy 轨 0x1f 解码形
];
const MOVE_LEFT: Binding[] = [{ key: 'left' }, { key: 'b', ctrl: true }];
const MOVE_RIGHT: Binding[] = [{ key: 'right' }, { key: 'f', ctrl: true }];
const MOVE_WORD_LEFT: Binding[] = [
  { key: 'left', alt: true },
  { key: 'left', ctrl: true },
  { key: 'b', alt: true },
];
const MOVE_WORD_RIGHT: Binding[] = [
  { key: 'right', alt: true },
  { key: 'right', ctrl: true },
  { key: 'f', alt: true },
];
const LINE_START: Binding[] = [{ key: 'home' }, { key: 'a', ctrl: true }];
const LINE_END: Binding[] = [{ key: 'end' }, { key: 'e', ctrl: true }];
const JUMP_FORWARD: Binding[] = [{ key: ']', ctrl: true }];
const JUMP_BACKWARD: Binding[] = [{ key: ']', ctrl: true, alt: true }];
const PAGE_UP: Binding[] = [{ key: 'pageup' }];
const PAGE_DOWN: Binding[] = [{ key: 'pagedown' }];
const DELETE_BACKWARD: Binding[] = [{ key: 'backspace' }];
const DELETE_FORWARD: Binding[] = [{ key: 'delete' }, { key: 'd', ctrl: true }];
const DELETE_WORD_BACKWARD: Binding[] = [
  { key: 'w', ctrl: true },
  { key: 'backspace', alt: true },
];
const DELETE_WORD_FORWARD: Binding[] = [
  { key: 'd', alt: true },
  { key: 'delete', alt: true },
];
const DELETE_TO_LINE_START: Binding[] = [{ key: 'u', ctrl: true }];
const DELETE_TO_LINE_END: Binding[] = [{ key: 'k', ctrl: true }];
const HISTORY_PREV: Binding[] = [{ key: 'up' }];
const HISTORY_NEXT: Binding[] = [{ key: 'down' }];

/** 键位匹配（单字符键名大小写不敏感归一——shift 产大写形） */
function matches(e: KeyEvent, b: Binding): boolean {
  if (e.meta) return false;
  if (e.ctrl !== !!b.ctrl || e.alt !== !!b.alt || e.shift !== !!b.shift) return false;
  if (e.key === b.key) return true;
  return e.key.length === 1 && b.key.length === 1 && e.key.toLowerCase() === b.key;
}

function matchesAny(e: KeyEvent, bindings: Binding[]): boolean {
  return bindings.some((b) => matches(e, b));
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
  private readonly onSubmit: ((text: string) => void) | undefined;
  private readonly pageSize: number;

  constructor(options: EditorOptions = {}) {
    this.onSubmit = options.onSubmit;
    this.pageSize = Math.max(1, options.maxVisibleLines ?? 8);
    this.model = new EditorModel();
    this.model.onChange = (text) => options.onChange?.(text);
    this.view = new EditorView(this.model, { maxVisibleLines: options.maxVisibleLines });
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
      case 'paste':
        // 整段入正文（规范条款——无标记机制，多行粘贴直接呈现）
        this.jumpPending = null;
        this.model.insertText(event.text);
        return true;
      case 'mouse':
        return false; // 主屏零鼠标（07 屏模型注）——到达即吞不消费（副屏选区路不经本件）
    }
  }

  /** 键事件路（release 相不动作；ctrl+c 显式透传） */
  private handleKey(e: KeyEvent): boolean {
    if (e.phase === 'release') return false; // 释放相归上层（不消费）
    // jump 待靶态：escape 取消、可打印字符为靶（key 路防御位——text 路为主）
    if (this.jumpPending !== null) {
      if (matchesAny(e, [{ key: 'escape' }])) {
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
    if (matchesAny(e, SUBMIT)) return this.handleSubmit();
    if (matchesAny(e, NEW_LINE)) {
      this.jumpPending = null;
      this.model.addNewLine();
      return true;
    }
    if (matchesAny(e, UNDO)) {
      this.jumpPending = null;
      this.model.undo();
      return true;
    }
    if (matchesAny(e, MOVE_LEFT)) {
      this.jumpPending = null;
      this.model.moveLeft();
      return true;
    }
    if (matchesAny(e, MOVE_RIGHT)) {
      this.jumpPending = null;
      this.model.moveRight();
      return true;
    }
    if (matchesAny(e, MOVE_WORD_LEFT)) {
      this.jumpPending = null;
      this.model.moveWordBackward();
      return true;
    }
    if (matchesAny(e, MOVE_WORD_RIGHT)) {
      this.jumpPending = null;
      this.model.moveWordForward();
      return true;
    }
    if (matchesAny(e, LINE_START)) {
      this.jumpPending = null;
      this.model.moveHome();
      return true;
    }
    if (matchesAny(e, LINE_END)) {
      this.jumpPending = null;
      this.model.moveEnd();
      return true;
    }
    if (matchesAny(e, JUMP_FORWARD)) {
      this.jumpPending = 'forward';
      return true;
    }
    if (matchesAny(e, JUMP_BACKWARD)) {
      this.jumpPending = 'backward';
      return true;
    }
    if (matchesAny(e, PAGE_UP)) {
      this.jumpPending = null;
      this.model.pageUp(this.pageSize);
      return true;
    }
    if (matchesAny(e, PAGE_DOWN)) {
      this.jumpPending = null;
      this.model.pageDown(this.pageSize);
      return true;
    }
    if (matchesAny(e, DELETE_BACKWARD)) {
      this.jumpPending = null;
      this.model.backspace();
      return true;
    }
    if (matchesAny(e, DELETE_FORWARD)) {
      this.jumpPending = null;
      this.model.deleteForward();
      return true;
    }
    if (matchesAny(e, DELETE_WORD_BACKWARD)) {
      this.jumpPending = null;
      this.model.deleteWordBackward();
      return true;
    }
    if (matchesAny(e, DELETE_WORD_FORWARD)) {
      this.jumpPending = null;
      this.model.deleteWordForward();
      return true;
    }
    if (matchesAny(e, DELETE_TO_LINE_START)) {
      this.jumpPending = null;
      this.model.deleteToLineStart();
      return true;
    }
    if (matchesAny(e, DELETE_TO_LINE_END)) {
      this.jumpPending = null;
      this.model.deleteToLineEnd();
      return true;
    }
    if (matchesAny(e, HISTORY_PREV)) {
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
    if (matchesAny(e, HISTORY_NEXT)) {
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

  /** 提交：模型全清取文、非空才入册 + 回调 */
  private handleSubmit(): boolean {
    this.jumpPending = null;
    const text = this.model.submit();
    if (text !== '') {
      this.model.addToHistory(text);
      this.onSubmit?.(text);
    }
    return true;
  }
}
