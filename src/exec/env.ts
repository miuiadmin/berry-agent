/**
 * env 白名单构造（04 §11 deny-by-default：默认零继承宿主环境，声明式变更表）。
 *
 * 「零继承」是凭证泄漏面的结构性封死：宿主环境里的 AWS_/GITHUB_ 等凭证类
 * 变量默认一个都不进子进程——子进程拿到什么完全由显式声明决定。allow 从
 * 宿主环境拷贝白名单变量；set 显式注入（内部调用方）；deny 覆盖两面——
 * 命中**显式**请求（allow 名单项/set 注入）即抛 EXEC_ENV_FORBIDDEN 拒静默
 * 继承（fail-loud：显式矛盾必须修声明）；命中**缺省**白名单项是常规收窄
 * （静默排除——缺省单是愿望清单，deny 即从愿望里划掉）。
 *
 * 注入腿（03 §10.9——c-4 落码批）：set 面值可为凭证引用形
 * `@credentials:<name>`（词面单源 contracts/env-ref.ts）。本函数是展开
 * **唯一执法点**（run/spawnInteractive 两入口同点汇入）：引用形经
 * resolveEnvRef 在 spawn 时刻展开为明文，明文只进返回的 env 对象——它
 * 是 child_process.spawn 的 env 实参直达子进程，管道内任何其他面
 * （argv/登记簿/结果/日志）恒不见值。引用形在场而展开器缺席 = 席位
 * 缺席（core:credentials 未装载/禁用）——fail-loud 拒以字面值注入。
 */
import { BaseError, parseCredentialEnvRef } from '../contracts/index.js';
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
 * @param resolveEnvRef 凭证引用形展开器（03 §10.9 注入腿——`@credentials:<name>`
 *   → host 域明文；真身 = credentials 件 createEnvRefResolver 产物，经 spawn
 *   管道装配注入。缺席 = 引用形 fail-loud 拒〔席位缺席律〕）
 * @returns 子进程 env 对象（零继承基底 + 白名单拷贝 + 显式注入〔引用形已展开〕）
 * @throws EXEC_ENV_FORBIDDEN deny 命中显式 allow 名单项（策略自冲突）或显式
 *   set 注入——两处都是「调用方明确要了被拒的东西」，fail-loud 拒静默取舍；
 *   deny 命中**缺省**白名单项是常规收窄（静默排除——缺省单是愿望清单非请求）
 * @throws CREDENTIALS_ENV_REF_INVALID set 值引用形坏形（前缀命中而名空）
 * @throws CREDENTIALS_NOT_FOUND 引用形在场而展开器缺席（席位缺席——拒以
 *   字面值注入）；或展开器对缺席凭证名抛出（message 指路人面录入路径）
 */
export function buildChildEnv(
  policy: EnvPolicy = {},
  hostEnv: NodeJS.ProcessEnv = process.env,
  resolveEnvRef?: (name: string) => string,
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
  // 面二：set 显式注入（deny 同样封死——防内部调用方绕白名单塞凭证）。
  // 值可为凭证引用形——本函数是展开唯一执法点（run/spawnInteractive 两入口
  // 同点汇入；明文只进本 env 对象 = spawn env 实参直达子进程）
  for (const [name, value] of Object.entries(policy.set ?? {})) {
    if (deny.has(name)) {
      throw new BaseError(
        'EXEC_ENV_FORBIDDEN',
        `环境变量 ${name} 在 deny 清单内——显式注入被拒（凭证类变量泄漏面封死，04 §11）`,
      );
    }
    env[name] = expandEnvRefValue(value, resolveEnvRef);
  }
  return env;
}

/**
 * set 值单值展开（引用形判定 + 席位缺席执法）。
 * 三态放行：非引用形字面原样；引用形经展开器取明文；坏形（前缀命中而名空）
 * 响亮拒。展开器缺席时引用形不得静默降级为字面注入——fail-loud。
 */
function expandEnvRefValue(value: string, resolveEnvRef: ((name: string) => string) | undefined): string {
  const parsed = parseCredentialEnvRef(value);
  if (parsed.kind === 'none') return value;
  if (parsed.kind === 'invalid') {
    throw new BaseError(
      'CREDENTIALS_ENV_REF_INVALID',
      `env 引用形坏形：${JSON.stringify(value)}——@credentials: 后须有凭证名（03 §10.9 注入腿；词面单源 contracts/env-ref.ts）`,
    );
  }
  if (resolveEnvRef === undefined) {
    throw new BaseError(
      'CREDENTIALS_NOT_FOUND',
      `env 引用形 ${value} 在场而凭证展开面缺席（core:credentials 未装载/禁用）——fail-closed 拒以字面值注入（03 §10.9 注入腿席位缺席律）`,
    );
  }
  // 展开器自带缺席拒（credentials 侧 CREDENTIALS_NOT_FOUND——message 指路人面）
  return resolveEnvRef(parsed.name);
}
