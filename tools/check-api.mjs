#!/usr/bin/env node
/**
 * API 治理机器执法层（03 篇 §8.8 check-api 十查，2026-09-05 API 治理批 2 起——
 * 查 3/4 随 DEP 注册簿批充实、查 5 豁免节常量随首实验键批、查 7 扫描面随官方
 * 插件批、查 8 两生成物腿随批 4 增挂）。
 *
 * 进 lint:topology 链（CI 同一套）。十查形态（落码节奏——§8.10 批表）：
 * 1. drift——快照 src/contracts/api-surface.json ≠ 抽取真值即红（面漂移当场抓）；
 * 2. tier 全标——快照逐条 tier 词汇合法 + since 坐标不变式（since > 当前
 *    apiVersion 未来版本号入册即红——版本坐标系双向，查 9 执法「面动号不动」
 *    单向半边、本查补反方向）+ 公开根直导出（自由符号）必带 JSDoc 标签；
 *    typebox 转发条目（forwarded）记载不承诺、不参与执法；
 * 3. 废弃登记完整性——DEP 注册簿行不变式 + 双向对照（注册簿批充实；裸
 *    @deprecated 标签扫描本批即活——标签形 = @deprecated DEP-NNN 说明）；
 * 4. 官方全家桶零废弃使用——扫描面随官方插件批充实（机制常驻，目标集空即过）；
 * 5. 实验面隔离——豁免节之外零实验符号（现零实验键恒绿，机制常驻——实验键
 *    上线日即执法日；豁免节标记常量与查 5 共享单源随首实验键批落
 *    api-doc-sections.mjs）；
 * 6. compat 件死期——批 4 点火前结构性拒绝（src/compat/ 在场即红——死期机器
 *    未落地，compat 件无登记可查 = fail-closed，非静默放行）；
 * 7. 清单 api 块狗家全覆盖——apps/ 目录 .app.yaml 全体装载门裁决（官方插件
 *    批起执法；目录缺席 = 官方插件未落码休眠，非布局红）；
 * 8. 生成物 drift——api-decls Face 派生 .d.ts ≠ 生成器真值即红（生成物是提交
 *    件，手改或面变更后漏再生即漂移；再生入口 = build 尾或生成器 CLI --write；
 *    COMPATIBILITY.md / docs/API参考.md 两腿随批 4 增挂）；
 * 9. 面动号不动——执法纪元 ignited 且归档族非空时，当前快照 vs 最新归档面
 *    diff 非零而两者 apiVersion 相同即红（面号是 since/removalIn 版本坐标的
 *    基准）；纪元 pre-ignition 或基线前休眠——机制常驻、点火日即执法日；
 * 10. 公开产物指路卫生——公开产物面（两生成物〔批 4〕+ api-decls/* 随包分发
 *     件 + contracts 内 API_ 族错误码 message）不得指路知识域（「设计文档」
 *     「0N 篇 §N」等 gitignored 路径/篇名——第三方作者顺指路必撞不可达文档），
 *     指路改公开锚（COMPATIBILITY.md / docs 公开面）；产码注释引用规范不在
 *     此列（非公开产物面）。
 *
 * 出口：零问题静默过（门禁链惯例）；有问题 stderr 逐条 + exit 1。
 */
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import {
  extractSurface,
  scanTopLevelExports,
  serializeSurface,
  classifyFaceDiff,
  loadArchivedSnapshots,
} from './extract-api-surface.mjs';
import { renderFaceDecls, API_DECLS_DIR } from './generate-api-decls.mjs';
import { KNOWLEDGE_DOMAIN_RE } from './api-doc-sections.mjs';

/** 仓库根（脚本位置上一级） */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
/**
 * API 面快照提交位（查 1 守护对象）。`CHECK_API_SNAPSHOT` env 缝 = 回归锁专用
 * 换片位（check-topology 的 CHECK_ROOT 同款纪律——测试注入篡改快照证查 1/查 8
 * 可红，不动共享树文件；缺省真位）。
 */
const SNAPSHOT_PATH =
  process.env.CHECK_API_SNAPSHOT !== undefined
    ? resolve(REPO_ROOT, process.env.CHECK_API_SNAPSHOT)
    : join(REPO_ROOT, 'src/contracts/api-surface.json');
