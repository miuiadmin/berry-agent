/**
 * 批 18c-8 导入导出件测试——port.ts 纯函数档（header/行解析判据、序列化
 * 确定性、isWithinRoots 同律对拍）+ runMemoryImport 真库全环（全列原值直插/
 * 版本链首版/FTS 投影/幂等跳过/secret 行拒/坏形行不弃批/header 整文件拒）+
 * 命令件（export 写文件+警示句+越界拒；import 幂等二跑；读面无根判定）。
 *
 * 真库全环（openStore + MEMORY_MIGRATIONS）；LLM 零参与（纯运维面）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import { BaseError } from '../contracts/index.js';
import { createMemoryDao, type MemoryDao } from './dao.js';
import { MEMORY_MIGRATIONS } from './migration.js';
import type { MemoryCandidate, MemoryExportHeader, MemoryExportRow, MemoryExportVersionRow } from './types.js';
import {
  buildMemoryExport,
  isWithinRoots,
  parseMemoryImportHeader,
  parseMemoryImportRow,
  runMemoryImport,
} from './port.js';
import { runMemoryExportCommand, runMemoryImportCommand, type MemoryExportCommandDeps } from './command.js';

let dir: string;
let store: Store | null = null;
let nowMs: number;
let idSeq = 0;
let dbSeq = 0;
const warns: string[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-memory-port-'));
  nowMs = Date.parse('2026-09-08T08:00:00.000Z');
  idSeq = 0;
  dbSeq = 0;
  warns.length = 0;
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 真库装配（uuid v7 拼形递增 id——升序断言的干净基线） */
function setup(): MemoryDao {
  dbSeq += 1;
  store = openStore({
    dbPath: join(dir, `test-${dbSeq}.db`),
    dataDir: dir,
    secretKey: ephemeralSecretKey(),
    migrations: [...MEMORY_MIGRATIONS],
  });
  return createMemoryDao({
    db: store.sqlite(),
    now: () => nowMs,
    warn: (m) => warns.push(m),
    newId: () => {
      idSeq += 1;
      const head = idSeq.toString(16).padStart(8, '0');
      return `${head}-0000-7000-8000-000000000000`;
    },
  });
}

/** 直改 memories 真身（制造终态/过期前置） */
function sql(statement: string, ...params: unknown[]): void {
  store!
    .sqlite()
    .prepare(statement)
    .run(...params);
}

/** 落一条 active 行（返回 id） */
function seed(dao: MemoryDao, overrides: Partial<MemoryCandidate> = {}): string {
  return dao.ingest({
    ownerKey: 'global',
    kind: 'fact',
    summary: `fact entry ${idSeq}`,
    content: `content of fact entry ${idSeq}`,
    confidence: 0.8,
    sourceRefs: [{ sessionId: 's1', seq: 1 }],
    ...overrides,
  }).id;
}

/** 线上行全列构造（override 面覆盖各形） */
function wireRow(overrides: Partial<MemoryExportRow> = {}): MemoryExportRow {
  idSeq += 1;
  return {
    id: `${idSeq.toString(16).padStart(8, '0')}-0000-7000-8000-000000000000`,
    owner_key: 'global',
    kind: 'insight',
    summary: 'imported lesson summary',
    content: 'imported lesson content body',
    confidence: 0.7,
    evidence_count: 2,
    status: 'active',
    superseded_by: null,
    source_refs: [{ sessionId: 's-origin', seq: 3 }],
    created_at: 1_700_000_000_000,
    updated_at: 1_700_000_000_000,
    usage_count: 0,
    last_used_at: null,
    frozen: false,
    ttl_days: null,
    expires_at: null,
    ...overrides,
  };
}

/** 好形 header 行 */
function headerLine(): string {
  return JSON.stringify({
    format: 'berry-agent-memory',
    formatVersion: 1,
    exportedAt: 1_700_000_000_000,
    ownerScope: 'all',
    ownerRoots: { global: '/origin/root' },
  });
}

/** 码精确断言（BaseError.message 不含码面——断言只认 code 本位） */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable(`应抛 ${code} 而未抛`);
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

