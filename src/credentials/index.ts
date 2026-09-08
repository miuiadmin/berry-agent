/**
 * credentials — core:credentials 公开面（02 §4.1 #28 席；边 contracts+persist）。
 *
 * c-2 存储腿产物：契约词面件（types）+ 表扩容迁移（migration）。c-3 读腿
 * 产物：错误码族（codes）+ 插件凭证面工厂（secrets——ctx.get("secrets")
 * 消费面，host 装配序逐插件 fork provide 绑定版）。c-4 注入腿产物：env
 * 引用形展开器工厂（env-ref——host 域，exec spawn 管道单点消费）。人面
 * 命令/oauth 流随 c-5..c-6 落码批逐笔扩公开面（03 §10.9 件章为机制真源）。
 * c-6 产物：oauth 流编舞 + 流注册表 + 刷新链三振（oauth.ts/refresh.ts）；
 * ctx.secrets 第三动词 registerOAuthFlow（secrets.ts）。
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
  type OAuthFaceWiring,
  type CapabilityUsedPayload,
  type CredentialChangedPayload,
} from './secrets.js';
// oauth 流（c-6——03 §10.9 oauth 案）：流编舞（device-code/refresh——四源
// 注入零真网络）+ 流注册表（host-owned）+ 人面流解析
export {
  runDeviceCodeFlow,
  refreshOAuthToken,
  createOAuthFlowRegistry,
  resolveOAuthFlow,
  type OAuthFetchLike,
  type OAuthFlowDef,
  type OAuthFlowSpec,
  type OAuthFlowIo,
  type OAuthGrant,
  type OAuthFlowRegistry,
  type RegisteredOAuthFlow,
  type DeviceCodeIo,
} from './oauth.js';
// 刷新链（c-6）：件内自持挂钟 + 保留上次有效值律三振（interval 0 = 测试
// 手动 tick 驱动）
export { createRefreshChain, type RefreshChainDeps, type RefreshChainHandle } from './refresh.js';
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
