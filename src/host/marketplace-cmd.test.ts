/**
 * host/marketplace-cmd 测试——mp-3 CLI 子命令族 + mp-4 update/upgrade 接线
 * （07 §5 berry marketplace 行；03 §9.6 装机咬合 CLI 面）。
 *
 * e2e 全链 = 真装配组合根（runMarketplaceEntry 真入口 + 真 tmp 数据目录 +
 * 真 fs 双面 + 真 Persistence 直开库；注入 = writeOut/writeErr 收集器、env
 * 空面与 fetch 假件〔网络源 add 零网络〕——mock 只停呈现位与传输位）：本地
 * 市场仓 add 源 → discover 列条目 → install 装机（拷贝腿真拷 + market 字段
 * 落账）→ list 呈现 → uninstall 双相寻址清算 → remove 清缓存；mp-4 增
 * update 整源刷新（local 换血/up-to-date 两形）与 upgrade 换装（单件 force
 * 缓存直拷 + 全量无 version 跳过）。另锁：呈现消毒（catalog 描述控制字符
 * 不注入行结构）、拒形谱、parseCli marketplace 动词族解析面。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { parseCli } from './cli.js';
import { runMarketplaceEntry } from './marketplace-cmd.js';
import { createMarketFs } from './plugin-market/fs.js';
import { readMarketplaceSources, writeMarketplaceSources } from './plugin-market/registry.js';
import type { MarketFetchFace } from './plugin-market/types.js';
import { createPluginStoreFs, mountRow, readEnabledRowsForEdit, readLedger } from './plugin-store.js';

/** 测试根 tmp（vitest 每文件钉数据目录纪律——自管 tmp 收尾自清） */
const testRoot = mkdtempSync(join(tmpdir(), 'berry-marketplace-cmd-test-'));
afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/** 输出收集器（writeOut/writeErr 注入面——e2e 唯一 mock 位） */
interface Collected {
  readonly out: string[];
  readonly err: string[];
  readonly options: {
    readonly dataDir: string;
    readonly env: Record<string, string>;
    readonly writeOut: (t: string) => void;
    readonly writeErr: (t: string) => void;
  };
}

/** 数据目录 + 输出收集器速记（dataDir 可复用既有目录——多动词接力同一现场） */
function stageOf(name: string, dataDir?: string): Collected {
  const dir = dataDir ?? join(testRoot, name);
  mkdirSync(dir, { recursive: true });
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    options: { dataDir: dir, env: {}, writeOut: (t) => void out.push(t), writeErr: (t) => void err.push(t) },
  };
}

/** 声明载荷插件 fixture（berryAgent.skills 在场 = declared-payload——零码收割零 jiti） */
function declaredPkgJson(id: string, version = '1.0.0'): string {
  return `${JSON.stringify({ name: id, version, berryAgent: { id, skills: ['greet'] } }, null, 2)}\n`;
}

/**
 * 本地市场仓 fixture：.claude-plugin/marketplace.json + 相对源条目目录。
 * description 含换行与控制字符——呈现消毒锁的料源（恶意 catalog 不注入行结构）。
 */
function seedMarketRepo(name: string): string {
  const repo = join(testRoot, `${name}-repo`);
  mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(repo, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name,
      owner: { name: 'o' },
      plugins: [
        { name: 'hello-plugin', source: './plugins/hello', description: '问好插件\n  伪行注入\x1b[31m红' },
        { name: 'demo-pkg', source: { source: 'npm', package: 'demo-pkg', version: '1.2.3' } },
      ],
    }),
  );
  mkdirSync(join(repo, 'plugins', 'hello'), { recursive: true });
  writeFileSync(join(repo, 'plugins', 'hello', 'package.json'), declaredPkgJson('hello-plugin'));
  return repo;
}

