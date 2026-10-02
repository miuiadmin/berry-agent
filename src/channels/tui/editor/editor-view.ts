/**
 * 多行输入件视图（Editor 件族渲染件）：composer 形 + 视口滚动 + 光标声明。
 *
 * 渲染职责（07 §4.1 引擎节件 6；V-0 注③ 全宽框退役——codex 对齐）：
 * - `› ` 提示符 2 列 + 续行两空格缩进（与 transcript user 块同语言同字符），
 *   框线零占位；聚焦 › accent / 非聚焦 secondary（焦点指示新载体——两态
 *   色值承旧过渡，V-3 落码批定值）；
 * - 底色染色块（userMessageBg）：探测背景在场时整 region 铺底再覆写前缀/
 *   正文；缺席零背景带诚实回退——› 前缀独挑边界；
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
import { presentedLineCount } from './height-cap.js';
import { DEFAULT_THEME, type ResolvedTheme } from '../theme/index.js';
import type { CellStyle } from '../../engine/index.js';

/** 输入提示符（与 transcript user 块前缀同字符——codex composer 形） */
const PROMPT_MARK = '›';
/** 提示符前缀占列宽（`› `——首行前缀与续行缩进同宽 2，折行算术对称） */
const PREFIX_WIDTH = 2;

/** 最大可视行数缺省（装配层按终端高 30% 注入覆盖——pi 同形 max(5, rows*0.3)） */
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
  private indicatorStyle: Readonly<CellStyle> = Object.freeze({ dim: true });
  /** 预编辑段样式（下划线——组字挂起提示；底色在场时携 bg 合成） */
  private preeditStyle: Readonly<CellStyle> = Object.freeze({ underline: true });

  constructor(
    private readonly model: EditorModel,
    options: { maxVisibleLines?: number } = {},
  ) {
    this.maxVisibleLines = Math.max(1, options.maxVisibleLines ?? DEFAULT_MAX_VISIBLE_LINES);
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
   * 量高：呈现行数（V-0 注③——框线零占位，量高即内容行数；迟滞带——
   * R3 批 10j：增长即时夹帽、恰降 1 行保持上次防抖、降 2 行才缩；量高即
   * 分配承诺——不超卖）。
   */
  measure(width: number): number {
    this.model.setLayoutWidth(innerWidth(width));
    const count = this.model.visualLines().length;
    const shown = presentedLineCount(count, this.maxVisibleLines, this.lastShownLines);
    this.lastShownLines = shown;
    return shown;
  }

  /** 落位渲染：铺底染色块 → 提示符/视口行 → 滚动指示 overlay → 光标声明 */
  render(buffer: CellBuffer, region: Region): void {
    const innerW = innerWidth(region.width);
    const innerH = region.height;
    this.model.setLayoutWidth(innerW);
    if (innerH <= 0 || innerW <= 0) return; // 内容格都容不下——防御位（w ≤ 2）

    const map = this.model.visualLines();
    const cursorVL = this.model.currentVisualLine(map);
    // 视口夹取自愈：光标恒可视（滚出上方提顶 / 滚出下方沉底）
    this.scrollOffset = clampScroll(this.scrollOffset, cursorVL, innerH, map.length);

    this.drawBand(buffer, region);
    this.drawContent(buffer, region, map, innerH, cursorVL);
    this.drawIndicators(buffer, region, map.length);
    this.drawCursor(buffer, region, map, cursorVL);
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
  ): void {
    const lines = this.model.getLines();
    const preedit = this.model.pendingPreedit;
    const cursor = this.model.getCursor(); // 组字三段切片位（prefix/suffix 界）
    const end = Math.min(map.length, this.scrollOffset + innerH);
    for (let vi = this.scrollOffset; vi < end; vi++) {
      const seg = map[vi]!;
      const row = region.row + (vi - this.scrollOffset);
      // 视口首行缀 › 提示符（两态色）；续行两空格缩进由铺底/透明空格承载
      if (vi === this.scrollOffset) {
        buffer.setCell(row, region.col, PROMPT_MARK, this.focused ? this.promptFocused : this.promptUnfocused);
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

  private drawIndicators(buffer: CellBuffer, region: Region, totalLines: number): void {
    const above = this.scrollOffset;
    const below = totalLines - this.scrollOffset - region.height;
    if (above > 0) this.writeIndicator(buffer, region.row, region, above, '↑');
    if (below > 0) this.writeIndicator(buffer, region.row + region.height - 1, region, below, '↓');
  }

  /**
   * 滚动指示写入（R3 批 10j 起，V-0 注③ 去框化）：` ↑ N 更多 ` 全形右对齐
   * overlay 首末内容行；指示文本宽超 region = 窄区回退紧凑 ` ↑N` 右端——
   * 按视口宽度阈值取形不再依框形。界面美化役美学批注②：溢出指示中文单形
   * 「N 更多」全域统一；两形宽度账一律 stringWidth 显示宽重算——「更多」
   * 宽 4 ≠ 码位 2。
   */
  private writeIndicator(buffer: CellBuffer, row: number, region: Region, count: number, arrow: '↑' | '↓'): void {
    const full = ` ${arrow} ${count} 更多 `;
    const fullW = stringWidth(full);
    if (fullW <= region.width) {
      buffer.writeText(row, region.col + region.width - fullW, full, this.indicatorStyle);
      return;
    }
    const compact = ` ${arrow}${count}`;
    buffer.writeText(row, region.col + region.width - stringWidth(compact), compact, this.indicatorStyle);
  }

  /* ---------------- 光标声明（聚焦态独占） ---------------- */

  private drawCursor(
    buffer: CellBuffer,
    region: Region,
    map: ReturnType<EditorModel['visualLines']>,
    cursorVL: number,
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
    buffer.setCursor(region.row + (cursorVL - this.scrollOffset), col);
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
