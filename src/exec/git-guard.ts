/**
 * exec 件 git-guard——bash 侧 .git 拦截面（04 §252 桥条款两腿执法，成熟度
 * 缺口 #9 落码批；此前「先有词后有法」挂账的执法批本体）。
 *
 * 腿一（重定向目标扫描）：词法扫描 bash 命令串全部重定向目标，命中 .git
 * 树 = `EXEC_GIT_REDIRECT_DENIED` 硬拒（消费位 bash 工具件，升权审批前）。
 * 腿二（白名单分类）：静态洁净 git 形判定——非豁免形由调用方叠 workspace
 * `.git` 写 deny（运行时兜底关 tee/python/sed -i/变量间接等全部非重定向
 * 向量）；豁免形 + worktree 锚定补 backing gitdir 可写根。
 *
 * 纯逻辑件（零 spawn）；fs 面 = statSync/readFileSync（worktree 探测）与
 * canonicalPath（最近存在祖先回退形——符号链/大小写归一判）。词法诚实边界
 * 见各函数注记：静态不可解的目标（`> $X` 形）由腿二运行时 deny 兜底，双层
 * 分层即本件的设计本体。
 */
import { readFileSync, statSync } from 'node:fs';
import { join, resolve as resolvePath, sep } from 'node:path';
import { canonicalPath } from '../safety/index.js';
import { GIT_METADATA_COMMANDS } from '../tools/index.js';

/* ------------------------------------------------------------------ */
/* 词法基元（引号感知 word 读取——两腿共用）                             */
/* ------------------------------------------------------------------ */

/** word 止步字符集（未引号态：空白/算子/括号/换行/反引号——替换域边界） */
const WORD_STOP = new Set([' ', '\t', '\n', ';', '|', '&', '<', '>', '(', ')', '`']);

/**
 * 读一个 word（引号感知拼接 unquote——`.g'it'/config` 对抗拼接形归一）。
 * 从 start 起跳过前导空白后积累至止步字符；单引号段内容原样拼接、双引号段
 * 反斜杠转义消费（`$(`/`` ` `` 在双引号内对词法是普通字符——含展开的目标词
 * 静态不可解，交词面判 + 腿二运行时兜底）。
 * @returns word = '' 表示无词（算子紧邻算子形）；next = 消费后位置
 */
function readWord(command: string, start: number): { word: string; next: number } {
  let i = start;
  while (i < command.length && (command[i] === ' ' || command[i] === '\t')) i++;
  let word = '';
  while (i < command.length) {
    const ch = command[i]!;
    if (WORD_STOP.has(ch)) break;
    if (ch === "'") {
      // 单引号段：至闭合单引号原样拼接（无转义语义）
      const close = command.indexOf("'", i + 1);
      if (close === -1) {
        word += command.slice(i + 1);
        i = command.length;
        break;
      }
      word += command.slice(i + 1, close);
      i = close + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < command.length && command[i] !== '"') {
        if (command[i] === '\\' && i + 1 < command.length) {
          word += command[i + 1]!;
          i += 2;
          continue;
        }
        word += command[i]!;
        i++;
      }
      i++; // 闭合双引号（缺席即串尾——未闭合引号形由 bash 自身报错）
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      word += command[i + 1]!; // 未引号反斜杠转义（文件名含空格支持）
      i += 2;
      continue;
    }
    word += ch;
    i++;
  }
  return { word, next: i };
}

/** 段内 token 化（readWord 循环；算子字符段跳过——`2>&1` 形读出 2/1 不影响词干判） */
function tokenizeWords(segment: string): readonly string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i]!;
    if (ch === ' ' || ch === '\t' || WORD_STOP.has(ch)) {
      i++;
      continue;
    }
    const { word, next } = readWord(segment, i);
    if (word === '') {
      i++;
      continue;
    }
    tokens.push(word);
    i = next;
  }
  return tokens;
}

/** 虚拟 cwd 词法解析（`~` 形不可解保留原词——词面判照走；path.resolve 归一 `..`） */
function resolveWord(vcwd: string, word: string): string {
  if (word.startsWith('~')) return word;
  if (word.startsWith('/') || word.startsWith(sep)) return resolvePath(word);
  return resolvePath(vcwd, word);
}

/* ------------------------------------------------------------------ */
/* 腿一：重定向目标扫描                                                 */
/* ------------------------------------------------------------------ */

/** 重定向目标（raw = 剥引号词面；resolved = 虚拟 cwd 词法解析形） */
export interface RedirectTarget {
  readonly raw: string;
  readonly resolved: string;
}

