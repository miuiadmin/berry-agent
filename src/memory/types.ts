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

/* 持有面/检索面常量（批 18c-2——06 §7 工具九件；起草值随实测调） */

/** 检索行帽缺省 / 硬帽（memory_search） */
export const MEMORY_SEARCH_DEFAULT_LIMIT = 10;
export const MEMORY_SEARCH_MAX_LIMIT = 50;

/** 访问日志流水面行帽缺省 / 硬帽（memory_access_log） */
export const MEMORY_ACCESS_LOG_DEFAULT_LIMIT = 50;
export const MEMORY_ACCESS_LOG_MAX_LIMIT = 200;

/** 访问聚合面 top-N（「top-N 被用条目」——06 §7 access_log 行） */
export const MEMORY_ACCESS_AGGREGATE_TOP_N = 20;

/** 晋升搬家技能名词法（06 §7 forget 行 promotedToSkill——与技能侧 name 校验同源的纯字面量档） */
export const MEMORY_SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** 晋升搬家技能名帽（≤64） */
export const MEMORY_SKILL_NAME_MAX = 64;

/** memory_read 最近变更腿行数（updated_at DESC） */
export const MEMORY_RECENT_LIMIT = 5;

/** 天 → 毫秒换算单源（ttl_days / expires_at 重算共用） */
export const MEMORY_DAY_MS = 86_400_000;

/* 注入面常量（批 18c-4——06 §6 两路；起草值随实测调） */

/** 常驻简报段固定标记（memory/core 具名段的包裹锚——prompt 侧锚点） */
export const MEMORY_BRIEF_MARKER = '<!-- memory:core -->';

/** 常驻简报字符限额（约值——只约竞争面，frozen 免限额恒全收） */
export const MEMORY_BRIEF_CHAR_LIMIT = 2000;

/** 常驻简报竞争面行数帽（top N——「取 top N」的 N 值起草档） */
export const MEMORY_BRIEF_TOP_N = 20;

/** 未用强排除阈值天数（§5 效用维度——30 天管常驻面；frozen 免） */
export const MEMORY_BRIEF_STALE_DAYS = 30;

/** TTL 临近阈值天数（06 §6 条目行时效标注——p-1 批：expires_at 距今 ≤ 此值时注入行复合「TTL剩M天」段） */
export const MEMORY_TTL_SOON_DAYS = 7;

/** 按需检索 query 帽（当轮 user 消息作为检索 query 的资格条件——超长不入检） */
export const MEMORY_RECALL_QUERY_MAX_CHARS = 200;

/** 按需检索注入条数（top-k 缺省 3） */
export const MEMORY_RECALL_TOP_K = 3;

/** 按需检索 kind 优先重排候选池倍数（一次取款覆盖 kind 重排的候选面——起草值） */
export const MEMORY_RECALL_POOL_FACTOR = 4;

/** 检索注入自定义角色名（04 运行时骨架自定义角色机制——装配面包装 hidden/toLlm，件内只出常量与文本） */
export const MEMORY_RECALL_ROLE = 'memory/recall';

/* 周期路/整理面常量（批 18c-5——06 §4/§5/§4.1 起草值） */

/** 周期路触发阈值：turn/end 计数（两阈值任一达标即触发后台 review） */
export const MEMORY_REVIEW_TURN_THRESHOLD = 10;

/** 周期路触发阈值：tool/call 计数 */
export const MEMORY_REVIEW_TOOL_CALL_THRESHOLD = 15;

/** 周期路审阅窗：最近 N 个 turn（fetchEvents 切片窗——窗内转录喂 LLM） */
export const MEMORY_REVIEW_WINDOW_TURNS = 10;

/** 周期路候选置信度缺省（弱于即时路纠正 0.7——review 是推断性提取） */
export const MEMORY_REVIEW_CONFIDENCE = 0.6;

/** consolidation 老化阈值天数（updated_at 超此入候选集） */
export const MEMORY_CONSOLIDATION_STALE_DAYS = 90;

