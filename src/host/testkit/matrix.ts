/**
 * testkit 生命周期证明矩阵（03 §9.5 首版断言矩阵——生态启动批 eco-3c）。
 *
 * 列 = 纯函数断言 / 假宿主断言（真宿主层延后随金样轨并轨——首版锁假宿主
 * 层 + 真装载器两件防范围膨胀）。行 = install/mount/unmount/事件面必进；
 * toggle/开门面/幂等负向顺手进；update/审批面/真宿主层延后（规范表同序）。
 *
 * 全部断言经 harness 真装载整体走真（installPlugin/mountRow/toggleRow/
 * bootPlugins/report.unload 真身直调）——手工拼 ctx.plugin 的证明不算数。
 * 产出可贴 README 的 markdown 回执（formatMatrixReceipt）。
 */
import { readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { createJiti } from 'jiti';

import type { PluginManifest } from '../manifest.js';

import { createPluginHarness, npmPackFiles } from './harness.js';
import type { PluginHarness, PluginHarnessOptions } from './harness.js';

/** 单行结果（pass/fail/skipped——skipped = 环境不适用非放行） */
export interface MatrixRowResult {
  readonly row: string;
  readonly status: 'pass' | 'fail' | 'skipped';
  readonly detail?: string;
}

/** 矩阵总报告（ok = 无 fail 行；skipped 不折损——环境位如实呈现） */
export interface LifecycleMatrixReport {
  readonly pluginId: string;
  readonly ok: boolean;
  readonly rows: readonly MatrixRowResult[];
}

/** 矩阵选项（harness 选项 + 作者声明面 + pack 预检开关） */
export interface MatrixOptions extends PluginHarnessOptions {
  /** 期望装载后在册的人面命令名（注册账在场/缺席两断言的作者声明面） */
  readonly expect?: { readonly commands?: readonly string[] };
  /** npm pack 完整性预检开关（缺省开；npm 不在环境可置 false——行落 skipped） */
  readonly packCheck?: boolean;
}

/** 宿主记账方白名单（审计词面——宿主自身记账是合法残留，dsh 快照 diff 同律） */
const HOST_AUDIT_WHITELIST = new Set([
  'plugin/installed',
  'plugin/mounted',
  'plugin/unmounted',
  'plugin/toggled',
  'plugin/updated',
  'plugin/opens',
  'doors/updated',
]);

/** skipped 行信号（runRow 识别后落 skipped 态——环境不适用非放行冒充） */
class SkippedRow extends Error {}

/**
 * 数据面合法文件集（装机/启用/boot 记账三源落盘——其余即残留；local 源直引
 * 不拷贝故无 node_modules）。boot-failures.json = 绿 boot 也触写（装载成功对
 * activated 逐行 clearBootFailure）——宿主记账方合法残留，dsh 白名单同律。
 */
const HOST_DATAFILE_WHITELIST = new Set(['enabled.yaml', 'plugins/ledger.json', 'boot-failures.json']);

/** 开门面样本授予（USER_GRANTABLE_CAPABILITIES 首枚——行校验值域内样本） */
const OPENS_SAMPLE = 'channels.ui-backend';

/**
 * 生命周期证明矩阵主入口——一站式可召唤（作者测试一行起跑）：
 *
 * ```ts
 * const report = await proveLifecycleMatrix({ pluginDir: __dirname });
 * expect(report.ok).toBe(true);
 * ```
 *
 * 收场自动回卷在飞代 + 清理自建临时目录（报告先行返回——dispose 失败不折损证明）。
 */
export async function proveLifecycleMatrix(options: MatrixOptions): Promise<LifecycleMatrixReport> {
  const rows: MatrixRowResult[] = [];
  const expectCommands = options.expect?.commands ?? [];
  let harness: PluginHarness | null = null;

  /** 单行跑手（红 = 该行 fail；SkippedRow = 环境不适用；异常讯息即 detail） */
  const runRow = async (row: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn();
      rows.push({ row, status: 'pass' });
    } catch (err) {
      if (err instanceof SkippedRow) {
        rows.push({ row, status: 'skipped', detail: err.message });
        return;
      }
      rows.push({ row, status: 'fail', detail: err instanceof Error ? err.message : String(err) });
    }
  };

  try {
    try {
      harness = createPluginHarness(options);
    } catch (err) {
      // 构造即红（缺清单/坏清单）——install 行收面，矩阵不整体炸
      rows.push({
        row: 'install（装机 + pack 完整性）',
        status: 'fail',
        detail: err instanceof Error ? err.message : String(err),
      });
      return { pluginId: '(unknown)', ok: false, rows };
    }
    const h = harness;

    /* ---------------- install（必进） ---------------- */
    await runRow('install（装机 + pack 完整性）', async () => {
      const outcome = await h.install();
      if (!outcome.ok) throw new Error(`装机拒：${outcome.message}`);
      if (outcome.id !== h.pluginId) throw new Error(`装机账本 id（${outcome.id}）≠ 清单 id（${h.pluginId}）`);
      // default-export 陷阱正向探针（纯声明包 main 带 default export 函数 = 永不执行的死代码作者陷阱）
      const mainFile = resolvePackageMain(h.pluginDir, h.packageJson);
      if (h.manifest.entryPlan.kind === 'declared-payload' && mainFile !== null) {
        const namespace = await jitiProbe(mainFile);
        if (namespace !== null && typeof namespace.default === 'function') {
          throw new Error(
            `纯声明包 main（${mainFile}）带 default export 函数——declared-payload 形包主入口不执行（要么声明 berryAgent.entry 走代码插件，要么移除 default export）`,
          );
        }
      }
      if (options.packCheck === false) return;
      let packed: readonly string[];
      try {
        packed = await npmPackFiles(h.pluginDir);
      } catch (err) {
        // npm 缺席（ENOENT）= 环境位 skipped；其余 npm 报错照红（fail-loud 不吞）
        if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new SkippedRow('npm pack 探测不可用（环境无 npm）——pack 完整性未证');
        }
        throw err;
      }
      const referenced = packReferencedFiles(h.pluginDir, h.manifest);
      const missing = referenced.filter((ref) => !packed.includes(ref));
      if (missing.length > 0) {
        throw new Error(
          `npm pack 产物缺插件引用文件（files 白名单漏收）：${missing.join('、')}——发布物将不含装载必需文件`,
        );
      }
    });

    /* ---------------- mount（必进） ---------------- */
    await runRow('mount（真装载 activated + 注册账在场）', async () => {
      const mounted = h.mountRow();
      if (!mounted.ok) throw new Error(`启用行拒：${mounted.message}`);
      const boot = await h.boot();
      const activated = boot.report.activated.find((a) => a.id === h.pluginId);
      if (activated === undefined) {
        const failed = boot.report.failed.find((f) => f.id === h.pluginId);
        throw new Error(
          failed === undefined
            ? `装载计划面缺席（activated/failed 皆无 ${h.pluginId}）`
            : `装载失败（${failed.code}）：${failed.message}`,
        );
      }
      // 注册账在场（作者声明面）：命令名净计数 ≥ 1
      for (const name of expectCommands) {
        const count = h.commands.counts().get(name) ?? 0;
        if (count < 1) throw new Error(`期望命令 /${name} 未注册（注册账缺席）`);
      }
      // 纯声明形：技能/agents 目录账与清单声明同长
      if (h.manifest.entryPlan.kind === 'declared-payload') {
        const declaredSkills = h.manifest.skills?.length ?? 0;
        if (activated.skillDirs.length !== declaredSkills) {
          throw new Error(`技能目录账（${activated.skillDirs.length}）≠ 清单声明（${declaredSkills}）`);
        }
      }
    });

    /* ---------------- 事件面（必进——审计不 mock 真词面） ---------------- */
    await runRow('事件面（plugin/mounted 恰一笔）', async () => {
      const mountedCount = h.audit.countOf('plugin/mounted', (data) => data['id'] === h.pluginId);
      if (mountedCount !== 1) {
        throw new Error(`plugin/mounted 笔数 = ${mountedCount}（期 1——mountRow 一笔、boot diff 不重放）`);
      }
    });

    /* ---------------- 幂等/负向（顺手进） ---------------- */
    await runRow('幂等/负向（换代不双注 + mountRow 撞名拒）', async () => {
      await h.boot(); // 换代（harness 内先卸旧代再起新代——/reload 同语义）
      const mountedCount = h.audit.countOf('plugin/mounted', (data) => data['id'] === h.pluginId);
      if (mountedCount !== 1) throw new Error(`换代后 plugin/mounted 笔数 = ${mountedCount}（期 1——幂等 diff 不重放）`);
      for (const name of expectCommands) {
        const count = h.commands.counts().get(name) ?? 0;
        if (count !== 1) throw new Error(`换代后命令 /${name} 净计数 = ${count}（期 1——旧代出账后新代单注）`);
      }
      const dup = h.mountRow();
      if (dup.ok) throw new Error('mountRow 重复调用未被拒（撞名拒缺席——幂等执法失守）');
    });

    /* ---------------- toggle（顺手进——行翻转两断言） ---------------- */
    await runRow('toggle（行翻转两断言）', async () => {
      const off = h.toggleRow();
      if (!off.ok) throw new Error(`禁用翻转拒：${off.message}`);
      const offBoot = await h.boot();
      if (!offBoot.report.skipped.some((s) => s.id === h.pluginId)) {
        throw new Error('禁用行不在 skipped 面（disabled 旗标未生效）');
      }
      // boot diff 五形：enabled→disabled 时尾态已同（toggleRow 笔在前）→ 一致零落
      const offToggled = h.audit.countOf(
        'plugin/toggled',
        (data) => data['id'] === h.pluginId && data['disabled'] === true,
      );
      if (offToggled !== 1) throw new Error(`禁用后 plugin/toggled{true} 笔数 = ${offToggled}（期 1）`);
      const on = h.toggleRow();
      if (!on.ok) throw new Error(`回启用翻转拒：${on.message}`);
      const onBoot = await h.boot();
      if (!onBoot.report.activated.some((a) => a.id === h.pluginId)) {
        throw new Error('回启用行不在 activated 面（旗标撤除未生效）');
      }
    });

    /* ---------------- 开门面（顺手进——幂等 diff） ---------------- */
    await runRow('开门面（plugin/opens 幂等 diff）', async () => {
      h.grantOpens([OPENS_SAMPLE]);
      await h.boot();
      const opensRows = h.audit.all().filter((r) => r.type === 'plugin/opens' && r.data['pluginId'] === h.pluginId);
      if (opensRows.length !== 1) throw new Error(`plugin/opens 笔数 = ${opensRows.length}（期 1）`);
      const recorded = opensRows[0]!.data['opens'];
      if (JSON.stringify(recorded) !== JSON.stringify([OPENS_SAMPLE])) {
        throw new Error(`plugin/opens 载荷 ${JSON.stringify(recorded)} ≠ 授予面 [${OPENS_SAMPLE}]`);
      }
      await h.boot(); // 幂等：同面再 boot 不重放
      const after = h.audit.countOf('plugin/opens', (data) => data['pluginId'] === h.pluginId);
      if (after !== 1) throw new Error(`幂等再 boot 后 plugin/opens 笔数 = ${after}（期 1——有变才落失守）`);
    });

    /* ---------------- unmount（必进——absent 与 present 同重） ---------------- */
    await runRow('unmount（disposer 回卷 + 注册账缺席）', async () => {
      const receipt = await h.unloadCurrent();
      // 回执两查：有在飞代可回卷（null = 无代可卸——装载从未成）+ 回卷零失败
      //（receipt.disposed 只列 apply 返回清理函数的插件——ctx.effect 形注册
      // 走 fork dispose 腿不进 disposed 清单，故「已卸载」的真证明在下方账面）
      if (receipt === null) throw new Error('回卷回执 null（无在飞代可卸——装载从未成）');
      if (receipt.failed.length > 0) {
        throw new Error(`回卷失败面非空：${receipt.failed.map((f) => f.id).join('、')}`);
      }
      for (const name of expectCommands) {
        const count = h.commands.counts().get(name) ?? 0;
        if (count !== 0) throw new Error(`回卷后命令 /${name} 净计数 = ${count}（期 0——absent 断言同重）`);
      }
      for (const [word, net] of h.listeners.netCounts()) {
        if (net !== 0) throw new Error(`回卷后事件词 ${word} 净监听数 = ${net}（期 0——零注册残留）`);
      }
    });

    /* ---------------- 残留检查（白名单豁免——宿主记账方是合法残留） ---------------- */
    await runRow('残留检查（审计词 + 数据面双白名单）', async () => {
      const strayWords = [...new Set(h.audit.all().map((r) => r.type))].filter((t) => !HOST_AUDIT_WHITELIST.has(t));
      if (strayWords.length > 0) throw new Error(`审计流出现白名单外词：${strayWords.join('、')}`);
      const strayFiles = h.dataFiles().filter((f) => !HOST_DATAFILE_WHITELIST.has(f));
      if (strayFiles.length > 0) throw new Error(`数据目录出现白名单外文件：${strayFiles.join('、')}`);
    });

    return { pluginId: h.pluginId, ok: rows.every((r) => r.status !== 'fail'), rows };
  } finally {
    // 收场恒跑（证明先行——dispose 异常不折损已得报告）
    await harness?.dispose().catch(() => undefined);
  }
}

