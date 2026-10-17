/**
 * sdk/plugin-routes — 插件道路由受理面（U5-1 契约先行）。
 *
 * 03 §10.6 U5 定形注 + §2.2 能力面第十三面的码面兑现：用户插件经高危面
 * `sdk.register-route` 开门（§4.6 v1 首批第二枚）受限可达 sdk HTTP 面路由
 * 扩展位。本件 = **受理裁决纯函数 + 描述符子集形**（受理序的纯函数段：
 * 词形/保留字 → 档位收窄 → 数帽 → 落面铸造）；门检前置（assertDoor 第二
 * 落地点）与 capability/used 审计恰一笔、装载窗执法、host registry 时序
 * （受理与挂载两时点解耦——三入口开面 replay）随 U5-2 装配笔接线，查重
 * 复用 core: 道注册器既有 method+path 双键普通 Error（与 core: 道同表同律）。
 *
 * 收窄四件单源本件：鉴权档子集（`self` 与 `open{purpose:'auth-exchange'}`
 * 两逃生档不对插件道开放）/ loopbackOnly 恒 true 不可自选（子集形无该位
 * ——结构性执法强于运行时拒绝）/ bodyLimitBytes 钳帽 ≤1MiB 缺席即 1MiB
 * （受理面填值后转发——防面级缺省 10MiB 静默穿透）/ 路由数帽 16 per-plugin。
 */
import type { SdkRouteDescriptor, SdkRouteHandler, SdkRouteMethod } from './types.js';

/* ---------------- 规约常量（03 §10.6 U5 定形注——数值钉死位） ---------------- */

/** 插件道根段前缀（`/plugins/<id>/` 两段复合——前缀恒受理面施加、插件只申报 suffix） */
export const PLUGIN_ROUTE_ROOT = '/plugins';

/**
 * 插件道请求体帽钳值（1MiB——可小不可大；**缺席即本值**：受理面填值后转发，
 * 落面 descriptor 该位恒在场且 ≤1MiB，防面级缺省 10MiB 静默穿透）。
 */
export const PLUGIN_ROUTE_BODY_LIMIT_MAX_BYTES = 1024 * 1024;

/** per-plugin 路由数帽（受理面计数、超帽拒 `SDK_ROUTE_LIMIT_REACHED`） */
export const PLUGIN_ROUTE_LIMIT = 16;

/** 插件道 open 档合法语义位子集（core: 道三值去 `auth-exchange`——插件不得自建换证端点） */
export const PLUGIN_ROUTE_OPEN_PURPOSES = ['liveness', 'static-shell'] as const;

/** 受理拒码闭集（SDK_ROUTE_ 子族四码——02 §5.3 U5 立题批入册；三因一帽数四码、fail-loud 可诊断） */
export type PluginRouteRejectCode =
  'SDK_ROUTE_PATH_RESERVED' | 'SDK_ROUTE_AUTH_FORBIDDEN' | 'SDK_ROUTE_BODY_LIMIT' | 'SDK_ROUTE_LIMIT_REACHED';

/* ---------------- 描述符子集形（插件道申报面——SdkRouteDescriptor 的收窄投影） ---------------- */

/**
 * 插件道鉴权档子集（core: 道四值去两逃生档）：`self`（issue webhook HMAC 位
 * 系 host 装配独占）与 `open{purpose:'auth-exchange'}`（换证端点不开放）均
 * 不在类型面——子集形即第一道结构性收窄；运行时裁决（adjudicatePluginRoute
 * 的 AUTH_FORBIDDEN 步）系 JS 调用方/类型漂移的防御性回弹。
 */
export type PluginRouteAuth =
  | 'token'
  | { readonly mode: 'token-or-cookie'; readonly cookie: string }
  | { readonly mode: 'open'; readonly purpose: (typeof PLUGIN_ROUTE_OPEN_PURPOSES)[number] };

