/**
 * safety/seatbelt 真跑测试 — darwin 平台沙箱读 deny 执法回归锁（04 §7 读侧
 * carve-out + 04 §8 定形②——2026-09-08 P0①）。
 *
 * 与 sandbox.test 的分工：彼件只测参数面纯函数（不 spawn——平台无关跑）；
 * 本件在 darwin 真机上真 spawn sandbox-exec，验证拼出的 SBPL profile 内核
 * 真受理——deny file-read* 行不只「看起来对」而且「真的拒」。非 darwin 跳过
 * （describe.skip——Linux 面的等价真跑锁挂账 bwrap 后端，随 Linux CI 节奏）。
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSeatbeltBackend } from './seatbelt.js';

const run = promisify(execFile);

/** darwin 门控（真机沙箱只在 macOS 在场） */
const d = process.platform === 'darwin' ? describe : describe.skip;

d('seatbelt 真跑（读 deny 两档执法——fail-closed 无豁免）', () => {
  /**
   * canonical fixture：敏感件与邻件同目录（deny 是逐件 literal 不是目录域——
   * 邻件照常读即「精确到 basename」的真机证明）。路径必须 realpath 化
   * （macOS /var → /private/var：literal deny 对别名 miss）。
   */
  function denyRig(): { dir: string; secret: string } {
    const dir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'sb-deny-')));
    const secret = join(dir, 'secret.key');
    writeFileSync(secret, 'k3y-material');
    writeFileSync(join(dir, 'notes.txt'), 'fine');
    return { dir, secret };
  }

  it('danger 档（最小读 deny profile）：cat 敏感件拒、邻件照常读', { timeout: 15_000 }, async () => {
    const { dir, secret } = denyRig();
    try {
      const backend = createSeatbeltBackend();
      // danger 形 = (allow default) + deny 行——无拒写无逐根 allow，读 deny 仍在
      const denied = backend.wrap(['/bin/cat', secret], {
        mode: 'danger',
        workspaceRoot: dir,
        denyReadFiles: [secret],
      });
      // 拒绝面：cat 打不开文件 → 非零退出 + stderr 命中后端拒绝签名（归因链）
      const err = await run(denied[0]!, denied.slice(1)).catch((e: Error & { code?: number }) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as { code?: number }).code).not.toBe(0);
      expect((err as { stderr?: string }).stderr ?? '').toMatch(/operation not permitted/i);
      // 邻件照常读（deny 精确到件——不殃及同目录）
      const allowed = backend.wrap(['/bin/cat', join(dir, 'notes.txt')], {
        mode: 'danger',
        workspaceRoot: dir,
        denyReadFiles: [secret],
      });
      const r = await run(allowed[0]!, allowed.slice(1));
      expect(r.stdout).toBe('fine');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('workspace-write 档（deny 行末位追加）：cat 敏感件同样拒', { timeout: 15_000 }, async () => {
    const { dir, secret } = denyRig();
    try {
      const backend = createSeatbeltBackend();
      const confined = backend.wrap(['/bin/cat', secret], {
        mode: 'workspace-write',
        workspaceRoot: dir,
        writableRoots: [dir],
        denyReadFiles: [secret],
      });
      const err = await run(confined[0]!, confined.slice(1)).catch((e: Error & { code?: number }) => e);
      expect((err as { code?: number }).code).not.toBe(0);
      expect((err as { stderr?: string }).stderr ?? '').toMatch(/operation not permitted/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
