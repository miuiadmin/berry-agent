/**
 * memory 提取即时路测试（批 18c-3——06 §4：触发词矩阵/机器源滤除三形
 * 白名单/块文本提取/候选形全档/编排件真库全环含幂等与尽力而为吞）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ephemeralSecretKey, openStore, type Store } from '../persist/index.js';
import {
  buildCorrectionCandidate,
  createImmediateExtractor,
  detectCorrectionHit,
  isEligibleUserSource,
  userTextOf,
} from './extract.js';
import { createMemoryDao, type MemoryDao } from './dao.js';
import { MEMORY_MIGRATIONS } from './migration.js';

let dir: string;
let store: Store | null = null;
let nowMs: number;
let idSeq = 0;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-memory-extract-'));
  nowMs = Date.parse('2026-09-08T08:00:00.000Z');
  idSeq = 0;
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 真库装配（编排件全环用） */
function openDao(): MemoryDao {
  store = openStore({
    dbPath: join(dir, 'test.db'),
    dataDir: dir,
    secretKey: ephemeralSecretKey(),
    migrations: [...MEMORY_MIGRATIONS],
  });
  return createMemoryDao({
    db: store.sqlite(),
    now: () => nowMs,
    warn: () => {},
    newId: () => `m${++idSeq}`,
  });
}

describe('detectCorrectionHit（触发词矩阵）', () => {
  it('中文命中（取首——表序即优先序）', () => {
    const hit = detectCorrectionHit('不对，应该用 pnpm 不是 npm');
    expect(hit).not.toBeNull();
    expect(hit!.trigger).toBe('不对');
    expect(hit!.text).toBe('不对，应该用 pnpm 不是 npm');
  });

  it('英文命中（小写归一子串——撇形两拼各证）', () => {
    expect(detectCorrectionHit("That's WRONG, use vitest")!.trigger).toBe("that's wrong");
    expect(detectCorrectionHit('THATS WRONG again')!.trigger).toBe('thats wrong');
    expect(detectCorrectionHit('No, I said use the other branch')!.trigger).toBe('no, i said');
    expect(detectCorrectionHit('Scratch that, new plan')!.trigger).toBe('scratch that');
  });

  it('非命中（正常表述零触发）', () => {
    expect(detectCorrectionHit('好的没问题，我继续')).toBeNull();
    expect(detectCorrectionHit('the weather is fine today')).toBeNull();
    expect(detectCorrectionHit('')).toBeNull();
  });
});

describe('isEligibleUserSource（机器源滤除三形白名单）', () => {
  it('入检三形：缺省 / user / channel:*', () => {
    expect(isEligibleUserSource(undefined)).toBe(true);
    expect(isEligibleUserSource('user')).toBe(true);
    expect(isEligibleUserSource('channel:webui')).toBe(true);
  });

  it('机器载体一律跳过（06 §4 细则全列）', () => {
    expect(isEligibleUserSource('schedule')).toBe(false);
    expect(isEligibleUserSource('subagent-settled')).toBe(false);
    expect(isEligibleUserSource('subagent-approval-pending')).toBe(false);
    expect(isEligibleUserSource('compaction')).toBe(false);
    expect(isEligibleUserSource('plugin:memory')).toBe(false);
  });

  it('未知字面量归 user 同视（05 §3.1 读侧向前兼容——与「缺省视为 user」同形）', () => {
    expect(isEligibleUserSource('legacy-literal')).toBe(true);
  });
});

describe('userTextOf（消息纯文本面提取）', () => {
  it('string 直取；空串不入检', () => {
    expect(userTextOf('hello')).toBe('hello');
    expect(userTextOf('')).toBeNull();
  });

  it('块数组拼 text 块（thinking/image 块无关）；纯图像 null', () => {
    const imageBlock = { type: 'image', data: 'base64' }; // 变量引用——真实块形带 data，窄面只读 type/text
    const blocks = [
      { type: 'text', text: '不对' },
      { type: 'thinking', thinking: 'internal' },
      { type: 'text', text: '应走 pnpm' },
      imageBlock,
    ];
    expect(userTextOf(blocks)).toBe('不对\n应走 pnpm');
    expect(userTextOf([imageBlock])).toBeNull();
  });
});

