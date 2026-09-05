/**
 * Persistence 门面测试——临时目录全栈（真库 + 真写队列，mock 零层）。
 *
 * 断言面：会话创建/装载/种子创建的 id 发放纪律（§5.2 无幻影 id）/
 * 续写衔接（loadSession 后 append 直通队列）/ deleteSession flush 先行 /
 * close 退出序 / 透传面（05 篇 §4/§5/§6）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BaseError } from '../contracts/index.js';
import { ephemeralSecretKey } from './secret-box.js';
import { Persistence } from './persistence.js';

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

let dir: string;
let ps: Persistence[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-agent-persistence-test-'));
  ps = [];
});

afterEach(async () => {
  for (const p of ps) await p.close().catch(() => undefined);
  rmSync(dir, { recursive: true, force: true });
});

/** 开门面助手（密钥注入避免撒文件——secret-box 自有专测） */
function open(options: { dbPath?: string } = {}): Persistence {
  const p = Persistence.open({
    dbPath: options.dbPath ?? join(dir, 'main.db'),
    dataDir: join(dir, 'data'),
    secretKey: ephemeralSecretKey(),
  });
  ps.push(p);
  return p;
}

/** 一轮对话形事件（turn/start + user/message） */
function oneTurn(log: ReturnType<Persistence['createSession']>, text: string): void {
  log.append('turn/start', {});
  log.append('user/message', { content: text, source: 'user' });
}

describe('会话创建与装载', () => {
  it('createSession：id 即发、行随首事件落库（无事件即无行）+ 往返保真 + 根会话 lineage=undefined', async () => {
    const p = open();
    const log = p.createSession({ origin: 'conversation', workspaceRoot: '/ws' });
    // 零持久化承诺：未 append 未 flush——行不在
    expect(p.store.getSessionRow(log.sessionId)).toBeUndefined();
    oneTurn(log, 'hello');
    await p.flush();
    const row = p.store.getSessionRow(log.sessionId);
    expect(row?.origin).toBe('conversation');
    expect(row?.lastSeq).toBe(1);
    // 装载往返：事件保真 + 续写直通队列
    const loaded = p.loadSession(log.sessionId);
    expect(loaded.lineage).toBeUndefined(); // conversation 根——血缘不合成
    expect(loaded.log.events()).toHaveLength(2);
    oneTurn(loaded.log, 'second turn');
    await p.flush();
    expect(p.store.loadEvents(log.sessionId)).toHaveLength(4);
  });

  it('loadSession：不存在的 id → PERSIST_DATA_CORRUPT fail-loud', () => {
    const p = open();
    expectCode(() => p.loadSession('ghost-id'), 'PERSIST_DATA_CORRUPT');
  });

  it('跨 Persistence 重开：close 收卷后重开装载续写（WAL 落盘 + checkpoint）', async () => {
    const path = join(dir, 'reopen.db');
    const a = Persistence.open({ dbPath: path, dataDir: join(dir, 'data'), secretKey: ephemeralSecretKey() });
    ps.push(a);
    const log = a.createSession({ origin: 'conversation' });
    oneTurn(log, 'persisted turn');
    await a.close();
    const b = Persistence.open({ dbPath: path, dataDir: join(dir, 'data'), secretKey: ephemeralSecretKey() });
    ps.push(b);
    const loaded = b.loadSession(log.sessionId);
    expect(loaded.log.events()).toHaveLength(2);
    oneTurn(loaded.log, 'after reopen');
    await b.flush();
    expect(b.store.loadEvents(log.sessionId)).toHaveLength(4);
  });
});

