/**
 * 编辑器模态编辑层（39 池 P4·L——07 §4.1 R5 mode 域）。
 *
 * 三态模态机：normal（命令面）/ insert（零拦截——既有 emacs 键全保留）/
 * pending（operator-pending——d/y/g 起动词后接续接词成复合操作）。
 * 纯状态机 + 命令执行器：一切稿件变更经 EditorModel 公开原语（禁重复造
 * 原语——dw/d$ 等行内段删经既有 deleteWordForward/deleteToLineEnd 等，
 * dd 走本批新增 deleteCurrentLine、gg/G 走 moveToFirstLine/moveToLastLine）。
 *
 * **模态寄存器分立律**（07 §4.1 mode 域注）：yy/yw/dw 族产物入**独立 yank
 * 寄存器**（line/char 两 kind），p/P 消费之——不进 kill-ring、不动环游标
 * （emacs 面 ctrl+y/alt+y 语义零漂移）；行内删经既有原语执行时被删段顺带
 * 入环是原语既有行为，不改原语保 emacs 面（双账并存：环账 + 模态寄存器）。
 *
 * **pending 容错律**：续接词表外字符 = 取消 pending 后该字符按 normal 命令
 * 重处理（容错——不吞键）；ESC 取消即消费（不外泄作全局中断）；超时 1000ms
 * 时间戳判定自愈（不挂墙钟 timer——纯组件无调度注入位，下一输入时点自检
 * 复位后本字符按 normal 处理）。
 *
 * 已知让位与分歧（gap 光标模型——光标是隙位 insert-before-col 语义）：
 * insert 归 normal 不左移光标；$ 落行尾后一位（d$ 在 EOL 无操作）；行形 p
 * 光标落贴段尾非首非空字符；x 在 EOL 无操作（deleteForward 原语在 EOL 是
 * 并下一行——守卫改无操作）。大段寄存器经 insertPaste 入稿会走粘贴分阈
 * （超阈成标记原子段）——粘贴语义单源随行，非本层特判。
 */
import type { EditorModel } from './editor-model.js';
import { findWordBackward, findWordForward } from './word-nav.js';

/** 模态三态（footer 指示词与 DECSCUSR 形的判据位） */
export type ModalMode = 'normal' | 'insert' | 'pending';

/** pending 起动词（'g' = gg 双击前半） */
export type ModalPendingHead = 'd' | 'y' | 'g';

/** 模态寄存器条目（独立 yank 寄存器——kind 定 p/P 落稿形） */
export interface ModalRegisterEntry {
  readonly kind: 'line' | 'char';
  readonly text: string;
}

/** pending 超时（ms——下一输入时点自检复位，不挂墙钟 timer） */
export const MODAL_PENDING_TIMEOUT_MS = 1000;

/** 构造选项 */
export interface EditorModalOptions {
  /** 态翻转通知（footer 指示词与 DECSCUSR 外显的同步锚——backend 消费） */
  onStateChange?: () => void;
  /** 时钟注入（超时判定的可测位；缺省 Date.now） */
  now?: () => number;
}

/**
 * 模态编辑层：态机 + 命令执行器。Editor 持有（setModalEditing 装卸），
 * feed 逐字素驱动（text/ime 提交路）、feedEscape 处理 escape 键路。
 */
export class EditorModal {
  private modeValue: ModalMode = 'normal';
  private pendingHeadValue: ModalPendingHead | null = null;
  /** pending 起始时间戳（超时自愈判据位） */
  private pendingSince = 0;
  /** 模态寄存器（最近一次 yy/yw/dd/dw 产物；null = 空——p/P 无操作） */
  private registerValue: ModalRegisterEntry | null = null;
  /** insert 进入旗（态翻转通知只在跨态时发——normal↔insert 与 pending 进出） */
  private lastNotifiedState: ModalMode = 'normal';

  private readonly model: EditorModel;
  private readonly onStateChange: (() => void) | undefined;
  private readonly now: () => number;

  constructor(model: EditorModel, options: EditorModalOptions = {}) {
    this.model = model;
    this.onStateChange = options.onStateChange;
    this.now = options.now ?? (() => Date.now());
  }

  /** 现态（'pending' = operator-pending——指示词「-- 操作 --」的判据位） */
  get mode(): ModalMode {
    return this.pendingHeadValue !== null ? 'pending' : this.modeValue;
  }

  /** pending 起动词（观测面——测试与指示同步消费；null = 非 pending） */
  get pendingHead(): ModalPendingHead | null {
    return this.pendingHeadValue;
  }

  /**
   * insert 态查询（editor 拦截层断流判据——合并事件中途进 insert 时余字素
   * 转插入路；亦避 getter 直比的 CFA 收窄误报——方法调用返回 boolean 无
   * 收窄面）。hasPendingJump/isPasteMarkerLine 同形语义化查询面。
   */
  isInsertMode(): boolean {
    return this.modeValue === 'insert';
  }