describe('serializeMemoryExport / buildMemoryExport（导出面——确定性排列）', () => {
  it('header 五字段（magic/formatVersion/exportedAt/ownerScope/ownerRoots）+ 蛇列词面数据行', () => {
    const dao = setup();
    seed(dao);
    const text = buildMemoryExport(dao, { ownerRoots: { global: '/origin/root' }, now: nowMs });
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(2); // header + 一行
    const header = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(header).toMatchObject({
      format: 'berry-agent-memory',
      formatVersion: 2, // 批 ev-1 版本链随包升版（v1 判读收）
      exportedAt: nowMs,
      ownerScope: 'all',
      ownerRoots: { global: '/origin/root' },
    });
    const row = JSON.parse(lines[1]!) as Record<string, unknown>;
    expect(Object.keys(row)).toContain('owner_key'); // 蛇列词面与 DDL 同源
    expect(Object.keys(row)).toContain('evidence_count');
    expect(Object.keys(row)).toContain('source_refs');
    expect(Object.keys(row)).toContain('valid_from'); // 批 ev-1——导出恒写（值可 null）
    expect(Object.keys(row)).toContain('versions'); // 版本链随包（缺省空链也在场）
    expect(Object.keys(row)).not.toContain('ownerKey'); // 驼峰不入线形
    expect(Array.isArray(row['source_refs'])).toBe(true); // 解析形（非 JSON 字符串）
    expect(text.endsWith('\n')).toBe(true); // 尾行换行收口
  });

  it('全状态三值含 TTL 不可见行（恢复式备份语义）+ id 升序确定性 + owner 过滤腿', () => {
    const dao = setup();
    const activeId = seed(dao);
    const dismissedId = seed(dao, { summary: 'dismissed entry', content: 'dismissed body' });
    dao.forget(dismissedId);
    const invisibleId = seed(dao, { summary: 'ttl invisible entry', content: 'ttl body' });
    sql('UPDATE memories SET expires_at = ? WHERE id = ?', nowMs - 1, invisibleId); // 钟已过未物化
    const projectRow = seed(dao, {
      ownerKey: 'project:0123456789abcdef',
      summary: 'project entry',
      content: 'project body',
    });
    expect(dao.listVisible()).toHaveLength(2); // 前置——TTL 不可见行被读面遮蔽（active + frozen 谓词）

    const rows = dao.listForExport();
    expect(rows).toHaveLength(4); // 全状态现行值——读面谓词不适用于导出面
    expect(rows.map((r) => r.id)).toEqual([...rows.map((r) => r.id)].sort()); // id 升序
    expect(rows.map((r) => r.status).sort()).toEqual(['active', 'active', 'active', 'dismissed']);

    const projectOnly = dao.listForExport('project:0123456789abcdef');
    expect(projectOnly).toHaveLength(1);
    expect(projectOnly[0]!.id).toBe(projectRow);

    const text = buildMemoryExport(dao, { ownerRoots: {}, now: nowMs });
    expect(JSON.parse(text.trimEnd().split('\n')[0]!).ownerScope).toBe('all'); // 省略 = 全 owner
    expect(buildMemoryExport(dao, { ownerRoots: {}, now: nowMs })).toBe(text); // 同库同 now 两次导出恒等（可 diff）
    expect(activeId).toBeTruthy(); // 三 id 全数在场（lint 满）
    expect(invisibleId).toBeTruthy();
  });
});

describe('parseMemoryImportHeader（整文件拒判据——MEMORY_IMPORT_FORMAT_INVALID）', () => {
  it('好形过（五字段还原）；magic/formatVersion/meta 坏形均整文件拒', () => {
    const header = parseMemoryImportHeader(headerLine());
    expect(header).toEqual({
      format: 'berry-agent-memory',
      formatVersion: 1,
      exportedAt: 1_700_000_000_000,
      ownerScope: 'all',
      ownerRoots: { global: '/origin/root' },
    } satisfies MemoryExportHeader);

    const bad = (line: string) => {
      expectCode(() => parseMemoryImportHeader(line), 'MEMORY_IMPORT_FORMAT_INVALID');
    };
    bad('not-json'); // 非 JSON
    bad('{}'); // 缺 magic/formatVersion
    bad(JSON.stringify({ format: 'other-format', formatVersion: 1 })); // magic 不符
    bad(JSON.stringify({ format: 'berry-agent-memory', formatVersion: 3 })); // 版本不符（批 ev-1 双收 {1,2}——3 起拒）
    bad(
      JSON.stringify({
        format: 'berry-agent-memory',
        formatVersion: 1,
        exportedAt: 'yesterday', // 坏形 meta
        ownerScope: 'all',
        ownerRoots: {},
      }),
    );
    bad(
      JSON.stringify({
        format: 'berry-agent-memory',
        formatVersion: 1,
        exportedAt: 1,
        ownerScope: 'all',
        ownerRoots: ['数组不是对照'], // ownerRoots 非对象
      }),
    );
  });
});

