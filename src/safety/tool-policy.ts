/**
 * L3 safety — 跨会话工具策略表匹配引擎（04 §9 粘性第 3/4 款 + 2026-09-11
 * 审批分档批定形块③④——纯函数半边；原「allowlist 匹配引擎」随文件更名
 * tool-policy.json 同步升格「工具策略表」概念）。
 *
 * 定位：条目双面——**allow = advisory 免问面**（只影响「问不问」，不折算
 * 执行权：fence / 可写根 / carve-out 硬拒面 / 执行段照走）；**deny = 用户
 * 主权硬拒**（不可被 sticky / allow / policy-never / sandbox danger 任何
 * 后续面翻转——④deny 优先律：首个 deny 命中恒最先且硬拒，reason
 * `policy-deny:<条目序>`）。deny 永远最高，本引擎 deny 命中即终局返回。
 * 条目落用户配置层（`~/.berry-agent/tool-policy.json`，非模型可写面——
 * §7 fence；存储读写接线在 host 件，本文件定形状与判定语义）。
 *
 * 三族匹配器（04 §9 粘性段定形③，族分派沿旧）：
 * - fs 族（write / edit）：条目 pattern = 路径前缀（相对则锚 workspace）——
 *   本次调用**全部**写目标都落在前缀内才命中（多路径 all-or-nothing，保守）；
 * - bash 族：条目 pattern = 命令词干（≤2 词：命令 [子命令]）——剥壳语义全
 *   集见 commandStem（环境变量前缀剥除 / shell 包装穿透一层 / 管道与串接
 *   即不可判定 / 任何 flag 即不可判定——v1 无「已知 flag 白名单」，白名单
 *   随真实命令谱定稿；git -C 换仓走私被「flag 即 miss」自然覆盖）；
 * - 其余工具族：工具名整匹配（pattern 字段忽略，留位后续扩族）。
 *
 * TTL（粘性第 4 款）：**仅 allow 条目**——`expiresAt`（Unix 毫秒）过期 =
 * 未命中（回落 ask），缺省 = 用户显式选择永久；deny 条目**无 TTL**（带
 * `expiresAt` 的 deny 条目属坏形——deny 自动过期 = 自动变宽松，方向性不
 * 允许；引擎按逐条剔除语义跳过，与读侧坏形剔除同形）。
 *
 * 档位限定（定形块③偏序包含判）：条目 `effect?` 缺席 = 全档；在场时——
 * **allow 条目窄化自限**（只作用于该档及以下：write 档 allow 条目不覆盖
 * exec 调用）、**deny 条目覆写扩面**（作用于该档及以上：write 档 deny
 * 条目覆盖 write+exec 调用）——方向性同律：allow 不自动放宽、deny 不自动
 * 收紧。
 */

import { basename, resolve as resolvePath, sep } from 'node:path';
import { TOOL_TIER_RANK, type ToolEffect } from '../contracts/index.js';
import { canonicalPath } from './roots.js';

/** fs 写路径工具族（与 gate 守门行认知的写意图工具同源；导出供守门行判定收窄共用） */
export const FS_WRITE_TOOLS: ReadonlySet<string> = new Set(['write', 'edit']);

/**
 * 工具策略表条目（用户配置层 tool-policy.json 的行形状——04 §9 定形块③
 * 六字段，2026-09-11 审批分档批；原三字段 allowlist 形经读侧迁移视为
 * allow 条目〔decision 缺席 = allow——旧文件升格读入语义〕）。
 * 机器写侧唯一正门**只产 allow 条目**（deny 是用户主权面，唯用户手写）。
 */
export interface ToolPolicyEntry {
  /** 工具名（宿主面统一词汇——'write' / 'edit' / 'bash' / 其余工具名；provider/别名不进条目） */
  readonly tool: string;
  /**
   * 按工具族分派的模式：fs = 路径前缀 / bash = 命令词干 / 其余 = 忽略。
   * fs/bash 族上缺席 = 坏形（匹配不到任何调用——读侧逐条剔除同语义）。
   */
  readonly pattern?: string;
  /**
   * 档位限定（偏序包含判——见文件头注；TOOL_TIER_RANK 与沙箱 TIER_RANK
   * 两轴分立）。缺席 = 全档。
   */
  readonly effect?: ToolEffect;
  /** 条目方向：allow = advisory 免问 / deny = 硬拒（deny 优先律——④(1)） */
  readonly decision: 'allow' | 'deny';
  /** 用户手写说明位（explain 面呈现——机器不产） */
  readonly reason?: string;
  /**
   * 过期时间（Unix 毫秒）；缺省 = 永久（用户显式选择）。**仅 allow 条目**
   * ——deny 条目带此位属坏形（永久性是 deny 语义的一部分，解除唯手删）。
   */
  readonly expiresAt?: number;
}