/** owner 容量上限（TTL 可见行数超此 → 低分盈余入候选；**永不因满拒写**） */
export const MEMORY_OWNER_CAPACITY = 500;

/** consolidation 拍间最小间隔毫秒（anchor 护栏——防抖） */
export const MEMORY_CONSOLIDATION_ANCHOR_MS = 5 * 60_000;

/** decay 降权因子（confidence × factor——起草值随实测调） */
export const MEMORY_DECAY_FACTOR = 0.7;

/**
 * polluted 判据缺省表（'*' 通配——06 §4.1 落码定形注起草值）：
 * 'fetch'/'mcp' 精确名 + '*__*' = MCP 复合键全族（`server__tool`——服务器键
 * 无下划线，'__' 子串即复合键指纹）。
 */
export const MEMORY_POLLUTION_DEFAULT_PATTERNS: readonly string[] = ['fetch', 'mcp', '*__*'];

/* ---------------- 周期路/整理面类型（批 18c-5） ---------------- */

/**
 * review 五类候选 kind 闭集（06 §4 周期路——LLM 提取面）：correction 为
 * 即时路专有（确定性触发词）、profile 为用户画像面专有，均不在此列。
 */
export type ReviewKind = 'preference' | 'fact' | 'convention' | 'failure' | 'insight';

/** review kind 五值闭集单源（TypeBox schema 构建消费） */
export const REVIEW_KINDS: readonly ReviewKind[] = ['preference', 'fact', 'convention', 'failure', 'insight'];

/**
 * 会话资格态两值闭集（06 §4.1——eligible 入检 | polluted 跳过提取/审阅；
 * v1 = 进程内存态，重启回退 eligible——落码定形注）。
 */
export type SessionEligibility = 'eligible' | 'polluted';

/**
 * LLM 服务窄面（批 18c-5 词面独立律——memory 席 DAG 无 llm 边，LLM 能力
 * 经 deps 注入；结构兼容 host LlmService.complete/canAfford 子集——complete
 * 只用 systemPrompt/messages/priority 三参位，结果只用 message.content 文本
 * 面；canAfford 走 'background' 道查预算闸门。同 loop 只认 StreamFn 签名先例）。
 */
export interface MemoryLlmFace {
  complete(req: {
    systemPrompt?: string;
    messages: readonly { role: 'user'; content: string }[];
    priority?: 'background' | 'foreground';
  }): Promise<{ message: { content: string | readonly { type: string; text?: string }[] } }>;
  canAfford(priority: 'background' | 'foreground'): boolean;
}

/** LLM 回复文本面提取（string 直取；块数组拼 text 块——结构兼容双形） */
export function llmTextOf(content: string | readonly { type: string; text?: string }[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text)
    .join('\n');
}

/* ---------------- 跨会话检索面（批 18c-6——06 §10 落码定形注五则） ---------------- */

/** snippet 切窗：命中位前取字符数（06 §10 定形注②——前窗短后窗长） */
export const MEMORY_SNIPPET_BEFORE = 16;

/** snippet 切窗：命中位后取字符数（含命中词本身） */
export const MEMORY_SNIPPET_AFTER = 48;

/**
 * session_fts 跨会话命中行（05 §9 追记①——查询面限定解除变体的返回形；
 * body = 索引投影原文，snippet 由消费侧切窗）。
 */
export interface SessionFtsHit {
  readonly sessionId: string;
  readonly seq: number;
  readonly body: string;
}

/**
 * 跨会话检索 seam（词面独立律——结构兼容 persist Store 公开面
 * searchFtsGlobal：host 装配批直传 Store 真身，compat 互证见 fts.test）。
 */
export interface SessionFtsSearchFace {
  searchFtsGlobal(pattern: string, limit?: number): readonly SessionFtsHit[];
}