describe('e2e 全链（真装配组合根——本地 file 市场仓零网络）', () => {
  it('add → discover → install → 落账 market 字段 → list → uninstall → remove', async () => {
    const stage = stageOf('e2e');
    const repo = seedMarketRepo('alpha');

    // add：源入清单 + 缓存快照
    const addCode = await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options);
    expect(addCode).toBe(0);
    expect(stage.out.join('\n')).toContain('alpha');
    const sources = readMarketplaceSources(stage.options.dataDir, createMarketFs());
    expect(sources.ok && sources.sources.some((r) => r.name === 'alpha')).toBe(true);

    // discover：条目寻址形呈现 + 呈现消毒（描述控制字符剥除——伪行不注入行结构）
    const disc = stageOf('e2e-discover', stage.options.dataDir); // 复用同一数据目录
    const discCode = await runMarketplaceEntry({ sub: 'discover' }, disc.options);
    expect(discCode).toBe(0);
    const discText = disc.out.join('\n');
    expect(discText).toContain('hello-plugin@alpha');
    expect(discText).toContain('demo-pkg@alpha');
    expect(discText).not.toContain('\x1b'); // ANSI 控制序列剥除
    // 换行注入锁：描述里的 \n 不产生独立伪行（消毒后同值行内空格）
    const discLines = discText.split('\n');
    expect(discLines.some((line) => line.includes('伪行注入') && !line.includes('hello-plugin@alpha'))).toBe(false);

    // install：拷贝腿装机 + market 字段落账 + mount 指路第二行
    const inst = stageOf('e2e-install', stage.options.dataDir);
    const instCode = await runMarketplaceEntry({ sub: 'install', id: 'hello-plugin@alpha' }, inst.options);
    expect(instCode).toBe(0);
    const instText = inst.out.join('\n');
    expect(instText).toContain('已装机：hello-plugin');
    expect(instText).toContain('装机 ≠ 启用');
    expect(instText).toContain('berry plugins mount hello-plugin');
    const ledger = readLedger(stage.options.dataDir, createPluginStoreFs());
    expect(ledger.ok && ledger.entries).toHaveLength(1);
    expect(ledger.ok && ledger.entries[0]).toMatchObject({
      id: 'hello-plugin',
      source: 'local',
      installPath: join('plugins', 'market', 'alpha', 'hello-plugin'),
      market: { name: 'alpha', entry: 'hello-plugin' },
    });
    expect(existsSync(join(stage.options.dataDir, 'plugins', 'market', 'alpha', 'hello-plugin', 'package.json'))).toBe(
      true,
    );

    // list：源清单 + 条目计数呈现
    const list = stageOf('e2e-list', stage.options.dataDir);
    const listCode = await runMarketplaceEntry({ sub: 'list' }, list.options);
    expect(listCode).toBe(0);
    const listText = list.out.join('\n');
    expect(listText).toContain('alpha');
    expect(listText).toContain('local');
    expect(listText).toMatch(/条目\s*2/); // 两条目计数
    // 缓存时点呈现（usage.md「各附缓存时点与 commit 锚」承诺面——record.updatedAt 逐源在场）
    const listSources = readMarketplaceSources(stage.options.dataDir, createMarketFs());
    const alphaRecord = listSources.ok ? listSources.sources.find((r) => r.name === 'alpha') : undefined;
    expect(alphaRecord).toBeDefined();
    expect(listText).toContain(alphaRecord!.updatedAt);

    // uninstall inspect（无 --confirm = 只读预检——market 段路径呈报）
    const insp = stageOf('e2e-inspect', stage.options.dataDir);
    const inspCode = await runMarketplaceEntry(
      { sub: 'uninstall', id: 'hello-plugin@alpha', confirm: false },
      insp.options,
    );
    expect(inspCode).toBe(0);
    expect(insp.out.join('\n')).toContain(join('plugins', 'market', 'alpha', 'hello-plugin'));

    // uninstall execute（寻址解析装机 id 后走既有四段清算）
    const exe = stageOf('e2e-execute', stage.options.dataDir);
    const exeCode = await runMarketplaceEntry(
      { sub: 'uninstall', id: 'hello-plugin@alpha', confirm: true },
      exe.options,
    );
    expect(exeCode).toBe(0);
    expect(existsSync(join(stage.options.dataDir, 'plugins', 'market', 'alpha', 'hello-plugin'))).toBe(false);
    const after = readLedger(stage.options.dataDir, createPluginStoreFs());
    expect(after.ok && after.entries).toHaveLength(0);

    // remove：删源 + 清缓存目录
    const rm = stageOf('e2e-remove', stage.options.dataDir);
    const rmCode = await runMarketplaceEntry({ sub: 'remove', name: 'alpha' }, rm.options);
    expect(rmCode).toBe(0);
    expect(existsSync(join(stage.options.dataDir, 'marketplaces', 'alpha'))).toBe(false);
    const emptied = readMarketplaceSources(stage.options.dataDir, createMarketFs());
    expect(emptied.ok && emptied.sources).toHaveLength(0);
  });
});

