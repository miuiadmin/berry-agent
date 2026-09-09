/**
 * 错误码注册表与单一错误基类（02 篇 §5.3 错误码族规范；07 篇 §8 表 #9 定名）。
 *
 * 四条族规范（02 §5.3）：
 *  1. 形态：字符串错误码（SCREAMING_SNAKE + 模块前缀族），不搞兼容、定死一条路线；
 *  2. 注册目录：错误码与事件类型同一纪律——contracts 显式注册、运行时可枚举、
 *     CI 校验抛出/写入点一致；插件扩展错误码同样显式注册，禁止字符串字面量散落；
 *  3. 进程内载体：全仓单基类 BaseError（Error 子类，{ code, message, cause? }）——
 *     类不是词汇、码才是身份；禁止每码一类，catch 一律按 code 分派；
 *  4. durable 事件内一律写码：错误信息 = code + 人读 message（日志自描述）。
 */

/**
 * 全仓单一错误基类（07 篇 §8 表 #9 定名，2026-09-05 冷读闸补定）。
 *
 * 用法约定：catch 一律按 `err instanceof BaseError && err.code === 'XXX'` 分派
 * （或直接读 code 字段判别——码才是身份，类只作载体）；禁止为单个错误码派生子类。
 */
export class BaseError extends Error {
  /** 错误码身份（SCREAMING_SNAKE + 模块前缀，注册表成员） */
  readonly code: string;

  /**
   * @param code 错误码（须已在注册表——本构造器不拦截，注册纪律由写入点与 CI 执法）
   * @param message 人读错误信息（与 code 一道进 durable 事件的错误腿）
   * @param options.cause 底层异常（可选；Error 原生 cause 语义）
   */
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'BaseError';
    this.code = code;
  }
}

/** 错误码目录条目（可枚举目录 = 注册表值形态） */
export interface ErrorCodeInfo {
  /** 错误码（SCREAMING_SNAKE + 模块前缀） */
  code: string;
  /** 归属模块（宿主件名或插件 id）——CI 对账「抛出/写入点一致」的依据 */
  module: string;
  /** 中文语义描述（生成目录用） */
  description: string;
}

/**
 * 错误码前缀族明列（02 篇 §5.3 #1）——文档性常量，供注册面校验与 CI 目录生成；
 * 'HOST_' 系装配根码族（单活跃机 HOST_DATA_DIR_BUSY 等，07 篇 §1 定名位）。
 */
export const ERROR_CODE_PREFIXES = [
  'TOOL_',
  'FS_',
  'SESSION_',
  'SANDBOX_',
  'LLM_',
  'EXEC_',
  'PROVIDER_',
  'APPROVAL_',
  'CHANNEL_',
  'WEB_',
  'CONTEXT_',
  'SKILLS_',
  'PLUGIN_',
  'HOST_',
  'PERSIST_',
  'API_',
  'AGENT_',
  'SDK_',
  'SCHEDULER_',
  'GOAL_',
  'SUBAGENT_',
  'JOB_',
  'TRIGGER_',
  'CREDENTIALS_',
  'DANGER_',
] as const;

/**
 * 宿主核心错误码首批清单（规范已定名者全列；各模块落码批随纵切逐批增补——
 * 增补走 registerErrorCodes 显式注册，禁止字面量散落）。
 */
