/**
 * credentials — oauth 刷新链（03 §10.9 oauth bullet 刷新/轮换三振细则；
 * c-6 落码批）。
 *
 * 形态 = 件内自持挂钟（obs/service.ts 同形先例：setInterval + unref；
 * interval 0 = 不自驱——测试经 tick() 手动驱动）。巡检面 = 流注册表 ×
 * 存储行 meta：到期位（expiresAt）落入提前量（缺省 5 分钟）即经 refresh
 * token 换新。
 *
 * 三律（保留上次有效值律细则——02 §7 张力细则同源）：
 *  1. **成功 rotate**：主行换新 token（source 'refresh'、failures 清零、
 *     expired 位随整列换消失）；端点下发新 refresh token 才动刷新行
 *     （RFC 6749 §6 不下发即复用旧值）；附加键保全（账号句柄等插件自记
 *     meta 键不因链写抹掉）。
 *  2. **失败保留旧值续用**：值不动只记 failures++（durable——连续计数）；
 *     单败走 warn（日志面）；invalid_grant（EXPIRED 码）= 授权态坏重试
 *     无益，直落三振语义。
 *  3. **三振 notify 不执法**：到阈值（缺省 3）置 meta.expired 告示位 +
 *     notify 用户（只通知——旧 token 可能仍有效，c-5 list 已呈现「已过期
 *     ——保留上次有效值」）；notify 只在转换位发（已 expired 行继续失败
 *     不重复告警）；撤销唯一路径 = 人面 rm（链不清删）。
 *
 * 窄面注入律：存储四法（CredentialsCommandStore——commands.ts 同面）+
 * 注册表 + fetch/now/notify/warn 全注入；本件零宿主依赖，纯逻辑可测。
 */
import { BaseError } from '../contracts/index.js';
import { pluginNamespace, type CredentialMeta } from './types.js';
import { refreshOAuthToken, type OAuthFetchLike, type OAuthFlowRegistry, type RegisteredOAuthFlow } from './oauth.js';
import type { CredentialsCommandStore } from './commands.js';
import type { CredentialChangedPayload } from './secrets.js';

/** 链构造依赖（宿主装配位注入——core-plugins makeCredentialsPlugin 消费） */
export interface RefreshChainDeps {
  readonly store: CredentialsCommandStore;
  readonly registry: OAuthFlowRegistry;
  readonly fetchFn: OAuthFetchLike;
  readonly now: () => number;
  /** 三振告警面（用户面——notify 只通知不执法） */
  readonly notify: (message: string) => void;
  /** 单败 warn（日志面——非用户面，宿主接线位自决去向） */
  readonly warn: (message: string) => void;
  /** credentials/changed 审计 seam（rotate 成功后调用；缺省 no-op——U3-2 挂账） */
  readonly onCredentialChanged?: (payload: CredentialChangedPayload) => void;
  /** 提前量毫秒（到期前多久开始刷新——缺省 5 分钟） */
  readonly aheadMs?: number;
  /** 三振阈值（连续失败计数上限——缺省 3） */
  readonly maxFailures?: number;
}

/** 链句柄（apply 期创建、dispose 位 stop——装载代内生命周期） */
export interface RefreshChainHandle {
  /** 手动巡检一拍（测试驱动；自驱挂钟同调用本面） */
  tick(): Promise<void>;
  /** 自驱挂钟启动（intervalMs 缺省 60s；unref——不阻进程退出；重复 start 幂等重启） */
  start(intervalMs?: number): void;
  /** 停钟（幂等） */
  stop(): void;
}

/** 剔除 failures/expired 两键的 meta 残余（链管键整列换、插件自记附加键保全） */
function stripChainKeys(meta: CredentialMeta): CredentialMeta {
  const { failures: _failures, expired: _expired, ...rest } = meta;
  return rest;
}

/**
 * 构造刷新链。巡检逐流隔离（单流失败不连坐他流）；重入护栏（上一拍未收口
 * 跳过本拍——慢端点下不叠拍）。
 */