/**
 * pack 引用集（装载必需文件的清单侧全集）：entry-file 入口 + skills/agents
 * 声明目录下全部文件（相对包根 posix 形——npm pack 产物路径同形比对）。
 */
function packReferencedFiles(pluginDir: string, manifest: PluginManifest): readonly string[] {
  const refs: string[] = [];
  // entry-file 形入口在场（entryPlan 判据同源——entry 字段类型可选故判空防）
  if (manifest.entryPlan.kind === 'entry-file' && manifest.entry !== undefined) {
    refs.push(posix.normalize(manifest.entry));
  }
  for (const dir of [...(manifest.skills ?? []), ...(manifest.agents ?? [])]) {
    const abs = join(pluginDir, dir);
    if (!statSync(abs).isDirectory()) throw new Error(`声明载荷目录缺席：${dir}`);
    // 基 = 包根（npm pack 产物路径相对包根——目录基会推成目录内相对形比对永错）
    collectFiles(pluginDir, abs, refs);
  }
  return refs;
}

/** 目录递归收文件（rel 基 = 包根——与 npm pack 产物路径同形） */
function collectFiles(base: string, dir: string, out: string[]): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    if (statSync(abs).isDirectory()) collectFiles(base, abs, out);
    else out.push(posix.normalize(abs.slice(base.length + 1)));
  }
}

