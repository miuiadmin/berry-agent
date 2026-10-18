#!/usr/bin/env node
/**
 * 活词派发覆盖率锁 v0（07 篇 §7.4 续三·件 1——2026-10-18 硬伤处置②活词派发
 * 覆盖率锁批）。docs/plugin-development.md 钩子词汇主表（活词/保留词两栏）是
 * 插件作者面的「发射位如实分列」承诺——承诺面与码面零机械对拍即静默漂移
 * （首例实证：session_start 落码批 82fb8a2 后 docs 保留词行仍书「发射位未落」）。
 * 本锁把两栏表钉死在两个码面真源上：词汇/模式真源 = PLUGIN_HOOK_VOCABULARY
 * （src/host/plugin-context.ts——41 词 fail-closed 执法判据的镜像数组）、
 * 发射位真源 = 码面扫描证据。
 *
 * 四查：
 *   1. 闭集一致性——docs 两栏表词集并集 vs PLUGIN_HOOK_VOCABULARY：无缺
 *      （词汇在册而两表缺席）/无多（表词不在词汇表）/无重（跨表或表内重复）；
 *      表头计数（活词（N）/保留词（N））与正文「N 词固定闭集」宣称句同笔对拍。
 *   2. 模式一致——docs 两表「模式」列逐词对拍词汇表 mode（四值闭集）。
 *   3. 发射位覆盖——docs 活词每词 ≥1 真发射位证据（全仓）且锚文件内恰有
 *      证据（docs 锚与码面发射位漂移即红）；保留词每词 0 证据（保留词出现
 *      证据 = 应迁活词表——docs 陈旧即红）。
 *   4. 锚文件存在——docs 活词第三列模块路径须解析到在场文件（相对仓根）。
 *
 * 发射位三形探测规则（桥形侦察定谳——2026-10-18 本批钉定）：
 *   - 字面形：`dispatch.emit|waterfall|serial|parallel('词'`（裸/链式接收器
 *     皆认——`dispatch.emit(`、`this.dispatch.waterfall(`、
 *     `options.dispatch.emit(`；泛型参 `<T>` 容忍）；
 *   - 契约常量形：先扫 `export const X = '词'` 建 const→词映射（词域限
 *     词汇表），再扫 `dispatch.<mode>(X` 用法——contracts/conversation/tools
 *     域常量（TOOL_PRE_EXECUTE_EVENT 等 7 枚）经此展开；
 *   - agent 域源点形：`emit({ type: '词'` 对象字面量发射——agent 核事件
 *     （agent_start、agent_end、turn_start 等 message 与 tool_execution 域
 *     共十词）的派发
 *     桥是「无桥」：源点在 agent 核（src/agent/loop.ts、stream.ts、
 *     tools-batch.ts——`emit({ type: … })` 经 config.onEvent 下行进 driver
 *     onLiveEvent 两腿〔durable 翻译 + channels 信封〕，全仓无逐词 switch、
 *     无映射表、无按 event.type 泛型派发进插件钩子总线），故 docs 活词表
 *     对这十词锚的就是源点文件，探测规则同锚源点字面形。
 *   探测域 = src/ + plugins/ 非测试文件（.test. 排除）；剥注释保字符串
 *   （串内容即证据载体——字面形/常量形/源点形的词全在字符串位，check-vocab
 *   的 stripCode〔连串剥〕不可抄，本锁自持注释剥离器）。
 *
 * 测试豁免缝：CHECK_HOOK_COVERAGE_ROOT env 注入夹具根（守护炮自测用，
 * 07 篇 §7.4 #10）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 仓库根（env 根缝缺省真仓——守护炮自测经缝注入夹具根，绝对路径直用） */
const ROOT = process.env.CHECK_HOOK_COVERAGE_ROOT ?? process.cwd();

/** docs 两栏表载体（相对 ROOT 固定路径——插件作者面唯一文档真源） */
const DOC_FILE = 'docs/plugin-development.md';
/** 词汇/模式真源载体（相对 ROOT 固定路径——41 词执法镜像数组） */
const VOCAB_FILE = 'src/host/plugin-context.ts';

/** 钩子分派四模式闭集（03 §2.4——模式是钩子公开契约的一部分） */
const MODES = new Set(['emit', 'waterfall', 'serial', 'parallel']);

/** 违规累积器（分类前缀 + 逐词点名；红时 exit 1） */
const violations = [];

