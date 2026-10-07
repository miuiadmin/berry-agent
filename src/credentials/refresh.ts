/**
 * credentials — oauth 刷新链（03 §10.9 oauth bullet 刷新/轮换三振细则；
 * c-6 落码批；refreshNow targeted 强刷位随 B3 联动批增面）。
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
 *     meta 键不因链写抹掉）；两笔写序 = **先刷新行后主行**（03 §10.9
 *     定形——第二笔失败时新 refresh token 已 durable，下一拍自愈）。
 *  2. **失败保留旧值续用**：值不动只记 failures++（durable——连续计数）；
 *     单败走 warn（日志面）；invalid_grant（EXPIRED 码）= 授权态坏重试
 *     无益，直落三振语义。收口写一律「复读现行 + 身份比对」（03 §10.9
 *     挖掘 18 轮 W-3 定形注——窗内 rm/再授权两形同守：缺席或 apiKey 已换
 *     即弃写，起飞前快照零写回）。
 *  3. **三振 notify 不执法**：到阈值（缺省 3）置 meta.expired 告示位 +
 *     notify 用户（只通知——旧 token 可能仍有效，c-5 list 已呈现「已过期
 *     ——保留上次有效值」）；notify 只在转换位发（已 expired 行继续失败
 *     不重复告警）；撤销唯一路径 = 人面 rm（链不清删）。
 *
 * targeted 强刷腿（B3 联动批——03 §10.9 refreshNow 条 / 04 §3.3 条 8，
 * 裁决四三律）：`refreshNow(provider)` 供 401 途中失效形（本地未到期被
 * 服务端撤销）强刷——绕过 5min 提前量门（挂钟跳过族第三条对该形失真）；
 * 与挂钟 tick 共享 per-flow 单飞位（同凭证多路触发合流恰发一次 refresh
 * POST——RFC 6749 §6 refresh token 单次使用互废防护）；三振账与挂钟巡检
 * 一本账共账。不可行形（绑定行缺席/无刷新面/expired 在案）向调用方响亮
 * 表达非静默跳过（fail-closed——04 §3.3 条 8 语义）。
 *
 * 窄面注入律：存储四法（CredentialsCommandStore——commands.ts 同面）+
 * 注册表 + fetch/now/notify/warn 全注入；本件零宿主依赖，纯逻辑可测
 * （'env-static' 判定归宿主装配根闭包——env 面不在件内注入）。
 */
import { BaseError } from '../contracts/index.js';
import { HOST_NAMESPACE, parsePluginNamespace, pluginNamespace, type CredentialMeta } from './types.js';
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
  /** credentials/changed 审计 seam（rotate 成功后调用；缺省 no-op = 测试形；生产已接线 audit_events） */
  readonly onCredentialChanged?: (payload: CredentialChangedPayload) => void;
  /** 提前量毫秒（到期前多久开始刷新——缺省 5 分钟） */
  readonly aheadMs?: number;
  /** 三振阈值（连续失败计数上限——缺省 3） */
  readonly maxFailures?: number;
}

/**
 * refreshNow 不可行形（件内可判三形——04 §3.3 条 8 fail-closed 四形中的
 * 'env-static' 归宿主装配根闭包判（env 面不在件内注入——03 §10.9 refreshNow
 * 条），件内只产三形；词义与 conversation 面 AuthRefreshUnavailableReason
 * 同源对齐）。
 */
export type RefreshNowUnavailableReason =
  /** 绑定行缺席（全表无 meta.modelProvider 绑定行——该 provider 供血面不存在） */
  | 'binding-absent'
  /** 行无刷新面（无 refreshName / 无 expiresAt〔挂钟跳过族同形不归链管〕/ 对应 oauth 流未注册——无强刷对象） */
  | 'no-refresh-face'
  /** expired 告示位在案（三振收敛后授权态坏——重发起授权流是唯一出路） */
  | 'expired';

