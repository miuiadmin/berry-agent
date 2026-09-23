/**
 * host/marketplace-tui-face 测试——mp-5 TUI 选装面编舞件（03 §9.6）：
 * 装配位锁（行集纯数据 + 自由文本消毒〔注入面消毒锁〕+ 空态两分 + 已装徽标
 * 对拍 + 开屏零网络〔runEntry 零调用〕）、install 编舞三段（busy 置位 →
 * 执行 → settle 回执/notify 归因/reload 自动链）、busy 单槽并发拒、失败/
 * 内部异常呈现、双相 uninstall 三形（cancel 不执行 / keep / purge 载荷分派
 * + 核查失败短路）、refresh 恒回源（runEntry 恰收 {sub:'update'} 全源动词
 * ——修前红位：TTL 惰性腿/带名过滤形均红）、dataDir null 诚实拒、副屏占用
 * warn、真服务面集成（真 runMarketplaceEntry：install 真落账徽标翻转 +
 * update 真换血新条目可见——消费服务面零绕过的全链锁）；
 * 编舞①开跑行锁（修前红位：runEntry 未决期 notify 已收到开跑行——四动作
 * 各一条 + uninstall 双相全程恰一行〔inspect 起跑位发、execute 相不重复〕）；
 * 编舞④自动链提示行锁（修前红位：成功且 reload 形 notify 序列含「已自动链
 * /reload」完整句——与 /plugins 写动词尾句单源同文；refresh/失败/异常形
 * 零该词）；
 * fire-and-forget 兜底锁（修前红位：编舞柄异常〔裁决面 reject / settle 腿
 * repaint 抛错〕不炸 unhandledRejection——busy 槽释放 + notify error 呈报）。
 *
 * mock 边界：数据面全真（tmp 数据目录 + 真 createMarketFs + 真服务面），
 * fake 只停编舞柄（notify/confirm/reload/repaint/openPanel/runEntry〔假件
 * 组〕——与 CLI e2e「mock 只停呈现位与传输位」同律）。
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import fsp from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { MarketPanelActions, MarketPanelModel } from '../channels/tui/panels/market-picker.js';
import type { MarketplaceCommand } from './cli.js';
import { MarketplaceTuiFace } from './marketplace-tui-face.js';
import type { EntryCapture, UninstallChoice } from './marketplace-tui-face.js';
import { runMarketplaceEntry } from './marketplace-cmd.js';
import { createMarketFs } from './plugin-market/fs.js';
import { createPluginStoreFs, readLedger } from './plugin-store.js';

/** 测试根 tmp（vitest 每文件钉数据目录纪律——自管 tmp 收尾自清） */
const testRoot = mkdtempSync(join(tmpdir(), 'berry-marketplace-tui-face-test-'));
afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

/** 微任务冲刷（fire-and-forget 编舞确定性收口——双相链最深 ~5 await） */
const flush = async (times = 12): Promise<void> => {
  for (let i = 0; i < times; i++) await Promise.resolve();
};

/** 延迟决议器（busy 在飞窗的确定性控制） */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** 声明载荷插件 fixture（berryAgent.skills 在场 = declared-payload——零码收割零 jiti） */
function declaredPkgJson(id: string, version = '1.0.0'): string {
  return `${JSON.stringify({ name: id, version, berryAgent: { id, skills: ['greet'] } }, null, 2)}\n`;
}

/**
 * 本地市场仓 fixture（marketplace-cmd.test.ts 同构）：目录名随调用名保唯一、
 * catalog 市场名恒 alpha（断言里的寻址形 `name@alpha` 单一稳定——目录名不入
 * 寻址）；description 含换行与 ANSI 控制字符——注入面消毒锁的料源。
 */
