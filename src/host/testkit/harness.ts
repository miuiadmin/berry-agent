/**
 * testkit 假宿主装配件（03 §9.5——生态启动批 eco-3c）。
 *
 * 铁律（真装载器——deepseek-harness「真入口路径」教训照搬）：一切断言经
 * 真装载整体走真——installPlugin/mountRow/toggleRow/bootPlugins 全是真身
 * 直调（真 jiti 求值、真审计词、真 enabled.yaml/账本落盘），本件只提供
 * 假宿主受局面（runtime 替身 + 注入式注册账 + 内存审计汇）。手工拼
 * ctx.plugin 的套件不算数。
 *
 * 消费位：作者测试文件经 `berry-agent/testkit` 子路径导入（作者侧 devDep
 * 消费——非装载器 jiti 注入面，03 §8.2 第七真相源「宿主主包子路径导出面」）。
 */
import { execFile } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { parseManifest } from '../manifest.js';
import type { PluginManifest } from '../manifest.js';
import { installPlugin } from '../plugin-install.js';
import { bootPlugins } from '../plugin-boot.js';
import type { PluginBootHandle, PluginBootOptions, PluginUnloadReceipt } from '../plugin-boot.js';
import { mountRow, readEnabledRowsForEdit, toggleRow } from '../plugin-store.js';
import type { PluginStoreFs, RowEditResult } from '../plugin-store.js';
import type { CommandRegistryLike } from '../plugin-context.js';
import { EventDispatch, Scope } from '../../context/index.js';
import type { AuditFace, AuditEventRow } from '../../persist/index.js';
import type { LlmRuntime } from '../../llm/index.js';
import { stringify as stringifyYaml } from 'yaml';

import type { HostRuntime } from '../runtime.js';

/** 装机结果（installPlugin 直传——ok = 落账条目） */
export type HarnessInstallOutcome =
  | { readonly ok: true; readonly id: string; readonly installPath: string }
  | { readonly ok: false; readonly message: string };

/** 构造选项（作者测试文件一行起跑） */
export interface PluginHarnessOptions {
  /** 待证插件目录（真盘——jiti 真求值；local: 源直引不拷贝） */
  readonly pluginDir: string;
  /**
   * 数据目录（缺省 mkdtemp 临时目录——dispose 时清理；显式给出则不清理，
   * 作者可自行检视 enabled.yaml/账本终态）。
   */
  readonly dataDir?: string;
  /** 宿主版本串（装载门/披露段呈现；缺省 testkit 形） */
  readonly hostVersion?: string;
  /** warn 出口（缺省静默——装载降级警告不噪作者测试输出） */
  readonly warn?: (message: string) => void;
}

/** 内存审计汇（AuditFace 真形实现——append/lastOf/listRecent 三法 + 断言器扩展读面） */
export class MemoryAuditSink implements AuditFace {
  private seq = 0;
  private readonly rows: AuditEventRow[] = [];

  /** 直写落账（真词面由调用方保证——本汇不做词汇闸，断言器锁真词） */
  append(type: string, data: Record<string, unknown>): void {
    this.rows.push({ id: ++this.seq, time: Date.now(), type, data: { ...data } });
  }

  /** 尾读：该词最近一条（从未落过 = undefined） */
  lastOf(type: string): AuditEventRow | undefined {
    for (let i = this.rows.length - 1; i >= 0; i--) {
      if (this.rows[i]!.type === type) return this.rows[i];
    }
    return undefined;
  }

  /** 逆序近期清单（id 降序——与真源同序律） */
  listRecent(limit = 100): readonly AuditEventRow[] {
    return [...this.rows].reverse().slice(0, limit);
  }

  /* ---------------- 断言器扩展读面（testkit 专属——不进 AuditFace 契约） ---------------- */

  /** 全量快照（正序——残留检查/白名单对账的数据源） */
  all(): readonly AuditEventRow[] {
    return [...this.rows];
  }

  /** 词计数（可选拘载荷谓词——「恰一笔」断言的数据源） */
  countOf(type: string, matches?: (data: Record<string, unknown>) => boolean): number {
    return this.rows.filter((r) => r.type === type && (matches === undefined || matches(r.data))).length;
  }
}

