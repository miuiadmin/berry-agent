/**
 * host/loader — 插件装载管线（03 §1.3/§1.4/§3/§5.7；批 12d）。
 *
 * 装载序 = 服务可用性驱动的 Kahn 轮次（§1.3「inject 求值后服务缺席即拒启」
 * 的排序真源）：逐行扫描，inject ⊆ 现行服务集者装载——apply 期间 ctx.provide
 * 落新服务，后续轮次自然解锁依赖方；不动点余行 = inject 不可达（用户行
 * 隔离降级 PLUGIN_INJECT_UNRESOLVED，core: 行 fail-loud 拒启——狗粮纪律）。
 *
 * 双轨装载（§1.4）：core: 官方引用形对象直调 apply（零 jiti 零门禁——同仓
 * 同版本）；用户插件磁盘装载——jiti 实例（virtualModules 宿主面直注〔防双
 * 实例〕+ import 门禁字面量腿〔transform throw 形 + fsCache 关——03 §3.3
 * 批 12d 勘正〕+ interop default）。入口解析序三态承 manifest 件（12a）：
 * entry-file / 纯声明包（零码装载）/ default-export（包主入口）。
 *
 * 失败三档（§5.7）：① 清单校验失败拒换——归调用方（parseEnabledRows 先行）；
 * ② 用户行装载失败 = 行级隔离降级——onBootFailure 记账（boot-failures 件
 * 接线位）+ 其余行照常；③ disposer 回卷失败 = 降级存活（unload 聚合报告）。
 * core: 行装载失败 = fail-loud 抛（已活行 LIFO 回卷后不留半装配）。
 *
 * 时钟（§3.4）：apply 10s / 插件 disposer 回卷 1s——超时按失败处置不悬挂。
 * ctx 面归调用方（createContext 注入——泛型 TCtx；注册动词族/服务目录随
 * conversation/TUI 装配批定形）。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJiti } from 'jiti';
import type { Jiti, TransformOptions, TransformResult } from 'jiti';
import { Value } from 'typebox/value';

import { BaseError } from '../contracts/index.js';

import { createGateTransform } from './import-gate.js';
import type { PluginManifest } from './manifest.js';
import { withTimeout } from './runtime.js';

/** 官方引用形（03 §1.4——宿主函数引用注册表成员；apply 直调零 jiti） */
export interface CorePluginReference {
  /** 官方件名（core: 前缀身份标记） */
  readonly name: string;
  readonly inject?: readonly string[];
  readonly optionalInject?: readonly string[];
  /** 宿主侧默认 config（启用行 config 缺席时用） */
  readonly config?: unknown;
  readonly events?: readonly string[];
  readonly skills?: readonly string[];
  readonly apply: (ctx: unknown, config?: unknown) => Promise<void | (() => void)>;
}

/** 计划行公共面（id/config/disabled——自启用行与 core: 注册表合流） */
interface PlanRowBase {
  readonly id: string;
  readonly config?: unknown;
  readonly disabled?: boolean;
}

/** 磁盘插件计划行（用户插件——jiti 装载） */
export interface DiskPluginSpec extends PlanRowBase {
  readonly kind: 'disk';
  /** 12a 清单校验产物（ok:true 面） */
  readonly manifest: PluginManifest;
  /** 装机树内插件目录（entry 解析基 + 门禁树根） */
  readonly pluginDir: string;
  /**
   * inject 预收割位（可选）：磁盘插件的 inject 声明在入口模块（装载期才可
   * 求值）——排序位用此预收割面（install 期收割缓存，§5.4 同族）；缺席视
   * 零 inject 排序，模块内 inject 的真实执法在装载步（两段式：排序位尽力、
   * 装载位执法）。
   */
  readonly inject?: readonly string[];
}

/** core: 官方引用形计划行 */
export interface CorePluginSpec extends PlanRowBase {
  readonly kind: 'core';
  readonly reference: CorePluginReference;
}

export type LoaderPlanRow = DiskPluginSpec | CorePluginSpec;

/** 服务袋（ctx.provide/get 的装载侧投影——Kahn 轮次的可用性真源） */
export interface ServiceBag {
  get(name: string): unknown | undefined;
  provide(name: string, value: unknown): void;
}

