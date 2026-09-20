/**
 * 主屏 inline 形态 ANSI 编舞基件（07 §4.1「屏幕模型双形态」主屏条——批 10e）。
 *
 * 主屏物理形态：DECSTBM 滚动区承载正文（区底写满自动滚——滚出视口整行交
 * 终端原生 scrollback），固定区（输入框 + 状态行）钉屏底区外、绝对位可知。
 * 本件提供四组原语：
 * - 网格行 → ANSI 序列化（cell 样式 + 字素——与 diff 件行写出同语义：续格
 *   跳过、语义空格字面、行尾不填充）；
 * - 网格行 → 带样式行（StyleRun 段族——批 10f-4 件 8 回看器 cell 写出形的
 *   数据源；带样式行 → ANSI 序列化同件在位，主屏直写与回看器零第二渲染器）；
 * - 定位序列（绝对 CUP / 相对 CUU·CUD / CR / EL）与光标保存恢复；
 * - 行级差分（固定区重画——变行重写、未变行零写出，行粒度复用 cellEquals）；
 * - 宽帽原语 clampRuns / capStyledLine（2026-09-20 TUI 修复组 1 批 F4——
 *   序列化单源层屏宽帽：plain 整字截断 + 游程同步钳制，主屏直写产出面
 *   超宽行 autowrap 物理行账漂移的收口位）+ capAnsiLine（TUI 第四役 fx2-A：
 *   已序列化 ANSI 行的显示宽帽——补吐缓冲行宽收口，SGR 零宽透传不丢色）。
 */
// width 三原语（sanitizeDisplayText/truncateToWidth）经 engine 聚合面（index）
// 消费——TUI 第四役残腿收纳（子目录直达形撤除）
import {
  cellEquals,
  colorSgrBg,
  colorSgrFg,
  EMPTY_STYLE,
  graphemeWidth,
  sanitizeDisplayText,
  splitGraphemes,
  styleEquals,
  truncateToWidth,
  type CellGrid,
  type CellStyle,
  type ColorValue,
} from '../../engine/index.js';

/** ESC 前缀 */
const ESC = '\x1b';

/**
 * 样式段（批 10f-4 件 8 回看器——带样式行的呈现词汇）：逻辑行内同样式连续
 * 区间，端点 = plain 文本的 UTF-16 下标（start 含 / end 不含）。段间空隙 =
 * 裸文本（无样式），段升序不交叠由构造方（gridRowToStyled / 各块序列化）保证。
 */
export interface StyleRun {
  readonly start: number;
  readonly end: number;
  readonly style: CellStyle;
}

/**
 * 带样式行：plain 纯文本供折叠宽算术 / 搜索消费（零转义零样式混入）；
 * runs 供 cell 网格呈现消费。主屏 ANSI 直写形（gridRowToAnsi / 简行 dim）
 * 与件 8 回看器 cell 写出形共用同一数据源——零第二渲染器（07 件 8 数据源
 * 条款的结构位）。
 */
export interface StyledLine {
  readonly plain: string;
  readonly runs: readonly StyleRun[];
}

/** 缺省样式判据：styleEquals 对 EMPTY_STYLE 单源（CellStyle 增字段自动同步——
 * 勿手工罗列字段判缺省，10f-4 核验轮勘正） */
function isDefaultStyle(style: CellStyle): boolean {
  return styleEquals(style, EMPTY_STYLE);
}
/** SGR 全复位 */
export const SGR_RESET = `${ESC}[0m`;
/** EL 0：自光标至行尾 */
export const EL_TO_EOL = `${ESC}[K`;
/** 回行首（列 0——不滚行） */
export const CR = '\r';
/** 换行（滚动区内：区底自动滚、区外/中部只下移） */
export const LF = '\n';
/** 清全屏 + 光标归位（repaint 路） */
export const CLEAR_SCREEN = `${ESC}[2J${ESC}[H`;
/** 设滚动区 DECSTBM（1 基行号——底部固定区留区外） */
export function setScrollRegion(bottomRow1Based: number): string {
  return `${ESC}[1;${bottomRow1Based}r`;
}
/** 绝对定位（0 基入参——固定区专用：区外钉屏底、绝对位可知） */
export function cup(row: number, col: number): string {
  return `${ESC}[${row + 1};${col + 1}H`;
}
/** 相对上移 n 行（CUU——滚动区内槽位重画定位；边缘安全不滚） */
export function cuu(n: number): string {
  return n > 0 ? `${ESC}[${n}A` : '';
}
/** 相对下移 n 行（CUD——边缘安全不滚） */
export function cud(n: number): string {
  return n > 0 ? `${ESC}[${n}B` : '';
}