/**
 * 扫描根（查 2 公开根 / 查 3c 标签树 / 查 4 使用面 / 查 5 文档示例 / 查 6
 * compat 目录 / 查 7 清单目录的树侧基准）。`CHECK_API_ROOT` env 缝 = 回归锁
 * 专用夹具树位（注入夹具树证各查可红；脚本自身依赖〔jiti 载真契约面 / 抽取
 * 真值〕恒走真仓不随缝移）。缺省 = 真仓根。
 */
const SCAN_ROOT = process.env.CHECK_API_ROOT !== undefined ? resolve(process.env.CHECK_API_ROOT) : REPO_ROOT;
/**
 * API 面注入位（查 2 tier 三支 / 查 5 实验符号源的输入侧）。`CHECK_API_SURFACE`
 * env 缝注入 JSON 面清单（extractSurface 产物形）——缺省真抽取。注入时查 1
 * 整块跳过：drift 面的真值恒走真册（注入面不是 drift 真值，比较无意义且恒红
 * 干扰探针断言）。
 */
const SURFACE_INJECTED =
  process.env.CHECK_API_SURFACE !== undefined
    ? JSON.parse(readFileSync(resolve(REPO_ROOT, process.env.CHECK_API_SURFACE), 'utf8'))
    : undefined;
/** 公开根（自由符号查 2 的扫描对象） */
const BARREL_PATH = join(SCAN_ROOT, 'src/contracts/index.ts');

const jiti = createJiti(import.meta.url);
/** 便利导入：仓库内相对路径 → 模块运行时面（恒真仓锚——不随 CHECK_API_ROOT 缝移） */
const imp = (rel) => jiti.import(fileURLToPath(new URL(rel, import.meta.url)));

/** 红问题清单（[查 N] 前缀 + 指引文案） */
const problems = [];
const v = (msg) => problems.push(msg);

/** tier 合法词汇（§8.3 三级——internal 结构性不可达不进面清单） */
const TIERS = new Set(['stable', 'experimental', 'deprecated']);
/**
 * 契约版本算术单源（isValidApiVersion / compareApiVersions——与产码同一实现，
 * jiti 载入）。查 2 since 坐标不变式、查 3 注册簿行不变式两查共用。
 */
const apiContracts = await imp('../src/contracts/api.ts');

/** 递归收集目录下指定后缀文件（相对扫描根路径；符号链接不跟随——随 CHECK_API_ROOT 缝移） */
function walkFiles(dirRel, suffixes, out = []) {
  const abs = join(SCAN_ROOT, dirRel);
  if (!existsSync(abs)) return out;
  for (const name of readdirSync(abs).sort()) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue;
    const rel = join(dirRel, name);
    const full = join(SCAN_ROOT, rel);
    // lstat 不解析链接：statSync 跟随会让扫描根外的目录经符号链渗入扫描面
    //（夹具树/CI checkout 的目录外世界不可信），环链还会 ELOOP 崩闸——链接
    // 实体（文件/目录）一律跳过
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) walkFiles(rel, suffixes, out);
    else if (suffixes.some((s) => name.endsWith(s))) out.push(rel);
  }
  return out;
}

/** 根 README 在到集（公开面第一入口；缺席容忍——镜像未建不算布局红） */
const ROOT_READMES = ['README.md', 'README.en.md'].filter((f) => existsSync(join(SCAN_ROOT, f)));

/* ---------------- 查 1：drift（快照 ≠ 抽取真值红） ---------------- */

