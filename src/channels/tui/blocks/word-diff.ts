/**
 * 词级 intra-line diff 纯函数（07 §4.1 R4 批 10i——edit 类工具词级差异）。
 *
 * 自研 LCS 变体（零新依赖——R4 条款）：diffWords 对两串做词元 LCS（空白
 * 词元参锚），产出 same/del/add 三类段；edit 工具的 patch 体由
 * parsePatchLines 解析为 meta/ctx/del/add 行（呈现语义的轻解析——apply_patch
 * 文法在 tools 件，本件不越件复用只取显示层判形：'***' 头行 meta、'-' 前
 * 缀删、'+' 前缀增、其余上下文）。
 *
 * 消费位：工具卡渲染（tool-card 件）——1 删 1 增相邻对走词级高亮（删行内
 * 变更词红、增行内变更词绿），孤立删/增整行红/绿。
 */

/** 词级差异段（kind 三态；text 原文串接恒可还原 a/b——相邻同类已弥合） */
export interface DiffSeg {
  readonly kind: 'same' | 'del' | 'add';
  readonly text: string;
}

/** CJK 字素域（统一表意 + 扩 A + 假名——逐字素切词：无空界文种的词级近似） */
const CJK_CHAR = '\\u3400-\\u4dbf\\u4e00-\\u9fff\\u3040-\\u30ff';

/** 词元切分：空白词元（参锚 LCS）| CJK 单字素 | 拉丁字母数字连串（词粒度）；串接还原原文 */
const TOKEN_RE = new RegExp(`\\s+|[${CJK_CHAR}]|[^\\s${CJK_CHAR}]+`, 'g');

/** 词元切分（保留空白词元——空白参锚 LCS，串接还原原文） */
function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? [];
}

/**
 * 两串词级 LCS diff（O(n·m) DP——行内长度量级；空串形：a 空全 add、b 空
 * 全 del）。产出段按序弥合同类相邻（渲染面每行至多三段游程族）。
 */
export function diffWords(a: string, b: string): readonly DiffSeg[] {
  const at = tokenize(a);
  const bt = tokenize(b);
  const n = at.length;
  const m = bt.length;
  // DP 表：(n+1)×(m+1) LCS 长度（行内词元数十量级——整表无虞）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] = at[i] === bt[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  // 回溯产出段：同词 same、a 独有 del、b 独有 add（对角优先——最长公共子序列形）
  const segs: DiffSeg[] = [];
  const push = (kind: DiffSeg['kind'], text: string): void => {
    const last = segs[segs.length - 1];
    if (last !== undefined && last.kind === kind)
      segs[segs.length - 1] = { kind, text: last.text + text }; // 相邻同类弥合
    else segs.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (at[i] === bt[j]) {
      push('same', at[i]!);
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      push('del', at[i]!);
      i++;
    } else {
      push('add', bt[j]!);
      j++;
    }
  }
  while (i < n) push('del', at[i++]!); // a 尾余（b 先尽）
  while (j < m) push('add', bt[j++]!); // b 尾余（a 先尽）
  return segs;
}

/** patch 体行分类（显示层判形——meta = '***' 头尾/文件段行） */
export interface PatchLine {
  readonly kind: 'meta' | 'ctx' | 'del' | 'add';
  readonly text: string;
}

/**
 * apply_patch 体解析为行分类（显示语义——'-'/'+' 前缀剥保留于原文，渲染面
 * 保留前缀字形可辨 patch 形态；'***' 行先行判 meta，防 '+***' 类内容误增）。
 */
export function parsePatchLines(patch: string): readonly PatchLine[] {
  return patch.split('\n').map((line) => {
    if (line.startsWith('***')) return { kind: 'meta', text: line };
    if (line.startsWith('+')) return { kind: 'add', text: line.slice(1) };
    if (line.startsWith('-')) return { kind: 'del', text: line.slice(1) };
    return { kind: 'ctx', text: line };
  });
}
