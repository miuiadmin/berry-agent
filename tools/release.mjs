#!/usr/bin/env node
/**
 * 发布机器（07 篇 §8.3 六道契约 + 双包发布道——思路照搬 berry 从零重建，
 * 2026-09-08 批 22；2026-09-14 rl 批包参数化纳入 berry-agent-sdk）。
 *
 * 形态：手写发布脚本（仓库手写纪律同向——argv/logger/拓扑门禁/三座桥皆手写；
 * npm CLI 为唯一传输层，不自写 registry HTTP）。**版本号单一事实源 = 各包各自
 * 的 package.json `version`**（bump 走普通 commit；脚本不 bump 不自增——发布
 * 失败重跑同号无跳号）。
 *
 * 双包发布道：`--package <main|sdk>`（缺省 main 零参兼容；CI 零参形按
 * RELEASE_REF 前缀自推包键——derivePkgKey，07 §8.3 第 2 款 d 则）——六道编舞单源
 * 零分叉，全部包差异收进 PACKAGES 描述符单源表（07 §8.3 差分六则）；分立
 * 脚本与双包并跑一进程均否决（编舞复制 = 漂移面 / 一包失败另一包已传不可撤）。
 *
 * 六道契约（探测序即防线序；触网写面全集 = publish / dist-tag add / git push
 * tag 三点显式在册，此外零触网写）：
 * 1. 门禁前置不可绕——四门禁任一红即退；门禁绿后核工作树净空；
 * 2. registry 探测（先行只读）——E404=正常发 / 在场=记待比 / 其余=拒发，
 *    按 npm 错误类型分支禁退码一刀切；
 * 3. 构建即打包与发布物验收——全新 build → pack 白名单机器验收 → 真打包
 *    出 tarball+shasum → 安装冒烟（主包 CLI 形 / SDK import 形——差分 ②；
 *    数据目录 env 钉入冒烟临时目录防污染真数据域）；
 * 4. 幂等收口与 publish 单点——shasum 等价=跳过视为成功；不等=深对照
 *    （剥离集随包——主包溯源戳两件 / SDK 空集）等价跳 / 有实质差异响亮拒 /
 *    拉取不可行维持拒 fail-closed；publish 单点上传（prerelease 显式 --tag next；
 *    真发前 README 占位符检查——dry-run 不拦）；
 * 5. dist-tag 终态机器断言——preview 期 latest 与 next 恒同指最新 prerelease
 *    （正式版起分叉：latest 指新版、next 不动）；断言失败退 1（半成功态必须
 *    被人看见）；
 * 6. 尾件 git tag——tag 域两包分立（主包 v<version> / SDK sdk-v<version>；
 *    幂等：同 commit 跳过 / 异 commit 响亮拒）；push 恒带 -c http.version=HTTP/1.1。
 *
 * 执行形（07 §8.3 末定形注 2026-09-15 CI 化——OIDC trusted publishing 常轨）：
 * resolveReleaseForm 按「--local-publish 旗标 > env BERRY_AGENT_RELEASE_MODE=ci
 * > 描述符 publishMode 缺省」解析三分形——trigger 本机触发腿（主包缺省：预检 →
 * 交棒 tag → gh 轮询 CI run 终态 → registry 复探收口〔恒深对照——溯源戳跨机必
 * 不等〕→ preview 期本机 dist-tag set latest〔npm/cli#8547 结构性外置〕→ 契约 5
 * 本机复断）/ ci CI 发布腿（release.yml 内 OIDC publish；契约 5 只读断言 next、
 * 契约 6 只校验既有 tag）/ token 令牌全本地旧序（--local-publish 显式应急
 * 专属——2026-09-20 SDK CI 化批起 SDK publishMode 翻 token→ci，双包本机
 * 零参缺省同走 trigger 交棒形；六道契约原序不动）。--dry-run 独立于模式轴：任何形下演习投影的都是
 * 令牌道旧序（CI 等待段不在演习射程）。
 *
 * 演习形态：--dry-run——契约 1/2 照跑；契约 3 真做；契约 4 幂等照判、publish
 * 走 npm publish --dry-run；契约 5 只调纯函数断言期望终态、不执行 dist-tag
 * add；契约 6 只校验既有 tag 状态。
 *
 * 纪元点火彩排（W8 纪元彩排批）：--dry-run 常开（真发形经 --epoch-drill 显式
 * 开；CI 形零旗标零噪音）——以「已点火」形状投影 03 §8.8 检查 9「面动号不动」
 * 的点火前休眠面：提交位快照 vs 最新归档面判差，输出点火日将破的存量面清单/
 * 计数。report-only——只出报告行不改退出码（彩排是观察件不是门禁：存量面大
 * 整理的执行日是点火日，彩排日只负责把清单提前摆上桌）。SDK 包无独立 API 面
 * 坐标系不跑彩排。
 *
 * 失败注入：--inject <谱项>（npm 调用边界注入脚本化应答——不真起 HTTP
 * server，在 exec 边界喂 canned 输出/错误）；位于 publish 之后的谱项无
 * --dry-run 即用法错（防真上传后撞注入终态留半成功态）。演习完成判据 =
 * 注入谱场景收进 tools/release.test.mjs 常规测试面全绿（测试即留档）。
 *
 * 可测结构：runRelease(seams, opts) 消费缝面（seam table）——CLI 用 realSeams
 * 实装缝，测试用假缝逐契约注入谱场景；判定器（judge*）全纯函数导出。
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { realpathSync } from 'node:fs';
import { createJiti } from 'jiti';

// API 面治理判差语义单源（W8 纪元彩排批引入）：classifyFaceDiff = 面 diff 分桶
// 投影（剥文档/元数据载荷——文档润色不是面变），loadArchivedSnapshots = 查 9
// 归档族加载（api/snapshots/<pkg.version>.json 全体，包版本升序）。彩排只消费
// 判差语义零复制——与 check-api 查 9 同源同判。
import { classifyFaceDiff, loadArchivedSnapshots } from './extract-api-surface.mjs';

/** 仓库根（脚本位置上一级） */
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------
// 包描述符单源表（07 §8.3 双包发布道——六道编舞零分叉，差异全收此表）
// ---------------------------------------------------------------------------

/**
 * 主包白名单：恰收 dist 全树 + 三自动件 + README 语言族 + examples 挂账位。
 * 07 §8.3 白名单验收律：在场资产恰收、缺席资产不预占白名单位——examples/ 落位批
 * eco-3（插件模板两形）在场，package.json files 已扩入，机器验收面随批同步扩
 * （eco-3 落码时漏扩本正则——2026-09-14 首发真发契约 3 咬住，补笔在场恰收）；
 * examples/ 缺席时本分支空转无件可收，不预占白名单位。
 * README 语言变体族（2026-09-14 多语言 README 批）：npm always-included 族——
 * 根目录 README 变体自动入包（package.json files 白名单拦不住），故语言集枚举形
 * 恰收五件（zh/ko/fr/es/ru）；缺席语言（如 de）不预占位，新语言随落位批同步扩。
 * skills/ 挂账资产位（2026-09-15 出厂技能落位批——07 §8.6 射程注记②）：
 * 出厂四件 SKILL.md 随包分发（package.json files 同步扩入），前缀形整树承载
 * （references/ 附属文件同收——06 §11.3 细化②）；必在件断言见下 MAIN_PACK_MUST
 * （射程注记④「在场必在」——四件缺席即 pack 验收红）。
 */
const MAIN_PACK_ALLOWED = /^(package\.json|README(\.(zh|ko|fr|es|ru))?\.md|LICENSE|dist\/.+|examples\/.+|skills\/.+)$/;
/** 主包三禁（全域执法不问目录——dist 内同样禁测试/映射件） */
const MAIN_PACK_BANNED = /\.(test|spec)\.(js|ts|tsx)$|\.test\.d\.ts$|\.js\.map$/;
/** 主包必在件（bin 主入口 / SPA 面 / API 治理面 / 溯源戳 / 双档 / 出厂技能四件） */
const MAIN_PACK_MUST = [
  'dist/host/main.js',
  'dist/webui/index.html',
  'dist/api/surface.json',
  'dist/.build-meta.json',
  'README.md',
  'LICENSE',
  // 出厂技能四件（07 §8.6 定名批——名单单源即本表，落位批「在场必在」升级）
  'skills/coding-persona/SKILL.md',
  'skills/plugins-quickstart/SKILL.md',
  'skills/goal-unattended/SKILL.md',
  'skills/memory-tools/SKILL.md',
];

/**
 * SDK 包白名单：恰收 package.json / README 单件（无语言族）/ LICENSE /
 * 入口树 + 同编译自包含跟进树（批 13f「类型面自仓单源同编译」——SDK src
 * import 主仓契约/通道码，tsc 跟进编译入包，import 图可达才入树）。
 * 必在件 = 入口 index 双档 + client/http/stdio/types 四模块 .js + README +
 * LICENSE（npm always-included 族在场必在——2026-09-15 白名单同步批：
 * 12aa56d 落 LICENSE 后 npm pack 恒自动收，白名单未随批更新即 CI drill 红
 * 〔run 34962693484〕——循主包「在场必在」律同形收口）。
 */
const SDK_PACK_ALLOWED = /^(package\.json|README\.md|LICENSE|dist\/(packages\/berry-agent-sdk\/src|src)\/.+)$/;
/** SDK 三禁：test 件照禁；.js.map 放行（类型化客户端调试栈帧是产品面——07 §8.3 差分①） */
const SDK_PACK_BANNED = /\.(test|spec)\.(js|ts|tsx)$|\.test\.d\.ts$/;
/** SDK 必在件（入口面缺件即红） */
const SDK_PACK_MUST = [
  'dist/packages/berry-agent-sdk/src/index.js',
  'dist/packages/berry-agent-sdk/src/index.d.ts',
  'dist/packages/berry-agent-sdk/src/client.js',
  'dist/packages/berry-agent-sdk/src/http.js',
  'dist/packages/berry-agent-sdk/src/stdio.js',
  'dist/packages/berry-agent-sdk/src/types.js',
  'README.md',
  'LICENSE',
];

