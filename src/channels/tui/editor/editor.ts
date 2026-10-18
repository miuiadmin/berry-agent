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
 *   直调（环账与 undo 编排归模型）；
 * - 模态编辑拦截层（39 池 P4·L——07 §4.1 R5 mode 域）：默认关；开后仅
 *   normal/pending 态吃 text 字素与 pending 态 escape（态机归 modal-mode.ts，
 *   拦截分诊归本件 interceptModal）。
 */
import type { CellBuffer, InputEvent, KeyEvent, Region, Renderable } from '../../engine/index.js';
import { splitGraphemes } from '../../engine/index.js';
import { EditorModel } from './editor-model.js';
import { EditorView } from './editor-view.js';
import { EditorModal, type ModalMode } from './modal-mode.js';
import { Keymap } from '../keys/registry.js';

/** 提交选项（候跑位——挂账解挂批 2026-09-15） */
export interface EditorSubmitOptions {
  /**
   * 候跑标记（alt+enter 提交形）：true = busy 期本条显式排队候 run 终态种子
   * 新 run（04 §4 SubmitOptions.queueFollowUp 同名位）；idle 期与普通提交同形。
   */
  readonly queueFollowUp?: boolean;
  /**
   * 敏感形旗（挖掘 37 轮件 3——07 §4.1 两集分立律）：true = 本条提交不入
   * 历史册（内存册 addToHistory 跳过=双跳第一跳）+ 镜像钩携位仍发（第二跳
   * 由持久回调自判）。正常提交路由不携（应答车 sensitive 模式位自动注入）。
   */
  readonly sensitive?: boolean;
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
  /**
   * 持久化史镜像钩（B1 写路——真入册时触发；缺席 = 纯内存旧形）。第二参
   * sensitive 位（挖掘 37 轮件 3）：sensitive 形不入内存册但仍携位发钩——
   * 持久回调自判跳写（双跳第二跳）。
   */
  onHistoryAdd?: (text: string, opts?: { sensitive?: boolean }) => void;
  /**
   * 入史词面变换缝（56 轮件 1e——重发即真值律）：提交入册（内存册 + B1 镜像
   * 钩同源单值）前的词面变换。消费例 = 剪贴板图占位行剥除——暂存在场的提交
   * 入史剥 `[图片]` 占位行后净稿（图不随史重建，召回重发不携幻影占位词面）；
   * 变换后空串不入册不镜像（image-only 稿零空史目）。缺席 = 恒等（旧形零扰动
   * ——无图会话零开销零漂移）。onSubmit 不经本缝（提交流词面归调用方分诊）。
   */
  historyText?: (text: string) => string;
  /**
   * 提交被帽拒绝时的反馈回调（件 B——挖掘 46 轮）：帽值与实际码点数供
   * 宿主提示行呈现（backend 接 notify error 瞬时行）。缺席 = 静默拒
   * （纯逻辑件可裸构测）；拒绝时 onSubmit 不触发、草稿全量保留。
   */
  onSubmitRejected?: (info: { cap: number; actual: number }) => void;
  /**
   * 弹回排队末条回调（挖掘 47 轮件 A——alt+↑ 收回编辑）：返回是否消费
   * （true = 已消费不落后续键路；false = 键落终局）。门序判据（应答窗/
   * seam 缺席/草稿非空/空弹）全归宿主闭包——编辑器只司键分发。
   */
  onQueueEditLast?: () => boolean;
  /**
   * 模态态翻转通知（39 池 P4·L——07 §4.1 R5 mode 域）：normal/insert/
   * pending 三指示态任一翻转时触发（backend 消费——footer 指示词重建 +
   * DECSCUSR 光标形写出）。态去抖在模态层（同态零发）。
   */
  onModalChange?: () => void;
}

/** 可打印字符键判（jump 待靶态的靶字符判据——无修饰或仅 shift） */
function isPlainCharKey(e: KeyEvent): boolean {
  return e.key.length === 1 && !e.ctrl && !e.alt && !e.meta;
}

/**
 * 提交输入帽（码点数——件 B 挖掘 46 轮）：展开全文（粘贴标记展开单源）
 * 超 1<<20 拒交 + 宿主反馈 + 草稿保留。对齐 codex MAX_USER_INPUT_TEXT_CHARS
 * （protocol/src/user_input.rs:8——chars 计数非字节，代理对计 1）。
 */
