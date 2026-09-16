/**
 * host/plugin-market/update —— update/upgrade 服务面（03 §9.6 失效降级节 +
 * upgrade 语义段·mp-4）。
 *
 * **update**（手动档整源刷新——auto-update 仅手动档拍板 P7）：
 *  - `refreshMarketplaceSource`：单源刷新核心（update 与 upgrade 的 TTL 惰性
 *    腿共用）——local 零网络重读快照 / url 重拉 JSON / git 重克隆，四腿同律：
 *    解析 → **改名漂移拒**（新 catalog 自报名 ≠ 源清单名——腐蚀条目防线）→
 *    **up-to-date 判据**（git 同 commit / url 同文本 / local 同 catalog 文本
 *    ——已最新不换血但 updatedAt 刷新重置 24h TTL）→ 变化则**整目录换血
 *    promote**（staging 中转——拷完整才 rm 旧缓存 + rename 落位；中途失败
 *    旧缓存原样不动，半拷贝永不 promote）→ record 落账（commit/catalogPath
 *    /updatedAt 前进）。失败 = record 不动 + 旧缓存原样不动 + tmp/staging
 *    中转清场（不虚报刷新；报文注记重跑 update 自愈）。
 *  - `updateMarketplaceSources`：单源（点名缺席 = missingName）或全量（逐源
 *    独立结局——一源失败不 brick 其余源）。
 *
 * **upgrade**（catalog 对拍 + 换装分派——「拉最新」唯经本动词）：
 *  - 刷新腿 **24h TTL 惰性门控**（isCatalogStale 过龄才回源——鲜缓存零网络）；
 *  - 对拍面 = 账本 market 注记装机（无注记的直装物不在射程——走 plugins
 *    update 忠于账本 ref）；
 *  - 版本对拍：catalog 条目声明 version 才对拍（无 version 跳过）；semver
 *    序比较、非 semver 不等即新、账本 version 缺席视不等；
 *  - 分派恒复用 marketInstall（installPlugin 换血豁免——零新装机机制）；
 *    **单件点名 = force 换血重装**（版本未变也重装）、**全量 = 逐件 try
 *    跳败**（翻译拒/装机拒诚实记 failed，其余条目照常——部分成功语义）；
 *  - 寻址级硬拒（rejected 位）：词法坏 / 市场不在册 / 无装机条目 / 多中。
 */
import { expandGitUri, expandHomePath } from './classify.js';
import { loadCatalogFromRoot, parseMarketplaceCatalog } from './catalog.js';
import { isCatalogStale } from './ttl.js';
import { readMarketplaceSources, writeMarketplaceSources } from './registry.js';
import { marketInstall, resolveMarketLedgerId } from './install.js';
import { parseMarketPluginId } from './types.js';
import type { MarketFetchFace, MarketFs, MarketplacePluginEntry, MarketplaceSourceRecord } from './types.js';
import type { InstallExecutorDeps } from '../plugin-install.js';
import type { PluginLedgerEntry } from '../plugin-store.js';

/** 刷新/升级服务注入面：fs + 网络腿 + 时钟 + home 展开基 */
export interface UpdateMarketplaceDeps {
  readonly dataDir: string;
  readonly fs: MarketFs;
  /** 网络抓取位（local 源刷新不消费；git/url 源必给） */
  readonly fetch: MarketFetchFace;
  readonly now: () => Date;
  /** `~` 展开基（local 源 `~/` 形需要——CLI 传 os.homedir()） */
  readonly home?: string;
}

/** 单源刷新结局（failed 不 brick 调用方——全量形态逐源独立呈现） */
export type SourceRefreshOutcome =
  | { readonly status: 'updated'; readonly name: string; readonly entryCount: number; readonly commit?: string }
  | { readonly status: 'up-to-date'; readonly name: string; readonly commit?: string }
  | { readonly status: 'failed'; readonly name: string; readonly message: string };

/** 市场缓存目录（与 install.ts marketCacheDir 同式——文件内单源对拍） */
function marketCacheDir(dataDir: string, marketplace: string): string {
  return `${dataDir}/marketplaces/${marketplace}`;
}