/**
 * 主包 README 读面（契约 4 占位符门输入，随包描述符承载）：根目录 README
 * 全语言族 glob 排序拼合（npm always-included 族随包走，占位符门不得漏检
 * 任一译文；动态 glob 形——新语言落位即自动入检，fail-safe 方向无需枚举
 * 同步。2026-09-14 扫描三役 F22 勘正：修前只读根 README.md 单件，五译文
 * 占位符漏检）。pkgRoot = 仓根（pkgDir 空）。
 */
function readMainReadmeText(pkgRoot) {
  return readdirSync(pkgRoot)
    .filter((f) => /^README.*\.md$/.test(f))
    .sort()
    .map((f) => readFileSync(join(pkgRoot, f), 'utf8'))
    .join('\n\n');
}

/** SDK 包 README 读面：包目录单件（无语言变体族——07 §8.3 差分①） */
function readSdkReadmeText(pkgRoot) {
  return readFileSync(join(pkgRoot, 'README.md'), 'utf8');
}

/** 主包 README 语言变体族逐件读面（版本一致性断言输入——[件名, 文本] 对） */
function readMainReadmeVariants(pkgRoot) {
  return readdirSync(pkgRoot)
    .filter((f) => /^README.*\.md$/.test(f))
    .sort()
    .map((f) => [f, readFileSync(join(pkgRoot, f), 'utf8')]);
}

/** SDK 包 README 单件变体（无语言变体族——差分①同源） */
function readSdkReadmeVariants(pkgRoot) {
  return [['README.md', readSdkReadmeText(pkgRoot)]];
}

/**
 * 包描述符单源表（--package 词面全集；07 §8.3 双包发布道定形块）。
 * tagPrefix 两包分立：主包 v<version> / SDK sdk-v<version>（版本号独立演进，
 * 同号真发时同形 tag 必撞）；treeStrip = 契约 4 深对照剥离集（主包溯源戳
 * 两件 / SDK 纯 tsc 确定性编译空集——shasum 不等即实质差异）。publishMode =
 * 执行形缺省（07 §8.3 末定形注第 1 款——2026-09-20 SDK CI 化批起两包缺省
 * 皆 ci：主包 ci〔缺省形 = 本机触发腿交棒〕/ SDK ci〔本机零参缺省走 trigger
 * 交棒形〕；CI 真发形由 release.yml 设 env BERRY_AGENT_RELEASE_MODE=ci
 * 判入，--local-publish 旗标强制 token 应急）。
 * buildScript / readmeText / smoke = 差分面随表承载（07 §8.3 定形句把
 * 「冒烟形」列为描述符第 9 项，build 链与 readme 读面同款收口——2026-09-14
 * 扫描四役 idx 8：修前三者内联在 realSeams 的 pkgKey if 分叉系参数化遗漏，
 * 第三包入册/冷读对拍即漏点）：buildScript 两包分立（主包复合链 / SDK
 * tsc 直出）；readmeText 读面两形（主包根 glob 族拼合 / SDK 包目录单件）；
 * smoke 冒烟形两形（主包 CLI 形吃官方件 id 集 / SDK import 形吃线协议握手
 * 锚真值——deps 经 lazy loader 注入，realSeams 零 pkgKey 分叉）。
 */
export const PACKAGES = {
  main: {
    name: 'berry-agent',
    pkgDir: '',
    tagPrefix: 'v',
    publishMode: 'ci',
    tarballName: (version) => `berry-agent-${version}.tgz`,
    packAllowed: MAIN_PACK_ALLOWED,
    packBanned: MAIN_PACK_BANNED,
    packMust: MAIN_PACK_MUST,
    treeStrip: ['dist/.build-meta.json', 'dist/.api-emit.stamp'],
    buildScript: 'build',
    readmeText: readMainReadmeText,
    readmeVariants: readMainReadmeVariants,
    smoke: async (tarballPath, version) => runSmoke(tarballPath, version, await loadCoreIds()),
  },
  sdk: {
    name: 'berry-agent-sdk',
    pkgDir: 'packages/berry-agent-sdk',
    tagPrefix: 'sdk-v',
    // 2026-09-20 SDK CI 化批：token→ci 翻转（npmjs.com 侧 OIDC 绑定同日就位
    // ——07 §8.3 第 2 款两依赖兑现；本机零参缺省自此走 trigger 交棒形）
    publishMode: 'ci',
    tarballName: (version) => `berry-agent-sdk-${version}.tgz`,
    packAllowed: SDK_PACK_ALLOWED,
    packBanned: SDK_PACK_BANNED,
    packMust: SDK_PACK_MUST,
    treeStrip: [],
    buildScript: 'build:sdk',
    readmeText: readSdkReadmeText,
    readmeVariants: readSdkReadmeVariants,
    smoke: async (tarballPath, version) => runSmokeSdk(tarballPath, version, await loadProtocolVersion()),
  },
};

// ---------------------------------------------------------------------------
// 纯判定器（全导出——测试即留档；白名单/剥离集随包描述符参数化）
// ---------------------------------------------------------------------------

/** prerelease 判定（preview 期 = 版本号带 prerelease 段） */
export function isPrerelease(version) {
  return /^\d+\.\d+\.\d+-/.test(version);
}

/**
 * 契约 2 三态判定：registry 探测结果 → absent（E404=正常发）/ present（在场
 * 记待比）/ fatal（网络等其余错误=拒发）。命门：按 npm 错误类型分支（stderr
 * 含 `code E404`），禁按退出码一刀切——E404 与网络错同为退 1。
 */
export function judgeRegistryProbe(res) {
  if (res.status === 0) {
    const text = (res.stdout ?? '').trim();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { state: 'fatal', reason: `探测应答非 JSON：${text.slice(0, 120)}` };
    }
    const shasum = typeof parsed === 'string' ? parsed : (parsed?.dist?.shasum ?? null);
    if (shasum === null) return { state: 'fatal', reason: '探测应答无 shasum 字段' };
    return { state: 'present', shasum };
  }
  if (/code E404/.test(res.stderr ?? '')) return { state: 'absent' };
  return {
    state: 'fatal',
    reason: `registry 探测失败（非 E404）：${(res.stderr ?? '').trim().split('\n').slice(0, 3).join(' | ')}`,
  };
}

/** 契约 3 pack 内容面验收——白名单 + 三禁双执法（profile 随包描述符；缺省主包） */
export function judgePackList(files, profile = PACKAGES.main) {
  const missing = profile.packMust.filter((m) => !files.includes(m));
  const forbidden = files.filter((f) => !profile.packAllowed.test(f) || profile.packBanned.test(f));
  return { ok: missing.length === 0 && forbidden.length === 0, missing, forbidden };
}

/**
 * 契约 4 深对照——两 tarball 解包树（path → sha256）剥离溯源戳类后逐件比：
 * 全同 = 等价跳（中断重跑时 HEAD 已移属正常）；有实质差异 = 响亮拒
 * （registry 不可重写同版本）。
 * 剥离集随包（07 §8.3 差分③）：主包 = .build-meta.json（builtAt）+
 * .api-emit.stamp（emit-api-decls 生成时戳）两件非确定溯源值；SDK = 空集
 * （纯 tsc 确定性编译，无溯源件——shasum 不等即实质差异）。
 * 判据 = 溯源戳类，内容件永不入集。
 */
export function judgeTarballTrees(localTree, remoteTree, strip = PACKAGES.main.treeStrip) {
  const stripTree = (tree) => {
    const copy = { ...tree };
    for (const k of strip) delete copy[k];
    return copy;
  };
  const a = stripTree(localTree);
  const b = stripTree(remoteTree);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  const diffs = [...keys].filter((k) => a[k] !== b[k]);
  return { equivalent: diffs.length === 0, diffs };
}

/** 契约 5 dist-tag 终态断言——preview 期两 tag 同指（退化等值判断）；正式版 latest 单指 */
export function judgeDistTag(tags, version, prerelease) {
  if (prerelease) {
    if (tags.latest === version && tags.next === version) return { ok: true };
    return {
      ok: false,
      reason: `preview 期 latest(${tags.latest}) 与 next(${tags.next}) 须同指 ${version}`,
    };
  }
  if (tags.latest === version) return { ok: true };
  return { ok: false, reason: `正式版 latest(${tags.latest}) 须指 ${version}（next 不动）` };
}

/**
 * 契约 5 传播窗重试缺省参数（07 §8.3 契约 5 2026-09-19 传播窗重试定形注 +
 * 2026-09-21 传播窗上界勘正〔规范先行〕）：实测传播最坏观测 7 分钟（alpha
 * 期两发族），上界须盖最坏观测再留余量——12 次 ≈ 6 分钟窗已被越限，12→15
 * （≈ 7.5 分钟窗）。
 */
export const TAG_PROPAGATION_RETRIES = 15;
export const TAG_PROPAGATION_DELAY_MS = 30_000;

/**
 * 契约 5 断言读回带传播窗重试（07 §8.3 契约 5 2026-09-19 定形注）：npm
 * registry 写面（publish / dist-tag add）收执后读 replica 滞后可达分钟级
 * （alpha.2/alpha.4 两发实测 3-7 分钟窗）——写已收执非失败，单次即时读回
 * 必撞假红（契约 6 被跳过 = 半成功态误报 + tag 腿悬空须手工收口）。三读回
 * 位（触发腿复断 / CI 形只读断 / 令牌旧序终态断）统一经此复读；窗尽仍不
 * 等才红。sleep 注入缝：测试形缺席/即时（零挂钟），realSeams 真睡。
 */
