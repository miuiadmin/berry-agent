/**
 * webui/client/components/ApprovalPanel — 审批右栏（批 18a-2）。
 *
 * 跨入口审批的浏览器呈现位：asked 镜像清单 + 三键应答（通过/拒绝/取消
 * = ApprovalAskAnswer 三频值；always 留 CLI 形——SPA 面不呈现自动化键）。
 * 应答后本地出清（applied/superseded 同语义）。
 */
import type { ReactElement } from 'react';

import type { ClientApprovalEntry } from '../protocol.js';

/** 审批栏（onDecide = 应答回调） */
export function ApprovalPanel({
  approvals,
  onDecide,
}: {
  approvals: readonly ClientApprovalEntry[];
  onDecide: (approvalId: string, answer: 'approve' | 'reject' | 'cancel') => void;
}): ReactElement {
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="border-b border-zinc-800 px-3 py-2 text-xs font-semibold text-zinc-400">
        审批{approvals.length > 0 ? `（${approvals.length}）` : ''}
      </div>
      {approvals.length === 0 ? (
        <p className="p-3 text-xs text-zinc-600">暂无待审批项</p>
      ) : (
        <ul className="flex-1 space-y-2 overflow-y-auto p-2">
          {approvals.map((entry) => (
            <li key={entry.approvalId} className="rounded border border-zinc-800 bg-zinc-900 p-2">
              <p className="text-xs text-zinc-200">{entry.summary}</p>
              {entry.reason !== undefined ? <p className="mt-1 text-[11px] text-zinc-500">{entry.reason}</p> : null}
              {entry.toolName !== undefined ? (
                <p className="mt-1 text-[11px] text-zinc-600">工具：{entry.toolName}</p>
              ) : null}
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  className="rounded bg-emerald-700/80 px-2 py-1 text-[11px] text-white hover:bg-emerald-600"
                  onClick={() => {
                    onDecide(entry.approvalId, 'approve');
                  }}
                >
                  通过
                </button>
                <button
                  type="button"
                  className="rounded bg-red-800/80 px-2 py-1 text-[11px] text-white hover:bg-red-700"
                  onClick={() => {
                    onDecide(entry.approvalId, 'reject');
                  }}
                >
                  拒绝
                </button>
                <button
                  type="button"
                  className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800"
                  onClick={() => {
                    onDecide(entry.approvalId, 'cancel');
                  }}
                >
                  取消
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
