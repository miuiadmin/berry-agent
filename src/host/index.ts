/**
 * host 域公开面——装配根契约件收口（批 12a 契约先行笔）。
 *
 * host 是唯一可 import 全部宿主模块的横切装配层（02 §4.1 host 席；07 §1.1
 * 表 #10：装配序 + CLI 入口 + 插件装载器 + 生命周期工具族落位本域）。
 * 本笔（12a）只落契约面三件：PLUGIN_ 码族补落（codes）+ 插件清单/启用行
 * 拒绝式校验（manifest）+ CLI 解析面（cli——手写 argv 解析器，执法律五条）。
 * 后续笔：12b 装配序实装（11 模块组装 + dataDir 接线 + 单活跃机 + 退出序 +
 * environmentDisclosure 五件）→ 12c CLI 分派面 → 12d 装载器 jiti 实装
 * （import 门禁/库句柄门禁码名届时补落 codes）→ 12e TUI 入口装配。
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
export { createHostRuntime } from './runtime.js';
export type { HostRuntime, HostRuntimeOptions, HostCloser, ExitSequenceBudget } from './runtime.js';