describe('e2e update/upgrade 全链（mp-4 真身——local 源零网络）', () => {
  it('update：已最新退 0 不换血；源目录推进 → 整源换血 + discover 可见新条目', async () => {
    const stage = stageOf('upd-e2e');
    const repo = seedMarketRepo('gamma');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);

    // 已最新（源目录未动）——点名形退 0、不换血
    const same = stageOf('upd-same', stage.options.dataDir);
    const sameCode = await runMarketplaceEntry({ sub: 'update', name: 'gamma' }, same.options);
    expect(sameCode).toBe(0);
    expect(same.out.join('\n')).toContain('已是最新：gamma');

    // 源目录推进：catalog 增条目 + 新条目目录 → 全量形换血
    mkdirSync(join(repo, 'plugins', 'extra'), { recursive: true });
    writeFileSync(join(repo, 'plugins', 'extra', 'package.json'), declaredPkgJson('extra-plugin'));
    writeFileSync(
      join(repo, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'gamma',
        owner: { name: 'o' },
        plugins: [
          { name: 'hello-plugin', source: './plugins/hello' },
          { name: 'extra-plugin', source: './plugins/extra' },
        ],
      }),
    );
    const upd = stageOf('upd-changed', stage.options.dataDir);
    const updCode = await runMarketplaceEntry({ sub: 'update' }, upd.options);
    expect(updCode).toBe(0);
    expect(upd.out.join('\n')).toContain('已刷新：gamma（2 条目');

    // 换血后缓存即真相——discover 呈现新条目
    const disc = stageOf('upd-disc', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'discover' }, disc.options)).toBe(0);
    expect(disc.out.join('\n')).toContain('extra-plugin@gamma');
  });

  it('upgrade：单件点名 force 换血重装（local 相对源缓存直拷零网络）+ 全量无 version 跳过退 0', async () => {
    const stage = stageOf('upg-e2e');
    const repo = seedMarketRepo('delta');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);
    expect(await runMarketplaceEntry({ sub: 'install', id: 'hello-plugin@delta' }, stage.options)).toBe(0);

    // 单件点名 = force 换血（相对源条目无 version 也重装——缓存直拷腿）
    const single = stageOf('upg-single', stage.options.dataDir);
    const singleCode = await runMarketplaceEntry({ sub: 'upgrade', id: 'hello-plugin@delta' }, single.options);
    expect(singleCode).toBe(0);
    expect(single.out.join('\n')).toContain('已升级：hello-plugin');
    const ledger = readLedger(stage.options.dataDir, createPluginStoreFs());
    expect(ledger.ok && ledger.entries).toHaveLength(1); // 换血非新增
    expect(ledger.ok && ledger.entries[0]).toMatchObject({ market: { name: 'delta', entry: 'hello-plugin' } });

    // 全量（在装条目 catalog 无 version 声明 → 跳过、退 0）
    const all = stageOf('upg-all', stage.options.dataDir);
    const allCode = await runMarketplaceEntry({ sub: 'upgrade' }, all.options);
    expect(allCode).toBe(0);
    expect(all.out.join('\n')).toContain('跳过：hello-plugin');
    expect(all.out.join('\n')).toContain('未声明版本');
  });

  it('update 失败半场：源目录缺席 → 刷新失败行呈现 + 退 1（零网络真失败形）', async () => {
    const stage = stageOf('update-failed');
    const repo = seedMarketRepo('eps');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);
    // 上游目录整删——local 腿刷新失败的零网络可复现形（不 mock 传输位）
    rmSync(repo, { recursive: true, force: true });
    const failed = stageOf('update-failed-run', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'update' }, failed.options)).toBe(1);
    const text = failed.out.join('\n');
    expect(text).toContain('刷新失败：eps'); // 失败行 = 源名 + 消息（呈现面锁）
    expect(text).toContain('源目录缺席');
  });

  it('update 坏源清单：清单级硬拒 → stderr 报文 + 退 1（拒猜）', async () => {
    const stage = stageOf('update-corrupt');
    mkdirSync(stage.options.dataDir, { recursive: true });
    writeFileSync(join(stage.options.dataDir, 'marketplaces.json'), '{'); // 坏 JSON
    expect(await runMarketplaceEntry({ sub: 'update' }, stage.options)).toBe(1);
    const err = stage.err.join('\n');
    expect(err).toContain('源清单文件坏形');
    expect(err).toContain('拒猜');
  });

  it('upgrade 刷新失败降级：warn 注记 stderr + 既有缓存对拍跳过退 0（不拒整批）', async () => {
    const stage = stageOf('upgrade-refresh-fail');
    const repo = seedMarketRepo('zeta');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);
    expect(await runMarketplaceEntry({ sub: 'install', id: 'hello-plugin@zeta' }, stage.options)).toBe(0);
    // 上游目录整删 + 源清单 updatedAt 回拨 25h（真钟——CLI 生产装配无时钟注
    // 入位）：刷新腿 TTL 过龄必达、local 腿必败（零网络真失败形）
    rmSync(repo, { recursive: true, force: true });
    const marketFs = createMarketFs();
    const read = readMarketplaceSources(stage.options.dataDir, marketFs);
    if (!read.ok) throw new Error(`源清单坏形：${read.message}`);
    writeMarketplaceSources(
      stage.options.dataDir,
      read.sources.map((r) => ({ ...r, updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() })),
      marketFs,
    );
    const upg = stageOf('upgrade-refresh-fail-run', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'upgrade' }, upg.options)).toBe(0);
    const err = upg.err.join('\n');
    expect(err).toContain('warn：市场刷新失败'); // 降级注记走 stderr（不混 stdout 结果面）
    expect(err).toContain('zeta');
    // 对拍降级走既有缓存：条目无 version 声明 → 跳过（非 failed、整批退 0）
    expect(upg.out.join('\n')).toContain('跳过：hello-plugin');
  });

  it('upgrade 单件翻译拒：failed 行呈现 + 退 1（per-entry 失败面——CLI 组合根锁）', async () => {
    const stage = stageOf('upgrade-translate-refuse');
    const repo = seedMarketRepo('eta');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);
    expect(await runMarketplaceEntry({ sub: 'install', id: 'hello-plugin@eta' }, stage.options)).toBe(0);
    // 缓存 catalog 被上游腐蚀：条目源指向仓外（相对路径逃逸——翻译层防线拒）
    const cacheCatalog = join(stage.options.dataDir, 'marketplaces', 'eta', '.claude-plugin', 'marketplace.json');
    const parsed = JSON.parse(readFileSync(cacheCatalog, 'utf8')) as {
      plugins: { name: string; source: string }[];
    };
    parsed.plugins = parsed.plugins.map((p) =>
      p.name === 'hello-plugin' ? { ...p, source: './../../etc/passwd' } : p,
    );
    writeFileSync(cacheCatalog, JSON.stringify(parsed));
    // 鲜缓存（add 刚落）零刷新 + 单件点名 force → 翻译拒 try 跳败 → failed 行 + 退 1
    const upg = stageOf('upgrade-translate-refuse-run', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'upgrade', id: 'hello-plugin@eta' }, upg.options)).toBe(1);
    const text = upg.out.join('\n');
    expect(text).toContain('升级失败：hello-plugin'); // failed 行 = 装机 id + 消息（呈现面锁）
    expect(text).toContain('逃逸'); // 拒因上浮（翻译层防线报文——路径逃逸族）
  });

  it('id 漂移换装 CLI 呈现：install 回执随迁注记（无 mount 指路行）+ upgrade 回执 id 漂移指路（修前红）', async () => {
    const stage = stageOf('cli-id-drift');
    const repo = seedMarketRepo('iota');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);
    expect(await runMarketplaceEntry({ sub: 'install', id: 'hello-plugin@iota' }, stage.options)).toBe(0);
    expect(mountRow(stage.options.dataDir, 'hello-plugin', undefined, createPluginStoreFs())).toMatchObject({
      ok: true,
    });
    // 推进代：上游清单改名 hello-plugin → hello-plugin-v2；catalog 文本同步推进
    // （description 加代标——local 腿 up-to-date 判据按 catalog 文本对拍，文本不变不换血）
    const bumpRepoGeneration = (gen: string, manifestId: string): void => {
      writeFileSync(join(repo, 'plugins', 'hello', 'package.json'), declaredPkgJson(manifestId));
      const catalog = JSON.parse(readFileSync(join(repo, '.claude-plugin', 'marketplace.json'), 'utf8')) as {
        plugins: { name: string; description?: string }[];
      };
      catalog.plugins = catalog.plugins.map((p) =>
        p.name === 'hello-plugin' ? { ...p, description: `问好插件 代 ${gen}` } : p,
      );
      writeFileSync(join(repo, '.claude-plugin', 'marketplace.json'), JSON.stringify(catalog));
    };
    bumpRepoGeneration('2', 'hello-plugin-v2');
    const upd = stageOf('cli-id-drift-upd', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'update', name: 'iota' }, upd.options)).toBe(0); // 缓存换血
    const re = stageOf('cli-id-drift-reinstall', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'install', id: 'hello-plugin@iota' }, re.options)).toBe(0);
    const reText = re.out.join('\n');
    expect(reText).toContain('启用行已随换代迁移'); // 随迁注记（回执诚实位——§9.6 定形）
    expect(reText).not.toContain('装机 ≠ 启用'); // 行已随迁——mount 指路行不复呈现（指路会撞名拒）
    // 再推进一代 v3：upgrade 单件点名的 id 漂移呈现 + 行随迁到底
    bumpRepoGeneration('3', 'hello-plugin-v3');
    const upd2 = stageOf('cli-id-drift-upd2', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'update', name: 'iota' }, upd2.options)).toBe(0);
    const upg = stageOf('cli-id-drift-upgrade', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'upgrade', id: 'hello-plugin@iota' }, upg.options)).toBe(0);
    const upgText = upg.out.join('\n');
    expect(upgText).toContain('id 漂移'); // 漂移指路（回执旧 id 无指路即修前红形）
    expect(upgText).toContain('hello-plugin-v2');
    expect(upgText).toContain('hello-plugin-v3');
    // 启用行随迁到底（跨两代连续——无人值守律：upgrade 不失在用插件）
    const rows = readEnabledRowsForEdit(stage.options.dataDir, createPluginStoreFs());
    expect(rows.ok && rows.rows.map((row) => row.id)).toEqual(['hello-plugin-v3']);
  });
});