describe('种子会话（fork/导入物理腿，§5）', () => {
  it('非空种子：同步落库（无 flush 即可读——不返回幻影 id）+ 血缘三元组 + 续写衔接', () => {
    const p = open();
    // 种子源：先造一轮真事件
    const src = p.createSession({ origin: 'conversation' });
    oneTurn(src, 'origin turn');
    const forked = p.createSeededSession(src.events(), {
      origin: 'fork',
      parentId: src.sessionId,
      workspaceRoot: '/ws',
      title: '分叉',
    });
    // 同步落库铁证：未 flush，种子已可读
    expect(p.store.loadEvents(forked.sessionId)).toHaveLength(2);
    expect(p.store.getSessionRow(forked.sessionId)?.seedLength).toBe(2);
    // 装载面血缘重建
    const loaded = p.loadSession(forked.sessionId);
    expect(loaded.lineage).toEqual({ parentId: src.sessionId, seedLength: 2, origin: 'fork' });
    // 续写：seq 从种子尾衔接
    oneTurn(forked, 'fork continues');
    // 未 flush——异步队列在飞；flush 后续写可见
    expect(p.store.loadEvents(forked.sessionId)).toHaveLength(2);
  });

  it('续写衔接（flush 后）:种子尾 seq 续账不撞', async () => {
    const p = open();
    const src = p.createSession({ origin: 'conversation' });
    oneTurn(src, 'origin turn');
    const forked = p.createSeededSession(src.events(), { origin: 'fork', parentId: src.sessionId });
    oneTurn(forked, 'fork continues');
    await p.flush();
    const events = p.store.loadEvents(forked.sessionId);
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3]);
  });

  it('空种子：登记行仍落（无行 = 幻影 id）+ 首事件 seq 0 直写', async () => {
    const p = open();
    const empty = p.createSeededSession([], { origin: 'import' });
    const row = p.store.getSessionRow(empty.sessionId);
    expect(row?.origin).toBe('import');
    expect(row?.lastSeq).toBe(-1);
    oneTurn(empty, 'first real turn');
    await p.flush();
    expect(p.store.loadEvents(empty.sessionId)).toHaveLength(2);
  });

  it(':memory: 拒种子创建 → SESSION_PERSISTENCE_REQUIRED（fork 需要物理会话）', () => {
    const p = open({ dbPath: ':memory:' });
    expect(p.inMemory).toBe(true);
    expectCode(() => p.createSeededSession([], { origin: 'fork' }), 'SESSION_PERSISTENCE_REQUIRED');
  });
});

describe('删除与退出序', () => {
  it('deleteSession flush 先行：在飞事件落定后再三删（不复活）', async () => {
    const p = open();
    const log = p.createSession({ origin: 'conversation' });
    oneTurn(log, 'doomed turn'); // 在飞未 flush
    const gone = await p.deleteSession(log.sessionId);
    expect(gone).toBe(true);
    // 队列事件已先落又被删——不复活
    expect(p.store.getSessionRow(log.sessionId)).toBeUndefined();
    expect(p.queryEvents({ sessionId: log.sessionId }).events).toHaveLength(0);
    expect(await p.deleteSession(log.sessionId)).toBe(false);
  });

  it('close：flush + checkpoint 收卷（close 后数据完整、再读拒用）', async () => {
    const path = join(dir, 'exit.db');
    const p = Persistence.open({ dbPath: path, dataDir: join(dir, 'data'), secretKey: ephemeralSecretKey() });
    ps.push(p);
    const log = p.createSession({ origin: 'conversation' });
    oneTurn(log, 'final turn');
    await p.close();
    expect(() => p.queryEvents({})).toThrowError(/已关闭/);
    // 重开验证完整
    const b = Persistence.open({ dbPath: path, dataDir: join(dir, 'data'), secretKey: ephemeralSecretKey() });
    ps.push(b);
    expect(b.store.loadEvents(log.sessionId)).toHaveLength(2);
  });
});

describe('透传面', () => {
  it('queryEvents 过滤 / listSessions workspaceRoot 选取 / updateSessionTitle', async () => {
    let clock = 1_000;
    const p = Persistence.open({
      dbPath: join(dir, 'passthrough.db'),
      dataDir: join(dir, 'data'),
      secretKey: ephemeralSecretKey(),
      clock: () => clock,
    });
    ps.push(p);
    const inWs = p.createSession({ origin: 'conversation', workspaceRoot: '/ws/x' });
    oneTurn(inWs, 'in workspace');
    clock = 2_000;
    const bare = p.createSession({ origin: 'conversation' });
    oneTurn(bare, 'no workspace');
    await p.flush();
    expect(p.queryEvents({ types: ['user/message'] }).events).toHaveLength(2);
    expect(p.listSessions({ workspaceRoot: '/ws/x' }).map((r) => r.id)).toEqual([inWs.sessionId]);
    // 无工作区会话不进 workspaceRoot 选取面
    expect(p.listSessions({ workspaceRoot: '/ws/x' }).map((r) => r.id)).not.toContain(bare.sessionId);
    expect(p.updateSessionTitle(inWs.sessionId, '起名了')).toBe(true);
    expect(p.listSessions({ workspaceRoot: '/ws/x' })[0]!.title).toBe('起名了');
  });
});
