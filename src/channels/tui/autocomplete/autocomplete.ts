/**
 * 三源合一补全器（07 §4.1 引擎节件 6（组件与呈现装配件））：token 判据单源 + 前缀路由。
 *
 * 路由序（@ 优先 → 命令名 → 参数段）：
 * - @ 前缀 token → mention 源（任意位置——命令参数段内也可 mention 文件）；
 * - 首逻辑行行首 / 前缀 token（光标在首 token 内）→ 命令名源；
 * - 首行 /xxx 命令名已终结后的 token → 命令参数源（带命令名上下文）；
 * - 其余 null（普通对话文本不补——弹层不显）。
 *
 * 源注入面（缺省无源——装配按需接）：命令名源注入查询函数（装配接
 * CommandRegistry.list()）、命令参数源注入条目（不发明注册面——03 §2.2
 * registerCommand 签名三参数无 schema）、@ 文件段源实机行走归装配批。
 */
import { isThenable } from './async.js';
import type { AutocompleteContext, AutocompleteItems, AutocompleteOutcome } from './provider.js';
import { firstTokenRange, tokenAtCursor } from './token.js';

/**
 * 三源注入面（R6 批 10j——异步形协议：源可返同步数组〔快路〕或 Promise；
 * signal 取消在途。缺省无源——装配按需接）。
 */
export interface AutocompleteSources {
  /** 命令名源（query = 去斜杠前缀） */
  readonly commands?: (query: string, signal: AbortSignal) => AutocompleteItems;
  /**
   * 命令参数源（command = 已终结命令名去斜杠；query = 当前参数 token 原文；
   * priorArgs = 命令名与光标 token 之间的已定参数序——深位枚举补全判据，
   * R6 批 10j 装配接线随子动词补全引入）
   */
  readonly commandArguments?: (
    command: string,
    query: string,
    priorArgs: readonly string[],
    signal: AbortSignal,
  ) => AutocompleteItems;
  /** @-mention 源（query = 去 @ 前缀；文件段实机行走归装配批） */
  readonly mentions?: (query: string, signal: AbortSignal) => AutocompleteItems;
}

/** 三源合一补全器 */
export class CombinedAutocompleteProvider {
  private readonly sources: AutocompleteSources;

  constructor(sources: AutocompleteSources = {}) {
    this.sources = sources;
  }

  /**
   * 取补全（无 token / 无对应源 / 源空 → null——弹层不显）。R6 批 10j：
   * union 形——同步源同步交付（快路）、异步源经 then 微task 交付，
   * signal 线传源侧取消在途。
   */
  getCompletions(context: AutocompleteContext, signal?: AbortSignal): AutocompleteOutcome {
    const effectiveSignal = signal ?? new AbortController().signal;
    const line = context.lines[context.cursorLine] ?? '';
    const token = tokenAtCursor(line, context.cursorCol);
    if (token === null || token.text === '') return null; // 无 token 段——不补

    // 路由一：@ 前缀（任意位置——命令参数段内也可 mention 文件）
    if (token.text.startsWith('@')) {
      return this.collect(this.sources.mentions?.(token.text.slice(1), effectiveSignal), token.start, token.end);
    }

    // 命令段判据只在首逻辑行（多行输入的斜杠命令 = 首行起手式）
    if (context.cursorLine !== 0) return null;
    const first = firstTokenRange(line);
    if (first === null) return null; // 行首无 token（光标 token 不在行首矛盾——防御位）
    if (token.start === first.start) {
      // 路由二：光标就在首 token 内且 / 前缀——命令名段
      if (!token.text.startsWith('/')) return null; // 首 token 非命令——普通文本不补
      return this.collect(this.sources.commands?.(token.text.slice(1), effectiveSignal), token.start, token.end);
    }
    // 路由三：首 token 是已终结命令（/xxx）——光标 token 属参数段
    const firstText = line.slice(first.start, first.end);
    if (!firstText.startsWith('/')) return null; // 行首非命令——后续 token 也不补
    // 已定参数序（命令名尾与光标 token 首之间的 whitespace 劈段——深位判据）
    const priorArgs = line
      .slice(first.end, token.start)
      .split(/\s+/)
      .filter((part) => part !== '');
    return this.collect(
      this.sources.commandArguments?.(firstText.slice(1), token.text, priorArgs, effectiveSignal),
      token.start,
      token.end,
    );
  }

  /** 源结果收口（union 形透传——异步源 then 收口；空源 / 空条目统一 null） */
  private collect(items: AutocompleteItems | undefined, replaceStart: number, replaceEnd: number): AutocompleteOutcome {
    if (items === undefined) return null;
    if (isThenable(items)) {
      return items.then((list) => (list.length === 0 ? null : { items: list, replaceStart, replaceEnd }));
    }
    if (items.length === 0) return null;
    return { items, replaceStart, replaceEnd };
  }
}