/** jiti 组装面（jitiFactory 注入参数——测试替身据此还原门禁件） */
export interface LoadPluginJitiOptions {
  readonly virtualModules: Readonly<Record<string, unknown>>;
  readonly transform: (opts: TransformOptions) => TransformResult;
}

/** 装载选项（ctx 面与 jiti 面全注入——泛型 TCtx 归调用方定形） */
export interface LoadPluginsOptions<TCtx = unknown> {
  readonly plan: readonly LoaderPlanRow[];
  readonly services: ServiceBag;
  /** 逐插件 ctx 构造（apply 第一参——注册动词族面随装配批充实） */
  readonly createContext: (pluginId: string) => TCtx;
  /**
   * jiti 虚拟面注入（防双实例直注）。缺省 = 宿主四键 lazy 直注：
   * berry-agent 主键（contracts 公开面）+ typebox 三键；berry-agent/llm 与
   * berry-agent/sqlite 随其 face 件落码批接入（缺席键的 import 落自然
   * 解析失败 = fail-closed）。
   */
  readonly virtualFaces?: Readonly<Record<string, unknown>>;
  /** apply 时钟帽（§3.4 钉 10s；测试位可调） */
  readonly applyBudgetMs?: number;
  /** 插件 disposer 回卷帽（§3.4 钉 1s；测试位可调） */
  readonly disposerBudgetMs?: number;
  /** 档②记账接线位（boot-failures 件；缺席 = 不记账） */
  readonly onBootFailure?: (id: string, version: string) => void;
  /** jiti 工厂注入位（测试替身；缺省 = 真门禁真虚拟面 jiti） */
  readonly jitiFactory?: (pluginDir: string, opts: LoadPluginJitiOptions) => Jiti;
}

/** 激活行（skills 随行——纯声明包的零码激活产物） */
export interface ActivatedPlugin {
  readonly id: string;
  readonly skills: readonly string[];
}

/** 失败行（码身份 + 报文——启动横幅/boot-failures 的载荷） */
export interface FailedPlugin {
  readonly id: string;
  readonly code: string;
  readonly message: string;
}

/** 装载报告（档②聚合面 + unload 回卷柄〔档③降级存活〕） */
export interface LoadReport {
  readonly activated: readonly ActivatedPlugin[];
  readonly failed: readonly FailedPlugin[];
  readonly skipped: readonly { id: string; reason: string }[];
  /** LIFO 回卷全部已活行（幂等；单 disposer 帽 1s；失败聚合不炸——档③） */
  readonly unload: () => Promise<{
    disposed: readonly string[];
    failed: readonly { id: string; error: unknown }[];
  }>;
}

/** core: 行 fail-loud 抛形（已活行已 LIFO 回卷——不留半装配） */
export class CorePluginBootError extends BaseError {
  constructor(
    readonly failure: FailedPlugin,
    options?: { cause?: unknown },
  ) {
    super(failure.code, `core: 官方件装载失败拒启（${failure.id}）：${failure.message}`, options);
  }
}

/** 磁盘模块装载产物（入口 named exports——§1.3 契约形） */
interface PluginModule {
  readonly default: unknown;
  readonly inject?: readonly string[];
  readonly optionalInject?: readonly string[];
  readonly events?: readonly string[];
}

/**
 * 装载管线主入口（async——jiti ESM 求值 + 虚拟面 lazy 直注）。
 */