describe('discover TTL 惰性刷新 e2e（CLI 触发时点——03 §9.6 失效降级 + 07 §5 discover 行）', () => {
  it('过龄源 discover 顺带回源刷新（新条目呈现 + TTL 窗重启）；鲜缓存零回源', async () => {
    const stage = stageOf('disc-ttl');
    const repo = seedMarketRepo('ttlmkt');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);

    // 上游 catalog 推进（新条目 fresh-plugin）+ 源记录过龄 25h（> 24h TTL）
    mkdirSync(join(repo, 'plugins', 'fresh'), { recursive: true });
    writeFileSync(join(repo, 'plugins', 'fresh', 'package.json'), declaredPkgJson('fresh-plugin'));
    writeFileSync(
      join(repo, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'ttlmkt',
        owner: { name: 'o' },
        plugins: [
          { name: 'hello-plugin', source: './plugins/hello' },
          { name: 'fresh-plugin', source: './plugins/fresh' },
        ],
      }),
    );
    const marketFs = createMarketFs();
    const read = readMarketplaceSources(stage.options.dataDir, marketFs);
    if (!read.ok) throw new Error(`源清单坏形：${read.message}`);
    writeMarketplaceSources(
      stage.options.dataDir,
      read.sources.map((r) => ({ ...r, updatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() })),
      marketFs,
    );

    // CLI discover（生产装配——fetch 真身注入；local 源刷新腿零网络）：过龄即
    // 顺带回源——上游新条目呈现、刷新成 TTL 窗重启不再标 stale
    const disc = stageOf('disc-ttl-run', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'discover' }, disc.options)).toBe(0);
    const text = disc.out.join('\n');
    expect(text).toContain('fresh-plugin@ttlmkt'); // 过龄回源——新 catalog 即真相
    expect(text).not.toContain('缓存偏旧'); // 刷新成 updatedAt 前进——不再标 stale

    // 鲜缓存维持零网络：上游再推进但未过龄——discover 纯读不回源（新条目不现）
    writeFileSync(
      join(repo, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'ttlmkt',
        owner: { name: 'o' },
        plugins: [
          { name: 'hello-plugin', source: './plugins/hello' },
          { name: 'fresh-plugin', source: './plugins/fresh' },
          { name: 'quiet-plugin', source: './plugins/fresh' },
        ],
      }),
    );
    const again = stageOf('disc-ttl-fresh', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'discover' }, again.options)).toBe(0);
    expect(again.out.join('\n')).not.toContain('quiet-plugin@ttlmkt'); // 未过龄——零回源纯读
  });
});

