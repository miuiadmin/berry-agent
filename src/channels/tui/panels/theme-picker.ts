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
 *   Home/End 到首尾）+ 光标驱动视口夹取；光标预选 current 开屏定位现档
 *   （48 轮件 C——跟 codex initial_selected_idx 同语义）；
 * - **样例区即时预览**（48 轮件 C——副屏架构下预览承载面单源）：条目清单
 *   下方固定高样例块，随在选档（cursor）现算换色；auto/坏文件诚实缺席
 *   （维持基样 + 标签明示）；矮窗（<9 行）整区缺席零挤压；
 * - **复制主题名（56 轮件 3 复制回执）**：'c' 复制在选主题名（不退屏——面板
 *   驻留可连选连贴）；剪贴板写链 + notify 回执全归 onCopy 装配闭包（本件零
 *   边外面）；onCopy 缺席 = 'c' 键零动作零回执（注入缺席键无效零行为变——
 *   onDelete/onPreview 同律）且底行提示不含复制段（缺席保持原形不虚报）；
 * - **退出键面**：q/Esc 退出、Ctrl+C 打断、Ctrl+D 退出进程（先收副屏再转
 *   退出柄）——副屏键面件族律。
 */
import type { CellBuffer, CellStyle, ColorValue, InputEvent, Region } from '../../engine/index.js';
import { fitLine, fitRowSegments } from '../row-segments.js';
import type { OverlayContent } from '../overlay/overlay.js';
import { hintLine } from '../keys/hint.js';
import {
  activeRowStyleOf,
  CURSOR_MARK,
  fitIndicatorViewport,
  headStyleOf,
  moreHint,
  PICKER_HEAD_MARK,
  stepCursorWrap,
} from './panel-chrome.js';
import { builtinPalette, DEFAULT_THEME, resolveTheme, type ResolvedTheme } from '../theme/index.js';
import { overlayBoard } from '../theme/custom.js';
import type { PartialSemanticPalette } from '../theme/semantic.js';
import { DIM_STYLE, stringWidth, truncateToWidth } from '../../engine/index.js';

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
   * 复制主题名（56 轮件 3 复制回执——'c' 键复制在选主题名）：装配闭包承载
   * 剪贴板写链（backend.copyToClipboard 单源）+ notify 回执（「已复制主题名：
   * <名>」——/copy 回执同族词面）；缺席时 'c' 键零动作、底行提示不含复制段。
   */
  readonly onCopy?: (name: string) => void;
  /**
   * 主题（界面美化役 2026-10-01 美学批——头行 accent 着色注入位）：测试装配
   * 缺省 DEFAULT_THEME；主会话装配位已接线（tui-backend theme: this.theme）。
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
/** 样例区高（48 轮件 C 即时预览——标签 1 行 + 静态样例 5 行） */
const SAMPLE_HEIGHT = 6;
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
 * 条目预览主题取值（48 轮件 C 样例区即时预览——纯函数，测试直锁）：dark/
 * light 内置板 resolve 管线现算；自定义完好档 overlay 在场时 dark 基板合成
 * 后同管线现算；auto（探测依赖——副屏期 OSC 11 回执丢弃已知边界）/坏文件
 * （无真值）/未注入自定义板 → null 诚实缺席（样例区维持基样 + 标签明示）。
 */
export function previewThemeOf(entry: ThemePickEntry): ResolvedTheme | null {
  if (entry.broken) return null;
  if (entry.name === 'dark' || entry.name === 'light') {
    return resolveTheme(builtinPalette(entry.name), DEFAULT_THEME.depth);
  }
  // 自定义板（overlay 注入形——主会话接线位）：dark 基板覆盖合成后同管线现算
  //（缺键回退基板同位键——currentBoard 同语义；depth 随 builtin 腿同源）
  if (entry.overlay !== undefined) {
    return resolveTheme(overlayBoard(builtinPalette('dark'), entry.overlay), DEFAULT_THEME.depth);
  }
  return null;
}

/**
 * 条目色样段取值（纯函数——测试直锁消费）：装配位注入值优先；resolve 腿
 * 单源经 previewThemeOf（dark/light 内置 / overlay 合成——同管线同 depth）；
 * auto（探测依赖）/坏文件（无真值）/未注入自定义板——null 诚实不画。
 */
