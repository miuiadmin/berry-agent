#!/usr/bin/env node
/**
 * 词汇门禁 v0（07 篇 §7.4 续件 4——2026-09-15 贡献流程批；承 07 §7.4 #3
 * 时态/词汇门禁规划的首批查项落地，从零自建）。
 *
 * 四查（词表真源 02 §5.2 禁用词表 + 07 §7.4 续件 4 查项定形 + 「公开面禁谱系暴露」用户令 2026-09-14）：
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
 *   4. 用户面禁替词（07 §4.4 禁替表）——产码字符串字面量（2026-09-30
 *      话术批查四）+ 用户面文档腿（2026-10-01 补翻批扩射程：usage/
 *      operations/README 六语/packages README/issue 表单——正向清单执法，
 *      工程域文档与 skills//examples/ 模型面不在射程）。
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
// 查四：用户面禁替词——字符串字面量扫描（07 §4.4 禁替表 24 行的特异形；
// 2026-09-30 话术批查四扩展）。只咬高置信复合形，「件」「档」单义不扫
// （对照语境合法态过多——中文违形复合谱：宁漏不误咬）。
//   - 全词面：挂钟/变异前拍/保底拍/预演/切焦/回切/对账/委派折叠/判据门/
//     复探/坏形/越形/在册/撞名/选装/换装/缺省/开面/副屏/档位/应答
//   - 复合形补词（2026-10-01 wf_db273e73 扫描处置——低歧义复合形随实证
//     残词滚动补）：装配面/线面/退订
//   - 裸词入表（2026-10-01 wf_70e9b7b8 扫描处置——纯黑话无对照态直咬，
//     07 §4.4 裸词入表谱）：在飞/活体/词法违例
//   - 「帽」邻接中文形（X帽/帽X——产串中「帽」几乎全为「上限」禁义）
//   - 数字档形（\d档 + 三档/七档/两档——「read-only 档」等分类词经豁免台账
const USERFACE_RE =
  /挂钟|变异前拍|保底拍|预演|切焦|回切|对账|委派折叠|判据门|复探|坏形|越形|在册|撞名|选装|换装|缺省|开面|副屏|档位|应答|装配面|线面|退订|在飞|活体|词法违例|[一-龥]帽|帽[一-龥]|\d\s*档|三档|七档|两档/g;

/**
 * 提取字符串字面量内容、保行号（查四专用——与 stripCode 互补：只看串内容，
 * 注释/JSDoc 工程域不在射程）。模板串/单引号/双引号三形；剥离式近似——
 * 嵌套模板形倾向漏报，宁漏不误咬（谱同 stripCode 头注）。
 * @param {string} text 源文本
 * @returns {{line: number, content: string}[]} 命中串段列表
 */
