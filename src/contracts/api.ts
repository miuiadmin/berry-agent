/**
 * L0 contracts — API 治理元数据单源 + 协商层纯函数（03 篇 §8，2026-09-05
 * API 治理批 2 落码）。
 *
 * 本文件 = API 面身份层的机器可读真相源（§8.2 六真相源中的三处）：
 * - `VIRTUAL_API_KEYS`：虚拟模块键表（键 + tier + since——§8.3 键级 tier 载体；
 *   loader 注入表、抽取器、check-api 三面共取此单源）
 * - `SERVICE_CATALOG`：ctx 服务面目录（首条真实 ctx 服务落码批增条——现空集）
 * - `CAPABILITIES`：能力面目录（surface.json 顶层 capabilities[] 的声明位，
 *   §8.5 ctx.host.capabilities 派生源；起算集 = core: 可卸件能力面——批 U2
 *   首登 v1 高危面两枚并携 `userGrantable` 开门制标注）
 *
 * 加协商层纯函数（§8.4 装载门四出口 + 版本比较语义）与 ctx.host 自省面类型
 * （§8.5——HostFace 插件侧形态 / HostFaceInput 装配侧纯数据输入）。
 * 全部纯数据/纯函数：零副作用、jiti 可载（工具面 check-api/抽取器直接 import）。
 *
 * 分桶纪律（§8.3 internal 行 + §8.4 公开根分桶）：本文件顶层导出分两桶——
 * 可见桶六名经 contracts/index.ts 显式 re-export 进公开根（插件作者可消费面）；
 * internal 机制桶八名不进公开根（宿主治理机制非插件 API，内核消费深导
 * contracts/api.js）。分桶不变式由抽取器 assertApiBucketPartition fail-loud
 * 执法：新顶层导出未分桶即炸（白名单单点 tools/extract-api-surface.mjs
 * INTERNAL_API_EXPORTS）。
 */
import { BaseError } from './errors.js';

/* ---------------- 稳定性三级（§8.3） ---------------- */

/**
 * API 稳定性 tier 词汇（§8.3 四级表的前三级——internal 结构性不可达不进
 * 公开面，故不在本联合）。stable/experimental 执法粒度 = 键级；deprecated 恒
 * 逐符号。目录宿主符号（本文件各目录 + EventTypeMeta）以此类型为**必填字段**
 * ——TS 编译期即红扛零隐式（零隐式 API 原则的载体精化）。
 */
export type ApiTier = 'stable' | 'experimental' | 'deprecated';

/** apiVersion 格式：MAJOR.MINOR 两段（API 面无 patch——§8.1） */
const API_VERSION_FORMAT = /^\d+\.\d+$/;

/* ---------------- 真相源 #1：虚拟模块键表（§8.2 / §8.3 键级载体） ---------------- */

/** 虚拟模块键登记项（§8.3 键级 tier 载体——tier 列在此单源；模块私有不导出） */
interface VirtualApiKeyEntry {
  /** 虚拟模块说明符（插件 import 所写键名——loader 注入表键域） */
  readonly key: string;
  /** 稳定性 tier（键级单一整键——混合键结构性不设） */
  readonly tier: ApiTier;
  /** 该键进入 API 面的 apiVersion（首快照全 1.0——预置号非承诺起点，§8.1） */
  readonly since: string;
}

/**
 * 虚拟模块键表——现役五键全 `stable`（§8.3：berry-agent/llm 是已落码正路非预览；
 * typebox 三键纯转发）。loader 的注入表由本表派生（注入表不另持键单源）；
 * 实验件未来以新键 + tier 'experimental' 进。
 *
 * `berry-agent/sqlite` 键（规范目标态六键之一）**推迟至 persist SqliteFace
 * 落码批进表**：查 1 要求每键至少一条导出、无真身即红——表收现役真源，
 * 键进表 = 真身在场（§8.3 批 2 落码注记）。首条 ctx 服务（SERVICE_CATALOG）
 * 与首个 core: 能力（CAPABILITIES）同律随各自落码批进表。
 */
export const VIRTUAL_API_KEYS: readonly VirtualApiKeyEntry[] = [
  { key: 'berry-agent', tier: 'stable', since: '1.0' },
  { key: 'typebox', tier: 'stable', since: '1.0' },
  { key: 'typebox/value', tier: 'stable', since: '1.0' },
  { key: 'typebox/compile', tier: 'stable', since: '1.0' },
  { key: 'berry-agent/llm', tier: 'stable', since: '1.0' },
];

