/**
 * env 白名单构造（04 §11 deny-by-default：默认零继承宿主环境，声明式变更表）。
 *
 * 「零继承」是凭证泄漏面的结构性封死：宿主环境里的 AWS_/GITHUB_ 等凭证类
 * 变量默认一个都不进子进程——子进程拿到什么完全由显式声明决定。allow 从
 * 宿主环境拷贝白名单变量；set 显式注入（内部调用方）；deny 覆盖两面——
 * 命中**显式**请求（allow 名单项/set 注入）即抛 EXEC_ENV_FORBIDDEN 拒静默
 * 继承（fail-loud：显式矛盾必须修声明）；命中**缺省**白名单项是常规收窄
 * （静默排除——缺省单是愿望清单，deny 即从愿望里划掉）。
 */
import { BaseError } from '../contracts/index.js';
import type { EnvPolicy } from './types.js';

/**
 * 缺省 allow 白名单——shell 可用性最小集（PATH 查找、家目录、locale、终端
 * 与临时目录）。刻意不含凭证类变量（零继承封死）与 XDG_ 族（配置注入面）；
 * 装配批按部署形态增删。
 */
export const DEFAULT_ENV_ALLOW: readonly string[] = [
  'PATH',
  'HOME',
  'SHELL',
  'USER',
  'LOGNAME',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'TZ',
];

/**
 * 构造子进程 env。
 * @param policy 声明式变更表（allow/set/deny）
 * @param hostEnv 宿主环境（拷贝源；测试注入桩）
 * @returns 子进程 env 对象（零继承基底 + 白名单拷贝 + 显式注入）
 * @throws EXEC_ENV_FORBIDDEN deny 命中显式 allow 名单项（策略自冲突）或显式
 * set 注入——两处都是「调用方明确要了被拒的东西」，fail-loud 拒静默取舍；
 * deny 命中**缺省**白名单项是常规收窄（静默排除——缺省单是愿望清单非请求）
 */
export function buildChildEnv(
  policy: EnvPolicy = {},
  hostEnv: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const explicitAllow = policy.allow;
  const allow = explicitAllow ?? DEFAULT_ENV_ALLOW;
  const deny = new Set(policy.deny ?? []);
  const env: Record<string, string> = {};
  // 面一：allow 白名单从宿主拷贝（宿主没有的名单项静默跳过——名单是愿望
  // 不是要求）。deny 命中：显式名单 = 策略自冲突 fail-loud；缺省名单 = 收窄
  for (const name of allow) {
    if (deny.has(name)) {
      if (explicitAllow !== undefined) {
        throw new BaseError(
          'EXEC_ENV_FORBIDDEN',
          `环境变量 ${name} 同时出现在显式 allow 与 deny——策略自冲突，拒绝静默取舍（04 §11 deny 覆盖条）`,
        );
      }
      continue;
    }
    const value = hostEnv[name];
    if (value !== undefined) env[name] = value;
  }
  // 面二：set 显式注入（deny 同样封死——防内部调用方绕白名单塞凭证）
  for (const [name, value] of Object.entries(policy.set ?? {})) {
    if (deny.has(name)) {
      throw new BaseError(
        'EXEC_ENV_FORBIDDEN',
        `环境变量 ${name} 在 deny 清单内——显式注入被拒（凭证类变量泄漏面封死，04 §11）`,
      );
    }
    env[name] = value;
  }
  return env;
}
