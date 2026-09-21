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
 * 基线/生产定时器/主题档）→ addBackend → start → registerSession → focus 首画 →
 * 主循环 await 退出 → runtime.shutdown 六步退出序（closer 内含 backend.stop
 * 出屏复原）。
 *
 * 退出码：0 = ctrl+d 空框优雅退出；1 = 运行时组装失败（单活跃机拒入/开库
 * 失败——干净退出不写 crash.log，非崩溃）、启用清单损坏（同干净退出档）或
 * 运行期异常（先 writeCrashLog 再退）。
 * 信号路径独立：SIGINT①/SIGTERM → onGraceful → runtime.shutdown → exit(0)
 * （main.ts 编舞；本件 closer 注册保证出屏复原在该路径同样执行）。
 */
import { basename } from 'node:path';
import { readFileSync } from 'node:fs';

import {
  BootAnimation,
  editorHeightCap,
  FileMentionSource,
  fuzzyFilter,
  listCustomThemeNames,
  loadCustomThemeColors,
  ProcessTerminalIO,
  TuiBackend,
} from '../channels/index.js';
import type { AutocompleteItem, TerminalIO } from '../channels/index.js';
import { USER_GRANTABLE_CAPABILITIES } from '../contracts/api.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import {
  foldSessionSandboxMode,
  foldSessionThinkingLevel,
  foldSessionUsage,
  foldTodoTable,
  setSessionMode,
  setSessionThinkingLevel,
  THINKING_LEVELS,
} from '../conversation/index.js';
import { sanitizeEntryForReadout, shortIdOf, type MemoryDao } from '../memory/index.js';
import { sessionDisplayTitleOf } from '../persist/index.js';
import { formatSkillInvocation, type SkillsRegistry } from '../skills/index.js';
import type { Provider } from '../llm/index.js';
import { APPROVAL_PRESETS, SANDBOX_MODES, type SandboxMode } from '../safety/index.js';
import { REWIND_SUBVERBS, type CheckpointStore } from '../checkpoint/index.js';

import type { TuiFlags } from './cli.js';
import { assembleHostStack } from './assembly.js';
import type { AssemblySuccess } from './assembly.js';
import { startSchedulerClock } from './core-plugins.js';
import type { CorePluginReference } from './loader.js';
import { runWithSessionAnchor } from './session-anchor.js';
import { liveCommandArgumentItems, type LiveCompletionDeps } from './live-completions.js';
import { readHostSettings, writeHostSettings } from './settings-store.js';
import { daemonPaths } from './serve-daemon.js';
import {
  compareSemverFull,
  createNodeUpdateCheckFs,
  recordNotifiedVersion,
  REGISTRY_FALLBACK_NOTE,
  runManualUpdateCheck,
  runStartupUpdateCheck,
  TARGET_RE,
  type ManualCheckResult,
  type StartupCheckDecision,
  type UpdateCheckDeps,
} from './upgrade.js';
import { createDefaultSpawnRunner } from './plugin-install.js';
import type { HostRuntime } from './runtime.js';
import { APPROVAL_SUBVERBS } from './approval-cmd.js';
import { DOORS_SUBVERBS } from './doors-cmd.js';
import { PLUGINS_SUBVERBS } from './plugins-command.js';
import { runMarketplaceEntry } from './marketplace-cmd.js';
import { MarketplaceTuiFace } from './marketplace-tui-face.js';
import type { UninstallChoice } from './marketplace-tui-face.js';
import {
  SANDBOX_MODE_DETAILS,
  SANDBOX_MODE_SHORT,
  THINKING_LEVEL_DETAILS,
  THINKING_LEVEL_SHORT,
  sandboxModeReceipt,
  thinkingLevelReceipt,
} from './session-tier-copy.js';
import { createMarketFs } from './plugin-market/index.js';
import { createPluginStoreFs, readLedger } from './plugin-store.js';
import { openWebuiFace } from './webui-bridge.js';
import type { WebuiMountKit } from './webui-bridge.js';
import type { PluginRouteRegistry } from '../sdk/index.js';
import type { ConversationStack, StartupSession } from './conversation-stack.js';

/**
 * 档位文案与回执单源已迁 host/session-tier-copy.ts（2026-09-18 webui 档位面
 * 受理批——两装配面同源消费律：TUI picker 装配与 webui 桥共用 THINKING_LEVEL_
 * DETAILS / SANDBOX_MODE_DETAILS 两表与两回执拼装函数；07 §4.1 danger 档
 * 行说明位文案钉死句以规范面为唯一引证源）。
 */

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
  /** 装配栈回调（注入面——测试拿真装配栈：跨入口结算通知 e2e 位；与
   * onRuntime/onWebuiOpen 注入面同族先例） */
  readonly onStack?: (stack: ConversationStack) => void;
  /** webui 开面回执（`--port` 在场时开面后回调——测试拿实配端口与 token） */
  readonly onWebuiOpen?: (info: { host: string; port: number; token: string }) => void;
  /** 启动版本检查腿注入面（07 §8.5 第 6 条——缺省产线真身 runStartupUpdateCheck；
   * 测试注桩零网络 + 接线锁。回执消费律单点在装配位：hasUpdate 且该版未提示过
   * → notify + 落 notifiedVersion，其余结局零提示零噪音） */
  readonly startupUpdateCheck?: (
    deps: UpdateCheckDeps & { readonly env: { readonly [key: string]: string | undefined } },
  ) => Promise<StartupCheckDecision>;
  /** /upgrade 薄壳检查腿注入面（07 §8.5 第 2 条——缺省产线真身
   * runManualUpdateCheck；测试注桩零网络 + 回执消费锁，同 startupUpdateCheck
   * 注入面先例。回执消费律单点在装配位：ok 三态呈现 + registryFallback
   * 注记不静默吞） */
  readonly manualUpdateCheck?: (deps: UpdateCheckDeps) => Promise<ManualCheckResult>;
  /** 启动打点件 stderr 落点注入面（07 §4.1 呈现面件 10 批D——缺省
   * process.stderr.write，测试收账零 stderr 污染；门开关 = env
   * BERRY_AGENT_TIMING=1 与注入面正交——sink 在场门关零写出） */
  readonly bootTimingSink?: (text: string) => void;
}

/**
 * TUI 主入口。阻塞至用户退出（ctrl+d 空框）或异常；返回进程退出码。
 */
