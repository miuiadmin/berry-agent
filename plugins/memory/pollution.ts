/**
 * polluted 会话资格件（06 §4.1 + 批 18c-5 落码定形注——外部源内容不做记忆
 * 提取源的资格检查；两路入口〔即时路编排首步/周期路 fire 首步〕同一检查）。
 *
 * **判据通配条目机制**：通配形 '*__*'（'*' → 任意子串，无 '*' = 精确名）；
 * 起草值 `['fetch', 'mcp', '*__*']`——'fetch'/'mcp' 精确名（web fetch 工具与
 * MCP 目录工具）+ '*__*' = MCP 复合键全族（`server__tool`——服务器键无
 * 下划线，'__' 子串即复合键指纹）。清单常量可注入（判据演进不改机制）。
 *
 * **标记位 = tool/call 事件**（载荷携 name——周期路编排件消费 durable 事件
 * 流时逐条喂 markIfPolluted；即时路不标记只查态）。**会话资格态 v1 = 进程
 * 内存 Map**（重启回退 eligible——pollution 判定是会话进行时的护栏不是终审，
 * 回退代价 = 至多一轮提取，不违背「durable 之外零新真值」红线：判据事件
 * durable 而资格态是派生缓存）。**单向转移幂等**：eligible → polluted 一路，
 * 无回退（污染不可逆——会话内外部源内容已混入，宁弃一轮不可误提）。
 */
import { MEMORY_POLLUTION_DEFAULT_PATTERNS, type SessionEligibility } from './types.js';

/** 正则元字符转义（通配拆段后逐段转义——'*' 之外的元字符按字面量） */
function escapeRe(segment: string): string {
  return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * 通配判据匹配（'*' → 任意子串）：无 '*' = 精确名比对；含 '*' 按 `^…$` 全串
 * 锚定（'*__*' = 含 '__' 子串的任意名——MCP 复合键全族）。
 */
export function matchesToolPattern(toolName: string, pattern: string): boolean {
  if (!pattern.includes('*')) return toolName === pattern;
  const re = new RegExp(`^${pattern.split('*').map(escapeRe).join('.*')}$`);
  return re.test(toolName);
}

/** 工具名是否命中 polluted 判据（缺省表 = 起草值；patterns 注入可覆盖） */
export function isPollutingToolName(
  toolName: string,
  patterns: readonly string[] = MEMORY_POLLUTION_DEFAULT_PATTERNS,
): boolean {
  return patterns.some((p) => matchesToolPattern(toolName, p));
}

/** 会话资格追踪器公开面（周期路编排件与即时路 seam 共用） */
export interface PollutionTracker {
  /** 现行资格态（未知会话缺省 'eligible'——重启回退语义） */
  classify(sessionId: string): SessionEligibility;
  /** polluted 谓词（即时路/周期路两路入口的检查原语） */
  isPolluted(sessionId: string): boolean;
  /**
   * 单向转移幂等：当前 eligible 且工具名命中判据 → polluted（返回本调用是否
   * 完成转移——已 polluted 返 false、不命中返 false）；无回退路径。
   */
  markIfPolluted(sessionId: string, toolName: string): boolean;
  /** polluted 会话集快照（consolidation 圈候选消费面——§4.1 淘汰批） */
  pollutedSessions(): readonly string[];
}

/** 装配依赖（patterns 缺省 = 起草值表） */
export interface PollutionTrackerDeps {
  readonly patterns?: readonly string[];
}

/** 建会话资格追踪器（进程单例——周期路编排件内建，装配面亦可外置注入） */
export function createPollutionTracker(deps: PollutionTrackerDeps = {}): PollutionTracker {
  const patterns = deps.patterns ?? MEMORY_POLLUTION_DEFAULT_PATTERNS;
  const states = new Map<string, SessionEligibility>();
  return {
    classify(sessionId) {
      return states.get(sessionId) ?? 'eligible';
    },
    isPolluted(sessionId) {
      return (states.get(sessionId) ?? 'eligible') === 'polluted';
    },
    markIfPolluted(sessionId, toolName) {
      if ((states.get(sessionId) ?? 'eligible') === 'polluted') return false; // 幂等——已污染零动作
      if (!isPollutingToolName(toolName, patterns)) return false;
      states.set(sessionId, 'polluted'); // 单向转移——无回退
      return true;
    },
    pollutedSessions() {
      return [...states.entries()].filter(([, s]) => s === 'polluted').map(([id]) => id);
    },
  };
}
