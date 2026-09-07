/**
 * host/assembly — 宿主装配序公共段（批 12f-3；07 §5 dump-config `:memory:`
 * 同构纪律的码面承载件——纪律原文：「禁 fork 诊断侧门——不许为『只打印不
 * 落库』写第二条装配路径，必须复用同一运行时装配入口」）。
 *
 * 从 tui-entry 抽出装配序前段（TUI 入口与 dump-config / plugins list 诊断
 * 命令**同一合成代码路径**——本件是唯一装配序真源，诊断命令只换运行时形
 * 〔memory 同构诊断形：真数据目录读侧 + 主库 :memory: + 不占活跃标记〕，
 * 不换代码路径）：pluginCounts 披露匣 → 运行时组装（单活跃机 + 开库
 * fail-loud）→ logger（--debug 让位律）→ 共享根作用域/事件总线 →
 * conversation 栈五层 → 插件装载（enabled.yaml 读侧 + core: 注册表 +
 * 装载管线全跑）→ 披露匣回写。
 *
 * 失败三档归一 {ok:false}（不抛——呈报面归调用方）：
 *  - 运行时组装失败（单活跃机拒入/开库失败）= 干净退出档退 1（运行时未
 *    建成，无资源待收——不写 crash.log）；
 *  - 启用清单损坏 PLUGIN_ROW_INVALID = 用户可自修配置错退 1（同干净退出
 *    档——message 已含修复指引；运行时先收口再返回）；
 *  - 意外异常 = 崩溃取证档（crash.log 已在收口前写入——memory 形内建跳过；
 *    crashed: true 供调用方区分文案前缀，不再重复取证）。
 */
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';

import { BaseError } from '../contracts/index.js';
import { EventDispatch, LogLevelState, Scope, canonicalWorkspaceRoot, createLogger } from '../context/index.js';
import type { Logger, Scope as ScopeType } from '../context/index.js';
import type { Provider } from '../llm/index.js';
import type { AllowlistDraft, SandboxMode } from '../safety/index.js';
import { createJobRegistry, createSubagentService, provideJobsService } from '../subagent/index.js';

import { appendAllowlistEntry, readAllowlist } from './allowlist-store.js';
import type { ConversationStack } from './conversation-stack.js';
import { createConversationStack } from './conversation-stack.js';
import type { CorePluginReference } from './loader.js';
import { enabledYamlPath, parseEnabledRows } from './manifest.js';
import type { PluginBootHandle } from './plugin-boot.js';
import { bootPlugins } from './plugin-boot.js';
import type { HostRuntime, HostRuntimeOptions } from './runtime.js';
import { createHostRuntime } from './runtime.js';
import { TRIGGER_JOB_PARALLEL_LIMIT, TriggerRegistry, createTriggerStarterFactory } from './triggers.js';

/** 装配选项（TUI 入口与诊断命令共用面——runtime 子面透传 createHostRuntime） */
export interface AssembleHostOptions {
  /** 运行时组装选项（dataDir/memory 组合形由此定形：memory+dataDir = 同构诊断形） */
  readonly runtime: Omit<HostRuntimeOptions, 'pluginsProvider'>;
  /** 安全模式（--no-plugins——装载面整跳） */
  readonly noPlugins: boolean;
  /** 日志提级（--debug——env 已设时让位律在件内执法） */
  readonly debug: boolean;
  /** 宿主版本（HostFace 物化位） */
  readonly version: string;
  /** 初始 provider 集（缺省真 provider 全家桶——与 TUI 入口同路） */
  readonly providers?: readonly Provider[];
  /** 模型标识（缺省 BERRY_AGENT_MODEL 覆盖律——栈内解析） */
  readonly model?: string;
  /** env 面（缺省 process.env——日志级解析与模型覆盖律同源） */
  readonly env?: Record<string, string | undefined>;
  /** 沙箱档位取值器（透传组合根） */
  readonly sandboxMode?: () => SandboxMode;
  /** 运行时组装后回调（信号/崩溃编舞切运行时本体——main attachRuntime） */
  readonly onRuntime?: (runtime: HostRuntime) => void;
  /** core: 官方件注册表（缺省空——15 件装载态集成挂批 12 装载面后装配批逐件入册） */
  readonly corePlugins?: readonly CorePluginReference[];
  /** 警示面（缺省 stderr 直写） */
  readonly warn?: (message: string) => void;
}

