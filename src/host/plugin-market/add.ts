/**
 * host/plugin-market/add —— add 编舞（03 §9.6 源清单与缓存节·源分类 add 解
 * 析位）：classify → 读 catalog（双路径读序）→ 撞名拒 → 缓存落位 → 源清单
 * 落账。**缓存即真相**——成功即物化，discover 读侧零网络。
 *
 * 三源分腿：
 *  - local 源：全真跑零网络（目录快照拷贝进 `<dataDir>/marketplaces/<name>/`）；
 *  - git/github 源：经 MarketFetchFace 注入位（mp-4 落真身——生产装配恒注；
 *    缺席 = 装配面未注入的诚实拒，仅嵌入式/测试装配可达）；产物整树 promote
 *    进缓存 + commit 位落账（两次 fetch 漂移防线）；
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
  /** 网络抓取位（mp-4 已落真身——生产装配恒注；缺席 = 装配面未注入诚实拒） */
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
    // 目录快照拷贝进缓存（缓存即真相——后续读侧零回源）。前置整目录清场
    // （换血同律）：撞名只查账本——账本无此名而缓存目录有残留（remove 两步
    // 中断/手删 marketplaces.json 形）时，copyTree 合并语义（只写同名不删
    // 多余）会把残留与新快照混合、上游已删内容复活进装机字节——先 rm 保
    // 「缓存 = 当前源快照」单一真相
    const cacheDir = `${dataDir}/marketplaces/${name}`;
    try {
      fs.rm(cacheDir); // 残留前置清场（幂等——缺席形不抛）
      fs.mkdir(cacheDir);
      copyTree(fs, dir, cacheDir);
    } catch (error) {
      // 落位 IO 失败（ENOSPC/EACCES 族）= result 面诚实拒 + 半缓存清场——零残影
      fs.rm(cacheDir);
      return { ok: false, message: `缓存落位失败（${error instanceof Error ? error.message : String(error)}）` };
    }
    const record: MarketplaceSourceRecord = {
      name,
      sourceType: 'local',
      sourceUri: source, // 用户输入原样
      catalogPath: loaded.catalogPath,
      addedAt: stamp,
      updatedAt: stamp,
    };
    const clashAtCommit = commitRecord(dataDir, fs, record);
    if (clashAtCommit !== null) return { ok: false, message: clashAtCommit };
    return { ok: true, record };
  }

  // —— 网络腿（git/github/url）：fetch seam 缺席诚实拒（真因 = 装配面未注入；
  // mp 收尾批修笔：mp-4 真身已落地，生产 CLI 路径恒注 fetch——此腿只剩嵌入
  // 式/测试装配省略 fetch 才可达，报文描述当下真因不再指路已落地批次）——
  if (deps.fetch === undefined) {
    return {
      ok: false,
      message: `网络源（${classified.sourceType === 'url' ? 'url' : 'git/github'}）抓取位缺席——装配面未注入 MarketFetchFace（嵌入式宿主须自注 fetch）；当前会话请用本地路径源（"./" / "~/" / 绝对路径）`,
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
    // 缓存平铺：marketplaces/<name>/marketplace.json（前置整目录清场同律
    // ——残留 JSON 不与新快照混合）
    const cacheDir = `${dataDir}/marketplaces/${parse.name}`;
    try {
      fs.rm(cacheDir); // 残留前置清场（幂等——缺席形不抛）
      fs.mkdir(cacheDir);
      fs.write(`${cacheDir}/marketplace.json`, fetched.text);
    } catch (error) {
      // 写位 IO 失败 = 诚实拒 + 半缓存清场——零残影
      fs.rm(cacheDir);
      return { ok: false, message: `缓存落位失败（${error instanceof Error ? error.message : String(error)}）` };
    }
    const record: MarketplaceSourceRecord = {
      name: parse.name,
      sourceType: 'url',
      sourceUri: source,
      catalogPath: 'marketplace.json',
      addedAt: stamp,
      updatedAt: stamp,
    };
    const clashAtCommit = commitRecord(dataDir, fs, record);
    if (clashAtCommit !== null) return { ok: false, message: clashAtCommit };
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
  // promote：tmp 克隆整树 → 缓存（换血语义——缓存目录即该源快照真相）。前置
  // 整目录清场同律：账本无此名的残留缓存不与克隆树混合；promote 中途 IO 失败
  // = 诚实拒 + tmp 克隆场/半缓存双清场——零残影
  const promoteDir = `${dataDir}/marketplaces/${parse.name}`;
  try {
    fs.rm(promoteDir); // 残留前置清场（幂等——缺席形不抛）
    fs.mkdir(promoteDir);
    copyTree(fs, fetched.cloneDir, promoteDir);
  } catch (error) {
    fs.rm(promoteDir); // 半缓存清场
    fs.rm(fetched.cloneDir); // tmp 克隆场清场
    return { ok: false, message: `缓存落位失败（${error instanceof Error ? error.message : String(error)}）` };
  }
  fs.rm(fetched.cloneDir); // tmp 清场（成功位）
  const record: MarketplaceSourceRecord = {
    name: parse.name,
    sourceType: classified.sourceType, // git | github（短手形入账 github——refresh 重放同展开）
    sourceUri: source, // 用户输入原样（短手保持短手）
    catalogPath: fetched.catalogPath,
    addedAt: stamp,
    updatedAt: stamp,
    commit: fetched.commit, // berry 增位——两次 fetch 漂移防线
  };
  const clashAtCommit = commitRecord(dataDir, fs, record);
  if (clashAtCommit !== null) return { ok: false, message: clashAtCommit };
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

/** 撞名报文单源（前置检查与落账位保底双检同词面——词面漂移即测试红） */
function nameClashMessage(name: string): string {
  return `市场 "${name}" 已在源清单——信任裁决是显式动作，请先 remove 再 add`;
}

/** 撞名检查（null = 无撞；报文含源名与 remove 指路）——信任裁决是显式动作 */
function checkNameClash(dataDir: string, fs: MarketFs, name: string): string | null {
  const read = readMarketplaceSources(dataDir, fs);
  if (!read.ok) {
    return `源清单文件坏形，拒改（${read.message}）`;
  }
  if (read.sources.some((existing) => existing.name === name)) {
    return nameClashMessage(name);
  }
  return null;
}

/**
 * 落账（源清单原子写——读-改-写全链在调用方串行域内）。返回 null = 落账
 * 成功；非 null = result 面诚实拒报文（mp 收尾批修——同源并发 add 竞态窗
 * 兜底）：checkNameClash 通过后、落账前他 add 并发插入同名 record 时，
 * addSourceRecord 的同名 throw 会裸逃出 result 面（CLI 呈现为未捕获异常）
 * ——落账位保底双检（与 mountRow 同律），撞名译为与前置检查同词面的拒。
 * 读位坏形亦拒改不落（原先 base=[] 静默洗掉既有清单——同查不拒即丢账）。
 * 拒时不回清缓存目录——竞态赢家可能已 owns 该缓存位（rm = 毁他源快照）。
 */
function commitRecord(dataDir: string, fs: MarketFs, record: MarketplaceSourceRecord): string | null {
  const read = readMarketplaceSources(dataDir, fs);
  if (!read.ok) {
    return `源清单文件坏形，拒改（${read.message}）`;
  }
  if (read.sources.some((existing) => existing.name === record.name)) {
    return nameClashMessage(record.name); // 同名竞态窗兜底——前置检查与落账非原子
  }
  const next = addSourceRecord({ version: 1, marketplaces: read.sources }, record);
  writeMarketplaceSources(dataDir, next.marketplaces, fs);
  return null;
}
