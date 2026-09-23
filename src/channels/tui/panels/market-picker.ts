/**
 * /marketplace 插件市场选装副屏件（03 §9.6 mp-5 TUI 选装面·07 §4.1 命令面
 * 增补批——TUI 本地拦截族第七件）：theme-picker 形选择器——▸ 光标 + 已装
 * 徽标 + enter 选装/卸载 + u 换装 + r 刷新。
 *
 * - **纯呈现件（零 host import）**：条目行集（rows）与尾行区（tail/results/
 *   busyLabel）全由 host 侧 face 模块注入——文本字段 host 侧已过消毒单源
 *   （plugin-market/sanitize），本件只渲染不判内容；空态两分文案也由 host
 *   拼进 tail（面板不判「零源 vs 零条目」——数据语义归 host）；
 * - **可变模型 host 拥有**：MarketPanelModel 是 host 持有的可变对象——面板
 *   每帧现读（非构造快照），host 变更后经 requestRepaint 重画（busy 槽/
 *   results 结算块跨开屏持久、rows/tail 每次开屏现取）；
 * - **动作键三分**：enter = 选定（**先收副屏再回调**——07 §4.1 既有律；未装
 *   条目 install / 已装条目 uninstall）、u = 已装条目换装（未装指路）、
 *   r = 刷新（**面板驻留不收屏**——刷新换行集须在屏呈现；**不依赖行集**——
 *   空态文案双处指路 r〔键面提示行恒呈 + host 空态尾行〕，源在册零条目时
 *   r 是唯一出路，key/text 两轨均在 rows 闸外直达）；busyLabel 非 null 时
 *   三动作键一律锁（fail-loud 呈现 + 零回调——03 §9.6 编舞③）；
 * - **光标选择模型**（theme-picker 同基建）：↑/↓/PgUp/PgDn/Home/End +
 *   光标驱动视口夹取 + 滚轮 ±3 行（ScrollView WHEEL_LINES 同档——picker 族
 *   补齐族内一致；视口先行 + 光标随视口拉回窗缘）；退出键面 q/Esc 收屏、
 *   Ctrl+C 打断、Ctrl+D 先收屏再转退出柄——副屏键面件族律；裸字母键
 *   q/u/r 补 kitty disambiguate 轨 text 事件分派（theme-picker 'q' 先例
 *   同形坑——三键全补；u/r 两轨经 dispatchLetter 单源分派零手抄）。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { truncateToWidth } from '../../engine/index.js';
import { fitRowSegments } from '../row-segments.js';
import type { OverlayContent } from '../overlay/overlay.js';

/**
 * 市场条目行（host 侧合成注入）：寻址形 id = `name@market`；文本字段
 * （name/version/market/description）host 侧已消毒——面板只渲染。
 */
export interface MarketEntryRow {
  /** 寻址形 id（`name@market`——install/uninstall/upgrade 寻址单源） */
  readonly id: string;
  /** 条目名（左段主位） */
  readonly name: string;
  /** 版本（detail 段——catalog 自由文本，host 已消毒） */
  readonly version: string;
  /** 市场名（左段 `@market` 尾——多源同名条目并呈的区分位） */
  readonly market: string;
  /** 描述（detail 段——host 已消毒；缺席不呈） */
  readonly description?: string;
  /** 已装徽标（host 读装机账本 market 注记合成——enter 语义分叉判据） */
  readonly installed: boolean;
}

/**
 * 面板可变模型（**host 拥有**——跨开屏持久）：rows/tail 每次开屏现取；
 * results = 结算回执全文逐行（长动作 settle 后重置）；busyLabel = 长动作
 * 在飞标注（非 null 即锁动作键）。面板每帧现读——host 变更后经
 * requestRepaint 重画。
 */
export interface MarketPanelModel {
  readonly rows: readonly MarketEntryRow[];
  /** 尾行区上段（skipped 原因/刷新逐源结局/空态两分文案——host 拼好逐行） */
  readonly tail: readonly string[];
  /** 结算回执块（长动作结局全文逐行——host 已消毒） */
  readonly results: readonly string[];
  /** 长动作在飞标注（null = 空闲——面板不构造文案，锁键时原样呈现） */
  readonly busyLabel: string | null;
}

