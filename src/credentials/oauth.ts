/**
 * credentials — oauth 授权流件（03 §10.9 oauth bullet；c-6 落码批）。
 *
 * 三段承载：
 *  1. **device-code 流编舞**（RFC 8628——回调受理位挂账 U5 后，v1 只此流）：
 *     `runDeviceCodeFlow` 纯舞步——发起（POST deviceAuthUrl form）→ present
 *     用户（user_code/verification_uri 人读呈现）→ 按 interval 轮询 token
 *     端点 → authorization_pending 续轮 / slow_down 提速降频（interval+5s）/
 *     access_denied → DENIED / expired_token·超窗 → EXPIRED / 200 → tokens。
 *     fetch/clock/present/sleep 四源全注入（测试零真网络铁律——loop 只认
 *     StreamFn 同律：本件无 web 边，fetchFn 由宿主装配位注入）。
 *  2. **刷新腿** `refreshOAuthToken`：grant_type=refresh_token 换新——
 *     invalid_grant → EXPIRED（授权态坏，重试无益）；其余非 200 → 兜底码。
 *  3. **流注册表**（host-owned——createJobRegistry 同形先例）：按
 *     (pluginId, name) 分键、同插件同名后写胜出（注册动词换装正道——
 *     channels 后写胜出同律，零新撞名码）、跨插件结构性不撞（分域）。
 *     invoke = 宿主回调窗包裹（enterHostCallback 开 → 插件 handler →
 *     finally 合窗——窗内 ctx.secrets.set 可达，c-3 受理窗机制的消费位）。
 *
 * 受理全景（03 §10.9 写入面复合案 oauth 案）：用户人面 `/credentials oauth
 * <pluginId> [<name>]` 发起 → 宿主解析流 → 开窗回调插件 handler（io 携
 * runDeviceCode 舞步 + present 呈现面）→ 插件窗内 `ctx.secrets.set` 写
 * 自域（token 经 io 返回值只在内存过手——宿主不落 token，永不持值面）。
 *
 * 回调受理位（redirect URI 形）挂账 U5 路由受限开放后定形——本批只钉
 * 挂点归属（sdk.register-route 门制复用），不落形。
 */
import { BaseError } from '../contracts/index.js';

/**
 * fetch 窄面（注入形——结构兼容 typeof fetch：globalThis.fetch 直传即合法；
 * 测试注入脚本化假身。本件对 Response 只消费 ok/status/text 三面）。
 */
export type OAuthFetchLike = (
  url: string,
  init?: { readonly method?: string; readonly headers?: Record<string, string>; readonly body?: string },
) => Promise<{ readonly ok: boolean; readonly status: number; readonly text: () => Promise<string> }>;

/** oauth 流声明（插件 apply 期注册——registerOAuthFlow 载荷） */
export interface OAuthFlowDef {
  /** 流名（= 凭证行名——token 落 plugin:<id>/name；同插件内唯一，后写胜出） */
  readonly name: string;
  /** 设备授权端点（RFC 8628 §3.1——POST form 发起） */
  readonly deviceAuthUrl: string;
  /** token 端点（设备码轮询与 refresh 换新同端——RFC 8628 §3.4/§3.5） */
  readonly tokenUrl: string;
  /** 客户端 id（device-code 流公开客户端形——无 client_secret） */
  readonly clientId: string;
  /** 授权作用域（空/缺省 = 不带 scope 参数） */
  readonly scopes?: readonly string[];
}

/** 授权产物（token 只在内存过手——插件写库后即弃；宿主不落任何值面） */
export interface OAuthGrant {
  readonly accessToken: string;
  /** 新 refresh token（端点未下发 = undefined——复用旧 refresh 行值） */
  readonly refreshToken?: string;
  /** 到期 epoch ms（expires_in 折算；缺省 = 端点未给、按不过期对待） */
  readonly expiresAt?: number;
}

/** 舞步 io（宿主回调窗内递给插件 handler——runDeviceCode 即流自身的 def 编舞） */
export interface OAuthFlowIo {
  /** 跑 device-code 流（present 已内置——用户呈现面由宿主注入）；返回 token 产物 */
  readonly runDeviceCode: () => Promise<OAuthGrant>;
}

