/**
 * 会话事件词汇注册表（05 篇 §1.1 事件类型首批清单——16 核心词全列）。
 *
 * 双入口纪律：核心词汇本表静态声明（含类别/归属/语义），插件扩展经
 * registerEventType 显式注册；session append 词汇检查（未注册类型抛
 * SESSION_UNKNOWN_EVENT_TYPE）以本注册表为判据。
 *
 * 类别四分法（05 §1.1 收口）：
 *  - surface：构成派生表面（模型历史投影输入）；
 *  - snapshot：请求重建证据（request/header），不进模型历史；
 *  - log-only：审计与状态恢复用，永不进模型历史；
 *  - structure：日志骨架标记（turn 边界/种子边界）——不进模型历史，
 *    但是 fold 的判定输入（「不进模型历史」与「fold 不读」是两回事）。
 */
import type { ApiTier } from './api.js';
import { BaseError } from './errors.js';

/** 事件类别四分法闭集（类别列口径与 05 §3.1 投影执法对齐） */
export const EVENT_CATEGORIES = ['surface', 'snapshot', 'log-only', 'structure'] as const;
export type EventCategory = (typeof EVENT_CATEGORIES)[number];

/** 事件类型目录条目（注册表值形态） */
export interface EventTypeMeta {
  /** 事件类型词汇（如 'user/message'） */
  type: string;
  /** 类别四分法归属 */
  category: EventCategory;
  /**
   * 注册者归属（宿主件名或插件 id）——「逐事件注册者以表内注记为准」
   * （05 §1.1 表注）：CI 校验抛出/写入点一致的依据。
   */
  owner: string;
  /**
   * API 稳定性 tier（必填——零隐式 API 载体：目录宿主符号三级标签之一，
   * TS 编译期即红；03 篇 §8.3 标级载体分职。核心 16 词全 stable——
   * 会话事件词汇是已收口契约面）。
   */
  tier: ApiTier;
  /** 中文语义描述（生成目录用） */
  description: string;
  /** true = 读侧可以不认识此类型（向前兼容）；缺省 = 必须认识（核心词全部不 ignorable） */
  ignorable?: boolean;
}

/**
 * 核心事件类型 16 词（05 §1.1 表格逐条转录；owner 归属按表注：
 * gate/decision 归 tools、llm/usage 归 llm、llm/retry 注册走 session
 * 核心词汇（llm 模块不知道驱动存在）、plugin/uninstalled 宿主写点 host、
 * approval/* 与 sandbox/mode 归 safety 域、todo/write 归 conversation）。
 * tier 全 stable（核心词汇 = 已收口契约面，03 §8.3 零隐式载体）。
 */
