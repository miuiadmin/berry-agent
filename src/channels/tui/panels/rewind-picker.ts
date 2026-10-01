/**
 * RewindPicker 回退点选择器副屏件（2026-09-30 会话管理命令批批3——05 §5.3
 * 翻案笔②无参选择器形态；ModelPicker 形克隆 + 两步确认视图切换）。
 *
 * - **条目 = manifestLine 成品行平列**（id 短形+ISO 时刻+触发形中文+规模——
 *   渲染单源在插件域 command.ts manifestLine，本件零 checkpoint 依赖、零重拼）；
 * - **宽度收口**（fitRowSegments 单段形 fitLine）：头行/清单行/底行/preview
 *   各行超宽一律 … 收口整字截断——清单行与 previewLine 是外部数据长行，
 *   窄窗硬截断无提示属漏网形（件族宽度原语全接入）；
 * - **两步确认 = 预演→确认**（05 §5.3 批3 翻案笔）：list 段 Enter 进 preview
 *   视图（onPreview 异步——「预演中…」加载态自持；三账行「恢复 N · 删除 M ·
 *   不动 U」+ 警告行「manifest 外的手工/bash 改动不回退」规范明文）；preview
 *   段再 Enter 确认回退——**先收副屏再回调**（件族律：onRestore 闭包内 busy
 *   守卫→restore→adopt→notify 编舞全在插件域）；Esc 回列表（不退面板）；
 * - **打字过滤**（成品行子串匹配——id 全形/时刻/触发形全覆盖；过滤词呈现于
 *   底行 + backspace 删词；q 捷键与过滤面共存同件族律）；
 * - **预演失败诚实拒**（errorText 在场只显错误行、Enter 零动作不进 restore）；
 * - **退出键面**：list 段 q/Esc 退面板；Ctrl+C 打断在飞 run（不退屏）、
 *   Ctrl+D 退出进程（先收屏再转退出柄）——副屏键面件族律。
 */
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import type { OverlayContent } from '../overlay/overlay.js';
import type { UiRewindActions, UiRewindEntry, UiRewindPreview } from '../../../contracts/index.js';
import { hintLine } from '../keys/hint.js';
import { fitRowSegments } from '../row-segments.js';

/** 回退点选择器装配选项（载荷与回调组经 host deps 注入流转——openRewindPicker 面） */
export interface RewindPickerOptions {
  /** manifest 成品行清单（插件域组装快照——开屏一次现取、开屏后新拍不进面板） */
  readonly entries: readonly UiRewindEntry[];
  /** 两步确认回调组（onPreview/onRestore 闭包真源在插件域） */
  readonly actions: UiRewindActions;
  readonly onExit: () => void;
  readonly sessionId: string;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
}

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 警告行样式（规范明文警告——dim 恒可读不加色） */
const WARN_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 光标行标记（在选行） */
const CURSOR_MARK = '▸';
/** 滚轮单步行数（ScrollView WHEEL_LINES 同值——件族面） */
const WHEEL_LINES = 3;
/** manifest 外改动不回退警告行（05 §5.3 批3 翻案笔②规范明文文案） */
const WARN_LINE = '⚠ 回退只还原 berry 记录的文件改动——你手动改的文件保持不动';

/** key 事件窄化 */
function asKey(event: InputEvent): (InputEvent & { kind: 'key' }) | null {
  return event.kind === 'key' ? (event as InputEvent & { kind: 'key' }) : null;
}

/** 无修饰命名键判 */
function isPlainKey(e: InputEvent & { kind: 'key' }, key: string): boolean {
  return !e.ctrl && !e.alt && !e.shift && !e.meta && e.key === key;
}

/** legacy key 轨可打印字符提取（无修饰单字符——kitty text 轨之外的老终端轨） */
function plainChar(e: InputEvent & { kind: 'key' }): string | null {
  if (e.ctrl || e.alt || e.meta) return null;
  if (e.key.length !== 1) return null;
  return e.key;
}

/**
 * 单行宽度收口（fitRowSegments 单段形——无右段帽 = 总宽）：本面板各行
 * （头行/空匹配行/清单行/底行/preview 各行）超宽一律 … 收口、整字截断不撕
 * 宽字符——清单行与 previewLine 是插件域外部数据行（manifestLine 长行），
 * raw writeText 直写在窄窗是硬截断无提示（setCell 越界静默吸收）——件族
 * 宽度原语接入（theme/model/market picker 全族同律，本件为漏网件）。
 */