/**
 * 插件道路由描述符（插件只申报 suffix——前缀恒受理面施加，前缀域外结构性
 * 不可达即拒 fail-loud）。与 SdkRouteDescriptor 的差异面：无 `loopbackOnly`
 * 位（恒 true 不可自选——缺省 true 且不可自选 false 的结构性执法）、
 * `bodyLimitBytes` 钳帽 ≤1MiB 缺席即 1MiB。
 */
export interface PluginRouteDescriptor {
  /** HTTP 方法（method+path 双键匹配——与 core: 道同键形） */
  readonly method: SdkRouteMethod;
  /**
   * suffix 路径（`/foo/:id` 形段式；`/` 开头；尾段 `*` = 域内 catch-all 映射
   * `/plugins/<id>/*`；单独 `*` 全局形系 core: 道 SPA fallback 专属承载位、
   * 插件道结构性不可达拒）。
   */
  readonly path: string;
  /** 鉴权档（子集——PluginRouteAuth） */
  readonly auth: PluginRouteAuth;
  /** per-route 请求体帽（≤1MiB 可小不可大；缺席 = 1MiB 受理面填值） */
  readonly bodyLimitBytes?: number;
  readonly handler: SdkRouteHandler;
}

/* ---------------- 拼合单源（id → URL 段规约） ---------------- */

/**
 * 插件道路径拼合（单源——eliza 前缀默认施加判例采纳、rawPath 逃生门不设）：
 * `/plugins/<encodeURIComponent(pluginId)><suffix>`。id 经 URL 段安全编码
 * 承载特殊字符（'core:xxx' 冒号形 → 'core%3Axxx'——编码后不含 `/`，段边界
 * 单源性由此保证）。
 */
export function pluginRoutePath(pluginId: string, suffix: string): string {
  return `${PLUGIN_ROUTE_ROOT}/${encodeURIComponent(pluginId)}${suffix}`;
}

/* ---------------- 受理裁决纯函数（受理序的纯函数段） ---------------- */

/**
 * 受理裁决状态输入（U5-2 受理器编排维护——纯函数只读消费）：
 * `pluginRouteCount` = 本插件当前在册路由数（数帽分帐——跨插件不共享）。
 * 查重不在纯函数段：落面 descriptor 交 core: 道注册器时既有 method+path
 * 双键查重 fail-loud（普通 Error，与 core: 道同表同律、零新码零重复执法）。
 */
export interface PluginRouteAdjudicateState {
  readonly pluginRouteCount: number;
}

/**
 * 受理裁决结果：ok:true 携落面 descriptor（core: 道形——loopbackOnly 恒
 * true、bodyLimitBytes 恒在场且 ≤1MiB、path 已前缀施加）；ok:false 携
 * SDK_ROUTE_ 四码之一与人读 message（受理器包装 throw——fail-loud）。
 */
export type PluginRouteAdjudication =
  | { readonly ok: true; readonly descriptor: SdkRouteDescriptor }
  | { readonly ok: false; readonly code: PluginRouteRejectCode; readonly message: string };

/**
 * 插件道路由受理裁决（纯函数零副作用——03 §10.6 受理序的纯函数段）：
 *
 * ① 词形/保留字校验（`SDK_ROUTE_PATH_RESERVED`——防御性回弹）：
 *    suffix 须 `/` 开头（单独 `*` 全局形拒）；保留根段闭集 {`/v1/`, `/plugins/`}
 *    撞入即拒（执法位本在 core: 道注册器，插件道经前缀施加律结构性框死于
 *    `/plugins/<id>/` 之下——受理面此校验系纵深防御的回弹层）；段式正规形
 *    （无空段 / `:name` 参数段字母数字下划线 / 通配 `*` 至多一枚且须尾段 /
 *    字面段不含保留字符 `:` `*`）。
 * ② 档位收窄裁决（`SDK_ROUTE_AUTH_FORBIDDEN` / `SDK_ROUTE_BODY_LIMIT`）：
 *    鉴权档子集（self 拒、open 限 liveness·static-shell 两 purpose）；
 *    bodyLimitBytes 非正整数或 >1MiB 拒（可小不可大）。
 * ③ 数帽（`SDK_ROUTE_LIMIT_REACHED`）：本插件在册数达 16 拒。
 * ④ 落面铸造：前缀施加 + loopbackOnly 恒 true + bodyLimitBytes 填值（缺席
 *    即 1MiB）——descriptor 落面该位恒在场，面级缺省 10MiB 结构性不可达。
 *
 * 门检前置先于本函数（未开门连查重都不可达——registerUiBackend 同律）、
 * capability/used 审计恰一笔（拒路径零审计）均归 U5-2 受理器编排。
 */
