/**
 * @ 文件段补全源（07 §4.1 补全三合一第三源——mentions 源的实机行走件）。
 *
 * 语义承 berry 蓝本 getFileSuggestions 的 v1 子集：
 * - **目录列举 + fuzzy 子序列过滤**（R6 批 10j——前缀命中置顶、子序列命中
 *   随后）；
 * - **全库异步腿**（07 §4.1 @ 文件全库模糊腿批——挖掘 36 轮，codex
 *   file_search 对标）：裸段查询（非空、无 `/`、非 `~` 起、非引号头）走
 *   RepoFileIndex 全库索引（fd 腿 / 内建行走两形 + per-root TTL 缓存在途
 *   共享）——深查命中全库任意深度文件；其余形态（含 `/` 段、`~` 形、绝对
 *   位、引号态、空 query）维持段导航同步腿（union 协议两形并存——同步快
 *   路零扰动）；
 * - 路径段解析：`src/ap` → 列 `src` 滤 `ap`；尾 `/` = 列该目录；相对段
 *   对 basePath（装配注入 cwd）、`~/` 展开家目录、`/` 起绝对位列举；
 * - `.git` 跳过（版本库内脏）；符号链指目录归类为目录（label 尾 `/`
 *   续深——断链/不可及跳过）；全库腿符号链不入索引（行走不跟随）；
 * - 排序：段导航腿目录优先、再 label 字典序；**全库腿组内序 = 源序**（索引
 *   确定性序——深度浅先、同深字典序；过滤与呈现面不重排）；条目帽防大目
 *   录全量，全库腿超帽披露行（label = 「仅示前 N 条（共 M 命中）」、
 *   replacement = @+query 自反形——enter 应用即零净代换，enter 全量输入穿
 *   透律承载）；
 * - **引号形**（provider 协议条款）：路径含空白或前缀已引号 → replacement
 *   以 `@"…"` 包裹防尾空格击穿（tokenAtCursor 引号感知整 token 的续补位）。
 *
 * 段导航腿件内零缓存（单目录列举毫秒级）；全库腿缓存归 RepoFileIndex
 * （per-root TTL + 在途承诺共享）。补全失败不呈报律：两腿一切失败形态
 * 静默空集退场（不呈报不打断输入）。
 */
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { AutocompleteItem } from './provider.js';
import { fuzzyMatchKind } from './fuzzy.js';
import { sharedRepoFileIndex } from './repo-file-index.js';
import type { RepoFileIndex } from './repo-file-index.js';

/** 条目帽缺省（源侧规模锁——弹层自身另有窗口滚动帽） */
const DEFAULT_MAX_ITEMS = 50;

/** 源构造选项 */
export interface FileMentionSourceOptions {
  /** 相对段的锚定根（装配注入 cwd） */
  readonly basePath: string;
  /** 条目帽（缺省 50） */
  readonly maxItems?: number;
  /** 全库索引器注入（缺省模块级共享实例——per-root 缓存跨源共享；测试注入替代位） */
  readonly repoIndex?: RepoFileIndex;
}

/** 引号前缀解析体 */
interface ParsedPrefix {
  /** 去引号的路径前缀原文 */
  readonly rawPrefix: string;
  /** 前缀已引号（replacement 保引号形） */
  readonly isQuoted: boolean;
}

/** 引号前缀解析（`"my f` / `"my file.txt"` → 内文；`~/` 形原样） */
function parseQuotedPrefix(query: string): ParsedPrefix {
  const head = query[0];
  if (head === '"' || head === "'") {
    let inner = query.slice(1);
    if (inner.endsWith(head)) inner = inner.slice(0, -1); // 已敲闭引号——内文为准
    return { rawPrefix: inner, isQuoted: true };
  }
  return { rawPrefix: query, isQuoted: false };
}

/** @ 文件段补全源：`mentions` 源协议面的实机适配（注入 autocomplete.mentions） */
export class FileMentionSource {
  private readonly basePath: string;
  private readonly maxItems: number;
  private readonly repoIndex: RepoFileIndex;

  constructor(options: FileMentionSourceOptions) {
    this.basePath = options.basePath;
    this.maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
    this.repoIndex = options.repoIndex ?? sharedRepoFileIndex();
  }

  /**
   * 源适配面（query = 去 @ 前缀的 token 内文——可能带引号头）。union 两形：
   * 裸段走全库异步腿（thenable）；段导航形态同步交付（数组非 thenable——
   * 同步快路零扰动）。signal 交付位受理（abort 只拦交付不杀共享行走）。
   */
  readonly get = (
    query: string,
    signal?: AbortSignal,
  ): readonly AutocompleteItem[] | Promise<readonly AutocompleteItem[]> => {
    const { rawPrefix, isQuoted } = parseQuotedPrefix(query);
    // 全库腿分界：裸段（非空、无 /、非 ~ 起、非引号头）——深查全库索引；
    // 其余形态（含 / 段、~ 形、绝对位、引号态、空 query）走段导航同步腿
    if (!isQuoted && rawPrefix !== '' && !rawPrefix.includes('/') && !rawPrefix.startsWith('~')) {
      return this.searchRepoFiles(rawPrefix, signal); // 无引号头即 rawPrefix == query 原文
    }
    return this.listDirectory(rawPrefix, isQuoted);
  };