export async function judgeDistTagWithPropagationRetry(seams, judge, logLine) {
  const sleep = seams.sleep ?? (() => Promise.resolve());
  const retries = seams.tagPropagationRetries ?? TAG_PROPAGATION_RETRIES;
  const delayMs = seams.tagPropagationDelayMs ?? TAG_PROPAGATION_DELAY_MS;
  let verdict = judge(seams.distTagLs());
  for (let attempt = 1; !verdict.ok && attempt <= retries; attempt++) {
    logLine(
      `[契约5] 传播窗复读（${attempt}/${retries}，隔 ${delayMs}ms——npm 写后读 replica 滞后实测 3-7 分钟，写已收执非失败）`,
    );
    await sleep(delayMs);
    verdict = judge(seams.distTagLs());
  }
  return verdict;
}

/**
 * 触发腿收口复探读回带传播窗重试（07 §8.3 契约 5 2026-09-19 收口复探补笔
 * ——四读回位的第四读位）：CI publish 收执后本机复探同一 registry 读面、
 * 同吃 replica 滞后，单次即时读回撞假红（CI 绿却报「复探非在场」）。与
 * 契约 5 复读差异：**只 absent（E404）复读**——E404 是「publish 收执但
 * replica 未追上」的可自愈形；fatal（网络/registry 错）非自愈形即时红不
 * 空转窗。sleep 注入缝同 tag 复读：测试形缺席/即时，realSeams 真睡。
 */
export async function judgeProbeWithPropagationRetry(seams, version, logLine) {
  const sleep = seams.sleep ?? (() => Promise.resolve());
  const retries = seams.tagPropagationRetries ?? TAG_PROPAGATION_RETRIES;
  const delayMs = seams.tagPropagationDelayMs ?? TAG_PROPAGATION_DELAY_MS;
  let verdict = judgeRegistryProbe(seams.probe(version));
  for (let attempt = 1; verdict.state === 'absent' && attempt <= retries; attempt++) {
    logLine(
      `[触发腿] 收口复探传播窗复读（${attempt}/${retries}，隔 ${delayMs}ms——CI publish 收执后读 replica 滞后实测 3-7 分钟，缺席可自愈）`,
    );
    await sleep(delayMs);
    verdict = judgeRegistryProbe(seams.probe(version));
  }
  return verdict;
}

/** 契约 4 真发前 README 占位符检查（仓转公开日回填前禁发；dry-run 不拦） */
export function judgeReadme(text) {
  const hits = (text.match(/^.*(PLACEHOLDER|安装占位|<!--\s*placeholder).*$/gim) ?? []).length;
  return { ok: hits === 0, hits };
}

/**
 * 反引号 semver 形 token（README 状态行版本位——`\`0.1.0-alpha.4\`` 形）。
 * export 供 tools/drill-version-switch.mjs 单源复用（演习树 token 同刷与
 * 本判据共用一词法锁面——两处正则漂移即锁面分叉，第十一役 CI 红收口笔）
 */
export const README_BACKTICK_SEMVER_RE = /`(\d+\.\d+\.\d+(?:-[0-9A-Za-z][0-9A-Za-z.-]*[0-9A-Za-z])?)`/g;

/**
 * 契约 4 README 状态行版本一致性断言（07 §8.3 契约 4 2026-09-19 版本一致性
 * 补笔）：全语言族逐件判——各件内反引号 semver token 必恰等于本次发版
 * version，任一件陈化即禁发（README 系 npm always-included 族随包走、
 * registry 不可重写同版本——陈化即已发产物永久自述旧版，alpha.4 实发案例
 * 在案〔npm view berry-agent@0.1.0-alpha.4 readme 实证〕）。无 token 形
 * 不判违——禁发判据只收「在场且陈化」（六件状态行 token 是各件内唯一的
 * 反引号 semver 位，词法锁面即状态行）。
 */
export function judgeReadmeStatusVersions(variants, version) {
  const violations = [];
  for (const [name, text] of variants) {
    for (const m of text.matchAll(README_BACKTICK_SEMVER_RE)) {
      if (m[1] !== version) violations.push(`${name}：\`${m[1]}\` ≠ ${version}`);
    }
  }
  return { ok: violations.length === 0, violations };
}

/**
 * 执行形解析（07 §8.3 末定形注第 1 款——模式轴单源）：
 * --local-publish 旗标 > env BERRY_AGENT_RELEASE_MODE=ci > 描述符 publishMode。
 * env 只认 'ci' 一值（release.yml 发布腿专属信号——本机不应自设）；非法取值
 * 响亮拒——fail-loud 不猜。〔2026-09-20 SDK CI 化批随迁注：原「env=ci 撞
 * token 包（SDK 无 CI 腿）= 用法错响亮拒」句随 SDK publishMode 翻转**退场**
 * ——双包描述符均 ci 后该分支成死码删除；token 形自此只剩 --local-publish
 * 显式应急一入口〕。返回三态：'trigger'（本机触发腿——双包缺省）/
 * 'ci'（CI 发布腿）/ 'token'（令牌全本地旧序——旗标应急专属）。
 */
export function resolveReleaseForm({ pkgKey = 'main', localPublish = false, env = process.env }) {
  if (localPublish) return 'token';
  const envMode = env.BERRY_AGENT_RELEASE_MODE;
  if (envMode !== undefined) {
    if (envMode !== 'ci') throw new Error(`BERRY_AGENT_RELEASE_MODE 取值非法：${envMode}（仅认 ci）`);
    return 'ci';
  }
  return PACKAGES[pkgKey].publishMode === 'ci' ? 'trigger' : 'token';
}

/**
 * CI 零参形 pkgKey 自推律（07 §8.3 末定形注第 2 款 d 则——2026-09-20 SDK
 * CI 化批）：release.yml 发布腿零参跑 `npm run release`（step 无 --package），
 * 包键按 RELEASE_REF 前缀自推——refs/tags/sdk-v* → sdk、refs/tags/v* →
 * main；ref 缺席（本机腿/演习位）走 explicitPkg 缺省 main 不变。fail-loud
 * 两形：ref 非两前缀之任一（release.yml 首步 ref 断言的前置失效——纵深
 * 防御位）响亮拒；显式 --package 与自推结论冲突响亮拒（防 CI 手改命令
 * 指错包真发——pkgExplicit 标记显式性，缺省 main 的零参形不算冲突）。
 * @param {string|undefined} ref 环境变量 RELEASE_REF（release.yml 首步注入）
 * @param {{explicitPkg?: string, pkgExplicit?: boolean}} opts 显式 --package 值与显式性标记
 * @returns {string} 生效包键
 */
export function derivePkgKey(ref, { explicitPkg = 'main', pkgExplicit = false } = {}) {
  if (!ref) return explicitPkg;
  let derived;
  if (ref.startsWith('refs/tags/sdk-v')) derived = 'sdk';
  else if (ref.startsWith('refs/tags/v')) derived = 'main';
  else throw new Error(`RELEASE_REF 非 refs/tags/v*|sdk-v* 形：${ref}`);
  if (pkgExplicit && explicitPkg !== derived) {
    throw new Error(`--package ${explicitPkg} 与 RELEASE_REF（${ref}）自推包键 ${derived} 冲突`);
  }
  return derived;
}

/**
 * 契约 5 CI 形断言（07 §8.3 末定形注第 2 款——npm/cli#8547：trusted publishing
 * 只认证 publish，dist-tag add 结构性走不了 OIDC，故 latest 挪位时序外置到本机
 * 触发腿收口段）：CI 腿只读断言——prerelease 断 next 指 version（latest 挪位
 * 尚未发生不断言）、正式版断 latest 指 version。终态 latest≡next 复断归本机
 * 触发腿（judgeDistTag 原断言）。
 */
export function judgeDistTagCi(tags, version, prerelease) {
  if (prerelease) {
    if (tags.next === version) return { ok: true };
    return {
      ok: false,
      reason: `CI 形 preview 断言：next(${tags.next}) 须指 ${version}（latest 挪位在本机触发腿收口段——npm/cli#8547）`,
    };
  }
  if (tags.latest === version) return { ok: true };
  return { ok: false, reason: `正式版 latest(${tags.latest}) 须指 ${version}（next 不动）` };
}

/**
 * 纪元点火彩排判定（W8 纪元彩排批——03 §8.8 检查 9「面动号不动」点火前投影）。
 *
 * 语义与 check-api 查 9 同源：基线门（归档族非空——首 release 前基线未成即
 * 无比较基准）与面判差（classifyFaceDiff——判差语义单源）原样保留；惟纪元门
 * （快照 enforcement === 'ignited'）在彩排语境强制开——彩排要回答的恰是
 * 「若今天点火，存量面会不会破」，与 API_ENFORCEMENT_IGNITED 当前值无关。
 * 门条件「面动 ∧ 当前快照 apiVersion === 最新归档 apiVersion」是查 9 内联
 * 条件的镜像式——check-api 该段内联改动时此处须同步（两侧同变；回归锁锁
 * dormant/will-red/will-pass 三态输出）。
 * @param {{ surface: object, archives: Array<{version: string, surface: object}> }} faces
 *   surface = 提交位 API 面快照（src/contracts/api-surface.json 真值）；
 *   archives = 查 9 归档族（api/snapshots/ 全体，包版本升序）
 * @returns {{ state: 'dormant', reason: string } |
 *   { state: 'will-red', diff: object, apiVersion: string, lastVersion: string } |
 *   { state: 'will-pass', diff: object }}
 */
export function judgeEpochIgnitionDrill({ surface, archives }) {
  // 基线门照原样：归档族空 = 休眠（检查 9 在点火日也仍休眠——如实呈现，非误报）
  if (!Array.isArray(archives) || archives.length === 0) {
    return {
      state: 'dormant',
      reason: '档案族空——首个 release 归档未落，检查 9 无比较基准（基线应随发布时点 extract-api-surface --archive 落）',
    };
  }
  const last = archives[archives.length - 1];
  const diff = classifyFaceDiff(last.surface, surface);
  const faceMoved =
    diff.added.length > 0 ||
    diff.removed.length > 0 ||
    diff.changed.length > 0 ||
    diff.reTiered.length > 0 ||
    diff.capabilitiesChanged;
  // 查 9 门条件镜像：面动 ∧ 号不动 → 点火日将红
  if (faceMoved && surface.apiVersion === last.surface.apiVersion) {
    return { state: 'will-red', diff, apiVersion: surface.apiVersion, lastVersion: last.version };
  }
  // 面动号也动（合法形）或面静止 → 点火日投影绿
  return { state: 'will-pass', diff };
}

