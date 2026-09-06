#!/usr/bin/env node
/**
 * 模块 DAG 拓扑门禁 v0（07 篇 §7.1 门禁 ①；重建清单 #1——从零自建，边表真源 =
 * 02 篇 §4.1 模块表「依赖（仅允许）」列逐席转录）。
 *
 * 执法维度（本版在场四项；深挖面册双向棘轮 / 计数锚 / 非 .ts 白名单随落码批接入）：
 *   1. 相对导入跨模块必须走边表白名单——同模块内相对导入自由；
 *   2. 裸导入按模块分账白名单（node:* 全局；包依赖只准进指定模块——
 *      native 隔离律：better-sqlite3 只准 persist）；
 *   3. 跨模块导入只准走公开面（index/types/events/contract 四名）——
 *      深挖实现面即红（深挖面册机制随存量深挖出现再立）；
 *   4. 边表键集 ⊆ 在场模块 ∪ 显式占位清单（02 §4.3 #4）——未在场模块的
 *      边不判死边；在场模块的「声明未用」死边暂不执法（单模块期无意义，
 *      随第二模块落码启用双向执法）。
 *
 * 测试文件豁免（02 §4.3 #4 两账分离）：harness 全真组合跨模块合法——
 * 用例证据只计产码 import。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** 模块边表（25 席；02 篇 §4.1 依赖列全量转录——L3/L4 对 contracts 共边不省略） */
const MODULE_EDGES = {
  contracts: [],
  context: ['contracts'],
  session: ['contracts', 'context'],
  agent: ['contracts'],
  llm: ['contracts'],
  persist: ['contracts', 'session'],
  tools: ['contracts', 'context'],
  safety: ['contracts', 'context', 'tools'],
  compaction: ['contracts', 'session'],
  channels: ['contracts', 'context', 'agent'],
  conversation: ['contracts', 'context', 'agent', 'session', 'persist', 'tools', 'safety'],
  host: [
    'contracts',
    'context',
    'session',
    'agent',
    'llm',
    'persist',
    'tools',
    'safety',
    'compaction',
    'channels',
    'conversation',
    'skills',
    'memory',
    'subagent',
    'exec',
    'mcp',
    'web',
    'browser',
    'lsp',
    'checkpoint',
    'scheduler',
    'goal',
    'obs',
    'webui',
  ],
  skills: ['contracts', 'context'],
  memory: ['contracts', 'context', 'session', 'persist'],
  subagent: ['contracts', 'context', 'session', 'agent'],
  exec: ['contracts', 'context', 'safety', 'tools'],
  mcp: ['contracts', 'context'],
  web: ['contracts'],
  browser: ['contracts', 'web', 'persist'],
  lsp: ['contracts', 'context'],
  checkpoint: ['contracts', 'context', 'tools', 'persist'],
  scheduler: ['contracts', 'context', 'persist'],
  goal: ['contracts', 'context', 'persist', 'session'],
  obs: ['contracts', 'persist'],
  webui: ['contracts', 'channels'],
};

/** 在场模块集（占位清单语义：边表其余键 = 显式占位、不判死边；落码逐批迁移进来） */
const PRESENT_MODULES = new Set([
  'contracts',
  'context',
  'session',
  'persist',
  'llm',
  'agent',
  'tools',
  'safety',
  'compaction',
  'channels',
  // 批 11b 起在场（契约先行起面——11c-11f 纵切逐批充实）
  'conversation',
]);

/** 裸导入白名单（产码账；测试账豁免整个检查）——node:* 全局放行，包按模块分账 */
const NODE_BUILTIN = /^node:/;
const MODULE_EXTERNALS = {
  // pi-ai 裸导入仅 llm（07 篇栈纪律）：主包 + 两子路径（内置 provider 全家桶 /
  // Anthropic-first lazy api——主包出口不含 providers/* 与 api/*，package.json
  // exports 子路径即官方形态）
  llm: [
    '@earendil-works/pi-ai',
    '@earendil-works/pi-ai/providers/all',
    '@earendil-works/pi-ai/api/anthropic-messages.lazy',
  ],
  // get-east-asian-width 裸导入仅 channels（07 篇 §2.1 精确锁）：自研 TUI 引擎
  // width 件的 EAW 分类数据面（2026-09-06 TUI 栈改裁换防——pi-tui 出列、此包入替）
  channels: ['get-east-asian-width'],
  persist: ['better-sqlite3'],
  // typebox 主包 + value 子路径（07 篇栈纪律：schema 层——工具参数面；宿主件
  // 直用合法，插件侧一律走虚拟键三转发——与 llm 的 pi-ai 同款分账执法）；
  // ignore 包（07 篇 §120：gitignore 语义匹配——检索族遍历消费者之一）
  tools: ['typebox', 'typebox/value', 'ignore'],
  // conversation 的 todo 工具件参数面（07 篇 schema 层同律——宿主件直用；
  // 11e 落码批起用）
  conversation: ['typebox'],
};