/**
 * 目录树快照拷贝（add.ts copyTree 同式——文件内复刻避免跨件私面导出；语义
 * = 整树物化，眺空目录保形）。换血调用方以 staging promote 消费——半拷贝
 * 永不 promote（中转成或湮，见 promoteTree）。
 */
function copyTree(fs: MarketFs, src: string, dst: string): void {
  fs.mkdir(dst);
  const names = fs.readdir(src) ?? [];
  for (const name of names) {
    const from = `${src}/${name}`;
    const to = `${dst}/${name}`;
    const children = fs.readdir(from);
    if (children !== null && children.length > 0) {
      copyTree(fs, from, to); // 子目录——递归
    } else {
      const text = fs.read(from);
      if (text !== null) {
        fs.write(to, text); // 文件——拷贝
      } else {
        fs.mkdir(to); // 空目录——保形
      }
    }
  }
}

/**
 * 换血 promote（03 §9.6「换血 promote 故障防护」定形）：拷贝先落
 * `<dst>.staging` 中转目录，**拷完整后**才 rm 旧缓存 + rename 落位（同卷
 * rename 近原子）——任何中途失败 = 旧缓存原样不动（upgrade「刷新失败按既有
 * 缓存对拍」降级律的故障防护前提：失败刷新不得自毁既有缓存，否则降级承诺
 * 在正需兑现的失败位反而落空）；staging 中转 finally 清场（成或湮——半拷贝
 * 永不 promote，既往失败残影亦先清；rm 契约 force 缺席不抛）。
 */
function promoteTree(fs: MarketFs, src: string, dst: string): void {
  const staging = `${dst}.staging`;
  try {
    fs.rm(staging); // 既往失败残影清场（幂等）
    copyTree(fs, src, staging);
    fs.rm(dst); // 旧缓存退位——此刻新内容已完整落中转
    fs.rename(staging, dst); // 同卷 rename 落位
  } finally {
    fs.rm(staging); // 成功路径 rename 后已不在场；失败路径半拷贝中转清场
  }
}

/** 源清单 record 落账（读-改-写——同名替换保位序；失败位调用方已先行不落） */
function commitRecordUpdate(
  dataDir: string,
  fs: MarketFs,
  name: string,
  patch: Partial<Pick<MarketplaceSourceRecord, 'commit' | 'catalogPath' | 'updatedAt'>>,
): void {
  const read = readMarketplaceSources(dataDir, fs);
  // 坏账本拒写 fail-loud（防覆盖）：读-改-写位对坏读直接抛——空兜底落盘 =
  // 单笔 patch 抹除全账本，且落出的合法形空账本比坏文件更隐蔽（后续读恒
  // ok、零源、无报错指路）；与读侧「不静默空」、add 位 checkNameClash
  // 「坏形拒改」同律。调用方 catch 收口 failed——诚实拒不掩盖
  if (!read.ok) {
    throw new Error(`源清单文件坏形：${read.message}——落账拒写（防覆盖）`);
  }
  const next = read.sources.map((record) => (record.name === name ? { ...record, ...patch } : record));
  writeMarketplaceSources(dataDir, next, fs);
}

/**
 * 单源刷新核心（update 全量/点名与 upgrade TTL 惰性腿共用）。
 * up-to-date 判据分源：git = commit 相同；url = 文本相同；local = catalog
 * 文本相同。已最新不换血但 updatedAt 刷新（TTL 窗重启）。
 */