/** 注册单元：声明 + 窗内回调（handler 内 ctx.secrets.set 写自域） */
export interface OAuthFlowSpec {
  readonly def: OAuthFlowDef;
  /** 宿主回调窗内执行——窗执法在 registry invoke 包裹位（本函数体无需自查窗） */
  readonly handler: (io: OAuthFlowIo) => Promise<void>;
}

/** 注册表条目（invoke 已含开合窗——消费面直接 await） */
export interface RegisteredOAuthFlow {
  readonly pluginId: string;
  readonly def: OAuthFlowDef;
  /** 开窗回调插件 handler（宿主回调窗包裹——finally 合窗，异常不拦合） */
  readonly invoke: (io: OAuthFlowIo) => Promise<void>;
}

/** 流注册表（host-owned——assembly 创建；plugin-boot 与人面动词共用同真身） */
export interface OAuthFlowRegistry {
  /** 注册（同插件同名后写胜出；跨插件分键结构性不撞） */
  register(pluginId: string, spec: OAuthFlowSpec, openWriteWindow: () => () => void): void;
  /** 精确解析（单流） */
  get(pluginId: string, name: string): RegisteredOAuthFlow | undefined;
  /** 插件流清单（人面缺省名解析 + 缺席/歧义指路文案消费） */
  flowsOf(pluginId: string): readonly RegisteredOAuthFlow[];
  /** 全表（刷新链巡检面） */
  list(): readonly RegisteredOAuthFlow[];
}

/** 注册表工厂（纯内存——零 IO，装载代内生命周期） */
export function createOAuthFlowRegistry(): OAuthFlowRegistry {
  // 双层分键：外层 pluginId（跨插件结构性不撞）→ 内层流名（后写胜出）
  const flows = new Map<string, Map<string, RegisteredOAuthFlow>>();
  return {
    register(pluginId, spec, openWriteWindow) {
      let byName = flows.get(pluginId);
      if (byName === undefined) {
        byName = new Map();
        flows.set(pluginId, byName);
      }
      byName.set(spec.def.name, {
        pluginId,
        def: spec.def,
        // 宿主回调窗包裹：开窗 → handler → finally 合窗（异常路径同样收口——
        // c-3 窗计数幂等恢复律；窗内该插件 ctx.secrets.set 可达）
        invoke: async (io) => {
          const exit = openWriteWindow();
          try {
            await spec.handler(io);
          } finally {
            exit();
          }
        },
      });
    },
    get(pluginId, name) {
      return flows.get(pluginId)?.get(name);
    },
    flowsOf(pluginId) {
      return [...(flows.get(pluginId)?.values() ?? [])];
    },
    list() {
      return [...flows.values()].flatMap((byName) => [...byName.values()]);
    },
  };
}

/**
 * 人面流解析（`/credentials oauth <pluginId> [<name>]` 的解析腿）：
 * name 给定 = 精确解析；缺省 = 该插件唯一流自动选中（0/多流各成指路文案）。
 * 返回流或人读 message（不抛——命令面是用户面，文案单源在本函数）。
 */
export function resolveOAuthFlow(
  registry: OAuthFlowRegistry,
  pluginId: string,
  name?: string,
):
  | { readonly flow: RegisteredOAuthFlow; readonly message?: undefined }
  | { readonly flow?: undefined; readonly message: string } {
  const listFlows = (rows: readonly RegisteredOAuthFlow[]): string =>
    rows.length === 0
      ? `（无——该插件未注册任何 oauth 流；装载期 ctx.secrets.registerOAuthFlow 注册）`
      : rows.map((f) => `plugin:${f.pluginId}/${f.def.name}`).join('、');
  if (name !== undefined) {
    const flow = registry.get(pluginId, name);
    if (flow === undefined) {
      return {
        flow: undefined,
        message: `oauth 流 ${name} 不在插件 ${pluginId} 名下（在册流：${listFlows(registry.flowsOf(pluginId))}）。`,
      };
    }
    return { flow };
  }
  const flows = registry.flowsOf(pluginId);
  if (flows.length === 0) {
    return { flow: undefined, message: `插件 ${pluginId} 未注册任何 oauth 流。` };
  }
  if (flows.length > 1) {
    return { flow: undefined, message: `插件 ${pluginId} 在册多流，须指名其一：${listFlows(flows)}。` };
  }
  return { flow: flows[0]! };
}

// —— 流编舞（RFC 8628）——