/** 装配失败档（crashed = 意外异常——crash.log 已写，调用方只呈报不取证） */
export interface AssemblyFailure {
  readonly ok: false;
  readonly exitCode: number;
  readonly message: string;
  readonly crashed: boolean;
}

/** 装配产物（六柄一匣——TUI 段与诊断命令各取所需） */
export interface AssemblySuccess {
  readonly ok: true;
  readonly runtime: HostRuntime;
  readonly logger: Logger;
  readonly dispatch: EventDispatch;
  readonly scope: ScopeType;
  readonly stack: ConversationStack;
  readonly boot: PluginBootHandle;
  /** 披露匣（boot.counts 已回写——运行时披露段每请求重算即见） */
  readonly pluginCounts: { total: number; enabled: number; failed: number };
}

/** 宿主装配序主入口（async——装载管线内含 jiti ESM 求值） */
export async function assembleHostStack(options: AssembleHostOptions): Promise<AssemblySuccess | AssemblyFailure> {
  // —— 装载披露计数匣（pluginsProvider 先于运行时组装接线——披露段每请求重算读匣）——
  const pluginCounts = { total: 0, enabled: 0, failed: 0 };
  let runtime: HostRuntime | undefined;
  try {
    // —— 运行时组装（单活跃机 + 开库 fail-loud——干净退出档，非崩溃取证档）——
    try {
      runtime = createHostRuntime({
        ...options.runtime,
        pluginsProvider: () => ({ ...pluginCounts }),
      });
    } catch (err) {
      return {
        ok: false,
        exitCode: 1,
        message: `启动失败：${err instanceof Error ? err.message : String(err)}`,
        crashed: false,
      };
    }
    options.onRuntime?.(runtime);

    // —— logger 装配：env 解析 + --debug 提级让位律（env 已设时让位）——
    const env = options.env ?? process.env;
    const logState = LogLevelState.fromEnv(env.BERRY_AGENT_LOG_LEVEL);
    if (options.debug && env.BERRY_AGENT_LOG_LEVEL === undefined) logState.setGlobalLevel('debug');
    const logger = createLogger('host', logState);

    // —— 跨会话 allowlist 装配期载入（04 §9 粘性第 3 款定形块读侧律——
    // dataDir 在场即真读〔含同构诊断形：报告真实装载会走到的路〕；纯 memory
    // 形 dataDir null 双缺〔无归属地〕。坏形 warn 降级 + 回写拒在 store 内执法）——
    const dataDir = runtime.dataDir;
    const allowlistLoad = dataDir !== null ? readAllowlist(dataDir, { warn: (m) => logger.warn(m) }) : null;

    // —— 共享根作用域与事件总线：对话栈与插件装载同根同源 ——
    const scope = Scope.createRoot();
    const dispatch = new EventDispatch();
    const stack = createConversationStack({
      runtime,
      scope,
      dispatch,
      ...(options.providers !== undefined ? { providers: options.providers } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.sandboxMode !== undefined ? { sandboxMode: options.sandboxMode } : {}),
      // 审批 always 回写透传（04 §9 定形块写侧律——闭包 dataDir 接 store
      // 文件写；坏形期拒写在 store 内执法，healthy 载入才接线）
      ...(allowlistLoad !== null
        ? {
            allowlist: allowlistLoad.entries,
            ...(dataDir !== null && allowlistLoad.healthy
              ? { persistAllowlist: (draft: AllowlistDraft) => void appendAllowlistEntry(dataDir, draft) }
              : {}),
          }
        : {}),
      warn: (message) => logger.warn(message),
    });

    // —— Job 注册表 + 触发器注册表（C 批 C-3——第十一动词宿主侧真源）：
    // job_settled 总线词先注册（活体事件发射前置——04 §10 内存直推不落库，
    // 幂等跳过已注册词）→ Job 注册表（trigger kind 自登 + 缺省并行帽 4）→
    // 服务面 provide（插件 tryGet('jobs') 消费）→ 触发器注册表（starter 真身
    // 工厂注入——活体开门读取源：/reload 撤位后 fire 复检现判现拒）——
    const jobs = createJobRegistry({
      parallelLimits: { trigger: TRIGGER_JOB_PARALLEL_LIMIT },
      emit: (event) => dispatch.emit('job_settled', event),
      warn: (message) => logger.warn(message),
    });
    jobs.registerKind('trigger');
    provideJobsService(scope, jobs);
    const readOpens = (pluginId: string) => readTriggerOpensLive(dataDir, pluginId);
    const triggers = new TriggerRegistry({
      getOpens: readOpens,
      makeStarter: createTriggerStarterFactory({
        stack,
        jobs,
        getOpens: readOpens,
        workspaceRoot: () => canonicalWorkspaceRoot(),
        warn: (message) => logger.warn(message),
      }),
    });

    // —— 子代理委派机器（D 批 D-2——第十二动词宿主侧真源）：kind 'subagent'
    // 构造自登（与 trigger 同表分立——词汇注册表纪律）；程序化注册面
    // （ctx.agent.registerSubagentProvider 受局面）两闸执法在件内。run 消费
    // 腿（in-process 真工厂 + 通知面/结算钩子桥）挂账装载态集成批——本批
    // 只接注册面（词法身份面 + 分域归因执法完整；notify 缺席档件内自 warn）
    const subagents = createSubagentService({
      registry: jobs,
      warn: (message) => logger.warn(message),
    });

    // —— 插件装载：启用清单损坏 fail-loud 属启动失败档（用户可自修配置错——
    // 干净退出不写 crash.log）；余装载失败走行级隔离不入本档 ——
    let boot: PluginBootHandle;
    try {
      boot = await bootPlugins({
        runtime,
        scope,
        dispatch,
        commands: stack.channels.commands,
        llm: stack.llmRuntime,
        triggers, // ctx.triggers.register 受局面（C 批——缺席时该动词响亮缺位）
        subagents, // ctx.agent.registerSubagentProvider 受局面（D 批 D-2——同上）
        noPlugins: options.noPlugins === true,
        version: options.version,
        ...(options.corePlugins !== undefined ? { corePlugins: options.corePlugins } : {}),
        warn: (message) => logger.warn(message),
      });
    } catch (err) {
      await runtime.shutdown(); // 已建资源先收口（幂等六步照走）
      if (err instanceof BaseError && err.code === 'PLUGIN_ROW_INVALID') {
        return {
          ok: false,
          exitCode: 1,
          message: `启动失败：${err.message}`,
          crashed: false,
        };
      }
      throw err; // 余异常走下方崩溃取证档
    }
    Object.assign(pluginCounts, boot.counts); // 披露匣回写（disclosure 后续请求即见）

    return { ok: true, runtime, logger, dispatch, scope, stack, boot, pluginCounts };
  } catch (err) {
    // 意外异常 = 崩溃取证档：crash.log 先写（memory 形内建跳过）→ 资源收口 → 归一失败档
    runtime?.writeCrashLog(err);
    await runtime?.shutdown();
    return {
      ok: false,
      exitCode: 1,
      message: err instanceof Error ? err.message : String(err),
      crashed: true,
    };
  }
}