export async function refreshMarketplaceSource(
  deps: UpdateMarketplaceDeps,
  record: MarketplaceSourceRecord,
): Promise<SourceRefreshOutcome> {
  const { dataDir, fs, now } = deps;
  const cacheDir = marketCacheDir(dataDir, record.name);
  const updatedAt = now().toISOString();
  const driftReject = (catalogName: string): SourceRefreshOutcome => ({
    status: 'failed',
    name: record.name,
    message: `上游 catalog 自报名 "${catalogName}" 与源清单名 "${record.name}" 不符——市场疑似改名漂移，先 marketplace remove 后按新名重新 add`,
  });
  const fail = (message: string): SourceRefreshOutcome => ({ status: 'failed', name: record.name, message });
  // git 腿 tmp 克隆中转站跟踪（catch 可达位）：fetch 成功返回后清场责任归调用
  // 方（fetch.ts 契约）——promote 段（staging 拷贝/rm 缓存/rename 落位/落账写）
  // 任一 throw 位都不能留下无主克隆；url/local 腿恒 undefined
  let gitCloneDir: string | undefined;
  // 换血进行位：三源分腿的 staging promote → 落账窗内置位。staging promote 律
  // （§9.6 换血 promote 故障防护注）下窗内 throw 时两种形都无须清缓存——
  // promote 未成 = 旧缓存原样不动（中转 finally 成或湮）；promote 已成而落账
  // 未前进 = 已 promote 新内容在场、record 落后于内容的良性窗（下次 update
  // commit 对拍不等自然收敛）；窗外的 throw（fetch/解析/点名拒）缓存未动——
  // 清缓存反而会制造「记录在场 + 缓存缺席」——不清
  let swapping = false;

  try {
    // —— local 腿：零网络重读源目录快照 ——
    if (record.sourceType === 'local') {
      if (record.sourceUri.startsWith('~') && deps.home === undefined) {
        return fail('local 源 `~` 展开需 home 注入位——装配面缺席');
      }
      const dir = expandHomePath(record.sourceUri, deps.home ?? '');
      if (!fs.isDir(dir)) {
        return fail(`源目录缺席（${dir}）——请核对路径或 remove 该源`);
      }
      const loaded = loadCatalogFromRoot(dir, fs);
      if (!loaded.ok) return fail(loaded.reason);
      if (!loaded.parse.ok) return fail(`catalog 坏形：${loaded.parse.reason}`);
      if (loaded.parse.catalog.name !== record.name) return driftReject(loaded.parse.catalog.name);
      // catalog 文本直读（load 契约只回 catalogPath + parse——文本以 fs 再读为准）
      const catalogText = fs.read(`${dir}/${loaded.catalogPath}`);
      const cached = fs.read(`${cacheDir}/${record.catalogPath}`);
      // up-to-date 判据补前提：catalogPath 未漂移。源目录 catalog 换位（双路径
      // 读序换边/上游迁移形）时即便文本相同也必须走换血——否则账本 catalogPath
      // 前进到缓存中不存在的位（缓存树一字未动），discover/install 随即读出
      // 「缓存缺席」与本次「已最新」自相矛盾
      if (loaded.catalogPath === record.catalogPath && catalogText !== null && cached === catalogText) {
        // 已最新——不换血、TTL 窗重启（路径相等前提下 patch 只需刷 updatedAt）
        commitRecordUpdate(dataDir, fs, record.name, { updatedAt });
        return { status: 'up-to-date', name: record.name };
      }
      if (catalogText === null) return fail(`catalog 读回落空（${dir}/${loaded.catalogPath}）`);
      swapping = true; // 换血窗开——staging promote 起（失败位旧缓存原样不动）
      promoteTree(fs, dir, cacheDir); // 整目录换血——staging 中转 promote
      commitRecordUpdate(dataDir, fs, record.name, { catalogPath: loaded.catalogPath, updatedAt });
      return {
        status: 'updated',
        name: record.name,
        entryCount: loaded.parse.catalog.plugins.length,
      };
    }

    // —— url 腿：重拉单文件 JSON ——
    if (record.sourceType === 'url') {
      const fetched = await deps.fetch.fetchUrlCatalog(record.sourceUri);
      const parse = parseMarketplaceCatalog(fetched.text, `${record.name}/marketplace.json`);
      if (!parse.ok) return fail(`catalog 坏形：${parse.reason}`);
      if (parse.catalog.name !== record.name) return driftReject(parse.catalog.name);
      const cachedPath = `${cacheDir}/marketplace.json`;
      if (fs.read(cachedPath) === fetched.text) {
        commitRecordUpdate(dataDir, fs, record.name, { updatedAt });
        return { status: 'up-to-date', name: record.name };
      }
      swapping = true; // 换血窗开——staging promote 起（失败位旧缓存原样不动）
      // 换血 promote 同律（单文件腿直写中转，不借 copyTree）：写完整后 rm 旧
      // 缓存 + rename 落位——中途失败旧缓存原样不动（三源同律）
      const stagingDir = `${cacheDir}.staging`;
      try {
        fs.rm(stagingDir); // 既往失败残影清场（幂等）
        fs.mkdir(stagingDir);
        fs.write(`${stagingDir}/marketplace.json`, fetched.text);
        fs.rm(cacheDir); // 旧缓存退位——此刻新内容已完整落中转
        fs.rename(stagingDir, cacheDir); // 同卷 rename 落位
      } finally {
        fs.rm(stagingDir); // 成功路径 rename 后已不在场；失败路径中转清场
      }
      commitRecordUpdate(dataDir, fs, record.name, { updatedAt });
      return { status: 'updated', name: record.name, entryCount: parse.catalog.plugins.length };
    }

    // —— git/github 腿：重克隆 + commit 对拍 ——
    const expanded = expandGitUri(record.sourceUri);
    if (!expanded.ok) return fail(`git 源坏形（${expanded.message}）`);
    const fetched = await deps.fetch.fetchGitCatalog(expanded.url);
    gitCloneDir = fetched.cloneDir; // 清场责任已归本函数——catch 位可清
    // catalog 文本以 fs 物化为准（fetch 契约：cloneDir 树物化在 MarketFs 上）
    const catalogText =
      fs.read(`${fetched.cloneDir}/${fetched.catalogPath}`) ?? (fetched.text !== '' ? fetched.text : null);
    if (catalogText === null) {
      fs.rm(fetched.cloneDir); // tmp 清场
      return fail(`git 源 catalog 缺席（${fetched.catalogPath}）`);
    }
    const parse = parseMarketplaceCatalog(catalogText, `${record.name}/${fetched.catalogPath}`);
    if (!parse.ok) {
      fs.rm(fetched.cloneDir);
      return fail(`catalog 坏形：${parse.reason}`);
    }
    if (parse.catalog.name !== record.name) {
      fs.rm(fetched.cloneDir);
      return driftReject(parse.catalog.name);
    }
    if (fetched.commit === record.commit) {
      // 同 commit = 已最新——不换血、TTL 窗重启
      fs.rm(fetched.cloneDir);
      commitRecordUpdate(dataDir, fs, record.name, { updatedAt });
      return { status: 'up-to-date', name: record.name, commit: fetched.commit };
    }
    swapping = true; // 换血窗开——staging promote 起（失败位旧缓存原样不动）
    promoteTree(fs, fetched.cloneDir, cacheDir); // 整目录换血——staging 中转 promote
    fs.rm(fetched.cloneDir); // tmp 清场（fetch 契约：成功返回后清场归调用方）
    commitRecordUpdate(dataDir, fs, record.name, {
      commit: fetched.commit,
      catalogPath: fetched.catalogPath,
      updatedAt,
    });
    return {
      status: 'updated',
      name: record.name,
      entryCount: parse.catalog.plugins.length,
      commit: fetched.commit,
    };
  } catch (error) {
    // fetch/克隆异常 = failed 结局（record 不动——不虚报刷新）。fetch 已成功
    // 返回的 tmp 克隆在此尽力清场（成功返回后清场归调用方——fetch.ts 契约）；
    // 清场自身失败不再连环抛——主错误优先呈现
    const message = error instanceof Error ? error.message : String(error);
    // 换血窗内 throw（staging promote 律）：promote 未成 = 旧缓存原样不动；
    // promote 已成而落账未前进 = 已 promote 新内容在场、record 落后于内容的
    // 良性窗（下次 update commit 对拍不等自然收敛）——两种形都不清缓存（中转
    // 由 promoteTree 自身 finally 清场）；窗外 throw 缓存未动——不清
    let selfHeal = '';
    if (swapping) {
      selfHeal = `——record 未动（缓存原样未动或已 promote 在场——重跑 berry marketplace update ${record.name} 自愈）`;
    }
    if (gitCloneDir !== undefined) {
      try {
        fs.rm(gitCloneDir);
      } catch {
        // 尽力清场——失败不掩盖主错误
      }
    }
    return fail(`${message}${selfHeal}`);
  }
}

