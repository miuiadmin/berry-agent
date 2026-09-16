/**
 * host/marketplace-cmd — `marketplace` 子命令族 CLI 入口（03 §9.6 市场层
 * CLI 面；07 §5 命令族 berry marketplace 行·mp-3 落码、mp-4 网络源接线）。
 *
 * 六动词落地面 + 两合法解析形：
 *  - **add/remove**：源清单信任裁决（add 编舞复用 plugin-market/add——local
 *    源零网络、git/url 源走 fetch 真身〔mp-4：ssrf-guard 消费律 + 传输帽〕；
 *    remove 删源 + 清缓存目录——装机物独立落位不受影响〔B2 定形〕）；
 *  - **list**：源清单 + 逐源条目计数（聚合读侧 discoverMarketplaces——缓存
 *    即真相零网络）；
 *  - **discover**：条目聚合呈现（`name@market` 寻址形；可选单源过滤）——
 *    自由文本（description/跳过原因）经控制字符消毒，防 catalog 提示注入
 *    行结构（条目名已被名段词法上游执法）；
 *  - **install**：装机咬合编舞（plugin-market/install——恒复用既有
 *    installPlugin 零新装机机制）+ 两步制尾行（装机 ≠ 启用——mount 指路）；
 *  - **uninstall**：双相映射（§5.5 语义全继承：无 --confirm = inspect /
 *     --confirm = execute；--data 单独在场即拒）——寻址腿 resolveMarketLedgerId
 *    （entry@market → 装机 id）后走既有四段清算；
 *  - **update**（mp-4）：手动档整源刷新（单源点名/全量；up-to-date 判据 +
 *    updatedAt 重置 TTL——逐源独立结局，任一失败退 1）；
 *  - **upgrade**（mp-4）：catalog 对拍 + 换装分派（单件点名 = force 换血
 *    重装；全量 = market 注记装机逐件对拍 try 跳败；24h TTL 惰性门控——
 *    鲜缓存零网络；rejected/任一 failed 退 1）。
 *
 * 退出码：0 成功 / 1 执行失败或语义拒 / 用法错 2 归解析层。
 */
import { homedir } from 'node:os';
import { join } from 'node:path';
import { stdout as processStdout, stderr as processStderr } from 'node:process';

import { Persistence, createAuditFace, resolveDataDir } from '../persist/index.js';

import type { MarketplaceCommand } from './cli.js';
import {
  addMarketplaceSource,
  createMarketFetchFace,
  createMarketFs,
  discoverMarketplaces,
  parseMarketPluginId,
  readMarketplaceSources,
  removeSourceRecord,
  updateMarketplaceSources,
  upgradeMarketplacePlugins,
  writeMarketplaceSources,
} from './plugin-market/index.js';
import { marketInstall, resolveMarketLedgerId } from './plugin-market/install.js';
import { createDefaultSpawnRunner } from './plugin-install.js';
import type { InstallExecutorDeps } from './plugin-install.js';
import { executeUninstall, inspectUninstall } from './plugin-uninstall.js';
import type { UninstallDataAction, UninstallDeps } from './plugin-uninstall.js';
import { createPluginStoreFs, readLedger } from './plugin-store.js';
import type { LifecycleAuditSink } from './plugin-store.js';
import { HOST_MIGRATION_TAIL } from './runtime.js';
import type { MarketFetchFace } from './plugin-market/types.js';

/** 入口选项（main 分派接线 + 测试注入面——e2e 唯一 mock 位即 writeOut/writeErr/fetch） */
export interface MarketplaceEntryOptions {
  /** 数据目录（缺省 resolveDataDir()——env 梯子 BERRY_AGENT_DATA_DIR 由此接通） */
  readonly dataDir?: string;
  /** env 面（缺省 process.env——装机执行器 min-release-age 解析源之一） */
  readonly env?: Record<string, string | undefined>;
  /**
   * 网络抓取位注入（缺省 createMarketFetchFace 真身——git/url 源 add 与
   * update/upgrade 刷新腿消费；测试注假件保 e2e 零网络）
   */
  readonly fetch?: MarketFetchFace;
  /** 输出面（缺省 process.stdout——测试注入） */
  readonly writeOut?: (text: string) => void;
  /** 错误面（缺省 process.stderr——测试注入） */
  readonly writeErr?: (text: string) => void;
}