const surface = SURFACE_INJECTED ?? (await extractSurface());
const snapshotText = readFileSync(SNAPSHOT_PATH, 'utf8');
if (SURFACE_INJECTED === undefined && serializeSurface(surface) !== snapshotText) {
  // 结构化 diff 摘要（计数 + 样例——修复指引指回抽取器 CLI）
  const snap = JSON.parse(snapshotText);
  const keyOf = (e) => `${e.module}::${e.symbol}`;
  const truthMap = new Map(surface.exports.map((e) => [keyOf(e), e]));
  const snapMap = new Map(snap.exports.map((e) => [keyOf(e), e]));
  const added = [...truthMap.keys()].filter((k) => !snapMap.has(k));
  const removed = [...snapMap.keys()].filter((k) => !truthMap.has(k));
  const changed = [...truthMap.entries()]
    .filter(([k, e]) => snapMap.has(k) && JSON.stringify(snapMap.get(k)) !== JSON.stringify(e))
    .map(([k]) => k);
  const capChanged = JSON.stringify(snap.capabilities) !== JSON.stringify(surface.capabilities);
  const samples = (list) => list.slice(0, 5).join('、') + (list.length > 5 ? ' 等' : '');
  v(
    `[查 1] API 面快照漂移：新增 ${added.length}（${samples(added)}）、移除 ${removed.length}（${samples(removed)}）、` +
      `改形 ${changed.length}（${samples(changed)}）、capabilities ${capChanged ? '有变' : '无变'}——` +
      `确认面变更后重跑 \`node tools/extract-api-surface.mjs --write\` 落新快照（§8.8 查 1）`,
  );
}

/* ---------------- 查 2：tier 全标（零隐式 API） ---------------- */

for (const entry of surface.exports) {
  if (!TIERS.has(entry.tier)) {
    v(
      `[查 2] ${entry.module}::${entry.symbol} tier 非法：${entry.tier}（词汇 = stable/experimental/deprecated，§8.3）`,
    );
  }
  if (typeof entry.since !== 'string' || entry.since.length === 0) {
    v(`[查 2] ${entry.module}::${entry.symbol} 缺 since（首快照全 1.0——面清单逐条必带）`);
  }
  // since 坐标不变式（版本坐标系双向收口）：since > 当前 apiVersion（未来版本号
  // 入册）即红——since/removalIn 是 DEP 窗口算术（3 minor）的坐标基准，坐标失锚
  // 则死期机器全歪；查 9 只执法「面动号不动」单向半边，本查补反方向（号未到、
  // 符号不得先领未来版本戳）。格式非法任一侧不参与比较（compareApiVersions 会
  // 抛——注入夹具的怪 since 不炸闸；格式面非本查职责，presence 半边已执法）
  if (
    typeof entry.since === 'string' &&
    apiContracts.isValidApiVersion(entry.since) &&
    apiContracts.isValidApiVersion(surface.apiVersion) &&
    apiContracts.compareApiVersions(entry.since, surface.apiVersion) > 0
  ) {
    v(
      `[查 2] ${entry.module}::${entry.symbol} since ${entry.since} > 当前 apiVersion ${surface.apiVersion}` +
        `（未来版本号入册——坐标基准失锚；面号 bump 与符号入册须同笔，§8.8 查 2 不变式）`,
    );
  }
  // forwarded 条目（typebox 转发面）：tier 仅记载不承诺——词汇/形状仍验，执法豁免即到此为止
}

// 自由符号半边：公开根声明形直导出（非转译）逐符号必带 JSDoc 标签——现役为零，
// 闸守新增。逐符号执法：文件级「任一标签在文」探测一签遮全文件——同文件
// tagged/untagged 并存时无标签者静默放行；tags 载体由扫描器逐声明提取（紧前
// JSDoc——无块/无标签词均 null），此处只点名 null 者
if (existsSync(BARREL_PATH)) {
  const barrelScan = scanTopLevelExports(readFileSync(BARREL_PATH, 'utf8'));
  for (const [name, tag] of barrelScan.tags) {
    if (tag === null) {
      v(
        `[查 2] 公开根直导出 ${name} 无 @stable/@experimental/@deprecated JSDoc 标签——` +
          `自由符号标级载体是紧前 JSDoc（§8.3 标级载体分职）；或改走 export * 目录宿主形`,
      );
    }
  }
}

/* ---------------- 查 3：废弃登记完整性（DEP 注册簿批充实） ---------------- */

