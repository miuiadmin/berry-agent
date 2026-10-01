/**
 * webui/client/components/SessionList — 会话清单（批 18a-2）。
 *
 * 纯呈现件：清单与选中态由 App 注入；无标题会话诚实回退 id 截断呈现
 * （不造占位串——与服务端 title: null 语义对齐）。装载失败与真空态分立
 * （失败旗空态呈现失败行——拉不到清单不假声明「暂无会话」）。
 */
import type { ReactElement } from 'react';

import type { ClientSessionSummary } from '../protocol.js';

/** 清单呈现（无会话空态引导开新——开新按钮在侧栏头；装载失败空态呈失败行） */
export function SessionList({
  sessions,
  activeId,
  onSelect,
  loadFailed = false,
  totalCount,
}: {
  sessions: readonly ClientSessionSummary[];
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  /** 装载失败旗（true 且清单空 = 失败行——与真空态分立） */
  readonly loadFailed?: boolean;
  /** 会话全量总数（B2 截断披露——超清单长时清单上方注记，与 TUI session-picker 头行同文案同判据） */
  readonly totalCount?: number;
}): ReactElement {
  if (sessions.length === 0) {
    if (loadFailed) {
      return <p className="p-3 text-xs text-red-400">会话清单加载失败——点上方「刷新」重试</p>;
    }
    return <p className="p-3 text-xs text-zinc-600">暂无会话——点「+ 新会话」开一个</p>;
  }
  return (
    <>
      {/* 超窗截断披露：总数超清单长才注记（N/M 会话（仅显示最近）——清单默认
          最近 100 窗，超窗不注记即「所见即全量」的静默谎；total ≤ 清单长 =
          全量已呈现，注记即噪音） */}
      {totalCount !== undefined && totalCount > sessions.length ? (
        <p className="px-3 pb-1 pt-2 text-[11px] text-zinc-600">
          {sessions.length}/{totalCount} 会话（仅显示最近）
        </p>
      ) : null}
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
    </>
  );
}
