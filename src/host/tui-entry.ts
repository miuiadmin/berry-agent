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

import { editorHeightCap, FileMentionSource, fuzzyFilter, ProcessTerminalIO, TuiBackend } from '../channels/index.js';
import type { AutocompleteItem, TerminalIO } from '../channels/index.js';
import { USER_GRANTABLE_CAPABILITIES } from '../contracts/api.js';
import { canonicalWorkspaceRoot } from '../context/index.js';
import { foldSessionUsage, foldTodoTable } from '../conversation/index.js';
import { sanitizeEntryForReadout, type MemoryDao } from '../memory/index.js';
import { formatSkillInvocation, type SkillsRegistry } from '../skills/index.js';
import type { Provider } from '../llm/index.js';
import { APPROVAL_PRESETS, type SandboxMode } from '../safety/index.js';
import { REWIND_SUBVERBS, type CheckpointStore } from '../checkpoint/index.js';

import type { TuiFlags } from './cli.js';
import { assembleHostStack } from './assembly.js';
import type { AssemblySuccess } from './assembly.js';
import { startSchedulerClock } from './core-plugins.js';
import type { CorePluginReference } from './loader.js';
import { runWithSessionAnchor } from './session-anchor.js';
import { liveCommandArgumentItems, type LiveCompletionDeps } from './live-completions.js';
import { readHostSettings } from './settings-store.js';
import { daemonPaths } from './serve-daemon.js';
import type { HostRuntime } from './runtime.js';
import { APPROVAL_SUBVERBS } from './approval-cmd.js';
import { DOORS_SUBVERBS } from './doors-cmd.js';
import { PLUGINS_SUBVERBS } from './plugins-command.js';
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
  const { runtime, stack, scope, logger, boot }: AssemblySuccess = assembly;

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
    // 缺席。/plugins 尾参位的 pluginReport 依赖 boot 闭包（assembly 装配根
    // 单源——LoadReport 不出 scope 面），接线归主 lane deferred。
    const checkpointStore = scope.tryGet<{ readonly store: CheckpointStore }>('checkpoint')?.store;
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
          theme: themeLoad?.settings.theme ?? 'auto',
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

    // 本地命令族单源（拦截表 / 补全源 / /help 命令册三消费面同文）
    const localCommands = [
      { name: 'status', description: '状态汇总副屏（版本/模型/会话/环境旋钮）', run: () => openStatusPanel() },
      { name: 'debug', description: '调试信息副屏（日志尾快照/生效配置/插件清单）', run: () => openDebugPanel() },
      { name: 'skills', description: '技能清单副屏（enter 回填调用形入输入框）', run: () => openSkillsPanel() },
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
        if (opts?.queueFollowUp === true) {
          void stack.submitText(sessionId, text, { queueFollowUp: true });
        } else {
          void stack.submitText(sessionId, text); // fire-and-forget——回执经信封回流
        }
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
          const live = liveCommandArgumentItems(command, query, priorArgs, liveCompletionDeps);
          if (live !== null) return live;
          return commandArgumentItems(command, query, priorArgs);
        },
        mentions: (query) => mentionSourceFor().get(query),
      },
      // 高度帽公式单源（07 §4.1 R3 批 10j）：max(5, rows×0.3)——迟滞带归视图
      maxVisibleLines: editorHeightCap(rows),
      // 主题档（批 10g）：settings 缺席 = auto 探测路；色域档由 env 两键裁定
      theme: themeLoad?.settings.theme ?? 'auto',
      colorEnv: { COLORTERM: env.COLORTERM, TERM: env.TERM },
      // 键位用户覆盖（R5 批 10k）：settings.json keybindings 键——形校验在读
      // 侧、语义校验归 Keymap fail-loud（拒载清单 start 后逐条呈报，见下）
      ...(themeLoad !== null && themeLoad.settings.keybindings !== undefined
        ? { keybindings: themeLoad.settings.keybindings }
        : {}),
      // footer 常驻段（R6 批 10k）：cwd 短名 + 模型短名（provider/model 形取
      // model 段）——会话短 id 段由 backend 每帧随 sessionId 现拼
      footer: { cwdLabel: basename(session.workspaceRoot), modelLabel: modelShortName(stack.model) },
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

/** TUI 本地退出词表（07 §4.1 2026-09-15 /exit 批——/exit 正名 + /quit 别名） */
const EXIT_WORDS = ['exit', 'quit'] as const;

/** 退出词说明（单源——补全条目与 /help 命令册两消费面同文） */
const EXIT_DESCRIPTIONS: Readonly<Record<(typeof EXIT_WORDS)[number], string>> = {
  exit: '退出 TUI（与 Ctrl+D 同路优雅退出）',
  quit: '退出 TUI（/exit 别名）',
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