export async function loadPlugins<TCtx = unknown>(options: LoadPluginsOptions<TCtx>): Promise<LoadReport> {
  const applyBudgetMs = options.applyBudgetMs ?? 10_000;
  const disposerBudgetMs = options.disposerBudgetMs ?? 1_000;
  const virtualFaces = options.virtualFaces ?? (await loadDefaultVirtualFaces());
  const activated: ActivatedPlugin[] = [];
  const failed: FailedPlugin[] = [];
  const skipped: { id: string; reason: string }[] = [];
  // 回卷栈：依激活序入栈——unload LIFO 全序（§5.7 档③）
  const disposeStack: Array<{ id: string; fn: () => void | Promise<void> }> = [];
  let unloaded = false;

  const pending: LoaderPlanRow[] = [];
  for (const row of options.plan) {
    if (row.disabled) skipped.push({ id: row.id, reason: 'disabled（启用行禁用位）' });
    else pending.push(row);
  }

  // Kahn 轮次：每轮取首条 inject 可满足行装载（apply 落新服务解锁后续轮）
  while (pending.length > 0) {
    const index = pending.findIndex((row) => injectOf(row).every((name) => options.services.get(name) !== undefined));
    if (index === -1) break; // 不动点——余行 inject 不可达
    const [row] = pending.splice(index, 1) as [LoaderPlanRow];
    try {
      await loadRow(row, { options, virtualFaces, applyBudgetMs, disposeStack, activated });
    } catch (err) {
      const failure = toFailure(row.id, err);
      if (row.kind === 'core') {
        // core: fail-loud 拒启——已活行 LIFO 回卷后抛（不留半装配）
        await rollback(disposeStack, disposerBudgetMs);
        throw new CorePluginBootError(failure, { cause: err });
      }
      failed.push(failure); // 用户行隔离降级——其余行照常（档②）
      options.onBootFailure?.(row.id, row.manifest?.version ?? '');
    }
  }
  // 不动点余行：inject 不可达（含环——环成员互等永不满足）
  for (const row of pending.splice(0)) {
    const missing = injectOf(row).filter((name) => options.services.get(name) === undefined);
    const failure: FailedPlugin = {
      id: row.id,
      code: 'PLUGIN_INJECT_UNRESOLVED',
      message: `硬依赖服务不可达：${missing.length > 0 ? missing.join('、') : '（环依赖）'}`,
    };
    if (row.kind === 'core') {
      await rollback(disposeStack, disposerBudgetMs);
      throw new CorePluginBootError(failure);
    }
    failed.push(failure);
    options.onBootFailure?.(row.id, row.manifest.version ?? '');
  }

  return {
    activated,
    failed,
    skipped,
    unload: async () => {
      if (unloaded) return { disposed: [], failed: [] }; // 幂等
      unloaded = true;
      const disposed: string[] = [];
      const unloadFailed: { id: string; error: unknown }[] = [];
      while (disposeStack.length > 0) {
        const item = disposeStack.pop() as { id: string; fn: () => void | Promise<void> };
        try {
          await withTimeout(Promise.resolve(item.fn()), disposerBudgetMs, `disposer ${item.id}`);
          disposed.push(item.id);
        } catch (err) {
          // 档③降级存活——聚合报告不炸
          unloadFailed.push({ id: item.id, error: err });
        }
      }
      return { disposed, failed: unloadFailed };
    },
  };
}

/** 单行装载（行内失败上抛——由调用侧分档处置） */
async function loadRow<TCtx>(
  row: LoaderPlanRow,
  state: {
    options: LoadPluginsOptions<TCtx>;
    virtualFaces: Readonly<Record<string, unknown>>;
    applyBudgetMs: number;
    disposeStack: Array<{ id: string; fn: () => void | Promise<void> }>;
    activated: ActivatedPlugin[];
  },
): Promise<void> {
  const { options, applyBudgetMs } = state;
  const ctx = options.createContext(row.id);
  const config = row.kind === 'core' ? (row.config !== undefined ? row.config : row.reference.config) : row.config;

  if (row.kind === 'core') {
    // §1.4 直调轨：零 jiti 零门禁；其余契约（时钟/回卷）与磁盘插件同轨
    await invokeApply(row.id, row.reference.apply, ctx, config, applyBudgetMs, state.disposeStack);
    state.activated.push({ id: row.id, skills: [...(row.reference.skills ?? [])] });
    return;
  }

  // 磁盘轨：行 config 先过清单形状（§1.2——值校验归装载器）
  validateRowConfig(row, config);

  // 纯声明包（entryPlan 三态之一）：零码装载——技能清单随行激活
  if (row.manifest.entryPlan.kind === 'declared-payload') {
    state.activated.push({ id: row.id, skills: [...(row.manifest.skills ?? [])] });
    return;
  }

  const module = await loadDiskModule(row, state.options.jitiFactory, state.virtualFaces);
  const apply = module.default;
  if (typeof apply !== 'function') {
    throw new BaseError('PLUGIN_SHAPE_INVALID', `入口 default export 缺席或非函数（插件 ${row.id}）`);
  }
  // 模块内 inject 执法（装载位——两段式的执法腿）：硬依赖缺席拒启
  const missing = (module.inject ?? []).filter((name) => options.services.get(name) === undefined);
  if (missing.length > 0) {
    throw new BaseError('PLUGIN_INJECT_UNRESOLVED', `硬依赖服务不可达（模块声明）：${missing.join('、')}`);
  }
  await invokeApply(
    row.id,
    apply as (ctx: unknown, config?: unknown) => Promise<void | (() => void)>,
    ctx,
    config,
    applyBudgetMs,
    state.disposeStack,
  );
  state.activated.push({ id: row.id, skills: [...(row.manifest.skills ?? [])] });
}