const deprecatedEntries = surface.exports.filter((e) => e.tier === 'deprecated');
/**
 * DEP 注册簿数据源。`CHECK_API_DEPRECATIONS` env 缝 = 回归锁换片位
 * （CHECK_API_SNAPSHOT 同款纪律）：测试注入带违规行的假注册簿证查 3/4 可红，
 * 不动共享树文件；缺省 jiti 载真册（src/contracts/deprecations.ts 随 DEP 批
 * 落地——在场前空册休眠，机制常驻）。查 1 的 surface 真值恒走真册（drift 面
 * 不参与 seam）。
 */
const DEPRECATIONS =
  process.env.CHECK_API_DEPRECATIONS !== undefined
    ? JSON.parse(readFileSync(resolve(REPO_ROOT, process.env.CHECK_API_DEPRECATIONS), 'utf8'))
    : existsSync(join(REPO_ROOT, 'src/contracts/deprecations.ts'))
      ? (await imp('../src/contracts/deprecations.ts')).DEPRECATIONS
      : [];
{
  // —— 3a 形状半边（面清单 deprecated 载荷 + 注册簿行不变式——注册簿在场后
  // 全量执法，空册形态下两向皆空集恒过）——
  const depIds = [];
  for (const entry of deprecatedEntries) {
    const d = entry.deprecated;
    if (
      d === undefined ||
      typeof d.dep !== 'string' ||
      typeof d.removalIn !== 'string' ||
      typeof d.replacement !== 'string'
    ) {
      v(
        `[查 3] ${entry.module}::${entry.symbol} 标 deprecated 而缺完整 deprecated 载荷 { dep, removalIn, replacement }（§8.6）`,
      );
    } else {
      depIds.push(d.dep);
    }
  }
  const dup = depIds.filter((id, i) => depIds.indexOf(id) !== i);
  if (dup.length > 0) v(`[查 3] DEP 编号重复：${[...new Set(dup)].join('、')}（编号唯一——§8.8 查 3）`);

  const DEP_ID_RE = /^DEP-\d{3}$/;
  const registryIds = [];
  for (const reg of DEPRECATIONS) {
    // 行不变式四道：编号格式 / 坐标形 / 版本格式 / 窗口算术 + 替代指引非空
    if (!DEP_ID_RE.test(reg.dep)) v(`[查 3] 注册簿 ${reg.dep}：DEP 编号格式非法（DEP-001 式三位数）`);
    const segs = String(reg.symbol).split('::');
    if (segs.length !== 2 || segs[0] === '' || segs[1] === '') {
      v(`[查 3] 注册簿 ${reg.dep}：symbol 非模块::符号 两段坐标形（${reg.symbol}）`);
    }
    if (!apiContracts.isValidApiVersion(reg.introducedIn) || !apiContracts.isValidApiVersion(reg.removalIn)) {
      v(`[查 3] 注册簿 ${reg.dep}：版本格式非法（${reg.introducedIn} → ${reg.removalIn}，应为 MAJOR.MINOR）`);
    } else {
      const [iMajor, iMinor] = reg.introducedIn.split('.').map(Number);
      const [rMajor] = reg.removalIn.split('.').map(Number);
      if (rMajor !== iMajor || apiContracts.compareApiVersions(reg.removalIn, `${iMajor}.${iMinor + 3}`) < 0) {
        v(`[查 3] 注册簿 ${reg.dep}：废弃窗不足（${reg.introducedIn} → ${reg.removalIn}，须同 MAJOR 且 ≥ 3 minor）`);
      }
    }
    if (typeof reg.replacement !== 'string' || reg.replacement === '') {
      v(`[查 3] 注册簿 ${reg.dep}：replacement 为空（废弃不给替代 = 断头路——§8.6）`);
    }
    registryIds.push(reg.dep);
  }
  const regDup = registryIds.filter((id, i) => registryIds.indexOf(id) !== i);
  if (regDup.length > 0) v(`[查 3] 注册簿 DEP 编号重复：${[...new Set(regDup)].join('、')}`);

  // —— 3b 注册簿 ↔ 面清单双向对照（join 键 = module::symbol 坐标）——
  const exportByKey = new Map(surface.exports.map((e) => [`${e.module}::${e.symbol}`, e]));
  for (const reg of DEPRECATIONS) {
    const target = exportByKey.get(reg.symbol);
    if (target === undefined) {
      v(`[查 3] 注册簿 ${reg.dep}：symbol ${reg.symbol} 不在面清单（登记指向不存在的面——先修坐标）`);
      continue;
    }
    if (target.tier !== 'deprecated' || target.deprecated?.dep !== reg.dep) {
      v(
        `[查 3] 注册簿 ${reg.dep}：面清单 ${reg.symbol} 未标 deprecated 或载荷 DEP 编号不一致（重跑抽取器 --write 落同笔快照）`,
      );
    }
  }

  // —— 3c deprecated JSDoc 标签 ↔ 注册簿双向对照（标签形 = `@deprecated DEP-001
  // <说明>`——裸标签红：无编号的标签无法对账；注册行无标签红：登记不落码面
  // 标注即双源）——
  const jsdocFiles = [
    ...walkFiles('src', ['.ts']).filter((f) => !f.endsWith('.test.ts')),
    ...walkFiles('api-decls', ['.d.ts']),
    ...ROOT_READMES,
  ];
  const taggedIds = new Set();
  for (const file of jsdocFiles) {
    const text = readFileSync(join(SCAN_ROOT, file), 'utf8');
    for (const m of text.matchAll(/@deprecated\s+(DEP-\d{3})/g)) taggedIds.add(m[1]);
    if (/@deprecated(?!\s+DEP-\d{3})/.test(text)) {
      v(`[查 3] ${file}：裸 @deprecated 标签未携带 DEP 编号（标签形 = @deprecated DEP-001 说明——§8.6 双向断言）`);
    }
  }
  for (const id of taggedIds) {
    if (!registryIds.includes(id)) v(`[查 3] JSDoc 标签 ${id} 未在 DEP 注册簿登记（标签 ↔ 注册簿双向——先登记再标码）`);
  }
  for (const id of registryIds) {
    if (!taggedIds.has(id)) v(`[查 3] 注册簿 ${id} 无对应 @deprecated JSDoc 标签（登记须同步落码面标注——§8.6）`);
  }
}