describe('parseMemoryImportRow（行级词法判定——MEMORY_ENTRY_INVALID 折 malformed）', () => {
  it('好行全列还原；坏形逐类拒（非 JSON/kind 越闭集/frozen 非布尔/ttl_days 0/source_refs 坏形）', () => {
    const row = parseMemoryImportRow(JSON.stringify(wireRow()), 2);
    expect(row.id).toBe('00000001-0000-7000-8000-000000000000');
    expect(row.source_refs).toEqual([{ sessionId: 's-origin', seq: 3 }]);

    const bad = (line: string) => {
      expectCode(() => parseMemoryImportRow(line, 2), 'MEMORY_ENTRY_INVALID');
    };
    bad('not-json');
    bad('[]');
    bad(JSON.stringify({ ...wireRow(), kind: 'wisdom' })); // 越七值闭集
    bad(JSON.stringify({ ...wireRow(), status: 'archived' })); // 越三值闭集
    bad(JSON.stringify({ ...wireRow(), confidence: 1.5 }));
    bad(JSON.stringify({ ...wireRow(), frozen: 1 })); // 0/1 整形不是布尔（线形取解析形）
    bad(JSON.stringify({ ...wireRow(), ttl_days: 0 }));
    bad(JSON.stringify({ ...wireRow(), evidence_count: 0 }));
    bad(JSON.stringify({ ...wireRow(), source_refs: '非数组' }));
    bad(JSON.stringify({ ...wireRow(), created_at: -1 }));
    const missing: Record<string, unknown> = { ...wireRow() };
    delete missing['expires_at']; // 列缺席
    bad(JSON.stringify(missing));
  });
});

describe('isWithinRoots（同律复用引证——skills 先例对拍）', () => {
  it('根内（等值/子路径）真；越界与前缀陷阱假（边界分隔符守卫）', () => {
    const root = join(dir, 'workspace');
    expect(isWithinRoots(root, [root])).toBe(true);
    expect(isWithinRoots(join(root, 'sub', 'export.jsonl'), [root])).toBe(true);
    expect(isWithinRoots(join(dir, 'elsewhere', 'export.jsonl'), [root])).toBe(false);
    expect(isWithinRoots(`${root}-evil/export.jsonl`, [root])).toBe(false); // /root-evil 非 /root 子路径
    expect(isWithinRoots(root, [])).toBe(false); // 无根恒拒
  });
});

