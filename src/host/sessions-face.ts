/**
 * 'sessions' 服务面（03 §4.4/§4.5——cs-D1 sessions 完整受理面批 2026-09-15
 * 完整面 + 06 §318 appendEvent 最小面批 19 销账笔）。
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
 * cs-D1 扩面五件（03 §4.4 只读四件 + §4.5 store_state 腿——用户裁决「做」重开）：
 *  - currentSessionId：判据 v1 = 装配根注入的活体会话 id（真身 = SessionManager
 *    活体 Map 尾键——最新首次入册、幂等复开不移尾；本件零第二判据面）；
 *  - eventsOfType / lastClosedBoundary：锚 currentSessionId 所指会话的活体
 *    SessionLog（含 write-behind 在飞尾）；无活体即 SESSION_NO_ACTIVE_SESSION
 *    拒（fail-loud 非静默空数组）；-1 哨兵映射 undefined；
 *  - queryEvents：durable store 透传（帽 1000/10000 与游标分页单源在 persist，
 *    受理面零再帽——两时效差〔在飞窗 queryEvents 不可见〕系载体固有语义）；
 *  - storeStateFor(pluginId)：域绑定键值三动词（落库键 `<pluginId>__<键名>`
 *    宿主单方拼装；kv/written 审计 set 实际写成功尾/delete 实际移除尾逐笔、
 *    get 与 no-op 删除零落账）。
 *
 * fork 绑定面（ag 批 cs-D2——03 §4.5 定形注）：插件道恒经
 * bindSessionsForPlugin 绑定面消费（共享根 provision 形态废止）——归因闸
 * 「宿主单方拼装」落地：caller 与域前缀由宿主闭包铸造，传入面无参数位（伪造
 * 结构性不存在，sessions-control 先例同构）；行籍闸 = 行不在活装载代即残柄
 * 拒写（appendEventFor 两拍形 + 键值 set/delete 单拍形——get 读径无闸）。
 */
import { BaseError, CORE_EVENT_TYPE_NAMES, isKnownEventType } from '../contracts/index.js';
import type { SessionEvent, SurfaceOp } from '../contracts/index.js';
import type { QueryEventsFilter, QueryEventsResult, StoreStateEntry } from '../persist/index.js';
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
 * store_state 三动词形（03 §4.5 第四正门——插件只见裸键名，落库键由消费方
 * 拼装：基础面 storeStateFor 铸 `<pluginId>__` 域前缀，装配根注入裸动词）。
 * 与 persist Store 的 getStoreState/setStoreState/deleteStoreState 同名同形
 * （真身直传可赋——LRU 256 帽 + ttl 治理单源在 persist 层）。
 */
export interface SessionsStoreStateFace {
  /** 键值读（过期即视为缺——persist 层治理；受局面零校验） */
  get(key: string): StoreStateEntry | undefined;
  /** 键值写（upsert——值快照律 snapshotJsonValue 单源在 persist setStoreState） */
  set(key: string, value: unknown, options?: { ttlMs?: number; kind?: string }): void;
  /** 键值删（返回是否实际移除行——no-op 删除的判据位） */
  delete(key: string): boolean;
}

/**
 * kv/written 审计载荷（03 §4.5 T9 兑现注——key 为裸键名、值与 ttl/kind 元数据
 * 恒不入：审计账是归因面非数据镜像，credentials/changed 同律）。
 */
export interface KvWrittenPayload {
  readonly pluginId: string;
  readonly key: string;
  readonly action: 'set' | 'delete';
}