/** 命令注册账（注入式真注册表——register/disposer 出入账计数，跨换代共享一账） */
export interface CommandAccount {
  /** 注册表受局面（bootPlugins 直注） */
  readonly registry: CommandRegistryLike;
  /** 当前在册名计数（名 → 净注册数；0 = 已出账——present/absent 两断言的数据源） */
  counts(): ReadonlyMap<string, number>;
}

/** 命令注册账铸造（disposer 出账——换代 dispose 后单注可证） */
export function createCommandAccount(): CommandAccount {
  const counts = new Map<string, number>();
  return {
    registry: {
      register: (name, _handler, _description) => {
        counts.set(name, (counts.get(name) ?? 0) + 1);
        return () => counts.set(name, (counts.get(name) ?? 0) - 1);
      },
    },
    counts: () => new Map(counts),
  };
}

/** 事件分派监听器净计数探针（实例方法包壳观察——真派发行为不 mock，只记账） */
export interface DispatchListenerProbe {
  /** 词净监听数（unmount 后全词归零 = 零注册残留断言的数据源） */
  netCounts(): ReadonlyMap<string, number>;
}

/** 分派器监听器探针铸造（on 注册 +1、退订 −1；onWaterfall 腿 v1 未观察——注释明示） */
export function instrumentDispatchListeners(dispatch: EventDispatch): DispatchListenerProbe {
  const net = new Map<string, number>();
  const origOn = dispatch.on.bind(dispatch);
  // 实例属性包壳（真身在原型——不替换派发语义，只在注册/退订两点记账）
  dispatch.on = ((name: string, listener: Parameters<typeof dispatch.on>[1]) => {
    net.set(name, (net.get(name) ?? 0) + 1);
    const off = origOn(name, listener);
    return () => {
      off();
      net.set(name, (net.get(name) ?? 0) - 1);
    };
  }) as typeof dispatch.on;
  return { netCounts: () => new Map(net) };
}

/** 假宿主真盘数据面（PluginStoreFs 真身适配——node:fs 直连，无内存仿真） */
export function realStoreFs(): PluginStoreFs {
  return {
    read: (path) => {
      try {
        return readFileSync(path, 'utf8');
      } catch {
        return null;
      }
    },
    write: (path, text) => writeFileSync(path, text, 'utf8'),
    rename: (from, to) => renameSync(from, to),
    mkdir: (path, options) => mkdirSync(path, options),
    rm: (path, options) => rmSync(path, options),
    readdir: (path) => {
      try {
        return readdirSync(path);
      } catch {
        return null;
      }
    },
    size: (path) => {
      try {
        return statSync(path).size;
      } catch {
        return null;
      }
    },
  };
}

/** HostRuntime 结构化替身（装配序只消费 dataDir/registerCloser——同 plugin-boot.test 形） */
function createHarnessRuntime(dataDir: string): HostRuntime {
  return {
    memory: false,
    dataDir,
    persistence: {} as HostRuntime['persistence'],
    abortSignal: new AbortController().signal,
    disclosure: () => null,
    registerCloser: () => undefined,
    registerShutdownHook: () => undefined,
    registerDisposer: () => undefined,
    shutdown: async () => undefined,
    writeCrashLog: () => undefined,
  };
}

/** llm 注册账（Pick 受局面最小形——provider 注册动词真达即净计；出账可证） */
function createLlmAccount(): Pick<LlmRuntime, 'registerProvider'> & { netCount(): number } {
  let net = 0;
  return {
    registerProvider: () => {
      net += 1;
      return () => {
        net -= 1;
      };
    },
    netCount: () => net,
  };
}