export function adjudicatePluginRoute(
  pluginId: string,
  descriptor: PluginRouteDescriptor,
  state: PluginRouteAdjudicateState,
): PluginRouteAdjudication {
  const { method, path: suffix, auth, handler } = descriptor;

  // —— ① 词形/保留字（PATH_RESERVED——防御性回弹层）——
  if (typeof pluginId !== 'string' || pluginId === '') {
    return { ok: false, code: 'SDK_ROUTE_PATH_RESERVED', message: '插件 id 空缺——前缀拼合不可达' };
  }
  // 单独 `*`（全局吞一切）不以 / 开头，由起头判据一并拒；message 点名全局形归属
  if (typeof suffix !== 'string' || !suffix.startsWith('/')) {
    return {
      ok: false,
      code: 'SDK_ROUTE_PATH_RESERVED',
      message: `插件道路由 path 须以 / 开头的 suffix（单独 * 全局形系 core: 道 SPA fallback 专属承载位、插件道不可达）：${method} ${suffix}`,
    };
  }
  // 保留根段防御性回弹：前缀施加律下结构性不可撞，纵深防御仍显式拒
  if (
    suffix === '/v1' ||
    suffix.startsWith('/v1/') ||
    suffix === PLUGIN_ROUTE_ROOT ||
    suffix.startsWith(`${PLUGIN_ROUTE_ROOT}/`)
  ) {
    return {
      ok: false,
      code: 'SDK_ROUTE_PATH_RESERVED',
      message: `插件道路由 path 撞保留根段闭集 {/v1/, /plugins/}——前缀施加律下 /plugins/<id>/ 域外结构性不可达（防御性回弹拒）：${method} ${suffix}`,
    };
  }
  const segments = suffix.slice(1).split('/');
  if (segments.some((seg) => seg === '')) {
    return { ok: false, code: 'SDK_ROUTE_PATH_RESERVED', message: `插件道路由 path 空段非法：${method} ${suffix}` };
  }
  // 通配 `*`：至多一枚且须尾段（域内 catch-all——suffix 尾 * 映射 /plugins/<id>/*）
  const starIndex = segments.indexOf('*');
  if (starIndex !== -1 && (starIndex !== segments.length - 1 || segments.indexOf('*', starIndex + 1) !== -1)) {
    return {
      ok: false,
      code: 'SDK_ROUTE_PATH_RESERVED',
      message: `插件道路由 path 通配 * 至多一枚且须尾段：${method} ${suffix}`,
    };
  }
  for (const seg of segments) {
    if (seg.startsWith(':')) {
      if (!/^[A-Za-z0-9_]+$/.test(seg.slice(1))) {
        return {
          ok: false,
          code: 'SDK_ROUTE_PATH_RESERVED',
          message: `插件道路由参数名非法（字母数字下划线）：${method} ${suffix}`,
        };
      }
    } else if (seg !== '*' && /[:*]/.test(seg)) {
      return {
        ok: false,
        code: 'SDK_ROUTE_PATH_RESERVED',
        message: `插件道路由段含保留字符（: / *）：${method} ${suffix}`,
      };
    }
  }

  // —— ② 档位收窄（AUTH_FORBIDDEN / BODY_LIMIT）——
  // 鉴权档子集：self 逃生档不对插件道开放（issue webhook HMAC 位系 host 装配独占）。
  // 类型面已结构性排除 self（PluginRouteAuth 子集——tsc 即证无交集）；本判定
  // 系 JS 调用方（jiti 装载零编译期）与类型漂移的防御性回弹，故显式拓宽比较
  if ((auth as unknown as string) === 'self') {
    return {
      ok: false,
      code: 'SDK_ROUTE_AUTH_FORBIDDEN',
      message: '鉴权档 self 不对插件道开放（issue webhook HMAC 位系 host 装配独占逃生档）',
    };
  }
  // open 档 purpose 射界子集：liveness·static-shell 两值（auth-exchange 不开——插件不得自建换证端点）
  if (typeof auth === 'object' && auth !== null && auth.mode === 'open') {
    const purpose = (auth as { purpose: string }).purpose;
    if (!(PLUGIN_ROUTE_OPEN_PURPOSES as readonly string[]).includes(purpose)) {
      return {
        ok: false,
        code: 'SDK_ROUTE_AUTH_FORBIDDEN',
        message: `open 档 purpose ${purpose} 不对插件道开放——合法语义位子集：${PLUGIN_ROUTE_OPEN_PURPOSES.join(' / ')}（auth-exchange 换证端点不开放）`,
      };
    }
  }
  // 体帽钳制：缺席即 1MiB 受理面填值；在场须正整数且 ≤1MiB（可小不可大）
  const declared = descriptor.bodyLimitBytes;
  if (
    declared !== undefined &&
    (!Number.isSafeInteger(declared) || declared <= 0 || declared > PLUGIN_ROUTE_BODY_LIMIT_MAX_BYTES)
  ) {
    return {
      ok: false,
      code: 'SDK_ROUTE_BODY_LIMIT',
      message: `bodyLimitBytes 须为正整数且 ≤${PLUGIN_ROUTE_BODY_LIMIT_MAX_BYTES}（1MiB，可小不可大；缺席即该帽值）：${String(declared)}`,
    };
  }
  const bodyLimitBytes = declared ?? PLUGIN_ROUTE_BODY_LIMIT_MAX_BYTES;

  // —— ③ 数帽（LIMIT_REACHED——per-plugin 在册数达帽拒）——
  if (state.pluginRouteCount >= PLUGIN_ROUTE_LIMIT) {
    return {
      ok: false,
      code: 'SDK_ROUTE_LIMIT_REACHED',
      message: `插件道路由数帽 ${PLUGIN_ROUTE_LIMIT}已达（per-plugin 计数——摘除 fn 释放后可再注册）`,
    };
  }

  // —— ④ 落面铸造（core: 道形——三处收窄全部落位）——
  const full: SdkRouteDescriptor = {
    method,
    path: pluginRoutePath(pluginId, suffix),
    auth,
    loopbackOnly: true, // 恒 true：子集形无自选位（缺省 true 且不可自选 false 的结构性执法）
    bodyLimitBytes, // 恒在场且 ≤1MiB：面级缺省 10MiB 结构性不可达
    handler,
  };
  return { ok: true, descriptor: full };
}

/* ---------------- 服务面接口（SERVICE_CATALOG 第三条——U5-2 装配真身） ---------------- */

/**
 * sdk-routes 服务面（ctx.get('sdk-routes') 消费——03 §2.2 能力面第十三面；
 * fork 级逐插件绑定，pluginId 闭包防冒名〔'secrets' 席同构〕）。受理序全链 =
 * 门检前置（`PLUGIN_CAPABILITY_DOOR_CLOSED`）→ 本件纯函数裁决（SDK_ROUTE_
 * 四码）→ core: 道注册器查重（普通 Error）→ capability/used 恰一笔；受理窗
 * 装载窗 only（`PLUGIN_WINDOW_CLOSED`）。真身（host registry + 三入口
 * replay + /reload 换代门复检）随 U5-2 落码。
 */
export interface SdkRoutesPluginFace {
  /** 受理制注册（返摘除 fn——/reload 换代门复检的回收腿；数帽分帐随摘除递减） */
  register(descriptor: PluginRouteDescriptor): () => void;
}
