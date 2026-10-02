/**
 * /themes 主题切换副屏件（07 §4.1 命令面增补批——TUI 本地拦截族）：session-
 * picker 形选择器——› 光标 + enter 选定 + 当前档 ● 标记 + 坏文件条目 ⚠ 标注。
 *
 * - **条目形**：内置 auto / dark / light 三档 + themes/ 目录自定义主题文件
 *   （条目清单装配位现取注入——本件只收纯数据行）；坏文件（解析失败）条目
 *   ⚠ 标注、含入不滤（选定走装配位 warn 回退既有档——本件不触文件面）；
 * - **选定先收副屏再回调**（SessionPicker 同序律）：onSelect 收主题名，即时
 *   换装 + settings 持久化 + OSC 编舞全归装配闭包（backend.setThemeSetting
 *   单入口），本件零边外面；
 * - **光标选择模型**（SkillsViewer 同基建）：↑/↓ 移动（PgUp/PgDn 翻选、
 *   Home/End 到首尾）+ 光标驱动视口夹取；
 * - **退出键面**：q/Esc 退出、Ctrl+C 打断、Ctrl+D 退出进程（先收副屏再转
 *   退出柄）——副屏键面件族律。
 */
import type { CellBuffer, CellStyle, ColorValue, InputEvent, Region } from '../../engine/index.js';
import { fitLine, fitRowSegments } from '../row-segments.js';
import type { OverlayContent } from '../overlay/overlay.js';
import { hintLine } from '../keys/hint.js';
import { CURSOR_MARK, headStyleOf, moreHint, PICKER_HEAD_MARK } from './panel-chrome.js';
import { builtinPalette, DEFAULT_THEME, resolveTheme, type ResolvedTheme } from '../theme/index.js';
import { overlayBoard } from '../theme/custom.js';
import type { PartialSemanticPalette } from '../theme/semantic.js';
import { DIM_STYLE } from '../../engine/index.js';

/** 主题条目（装配位合成：内置三档 + themes/ 目录文件名） */
export interface ThemePickEntry {
  /** 主题名（'auto' | 'dark' | 'light' | 自定义名——settings `theme` 键值） */
  readonly name: string;
  /** 行说明（右段——auto 探测语义 / 内置板名 / 自定义文件形） */
  readonly detail: string;
  /** 坏文件标注（自定义板解析失败——⚠ 呈现；选定走装配位 warn 回退） */
  readonly broken: boolean;
  /**
   * 语义色样段（界面美化役 2026-10-01 美学批）：accent/success/error/
   * secondary 四段 resolve 后真色值——装配位对自定义板现算注入；缺席时
   * 内置 dark/light 档本件 builtinPalette 现算回退（复用 resolve 管线），
   * auto（探测依赖）/坏文件（无真值）诚实不画。
   */
  readonly swatch?: readonly ColorValue[];
  /**
   * 自定义板覆盖表（界面美化役主会话接线位）：装配位注入坏检查时已加载的
   * overlay——swatch 缺席时本件现算色样（dark 基板合成后走 resolve 管线，
   * 同 builtin 腿 depth 形）；坏文件/内置档缺席。
   */
  readonly overlay?: PartialSemanticPalette;
}

/** 主题选择器装配选项 */
export interface ThemePickerOptions {
  /** 条目快照（字典序由装配保证——本件原样呈现） */
  readonly entries: readonly ThemePickEntry[];
  /** 当前档名（● 标记判据——backend 观测位现取注入） */
  readonly current: string;
  /** 选定回调（主题名——先收副屏再回调） */
  readonly onSelect: (name: string) => void;
  readonly sessionId: string;
  readonly onExit: () => void;
  readonly onInterrupt?: (sessionId: string) => void;
  readonly onQuit?: () => void;
  /**
   * 主题（界面美化役 2026-10-01 美学批——头行 accent 着色注入位）：缺省
   * DEFAULT_THEME（装配位接线前呈现不缺色——挂账装配）。
   */
  readonly theme?: ResolvedTheme;
}

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = DIM_STYLE;
/** 当前档标记 */
const CURRENT_MARK = '●';
/** 坏文件标记（⚠ + 短语——右段前缀） */
const BROKEN_MARK = '⚠ 坏文件';
/** 色样块字符（语义色样段——每块单列，四块拼行尾色带） */
const SWATCH_CELL = '■';
/** 滚轮单步行数（ScrollView WHEEL_LINES 同值——vim mousescroll ver 缺省档三行；mu-2 件族面） */
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
 * 条目色样段取值（纯函数——测试直锁消费）：装配位注入值优先；内置 dark/
 * light 档 builtinPalette 现算回退（resolveTheme 复用既有 resolve 管线）；
 * auto（探测依赖）/坏文件（无真值）/未注入自定义板——null 诚实不画。
 */
