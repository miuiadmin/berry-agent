/**
 * credentials — core:credentials 公开面（02 §4.1 #28 席；边 contracts+persist）。
 *
 * c-2 存储腿产物：契约词面件（types）+ 表扩容迁移（migration）。读腿
 * （ctx.secrets 受理制）/注入腿/人面命令/oauth 流随 c-3..c-6 落码批逐笔
 * 扩公开面（03 §10.9 件章为机制真源）。
 */
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
