/**
 * host/plugins-cmd — `plugins` 子命令族 CLI 入口（03 §5.8 三面同源之 CLI 面；
 * 07 §5 命令族；批 12f-3 骨架 → 成熟度缺口 #10 装机面落码批写真身）。
 *
 * 子动词分账：
 *  - **list**：装载态清单三分区（启用/失败/禁用）。走与 dump-config **同一
 *    合成代码路径**（真数据目录读侧 + 主库零落盘 + 不占标记）——装载面必须
 *    跑（报告语义）。
 *  - **check**：纯只读零装配（07 §5——不走装载器直读装机账本）。api 块三色
 *    裁决挂账 API 治理批（03 §8.4/§8.9）。
 *  - **install <ref>**：三源装机（plugin-install 执行器——ref 单参自含源前缀
 *    与账本同词法；--min-release-age 旗标逐次覆盖 env 静置窗）。
 *  - **uninstall <id>**：双相（无 --confirm = inspect 只读报告 / 加 = execute
 *    四段清算——plugin-uninstall 编舞；--data keep|purge 缺省 keep，--data
 *    单独在场即拒——execute 载荷不静默猜）。开库走 Persistence 直开 +
 *    HOST_MIGRATION_TAIL 全链（零装配直开库纪律——sessions/credentials 同形）。
 *  - **mount/unmount/toggle <id>**：enabled.yaml 行编辑（plugin-store 行编辑
 *    面；mount 前置查账本——core: id 或已装机 id 才可挂）。
 *  - **update <id>**：按源分派（plugin-install updatePlugin）。
 *
 * 写动词生效时点：CLI 短命进程不装配装载器——写侧动作**下次启动装载生效**
 * （「装机零生效」语义的 CLI 面呈现；TUI 侧 /reload 排队编舞已落——assembly
 * 编舞器 + 'reload' 命令注册，/reload 批收官）。
 *
 * 退出码：0 成功 / 1 执行失败（结算文本含原因）/ 用法错 2 归解析层。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stdout as processStdout, stderr as processStderr } from 'node:process';

import { Persistence, createAuditFace, resolveDataDir } from '../persist/index.js';

import type { PluginsCommand } from './cli.js';
import { assembleHostStack } from './assembly.js';
import type { CorePluginReference } from './loader.js';
import { checkPluginId } from './manifest.js';
import { installPlugin, updatePlugin, createDefaultSpawnRunner } from './plugin-install.js';
import type { InstallExecutorDeps } from './plugin-install.js';
import { executeUninstall, inspectUninstall } from './plugin-uninstall.js';
import type { UninstallDataAction, UninstallDeps } from './plugin-uninstall.js';
import { mountRow, readLedger, toggleRow, unmountRow, createPluginStoreFs } from './plugin-store.js';
import type { LifecycleAuditSink } from './plugin-store.js';
import type { HostRuntime } from './runtime.js';
import { HOST_MIGRATION_TAIL } from './runtime.js';

/** 入口选项（main 分派接线 + 测试注入面） */
export interface PluginsEntryOptions {
  /** 宿主版本（list 装配路径消费） */
  readonly version: string;
  /** 数据目录（缺省 resolveDataDir()——list 同构读侧/check 账本读侧） */
  readonly dataDir?: string;
  /** env 面（缺省 process.env） */
  readonly env?: Record<string, string | undefined>;
  /** 运行时组装后回调（main.ts attachRuntime——信号/崩溃编舞切运行时本体） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** core: 官方件注册表（测试注入面——main 现状空注册表，15 件入册归装载集成批） */
  readonly corePlugins?: readonly CorePluginReference[];
  /** 输出面（缺省 process.stdout——测试注入） */
  readonly writeOut?: (text: string) => void;
  /** 错误面（缺省 process.stderr——测试注入） */
  readonly writeErr?: (text: string) => void;
}

/** plugins 子命令族主入口。返回进程退出码（0/1；用法错 2 归解析层） */
export async function runPluginsEntry(sub: PluginsCommand, options: PluginsEntryOptions): Promise<number> {
  switch (sub.sub) {
    case 'list':
      return runList(options);
    case 'check':
      return runCheck(options);
    case 'install':
      return runInstall(sub.ref, sub.minReleaseAge, options);
    case 'uninstall':
      return runUninstall(sub.id, sub.confirm, sub.dataAction, options);
    case 'mount':
    case 'unmount':
    case 'toggle':
      return runRowVerb(sub.sub, sub.id, options);
    case 'update':
      return runUpdate(sub.id, options);
  }
}