/** 绿面三形计数（主流程四查全绿路径填充——真源不可解析时恒先红退） */
let formCounts = { 字面形: 0, 常量形: 0, 源点形: 0 };

/**
 * 记一条违规。
 * @param {string} kind 分类前缀（闭集/模式/发射位/锚）
 * @param {string} message 逐词点名详情
 */
function report(kind, message) {
  violations.push(`[${kind}] ${message}`);
}

// ── 注释剥离器（保字符串保行数——与 check-vocab stripCode 的差异：串内容是
//    本锁的证据载体不可剥；单趟状态机防「串内 // 被误判行注释」假阴）────────
/**
 * 剥离注释、保留字符串与行数（行注释/块注释位抹空白；块注释换行守恒）。
 * 状态机六态：normal / line / block / 单引号 / 双引号 / 模板串。模板串内
 * ${…} 插值不递归开态（插值内容按串内容保真——证据位不在插值内，简化向
 * 宁保真不误剥）。
 * @param {string} text 源文本
 * @returns {string} 同行数文本（注释位变空白、字符串原样）
 */
function stripComments(text) {
  let out = '';
  let i = 0;
  let state = 'normal';
  const n = text.length;
  while (i < n) {
    const c = text[i];
    const d = i + 1 < n ? text[i + 1] : '';
    if (state === 'normal') {
      if (c === '/' && d === '/') {
        state = 'line';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        out += '  ';
        i += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        state = c === "'" ? 'sq' : c === '"' ? 'dq' : 'tpl';
        out += c;
        i += 1;
        continue;
      }
      out += c;
      i += 1;
      continue;
    }
    if (state === 'line') {
      // 行注释：行内抹空保换行
      if (c === '\n') {
        state = 'normal';
        out += '\n';
      } else out += ' ';
      i += 1;
      continue;
    }
    if (state === 'block') {
      // 块注释：整块按原行数占位（N 行 → N-1 个换行，行号守恒）
      if (c === '*' && d === '/') {
        state = 'normal';
        out += '  ';
        i += 2;
        continue;
      }
      out += c === '\n' ? '\n' : ' ';
      i += 1;
      continue;
    }
    // 三种字符串态：内容原样保真；转义对整体透传；闭引号回 normal
    if (c === '\\') {
      out += c + d;
      i += 2;
      continue;
    }
    if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) {
      state = 'normal';
    }
    out += c;
    i += 1;
  }
  return out;
}

/**
 * 递归收集目录下指定后缀文件（跳过 node_modules / dist 产物目录）。
 * @param {string} dir 起始目录（相对 ROOT）
 * @param {string[]} exts 后缀白名单
 * @returns {string[]} 相对路径列表
 */
function collect(dir, exts) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const skip = new Set(['node_modules', 'dist', 'out']);
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const s = statSync(p);
      if (s.isDirectory()) {
        if (!skip.has(e)) walk(p);
      } else if (exts.some((x) => p.endsWith(x))) {
        out.push(relative(ROOT, p));
      }
    }
  };
  walk(abs);
  return out;
}

// ── 真源一：PLUGIN_HOOK_VOCABULARY 解析（词汇 + 模式）───────────────────────
/**
 * 解析词汇表真源：定位 `export const PLUGIN_HOOK_VOCABULARY` 数组字面量，
 * 逐条取 `{ name: '词', mode: '模式' }`。
 * @returns {{ name: string, mode: string }[] | null} 词条列表（文件缺席/零条目返 null）
 */
