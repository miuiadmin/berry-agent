/**
 * host/plugin-market/add —— add 编舞（03 §9.6 源清单与缓存节·源分类 add 解
 * 析位）：classify → 读 catalog（双路径读序）→ 撞名拒 → 缓存落位 → 源清单
 * 落账。**缓存即真相**——成功即物化，discover 读侧零网络。
 *
 * 三源分腿：
 *  - local 源：全真跑零网络（目录快照拷贝进 `<dataDir>/marketplaces/<name>/`）；
 *  - git/github 源：经 MarketFetchFace 注入位（**mp-2 零网络**——fetch 缺席
 *    诚实拒指路 mp-4；mp-4 落真身）；产物整树 promote 进缓存 + commit 位
 *    落账（两次 fetch 漂移防线）；
 *  - url 源：同 seam；只存 JSON 平铺（catalogPath='marketplace.json'、无
 *    仓结构、无 commit 位）。
 *
 * 零残影纪律：任何失败位（坏源/坏 catalog/撞名/fetch 失败）拒时不落账、
 * 不留缓存目录、tmp 克隆场清场。
 */
import { classifyMarketplaceSource, expandGitUri, expandHomePath } from './classify.js';
import { loadCatalogFromRoot, parseMarketplaceCatalog } from './catalog.js';
import { addSourceRecord, readMarketplaceSources, writeMarketplaceSources } from './registry.js';
import type { MarketFetchFace, MarketFs, MarketplaceSourceRecord } from './types.js';

/** add 注入面：fs + 时钟 + 网络源 seam（缺席 = git/url 源诚实拒）+ home 展开基 */
export interface AddMarketplaceDeps {
  readonly dataDir: string;
  readonly fs: MarketFs;
  readonly now: () => Date;
  /** 网络抓取位（mp-4 落真身——mp-2 缺席诚实拒） */
  readonly fetch?: MarketFetchFace;
  /** `~` 展开基（真身 os.homedir()——注入位） */
  readonly home?: string;
}

/** add 产物：result 面（ok=true 时 record = 落账源记录） */
export type AddMarketplaceResult =
  { readonly ok: true; readonly record: MarketplaceSourceRecord } | { readonly ok: false; readonly message: string };

/**
 * 目录树快照拷贝（local 源全真跑 / git 克隆 promote 共用）：src 整树 → dst。
 * 眺空目录保形（mkdir）；mp-4 真身可优化为跨设备安全 rename——语义等价。
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
 * add 市场源（信任裁决的显式动作——用户点名源才装载；零源出厂不预置）。
 * name 域 = catalog 自报名（add 时锁定，discover 改名漂移防线锚点）；
 * sourceUri = 用户输入原样（短手/URL/路径——refresh 腿重放用）。
 */