describe('呈现消毒面——version 字段（mp 收尾批：discover/upgrade 版本位同过 sanitizeLine）', () => {
  /**
   * 恶意 version fixture：catalog 条目 version 携换行 + ESC/ANSI 序列（parse 面
   * 对 version 零词法执法——呈现消毒锁的料源）；插件清单不带 version 键
   * （upgrade to 落位回落 catalog 声明位——evil 串直达呈现面的通路锚）。
   */
  function seedEvilVersionRepo(name: string): string {
    const repo = join(testRoot, `${name}-repo`);
    mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(repo, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name,
        owner: { name: 'o' },
        plugins: [
          {
            name: 'evil-plugin',
            version: '1.0.0\n    fake-entry  99.9\x1b[31m红',
            source: './plugins/evil',
            description: '问好插件',
          },
        ],
      }),
    );
    mkdirSync(join(repo, 'plugins', 'evil'), { recursive: true });
    writeFileSync(
      join(repo, 'plugins', 'evil', 'package.json'),
      `${JSON.stringify({ name: 'evil-plugin', berryAgent: { id: 'evil-plugin', skills: ['greet'] } }, null, 2)}\n`,
    );
    return repo;
  }

  it('discover：条目 version 携换行/ESC 不注入行结构（修前红——version 直拼）', async () => {
    const stage = stageOf('evil-version');
    const repo = seedEvilVersionRepo('evilmkt');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);
    const disc = stageOf('evil-version-disc', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'discover' }, disc.options)).toBe(0);
    const text = disc.out.join('\n');
    expect(text).toContain('evil-plugin@evilmkt');
    expect(text).not.toContain('\x1b'); // ANSI 控制序列剥除
    // 换行注入锁：version 里的 \n 不产生独立伪行（消毒后同值行内空格——与 description 同律）
    expect(text.split('\n').some((line) => line.includes('fake-entry') && !line.includes('evil-plugin@'))).toBe(false);
  });

  it('upgrade：from/to 版本位同过消毒（修前红——upgraded 态两值直拼、同字段两态不同律）', async () => {
    const stage = stageOf('evil-upgrade');
    const repo = seedEvilVersionRepo('evilup');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);
    expect(await runMarketplaceEntry({ sub: 'install', id: 'evil-plugin@evilup' }, stage.options)).toBe(0);
    // 单件点名 = force 换血；账本 version 缺席（清单无 version）→ to 回落 catalog 声明（evil 串）
    const upg = stageOf('evil-upgrade-run', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'upgrade', id: 'evil-plugin@evilup' }, upg.options)).toBe(0);
    const text = upg.out.join('\n');
    expect(text).toContain('已升级：evil-plugin');
    expect(text).not.toContain('\x1b');
    // 换行注入锁：伪条目文本不得逃出已升级行
    expect(text.split('\n').some((line) => line.includes('fake-entry') && !line.includes('已升级'))).toBe(false);
  });
});

describe('呈现消毒面——结局报文位（mp 收尾批安全簇：added/outcome 报文同过 sanitizeLine）', () => {
  /**
   * 攻击面：add/install/uninstall 的失败与成功报文内嵌外源自由文本——
   * catalog 名（parse 拒报文携带原文）、条目源字段（翻译拒报文携带原文）、
   * 插件清单 version（账本位直达 uninstall inspect 报文）。OSC 52 形
   * '\x1b]52;c;aGVsbG8=' 落终端即剪贴板写——呈现位与 version/description 同律消毒。
   */
  it('add 失败报文：catalog 名携 ESC 序列消毒后呈现（修前红——added.message 裸出）', async () => {
    const stage = stageOf('evil-add-name');
    const repo = join(testRoot, 'evil-add-name-repo');
    mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(repo, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({ name: 'ev\x1b]52;c;aGVsbG8=', owner: { name: 'o' }, plugins: [] }),
    );
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(1);
    const text = stage.err.join('\n');
    expect(text).toContain('catalog name'); // 归因保留（消毒只剥控制字符不吞语义）
    expect(text).not.toContain('\x1b'); // 修前红：报文携带 OSC 52 序列裸出
  });

  it('install 失败报文：条目源字段携 ESC 经翻译拒报文消毒后呈现（修前红——outcome.message 裸出）', async () => {
    const stage = stageOf('evil-install-msg');
    const repo = join(testRoot, 'evil-install-msg-repo');
    mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(repo, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'evilmsg',
        owner: { name: 'o' },
        plugins: [
          // '#'+ESC 组合：'#' 触发翻译拒（报文携带原文）、ESC 顺带搭车到呈现面
          { name: 'evil-pkg', source: { source: 'npm', package: 'p\x1b]52;c;aGVsbG8=#frag' } },
        ],
      }),
    );
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);
    const inst = stageOf('evil-install-run', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'install', id: 'evil-pkg@evilmsg' }, inst.options)).toBe(1);
    const text = inst.err.join('\n');
    expect(text).toContain('evil-pkg@evilmsg'); // 归因保留
    expect(text).not.toContain('\x1b'); // 修前红
  });

  it('uninstall inspect 报文：插件清单 version 携 ESC 消毒后呈现（修前红——outcome.text 裸出）', async () => {
    const stage = stageOf('evil-uninst-text');
    const repo = join(testRoot, 'evil-uninst-text-repo');
    mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
    writeFileSync(
      join(repo, '.claude-plugin', 'marketplace.json'),
      JSON.stringify({
        name: 'eviluninst',
        owner: { name: 'o' },
        plugins: [{ name: 'evil-manifest', source: './plugins/evil' }],
      }),
    );
    mkdirSync(join(repo, 'plugins', 'evil'), { recursive: true });
    // 清单 version 零词法执法（版本域自由文本）——install 落账本后直达 uninstall 报文
    writeFileSync(
      join(repo, 'plugins', 'evil', 'package.json'),
      `${JSON.stringify(
        {
          name: 'evil-manifest',
          version: '1.0.0\x1b]52;c;aGVsbG8=',
          berryAgent: { id: 'evil-manifest', skills: ['greet'] },
        },
        null,
        2,
      )}\n`,
    );
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);
    expect(await runMarketplaceEntry({ sub: 'install', id: 'evil-manifest@eviluninst' }, stage.options)).toBe(0);
    const insp = stageOf('evil-uninst-inspect', stage.options.dataDir);
    expect(
      await runMarketplaceEntry({ sub: 'uninstall', id: 'evil-manifest@eviluninst', confirm: false }, insp.options),
    ).toBe(0);
    const text = insp.out.join('\n');
    expect(text).toContain('evil-manifest'); // 归因保留
    expect(text).not.toContain('\x1b'); // 修前红：清单 version 携 OSC 52 裸出
  });
});