export function swatchOf(entry: ThemePickEntry): readonly ColorValue[] | null {
  if (entry.broken) return null;
  if (entry.swatch !== undefined) return entry.swatch;
  const resolved = previewThemeOf(entry);
  return resolved !== null ? [resolved.accent, resolved.success, resolved.error, resolved.secondary] : null;
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
  /** 复制柄（56 轮件 3——缺席 'c' 键零动作） */
  private readonly onCopy: ((name: string) => void) | undefined;
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
  /** 在选行整行样式（R-9——accent bold；右段辅助段随光标行覆写） */
  private readonly activeRowStyle: Readonly<CellStyle>;
  /** 样例区基样（48 轮件 C——预览缺席时样例行维持注入档；缺省 DEFAULT_THEME） */
  private readonly baseTheme: ResolvedTheme;

  constructor(options: ThemePickerOptions) {
    this.entries = options.entries;
    this.current = options.current;
    this.onSelect = options.onSelect;
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
    this.onCopy = options.onCopy;
    this.baseTheme = options.theme ?? DEFAULT_THEME;
    this.headStyle = headStyleOf(this.baseTheme);
    this.activeRowStyle = activeRowStyleOf(this.baseTheme);
    // 光标预选 current（48 轮件 C——跟 codex initial_selected_idx 同语义）：
    // 开屏定位现档（条目多时省找）+ 初帧样例 = 现装档自洽；不在清单 -1 → 0 兜底
    this.cursor = Math.max(
      0,
      this.entries.findIndex((e) => e.name === this.current),
    );
  }

  /** 量高：头行 + 条目全量 + 样例区（48 轮件 C——非空集 SAMPLE_HEIGHT；空集不立）+ 底行提示（副屏 root 不经布局路——render 按实际 region 窗口化） */
  measure(width: number): number {
    void width;
    return 1 + Math.max(1, this.entries.length) + (this.entries.length > 0 ? SAMPLE_HEIGHT : 0) + 1;
  }

  /** 落位：头行（accent）→ 条目视口（光标 › + 当前 ● + 名 / ⚠·说明右段 + 行尾色样段；长清单 dim 边行滚动指示）→ 样例区（即时预览）→ 底行提示 */
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
    // 样例区立位守卫（48 轮件 C）：非空集且整区恰容（头 1 + 条目下限 1 +
    // 样例 SAMPLE_HEIGHT + 底行 1 = 9）才立——矮窗整区缺席零挤压残段
    const samplesOn = this.entries.length > 0 && region.height >= 1 + 1 + SAMPLE_HEIGHT + 1;
    // 守卫族语义（height=2 → 零内容行只头行+底行）：下限 0——旧 Math.max(1,·)
    // 在 height=2 强立 1 行内容，首内容行先写后又被底行覆写留残段；样例区
    // 在场时条目视口同步让高（底行位不动——region.height-1 恒律）
    const viewHeight = Math.max(0, region.height - 2 - (samplesOn ? SAMPLE_HEIGHT : 0));
    this.viewportHeight = viewHeight;
    this.clampOffset();
    if (viewHeight > 0) {
      if (this.entries.length === 0) {
        buffer.writeText(region.row + 1, region.col, fitLine('（无条目）', region.width), HINT_STYLE);
      } else {
        // 界面美化役 2026-10-01 美学批（长清单滚动位置指示）：视口 ≥3 行且溢出
        // 才立——窗上/下方还有条目时各留一行 dim 边行「↑/↓ N 更多」（todo-panel
        // 溢出行先例形）；预留行挤压后光标跟随（指示行不遮在选行）。
        // 39 池 P4 件：三行预留收窄窗收敛段收编 panel-chrome 共享段
        // fitIndicatorViewport（session-picker 同构消费——件间不一致封堵）；
        // 本段收敛行为零变（既有指示测试为锁）
        const fit = fitIndicatorViewport(viewHeight, this.offset, this.cursor, this.entries.length);
        this.offset = fit.offset;
        const indicatorsOn = fit.on;
        const cap = fit.cap; // 条目实占行数（扣除指示预留）
        let displayRow = region.row + 1;
        if (indicatorsOn && this.offset > 0) {
          // 指示行 fitLine … 收口（X-5 件族律——session-picker 收编同形；窄窗
          // 硬截断无提示是 raw writeText 既有缺口，本批随收编面同笔升级）
          buffer.writeText(displayRow, region.col, fitLine(moreHint('↑', this.offset), region.width), HINT_STYLE);
          displayRow++;
        }
        for (let i = 0; i < cap; i++) {
          const index = this.offset + i;
          if (index >= this.entries.length) break;
          this.renderRow(buffer, displayRow++, region.col, region.width, index);
        }
        if (indicatorsOn) {
          const below = this.entries.length - (this.offset + cap);
          if (below > 0) {
            buffer.writeText(displayRow, region.col, fitLine(moreHint('↓', below), region.width), HINT_STYLE);
          }
        }
      }
    }
    // 样例区（48 轮件 C 即时预览）：条目视口后 SAMPLE_HEIGHT 行——条目+指示
    // 实占恰 viewHeight（指示预留行在视口内不外溢），起位 = 头行 + viewHeight
    if (samplesOn) this.renderSample(buffer, region.row + 1 + viewHeight, region.col, region.width);
    // 底行提示：复制段只在 onCopy 在场时呈（缺席保持原形不虚报——注入缺席
    // 键无效则提示面同步缺席）；空表零键段（无可复制对象）
    const hint =
      this.entries.length === 0
        ? 'q/esc 返回'
        : this.onCopy !== undefined
          ? hintLine('↑↓ 移动', 'enter 选定（立即生效并保存）', 'c 复制名', 'q/esc 返回')
          : hintLine('↑↓ 移动', 'enter 选定（立即生效并保存）', 'q/esc 返回');
    buffer.writeText(region.row + region.height - 1, region.col, fitLine(hint, region.width), HINT_STYLE);
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
    // 在选行整行 accent bold（R-9——codex 全 spans 律：右段辅助段随光标行覆写）；
    // 行尾色样段语义色不参与覆写（语义色优先于装饰律——setCell 独立写位不动）
    const active = index === this.cursor ? this.activeRowStyle : undefined;
    buffer.writeText(row, col, fit.left, active);
    if (fit.rightWidth > 0) buffer.writeText(row, col + budget - fit.rightWidth, fit.right, active ?? HINT_STYLE);
    // 色样段：右缘贴齐逐块着色（accent/success/error/secondary 语义四段）
    if (reserveSwatch) {
      for (let i = 0; i < swatch!.length; i++) {
        buffer.setCell(row, col + width - swatch!.length + i, SWATCH_CELL, { fg: swatch![i]! });
      }
    }
  }

  /**
   * 样例区落位（48 轮件 C 即时预览——cursor 即预览指针，render 现算零第二账）：
   * 标签行 + 5 行手写静态样例（模拟主屏角色行——用户 accent 前缀 / 助手文本 /
   * 代码双段 / success·error 双态 / secondary 弱提示；全部静态串非 AI 文本）。
   * 在选档可预览 → 该档 ResolvedTheme 派生色着色（预览即时换色）；缺席
   * （auto 探测依赖 / 坏文件 / 未注入）→ 样例行维持基样 + 标签「预览缺席 ·
   * <原因>」明示（零误导）。窄窗逐段按剩余预算 … 收口（X-5 同惯例）。
   */
  private renderSample(buffer: CellBuffer, row: number, col: number, width: number): void {
    const entry = this.entries[this.cursor]!;
    const preview = previewThemeOf(entry);
    // 标签行：在场形着该档 accent 派生样式（头行同派生路）；缺席形 dim 明示原因
    const absentReason = entry.broken ? '坏文件' : entry.detail; // 原因单源 = 条目右段
    const label = preview !== null ? `◆ 预览 · ${entry.name}` : `◆ 预览缺席 · ${absentReason}`;
    buffer.writeText(row, col, fitLine(label, width), preview !== null ? headStyleOf(preview) : HINT_STYLE);
    // 样例着色档：可预览用该档；缺席维持基样（options.theme 注入基准）
    const theme = preview ?? this.baseTheme;
    // 单行段化写位：逐段按剩余预算截断（末段越窗补 …——fitLine 同惯例）
    const sampleLine = (line: number, segments: readonly (readonly [string, ColorValue | undefined])[]): void => {
      let c = col;
      for (const [text, fg] of segments) {
        const remain = width - (c - col);
        if (remain <= 0) break;
        const seg = stringWidth(text) <= remain ? text : remain <= 1 ? '…' : `${truncateToWidth(text, remain - 1)}…`;
        buffer.writeText(line, c, seg, fg !== undefined ? { fg } : undefined);
        c += stringWidth(seg);
      }
    };
    sampleLine(row + 1, [
      ['› ', theme.accent],
      ['帮我把这段代码重构一下', theme.text], // 用户行（accent 提示符 + 正文）
    ]);
    sampleLine(row + 2, [['已重构完成，改动 3 处', theme.text]]); // 助手文本行
    sampleLine(row + 3, [
      ['const ', theme.codeKeyword],
      ['name = ', theme.text],
      ['"berry-agent"', theme.codeString], // 代码行（关键字/字符串双段）
    ]);
    sampleLine(row + 4, [
      ['✓ 已完成', theme.success],
      ['  ', undefined],
      ['✗ 已失败', theme.error], // 双态行（成功/错误并陈）
    ]);
    sampleLine(row + 5, [['⋯ 次要信息示例', theme.secondary]]); // 弱提示行
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
        // 'c' = 复制在选主题名（56 轮件 3——不退屏面板驻留；onCopy 缺席键
        // 无效零行为变——注入缺席同律，提示面同步缺席不虚报）
        if (isPlainKey(k, 'c') && this.onCopy !== undefined) {
          this.onCopy(this.entries[this.cursor]!.name);
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
    if (event.kind === 'text' && event.text === 'c') {
      // kitty disambiguate 轨复制腿（'q' 同形坑——纯键打字走 text 事件）；空表/
      // 缺席零动作（键事件轨同判据，双轨形为一致）
      if (this.onCopy !== undefined && this.entries.length > 0) {
        this.onCopy(this.entries[this.cursor]!.name);
      }
      return true;
    }
    return true; // 未消费键终局吞（模态独占）
  }

  /** 光标移动（单步环绕/大步夹取——挖掘 35 轮 B6 分立律；移动后光标恒可见） */
  private moveCursor(delta: number): void {
    this.cursor = stepCursorWrap(this.cursor, delta, this.entries.length);
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