/**
 * 扫描 bash 命令串的全部重定向目标（写向量闭算子族）。
 *
 * 覆盖算子：`>` `>>` `>|` `<>` `&>` `&>>`（`N>`/`N>>` 数字前置形被裸 `>`
 * 分支自然覆盖）；`2>&1` fd 复制形跳过（数字跟随 = 非文件目标）；`<<`/`<<-`
 * heredoc 体整段跳过（体是数据非执行——防体内 `>` 假阳性）、`<<<` here-string
 * 词为数据跳过；`<` 普通输入重定向跳过（读向量不在本面）。
 *
 * 命令替换嵌套域（裸/双引号内 `$(`、反引号）照扫——替换体里的 `>` 是真
 * 算子（`"$(cmd > .git/x)"` 是真写）；嵌套域内 heredoc 不识别（体按文本扫
 * 可致保守误拒，方向无害——04 §252 诚实边界）。
 *
 * 段内 `cd <静态词>` 漂移追踪：段边界（未引号 `;` `&&` `||` `|` `&` 换行）
 * 处回看刚完段——`cd .git && > config` 漂移形同捕。漏追边界诚实成文：段内
 * 含重定向等附加 token 的复合 cd 形不追（`cd x 2>/dev/null && > f` 用旧
 * vcwd 解析——该构造下词面判缺席则由腿二 deny 兜底）。
 */
