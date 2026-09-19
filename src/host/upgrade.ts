/**
 * host/upgrade —— 自体升级维护动词 + 启动版本检查真身（07 §8.5）。
 *
 * 两消费面同源（第 6 条「同一只读检查、同一缓存」）：
 *
 *  - **CLI 维护动词 `berry upgrade`**（§8.5 第 1 条三态）：装机形态甄别 →
 *    npm 全局形查 dist-tags → spawn `npm i -g berry-agent@<target>`（stdio
 *    继承）→ 提示重启生效（**永不热换运行中进程**——四家工具共识律）；
 *    pnpm/yarn/bun 全局装路径形只打原管理器指引不代执行（`npm i -g` 会装出
 *    第二份）；源码形态打四步指引；registry 404 诚实告知。
 *  - **启动版本检查**（§8.5 第 6 条——TUI 交互启动异步一次）：仅 TUI 形
 *    fire（headless 零检查归装配位不调用本腿）；24h 节流缓存
 *    `update-check.json` 三键；按版本去重提示；失败静默。
 *
 * 安全面（契约级回归锁位）：
 *  - **registry 响应不可信**——dist-tags 读回的 `latest` 须经
 *    {@link TARGET_RE} semver 形状白名单才准进 spawn 参数插值位（win32 上
 *    参数插值即命令注入面——白名单先于 spawn，非白名单形诚实拒不执行）；
 *  - **零外传**——GET dist-tags 请求体空、无任何本地数据随行（§8.4 遥测
 *    立场修订注对端：该腿外传零字节）；
 *  - **传输帽**——5s 超时帽（AbortSignal）+ 响应体 64KiB 帽（dist-tags
 *    文档实测量 <1KiB，帽只防坏形灌入）；
 *  - **两腿同源律**——判版本与安装共用同一 registry 根解析（`npm config
 *    get registry` → 回退官方源并注记），镜像/私服形态下结论不失真。
 */
import { spawn as childSpawn } from 'node:child_process';
import { dirname } from 'node:path';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { pinnedFetch } from '../web/index.js';
import type { FetchLike } from '../web/types.js';
import type { SpawnRunner } from './plugin-install.js';

/** 跳过启动版本检查的 env 键（§8.5 第 6 条——关掉即零网络包，机器可验证） */
export const SKIP_UPDATE_CHECK_ENV = 'BERRY_AGENT_SKIP_UPDATE_CHECK';

/** 节流缓存文件名（数据目录下——§8.5 第 6 条三键定形） */
export const UPDATE_CHECK_BASENAME = 'update-check.json';

/** 节流窗（ms）——缓存新鲜期内启动零网络直读缓存（Codex 20h 形同族，收紧为 24h） */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** 版本检查超时帽（ms）——§8.5 第 6 条定值 5s */
export const UPDATE_CHECK_TIMEOUT_MS = 5_000;

/** dist-tags 响应体大小帽（bytes）——坏形防御位（真文档 <1KiB） */
export const UPDATE_CHECK_MAX_BYTES = 64 * 1024;

/** 官方 registry 根（`npm config get registry` 解析失败的回退腿） */
export const OFFICIAL_REGISTRY_ROOT = 'https://registry.npmjs.org';

/** 包名（对外声明值位——package.json name 同源；代码标识符不携品牌词） */
const PACKAGE_NAME = 'berry-agent';

/**
 * **spawn 插值白名单**（契约级）：目标版本串只准 semver 形（v 前缀也不收
 * ——npm 装机形 `pkg@1.2.3` 无 v 前缀），prerelease 段限 [0-9A-Za-z.-] 且
 * 首尾为字母数字（semver 规范文）。registry 响应不可信——任何越形（空串、
 * 串 shell 元字符、多行）在此拒下，不达 spawn。
 */
export const TARGET_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z]([0-9A-Za-z.-]*[0-9A-Za-z])?)?$/;

/**
 * 完整 semver 解析形（含 prerelease / build metadata 段——build 段比较时
 * 忽略，semver 规范 precedence 定义）。
 */
