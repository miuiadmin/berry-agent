/**
 * fuzzy 子序列过滤（07 §4.1 R6 批 10j——命令名与 @ 文件段两源的过滤升级）。
 *
 * 判据 = **子序列匹配**（大小写不敏感）：query 各字符按序出现于候选串即
 * 命中（`plg` → `plugins`）。排序律 = **前缀命中排 fuzzy 命中前**——前缀
 * 意图最强置顶，各组内保持源序（命令表序 / 文件列举序，不重排消费方既有
 * 语义）。纯函数零依赖——两源装配位共用单源。
 */

/**
 * 子序列判定（大小写不敏感）：needle 各字符按序在 candidate 中出现。
 * 空 needle 恒真（全量——消费方按前缀组整收）。布尔面 = 游程面
 * subsequenceMatchRanges 的退化（单源委托——两函数同判据同实现）。
 */
export function isSubsequence(candidate: string, needle: string): boolean {
  if (needle === '') return true; // 空查询恒真（全量——过滤语义）；游程面空 needle 返 null（呈现语义——无位可亮，两义分立）
  return subsequenceMatchRanges(candidate, needle) !== null;
}

/**
 * 子序列命中游程（挖掘 29 轮批 C 件 a——弹层命中字符 bold 供数）：greedy
 * 左射位序、大小写不敏感，返回 needle 各字符在 candidate 的命中 UTF-16
 * 位序数组（非邻接位——per-char bold 的真面目）；不中或空 needle → null
 * （空查询无命中位可亮——呈现面诚实零 bold 档）。
 */
export function subsequenceMatchRanges(candidate: string, needle: string): readonly number[] | null {
  if (needle === '') return null;
  const hay = candidate.toLowerCase();
  const seek = needle.toLowerCase();
  const positions: number[] = [];
  let from = 0;
  for (const ch of seek) {
    const idx = hay.indexOf(ch, from);
    if (idx === -1) return null;
    positions.push(idx);
    from = idx + ch.length; // 命中位按码点整长推进（代理对 needle 不劈半）
  }
  return positions;
}

/** 命中档位：前缀（意图最强）/ 子序列 / 不中（null） */
export type FuzzyHit = 'prefix' | 'subseq';

/** 单候选命中档位（前缀 = 大小写不敏感 startsWith） */
export function fuzzyMatchKind(candidate: string, query: string): FuzzyHit | null {
  if (query === '') return 'prefix'; // 空查询全量——前缀组
  const lowerCandidate = candidate.toLowerCase();
  const lowerQuery = query.toLowerCase();
  if (lowerCandidate.startsWith(lowerQuery)) return 'prefix';
  return isSubsequence(candidate, query) ? 'subseq' : null;
}

/**
 * 双组过滤：前缀命中组在前、子序列命中组在后，各组内保持源序
 * （07 §4.1 R6——「前缀命中排 fuzzy 命中前」排序律的载体）。
 */
export function fuzzyFilter<T>(items: readonly T[], keyOf: (item: T) => string, query: string): T[] {
  const prefixGroup: T[] = [];
  const subseqGroup: T[] = [];
  for (const item of items) {
    const kind = fuzzyMatchKind(keyOf(item), query);
    if (kind === 'prefix') prefixGroup.push(item);
    else if (kind === 'subseq') subseqGroup.push(item);
  }
  return [...prefixGroup, ...subseqGroup];
}