/* ---------------- 真相源 #2：ctx 服务面目录（§4 ctx 契约面的码面镜像） ---------------- */

/** ctx 具名服务目录项（逐符号 tier——§8.3 非虚拟键面半边；模块私有不导出） */
interface ServiceCatalogEntry {
  /** ctx.get(name) 服务名（官方名位单段式） */
  readonly name: string;
  /** 服务归属模块（拓扑席名——抽取器按此寻址接口源文件） */
  readonly module: string;
  /**
   * 服务面契约接口名（方法级符号）：指向宿主模块公开面导出的 interface
   * 声明名（provide 对象 satisfies 本型——面漂移编译期即红）。抽取器按
   * module 列寻址接口源文件、枚举其成员，每方法/属性一符号进 surface.json
   * exports[]（module='services'，symbol=`服务名.成员名`）。
   */
  readonly faceInterface: string;
  /** 一句话语义（surface.json 文档面消费） */
  readonly note: string;
  /** 稳定性 tier（必填——零隐式载体） */
  readonly tier: ApiTier;
}

/**
 * ctx 服务面目录：现空集——首条真实 ctx 具名服务落码批增条（drift 闸守快照，
 * 目录本身是声明面——声明即 API）。抽取器 services 块循环本表（空即零次），
 * 接口切片机制已就位、首条目落码即活。
 */
export const SERVICE_CATALOG: readonly ServiceCatalogEntry[] = [];

/* ---------------- 真相源 #3：能力面目录（§8.5 capabilities 派生源） ---------------- */

/** 能力目录项（surface.json 顶层 capabilities[] 的声明位形态；模块私有不导出） */
interface CapabilityEntry {
  /** 能力名：`件域.能力` 两段式（§8.5 名空间——字符集与事件词汇同纪律） */
  readonly name: string;
  /**
   * 提供方（能力位所属域的承载方）：core: 官方件引用形（`core:sdk`）或宿主
   * 固定件席位名（`channels`）——与 name 前段（件域）同源，两类形皆指域内
   * 单一承载方，非泛标签。
   */
  readonly providedBy: string;
  /**
   * 高危面开门制标注（§4.6 批 U1 定形）：`true` = 该能力位系用户可开高权面
   * ——默认关，唯一开门径 = 启用清单 `opens` 授予位显式授权（值域单源即本
   * 标注派生面 USER_GRANTABLE_CAPABILITIES）。缺省无此键 = 常规能力位。
   */
  readonly userGrantable?: true;
}

/**
 * 能力面目录：core: 可卸件能力起算集（§8.5——ctx.host.capabilities 读此层）。
 * 语义 = **本构建面**（编译进包即有——启用清单是否挂载属运行时态，两问不混）。
 * 批 U2 首登 v1 首批高危面两枚（§4.6——`userGrantable` 开门制标注单源）：
 * - `channels.ui-backend`：替换界面后端（UiBackend 实装换装——02 §2 表 #6
 *   重述所指高权面；承载方 = channels 宿主固定件〔自研 TUI 引擎席位〕）；
 * - `sdk.register-route`：注册网页路由（sdk HTTP 面路由扩展位——03 §10.6；
 *   承载方 = core:sdk 件）。
 * 后续高危面经三路准入扩枚举同律入册（§4.6）；构建差能力随真实构建分叉日
 * 启用 `API_CAPABILITY_MISSING`（预留码，本批无 thrower）。
 */
export const CAPABILITIES: readonly CapabilityEntry[] = [
  {
    name: 'channels.ui-backend',
    providedBy: 'channels',
    userGrantable: true,
  },
  {
    name: 'sdk.register-route',
    providedBy: 'core:sdk',
    userGrantable: true,
  },
];

/**
 * 高危面开门名单单源（§4.6 登记单源的派生面）：CAPABILITIES 中 `userGrantable`
 * 标注位的能力名清单。启用清单 `opens` 授予位的**值域即此名单**（行校验拒绝
 * 式消费——host/manifest）；门检裁决（adjudicateCapabilityDoor）同源判「是否
 * 高危面」。派生不另持单源——目录增删高危面，本面与校验/门检三面共变。
 */
export const USER_GRANTABLE_CAPABILITIES: readonly string[] = CAPABILITIES.filter((c) => c.userGrantable === true).map(
  (c) => c.name,
);

/**
 * 门检裁决结果（§4.6 开门语义的裁决面形态——纯数据，fail-loud 抛掷归宿主
 * 注入位：装载器/换装缝按 kind 包 `PLUGIN_CAPABILITY_DOOR_CLOSED`）。
 */