/**
 * 触发器开门授予集活体读取（F10 定形——注册闸与 fire 复检共用源）：每次
 * 现读 enabled.yaml 现解析，/reload 撤位后下一次判即拒。
 *
 * **fail-closed 全失败档一律空集**（文件缺席/不可读/坏 yaml/行校验败/行被
 * 禁用/id 未装载）——与 boot 读侧 fail-loud（PLUGIN_ROW_INVALID 拒启）分立
 * 两律：boot 拦的是启动期配置错；此处拦的是运行期判面，**宁拒不误放**
 * （memory 形 dataDir null 亦空集——core: 官方件直开豁免不经本面）。
 */
export function readTriggerOpensLive(dataDir: string | null, pluginId: string): ReadonlySet<string> {
  if (dataDir === null) return new Set<string>();
  let text: string;
  try {
    text = readFileSync(enabledYamlPath(dataDir), 'utf8');
  } catch {
    return new Set<string>(); // 缺席/不可读 = 全默认关
  }
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch {
    return new Set<string>(); // 坏 yaml 宁拒不误放（启动期已 fail-loud——此处防御运行期二次写坏）
  }
  const result = parseEnabledRows(doc);
  if (!result.ok) return new Set<string>();
  const row = result.rows.find((r) => r.id === pluginId);
  if (row === undefined || row.disabled === true) return new Set<string>();
  return new Set<string>(row.opens ?? []);
}
