/**
 * host/sessions-cmd 测试——批 20d 会话管理命令族（07 §5 定名五子动词）。
 *
 * - 读腿（list/search/reindex）：零装配直开库（HOST_MIGRATION_TAIL 链尾
 *   单源）——种子走裸 SQL（读面只消费 sessions/session_fts/events 三表，
 *   INSERT 形即消费面真形态；schedule 列 canonical JSON 教训不涉此三表）；
 * - fork：全装配真机（faux provider 落一真会话 → CLI 面 fork → 库面验血缘
 *   三元组与种子事件——session_before_fork 钩子装载面真跑）；
 * - resume：非 TTY 卫兵退 2；缺席 id 经 TUI 装配面干净退 1（不造新会话——
 *   按 id 续接打错 id 不得落入 cwd 取最新新建路径）。
 *
 * 纪律：mock 只停在模型层（faux provider）；库/装载/管理器全真。resume
 * 续接 happy path 归 tui-entry.test（FakeTerminalIO 全 harness 在彼）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { TerminalIO } from '../channels/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';
import { Persistence } from '../persist/index.js';

import { assembleHostStack } from './assembly.js';
import { HOST_MIGRATION_TAIL } from './runtime.js';
import { runSessionsEntry } from './sessions-cmd.js';

/* ---------------- 测试基建 ---------------- */

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 造临时目录（统一入清账） */
function rigDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** 零用量终态 assistant 消息（faux 响应脚本用） */
function messageOf(): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 输出收集 rig（writeOut/writeErr 注入位） */
function capture(): {
  out: string[];
  err: string[];
  writeOut: (t: string) => void;
  writeErr: (t: string) => void;
} {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, writeOut: (t) => out.push(t), writeErr: (t) => err.push(t) };
}

/** TerminalIO 全 no-op 替身（resume 缺席 id 路径——选会话失败先于屏起，零真终端接触） */
class NullIO implements TerminalIO {
  write(): void {}
  size(): { columns: number; rows: number } {
    return { columns: 100, rows: 24 };
  }
  setRawMode(): void {}
  isRaw(): boolean {
    return false;
  }
  pause(): void {}
  resume(): void {}
  onInput(): () => void {
    return () => {};
  }
  onResize(): () => void {
    return () => {};
  }
}

/**
 * 读腿种子会话行（裸 SQL——list/search 消费面真形态）。种子/命令同库同径：
 * 显式 dbPath 隔离（缺省梯子 = 测试进程钉扎根——同文件共享，全局断言会互
 * 撞；读腿断言是全局形故必须独立库文件）。
 */
async function seedSessionRows(
  dbPath: string,
  rows: readonly {
    id: string;
    title: string | null;
    origin: string;
    parentId?: string;
    created: number;
    updated: number;
  }[],
): Promise<void> {
  const persistence = Persistence.open({ dbPath, migrations: HOST_MIGRATION_TAIL });
  try {
    const db = persistence.store.sqlite();
    const insert = db.prepare(
      `INSERT INTO sessions (id, title, origin, parent_id, seed_length, workspace_root, created_at, updated_at, last_seq)
       VALUES (?, ?, ?, ?, 0, NULL, ?, ?, 0)`,
    );
    for (const r of rows) insert.run(r.id, r.title, r.origin, r.parentId ?? null, r.created, r.updated);
  } finally {
    await persistence.close();
  }
}

/** 读腿种子 FTS 行（body = 索引投影原文——search 消费面真形态；同 dbPath 隔离律） */
async function seedFtsRows(
  dbPath: string,
  sessionId: string,
  hits: readonly { seq: number; body: string }[],
): Promise<void> {
  const persistence = Persistence.open({ dbPath, migrations: HOST_MIGRATION_TAIL });
  try {
    const db = persistence.store.sqlite();
    const insert = db.prepare(`INSERT INTO session_fts (session_id, seq, body) VALUES (?, ?, ?)`);
    for (const h of hits) insert.run(sessionId, h.seq, h.body);
  } finally {
    await persistence.close();
  }
}

/** reindex 种子 events 行（重建面唯一真源——surface 类别 user/message 才入索引；同 dbPath 隔离律） */
async function seedEventRows(
  dbPath: string,
  sessionId: string,
  events: readonly { seq: number; type: string; data: string }[],
): Promise<void> {
  const persistence = Persistence.open({ dbPath, migrations: HOST_MIGRATION_TAIL });
  try {
    const db = persistence.store.sqlite();
    const insert = db.prepare(
      `INSERT INTO events (session_id, seq, type, time, data, ignorable, surface_op, source_event_seqs)
       VALUES (?, ?, ?, 0, ?, 0, NULL, NULL)`,
    );
    for (const e of events) insert.run(sessionId, e.seq, e.type, e.data);
  } finally {
    await persistence.close();
  }
}