export function swatchOf(entry: ThemePickEntry): readonly ColorValue[] | null {
  if (entry.broken) return null;
  if (entry.swatch !== undefined) return entry.swatch;
  if (entry.name === 'dark' || entry.name === 'light') {
    const resolved = resolveTheme(builtinPalette(entry.name), DEFAULT_THEME.depth);
    return [resolved.accent, resolved.success, resolved.error, resolved.secondary];
  }
  // 自定义板（overlay 注入形——主会话接线位）：dark 基板覆盖合成后同管线现算
  //（缺键回退基板同位键——currentBoard 同语义；depth 随 builtin 腿同源）
  if (entry.overlay !== undefined) {
    const resolved = resolveTheme(overlayBoard(builtinPalette('dark'), entry.overlay), DEFAULT_THEME.depth);
    return [resolved.accent, resolved.success, resolved.error, resolved.secondary];
  }
  return null;
}

/**
 * 主题选择器内容件（OverlayContent——副屏 root 直收全屏 region；自持光标与
 * 视口窗口，SkillsViewer 同基建）。快照档——构造后静态，返回主屏全帧补显。
 */
export class ThemePicker implements OverlayContent {
  private readonly entries: readonly ThemePickEntry[];
  private readonly current: string;
  private readonly onSelect: (name: string) => void;
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
  /** 头行 accent 派生样式（theme 注入位——缺省 DEFAULT_THEME） */
  private readonly headStyle: Readonly<CellStyle>;

  constructor(options: ThemePickerOptions) {
    this.entries = options.entries;
    this.current = options.current;
    this.onSelect = options.onSelect;
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.headStyle = headStyleOf(options.theme ?? DEFAULT_THEME);
  }

  /** 量高：头行 + 条目全量 + 底行提示（副屏 root 不经布局路——render 按实际 region 窗口化） */
  measure(width: number): number {
    void width;
    return 1 + Math.max(1, this.entries.length) + 1;
  }

  /** 落位：头行（accent）→ 条目视口（光标 › + 当前 ● + 名 / ⚠·说明右段 + 行尾色样段；长清单 dim 边行滚动指示）→ 底行提示 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    const head =
      this.entries.length === 0
        ? `${PICKER_HEAD_MARK} 主题切换 · 无条目`
        : `${PICKER_HEAD_MARK} 主题切换 · ${this.entries.length} 个主题`;
    // 非条目行（头行/空条目行/底行）fitLine … 收口（wf_3c8b00b8 组δ X-5 补漏
    // ——raw writeText 窄窗硬截断无提示；条目行走 fitRowSegments 双段）；
    // 头行 accent 着色（界面美化役美学注④——词汇 ◆ 单源 panel-chrome）
    buffer.writeText(region.row, region.col, fitLine(head, region.width), this.headStyle);
    const viewHeight = Math.max(1, region.height - 2);
    this.viewportHeight = viewHeight;
    this.clampOffset();
    if (this.entries.length === 0) {
      buffer.writeText(region.row + 1, region.col, fitLine('（无条目）', region.width), HINT_STYLE);
    } else {
      // 界面美化役 2026-10-01 美学批（长清单滚动位置指示）：视口 ≥3 行且溢出
      // 才立——窗上/下方还有条目时各留一行 dim 边行「↑/↓ N 更多」（todo-panel
      // 溢出行先例形）；预留行挤压后光标跟随（指示行不遮在选行）
      const indicatorsOn = viewHeight >= 3 && this.entries.length > viewHeight;
      let cap = viewHeight; // 条目实占行数（扣除指示预留）
      for (let round = 0; round < 3; round++) {
        const topReserve = indicatorsOn && this.offset > 0;
        const afterTop = viewHeight - (topReserve ? 1 : 0);
        const bottomReserve = indicatorsOn && this.entries.length - this.offset - afterTop > 0;
        cap = afterTop - (bottomReserve ? 1 : 0);
        // 光标恒在收窄窗内（越窗提窗——预留翻转后再收敛，三轮封顶）
        if (this.cursor < this.offset) {
          this.offset = this.cursor;
          continue;
        }
        if (this.cursor >= this.offset + cap) {
          this.offset = this.cursor - cap + 1;
          continue;
        }
        break;
      }
      let displayRow = region.row + 1;
      if (indicatorsOn && this.offset > 0) {
        buffer.writeText(displayRow, region.col, moreHint('↑', this.offset), HINT_STYLE);
        displayRow++;
      }
      for (let i = 0; i < cap; i++) {
        const index = this.offset + i;
        if (index >= this.entries.length) break;
        this.renderRow(buffer, displayRow++, region.col, region.width, index);
      }
      if (indicatorsOn) {
        const below = this.entries.length - (this.offset + cap);
        if (below > 0) buffer.writeText(displayRow, region.col, moreHint('↓', below), HINT_STYLE);
      }
    }
    buffer.writeText(
      region.row + region.height - 1,
      region.col,
      fitLine(
        this.entries.length === 0 ? 'q/esc 返回' : hintLine('↑↓ 移动', 'enter 选定（立即生效并保存）', 'q/esc 返回'),
        region.width,
      ),
      HINT_STYLE,
    );
  }

  /** 单行落位：左段（光标 + 当前标记 + 名）+ 右段（坏文件 ⚠ + 说明）右对齐 + 行尾语义色样段 */
  private renderRow(buffer: CellBuffer, row: number, col: number, width: number, index: number): void {
    const entry = this.entries[index]!;
    const right = `${entry.broken ? `${BROKEN_MARK} · ` : ''}${entry.detail}`;
    // 左段 = 光标标记 + 当前档标记 + 名
    const prefix = index === this.cursor ? `${CURSOR_MARK} ` : '  ';
    const mark = entry.name === this.current ? `${CURRENT_MARK} ` : '  ';
    const left = `${prefix}${mark}${entry.name}`;
    // 界面美化役美学批（色样段）：行尾预留色带位（有样且窗宽足够才留——
    // 窄于色带+1 列整幅让给文本，色样诚实缺席）
    const swatch = swatchOf(entry);
    const reserveSwatch = swatch !== null && width > swatch.length + 1;
    const budget = reserveSwatch ? width - swatch!.length - 1 : width;
    // 右段预算律单源：右段先按预算 … 截断再右对齐（窄窗不再负起列劈毁档名）
    const fit = fitRowSegments(left, right, budget);
    buffer.writeText(row, col, fit.left);
    if (fit.rightWidth > 0) buffer.writeText(row, col + budget - fit.rightWidth, fit.right, HINT_STYLE);
    // 色样段：右缘贴齐逐块着色（accent/success/error/secondary 语义四段）
    if (reserveSwatch) {
      for (let i = 0; i < swatch!.length; i++) {
        buffer.setCell(row, col + width - swatch!.length + i, SWATCH_CELL, { fg: swatch![i]! });
      }
    }
  }

