/**
 * token 判据件（07 §4.1 引擎节件 6（组件与呈现装配件） 补全段）：光标 token 提取（引号感知）
 * 与行首 token 区间。
 *
 * 引号感知：token 边界 = 最近的**未引用空白**——从行首正向扫描推进引号
 * 开闭态（引号内空白不断 token——@"my file" 形整段为一个 token）；引号
 * 字符本身属 token（代换区间含引号）。
 * 已知边界：未闭合引号一路吸到引号头（输入中间态本就未闭合，可接受）。
 */

/** 光标 token（行内 UTF-16 区间 + 原文） */
export interface CursorToken {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** 光标前 token 提取（col === 0 或紧邻空白 → null） */
export function tokenAtCursor(line: string, col: number): CursorToken | null {
  if (col <= 0 || col > line.length) return null;
  // 正向扫描（引号态须从行首推进——反向扫遇空白先于遇引号头，无法判定
  // 该空白是否被右侧引号包住）
  let start = 0;
  let quote: string | null = null;
  for (let i = 0; i < col; i++) {
    const ch = line[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null; // 引号闭
      continue; // 引号内字符（含空白）不断 token
    }
    if (ch === '"' || ch === "'") {
      quote = ch; // 引号开
      continue;
    }
    if (ch === ' ' || ch === '\t') start = i + 1; // 未引用空白——token 边界
  }
  const text = line.slice(start, col);
  if (text === '') return null; // 紧邻空白——无 token
  return { start, end: col, text };
}

/** 行首 token 区间（引号感知；空白行 / 空串 → null） */
export function firstTokenRange(line: string): { start: number; end: number } | null {
  if (line === '') return null;
  let start = 0;
  // 跳过行首空白（首 token 起点后移）
  while (start < line.length && (line[start] === ' ' || line[start] === '\t')) start++;
  if (start >= line.length) return null; // 全空白行
  // 扫到未引用空白为终（与 tokenAtCursor 同边界判据）
  let end = start;
  let quote: string | null = null;
  for (let i = start; i < line.length; i++) {
    const ch = line[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      end = i + 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      end = i + 1;
      continue;
    }
    if (ch === ' ' || ch === '\t') break;
    end = i + 1;
  }
  return { start, end };
}
