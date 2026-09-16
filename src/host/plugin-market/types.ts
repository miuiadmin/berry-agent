/**
 * host/plugin-market/types — 市场层读侧契约面（03 §9.6 mp-2 读侧核心批；
 * 裁决真源 00-立题-marketplace完整聚合仓-20260916）。
 *
 * 市场层 = host 子件目录服务（承 plugin-tools/testkit 先例——零 DAG 席位
 * 变化）：读外源 catalog → 聚合呈现 → 翻译为三源 ref →（mp-3）既有
 * installPlugin 编舞。本件只钉**数据契约**：
 *  - 名段词法（adopt omp 规则——与 berry checkPluginId 同域不同律：多允许
 *    点号，外源名字域宽容；装机时 berry 侧 id 词法由插件清单自身承载 §1.2）；
 *  - catalog 兼容形（Claude/omp 双生态同形——只读 adopt 不发明格式）；
 *  - 条目源五形（npm / github / url / git-subdir / 相对串）；
 *  - 源清单条目形（marketplaces.json——文件域账本不进 SQLite）；
 *  - 翻译产物形（三源 ref + 可选子目录拷贝腿参数）。
 *
 * 未知字段保留不拒（前向兼容——catalog 是外源数据，不适用 berry 拒绝式
 * 清单校验；omp 扩展字段零解读零拒绝——非 berry 契约面）。解析产物持原
 * 对象引用（不重建），未知字段天然随行。
 */

/* ---------------- 名段词法（§9.6 catalog 兼容形·adopt omp Naming rules） ---------------- */

/**
 * 名段正则：小写字母/数字/连字符/点，首尾字母数字（单字符合法——可选组
 * 仅约束两字符以上形）。adopt omp `NAME_RE` 逐字符同形——外源名字域宽容
 * （多允许点号，如 `wordpress.com`）；与 berry `checkPluginId`（禁点号）
 * 同域不同律，装机时 berry 侧 id 词法由插件清单自身承载。
 */
const NAME_SEGMENT_RE = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;

/** 名段长度帽（adopt omp——64 字符） */
export const MAX_NAME_SEGMENT_LENGTH = 64;

/** 寻址 id（`name@marketplace`）总长帽（adopt omp——128 字符） */
export const MAX_MARKET_PLUGIN_ID_LENGTH = 128;

/**
 * 名段校验（市场名与条目名同律）。必拒例（omp docs Naming rules 全例收编）：
 * `-bad` / `bad-` / `.bad` / `Bad` / `under_score`；合法例：`my-plugin` /
 * `code-review` / `wordpress.com` / `ai-firstify` / 单字符 `a`。
 */
export function isValidNameSegment(name: string): boolean {
  return name.length > 0 && name.length <= MAX_NAME_SEGMENT_LENGTH && NAME_SEGMENT_RE.test(name);
}

/**
 * 构造寻址 id：`name@marketplace`（install/uninstall 寻址形——两段各自过
 * 名段词法 + 总长帽；拒即抛——调用方（CLI 解析层）前置 catch 呈现用法错）。
 */
export function buildMarketPluginId(name: string, marketplace: string): string {
  if (!isValidNameSegment(name)) {
    throw new Error(`条目名坏词法（"${name}"）——小写字母数字连字符点、首尾字母数字、≤${MAX_NAME_SEGMENT_LENGTH} 字符`);
  }
  if (!isValidNameSegment(marketplace)) {
    throw new Error(
      `市场名坏词法（"${marketplace}"）——小写字母数字连字符点、首尾字母数字、≤${MAX_NAME_SEGMENT_LENGTH} 字符`,
    );
  }
  const id = `${name}@${marketplace}`;
  if (id.length > MAX_MARKET_PLUGIN_ID_LENGTH) {
    throw new Error(`寻址 id 超 ${MAX_MARKET_PLUGIN_ID_LENGTH} 字符帽（"${id}"）`);
  }
  return id;
}

/** 寻址 id 解析（`name@marketplace` → 两段；lastIndexOf 兼容条目名含 @ 的容错边界——词法拒后 null） */
export function parseMarketPluginId(id: string): { readonly name: string; readonly marketplace: string } | null {
  const at = id.lastIndexOf('@');
  if (at <= 0 || at === id.length - 1) return null;
  const name = id.slice(0, at);
  const marketplace = id.slice(at + 1);
  if (!isValidNameSegment(name) || !isValidNameSegment(marketplace)) return null;
  return { name, marketplace };
}

/* ---------------- catalog 兼容形（只读 adopt——不发明格式） ---------------- */

/** catalog 级 owner 块（必填 name；email 可选——人名域不过名段词法） */
export interface MarketplaceCatalogOwner {
  readonly name: string;
  readonly email?: string;
}