export async function addMarketplaceSource(deps: AddMarketplaceDeps, source: string): Promise<AddMarketplaceResult> {
  const { dataDir, fs, now } = deps;
  const stamp = now().toISOString(); // addedAt = updatedAt = 装载时刻

  // —— 源分类五规则序（不识形 fail-loud 拒）——
  const classified = classifyMarketplaceSource(source);
  if (!classified.ok) {
    return { ok: false, message: classified.message };
  }

  // —— local 腿：全真跑零网络 ——
  if (classified.sourceType === 'local') {
    const dir = expandHomePath(source, deps.home ?? '');
    if (source.startsWith('~') && deps.home === undefined) {
      return { ok: false, message: 'local 源 `~` 展开需 home 注入位——装配面缺席' };
    }
    if (!fs.isDir(dir)) {
      return { ok: false, message: `源目录缺席（${dir}）——请核对路径` };
    }
    const loaded = loadCatalogFromRoot(dir, fs);
    if (!loaded.ok) {
      return { ok: false, message: loaded.reason }; // 双路径全缺席——报文含两候选
    }
    if (!loaded.parse.ok) {
      return { ok: false, message: loaded.parse.reason }; // 坏 catalog 拒——零残影（尚未写任何位）
    }
    const name = loaded.parse.catalog.name;
    const clash = checkNameClash(dataDir, fs, name);
    if (clash !== null) return { ok: false, message: clash };
    // 目录快照拷贝进缓存（缓存即真相——后续读侧零回源）
    copyTree(fs, dir, `${dataDir}/marketplaces/${name}`);
    const record: MarketplaceSourceRecord = {
      name,
      sourceType: 'local',
      sourceUri: source, // 用户输入原样
      catalogPath: loaded.catalogPath,
      addedAt: stamp,
      updatedAt: stamp,
    };
    commitRecord(dataDir, fs, record);
    return { ok: true, record };
  }

  // —— 网络腿（git/github/url）：fetch seam 缺席诚实拒（mp-2 零网络出厂）——
  if (deps.fetch === undefined) {
    return {
      ok: false,
      message: `网络源（${classified.sourceType === 'url' ? 'url' : 'git/github'}）抓取位尚未装配——mp-4 批落真身后可用；当前版本请用本地路径源（"./" / "~/" / 绝对路径）`,
    };
  }

  // —— url 腿：单文件 JSON 快照（无仓结构、无 commit 位）——
  if (classified.sourceType === 'url') {
    let fetched: { readonly text: string };
    try {
      fetched = await deps.fetch.fetchUrlCatalog(source);
    } catch (error) {
      return { ok: false, message: `url 源抓取失败（${(error as Error).message}）` };
    }
    const parse = parseForAdd(fetched.text, source);
    if (parse.ok === false) return { ok: false, message: parse.message };
    const clash = checkNameClash(dataDir, fs, parse.name);
    if (clash !== null) return { ok: false, message: clash };
    // 缓存平铺：marketplaces/<name>/marketplace.json
    const cacheDir = `${dataDir}/marketplaces/${parse.name}`;
    fs.mkdir(cacheDir);
    fs.write(`${cacheDir}/marketplace.json`, fetched.text);
    const record: MarketplaceSourceRecord = {
      name: parse.name,
      sourceType: 'url',
      sourceUri: source,
      catalogPath: 'marketplace.json',
      addedAt: stamp,
      updatedAt: stamp,
    };
    commitRecord(dataDir, fs, record);
    return { ok: true, record };
  }

  // —— git/github 腿：克隆到 tmp → 解析 → promote 整树进缓存 + commit 落账 ——
  const expanded = expandGitUri(source); // github 短手展开（git 直通）
  if (!expanded.ok) {
    return { ok: false, message: `git 源坏形（${expanded.message}）` };
  }
  let fetched: {
    readonly cloneDir: string;
    readonly catalogPath: string;
    readonly text: string;
    readonly commit: string;
  };
  try {
    fetched = await deps.fetch.fetchGitCatalog(expanded.url);
  } catch (error) {
    return { ok: false, message: `git 源抓取失败（${(error as Error).message}）` };
  }
  // catalog 文本以 fs 物化为准（fetch 契约：cloneDir 树物化在 MarketFs 上）
  const catalogText =
    fs.read(`${fetched.cloneDir}/${fetched.catalogPath}`) ?? (fetched.text !== '' ? fetched.text : null);
  if (catalogText === null) {
    fs.rm(fetched.cloneDir); // tmp 清场——零残影
    return { ok: false, message: `git 源 catalog 缺席（${fetched.catalogPath}）` };
  }
  const parse = parseForAdd(catalogText, `${source}/${fetched.catalogPath}`);
  if (parse.ok === false) {
    fs.rm(fetched.cloneDir); // tmp 清场——零残影
    return { ok: false, message: parse.message };
  }
  const clash = checkNameClash(dataDir, fs, parse.name);
  if (clash !== null) {
    fs.rm(fetched.cloneDir); // tmp 清场——零残影
    return { ok: false, message: clash };
  }
  // promote：tmp 克隆整树 → 缓存（换血语义——缓存目录即该源快照真相）
  copyTree(fs, fetched.cloneDir, `${dataDir}/marketplaces/${parse.name}`);
  fs.rm(fetched.cloneDir); // tmp 清场
  const record: MarketplaceSourceRecord = {
    name: parse.name,
    sourceType: classified.sourceType, // git | github（短手形入账 github——refresh 重放同展开）
    sourceUri: source, // 用户输入原样（短手保持短手）
    catalogPath: fetched.catalogPath,
    addedAt: stamp,
    updatedAt: stamp,
    commit: fetched.commit, // berry 增位——两次 fetch 漂移防线
  };
  commitRecord(dataDir, fs, record);
  return { ok: true, record };
}

/** catalog 文本解析速记（add 位——坏形即拒，name 供撞名检查） */
function parseForAdd(
  text: string,
  label: string,
): { readonly ok: true; readonly name: string } | { readonly ok: false; readonly message: string } {
  const parse = parseMarketplaceCatalog(text, label);
  if (!parse.ok) {
    return { ok: false, message: parse.reason };
  }
  return { ok: true, name: parse.catalog.name };
}

/** 撞名检查（null = 无撞；报文含源名与 remove 指路）——信任裁决是显式动作 */
function checkNameClash(dataDir: string, fs: MarketFs, name: string): string | null {
  const read = readMarketplaceSources(dataDir, fs);
  if (!read.ok) {
    return `源清单文件坏形，拒改（${read.message}）`;
  }
  if (read.sources.some((existing) => existing.name === name)) {
    return `市场 "${name}" 已在源清单——信任裁决是显式动作，请先 remove 再 add`;
  }
  return null;
}

/** 落账（源清单原子写——读-改-写全链在调用方串行域内） */
function commitRecord(dataDir: string, fs: MarketFs, record: MarketplaceSourceRecord): void {
  const read = readMarketplaceSources(dataDir, fs);
  const base = read.ok ? read.sources : [];
  const next = addSourceRecord({ version: 1, marketplaces: base }, record);
  writeMarketplaceSources(dataDir, next.marketplaces, fs);
}