/** 呈现消毒：剥 C0/C1 控制字符（含换行与 ANSI 转义首字节）——防 catalog 自由文本注入行结构 */
function sanitizeLine(text: string): string {
  // eslint-disable-next-line no-control-regex -- 呈现面消毒恰是控制字符的执法位
  return text.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
}

/** marketplace 子命令族主入口。返回进程退出码（0/1；用法错 2 归解析层） */
export async function runMarketplaceEntry(sub: MarketplaceCommand, options: MarketplaceEntryOptions): Promise<number> {
  switch (sub.sub) {
    case 'add':
      return runAdd(sub.source, options);
    case 'remove':
      return runRemove(sub.name, options);
    case 'list':
      return runList(options);
    case 'discover':
      return runDiscover(sub.name, options);
    case 'install':
      return runInstall(sub.id, options);
    case 'uninstall':
      return runUninstall(sub.id, sub.confirm, sub.dataAction, options);
    case 'update':
      return runUpdate(sub.name, options);
    case 'upgrade':
      return runUpgrade(sub.id, options);
  }
}

/** add <源>：源清单信任裁决（local 源零网络；git/url 源走 fetch 真身——mp-4） */
async function runAdd(source: string, options: MarketplaceEntryOptions): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  const added = await addMarketplaceSource(
    {
      dataDir,
      fs: createMarketFs(),
      now: () => new Date(),
      // 网络抓取真身（mp-4：ssrf-guard 消费律 + 传输帽 + 克隆帽）；home 供 local `~` 展开
      fetch: options.fetch ?? createMarketFetchFace(),
      home: homedir(),
    },
    source,
  );
  if (!added.ok) {
    writeErr(added.message);
    return 1;
  }
  writeOut(
    `已添加市场源：${added.record.name}（${added.record.sourceType}，${added.record.sourceUri}）——条目发现走 berry marketplace discover`,
  );
  return 0;
}

/** remove <名>：删源 + 清缓存目录（装机物独立落位不受影响——B2 定形） */
function runRemove(name: string, options: MarketplaceEntryOptions): number {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  const fs = createMarketFs();
  const read = readMarketplaceSources(dataDir, fs);
  if (!read.ok) {
    writeErr(`源清单文件坏形，拒改：${read.message}`);
    return 1;
  }
  let next: ReturnType<typeof removeSourceRecord>;
  try {
    next = removeSourceRecord({ version: 1, marketplaces: read.sources }, name);
  } catch (err) {
    writeErr(err instanceof Error ? err.message : String(err)); // 点名失败诚实（查无不静默幂等）
    return 1;
  }
  writeMarketplaceSources(dataDir, next.marketplaces, fs);
  fs.rm(join(dataDir, 'marketplaces', name)); // 缓存清场（force——幂等）
  writeOut(`已移除市场源：${name}（缓存目录已清——装机物独立落位不受影响，溯源注记账本照旧）`);
  return 0;
}

/** list：源清单 + 逐源条目计数（聚合读侧——缓存即真相零网络） */
function runList(options: MarketplaceEntryOptions): number {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  const fs = createMarketFs();
  const read = readMarketplaceSources(dataDir, fs);
  if (!read.ok) {
    writeErr(`源清单文件坏形：${read.message}`);
    return 1;
  }
  if (read.sources.length === 0) {
    writeOut('零市场源——添加走 berry marketplace add <源（本地路径 / git 短手 / URL）>');
    return 0;
  }
  const lines: string[] = ['市场源：'];
  for (const record of read.sources) {
    // 逐源条目计数（单源聚合——skipped 源计 0 并注原因）
    const result = discoverMarketplaces({ dataDir, fs, now: () => new Date() }, record.name);
    const row = result.sources[0];
    const count = row !== undefined && row.status !== 'skipped' ? row.entries.length : 0;
    const note =
      row !== undefined && row.status === 'skipped' ? `——跳过（${sanitizeLine(row.skippedReason ?? '')}）` : '';
    lines.push(`  ${record.name}  ${record.sourceType}  ${sanitizeLine(record.sourceUri)}  条目 ${count}${note}`);
  }
  lines.push('条目呈现走 berry marketplace discover [<市场名>]');
  writeOut(lines.join('\n'));
  return 0;
}

