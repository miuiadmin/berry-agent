/**
 * session_fts 消费件（批 18c-6——06 §10 + 05 §9 追记）：激活期对账策略位
 * （ensureFtsIndex）+ snippet 切窗纯函数（snippetOf）。
 *
 * **维护归属映射**（05 §9 追记②——结构对账住 persist / 策略位与消费位住
 * core:memory）：写入档同批同事务与删除档已是 persist 写路径的结构性组成
 * （「单事件原子」免费成立），本件只持**策略位**——激活期触发抽样审计、
 * 发现缺口即全量重建（派生物不修不补，重建即修复）；装配面（host 装配根）
 * 在 memory 装载序激活时调用一次。
 *
 * **词面独立律**：FtsMaintenanceFace / SessionFtsSearchFace 均为结构兼容
 * persist Store 公开面的窄 seam——host 装配批直传 Store 真身，compat 互证
 * 见 fts.test（真 Store 全环）。
 */
import {
  MEMORY_SNIPPET_AFTER,
  MEMORY_SNIPPET_BEFORE,
  type FtsAuditReport,
  type FtsMaintenanceFace,
  type FtsRebuildReport,
} from './types.js';

/* ---------------- snippet 切窗（纯函数） ---------------- */

/**
 * 命中 body 切 snippet（06 §10 定形注②）：命中位前 {@link MEMORY_SNIPPET_BEFORE}
 * 后 {@link MEMORY_SNIPPET_AFTER} 字符、截断端补省略号；命中词大小写不敏感
 * 定位（trigram 分词器大小写不折叠对齐——lowercase 双侧比对）；命中词缺席
 * （理论不至——trigram 子串语义下查询必为 body 子串；防御位）退化为 body
 * 头窗。查询词先消毒（剥引号——与检索侧字符串字面量包裹同族的用户输入面）。
 */
export function snippetOf(body: string, query: string): string {
  const sanitized = query.replaceAll('"', ' ').trim();
  const lowerBody = body.toLowerCase();
  const idx = sanitized === '' ? -1 : lowerBody.indexOf(sanitized.toLowerCase());
  if (idx < 0) {
    // 防御位：无命中词可定位——头窗呈现（前 BEFORE+AFTER 字符）
    const head = body.slice(0, MEMORY_SNIPPET_BEFORE + MEMORY_SNIPPET_AFTER);
    return head.length < body.length ? `${head}…` : head;
  }
  const start = Math.max(0, idx - MEMORY_SNIPPET_BEFORE);
  const end = Math.min(body.length, idx + sanitized.length + MEMORY_SNIPPET_AFTER);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < body.length ? '…' : '';
  return `${prefix}${body.slice(start, end)}${suffix}`;
}

/* ---------------- 激活期对账（策略位） ---------------- */

/** ensureFtsIndex 依赖 */
export interface EnsureFtsDeps {
  /** 维护 seam（结构兼容 persist Store——host 装配批直传） */
  readonly face: FtsMaintenanceFace;
  /** 抽样会话数（缺省 8——与 persist auditFts 缺省对齐） */
  readonly sampleCount?: number;
  /** 进程日志（缺省静默） */
  readonly warn?: (message: string) => void;
}

/** 激活期对账结案报告 */
export interface FtsEnsureReport {
  /** 抽样对账结果（checked/mismatches 原样透传——观测面） */
  readonly audit: FtsAuditReport;
  /** 重建结果（缺口在场时执行；缺席 = 无需修复） */
  readonly rebuilt?: FtsRebuildReport;
}

/**
 * 激活期对账（memory 装载序调用一次）：抽样审计 → 有缺口即全量重建
 * （05 §9 对账三档第三档消费位——派生物不修不补，重建即修复）。
 * 永不抛——对账失败不阻断装载（warn 吞，索引退化可检索面降级不致命）。
 */
export function ensureFtsIndex(deps: EnsureFtsDeps): FtsEnsureReport {
  const warn = deps.warn ?? (() => {});
  try {
    const audit = deps.face.auditFts(deps.sampleCount);
    if (audit.mismatches.length === 0) return { audit };
    warn(
      `session_fts 抽样对账发现缺口（${audit.mismatches.length}/${audit.checked} 会话）——全量重建：` +
        audit.mismatches.map((m) => `${m.sessionId} 期望 ${m.expected} 实有 ${m.actual}`).join('；'),
    );
    return { audit, rebuilt: deps.face.rebuildFts() };
  } catch (error) {
    warn(`session_fts 激活期对账失败（尽力而为跳过）：${error instanceof Error ? error.message : String(error)}`);
    return { audit: { checked: 0, mismatches: [] } };
  }
}
