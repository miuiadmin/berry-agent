/**
 * webui/client/App — SPA 壳根组件（批 18a-2；组件名 WebUiRoot——App 独立词
 * 词汇合规退役，文件名沿 React 惯例保留）。
 *
 * 编舞四段：①鉴权探针（cookie 已桥直进 / 未桥走 AuthGate 换桥——auth
 * cookie 桥是浏览器侧唯一凭证通道）②会话清单装载与切换（手动刷新 + 稳态
 * 周期复拍）③活体流接线（EventSource per 会话——onopen 恒重拉投影 +
 * approvals 清单复拉 + 连接态分档：断连弱横幅随 onopen 自撤、终态死流
 * 横幅带重试建流键）④稳态周期复拉（审批/会话清单 10s 一拍——跨会话
 * asked 可见性与外部开新呈现，见 Main 内注）。
 *
 * 语义全在 frames.ts（纯折叠器）；本件只做接线与呈现。StrictMode 双挂载
 * 下 effect 先后启停——EventSource cleanup 对称关流，无泄漏双流。
 *
 * 运行期凭证失效路由（webui-face#3）：token 随宿主重启轮换——旧 cookie 永久
 * 失效，重试不可能自愈。各调用面 401（isUnauthorized 单源判别）统一路由回
 * 换桥位（Main 卸载整面重置 + AuthGate 上方失效提示）；EventSource onerror
 * 探针腿同路由（死流 401 形的裁量收口——非 200 受理按 WHATWG fail the
 * connection 永久失败，本就不重连）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { api, isUnauthorized, sessionEventsUrl } from './api.js';
import type { SubmitAttachment } from './api.js';
import {
  appliedDecide,
  applyAsked,
  applyEnvelope,
  dismissNotice,
  droppedMessage,
  echoKeyOf,
  echoedUserMessage,
  failedSessions,
  initialAppState,
  isReceiptStatus,
  isTerminalStatus,
  loadedApprovals,
  loadedMessages,
  loadedSessions,
  loadedTodo,
  pushedNotice,
  setActiveSession,
  type AppState,
} from './frames.js';
import { ApprovalPanel } from './components/ApprovalPanel.js';
import { AuthGate } from './components/AuthGate.js';
import { Composer } from './components/Composer.js';
import { NoticeBar } from './components/NoticeBar.js';
import { SessionHeader } from './components/SessionHeader.js';
import { SessionList } from './components/SessionList.js';
import { TierPopover } from './components/TierPopover.js';
import { TodoPanel } from './components/TodoPanel.js';
import { Transcript } from './components/Transcript.js';
import type { ClientEnvelope } from './protocol.js';

/**
 * 浏览器原生下载（blob → 临时 object URL → 隐式 <a download> 点击）。
 *
 * fetch+blob 形（非 <a href> 直链）：鉴权在 fetch 腿完成（cookie 桥同源
 * 自动携行），失败可折通知条（直链形的 401/404 会整页跳 JSON 错误——不可
 * 控）；下载文件名由客户端定（同源 download 属性语义），object URL 用后
 * 即回收。
 */
function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/**
 * 下载文件名时间戳（ISO 压形——冒号/点替换连字符，文件名安全）。与 CLI
 * `berry sessions export` / TUI `/export` 落盘腿 src/host/session-export.ts
 * 的 fileStampOf 同形约定同步——客户端树隔离（零 host 依赖入 bundle），形
 * 同步靠 app.test.tsx 正则锁执法。
 */
function fileStampOf(ms: number): string {
  return new Date(ms).toISOString().replace(/[:.]/g, '-');
}

/* ---------------- 活体流连接态（SSE L3 终态死流 + L2 断连窗——webui-state） ---------------- */

/**
 * WHATWG EventSource readyState 的 CLOSED 值（2 = 连接已永久失败）。用字面
 * 常量而非 EventSource.CLOSED 静态位：jsdom 桩/旧环境无该静态（测试桩挂
 * globalThis 不带类静态），字面值是规范钉死位。
 */
const EVENT_SOURCE_CLOSED = 2;

/**
 * 活体流连接态（SSE L3/L2 分档——组件局部 state 承载，不入 AppState：连接
 * 编舞属接线域，折叠器形状有测试锁勿扩）：
 * - alive：已连/连接中（缺省档——无横幅）；
 * - reconnecting：网络面错误（readyState 非 CLOSED）——浏览器自动重连中，
 *   弱横幅呈现、onopen 即撤（L2 断连窗信号收口）；
 * - dead：终态死流（非 200 受理按 WHATWG fail the connection 永久 CLOSED
 *   ——不自动重连，零自愈路）——定性横幅 + 重试建流键（L3 恢复入口）。
 */
type StreamStatus =
  { readonly kind: 'alive' } | { readonly kind: 'reconnecting' } | { readonly kind: 'dead'; readonly reason: string };

