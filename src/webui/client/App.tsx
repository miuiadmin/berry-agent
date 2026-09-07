/**
 * webui/client/App — SPA 壳根组件（批 18a-2）。
 *
 * 编舞三段：①鉴权探针（cookie 已桥直进 / 未桥走 AuthGate 换桥——auth
 * cookie 桥是浏览器侧唯一凭证通道）②会话清单装载与切换 ③活体流接线
 * （EventSource per 会话——onopen 恒重拉投影 + approvals 清单复拉）。
 *
 * 语义全在 frames.ts（纯折叠器）；本件只做接线与呈现。StrictMode 双挂载
 * 下 effect 先后启停——EventSource cleanup 对称关流，无泄漏双流。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { api } from './api.js';
import {
  appliedDecide,
  applyAsked,
  applyEnvelope,
  initialAppState,
  loadedMessages,
  loadedSessions,
  loadedTodo,
  setActiveSession,
  type AppState,
} from './frames.js';
import { ApprovalPanel } from './components/ApprovalPanel.js';
import { AuthGate } from './components/AuthGate.js';
import { Composer } from './components/Composer.js';
import { NoticeBar } from './components/NoticeBar.js';
import { SessionList } from './components/SessionList.js';
import { TodoPanel } from './components/TodoPanel.js';
import { Transcript } from './components/Transcript.js';
import type { ClientEnvelope } from './protocol.js';

/** 根组件（main.tsx 挂载位——auth 探针门 + 主面二段） */
export function App(): ReactElement {
  // null = 探针在飞；true = 已桥直进；false = 走换桥
  const [authed, setAuthed] = useState<boolean | null>(null);
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

  if (authed === null) {
    return <div className="p-4 text-sm text-zinc-500">连接中……</div>;
  }
  if (!authed) {
    return <AuthGate onAuthed={() => setAuthed(true)} />;
  }
  return <Main />;
}

/** 主面（会话清单 + 正文 + 审批/todo/通知侧栏 + 输入） */
function Main(): ReactElement {
  const [state, setState] = useState<AppState>(initialAppState);
  /** 重拉投影腿（onopen 与会话切换共用——正确性层恒重拉） */
  const reloadProjection = useCallback((sessionId: string) => {
    void api.fetchMessages(sessionId).then((messages) => {
      setState((prev) => (prev.activeId === sessionId ? loadedMessages(prev, messages) : prev));
    });
    void api.todo(sessionId).then((items) => {
      setState((prev) => (prev.activeId === sessionId ? loadedTodo(prev, items) : prev));
    });
    void api.listApprovals().then((list) => {
      setState((prev) => {
        let next = prev;
        for (const entry of list) next = applyAsked(next, entry);
        return next;
      });
    });
  }, []);

  // 会话清单装载（首载 + 手动刷新共用）
  const loadSessions = useCallback(() => {
    void api.listSessions().then((sessions) => {
      setState((prev) => {
        const withSessions = loadedSessions(prev, sessions);
        // 首载且无选中——自动选首会话（无会话则保持 null，SessionList 引导开新）
        if (prev.activeId === null && sessions.length > 0) return setActiveSession(withSessions, sessions[0]!.id);
        return withSessions;
      });
    });
  }, []);
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
  }, [state.activeId, reloadProjection]);

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

  /** 提交（乐观回显 + 失败撤回——messageId = crypto.randomUUID 幂等位） */
  const submit = useCallback(
    (text: string) => {
      const sessionId = state.activeId;
      if (sessionId === null) return;
      const messageId = crypto.randomUUID();
      setState((prev) =>
        applyEnvelope(prev, {
          kind: 'session',
          sessionId,
          payload: { type: 'message_end', message: { role: 'user', content: text, timestamp: Date.now() } },
        }),
      );
      void api.submit(sessionId, text, messageId).catch(() => {
        setState((prev) => ({
          ...prev,
          notices: [...prev.notices, { id: prev.seq + 1, message: '提交失败——请重试', level: 'error' }],
          seq: prev.seq + 1,
        }));
      });
    },
    [state.activeId],
  );

  /** 打断在飞 run */
  const interrupt = useCallback(() => {
    if (state.activeId !== null) void api.interrupt(state.activeId).catch(() => {});
  }, [state.activeId]);

  /** 审批应答（applied/superseded 同出清——异口已答同语义；失败回拉清单自愈） */
  const decide = useCallback(
    (approvalId: string, answer: 'approve' | 'reject' | 'cancel') => {
      setState((prev) => appliedDecide(prev, approvalId));
      void api.decide(approvalId, answer).catch(() => {
        if (state.activeId !== null) reloadProjection(state.activeId);
      });
    },
    [state.activeId, reloadProjection],
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
      {/* 主列：通知条 + 正文 + 状态行 + 输入 */}
      <main className="flex min-w-0 flex-1 flex-col bg-zinc-900">
        <NoticeBar notices={state.notices} />
        <Transcript messages={state.messages} status={state.status} bottomRef={bottomRef} />
        <Composer onSubmit={submit} onInterrupt={interrupt} />
      </main>
      {/* 右栏：审批 */}
      <ApprovalPanel approvals={state.approvals} onDecide={decide} />
    </div>
  );
}