describe('buildCorrectionCandidate（候选形全档——06 §4 细则）', () => {
  it('kind correction / 置信 0.7 / owner 恒 global / 精确事件位溯源 / 摘要形确定', () => {
    const hit = { trigger: '不对', text: '不对，包管理器用 pnpm' };
    const c = buildCorrectionCandidate(hit, 'sess-7', 42);
    expect(c).toMatchObject({
      ownerKey: 'global',
      kind: 'correction',
      confidence: 0.7,
      sourceRefs: [{ sessionId: 'sess-7', seq: 42 }],
    });
    expect(c.summary).toBe('用户纠正：不对，包管理器用 pnpm');
    expect(c.content).toBe('不对，包管理器用 pnpm');
  });

  it('超长文本：摘要截 100 + 省略尾；content 截至帽内（同文本恒同串——exact 合并幂等键）', () => {
    const long = '不对'.padEnd(300, '长');
    const a = buildCorrectionCandidate({ trigger: '不对', text: long }, 's', 1);
    const b = buildCorrectionCandidate({ trigger: '不对', text: long }, 's', 1);
    expect(a.summary).toBe(b.summary);
    expect(a.summary.length).toBeLessThanOrEqual(120); // 前缀 5 + 100 + 省略号 1
    expect(a.summary.endsWith('…')).toBe(true);
    expect(a.content.length).toBeLessThanOrEqual(20_000); // MEMORY_CONTENT_MAX_CHARS 帽内
  });
});

describe('createImmediateExtractor（编排件真库全环）', () => {
  it('命中落库（ingest 单点——合并管线/写前扫描内置）+ 精确事件位', () => {
    const dao = openDao();
    const ex = createImmediateExtractor({ dao });
    const r = ex.onUserMessage('sess-1', 7, { content: '不对，测试跑 vitest 不是 jest' });
    expect(r.extracted).toBe(true);
    const rows = dao.listVisible();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'correction', ownerKey: 'global', confidence: 0.7 });
    expect(rows[0]!.sourceRefs).toEqual([{ sessionId: 'sess-1', seq: 7 }]);
  });

  it('同文本重放：exact 合并幂等吸收（evidence+1 不另立条目）', () => {
    const dao = openDao();
    const ex = createImmediateExtractor({ dao });
    const data = { content: '不对，风格用双空格缩进' };
    ex.onUserMessage('s', 1, data);
    ex.onUserMessage('s', 9, data); // 重放（resume 场景）
    const rows = dao.listVisible();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.evidenceCount).toBe(2);
    expect(rows[0]!.sourceRefs).toHaveLength(2); // refs 并集（两事件位都留痕）
  });

  it('源滤除与无命中：零写入', () => {
    const dao = openDao();
    const ex = createImmediateExtractor({ dao });
    expect(ex.onUserMessage('s', 1, { content: '不对', source: 'compaction' }).extracted).toBe(false);
    expect(ex.onUserMessage('s', 2, { content: '不对', source: 'plugin:foo' }).extracted).toBe(false);
    expect(ex.onUserMessage('s', 3, { content: '一切正常' }).extracted).toBe(false);
    const imageBlock = { type: 'image', data: 'x' };
    expect(ex.onUserMessage('s', 4, { content: [imageBlock] }).extracted).toBe(false);
    expect(dao.listVisible()).toEqual([]);
  });

  it('secret 命中拒写：尽力而为 warn 吞不反噬（会话流绝不觉察）', () => {
    const dao = openDao();
    const warns: string[] = [];
    const ex = createImmediateExtractor({ dao, warn: (m) => warns.push(m) });
    const r = ex.onUserMessage('s', 1, { content: '不对，密钥是 AKIAIOSFODNN7EXAMPLE 才对' });
    expect(r.extracted).toBe(false);
    expect(warns).toHaveLength(1);
    expect(warns[0]).toContain('即时路提取失败');
    expect(dao.listVisible()).toEqual([]); // 写前扫描拒写零入库
  });

  it('不同纠正文本各立条目（每次纠正是一条知识）', () => {
    const dao = openDao();
    const ex = createImmediateExtractor({ dao });
    ex.onUserMessage('s', 1, { content: '不对，包管理用 pnpm' });
    ex.onUserMessage('s', 2, { content: '别再用 jest，用 vitest' });
    expect(dao.listVisible()).toHaveLength(2);
  });
});