export type CapabilityDoorVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      /**
       * not-a-door = 能力名不在高危面名单（非高危面或不存在——宿主侧误用面，
       * 装配缺陷级）；door-closed = 系高危面但该插件未获用户开门授予（§4.6
       * 默认关的正当拒绝面——插件侧可期事件，message 指路授予位写法）。
       */
      readonly kind: 'not-a-door' | 'door-closed';
      /** 人读裁决信息（throw 时的 message 底稿） */
      readonly message: string;
    };

/**
 * 高危面门检裁决（§4.6——用户主权开门制的执法判定核；纯函数零副作用）。
 *
 * 判定两序：①能力名 ∈ USER_GRANTABLE_CAPABILITIES（不是高危面即 not-a-door
 * ——常规能力位不走开门制，宿主侧把非门面接进门检系装配缺陷）；②该插件的
 * 开门授予集是否含此名（缺席 = 默认关 door-closed）。开门授予集 = 启用清单
 * 行 `opens` 位（读侧行校验已保证值域合法——本函数对集外值不再复验，信任
 * 前置校验）。**调用方 = 宿主注入位**（界面后端换装缝/路由受理面随批 U3/U5
 * 落地接线）；插件代码结构性不可达本函数（开门是宿主裁决面非插件 API）。
 */
export function adjudicateCapabilityDoor(opened: ReadonlySet<string>, capability: string): CapabilityDoorVerdict {
  if (!USER_GRANTABLE_CAPABILITIES.includes(capability)) {
    return {
      ok: false,
      kind: 'not-a-door',
      message: `能力位 ${capability} 不在高危面名单（现役：${USER_GRANTABLE_CAPABILITIES.join('、')}）——常规能力位不走开门制，宿主注入位接错面或能力名拼错`,
    };
  }
  if (!opened.has(capability)) {
    return {
      ok: false,
      kind: 'door-closed',
      message: `高危面 ${capability} 默认关（用户主权开门制 03 §4.6）——本插件未获开门授予；开法：启用清单 enabled.yaml 该插件行加 opens: ["${capability}"] 后重装载，撤位即收回`,
    };
  }
  return { ok: true };
}

/* ---------------- 版本比较与装载门（§8.4） ---------------- */

/**
 * apiVersion 比较（§8.4 版本比较语义）：MAJOR.MINOR 逐段数值比较——禁字符串
 * 比较（"1.10" > "1.9"）。格式非法抛 API_VERSION_MALFORMED（调用方 = 清单
 * 校验后的执法面，正常路径格式已验）。
 * @returns 负数 = a < b；0 = 相等；正数 = a > b
 */
export function compareApiVersions(a: string, b: string): number {
  const pa = parseApiVersion(a);
  const pb = parseApiVersion(b);
  return pa[0] !== pb[0] ? pa[0] - pb[0] : pa[1] - pb[1];
}

/**
 * API 族错误消息公共指路尾注（公开锚——运行时字符串不指路知识域）。
 *
 * 指路目标 = 仓库公开文档面（COMPATIBILITY.md 与 docs/API参考.md——批 4
 * 收剑点火件落地后在场；本批先占位词面，两件生成后即真）。第三方插件作者
 * 顺错误消息可达；知识域篇名/章节号（gitignored）禁入运行时字符串。
 * 本模块三条拒载消息统一缀此尾注：拒载消息自带「下一步去哪读」。
 * 模块私有（不入公开桶——INTERNAL_API_EXPORTS 白名单无需扩）。
 */
const API_DOC_ANCHOR_NOTE = 'API 治理语义见仓库 COMPATIBILITY.md 与 docs/API参考.md。';

/** 解析 apiVersion 为 [MAJOR, MINOR] 数值对；格式非法即抛（单点执法） */
function parseApiVersion(v: string): [number, number] {
  if (!API_VERSION_FORMAT.test(v)) {
    throw new BaseError(
      'API_VERSION_MALFORMED',
      `apiVersion 格式非法：${v}（应为 MAJOR.MINOR，如 "1.0"）${API_DOC_ANCHOR_NOTE}`,
    );
  }
  const [major, minor] = v.split('.');
  return [Number(major), Number(minor)];
}

/**
 * 断言 apiVersion 格式合法（清单校验面用——错误归 PLUGIN_INVALID 语境由调用方
 * 包，本函数只做纯格式判定的复用体）。
 */
export function isValidApiVersion(v: string): boolean {
  return API_VERSION_FORMAT.test(v);
}

