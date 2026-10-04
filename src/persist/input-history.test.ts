/**
 * 分项目输入历史测试（B1 持久化批——05 §9 input_history / 07 §4.1 呈现面
 * 件 2 B1 定形注）。
 *
 * 六面：迁移项形（v14 占号 + STRICT 五列 DDL 准绳 + 迁移链注册过闸）/
 * record 读写往返（trim 空不入·连续去重〔同域 top-1 全等·隔条同文再录真
 * 入册〕·sessionId 溯源列往返·跨进程去重衔接〔库侧同判兜底〕）/ recentTexts
 * 读序（新→旧序·limit 参数与缺省帽）/ 按域隔离（双域互不串·A 域去重不
 * 吞 B 域首条）/ 按域帽 100（越帽即删·**域 B 不被 A 域挤删**——ZCode 全库
 * 帽跨项目互挤 quirk 的修正锁）/ 全新库基线路（bootstrapped 标记走基线 +
 * v2..head 补跑，input_history 由迁移腿建就——N10 全新库谱不误走备份腿）。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { INPUT_HISTORY_MIGRATION, createInputHistoryFace, type InputHistoryFace } from './input-history.js';
import { normalizeMigrations } from './migrations.js';
import { openStore, type Store } from './index.js';

let dir: string;
let stores: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-input-history-test-'));
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 开真库并构造输入历史面（input_history 表由迁移链建就——HOST_MIGRATION_TAIL 聚合形） */
function openFace(clock?: () => number, dbPath?: string): { store: Store; face: InputHistoryFace } {
  const store = openStore({
    dataDir: join(dir, 'data'),
    ...(dbPath !== undefined ? { dbPath } : {}),
    migrations: [INPUT_HISTORY_MIGRATION],
  });
  stores.push(store);
  return { store, face: createInputHistoryFace(store.connection, clock) };
}

describe('迁移项形（v14 占号——sessions 档案 v13 之后顺延）', () => {
  it('version 14 / name / STRICT 五列 DDL 准绳齐备', () => {
    expect(INPUT_HISTORY_MIGRATION.version).toBe(14);
    expect(INPUT_HISTORY_MIGRATION.name).toBe('input-history');
    const sql = INPUT_HISTORY_MIGRATION.sql;
    expect(sql).toContain('STRICT');
    for (const column of ['id', 'workspace_root', 'session_id', 'text', 'created_at']) {
      expect(sql).toContain(column);
    }
    // 域键索引（05 §9：索引 (workspace_root, id DESC)——按域选取键）
    expect(sql).toContain('INDEX');
    expect(sql).toContain('workspace_root, id DESC');
  });

  it('迁移链注册过闸（normalizeMigrations 接受且升序居尾）', () => {
    expect(() => normalizeMigrations([INPUT_HISTORY_MIGRATION], 1)).not.toThrow();
    const chain = normalizeMigrations([INPUT_HISTORY_MIGRATION], 1);
    expect(chain).toHaveLength(1);
    expect(chain[0]?.version).toBe(14);
  });

  it('全新库基线路：建库即含 input_history（bootstrapped 标记走基线 + 迁移腿补跑，非备份腿）', () => {
    const { store } = openFace(undefined, join(dir, 'data', 'sessions.db'));
    // 表由迁移腿建就（正典 DDL 不折此表——建表在各自迁移的表族先例）
    const tables = store.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'input_history'")
      .all() as { name: string }[];
    expect(tables).toHaveLength(1);
    // 域键索引同腿建就
    const indexes = store.connection
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_input_history_domain'")
      .all() as { name: string }[];
    expect(indexes).toHaveLength(1);
    // 链头推进到位（user_version = 14）
    expect(store.connection.pragma('user_version', { simple: true })).toBe(14);
    // 库文件真在场（:memory: 诊断形之外的真数据目录形态）
    expect(existsSync(join(dir, 'data', 'sessions.db'))).toBe(true);
  });
});

