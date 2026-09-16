/**
 * host/plugin-market/install —— 装机咬合编舞（03 §9.6 装机咬合节·mp-3）。
 *
 * 一句话判据兑现：市场层一切动作最终必须塌缩为一次既有三源装机 + 一份缓存
 * 目录数据。本件只做**寻址 → 查源 → 读缓存 catalog → 翻译 → 转交
 * installPlugin**的编舞——装机执行（四件套/收割/落账/审计）恒复用既有
 * plugin-install，零新装机机制（边界钉死②）。
 *
 * 编舞序（每步失败诚实拒——不猜不静默降级）：
 *  1. 寻址解析（`name@marketplace` 词法）；
 *  2. 源清单查市场（未 add 拒——指路 marketplace add）；
 *  3. 缓存 catalog 读（record.catalogPath 单源；缺席拒——指路 remove 后
 *     重新 add）+ 解析 + 改名漂移拒（缓存自报名 ≠ 源清单名）；
 *  4. 条目查表（缺席拒——报文列在售条目名）；
 *  5. 翻译（translateEntrySource——五形 → 三源 ref + 拷贝腿参数；拒透传）；
 *  6. 转交 installPlugin：direct 腿仅带 market 注记；subdir-copy 腿带
 *     market + subdirCopy（git 语境相对源附 copyFrom = 缓存目录——缓存直
 *     拷零 spawn 腿）。
 *
 * resolveMarketLedgerId：CLI uninstall 的寻址腿——`entry@market` 寻址映射
 * 装机 id（账本 market 注记单源）；零中拒 / 恰一返回 / 多中诚实拒。
 */
import { parseMarketplaceCatalog } from './catalog.js';
import { readMarketplaceSources } from './registry.js';
import { parseMarketPluginId } from './types.js';
import { translateEntrySource } from './translate.js';
import type { MarketFs } from './types.js';
import { installPlugin } from '../plugin-install.js';
import type { InstallExecutorDeps, InstallOutcome } from '../plugin-install.js';
import type { PluginLedgerEntry } from '../plugin-store.js';

/** 装机咬合注入面：市场面 fs（源清单/缓存读）+ 装机面受局（installPlugin） */
export interface MarketInstallDeps {
  readonly dataDir: string;
  readonly fs: MarketFs;
  readonly install: InstallExecutorDeps;
}

/** 市场缓存目录（B2 定形——缓存即字节源的 local 拷贝腿锚位） */
function marketCacheDir(dataDir: string, marketplace: string): string {
  return `${dataDir}/marketplaces/${marketplace}`;
}

/**
 * 市场装机编舞主入口：`marketplace install <name>@<marketplace>` → 既有
 * installPlugin（InstallOutcome 直通——CLI 呈现语义与 plugins install 同源）。
 */