/* ---------------- 查 4：官方产码零废弃使用（扫描面随官方插件批充实） ---------------- */

{
  // 扫描面 = src 非测试产码 + examples（官方示例是公开面；目录缺席容忍）；
  // 定义点豁免机械推导：export 声明该符号的文件是定义位非使用位（注册簿文件
  // 自身另免——注册簿坐标串是元数据非使用）。目标集 = 注册簿腿 ∪ 面清单腿
  //（join 一致时同符号——按坐标去重防双报）；目标集空（现役形态）整段跳过
  const scanTargets = [
    ...DEPRECATIONS.map((reg) => ({ dep: reg.dep, symbol: reg.symbol })),
    ...deprecatedEntries.map((e) => ({
      dep: e.deprecated?.dep ?? '(载荷缺 dep)',
      symbol: `${e.module}::${e.symbol}`,
    })),
  ].filter((t, i, arr) => arr.findIndex((o) => o.symbol === t.symbol) === i);
  if (scanTargets.length > 0) {
    const srcFiles = walkFiles('src', ['.ts']).filter(
      (f) => !f.endsWith('.test.ts') && !f.endsWith('contracts/deprecations.ts'),
    );
    const exampleFiles = walkFiles('examples', ['.ts']);
    const texts = new Map([...srcFiles, ...exampleFiles].map((f) => [f, readFileSync(join(SCAN_ROOT, f), 'utf8')]));
    for (const target of scanTargets) {
      const name = target.symbol.split('::')[1] ?? target.symbol;
      // 键形符号（含 /）按子串（import 说明符无词边界）；标识符按 \b 词边界
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const useRe = name.includes('/') ? new RegExp(escaped) : new RegExp(`\\b${escaped}\\b`);
      // 定义点 = export 声明该符号的文件（含 declare 前缀形——机械推导）
      const defRe = new RegExp(
        `export\\s+(?:declare\\s+)?(?:const|function|class|interface|type|enum|let|var)\\s+${escaped}\\b`,
      );
      for (const [file, text] of texts) {
        if (defRe.test(text)) continue; // 定义位非使用位
        if (useRe.test(text)) {
          v(
            `[查 4] 官方产码 ${file} 使用废弃面 ${target.symbol}（DEP ${target.dep}）——迁移路径先被狗家证明（§8.8 查 4）`,
          );
        }
      }
    }
  }
}

