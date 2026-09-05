/**
 * Store 测试——开库门禁序（版本链/备份/权限）/ schema 基线 / 事件写读 /
 * queryEvents 过滤维与游标 / FTS 对账三档 / store_state·credentials·
 * model_catalog·incidents 四小面（05 篇 §6/§9）。
 *
 * 分层纪律：真 better-sqlite3 临时目录库（非 mock 物理层——门禁序与事务
 * 语义只在真库上可断言）；词汇注册表用测试插件词补 FTS 索引面样本。
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseError, registerEventType, type SessionEvent } from '../contracts/index.js';
import { SessionLog } from '../session/index.js';
import { ephemeralSecretKey } from './secret-box.js';
import type { MigrationSpec } from './migrations.js';
import { openStore, type EventWrite, type SessionRegistration, type Store } from './store.js';

// 测试用 surface 类别插件词（FTS 索引面样本——词汇注册表 category 判据）
registerEventType({
  type: 'persist.test/note',
  category: 'surface',
  owner: 'persist.test',
  description: '测试用 surface 类别事件',
});

/** 断言抛指定码 */
function expectCode(fn: () => unknown, code: string): void {
  try {
    fn();
    expect.unreachable('未拒绝');
  } catch (err) {
    expect(err).toBeInstanceOf(BaseError);
    expect((err as BaseError).code).toBe(code);
  }
}

const REG: SessionRegistration = {
  origin: 'conversation',
  parentId: undefined,
  seedLength: 0,
  workspaceRoot: '/tmp/ws',
  title: undefined,
};

/** 造真事件（SessionLog 纯内存形态——信封形状与 seq 由 SessionLog 结构保证） */
function makeEvents(...specs: string[]): readonly SessionEvent[] {
  const log = new SessionLog({ sessionId: 'synthetic' });
  for (const text of specs) {
    log.append('turn/start', {});
    log.append('user/message', { content: text, source: 'user' });
  }
  return log.events();
}

/** 事件 → 写队列条目 */
function writesFor(
  sessionId: string,
  events: readonly SessionEvent[],
  registration: SessionRegistration = REG,
): EventWrite[] {
  return events.map((event) => ({ sessionId, event, registration }));
}

let dir: string;
let stores: Store[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-store-test-'));
  stores = [];
});

afterEach(() => {
  for (const store of stores) store.close();
  rmSync(dir, { recursive: true, force: true });
});

/** 开库助手（登记待关面 + 固定密钥注入避免测试目录撒密钥文件——secret-box 自有专测） */
function open(options: {
  dbPath: string;
  migrations?: readonly MigrationSpec[];
  warn?: (m: string) => void;
  clock?: () => number;
}): Store {
  const store = openStore({
    dbPath: options.dbPath,
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
    migrations: options.migrations,
    warn: options.warn,
    clock: options.clock,
  });
  stores.push(store);
  return store;
}

