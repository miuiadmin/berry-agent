/**
 * 'sessions' 服务面（03 §4.4/§4.5 + 06 §318 appendEvent 最小面——批 19 销账笔）。
 *
 * 宿主装配根 provide 的活引用面：appendEventFor(sessionId) 按会话解析**当下**
 * 活体驱动（/new 热切换安全 = 调用时点解析非装配期冻结）；无活体驱动 =
 * undefined 降级（服务照常 provide——诚实缺席律：消费方〔core:memory 差分
 * 落账腿〕捕获后自行降级，mirror 不锁步）。
 *
 * 二道闸（06 §318 定稿条款——闭环在闭包内非依赖 SessionLog 下游）：
 *  ①核心事件词伪造拒写——核心词写入权属宿主（核心事件族 = 驱动单源）；
 *  ②未注册词汇拒写——与 SessionLog.append 下游 SESSION_UNKNOWN_EVENT_TYPE
 *    同判据（前置在此 = 错误信息可携带服务面上下文；下游仍兜底）。
 *
 * 完整 ctx.sessions 面（只读四件 + 受理制写两腿 + 三闸）归后续批——本件只落
 * appendEvent 最小面（memory/diff 唯一 durable 出口的承载位）+ surfaceOp
 * 信封参数腿（03 §4.5 修缝批 2026-09-08：受控注入原语可选信封位——改道
 * appendWithSurfaceOp 正门，插件自定义压缩类操作的唯一合法投影写径）。
 *
 * fork 绑定面（ag 批 cs-D2——03 §4.5 定形注）：插件道恒经
 * bindSessionsForPlugin 绑定面消费（共享根 provision 形态废止）——归因闸
 * 「宿主单方拼装」落地：caller 由宿主闭包铸造，传入面无参数位（伪造结构性
 * 不存在，sessions-control 先例同构）；行籍闸 = 行不在活装载代即残句柄拒写。
 */
import { BaseError, CORE_EVENT_TYPE_NAMES, isKnownEventType } from '../contracts/index.js';
import type { SurfaceOp } from '../contracts/index.js';
import type { SessionLog } from '../session/index.js';

/**
 * 驱动取值器（活引用——调用时点解析）。结构 typing 而非 import
 * ConversationDriver：本件只消费 session 附件（SessionLog），驱动面窄化由
 * 装配根的 stack.driverOf 天然满足。
 */
export type SessionsDriverOf = (sessionId: string) => { readonly session: SessionLog } | undefined;

/** append 单动词形（两条消费道共享——宿主道缺省无 caller，插件道绑定面铸造） */
type AppendFn = (type: string, data: unknown, surfaceOp?: SurfaceOp, sourceEventSeqs?: readonly number[]) => unknown;

/**
 * sessions 服务最小面（appendEvent 单动词——03 §4.4 受理制写的最小切面）。
 * 词面独立律：memory 席消费本形（结构兼容即编译期验），host 边不反向进 memory。
 */
export interface SessionsFace {
  /**
   * 按会话取 appendEvent 活引用：过二道闸后委派 SessionLog.append（同步
   * 落账）。无活体驱动 → undefined（消费方降级）；返回闭包同样**调用时点**
   * 执法（取引用与调用的两时点间驱动可能已闭——闸与 append 都在调用拍执行）。
   *
   * surfaceOp 信封参数腿（03 §4.5，2026-09-08 修缝批）：携带 surfaceOp 时
   * 过闸后改道 appendWithSurfaceOp 正门——边缘纪律五条 + SESSION_SURFACE_
   * OP_INVALID 同门同码（受理面不设第二校验面）；sourceEventSeqs 按溯源
   * 完整性律须全列区间 seq（正门校验执法）。
   *
   * @param caller 调用方归因（ag 批 cs-D2——03 §4.5 归因闸）：在场即于
   *   data 盖 `source: plugin:<id>` 键（宿主单方拼装）；缺省 = 宿主道（落账
   *   data 原样零变）。插件消费面经 bindSessionsForPlugin 绑定面注入，插件
   *   传入面无此参数位——插件自供 source 键在绑定面被覆写（防冒名单源）。
   */
  appendEventFor(sessionId: string, caller?: SessionsCaller): AppendFn | undefined;
}