/** 跨模块导入允许命中的公开面文件名（02 §4.3 #2 契约面四名） */
const PUBLIC_FACES = new Set(['index.ts', 'types.ts', 'events.ts', 'contract.ts']);

const SRC = join(process.cwd(), 'src');
const violations = [];

/** 递归收集 src 下产码 .ts（*.test.ts 豁免两账分离） */
function collectSourceFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...collectSourceFiles(full));
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

/** 文件归属模块（src 首段目录；顶层散文件不属任何模块——记违规） */
function moduleOf(file) {
  const rel = relative(SRC, file).split(sep);
  return rel.length > 1 ? rel[0] : null;
}

/** 从源文本提取全部 import 说明符（静态 import/export-from 两形） */
function importSpecifiers(text) {
  const specs = [];
  const re = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;
  for (const m of text.matchAll(re)) specs.push(m[1] ?? m[2]);
  return specs;
}

for (const file of collectSourceFiles(SRC)) {
  const mod = moduleOf(file);
  if (!mod || !PRESENT_MODULES.has(mod)) {
    violations.push(`${relative(process.cwd(), file)}: 不属于任何在场模块（src 顶层散文件）`);
    continue;
  }
  const allowed = MODULE_EDGES[mod] ?? [];
  const externals = MODULE_EXTERNALS[mod] ?? [];
  const text = readFileSync(file, 'utf8');

  for (const spec of importSpecifiers(text)) {
    if (spec.startsWith('.')) {
      // 相对导入：解析目标真路径判模块归属（首段目录 = 模块）。
      // 件内子目录跳变（如 channels/tui → channels/engine 聚合面）真路径
      // 仍在同模块内——放行（件内子目录不受席执法）；跨模块才走边表。
      // 说明符写编译产物后缀 .js——归一化到 .ts 再解析。
      const targetPath = resolve(dirname(file), spec.replace(/\.js$/, '.ts'));
      const relToSrc = relative(SRC, targetPath);
      if (relToSrc.startsWith('..') || isAbsolute(relToSrc)) {
        violations.push(`${relative(process.cwd(), file)}: 相对导入 ${spec} 跳出 src`);
        continue;
      }
      const target = relToSrc.split(sep)[0];
      if (!target) {
        violations.push(`${relative(process.cwd(), file)}: 相对导入 ${spec} 指向 src 顶层散文件`);
        continue;
      }
      if (target === mod) continue; // 同模块件内（含平级子目录跳变）——自由
      if (!allowed.includes(target)) {
        violations.push(
          `${relative(process.cwd(), file)}: 跨模块导入 ${target} 未在边表（${mod} 允许：${allowed.join(', ') || '无'}）`,
        );
        continue;
      }
      // 公开面收敛：目标须命中四名之一（'../mod' 或 '../mod/index' 等价公开面；
      // 真路径已归一到 .ts——比对模块内相对面名）
      const face = relToSrc.split(sep).slice(1).join('/');
      if (face && !PUBLIC_FACES.has(face)) {
        violations.push(`${relative(process.cwd(), file)}: 深挖 ${target} 实现面（${face}）——只准走公开面四名`);
      }
    } else {
      // 裸导入：node:* 全局；包依赖按模块分账
      if (NODE_BUILTIN.test(spec)) continue;
      if (!externals.includes(spec)) {
        violations.push(
          `${relative(process.cwd(), file)}: 裸导入 '${spec}' 不在 ${mod} 模块白名单（node:* 全局 + ${externals.join(', ') || '无'}）`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error(`lint:topology 红——${violations.length} 处违规：`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}

console.log(
  `lint:topology 绿——在场 ${PRESENT_MODULES.size} 模块 / 边表 ${Object.keys(MODULE_EDGES).length} 席（占位 ${Object.keys(MODULE_EDGES).length - PRESENT_MODULES.size}）`,
);