describe('runMemoryImport（真库全环——恢复式语义）', () => {
  it('全列原值直插：状态列/superseded_by/计量列/frozen/ttl 原值保留；FTS 可检索；首版快照内容面取行原值、版本行用本库 now', () => {
    const dao = setup();
    const dismissed = wireRow({
      status: 'dismissed',
      superseded_by: 'skill:naming',
      usage_count: 3,
      last_used_at: 1_700_000_000_001,
    });
    const frozen = wireRow({ frozen: true, summary: 'frozen imported entry', content: 'frozen body' });
    const expired = wireRow({ status: 'expired', superseded_by: 'ttl' });
    const active = wireRow({ summary: 'searchable imported lesson', content: 'unique token zq-import-body' });
    const r = runMemoryImport(
      [headerLine(), ...[active, dismissed, frozen, expired].map((w) => JSON.stringify(w))].join('\n'),
      dao,
    );
    expect(r).toEqual({ inserted: 4, skippedExisting: 0, rejectedSecret: 0, rejectedMalformed: 0 });

    const d = dao.get(dismissed.id)!; // 终态行原值保留（get 不过滤）
    expect(d.status).toBe('dismissed');
    expect(d.supersededBy).toBe('skill:naming');
    expect(d.usageCount).toBe(3);
    expect(d.lastUsedAt).toBe(1_700_000_000_001);
    expect(dao.get(expired.id)!.status).toBe('expired');
    expect(dao.get(frozen.id)!.frozen).toBe(true);

    // FTS 投影同步（external-content——导入行可检索；search 只见 active 行〔frozen 谓词腿可见、终态行遮蔽〕）
    expect(dao.search('zq-import-body').map((h) => h.id)).toEqual([active.id]);
    expect(dao.search('frozen body').map((h) => h.id)).toEqual([frozen.id]); // frozen 行检索可见（谓词首段短路）
    expect(dao.search('imported lesson content')).toHaveLength(0); // dismissed/expired 终态行检索遮蔽
  });

  it('id 已在整行跳过（零合并零覆写）；幂等二跑全 skippedExisting；版本链只此一条 insert 首版', () => {
    const source = setup();
    seed(source);
    seed(source, { summary: 'second entry', content: 'second body' });
    const text = buildMemoryExport(source, { ownerRoots: {}, now: nowMs });

    const target = setup();
    const first = runMemoryImport(text, target);
    expect(first.inserted).toBe(2);
    const second = runMemoryImport(text, target); // 同文件二跑
    expect(second).toEqual({ inserted: 0, skippedExisting: 2, rejectedSecret: 0, rejectedMalformed: 0 });

    // 首版快照：内容面取导入行原值、cause='insert'、created_at = 本库 now（时间线不自外来钟）
    for (const row of target.listForExport()) {
      const versions = target.versions(row.id);
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        revision: 1,
        cause: 'insert',
        createdAt: nowMs,
        ownerKey: row.ownerKey,
        summary: row.summary,
        content: row.content,
        confidence: row.confidence,
        evidenceCount: row.evidenceCount,
      });
    }
  });

  it('行级四账尽力而为：secret 行拒写/坏形行不弃批/好行照插；诊断不回写疑似密钥本体', () => {
    const dao = setup();
    const secret = wireRow({
      summary: '泄漏的键 sk-abcdefghijklmnopqrst',
      content: 'body with sk-abcdefghijklmnopqrst inside',
    });
    const malformed = JSON.stringify({ ...wireRow(), kind: 'wisdom' });
    const good = wireRow({ summary: 'good row', content: 'good body' });
    const text = [headerLine(), JSON.stringify(secret), malformed, JSON.stringify(good), ''].join('\n'); // 尾空行宽容
    const r = runMemoryImport(text, dao);
    expect(r).toEqual({ inserted: 1, skippedExisting: 0, rejectedSecret: 1, rejectedMalformed: 1 });
    expect(dao.get(secret.id)).toBeUndefined(); // 拒写未落库
    expect(dao.get(good.id)).toBeDefined(); // 坏行不弃批——好行照插
    expect(warns.some((w) => w.includes('secret 扫描命中拒写') && !w.includes('sk-abcdefghijklmnopqrst'))).toBe(true); // 说面不说值
  });

  it('header 坏形整文件拒（无行落库）；空文件拒；纯 header 零行零账', () => {
    const dao = setup();
    const good = wireRow();
    const badHeader = JSON.stringify({ format: 'wrong', formatVersion: 1 });
    expectCode(
      () => runMemoryImport([badHeader, JSON.stringify(good)].join('\n'), dao),
      'MEMORY_IMPORT_FORMAT_INVALID',
    );
    expect(dao.get(good.id)).toBeUndefined(); // 整文件拒——好行也不落
    expectCode(() => runMemoryImport('', dao), 'MEMORY_IMPORT_FORMAT_INVALID'); // 空文件
    expect(runMemoryImport(headerLine(), dao)).toEqual({
      inserted: 0,
      skippedExisting: 0,
      rejectedSecret: 0,
      rejectedMalformed: 0,
    }); // 纯 header
  });
});

