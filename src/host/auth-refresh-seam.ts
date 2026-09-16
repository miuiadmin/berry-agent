/**
 * B3 宿主凭证刷新联动腿——装配根 seam 真值工厂（04 §3.3 条 8）。
 *
 * 三注入的单点装配（classifyError 注入同族——conversation 不 import
 * llm/credentials，02 §4.1 边表由装配根满足）：
 * - authFamily：llm recovery 纯函数真源直填（04 §3.5 分面加判注）；
 * - refreshNow：env-static 前判（N2——env 面不在 credentials 件内注入，
 *   判在装配根闭包）→ credentials 链句柄惰性取（受局面在场链装载期经
 *   credentialsChainSink 填入；链缺席 = 零刷新面如实 unavailable）；
 * - notify：产品级指路文案 + M4 转换位去重（per-provider×outcome 进程内
 *   一次；'expired' 形静默——链侧 wasExpired 三振 notify 已含指路不重发）。
 */
import type { RefreshChainHandle } from '../credentials/index.js';
import { authFamily } from '../llm/index.js';
import type { AuthRefreshNotice, AuthRefreshOutcome, AuthRefreshSeam } from '../conversation/types.js';
import { providerApiKeyEnvNames } from './conversation-stack.js';

/** 装配面真值注入（assembly 单点供——测试结构桩同形） */
export interface HostAuthRefreshDeps {
  /** 链句柄惰性取（装载期 credentialsChainSink 填、运行期消费时读——受局面缺席恒 undefined） */
  readonly getChain: () => RefreshChainHandle | undefined;
  /** env 面（与 stack 凭证现取 wrapper 同源：options.env ?? process.env） */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** 用户面通知通道（stack.channels.notify 同源——source 归因字面 'credentials'） */
  readonly notifyChannel: (source: 'credentials', message: string) => void;
}

/** 不可行形产品级指路文案（diagnoseProviderFailure auth hint 同族——run 入口 stderr 消费先例） */
function noticeText(notice: AuthRefreshNotice): string {
  const provider = notice.provider;
  switch (notice.outcome.status) {
    case 'unavailable':
      switch (notice.outcome.reason) {
        case 'env-static':
          return `凭证 ${provider} 的 API key 由环境变量供血（静态无刷新面），本次 401 后不再自动重试——更新环境变量后重试`;
        case 'binding-absent':
          return `凭证 ${provider} 无绑定行（401 后无刷新面）——经 berry credentials 录入该 provider 凭证后可自动接管刷新`;
        default:
          // no-refresh-face：非 OAuth 可刷新凭证 / 流未注册 / 有 refreshName 无 expiresAt（N5）三形同归
          return `凭证 ${provider} 绑定行无刷新面（非可刷新凭证或对应流未注册）——401 后不可自动刷新，请重新配置`;
      }
    case 'failed':
      return `凭证 ${provider} 自动刷新失败${notice.outcome.errorMessage ? `（${notice.outcome.errorMessage}）` : ''}——请检查凭证配置或重新授权`;
  }
}

/**
 * 组装宿主 authRefresh seam 真值。去重位（M4）：'expired' 形静默（链侧
 * wasExpired 三振 notify 已含指路）；其余形 per-provider×outcome-key
 * 进程内恰一次（unavailable 不耗 1/1 分账、跨 runTurns 重复 401 每回
 * 可达联动腿——无去重即长跑刷屏）。
 */
export function createHostAuthRefreshSeam(deps: HostAuthRefreshDeps): AuthRefreshSeam {
  const notified = new Set<string>();
  return {
    authFamily,
    async refreshNow(provider: string): Promise<AuthRefreshOutcome> {
      // N2 前判先于链触达：env 静态 key = 刷新面结构性缺席（刷新成功也不会被采用）
      const envOccupied = providerApiKeyEnvNames(provider).some((name) => (deps.env[name] ?? '') !== '');
      if (envOccupied) return { status: 'unavailable', reason: 'env-static' };
      const chain = deps.getChain();
      if (chain === undefined) return { status: 'unavailable', reason: 'no-refresh-face' };
      return chain.refreshNow(provider);
    },
    notify(notice: AuthRefreshNotice): void {
      // expired 形借链侧 wasExpired 告示位——腿不重发（M4 定形）
      if (notice.outcome.status === 'unavailable' && notice.outcome.reason === 'expired') return;
      const key = `${notice.provider}×${
        notice.outcome.status === 'unavailable' ? notice.outcome.reason : notice.outcome.status
      }`;
      if (notified.has(key)) return;
      notified.add(key);
      deps.notifyChannel('credentials', noticeText(notice));
    },
  };
}
