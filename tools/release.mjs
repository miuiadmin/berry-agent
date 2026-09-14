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
 * 双包发布道：`--package <main|sdk>`（缺省 main 零参兼容）——六道编舞单源
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
 * 演习形态：--dry-run——契约 1/2 照跑；契约 3 真做；契约 4 幂等照判、publish
 * 走 npm publish --dry-run；契约 5 只调纯函数断言期望终态、不执行 dist-tag
 * add；契约 6 只校验既有 tag 状态。
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
 */
const MAIN_PACK_ALLOWED = /^(package\.json|README(\.(zh|ko|fr|es|ru))?\.md|LICENSE|dist\/.+|examples\/.+)$/;
/** 主包三禁（全域执法不问目录——dist 内同样禁测试/映射件） */
const MAIN_PACK_BANNED = /\.(test|spec)\.(js|ts|tsx)$|\.test\.d\.ts$|\.js\.map$/;
/** 主包必在件（bin 主入口 / SPA 面 / API 治理面 / 溯源戳 / 双档） */
const MAIN_PACK_MUST = [
  'dist/host/main.js',
  'dist/webui/index.html',
  'dist/api/surface.json',
  'dist/.build-meta.json',
  'README.md',
  'LICENSE',
];

/**
 * SDK 包白名单：恰收 package.json / README 单件（无语言族）/ 入口树 +
 * 同编译自包含跟进树（批 13f「类型面自仓单源同编译」——SDK src import 主仓
 * 契约/通道码，tsc 跟进编译入包，import 图可达才入树）。
 * 必在件 = 入口 index 双档 + client/http/stdio/types 四模块 .js + README。
 */
const SDK_PACK_ALLOWED = /^(package\.json|README\.md|dist\/(packages\/berry-agent-sdk\/src|src)\/.+)$/;
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

/**
 * 包描述符单源表（--package 词面全集；07 §8.3 双包发布道定形块）。
 * tagPrefix 两包分立：主包 v<version> / SDK sdk-v<version>（版本号独立演进，
 * 同号真发时同形 tag 必撞）；treeStrip = 契约 4 深对照剥离集（主包溯源戳
 * 两件 / SDK 纯 tsc 确定性编译空集——shasum 不等即实质差异）。
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
    tarballName: (version) => `berry-agent-${version}.tgz`,
    packAllowed: MAIN_PACK_ALLOWED,
    packBanned: MAIN_PACK_BANNED,
    packMust: MAIN_PACK_MUST,
    treeStrip: ['dist/.build-meta.json', 'dist/.api-emit.stamp'],
    buildScript: 'build',
    readmeText: readMainReadmeText,
    smoke: async (tarballPath, version) => runSmoke(tarballPath, version, await loadCoreIds()),
  },
  sdk: {
    name: 'berry-agent-sdk',
    pkgDir: 'packages/berry-agent-sdk',
    tagPrefix: 'sdk-v',
    tarballName: (version) => `berry-agent-sdk-${version}.tgz`,
    packAllowed: SDK_PACK_ALLOWED,
    packBanned: SDK_PACK_BANNED,
    packMust: SDK_PACK_MUST,
    treeStrip: [],
    buildScript: 'build:sdk',
    readmeText: readSdkReadmeText,
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

/** 契约 4 真发前 README 占位符检查（仓转公开日回填前禁发；dry-run 不拦） */
export function judgeReadme(text) {
  const hits = (text.match(/^.*(PLACEHOLDER|安装占位|<!--\s*placeholder).*$/gim) ?? []).length;
  return { ok: hits === 0, hits };
}

// ---------------------------------------------------------------------------
// argv 解析（--dry-run / --inject <谱项>；用法错收集后退 2）
// ---------------------------------------------------------------------------

/**
 * 发布机器注入谱（--inject 词面全集；afterPublish = 谱项位于 publish 之后——
 * 无 --dry-run 即用法错，防真上传后撞注入终态留半成功态）。
 * patch(seams) 在 exec 边界喂 canned 应答（不真起 HTTP server）。
 */
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
};