function seedMarketRepo(name: string): string {
  const repo = join(testRoot, `${name}-repo`);
  mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(repo, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({
      name: 'alpha',
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

/** 空目录市场仓 fixture（源在册零条目形——市场名同恒 alpha） */
function seedEmptyRepo(name: string): string {
  const repo = join(testRoot, `${name}-repo`);
  mkdirSync(join(repo, '.claude-plugin'), { recursive: true });
  writeFileSync(
    join(repo, '.claude-plugin', 'marketplace.json'),
    JSON.stringify({ name: 'alpha', owner: { name: 'o' }, plugins: [] }),
  );
  return repo;
}

/** rig 选项 */
interface RigOptions {
  /** 面 runEntry 假件（缺席 = 缺省假件「退 0 + 单行假回执」） */
  readonly runEntry?: (sub: MarketplaceCommand, capture: EntryCapture) => Promise<number>;
  /** 双相第二相裁决值（缺席 = cancel） */
  readonly confirm?: UninstallChoice;
  /** 双相第二相裁决面真身覆写（缺席 = 返回 confirm 选项值的假件——reject 形注入位） */
  readonly confirmUninstallImpl?: (inspectText: string) => Promise<UninstallChoice>;
  /** 副屏重画柄真身覆写（缺席 = no-op 假件——抛错形注入位） */
  readonly repaintImpl?: () => void;
  /** 开副屏返值（缺席 = true） */
  readonly openPanelResult?: boolean;
  /** 已装键集初值（可变闭包——refresh 重建行集观测位） */
  readonly installedKeys?: ReadonlySet<string>;
  /** 跳过源 add（零源空态形） */
  readonly skipAdd?: boolean;
  /** 用空目录仓（源在册零条目形） */
  readonly emptyRepo?: boolean;
}

/**
 * 面装配 rig：真 tmp 数据目录 + 真服务面 add（源入册 + 缓存快照零网络——
 * local 源）+ fake 编舞柄。返回面实例与全柄（断言位）。
 */
async function rigFace(
  name: string,
  options: RigOptions = {},
): Promise<{
  readonly face: MarketplaceTuiFace;
  readonly model: () => MarketPanelModel;
  readonly actions: () => MarketPanelActions;
  readonly runEntry: ReturnType<typeof vi.fn>;
  readonly notify: ReturnType<typeof vi.fn>;
  readonly confirmUninstall: ReturnType<typeof vi.fn>;
  readonly requestReload: ReturnType<typeof vi.fn>;
  readonly repaint: ReturnType<typeof vi.fn>;
  readonly openPanel: ReturnType<typeof vi.fn>;
  readonly setInstalledKeys: (next: ReadonlySet<string>) => void;
  readonly dataDir: string;
  readonly repo: string | null;
}> {
  const dataDir = join(testRoot, name);
  mkdirSync(dataDir, { recursive: true });
  const repo =
    options.skipAdd === true
      ? null
      : options.emptyRepo === true
        ? seedEmptyRepo(`${name}-alpha`)
        : seedMarketRepo(`${name}-alpha`);
  if (repo !== null) {
    // 真服务面 add（不经面 runEntry——装配前置现场，local 源零网络；回执收集
    // 不落测试 stdout——噪音控制）
    const code = await runMarketplaceEntry(
      { sub: 'add', source: repo },
      { dataDir, env: {}, writeOut: () => {}, writeErr: () => {} },
    );
    expect(code).toBe(0);
  }
  const defaultRunEntry = vi.fn(async (sub: MarketplaceCommand, capture: EntryCapture): Promise<number> => {
    capture.writeOut(`〔假回执〕marketplace ${sub.sub} 完成`);
    return 0;
  });
  const runEntry = vi.fn(options.runEntry ?? defaultRunEntry);
  let installedKeys = options.installedKeys ?? new Set<string>();
  /** 已装键集翻转器（refresh settle 行集重建的观测位——ledgerMarketKeys 闭包换血） */
  const setInstalledKeys = (next: ReadonlySet<string>): void => {
    installedKeys = next;
  };
  const notify = vi.fn();
  const confirmUninstall = vi.fn(
    options.confirmUninstallImpl ??
      (async (_inspectText: string): Promise<UninstallChoice> => options.confirm ?? 'cancel'),
  );
  const requestReload = vi.fn();
  const repaint = vi.fn(options.repaintImpl ?? (() => undefined));
  const openPanel = vi.fn(
    (_model: MarketPanelModel, _actions: MarketPanelActions): boolean => options.openPanelResult ?? true,
  );
  const face = new MarketplaceTuiFace({
    dataDir,
    fs: createMarketFs(),
    now: () => new Date(),
    runEntry: (sub, capture) => runEntry(sub, capture),
    notify,
    confirmUninstall,
    requestReload,
    repaint,
    ledgerMarketKeys: () => installedKeys,
    openPanel,
  });
  return {
    face,
    // 开屏后模型/动作取 openPanel 首参（host 拥有可变对象——面板每帧现读）
    model: () => openPanel.mock.calls[0]![0],
    actions: () => openPanel.mock.calls[0]![1],
    runEntry,
    notify,
    confirmUninstall,
    requestReload,
    repaint,
    openPanel,
    setInstalledKeys,
    dataDir,
    repo,
  };
}

describe('MarketplaceTuiFace 装配位（open）', () => {
  it('行集纯数据注入 + 自由文本消毒（注入面消毒锁）+ 已装徽标对拍 + 开屏零网络（runEntry 零调用）', async () => {
    const rig = await rigFace('open-baseline', { installedKeys: new Set(['demo-pkg@alpha']) });
    await rig.face.open();
    expect(rig.openPanel).toHaveBeenCalledTimes(1);
    const model = rig.model();
    // 行集 = 两条目（catalog 序）——id 寻址形原样（动作寻址单源）
    const ids = model.rows.map((row) => row.id).sort();
    expect(ids).toEqual(['demo-pkg@alpha', 'hello-plugin@alpha']);
    // 消毒锁：description 携 \n 与 ESC（catalog 原文）——行集字段已剥控制字符
    // eslint-disable-next-line no-control-regex -- 消毒锁恰是控制字符的执法断言位
    const ctrl = /[\x00-\x1f\x7f-\x9f]/;
    for (const row of model.rows) {
      expect(ctrl.test(row.name), `name 漏控制字符：${JSON.stringify(row.name)}`).toBe(false);
      expect(ctrl.test(row.version), `version 漏控制字符：${JSON.stringify(row.version)}`).toBe(false);
      expect(ctrl.test(row.market), `market 漏控制字符：${JSON.stringify(row.market)}`).toBe(false);
      if (row.description !== undefined) {
        expect(ctrl.test(row.description), `description 漏控制字符：${JSON.stringify(row.description)}`).toBe(false);
      }
    }
    const hello = model.rows.find((row) => row.id === 'hello-plugin@alpha')!;
    expect(hello.description).toContain('问好插件'); // 消毒后可读段保留
    expect(hello.installed).toBe(false); // 不在键集——无徽标
    expect(model.rows.find((row) => row.id === 'demo-pkg@alpha')!.installed).toBe(true); // 键集对拍
    // 初始态：无空态文案、无 busy、无回执
    expect(model.tail).toEqual([]);
    expect(model.busyLabel).toBeNull();
    expect(model.results).toEqual([]);
    // 动作面：恰四函数（面板分派位——纯注入）
    const actions = rig.actions();
    for (const key of ['install', 'uninstall', 'upgrade', 'refresh'] as const) {
      expect(typeof actions[key]).toBe('function');
    }
    // 开屏零网络：runEntry 零调用（行集纯读缓存——fetch 注入位在面依赖上不存在）
    expect(rig.runEntry).not.toHaveBeenCalled();
  });

  it('空态两分：零源出厂 vs 源在册零条目——两文案 host 侧拼进 tail', async () => {
    const zero = await rigFace('open-zero-sources', { skipAdd: true });
    await zero.face.open();
    expect(zero.model().rows).toEqual([]);
    expect(zero.model().tail.join('\n')).toContain('无市场源');
    expect(zero.model().tail.join('\n')).toContain('berry marketplace add');

    const empty = await rigFace('open-empty-repo', { emptyRepo: true });
    await empty.face.open();
    expect(empty.model().rows).toEqual([]);
    expect(empty.model().tail.join('\n')).toContain('源在册但零条目');
  });

  it('dataDir null = 诚实拒（不开屏不炸）', async () => {
    const notify = vi.fn();
    const openPanel = vi.fn((): boolean => true);
    const face = new MarketplaceTuiFace({
      dataDir: null,
      fs: createMarketFs(),
      now: () => new Date(),
      runEntry: vi.fn(async () => 0),
      notify,
      confirmUninstall: vi.fn(async (_inspectText: string): Promise<UninstallChoice> => 'cancel'),
      requestReload: vi.fn(),
      repaint: vi.fn(),
      ledgerMarketKeys: () => new Set<string>(),
      openPanel,
    });
    await face.open();
    expect(openPanel).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0]).toContain('数据目录不在场');
  });

  it('副屏占用如实 warn（openPanel false——不排队不顶替）', async () => {
    const rig = await rigFace('open-occupied', { openPanelResult: false });
    await rig.face.open();
    expect(rig.openPanel).toHaveBeenCalledTimes(1); // 试过一次
    expect(rig.notify).toHaveBeenCalledTimes(1);
    expect(rig.notify.mock.calls[0]![0]).toContain('副屏占用');
  });
});

describe('MarketplaceTuiFace 长动作编舞', () => {
  it('install 三段：busy 置位（清回执）→ runEntry 恰收 install 动词 → settle 回执/notify 归因/reload 自动链', async () => {
    const gate = deferred<number>();
    const rig = await rigFace('install-choreo', {
      runEntry: (sub, capture) => {
        expect(sub).toEqual({ sub: 'install', id: 'hello-plugin@alpha' });
        capture.writeOut('已装机：hello-plugin 1.0.0');
        capture.writeOut('装机 ≠ 启用——启用第二步：berry plugins mount hello-plugin');
        return gate.promise;
      },
    });
    await rig.face.open();
    const model = rig.model();
    // 既有回执在场——动作起跑让位（清槽观测位）；接口面 readonly，测试侧经可变态窄面注入
    (model as unknown as { results: string[] }).results = ['上一笔回执'];
    rig.actions().install('hello-plugin@alpha');
    await flush(2);
    // 段一：busy 置位 + 旧回执清 + repaint 已请（fire-and-forget 不阻塞调用面）
    expect(model.busyLabel).toContain('装机在飞中');
    expect(model.busyLabel).toContain('hello-plugin@alpha');
    expect(model.results).toEqual([]);
    expect(rig.repaint).toHaveBeenCalled();
    expect(rig.runEntry).toHaveBeenCalledTimes(1);
    gate.resolve(0);
    await flush();
    // 段三 settle：busy 清 + 回执全文逐行 + notify 完成归因 + reload 自动链
    expect(model.busyLabel).toBeNull();
    expect(model.results.join('\n')).toContain('已装机：hello-plugin');
    expect(model.results.join('\n')).toContain('berry plugins mount hello-plugin');
    expect(rig.requestReload).toHaveBeenCalledTimes(1);
    // settle 双行（扩尾）：完成归因行在前 + 自动链提示行随后（编舞④——第二行）
    const messages = rig.notify.mock.calls.map((call) => String(call[0]));
    const doneIdx = messages.findIndex((m) => m.includes('marketplace install hello-plugin@alpha 完成'));
    expect(doneIdx).toBeGreaterThanOrEqual(0);
    expect(rig.notify.mock.calls[doneIdx]![1]).toEqual({ level: 'info' });
    const chain = '已自动链 /reload（会话运行中自动排队，run 收场后执行）';
    expect(messages).toContain(chain); // 与 /plugins 写动词尾句（plugins-command）单源同文
    expect(messages.indexOf(chain)).toBeGreaterThan(doneIdx); // 序：完成行在前、链提示随后
  });

  it('busy 单槽并发拒：在飞窗第二动作 notify warn + runEntry 仍恰一次', async () => {
    const gate = deferred<number>();
    const rig = await rigFace('busy-slot', {
      runEntry: () => gate.promise,
    });
    await rig.face.open();
    const model = rig.model();
    rig.actions().install('hello-plugin@alpha');
    await flush(2);
    // 在飞窗：三动作再发全拒（busy 单槽第二道闸——面板锁键是第一道）
    rig.actions().upgrade('hello-plugin@alpha');
    rig.actions().refresh();
    rig.actions().uninstall('hello-plugin@alpha');
    await flush(2);
    expect(rig.runEntry).toHaveBeenCalledTimes(1); // 只有第一笔在飞
    const rejects = rig.notify.mock.calls.filter((call) => String(call[0]).includes('未发'));
    expect(rejects).toHaveLength(3);
    for (const call of rejects) {
      expect(String(call[0])).toContain('装机在飞中'); // busyLabel 原文嵌入（fail-loud 不猜语义）
      expect(call[1]).toEqual({ level: 'warn' });
    }
    expect(model.busyLabel).not.toBeNull(); // 第一笔不受扰
    gate.resolve(0);
    await flush();
    expect(model.busyLabel).toBeNull();
  });

  it('失败呈现：退出码非 0 → 回执呈现 + notify 失败档 + 无 reload', async () => {
    const rig = await rigFace('install-failed', {
      runEntry: (_sub, capture) => {
        capture.writeErr('装机拒绝：条目不在场（hello-plugin@alpha）');
        return Promise.resolve(1);
      },
    });
    await rig.face.open();
    const model = rig.model();
    rig.actions().install('hello-plugin@alpha');
    await flush();
    expect(model.busyLabel).toBeNull();
    expect(model.results.join('\n')).toContain('装机拒绝：条目不在场');
    expect(rig.requestReload).not.toHaveBeenCalled();
    const last = rig.notify.mock.calls.at(-1)!;
    expect(last[0]).toContain('marketplace install hello-plugin@alpha 失败');
    expect(last[0]).toContain('退出码 1');
    expect(last[1]).toEqual({ level: 'warn' });
  });

  it('runEntry 内部异常也结算（fire-and-forget 不静默不 unhandled）', async () => {
    const rig = await rigFace('install-crash', {
      runEntry: () => Promise.reject(new Error('spawn 通道崩了')),
    });
    await rig.face.open();
    const model = rig.model();
    rig.actions().install('hello-plugin@alpha');
    await flush();
    expect(model.busyLabel).toBeNull(); // 槽必释放
    expect(model.results.join('\n')).toContain('内部异常');
    expect(model.results.join('\n')).toContain('spawn 通道崩了');
    const last = rig.notify.mock.calls.at(-1)!;
    expect(last[0]).toContain('内部异常');
    expect(last[1]).toEqual({ level: 'error' });
  });

  it('upgrade：单件点名动词恰达 + reload 自动链（换装编舞）', async () => {
    const rig = await rigFace('upgrade-choreo', {
      installedKeys: new Set(['hello-plugin@alpha']),
    });
    await rig.face.open();
    const model = rig.model();
    rig.actions().upgrade('hello-plugin@alpha');
    // busy 置位同步观察（runLong 首个 await 前已置——假件立即决议，flush 后即 settle）
    expect(model.busyLabel).toContain('换装在飞中');
    expect(rig.runEntry).toHaveBeenCalledWith({ sub: 'upgrade', id: 'hello-plugin@alpha' }, expect.anything());
    await flush();
    expect(model.busyLabel).toBeNull();
    expect(rig.requestReload).toHaveBeenCalledTimes(1);
  });

  it('refresh 恒回源（修前红位）：runEntry 恰收全源 update 动词（零名过滤、非 discover/TTL 腿）+ settle 行集重建现读键集', async () => {
    const rig = await rigFace('refresh-update-verb', { installedKeys: new Set(['hello-plugin@alpha']) });
    await rig.face.open();
    const model = rig.model();
    expect(model.rows.find((row) => row.id === 'hello-plugin@alpha')!.installed).toBe(true);
    rig.runEntry.mockImplementation(async (sub: MarketplaceCommand, capture: EntryCapture) => {
      // 修前红位：动词必须是 update（恒回源强制重取真身）——discover/TTL 形即红
      expect(sub).toEqual({ sub: 'update' });
      capture.writeOut('alpha：已刷新（local 换血）');
      return 0;
    });
    // 已装键集翻空（账本侧变化）——refresh settle 的 onSettle 重建行集应现读新值
    rig.setInstalledKeys(new Set<string>());
    rig.actions().refresh();
    // busy 置位同步观察（runLong 首个 await 前已置——假件微任务决议，flush 后即 settle）
    expect(model.busyLabel).toContain('市场刷新在飞中');
    await flush();
    expect(model.busyLabel).toBeNull();
    expect(model.results.join('\n')).toContain('alpha：已刷新');
    expect(rig.requestReload).not.toHaveBeenCalled(); // 刷新不动装载面
    // 行集重建观测：settle 后（无再开屏）徽标已翻——onSettle 里 rebuildRows 已跑
    expect(model.rows.find((row) => row.id === 'hello-plugin@alpha')!.installed).toBe(false);
  });

  it('m1 编舞④自动链提示行（修前必红）：install 成功且 reload → notify 序列含「已自动链 /reload」完整句（完成行之后）', async () => {
    const gate = deferred<number>();
    const rig = await rigFace('chain-notify-install', {
      runEntry: (_sub, capture) => {
        capture.writeOut('已装机：hello-plugin 1.0.0');
        return gate.promise;
      },
    });
    await rig.face.open();
    rig.actions().install('hello-plugin@alpha');
    await flush(2);
    gate.resolve(0);
    await flush();
    expect(rig.requestReload).toHaveBeenCalledTimes(1); // 链真身在先（既有律）
    const messages = rig.notify.mock.calls.map((call) => String(call[0]));
    const chain = '已自动链 /reload（会话运行中自动排队，run 收场后执行）';
    expect(messages).toContain(chain); // 完整句同文（plugins-command 尾句单源——防漂移锚）
    const doneIdx = messages.findIndex((m) => m.includes('marketplace install hello-plugin@alpha 完成'));
    expect(doneIdx).toBeGreaterThanOrEqual(0);
    expect(messages.indexOf(chain)).toBeGreaterThan(doneIdx); // 完成行在前、链提示随后
    expect(rig.notify.mock.calls[messages.indexOf(chain)]![1]).toEqual({ level: 'info' });
  });

  it('m1 refresh（reload=false）成功：notify 全程无「已自动链」词（刷新不动装载面零链提示）', async () => {
    const rig = await rigFace('chain-notify-refresh-absent', {});
    await rig.face.open();
    rig.actions().refresh();
    await flush();
    const messages = rig.notify.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes('marketplace update 完成'))).toBe(true); // 成功确在
    expect(messages.some((m) => m.includes('已自动链'))).toBe(false); // 零链提示词
  });

  it('m1 失败 / 内部异常形：notify 无「已自动链」词（失败尾零 reload 零链提示）', async () => {
    const failed = await rigFace('chain-notify-failed', {
      runEntry: (_sub, capture) => {
        capture.writeErr('装机拒绝：条目不在场');
        return Promise.resolve(1);
      },
    });
    await failed.face.open();
    failed.actions().install('hello-plugin@alpha');
    await flush();
    expect(failed.notify.mock.calls.some((call) => String(call[0]).includes('已自动链'))).toBe(false);

    const crashed = await rigFace('chain-notify-crash', {
      runEntry: () => Promise.reject(new Error('spawn 通道崩了')),
    });
    await crashed.face.open();
    crashed.actions().install('hello-plugin@alpha');
    await flush();
    expect(crashed.notify.mock.calls.some((call) => String(call[0]).includes('已自动链'))).toBe(false);
  });

  it('m2 install 开跑行（修前必红）：runEntry 未决期开跑 notify 已到，结束行随后（序断言）', async () => {
    const gate = deferred<number>();
    const rig = await rigFace('start-notify-install', {
      runEntry: () => gate.promise,
    });
    await rig.face.open();
    rig.actions().install('hello-plugin@alpha');
    await flush(2);
    // 在飞窗（runEntry 未决）：开跑行已 notify——enter 路副屏已收，本行是 30s+ 等待期主屏唯一反馈
    expect(rig.runEntry).toHaveBeenCalledTimes(1);
    const inflight = rig.notify.mock.calls.map((call) => String(call[0]));
    const startIdx = inflight.findIndex((m) => m.includes('marketplace install hello-plugin@alpha 开跑'));
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(rig.notify.mock.calls[startIdx]![1]).toEqual({ level: 'info' });
    expect(inflight.some((m) => m.includes('marketplace install hello-plugin@alpha 完成'))).toBe(false); // 结束行未到
    gate.resolve(0);
    await flush();
    const settled = rig.notify.mock.calls.map((call) => String(call[0]));
    const doneIdx = settled.findIndex((m) => m.includes('marketplace install hello-plugin@alpha 完成'));
    expect(doneIdx).toBeGreaterThan(startIdx); // 开跑在先、结束随后
  });

  it('m2 upgrade 开跑行（修前必红）：runEntry 未决期开跑 notify 已到', async () => {
    const gate = deferred<number>();
    const rig = await rigFace('start-notify-upgrade', {
      installedKeys: new Set(['hello-plugin@alpha']),
      runEntry: () => gate.promise,
    });
    await rig.face.open();
    rig.actions().upgrade('hello-plugin@alpha');
    await flush(2);
    expect(rig.runEntry).toHaveBeenCalledTimes(1);
    const inflight = rig.notify.mock.calls.map((call) => String(call[0]));
    const startIdx = inflight.findIndex((m) => m.includes('marketplace upgrade hello-plugin@alpha 开跑'));
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(inflight.some((m) => m.includes('marketplace upgrade hello-plugin@alpha 完成'))).toBe(false);
    gate.resolve(0);
    await flush();
    const settled = rig.notify.mock.calls.map((call) => String(call[0]));
    expect(settled.findIndex((m) => m.includes('marketplace upgrade hello-plugin@alpha 完成'))).toBeGreaterThan(
      startIdx,
    );
  });

  it('m2 refresh 开跑行（修前必红）：runEntry 未决期开跑 notify 已到（动词归因 marketplace update）', async () => {
    const gate = deferred<number>();
    const rig = await rigFace('start-notify-refresh', {
      runEntry: () => gate.promise,
    });
    await rig.face.open();
    rig.actions().refresh();
    await flush(2);
    expect(rig.runEntry).toHaveBeenCalledTimes(1);
    const inflight = rig.notify.mock.calls.map((call) => String(call[0]));
    const startIdx = inflight.findIndex((m) => m.includes('marketplace update 开跑'));
    expect(startIdx).toBeGreaterThanOrEqual(0);
    expect(inflight.some((m) => m.includes('marketplace update 完成'))).toBe(false);
    gate.resolve(0);
    await flush();
    const settled = rig.notify.mock.calls.map((call) => String(call[0]));
    expect(settled.findIndex((m) => m.includes('marketplace update 完成'))).toBeGreaterThan(startIdx);
  });
});

