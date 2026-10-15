/**
 * ⎇ 槽统计纯函数件单测（挖掘 39 轮件 II——gitQuery 桩注入零真进程纪律；
 * footer 编排/缓存/竞窗锁在 tui-backend.test.ts 件 II describe，本面只锁
 * 纯函数族契约）。
 */
import { describe, expect, it } from 'vitest';
import {
  accumulateNumstat,
  computeBranchStats,
  orderRemotes,
  parseSymbolicRef,
  resolveDefaultRef,
  type GitQuery,
} from './branch-stats.js';

describe('branch-stats 纯函数族（挖掘 39 轮件 II）', () => {
  it('orderRemotes：origin 优先、余按原序、trim 空行滤、空输出空表', () => {
    expect(orderRemotes('upstream\norigin\nfork')).toEqual(['origin', 'upstream', 'fork']);
    expect(orderRemotes('  a \n\nb')).toEqual(['a', 'b']); // 行首尾空白归一 + 空行滤
    expect(orderRemotes('')).toEqual([]);
  });

  it('parseSymbolicRef：refs/remotes/<r>/<支> 合法形收（支名含斜杠在域）；非法形 null', () => {
    expect(parseSymbolicRef('refs/remotes/origin/main\n')).toBe('refs/remotes/origin/main'); // 尾换行 trim
    expect(parseSymbolicRef('refs/remotes/origin/feat/x')).toBe('refs/remotes/origin/feat/x'); // 支名含斜杠
    expect(parseSymbolicRef('refs/heads/main')).toBe(null); // 本地 ref 非 merge ref
    expect(parseSymbolicRef('')).toBe(null);
  });

  it('accumulateNumstat：tab 分界累加、binary − 行计 0、非法定界行跳过、空输出双零', () => {
    expect(accumulateNumstat('12\t3\ta.ts\n-\t-\tbin.png\n5\t0\tb.ts\n')).toEqual({ added: 17, removed: 3 });
    expect(accumulateNumstat('')).toEqual({ added: 0, removed: 0 }); // 在默认支（消费方按双零缺席形）
    expect(accumulateNumstat('\nnoise\n')).toEqual({ added: 0, removed: 0 }); // 空行/无 tab 行跳过
  });

  it('resolveDefaultRef：远端 symbolic-ref 命中短路（origin 优先序——upstream 腿未发）', async () => {
    const log: string[] = [];
    const q: GitQuery = async (args) => {
      log.push(args.join(' '));
      if (args[0] === 'remote') return { status: 0, stdout: 'upstream\norigin\n' };
      if (args[1] === 'refs/remotes/origin/HEAD') return { status: 0, stdout: 'refs/remotes/origin/main' };
      return { status: 1, stdout: '' };
    };
    await expect(resolveDefaultRef(q, '/w')).resolves.toBe('refs/remotes/origin/main');
    expect(log).toEqual(['remote', 'symbolic-ref refs/remotes/origin/HEAD']); // origin 优先 + 命中即短路
  });

  it('resolveDefaultRef：无 remotes 本地兜底 main 优先、master 次序、全未命中 null', async () => {
    const qMain: GitQuery = async (args) =>
      args[0] === 'remote'
        ? { status: 0, stdout: '' }
        : args[3] === 'refs/heads/main'
          ? { status: 0, stdout: 'm' }
          : { status: 1, stdout: '' };
    await expect(resolveDefaultRef(qMain, '/w')).resolves.toBe('refs/heads/main');
    const qMaster: GitQuery = async (args) =>
      args[0] === 'rev-parse' && args[3] === 'refs/heads/master'
        ? { status: 0, stdout: 'M' }
        : { status: 1, stdout: '' };
    await expect(resolveDefaultRef(qMaster, '/w')).resolves.toBe('refs/heads/master'); // main 不存在才走 master
    const qNone: GitQuery = async () => ({ status: 1, stdout: '' });
    await expect(resolveDefaultRef(qNone, '/w')).resolves.toBe(null);
  });

  it('computeBranchStats：四步管线全通累加透传', async () => {
    const ok: GitQuery = async (args) => {
      if (args[0] === 'rev-parse') return { status: 0, stdout: '.git' };
      if (args[0] === 'remote') return { status: 0, stdout: 'origin\n' };
      if (args[0] === 'symbolic-ref') return { status: 0, stdout: 'refs/remotes/origin/main' };
      if (args[0] === 'merge-base') return { status: 0, stdout: 'mb0000000000' };
      return { status: 0, stdout: '2\t1\tc.ts\n' };
    };
    await expect(computeBranchStats(ok, '/w')).resolves.toEqual({ added: 2, removed: 1 });
  });

  it('computeBranchStats：任一步失败 null（库判定/merge-base）；双零透传（在默认支）', async () => {
    const ok: GitQuery = async (args) => {
      if (args[0] === 'rev-parse') return { status: 0, stdout: '.git' };
      if (args[0] === 'remote') return { status: 0, stdout: 'origin\n' };
      if (args[0] === 'symbolic-ref') return { status: 0, stdout: 'refs/remotes/origin/main' };
      if (args[0] === 'merge-base') return { status: 0, stdout: 'mb' };
      return { status: 0, stdout: '7\t7\td.ts\n' };
    };
    // 库判定失败（非 git 目录——spawn 成功但非零码）
    const notRepo: GitQuery = async (args) =>
      args[1] === '--git-dir' ? { status: 128, stdout: '' } : { status: 0, stdout: '' };
    await expect(computeBranchStats(notRepo, '/w')).resolves.toBe(null);
    // merge-base 失败（默认支无共同祖——stale 形兜住整腿缺席）
    const badBase: GitQuery = async (args, cwd) =>
      args[0] === 'merge-base' ? { status: 1, stdout: '' } : ok(args, cwd);
    await expect(computeBranchStats(badBase, '/w')).resolves.toBe(null);
    // 双零（空 numstat——在默认支无累计差，缺席形判定归消费方）
    const zero: GitQuery = async (args, cwd) => (args[0] === 'diff' ? { status: 0, stdout: '' } : ok(args, cwd));
    await expect(computeBranchStats(zero, '/w')).resolves.toEqual({ added: 0, removed: 0 });
  });
});