describe('开库门禁序（05 §6.4/§6.5）', () => {
  it('全新库：单事务建链——七对象在场 + user_version=1 + application_id 印记', () => {
    const store = open({ dbPath: join(dir, 'fresh.db') });
    expect(store.headVersion).toBe(1);
    const names = (
      store.connection
        .prepare(
          `SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY name`,
        )
        .all() as { name: string }[]
    ).map((r) => r.name);
    for (const expected of [
      'events',
      'sessions',
      'store_state',
      'credentials',
      'model_catalog',
      'session_fts',
      'persist_incidents',
      'idx_events_type',
      'idx_sessions_workspace',
      'idx_model_catalog_provider',
    ]) {
      expect(names).toContain(expected);
    }
    expect(store.connection.pragma('user_version', { simple: true })).toBe(1);
    expect(store.connection.pragma('application_id', { simple: true })).toBe(0x62616765);
  });

  it('重复打开：v=head 直通（无迁移无备份）', () => {
    const path = join(dir, 'reopen.db');
    const a = open({ dbPath: path });
    a.close();
    const b = open({ dbPath: path });
    expect(b.headVersion).toBe(1);
  });

  it('高于 head → PERSIST_SCHEMA_TOO_NEW 拒开', () => {
    const path = join(dir, 'future.db');
    const foreign = new Database(path);
    foreign.exec(`CREATE TABLE t (x); PRAGMA user_version = 99;`);
    foreign.close();
    expectCode(() => open({ dbPath: path }), 'PERSIST_SCHEMA_TOO_NEW');
  });

  it('非空库但 user_version=0 → PERSIST_SCHEMA_UNRECOGNIZED（宁拒绝不误读）', () => {
    const path = join(dir, 'foreign.db');
    const foreign = new Database(path);
    foreign.exec(`CREATE TABLE someone_elses (x TEXT);`);
    foreign.close();
    expectCode(() => open({ dbPath: path }), 'PERSIST_SCHEMA_UNRECOGNIZED');
  });

  it('缺口迁移：迁移前备份库文件 + 逐版升到 head（旧版库 → 升级 → 断言）', () => {
    const path = join(dir, 'migrate.db');
    const first = open({ dbPath: path });
    first.close();
    // 「v1 基线 + 迁移链头 2」模拟旧版库（v=1 < head=2 → 走迁移路）
    const migration = {
      version: 2,
      name: 'test-add-table',
      sql: `CREATE TABLE migrated_marker (id INTEGER PRIMARY KEY); INSERT INTO migrated_marker (id) VALUES (7);`,
    };
    const second = open({ dbPath: path, migrations: [migration] });
    expect(second.headVersion).toBe(2);
    expect(second.connection.pragma('user_version', { simple: true })).toBe(2);
    expect((second.connection.prepare(`SELECT id FROM migrated_marker`).get() as { id: number }).id).toBe(7);
    // 迁移前备份在场（.bak-v1）
    expect(existsSync(`${path}.bak-v1`)).toBe(true);
  });

  it('数据跨开库存活（WAL 落盘语义 + 退出 checkpoint 收卷）', () => {
    const path = join(dir, 'durable.db');
    const a = open({ dbPath: path });
    a.writeEvents(writesFor('s1', makeEvents('hello durable')));
    a.close();
    const b = open({ dbPath: path });
    expect(b.loadEvents('s1')).toHaveLength(2);
  });
});

