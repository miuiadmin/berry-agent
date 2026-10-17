/**
 * host/marketplace-examples-e2e —— marketplace local 源装机路径端到端回归锁
 * （00-立题-生态范式插件notify-telegram-20261016「顺路件（选项一）」节——
 * ⑦选项一落码腿；examples 双清单升格〔6af9533 零码批〕的配套码面锁）。
 *
 * 与 marketplace-cmd.test.ts 既有 e2e 的分野：那侧用**合成 fixture 市场仓**
 * 锁 CLI 编舞行为；本件锁**本仓自带的发货样例**——examples/ 真市场目录
 * （.claude-plugin/marketplace.json 双清单 + 四相对串条目〔notify 轻档 +
 * telegram-channel 重档两范式件〕）从 add 到装载
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
 *  2. discover：三相对串条目寻址形呈现（name@market）；
 *  3. install ×3：拷贝腿境二（local 缓存目录内子目录直拷零 spawn）落位
 *     plugins/market/<市场名>/<条目名>/；代码插件 jiti 收割真跑（模板
 *     entry 无 events 导出 → declaredEvents 空账；notify 件收割腿不注入
 *     import-gate——装机收割腿例外的 R3 口径，node:tls 声明收割不炸）、
 *     纯声明包零码收割；账本 market 注记三段全落；
 *  4. 装载可用：mountRow 真启用行 + bootPlugins 真装载管线（真盘真 jiti
 *     真装载门——apiVersion 真源取宿主 package.json，assembly
 *     readHostApiVersion 同式补读）：两模板 id 进 activated、代码模板注册的
 *     example-hello 命令真达命令注册表（装载可用的行为判据）、纯声明模板
 *     skillDirs 指向装机树内（B2 定形——独立于缓存与源目录）。
 *     notify 件（R3 受门内建首个真实消费者）以**零开门行**装载——期望
 *     形 = 行级拒载 `PLUGIN_NODE_BUILTIN_FORBIDDEN`（生效集 = 清单声明 ∩
 *     开门 = 空），两模板不受牵连（行级隔离的活体锁——grants.node-builtins
 *     只行 opens 独面，e2e 装配面无开门路即缺省关）。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import { afterAll, describe, expect, it } from 'vitest';

import { EventDispatch, Scope } from '../context/index.js';
import type { UiBackend } from '../contracts/index.js';

import { enabledYamlPath } from './manifest.js';
import { runMarketplaceEntry } from './marketplace-cmd.js';
import type { MarketplaceEntryOptions } from './marketplace-cmd.js';
import { bootPlugins } from './plugin-boot.js';
import { createMarketFs } from './plugin-market/fs.js';
import { readMarketplaceSources } from './plugin-market/registry.js';
import { createPluginStoreFs, mountRow, readLedger } from './plugin-store.js';
import type { HostRuntime } from './runtime.js';
import { TriggerRegistry } from './triggers.js';

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

describe('marketplace local 源装机路径 e2e（examples 真市场目录——add → discover → install → 装载可用）', () => {
  it('全链绿：源入册 → 缓存物化 → 条目呈现 → 三条目拷贝腿装机 → 真装载注册面真达 + notify 零开门行级拒载（R3 狗粮锁）', async () => {
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

    // —— ② discover：三相对串条目寻址形呈现（鲜缓存零回源——零网络）——
    const disc = entryOptions(dataDir);
    expect(await runMarketplaceEntry({ sub: 'discover' }, disc.options)).toBe(0);
    const discText = disc.out.join('\n');
    expect(discText).toContain(`minimal-code-plugin@${MARKET_NAME}`);
    expect(discText).toContain(`pure-skill-pack@${MARKET_NAME}`);
    expect(discText).toContain(`notify-plugin@${MARKET_NAME}`);

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
    // —— ③'' install notify 范式件：R3 受门内建件装机（收割腿不注入 import-gate
    // ——node:tls/net 声明收割零炸；拒载形只在装载段，见 ④）——
    const instNotify = entryOptions(dataDir);
    const notifyInstallCode = await runMarketplaceEntry(
      { sub: 'install', id: `notify-plugin@${MARKET_NAME}` },
      instNotify.options,
    );
    expect(notifyInstallCode, `install 拒：${instNotify.err.join('\n')}`).toBe(0);

    // 账本三条目：market 注记三段全落 + 布局段 + 收割两形
    const ledger = readLedger(dataDir, createPluginStoreFs());
    if (!ledger.ok) throw new Error(`装机账本坏形：${ledger.reason}`);
    expect(ledger.entries).toHaveLength(3);
    const codeEntry = ledger.entries.find((e) => e.market?.entry === 'minimal-code-plugin');
    const skillEntry = ledger.entries.find((e) => e.market?.entry === 'pure-skill-pack');
    const notifyEntry = ledger.entries.find((e) => e.market?.entry === 'notify-plugin');
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
    // notify 范式件：同一拷贝腿 + jiti 收割真跑（entry 无 events 导出 → 空账
    // ——收割腿确实执行过而非被跳过的证据是空数组而非缺席键）
    expect(notifyEntry).toMatchObject({
      id: 'berry-agent-example-notify',
      source: 'local',
      installPath: join('plugins', 'market', MARKET_NAME, 'notify-plugin'),
      market: { name: MARKET_NAME, entry: 'notify-plugin' },
      declaredEvents: [],
    });
    // 装机物真落位：入口文件与技能载荷随树拷进装机树（B2 定形——装机物独立
    // 于缓存目录，marketplace remove 清缓存不悬空）
    const marketRoot = join(dataDir, 'plugins', 'market', MARKET_NAME);
    expect(existsSync(join(marketRoot, 'minimal-code-plugin', 'entry.js'))).toBe(true);
    expect(existsSync(join(marketRoot, 'pure-skill-pack', 'skills', 'markdown-table', 'SKILL.md'))).toBe(true);
    expect(existsSync(join(marketRoot, 'notify-plugin', 'entry.js'))).toBe(true);

    // —— ④ 装载可用：mount 两启用行（真身行编辑面）+ bootPlugins 真装载 ——
    expect(mountRow(dataDir, 'berry-agent-example-minimal-code', undefined, createPluginStoreFs())).toMatchObject({
      ok: true,
    });
    expect(mountRow(dataDir, 'berry-agent-example-pure-skill', undefined, createPluginStoreFs())).toMatchObject({
      ok: true,
    });
    // notify 件启用行：零 opens 零 config 装载（grants.node-builtins 只行 opens
    // 独面——e2e 装配面无开门路即缺省关；缺 config 键 = 激活期逐后端 warn
    // 降级形，但到不了激活——装载段即拒，见下）
    expect(mountRow(dataDir, 'berry-agent-example-notify', undefined, createPluginStoreFs())).toMatchObject({
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
    expect(boot.report.activated.map((a) => a.id).sort()).toEqual([
      'berry-agent-example-minimal-code',
      'berry-agent-example-pure-skill',
    ]);
    // notify 件行级拒载（R3 狗粮锁——真装配面）：生效集 = 清单声明两枚 ∩
    // 开门零枚 = 空 → import-gate 在 node:tls 字面量腿即拒；分码分归因 =
    // PLUGIN_NODE_BUILTIN_FORBIDDEN（非泛化 PLUGIN_IMPORT_FORBIDDEN）；
    // 两模板照常 activated = 行级隔离的活体证据（「一个插件挡全部装载」过重
    // ——R3 拒载零牵连）
    expect(boot.report.failed).toHaveLength(1);
    expect(boot.report.failed[0]).toMatchObject({
      id: 'berry-agent-example-notify',
      code: 'PLUGIN_NODE_BUILTIN_FORBIDDEN',
    });
    // 代码模板注册面真达：example-hello 命令进命令注册表（「装载可用」的
    // 行为判据——jiti 真求值 entry.js + ctx 注册动词真消费）
    expect(registered).toEqual(['example-hello']);
    // 纯声明模板：技能载荷目录账指向装机树内（非缓存非源目录——拷贝腿交付物）
    const skillRow = boot.report.activated.find((a) => a.id === 'berry-agent-example-pure-skill');
    expect(skillRow?.skillDirs).toEqual([join(marketRoot, 'pure-skill-pack', 'skills')]);
  }, 60_000);

  it('telegram 双向渠道件：零开门行级拒载（门义务呈现）→ 三门开后零 token 装载活体（降级 warn、零循环、零网络断言）', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'berry-mkt-examples-tg-'));
    dirs.push(dataDir);

    // —— ① add + install：同一市场源第 4 条目（双清单扩容的装机面证）——
    const add = entryOptions(dataDir);
    expect(await runMarketplaceEntry({ sub: 'add', source: examplesDir }, add.options)).toBe(0);
    const inst = entryOptions(dataDir);
    const installCode = await runMarketplaceEntry(
      { sub: 'install', id: `telegram-channel@${MARKET_NAME}` },
      inst.options,
    );
    expect(installCode, `install 拒：${inst.err.join('\n')}`).toBe(0);
    // 账本：market 注记三段 + 布局段 + jiti 收割真跑（entry 无 events 导出 → 空账
    // ——空数组而非缺席键 = 收割腿确实执行过的证据）
    const ledger = readLedger(dataDir, createPluginStoreFs());
    if (!ledger.ok) throw new Error(`装机账本坏形：${ledger.reason}`);
    const tgEntry = ledger.entries.find((e) => e.market?.entry === 'telegram-channel');
    expect(tgEntry).toMatchObject({
      id: 'berry-agent-example-telegram-channel',
      source: 'local',
      installPath: join('plugins', 'market', MARKET_NAME, 'telegram-channel'),
      market: { name: MARKET_NAME, entry: 'telegram-channel' },
      declaredEvents: [],
    });
    expect(existsSync(join(dataDir, 'plugins', 'market', MARKET_NAME, 'telegram-channel', 'entry.js'))).toBe(true);

    // —— ② mount 零 opens → 行级拒载（R3 门义务呈现——notify 段同形断言）：
    // 生效集 = 清单声明 node:https ∩ 开门零枚 = 空 → 源扫/装载门拒；
    // 分码 PLUGIN_NODE_BUILTIN_FORBIDDEN（非泛化 PLUGIN_IMPORT_FORBIDDEN）——
    // 受门内建的诚实消费者形（对照 notify 件 node:tls/net 双声明）——
    const mount = mountRow(dataDir, 'berry-agent-example-telegram-channel', undefined, createPluginStoreFs());
    expect(mount).toMatchObject({ ok: true });
    const bootA = await bootPlugins({
      runtime: stubRuntime(dataDir),
      scope: Scope.createRoot(),
      dispatch: new EventDispatch(),
      commands: { register: () => () => undefined },
      llm: { registerProvider: () => () => undefined },
      version: hostPkg.version ?? '0.0.0-test',
      apiVersion: hostPkg.apiVersion ?? '1.0',
      warn: () => undefined,
    });
    expect(bootA.report.activated).toEqual([]);
    expect(bootA.report.failed).toHaveLength(1);
    expect(bootA.report.failed[0]).toMatchObject({
      id: 'berry-agent-example-telegram-channel',
      code: 'PLUGIN_NODE_BUILTIN_FORBIDDEN',
    });

    // —— ③ 开门义务兑现：enabled.yaml 行 opens 直写（mountRow 只写 {id, config}
    // ——opens 是行级独面，须直写启用清单；三真门 + grants.node-builtins 插件道
    // 只此一源）——
    const rowsDoc = parseYaml(readFileSync(enabledYamlPath(dataDir), 'utf8')) as {
      plugins: Array<{ id: string; opens?: string[] }>;
    };
    const tgRow = rowsDoc.plugins.find((row) => row.id === 'berry-agent-example-telegram-channel');
    if (tgRow === undefined) throw new Error('启用清单缺 telegram 行（mountRow 落位失败）');
    tgRow.opens = ['channels.ui-backend', 'triggers.start-run', 'grants.node-builtins'];
    writeFileSync(enabledYamlPath(dataDir), stringifyYaml(rowsDoc));

    // —— ④ 全装配 boot：零 token 装载活体（凭证缺席 → warn 降级、收发循环
    // 不起——零 token 即零请求，本段不断言网络面）——
    const registeredBackends: string[] = [];
    const triggers = new TriggerRegistry({
      getOpens: () => new Set(['triggers.start-run']),
      makeStarter: () => () => undefined,
    });
    const notifies: { message: string; level?: string }[] = [];
    const bootB = await bootPlugins({
      runtime: stubRuntime(dataDir),
      scope: Scope.createRoot(),
      dispatch: new EventDispatch(),
      commands: { register: () => () => undefined },
      llm: { registerProvider: () => () => undefined },
      triggers,
      uiBackends: {
        registerPluginBackend: (backend: UiBackend<never>) => {
          registeredBackends.push(backend.id);
          return () => undefined;
        },
      },
      channelsUi: {
        notify: (message: string, opts?: { level?: 'info' | 'success' | 'warn' | 'error' }) =>
          notifies.push({ message, level: opts?.level }),
        confirm: () => Promise.resolve(false),
        select: () => Promise.resolve(''),
        input: () => Promise.resolve(''),
        setStatus: () => undefined,
        setWidget: () => undefined,
        hasAudience: () => false,
        isSessionLive: () => true,
      },
      version: hostPkg.version ?? '0.0.0-test',
      apiVersion: hostPkg.apiVersion ?? '1.0',
      warn: () => undefined,
    });
    // 装载活：零失败 + 进 activated（开门兑现即修复装载——README 开门义务清单的行为证）
    expect(bootB.report.failed).toEqual([]);
    expect(bootB.report.activated.map((a) => a.id)).toEqual(['berry-agent-example-telegram-channel']);
    // 双注册面真达：TG 后端入界面后端注册表 + 触发器入册（域名两段式 + owner 归因）
    expect(registeredBackends).toEqual(['telegram']);
    expect(triggers.list().map((t) => t.name)).toEqual(['berry-agent-example-telegram-channel/tg-message']);
    expect(triggers.list()[0]?.owner).toBe('berry-agent-example-telegram-channel');
    // 零 token 降级 warn：指路录入命令完整在场（凭证名 + 自域 namespace + 录入
    // 动词——人面可复制即用的降级可诊面；凭证缺席→循环零起）；token 值位卫生
    // 锁归 lifecycle 件锚三（e2e 零 token 语境无值可漏——恒真断言不留）
    const tokenWarn = notifies.find((n) => n.level === 'warn' && n.message.includes('telegram-bot-token'));
    expect(tokenWarn).toBeDefined();
    expect(tokenWarn?.message).toContain('berry credentials add telegram-bot-token');
    expect(tokenWarn?.message).toContain('--namespace plugin:berry-agent-example-telegram-channel');
  }, 60_000);
});