describe('MarketplaceTuiFace 双相 uninstall', () => {
  it('keep 形：inspect → 用户裁决 keep → execute（confirm:true + dataAction:keep）→ settle', async () => {
    const runEntry = vi.fn((sub: MarketplaceCommand, capture: EntryCapture) => {
      if (sub.sub !== 'uninstall') return Promise.resolve(0);
      if (sub.confirm === false) {
        capture.writeOut('将卸载：hello-plugin（装机物 + 数据目录将按 --data 裁决）');
        return Promise.resolve(0);
      }
      capture.writeOut(`已卸载：hello-plugin（数据目录${sub.dataAction === 'purge' ? '已清' : '保留'}）`);
      return Promise.resolve(0);
    });
    const rig = await rigFace('uninstall-keep', {
      runEntry: (sub, capture) => runEntry(sub, capture),
      confirm: 'keep',
      installedKeys: new Set(['hello-plugin@alpha']),
    });
    await rig.face.open();
    const model = rig.model();
    rig.actions().uninstall('hello-plugin@alpha');
    await flush();
    // 两相两调用：载荷序恰 [inspect（confirm:false）, execute（confirm:true + keep）]
    expect(runEntry).toHaveBeenCalledTimes(2);
    expect(runEntry.mock.calls[0]![0]).toEqual({ sub: 'uninstall', id: 'hello-plugin@alpha', confirm: false });
    expect(runEntry.mock.calls[1]![0]).toEqual({
      sub: 'uninstall',
      id: 'hello-plugin@alpha',
      confirm: true,
      dataAction: 'keep',
    });
    // 裁决材料 = inspect 回执全文（所见即所裁）
    expect(rig.confirmUninstall).toHaveBeenCalledTimes(1);
    expect(String(rig.confirmUninstall.mock.calls[0]![0])).toContain('将卸载：hello-plugin');
    // settle：execute 回执 + notify 完成 + reload
    expect(model.busyLabel).toBeNull();
    expect(model.results.join('\n')).toContain('已卸载：hello-plugin');
    expect(model.results.join('\n')).toContain('数据目录保留');
    expect(rig.requestReload).toHaveBeenCalledTimes(1);
    const messages = rig.notify.mock.calls.map((call) => String(call[0]));
    expect(messages.some((m) => m.includes('marketplace uninstall hello-plugin@alpha 完成'))).toBe(true);
    expect(messages).toContain('已自动链 /reload（会话运行中自动排队，run 收场后执行）'); // 编舞④第二行
  });

  it('purge 形：裁决值透传 dataAction（三分裁决位）', async () => {
    const runEntry = vi.fn();
    runEntry.mockImplementation((sub: MarketplaceCommand, capture: EntryCapture) => {
      if (sub.sub !== 'uninstall') return Promise.resolve(0);
      if (sub.confirm === false) {
        capture.writeOut('将卸载：hello-plugin');
        return Promise.resolve(0);
      }
      capture.writeOut('已卸载：hello-plugin（数据目录已清）');
      return Promise.resolve(0);
    });
    const rig = await rigFace('uninstall-purge', {
      runEntry: (sub, capture) => runEntry(sub, capture),
      confirm: 'purge',
    });
    await rig.face.open();
    rig.actions().uninstall('hello-plugin@alpha');
    await flush();
    expect(runEntry).toHaveBeenCalledTimes(2);
    expect(runEntry.mock.calls[1]![0]).toEqual({
      sub: 'uninstall',
      id: 'hello-plugin@alpha',
      confirm: true,
      dataAction: 'purge',
    });
    expect(rig.requestReload).toHaveBeenCalledTimes(1);
  });

  it('cancel 形：inspect 后取消——零 execute、零 reload、回执注记未执行', async () => {
    const runEntry = vi.fn();
    runEntry.mockImplementation((sub: MarketplaceCommand, capture: EntryCapture) => {
      if (sub.sub !== 'uninstall') return Promise.resolve(0);
      capture.writeOut('将卸载：hello-plugin');
      return Promise.resolve(0);
    });
    const rig = await rigFace('uninstall-cancel', {
      runEntry: (sub, capture) => runEntry(sub, capture),
      confirm: 'cancel',
    });
    await rig.face.open();
    const model = rig.model();
    rig.actions().uninstall('hello-plugin@alpha');
    await flush();
    expect(runEntry).toHaveBeenCalledTimes(1); // 恰 inspect——零 execute
    expect(model.busyLabel).toBeNull();
    expect(model.results.join('\n')).toContain('将卸载：hello-plugin'); // 核查清单保留
    expect(model.results.join('\n')).toContain('已取消');
    expect(rig.requestReload).not.toHaveBeenCalled();
    const last = rig.notify.mock.calls.at(-1)!;
    expect(String(last[0])).toContain('已取消卸载');
  });

  it('inspect 失败短路：零裁决面、零 execute（核查不可得无裁可做）', async () => {
    const rig = await rigFace('uninstall-inspect-failed', {
      runEntry: (_sub, capture) => {
        capture.writeErr('市场寻址形坏（"hello-plugin@alpha"）——条目不在账本');
        return Promise.resolve(1);
      },
    });
    await rig.face.open();
    const model = rig.model();
    rig.actions().uninstall('hello-plugin@alpha');
    await flush();
    expect(rig.confirmUninstall).not.toHaveBeenCalled();
    expect(rig.runEntry).toHaveBeenCalledTimes(1);
    expect(model.busyLabel).toBeNull();
    expect(model.results.join('\n')).toContain('市场寻址形坏');
    const last = rig.notify.mock.calls.at(-1)!;
    expect(String(last[0])).toContain('核查失败');
  });

  it('m2 uninstall 开跑行（修前必红）：inspect 起跑位一行——双相全程恰一行（execute 相不重复）', async () => {
    // 双闸：inspect 相与 execute 相各自挂起——中窗断言「execute 在飞仍恰一行开跑」
    const inspectGate = deferred<number>();
    const executeGate = deferred<number>();
    let call = 0;
    const rig = await rigFace('start-notify-uninstall', {
      runEntry: (_sub, capture) => {
        capture.writeOut(call === 0 ? '将卸载：hello-plugin' : '已卸载：hello-plugin');
        return (call++ === 0 ? inspectGate : executeGate).promise;
      },
      confirm: 'keep',
    });
    await rig.face.open();
    rig.actions().uninstall('hello-plugin@alpha');
    await flush(2);
    // 第一相 inspect 未决期：开跑行已到（起跑位 = inspect——裁决窗也算在飞期）
    const phase1 = rig.notify.mock.calls.map((c) => String(c[0]));
    expect(phase1.some((m) => m.includes('marketplace uninstall hello-plugin@alpha 开跑'))).toBe(true);
    inspectGate.resolve(0);
    await flush();
    // 第二相 execute 在飞窗：开跑行仍恰一行（execute 相不再发第二行）
    expect(rig.runEntry).toHaveBeenCalledTimes(2);
    const phase2 = rig.notify.mock.calls.map((c) => String(c[0]));
    expect(phase2.filter((m) => m.includes('开跑'))).toHaveLength(1);
    executeGate.resolve(0);
    await flush();
    // 全程收口：恰一行开跑 + 结束行（完成归因）随后
    const phase3 = rig.notify.mock.calls.map((c) => String(c[0]));
    expect(phase3.filter((m) => m.includes('开跑'))).toHaveLength(1);
    expect(phase3.some((m) => m.includes('marketplace uninstall hello-plugin@alpha 完成'))).toBe(true);
  });
});

