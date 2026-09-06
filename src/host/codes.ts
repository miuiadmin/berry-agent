/**
 * host 域错误码补落——`PLUGIN_` 族装载面码（02 §5.3 前缀族明列；语义真源 03 篇）。
 *
 * 注册纪律：import 发生才注册（与 tools/llm/session 的 codes.ts 同款）；
 * 同码重复注册由 contracts 注册表 fail-loud 执法（HOST_ERROR_CODE_CONFLICT）。
 * `PLUGIN_SHAPE_INVALID` 与 `API_` 族四码已随 contracts 首批/API 治理批在册，
 * 本处不重复注册。
 *
 * 遗留挂账：import 门禁越界拒载码（03 §3.3 字面量腿 + 兜底腿）与库句柄门禁码
 * （02 §5.3「禁直开宿主 SQLite」执法位）码名未定名——随装载器实装笔（批 12d）
 * 定名补落，本文件届时扩列。
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
];

registerErrorCodes(HOST_PLUGIN_ERROR_CODES);