/** 真会话种子（全装配 + 一轮对话——fork 的源会话；write-behind 落库后关账） */
async function seedRealSession(dataDir: string, ws: string): Promise<string> {
  const faux = fauxProvider({ provider: 'faux-seed', models: [{ id: 'm1' }] });
  faux.setResponses([() => messageOf()]);
  const assembly = await assembleHostStack({
    runtime: { dataDir },
    noPlugins: false,
    debug: false,
    version: 'test',
    providers: [faux.provider],
    model: 'faux-seed/m1',
    env: {},
  });
  if (!assembly.ok) throw new Error(`装配失败：${assembly.message}`);
  try {
    const sessionId = assembly.stack.manager.create({ workspaceRoot: canonicalWorkspaceRoot(ws) }).sessionId;
    const run = assembly.stack.submitText(sessionId, '源会话探针', { source: 'user' });
    if (run === undefined) throw new Error('提交无回执');
    await run; // settle + shutdown flush——durable 落库完备
    return sessionId;
  } finally {
    await assembly.runtime.shutdown();
  }
}

/* ---------------- list（读腿零装配） ---------------- */

describe('sessions list（读腿零装配）', () => {
  it('清单含 id/标题/时间/血缘——fork 血缘箭头形 + 无标题占位 + ISO 时间', async () => {
    const dbPath = join(rigDir('sess-list-'), 'sessions.db');
    await seedSessionRows(dbPath, [
      {
        id: 'aaa-root',
        title: '根会话',
        origin: 'conversation',
        created: 1_700_000_000_000,
        updated: 1_700_000_100_000,
      },
      {
        id: 'bbb-fork',
        title: null,
        origin: 'fork',
        parentId: 'aaa-root',
        created: 1_700_000_050_000,
        updated: 1_700_000_099_000,
      },
    ]);
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'list' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    const text = cap.out.join('\n');
    expect(text).toContain('共 2 个会话');
    expect(text).toContain('aaa-root');
    expect(text).toContain('根会话');
    expect(text).toContain('fork←aaa-root'); // 血缘统一式：origin←parentId
    expect(text).toContain('（无标题）'); // 无标题不造占位内容串（03 §10.6 sessions 词面同律）
    expect(text).toContain('2023-11-14T'); // ISO 确定性时间形态
  });

  it('空库诚实空退 0', async () => {
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'list' },
      {
        version: 'test',
        dbPath: join(rigDir('sess-empty-'), 'sessions.db'),
        writeOut: cap.writeOut,
        writeErr: cap.writeErr,
      },
    );
    expect(code).toBe(0);
    expect(cap.out.join('\n')).toContain('无会话');
  });
});

/* ---------------- search（跨会话 FTS） ---------------- */

describe('sessions search（跨会话 FTS——bm25 序）', () => {
  it('命中行带 id/标题/#seq/snippet 切窗（长文验省略号）', async () => {
    const dbPath = join(rigDir('sess-search-'), 'sessions.db');
    await seedSessionRows(dbPath, [{ id: 's-hit', title: '检索会话', origin: 'conversation', created: 1, updated: 2 }]);
    // 长投影原文：藏针前后各超 30 字符——snippet 必切窗
    await seedFtsRows(dbPath, 's-hit', [
      { seq: 3, body: `前文填充${'甲'.repeat(40)} 藏针needle在这里 ${'乙'.repeat(40)}后文填充` },
    ]);
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'search', query: 'needle' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    const text = cap.out.join('\n');
    expect(text).toContain('命中 1 处');
    expect(text).toContain('s-hit');
    expect(text).toContain('检索会话');
    expect(text).toContain('#3'); // seq 定位（跳转/复核锚）
    expect(text).toContain('needle');
    expect(text).toContain('…'); // 切窗省略号（首现位 ±30）
  });

  it('零命中诚实空退 0', async () => {
    const dbPath = join(rigDir('sess-search0-'), 'sessions.db');
    await seedSessionRows(dbPath, [
      { id: 's-quiet', title: '静默会话', origin: 'conversation', created: 1, updated: 2 },
    ]);
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'search', query: 'needle' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    expect(cap.out.join('\n')).toContain('无命中');
  });
});

/* ---------------- reindex（FTS 全量重建） ---------------- */

describe('sessions reindex（FTS 全量重建——派生物不修不补）', () => {
  it('events 表重建入索引：漂移形态零命中 → 一键复位 → 检索可达', async () => {
    const dbPath = join(rigDir('sess-ridx-'), 'sessions.db');
    // 只种 events（surface 类别 user/message）不种 FTS——索引缺口即漂移形态
    await seedEventRows(dbPath, 's-rid', [
      { seq: 0, type: 'user/message', data: JSON.stringify({ content: '重建后可检的探针词', source: 'user' }) },
    ]);
    const before = capture();
    await runSessionsEntry(
      { sub: 'search', query: '重建后可检' },
      { version: 'test', dbPath, writeOut: before.writeOut, writeErr: before.writeErr },
    );
    expect(before.out.join('\n')).toContain('无命中'); // 漂移形态如实

    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'reindex' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    expect(cap.out.join('\n')).toContain('1 会话 / 1 事件入索引');

    const after = capture();
    await runSessionsEntry(
      { sub: 'search', query: '重建后可检' },
      { version: 'test', dbPath, writeOut: after.writeOut, writeErr: after.writeErr },
    );
    expect(after.out.join('\n')).toContain('s-rid'); // 重建即修复
  });
});