const SEMVER_FULL_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** semver 解析形（prerelease 拆点后置——标识符数组或 null 表示无段） */
interface ParsedSemver {
  readonly major: number;
  readonly minor: number;
  readonly patch: number;
  readonly prerelease: readonly string[] | null;
}

/**
 * semver 含 prerelease 全序比较（§8.5 第 6 条判序承载形——alpha 期 latest
 * 本身即 prerelease 的现实；plugin-market 的三段词法形「预发布段不比」是
 * 03 §9.6 v1 收敛档的插件域判据，与本件分立不可混用）。
 *
 * 规范 precedence：三段数值序 → 无 prerelease > 有 prerelease → 标识符逐位
 * （数值标识符数值比、数值恒小于字母数字、字母数字 ASCII 词法比；前缀全等
 * 时字段多者大）。build metadata 段忽略。**非 semver 形返 null**（判序无从
 * 起——调用方保守处置：启动检查不提示、CLI 装机诚实拒）。
 */
export function compareSemverFull(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (pa === null || pb === null) return null;
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (pa[key] !== pb[key]) return pa[key] - pb[key] > 0 ? 1 : -1;
  }
  // 三段全等：无 prerelease 者大（1.0.0 > 1.0.0-alpha）
  if (pa.prerelease === null && pb.prerelease === null) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  const la = pa.prerelease;
  const lb = pb.prerelease;
  const len = Math.min(la.length, lb.length);
  for (let i = 0; i < len; i += 1) {
    const na = /^\d+$/.test(la[i]!);
    const nb = /^\d+$/.test(lb[i]!);
    if (na && nb) {
      const va = Number(la[i]);
      const vb = Number(lb[i]);
      if (va !== vb) return va > vb ? 1 : -1;
    } else if (na !== nb) {
      return na ? -1 : 1; // 数值标识符恒小于字母数字标识符
    } else if (la[i] !== lb[i]!) {
      return la[i]! > lb[i]! ? 1 : -1; // ASCII 词法序
    }
  }
  if (la.length !== lb.length) return la.length > lb.length ? 1 : -1; // 字段多者大
  return 0;
}

/** semver 解析（非形返 null） */
function parseSemver(text: string): ParsedSemver | null {
  const m = SEMVER_FULL_RE.exec(text);
  if (m === null) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] === undefined ? null : m[4].split('.'),
  };
}

/** 装机形态（§8.5 第 1 条三态 + 非 npm 管理器甄别形） */
export type InstallForm = 'npm-global' | 'pnpm' | 'yarn' | 'bun' | 'source';

/**
 * 装机形态甄别：入口 real path 分段判（**次序敏感**——pnpm/bun/yarn 全局
 * 装路径同样含 `node_modules` 段，专形先于通形判）：
 *
 *  - `.pnpm` 段 → pnpm（pnpm 全局仓硬链接店 `.pnpm` 锚）；
 *  - `.bun` 段 → bun（bun 全局 `~/.bun/install/global/...`）；
 *  - 相邻段 `yarn`+`global` 或 `.yarn` 段 → yarn（yarn 全局两代路径形）；
 *  - `node_modules` 段 → npm 全局（npm 形——spawn `npm i -g` 代执行位）；
 *  - 其余 → 源码形态（clone + build + link——指引不代执行）。
 */
export function detectInstallForm(realEntryPath: string): InstallForm {
  // 分隔符归一（win32 反斜杠同判）后分段
  const segments = realEntryPath.split(/[\\/]+/).filter((s) => s !== '');
  if (segments.includes('.pnpm')) return 'pnpm';
  if (segments.includes('.bun')) return 'bun';
  if (segments.includes('.yarn')) return 'yarn';
  for (let i = 0; i + 1 < segments.length; i += 1) {
    if (segments[i] === 'yarn' && segments[i + 1] === 'global') return 'yarn';
  }
  if (segments.includes('node_modules')) return 'npm-global';
  return 'source';
}

/** registry 根解析回执（fallback 位 = 解析失败回退官方源的注记锚） */
export interface RegistryRoot {
  readonly root: string;
  readonly fallback: boolean;
}

