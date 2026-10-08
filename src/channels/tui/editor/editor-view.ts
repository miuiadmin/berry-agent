/**
 * 多行输入件视图（Editor 件族渲染件）：composer 形 + 视口滚动 + 光标声明。
 *
 * 渲染职责（07 §4.1 引擎节件 6；V-0 注③ 全宽框退役——codex 对齐）：
 * - `› ` 提示符 2 列 + 续行两空格缩进（与 transcript user 块同语言同字符），
 *   框线零占位；聚焦 › accent / 非聚焦 secondary（焦点指示新载体——两态
 *   色值承旧过渡，V-3 落码批定值）；
 * - 底色染色块（userMessageBg）：探测背景在场时整 region 铺底再覆写前缀/
 *   正文；缺席零背景带诚实回退——› 前缀独挑边界；
 * - 呈现最小高 3 + 上下空行垫各 1（2026-10-08 TUI 对标 Codex 五件批 A+B：
 *   空稿视觉块体量化、底栈视觉呼吸垫——垫随高度一并让路的高位先行分档）；
 * - 长行字素硬折的视觉行视口——光标恒可视（渲染时滚动夹取）；
 * - 滚动指示 ↑N / ↓N overlay 写首/末内容行右端（有溢出才显；按视口宽度
 *   阈值取全形/紧凑形，不再依框形）；
 * - IME 预编辑段以下划线样式呈现于光标处（不并入正文——正文归模型提交路）；
 * - 聚焦时本帧光标声明（宽字素首列——显示列算术保证不落半字）。
 */
import type { CellBuffer, Region, Renderable } from '../../engine/index.js';
import { graphemeWidth, splitGraphemes, stringWidth } from '../../engine/index.js';
import { prefixDisplayWidth } from './visual-lines.js';
import type { EditorModel } from './editor-model.js';
import { EDITOR_PAD_ROWS, MIN_PRESENTED_LINES, presentedLineCount } from './height-cap.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import type { CellStyle } from '../../engine/index.js';
import { DIM_STYLE } from '../../engine/index.js';
import { CURSOR_MARK, moreHint } from '../panels/panel-chrome.js';

/** 提示符前缀占列宽（`› `——首行前缀与续行缩进同宽 2，折行算术对称） */
const PREFIX_WIDTH = 2;

/** 最大可视行数缺省（backend 构造期注入帽公式同值 max(5, rows*0.3)——pi 同形；装配层启动快照注入已撤〔第六轮批〕） */
const DEFAULT_MAX_VISIBLE_LINES = 8;

/**
 * 编辑器视图：模型只读消费 + 自持视口偏移；measure / render 双段协商。
 */