/** FTS 抽样审计结果（结构兼容 persist FtsAuditResult——05 §9 对账第三档） */
export interface FtsAuditReport {
  readonly checked: number;
  readonly mismatches: readonly { sessionId: string; expected: number; actual: number }[];
}

/** FTS 全量重建结果（结构兼容 persist FtsRebuildResult——派生物重建即修复） */
export interface FtsRebuildReport {
  readonly sessions: number;
  readonly events: number;
}

/**
 * session_fts 维护 seam（词面独立律——结构兼容 persist Store 公开面
 * auditFts/rebuildFts 两法：策略位在 memory〔激活期对账触发 + 缺口即重建〕，
 * 物理原语住 persist〔05 §9 追记②维护归属映射〕）。
 */
export interface FtsMaintenanceFace {
  auditFts(sampleCount?: number): FtsAuditReport;
  rebuildFts(): FtsRebuildReport;
}

/* ---------------- 晋升候选与简报差分常量（批 18c-7——06 §9.1/§6） ---------------- */

/** 晋升候选 kind 集（§9.1——「反复命中才值得固化」的三 kind；preference/fact 等不点名） */
export const MEMORY_PROMOTION_KINDS: readonly MemoryKind[] = ['failure', 'insight', 'convention'];

/** 晋升候选行数帽（§9.1「取 top 3」——起草值随实测调） */
export const MEMORY_PROMOTION_TOP_N = 3;

/** 晋升候选判据：evidence_count 下限（≥2 = 反复命中；起草值随实测调） */
export const MEMORY_PROMOTION_EVIDENCE_MIN = 2;

/** 晋升候选判据：usage_count 下限（cite 是比 recall/search 流水更强的效用信号——单次即够格） */
export const MEMORY_PROMOTION_USAGE_MIN = 1;

/**
 * 晋升候选判据：证据来源会话多样数下限（§9.1 跨会话维——2026-09-08 消化批；
 * source_refs 溯源面纯派生零新账）。命名循冷读闸观察注：**证据来源**会话多样数，
 * 非 cite 使用命中面——单会话重复命中多为同一任务重试，跨会话独立复现才是
 * 可迁移策略（disjoint 泛化的个人化最小形态）。
 */
export const MEMORY_PROMOTION_DISTINCT_SESSIONS_MIN = 2;

/** 简报差分纪元表容量帽（per-session epochs Map LRU——§6 差分纪律；被逐纪元下一请求懒派生） */
export const MEMORY_DIFF_EPOCHS_LRU = 256;

/** 回看缓存容量帽（per-session 最近 assistant 文本 Map LRU——§4 即时路第二动作；帽族同 §6 epochs 256） */
export const MEMORY_LAST_ASSISTANT_TEXT_LRU = 256;

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
  /**
   * 留存策略天数（可选——标记即算 expires_at，06 §7 memory_write 扩参）。
   * 落码定形注：仅在独立插入腿（inserted / 极性新胜）生效；合并吸收腿不动
   * 既有条目的持有策略（既有条目策略保持——receipt 面 action 可见合并结局）。
   */
  readonly ttlDays?: number | null;
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
  /**
   * 被纠正负效用次数（§3 corrected-cite 投影——cite 正账对冲的负账，
   * ≡ corrected-cite 行数；2026-09-08 消化批，存量库经 v9 迁移补列）。
   */
  readonly correctedCount: number;
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

/* ---------------- 持有面动词与检索面（批 18c-2——06 §6/§7 工具九件的数据面） ---------------- */

/**
 * 访问操作四值闭集（06 §6 四写点：recall 注入 / search 检索 / cite 引用回写 /
 * corrected-cite 纠正负效用回写〔§4 即时路——2026-09-08 消化批〕）
 */
export type MemoryAccessOp = 'recall' | 'search' | 'cite' | 'corrected-cite';

/** 检索命中行（memory_fts FTS5——18c-2 域 = 记忆库腿；跨会话 union 腿归 18c-6） */
export interface MemorySearchHit {
  readonly id: string;
  readonly ownerKey: string;
  readonly kind: MemoryKind;
  readonly summary: string;
  /** FTS bm25 rank 原值（负值——越小越相关；结果已按此升序） */
  readonly score: number;
}

