/**
 * host 域错误码补落——`PLUGIN_` 族装载面码（02 §5.3 前缀族明列；语义真源 03 篇）
 * + `TRIGGER_` 族两码（2026-09-07 触发器面 C 批补入——module 段 host 落码定形，
 * 语义真源 03 §2.2/§2.7 触发器行）。
 *
 * 注册纪律：import 发生才注册（与 tools/llm/session 的 codes.ts 同款）；
 * 同码重复注册由 contracts 注册表 fail-loud 执法（HOST_ERROR_CODE_CONFLICT）。
 * `PLUGIN_SHAPE_INVALID` 与 `API_` 族四码已随 contracts 首批/API 治理批在册，
 * 本处不重复注册。
 *
 * 批 12d 补落挂账两码：import 门禁越界拒载（03 §3.3 定名
 * `PLUGIN_IMPORT_FORBIDDEN`——字面量腿 throw 形执法 + fsCache 关；动态构造
 * 逃逸残差随沙箱立题，详 03 §3.3 批 12d 勘正段）与库句柄门禁（03 §4.3 定名
 * `PLUGIN_DB_HANDLE_FORBIDDEN`——宿主主库句柄结构性不外露；执法位 =
 * `berry-agent/sqlite` 虚拟键受局面 SqliteFace，face 件随其落码批消费本码）。
 */
import { registerErrorCodes, type ErrorCodeInfo } from '../contracts/index.js';

/** 批 12a 补落的 PLUGIN_ 族码目录（语义真源逐条注） */
export const HOST_PLUGIN_ERROR_CODES: readonly ErrorCodeInfo[] = [
  {
    code: 'PLUGIN_CONFIG_INVALID',
    module: 'host',
    description: '启用行 config 值不合清单 config schema（03 篇 §1.2——装载期拒绝式）',
  },
  {
    code: 'PLUGIN_ROW_INVALID',
    module: 'host',
    description: '启用清单行 schema 违例：未知键/id 缺席或坏形（03 篇 §5.3——行校验拒绝式）',
  },
  {
    code: 'PLUGIN_APPLY_FAILED',
    module: 'host',
    description: '插件 apply 入口抛错（03 篇 §1.3——处置按 /reload 失败三档行级隔离）',
  },
  {
    code: 'PLUGIN_INJECT_UNRESOLVED',
    module: 'host',
    description: '硬依赖（inject）求值后服务缺席拒启（03 篇 §1.3——软依赖缺席仅记 warn）',
  },
  {
    code: 'PLUGIN_ENTRY_UNRESOLVED',
    module: 'host',
    description: '入口模块解析失败：entry 指向文件不存在/不可解析（03 篇 §1.3）',
  },
  {
    code: 'PLUGIN_LOAD_FAILED',
    module: 'host',
    description: 'jiti 装载失败：语法错误/运行时顶层抛错（03 篇 §1.3）',
  },
  {
    code: 'PLUGIN_RATE_LIMITED',
    module: 'host',
    description: '装载器频率护栏：单插件注册/事件动作 >1000 次/1000ms 即拒（03 篇 §3.4）',
  },
  {
    code: 'PLUGIN_EVENT_TYPE_CONFLICT',
    module: 'host',
    description: 'durable 事件词汇撞名拒注册：撞 LIVE 词表既有词汇即拒（03 篇 §2.7 逐动词冲突律——词法身份面拒绝式）',
  },
  {
    code: 'PLUGIN_PROMPT_SLOT_INVALID',
    module: 'host',
    description: '提示词段 slot 非法：非域前缀两段式/域前缀不等于本插件 id（03 篇 §2.7——无 / 单段系宿主自留地不可达）',
  },
  {
    code: 'PLUGIN_PROMPT_SECTION_CONFLICT',
    module: 'host',
    description: '提示词段同 slot 重复注册：两段同位即装配冲突响亮失败（03 篇 §2.7——不静默覆盖）',
  },
  {
    code: 'PLUGIN_HOOK_UNKNOWN',
    module: 'host',
    description: 'hookName 不在钩子主表即拒订阅：fail-closed，未知钩子不静默吞（03 篇 §2.4/§2.7）',
  },
  {
    code: 'PLUGIN_WINDOW_CLOSED',
    module: 'host',
    description:
      '装载窗口外调用注册动词拒（03 篇 §2.1——唯一例外：宿主回调上下文内〔钩子 handler/工具执行期〕合法，装载器以回调窗重入计数开合）',
  },
  {
    code: 'PLUGIN_IMPORT_FORBIDDEN',
    module: 'host',
    description:
      'import 门禁越界拒载：依赖图说明符不在三道白名单（虚拟键/node: 内建/插件目录树内——03 §3.3；字面量腿 transform 钩子 throw 形执法〔error 通道不抛已实证〕+ jiti fsCache 关；门禁定位 = 架构边界非反恶意沙箱，动态构造逃逸残差随沙箱立题）',
  },
  {
    code: 'PLUGIN_DB_HANDLE_FORBIDDEN',
    module: 'host',
    description:
      '库句柄门禁：违例触达宿主主库句柄（主库句柄结构性不外露——03 §4.3；执法位 = berry-agent/sqlite 受局面 SqliteFace，随 face 件落码批消费）',
  },
  {
    code: 'PLUGIN_CAPABILITY_DOOR_CLOSED',
    module: 'host',
    description:
      '高危面默认关拒：插件未获用户开门授予即触达高危面注册/换装（03 §4.6 用户主权开门制——授予位唯一正门 = 启用清单行 opens；裁决核 = contracts adjudicateCapabilityDoor，throw 位随界面后端换装缝/路由受理面落码批接线）',
  },
  {
    code: 'TRIGGER_NAME_EXISTS',
    module: 'host',
    description:
      '触发器撞名拒：name 撞既有在册触发器（含 issue 件 core: 域）——词法身份面拒绝式，审计归因面重影即歧义（03 §2.7；2026-09-07 触发器面 C 批锚定，执法随 C-2 注册面接线）',
  },
  {
    code: 'TRIGGER_NAME_INVALID',
    module: 'host',
    description:
      '触发器名词法违例拒：name 非域名两段式或域前缀 ≠ 本插件 id（core: 件去前缀取 name 段——防跨插件冒名，03 §2.7 registerSection 行同法；2026-09-07 触发器面 C 批锚定，执法随 C-2 注册面接线）',
  },
];

registerErrorCodes(HOST_PLUGIN_ERROR_CODES);
