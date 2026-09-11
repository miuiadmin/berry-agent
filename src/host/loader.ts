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
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJiti } from 'jiti';
import type { Jiti, TransformOptions, TransformResult } from 'jiti';

import { BaseError } from '../contracts/index.js';
import { providerApiFace } from '../llm/index.js';

import { synthesizePluginConfig, type ConfigField } from './config-schema.js';
import { createGateTransform } from './import-gate.js';
import type { PluginManifest } from './manifest.js';
import { withoutSessionAnchor } from './session-anchor.js';
import { withTimeout } from './runtime.js';

/** 官方引用形（03 §1.4——宿主函数引用注册表成员；apply 直调零 jiti） */
export interface CorePluginReference {
  /** 官方件名（core: 前缀身份标记） */
  readonly name: string;
  readonly inject?: readonly string[];
  readonly optionalInject?: readonly string[];
  /** 宿主侧默认 config（启用行 config 缺席时用） */
  readonly config?: unknown;
  /**
   * 配置字段声明面（ix-3——03 §1.2 configSchema）：core: 件类型化真身，
   * TS 保证形状；磁盘轨经 parseManifest 深校验同判据（03 §1.4 形状同轨）。
   */
  readonly configSchema?: readonly ConfigField[];
  readonly events?: readonly string[];
  readonly skills?: readonly string[];
  /** 声明式子代理目录清单（03 §6.3——与 skills 同形；core 行声明基 = 宿主包根） */
  readonly agents?: readonly string[];
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
   * 高危面开门授予位（03 §4.6 批 U2 读侧透传——启用行 opens 直通，值域已过
   * 行校验）：消费位 = 装载步构造 ctx 时的开门授予集（grantedOpens）。**只在
   * 磁盘插件计划行**——core: 行读侧已拒 opens（官方件窄面注入不走开门位），
   * PlanRowBase 不设此位即结构性保证。
   */
  readonly opens?: readonly string[];
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
  /**
   * 逐插件 ctx 构造（apply 第一参——注册动词族面随装配批充实）。第二参 =
   * 高危面开门授予集（03 §4.6 批 U2——**磁盘行 opens 透传**，core: 行结构性
   * 缺席 = undefined；装配侧据此构造 handle 门检面）。缺省可忽略（不消费
   * 开门制的调用方照旧只取第一参）。
   */
  readonly createContext: (pluginId: string, opens?: readonly string[]) => TCtx;
  /**
   * jiti 虚拟面注入（防双实例直注）。缺省 = 宿主五键 lazy 直注：
   * berry-agent 主键（contracts 公开面）+ typebox 三键 + berry-agent/llm
   * （providerApiFace——eco-1 接线）；berry-agent/sqlite 随 persist SqliteFace
   * 落码批接入（缺席键的 import 落自然解析失败 = fail-closed）。
   */
  readonly virtualFaces?: Readonly<Record<string, unknown>>;
  /** apply 时钟帽（§3.4 钉 10s；测试位可调） */
  readonly applyBudgetMs?: number;
  /** 插件 disposer 回卷帽（§3.4 钉 1s；测试位可调） */
  readonly disposerBudgetMs?: number;
  /** 档②记账接线位（boot-failures 件；缺席 = 不记账） */
  readonly onBootFailure?: (id: string, version: string) => void;
  /**
   * 逐插件行收口回调（finally 语义——成功/失败/零码行皆达）。
   * 装载窗口关窗接线位（03 §2.1）：apply 收口即关窗，此后该插件注册动词仅
   * 回调窗内合法——装配批（12f-2b）以 ctx 面件 handle 表消费本回调。
   */
  readonly onApplySettled?: (pluginId: string) => void;
  /** 软依赖缺席 warn 落点（03 §1.3「缺席仅记 warn」；缺席 = 不记）——secret 诊断豁免提示行同落点 */
  readonly warn?: (message: string) => void;
  /**
   * 插件配置 secret 读面（ix-3——03 §1.2 合成序⑤）：装载合成时宿主从凭证盒
   * 直取 plugin:<id> 域 config:<key>；缺席 = secret 恒缺席，required secret
   * 拒载照常（:memory: 诊断形另走 allowMissingRequiredSecret 豁免）。
   */
  readonly getConfigSecret?: (pluginId: string, key: string) => string | undefined;
  /**
   * required-secret 诊断豁免（07 §5 dump-config :memory: 同构纪律——凭证盒
   * 结构性恒空，required secret 缺席降级 warn 提示行装载照走；真实装载形
   * 不传 = 缺席拒载照常）。
   */
  readonly allowMissingRequiredSecret?: boolean;
  /** jiti 工厂注入位（测试替身；缺省 = 真门禁真虚拟面 jiti） */
  readonly jitiFactory?: (pluginDir: string, opts: LoadPluginJitiOptions) => Jiti;
}