/** 检索选项（owner 解析归装配面——模型不感知哈希键） */
export interface MemorySearchOptions {
  /** owner 并集过滤（缺省 = 全库） */
  readonly ownerKeys?: readonly string[];
  readonly kind?: MemoryKind;
  /** 行帽（缺省 10、硬帽 50） */
  readonly limit?: number;
  /**
   * 命中流水落账 op（缺省 'search'；按需检索注入路注入 'recall'——06 §6 三写点
   * 单 DAO 实现律：两路共用同一检索原语，只在流水面分账）。
   */
  readonly accessOp?: 'search' | 'recall';
  /** 流水会话归位（缺省 null——工具上下文无会话键；检索注入路带当轮会话键） */
  readonly accessSessionId?: string | null;
}

/** 健康面计数（memory_read 与 /memory 管理面共源——按状态逐状态取数，全库不分 owner 假精度） */
export interface MemoryHealthCounts {
  readonly active: number;
  readonly dismissed: number;
  readonly expired: number;
  readonly frozen: number;
  readonly total: number;
}

/** memory_read 无 id 腿的整面返回（常驻简报取数基础版 + 最近变更 + 健康面） */
export interface MemoryReadOverview {
  /**
   * 常驻简报面：frozen 恒驻在前、其余按效用综合分降序（§5 一把尺）。
   * 18c-2 = 取数基础版；§6 权威简报 builder（消毒/限额/指纹/差分）随 18c-4。
   */
  readonly core: readonly MemoryRow[];
  /** 最近变更（updated_at DESC top 5） */
  readonly recent: readonly MemoryRow[];
  readonly health: MemoryHealthCounts;
}

/** 访问日志查询面（聚合 + 流水双面——06 §7 memory_access_log） */
export interface MemoryAccessLogQuery {
  /** 条目 id 或 id 前缀（缺省 = 全库） */
  readonly memoryIdPrefix?: string;
  /** 时间窗下界（epoch 毫秒，含） */
  readonly from?: number;
  /** 时间窗上界（epoch 毫秒，含） */
  readonly to?: number;
  /** op 过滤（缺省 = 四值全量） */
  readonly op?: MemoryAccessOp;
  /** 流水面行帽（缺省 50、硬帽 200） */
  readonly limit?: number;
}

/** 访问流水行（memory_access 表行——蛇 ↔ 驼峰映射面） */
export interface MemoryAccessFlowRow {
  readonly id: string;
  readonly memoryId: string;
  readonly op: MemoryAccessOp;
  /** 会话归位（search 工具行恒 NULL——工具上下文无会话键；recall 检索注入行带当轮会话键〔18c-4〕） */
  readonly sessionId: string | null;
  /** Unix 毫秒 */
  readonly ts: number;
}

/** 访问聚合行（条目 × 三 op 计数——「top-N 被用条目」面） */
export interface MemoryAccessAggregate {
  readonly memoryId: string;
  readonly summary: string;
  readonly recall: number;
  readonly search: number;
  readonly cite: number;
  readonly total: number;
}

/** 访问日志双面返回 */
export interface MemoryAccessLogResult {
  /** 聚合面（total 降序 top 20——同查询窗内） */
  readonly aggregates: readonly MemoryAccessAggregate[];
  /** 流水面（ts 降序、行帽内） */
  readonly flow: readonly MemoryAccessFlowRow[];
}

/* ---------------- 简报差分面（批 18c-7——06 §6 差分纪律） ---------------- */

/** 差分三态（ASCII——'+' 新入 / '~' 内容变更 / '-' 退场；'~' 无在位写路径预置） */
export type MemoryDiffOp = '+' | '~' | '-';