/** discover [<市场名>]：条目聚合呈现（寻址形 + 版本 + 描述——呈现消毒） */
function runDiscover(name: string | undefined, options: MarketplaceEntryOptions): number {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  const fs = createMarketFs();
  const result = discoverMarketplaces({ dataDir, fs, now: () => new Date() }, name);
  if (result.sources.length === 0) {
    writeOut(`市场 "${name}" 不在源清单——在册清单见 berry marketplace list`);
    return 0;
  }
  const lines: string[] = ['市场条目（寻址形 name@market）：'];
  for (const source of result.sources) {
    if (source.status === 'skipped') {
      lines.push(
        `  ${source.marketplace.length > 0 ? source.marketplace : '(未具名)'} 跳过：${sanitizeLine(source.skippedReason ?? '')}`,
      );
      continue;
    }
    const freshness = source.status === 'stale' ? '，缓存偏旧（离线照用；刷新走 berry marketplace update）' : '';
    lines.push(`  ${source.marketplace}（${source.entries.length} 条目${freshness}）：`);
    for (const entry of source.entries) {
      const desc = entry.description !== undefined ? `  ${sanitizeLine(entry.description)}` : '';
      lines.push(`    ${entry.id}  ${entry.version}${desc}`);
    }
    for (const skip of source.skippedEntries) {
      const who = skip.name !== undefined ? `条目 "${skip.name}"` : '条目';
      lines.push(`    （跳过）${who}：${sanitizeLine(skip.reason)}`);
    }
  }
  writeOut(lines.join('\n'));
  return 0;
}

/**
 * 生命周期归因账真身（plugins-cmd lifecycleAuditOf 同律——本件独立构造：
 * 惰性开库 sink + 调用层 finally close；dbPath 显式随 dataDir）。落账失败
 * warn 不阻塞主流程。
 */
function marketAuditOf(
  options: MarketplaceEntryOptions,
  writeErr: (text: string) => void,
): { readonly sink: LifecycleAuditSink; readonly close: () => Promise<void> } {
  let persistence: Persistence | undefined;
  return {
    sink: (type, data) => {
      try {
        if (persistence === undefined) {
          // dbPath 显式随 dataDir（同 plugins-cmd lifecycleAuditOf——Persistence
          // 的 dbPath/dataDir 分立解析，缺省 dbPath 走 env 梯子不随 dataDir
          // 选项；CLI 语义 = --data-dir 指到哪库就在哪）
          persistence = Persistence.open({
            ...(options.dataDir !== undefined
              ? { dataDir: options.dataDir, dbPath: join(options.dataDir, 'sessions.db') }
              : {}),
            migrations: HOST_MIGRATION_TAIL,
            warn: (message) => writeErr(`warn：${message}`),
          });
        }
        createAuditFace(persistence.store.sqlite()).append(type, data);
      } catch (err) {
        writeErr(
          `warn：生命周期审计落账失败（${type}）：${err instanceof Error ? err.message : String(err)}——主流程不受影响`,
        );
      }
    },
    close: async () => {
      if (persistence !== undefined) {
        const closing = persistence;
        persistence = undefined;
        await closing.close();
      }
    },
  };
}

