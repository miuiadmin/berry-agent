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
import { splitGraphemes } from '../../engine/index.js';
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
  /** 最大可视行数（backend 构造期按当值行数套帽注入、resize 现值重算——生产装配层启动快照注入已撤〔第六轮批〕；缺省 8） */
  maxVisibleLines?: number;
  /**
   * 呈现最小高（五件批 A+B——缺省规范值 3：内容不足 3 行铺空行至 3，主
   * composer 视觉块体量化）。底铬瞬时输入行（viewer 导出/搜索行——单行形
   * 设计锁）显式传 1 回归旧几何——A+B 呈现策略辖主 composer 不辖底铬。
   */
  minPresentedLines?: number;
  /**
   * 上下空行垫行数（五件批 A+B——缺省规范值 2：与上方任务状态行/下方面板
   * 族的视觉呼吸垫）。底铬瞬时输入行显式传 0（随 minPresentedLines: 1 成
   * 对——单行档零垫）。
   */
  padRows?: number;
  /**
   * 空稿占位文案（R-6——composer 缺省「输入消息…」；底铬功能输入行显式
   * null 退役：viewer 搜索/导出参数行是功能框非消息 composer，占位文不辖）。
   */
  placeholder?: string | null;
  /** 键位册（批 10j 迁册——缺省缺省册；用户覆盖形装配注入归 10k） */
  keymap?: Keymap;
  /**
   * 持久化史种子（B1——07 §4.1 呈现面件 2 定形注③种子路）：构造期一次性
   * 新→旧序满灌内存史（host 装配根 recentTexts〔启动锚根〕供数——跨进程
   * 存活位）。缺席 = 空史旧形（确定性测试零扰动）。
   */
  historySeed?: readonly string[];
  /**
   * 持久化史镜像钩（B1 写路）：真入册（trim 空与连续去重闸后）时随入册
   * 触发——装配层闭包直写库（写点在编辑器入册位非 host onSubmit 位：ask
   * 应答/退出词/本地命令三叉不达 onSubmit，镜像取编辑器级保两集恒等）。
   * 缺席 = 纯内存旧形；写失败 best-effort 归闭包（不阻塞提交）。
   */
  onHistoryAdd?: (text: string) => void;
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
  /** 持久化史镜像钩（B1 写路——真入册时触发；缺席 = 纯内存旧形） */
  private readonly onHistoryAdd: ((text: string) => void) | undefined;

  constructor(options: EditorOptions = {}) {
    this.onSubmit = options.onSubmit;
    this.pageSize = Math.max(1, options.maxVisibleLines ?? 8);
    this.keymap = options.keymap ?? new Keymap();
    this.onHistoryAdd = options.onHistoryAdd;
    this.model = new EditorModel();
    // 持久化史种子（B1 种子路）：构造期一次满灌——缺席 = 空史旧形
    if (options.historySeed !== undefined) this.model.seedHistory(options.historySeed);
    this.model.onChange = (text) => options.onChange?.(text);
    this.view = new EditorView(this.model, {
      maxVisibleLines: options.maxVisibleLines,
      // 呈现策略透传（五件批 A+B 参数化）：缺省 = 规范值——主 composer 零改
      minPresentedLines: options.minPresentedLines,
      padRows: options.padRows,
      placeholder: options.placeholder,
    });
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

  /**
   * 空稿占位文运行时切换（挖掘 29 轮件 4——backend 应答车换装消费）：语义与
   * 构造期 placeholder 第三参同族（undefined 回缺省 / null 退役 / string 定值）。
   */
  setPlaceholder(text: string | null | undefined): void {
    this.view.setPlaceholder(text);
  }

  getText(): string {
    return this.model.getText();
  }

  setText(text: string): void {
    // 整稿替换清待靶态（挖掘 26 轮 [2]）：jump 靶属旧稿——外部清稿/回填路
    //（ctrl+d 清空腿 / inputAsk 激活与 abort 残稿清 / 斜杠命令回填）经本面
    // 绕 handleEvent 单源锚，待靶态残留会把用户下一首字素静默吞作跳靶
    this.jumpPending = null;
    this.model.setText(text);
  }

  /**
   * jump 待靶态在场查询（挖掘 27 轮 [4]）：backend 层门判（教学键 `?` 等）
   * 需感知待靶期——待靶中用户下一键是跳靶字符（应入编辑器消费），不得被
   * 上层劫持（私有字段不外露，仅此语义化查询面）。
   */
  hasPendingJump(): boolean {
    return this.jumpPending !== null;
  }

  /* ---------------- 渲染委托（两段协商直通视图） ---------------- */

  measure(width: number): number {
    return this.view.measure(width);
  }

  /** 帽内内容行数委托（裸视觉行数夹呈现帽——sweep23-件1；fixed-budget 梯「收缩至内容高」目标位——五件批 A+B） */
  contentRows(): number {
    return this.view.contentRows();
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
        // jump 待靶态：首字素为跳转靶（kitty 轨 BMP 可打印走 text 事件、astral
        // 可打印走 ime 提交路——见 ime 分支注；legacy 轨 astral 仍走 text 事件
        // ——textRun 逐码点累积无 plain 判据，两分支 consumeJumpTarget 同语义）。
        // legacy 轨 textRun 同 chunk 连续可打印合并单 text 事件——首字素作靶后
        // 余字素经 insertText 补入正文，不随靶消费丢字（字素切分保组合字素完整
        // ——肤质修饰 / ZWJ 家族不劈不产悬空残段）
        if (this.consumeJumpTarget(event.text)) return true;
        this.model.insertText(event.text);
        return true;
      }
      case 'ime':
        if (event.committed) {
          this.model.setPreedit(null);
          // kitty 轨 astral 可打印（emoji 等 UTF-16 长 2）经 input.ts plain 判据
          // （text.length === 1）恒 false → dispatchImeText 走 ime 提交路到达；
          // 两态契约「下一可打印字符为靶」对 astral 同生效——首字素作跳靶、余
          // 字素补入正文（与 text 路同语义；非 committed 预编辑不消费待靶态）
          if (this.consumeJumpTarget(event.text)) return true;
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

  /**
   * jump 待靶态消费可打印文本（text / ime 提交两路同语义）：首字素整体作
   * jumpToChar 靶、余字素经 insertText 补入正文（合并事件的余字素不随靶消费
   * 丢字）。字素切分（splitGraphemes）保组合字素完整——码点切分会把肤质修饰
   * 形「emoji+修饰符」（2 码点 1 字素）劈成「靶+悬空残段」，残段插入正文即
   * 文本污染。返回是否已按待靶态消费（false = 非待靶态或空文本——调用方走
   * 普通插入）。
   */
  private consumeJumpTarget(text: string): boolean {
    if (this.jumpPending === null || text.length === 0) return false;
    const graphemes = splitGraphemes(text);
    this.model.jumpToChar(graphemes[0]!, this.jumpPending);
    this.jumpPending = null;
    if (graphemes.length > 1) this.model.insertText(graphemes.slice(1).join(''));
    return true;
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

  /**
   * 提交：模型全清取文、非空才入册 + 回调（候跑形携标记——调用方按键序分派）。
   * 入册序不变（addToHistory 先于 onSubmit）；B1 写路——真入册才触发镜像钩
   * （与内存史同集恒等：两闸〔trim 空/连续去重〕下不镜像，onSubmit 照发）。
   */
  private handleSubmit(opts?: EditorSubmitOptions): boolean {
    this.jumpPending = null;
    const text = this.model.submit();
    if (text !== '') {
      if (this.model.addToHistory(text)) {
        this.onHistoryAdd?.(text);
      }
      this.onSubmit?.(text, opts);
    }
    return true;
  }
}