  /** 事件分发（副屏内容终局消费）：滚轮 → Ctrl+C/Ctrl+D 补丁 → 选定/取消 → 移动键 */
  handleEvent(event: InputEvent): boolean {
    if (event.kind === 'mouse') {
      // 滚轮 = 光标 ±3 行（mu-2 件族面——经 moveCursor 既有夹取与视口跟随，
      // ↑↓ 同路）；wheel 无 release 相（终端不报——press 一相到达）；非滚轮
      // 鼠标相零动作吞（v1 无选区/点击面，模态独占）
      if (event.phase === 'press' && (event.button === 'wheel-up' || event.button === 'wheel-down')) {
        if (this.entries.length > 0) {
          this.moveCursor(event.button === 'wheel-up' ? -WHEEL_LINES : WHEEL_LINES);
        }
        return true;
      }
      return true;
    }
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
      if (this.entries.length > 0) {
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
          return true;
        }
        if (isPlainKey(k, 'end')) {
          this.cursor = this.entries.length - 1;
          this.clampOffset();
          return true;
        }
        if (isPlainKey(k, 'enter')) {
          const chosen = this.entries[this.cursor]!.name;
          this.exit(); // 先收副屏再选定（换装/持久化归装配闭包）
          this.onSelect(chosen);
          return true;
        }
      }
      if (isPlainKey(k, 'escape') || isPlainKey(k, 'q')) {
        this.exit();
        return true;
      }
    }
    if (event.kind === 'text' && event.text === 'q') {
      this.exit(); // kitty disambiguate 轨纯键打字走 text 事件
      return true;
    }
    return true; // 未消费键终局吞（模态独占）
  }

  /** 光标移动（越界夹取——不循环；移动后光标恒可见） */
  private moveCursor(delta: number): void {
    this.cursor = Math.max(0, Math.min(this.entries.length - 1, this.cursor + delta));
    this.clampOffset();
  }

  /** 视口夹取：光标行恒在窗内（下溢提窗 / 上溢压窗） */
  private clampOffset(): void {
    // 窗高上界：视口长高时 offset 不得深于「尾行恰贴窗底」位（首渲染前击键
    // 会以陈 viewportHeight=1 夹出过深 offset——render 回写真实窗高后回拉）
    const maxOffset = Math.max(0, this.entries.length - this.viewportHeight);
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