/**
 * 终态死流定性分档（纯函数——测试面）：直 fetch 同一 SSE URL 的 HTTP 状态码
 * → 用户面直白因。404/503 与服务端 SSE 受理腿同码（会话不在场 / 连接数上限）
 *；其余（含 200 罕形、5xx、网络不可达、超时）归「连接已断开」不细分——
 * 恢复路统一走重试建流键。
 */
export function deadStreamReasonOf(status: number): string {
  if (status === 404) return '会话不存在';
  if (status === 503) return '连接数已达上限';
  return '连接已断开';
}

/**
 * 终态死流定性探针（SSE L3）：EventSource 已永久 CLOSED 时直 fetch 同一
 * SSE URL 读 HTTP 状态码——浏览器 EventSource 面不暴露状态码，fetch 才读得
 * 到。AbortController 超时兜底（宿主整体不可达形不挂死）；读到状态码即弃
 * 流体（200 受理形不占连接至超时）。401 形不在此路由——probeAuthed 腿专管
 * （换桥路由由鉴权腿先行处理，本探针 401 归「连接已断开」档不与之抢面）。
 */
async function classifyDeadStream(url: string, timeoutMs = 5_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
    void res.body?.cancel().catch(() => {}); // 状态码已读到——即弃流体（可选链整链短路，body 缺席无害）
    return deadStreamReasonOf(res.status);
  } catch {
    return '连接已断开'; // 网络不可达/超时——不可细分的兜底档
  } finally {
    clearTimeout(timer);
  }
}

/** 根组件（main.tsx 挂载位——auth 探针门 + 主面二段；组件名 WebUiRoot
 * 词汇合规更名〔check-vocab .tsx 扩面批〕——文件名 App.tsx 系 React 生态
 * 惯例文件名保留，仅标识符退役「App」独立词） */