/** 样式 → SGR（与 diff 件 buildSgr 同语义：属性位 + 三档前景背景全量形——色段单源 = engine color 件；简行块直拼消费） */
export function buildSgr(style: {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  fg?: ColorValue;
  bg?: ColorValue;
}): string {
  const params: string[] = [];
  if (style.bold) params.push('1');
  if (style.dim) params.push('2');
  if (style.italic) params.push('3');
  if (style.underline) params.push('4');
  if (style.inverse) params.push('7');
  if (style.fg !== undefined) params.push(colorSgrFg(style.fg));
  if (style.bg !== undefined) params.push(colorSgrBg(style.bg));
  return params.length > 0 ? `${ESC}[${params.join(';')}m` : '';
}

/**
 * 网格行 → ANSI 文本（无内容返回空串——调用方据此跳过写出）。
 * 行尾变空白不产 EL（直写正文行是追加语义、行尾从无旧残留——EL 归擦区编舞）。
 */
export function gridRowToAnsi(grid: CellGrid, row: number): string {
  // 内容末列 = 最右非空格格（续格属首格字素占位、算内容延伸）
  let last = -1;
  for (let col = grid.columns - 1; col >= 0; col--) {
    if (!cellEquals(grid.getCell(row, col), null)) {
      last = col;
      break;
    }
  }
  if (last < 0) return '';
  let out = '';
  // 当前样式序列（'' = 裸文本态；同样式零冗余、变化点复位再设——与 diff 件同纪律）
  let currentSgr = '';
  for (let col = 0; col <= last; col++) {
    const cell = grid.getCell(row, col);
    if (cell !== null && cell.width === 0) continue; // 续格跳过
    if (cell === null) {
      out += ' '; // 语义空格（行中内容洞）字面写
      continue;
    }
    const sgr = buildSgr(cell.style);
    if (sgr !== currentSgr) {
      out += (currentSgr !== '' ? SGR_RESET : '') + sgr;
      currentSgr = sgr;
    }
    out += cell.grapheme;
  }
  if (currentSgr !== '') out += SGR_RESET; // 行尾归零——不染后续写出
  return out;
}

/**
 * 网格行 → 带样式行（批 10f-4 件 8——回看器 cell 写出形的数据源）。
 * 行走序与 gridRowToAnsi 同构（末列内容界 + 续格跳过 + 空洞空格），相邻同样式
 * 格合并为单段；缺省样式段不产段（与空隙同形——序列化零冗余的基础）。
 * 无内容行返回 null（调用方按需补空行——与 gridRowToAnsi 空串约定同构）。
 */
export function gridRowToStyled(grid: CellGrid, row: number): StyledLine | null {
  // 内容末列 = 最右非空格格（续格属首格字素占位、算内容延伸）
  let last = -1;
  for (let col = grid.columns - 1; col >= 0; col--) {
    if (!cellEquals(grid.getCell(row, col), null)) {
      last = col;
      break;
    }
  }
  if (last < 0) return null;
  let plain = '';
  const runs: StyleRun[] = [];
  for (let col = 0; col <= last; col++) {
    const cell = grid.getCell(row, col);
    if (cell !== null && cell.width === 0) continue; // 续格跳过（首格已携整字素）
    const grapheme = cell === null ? ' ' : cell.grapheme; // 语义空格（行中内容洞）
    const style = cell === null ? EMPTY_STYLE : cell.style;
    const start = plain.length;
    plain += grapheme; // 全字素入 plain（缺省样式字素是空隙文本——不丢字）
    if (isDefaultStyle(style)) continue; // 缺省段不产段（gap 即裸文本）
    // 同样式紧邻续段合并（段端点连续才并——中间有缺省格即断开）
    const prev = runs[runs.length - 1];
    if (prev !== undefined && styleEquals(prev.style, style) && prev.end === start) {
      runs[runs.length - 1] = { start: prev.start, end: start + grapheme.length, style };
    } else {
      runs.push({ start, end: start + grapheme.length, style });
    }
  }
  return { plain, runs };
}

