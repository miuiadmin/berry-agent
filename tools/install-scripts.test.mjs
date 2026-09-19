import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

// 依赖树安装脚本面回归锁——README「零安装脚本 / --ignore-scripts 等价」承诺的防再犯件。
//
// 背景（2026-09-20 实证归档）：npm 11.16 起对「带安装脚本的依赖」打 allow-scripts
// 警、npm 12 起默认跳过未批准脚本。本仓公开 README 承诺 `--ignore-scripts` 安装
// 行为完全一致，其成立前提 = 依赖树中不存在「真需要安装脚本」的包：
// - @google/genai 的 preinstall 是字面 no-op（echo 'preinstall: no-op'）；
// - protobufjs 的 postinstall 只打赞助横幅；
// - better-sqlite3 为 prebuildify 形（预编译 .node 随包分发、零 install 脚本）。
// 若未来依赖树混入需现场编译/下载的原生件，此锁必红——届时要么修订 README 承诺，
// 要么换依赖，不是简单放宽白名单了事。
//
// prod 树判据 = lock v3 条目无 dev 旗标（devDependencies 不随 `npm install
// berry-agent` 下发给消费者，esbuild/fsevents 等工具链脚本不在承诺面内）。

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** 已审定的「带安装脚本但属 no-op」prod 树包（跳过零功能差——出处见头注）。 */
const NO_OP_SCRIPTED_PROD_PACKAGES = [
  'node_modules/@google/genai', // preinstall: echo 'preinstall: no-op'
  'node_modules/protobufjs', // postinstall: 赞助横幅打印（node scripts/postinstall）
];

function readJson(rel) {
  return JSON.parse(readFileSync(path.join(repoRoot, rel), 'utf8'));
}

test('根包自身零安装钩（preinstall/install/postinstall 均缺席）', () => {
  const scripts = readJson('package.json').scripts ?? {};
  const hooks = Object.keys(scripts).filter((k) => /^(preinstall|install|postinstall)$/.test(k));
  expect(hooks, '根包不得携带任何安装期脚本钩').toEqual([]);
});

test('prod 树带安装脚本的包恰等于已审定 no-op 白名单（双向恰等）', () => {
  const lock = readJson('package-lock.json');
  const offenders = Object.entries(lock.packages ?? {})
    .filter(([key, info]) => key !== '' && info.hasInstallScript === true && !info.dev)
    .map(([key]) => key)
    .sort();
  expect(offenders, '新混入的脚本包须先审定（no-op 证据）或换依赖——README --ignore-scripts 承诺在肩').toEqual(
    [...NO_OP_SCRIPTED_PROD_PACKAGES].sort(),
  );
});

test('better-sqlite3 零安装脚本旗标（prebuildify 形——原生件核心承诺）', () => {
  const lock = readJson('package-lock.json');
  const entry = lock.packages?.['node_modules/better-sqlite3'];
  expect(entry, 'lock 中应有 better-sqlite3 条目').toBeTruthy();
  expect(entry.hasInstallScript, 'better-sqlite3 须保持 prebuildify 形（升级换代时此红 = 承诺破位需复审）').not.toBe(
    true,
  );
});