export function scanRedirectionTargets(command: string, cwd: string): readonly RedirectTarget[] {
  const targets: RedirectTarget[] = [];
  let vcwd = cwd;
  let segStart = 0;
  let i = 0;
  const n = command.length;
  /** 待跳 heredoc 体（读到 <<[-] delim 后置位；下一个未引号换行起整段跳体） */
  let pendingHeredoc: { delim: string; strip: boolean } | undefined;

  /** 读目标词并记录（从 from 起跳空白） */
  const recordTarget = (from: number): number => {
    const { word, next } = readWord(command, from);
    if (word !== '') targets.push({ raw: word, resolved: resolveWord(vcwd, word) });
    return next;
  };

  /** 段边界：回看刚完段是否静态 cd → 词法漂移 vcwd */
  const closeSegment = (boundaryStart: number, nextStart: number): void => {
    const seg = command.slice(segStart, boundaryStart);
    const tokens = tokenizeWords(seg);
    if (tokens.length === 2 && tokens[0] === 'cd' && !tokens[1]!.includes('$')) {
      vcwd = resolveWord(vcwd, tokens[1]!);
    }
    segStart = nextStart;
    i = nextStart;
  };

  /**
   * heredoc 体跳过（pendingHeredoc 在场时的换行触发）：从 from（换行后）起
   * 逐行至 delimiter 行（`<<-` 剥前导 tab）；未闭合（delimiter 行缺席）余串
   * 全跳（bash 自身报错不执行——跳过无害）。
   * @returns 消费后位置
   */
  const skipHeredocBody = (from: number, delim: string, strip: boolean): number => {
    let lineStart = from;
    while (lineStart <= n) {
      let lineEnd = command.indexOf('\n', lineStart);
      if (lineEnd === -1) lineEnd = n;
      let ls = lineStart;
      if (strip) while (ls < lineEnd && command[ls] === '\t') ls++;
      if (command.slice(ls, lineEnd) === delim) return Math.min(lineEnd + 1, n);
      if (lineEnd >= n) return n;
      lineStart = lineEnd + 1;
    }
    return n;
  };

  while (i < n) {
    const ch = command[i]!;
    // ---- 引号态 ----
    if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      i = close === -1 ? n : close + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n && command[i] !== '"') {
        if (command[i] === '$' && command[i + 1] === '(') {
          i = scanNested(command, i + 2, targets, () => vcwd);
          continue;
        }
        if (command[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < n) {
      i += 2;
      continue;
    }
    // ---- 命令替换（裸 $() / 反引号） ----
    if (ch === '$' && command[i + 1] === '(') {
      i = scanNested(command, i + 2, targets, () => vcwd);
      continue;
    }
    if (ch === '`') {
      i = scanNestedBacktick(command, i + 1, targets, () => vcwd);
      continue;
    }
    // ---- heredoc / 输入重定向族 ----
    if (ch === '<') {
      const c1 = command[i + 1];
      if (c1 === '<') {
        const c2 = command[i + 2];
        if (c2 === '<') {
          // here-string：词是数据非文件——跳过（本行其余照扫）
          i += 3;
          i = readWord(command, i).next;
          continue;
        }
        // heredoc：只消费 <<[-] 与 delimiter 词——本行其余照扫（`cat << EOF
        // > .git/x` 同行重定向是真写向量必须捕获）；体从下一个未引号换行起跳
        const strip = c2 === '-';
        i += 2 + (strip ? 1 : 0);
        const { word: delim, next } = readWord(command, i);
        i = next;
        if (delim !== '') pendingHeredoc = { delim, strip };
        continue;
      }
      if (c1 === '>') {
        // <> 读写重定向——写向量，记录
        i += 2;
        i = recordTarget(i);
        continue;
      }
      // 普通输入重定向：读向量不记录
      i += 1;
      i = readWord(command, i).next;
      continue;
    }
    // ---- 输出重定向族 ----
    if (ch === '>') {
      const c1 = command[i + 1];
      if (c1 === '>' || c1 === '|') {
        i += 2;
        i = recordTarget(i);
        continue;
      }
      if (c1 === '&') {
        // >& 形：后随数字/- = fd 复制（非文件目标）跳过；否则文件目标
        let j = i + 2;
        while (j < n && (command[j] === ' ' || command[j] === '\t')) j++;
        const jc = j < n ? command[j]! : '';
        if (jc !== '' && ((jc >= '0' && jc <= '9') || jc === '-')) {
          while (j < n && ((command[j]! >= '0' && command[j]! <= '9') || command[j] === '-')) j++;
          i = j;
          continue;
        }
        i += 2;
        i = recordTarget(i);
        continue;
      }
      i += 1;
      i = recordTarget(i);
      continue;
    }
    // ---- &> 族与段边界 ----
    if (ch === '&') {
      if (command[i + 1] === '>') {
        const c2 = command[i + 2];
        i += 2 + (c2 === '>' ? 1 : 0);
        i = recordTarget(i);
        continue;
      }
      closeSegment(i, i + (command[i + 1] === '&' ? 2 : 1)); // && 或后台 &
      continue;
    }
    if (ch === ';' || ch === '|') {
      const w = ch === '|' && command[i + 1] === '|' ? 2 : 1;
      closeSegment(i, i + w);
      continue;
    }
    if (ch === '\n') {
      // 换行：pending heredoc 在场先跳体（体是数据）；否则段边界
      if (pendingHeredoc !== undefined) {
        const { delim, strip } = pendingHeredoc;
        pendingHeredoc = undefined;
        i = skipHeredocBody(i + 1, delim, strip);
        segStart = i; // 体后新段（cd 漂移无跨体语义）
        continue;
      }
      closeSegment(i, i + 1);
      continue;
    }
    i++;
  }
  return targets;
}

/**
 * 嵌套命令替换域扫描（`$(` 开）：至配对 `)` 止（depth 计数、引号感知）。
 * 域内重定向照记（真实执行域）；heredoc 不识别（保守诚实边界）；反引号域
 * 递归。vcwd 取值用闭包读外层当前值（域内 cd 不回写外层——子壳语义保守）。
 * @returns 消费后位置（配对 `)` 之后）
 */
function scanNested(command: string, from: number, targets: RedirectTarget[], vcwdOf: () => string): number {
  let depth = 1;
  let i = from;
  const n = command.length;
  const recordTarget = (fromWord: number): number => {
    const { word, next } = readWord(command, fromWord);
    if (word !== '') targets.push({ raw: word, resolved: resolveWord(vcwdOf(), word) });
    return next;
  };
  while (i < n) {
    const ch = command[i]!;
    if (ch === ')') {
      depth--;
      if (depth === 0) return i + 1;
      i++;
      continue;
    }
    if (ch === '(') {
      depth++;
      i++;
      continue;
    }
    if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      i = close === -1 ? n : close + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n && command[i] !== '"') {
        if (command[i] === '$' && command[i + 1] === '(') {
          i = scanNested(command, i + 2, targets, vcwdOf);
          continue;
        }
        if (command[i] === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        i++;
      }
      i++;
      continue;
    }
    if (ch === '\\' && i + 1 < n) {
      i += 2;
      continue;
    }
    if (ch === '`') {
      i = scanNestedBacktick(command, i + 1, targets, vcwdOf);
      continue;
    }
    if (ch === '>') {
      const c1 = command[i + 1];
      if (c1 === '>' || c1 === '|') i += 2;
      else if (c1 === '&') {
        let j = i + 2;
        while (j < n && (command[j] === ' ' || command[j] === '\t')) j++;
        const jc = j < n ? command[j]! : '';
        if (jc !== '' && ((jc >= '0' && jc <= '9') || jc === '-')) {
          while (j < n && ((command[j]! >= '0' && command[j]! <= '9') || command[j] === '-')) j++;
          i = j;
          continue;
        }
        i += 2;
        i = recordTarget(i);
        continue;
      } else i += 1;
      i = recordTarget(i);
      continue;
    }
    if (ch === '<') {
      // 域内输入重定向/heredoc：读向量跳词（heredoc 不识别——保守边界）
      i += 1;
      i = readWord(command, i).next;
      continue;
    }
    i++;
  }
  return n; // 未闭合（bash 自身会报错）——余串已扫完
}