/**
 * 带样式行 → ANSI 串（主屏直写形——与 gridRowToAnsi 同语义的行序列化：
 * 样式变化点复位再设、同样式零冗余、行尾归零不染后续写出）。
 * renderBlockLines 经本函数从带样式行导出 ANSI 形——两形零第二渲染器。
 *
 * 消毒兜底（2026-09-20 TUI 修复组 1 批 F2）：发射位逐切片经
 * sanitizeDisplayText（tab 展开 2 空格 / CR 与 ESC 残留序列剥除）——游程
 * 下标仍锚原 plain（消毒只在发射时改字节不改下标面，段几何零漂移）；
 * 构造位（wrapText / layoutParts / 各块序列化）已源头消毒，本位实践上
 * 恒空转，是 inline 面控制字节落屏的末道防线。
 */
export function styledLineToAnsi(line: StyledLine): string {
  const { plain, runs } = line;
  if (runs.length === 0) return sanitizeDisplayText(plain);
  let out = '';
  let currentSgr = '';
  let pos = 0;
  for (const run of runs) {
    if (run.start > pos) {
      // 段前空隙：在身样式先归零再写裸文本（切片发射位消毒）
      if (currentSgr !== '') {
        out += SGR_RESET;
        currentSgr = '';
      }
      out += sanitizeDisplayText(plain.slice(pos, run.start));
    }
    const sgr = buildSgr(run.style);
    if (sgr !== currentSgr) {
      out += (currentSgr !== '' ? SGR_RESET : '') + sgr;
      currentSgr = sgr;
    }
    out += sanitizeDisplayText(plain.slice(run.start, run.end));
    pos = run.end;
  }
  if (pos < plain.length) {
    // 段尾空隙：归零后写裸文本（切片发射位消毒）
    if (currentSgr !== '') {
      out += SGR_RESET;
      currentSgr = '';
    }
    out += sanitizeDisplayText(plain.slice(pos));
  }
  if (currentSgr !== '') out += SGR_RESET;
  return out;
}

/**
 * 超长截断后游程钳制（越界段丢弃、跨界段收尾——limit 即 plain 上限）。
 * 2026-09-20 TUI 修复组 1 批自 tool-card.ts 升格单源导出——宽帽族
 * （capStyledLine / 插件卡体行 / diff 对行）共用一钳。
 */
export function clampRuns(runs: readonly StyleRun[], limit: number): StyleRun[] {
  const out: StyleRun[] = [];
  for (const run of runs) {
    if (run.start >= limit) continue;
    out.push(run.end <= limit ? run : { ...run, end: limit });
  }
  return out;
}

/**
 * 带样式行屏宽帽（F4——序列化单源层宽帽原语）：plain 按显示宽整字截断
 * （truncateToWidth——宽字跨界整字丢弃不产半字）+ runs 同步钳制到截断后
 * UTF-16 长。未超帽原样返回（同引用零分配快路）。产出面（主屏直写 /
 * 回看器 cell 写出）超宽行交终端 autowrap 产未记账物理行的收口位。
 */
export function capStyledLine(line: StyledLine, columns: number): StyledLine {
  const plain = truncateToWidth(line.plain, columns);
  if (plain === line.plain) return line; // 未超帽——同引用快路
  return { plain, runs: clampRuns(line.runs, plain.length) };
}

/**
 * ANSI 行显示宽帽（fx2-A——补吐位宽收口原语）：对**已序列化**（可携合法
 * SGR 配色 / OSC 序列）的整行按显示宽整字截断。
 *
 * 与 capStyledLine（结构化 StyledLine 面）分立——补吐缓冲行（notify 折行
 * 产物 / 摘要行 summaryToAnsi 产物）在 TuiBackend 侧已是 ANSI 串，无 plain
 * 结构可截；盲走 sanitizeDisplayText + truncateToWidth 会把合法配色序列整段
 * 剥掉（无条件丢色——非缩窗复起也中招），故本原语 ANSI 感知：
 * - ESC 序列零宽**整段透传**（CSI/OSC/传统式镜像 engine consumeEscapeSequence
 *   语义——截断永不撕半序列）；
 * - 裸段按字素计显示宽（splitGraphemes + graphemeWidth——ESC 处切段不破
 *   图素界），超帽**整字丢弃**（宽字跨界不产半字，与 truncateToWidth 同律）；
 * - 截断时若终端处于着色态（已透传未复位的 SGR）补 SGR_RESET——行尾归零
 *   不染后续写出；
 * - 全量适装同引用返回（含 SGR 行字节零改动）。
 */
