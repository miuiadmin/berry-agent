/**
 * credentials — 人面命令处理器（03 §10.9 写入面复合案·静态凭证人面唯写；
 * c-5 落码批）。
 *
 * 双面共享底座：TUI `/credentials`（core-plugins 注册——argv 面）与 CLI
 * `berry-agent credentials`（cli.ts 解析产物 CredentialsSub 直入）同源本件
 * ——动词语义/值域执法/结算文本单源，两面只差投递形（notify vs stdout）。
 * 形态律同 /tick /memory-export（命令件先例）：argv → 人读文本；服务面守卫
 * 错（BaseError）折文本不抛——命令面是用户面不是异常面。
 *
 * 铁律（03 §10.9 模型可见性铁律）：
 *  - **值永不呈现在任何结算文本**——add/rm 只回执名与域，list 只列
 *    namespace/名/来源/更新时间（给值唯一路径 = 注入腿 env 引用形展开）；
 *  - 人面命令恒可列示/撤销**一切域**（host + 全部 plugin:<id>——审计与
 *    治理面不随 namespace 分权；与 ctx.secrets 读腿的自域隔离分立两律）；
 *  - argv 传值不落 durable——channels 命令分派纯内存直达 handler（命令
 *    输入不进 conversation/durable 管线），CLI 同理；值经 argv 即进程内
 *    瞬态，写库即加密落盘，无明文留痕面。
 *
 * 窄面注入律（词面独立律——结构兼容 persist Store 凭证方法子集四法，
 * compat 互证归本件测试）：本件 DAG 无 host 边，宿主装配位传真身。
 */
import { BaseError } from '../contracts/index.js';
import { HOST_NAMESPACE, isPluginNamespace, type CredentialMeta } from './types.js';
import type { CredentialChangedPayload } from './secrets.js';

/** 用法文案（TUI 命令 description 位与用法错指路共用单源；oauth 动词 TUI 面承载——CLI 零装配无注册表不载） */
export const CREDENTIALS_USAGE = [
  '用法：/credentials add <name> <value> [--namespace <ns>] —— 录入静态凭证（缺省 host 域；值含空格用引号包裹）',
  '　　　/credentials list —— 全域列示（namespace/名/来源/更新时间——永不呈值）',
  '　　　/credentials rm <name> [--namespace <ns>] —— 撤销凭证（删除唯一路径）',
  '　　　/credentials oauth <pluginId> [<name>] —— 发起插件 oauth 授权流（device-code；域随流主人）',
].join('\n');

/**
 * 凭证存储窄面（四法投影——词面独立律：结构兼容 persist Store 凭证方法
 * 子集，assembly 直传 persistence.store、对拍测试互证）。
 */
export interface CredentialsCommandStore {
  /** 凭证读（解密后明文——持有面在内存，勿外泄日志） */
  getCredential(namespace: string, provider: string): { readonly apiKey: string; readonly meta?: unknown } | undefined;
  /** 凭证写（upsert 整行——meta 整列换） */
  setCredential(namespace: string, provider: string, entry: { readonly apiKey: string; readonly meta?: unknown }): void;
  /** 凭证删（返回是否真删——缺席 false） */
  deleteCredential(namespace: string, provider: string): boolean;
  /** 凭证清单（不回 api_key + meta 随行——全域列示） */
  listCredentialProviders(): readonly {
    readonly namespace: string;
    readonly provider: string;
    readonly meta: unknown;
    readonly updatedAt: number;
  }[];
}

/** 命令装配依赖（宿主装配位注入——本件零宿主依赖，纯逻辑可测） */
export interface CredentialsCommandDeps {
  readonly store: CredentialsCommandStore;
  /** credentials/changed 审计 seam（add/rm 成功后调用；缺省 no-op——U3-2 挂账真发射位） */
  readonly onCredentialChanged?: (payload: CredentialChangedPayload) => void;
}

/**
 * 子命令形（TUI parseCredentialsArgv 产物 = CLI cli.ts 解析产物——两面同
 * 一 tagged union，动词语义单源在 runCredentialsCommand）。oauth 动词是
 * TUI 运行时承载（需流注册表 + fetch）——CLI 解析律不产此形（未知子命令
 * 拒），执行腿在 core-plugins（runCredentialsCommand 内为不可达退化档）。
 */
