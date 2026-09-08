/**
 * L3 safety — macOS Seatbelt 后端（04 §8 执行 seam 条：后端 = 数据 + 包装）。
 *
 * 形态：拼 SBPL profile 字符串，argv = ['sandbox-exec','-p',profile,'--',...argv]。
 * profile 生成是纯函数（可单测不 spawn）；probe 用功能性探测——真跑一次
 * read-only 包装（版本检查会漏「有 syscall 但拒绝执行」的内核形态）。
 */

import { spawnSync } from 'node:child_process';
import type { SandboxBackend } from './types.js';
import { resolvePolicyRoots, type SandboxPolicy } from './sandbox.js';

/** SBPL 字符串字面量转义（SBPL 语法内 " 与 \ 需反斜杠转义） */
function sbplString(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** read-only 基座 SBPL：全默认放行 + 拒写 + /dev/null 例外（大量 CLI 静默写 /dev/null） */
export function seatbeltReadOnlyProfile(): string {
  return ['(version 1)', '(allow default)', '(deny file-write*)', '(allow file-write* (literal "/dev/null"))'].join(
    '\n',
  );
}

/**
 * 敏感件读 deny 行（04 §7 读侧 carve-out + 2026-09-08 P0① 实机核验定形）：
 * `(deny file-read* (literal "<canonical 路径>"))` 逐件一行。要点：
 * - 末位追加——SBPL last-match-wins，末位 deny 压过此前一切 allow；
 * - literal 必须是符号链解析后的真实路径（/tmp 拼写字面 miss /private/tmp
 *   实体——denyReadFiles 数据源 sensitiveReadFiles 已 canonical 派生）；
 * - 单行 deny 结构性覆盖硬链攻击链：link() 对源路径即触发 file-read* 判定
 *   ——「链时即拦」，无需独立 link 算子（实机核验：ln 直接 Operation not
 *   permitted）。
 */
function seatbeltDenyLines(policy: SandboxPolicy): string[] {
  return (policy.denyReadFiles ?? []).map((p) => `(deny file-read* (literal ${sbplString(p)}))`);
}

/**
 * 按策略生成 SBPL profile（纯函数）。两档统一消费 resolvePolicyRoots——缺省
 * 按档位推导（read-only 空根 = 纯拒写、workspace-write 工作区根族），显式
 * writableRoots 覆盖在两档同等生效（字段契约本义：e1 式宿主只读档携刚需根
 * 即走此路——berry 真机冒烟实证原 mode 分支吃不到显式根的教训照搬防御）。
 *
 * danger 档形（04 §8 定形②「任何档一律」）：(version 1) + (allow default)
 * + 读 deny 行——无拒写、无逐根 allow；danger 同过最小读 deny profile。
 */
export function seatbeltProfile(policy: SandboxPolicy): string {
  const denies = seatbeltDenyLines(policy);
  if (policy.mode === 'danger') {
    return ['(version 1)', '(allow default)', ...denies].join('\n');
  }
  const allows = resolvePolicyRoots(policy)
    .map((root) => `(allow file-write* (subpath ${sbplString(root)}))`)
    .join('\n');
  return allows
    ? [seatbeltReadOnlyProfile(), allows, ...denies].join('\n')
    : [seatbeltReadOnlyProfile(), ...denies].join('\n');
}

/**
 * 组装 macOS Seatbelt 后端。
 * 后端差异数据化下发（消费方零后端知识）：
 * - 策略拒绝 → stderr 含 "operation not permitted"（seatbelt 拒写标准句）；
 * - runner 自身失败（profile 语法错/内核拒绝加载）→ stderr 前缀 "sandbox-exec: "。
 */
export function createSeatbeltBackend(): SandboxBackend {
  return {
    id: 'seatbelt',
    enforcement: 'full',
    denialSignatures: ['operation not permitted'],
    runnerFailureRules: [{ fatalSignatures: ['sandbox-exec: '] }],
    wrap(argv, policy) {
      const profile = seatbeltProfile(policy);
      return ['sandbox-exec', '-p', profile, '--', ...argv];
    },
    probe(timeoutMs) {
      // 功能性探测：真跑一次 read-only 包装的 /usr/bin/true——status 0 才证明
      // 内核确实执行了 profile（不是「命令存在」而是「策略真的生效」）
      const confined = ['sandbox-exec', '-p', seatbeltReadOnlyProfile(), '--', '/usr/bin/true'];
      const result = spawnSync(confined[0]!, confined.slice(1), { timeout: timeoutMs });
      return result.status === 0;
    },
  };
}