/**
 * refreshNow 结局判别联合（03 §10.9 targeted 强刷位返回形）：三态分明——
 * 成功 / 不可行（未发起刷新——三形 fail-closed）/ 已发起但失败（三振账在
 * 链侧共账，保留上次有效值律不破）。**结构兼容 conversation 面
 * AuthRefreshOutcome**（seam 形状真源 = src/conversation/types.ts——DAG
 * 单向 credentials → contracts+persist，件内不 import conversation，以
 * 结构同形对齐；件内三 reason ⊂ seam 四 reason，窄形可赋宽形）。
 * 永不 reject（异常总折 'failed' 结局——seam 消费面无需 catch）。
 */
export type RefreshNowOutcome =
  /** 刷新成功（rotate 落位——联动腿续入重试） */
  | { readonly status: 'refreshed' }
  /** 不可行（未发起刷新——reason 见 RefreshNowUnavailableReason 三形） */
  | { readonly status: 'unavailable'; readonly reason: RefreshNowUnavailableReason }
  /** 刷新已发起但失败（上游错误文本随行——notify 文案附注供源） */
  | { readonly status: 'failed'; readonly errorMessage?: string };

/** 链句柄（apply 期创建、dispose 位 stop——装载代内生命周期） */
export interface RefreshChainHandle {
  /** 手动巡检一拍（测试驱动；自驱挂钟同调用本面） */
  tick(): Promise<void>;
  /**
   * targeted 强刷（03 §10.9 refreshNow 条——B3 裁决四）：401 途中失效形
   * 专用——**绕过 5min 提前量门**（本地未到期被服务端撤销，等提前量即
   * 永不刷新）；**与挂钟 tick 共享 per-flow 单飞位**（同凭证多路触发合流
   * 恰发一次 refresh POST——RFC 6749 §6 refresh token 单次使用互废防护）；
   * **三振账与链共账**（成功 rotate 走既有成功尾、失败走既有三振收敛）。
   * provider = 模型 provider id（provider→绑定行解析单源在本件：全表扫
   * meta.modelProvider 绑定键，任意 namespace）。
   */
  refreshNow(provider: string): Promise<RefreshNowOutcome>;
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

  /**
   * per-flow 单飞位（key = `<namespace>/<名>` 行身份）：同凭证并发强刷与
   * 挂钟 tick 巡检同窗合流——后到者 await 前者同一 Promise 不重发 POST
   * （裁决四·2：RFC 6749 §6 refresh token 单次使用互废防护的核心）。挂钟
   * tick 整拍另有链级 running 重入护栏（下），两层分立：整拍护栏防叠拍、
   * per-flow 位保单凭证恰一发。
   */
  const inflight = new Map<string, Promise<RefreshNowOutcome>>();

