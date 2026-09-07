/**
 * memory 工具面九件测试（批 18c-2——工厂面：名册/effect 分账/schema 收口/
 * owner 解析/回执形/错误编码 isError 面；DAO 语义全档归 holding.test.ts，
 * 本件只锁工具包装层）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import type { AgentToolResult, ToolContext, ToolDefinition } from '../contracts/index.js';
import { createMemoryDao, type MemoryDao } from './dao.js';
import { MEMORY_MIGRATIONS } from './migration.js';
import { createMemoryTools } from './tools.js';

let dir: string;
let store: Store | null = null;
let nowMs: number;
let idSeq = 0;
let dbSeq = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-memory-tools-'));
  nowMs = Date.parse('2026-09-08T08:00:00.000Z');
  idSeq = 0;
  dbSeq = 0;
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 装配面（owner 并集含 project 域——resolveOwner 两向可测；一 setup 一库文件——
 * 同测试多 setup 免同文件连坐；id 序注：ingest 每 entry 消耗两 id〔memory+version 行〕，
 * 断言一律锚定返回 id 或首条恒 m1） */
function setup(ownerKeys?: readonly string[]): { dao: MemoryDao; tools: ToolDefinition[] } {
  store = openStore({
    dbPath: join(dir, `test-${++dbSeq}.db`),
    dataDir: dir,
    secretKey: ephemeralSecretKey(),
    migrations: [...MEMORY_MIGRATIONS],
  });
  const dao = createMemoryDao({
    db: store.sqlite(),
    now: () => nowMs,
    warn: () => {},
    newId: () => `m${++idSeq}`,
  });
  const tools = createMemoryTools({ dao, ...(ownerKeys ? { ownerKeys } : {}) });
  return { dao, tools };
}

/** 工具名索引 */
function byName(tools: ToolDefinition[], name: string): ToolDefinition {
  const t = tools.find((x) => x.name === name);
  if (!t) throw new Error(`工具缺席：${name}`);
  return t;
}

/** 执行并取文本单帧（execute 永不抛——错误走 isError 面） */
async function run(tool: ToolDefinition, args: Record<string, unknown>, sessionId?: string) {
  const ctx: ToolContext = { toolCallId: 'tc-test', ...(sessionId ? { sessionId } : {}) };
  const r: AgentToolResult = await tool.execute(args, ctx);
  expect(r.content).toHaveLength(1);
  const block = r.content[0]!;
  expect(block.type).toBe('text');
  return { text: block.type === 'text' ? block.text : '', isError: r.isError === true };
}

/** 简报写入一条标准候选（绕工具面直落 DAO——前置态制造位） */
function seed(dao: MemoryDao, overrides: Record<string, unknown> = {}): string {
  return dao.ingest({
    ownerKey: 'global',
    kind: 'preference',
    summary: 'user prefers pnpm for package management',
    content: 'user prefers pnpm for package management in all repositories',
    confidence: 0.8,
    sourceRefs: [{ sessionId: 's1', seq: 1 }],
    ...overrides,
  }).id;
}

describe('名册与 effect 分账', () => {
  it('九件成组 + 名序 + 写六读三', () => {
    const { tools } = setup();
    expect(tools.map((t) => t.name)).toEqual([
      'memory_write',
      'memory_forget',
      'memory_restore',
      'memory_read',
      'memory_search',
      'memory_freeze',
      'memory_unfreeze',
      'memory_ttl',
      'memory_access_log',
    ]);
    const writes = tools.filter((t) => t.effect === 'write').map((t) => t.name);
    const reads = tools.filter((t) => t.effect === 'read').map((t) => t.name);
    expect(writes).toEqual([
      'memory_write',
      'memory_forget',
      'memory_restore',
      'memory_freeze',
      'memory_unfreeze',
      'memory_ttl',
    ]);
    expect(reads).toEqual(['memory_read', 'memory_search', 'memory_access_log']);
  });

  it('参数面根 object + additionalProperties: false 全九件（03 §10.6 收口同律）', () => {
    const { tools } = setup();
    for (const t of tools) {
      const schema = t.parameters as { type?: string; additionalProperties?: boolean };
      expect(schema.type, t.name).toBe('object');
      expect(schema.additionalProperties, t.name).toBe(false);
    }
  });
});