/** 差分条目（durable 载荷行——id 为**短 id**：注入派生只呈现短面，被引用经 cite 前缀归责计数） */
export interface MemoryDiffEntry {
  readonly op: MemoryDiffOp;
  /** 短 id（8 hex——注入行 [m:] 标记同源） */
  readonly id: string;
  readonly kind: MemoryKind;
  readonly summary: string;
}

/** memory/diff durable 事件载荷（全量差分 last-wins + 落账时权威面指纹） */
export interface MemoryDiffData {
  readonly entries: readonly MemoryDiffEntry[];
  /** 事件落账时权威面指纹（sha256 前 16 hex——重放 last-wins 指纹匹配判据） */
  readonly fingerprint: string;
}

/** 简报权威面三元组（基线/指纹/差分共用的比较面——quoted 呈现层注记不进面） */
export interface BriefFaceEntry {
  readonly id: string;
  readonly kind: MemoryKind;
  readonly summary: string;
}

/* ---------------- 持有面收口与导入导出（批 18c-8——06 §3 落码定形注） ---------------- */

/**
 * 访问日志滚动窗口天数（06 §3 访问日志条「留存 = 滚动窗口（起草 90 天）」单源）：
 * 流水是可丢弃审计面——窗口清扫只删 memory_access 行，聚合列
 * usage_count/last_used_at 不随清扫回退。
 */
export const MEMORY_ACCESS_WINDOW_DAYS = 90;

/** 导出文件 magic 串（对外声明值位——品牌词例外律；持久互操作标识第一天定死） */
export const MEMORY_EXPORT_MAGIC = 'berry-agent-memory';

/** 导出格式版本（formatVersion 非 version——版本链语境下 version 会被读成数据版本） */
export const MEMORY_EXPORT_FORMAT_VERSION = 1;

/**
 * 导出文件首行 header meta（06 §3 导入导出条）。ownerScope = 'all' 或单
 * owner 键（命令 owner 省略 = 全 owner——header 记实际范围）；ownerRoots =
 * owner 键 → 原始根路径对照（project 键为根路径哈希不可逆——跨机承接链必需，
 * 注入位 = 命令 deps 装配闭包）。
 */
export interface MemoryExportHeader {
  readonly format: typeof MEMORY_EXPORT_MAGIC;
  readonly formatVersion: typeof MEMORY_EXPORT_FORMAT_VERSION;
  /** Unix 毫秒 */
  readonly exportedAt: number;
  readonly ownerScope: string;
  readonly ownerRoots: Record<string, string>;
}

/**
 * JSONL 数据行（蛇列名单源——与 DDL 列名同源的持久互操作词面；值形取
 * 解析形：source_refs 为数组非 JSON 字符串、frozen 为布尔非 0/1）。
 * 全状态现行值（active/dismissed/expired 三值）按 id 升序确定性排列。
 */
export interface MemoryExportRow {
  readonly id: string;
  readonly owner_key: string;
  readonly kind: MemoryKind;
  readonly summary: string;
  readonly content: string;
  readonly confidence: number;
  readonly evidence_count: number;
  readonly status: MemoryStatus;
  readonly superseded_by: string | null;
  readonly source_refs: readonly MemorySourceRef[];
  readonly created_at: number;
  readonly updated_at: number;
  readonly usage_count: number;
  readonly last_used_at: number | null;
  /**
   * 被纠正负效用次数（**容错位**——2026-09-08 消化批入列 17 → 18 列；导出恒写，
   * 导入缺席按 DEFAULT 0 收〔旧 17 列文件〕、在场须非负整数）。
   */
  readonly corrected_count?: number;
  readonly frozen: boolean;
  readonly ttl_days: number | null;
  readonly expires_at: number | null;
}

/** 导入行级四账（恢复式运维动词尽力而为 + 回执如实分账——坏形行不弃批） */
export interface MemoryImportOutcome {
  readonly inserted: number;
  readonly skippedExisting: number;
  readonly rejectedSecret: number;
  readonly rejectedMalformed: number;
}
