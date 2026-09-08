/**
 * exec 域错误码注册（04 §11 spawn 管道 + §8 bash 工具件——EXEC_ 前缀族）。
 *
 * 前缀族在 contracts/errors.ts ERROR_CODE_PREFIXES 已注册（02 §5.3 #1）；
 * 码名两枚为规范具名（EXEC_SPAWN_FAILED / EXEC_ENV_FORBIDDEN——04 §11/§8
 * 原文），两枚为落码批定名（EXEC_TIMEOUT / EXEC_BACKGROUND_REJECTED——
 * 04 §11 超时归因条与 §8「无后台化」截获条的拒执面，族清单随本批补明）。
 * 本文件由模块公开面 index.ts 引入（注册纪律：import 发生才注册）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'EXEC_SPAWN_FAILED',
    module: 'exec',
    description:
      'spawn 阶段失败（可执行不存在/权限——进程从未存在）与执行阶段失败（exitCode ≠ 0）分报的前者（04 §11 失败二分条）',
  },
  {
    code: 'EXEC_ENV_FORBIDDEN',
    module: 'exec',
    description:
      'env 白名单 deny-by-default 拒静默继承——请求继承/注入 deny 覆盖变量的凭证泄漏面封死（04 §11 env 白名单条）',
  },
  {
    code: 'EXEC_TIMEOUT',
    module: 'exec',
    description: '执行超时——已进程组树杀，归因 timeout（04 §11 超时归因先到先得条；04 §8 timeoutMs 上限 600s）',
  },
  {
    code: 'EXEC_BACKGROUND_REJECTED',
    module: 'exec',
    description: '后台化命令截获拒——尾部单 & 或命令位 nohup/disown（04 §8「无后台化」：模型不能脱管留后台进程）',
  },
  {
    code: 'EXEC_GIT_REDIRECT_DENIED',
    module: 'exec',
    description:
      'bash 重定向目标落在 .git 版本史内——carve-out 路径级直写硬拒（04 §252 桥条款腿一）：任何档无升权出路、白名单不豁免；git 元数据操作走命令白名单形（成熟度缺口 #9 落码批）',
  },
]);