export type CredentialsSub =
  | { readonly sub: 'add'; readonly name: string; readonly value: string; readonly namespace?: string }
  | { readonly sub: 'list' }
  | { readonly sub: 'rm'; readonly name: string; readonly namespace?: string }
  | { readonly sub: 'oauth'; readonly pluginId: string; readonly name?: string };

/** 命令结算（ok 位供 CLI 退出码分档〔0/1〕；TUI 面只消费 text） */
export interface CredentialsCommandResult {
  readonly ok: boolean;
  readonly text: string;
}

/**
 * TUI 面 argv 解析（CLI 面由 cli.ts 解析律执法——未知旗标退 2 等；本函数
 * 只服务 TUI 通道的裸 argv：动词识别 + 位置参数 + --namespace 旗标）。
 */
export function parseCredentialsArgv(
  argv: readonly string[],
): { ok: true; sub: CredentialsSub } | { ok: false; message: string } {
  const [verb, ...rest] = argv as string[];
  if (verb === undefined || verb.startsWith('--')) {
    return { ok: false, message: `缺子命令。\n${CREDENTIALS_USAGE}` };
  }
  // 旗标扫描（本命令族唯一旗标 --namespace——宽容形：位置参数与旗标可交错）
  const literals: string[] = [];
  let namespace: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const tok = rest[i] as string;
    if (tok === '--namespace') {
      const next = rest[i + 1];
      if (next === undefined || next === '') {
        return { ok: false, message: `--namespace 须带值。\n${CREDENTIALS_USAGE}` };
      }
      namespace = next;
      i++;
      continue;
    }
    literals.push(tok);
  }
  if (verb === 'list') {
    if (literals.length > 0) return { ok: false, message: `list 不收位置参数。\n${CREDENTIALS_USAGE}` };
    return { ok: true, sub: { sub: 'list' } };
  }
  if (verb === 'add') {
    if (literals.length !== 2) {
      return { ok: false, message: `add 须带 <name> <value> 两参数。\n${CREDENTIALS_USAGE}` };
    }
    return {
      ok: true,
      sub: {
        sub: 'add',
        name: literals[0] as string,
        value: literals[1] as string,
        ...(namespace !== undefined ? { namespace } : {}),
      },
    };
  }
  if (verb === 'rm') {
    if (literals.length !== 1) {
      return { ok: false, message: `rm 须带 <name> 一参数。\n${CREDENTIALS_USAGE}` };
    }
    return {
      ok: true,
      sub: { sub: 'rm', name: literals[0] as string, ...(namespace !== undefined ? { namespace } : {}) },
    };
  }
  if (verb === 'oauth') {
    if (namespace !== undefined) {
      // 域随流主人（token 落插件自域）——oauth 不收 --namespace
      return { ok: false, message: `oauth 不收 --namespace（域随流主人——token 落插件自域）。\n${CREDENTIALS_USAGE}` };
    }
    if (literals.length < 1 || literals.length > 2) {
      return {
        ok: false,
        message: `oauth 须带 <pluginId> [<name>]（name 可省 = 该插件唯一流）。\n${CREDENTIALS_USAGE}`,
      };
    }
    return {
      ok: true,
      sub: {
        sub: 'oauth',
        pluginId: literals[0] as string,
        ...(literals.length === 2 ? { name: literals[1] as string } : {}),
      },
    };
  }
  return { ok: false, message: `未知子命令：${verb}（合法：add/list/rm/oauth）。\n${CREDENTIALS_USAGE}` };
}

/**
 * 命令处理器（同步纯逻辑——存储三法 + 审计 seam；守卫错折文本 ok:false）。
 */
