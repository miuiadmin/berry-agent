/**
 * credentials — core:credentials 公开面（02 §4.1 #28 席；边 contracts+persist）。
 *
 * c-2 存储腿产物：契约词面件（types）+ 表扩容迁移（migration）。c-3 读腿
 * 产物：错误码族（codes）+ 插件凭证面工厂（secrets——ctx.get("secrets")
 * 消费面，host 装配序逐插件 fork provide 绑定版）。注入腿 env 白名单/
 * 人面命令/oauth 流随 c-4..c-6 落码批逐笔扩公开面（03 §10.9 件章为机制
 * 真源）。
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