describe('CLI 动词面（拒形谱 + 诚实拒）', () => {
  it('add 网络源真身接线（注假 fetch 零网络——CLI fetch 注入位全链）', async () => {
    const stage = stageOf('net-add');
    // 假 git 腿：真盘物化克隆目录（CLI add 腿用真 MarketFs promote——产物须真实文件）
    const cloneDir = join(testRoot, 'net-add-clone');
    mkdirSync(join(cloneDir, '.claude-plugin'), { recursive: true });
    const catalog = JSON.stringify({
      name: 'remote-market',
      owner: { name: 'o' },
      plugins: [{ name: 'remote-plugin', source: './plugins/remote' }],
    });
    writeFileSync(join(cloneDir, '.claude-plugin', 'marketplace.json'), catalog);
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async () => ({
        cloneDir,
        catalogPath: '.claude-plugin/marketplace.json',
        text: catalog,
        commit: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
      }),
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    const code = await runMarketplaceEntry(
      { sub: 'add', source: 'https://example.com/o/remote-market.git' },
      { ...stage.options, fetch },
    );
    expect(code).toBe(0);
    expect(stage.out.join('\n')).toContain('remote-market');
    const sources = readMarketplaceSources(stage.options.dataDir, createMarketFs());
    expect(sources.ok && sources.sources.some((r) => r.name === 'remote-market' && r.sourceType === 'git')).toBe(true);
    // git 源 commit 锚呈现（usage.md「各附缓存时点与 commit 锚」——record.commit 前 7 位）
    const list = stageOf('net-add-list', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'list' }, list.options)).toBe(0);
    expect(list.out.join('\n')).toContain('@aaaa111');
  });

  it('add 不识形拒退 1（报文指路两候选形）', async () => {
    const stage = stageOf('bad-add');
    const code = await runMarketplaceEntry({ sub: 'add', source: 'what-is-this' }, stage.options);
    expect(code).toBe(1);
    expect(stage.err.join('\n')).toContain('无法识别的源形');
  });

  it('remove 查无拒退 1（点名失败诚实——不静默幂等）', async () => {
    const stage = stageOf('rm-missing');
    const code = await runMarketplaceEntry({ sub: 'remove', name: 'nowhere' }, stage.options);
    expect(code).toBe(1);
    expect(stage.err.join('\n')).toContain('nowhere');
  });

  it('remove 中断窗良性向：清缓存先于落账——落账失败位 = 记录在场+缓存缺席（update 可自愈；修前红：旧序落账先行 = 写失败裸抛 + 缓存残留不可收口）', async () => {
    const stage = stageOf('rm-order');
    const repo = seedMarketRepo('rm-order-market');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);
    const cacheDir = join(stage.options.dataDir, 'marketplaces', 'rm-order-market');
    expect(existsSync(cacheDir)).toBe(true); // add 已物化缓存快照
    // 阻断落账写：writeMarketplaceSources 落 `${path}.tmp-<pid>` 后 rename——
    // tmp 位预占目录（EISDIR）即两步清场的第二步失败注入
    mkdirSync(join(stage.options.dataDir, `marketplaces.json.tmp-${process.pid}`));
    const code = await runMarketplaceEntry({ sub: 'remove', name: 'rm-order-market' }, stage.options);
    expect(code).toBe(1); // result 面诚实拒（写失败不裸抛出 result 面）
    expect(stage.err.join('\n')).toContain('rm-order-market');
    // 时序锁：缓存已清（清场在先）——中断残留方向 = 「记录在场 + 缓存缺席」
    // 良性态（discover 缺席指路 update 可自愈）；反序残留 = 孤儿缓存目录
    // （读侧账本驱动不可见、无自动收口位）
    expect(existsSync(cacheDir)).toBe(false);
    // 账本未被抹（原子写 rename 未达——源仍在，重试 remove 可续）
    const sources = readMarketplaceSources(stage.options.dataDir, createMarketFs());
    expect(sources.ok && sources.sources.some((r) => r.name === 'rm-order-market')).toBe(true);
  });

  it('install 坏寻址拒退 1（无 @ 段）', async () => {
    const stage = stageOf('bad-install');
    const code = await runMarketplaceEntry({ sub: 'install', id: 'no-at' }, stage.options);
    expect(code).toBe(1);
    expect(stage.err.join('\n')).toContain('name@marketplace');
  });

  it('uninstall 市场寻址无装机条目拒退 1（指路 marketplace install）', async () => {
    const stage = stageOf('bad-uninstall');
    const code = await runMarketplaceEntry({ sub: 'uninstall', id: 'ghost@nowhere', confirm: false }, stage.options);
    expect(code).toBe(1);
    expect(stage.err.join('\n')).toContain('marketplace install');
  });

  it('uninstall --data 无 --confirm 拒退 1（execute 载荷不静默猜——§5.5 双相旗标全继承）', async () => {
    const stage = stageOf('data-no-confirm');
    const code = await runMarketplaceEntry(
      { sub: 'uninstall', id: 'hello-plugin@alpha', confirm: false, dataAction: 'purge' },
      stage.options,
    );
    expect(code).toBe(1);
    expect(stage.err.join('\n')).toContain('--data');
  });

  it('update 零源退 0 + 点名缺席退 1（指路 list）', async () => {
    const empty = stageOf('update-empty');
    const zeroCode = await runMarketplaceEntry({ sub: 'update' }, empty.options);
    expect(zeroCode).toBe(0);
    expect(empty.out.join('\n')).toContain('零市场源');
    const miss = stageOf('update-missing');
    const code = await runMarketplaceEntry({ sub: 'update', name: 'ghost' }, miss.options);
    expect(code).toBe(1);
    expect(miss.err.join('\n')).toContain('不在源清单');
  });

  it('upgrade 寻址硬拒退 1（市场不在源清单——mp-4 真身拒形）', async () => {
    const stage = stageOf('upgrade-missing');
    const code = await runMarketplaceEntry({ sub: 'upgrade', id: 'hello-plugin@nowhere' }, stage.options);
    expect(code).toBe(1);
    expect(stage.err.join('\n')).toContain('不在源清单');
  });

  it('list 零源出厂：退 0 + 零源呈现（不报错不造文件）', async () => {
    const stage = stageOf('list-empty');
    const code = await runMarketplaceEntry({ sub: 'list' }, stage.options);
    expect(code).toBe(0);
    expect(stage.out.join('\n')).toContain('零市场源');
    expect(existsSync(join(stage.options.dataDir, 'marketplaces.json'))).toBe(false);
  });

  it('discover 单源过滤查无：退 0 空聚合（不报错）', async () => {
    const stage = stageOf('discover-none');
    const repo = seedMarketRepo('beta');
    await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options);
    // 复用同一数据目录（过滤名不在册 = 源在册而过滤查无——空聚合不报错）
    const probe = stageOf('discover-none-probe', stage.options.dataDir);
    const code = await runMarketplaceEntry({ sub: 'discover', name: 'not-added' }, probe.options);
    expect(code).toBe(0);
    expect(probe.out.join('\n')).not.toContain('hello-plugin@beta');
  });

  it('discover 零源无参形：退 0 零源指路（不把 undefined 插名当源名）', async () => {
    const stage = stageOf('discover-empty');
    const code = await runMarketplaceEntry({ sub: 'discover' }, stage.options);
    expect(code).toBe(0);
    const text = stage.out.join('\n');
    expect(text).not.toContain('undefined'); // 无参形 name 缺席——报文不得插值 undefined
    expect(text).toContain('零市场源'); // 与 list/update 零源指路同族
  });
});

