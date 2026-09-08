/**
 * compaction 席位容器 + 接管缝归因铸造件（U4-3 装配批——05 §2.1 槽位化三层的
 * 装载面装配件；动词词面真源 03 §2.2 第十二面/§2.7 两动词行）。
 *
 * 三件产物：
 *  - **席位容器**（createCompactionSlots）：配置槽 + 摘要 provider 槽的单席位
 *    状态机（先到占 / 他插件后到拒 / 同席位者可更新 / 卸载回收）。host 装配根
 *    单真身：conversation-stack 消费 getConfig/getProvider（服务面三 seam 之
 *    二的容器位），plugin-boot 逐插件 fork 绑定 bindForPlugin 产物（经
 *    ctx.get("compaction") 消费）。本模块零 context 边——窗口真源由装配层注入
 *    （inLoadWindow 回调，绑本插件 handle）。
 *  - **归因箱 + 记名/铸造两律**（BEFORE_COMPACT_ATTRIB / mark / forge）：
 *    session_before_compact 值链的逐跳归因机制件——plugin-context 钩子包装层
 *    消费（值链改写者记名 + takeover.pluginId 强制覆写，冒名结构性不存在）；
 *    conversation-stack 派发包装层种子箱读末位。symbol 键经对象 spread 天然
 *    随值链传播（改写必新建对象——引用比较判改写的服务面约定同源）。
 */
import { BaseError } from '../contracts/index.js';
import type { CompactionConfig, SummarizerFn } from './types.js';
import { DEFAULT_COMPACTION_CONFIG } from './types.js';

/* ---------------- 接管缝归因机制件（值链逐跳归因） ---------------- */

/**
 * 归因箱（waterfall 值链共享可变匣）：lastAdjustedBy = 最后改写值的监听者
 * pluginId。宿主派发包装层种子（conversation-stack）、钩子包装层逐跳记名
 * （plugin-context）、派发出口读取（service 的 BeforeCompactResult 组装面）。
 */
export interface BeforeCompactAttribution {
  lastAdjustedBy?: string;
}

/**
 * 归因箱值链键（unique symbol——模块外不可字面伪造）：宿主种子在载荷对象上，
 * 插件改写值必经 spread/新建（「值链改写必新建对象」律），spread 复制 symbol
 * 键属性 → 箱引用沿链共享。非接管缝的 waterfall 值不携带本键——记名/铸造
 * 两律对其零接触（通用包装层的机制件消费位判据）。
 */
export const BEFORE_COMPACT_ATTRIB: unique symbol = Symbol('session-before-compact-attribution');

/**
 * 记名律：监听者改写值链时记末位改写者（plugin-context 钩子包装层逐跳调用）。
 * 箱缺席 = 非接管缝值链——no-op（通用 waterfall 不受影响）。残余面：插件在
 * handler 体内直改箱内容而不改值可伪记他名——末位真改写者必覆写之，且该
 * 归因仅 fallback 记账审计面（非权限面），残余可受。
 */
export function markBeforeCompactRewrite(value: unknown, pluginId: string): void {
  if (typeof value !== 'object' || value === null) return;
  const box = (value as Record<symbol, unknown>)[BEFORE_COMPACT_ATTRIB];
  if (typeof box === 'object' && box !== null) {
    (box as BeforeCompactAttribution).lastAdjustedBy = pluginId;
  }
}

/**
 * 铸造律：takeover.pluginId 由宿主钩子包装层强制覆写为本监听者（03 §2.4 行
 * 「归因铸造」/05 §2.1——e-4 caller 闭包同律，插件自填被覆写）。执法判据 =
 * **接管位引用换**（produced.takeover !== received.takeover——「值链改写必
 * 新建对象」律同源）：本监听者新置/重建接管位才覆写；原引用透传（含改写
 * 他位而保留接管对象引用的 spread 形）不覆写——防下游误夺上游接管归因。
 * 只在携带归因箱的值上执法（非接管缝值链零接触）；takeover 位缺席 = 纯改
 * 写/放行，原值直返不改引用。
 */
export function forgeBeforeCompactIdentity(produced: unknown, received: unknown, pluginId: string): unknown {
  if (typeof produced !== 'object' || produced === null) return produced;
  const record = produced as Record<PropertyKey, unknown>;
  if (record[BEFORE_COMPACT_ATTRIB] === undefined) return produced; // 非接管缝值链——零接触
  const takeover = record['takeover'];
  if (typeof takeover !== 'object' || takeover === null) return produced; // 无接管位——原值直返
  // 上游接管位原引用透传——非本监听者所置，不覆写
  const prev =
    typeof received === 'object' && received !== null
      ? (received as Record<PropertyKey, unknown>)['takeover']
      : undefined;
  if (takeover === prev) return produced;
  return { ...record, takeover: { ...(takeover as Record<string, unknown>), pluginId } };
}

/* ---------------- 席位容器（配置槽 + provider 槽） ---------------- */

/**
 * 插件面（ctx.get("compaction") 消费形——03 §2.2 第十二面两动词）：两动词
 * 皆装载窗 only **严于通律**（回调窗延伸不适用——装配期配置/注册动作非回调
 * 场景动作，c-6 registerOAuthFlow 同形）+ 单席位先到占 + 返回摘槽 disposer。
 */