const MAX_SUBMIT_CHARS = 1 << 20;

/**
 * 多行输入组件：状态归模型、呈现归视图、本件只做事件分发与装配面。
 */
export class Editor implements Renderable {
  readonly model: EditorModel;
  readonly view: EditorView;
  /** jump 待靶方向（null = 常态） */
  private jumpPending: 'forward' | 'backward' | null = null;
  private readonly onSubmit: ((text: string, opts?: EditorSubmitOptions) => void) | undefined;
  /** 提交帽拒绝反馈钩（件 B——挖掘 46 轮；缺席 = 静默拒） */
  private readonly onSubmitRejected: ((info: { cap: number; actual: number }) => void) | undefined;
  /** 弹回排队末条钩（47 轮件 A；缺席 = 键落终局无害） */
  private readonly onQueueEditLast: (() => boolean) | undefined;
  /** 翻页步幅（= 呈现帽——帽随 resize 重算时同步，见 setMaxVisibleLines） */
  private pageSize: number;
  private readonly keymap: Keymap;
  /** 持久化史镜像钩（B1 写路——真入册时触发；缺席 = 纯内存旧形；sensitive 携位形见 EditorOptions 注） */
  private readonly onHistoryAdd: ((text: string, opts?: { sensitive?: boolean }) => void) | undefined;
  /** 入史词面变换缝（56 轮件 1e——重发即真值；缺席 = 恒等旧形） */
  private readonly historyText: ((text: string) => string) | undefined;
  /** 模态态翻转通知（39 池 P4·L；缺席 = 纯逻辑件可裸构测） */
  private readonly onModalChange: (() => void) | undefined;
  /** 模态编辑层（null = 关：零拦截零呈现——默认关拍板句的落码位） */
  private modalLayer: EditorModal | null = null;