/** 匹配输入（调用方组装——engine 不读工具参数结构，保持纯函数） */
export interface ToolPolicyInput {
  /** 工具名 */
  readonly tool: string;
  /**
   * 本次调用的工具档（偏序包含判需要）——从注册表 ToolDefinition.effect
   * 取（注册面归一后的值，缺省 exec 语义同源）。
   */
  readonly effect: ToolEffect;
  /** fs 族：本次调用全部写目标的 canonical 绝对路径（守门行 extractWritePaths 产物） */
  readonly writePaths?: readonly string[];
  /** bash 族：命令原文（args.command） */
  readonly bashCommand?: string;
  /** 工作区根（相对 pattern 的锚点） */
  readonly workspace?: string;
}

/** 命中结果（条目序号供 gate/decision 落账的来源标注——policy-allow:<index> / policy-deny:<index>） */
export interface ToolPolicyMatch {
  readonly index: number;
  readonly entry: ToolPolicyEntry;
}

/**
 * 命中来源标注串（ap-3 三面同源单源）：守门行 deny 理由 / allow 免问
 * allowReason、/approval explain 干跑呈现、session_status 整名族干跑呈现
 * ——三面共用本函数，执法与呈现漂移在结构上不可能（同函数同条目同串）。
 */
export function policyHitNote(match: ToolPolicyMatch): string {
  return `policy-${match.entry.decision}:${match.index}`;
}

/**
 * 判定入口（04 §9 定形块④评估序的纯函数半边）：**deny 命中恒最先且终局**
 * ——全表扫描中首个 deny 命中即返回（**序在 allow 之前恒胜**：条目序不构成
 * deny 与 allow 的优先级，deny 是不同维度的主权裁决）；无 deny 命中时返回
 * 首个未过期 allow 命中；无命中返回 undefined。
 * 保守原则：任何不可判定（管道/串接/引号/flag/条目形状非法/deny 带 TTL）
 * 都按未命中处理——照问照审，不做假静态分析（deny 坏形剔除同向：被剔除的
 * deny 条目不参与评估，其余条目照常）。
 */
export function matchToolPolicy(
  entries: readonly ToolPolicyEntry[],
  input: ToolPolicyInput,
  now: number,
): ToolPolicyMatch | undefined {
  let firstAllow: ToolPolicyMatch | undefined;
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    if (entry.tool !== input.tool) continue;
    // 偏序包含判（③）：缺席全档；allow 及以下 / deny 及以上
    if (!tierIncluded(entry, input.effect)) continue;
    // deny 条目带 expiresAt = 坏形 → 逐条剔除（跳过继续扫，非整档失效）。
    // decision 缺席防御：仅精确 'deny' 走硬拒腿（旧形行经读侧归一为 allow）
    if (entry.decision === 'deny') {
      if (entry.expiresAt !== undefined) continue;
      if (entryMatches(entry, input)) return { index, entry };
      continue;
    }
    // TTL（粘性第 4 款，仅 allow）：过期 = 未命中（回落 ask；过期条目由配置面提示清理）
    if (entry.expiresAt !== undefined && now >= entry.expiresAt) continue;
    if (firstAllow === undefined && entryMatches(entry, input)) firstAllow = { index, entry };
  }
  return firstAllow;
}

/** 档位偏序包含判（③）：allow 条目只作用于该档及以下（窄化自限）、deny 条目作用于该档及以上（覆写扩面） */
function tierIncluded(entry: ToolPolicyEntry, callEffect: ToolEffect): boolean {
  if (entry.effect === undefined) return true;
  const callRank = TOOL_TIER_RANK[callEffect];
  const entryRank = TOOL_TIER_RANK[entry.effect];
  return entry.decision === 'deny' ? callRank >= entryRank : callRank <= entryRank;
}

/** 三族匹配分派（fs 前缀 all-or-nothing / bash 词干 / 整名族） */
function entryMatches(entry: ToolPolicyEntry, input: ToolPolicyInput): boolean {
  if (FS_WRITE_TOOLS.has(entry.tool)) {
    return fsPrefixHit(entry.pattern, input);
  }
  if (entry.tool === 'bash') {
    const command = input.bashCommand ?? '';
    return command.trim().length > 0 && matchesCommandStem(entry.pattern ?? '', command);
  }
  // 整名族：工具名相等即命中（TTL/档位判已在前）
  return true;
}

/** fs 族判定：全部写目标落在条目前缀内（前缀到路径分隔边界——/app 不匹配 /apple）；pattern 缺席/不可解析 = 条目无效 = 不命中 */
function fsPrefixHit(pattern: string | undefined, input: ToolPolicyInput): boolean {
  if (typeof pattern !== 'string' || pattern.length === 0) return false;
  const paths = input.writePaths ?? [];
  if (paths.length === 0) return false; // 无写意图不归本族（整名语义由他族条目表达）
  let prefix: string;
  try {
    // 相对 pattern 锚 workspace；canonical 化与 fence/根推导同源
    prefix = canonicalPath(resolvePath(input.workspace ?? process.cwd(), pattern));
  } catch {
    return false; // pattern 不可解析 = 条目无效 = 不命中
  }
  return paths.every((p) => p === prefix || p.startsWith(prefix + sep));
}

