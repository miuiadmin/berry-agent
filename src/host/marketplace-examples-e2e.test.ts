/**
 * host/marketplace-examples-e2e —— marketplace local 源装机路径端到端回归锁
 * （00-立题-生态范式插件notify-telegram-20261016「顺路件（选项一）」节——
 * ⑦选项一落码腿；examples 双清单升格〔6af9533 零码批〕的配套码面锁）。
 *
 * 与 marketplace-cmd.test.ts 既有 e2e 的分野：那侧用**合成 fixture 市场仓**
 * 锁 CLI 编舞行为；本件锁**本仓自带的发货样例**——examples/ 真市场目录
 * （.claude-plugin/marketplace.json 双清单 + 两相对串条目）从 add 到装载
 * 的全链可用性。模板被上游改动而任何一环断链（catalog 形坏 / 插件清单
 * 坏形 / api 地板超宿主 / 入口文件丢失）即红——「examples 是活的市场层
 * 样例」这一承诺（docs 生态状态段所指的本地市场仓）的回归面。零网络
 * local 腿：全链不消费 fetch 位（鲜缓存零回源）。
 *
 * 全链四段（真装配组合根——mock 只停呈现位与 runtime 壳）：
 *  1. add：runMarketplaceEntry 真入口 + 真 MarketFs——examples 绝对路径
 *     作 local 源（classify 路径三形之绝对形）：源清单落账（name = catalog
 *     自报名）+ 缓存快照物化（catalogPath = .claude-plugin/marketplace.json
 *     ——双路径读序第二候选命中）；
 *  2. discover：两相对串条目寻址形呈现（name@market）；
 *  3. install ×2：拷贝腿境二（local 缓存目录内子目录直拷零 spawn）落位
 *     plugins/market/<市场名>/<条目名>/；代码插件 jiti 收割真跑（模板
 *     entry 无 events 导出 → declaredEvents 空账）、纯声明包零码收割；
 *     账本 market 注记两段全落；
 *  4. 装载可用：mountRow 真启用行 + bootPlugins 真装载管线（真盘真 jiti
 *     真装载门——apiVersion 真源取宿主 package.json，assembly
 *     readHostApiVersion 同式补读）：两 id 进 activated、代码模板注册的
 *     example-hello 命令真达命令注册表（装载可用的行为判据）、纯声明模板
 *     skillDirs 指向装机树内（B2 定形——独立于缓存与源目录）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { EventDispatch, Scope } from '../context/index.js';

import { runMarketplaceEntry } from './marketplace-cmd.js';
import type { MarketplaceEntryOptions } from './marketplace-cmd.js';
import { bootPlugins } from './plugin-boot.js';
import { createMarketFs } from './plugin-market/fs.js';
import { readMarketplaceSources } from './plugin-market/registry.js';
import { createPluginStoreFs, mountRow, readLedger } from './plugin-store.js';
import type { HostRuntime } from './runtime.js';

/** 仓库根（src/host 上推两级——testkit.test.ts 同式按自身深度取层）：examples 真市场目录定位 */
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** 本仓自带市场目录（catalog 自报名 = 源清单锁定名——下游断言单源） */
const examplesDir = join(repoRoot, 'examples');
/** 市场源锁定名（examples/.claude-plugin/marketplace.json 的 name 位——发货样例契约） */
const MARKET_NAME = 'berry-agent-examples';

/** 宿主 package.json 同文件双值（version + apiVersion——assembly 同源补读式） */
const hostPkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  version?: string;
  apiVersion?: string;
};

/** 临时目录族（统一清） */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

/** 输出收集器速记（writeOut/writeErr 注入面——e2e 唯一 mock 位；逐动词独立账） */
function entryOptions(dataDir: string): {
  readonly options: MarketplaceEntryOptions;
  readonly out: string[];
  readonly err: string[];
} {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    options: { dataDir, env: {}, writeOut: (t) => void out.push(t), writeErr: (t) => void err.push(t) },
  };
}

/**
 * HostRuntime 结构化替身（plugin-boot.test.ts 同律——装载序消费面 =
 * dataDir/memory/registerCloser 族；persistence 占位不被 boot 消费）。
 */
function stubRuntime(dataDir: string): HostRuntime {
  return {
    memory: false,
    dataDir,
    persistence: {} as HostRuntime['persistence'], // 装配序不消费——占位
    abortSignal: new AbortController().signal,
    disclosure: () => null,
    registerCloser: () => undefined,
    registerShutdownHook: () => undefined,
    registerDisposer: () => undefined,
    shutdown: async () => undefined,
    writeCrashLog: () => undefined,
  };
}