/** 假宿主装配件（矩阵断言器的运转底座——全部动词真身直调） */
export interface PluginHarness {
  /** 数据目录（真盘） */
  readonly dataDir: string;
  /** 待证插件目录（canonical 绝对） */
  readonly pluginDir: string;
  /** 插件 id（清单 id——构造时解析；坏清单构造即红） */
  readonly pluginId: string;
  /** 解析后清单（矩阵 pack 引用集/stray 探针的数据源） */
  readonly manifest: PluginManifest;
  /** package.json 原文解析物（main/module 字段读取面——stray 探针用） */
  readonly packageJson: Record<string, unknown>;
  /** 内存审计汇（install/mount/toggle 三动词 sink + boot diff 全链落账） */
  readonly audit: MemoryAuditSink;
  /** 命令注册账（跨换代共享——净计数出账可证） */
  readonly commands: CommandAccount;
  /** 事件分派器（含监听器净计数探针） */
  readonly dispatch: EventDispatch;
  /** dispatch.on 净计数探针（零注册残留断言源） */
  readonly listeners: DispatchListenerProbe;
  /** 真装机（installPlugin local: 源直引——账本落盘 + 清单校验 + 收割真 jiti） */
  install(): Promise<HarnessInstallOutcome>;
  /** 真启用（mountRow——enabled.yaml 追行 + plugin/mounted 审计笔） */
  mountRow(): RowEditResult;
  /** 真翻转（toggleRow——enabled.yaml 旗标翻转 + plugin/toggled 审计笔） */
  toggleRow(): RowEditResult;
  /** 真装载（bootPlugins——audit/commands/llm/dispatch 全注；换代前置回卷走完整卸载序） */
  boot(): Promise<PluginBootHandle>;
  /** 回卷当前代（unloadRef 槽完整卸载序——apply disposer LIFO + fork 逆序 dispose 双腿） */
  unloadCurrent(): Promise<PluginUnloadReceipt | null>;
  /** 手编 enabled.yaml 形授开门（行 opens 追加——用户可编辑面的文档形直写） */
  grantOpens(opens: readonly string[]): void;
  /** 数据目录文件清单（残留检查数据源——顶层 + plugins/ 一层） */
  dataFiles(): readonly string[];
  /** 收场（回卷在飞代 + 清理自建临时目录；显式 dataDir 不清） */
  dispose(): Promise<void>;
}

