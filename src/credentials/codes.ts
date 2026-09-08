/**
 * credentials 域错误码注册（02 §5.3 族前缀 `CREDENTIALS_`——c-1 规范先行批
 * 明列三码；03 §10.9 错误码族 bullet 真源）。
 *
 * 码语义分层：一码守 get 作用名缺席（NOT_FOUND——GOAL_NOT_FOUND 同构
 * 守卫）；一码管 namespace 隔离与跨域门检（NAMESPACE_DENIED——同码分流：
 * 未开门越域拒 / namespace 坏形拒，两档共用 message 底稿指路开门位写法）；
 * 一码管受理窗外写拒（WRITE_WINDOW_CLOSED——宿主回调窗执法，12f-2a
 * PLUGIN_WINDOW_CLOSED 唯一例外位的凭证面同律）；一码管注入腿引用形坏形
 * （ENV_REF_INVALID——c-4：前缀命中而名空，exec env.ts 抛出）。
 *
 * oauth 流内码三枚（c-6 扩族——03 §10.9 错误码族 bullet 兑现）：用户拒授
 * （DENIED——token 端点 access_denied，授权页明确拒绝）/ 态坏过期
 * （EXPIRED——设备码轮询窗超窗 + expired_token + refresh 凭据失效 invalid_grant
 * 三形同码：共同语义 = 授权态已坏、重试无益、须重新发起授权流）/ 协议传输
 * 兜底（FLOW_FAILED——端点非预期应答/载荷坏形/网络错，重试可期）。
 *
 * 密钥物理面既有码 PERSIST_SECRET_UNREADABLE（05 §9）复用不重立。
 *
 * 本文件由模块公开面 index.ts 引入（注册纪律：import 发生才注册）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'CREDENTIALS_NOT_FOUND',
    module: 'credentials',
    description: 'get 作用名缺席守卫——自域/越域读命中不存在的凭证名响亮拒（GOAL_NOT_FOUND 同构）',
  },
  {
    code: 'CREDENTIALS_NAMESPACE_DENIED',
    module: 'credentials',
    description:
      'namespace 隔离执法——同码分流两档：未开门越域读拒（credentials.read-cross 高危面默认关，开门位 = 启用清单 opens）/ namespace 坏形拒（非 host 且非 plugin:<id> 值域）',
  },
  {
    code: 'CREDENTIALS_WRITE_WINDOW_CLOSED',
    module: 'credentials',
    description:
      '受理窗外写拒——ctx.secrets.set 只在宿主回调窗内可达（用户发起 oauth 授权流 → 宿主回调插件 handler → 窗内写；03 §10.9 写入面复合案）',
  },
  {
    code: 'CREDENTIALS_ENV_REF_INVALID',
    module: 'credentials',
    description:
      'env 引用形坏形（c-4 注入腿）——set 值前缀 @credentials: 命中而名空，响亮拒字面注入；词面单源 contracts/env-ref.ts',
  },
  {
    code: 'CREDENTIALS_OAUTH_DENIED',
    module: 'credentials',
    description: 'oauth 授权流用户拒授——token 端点 error=access_denied（授权页明确拒绝；重发流可再试）',
  },
  {
    code: 'CREDENTIALS_OAUTH_EXPIRED',
    module: 'credentials',
    description:
      'oauth 授权态坏过期（三形同码：设备码轮询窗超窗 / token 端点 error=expired_token / refresh 凭据失效 error=invalid_grant——重试无益，须重新发起 /credentials oauth）',
  },
  {
    code: 'CREDENTIALS_OAUTH_FLOW_FAILED',
    module: 'credentials',
    description:
      'oauth 流协议/传输面失败兜底——端点非预期应答、载荷坏形（缺 device_code/access_token 等）、网络传输错；重试可期',
  },
]);
