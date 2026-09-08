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
  // DANGER_ 六码（04 §13 危险工具闸——02 §5.3 族明细 2026-09-09 #4 规范先行批同笔入册）
  {
    code: 'DANGER_CONSENT_ABSENT',
    module: 'safety',
    description:
      '危险闸 consent 缺席（fail-closed 缺省——缺席 = 闸落地零配置零行为变化，deny 路径即原「阻塞转人审」语义；指路 /danger approve 签发）',
  },
  {
    code: 'DANGER_CONSENT_INVALID',
    module: 'safety',
    description:
      '危险闸 consent 过期或 mandate 漂移（哈希不符——批了 A 契约不等于批了 B 契约；两形同码：过期不自动续不静默宽限、漂移即死——重签唯一出路）',
  },
  {
    code: 'DANGER_HALTED',
    module: 'safety',
    description:
      '危险闸 HALT 哨兵在场（存在性判内容不解析、stat 不可达按在场——touch 即全停；指路删除数据目录下 HALT 文件恢复）',
  },
  {
    code: 'DANGER_TARGET_DENIED',
    module: 'safety',
    description: '危险闸动作/目标不在 mandate 值域（action 越闭集或 target 不匹配 targets——04 §13 闸序步 4）',
  },
  {
    code: 'DANGER_CAP_EXCEEDED',
    module: 'safety',
    description: '危险闸当日成功帽已满（allow-succeeded 计数 UTC 日界恢复——账本派生无第二状态；提帽须重签 consent）',
  },
  {
    code: 'DANGER_LEDGER_CORRUPT',
    module: 'safety',
    description:
      '危险闸审计账本链坏拒续写（改/删任何历史行则哈希传播破坏其后全部——账本完整性先于可用性；修复归人手，截断/重建是人工决策）',
  },
]);
