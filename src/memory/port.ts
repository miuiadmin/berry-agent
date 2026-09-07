/**
 * memory 导入导出件（批 18c-8——06 §3 文件导入导出条 + 落码定形注）。
 *
 * **格式**：JSONL + 首行 header meta（magic 串 `berry-agent-memory`、
 * formatVersion 1——第一天定死不留旧格式兼容层）；数据行 = 蛇列名全列
 * （与 DDL 同源的持久互操作词面），全状态现行值按 id 升序确定性排列（可 diff）。
 *
 * **导入 = 恢复式语义**：按 id 幂等（无此 id 直插；有则跳过零合并零覆写）；
 * 行级尽力而为四账（inserted/skippedExisting/rejectedSecret/
 * rejectedMalformed——坏形行不弃批，整文件拒只留给 header 坏形
 * MEMORY_IMPORT_FORMAT_INVALID）。secret 扫描与三写事务在 DAO
 * importInsert 单点执法（导入面即写入面）。
 *
 * 可写根判定 isWithinRoots **同律复用引证**：函数体拷贝自 skills/manage.ts
 * 先例（memory 与 skills 无 DAG 边不引 import——漂移由对拍测试互证；
 * SKILLS_WRITE_ROOT_DENIED / FS_OUTSIDE_WRITABLE_ROOTS 同律先例）。
 */
import { resolve, sep } from 'node:path';
import { BaseError } from '../contracts/index.js';
import {
  MEMORY_EXPORT_FORMAT_VERSION,
  MEMORY_EXPORT_MAGIC,
  MEMORY_KINDS,
  MEMORY_STATUSES,
  type MemoryExportHeader,
  type MemoryExportRow,
  type MemoryImportOutcome,
  type MemoryRow,
  type MemorySourceRef,
} from './types.js';

/** memory DAO 窄面（词面独立律——port 只消费导出取数与导入直插两法） */
export interface MemoryPortDaoFace {
  listForExport(ownerKey?: string): readonly MemoryRow[];
  importInsert(row: MemoryExportRow): boolean;
}

/**
 * 可写根判定（导出落盘路径越界拒——resolve 归一 + 边界分隔符守卫）。
 * 同律复用引证：拷贝自 skills/manage.ts isWithinRoots，语义钉死同款——
 * 根本体等于路径或以 `<root>/` 开头才算界内（`/root-x` 不在 `/root` 内）。
 */
export function isWithinRoots(path: string, roots: readonly string[]): boolean {
  const abs = resolve(path);
  return roots.some((root) => {
    const base = resolve(root);
    return abs === base || abs.startsWith(base + sep);
  });
}

/** 驼峰行 → 蛇列 JSONL 行（词面与 DDL 同源；值形取解析形——source_refs 数组、frozen 布尔） */
export function exportRowOf(row: MemoryRow): MemoryExportRow {
  return {
    id: row.id,
    owner_key: row.ownerKey,
    kind: row.kind,
    summary: row.summary,
    content: row.content,
    confidence: row.confidence,
    evidence_count: row.evidenceCount,
    status: row.status,
    superseded_by: row.supersededBy,
    source_refs: row.sourceRefs,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    usage_count: row.usageCount,
    last_used_at: row.lastUsedAt,
    frozen: row.frozen,
    ttl_days: row.ttlDays,
    expires_at: row.expiresAt,
  };
}

/**
 * 导出序列化纯函数（header + 行按入参序确定性输出——同库两次导出文本
 * 恒等除 exportedAt；行已由 DAO 按 id 升序取数）。尾行换行收口（POSIX 文本件惯例）。
 */
export function serializeMemoryExport(
  meta: Omit<MemoryExportHeader, 'format' | 'formatVersion'>,
  rows: readonly MemoryRow[],
): string {
  const header: MemoryExportHeader = {
    format: MEMORY_EXPORT_MAGIC,
    formatVersion: MEMORY_EXPORT_FORMAT_VERSION,
    ...meta,
  };
  return [JSON.stringify(header), ...rows.map((row) => JSON.stringify(exportRowOf(row)))].join('\n') + '\n';
}

/** header 坏形整文件拒（唯一 MEMORY_IMPORT_FORMAT_INVALID 抛点——判据：magic 不符或 formatVersion ≠ 1 或 meta 字段坏形） */
function invalidHeader(detail: string): BaseError {
  return new BaseError('MEMORY_IMPORT_FORMAT_INVALID', `导入文件 header 坏形整文件拒（${detail}）`);
}