/**
 * API 兼容执法收剑点火位（§8.4「批 4 翻必填」+ §8.10 批表——机器在窗口内、
 * 兼容执法单点收剑）。
 *
 * - `false`（现役）= pre-release 窗口容忍态：api 块缺席走 legacy 出口聚合 warn；
 * - `true`（首个 dist-tag=latest 当笔翻转）= 点火：api 块缺席从 warn 变拒载
 *   （`API_VERSION_MISMATCH`），min fail-loud 对全体插件生效。
 *
 * **散拷禁令**（§8.4）：常量消费面恰两处——adjudicateApiGate 出口 4（行为面：
 * 缺块 warn/拒载）与抽取器 enforcement 纪元章（tools/extract-api-surface.mjs
 * ——只读单源盖章进面快照，不改不散播，§8.10 点火可见性）；测试经纯函数
 * `ignited` 参数注入两态，不改常量。点火日翻转 = 改此单点 + 同笔测试 + 快照
 * 再生成（enforcement 纪元章随翻转变色——查 1 自然拦）。
 */
export const API_ENFORCEMENT_IGNITED = false;

/** 清单 api 块形状（package.json `api` 键运行时形——§8.4） */
export interface ApiBlock {
  /** 硬地板：宿主 apiVersion < min 即拒载（api 块在场则必填） */
  readonly minApiVersion: string;
  /** 行为锚（可选——缺省 = min 粘性锚：不声明恒持 min 时点面） */
  readonly targetApiVersion?: string;
  /** 实验键启用声明（键级——import 实验键未声明 = 装载期拒） */
  readonly experimental?: readonly string[];
}

/** 装载门裁决结果（§8.4 四出口的机器形态——legacy 态不拒载只聚合 warn） */
export interface ApiGateResult {
  /** 出口：legacy（api 块缺席）/ admit（三兼容出口统称——钳制细节见 effectiveTarget） */
  readonly status: 'legacy' | 'admit';
  /** 生效 target = min(宿主 apiVersion, targetApiVersion)（钳制出口的核心值） */
  readonly effectiveTarget: string;
  /** 声明的实验键集合（experimental import 门禁数据源——loader 消费） */
  readonly experimentalKeys: ReadonlySet<string>;
}

/**
 * 装载门序（§8.4 四出口全定义）。纯函数：清单 api 块 × 宿主 apiVersion → 裁决。
 * 全入口同律——凡构造装载计划的进路必经同一根公式（装机腿 / boot 合成腿 /
 * 试件腿 / 收割腿 / core: 装载）。出口：
 * 1. 宿主 < min → 抛 `API_VERSION_MISMATCH`（拒载——message 载 expected/actual/
 *    升级指引三段）；
 * 2. min ≤ 宿主 < target → 钳制不警示（生效 target = min(宿主, target)）；
 * 3. 宿主 > target → 正常兼容态不警示（editions 设计目的）；
 * 4. api 块缺席 → 点火前 status 'legacy'（调用方聚合 per-boot warn）；点火后
 *    （`API_ENFORCEMENT_IGNITED` 翻 true）抛 `API_VERSION_MISMATCH` 拒载——
 *    「批 4 翻必填」的唯一机器翻转点。
 * 格式/不变式（min ≤ target）由清单校验先执法——本函数防御式复验格式，
 * 不变式信任前置校验。
 *
 * @param ignited 点火位注入（缺省 = `API_ENFORCEMENT_IGNITED` 常量单源——测试
 *   两态注入专用参数，产码调用点不传）。
 */
export function adjudicateApiGate(
  api: ApiBlock | undefined,
  hostApiVersion: string,
  pluginId: string,
  ignited: boolean = API_ENFORCEMENT_IGNITED,
): ApiGateResult {
  // 出口 4：api 块缺席——点火前 legacy 容忍态（面/行为按宿主当前——不进任何兼容
  // 模式）；点火后拒载（min fail-loud 全体生效的机器形态）
  if (api === undefined) {
    if (ignited) {
      throw new BaseError(
        'API_VERSION_MISMATCH',
        `插件 ${pluginId} 清单（package.json）缺 api 块——兼容执法已点火（api 块必填），` +
          `须在 package.json 补 "api": { "minApiVersion": "<宿主当前 apiVersion 或更旧>" }` +
          `（批 4 翻必填——min fail-loud 与兼容模式对全体插件生效）。${API_DOC_ANCHOR_NOTE}`,
      );
    }
    return { status: 'legacy', effectiveTarget: hostApiVersion, experimentalKeys: new Set() };
  }
  const min = api.minApiVersion;
  const target = api.targetApiVersion ?? min; // 粘性锚：缺省 = min 的值
  parseApiVersion(min); // 防御式格式复验（前置校验已红过一次）
  parseApiVersion(hostApiVersion);
  // 出口 1：硬地板拒载（fail-loud 三段消息）
  if (compareApiVersions(hostApiVersion, min) < 0) {
    throw new BaseError(
      'API_VERSION_MISMATCH',
      `插件 ${pluginId} 声明 minApiVersion ${min}，宿主 API 面版本 ${hostApiVersion} 低于地板——拒载。` +
        `升级指引：升级 berry-agent 宿主包（npm i -g berry-agent@latest）或联系插件作者放宽 minApiVersion。${API_DOC_ANCHOR_NOTE}`,
    );
  }
  // 出口 2/3：钳制与兼容统称 admit——生效 target = min(宿主, target)（钳制出口
  // 的值在兼容出口自然等于 target，两出口同式不分支——「钳制不警示」的机器形态）
  const effectiveTarget = compareApiVersions(hostApiVersion, target) < 0 ? hostApiVersion : target;
  return { status: 'admit', effectiveTarget, experimentalKeys: new Set(api.experimental ?? []) };
}

