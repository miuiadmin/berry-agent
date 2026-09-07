/**
 * webui/client/components/Transcript — 正文列（批 18a-2）。
 *
 * 流式尾巴（streaming 位）与落稿同列呈现；assistant 文字走 react-markdown
 * 渲染（对话与编码即本体——助手产出以 Markdown 为主形）；其余角色纯文本。
 * 状态行钉在列底（活体工具执行指示）。
 */
import { memo } from 'react';
import type { ReactElement, RefObject } from 'react';
import ReactMarkdown from 'react-markdown';

import type { ViewMessage } from '../frames.js';

/** 单条消息（assistant → Markdown / 其余 → 纯文本；流式尾巴呼吸态样式） */
const MessageView = memo(function MessageView({ message }: { message: ViewMessage }): ReactElement {
  const isAssistant = message.role === 'assistant';
  const body = isAssistant ? (
    <div className="prose-invert max-w-none text-[13px] leading-6 text-zinc-200 [&_code]:rounded [&_code]:bg-zinc-800 [&_code]:px-1 [&_pre]:rounded [&_pre]:bg-zinc-950 [&_pre]:p-2">
      <ReactMarkdown>{message.text}</ReactMarkdown>
    </div>
  ) : (
    <p className="whitespace-pre-wrap text-[13px] leading-6 text-zinc-300">{message.text}</p>
  );
  return (
    <div className={message.role === 'user' ? 'ml-16' : 'mr-16'}>
      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-zinc-600">{message.role}</div>
      {body}
      {message.streaming ? <span className="animate-pulse text-zinc-500">▍</span> : null}
    </div>
  );
});

/** 正文列（messages + 状态行 + 贴底锚） */
export function Transcript({
  messages,
  status,
  bottomRef,
}: {
  messages: readonly ViewMessage[];
  status: string | null;
  bottomRef: RefObject<HTMLDivElement | null>;
}): ReactElement {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {messages.map((message) => (
          <MessageView key={message.key} message={message} />
        ))}
        {messages.length === 0 ? <p className="text-xs text-zinc-600">（暂无消息——发送第一条）</p> : null}
        <div ref={bottomRef} />
      </div>
      {status !== null ? (
        <div className="border-t border-zinc-800 px-6 py-1 text-xs text-zinc-500">{status}</div>
      ) : null}
    </div>
  );
}