describe('marketplace local 源装机路径 e2e（examples 真市场目录——add → discover → install ×2 → 装载可用）', () => {
  it('全链绿：源入册 → 缓存物化 → 条目呈现 → 双条目拷贝腿装机 → 真装载注册面真达', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-mkt-examples-e2e-'));
    dirs.push(dataDir);

    // —— ① add：examples 绝对路径 = local 源（零网络全真跑）——
    const add = entryOptions(dataDir);
    const addCode = await runMarketplaceEntry({ sub: 'add', source: examplesDir }, add.options);
    expect(addCode, `add 拒：${add.err.join('\n')}`).toBe(0);
    // 源清单落账：catalog 自报名 + local 分类 + 用户输入原样 + 嵌套 catalogPath
    // （.claude-plugin 第二候选——发货样例用的正是该嵌套位）
    const sources = readMarketplaceSources(dataDir, createMarketFs());
    if (!sources.ok) throw new Error(`源清单坏形：${sources.message}`);
    expect(sources.sources).toHaveLength(1);
    expect(sources.sources[0]).toMatchObject({
      name: MARKET_NAME,
      sourceType: 'local',
      sourceUri: examplesDir,
      catalogPath: '.claude-plugin/marketplace.json',
    });
    // 缓存即真相：快照整树物化（catalog 嵌套位随树进缓存）
    expect(existsSync(join(dataDir, 'marketplaces', MARKET_NAME, '.claude-plugin', 'marketplace.json'))).toBe(true);

    // —— ② discover：两相对串条目寻址形呈现（鲜缓存零回源——零网络）——
    const disc = entryOptions(dataDir);
    expect(await runMarketplaceEntry({ sub: 'discover' }, disc.options)).toBe(0);
    const discText = disc.out.join('\n');
    expect(discText).toContain(`minimal-code-plugin@${MARKET_NAME}`);
    expect(discText).toContain(`pure-skill-pack@${MARKET_NAME}`);

    // —— ③ install 代码模板：拷贝腿境二（local 缓存目录内子目录直拷零 spawn）——
    const instCode = entryOptions(dataDir);
    const codeInstallCode = await runMarketplaceEntry(
      { sub: 'install', id: `minimal-code-plugin@${MARKET_NAME}` },
      instCode.options,
    );
    expect(codeInstallCode, `install 拒：${instCode.err.join('\n')}`).toBe(0);
    // —— ③' install 纯声明模板：declared-payload 零码收割——
    const instSkill = entryOptions(dataDir);
    const skillInstallCode = await runMarketplaceEntry(
      { sub: 'install', id: `pure-skill-pack@${MARKET_NAME}` },
      instSkill.options,
    );
    expect(skillInstallCode, `install 拒：${instSkill.err.join('\n')}`).toBe(0);

    // 账本双条目：market 注记两段全落 + 布局段 + 收割两形
    const ledger = readLedger(dataDir, createPluginStoreFs());
    if (!ledger.ok) throw new Error(`装机账本坏形：${ledger.reason}`);
    expect(ledger.entries).toHaveLength(2);
    const codeEntry = ledger.entries.find((e) => e.market?.entry === 'minimal-code-plugin');
    const skillEntry = ledger.entries.find((e) => e.market?.entry === 'pure-skill-pack');
    // 代码模板：清单 id（package name 承载）+ jiti 收割真跑（entry 无 events
    // 导出 → 空账——收割腿确实执行过而非被跳过的证据是空数组而非缺席键）
    expect(codeEntry).toMatchObject({
      id: 'berry-agent-example-minimal-code',
      source: 'local',
      installPath: join('plugins', 'market', MARKET_NAME, 'minimal-code-plugin'),
      market: { name: MARKET_NAME, entry: 'minimal-code-plugin' },
      declaredEvents: [],
    });
    // 纯声明模板：零码收割（declared-payload）
    expect(skillEntry).toMatchObject({
      id: 'berry-agent-example-pure-skill',
      source: 'local',
      installPath: join('plugins', 'market', MARKET_NAME, 'pure-skill-pack'),
      market: { name: MARKET_NAME, entry: 'pure-skill-pack' },
      declaredEvents: [],
    });
    // 装机物真落位：入口文件与技能载荷随树拷进装机树（B2 定形——装机物独立
    // 于缓存目录，marketplace remove 清缓存不悬空）
    const marketRoot = join(dataDir, 'plugins', 'market', MARKET_NAME);
    expect(existsSync(join(marketRoot, 'minimal-code-plugin', 'entry.js'))).toBe(true);
    expect(existsSync(join(marketRoot, 'pure-skill-pack', 'skills', 'markdown-table', 'SKILL.md'))).toBe(true);

    // —— ④ 装载可用：mount 两启用行（真身行编辑面）+ bootPlugins 真装载 ——
    expect(mountRow(dataDir, 'berry-agent-example-minimal-code', undefined, createPluginStoreFs())).toMatchObject({
      ok: true,
    });
    expect(mountRow(dataDir, 'berry-agent-example-pure-skill', undefined, createPluginStoreFs())).toMatchObject({
      ok: true,
    });
    const registered: string[] = []; // 命令注册表真身消费替身（装载可用的行为判据收集位）
    const boot = await bootPlugins({
      runtime: stubRuntime(dataDir),
      scope: Scope.createRoot(),
      dispatch: new EventDispatch(),
      commands: {
        register: (name) => {
          registered.push(name);
          return () => undefined;
        },
      },
      llm: { registerProvider: () => () => undefined },
      version: hostPkg.version ?? '0.0.0-test',
      // 装载门坐标真源：宿主 package.json apiVersion 补读（assembly
      // readHostApiVersion 同式——apiVersion 与 version 同文件双值）
      apiVersion: hostPkg.apiVersion ?? '1.0',
      warn: () => undefined,
    });
    // 两模板全进 activated（装载门 admit + jiti 求值零失败 + 行级零隔离）
    expect(boot.report.failed).toEqual([]);
    expect(boot.report.activated.map((a) => a.id).sort()).toEqual([
      'berry-agent-example-minimal-code',
      'berry-agent-example-pure-skill',
    ]);
    // 代码模板注册面真达：example-hello 命令进命令注册表（「装载可用」的
    // 行为判据——jiti 真求值 entry.js + ctx 注册动词真消费）
    expect(registered).toEqual(['example-hello']);
    // 纯声明模板：技能载荷目录账指向装机树内（非缓存非源目录——拷贝腿交付物）
    const skillRow = boot.report.activated.find((a) => a.id === 'berry-agent-example-pure-skill');
    expect(skillRow?.skillDirs).toEqual([join(marketRoot, 'pure-skill-pack', 'skills')]);
  }, 60_000);
});
