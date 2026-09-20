/**
 * 视觉行映射纯函数（多行输入件 Editor 件族基件）：逻辑行 → 折行后视觉行
 * 的映射单源（垂直光标移动 / 视口滚动 / 渲染三消费方共用）。
 *
 * 本仓化关键差异（07 引擎节件 6（组件与呈现装配件）「字素光标算术——CJK 双宽对齐」条款）：
 * - 折行按**显示列宽**（字素 graphemeWidth 累计、整字下移不产半字——与引擎
 *   width 件 wrapText 同规则），段记录 UTF-16 下标面（startCol/length 供
 *   字符串切片）+ 显示宽面（width 供视觉列算术）双坐标；
 * - 垂直移动的视觉列 = **显示列**（光标前字素列宽和），非 UTF-16 码元差
 *   （pi 以码元差近似，CJK 双宽下 sticky 列漂移——本仓按规范双宽对齐）。
 *
 * 2026-09-20 TUI 修复组 1 批：CJK 折行禁则（kinsoku）与 wrapText 三引擎同律
 * （判据单源消费 width 件 isLineStartProhibited / isLineEndProhibited）——
 * 段映射 startCol/length 与禁则折点同规则单源（回送字素计入下段段头，
 * 分区恒等性保持——切片拼回原行，光标算术无损）；编辑器 1:1 分区语义
 * 不做折点空格跳过（用户输入的空格是内容不是排版）。
 */
// 禁则谓词未入 engine 聚合面（index 聚合面改动非本组文件集）——同模块
// 子目录直达 width 件（lint:topology 件内子目录跳变放行，例注在案）
import { graphemeWidth, isLineEndProhibited, isLineStartProhibited, splitGraphemes } from '../../engine/width.js';

/** 视觉行段（一段 = 一条折行后的可视行） */
export interface VisualSegment {
  /** 逻辑行下标 */
  readonly line: number;
  /** 段起点在逻辑行内的 UTF-16 下标 */
  readonly startCol: number;
  /** 段长（UTF-16 码元数） */
  readonly length: number;
  /** 段显示宽（列数） */
  readonly width: number;
}

/**
 * 单逻辑行按显示宽硬折（字素累宽超限整字下移——空行占一段零宽；
 * CJK 禁则回送与 wrapText 同律——闭合标点不可起行/开括号不可收行，
 * 当段末字素携下移计入下段段头，段映射随折点同规则）。
 * 返回段的 UTF-16 与显示宽双坐标。
 */
function foldLine(line: string, lineNo: number, width: number): VisualSegment[] {
  if (width <= 0) return [{ line: lineNo, startCol: 0, length: line.length, width: 0 }];
  if (line === '') return [{ line: lineNo, startCol: 0, length: 0, width: 0 }];
  const segments: VisualSegment[] = [];
  let start = 0; // 当前段 UTF-16 起点
  const seg: string[] = []; // 当前段字素累积（数组形——禁则回送要从未尾弹出）
  let usedCols = 0; // 当前段已占显示宽
  let segLen = 0; // 当前段 UTF-16 长
  for (const g of splitGraphemes(line)) {
    const w = graphemeWidth(g);
    if (usedCols + w > width) {
      // CJK 禁则回送（与 wrapText 三引擎同律）：行首禁则（折点后字素不可
      // 起行）与行尾禁则（当段末字素不可收行）同一操作——当段末字素弹出携
      // 下移；回送后新段 [carry…+g] 越帽即放弃硬断（不无限回送，原折点保持）
      const carry: string[] = [];
      let carryW = 0;
      while (seg.length > 0) {
        const nextFirst = carry.length > 0 ? carry[0]! : g; // 新段行首候选
        const currentLast = seg[seg.length - 1]!; // 当段行末候选
        if (!isLineStartProhibited(nextFirst) && !isLineEndProhibited(currentLast)) break;
        const headW = graphemeWidth(currentLast);
        if (carryW + headW + w > width) break; // 回送无解——放弃硬断
        seg.pop();
        usedCols -= headW;
        segLen -= currentLast.length;
        carry.unshift(currentLast);
        carryW += headW;
      }
      segments.push({ line: lineNo, startCol: start, length: segLen, width: usedCols });
      start += segLen;
      seg.length = 0; // 段收笔——累积账清零（回送字素随后回填）
      segLen = 0;
      usedCols = 0;
      // 回送字素回填新段头（UTF-16 与显示宽双账同步——分区恒等性保持）
      for (const c of carry) {
        seg.push(c);
        segLen += c.length;
        usedCols += graphemeWidth(c);
      }
    }
    seg.push(g);
    segLen += g.length;
    usedCols += w;
  }
  segments.push({ line: lineNo, startCol: start, length: segLen, width: usedCols });
  return segments;
}

