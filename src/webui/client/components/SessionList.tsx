/**
 * webui/client/components/SessionList — 会话清单（批 18a-2）。
 *
 * 纯呈现件：清单与选中态由 App 注入；无标题会话诚实回退 id 截断呈现
 * （不造占位串——与服务端 title: null 语义对齐）。装载失败与真空态分立
 * （失败旗空态呈现失败行——拉不到清单不假声明「暂无会话」）。
 * 交互态（界面美化役批⑤）：悬停底亮化（edge/60——原 hover 与底色同为 950
 * 档零对比）；选中态 = 左侧 accent 指示条 + 亮底 + 主亮文字（三信号同呈）。
 * 删除键注入位（2026-10-07 会话删除编排批）：onDelete 在场逐行悬停显影
 * 删除键（缺席零键诚实）；键与选择键为兄弟节点（button 不可嵌 button——
 * 非法 HTML），行点击透传由 stopPropagation 结构性防御。确认编舞与 IO
 * 全归 App——本件零 IO 零编舞。
 */
import type { ReactElement } from 'react';

import type { ClientSessionSummary } from '../protocol.js';

/** 清单呈现（无会话空态引导开新——开新按钮在侧栏头；装载失败空态呈失败行） */
export function SessionList({
  sessions,
  activeId,
  onSelect,
  onDelete,
  loadFailed = false,
  totalCount,
}: {
  sessions: readonly ClientSessionSummary[];
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  /** 行内删除回调（注入在场才呈删除键——缺席零键；确认编舞在 App） */
  onDelete?: (sessionId: string) => void;
  /** 装载失败旗（true 且清单空 = 失败行——与真空态分立） */
  readonly loadFailed?: boolean;
  /** 会话全量总数（B2 截断披露——超清单长时清单上方注记，与 TUI session-picker 头行同文案同判据） */
  readonly totalCount?: number;
}): ReactElement {
  if (sessions.length === 0) {
    if (loadFailed) {
      return <p className="p-3 text-xs text-red-400">会话清单加载失败——点上方「刷新」重试</p>;
    }
    return <p className="p-3 text-xs text-ink-faint">暂无会话——点「+ 新会话」开一个</p>;
  }
  return (
    <>
      {/* 超窗截断披露：总数超清单长才注记（N/M 会话（仅显示最近）——清单默认
          最近 100 窗，超窗不注记即「所见即全量」的静默谎；total ≤ 清单长 =
          全量已呈现，注记即噪音） */}
      {totalCount !== undefined && totalCount > sessions.length ? (
        <p className="px-3 pb-1 pt-2 text-2xs text-ink-faint">
          {sessions.length}/{totalCount} 会话（仅显示最近）
        </p>
      ) : null}
      <ul className="flex-1 overflow-y-auto py-1">
        {sessions.map((session) => (
          // 行骨架 group flex：选择键 flex-1 占满 + 删除键 shrink-0 兄弟并置
          //（button 不可嵌 button——兄弟结构合法 HTML；悬停显影由 group 驱动）
          <li key={session.id} className="group flex items-center">
            <button
              type="button"
              /* 选中态 = 左 accent 指示条（border-l 常占位不抖版）+ 亮底 + 主亮文字；
               * 悬停态 = edge/60 半透明底（深底上可见的对比升级）；
               * w-full→min-w-0 flex-1：与兄弟删除键并置时仍占满余宽（截断律不变） */
              className={`min-w-0 flex-1 truncate border-l-2 py-1.5 pl-2.5 text-left text-xs ${
                session.id === activeId
                  ? 'border-l-accent bg-edge text-ink-bright'
                  : 'border-l-transparent text-ink-soft hover:bg-edge/60'
              }`}
              title={session.title ?? session.id}
              onClick={() => {
                onSelect(session.id);
              }}
            >
              {session.title ?? `${session.id.slice(0, 12)}…`}
            </button>
            {/* 删除键（注入在场才呈）：悬停/聚焦显影（opacity-0→group-hover）；
                stopPropagation = 结构性防御——兄弟结构下点击本不冒泡到选择键，
                显式阻断双保险（选择键零误触）；回传行 id，编舞（确认/IO）归 App */}
            {onDelete !== undefined ? (
              <button
                type="button"
                aria-label="删除会话"
                className="mr-1.5 shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-faint opacity-0 transition-opacity hover:bg-edge-strong hover:text-red-300 focus-visible:opacity-100 group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(session.id);
                }}
              >
                ✕
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