/** 装配假宿主（构造即读清单定 id——坏清单构造即红，坏样本由矩阵层收面） */
export function createPluginHarness(options: PluginHarnessOptions): PluginHarness {
  const pluginDir = options.pluginDir;
  const pkgText = realStoreFs().read(join(pluginDir, 'package.json'));
  if (pkgText === null) {
    throw new Error(`testkit：${pluginDir} 缺 package.json（插件清单缺席——非插件目录）`);
  }
  let pkgJson: unknown;
  try {
    pkgJson = JSON.parse(pkgText);
  } catch (err) {
    throw new Error(
      `testkit：package.json 非合法 JSON（${pluginDir}）：${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const parsedManifest = parseManifest(pkgJson, { official: false });
  if (!parsedManifest.ok) {
    throw new Error(`testkit：清单校验失败（${pluginDir}）：${parsedManifest.message}`);
  }
  const ownsDataDir = options.dataDir === undefined;
  const dataDir = options.dataDir ?? mkdtempSync(join(tmpdir(), 'berry-testkit-'));
  const storeFs = realStoreFs();
  const audit = new MemoryAuditSink();
  const commands = createCommandAccount();
  const dispatch = new EventDispatch();
  const listeners = instrumentDispatchListeners(dispatch);
  const runtime = createHarnessRuntime(dataDir);
  const scope = Scope.createRoot();
  const lifecycleSink = (type: string, data: Record<string, unknown>) => audit.append(type, data);
  let currentBoot: PluginBootHandle | null = null;
  // 本代完整卸载序（unloadRef 槽——apply disposer LIFO + fork 逆序 dispose
  // 两腿全跑；report.unload() 只是 disposeStack 单腿，ctx.effect 注册回卷
  // 在 fork 腿，故换代/收场必须走槽不走 report）
  let currentUnload: (() => Promise<PluginUnloadReceipt>) | null = null;

  return {
    dataDir,
    pluginDir,
    pluginId: parsedManifest.manifest.id,
    manifest: parsedManifest.manifest,
    packageJson: pkgJson as Record<string, unknown>,
    audit,
    commands,
    dispatch,
    listeners,
    async install() {
      const outcome = await installPlugin(
        {
          dataDir,
          fs: storeFs,
          // local: 源零 spawn 调用——占位 fail-loud（若未来装机编舞对 local
          // 源触网，此占位当场红——testkit 断言面禁网）
          spawn: {
            run: async (cmd) => {
              throw new Error(`testkit install 走 local: 源——不应触达执行器（${cmd}）`);
            },
          },
          onLifecycleAudit: lifecycleSink,
        },
        `local:${pluginDir}`,
      );
      return outcome.ok
        ? { ok: true, id: outcome.entry.id, installPath: outcome.entry.installPath }
        : { ok: false, message: outcome.message };
    },
    mountRow() {
      return mountRow(dataDir, parsedManifest.manifest.id, undefined, storeFs, lifecycleSink);
    },
    toggleRow() {
      return toggleRow(dataDir, parsedManifest.manifest.id, storeFs, lifecycleSink);
    },
    async boot() {
      // 换代前置回卷（/reload 同语义：先卸旧代再起新代——不并代；完整卸载
      // 序含 fork dispose，ctx.effect 注册在换代时自动撤注）
      if (currentUnload !== null) await currentUnload();
      // 每代独立槽（bootPlugins 重跑即覆写槽——旧代卸载序须先行持走）
      const unloadRef: { current: (() => Promise<PluginUnloadReceipt>) | null } = { current: null };
      const bootOptions: PluginBootOptions = {
        runtime,
        scope,
        dispatch,
        commands: commands.registry,
        llm: createLlmAccount(),
        version: options.hostVersion ?? '0.0.0-testkit',
        warn: options.warn ?? (() => undefined),
        audit,
        unloadRef,
      };
      currentBoot = await bootPlugins(bootOptions);
      currentUnload = unloadRef.current;
      return currentBoot;
    },
    async unloadCurrent() {
      const unload = currentUnload;
      currentUnload = null;
      currentBoot = null;
      return unload === null ? null : await unload();
    },
    grantOpens(opens) {
      // 手编 enabled.yaml 形（03 §5.3 用户可编辑面的文档形——行级 opens 授予
      // 无 CLI 动词，宿主真源路径即手编；此处以同形 yaml 重写全文件）
      const read = readEnabledRowsForEdit(dataDir, storeFs);
      if (!read.ok) throw new Error(`testkit：enabled.yaml 坏形（${read.message}）`);
      const rows = read.rows.map((row) =>
        row.id === parsedManifest.manifest.id ? { ...row, opens: [...opens] } : row,
      );
      storeFs.write(
        join(dataDir, 'enabled.yaml'),
        stringifyYaml({ plugins: rows, ...((read.doors ?? []).length > 0 ? { doors: read.doors } : {}) }),
      );
    },
    dataFiles() {
      const top = (storeFs.readdir(dataDir) ?? []).filter((name) => name !== '.DS_Store');
      const under: string[] = [];
      for (const name of top) {
        if (name === 'plugins') {
          for (const child of storeFs.readdir(join(dataDir, 'plugins')) ?? []) {
            under.push(`plugins/${child}`);
          }
        } else {
          under.push(name);
        }
      }
      return under;
    },
    async dispose() {
      try {
        if (currentUnload !== null) await currentUnload();
      } finally {
        if (ownsDataDir) rmSync(dataDir, { recursive: true, force: true });
      }
    },
  };
}

/** npm pack 文件清单探测（--dry-run 零 tarball 落盘；60s 帽防挂） */
export async function npmPackFiles(pluginDir: string): Promise<readonly string[]> {
  const run = promisify(execFile);
  const { stdout } = await run('npm', ['pack', '--dry-run', '--json'], {
    cwd: pluginDir,
    maxBuffer: 16 * 1024 * 1024,
    timeout: 60_000,
  });
  const parsed = JSON.parse(stdout) as Array<{ files?: Array<{ path: string }> }>;
  return (parsed[0]?.files ?? []).map((f) => f.path);
}