/** catalog 级 metadata 块（全可选；pluginRoot = 相对源路径前缀改写位——monorepo 布局用） */
export interface MarketplaceCatalogMetadata {
  readonly description?: string;
  readonly version?: string;
  readonly pluginRoot?: string;
}

/** 条目作者块（可选） */
export interface MarketplacePluginAuthor {
  readonly name: string;
  readonly email?: string;
}

/**
 * 条目源五形（§9.6 翻译矩阵左列——adopt omp PluginSource 形）：
 *  1. 相对串 `"./plugins/foo"`（市场仓内子目录——git/local 语境分立见翻译层）；
 *  2. `{source:'github', repo, ref?, sha?}`（GitHub owner/repo 短手）；
 *  3. `{source:'url', url, ref?, sha?}`（git 克隆 url）；
 *  4. `{source:'git-subdir', url, path, ref?, sha?}`（独立仓 + 子目录拷贝腿）；
 *  5. `{source:'npm', package, version?}`（npm 生态主道）。
 */
export type MarketEntrySource =
  | string
  | { readonly source: 'github'; readonly repo: string; readonly ref?: string; readonly sha?: string }
  | { readonly source: 'url'; readonly url: string; readonly ref?: string; readonly sha?: string }
  | {
      readonly source: 'git-subdir';
      readonly url: string;
      readonly path: string;
      readonly ref?: string;
      readonly sha?: string;
    }
  | { readonly source: 'npm'; readonly package: string; readonly version?: string };

/**
 * catalog 条目（已知可选面 + 未知字段随原对象保留）。必填最小集 = `name` +
 * `source`（§9.6 条目级必填）；strict/commands/hooks 等外源扩展字段零解读
 * 零拒绝（非 berry 契约面）。
 */
export interface MarketplacePluginEntry {
  readonly name: string;
  readonly source: MarketEntrySource;
  readonly description?: string;
  readonly version?: string;
  readonly author?: MarketplacePluginAuthor;
  readonly homepage?: string;
  readonly repository?: string;
  readonly license?: string;
  readonly keywords?: readonly string[];
  readonly category?: string;
  readonly tags?: readonly string[];
}

/** catalog 文档形（必填最小集：name + owner.name + plugins[]——§9.6 catalog 级必填） */
export interface MarketplaceCatalog {
  readonly name: string;
  readonly owner: MarketplaceCatalogOwner;
  readonly metadata?: MarketplaceCatalogMetadata;
  readonly plugins: readonly MarketplacePluginEntry[];
}

/* ---------------- 源清单账本（marketplaces.json——文件域，不进 SQLite） ---------------- */

/** 源分类四值（§9.6 源分类五规则序产物——github/git/url/local） */
export type MarketplaceSourceType = 'github' | 'git' | 'url' | 'local';

/**
 * 源清单条目（omp 同形 + berry 增 `commit` 位）：name = catalog 自报名
 * （add 时锁定）；sourceUri = 用户输入原样（短手/URL/路径）；catalogPath =
 * 双路径读序命中的相对路径（`.omp-plugin/marketplace.json` 形 / URL 源缓存
 * 平铺 `marketplace.json`）；addedAt/updatedAt = ISO 8601（注入时钟单源）；
 * commit = git 源 fetch 时锁定的 catalog commit（缓解「两次 fetch 同
 * sourceUri 可得不同 catalog」漂移面——URL/local 源缺席）。
 */
export interface MarketplaceSourceRecord {
  readonly name: string;
  readonly sourceType: MarketplaceSourceType;
  readonly sourceUri: string;
  readonly catalogPath: string;
  readonly addedAt: string;
  readonly updatedAt: string;
  readonly commit?: string;
}

/** 源清单文档形（文件顶层 version: 1 + 条目数组——omp 同形） */
export interface MarketplaceSourcesFile {
  readonly version: 1;
  readonly marketplaces: readonly MarketplaceSourceRecord[];
}

/* ---------------- 翻译产物形（五形 → 三源 ref 矩阵——§9.6） ---------------- */

/**
 * 翻译产物（市场层唯一「新机制」的纯函数面）：`ref` 与 CLI `plugins install`
 * 同词法单源往返（parsePluginRef 零第二词法——mp-2 测试锁往返一致）；拷贝
 * 腿在场时 `subpath` 指向 ref 所指仓/目录内的子目录（git-subdir 独立仓形 /
 * 相对串 git 语境市场仓形 / 相对串 local 语境缓存目录形三腿共用——mp-3 装
 * 机咬合消费：staging 拷贝 + rename 落位 `plugins/market/<market>/<entry>/`）。
 */