/**
 * 解析用户 registry 根（两腿同源律承载位）：`npm config get registry`
 * 输出裁白 → 尾随斜杠剥除 → http(s) 形校验；**解析失败（npm 缺席/输出越
 * 形）回退官方源并置 fallback**（调用方注记「解析失败回退官方源」——镜像/
 * 私服形态下判版本的诚实披露位，不静默吞）。
 */
export async function resolveRegistryRoot(spawn: SpawnRunner): Promise<RegistryRoot> {
  try {
    const { stdout } = await spawn.run('npm', ['config', 'get', 'registry'], { cwd: undefined });
    const trimmed = stdout.trim();
    if (/^https?:\/\//.test(trimmed)) {
      return { root: trimmed.replace(/\/+$/, ''), fallback: false };
    }
  } catch {
    // npm 缺席/执行失败——回退腿（下方统一返）
  }
  return { root: OFFICIAL_REGISTRY_ROOT, fallback: true };
}

/** dist-tags 读回三态（404 单列——CLI 未发布态的判据位） */
export type DistTagsResult =
  | { readonly kind: 'ok'; readonly latest: string }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * 只读 GET dist-tags（`<registry 根>/berry-agent/dist-tags`——npm registry
 * 标准端点，响应形 `{"latest":"1.2.3",...}`）：5s 超时帽 + 64KiB 体帽 +
 * latest 键字符串形校验。**零外传**（GET 无请求体、无本地数据随行）；
 * fetchImpl 缺省 pinnedFetch（同包单源律——fetch 与 dispatcher 恒同包
 * undici）。
 */
export async function fetchDistTags(
  registryRoot: string,
  deps: { readonly fetchImpl?: FetchLike } = {},
): Promise<DistTagsResult> {
  const fetchImpl = deps.fetchImpl ?? pinnedFetch;
  const url = `${registryRoot}/${PACKAGE_NAME}/dist-tags`;
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    });
    if (response.status === 404) return { kind: 'not-found' };
    if (!response.ok) {
      return { kind: 'failed', message: `registry 应答 ${response.status}` };
    }
    // 体帽双闸：content-length 头先验（在场越帽即拒不下载）+ 读回长度复验
    const declared = response.headers?.get?.('content-length');
    if (declared !== undefined && declared !== null && Number(declared) > UPDATE_CHECK_MAX_BYTES) {
      return { kind: 'failed', message: `dist-tags 文档越体帽（${declared} bytes）` };
    }
    const text = await response.text();
    if (text.length > UPDATE_CHECK_MAX_BYTES) {
      return { kind: 'failed', message: `dist-tags 文档越体帽（${text.length} bytes）` };
    }
    const parsed = JSON.parse(text) as { latest?: unknown };
    if (typeof parsed.latest !== 'string' || parsed.latest === '') {
      return { kind: 'failed', message: 'dist-tags 文档坏形（latest 键缺席或非串）' };
    }
    return { kind: 'ok', latest: parsed.latest };
  } catch (err) {
    // 超时/网络错/DNS 错统一静默形（调用方决定呈现——启动腿零提示、CLI 腿诚实报）
    return { kind: 'failed', message: String(err) };
  }
}

/** 节流缓存三键形（§8.5 第 6 条定形——坏形读为 null 视缺席，失败静默律） */
export interface UpdateCheckState {
  readonly lastCheckedAt: number;
  readonly latest: string;
  readonly notifiedVersion: string | null;
}

/** 缓存 IO 注入面（生产 node:fs 真身；测试内存形） */
export interface UpdateCheckFs {
  readIfExists(path: string): string | null;
  write(path: string, text: string): void;
}

/** 生产 fs 真身（缺席读 null；写前 mkdir 数据目录幂等——:memory: 诊断形不达此位） */
export function createNodeUpdateCheckFs(): UpdateCheckFs {
  return {
    readIfExists: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null; // 缺席/EACCES 一律视缺席（失败静默律——缓存坏不炸启动）
      }
    },
    write: (path, text) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, text, 'utf8');
    },
  };
}

