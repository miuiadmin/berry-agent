/**
 * webui/client/components/SessionHeader — 会话详情头行（TUI 余量收官
 * 批②随批——SPA /export 客户端腿）。
 *
 * 纯呈现件：标题与导出入口由 App 注入；无标题会话诚实回退 id 截断呈现
 * （不造占位串——与服务端 title: null 语义对齐，截断律同 SessionList）。
 * 「导出」= 本会话 markdown 下载触发位（下载编舞在 App——本件零 IO）。
 */
import type { ReactElement } from 'react';

/** 会话详情头行（onExport 导出回调——编舞/错误呈现归 App） */
export function SessionHeader({
  title,
  sessionId,
  onExport,
}: {
  title: string | null;
  sessionId: string;
  onExport: () => void;
}): ReactElement {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-zinc-800 bg-zinc-950 px-4 py-2">
      <span className="min-w-0 truncate text-xs text-zinc-500" title={title ?? sessionId}>
        {title ?? `${sessionId.slice(0, 12)}…`}
      </span>
      <button
        type="button"
        className="shrink-0 rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-300 hover:bg-zinc-700"
        onClick={onExport}
      >
        导出
      </button>
    </div>
  );
}