/**
 * update [name] 服务：单源（点名）或全量。missingName 非空 = 点名源不在
 * 清单（调用方诚实拒）；outcomes 逐源独立——一源失败不 brick 其余源。
 */
export async function updateMarketplaceSources(
  deps: UpdateMarketplaceDeps,
  name?: string,
): Promise<{ readonly outcomes: readonly SourceRefreshOutcome[]; readonly missingName: string | null }> {
  const read = readMarketplaceSources(deps.dataDir, deps.fs);
  if (!read.ok) {
    throw new Error(`源清单文件坏形：${read.message}——刷新拒猜（03 §9.6）`);
  }
  if (name !== undefined) {
    const record = read.sources.find((r) => r.name === name);
    if (record === undefined) {
      return { outcomes: [], missingName: name };
    }
    return { outcomes: [await refreshMarketplaceSource(deps, record)], missingName: null };
  }
  const outcomes: SourceRefreshOutcome[] = [];
  for (const record of read.sources) {
    outcomes.push(await refreshMarketplaceSource(deps, record)); // 逐源串行——互不 brick
  }
  return { outcomes, missingName: null };
}

/* ---------------- upgrade 面 ---------------- */

/** upgrade 注入面：刷新腿 deps + 装机面受局（marketInstall 消费）+ 账本快照 */
export interface UpgradeMarketplaceDeps extends UpdateMarketplaceDeps {
  readonly install: InstallExecutorDeps;
  /** 账本条目快照（调用方读好传入——对拍面 = market 注记装机） */
  readonly ledger: readonly PluginLedgerEntry[];
}

