/**
 * host 域公开面——装配根契约件收口（批 12a 契约先行笔）。
 *
 * host 是唯一可 import 全部宿主模块的横切装配层（02 §4.1 host 席；07 §1.1
 * 表 #10：装配序 + CLI 入口 + 插件装载器 + 生命周期工具族落位本域）。
 * 本笔序：12a 契约面三件（PLUGIN_ 码族补落〔codes〕+ 插件清单/启用行拒绝式
 * 校验〔manifest〕+ CLI 解析面〔cli——手写 argv 解析器，执法律五条〕）→
 * 12b 装配序实装（运行时生命周期 + dataDir 接线 + 单活跃机 +
 * environmentDisclosure）→ 12c CLI 分派面（dispatch/signals/main bin）→
 * 12d 装载器 jiti 实装（import 门禁字面量腿〔03 §3.3 批 12d 勘正〕+ 虚拟
 * 面直注防双实例 + Kahn 轮次 + 失败三档 + boot-failures 记账；库句柄门禁
 * 码名已补落 codes——执法位随 SqliteFace 件消费）→ 12e TUI 入口装配。
 *
 * 单向 DAG：host → 全宿主模块（边表已预登记 24 deps；本笔实际触达
 * contracts 单边——契约笔不解包重件）。
 */
import './codes.js';

export { HOST_PLUGIN_ERROR_CODES } from './codes.js';
export { checkPluginId, parseManifest, parseEnabledRows, MANIFEST_KEY_CATALOG } from './manifest.js';
export type {
  PluginManifest,
  PluginEntryPlan,
  ManifestParseResult,
  ManifestValid,
  ManifestInvalid,
  EnabledRow,
  EnabledDoc,
  EnabledRowsResult,
} from './manifest.js';
export { parseCli } from './cli.js';
export type {
  CliCommand,
  CliParseResult,
  TuiFlags,
  RunFlags,
  ServeFlags,
  DumpConfigFlags,
  PluginsCommand,
  SessionsCommand,
} from './cli.js';
// 批 12b 装配序生命周期（单活跃机 + 开库 + 退出序六步编舞 + 披露段组装）
export { acquireActiveMarker, ACTIVE_MARKER_BASENAME } from './single-instance.js';
export type { ActiveMarkerRecord, ActiveMarkerLease, AcquireOptions } from './single-instance.js';
export { renderEnvironmentDisclosure, collectPlatform, collectDate } from './disclosure.js';
export type { DisclosureInputs } from './disclosure.js';
export { createHostRuntime, appendCrashLog } from './runtime.js';
export type { HostRuntime, HostRuntimeOptions, HostCloser, ExitSequenceBudget } from './runtime.js';
// 批 12c CLI 分派面（退出码三态 + 非 TTY 卫兵 + help/version 短路）与进程编舞
export { dispatchCli, HELP_TEXT } from './dispatch.js';
export type { CommandHandlers, DispatchEnv } from './dispatch.js';
export { installSignalChoreography, installCrashChoreography } from './signals.js';
export type { SignalChoreographyOptions, CrashChoreographyOptions } from './signals.js';
// 批 12d 装载器 jiti 实装（import 门禁字面量腿 + 虚拟面直注 + Kahn 轮次 + 失败三档）
export { VIRTUAL_KEYS, checkImportSpecifier, extractImportSpecifiers, createGateTransform } from './import-gate.js';
export type { ImportGateContext, GateTransformOptions } from './import-gate.js';
export { loadPlugins, CorePluginBootError } from './loader.js';
export type {
  CorePluginReference,
  DiskPluginSpec,
  CorePluginSpec,
  LoaderPlanRow,
  ServiceBag,
  LoadPluginJitiOptions,
  LoadPluginsOptions,
  ActivatedPlugin,
  FailedPlugin,
  LoadReport,
} from './loader.js';
export { readBootFailures, recordBootFailure, clearBootFailure } from './boot-failures.js';
export type { BootFailureEntry, BootFailureDoc, BootFailuresFs } from './boot-failures.js';
// 批 12e TUI 入口装配（对话栈组合根——五层一次成型 + 启动会话策略）
export { createConversationStack } from './conversation-stack.js';
export type { ConversationStackOptions, ConversationStack, StartupSession } from './conversation-stack.js';
export { runTuiEntry } from './tui-entry.js';
export type { TuiEntryOptions } from './tui-entry.js';
// 批 12f-2a ctx 面件（提示词段注册表 + 插件上下文装配件——窗口律/频率护栏/钩子路由）
export { PromptSectionRegistry } from './prompt-sections.js';
export type { PromptSectionBuilder, PromptSectionEntry } from './prompt-sections.js';
export { createPluginContext, PLUGIN_HOOK_VOCABULARY } from './plugin-context.js';
export type {
  PluginContext,
  PluginContextHandle,
  PluginContextOptions,
  PluginHookSpec,
  PluginHookHandler,
  HookMode,
  ProviderInput,
  HookTimeoutReporter,
  CommandRegistryLike,
} from './plugin-context.js';
// 批 12f-2b 插件装载装配序（enabled.yaml 读侧两律 + core overlay + 装机账本
// installPath 解析 + --no-plugins 短路 + 生命周期事件批量补发 + closer 回卷）
export { bootPlugins } from './plugin-boot.js';
export type { PluginBootOptions, PluginBootHandle, PluginBootCounts, PluginBootFs } from './plugin-boot.js';
// 批 12f-2c webui 开面装配桥 + 批 18a-3' 三入口咬合共用挂载段（--port 旗标
// 消费 + 三窄面映射 + token 披露 + daemon face 挂载位）
export { openWebuiFace, mountWebuiOnFace } from './webui-bridge.js';
export type {
  WebuiBridgeOptions,
  WebuiBridgeHandle,
  WebuiOpenInfo,
  WebuiFaceMountOptions,
  WebuiFaceMount,
} from './webui-bridge.js';
// 批 12f-3 装配序公共段（:memory: 同构纪律防侧门件——TUI 与诊断命令唯一装配序真源）
export { assembleHostStack } from './assembly.js';
export type { AssembleHostOptions, AssemblySuccess, AssemblyFailure } from './assembly.js';
// 批 12f-4 跨会话 allowlist 文件读写件（04 §9 粘性第 3 款定形块装配侧执法）
export { readAllowlist, appendAllowlistEntry, ALLOWLIST_BASENAME } from './allowlist-store.js';
export type { AllowlistLoad, ReadAllowlistOptions, AllowlistAppendResult } from './allowlist-store.js';
// 批 12f-3 dump-config / plugins 子命令族（同构诊断命令 + 装载态清单 + 纯只读体检骨架）
export { runDumpConfigEntry } from './dump-config.js';
export type { DumpConfigEntryOptions } from './dump-config.js';
export { runPluginsEntry } from './plugins-cmd.js';
export type { PluginsEntryOptions } from './plugins-cmd.js';
