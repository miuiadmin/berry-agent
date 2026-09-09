/**
 * sdk/plugin-route-registry — 插件道路由受理器真身（U5-2 装配+时序笔）。
 *
 * 03 §10.6 U5 定形注「时序缝定形」段的码面兑现：**host-owned 待注册路由
 * registry**（受理与挂载两时点解耦——「插件 boot 先于 HTTP 面存在」三入口
 * 结构性缝的正解）。受理动作恒 apply 期入本账（装载窗执法在前）；挂载由
 * 两路 replay：
 * - **构造期路**：daemon / TUI `--port` / serve 前台三入口开面时
 *   `snapshot()` 快照注入 `SdkHttpFaceOptions.routes` 位；
 * - **晚注册路**：面已开后受理（/reload 换代重走受理序——受理窗装载期
 *   恒先于或外在于开面时点，两序皆可达）经 `attachFace` 持有的活面
 *   `face.register` 晚注册位（claim 桥同款）。
 *
 * 受理序（§2.2 第十三面全链）= 装载窗（`PLUGIN_WINDOW_CLOSED`——
 * registerOAuthFlow〔c-6〕/registerSummarizer〔U4〕同律窗先于门）→ 门检
 * （`adjudicateCapabilityDoor`——assertDoor 第二落地点；core: 官方件直开
 * 豁免〔§4.6 判据：装配即用户意图〕但审计照记——「豁免免的是门不是账」
 * triggers 同律）→ 纯函数裁决（`adjudicatePluginRoute`——SDK_ROUTE_ 四码）
 * → 查重（面在场走 face.register 既有 method+path 双键普通 Error；缺席态
 * 账内同形 Error——与 core: 道同表同律零新码）→ 受理入账（面在场附带
 * 挂载）→ `capability/used` 审计恰一笔（05 §1.1——method+path 全路径归因
 * 键；拒路径零审计）→ 返摘除 fn。
 *
 * /reload 换代门复检（03 §10.6）：disposer 摘旧 + 新代重走本受理序——
 * bootPlugins 对每插件 fork.effect 兜底 `releaseFor`（compaction 同律双
 * 保险）；撤授予位后旧路由不残留（换代重注册现判现拒）。
 */
import { adjudicateCapabilityDoor } from '../contracts/api.js';
import { BaseError } from '../contracts/index.js';

import type { SdkHttpFaceHandle } from './http.js';
import { adjudicatePluginRoute } from './plugin-routes.js';
import type { PluginRouteDescriptor, SdkRoutesPluginFace } from './plugin-routes.js';
import type { SdkRouteDescriptor, SdkRouteMethod } from './types.js';

/** 服务名常量（SERVICE_CATALOG 第三条 'sdk-routes'——fork 绑定落位单源） */
export const SDK_ROUTES_SERVICE = 'sdk-routes';

/** 高危面名（03 §4.6 v1 首批第二枚——门检/审计归因单源） */
export const SDK_ROUTE_CAPABILITY = 'sdk.register-route';

/**
 * capability/used 审计记录（05 §1.1 U5 立题批载荷定形）：归因键 = method +
 * path（全路径——含受理面施加的 `/plugins/<id>/` 前缀，归因面恒全路径）。
 */
export interface SdkRouteUsedRecord {
  readonly pluginId: string;
  readonly capability: typeof SDK_ROUTE_CAPABILITY;
  readonly method: SdkRouteMethod;
  readonly path: string;
}

/** 受理器选项（assembly 单真身构造位——审计 seam 注入装配根单写者） */
export interface PluginRouteRegistryOptions {
  /**
   * capability/used 逐笔审计 seam（受理恰一笔——拒路径零审计；core: 豁免
   * 门检照记）。缺省 no-op（测试替身形/诊断形——诚实缺席律）。
   */
  readonly onCapabilityUsed?: (record: SdkRouteUsedRecord) => void;
}

/** 逐插件绑定输入（plugin-boot fork 落位调用——窗/门真源绑本插件 handle） */
export interface PluginRouteBindingInput {
  readonly pluginId: string;
  /** 开门授予集（handle.grantedOpens 晚绑真源——装载代内授予面快照） */
  readonly getOpens: () => ReadonlySet<string>;
  /** 装载窗判定（handle.inLoadWindow 晚绑真源——apply 期 true） */
  readonly inLoadWindow: () => boolean;
}

/** 账面条目（`${method} ${path}` 双键——与 core: 道注册键同形） */
interface PluginRouteEntry {
  readonly pluginId: string;
  readonly descriptor: SdkRouteDescriptor;
  /** 面在场受理时的活面摘除 fn（pending 态缺席——构造期路由经 routes 注入位自摘） */
  removeLive?: () => void;
}

/**
 * 插件道路由受理器（host-owned 单真身——assembly 创建、三入口消费）。
 *
 * 消费面四动词：`bindForPlugin`（plugin-boot fork 绑定）/ `snapshot`
 * （三入口构造期 replay）/ `attachFace`·`detachFace`（开面后受理的晚注册
 * 路与收口对称）/ `releaseFor`（卸载与 /reload 换代回收腿）。
 */
