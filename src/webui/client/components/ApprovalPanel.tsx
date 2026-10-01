/**
 * webui/client/components/ApprovalPanel — 审批右栏（批 18a-2）。
 *
 * 跨入口审批的浏览器呈现位：asked 镜像清单 + 三键应答（通过/拒绝/取消
 * = ApprovalAskAnswer 三频值；always 留 CLI 形——SPA 面不呈现自动化键）。
 * 应答后本地出清（applied/superseded 同语义）。
 *
 * 响应式（界面美化役批③）：xl 起常驻右栏（hidden xl:flex）——窄屏缺席化
 * （批④：App 侧零待审批时整栏不渲染，本件内空态分支保留供直测）。
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
    <aside className="hidden w-72 shrink-0 flex-col border-l border-edge bg-canvas xl:flex">
      <div className="border-b border-edge px-3 py-2 text-xs font-semibold text-ink-soft">
        审批{approvals.length > 0 ? `（${approvals.length}）` : ''}
      </div>
      {approvals.length === 0 ? (
        <p className="p-3 text-xs text-ink-faint">暂无待审批项</p>
      ) : (
        <ul className="flex-1 space-y-2 overflow-y-auto p-2">
          {approvals.map((entry) => (
            /* 审批卡：rounded-lg 浮层卡档（界面美化役批⑧——卡面圆角层级统一） */
            <li key={entry.approvalId} className="rounded-lg border border-edge bg-panel p-2">
              <p className="text-xs text-ink">{entry.summary}</p>
              {entry.reason !== undefined ? <p className="mt-1 text-2xs text-ink-mute">{entry.reason}</p> : null}
              {entry.toolName !== undefined ? (
                <p className="mt-1 text-2xs text-ink-faint">工具：{entry.toolName}</p>
              ) : null}
              <div className="mt-2 flex gap-1.5">
                <button
                  type="button"
                  className="rounded bg-emerald-700/80 px-2 py-1 text-2xs text-white hover:bg-emerald-600 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                  onClick={() => {
                    onDecide(entry.approvalId, 'approve');
                  }}
                >
                  通过
                </button>
                <button
                  type="button"
                  className="rounded bg-red-800/80 px-2 py-1 text-2xs text-white hover:bg-red-700 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
                  onClick={() => {
                    onDecide(entry.approvalId, 'reject');
                  }}
                >
                  拒绝
                </button>
                <button
                  type="button"
                  className="rounded border border-edge-strong px-2 py-1 text-2xs text-ink-soft hover:bg-edge focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/60"
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