/** 逐条换装结局（upgraded/current/skipped/failed 四态——CLI 呈现单源） */
export type UpgradeEntryOutcome =
  | {
      readonly status: 'upgraded';
      readonly id: string;
      readonly from?: string;
      readonly to?: string;
      /** 换血 id 漂移注记（装机 manifest id ≠ 账本 id——§9.6 定形）：旧 → 新，呈现面指路（启用行已随换代迁移） */
      readonly idDrift?: { readonly from: string; readonly to: string };
    }
  | { readonly status: 'current'; readonly id: string; readonly version?: string }
  | { readonly status: 'skipped'; readonly id: string; readonly reason: string }
  | { readonly status: 'failed'; readonly id: string; readonly message: string };

/** upgrade 批产物：outcomes 逐条 + rejected 寻址级硬拒（CLI 退 1 位）+ 刷新注记 */
export interface UpgradeResult {
  readonly outcomes: readonly UpgradeEntryOutcome[];
  /** 寻址级/清单级硬拒报文（null = 无硬拒——逐条结局自行呈现） */
  readonly rejected: string | null;
  /** 逐市场刷新失败注记（对拍降级走既有缓存——不拒整批，呈现层 warn） */
  readonly refreshFailures: readonly string[];
}

/** semver 三段词法（可选 v 前缀——序比较承载形） */
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/**
 * catalog 条目声明版本读取（upgrade 对拍位——与呈现面 resolveEntryVersion 的
 * 四级回落分立：对拍要「catalog 说了什么」而非「呈现给用户什么」）：
 * 条目顶层 `version` 优先（真仓 14 条目此形）→ npm 源对象 `version` 次之
 * （translate 钉 ref 的同一位——npm 腿的自然比较基）；两处皆缺席 = 未声明。
 */
function declaredEntryVersion(entry: MarketplacePluginEntry): string | undefined {
  if (typeof entry.version === 'string' && entry.version !== '') return entry.version;
  const source = entry.source;
  if (
    typeof source === 'object' &&
    source.source === 'npm' &&
    typeof source.version === 'string' &&
    source.version !== ''
  ) {
    return source.version;
  }
  return undefined;
}