function fitLine(text: string, width: number): string {
  return fitRowSegments(text, undefined, width).left;
}

/**
 * 回退点选择器内容件（OverlayContent——副屏 root 直收全屏 region；list /
 * preview 两视图自持切换，光标、视口窗口与过滤词只辖 list 段）。快照档——
 * 构造后条目底单静态，过滤只在屏内视图（ModelPicker 静态底单律同款）。
 */
export class RewindPicker implements OverlayContent {
  private readonly entries: readonly UiRewindEntry[];
  private readonly actions: UiRewindActions;
  private readonly sessionId: string;
  private readonly onExit: () => void;
  private readonly onInterrupt: ((sessionId: string) => void) | undefined;
  private readonly onQuit: (() => void) | undefined;
  /** 当前视图（list = 清单选择；preview = 两步确认段一——对账与确认） */
  private view: 'list' | 'preview' = 'list';
  /** preview 段锚定的条目（Enter 时选中的 id——Esc 返回后光标仍指该行；restore 锚语义） */
  private previewId: string | undefined;
  /** 预演调用序号（Enter 递增——迟到守卫锚「调用」非「条目」：同条目二次进预览时
   *  previewId 同值拦不住旧调用迟到回填，序号比对才行〔2026-10-01 R2 竞态守卫〕） */
  private previewSeq = 0;
  /** preview 段锚定条目的成品行（对账视图首行呈现） */
  private previewLine = '';
  /** 预演结果（undefined = 加载中——「预演中…」态） */
  private previewData: UiRewindPreview | undefined;
  /** 过滤词（空串 = 全量；子串匹配 id+成品行 不区分大小写） */
  private query = '';
  /** 光标位（**过滤后条目集**的下标——过滤重算时归首） */
  private cursor = 0;
  /** 视口首行（光标驱动夹取） */
  private offset = 0;
  /** 视口高实测（render 回写——翻页幅依据） */
  private viewportHeight = 1;
  /** 退出闭锁（确认回退与取消两路共闭——竞发防御位） */
  private exited = false;

  constructor(options: RewindPickerOptions) {
    this.entries = options.entries;
    this.actions = options.actions;
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
  }

  /** 过滤后条目集（query 空 = 全量；清单序保持） */
  private filtered(): readonly UiRewindEntry[] {
    if (this.query === '') return this.entries;
    const q = this.query.toLowerCase();
    return this.entries.filter((entry) => `${entry.id} ${entry.line}`.toLowerCase().includes(q));
  }

  /** 量高：标题行 + 全量条目数（下限 1——空结果诚实行）+ 底行（preview 段行数少底部留白） */
  measure(width: number): number {
    void width;
    return 1 + Math.max(1, this.entries.length) + 1;
  }

