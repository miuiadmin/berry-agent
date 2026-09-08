/**
 * credentials — 读腿服务面工厂（03 §2.2 能力面第十面 + §10.9 读腿；c-3 落码批）。
 *
 * 消费形（§2.2 钉词面）：**服务面**——宿主装配序逐插件 fork 作用域
 * `provide('secrets', …本工厂产物…)`，插件经 `ctx.get("secrets")` 取自域
 * 绑定版（服务闭包携带 pluginId——插件面永不自报身份，防冒名）。
 *
 * 三动词执法全景：
 *  - `get(name)`：自域读——物理键恒 `(plugin:<本插件 id>, name)`，越域名
 *    恒解析为本域（不存在路径式逃逸：name 是 provider 作用名、非 namespace
 *    载体）；缺席拒 `CREDENTIALS_NOT_FOUND`。
 *  - `get(name, { namespace })`：显式越域读——值域好形判（'host' | 好形
 *    plugin:<id>，坏形拒 `CREDENTIALS_NAMESPACE_DENIED` 同码分流）→ 高危面
 *    门检 `credentials.read-cross`（§4.6 v1 首批第四枚——未开门拒同码，
 *    message 底稿 = 门检 verdict 原文指路 opens 授予位；core: 官方件直开
 *    豁免——triggers.ts 同律：装配即用户意图）→ 开门后逐次 `capability/used`
 *    审计 seam（audit_events 载体落码挂账 U3-2——seam 先立，缺省 no-op）。
 *  - `set(name, value, meta?)`：恒自域写——受理窗判定（宿主回调窗内可达，
 *    窗外拒 `CREDENTIALS_WRITE_WINDOW_CLOSED`；缺省恒窗外 = fail-closed）；
 *    写成功落 `credentials/changed` 审计 seam（action 'rotate'/origin
 *    'oauth-flow'——05 §1.1 值域单源：oauth 首写与刷新轮换均计 rotate；
 *    人面 add/remove 的 'add'/'remove'·'human' 随 c-5）。
 *  - `registerOAuthFlow(spec)`（c-6 第十面第三动词）：装载窗内注册 oauth
 *    流（窗外拒 PLUGIN_WINDOW_CLOSED——12f-2a 装载窗执法码；回调窗内
 *    动态注册不开放：流注册是装载期声明，注册面无运行时增量）。注册只入
 *    host-owned 注册表，不触存储——授权写入发生在流被用户发起时的回调窗
 *    handler 内（set 动词）。
 *
 * in-process TCB 诚实成文（§10.9）：get 返回明文值给插件码面（它要外联
 * 必然持有值）；本腿防的是磁盘/env 明文落盘与跨插件串读，不防同进程内存
 * 窥探。值恒不入 durable 面、恒不出模型面（注入腿 c-4 执法）。
 *
 * 窄面注入律：本件 DAG 无 host/context 边——窗判定/开门集/审计发射全经
 * 构造注入（词面独立律：受局面结构兼容 host 装配桥真身，compat 互证归
 * 本件测试）。
 */
import { BaseError } from '../contracts/index.js';
// internal 桶机制符号深导（门检裁决核——03 §4.6；开门是宿主裁决面非插件
// API；DEEP_FACES 面册 sanctioned 位，triggers.ts 同律消费）
import { adjudicateCapabilityDoor } from '../contracts/api.js';
import { pluginNamespace, isPluginNamespace, type CredentialMeta } from './types.js';
import type { OAuthFlowRegistry, OAuthFlowSpec } from './oauth.js';

/**
 * 凭证存储窄面（词面独立律——结构兼容 persist Store 凭证方法子集：
 * getCredential/setCredential 双键签名。compat 互证在本件测试：persist
 * Store 结构可赋值本面即证词面兼容）。
 */
export interface CredentialsStoreFace {
  /** 凭证读（解密后明文——持有面在内存，勿外泄日志） */
  getCredential(namespace: string, provider: string): { readonly apiKey: string; readonly meta?: unknown } | undefined;
  /** 凭证写（upsert 整行——meta 整列换） */
  setCredential(namespace: string, provider: string, entry: { readonly apiKey: string; readonly meta?: unknown }): void;
}

/** 高危面名（本件门检唯一消费位——§4.6 v1 首批第四枚） */
const READ_CROSS_CAPABILITY = 'credentials.read-cross';

/** capability/used 审计 seam 载荷（audit_events 落码挂账 U3-2——发射位后接） */
export interface CapabilityUsedPayload {
  readonly pluginId: string;
  /** 高危面名（本件恒 'credentials.read-cross'） */
  readonly capability: string;
  readonly namespace: string;
  readonly name: string;
}

/**
 * oauth 流注册面受局面（c-6）：注册表由 assembly 创建（host-owned），
 * 开窗器/装载窗判定由 plugin-boot 绑本插件 handle 真源（enterHostCallback
 * /装载窗位）——三源合流即完整受局面。
 */