/* ---------------- 查 5：实验面隔离（豁免节之外零实验符号） ---------------- */

{
  const experimentalSymbols = surface.exports.filter((e) => e.tier === 'experimental');
  if (experimentalSymbols.length > 0) {
    // 豁免节标记常量（stripExperimentalSection）随首实验键批落
    // api-doc-sections.mjs（与两生成器共享单源）——本段在首实验键落地批同笔
    // 接入节剥除预处理；现零实验键恒绿，机制常驻
    const docFiles = [...walkFiles('docs', ['.md']), ...walkFiles('examples', ['.ts', '.md']), ...ROOT_READMES];
    for (const entry of experimentalSymbols) {
      const re = new RegExp(`\\b${entry.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      const keyRe = entry.module.includes('/') ? new RegExp(entry.module.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) : null;
      for (const file of docFiles) {
        const text = readFileSync(join(SCAN_ROOT, file), 'utf8');
        if (re.test(text) || (keyRe !== null && keyRe.test(text))) {
          v(
            `[查 5] 实验面 ${entry.module}::${entry.symbol} 漏进稳定文档/示例 ${file}（豁免节〔实验面〕之外——实验符号唯一合法披露位在两生成器的实验面节，§8.8 查 5）`,
          );
        }
      }
    }
  }
}

/* ---------------- 查 6：compat 件死期（批 4 前结构性拒绝） ---------------- */

{
  const compatDir = join(SCAN_ROOT, 'src/compat');
  if (existsSync(compatDir)) {
    v(
      `[查 6] src/compat/ 在场而 compat 死期机器未落地（批 4 收剑点火件）——死期未登记的废弃桥结构性拒绝；` +
        `compat 件随批 4 DEP/edition 锚机器同批落（§8.8 查 6）`,
    );
  }
}

/* ---------------- 查 7：清单 api 块狗家全覆盖（官方插件批起执法） ---------------- */

{
  // 官方插件目录（apps/）随首个 core: 插件落码批建立——在场前休眠（非布局红：
  // 与蓝本「零清单即红」不同，本仓官方插件尚未起算）。在场后全量装载门裁决：
  // 清单 schema 校验 + adjudicateApiGate 裁决非 legacy（拒载形包 try/catch 以
  // AppError 码判——裸调让拒载炸掉整个闸进程，九查其余结果被栈迹一并吞掉）
  const manifests = walkFiles('apps', ['.app.yaml']);
  if (manifests.length > 0) {
    const appModPath = join(REPO_ROOT, 'src/contracts/app.ts');
    if (!existsSync(appModPath)) {
      v(`[查 7] apps/ 有 ${manifests.length} 份清单而 src/contracts/app.ts 缺席（清单 schema 真相源未落码——布局异常）`);
    } else {
      const appMod = await imp('../src/contracts/app.ts');
      const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'));
      for (const rel of manifests) {
        const path = join(SCAN_ROOT, rel);
        try {
          const manifest = appMod.validateAppManifest(JSON.parse(readFileSync(path, 'utf8')), path);
          const gate = apiContracts.adjudicateApiGate(manifest.api, pkg.apiVersion, manifest.id);
          if (gate.status === 'legacy') {
            v(`[查 7] 官方清单 ${rel} 缺 api 块（legacy 容忍态窗口内——回填 api.minApiVersion 即绿；点火批翻必填）`);
          }
        } catch (err) {
          if (typeof err?.code !== 'string') throw err; // 非 AppError（形状漂移类编程错）重抛 fail-loud
          v(`[查 7] 官方清单 ${rel} 装载门拒载（${err.code}）：${err.message}`);
        }
      }
    }
  }
}

/* ---------------- 查 8：生成物 drift（Face 派生件 ≠ 生成器真值红） ---------------- */

{
  // 生成物派生自【提交位快照】（非抽取真值——快照 ≠ 真值时查 1 已红；生成物
  // 纪律单独执法：手改生成物 / 面变更后漏再生在此红）。seam 注入的快照原样入
  // 渲染——回归锁换片位天然联动（篡改快照 = 查 1 + 查 8 双红）。
  // COMPATIBILITY.md / docs/API参考.md 两腿随批 4 生成器落地增挂（两生成器
  // 同律进 pairs——本批生成器未落地，缺席面由批 4 挂腿日起执法）
  const snapSurface = JSON.parse(snapshotText);
  const pairs = [];
  let faceDecls = [];
  try {
    faceDecls = [...renderFaceDecls(snapSurface)];
  } catch (err) {
    v(`[查 8] Face 派生件渲染失败（快照模块域漂移？）：${err.message}`);
  }
  for (const [fileName, want] of faceDecls) {
    pairs.push({ label: `api-decls/${fileName}`, path: join(API_DECLS_DIR, fileName), want });
  }
  for (const { label, path, want } of pairs) {
    if (!existsSync(path)) {
      v(`[查 8] 生成物 ${label} 缺席（npm run build 尾挂或生成器 --write 落盘——生成物是提交件）`);
      continue;
    }
    if (readFileSync(path, 'utf8') !== want) {
      v(
        `[查 8] 生成物 ${label} 漂移：与生成器真值不符（面快照派生）——手改生成物或面变更后漏再生；` +
          `重跑 \`node tools/generate-api-decls.mjs --write\``,
      );
    }
  }
}