  /**
   * 全库异步腿：索引序保真过滤（前缀组置顶、子序列组随后的双组律——组内
   * 源序不重排）+ 超帽披露行。一切失败形态静默空集退场（补全失败不呈报律）。
   */
  private async searchRepoFiles(query: string, signal?: AbortSignal): Promise<readonly AutocompleteItem[]> {
    let snapshot;
    try {
      snapshot = await this.repoIndex.snapshot(path.resolve(this.basePath));
    } catch {
      return []; // 索引行走失败——静默空集（不呈报不打断输入）
    }
    if (signal?.aborted) return []; // 交付位受理——共享行走本体不随单请求中断
    const prefixHits: AutocompleteItem[] = [];
    const fuzzyHits: AutocompleteItem[] = [];
    for (const rel of snapshot.files) {
      const hit = fuzzyMatchKind(rel, query);
      if (hit === null) continue;
      // 引号形律同段导航腿：路径含空白以 @"…" 包裹防尾空格击穿
      const replacement = /\s/.test(rel) ? `@"${rel}"` : `@${rel}`;
      (hit === 'prefix' ? prefixHits : fuzzyHits).push({ label: rel, replacement });
    }
    const hits = [...prefixHits, ...fuzzyHits];
    if (hits.length <= this.maxItems) return hits;
    // 超帽披露行：条目池普通行（同池滚动）——计数披露 + 自反形 replacement
    // （enter 应用即零净代换——enter 全量输入穿透律承载全量输入需求）
    return [
      ...hits.slice(0, this.maxItems),
      { label: `仅示前 ${this.maxItems} 条（共 ${hits.length} 命中）`, replacement: `@${query}` },
    ];
  }

  /** 段导航同步腿：dirPart 目录列举 + filePart fuzzy 双组过滤（既有 v1 语义） */
  private listDirectory(rawPrefix: string, isQuoted: boolean): readonly AutocompleteItem[] {
    // '~' 裸形与 '~/' 同为家目录根列举（filePart 空）
    const isHomeRoot = rawPrefix === '~' || rawPrefix === '~/';
    const slash = rawPrefix.lastIndexOf('/');
    const dirPart = isHomeRoot ? '~/' : slash >= 0 ? rawPrefix.slice(0, slash + 1) : '';
    const filePart = isHomeRoot ? '' : slash >= 0 ? rawPrefix.slice(slash + 1) : rawPrefix;
    const searchDir = this.resolveSearchDir(dirPart);
    if (searchDir === null) return []; // 不可解析形态——空集（无匹配弹层：空态直通语义）

    let entries;
    try {
      entries = readdirSync(searchDir, { withFileTypes: true });
    } catch {
      return []; // 缺目录 / 不可及——空集（无匹配弹层：空态直通语义——源在场条目空透传，非静默退场）
    }

    // fuzzy 双组（R6 批 10j——子序列命中 + 前缀命中置顶；各组内目录优先再字典序）
    const prefixHits: AutocompleteItem[] = [];
    const fuzzyHits: AutocompleteItem[] = [];
    for (const entry of entries) {
      if (entry.name === '.git') continue; // 版本库内脏
      const hit = fuzzyMatchKind(entry.name, filePart);
      if (hit === null) continue;
      // 目录归类：符号链补一次 stat（断链/竞态不可及——跳过）
      let isDirectory = entry.isDirectory();
      if (!isDirectory && entry.isSymbolicLink()) {
        try {
          isDirectory = statSync(path.join(searchDir, entry.name)).isDirectory();
        } catch {
          continue;
        }
      }
      // replacement 保用户敲的 dirPart 形（~/ 与绝对形原样续接）
      const pathValue = `${dirPart}${entry.name}${isDirectory ? '/' : ''}`;
      const item: AutocompleteItem = {
        label: `${entry.name}${isDirectory ? '/' : ''}`,
        replacement: `@${isQuoted || /\s/.test(pathValue) ? `"${pathValue}"` : pathValue}`,
      };
      (hit === 'prefix' ? prefixHits : fuzzyHits).push(item);
    }

    sortDirFirst(prefixHits);
    sortDirFirst(fuzzyHits);
    return [...prefixHits, ...fuzzyHits].slice(0, this.maxItems);
  }

  /** 列举目录解析（相对段对 basePath；~/ 家目录；/ 起绝对位） */
  private resolveSearchDir(dirPart: string): string | null {
    if (dirPart === '' || dirPart === './') return path.resolve(this.basePath, dirPart);
    if (dirPart === '~/') return homedir();
    if (dirPart.startsWith('~/')) return path.resolve(homedir(), dirPart.slice(2));
    if (dirPart.startsWith('/')) return path.resolve(dirPart);
    return path.resolve(this.basePath, dirPart);
  }
}

/** 组内排序：目录优先、再 label 字典序（承 berry 排序语义——R6 批 10j 提取双组共用） */
function sortDirFirst(items: AutocompleteItem[]): void {
  items.sort((a, b) => {
    const aDir = a.label.endsWith('/');
    const bDir = b.label.endsWith('/');
    if (aDir !== bDir) return aDir ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
}
