/**
 * web 域错误码注册（02 §4.1 席 18 / 07 §1.1 core:web 行——SSRF 五卫生件拦截码族）。
 *
 * 前缀族明列见 contracts/errors.ts ERROR_CODE_PREFIXES（02 §5.3 #1——WEB_ 族
 * 前缀已注册，具体码名规范未逐一定名，本批落码定名〔07 §1.1 core:web 行
 * 「原样」指席职能〕）；03 §10.3 browser 件章 L694 安全卫生条指认「拦截码
 * 复用 WEB_ 族不自造」——browser 导航拦截消费本族。注册纪律：写入点文件
 * 必须实际 import 本文件注册才发生（与 safety/tools 的 codes.ts 同款）。
 */
import { registerErrorCodes } from '../contracts/index.js';

registerErrorCodes([
  {
    code: 'WEB_URL_INVALID',
    module: 'web',
    description: '入口 URL 不可解析（new URL 红或空串）——SSRF 卫生件段 0 拒',
  },
  {
    code: 'WEB_PROTOCOL_REJECTED',
    module: 'web',
    description: '协议白名单外拒——仅 http/https（03 §10.3 browser 件章协议白名单同源；file/ftp/javascript 等一律拒）',
  },
  {
    code: 'WEB_PRIVATE_ADDRESS',
    module: 'web',
    description: '私网/环回/链路本地/未指定地址拒（SSRF 红线）——字面 IP 段与 DNS 解析结果双查（重定向每跳重查）',
  },
  {
    code: 'WEB_REDIRECT_LIMIT',
    module: 'web',
    description: '重定向跟随跳数触帽拒（缺省 5 跳）——每跳目标经同一卫生单源复检',
  },
  {
    code: 'WEB_RATE_LIMITED',
    module: 'web',
    description:
      '在飞门满拒（缺省并发 4）——fetch 与 browser 导航共享同一门实例（03 §10.3「同一在飞门第三消费位」）；可重试档',
  },
]);
