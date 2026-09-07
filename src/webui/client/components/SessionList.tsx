/**
 * webui/client/components/SessionList — 会话清单（批 18a-2）。
 *
 * 纯呈现件：清单与选中态由 App 注入；无标题会话诚实回退 id 截断呈现
 * （不造占位串——与服务端 title: null 语义对齐）。
 */
import type { ReactElement } from 'react';

import type { ClientSessionSummary } from '../protocol.js';

/** 清单呈现（无会话空态引导开新——开新按钮在侧栏头） */
export function SessionList({
  sessions,
  activeId,
  onSelect,
}: {
  sessions: readonly ClientSessionSummary[];
  activeId: string | null;
  onSelect: (sessionId: string) => void;
}): ReactElement {
  if (sessions.length === 0) {
    return <p className="p-3 text-xs text-zinc-600">暂无会话——点「+ 新会话」开一个</p>;
  }
  return (
    <ul className="flex-1 overflow-y-auto py-1">
      {sessions.map((session) => (
        <li key={session.id}>
          <button
            type="button"
            className={`w-full truncate px-3 py-1.5 text-left text-xs ${
              session.id === activeId ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:bg-zinc-900'
            }`}
            title={session.title ?? session.id}
            onClick={() => {
              onSelect(session.id);
            }}
          >
            {session.title ?? `${session.id.slice(0, 12)}…`}
          </button>
        </li>
      ))}
    </ul>
  );
}
