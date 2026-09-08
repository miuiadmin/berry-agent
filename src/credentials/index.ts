/**
 * credentials — core:credentials 公开面（02 §4.1 #28 席；边 contracts+persist）。
 *
 * c-2 存储腿产物：契约词面件（types）+ 表扩容迁移（migration）。c-3 读腿
 * 产物：错误码族（codes）+ 插件凭证面工厂（secrets——ctx.get("secrets")
 * 消费面，host 装配序逐插件 fork provide 绑定版）。c-4 注入腿产物：env
 * 引用形展开器工厂（env-ref——host 域，exec spawn 管道单点消费）。人面
 * 命令/oauth 流随 c-5..c-6 落码批逐笔扩公开面（03 §10.9 件章为机制真源）。
 */
import './codes.js';

export {
  HOST_NAMESPACE,
  pluginNamespace,
  isPluginNamespace,
  parsePluginNamespace,
  type CredentialMeta,
  type CredentialNamespace,
  type PluginNamespace,
} from './types.js';
export { CREDENTIALS_MIGRATION } from './migration.js';
export {
  createSecretsFace,
  type CredentialsStoreFace,
  type SecretsService,
  type SecretsFaceOptions,
  type CapabilityUsedPayload,
  type CredentialChangedPayload,
} from './secrets.js';
// 注入腿（c-4——03 §10.9）：env 引用形展开器工厂（host 域）——plugin-boot
// 席位接线消费（共享根服务 'credentials-env-ref' → exec spawn 管道拾取）
export { createEnvRefResolver, type EnvRefResolver } from './env-ref.js';
// 人面命令（c-5——03 §10.9 写入面复合案）：双面共享纯逻辑底座（TUI
// /credentials 与 CLI credentials 子命令族同源——动词语义/值域执法/结算
// 文本单源；host 侧 core-plugins 注册 + credentials-cmd CLI 入口两消费位）
export {
  CREDENTIALS_USAGE,
  parseCredentialsArgv,
  runCredentialsCommand,
  type CredentialsCommandStore,
  type CredentialsCommandDeps,
  type CredentialsSub,
  type CredentialsCommandResult,
} from './commands.js';