export interface OAuthFaceWiring {
  /** 流注册表（assembly 单真身——plugin-boot 与人面动词共用） */
  readonly registry: OAuthFlowRegistry;
  /** 宿主回调窗开窗器（返回幂等恢复函数——invoke 包裹位消费） */
  readonly openWriteWindow: () => () => void;
  /** 装载窗判定（apply 期 true——registerOAuthFlow 窗执法判据） */
  readonly inLoadWindow: () => boolean;
}

/** credentials/changed 审计 seam 载荷（05 §1.1 立词——值恒不入载荷） */
export interface CredentialChangedPayload {
  /** 写入行 namespace（set 恒自域 plugin:<id>） */
  readonly namespace: string;
  /** 凭证名（provider 物理列） */
  readonly name: string;
  /**
   * 动作（值域 05 §1.1 单源：'add' | 'remove' | 'rotate'——oauth 首写与刷新
   * 轮换均计 rotate。set 动词 = 'rotate'；人面 add/remove 随 c-5、刷新随 c-6）
   */
  readonly action: string;
  /** 来源（值域 05 §1.1 单源：'human' | 'oauth-flow'。set 动词 = 'oauth-flow'；人面 = 'human' 随 c-5） */
  readonly origin: string;
}

/** 插件凭证面（ctx.get("secrets") 的取用形态——get/set/registerOAuthFlow 三动词，§2.2 第十面） */
export interface SecretsService {
  /**
   * 凭证读（返回明文值）。缺省自域；显式 `namespace` = 越域读（走高危面
   * 门检 credentials.read-cross——core: 直开豁免；显式指定自域等价缺省形
   * 不开门不审计）。缺席拒 CREDENTIALS_NOT_FOUND。
   */
  get(name: string, opts?: { readonly namespace?: string }): string;
  /**
   * 凭证写（恒自域——无跨域写面）。受理窗判定：宿主回调窗内可达，窗外拒
   * CREDENTIALS_WRITE_WINDOW_CLOSED。meta 随行整列换（oauth 流写
   * {source:'oauth'} 等 CredentialMeta 键约定）。
   */
  set(name: string, value: string, meta?: CredentialMeta): void;
  /**
   * 注册 oauth 流（c-6——装载窗内合法，窗外拒 PLUGIN_WINDOW_CLOSED）。
   * spec.def.name 即凭证行名（token 落自域 plugin:<id>/name）；handler 在
   * 用户发起流时的宿主回调窗内执行（窗内本面 set 可达——受理窗机制的
   * 消费位）。受局面缺席（注册表未装配）拒 CONTEXT_SERVICE_MISSING。
   */
  registerOAuthFlow(spec: OAuthFlowSpec): void;
}

/** 工厂构造选项（host 装配位注入——本件零宿主依赖，纯逻辑可测） */
export interface SecretsFaceOptions {
  /** 凭证存储窄面（assembly 接 persistence.store 凭证投影） */
  readonly store: CredentialsStoreFace;
  /** 本插件 id（自域 namespace 物理键合成基准——core: 含前缀原形） */
  readonly pluginId: string;
  /**
   * 开门授予集读取源（§4.6——越域读门检判据。每次现读：/reload 撤位语义
   * 由装载代重建承载，代内授予面不变）。缺席 = 恒空集（全默认关——
   * fail-closed）。
   */
  readonly getOpens?: () => ReadonlySet<string>;
  /**
   * 受理窗判定（写动词宿主回调窗——true = 窗内可达）。缺席 = 恒 false
   * （窗外拒——fail-closed：无窗态位即无写面）。
   */
  readonly inWriteWindow?: () => boolean;
  /** capability/used 审计 seam（开门后逐次越域读调用；缺省 no-op——U3-2 挂账） */
  readonly onCapabilityUsed?: (payload: CapabilityUsedPayload) => void;
  /** credentials/changed 审计 seam（set 写成功后调用；缺省 no-op——U3-2 挂账） */
  readonly onCredentialChanged?: (payload: CredentialChangedPayload) => void;
  /**
   * oauth 流注册面受局面（c-6——缺席 = registerOAuthFlow 响亮缺位拒；
   * 生产装配恒在场：registry 由 assembly 供、窗两源由 plugin-boot 绑）。
   */
  readonly oauth?: OAuthFaceWiring;
}

/**
 * 构造插件凭证面（host 装配序 createContext 位逐插件调用——fork 作用域
 * provide('secrets', 产物)）。
 */