export function WebUiRoot(): ReactElement {
  // null = 探针在飞；true = 已桥直进；false = 走换桥
  const [authed, setAuthed] = useState<boolean | null>(null);
  // 运行期失效旗（webui-face#3）：主面 401 路由置位——换桥位上方呈现失效
  // 提示（区别于冷启动未桥：用户已入过主面，凭证是中途失效非从未换桥）
  const [authLost, setAuthLost] = useState(false);
  useEffect(() => {
    let alive = true;
    api
      .probeAuthed()
      .then((ok) => {
        if (alive) setAuthed(ok);
      })
      .catch(() => {
        if (alive) setAuthed(false); // 网络面不可达按未桥处理——换桥位可重试
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * 失效路由（主面各调用面 401 共用回调）：回换桥位 + 立失效旗。useCallback
   * 钉身份（Main 各 effect/callback 依赖它——匿名 prop 每渲染新身份会抖
   * EventSource 重挂）。
   */
  const routeAuthLost = useCallback(() => {
    setAuthLost(true);
    setAuthed(false);
  }, []);

  if (authed === null) {
    // 连接中（界面美化役批⑦）：整面居中 + 呼吸点（活体感——静默文本升级
    // 为「在等什么」的可感信号）
    return (
      <div className="flex h-dvh items-center justify-center bg-panel text-sm text-ink-mute">
        <span aria-hidden className="mr-2 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
        连接中……
      </div>
    );
  }
  if (!authed) {
    return (
      <div className="min-h-dvh bg-panel">
        {authLost ? (
          <p className="bg-red-950/60 px-4 py-2 text-center text-xs text-red-300">
            凭证已失效——宿主重启后 token 已轮换，请输入新的一次性 token 重新登录
          </p>
        ) : null}
        <AuthGate
          onAuthed={() => {
            setAuthLost(false); // 换桥成功即撤失效提示（下次失效重新置位）
            setAuthed(true);
          }}
        />
      </div>
    );
  }
  return <Main onAuthLost={routeAuthLost} />;
}

/** 主面（会话清单 + 正文 + 审批/todo/通知侧栏 + 输入） */
function Main({ onAuthLost }: { onAuthLost: () => void }): ReactElement {
  const [state, setState] = useState<AppState>(initialAppState);
  /**
   * 档位浮层开向（null = 闭）。/thinking //sandbox 恰零参命中即本地开层
   * ——不进提交流（TUI 本地拦截族同归属律：不进通道核命令表、零 submitText
   * 消费）；词面分立两值驱动 TierPopover 的 kind 半边。
   */
  const [tierPopover, setTierPopover] = useState<'thinking' | 'sandbox' | null>(null);
  /**
   * 窄屏侧栏抽屉开向（false = 闭；md 起侧栏常驻不受此态影响——响应式
   * 界面美化役批③：w-64 侧栏在窄屏折为抽屉，汉堡键开向 + 遮罩/选会话收向）。
   */
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /**
   * 主题档（2026-10-07 webui 深浅色批——03 §10.4 批注条款②③）：缺省暗
   * （html 无 data-theme 即暗——暗值唯一住所是 app.css @theme），浅档经
   * data-theme='light' token 覆写。初始读 DOM（index.html 内联防闪脚本已
   * 先行设位——SPA 挂载时 DOM 已就位，防首帧闪变）；state 只辖钮文案，
   * 翻档判据单源是 DOM dataset。系统跟随 auto 态不入 v1（三态复杂度）。
   */
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
  );
  /**
   * 主题翻档三同步（条款③）：html data-theme（翻浅设 'light' / 翻暗 remove
   * 属性——保「暗=无属性」单源形）+ localStorage 'webui_theme' 持久 +
   * meta[name=color-scheme] content 同笔（原生控件/滚动条 UA 形随档）。
   * meta 可选链：在场面是 index.html；缺席（异常嵌入形）无操作不崩。
   */
  const toggleTheme = useCallback(() => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    if (next === 'light') {
      document.documentElement.dataset.theme = 'light';
    } else {
      delete document.documentElement.dataset.theme; // 暗=无属性（remove 形）
    }
    localStorage.setItem('webui_theme', next);
    document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', next);
    setTheme(next);
  }, []);
  /**
   * 活体流连接态（SSE L3/L2——组件局部 state，不入 AppState 折叠器形状）：
   * 建流起点复位 alive；非终态错误置 reconnecting（onopen 撤）；终态死流
   * 置 dead（定性探针供因）。
   */
  const [streamStatus, setStreamStatus] = useState<StreamStatus>({ kind: 'alive' });
  /** 终态死流重试键（自增驱动活体流 effect 重建——L3 恢复入口） */
  const [streamRetry, setStreamRetry] = useState(0);
  /** 重拉投影腿（onopen 与会话切换共用——正确性层恒重拉） */
  const reloadProjection = useCallback(
    (sessionId: string) => {
      // 各腿 401 → 失效路由（webui-face#3）；其余错静默——onopen/重试自愈
      void api
        .fetchMessages(sessionId)
        .then((messages) => {
          setState((prev) => (prev.activeId === sessionId ? loadedMessages(prev, messages) : prev));
        })
        .catch((err: unknown) => {
          if (isUnauthorized(err)) onAuthLost();
        });
      void api
        .todo(sessionId)
        .then((items) => {
          setState((prev) => (prev.activeId === sessionId ? loadedTodo(prev, items) : prev));
        })
        .catch((err: unknown) => {
          if (isUnauthorized(err)) onAuthLost();
        });
      void api
        .listApprovals()
        .then((list) => {
          // 整段重置（服务端现行 pending 清单即真源——与 loadedMessages 同模式）：
          // 异口已决条目随复拉出清；applyAsked 的增量合并径只留给活体 asked 帧
          setState((prev) => loadedApprovals(prev, list));
        })
        .catch((err: unknown) => {
          if (isUnauthorized(err)) onAuthLost();
        });
    },
    [onAuthLost],
  );

  // 会话清单装载（首载 + 手动刷新 + 周期复拍共用）
  const loadSessions = useCallback(() => {
    void api
      .listSessions()
      .then(({ sessions, total }) => {
        setState((prev) => {
          const withSessions = loadedSessions(prev, sessions, total);
          // 首载且无选中——自动选首会话（无会话则保持 null，SessionList 引导开新）
          if (prev.activeId === null && sessions.length > 0) return setActiveSession(withSessions, sessions[0]!.id);
          return withSessions;
        });
      })
      .catch((err: unknown) => {
        // 401 → 失效路由；其余落失败旗（空态呈现失败行——拉不到清单不假
        // 声明「暂无会话」；手动刷新与周期复拍可再试）
        if (isUnauthorized(err)) onAuthLost();
        else setState((prev) => failedSessions(prev));
      });
  }, [onAuthLost]);
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  /**
   * 稳态周期复拉（审批清单 + 会话清单，10s 一拍）：跨会话 asked 的活体
   * 镜像只扇给订阅该会话的流（服务端 pushToSession 按会话隔离），SPA 仅
   * 订阅活跃会话一条——他会话 run 到达工具审批时镜像帧无订阅者被静默丢弃，
   * 而审批面板设计上跨会话全量呈现；REST 全量清单腿周期复拉补此可见性
   * 缺口（挂起等人审批是设计语义，缺陷是「零信号」）。同拍刷新会话清单：
   * 外部开新（SDK 线/他页签/scheduler 无头会话）运行期出现于侧栏。401 →
   * 失效路由；其余静默（下一拍自愈——清单复拉非关键路径）。
   */
  useEffect(() => {
    const timer = setInterval(() => {
      void api
        .listApprovals()
        .then((list) => {
          setState((prev) => loadedApprovals(prev, list));
        })
        .catch((err: unknown) => {
          if (isUnauthorized(err)) onAuthLost();
        });
      loadSessions();
    }, 10_000);
    return () => {
      clearInterval(timer);
    };
  }, [loadSessions, onAuthLost]);

  // 活体流接线（per 会话——切换即换流；onopen 恒重拉投影 = 正确性层真源；
  // streamRetry 自增强制重建流 = 终态死流重试建流键的驱动位）
  useEffect(() => {
    if (state.activeId === null) return;
    const sessionId = state.activeId;
    // 建流起点复位连接态（重试/切换后旧横幅不驻留）
    setStreamStatus({ kind: 'alive' });
    let cancelled = false; // 会话已切走/重试已重建——迟到回写不污染新流状态
    // 流 URL 走 api 层单源铸造（sessionEventsUrl——端点表 sessionEvents 项唯一
    // 消费位，L8-2：修前手写字面量第三份副本，服务端改词面时对拍锁够不到）
    const source = new EventSource(sessionEventsUrl(sessionId));
    source.onopen = () => {
      // 连上即撤断连弱横幅（L2：重连成功信号）；投影恒重拉（正确性层真源）
      setStreamStatus({ kind: 'alive' });
      reloadProjection(sessionId);
    };
    source.onerror = () => {
      // 错误分档（SSE L3，按 WHATWG readyState）：
      // - 非 CLOSED（网络面错误）→ 浏览器自动重连中：断连弱横幅（L2——
      //   正文恒空不再零信号谎报「活着」），onopen 即撤，无需干预；
      // - CLOSED（永久失败——非 200 受理形：404 会话不在场/503 连接帽满/
      //   401 已由下探针腿先行路由）→ 零自愈路：直 fetch 定性探针读状态码，
      //   终态横幅 + 重试建流键。
      if (source.readyState !== EVENT_SOURCE_CLOSED) {
        setStreamStatus({ kind: 'reconnecting' });
        return;
      }
      void classifyDeadStream(sessionEventsUrl(sessionId)).then((reason) => {
        if (!cancelled) setStreamStatus({ kind: 'dead', reason });
      });
      // 鉴权探针腿（webui-face#3 裁量）：cookie 失效形的服务端 401 不建流
      //——探针定性，失效即路由换桥位（Main 卸载后上面的迟到回写被守卫拦）
      void api
        .probeAuthed()
        .then((ok) => {
          if (!ok) onAuthLost();
        })
        .catch(() => {}); // 探针自身网络错（宿主暂不可达）按连接面处理——重连续命
    };
    source.onmessage = (ev: MessageEvent<string>) => {
      let env: ClientEnvelope;
      try {
        env = JSON.parse(ev.data) as ClientEnvelope;
      } catch {
        return; // 坏帧静默丢（帧合成钉死服务端单行——防御位）
      }
      setState((prev) => {
        if (prev.activeId !== sessionId) return prev; // 迟到帧（已切走）不串台
        if (env.kind === 'session' && env.payload.type === 'approval/asked') {
          return applyAsked(prev, { ...env.payload, sessionId: env.sessionId });
        }
        return applyEnvelope(prev, env);
      });
    };
    return () => {
      cancelled = true;
      source.close();
    };
  }, [state.activeId, streamRetry, reloadProjection, onAuthLost]);

  /** 会话切换（清单点击——窄屏抽屉随选即收） */
  const switchSession = useCallback((sessionId: string) => {
    setState((prev) => setActiveSession(prev, sessionId));
    setSidebarOpen(false); // 抽屉形（<md）选后会话即收——常驻形（md+）此置位无感
  }, []);

  /** 开新会话（POST → 清单刷新 → 选中新 id；失败不静默——401 失效路由 / 其余通知条） */
  const createSession = useCallback(() => {
    void api
      .createSession()
      .then((sessionId) => {
        setState((prev) => setActiveSession(prev, sessionId));
        loadSessions();
      })
      .catch((err: unknown) => {
        // 401 → 失效路由（webui-face#3）：cookie 永久失效重试不可能自愈，
        // 换桥是唯一出路（submit/export 族处置先例照搬）；其余失败折通知条
        //（同导出失败呈现形——错误不静默）
        if (isUnauthorized(err)) {
          onAuthLost();
          return;
        }
        setState((prev) => pushedNotice(prev, '新建会话失败——请重试', 'error'));
      });
  }, [loadSessions, onAuthLost]);

  /**
   * 删除会话（2026-10-07 会话删除编排批——确认编舞在 App）：行内删除键
   * 回调——破坏性动作必有确认（window.confirm 警示句三载体同文，本载体
   * 前缀句点明载体）；成功就地滤行 + 总数同减（刷新重拉最小形——不重拉
   * 清单，total 不减即翻「N/M（仅显示最近）」假截断注记新谎，与 TUI
   * session-picker 同裁量）；删的是当前选中会话 → 清选至无选中态
   * （不自动跳选他话——选中是用户意图，不代言）；失败（409 busy /
   * 404 not_found / 网络面错）不静默：401 失效路由，其余 err.message
   * 服务端人读因直呈通知条（409 的「会话正在运行——…」即达用户）。
   */
  const deleteSession = useCallback(
    (sessionId: string) => {
      // 确认编舞（破坏性动作必有确认）：警示句 verbatim 三载体一致——
      // 含审批记录在内的全部会话史将被删且不可恢复
      if (!window.confirm('删除会话？含审批记录在内的全部会话史将被删除，且不可恢复。')) return;
      void api
        .deleteSession(sessionId)
        .then(() => {
          // 成功：就地滤行 + 总数同减（删除后 total 真值已减 1——B2 注记
          // 判据 total > 清单长两侧同步动，不递减即假截断新谎）
          setState((prev) => {
            const sessions = prev.sessions.filter((s) => s.id !== sessionId);
            const total = prev.sessionsTotal !== undefined ? Math.max(0, prev.sessionsTotal - 1) : undefined;
            const next = loadedSessions(prev, sessions, total);
            // 删的是当前选中 → 清选（null = 无选中态：消息/待办/运行账全
            // 清——setActiveSession 内建）；不自动跳选他话
            return prev.activeId === sessionId ? setActiveSession(next, null) : next;
          });
        })
        .catch((err: unknown) => {
          // 401 → 失效路由（submit/export 族处置先例照搬）；其余失败折
          // 通知条——err.message = 服务端人读因（409 busy 同句直呈）
          if (isUnauthorized(err)) {
            onAuthLost();
            return;
          }
          setState((prev) =>
            pushedNotice(prev, err instanceof Error && err.message !== '' ? err.message : '删除失败——请重试', 'error'),
          );
        });
    },
    [onAuthLost],
  );

  /**
   * 提交入定会话（档位词拦截 + 乐观回显 + 失败撤回）：messageId =
   * crypto.randomUUID 服务端幂等位；撤回键 = echoKeyOf 同源落稿键（闭包
   * 持键——catch 按键撤回，不靠尾部位置）。附件（剪贴板附件批——03
   * §10.4 批注⑥）：chip 原形透传 api.submit（dataURL 前缀剥除归 api 层
   * 单源——App 零形状知识）；回显随附件数计 [图片] 占位 token（image-only
   * 空文可配对——frames 图块补位）。
   */
  const submitInto = (sessionId: string, rawText: string, attachments?: readonly SubmitAttachment[]): void => {
    // ---- 档位词拦截（webui 档位面受理批——03 §10.4 SPA 受理面条款）----
    const trimmed = rawText.trim();
    // 首 token 词干切分（TUI maybeHandleLocalCommand 同律——/\s+/ 切分：
    // 空格/tab/换行〔Shift+Enter 形〕分隔的参数一律算带参，零分立——
    // 空格字面 startsWith 形会漏穿透 tab/换行形，禁用）
    const stem = trimmed.split(/\s+/, 1)[0] ?? '';
    if (stem === '/thinking' || stem === '/sandbox') {
      if (trimmed === stem) {
        // 恰零参命中——本地开档位浮层，不进提交流（浮层行集 = GET tiers
        // 应答、选定走 PUT——见 TierPopover）
        setTierPopover(stem === '/thinking' ? 'thinking' : 'sandbox');
        return;
      }
      // 带参形 = 词干命中即本地用法错（fail-loud——与 TUI「带参 fail-loud
      // 用法错不穿透」同律对齐，零分立）：折 NoticeBar error 不提交
      // （本地推播走 pushedNotice——与 notify 帧腿同帽同形不绕帽）
      setState((prev) =>
        pushedNotice(
          prev,
          stem === '/thinking'
            ? '/thinking 不带参数使用——深度思考级别经浮层选定'
            : '/sandbox 不带参数使用——沙箱模式经浮层选定',
          'error',
        ),
      );
      return;
    }
    const text = trimmed;
    const messageId = crypto.randomUUID();
    // 乐观回显 + 失败撤回：messageId = crypto.randomUUID 幂等位（服务端
    // 幂等去重锚）；回显走 echoedUserMessage 入账（登记待配对账目——服务端
    // kick/steer 的 user 种子镜像到达时由折叠器吸收保恰一份，webui-face#1）；
    // 撤回键 = echoKeyOf 同源落稿键（闭包持键——失败撤回按键定位，不靠
    // 尾部位置）
    const echoTimestamp = Date.now();
    // 回显带附件占位 token（图块补位——镜像吸收与投影对账两路共键）；附件
    // 数透传（imageCount），App 不持有 dataURL 形状知识
    setState((prev) => echoedUserMessage(prev, sessionId, text, echoTimestamp, attachments?.length ?? 0));
    // 提交调用面：纯文恒三参（既有调用契约零漂移）；带附件四参（chip 原形
    // 透传——空数组形 Composer 侧已不触发，api 层另有空数组零漂移防线）
    const submitted =
      attachments !== undefined && attachments.length > 0
        ? api.submit(sessionId, text, messageId, attachments)
        : api.submit(sessionId, text, messageId);
    void submitted.catch((err: unknown) => {
      // 401 → 失效路由（webui-face#3）：cookie 永久失效重试不可能自愈，
      // 换桥是唯一出路——不折「请重试」谎提示（回显随 Main 卸载整面消散）
      if (isUnauthorized(err)) {
        onAuthLost();
        return;
      }
      // 失败撤回（契约兑现）：未被受理的乐观回显先出正文，再推失败通知
      // ——err.message = 服务端人读因直呈（删除流同式；受理拒五族文案
      // 03 §10.4 ② 经 foldError message 位透传，「请重试」对不可重试拒因
      // 是谎提示——非 Error 形/空 message 折兜底串）
      setState((prev) =>
        pushedNotice(
          droppedMessage(prev, echoKeyOf(echoTimestamp)),
          err instanceof Error && err.message !== '' ? err.message : '提交失败——请重试',
          'error',
        ),
      );
    });
  };

  /**
   * 提交（零会话态先自动开新再提交）：全新宿主首开 webui / 清单装载失败
   * 时 activeId=null，而 Composer 发送即清空输入——静默 return 会吞掉用户
   * 敲入的第一条（不可恢复的输入丢失、零反馈）。与 serve stdio
   * submitPrompt sessionId 缺席即建会话的既有行为对齐：先开新会话再走正常
   * 提交流；开新失败折通知条（错误不静默——输入虽已被清空，至少呈现因）。
   */
  const submit = useCallback(
    (rawText: string, attachments?: readonly SubmitAttachment[]) => {
      const sessionId = state.activeId;
      if (sessionId === null) {
        void api
          .createSession()
          .then((newId) => {
            setState((prev) => setActiveSession(prev, newId));
            loadSessions();
            submitInto(newId, rawText, attachments);
          })
          .catch((err: unknown) => {
            // 401 → 失效路由（同 createSession 腿）；其余折通知条
            if (isUnauthorized(err)) {
              onAuthLost();
              return;
            }
            setState((prev) => pushedNotice(prev, '提交失败——自动开新会话未成功，请重试', 'error'));
          });
        return;
      }
      submitInto(sessionId, rawText, attachments);
    },
    [state.activeId, loadSessions, onAuthLost],
  );

  /** 打断在飞 run */
  const interrupt = useCallback(() => {
    if (state.activeId === null) return;
    void api.interrupt(state.activeId).catch((err: unknown) => {
      // 打断失败本静默（非关键路径）；401 仍路由（凭证失效面跨调用统一）
      if (isUnauthorized(err)) onAuthLost();
    });
  }, [state.activeId, onAuthLost]);

  /**
   * 导出当前会话（markdown 下载——SPA /export 客户端消费腿）。文件名
   * `<会话id>-<时间戳>.md` 与 CLI `berry sessions export` / TUI `/export`
   * 落盘形对齐（跨入口同名族——CLI/TUI 时间戳防共享 exports/ 目录撞名，
   * 浏览器下载目录归用户管理且重复下载自去重不覆盖，对齐纯为命名族一致）。
   * 失败折通知条（同提交失败呈现形——错误不静默）。
   */
  const exportActive = useCallback(() => {
    const sessionId = state.activeId;
    if (sessionId === null) return;
    void api
      .exportSession(sessionId)
      .then((blob) => {
        triggerDownload(`${sessionId}-${fileStampOf(Date.now())}.md`, blob);
      })
      .catch((err: unknown) => {
        // 401 → 失效路由（webui-face#3）；其余失败折通知条（本地推播走
        // pushedNotice——与 notify 帧腿同帽同形）
        if (isUnauthorized(err)) {
          onAuthLost();
          return;
        }
        setState((prev) => pushedNotice(prev, '导出失败——请重试', 'error'));
      });
  }, [state.activeId, onAuthLost]);

  /**
   * 审批应答（applied/superseded 同出清——异口已答同语义；失败腿撤遮罩 +
   * 失败通知 + 回拉清单自愈——L8-1）。decide 实际落地而响应丢失的窗口由
   * missTicks 两拍律兜底（见 appliedDecide 失败回执形头注）。
   */
  const decide = useCallback(
    (approvalId: string, answer: 'approve' | 'reject' | 'cancel') => {
      setState((prev) => appliedDecide(prev, approvalId));
      void api.decide(approvalId, answer).catch((err: unknown) => {
        // 401 → 失效路由（webui-face#3）；其余失败：撤已决遮罩（失败回执形）
        // + 失败通知 + 回拉清单自愈（真源复拉）。L8-1（第十一轮深扫 laneG）：
        // 修前已决遮罩恰拦这条复拉复活径——服务端真源仍 pending 的审批卡被遮
        // 两拍（10s 周期 × 2 ≈ 20s）不可见且零失败反馈（对比导出失败腿有通
        // 知条）；撤遮罩后复拉经「清单新增」径即刻复活，失败提示对齐导出失败
        // 腿（错误不静默）。不回退第十轮幻影复活修复——成功回执形的遮罩语义
        // 原样维持（两机制分立）
        if (isUnauthorized(err)) {
          onAuthLost();
          return;
        }
        setState((prev) => pushedNotice(appliedDecide(prev, approvalId, true), '审批提交失败——请重试', 'error'));
        if (state.activeId !== null) reloadProjection(state.activeId);
      });
    },
    [state.activeId, reloadProjection, onAuthLost],
  );

  /** 自动滚底（新帧/新消息到达——贴底跟随；手动上滚不打扰 v1 不做打断检测） */
  const bottomRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    // 可选调用形：浏览器恒在场；jsdom 不实现 scrollIntoView（测试环境防御，
    // 缺席即无操作——贴底跟随是呈现增强非正确性面）
    bottomRef.current?.scrollIntoView?.({ block: 'end' });
  }, [state.messages, state.status]);

  /**
   * run 在飞判据（打断键使能面——Composer canInterrupt 供血，界面美化役
   * 批⑧）：活体窗开（agent_start→agent_end）或流式尾巴在飞或进度型状态行
   * 在呈，三信号任一即真；闲态禁打断键（诚实呈「无 run 可打断」，修前恒可点的
   * 无效键）。中途附着（页面加载时 run 已在飞、无 agent_start）由流式尾巴/
   * 状态行信号补位覆盖。终态状态行（⏹ 已中止 / ✗ 失败——E2 连带面）与回执型
   * 状态行（档位切换回执——第九轮 laneE2 件1：驻留型 status 非 run 进度，
   * isReceiptStatus 闭集分类）是「已收口/非进度」的呈现，不计入在飞信号
   * （修前两者皆误当在飞——打断键伪使能）。
   */
  const runInFlight =
    state.runActive ||
    (state.status !== null && !isTerminalStatus(state.status) && !isReceiptStatus(state.status)) ||
    state.messages.some((m) => m.streaming);

  return (
    /* h-dvh + antialiased（界面美化役批③——dvh 视口在移动端工具栏收展下恒正确；
     * 抗锯齿基线一次到位） */
    <div className="flex h-dvh bg-canvas text-sm antialiased">
      {/* 侧栏：会话清单 + todo（md 起常驻；窄屏折为抽屉——sidebarOpen 开向，
          遮罩点击/选会话收向；translate 形离屏不卸载——清单态跨开合保留） */}
      <aside
        className={`fixed inset-y-0 left-0 z-30 flex w-64 shrink-0 flex-col border-r border-edge bg-canvas transition-transform duration-150 md:static md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-edge px-3 py-2">
          <span className="font-semibold text-ink">berry-agent</span>
          <div className="flex items-center gap-1">
            {/* 手动刷新（清单装载失败/外部开新的即时恢复入口——与周期复拍互补） */}
            <button
              type="button"
              aria-label="刷新会话清单"
              className="rounded bg-edge px-2 py-0.5 text-xs text-ink-soft hover:bg-edge-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              onClick={loadSessions}
            >
              刷新
            </button>
            <button
              type="button"
              className="rounded bg-edge px-2 py-0.5 text-xs text-ink-soft hover:bg-edge-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              onClick={createSession}
            >
              + 新会话
            </button>
            {/* 主题切换（03 §10.4 批注条款②）：同族小键形；文案 = 对面档直白词
                （当前暗→「浅色」——点击切浅；当前浅→「深色」）。可见文案本身即
                无障碍名（免 aria-label——刷新键是图标位先行例，本钮文案自足） */}
            <button
              type="button"
              className="rounded bg-edge px-2 py-0.5 text-xs text-ink-soft hover:bg-edge-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              onClick={toggleTheme}
            >
              {theme === 'light' ? '深色' : '浅色'}
            </button>
          </div>
        </div>
        <SessionList
          sessions={state.sessions}
          activeId={state.activeId}
          onSelect={switchSession}
          onDelete={deleteSession}
          loadFailed={state.sessionsFailed}
          totalCount={state.sessionsTotal}
        />
        <TodoPanel todo={state.todo} />
      </aside>
      {/* 抽屉遮罩（<md 且开向才在场——点击收向；md 起侧栏常驻无遮罩） */}
      {sidebarOpen ? (
        <div
          aria-hidden
          className="fixed inset-0 z-20 bg-black/40 md:hidden"
          onClick={() => {
            setSidebarOpen(false);
          }}
        />
      ) : null}
      {/* 主列：窄屏顶栏 + 通知浮条 + 会话详情头行 + 正文 + 状态行 + 输入 */}
      <main className="flex min-w-0 flex-1 flex-col bg-panel">
        {/* 窄屏顶栏（<md 侧栏折抽屉后的会话入口——汉堡开抽屉；md 起侧栏常驻
            此栏缺席） */}
        <header className="flex items-center gap-2 border-b border-edge bg-canvas px-3 py-2 md:hidden">
          <button
            type="button"
            aria-label="打开会话清单"
            className="rounded px-2 py-0.5 text-sm text-ink-soft hover:bg-edge focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
            onClick={() => {
              setSidebarOpen(true);
            }}
          >
            ☰
          </button>
          <span className="text-xs font-semibold text-ink-soft">berry-agent</span>
        </header>
        {/* 通知浮条（fixed 顶中——不占布局流；onDismiss 在场即呈 × 键，关闭
            走 dismissNotice 按 id 出清） */}
        <NoticeBar
          notices={state.notices}
          onDismiss={(id) => {
            setState((prev) => dismissNotice(prev, id));
          }}
        />
        {/* 会话详情头行（有活跃会话才在场——导出入口随行；清单未含新会话
            的瞬窗标题回退 id 截断，同 SessionList 诚实回退律） */}
        {state.activeId !== null ? (
          <SessionHeader
            title={state.sessions.find((s) => s.id === state.activeId)?.title ?? null}
            sessionId={state.activeId}
            onExport={exportActive}
          />
        ) : null}
        {/* 连接态横幅（SSE L3/L2）：断连中弱横幅（琥珀弱档——onopen 自撤，
            不定性不建键）/ 终态死流横幅（红档——样式对齐凭证失效横幅形）带
            重试建流键（关旧流重开流，effect 随重试键位重建） */}
        {state.activeId !== null && streamStatus.kind === 'reconnecting' ? (
          <div className="bg-amber-950/60 px-4 py-1.5 text-center text-xs text-amber-300">已断线，正在重连……</div>
        ) : null}
        {state.activeId !== null && streamStatus.kind === 'dead' ? (
          <div className="flex items-center justify-between gap-3 bg-red-950/60 px-4 py-2 text-xs text-red-300">
            <span className="min-w-0 break-words">实时连接失败——{streamStatus.reason}</span>
            <button
              type="button"
              className="shrink-0 rounded bg-edge px-2 py-0.5 text-ink-soft hover:bg-edge-strong focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
              onClick={() => {
                setStreamRetry((n) => n + 1); // 自增驱动活体流 effect 重建（重试建流）
              }}
            >
              重试连接
            </button>
          </div>
        ) : null}
        <Transcript messages={state.messages} status={state.status} bottomRef={bottomRef} />
        {/* relative 容器兼档位浮层锚（TierPopover 卡体 bottom-full 锚本容器
            上沿——随输入区实际高度自适应，界面美化役批⑥） */}
        <div className="relative">
          {/* 输入区（@ 文件段补全源经闭包注入——api.workspaceFiles 消费腿；
              prop 在场即启用弹层，失败由 Composer 静默收层不打扰通知条；
              canInterrupt = run 在飞判据〔闲态禁用〕） */}
          <Composer
            onSubmit={submit}
            onInterrupt={interrupt}
            canInterrupt={runInFlight}
            fetchFileCompletions={(query) => api.workspaceFiles(query)}
          />
          {/* 档位浮层（/thinking //sandbox 恰零参拦截开层——卡体锚本容器；
              onReceipt 走 info 档通知条、onError 走 error 档——NoticeBar 四档
              色表 info 在册）；onClose 全路清 null */}
          {state.activeId !== null && tierPopover !== null ? (
            <TierPopover
              kind={tierPopover}
              sessionId={state.activeId}
              onClose={() => {
                setTierPopover(null);
              }}
              onReceipt={(receipt) => {
                // 回执入通知条（info 呈现位——本地推播走 pushedNotice 同帽 5）
                setState((prev) => pushedNotice(prev, receipt, 'info'));
              }}
              onError={(message) => {
                // 切档错误入通知条（error 呈现位——同帽同形律）
                setState((prev) => pushedNotice(prev, message, 'error'));
              }}
              onAuthLost={onAuthLost}
            />
          ) : null}
        </div>
      </main>
      {/* 右栏：审批（零待审批不渲染——主列回收宽度，界面美化役批④；窄屏
          缺席化——xl 起常驻〔组件内 hidden xl:flex〕，批③） */}
      {state.approvals.length > 0 ? <ApprovalPanel approvals={state.approvals} onDecide={decide} /> : null}
    </div>
  );
}