export interface PluginRouteRegistry {
  /** fork 级逐插件绑定（pluginId 闭包防冒名——'secrets'/'sessions-control' 席同构） */
  bindForPlugin(input: PluginRouteBindingInput): SdkRoutesPluginFace;
  /** 摘除本插件全部在账路由（面在场连带摘挂——/reload 换代 + fork.effect 兜底） */
  releaseFor(pluginId: string): void;
  /** 在账快照（三入口 `SdkHttpFaceOptions.routes` 注入位——构造期 replay 单源） */
  snapshot(): readonly SdkRouteDescriptor[];
  /**
   * 活面挂接（面 start 成功后调用）：此后受理走 face.register 晚注册位。
   * 契约 = 调用方构造面时已注入 `snapshot()`（在账条目已在面内——本动词
   * 不重放，防双注册 throw）；幂等保真（重复挂同一面 no-op）。
   */
  attachFace(face: SdkHttpFaceHandle): void;
  /** 活面解挂（面 stop 收口对称——此后受理回 pending 态入账待下次开面 replay） */
  detachFace(): void;
}

/**
 * 受理器工厂（assembly 单真身构造位）。纯账面状态 + 零自持监听——面生命
 * 周期归三入口，本件只做受理裁决与两时点解耦的账。
 */
export function createPluginRouteRegistry(options: PluginRouteRegistryOptions = {}): PluginRouteRegistry {
  /** 在账路由（`${method} ${path}` 双键唯一——查重账与 core: 道注册键同形） */
  const entries = new Map<string, PluginRouteEntry>();
  /** 活面引用（attachFace 后受理的晚注册承载位——face.stop 后 detachFace 清空） */
  let liveFace: SdkHttpFaceHandle | undefined;

  /** 本插件在账数（数帽分帐输入——跨插件不共享） */
  const countOf = (pluginId: string): number => {
    let n = 0;
    for (const entry of entries.values()) if (entry.pluginId === pluginId) n += 1;
    return n;
  };

  /** 账面摘除（摘除 fn 与 releaseFor 共用——面在场连带摘挂 + 键释放可重注册） */
  const remove = (key: string): void => {
    const entry = entries.get(key);
    if (entry === undefined) return;
    entry.removeLive?.();
    entries.delete(key);
  };

  return {
    bindForPlugin({ pluginId, getOpens, inLoadWindow }) {
      return {
        register(descriptor: PluginRouteDescriptor): () => void {
          // —— ① 装载窗（c-6/U4 同律窗先于门——受理窗装载期 only，回调窗延伸不适用）
          if (!inLoadWindow()) {
            throw new BaseError(
              'PLUGIN_WINDOW_CLOSED',
              `注册动词 ctx.get("sdk-routes").register 在装载窗口外被拒（插件 ${pluginId}——路由注册只在 apply 执行期间合法，03 §2.2 第十三面）`,
            );
          }
          // —— ② 门检前置先于查重（registerUiBackend 同律——未开门连查重都不可达）；
          // core: 官方件直开豁免（§4.6 判据：装配即用户意图），审计照记不豁免
          if (!pluginId.startsWith('core:')) {
            const verdict = adjudicateCapabilityDoor(getOpens(), SDK_ROUTE_CAPABILITY);
            if (!verdict.ok) {
              throw new BaseError('PLUGIN_CAPABILITY_DOOR_CLOSED', verdict.message);
            }
          }
          // —— ③ 纯函数裁决（词形/保留字 → 档位收窄 → 数帽 → 落面铸造——U5-1 件）
          const judged = adjudicatePluginRoute(pluginId, descriptor, { pluginRouteCount: countOf(pluginId) });
          if (!judged.ok) {
            throw new BaseError(judged.code, judged.message);
          }
          const full = judged.descriptor;
          const key = `${full.method} ${full.path}`;
          // —— ④ 查重：面在场走 face.register 既有 throw（同表同律字面复用）；
          // pending 态账内同形普通 Error（core: 道注册期消息形——零新码零重复执法）
          if (entries.has(key)) {
            if (liveFace !== undefined) {
              liveFace.register(full); // 既有 method+path 双键 throw——与 core: 道同表
            }
            throw new Error(`路由重复注册（method+path 双键唯一）：${key}——注册期 fail-loud`);
          }
          // —— ⑤ 受理入账（面在场附带挂载晚注册位——摘除 fn 双轨记录）
          let removeLive: (() => void) | undefined;
          if (liveFace !== undefined) removeLive = liveFace.register(full);
          entries.set(key, { pluginId, descriptor: full, ...(removeLive !== undefined ? { removeLive } : {}) });
          // —— ⑥ capability/used 恰一笔（受理成功后落；拒路径零审计；core: 照记）
          options.onCapabilityUsed?.({
            pluginId,
            capability: SDK_ROUTE_CAPABILITY,
            method: full.method,
            path: full.path,
          });
          // 摘除 fn（disposer 律 §2.6——/reload 换代回收腿的手动面；releaseFor 兜底双保险）
          return () => remove(key);
        },
      };
    },

    releaseFor(pluginId) {
      for (const [key, entry] of [...entries]) {
        if (entry.pluginId === pluginId) remove(key);
      }
    },

    snapshot() {
      return [...entries.values()].map((entry) => entry.descriptor);
    },

    attachFace(face) {
      if (liveFace === face) return; // 幂等保真（同面重复挂接 no-op）
      liveFace = face;
    },

    detachFace() {
      liveFace = undefined;
    },
  };
}
