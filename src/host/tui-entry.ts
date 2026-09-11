/**
 * host/tui-entry — TUI 主入口装配（批 12e；07 §5 无参启动 = TUI 主入口）。
 *
 * 装配序（channels/service.ts 头注真源；公共段批 12f-3 抽 assembly.ts——与
 * dump-config/plugins list 诊断命令同一合成代码路径）：assembleHostStack
 * （运行时→logger→根作用域/总线→conversation 栈→插件装载，:memory: 同构
 * 纪律防侧门件）→ [本件 TUI 段] --port webui 开面（装载后/挂接前）→
 * openStartupSession（07 §5 启动会话策略：cwd 归一根取最新续接、无则新建；
 * resumeSessionId 在场 = 按 id 续接——sessions resume <id> 的 CLI 载体〔批 20d〕）
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
import { canonicalWorkspaceRoot } from '../context/index.js';
import { foldTodoTable } from '../conversation/index.js';
import { sanitizeEntryForReadout, type MemoryDao } from '../memory/index.js';
import type { Provider } from '../llm/index.js';
import type { SandboxMode } from '../safety/index.js';

import type { TuiFlags } from './cli.js';
import { assembleHostStack } from './assembly.js';
import type { AssemblySuccess } from './assembly.js';
import { startSchedulerClock } from './core-plugins.js';
import type { CorePluginReference } from './loader.js';
import { runWithSessionAnchor } from './session-anchor.js';
import type { HostRuntime } from './runtime.js';
import { openWebuiFace } from './webui-bridge.js';
import type { WebuiMountKit } from './webui-bridge.js';
import type { PluginRouteRegistry } from '../sdk/index.js';
import type { StartupSession } from './conversation-stack.js';

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
  /** core: 官方件注册表（缺省 createCorePlugins 单源——批 19a/19b-1 工厂形；测试注入面） */
  readonly corePlugins?: readonly CorePluginReference[];
  /** 指定续接会话 id（sessions resume <id> 的 CLI 载体——在场即按 id 续接，
   * 取代「按 cwd 取最新」缺省策略；07 §5 两选取键互补条） */
  readonly resumeSessionId?: string;
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
    // 快速试件透传（--plugin-file——03 §7 生态启动批 eco-3a；缺席形省键）
    ...(options.flags.pluginFile !== undefined ? { pluginFile: options.flags.pluginFile } : {}),
    debug: options.flags.debug === true,
    version: options.version ?? '0.0.0',
    ...(options.providers !== undefined ? { providers: options.providers } : {}),
    ...(options.model !== undefined ? { model: options.model } : {}),
    ...(options.env !== undefined ? { env: options.env } : {}),
    ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
    ...(options.corePlugins !== undefined ? { corePlugins: options.corePlugins } : {}),
    ...(options.onRuntime !== undefined ? { onRuntime: options.onRuntime } : {}),
  });
  if (!assembly.ok) {
    // 两档呈报：crashed = 意外异常（crash.log 已在装配件内写——memory 形跳过）；
    // 干净退出档 = 启动失败（单活跃机/开库/启用清单损坏——不写 crash.log）
    process.stderr.write(`${assembly.crashed ? `TUI 运行失败：${assembly.message}` : assembly.message}\n`);
    return assembly.exitCode;
  }
  const { runtime, stack, scope }: AssemblySuccess = assembly;

  let exitCode = 0;
  try {
    // —— scheduler 挂钟起钟（批 20c——长驻形编舞）：件在场即起（重启补推进
    // + 排首轮轮询），停钟挂 closer（engine 真身定时器非 unref——不挂停钟
    // 会把进程拖活到 60s belt 定时器）；件缺席 = no-op（件禁用语义族）——
    startSchedulerClock(scope, runtime);

    // —— --port webui 统一 HTTP 面开面（批 12f-2c 落、18a-3' 三入口咬合；
    // 03 §10.4 host 接线）：装载后开面（插件注册面先就位）、TUI 挂接前开
    // 网络面（closer 注册序先于 tui-backend——drain 时网络面先收口再出屏）；
    // backend 挂接在桥共用挂载段内完成（与 TuiBackend 并存扇出——多 backend
    // 信封路由按 sessionId 各投各）；横幅在 TUI 起屏后补发（开面时 backends
    // 尚空 notify 扇出无人接帧——见下方 focus 后发）。批 19e 件在场执法：
    // sdk 件缺席 = 面本体件禁用语义族——warn 一行不开面（TUI 屏本体不受
    // 累）；webui 件缺席 = 面开而 /api/* 404（mountKit 缺席形——openWebuiFace
    // 内分档披露，横幅同步分档）——
    let webuiOpen: { host: string; port: number; token: string } | undefined;
    let webuiMounted = false;
    if (options.flags.port !== undefined) {
      const sdkKit = scope.tryGet<{ readonly createFace: unknown; readonly pluginRoutes?: PluginRouteRegistry }>(
        'sdk-http-face',
      );
      if (sdkKit === undefined) {
        process.stderr.write('warn：core:sdk 件未装载——--port 人面不开（07 §5 daemon 拒启同族；TUI 屏不受累）\n');
      } else {
        const mountKit = scope.tryGet<WebuiMountKit>('webui-face-mount');
        webuiMounted = mountKit !== undefined;
        await openWebuiFace({
          stack,
          runtime,
          port: options.flags.port,
          ...(mountKit !== undefined ? { mountKit } : {}),
          // U5-2：插件道路由受理器经 core:sdk kit 透传（snapshot/attachFace）
          ...(sdkKit.pluginRoutes !== undefined ? { pluginRoutes: sdkKit.pluginRoutes } : {}),
          onOpen: (info) => {
            webuiOpen = info;
            options.onWebuiOpen?.(info);
          },
        });
      }
    }

    // 启动会话策略（07 §5）：无参启动按 cwd 取最新会话——有则续接无则新建；
    // resumeSessionId 在场（sessions resume <id> 的 CLI 载体）= 按 id 续接
    // （与「按 cwd 取最新」互补）——id 缺席干净退 1（打错 id 不造新会话、不
    // 写 crash.log；finally 仍走 shutdown 六步收口，此点尚未起 TUI 屏）
    let session: StartupSession;
    if (options.resumeSessionId !== undefined) {
      let opened;
      try {
        opened = stack.manager.open(options.resumeSessionId);
      } catch {
        process.stderr.write(
          `sessions resume 失败：会话不存在（${options.resumeSessionId}）——用 sessions list 查在册 id\n`,
        );
        return 1;
      }
      // @ 文件补全锚 = 会话自身工作区根（行面现读；缺席回退启动 cwd）
      const row = runtime.persistence.store.getSessionRow(options.resumeSessionId);
      session = {
        sessionId: opened.sessionId,
        driver: opened.driver,
        resumed: true,
        workspaceRoot: canonicalWorkspaceRoot(row?.workspaceRoot ?? options.cwd ?? process.cwd()),
      };
    } else {
      session = stack.openStartupSession(options.cwd ?? process.cwd());
    }

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
      // 命令执行窗自动锚（ix-2——07 §4.3 档位 2）：发起会话 = 聚焦会话
      //（兜底启动会话——焦点空悬时命令仍属 TUI 主会话）；ALS 语境继承语义
      //——命令 handler 及其 fire-and-forget 尾链零自觉锚定（显式 opts
      // .sessionId 优先）。sessionId 实参同笔透传（CommandArgs 显式位）。
      dispatchCommand: (input: string) => {
        const sid = stack.channels.focusedId ?? session.sessionId;
        return runWithSessionAnchor(sid, () => stack.channels.dispatchCommand(input, sid));
      },
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

    // —— /memory 管理面材料注入（mm 批——06 §7 形态定形注）：boot 已完成
    //（assembleHostStack 内插件装载），core:memory 服务面在场（库座在位且件
    // 装载）→ 后置注入 TuiBackend 后置位：ownerKeys/runExport 经服务面传真
    // 身（导出闭包 = /memory 命令注册同一形），消毒函数直取 §8.2 统一函数
    // 本尊（「同一函数」由装配保证——channels 侧窄面结构兼容 MemoryDao）。
    // 件缺席 = 不注入（openMemory 返 false——/memory 命令核侧 notify 降级）
    const memoryFace = scope.tryGet<{
      readonly dao: MemoryDao;
      readonly ownerKeys: readonly string[];
      readonly runExport: (argv: readonly string[]) => Promise<string>;
    }>('memory');
    if (memoryFace !== undefined) {
      backend.setMemoryScreen({
        ownerKeys: memoryFace.ownerKeys,
        dao: memoryFace.dao,
        sanitize: sanitizeEntryForReadout,
        exportCommand: memoryFace.runExport,
      });
    }

    stack.channels.addBackend(backend);
    backend.start();
    stack.channels.registerSession(session.sessionId);
    await stack.channels.focus(session.sessionId); // 启动投影首画（含 resume 历史回读）

    // webui 开面横幅（18a-3'）：TuiBackend 起屏后经 channels.notify 扇出——
    // notify 恒扇出（webui backend 同帧收到，浏览器通知位随活）；横幅走屏
    // 留痕面只带 URL，token 不入屏（令牌仅 stderr 一次性——屏流可回滚/截屏，
    // 非披露通道）；批 19e 分档：webui 件缺席形面仍开（SDK 面）——横幅诚实
    // 报 HTTP 面形不虚报 Web 界面
    if (webuiOpen !== undefined && webuiMounted) {
      stack.channels.notify(
        session.sessionId,
        `Web 界面已开面：http://${webuiOpen.host}:${webuiOpen.port}/（访问令牌见启动 stderr——仅此一次显示）`,
        { level: 'info' },
      );
    } else if (webuiOpen !== undefined) {
      stack.channels.notify(
        session.sessionId,
        `HTTP 面已开面：http://${webuiOpen.host}:${webuiOpen.port}/（webui 件未装载——/v1/* 程序调用面在场，/api/* 404）`,
        { level: 'info' },
      );
    }

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