/**
 * sessions 服务完整面（03 §4.4 只读四件 + §4.5 受理制写两腿——cs-D1 落码
 * 定形注/兑现注）。词面独立律：memory 席消费本形（结构兼容即编译期验），
 * host 边不反向进 memory。
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

  /**
   * 进程当前前台会话 id（03 §4.4 落码定形注——判据 v1：活体会话登记表最新
   * 首次入册者，装配根注入真身〔SessionManager 活体 Map 尾键〕；幂等复开
   * 不移尾；无活体 = undefined 诚实缺席。线面显式 sessionId 路由纪律不变——
   * 本判据只作缺省锚）。
   */
  currentSessionId(): string | undefined;

  /**
   * 按类型读当前会话事件（锚 currentSessionId 所指会话的**活体** SessionLog
   * ——write-behind 在飞尾事件照读；05 §3.2 同名原语零第二实现面）。无活体
   * 会话即 `SESSION_NO_ACTIVE_SESSION` 拒（fail-loud——「读到 []」与「无可读
   * 会话」语义分立）；返回过滤快照（filter 产物恒新数组——内部数组引用不外泄）。
   */
  eventsOfType(type: string, opts?: { fromSeq?: number }): readonly SessionEvent[];

  /**
   * 最后一条完整 turn 边界的 seq（锚活体 SessionLog 同 eventsOfType）。原语
   * -1 哨兵（无闭合 turn）在本面映射 undefined——本签名 `number | undefined`
   * 单源（03 §4.4）。
   */
  lastClosedBoundary(): number | undefined;

  /**
   * 跨会话 durable 查询透传（05 §3.4 store 原语——帽 1000/10000 与游标分页
   * 单源在 persist，受理面零再帽零改写；含历史会话——durable 维跨活体。两
   * 时效差：在飞窗〔write-behind 未落库〕尾事件对本面不可见——05 §3.5 已知
   * 语义，不另设补偿）。
   */
  queryEvents(filter: QueryEventsFilter): QueryEventsResult;

  /**
   * store_state 域绑定三动词（03 §4.5 兑现注）：落库键 `<pluginId>__<键名>`
   * 宿主单方拼装（域前缀与键建表 `<pluginId>__<表名>` 同形同律——插件结构
   * 性读不到兄弟插件键值）；kv/written 审计随 set/delete 成功尾逐笔（装配根
   * 注入审计面）。宿主道消费位（插件道走 bindSessionsForPlugin 的 storeState
   * 直连——本成员在插件类型面 Omit 收窄）。
   */
  storeStateFor(pluginId: string): SessionsStoreStateFace;
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
 * 同形，但 **appendEventFor 的 caller 参数位与 storeStateFor 的域铸位结构性
 * 缺席**（Omit 收窄——PluginControlFace 同构先例）：归因/域前缀由绑定面闭包
 * 铸造（传入面无参数位——伪造结构性不存在），类型层同落此门——插件/模型经
 * 本类型面自报 caller 或自选 pluginId 须编译红（防冒名单源在类型面兑现）。
 */
export type PluginSessionsFace = Omit<SessionsFace, 'appendEventFor' | 'storeStateFor'> & {
  /** 插件道取引用形（caller 缺席——绑定面铸造 `{kind:'plugin', pluginId}` 后透传基础面） */
  appendEventFor(sessionId: string): AppendFn | undefined;
  /** store_state 三动词直连（域前缀绑定闭包铸 `<行id>__`——传入面无 pluginId 位） */
  readonly storeState: SessionsStoreStateFace;
};

/** 建 sessions 服务面的依赖集（装配根注入——全部真身，零缺省零部分面） */
export interface SessionsFaceOptions {
  /** 活体驱动取值器（appendEventFor 路径） */
  readonly driverOf: SessionsDriverOf;
  /**
   * 活体会话 id 取值器（currentSessionId 判据 v1 真身 = SessionManager 活体
   * Map 尾键——最新首次入册；装配根经 listActive().at(-1) 注入，本件零第二
   * 判据面）。
   */
  readonly currentSessionId: () => string | undefined;
  /** durable 跨会话查询（05 §3.4——帽与游标单源在 persist） */
  readonly queryEvents: (filter: QueryEventsFilter) => QueryEventsResult;
  /** store_state 裸动词（落库键拼装前——storeStateFor 铸域前缀后委派） */
  readonly storeState: SessionsStoreStateFace;
  /**
   * kv/written 审计发射位（audit_events 单写者面——05 §9）：set 实际写成功
   * 尾 / delete 实际移除尾逐笔；get 与 no-op 删除零落账、失败路径零审计。
   */
  readonly onStateWritten: (payload: KvWrittenPayload) => void;
}