  constructor(options: EditorOptions = {}) {
    this.onSubmit = options.onSubmit;
    this.onSubmitRejected = options.onSubmitRejected;
    this.onQueueEditLast = options.onQueueEditLast;
    this.onModalChange = options.onModalChange;
    this.pageSize = Math.max(1, options.maxVisibleLines ?? 8);
    this.keymap = options.keymap ?? new Keymap();
    this.onHistoryAdd = options.onHistoryAdd;
    this.historyText = options.historyText;
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

  /**
   * 应答车敏感模式开关（挖掘 37 轮件 3——tui-backend activateInputAsk/队列
   * 收口位换装）：true = ①view 点符回显（呈现面等宽掩码）+ ②提交路自动
   * 携 sensitive 位（EditorSubmitOptions——双跳豁免的注入位）。复位 false =
   * 普通形全链（入册照旧）。
   */
  setSensitive(on: boolean): void {
    this.sensitiveInput = on;
    this.view.setSensitive(on);
  }

  /** 应答车敏感模式位（setSensitive 换装——提交路注入与 view 回显同源单开关） */
  private sensitiveInput = false;

  getText(): string {
    return this.model.getText();
  }

  /** 展开投影（只读——标记行展开回登记原文；外编播种等程序面出稿用——挖掘 32 轮） */
  getExpandedText(): string {
    return this.model.getExpandedText();
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

  /**
   * 待靶臂主动同收（56 轮件 ②——ask 开层位陈臂清理）：解除 jump 待靶态。
   * setText 的顺带清（挖掘 26 轮 [2]）覆盖「清稿」语境；本面覆盖「不清稿、
   * 只解除悬置态」语境——模态面板开层：面板期一切事件被层②吃尽，「下一
   * 字素为靶」的续收结构性不可达，臂跨层存活即陈态（收场后首字素被劫）。
   * 纯态清零操作面（幂等——未武装调用零副作用）。
   */
  cancelPendingJump(): void {
    this.jumpPending = null;
  }

  /**
   * 悬空预编辑呈现面同收（56 轮件 ②——ask 开层位组字态丢弃的呈现半边）：
   * 清 model 挂起预编辑。与 decoder.discardPendingPreedit 配对消费（decoder
   * 清组字会话态、本面清呈现态）——单收一半会造劈叉：只清会话 = 冲刷裁决
   * 事件缺席而呈现悬空；只清呈现 = 会话续走而下发组字另起。消费语境同
   * cancelPendingJump（模态面板开层——组字续收结构性不可达）。
   */
  clearPendingPreedit(): void {
    this.model.setPreedit(null);
  }

  /**
   * 历史回搜态在场查询（挖掘 31 轮 [3]）：backend 七守卫门判（escape 让路 /
   * 教学键 / leader arm / 补全抑制等）需感知搜索期——搜索态事件被编辑器
   * 吃尽、稿件被预览占据，上层分诊须让位（hasPendingJump 同形语义化查询面）。
   */
  isSearchingHistory(): boolean {
    return this.model.isSearchingHistory();
  }

  /**
   * 模态编辑开关（39 池 P4·L——`/vim` 命令面消费位）：on = 装模态层（fresh
   * 起 normal 态；重开重置态与寄存器——开关翻转是显式重锚非续态）；off = 卸
   * 模态层（零拦截零呈现——层不在场即无迹）。会话内持久：编辑器实例寿期
   * 即会话寿期，overlay 开关/面板启闭不重建本件（态不丢）；跨进程不持久
   * （开关不落盘）。
   */
  setModalEditing(on: boolean): void {
    if (on) {
      if (this.modalLayer === null) {
        this.modalLayer = new EditorModal(this.model, { onStateChange: () => this.onModalChange?.() });
      }
    } else {
      this.modalLayer = null;
    }
    this.onModalChange?.(); // 开关翻转即同步（装/卸两向——指示与光标形随开关收敛）
  }

  /** 模态现态观测面（null = 关——backend 指示词与 DECSCUSR 形判据位） */
  get modalMode(): ModalMode | null {
    return this.modalLayer === null ? null : this.modalLayer.mode;
  }

  /** 模态开关在场查询（backend 缓存对账位——开关态自省） */
  isModalEditing(): boolean {
    return this.modalLayer !== null;
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
    // 历史回搜模态（挖掘 31 轮 [3]）：搜索态吃尽一切事件（codex history_search
    // 同序——分诊先于 jump 待靶态：开搜时 jumpPending 已清，两模态不并存）
    if (this.model.isSearchingHistory()) return this.handleSearchEvent(event);
    // 模态编辑拦截层（39 池 P4·L——07 §4.1 R5 mode 域）：只在 normal/pending
    // 态吃 text/ime 提交字素与 pending 态 escape；insert 态零拦截（emacs 键
    // 全保留）、ctrl 族与具名键恒放行（生命线/提交/导航/回搜在 normal 态照旧）
    if (this.modalLayer !== null && this.interceptModal(event)) return true;
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
   * 模态拦截层（39 池 P4·L——只在模态层在场时被咨询）：
   * - **键路只辖 escape 一键**：pending 取消 / insert 归 normal（消费）；normal
   *   态返 false 归全局中断路。ctrl 族、方向、enter、ctrl+r 回搜等具名键全
   *   数放行既有 emacs dispatch——normal 态下生命线（ctrl+c）、提交（enter）、
   *   翻阅（↑/↓）照旧可达；
   * - **jump 待靶让位**：ctrl+] 在 normal 态照常武装，待靶期一切事件（含
   *   escape 取消）走既有 jump 分支——两态机不互夺；
   * - **text/ime 提交路**：normal/pending 态逐字素喂模态命令面（合并事件
   *   逐字素切分——组合字素不劈）；**中途进 insert 即断流**，余字素归既有
   *   插入路补入（合并事件不丢字）；insert 态返 false 零拦截（字素入稿）；
   *   ime 预编辑（未提交）不拦——呈现归既有路；
   * - **paste/mouse 放行**：粘贴照既有路原子入稿（不进命令面——粘贴是输入
   *   行为非编辑命令）、鼠标归上层。
   */
  private interceptModal(event: InputEvent): boolean {
    const modal = this.modalLayer;
    if (modal === null) return false;
    if (this.jumpPending !== null) return false; // jump 待靶优先（既有态机）
    if (event.kind === 'key') {
      if (event.phase === 'release') return false;
      if (event.key === 'escape' && !event.ctrl && !event.alt && !event.meta) {
        return modal.feedEscape();
      }
      return false; // 其余键走既有 emacs dispatch
    }
    if (event.kind === 'text') {
      if (modal.mode === 'insert') return false; // insert 态零拦截
      // 逐字素喂命令面，但**中途进 insert 即断流**：合并 text 事件（快打同
      // chunk / legacy 轨 textRun 合并）首字素是入 insert 命令（i/a/o…）时，
      // 余字素已属插入语义——继续喂模态面会被 insert 短路静默丢字（'ozz'
      // 单 chunk 只剩 'o' 生效）。余字素归既有插入路补入——jump 待靶
      // consumeJumpTarget 的「余字素不丢」同律。
      const graphemes = splitGraphemes(event.text);
      for (let i = 0; i < graphemes.length; i += 1) {
        modal.feed(graphemes[i]!);
        if (modal.isInsertMode()) {
          // 方法查询面（getter 直比遭 CFA 收窄误报 TS2367）
          const rest = graphemes.slice(i + 1).join('');
          if (rest !== '') this.model.insertText(rest);
          break;
        }
      }
      return true;
    }
    if (event.kind === 'ime') {
      if (!event.committed) return false; // 预编辑不拦（呈现归既有路）
      if (modal.mode === 'insert') return false;
      // ime 提交路同律（kitty 轨 astral 合并提交形）：中途进 insert 余字素补入
      const graphemes = splitGraphemes(event.text);
      for (let i = 0; i < graphemes.length; i += 1) {
        modal.feed(graphemes[i]!);
        if (modal.isInsertMode()) {
          // 方法查询面（getter 直比遭 CFA 收窄误报 TS2367）
          const rest = graphemes.slice(i + 1).join('');
          if (rest !== '') this.model.insertText(rest);
          break;
        }
      }
      return true;
    }
    return false; // paste / mouse 放行
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
    // 弹回排队末条（alt+↑——47 轮件 A）：门序判据归宿主闭包（onQueueEditLast），
    // 缺席或返 false = 键落终局无害（seam 关 = 功能关）
    if (hit('editor.queue-edit-last')) return this.onQueueEditLast?.() ?? false;
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
    // 开搜（挖掘 31 轮 [3]——ctrl+r 双义：非搜索态开搜 / 搜索态向旧步进由
    // handleSearchEvent 分诊，此处恒为「从常态开搜」）
    if (hit('editor.history-search')) {
      this.jumpPending = null;
      this.model.beginHistorySearch();
      return true;
    }
    return false; // 未绑定键归上层（escape / f 键 / tab…）
  }

  /**
   * 回搜态事件分诊（挖掘 31 轮 [3]——搜索态吃尽一切事件，codex history_search
   * 同序）。步进键双绑定：ctrl+r/↑ 向旧、ctrl+s/↓ 向新（↑/↓ 复用既有
   * history-prev/next 册位——搜索态内不翻阅直接步进命中）；enter 采编恰
   * editor.submit 键（alt+enter 候跑腿不命中——键序分立）；escape 收搜还原
   * 草稿；退格 / ctrl+u 编辑 query（字素退格不劈组合字素）；ctrl+c 生命线
   * 透传（backend 层① 先拦——此处防御位，直调测试面同守）；paste 消费丢弃
   * （query 是短词输入面——大段粘贴不进 query 不进稿）；mouse 归上层。
   */
  private handleSearchEvent(event: InputEvent): boolean {
    if (event.kind === 'mouse') return false;
    if (event.kind === 'key') {
      if (event.phase === 'release') return false; // 释放相归上层
      const km = this.keymap;
      const hit = (actionId: string): boolean => km.actionMatches(event, actionId);
      if (event.ctrl && !event.alt && !event.shift && !event.meta && event.key === 'c') {
        return false; // ctrl+c 生命线透传（层① 先拦——防御位）
      }
      if (hit('editor.history-search') || hit('editor.history-prev')) {
        this.model.searchStep(-1); // 向旧步进（开搜态下 ctrl+r 兼步进双义）
        return true;
      }
      if (hit('editor.history-search-next') || hit('editor.history-next')) {
        this.model.searchStep(1); // 向新步进
        return true;
      }
      if (event.key === 'escape' && !event.ctrl && !event.alt && !event.meta) {
        this.model.cancelHistorySearch(); // 收搜还原草稿
        return true;
      }
      if (hit('editor.submit')) {
        this.model.acceptHistorySearch(); // 采编（恰 enter——alt+enter 不命中）
        return true;
      }
      if (hit('editor.delete-backward')) {
        const query = this.model.getHistorySearch()?.query ?? '';
        this.model.updateSearchQuery(splitGraphemes(query).slice(0, -1).join('')); // 字素退格
        return true;
      }
      if (hit('editor.delete-to-line-start')) {
        this.model.updateSearchQuery(''); // ctrl+u 清 query（还原草稿）
        return true;
      }
      return true; // 其余键消费丢弃（codex `_ =>` 同形）
    }
    if (event.kind === 'text') {
      const query = this.model.getHistorySearch()?.query ?? '';
      this.model.updateSearchQuery(query + event.text);
      return true;
    }
    if (event.kind === 'ime') {
      // committed 追加 query；预编辑段消费不动作（query 无预编辑呈现面）
      if (event.committed) {
        const query = this.model.getHistorySearch()?.query ?? '';
        this.model.updateSearchQuery(query + event.text);
      }
      return true;
    }
    return true; // paste 消费丢弃（query 短词输入面）
  }

  /**
   * 提交：模型全清取文、非空才入册 + 回调（候跑形携标记——调用方按键序分派）。
   * 入册序不变（addToHistory 先于 onSubmit）；B1 写路——普通形真入册才触发
   * 镜像钩（两闸〔trim 空/连续去重〕下不镜像，onSubmit 照发）。入史词面经
   * historyText 变换缝（56 轮件 1e——占位行剥除净稿入史，重发即真值）。
   * sensitive 形双跳（挖掘 37 轮件 3——07 §4.1 两集分立律）：第一跳 = 内存册
   * 不入（addToHistory 跳过——↑ 回灌不泄；不入册即无从连续去重，同文多笔
   * 都镜像）；镜像钩携 sensitive 位仍发——第二跳由持久回调自判跳写（防跨
   * 进程回灌明文——两级同笔闭环缺一即泄）。
   */
  private handleSubmit(opts?: EditorSubmitOptions): boolean {
    this.jumpPending = null;
    // 提交帽（件 B——挖掘 46 轮）：帽判必在 model.submit() 前（submit 清稿+
    // 返文一体——判后置则草稿已失，复原语义不成立）。计数对象 = 展开全文
    // （粘贴标记展开单源）trim 后码点数（[...text].length——代理对计 1，
    // 对齐 codex chars().count()）；trim 空串恒不过帽，纯空白稿照旧走
    // submit+返回值过滤（空稿行为零改动——不新增 submit 前空判直返）
    const expanded = this.model.getExpandedText().trim();
    const actual = [...expanded].length;
    if (actual > MAX_SUBMIT_CHARS) {
      this.onSubmitRejected?.({ cap: MAX_SUBMIT_CHARS, actual });
      return true; // enter 已消费（拒非吞键）——草稿全量保留可删改后再交
    }
    const text = this.model.submit();
    if (text !== '') {
      // sensitive 模式位自动注入提交选项（应答车 sensitive 形的携带位）
      const merged: EditorSubmitOptions | undefined = this.sensitiveInput ? { ...opts, sensitive: true } : opts;
      // 入史词面变换（56 轮件 1e——重发即真值）：占位行剥除等提交语义入史面，
      // 内存册 + B1 镜像钩同源单值；变换后空串（image-only 稿）不入册不镜像
      //（与 trim 空闸同语义——空史目零意义）；onSubmit 恒收原稿（词面分诊归调用方）
      const historyText = this.historyText !== undefined ? this.historyText(text) : text;
      if (historyText !== '') {
        if (!this.sensitiveInput && this.model.addToHistory(historyText)) {
          this.onHistoryAdd?.(historyText);
        } else if (this.sensitiveInput) {
          // 双跳第一跳已跳内存册；镜像钩携位仍发（第二跳归持久回调）
          this.onHistoryAdd?.(historyText, { sensitive: true });
        }
      }
      this.onSubmit?.(text, merged);
    }
    return true;
  }
}