/** 首行 header 解析（magic/formatVersion/exportedAt/ownerScope/ownerRoots 五字段全检） */
export function parseMemoryImportHeader(line: string): MemoryExportHeader {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw invalidHeader('首行非 JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidHeader('首行非对象');
  }
  const o = parsed as Record<string, unknown>;
  if (o['format'] !== MEMORY_EXPORT_MAGIC) throw invalidHeader(`magic 串不符：${String(o['format'])}`);
  if (o['formatVersion'] !== MEMORY_EXPORT_FORMAT_VERSION) {
    throw invalidHeader(`formatVersion ≠ ${MEMORY_EXPORT_FORMAT_VERSION}：${String(o['formatVersion'])}`);
  }
  if (!Number.isInteger(o['exportedAt']) || (o['exportedAt'] as number) < 0) {
    throw invalidHeader(`exportedAt 坏形（非负整数）：${String(o['exportedAt'])}`);
  }
  if (typeof o['ownerScope'] !== 'string' || o['ownerScope'] === '') {
    throw invalidHeader(`ownerScope 坏形：${String(o['ownerScope'])}`);
  }
  const roots = o['ownerRoots'];
  if (roots === null || typeof roots !== 'object' || Array.isArray(roots)) {
    throw invalidHeader('ownerRoots 坏形（对象形）');
  }
  for (const [key, value] of Object.entries(roots)) {
    if (typeof value !== 'string') throw invalidHeader(`ownerRoots[${key}] 坏形（字符串值）：${String(value)}`);
  }
  return {
    format: MEMORY_EXPORT_MAGIC,
    formatVersion: MEMORY_EXPORT_FORMAT_VERSION,
    exportedAt: o['exportedAt'] as number,
    ownerScope: o['ownerScope'] as string,
    ownerRoots: roots as Record<string, string>,
  };
}

/** 行坏形（MEMORY_ENTRY_INVALID——行级宽容分账 rejectedMalformed，不弃批） */
function invalidRow(lineNo: number, problems: string): BaseError {
  return new BaseError('MEMORY_ENTRY_INVALID', `导入行坏形（第 ${lineNo} 行）：${problems}`);
}

/** 非负整数判定（时间戳/计数字段共用） */
function isNonNegInt(v: unknown): boolean {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0;
}

/**
 * 数据行解析（词法判定全清单——17 列在场 + 类型 + 闭集 + 区间）。
 * 行级坏形抛 MEMORY_ENTRY_INVALID（与 ingest 坏形同码——runMemoryImport
 * 折 rejectedMalformed 分账）。
 */
