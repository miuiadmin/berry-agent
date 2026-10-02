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
 * 基线/生产定时器/主题档）→ 启动引导面板（ob-2——凭证态 unconfigured 才
 * 进，cooked 窗一次性质询）→ addBackend → start → registerSession → focus 首画 →
 * setup 决策兑现（/setup 向导——ob-3，与命令行同一本体）→
 * 主循环 await 退出 → runtime.shutdown 六步退出序（closer 内含 backend.stop
 * 出屏复原）。
 *
 * 退出码：0 = ctrl+d 空框优雅退出；1 = 运行时组装失败（单活跃机拒入/开库
 * 失败——干净退出不写 crash.log，非崩溃）、启用清单损坏（同干净退出档）、
 * --port 开面失败（EADDRINUSE 等预期内环境态——同干净退出档，run-entry
 * :437 同律）或运行期异常（先 writeCrashLog 再退）。
 * 信号路径独立：SIGINT①/SIGTERM → onGraceful → runtime.shutdown → exit(0)
 * （main.ts 编舞；本件 closer 注册保证出屏复原在该路径同样执行）。
 */
import { basename, join } from 'node:path';
import { closeSync, fstatSync, mkdirSync, openSync, readSync, writeFileSync } from 'node:fs';

import {
  BootAnimation,
  editorHeightCap,
  FileMentionSource,
  foldErrorText,
  fuzzyFilter,
  listCustomThemeNames,
  loadCustomThemeColors,
  normalizeOnboardingKey,
  ProcessTerminalIO,
  runOnboardingPanel,
  TuiBackend,
} from '../channels/index.js';
import type { AutocompleteItem, TerminalIO } from '../channels/index.js';
import { readGitHead } from '../channels/index.js';
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
import { formatSkillInvocation, type SkillsRegistry } from '../skills/index.js';
import type { Provider } from '../llm/index.js';
import { SANDBOX_MODES, type SandboxMode } from '../safety/index.js';
import type { CheckpointStore } from '../checkpoint/index.js';
import type { JobEntry } from '../contracts/index.js';

import type { TuiFlags } from './cli.js';
import { assembleHostStack } from './assembly.js';
import type { AssemblySuccess } from './assembly.js';
import { startSchedulerClock } from './core-plugins.js';
import type { GoalFace } from './core-plugins.js';
import type { CorePluginReference } from './loader.js';
import { runWithSessionAnchor } from './session-anchor.js';
import { liveCommandArgumentItems, type LiveCompletionDeps } from './live-completions.js';
import {
  commandArgumentItems,
  commandItems,
  EXIT_DESCRIPTIONS,
  EXIT_WORDS,
  exitCommandItems,
} from './static-completions.js';
import { readHostSettings, readRawCustomProviders, writeHostSettings } from './settings-store.js';
import { builtinProviderIds, createCustomChannelProvider, type CustomProviderDef } from '../llm/index.js';
import { fetchChannelModels } from './channel-models-fetch.js';
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
import { runMarketplaceEntry } from './marketplace-cmd.js';
import { MarketplaceTuiFace } from './marketplace-tui-face.js';
import type { UninstallChoice } from './marketplace-tui-face.js';
import {
  MODE_SHORT,
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
import { providerApiKeyEnvNames } from './conversation-stack.js';
import { runSetupWizard } from './setup-wizard.js';
import { runCredentialsCommand } from '../credentials/index.js';

/**
 * 档位文案与回执单源已迁 host/session-tier-copy.ts（2026-09-18 webui 档位面
 * 受理批——两装配面同源消费律：TUI picker 装配与 webui 桥共用 THINKING_LEVEL_
 * DETAILS / SANDBOX_MODE_DETAILS 两表与两回执拼装函数；07 §4.1 danger 档
 * 行说明位文案钉死句以规范面为唯一引证源）。
 */
/**
 * 静态补全源已迁 host/static-completions.ts（2026-09-23 host 编舞批——本件
 * 尾部原纯补全源块三函数〔commandItems / exitCommandItems /
 * commandArgumentItems〕+ 退出词表两枚 + modelShortName 整体外迁，与
 * live-completions.ts 活体值源对称分立；本件装配位经 import 消费——消费处
 * 零改动，EXIT_WORDS / EXIT_DESCRIPTIONS 供 /help 命令册同源并流）。
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
  /** 启动引导面板单键读注入面（onboarding ob-2——缺省产线真身 = 产线 io
   * raw 窗一键；注入 io 的既有测试与 CI 管道形不注入 = 面板缺席直进主屏
   * ——键源在场律防注入测试死锁；注入键序列 = 面板行为锁测试面） */
  readonly onboardingKey?: () => Promise<string>;
}

/** lone-ESC 判定窗时长（对齐主屏管线 DEFAULT_ESCAPE_WINDOW_MS = 30ms——
 * tui-backend.ts / engine.ts 两处模块私有不可导入〔通道公开面三名纪律〕，
 * 本地常量同值指源；主屏 lone-ESC 消歧同窗防线） */
const ONBOARDING_ESCAPE_WINDOW_MS = 30;

/**
 * 产线单键读真身（onboarding ob-2 面板装配位消费）：cooked 窗面板行写出后
 * raw 窗收一键（echo 关——键不入回显流），读后复先后验 raw 态（面板期恒
 * cooked 进 cooked 还——backend 起屏自会再进 raw）。原始字节经
 * normalizeOnboardingKey 归一（判据单源在面板件——转义序列不冒充 esc）。
 *
 * lone-ESC 判定窗（主屏 30ms 窗同律）：恰单字符 '\x1b' 的首 chunk 可能是
 * 转义序列被传输拆片的首片（SSH 高延迟/tmux passthrough——方向键 \x1b[A
 * 分两 chunk 到达）——窗内收得续字节则并归整段按转义序列处 unknown（面板
 * 对未知键忽略、循环再读下一键——normalizeOnboardingKey 判据面）；窗尽
 * 无续才返回 'escape'（真单发 Esc，面板退出键）。非 ESC 形零等待直归一。
 */
async function readSingleKeyFromIo(io: TerminalIO): Promise<string> {
  const wasRaw = io.isRaw();
  io.setRawMode(true);
  try {
    let data = await new Promise<string>((resolve) => {
      const unsubscribe = io.onInput((chunk) => {
        unsubscribe();
        resolve(chunk);
      });
    });
    // 判定窗只对恰单字符 ESC 的 chunk 开（预读首片窗——raw 态保持窗全程）
    if (data === '\x1b') {
      const continuation = await new Promise<string | undefined>((resolve) => {
        let settled = false;
        let timer: NodeJS.Timeout | undefined;
        const finish = (value: string | undefined): void => {
          if (settled) return; // 先到者胜（续片/窗尽竞速——恰一笔结算）
          settled = true;
          if (timer !== undefined) clearTimeout(timer); // 定时器恒清（零泄漏）
          unsubscribe();
          resolve(value);
        };
        const unsubscribe = io.onInput((chunk) => finish(chunk));
        timer = setTimeout(() => finish(undefined), ONBOARDING_ESCAPE_WINDOW_MS);
      });
      if (continuation !== undefined) {
        data += continuation; // '\x1b[A' 整段并归——normalize 判 unknown（转义序列）
      }
    }
    return normalizeOnboardingKey(data);
  } finally {
    io.setRawMode(wasRaw);
  }
}
export { readSingleKeyFromIo }; // 测试消费面（exitCommandItems 同先例——单键读真身行为锁）

/** /debug 尾窗读初始窗字节（64KiB——开面板读成本钉 O(初始窗 + 扩窗)，不随日志总长增长） */
const LOG_TAIL_INITIAL_WINDOW_BYTES = 64 * 1024;