export class EditorView implements Renderable {
  private focused = false;
  /** 视口首行（视觉行下标——render 时对光标夹取自愈） */
  private scrollOffset = 0;
  /** 最大可视行数（resize 随动可变——批 10k 遗漏修：装配层按新几何 setMaxVisibleLines） */
  private maxVisibleLines: number;
  /** 上次呈现行数（迟滞带决策输入——R3 批 10j） */
  private lastShownLines = 0;
  /** 呈现最小高（缺省规范值 3——五件批 A+B；底铬瞬时输入行显式 1 回归旧几何） */
  private minPresentedLines: number;
  /** 上下空行垫行数（缺省规范值 2——五件批 A+B；底铬瞬时输入行显式 0） */
  private padRows: number;
  /** 上次量高的裸内容视觉行数（contentRows() 夹帽导出的底数——分配梯经 contentRows() 间接取帽内值、renderFixed 从不直读本字段〔sweep23-件1 口径，挖 24 勘正原「梯输入」断言〕） */
  private lastContentRows = 0;
  /** › 提示符聚焦态样式（accent——V-0 注③ 焦点指示新载体；setTheme 随底色重建合成形） */
  private promptFocused: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.accent });
  /** › 提示符非聚焦态样式（secondary 降档——承旧边框两态色过渡；setTheme 重建） */
  private promptUnfocused: Readonly<CellStyle> = Object.freeze({ fg: DEFAULT_THEME.secondary });
  /**
   * 底色染色块铺底样式（userMessageBg）：探测背景在场时整 region 铺底空格
   * 携底色（V-0 注③）；缺席为 null——零背景带诚实回退，› 前缀独挑边界。
   */
  private bandStyle: Readonly<CellStyle> | null =
    DEFAULT_THEME.userMessageBg === undefined ? null : Object.freeze({ bg: DEFAULT_THEME.userMessageBg });
  /** 正文样式（底色在场时正文格携 bg 覆写铺底格；缺席 undefined——透明写） */
  private contentStyle: Readonly<CellStyle> | undefined =
    DEFAULT_THEME.userMessageBg === undefined ? undefined : Object.freeze({ bg: DEFAULT_THEME.userMessageBg });
  /** 滚动指示 overlay 样式（dim；底色在场时携 bg 维持带连续——覆盖写不凿洞） */
  private indicatorStyle: Readonly<CellStyle> = DIM_STYLE;
  /** 预编辑段样式（下划线——组字挂起提示；底色在场时携 bg 合成） */
  private preeditStyle: Readonly<CellStyle> = Object.freeze({ underline: true });

  constructor(
    private readonly model: EditorModel,
    options: { maxVisibleLines?: number; minPresentedLines?: number; padRows?: number } = {},
  ) {
    this.maxVisibleLines = Math.max(1, options.maxVisibleLines ?? DEFAULT_MAX_VISIBLE_LINES);
    // 呈现策略参数化（五件批 A+B）：缺省 = 规范值（主 composer——最小高 3 +
    // 垫 2）；底铬瞬时输入行（viewer 导出/搜索行——单行形设计锁）显式
    // { minPresentedLines: 1, padRows: 0 } 回归旧几何——A+B 辖主 composer 不辖底铬
    this.minPresentedLines = Math.max(1, options.minPresentedLines ?? MIN_PRESENTED_LINES);
    this.padRows = Math.max(0, options.padRows ?? EDITOR_PAD_ROWS);
  }

  /** 帽随几何重设（批 10k 遗漏修——同值早退不重置迟滞带账） */
  setMaxVisibleLines(cap: number): void {
    const next = Math.max(1, cap);
    if (next === this.maxVisibleLines) return;
    this.maxVisibleLines = next;
  }

  /** 主题换装（OSC 11 probe 裁定后 backend 注入——派生样式整体重建含底色合成形） */
  setTheme(theme: ResolvedTheme): void {
    const bg = theme.userMessageBg;
    this.bandStyle = bg === undefined ? null : Object.freeze({ bg });
    this.contentStyle = bg === undefined ? undefined : Object.freeze({ bg });
    this.promptFocused = Object.freeze(bg === undefined ? { fg: theme.accent } : { fg: theme.accent, bg });
    this.promptUnfocused = Object.freeze(bg === undefined ? { fg: theme.secondary } : { fg: theme.secondary, bg });
    this.indicatorStyle = Object.freeze(bg === undefined ? { dim: true } : { dim: true, bg });
    this.preeditStyle = Object.freeze(bg === undefined ? { underline: true } : { underline: true, bg });
  }

  /** 聚焦态切换（事件路由裁决后由组件调用） */
  setFocused(focused: boolean): void {
    this.focused = focused;
  }

  /**
   * 量高：呈现行数 + 上下空行垫（V-0 注③——框线零占位，量高即内容行数；
   * 迟滞带——R3 批 10j：增长即时夹帽、恰降 1 行保持上次防抖、降 2 行才缩；
   * 五件批 A+B——呈现行数最小高 3 钳底〔内容不足 3 铺空行至 3〕、上下空行
   * 垫各 1 共 +2〔帽外叠加——与上方任务状态行/下方面板族的视觉呼吸垫〕；
   * 量高即分配承诺——不超卖）。
   */
  measure(width: number): number {
    this.model.setLayoutWidth(innerWidth(width));
    const count = this.model.visualLines().length;
    this.lastContentRows = count;
    const shown = presentedLineCount(count, this.maxVisibleLines, this.lastShownLines, this.minPresentedLines);
    this.lastShownLines = shown;
    return shown + this.padRows;
  }

  /**
   * 上次量高的帽内内容行数（裸视觉行数夹呈现帽——无垫；fixed-budget 梯
   * 「收缩至内容高」目标位与最小必保段预留共用单源）。sweep23-件1：超帽
   * 部分本就不可呈现（编辑器内部滚动）——裸值会令垫行借「内容行硬地板」
   * 地位永不退让（极小视口长稿形量高钳位不咬合、固定区超屏触发 MainScreen
   * 陈货守卫整段不写），故此处夹帽后供数。
   */
  contentRows(): number {
    return Math.min(this.lastContentRows, this.maxVisibleLines);
  }

  /** 落位渲染：铺底染色块 → 空行垫分档 → 提示符/视口行 → 滚动指示 overlay → 光标声明 */
  render(buffer: CellBuffer, region: Region): void {
    const innerW = innerWidth(region.width);
    this.model.setLayoutWidth(innerW);
    if (region.height <= 0 || innerW <= 0) return; // 内容格都容不下——防御位（w ≤ 2）

    const map = this.model.visualLines();
    const cursorVL = this.model.currentVisualLine(map);
    // 决议内容区高（就地重推不读迟滞账——迟滞归 measure 量高位，render 只需
    // 目标值分档垫）：呈现最小高钳底（实例值——主 composer 3 / 底铬 1）+ 帽
    // 辖上限（与 presentedLineCount 同式）
    const wanted = Math.min(this.maxVisibleLines, Math.max(this.minPresentedLines, map.length));
    // 上下空行垫分档（五件批 A+B——「垫随高度一并让路」）：高足全垫（决议高
    // + 垫行数）；高差 1 单上垫（上侧优先——与上方任务状态行的呼吸位更关键）；
    // 高 ≤ 决议高垫全让、内容区收窄（深截断形内部滚动——牺牲梯收缩至内容高
    // 的渲染侧对偶）。底铬单行档 padRows 0——分档退化恒零垫
    const pads = Math.max(0, Math.min(this.padRows, region.height - wanted));
    const topPad = pads >= 1 ? 1 : 0;
    const bottomPad = pads >= 2 ? 1 : 0;
    const innerH = region.height - topPad - bottomPad; // 内容区视口高
    // 视口夹取自愈：光标恒可视（滚出上方提顶 / 滚出下方沉底）
    this.scrollOffset = clampScroll(this.scrollOffset, cursorVL, innerH, map.length);

    this.drawBand(buffer, region);
    this.drawContent(buffer, region, map, innerH, cursorVL, topPad);
    this.drawIndicators(buffer, region, map.length, innerH, topPad);
    this.drawCursor(buffer, region, map, cursorVL, topPad);
  }

  /* ---------------- 底色染色块（V-0 注③） ---------------- */

  private drawBand(buffer: CellBuffer, region: Region): void {
    if (this.bandStyle === null) return; // 探测缺席/降采形——零背景带诚实回退
    for (let r = 0; r < region.height; r++) {
      for (let c = 0; c < region.width; c++) {
        buffer.setCell(region.row + r, region.col + c, ' ', this.bandStyle);
      }
    }
  }

  /* ---------------- 正文（提示符 + 视口内视觉行） ---------------- */

  private drawContent(
    buffer: CellBuffer,
    region: Region,
    map: ReturnType<EditorModel['visualLines']>,
    innerH: number,
    cursorVL: number,
    topPad: number,
  ): void {
    const lines = this.model.getLines();
    const preedit = this.model.pendingPreedit;
    const cursor = this.model.getCursor(); // 组字三段切片位（prefix/suffix 界）
    const end = Math.min(map.length, this.scrollOffset + innerH);
    for (let vi = this.scrollOffset; vi < end; vi++) {
      const seg = map[vi]!;
      // 行位 = region 顶 + 上垫 + 视口内偏移（五件批 A+B——上垫在场时内容整体下移 1）
      const row = region.row + topPad + (vi - this.scrollOffset);
      // 视口首行缀 › 提示符（两态色）；续行两空格缩进由铺底/透明空格承载。
      // 前缀符 = panel-chrome CURSOR_MARK 单源（V-3 注⑩ ›——与 transcript
      // user 块前缀、picker 光标符同字符，codex composer 形）
      if (vi === this.scrollOffset) {
        buffer.setCell(row, region.col, CURSOR_MARK, this.focused ? this.promptFocused : this.promptUnfocused);
      }
      const line = lines[seg.line] ?? '';
      const plain = line.slice(seg.startCol, seg.startCol + seg.length);
      // 光标在本段且组字中：前缀 + 预编辑（下划线）+ 后缀三段呈现。
      // 段归属单源走 findVisualLineAt 定位律（模型 currentVisualLine——渲染
      // 入口已算就传入）：非行末段的末位（col = 段尾 = 次段首的折点）不收编
      // 本段、恒归次段——组字呈现恰一行。若在此按 col 区间自算（`<=` 闭端）
      // 会与定位律分叉：同折点命中相邻两段，预编辑双呈现两行
      if (preedit !== null && vi === cursorVL) {
        const prefix = line.slice(seg.startCol, cursor.col);
        const suffix = line.slice(cursor.col, seg.startCol + seg.length);
        // 组字三段钳 region 右界：预编辑不计入模型折行宽，三段合成宽（段宽 +
        // 预编辑宽）可超 region 宽——越界部分按右界整字截断（宽字素放不下
        // 整字放弃，与引擎 truncateToWidth 同律；框退役后右界即 region 边，
        // 无右边框列可护）。截断是组字期临时呈现取舍：提交 / 取消后正文并
        // 入 / 还原，按模型折行自愈全量呈现
        const rightEdge = region.col + region.width; // 越界位 = region 末格 + 1
        const next = writeTextClamped(buffer, row, region.col + PREFIX_WIDTH, prefix, rightEdge, this.contentStyle);
        const afterPreedit = writeTextClamped(buffer, row, next, preedit, rightEdge, this.preeditStyle);
        writeTextClamped(buffer, row, afterPreedit, suffix, rightEdge, this.contentStyle);
        continue;
      }
      buffer.writeText(row, region.col + PREFIX_WIDTH, plain, this.contentStyle);
    }
  }

  /* ---------------- 滚动指示 overlay（框退役——写首/末内容行右端） ---------------- */

  private drawIndicators(buffer: CellBuffer, region: Region, totalLines: number, innerH: number, topPad: number): void {
    const above = this.scrollOffset;
    const below = totalLines - this.scrollOffset - innerH;
    // 首/末**内容行**右端（上垫在场时首内容行 = region 顶 + 1——垫行不写指示）
    if (above > 0) this.writeIndicator(buffer, region.row + topPad, region, above, '↑');
    if (below > 0) this.writeIndicator(buffer, region.row + topPad + innerH - 1, region, below, '↓');
  }

  /**
   * 滚动指示写入（R3 批 10j 起，V-0 注③ 去框化）：` ↑ N 更多 ` 全形右对齐
   * overlay 首末内容行；指示文本宽超 region = 窄区回退紧凑 ` ↑N` 右端——
   * 按视口宽度阈值取形不再依框形。词面走 panel-chrome moreHint 单源（界面
   * 美化役美学注②：溢出指示中文单形「N 更多」全域统一——与副屏/overlay
   * 同词汇；首尾空格是 editor 右对齐 overlay 的贴缘让位排版位，非词汇面）；
   * 两形宽度账一律 stringWidth 显示宽重算——「更多」宽 4 ≠ 码位 2。
   */
  private writeIndicator(buffer: CellBuffer, row: number, region: Region, count: number, arrow: '↑' | '↓'): void {
    const full = ` ${moreHint(arrow, count)} `;
    const fullW = stringWidth(full);
    if (fullW <= region.width) {
      buffer.writeText(row, region.col + region.width - fullW, full, this.indicatorStyle);
      return;
    }
    const compact = ` ${arrow}${count}`;
    const compactW = stringWidth(compact);
    // 窄窗守卫：紧凑形也放不下（宽 > region 宽）时右对齐起列将为负——
    // CellGrid 越界写静默吸收前导字符，指示被左移截断贴 region 左缘整行
    // 盖内容行。放不下不写（与全形路 fullW ≤ region.width 同判式对称）：
    // 极窄窗内容面本已残缺，溢出提示诚实缺席优于左移残件
    if (compactW > region.width) return;
    buffer.writeText(row, region.col + region.width - compactW, compact, this.indicatorStyle);
  }

  /* ---------------- 光标声明（聚焦态独占） ---------------- */

  private drawCursor(
    buffer: CellBuffer,
    region: Region,
    map: ReturnType<EditorModel['visualLines']>,
    cursorVL: number,
    topPad: number,
  ): void {
    if (!this.focused) return; // 非聚焦不声明——不抢其他交互件的本帧声明
    const seg = map[cursorVL]!;
    const cursor = this.model.getCursor();
    const line = this.model.getLines()[seg.line] ?? '';
    // 光标段内显示列（前缀宽差——宽字素边界由模型算术保证，落在首列）
    const displayCol = prefixDisplayWidth(line, cursor.col) - prefixDisplayWidth(line, seg.startCol);
    const preedit = this.model.pendingPreedit;
    let col = region.col + PREFIX_WIDTH + displayCol;
    if (preedit !== null) {
      // 组字期光标在预编辑段尾：预编辑宽计入后可越 region 右界（三段呈现右界
      // 截断的算术镜像）——钳到 region 末格，不越网格右界（setCursor 不查界，
      // 越界列由发射层直写终端——视图层守门；框退役后末格即原末内容格 + 1）
      const preeditCols = prefixDisplayWidth(preedit, preedit.length);
      col = Math.min(col + preeditCols, region.col + region.width - 1);
    }
    buffer.setCursor(region.row + topPad + (cursorVL - this.scrollOffset), col);
  }
}

