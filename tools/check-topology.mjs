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
    // 2026-09-06 issue 模式件立题批入册 26→27（02 §4.1 #27 席——host 行
    // 「全部」的落码同步笔；批 16 起消费）
    'issue',
    // 批 13e-3 起消费（daemon 编舞件 serve-daemon 经 sdk 公开面消费
    // createSdkHttpFace/三防线判定器——02 §4.1 host 行「全部」的落码同步笔）
    'sdk',
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
  sdk: ['contracts', 'channels'],
  issue: ['contracts', 'context'],
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
  // 批 12a 起在场（host 装配根契约笔——本笔实际触达 contracts 单边，
  // 24 deps 全边预登记兑现随 12b-12e 逐笔落码）
  'host',
  // 批 14c 起在场（core:web 纯逻辑腿——deps 单边 contracts；装载态集成
  // 归批 12 装载面后装配批）
  'web',
  // 批 14a 起在场（core:exec 纯逻辑腿——spawn 管道/bash 工具件/git 摘要件，
  // deps {contracts, context, safety, tools}；装载态 scope.provide('exec') 归
  // 批 12 装载面后装配批）
  'exec',
  // 批 14b 起在场（core:skills 纯逻辑腿——SKILL.md 装载/发现六位序列/注册表/
  // 渐进披露/skill_manage，deps {contracts, context}；装载态集成（标准层装配 +
  // skills_change 桥）归批 12 装载面后装配批，出厂技能件内容挂 07 出厂清单定名批）
  'skills',
  // 批 13e 起在场（core:sdk 件——HTTP+SSE 传输与 MCP 包装承载位〔02 §4.1
  // #26 席：L4、deps contracts+channels 与 webui 同构〕；13e-1 起域 = 端点
  // 词面/开面配置/三防线判定器，传输实装 13e-2、daemon 13e-3；MCP 包装 13f）
  'sdk',
  // 批 15a 起在场（core:scheduler 纯逻辑腿——jobs 表/进程内挂钟/抢占/
  // DiscoveryGates/cron 可选后端//tick 处理器，deps {contracts, context,
  // persist}；装载态集成〔ctx.schedule、channels /tick 注册、--tick CLI、
  // GateFacts 宿主收集〕归批 12 装载面后装配批）
  'scheduler',
  // 批 15b 起在场（core:goal 纯逻辑腿——goals 表族/计划态跨轮 fold/续跑触发
  // wakeGate 双帽+停滞硬停/预算双轨/挂钟窄面 GoalJobsFace 词面独立，deps
  // {contracts, context, persist, session}〔context/session 占位——装载态
  // 接线随装配批消费〕；goalScopeFor 闭包经 conversation 可选参数已零边落地）
  'goal',
  // 批 15c 起在场（core:subagent 纯逻辑腿——ctx.jobs 注册表/SubagentProvider
  // 委派机器/派生面/结算通知/通用+声明式工具，deps {contracts, context,
  // session, agent}〔session/agent 占位——in-process 真工厂与装载态接线归
  // host 装配批〕；声明式 def 解析层住 skills〔agents.ts——06 §11.6〕，
  // onSettled→goal 折叠腿经组合根闭包零边落地）
  'subagent',
  // 批 15d 起在场（core:checkpoint 纯逻辑腿——pre-mutation 守门捕获/
  // blob 内容寻址仓/manifest 裁剪帽+/rewind 两段事务，deps {contracts,
  // context, tools, persist}〔context/tools 声明未用——gate 监听器挂载与
  // 管道 sessionId 透传归 host 装配批消费，persist 单边 resolveDataDir 已用；
  //先例同 subagent session/agent 占位〕；装配位 = safety 行之后的
  // tools_pre_execute 监听 + TUI /rewind 命令注册〔挂批 12〕
  'checkpoint',
  // 批 16 起在场（core:issue 纯逻辑腿——无人值守 issue→PR 编排件〔03
  // §10.7〕：GitHub 源后端/过滤归一/轮询水位/webhook 验签路由/issue_get/
  // enqueue 四闸+runOne 编舞+orphanScan，deps {contracts, context}〔context
  // 占位——装载态接线随装配批消费〕；兄弟件全经窄面注入〔IssueJobsFace/
  // IssueSchedulerFace/IssueStoreStateFace/IssueWorktreeFace 词面独立律——
  // compat.test 互证〕；headless 会话面 IssueSessionFace 装配批实装）
  'issue',
  // 批 17a-2 起在场（core:mcp 纯逻辑腿——stdio 行帧 JSON-RPC 手写最小桥
  // 〔03 §10.1 六条款〕：行帧卫生双防线/一服务器一桥〔握手-分页-调用-关停〕
  // /注册面爆炸防线〔≤20 原生复合名、>20 目录三动作〕/apply 异步发现零阻塞
  // +scope 回卷，deps {contracts, context}；spawn/注册/作用域全经窄面注入
  // 〔McpSpawnFace 等——compat.test 真 SpawnPipeline 互证〕；装载态集成归
  // 批 12 装载面后装配批）
  'mcp',
  // 批 17a-3 起在场（core:lsp 纯逻辑腿——Content-Length 帧手写 + 惰性
  // per-(server, rootUri) 实例 + 诊断回流〔03 §10.2 六条款〕：帧资源卫生
  // 双帽〔攒头 16KiB/攒正文 16MiB 声明即拒〕/扩展名路由声明序首/惰性握手
  // 窗 scope 活查/3 连败熔断复位走 /reload/Full 全文同步盘真相/诊断
  // version 对齐/write-edit 后 post 注入 contained 铁律/queryDiagnostics
  // goal seam fail-closed，deps {contracts, context}；spawn/注册/作用域/
  // 事件/盘读全经窄面注入〔LspSpawnFace 等——compat.test 真 SpawnPipeline
  // + 真 fs 互证〕；装载态集成归批 12 装载面后装配批）
  'lsp',
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
  // get-east-asian-width = TUI width 件 EAW 分类；typebox 主包 + value 子路径
  // = sdk 线协议请求面深校验 schema 件（03 §10.6「每动词 typebox schema 校验
  // 后消费」——批 13e 接入；schema 层宿主件直用同律）
  channels: ['get-east-asian-width', 'typebox', 'typebox/value'],
  persist: ['better-sqlite3'],
  // typebox 主包 + value 子路径（07 篇栈纪律：schema 层——工具参数面；宿主件
  // 直用合法，插件侧一律走虚拟键三转发——与 llm 的 pi-ai 同款分账执法）；
  // ignore 包（07 篇 §120：gitignore 语义匹配——检索族遍历消费者之一）
  tools: ['typebox', 'typebox/value', 'ignore'],
  // conversation 的 todo 工具件参数面（07 篇 schema 层同律——宿主件直用；
  // 11e 落码批起用）
  conversation: ['typebox'],
  // web 的 fetch 工具参数面（07 篇 schema 层同律——core: 官方件同仓宿主侧
  // 直用；14c 落码批起用）
  web: ['typebox'],
  // exec 的 bash 工具参数面（07 篇 schema 层同律；14a 落码批起用）
  exec: ['typebox'],
  // goal 的 todo 工具参数面（goal 段扩语义 schema——07 篇 schema 层宿主件
  // 直用同律；15b 落码批起用）
  goal: ['typebox'],
  // skills 的 yaml（SKILL.md frontmatter 解析物化双用——07 篇 §2 钉定）/ignore
  // （gitignore 语义匹配——发现层遍历消费者，07 篇 §120 多消费者）/typebox
  // （skill_manage 参数面——schema 层宿主件直用同律；14b 落码批起用）
  skills: ['yaml', 'ignore', 'typebox'],
  // subagent 的 typebox（agent / agent_<name> 委派工具参数面——schema 层
  // 宿主件直用同律；15c 落码批起用）
  subagent: ['typebox'],
  // checkpoint 的 ignore（walk 域 gitignore 语义匹配——发现层遍历三副本
  // 同判；15d 落码批起用）
  checkpoint: ['ignore'],
  // issue 的 typebox（issue_get 只读工具参数面——schema 层宿主件直用同律；
  // 16c 落码批起用）
  issue: ['typebox'],
  // lsp 的 typebox（diagnostics/symbols/definitions/references 静态四件
  // 参数面——schema 层宿主件直用同律；17a-3 落码批起用）
  lsp: ['typebox'],
  // host 的装载器件（07 篇 §1/L122：jiti 免编译直载用户插件住 host；typebox/
  // value 子路径 = 启用行 config 值校验——schema 层宿主件直用同律，插件侧
  // 一律走虚拟键三转发；批 12d 落码起用）
  host: ['jiti', 'typebox/value'],
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
