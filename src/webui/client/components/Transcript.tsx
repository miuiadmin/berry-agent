/**
 * webui/client/components/Transcript — 正文列（批 18a-2）。
 *
 * 流式尾巴（streaming 位）与落稿同列呈现；assistant 文字走 react-markdown
 * 渲染（对话与编码即本体——助手产出以 Markdown 为主形，排版刻度住 app.css
 * 的 .md-body 手写 prose 族——零 typography 插件依赖）；其余角色纯文本。
 * run 收尾行（run_close 角色）居中弱化呈现（瞬时追加位——非消息形）。
 * 压缩摘要载体（source='compaction' 的 user 消息）正文零呈现——替换为
 * 居中弱化分隔行（B2 webui 对端迁移；词面/N 解析 contracts 单源）。
 * 状态行钉在列底（活体工具执行指示——呼吸点动画呈「运行中」活体感）。
 */
import { memo, useState } from 'react';
import type { ReactElement, RefObject } from 'react';
import ReactMarkdown from 'react-markdown';

import { attachmentUrl } from '../api.js';
import { RUN_CLOSE_ROLE, type ViewAttachment, type ViewMessage } from '../frames.js';
// 跨通道单源件（contracts 零依赖叶——frames 同批体例）：压缩分隔行词面
// compactionSeparatorLine + 载体末条 CCR 条目提取 lastCcrEntryOf（N 供数）——
// 与 TUI 分隔块渲染位同源（07 B2 定形注 webui 对端迁移）
import { compactionSeparatorLine, lastCcrEntryOf } from '../../../contracts/index.js';

/** 角色标签色（user/assistant 语义分色——其余角色统一弱文档；role token 浮底可读性——03 §10.4 批注④升档，浅档覆写可辨） */
const ROLE_LABEL_CLASS: Record<string, string> = {
  user: 'text-role-user/80',
  assistant: 'text-role-assistant/80',
};

/**
 * 单枚附件图（剪贴板附件批——03 §10.4 批注⑥）：src 经 attachmentUrl 铸
 * `/api/attachments/<ref>`（ref 形 sha256:<hex>，路径段直拼——冒号是合法
 * 路径字符不编码）；加载失败（附件库文件缺席/网络断）降「[图片已不可用]」
 * 占位框——诚实降级不留破图符（与服务端再水化占位词面同族）。
 */
function AttachmentImage({
  attachment,
  index,
}: {
  readonly attachment: ViewAttachment;
  readonly index: number;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="flex items-center justify-center rounded border border-edge-strong px-3 py-2 text-xs text-ink-mute">
        [图片已不可用]
      </p>
    );
  }
  return (
    <img
      src={attachmentUrl(attachment.ref)}
      alt={`第 ${index + 1} 张图片`}
      className="max-h-64 max-w-full rounded border border-edge-strong"
      onError={() => setFailed(true)}
    />
  );
}

/** 单条消息（assistant → Markdown / 其余 → 纯文本；流式尾巴呼吸态样式） */
const MessageView = memo(function MessageView({ message }: { message: ViewMessage }): ReactElement {
  // run 收尾行：居中弱化的分隔线形（瞬时追加位——无角色标签、无 markdown、
  // 无缩进让位，整行即内容）
  if (message.role === RUN_CLOSE_ROLE) {
    return <p className="whitespace-pre-wrap text-center text-2xs text-ink-faint">{message.text}</p>;
  }
  // 压缩摘要载体（source='compaction' 的 user 消息——B2 webui 对端迁移）：
  // 载体本体（可能是数千字摘要）零 user 块直呈，落一行居中弱化分隔线
  // （run_close 同呈现形——分隔行是压缩事实唯一用户面正文位）；N 解析自
  // CCR 标记段末行（contracts 单源——与 TUI 分隔块同判据同词面），CCR 批前
  // 历史载体无标记段降级无 N 形
  if (message.role === 'user' && message.source === 'compaction') {
    return (
      <p className="whitespace-pre-wrap text-center text-2xs text-ink-faint">
        {compactionSeparatorLine(lastCcrEntryOf(message.text)?.messages)}
      </p>
    );
  }
  const isAssistant = message.role === 'assistant';
  const body = isAssistant ? (
    // .md-body：手写 prose 刻度（app.css——标题梯度/列表/代码块/表格全族），
    // 替换历史无效死类 prose-invert（typography 插件未装基类缺席）
    <div className="md-body max-w-none">
      <ReactMarkdown>{message.text}</ReactMarkdown>
    </div>
  ) : (
    <p className="whitespace-pre-wrap text-body leading-6 text-ink-soft">{message.text}</p>
  );
  return (
    <div className={message.role === 'user' ? 'ml-16' : 'mr-16'}>
      <div className={`mb-0.5 text-2xs uppercase tracking-wide ${ROLE_LABEL_CLASS[message.role] ?? 'text-ink-mute'}`}>
        {message.role}
      </div>
      {body}
      {/* 附件图列（剪贴板附件批——03 §10.4 批注⑥：image-ref 块每块一枚 img、
          图序保留；与正文并列呈现——附件栏形无文内占位符） */}
      {message.images !== undefined && message.images.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-2">
          {message.images.map((attachment, index) => (
            <AttachmentImage key={`${index}:${attachment.ref}`} attachment={attachment} index={index} />
          ))}
        </div>
      ) : null}
      {/* 错误块（03 §10.4 SPA 呈现面终态条款①——✗ 前缀 + danger 语义 token（浮底可读性——03 §10.4 批注④升档），与 TUI 错误块同律；注⑩：✖ 形全域退役跨通道） */}
      {message.error !== undefined ? (
        <p className="whitespace-pre-wrap text-body leading-6 text-danger">✗ {message.error}</p>
      ) : null}
      {message.streaming ? <span className="animate-pulse text-ink-mute">▍</span> : null}
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
      {/* px-4 基档 + sm 起回 6（窄屏省边距——响应式主列腿） */}
      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
        {messages.map((message) => (
          <MessageView key={message.key} message={message} />
        ))}
        {messages.length === 0 ? <p className="text-xs text-ink-faint">（暂无消息——发送第一条）</p> : null}
        <div ref={bottomRef} />
      </div>
      {status !== null ? (
        /* 状态行：呼吸点 + 文案（运行中活体感——animate-pulse 光学呼吸替代静默文本） */
        <div className="flex items-center gap-1.5 border-t border-edge px-4 py-1 text-xs text-ink-mute sm:px-6">
          <span aria-hidden className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          <span>{status}</span>
        </div>
      ) : null}
    </div>
  );
}