const CORE_EVENT_TYPES: readonly EventTypeMeta[] = [
  {
    type: 'turn/start',
    category: 'structure',
    owner: 'session',
    tier: 'stable',
    description: '一轮（用户输入 → 停止）开始',
  },
  {
    type: 'turn/end',
    category: 'structure',
    owner: 'session',
    tier: 'stable',
    description: '一轮结束；reason = completed/aborted/blocked/error/max-tokens/interrupted（可扩展）',
  },
  {
    type: 'user/message',
    category: 'surface',
    owner: 'session',
    tier: 'stable',
    description: '用户输入（string 或 text/image 块）；source 归因词汇闭集见 types.ts',
  },
  {
    type: 'assistant/message',
    category: 'surface',
    owner: 'session',
    tier: 'stable',
    description:
      '组装完成后的消息级事件；toolCall 块不内联 content（由 tool/call 唯一承载）；errorMessage 腿独立 2KiB 小帽',
  },
  {
    type: 'tool/call',
    category: 'surface',
    owner: 'session',
    tier: 'stable',
    description: '工具调用（arguments 存原始未解析字符串——审计保真）',
  },
  { type: 'tool/result', category: 'surface', owner: 'session', tier: 'stable', description: '一调用一结果' },
  {
    type: 'todo/write',
    category: 'surface',
    owner: 'conversation',
    tier: 'stable',
    description: '轮内清单全量快照（last-write-wins）；fold = 日志倒扫最后一条 user/message 之后的最后一条本事件',
  },
  {
    type: 'request/header',
    category: 'snapshot',
    owner: 'session',
    tier: 'stable',
    description: '完整请求信封快照；reason = initial/resume/change，重建请求取最后一条为基准',
  },
  {
    type: 'session/end-seed',
    category: 'structure',
    owner: 'session',
    tier: 'stable',
    description: 'fork 种子边界标记（data 为空对象，边界即事件自身 seq）',
  },
  {
    type: 'approval/asked',
    category: 'log-only',
    owner: 'safety',
    tier: 'stable',
    description: '审批提问（决策对完整内容；turn 内闭合可回放）',
  },
  {
    type: 'approval/decided',
    category: 'log-only',
    owner: 'safety',
    tier: 'stable',
    description: '审批决策（决策对完整内容；turn 内闭合可回放）',
  },
  {
    type: 'gate/decision',
    category: 'log-only',
    owner: 'tools',
    tier: 'stable',
    description: '守门段决策（toolCallId/decision(allow|block|mutate)/reason）——「守门不可绕」不变式的断言对象',
  },
  {
    type: 'sandbox/mode',
    category: 'log-only',
    owner: 'safety',
    tier: 'stable',
    description: '会话级沙箱状态 = fold(events)，append 即切换、重放即恢复（无独立配置存储）',
  },
  {
    type: 'llm/usage',
    category: 'log-only',
    owner: 'llm',
    tier: 'stable',
    description: 'complete 单发补全通道的计量事实（token 原始值入账，货币折算在投影查询做）',
  },
  {
    type: 'llm/retry',
    category: 'log-only',
    owner: 'session',
    tier: 'stable',
    description: 'turn 级 auto-retry 的 durable 事实（attempt/phase scheduled|aborted|exhausted；成功不落）',
  },
  {
    type: 'plugin/uninstalled',
    category: 'log-only',
    owner: 'host',
    tier: 'stable',
    description: '卸载四段成功尾落账（id/source/dataAction/affected?；核心词身份拒装载面注册）',
  },
];

/** 核心词类型名清单（核心词保护判据——registerEventType 拒收） */
export const CORE_EVENT_TYPE_NAMES: readonly string[] = CORE_EVENT_TYPES.map((m) => m.type);

/** 注册表本体（type → 目录条目）；模块加载时灌入核心词 */
const registry = new Map<string, EventTypeMeta>();
for (const meta of CORE_EVENT_TYPES) registry.set(meta.type, meta);

/**
 * 注册事件类型（插件扩展唯一入口；宿主件自管类型已列核心表）。
 *
 * 两类拒收（均 fail-loud）：
 *  - 核心词身份：SESSION_CORE_TYPE_FORBIDDEN（防装载面伪造宿主词汇——
 *    与 session append 侧词汇检查同判据双闸）；
 *  - 注册冲突：HOST_EVENT_TYPE_CONFLICT（同型两方注册）。
 */
export function registerEventType(meta: EventTypeMeta): void {
  if (CORE_EVENT_TYPE_NAMES.includes(meta.type)) {
    throw new BaseError(
      'SESSION_CORE_TYPE_FORBIDDEN',
      `事件类型 ${meta.type} 是核心词汇——拒绝装载面注册/伪造（宿主身份词）`,
    );
  }
  const existing = registry.get(meta.type);
  if (existing) {
    throw new BaseError(
      'HOST_EVENT_TYPE_CONFLICT',
      `事件类型 ${meta.type} 重复注册：${existing.owner}（彼） vs ${meta.owner}（此）`,
    );
  }
  registry.set(meta.type, meta);
}

/** 判别事件类型是否已注册（session append 词汇检查的判据源） */
export function isKnownEventType(type: string): boolean {
  return registry.has(type);
}

/** 事件类型目录条目查询（未注册返回 undefined；类别/归属消费面用） */
export function getEventTypeMeta(type: string): EventTypeMeta | undefined {
  return registry.get(type);
}

/** 全量目录枚举（生成目录 / CI 校验用） */
export function listEventTypes(): EventTypeMeta[] {
  return [...registry.values()];
}