export interface TranslatedInstallTarget {
  /** 三源 ref（`npm:<pkg>[@<ver>]` | `git:<url>[#<ref|sha>]` | `local:<abs>`） */
  readonly ref: string;
  /** 拷贝腿子目录（相对仓/目录根；direct 腿缺席） */
  readonly subpath?: string;
  /** 装机腿形：direct = ref 直装既有三源执行器；subdir-copy = 子目录拷贝腿（mp-3） */
  readonly leg: 'direct' | 'subdir-copy';
}

/* ---------------- 注入面（mp-2 零网络纪律——一切 I/O 可注入） ---------------- */

/**
 * 文件系统注入面（市场层自有——与 PluginStoreFs 面不同源不互用）：read 缺席
 * 返 null（不抛）；readdir 缺席返 null；rm 递归；isDir 目录性判定（local 源
 * 目录快照拷贝腿用）。缺省真身 = fs.ts createMarketFs（node:fs 包装）。
 */
export interface MarketFs {
  /** 读文本文件；缺席返 null */
  read(path: string): string | null;
  /** 写文本文件（实现自责建父目录） */
  write(path: string, text: string): void;
  /** 改名（同卷原子；市场层只用于账本 tmp+rename 原子写） */
  rename(from: string, to: string): void;
  /** 递归建目录 */
  mkdir(path: string): void;
  /** 递归删除（force——缺席不抛） */
  rm(path: string): void;
  /** 列目录名；缺席返 null；空目录返 [] */
  readdir(path: string): string[] | null;
  /** 目录性判定（缺席 = false） */
  isDir(path: string): boolean;
}

/**
 * 网络抓取注入面（mp-4 落真身——mp-2 只钉契约与缺席语义）：
 *  - fetchGitCatalog：克隆市场仓到临时目录（真身走 `git clone`/浅克隆），
 *    双路径读序命中 catalog 后回报命中路径 + 锁定 commit；产物**必须物化到
 *    MarketFs**（cloneDir 树在 fs 上可读——add 编舞靠它 promote 整树进缓存）；
 *  - fetchUrlCatalog：拉单 JSON 文本（URL 源只存 catalog 平铺、无仓结构）。
 * 缺席时 git/github/url 源 add 诚实拒（零网络出厂——不静默降级）。
 */
export interface MarketFetchFace {
  /** 克隆市场仓并定位 catalog；commit = 本次 fetch 锁定的 catalog commit */
  fetchGitCatalog(url: string): Promise<{
    readonly cloneDir: string;
    readonly catalogPath: string;
    readonly text: string;
    readonly commit: string;
  }>;
  /** 拉单文件 catalog 文本 */
  fetchUrlCatalog(url: string): Promise<{ readonly text: string }>;
}

/**
 * 翻译输入（translateEntrySource 单参形——语境信息显式注入，无全局态）：
 * entrySource = catalog 条目源五形；pluginRoot = catalog metadata 相对源
 * 前缀改写位；marketplaceSourceType/Uri = 源清单语境（相对串翻译分叉位）；
 * catalogCommit = git 源 fetch 时锁定的 commit（相对串 git 语境 ref 锁位）；
 * marketCacheDir = 缓存目录绝对路径（相对串 local 语境 ref 锚位）。
 */
export interface TranslateInput {
  readonly entrySource: MarketEntrySource;
  readonly pluginRoot?: string;
  readonly marketplaceSourceType: MarketplaceSourceType;
  readonly marketplaceUri: string;
  readonly catalogCommit?: string;
  readonly marketCacheDir: string;
}

/* ---------------- 聚合呈现形（discover 读侧产物——缓存即真相，零网络） ---------------- */

/** 条目级跳过账（catalog 条目坏形 warn 跳过的逐条报文——name 缺席时只有原因） */
export interface CatalogSkipNote {
  readonly name?: string;
  readonly reason: string;
}

/** 聚合呈现条目（id = `name@marketplace` 寻址形；version = 四级回落产物） */
export interface DiscoveredMarketEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string;
}

/** 聚合呈现单源行：ok/stale（条目照列，stale 供 CLI 提示刷新）/skipped（该源缺席席） */
export interface DiscoveredMarketSource {
  /** 市场名（源清单坏形降级行为空串） */
  readonly marketplace: string;
  readonly status: 'ok' | 'skipped' | 'stale';
  readonly entries: readonly DiscoveredMarketEntry[];
  readonly skippedEntries: readonly CatalogSkipNote[];
  /** skipped 行的原因（点名源与处置指路） */
  readonly skippedReason?: string;
}

/** 聚合呈现结果（零源出厂 = 空数组——不报错） */
export interface DiscoveryResult {
  readonly sources: readonly DiscoveredMarketSource[];
}
