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