/** install <name@market>：装机咬合编舞（恒复用 installPlugin）+ 两步制尾行 */
async function runInstall(id: string, options: MarketplaceEntryOptions): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  const audit = marketAuditOf(options, writeErr);
  try {
    const install: InstallExecutorDeps = {
      dataDir,
      fs: createPluginStoreFs(),
      spawn: createDefaultSpawnRunner(),
      env: options.env ?? process.env,
      onLifecycleAudit: audit.sink,
    };
    const outcome = await marketInstall({ dataDir, fs: createMarketFs(), install }, id);
    if (!outcome.ok) {
      writeErr(outcome.message);
      return 1;
    }
    writeOut(outcome.text);
    // 两步制尾行（与 plugins install 同律）：装机 ≠ 启用——mount 指路（可直复制执行）
    writeOut(`装机 ≠ 启用——启用第二步：berry plugins mount ${outcome.entry.id}（mount 后下次启动装载生效）`);
    return 0;
  } finally {
    await audit.close();
  }
}

/**
 * uninstall <name@market>：双相映射（§5.5 语义全继承）——寻址腿解析装机 id
 * 后走既有四段清算；开库 Persistence 直开 + 迁移链尾单源（uninstall 零装配
 * 直开库纪律）；--data 单独在场即拒（execute 载荷不静默猜）。
 */
async function runUninstall(
  id: string,
  confirm: boolean,
  dataAction: UninstallDataAction | undefined,
  options: MarketplaceEntryOptions,
): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  // 寻址词法（坏形 = CLI 语义错退 1——与解析层用法错退 2 分立档）
  const addr = parseMarketPluginId(id);
  if (addr === null) {
    writeErr(`市场寻址形坏（"${id}"）——形如 name@marketplace（条目名@市场名）`);
    return 1;
  }
  if (dataAction !== undefined && !confirm) {
    writeErr('--data 是 execute 载荷——须与 --confirm 同场（无 --confirm 即 inspect 只读报告，不携带数据处置）');
    return 1;
  }
  const dataDir = options.dataDir ?? resolveDataDir();
  const ledgerRead = readLedger(dataDir, createPluginStoreFs());
  if (!ledgerRead.ok) {
    writeErr(`装机账本损坏：${ledgerRead.reason}——拒猜（03 §5.4）`);
    return 1;
  }
  const resolved = resolveMarketLedgerId(ledgerRead.entries, addr);
  if (!resolved.ok) {
    writeErr(resolved.message);
    return 1;
  }
  // Persistence 直开（dbPath 显式随 dataDir——plugins uninstall 同律）
  const persistence = Persistence.open({
    ...(options.dataDir !== undefined
      ? { dataDir: options.dataDir, dbPath: join(options.dataDir, 'sessions.db') }
      : {}),
    migrations: HOST_MIGRATION_TAIL,
    warn: (message) => writeErr(`warn：${message}`),
  });
  try {
    const deps: UninstallDeps = { dataDir, fs: createPluginStoreFs(), db: persistence.store.sqlite() };
    const outcome = confirm
      ? executeUninstall(deps, resolved.id, dataAction ?? 'keep') // 缺省 keep——execute 不静默猜 purge
      : inspectUninstall(deps, resolved.id);
    if (!outcome.ok) {
      writeErr(outcome.message);
      return 1;
    }
    writeOut(outcome.text);
    return 0;
  } finally {
    await persistence.close();
  }
}

/**
 * update [<市场名>]：手动档整源刷新（mp-4——auto-update 仅手动档拍板 P7）。
 * 点名缺席退 1（指路 list）；全量逐源独立结局——任一 failed 退 1（其余源
 * 照常呈现）；零源退 0。
 */
