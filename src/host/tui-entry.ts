/**
 * host/tui-entry — TUI 主入口装配（批 12e；07 §5 无参启动 = TUI 主入口）。
 *
 * 装配序（channels/service.ts 头注真源；公共段批 12f-3 抽 assembly.ts——与
 * dump-config/plugins list 诊断命令同一合成代码路径）：assembleHostStack
 * （运行时→logger→根作用域/总线→conversation 栈→插件装载，:memory: 同构
 * 纪律防侧门件）→ [本件 TUI 段] --port webui 开面（装载后/挂接前）→
 * openStartupSession（07 §5 启动会话策略：cwd 归一根取最新续接、无则新建）
 * → TuiBackend 组装（提交/打断/退出/命令分发/todo 回看/补全三源/version
 * 基线/生产定时器）→ addBackend → start → registerSession → focus 首画 →
 * 主循环 await 退出 → runtime.shutdown 六步退出序（closer 内含 backend.stop
 * 出屏复原）。
 *
 * 退出码：0 = ctrl+d 空框优雅退出；1 = 运行时组装失败（单活跃机拒入/开库
 * 失败——干净退出不写 crash.log，非崩溃）、启用清单损坏（同干净退出档）或
 * 运行期异常（先 writeCrashLog 再退）。
 * 信号路径独立：SIGINT①/SIGTERM → onGraceful → runtime.shutdown → exit(0)
 * （main.ts 编舞；本件 closer 注册保证出屏复原在该路径同样执行）。
 */
import { FileMentionSource, ProcessTerminalIO, TuiBackend } from '../channels/index.js';
import type { AutocompleteItem, TerminalIO } from '../channels/index.js';
import { foldTodoTable } from '../conversation/index.js';
import type { Provider } from '../llm/index.js';
import type { SandboxMode } from '../safety/index.js';

import type { TuiFlags } from './cli.js';
import { assembleHostStack } from './assembly.js';
import type { AssemblySuccess } from './assembly.js';
import type { HostRuntime } from './runtime.js';
import { openWebuiFace } from './webui-bridge.js';

/** TUI 入口选项（main 分派接线 + 测试注入面） */
export interface TuiEntryOptions {
  readonly flags: TuiFlags;
  /** 终端适配器（缺省 ProcessTerminalIO——process stdin/stdout 直连） */
  readonly io?: TerminalIO;
  /** 启动会话策略锚点（缺省 process.cwd()） */
  readonly cwd?: string;
  /** 版本串（OSC title 基线——批 12 真值挂账兑现位；缺席 = 裸名基线） */
  readonly version?: string;
  /** 数据目录（HostRuntimeOptions 透传；缺省 resolveDataDir() 三级梯子） */
  readonly dataDir?: string;
  /** :memory: 同构形态（诊断测试） */
  readonly memory?: boolean;
  /** 初始 provider 集（测试注入 faux provider） */
  readonly providers?: readonly Provider[];
  /** 模型标识（组合根透传；缺省 BERRY_AGENT_MODEL 覆盖律） */
  readonly model?: string;
  /** 沙箱档位取值器（透传组合根；缺省 workspace-write） */
  readonly sandboxMode?: () => SandboxMode;
  /** env 面（缺省 process.env；测试隔离 BERRY_AGENT_MODEL） */
  readonly env?: Record<string, string | undefined>;
  /** 运行时组装后回调（main.ts attachRuntime——信号/崩溃编舞切运行时本体） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** webui 开面回执（`--port` 在场时开面后回调——测试拿实配端口与 token） */
  readonly onWebuiOpen?: (info: { host: string; port: number; token: string }) => void;
}

/**
 * TUI 主入口。阻塞至用户退出（ctrl+d 空框）或异常；返回进程退出码。
 */