/**
 * experimental import 门禁（§8.4 执法点——与说明符白名单门禁同执法位的纯裁决核）：
 * import 实验键而清单未声明 → 抛 `API_EXPERIMENTAL_UNDECLARED`。契约即知情：
 * 能用可破面 = 你签了字。键表之外的说明符不属本门禁（白名单三道另辖）。
 */
export function assertExperimentalDeclared(
  specifier: string,
  declared: ReadonlySet<string>,
  pluginId: string | undefined,
): void {
  const entry = VIRTUAL_API_KEYS.find((k) => k.key === specifier);
  if (entry === undefined || entry.tier !== 'experimental') return;
  if (declared.has(specifier)) return;
  throw new BaseError(
    'API_EXPERIMENTAL_UNDECLARED',
    `import 实验键 ${specifier} 未在清单声明——插件 ${pluginId ?? '(未知插件)'} 须在 package.json ` +
      `api 块 experimental 数组显式点名该键方能启用（契约即知情：实验键任意 minor 可破可删）${API_DOC_ANCHOR_NOTE}`,
  );
}

/* ---------------- ctx.host 自省面（§8.5） ---------------- */

/**
 * 宿主自省面——插件问宿主，而非探测猜（rc 随意改名逼出 Function.length 探测
 * 是生态病根的正解；§8.5 面定义）。插件侧经 `ctx.host` 只读取得；装配根一次
 * 性注入（ContextRuntime 持有，fork 共享运行时天然级联）。
 * 〔与 berry 对照注记：formFactor 字段随多形态蒸发——单机单形态〕
 */
export interface HostFace {
  /** 宿主包版本（package.json version） */
  readonly version: string;
  /** API 面版本（package.json apiVersion——§8.1 独立号） */
  readonly apiVersion: string;
  /** 本构建面能力集（has = 构建面有无，非启用清单挂载态——两问不混） */
  readonly capabilities: {
    has(name: string): boolean;
    list(): string[];
  };
  /** 实验面启用探针：键在本构建面在场且 tier = experimental */
  readonly experimental: {
    enabled(name: string): boolean;
  };
}

/**
 * HostFace 的纯数据输入（装配根物化用）：capabilities/experimentalKeys 清单
 * 派生源 = surface.json capabilities[] 与键表 tier=experimental 子集。〔与
 * berry 对照注记：无分域桥接——HostFaceData 快照 + 对岸物化的桥接档随
 * worker 域概念整体蒸发，单装配点直接物化〕
 */
export interface HostFaceInput {
  readonly version: string;
  readonly apiVersion: string;
  /** 能力名清单（has/list 的数据底座——派生源 surface.json capabilities[]） */
  readonly capabilities: readonly string[];
  /** 实验键清单（experimental.enabled 的数据底座——键表 tier=experimental 子集） */
  readonly experimentalKeys: readonly string[];
}

/** 由纯数据输入物化 HostFace（装配根唯一构造点——ctx.host 只读面由此而来） */
export function materializeHostFace(data: HostFaceInput): HostFace {
  const capabilitySet = new Set(data.capabilities);
  const experimentalSet = new Set(data.experimentalKeys);
  return {
    version: data.version,
    apiVersion: data.apiVersion,
    capabilities: {
      has: (name: string) => capabilitySet.has(name),
      list: () => [...capabilitySet],
    },
    experimental: {
      enabled: (name: string) => experimentalSet.has(name),
    },
  };
}