  /**
   * 单航班执行核心（读到写全包）：成功 rotate 走既有成功尾（三律一——
   * credentials/changed 审计 seam 接线既有）、失败走既有三振账（三律二/三
   * ——failures 计数 durable / EXPIRED 直落 / notify 转换位）——**与挂钟
   * 巡检共账**（裁决四·3：不因触发源不同双轨记账）。挂钟 refreshOne 与
   * refreshNow 两路共入本位（同 key 即同航班）。永不 reject（总折
   * 'failed' 结局——失败记账自带防御壳：记账写/notify 抛折 warn 不洞穿）。
   */
  const flight = (flow: RegisteredOAuthFlow): Promise<RefreshNowOutcome> => {
    const ns = pluginNamespace(flow.pluginId);
    const name = flow.def.name;
    const key = `${ns}/${name}`;
    const existing = inflight.get(key);
    if (existing !== undefined) return existing; // 单飞合流——后到者搭同一航班不重发 POST

    const attempt = (async (): Promise<RefreshNowOutcome> => {
      let row: ReturnType<CredentialsCommandStore['getCredential']>;
      let meta: CredentialMeta;
      try {
        row = store.getCredential(ns, name);
        meta = (row?.meta ?? {}) as CredentialMeta;
      } catch (err) {
        // 读侧异常折 warn 不计三振（refreshOne 读侧同 posture）——结算 failed
        warn(`凭证 ${ns}/${name} 强刷读侧异常：${errText(err)}`);
        return { status: 'failed', errorMessage: errText(err) };
      }
      if (row === undefined || typeof meta.refreshName !== 'string') {
        // 结构性兜底：两路入航班前门已查且全程同步无漂移——此位正常不可达，
        // 防御性不 POST（诚实报不可行）
        return { status: 'unavailable', reason: 'no-refresh-face' };
      }
      const refreshName = meta.refreshName;
      try {
        const refreshRow = store.getCredential(ns, refreshName);
        if (refreshRow === undefined) {
          throw new BaseError(
            'CREDENTIALS_OAUTH_EXPIRED',
            `refresh 凭据行 ${refreshName} 缺席（已被人面 rm）——授权态不完整，重新发起授权流 /credentials oauth ${flow.pluginId} ${name}。`,
          );
        }
        const grant = await refreshOAuthToken(flow.def, refreshRow.apiKey, { fetchFn, now });
        // 成功 rotate 两笔写序 = **先刷新行后主行**（03 §10.9 定形）：两笔独立
        // autocommit 无跨行原子性——新 refresh token 是最不可再得密（access
        // token 可经它再换），先落刷新行则第二笔（主行）失败时下一拍（提前量
        // 巡检或 401 强刷）经已 durable 的新 refresh token 自愈；反序则第二笔
        // 失败即新 refresh token 仅存内存而旧值已被服务端作废——invalid_grant
        // 一拍直落 EXPIRED 授权态不可恢复。非轮换形（grant 不携新
        // refreshToken）不写刷新行不受影响。
        // 刷新行 meta 同主行律——读旧行 meta 经 stripChainKeys 展开（链管键
        // 整列换、插件自记附加键保全——账号句柄等不因轮换链写抹掉），source 键覆新。
        // 竞窗守卫（第九轮 F2 + 挖掘 18 轮 W-3 定形注——收口写身份比对律）：
        // 起飞后 await POST 让出事件环——窗内人面 rm 可删行（F2 形：缺席即弃写
        // 不复活，用户撤销优先），窗内再授权（受理窗 ctx.secrets.set 终归
        // store.setCredential 同写位）可换值落行（W-3 形：apiKey 身份比对不等
        // 即弃写——用户最新写优先，本班 rt-rotated 弃落〔旧值已服务端作废但
        // 新授权行自持新链〕）。身份相等才落笔，meta 以**现行**行 meta 为基
        // spread（保窗内新附加键——插件自记附加键保全律的窗内延伸），起飞前
        // 快照仅用于身份比对、零写回。
        if (grant.refreshToken !== undefined && grant.refreshToken !== refreshRow.apiKey) {
          const currentRefresh = store.getCredential(ns, refreshName);
          if (currentRefresh === undefined) {
            warn(`凭证 ${ns}/${refreshName} 刷新收口发现行已删除——放弃落库（用户撤销优先）`);
          } else if (currentRefresh.apiKey !== refreshRow.apiKey) {
            warn(`凭证 ${ns}/${refreshName} 刷新收口发现窗内已换值（再授权）——放弃落库（用户最新写优先）`);
          } else {
            store.setCredential(ns, refreshName, {
              apiKey: grant.refreshToken,
              meta: {
                ...stripChainKeys((currentRefresh.meta ?? {}) as CredentialMeta),
                source: 'refresh',
              },
            });
          }
        }
        // 主行换新（source 'refresh'、failures/expired 随整列换消失；端点未给
        // expires_in 则保留现行到期位）。竞窗守卫（同上——F2 rm 形 + W-3 换值
        // 形身份比对）：窗内主行被删时跳写不复活、被再授权换值时弃写不覆写；
        // rotate 未落主行故审计 seam 不发，按成功结算（POST 本身成功——行
        // 缺席/换值由消费面自身语义承接）。
        const currentMain = store.getCredential(ns, name);
        if (currentMain === undefined) {
          warn(`凭证 ${ns}/${name} 刷新收口发现行已删除——放弃落库（用户撤销优先）`);
          return { status: 'refreshed' };
        }
        if (currentMain.apiKey !== row.apiKey) {
          warn(`凭证 ${ns}/${name} 刷新收口发现窗内已换值（再授权）——放弃落库（用户最新写优先）`);
          return { status: 'refreshed' };
        }
        const currentMainMeta = (currentMain.meta ?? {}) as CredentialMeta;
        store.setCredential(ns, name, {
          apiKey: grant.accessToken,
          meta: {
            ...stripChainKeys(currentMainMeta),
            source: 'refresh',
            expiresAt: grant.expiresAt ?? currentMainMeta.expiresAt,
          },
        });
        // credentials/changed 审计 seam（值域 05 §1.1 单源：刷新轮换 = rotate/oauth-flow）
        deps.onCredentialChanged?.({ namespace: ns, name, action: 'rotate', origin: 'oauth-flow' });
        return { status: 'refreshed' };
      } catch (err) {
        // 失败记账防御壳（「永不 reject」契约治本位——第七轮 H1）：记账写/
        // notify 同步抛修前会洞穿本 catch 体（catch 内再抛不被同 try 收）直
        // reject——挂钟腿 start() 收口 catch 只自认挂钟拍（c43e50f 单腿补位），
        // refreshNow 腿 return flight(flow) 无对偶而下游 driver 按契约 await
        // 无 catch（04 §3.3 条 8 seam 消费面）直穿。治本：记账写/notify 全入
        // 内层 try——写失败折 warn 留痕（三振账本拍未落、下拍重计），结算恒
        // 返 failed 结局，「永不 reject」两腿同真。
        try {
          // 竞窗守卫（第九轮 F2 + 挖掘 18 轮 W-3 定形注——收口写身份比对律）：
          // 失败记账写同样曾是快照整行写回——窗内主行被 rm 时记账会把旧行
          // （连同 failures/expired 账）整行写回复活（F2 形：缺席即整段记账
          // 弃落，三振 notify 亦不发——行已不存在告警无的放矢）；窗内再授权
          // 换值时旧快照覆写新 token、三振账误挂新授权行（W-3 形：apiKey
          // 身份比对不等即弃记账——新行归新链管，本班旧 token 的失败史不追
          // 到新行头上）。warn 留痕后按 failed 结算（读侧守卫壳同庇：
          // getCredential 抛折「记账异常」warn 不洞穿）。
          const currentRow = store.getCredential(ns, name);
          if (currentRow === undefined) {
            warn(`凭证 ${ns}/${name} 刷新失败收口发现行已删除——放弃记账落库（用户撤销优先）`);
            return { status: 'failed', errorMessage: errText(err) };
          }
          if (currentRow.apiKey !== row.apiKey) {
            warn(`凭证 ${ns}/${name} 刷新失败收口发现窗内已换值（再授权）——放弃记账（用户最新写优先）`);
            return { status: 'failed', errorMessage: errText(err) };
          }
          // 失败保留旧值续用：值不动（现行值——身份相等即起飞前值），failures
          // 递增（durable）；meta 以现行为基 spread（保窗内新附加键）
          const currentMeta = (currentRow.meta ?? {}) as CredentialMeta;
          const failures = (typeof currentMeta.failures === 'number' ? currentMeta.failures : 0) + 1;
          // invalid_grant（EXPIRED 码）= 授权态坏——直落三振语义（重试无益不空转三拍）
          const stateBroken = err instanceof BaseError && err.code === 'CREDENTIALS_OAUTH_EXPIRED';
          const strike = stateBroken || failures >= maxFailures;
          store.setCredential(ns, name, {
            apiKey: currentRow.apiKey, // 保留上次有效值（铁律——链不清删不清值）
            meta: {
              ...stripChainKeys(currentMeta),
              refreshName,
              expiresAt: currentMeta.expiresAt,
              failures,
              ...(strike ? { expired: true } : {}),
            },
          });
          if (strike) {
            // 三振 notify（只通知不执法——旧 token 可能仍有效；唯一转换位发，已
            // expired 行不重复告警——去重以**现行**行为基（W-3 定形注）：起飞前
            // 告示位不辖现行行〔窗内已换值形已被身份比对弃记账，到不了本位〕）
            if (!(currentMeta.expired === true)) {
              notify(
                `凭证 ${ns}/${name} 刷新${stateBroken ? '被拒（授权态坏——refresh 凭据失效或行不完整）' : `连续 ${failures} 次失败`}——已标记过期，保留上次有效值；重新授权：/credentials oauth ${flow.pluginId} ${name}`,
              );
            } else {
              warn(`凭证 ${ns}/${name} 刷新仍失败（已过期告示在案，第 ${failures} 次）：${errText(err)}`);
            }
          } else {
            warn(
              `凭证 ${ns}/${name} 刷新失败（第 ${failures} 次，阈值 ${maxFailures}）：${errText(err)}——保留旧值续用`,
            );
          }
        } catch (accountingErr) {
          // 记账自身失败（写面/notify 注入形抛）——折 warn 留痕不外溢；warn
          // 注入形自身抛再吞（挂钟拍收口 catch 同律——日志面不可反杀契约）
          try {
            warn(`凭证 ${ns}/${name} 刷新失败记账异常（三振账本拍未落，下拍重计）：${errText(accountingErr)}`);
          } catch {
            // warn 注入形自身抛——终极吞
          }
        }
        // 结局随行上游错误文本（seam failed 形的 notify 文案附注供源）
        return { status: 'failed', errorMessage: errText(err) };
      }
    })();

    inflight.set(key, attempt);
    // 收口即摘位（结算值透传不变；身份比对防极端先后两班错摘）
    void attempt
      .catch(() => undefined) // 防御：核心契约永不 reject，万一破约不外溢 unhandled rejection
      .finally(() => {
        if (inflight.get(key) === attempt) inflight.delete(key);
      });
    return attempt;
  };

