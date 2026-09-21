#!/usr/bin/env node
/**
 * 词汇门禁 v0（07 篇 §7.4 续件 4——2026-09-15 贡献流程批；承 07 §7.4 #3
 * 时态/词汇门禁规划的首批查项落地，从零自建）。
 *
 * 三查（词表真源 02 §5.2 禁用词表 + 07 §7.4 续件 4 查项定形 + 「公开面禁谱系暴露」用户令 2026-09-14）：
 *   1. 「应用/app」标识符位——剥离注释与字符串后查独立词与驼峰形
 *      （`\bapp\b` 族 + `enablePlugin/disablePlugin` 插件语境复合形）。
 *      剥离法天然豁免外部真值：`Google Chrome.app` 路径串、CDP 协议名
 *      `Page.enable` 全在字符串/注释位。enable/disable 弃用令射程 =
 *      插件生命周期动词位（02 §5.2 / 03 §5.1）——GoalJobsFace.enable/disable
 *      是 04 §12 登记的挂钟行契约名，setRawMode(enable) 是 Node 形签名，
 *      皆不在射程，故只咬 enablePlugin/disablePlugin 复合形。
 *   2. 中文违形复合（应用中心/应用型/应用商店/应用市场/应用列表）——不剥离全位查
 *      （注释与文档同咬——文档性内容一律禁双词汇）。
 *   3. 谱系词公开文档面——README 六语 / docs/ / 公开 AGENTS.md /
 *      CONTRIBUTING / SECURITY / .github：承自 / 对标 / pi-ai / dsh /
 *      opencode / Emacs / 独立词 pi / 谱系。豁免两形：`-pi`（perl 旗标）、
 *      「谱系闸」（本仓 Job 归属机制自产词——非项目谱系叙事）。
 *      知识域（设计文档/等 gitignore 面）与 AGENTS.local.md 不在管辖面。
 *
 * 测试豁免缝：CHECK_VOCAB_ROOT env 注入夹具根（守护炮自测用，07 §7.4 #10）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** 仓库根（env 根缝缺省真仓——守护炮自测经缝注入夹具根，绝对路径直用） */
const ROOT = process.env.CHECK_VOCAB_ROOT ?? process.cwd();

/**
 * 递归收集目录下指定后缀文件（跳过 node_modules / dist / 知识域目录）。
 * @param {string} dir 起始目录（相对 ROOT）
 * @param {string[]} exts 后缀白名单
 * @returns {string[]} 相对路径列表
 */
function collect(dir, exts) {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  /** 深度优先递归（跳过产物与知识域目录——后者不在查项管辖面） */
  const skip = new Set(['node_modules', 'dist', 'out', '设计文档', '参考源码', '研究源码']);
  const out = [];
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      const s = statSync(p);
      if (s.isDirectory()) {
        if (!skip.has(e)) walk(p);
      } else if (exts.some((x) => p.endsWith(x))) {
        // 存相对路径（呈现与豁免判定用），读取时再拼 ROOT
        out.push(relative(ROOT, p));
      }
    }
  };
  walk(abs);
  return out;
}

/**
 * 剥离注释与字符串、保行号（块注释按行占位；串内容抹空保换行）。
 * 剥离是保守近似：剥离器未覆盖形（如嵌套模板）倾向漏报——查项方向宁漏
 * 不误咬（对照语境内合法态多），发现漏报先修剥离器再放宽。
 * @param {string} text 源文本
 * @returns {string} 同行数文本（注释/字符串位变空白）
 */
