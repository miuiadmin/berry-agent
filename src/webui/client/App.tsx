/**
 * webui/client/App — SPA 壳根组件（批 18a-2）。
 *
 * 编舞三段：①鉴权探针（cookie 已桥直进 / 未桥走 AuthGate 换桥——auth
 * cookie 桥是浏览器侧唯一凭证通道）②会话清单装载与切换 ③活体流接线
 * （EventSource per 会话——onopen 恒重拉投影 + approvals 清单复拉）。
 *
 * 语义全在 frames.ts（纯折叠器）；本件只做接线与呈现。StrictMode 双挂载
 * 下 effect 先后启停——EventSource cleanup 对称关流，无泄漏双流。
 *
 * 运行期凭证失效路由（webui-face#3）：token 随宿主重启轮换——旧 cookie 永久
 * 失效，重试不可能自愈。各调用面 401（isUnauthorized 单源判别）统一路由回
 * 换桥位（Main 卸载整面重置 + AuthGate 上方失效提示）；EventSource onerror
 * 探针腿同路由（死流 401 重连恒败的裁量收口）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { api, isUnauthorized } from './api.js';
import {
  appliedDecide,
  applyAsked,
  applyEnvelope,
  droppedMessage,
  echoKeyOf,
  echoedUserMessage,
  initialAppState,
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

/** 根组件（main.tsx 挂载位——auth 探针门 + 主面二段） */
export function App(): ReactElement {
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
    return <div className="p-4 text-sm text-zinc-500">连接中……</div>;
  }
  if (!authed) {
    return (
      <div className="min-h-screen bg-zinc-900">
        {authLost ? (
          <p className="bg-red-950/60 px-4 py-2 text-center text-xs text-red-300">
            凭证已失效——宿主重启后 token 已轮换，请输入新的一次性 token 重新换桥
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

  // 会话清单装载（首载 + 手动刷新共用）
  const loadSessions = useCallback(() => {
    void api
      .listSessions()
      .then((sessions) => {
        setState((prev) => {
          const withSessions = loadedSessions(prev, sessions);
          // 首载且无选中——自动选首会话（无会话则保持 null，SessionList 引导开新）
          if (prev.activeId === null && sessions.length > 0) return setActiveSession(withSessions, sessions[0]!.id);
          return withSessions;
        });
      })
      .catch((err: unknown) => {
        // 401 → 失效路由；其余静默（清单刷新非关键路径——手动刷新可再试）
        if (isUnauthorized(err)) onAuthLost();
      });
  }, [onAuthLost]);
  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // 活体流接线（per 会话——切换即换流；onopen 恒重拉投影 = 正确性层真源）
  useEffect(() => {
    if (state.activeId === null) return;
    const sessionId = state.activeId;
    const source = new EventSource(`/api/sessions/${encodeURIComponent(sessionId)}/events`);
    source.onopen = () => {
      reloadProjection(sessionId);
    };
    source.onerror = () => {
      // 死流探测腿（webui-face#3 裁量）：EventSource 自动重连，但 cookie 失效
      // 形的死流重连恒败（服务端 401 不建流）——探针定性，失效即路由换桥位
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
      source.close();
    };
  }, [state.activeId, reloadProjection, onAuthLost]);

  /** 会话切换（清单点击） */
  const switchSession = useCallback((sessionId: string) => {
    setState((prev) => setActiveSession(prev, sessionId));
  }, []);

  /** 开新会话（POST → 清单刷新 → 选中新 id） */
  const createSession = useCallback(() => {
    void api.createSession().then((sessionId) => {
      setState((prev) => setActiveSession(prev, sessionId));
      loadSessions();
    });
  }, [loadSessions]);

  /**
   * 提交（乐观回显 + 失败撤回）：messageId = crypto.randomUUID 服务端幂等
   * 位；撤回键 = echoKeyOf 同源落稿键（闭包持键——catch 按键撤回，不靠
   * 尾部位置）。
   */
  const submit = useCallback(
    (rawText: string) => {
      const sessionId = state.activeId;
      if (sessionId === null) return;
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
            stem === '/thinking' ? '/thinking 不带参数使用——档位经浮层选定' : '/sandbox 不带参数使用——档位经浮层选定',
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
      setState((prev) => echoedUserMessage(prev, sessionId, text, echoTimestamp));
      void api.submit(sessionId, text, messageId).catch((err: unknown) => {
        // 401 → 失效路由（webui-face#3）：cookie 永久失效重试不可能自愈，
        // 换桥是唯一出路——不折「请重试」谎提示（回显随 Main 卸载整面消散）
        if (isUnauthorized(err)) {
          onAuthLost();
          return;
        }
        // 失败撤回（契约兑现）：未被受理的乐观回显先出正文，再推失败通知
        setState((prev) => pushedNotice(droppedMessage(prev, echoKeyOf(echoTimestamp)), '提交失败——请重试', 'error'));
      });
    },
    [state.activeId, onAuthLost],
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

  /** 审批应答（applied/superseded 同出清——异口已答同语义；失败回拉清单自愈） */
  const decide = useCallback(
    (approvalId: string, answer: 'approve' | 'reject' | 'cancel') => {
      setState((prev) => appliedDecide(prev, approvalId));
      void api.decide(approvalId, answer).catch((err: unknown) => {
        // 401 → 失效路由（webui-face#3）；其余失败回拉清单自愈（真源复拉）
        if (isUnauthorized(err)) {
          onAuthLost();
          return;
        }
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

  return (
    <div className="flex h-screen text-sm">
      {/* 侧栏：会话清单 + todo */}
      <aside className="flex w-64 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <span className="font-semibold text-zinc-200">berry-agent</span>
          <button
            type="button"
            className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
            onClick={createSession}
          >
            + 新会话
          </button>
        </div>
        <SessionList sessions={state.sessions} activeId={state.activeId} onSelect={switchSession} />
        <TodoPanel todo={state.todo} />
      </aside>
      {/* 主列：通知条 + 会话详情头行 + 正文 + 状态行 + 输入 */}
      <main className="flex min-w-0 flex-1 flex-col bg-zinc-900">
        <NoticeBar notices={state.notices} />
        {/* 会话详情头行（有活跃会话才在场——导出入口随行；清单未含新会话
            的瞬窗标题回退 id 截断，同 SessionList 诚实回退律） */}
        {state.activeId !== null ? (
          <SessionHeader
            title={state.sessions.find((s) => s.id === state.activeId)?.title ?? null}
            sessionId={state.activeId}
            onExport={exportActive}
          />
        ) : null}
        <Transcript messages={state.messages} status={state.status} bottomRef={bottomRef} />
        {/* 输入区（@ 文件段补全源经闭包注入——api.workspaceFiles 消费腿；
            prop 在场即启用弹层，失败由 Composer 静默收层不打扰通知条） */}
        <Composer
          onSubmit={submit}
          onInterrupt={interrupt}
          fetchFileCompletions={(query) => api.workspaceFiles(query)}
        />
      </main>
      {/* 右栏：审批 */}
      <ApprovalPanel approvals={state.approvals} onDecide={decide} />
      {/* 档位浮层（/thinking //sandbox 恰零参拦截开层——fixed 定位浮于输入区
          上方；onReceipt 走 info 档通知条、onError 走 error 档——NoticeBar
          四档色表 info 在册）；onClose 全路清 null */}
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
        />
      ) : null}
    </div>
  );
}