/** 包主入口解析（main/module 字段 → 存在的文件；缺席 = null） */
function resolvePackageMain(pluginDir: string, pkg: Record<string, unknown>): string | null {
  const candidate =
    typeof pkg['main'] === 'string' ? pkg['main'] : typeof pkg['module'] === 'string' ? pkg['module'] : null;
  if (candidate === null) return null;
  const abs = join(pluginDir, candidate);
  try {
    return statSync(abs).isFile() ? abs : null;
  } catch {
    return null;
  }
}

/** main 模块求值探针（求值失败 = null 非红——失败证据缺席不冒充在场） */
async function jitiProbe(mainPath: string): Promise<Record<string, unknown> | null> {
  try {
    const jiti = createJiti(mainPath);
    return (await jiti.import(mainPath)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 可贴 README 的 markdown 回执（「产出可贴 README 的证明」——03 §9.5 定位段）。
 */
export function formatMatrixReceipt(report: LifecycleMatrixReport): string {
  const lines = [
    `## berry-agent 插件生命周期证明 —— ${report.pluginId}`,
    '',
    '| 检查行 | 结果 |',
    '| --- | --- |',
    ...report.rows.map(
      (r) =>
        `| ${r.row} | ${r.status === 'pass' ? '✅' : r.status === 'skipped' ? '⏭️' : '❌'}${r.detail === undefined ? '' : `（${r.detail}）`} |`,
    ),
    '',
    ` berry-agent testkit · 共 ${report.rows.length} 行`,
  ];
  return lines.join('\n');
}
