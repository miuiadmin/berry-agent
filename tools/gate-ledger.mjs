#!/usr/bin/env node
/**
 * 门禁命中台账（gate-hit ledger）——案 A 旁路包装道。
 * 立题真源：设计文档/plans/00-立题-门禁命中台账-20261109.md（已拍板案 A）。
 *
 * 为什么做：本仓原本无拦截台账——「哪条门禁规则真的拦到过东西」不可回答，
 * 边表棒零实锤、规则修剪只能靠口味。本脚本把四门禁的红跑变成可复算数字：
 * `{ts, gate, ids}` 一行一运行，积累窗口后可产出「登记集 vs 命中分布」求差表。
 *
 * 为什么是包装道（案 A）而非各检查器自报（案 B）：typecheck/format 不是自研
 * 脚本（tsc/prettier 不改），案 B 无处内嵌且要动四个已稳定执法面。本脚本是
 * **旁路可选道**——不动任何既有 script、不改任何检查器、不进 CI：旧命令
 * （npm run typecheck 等）行为逐字节不变。
 *
 * 台账口径三条（母本 curia-md@0bd7605 证据驱动裁剪法）：
 *   1. 命中 = 拦截（只记 error 级红跑）——绿跑零落账、零建文件；
 *   2. 一次运行一条记录（`ts` + `gate` + `ids`）；
 *   3. warning 不落盘（防常驻告警灌账——参考实现曾因 warning 混账致台账失效）。
 *
 * 执行模型（两层取舍，皆守住「不改门禁退出码语义」红线）：
 *   - 门禁间短路：typecheck 红即停，不继续 test。理由：母本口径「一次运行一条
 *     记录」；且级联红（typecheck 红 → test 大概率同因红）一跑多行会灌账，正是
 *     台账要防的噪声。退出码 = 首个失败门禁的退出码——与
 *     `npm run typecheck && npm test && ...` 链语义一致，全绿 0。
 *   - 门禁腿内分全跑：typecheck 三支 tsc、lint:topology 四支 check-* 各自独立
 *     跑完（不复制 && 短路）。理由：台账目的是分布统计，短路会系统性漏记后支
 *     的命中（如 check-topology 红时 check-vocab 的命中不该丢）；各支都是只读
 *     检查器、无副作用，全跑安全。腿的退出码仍取腿内**首个**失败支的退出码
 *     ——与原 && 链逐门禁逐字节一致。
 *
 * 为什么不 spawn `npm run`：多一层 npm 进程与 shell 开销；且 npm 对链式 script
 * 的退出码有自己的包装传播层，直接调底层命令链才能拿到一手 exit code。因此
 * **命令真源 = package.json scripts**（下方 GATES 逐字复述四条命令的底层链）。
 * 同步义务原是人工的（无自动校验）；2026-11-10 增量升格为机器执法——启动时
 * findGateDrift 把四条 script 原文与 GATES 展开串逐字对拍，漂移即 exit 2 拒跑
 * 并打印具名差集与修复指路（fail-loud：漂移状态下台账口径不可信，宁可拒跑；
 * 单腿模式同样先过对拍；旧四门禁 npm run 命令不受影响）。
 *
 * 用法：node tools/gate-ledger.mjs [gate]
 *   无参 = 四门禁按序全跑；带门禁名（typecheck/test/lint:topology/format:check）
 *   只跑该腿（自验/调试旁门，红跑同样落账）。npm script 位建议 gates:ledger。
 *   exit 2 有两个来源、文案可区分：启动对拍发现漂移（✗ 漂移 + 具名差集 +
 *   修复指路）与参数错（用法行）——都不是门禁红；门禁红透传门禁自身退出码。
 *
 * 本脚本不是第五门禁：不拦截代码问题、不告警、落账失败只 warn 不改门禁退出
 * 码。对拍拒跑的 exit 2 与 usage 的 exit 2 同类——包装器自身口径完整性检查，
 * 不是门禁语义的红。
 * 零依赖（Node 内置）、不联网、Node≥18。台账文件 .gates-hits.jsonl 需 gitignore。
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 台账落点：仓根 .gates-hits.jsonl（与 coverage 同位的本地审计数据，不入公开史）。 */
const LEDGER_PATH = join(REPO_ROOT, '.gates-hits.jsonl');

