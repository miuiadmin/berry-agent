#!/usr/bin/env node
/**
 * 门禁命中台账复算报告（gate-hit ledger report）——立题档成功判据 2 的复算面。
 * 立题真源：设计文档/plans/00-立题-门禁命中台账-20261109.md（成功判据 2：
 * 台账可复算——给定窗口，一条命令产出「门禁 × 规则 × 次数」降序表）。
 *
 * 为什么做：采集面（tools/gate-ledger.mjs）只落账不复算——没有本件，
 * `.gates-hits.jsonl` 只是数据堆积，「哪条门禁规则真的拦到过东西」仍不可回答。
 * 本件是只读复算面：读台账、按窗口过滤、产出每门禁的规则命中分布降序表，
 * 为未来的规则修剪（边表维度、词汇表增长、检查器扩面）提供数字而非口味。
 *
 * 复算口径（母本 curia-md@0bd7605 guide 01 章证据驱动裁剪法 + 本仓采集端形态）：
 *   1. 一行 = 一次红跑运行 `{ts, gate, ids}`；运行笔数 = 行数；
 *   2. 命中总数 = 全部记录 ids 元素出现次数之和（采集端 Set 已保证记录内无重复，
 *      复算端按出现如实计数——手改数据造成的重复也如实反映，不二次去重）；
 *   3. `<gate>:unparsed` 哨兵（采集端「红但解析不出规则 id」的占位）单列计数、
 *      不混入规则分布——哨兵不是规则，混入会让它冒充高频规则、扭曲分布读法；
 *   4. 无台账文件 = 从零起计、尚无数据——诚实输出不报错（curia-md 口径
 *      「先跑出一段窗口」；不回填历史，git 考古边界已明）；
 *   5. flake 红会混账（vitest 偶发红非拦截）——首版如实记，读数时按 flake 修
 *      commit 对照（`1c76a88` 族）手工剔除，本件不做自动剔除（立题档拍板）。
 *
 * 名单同步（对抗审查 2026-11-10 修复）：门禁名单不再自持副本——直接 import
 * 采集端 `GATES` 派生（GATE_NAMES = GATES 的 name 序列），改门禁名单只动
 * gate-ledger.mjs 一处，结构性无双写漂移。台账外的门禁名（手改/未来扩展）
 * 照列不丢数据，节标题带「未登记门禁名」标注。
 *
 * 裁定：本件**不做**命令漂移对拍（与采集端不同）。理由：报告输出是台账内容的
 * 纯函数——GATES 命令复述漂移只影响「采集时跑的是什么命令」，不改变既有记录
 * 的统计口径；而门禁名单这一真实耦合面已由 import 派生机器护持，无需再加对拍。
 *
 * 用法：node tools/gate-ledger-report.mjs [--file <台账路径>] [--since <yyyy-mm-dd>]
 *   --file   自测旁门：指向任意 jsonl（缺省 = 仓根 .gates-hits.jsonl 真身，只读、
 *            绝不创建——本件对台账零写入，绿跑零建文件的口径由采集端守住）；
 *   --since  窗口过滤：只统计 ts >= 该日的落账（UTC 日界、含当日；台账 ts 为
 *            ISO 8601 定长格式，字典序即时间序，直接字符串比较）。
 *
 * 本件不是第五门禁：只读复算、不改台账、不改任何门禁退出码。退出码约定：
 * 参数错 exit 2（usage 码，与门禁语义无关）、台账读失败 exit 1、正常复算
 * （含「从零起计、尚无数据」态）exit 0。零依赖（Node 内置）、不联网、Node≥18。
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// 门禁名单单一真源：直接 import 采集端 GATES 派生（对抗审查 2026-11-10 修复——
// 原先本件自持一份 GATE_NAMES 常量、靠人工同步，属无校验的双写漂移面）。
// import 不触发采集端主流程（其入口守卫按 argv[1] 判主模块）。
import { GATES } from './gate-ledger.mjs';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** 台账真身落点：仓根 .gates-hits.jsonl（与采集端同位；本件只读，绝不创建）。 */
const DEFAULT_LEDGER_PATH = join(REPO_ROOT, '.gates-hits.jsonl');

/** 门禁名 × 顺序——由采集端 GATES 派生（改门禁名单只动 gate-ledger.mjs 一处）。 */
const GATE_NAMES = GATES.map((g) => g.name);