/** argv 解析：{ pkg, dryRun, inject, errors }——用法错聚齐由 CLI 层退 2 */
export function parseReleaseArgs(argv) {
  const out = { pkg: 'main', dryRun: false, inject: undefined, errors: [] };
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === '--dry-run') out.dryRun = true;
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
        `未知参数：${tok}（仅认 --package <${Object.keys(PACKAGES).join('|')}> / --dry-run / --inject <谱项>）`,
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
 * @param {{version: string, pkgKey?: string, dryRun: boolean, log: (line: string) => void}} opts
 *   pkgKey 缺省 'main'（07 §8.3 双包发布道——编舞零分叉，差异全在描述符/缝面）
 * @returns {{code: number, report: string[]}}
 */
export async function runRelease(seams, opts) {
  const { version, dryRun } = opts;
  const pkg = PACKAGES[opts.pkgKey ?? 'main'];
  const report = [];
  const log = (line) => {
    report.push(line);
    opts.log(line);
  };
  const prerelease = isPrerelease(version);
  log(`[release] ${pkg.name}@${version}${dryRun ? '（--dry-run 演习）' : ''} 六道契约起跑`);

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

  // —— 契约 5：dist-tag 终态机器断言（末尾必跑）——
  if (prerelease && !dryRun && published) {
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
  // 重跑形）查实际 ls——分叉在此被咬住（人工干预 dist-tag 不回写脚本 = 驯服失效之始）
  const tags =
    !dryRun || probe.state === 'present'
      ? seams.distTagLs()
      : prerelease
        ? { latest: version, next: version }
        : { latest: version };
  const tagVerdict = judgeDistTag(tags, version, prerelease);
  if (!tagVerdict.ok) {
    log(`[契约5] 红：${tagVerdict.reason}——半成功态必须被人看见（人工干预 dist-tag 后不回写脚本 = 驯服失效之始）`);
    return { code: 1, report };
  }
  log('[契约5] 绿：dist-tag 终态断言过');

  // —— 契约 6：尾件 git tag ——（tag 域两包分立：主包 v<version> / SDK sdk-v<version>——07 §8.3 差分③同节）
  const tagName = `${pkg.tagPrefix}${version}`;
  const tagState = seams.gitTagState(tagName);
  if (tagState === 'absent') {
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
    // 冒烟形随描述符（主包 CLI 形 / SDK import 形——deps 懒装载见描述符 smoke 注）
    smoke: (tarballPath) => pkg.smoke(tarballPath, version),
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
    headCommit: () => cap('git', ['rev-parse', 'HEAD']).stdout.trim(),
    gitTagState: (tag) => {
      const exists = cap('git', ['tag', '--list', tag]).stdout.trim() !== '';
      if (!exists) return 'absent';
      return { commit: cap('git', ['rev-parse', `${tag}^{}`]).stdout.trim() };
    },
    gitTagCreate: (tag) => void cap('git', ['tag', tag]),
    gitTagPush: (tag) =>
      cap('git', ['-c', 'http.version=HTTP/1.1', 'push', 'origin', `refs/tags/${tag}`], { stdio: 'inherit' }),
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
    console.error('用法：node tools/release.mjs [--package <main|sdk>] [--dry-run] [--inject <谱项>]');
    process.exit(2);
  }
  const base = realSeams(parsed.pkg);
  const seams = parsed.inject !== undefined ? INJECT_SPECTRUM[parsed.inject].patch(base) : base;
  const pkgJson = JSON.parse(readFileSync(join(REPO_ROOT, PACKAGES[parsed.pkg].pkgDir, 'package.json'), 'utf8'));
  const result = await runRelease(seams, {
    version: pkgJson.version,
    pkgKey: parsed.pkg,
    dryRun: parsed.dryRun,
    log: (line) => console.log(line),
  });
  process.exit(result.code);
}