export function createSecretsFace(options: SecretsFaceOptions): SecretsService {
  const { store, pluginId } = options;
  const selfNamespace = pluginNamespace(pluginId);
  const getOpens = options.getOpens ?? (() => new Set<string>());
  const inWriteWindow = options.inWriteWindow ?? (() => false);

  return {
    get(name: string, opts?: { readonly namespace?: string }): string {
      const target = opts?.namespace;
      // 缺省/显式自域：恒自域读（越域名不是载体——name 是 provider 作用名，
      // 「显式指定自域」等价缺省形，不开门不审计）
      if (target === undefined || target === selfNamespace) {
        const entry = store.getCredential(selfNamespace, name);
        if (entry === undefined) {
          throw new BaseError(
            'CREDENTIALS_NOT_FOUND',
            `凭证 ${name} 不在本插件域（${selfNamespace}）——人面录入路径 /credentials add（03 §10.9 读腿）`,
          );
        }
        return entry.apiKey;
      }
      // 越域读：先值域好形（'host' | 好形 plugin:<id>——坏形同码分流拒；
      // isPluginNamespace 单源判据，裸前缀/无前缀形全拒）
      if (target !== 'host' && !isPluginNamespace(target)) {
        throw new BaseError(
          'CREDENTIALS_NAMESPACE_DENIED',
          `namespace「${target}」坏形——值域 = 'host' | 'plugin:<id>'（03 §10.9 namespace 归属列值域单源，types.ts 判据）`,
        );
      }
      // 门检（§4.6——credentials.read-cross 默认关）。core: 官方件直开豁免
      // （装配即用户意图——triggers.ts 同律；capability/used 审计照记）
      if (!pluginId.startsWith('core:')) {
        const verdict = adjudicateCapabilityDoor(getOpens(), READ_CROSS_CAPABILITY);
        if (!verdict.ok) {
          throw new BaseError('CREDENTIALS_NAMESPACE_DENIED', `${verdict.message}（插件 ${pluginId}）`);
        }
      }
      const entry = store.getCredential(target, name);
      if (entry === undefined) {
        throw new BaseError('CREDENTIALS_NOT_FOUND', `凭证 ${name} 不在目标域（${target}）——越域读命中空名同响亮拒`);
      }
      // 开门后逐次审计（05 §1.1 capability/used——audit_events 载体挂账 U3-2，
      // seam 先立；core: 直开豁免同记审计——豁免免的是门不是账）
      options.onCapabilityUsed?.({ pluginId, capability: READ_CROSS_CAPABILITY, namespace: target, name });
      return entry.apiKey;
    },

    set(name: string, value: string, meta?: CredentialMeta): void {
      // 受理窗判定（宿主回调窗内可达——唯一合法流 = 用户发起 oauth 授权流）
      if (!inWriteWindow()) {
        throw new BaseError(
          'CREDENTIALS_WRITE_WINDOW_CLOSED',
          `凭证写在受理窗外被拒（插件 ${pluginId}——ctx.secrets.set 只在宿主回调窗内可达：用户发起授权流 → 宿主回调插件 handler → 窗内写，03 §10.9 写入面复合案）`,
        );
      }
      // 恒自域写（无跨域写面——同读腿隔离律）
      store.setCredential(selfNamespace, name, { apiKey: value, meta });
      // credentials/changed 审计 seam（值恒不入载荷——05 §1.1 立词条款；action/
      // origin 值域同源：oauth 首写与刷新轮换均计 rotate，流内写 = 'oauth-flow'）
      options.onCredentialChanged?.({ namespace: selfNamespace, name, action: 'rotate', origin: 'oauth-flow' });
    },

    registerOAuthFlow(spec: OAuthFlowSpec): void {
      const wiring = options.oauth;
      // 受局面缺位执法（装配缺陷响亮——plugin-context required() 同判据同码；
      // 词面归 context 域，BaseError 携码不校验归属，本件 DAG 无 context 边
      // 故字面直用，漂移由全链测试互证）
      if (wiring === undefined) {
        throw new BaseError(
          'CONTEXT_SERVICE_MISSING',
          `注册动词 ctx.secrets.registerOAuthFlow 的受局面 oauth（流注册表）缺席（插件 ${pluginId}——装配根未接线；装配缺陷 fail-loud）`,
        );
      }
      // 装载窗执法（12f-2a 窗执法码 PLUGIN_WINDOW_CLOSED——词面归 host 域，
      // 同上字面直用；本面严于通律：回调窗内动态注册不开放——流注册是装载
      // 期声明，注册面无运行时增量）
      if (!wiring.inLoadWindow()) {
        throw new BaseError(
          'PLUGIN_WINDOW_CLOSED',
          `注册动词 ctx.secrets.registerOAuthFlow 在装载窗口外被拒（插件 ${pluginId}——流注册只在 apply 执行期间合法，03 §10.9 oauth 案）`,
        );
      }
      // 入 host-owned 注册表（(pluginId, name) 分键——同插件同名后写胜出，
      // 跨插件结构性不撞；openWriteWindow 绑本插件 handle——invoke 时开窗）
      wiring.registry.register(pluginId, spec, wiring.openWriteWindow);
    },
  };
}