describe('MarketplaceTuiFace 真服务面集成（runMarketplaceEntry 直装）', () => {
  it('install 真落账 → 徽标翻转；update 真换血 → 新条目可见（消费服务面零绕过全链）', async () => {
    const dataDir = join(testRoot, 'integration');
    mkdirSync(dataDir, { recursive: true });
    const repo = seedMarketRepo('integration-alpha');
    expect(await runMarketplaceEntry({ sub: 'add', source: repo }, { dataDir, env: {} })).toBe(0);
    // 真装配：runEntry = runMarketplaceEntry 直装（env 空面 + 回执捕获注入——
    // 生产 wiring 同形）；ledgerMarketKeys = 真账本现读
    const notify = vi.fn();
    const openPanel = vi.fn((_model: MarketPanelModel, _actions: MarketPanelActions): boolean => true);
    const face = new MarketplaceTuiFace({
      dataDir,
      fs: createMarketFs(),
      now: () => new Date(),
      runEntry: (sub, capture) =>
        runMarketplaceEntry(sub, {
          dataDir,
          env: {},
          writeOut: capture.writeOut,
          writeErr: capture.writeErr,
        }),
      notify,
      confirmUninstall: vi.fn(async (_inspectText: string): Promise<UninstallChoice> => 'cancel'),
      requestReload: vi.fn(),
      repaint: vi.fn(),
      ledgerMarketKeys: () => {
        const ledger = readLedger(dataDir, createPluginStoreFs());
        if (!ledger.ok) return new Set<string>();
        return new Set(
          ledger.entries
            .filter((entry) => entry.market !== undefined)
            .map((entry) => `${entry.market!.entry}@${entry.market!.name}`),
        );
      },
      openPanel,
    });

    // 开屏：无徽标
    await face.open();
    const firstModel = openPanel.mock.calls[0]![0] as MarketPanelModel;
    expect(firstModel.rows.find((row) => row.id === 'hello-plugin@alpha')!.installed).toBe(false);

    // 真装机（拷贝腿真拷 + market 字段落账）→ 徽标翻转
    (openPanel.mock.calls[0]![1] as MarketPanelActions).install('hello-plugin@alpha');
    await flush();
    const settled = notify.mock.calls.map((call) => String(call[0]));
    expect(settled.some((m) => m.includes('marketplace install hello-plugin@alpha 完成'))).toBe(true);
    expect(settled).toContain('已自动链 /reload（会话运行中自动排队，run 收场后执行）'); // 编舞④第二行
    await face.open();
    const secondModel = openPanel.mock.calls.at(-1)![0] as MarketPanelModel;
    expect(secondModel.rows.find((row) => row.id === 'hello-plugin@alpha')!.installed).toBe(true);

    // 真刷新：源仓推进（catalog 增第三条目）→ update 换血 → 行集可见新条目
    const catalogPath = join(repo, '.claude-plugin', 'marketplace.json');
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as {
      plugins: Array<Record<string, unknown>>;
    };
    catalog.plugins.push({ name: 'third-plugin', source: './plugins/third' });
    await fsp.writeFile(catalogPath, JSON.stringify(catalog));
    await fsp.mkdir(join(repo, 'plugins', 'third'), { recursive: true });
    await fsp.writeFile(join(repo, 'plugins', 'third', 'package.json'), declaredPkgJson('third-plugin'));
    (openPanel.mock.calls[0]![1] as MarketPanelActions).refresh();
    await flush();
    expect(notify.mock.calls.at(-1)![0]).toContain('marketplace update 完成');
    await face.open();
    const thirdModel = openPanel.mock.calls.at(-1)![0] as MarketPanelModel;
    expect(thirdModel.rows.map((row) => row.id)).toContain('third-plugin@alpha');
  });
});