describe('parseCli marketplace 解析面（07 §5 动词族）', () => {
  it('八动词解析形 + 未知子命令退 2 + 须带子命令退 2', () => {
    expect(parseCli(['marketplace', 'add', './x'])).toMatchObject({
      ok: true,
      command: { kind: 'marketplace', sub: { sub: 'add', source: './x' } },
    });
    expect(parseCli(['marketplace', 'remove', 'alpha'])).toMatchObject({
      ok: true,
      command: { kind: 'marketplace', sub: { sub: 'remove', name: 'alpha' } },
    });
    expect(parseCli(['marketplace', 'update'])).toMatchObject({
      ok: true,
      command: { kind: 'marketplace', sub: { sub: 'update' } },
    });
    expect(parseCli(['marketplace', 'update', 'alpha'])).toMatchObject({
      ok: true,
      command: { kind: 'marketplace', sub: { sub: 'update', name: 'alpha' } },
    });
    expect(parseCli(['marketplace', 'list'])).toMatchObject({
      ok: true,
      command: { kind: 'marketplace', sub: { sub: 'list' } },
    });
    expect(parseCli(['marketplace', 'discover'])).toMatchObject({
      ok: true,
      command: { kind: 'marketplace', sub: { sub: 'discover' } },
    });
    expect(parseCli(['marketplace', 'install', 'a-plugin@alpha'])).toMatchObject({
      ok: true,
      command: { kind: 'marketplace', sub: { sub: 'install', id: 'a-plugin@alpha' } },
    });
    expect(parseCli(['marketplace', 'uninstall', 'a-plugin@alpha', '--confirm', '--data', 'purge'])).toMatchObject({
      ok: true,
      command: {
        kind: 'marketplace',
        sub: { sub: 'uninstall', id: 'a-plugin@alpha', confirm: true, dataAction: 'purge' },
      },
    });
    expect(parseCli(['marketplace', 'upgrade'])).toMatchObject({
      ok: true,
      command: { kind: 'marketplace', sub: { sub: 'upgrade' } },
    });

    const unknown = parseCli(['marketplace', 'teleport']);
    expect(unknown.ok).toBe(false);
    if (unknown.ok) return;
    expect(unknown.message).toContain('teleport');
    const bare = parseCli(['marketplace']);
    expect(bare.ok).toBe(false);
  });

  it('install 无参 usage 指路退 2（不开交互）', () => {
    const parsed = parseCli(['marketplace', 'install']);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('install');
  });

  it('顶层未知子命令报文收录 marketplace（合法清单单源）', () => {
    const parsed = parseCli(['definitely-not-a-command']);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.message).toContain('marketplace');
  });
});