async function runUpdate(name: string | undefined, options: MarketplaceEntryOptions): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  let result: Awaited<ReturnType<typeof updateMarketplaceSources>>;
  try {
    result = await updateMarketplaceSources(
      {
        dataDir,
        fs: createMarketFs(),
        fetch: options.fetch ?? createMarketFetchFace(),
        now: () => new Date(),
        home: homedir(),
      },
      name,
    );
  } catch (error) {
    // 源清单文件坏形等清单级硬拒——拒猜（03 §9.6）
    writeErr(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (result.missingName !== null) {
    writeErr(`市场 "${result.missingName}" 不在源清单——在册清单见 berry marketplace list`);
    return 1;
  }
  if (result.outcomes.length === 0) {
    writeOut('零市场源——添加走 berry marketplace add <源（本地路径 / git 短手 / URL）>');
    return 0;
  }
  const lines: string[] = [];
  let failed = false;
  for (const outcome of result.outcomes) {
    if (outcome.status === 'updated') {
      const commit = outcome.commit !== undefined ? `，commit ${outcome.commit.slice(0, 7)}` : '';
      lines.push(`  已刷新：${outcome.name}（${outcome.entryCount} 条目${commit}）`);
    } else if (outcome.status === 'up-to-date') {
      lines.push(`  已是最新：${outcome.name}`);
    } else {
      failed = true;
      lines.push(`  刷新失败：${outcome.name}——${sanitizeLine(outcome.message)}`);
    }
  }
  writeOut(lines.join('\n'));
  return failed ? 1 : 0;
}

/**
 * upgrade [<name@marketplace>]：catalog 对拍 + 换装分派（mp-4——「拉最新」
 * 唯经本动词）。单件点名 = force 换血重装；全量 = 逐件对拍 try 跳败（部分
 * 成功语义）；rejected/任一 failed 退 1；零市场装机物退 0。刷新腿 24h TTL
 * 惰性门控（鲜缓存零网络）；刷新失败不拒整批——warn 注记 + 既有缓存对拍。
 */
async function runUpgrade(id: string | undefined, options: MarketplaceEntryOptions): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  const ledgerRead = readLedger(dataDir, createPluginStoreFs());
  if (!ledgerRead.ok) {
    writeErr(`装机账本损坏：${ledgerRead.reason}——拒猜（03 §5.4）`);
    return 1;
  }
  const audit = marketAuditOf(options, writeErr);
  try {
    const install: InstallExecutorDeps = {
      dataDir,
      fs: createPluginStoreFs(),
      spawn: createDefaultSpawnRunner(),
      env: options.env ?? process.env,
      onLifecycleAudit: audit.sink,
    };
    const result = await upgradeMarketplacePlugins(
      {
        dataDir,
        fs: createMarketFs(),
        fetch: options.fetch ?? createMarketFetchFace(),
        now: () => new Date(),
        home: homedir(),
        install,
        ledger: ledgerRead.entries,
      },
      id,
    );
    if (result.rejected !== null) {
      writeErr(result.rejected);
      return 1;
    }
    // 刷新失败注记（对拍降级走既有缓存——离线 OK，不拒整批）
    for (const note of result.refreshFailures) {
      writeErr(`warn：市场刷新失败（${sanitizeLine(note)}）——按既有缓存对拍`);
    }
    if (result.outcomes.length === 0) {
      writeOut('零市场装机物——装机走 berry marketplace install <name@market>');
      return 0;
    }
    const lines: string[] = [];
    let failed = false;
    for (const outcome of result.outcomes) {
      if (outcome.status === 'upgraded') {
        const versions =
          outcome.from !== undefined || outcome.to !== undefined
            ? `（${outcome.from ?? '?'} → ${outcome.to ?? '?'}）`
            : '';
        lines.push(`  已升级：${outcome.id}${versions}`);
      } else if (outcome.status === 'current') {
        const version = outcome.version !== undefined ? `（${sanitizeLine(outcome.version)}）` : '';
        lines.push(`  已是最新：${outcome.id}${version}`);
      } else if (outcome.status === 'skipped') {
        lines.push(`  跳过：${outcome.id}——${sanitizeLine(outcome.reason)}`);
      } else {
        failed = true;
        lines.push(`  升级失败：${outcome.id}——${sanitizeLine(outcome.message)}`);
      }
    }
    writeOut(lines.join('\n'));
    return failed ? 1 : 0;
  } finally {
    await audit.close();
  }
}