/**
 * format:check 的检查面 glob 列表——逐字转录自 package.json scripts["format:check"]
 * （引号是给 shell 的，这里直接以数组元素传给 prettier，由 prettier 自行 glob 展开）。
 * 转录忠实度由 findGateDrift 对拍护持（2026-11-10 增量）——漂移即拒跑。
 */
const FORMAT_GLOBS = [
  'src/**/*.{ts,tsx,css,html}',
  'plugins/**/*.{ts,tsx,css,html}',
  'packages/berry-agent-sdk/**/*.ts',
  'tools/**/*.mjs',
  'tools/**/*.ts',
  'vite.config.ts',
  'vitest.config.ts',
];

/**
 * 剥 ANSI SGR 色码。为什么：子进程输出被 pipe（非 TTY）时多数工具已降级纯文本，
 * 但 vitest/prettier 部分路径仍可能带色——`[warn]`、`FAIL`、`❯` 前若混入色码
 * 正则会漏捕，解析前统一剥除最稳。
 * @param {string} s
 */
function stripAnsi(s) {
  return s.replace(/\u001B\[[0-9;]*m/g, '');
}

/**
 * 跑一支子命令：输出实时透传到本进程 stdout/stderr（体验与直接跑门禁一致，
 * 不吞输出），同时收集全文供红跑解析。子命令启动失败（如 PATH 找不到）不吞
 * ——记 exit 127（shell 惯例「命令不存在」码），让该腿按红处理、可被发现。
 * @returns {Promise<{label: string, code: number, text: string}>}
 */
function runStep(step) {
  const childEnv = { ...process.env };
  // npm run 会把 node_modules/.bin 注入 PATH，直接 spawn 没有这层——手动补齐等价环境
  childEnv.PATH = `${join(REPO_ROOT, 'node_modules', '.bin')}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH ?? ''}`;
  const cmd = step.cmd === 'node' ? process.execPath : step.cmd; // check-* 支用当前 node 一手路径，不赌 PATH
  return new Promise((resolveStep) => {
    const child = spawn(cmd, step.args, { cwd: REPO_ROOT, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => {
      out += d;
      process.stdout.write(d);
    });
    child.stderr.on('data', (d) => {
      err += d;
      process.stderr.write(d);
    });
    // spawn 失败（ENOENT 等）：code=127 视作红支，错误文本进 text 供台账留痕
    child.on('error', (e) => resolveStep({ label: step.label, code: 127, text: stripAnsi(`${e}`) }));
    child.on('close', (code) =>
      // stdout+stderr 都进解析池（tsc 错误在 stdout、部分工具 warn 走 stderr，正则各自认领不会互扰）；
      // 被信号杀死时 code 为 null——透传不了精确值，按惯例记 1
      resolveStep({ label: step.label, code: code ?? 1, text: stripAnsi(`${out}\n${err}`) }),
    );
  });
}

/**
 * typecheck 腿解析：抽 tsc 诊断码（`error TS(\d+)`）。
 * 为什么 id 粒度是 TSxxxx：诊断码是 tsc 的稳定规则标识，跨文件同码去重后
 * 即「规则 × 次数」表的一维。正则字面要求 `error`——天然 error-only，
 * warning 级（若有）不落账。
 * @param {{label: string, code: number, text: string}[]} stepResults
 * @returns {string[]}
 */
export function parseTypecheckIds(stepResults) {
  const ids = new Set();
  for (const r of stepResults) {
    for (const m of r.text.matchAll(/error TS(\d+)/g)) ids.add(`TS${m[1]}`);
  }
  // 排序保证复算口径稳定（同一次红跑不同机器产出同一行）
  return [...ids].sort();
}

/**
 * test 腿解析：抽失败测试文件路径。vitest 失败摘要两种文件粒度行都捕：
 *   `FAIL |tag| <file>`（失败用例归属行）与 `❯ |tag| <file>`（失败文件汇总行）。
 * 为什么 id 粒度是文件而非用例：文件 = 回归锁语义（立题档拍板——用例名含
 * 中文/变量，作 id 不稳）。`|tag|` 是 vitest 的 project 标签（本仓双轨
 * |node| 与 |webui-client|——2026-11-10 实测：webui-client 轨失败行同样带
 * 标签，只锚 |node| 会整轨漏捕降级到 unparsed 哨兵），故按标签字符集泛化
 * `\|[\w-]+\|`——新增第三轨自动覆盖，不随 vitest.config 漂移。
 * 标签锚必须保留：失败详情的堆栈行 `❯ <file>:行:列` 以 ❯ 开头但**无标签**
 * （实测形态），去锚即误捕。skip-only 文件行前缀是 `✓` 非 `❯`（实测），
 * 零失败文件不会经 ❯ 支混入。`❯`/`FAIL` 形可能带 `:行:列` 尾巴，剥掉归一；
 * 同一文件的 FAIL 行与 ❯ 行两族并存（Failed Tests 段重列），Set 去重消化。
 * @param {{label: string, code: number, text: string}[]} stepResults
 * @returns {string[]}
 */
export function parseTestIds(stepResults) {
  const ids = new Set();
  const FILE_LINE_RE = /(?:^|\n)[^\S\n]*(?:FAIL|❯)[^\S\n]*\|[\w-]+\|[^\S\n]*(\S+)/g;
  for (const r of stepResults) {
    for (const m of r.text.matchAll(FILE_LINE_RE)) ids.add(m[1].replace(/:\d+:\d+$/, ''));
  }
  return [...ids].sort();
}

/**
 * lint:topology 腿解析：四支 check-* 各自跑，失败的支记「脚本名 + 该支输出中
 * 非空行前 5 条」为 ids。为什么这么粗：check-* 输出目前是判据文案不带规则 ID
 * （规则 ID 化是后续增量，立题档明示不做前置）——「脚本 × 输出行」是首版能拿
 * 到的最细粒度；截前 5 行防单支长输出灌爆一行台账。
 * @param {{label: string, code: number, text: string}[]} stepResults
 * @returns {string[]}
 */
export function parseLintIds(stepResults) {
  const ids = [];
  for (const r of stepResults) {
    if (r.code === 0) continue; // 只记失败支——绿支输出与台账无关
    const lines = r.text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 5);
    for (const line of lines) ids.push(`${r.label}|${line}`);
  }
  return ids;
}

/**
 * format:check 腿解析：抽 prettier `[warn]` 后的文件清单。
 * 为什么要过滤：prettier 汇总行 `[warn] Code style issues found in N files.`
 * 同样匹配 `/\[warn\]\s+(\S+)/` 但捕到的 `Code` 不是文件——按「像文件路径」
 * （含路径分隔符或扩展名点）过滤；本腿检查面全是 ts/tsx/css/html/mjs 路径，
 * 不会误滤。注意 prettier 对 >20 文件的差异只报汇总不列清单，届时 ids 会空、
 * 由主流程落 `unparsed` 哨兵——红跑事实不丢。
 * @param {{label: string, code: number, text: string}[]} stepResults
 * @returns {string[]}
 */
export function parseFormatIds(stepResults) {
  const ids = new Set();
  for (const r of stepResults) {
    for (const m of r.text.matchAll(/\[warn\]\s+(\S+)/g)) {
      if (/[/.]/.test(m[1])) ids.add(m[1]);
    }
  }
  return [...ids].sort();
}

/**
 * 四门禁定义——steps 逐字复述 package.json scripts 的底层命令链。真源方向
 * package.json → 本件：启动时 findGateDrift 逐字对拍执法（2026-11-10 增量，
 * 原「人工同步义务、无自动校验」升格为机器执法）——漂移即 exit 2 拒跑。
 * check-* 支的 label 即脚本名，供 lint 腿「脚本名 + 输出行」落账。
 * export 供复算面（gate-ledger-report.mjs）import 派生门禁名单——单一真源，
 * 报告侧不再各自维护一份名单（对抗审查 2026-11-10 修复：原先是两处手工同步）。
 */
export const GATES = [
  {
    name: 'typecheck',
    steps: [
      { label: 'tsc --noEmit', cmd: 'tsc', args: ['--noEmit'] },
      {
        label: 'tsc -p packages/berry-agent-sdk/tsconfig.test.json',
        cmd: 'tsc',
        args: ['-p', 'packages/berry-agent-sdk/tsconfig.test.json'],
      },
      { label: 'tsc -p tsconfig.webui-client.json', cmd: 'tsc', args: ['-p', 'tsconfig.webui-client.json'] },
    ],
    parseIds: parseTypecheckIds,
  },
  {
    name: 'test',
    steps: [{ label: 'vitest run', cmd: 'vitest', args: ['run'] }],
    parseIds: parseTestIds,
  },
  {
    name: 'lint:topology',
    steps: [
      { label: 'check-topology', cmd: 'node', args: ['tools/check-topology.mjs'] },
      { label: 'check-api', cmd: 'node', args: ['tools/check-api.mjs'] },
      { label: 'check-vocab', cmd: 'node', args: ['tools/check-vocab.mjs'] },
      { label: 'check-hook-coverage', cmd: 'node', args: ['tools/check-hook-coverage.mjs'] },
    ],
    parseIds: parseLintIds,
  },
  {
    name: 'format:check',
    steps: [{ label: 'prettier --check <format 面>', cmd: 'prettier', args: ['--check', ...FORMAT_GLOBS] }],
    parseIds: parseFormatIds,
  },
];

/**
 * 把单个参数还原成 package.json script 里的书写形（对拍展开用的引号规则）。
 * 为什么引号风格锚在 FORMAT_GLOBS 集上而不是按字符集推断：本仓四条 script 的
 * 手写形是「prettier glob 检查面整体带双引号、命令名/flag/路径裸写」——
 * `vite.config.ts` 无任何 shell 特殊字符却也带引号，按字符集推不出书写形；只有
 * 锚定数据集（该面即 FORMAT_GLOBS 的逐字转录）展开串才能与原文逐字一致。含
 * shell 元字符且不在 FORMAT_GLOBS 集的 token（未来新书写形态）按双引号展开，
 * 与原文不一致即对拍红——fail-loud，同步时一并调整本规则。
 * @param {string} token
 * @returns {string}
 */
export function shellQuote(token) {
  if (FORMAT_GLOBS.includes(token)) return `"${token}"`;
  // POSIX shell 安全字符集（字母数字与惯用 flag/路径符号）内裸写，与手写形一致
  return /^[\w@%+=:,./-]+$/.test(token) ? token : `"${token}"`;
}

/**
 * 把一条 GATES 定义展开成与 package.json script 等价的命令串（支间以 ` && `
 * 连接，复刻 package.json 手写链形）。对拍的 GATES 侧基准——结构化 steps
 * （cmd/args 数组）与原文命令串之间就靠它桥接，逐字比对才可能成立。
 * @param {{steps: {cmd: string, args: string[]}[]}} gate
 * @returns {string}
 */
export function expandGateCommand(gate) {
  return gate.steps.map((s) => [s.cmd, ...s.args].map(shellQuote).join(' ')).join(' && ');
}

/**
 * 漂移对拍（fail-loud 执法面，2026-11-10 增量）：读 package.json 四门禁 script
 * 原文，与 GATES 展开串逐字对拍。为什么逐字而非语义等价：对拍护持的是
 * 「GATES 复述 = 真源」这一事实本身——语义等价但书写不同（空格/引号风格）同样
 * 意味着有人改了一边没同步另一边，台账口径即不可信，一律算漂移拒跑。
 * package.json 缺失/坏 JSON 时抛异常，由调用方按同一 fail-loud 口径处理（真源
 * 不可读，复述无从对起，同样拒跑）。
 * @returns {{name: string, pkg: string | undefined, expanded: string}[]} 漂移差集（空数组 = 一致）
 */
export function findGateDrift() {
  const scripts = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8')).scripts ?? {};
  const drifts = [];
  for (const gate of GATES) {
    const pkg = scripts[gate.name];
    const expanded = expandGateCommand(gate);
    if (pkg !== expanded) drifts.push({ name: gate.name, pkg, expanded });
  }
  return drifts;
}

/**
 * 红跑落账：append 一行 `{ts, gate, ids}` JSONL。为什么 try/catch：台账只是
 * 证据面不是门禁——落账失败（权限/磁盘）只 warn stderr，绝不改写门禁自身的
 * 退出码语义。ids 为空（红但解析不出规则，如 prettier >20 文件只报汇总）落
 * `<gate>:unparsed` 哨兵——「有红没解析出 id」这一事实本身要可考古。
 * @param {string} gate
 * @param {string[]} ids
 */
function appendLedger(gate, ids) {
  const safeIds = ids.length > 0 ? ids : [`${gate}:unparsed`];
  const line = JSON.stringify({ ts: new Date().toISOString(), gate, ids: safeIds });
  try {
    appendFileSync(LEDGER_PATH, `${line}\n`);
    process.stderr.write(`[gate-ledger] 已落账 ${gate}: ${safeIds.length} 个 id → ${LEDGER_PATH}\n`);
  } catch (e) {
    process.stderr.write(`[gate-ledger] 落账失败（不影响门禁退出码）：${e}\n`);
  }
}

/**
 * 主流程：按序跑门禁（可选单腿），首个红门禁落账即停、透传其退出码。
 * 全绿零落账、exit 0。绿跑不创建台账文件（append 只在红跑发生）。
 */
async function main() {
  // 漂移对拍先于一切（usage 检查、门禁腿都在其后）：漂移状态下无论全跑/单腿，
  // 台账口径都不可信——宁可拒跑（fail-loud）。2026-11-10 增量。
  let drifts;
  try {
    drifts = findGateDrift();
  } catch (e) {
    process.stderr.write(
      `[gate-ledger] ✗ 对拍真源 package.json 不可读：${e}\n` +
        `[gate-ledger] 台账口径不可信，拒跑（exit 2）。修复指路：恢复仓根 package.json（存在且为合法 JSON）后重试。\n`,
    );
    process.exitCode = 2;
    return;
  }
  if (drifts.length > 0) {
    process.stderr.write(
      `[gate-ledger] ✗ GATES/FORMAT_GLOBS 与 package.json scripts 漂移（${drifts.length} 条）——台账口径不可信，拒跑（exit 2）：\n`,
    );
    for (const d of drifts) {
      process.stderr.write(`[gate-ledger]   [${d.name}]\n`);
      process.stderr.write(`[gate-ledger]     package.json: ${d.pkg ?? '（scripts 缺该键）'}\n`);
      process.stderr.write(`[gate-ledger]     GATES 展开  : ${d.expanded}\n`);
    }
    process.stderr.write(
      `[gate-ledger] 修复指路：命令真源 = package.json scripts（本件 GATES/FORMAT_GLOBS 是复述）——以 package.json 侧为准，` +
        `把每条漂移门禁的原文逐字同步到 tools/gate-ledger.mjs 的 GATES 常量（format:check 的检查面在 FORMAT_GLOBS 常量）；` +
        `若是有意改命令链，先改 package.json 再同步此处。漂移未清前本脚本拒跑；旧四门禁 npm run 命令不受影响。\n`,
    );
    process.exitCode = 2; // 漂移拒跑码——与 usage 的 2 同值但文案具名可区分（见头注）
    return;
  }
  const only = process.argv[2];
  if (only !== undefined && !GATES.some((g) => g.name === only)) {
    process.stderr.write(`用法: node tools/gate-ledger.mjs [${GATES.map((g) => g.name).join(' | ')}]\n`);
    process.exitCode = 2; // 参数错不是门禁红——包装器自身的 usage 码，与门禁语义无关
    return;
  }
  for (const gate of GATES) {
    if (only !== undefined && gate.name !== only) continue;
    const plan = only !== undefined ? `（单腿：${only}）` : '';
    process.stderr.write(`[gate-ledger] ▶ 门禁 ${gate.name}${plan}\n`);
    // 腿内全跑（不短路）——采集所有支的命中；退出码语义见文件头注释
    const results = [];
    for (const step of gate.steps) results.push(await runStep(step));
    const firstFail = results.find((r) => r.code !== 0);
    if (firstFail !== undefined) {
      appendLedger(gate.name, gate.parseIds(results));
      // 门禁间短路 + 退出码透传：与 `npm run typecheck && npm test && ...` 链逐字节一致
      process.exitCode = firstFail.code;
      return;
    }
  }
  process.stderr.write(`[gate-ledger] 全绿——零落账，exit 0\n`);
  process.exitCode = 0;
}

// 主模块才跑主流程；解析函数 export 供自测/复算脚本 import（import 时不跑门禁）
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
