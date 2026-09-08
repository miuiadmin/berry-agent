/**
 * L3 safety — Linux bwrap（bubblewrap）后端（04 §8 执行 seam 条）。
 *
 * 形态：拼 mount 参数。基础面 --ro-bind / /（全系统只读视图）+ 必要的虚拟
 * 设备与隔离挂载；逐根追加 --bind（真实读写）——/tmp 恒 tmpfs（临时面
 * 「能用不留痕」）。argv 生成纯函数可单测。
 */

import { spawnSync } from 'node:child_process';
import type { SandboxBackend } from './types.js';
import { resolvePolicyRoots, type SandboxPolicy } from './sandbox.js';

/**
 * bwrap argv 前缀（不含策略差异）：全系统只读 + 虚拟 /dev /proc + 隔离 PID
 * 命名空间。/tmp tmpfs 恒前置为第一条挂载：bwrap 按参数序建挂载，若 tmpfs
 * /tmp 出现在某 /tmp 子路径根的 bind 之后，会整树遮蔽该 bind（berry 刀四
 * CI 首跑红根因：bind 先、tmpfs 后 → 挂载点不可见；tmpfs 先、bind 后 →
 * bwrap 在 tmpfs 上自动造出 dest 挂载点，根正确露出——顺序即正确性）。
 */
function bwrapBaseArgs(): string[] {
  return [
    '--tmpfs',
    '/tmp',
    '--ro-bind',
    '/',
    '/',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--unshare-pid',
    '--die-with-parent',
  ];
}

/**
 * 敏感件读 deny 遮蔽参数（04 §7 读侧 carve-out + 2026-09-08 P0① 定形）：
 * `--ro-bind-try /dev/null <canonical 路径>` 逐件一对。要点：
 * - SRC 恒在场（/dev/null 必在）、DEST 由 bwrap 自建（不必预先存在）；
 *   `-try` 形 = DEST 缺席跳过不报错（保护面不含「目录不存在即失败」语义）；
 * - 后位遮蔽：mount 点后建遮蔽前挂载——必须排在全部既有 bind 之后（末位
 *   追加），否则被后续 bind 整树覆盖（顺序即正确性，与 base 的 tmpfs 前置
 *   同一律）；
 * - 遮蔽形下硬链攻击链结构性失败：link() 跨 mount 点对只读遮蔽源操作不可
 *   达（内核 errno 多形不钉死——实机核验定形）。
 */
function bwrapDenyArgs(policy: SandboxPolicy): string[] {
  const args: string[] = [];
  for (const p of policy.denyReadFiles ?? []) args.push('--ro-bind-try', '/dev/null', p);
  return args;
}

/**
 * 写 deny 遮蔽参数（04 §252 腿二——成熟度缺口 #9）：`--ro-bind-try <path>
 * <path>` 逐件一对——把宿主该路径**只读**挂载遮蔽沙箱内同名路径（写即
 * read-only file system 拒）。与读 deny 同律末位追加（后位遮蔽——排在全部
 * 既有 bind 之后）；`-try` 形 DEST 缺席跳过（.git 未建的会话新建可写——
 * 已文档化边界：新建仓非篡改既有版本史）。danger 档 `--bind / /` 后追加
 * 同律（底线不交档位）。
 */
function bwrapDenyWriteArgs(policy: SandboxPolicy): string[] {
  const args: string[] = [];
  for (const p of policy.denyWritePaths ?? []) args.push('--ro-bind-try', p, p);
  return args;
}

/**
 * 按策略生成 bwrap 参数前缀（纯函数）。两档统一消费 resolvePolicyRoots——
 * 缺省按档位推导（read-only 空根 = 无 rw bind、workspace-write 工作区根族），
 * 显式 writableRoots 覆盖在两档同等生效（与 seatbeltProfile 同律）。不变式：
 * /tmp 恒 tmpfs 由 base 前缀承接；根恰为 /tmp 时跳过重复挂载；/tmp 子路径
 * 根在 tmpfs 之上 bind 露出（见 base 前缀注记）。读 deny 遮蔽行末位追加
 * （后位遮蔽——见 bwrapDenyArgs 注记）。
 *
 * danger 档形（04 §8 定形②「任何档一律」）：`--bind / /` 全盘真读写 +
 * /dev /proc + 遮蔽行——跳过 tmpfs /tmp 与 --ro-bind /（danger 不走只读基
 * 座）；--unshare-pid / --die-with-parent 卫生旗恒保留（/proc 同 uid 进程
 * 面结构性不可见——c-4 泄漏面③同判收口）。
 */
export function bwrapArgs(policy: SandboxPolicy): string[] {
  if (policy.mode === 'danger') {
    return [
      '--bind',
      '/',
      '/',
      '--dev',
      '/dev',
      '--proc',
      '/proc',
      '--unshare-pid',
      '--die-with-parent',
      ...bwrapDenyArgs(policy),
      ...bwrapDenyWriteArgs(policy),
    ];
  }
  const args = [...bwrapBaseArgs()];
  for (const root of resolvePolicyRoots(policy)) {
    // 可写根与 fs fence 同源；/tmp 已由 base tmpfs 覆盖，其余根真实 bind
    if (root !== '/tmp') args.push('--bind', root, root);
  }
  args.push(...bwrapDenyArgs(policy), ...bwrapDenyWriteArgs(policy));
  return args;
}

/**
 * 组装 Linux bwrap 后端。
 * 后端差异数据化下发：
 * - 策略拒绝 → stderr 含 "read-only file system"（只读 bind 上的写标准 errno 文案）；
 * - runner 自身失败（bwrap 未装/参数错/权限不够）→ stderr 前缀 "bwrap: "。
 */
export function createBwrapBackend(): SandboxBackend {
  return {
    id: 'bwrap',
    enforcement: 'full',
    denialSignatures: ['read-only file system'],
    runnerFailureRules: [{ fatalSignatures: ['bwrap: '] }],
    wrap(argv, policy) {
      return ['bwrap', ...bwrapArgs(policy), '--', ...argv];
    },
    probe(timeoutMs) {
      // 功能性探测：真跑一次 read-only 包装的 /bin/true——status 0 才算后端可用
      const confined = ['bwrap', ...bwrapArgs({ mode: 'read-only', workspaceRoot: '/' }), '--', '/bin/true'];
      const result = spawnSync(confined[0]!, confined.slice(1), { timeout: timeoutMs });
      return result.status === 0;
    },
  };
}
