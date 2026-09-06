/**
 * @ 文件段补全源（07 §4.1 补全三合一第三源——mentions 源的实机行走件）。
 *
 * 语义承 berry 蓝本 getFileSuggestions 的 v1 子集：
 * - **目录列举 + 前缀过滤**（非模糊行走——fuzzy 全库发现随 fd 批挂账，
 *   `BERRY_AGENT_FD_PATH` 环境变量是其消费点、本批不触）；
 * - 路径段解析：`src/ap` → 列 `src` 滤 `ap`；尾 `/` = 列该目录；相对段
 *   对 basePath（装配注入 cwd）、`~/` 展开家目录、`/` 起绝对位列举；
 * - `.git` 跳过（版本库内脏）；符号链指目录归类为目录（label 尾 `/`
 *   续深——断链/不可及跳过）；
 * - 排序：目录优先、再 label 字典序；条目帽防大目录全量；
 * - **引号形**（provider 协议条款）：路径含空白或前缀已引号 → replacement
 *   以 `@"…"` 包裹防尾空格击穿（tokenAtCursor 引号感知整 token 的续补位）。
 *
 * 件内零缓存（同一目录反复列举随实机批定 cache 策略）；同步 IO——
 * mentions 源协议面是同步（单目录列举毫秒级，弹层窗口 10 行消费帽内）。
 */
import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { AutocompleteItem } from './provider.js';

/** 条目帽缺省（源侧规模锁——弹层自身另有窗口滚动帽） */
const DEFAULT_MAX_ITEMS = 50;

/** 源构造选项 */
export interface FileMentionSourceOptions {
  /** 相对段的锚定根（装配注入 cwd） */
  readonly basePath: string;
  /** 条目帽（缺省 50） */
  readonly maxItems?: number;
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

  constructor(options: FileMentionSourceOptions) {
    this.basePath = options.basePath;
    this.maxItems = options.maxItems ?? DEFAULT_MAX_ITEMS;
  }

  /** 源适配面（query = 去 @ 前缀的 token 内文——可能带引号头） */
  readonly get = (query: string): readonly AutocompleteItem[] => {
    const { rawPrefix, isQuoted } = parseQuotedPrefix(query);
    // '~' 裸形与 '~/' 同为家目录根列举（filePart 空）
    const isHomeRoot = rawPrefix === '~' || rawPrefix === '~/';
    const slash = rawPrefix.lastIndexOf('/');
    const dirPart = isHomeRoot ? '~/' : slash >= 0 ? rawPrefix.slice(0, slash + 1) : '';
    const filePart = isHomeRoot ? '' : slash >= 0 ? rawPrefix.slice(slash + 1) : rawPrefix;
    const searchDir = this.resolveSearchDir(dirPart);
    if (searchDir === null) return []; // 不可解析形态

    let entries;
    try {
      entries = readdirSync(searchDir, { withFileTypes: true });
    } catch {
      return []; // 缺目录 / 不可及——空集（补全静默退场）
    }

    const lowerPrefix = filePart.toLowerCase();
    const items: AutocompleteItem[] = [];
    for (const entry of entries) {
      if (entry.name === '.git') continue; // 版本库内脏
      if (!entry.name.toLowerCase().startsWith(lowerPrefix)) continue;
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
      items.push({
        label: `${entry.name}${isDirectory ? '/' : ''}`,
        replacement: `@${isQuoted || /\s/.test(pathValue) ? `"${pathValue}"` : pathValue}`,
      });
    }

    // 目录优先、再 label 字典序（承 berry 排序语义）
    items.sort((a, b) => {
      const aDir = a.label.endsWith('/');
      const bDir = b.label.endsWith('/');
      if (aDir !== bDir) return aDir ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return items.slice(0, this.maxItems);
  };

  /** 列举目录解析（相对段对 basePath；~/ 家目录；/ 起绝对位） */
  private resolveSearchDir(dirPart: string): string | null {
    if (dirPart === '' || dirPart === './') return path.resolve(this.basePath, dirPart);
    if (dirPart === '~/') return homedir();
    if (dirPart.startsWith('~/')) return path.resolve(homedir(), dirPart.slice(2));
    if (dirPart.startsWith('/')) return path.resolve(dirPart);
    return path.resolve(this.basePath, dirPart);
  }
}