/**
 * 末尾口径边界段——常量文案，为什么是常量：口径是复算面的契约面，不随窗口数据
 * 漂移；每次报告原样重述，读数者不看文档也能拿到同一份边界声明。
 */
const FOOTER_LINES = [
  '## 口径与边界',
  '',
  '- 命中 = 拦截：台账只记 error 级红跑（绿跑零落账、零建文件）；采集面见 tools/gate-ledger.mjs（旁路包装道，不是第五门禁）。',
  '- 从零起计：不回填历史（git 考古边界已明，见立题档）——台账文件不存在即「从零起计、尚无数据」，诚实输出、不算错误。',
  '- flake 混账：vitest 偶发红（非拦截）会如实混入台账——复算读数时按 flake 修 commit 对照（`1c76a88` 族）手工剔除，本报告不做自动剔除。',
  '- unparsed 哨兵：红跑但未解析出规则 id（如 prettier >20 文件只报汇总行）由采集端落 `<gate>:unparsed`——本报告单列计数、不混入规则分布。',
  '- 窗口语义：`--since <yyyy-mm-dd>` 按 ts（UTC）日界过滤、含当日；台账 ts 为 ISO 8601 定长格式，字符串比较即时间比较。',
  '- 坏行口径：无法解析或字段不符的行计数并报行号、不进任何统计——绝不静默丢弃（复算面静默丢行 = 分布失真）。',
  '- 复算窗口口径随季度复盘（立题档拍板 3）；本报告是只读证据面：不改台账、不改任何门禁退出码。',
];

/**
 * 解析 CLI 参数。为什么手写而不引解析库：零依赖红线（与采集端同款）。
 * @param {string[]} argv
 * @returns {{file: string | undefined, since: string | undefined}}
 */
export function parseArgs(argv) {
  const out = { file: undefined, since: undefined };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // 取值三防：缺尾参、值缺失、下一个 token 又是选项——都算参数错
    const take = (name) => {
      const v = argv[++i];
      if (v === undefined || v.startsWith('--')) throw new Error(`${name} 缺值`);
      return v;
    };
    if (a === '--file') out.file = take(a);
    else if (a === '--since') out.since = take(a);
    else throw new Error(`未知参数：${a}`);
  }
  if (out.since !== undefined) {
    // 双重校验：形态（定长 yyyy-mm-dd）+ 语义（分量回读——挡 2026-13-99/2026-02-30/
    // 2026-11-31/非闰年 2026-02-29）。为什么不能只靠 new Date(s) 非 NaN：V8 对日溢出的
    // date-only 串会静默进位（2026-02-30 → 03-02、2026-11-31 → 12-01），窗口被无声
    // 平移还照常出报告——对抗审查 2026-11-10 修复：按分量构造再回读比对，任一分量
    // 不等即参数错（fail-loud）。
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(out.since);
    let valid = m !== null;
    if (valid) {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
      const utc = new Date(Date.UTC(y, mo - 1, d));
      valid = utc.getUTCFullYear() === y && utc.getUTCMonth() === mo - 1 && utc.getUTCDate() === d;
    }
    if (!valid) throw new Error(`--since 须为合法 yyyy-mm-dd，收到：${out.since}`);
  }
  return out;
}

/**
 * 采集端唯一产出的 ts 形态——`new Date().toISOString()` 的定长 UTC 形。
 * 为什么按形态白名单而不是「Date 可解析」：本件过滤（--since）与窗口起止排序
 * 都建立在「ISO 8601 定长格式下字典序即时间序」之上，而 V8 的 Date 解析对
 * `2026/11/02`（斜杠形、本地时区）、`2026-11-09T02:00:00+08:00`（偏移形）、
 * `2026-11-02T10:00:00`（无时区形）等宽松形态都放行——这些形态混入会让
 * 字符串比较失真（`'2026/11/02' >= '2026-11-10'` 为 true，窗口外记录假保留；
 * 偏移形的字典序 ≠ 时间序）。对抗审查 2026-11-10 修复：非该形态整行计坏行
 * 并记行号（fail-loud、不静默丢），采集端真数据（恒为此形态）不受影响。
 */
const CANONICAL_TS_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * 读台账 JSONL：一行一记录 `{ts, gate, ids}`。行级校验（JSON 可解析、ts 为
 * 采集端定长形态且 Date 语义合法、gate 非空字符串、ids 为字符串数组）——
 * 不合规整行计坏行并记行号，绝不静默丢弃。空行（含文件尾换行产生的空串）
 * 不算坏行。
 * @param {string} path
 * @returns {{records: {ts: string, gate: string, ids: string[]}[], badLines: number[]}}
 */