/* ---------------- 查 9：面动号不动（纪元门 + 基线门双休眠） ---------------- */

{
  // 纪元门 + 基线门双休眠：执法纪元 ignited（面快照 enforcement 纪元章归一）
  // 且归档族非空（首 release 前基线未成 = 无比较基准）才执法——机制常驻、点火
  // 日即执法日（同查 5 律）。比较基准 = 提交位快照 vs 最新归档快照；面 diff
  // 非零而两者 apiVersion 相同 = 红（面号是 since/removalIn 版本坐标的基准，
  // 动了面不动号即坐标失锚）。`CHECK_API_ARCHIVES` env 缝 = 回归锁换片位
  //（注入夹具归档族证查 9 可红，不动真归档位；缺省真位）
  const archives = loadArchivedSnapshots(
    process.env.CHECK_API_ARCHIVES !== undefined ? resolve(REPO_ROOT, process.env.CHECK_API_ARCHIVES) : undefined,
  );
  const snapFace = JSON.parse(snapshotText);
  const eraOf = (s) => (s.enforcement === 'ignited' ? 'ignited' : 'pre-ignition');
  if (archives.length > 0 && eraOf(snapFace) === 'ignited') {
    const last = archives[archives.length - 1];
    const diff = classifyFaceDiff(last.surface, snapFace);
    const faceMoved =
      diff.added.length > 0 ||
      diff.removed.length > 0 ||
      diff.changed.length > 0 ||
      diff.reTiered.length > 0 ||
      diff.capabilitiesChanged;
    if (faceMoved && snapFace.apiVersion === last.surface.apiVersion) {
      v(
        `[查 9] 面动号不动：当前快照 vs 最新归档（${last.version}）面 diff 非零` +
          `（新增 ${diff.added.length} / 移除 ${diff.removed.length} / 改形 ${diff.changed.length} / ` +
          `重定级 ${diff.reTiered.length}${diff.capabilitiesChanged ? ' / capabilities 有变' : ''}）` +
          `而 apiVersion 同为 ${snapFace.apiVersion}——面变更须同笔 bump package.json apiVersion ` +
          `并再生成快照（面号是 since/removalIn 版本坐标的基准，§8.8 查 9）`,
      );
    }
  }
}

/* ---------------- 查 10：公开产物指路卫生（指路知识域即红） ---------------- */