/** 读节流缓存（缺席/坏 JSON/键形越界一律 null——缓存坏不炸启动不误提示） */
export function readUpdateCheckState(fs: UpdateCheckFs, dataDir: string): UpdateCheckState | null {
  const text = fs.readIfExists(`${dataDir}/${UPDATE_CHECK_BASENAME}`);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text) as Partial<UpdateCheckState>;
    if (
      typeof parsed.lastCheckedAt !== 'number' ||
      typeof parsed.latest !== 'string' ||
      (parsed.notifiedVersion !== undefined &&
        parsed.notifiedVersion !== null &&
        typeof parsed.notifiedVersion !== 'string')
    ) {
      return null;
    }
    return {
      lastCheckedAt: parsed.lastCheckedAt,
      latest: parsed.latest,
      notifiedVersion: parsed.notifiedVersion ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * 写节流缓存（**读-改-写合并**语义的承载位：调用方先 read 再合并 notifiedVersion
 * 后整体落盘——多窗并发 last-writer-wins 时 notifiedVersion 不被旧结构抹掉）。
 */
export function writeUpdateCheckState(fs: UpdateCheckFs, dataDir: string, state: UpdateCheckState): void {
  fs.write(`${dataDir}/${UPDATE_CHECK_BASENAME}`, `${JSON.stringify(state, null, 2)}\n`);
}

/** 记提示去重位（启动检查提示后落——按版本去重，/upgrade 与 berry upgrade 不经此位） */
export function recordNotifiedVersion(fs: UpdateCheckFs, dataDir: string, version: string, now: number): void {
  const prior = readUpdateCheckState(fs, dataDir);
  writeUpdateCheckState(fs, dataDir, {
    lastCheckedAt: prior?.lastCheckedAt ?? now,
    latest: prior?.latest ?? version,
    notifiedVersion: version,
  });
}

/** 版本检查公共注入面（启动检查与手动检查同构造形——生产真身归装配位铸造） */
export interface UpdateCheckDeps {
  readonly dataDir: string;
  readonly currentVersion: string;
  readonly spawn: SpawnRunner;
  readonly fetchImpl?: FetchLike;
  readonly fs: UpdateCheckFs;
  readonly now: () => number;
}

/** 手动检查回执（/upgrade 薄壳与 berry upgrade 判位共用——强制刷新缓存形） */
export type ManualCheckResult =
  | { readonly kind: 'ok'; readonly latest: string; readonly registryFallback: boolean }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * 写回合并律（§8.5 第 6 条「只前进」）：`lastCheckedAt` 取新查值；
 * `latest` 不回退——新查值比缓存值**低**（多窗并发下旧窗慢回执晚到的形）
 * 即弃新值保缓存值；`notifiedVersion` 恒保留缓存值（手动查看不动去重位）。
 */
function mergeStateForward(prior: UpdateCheckState | null, fetchedLatest: string, checkedAt: number): UpdateCheckState {
  if (prior !== null) {
    const cmp = compareSemverFull(fetchedLatest, prior.latest);
    if (cmp !== null && cmp < 0) {
      return { lastCheckedAt: checkedAt, latest: prior.latest, notifiedVersion: prior.notifiedVersion };
    }
  }
  return { lastCheckedAt: checkedAt, latest: fetchedLatest, notifiedVersion: prior?.notifiedVersion ?? null };
}

/**
 * 手动检查（§8.5 第 6 条「不受去重辖、强制刷新缓存」的两手动消费面共用）：
 * **恒走网络**（忽略 24h 节流窗）→ 成功即写回缓存（mergeStateForward 只前进
 * 合并——notifiedVersion 不动、latest 不回退）。404 单列（CLI 未发布态判据）。
 */
export async function runManualUpdateCheck(deps: UpdateCheckDeps): Promise<ManualCheckResult> {
  const registry = await resolveRegistryRoot(deps.spawn);
  const result = await fetchDistTags(registry.root, { fetchImpl: deps.fetchImpl });
  if (result.kind === 'ok') {
    // 成功才落账（失败不写 lastCheckedAt——网络瞬断后下次启动照查，不被
    // 失败结果钉死 24h 窗）
    const prior = readUpdateCheckState(deps.fs, deps.dataDir);
    writeUpdateCheckState(deps.fs, deps.dataDir, mergeStateForward(prior, result.latest, deps.now()));
    return { kind: 'ok', latest: result.latest, registryFallback: registry.fallback };
  }
  return result.kind === 'not-found' ? { kind: 'not-found' } : { kind: 'failed', message: result.message };
}

/** 启动检查回执（装配位据 hasUpdate/alreadyNotified 决定 notify 与去重落账） */
export type StartupCheckDecision =
  | { readonly kind: 'skipped'; readonly reason: 'env-off' }
  | {
      readonly kind: 'cache-fresh';
      readonly latest: string;
      readonly hasUpdate: boolean;
      readonly alreadyNotified: boolean;
    }
  | {
      readonly kind: 'checked';
      readonly latest: string;
      readonly hasUpdate: boolean;
      readonly alreadyNotified: boolean;
    }
  | { readonly kind: 'failed'; readonly message: string };

/**
 * 启动版本检查编排（§8.5 第 6 条——TUI 交互启动装配位 fire，headless 零
 * 调用）：
 *
 *  - env `BERRY_AGENT_SKIP_UPDATE_CHECK` 置值即 skipped（关掉即零网络包）；
 *  - 缓存新鲜（<24h）→ cache-fresh 直读缓存**零网络**（节流律）；
 *  - 过期/缺席 → 网络查 + 写回缓存（成功才写——失败不钉窗）→ checked；
 *  - 网络失败 → failed（**调用方零提示零噪音**——更新检查自身永不打扰）；
 *  - hasUpdate 判序 = compareSemverFull(latest, current) > 0（非 semver 形
 *    保守不提示）；alreadyNotified = notifiedVersion === latest（按版本去重）。
 */
export async function runStartupUpdateCheck(
  deps: UpdateCheckDeps & { readonly env: { readonly [key: string]: string | undefined } },
): Promise<StartupCheckDecision> {
  if (deps.env[SKIP_UPDATE_CHECK_ENV] !== undefined && deps.env[SKIP_UPDATE_CHECK_ENV] !== '') {
    return { kind: 'skipped', reason: 'env-off' };
  }
  const prior = readUpdateCheckState(deps.fs, deps.dataDir);
  if (prior !== null && deps.now() - prior.lastCheckedAt < UPDATE_CHECK_INTERVAL_MS) {
    const cmp = compareSemverFull(prior.latest, deps.currentVersion);
    return {
      kind: 'cache-fresh',
      latest: prior.latest,
      hasUpdate: cmp !== null && cmp > 0,
      alreadyNotified: prior.notifiedVersion === prior.latest,
    };
  }
  const manual = await runManualUpdateCheck(deps);
  if (manual.kind === 'ok') {
    const cmp = compareSemverFull(manual.latest, deps.currentVersion);
    return {
      kind: 'checked',
      latest: manual.latest,
      hasUpdate: cmp !== null && cmp > 0,
      alreadyNotified: prior?.notifiedVersion === manual.latest,
    };
  }
  return manual.kind === 'not-found'
    ? { kind: 'failed', message: 'registry 404——包不在册（未发布态）' }
    : { kind: 'failed', message: manual.message };
}

/** CLI 维护动词注入面（全受局面——测试替身据此还原编舞） */
export interface UpgradeCliDeps {
  readonly currentVersion: string;
  /** 入口模块 real path（形态甄别真源——装配位 realpath 归一后传入） */
  readonly realEntryPath: string;
  readonly spawn: SpawnRunner;
  readonly fetchImpl?: FetchLike;
  readonly dataDir: string;
  readonly fs: UpdateCheckFs;
  readonly now: () => number;
  readonly writeOut: (text: string) => void;
  readonly writeErr: (text: string) => void;
  /** 装机执行位（缺省 stdio 继承 spawn npm——注入面：测试记参不真装） */
  readonly runInstall?: (target: string) => Promise<boolean>;
}

/** `berry upgrade` 三态执行体（§8.5 第 1 条——退出码语义：0 成功/已最新，1 诚实拒） */
export async function runUpgradeCommand(deps: UpgradeCliDeps): Promise<number> {
  const form = detectInstallForm(deps.realEntryPath);

  // —— 源码形态：不自动执行（源码树可能有本地改动）——指引四步 ——
  if (form === 'source') {
    deps.writeOut('源码形态装机（未检出 node_modules）——不自动执行，手动升级四步：');
    deps.writeOut('  1. git pull（或 fork 形态自行同步上游）');
    deps.writeOut('  2. npm install');
    deps.writeOut('  3. npm run build');
    deps.writeOut('  4. npm link（bin 链即指新码）');
    return 0;
  }

  // —— 非 npm 全局管理器：只打原管理器一条命令指引，不代执行（防双份装机） ——
  if (form !== 'npm-global') {
    const guide: Record<Exclude<InstallForm, 'npm-global' | 'source'>, string> = {
      pnpm: 'pnpm add -g berry-agent',
      yarn: 'yarn global add berry-agent',
      bun: 'bun add -g berry-agent',
    };
    deps.writeOut(`检出 ${form} 全局管理器装机形态——请用原管理器升级（npm i -g 会装出第二份）：`);
    deps.writeOut(`  ${guide[form]}`);
    return 0;
  }

  // —— npm 全局形：查 dist-tags（手动检查路——强制刷新缓存同源） ——
  const check = await runManualUpdateCheck(deps);
  if (check.kind === 'not-found') {
    deps.writeErr('registry 应答 404——berry-agent 不在该 registry 上（未发布态或 registry 指错）。');
    deps.writeErr('源码形态升级指引：git pull → npm install → npm run build → npm link。');
    return 1;
  }
  if (check.kind === 'failed') {
    deps.writeErr(`版本检查失败：${check.message}`);
    deps.writeErr('稍后重试，或直接执行 npm i -g berry-agent@latest。');
    return 1;
  }
  if (check.registryFallback) {
    deps.writeOut('（注：npm config get registry 解析失败——已回退官方源 registry.npmjs.org）');
  }

  // **白名单闸（契约级）**：目标版本进 spawn 插值位前必须过 semver 形状
  // 白名单——registry 响应不可信，越形即命令注入面（win32 参数插值尤甚）。
  // 闸序在判序前：非 semver 形的 latest 连「已最新」都不能判（无从比——
  // 坏响应诚实拒，不保守装作无事）。
  if (!TARGET_RE.test(check.latest)) {
    // 越形值经 JSON.stringify 回显（控制字可见转义——坏响应不直灌终端）
    deps.writeErr(
      `远端 latest 越形（${JSON.stringify(check.latest)} 非 semver 白名单形）——拒执行装机（registry 响应不可信）。`,
    );
    return 1;
  }

  // 判序：latest > 本地才升级（白名单已过——cmp 必非 null，防御位保守收）
  const cmp = compareSemverFull(check.latest, deps.currentVersion);
  if (cmp === null || cmp <= 0) {
    deps.writeOut(`已是最新：${deps.currentVersion}（远端 latest ${check.latest}）。`);
    return 0;
  }

  deps.writeOut(
    `发现新版本：${deps.currentVersion} → ${check.latest}，开始升级（npm i -g ${PACKAGE_NAME}@${check.latest}）……`,
  );
  const runInstall = deps.runInstall ?? defaultRunInstall;
  const installed = await runInstall(check.latest);
  if (!installed) {
    deps.writeErr('装机失败（npm 非零退出）——可手动执行：npm i -g berry-agent@latest');
    return 1;
  }
  deps.writeOut(`升级完成：${deps.currentVersion} → ${check.latest}。`);
  deps.writeOut('重启 berry 后生效（运行中进程持旧码——升级不热替换内存）。');
  return 0;
}

/**
 * 装机执行真身：spawn npm install -g（**stdio 继承**——装机输出直给用户终
 * 端，进度/OTP 浏览器链接不吞）。win32 上 npm 可执行名带 .cmd 尾——平台
 * 分叉；目标串已过 TARGET_RE 白名单（插值安全的前提）。
 */
function defaultRunInstall(target: string): Promise<boolean> {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = childSpawn(cmd, ['install', '-g', `${PACKAGE_NAME}@${target}`], { stdio: 'inherit' });
    child.on('error', () => resolve(false));
    child.on('close', (code) => resolve(code === 0));
  });
}
