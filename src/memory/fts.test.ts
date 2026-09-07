/**
 * 批 18c-6 跨会话检索件测试——snippet 切窗矩阵（命中位前后窗/大小写不敏感/
 * 防御位退化）+ 激活期对账（clean 免重建 / 缺口即重建 / 对账失败不阻断装载）
 * + 词面独立律 compat 互证（真 Store 直传两 seam——结构兼容运行时+编译期双证）。
 *
 * 真库全环（openStore + writeEvents 写入对账参与断言）；LLM 零参与（本件纯检索面）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import {
  ephemeralSecretKey,
  openStore,
  type EventWrite,
  type SessionRegistration,
  type Store,
} from '../persist/index.js';
import type { SessionEvent } from '../contracts/index.js';
import { ensureFtsIndex, snippetOf } from './fts.js';
import type { FtsMaintenanceFace } from './types.js';

let dir: string;
let store: Store | null = null;
let nowMs: number;
let dbSeq = 0;
const warn = vi.fn();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-memory-fts-'));
  nowMs = Date.parse('2026-09-08T08:00:00.000Z');
  dbSeq = 0;
  warn.mockClear();
});

afterEach(() => {
  store?.close();
  store = null;
  rmSync(dir, { recursive: true, force: true });
});

/** 开真库（一 setup 一库文件——词面独立律 compat 互证用真 Store 本尊） */
function open(): Store {
  store = openStore({
    dbPath: join(dir, `test-${++dbSeq}.db`),
    dataDir: dir,
    secretKey: ephemeralSecretKey(),
  });
  return store;
}

const REG: SessionRegistration = {
  origin: 'conversation',
  parentId: undefined,
  seedLength: 0,
  workspaceRoot: '/tmp/ws',
  title: undefined,
};

/** 事件信封便捷构造 */
function ev(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: nowMs, data };
}

/** 写一批 surface 事件（写入对账同批同事务——fts 行即时可检；seq 自 0 起） */
function seed(sessionId: string, ...contents: string[]): void {
  const writes: EventWrite[] = contents.map((content, i) => ({
    sessionId,
    event: ev('user/message', i, { content, source: 'user' }),
    registration: REG,
  }));
  store!.writeEvents(writes);
}

describe('snippetOf（切窗纯函数——06 §10 定形注②）', () => {
  it('命中位居中：前 16 后 48 字符窗 + 两端省略号', () => {
    const body = `${'前'.repeat(40)}命中词${'后'.repeat(80)}`;
    const s = snippetOf(body, '命中词');
    expect(s.startsWith('…')).toBe(true);
    expect(s.endsWith('…')).toBe(true);
    // 窗长 = 前 16 + 命中词 3 + 后 48 = 67 字符 + 两端省略号
    expect(s).toHaveLength(16 + 3 + 48 + 2);
    expect(s).toContain('命中词');
  });

  it('命中位贴头/贴尾：单端省略号；短 body 全量无省略号', () => {
    expect(snippetOf('命中词开头就是', '命中词').startsWith('…')).toBe(false);
    expect(snippetOf(`尾部才是命中词${''}`, '命中词').endsWith('…')).toBe(false);
    expect(snippetOf('短文本命中词', '命中词')).toBe('短文本命中词'); // 无截断两端皆净
  });

  it('大小写不敏感定位（trigram 分词器对齐）+ 查询词剥引号', () => {
    const s = snippetOf('前置填充 PnpmWorkspace 后置填充', 'pnpmworkspace');
    expect(s).toContain('PnpmWorkspace'); // 定位到原文大小写、呈现保原文
    expect(snippetOf('带引号 "quoted" 词', '"quoted"')).toContain('quoted');
  });

  it('防御位：命中词缺席（或空查询）退化为 body 头窗', () => {
    const body = `${'防'.repeat(80)}尾部`; // 超 64 字符——头窗截断补省略号
    expect(snippetOf(body, '不存在的查询词')).toBe(`${body.slice(0, 64)}…`);
    expect(snippetOf(body, '""')).toBe(`${body.slice(0, 64)}…`);
  });
});

describe('ensureFtsIndex（激活期对账策略位——05 §9 对账第三档消费位）', () => {
  it('compat 互证：真 Store 直传 FtsMaintenanceFace（结构兼容编译期+运行时双证）', () => {
    const face: FtsMaintenanceFace = open(); // Store 即 seam——词面独立律
    seed('s-c', 'compat-token-here');
    const report = ensureFtsIndex({ face, warn });
    expect(report.audit.checked).toBe(1);
    expect(report.audit.mismatches).toEqual([]);
    expect(report.rebuilt).toBeUndefined(); // 干净——免重建
    expect(warn).not.toHaveBeenCalled();
  });

  it('缺口在场：抽样审计报缺口 → 全量重建即修复（派生物不修不补）', () => {
    open();
    seed('s-d', 'repairable-token-one', 'repairable-token-two');
    const dbPath = join(dir, `test-${dbSeq}.db`);
    store!.close();
    store = null;
    // 手删 fts 行制造缺口（重开裸库——persist 对账三档测试同法）
    const raw = new Database(dbPath);
    raw.exec(`DELETE FROM session_fts`);
    raw.close();
    const reopened = openStore({
      dbPath,
      dataDir: dir,
      secretKey: ephemeralSecretKey(),
    });
    store = reopened;
    const report = ensureFtsIndex({ face: reopened, warn });
    expect(report.audit.mismatches.length).toBeGreaterThan(0);
    expect(report.rebuilt).toBeDefined();
    expect(report.rebuilt!.events).toBe(2); // 两行重建
    expect(reopened.searchFtsGlobal('repairable-token-one')).toHaveLength(1);
    expect(warn).toHaveBeenCalledTimes(1); // 缺口 warn 观测面
  });

  it('对账失败不阻断装载：warn 吞 + 空报告（尽力而为）', () => {
    const face: FtsMaintenanceFace = {
      auditFts: () => {
        throw new Error('boom');
      },
      rebuildFts: () => ({ sessions: 0, events: 0 }),
    };
    const report = ensureFtsIndex({ face, warn });
    expect(report).toEqual({ audit: { checked: 0, mismatches: [] } });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('尽力而为');
  });
});