function extractStrings(text) {
  /** @type {{line: number, content: string}[]} */
  const out = [];
  // 先按行占位剥离注释（块注释跨行占位 + 行注释抹空），再在余文中匹配串
  const noComments = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) =>
      m
        .split('\n')
        .map(() => '')
        .join('\n'),
    )
    .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
  const re = /`(?:\\.|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g;
  for (const m of noComments.matchAll(re)) {
    const before = noComments.slice(0, m.index ?? 0);
    const startLine = before.split('\n').length;
    out.push({ line: startLine, content: m[0] });
  }
  return out;
}

/**
 * 查四诊断道特征（结构性豁免判据）：命中行或其上一行（跨行调用形——warn(
 * 在串前一行）含 warn/logger/debug/console 族调用特征即诊断道射界外
 * （07 §4.4 诊断道射界排除条款——logger./warn./debug 串不进用户面）。
 * 不带 g 标志（无 lastIndex 状态——测试性优于复用 USERFACE_RE 的 g 形）。
 */
const DIAG_RE = /\bwarn\(|\bwarn\?\.\(|\bwarnFace\b|\blogger\b|\.debug\b|console\.(?:warn|error|log|info)\b/;

/**
 * 查四文件级豁免台账（07 §4.4——整文件工程目录面判定）。两类：
 *   - codes.ts 错误码注册表族：description 是工程目录面（错误码语义目录
 *     供开发者/规范对拍，非用户直读文案）。2026-09-30 话术批判定：词汇
 *     替换已行者不回退（F 先例 11 行），未行者按本豁免保留——后续新增
 *     code 的 description 一律用新词（台账头注纪律，不因豁免而放开）。
 *   - 工程单源件：manifest 治理表（API 治理 desc）/ persist DDL（SQL
 *     注释域）——字面串是工程规范真源非用户面。
 * contracts 三件（errors/api/events）另被 api-surface.json 快照镜像
 * 钉死——改 description 须动快照，故整文件豁免 + 快照不动。
 */
const USERFACE_FILE_EXEMPTS = [
  { file: 'src/checkpoint/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/context/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/contracts/api.ts', reason: 'API 治理 note 面——api-surface.json 快照镜像钉死' },
  { file: 'src/contracts/errors.ts', reason: '错误码注册表——api-surface.json 快照镜像钉死' },
  { file: 'src/contracts/events.ts', reason: '事件词汇表——api-surface.json 快照镜像钉死' },
  { file: 'src/conversation/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/credentials/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/goal/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/host/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/host/manifest.ts', reason: 'manifest 治理表 desc——API 治理工程单源' },
  {
    file: 'src/issue/codes.ts',
    reason: '错误码注册表 description 工程目录面（wf_70e9b7b8 批补——新模块注册表出生晚于 19 文件枚举）',
  },
  {
    file: 'src/llm/codes.ts',
    reason: '错误码注册表 description 工程目录面（wf_70e9b7b8 批补——新模块注册表出生晚于 19 文件枚举）',
  },
  { file: 'src/lsp/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/mcp/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/memory/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/obs/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/persist/schema.ts', reason: 'CANONICAL_DDL SQL 注释域——工程真源' },
  { file: 'src/safety/codes.ts', reason: '错误码注册表 description 工程目录面（F 先例已改 11 行不回退）' },
  {
    file: 'src/scheduler/codes.ts',
    reason: '错误码注册表 description 工程目录面（wf_70e9b7b8 批补——新模块注册表出生晚于 19 文件枚举）',
  },
  { file: 'src/session/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/subagent/codes.ts', reason: '错误码注册表 description 工程目录面' },
  { file: 'src/tools/codes.ts', reason: '错误码注册表 description 工程目录面' },
  {
    file: 'src/web/codes.ts',
    reason: '错误码注册表 description 工程目录面（wf_70e9b7b8 批补——新模块注册表出生晚于 19 文件枚举）',
  },
];

/**
 * 查四点条豁免台账（出生即绿判定的合法保留位——三类：误咬/模型面指令/
 * 工程占位）。锚形 = 文件 + 行内片段（行号漂移免疫——片段随文迁移仍豁免）。
 * 台账增改须携判定理由（07 §4.4 双消费分立 + 模型面指令保留条款——B lane
 * goal/todo-tool 先例：模型面既定机制词汇（挂钟/判据门）在指令语境保留，
 * 改词破坏模型对既有指令词汇的连续认知）。
 */
const USERFACE_EXEMPTS = [
  { file: 'src/safety/gate.ts', snippet: '无人应答', reason: '误咬——审批问句人答义（非传输应答）' },
  {
    file: 'src/host/core-plugins.ts',
    snippet: 'goal 挂钟唤醒，请继续推进',
    reason: '模型面指令——挂钟是 goal 纪律段既定机制词汇',
  },
  {
    file: 'src/goal/todo-tool.ts',
    snippet: '段·判据门',
    reason: '模型面指令回执标记——判据门是 goal 纪律段既定机制词汇',
  },
  { file: 'src/issue/service.ts', snippet: '本 prompt 不发往任何模型', reason: '工程占位描述——轮询占位符不发往模型' },
  { file: 'src/host/plugin-context.ts', snippet: '07 §4.3 档位', reason: '规范篇号条款引用——「档位 2/3」是编号非档词' },
];

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
// React 根组件 App→WebUiRoot 更名批同步入射程，扩面先落即翻红卡全仓）。
// 产码腿含 packages/*/src（2026-10-01 wf_db273e73 扫描处置扩面——SDK 错误
// 消息是 SDK 消费者可见面；文档腿既有 packages README 对称）──────────────
const codeFiles = [...collect('src', ['.ts', '.tsx']), ...collect('packages', ['.ts', '.tsx'])];
for (const file of codeFiles) {
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
  // 查四：用户面禁替词——字符串字面量扫描（注释不在射程；豁免台账判定）。
  // 执法面 = 产码文件——.test. 测试件跳过（describe/it 标题与 fixture 是
  // 工程域字符串非用户面；产码-测试一致性由对拍锁自保证，不由本查执法）。
  const isTest = file.includes('.test.');
  const fileExempt = USERFACE_FILE_EXEMPTS.some((e) => e.file === file);
  if (!isTest && !fileExempt) {
    for (const { line, content } of extractStrings(text)) {
      USERFACE_RE.lastIndex = 0;
      for (const m of content.matchAll(USERFACE_RE)) {
        const srcLine = lines[line - 1] ?? '';
        // 结构性豁免一：诊断道——本行或上一行（跨行 warn( 调用形）含
        // warn/logger/debug/console 族特征即射界外（07 §4.4 诊断道条款）
        const prevLine = lines[line - 2] ?? '';
        if (DIAG_RE.test(srcLine) || DIAG_RE.test(prevLine)) continue;
        // 点条豁免：文件匹配 + 行内含豁免片段即放行（片段锚随文迁移仍豁免）
        const exempt = USERFACE_EXEMPTS.some(
          (e) => e.file === file && srcLine.includes(e.snippet) && (e.word === undefined || e.word === m[0]),
        );
        if (exempt) continue;
        report(file, line, m[0], srcLine);
      }
    }
  }
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

// ── 查四文档腿：用户面文档 USERFACE 扫描（2026-10-01 补翻批扩射程——07
// §4.4 射界含用户直读文档）。正向清单执法：README 六语 / docs/usage /
// docs/operations / packages README / issue 表单。工程域文档
// （development / plugin-development / architecture / CONTRIBUTING /
// AGENTS / SECURITY / PR 模板——机制词在工程语境是术语）与 skills/ +
// examples/（模型面指令）不在射程；锚段豁免：markdown 链接 `(#锚)` 内
// 禁词随目标标题走——改标题必同步改锚、单改锚即断链，故锚段保留
// verbatim（07 §4.4 既定处置，断链比旧词伤更大）──────────────────────────
const DOC_USERFACE_FILES = docFilesAll.filter(
  (f) =>
    /^README(\.[a-z]{2})?\.md$/.test(f) ||
    f === 'docs/usage.md' ||
    f === 'docs/operations.md' ||
    /^packages\/[^/]+\/README\.md$/.test(f) ||
    f.startsWith('.github/ISSUE_TEMPLATE/'),
);
for (const file of DOC_USERFACE_FILES) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
  lines.forEach((l, i) => {
    // 锚段抹除后扫（行号/列位不守恒无妨——报告仍取原行；`(...#锚)` 含
    // 相对/绝对路径形——纯 URL 括号段无 # 不匹配）
    const scanLine = l.replace(/\([^)#]*#[^)]*\)/g, '(…)');
    USERFACE_RE.lastIndex = 0;
    for (const m of scanLine.matchAll(USERFACE_RE)) report(file, i + 1, m[0], l);
  });
}

// ── 收口：违规即 exit 1 逐条点名；净树打计数行（消费位：守护炮自测断言） ────
if (violations.length > 0) {
  console.error(`check-vocab 红：${violations.length} 处词汇违规（词表真源 02 §5.2 + 公开面禁谱系令）`);
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}
const codeCount = codeFiles.length;
const docCount = docFilesAll.length;
console.log(
  `check-vocab 绿：代码面 ${codeCount} 件 + 公开文档面 ${docCount} 件（用户面文档 ${DOC_USERFACE_FILES.length} 件含查四）零词汇违规`,
);