/** 磁盘模块装载（jiti 轨——入口解析三态的文件级落点） */
async function loadDiskModule(
  row: DiskPluginSpec,
  jitiFactory: LoadPluginsOptions['jitiFactory'],
  virtualFaces: Readonly<Record<string, unknown>>,
): Promise<PluginModule> {
  const faces = { ...virtualFaces }; // 面快照（本插件 jiti 实例的直注集）
  const opts: LoadPluginJitiOptions = {
    virtualModules: faces,
    transform: createGateTransform({ pluginId: row.id, pluginDir: row.pluginDir }),
  };
  const jiti =
    jitiFactory?.(row.pluginDir, opts) ??
    createJiti(join(row.pluginDir, 'package.json'), {
      virtualModules: faces,
      transform: opts.transform,
      interopDefault: true,
      moduleCache: true,
      fsCache: false, // 门禁身份不入缓存键——缓存命中即跳过 transform 穿门（03 §3.3 勘正）
    });
  const entryId =
    row.manifest.entryPlan.kind === 'entry-file'
      ? join(row.pluginDir, row.manifest.entryPlan.entry)
      : join(row.pluginDir, resolvePkgMain(row.pluginDir));
  let namespace: Record<string, unknown>;
  try {
    namespace = (await jiti.import(entryId)) as Record<string, unknown>;
  } catch (err) {
    throw mapJitiError(row.id, err);
  }
  return {
    default: namespace.default,
    inject: asStringArray(namespace.inject, row.id, 'inject'),
    optionalInject: asStringArray(namespace.optionalInject, row.id, 'optionalInject'),
    events: asStringArray(namespace.events, row.id, 'events'),
  };
}

/**
 * 缺省虚拟面四键（宿主模块对象直注——防双实例）。
 *
 * typebox 三键 = 宿主进程同一份（插件经虚拟键拿到的 Type/Value/Compile 与
 * 宿主共用模块实例——Kind 符号失配结构性不可能）；berry-agent 主键 =
 * contracts 公开面。/llm·/sqlite 键随其 face 件落码批接入。
 */
async function loadDefaultVirtualFaces(): Promise<Record<string, unknown>> {
  const [contracts, typebox, typeboxValue, typeboxCompile] = await Promise.all([
    import('../contracts/index.js'),
    import('typebox'),
    import('typebox/value'),
    import('typebox/compile'),
  ]);
  return {
    'berry-agent': contracts,
    typebox,
    'typebox/value': typeboxValue,
    'typebox/compile': typeboxCompile,
  };
}

/** jiti 错误映射（三码分流：门禁拒 / 入口不可达 / 装载失败） */
function mapJitiError(pluginId: string, err: unknown): BaseError {
  const message = err instanceof Error ? err.message : String(err);
  if (err instanceof BaseError && err.code === 'PLUGIN_IMPORT_FORBIDDEN') return err; // 字面量腿原样透传
  if (message.includes('PLUGIN_IMPORT_FORBIDDEN')) {
    // 兜底腿毒丸（裸 Error 码前缀形——毒丸经 jiti eval 不得 import 宿主面）
    return new BaseError('PLUGIN_IMPORT_FORBIDDEN', `[${pluginId}] ${message}`, { cause: err });
  }
  if (message.includes('Cannot find module') || (err as { code?: string }).code === 'MODULE_NOT_FOUND') {
    return new BaseError('PLUGIN_ENTRY_UNRESOLVED', `入口模块解析失败（插件 ${pluginId}）：${message}`, {
      cause: err,
    });
  }
  return new BaseError('PLUGIN_LOAD_FAILED', `jiti 装载失败（插件 ${pluginId}）：${message}`, { cause: err });
}