/** list：同一合成代码路径装载 → 三分区人读输出（07 §5「装载态清单」） */
async function runList(options: PluginsEntryOptions): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  // dataDir 解析与其他五动词同律（?? resolveDataDir()——env 梯子 BERRY_AGENT_DATA_DIR
  // 由此接通；2026-09-13 可观测性批 obs-c 修：修前条件展开在 undefined 时省略
  // dataDir ⇒ memory 诊断形 dataDir=null ⇒ enabled.yaml/账本整跳 ⇒ 磁盘装机
  // 行三区皆隐〔真模型六轮实机实证：装+mount 后 list 仍只呈 16 core 件〕）
  const dataDir = options.dataDir ?? resolveDataDir();
  const assembly = await assembleHostStack({
    runtime: {
      dataDir,
      memory: true, // 同构诊断形（与 dump-config 同形——真盘读侧 + 主库零落盘）
    },
    noPlugins: false, // list 语义 = 报告装载态——装载面必须跑（无 --no-plugins 旗标面）
    debug: false,
    version: options.version,
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.onRuntime !== undefined ? { onRuntime: options.onRuntime } : {}),
    ...(options.corePlugins !== undefined ? { corePlugins: options.corePlugins } : {}),
  });
  if (!assembly.ok) {
    writeErr(assembly.message);
    return assembly.exitCode;
  }
  try {
    const { activated, failed, skipped } = assembly.boot.report;
    const lines: string[] = [];
    lines.push(`启用（${activated.length}）：`);
    for (const a of activated)
      lines.push(`  ${a.id}${a.skillDirs.length > 0 ? `  技能目录：${a.skillDirs.join('、')}` : ''}`);
    lines.push(`失败（${failed.length}）：`);
    for (const f of failed) lines.push(`  ${f.id}  [${f.code}] ${f.message}`);
    lines.push(`禁用（${skipped.length}）：`);
    for (const s of skipped) lines.push(`  ${s.id}  ${s.reason}`);
    writeOut(lines.join('\n'));
    return 0;
  } finally {
    await assembly.runtime.shutdown();
  }
}

/**
 * check：纯只读零装配骨架（07 §5——数据面纯只读零装配；不走装载器）。
 * 账本缺席/为空 = 零装机无可体检项（exit 0——「无断裂」成立）；非空账本的
 * apiVersion 三色裁决挂账 API 治理批（03 §8.4/§8.9——api 块回填同批）。
 */
function runCheck(options: PluginsEntryOptions): number {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  let raw: string | null = null;
  try {
    raw = readFileSync(join(dataDir, 'plugins', 'ledger.json'), 'utf8');
  } catch {
    raw = null; // 缺席 = 零装机（ENOENT 同义——首启零文件零负担）
  }
  if (raw === null || raw.trim() === '' || raw.trim() === '{}') {
    writeOut('装机账本缺席或为空——无可体检项（通过）');
    return 0;
  }
  writeOut('装机账本非空，但 apiVersion 三色体检面尚未装配（归 API 治理批——03 §8.4/§8.9）——本命令本批不覆盖此形态');
  return 1;
}

/* ---------------- 写侧六动词（装机面落码批 #10 真身） ---------------- */

/**
 * 生命周期归因账真身（05 §1.1 生命周期归因面行——audit 落账批）：惰性开库
 * sink——动词成功尾首调才开 Persistence（只读路径 list/check 与失败路径零
 * 开库零负担）；Persistence.close 是 async，故配对 close 由调用层 finally
 * await（库件回调是同步面——close 责任在 CLI 编排层）。落账失败 warn 不
 * 阻塞主流程（行编辑已生效不回滚——与 llm/usage append 异常 warn 同哲学）。
 */