/**
 * 日志尾行尾窗读（/debug 开面板数据源——E2 尾窗读批）：stat 定 size 后从文件
 * 尾按窗偏移读（openSync + readSync(position)——结构上不触窗前字节），首窗
 * 64KiB；窗内行数不足 maxLines 时窗翻倍扩读，直至盖全文件。
 *
 * **等价性**（与全读 split 形逐行相等——测试 fullReadTail 对照锁）：窗口起点
 * 在文件头之后时首行可能是残行（起点落在行中间；多字节 UTF-8 跨窗边界同理
 * ——替换符行），整行丢弃；丢后行集恒为全读行集的真后缀，行数足够时
 * slice(-maxLines) 与全读尾 maxLines 逐行相同、不足时扩窗到文件头（start=0
 * 首行完整不丢）。尾换行伪行去一与全读形同律。
 *
 * @param logPath 日志路径（open 失败〔未生成/权限〕→ null——开屏同缺席形呈现）
 * @param maxLines 尾行帽（/debug 呈现帽 50）
 * @param initialWindowBytes 初始窗字节（测试注入小窗逼扩窗重读形）
 */
export function readLogTailLines(
  logPath: string,
  maxLines = 50,
  initialWindowBytes = LOG_TAIL_INITIAL_WINDOW_BYTES,
): readonly string[] | null {
  let fd: number | undefined;
  try {
    fd = openSync(logPath, 'r');
    const size = fstatSync(fd).size;
    let window = Math.max(1, initialWindowBytes);
    for (;;) {
      const length = Math.min(window, size);
      const start = size - length; // 窗口起点（length === size 时 = 0 文件头）
      const buf = Buffer.alloc(length);
      // position 形偏移读——只触窗内字节（读中追加的尾部不影响既定窗完整性）
      const bytesRead = readSync(fd, buf, 0, length, start);
      const lines = buf.toString('utf8', 0, bytesRead).split('\n');
      if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop(); // 尾换行伪行去一
      if (start > 0) {
        // 窗口起点在文件头之后——首行可能残（行中起点/UTF-8 跨界），整行丢弃；
        // 丢后行集是全读行集的真后缀（等价性论证见头注），行数不足走扩窗
        lines.shift();
      }
      if (lines.length >= maxLines || length === size) {
        return lines.slice(-maxLines); // 盖全仍不足 = 文件本身行少（诚实全量）
      }
      window *= 2; // 窗内行数不足帽——翻倍扩窗重读
    }
  } catch {
    return null; // 读失败（未生成/权限）——同缺席形诚实呈现
  } finally {
    if (fd !== undefined) closeSync(fd); // 描述符恒还（零泄漏）
  }
}

/**
 * customProviders 写侧合并基（#2）：原始文件键集（readRawCustomProviders 单源）
 * ——不得取 readHostSettings 投影（丢坏形条目后整键覆写会静默清除手编坏形
 * 兄弟条目）。非对象形（数组/字符串——手编深坏形）不展开为合并基：数字键
 * 展开会铸出垃圾条目；此形下读侧已整键忽略，写侧以空基处理。
 */
