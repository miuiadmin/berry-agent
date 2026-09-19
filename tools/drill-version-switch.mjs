#!/usr/bin/env node
// ---------------------------------------------------------------------------
// CI release-drill 演习版本切批忠实化（第十一役 CI 红收口笔）。
//
// 缺陷谱：真实版本切批（fd64815 实形）= 双 package.json bump + 六语 README
// 状态行 + usage 状态行 + SDK README 状态行随版同笔；而 ci.yml drill 步旧形
// 只 bump 双 package.json——对「版本切批」的不完整模拟，演习树上结构性
// 「pkg=drill 版 vs README=陈版」失配。任何 live 读「package.json version vs
// README token」的门/锁在这棵树上必假红（09085c9 CI 实红在案：release.test
// .mjs SDK README 防退形锁是第一个 live 读面；dry-run 形下发布机器自身版本
// 门不咬——触发腿不进入、契约 4 版本门有 !dryRun 守卫，故此前 drill 全绿
// 纯因无人在演习树上读版本一致性）。
//
// 修法：drill 步 bump 后调用本件，把反引号 semver token 同刷为演习版——
// 演习树与真实版本切批同形。词法锁面与 release.mjs 单源（import
// README_BACKTICK_SEMVER_RE，两处正则漂移即锁面分叉）。
//
// 用法：node tools/drill-version-switch.mjs <演习版>（仓库根跑；幂等；裸串
// 版本号不属词法锁面不动——与判据门「无 token 形不判违」语义对齐）
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { README_BACKTICK_SEMVER_RE } from './release.mjs';

/**
 * 纯函数：文本内全部反引号 semver token 换为目标版。
 * 裸串版本号（无反引号包裹）不属词法锁面——不判违即不重写，防演习树
 * 误扩散（真实版本切批也只动状态行 token 位）。
 */
export function rewriteReadmeTokens(text, version) {
  return text.replaceAll(README_BACKTICK_SEMVER_RE, `\`${version}\``);
}

/**
 * 演习树同步面：根六语 README 族 + usage 状态行 + SDK README。
 * 主/SDK 演习版恒同值（drill 步双 bump 同版号），单版一次刷全——与真实
 * 版本切批「随版同笔」单 commit 同形。
 */
export function drillReadmeFiles(cwd) {
  // 尾斜杠归一（fileURLToPath 目录形带尾斜杠——模板拼接防 // 双斜杠形）
  const root = cwd.replace(/\/+$/, '');
  return readdirSync(root)
    .filter((f) => /^README.*\.md$/.test(f))
    .map((f) => `${root}/${f}`)
    .concat([`${root}/docs/usage.md`, `${root}/packages/berry-agent-sdk/README.md`]);
}

// CLI 腿只在直接执行时走（测试经 import 只吃纯函数面——模块顶层零副作用，
// 无守卫则 vitest 装载即 process.exit 杀运行器）
const invokedAsMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsMain) {
  const version = process.argv[2];
  if (version === undefined) {
    console.error('用法：node tools/drill-version-switch.mjs <演习版>');
    process.exit(2);
  }
  for (const file of drillReadmeFiles('.')) {
    writeFileSync(file, rewriteReadmeTokens(readFileSync(file, 'utf8'), version));
  }
}