function lifecycleAuditOf(
  options: PluginsEntryOptions,
  writeErr: (text: string) => void,
): { readonly sink: LifecycleAuditSink; readonly close: () => Promise<void> } {
  let persistence: Persistence | undefined;
  return {
    sink: (type, data) => {
      try {
        if (persistence === undefined) {
          // dbPath 显式随 dataDir（Persistence 的 dbPath/dataDir 分立解析——
          // 缺省 dbPath 走 env 梯子不随 dataDir 选项；CLI 语义 = --data-dir
          // 指到哪库就在哪〔三级梯子第二级本意〕）
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
          `warn：生命周期审计落账失败（${type}）：${err instanceof Error ? err.message : String(err)}——主流程不受影响（行编辑已生效）`,
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

/** 装机执行器 deps 构造（CLI 面——真盘真 spawn；env 缺省 process.env） */
function installDepsOf(
  options: PluginsEntryOptions,
  minReleaseAge: number | undefined,
  onLifecycleAudit?: LifecycleAuditSink,
): InstallExecutorDeps {
  return {
    dataDir: options.dataDir ?? resolveDataDir(),
    fs: createPluginStoreFs(),
    spawn: createDefaultSpawnRunner(),
    env: options.env ?? process.env,
    ...(minReleaseAge !== undefined ? { minReleaseAgeOverride: minReleaseAge } : {}),
    ...(onLifecycleAudit !== undefined ? { onLifecycleAudit } : {}),
  };
}

/** install <ref>：三源装机（§5.4——ref 词法坏形/撞名/收割失败各档结算文本直呈） */
async function runInstall(
  ref: string,
  minReleaseAge: number | undefined,
  options: PluginsEntryOptions,
): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const audit = lifecycleAuditOf(options, writeErr);
  try {
    const outcome = await installPlugin(installDepsOf(options, minReleaseAge, audit.sink), ref);
    if (!outcome.ok) {
      writeErr(outcome.message);
      return 1;
    }
    writeOut(outcome.text);
    return 0;
  } finally {
    await audit.close();
  }
}

/** update <id>：按源分派（§5.4——npm 重装/git 重克隆/local no-op） */
async function runUpdate(id: string, options: PluginsEntryOptions): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const audit = lifecycleAuditOf(options, writeErr);
  try {
    const outcome = await updatePlugin(installDepsOf(options, undefined, audit.sink), id);
    if (!outcome.ok) {
      writeErr(outcome.message);
      return 1;
    }
    writeOut(outcome.text);
    return 0;
  } finally {
    await audit.close();
  }
}

/**
 * uninstall <id>：双相映射（§5.5——无 --confirm = inspect / 加 = execute）。
 * 开库走 Persistence 直开 + 迁移链尾单源（域表 DROP/审计落账走同实例窄面）；
 * --data 单独在场即拒（execute 载荷不静默猜——双相语义混淆当响亮指出）。
 */
async function runUninstall(
  id: string,
  confirm: boolean,
  dataAction: UninstallDataAction | undefined,
  options: PluginsEntryOptions,
): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  if (dataAction !== undefined && !confirm) {
    writeErr('--data 是 execute 载荷——须与 --confirm 同场（无 --confirm 即 inspect 只读报告，不携带数据处置）');
    return 1;
  }
  const dataDir = options.dataDir ?? resolveDataDir();
  // dbPath 显式随 dataDir（同 lifecycleAuditOf——Persistence 的 dbPath/dataDir
  // 分立解析，缺省 dbPath 走 env 梯子不随 dataDir 选项；CLI 语义 = --data-dir
  // 指到哪库就在哪。装机面落码批遗留真 bug——审计落账批写测试抓获，修前
  // 库恒开 env 梯子位、--data-dir 旗标形同虚设）
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
      ? executeUninstall(deps, id, dataAction ?? 'keep') // 缺省 keep——execute 不静默猜 purge
      : inspectUninstall(deps, id);
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
 * mount/unmount/toggle <id>：enabled.yaml 行编辑（§5.3/§5.2——下次启动装载
 * 生效）。mount 前置两查：id 词法（enabled 行 id 空间——core: 前缀或用户
 * 词法）+ 装机在场（core: id 豁免查账——内置态天然在场；用户 id 未装机拒，
 * 防写死行 brick 下次 boot 读侧）。成功尾落生命周期归因账（unmount 幂等
 * 跳过腿由库件零调用——无变更不造账）。
 */
async function runRowVerb(
  verb: 'mount' | 'unmount' | 'toggle',
  id: string,
  options: PluginsEntryOptions,
): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => processStdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => processStderr.write(`${text}\n`));
  const dataDir = options.dataDir ?? resolveDataDir();
  const fs = createPluginStoreFs();
  if (verb === 'mount') {
    if (!checkPluginId(id, { official: true })) {
      writeErr(`插件 id 词法违例（${id}——小写字母数字连字符，官方件 core: 前缀同律）`);
      return 1;
    }
    if (!id.startsWith('core:')) {
      const ledgerRead = readLedger(dataDir, fs);
      if (!ledgerRead.ok) {
        writeErr(`装机账本损坏：${ledgerRead.reason}——拒写防覆盖（03 §5.4）`);
        return 1;
      }
      if (!ledgerRead.entries.some((e) => e.id === id)) {
        writeErr(`插件 ${id} 未装机——mount 先走 install（未装机挂行会在下次启动读侧降级，03 §5.3）`);
        return 1;
      }
    }
  }
  const audit = lifecycleAuditOf(options, writeErr);
  try {
    const result =
      verb === 'mount'
        ? mountRow(dataDir, id, undefined, fs, audit.sink)
        : verb === 'unmount'
          ? unmountRow(dataDir, id, fs, audit.sink)
          : toggleRow(dataDir, id, fs, audit.sink);
    if (!result.ok) {
      writeErr(result.message);
      return 1;
    }
    writeOut(
      verb === 'mount'
        ? `已挂载：${id}——下次启动装载生效（CLI 短命进程不装配装载器；改行时点生效归 TUI /reload，03 §5.2）`
        : verb === 'unmount'
          ? `已卸下：${id}（装机保留）——下次启动生效（03 §5.3）`
          : `已切换：${id} 禁用态翻转——下次启动生效（03 §5.2 三态语义）`,
    );
    return 0;
  } finally {
    await audit.close();
  }
}