export function createRefreshChain(deps: RefreshChainDeps): RefreshChainHandle {
  const { store, registry, fetchFn } = deps;
  const now = deps.now;
  const notify = deps.notify;
  const warn = deps.warn;
  const aheadMs = deps.aheadMs ?? 5 * 60 * 1000;
  const maxFailures = deps.maxFailures ?? 3;
  let timer: ReturnType<typeof setInterval> | undefined;
  let running = false;

  /** 单流巡检（读到写全包——单流异常折 warn 不炸整拍） */
  const refreshOne = async (flow: RegisteredOAuthFlow): Promise<void> => {
    const ns = pluginNamespace(flow.pluginId);
    const name = flow.def.name;
    let row: ReturnType<CredentialsCommandStore['getCredential']>;
    let meta: CredentialMeta;
    try {
      row = store.getCredential(ns, name);
      if (row === undefined) return; // 未授权过——不归链管
      meta = (row.meta ?? {}) as CredentialMeta;
      if (typeof meta.expiresAt !== 'number') return; // 无到期位（manual/静态）不归链管
      if (meta.expiresAt - now() > aheadMs) return; // 未到提前量
    } catch (err) {
      warn(`凭证 ${ns}/${name} 刷新巡检读侧异常：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const wasExpired = meta.expired === true;
    const refreshName = typeof meta.refreshName === 'string' ? meta.refreshName : undefined;
    if (refreshName === undefined) return; // 单 token 形（无刷新行）——到期不自动续

    try {
      const refreshRow = store.getCredential(ns, refreshName);
      if (refreshRow === undefined) {
        throw new BaseError(
          'CREDENTIALS_OAUTH_EXPIRED',
          `refresh 凭据行 ${refreshName} 缺席（已被人面 rm）——授权态不完整，重新发起授权流 /credentials oauth ${flow.pluginId} ${name}。`,
        );
      }
      const grant = await refreshOAuthToken(flow.def, refreshRow.apiKey, { fetchFn, now });
      // 成功 rotate：主行换新（source 'refresh'、failures/expired 随整列换消失；
      // 端点未给 expires_in 则保留旧到期位）
      store.setCredential(ns, name, {
        apiKey: grant.accessToken,
        meta: { ...stripChainKeys(meta), source: 'refresh', expiresAt: grant.expiresAt ?? meta.expiresAt },
      });
      // 新 refresh token 才动刷新行（不下发即复用——RFC 6749 §6）
      if (grant.refreshToken !== undefined && grant.refreshToken !== refreshRow.apiKey) {
        store.setCredential(ns, refreshName, { apiKey: grant.refreshToken, meta: { source: 'refresh' } });
      }
      // credentials/changed 审计 seam（值域 05 §1.1 单源：刷新轮换 = rotate/oauth-flow）
      deps.onCredentialChanged?.({ namespace: ns, name, action: 'rotate', origin: 'oauth-flow' });
    } catch (err) {
      // 失败保留旧值续用：值不动，failures 递增（durable）
      const failures = (typeof meta.failures === 'number' ? meta.failures : 0) + 1;
      // invalid_grant（EXPIRED 码）= 授权态坏——直落三振语义（重试无益不空转三拍）
      const stateBroken = err instanceof BaseError && err.code === 'CREDENTIALS_OAUTH_EXPIRED';
      const strike = stateBroken || failures >= maxFailures;
      store.setCredential(ns, name, {
        apiKey: row.apiKey, // 保留上次有效值（铁律——链不清删不清值）
        meta: {
          ...stripChainKeys(meta),
          refreshName,
          expiresAt: meta.expiresAt,
          failures,
          ...(strike ? { expired: true } : {}),
        },
      });
      if (strike) {
        // 三振 notify（只通知不执法——旧 token 可能仍有效；唯一转换位发，已 expired 行不重复告警）
        if (!wasExpired) {
          notify(
            `凭证 ${ns}/${name} 刷新${stateBroken ? '被拒（授权态坏——refresh 凭据失效或行不完整）' : `连续 ${failures} 次失败`}——已标记过期，保留上次有效值；重新授权：/credentials oauth ${flow.pluginId} ${name}`,
          );
        } else {
          warn(`凭证 ${ns}/${name} 刷新仍失败（已过期告示在案，第 ${failures} 次）：${errText(err)}`);
        }
      } else {
        warn(`凭证 ${ns}/${name} 刷新失败（第 ${failures} 次，阈值 ${maxFailures}）：${errText(err)}——保留旧值续用`);
      }
    }
  };

  return {
    async tick(): Promise<void> {
      if (running) return; // 重入护栏——上一拍未收口跳过本拍
      running = true;
      try {
        for (const flow of registry.list()) {
          await refreshOne(flow);
        }
      } finally {
        running = false;
      }
    },
    start(intervalMs?: number): void {
      this.stop(); // 幂等重启（重复 start 先清旧钟）
      const ms = intervalMs ?? 60_000;
      timer = setInterval(() => void this.tick(), ms);
      // 不阻进程退出（obs/service.ts 同律——挂钟是后台巡检非存活语义）
      (timer as unknown as { unref?: () => void }).unref?.();
    },
    stop(): void {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
}

/** 非 BaseError 错误折文案（oauth.ts errText 同形——本件零依赖不回流） */
function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