function stripCode(text) {
  return (
    text
      // 块注释：整块按原行数占位（N 行 → N-1 个换行，行号守恒）
      .replace(/\/\*[\s\S]*?\*\//g, (m) =>
        m
          .split('\n')
          .map(() => '')
          .join('\n'),
      )
      // 行注释：行内抹空（保留换行）
      .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length))
      // 模板串 / 普通串：内容抹空保换行（先长串后短串防误截）
      .replace(/`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/'(?:\\.|[^'\\\n])*'/g, (m) => m.replace(/[^\n]/g, ' '))
      .replace(/"(?:\\.|[^"\\\n])*"/g, (m) => m.replace(/[^\n]/g, ' '))
  );
}

/** 查项词表（正则真源——豁免形内联于各查项函数） */

// 查一 A：「应用/app」标识符位（剥离后查——外部真值路径/协议名天然不在）。
// 全词形（\w* 收尾）：命中即完整标识符，豁免判定按全词精确比对。
// 豁免：AppState——webui 前端 SPA 语境的应用状态（React 生态惯例词，
// 指宿主应用 UI 状态非扩展单位，不在 02 §5.2「app 指扩展单位」射程）。
const APP_IDENT_RE = /\bapp\b|\bApp\b|\bAPP\b|\bapp[A-Z]\w*|\bApp[A-Z]\w*/g;
const APP_IDENT_EXEMPT = new Set(['AppState']);
// 查一 B：enable/disable 弃用词的插件语境复合形（射程 = 生命周期动词位）
const LIFECYCLE_RE = /\benablePlugin\b|\bdisablePlugin\b|\bpluginEnable\b|\bpluginDisable\b/g;
// 查二：中文违形复合（全位含注释——文档性内容一律禁）
const ZH_VIOLATION_RE = /应用中心|应用型|应用商店|应用市场|应用列表/g;
// 查三：谱系词（公开文档面）——豁免 -pi（perl 旗标）与 谱系闸（机制自产词）
const LINEAGE_RE = /承自|对标|谱系|pi-ai|\bdsh\b|opencode|Emacs|\bpi\b/g;

/** 违规累积器（file:line:词 | 摘要 逐条点名；计数尾行汇总） */
const violations = [];

/**
 * 记一条违规。
 * @param {string} file 相对路径
 * @param {number} line 行号（1 起）
 * @param {string} word 命中词
 * @param {string} source 原文行（摘要呈现）
 */
function report(file, line, word, source) {
  violations.push(`${file}:${line}: 「${word}」 | ${source.trim().slice(0, 72)}`);
}

// ── 查一 + 查二：代码面（src/**/*.ts + .tsx——2026-09-21 #24 扩面：.tsx 随
// React 根组件 App→WebUiRoot 更名批同步入射程，扩面先落即翻红卡全仓）──────
for (const file of collect('src', ['.ts', '.tsx'])) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const stripped = stripCode(text);
  const lines = text.split('\n');
  const strippedLines = stripped.split('\n');
  strippedLines.forEach((l, i) => {
    for (const re of [APP_IDENT_RE, LIFECYCLE_RE]) {
      re.lastIndex = 0;
      for (const m of l.matchAll(re)) {
        if (re === APP_IDENT_RE && APP_IDENT_EXEMPT.has(m[0])) continue;
        report(file, i + 1, m[0], lines[i] ?? '');
      }
    }
  });
  // 中文违形全位查（不剥离——注释同咬）
  lines.forEach((l, i) => {
    ZH_VIOLATION_RE.lastIndex = 0;
    for (const m of l.matchAll(ZH_VIOLATION_RE)) report(file, i + 1, m[0], l);
  });
}

// ── 查二 + 查三：公开文档面 ────────────────────────────────────────────────
// '.' 递归收全树 md（README 六语 + packages README 等），排除已单收的
// docs/ 与 .github/ 子树（防重复扫描双报）
const docFiles = collect('.', ['.md']).filter((f) => !f.startsWith('docs/') && !f.startsWith('.github/'));
const docFilesAll = [...docFiles, ...collect('docs', ['.md']), ...collect('.github', ['.md', '.yml', '.yaml'])];
for (const file of docFilesAll) {
  // AGENTS.local.md 是本地治理文档（gitignore 面），不在公开管辖面
  if (file === 'AGENTS.local.md' || file === 'CLAUDE.md') continue;
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  lines.forEach((l, i) => {
    ZH_VIOLATION_RE.lastIndex = 0;
    for (const m of l.matchAll(ZH_VIOLATION_RE)) report(file, i + 1, m[0], l);
    LINEAGE_RE.lastIndex = 0;
    for (const m of l.matchAll(LINEAGE_RE)) {
      // 豁免一：-pi 是 perl 旗标（grep -E / perl -pi -e 一类排查指引）
      // 豁免二：谱系闸是本仓 Job 归属机制自产词（非项目谱系叙事）
      const before = l.slice(0, m.index ?? 0);
      if (m[0] === 'pi' && /-\w*$/.test(before)) continue;
      if (m[0] === '谱系' && l.slice(m.index ?? 0).startsWith('谱系闸')) continue;
      report(file, i + 1, m[0], l);
    }
  });
}

// ── 收口：违规即 exit 1 逐条点名；净树打计数行（消费位：守护炮自测断言） ────
if (violations.length > 0) {
  console.error(`check-vocab 红：${violations.length} 处词汇违规（词表真源 02 §5.2 + 公开面禁谱系令）`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
const codeCount = collect('src', ['.ts', '.tsx']).length;
const docCount = docFilesAll.length;
console.log(`check-vocab 绿：代码面 ${codeCount} 件 + 公开文档面 ${docCount} 件零词汇违规`);