describe('memory_write', () => {
  it('独立插入回执（动作文案 + 条目行双面）+ 落库 + 会话溯源 seq=0', async () => {
    const { dao, tools } = setup();
    const r = await run(
      byName(tools, 'memory_write'),
      { kind: 'preference', summary: 'user prefers pnpm', content: 'pnpm everywhere' },
      'sess-42',
    );
    expect(r.isError).toBe(false);
    expect(r.text).toContain('已入库（独立新条目）：');
    expect(r.text).toMatch(/\[m:m1\] \[preference\] user prefers pnpm  id=m1/);
    const row = dao.get('m1')!;
    expect(row.ownerKey).toBe('global'); // scope 缺省 = global
    expect(row.sourceRefs).toEqual([{ sessionId: 'sess-42', seq: 0 }]); // 会话首事件位
  });

  it('scope=project 解析 project: 键；缺席响亮拒 MEMORY_ENTRY_INVALID', async () => {
    const { dao, tools } = setup(['global', 'project:abcd1234abcd1234']);
    const ok = await run(byName(tools, 'memory_write'), {
      kind: 'fact',
      summary: 'repo uses pnpm',
      content: 'pnpm lockfile',
      scope: 'project',
    });
    expect(ok.isError).toBe(false);
    expect(dao.get('m1')!.ownerKey).toBe('project:abcd1234abcd1234');

    const bare = setup(); // ownerKeys 缺省 = 仅 global——project 域缺席
    const bad = await run(byName(bare.tools, 'memory_write'), {
      kind: 'fact',
      summary: 'repo uses pnpm',
      content: 'pnpm lockfile',
      scope: 'project',
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toMatch(/^\[MEMORY_ENTRY_INVALID\]/);
    expect(bare.dao.listVisible()).toEqual([]); // 零写入
  });

  it('ttlDays 落钟；secret 命中拒写 [MEMORY_SECRET_DETECTED]', async () => {
    const { dao, tools } = setup();
    const ttl = await run(byName(tools, 'memory_write'), {
      kind: 'fact',
      summary: 'temp note',
      content: 'scratch',
      ttlDays: 7,
    });
    expect(ttl.isError).toBe(false);
    expect(dao.get('m1')!.expiresAt).toBe(nowMs + 7 * 86_400_000);

    const secret = await run(byName(tools, 'memory_write'), {
      kind: 'fact',
      summary: 'has key',
      content: 'AWS key = AKIAIOSFODNN7EXAMPLE',
    });
    expect(secret.isError).toBe(true);
    expect(secret.text).toMatch(/^\[MEMORY_SECRET_DETECTED\]/);
    expect(dao.listVisible()).toHaveLength(1); // 拒写零入库
  });

  it('合并腿回执（evidence 吸收文案）', async () => {
    const { tools } = setup();
    const write = byName(tools, 'memory_write');
    await run(write, { kind: 'preference', summary: 'user prefers pnpm', content: 'pnpm' });
    const second = await run(write, { kind: 'preference', summary: 'user prefers pnpm', content: 'pnpm' });
    expect(second.isError).toBe(false);
    expect(second.text).toContain('精确合并');
    expect(second.text).toContain('id=m1'); // 并入既有——id 不变
  });
});

describe('持有面动词回执', () => {
  it('memory_forget：用户腿/搬家腿/frozen 拒/缺席拒', async () => {
    const { dao, tools } = setup();
    const forget = byName(tools, 'memory_forget');
    const id = seed(dao);
    const r = await run(forget, { id });
    expect(r.text).toContain('已忘掉：');
    expect(r.text).toContain('终态来源=user');
    expect(dao.get(id)!.status).toBe('dismissed');

    const id2 = seed(dao, { summary: 'second entry', content: 'second' });
    const moved = await run(forget, { id: id2, promotedToSkill: 'pnpm-conventions' });
    expect(moved.text).toContain('终态来源=skill:pnpm-conventions');

    const id3 = seed(dao, { summary: 'third', content: 'third' });
    const frozen = await run(byName(tools, 'memory_freeze'), { id: id3 });
    expect(frozen.text).toContain('已冻结：');
    const denied = await run(forget, { id: id3 });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/^\[MEMORY_FROZEN\]/);

    const ghost = await run(forget, { id: 'ghost' });
    expect(ghost.isError).toBe(true);
    expect(ghost.text).toMatch(/^\[MEMORY_NOT_FOUND\]/);
  });

  it('memory_restore：回执现行版本号 + 重算钟呈现', async () => {
    const { dao, tools } = setup();
    const id = seed(dao, { ttlDays: 7 });
    dao.forget(id);
    nowMs += 86_400_000;
    const r = await run(byName(tools, 'memory_restore'), { id });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('已复活（现行版本 r1）：');
    expect(r.text).toContain('过期='); // 过期钟呈现位在场
    expect(dao.get(id)!.status).toBe('active');
  });

  it('memory_ttl：设天/转永久回执 + frozen 拒', async () => {
    const { dao, tools } = setup();
    const ttl = byName(tools, 'memory_ttl');
    const id = seed(dao, { ttlDays: 30 });
    const set = await run(ttl, { id, days: 7 });
    expect(set.text).toContain('留存已调整：');
    expect(set.text).toContain('留存=7d');
    expect(dao.get(id)!.expiresAt).toBe(nowMs + 7 * 86_400_000);
    const forever = await run(ttl, { id, days: null });
    expect(forever.text).toContain('留存=永久');
    expect(dao.get(id)!.expiresAt).toBeNull();
    dao.freeze(id);
    const denied = await run(ttl, { id, days: 5 });
    expect(denied.isError).toBe(true);
    expect(denied.text).toMatch(/^\[MEMORY_FROZEN\]/);
  });
});

describe('读面三件', () => {
  it('memory_read 无 id：简报/最近变更/健康面三段', async () => {
    const { dao, tools } = setup();
    seed(dao);
    const r = await run(byName(tools, 'memory_read'), {});
    expect(r.isError).toBe(false);
    expect(r.text).toContain('常驻简报（1 条——冻结恒驻在前）：');
    expect(r.text).toMatch(/\[m:m1\] \[preference\]/);
    expect(r.text).toContain('最近变更（top 1）：');
    expect(r.text).toContain('健康面：active=1');
  });

  it('memory_read 带 id：现行值/全文/溯源/版本链；缺席 isError', async () => {
    const { dao, tools } = setup();
    const id = seed(dao, { sourceRefs: [{ sessionId: 's9', seq: 12 }] });
    const r = await run(byName(tools, 'memory_read'), { id });
    expect(r.text).toContain(`全文：user prefers pnpm for package management in all repositories`);
    expect(r.text).toContain('溯源：s9:12');
    expect(r.text).toContain('版本链（1 节）：');
    expect(r.text).toContain('r1');
    expect(r.text).toContain('insert');
    const ghost = await run(byName(tools, 'memory_read'), { id: 'ghost' });
    expect(ghost.isError).toBe(true);
    expect(ghost.text).toMatch(/^\[MEMORY_NOT_FOUND\]/);
  });

  it('memory_search：命中行 score 呈现 + 流水注记 + DB 落账；零命中免惊', async () => {
    const { dao, tools } = setup();
    seed(dao);
    seed(dao, { summary: 'repo uses vitest', content: 'vitest fast' });
    const r = await run(byName(tools, 'memory_search'), { query: 'pnpm' });
    expect(r.isError).toBe(false);
    expect(r.text).toContain('命中 1 条（相关度降序）：');
    expect(r.text).toMatch(/id=m1  score=-\d/);
    expect(r.text).toContain('（命中已记入访问流水 memory_access(op=search)）');
    const empty = await run(byName(tools, 'memory_search'), { query: 'nonexistent' });
    expect(empty.isError).toBe(false);
    expect(empty.text).toContain('（无命中');
    // 流水两行（一次命中 + 零命中不落账）
    const log = dao.accessLog();
    expect(log.flow).toHaveLength(1);
    expect(log.flow[0]).toMatchObject({ memoryId: 'm1', op: 'search' });
  });

  it('memory_access_log：双面回执（聚合 + 流水）与过滤参位', async () => {
    const { dao, tools } = setup();
    seed(dao);
    seed(dao, { summary: 'repo uses vitest', content: 'vitest fast' });
    await run(byName(tools, 'memory_search'), { query: 'pnpm' });
    await run(byName(tools, 'memory_search'), { query: 'vitest' });
    const r = await run(byName(tools, 'memory_access_log'), {});
    expect(r.text).toContain('被用条目 top 2（总次数降序）：');
    expect(r.text).toMatch(/recall=0 search=1 cite=0  total=1  id=m1/);
    expect(r.text).toContain('访问流水（2 行，时间降序）：');
    const scoped = await run(byName(tools, 'memory_access_log'), { memoryId: 'm1', op: 'search' });
    expect(scoped.text).toContain('访问流水（1 行，时间降序）：');
    const none = await run(byName(tools, 'memory_access_log'), { op: 'cite' });
    expect(none.text).toContain('（聚合面空——窗口内无访问记录）');
  });
});