/** device-code 舞步 io（四源注入——fetch/clock/present/sleep） */
export interface DeviceCodeIo {
  readonly fetchFn: OAuthFetchLike;
  /** 用户呈现面（user_code/verification_uri——宿主注入 notify 直达人面） */
  readonly present: (text: string) => void;
  readonly now: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

/** form 编码单源（URLSearchParams——百分号转义与空格 %20 形由标准库保证） */
function formUrlEncode(fields: Readonly<Record<string, string>>): string {
  return new URLSearchParams(fields).toString();
}

/** JSON 安全解析（非 JSON → null——调用面折 FLOW_FAILED 兜底码） */
function safeJsonParse(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** 端点载荷字符串键提取（坏形/缺席 → undefined——调用面判形折错） */
function strField(parsed: Record<string, unknown> | null, key: string): string | undefined {
  return parsed !== null && typeof parsed[key] === 'string' ? (parsed[key] as string) : undefined;
}

/** 端点载荷数值键提取（同上——expires_in/interval 等） */
function numField(parsed: Record<string, unknown> | null, key: string): number | undefined {
  return parsed !== null && typeof parsed[key] === 'number' ? (parsed[key] as number) : undefined;
}

/** 设备授权响应形（RFC 8628 §3.2） */
interface DeviceAuthorization {
  readonly deviceCode: string;
  readonly userCode: string;
  readonly verificationUri: string;
  readonly expiresIn: number;
  readonly interval: number | undefined;
}

/**
 * device-code 流编舞（纯舞步——存储/窗/注册表全不在场，消费位 =
 * 人面动词的 io.runDeviceCode 实现）。
 */
export async function runDeviceCodeFlow(def: OAuthFlowDef, io: DeviceCodeIo): Promise<OAuthGrant> {
  // 1. 发起设备授权（POST form：client_id + scope——scope 空数组/缺省不带）
  let device: DeviceAuthorization;
  try {
    const body = formUrlEncode({
      client_id: def.clientId,
      ...(def.scopes !== undefined && def.scopes.length > 0 ? { scope: def.scopes.join(' ') } : {}),
    });
    const res = await io.fetchFn(def.deviceAuthUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new BaseError(
        'CREDENTIALS_OAUTH_FLOW_FAILED',
        `设备授权端点非 200（${res.status}）：${text.slice(0, 200)}`,
      );
    }
    const parsed = safeJsonParse(text);
    const deviceCode = strField(parsed, 'device_code');
    const userCode = strField(parsed, 'user_code');
    const verificationUri = strField(parsed, 'verification_uri');
    const expiresIn = numField(parsed, 'expires_in');
    if (
      deviceCode === undefined ||
      userCode === undefined ||
      verificationUri === undefined ||
      expiresIn === undefined
    ) {
      throw new BaseError(
        'CREDENTIALS_OAUTH_FLOW_FAILED',
        `设备授权端点载荷坏形（device_code/user_code/verification_uri/expires_in 四键须齐——现得 ${text.slice(0, 200)}）`,
      );
    }
    device = {
      deviceCode,
      userCode,
      verificationUri,
      expiresIn,
      interval: numField(parsed, 'interval'),
    };
  } catch (err) {
    if (err instanceof BaseError) throw err;
    // 传输面错（网络拒/丢包等）——兜底码包装
    throw new BaseError('CREDENTIALS_OAUTH_FLOW_FAILED', `设备授权端点传输失败：${errText(err)}`);
  }

  // 2. present 用户（呈现面由宿主注入——TUI notify 直达）
  io.present(
    [
      `oauth 授权流「${def.name}」已发起——请在浏览器完成授权：`,
      `  打开：${device.verificationUri}`,
      `  输入代码：${device.userCode}`,
      `  （${Math.ceil(device.expiresIn / 60)} 分钟内有效）`,
    ].join('\n'),
  );

  // 3. 轮询 token 端点（authorization_pending 续轮；slow_down 提 interval+5s）
  const deadline = io.now() + device.expiresIn * 1000;
  let intervalMs = (device.interval ?? 5) * 1000; // RFC 缺省 5s
  for (;;) {
    if (io.now() >= deadline) {
      throw new BaseError(
        'CREDENTIALS_OAUTH_EXPIRED',
        '设备码轮询窗已过期（expires_in 到限）——请重新发起 /credentials oauth。',
      );
    }
    const res = await io.fetchFn(def.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: formUrlEncode({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        device_code: device.deviceCode,
        client_id: def.clientId,
      }),
    });
    const text = await res.text();
    const parsed = safeJsonParse(text);
    if (res.ok) {
      const accessToken = strField(parsed, 'access_token');
      if (accessToken === undefined) {
        throw new BaseError(
          'CREDENTIALS_OAUTH_FLOW_FAILED',
          `token 端点 200 但缺 access_token（${text.slice(0, 200)}）`,
        );
      }
      const refreshToken = strField(parsed, 'refresh_token');
      const expiresIn = numField(parsed, 'expires_in');
      return {
        accessToken,
        ...(refreshToken !== undefined ? { refreshToken } : {}),
        ...(expiresIn !== undefined ? { expiresAt: io.now() + expiresIn * 1000 } : {}),
      };
    }
    // RFC 8628 §3.5 错误分流
    const error = strField(parsed, 'error');
    if (error === 'authorization_pending') {
      // 授权未完成——续轮
    } else if (error === 'slow_down') {
      intervalMs += 5000; // 提速降频（RFC：至少 +5s）
    } else if (error === 'access_denied') {
      throw new BaseError('CREDENTIALS_OAUTH_DENIED', '用户在授权页拒绝了本次授权（access_denied）。');
    } else if (error === 'expired_token') {
      throw new BaseError(
        'CREDENTIALS_OAUTH_EXPIRED',
        '设备码已过期（expired_token）——请重新发起 /credentials oauth。',
      );
    } else {
      throw new BaseError(
        'CREDENTIALS_OAUTH_FLOW_FAILED',
        `token 端点非预期应答（${res.status}${error === undefined ? '' : ` error=${error}`}）：${text.slice(0, 200)}`,
      );
    }
    await io.sleep(intervalMs);
  }
}

/**
 * refresh 换新（grant_type=refresh_token——刷新链巡检腿消费）。
 * invalid_grant → EXPIRED（refresh 凭据失效/被撤销——授权态坏，重试无益，
 * 唯一出路 = 重新发起授权流）；其余非 200 → 兜底码（传输/端点抖动，重试可期）。
 */
export async function refreshOAuthToken(
  def: OAuthFlowDef,
  refreshToken: string,
  io: { readonly fetchFn: OAuthFetchLike; readonly now: () => number },
): Promise<OAuthGrant> {
  let res: Awaited<ReturnType<OAuthFetchLike>>;
  try {
    res = await io.fetchFn(def.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: formUrlEncode({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: def.clientId }),
    });
  } catch (err) {
    throw new BaseError('CREDENTIALS_OAUTH_FLOW_FAILED', `token 端点传输失败：${errText(err)}`);
  }
  const text = await res.text();
  const parsed = safeJsonParse(text);
  if (res.ok) {
    const accessToken = strField(parsed, 'access_token');
    if (accessToken === undefined) {
      throw new BaseError(
        'CREDENTIALS_OAUTH_FLOW_FAILED',
        `refresh 应答 200 但缺 access_token（${text.slice(0, 200)}）`,
      );
    }
    // RFC 6749 §6：新 refresh_token 可选——不下发即复用旧值（链不动刷新行）
    const refreshToken = strField(parsed, 'refresh_token');
    const expiresIn = numField(parsed, 'expires_in');
    return {
      accessToken,
      ...(refreshToken !== undefined ? { refreshToken } : {}),
      ...(expiresIn !== undefined ? { expiresAt: io.now() + expiresIn * 1000 } : {}),
    };
  }
  const error = strField(parsed, 'error');
  if (error === 'invalid_grant') {
    throw new BaseError(
      'CREDENTIALS_OAUTH_EXPIRED',
      `refresh 凭据失效（invalid_grant——被撤销或过期）——重新发起授权流 /credentials oauth ${def.name}。`,
    );
  }
  throw new BaseError(
    'CREDENTIALS_OAUTH_FLOW_FAILED',
    `refresh 应答非预期（${res.status}${error === undefined ? '' : ` error=${error}`}）：${text.slice(0, 200)}`,
  );
}

/** 非 BaseError 错误折文案（兜底包装位共用——不出对象字面量防泄漏） */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
