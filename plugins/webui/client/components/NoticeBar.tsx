/**
 * webui/client/components/NoticeBar — 通知浮条（批 18a-2；界面美化役批⑨重定位）。
 *
 * notify 族帧的呈现位（一次性通知——非阻塞原语不占正文流）：fixed 顶中
 * 浮层形（修前在流内——通知到达推挤整版布局）；档色映射 info/success/
 * warn/error 四档，最近一条呈现（帧折叠器已限最近 5 条）；onDismiss 在场
 * 即呈关闭键（App 接 dismissNotice 出清——通知寿命归用户裁量）。
 */
import type { ReactElement } from 'react';

import type { ViewNotice } from '../frames.js';

/** 档色映射（level 缺席 = info 档；四档色保持原值——语义色不走灰阶 token） */
const LEVEL_CLASSES: Readonly<Record<string, string>> = {
  info: 'bg-sky-900/60 text-sky-200',
  success: 'bg-emerald-900/60 text-emerald-200',
  warn: 'bg-amber-900/60 text-amber-200',
  error: 'bg-red-900/60 text-red-200',
};

/** 通知浮条（空态零占位——不渲染任何行） */
export function NoticeBar({
  notices,
  onDismiss,
}: {
  notices: readonly ViewNotice[];
  /** 关闭回调（在场即呈 × 键——按条目 id 出清；缺席不呈关闭键） */
  onDismiss?: (id: number) => void;
}): ReactElement | null {
  if (notices.length === 0) return null;
  const latest = notices[notices.length - 1]!;
  return (
    /* fixed 顶中浮层：不占布局流（通知到达不再推挤正文/头行）；max-w 双帽
     * （48rem 内容帽与视口减 2rem——窄屏不溢出）+ 投影分层（浮于内容上） */
    <div
      className={`fixed left-1/2 top-3 z-40 flex max-w-[min(48rem,calc(100vw-2rem))] -translate-x-1/2 items-start gap-2 rounded-lg border border-edge-strong px-3 py-1.5 text-xs shadow-lg ${
        LEVEL_CLASSES[latest.level ?? 'info'] ?? LEVEL_CLASSES.info
      }`}
    >
      <span className="min-w-0 break-words">
        {latest.message}
        {notices.length > 1 ? <span className="ml-1 opacity-70">（+{notices.length - 1} 条早前通知）</span> : null}
      </span>
      {onDismiss !== undefined ? (
        <button
          type="button"
          aria-label="关闭通知"
          className="shrink-0 rounded px-1 leading-none opacity-70 hover:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/60"
          onClick={() => {
            onDismiss(latest.id);
          }}
        >
          ×
        </button>
      ) : null}
    </div>
  );
}