/** 动作面（host 侧编舞 face 注入——面板只分派不实现） */
export interface MarketPanelActions {
  /** 装机（未装条目 enter）——busy 期 host 侧自拒（面板锁键在前） */
  install(id: string): void;
  /** 卸载（已装条目 enter——双相确认归 host 编舞） */
  uninstall(id: string): void;
  /** 换装（已装条目 u——单件 force 重装） */
  upgrade(id: string): void;
  /** 刷新（r——恒回源强制重取，面板驻留不收屏） */
  refresh(): void;
}

/** 选装面板装配选项 */
export interface MarketPickerOptions {
  /** 可变模型（host 拥有——每帧现读） */
  readonly model: MarketPanelModel;
  readonly actions: MarketPanelActions;
  /** 锁键/指路 warn 呈现（backend.notify warn 位注入） */
  readonly notifyWarn: (text: string) => void;
  /** host 变更模型后的程序化重画路（backend.requestAltRepaint 注入） */
  readonly requestRepaint: () => void;
  readonly sessionId: string;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
}

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 光标行标记（在选行） */
const CURSOR_MARK = '▸';
/** 已装徽标 */
const INSTALLED_MARK = '已装';
/** busy 前缀符 */
const BUSY_MARK = '⏳';
/** busy 期动作键锁文案（busyLabel 原样嵌入——面板不猜动作语义） */
const BUSY_LOCK_HINT = (label: string): string => `${label}——动作键锁定，收场后再试`;
/** u 键未装指路文案（面板静态文案——键面语义归呈现件） */
const U_NOT_INSTALLED_HINT = '未装机——enter 选装（u 换装仅对已装条目）';

/**
 * 滚轮单步行数（ScrollView WHEEL_LINES=3 同档——vim mousescroll ver 缺省
 * 档；picker 族补齐族内一致：副屏 ScrollView 族已消费滚轮，本件同档接入）。
 */
const WHEEL_LINES = 3;

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/**
 * 市场选装面板内容件（OverlayContent——theme-picker 同基建：自持光标与
 * 视口窗口）。与 theme-picker 的分立点：模型非构造快照——每帧现读 host
 * 拥有的可变 model（busy/results 长动作编舞在屏随动）。
 */
export class MarketPicker implements OverlayContent {
  private readonly model: MarketPanelModel;
  private readonly actions: MarketPanelActions;
  private readonly notifyWarn: (text: string) => void;
  private readonly requestRepaint: () => void;
  private readonly sessionId: string;
  private readonly onExit: () => void;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 光标行（条目下标；空表恒 0） */
  private cursor = 0;
  /** 视口首行（光标驱动夹取） */
  private offset = 0;
  /** 视口高实测（render 回写——翻选的页幅依据） */
  private viewportHeight = 1;
  /** 退出闭锁（选定与取消两路共闭——竞发防御位） */
  private exited = false;

  constructor(options: MarketPickerOptions) {
    this.model = options.model;
    this.actions = options.actions;
    this.notifyWarn = options.notifyWarn;
    this.requestRepaint = options.requestRepaint;
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
  }

  /**
   * 量高：头行 + 条目/尾行区共享体 + busy 底行（在飞时）+ 键面提示行。
   * 条目与尾行区（tail/results）同争中段——render 按实际 region 窗口化
   * （副屏 root 直收全屏 region，量高只是量面非布局承诺）。
   */
  measure(width: number): number {
    void width;
    const rows = this.model.rows.length;
    const tailLines = this.model.tail.length + this.model.results.length;
    // 中段 = 条目全量与尾行区全量并陈（面板内容量随编舞长态增长）+ 至少 1（空态行）
    const body = Math.max(1, rows + tailLines);
    return 1 + body + (this.model.busyLabel !== null ? 1 : 0) + 1;
  }

