/**
 * 视觉行映射纯函数（多行输入件 Editor 件族基件）：逻辑行 → 折行后视觉行
 * 的映射单源（垂直光标移动 / 视口滚动 / 渲染三消费方共用）。
 *
 * 本仓化关键差异（07 呈现面件 6「字素光标算术——CJK 双宽对齐」条款）：
 * - 折行按**显示列宽**（字素 graphemeWidth 累计、整字下移不产半字——与引擎
 *   width 件 wrapText 同规则），段记录 UTF-16 下标面（startCol/length 供
 *   字符串切片）+ 显示宽面（width 供视觉列算术）双坐标；
 * - 垂直移动的视觉列 = **显示列**（光标前字素列宽和），非 UTF-16 码元差
 *   （pi 以码元差近似，CJK 双宽下 sticky 列漂移——本仓按规范双宽对齐）。
 */
import { graphemeWidth, splitGraphemes } from '../../engine/index.js';

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
 * 单逻辑行按显示宽硬折（字素累宽超限整字下移——空行占一段零宽）。
 * 返回段的 UTF-16 与显示宽双坐标。
 */
function foldLine(line: string, lineNo: number, width: number): VisualSegment[] {
  if (width <= 0) return [{ line: lineNo, startCol: 0, length: line.length, width: 0 }];
  if (line === '') return [{ line: lineNo, startCol: 0, length: 0, width: 0 }];
  const segments: VisualSegment[] = [];
  let start = 0; // 当前段 UTF-16 起点
  let usedCols = 0; // 当前段已占显示宽
  let segLen = 0; // 当前段 UTF-16 长
  for (const g of splitGraphemes(line)) {
    const w = graphemeWidth(g);
    if (usedCols + w > width) {
      segments.push({ line: lineNo, startCol: start, length: segLen, width: usedCols });
      start += segLen;
      segLen = g.length;
      usedCols = w;
    } else {
      segLen += g.length;
      usedCols += w;
    }
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
