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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { TerminalIO } from '../channels/index.js';
import type { SessionEvent } from '../contracts/index.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { fauxProvider } from '../llm/index.js';
import { Persistence, resolveDatabasePathIn } from '../persist/index.js';
import { deriveMessages } from '../session/index.js';

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

/** reindex/导出面种子 events 行（重建/导出面真源——surface 类别 user/message 才入索引；同 dbPath 隔离律） */
async function seedEventRows(
  dbPath: string,
  sessionId: string,
  events: readonly {
    seq: number;
    type: string;
    data: string;
    /** 事件时刻（缺省 0——测试确定性） */
    time?: number;
    /** 可忽略标记（0/1——缺省 0） */
    ignorable?: number;
    /** 遮蔽指令 JSON（缺省 NULL——导出金样形携带 surfaceOp 载体的种子位） */
    surfaceOp?: string | null;
    /** 溯源 seq 数组 JSON（缺省 NULL） */
    sourceEventSeqs?: string | null;
  }[],
): Promise<void> {
  const persistence = Persistence.open({ dbPath, migrations: HOST_MIGRATION_TAIL });
  try {
    const db = persistence.store.sqlite();
    const insert = db.prepare(
      `INSERT INTO events (session_id, seq, type, time, data, ignorable, surface_op, source_event_seqs)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const e of events) {
      insert.run(
        sessionId,
        e.seq,
        e.type,
        e.time ?? 0,
        e.data,
        e.ignorable ?? 0,
        e.surfaceOp ?? null,
        e.sourceEventSeqs ?? null,
      );
    }
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
    expect(text).toContain('共 2 个会话（按更新时间倒序）：'); // 头行收紧形：全量已呈现无注记（超窗才注「仅显示最近 N 个」）
    expect(text).toContain('aaa-root');
    expect(text).toContain('根会话');
    expect(text).toContain('fork←aaa-root'); // 血缘统一式：origin←parentId
    expect(text).toContain('（无标题）'); // 无标题不造占位内容串（03 §10.6 sessions 词面同律）
    expect(text).toContain('2023-11-14T'); // ISO 确定性时间形态
  });

  it('list 截断披露：总数超 100 窗 → 头行报全量总数 + 仅显示最近 100（B2 修前红）', async () => {
    const dbPath = join(rigDir('sess-list-cap-'), 'sessions.db');
    await seedSessionRows(
      dbPath,
      Array.from({ length: 105 }, (_, i) => ({
        id: `cap-${String(i).padStart(3, '0')}`,
        title: `压窗会话 ${i}`,
        origin: 'conversation',
        created: 1_700_000_000_000 + i,
        updated: 1_700_000_100_000 + i,
      })),
    );
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'list' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    const text = cap.out.join('\n');
    // 修前红：头行总数谎报 rows.length（100）而非全量（105）
    expect(text).toContain('共 105 个会话（按更新时间倒序，仅显示最近 100 个）');
    expect(text).not.toContain('cap-000'); // updated 倒序——最旧一条在窗外
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

  it('标题净化双保险：存量脏 title（逃逸序列/控制字节/零宽-only）渲染剥除不外发终端', async () => {
    // 存量行形态：旧码物化的脏 title 已在库（写路净化只保新写——此面兜旧账）
    const dbPath = join(rigDir('sess-list-san-'), 'sessions.db');
    await seedSessionRows(dbPath, [
      // CSI 色码 + OSC 改窗题夹带：终端会解释的逃逸序列原样外发即伪控制
      { id: 'san-esc', title: '\x1b[31m红\x1b[0m 标题', origin: 'conversation', created: 1, updated: 2 },
      // 零宽-only title：不可见字符——净化归空须走（无标题）兜底（诚实呈现）
      { id: 'san-zero', title: '\u200b\u200c\u200d', origin: 'conversation', created: 1, updated: 2 },
      // 干净 title 原样（净化不误伤正常行）
      { id: 'san-clean', title: '干净标题', origin: 'conversation', created: 1, updated: 2 },
    ]);
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'list' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    const text = cap.out.join('\n');
    // 修前红①：ESC/C0 控制字节原样外发（终端可解释——清屏/改窗题复发）
    expect(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(text)).toBe(false);
    // 修前红②：序列剥除后可打印残段（[31m）不落行
    expect(text).not.toContain('[31m');
    expect(text).toContain('红 标题');
    // 修前红③：零宽-only title 非空不走（无标题）——净化归空后兜底在场
    expect(text).toContain('（无标题）');
    expect(text).toContain('干净标题');
    expect(text).toContain('san-zero');
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

  it('窗外命中行标题点查——>1000 行 listSessions 批反查修前红锁（56eb53e 族第二清剿位）', async () => {
    // 修前红：标题面原走 listSessions({limit:1000}) 批反查建表——updated_at
    // 落窗外的命中行 titles.get 落空，标题误呈「（无标题）」。修形 = 逐命中
    // getSessionRow 点查（WHERE id=? 恒命中，无窗）。
    const dbPath = join(rigDir('sess-search-win-'), 'sessions.db');
    const rows: {
      id: string;
      title: string | null;
      origin: string;
      created: number;
      updated: number;
    }[] = [{ id: 's-old', title: '窗外目标标题', origin: 'conversation', created: 1, updated: 1 }];
    for (let i = 0; i < 1000; i++) {
      rows.push({ id: `filler-${i}`, title: null, origin: 'conversation', created: 2, updated: 2 + i });
    }
    await seedSessionRows(dbPath, rows);
    await seedFtsRows(dbPath, 's-old', [{ seq: 1, body: 'needle 在窗外目标行' }]);
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'search', query: 'needle' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    const text = cap.out.join('\n');
    expect(text).toContain('s-old');
    // 修前红：窗外命中行标题误呈「（无标题）」
    expect(text).toContain('窗外目标标题');
    expect(text).not.toContain('（无标题）');
  });

  it('命中行标题同净化（list 双保险同律——脏 title 不经命中行外发）', async () => {
    const dbPath = join(rigDir('sess-search-san-'), 'sessions.db');
    await seedSessionRows(dbPath, [
      { id: 's-dirty', title: '\x1b[31m脏\x1b[0m 命中会话', origin: 'conversation', created: 1, updated: 2 },
    ]);
    await seedFtsRows(dbPath, 's-dirty', [{ seq: 1, body: '藏着 needle 的正文' }]);
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'search', query: 'needle' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    const text = cap.out.join('\n');
    expect(text).toContain('s-dirty');
    // 修前红：命中行标题原样外发（ESC 在场 + 残段 [31m 落行）
    expect(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(text)).toBe(false);
    expect(text).not.toContain('[31m');
    expect(text).toContain('脏 命中会话');
  });

  it('snippet 正文净化：投影原文的逃逸序列/控制字节/零宽字素不外发终端（title 面同族）', async () => {
    const dbPath = join(rigDir('sess-search-body-san-'), 'sessions.db');
    await seedSessionRows(dbPath, [
      { id: 's-body', title: '正文会话', origin: 'conversation', created: 1, updated: 2 },
    ]);
    // 索引投影原文夹带（needle 保持空白定界——trigram 命中面与既有测同形）：
    // CSI 色码 + OSC 改窗题 + NUL 控制字节 + 零宽字素——直发 processStdout
    // 终端可解释（清屏/改窗题——snippet 面与 title 面（titleOf）同族）
    await seedFtsRows(dbPath, 's-body', [
      {
        seq: 2,
        body: '\x1b[31m红色\x1b[0m 前缀填充 needle 命中词 \x00零字节\u200b注入 \x1b]0;窗题注入\x07 结尾',
      },
    ]);
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'search', query: 'needle' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    const text = cap.out.join('\n');
    expect(text).toContain('命中 1 处');
    expect(text).toContain('needle');
    // 修前红①：ESC/C0/DEL/C1 控制字节原样外发（终端可解释——清屏/改窗题复发）
    expect(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/.test(text)).toBe(false);
    // 修前红②：序列剥除后可打印残段不落行 + OSC 改窗题整段剥除
    expect(text).not.toContain('[31m');
    expect(text).not.toContain('窗题注入');
    // 修前红③：零宽字素剥除后可见残文邻接成串（剥除前被零宽隔断）
    expect(text).toContain('零字节注入');
    expect(text).toContain('红色 前缀填充'); // 序列剥除后正文邻接保真
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
    expect(text).toContain(`续接：berry sessions resume ${newId}`);

    // 库面验证：血缘三元组 + 种子事件（createSeededSession 同步落库——id 必
    // 可读）。探针锚定 dataDir（与装配面同解析——库文件路径随显式 dataDir）
    const persistence = Persistence.open({
      dbPath: resolveDatabasePathIn(dataDir),
      dataDir,
      migrations: HOST_MIGRATION_TAIL,
    });
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

/* ---------------- export（CLI 对等位——零装配直开库 + 拼装单源两消费） ---------------- */

describe('sessions export（07 §4.1 命令面增补批 C2——CLI 对等位）', () => {
  it('导出落盘 exports/<id>-<时间戳>.md；回执一行路径；内容 = 文档头 + 轮次', async () => {
    const dataDir = rigDir('sess-exp-data-'); // 落盘目录恒随 dataDir（dbPath 梯子独立）
    const dbPath = join(rigDir('sess-exp-db-'), 'sessions.db');
    await seedSessionRows(dbPath, [
      { id: 's-exp', title: '导出会话', origin: 'conversation', created: 1_700_000_000_000, updated: 2 },
    ]);
    await seedEventRows(dbPath, 's-exp', [
      { seq: 0, type: 'user/message', data: JSON.stringify({ content: '导出探针问' }) },
      {
        seq: 1,
        type: 'assistant/message',
        data: JSON.stringify({ content: [{ type: 'text', text: '导出探针答' }], stopReason: 'end' }),
      },
    ]);
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'export', id: 's-exp', format: 'markdown' },
      { version: 'test', dataDir, dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    // 回执一行路径（/memory-export 同形）——路径 = dataDir/exports/<id>-<时间戳>.md
    const receipt = cap.out.join('\n');
    expect(receipt).toContain('已导出 2 事件 → ');
    const path = receipt.split(' → ')[1]!;
    expect(path).toContain(join(dataDir, 'exports', 's-exp-'));
    // 落盘内容 = 拼装单源全文（与 TUI /export 同一 renderSessionMarkdown）
    const markdown = readFileSync(path, 'utf8');
    expect(markdown).toContain('# 会话导出 `s-exp`');
    expect(markdown).toContain('- 标题：导出会话');
    expect(markdown).toContain('## 轮次 1');
    expect(markdown).toContain('导出探针问');
    expect(markdown).toContain('导出探针答');
  });

  it('缺席 id：SESSION_NOT_FOUND 干净退 1 不落盘', async () => {
    const dataDir = rigDir('sess-exp-miss-data-');
    const dbPath = join(rigDir('sess-exp-miss-db-'), 'sessions.db');
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'export', id: 'no-such-id', format: 'markdown' },
      { version: 'test', dataDir, dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(1);
    expect(cap.err.join('\n')).toContain('SESSION_NOT_FOUND：会话不存在（no-such-id）');
    expect(existsSync(join(dataDir, 'exports'))).toBe(false); // 拒在落盘前——不造 exports 目录
  });
});

/* ---------------- export --format jsonl + import（05 §5.1 导出/导入对偶动词面） ---------------- */

/**
 * 对偶面夹具事件：一轮完整对话 + 一条遮蔽载体（信封 surfaceOp——历史保真
 * 射界含被遮历史；compaction/surface 是注册词汇的遮蔽指令载体本尊）。
 */
const dualEvents: readonly {
  seq: number;
  type: string;
  data: unknown;
  surfaceOp?: { op: 'replace'; start: number; end: number };
  sourceEventSeqs?: number[];
}[] = [
  { seq: 0, type: 'turn/start', data: {} },
  { seq: 1, type: 'user/message', data: { content: '对偶问' } },
  { seq: 2, type: 'assistant/message', data: { content: [{ type: 'text', text: '对偶答' }], stopReason: 'end' } },
  { seq: 3, type: 'turn/end', data: { reason: 'completed' } },
  {
    seq: 4,
    type: 'compaction/surface',
    data: {},
    surfaceOp: { op: 'replace', start: 1, end: 3 },
    sourceEventSeqs: [1, 2, 3],
  },
];

/** 夹具 → seedEventRows 行形（data/信封 JSON 列序列化） */
function dualSeedRows(): { seq: number; type: string; data: string; surfaceOp?: string; sourceEventSeqs?: string }[] {
  return dualEvents.map((e) => ({
    seq: e.seq,
    type: e.type,
    data: JSON.stringify(e.data),
    ...(e.surfaceOp !== undefined ? { surfaceOp: JSON.stringify(e.surfaceOp) } : {}),
    ...(e.sourceEventSeqs !== undefined ? { sourceEventSeqs: JSON.stringify(e.sourceEventSeqs) } : {}),
  }));
}

describe('sessions export --format jsonl（对偶动词面第一动词——事件级金样）', () => {
  it('导出 .jsonl：首行 _meta 裸对象 + 事件每行原样（surfaceOp 载体随流走）；回执一行路径', async () => {
    // 修前红：SessionsCommand export 变体尚无 format 位 / runExport 尚无 jsonl
    // 分支——产物恒 .md（.endsWith('.jsonl') 断言红）
    const dataDir = rigDir('sess-jsonl-data-');
    const dbPath = join(rigDir('sess-jsonl-db-'), 'sessions.db');
    await seedSessionRows(dbPath, [
      { id: 's-jsonl', title: '金样会话', origin: 'conversation', created: 1_700_000_000_000, updated: 2 },
    ]);
    await seedEventRows(dbPath, 's-jsonl', dualSeedRows());
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'export', id: 's-jsonl', format: 'jsonl' },
      { version: 'test', dataDir, dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    const receipt = cap.out.join('\n');
    expect(receipt).toContain('已导出 5 事件 → ');
    const path = receipt.split(' → ')[1]!;
    expect(path.endsWith('.jsonl')).toBe(true);
    // 产物结构：_meta 首行（裸对象——身份与版本恒等）+ 5 事件行 + 尾空行
    const lines = readFileSync(path, 'utf8').split('\n');
    expect(lines).toHaveLength(5 + 2);
    const meta = JSON.parse(lines[0]!);
    expect(meta.format).toBe('berry-agent/session');
    expect(meta.version).toBe(1);
    expect(typeof meta.exportedAt).toBe('number');
    // 遮蔽载体信封原样（surfaceOp/sourceEventSeqs——被遮历史保真）
    const carrier = JSON.parse(lines[5]!);
    expect(carrier.type).toBe('compaction/surface');
    expect(carrier.surfaceOp).toEqual({ op: 'replace', start: 1, end: 3 });
    expect(carrier.sourceEventSeqs).toEqual([1, 2, 3]);
  });
});

describe('sessions import（第九动词——四闸 + 种子前缀拷贝重建；round-trip = v1 验收基准）', () => {
  /** 造导入文件（金样形：_meta 首行 + 事件行；行内容直拼——拒档腿的坏行注入位） */
  function writeImportFile(dir: string, name: string, lines: readonly string[]): string {
    const path = join(dir, name);
    writeFileSync(path, `${lines.join('\n')}\n`, 'utf8');
    return path;
  }

  it('round-trip：export jsonl 产物 → import 新库 → 行 origin=import + 事件信封逐字段保真 + 投影 deep equal（含被遮历史）', async () => {
    // 修前红：runSessionsEntry 尚无 import case——switch 落穿返回 undefined（code 断言红）
    // 源库：种对偶夹具会话 → 导出 jsonl（CLI 全链）
    const dataDir = rigDir('sess-rt-data-');
    const dbPath = join(rigDir('sess-rt-db-'), 'sessions.db');
    await seedSessionRows(dbPath, [
      { id: 's-rt', title: '往返会话', origin: 'conversation', created: 1_700_000_000_000, updated: 2 },
    ]);
    await seedEventRows(dbPath, 's-rt', dualSeedRows());
    const capExp = capture();
    expect(
      await runSessionsEntry(
        { sub: 'export', id: 's-rt', format: 'jsonl' },
        { version: 'test', dataDir, dbPath, writeOut: capExp.writeOut, writeErr: capExp.writeErr },
      ),
    ).toBe(0);
    const jsonlPath = capExp.out.join('\n').split(' → ')[1]!;
    // 导入到全新库（跨库迁移形——对偶动词面的独立第二事实源）
    const dbPath2 = join(rigDir('sess-rt-db2-'), 'sessions.db');
    const capImp = capture();
    expect(
      await runSessionsEntry(
        { sub: 'import', file: jsonlPath },
        { version: 'test', dbPath: dbPath2, writeOut: capImp.writeOut, writeErr: capImp.writeErr },
      ),
    ).toBe(0);
    const receipt = capImp.out.join('\n');
    expect(receipt).toContain('已导入 5 事件 → 新会话 ');
    const newId = receipt.split('新会话 ')[1]!.split('\n')[0]!.trim();
    expect(receipt).toContain(`berry sessions resume ${newId}`); // 回执指路续接
    // 库面验证：行血缘 origin=import + seedLength + 事件等长 seq 0..4 不重编
    const sourceEvents: SessionEvent[] = readFileSync(jsonlPath, 'utf8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .slice(1)
      .map((line) => JSON.parse(line) as SessionEvent);
    const persistence = Persistence.open({ dbPath: dbPath2, migrations: HOST_MIGRATION_TAIL });
    let rebuilt: readonly SessionEvent[];
    try {
      const row = persistence.store.getSessionRow(newId);
      expect(row?.origin).toBe('import');
      expect(row?.seedLength).toBe(5);
      rebuilt = persistence.loadSession(newId).log.events();
    } finally {
      await persistence.close();
    }
    expect(rebuilt.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(rebuilt).toEqual(sourceEvents); // 信封逐字段（含 surfaceOp 遮蔽载体）保真
    // round-trip 承诺：投影等价（deriveMessages 单源 fold——被遮历史重放保真）
    expect(deriveMessages(rebuilt)).toEqual(deriveMessages(sourceEvents));
  });

  it('拒档分立：坏 format / 包裹形首行 / 未知事件词 / 坏 data 形状 / 配对缺 → 各码退 1；文件缺席退 1', async () => {
    // 修前红：import 动词在现码上落穿（undefined 退出码 ≠ 1）
    const dir = rigDir('sess-imp-rej-');
    const dbPath = join(dir, 'sessions.db');
    const meta = JSON.stringify({ format: 'berry-agent/session', version: 1, exportedAt: 1 });
    const cases: readonly { name: string; lines: readonly string[]; expectText: string }[] = [
      {
        name: 'bad-format.jsonl',
        lines: [
          JSON.stringify({ format: 'evil/format', version: 1 }),
          JSON.stringify({ type: 'turn/start', seq: 0, time: 0, data: {} }),
        ],
        expectText: 'SESSION_IMPORT_BAD_FORMAT',
      },
      {
        // 包裹形首行（{"_meta":{...}}）——header 直判 format 必拒（非本实现认识形）
        name: 'wrapped.jsonl',
        lines: [
          JSON.stringify({ _meta: { format: 'berry-agent/session', version: 1 } }),
          JSON.stringify({ type: 'turn/start', seq: 0, time: 0, data: {} }),
        ],
        expectText: 'SESSION_IMPORT_BAD_FORMAT',
      },
      {
        name: 'unknown-type.jsonl',
        lines: [meta, JSON.stringify({ type: 'nope/ghost', seq: 0, time: 0, data: {} })],
        expectText: 'SESSION_UNKNOWN_EVENT_TYPE',
      },
      {
        name: 'bad-shape.jsonl',
        lines: [meta, JSON.stringify({ type: 'assistant/message', seq: 0, time: 0, data: { content: '非块数组' } })],
        expectText: 'SESSION_IMPORT_BAD_FORMAT',
      },
      {
        name: 'orphan-end.jsonl',
        lines: [meta, JSON.stringify({ type: 'turn/end', seq: 0, time: 0, data: { reason: 'completed' } })],
        expectText: 'SESSION_IMPORT_BAD_FORMAT',
      },
    ];
    for (const c of cases) {
      const path = writeImportFile(dir, c.name, c.lines);
      const cap = capture();
      const code = await runSessionsEntry(
        { sub: 'import', file: path },
        { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
      );
      expect(code, c.name).toBe(1);
      expect(cap.err.join('\n'), c.name).toContain(c.expectText);
    }
    // 文件缺席：人读句退 1（读文件步先于一切闸）
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'import', file: join(dir, 'ghost.jsonl') },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(1);
    expect(cap.err.join('\n')).toContain('ghost.jsonl');
  });
});

describe('sessions rename（2026-09-30 人面改名批——CLI 第七动词；净化+200 帽与 TUI /rename 同一 clampTitleText 单源）', () => {
  /** 种子后重开库读 title 列（裸 SQL——写面真形态验证） */
  async function titleOf(dbPath: string, id: string): Promise<string | null> {
    const persistence = Persistence.open({ dbPath, migrations: HOST_MIGRATION_TAIL });
    try {
      return (
        (
          persistence.store.sqlite().prepare('SELECT title FROM sessions WHERE id = ?').get(id) as
            { title: string | null } | undefined
        )?.title ?? null
      );
    } finally {
      await persistence.close();
    }
  }

  it('改名成功：回执 + 库行 title 真改', async () => {
    const dbPath = join(rigDir('sess-rn-db-'), 'sessions.db');
    await seedSessionRows(dbPath, [
      { id: 's-rn', title: '旧名', origin: 'conversation', created: 1_700_000_000_000, updated: 2 },
    ]);
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'rename', id: 's-rn', title: '新名' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    expect(cap.out.join('\n')).toContain('已改名：s-rn → 新名');
    expect(await titleOf(dbPath, 's-rn')).toBe('新名'); // 库行真改
  });

  it('净化+200 帽：控制字节剥除 + 超长硬截（码点对齐——与首问快照同帽）', async () => {
    const dbPath = join(rigDir('sess-rn-cap-db-'), 'sessions.db');
    await seedSessionRows(dbPath, [{ id: 's-rn2', title: null, origin: 'conversation', created: 1, updated: 2 }]);
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'rename', id: 's-rn2', title: `\x1b[2J${'甲'.repeat(210)}` },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    expect(await titleOf(dbPath, 's-rn2')).toBe('甲'.repeat(200)); // ANSI 剥除 + 200 帽
  });

  it('净化归空：拒不落库退 1（库行原值不动）', async () => {
    const dbPath = join(rigDir('sess-rn-empty-db-'), 'sessions.db');
    await seedSessionRows(dbPath, [{ id: 's-rn3', title: '原题', origin: 'conversation', created: 1, updated: 2 }]);
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'rename', id: 's-rn3', title: '\x1b[2J\x07\u200b' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(1);
    expect(cap.err.join('\n')).toContain('空格/零宽字符等看不见的内容');
    expect(await titleOf(dbPath, 's-rn3')).toBe('原题'); // 未落库
  });

  it('缺席 id：会话不存在干净退 1', async () => {
    const dbPath = join(rigDir('sess-rn-miss-db-'), 'sessions.db');
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'rename', id: 'no-such-id', title: '新名' },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(1);
    expect(cap.err.join('\n')).toContain('会话不存在：no-such-id');
  });
});

/* ---------------- delete（05 §2.5 定形注④——第八动词两段式，零装配直开库） ---------------- */

describe('sessions delete（零装配直开库——两段式 --confirm）', () => {
  /** 种一个可删会话（裸 SQL 三表齐种——三删断言面全真：sessions/events/session_fts） */
  async function seedDeletable(dbPath: string, id: string, title: string): Promise<void> {
    await seedSessionRows(dbPath, [{ id, title, origin: 'conversation', created: 1, updated: 2 }]);
    await seedEventRows(dbPath, id, [{ seq: 0, type: 'turn/start', data: '{}' }]);
    await seedFtsRows(dbPath, id, [{ seq: 0, body: '待删正文' }]);
  }

  /** 三表残留读（重开只读库——命令是短命进程形，断言走重开面） */
  async function residueOf(dbPath: string, id: string): Promise<{ row: unknown; events: number; fts: number }> {
    const persistence = Persistence.open({ dbPath, migrations: HOST_MIGRATION_TAIL });
    try {
      const db = persistence.store.sqlite();
      const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(id);
      const events = db.prepare('SELECT COUNT(*) AS n FROM events WHERE session_id = ?').get(id) as { n: number };
      const fts = db.prepare('SELECT COUNT(*) AS n FROM session_fts WHERE session_id = ?').get(id) as { n: number };
      return { row, events: events.n, fts: fts.n };
    } finally {
      await persistence.close();
    }
  }

  it('无 --confirm 只读报告：既有清单字段 + export 留底提示 + 指路加 --confirm 退 0（库行不动）', async () => {
    const dbPath = join(rigDir('sess-del-ro-'), 'sessions.db');
    await seedDeletable(dbPath, 'del-ro', '待删只读');
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'delete', id: 'del-ro', confirm: false },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    const text = cap.out.join('\n');
    expect(text).toContain('del-ro'); // 既有清单字段（id/标题）
    expect(text).toContain('待删只读');
    expect(text).toContain('sessions export'); // 留底提示（既有 markdown 导出载体）
    expect(text).toContain('--format jsonl'); // 留底提示升级（05 §5.1 对偶动词面批——无损留底指路金样形）
    expect(text).toContain('--confirm'); // 指路确认旗标
    const residue = await residueOf(dbPath, 'del-ro');
    expect(residue.row).toBeDefined(); // 零删——只读报告档
    expect(residue.events).toBe(1);
    expect(residue.fts).toBe(1);
  });

  it('--confirm 直删：三表齐清 + 竞窗警示句（持有进程先关——孤儿写笔披露）退 0', async () => {
    const dbPath = join(rigDir('sess-del-go-'), 'sessions.db');
    await seedDeletable(dbPath, 'del-go', '待删真删');
    const cap = capture();
    const code = await runSessionsEntry(
      { sub: 'delete', id: 'del-go', confirm: true },
      { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
    );
    expect(code).toBe(0);
    const text = cap.out.join('\n');
    expect(text).toContain('已删除');
    expect(text).toContain('先关闭'); // 竞窗诚实披露（运行中进程后续写笔落库成孤儿行）
    const residue = await residueOf(dbPath, 'del-go');
    expect(residue.row).toBeUndefined(); // sessions 行
    expect(residue.events).toBe(0); // events 三删
    expect(residue.fts).toBe(0); // session_fts 三删
  });

  it('缺席 id 诚实拒退 1（两段同律——confirm 前后皆干净拒）', async () => {
    const dbPath = join(rigDir('sess-del-miss-'), 'sessions.db');
    for (const confirm of [false, true]) {
      const cap = capture();
      const code = await runSessionsEntry(
        { sub: 'delete', id: 'ghost', confirm },
        { version: 'test', dbPath, writeOut: cap.writeOut, writeErr: cap.writeErr },
      );
      expect(code).toBe(1);
      expect(cap.err.join('\n')).toContain('会话不存在：ghost');
    }
  });
});