export function runCredentialsCommand(sub: CredentialsSub, deps: CredentialsCommandDeps): CredentialsCommandResult {
  try {
    switch (sub.sub) {
      case 'add':
        return runAdd(sub.name, sub.value, sub.namespace, deps);
      case 'list':
        return runList(deps);
      case 'rm':
        return runRm(sub.name, sub.namespace, deps);
      case 'oauth':
        // 不可达退化档（CLI 解析律不产此形、TUI 面在 core-plugins 执行腿
        // 分流先取）——直入仍诚实回执不炸
        return {
          ok: false,
          text: 'oauth 动词是运行时承载（需流注册表 + fetch）——TUI 内用 /credentials oauth；CLI 面不可用。',
        };
    }
  } catch (err) {
    // 守卫错折文本（命令面是用户面——BaseError 码与人读原因直呈；密钥腐坏
    // PERSIST_SECRET_UNREADABLE 等物理面错同折不炸通道）
    if (err instanceof BaseError) return { ok: false, text: `${err.code}：${err.message}` };
    throw err;
  }
}

/** namespace 解析执法（缺省 host；值域 = 'host' | 好形 plugin:<id>——判据单源 isPluginNamespace） */
function resolveNamespace(namespace: string | undefined): string {
  if (namespace === undefined) return HOST_NAMESPACE;
  if (namespace !== HOST_NAMESPACE && !isPluginNamespace(namespace)) {
    throw new BaseError(
      'CREDENTIALS_NAMESPACE_DENIED',
      `namespace「${namespace}」坏形——值域 = 'host' | 'plugin:<id>'（03 §10.9 namespace 归属列值域单源）`,
    );
  }
  return namespace;
}

/** add：录入（upsert——同名覆写整行含 meta；写 meta {source:'manual'}；值不回显） */
function runAdd(
  name: string,
  value: string,
  namespace: string | undefined,
  deps: CredentialsCommandDeps,
): CredentialsCommandResult {
  const ns = resolveNamespace(namespace);
  if (value === '') {
    // 空值 = 缺值形（CLI 空串经解析律已拦；TUI tokenize 可产空段——此处兜底）
    return { ok: false, text: `值不得为空。\n${CREDENTIALS_USAGE}` };
  }
  const meta: CredentialMeta = { source: 'manual' };
  deps.store.setCredential(ns, name, { apiKey: value, meta });
  // credentials/changed 审计 seam（05 §1.1 值域单源：人面写 = action 'add' /
  // origin 'human'；值恒不入载荷；audit_events 载体挂账 U3-2，seam 先立）
  deps.onCredentialChanged?.({ namespace: ns, name, action: 'add', origin: 'human' });
  return {
    ok: true,
    text: `已录入凭证 ${ns}/${name}（来源 manual）——值不回显；注入用 env 引用形 '@credentials:${name}'。`,
  };
}

/** rm：撤销（删除唯一路径——保留律的对面；缺席 = CREDENTIALS_NOT_FOUND 折文本） */
function runRm(name: string, namespace: string | undefined, deps: CredentialsCommandDeps): CredentialsCommandResult {
  const ns = resolveNamespace(namespace);
  if (!deps.store.deleteCredential(ns, name)) {
    throw new BaseError('CREDENTIALS_NOT_FOUND', `凭证 ${name} 不在 ${ns} 域——用 list 查在册名。`);
  }
  deps.onCredentialChanged?.({ namespace: ns, name, action: 'remove', origin: 'human' });
  return { ok: true, text: `已撤销凭证 ${ns}/${name}。` };
}

/** list：全域列示（namespace/名/来源/更新时间——永不呈值；expired 位随来源列标注） */
function runList(deps: CredentialsCommandDeps): CredentialsCommandResult {
  const rows = deps.store.listCredentialProviders();
  if (rows.length === 0) {
    return { ok: true, text: '无凭证（数据目录凭证表空——/credentials add 录入首条）' };
  }
  const lines: string[] = [`共 ${rows.length} 条凭证（全域列示，永不呈值）：`];
  for (const row of rows) {
    const meta = (row.meta ?? {}) as CredentialMeta;
    const source = meta.source ?? '未记';
    const expired = meta.expired === true ? '（已过期——保留上次有效值）' : '';
    lines.push(
      `  ${row.namespace}  ${row.provider}  来源 ${source}${expired}  更新 ${new Date(row.updatedAt).toISOString()}`,
    );
  }
  return { ok: true, text: lines.join('\n') };
}
