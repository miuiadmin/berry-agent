/**
 * host/plugins-cmd — `plugins` 子命令族 CLI 入口（03 §5.8 三面同源之 CLI 面；
 * 07 §5 命令族；批 12f-3）。
 *
 * 子动词分账（本批射程如实）：
 *  - **list**：装载态清单三分区（启用/失败/禁用——07 §5「装载态清单」）。
 *    走与 dump-config **同一合成代码路径**（assembly.ts 公共段 + memory
 *    同构诊断形——真数据目录读侧 + 主库零落盘 + 不占标记）；装载器执法/
 *    校验/插件 apply 全跑后取 report 三面。
 *  - **check**：纯只读零装配（07 §5「数据面纯只读零装配」——不走装载，
 *    直读装机账本）。本批骨架：账本缺席/为空 = 零装机无可体检项退 0；
 *    账本非空时 api 块三色裁决（apiVersion 兼容矩阵 + 废弃遥测汇总）挂账
 *    API 治理批（03 §8.4/§8.9——core: 插件清单 api 块回填同批）。
 *  - **install/uninstall/mount/unmount/toggle/update**：装机写侧动词——
 *    账本容器形与 installPath 写侧定形归 install 批（03 §5.5/§5.8；12f-2b
 *    落码批挂账），生命周期逐行时点归 /reload 批。诚实退 1「尚未装配」
 *    （解析与旗标面已就绪——不静默吞）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveDataDir } from '../persist/index.js';

import type { PluginsCommand } from './cli.js';
import { assembleHostStack } from './assembly.js';
import type { CorePluginReference } from './loader.js';
import type { HostRuntime } from './runtime.js';

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
    default:
      // 写侧六动词（install/uninstall/mount/unmount/toggle/update）——
      // 装机写侧归 install 批、生命周期逐行时点归 /reload 批（件头注分账）
      return pendingWriteVerb(sub.sub, options);
  }
}

/** list：同一合成代码路径装载 → 三分区人读输出（07 §5「装载态清单」） */
async function runList(options: PluginsEntryOptions): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => process.stdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => process.stderr.write(`${text}\n`));
  const assembly = await assembleHostStack({
    runtime: {
      ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
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
    for (const a of activated) lines.push(`  ${a.id}${a.skills.length > 0 ? `  技能：${a.skills.join('、')}` : ''}`);
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
  const writeOut = options.writeOut ?? ((text) => process.stdout.write(`${text}\n`));
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

/** 写侧动词诚实档（解析面已就绪、执行面随后续批装配——fail-loud 不静默） */
function pendingWriteVerb(sub: string, options: PluginsEntryOptions): number {
  const writeErr = options.writeErr ?? ((text) => process.stderr.write(`${text}\n`));
  writeErr(
    `plugins ${sub} 执行面尚未装配（装机写侧归 install 批、生命周期逐行时点归 /reload 批——03 §5.5/§5.8）——本子命令解析与旗标面已就绪`,
  );
  return 1;
}