/**
 * 提取 `new BaseError(` 实参区内全部字符串字面量拼接段（查 10 message 面）。
 *
 * 词法小扫描器（注释免疫——注释不在实参区，产码注释引用规范合法）：自开括号
 * 起配平深度，跳过行注释/块注释，收集反引号模板与双/单引号字符串内容；模板
 * `${}` 插值按表达式域处理（配平花括——其内的引号与括号不终结外层字面量）。
 * 只收字面量段：标识符引用（如共享尾注常量）不在文本内——恰合判据，知识域
 * 指路必然落在手写字面量里。
 *
 * @param {string} src 源文件全文
 * @param {number} openIdx `new BaseError(` 开括号下标（实参区自此起）
 * @returns {string} 实参区内字符串字面量拼接文本（无字面量返回空串）
 */
function baseErrorLiteralText(src, openIdx) {
  let out = '';
  let i = openIdx + 1;
  let depth = 1;
  while (i < src.length && depth > 0) {
    const ch = src[i];
    // 行注释/块注释：实参区内合法排版物，跳过不收（防注释里的规范引用假阳）
    if (ch === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    if (ch === '`') {
      // 模板字面量：收集到未转义反引号止；`${` 进表达式域（花括配平，域内引号
      // 与括号由该域消费——插值里的 join('、') 不误终结外层）
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === '`') {
          i += 1;
          break;
        }
        if (src[i] === '$' && src[i + 1] === '{') {
          i += 2;
          let braces = 1;
          while (i < src.length && braces > 0) {
            if (src[i] === '{') braces += 1;
            else if (src[i] === '}') braces -= 1;
            i += 1;
          }
          continue;
        }
        out += src[i];
        i += 1;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      // 双/单引号字符串：收集到未转义闭引号止
      i += 1;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        out += src[i];
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    i += 1;
  }
  return out;
}

{
  // 公开产物面：两生成物（批 4 起在场）+ api-decls/*（随包分发件）——文件全文
  // 扫（SCAN_ROOT 相对，夹具树可证红）；缺席不红（COMPATIBILITY/docs 生成物
  // 缺席由批 4 起的查 8 执法缺席面，查 10 不重复）。判据单源 =
  // KNOWLEDGE_DOMAIN_RE（api-doc-sections.mjs——与抽取器 desc harvest 滤词
  // 共享，判据漂移结构性不可能）
  const fileFaces = [
    { label: 'COMPATIBILITY.md', rel: 'COMPATIBILITY.md' },
    { label: 'docs/API参考.md', rel: join('docs', 'API参考.md') },
    ...walkFiles('api-decls', ['.ts', '.json']).map((f) => ({ label: f, rel: f })),
  ];
  for (const face of fileFaces) {
    const abs = join(SCAN_ROOT, face.rel);
    if (!existsSync(abs)) continue;
    const hit = KNOWLEDGE_DOMAIN_RE.exec(readFileSync(abs, 'utf8'));
    if (hit !== null) {
      v(
        `[查 10] 公开产物 ${face.label} 指路知识域（「${hit[0]}」）——知识域文档 gitignored 对第三方插件作者不可达；` +
          `指路改公开锚（COMPATIBILITY.md / docs 公开面），§8.8 查 10`,
      );
    }
  }
  // message 面：contracts 源内 API_ 族 BaseError 实参区字面量（运行时字符串
  // ——词法提取注释免疫）。首 token = 错误码标识符，只审 API_ 族
  for (const file of walkFiles(join('src', 'contracts'), ['.ts']).filter((f) => !f.endsWith('.test.ts'))) {
    const text = readFileSync(join(SCAN_ROOT, file), 'utf8');
    for (const m of text.matchAll(/new BaseError\(/g)) {
      const openIdx = m.index + m[0].length - 1;
      const code = /^\s*([A-Za-z_$][\w$]*)/.exec(text.slice(openIdx + 1));
      if (code === null || !code[1].startsWith('API_')) continue;
      const hit = KNOWLEDGE_DOMAIN_RE.exec(baseErrorLiteralText(text, openIdx));
      if (hit !== null) {
        v(
          `[查 10] ${file} ${code[1]} 错误消息指路知识域（「${hit[0]}」）——运行时字符串对第三方插件作者不可达；` +
            `指路改公开锚（COMPATIBILITY.md / docs 公开面），§8.8 查 10`,
        );
      }
    }
  }
}

/* ---------------- 出口 ---------------- */

if (problems.length > 0) {
  console.error(`check-api：${problems.length} 个问题`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