// ---------------------------------------------------------------------------
// argv 解析（--dry-run / --local-publish / --epoch-drill / --inject <谱项>；用法错收集后退 2）
// ---------------------------------------------------------------------------

/**
 * 发布机器注入谱（--inject 词面全集；afterPublish = 谱项位于 publish 之后——
 * 无 --dry-run 即用法错，防真上传后撞注入终态留半成功态）。
 * patch(seams) 在 exec 边界喂 canned 应答（不真起 HTTP server）。
 */

/** 纪元彩排注入用演示面（epoch:will-red 谱项专属 canned 面——漂移形：新增一导出） */
const EPOCH_DEMO_ARCHIVED = {
  apiVersion: '1.0',
  enforcement: 'pre-ignition',
  exports: [
    { module: 'berry-agent', symbol: 'A', tier: 'stable', since: '1.0', sig: 'aaaa1111' },
    { module: 'berry-agent', symbol: 'B', tier: 'stable', since: '1.0', sig: 'bbbb2222' },
  ],
  capabilities: [],
};
const EPOCH_DEMO_DRIFTED = {
  ...EPOCH_DEMO_ARCHIVED,
  exports: [
    ...EPOCH_DEMO_ARCHIVED.exports,
    { module: 'berry-agent', symbol: 'C', tier: 'stable', since: '1.0', sig: 'cccc3333' },
  ],
};

export const INJECT_SPECTRUM = {
  'probe:e404': {
    afterPublish: false,
    note: 'registry 缺席（E404）——正常发路径',
    patch: (s) => ({
      ...s,
      probe: () => ({ status: 1, stdout: '', stderr: 'npm error code E404\nnpm error 404 Not Found' }),
    }),
  },
  'probe:present': {
    afterPublish: false,
    note: 'registry 在场——shasum 待比（异值走深对照腿）',
    patch: (s) => ({
      ...s,
      probe: () => ({ status: 0, stdout: '"1111111111111111111111111111111111111111"\n', stderr: '' }),
    }),
  },
  'probe:network': {
    afterPublish: false,
    note: 'registry 网络错（非 E404）——拒发 fail-closed',
    patch: (s) => ({
      ...s,
      probe: () => ({ status: 1, stdout: '', stderr: 'npm error code ENOTFOUND\nnpm error network request failed' }),
    }),
  },
  'publish:fail': {
    afterPublish: false,
    note: 'publish 步失败——上传单点失败即退',
    patch: (s) => ({ ...s, publish: () => ({ status: 1, stdout: '', stderr: 'npm error publish failed (injected)' }) }),
  },
  'epoch:will-red': {
    afterPublish: false,
    note: '纪元彩排红面——检查 9「面动号不动」点火前投影报告出场（report-only 不改退出码）',
    patch: (s) => ({
      ...s,
      // canned 面（与真快照/归档无关——注入语义即「喂脚本化应答」）：漂移形
      // 新增一导出而 apiVersion 未动，彩排报告应呈现「点火日将红」清单
      epochDrillFaces: () => ({
        surface: EPOCH_DEMO_DRIFTED,
        archives: [{ version: '0.1.0-alpha.2', surface: EPOCH_DEMO_ARCHIVED }],
      }),
    }),
  },
  'disttag:diverged': {
    afterPublish: true,
    note: '在场幂等重跑 + dist-tag 分叉——latest 未随 next 同指（半成功态必须被看见）',
    patch: (s) => ({
      ...s,
      // 复合场景：registry 在场且 shasum 等值（幂等重跑形——publish 跳过），
      // 惟 dist-tag 终态被人挪动——契约 5 查实际终态时咬住
      probe: () => ({ status: 0, stdout: '"1111111111111111111111111111111111111111"\n', stderr: '' }),
      fileShasum: () => '1111111111111111111111111111111111111111',
      distTagLs: () => ({ latest: '0.0.9-old', next: '0.1.0-alpha.1' }),
    }),
  },
  'tag:conflict': {
    afterPublish: true,
    note: 'git tag 已在且异 commit——响亮拒（registry 已传不可重写）',
    patch: (s) => ({ ...s, gitTagState: () => ({ commit: 'deadbeef' }) }),
  },
  // 触发腿谱族（CI 段注入——CLI 形因 afterPublish 须配 --dry-run，而演习投影
  // 令牌道旧序不走 CI 段故 CLI 注入形空转；场景面收进 release.test.mjs 以
  // patch(假缝) 直跑触发腿全覆盖——测试即留档）
  'ci:fail': {
    afterPublish: true,
    note: '触发腿 CI run 失败终态——响亮拒附 run URL + 恢复手续指路（定形注第 3/4 款）',
    patch: (s) => ({
      ...s,
      ciWaitRun: () => ({ status: 'failure', runUrl: 'https://github.com/miuiadmin/berry-agent/actions/runs/999' }),
    }),
  },
  'ci:timeout': {
    afterPublish: true,
    note: '触发腿 CI 轮询超时（30 分钟帽）——响亮拒附人工核 run 指路',
    patch: (s) => ({ ...s, ciWaitRun: () => ({ status: 'timeout', runUrl: '' }) }),
  },
  'ci:green-absent': {
    afterPublish: true,
    note: 'CI run 绿但 registry 复探缺席——异常态收口拒（半成功必须被看见）',
    patch: (s) => ({
      ...s,
      ciWaitRun: () => ({ status: 'success', runUrl: 'https://github.com/miuiadmin/berry-agent/actions/runs/999' }),
    }),
  },
};