  /** 落位：头行 → 条目视口 → 尾行区（tail → results）→ busy 底行 → 键面提示 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    const rows = this.model.rows;
    const markets = new Set(rows.map((row) => row.market)).size;
    const head = `◆ 插件市场 · ${rows.length} 条目（${markets} 源）`;
    buffer.writeText(region.row, region.col, head);
    // 中段窗口化：光标驱动视口（条目区）+ 尾行区尾随——窗口高按剩余行实配
    const viewHeight = Math.max(1, region.height - 2);
    this.viewportHeight = viewHeight;
    this.clampCursor(); // 模型换血缩行防御①：渲染期光标入界（r 刷新换行集后面板自愈）
    this.clampOffset();
    // 条目行优先占窗（光标可见性是选择器第一律——尾行区溢出被窗截断可接受）
    let line = region.row + 1;
    const end = region.row + region.height - 1; // 键面提示行占位
    for (let i = 0; i < viewHeight && line < end; i++) {
      const index = this.offset + i;
      if (index >= rows.length) break;
      this.renderRow(buffer, line, region.col, region.width, index);
      line++;
    }
    // 尾行区：tail（skipped/刷新结局/空态文案）→ results（结算回执全文）
    for (const text of [...this.model.tail, ...this.model.results]) {
      if (line >= end) break;
      buffer.writeText(line, region.col, truncateToWidth(text, region.width), HINT_STYLE);
      line++;
    }
    // busy 底行（长动作在飞——恰占键面提示行上一行；窗溢出时让位于结构行）
    if (this.model.busyLabel !== null && line < end) {
      buffer.writeText(line, region.col, `${BUSY_MARK} ${this.model.busyLabel}`);
      line++;
    }
    buffer.writeText(
      region.row + region.height - 1,
      region.col,
      '↑↓ 移动 · enter 选装/卸载 · u 换装 · r 刷新 · q/esc 返回',
      HINT_STYLE,
    );
  }

  /** 单行落位：左段（光标 + 名@市场 + 已装徽标）+ detail 段（描述 · 版本）右对齐 */
  private renderRow(buffer: CellBuffer, row: number, col: number, width: number, index: number): void {
    const entry = this.model.rows[index]!;
    const prefix = index === this.cursor ? `${CURSOR_MARK} ` : '  ';
    const badge = entry.installed ? ` ${INSTALLED_MARK}` : '';
    const left = `${prefix}${entry.name}@${entry.market}${badge}`;
    // 右段预算律单源（本律起源位——2026-09-20 战役后内联形收编单源）：左段
    // 至多半窗（名@市场 + 徽标的可读下限），余宽归右段预算——极长描述若按
    // 原宽右对齐会把起列推成负值（越窗吸收 + 行首覆写坏形），故先按预算
    // 截断右段再对齐；两段各自整字截断（… 截断形——不撕宽字符）。
    const rightFull = `${entry.description !== undefined ? `${entry.description} · ` : ''}${entry.version}`;
    const fit = fitRowSegments(left, rightFull, width);
    buffer.writeText(row, col, fit.left);
    if (fit.rightWidth > 0) buffer.writeText(row, col + width - fit.rightWidth, fit.right, HINT_STYLE);
  }