/** 全文档视觉行映射（逻辑行逐行硬折串接） */
export function buildVisualLineMap(lines: string[], width: number): VisualSegment[] {
  const out: VisualSegment[] = [];
  for (let i = 0; i < lines.length; i++) out.push(...foldLine(lines[i] ?? '', i, width));
  return out;
}

/**
 * 定位逻辑位置所在视觉行下标（col 为 UTF-16）。
 * 逻辑行末段的末位（col = 行长）属末段——光标在行尾不落「下一段开头」。
 */
export function findVisualLineAt(map: VisualSegment[], line: number, col: number): number {
  for (let i = 0; i < map.length; i++) {
    const vl = map[i]!;
    if (vl.line !== line) continue;
    const offset = col - vl.startCol;
    const isLastOfLine = i === map.length - 1 || map[i + 1]!.line !== vl.line;
    if (offset >= 0 && (offset < vl.length || (isLastOfLine && offset === vl.length))) return i;
  }
  return map.length - 1;
}

/**
 * 段内显示列反查 UTF-16 下标：从段起点起累计字素宽，到目标显示列 targetCols
 * 的字素边界（**光标永不落半字**——目标列落在宽字素中间时吸到其首列前，
 * 返回该字素起点的 UTF-16 下标）。targetCols 超段宽返回段尾下标。
 */
export function colAtDisplayColumn(line: string, startCol: number, targetCols: number): number {
  let used = 0;
  let idx = startCol;
  for (const g of splitGraphemes(line.slice(startCol))) {
    const w = graphemeWidth(g);
    if (used + w > targetCols) return idx; // 目标列落在本字素内——吸到首列前（半字防线）
    used += w;
    idx += g.length;
  }
  return idx;
}

/**
 * 位置前缀显示宽：line 内 [0, col) 前缀的字素列宽和（光标视觉列算术的
 * 单源——渲染光标定位 / sticky 列共用）。
 */
export function prefixDisplayWidth(line: string, col: number): number {
  let used = 0;
  let idx = 0;
  for (const g of splitGraphemes(line)) {
    if (idx >= col) break;
    used += graphemeWidth(g);
    idx += g.length;
  }
  return used;
}

/**
 * 光标前一个字素的边界（UTF-16）：backspace / moveLeft 的字素算术。
 * col 已在行首返回 0。
 */
export function prevGraphemeBoundary(line: string, col: number): number {
  if (col <= 0) return 0;
  let idx = 0;
  let prev = 0;
  for (const g of splitGraphemes(line)) {
    if (idx >= col) return prev;
    prev = idx;
    idx += g.length;
  }
  return prev;
}

/**
 * 光标后一个字素的终点（UTF-16）：deleteForward / moveRight 的字素算术。
 * col 已在行尾返回 line.length。
 */
export function nextGraphemeBoundary(line: string, col: number): number {
  let idx = 0;
  for (const g of splitGraphemes(line)) {
    if (idx >= col) return idx + g.length;
    idx += g.length;
  }
  return line.length;
}
