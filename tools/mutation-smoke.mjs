#!/usr/bin/env node
/**
 * tools/mutation-smoke.mjs —— 变异冒烟（研究档 E11——「断言恒真」免疫力的常态化度量轨）。
 *
 * 背景：~5300 测的断言免疫力无系统度量，历史多次「断言恒真」真缺陷（e6b1862
 * typebox 未知 kind Check 恒真、a268c3c 谓词活性变异等）全靠批内手跑发现。
 * 本件把「手跑变异看测试红不红」的谱脚本化：内置变异种子集（每条 = 被测文件
 * 的 find→replace 单点变异 + 其回归锁测试文件），逐条：
 *   读源文 → 断言 find 恰命中一次（种子陈旧即红，防静默空转）→ 写变异 →
 *   子进程跑 npx vitest run <回归锁> → 期望**非零退码**（变异被杀 = 断言有
 *   免疫力）→ finally 恢复原文（中途 Ctrl-C 也可重跑幂等）。
 *
 * 任一变异**存活**（vitest 绿）或 find 未命中 → 整体退 1 并打印存活清单。
 *
 * 独立 script（npm run test:mutation）——按纪律不并入四门禁、不入 CI 必检，
 * 手动/夜班自取。纯 node 零新依赖。
 *
 * 安全位：启动先核每个种子文件工作树与 HEAD 一致（他 lane 在飞改动上变异 =
 * 恢复面不可信——fail-closed 拒跑）；恢复恒走内存原文回写（与 git 状态无关）。
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

/**
 * 变异种子集——从历史「断言恒真」病灶反选（每条附病灶 commit 与回归锁）：
 * 1. watchdog 熔断位一次性守卫取反（批 A b219ff4——src/llm/stream-fn fireHung）；
 * 2. --output-schema 根 type 值域执法谓词翻面（e6b1862——typebox 未知 kind
 *    Check 恒真的补口位，谓词死则手误形零告警复发）；
 * 3. soak 判收 errLines 帽谓词翻向（批 B 3b7740f——tools/soak-verdict 判收
 *    单源，errLines 只统计不入判收的历史病灶位）；
 * 4. soak 判收 seq 断洞判据钝化（同上——diff!==1 改 !==2 使真洞漏判）。
 */
const SEEDS = [
  {
    name: 'watchdog 收口位一次性守卫取反（fireHung 不再铸合成终值）',
    file: 'src/llm/stream-fn.ts',
    find: 'if (hungMessage === undefined) {',
    replace: 'if (hungMessage !== undefined) {',
    testFiles: ['src/llm/stream-fn.test.ts'],
  },
  {
    name: 'output-schema 根 type 值域执法翻面（域外放行/域内误拒）',
    file: 'src/host/run-entry.ts',
    find: 'if (!SCHEMA_ROOT_TYPE_VALUES.has((parsed as { type: string }).type)) {',
    replace: 'if (SCHEMA_ROOT_TYPE_VALUES.has((parsed as { type: string }).type)) {',
    testFiles: ['src/host/run-entry.test.ts'],
  },
  {
    name: 'soak 判收 errLines 帽谓词翻向（超帽不红）',
    file: 'tools/soak-verdict.mjs',
    find: 'if (input.errLines > input.errLinesCap) {',
    replace: 'if (input.errLines < input.errLinesCap) {',
    testFiles: ['tools/soak-verdict.test.mjs'],
  },
  {
    name: 'soak 判收 seq 断洞判据钝化（真洞漏判）',
    file: 'tools/soak-verdict.mjs',
    find: 'if (diff !== 1) breaks.push(',
    replace: 'if (diff !== 2) breaks.push(',
    testFiles: ['tools/soak-verdict.test.mjs'],
  },
];

/**
 * 核种子文件工作树与 HEAD 一致（git diff --quiet——同 index 比对零输出零退码 0）。
 * @param {string} relFile 仓库相对路径
 * @returns {boolean} true = 干净可变异
 */
function isCleanVsHead(relFile) {
  const r = spawnSync('git', ['diff', '--quiet', 'HEAD', '--', relFile], { cwd: REPO_ROOT });
  return r.status === 0;
}

/**
 * 跑一条变异：写变异 → vitest 定向 → 记被杀/存活 → finally 恢复内存原文。
 * @param {{name: string, file: string, find: string, replace: string, testFiles: string[]}} seed
 * @returns {{killed: boolean, note: string}} note = 判定归因行（被杀/存活/种子失效）
 */
function runSeed(seed) {
  const abs = join(REPO_ROOT, seed.file);
  const original = readFileSync(abs, 'utf8');
  const hits = original.split(seed.find).length - 1;
  if (hits !== 1) {
    return {
      killed: false,
      note: `种子失效：find 在 ${seed.file} 命中 ${hits} 次（须恰 1 次——源已漂移，须同批修种子）`,
    };
  }
  let status = null;
  try {
    writeFileSync(abs, original.replace(seed.find, seed.replace), 'utf8');
    const r = spawnSync('npx', ['vitest', 'run', ...seed.testFiles], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      timeout: 180_000, // 单种子帽（定向文件集——常秒级；帽只兜挂死形）
    });
    status = r.status;
  } finally {
    // 恢复恒走原文回写（与 git 无关——Ctrl-C 后重跑亦幂等：启动 HEAD 核已拦脏树）
    writeFileSync(abs, original, 'utf8');
  }
  if (status === 0) return { killed: false, note: '存活：变异下定向测试仍全绿（断言免疫力缺口——须补回归锁或修断言）' };
  if (status === null) return { killed: false, note: '判定失败：vitest 子进程超时/未起（status null——按存活收面查）' };
  return { killed: true, note: `被杀（vitest 退码 ${status}）` };
}

/* ---------------- 主流程：逐种子变异 → 存活清单 → 总判 ---------------- */

const dirty = SEEDS.map((s) => s.file)
  .filter((f) => !isCleanVsHead(f))
  .filter((f, i, arr) => arr.indexOf(f) === i);
if (dirty.length > 0) {
  console.error(
    `mutation-smoke：种子文件工作树与 HEAD 不一致（他 lane 在飞改动上变异=恢复面不可信，fail-closed 拒跑）：`,
  );
  for (const f of dirty) console.error(`  ${f}`);
  process.exit(1);
}

const survivors = [];
let killedCount = 0;
for (const seed of SEEDS) {
  process.stdout.write(`[mutation-smoke] ${seed.name} … `);
  const { killed, note } = runSeed(seed);
  console.log(killed ? 'KILLED' : 'SURVIVED');
  console.log(`    ${note}`);
  if (killed) killedCount++;
  else survivors.push({ name: seed.name, file: seed.file, note });
}

console.log(
  `[mutation-smoke] 判收：${killedCount}/${SEEDS.length} 被杀${survivors.length === 0 ? '——断言免疫力冒烟过' : ''}`,
);
if (survivors.length > 0) {
  console.error('[mutation-smoke] 存活清单（变异未杀 = 回归锁缺口）：');
  for (const s of survivors) console.error(`  ${s.file}  ${s.name}——${s.note}`);
  process.exit(1);
}