export function parseMemoryImportRow(line: string, lineNo: number): MemoryExportRow {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw invalidRow(lineNo, '非 JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidRow(lineNo, '非对象');
  }
  const o = parsed as Record<string, unknown>;
  const problems: string[] = [];
  const str = (key: string): string | undefined => {
    const v = o[key];
    if (typeof v !== 'string' || v === '') {
      problems.push(`${key} 坏形（非空字符串）`);
      return undefined;
    }
    return v;
  };
  const id = str('id');
  const ownerKey = str('owner_key');
  const summary = str('summary');
  const content = str('content');
  const kind = o['kind'];
  if (typeof kind !== 'string' || !MEMORY_KINDS.includes(kind as MemoryExportRow['kind'])) {
    problems.push(`kind 非七值闭集：${String(kind)}`);
  }
  const status = o['status'];
  if (typeof status !== 'string' || !MEMORY_STATUSES.includes(status as MemoryExportRow['status'])) {
    problems.push(`status 非三值闭集：${String(status)}`);
  }
  const confidence = o['confidence'];
  if (typeof confidence !== 'number' || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    problems.push(`confidence 越界 [0,1]：${String(confidence)}`);
  }
  const evidence = o['evidence_count'];
  if (!isNonNegInt(evidence) || (evidence as number) < 1)
    problems.push(`evidence_count 坏形（≥1 整数）：${String(evidence)}`);
  const supersededBy = o['superseded_by'];
  if (supersededBy !== null && typeof supersededBy !== 'string') {
    problems.push('superseded_by 坏形（字符串或 null）');
  }
  const refs = o['source_refs'];
  let sourceRefs: readonly MemorySourceRef[] = [];
  if (!Array.isArray(refs)) {
    problems.push('source_refs 坏形（数组）');
  } else {
    for (const [i, ref] of refs.entries()) {
      if (
        ref === null ||
        typeof ref !== 'object' ||
        typeof (ref as Record<string, unknown>)['sessionId'] !== 'string' ||
        (ref as Record<string, unknown>)['sessionId'] === '' ||
        !isNonNegInt((ref as Record<string, unknown>)['seq'])
      ) {
        problems.push(`source_refs[${i}] 坏形（{sessionId, seq} 形外）`);
        break;
      }
    }
    sourceRefs = refs as MemorySourceRef[];
  }
  if (!isNonNegInt(o['created_at'])) problems.push(`created_at 坏形（非负整数）：${String(o['created_at'])}`);
  if (!isNonNegInt(o['updated_at'])) problems.push(`updated_at 坏形（非负整数）：${String(o['updated_at'])}`);
  const usage = o['usage_count'];
  if (!isNonNegInt(usage)) problems.push(`usage_count 坏形（非负整数）：${String(usage)}`);
  const lastUsed = o['last_used_at'];
  if (lastUsed !== null && !isNonNegInt(lastUsed))
    problems.push(`last_used_at 坏形（非负整数或 null）：${String(lastUsed)}`);
  const frozen = o['frozen'];
  if (typeof frozen !== 'boolean') problems.push(`frozen 坏形（布尔）：${String(frozen)}`);
  const ttlDays = o['ttl_days'];
  if (ttlDays !== null && (!Number.isInteger(ttlDays) || (ttlDays as number) < 1)) {
    problems.push(`ttl_days 坏形（正整数或 null）：${String(ttlDays)}`);
  }
  const expiresAt = o['expires_at'];
  if (expiresAt !== null && !isNonNegInt(expiresAt)) {
    problems.push(`expires_at 坏形（非负整数或 null）：${String(expiresAt)}`);
  }
  if (problems.length > 0) throw invalidRow(lineNo, problems.join('；'));
  return {
    id: id!,
    owner_key: ownerKey!,
    kind: kind as MemoryExportRow['kind'],
    summary: summary!,
    content: content!,
    confidence: confidence as number,
    evidence_count: evidence as number,
    status: status as MemoryExportRow['status'],
    superseded_by: (supersededBy as string | null) ?? null,
    source_refs: sourceRefs,
    created_at: o['created_at'] as number,
    updated_at: o['updated_at'] as number,
    usage_count: usage as number,
    last_used_at: (lastUsed as number | null) ?? null,
    frozen: frozen as boolean,
    ttl_days: (ttlDays as number | null) ?? null,
    expires_at: (expiresAt as number | null) ?? null,
  };
}

/**
 * 恢复式导入编排（行级尽力而为四账）：首行 header 坏形整文件拒
 * （MEMORY_IMPORT_FORMAT_INVALID 唯一外抛位）；数据行逐条「解析 →
 * DAO importInsert（secret 扫描 + 三写事务单点执法）」——secret 命中折
 * rejectedSecret、行坏形折 rejectedMalformed、id 已在折 skippedExisting、
 * 落库成功计 inserted。空行宽容跳过（尾行换行/编辑器空行不折坏形）。
 */
export function runMemoryImport(text: string, dao: MemoryPortDaoFace): MemoryImportOutcome {
  const lines = text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) {
    throw invalidHeader('文件空（首行 header 缺席）');
  }
  parseMemoryImportHeader(lines[0]!);
  const outcome = { inserted: 0, skippedExisting: 0, rejectedSecret: 0, rejectedMalformed: 0 };
  for (const [index, line] of lines.slice(1).entries()) {
    const lineNo = index + 2; // 文件行号（1 起）——header 占首行
    try {
      const row = parseMemoryImportRow(line, lineNo);
      if (dao.importInsert(row)) outcome.inserted += 1;
      else outcome.skippedExisting += 1;
    } catch (err) {
      if (err instanceof BaseError && err.code === 'MEMORY_SECRET_DETECTED') outcome.rejectedSecret += 1;
      else if (err instanceof BaseError && err.code === 'MEMORY_ENTRY_INVALID') outcome.rejectedMalformed += 1;
      else throw err; // 非词法面异常照常外炸（DB/IO 错误不吞）
    }
  }
  return outcome;
}

/** 导出编排（取数 → 序列化——ownerKey 缺省 = 全 owner；ownerRoots 由命令 deps 装配闭包注入） */
export function buildMemoryExport(
  dao: MemoryPortDaoFace,
  opts: { ownerKey?: string; ownerRoots: Record<string, string>; now: number },
): string {
  const rows = dao.listForExport(opts.ownerKey);
  return serializeMemoryExport(
    { exportedAt: opts.now, ownerScope: opts.ownerKey ?? 'all', ownerRoots: opts.ownerRoots },
    rows,
  );
}
