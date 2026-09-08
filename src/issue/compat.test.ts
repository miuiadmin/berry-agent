/**
 * issue 兼容性互证——词面独立律的回归锁（词面独立于兄弟件、结构兼容真身、
 * 组合根闭包注入）：
 * - 真 JobRegistry 直接结构赋 IssueJobsFace（registerKind/register/settle/
 *   running——first-wins 语义真跑）；
 * - 真 WorktreeService（真 git 仓）赋 IssueWorktreeFace（create/grant/
 *   releaseSession 往返）；
 * - 真 Store 赋 IssueStoreStateFace（store_state 三法同名同形——水位读写）；
 * - 真 SchedulerService 经闭包适配 IssueSchedulerFace（addBuiltinJob 正门 +
 *   无行 no-op 摘钟语义）。
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ephemeralSecretKey, openStore } from '../persist/index.js';
import type { DangerApproveResult, DangerGateStatus } from '../safety/danger.js';
import { SCHEDULER_MIGRATION } from '../scheduler/migration.js';
import { createSchedulerService } from '../scheduler/service.js';
import { createJobRegistry } from '../subagent/index.js';
import { createWorktreeService } from '../tools/index.js';
import { watermarkKey } from './poll.js';
import type {
  IssueDangerFace,
  IssueDangerStatusFace,
  IssueJobsFace,
  IssueSchedulerFace,
  IssueStoreStateFace,
  IssueWorktreeFace,
} from './types.js';

let dir: string;
let repo: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'berry-issue-compat-'));
  repo = join(dir, 'repo');
  // 真 git 仓（主仓基底——worktree 派生面用；全同步建零窗口）
  execFileSync('git', ['init', '-b', 'main', repo]);
  execFileSync('git', ['config', 'user.email', 't@e.c'], { cwd: repo });
  execFileSync('git', ['config', 'user.name', 't'], { cwd: repo });
  writeFileSync(join(repo, 'a.txt'), 'v1\n');
  execFileSync('git', ['add', '.'], { cwd: repo });
  execFileSync('git', ['commit', '-m', 'init'], { cwd: repo });
});

afterEach(() => {
  // worktree 派生目录在 dir 内（repo 同级）——随 dir 一并清
  rmSync(dir, { recursive: true, force: true });
});

describe('真 JobRegistry ↔ IssueJobsFace（结构兼容）', () => {
  it('registerKind → register → running 可见 → settle first-wins', () => {
    const registry = createJobRegistry();
    const face: IssueJobsFace = registry; // 直接结构赋值——零适配
    face.registerKind('issue');
    const handle = face.register({ kind: 'issue', name: 'o/r#7', owner: 'issue-job:o/r#7' });
    expect(face.running().map((j) => j.name)).toEqual(['o/r#7']);
    expect(handle.settle({ status: 'completed', detail: 'draft' })).toBe(true); // first-wins 落
    expect(handle.settle({ status: 'failed', detail: '二次' })).toBe(false); // 终态后不可变
    expect(face.running()).toHaveLength(0);
  });
});

describe('真 WorktreeService ↔ IssueWorktreeFace（真 git 互证）', () => {
  it('create → grant → grantedRoots（经 releaseSession）往返 + list 枚举', async () => {
    const service = createWorktreeService({ repoRoot: repo });
    const face: IssueWorktreeFace = service; // 直接结构赋值
    const created = await face.create({ name: 'issue-7' });
    expect(created.branch).toBe('issue-7');
    expect(created.path).toContain(join(`${basename(repo)}-worktrees`, 'issue-7'));
    await face.grant({ sessionId: 'headless-1', path: created.path });
    const released = face.releaseSession('headless-1');
    expect(released).toEqual([created.path]); // 授予真记真收
    const listed = await face.list();
    expect(listed.map((e) => e.name)).toContain('issue-7');
    await face.clean({ name: 'issue-7' });
    expect((await face.list()).map((e) => e.name)).not.toContain('issue-7');
  });
});

describe('真 Store ↔ IssueStoreStateFace（store_state 同名三法）', () => {
  it('水位键读写删往返（poll.ts watermarkKey 直用）', () => {
    const store = openStore({
      dbPath: join(dir, 'state.db'),
      dataDir: join(dir, 'data'),
      secretKey: ephemeralSecretKey(),
    });
    const face: IssueStoreStateFace = store; // 直接结构赋值——三法同名同形
    const key = watermarkKey('o/r');
    expect(face.getStoreState(key)).toBeUndefined();
    face.setStoreState(key, '2026-09-06T00:00:00Z', { kind: 'issue-poll' });
    const entry = face.getStoreState(key);
    expect(entry?.value).toBe('2026-09-06T00:00:00Z'); // 真身返回 StoreStateEntry——value 位同形
    expect(entry?.kind).toBe('issue-poll');
    expect(face.deleteStoreState(key)).toBe(true);
    expect(face.getStoreState(key)).toBeUndefined();
  });
});

describe('真 SchedulerService ↔ IssueSchedulerFace（闭包适配）', () => {
  it('registerPollJob 建启用 builtin 行（' + 'issue-poll）；removePollJob 无行 no-op', () => {
    const store = openStore({
      dbPath: join(dir, 'sched.db'),
      dataDir: join(dir, 'data'),
      secretKey: ephemeralSecretKey(),
      migrations: [SCHEDULER_MIGRATION],
    });
    const { service } = createSchedulerService({
      db: store.sqlite(),
      now: () => '2026-09-07T00:00:00.000Z',
      warn: () => undefined,
    });
    // 装配根闭包适配位（组合根形态——issue 件不见 SchedulerService）
    const face: IssueSchedulerFace = {
      registerPollJob: (req) => service.addBuiltinJob({ ...req, enabled: true }),
      removePollJob: (name) => {
        if (service.getJob(name) !== undefined) service.removeJob(name); // 无行 no-op 语义
      },
    };
    face.registerPollJob({ name: 'issue-poll', schedule: 'every:120s', prompt: '(builtin) 占位' });
    const row = service.getJob('issue-poll');
    expect(row).toMatchObject({ builtin: true, enabled: true }); // builtin 行 + 即挂钟
    expect(row?.nextFireAt).not.toBe(null); // 启用即排刻
    face.removePollJob('issue-poll');
    expect(service.getJob('issue-poll')).toBeUndefined();
    expect(() => face.removePollJob('issue-poll')).not.toThrow(); // 二次摘（无行 no-op）
  });
});

describe('危险闸真身 ↔ IssueDangerFace（04 §13 词面独立律——类型级互证）', () => {
  it('DangerGateStatus 结构可赋 IssueDangerStatusFace；approve 结果形兼容窄面回执', () => {
    // status 产物直接结构赋值——consent/halt/cap/ledger 四块字段面全兼容
    const statusCompat = (s: DangerGateStatus): IssueDangerStatusFace => s;
    // approve 结果形：DangerApproveResult（多携 mandateHash/approvedAt）兼容窄面回执
    const approveCompat = (r: DangerApproveResult): { ok: true; expiresAt: number } | { ok: false; message: string } =>
      r;
    // 装配位组合形：deliver 回执 {prNumber?, prUrl?}——PR 真身字段映射窄面
    const deliverCompat = (pr: { number: number; htmlUrl: string }): Promise<{ prNumber?: number; prUrl?: string }> =>
      Promise.resolve({ prNumber: pr.number, prUrl: pr.htmlUrl });
    // 窄面闭包可由真身三动词直组（core-plugins 装配位形态的签名面证）
    const makeApproveResult = (ttlDays?: number): DangerApproveResult =>
      ({ ok: true, mandateHash: 'h', approvedAt: 1, expiresAt: (ttlDays ?? 30) * 86_400_000 }) as DangerApproveResult;
    const face: Pick<IssueDangerFace, 'approve' | 'status'> = {
      approve: async (ttlDays?: number) => approveCompat(makeApproveResult(ttlDays)),
      status: async () => statusCompat({} as DangerGateStatus),
    };
    void deliverCompat;
    void face;
    expect(true).toBe(true); // 类型级断言——编译期即验（typecheck 门禁承载）
  });
});