describe('事件写读（05 §6.3 批写 + §4 完整性）', () => {
  it('批写落库 + loadEvents 全量往返（信封字段保真：surfaceOp/sourceEventSeqs）', () => {
    const store = open({ dbPath: join(dir, 'rw.db') });
    const log = new SessionLog({ sessionId: 'x' });
    log.append('turn/start', {});
    log.append('user/message', { content: 'hi', source: 'user' });
    log.appendWithSurfaceOp('persist.test/note', { text: '摘要' }, { op: 'replace', start: 0, end: 1 }, [0, 1]);
    store.writeEvents(writesFor('s-env', log.events()));
    const back = store.loadEvents('s-env');
    expect(back).toHaveLength(3);
    expect(back[2]!.surfaceOp).toEqual({ op: 'replace', start: 0, end: 1 });
    expect(back[2]!.sourceEventSeqs).toEqual([0, 1]);
  });

  it('写序违约 → PERSIST_DATA_CORRUPT（seq 跳号 fail-loud）', () => {
    const store = open({ dbPath: join(dir, 'order.db') });
    const events = makeEvents('a');
    expectCode(() => store.writeEvents(writesFor('s-order', [events[1]!])), 'PERSIST_DATA_CORRUPT');
  });

  it('游标后被占的 seq → SQLITE_CONSTRAINT 原样抛（writeEvents 面——毒丸分类归 write-behind）', () => {
    const path = join(dir, 'dupe.db');
    const store = open({ dbPath: path });
    const events = makeEvents('a', 'b'); // seq 0..3
    store.writeEvents(writesFor('s-dupe', events.slice(0, 2))); // 0..1 落库（游标推进到 1）
    // 外部连接抢占 seq=2（多连接竞速的最小形——单写者纪律靠 host 装配保证）
    const raw = new Database(path);
    raw.exec(
      `INSERT INTO events (session_id, seq, type, time, data, ignorable) VALUES ('s-dupe', 2, 'user/message', 0, '{}', 0)`,
    );
    raw.close();
    // Store 续写 seq=2：连续性断言通过（期望 2）但 PK 撞外部行 → 约束违例原样抛
    expect(() => store.writeEvents(writesFor('s-dupe', [events[2]!]))).toThrowError(/UNIQUE|CONSTRAINT/i);
  });

  it('撕裂尾 heal：末行 data 损坏 → 截断残卷 + warn + 前缀可读；追加续写不撞', () => {
    const path = join(dir, 'torn.db');
    const store = open({ dbPath: path });
    store.writeEvents(writesFor('s-torn', makeEvents('a', 'b'))); // seq 0..3
    store.close();
    // 外因损坏末行 data（模拟断电半写残卷）——坏位之后无行 = 撕裂尾
    const raw = new Database(path);
    raw.exec(`UPDATE events SET data = '{not-json' WHERE session_id = 's-torn' AND seq = 3`);
    raw.close();
    const warns: string[] = [];
    const healed = open({ dbPath: path, warn: (m) => warns.push(m) });
    const back = healed.loadEvents('s-torn');
    expect(back).toHaveLength(3); // seq 0..2 保留，3 号残卷截断
    expect(back.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(warns.join('\n')).toContain('撕裂尾截断');
    // 截断后续写 seq=3 不撞（游标已回退 + 行已删）
    const cont = new SessionLog({ sessionId: 's-torn', seed: back });
    cont.append('user/message', { content: 'after heal', source: 'user' });
    expect(() => healed.writeEvents(writesFor('s-torn', cont.events().slice(3)))).not.toThrow();
    expect(healed.loadEvents('s-torn')).toHaveLength(4);
  });

  it('中段损坏（坏行后仍有好行）→ PERSIST_DATA_CORRUPT 宁拒勿删', () => {
    const path = join(dir, 'midcorrupt.db');
    const store = open({ dbPath: path });
    store.writeEvents(writesFor('s-mid', makeEvents('a', 'b', 'c')));
    store.close();
    const raw = new Database(path);
    raw.exec(`UPDATE events SET data = '{bad' WHERE session_id = 's-mid' AND seq = 1`);
    raw.close();
    const reopened = open({ dbPath: path });
    expectCode(() => reopened.loadEvents('s-mid'), 'PERSIST_DATA_CORRUPT');
  });

  it('seq 洞（中段缺行）同样宁拒勿删', () => {
    const path = join(dir, 'hole.db');
    const store = open({ dbPath: path });
    store.writeEvents(writesFor('s-hole', makeEvents('a', 'b')));
    store.close();
    const raw = new Database(path);
    raw.exec(`DELETE FROM events WHERE session_id = 's-hole' AND seq = 1`);
    raw.close();
    const reopened = open({ dbPath: path });
    expectCode(() => reopened.loadEvents('s-hole'), 'PERSIST_DATA_CORRUPT');
  });
});

describe('sessions 行面', () => {
  it('首写登记身份列 + 后续只推进（血缘首登为准不回改）', () => {
    const store = open({ dbPath: join(dir, 'sessions.db') });
    const reg: SessionRegistration = { ...REG, parentId: 'p-1', seedLength: 3, origin: 'fork', title: '初名' };
    // 同一日志分两批写（seq 连续——批界不是会话界）
    const log = new SessionLog({ sessionId: 'row' });
    log.append('turn/start', {});
    log.append('user/message', { content: 'a', source: 'user' });
    store.writeEvents(writesFor('s-row', log.events(), reg));
    // 后续批以不同登记快照写——身份列不被覆盖
    const reg2: SessionRegistration = { ...REG, title: '改名' };
    log.append('turn/start', {});
    log.append('user/message', { content: 'b', source: 'user' });
    store.writeEvents(writesFor('s-row', log.events().slice(2), reg2));
    const row = store.getSessionRow('s-row');
    expect(row?.origin).toBe('fork');
    expect(row?.parentId).toBe('p-1');
    expect(row?.seedLength).toBe(3);
    expect(row?.title).toBe('初名');
    expect(row?.lastSeq).toBe(3);
    // 标题独立更新面
    expect(store.updateSessionTitle('s-row', '新标题')).toBe(true);
    expect(store.getSessionRow('s-row')?.title).toBe('新标题');
    expect(store.updateSessionTitle('s-ghost', 'x')).toBe(false);
  });

  it('registerSessionRow 先行落行（空种子形态）+ 不与后续写冲突', () => {
    const store = open({ dbPath: join(dir, 'reg.db') });
    store.registerSessionRow('s-reg', { ...REG, title: '先行' });
    const row = store.getSessionRow('s-reg');
    expect(row?.title).toBe('先行');
    expect(row?.lastSeq).toBe(-1); // -1 = 无事件（与游标起点一致——首事件 seq 0 可直写）
    // 后续事件写沿用写路径 upsert（身份列不被覆盖、last_seq 推进）
    store.writeEvents(writesFor('s-reg', makeEvents('a').slice(0, 1)));
    expect(store.getSessionRow('s-reg')?.lastSeq).toBe(0);
    expect(store.getSessionRow('s-reg')?.title).toBe('先行');
  });

  it('listSessions workspaceRoot 过滤 + updated_at 倒序', () => {
    let clock = 1_000;
    const s = open({ dbPath: join(dir, 'list.db'), clock: () => clock });
    const regA: SessionRegistration = { ...REG, workspaceRoot: '/ws/a' };
    const regB: SessionRegistration = { ...REG, workspaceRoot: '/ws/b' };
    s.writeEvents(writesFor('sa', makeEvents('a1'), regA));
    clock = 2_000;
    s.writeEvents(writesFor('sb', makeEvents('b1'), regB));
    clock = 3_000;
    s.writeEvents(writesFor('sa2', makeEvents('a2'), regA));
    const inA = s.listSessions({ workspaceRoot: '/ws/a' });
    expect(inA.map((r) => r.id)).toEqual(['sa2', 'sa']); // 最新写在前
    expect(s.listSessions()).toHaveLength(3);
    expect(s.listSessions()[0]!.id).toBe('sa2');
  });

  it('deleteSession 三删同事务（events/fts/行）', () => {
    const store = open({ dbPath: join(dir, 'del.db') });
    store.writeEvents(writesFor('s-del', makeEvents('findme')));
    expect(store.searchSessionFts('s-del', 'findme')).toHaveLength(1);
    expect(store.deleteSession('s-del')).toBe(true);
    expect(store.getSessionRow('s-del')).toBeUndefined();
    expect(store.queryEvents({ sessionId: 's-del' }).events).toHaveLength(0);
    expect(store.searchSessionFts('s-del', 'findme')).toHaveLength(0);
    expect(store.deleteSession('s-del')).toBe(false);
  });
});

describe('queryEvents（05 §3.4 过滤维 + 游标）', () => {
  it('全维过滤 + 分页游标续页', () => {
    const store = open({ dbPath: join(dir, 'query.db') });
    store.writeEvents(writesFor('s-q', makeEvents('one', 'two', 'three'))); // 6 条
    store.writeEvents(writesFor('s-o', makeEvents('other'), { ...REG, workspaceRoot: '/ws/2' })); // 2 条
    // 类型维
    expect(store.queryEvents({ types: ['user/message'] }).events).toHaveLength(4);
    // 会话维 + seq 窗
    const window = store.queryEvents({ sessionId: 's-q', fromSeq: 2, toSeq: 3 });
    expect(window.events.map((e) => e.seq)).toEqual([2, 3]);
    // 分页：limit 3 → 三页收齐（8 条），游标 null 终
    const page1 = store.queryEvents({ limit: 3 });
    expect(page1.events).toHaveLength(3);
    expect(page1.nextCursor).not.toBeNull();
    const page2 = store.queryEvents({ limit: 3, cursor: page1.nextCursor });
    expect(page2.nextCursor).not.toBeNull();
    const page3 = store.queryEvents({ limit: 3, cursor: page2.nextCursor });
    expect(page3.nextCursor).toBeNull();
    const rest = page1.events.concat(page2.events, page3.events);
    expect(rest).toHaveLength(8);
    // 全量与无过滤查询对齐（次序一致）
    expect(store.queryEvents({}).events).toEqual(rest);
    // 坏游标 fail-loud
    expectCode(() => store.queryEvents({ cursor: 'garbage!' }), 'PERSIST_DATA_CORRUPT');
  });

  it('时间窗过滤（sinceMs/untilMs 闭区间语义）', () => {
    let clock = 1_000;
    const store = open({ dbPath: join(dir, 'time.db'), clock: () => clock });
    const log = new SessionLog({ sessionId: 't', clock: () => clock });
    log.append('user/message', { content: 'early', source: 'user' }); // t=1000
    clock = 2_000;
    log.append('user/message', { content: 'mid', source: 'user' }); // t=2000
    clock = 3_000;
    log.append('user/message', { content: 'late', source: 'user' }); // t=3000
    store.writeEvents(writesFor('s-time', log.events()));
    const mid = store.queryEvents({ sessionId: 's-time', sinceMs: 2_000, untilMs: 2_000 });
    expect(mid.events).toHaveLength(1);
    expect((mid.events[0]!.data as { content: string }).content).toBe('mid');
  });
});

describe('session_fts 对账三档（05 §9）', () => {
  it('写入档：surface 事件入索引 + 遮蔽指令同批删区间行', () => {
    const store = open({ dbPath: join(dir, 'fts.db') });
    const log = new SessionLog({ sessionId: 'f' });
    log.append('turn/start', {});
    log.append('user/message', { content: '唯一可搜文本 needle-in-haystack', source: 'user' });
    store.writeEvents(writesFor('s-fts', log.events()));
    expect(store.searchSessionFts('s-fts', 'needle-in-haystack')).toEqual([1]);
    // 遮蔽 [0,1] → fts 区间行删除（含被遮事件）
    log.appendWithSurfaceOp(
      'persist.test/note',
      { text: 'replacement summary' },
      { op: 'replace', start: 0, end: 1 },
      [0, 1],
    );
    store.writeEvents(writesFor('s-fts', [log.events()[2]!]));
    expect(store.searchSessionFts('s-fts', 'needle-in-haystack')).toEqual([]);
    expect(store.searchSessionFts('s-fts', 'replacement summary')).toEqual([2]);
  });

  it('log-only 类别不入索引（索引面 = surface 判据）', () => {
    const store = open({ dbPath: join(dir, 'ftscat.db') });
    const log = new SessionLog({ sessionId: 'f' });
    log.append('approval/asked', { prompt: 'audit-only-text-should-not-index' });
    store.writeEvents(writesFor('s-cat', log.events()));
    expect(store.searchSessionFts('s-cat', 'audit-only-text-should-not-index')).toEqual([]);
  });

  it('重建档：手删 fts 行 → 抽样审计报缺口 → 全量重建即修复', () => {
    const path = join(dir, 'rebuild.db');
    const store = open({ dbPath: path });
    store.writeEvents(writesFor('s-rb', makeEvents('rebuildable-token-one', 'rebuildable-token-two')));
    store.close();
    const raw = new Database(path);
    raw.exec(`DELETE FROM session_fts WHERE seq = 1`);
    raw.close();
    const reopened = open({ dbPath: path });
    expect(reopened.auditFts(4).mismatches).toHaveLength(1);
    const result = reopened.rebuildFts();
    expect(result.events).toBeGreaterThanOrEqual(2);
    expect(reopened.auditFts(4).mismatches).toHaveLength(0);
    expect(reopened.searchSessionFts('s-rb', 'rebuildable-token-two')).toEqual([3]);
  });

  it('检索式消毒：含 FTS5 语法字符的用户输入按子串匹配', () => {
    const store = open({ dbPath: join(dir, 'sanitize.db') });
    store.writeEvents(writesFor('s-san', makeEvents('a OR b AND NOT c')));
    expect(store.searchSessionFts('s-san', 'OR b AND')).toEqual([1]);
    expect(store.searchSessionFts('s-san', '"quotes')).toEqual([]);
  });
});

describe('store_state 面（05 §6.2 LRU + ttl）', () => {
  it('键值往返 + kind + 删除', () => {
    const store = open({ dbPath: join(dir, 'state.db') });
    store.setStoreState('k1', { n: 1 }, { kind: 'job' });
    expect(store.getStoreState('k1')?.value).toEqual({ n: 1 });
    expect(store.getStoreState('k1')?.kind).toBe('job');
    expect(store.deleteStoreState('k1')).toBe(true);
    expect(store.getStoreState('k1')).toBeUndefined();
    expect(store.deleteStoreState('k1')).toBe(false);
  });

  it('ttl 到期即缺（读路径清扫）', () => {
    let clock = 1_000;
    const store = open({ dbPath: join(dir, 'ttl.db'), clock: () => clock });
    store.setStoreState('k-ttl', 'v', { ttlMs: 100 });
    expect(store.getStoreState('k-ttl')?.value).toBe('v');
    clock = 1_200;
    expect(store.getStoreState('k-ttl')).toBeUndefined();
  });

  it('LRU 帽 256：超帽逐出最久未触达', () => {
    let clock = 1_000;
    const store = open({ dbPath: join(dir, 'lru.db'), clock: () => clock });
    for (let i = 0; i < 300; i++) {
      clock++;
      store.setStoreState(`k${i}`, i);
    }
    expect((store.connection.prepare(`SELECT count(*) AS n FROM store_state`).get() as { n: number }).n).toBe(256);
    // 最老的 k0..k43 被逐出（访问序最旧）；k299 在场
    expect(store.getStoreState('k0')).toBeUndefined();
    expect(store.getStoreState('k44')).toBeDefined();
    expect(store.getStoreState('k299')?.value).toBe(299);
  });

  it('非 JSON 值（函数）fail-loud（纯 JSON 值域执法）', () => {
    const store = open({ dbPath: join(dir, 'badval.db') });
    expectCode(() => store.setStoreState('k-bad', () => 1), 'SESSION_EVENT_DATA_INVALID');
  });
});

describe('credentials 与 model_catalog 面', () => {
  it('凭证加密往返 + 密文列不明文 + 清单零密文 + 密钥不匹配 fail-loud', () => {
    const path = join(dir, 'cred.db');
    const store = open({ dbPath: path, clock: () => 1_000 });
    store.setCredential('anthropic', { apiKey: 'sk-secret-value', meta: { region: 'us' } });
    const got = store.getCredential('anthropic');
    expect(got?.apiKey).toBe('sk-secret-value');
    expect(got?.meta).toEqual({ region: 'us' });
    // 物理列只存密文（v1: 前缀）——明文永不落盘
    const raw = store.connection.prepare(`SELECT api_key FROM credentials WHERE provider = 'anthropic'`).get() as {
      api_key: string;
    };
    expect(raw.api_key.startsWith('v1:')).toBe(true);
    expect(raw.api_key).not.toContain('sk-secret-value');
    // 换密钥重开：解密失败 fail-loud（重录即恢复）
    store.close();
    const reopened = openStore({ dbPath: path, dataDir: join(dir, 'data2'), secretKey: ephemeralSecretKey() });
    stores.push(reopened);
    expectCode(() => reopened.getCredential('anthropic'), 'PERSIST_SECRET_UNREADABLE');
    reopened.setCredential('anthropic', { apiKey: 'sk-new' });
    expect(reopened.getCredential('anthropic')?.apiKey).toBe('sk-new');
    // 清单不回 api_key
    expect(reopened.listCredentialProviders()).toEqual([{ provider: 'anthropic', updatedAt: expect.any(Number) }]);
    expect(reopened.deleteCredential('ghost')).toBe(false);
  });

  it('模型目录 CRUD', () => {
    const store = open({ dbPath: join(dir, 'models.db') });
    store.upsertModel({
      id: 'anthropic/claude-sonnet-5',
      provider: 'anthropic',
      label: 'Sonnet',
      meta: { ctx: 200_000 },
    });
    store.upsertModel({ id: 'openai/gpt-6', provider: 'openai' });
    expect(store.listModels('anthropic')).toHaveLength(1);
    expect(store.listModels().map((m) => m.id)).toEqual(['anthropic/claude-sonnet-5', 'openai/gpt-6']);
    expect(store.listModels('anthropic')[0]!.meta).toEqual({ ctx: 200_000 });
    expect(store.deleteModel('openai/gpt-6')).toBe(true);
    expect(store.listModels()).toHaveLength(1);
  });
});

describe('persist_incidents（毒丸 durable 标记）', () => {
  it('只增不删 + 倒序审计读', () => {
    const store = open({ dbPath: join(dir, 'inc.db') });
    store.recordIncident({ time: 1, sessionId: 's1', seq: 5, type: 'user/message', reason: 'SQLITE_CONSTRAINT: test' });
    store.recordIncident({ time: 2, reason: 'batch fail' });
    const list = store.listIncidents();
    expect(list).toHaveLength(2);
    expect(list[0]!.reason).toBe('batch fail'); // 最新在前
    expect(list[1]!.seq).toBe(5);
    expect(list[1]!.sessionId).toBe('s1');
  });
});

describe('accountDropped 游标跳记账', () => {
  it('毒丸跳账后：同会话后续 seq 不撞连续性断言', () => {
    const store = open({ dbPath: join(dir, 'skip.db') });
    const events = makeEvents('a', 'b'); // seq 0..3
    store.writeEvents(writesFor('s-skip', events.slice(0, 2))); // 落 0..1
    store.accountDropped('s-skip', 2); // seq 2 被毒丸吃掉——游标跳账
    // seq 3 直写：游标已到 2，期望 3
    expect(() => store.writeEvents(writesFor('s-skip', [events[3]!]))).not.toThrow();
    expect(store.getSessionRow('s-skip')?.lastSeq).toBe(3);
  });
});