/** apply 三态包装：时钟帽 + disposer 收栈 + 错误归一 PLUGIN_APPLY_FAILED */
async function invokeApply(
  id: string,
  apply: (ctx: unknown, config?: unknown) => Promise<void | (() => void)>,
  ctx: unknown,
  config: unknown,
  applyBudgetMs: number,
  disposeStack: Array<{ id: string; fn: () => void | Promise<void> }>,
): Promise<void> {
  let returned: unknown;
  try {
    // 时钟帽包裹（返回值经闭包捕获——withTimeout 面 Promise<void>）
    await withTimeout(
      Promise.resolve(apply(ctx, config)).then((r) => {
        returned = r;
      }),
      applyBudgetMs,
      `apply ${id}`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new BaseError('PLUGIN_APPLY_FAILED', `apply 抛错/超时（插件 ${id}，帽 ${applyBudgetMs}ms）：${message}`, {
      cause: err,
    });
  }
  if (typeof returned === 'function') {
    disposeStack.push({ id, fn: returned as () => void | Promise<void> }); // 激活序入栈——unload LIFO
  }
}

/** 磁盘行 config 形状执法（§1.2——typebox JSON Schema 同判据） */
function validateRowConfig(row: DiskPluginSpec, config: unknown): void {
  const schema = row.manifest.config;
  if (schema === undefined) {
    if (config !== undefined) {
      throw new BaseError('PLUGIN_CONFIG_INVALID', `行 config 在场而清单未声明形状（插件 ${row.id}）——形状声明先行`);
    }
    return;
  }
  try {
    if (!Value.Check(schema as never, config as never)) {
      const first = [...Value.Errors(schema as never, config as never)]
        .slice(0, 3)
        .map((e) => e.message)
        .join('；');
      throw new BaseError(
        'PLUGIN_CONFIG_INVALID',
        `行 config 不合清单形状（插件 ${row.id}）：${first || '校验不通过'}`,
      );
    }
  } catch (err) {
    if (err instanceof BaseError) throw err;
    throw new BaseError(
      'PLUGIN_CONFIG_INVALID',
      `清单 config 形状自身坏形（插件 ${row.id}）：${err instanceof Error ? err.message : String(err)}`,
      {
        cause: err,
      },
    );
  }
}

/** 包主入口解析（default-export 态：package.json main；缺省 index.js） */
function resolvePkgMain(pluginDir: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8')) as { main?: string };
    return pkg.main !== undefined && pkg.main.length > 0 ? pkg.main : 'index.js';
  } catch {
    return 'index.js'; // package.json 不可读——入口解析交给 jiti 失败红（ENTRY_UNRESOLVED）
  }
}

/** named export 字符串数组形执法（坏形 = 形状违例） */
function asStringArray(value: unknown, id: string, field: string): readonly string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new BaseError('PLUGIN_SHAPE_INVALID', `入口 named export ${field} 须字符串数组（插件 ${id}）`);
  }
  return value as readonly string[];
}

/** 行 inject 面（排序位）：core: 注册表声明 / 磁盘行预收割位（两段式——装载位另执法） */
function injectOf(row: LoaderPlanRow): readonly string[] {
  return row.kind === 'core' ? (row.reference.inject ?? []) : (row.inject ?? []);
}

/** 不动点回卷（core: fail-loud 前置清场——已活行 LIFO） */
async function rollback(
  disposeStack: Array<{ id: string; fn: () => void | Promise<void> }>,
  disposerBudgetMs: number,
): Promise<void> {
  while (disposeStack.length > 0) {
    const item = disposeStack.pop() as { id: string; fn: () => void | Promise<void> };
    try {
      await withTimeout(Promise.resolve(item.fn()), disposerBudgetMs, `disposer ${item.id}`);
    } catch {
      // 清场路径静默——主错误（拒启因由）才是呈报面
    }
  }
}

/** 失败归一（BaseError 直取码身份；裸错误归 PLUGIN_LOAD_FAILED 位） */
function toFailure(id: string, err: unknown): FailedPlugin {
  if (err instanceof BaseError) return { id, code: err.code, message: err.message };
  return { id, code: 'PLUGIN_LOAD_FAILED', message: err instanceof Error ? err.message : String(err) };
}