export function capAnsiLine(line: string, columns: number): string {
  if (columns <= 0) return ''; // 帽 0 防御——空串（不产半序列）
  const parts: string[] = [];
  let used = 0; // 已计显示宽（ESC 序列零宽不占）
  let styled = false; // 终端着色态跟踪（未复位的 SGR 已透传）
  let fit = true;
  let i = 0;
  while (i < line.length && fit) {
    if (line.charCodeAt(i) === 0x1b) {
      // ESC 序列整段透传——零宽不占帽；SGR 形同步跟踪着色态
      const end = consumeAnsiSequence(line, i);
      const seq = line.slice(i, end);
      if (isSgrReset(seq)) styled = false;
      else if (isSgrSequence(seq)) styled = true;
      parts.push(seq);
      i = end;
      continue;
    }
    // 连续非 ESC 裸段：ESC 处切段（控制字节自成图素界，段内 splitGraphemes
    // 与整行切分等价），逐字素计宽——超帽整字丢弃
    let j = i;
    while (j < line.length && line.charCodeAt(j) !== 0x1b) j++;
    for (const g of splitGraphemes(line.slice(i, j))) {
      const w = graphemeWidth(g);
      if (used + w > columns) {
        fit = false;
        break;
      }
      parts.push(g);
      used += w;
    }
    i = j;
  }
  if (fit) return line; // 全量适装——同引用快路
  return styled ? parts.join('') + SGR_RESET : parts.join('');
}

/**
 * ESC 序列消费（返回序列末后位——整段透传用）：三形镜像 engine 件
 * consumeEscapeSequence 语义（CSI / OSC / 传统式；截尾 malformed 吞到串尾），
 * engine 未导出且 width 件不归本组，此处本地镜像（语义漂移以 engine 为准）。
 */
function consumeAnsiSequence(text: string, start: number): number {
  let i = start + 1;
  if (i >= text.length) return i;
  const kind = text[i]!;
  if (kind === '[') {
    // CSI：参数码 0x30–0x3F 与中间码 0x20–0x2F 直到 final 0x40–0x7E
    i++;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c >= 0x40 && c <= 0x7e) return i + 1; // final——序列闭合
      if (c >= 0x20 && c <= 0x3f) {
        i++;
        continue;
      }
      return i; // 非 CSI 语法字节——malformed 截断
    }
    return i;
  }
  if (kind === ']') {
    // OSC：吞到 BEL（0x07）或 ST（ESC \）
    i++;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x07) return i + 1;
      if (c === 0x1b && text[i + 1] === '\\') return i + 2; // ST
      i++;
    }
    return i;
  }
  // 传统式：中间码 0x20–0x2F* + final 0x30–0x7E（如 ESC ( B 字符集选择）
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c >= 0x20 && c <= 0x2f) {
      i++;
      continue;
    }
    if (c >= 0x30 && c <= 0x7e) return i + 1; // final
    return i; // 非法形——截断
  }
  return i;
}

/** SGR 形判据（CSI + 参数串 + 'm' final——仅着色序列参与状态跟踪） */
function isSgrSequence(seq: string): boolean {
  return /^\x1b[[0-9;]*m$/.test(seq);
}

/** SGR 全复位判据（显式 0 / 空参数缺省 0——归零即离开色态） */
function isSgrReset(seq: string): boolean {
  return seq === SGR_RESET || seq === '\x1b[m';
}

/**
 * 固定区行级差分（行粒度——变行整行重写、未变行零写出）。
 * 返回 ANSI 串（含定位与行尾 EL——擦除只走 EL 禁空格填充）；行位以
 * baseRow 屏偏移绝对定位（固定区钉屏底、区外位可知）。
 */
export function renderFixedRegionDiff(from: CellGrid | null, to: CellGrid, baseRow: number): string {
  let out = '';
  for (let row = 0; row < to.rows; row++) {
    if (from !== null && row < from.rows && gridRowEquals(from, to, row)) continue; // 未变行零写出
    const text = gridRowToAnsi(to, row);
    // 定位行首 → 复位 →（有内容写内容）→ 无条件 EL（行尾残留擦除——与 diff 件同律）
    out += cup(baseRow + row, 0) + SGR_RESET + (text !== '' ? text + SGR_RESET : '') + EL_TO_EOL;
  }
  return out;
}

/** 行相等判定（逐格 cellEquals 直比） */
function gridRowEquals(a: CellGrid, b: CellGrid, row: number): boolean {
  for (let col = 0; col < b.columns; col++) {
    if (!cellEquals(a.getCell(row, col), b.getCell(row, col))) return false;
  }
  return true;
}
