/**
 * 粘贴标记化（07 §4.1 R3 批 10j——大粘贴不撑爆编辑器布局与高度帽）。
 *
 * 超阈粘贴（> PASTE_MARKER_THRESHOLD 行）不整段入框，改插粘贴标记**原子
 * 字素段**：`[paste #N +L lines]` 单行标记——光标 / 删除按整段算术（标记行
 * 上的删除 = 删整行 + 注销登记；字素级左右移把标记行视作单字素）、undo 单
 * 步整段、**提交时展开回正文**（编辑器内只呈现标记行）。阈内小粘贴维持
 * 整段入框。
 *
 * 原子性判据 = 行文本 parse 命中 **且** 模型登记表命中该 id——用户手敲出
 * 同形文本不获原子性（不误伤普通文本行）。标记行显示宽 ~20 列，常规终端
 * 宽下自然不折（窄终端极端折行仅呈现层劈开，状态完好）。
 */

/** 标记化阈值（07 §4.1 R3——量级 ~20 行定值：超此行数的粘贴走标记） */
export const PASTE_MARKER_THRESHOLD = 20;

/** 标记文本形：`[paste #N +L lines]`（N = 登记序号、L = 原文行数） */
export function pasteMarkerText(id: number, lineCount: number): string {
  return `[paste #${id} +${lineCount} lines]`;
}

/** 标记行解析体 */
export interface ParsedPasteMarker {
  readonly id: number;
  readonly lineCount: number;
}

/** 行文本 → 标记解析（严格形对拍——非标记形 null） */
export function parsePasteMarker(line: string): ParsedPasteMarker | null {
  const match = /^\[paste #(\d+) \+(\d+) lines\]$/.exec(line);
  if (match === null) return null;
  return { id: Number(match[1]), lineCount: Number(match[2]) };
}

/** 阈判定（超阈走标记化——行数 > 阈值） */
export function shouldMarkerize(text: string): boolean {
  return text.split('\n').length > PASTE_MARKER_THRESHOLD;
}

/** 登记表下一序号（max + 1——从状态推导无独立计数器，undo 快照恢复不重号错乱） */
export function nextMarkerId(markers: ReadonlyMap<number, string>): number {
  let max = 0;
  for (const id of markers.keys()) if (id > max) max = id;
  return max + 1;
}