/* ---------------- fork（全装配真机） ---------------- */

describe('sessions fork（全装配——与 run --fork / TUI fork 同机）', () => {
  it('边界快照分叉：库面验血缘三元组 + 种子事件 + 续接指引', async () => {
    const dataDir = rigDir('sess-fork-data-');
    const ws = rigDir('sess-fork-ws-');
    const sourceId = await seedRealSession(dataDir, ws);

    const cap = capture();
    const faux = fauxProvider({ provider: 'faux-fork', models: [{ id: 'm1' }] });
    faux.setResponses([() => messageOf()]);
    const code = await runSessionsEntry(
      { sub: 'fork', id: sourceId },
      {
        version: 'test',
        dataDir,
        providers: [faux.provider],
        model: 'faux-fork/m1',
        env: {},
        writeOut: cap.writeOut,
        writeErr: cap.writeErr,
      },
    );
    expect(code).toBe(0);
    const text = cap.out.join('\n');
    expect(text).toContain(`已分叉：`);
    const newId = /已分叉：(\S+)/.exec(text)![1]!;
    expect(newId).not.toBe(sourceId);
    expect(text).toContain(`源会话 ${sourceId}`);
    expect(text).toContain(`续接：berry-agent sessions resume ${newId}`);

    // 库面验证：血缘三元组 + 种子事件（createSeededSession 同步落库——id 必
    // 可读）。探针走缺省梯子（与装配面同库——库文件路径归三级梯子单源）
    const persistence = Persistence.open({ migrations: HOST_MIGRATION_TAIL });
    try {
      const row = persistence.store.getSessionRow(newId);
      expect(row?.origin).toBe('fork');
      expect(row?.parentId).toBe(sourceId);
      const seedEvents = persistence.store.loadEvents(newId);
      expect(seedEvents.length).toBeGreaterThan(0);
      expect(text).toContain(`种子 ${seedEvents.length} 事件`); // 人读回执与库面同数
    } finally {
      await persistence.close();
    }
  });

  it('源缺席：干净退 1 + 人读指引（不写 crash.log）', async () => {
    const cap = capture();
    const faux = fauxProvider({ provider: 'faux-fork2', models: [{ id: 'm1' }] });
    const code = await runSessionsEntry(
      { sub: 'fork', id: 'no-such-session' },
      {
        version: 'test',
        dataDir: rigDir('sess-fork-miss-'),
        providers: [faux.provider],
        model: 'faux-fork2/m1',
        env: {},
        writeOut: cap.writeOut,
        writeErr: cap.writeErr,
      },
    );
    expect(code).toBe(1);
    const text = cap.err.join('\n');
    expect(text).toContain('会话不存在');
    expect(text).toContain('sessions list');
  });
});

/* ---------------- resume（进 TUI） ---------------- */

describe('sessions resume（进 TUI——resumeSessionId 载体）', () => {
  it('非 TTY 卫兵：退 2 + 指引改 run --session（07 §5 非 TTY 入口指引同律）', async () => {
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'resume', id: 'any' },
      {
        version: 'test',
        stdinIsTTY: false,
        stdoutIsTTY: true,
        writeOut: cap.writeOut,
        writeErr: cap.writeErr,
      },
    );
    expect(code).toBe(2);
    expect(cap.err.join('\n')).toContain('run --session');
  });

  it('缺席 id：经 TUI 装配面干净退 1（不造新会话）', async () => {
    const ws = rigDir('sess-res-miss-ws-'); // 唯一工作区根——断言精确定位键
    const cap = capture();
    const faux = fauxProvider({ provider: 'faux-res', models: [{ id: 'm1' }] });
    const code = await runSessionsEntry(
      { sub: 'resume', id: 'no-such-session' },
      {
        version: 'test',
        cwd: ws,
        stdinIsTTY: true,
        stdoutIsTTY: true,
        io: new NullIO(),
        providers: [faux.provider],
        model: 'faux-res/m1',
        env: {},
        writeOut: cap.writeOut,
        writeErr: cap.writeErr,
      },
    );
    expect(code).toBe(1);
    // 不造新会话：打错 id 不得落入 cwd 取最新新建路径（两选取键互补律的负
    // 例）。装配面库走缺省梯子（钉扎共享库）——按本测试唯一 workspaceRoot
    // 精确判（全局计数会被同文件他测污染）
    const persistence = Persistence.open({ migrations: HOST_MIGRATION_TAIL });
    try {
      expect(persistence.store.listSessions({ workspaceRoot: canonicalWorkspaceRoot(ws) })).toHaveLength(0);
    } finally {
      await persistence.close();
    }
  });
});