/** 不可判定字符集：管道 / 串接 / 重定向 / 命令替换 / 换行——任一出现即照问 */
const INDETERMINATE = /[|;&<>$(`)\n]/;
/** 引号字符（剥离 shell 包装引号后仍残留即视为不可判定） */
const QUOTES = /["'`]/;
/** shell 包装器名（穿透一层取内层命令） */
const WRAPPERS: ReadonlySet<string> = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh']);
/** 包装器选项中含 c（-c / -lc / -ec——payload 在下一个词） */
const WRAPPER_C_OPTION = /^-[a-z]*c[a-z]*$/;

/**
 * 剥壳取主命令词干（≤2 词：命令 [子命令]）——「始终允许」bash 草案生成器
 * （04 §9 粘性段定形③：fs = 精确路径、bash = 剥壳词干——与 matchesCommandStem
 * 同源同实现，剥壳全集共享，双实现漂移结构性不可能）。不可判定（管道/串接/
 * 重定向/命令替换/换行/残留引号/flag——全局无害三件除外）返回 undefined：
 * 剥不出干净词干即无草案，「始终允许」选项不呈现。
 */
export function commandStem(command: string): string | undefined {
  // 换行（含 \r）是命令分隔符，且会被下方 \s+ 分词吞掉——必须先于分词对原文
  // 检查（INDETERMINATE 其余字符均非空白、分词后仍存活；唯换行需要前置）
  if (/[\r\n]/.test(command)) return undefined;
  // 剥壳：环境变量前缀赋值 + shell 包装穿透一层
  let tokens = command.trim().split(/\s+/).filter(Boolean);
  while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=\S*$/.test(tokens[0]!)) {
    tokens = tokens.slice(1);
  }
  if (tokens.length === 0) return undefined;
  let head = basename(tokens[0]!);
  if (WRAPPERS.has(head)) {
    // 找 -c 类选项后的 payload 词（选项序列之后的第一个非选项词）
    let i = 1;
    let sawC = false;
    while (i < tokens.length && tokens[i]!.startsWith('-') && WRAPPER_C_OPTION.test(tokens[i]!)) {
      sawC = true;
      i += 1;
    }
    if (sawC && i < tokens.length) {
      // payload = 选项后全部剩余词拼接（引号内空格已被分词拆散——拼接还原后再剥引号）
      let payload = tokens.slice(i).join(' ');
      // 剥整段包裹引号；引号内含空白则重新分词（只此一层，不递归）
      if (
        payload.length >= 2 &&
        ((payload.startsWith("'") && payload.endsWith("'")) || (payload.startsWith('"') && payload.endsWith('"')))
      ) {
        payload = payload.slice(1, -1);
      }
      tokens = payload.split(/\s+/).filter(Boolean);
      head = tokens.length > 0 ? basename(tokens[0]!) : '';
    }
  }
  if (tokens.length === 0 || head === '') return undefined;

  // 不可判定：命令全文任一危险字符 / 残留引号 → 无词干（草案不生成）
  const peeled = tokens.join(' ');
  if (INDETERMINATE.test(peeled) || QUOTES.test(peeled)) return undefined;

  // 剩余参数保守判定：flag 即无词干（--help/-h/--version 三件无害除外）
  const rest = tokens.slice(1);
  for (const arg of rest) {
    if (arg.startsWith('-') && arg !== '--help' && arg !== '-h' && arg !== '--version') return undefined;
  }

  // 词干 = 主命令 [子命令]（≤2 词；子命令存在且非 flag 才纳入）
  const cmd = basename(tokens[0]!);
  const sub = tokens[1];
  return sub !== undefined && !sub.startsWith('-') ? `${cmd} ${sub}` : cmd;
}

/**
 * bash 族判定：剥壳与不可判定全权委托 commandStem（同源同实现——草案生成
 * 与本判定共用同一套剥壳全集）；本函数只做 pattern（≤2 词）对词干的**逐词
 * 前缀对齐**——pattern 单词（如 `git`）匹配「该命令 + 任意非 flag 形参」
 * （`git status` 命中 `git` 条目），双词条目（`git push`）要求词干恰好两词
 * 且逐词相等。
 */
function matchesCommandStem(pattern: string, command: string): boolean {
  // pattern 解析：≤2 词（命令 [子命令]）；超长/空 = 条目无效
  const patternTokens = pattern.trim().split(/\s+/).filter(Boolean);
  if (patternTokens.length === 0 || patternTokens.length > 2) return false;

  const stem = commandStem(command);
  if (stem === undefined) return false; // 剥不出干净词干（不可判定）即 miss

  const stemTokens = stem.split(' ');
  if (patternTokens.length > stemTokens.length) return false;
  return patternTokens.every((token, i) => token === stemTokens[i]);
}
