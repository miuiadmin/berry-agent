/**
 * host/dump-config — `dump-config` 诊断入口（07 §5；批 12f-3）。
 *
 * **:memory: 同构纪律（07 §5 钉死）**：禁 fork 诊断侧门——复用同一运行时
 * 装配入口（assembly.ts 公共段，与 TUI 入口同一合成代码路径）、改传
 * memory+dataDir 同构诊断形（真数据目录读侧〔enabled.yaml/装机账本〕+
 * 主库 :memory: 零落盘 + 不占活跃标记），装载器执法/校验/插件 apply 全跑
 * 后打印。理由：诊断命令的价值 = 报告真实装载会走到的路。
 *
 * 输出（stdout 单 JSON 对象——机器可读；07 §5「启用清单解析 + 装载结果」
 * ——装载结果三面 activated/failed/skipped 即启用清单解析的下游产物）。
 * `--port` 收下不起监听（07 §5 旗标块）——flags 段如实注记。失败档：装配
 * 干净退出（启动失败/启用清单损坏）= stderr message + 退 1（不写
 * crash.log——诊断命令半途即止，无运行期崩溃可言）。
 *
 * dataDir 缺省律（74 轮批注——与 plugins list obs-c 修同形）：缺省解析走
 * `resolveDataDir()` 恒在场（env 梯子 BERRY_AGENT_DATA_DIR 接通）；修前主路恒
 * :memory: 空配形（dataDir=null ⇒ 真数据目录读侧整跳）。副作用边界如实：
 * 修真后与 plugins list 同形——apply 期孤儿清扫/fire-and-forget 同样触达。
 */
import type { DumpConfigFlags } from './cli.js';
import { assembleHostStack } from './assembly.js';
import type { CorePluginReference } from './loader.js';
import type { HostRuntime } from './runtime.js';
import { resolveDataDir } from '../persist/index.js';

/** 入口选项（main 分派接线 + 测试注入面） */
export interface DumpConfigEntryOptions {
  readonly flags: DumpConfigFlags;
  /** 宿主版本（readVersion 产物） */
  readonly version: string;
  /** 数据目录（缺省 resolveDataDir() 三级梯子——真盘读侧） */
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

/** dump-config 主入口：同构装配 → 打印 JSON → 收口。返回进程退出码。 */
export async function runDumpConfigEntry(options: DumpConfigEntryOptions): Promise<number> {
  const writeOut = options.writeOut ?? ((text) => process.stdout.write(`${text}\n`));
  const writeErr = options.writeErr ?? ((text) => process.stderr.write(`${text}\n`));
  // dataDir 解析与 plugins list 同律（?? resolveDataDir()——env 梯子
  // BERRY_AGENT_DATA_DIR 由此接通；74 轮 obs-c 同病未同步位修：修前条件展开
  // 在 undefined 时省略 dataDir ⇒ memory 诊断形 dataDir=null ⇒ 主路〔main.ts
  // dumpConfig 载体不传 dataDir〕恒纯 memory 空配形——enabled.yaml/装机账本/
  // settings 读侧整跳、输出 dataDir 呈 null、插件装载态呈出厂缺省而非用户
  // 实配）
  const dataDir = options.dataDir ?? resolveDataDir();
  const assembly = await assembleHostStack({
    runtime: {
      dataDir,
      memory: true, // 同构诊断形（memory + 真数据目录读侧——dataDir 恒在场）
    },
    noPlugins: options.flags.noPlugins === true,
    debug: options.flags.debug === true,
    version: options.version,
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.onRuntime !== undefined ? { onRuntime: options.onRuntime } : {}),
    ...(options.corePlugins !== undefined ? { corePlugins: options.corePlugins } : {}),
  });
  if (!assembly.ok) {
    writeErr(assembly.message); // 干净退出档语义（message 已含前缀与修复指引）
    return assembly.exitCode;
  }
  try {
    writeOut(
      JSON.stringify(
        {
          version: options.version,
          dataDir: assembly.runtime.dataDir,
          database: ':memory:', // 同构诊断形注记——主库零落盘（07 §5）
          model: assembly.stack.model,
          // --port 收下不起监听（07 §5 旗标块「dump-config 忽略不起监听」）；
          // 布尔归一（缺省 false）——诊断 JSON 键形稳定（undefined 会被 stringify 丢键）
          flags: { noPlugins: options.flags.noPlugins === true, port: options.flags.port ?? null },
          plugins: {
            activated: assembly.boot.report.activated,
            failed: assembly.boot.report.failed,
            skipped: assembly.boot.report.skipped,
          },
          counts: assembly.boot.counts,
        },
        null,
        2,
      ),
    );
    return 0;
  } finally {
    await assembly.runtime.shutdown(); // 幂等六步（closer 含插件卸载回卷）
  }
}
