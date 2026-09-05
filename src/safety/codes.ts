/**
 * safety 域错误码注册（04 §8 沙箱栈——SANDBOX_ 前缀族首批）。
 *
 * 前缀族明列见 contracts/errors.ts ERROR_CODE_PREFIXES（02 §5.3 #1）；码名清
 * 单与语义真源 = 02 篇 §5.3 SANDBOX_ 族明列段（2026-09-06 safety 纵切批）。
 * 本文件由模块公开面 index.ts 引入（注册纪律：写入点文件必须实际 import 本
 * 文件注册才发生——与 tools/llm/session 的 codes.ts 同款）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'SANDBOX_UNAVAILABLE',
    module: 'safety',
    description: '策略要求沙箱而后端链空/全部探测失败——fail-closed 拒执行绝不裸跑（04 §8 执行 seam 条）',
  },
  {
    code: 'SANDBOX_MODE_INVALID',
    module: 'safety',
    description:
      'sandbox/mode 事件折叠遇非三档词汇——静默跳过坏事件会沿用旧档属 fail-open，宁响亮失败（04 §8 策略三级解析条）',
  },
  {
    code: 'SANDBOX_ESCALATION_INVALID',
    module: 'safety',
    description:
      '升权参数残缺：sandbox_permissions 与 justification 不成对非空 / 目标档非法 / 非严格变宽（04 §8 严格变宽升权条）',
  },
]);