describe('record 读写往返', () => {
  it('trim 空不入（返 false 零行）', () => {
    const { face } = openFace();
    expect(face.record({ workspaceRoot: '/ws/a', text: '   \n\t ' })).toBe(false);
    expect(face.recentTexts('/ws/a')).toEqual([]);
  });

  it('真入册往返：recentTexts 新→旧序、返 true', () => {
    const { face } = openFace();
    expect(face.record({ workspaceRoot: '/ws/a', text: ' first ' })).toBe(true);
    expect(face.record({ workspaceRoot: '/ws/a', text: 'second' })).toBe(true);
    // 读面取 trim 后正文（与编辑器内存史同语义——入册集恒为 trim 形）
    expect(face.recentTexts('/ws/a')).toEqual(['second', 'first']);
  });

  it('连续去重：同域 top-1 全等返 false 不落行；隔条同文再录真入册', () => {
    const { face } = openFace();
    face.record({ workspaceRoot: '/ws/a', text: 'same' });
    // 连续重复（top-1 全等）——库侧同判兜底（跨进程首条衔接同此闸）
    expect(face.record({ workspaceRoot: '/ws/a', text: 'same' })).toBe(false);
    expect(face.recentTexts('/ws/a')).toEqual(['same']);
    // 隔条后再录同文 = 真入册（连续语义非全局去重——与内存史同语义）
    face.record({ workspaceRoot: '/ws/a', text: 'other' });
    expect(face.record({ workspaceRoot: '/ws/a', text: 'same' })).toBe(true);
    expect(face.recentTexts('/ws/a')).toEqual(['same', 'other', 'same']);
  });

  it('sessionId 溯源列往返（NULL 允许——记录时点聚焦会话、非选取键）', () => {
    const { store, face } = openFace();
    face.record({ workspaceRoot: '/ws/a', sessionId: 'sess-1', text: 'with-session' });
    face.record({ workspaceRoot: '/ws/a', text: 'no-session' });
    const rows = store.connection.prepare('SELECT session_id, text FROM input_history ORDER BY id DESC').all() as {
      session_id: string | null;
      text: string;
    }[];
    expect(rows).toEqual([
      { session_id: null, text: 'no-session' },
      { session_id: 'sess-1', text: 'with-session' },
    ]);
    // 溯源非选取键：recentTexts 不按 session 过滤（域内全体召回）
    expect(face.recentTexts('/ws/a')).toEqual(['no-session', 'with-session']);
  });

  it('created_at = epoch 毫秒（挂钟注入——与 sessions 同单位）', () => {
    const { store, face } = openFace(() => 1_760_000_000_000);
    face.record({ workspaceRoot: '/ws/a', text: 'timed' });
    const rows = store.connection.prepare('SELECT created_at FROM input_history').all() as { created_at: number }[];
    expect(rows[0]?.created_at).toBe(1_760_000_000_000);
  });

  it('跨进程去重衔接：重开面（同库）后首录与库 top-1 同文返 false', () => {
    const { store, face } = openFace();
    face.record({ workspaceRoot: '/ws/a', text: 'persisted' });
    // 新 face 模拟新进程（内存史为空——库侧同判兜底跨进程首条）
    const reopened = createInputHistoryFace(store.connection);
    expect(reopened.record({ workspaceRoot: '/ws/a', text: 'persisted' })).toBe(false);
    expect(reopened.recentTexts('/ws/a')).toEqual(['persisted']);
  });
});

describe('recentTexts 读序与帽', () => {
  it('limit 参数生效；缺省 = 按域帽 100', () => {
    const { face } = openFace();
    for (let i = 1; i <= 5; i++) face.record({ workspaceRoot: '/ws/a', text: `t${i}` });
    expect(face.recentTexts('/ws/a', 2)).toEqual(['t5', 't4']);
    expect(face.recentTexts('/ws/a')).toEqual(['t5', 't4', 't3', 't2', 't1']);
  });

  it('无行域 → 空数组（诚实缺席）', () => {
    const { face } = openFace();
    expect(face.recentTexts('/ws/none')).toEqual([]);
  });
});

describe('按域隔离（域键 = workspace_root 列，非库键）', () => {
  it('双域互不串：A 域入册不影响 B 域读面', () => {
    const { face } = openFace();
    face.record({ workspaceRoot: '/ws/a', text: 'a-only' });
    face.record({ workspaceRoot: '/ws/b', text: 'b-only' });
    expect(face.recentTexts('/ws/a')).toEqual(['a-only']);
    expect(face.recentTexts('/ws/b')).toEqual(['b-only']);
  });

  it('A 域连续去重不吞 B 域首条（去重判据按域 top-1）', () => {
    const { face } = openFace();
    face.record({ workspaceRoot: '/ws/a', text: 'shared' });
    face.record({ workspaceRoot: '/ws/b', text: 'shared' });
    // A 域 top-1 = 'shared' 全等 → false；B 域同文非 A 域判据
    expect(face.record({ workspaceRoot: '/ws/a', text: 'shared' })).toBe(false);
    expect(face.recentTexts('/ws/b')).toEqual(['shared']);
  });
});

describe('按域帽 100（ZCode 全库帽跨项目互挤 quirk 修正锁）', () => {
  it('A 域越帽即删：域内恰存最新 100、最旧溢出条不复活', () => {
    const { face } = openFace();
    for (let i = 1; i <= 105; i++) face.record({ workspaceRoot: '/ws/a', text: `a${i}` });
    const texts = face.recentTexts('/ws/a');
    expect(texts).toHaveLength(100);
    expect(texts[0]).toBe('a105');
    expect(texts[99]).toBe('a6'); // a1..a5 已越帽删除
    // 帽删除真删非软删——溢出条不在库
    const { store } = { store: stores[0]! };
    const count = (store.connection.prepare('SELECT COUNT(*) AS c FROM input_history').get() as { c: number }).c;
    expect(count).toBe(100);
  });

  it('A 域灌帽不挤删 B 域行（delete 子查询带域过滤——修正锁）', () => {
    const { face } = openFace();
    face.record({ workspaceRoot: '/ws/b', text: 'b-early' });
    for (let i = 1; i <= 105; i++) face.record({ workspaceRoot: '/ws/a', text: `a${i}` });
    // B 域行存活（ZCode 形 delete-not-in-top-100 无域过滤会跨项目误删）
    expect(face.recentTexts('/ws/b')).toEqual(['b-early']);
    // A 域照常帽内
    expect(face.recentTexts('/ws/a')).toHaveLength(100);
  });
});