const CORE_ERROR_CODES: readonly ErrorCodeInfo[] = [
  {
    code: 'SESSION_UNKNOWN_EVENT_TYPE',
    module: 'session',
    description: 'append 词汇检查红：事件类型未在词汇注册表（fail-loud 宁崩不默默丢）',
  },
  {
    code: 'SESSION_EVENT_OVER_BUDGET',
    module: 'session',
    description: '单条事件 JSON 序列化超 60KiB 硬帽（预算刀只裁腿不改判的触发标记）',
  },
  {
    code: 'SESSION_CORE_TYPE_FORBIDDEN',
    module: 'session',
    description: '核心事件词身份拒绝装载面注册/伪造（双闸判据同源，05 篇 §1.1）',
  },
  {
    code: 'SESSION_NOT_FOUND',
    module: 'session',
    description: '线/接口面命中不存在的会话（批 13b 随 SDK 请求面受理注册——webui 404 同语义）',
  },
  {
    code: 'SESSION_CLOSED',
    module: 'session',
    description: '线/接口面向已闭会话新发拒收（回放读面不受限——批 13b 随 SDK 请求面受理注册）',
  },
  {
    code: 'HOST_DATA_DIR_BUSY',
    module: 'host',
    description: '单活跃机拒启：同数据目录活跃标记在场且 pid 活（fail-loud 不降级）',
  },
  {
    code: 'HOST_ERROR_CODE_CONFLICT',
    module: 'host',
    description: '错误码注册冲突：同码被两方注册（装配期 fail-loud）',
  },
  {
    code: 'HOST_EVENT_TYPE_CONFLICT',
    module: 'host',
    description: '事件类型注册冲突：同型被两方注册（装配期 fail-loud）',
  },
  {
    code: 'PLUGIN_SHAPE_INVALID',
    module: 'host',
    description: '插件入口形状无效：entry 缺席且无声明载荷时 main default export 缺失/不可解析（03 篇入口解析序③）',
  },
  {
    code: 'API_VERSION_MISMATCH',
    module: 'host',
    description: '装载门版本不符拒载：宿主 API 版本低于清单 min，或点火后清单缺 api 块（03 篇 §8.4）',
  },
  {
    code: 'API_EXPERIMENTAL_UNDECLARED',
    module: 'host',
    description: '插件消费实验档（experimental）API 符号但清单 api 块未声明该键（03 篇 §8.4）',
  },
  {
    code: 'API_VERSION_MALFORMED',
    module: 'host',
    description: 'api 块版本串坏形（非 x.y 整数点分两段；03 篇 §8.4 坏形防御）',
  },
  {
    code: 'API_CAPABILITY_MISSING',
    module: 'host',
    description: '（预留）宿主能力面缺席清单所需能力——可选件构建差能力分叉日启用，结构化 message 载缺席能力名清单',
  },
  {
    code: 'AGENT_CONTINUE_INVALID',
    module: 'agent',
    description: 'continueRun 末角色校验红：末消息经 convertToLlm 转换后非 user/toolResult（04 篇 §2 入口两式）',
  },
  {
    code: 'AGENT_ROLE_EXISTS',
    module: 'agent',
    description: '自定义消息角色撞名：标准角色名或既有在册自定义角色（03 篇 §2.7 消息面拒绝式）',
  },
  {
    code: 'AGENT_ROLE_INVALID',
    module: 'agent',
    description: '自定义消息角色名违域名前缀两段式纪律（恰含一个 /、两段均小写字母数字连字符）',
  },
  {
    code: 'CHANNEL_COMMAND_INVALID',
    module: 'channels',
    description:
      '命令名词法违例拒注册：主段连字符式 + 可选冒号子段（03 篇 §2.2 签名定形——撞名后写胜出不拒、词法违例拒）',
  },
  {
    code: 'CHANNEL_BACKEND_RESERVED',
    module: 'channels',
    description:
      '插件注册界面后端 id 撞宿主域拒——后端 id 分域律执法（03 篇 §2.7：宿主后端宿主装配独占、插件结构性不可顶替；07 篇 §4 宿主后端恒在场条款执法承载）',
  },
  {
    code: 'SDK_PROTOCOL_MISMATCH',
    module: 'sdk',
    description: '线协议版本握手拒连：双方 protocolVersion 不匹配 fail-loud（03 篇 §10.6 线协议⑤）',
  },
  {
    code: 'SDK_SESSION_BUSY',
    module: 'sdk',
    description: '会话受理竞态拒收档：并发 prompt 路由不可行态专用（03 篇 §10.6 请求面——驱动侧单源路由缺省吞并发）',
  },
  {
    code: 'SDK_MESSAGE_CONFLICT',
    module: 'sdk',
    description: '幂等 admit 异内容：同 messageId 异内容拒收（03 篇 §10.6 线协议④——同 ID 同内容幂等重收执不重跑）',
  },
  {
    code: 'SDK_OVERLOADED',
    module: 'sdk',
    description: '线面出站过载：有界队列溢出拒收、可重试（03 篇 §10.6 线协议⑦——载荷携 retryAfter）',
  },
  {
    code: 'SDK_CURSOR_INVALID',
    module: 'sdk',
    description: '线面游标非法形：after 越高水位 / 崩溃截尾后旧游标作废（05 篇 §3.5——调用方从头或 getEntries 重对账）',
  },
  {
    code: 'SDK_DECODE',
    module: 'sdk',
    description:
      'HTTP 体解码/深校验拒（03 §10.6 批 13e-2 定形⑤——stdio 形坏行 warn 跳过不杀连接，HTTP 形 400 携错误帧）',
  },
  {
    code: 'SDK_UNAUTHORIZED',
    module: 'sdk',
    description: 'HTTP 面鉴权失败：token 配置在场而凭证缺席/不符（03 §10.6 批 13e-2 定形⑤——Bearer 形携 token）',
  },
  {
    code: 'SDK_FORBIDDEN',
    module: 'sdk',
    description: 'HTTP 面 Host/Origin 防线拒（03 §10.6 批 13e-2 定形⑤——回环钉死三防线 10.4 同律）',
  },
  {
    code: 'SDK_ROUTE_PATH_RESERVED',
    module: 'sdk',
    description:
      '插件道路由 path 撞保留前缀闭集（/v1/·/plugins/）或越域坏形拒——前缀拼合单源执法的防御性回弹层（03 §10.6 U5 定形注：执法位本在 core: 道注册器，插件道经前缀施加律结构性框死于 /plugins/<id>/ 之下）',
  },
  {
    code: 'SDK_ROUTE_AUTH_FORBIDDEN',
    module: 'sdk',
    description:
      '插件道申报不可用鉴权档拒——self 与 open{purpose:auth-exchange} 两逃生档不对插件道开放（03 §10.6 U5 收窄四件①）',
  },
  {
    code: 'SDK_ROUTE_BODY_LIMIT',
    module: 'sdk',
    description:
      '插件道路由 bodyLimitBytes 超钳帽拒——须正整数且 ≤1MiB 可小不可大、缺席即 1MiB 受理面填值（03 §10.6 U5 收窄四件③：防面级缺省 10MiB 静默穿透）',
  },
  {
    code: 'SDK_ROUTE_LIMIT_REACHED',
    module: 'sdk',
    description:
      '插件道路由数帽 16 per-plugin 达帽拒——受理面计数、摘除 fn 释放后可再注册（03 §10.6 U5 收窄四件④；门检/窗外/查重三拒复用既有码零新立）',
  },
];

