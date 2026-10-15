/**
 * 字素硬折行单源件（挖掘 49 轮件 A 抽取共享——原 tool-card.ts 私有件迁入）。
 *
 * 内容列硬折行（字素推进硬切）：产出源串 UTF-16 区间随段携带（供游程/段族
 * 交集映射）；与 engine wrapText 分立——wrapText 折点吞空格、续行跳行首
 * 空格（自然文折行语义），本件保真优先（内容对齐是代码 diff 的语义）。
 * 两消费面：tool-card diff 档 diffRowStyledLines（卡内 patch 体）/
 * diff-viewer 超宽行续行（49 轮件 A——/diff 副屏硬折行）。
 */
import { graphemeWidth, splitGraphemes } from '../../engine/index.js';
import type { StyleRun } from '../backend/ansi-rows.js';

/** 硬折行段（text = 段文本；start/end = 源串 UTF-16 闭开区间） */
export interface WrapSegment {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/**
 * 内容列硬折行（字素推进硬切）：产出源串 UTF-16 区间随段携带（供游程交集
 * 映射）；空内容单空段（首行仍出——bg 带形）。**avail ≤ 0 未守卫**——调用
 * 位自守（tool-card 位 Math.max(1,·) 既有；diff-viewer 位 49 轮件 A 极窄窗
 * 守卫「预算 ≤0 视觉行恒 1」——avail≤0 时逐字素成段致行数虚胀）。
 */
export function wrapByGraphemes(text: string, avail: number): WrapSegment[] {
  if (text === '') return [{ text: '', start: 0, end: 0 }];
  const segments: WrapSegment[] = [];
  let current = '';
  let start = 0;
  let width = 0;
  for (const grapheme of splitGraphemes(text)) {
    const w = graphemeWidth(grapheme);
    // 硬切：累计宽超内容列即断段（当前段非空——单字素超列直接入段由整行帽兜底）
    if (current !== '' && width + w > avail) {
      segments.push({ text: current, start, end: start + current.length });
      start += current.length;
      current = '';
      width = 0;
    }
    current += grapheme;
    width += w;
  }
  if (current !== '') segments.push({ text: current, start, end: start + current.length });
  return segments;
}

/** 内容游程 → 折行段源区间交集平移（游程跨折行边界保留——各段各持交集片） */
export function mapRunsOntoSegment(
  runs: readonly StyleRun[],
  segStart: number,
  segEnd: number,
  offset: number,
): StyleRun[] {
  const out: StyleRun[] = [];
  for (const run of runs) {
    const start = Math.max(run.start, segStart);
    const end = Math.min(run.end, segEnd);
    if (start < end) out.push({ start: start - segStart + offset, end: end - segStart + offset, style: run.style });
  }
  return out;
}