/** argv 解析：{ pkg, pkgExplicit, dryRun, inject, localPublish, epochDrill, errors }——用法错聚齐由 CLI 层退 2（pkgExplicit 标记 --package 是否显式给出——derivePkgKey 冲突判据用，缺省 main 零参形不算显式） */
export function parseReleaseArgs(argv) {
  const out = {
    pkg: 'main',
    pkgExplicit: false,
    dryRun: false,
    inject: undefined,
    localPublish: false,
    epochDrill: false,
    errors: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--dry-run') out.dryRun = true;
    else if (tok === '--local-publish') out.localPublish = true;
    else if (tok === '--epoch-drill') out.epochDrill = true;
    else if (tok === '--package') {
      const key = argv[i + 1];
      if (key === undefined || key.startsWith('--')) {
        out.errors.push('--package 需要包名（合法：' + Object.keys(PACKAGES).join(' / ') + '）');
        break;
      }
      if (!Object.hasOwn(PACKAGES, key)) {
        out.errors.push(`未知包名：${key}（合法：${Object.keys(PACKAGES).join(' / ')}）`);
      } else {
        out.pkg = key;
        out.pkgExplicit = true;
      }
      i++;
    } else if (tok === '--inject') {
      const key = argv[i + 1];
      if (key === undefined || key.startsWith('--')) {
        out.errors.push('--inject 需要谱项名（见 --inject 列表：' + Object.keys(INJECT_SPECTRUM).join(' / ') + '）');
        break;
      }
      if (!Object.hasOwn(INJECT_SPECTRUM, key)) {
        out.errors.push(`未知注入谱项：${key}（合法：${Object.keys(INJECT_SPECTRUM).join(' / ')}）`);
      } else {
        out.inject = key;
      }
      i++;
    } else {
      out.errors.push(
        `未知参数：${tok}（仅认 --package <${Object.keys(PACKAGES).join('|')}> / --dry-run / --local-publish / --epoch-drill / --inject <谱项>）`,
      );
    }
  }
  // publish 之后的谱项无 --dry-run 即用法错（防真上传后撞注入终态）
  if (out.inject !== undefined && INJECT_SPECTRUM[out.inject].afterPublish && !out.dryRun) {
    out.errors.push(`谱项 ${out.inject} 位于 publish 之后——演习须带 --dry-run（防真上传后撞注入终态留半成功态）`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// runRelease——六道契约编舞（seam table 消费；判定全走上方纯函数）
// ---------------------------------------------------------------------------

/**
 * @param {object} seams 缝面（CLI=realSeams 实装；测试=假缝注入谱场景）
 * @param {{version: string, pkgKey?: string, dryRun: boolean, localPublish?: boolean, epochDrill?: boolean, env?: object, log: (line: string) => void}} opts
 *   pkgKey 缺省 'main'（07 §8.3 双包发布道——编舞零分叉，差异全在描述符/缝面）；
 *   localPublish/env 透传 resolveReleaseForm（执行形解析见定形注第 1 款——
 *   env 缺省 process.env，测试经 env:{} 隔离宿主环境变量面）；epochDrill =
 *   纪元点火彩排真发形显式开（--dry-run 下彩排恒开，见彩排段注）
 * @returns {{code: number, report: string[]}}
 */
export async function runRelease(seams, opts) {
  const { version, dryRun } = opts;
  const pkgKey = opts.pkgKey ?? 'main';
  const pkg = PACKAGES[pkgKey];
  const report = [];
  const log = (line) => {
    report.push(line);
    opts.log(line);
  };
  const prerelease = isPrerelease(version);
  // 执行形解析（旗标 > env > 描述符——定形注第 1 款）。用法错（env 非法/撞
  // token 包）fail-loud 退 1；--dry-run 独立于模式轴：解析照走（用法错照咬），
  // 编舞恒投影令牌道旧序（CI 等待段不在演习射程）
  let form;
  try {
    form = resolveReleaseForm({ pkgKey, localPublish: opts.localPublish ?? false, env: opts.env ?? process.env });
  } catch (err) {
    log(`[release] 拒：${err.message}`);
    return { code: 1, report };
  }
  if (dryRun) form = 'token';
  const formLabel = { trigger: '本机触发腿', ci: 'CI 发布腿', token: '令牌全本地' }[form];
  log(`[release] ${pkg.name}@${version}${dryRun ? '（--dry-run 演习）' : `（执行形=${formLabel}）`} 六道契约起跑`);

  // —— 纪元点火彩排（W8 纪元彩排批——report-only，不参与退出码）：以「已点火」
  // 形状投影 03 §8.8 检查 9「面动号不动」的点火前休眠面——提交位快照 vs 最新
  // 归档面判差，点火日将破的存量面清单/计数预呈现。--dry-run 常开；真发形经
  // --epoch-drill 显式开（CI 形零旗标零噪音——权衡：彩排是观察件不是门禁，
  // 不改退出码，存量面大整理的执行日是点火日，彩排日只负责把清单提前摆上桌）。
  // 置于契约 1 之前：彩排输入（快照/归档族）不依赖门禁结果，门禁红时报告仍应
  // 可见。SDK 包无独立 API 面坐标系（检查 9 比较基准 = 主包快照/归档族）不跑。
  if ((dryRun || opts.epochDrill === true) && pkgKey === 'main') {
    try {
      const faces = seams.epochDrillFaces?.();
      if (faces === undefined) {
        log('[纪元彩排] report-only：缝缺席——彩排跳过（realSeams 实装缝在位；本缝面表未装）');
      } else {
        const verdict = judgeEpochIgnitionDrill(faces);
        if (verdict.state === 'dormant') {
          log(`[纪元彩排] report-only：休眠——${verdict.reason}`);
        } else if (verdict.state === 'will-red') {
          const d = verdict.diff;
          // 样本帽 5 条/桶——存量面大整理日的清单读面（全量明细走 check-api 单跑）
          const sample = (list) =>
            list.length === 0
              ? '无'
              : `${list.slice(0, 5).join('、')}${list.length > 5 ? ` 等 ${list.length} 条` : ''}`;
          log(
            `[纪元彩排] report-only：检查 9 点火日将红——面动号不动（当前快照 vs 最新归档 ${verdict.lastVersion}：` +
              `新增 ${d.added.length}〔${sample(d.added)}〕/ 移除 ${d.removed.length}〔${sample(d.removed)}〕/ ` +
              `改形 ${d.changed.length}〔${sample(d.changed)}〕/ 重定级 ${d.reTiered.length}〔${sample(d.reTiered)}〕` +
              `${d.capabilitiesChanged ? ' / capabilities 有变' : ''}；apiVersion 均 ${verdict.apiVersion}）——` +
              `面变更须同笔 bump package.json apiVersion 并再生成快照+归档（03 §8.8 检查 9）`,
          );
        } else {
          const d = verdict.diff;
          const moved =
            d.added.length + d.removed.length + d.changed.length + d.reTiered.length > 0 || d.capabilitiesChanged;
          log(
            `[纪元彩排] report-only：检查 9 点火日投影绿——${
              moved ? '面 diff 非零但 apiVersion 随动（合法形）' : '面 diff 零（面静止）'
            }`,
          );
        }
      }
    } catch (err) {
      // report-only：彩排缝任何故障不拖累发布编舞
      log(`[纪元彩排] report-only：不可用（${err?.message ?? err}）——不影响发布编舞`);
    }
  }

  // —— 契约 1：门禁前置不可绕 + 工作树净空 ——
  log('[契约1] 四门禁前置……');
  const gates = seams.gates();
  const redGate = gates.find((g) => !g.ok);
  if (redGate !== undefined) {
    log(`[契约1] 红：门禁 ${redGate.name} 未过——发布路径上不存在「跳过测试直接发」的出口`);
    return { code: 1, report };
  }
  const porcelain = seams.gitStatusPorcelain();
  if (porcelain !== '') {
    log('[契约1] 红：工作树非净空——先提交或清掉未登记改动（git status --porcelain 非空）');
    return { code: 1, report };
  }
  log('[契约1] 绿：四门禁过 + 工作树净空');

  // —— 契约 2：registry 探测（先行只读）——
  const probe = judgeRegistryProbe(seams.probe(version));
  if (probe.state === 'fatal') {
    log(`[契约2] 拒发：${probe.reason}`);
    return { code: 1, report };
  }
  log(`[契约2] 探测=${probe.state}${probe.shasum !== undefined ? `（shasum ${probe.shasum}）` : ''}`);

  // —— 契约 3：构建即打包与发布物验收 ——
  const build = seams.build();
  if (!build.ok) {
    log('[契约3] 红：全新 build 失败');
    return { code: 1, report };
  }
  const files = seams.packList();
  const packVerdict = judgePackList(files, pkg);
  if (!packVerdict.ok) {
    log(
      `[契约3] 红：pack 内容面验收不过——缺必在件 [${packVerdict.missing.join(', ') || '无'}] / 白名单外 [${packVerdict.forbidden.join(', ') || '无'}]`,
    );
    return { code: 1, report };
  }
  // pack 缝失败以抛错为契约形（realSeams.pack 查 npm pack 退出码，非零抛含
  // stderr 摘录的错——2026-09-14 扫描四役 idx 9：修前退出码被丢弃、拼好
  // tarballPath 照返，下游 fileShasum 裸抛 ENOENT 出裸栈非契约式报告）。
  // 此处收口成契约 3 红退 1——失败也走「[契约N] 红」报告面。
  let tarballPath;
  try {
    tarballPath = seams.pack().tarballPath;
  } catch (err) {
    log(`[契约3] 红：npm pack 失败——${err?.message ?? err}`);
    return { code: 1, report };
  }
  const localShasum = seams.fileShasum(tarballPath);
  const smoke = await seams.smoke(tarballPath);
  if (!smoke.ok) {
    log(`[契约3] 红：安装冒烟失败——${smoke.failures.join('；')}`);
    return { code: 1, report };
  }
  log(`[契约3] 绿：全新 build + pack 验收 + 安装冒烟过（tarball ${tarballPath}，shasum ${localShasum}）`);

  // —— 触发腿分岔（07 §8.3 末定形注第 3 款）：本机不直接 publish——预检 →
  // 交棒 tag → gh 轮询 CI run → registry 复探收口 → preview latest 挪位 →
  // 契约 5 本机复断。契约 4 的本地 publish 单点让位给 CI 的 OIDC publish
  //（版本字节上传仍单点，只是换了执行位——契约 4 尾注「机器内单调用点」不变）。
  if (form === 'trigger') {
    // 预检门 = 契约 4 同款 README 占位符检查，前提到交棒之前（拦在出门前非
    // 交棒后——CI 带病跑完再拦即半成功态）
    const readmeVerdict = judgeReadme(seams.readmeText());
    if (!readmeVerdict.ok) {
      log('[触发腿] 拒：发布物 README 含安装占位符——交棒前预检拦（仓转公开日回填前禁发）');
      return { code: 1, report };
    }
    // 版本一致性门（契约 4 版本一致性补笔——占位符门同位同宽）：变体族经缝
    // 面（seams.readmeVariants 缺席回落单件 readmeText——测试假缝零 token
    // 恒过），任一件状态行陈化即拦在交棒前
    const variants = seams.readmeVariants ? seams.readmeVariants() : [['README.md', seams.readmeText()]];
    const readmeVersions = judgeReadmeStatusVersions(variants, version);
    if (!readmeVersions.ok) {
      log(
        `[触发腿] 拒：README 状态行版本陈化（${readmeVersions.violations.join('；')}）——版本切批须同步六语公开面（registry 不可重写，陈化即已发物永久自述旧版）`,
      );
      return { code: 1, report };
    }
    // 幂等判定：registry 已在场且等价 → 已发过，跳过交棒直收口（重跑幂等律）
    let skipHandoff = false;
    if (probe.state === 'present') {
      if (probe.shasum === localShasum) {
        skipHandoff = true;
        log('[触发腿] 幂等：registry 在场且 shasum 等价——跳过交棒直收口');
      } else {
        // shasum 不等 → 深对照（溯源戳跨机必不等——恒走深对照判实质）
        const remoteTarball = seams.fetchTarball(version);
        if (remoteTarball === null) {
          log('[触发腿] 拒：registry 在场且 shasum 不一致，深对照拉取不可行——fail-closed 拒发');
          return { code: 1, report };
        }
        const deep = judgeTarballTrees(seams.tarballTree(tarballPath), seams.tarballTree(remoteTarball), pkg.treeStrip);
        if (!deep.equivalent) {
          log(`[触发腿] 拒：深对照有实质差异（[${deep.diffs.join(', ')}]）——registry 不可重写同版本`);
          return { code: 1, report };
        }
        skipHandoff = true;
        log('[触发腿] 幂等：深对照全同（仅溯源戳差异）——跳过交棒直收口');
      }
    }
    // 交棒 = 打 tag + push（tag 即触发器；tag 保护 ruleset 已在场——定形注第 7 款）
    if (!skipHandoff) {
      const tagName = `${pkg.tagPrefix}${version}`;
      const tagState = seams.gitTagState(tagName);
      if (tagState === 'absent') {
        seams.gitTagCreate(tagName);
        const pushed = seams.gitTagPush(tagName);
        if (pushed.status !== 0) {
          log(`[触发腿] 拒：tag ${tagName} push 失败——CI 未触发（本地 tag 已打，恢复手续见定形注第 4 款）`);
          return { code: 1, report };
        }
        log(`[触发腿] 交棒：tag ${tagName} 已打并 push（恒 HTTP/1.1）——CI 发布腿起跑`);
      } else if (tagState.commit === seams.headCommit()) {
        log(`[触发腿] 续跑：tag ${tagName} 已在同 commit（上次交棒后未收口——重等 CI）`);
      } else {
        log(`[触发腿] 拒：tag ${tagName} 已在但指 ${tagState.commit} ≠ HEAD ${seams.headCommit()}——异 commit 响亮拒`);
        return { code: 1, report };
      }
      // gh 轮询 CI run 终态（fail-loud 前检 + 20s 间隔 + 30 分钟帽）
      const ci = await seams.ciWaitRun(tagName, (st) => log(`[触发腿] CI 进行中（${st}）——轮询中`));
      if (ci.status === 'failure') {
        log(
          `[触发腿] 拒：CI run 失败——${ci.runUrl}\n  恢复手续（定形注第 4 款）：删 tag ${tagName} → 修 commit → 重新交棒，或 GitHub UI 重跑`,
        );
        return { code: 1, report };
      }
      if (ci.status === 'timeout') {
        log(
          `[触发腿] 拒：CI run 30 分钟未出终态——人工核 https://github.com/miuiadmin/berry-agent/actions（tag ${tagName} 在场，CI 或仍在跑）`,
        );
        return { code: 1, report };
      }
      if (ci.status === 'fatal') {
        log(`[触发腿] 拒：CI 轮询前检失败——${ci.reason}`);
        return { code: 1, report };
      }
      log(`[触发腿] CI 绿：${ci.runUrl}`);
    }
    // 收口：registry 复探（CI 的 publish 单点已上传）——传播窗复读形（第四读
    // 位：absent-only 复读——CI publish 收执后 replica 滞后可致 E404 假缺席，
    // 12×30s 窗内缺席自愈；窗尽仍缺席即异常态响亮拒）
    const reprobe = await judgeProbeWithPropagationRetry(seams, version, log);
    if (reprobe.state !== 'present') {
      log(
        `[触发腿] 拒：CI 绿但 registry 复探非在场（${reprobe.state === 'absent' ? 'E404 缺席' : reprobe.reason}）——异常态，人工核 CI 日志与 registry`,
      );
      return { code: 1, report };
    }
    if (reprobe.shasum !== localShasum) {
      // shasum 不等不必然是坏——溯源戳跨机必不等，深对照判实质（跨机确定性 =
      // 本批首演验证点——定形注第 3 款）
      const remoteTarball = seams.fetchTarball(version);
      if (remoteTarball === null) {
        log('[触发腿] 拒：复探 shasum 不一致且深对照拉取不可行——fail-closed（registry 不可重写同版本）');
        return { code: 1, report };
      }
      const deep = judgeTarballTrees(seams.tarballTree(tarballPath), seams.tarballTree(remoteTarball), pkg.treeStrip);
      if (!deep.equivalent) {
        log(
          `[触发腿] 拒：深对照有实质差异（[${deep.diffs.join(', ')}]）——CI 构建与本地非同物，registry 已不可重写，响亮拒`,
        );
        return { code: 1, report };
      }
      log('[触发腿] 收口：深对照等价（仅溯源戳差异）——CI 构建与本地同物');
    } else {
      log('[触发腿] 收口：registry 复探在场且 shasum 等价——发布确认');
    }
    // preview 期 latest 挪位（npm/cli#8547——dist-tag 走不了 OIDC，本机令牌腿
    // 收尾；正式版 latest 由 CI publish 默认 tag 已落位，无挪位步）
    if (prerelease) {
      const add = seams.distTagAdd(version, 'latest');
      if (add.status !== 0) {
        log(
          `[触发腿] 红：dist-tag set latest 失败——半成功态，人工接管（npm dist-tag set latest ${pkg.name}@` +
            version +
            '）',
        );
        return { code: 1, report };
      }
      log('[触发腿] preview latest 挪位完成（latest≡next 同指）');
    }
    // 契约 5 本机复断（终态 latest≡next 原断言——judgeDistTag；传播窗复读）
    const tagVerdict = await judgeDistTagWithPropagationRetry(seams, (t) => judgeDistTag(t, version, prerelease), log);
    if (!tagVerdict.ok) {
      log(`[契约5] 红：${tagVerdict.reason}——半成功态必须被人看见`);
      return { code: 1, report };
    }
    log('[契约5] 绿：dist-tag 终态断言过（触发腿复断）');
    log(`[release] 全契约绿：${pkg.name}@${version}（本机触发腿——publish 由 CI OIDC 完成）`);
    return { code: 0, report };
  }

  // —— 契约 4：幂等收口与 publish 单点 ——
  let published = false;
  if (probe.state === 'present' && probe.shasum === localShasum) {
    log('[契约4] 等价已发：registry shasum 与本地 tarball 一致——跳过 publish 视为成功，后续契约照跑');
  } else if (probe.state === 'present') {
    // shasum 不一致 → 内容级深对照（剥离溯源戳一件；拉取/解包不可行维持拒）
    const remoteTarball = seams.fetchTarball(version);
    if (remoteTarball === null) {
      log('[契约4] 拒：registry 在场且 shasum 不一致，深对照拉取不可行——fail-closed 拒发（registry 不可重写同版本）');
      return { code: 1, report };
    }
    const deep = judgeTarballTrees(seams.tarballTree(tarballPath), seams.tarballTree(remoteTarball), pkg.treeStrip);
    if (!deep.equivalent) {
      log(`[契约4] 拒：深对照有实质差异（剥离溯源戳后仍不同：[${deep.diffs.join(', ')}]）——registry 不可重写同版本`);
      return { code: 1, report };
    }
    log('[契约4] 等价已发：深对照全同（仅溯源戳差异）——跳过 publish，后续契约照跑');
  } else {
    if (!dryRun) {
      const readmeVerdict = judgeReadme(seams.readmeText());
      if (!readmeVerdict.ok) {
        log('[契约4] 拒：发布物 README 含安装占位符——仓转公开日回填前禁发');
        return { code: 1, report };
      }
      // 版本一致性门（占位符门同位同宽——dry-run 不拦同款；SDK 单件/主包
      // 六件经缝面逐件判）
      const variants = seams.readmeVariants ? seams.readmeVariants() : [['README.md', seams.readmeText()]];
      const readmeVersions = judgeReadmeStatusVersions(variants, version);
      if (!readmeVersions.ok) {
        log(
          `[契约4] 拒：README 状态行版本陈化（${readmeVersions.violations.join('；')}）——版本切批须同步六语公开面（registry 不可重写，陈化即已发物永久自述旧版）`,
        );
        return { code: 1, report };
      }
    }
    const pub = seams.publish(tarballPath, { next: prerelease, dryRun });
    if (pub.status !== 0) {
      log(`[契约4] 红：publish 失败——${(pub.stderr ?? '').trim().split('\n')[0] ?? ''}`);
      return { code: 1, report };
    }
    published = true;
    log(
      `[契约4] 绿：publish 单点完成${dryRun ? '（--dry-run 未上传）' : `（${prerelease ? '--tag next' : '默认 latest'}）`}`,
    );
  }

  // —— 契约 5：dist-tag 终态机器断言（末尾必跑；断言件按执行形分件——CI 形只读
  // 断 next〔latest 挪位时序在 CI 终态后，npm/cli#8547 结构性外置〕、令牌旧序照
  // 原断言——07 §8.3 契约 5 尾注）——
  if (form === 'ci') {
    // 传播窗复读（07 §8.3 契约 5 定形注）：CI 形只读断同样吃 replica 滞后——
    // 令牌腿先发、CI 随 tag 复跑时读回可能仍在传播窗内，统一走有界复读。
    const ciVerdict = await judgeDistTagWithPropagationRetry(seams, (t) => judgeDistTagCi(t, version, prerelease), log);
    if (!ciVerdict.ok) {
      log(`[契约5] 红：${ciVerdict.reason}`);
      return { code: 1, report };
    }
    log('[契约5] 绿：CI 形只读断言过（latest 挪位不在 CI 射程——本机触发腿收口段复断）');
  } else if (prerelease && !dryRun && published) {
    const add = seams.distTagAdd(version, 'latest');
    if (add.status !== 0) {
      log(
        `[契约5] 红：dist-tag add latest 失败——半成功态，人工接管（npm dist-tag add ${pkg.name}@` +
          version +
          ' latest）',
      );
      return { code: 1, report };
    }
  }
  // 终态输入源三分：真发查实际 ls（publish/dist-tag add 已落盘）；演习且首发
  // （registry 缺席——ls 尚未移动）只调纯函数断言期望终态；演习且在场（幂等
  // 重跑形）查实际 ls——分叉在此被咬住（人工干预 dist-tag 不回写脚本 = 驯服失效
  // 之始）。CI 形不走本块（终态 latest≡next 复断归本机触发腿——定形注第 2 款，
  // CI 中间态 latest 未挪是设计内非分叉）。
  if (form !== 'ci') {
    // 真读形走传播窗复读（07 §8.3 契约 5 2026-09-19 定形注）；演习且首发
    // （registry 缺席——ls 尚未移动）只调纯函数断言期望终态（零读零重试）。
    let tagVerdict;
    if (!dryRun || probe.state === 'present') {
      tagVerdict = await judgeDistTagWithPropagationRetry(seams, (t) => judgeDistTag(t, version, prerelease), log);
    } else {
      const tags = prerelease ? { latest: version, next: version } : { latest: version };
      tagVerdict = judgeDistTag(tags, version, prerelease);
    }
    if (!tagVerdict.ok) {
      log(`[契约5] 红：${tagVerdict.reason}——半成功态必须被人看见（人工干预 dist-tag 后不回写脚本 = 驯服失效之始）`);
      return { code: 1, report };
    }
    log('[契约5] 绿：dist-tag 终态断言过');
  }

  // —— 契约 6：尾件 git tag ——（tag 域两包分立：主包 v<version> / SDK sdk-v<version>——07 §8.3 差分③同节；
  // CI 形只校验既有——tag 即触发器，CI 不打 tag（定形注第 2/6 款 tag 时序三分形）——
  const tagName = `${pkg.tagPrefix}${version}`;
  const tagState = seams.gitTagState(tagName);
  if (form === 'ci') {
    if (tagState === 'absent') {
      log(`[契约6] 拒：CI 形 tag ${tagName} 必在场（tag 即触发器——非 tag 直跑形见定形注第 5 款）`);
      return { code: 1, report };
    }
    if (tagState.commit === seams.headCommit()) {
      log(`[契约6] 绿：tag ${tagName} 在场且同 commit（CI 只校验不打）`);
    } else {
      log(`[契约6] 拒：tag ${tagName} 指 ${tagState.commit} ≠ checkout ${seams.headCommit()}——异 commit 响亮拒`);
      return { code: 1, report };
    }
  } else if (tagState === 'absent') {
    if (dryRun) {
      log(`[契约6] 演习：tag ${tagName} 缺席（真发时将创建 + push）`);
    } else {
      seams.gitTagCreate(tagName);
      seams.gitTagPush(tagName);
      log(`[契约6] 绿：tag ${tagName} 已打并 push（恒 HTTP/1.1）`);
    }
  } else if (tagState.commit === seams.headCommit()) {
    log(`[契约6] 幂等：tag ${tagName} 已在且同 commit——跳过`);
  } else {
    log(`[契约6] 拒：tag ${tagName} 已在但指 ${tagState.commit}（HEAD ${seams.headCommit()}）——异 commit 响亮拒`);
    return { code: 1, report };
  }

  log(`[release] 全契约绿${dryRun ? '（演习态——零上传零 tag 写）' : ''}：${pkg.name}@${version}`);
  return { code: 0, report };
}

// ---------------------------------------------------------------------------
// realSeams——CLI 实装缝（spawn 边界；探针/打包/冒烟细节在此收口）
// ---------------------------------------------------------------------------

/** spawn 快捷（捕获形——探测/打包/断言类） */
function cap(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { cwd: REPO_ROOT, encoding: 'utf8', ...opts });
}

/**
 * core: 官方件 id 单源预载（空 deps 实例化注册表——make* 只在 apply 期消费
 * deps）。进程级 lazy memo（描述符 smoke 冒烟形入口——真正冒烟才装载，
 * 与修前 realSeams 闭包内 lazy memo 行为等价：CLI 每进程单 realSeams 实例）。
 */
let coreIdsPromise = null;
function loadCoreIds() {
  if (coreIdsPromise === null) {
    coreIdsPromise = (async () => {
      const jiti = createJiti(import.meta.url);
      const mod = await jiti.import(fileURLToPath(new URL('../src/host/core-plugins.ts', import.meta.url)));
      return mod.createCorePlugins({}).map((ref) => ref.name);
    })();
  }
  return coreIdsPromise;
}

/**
 * 线协议握手锚真值预载（SDK 冒烟差分②——安装位 SDK_PROTOCOL_VERSION 与
 * 主仓 src 真源对拍，`===` 连类型漂移一并咬住：真源是 number 字面量
 * 〔protocol.ts `export const SDK_PROTOCOL_VERSION = 1`〕，rl-4 首演曾以
 * 臆断 string 断言被咬红——断言预期必须来自真源非想象）。进程级 lazy memo
 * （描述符 smoke 冒烟形入口——真正冒烟才读真源）。
 */
let protocolVersionPromise = null;
function loadProtocolVersion() {
  if (protocolVersionPromise === null) {
    protocolVersionPromise = (async () => {
      const jiti = createJiti(import.meta.url);
      const mod = await jiti.import(fileURLToPath(new URL('../src/channels/sdk/protocol.ts', import.meta.url)));
      return mod.SDK_PROTOCOL_VERSION;
    })();
  }
  return protocolVersionPromise;
}

/** 安装冒烟实装（契约 3 三连断言；env 钉临时数据目录防污染真数据域） */
async function runSmoke(tarballPath, version, coreIds) {
  const failures = [];
  const smokeDir = mkdtempSync(join(tmpdir(), 'berry-release-smoke.'));
  try {
    const prefix = join(smokeDir, 'prefix');
    const inst = cap('npm', ['i', '-g', `--prefix=${prefix}`, tarballPath, '--no-audit', '--no-fund']);
    if (inst.status !== 0)
      return { ok: false, failures: ['临时 prefix 安装失败：' + (inst.stderr ?? '').split('\n')[0]] };
    const env = { ...process.env, BERRY_AGENT_DATA_DIR: join(smokeDir, 'data') };
    // ⓪ bin 目录恰只含 berry（零旧名双键回归锁——2026-09-14 bin 改裁审计补：单键时
    // 安装位天然只生成 berry，但若未来把 berry-agent 塞回 bin 双键，仅 spawn berry 的
    // ①② 断言不会红——此处点名安装位内容恰为 ['berry'] 锁死回归面）
    const binEntries = readdirSync(join(prefix, 'bin')).sort();
    if (JSON.stringify(binEntries) !== JSON.stringify(['berry']))
      failures.push(`安装位 bin 目录非恰含 berry：[${binEntries.join(', ')}]`);
    // ① --version：退出码 0 + 结构前缀断言（防 semver 前缀吞 prerelease 漂移）+ 与真值全等
    const ver = spawnSync(join(prefix, 'bin', 'berry'), ['--version'], { encoding: 'utf8', env });
    const verOut = (ver.stdout ?? '').trim();
    if (ver.status !== 0) failures.push(`--version 退出码 ${ver.status}`);
    if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(verOut)) failures.push(`--version 非裸 semver：${verOut}`);
    if (verOut !== version) failures.push(`--version ${verOut} ≠ package.json ${version}`);
    // ② dump-config 真握手：官方装载面就绪（core 15 件缺席即红——静默降级收进发布闸）
    const dump = spawnSync(join(prefix, 'bin', 'berry'), ['dump-config'], { encoding: 'utf8', env });
    if (dump.status !== 0) failures.push(`dump-config 退出码 ${dump.status}`);
    for (const id of coreIds) {
      if (!(dump.stdout ?? '').includes(`"core:${id}"`)) failures.push(`dump-config 缺官方件 core:${id}`);
    }
    return { ok: failures.length === 0, failures };
  } finally {
    rmSync(smokeDir, { recursive: true, force: true });
  }
}

/** SDK 安装冒烟实装（契约 3 差分②——import 冒烟 + apiVersion 断言；零 bin 零 CLI 面） */
async function runSmokeSdk(tarballPath, version, expectedProtocolVersion) {
  const failures = [];
  const smokeDir = mkdtempSync(join(tmpdir(), 'berry-release-smoke-sdk.'));
  try {
    const prefix = join(smokeDir, 'prefix');
    const inst = cap('npm', ['i', '-g', `--prefix=${prefix}`, tarballPath, '--no-audit', '--no-fund']);
    if (inst.status !== 0)
      return { ok: false, failures: ['临时 prefix 安装失败：' + (inst.stderr ?? '').split('\n')[0]] };
    // 全局安装位 node_modules（unix 形 lib/node_modules）——ESM 禁目录 import 且
    // 全局 node_modules 不在解析链，须经 createRequire.resolve 取 main 指位文件 URL
    // 再 dynamic import（解析成功才是「main 指位真实可达」的真证明——07 §8.3 差分②）
    const nmDir = join(prefix, 'lib', 'node_modules');
    const { createRequire } = await import('node:module');
    const req = createRequire(join(smokeDir, 'smoke.js'));
    let entryUrl;
    try {
      entryUrl = pathToFileURL(req.resolve('berry-agent-sdk', { paths: [nmDir] })).href;
    } catch (err) {
      return { ok: false, failures: [`require.resolve 安装位解析失败：${err?.message ?? err}`] };
    }
    // 安装位 package.json 断言：version 全等 + apiVersion 治理锚（漂移即冒烟红）
    const meta = JSON.parse(readFileSync(join(nmDir, 'berry-agent-sdk', 'package.json'), 'utf8'));
    if (meta.version !== version) failures.push(`安装位 version ${meta.version} ≠ ${version}`);
    if (meta.apiVersion !== '1.0') failures.push(`apiVersion ${meta.apiVersion} ≠ '1.0'（治理锚漂移）`);
    // 子进程 import 冒烟：裸 node 环境加载安装位包（导出面四键断言；隔离防意外副作用）。
    // SDK_PROTOCOL_VERSION 与主仓真值全等对拍（===——类型/值双锁）
    const entry = `
      const m = await import(process.argv[1]);
      const checks = [
        ['createSdkClient', typeof m.createSdkClient === 'function'],
        ['spawnServeTransport', typeof m.spawnServeTransport === 'function'],
        ['httpSdkTransport', typeof m.httpSdkTransport === 'function'],
        ['SDK_PROTOCOL_VERSION', m.SDK_PROTOCOL_VERSION === ${JSON.stringify(expectedProtocolVersion)}],
      ];
      const bad = checks.filter(([, ok]) => !ok).map(([n]) => n);
      if (bad.length > 0) {
        console.error('导出面缺席：' + bad.join('，'));
        process.exit(1);
      }
    `;
    const probe = spawnSync(process.execPath, ['--input-type=module', '-e', entry, '--', entryUrl], {
      encoding: 'utf8',
    });
    if (probe.status !== 0) failures.push('import 冒烟失败：' + (probe.stderr ?? '').trim().split('\n')[0]);
    return { ok: failures.length === 0, failures };
  } finally {
    rmSync(smokeDir, { recursive: true, force: true });
  }
}

/**
 * CLI 实装缝。gates/build/publish 走 stdio inherit（人面可见长输出）；
 * 探测/pack/dist-tag 捕获形（机器判定）。tarball 解包树用系统 tar。
 * pkgKey 参数化（07 §8.3 双包发布道）：全部包差异经 PACKAGES 描述符承载
 * （name/包目录/tarball 名/白名单族/build 链/readme 读面/冒烟形……），
 * 本函数体零 pkgKey 条件分叉——git 系缝两包共享。描述符承载面含 2026-09-14
 * 扫描四役 idx 8 收笔的 build/readme/smoke 三面（修前内联 if 分叉系参数化遗漏）。
 */
export function realSeams(pkgKey = 'main') {
  const pkg = PACKAGES[pkgKey];
  const pkgRoot = join(REPO_ROOT, pkg.pkgDir);
  const version = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')).version;
  const shasumOf = (path) => createHash('sha1').update(readFileSync(path)).digest('hex');
  const tarballTree = (tarballPath) => {
    const dir = mkdtempSync(join(tmpdir(), 'berry-release-tree.'));
    try {
      cap('tar', ['-xzf', tarballPath, '-C', dir]);
      const walk = (d) => {
        const out = [];
        for (const ent of readdirSync(d, { withFileTypes: true })) {
          const p = join(d, ent.name);
          if (ent.isDirectory()) out.push(...walk(p));
          else out.push(p);
        }
        return out;
      };
      const tree = {};
      for (const f of walk(join(dir, 'package'))) {
        const rel = f.slice(join(dir, 'package').length + 1);
        tree[rel] = createHash('sha256').update(readFileSync(f)).digest('hex');
      }
      return tree;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
  return {
    gates: () =>
      ['typecheck', 'test', 'lint:topology', 'format:check'].map((name) => ({
        name,
        ok: cap('npm', ['run', name], { stdio: 'inherit' }).status === 0,
      })),
    gitStatusPorcelain: () => cap('git', ['status', '--porcelain']).stdout ?? '',
    probe: (v) => cap('npm', ['view', `${pkg.name}@${v}`, 'dist.shasum', '--json']),
    build: () => {
      // 全新 build（先清包 dist/——主包仓根 dist、SDK 包内 dist）；build 链随描述符
      rmSync(join(pkgRoot, 'dist'), { recursive: true, force: true });
      return { ok: cap('npm', ['run', pkg.buildScript], { stdio: 'inherit' }).status === 0 };
    },
    packList: () => {
      // npm pack 依 cwd 的 package.json 定打哪个包——必须切包目录
      const res = cap('npm', ['pack', '--dry-run', '--json'], { cwd: pkgRoot });
      if (res.status !== 0) return [];
      return JSON.parse(res.stdout).flatMap((entry) => entry.files.map((f) => f.path));
    },
    pack: () => {
      const outDir = mkdtempSync(join(tmpdir(), 'berry-release-pack.'));
      const res = cap('npm', ['pack', `--pack-destination=${outDir}`], { cwd: pkgRoot });
      // 退出码必检（2026-09-14 扫描四役 idx 9）：非零即抛含 stderr 摘录的错——
      // 不得拼好 tarballPath 照返（下游 fileShasum 对缺席件裸抛 ENOENT，产出
      // 裸栈非契约式报告）；runRelease 契约 3 位收口成红报告。临时目录回收。
      if (res.status !== 0) {
        rmSync(outDir, { recursive: true, force: true });
        throw new Error(`npm pack 失败（退出码 ${res.status}）：${(res.stderr ?? '').trim().split('\n')[0] ?? ''}`);
      }
      return { tarballPath: join(outDir, pkg.tarballName(version)) };
    },
    fileShasum: shasumOf,
    tarballTree,
    fetchTarball: (v) => {
      const outDir = mkdtempSync(join(tmpdir(), 'berry-release-fetch.'));
      const res = cap('npm', ['pack', `${pkg.name}@${v}`, `--pack-destination=${outDir}`]);
      if (res.status !== 0) {
        rmSync(outDir, { recursive: true, force: true });
        return null;
      }
      return join(outDir, pkg.tarballName(v));
    },
    // 契约 4 读面随描述符（主包 = 根 README 全语言族 glob 拼合 / SDK = 包目录
    // 单件——读面语义与来龙去脉见 readMainReadmeText / readSdkReadmeText 注）
    readmeText: () => pkg.readmeText(pkgRoot),
    readmeVariants: () => pkg.readmeVariants(pkgRoot),
    // 冒烟形随描述符（主包 CLI 形 / SDK import 形——deps 懒装载见描述符 smoke 注）
    smoke: (tarballPath) => pkg.smoke(tarballPath, version),
    // 纪元彩排读面（W8 纪元彩排批）：提交位 API 面快照 + 查 9 归档族——两读
    // 全只读，不触网不触 git 写面；判差语义在 extract-api-surface 单源
    epochDrillFaces: () => ({
      surface: JSON.parse(readFileSync(join(REPO_ROOT, 'src/contracts/api-surface.json'), 'utf8')),
      archives: loadArchivedSnapshots(),
    }),
    publish: (tarballPath, o) => {
      const args = ['publish', tarballPath];
      if (o.next) args.push('--tag', 'next');
      if (o.dryRun) args.push('--dry-run');
      return cap('npm', args, { stdio: 'inherit' });
    },
    distTagLs: () => {
      const res = cap('npm', ['dist-tag', 'ls', pkg.name]);
      if (res.status !== 0) return { latest: '<unreachable>', next: '<unreachable>' };
      const tags = {};
      for (const line of (res.stdout ?? '').split('\n')) {
        const m = line.match(/^([\w.-]+):\s*(\S+)$/);
        if (m !== null) tags[m[1]] = m[2];
      }
      return tags;
    },
    distTagAdd: (v, tag) => cap('npm', ['dist-tag', 'add', `${pkg.name}@${v}`, tag], { stdio: 'inherit' }),
    // 传播窗复读缝（07 §8.3 契约 5 定形注）：真睡实现；测试形注入即时缝零挂钟。
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    headCommit: () => cap('git', ['rev-parse', 'HEAD']).stdout.trim(),
    gitTagState: (tag) => {
      const exists = cap('git', ['tag', '--list', tag]).stdout.trim() !== '';
      if (!exists) return 'absent';
      return { commit: cap('git', ['rev-parse', `${tag}^{}`]).stdout.trim() };
    },
    gitTagCreate: (tag) => void cap('git', ['tag', tag]),
    gitTagPush: (tag) =>
      cap('git', ['-c', 'http.version=HTTP/1.1', 'push', 'origin', `refs/tags/${tag}`], { stdio: 'inherit' }),
    /**
     * 触发腿 CI 轮询（gh CLI——fail-loud 前检：gh 缺席/未认证即 fatal，不静默
     * 空转）。轮询 `gh run list` 按 headBranch=tag 匹配 release.yml run；20s
     * 间隔、30 分钟帽（四门禁含全量测试的 CI 时长量级之上留足裕量）。
     * 返回 {status:'success', runUrl} / {status:'failure', runUrl} /
     * {status:'timeout'} / {status:'fatal', reason}。
     */
    ciWaitRun: async (tag, onProgress) => {
      const ghOk = cap('gh', ['--version']);
      if (ghOk.status !== 0)
        return {
          status: 'fatal',
          reason: 'gh CLI 缺席——本机触发腿依赖 gh 轮询 CI run（brew install gh && gh auth login）',
        };
      const ghAuth = cap('gh', ['auth', 'status']);
      if (ghAuth.status !== 0) return { status: 'fatal', reason: 'gh CLI 未认证——gh auth login 后重跑' };
      const deadline = Date.now() + 30 * 60 * 1000;
      for (;;) {
        const res = cap('gh', [
          'run',
          'list',
          '--workflow=release.yml',
          '--limit',
          '20',
          '--json',
          'databaseId,status,conclusion,headBranch,url',
        ]);
        if (res.status === 0) {
          let runs = [];
          try {
            runs = JSON.parse(res.stdout ?? '[]');
          } catch {
            runs = [];
          }
          const hit = runs.find((r) => r.headBranch === tag);
          if (hit !== undefined) {
            const done = hit.status === 'completed' || hit.status === 'success' || hit.status === 'failure';
            if (done) {
              const ok = hit.status === 'completed' ? hit.conclusion === 'success' : hit.status === 'success';
              return { status: ok ? 'success' : 'failure', runUrl: hit.url };
            }
            if (onProgress !== undefined) onProgress(hit.status);
          }
        }
        if (Date.now() >= deadline) return { status: 'timeout' };
        cap('sleep', ['20']);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// CLI 装配（仅直跑时执行；被 import〔release.test.mjs〕零副作用）
// ---------------------------------------------------------------------------

const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;

if (isMain) {
  const parsed = parseReleaseArgs(process.argv.slice(2));
  if (parsed.errors.length > 0) {
    for (const e of parsed.errors) console.error(`用法错：${e}`);
    console.error(
      '用法：node tools/release.mjs [--package <main|sdk>] [--dry-run] [--local-publish] [--epoch-drill] [--inject <谱项>]',
    );
    process.exit(2);
  }
  // pkgKey 自推律接线（07 §8.3 第 2 款 d 则）：RELEASE_REF 在场（release.yml
  // 发布腿零参形）按 tag 前缀自推包键；显式 --package 与自推冲突/非两前缀
  // 形均响亮拒退 2（与 argv 用法错同出口同形）
  let pkgKey = parsed.pkg;
  try {
    pkgKey = derivePkgKey(process.env.RELEASE_REF, {
      explicitPkg: parsed.pkg,
      pkgExplicit: parsed.pkgExplicit,
    });
  } catch (err) {
    console.error(`用法错：${err.message}`);
    console.error(
      '用法：node tools/release.mjs [--package <main|sdk>] [--dry-run] [--local-publish] [--epoch-drill] [--inject <谱项>]',
    );
    process.exit(2);
  }
  const base = realSeams(pkgKey);
  const seams = parsed.inject !== undefined ? INJECT_SPECTRUM[parsed.inject].patch(base) : base;
  const pkgJson = JSON.parse(readFileSync(join(REPO_ROOT, PACKAGES[pkgKey].pkgDir, 'package.json'), 'utf8'));
  const result = await runRelease(seams, {
    version: pkgJson.version,
    pkgKey,
    dryRun: parsed.dryRun,
    localPublish: parsed.localPublish,
    epochDrill: parsed.epochDrill,
    log: (line) => console.log(line),
  });
  process.exit(result.code);
}