describe('命令件（/memory-export · /memory-import——守卫错折文本）', () => {
  /** 导出命令装配（可写根 = 本测试目录） */
  function exportDeps(dao: MemoryDao): MemoryExportCommandDeps {
    return {
      dao,
      writableRoots: () => [dir],
      ownerRoots: () => ({ global: '/origin/root' }),
      now: () => nowMs,
    };
  }

  it('export 写文件 + header ownerRoots 注入 + 明文警示句；越界拒折 MEMORY_EXPORT_ROOT_DENIED 文本', async () => {
    const dao = setup();
    seed(dao);
    seed(dao, { summary: 'second entry', content: 'second body' });
    const target = join(dir, 'export.jsonl');
    const out = await runMemoryExportCommand([target], exportDeps(dao));
    expect(out).toContain('已导出 2 条记忆');
    expect(out).toContain('按敏感数据保管'); // 敏感警示句（06 §3 导出文案）
    const text = readFileSync(target, 'utf8');
    expect(JSON.parse(text.split('\n')[0]!).ownerRoots).toEqual({ global: '/origin/root' }); // 装配闭包注入位
    expect(text.trimEnd().split('\n')).toHaveLength(3);

    // 越界拒（可写根外路径——isWithinRoots 判定折文本不抛）
    const denied = await runMemoryExportCommand(['/definitely/not/writable/export.jsonl'], exportDeps(dao));
    expect(denied).toContain('MEMORY_EXPORT_ROOT_DENIED');
    // 缺路径 → USAGE
    expect(await runMemoryExportCommand([], exportDeps(dao))).toContain('用法：/memory-export');
  });

  it('import 全环：export → 新库导入 → 幂等二跑回执；读面无根判定（根外路径照读）；坏 header 折文本', async () => {
    const source = setup();
    seed(source);
    const file = join(dir, 'roundtrip.jsonl');
    writeFileSync(file, buildMemoryExport(source, { ownerRoots: {}, now: nowMs }), 'utf8');

    const target = setup();
    const first = await runMemoryImportCommand([file], { dao: target }); // 命令 deps 无 writableRoots——读面无根判定
    expect(first).toContain('新插 1 条');
    const second = await runMemoryImportCommand([file], { dao: target });
    expect(second).toContain('已在跳过 1 条'); // 恢复式幂等二跑
    expect(second).not.toContain('新插 1 条');

    const badFile = join(dir, 'bad.jsonl');
    writeFileSync(badFile, '{"format":"wrong"}\n', 'utf8');
    const denied = await runMemoryImportCommand([badFile], { dao: target });
    expect(denied).toContain('MEMORY_IMPORT_FORMAT_INVALID'); // 整文件拒折文本
    expect(await runMemoryImportCommand([], { dao: target })).toContain('用法：/memory-import');
  });
});

