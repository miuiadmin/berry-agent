/**
 * core:memory 类型面（06 篇 §3/§5——记忆表族 + 合并三分支；批 18c-1）。
 *
 * 单向 DAG（02 §4.1 memory 席 deps = contracts + context + session + persist）：
 * 本批实边 contracts（错误码注册）+ persist（SqliteDatabase / MigrationSpec）；
 * context/session 席占位——owner_key 的 canonical 根接线（context）与
 * session/event 消费（提取/注入两路）随 18c-3/4/5 笔落码。
 *
 * 本文件钉死：kind 七值闭集、status 三值闭集、source_refs 溯源形、
 * 候选/行形、三分支裁决结果、入库结局——契约先行的词汇面单源。
 */

/* ---------------- 闭集词汇（06 §3 DDL 注同源） ---------------- */

/** 记忆种类七值（Hermes 分类收窄——06 §3 kind 七值语义表） */
export type MemoryKind = 'preference' | 'fact' | 'convention' | 'correction' | 'failure' | 'insight' | 'profile';

/** kind 七值闭集单源（运行时校验消费——MEMORY_ENTRY_INVALID 判据之一） */
export const MEMORY_KINDS: readonly MemoryKind[] = [
  'preference',
  'fact',
  'convention',
  'correction',
  'failure',
  'insight',
  'profile',
];

/** 条目状态三值闭集（active 在册 | dismissed 有否决者终态 | expired TTL 物化终态——06 §3） */
export type MemoryStatus = 'active' | 'dismissed' | 'expired';

/** 状态三值闭集单源 */
export const MEMORY_STATUSES: readonly MemoryStatus[] = ['active', 'dismissed', 'expired'];

/* ---------------- 常量（缺省值单源——06 §3/§5 起草值） ---------------- */

/** 模糊合并 Jaccard 阈值（Mercury 实证档 0.74——Jaccard 交并比钉死，落码定形注） */
export const MEMORY_FUZZY_JACCARD_THRESHOLD = 0.74;

/** 极性冲突去极性后 Jaccard 阈值（同主题判据——06 §5 分支 3） */
export const MEMORY_POLARITY_JACCARD_THRESHOLD = 0.5;

/** source_refs 并集去重上限（血缘继承同罩——06 §5 血缘继承段「50 条上限」） */
export const MEMORY_SOURCE_REFS_CAP = 50;

/** summary 硬帽（合并比较面与 FTS 索引面的合理量级——起草值随实测调） */
export const MEMORY_SUMMARY_MAX_CHARS = 2_000;

/** content 硬帽（注入用全文——与 summary 同律起草值） */
export const MEMORY_CONTENT_MAX_CHARS = 64_000;

/* ---------------- 数据形 ---------------- */

/** 溯源引用（铁律 5——谁在什么时候基于哪几条事件记了什么） */
export interface MemorySourceRef {
  readonly sessionId: string;
  readonly seq: number;
}

/**
 * 入库候选（四写点汇入的统一形——06 §8.1 入库单点）：
 * §4 即时路纠正提取 / §4 周期路 review 候选 / memory_write 直写 / 导入直插。
 */
export interface MemoryCandidate {
  /** 归属范围：'global' | 'project:<根路径哈希>'（两层——06 §3 owner_key 条） */
  readonly ownerKey: string;
  readonly kind: MemoryKind;
  /** 一句话摘要——合并与冲突判定的比较面 */
  readonly summary: string;
  /** 全文（注入用） */
  readonly content: string;
  /** 0..1 置信度（合并取 max——保强证据不被均值稀释） */
  readonly confidence: number;
  /** 溯源到事件（候选至少携带其产生来源；坏形拒） */
  readonly sourceRefs: readonly MemorySourceRef[];
}

/** memories 表行（列全量驼峰形——DAO 读面统一映射） */
export interface MemoryRow {
  readonly id: string;
  readonly ownerKey: string;
  readonly kind: MemoryKind;
  readonly summary: string;
  readonly content: string;
  readonly confidence: number;
  readonly evidenceCount: number;
  readonly status: MemoryStatus;
  /** 终态来源记号：'auto_resolved' | 'user' | 'llm:<id>' | 'ttl' | 'skill:<名>'（active 行 NULL） */
  readonly supersededBy: string | null;
  readonly sourceRefs: readonly MemorySourceRef[];
  /** Unix 毫秒 */
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly usageCount: number;
  readonly lastUsedAt: number | null;
  /** 冻结位（恒简报/免 TTL/免合并覆写/免整理——0/1） */
  readonly frozen: boolean;
  /** 留存策略天数（NULL = 永久缺省） */
  readonly ttlDays: number | null;
  /** 过期钟（Unix 毫秒，NULL = 不过期） */
  readonly expiresAt: number | null;
}

/** memory_versions 表行（append-only 版本链） */
export interface MemoryVersionRow {
  readonly id: string;
  readonly memoryId: string;
  /** 条目内递增计数（1 起 = 插入即落首版） */
  readonly revision: number;
  /** 快照六列（与「版本链」触发清单严格同集——06 §3） */
  readonly ownerKey: string;
  readonly kind: MemoryKind;
  readonly summary: string;
  readonly content: string;
  readonly confidence: number;
  readonly evidenceCount: number;
  /** 'insert' | 'merge' | 'decay' | 'rollback'（闭集） */
  readonly cause: 'insert' | 'merge' | 'decay' | 'rollback';
  /** Unix 毫秒 */
  readonly createdAt: number;
}

/* ---------------- 三分支裁决面（merge.ts 纯函数产物） ---------------- */

/** 三分支标签（06 §5 插入时三分支——首中即断） */
export type MergeBranch = 'exact' | 'fuzzy' | 'polarity' | 'none';

/** 极性裁决胜负（高 confidence 胜、相等新胜——06 §5 分支 3） */
export type PolarityWinner = 'incoming' | 'existing';

/**
 * 对单条既有行的三分支裁决（纯函数产物——DAO 消费）。
 * branch='none' = 该行不参与（扫描继续下一行）。
 */
export interface MergeDecision {
  readonly branch: MergeBranch;
  /** 相似度值（exact 恒 1；fuzzy = Jaccard；polarity = 去极性后 Jaccard；none 携最近值仅供诊断） */
  readonly score: number;
  /** branch='polarity' 时的裁决胜负（其余分支缺席） */
  readonly winner?: PolarityWinner;
}

/* ---------------- 入库结局（回执可见面——不静默丢） ---------------- */

/** 入库单点结局四态（18c-1 面：提取两路/工具面/导入的回执词汇） */
export type IngestAction =
  /** 独立新条目插入（含极性新胜——新条入库、旧条 dismissed） */
  | 'inserted'
  /** 精确合并（同 owner+kind+summary 归一相等——evidence++ 吸收） */
  | 'merged-exact'
  /** 模糊合并（Jaccard ≥ 0.74 且非极性冲突——同上吸收） */
  | 'merged-fuzzy'
  /** 极性旧胜（旧条原位吸收候选证据与 refs——候选不另立条目，落码定形注对称面） */
  | 'polarity-kept-existing';

/** 入库结局（id = 存活权威条目 id；supersededId = 极性新胜时被 dismissed 的旧条） */
export interface IngestOutcome {
  readonly action: IngestAction;
  readonly id: string;
  readonly supersededId?: string;
}