  /** 模态寄存器观测面（测试断言位——只读） */
  get register(): ModalRegisterEntry | null {
    return this.registerValue;
  }

  /**
   * escape 键路：pending 取消 / insert 归 normal（均消费返 true）；normal
   * 态不消费（返 false——escape 归全局中断路，模态层不夺生命线键）。
   */
  feedEscape(): boolean {
    if (this.pendingHeadValue !== null) {
      this.setPending(null);
      return true;
    }
    if (this.modeValue === 'insert') {
      this.modeValue = 'normal';
      this.fireStateChange();
      return true;
    }
    return false;
  }

  /**
   * 命令字素驱动（normal/pending 态——insert 态调用方不送，防御位直返）。
   * 合并 text 事件由调用方逐字素切分后送入（字素完整——组合字素不劈）。
   */
  feed(ch: string): void {
    if (this.modeValue === 'insert') return;
    if (this.pendingHeadValue !== null) {
      // 超时自愈：超窗先复位 pending，本字符落 normal 处理（自检复位非丢键）
      if (this.now() - this.pendingSince > MODAL_PENDING_TIMEOUT_MS) {
        this.setPending(null);
      } else if (this.feedPending(this.pendingHeadValue, ch)) {
        return; // 续接成复合——消费完结
      } else {
        // 续接词表外：取消 pending 后重处理（容错律——不吞键）
        this.setPending(null);
      }
    }
    this.feedNormal(ch);
  }

  /* ---------------- pending 续接（复合操作执行位） ---------------- */

  /** 续接词分诊：词表内执行复合返 true；表外返 false（调用方取消重处理） */
  private feedPending(head: ModalPendingHead, ch: string): boolean {
    if (head === 'g') {
      if (ch === 'g') {
        this.setPending(null);
        this.model.moveToFirstLine();
        return true;
      }
      return false; // g 只认 g（gg）——其余取消重处理
    }
    if (ch === 'w' || ch === 'b' || ch === '0' || ch === '$' || ch === head) {
      this.setPending(null);
      if (head === 'd') this.execDelete(ch);
      else this.execYank(ch);
      return true;
    }
    return false;
  }

  /* ---------------- normal 命令面 ---------------- */

  /** normal 态命令分派：词面外字符静默丢弃（命令面外无入稿——normal 态文本不入稿） */
  private feedNormal(ch: string): void {
    switch (ch) {
      // 移动族
      case 'h':
        this.model.moveLeft();
        return;
      case 'l':
        this.model.moveRight();
        return;
      case 'w':
        this.model.moveWordForward();
        return;
      case 'b':
        this.model.moveWordBackward();
        return;
      case '0':
        this.model.moveHome();
        return;
      case '$':
        this.model.moveEnd();
        return;
      case 'G':
        this.model.moveToLastLine();
        return;
      // x 删字符（EOL 守卫——不并下一行；不入寄存器——vim x 非删入寄存语义）
      case 'x':
        this.deleteCharGuarded();
        return;
      // 起动词（进 pending）
      case 'd':
      case 'y':
      case 'g':
        this.setPending(ch);
        return;
      // 贴（行形/字形式分立——execPaste 内判）
      case 'p':
        this.execPaste(false);
        return;
      case 'P':
        this.execPaste(true);
        return;
      // 撤销（既有 undo-stack 单源）
      case 'u':
        this.model.undo();
        return;
      // 入 insert 族
      case 'i':
        this.enterInsert();
        return;
      case 'a': // append——光标右移一字素后进 insert（EOL 处右移钳位 = 同 i）
        this.model.moveRight();
        this.enterInsert();
        return;
      case 'I':
        this.model.moveHome();
        this.enterInsert();
        return;
      case 'A':
        this.model.moveEnd();
        this.enterInsert();
        return;
      case 'o': // 下开新行：行尾劈行落新空行
        this.model.moveEnd();
        this.model.addNewLine();
        this.enterInsert();
        return;
      case 'O': // 上开新行：行首劈行（原行下移）后上移回新空行
        this.model.moveHome();
        this.model.addNewLine();
        this.model.moveUp();
        this.enterInsert();
        return;
      default:
        return; // 词面外静默丢弃
    }
  }

  /* ---------------- 删/复制/贴执行族 ---------------- */

  /** x 执行：EOL 守卫（deleteForward 原语在 EOL 并下一行——守卫改无操作） */
  private deleteCharGuarded(): void {
    const cursor = this.model.getCursor();
    const line = this.model.getLines()[cursor.line] ?? '';
    if (cursor.col < line.length) this.model.deleteForward();
  }