/** 建 sessions 服务面（装配根：`bindSessionsForPlugin` 绑定后 fork 级提供） */
export function createSessionsFace(options: SessionsFaceOptions): SessionsFace {
  /** 活体 SessionLog 取值（只读三件共锚——currentSessionId 所指会话的活体日志） */
  const currentLogOf = (): SessionLog => {
    const sessionId = options.currentSessionId();
    const log = sessionId !== undefined ? options.driverOf(sessionId)?.session : undefined;
    if (log === undefined) {
      throw new BaseError(
        'SESSION_NO_ACTIVE_SESSION',
        `sessions 受理面只读件无活体会话可锚（currentSessionId = ${sessionId ?? 'undefined'}）` +
          `——eventsOfType/lastClosedBoundary 锚活体 SessionLog 不造 durable 替身；跨会话/历史读走 queryEvents（03 §4.4）`,
      );
    }
    return log;
  };
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
    currentSessionId() {
      return options.currentSessionId(); // 判据位透传——尾键语义归装配根（本件零第二判据）
    },
    eventsOfType(type, opts) {
      // filter 产物恒为新数组——快照副本律天然满足（内部数组引用不外泄）
      return currentLogOf().eventsOfType(type, opts);
    },
    lastClosedBoundary() {
      const boundary = currentLogOf().lastClosedBoundary();
      return boundary === -1 ? undefined : boundary; // -1 哨兵（无闭合 turn）→ undefined
    },
    queryEvents(filter) {
      return options.queryEvents(filter); // 恒等透传——零拷贝零改写零再帽
    },
    storeStateFor(pluginId) {
      const prefix = `${pluginId}__`; // 域前缀宿主单方拼装（与键建表域前缀同形同律）
      return {
        get: (key) => options.storeState.get(prefix + key),
        set: (key, value, setOptions) => {
          options.storeState.set(prefix + key, value, setOptions);
          // 成功尾发射（无异常即成功——失败路径零审计）；值/元数据恒不入载荷
          options.onStateWritten({ pluginId, key, action: 'set' });
        },
        delete: (key) => {
          const removed = options.storeState.delete(prefix + key);
          if (removed) options.onStateWritten({ pluginId, key, action: 'delete' }); // 实际移除才落账
          return removed;
        },
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
 * cs-D1 storeState 直连（03 §4.5 兑现注——单拍形）：键值动词无句柄两时点
 * 窗，行籍闸只在 set/delete **执行拍**执法（get 读径无闸——读不是写径，
 * §4.4 只读四件同律：换代后残柄读无害）。
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
  // 域绑定三动词铸一次（纯铸造无执法窗——前缀随绑定闭包固化，传入面无
  // pluginId 位防冒名单源）
  const mintedStore = face.storeStateFor(pluginId);
  /** 行籍闸·写动词执行拍（单拍形——无取引用拍） */
  const writeGate = (): void => {
    if (isRowActive !== undefined && !isRowActive()) {
      throw new BaseError(
        'PLUGIN_WINDOW_CLOSED',
        `插件 ${pluginId} 的会话受理窗已随装载代回卷——store_state 写动词拒执（行籍闸单拍，03 §4.5）`,
      );
    }
  };
  return {
    // 只读四件透传（03 §4.4——读径无行籍闸：读不是写径，换代后残柄读无害；
    // 归因/前缀拼装位为零——结构性无冒名面）
    currentSessionId: () => face.currentSessionId(),
    eventsOfType: (type, opts) => face.eventsOfType(type, opts),
    lastClosedBoundary: () => face.lastClosedBoundary(),
    queryEvents: (filter) => face.queryEvents(filter),
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
    // store_state 直连三动词：域前缀/审计随 storeStateFor 闭包执法；行籍闸
    // 只在写动词执行拍（get 读径无闸——读无副作用面）
    storeState: {
      get: (key) => mintedStore.get(key),
      set: (key, value, setOptions) => {
        writeGate();
        mintedStore.set(key, value, setOptions);
      },
      delete: (key) => {
        writeGate();
        return mintedStore.delete(key);
      },
    },
  };
}