function rawCustomMergeBase(dataDir: string): Record<string, unknown> {
  const raw = readRawCustomProviders(dataDir);
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {};
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
  const { runtime, stack, scope, logger, boot, reloader, dispatch, jobRows }: AssemblySuccess = assembly;

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
        process.stderr.write('warn：Web 界面组件未安装——--port 不生效（不影响 TUI 本身）\n');
      } else {
        const mountKit = scope.tryGet<WebuiMountKit>('webui-face-mount');
        webuiMounted = mountKit !== undefined;
        try {
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
        } catch (error) {
          // 开面失败（如端口占用 EADDRINUSE）= 预期内环境态——干净呈报退 1
          // 不写 crash.log（run-entry :437-442 同档同文；此点尚未起 TUI 屏，
          // finally 仍走 shutdown 六步收口——closer 出屏复原无害）
          process.stderr.write(`--port 开启失败：${error instanceof Error ? error.message : String(error)}\n`);
          return 1;
        }
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
          `sessions resume 失败：会话不存在（${options.resumeSessionId}）——用 sessions list 查看现有 id\n`,
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

    // —— 聚焦会话工作区锚（三消费位单源：@ 补全 / /rewind 尾参 / /new）：
    // 活体镜像优先（manager.workspaceRootOf——03 §10.7「锚不能走库读」律，
    // /rewind list 与 checkpoint gate 判据真源同面）→ 库行回退（聚焦未补开
    // 驱动窗——冷会话行值）→ 启动会话根兜底。零事件会话（/new 建后首事件
    // 落库前）无库行、真锚只在活体镜像——库读直取会与真源分叉。
    const focusedWorkspaceRoot = (): string => {
      const focused = stack.channels.focusedId;
      if (focused === null) return session.workspaceRoot;
      return canonicalWorkspaceRoot(
        stack.manager.workspaceRootOf(focused) ??
          runtime.persistence.store.getSessionRow(focused)?.workspaceRoot ??
          session.workspaceRoot,
      );
    };

    // 补全命令源：通道核命令表 → '/' 前缀条目；@ 文件段源动态锚（R7 批
    // 10k）——切焦后锚随聚焦会话工作区根（锚取当下真值；FileMentionSource
    // per-query 新铸）
    const mentionSourceFor = (): FileMentionSource => {
      return new FileMentionSource({ basePath: focusedWorkspaceRoot() });
    };
    const rows = io.size().rows;
    // —— 活体值补全依赖（挂账解挂批 2026-09-15——07 §4.1 R6）：/rewind 尾参位
    // 经 core:checkpoint 服务面现取 manifest 清单（scope.tryGet——core-plugins
    // provide 'checkpoint' { store }），按聚焦会话工作区根过滤（与 /rewind list
    // 列点同判据——锚 = manager 活体镜像优先〔focusedWorkspaceRoot〕，聚焦
    // 空悬回退启动会话根）；件缺席 = 该活体位诚实缺席。/plugins 尾参位的
    // pluginReport 经 assembly 装配根 provide 的
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
    // goal 服务面（'goal' 窄面 GoalFace——core 件注册；件缺席 = 诚实缺席）
    const goalFace = scope.tryGet<GoalFace>('goal');
    const liveCompletionDeps: LiveCompletionDeps = {
      ...(checkpointStore !== undefined
        ? {
            rewindManifests: async (): Promise<readonly { readonly id: string }[]> => {
              const root = focusedWorkspaceRoot(); // 活体镜像优先（/rewind list 判据真源同面）
              const manifests = await checkpointStore.listManifests();
              return manifests.filter((manifest) => manifest.workspaceRoot === root);
            },
          }
        : {}),
      // /plugins 尾参位活体源（activated ∪ skipped——failed 不入可操作面；
      // 结构子集形直赋——取值器每查询现取，与 rewind 位同族）
      ...(pluginLoadReport !== undefined ? { pluginReport: () => pluginLoadReport.report() } : {}),
      // /goal show|wake|approve 尾参 goal id 位活体源（service.list() 全量行
      // ——/goal list 同一读面；A-6 组γ；goal 件缺席 = 该活体位诚实缺席）
      ...(goalFace !== undefined
        ? { goalRows: () => goalFace.service.list().map((row) => ({ id: row.id, objective: row.objective })) }
        : {}),
      // /export|/resume 首参会话 id 位活体源（manager 全量行——/sessions 清单
      // 同一读面；2026-10-01 位逻辑迁 live-completions 第三活体位，本位只注数）
      sessionRows: () => stack.manager.list({}),
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
      // git 支名@短哈希（V-3 注⑦②——footer ⎇ 段退役迁此）：值形四态 =
      // 支名@短哈希 / 支名@（哈希读失败）/ @短哈希（detached）/ null（非库
      // ——不推行不虚报）；开屏一次现算（footer 期逐帧读盘退役）
      const git = readGitHead(root);
      const gitHead =
        git.branch === null && git.shortHash === null ? null : `${git.branch ?? ''}@${git.shortHash ?? ''}`;
      if (
        !backend.openStatus({
          version: options.version ?? '0.0.0',
          model: stack.model,
          modelCount,
          // 模型凭证态 + 完整值（ob-2 态 + C-4 全明文翻裁值）：开屏现算注入
          // ——人面所见即供血（env 供血值/绑定行胜出原值）；env 三键白名单
          // 行集维持（04 §7——值只进凭证行不扩 env 键面）
          modelCredential: stack.modelCredentialStatus(),
          modelCredentialKey: stack.modelCredentialKeyOf() ?? null,
          sessionId: sid,
          cwdLabel: basename(root),
          gitHead,
          turns,
          // 今日全道耗（V-4 注⑪⑤——footer 今日段退役迁此）：快照档开屏现读
          // （allLanesSpentToday 呈现口径读面——与闸门口径分立）；零耗不推行
          todaySpent: stack.llm.allLanesSpentToday(),
          dataDir: runtime.dataDir,
          theme: backend.themeChoice,
          env: [
            { key: 'BERRY_AGENT_MODEL', value: envValue('BERRY_AGENT_MODEL') },
            { key: 'BERRY_AGENT_DATA_DIR', value: envValue('BERRY_AGENT_DATA_DIR') },
            { key: 'BERRY_AGENT_LOG_LEVEL', value: envValue('BERRY_AGENT_LOG_LEVEL') },
          ],
        })
      ) {
        backend.notify('状态页暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
      }
    };

    const openDebugPanel = (): void => {
      const dataDir = runtime.dataDir;
      // daemon.log 尾行快照——帽 50 行、开屏一次只读（活体跟随挂账——/history
      // 快照档同律）；尾窗偏移读（E2——读成本钉 O(64KiB+扩窗)，不随日志总长
      // 无界）；:memory: 无数据目录 = 路径缺席，文件不在 = 快照缺席
      const logPath = dataDir !== null ? daemonPaths(dataDir).logPath : null;
      const tail = logPath !== null ? readLogTailLines(logPath) : null;
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
                : 'info（默认）',
          settingsKeys: settingsLoad !== null ? Object.keys(settingsLoad.settings) : [],
          settingsWarnings: [
            ...settingsWarns,
            ...backend.keybindingRejections.map((rejection) => `键位覆盖未生效：${rejection.detail}`),
          ],
          sqlitePath: runtime.persistence.store.dbPath,
          pluginIds: boot.report.activated.map((activated) => activated.id),
        })
      ) {
        backend.notify('调试页暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
      }
    };

    const openSkillsPanel = (): void => {
      // skills 服务面（core:skills provide 'skills'）——件缺席 = 诚实拒不开屏
      const registry = scope.tryGet<SkillsRegistry>('skills');
      if (registry === undefined) {
        backend.notify('skills 插件未安装——暂无技能清单', { level: 'warn' });
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
        backend.notify('技能清单暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
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
          backend.notify(`主题 ${name} 加载失败——保持当前主题（详见日志）`, { level: 'warn' });
          return;
        }
        backend.setThemeChoice(name, overlay);
      }
      if (runtime.dataDir !== null && writeHostSettings(runtime.dataDir, { theme: name }) === 'rejected') {
        backend.notify('主题已切换，但保存失败：settings.json 格式有误——修好后可再保存', { level: 'warn' });
      }
    };

    // —— 模型选定与面板装配闭包（UX 对标批 ux-4 /model——TUI 本地拦截族）：
    // 动作与 ctrl+p 循环同源（setModel + 回执）——两入口一动作；清单单源 =
    // llmRuntime 目录现取（ctrl+p 宇宙同一读面不造第二清单）。footer 行1 模型
    // 槽（V-4 注⑪②——setFooterModel 回迁）：切换即活写短名（id 尾段）
    const selectModel = (spec: string): void => {
      stack.setModel(spec);
      backend.setFooterModel(spec);
      backend.notify(`模型已切换：${spec}（下一轮对话起生效）`, { level: 'info' });
    };
    const openModelPanel = (): void => {
      // 条目 = providers 装配序 × model 序全列（ctrl+p onModelCycle 同构展开）
      const entries = [];
      for (const provider of stack.llmRuntime.models.getProviders()) {
        for (const model of provider.getModels()) {
          entries.push({ spec: `${provider.id}/${model.id}`, provider: provider.id, model: model.id });
        }
      }
      if (!backend.openModelPicker(entries, stack.model, selectModel)) {
        backend.notify('模型页暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
      }
    };

    const openThemesPanel = (): void => {
      // 条目 = 内置三档在前 + themes/ 目录清单字典序（装配拼接律——面板原样
      // 呈现）；自定义条目现探坏文件标 ⚠（静默探测——选定路的 warn 呈报另在
      // selectTheme）。当前档 = backend 活值（选定即时更新——观测位单源）。
      const dataDir = runtime.dataDir;
      const entries = [
        { name: 'auto', detail: '跟随终端明暗（自动检测）', broken: false },
        { name: 'dark', detail: '内置暗色', broken: false },
        { name: 'light', detail: '内置亮色', broken: false },
        ...(dataDir !== null
          ? listCustomThemeNames(dataDir).map((name) => {
              // 坏检查与色样共用一次加载（overlay 注入面板——swatchOf 现算腿）
              const overlay = loadCustomThemeColors(dataDir, name, { warn: () => {} });
              return {
                name,
                detail: '自定义（themes/<名>.json）',
                broken: overlay === null,
                ...(overlay !== null ? { overlay } : {}),
              };
            })
          : []),
      ];
      if (!backend.openThemes(entries, backend.themeChoice, selectTheme)) {
        backend.notify('主题页暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
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
        backend.notify('先进入一个会话，再设置思考级别', { level: 'warn' });
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
          backend.notify(`思考级别读取失败：${err instanceof Error ? err.message : String(err)}`, { level: 'error' });
          return;
        }
      } else {
        current = stack.thinkingLevel;
      }
      const entries = THINKING_LEVELS.map((level) => ({ level, detail: THINKING_LEVEL_DETAILS[level] }));
      if (!backend.openThinking(entries, current, selectThinking)) {
        backend.notify('思考级别页暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
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
        backend.notify('先进入一个会话，再设置沙箱模式', { level: 'warn' });
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
          backend.notify(`沙箱模式读取失败：${err instanceof Error ? err.message : String(err)}`, { level: 'error' });
          return;
        }
      } else {
        current = stack.sandboxMode;
      }
      const entries = SANDBOX_MODES.map((mode) => ({ mode, detail: SANDBOX_MODE_DETAILS[mode] }));
      if (!backend.openSandbox(entries, current, selectSandbox)) {
        backend.notify('沙箱模式页暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
      }
    };

    const openDiffPanel = (): void => {
      // 数据源 = 聚焦会话投影快照（开屏一次现取——快照档；ProjectedMessage
      // 结构兼容 DiffProjectionMessage 最小面，channels↛session 零新 DAG 边）
      const sid = stack.channels.focusedId ?? session.sessionId;
      const driver = stack.driverOf(sid);
      if (driver === undefined) {
        backend.notify('当前没有活动会话——没有可展示的改动', { level: 'warn' });
        return;
      }
      if (!backend.openDiff(driver.session.projection())) {
        backend.notify('改动总览暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
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
            const answer = await backend.select('卸载时如何处理插件数据？', [
              { value: 'cancel', label: '取消（什么都不动）' },
              { value: 'keep', label: '卸载并保留数据（--data keep，默认）' },
              { value: 'purge', label: '卸载并删除数据（--data purge——不可恢复）' },
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
        backend.notify(`插件市场异常：${String(err)}`, { level: 'error' });
      });
    };

    // —— /new（07 §4.1 命令面增补批 C2——逐件语义 1）：同 cwd 建新会话即切焦。
    // cwd 真源 = 聚焦会话工作区根（活体镜像优先——focusedWorkspaceRoot 三消费
    // 位之一；空悬回退启动会话根）；createSession 走 manager（零 I/O——行随首
    // 事件落库）；切焦 = registry.focus() 既有权威路（/sessions 选定同路——
    // 多会话信封分流/repaint 全链既有，本件零新编舞）。旧会话不动（/sessions
    // 可回切）。notify 一行回执（新会话短 id）。已知边界（非缺陷——清单真源
    // 律）：零事件新会话不在 /sessions 清单，footer 短 id 即其可见位。
    const startNewSession = (): void => {
      const root = focusedWorkspaceRoot();
      const created = stack.manager.create({ workspaceRoot: root });
      stack.channels.registerSession(created.sessionId);
      // notify 必须排在 focus 落画之后：onRepaint 会作废全部 pendingOps（切焦
      // 权威重建「旧帧作废」——先 notify 的瞬时行会被随后 repaint 清队丢行），
      // 故链在 focus promise 尾——回执行随新焦 transcript 存活可见。focus 拒
      // 绝（投影真源故障 fail-loud）诚实呈报不吞。
      void stack.channels
        .focus(created.sessionId)
        .then(() =>
          backend.notify(`新会话：${shortIdOf(created.sessionId)}（旧会话不动——/sessions 可切回）`, {
            level: 'info',
          }),
        )
        .catch(
          (err: unknown) => backend.notify(`切换到新会话失败：${foldErrorText(err)}`, { level: 'error' }), // 单源折面（组α——BaseError 码直呈/Error 免前缀噪音）
        );
    };

    // —— /upgrade 薄壳（07 §8.5 第 2 条 + 第 6 条手动通道）：跑同一只读检查
    // （强制刷新缓存——恒走网络，不受 24h 节流辖）→ notify 呈报本地/远端版本
    // → 指引退出后执行 berry update——**TUI 内不自动执行**（永不热换运行中
    // 进程）。失败诚实呈报（手动通道非启动腿——用户敲了命令，静默反欺）。
    // 检查腿经注入面（manualUpdateCheck——测试注桩零网络，缺省产线真身）；
    // registryFallback 注记单源在 upgrade.ts（CLI 腿同句——两腿同源律呈报位）。
    const manualCheck = options.manualUpdateCheck ?? runManualUpdateCheck;
    const runUpgradeShell = (): void => {
      if (runtime.dataDir === null) {
        backend.notify('版本检查不可用（当前为内存模式，没有数据目录）', { level: 'warn' });
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
              backend.notify(`版本检查失败：远端版本号「${result.latest}」格式不对（registry 数据异常）`, {
                level: 'warn',
              });
              return;
            }
            const cmp = compareSemverFull(result.latest, options.version ?? '0.0.0');
            if (cmp !== null && cmp > 0) {
              backend.notify(
                `新版本 ${result.latest} 可用（本地 ${options.version ?? '0.0.0'}）——退出后执行 berry update（TUI 内不自动执行）`,
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
            backend.notify('版本检查失败：registry 返回 404（npm 源上找不到包——可能未发布或源配错）', {
              level: 'warn',
            });
          } else {
            backend.notify(`版本检查失败：${result.message}——稍后再试或退出后执行 berry update`, { level: 'warn' });
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
              '直接说需求即对话（编码 / 问答 / 执行——能力可通过安装插件扩展）',
              '/help 命令与键位帮助 · /guide 本参考',
            ],
          },
          {
            // 模型配置段（2026-09-19 P0 静默链修复批——07 §8.5 第 2 条补段；
            // 2026-09-28 模型渠道批 C-4 v2 文案）：首跑未配凭证用户的产品级
            // 指路（报错要诚实之外的「错了知道怎么改」面）——/setup 向导是
            // 主路（官方/自定义网关同场、当场生效），env 供血与换模型键为
            // 手编路
            title: '模型配置',
            lines: [
              '/setup 向导：选渠道（官方/自定义网关）→ 录 API key（明文）→ 立即生效',
              '换模型：输入 /model 打开选择器（打字过滤，ctrl+p 快速切换）；更多方式见 docs/usage.md「模型配置」',
            ],
          },
          {
            title: '核心命令',
            lines: [
              '/sessions 切会话 · /new 新建会话 · /usage 会话用量',
              '/status 状态汇总 · /model 切模型 · /themes 主题 · /marketplace 插件市场',
              '/update 检查更新 · /exit 退出（效果同 Ctrl+D）',
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
              '升级：退出后执行 berry update（或 npm i -g berry-agent）——升级不热替换，重启生效',
              '卸载：npm rm -g berry-agent + 清理数据目录 ~/.berry-agent（先导出记忆）',
            ],
          },
        ],
      });
      if (!ok) {
        backend.notify('引导页暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
      }
    };

    // —— /feedback 反馈页（UX ④拍板——2026-09-30 UX 五问题批 + 2026-10-01
    // 界面美化役批）：run 错误史查看 + 本地诊断包导出（**零上报腿**——README
    // 六语零遥测承诺红线，材料只写本机文件，面板与导出包内均明示「不会上
    // 传」）。数据面全走装配注入闭包（channels 不直 import persist——/sessions
    // 清单注入同律）：错误史 = durable events 既有读面 queryEvents 逐会话扫
    // 近 7 天（assistant/message 的 errorMessage 腿 + turn/end reason=error
    // 腿——agent_end failed 的持久化形，同轮去重；扫描纯函数单源在
    // feedback-viewer 件）；会话清单 = stack.manager.list({})（/sessions 同窗
    // 语义）；诊断包落盘 = 数据目录 diagnostics/ 下 md 文件（session-export
    // 的 exports/ 落盘同律）。
    const FEEDBACK_WINDOW_DAYS = 7; // 扫描时间范围（天——呈现与导出包同值披露）
    const FEEDBACK_SCAN_PAGE_LIMIT = 10000; // 单会话事件单页帽（queryEvents 硬帽同值——溢出即截断诚实披露）
    const FEEDBACK_MAX_ENTRIES = 50; // 错误条目帽（呈现与导出包共用——重错误机诚实截断）
    /**
     * 反馈副屏数据源集槽形（结构形——与 channels 件 feedback-viewer 的
     * FeedbackScreenSources 恒等；host 不深挖 channels 内件〔模块公开面纪律〕，
     * 经 backend 方法签名结构校验同 openGuide 数据字面量先例）。backend
     * .openFeedback 方法落位前槽位先行——接线挂账主会话（方法 + 回填行）。
     */
    type FeedbackScreenSourcesSlot = {
      sessions: readonly { id: string }[];
      queryEvents: (filter: { sessionId: string; types: readonly string[]; sinceMs: number; limit: number }) => {
        events: readonly { type: string; time: number; data: unknown }[];
        nextCursor: unknown;
      };
      sinceMs: number;
      windowDays: number;
      pageLimit: number;
      maxEntries: number;
      sessionsTotal: number;
      env: readonly string[];
      daemonLogPath: string | null;
      daemonLogTail: readonly string[] | null;
      writeFile: (content: string) => string;
    };
    // 反馈副屏开面板槽（backend.openFeedback 方法归 tui-backend 件〔openGuide
    // 同律〕——可变 ref 形同 rewindOpener 槽先例；装配尾段回填真身，装载期
    // 空窗 notify 降级「暂不可用」）
    const feedbackScreenOpenerRef: { current: ((sources: FeedbackScreenSourcesSlot) => boolean) | null } = {
      current: null,
    };
    const openFeedbackPanel = (): void => {
      const opener = feedbackScreenOpenerRef.current;
      if (opener === null) {
        backend.notify('反馈页暂不可用——稍后再试', { level: 'warn' });
        return;
      }
      // daemon.log 尾行快照（V-0 注⑤「daemon.log 随导出件出」——/debug 同源：
      // readLogTailLines 单源帽 50 + 开屏一次只读快照档律；:memory: 无数据目录
      // = 路径缺席，文件不在 = 快照缺席——诚实缺席两形在 viewer 件内呈现）
      const fbLogPath = runtime.dataDir !== null ? daemonPaths(runtime.dataDir).logPath : null;
      const ok = opener({
        // 会话清单（/sessions 同窗——manager.list 近 100 行；总数独立单源）
        sessions: stack.manager.list({}).map((row) => ({ id: row.id })),
        // durable events 既有读面（箭头包装——结构形恒等透传，channels 侧零 persist 依赖）
        queryEvents: (filter) => runtime.persistence.store.queryEvents(filter),
        sinceMs: Date.now() - FEEDBACK_WINDOW_DAYS * 24 * 60 * 60 * 1000,
        windowDays: FEEDBACK_WINDOW_DAYS,
        pageLimit: FEEDBACK_SCAN_PAGE_LIMIT,
        maxEntries: FEEDBACK_MAX_ENTRIES,
        sessionsTotal: stack.manager.countSessions(),
        // 环境摘要行集（导出包头段专用——「标签 值」拼好形；凭证/token 恒不入面〔04 §7〕）
        env: [
          `版本    ${options.version ?? '0.0.0'}`,
          `模型    ${stack.model}`,
          `数据目录 ${runtime.dataDir ?? '（:memory: 内存模式——未使用数据目录）'}`,
          `平台    ${process.platform}/${process.arch}（node ${process.version}）`,
        ],
        // daemon.log 尾快照（开屏一次只读——Bearer 掩码执法在 viewer 件内）
        daemonLogPath: fbLogPath,
        daemonLogTail: fbLogPath !== null ? readLogTailLines(fbLogPath) : null,
        // 诊断包落盘闭包（回执串直回面板——含路径与「不会上传」明示）
        writeFile: (content) => {
          const dataDir = runtime.dataDir;
          if (dataDir === null) {
            return '导出失败：当前为内存模式，没有数据目录可保存诊断包';
          }
          const dir = join(dataDir, 'diagnostics');
          mkdirSync(dir, { recursive: true });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-'); // session-export fileStampOf 同形（文件名安全）
          const path = join(dir, `feedback-${stamp}.md`);
          writeFileSync(path, content, 'utf8');
          return `已导出诊断包 → ${path}（只保存在本机，不会上传）`;
        },
      });
      if (!ok) {
        backend.notify('反馈页暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
      }
    };

    // —— /setup 配置向导编舞（onboarding ob-3 + 2026-09-28 模型渠道批 C-3 v2
    // 分桶重做）：副屏 SetupWizardPanel 即 WizardPrompter 实装（backend
    // .openSetupWizard——副屏占用返 null → notify 诚实降级与 /help 同律）；
    // 流程件 runSetupWizard 纯逻辑零 TUI 依赖，deps 在此装配——saveBinding/
    // removeBinding 走 runCredentialsCommand 公开路由（与 /credentials 人面
    // 动词同一单源；credentialsWrite seam 单源消费——credentials/changed
    // 审计两写路径平权）；探针 = stack.probeModelConnectivity 真供血路
    // 1-token 微探活（metering 归因聚焦会话——落 llm/usage probe: 形账）。
    // v2 新接线：customProviders 读写（settings 单源）/ 拉取（C-2 件直包）/
    // 活注册（stack.registerCustomProvider——透传 + env 豁免集同步扩，向导路
    // 当场生效）/ 切模型（stack.setModel 内存旋钮）。
    // onboarding setup 决策兑现（ob-2 起屏 pending）= 同一 openSetupWizard——
    // 重入非二形。
    const openSetupWizard = (): void => {
      const prompter = backend.openSetupWizard();
      if (prompter === null) {
        backend.notify('配置向导暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
        return;
      }
      // 重入默认值：当前模型首斜杠段（官方桶在册时预选）
      const modelSpec = stack.model;
      const slash = modelSpec.indexOf('/');
      const currentProvider = slash === -1 ? modelSpec : modelSpec.slice(0, slash);
      // 探针目标解析：provider 首模型（ModelInfo.id 全形；空目录 → undefined
      // 流程侧跳过注记）
      const firstModelSpecOf = (providerId: string): string | undefined => stack.llm.listModels(providerId)[0]?.id;
      // 开向导即读 settings 快照（分桶/保留字/env 豁免判据基线——保存腿内
      // 各自重读防陈化）
      const dataDir = runtime.dataDir;
      const settingsNow = dataDir !== null ? readHostSettings(dataDir, { warn: (m) => logger.warn(m) }) : null;
      const customChannels = settingsNow?.settings.customProviders ?? {};
      // R-1 分桶数据面判据：customIds = settings 键 − 内置目录 id（04 §9 ⑥
      // 评审修复批注④——非运行时表差集〔展示集混源〕：撞内置 id 的撞名条不
      // 入集〔官方桶内置本体胜出不消失 + 不误判 env 豁免〕；半保存渠道仍在
      // 集归自定义桶）。判据单源 = llm 域 builtinProviderIds。
      const customIds = new Set(Object.keys(customChannels).filter((id) => !builtinProviderIds().includes(id)));
      const settingsWarn = (message: string): void => {
        logger.warn(message);
      };
      void runSetupWizard({
        prompter,
        // 官方桶 = 内置目录 ∩ 运行时在册（#3——修前只滤 customIds：settings 已删
        // 仍在册的自定义渠道 id、注入的非内置 id 会以官方渠道身份呈现）。判据
        // 单源 = llm 域 builtinProviderIds（boot 装配注册 + 向导活注册的自定义
        // 渠道也在运行时表——归自定义桶不重复呈现；孤儿渠道两桶皆不入）
        providers: [...stack.llmRuntime.models.getProviders()]
          .filter((provider) => !customIds.has(provider.id) && builtinProviderIds().includes(provider.id))
          .map((provider) => ({
            id: provider.id,
            name: provider.name,
            ...(provider.baseUrl !== undefined ? { baseUrl: provider.baseUrl } : {}),
          })),
        // 自定义桶数据面 = customChannels 滤撞名条（两桶皆不入——重入/删除
        // 面随呈现面同滤〔清除径唯一 = 手编〕；写侧 existing 合并保留原文
        // 不静默清除，见 saveCustomChannel）
        customChannels: Object.fromEntries(
          Object.entries(customChannels).filter(([id]) => !builtinProviderIds().includes(id)),
        ),
        // 保留字判据单源（#14——修前第三形态「运行时全集差集」与 boot 执法分叉：
        // 注入/插件 id 被谎报「内置渠道」拒录）。id 步判据与执法同源 = llm 域
        // builtinProviderIds 目录
        builtinProviderIds: builtinProviderIds(),
        currentProvider,
        // R-3 ✓ 判据同锚：分桶 configured 标记与 /status 同一 modelCredentialStatus
        // 判据（env ∨ 绑定行——裸 providerId 即该判据的 provider 级入口）
        credentialReadyOf: (providerId) => stack.modelCredentialStatus(providerId) === 'ready',
        // 值只经流程「空录入沿用」位（bindingApiKeyOf 胜出行原值——遮蔽回
        // undefined）；薄包 providerId 形——流程件按**所选** provider 现取，
        // 换 provider 改选不沿用当前模型 provider 的 key（跨 provider 沿用
        // 错 key 防线在流程件，本位只供真源；全明文翻裁后预览即全值）
        currentApiKeyOf: (providerId) => stack.bindingApiKeyOf(providerId),
        // 自定义渠道豁免（07 §8.4 裁决——env 不合成不供血）；官方腿判据原样
        envShadowed: (providerId) =>
          customIds.has(providerId)
            ? false
            : providerApiKeyEnvNames(providerId).some((name) => (env[name] ?? '') !== ''),
        saveBinding: (providerId, apiKey) =>
          runCredentialsCommand(
            { sub: 'add', name: providerId, value: apiKey, modelProvider: providerId },
            {
              store: assembly.credentialsWrite.store,
              onCredentialChanged: assembly.credentialsWrite.onCredentialChanged,
            },
          ),
        // 删除腿凭证行（写序第一步）：缺席 = 无需删（渠道建了没录 key 的合法
        // 中间态）——runCredentialsCommand 内部已把 BaseError 折 {ok:false}
        // 回执（:213——本位 try/catch 是死代码，R-1 改判回执文本码前缀折 ok
        // 档；`CREDENTIALS_NOT_FOUND：` 前缀词法形 = credentials/commands 折
        // 档产出 `${code}：${message}` 的锁面，测试锁两侧）
        removeBinding: (providerId) => {
          const receipt = runCredentialsCommand(
            { sub: 'rm', name: providerId },
            {
              store: assembly.credentialsWrite.store,
              onCredentialChanged: assembly.credentialsWrite.onCredentialChanged,
            },
          );
          if (!receipt.ok && receipt.text.startsWith('CREDENTIALS_NOT_FOUND：')) {
            return { ok: true, text: `未找到 ${providerId} 保存的 API key（无需删除）` };
          }
          return receipt;
        },
        probeModelOf: firstModelSpecOf,
        probe: (providerId, apiKey) => {
          const spec = firstModelSpecOf(providerId);
          // 流程侧已保 probeModelOf 非 undefined 才达此位——spec 缺席属并发
          // 换代窗防御（折失败数据不炸向导）
          if (spec === undefined) {
            return Promise.resolve({ ok: false, detail: '模型列表已更新（当前无可用模型）' });
          }
          return stack.probeModelConnectivity(spec, apiKey, {
            sessionId: stack.channels.focusedId ?? session.sessionId,
          });
        },
        // 模型清单拉取（C-2 件——SSRF 守卫必经 + 协议分叉拼接单源）
        fetchModels: (req) => fetchChannelModels(req),
        // settings customProviders 合并写（保存腿内重读现值——同窗多写不陈化）。
        // R-1 写侧拒撞名（纵深——执法单源在 stack 注册口，本位保 settings 数据
        // 面同判据：撞名条装配即拒注 + 向导全域不可见，落了即死条）。
        // #2 写侧合并基 = **原始文件**（readRawCustomProviders 单源）——不得取
        // readHostSettings 投影（丢坏形条目后整键覆写会静默清除手编坏形兄弟
        // 条目）；删除腿同律
        saveCustomChannel: (id, def) => {
          if (dataDir === null) return { ok: false, text: '数据目录不可用——无法保存渠道配置' };
          if (builtinProviderIds().includes(id)) {
            return { ok: false, text: `渠道 id ${id} 与内置渠道重名——换一个` };
          }
          const existing = rawCustomMergeBase(dataDir);
          const written = writeHostSettings(
            dataDir,
            { customProviders: { ...existing, [id]: def } as Record<string, CustomProviderDef> },
            { warn: settingsWarn },
          );
          return written === 'written'
            ? { ok: true, text: `渠道配置已保存（settings.json customProviders.${id}——重启后仍可用）` }
            : { ok: false, text: 'settings.json 写入失败（文件格式有误？）——修好后重试' };
        },
        removeCustomChannel: (id) => {
          if (dataDir === null) return { ok: false, text: '数据目录不可用——无法修改渠道配置' };
          const next: Record<string, unknown> = { ...rawCustomMergeBase(dataDir) };
          delete next[id];
          const written = writeHostSettings(
            dataDir,
            { customProviders: next as Record<string, CustomProviderDef> },
            { warn: settingsWarn },
          );
          return written === 'written'
            ? { ok: true, text: `渠道配置已移除（customProviders.${id}）` }
            : { ok: false, text: 'settings.json 写入失败（文件格式有误？）——修好后重试' };
        },
        // 活注册（向导路当场生效）：透传 stack 注册口（R-1 执法单源——拒注
        // 回执原样透传，流程件折注册注记分档；resolveKey 供血真源 = 绑定行
        // 胜出行，与装配腿同律）
        registerCustomProvider: (id, def) =>
          stack.registerCustomProvider(createCustomChannelProvider(id, def, () => stack.bindingApiKeyOf(id))),
        // 活除名 + 模型复位（R-1 删除腿三联动第三步）：运行时除名（env 豁免
        // 集同步收缩——stack 口）；当前模型停在被删渠道 = 复位运行时目录首条
        // （「可用」= 目录首条即算〔含未配置——诚实死错优于静默〕；目录空 =
        // 不复位仅流程侧点名——R-1 D2 定形）
        unregisterCustomProvider: (id) => {
          stack.unregisterCustomProvider(id);
          const spec = stack.model;
          if (spec.startsWith(`${id}/`)) {
            const fallback = stack.llm.listModels()[0]?.id;
            if (fallback !== undefined) {
              stack.setModel(fallback);
              return { modelReset: fallback };
            }
          }
          return {};
        },
        switchModel: (spec) => {
          stack.setModel(spec);
        },
      }).catch((err: unknown) => {
        // fire-and-forget 零 unhandled（openMarketplacePanel 同律防御位）：兜
        // 流程件 saveBinding 折档之外的腿（如 probe reject）——异常 notify 呈
        // 报不杀整个 TUI（installCrashChoreography 的 unhandledRejection exit(1)）
        backend.notify(`配置向导异常：${err instanceof Error ? err.message : String(err)}`, { level: 'error' });
      });
    };

    // 本地命令族单源（拦截表 / 补全源 / /help 命令册三消费面同文）
    const localCommands = [
      {
        name: 'new',
        description: '新建会话并切换（同 cwd——旧会话不动，/sessions 可切回）',
        run: () => startNewSession(),
      },
      { name: 'status', description: '状态汇总页（版本/模型/会话/环境变量）', run: () => openStatusPanel() },
      {
        name: 'model',
        description: '模型选择页（↑↓ 选定/打字过滤——下一轮对话起生效；ctrl+p 快速循环）',
        run: () => openModelPanel(),
      },
      {
        name: 'setup',
        description: '模型配置向导（选渠道/自定义网关 → 录 key → 立即生效，可选连通验证）',
        run: () => openSetupWizard(),
      },
      { name: 'debug', description: '调试信息页（日志尾快照/生效配置/插件清单）', run: () => openDebugPanel() },
      { name: 'skills', description: '技能清单页（enter 填入输入框）', run: () => openSkillsPanel() },
      { name: 'themes', description: '选定主题（立即生效并保存）', run: () => openThemesPanel() },
      {
        name: 'thinking',
        description: '选择思考级别（七级可选——下一轮对话起生效，随模型能力）',
        run: () => openThinkingPanel(),
      },
      {
        name: 'sandbox',
        description: '沙箱模式选择（选定后立即生效，各会话独立设置）',
        run: () => openSandboxPanel(),
      },
      { name: 'diff', description: '会话改动总览页（edit 聚合按文件分组）', run: () => openDiffPanel() },
      {
        name: 'marketplace',
        description: '插件市场（enter 安装/卸载 · u 更新 · r 刷新）',
        run: () => openMarketplacePanel(),
      },
      {
        name: 'update',
        description: '检查更新（本地/远端版本——退出后执行 berry update）',
        run: () => runUpgradeShell(),
      },
      {
        name: 'guide',
        description: '快速上手参考页（版本/模型配置/核心命令/文档地图/升级与卸载）',
        run: () => openGuidePanel(),
      },
      {
        name: 'feedback',
        description: '反馈页（近 7 天运行错误查看 + 导出本地诊断包——不上传）',
        run: () => openFeedbackPanel(),
      },
      {
        name: 'jobs',
        description: '后台任务清单页（运行中 + 近期结束——主屏清单外的全量记录）',
        run: () => void backend.openJobs(),
      },
    ] as const;
    /** 本地命令族 → 补全条目（query 已去斜杠——与 exitCommandItems 同契约） */
    const localCommandItems = (query: string): readonly AutocompleteItem[] =>
      fuzzyFilter(localCommands, (command) => command.name, query).map((command) => ({
        label: `/${command.name}`,
        detail: command.description,
        replacement: `/${command.name}`,
      }));

    // —— /help 帮助副屏开屏体（R7 批 10k host 装配侧直挂；V-3 注⑦④ `?`
    // 闲态教学键与 /help 命令同一开屏本体）：命令册三源合流 = 通道核命令表 +
    // TUI 本地命令族 + TUI 本地退出词（三源与补全源同面，本地族文案单源
    // localCommands、退出词文案单源 EXIT_DESCRIPTIONS）；键位册 = backend
    // Keymap 投影（openHelp 内取）。副屏占用时 openHelp false → notify 诚实
    // 降级（服务端 handler 同律）。闭包捕获构造后 backend 柄——仅输入期触发
    // 无 TDZ（onSubmit 同先例）
    const openHelpPanel = (): void => {
      const entries = [
        ...stack.channels.listCommands().map((spec) => ({
          name: spec.name,
          ...(spec.description !== undefined ? { description: spec.description } : {}),
        })),
        ...localCommands.map(({ name, description }) => ({ name, description })),
        ...EXIT_WORDS.map((name) => ({ name, description: EXIT_DESCRIPTIONS[name] })),
      ];
      if (!backend.openHelp(entries)) {
        backend.notify('帮助页暂不可用——先关闭当前打开的页面（esc），再试', { level: 'warn' });
      }
    };

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
          backend.notify('已排队（当前回复结束后自动开始）', { level: 'info' });
        }
        // 候跑标记透传（SubmitOptions.queueFollowUp——04 §4）：普通形不带 opts
        // 保持旧调用形（undefined 与 {} 对驱动同义，零扰动）
        const run =
          opts?.queueFollowUp === true
            ? stack.submitText(sessionId, text, { queueFollowUp: true })
            : stack.submitText(sessionId, text); // fire-and-forget——回执经信封回流
        // 全域清扫 G1-#1 提交 run 结算锚：settled promise 在桥接落账
        // （noteRunSettled → bridgeUsageLedger 推进会话累计缓存）之后 resolve——
        // promise 回调序结构性保证本刷新读到含本 run 的累计值（agent_end 信封
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
      // 消费 = 下一 run 起跑现取（在飞 run 不中途换）。回执 notify 一行；
      // 空目录零动作（无候选可换——诚实缺席）。footer 行1 模型槽（V-4 注⑪②
      // ——setFooterModel 回迁）：切换即活写短名（id 尾段）
      onModelCycle: () => {
        const specs: string[] = [];
        for (const provider of stack.llmRuntime.models.getProviders()) {
          for (const model of provider.getModels()) specs.push(`${provider.id}/${model.id}`);
        }
        if (specs.length === 0) return;
        const index = specs.indexOf(stack.model);
        const next = specs[(index + 1) % specs.length]!; // 不在册（-1+1=0）→ 装配序首位
        stack.setModel(next);
        backend.setFooterModel(next);
        backend.notify(`模型已切换：${next}（下一轮对话起生效）`, { level: 'info' });
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
      // 后台任务段数据面（界面美化役批6——UX 批6 A 件）：Job 注册表只读拉取
      // 闭包（assembly jobRows 单源）——固定区段帧首拉取 running 快照 + /jobs
      // 副屏开屏全量快照同源；refreshJobs 推送锚订阅在下（job_settled）
      jobs: {
        running: () => jobRows.running(),
        list: () => jobRows.list(),
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
          // 活体值源三位合流（plugins id / rewind id / 会话 id——07 §4.1 R6 +
          // 命令面增补批 C2 + 2026-09-30 会话管理命令批批2 /resume 扩词）：位裁
          // 与条目铸造全在 live-completions 件，null = 位外/依赖缺席归静态面
          // （四命令子动词首参 + 深位枚举——原行为零扰动）
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
      // footer 底栏三行栈供数（V-4 注⑪②③——笔3 装配面）：tiers = 档位段低频
      // 锚拉取（档位 = 聚焦会话 fold 现值 ?? 栈基线，与 openThinkingPanel/
      // openSandboxPanel 同律：thinking 可无锚诚实缩位、sandbox 恒有锚）；mode
      // = MODE_SHORT 换词（计划/Auto/YOLO——行1 首槽坍缩梯恒保位）、sandbox =
      // 原词（行2）两表示分职 session-tier-copy；sandboxDanger = danger 档标记
      // ——行1 模式槽 error 警示色判据。sessionSpent = 会话全 run token 耗聚合
      // 读面（渲染期活拉——行1 `累计 N`）；modelLabel = 初始全形（行1 呈短名
      // id 尾段；运行期换模经 setFooterModel 活写——ctrl+p//model 双入口）；
      // cwdLabel/gitRoot = 聚焦会话工作区（低频锚缓存——git IO 不进高频锚）。
      // 今日段退役（注⑪⑤——迁 /status 副屏快照档）
      footer: {
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
              mode: MODE_SHORT[sandbox] ?? null,
              thinking: thinking !== undefined ? (THINKING_LEVEL_SHORT[thinking] ?? null) : null,
              sandbox: SANDBOX_MODE_SHORT[sandbox] ?? null,
              sandboxDanger: sandbox === 'danger',
            };
          } catch {
            return { mode: null, thinking: null, sandbox: null }; // fail-open 缩位（backend 兜底同律——双保）
          }
        },
        sessionSpent: () => stack.sessionSpentOf(stack.channels.focusedId ?? session.sessionId),
        modelLabel: stack.model,
        cwdLabel: () => basename(focusedWorkspaceRoot()),
        gitRoot: () => focusedWorkspaceRoot(),
      },
      // `?` 闲态教学键柄（V-3 注⑦④——text 路分诊）：与 /help 命令同一开屏
      // 本体（上 openHelpPanel 闭包）；backend 空稿闲态门控后回调（层③.7）
      onHelpShortcut: () => openHelpPanel(),
      ...(options.version !== undefined ? { version: options.version } : {}),
      // 生产定时器注入（保活/帧帽真定时——缺省同步直出仅测试语义）
      schedule: (fn, ms) => setTimeout(fn, ms),
      cancelSchedule: (handle) => clearTimeout(handle as NodeJS.Timeout),
    });

    // 出屏复原进退出序 closer——quit 路径与信号路径（onGraceful→shutdown）同享
    runtime.registerCloser({ label: 'tui-backend', fn: () => backend.stop() });

    // —— 会话用量结算总线呈现订阅（V-4 注⑪②——footer 行1 累计段即时刷新锚）：
    // run 结算落账即通知（通知时点后于缓存推进，现拉必含本笔——sessionSpentOf
    // 聚合读面）。提交路 settled promise 锚（onSubmit run?.then 刷新）仍盖本入口
    // run——两锚叠加幂等刷新（refreshFooter 无害）；今日段已退役迁 /status
    // （注⑪⑤——快照档开屏现读，无逐帧刷新需求）。跨午夜日键翻转不在射程
    // （07 §4.1 G1 ④有界陈旧律——下次刷新锚自愈）。
    stack.onSessionUsageLedgered(() => backend.refreshFooter());

    // —— job_settled 推送锚（界面美化役批6——UX 批6 A 件）：任务结算即时
    // 收敛固定区 running 快照（闲态零帧源下不滞留至下一次交互）；总线词装配
    // 根已预注册（isRegistered 恒真——session/event 桥律同形防御位：缺席零
    // 订阅不炸）。在飞起跑无事件——新任务行随下一帧/下一交互拉取可见（挂账：
    // 起跑推送锚待后续批）。终态收口单行（07 §4.1 V-0 注①聚合律——批 V-1
    // 笔2）：焦点会话归属的 subagent Job 结算 → 正文流瞬时行收口（✓/✗/⏹
    // 携因单行）；非焦点/他 kind 零呈现（非聚焦瀑布已退役——呈现归固定区）。
    if (dispatch.isRegistered('job_settled')) {
      dispatch.on('job_settled', (data) => {
        backend.refreshJobs();
        // 载荷窄化（NotifyListener unknown 面——JobSettledEvent { entry } 单源形）
        const entry = (data as { entry: JobEntry }).entry;
        if (entry.kind === 'subagent' && entry.owner === stack.channels.focusedId) {
          backend.appendJobSettledLine(entry);
        }
      });
    }

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

    // —— 启动引导面板（onboarding ob-2 双层制第一层——07 §4.1 呈现面件 11）：
    // boot ready 后、主屏起屏前 cooked 窗一次性引导。键源在场律：注入面
    // onboardingKey 在场，或产线路径（io 未注入 + stdin 真 TTY——main.ts 非
    // TTY 卫兵已保）才起面板；注入 io 的既有测试/CI 管道形 = 面板缺席直进
    // 主屏（防注入测试死锁）。检测腿现算（modelCredentialStatus——派生态零
    // 哨兵），unconfigured 才进；quit = 不起 TUI 干净退 0（finally shutdown
    // 六步照走）；setup = 起屏后即开向导（ob-3 /setup 已入册 localCommands
    // ——hasSetupWizard 恒真全形）。
    const onboardingKeySource =
      options.onboardingKey !== undefined
        ? options.onboardingKey
        : options.io === undefined && process.stdin.isTTY === true
          ? () => readSingleKeyFromIo(io)
          : undefined;
    let onboardingSetupPending = false;
    if (onboardingKeySource !== undefined && stack.modelCredentialStatus() === 'unconfigured') {
      const modelSpec = stack.model;
      const slash = modelSpec.indexOf('/');
      const providerId = slash === -1 ? modelSpec : modelSpec.slice(0, slash);
      // env 例键合成（07 §8.4 豁免同步——#12）：自定义渠道 env 不合成不供血
      //（绑定行唯一源），对自定义渠道呈「export <ID>_API_KEY=」例键永不生效
      // ——豁免集成员判据走 stack.isCustomProvider（同集单源），仅对非自定义
      // 渠道合成例键
      const envNames = stack.isCustomProvider(providerId) ? [] : providerApiKeyEnvNames(providerId);
      const decision = await runOnboardingPanel({
        write: (text) => io.write(text),
        readKey: onboardingKeySource,
        hasSetupWizard: localCommands.some((command) => command.name === 'setup'),
        modelSpec,
        providerId,
        ...(envNames.length > 0 ? { envExample: envNames[0] } : {}),
      });
      if (decision === 'quit') {
        return 0; // 面板期退出 = 不起 TUI 干净退（closer 内出屏复原 + shutdown 六步照走）
      }
      onboardingSetupPending = decision === 'setup';
    }

    // —— /rewind 无参选择器开面板槽回填（批3——2026-09-30 会话管理命令批）：
    // backend 构造完成即回填（coreDeps 闭包读槽自此得真身——件装载期空窗
    // 已过，/rewind 命令注册面在后无竞速）；副屏占用时 backend.openRewindPicker
    // 返 false，件内 handler 落 usage 兜底（同 /help 降级律）
    assembly.rewindOpener.current = (entries, actions) => backend.openRewindPicker(entries, actions);

    // —— /feedback 反馈页开面板槽回填（UX ④拍板——界面美化役 2026-10-01 主会话
    // 接线位：backend.openFeedback 已落 tui-backend 件，ref 槽自此得真身——
    // 空窗期 notify 降级「暂不可用」形自此退场）
    feedbackScreenOpenerRef.current = (sources) => backend.openFeedback(sources);

    stack.channels.addBackend(backend);
    backend.start();
    stack.channels.registerSession(session.sessionId);
    await stack.channels.focus(session.sessionId); // 启动投影首画（含 resume 历史回读）
    // setup 决策兑现（onboarding ob-2 → ob-3）：起屏首画后即开 /setup 向导
    //（与命令行 /setup 同一 openSetupWizard——重入非二形）
    if (onboardingSetupPending) {
      localCommands.find((command) => command.name === 'setup')?.run();
    }

    // —— 键位覆盖拒载呈报（R5 批 10k——Keymap fail-loud 装配位）：settings
    // 坏覆盖逐条 warn（不炸启动——坏项忽略、好项照常生效；首画后落屏可见）
    for (const rejection of backend.keybindingRejections) {
      backend.notify(`键位覆盖未生效：${rejection.detail}`, { level: 'warn' });
    }

    // —— /help 命令注册（R7 批 10k——host 装配侧直挂）：开屏体 = 上
    // openHelpPanel 闭包（V-3 注⑦④——与 `?` 闲态教学键同一本体）
    stack.channels.registerCommand(
      'help',
      async () => {
        openHelpPanel();
      },
      '命令与键位帮助',
    );

    // webui 开面横幅（18a-3'）：TuiBackend 起屏后经 channels.notify 扇出——
    // notify 恒扇出（webui backend 同帧收到，浏览器通知位随活）；横幅走屏
    // 留痕面只带 URL，token 不入屏（令牌仅 stderr 一次性——屏流可回滚/截屏，
    // 非披露通道）；批 19e 分档：webui 件缺席形面仍开（SDK 面）——横幅诚实
    // 报 HTTP 面形不虚报 Web 界面
    if (webuiOpen !== undefined && webuiMounted) {
      stack.channels.notify(
        session.sessionId,
        `Web 界面已开启：http://${webuiOpen.host}:${webuiOpen.port}/（访问令牌在启动时的输出里——只显示这一次）`,
        { level: 'info' },
      );
    } else if (webuiOpen !== undefined) {
      stack.channels.notify(
        session.sessionId,
        `HTTP 服务已开启：http://${webuiOpen.host}:${webuiOpen.port}/（webui 插件未安装：/v1/* 接口可用，/api/* 返回 404）`,
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
            // 用户不看 /update 也知道下一步动作）
            backend.notify(`新版本 ${decision.latest} 可用——/update 查看详情；退出后执行 berry update`, {
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
    // 落盘失败折非零退出码（05 §6.3#6「flush 失败 = 退出非零码」；十六役补扫
    // N3——③ flush / ⑥ close 吞错续行后由此位如实上报，不再零码假绿）
    if (exitCode === 0 && runtime.shutdownFlushFailure?.() !== undefined) exitCode = 1;
  }
  return exitCode;
}
