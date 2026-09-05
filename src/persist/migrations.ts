/**
 * persist — 统一迁移框架（05 篇 §6.4）。
 *
 * 迁移函数注册表在 persist（宿主固定件），插件不注册迁移；core: 插件表族
 * （memory 记忆表 / goal 表 / scheduler jobs 表）的建表/升级声明由 host 装配根
 * **机械聚合**传入 openStore——迁移链仍是单链，声明来自插件、执行在宿主。
 * 本批只有框架 + v1 基线；首个业务迁移项随对应插件落码批进场。
 */

/**
 * 迁移项。注册时校验：version 必须大于基线 SCHEMA_VERSION、逐项严格递增、
 * version/name/sql 三字段齐备——违反即抛（装配期错误，不入库不改库）。
 */
export interface MigrationSpec {
  /** 目标 user_version（> 基线 SCHEMA_VERSION；决定补跑顺序） */
  readonly version: number;
  /** 迁移名（诊断用，如 'memory-tables'——与声明方对应） */
  readonly name: string;
  /**
   * DDL/数据迁移文本（单事务执行；DDL 须含表/索引/触发器全部对象；纯数据
   * 迁移〔UPDATE/DELETE〕无 schema 产物也合法）。
   */
  readonly sql: string;
}

/**
 * 校验并排序迁移链（开库前调用一次——装配错误在任何库文件被碰之前抛出）。
 * 规则：全部 version > 基线版本、严格递增无重复、sql 非空。
 * @param migrations 聚合的迁移项（顺序无关，按 version 排序后返回）
 * @param baseVersion 基线 SCHEMA_VERSION（迁移链起点）
 * @returns 按 version 升序的迁移链
 */
export function normalizeMigrations(migrations: readonly MigrationSpec[], baseVersion: number): MigrationSpec[] {
  const seen = new Set<number>();
  const out: MigrationSpec[] = [];
  for (const m of migrations) {
    if (!Number.isInteger(m.version) || m.version <= baseVersion) {
      throw new Error(`迁移项 ${m.name || '(未具名)'}：version=${m.version} 必须是大于基线 ${baseVersion} 的整数`);
    }
    if (!m.name || typeof m.name !== 'string') {
      throw new Error(`迁移项 version=${m.version}：name 缺失`);
    }
    if (typeof m.sql !== 'string' || m.sql.trim() === '') {
      throw new Error(`迁移项 ${m.name}（v${m.version}）：sql 为空`);
    }
    if (seen.has(m.version)) {
      throw new Error(`迁移项 version=${m.version} 重复（${m.name}）——每个版本至多一项迁移`);
    }
    seen.add(m.version);
    out.push(m);
  }
  out.sort((a, b) => a.version - b.version);
  return out;
}