export interface CompactionPluginFace {
  /**
   * 数值配置槽（Partial<CompactionConfig> 合并——字段射程 = 全七字段，两路同
   * 生效：数值是宿主机制参数非策略算法）。席位者重设 = 更新己方 partial；
   * 他插件后到拒 `COMPACTION_CONFIG_TAKEN`。返回摘槽 disposer（幂等——只摘
   * 自己的席位）。
   */
  setConfig(partial: Partial<CompactionConfig>): () => void;
  /**
   * 摘要 provider 槽（常设算法位——签名 05 §2.1 SummarizerFn；只作用阈值路，
   * 溢出兜底恒宿主缺省算法）。席位法同 setConfig；他插件后到拒
   * `COMPACTION_SUMMARIZER_TAKEN`。
   */
  registerSummarizer(fn: SummarizerFn): () => void;
}

/** 席位容器装配面（conversation-stack 服务消费 + plugin-boot 绑定消费） */
export interface CompactionSlotsHandle {
  /** 现行生效配置（装配基线 ← 席位 partial 合并；空席 = 基线原样） */
  getConfig(): CompactionConfig;
  /** 现行 provider 槽占用（空席 = undefined——服务面回落宿主通道） */
  getProvider(): { pluginId: string; fn: SummarizerFn } | undefined;
  /**
   * 逐插件绑定（plugin-boot fork 绑定位）：窗口真源注入本插件 handle 的
   * inLoadWindow——装载窗外两动词皆拒（严于通律）。
   */
  bindForPlugin(input: { pluginId: string; inLoadWindow: () => boolean }): CompactionPluginFace;
  /**
   * 摘本插件席位（卸载回收腿——plugin-boot fork dispose 兜底调用）：只摘
   * 自己占的席（他人席位不误伤）；幂等。空位不阻断宿主（回落缺省）。
   */
  releaseFor(pluginId: string): void;
}

/** 组装选项（装配根注入面） */
export interface CompactionSlotsOptions {
  /** 配置基线（缺省 DEFAULT_COMPACTION_CONFIG——服务面 options.config 装配时常量的容器位对应物） */
  readonly baseConfig?: CompactionConfig;
}

/**
 * 组装席位容器（host 装配根单真身）。状态进程级内存态：/reload 卸载序经
 * releaseFor 回收、重启清零——压缩配置非 durable 语义（缺省恒在场兜底）。
 */
export function createCompactionSlots(options: CompactionSlotsOptions = {}): CompactionSlotsHandle {
  const baseConfig: CompactionConfig = options.baseConfig ?? DEFAULT_COMPACTION_CONFIG;
  let configSeat: { pluginId: string; partial: Partial<CompactionConfig> } | undefined;
  let providerSeat: { pluginId: string; fn: SummarizerFn } | undefined;

  return {
    getConfig(): CompactionConfig {
      return { ...baseConfig, ...(configSeat?.partial ?? {}) };
    },
    getProvider() {
      return providerSeat;
    },
    bindForPlugin({ pluginId, inLoadWindow }) {
      /** 装载窗闸（严于通律——回调窗延伸不适用；窗真源 = 本插件 handle） */
      const assertLoadWindow = (verb: string): void => {
        if (inLoadWindow()) return;
        throw new BaseError(
          'PLUGIN_WINDOW_CLOSED',
          `注册动词 ${verb} 在装载窗口外被拒（插件 ${pluginId}——03 §2.2 第十二面：压缩策略面两动词装载窗 only 严于通律，回调窗延伸不适用〔装配期配置/注册动作非回调场景动作〕）`,
        );
      };
      return {
        setConfig(partial: Partial<CompactionConfig>): () => void {
          assertLoadWindow('ctx.compaction.setConfig');
          if (configSeat !== undefined && configSeat.pluginId !== pluginId) {
            throw new BaseError(
              'COMPACTION_CONFIG_TAKEN',
              `数值配置槽已被插件 ${configSeat.pluginId} 占据（插件 ${pluginId} 后到拒——单席位先到占；配置主权单源，两插件各设阈值 = 用户装配面错误，fail-loud 拒不静默 last-wins）`,
            );
          }
          configSeat = { pluginId, partial };
          return () => {
            if (configSeat?.pluginId === pluginId) configSeat = undefined; // 幂等：只摘自己（后设者不误伤）
          };
        },
        registerSummarizer(fn: SummarizerFn): () => void {
          assertLoadWindow('ctx.compaction.registerSummarizer');
          if (providerSeat !== undefined && providerSeat.pluginId !== pluginId) {
            throw new BaseError(
              'COMPACTION_SUMMARIZER_TAKEN',
              `摘要 provider 槽已被插件 ${providerSeat.pluginId} 占据（插件 ${pluginId} 后到拒——单席位先到占；溢出兜底恒宿主缺省算法，槽不可及）`,
            );
          }
          providerSeat = { pluginId, fn };
          return () => {
            if (providerSeat?.pluginId === pluginId) providerSeat = undefined;
          };
        },
      };
    },
    releaseFor(pluginId: string): void {
      if (configSeat?.pluginId === pluginId) configSeat = undefined;
      if (providerSeat?.pluginId === pluginId) providerSeat = undefined;
    },
  };
}
