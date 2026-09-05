/**
 * 会话事件信封与归因词汇类型（05 篇 §1.1 信封定稿 + §3.1 source 闭集定稿）。
 *
 * 本文件是 SessionEvent 形态的唯一权威——02 篇词汇表钉、05 篇 §1.1 重述，
 * 此处逐字段转录；LLM 消息/流/角色与工具/插件/子代理/Job 类型随对应模块
 * 落码批按 pi-ai 实形定义（contract-first：纵切批内先契约后实现）。
 */

/**
 * 表面遮蔽指令（改历史的唯一合法形态——追加 replace 指令事件遮蔽旧区间，
 * 原文保留可审计）。区间 [start, end] 为被遮蔽事件的 seq 闭区间。
 */
export interface SurfaceOp {
  /** 指令形态——v1 唯一值 'replace'（词汇预留扩展） */
  op: 'replace';
  /** 被遮蔽区间起始 seq（含） */
  start: number;
  /** 被遮蔽区间结束 seq（含） */
  end: number;
}

/**
 * 会话事件信封：日志唯一条目形态（append-only，写入即冻结）。
 */
export interface SessionEvent<T = unknown> {
  /** 事件类型词汇（核心清单 events.ts + 插件显式注册扩展） */
  type: string;
  /** = 写入时 log.length，强制连续、0 起（只在尾部追加结构保证，无独立分配器） */
  seq: number;
  /** 毫秒时间戳；合成事件复用最后真实事件的 time（确定性——金样回放友好） */
  time: number;
  /** 已冻结的 JSON 快照（写入时单遍校验 + deepFreeze——从冻结快照读 = 免拷贝投影） */
  data: T;
  /** true = 读侧可以不认识此类型（向前兼容）；缺省 = 必须认识 */
  ignorable?: boolean;
  /** 遮蔽指令——仅改历史事件携带（§2 surfaceOp 协议） */
  surfaceOp?: SurfaceOp;
  /** 遮蔽溯源：被遮蔽节点 + 依据事件的完整 seq 列表 */
  sourceEventSeqs?: number[];
}

/**
 * user/message 的 source 归因词汇闭集（05 §3.1 表全列）：
 * 五字面量 ∪ 两前缀模板串。TS 模板字面量类型即闭集执法——已知前缀的
 * 任意后缀（`plugin:未来插件`）类型合法，语义按前缀行展开。
 */
export type EventSource =
  | 'user' // 真用户输入经缺省交互通道（TUI）
  | `channel:${string}` // 真用户输入经具名通道（webui 提交、CLI 管道喂入等）——投影同视 user
  | 'schedule' // 挂钟调度触发（scheduler 插件注入的到点输入）
  | 'subagent-settled' // 委派子会话结算回流
  | 'compaction' // 压缩摘要载体（§2.1）
  | `plugin:${string}`; // 插件注入的受控输入（经受理制写面）——投影不视为用户话语

/** source 归一化种类（前缀型归并到 kind；字面量一一对应） */
export type EventSourceKind = 'user' | 'channel' | 'schedule' | 'subagent-settled' | 'compaction' | 'plugin';

/** parseEventSource 结果：归一化种类 + 原值 + 投影位判别 */
export interface ParsedEventSource {
  /** 归一化种类（未知字面量归 'user'——旧日志向前兼容按 user 同视） */
  kind: EventSourceKind;
  /** 原始字符串（审计保真） */
  raw: string;
  /**
   * 投影是否以用户话语位展开（05 §3.1「投影同视 user」判据）：
   * user/channel/schedule/subagent-settled = true（都是输入位，仅审计可辨入口）；
   * compaction/plugin = false（摘要载体与受控注入不视为用户话语——渲染与
   * 记忆提取归因区分显示）。
   */
  treatedAsUser: boolean;
}

/** 字面量五值 → 归一化种类映射（前缀型经 startsWith 归并） */
const LITERAL_SOURCE_KINDS: Readonly<Record<string, EventSourceKind>> = {
  user: 'user',
  schedule: 'schedule',
  'subagent-settled': 'subagent-settled',
  compaction: 'compaction',
};

/**
 * 解析 source 归因字符串（闭集执法的读侧判据，05 §3.1）：
 *  - 已知前缀的未知后缀（如 'plugin:未来插件'）按前缀行语义展开；
 *  - 未知字面量（旧日志向前兼容）按 user 同视；
 *  - append 侧新值必须先扩闭集（类型 + 本函数）——写入纪律归 session 落码批。
 */
export function parseEventSource(source: string): ParsedEventSource {
  if (source.startsWith('channel:')) {
    return { kind: 'channel', raw: source, treatedAsUser: true };
  }
  if (source.startsWith('plugin:')) {
    return { kind: 'plugin', raw: source, treatedAsUser: false };
  }
  const literal = LITERAL_SOURCE_KINDS[source];
  if (literal) {
    // compaction 是摘要载体：不是人说的——投影位与 plugin 同判 false
    const treatedAsUser = literal === 'user' || literal === 'schedule' || literal === 'subagent-settled';
    return { kind: literal, raw: source, treatedAsUser };
  }
  // 未知字面量：旧日志向前兼容——按 user 同视（读侧宽容，append 侧严进）
  return { kind: 'user', raw: source, treatedAsUser: true };
}

/**
 * turn/end 的 reason 闭集（05 §1.1 表：completed / aborted / blocked / error /
 * max-tokens / interrupted，可扩展）。`(string & {})` 保留字面量自动补全的
 * 同时不拒扩展值——新增终态值属词汇演进，须先扩 05 篇表格。
 */
export type TurnEndReason =
  'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens' | 'interrupted' | (string & {});