describe('docs 对拍锁（usage.md marketplace 节——词法域单源，skills/policy.test 对拍锁同族）', () => {
  it('add 源形不写 `local:` 前缀（ref 寻址词法域 ≠ 源分类词法域——classify 五规则只认路径三形）', () => {
    if (!existsSync('docs/usage.md')) return; // 公开册缺席（裁剪安装形）零对拍面
    const text = readFileSync('docs/usage.md', 'utf8');
    // `local:` 是 plugins install <ref> 三源词法（见同册 plugins 节）；写进
    // marketplace add 源形 = 词法域混写——classifyMarketplaceSource 不识别，
    // 用户照文档执行即 fail-loud「无法识别的源形」/两段形误报「git 源坏形」
    expect(text.includes('`local:` 前缀'), 'usage.md 把 ref 前缀 local: 误写进 marketplace add 源形（文档失真）').toBe(
      false,
    );
    // 正形在场锚：本地目录三路径前缀（classify 五规则之 local 腿词面）
    expect(text.includes('`./`、`~/`、`/` 开头路径'), '本地源形三路径前缀句缺席').toBe(true);
  });

  it('plugin-development.md 市场仓节含 catalog 双路径嵌套位说明（与 usage.md 同源对齐）', () => {
    if (!existsSync('docs/plugin-development.md')) return;
    const text = readFileSync('docs/plugin-development.md', 'utf8');
    // catalog 落位非仓根平铺——嵌套 .omp-plugin/ 或 .claude-plugin/（双路径读序）
    expect(text.includes('.omp-plugin'), '市场仓 catalog 嵌套位双路径说明缺席').toBe(true);
  });
});

describe('list 呈现面（缓存时点与 commit 锚——docs/usage.md「各附缓存时点与 commit 锚」承诺面兑现）', () => {
  it('行尾附 updatedAt（全源在场）与 git commit 前 7 位锚（git 源）', async () => {
    const stage = stageOf('list-anchor');
    // git 源带 commit——注假 fetch 零网络（add 腿真身物化缓存与 record）
    const cloneDir = join(testRoot, 'list-anchor-clone');
    mkdirSync(join(cloneDir, '.claude-plugin'), { recursive: true });
    const catalog = JSON.stringify({
      name: 'anchor-market',
      owner: { name: 'o' },
      plugins: [{ name: 'anchor-plugin', source: './plugins/anchor' }],
    });
    writeFileSync(join(cloneDir, '.claude-plugin', 'marketplace.json'), catalog);
    const fetch: MarketFetchFace = {
      fetchGitCatalog: async () => ({
        cloneDir,
        catalogPath: '.claude-plugin/marketplace.json',
        text: catalog,
        commit: 'aaaa1111bbbb2222cccc3333dddd4444eeee5555',
      }),
      fetchUrlCatalog: async () => {
        throw new Error('本用例不达');
      },
    };
    expect(await runMarketplaceEntry({ sub: 'add', source: 'owner/anchor-market' }, { ...stage.options, fetch })).toBe(
      0,
    );
    const sources = readMarketplaceSources(stage.options.dataDir, createMarketFs());
    const record = sources.ok ? sources.sources.find((r) => r.name === 'anchor-market') : undefined;
    expect(record).toBeDefined(); // record 数据面在席（updatedAt/commit 维护于 registry）——缺口仅在呈现面
    const list = stageOf('list-anchor-view', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'list' }, list.options)).toBe(0);
    const text = list.out.join('\n');
    expect(text).toContain(record!.updatedAt); // 缓存时点（24h TTL 观测位——全源在场）
    expect(text).toContain('@aaaa111'); // commit 锚（前 7 位——git 源）
  });
});

describe('呈现消毒面——拒绝报文 stderr 位（mp 收尾批 sec：install 拒文 writeErr 皮带 + 构造位消毒双防线）', () => {
  it('install 翻译拒报文携 ESC/换行：stderr 无 OSC 注入无伪行——修前红', async () => {
    const stage = stageOf('install-msg-sanitize');
    const repo = seedMarketRepo('theta');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, stage.options)).toBe(0);
    // 缓存 catalog 被上游腐蚀：条目源携控制字符坏形（相对串路径逃逸——拒文内插 raw 字段）
    const cacheCatalog = join(stage.options.dataDir, 'marketplaces', 'theta', '.claude-plugin', 'marketplace.json');
    const parsed = JSON.parse(readFileSync(cacheCatalog, 'utf8')) as { plugins: { name: string; source: string }[] };
    parsed.plugins = parsed.plugins.map((p) =>
      p.name === 'hello-plugin' ? { ...p, source: './../../etc\nFAKE\u001b]0;pwned' } : p,
    );
    writeFileSync(cacheCatalog, JSON.stringify(parsed));
    const inst = stageOf('install-msg-sanitize-run', stage.options.dataDir);
    expect(await runMarketplaceEntry({ sub: 'install', id: 'hello-plugin@theta' }, inst.options)).toBe(1);
    const errText = inst.err.join('\n');
    expect(errText).not.toContain('\u001b'); // OSC/ANSI 注入面封死（皮带 + 构造位双防线）
    expect(errText).toContain('拒'); // 诚实拒语义不丢（消毒不吞拒因）
    // 伪行锁：源内 \n 不得产出以 FAKE 起头的独立行（消毒后同值行内空格）
    expect(errText.split('\n').some((line) => line.startsWith('FAKE'))).toBe(false);
  });
});
