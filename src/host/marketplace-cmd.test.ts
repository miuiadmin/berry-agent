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
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { parseCli } from './cli.js';
import { runMarketplaceEntry } from './marketplace-cmd.js';
import { createMarketFs } from './plugin-market/fs.js';
import { readMarketplaceSources } from './plugin-market/registry.js';
import type { MarketFetchFace } from './plugin-market/types.js';
import { createPluginStoreFs, readLedger } from './plugin-store.js';

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