  /** 落位（按视图分派） */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    if (this.view === 'preview') {
      this.renderPreview(buffer, region);
      return;
    }
    const items = this.filtered();
    buffer.writeText(
      region.row,
      region.col,
      fitLine(`◆ 回退点 · ${items.length} 个${this.query !== '' ? '（过滤中）' : ''}`, region.width),
    );
    const viewHeight = Math.max(1, region.height - 2);
    this.viewportHeight = viewHeight;
    this.clampOffset(items.length);
    if (items.length === 0) {
      buffer.writeText(
        region.row + 1,
        region.col,
        fitLine(`（无匹配「${this.query}」的回退点）`, region.width),
        HINT_STYLE,
      );
    } else {
      for (let i = 0; i < viewHeight; i++) {
        const index = this.offset + i;
        if (index >= items.length) break;
        const entry = items[index]!;
        const prefix = index === this.cursor ? `${CURSOR_MARK} ` : '  ';
        buffer.writeText(region.row + 1 + i, region.col, fitLine(`${prefix}${entry.line}`, region.width));
      }
    }
    // 底行：键路提示 + 过滤词呈现（过滤面在屏可感知——件族同律）
    if (this.query !== '') {
      buffer.writeText(
        region.row + region.height - 1,
        region.col,
        fitLine(
          `过滤：${this.query}_ · ` + hintLine('↑↓ 移动', 'enter 预览', 'backspace 删词', 'esc 返回'),
          region.width,
        ),
        HINT_STYLE,
      );
    } else {
      buffer.writeText(
        region.row + region.height - 1,
        region.col,
        fitLine(hintLine('↑↓ 移动', 'enter 预览（不改动任何文件）', '打字过滤', 'esc/q 返回'), region.width),
        HINT_STYLE,
      );
    }
  }

  /** preview 段落位：选中成品行 → 三账行/错误行 → 警告行 → 底行段提示 */
  private renderPreview(buffer: CellBuffer, region: Region): void {
    buffer.writeText(region.row, region.col, fitLine('◆ 回退点预览（不改动文件）', region.width));
    buffer.writeText(region.row + 1, region.col, fitLine(this.previewLine, region.width));
    const data = this.previewData;
    if (data === undefined) {
      buffer.writeText(region.row + 2, region.col, fitLine('预览中…', region.width), HINT_STYLE);
    } else if (data.errorText !== undefined) {
      // 诚实拒：只显错误行（Enter 零动作——不进 restore）
      buffer.writeText(region.row + 2, region.col, fitLine(data.errorText, region.width));
    } else {
      buffer.writeText(
        region.row + 2,
        region.col,
        fitLine(`恢复 ${data.restoreCount} · 删除 ${data.deleteCount} · 不动 ${data.untouchedCount}`, region.width),
      );
      buffer.writeText(region.row + 3, region.col, fitLine(WARN_LINE, region.width), WARN_STYLE);
    }
    const hint =
      data !== undefined && data.errorText === undefined
        ? hintLine('enter 确认回退（将新建分支会话）', 'esc 返回列表')
        : 'esc 返回列表';
    buffer.writeText(region.row + region.height - 1, region.col, fitLine(hint, region.width), HINT_STYLE);
  }

  /** 事件分发：滚轮 → Ctrl+C/Ctrl+D 补丁 → 视图分派（移动/预演/确认/取消 → 打字过滤） */
  handleEvent(event: InputEvent): boolean {
    if (this.exited) return true; // 闭锁后终局吞
    if (event.kind === 'mouse') {
      if (event.phase === 'press' && (event.button === 'wheel-up' || event.button === 'wheel-down')) {
        if (this.view === 'list' && this.filtered().length > 0) {
          this.moveCursor(event.button === 'wheel-up' ? -WHEEL_LINES : WHEEL_LINES);
        }
        return true;
      }
      return true; // 非滚轮鼠标相零动作吞（模态独占）
    }
    const k = asKey(event);
    if (k !== null && k.phase !== 'release') {
      // Ctrl+C = 打断在飞 run（不退屏——件族同律）
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
      if (this.view === 'preview') {
        // preview 段：Esc/q 返回列表；Enter 确认（数据就位且无错误——
        // 先收副屏再回调：onRestore 闭包内 busy 守卫→restore→adopt 全编舞）
        if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) {
          this.view = 'list';
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          const data = this.previewData;
          const id = this.previewId;
          if (data !== undefined && data.errorText === undefined && id !== undefined) {
            this.exit(); // 先收副屏再回调（件族律——session-picker 同序）
            // 弃接守卫（防御深度——A-4）：restore 回执责任面在注入域（core:checkpoint
            // 编舞自带兜底折 notify「回退失败」）；面板已收屏无呈现面，此处 catch
            // 只拦 unhandledRejection 逃逸不折态——注入实现未自带兜底时 reject 不得
            // 沿 void 逃出杀进程（与 onPreview .catch 折面板态形职责分立）
            void this.actions.onRestore(id).catch(() => undefined);
          }
          return true; // 加载中/错误态 Enter 零动作（诚实拒）
        }
        return true; // 未消费键终局吞（模态独占）
      }
      const items = this.filtered();
      if (items.length > 0) {
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
          this.clampOffset(items.length);
          return true;
        }
        if (isPlainKey(k, 'end')) {
          this.cursor = items.length - 1;
          this.clampOffset(items.length);
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          // 进 preview 段（锚定选中行 + onPreview 异步加载——加载态自持）
          const chosen = items[this.cursor]!;
          const seq = ++this.previewSeq; // 本次调用序号——迟到守卫值锚
          this.view = 'preview';
          this.previewId = chosen.id;
          this.previewLine = chosen.line;
          this.previewData = undefined;
          void this.actions
            .onPreview(chosen.id)
            .then((data) => {
              // 退出竞态防御：面板已收屏则丢弃（下一开屏重取）；迟到竞态防御：
              // 锚「调用序号」非「条目」——「Enter A（在飞）→ esc 回列表 →
              // Enter（同条目 A）→ 旧调用迟到 resolve」时 previewId 同值拦不住
              // （条目锚漏洞），序号比对拒收旧调用的账目，否则旧三账行错装进
              // 新确认视图（用户看着旧对账数确认破坏性 restore）
              if (!this.exited && this.view === 'preview' && this.previewSeq === seq) {
                this.previewData = data;
              }
            })
            .catch(() => {
              if (!this.exited && this.view === 'preview' && this.previewSeq === seq) {
                this.previewData = {
                  restoreCount: 0,
                  deleteCount: 0,
                  untouchedCount: 0,
                  errorText: '预览失败（回退点可能已被清理）——esc 返回列表',
                };
              }
            });
          return true;
        }
      }
      if (isPlainKey(k, 'escape')) {
        this.exit();
        return true;
      }
      if (isPlainKey(k, 'backspace')) {
        // 过滤词删尾（空词零动作）
        if (this.query !== '') this.query = this.query.slice(0, -1);
        this.cursor = 0; // 过滤集重算——光标归首防越界
        this.clampOffset(this.filtered().length);
        return true;
      }
      // legacy 轨打字（kitty 轨走 text 事件——双轨同收）；q 在无过滤词时是退出
      // 捷键（件族同律），有过滤词时 q 入过滤词（打字面优先）
      const ch = plainChar(k);
      if (ch !== null) {
        this.typeFilter(ch);
        return true;
      }
      return true; // 未消费键终局吞（模态独占）
    }
    if (event.kind === 'text') {
      const text = (event as InputEvent & { kind: 'text'; text: string }).text;
      // preview 视图：text 轨与 key 轨同律——q 视同返回列表（kitty 终端打 q
      // 期望同 key 轨语义），其余打字终局吞（preview 段无过滤面——打字不得
      // 污染过滤词；无门控时 q 会误走 typeFilter→exit() 直退面板）
      if (this.view === 'preview') {
        if (text === 'q') {
          this.view = 'list';
        }
        return true;
      }
      // kitty text 轨：单字符走 q 捷键盘查（件族同律）；多字符 chunk 全串
      // 入词（CJK 直收——行内容中文〔触发形〕是本面板过滤主路径，引擎 text
      // 粒度「同 chunk 连续可打印游程合并」多字符是常态）
      if (text.length === 1) {
        this.typeFilter(text);
        return true;
      }
      if (text.length > 1) {
        this.appendQuery(text);
        return true;
      }
      return true;
    }
    return true;
  }

  /** 过滤词追加（无 q 特例——多字符 chunk 中段 q 不当退出） */
  private appendQuery(str: string): void {
    this.query += str;
    this.cursor = 0; // 过滤集重算——光标归首
    this.clampOffset(this.filtered().length);
  }

  /** 打字入过滤词（q 特例：无过滤词时 = 退出——件族 q 捷键与过滤面共存律） */
  private typeFilter(ch: string): void {
    if (ch === 'q' && this.query === '') {
      this.exit();
      return;
    }
    this.appendQuery(ch);
  }

  /** 光标移动（越界夹取不循环；移动后光标行恒在窗内） */
  private moveCursor(delta: number): void {
    const items = this.filtered();
    this.cursor = Math.max(0, Math.min(items.length - 1, this.cursor + delta));
    this.clampOffset(items.length);
  }

  /** 视口夹取：光标行恒在窗内 + 窗长条目回拉（陈窗深 offset 防御） */
  private clampOffset(rowCount: number): void {
    const maxOffset = Math.max(0, rowCount - this.viewportHeight);
    if (this.offset > maxOffset) this.offset = maxOffset;
    if (this.cursor < this.offset) this.offset = this.cursor;
    else if (this.cursor >= this.offset + this.viewportHeight) {
      this.offset = this.cursor - this.viewportHeight + 1;
    }
  }

  /** 退出（闭锁——确认回退与取消单次收口） */
  private exit(): void {
    if (this.exited) return;
    this.exited = true;
    this.onExit?.();
  }
}
