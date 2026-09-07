/**
 * webui/client/components/NoticeBar — 通知条（批 18a-2）。
 *
 * notify 族帧的呈现位（一次性通知——非阻塞原语不占正文流）；档色映射
 * info/success/warn/error 四档，最近一条置顶呈现（帧折叠器已限最近 5 条）。
 */
import type { ReactElement } from 'react';

import type { ViewNotice } from '../frames.js';

/** 档色映射（level 缺席 = info 档） */
const LEVEL_CLASSES: Readonly<Record<string, string>> = {
  info: 'bg-sky-900/60 text-sky-200',
  success: 'bg-emerald-900/60 text-emerald-200',
  warn: 'bg-amber-900/60 text-amber-200',
  error: 'bg-red-900/60 text-red-200',
};

/** 通知条（空态零占位——不渲染任何行） */
export function NoticeBar({ notices }: { notices: readonly ViewNotice[] }): ReactElement | null {
  if (notices.length === 0) return null;
  const latest = notices[notices.length - 1]!;
  return (
    <div className={`px-4 py-1 text-xs ${LEVEL_CLASSES[latest.level ?? 'info'] ?? LEVEL_CLASSES.info}`}>
      {latest.message}
      {notices.length > 1 ? <span className="ml-2 opacity-60">（+{notices.length - 1} 条早前通知）</span> : null}
    </div>
  );
}
