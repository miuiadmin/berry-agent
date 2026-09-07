/**
 * webui/client/components/Composer — 输入区（批 18a-2）。
 *
 * 提交（Enter 发送 / Shift+Enter 换行）与打断两键；提交通路幂等位由
 * App 生成（crypto.randomUUID）——本件零状态外触。
 */
import { useState } from 'react';
import type { ReactElement } from 'react';

/** 输入区（onSubmit 提交正文 / onInterrupt 打断在飞 run） */
export function Composer({
  onSubmit,
  onInterrupt,
}: {
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
}): ReactElement {
  const [text, setText] = useState('');

  const send = (): void => {
    const trimmed = text.trim();
    if (trimmed === '') return;
    onSubmit(trimmed);
    setText('');
  };

  return (
    <div className="flex items-end gap-2 border-t border-zinc-800 bg-zinc-950 px-4 py-3">
      <textarea
        className="max-h-40 min-h-[2.5rem] flex-1 resize-y rounded border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 outline-none focus:border-zinc-500"
        placeholder="输入消息——Enter 发送，Shift+Enter 换行"
        rows={2}
        value={text}
        onChange={(ev) => {
          setText(ev.target.value);
        }}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' && !ev.shiftKey) {
            ev.preventDefault();
            send();
          }
        }}
      />
      <button
        type="button"
        className="rounded bg-zinc-200 px-3 py-2 text-xs font-medium text-zinc-900 hover:bg-white disabled:opacity-40"
        disabled={text.trim() === ''}
        onClick={send}
      >
        发送
      </button>
      <button
        type="button"
        className="rounded border border-zinc-700 px-3 py-2 text-xs text-zinc-400 hover:bg-zinc-800"
        onClick={onInterrupt}
      >
        打断
      </button>
    </div>
  );
}