/**
 * 调用方归因（03 §4.5 归因闸——宿主单方拼装的数据面）。
 * 归因键落事件 data 的 `source` 键（EventSource 闭集 `plugin:${string}` 同形
 * ——compaction/fallback 遗留先例的成文形态）。
 */
export interface SessionsCaller {
  readonly kind: 'plugin';
  readonly pluginId: string;
}

/**
 * 插件道消费面（fork 绑定真身——03 §4.5）。与 SessionsFace 其余成员结构
 * 同形，但 **appendEventFor 的 caller 参数位结构性缺席**（Omit 收窄——
 * PluginControlFace 同构先例）：归因由绑定面闭包铸造（传入面无参数位——
 * 伪造结构性不存在），类型层同落此门——插件/模型经本类型面自报 caller
 * 须编译红（防冒名单源在类型面兑现）；完整受理面（只读四件等）随后续批
 * 扩本形。
 */
export type PluginSessionsFace = Omit<SessionsFace, 'appendEventFor'> & {
  /** 插件道取引用形（caller 缺席——绑定面铸造 `{kind:'plugin', pluginId}` 后透传基础面） */
  appendEventFor(sessionId: string): AppendFn | undefined;
};

/** 建 sessions 服务面（装配根：`bindSessionsForPlugin` 绑定后 fork 级提供） */
export function createSessionsFace(options: { readonly driverOf: SessionsDriverOf }): SessionsFace {
  return {
    appendEventFor(sessionId, caller) {
      const log = options.driverOf(sessionId)?.session;
      if (log === undefined) return undefined; // 无活体驱动——诚实缺席（不造回库替身）
      return (type, data, surfaceOp, sourceEventSeqs) => {
        // 闸〇（归因闸前置的结构前提——仅 caller 在场的绑定道执法）：data 非
        // 纯对象 = 归因键无处落（数组/原始值/null/类实例拒写——fail-loud 先于
        // 词汇闸；纯对象判据与快照面 snapshot.ts 同源）
        const effectiveData = caller === undefined ? data : stampSourceKey(caller.pluginId, data);
        // 闸一：核心事件词伪造拒写（核心词写入权属宿主——双入口纪律的受理侧）
        if (CORE_EVENT_TYPE_NAMES.includes(type)) {
          throw new BaseError(
            'SESSION_CORE_TYPE_FORBIDDEN',
            `核心事件词 ${type} 拒经 sessions.appendEventFor 写入（核心事件族写入权属宿主驱动单源——06 §6 二道闸①）`,
          );
        }
        // 闸二：未注册词汇拒写（词汇注册表单源；判据与 SessionLog.append 下游同源）
        if (!isKnownEventType(type)) {
          throw new BaseError(
            'SESSION_UNKNOWN_EVENT_TYPE',
            `事件词 ${type} 未在词汇注册表（sessions.appendEventFor 前置闸——下游 SessionLog.append 同判据兜底）`,
          );
        }
        // surfaceOp 信封参数腿（03 §4.5）：携带信封即改道 appendWithSurfaceOp
        // 正门——一切改投影历史的唯一正门（05 §2.1）。边缘纪律五条与
        // SESSION_SURFACE_OP_INVALID 由正门单点执法（受理面零第二校验面）；
        // 二道闸对两路同前置（核心词携信封同拦——词面收窄注记的执法位）。
        if (surfaceOp !== undefined) {
          return log.appendWithSurfaceOp(type, effectiveData, surfaceOp, sourceEventSeqs);
        }
        return log.append(type, effectiveData);
      };
    },
  };
}