  /**
   * 事件分发（副屏内容终局消费）：Ctrl+C/Ctrl+D 补丁 → 动作键三分（busy 锁
   * 在前——长动作在飞期零回调）→ 移动键 → 滚轮 → 退出。裸字母键 q/u/r 补
   * kitty disambiguate 轨 text 事件分派（三键全补——theme-picker 'q' 坑同
   * 形；u/r 两轨经 dispatchLetter 单源分派）。
   */
  handleEvent(event: InputEvent): boolean {
    // 模型换血缩行防御②：事件入口光标入界（diff-viewer render 期夹取同族）。
    // host 侧 rebuildRows 字段替换式缩行不经面板任何路径，光标可越出新集——
    // enter/u（key 轨与 text 轨 dispatchLetter）取 rows[cursor] 前先夹取，
    // 否则 undefined.installed 抛 TypeError 落 stdin data listener 无人接
    // → uncaughtException 整进程退出（finding 主张坏形）。
    this.clampCursor();
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断在飞 run（目标 = 当前交互会话位——不退屏，件族同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'c') {
        this.onInterrupt?.(this.sessionId);
        return true;
      }
      // Ctrl+D = 退出进程（先收副屏再转退出柄——件族同律）
      if (k.ctrl && !k.alt && !k.shift && !k.meta && k.key === 'd') {
        this.exit();
        this.onQuit?.();
        return true;
      }
      if (this.model.rows.length > 0) {
        if (isPlainKey(k, 'up')) {
          this.moveCursor(-1);
          return true;
        }
        if (isPlainKey(k, 'down')) {
          this.moveCursor(1);
          return true;
        }
        if (isPlainKey(k, 'pageup')) {
          this.moveCursor(-this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'pagedown')) {
          this.moveCursor(this.viewportHeight);
          return true;
        }
        if (isPlainKey(k, 'home')) {
          this.cursor = 0;
          this.clampOffset();
          this.cursorRepaint();
          return true;
        }
        if (isPlainKey(k, 'end')) {
          this.cursor = this.model.rows.length - 1;
          this.clampOffset();
          this.cursorRepaint();
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          const chosen = this.model.rows[this.cursor]!;
          // busy 锁（03 §9.6 编舞③）：长动作在飞期动作键 fail-loud + 零回调
          if (this.model.busyLabel !== null) {
            this.notifyWarn(BUSY_LOCK_HINT(this.model.busyLabel));
            return true;
          }
          // 选定先收副屏再回调（07 §4.1 既有律——confirm 浮层在主屏无叠屏冲突）
          this.exit();
          if (chosen.installed) this.actions.uninstall(chosen.id);
          else this.actions.install(chosen.id);
          return true;
        }
        // u：key 轨复用 dispatchLetter 单源（空表守卫由外层 rows 闸保证——直调）
        if (isPlainKey(k, 'u')) {
          this.dispatchLetter('u');
          return true;
        }
      }
      // r：刷新不依赖行集（host refresh() 只回源重取——空态文案双处指路 r：
      // 键面提示行恒呈 + host「源在册但零条目——r 刷新重取」尾行），从 rows
      // 总闸解出（busy 锁保留在 dispatchLetter 内）；修前形 = key 轨 r 闸在
      // rows 闸内 + text 轨 r 同条件静默吞 = 空态死键（文案指路而键不可达）。
      // 复用 dispatchLetter 单源（key/text 两轨零手抄）。
      if (isPlainKey(k, 'r')) {
        this.dispatchLetter('r');
        return true;
      }
      if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) {
        this.exit();
        return true;
      }
    }
    // 滚轮消费（ScrollView 族内一致——WHEEL_LINES=3 同档）：wheel 无 release
    // 相（终端不报，press 一相到达）；busy 期零动作（busy 行在屏恒可见优先）；
    // 非滚轮鼠标相零动作终局吞（模态独占——本件无鼠标选职）。
    if (event.kind === 'mouse') {
      if (
        event.phase === 'press' &&
        this.model.busyLabel === null &&
        this.model.rows.length > 0 &&
        (event.button === 'wheel-up' || event.button === 'wheel-down')
      ) {
        this.wheelScroll(event.button === 'wheel-up' ? -WHEEL_LINES : WHEEL_LINES);
      }
      return true;
    }
    // kitty disambiguate 轨：裸字母纯键打字走 text 事件（q/u/r 三键全补）
    if (event.kind === 'text') {
      if (event.text === 'q') {
        this.exit();
        return true;
      }
      // u 语义绑条目（换装/未装指路都取 rows[cursor]）——空表零动作（rows 闸）
      if (event.text === 'u') {
        if (this.model.rows.length > 0) this.dispatchLetter('u');
        return true;
      }
      // r 与 key 轨同律：不依赖行集（空态可达）——两轨单源 dispatchLetter
      if (event.text === 'r') {
        this.dispatchLetter('r');
        return true;
      }
    }
    return true; // 未消费键终局吞（模态独占）
  }

  /**
   * 动作键分派单源（key 轨与 kitty text 轨两轨共用——编舞零手抄）：u = 换装
   * （busy 锁 + 未装指路；语义绑条目——**调用位保证 rows 非空**）、r = 刷新
   * （busy 锁；**不依赖行集**——空态文案双处指路 r，两轨均在 rows 闸外直达）。
   */
  private dispatchLetter(letter: 'u' | 'r'): void {
    if (letter === 'u') {
      const chosen = this.model.rows[this.cursor]!; // 调用位 rows 闸保证在位
      if (this.model.busyLabel !== null) {
        this.notifyWarn(BUSY_LOCK_HINT(this.model.busyLabel));
        return;
      }
      // 未装条目 u = 指路（不回调——install 语义属 enter）
      if (!chosen.installed) {
        this.notifyWarn(U_NOT_INSTALLED_HINT);
        return;
      }
      this.actions.upgrade(chosen.id);
      return;
    }
    if (this.model.busyLabel !== null) {
      this.notifyWarn(BUSY_LOCK_HINT(this.model.busyLabel));
      return;
    }
    // 刷新面板驻留不收屏（刷新换行集须在屏呈现——host settle 后 repaint）
    this.actions.refresh();
  }

  /** 光标移动（越界夹取——不循环；移动后光标恒可见 + 请求重画） */
  private moveCursor(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.model.rows.length - 1, this.cursor + delta));
    this.clampOffset();
    this.cursorRepaint();
  }

  /**
   * 滚轮滚动（±WHEEL_LINES 行——ScrollView 族内一致）：视口先行 + 光标随
   * 视口（滚出窗的光标拉回同侧窗缘——moveCursor 是「光标驱动视口」，本件是
   * 对偶的「视口拖动光标」；clampOffset 只拉视口回光标、不推光标，故光标
   * 侧显式拉）；终经 clampCursor/clampOffset 双向夹取（行集边界 + 光标可见
   * 两律同收）。已在边界零动作零重画（与移动键首尾夹取静默同律）。
   */
  private wheelScroll(delta: number): void {
    const maxOffset = Math.max(0, this.model.rows.length - this.viewportHeight);
    const next = Math.max(0, Math.min(maxOffset, this.offset + delta));
    if (next === this.offset) return; // 边界夹尽——零动作零重画
    this.offset = next;
    if (this.cursor < this.offset) this.cursor = this.offset;
    else if (this.cursor >= this.offset + this.viewportHeight) {
      this.cursor = this.offset + this.viewportHeight - 1;
    }
    this.clampCursor();
    this.clampOffset();
    this.cursorRepaint();
  }

  /**
   * 光标夹取（模型换血缩行——行下标入界；空表归 0）：模型 host 拥有且字段
   * 替换式变更（rebuildRows `this.model.rows = rows`），缩行后 cursor 不经
   * moveCursor 自夹——render 期与事件入口双位自愈（diff-viewer 同款律）。
   */
  private clampCursor(): void {
    const length = this.model.rows.length;
    if (length > 0) this.cursor = Math.max(0, Math.min(length - 1, this.cursor));
    else this.cursor = 0;
  }

  /**
   * 光标态变更后的重画请求（面板自请位——cursor/offset 属面板自持态，host
   * 无从知晓变更；AltScreenHost 输入监听的统一补帧〔mp-5 家族修〕已保底，
   * 本自请与 host 侧模型变更柄（busy/results）经 requestRender 请求合并同
   * 到一帧——双路并存零冗余）。
   */
  private cursorRepaint(): void {
    this.requestRepaint();
  }

  /** 视口夹取：光标行恒在窗内（下溢提窗 / 上溢压窗） */
  private clampOffset(): void {
    // 窗高上界：视口长高时 offset 不得深于「尾行恰贴窗底」位（首渲染前击键
    // 会以陈 viewportHeight=1 夹出过深 offset——render 回写真实窗高后回拉）
    const maxOffset = Math.max(0, this.model.rows.length - this.viewportHeight);
    if (this.offset > maxOffset) this.offset = maxOffset;
    if (this.cursor < this.offset) this.offset = this.cursor;
    else if (this.cursor >= this.offset + this.viewportHeight) {
      this.offset = this.cursor - this.viewportHeight + 1;
    }
  }

  /** 退出（闭锁——选定与取消单次收口） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }
}
