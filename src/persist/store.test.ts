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
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseError, registerEventType, type SessionEvent } from '../contracts/index.js';
import { CREDENTIALS_MIGRATION } from '../credentials/index.js';
import { SessionLog } from '../session/index.js';
import { ephemeralSecretKey } from './secret-box.js';
import type { MigrationSpec } from './migrations.js';
import {
  FIRST_QUESTION_SUMMARY_MAX_CHARS,
  firstQuestionSummaryOf,
  openStore,
  prepareWal,
  type EventWrite,
  type SessionRegistration,
  type Store,
} from './store.js';

/** 仓根目录（子进程 require('better-sqlite3') 的解析位——无需 tsx，只用到物理层依赖） */
const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

// 测试用 surface 类别插件词（FTS 索引面样本——词汇注册表 category 判据）
registerEventType({
  type: 'persist.test/note',
  category: 'surface',
  owner: 'persist.test',
  tier: 'stable',
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

/**
 * 独立代理检测（高代理无低代理伴位 / 裸低代理均算独立——ES2023 lib 无
 * isWellFormed 类型面，手扫 UTF-16 码元配对；断言「无独立代理」即 well-formed）。
 */
function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i++; // 成对——跳过低代理伴位
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true; // 低代理不在成对第二位即独立
    }
  }
  return false;
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

  it('写失败游标不推进：批内失败事务回滚后，内存游标保持在事务前值（重试不被误诊写序违约）', () => {
    const store = open({ dbPath: join(dir, 'cursor-rollback.db') });
    // 蓄底：一笔成功批写（sessions 行 + 内存游标推进至前缀尾 1）
    store.writeEvents(writesFor('s-rollback', makeEvents('seed')));
    // 批写中段失败构造（确定性，不依赖注入落点）：A 合法（seq2 先落库并
    // 推进游标）+ B 违约（seq99 撞连续性断言）→ better-sqlite3 事务整体
    // 回滚——库内 A 行消失，但缺陷形下游标已被 A 推进到 2（cursors.set
    // 在事务回调内、不随回滚撤销）。等价于 SQLITE_FULL 落 COMMIT 边界的
    // 物理形（enospc.test.ts hdiutil 真注入实测的 b 形——语句已过、COMMIT
    // 失败、库回滚而游标已走）。
    const good = (seq: number): SessionEvent => ({
      type: 'user/message',
      seq,
      time: 42_000 + seq,
      data: { content: `row-${seq}`, source: 'user' },
    });
    const bad: SessionEvent = { ...good(99), seq: 99 };
    expectCode(
      () => store.writeEvents(writesFor('s-rollback', [good(2), bad])),
      'PERSIST_DATA_CORRUPT', // 真违约 fail-loud（既有行为——本 it 锁的是回滚后的游标面）
    );
    // 库内已随事务回滚：仅余前缀（A 行不在）
    const seqsAfterRollback = store.connection
      .prepare(`SELECT seq FROM events WHERE session_id = ? ORDER BY seq`)
      .all('s-rollback') as { seq: number }[];
    expect(seqsAfterRollback.map((r) => r.seq)).toEqual([0, 1]);
    // 缺陷关键断言：重试合法批写（seq2 续接前缀）必须成功。修复前游标
    // 停在 2（库内却无该行），此处撞连续性断言误诊 PERSIST_DATA_CORRUPT
    // ——真因（前批整体回滚）被「写序违约 bug 指示器」遮蔽，与真违约
    // 不可分辨；修复后游标随事务回滚保持事务前值，重试即成功。
    store.writeEvents(writesFor('s-rollback', [good(2), good(3)]));
    const seqsFinal = store.connection
      .prepare(`SELECT seq FROM events WHERE session_id = ? ORDER BY seq`)
      .all('s-rollback') as { seq: number }[];
    expect(seqsFinal.map((r) => r.seq)).toEqual([0, 1, 2, 3]);
    expect(store.connection.prepare(`SELECT last_seq FROM sessions WHERE id = ?`).get('s-rollback')).toEqual({
      last_seq: 3,
    });
  });

  it('SQLITE_FULL 语句中段失败：首写与重试均诚实磁盘满码，解帽后同条落账 seq 连续', () => {
    const store = open({ dbPath: join(dir, 'cursor-full.db') });
    const seeded = makeEvents('seed');
    store.writeEvents(writesFor('s-full', seeded));
    // 帽注入：max_page_count 钉当前页数 + 64KiB 大载荷下一条必申新页 →
    // SQLITE_FULL（进程内纯注入、免物理挂载——落点为语句中段页分配受检）
    const pages = store.connection.pragma('page_count', { simple: true }) as number;
    store.connection.pragma(`max_page_count = ${pages}`);
    const fat: SessionEvent = {
      type: 'user/message',
      seq: seeded.length,
      time: 42_000,
      data: { content: 'x'.repeat(64 * 1024), source: 'user' },
    };
    const fatWrite = { sessionId: 's-full', event: fat, registration: REG };
    // 首写失败 + 同条重试（帽未解）均诚实 SQLITE_FULL——不因游标状态变形
    for (const label of ['首写', '重试']) {
      let err: { code?: string } | undefined;
      try {
        store.writeEventSingle(fatWrite);
      } catch (thrown) {
        err = thrown as { code?: string };
      }
      expect(err?.code, label).toBe('SQLITE_FULL');
    }
    // 解帽重试同条：成功落账——seq 续接前缀无跳号、sessions.last_seq 对齐
    store.connection.pragma('max_page_count = 1073741823');
    store.writeEventSingle(fatWrite);
    const seqs = store.connection.prepare(`SELECT seq FROM events WHERE session_id = ? ORDER BY seq`).all('s-full') as {
      seq: number;
    }[];
    expect(seqs.map((r) => r.seq)).toEqual([0, 1, seeded.length]);
    expect(store.connection.prepare(`SELECT last_seq FROM sessions WHERE id = ?`).get('s-full')).toEqual({
      last_seq: seeded.length,
    });
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

describe('首问快照物化（05 §9 档案列 first_question_summary——title 列过渡承载）', () => {
  it('firstQuestionSummaryOf 判据面：真用户源两形入列 / 机器源与缺席不入列', () => {
    const summaryOf = (data: unknown) => firstQuestionSummaryOf({ type: 'user/message', data });
    // 真用户源两形（05 §9 字面 + §3.1 闭集用户侧）
    expect(summaryOf({ content: '你好', source: 'user' })).toBe('你好');
    expect(summaryOf({ content: '来自网页', source: 'channel:webui' })).toBe('来自网页');
    // 机器注入位（投影可同视 user 但非真用户输入）不入列
    expect(summaryOf({ content: 'x', source: 'schedule' })).toBeUndefined();
    expect(summaryOf({ content: 'x', source: 'budget-extended' })).toBeUndefined();
    expect(summaryOf({ content: 'x', source: 'subagent-settled' })).toBeUndefined();
    expect(summaryOf({ content: 'x', source: 'compaction' })).toBeUndefined();
    // 受控/操控注入位不入列
    expect(summaryOf({ content: 'x', source: 'plugin:demo' })).toBeUndefined();
    expect(summaryOf({ content: 'x', source: 'session:s1' })).toBeUndefined();
    // source 缺席不入列（判据字面：source ∈ user/channel:<id>——历史残卷保守跳过）
    expect(summaryOf({ content: 'x' })).toBeUndefined();
    // 非 user/message 词不入列
    expect(firstQuestionSummaryOf({ type: 'turn/start', data: {} })).toBeUndefined();
  });

  it('firstQuestionSummaryOf 截断与块形态：200 字符帽恰界 + 尾标同式 + text 块拼接', () => {
    const summaryOf = (data: unknown) => firstQuestionSummaryOf({ type: 'user/message', data });
    expect(FIRST_QUESTION_SUMMARY_MAX_CHARS).toBe(200); // 05 §9 首版定值锁
    // 帽下原文直通（恰 200 无尾标）
    const exact = 'a'.repeat(200);
    expect(summaryOf({ content: exact, source: 'user' })).toBe(exact);
    // 超帽：头 200 字符 + 尾标（N = 截掉字符数——§1.2 裁腿同式）
    expect(summaryOf({ content: 'b'.repeat(253), source: 'user' })).toBe('b'.repeat(200) + '…[truncated 53 chars]');
    // 块形态：text 块空格拼接、image 块不入文字快照
    expect(
      summaryOf({
        content: [
          { type: 'text', text: '看这张图' },
          { type: 'image', data: 'AAAA', mimeType: 'image/png' },
          { type: 'text', text: '为什么失败' },
        ],
        source: 'user',
      }),
    ).toBe('看这张图 为什么失败');
    // 纯 image 消息无文本可截 → 不入列
    expect(summaryOf({ content: [{ type: 'image', data: 'AAAA' }], source: 'user' })).toBeUndefined();
    // 折叠后为空 → 不入列
    expect(summaryOf({ content: ' \n\t ', source: 'user' })).toBeUndefined();
  });

  it('写路物化：首条真用户输入落 title + 后续消息不回改（首登为准）', () => {
    const store = open({ dbPath: join(dir, 'fq.db') });
    const log = new SessionLog({ sessionId: 'fq' });
    log.append('turn/start', {});
    log.append('user/message', { content: '第一个问题', source: 'user' });
    store.writeEvents(writesFor('s-fq', log.events()));
    // 修前红：updateSessionTitle 零生产调用方 + 创建位不传题——title 恒 NULL
    expect(store.getSessionRow('s-fq')?.title).toBe('第一个问题');
    // 第二轮消息：首问已物化不回改（后续用户消息不覆盖）
    log.append('turn/start', {});
    log.append('user/message', { content: '第二个问题', source: 'user' });
    store.writeEvents(writesFor('s-fq', log.events().slice(2)));
    expect(store.getSessionRow('s-fq')?.title).toBe('第一个问题');
  });

  it('写路物化：超长首问 200 字符截断 + 尾标（§1.2 裁腿同式）', () => {
    const store = open({ dbPath: join(dir, 'fq-long.db') });
    const long = '问'.repeat(253);
    store.writeEvents(writesFor('s-fq-long', makeEvents(long)));
    expect(store.getSessionRow('s-fq-long')?.title).toBe('问'.repeat(200) + '…[truncated 53 chars]');
  });

  it('截断界劈开代理对退一位：派生值 well-formed + 落库 title 无替换符（内存与落库一致）', () => {
    // 199 个 a + emoji（代理对恰跨第 200/201 码元位）+ 尾串——缺陷形下
    // slice(0,200) 末位劈出孤立高代理（0xd83d），经 better-sqlite3 落库成 U+FFFD
    const text = 'a'.repeat(199) + '😀' + 'bbbbbbbb';
    const summary = firstQuestionSummaryOf({ type: 'user/message', data: { content: text, source: 'user' } });
    expect(summary).toBeDefined();
    // 修前红①：返回值含孤立高代理（isWellFormed 等价断言——手扫码元配对）
    expect(hasLoneSurrogate(summary!)).toBe(false);
    // 修前红②：落库后 title 呈现替换符（Node 字符串绑定孤立代理 → U+FFFD），
    // 内存派生值与落库值不一致
    const store = open({ dbPath: join(dir, 'fq-surrogate.db') });
    const log = new SessionLog({ sessionId: 'fq-s' });
    log.append('user/message', { content: text, source: 'user' });
    store.writeEvents(writesFor('s-fq-s', log.events()));
    const title = store.getSessionRow('s-fq-s')?.title ?? '';
    expect(title.includes('\u{fffd}')).toBe(false);
    expect(title).toBe(summary);
  });

  it('写路物化：多行首问空白折叠单行（清单面单行承载 + 零控制字节）', () => {
    const store = open({ dbPath: join(dir, 'fq-ws.db') });
    const log = new SessionLog({ sessionId: 'fq-ws' });
    log.append('user/message', { content: '  第一行\n\t第二行\n\n  尾部  ', source: 'user' });
    store.writeEvents(writesFor('s-fq-ws', log.events()));
    expect(store.getSessionRow('s-fq-ws')?.title).toBe('第一行 第二行 尾部');
  });

  it('写路物化：机器注入 user/message 不入列（compaction/schedule/plugin），真用户输入随后物化', () => {
    const store = open({ dbPath: join(dir, 'fq-machine.db') });
    const log = new SessionLog({ sessionId: 'fq-machine' });
    // compaction 摘要载体走 user/message 词形——非真用户输入不入列
    log.append('user/message', { content: '[summary] 旧会话摘要正文', source: 'compaction' });
    store.writeEvents(writesFor('s-fq-m', log.events()));
    expect(store.getSessionRow('s-fq-m')?.title).toBeUndefined();
    // schedule 机器注入同不入列
    log.append('user/message', { content: '到点自动起跑', source: 'schedule' });
    store.writeEvents(writesFor('s-fq-m', log.events().slice(1)));
    expect(store.getSessionRow('s-fq-m')?.title).toBeUndefined();
    // 真用户输入到达——首问物化（跳过机器注入行取真首条）
    log.append('user/message', { content: '真问题', source: 'user' });
    store.writeEvents(writesFor('s-fq-m', log.events().slice(2)));
    expect(store.getSessionRow('s-fq-m')?.title).toBe('真问题');
  });

  it('写路物化：显式题优先（headless 登记题不被派生覆盖）+ updateSessionTitle 人面更新仍胜出', () => {
    const store = open({ dbPath: join(dir, 'fq-title.db') });
    const reg: SessionRegistration = { ...REG, title: 'issue #42 自动处理' };
    const log = new SessionLog({ sessionId: 'fq-title' });
    log.append('user/message', { content: 'headless 起跑输入', source: 'schedule' });
    log.append('user/message', { content: '操作者的真输入', source: 'user' });
    store.writeEvents(writesFor('s-fq-t', log.events(), reg));
    expect(store.getSessionRow('s-fq-t')?.title).toBe('issue #42 自动处理');
    // 人面显式改名（updateSessionTitle 独立面）不被后续物化回卷
    expect(store.updateSessionTitle('s-fq-t', '人面改名')).toBe(true);
    log.append('user/message', { content: '改名后的新消息', source: 'user' });
    store.writeEvents(writesFor('s-fq-t', log.events().slice(2)));
    expect(store.getSessionRow('s-fq-t')?.title).toBe('人面改名');
  });

  it('legacy 库惰性回填：存量行 title NULL（旧代码写入形）后续写真首条回填', () => {
    const store = open({ dbPath: join(dir, 'fq-legacy.db') });
    const log = new SessionLog({ sessionId: 'fq-legacy' });
    log.append('user/message', { content: '历史首问', source: 'user' });
    store.writeEvents(writesFor('s-fq-l', log.events()));
    expect(store.getSessionRow('s-fq-l')?.title).toBe('历史首问');
    // 模拟存量库形：旧版本代码不物化 title（直清列复现）
    store.connection.exec(`UPDATE sessions SET title = NULL`);
    expect(store.getSessionRow('s-fq-l')?.title).toBeUndefined();
    // 新消息写：回填真首条（历史首问）而非本条——「可从日志重新派生回填」律
    log.append('user/message', { content: '后来的消息', source: 'user' });
    store.writeEvents(writesFor('s-fq-l', log.events().slice(1)));
    expect(store.getSessionRow('s-fq-l')?.title).toBe('历史首问');
  });

  it('firstQuestionSummaryOf 净化面：ANSI 序列/C0/DEL/C1 控制字节剥除（m10——title 零控制字节）', () => {
    const summaryOf = (data: unknown) => firstQuestionSummaryOf({ type: 'user/message', data });
    // CSI 形（色码）整段剥除——可打印残段（[31m 等）不残留（JS \s 不含 ESC，
    // 修前 ESC 原样穿透物化进 title）
    expect(summaryOf({ content: '\x1b[31m日志\x1b[0m 贴终端输出', source: 'user' })).toBe('日志 贴终端输出');
    // OSC 形（改窗题）剥至 BEL——正文不误伤
    expect(summaryOf({ content: '\x1b]0;窗题\x07正文', source: 'user' })).toBe('正文');
    // C0（BEL/NUL）与 DEL 剥除——不引入空格（贴身剥除）
    expect(summaryOf({ content: '警\x07报\x00与\x7f杂音', source: 'user' })).toBe('警报与杂音');
    // C1（U+0085 NEL 等 0x80-0x9f 段）剥除——JS \s 不含 NEL（LineTerminator 只四值）
    expect(summaryOf({ content: '左\u0085右', source: 'user' })).toBe('左右');
    // 混合脏输入字节形总断言：返回值零控制字节（修前 ESC 在场必红）
    const dirty = summaryOf({ content: '带\x1b[2J清屏\x1b]0;t\x07的输入', source: 'user' });
    expect(dirty).toBe('带清屏的输入');
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(dirty ?? '')).toBe(false);
  });

  it('firstQuestionSummaryOf 零宽字素族剥除：零宽-only 归空不物化（i2——不可见标题）', () => {
    const summaryOf = (data: unknown) => firstQuestionSummaryOf({ type: 'user/message', data });
    // 零宽族不在 JS \s 类（修前折叠后非空照常物化为不可见标题）——剥除后归空。
    // ZWSP/ZWNJ/ZWJ/BOM/SHY/WJ 六点（与 width.ts 孤立零宽码点集同源）
    expect(summaryOf({ content: '\u200b\u200c\u200d', source: 'user' })).toBeUndefined();
    expect(summaryOf({ content: '\ufeff', source: 'user' })).toBeUndefined();
    expect(summaryOf({ content: '\u00ad\u2060', source: 'user' })).toBeUndefined();
    // 零宽夹真文本——剥除不误伤正文（贴身剥除不引空格）
    expect(summaryOf({ content: 'a\u200b\u200c\u200db', source: 'user' })).toBe('ab');
  });

  it('写路物化：含逃逸序列/控制字节首问落库 title 零控制字节（m10 存储级锁——字节形断言）', () => {
    const store = open({ dbPath: join(dir, 'fq-ctrl.db') });
    const log = new SessionLog({ sessionId: 'fq-ctrl' });
    log.append('user/message', { content: '\x1b[31m日志\x1b[0m 贴终端输出', source: 'user' });
    store.writeEvents(writesFor('s-fq-ctrl', log.events()));
    const title = store.getSessionRow('s-fq-ctrl')?.title ?? '';
    // 修前红：title 含 ESC 原样物化（每次 sessions list 复发外发终端）
    expect(/[\u0000-\u001f\u007f-\u009f]/.test(title)).toBe(false);
    expect(title).toBe('日志 贴终端输出');
  });

  it('已物化短路：title 在场后后续 user/message 写零重扫（i1——首问扫描语句计数形）', () => {
    const store = open({ dbPath: join(dir, 'fq-short.db') });
    // 拦截 Database：只包首问扫描语句（SQL 形唯一锚定）的 iterate 计数，
    // 其余语句原样透传——写路语义零干扰
    const db = store.connection;
    let scanIterations = 0;
    const rawPrepare = db.prepare.bind(db);
    db.prepare = ((sql: string) => {
      const statement = rawPrepare(sql);
      if (sql.includes("AND type = 'user/message' ORDER BY seq")) {
        const rawIterate = statement.iterate.bind(statement);
        statement.iterate = ((...bindParameters: unknown[]) => {
          scanIterations += 1;
          return rawIterate(...(bindParameters as []));
        }) as typeof statement.iterate;
      }
      return statement;
    }) as typeof db.prepare;
    // 同一新会话连写三条 user/message：修前每写全量重扫（计数 3），修后首写
    // 物化即短路（计数 1——已物化 title 使 COALESCE 必保持现值，扫描无人消费）
    const log = new SessionLog({ sessionId: 'fq-short' });
    log.append('user/message', { content: '第一条真输入', source: 'user' });
    store.writeEvents(writesFor('s-fq-short', log.events()));
    expect(store.getSessionRow('s-fq-short')?.title).toBe('第一条真输入');
    log.append('user/message', { content: '第二条', source: 'user' });
    store.writeEvents(writesFor('s-fq-short', log.events().slice(1)));
    log.append('user/message', { content: '第三条', source: 'user' });
    store.writeEvents(writesFor('s-fq-short', log.events().slice(2)));
    expect(scanIterations).toBe(1);
    // 短路不得破首登为准语义（COALESCE 值面不变——title 恒首问）
    expect(store.getSessionRow('s-fq-short')?.title).toBe('第一条真输入');
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

  it('遮蔽×审计×重建交叉：auditFts 无伪缺口 + rebuildFts 不复活被遮行（会话内与跨会话两面）', () => {
    const store = open({ dbPath: join(dir, 'fts-mask.db') });
    const log = new SessionLog({ sessionId: 'm' });
    log.append('turn/start', {});
    log.append('user/message', { content: 'compacted-away-secret', source: 'user' }); // seq 1（将被遮）
    log.append('turn/start', {});
    log.append('user/message', { content: 'keep-visible-text', source: 'user' }); // seq 3
    store.writeEvents(writesFor('s-mask', log.events()));
    // 压缩遮蔽指令（surfaceOp replace [0,1]——写路径同批删区间 fts 行，写入档既有锁）
    log.appendWithSurfaceOp(
      'persist.test/note',
      { text: 'replacement summary' },
      { op: 'replace', start: 0, end: 1 },
      [0, 1],
    );
    store.writeEvents(writesFor('s-mask', [log.events()[4]!]));
    // 写路删行（既有执法语义——遮蔽即不可检索）
    expect(store.searchSessionFts('s-mask', 'compacted-away-secret')).toEqual([]);
    // 修前红①：审计期望计数不感知 surface_op 列 → 被遮会话报伪缺口 {expected:3, actual:2}
    expect(store.auditFts(8).mismatches).toEqual([]);
    // 修前红②：全量重建盲重放全部 events 行 → 被遮行复活（searchSessionFts 与 searchFtsGlobal 两读面）
    store.rebuildFts();
    expect(store.searchSessionFts('s-mask', 'compacted-away-secret')).toEqual([]);
    expect(store.searchFtsGlobal('compacted-away-secret')).toEqual([]);
    // 未遮蔽行照常在索引（重建修真缺口的职能不因遮蔽感知缺位）
    expect(store.searchSessionFts('s-mask', 'keep-visible-text')).toEqual([3]);
    expect(store.searchSessionFts('s-mask', 'replacement summary')).toEqual([4]);
    // 重建后再审计仍零缺口（审计期望与重建产物同一遮蔽感知模型）
    expect(store.auditFts(8).mismatches).toEqual([]);
  });

  it('检索式消毒：含 FTS5 语法字符的用户输入按子串匹配', () => {
    const store = open({ dbPath: join(dir, 'sanitize.db') });
    store.writeEvents(writesFor('s-san', makeEvents('a OR b AND NOT c')));
    expect(store.searchSessionFts('s-san', 'OR b AND')).toEqual([1]);
    expect(store.searchSessionFts('s-san', '"quotes')).toEqual([]);
  });

  it('searchFtsGlobal（05 §9 追记①——查询面限定解除）：跨会话命中 + 引号消毒 + <3 字符空 + 删除会话行随删', () => {
    const store = open({ dbPath: join(dir, 'global.db') });
    store.writeEvents(writesFor('s-a', makeEvents('shared-token alpha')));
    store.writeEvents(writesFor('s-b', makeEvents('shared-token beta')));
    store.writeEvents(writesFor('s-c', makeEvents('unrelated text')));
    // 跨会话：两会话各一行命中（无 session 过滤）——返回 sessionId+seq+body 三位
    const hits = store.searchFtsGlobal('shared-token');
    expect(hits).toHaveLength(2);
    expect(new Set(hits.map((h) => h.sessionId))).toEqual(new Set(['s-a', 's-b']));
    for (const hit of hits) {
      expect(hit.seq).toBeGreaterThan(0);
      expect(hit.body).toContain('shared-token');
    }
    // 消毒：语法字符按子串匹配（与会话内变体同款）
    expect(store.searchFtsGlobal('"shared')).toEqual([]);
    expect(store.searchFtsGlobal('a OR b')).toHaveLength(0); // 无该子串
    // trigram 下界：<3 字符无从匹配返回空
    expect(store.searchFtsGlobal('sh')).toEqual([]);
    // 删除会话 → fts 行随删（对账第二档在跨会话面同样成立）
    store.deleteSession('s-a');
    expect(store.searchFtsGlobal('shared-token').map((h) => h.sessionId)).toEqual(['s-b']);
    // 行帽：limit 钳制命中数
    expect(store.searchFtsGlobal('shared-token', 1)).toHaveLength(1);
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
    // 迁移链带 CREDENTIALS_MIGRATION（v7 namespace 扩容——c-2 存储腿）：
    // 双键 (namespace, provider) 物理形由迁移建立，基线 v1 是单键旧形
    const store = open({ dbPath: path, clock: () => 1_000, migrations: [CREDENTIALS_MIGRATION] });
    store.setCredential('host', 'anthropic', { apiKey: 'sk-secret-value', meta: { region: 'us' } });
    const got = store.getCredential('host', 'anthropic');
    expect(got?.namespace).toBe('host');
    expect(got?.apiKey).toBe('sk-secret-value');
    expect(got?.meta).toEqual({ region: 'us' });
    // 物理列只存密文（v1: 前缀）+ namespace 归属列在场——明文永不落盘
    const raw = store.connection
      .prepare(`SELECT namespace, api_key FROM credentials WHERE provider = 'anthropic'`)
      .get() as { namespace: string; api_key: string };
    expect(raw.namespace).toBe('host');
    expect(raw.api_key.startsWith('v1:')).toBe(true);
    expect(raw.api_key).not.toContain('sk-secret-value');
    // 换密钥重开：解密失败 fail-loud（重录即恢复）；链必须与运行时全同
    // （不带链的短链开真库会被同库降级拒开——HOST_MIGRATION_TAIL 同源律）
    store.close();
    const reopened = openStore({
      dbPath: path,
      dataDir: join(dir, 'data2'),
      secretKey: ephemeralSecretKey(),
      migrations: [CREDENTIALS_MIGRATION],
    });
    stores.push(reopened);
    expectCode(() => reopened.getCredential('host', 'anthropic'), 'PERSIST_SECRET_UNREADABLE');
    reopened.setCredential('host', 'anthropic', { apiKey: 'sk-new', meta: { source: 'manual' } });
    expect(reopened.getCredential('host', 'anthropic')?.apiKey).toBe('sk-new');
    // 清单不回 api_key（namespace+provider 双键全域列示）+ meta 随行回 parsed
    // JSON（c-5 人面 list 来源列消费——零密文零明文律不破）
    expect(reopened.listCredentialProviders()).toEqual([
      { namespace: 'host', provider: 'anthropic', meta: { source: 'manual' }, updatedAt: expect.any(Number) },
    ]);
    expect(reopened.deleteCredential('host', 'ghost')).toBe(false);
  });

  it('namespace 域分立——同名 provider 两域共存互不覆写，删改只动本域', () => {
    const store = open({ dbPath: join(dir, 'ns.db'), clock: () => 2_000, migrations: [CREDENTIALS_MIGRATION] });
    store.setCredential('host', 'gh', { apiKey: 'host-token' });
    store.setCredential('plugin:demo', 'gh', { apiKey: 'plugin-token' });
    // 同名 provider 两行独立——读各归各域（物理行数即证）
    expect(store.getCredential('host', 'gh')?.apiKey).toBe('host-token');
    expect(store.getCredential('plugin:demo', 'gh')?.apiKey).toBe('plugin-token');
    expect((store.connection.prepare(`SELECT count(*) AS n FROM credentials`).get() as { n: number }).n).toBe(2);
    // 覆写只动本域（plugin 域重录不动 host 域行）
    store.setCredential('plugin:demo', 'gh', { apiKey: 'plugin-token-2' });
    expect(store.getCredential('plugin:demo', 'gh')?.apiKey).toBe('plugin-token-2');
    expect(store.getCredential('host', 'gh')?.apiKey).toBe('host-token');
    expect(store.deleteCredential('plugin:demo', 'gh')).toBe(true);
    expect(store.getCredential('plugin:demo', 'gh')).toBeUndefined();
    expect(store.getCredential('host', 'gh')?.apiKey).toBe('host-token');
    // 全域清单按 (namespace, provider) 序——人面命令恒可列示/撤销一切域（03 §10.9）
    expect(store.listCredentialProviders()).toEqual([
      { namespace: 'host', provider: 'gh', updatedAt: expect.any(Number) },
    ]);
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

describe('真库双连接竞争（WAL 并发窗）', () => {
  /**
   * 子进程持锁脚本（plain node + require——只碰物理层依赖无需 tsx）。
   * 行协议：stdout 打 LOCKED 后持写锁 holdMs 毫秒再 COMMIT 退出——父进程
   * 据此在「写锁确已被他连接持有」的窗口内发起同步竞争写。
   */
  const LOCK_HOLDER_SCRIPT = `
    const Database = require('better-sqlite3');
    const db = new Database(process.argv[1]);
    db.pragma('busy_timeout = 5000');
    db.exec('BEGIN IMMEDIATE');
    console.log('LOCKED');
    setTimeout(() => { db.exec('COMMIT'); db.close(); }, Number(process.argv[2]));
  `;

  /**
   * 子进程持读锁脚本（BEGIN + SELECT → SHARED 在场——WAL 换模的占锁形）。
   * 行协议同上：LOCKED 后持 holdMs 毫秒再 COMMIT 退出（子进程自己的事件
   * 循环负责定时——父线程被同步阻塞时仍可释锁）。
   */
  const READ_HOLDER_SCRIPT = `
    const Database = require('better-sqlite3');
    const db = new Database(process.argv[1]);
    db.pragma('busy_timeout = 5000');
    db.exec('BEGIN');
    db.prepare('SELECT count(*) AS c FROM probe').get();
    console.log('LOCKED');
    setTimeout(() => { db.exec('COMMIT'); db.close(); }, Number(process.argv[2]));
  `;

  /** 等子进程 stdout 出现指定词（持锁确认后才发竞争写——否则测的是无锁直过） */
  function waitMarker(child: ChildProcess, marker: string): Promise<void> {
    return new Promise((resolve, reject) => {
      let seen = false;
      child.stdout!.setEncoding('utf8');
      child.stdout!.on('data', (chunk: string) => {
        if (chunk.includes(marker)) {
          seen = true;
          resolve();
        }
      });
      child.on('error', reject);
      child.on('exit', (code) => {
        if (!seen) reject(new Error(`持锁子进程未打标先退（code=${code}）`));
      });
    });
  }

  it('双连接写锁窗：他连接 BEGIN IMMEDIATE 持写锁期内，writeEvents 在 busy_timeout 窗内等锁、锁释后续接落账（seq 连续无 BUSY 逃逸）', async () => {
    const path = join(dir, 'race.db');
    const store = open({ dbPath: path });
    // 蓄底 seq 0..1（会话行在库 + 游标到 1）——竞争批 seq 2..3 续接
    const events = makeEvents('seed-a', 'seed-b');
    store.writeEvents(writesFor('s-race', events.slice(0, 2)));
    // 真跨进程持锁：better-sqlite3 同步 API 下同线程持锁方永无机会提交——
    // busy_timeout 退避等待只在真并发连接间可观测
    const child = spawn(process.execPath, ['-e', LOCK_HOLDER_SCRIPT, path, '400'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      await waitMarker(child, 'LOCKED');
      const t0 = Date.now();
      // 同步竞争写：写锁被持 → busy_timeout 窗内阻塞重试 → 子进程 COMMIT 后落账
      store.writeEvents(writesFor('s-race', events.slice(2)));
      const waited = Date.now() - t0;
      // 真等了持锁窗（≥300ms 余量——非无锁直过假绿）
      expect(waited).toBeGreaterThanOrEqual(300);
      // 落账完整：seq 0..3 连续、内容保真
      expect(store.loadEvents('s-race').map((event) => event.seq)).toEqual([0, 1, 2, 3]);
      expect(store.getSessionRow('s-race')?.lastSeq).toBe(3);
    } finally {
      child.kill();
    }
  });

  it('prepareWal 三拍与降级腿：busy_timeout=5000 / journal_mode=wal / synchronous=FULL 生效；换模失败 warn 降级继续跑 + BUSY 重试环真走', async () => {
    // 拍直证：干净库上三拍全生效
    const clean = new Database(join(dir, 'wal-clean.db'));
    clean.exec('CREATE TABLE probe (x INTEGER)');
    prepareWal(clean, () => undefined);
    expect(clean.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(clean.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(clean.pragma('synchronous', { simple: true })).toBe(2); // FULL
    clean.close();
    // 降级腿（即断形）：readonly 连接上换模必败（非 BUSY 错）→ 不重试直接 warn
    // 降级继续跑。注：真并发占锁的 BUSY 全穷尽形 = 6 拍 × busy_timeout 5000ms
    // + 退避 ≈ 31s——成本不进常规套件；降级行为（warn + 卫生拍不跳 + 缺省
    // 日志模式继续）由此即断形锁定，BUSY 分支的重试环由下一腿锁定。
    const roPath = join(dir, 'wal-ro.db');
    const roSeed = new Database(roPath);
    roSeed.exec('CREATE TABLE probe (x INTEGER)');
    roSeed.close();
    const ro = new Database(roPath, { readonly: true });
    const roWarns: string[] = [];
    prepareWal(ro, (m) => roWarns.push(m));
    expect(roWarns.join('\n')).toContain('journal_mode=WAL 设置失败');
    expect(ro.pragma('journal_mode', { simple: true })).toBe('delete'); // 换模未成
    // 卫生两拍不因换模失败跳过
    expect(ro.pragma('busy_timeout', { simple: true })).toBe(5000);
    expect(ro.pragma('synchronous', { simple: true })).toBe(2);
    ro.close();
    // BUSY 重试腿（真并发连接形·轻量）：delete 模式库 + 子进程持读事务跨过
    // 首个 busy 窗（5500ms > 5000ms）→ 首拍 BUSY 退避后次拍锁释换模成功。
    // 持锁方必须是子进程：prepareWal 同步阻塞主线程（busy 等待 + Atomics 退避
    // 都不让出事件循环）——同线程 setTimeout 永无机会 COMMIT。
    const busyPath = join(dir, 'wal-busy.db');
    const seed = new Database(busyPath);
    seed.exec('CREATE TABLE probe (x INTEGER)');
    seed.close();
    const holder = spawn(process.execPath, ['-e', READ_HOLDER_SCRIPT, busyPath, '5500'], {
      cwd: REPO_ROOT,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      await waitMarker(holder, 'LOCKED');
      const contender = new Database(busyPath);
      const busyWarns: string[] = [];
      const t0 = Date.now();
      prepareWal(contender, (m) => busyWarns.push(m));
      const elapsed = Date.now() - t0;
      // 首拍吃满一个 busy 窗（≥5000ms）后重试成功——重试环真走且不误报降级
      expect(busyWarns).toHaveLength(0);
      expect(elapsed).toBeGreaterThanOrEqual(5000);
      expect(elapsed).toBeLessThan(15_000);
      expect(contender.pragma('journal_mode', { simple: true })).toBe('wal');
      contender.close();
    } finally {
      holder.kill();
    }
  });

  it('同库双 Store 交替写：不同会话 seq 域互不冲突且跨连接互见；同会话撞号诚实抛（连续性断言 + 主键约束两形）', () => {
    const path = join(dir, 'two.db');
    const a = open({ dbPath: path });
    const b = open({ dbPath: path }); // 第二 Store 同库（CLI 惰性开库与常驻进程并存的结构形）
    // 交替写不同会话：per-session 游标各账各的，seq 域独立推进（每会话单 log
    // 造 0..3 再分两批——seq 域跨批连续，写权在两连接间交替）
    const eventsA = makeEvents('a0', 'a1'); // seq 0..3
    const eventsB = makeEvents('b0', 'b1'); // seq 0..3
    a.writeEvents(writesFor('sa', eventsA.slice(0, 2)));
    b.writeEvents(writesFor('sb', eventsB.slice(0, 2)));
    a.writeEvents(writesFor('sa', eventsA.slice(2)));
    b.writeEvents(writesFor('sb', eventsB.slice(2)));
    expect(a.loadEvents('sa')).toHaveLength(4);
    expect(b.loadEvents('sb')).toHaveLength(4);
    // WAL 下已提交事务跨连接立即可见（双连接互见）
    expect(a.queryEvents({ sessionId: 'sb' }).events).toHaveLength(4);
    expect(b.queryEvents({ sessionId: 'sa' }).events).toHaveLength(4);
    // 同会话撞号形一：陈旧 seq 重放（b 的游标首遇从库 last_seq 初始化 → 期望续接位）
    // → 连续性断言 fail-loud（PERSIST_DATA_CORRUPT）
    a.writeEvents(writesFor('sc', makeEvents('c0', 'c1').slice(0, 1))); // sc seq0 经 a
    expectCode(() => b.writeEvents(writesFor('sc', makeEvents('c0', 'c1').slice(0, 1))), 'PERSIST_DATA_CORRUPT');
    // 同会话撞号形二：内存游标滞后于库（a 不知情 b 已写 seq1）→ 连续性断言通过
    // 但行已在场 → 主键约束原样上抛（非吞非改写）
    b.writeEvents(writesFor('sc', makeEvents('c0', 'c1').slice(1, 2))); // sc seq1 经 b
    let thrown: unknown;
    try {
      a.writeEvents(writesFor('sc', makeEvents('c0', 'c1').slice(1, 2))); // a 的 sc 游标仍停在 0
    } catch (err) {
      thrown = err;
    }
    expect((thrown as { code?: string }).code).toMatch(/^SQLITE_CONSTRAINT/);
  });
});

describe('迁移执行中失败（升级日现场）', () => {
  /** 坏链：v2 合法（建 mig_ok 表）+ v3 坏 SQL（语法错）——失败点在链中段 */
  const BAD_CHAIN: readonly MigrationSpec[] = [
    { version: 2, name: 'test-mig-ok', sql: 'CREATE TABLE mig_ok (id INTEGER PRIMARY KEY) STRICT' },
    { version: 3, name: 'test-mig-bad', sql: 'THIS IS NOT VALID SQL' },
  ];

  it('坏 SQL 原样上抛（非 BaseError 包装非吞）+ user_version 不半推进（v2 已落 v3 回滚）+ 迁移前备份在场', () => {
    const path = join(dir, 'migfail.db');
    // v1 基线库 + 升级前数据行（升级日现场的用户数据对照物）
    const base = open({ dbPath: path });
    base.writeEvents(writesFor('s-pre', makeEvents('pre-a', 'pre-b')));
    base.close();
    // 坏链开库：v2 事务已提交、v3 事务内坏 SQL 抛 SqliteError 上抛
    let thrown: unknown;
    try {
      open({ dbPath: path, migrations: BAD_CHAIN });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(BaseError); // 原样 SqliteError——不吞不改写（fail-loud）
    // 版本不半推进：v3 的 user_version 赋值随其事务回滚——重开 raw 断言停在 2
    const probe = new Database(path);
    expect(probe.pragma('user_version', { simple: true })).toBe(2);
    // 迁移前备份在场（.bak-v1——升级行为先于任何迁移已拷）
    expect(existsSync(`${path}.bak-v1`)).toBe(true);
    probe.close();
  });

  it('bak-v1 手工回滚路径真实可用：v1 基线表全在 + 无 -wal 伴随（checkpoint 收卷快照）+ 升级前数据行全量可读', () => {
    const path = join(dir, 'migrollback.db');
    const base = open({ dbPath: path });
    base.writeEvents(writesFor('s-pre', makeEvents('pre-a', 'pre-b')));
    base.close();
    expect(() => open({ dbPath: path, migrations: BAD_CHAIN })).toThrow();
    expect(existsSync(`${path}.bak-v1`)).toBe(true);
    // 拷贝件是 checkpoint 收卷后快照：无 -wal 伴随（独立可开——手工回滚的前置条件）
    expect(existsSync(`${path}.bak-v1-wal`)).toBe(false);
    const bak = new Database(`${path}.bak-v1`);
    const tables = (
      bak.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    // v1 基线核心七表全在 + 迁移对象不在（拷贝先于任何迁移——回滚后旧宿主可直开）
    for (const table of [
      'events',
      'sessions',
      'session_fts',
      'store_state',
      'credentials',
      'model_catalog',
      'persist_incidents',
    ]) {
      expect(tables).toContain(table);
    }
    expect(tables).not.toContain('mig_ok');
    // 升级前写入的数据行全量可读（4 条 seq 连续 + 会话游标账同步）
    const rows = bak.prepare(`SELECT seq FROM events WHERE session_id = 's-pre' ORDER BY seq`).all() as {
      seq: number;
    }[];
    expect(rows.map((row) => row.seq)).toEqual([0, 1, 2, 3]);
    expect(
      (bak.prepare(`SELECT last_seq FROM sessions WHERE id = 's-pre'`).get() as { last_seq: number }).last_seq,
    ).toBe(3);
    bak.close();
  });

  it('修复宿主后重开续升：只带合法 v3 的换代链再开同库 → 升到 head 且 v2 成果保留、原数据不丢（升级日三段剧收口）', () => {
    const path = join(dir, 'migrepair.db');
    const base = open({ dbPath: path });
    base.writeEvents(writesFor('s-pre', makeEvents('pre-a', 'pre-b')));
    base.close();
    expect(() => open({ dbPath: path, migrations: BAD_CHAIN })).toThrow();
    // 修复形：换代宿主只带合法 v3（normalizeMigrations 无连续性要求——链头 3 合法）
    const repaired = open({
      dbPath: path,
      migrations: [
        { version: 3, name: 'test-mig-fixed', sql: 'CREATE TABLE mig_fixed (id INTEGER PRIMARY KEY) STRICT' },
      ],
    });
    expect(repaired.headVersion).toBe(3);
    expect(repaired.connection.pragma('user_version', { simple: true })).toBe(3);
    // v2 成果保留（失败现场已落的部分迁移产物随库存活——续升不重跑已落版本）
    expect(repaired.connection.prepare(`SELECT count(*) AS c FROM mig_ok`).get()).toEqual({ c: 0 });
    expect(repaired.connection.prepare(`SELECT count(*) AS c FROM mig_fixed`).get()).toEqual({ c: 0 });
    // 升级前数据全程不丢
    expect(repaired.loadEvents('s-pre')).toHaveLength(4);
  });
});
