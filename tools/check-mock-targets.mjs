#!/usr/bin/env node
/**
 * mock 目标检查器 v0（研究档 E13——「mock 只停模型层/零行为替身」纪律的机器执法）。
 *
 * 现状健康面（HEAD 盘点）：node 轨测试 vi.mock 仅 3 处且全 passthrough 单点形
 * （node:crypto 钉值 randomBytes + issue barrel 捕获缝 ×2）——但新增行为级
 * vi.mock 无任何机器拦截，纪律只活在 CLAUDE.md 文字。本件把两查升为机器判：
 *   1. 目标白名单——vi.mock 首参目标须在 MOCK_TARGET_WHITELIST（扩展白名单
 *      须同批注缺席原因——见下方表内注）；
 *   2. passthrough 形加严——工厂体必须含 importOriginal 调用与 ...actual
 *      spread（凡整体替身/零工厂 automock/无 spread 即红）。
 *
 * 管辖面：node 轨 *.test.ts（src/** 与 packages/berry-agent-sdk/**）。webui
 * -client 轨 *.test.tsx 的 api 模块全桩是已立的 SPA 组件测试法（jsdom 环境，
 * app.test.tsx 头注自述），不在「宿主面替身」纪律射程——不扫 .tsx。
 *
 * 独立 script（npm run lint:mocks）——按纪律不并入 lint:topology/四门禁，
 * 手动/夜班自取。配套自举 tools/check-mock-targets.test.mjs（node --test 形，
 * 不入 vitest include——vitest 对 tools 测试是逐件点名制，扩名册须另批）。
 *
 * 已知保守近似（承 check-vocab 同向律）：注释剥离器不识别正则字面量——正则
 * 文本内含 // 形会使该行尾进入假注释态（漏报方向，宁漏不误咬）。
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 仓库根（脚本自身位推根；env 根缝留给自举测试注入夹具根） */
const REPO_ROOT = process.env.CHECK_MOCKS_ROOT ?? fileURLToPath(new URL('..', import.meta.url));

/**
 * vi.mock 目标白名单（现状恰两目标——三处消费）：
 * - 'node:crypto'：pipeline-spill-eexist.test.ts 单点钉值 randomBytes（铸名可
 *   预知——EEXIST 竞态复现的确定性面，非行为替身）；
 * - '../issue/index.js'：run-issue-verify(.env).test.ts 捕获缝（spread 全真
 *   导出 + 记录后原样转发——零行为替身，捕获装配位生产闭包本体）。
 * 扩展本表须同批注缺席原因（为何该目标允许文件级 vi.mock）。
 */
const MOCK_TARGET_WHITELIST = new Set(['node:crypto', '../issue/index.js']);

/**
 * 剥注释保行位（字符串感知单趟状态机）：注释字符替换为空白、换行原样保留
 * （行号可算）；字符串字面量原样保留（vi.mock 目标是字符串——不能抹）。
 * 状态：code / 行注释 / 块注释 / 单引号 / 双引号 / 模板串（${} 嵌套回 code）。
 * @param {string} text 源文本
 * @returns {string} 同行数文本（注释位变空白）
 */
export function stripComments(text) {
  const out = [];
  const tplStack = []; // 模板串插值栈：true = 在模板串字面量内，false = 在 ${} 表达式内
  let state = 'code';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];
    if (c === '\n') {
      out.push('\n');
      // 行注释遇换行即收（其余状态换行原样过）
      if (state === 'line-comment') state = 'code';
      continue;
    }
    switch (state) {
      case 'line-comment':
        out.push(' ');
        break;
      case 'block-comment':
        out.push(' ');
        if (c === '*' && next === '/') {
          out.push(' ');
          i++;
          state = 'code';
        }
        break;
      case 'single':
        out.push(c);
        if (c === '\\') {
          out.push(next ?? ' ');
          i++;
        } else if (c === "'") state = 'code';
        break;
      case 'double':
        out.push(c);
        if (c === '\\') {
          out.push(next ?? ' ');
          i++;
        } else if (c === '"') state = 'code';
        break;
      case 'template':
        out.push(c);
        if (c === '\\') {
          out.push(next ?? ' ');
          i++;
        } else if (c === '`') {
          tplStack.pop();
          state = tplStack.length === 0 || tplStack[tplStack.length - 1] === false ? 'code' : 'template';
        } else if (c === '$' && next === '{') {
          out.push('{');
          i++;
          tplStack.push(false); // 进入插值表达式
          state = 'code';
        }
        break;
      case 'code':
      default: {
        if (c === '/' && next === '/') {
          out.push('  ');
          i++;
          state = 'line-comment';
        } else if (c === '/' && next === '*') {
          out.push('  ');
          i++;
          state = 'block-comment';
        } else if (c === "'") {
          out.push(c);
          state = 'single';
        } else if (c === '"') {
          out.push(c);
          state = 'double';
        } else if (c === '`') {
          out.push(c);
          tplStack.push(true);
          state = 'template';
        } else if (c === '}' && tplStack.length > 0 && tplStack[tplStack.length - 1] === false) {
          // 插值表达式收口——弹插位标记回到模板串字面量态（模板自身标记仍在栈下）
          out.push(c);
          tplStack.pop();
          state = 'template';
        } else {
          out.push(c);
        }
        break;
      }
    }
  }
  return out.join('');
}

