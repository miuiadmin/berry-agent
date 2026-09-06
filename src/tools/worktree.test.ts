/**
 * worktree 测试——三动词全程（真 git worktree 互证）/ 撞名两域 / dirty 拒与
 * force / 分支留史 / 会话授予面 / 树级写互斥双向握手（04 §7 worktree 条 +
 * 补钉①③的回归锁，批 16）。
 */
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { serializeTreeWrites, serializeWrites } from './fs.js';
import { createWorktreeService, createWorktreeTools } from './worktree.js';

const execFile = promisify(execFileCallback);

let repo: string;
let service: ReturnType<typeof createWorktreeService>;

/** 测试面 git 直调（装配独立于服务——互证非自证） */
async function git(args: string[]): Promise<string> {
  const { stdout } = await execFile('git', args, { cwd: repo });
  return stdout;
}

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), 'berry-worktree-'));
  await git(['init', '-b', 'main']);
  await git(['config', 'user.email', 'test@example.com']);
  await git(['config', 'user.name', 'test']);
  await writeFile(join(repo, 'a.txt'), 'v1\n', 'utf8');
  await git(['add', '.']);
  await git(['commit', '-m', 'init']);
  service = createWorktreeService({ repoRoot: repo });
});

afterEach(async () => {
  await rm(repo, { recursive: true, force: true });
  // worktree 落仓同级派生目录——一并清（缺席 no-op，force 兜底）
  await rm(join(dirname(repo), `${basename(repo)}-worktrees`), { recursive: true, force: true }).catch(() => undefined);
});

describe('三动词全程（真 git 互证）', () => {
  it('create → list → diffPatch → clean 往返', async () => {
    const created = await service.create({ name: 'wt-a' });
    expect(created.branch).toBe('wt-a');
    // 派生路径形：仓同级 <仓目录名>-worktrees/<name>
    expect(created.path.endsWith(join(`${basename(repo)}-worktrees`, 'wt-a'))).toBe(true);
    // 真侧互证：git 视角里 worktree 在册、分支检出
    const listed = await service.list();
    expect(listed.map((e) => e.name)).toContain('wt-a');
    expect(listed.find((e) => e.name === 'wt-a')?.branch).toBe('wt-a');
    expect(listed.map((e) => e.name)).toContain(basename(repo)); // 主仓项同列
    // 域内提交一笔 → diffPatch 对 main 出补丁
    await writeFile(join(created.path, 'b.txt'), 'new file\n', 'utf8');
    await execFile('git', ['add', '.'], { cwd: created.path });
    await execFile('git', ['commit', '-m', 'change'], { cwd: created.path });
    const patch = await service.diffPatch({ name: 'wt-a', baseRef: 'main' });
    expect(patch).toContain('b.txt');
    // clean 后不在册
    await service.clean({ name: 'wt-a' });
    expect((await service.list()).map((e) => e.name)).not.toContain('wt-a');
  });

  it('baseRef 腿：锚第一提交——内容回 v1', async () => {
    await writeFile(join(repo, 'a.txt'), 'v2\n', 'utf8');
    await git(['add', '.']);
    await git(['commit', '-m', 'second']);
    const created = await service.create({ name: 'wt-base', baseRef: 'HEAD~1' });
    const { readFile } = await import('node:fs/promises');
    expect(await readFile(join(created.path, 'a.txt'), 'utf8')).toBe('v1\n');
  });
});

describe('撞名两域（FS_WORKTREE_EXISTS）', () => {
  it('同名 worktree 目录在场拒', async () => {
    await service.create({ name: 'wt-dup' });
    await expect(service.create({ name: 'wt-dup' })).rejects.toMatchObject({ code: 'FS_WORKTREE_EXISTS' });
  });

  it('同名分支在场拒（分支与 worktree 同名域）', async () => {
    await git(['branch', 'wt-branch-only']);
    await expect(service.create({ name: 'wt-branch-only' })).rejects.toMatchObject({ code: 'FS_WORKTREE_EXISTS' });
  });

  it('名字词法拒（TOOL_INVALID_ARGS——禁分隔符/空名/坏首字符）', async () => {
    for (const bad of ['../evil', 'a/b', '', '.hidden', 'x'.repeat(65)]) {
      await expect(service.create({ name: bad })).rejects.toMatchObject({ code: 'TOOL_INVALID_ARGS' });
    }
  });
});

describe('clean 语义（防误清）', () => {
  it('缺席 worktree = FS_NOT_FOUND', async () => {
    await expect(service.clean({ name: 'nope' })).rejects.toMatchObject({ code: 'FS_NOT_FOUND' });
  });

  it('未提交变更拒 FS_WORKTREE_DIRTY；force 显式覆盖', async () => {
    const created = await service.create({ name: 'wt-dirty' });
    await writeFile(join(created.path, 'uncommitted.txt'), 'risky\n', 'utf8');
    await expect(service.clean({ name: 'wt-dirty' })).rejects.toMatchObject({ code: 'FS_WORKTREE_DIRTY' });
    await service.clean({ name: 'wt-dirty', force: true });
    expect((await service.list()).map((e) => e.name)).not.toContain('wt-dirty');
  });

  it('分支留史：clean 后同名分支仍在（交付物引用）', async () => {
    await service.create({ name: 'wt-keep' });
    await service.clean({ name: 'wt-keep' });
    const branches = await git(['branch', '--list', 'wt-keep']);
    expect(branches.trim()).toBe('wt-keep');
  });
});