/**
 * 右界钳制写入（组字三段呈现专用）：从 col 起写 text，字素累计越过
 * rightEdge（绝对列，不含）即整字截断——宽字素放不下整字放弃不产半字
 * （与引擎 truncateToWidth 同律）。控制字素不占格亦不计宽（与
 * CellGrid.writeText 跳过律同步——宽度账与落格账一致，返回值可续写）；
 * tab 例外豁免——cell.writeText 新 tab 律（展开两空格格、宽记 2）随迁，
 * 组字三段路与正文路/模型账同律。
 * 返回下一可用列（= 实写末格右邻；全截断时原样返回 col）。
 */
function writeTextClamped(
  buffer: CellBuffer,
  row: number,
  col: number,
  text: string,
  rightEdge: number,
  style?: CellStyle,
): number {
  let take = ''; // 可写前缀（按字素累宽拼接）
  let used = 0; // 可写前缀显示宽
  for (const g of splitGraphemes(text)) {
    const code = g.charCodeAt(0);
    // 控制字素：writeText 同律跳过——宽度账同步不计；tab 豁免（cell.writeText
    // 新 tab 律展开两空格格、宽记 2）——跳过则组字三段路渲染每丢一 tab 2 列，
    // 与正文路直写、模型账（graphemeWidth 记 2）两副面孔
    if ((code < 0x20 && code !== 0x09) || code === 0x7f) continue;
    const w = graphemeWidth(g);
    if (col + used + w > rightEdge) break; // 右界整字截断（宽字素不劈半）
    take += g;
    used += w;
  }
  buffer.writeText(row, col, take, style);
  return col + used;
}

/** 内容区宽（› 前缀 / 续行缩进各占 2 列——折行算术与前缀占列对称） */
function innerWidth(width: number): number {
  return Math.max(0, width - PREFIX_WIDTH);
}

/** 视口夹取：光标滚出上方提顶、滚出下方沉底；内容短于视口归零 */
function clampScroll(offset: number, cursorVL: number, innerH: number, total: number): number {
  let next = offset;
  if (cursorVL < next) next = cursorVL;
  if (cursorVL >= next + innerH) next = cursorVL - innerH + 1;
  const maxOffset = Math.max(0, total - innerH);
  return Math.min(Math.max(0, next), maxOffset);
}