/**
 * 剥注释后文本的偏移 → 行号（1 基——换行保位可直接数）。
 * @param {string} stripped 剥离后文本
 * @param {number} offset 字符偏移
 * @returns {number}
 */
function lineOf(stripped, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < stripped.length; i++) {
    if (stripped[i] === '\n') line++;
  }
  return line;
}

/**
 * 从 vi.mock( 起始开括号做括号配平，取整个调用的闭合偏移。
 * @param {string} stripped 剥注释文本
 * @param {number} openPos '(' 偏移
 * @returns {number} ')' 偏移（-1 = 未配平——语法坏形，视为到文末）
 */
function balanceParen(stripped, openPos) {
  let depth = 0;
  for (let i = openPos; i < stripped.length; i++) {
    const c = stripped[i];
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/**
 * 单文件执法：抽全部 vi.mock 调用并逐条两查（目标白名单 + passthrough 形）。
 * @param {string} text 源文本（原样——本函数内剥注释）
 * @returns {Array<{line: number, message: string}>} 违规清单（空 = 干净）
 */
export function scanViolations(text) {
  const stripped = stripComments(text);
  const violations = [];
  const callRe = /\bvi\s*\.\s*mock\s*\(/g;
  for (const match of stripped.matchAll(callRe)) {
    const openPos = match.index + match[0].length - 1;
    const closePos = balanceParen(stripped, openPos);
    const callText = stripped.slice(openPos + 1, closePos === -1 ? stripped.length : closePos);
    const line = lineOf(stripped, match.index);

    // 首参目标：须为字符串字面量（动态目标不可对拍——fail-closed 即红）
    const targetMatch = callText.match(/^\s*(['"])([^'"]+)\1/);
    if (targetMatch === null) {
      violations.push({ line, message: 'vi.mock 目标非字符串字面量（动态目标不可对拍）' });
      continue;
    }
    const target = targetMatch[2];
    const rest = callText.slice(targetMatch[0].length);

    // 查 1：目标白名单
    if (!MOCK_TARGET_WHITELIST.has(target)) {
      violations.push({
        line,
        message: `vi.mock 目标不在白名单：'${target}'（扩展白名单须同批注缺席原因——见 MOCK_TARGET_WHITELIST 表注）`,
      });
      continue;
    }
    // 查 2：passthrough 形——零工厂（automock=全行为替身）或工厂体缺
    // importOriginal 调用 / ...actual spread 均红
    const factoryMatch = rest.match(/^\s*,\s*([\s\S]*)$/);
    if (factoryMatch === null) {
      violations.push({
        line,
        message: `vi.mock('${target}') 零工厂（automock = 全行为替身）——passthrough 单点形才可入白名单`,
      });
      continue;
    }
    const factory = factoryMatch[1];
    const hasImportOriginal = /\bimportOriginal\b/.test(factory);
    const hasActualSpread = /\.\.\.\s*actual\b/.test(factory);
    if (!hasImportOriginal || !hasActualSpread) {
      violations.push({
        line,
        message: `vi.mock('${target}') 工厂非 passthrough 形（须含 importOriginal 调用 + ...actual spread——文件级行为替身与「mock 只停模型层」纪律冲突）`,
      });
    }
  }
  return violations;
}

/**
 * 递归收集测试文件（node 轨 .test.ts——跳过 node_modules/dist 产物位）。
 * @param {string} root 根目录
 * @param {string} dir 相对子目录（'src' | 'packages/berry-agent-sdk'）
 * @returns {string[]} 绝对路径列表
 */
function collectTestFiles(root, dir) {
  const abs = join(root, dir);
  if (!existsSync(abs)) return [];
  const skip = new Set(['node_modules', 'dist', 'out']);
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) {
        if (!skip.has(entry)) walk(p);
      } else if (entry.endsWith('.test.ts')) {
        out.push(p);
      }
    }
  };
  walk(abs);
  return out;
}

/**
 * 全仓执法入口。
 * @returns {Array<{file: string, line: number, message: string}>}
 */
export function checkTree(root = REPO_ROOT) {
  const found = [];
  for (const dir of ['src', 'packages/berry-agent-sdk']) {
    for (const file of collectTestFiles(root, dir)) {
      const violations = scanViolations(readFileSync(file, 'utf8'));
      for (const v of violations) found.push({ file: relative(root, file), line: v.line, message: v.message });
    }
  }
  return found;
}

/* ---------------- CLI 面（独立 script 消费——自举测试走纯函数导入） ---------------- */

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = checkTree();
  if (violations.length > 0) {
    console.error(
      `lint:mocks：${violations.length} 处文件级 vi.mock 违规（mock 只停模型层——passthrough 单点形才可入白名单）：`,
    );
    for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.message}`);
    process.exit(1);
  }
  const count =
    collectTestFiles(REPO_ROOT, 'src').length + collectTestFiles(REPO_ROOT, 'packages/berry-agent-sdk').length;
  console.log(`lint:mocks：干净（vi.mock 目标白名单 + passthrough 形两查过——扫描 ${count} 个 node 轨测试文件）`);
}