describe('MarketplaceTuiFace fire-and-forget 兜底（编舞柄异常零 unhandled——修前红位）', () => {
  it('uninstall 裁决面 reject：busy 槽释放 + notify error 呈报（修前红——IIFE 无顶层 catch 即 unhandledRejection 杀 TUI）', async () => {
    const rig = await rigFace('uninstall-confirm-crash', {
      confirmUninstallImpl: async () => {
        throw new Error('裁决通道崩了');
      },
    });
    await rig.face.open();
    const model = rig.model();
    rig.actions().uninstall('hello-plugin@alpha');
    await flush();
    // 崩点在裁决腿（inspect 已收口）——零 execute
    expect(rig.confirmUninstall).toHaveBeenCalledTimes(1);
    expect(rig.runEntry).toHaveBeenCalledTimes(1);
    expect(model.busyLabel).toBeNull(); // 修前红：reject 游离无人接——busy 槽卡死在「卸载核查中」
    const last = rig.notify.mock.calls.at(-1)!;
    expect(String(last[0])).toContain('marketplace uninstall hello-plugin@alpha 编舞异常');
    expect(String(last[0])).toContain('裁决通道崩了');
    expect(last[1]).toEqual({ level: 'error' });
  });

  it('runLong settle 段注入柄抛错（settle 腿 repaint 崩）：notify error 兜底呈报（修前红——settle 段游离在 captureRun try 外）', async () => {
    let repaintCalls = 0;
    const rig = await rigFace('runlong-settle-crash', {
      repaintImpl: () => {
        repaintCalls += 1;
        if (repaintCalls >= 2) throw new Error('settle repaint 崩了'); // 首腿（busy 置位后）放行，settle 腿崩
      },
    });
    await rig.face.open();
    rig.actions().install('hello-plugin@alpha');
    await flush();
    expect(rig.runEntry).toHaveBeenCalledTimes(1); // settle 段已到达（captureRun 已收口——非 runEntry 腿）
    const errorCalls = rig.notify.mock.calls.filter((call) => call[1]?.level === 'error');
    expect(errorCalls).toHaveLength(1); // 修前红：无兜底——reject 游离 unhandled，error 级零调用
    expect(String(errorCalls[0]![0])).toContain('marketplace install hello-plugin@alpha 编舞异常');
    expect(String(errorCalls[0]![0])).toContain('settle repaint 崩了');
  });
});