  /** d 族复合执行（ch ∈ w/b/0/$/d——入寄存器 + 删稿） */
  private execDelete(ch: string): void {
    if (ch === 'd') {
      const text = this.model.deleteCurrentLine();
      if (text !== null) this.registerValue = { kind: 'line', text };
      return;
    }
    const cursor = this.model.getCursor();
    const line = this.model.getLines()[cursor.line] ?? '';
    // 活标记行不承接段删（冷读闸 P2——段坐标会劈开标记原子段；且被删段若取
    // 自占位符字面会污染寄存器。no-op 与原语族「标记行=整行原子删除」同姿态，
    // 段动词不降级成整行删——显式 no-op 可预期）。
    if (this.model.isPasteMarkerLine(cursor.line)) return;
    if (ch === 'w') {
      if (cursor.col >= line.length) return; // EOL 无操作（不并下一行）
      const boundary = findWordForward(line, cursor.col);
      this.registerValue = { kind: 'char', text: line.slice(cursor.col, boundary) };
      this.model.deleteWordForward();
      return;
    }
    if (ch === 'b') {
      if (cursor.col === 0) return; // 行首无操作
      const boundary = findWordBackward(line, cursor.col);
      this.registerValue = { kind: 'char', text: line.slice(boundary, cursor.col) };
      this.model.deleteWordBackward();
      return;
    }
    if (ch === '0') {
      if (cursor.col === 0) return;
      this.registerValue = { kind: 'char', text: line.slice(0, cursor.col) };
      // 行内段删经既有原语——被删段顺带入 kill 环（原语既有行为，不改保 emacs 面）
      this.model.deleteToLineStart();
      return;
    }
    // '$'：删至行尾（EOL 无操作——原语在 EOL 并下一行）
    if (cursor.col >= line.length) return;
    this.registerValue = { kind: 'char', text: line.slice(cursor.col) };
    this.model.deleteToLineEnd();
  }

  /** y 族复合执行（ch ∈ w/b/0/$/y——纯读入寄存器不删稿、光标不动） */
  private execYank(ch: string): void {
    const cursor = this.model.getCursor();
    const line = this.model.getLines()[cursor.line] ?? '';
    // 活标记行不入寄存器（冷读闸 P2——占位符字面非登记原文：yy 落字面则 p
    // 铸出第二活标记行、提交稿整块内容静默重复 ×2/×3；段形 yank 同禁——
    // 混账不如无账）。no-op 保留既有寄存器（与 execDelete 标记行同姿态）。
    if (this.model.isPasteMarkerLine(cursor.line)) return;
    if (ch === 'y') {
      this.registerValue = { kind: 'line', text: line };
      return;
    }
    let text = '';
    if (ch === 'w') {
      if (cursor.col < line.length) {
        const boundary = findWordForward(line, cursor.col);
        text = line.slice(cursor.col, boundary);
      }
    } else if (ch === 'b') {
      if (cursor.col > 0) {
        const boundary = findWordBackward(line, cursor.col);
        text = line.slice(boundary, cursor.col);
      }
    } else if (ch === '0') {
      text = line.slice(0, cursor.col);
    } else {
      text = line.slice(cursor.col); // '$'
    }
    if (text !== '') this.registerValue = { kind: 'char', text };
  }

  /**
   * p/P 执行：行形 = 下/上开行整行入（moveEnd/moveHome + 首尾换行锚定——
   * insertPaste 原子一步〔每次粘贴独立 undo 步——insertText 游程合并会把
   * 连贴并成一步〕，超阈大段走粘贴分阈成标记段随既有语义）；字形式 = 光标
   * 处行内插。光标落贴段尾（gap 模型已知分歧——非 vim 首非空字符位）。空
   * 寄存器无操作。
   */
  private execPaste(before: boolean): void {
    const entry = this.registerValue;
    if (entry === null || entry.text === '') return;
    if (entry.kind === 'line') {
      if (before) {
        this.model.moveHome();
        this.model.insertPaste(`${entry.text}\n`); // 原行下移——贴行居上
        // 光标归位补步：多行插入后光标落原行（下移后）行首——上移回贴行落
        // 其尾（与 p 的「光标落贴段尾」同律——spec 已知分歧注单源）
        this.model.moveUp();
        this.model.moveEnd();
      } else {
        this.model.moveEnd();
        this.model.insertPaste(`\n${entry.text}`); // 原行不动——贴行居下
      }
      return;
    }
    this.model.insertPaste(entry.text); // 字形式：p/P 同位（gap 隙位语义）
  }

  /* ---------------- 态迁移私法 ---------------- */

  /** 进 insert（态翻转通知） */
  private enterInsert(): void {
    this.modeValue = 'insert';
    this.fireStateChange();
  }

  /** pending 置位/复位（起动词或取消——态翻转通知经 mode 投影） */
  private setPending(head: ModalPendingHead | null): void {
    this.pendingHeadValue = head;
    if (head !== null) this.pendingSince = this.now();
    this.fireStateChange();
  }

  /** 态翻转通知（去抖：指示可见态〔normal/insert/pending 三词〕未变不发） */
  private fireStateChange(): void {
    if (this.mode === this.lastNotifiedState) return;
    this.lastNotifiedState = this.mode;
    this.onStateChange?.();
  }
}