export async function runTuiEntry(options: TuiEntryOptions): Promise<number> {
  // —— 启动动画件（三反馈批D——07 §4.1 呈现面件 10）：io 先于装配构造
  // （构造态零副作用），动画行在 cooked 窗直写 io（零 CSI/OSC 纯文本——
  // ONLCR 交驱动）；raw 窗（io.ready）在装配后才进——进屏序两窗分立
  // （07 :204 射程分立：本件非探测类写出）。打点门 = BERRY_AGENT_TIMING=1。
  const io = options.io ?? new ProcessTerminalIO();
  const bootAnimation = new BootAnimation((text) => io.write(text), {
    version: options.version ?? '0.0.0',
    timingEnabled: (options.env ?? process.env).BERRY_AGENT_TIMING === '1',
    ...(options.bootTimingSink !== undefined ? { stderr: options.bootTimingSink } : {}),
  });
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
    // 启动动画供数面（先行件2 83cd378——批D 消费位）：阶段事件 + 插件装载
    // 前达钩子（诊断命令不注两柄 = 零动画零打点——同一装配真源正交于注入）
    onBootStage: (event) => bootAnimation.stage(event.stage, event.phase, event.detail),
    onPluginLoadStart: (pluginId, index, total) => bootAnimation.pluginLoad(pluginId, index, total),
  });
  // 装配返回点收尾（成功/!ok 早退两路共经此点——失败路部分阶段行留存；
  // 幂等 + 悬段入账 + 门开时 stderr 段计时汇总）
  bootAnimation.finish();
  if (!assembly.ok) {
    // 两档呈报：crashed = 意外异常（crash.log 已在装配件内写——memory 形跳过）；
    // 干净退出档 = 启动失败（单活跃机/开库/启用清单损坏——不写 crash.log）
    process.stderr.write(`${assembly.crashed ? `TUI 运行失败：${assembly.message}` : assembly.message}\n`);
    return assembly.exitCode;
  }
  const { runtime, stack, scope, logger, boot, reloader }: AssemblySuccess = assembly;

  // 装配栈回调（注入面——见 TuiEntryOptions.onStack 注）
  options.onStack?.(stack);

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

    // io 已于装配前构造（批D 启动动画直写窗——cooked 窗先于 raw 窗复用同件）
    let quitResolve: () => void = () => {};
    const quitDone = new Promise<void>((resolve) => {
      quitResolve = resolve;
    });

    // 补全命令源：通道核命令表 → '/' 前缀条目；@ 文件段源动态锚（R7 批
    // 10k）——切焦后锚随聚焦会话工作区根（行面现读；聚焦空悬/行缺席回退
    // 启动会话根——FileMentionSource per-query 新铸，锚取当下真值）
    const mentionSourceFor = (): FileMentionSource => {
      const focused = stack.channels.focusedId;
      const root =
        focused === null
          ? session.workspaceRoot
          : canonicalWorkspaceRoot(
              runtime.persistence.store.getSessionRow(focused)?.workspaceRoot ?? session.workspaceRoot,
            );
      return new FileMentionSource({ basePath: root });
    };
    const rows = io.size().rows;
    // —— 活体值补全依赖（挂账解挂批 2026-09-15——07 §4.1 R6）：/rewind 尾参位
    // 经 core:checkpoint 服务面现取 manifest 清单（scope.tryGet——core-plugins
    // provide 'checkpoint' { store }），按聚焦会话工作区根过滤（与 /rewind list
    // 列点同判据——聚焦空悬/行缺席回退启动会话根）；件缺席 = 该活体位诚实
    // 缺席。/plugins 尾参位的 pluginReport 经 assembly 装配根 provide 的
    // 'plugin-load-report' 服务面取值（命令面增补批 C2 前段 deferred 兑现——
    // LoadReport 真源 = bootPlugins 回执闭包，/reload 换代即新代投影）；
    // 装配序保序（本件后于 assembleHostStack 执行）在场恒真，tryGet 缺席 =
    // 防御位诚实归静态面。
    const checkpointStore = scope.tryGet<{ readonly store: CheckpointStore }>('checkpoint')?.store;
    const pluginLoadReport = scope.tryGet<{
      readonly report: () =>
        | {
            readonly activated: readonly { readonly id: string }[];
            readonly skipped: readonly { readonly id: string }[];
          }
        | undefined;
    }>('plugin-load-report');
    const liveCompletionDeps: LiveCompletionDeps = {
      ...(checkpointStore !== undefined
        ? {
            rewindManifests: async (): Promise<readonly { readonly id: string }[]> => {
              const focused = stack.channels.focusedId;
              const root =
                focused === null
                  ? session.workspaceRoot
                  : canonicalWorkspaceRoot(
                      runtime.persistence.store.getSessionRow(focused)?.workspaceRoot ?? session.workspaceRoot,
                    );
              const manifests = await checkpointStore.listManifests();
              return manifests.filter((manifest) => manifest.workspaceRoot === root);
            },
          }
        : {}),
      // /plugins 尾参位活体源（activated ∪ skipped——failed 不入可操作面；
      // 结构子集形直赋——取值器每查询现取，与 rewind 位同族）
      ...(pluginLoadReport !== undefined ? { pluginReport: () => pluginLoadReport.report() } : {}),
    };
    // —— TUI 主题档装配（批 10g——07 §4.1 R2 主题载体条 / 04 §9 ⑥ 注记）：
    // settings.json `theme` 键（dark/light/auto）经 TuiBackendOptions.theme
    // 下装；缺席 = auto（OSC 11 背景探测 + 明暗变化通知——后端内执法）。
    // assembly 装配段已读 settings 策略两键（gaps 填充）但不出面——本件重读
    // （读侧幂等廉价；AssemblySuccess 不为单键扩面）。色域探测材料 = env 面
    // COLORTERM/TERM 两键投影（缺省 process.env——测试注入面同源）。
    const themeLoad =
      runtime.dataDir !== null ? readHostSettings(runtime.dataDir, { warn: (m) => logger.warn(m) }) : null;
    const env = options.env ?? process.env;
    // —— 自定义主题启动下装（/themes 批——07 §4.1 R2 挂账解挂批）：theme 值
    // 域经 settings 校验 = 三内置或合法自定义名；自定义名 = themes/<名>.json
    // 覆盖表现载（载入 null〔坏文件/缺席〕= 回退 auto 探测档——坏文件 warn 已
    // 落 logger，诚实降级不炸启动）；内置三值/缺席 = 无覆盖直落。
    const themeSetting = themeLoad?.settings.theme ?? 'auto';
    const isCustomTheme = themeSetting !== 'dark' && themeSetting !== 'light' && themeSetting !== 'auto';
    const customThemeOverlay =
      isCustomTheme && runtime.dataDir !== null
        ? loadCustomThemeColors(runtime.dataDir, themeSetting, { warn: (m) => logger.warn(m) })
        : null;
    // 坏自定义文件回退档（auto）——backend 下装位单值消费
    const startupThemeSetting = isCustomTheme && customThemeOverlay === null ? 'auto' : themeSetting;

    // —— TUI 本地命令族（07 §4.1 命令面增补批——/status /debug /skills 副屏
    // 三件）：副屏/瞬时交互族 = UiBackend 实装层本地拦截（/exit 批先例——恰
    // 零参命中 run() 终局、带参形用法 fail-loud、不进通道核命令表：webui
    // 零污染）。一切边外面（skills registry / settings 读面 / daemon.log /
    // 插件清单）经本装配根注入到达——run 闭包开面板时现取（新鲜数据快照
    // 档；副屏占用时 open* false → notify 诚实降级，与 /help 同律）。闭包
    // 捕获构造后 backend 柄——仅输入期触发无 TDZ（onSubmit 同先例）。
    const openStatusPanel = (): void => {
      // 聚焦会话（空悬回退启动会话）——短 id / cwd 短名 / 轮次行数据源
      const sid = stack.channels.focusedId ?? session.sessionId;
      const row = runtime.persistence.store.getSessionRow(sid);
      const root = canonicalWorkspaceRoot(row?.workspaceRoot ?? session.workspaceRoot);
      const driver = stack.driverOf(sid);
      const turns = driver === undefined ? 0 : foldSessionUsage(driver.session.events()).turns;
      // 模型全集计数——ctrl+p 模型循环同数据源（providers × models 装配序）
      let modelCount = 0;
      for (const provider of stack.llmRuntime.models.getProviders()) {
        modelCount += provider.getModels().length;
      }
      // env 白名单三键（04 §7 白名单制——凭证与 token 恒不入面；空串同未设）
      const envValue = (key: string): string | null => {
        const value = env[key];
        return value !== undefined && value !== '' ? value : null;
      };
      if (
        !backend.openStatus({
          version: options.version ?? '0.0.0',
          model: stack.model,
          modelCount,
          sessionId: sid,
          cwdLabel: basename(root),
          turns,
          dataDir: runtime.dataDir,
          theme: backend.themeChoice,
          env: [
            { key: 'BERRY_AGENT_MODEL', value: envValue('BERRY_AGENT_MODEL') },
            { key: 'BERRY_AGENT_DATA_DIR', value: envValue('BERRY_AGENT_DATA_DIR') },
            { key: 'BERRY_AGENT_LOG_LEVEL', value: envValue('BERRY_AGENT_LOG_LEVEL') },
          ],
        })
      ) {
        backend.notify('状态面暂不可用（副屏占用中——退出当前副屏后重试）', { level: 'warn' });
      }
    };

    const openDebugPanel = (): void => {
      const dataDir = runtime.dataDir;
      // daemon.log 尾行快照——帽 50 行、开屏一次只读（活体跟随挂账——/history
      // 快照档同律）；:memory: 无数据目录 = 路径缺席，文件不在 = 快照缺席
      const logPath = dataDir !== null ? daemonPaths(dataDir).logPath : null;
      let tail: readonly string[] | null = null;
      if (logPath !== null) {
        try {
          const lines = readFileSync(logPath, 'utf8').split('\n');
          if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop(); // 尾换行伪行去一
          tail = lines.slice(-50);
        } catch {
          tail = null; // 读失败（文件未生成/权限）——同缺席形诚实呈现
        }
      }
      // settings 解析态——开面板时收集 warn sink 重读（读侧幂等廉价；坏值/
      // 拒载与键位拒载在此集中面呈现，不搅装配期 logger 流）
      const settingsWarns: string[] = [];
      const settingsLoad = dataDir !== null ? readHostSettings(dataDir, { warn: (m) => settingsWarns.push(m) }) : null;
      if (
        !backend.openDebug({
          daemonLogPath: logPath,
          daemonLogTail: tail,
          logLevel:
            env.BERRY_AGENT_LOG_LEVEL !== undefined && env.BERRY_AGENT_LOG_LEVEL !== ''
              ? env.BERRY_AGENT_LOG_LEVEL
              : options.flags.debug === true
                ? 'debug（--debug 旗标）'
                : 'info（缺省）',
          settingsKeys: settingsLoad !== null ? Object.keys(settingsLoad.settings) : [],
          settingsWarnings: [
            ...settingsWarns,
            ...backend.keybindingRejections.map((rejection) => `键位覆盖未生效：${rejection.detail}`),
          ],
          sqlitePath: runtime.persistence.store.dbPath,
          pluginIds: boot.report.activated.map((activated) => activated.id),
        })
      ) {
        backend.notify('调试面暂不可用（副屏占用中——退出当前副屏后重试）', { level: 'warn' });
      }
    };

    const openSkillsPanel = (): void => {
      // skills 服务面（core:skills provide 'skills'）——件缺席 = 诚实拒不开屏
      const registry = scope.tryGet<SkillsRegistry>('skills');
      if (registry === undefined) {
        backend.notify('skills 件未装载——无技能清单', { level: 'warn' });
        return;
      }
      const skills = registry.list(); // 快照原样（含隐藏件——面板标记呈现；first-wins 胜者序）
      if (
        !backend.openSkills(
          skills.map((skill) => ({
            name: skill.name,
            description: skill.description,
            layer: skill.providerId,
            hidden: skill.disableModelInvocation,
          })),
          // 回填调用形单源（formatSkillInvocation——本批首个生产消费位）；回填
          // 不执行——文本入输入框，提交与否归用户
          (index) => formatSkillInvocation(skills[index]!),
        )
      ) {
        backend.notify('技能清单暂不可用（副屏占用中——退出当前副屏后重试）', { level: 'warn' });
      }
    };

    // —— 主题选定闭包（/themes 批——选定即换装 + 持久化单点）：三内置 = 直落
    // 档无覆盖；自定义名 = 现载覆盖表（null = 坏文件——warn 呈报保持既有档，
    // 坏文件拒载律）；换装走 backend.setThemeChoice 单入口（OSC 11 探测开闭
    // 编舞后端内执法）。持久化 = settings.json 只写 theme 键（写侧合并面保
    // 留未知键）；坏形期拒写 'rejected' = 换装照做 + 诚实呈报暂离（运行态不
    // 回滚——重启回落盘态）。
    const selectTheme = (name: string): void => {
      if (name === 'dark' || name === 'light' || name === 'auto') {
        backend.setThemeChoice(name, null);
      } else {
        const overlay =
          runtime.dataDir !== null
            ? loadCustomThemeColors(runtime.dataDir, name, { warn: (m) => logger.warn(m) })
            : null;
        if (overlay === null) {
          backend.notify(`主题 ${name} 载入失败——保持既有档（详见日志）`, { level: 'warn' });
          return;
        }
        backend.setThemeChoice(name, overlay);
      }
      if (runtime.dataDir !== null && writeHostSettings(runtime.dataDir, { theme: name }) === 'rejected') {
        backend.notify('主题已换装但持久化失败（settings.json 坏形——手改修复后可再写）', { level: 'warn' });
      }
    };

    const openThemesPanel = (): void => {
      // 条目 = 内置三档在前 + themes/ 目录清单字典序（装配拼接律——面板原样
      // 呈现）；自定义条目现探坏文件标 ⚠（静默探测——选定路的 warn 呈报另在
      // selectTheme）。当前档 = backend 活值（选定即时更新——观测位单源）。
      const dataDir = runtime.dataDir;
      const entries = [
        { name: 'auto', detail: '跟随终端明暗（OSC 11 探测）', broken: false },
        { name: 'dark', detail: '内置暗色', broken: false },
        { name: 'light', detail: '内置亮色', broken: false },
        ...(dataDir !== null
          ? listCustomThemeNames(dataDir).map((name) => ({
              name,
              detail: '自定义（themes/<名>.json 键级覆盖）',
              broken: loadCustomThemeColors(dataDir, name, { warn: () => {} }) === null,
            }))
          : []),
      ];
      if (!backend.openThemes(entries, backend.themeChoice, selectTheme)) {
        backend.notify('主题面暂不可用（副屏占用中——退出当前副屏后重试）', { level: 'warn' });
      }
    };

    // —— 思考档位选定闭包（2026-09-17 会话档位切换面批 F1 /thinking）：append
    // 走 conversation 公开面单写者（宿主装配独占——不注册 ctx.get，插件结构
    // 性不可达）；回执 = setStatus「<档>（下一 run 起生效；档位是否生效随
    // 模型能力）」形（07 §4.1 该批批注）。目标会话 = 聚焦位（/sessions 切焦
    // 后随焦生效——openDiffPanel 同位律）。
    const selectThinking = (level: string): void => {
      const sid = stack.channels.focusedId ?? session.sessionId;
      const driver = stack.driverOf(sid);
      if (driver === undefined) {
        backend.notify('思考档位需要会话驱动在场（切焦后重试）', { level: 'warn' });
        return;
      }
      setSessionThinkingLevel(driver.session, level);
      // 回执单源（session-tier-copy——webui 桥 PUT 应答体同文消费）+ 通道核
      // 扇出（CR-TIER-3 裁决①两向对称——TUI 切档 webui SSE 观众同收；通道
      // 核扇出含 TuiBackend 自身，TUI 状态行照常更新，第九役 C2 自单通道
      // backend.setStatus 改道）
      stack.channels.setStatus(sid, thinkingLevelReceipt(level));
      // 批B：档位切换点刷新锚——footer 档位段即时收敛（回执保留：时限定语
      // 「下一 run 起」是回执独有信息，footer 段无此位——两载体各司其职）
      backend.refreshFooter();
    };

    const openThinkingPanel = (): void => {
      // 行集七档单源（THINKING_LEVELS——词序即面板行序；词表与 detail 在此
      // 拼纯数据行，picker 不 import conversation——DAG 边表 channels 不入
      // conversation）。当前档 = fold 现值 ?? 栈基线（undefined = 诚实无锚）
      // ；fold 坏词 fail-loud（run 起钉定位的炸）在开屏面收为错误回执——
      // 不让选择器开口即崩。
      const sid = stack.channels.focusedId ?? session.sessionId;
      const driver = stack.driverOf(sid);
      let current: string | undefined;
      if (driver !== undefined) {
        try {
          current = foldSessionThinkingLevel(driver.session.events()) ?? stack.thinkingLevel;
        } catch (err) {
          backend.notify(`思考档位读失败：${err instanceof Error ? err.message : String(err)}`, { level: 'error' });
          return;
        }
      } else {
        current = stack.thinkingLevel;
      }
      const entries = THINKING_LEVELS.map((level) => ({ level, detail: THINKING_LEVEL_DETAILS[level] }));
      if (!backend.openThinking(entries, current, selectThinking)) {
        backend.notify('思考档位面暂不可用（副屏占用中——退出当前副屏后重试）', { level: 'warn' });
      }
    };

    // —— 沙箱档位选定闭包（2026-09-17 会话档位切换面批 F2 /sandbox）：append
    // 走 conversation 公开面单写者 setSessionMode（宿主装配独占——不注册
    // ctx.get，插件结构性不可达；05 §1.1 单写者律）；回执 = setStatus「当前
    // 档 +（即刻生效于后续工具调用）」——与 thinking「下一 run 起」分拆两形
    // （07 §4.1 A4 勘正注：执法闭包 per 工具调用现取 fold 现值，在飞 run 内
    // 下一工具调用起生效——收紧向提前生效无害，回执与生效粒度一致）。目标
    // 会话 = 聚焦位（/sessions 切焦后随焦生效——selectThinking 同位律）。
    const selectSandbox = (mode: string): void => {
      const sid = stack.channels.focusedId ?? session.sessionId;
      const driver = stack.driverOf(sid);
      if (driver === undefined) {
        backend.notify('沙箱档位需要会话驱动在场（切焦后重试）', { level: 'warn' });
        return;
      }
      setSessionMode(driver.session, mode);
      // 回执单源 + 通道核扇出同 thinking 律（CR-TIER-3 两向对称——第九役 C2）
      stack.channels.setStatus(sid, sandboxModeReceipt(mode));
      // 批B：档位切换点刷新锚（selectThinking 同律——回执保留双载体各司其职）
      backend.refreshFooter();
    };

    const openSandboxPanel = (): void => {
      // 行集三档单源（SANDBOX_MODES——词序即面板行序；词表与 detail 在此拼
      // 纯数据行，picker 不 import safety——DAG 边表 channels 不入 safety）。
      // 当前档 = fold 现值（fallback 恒 boot 解析值 stack.sandboxMode——本面
      // 恒有锚，与 /thinking 的可无锚分立）；fold 坏词 fail-loud 在开屏面收
      // 为错误回执——不让选择器开口即崩（selectThinking 同律）。
      const sid = stack.channels.focusedId ?? session.sessionId;
      const driver = stack.driverOf(sid);
      let current: string;
      if (driver !== undefined) {
        try {
          current = foldSessionSandboxMode(driver.session.events(), stack.sandboxMode);
        } catch (err) {
          backend.notify(`沙箱档位读失败：${err instanceof Error ? err.message : String(err)}`, { level: 'error' });
          return;
        }
      } else {
        current = stack.sandboxMode;
      }
      const entries = SANDBOX_MODES.map((mode) => ({ mode, detail: SANDBOX_MODE_DETAILS[mode] }));
      if (!backend.openSandbox(entries, current, selectSandbox)) {
        backend.notify('沙箱档位面暂不可用（副屏占用中——退出当前副屏后重试）', { level: 'warn' });
      }
    };

    const openDiffPanel = (): void => {
      // 数据源 = 聚焦会话投影快照（开屏一次现取——快照档；ProjectedMessage
      // 结构兼容 DiffProjectionMessage 最小面，channels↛session 零新 DAG 边）
      const sid = stack.channels.focusedId ?? session.sessionId;
      const driver = stack.driverOf(sid);
      if (driver === undefined) {
        backend.notify('会话驱动不在场——无改动可聚合', { level: 'warn' });
        return;
      }
      if (!backend.openDiff(driver.session.projection())) {
        backend.notify('改动总览暂不可用（副屏占用中——退出当前副屏后重试）', { level: 'warn' });
      }
    };

    // —— /marketplace（03 §9.6 mp-5 TUI 选装面——本地拦截族第七件）：编舞全
    // 归 MarketplaceTuiFace（host 侧纯逻辑件——行集快照/四动作长编舞/busy 单槽
    // /双相 uninstall），本闭包只做装配与依赖注入。面实例进程内单例（模型
    // busy/results 跨开屏持久——enter 收屏后动作在飞，重开 /marketplace 可见
    // busy 行与结算回执）；装机面变更成功尾自动链 /reload（reloader.request
    // ——会话运行中自动排队，run 收场后执行）。
    let marketFace: MarketplaceTuiFace | null = null;
    const openMarketplacePanel = (): void => {
      if (marketFace === null) {
        marketFace = new MarketplaceTuiFace({
          dataDir: runtime.dataDir,
          fs: createMarketFs(),
          now: () => new Date(),
          // CLI 服务面单源直装（消费服务面零绕过——装机/卸载/换装/刷新八动词
          // 不在此重实现）；回执经 writeOut/writeErr 注入捕获（不经 stdout）。
          // dataDir null 形面 open 即诚实拒——runEntry 实际不可达，缺席形走
          // runMarketplaceEntry 内部缺省（env 梯子）防御位
          runEntry: (sub, capture) =>
            runMarketplaceEntry(sub, {
              ...(runtime.dataDir !== null ? { dataDir: runtime.dataDir } : {}),
              env: options.env ?? process.env,
              writeOut: capture.writeOut,
              writeErr: capture.writeErr,
            }),
          notify: (message, opts) => backend.notify(message, opts),
          // 双相第二相裁决：inspect 回执先呈主屏正文流（所见即所裁），再开
          // 三选浮层（首项 = 取消——保守位缺省；Esc/收层保守值 '' 同归取消）
          confirmUninstall: async (inspectText): Promise<UninstallChoice> => {
            for (const line of inspectText.split('\n')) {
              if (line.trim() !== '') backend.notify(line, { level: 'info' });
            }
            const answer = await backend.select('卸载裁决：数据目录处置', [
              { value: 'cancel', label: '取消（不动装机物与数据）' },
              { value: 'keep', label: '卸载并保留数据目录（--data keep 缺省形）' },
              { value: 'purge', label: '卸载并清数据目录（--data purge——不可逆）' },
            ]);
            return answer === '' ? 'cancel' : (answer as UninstallChoice);
          },
          requestReload: () => reloader.request(),
          repaint: () => backend.requestAltRepaint(),
          // 已装徽标判据 = 真账本 market 注记键集现读（`entry@market` 与条目
          // id 同形）；账本缺席/损坏 = 空集（无徽标呈现——动作寻址归服务面）
          ledgerMarketKeys: () => {
            if (runtime.dataDir === null) return new Set<string>();
            const ledger = readLedger(runtime.dataDir, createPluginStoreFs());
            if (!ledger.ok) return new Set<string>();
            return new Set(
              ledger.entries
                .filter((entry) => entry.market !== undefined)
                .map((entry) => `${entry.market!.entry}@${entry.market!.name}`),
            );
          },
          openPanel: (model, actions) => backend.openMarketplace(model, actions),
        });
      }
      // open 不抛（面内自吞）：异常形 = 源清单损坏等 discover 层拒——回执归
      // tail/results；此处 catch 仅防御位（保持 fire-and-forget 零 unhandled）
      void marketFace.open().catch((err: unknown) => {
        backend.notify(`市场选装面异常：${String(err)}`, { level: 'error' });
      });
    };

    // —— /new（07 §4.1 命令面增补批 C2——逐件语义 1）：同 cwd 建新会话即切焦。
    // cwd 真源 = 聚焦会话工作区根（行面现读；空悬/行缺席回退启动会话根——
    // 与 @ 补全锚/补开判据同律）；createSession 走 manager（零 I/O——行随首
    // 事件落库）；切焦 = registry.focus() 既有权威路（/sessions 选定同路——
    // 多会话信封分流/repaint 全链既有，本件零新编舞）。旧会话不动（/sessions
    // 可回切）。notify 一行回执（新会话短 id）。已知边界（非缺陷——库行真源
    // 律）：零事件新会话无库行、不在 /sessions 清单，footer 短 id 即其可见位。
    const startNewSession = (): void => {
      const sid = stack.channels.focusedId ?? session.sessionId;
      const row = runtime.persistence.store.getSessionRow(sid);
      const root = canonicalWorkspaceRoot(row?.workspaceRoot ?? session.workspaceRoot);
      const created = stack.manager.create({ workspaceRoot: root });
      stack.channels.registerSession(created.sessionId);
      // notify 必须排在 focus 落画之后：onRepaint 会作废全部 pendingOps（切焦
      // 权威重建「旧帧作废」——先 notify 的瞬时行会被随后 repaint 清队丢行），
      // 故链在 focus promise 尾——回执行随新焦 transcript 存活可见。focus 拒
      // 绝（投影真源故障 fail-loud）诚实呈报不吞。
      void stack.channels
        .focus(created.sessionId)
        .then(() =>
          backend.notify(`新会话：${shortIdOf(created.sessionId)}（旧会话不动——/sessions 可回切）`, {
            level: 'info',
          }),
        )
        .catch((err: unknown) => backend.notify(`新会话切焦失败：${String(err)}`, { level: 'error' }));
    };

    // —— /upgrade 薄壳（07 §8.5 第 2 条 + 第 6 条手动通道）：跑同一只读检查
    // （强制刷新缓存——恒走网络，不受 24h 节流辖）→ notify 呈报本地/远端版本
    // → 指引退出后执行 berry upgrade——**TUI 内不自动执行**（永不热换运行中
    // 进程）。失败诚实呈报（手动通道非启动腿——用户敲了命令，静默反欺）。
    // 检查腿经注入面（manualUpdateCheck——测试注桩零网络，缺省产线真身）；
    // registryFallback 注记单源在 upgrade.ts（CLI 腿同句——两腿同源律呈报位）。
    const manualCheck = options.manualUpdateCheck ?? runManualUpdateCheck;
    const runUpgradeShell = (): void => {
      if (runtime.dataDir === null) {
        backend.notify('版本检查不可用（数据目录缺席——:memory: 诊断形）', { level: 'warn' });
        return;
      }
      void manualCheck({
        dataDir: runtime.dataDir,
        currentVersion: options.version ?? '0.0.0',
        spawn: createDefaultSpawnRunner(),
        fs: createNodeUpdateCheckFs(),
        now: () => Date.now(),
      })
        .then((result) => {
          if (result.kind === 'ok') {
            // 白名单门先于判序（第十一役 D——与启动腿 upgrade.ts 同律）：非
            // semver latest 是坏应答不是「无更新」，cmp null 落「已是最新」
            // 是诚实谎；诚实拒走 warn 支
            if (!TARGET_RE.test(result.latest)) {
              backend.notify(`版本检查失败：远端 latest「${result.latest}」非 semver 形（registry 坏应答）`, {
                level: 'warn',
              });
              return;
            }
            const cmp = compareSemverFull(result.latest, options.version ?? '0.0.0');
            if (cmp !== null && cmp > 0) {
              backend.notify(
                `新版本 ${result.latest} 可用（本地 ${options.version ?? '0.0.0'}）——退出后执行 berry upgrade（TUI 内不自动执行）`,
                { level: 'info' },
              );
            } else {
              backend.notify(`已是最新：${options.version ?? '0.0.0'}（远端 latest ${result.latest}）`, {
                level: 'info',
              });
            }
            // registry 解析失败回退官方源注记（不静默吞——CLI 腿同句单源）
            if (result.registryFallback) {
              backend.notify(REGISTRY_FALLBACK_NOTE, { level: 'info' });
            }
          } else if (result.kind === 'not-found') {
            backend.notify('版本检查失败：registry 应答 404（包不在册——registry 指错或未发布态）', { level: 'warn' });
          } else {
            backend.notify(`版本检查失败：${result.message}——稍后再试或退出后执行 berry upgrade`, { level: 'warn' });
          }
        })
        .catch((err: unknown) => backend.notify(`版本检查异常：${String(err)}`, { level: 'error' }));
    };

    // —— /guide 常驻快速上手参考（07 §8.5 第 2 条）：版本 + 核心命令清单 +
    // 模型配置 + 文档地图 + 升级/卸载一句——段集文案单源在本闭包（面板收纯数据行），
    // 副屏占用时 notify 降级（openStatus 同律）。
    const openGuidePanel = (): void => {
      const ok = backend.openGuide({
        version: options.version ?? '0.0.0',
        sections: [
          {
            title: '快速上手',
            lines: [
              '直接说需求即对话（编码 / 问答 / 执行——能力随插件装载扩展）',
              '/help 命令与键位帮助 · /guide 本参考',
            ],
          },
          {
            // 模型配置段（2026-09-19 P0 静默链修复批——07 §8.5 第 2 条补段）：
            // 首跑未配凭证用户的产品级指路（报错要诚实之外的「错了知道怎么改」面）
            title: '模型配置',
            lines: [
              '对话需模型凭证：设置供应商生态变量（如 export ANTHROPIC_API_KEY=sk-… 或 OPENAI_API_KEY）',
              '更换缺省模型设 BERRY_AGENT_MODEL=provider/model-id——详见 docs/usage.md「模型配置」节',
            ],
          },
          {
            title: '核心命令',
            lines: [
              '/sessions 切会话 · /new 新建会话 · /usage 会话用量',
              '/status 状态汇总 · /themes 主题 · /marketplace 插件市场',
              '/upgrade 检查更新 · /exit 退出（Ctrl+D 同路）',
            ],
          },
          {
            title: '文档地图',
            lines: [
              'docs/usage.md 用法全册 · docs/architecture.md 架构',
              'docs/plugin-development.md 插件开发 · docs/operations.md 运维 · docs/development.md 参与开发',
            ],
          },
          {
            title: '升级与卸载',
            lines: [
              '升级：退出后执行 berry upgrade（或 npm i -g berry-agent）——升级不热替换，重启生效',
              '卸载：npm rm -g berry-agent + 清理数据目录 ~/.berry-agent（先导出记忆）',
            ],
          },
        ],
      });
      if (!ok) {
        backend.notify('引导面暂不可用（副屏占用中——退出当前副屏后重试）', { level: 'warn' });
      }
    };

    // 本地命令族单源（拦截表 / 补全源 / /help 命令册三消费面同文）
    const localCommands = [
      {
        name: 'new',
        description: '新建会话并切焦（同 cwd——旧会话不动，/sessions 可回切）',
        run: () => startNewSession(),
      },
      { name: 'status', description: '状态汇总副屏（版本/模型/会话/环境旋钮）', run: () => openStatusPanel() },
      { name: 'debug', description: '调试信息副屏（日志尾快照/生效配置/插件清单）', run: () => openDebugPanel() },
      { name: 'skills', description: '技能清单副屏（enter 回填调用形入输入框）', run: () => openSkillsPanel() },
      { name: 'themes', description: '主题切换副屏（选定即换装+持久化）', run: () => openThemesPanel() },
      {
        name: 'thinking',
        description: '思考档位副屏（七档选定——下一 run 起生效，随模型能力）',
        run: () => openThinkingPanel(),
      },
      {
        name: 'sandbox',
        description: '沙箱档位副屏（三档选定——即刻生效于后续工具调用，切会话各档独立）',
        run: () => openSandboxPanel(),
      },
      { name: 'diff', description: '会话改动总览副屏（edit 聚合按文件分组）', run: () => openDiffPanel() },
      {
        name: 'marketplace',
        description: '插件市场选装副屏（enter 选装/卸载 · u 换装 · r 刷新）',
        run: () => openMarketplacePanel(),
      },
      {
        name: 'upgrade',
        description: '检查更新（本地/远端版本——退出后执行 berry upgrade）',
        run: () => runUpgradeShell(),
      },
      {
        name: 'guide',
        description: '快速上手参考副屏（版本/模型配置/核心命令/文档地图/升级与卸载）',
        run: () => openGuidePanel(),
      },
    ] as const;
    /** 本地命令族 → 补全条目（query 已去斜杠——与 exitCommandItems 同契约） */
    const localCommandItems = (query: string): readonly AutocompleteItem[] =>
      fuzzyFilter(localCommands, (command) => command.name, query).map((command) => ({
        label: `/${command.name}`,
        detail: command.description,
        replacement: `/${command.name}`,
      }));

    const backend = new TuiBackend(io, {
      sessionId: session.sessionId,
      onSubmit: (sessionId, text, opts) => {
        // /sessions 切焦补开（R7 批 10k）：切焦 repaint 只投影不开驱动，选定
        // 旧会话直接提交前补开（manager.open 幂等——existing 返既有 driver；
        // open 失败 = 行面已失理论不达防御位，弃单与 submitText 未开形同律）
        if (stack.driverOf(sessionId) === undefined) {
          try {
            stack.manager.open(sessionId);
          } catch {
            return;
          }
        }
        // 候跑排队回执（挂账解挂批 2026-09-15——alt+enter 形）：busy 期排队才
        // 上屏一行；busy 判据必须先于 submitText 读——idle 提交即起 run，
        // 提交后再读恒真（首条误报排队）。notify 走 backend 直投（closure 捕
        // 获构造后柄——仅输入期触发无 TDZ）
        if (opts?.queueFollowUp === true && (stack.driverOf(sessionId)?.running ?? false)) {
          backend.notify('已排队候跑（当前 run 终态后自动起跑）', { level: 'info' });
        }
        // 候跑标记透传（SubmitOptions.queueFollowUp——04 §4）：普通形不带 opts
        // 保持旧调用形（undefined 与 {} 对驱动同义，零扰动）
        const run =
          opts?.queueFollowUp === true
            ? stack.submitText(sessionId, text, { queueFollowUp: true })
            : stack.submitText(sessionId, text); // fire-and-forget——回执经信封回流
        // 全域清扫 G1-#1 提交 run 结算锚：settled promise 在桥接落账
        // （noteRunSettled → bridgeUsageLedger 推进全道缓存）之后 resolve——
        // promise 回调序结构性保证本刷新读到含本 run 的今日值（agent_end 信封
        // 同步扇出早于落账微任务——该锚滞后一 run，07 件 3 G1 勘正注）；failed
        // 路同刷（结算链两分支均走桥接）。候跑形回执搭候跑种子批的新 run 结算
        // （seedQueuedFollowUps 返回新 run 的 settled promise）——同锚覆盖。
        void run?.then(
          () => backend.refreshFooter(),
          () => backend.refreshFooter(),
        );
      },
      onInterrupt: (sessionId) => stack.interrupt(sessionId),
      // 模型循环柄（挂账解挂批 2026-09-15——ctrl+p 层③.5 应用动作路）：循环
      // 宇宙 = providers 装配序 × provider 内 model 序的 `provider/model` 串全列
      // （07 §4.1 R5）；换档走栈级旋钮（内存态不落盘——重启回落装配基线），
      // 消费 = 下一 run 起跑现取（在飞 run 不中途换）。回执 notify 一行 +
      // footer 模型段活写；空目录零动作（无候选可换——诚实缺席）
      onModelCycle: () => {
        const specs: string[] = [];
        for (const provider of stack.llmRuntime.models.getProviders()) {
          for (const model of provider.getModels()) specs.push(`${provider.id}/${model.id}`);
        }
        if (specs.length === 0) return;
        const index = specs.indexOf(stack.model);
        const next = specs[(index + 1) % specs.length]!; // 不在册（-1+1=0）→ 装配序首位
        stack.setModel(next);
        backend.notify(`模型已切换：${next}（下一 run 起跑生效）`, { level: 'info' });
        backend.setFooterModel(modelShortName(next));
      },
      onQuit: () => quitResolve(),
      // 命令执行窗自动锚（ix-2——07 §4.3 档位 2）：发起会话 = 聚焦会话
      //（兜底启动会话——焦点空悬时命令仍属 TUI 主会话）；ALS 语境继承语义
      //——命令 handler 及其 fire-and-forget 尾链零自觉锚定（显式 opts
      // .sessionId 优先）。sessionId 实参同笔透传（CommandArgs 显式位）。
      dispatchCommand: (input: string) => {
        const sid = stack.channels.focusedId ?? session.sessionId;
        return runWithSessionAnchor(sid, () => stack.channels.dispatchCommand(input, sid));
      },
      // TUI 本地命令族（07 §4.1 命令面增补批——本地拦截三词注入）
      localCommands,
      todoFor: (sessionId) => {
        const driver = stack.driverOf(sessionId);
        return driver === undefined ? null : foldTodoTable(driver.session.events());
      },
      autocomplete: {
        // 通道核命令表 + TUI 本地命令族 + TUI 本地退出词三源并流（07 §4.1
        // 2026-09-15 /exit 批定形注 + 命令面增补批扩编——本地族与退出词均不
        // 进通道命令表，补全源在此并入）
        commands: (query) => [
          ...commandItems(stack.channels.listCommands(), query),
          ...localCommandItems(query),
          ...exitCommandItems(query),
        ],
        // 参数段源（R6 批 10j 装配接线）：活体位先行（挂账解挂批 2026-09-15
        // ——plugins id / rewind id 两尾参位），null = 位外/依赖缺席归静态面
        // （四命令子动词首参 + 深位枚举——原行为零扰动）
        commandArguments: (command, query, priorArgs) => {
          // —— /export 首参位活体值（07 §4.1 命令面增补批 C2 逐件语义 7——
          // id 尾参补全挂接活体值源，挂账解挂批 R6 活体值条款同法）：会话 id
          // 清单 = manager 全量行（/sessions 清单注入同一读面——库行真源；
          // 零事件新会话无行不补——与 /sessions 清单同边界）。位裁留在本装配
          // 闭包不进 live-completions 件（件域两活体位 plugins/rewind 之外的
          // 本批注记位——消费面与 R6 两活体位同一 commandArguments 合流）。
          // label 短形 + replacement 全 id 尾空格（/rewind 位同律——label 才
          // 是截形，replacement 吃全 id）。
          if (command === 'export' && priorArgs.length === 0) {
            const sessionRows = stack.manager.list({});
            return fuzzyFilter(sessionRows, (row) => row.id, query).map((row) => {
              // detail = 展示题读路合并单源（05 §9 v13 分家③——显式题优先/
              // 首问快照兜底；合并值空串/缺席不造行）
              const displayTitle = sessionDisplayTitleOf(row);
              return {
                label: row.id.length > 8 ? `${row.id.slice(0, 8)}…` : row.id,
                ...(displayTitle !== undefined && displayTitle !== '' ? { detail: displayTitle } : {}),
                replacement: `${row.id} `,
              };
            });
          }
          const live = liveCommandArgumentItems(command, query, priorArgs, liveCompletionDeps);
          if (live !== null) return live;
          return commandArgumentItems(command, query, priorArgs);
        },
        mentions: (query) => mentionSourceFor().get(query),
      },
      // 高度帽公式单源（07 §4.1 R3 批 10j）：max(5, rows×0.3)——迟滞带归视图
      maxVisibleLines: editorHeightCap(rows),
      // 主题档（批 10g + /themes 批）：settings 缺席 = auto 探测路；自定义名 =
      // 覆盖表随装（坏文件已回退 auto——见 startupThemeSetting；色域档由 env
      // 两键裁定）
      theme: startupThemeSetting,
      ...(customThemeOverlay !== null ? { customThemeOverlay } : {}),
      colorEnv: { COLORTERM: env.COLORTERM, TERM: env.TERM },
      // 键位用户覆盖（R5 批 10k）：settings.json keybindings 键——形校验在读
      // 侧、语义校验归 Keymap fail-loud（拒载清单 start 后逐条呈报，见下）
      ...(themeLoad !== null && themeLoad.settings.keybindings !== undefined
        ? { keybindings: themeLoad.settings.keybindings }
        : {}),
      // footer 常驻段（R6 批 10k）：cwd 短名 + 模型短名（provider/model 形取
      // model 段）——会话短 id 段由 backend 每帧随 sessionId 现拼；
      // cwdPath（挂账解挂批②）：cwd 段 git 短支名后缀数据位（启动会话
      // workspaceRoot——backend 构造期定值直读 .git/HEAD）；
      // tiers/todaySpent（三反馈批B）：档位段/今日段 pull 闭包——每刷新锚
      // 现拉（档位 = 聚焦会话 fold 现值 ?? 栈基线，与 openThinkingPanel/
      // openSandboxPanel 同律：thinking 可无锚诚实缩位、sandbox 恒有锚；
      // 今日 = 全道聚合读面 allLanesSpentToday——呈现口径与闸门口径分立）
      footer: {
        cwdLabel: basename(session.workspaceRoot),
        modelLabel: modelShortName(stack.model),
        cwdPath: session.workspaceRoot,
        tiers: () => {
          const sid = stack.channels.focusedId ?? session.sessionId;
          const driver = stack.driverOf(sid);
          try {
            const thinking =
              driver !== undefined
                ? (foldSessionThinkingLevel(driver.session.events()) ?? stack.thinkingLevel)
                : stack.thinkingLevel;
            const sandbox =
              driver !== undefined
                ? foldSessionSandboxMode(driver.session.events(), stack.sandboxMode)
                : stack.sandboxMode;
            return {
              thinking: thinking !== undefined ? (THINKING_LEVEL_SHORT[thinking] ?? null) : null,
              sandbox: SANDBOX_MODE_SHORT[sandbox] ?? null,
            };
          } catch {
            return { thinking: null, sandbox: null }; // fail-open 缩位（backend 兜底同律——双保）
          }
        },
        todaySpent: () => stack.llm.allLanesSpentToday(),
      },
      ...(options.version !== undefined ? { version: options.version } : {}),
      // 生产定时器注入（保活/帧帽真定时——缺省同步直出仅测试语义）
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancelSchedule: (handle) => clearTimeout(handle as NodeJS.Timeout),
    });

    // 出屏复原进退出序 closer——quit 路径与信号路径（onGraceful→shutdown）同享
    runtime.registerCloser({ label: 'tui-backend', fn: () => backend.stop() });

    // —— 全道结算总线呈现订阅（04 §5 定形注——TUI 全域清扫 #1-full/#2 残窗）：
    // 后台道跨入口（scheduler/webui/issue）run 结算桥接与 complete 单发落账
    // 即通知——footer「今日」段即时刷新（通知时点后于缓存推进，现拉必含本
    // 笔）。提交路 settled promise 锚（onSubmit run?.then 刷新）仍盖本入口
    // run——两锚叠加幂等刷新（refreshFooter 无害）；跨午夜日键翻转不在射程
    // （07 §4.1 G1 ④有界陈旧律——下次刷新锚自愈）。
    stack.onSpentTodayLedgered(() => backend.refreshFooter());

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

    // —— 键位覆盖拒载呈报（R5 批 10k——Keymap fail-loud 装配位）：settings
    // 坏覆盖逐条 warn（不炸启动——坏项忽略、好项照常生效；首画后落屏可见）
    for (const rejection of backend.keybindingRejections) {
      backend.notify(`键位覆盖未生效：${rejection.detail}`, { level: 'warn' });
    }

    // —— /help 命令注册（R7 批 10k——host 装配侧直挂）：命令册三源合流 =
    // 通道核命令表 + TUI 本地命令族 + TUI 本地退出词（三源与补全源同面，
    // 本地族文案单源 localCommands、退出词文案单源 EXIT_DESCRIPTIONS）；键位
    // 册 = backend Keymap 投影（openHelp 内取）。副屏占用时 openHelp false
    // → notify 诚实降级（服务端 handler 同律）
    stack.channels.registerCommand(
      'help',
      async () => {
        const entries = [
          ...stack.channels.listCommands().map((spec) => ({
            name: spec.name,
            ...(spec.description !== undefined ? { description: spec.description } : {}),
          })),
          ...localCommands.map(({ name, description }) => ({ name, description })),
          ...EXIT_WORDS.map((name) => ({ name, description: EXIT_DESCRIPTIONS[name] })),
        ];
        if (!backend.openHelp(entries)) {
          backend.notify('帮助面暂不可用（副屏占用中——退出当前副屏后重试）', { level: 'warn' });
        }
      },
      '命令与键位帮助（命令册 + 键位册双源）',
    );

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

    // —— 启动版本检查（07 §8.5 第 6 条——2026-09-19 启动版本检查批）：TUI
    // 交互启动异步后台一次——boot 完成（主循环起跑前）fire，不阻塞启动面；
    // 有新版且该版未提示过 → notify 一行 + 落 notifiedVersion（按版本去重）；
    // 其余一切结局**零提示零噪音**（失败静默律——更新检查自身永不打扰）。
    // env BERRY_AGENT_SKIP_UPDATE_CHECK 置值即零网络；:memory: 诊断形（数据
    // 目录缺席）无处落账——跳过。headless 形不达此位（装配位零调用）。
    // 注入面（贴 dispatchServe runners 先例）：缺省与产线接线逐字同形——测试
    // 注桩零网络，行为零变更；env 关断键由编排器自身消费（skipped 早退）。
    const startupCheck = options.startupUpdateCheck ?? runStartupUpdateCheck;
    if (runtime.dataDir !== null) {
      void startupCheck({
        dataDir: runtime.dataDir,
        currentVersion: options.version ?? '0.0.0',
        spawn: createDefaultSpawnRunner(),
        fs: createNodeUpdateCheckFs(),
        now: () => Date.now(),
        env,
      })
        .then((decision) => {
          if (
            (decision.kind === 'checked' || decision.kind === 'cache-fresh') &&
            decision.hasUpdate &&
            !decision.alreadyNotified
          ) {
            recordNotifiedVersion(createNodeUpdateCheckFs(), runtime.dataDir as string, decision.latest, Date.now());
            // 提示形完整句（§8.5 第 6 条：notify 一行 + 指引退出后执行——
            // 用户不看 /upgrade 也知道下一步动作）
            backend.notify(`新版本 ${decision.latest} 可用——/upgrade 查看详情；退出后执行 berry upgrade`, {
              level: 'info',
            });
          }
        })
        .catch(() => {
          /* 失败静默律（防御位——编排器自身已内吞网络错，此处只防意外形） */
        });
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

/** 命令表 → 补全条目（fuzzy 子序列过滤——query 已去斜杠，前缀命中置顶；R6 批 10j） */
function commandItems(
  specs: readonly { name: string; description?: string }[],
  query: string,
): readonly AutocompleteItem[] {
  return fuzzyFilter(specs, (spec) => spec.name, query).map((spec) => ({
    label: `/${spec.name}`,
    ...(spec.description !== undefined ? { detail: spec.description } : {}),
    replacement: `/${spec.name}`,
  }));
}

/** TUI 本地退出词表（07 §4.1 /exit 批——单正名；/quit 别名已随 2026-09-21 三反馈批A 退役） */
const EXIT_WORDS = ['exit'] as const;

/** 退出词说明（单源——补全条目与 /help 命令册两消费面同文） */
const EXIT_DESCRIPTIONS: Readonly<Record<(typeof EXIT_WORDS)[number], string>> = {
  exit: '退出 TUI（与 Ctrl+D 同路优雅退出）',
};

/**
 * 退出词 → 补全条目（与通道命令表分源——前端生命周期词不进通道核命令表，
 * 装配位并流；query 已去斜杠，同 commandItems 契约）。
 */
export function exitCommandItems(query: string): readonly AutocompleteItem[] {
  return fuzzyFilter(EXIT_WORDS, (name) => name, query).map((name) => ({
    label: `/${name}`,
    detail: EXIT_DESCRIPTIONS[name],
    replacement: `/${name}`,
  }));
}

/** 模型短名（footer 常驻段呈现——provider/model 形取 model 段，裸名原样） */
function modelShortName(model: string): string {
  const slash = model.lastIndexOf('/');
  return slash === -1 ? model : model.slice(slash + 1);
}

/* ---------------- 命令参数补全源（R6 批 10j 装配接线） ---------------- */

/** 带参补全的四命令子动词名集（单源 = 各命令件 SUBVERBS 导出） */
const SUBVERBS_BY_COMMAND: Readonly<Record<string, readonly string[]>> = {
  approval: APPROVAL_SUBVERBS,
  plugins: PLUGINS_SUBVERBS,
  doors: DOORS_SUBVERBS,
  rewind: REWIND_SUBVERBS,
};

/**
 * 子动词元数据（键 = 「命令 动词」；值 = [说明, 是否带尾参]——带参者补全
 * replacement 尾随空格，应用后直接进下一 token 位）。名集单源在各命令件，
 * 说明位与名集同文件可目检同步。
 */
const VERB_META: Readonly<Record<string, readonly [string, boolean]>> = {
  'approval status': ['当前态：sandbox 档 + 审批 policy + 预设一览', false],
  'approval entries': ['策略表全列（活体现读）', false],
  'approval explain': ['真裁决干跑（须带 <tool>）', true],
  'approval preset': ['预设写盘（conservative|balanced|open）', true],
  'plugins list': ['装载态清单三分区', false],
  'plugins mount': ['挂载已装机插件 <id>', true],
  'plugins unmount': ['卸下（装机保留）<id>', true],
  'plugins toggle': ['禁用态翻转 <id>', true],
  'plugins config': ['配置表单 <id>', true],
  'doors list': ['高危面全清单 + 当前开态', false],
  'doors open': ['开门 <capability>', true],
  'doors close': ['关门 <capability>', true],
  'rewind list': ['列当前工作区回退点', false],
  'rewind preview': ['预演（零改动）<id>', true],
  'rewind restore': ['回退并 fork 新会话 <id>', true],
  'rewind help': ['用法说明', false],
};

/**
 * 命令参数源（R6 批 10j）——**静态面**：四命令子动词首参 + 深位枚举
 * （approval preset 预设名 / doors open·close 能力名——枚举单源 = safety
 * 预设表与 contracts 面目录）。插件 id、回退点 id 活体位归
 * {@link liveCommandArgumentItems}（挂账解挂批 2026-09-15 落地——装配位
 * 两源并流：活体先行、null 回退本静态面）。query = 当前 token 原文、
 * priorArgs = 已定参数序。
 */
export function commandArgumentItems(
  command: string,
  query: string,
  priorArgs: readonly string[],
): readonly AutocompleteItem[] {
  // 深位枚举：approval preset <名>——预设三档（名与描述 = safety 单源）
  if (command === 'approval' && priorArgs.length === 1 && priorArgs[0] === 'preset') {
    return fuzzyFilter(APPROVAL_PRESETS, (preset) => preset.name, query).map((preset) => ({
      label: preset.name,
      detail: preset.description,
      replacement: `${preset.name} `,
    }));
  }
  // 深位枚举：doors open|close <capability>——可授能力名（contracts 面目录派生）
  if (command === 'doors' && priorArgs.length === 1 && (priorArgs[0] === 'open' || priorArgs[0] === 'close')) {
    return fuzzyFilter(USER_GRANTABLE_CAPABILITIES, (name) => name, query).map((name) => ({
      label: name,
      replacement: `${name} `,
    }));
  }
  // 首参子动词（非首参位不补——活体值不在静态面）
  const verbs = SUBVERBS_BY_COMMAND[command];
  if (verbs === undefined || priorArgs.length > 0) return [];
  return fuzzyFilter(verbs, (verb) => verb, query).map((verb) => {
    // 元数据缺席兜底：零说明 + 尾空格（带参安全缺省）
    const [detail, takesArg] = VERB_META[`${command} ${verb}`] ?? ['', true];
    return {
      label: verb,
      ...(detail !== '' ? { detail } : {}),
      replacement: takesArg ? `${verb} ` : verb,
    };
  });
}