export function readLedger(path) {
  const records = [];
  const badLines = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === '') continue;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      badLines.push(i + 1);
      continue;
    }
    const ok =
      typeof obj === 'object' &&
      obj !== null &&
      typeof obj.ts === 'string' &&
      CANONICAL_TS_RE.test(obj.ts) &&
      !Number.isNaN(new Date(obj.ts).getTime()) &&
      typeof obj.gate === 'string' &&
      obj.gate !== '' &&
      Array.isArray(obj.ids) &&
      obj.ids.every((x) => typeof x === 'string');
    if (ok) records.push(obj);
    else badLines.push(i + 1);
  }
  return { records, badLines };
}

/**
 * 按门禁聚合计数。unparsed 判定用全等 `${gate}:unparsed`（采集端唯一产出的哨兵
 * 形态）而非后缀匹配——防 lint 腿「脚本|判据文案」行尾恰撞 `:unparsed` 的误判，
 * 宁精确勿宽容；非约定形态照普通 id 计入分布（照实显示）。
 * @param {{ts: string, gate: string, ids: string[]}[]} records
 * @returns {Map<string, {runs: number, counts: Map<string, number>, unparsed: number, hits: number}>}
 */
export function tallyByGate(records) {
  const byGate = new Map();
  for (const r of records) {
    let s = byGate.get(r.gate);
    if (s === undefined) {
      s = { runs: 0, counts: new Map(), unparsed: 0, hits: 0 };
      byGate.set(r.gate, s);
    }
    s.runs++;
    for (const id of r.ids) {
      if (id === `${r.gate}:unparsed`) s.unparsed++;
      else {
        s.counts.set(id, (s.counts.get(id) ?? 0) + 1);
        s.hits++;
      }
    }
  }
  return byGate;
}

/**
 * 分布表排序 comparator：次数降序，同次数按 id 码点字典序升序——保证复算口径
 * 稳定（同数据不同机器产出同一张表），对齐母本 curia-md 01 章命中分布表读法。
 * @param {[string, number]} a
 * @param {[string, number]} b
 */
function byCountDesc([aId, aN], [bId, bN]) {
  return bN - aN || (aId < bId ? -1 : aId > bId ? 1 : 0);
}

/**
 * 渲染单个门禁节：命中分布表（`| 规则 ID | 次数 |` markdown 纯文本表，id 反引号
 * 包裹——母本 curia-md 01 章同款风格）+ unparsed 哨兵单列行。0 笔门禁也出节——
 * 「四门禁 × 分布」完整可读，缺席与零数分得清。
 * @param {string} title
 * @param {{runs: number, counts: Map<string, number>, unparsed: number, hits: number}} s
 * @returns {string[]}
 */
function renderGateSection(title, s) {
  const L = [`## ${title}（${s.runs} 笔 / ${s.hits} 次命中）`, ''];
  if (s.runs === 0) {
    L.push('本窗口无落账。', '');
    return L;
  }
  if (s.counts.size > 0) {
    L.push('| 规则 ID | 次数 |', '|---|---|');
    for (const [id, n] of [...s.counts].sort(byCountDesc)) L.push(`| \`${id}\` | ${n} |`);
    L.push('');
  } else {
    L.push('（本窗口该门禁命中全部为 unparsed 哨兵，无规则 id 分布）', '');
  }
  if (s.unparsed > 0) {
    L.push(`（unparsed 哨兵 ${s.unparsed} 笔——红跑但未解析出规则 id，不混入分布）`, '');
  }
  return L;
}

/**
 * 组装报告全文（纯文本 markdown）。
 * @param {{
 *   ledgerDisplay: string,
 *   missing: boolean,
 *   records: {ts: string, gate: string, ids: string}[],
 *   filteredOut: number,
 *   since: string | undefined,
 *   badLines: number[],
 * }} input
 * @returns {string}
 */
