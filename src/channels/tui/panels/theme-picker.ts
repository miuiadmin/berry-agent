/**
 * /themes 主题切换副屏件（07 §4.1 命令面增补批——TUI 本地拦截族）：session-
 * picker 形选择器——▸ 光标 + enter 选定 + 当前档 ● 标记 + 坏文件条目 ⚠ 标注。
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
import type { CellBuffer, CellStyle, InputEvent, Region } from '../../engine/index.js';
import { fitRowSegments } from '../row-segments.js';
import type { OverlayContent } from '../overlay/overlay.js';

/** 主题条目（装配位合成：内置三档 + themes/ 目录文件名） */
export interface ThemePickEntry {
  /** 主题名（'auto' | 'dark' | 'light' | 自定义名——settings `theme` 键值） */
  readonly name: string;
  /** 行说明（右段——auto 探测语义 / 内置板名 / 自定义文件形） */
  readonly detail: string;
  /** 坏文件标注（自定义板解析失败——⚠ 呈现；选定走装配位 warn 回退） */
  readonly broken: boolean;
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
}

/** 提示行样式（dim） */
const HINT_STYLE: Readonly<CellStyle> = Object.freeze({ dim: true });
/** 光标行标记（在选行） */
const CURSOR_MARK = '▸';
/** 当前档标记 */
const CURRENT_MARK = '●';
/** 坏文件标记（⚠ + 短语——右段前缀） */
const BROKEN_MARK = '⚠ 坏文件';
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

  constructor(options: ThemePickerOptions) {
    this.entries = options.entries;
    this.current = options.current;
    this.onSelect = options.onSelect;
    this.sessionId = options.sessionId;
    this.onExit = options.onExit;
    this.onInterrupt = options.onInterrupt;
    this.onQuit = options.onQuit;
  }

  /** 量高：头行 + 条目全量 + 底行提示（副屏 root 不经布局路——render 按实际 region 窗口化） */
  measure(width: number): number {
    void width;
    return 1 + Math.max(1, this.entries.length) + 1;
  }

  /** 落位：头行 → 条目视口（光标 ▸ + 当前 ● + 名 / ⚠·说明右段）→ 底行提示 */
  render(buffer: CellBuffer, region: Region): void {
    if (region.height < 2) return; // 防御位（极小终端）
    const head = this.entries.length === 0 ? '◆ 主题切换 · 无条目' : `◆ 主题切换 · ${this.entries.length} 档`;
    buffer.writeText(region.row, region.col, head);
    const viewHeight = Math.max(1, region.height - 2);
    this.viewportHeight = viewHeight;
    this.clampOffset();
    if (this.entries.length === 0) {
      buffer.writeText(region.row + 1, region.col, '（无主题条目——内置三档恒在，此形属装配防御位）', HINT_STYLE);
    } else {
      for (let i = 0; i < viewHeight; i++) {
        const index = this.offset + i;
        if (index >= this.entries.length) break;
        this.renderRow(buffer, region.row + 1 + i, region.col, region.width, index);
      }
    }
    buffer.writeText(
      region.row + region.height - 1,
      region.col,
      this.entries.length === 0 ? 'q/esc 返回' : '↑↓ 移动 · enter 选定（即时换装 + 持久化） · q/esc 返回',
      HINT_STYLE,
    );
  }

  /** 单行落位：左段（光标 + 当前标记 + 名）+ 右段（坏文件 ⚠ + 说明）右对齐 */
  private renderRow(buffer: CellBuffer, row: number, col: number, width: number, index: number): void {
    const entry = this.entries[index]!;
    const right = `${entry.broken ? `${BROKEN_MARK} · ` : ''}${entry.detail}`;
    // 左段 = 光标标记 + 当前档标记 + 名
    const prefix = index === this.cursor ? `${CURSOR_MARK} ` : '  ';
    const mark = entry.name === this.current ? `${CURRENT_MARK} ` : '  ';
    const left = `${prefix}${mark}${entry.name}`;
    // 右段预算律单源：右段先按预算 … 截断再右对齐（窄窗不再负起列劈毁档名）
    const fit = fitRowSegments(left, right, width);
    buffer.writeText(row, col, fit.left);
    if (fit.rightWidth > 0) buffer.writeText(row, col + width - fit.rightWidth, fit.right, HINT_STYLE);
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