export async function runTuiEntry(options: TuiEntryOptions): Promise<number> {
  // —— 装配序公共段（12f-3 抽件）：与 dump-config/plugins list 诊断命令同一
  // 合成代码路径（07 §5 :memory: 同构纪律——防侧门件 assembly.ts 唯一真源）；
  // TUI 形 = 真数据目录 + 真库（memory 组合形归诊断命令）——
  const assembly = await assembleHostStack({
    runtime: {
      ...(options.dataDir !== undefined ? { dataDir: options.dataDir } : {}),
      ...(options.memory === true ? { memory: true } : {}),
    },
    noPlugins: options.flags.noPlugins === true,
    debug: options.flags.debug === true,
    version: options.version ?? '0.0.0',
    ...(options.providers !== undefined ? { providers: options.providers } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
    ...(options.onRuntime !== undefined ? { onRuntime: options.onRuntime } : {}),
  });
  if (!assembly.ok) {
    // 两档呈报：crashed = 意外异常（crash.log 已在装配件内写——memory 形跳过）；
    // 干净退出档 = 启动失败（单活跃机/开库/启用清单损坏——不写 crash.log）
    process.stderr.write(`${assembly.crashed ? `TUI 运行失败：${assembly.message}` : assembly.message}\n`);
    return assembly.exitCode;
  }
  const { runtime, stack }: AssemblySuccess = assembly;

  let exitCode = 0;
  try {
    // —— --port webui 一次性开面（批 12f-2c；03 §10.4 host 接线）：装载后
    // 开面（插件注册面先就位）、TUI 挂接前关网络面（closer 注册序先于
    // tui-backend——drain 时网络先关再出屏）；backend 挂接与 TuiBackend
    // 并存扇出——
    if (options.flags.port !== undefined) {
      await openWebuiFace({
        stack,
        runtime,
        port: options.flags.port,
        ...(options.onWebuiOpen !== undefined ? { onOpen: options.onWebuiOpen } : {}),
      });
    }

    // 启动会话策略（07 §5）：无参启动按 cwd 取最新会话——有则续接无则新建
    const session = stack.openStartupSession(options.cwd ?? process.cwd());

    const io = options.io ?? new ProcessTerminalIO();
    let quitResolve: () => void = () => {};
    const quitDone = new Promise<void>((resolve) => {
      quitResolve = resolve;
    });

    // 补全命令源：通道核命令表 → '/' 前缀条目（@ 文件段源锚工作区根）
    const mentions = new FileMentionSource({ basePath: session.workspaceRoot });
    const rows = io.size().rows;
    const backend = new TuiBackend(io, {
      sessionId: session.sessionId,
      onSubmit: (sessionId, text) => {
        void stack.submitText(sessionId, text); // fire-and-forget——回执经信封回流
      },
      onInterrupt: (sessionId) => stack.interrupt(sessionId),
      onQuit: () => quitResolve(),
      dispatchCommand: (input) => stack.channels.dispatchCommand(input),
      todoFor: (sessionId) => {
        const driver = stack.driverOf(sessionId);
        return driver === undefined ? null : foldTodoTable(driver.session.events());
      },
      autocomplete: {
        commands: (query) => commandItems(stack.channels.listCommands(), query),
        mentions: (query) => mentions.get(query),
      },
      // 装配实测定值（07 §4.1）：编辑器可视行 = 终端高 30%（下钳 3）
      maxVisibleLines: Math.max(3, Math.floor(rows * 0.3)),
      ...(options.version !== undefined ? { version: options.version } : {}),
      // 生产定时器注入（保活/帧帽真定时——缺省同步直出仅测试语义）
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancelSchedule: (handle) => clearTimeout(handle as NodeJS.Timeout),
    });

    // 出屏复原进退出序 closer——quit 路径与信号路径（onGraceful→shutdown）同享
    runtime.registerCloser({ label: 'tui-backend', fn: () => backend.stop() });

    stack.channels.addBackend(backend);
    backend.start();
    stack.channels.registerSession(session.sessionId);
    await stack.channels.focus(session.sessionId); // 启动投影首画（含 resume 历史回读）

    await quitDone; // 主循环——输入事件驱动，直至 ctrl+d 空框退出
  } catch (err) {
    runtime.writeCrashLog(err); // 崩溃取证先行（memory 形跳过——件内语义）
    process.stderr.write(`TUI 运行失败：${err instanceof Error ? err.message : String(err)}\n`);
    exitCode = 1;
  } finally {
    await runtime.shutdown(); // 幂等六步：abort → closer（backend.stop 出屏）→ flush → …
  }
  return exitCode;
}

/** 命令表 → 补全条目（'/' 前缀过滤——query 已去斜杠，AutocompleteSources 契约） */
function commandItems(
  specs: readonly { name: string; description?: string }[],
  query: string,
): readonly AutocompleteItem[] {
  return specs
    .filter((spec) => spec.name.startsWith(query))
    .map((spec) => ({
      label: `/${spec.name}`,
      ...(spec.description !== undefined ? { detail: spec.description } : {}),
      replacement: `/${spec.name}`,
    }));
}
