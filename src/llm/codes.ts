/**
 * llm 域错误码注册（04 篇 §3.5 四桶码族 + §3.7 + §5——LLM_ 前缀族首批）。
 *
 * 前缀族明列见 contracts/errors.ts ERROR_CODE_PREFIXES（02 §5.3 #1）。本文件
 * 由模块公开面 index.ts 引入（注册纪律：写入点文件必须实际 import 本文件，
 * 注册才发生——与 session/persist 的 codes.ts 同款）。
 *
 * 两类载体：抛出面（BaseError——MODEL_* / COMPLETE_FAILED / BUDGET_EXCEEDED）
 * 与数据面（AssistantMessage.errorCode 携带——桶码族，供 classifyError 在场
 * 码优先判定）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  // 04 §5 模型标识解析细则：语法层 fail-loud
  {
    code: 'LLM_MODEL_SPEC_INVALID',
    module: 'llm',
    description: '模型标识语法非法（缺斜杠/空段——必须是 "provider/model-id" 形式，首斜杠分割）',
  },
  // 04 §5：目录层 fail-loud（provider 未注册或模型不在目录）
  {
    code: 'LLM_MODEL_NOT_FOUND',
    module: 'llm',
    description: '模型解析失败：provider 未注册或该 provider 目录中无此模型 id',
  },
  // 04 §3.5 transient 桶码（429 限流——errorCode 归一位，provider 钩子纵切前无 provider 写点）
  {
    code: 'LLM_RATE_LIMITED',
    module: 'llm',
    description: '供应商限流（429）——transient 桶，turn 级 auto-retry 退避后重试',
  },
  // 04 §3.6 在飞帽拒绝（宿主合成码——transient 桶）
  {
    code: 'LLM_INFLIGHT_LIMIT',
    module: 'llm',
    description: 'per-provider 在飞请求达帽（缺省 4）——显式拒绝不排队，退避后槽已释放可重试',
  },
  // 04 §3.5 non-retryable 桶码（鉴权败——即 failed 用户面修复）
  {
    code: 'LLM_AUTH_INVALID',
    module: 'llm',
    description: '鉴权被拒（凭证无效/过期/权限不足）——non-retryable 桶，不重试',
  },
  // 04 §3.5 quota 桶码（配额尽——即 failed 换 key/等窗）
  {
    code: 'LLM_QUOTA_EXCEEDED',
    module: 'llm',
    description: '配额/余额耗尽——quota 桶，重试治不了（换 key 或等窗口）',
  },
  // 04 §3.5 overflow 桶码（上下文溢出——3.4 兜底 1/1）
  {
    code: 'LLM_CONTEXT_OVERFLOW',
    module: 'llm',
    description: '上下文溢出——overflow 桶，compact-and-retry-once 单次压缩重试',
  },
  // 04 §5 预算执法码（llm 层自产拒发错——不入四桶，调用方捕获即跳过本轮）
  {
    code: 'LLM_BUDGET_EXCEEDED',
    module: 'llm',
    description: '当日后台预算耗尽拒发（拒在请求发出前）——下个周期再试，不进 run 终态',
  },
  // 04 §3.7：complete 错误终态上抛（Promise 面错误回到异常形态）
  {
    code: 'LLM_COMPLETE_FAILED',
    module: 'llm',
    description: 'complete 单发补全失败（stopReason=error/aborted 终态或达帽拒绝上抛）',
  },
]);