/** 反引号替换域扫描：至闭合反引号止（`$(` 域递归；重定向照记） */
function scanNestedBacktick(command: string, from: number, targets: RedirectTarget[], vcwdOf: () => string): number {
  let i = from;
  const n = command.length;
  const recordTarget = (fromWord: number): number => {
    const { word, next } = readWord(command, fromWord);
    if (word !== '') targets.push({ raw: word, resolved: resolveWord(vcwdOf(), word) });
    return next;
  };
  while (i < n) {
    const ch = command[i]!;
    if (ch === '`') return i + 1;
    if (ch === '\\') {
      if (command[i + 1] === '`' || command[i + 1] === '\\') {
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      i = close === -1 ? n : close + 1;
      continue;
    }
    if (ch === '$' && command[i + 1] === '(') {
      i = scanNested(command, i + 2, targets, vcwdOf);
      continue;
    }
    if (ch === '>') {
      const c1 = command[i + 1];
      if (c1 === '>' || c1 === '|') i += 2;
      else i += 1;
      i = recordTarget(i);
      continue;
    }
    i++;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* .git 判定与违例收集                                                  */
/* ------------------------------------------------------------------ */

/**
 * 路径 `/` 分段中恰有 `.git` 组件（`.gitignore`/`.github`/`x.git` 不误伤；
 * 裸相对形 `.git` 同命中）。词面判——`$X/.git/config` 形字面命中即真。
 */
export function pathHasGitComponent(p: string): boolean {
  return p.split(/[\\/]/).includes('.git');
}

/**
 * 腿一判定：命令的全部重定向目标中落在 .git 树内者（返回违例词面清单）。
 * 两重判：虚拟 cwd 词法解析判（resolved 词面组件判——path.resolve 归一
 * `..`（`.git/../out.txt` 逸出形正确放过）、`cd .git && > config` 漂移形、
 * `$X/.git/config` 字面拼接形命中）+ canonical 判（最近存在祖先符号链解
 * 析——macOS 大小写不敏感归一；解析失败静默降级词法判，不虚构路径）。
 */
export function findGitRedirectViolations(command: string, cwd: string): readonly string[] {
  const hits: string[] = [];
  for (const target of scanRedirectionTargets(command, cwd)) {
    if (pathHasGitComponent(target.resolved)) {
      hits.push(target.raw);
      continue;
    }
    try {
      if (pathHasGitComponent(canonicalPath(target.resolved))) hits.push(target.raw);
    } catch {
      // canonical 化失败（病理形态）——词法判已过，不虚构
    }
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* 腿二：静态洁净白名单分类                                             */
/* ------------------------------------------------------------------ */

/**
 * 静态洁净 git 白名单形判定（04 §252 腿二——豁免 = 策略不携 workspace .git
 * 写 deny + worktree 授予腿）。
 *
 * 洁净形 = 段（未引号 `;` `&&` `||` `|` `&` 换行 切分）全部为：
 *  - 空段；或
 *  - `cd` 恰一参（静态词）；或
 *  - 首词 basename = `git` 且次词 ∈ `GIT_METADATA_COMMANDS`（`git -C sub
 *    commit` 全局旗形失豁——词干判形不展开旗参，保守边界）。
 * 且全串无**单引号外** `$` 与反引号（展开不可静态判定即失豁免——`git commit
 * -m "$(cat f)"` 保守失豁、`-F` 直传替代）、无未引号 `(`/`)`（子壳失豁）。
 *
 * 重定向允许在豁免形内（`git log > out.txt` 豁免 ✓——.git 目标由腿一执法、
 * 词面判缺席时非 .git 目标无害）。管道段各判（`git log | head` 两段各自词干
 * 判——head 段非 git 形 → 整体非豁免 → deny 在场：只读命令不受写 deny 影响
 * 照常工作）。glob/`~` 允许。
 */
export function isGitMetadataExempt(command: string): boolean {
  const boundaries: Array<[number, number]> = []; // 段切片 [start, end)
  let expansion = false; // 单引号外 $/反引号在场
  let subshell = false; // 未引号括号在场
  let segStart = 0;
  let i = 0;
  const n = command.length;

  while (i < n) {
    const ch = command[i]!;
    if (ch === "'") {
      const close = command.indexOf("'", i + 1);
      i = close === -1 ? n : close + 1;
      continue;
    }
    if (ch === '"') {
      i++;
      while (i < n && command[i] !== '"') {
        const c = command[i]!;
        if (c === '\\' && i + 1 < n) {
          i += 2;
          continue;
        }
        if (c === '$' || c === '`') expansion = true; // 双引号内展开生效
        i++;
      }
      i++;
      continue;
    }
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '$' || ch === '`') {
      expansion = true;
      i++;
      continue;
    }
    if (ch === '(' || ch === ')') {
      subshell = true;
      i++;
      continue;
    }
    if (ch === '>') {
      // 重定向算子不切段（`git log > out.txt` 豁免面）；fd 复制形 `>&N` 的
      // & 在此一并消费——防 `2>&1` 的 & 被下分支误切段边界
      if (command[i + 1] === '&') {
        let j = i + 2;
        while (j < n && command[j]! >= '0' && command[j]! <= '9') j++;
        i = j;
        continue;
      }
      i += command[i + 1] === '>' || command[i + 1] === '|' ? 2 : 1;
      continue;
    }
    if (ch === '<') {
      // 输入重定向/heredoc 算子不切段；`<>` 读写形两字符消费
      i += command[i + 1] === '>' ? 2 : 1;
      continue;
    }
    if (ch === ';' || ch === '\n' || ch === '&' || ch === '|') {
      const w = (ch === '&' || ch === '|') && command[i + 1] === ch ? 2 : 1;
      boundaries.push([segStart, i]);
      i += w;
      segStart = i;
      continue;
    }
    i++;
  }
  boundaries.push([segStart, n]);

  if (expansion || subshell) return false;
  for (const [start, end] of boundaries) {
    const tokens = tokenizeWords(command.slice(start, end));
    if (tokens.length === 0) continue;
    if (tokens[0] === 'cd') {
      if (tokens.length !== 2) return false; // cd 多参/带旗形保守失豁
      continue;
    }
    const exe = tokens[0]!.split(/[\\/]/).pop()!;
    if (exe !== 'git') return false;
    const verb = tokens[1];
    if (verb === undefined || !GIT_METADATA_COMMANDS.includes(verb)) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* worktree 授予腿（backing gitdir 探测）                               */
/* ------------------------------------------------------------------ */

/**
 * worktree 形态探测（04 §252「worktree 绑定会话对锚定 worktree 的 git 命令
 * 豁免」的授予腿）：workspaceRoot `.git` 为**文件**（worktree 指针形）时读
 * `gitdir:` 指针，返回**主仓 common git dir**（`<repo>/.git/`）的 canonical
 * 路径。真跑证明返回 backing worktrees 目录不够——worktree 的 git 元数据写
 * 落点两面：backing（HEAD/index/logs）在 common dir 内，而**对象库共享**
 * （`git commit` 的 loose object 写主仓 `.git/objects/`、分支 ref 亦在主仓
 * `.git/refs/`）——缺省可写根推导两者皆不可达（沙箱下 `git commit` 结构性
 * 断链的真缺陷），由调用方将 common dir 并入 writableRoots 修复（backing
 * 是其子路径，单条全覆盖）。主仓形态（`.git` 目录）/非 git 环境/解析失败 =
 * undefined（主仓元数据写落 workspace 根内，本就可达）。
 *
 * common dir 解析序：backing 目录 `commondir` 文件（git worktree add 缺省产
 * 物——相对 backing 的路径）→ 缺席时几何回退（`worktrees/<name>` 上两级）。
 */
export function worktreeGitDir(workspaceRoot: string): string | undefined {
  try {
    const dotGit = join(workspaceRoot, '.git');
    if (!statSync(dotGit).isFile()) return undefined;
    const content = readFileSync(dotGit, 'utf8');
    const match = /^gitdir:\s*(\S+)/m.exec(content);
    if (!match) return undefined;
    const backing = match[1]!;
    try {
      const common = readFileSync(join(backing, 'commondir'), 'utf8').trim();
      if (common !== '') return canonicalPath(resolvePath(backing, common));
    } catch {
      // commondir 缺席（病理/手工 fixture 形）——几何回退
    }
    return canonicalPath(resolvePath(backing, '..', '..'));
  } catch {
    return undefined; // 缺席/不可读 = 非探测形（fail-soft：授予腿不造值）
  }
}
