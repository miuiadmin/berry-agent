/**
 * credentials — env 引用形展开器工厂（03 §10.9 注入腿；c-4 落码批）。
 *
 * 消费链：用户在 MCP/LSP server config env 声明 `@credentials:<name>` →
 * 配置原文（引用形）流入 exec EnvPolicy.set → spawn 时刻 buildChildEnv 单点
 * 调用本工厂产物展开。本工厂只做两件事：
 *  - **host 域读**（namespace 恒 'host'——用户配置域 = 宿主域：server config
 *    是用户手面 enabled.yaml，插件域凭证不进用户 server 配置注入面；
 *    与 ctx.secrets.get 的插件域读腿分立两路）；
 *  - **缺席响亮拒**（CREDENTIALS_NOT_FOUND——message 指路人面录入路径）。
 *
 * 不落审计：注入腿展开 = 宿主代用户配置展开，非插件越域读——无门无账
 * （capability/used 只记插件越域命中，03 §10.9 读腿定形注同源）。
 *
 * 席位接线：plugin-boot 在 secretsSeatActive（与 ctx.secrets 席位门同一双
 * 条件）时把本工厂产物供入共享根服务 'credentials-env-ref'——exec 件
 * apply 期拾取；禁用/缺席 ⇒ 服务缺席 ⇒ 引用形 fail-loud（exec 侧执法）。
 */
import { BaseError } from '../contracts/index.js';
import { HOST_NAMESPACE } from './types.js';
import type { CredentialsStoreFace } from './secrets.js';

/** env 引用形展开器（exec buildChildEnv 第三参结构契约——名 → host 域明文） */
export type EnvRefResolver = (name: string) => string;

/**
 * 建 env 引用形展开器（host 域恒定——用户配置注入面单域）。
 * @param store 凭证存储窄面（assembly 接 persistence.store 凭证投影）
 * @returns 展开器：名命中返回明文；缺席抛 CREDENTIALS_NOT_FOUND（指路人面）
 */
export function createEnvRefResolver(store: CredentialsStoreFace): EnvRefResolver {
  return (name: string): string => {
    const entry = store.getCredential(HOST_NAMESPACE, name);
    if (entry === undefined) {
      throw new BaseError(
        'CREDENTIALS_NOT_FOUND',
        `env 引用形 @credentials:${name} 在 host 域缺席——人面录入路径 /credentials add（03 §10.9 注入腿；模型可见性铁律：值恒不出现在配置/日志/工具结果）`,
      );
    }
    return entry.apiKey;
  };
}