/**
 * 版本对拍判据（§9.6：semver 序比较、非 semver 不等即新）：
 *  - 双方均 semver 形 → 序比较（严格大于才算新——相等即 current）；
 *  - 任一方非 semver → 字面不等即新（含账本 version 缺席——对拍无从比视不等）。
 */
function isNewerVersion(candidate: string, current: string | undefined): boolean {
  if (current === undefined) return true;
  const from = SEMVER_RE.exec(current);
  const to = SEMVER_RE.exec(candidate);
  if (from !== null && to !== null) {
    for (let i = 1; i <= 3; i += 1) {
      const a = Number(from[i]);
      const b = Number(to[i]);
      if (b > a) return true;
      if (b < a) return false;
    }
    return false; // 三段全等（预发布段不比——v1 收敛档）
  }
  return candidate !== current;
}

/**
 * upgrade [name@market] 服务：TTL 惰性刷新 → catalog 对拍 → marketInstall
 * 换装分派。单件点名 = force 换血重装；全量 = 逐件 try 跳败（部分成功）。
 */
export async function upgradeMarketplacePlugins(deps: UpgradeMarketplaceDeps, id?: string): Promise<UpgradeResult> {
  const { dataDir, fs, now } = deps;
  const refreshFailures: string[] = [];

  const sourcesRead = readMarketplaceSources(dataDir, fs);
  if (!sourcesRead.ok) {
    return {
      outcomes: [],
      rejected: `源清单文件坏形：${sourcesRead.message}——upgrade 拒猜（03 §9.6）`,
      refreshFailures,
    };
  }

  // —— 寻址分形：单件（点名）或全量（market 注记装机全集） ——
  let targetMarket: string | undefined;
  let candidates: readonly PluginLedgerEntry[];
  if (id !== undefined) {
    const addr = parseMarketPluginId(id);
    if (addr === null) {
      return {
        outcomes: [],
        rejected: `市场寻址形坏（"${id}"）——形如 name@marketplace（条目名@市场名）`,
        refreshFailures,
      };
    }
    targetMarket = addr.marketplace;
    const record = sourcesRead.sources.find((r) => r.name === addr.marketplace);
    if (record === undefined) {
      return {
        outcomes: [],
        rejected: `市场 "${addr.marketplace}" 不在源清单——在册清单见 berry marketplace list`,
        refreshFailures,
      };
    }
    const resolved = resolveMarketLedgerId(deps.ledger, addr);
    if (!resolved.ok) {
      return { outcomes: [], rejected: resolved.message, refreshFailures };
    }
    candidates = deps.ledger.filter((e) => e.id === resolved.id);
  } else {
    candidates = deps.ledger.filter((e) => e.market !== undefined);
  }

  // —— TTL 惰性刷新：目标市场过龄才回源（鲜缓存零网络——24h TTL 消费位） ——
  const marketNames = new Set<string>();
  for (const entry of candidates) {
    if (entry.market !== undefined) marketNames.add(entry.market.name);
  }
  if (targetMarket !== undefined) marketNames.add(targetMarket);
  let refreshedAny = false; // 是否发生刷新动作（updated/up-to-date 均落盘 record；failed 不动）
  for (const name of marketNames) {
    const record = sourcesRead.sources.find((r) => r.name === name);
    if (record === undefined) continue; // 市场已不在册——逐条 skipped 承载
    if (!isCatalogStale(record.updatedAt, now().getTime())) continue; // 鲜缓存——零网络
    refreshedAny = true;
    const outcome = await refreshMarketplaceSource(deps, record);
    if (outcome.status === 'failed') {
      // 刷新失败不拒整批——对拍降级走既有缓存（stale 照用，离线 OK）
      refreshFailures.push(`${name}：${outcome.message}`);
    }
  }
  // —— 刷新后重读源清单：commitRecordUpdate 会前进 catalogPath/commit（git
  // 换血形上游 catalog 换位、local up-to-date 形 catalogPath 前进均达）——
  // 对拍读缓存必须按新 record 走，旧快照的 catalogPath 读 null 会误报
  // 「缓存缺席」跳过该市场全部条目；重读坏形理论不可达（只 patch 不增
  // 删）——降级沿用旧快照（仅当刷新全 failed 的陈化形，语义等价旧缓存）
  let sourcesCurrent = sourcesRead;
  if (refreshedAny) {
    const fresh = readMarketplaceSources(dataDir, fs);
    if (fresh.ok) sourcesCurrent = fresh;
  }

  // —— 逐条对拍 + 换装 ——
  const outcomes: UpgradeEntryOutcome[] = [];
  for (const entry of candidates) {
    const marketName = entry.market?.name;
    const entryName = entry.market?.entry;
    if (marketName === undefined || entryName === undefined) {
      continue; // 对拍面 = market 注记装机——无注记直装物不在射程（前置过滤已保）
    }
    const record = sourcesCurrent.sources.find((r) => r.name === marketName);
    if (record === undefined) {
      outcomes.push({
        status: 'skipped',
        id: entry.id,
        reason: `市场 "${marketName}" 已不在源清单——remove 后重 add 或 uninstall 该装机物`,
      });
      continue;
    }
    // 缓存 catalog 读（刷新后缓存即真相；改名漂移拒与 install 同律）
    const cacheDir = marketCacheDir(dataDir, marketName);
    const catalogText = fs.read(`${cacheDir}/${record.catalogPath}`);
    if (catalogText === null) {
      outcomes.push({
        status: 'skipped',
        id: entry.id,
        reason: `市场 "${marketName}" 缓存缺席（${record.catalogPath} 读不到）`,
      });
      continue;
    }
    const parsed = parseMarketplaceCatalog(catalogText, `${marketName}/${record.catalogPath}`);
    if (!parsed.ok) {
      outcomes.push({ status: 'skipped', id: entry.id, reason: `市场 "${marketName}" catalog 坏形：${parsed.reason}` });
      continue;
    }
    if (parsed.catalog.name !== record.name) {
      outcomes.push({
        status: 'skipped',
        id: entry.id,
        reason: `市场 "${marketName}" 缓存 catalog 自报名 "${parsed.catalog.name}" 与源清单名不符——疑似改名漂移`,
      });
      continue;
    }
    const catalogEntry = parsed.catalog.plugins.find((p) => p.name === entryName);
    if (catalogEntry === undefined) {
      outcomes.push({
        status: 'skipped',
        id: entry.id,
        reason: `条目 "${entryName}@${marketName}" 已不在售（上游下架）`,
      });
      continue;
    }
    // 单件点名 = force 换血重装；全量 = 声明 version 才对拍（无 version 跳过）
    const declaredVersion = declaredEntryVersion(catalogEntry);
    if (id === undefined) {
      if (declaredVersion === undefined) {
        outcomes.push({
          status: 'skipped',
          id: entry.id,
          reason: 'catalog 未声明版本——不对拍（单件点名可 force 重装）',
        });
        continue;
      }
      if (!isNewerVersion(declaredVersion, entry.version)) {
        outcomes.push({ status: 'current', id: entry.id, version: declaredVersion });
        continue;
      }
    }
    // 换装分派：恒复用 marketInstall（installPlugin 换血豁免——零新装机机制）
    const installed = await marketInstall({ dataDir, fs, install: deps.install }, `${entryName}@${marketName}`);
    if (!installed.ok) {
      // try 跳败——翻译拒/装机拒诚实记 failed，其余条目照常（部分成功语义）
      outcomes.push({ status: 'failed', id: entry.id, message: installed.message });
      continue;
    }
    outcomes.push({
      status: 'upgraded',
      id: entry.id,
      ...(entry.version !== undefined ? { from: entry.version } : {}),
      ...(installed.entry.version !== undefined || declaredVersion !== undefined
        ? { to: installed.entry.version ?? declaredVersion }
        : {}),
      // 换血 id 漂移注记：装机 manifest id ≠ 账本 id（marketInstall 换血豁免
      // 已撤账 + 启用行随迁）——呈现面须指路，不能只报旧 id 假装没漂
      ...(installed.entry.id !== entry.id ? { idDrift: { from: entry.id, to: installed.entry.id } } : {}),
    });
  }
  return { outcomes, rejected: null, refreshFailures };
}