/** 注册表本体（code → 目录条目）；模块加载时灌入核心码，插件码经 registerErrorCodes 入 */
const registry = new Map<string, ErrorCodeInfo>();
for (const info of CORE_ERROR_CODES) registry.set(info.code, info);

/**
 * 注册错误码（宿主件落码批与插件装载面的统一入口）。
 *
 * 同码重复注册即抛（fail-loud——防两模块抢码/插件伪造宿主码；冲突属装配期
 * 执法，归 host 码族 HOST_ERROR_CODE_CONFLICT）。
 */
export function registerErrorCodes(infos: readonly ErrorCodeInfo[]): void {
  for (const info of infos) {
    const existing = registry.get(info.code);
    if (existing) {
      const by = existing.module === info.module ? '同模块' : `${existing.module}（彼） vs ${info.module}（此）`;
      throw new BaseError(
        'HOST_ERROR_CODE_CONFLICT',
        `错误码 ${info.code} 重复注册：${by}——码身份唯一，先改注册面再注册`,
      );
    }
    registry.set(info.code, info);
  }
}

/** 判别错误码是否已注册（catch 面 code 分派前的目录查询） */
export function isKnownErrorCode(code: string): boolean {
  return registry.has(code);
}

/** 错误码目录条目查询（未注册返回 undefined） */
export function getErrorCodeInfo(code: string): ErrorCodeInfo | undefined {
  return registry.get(code);
}

/** 全量目录枚举（生成目录 / CI 校验用） */
export function listErrorCodes(): ErrorCodeInfo[] {
  return [...registry.values()];
}