export function buildReport({ ledgerDisplay, missing, records, filteredOut, since, badLines }) {
  const L = ['# 门禁命中台账复算报告', '', `- 台账文件：${ledgerDisplay}`];
  if (missing) {
    // 从零起计态：诚实说明 + 照出口径边界段，不算错误（exit 0 由调用方守）
    L.push(
      '- 状态：文件不存在——从零起计、尚无数据（采集端绿跑零落账、零建文件；首笔红跑落账后本报告即有数据）',
      '',
      ...FOOTER_LINES,
      '',
    );
    return L.join('\n');
  }
  const byGate = tallyByGate(records);
  const totalHits = [...byGate.values()].reduce((acc, s) => acc + s.hits, 0);
  const totalUnparsed = [...byGate.values()].reduce((acc, s) => acc + s.unparsed, 0);
  // 不同规则 id 按「门禁 × id」去重：同一路径可能既是 test 失败件又是 format 红件，
  // 跨门禁合并去重会低估分布面
  const distinctIds = [...byGate.values()].reduce((acc, s) => acc + s.counts.size, 0);
  const tsList = records.map((r) => r.ts).sort();
  const windowNote =
    since !== undefined ? `；--since ${since} 生效（UTC 日界、含当日），滤除窗口外 ${filteredOut} 笔` : '';
  L.push(
    `- 窗口：${tsList.length > 0 ? `${tsList[0]} ~ ${tsList[tsList.length - 1]}（最早~最晚落账 ts）` : '—（窗口内无落账记录）'}${windowNote}`,
    `- 运行笔数：${records.length} 笔（红跑落账，含 unparsed 哨兵笔；绿跑零落账不计数）`,
    `- 命中总数：${totalHits} 次（规则 id 出现次数合计，不含 unparsed 哨兵）`,
    `- 不同规则 id：${distinctIds} 个（按门禁 × id 去重）`,
    `- unparsed 哨兵：${totalUnparsed} 笔（单列于各门禁节，不混入规则分布）`,
  );
  if (badLines.length > 0) {
    const head = badLines.slice(0, 5).join('、');
    const tail = badLines.length > 5 ? ` 等 ${badLines.length} 条` : '';
    L.push(`- 坏行：${badLines.length} 条（格式不符已跳过、不进任何统计：行 ${head}${tail}）`);
  }
  L.push('');
  // 已知门禁按 GATE_NAMES 顺序出节；台账外的门禁名照列（字典序）不丢数据
  const empty = { runs: 0, counts: new Map(), unparsed: 0, hits: 0 };
  for (const name of GATE_NAMES) L.push(...renderGateSection(name, byGate.get(name) ?? empty));
  const unknown = [...byGate.keys()].filter((g) => !GATE_NAMES.includes(g)).sort();
  for (const name of unknown) {
    L.push(...renderGateSection(`${name}（未登记门禁名——不在采集端 GATES，照列不丢数据）`, byGate.get(name)));
  }
  L.push(...FOOTER_LINES, '');
  return L.join('\n');
}

/**
 * 主流程：解析参数 → 定位台账 → 读/滤 → 输出报告。退出码约定见文件头注释。
 */
function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    process.stderr.write(
      `用法: node tools/gate-ledger-report.mjs [--file <台账路径>] [--since <yyyy-mm-dd>]\n错误：${e.message}\n`,
    );
    process.exitCode = 2;
    return;
  }
  const ledgerPath = args.file !== undefined ? resolve(args.file) : DEFAULT_LEDGER_PATH;
  // 展示路径：仓根内显相对路径（与仓内文档口径一致），仓外显绝对路径（--file 旁门常态）
  const rel = relative(REPO_ROOT, ledgerPath);
  const ledgerDisplay = rel.startsWith('..') ? ledgerPath : rel;
  if (!existsSync(ledgerPath)) {
    // 从零起计态：不建文件、不报错——真身从未存在过是正常态而非异常
    process.stdout.write(
      buildReport({ ledgerDisplay, missing: true, records: [], filteredOut: 0, since: args.since, badLines: [] }),
    );
    return;
  }
  let read;
  try {
    read = readLedger(ledgerPath);
  } catch (e) {
    process.stderr.write(`[gate-ledger-report] 台账读取失败：${e}\n`);
    process.exitCode = 1;
    return;
  }
  // --since 过滤：ISO 8601 定长格式下字典序即时间序（含当日——当日任意时刻 ts 串 > 当日日期串）
  const kept = args.since !== undefined ? read.records.filter((r) => r.ts >= args.since) : read.records;
  const filteredOut = read.records.length - kept.length;
  process.stdout.write(
    buildReport({
      ledgerDisplay,
      missing: false,
      records: kept,
      filteredOut,
      since: args.since,
      badLines: read.badLines,
    }),
  );
}

// 主模块才跑主流程；纯函数 export 供自测/后续复盘脚本 import（import 时不产出报告）
if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