describe('批 ev-1 版本链随包导出与 v1 判读收', () => {
  /** 随包版本行（override 面覆盖各形——蛇列与 MemoryExportVersionRow 同源） */
  function versionRow(overrides: Partial<MemoryExportVersionRow> = {}): MemoryExportVersionRow {
    idSeq += 1;
    return {
      id: `ver-${idSeq}`,
      revision: 1,
      cause: 'insert',
      reason: null,
      owner_key: 'global',
      kind: 'insight',
      summary: 'imported lesson summary',
      content: 'imported lesson content body',
      confidence: 0.7,
      evidence_count: 2,
      created_at: 1_700_000_000_500,
      ...overrides,
    };
  }

  it('种子 b：导出行内嵌 versions 链（cause/reason/快照蛇列全列）', () => {
    const dao = setup();
    const keepId = seed(dao);
    const dropId = seed(dao, { summary: 'merged duplicate summary', content: 'dup body' });
    dao.absorb(keepId, dropId, '同主题重复');
    const text = buildMemoryExport(dao, { ownerRoots: {}, now: nowMs });
    const row = JSON.parse(text.trimEnd().split('\n')[1]!) as Record<string, unknown>;
    expect(Array.isArray(row['versions'])).toBe(true);
    const versions = row['versions'] as Record<string, unknown>[];
    expect(versions).toHaveLength(2); // insert + merge
    expect(versions[0]!['cause']).toBe('insert');
    expect(versions[0]!['reason']).toBeNull();
    expect(versions[1]!['cause']).toBe('merge');
    expect(versions[1]!['reason']).toBe('同主题重复');
    expect(versions[1]!['owner_key']).toBe('global'); // 蛇列词面与 DDL 同源
    expect(versions[1]!['evidence_count']).toBe(2); // 证据合并后的快照值
  });

  it('导入链原值直搬（revision 不重排、created_at 不自造钟）+ restore(revision) 跨机互操作 + 幂等二跑含链', () => {
    const dao = setup();
    const chain = [
      versionRow({ revision: 3, cause: 'insert' }),
      versionRow({ revision: 5, cause: 'decay', reason: '老化' }),
    ];
    const row = wireRow({ versions: chain });
    const text = [headerLine(), JSON.stringify(row)].join('\n') + '\n';
    expect(runMemoryImport(text, dao)).toEqual({
      inserted: 1,
      skippedExisting: 0,
      rejectedSecret: 0,
      rejectedMalformed: 0,
    });
    const versions = dao.versions(row.id);
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.revision)).toEqual([3, 5]); // 原值直搬——restore 参数跨机互操作前提
    expect(versions[1]!.reason).toBe('老化');
    expect(versions[1]!.createdAt).toBe(1_700_000_000_500); // 历史事实不自外来钟
    // restore 到导入链 revision（跨机往返后回滚面可用——next revision = max+1 = 6）
    const restored = dao.restore(row.id, 5);
    expect(restored.status).toBe('active');
    expect(dao.versions(row.id).at(-1)!.cause).toBe('rollback');
    expect(dao.versions(row.id).at(-1)!.revision).toBe(6);
    // 幂等二跑：id 已在整行跳过含链（版本行不重复）
    expect(runMemoryImport(text, dao)).toEqual({
      inserted: 0,
      skippedExisting: 1,
      rejectedSecret: 0,
      rejectedMalformed: 0,
    });
    expect(dao.versions(row.id)).toHaveLength(3); // 直搬 2 + rollback 1——跳过不追加
  });

  it('v1 旧件判读收：formatVersion=1 + 无 valid_from/versions 键不折坏形（首版快造用本库钟）', () => {
    const dao = setup();
    const v1Row = wireRow(); // wireRow 基形即 v1 18 列——无 valid_from/versions
    const text = [headerLine(), JSON.stringify(v1Row)].join('\n') + '\n'; // headerLine 恒 formatVersion=1
    expect(runMemoryImport(text, dao)).toEqual({
      inserted: 1,
      skippedExisting: 0,
      rejectedSecret: 0,
      rejectedMalformed: 0,
    });
    const row = dao.get(v1Row.id)!;
    expect(row.validFrom).toBeNull(); // 缺席按 NULL 收
    const versions = dao.versions(v1Row.id);
    expect(versions).toHaveLength(1); // 无链 → 首版快造
    expect(versions[0]!.cause).toBe('insert');
    expect(versions[0]!.revision).toBe(1);
    expect(versions[0]!.createdAt).toBe(nowMs); // 本库时间线不自外来钟
    // formatVersion=3 越界整文件拒（双收闭集外）
    const badHeader = JSON.stringify({ ...JSON.parse(headerLine()), formatVersion: 3 });
    expectCode(() => parseMemoryImportHeader(badHeader), 'MEMORY_IMPORT_FORMAT_INVALID');
  });

  it('versions 坏形行拒：revision 重复 / cause 非闭集 / reason 非串（行级 MEMORY_ENTRY_INVALID）', () => {
    const dup = wireRow({ versions: [versionRow({ revision: 2 }), versionRow({ revision: 2 })] });
    expectCode(() => parseMemoryImportRow(JSON.stringify(dup), 2), 'MEMORY_ENTRY_INVALID');
    const badCause = wireRow({ versions: [versionRow({ cause: 'manual' as MemoryExportVersionRow['cause'] })] });
    expectCode(() => parseMemoryImportRow(JSON.stringify(badCause), 2), 'MEMORY_ENTRY_INVALID');
    const badReason = wireRow({ versions: [versionRow({ reason: 7 as unknown as string })] });
    expectCode(() => parseMemoryImportRow(JSON.stringify(badReason), 2), 'MEMORY_ENTRY_INVALID');
  });
});
