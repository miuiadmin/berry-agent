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
 * 空 needle 恒真（全量——消费方按前缀组整收）。
 */
export function isSubsequence(candidate: string, needle: string): boolean {
  if (needle === '') return true;
  const hay = candidate.toLowerCase();
  const seek = needle.toLowerCase();
  let from = 0;
  for (const ch of seek) {
    const idx = hay.indexOf(ch, from);
    if (idx === -1) return false;
    from = idx + 1;
  }
  return true;
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