/**
 * 归因键盖章（纯函数——「宿主单方拼装」的拼装位）：浅拷贝后盖
 * `source: plugin:<id>`。插件自供 source 键被覆写（传入面无归因参数位——
 * 防冒名单源，bindControlForPlugin caller 覆写律同构）；原对象零突变。
 * data 非纯对象（数组/原始值/null/类实例——prototype 判据与快照面
 * snapshot.ts 同源）→ `SESSION_EVENT_DATA_INVALID`（归因键恒在的结构前提
 * ——fail-loud 不静默降格为宿主道）。
 */
function stampSourceKey(pluginId: string, data: unknown): Record<string, unknown> {
  // 纯对象判据与快照面（session/snapshot.ts）同源：prototype 检查明文拒类实例
  // （Date/Map/Set 等）——typeof 'object' 且非数组的类实例若放行，浅拷贝对零
  // 自有可枚举属性的类实例（如 Date）产出 {source} 单键、原数据静默净丢失；
  // 数组经此判据同拒（Array.prototype ≠ Object.prototype）。Object.create(null)
  // 形 proto === null 属纯对象收纳。
  const proto = typeof data === 'object' && data !== null ? Object.getPrototypeOf(data) : undefined;
  if (proto !== Object.prototype && proto !== null) {
    throw new BaseError(
      'SESSION_EVENT_DATA_INVALID',
      `插件 ${pluginId} 经 sessions.appendEventFor 的事件 data 须为纯对象（归因键 source 恒在的结构前提` +
        `——数组/原始值/null/类实例〔Date、Map 等——判据与事件快照面同源〕拒写）`,
    );
  }
  // 判定过闸即 proto ∈ {Object.prototype, null}——纯对象（Record 视角浅拷贝安全）
  return { ...(data as Record<string, unknown>), source: `plugin:${pluginId}` };
}

/**
 * 插件道绑定面（ag 批 cs-D2——03 §4.5 定形注：共享根 provision 形态废止，
 * fork 级逐插件绑定）。caller 由宿主闭包铸造（传入面无参数位——插件伪造
 * 归因结构性不存在）；行籍闸 = `isRowActive` 在场即两拍执法（取引用拍 +
 * 落账拍）：行不在活装载代（generationDead / scope 回卷）即残句柄拒写
 * `PLUGIN_WINDOW_CLOSED`（「行不在活计划即无写径」——oauth 死域同律）。
 *
 * @param pluginId 行 id（core 行 = `core:<name>` 形——归因键与操控面 caller 同形）
 * @param face 宿主持有的基础面（装配根铸）
 * @param isRowActive 行活态探针（缺省 = 恒活——纯单元形；装载序真源 =
 *   `() => !generationDead`）
 */
export function bindSessionsForPlugin(
  pluginId: string,
  face: SessionsFace,
  isRowActive?: () => boolean,
): PluginSessionsFace {
  return {
    appendEventFor(sessionId) {
      // 行籍闸·取引用拍：行已死即不再发新句柄
      if (isRowActive !== undefined && !isRowActive()) {
        throw new BaseError(
          'PLUGIN_WINDOW_CLOSED',
          `插件 ${pluginId} 的会话受理窗已随装载代回卷——拒发 append 句柄（行籍闸，03 §4.5）`,
        );
      }
      // caller 注位（归因闸执法位）：绑定面铸造 caller 传入基础面——盖章随
      // 闭包固化，插件传入面无参数位（防冒名单源）
      const inner = face.appendEventFor(sessionId, { kind: 'plugin', pluginId });
      if (inner === undefined) return undefined; // 无活体驱动——诚实缺席（透传基础面语义）
      // 行籍闸·落账拍：取引用与落账两拍间行可能已死（scope 回卷/换代）——
      // 残句柄拒写（「行不在活计划即无写径」的执法拍）
      return (type, data, surfaceOp, sourceEventSeqs) => {
        if (isRowActive !== undefined && !isRowActive()) {
          throw new BaseError(
            'PLUGIN_WINDOW_CLOSED',
            `插件 ${pluginId} 的会话受理窗已随装载代回卷——残句柄拒写（行籍闸，03 §4.5）`,
          );
        }
        return inner(type, data, surfaceOp, sourceEventSeqs);
      };
    },
  };
}