/**
 * 激活行（skillDirs/agentDirs 随行——mount 即收集的装载侧面，03 §6.1/§6.3）：
 * 声明是相对包根的目录路径（磁盘行 manifest / core 行 reference 同形），装载位
 * 在此解析为绝对路径并过包根包含执法——磁盘行基 = pluginDir（装机树内插件
 * 目录）、core 行基 = 宿主包根（本模块上推两级——与 skills 件
 * resolveFactorySkillsDir 同法双形态同构）。消费位：skills = 装配根补注册
 * 编舞（06 §11.4 位 4）；agents = 物化消费腿挂账 core:subagent 消费批
 * （生态启动批 eco-1 收集先行——立题档 20260911 §七风险段预授权裁决点 C
 * 消费腿降档，冷读闸把关确认）。
 */
export interface ActivatedPlugin {
  readonly id: string;
  readonly skillDirs: readonly string[];
  readonly agentDirs: readonly string[];
}

/**
 * 声明载荷目录解析 + 包根包含执法（生态启动批 eco-1——pi 反面实证：pi-lens
 * 声明 `"skills": ["../../skills"]` 裸 resolve 逃逸包根仍被装载）。resolve
 * 归一后须等于基或以 `<base>/` 开头（同 isWithinRoots 谓词形——port.ts/
 * skills manage 同律）；违例抛 PLUGIN_SHAPE_INVALID（磁盘行折失败行隔离降级）。
 */
function resolveDeclaredDirs(dirs: readonly string[] | undefined, base: string, pluginId: string): readonly string[] {
  return (dirs ?? []).map((dir) => {
    const abs = resolve(base, dir);
    if (abs !== base && !abs.startsWith(base + sep)) {
      throw new BaseError(
        'PLUGIN_SHAPE_INVALID',
        `声明载荷目录逃逸装载基（插件 ${pluginId}：${dir} 解析为 ${abs}、出界基 ${base}——须相对包根内路径）`,
      );
    }
    return abs;
  });
}

/** core: 行声明基（宿主包根——src/host 与 dist/host 双形态上推两级皆包根） */
const hostPackageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

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
  try {
    // 开门授予集只随磁盘行透传（core: 行无 opens 位——读侧已拒，结构性保证）
    const ctx = options.createContext(row.id, row.kind === 'disk' ? row.opens : undefined);
    // 装载位配置合成（ix-3——03 §1.2 合成序）：configSchema 缺席 = 行为零变化
    // （原值直传零校验——双轨同判）；在场 = 行 config 整值覆盖宿主默认 → 字段级
    // 校验 → default 兜底 → secret 凭证直取 → 未声明键透传。磁盘轨宿主默认
    // 回落 = 清单 config 键（schema/值分键后值单源；旧「config 当 typebox
    // schema 消费」路径已拆）；core 轨 = 引用形 config 位（既有回落不变）。
    const defaultConfig = row.kind === 'core' ? row.reference.config : row.manifest.config;
    const config = synthesizePluginConfig({
      pluginId: row.id,
      ...(row.kind === 'core'
        ? row.reference.configSchema !== undefined && { fields: row.reference.configSchema }
        : row.manifest.configSchema !== undefined && { fields: row.manifest.configSchema }),
      ...(row.config !== undefined && { rowConfig: row.config }),
      ...(defaultConfig !== undefined && { defaultConfig }),
      ...(options.getConfigSecret !== undefined && {
        getSecret: (key: string) => options.getConfigSecret?.(row.id, key),
      }),
      ...(options.allowMissingRequiredSecret === true && { allowMissingRequiredSecret: true }),
      ...(options.warn !== undefined && { warn: options.warn }),
    });

    if (row.kind === 'core') {
      // §1.4 直调轨：零 jiti 零门禁；其余契约（时钟/回卷）与磁盘插件同轨
      warnMissingOptional(row.id, row.reference.optionalInject, state);
      await invokeApply(row.id, row.reference.apply, ctx, config, applyBudgetMs, state.disposeStack);
      // core 行声明基 = 宿主包根（06 §11.6 位 6 注记：core: 件出厂内容经位 4
      // 声明即达——官方件技能/agents 从属资源与磁盘件同形同律）
      state.activated.push({
        id: row.id,
        skillDirs: resolveDeclaredDirs(row.reference.skills, hostPackageRoot, row.id),
        agentDirs: resolveDeclaredDirs(row.reference.agents, hostPackageRoot, row.id),
      });
      return;
    }

    // 磁盘轨：行 config 形状执法已随 typebox 旧路径拆除（ix-3——行 config
    // 须对象在 readEnabledRows 行校验层；字段级校验/secret 明文拒在上方
    // 合成步统一执法——configSchema 缺席时零变化原值直传）

    // 纯声明包（entryPlan 三态之一）：零码装载——声明载荷清单随行激活（相对
    // pluginDir 解析 + 包根包含执法；skills/agents 任一缺席 = 该清单空数组）
    if (row.manifest.entryPlan.kind === 'declared-payload') {
      state.activated.push({
        id: row.id,
        skillDirs: resolveDeclaredDirs(row.manifest.skills, row.pluginDir, row.id),
        agentDirs: resolveDeclaredDirs(row.manifest.agents, row.pluginDir, row.id),
      });
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
    warnMissingOptional(row.id, module.optionalInject, state);
    await invokeApply(
      row.id,
      apply as (ctx: unknown, config?: unknown) => Promise<void | (() => void)>,
      ctx,
      config,
      applyBudgetMs,
      state.disposeStack,
    );
    state.activated.push({
      id: row.id,
      skillDirs: resolveDeclaredDirs(row.manifest.skills, row.pluginDir, row.id),
      agentDirs: resolveDeclaredDirs(row.manifest.agents, row.pluginDir, row.id),
    });
  } finally {
    // 行收口即关窗（finally 语义——成功/失败/零码行皆达；03 §2.1 装载窗口）
    options.onApplySettled?.(row.id);
  }
}