describe('会话授予面（补钉①）', () => {
  it('create 携 sessionId 即授予；releaseSession 全收 + 二次空', async () => {
    const a = await service.create({ name: 'wt-g1', sessionId: 's1' });
    const b = await service.create({ name: 'wt-g2', sessionId: 's1' });
    expect(service.grantedRoots('s1').sort()).toEqual([a.path, b.path].sort());
    expect(service.grantedRoots('s2')).toEqual([]);
    const released = service.releaseSession('s1');
    expect(released.sort()).toEqual([a.path, b.path].sort());
    expect(service.grantedRoots('s1')).toEqual([]);
  });

  it('未携 sessionId 不授予（件侧记账与模型面同判据）', async () => {
    const a = await service.create({ name: 'wt-ng' });
    expect(a.path).not.toBe('');
    expect(service.grantedRoots('anyone')).toEqual([]);
  });

  it('grant 显式补授（编排路径——create 后拿到 sessionId 才授予）', async () => {
    const a = await service.create({ name: 'wt-grant' });
    expect(service.grantedRoots('headless-1')).toEqual([]);
    await service.grant({ sessionId: 'headless-1', path: a.path });
    await service.grant({ sessionId: 'headless-1', path: a.path }); // 幂等
    expect(service.grantedRoots('headless-1')).toEqual([a.path]);
    // create 携 sessionId 与 grant 双入口同记账面
    const b = await service.create({ name: 'wt-grant2', sessionId: 'headless-1' });
    expect(service.grantedRoots('headless-1').sort()).toEqual([a.path, b.path].sort());
    expect(service.releaseSession('headless-1')).toHaveLength(2);
  });
});

describe('树级写互斥（补钉③——serializeTreeWrites 双向握手）', () => {
  it('树操作在飞：域内文件写排队、域外不受牵连', async () => {
    const log: string[] = [];
    let releaseTree!: () => void;
    const gate = new Promise<void>((r) => {
      releaseTree = r;
    });
    const treeOp = serializeTreeWrites(join(repo, 'wt-root'), async () => {
      log.push('tree:start');
      await gate;
      log.push('tree:end');
    });
    await new Promise((r) => setTimeout(r, 0)); // 树已装占位
    const inner = serializeWrites([join(repo, 'wt-root', 'f.txt')], async () => {
      log.push('file:inner');
    });
    const outer = serializeWrites([join(repo, 'elsewhere.txt')], async () => {
      log.push('file:outer');
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(log).toEqual(['tree:start', 'file:outer']); // 域内等树、域外直行
    releaseTree();
    await Promise.all([treeOp, inner, outer]);
    expect(log).toEqual(['tree:start', 'file:outer', 'tree:end', 'file:inner']);
  });

  it('文件写在飞：树操作排队（反向握手）', async () => {
    const log: string[] = [];
    let releaseFile!: () => void;
    const gate = new Promise<void>((r) => {
      releaseFile = r;
    });
    const fileOp = serializeWrites([join(repo, 'wt-root', 'f.txt')], async () => {
      log.push('file:start');
      await gate;
      log.push('file:end');
    });
    await new Promise((r) => setTimeout(r, 0)); // 文件写已装占位
    const treeOp = serializeTreeWrites(join(repo, 'wt-root'), async () => {
      log.push('tree:inner');
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(log).toEqual(['file:start']); // 树等文件写
    releaseFile();
    await Promise.all([fileOp, treeOp]);
    expect(log).toEqual(['file:start', 'file:end', 'tree:inner']);
  });

  it('树失败也放行（finally 语义——锁不悬挂）', async () => {
    const op = serializeTreeWrites(join(repo, 'wt-x'), async () => {
      throw new Error('boom');
    });
    await expect(op).rejects.toThrow('boom');
    // 链已清——后续树/文件写不再等待
    const log: string[] = [];
    await serializeTreeWrites(join(repo, 'wt-x'), async () => {
      log.push('after');
    });
    expect(log).toEqual(['after']);
  });
});

describe('工具面（三件词面与 effect）', () => {
  it('worktree_create/list/clean——create 经 toolCtx.sessionId 自动授予', async () => {
    const tools = createWorktreeTools(service);
    const byName = new Map(tools.map((t) => [t.name, t]));
    expect([...byName.keys()].sort()).toEqual(['worktree_clean', 'worktree_create', 'worktree_list']);
    expect(byName.get('worktree_create')?.effect).toBe('write');
    expect(byName.get('worktree_list')?.effect).toBe('read');
    expect(byName.get('worktree_clean')?.effect).toBe('write');
    // create 工具腿：toolCtx.sessionId 透传授予
    const result = await byName
      .get('worktree_create')!
      .execute({ name: 'wt-tool' }, { sessionId: 'sess-1' } as Parameters<
        NonNullable<ReturnType<typeof createWorktreeTools>[0]['execute']>
      >[1]);
    expect(result.isError).not.toBe(true);
    expect(service.grantedRoots('sess-1')).toHaveLength(1);
    // list 工具腿出枚举文本
    const listResult = await byName.get('worktree_list')!.execute({}, {} as never);
    expect(JSON.stringify(listResult.content)).toContain('wt-tool');
    // clean 工具腿拆掉
    await byName.get('worktree_clean')!.execute({ name: 'wt-tool' }, {} as never);
    expect((await service.list()).map((e) => e.name)).not.toContain('wt-tool');
  });
});