  /** 单流巡检（挂钟腿——跳过族门查 + 入单飞位；读到写全包在 flight 核心） */
  const refreshOne = async (flow: RegisteredOAuthFlow): Promise<void> => {
    const ns = pluginNamespace(flow.pluginId);
    const name = flow.def.name;
    let meta: CredentialMeta;
    try {
      const row = store.getCredential(ns, name);
      if (row === undefined) return; // 未授权过——不归链管
      meta = (row.meta ?? {}) as CredentialMeta;
      if (typeof meta.expiresAt !== 'number') return; // 无到期位（manual/静态）不归链管
      if (meta.expiresAt - now() > aheadMs) return; // 未到提前量
    } catch (err) {
      warn(`凭证 ${ns}/${name} 刷新巡检读侧异常：${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    if (typeof meta.refreshName !== 'string') return; // 单 token 形（无刷新行）——到期不自动续
    // 入 per-flow 单飞位（与 refreshNow 同位合流——挂钟在飞窗内 401 触发的
    // 强刷搭本班不重发；本腿不消费结算值——挂钟无调用方可报）
    await flight(flow);
  };

  /**
   * provider→绑定行解析（03 §10.9 refreshNow 条：解析单源在本件——seam
   * 只传归因不传值）。全表扫 meta.modelProvider 绑定键（任意 namespace）；
   * 撞绑取 **host 域行优先、插件域两行撞取 namespace 字典序稳定首行**
   * （B3 冷读 M5 落码批定形——确定性优先链，装载序漂移 / fail-loud 两案
   * 不取）+ warn 留痕（配置歧义可见性）。
   */
  const resolveBinding = (
    provider: string,
  ): { readonly ns: string; readonly name: string; readonly meta: CredentialMeta } | undefined => {
    const hits: { readonly ns: string; readonly name: string }[] = [];
    for (const row of store.listCredentialProviders()) {
      // meta 是自由 JSON——只认对象形且绑定键字面相等（坏形行不参与绑定）
      if (
        typeof row.meta === 'object' &&
        row.meta !== null &&
        (row.meta as CredentialMeta).modelProvider === provider
      ) {
        hits.push({ ns: row.namespace, name: row.provider });
      }
    }
    if (hits.length === 0) return undefined;
    // 撞绑排序：host 域 rank 0 → namespace 字典序 → 名字典序（全确定性）
    const rank = (ns: string): number => (ns === HOST_NAMESPACE ? 0 : 1);
    hits.sort(
      (a, b) =>
        rank(a.ns) - rank(b.ns) ||
        (a.ns < b.ns ? -1 : a.ns > b.ns ? 1 : 0) ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
    if (hits.length > 1) {
      warn(
        `provider ${provider} 绑定行撞绑（${hits.length} 行声明 modelProvider）——取 ${hits[0]!.ns}/${hits[0]!.name}（host 域优先、插件域字典序首行），其余行忽略。`,
      );
    }
    const first = hits[0]!;
    const row = store.getCredential(first.ns, first.name);
    if (row === undefined) return undefined; // 防御：list 与 get 间无 await，正常不可达
    return { ns: first.ns, name: first.name, meta: (row.meta ?? {}) as CredentialMeta };
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
    async refreshNow(provider: string): Promise<RefreshNowOutcome> {
      // 1) provider→绑定行解析（单源在本件）；解析面异常折 failed（warn 留痕、不计三振）
      let binding: ReturnType<typeof resolveBinding>;
      try {
        binding = resolveBinding(provider);
      } catch (err) {
        warn(`provider ${provider} 绑定行解析异常：${errText(err)}`);
        return { status: 'failed', errorMessage: errText(err) };
      }
      if (binding === undefined) {
        // 绑定行缺席：该 provider 无供血面——不可行形响亮上报（非静默跳过）
        return { status: 'unavailable', reason: 'binding-absent' };
      }
      const { ns, name, meta } = binding;
      // 2) expired 告示位在案——三振已收敛、重发起授权流是唯一出路（链侧
      //    notify 已在转换位发过，本腿不重发；裁决四·3 共账的读侧半）
      if (meta.expired === true) return { status: 'unavailable', reason: 'expired' };
      // 3) 无刷新面门：无 refreshName（单 token 形）/ 无 expiresAt（挂钟跳过
      //    族同形不归链管——B3 冷读 N5 定形）→ 无强刷对象
      if (typeof meta.refreshName !== 'string' || typeof meta.expiresAt !== 'number') {
        return { status: 'unavailable', reason: 'no-refresh-face' };
      }
      // 4) 流未注册（换代摘除/未装载——死域不续刷）；host 域行无流归属同形
      const pluginId = parsePluginNamespace(ns);
      const flow = pluginId === null ? undefined : registry.get(pluginId, name);
      if (flow === undefined) return { status: 'unavailable', reason: 'no-refresh-face' };
      // 5) 绕过提前量门直入单飞位（401 形 = 本地未到期被服务端撤销——裁决四·1；
      //    与挂钟在飞班次同 key 自动合流）
      return flight(flow);
    },
    start(intervalMs?: number): void {
      this.stop(); // 幂等重启（重复 start 先清旧钟）
      const ms = intervalMs ?? 60_000;
      timer = setInterval(
        () =>
          // 挂钟拍收口 catch（外层安全网）：flight 失败记账已内包防御壳
          // （「永不 reject」两腿同真——见 flight 核心 catch 体），本位兜
          // 记账壳外的残余异常面（tick 整拍 unforeseen 抛）——void 丢弃
          // rejected promise 即 unhandled rejection，崩溃编舞杀无人值守宿主。
          // 折 warn 留痕不外溢；warn 面自身抛再吞（catch 内再抛即新的 unhandled
          // ——日志面不可反杀宿主）。
          void this.tick().catch((err: unknown) => {
            try {
              warn(`凭证刷新挂钟拍异常：${errText(err)}`);
            } catch {
              // warn 注入形自身抛——终极吞
            }
          }),
        ms,
      );
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