export async function marketInstall(deps: MarketInstallDeps, id: string): Promise<InstallOutcome> {
  // ① 寻址解析（词法坏 = 用法级拒——报文指路 name@marketplace 形）
  const addr = parseMarketPluginId(id);
  if (addr === null) {
    return {
      ok: false,
      message: `市场寻址形坏（"${id}"）——形如 name@marketplace（条目名@市场名，两段各过名段词法）`,
    };
  }

  // ② 源清单查市场（零网络——缓存即真相）
  const sourcesRead = readMarketplaceSources(deps.dataDir, deps.fs);
  if (!sourcesRead.ok) {
    return { ok: false, message: `源清单文件坏形：${sourcesRead.message}——装机拒猜（03 §9.6）` };
  }
  const record = sourcesRead.sources.find((r) => r.name === addr.marketplace);
  if (record === undefined) {
    return {
      ok: false,
      message: `市场 "${addr.marketplace}" 不在源清单——先 berry marketplace add <源>（在册清单见 berry marketplace list）`,
    };
  }

  // ③ 缓存 catalog 读 + 解析 + 改名漂移拒（读位单源 = record.catalogPath）
  const cacheDir = marketCacheDir(deps.dataDir, addr.marketplace);
  const catalogText = deps.fs.read(`${cacheDir}/${record.catalogPath}`);
  if (catalogText === null) {
    return {
      ok: false,
      message: `市场 "${addr.marketplace}" 缓存缺席（${record.catalogPath} 读不到）——先 berry marketplace remove ${addr.marketplace} 后重新 add`,
    };
  }
  const parsed = parseMarketplaceCatalog(catalogText, `${addr.marketplace}/${record.catalogPath}`);
  if (!parsed.ok) {
    return {
      ok: false,
      message: `市场 "${addr.marketplace}" catalog 坏形：${parsed.reason}——先 marketplace remove 后重新 add`,
    };
  }
  if (parsed.catalog.name !== record.name) {
    return {
      ok: false,
      message: `市场 "${addr.marketplace}" 缓存 catalog 自报名 "${parsed.catalog.name}" 与源清单名不符——市场疑似改名漂移，先 marketplace remove 后按新名重新 add`,
    };
  }

  // ④ 条目查表（缺席拒——列在售名单供用户对拍寻址）
  const entry = parsed.catalog.plugins.find((p) => p.name === addr.name);
  if (entry === undefined) {
    const onSale = parsed.catalog.plugins.map((p) => p.name).join('、');
    return {
      ok: false,
      message: `市场 "${addr.marketplace}" 无条目 "${addr.name}"——在售条目：${onSale.length > 0 ? onSale : '（空 catalog）'}`,
    };
  }

  // ⑤ 翻译（五形 → 三源 ref + 拷贝腿参数；语境全注入无全局态）
  const translated = translateEntrySource({
    entrySource: entry.source,
    pluginRoot: parsed.catalog.metadata?.pluginRoot,
    marketplaceSourceType: record.sourceType,
    marketplaceUri: record.sourceUri,
    ...(record.commit !== undefined ? { catalogCommit: record.commit } : {}),
    marketCacheDir: cacheDir,
  });
  if (!translated.ok) {
    return { ok: false, message: `条目 "${addr.name}@${addr.marketplace}" 源翻译拒：${translated.message}` };
  }

  // ⑥ 转交 installPlugin（唯一装机入口——编舞恒复用零新机制）
  const market = { name: addr.marketplace, entry: addr.name };
  if (translated.target.leg === 'direct') {
    return installPlugin(deps.install, translated.target.ref, { market });
  }
  // 拷贝腿：git/github 语境相对源条目附 copyFrom = 缓存目录（缓存直拷零
  // spawn——commit 取 ref 钉的 catalog sha）；git-subdir 独立仓形不带
  // copyFrom（tmp 克隆抽拷腿）
  const fromCache = typeof entry.source === 'string' && (record.sourceType === 'git' || record.sourceType === 'github');
  return installPlugin(deps.install, translated.target.ref, {
    market,
    subdirCopy: {
      subpath: translated.target.subpath ?? '',
      ...(fromCache ? { copyFrom: cacheDir } : {}),
    },
  });
}

/**
 * 市场寻址 → 装机 id 映射（CLI `marketplace uninstall` 寻址腿）：账本 market
 * 注记单源匹配（entry@market ↔ {name: market, entry: entry}）。零中拒（指路
 * marketplace install）/ 恰一返回 / 多中诚实拒（同名条目多装机并存——指路
 * `plugins uninstall <id>` 按装机 id 点名）。
 */
export function resolveMarketLedgerId(
  entries: readonly PluginLedgerEntry[],
  addr: { readonly name: string; readonly marketplace: string },
): { readonly ok: true; readonly id: string } | { readonly ok: false; readonly message: string } {
  const matches = entries.filter(
    (e) => e.market !== undefined && e.market.name === addr.marketplace && e.market.entry === addr.name,
  );
  if (matches.length === 0) {
    return {
      ok: false,
      message: `市场寻址 "${addr.name}@${addr.marketplace}" 无装机条目——装机走 berry marketplace install ${addr.name}@${addr.marketplace}`,
    };
  }
  if (matches.length > 1) {
    const ids = matches.map((e) => e.id).join('、');
    return {
      ok: false,
      message: `市场寻址 "${addr.name}@${addr.marketplace}" 命中多个装机条目（${ids}）——按装机 id 点名走 berry plugins uninstall <id>`,
    };
  }
  return { ok: true, id: matches[0]!.id };
}