/**
 * 软依赖缺席 warn（03 §1.3「缺席仅记 warn、注入值 undefined」——诚实降级
 * 不拒启）。逐名点名：present 名不记、全 present 不记、warn 落点缺席不记。
 */
function warnMissingOptional(
  pluginId: string,
  names: readonly string[] | undefined,
  state: { options: LoadPluginsOptions<unknown> },
): void {
  if (names === undefined || names.length === 0 || state.options.warn === undefined) return;
  const missing = names.filter((name) => state.options.services.get(name) === undefined);
  if (missing.length > 0) {
    state.options.warn(`插件 ${pluginId} 软依赖缺席（注入值 undefined——诚实降级）：${missing.join('、')}`);
  }
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
 * 缺省虚拟面五键（宿主模块对象直注——防双实例）。
 *
 * typebox 三键 = 宿主进程同一份（插件经虚拟键拿到的 Type/Value/Compile 与
 * 宿主共用模块实例——Kind 符号失配结构性不可能）；berry-agent 主键 =
 * contracts 公开面；berry-agent/llm 键 = llm/provider-face 的 providerApiFace
 * （生态启动批 eco-1 接线——face 件/API 注册表/surface 三处早已在册而装载
 * 注入缺席，provider 插件装载必炸于模块解析的三读分叉收口）。
 * `berry-agent/sqlite` 键仍随 persist SqliteFace 落码批接入（无真身不进表）。
 *
 * export（装机面落码批 #10——install 收割腿与装载器同源共用：虚拟面单源，
 * 不散拷）。
 */
export async function loadDefaultVirtualFaces(): Promise<Record<string, unknown>> {
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
    // 顶层导出形直注（非命名空间整包）——与 surface.json 收割的 4 符号面同源
    'berry-agent/llm': providerApiFace,
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
    // 时钟帽包裹（返回值经闭包捕获——withTimeout 面 Promise<void>）+
    // 装载期语境遮蔽（ix-2——07 §4.3 档位 2 两处遮蔽之二）：apply 即使处
    // 命令异步链内（/reload、/plugins install 等命令触发的装载流）亦按无锚
    // 判——装载期结构性无自动锚（apply 内 ctx.ui 阻塞三件拒、单向原语
    // no-op warn）。ALS.exit 语境跟随 async：apply 全执行段均在遮蔽内。
    await withTimeout(
      withoutSessionAnchor(() =>
        Promise.resolve(apply(ctx, config)).then((r) => {
          returned = r;
        }),
      ),
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

/**
 * 包主入口解析（default-export 态：package.json main；缺省 index.js）。
 * export（装机面落码批 #10——install 收割腿与装载器同源共用：入口解析序
 * 单源，不散拷）。
 */
export function resolvePkgMain(pluginDir: string): string {
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
