/**
 * host/project-instructions — 宿主项目上下文段（AGENTS.md 装载——03 §2.5
 * A4 条·CLI/SDK 进化批 2026-11-09）。
 *
 * 三钉（03 §2.5 A4 笔全文归范）：
 *  - **发现序**：自会话工作区根逐级向上至文件系统根，每目录**先 AGENTS.md
 *    后 CLAUDE.md**（规范名优先、CLAUDE.md 系兼容回退），**首个命中即装载
 *    （最近者胜）、只装一份**；全程无命中 = 零段诚实缺席（不注入空壳）。
 *  - **物化形** = 头部路径披露行 + fence 长度自适应的原文整嵌（「模型可见
 *    即已记录」铁律——模型看得见的指令须可溯源到盘上文件；fence 取原文内
 *    最长 fence 行 +1〔下限四反引号〕防自含 fence 提前闭合破嵌）；大小帽
 *    64 KiB 超帽截断 + 截断披露行（「截断必须带作者侧反馈」律）。
 *  - **fail-open**：候选文件不可读/编码坏、逐级向上途中 stat 失败（EACCES
 *    等）一律 warn 一行继续向上（项目指令装载是增强面非正确性面）。
 *
 * 段生命周期（归类基线② 两律合用同款）：volatile 声明（多工作区会话交替
 * 物化免锚噪声）+ **每会话懒冻结**（会话首物化冻结、会话内字节恒定；盘上
 * 文件变更不热跟，`/reload` 换代 = 新 registry 实例自然重发现重冻结）。
 * 冻结缓存帽 256 逐最旧（Map 插入序——memory/core 简报段同形兜底）；**空
 * 结果不冻结**（会话锚迟到形防「早期空冻结钉死」——空形每次重走发现，
 * 命中即冻结恒定）。
 */
import { readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import type { PromptSectionBuilder } from './prompt-sections.js';

/** 装载帽（64 KiB 按 UTF-8 字节计——03 §2.5 A4 笔） */
const PROJECT_INSTRUCTIONS_CAP_BYTES = 64 * 1024;

/** 候选文件名序（目录内 AGENTS.md 优先于 CLAUDE.md——规范名优先、兼容回退） */
const CANDIDATE_NAMES = ['AGENTS.md', 'CLAUDE.md'] as const;

/** 发现命中产物 */
export interface DiscoveredProjectInstructions {
  /** 命中文件绝对路径（披露行载荷——溯源到盘上文件） */
  readonly path: string;
  /** 原文（可能已按帽截断） */
  readonly text: string;
  /** 是否发生 64 KiB 截断（截断披露行的判据位） */
  readonly truncated: boolean;
}

/** 发现结果（found 缺席 = 全程无命中；warnings = fail-open 逐条呈报） */
export interface ProjectInstructionsDiscovery {
  readonly found?: DiscoveredProjectInstructions;
  readonly warnings: readonly string[];
}

/** fs seam（发现器纯函数化的注入面——测试替身零真盘依赖；缺省真 fs） */
export interface ProjectInstructionsFs {
  readonly isFile?: (path: string) => boolean;
  readonly readBytes?: (path: string) => Buffer;
}

/**
 * 项目上下文发现器：自 startDir（会话工作区根——调用方保证归一形；非绝对
 * 路径防御性返回无命中）逐级向上，最近者胜只装一份。fail-open：一切候选
 * 级失败（stat/read）warn 一条继续向上，绝不抛出（增强面非正确性面）。
 */
export function discoverProjectInstructions(
  startDir: string,
  fs: ProjectInstructionsFs = {},
): ProjectInstructionsDiscovery {
  // isFile 缺省真身：ENOENT（候选缺席——逐级向上的常态路径）归 false 静默
  // continue；其余错误（EACCES 等目录/权限坏形）上抛走候选级 fail-open warn
  //（N-3 语义：缺席不是故障、读不到才是）
  const isFile =
    fs.isFile ??
    ((path: string) => {
      try {
        return statSync(path).isFile();
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
        throw error;
      }
    });
  const readBytes = fs.readBytes ?? ((path: string) => readFileSync(path));
  const warnings: string[] = [];
  if (!isAbsolute(startDir)) {
    // 防御形：非绝对路径不猜（调用方契约 = canonicalWorkspaceRoot 归一形）
    return { warnings };
  }
  let dir = startDir;
  // 逐级向上至文件系统根（dirname('/') === '/'——根处理完即退出）
  for (;;) {
    for (const name of CANDIDATE_NAMES) {
      const candidate = join(dir, name);
      try {
        if (!isFile(candidate)) continue;
        const bytes = readBytes(candidate);
        const truncated = bytes.length > PROJECT_INSTRUCTIONS_CAP_BYTES;
        const text = (truncated ? bytes.subarray(0, PROJECT_INSTRUCTIONS_CAP_BYTES) : bytes).toString('utf8');
        return { found: { path: candidate, text, truncated }, warnings };
      } catch (error) {
        // fail-open：候选级失败（不可读/编码坏/目录 stat EACCES 等）warn 继续
        warnings.push(
          `${candidate} 读取失败（${error instanceof Error ? error.message : String(error)}）——跳过继续向上`,
        );
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return { warnings };
    dir = parent;
  }
}

/**
 * 原文内最长 fence 行的反引号数 +1（下限 4）——fence 长度自适应（嵌套防破
 * 律：原文自含 ``` 代码块时等长 fence 会被提前闭合，物化形结构性破损）。
 */
function fenceLengthOf(text: string): number {
  let longest = 0;
  for (const match of text.matchAll(/^[^\S\n]*(`{3,})/gm)) {
    const run = match[1] ?? '';
    if (run.length > longest) longest = run.length;
  }
  return Math.max(longest + 1, 4);
}

/** 物化形：路径披露行 + fence 原文整嵌（截断时追加截断披露行——作者侧反馈律） */
export function renderProjectInstructions(found: DiscoveredProjectInstructions): string {
  const fence = '`'.repeat(fenceLengthOf(found.text));
  const header = found.truncated
    ? `项目指令（${found.path}）——以下内容超过 64 KiB，已截断至前 64 KiB（完整内容见原文件）`
    : `项目指令（${found.path}）`;
  return `${header}\n${fence}\n${found.text}\n${fence}`;
}

/**
 * 宿主项目上下文段 builder 工厂（plugin-boot 装配位消费）。
 *
 * sessionId 缺席（诊断直物化形）= 空串——零段诚实缺席（S-3：materialize 滤
 * 空不占位，空段噪声禁）；workspaceRoot 解析缺席 = 空串且**不冻结**（会话
 * 锚迟到形——下次物化重走发现，防早期空冻结钉死）；命中即冻结（会话内
 * 字节恒定——归类基线②懒冻结律）。warnings 经注入的 warn 逐条呈报（进程
 * 日志位——fail-open 观测不静默）。
 */
export function createProjectSectionBuilder(
  workspaceRootOf: (sessionId: string) => string | undefined,
  warn: (message: string) => void,
): PromptSectionBuilder {
  // 每会话懒冻结缓存（帽 256 逐最旧——Map 插入序 = 首冻结序；memory/core
  // 简报段同形兜底；retire 摘除腿随真实需求另接——帽兜底先在）
  const frozen = new Map<string, string>();
  return (sessionId?: string): string => {
    if (sessionId === undefined) return '';
    const hit = frozen.get(sessionId);
    if (hit !== undefined) return hit;
    const root = workspaceRootOf(sessionId);
    if (root === undefined) return '';
    const discovery = discoverProjectInstructions(root);
    for (const warning of discovery.warnings) warn(`项目上下文发现：${warning}`);
    if (discovery.found === undefined) return ''; // 无命中不冻结——锚/文件迟到形下次重走
    const text = renderProjectInstructions(discovery.found);
    if (frozen.size >= 256) {
      const oldest = frozen.keys().next().value;
      if (oldest !== undefined) frozen.delete(oldest);
    }
    frozen.set(sessionId, text);
    return text;
  };
}