function parseVocabulary() {
  const abs = join(ROOT, VOCAB_FILE);
  if (!existsSync(abs)) return null;
  const text = readFileSync(abs, 'utf8');
  const declAt = text.indexOf('export const PLUGIN_HOOK_VOCABULARY');
  if (declAt < 0) return null;
  const endAt = text.indexOf('\n];', declAt);
  if (endAt < 0) return null;
  const body = text.slice(declAt, endAt);
  /** @type {{ name: string, mode: string }[]} */
  const entries = [];
  const re = /\{\s*name:\s*(['"])([^'"]+?)\1\s*,\s*mode:\s*(['"])([^'"]+?)\3\s*\}/g;
  for (const m of body.matchAll(re)) entries.push({ name: m[2], mode: m[4] });
  return entries.length > 0 ? entries : null;
}

// ── 真源二：docs 两栏表解析（活词 + 保留词）─────────────────────────────────
/**
 * 解析 docs 钩子词汇主表两栏：`#### 活词（N）` 与 `#### 保留词（N…）` 两个
 * 标题下的表格行（词 = 首列反引号词、模式 = 次列、锚 = 活词第三列首个
 * 反引号路径样 token）。
 * @returns {null | { activeHeaderCount: number, reservedHeaderCount: number,
 *   active: { word: string, mode: string, anchor: string | undefined }[],
 *   reserved: { word: string, mode: string }[], closureClaim: number | null }}
 */
function parseDocs() {
  const abs = join(ROOT, DOC_FILE);
  if (!existsSync(abs)) return null;
  const lines = readFileSync(abs, 'utf8').split('\n');
  // 正文「N 词固定闭集」宣称句（可裁措辞——句缺席则跳过该项对拍）
  let closureClaim = null;
  for (const l of lines) {
    const m = l.match(/(\d+)\s*词固定闭集/);
    if (m) {
      closureClaim = Number(m[1]);
      break;
    }
  }
  const findHeader = (re) => lines.findIndex((l) => re.test(l));
  const activeAt = findHeader(/^####\s*活词（(\d+)）/);
  const reservedAt = findHeader(/^####\s*保留词（(\d+)/);
  if (activeAt < 0 || reservedAt < 0 || reservedAt <= activeAt) return null;
  const activeHeaderCount = Number(lines[activeAt].match(/^####\s*活词（(\d+)）/)[1]);
  const reservedHeaderCount = Number(lines[reservedAt].match(/^####\s*保留词（(\d+)/)[1]);
  /**
   * 收标题后的表格行（连续 | 行；跳过表头行与分隔行）。
   * @param {number} from 起始行号（标题行）
   * @returns {{ word: string, mode: string, anchor: string | undefined }[]}
   */
  const tableRows = (from) => {
    /** @type {{ word: string, mode: string, anchor: string | undefined }[]} */
    const rows = [];
    let inTable = false;
    for (let i = from + 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line.trimStart().startsWith('|')) {
        if (inTable) break; // 表格已开又遇非表格行——表尽
        continue; // 标题与表格间的空行
      }
      inTable = true;
      const cells = line.split('|');
      if (cells.length < 4) continue; // 形不完整的行不解析
      const wordCell = cells[1] ?? '';
      const modeCell = (cells[2] ?? '').trim();
      const thirdCell = cells[3] ?? '';
      if (wordCell.includes('钩子')) continue; // 表头行
      if (/^[-\s|:]+$/.test(line)) continue; // 分隔行
      const word = (wordCell.match(/`([^`]+)`/) ?? [])[1];
      if (word === undefined) continue; // 无反引号词——非词行
      // 锚 = 第三列首个路径样反引号 token（描述文本里的裸文件名不认）
      let anchor;
      for (const t of thirdCell.matchAll(/`([^`]+)`/g)) {
        if (/^[\w./-]+\.(?:ts|tsx|mjs|js)$/.test(t[1])) {
          anchor = t[1];
          break;
        }
      }
      rows.push({ word, mode: modeCell, anchor });
    }
    return rows;
  };
  return {
    closureClaim,
    activeHeaderCount,
    reservedHeaderCount,
    active: tableRows(activeAt),
    reserved: tableRows(reservedAt).map((r) => ({ word: r.word, mode: r.mode })),
  };
}

// ── 码面扫描：const→词映射 + 发射位三形证据 ─────────────────────────────────
/** 扫描域：src/ + plugins/ 产码（.test. 测试件排除——测试装置非生产发射位） */
const scanFiles = [...collect('src', ['.ts', '.tsx']), ...collect('plugins', ['.ts', '.tsx'])].filter(
  (f) => !f.includes('.test.'),
);

/**
 * 契约常量形第一腿：const→词映射（词域限词汇表——SESSION_LIFECYCLE_EVENT 等
 * 非钩子词常量不入映射）。
 * @param {Set<string>} vocabWords 词汇表词集
 * @returns {Map<string, string>} 常量名 → 钩子词
 */
function buildConstMap(vocabWords) {
  /** @type {Map<string, string>} */
  const map = new Map();
  const re = /export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*(['"])([^'"]+?)\2/g;
  for (const file of scanFiles) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    for (const m of stripComments(text).matchAll(re)) {
      if (vocabWords.has(m[3])) map.set(m[1], m[3]);
    }
  }
  return map;
}

/**
 * 发射位三形证据扫描（字面形 + 常量形 + agent 域源点形）。
 * @param {Map<string, string>} constMap 常量名 → 钩子词
 * @param {Set<string>} vocabWords 词汇表词集
 * @returns {Map<string, { file: string, line: number, form: string }[]>} 词 → 证据位列表
 */
function scanEvidence(constMap, vocabWords) {
  /** @type {Map<string, { file: string, line: number, form: string }[]>} */
  const evidence = new Map();
  /**
   * 记一笔证据。
   * @param {string} word 钩子词
   * @param {string} file 相对路径
   * @param {number} at 命中下标（折行号用）
   * @param {string} stripped 剥离后全文
   * @param {string} form 探测形标签
   */
  const put = (word, file, at, stripped, form) => {
    if (!vocabWords.has(word)) return; // 非钩子词（retry_wait_* 等）不入证据账
    const line = stripped.slice(0, at).split('\n').length;
    const list = evidence.get(word) ?? [];
    list.push({ file, line, form });
    evidence.set(word, list);
  };
  // 派发调用形（字面 + 常量两形合并：首参字符串字面量或全大写常量标识符；
  // 订阅位 dispatch.on / 注册位 registerEventNames 不在射程）
  const dispatchRe =
    /\bdispatch\s*\.\s*(?:emit|waterfall|serial|parallel)\s*(?:<[^()<>()]*>)?\s*\(\s*(?:(['"])([^'"]+?)\1|([A-Z][A-Z0-9_]*)\b)/g;
  // agent 域源点形：emit 调用携对象字面量 type 首键（agent 核 EmitFn 惯形）
  const sourceRe = /\bemit\s*\(\s*\{\s*type:\s*(['"])([^'"]+?)\1/g;
  for (const file of scanFiles) {
    const stripped = stripComments(readFileSync(join(ROOT, file), 'utf8'));
    for (const m of stripped.matchAll(dispatchRe)) {
      if (m[2] !== undefined) put(m[2], file, m.index ?? 0, stripped, '字面形');
      else if (m[3] !== undefined && constMap.has(m[3])) {
        put(constMap.get(m[3]), file, m.index ?? 0, stripped, '常量形');
      }
    }
    for (const m of stripped.matchAll(sourceRe)) {
      put(m[2], file, m.index ?? 0, stripped, '源点形');
    }
  }
  return evidence;
}

// ── 主流程：真源解析 → 四查 → 收口 ─────────────────────────────────────────
const vocab = parseVocabulary();
const docs = parseDocs();

if (vocab === null) {
  report('真源', `词汇表真源不可解析：${VOCAB_FILE} 缺席或 PLUGIN_HOOK_VOCABULARY 数组零条目`);
}
if (docs === null) {
  report('真源', `docs 两栏表不可解析：${DOC_FILE} 缺席或「#### 活词（N）/#### 保留词（N」两标题不全`);
}

if (vocab !== null && docs !== null) {
  const vocabWords = new Set(vocab.map((v) => v.name));
  const vocabMode = new Map(vocab.map((v) => [v.name, v.mode]));

  // 词汇表自检：词重复 / 模式出闭集（真源自身坏形先红——执法面不容带病）
  const seen = new Set();
  for (const v of vocab) {
    if (seen.has(v.name)) report('闭集', `词汇表 PLUGIN_HOOK_VOCABULARY 内词「${v.name}」重复登记`);
    seen.add(v.name);
    if (!MODES.has(v.mode)) report('闭集', `词汇表词「${v.name}」模式「${v.mode}」不在四值闭集`);
  }

  // —— 查一：闭集一致性（缺/多/重 + 表头计数 + 宣称句计数）——
  /** @type {Map<string, number>} */
  const docWordCount = new Map();
  for (const row of [...docs.active, ...docs.reserved]) {
    docWordCount.set(row.word, (docWordCount.get(row.word) ?? 0) + 1);
  }
  for (const [word, count] of docWordCount) {
    if (count > 1) report('闭集', `词「${word}」在 docs 两栏表重复出现 ${count} 次（活词/保留词互斥分列）`);
    if (!vocabWords.has(word))
      report('闭集', `docs 表词「${word}」不在 PLUGIN_HOOK_VOCABULARY（词汇真源单点 ${VOCAB_FILE}）`);
  }
  for (const v of vocab) {
    if (!docWordCount.has(v.name))
      report('闭集', `词汇「${v.name}」在册而 docs 两栏表缺席（活词+保留词并集须恰覆盖词汇表）`);
  }
  if (docWordCount.size !== vocab.length) {
    report('闭集', `docs 两栏表词数 ${docWordCount.size} ≠ 词汇表长度 ${vocab.length}`);
  }
  if (docs.active.length !== docs.activeHeaderCount) {
    report('闭集', `活词表头计数 ${docs.activeHeaderCount} ≠ 实际行数 ${docs.active.length}`);
  }
  if (docs.reserved.length !== docs.reservedHeaderCount) {
    report('闭集', `保留词表头计数 ${docs.reservedHeaderCount} ≠ 实际行数 ${docs.reserved.length}`);
  }
  if (docs.closureClaim !== null && docs.closureClaim !== vocab.length) {
    report('闭集', `docs 宣称「${docs.closureClaim} 词固定闭集」≠ 词汇表长度 ${vocab.length}`);
  }

  // —— 查二：模式一致 ——
  for (const row of [...docs.active, ...docs.reserved]) {
    const truth = vocabMode.get(row.word);
    if (truth !== undefined && row.mode !== truth) {
      report('模式', `docs「${row.word}」模式 ${row.mode} ≠ 词汇表 mode ${truth}`);
    }
  }

  // —— 查三 + 查四：发射位覆盖 + 锚文件 ——
  const evidence = scanEvidence(buildConstMap(vocabWords), vocabWords);
  for (const row of docs.active) {
    const sites = evidence.get(row.word) ?? [];
    if (sites.length === 0) {
      report('发射位', `活词「${row.word}」全仓零发射位证据（三形探测：字面/常量/源点——见本件头注）`);
    }
    // 锚路径解析（查四）与锚内证据（查三第二腿——docs 锚与码面发射位同步）
    if (row.anchor === undefined) {
      report('锚', `活词「${row.word}」第三列未解析到锚路径（首个反引号路径样 token）`);
      continue;
    }
    if (!existsSync(join(ROOT, row.anchor))) {
      report('锚', `活词「${row.word}」锚文件不存在：${row.anchor}`);
      continue;
    }
    if (!sites.some((s) => s.file === row.anchor)) {
      const elsewhere = sites[0] ? `（证据位在 ${sites[0].file}:${sites[0].line}）` : '';
      report('锚', `活词「${row.word}」锚文件 ${row.anchor} 内零发射位证据——docs 锚与码面发射位漂移${elsewhere}`);
    }
  }
  for (const row of docs.reserved) {
    const sites = evidence.get(row.word) ?? [];
    if (sites.length > 0) {
      const at = sites
        .slice(0, 3)
        .map((s) => `${s.file}:${s.line}（${s.form}）`)
        .join('、');
      report(
        '发射位',
        `保留词「${row.word}」存在 ${sites.length} 处发射位证据（${at}${sites.length > 3 ? '…' : ''}）——发射位已落，应迁活词表`,
      );
    }
  }

  // 绿面计数（消费位：守护炮自测断言与人工对拍；真源不可解析时上面已红退——恒已初始化）
  formCounts = { 字面形: 0, 常量形: 0, 源点形: 0 };
  for (const sites of evidence.values()) for (const s of sites) formCounts[s.form] += 1;
}

// ── 收口：违规即 exit 1 逐条点名；净树打计数行 ────────────────────────────────
if (violations.length > 0) {
  console.error(
    `check-hook-coverage 红：${violations.length} 处 docs 钩子两栏表与码面漂移（词汇真源 ${VOCAB_FILE} + 发射位三形探测）`,
  );
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
if (vocab === null || docs === null) process.exit(1); // 真源不可解析已点名——无计数面可打
console.log(
  `check-hook-coverage 绿：词汇 ${vocab.length} = 活词 ${docs.active.length} + 保留词 ${docs.reserved.length}；` +
    `发射位证据 ${Object.values(formCounts).reduce((a, b) => a + b, 0)} 笔（字面 ${formCounts['字面形']} / 常量 ${formCounts['常量形']} / 源点 ${formCounts['源点形']}）；` +
    `锚文件 ${docs.active.length}/${docs.active.length} 在场且内含证据`,
);
