/**
 * webui/client/components/TierPopover — 会话档位选择浮层（2026-09-18 webui
 * 档位面受理批——/thinking //sandbox 的 SPA 受路呈现面）。
 *
 * 编舞：挂载即 GET tiers 读行集（词表与行文案单源服务端——SPA 零硬编码，
 * danger 行警示语 07 §4.1 钉死措辞经行 detail 直显）；当前档 = 应答
 * thinkingLevel / sandboxMode（thinkingLevel 无锚 null = 零标记不虚标）；
 * 点击行 → PUT 切档 → onReceipt（回执文案与 TUI setStatus 同文单源）→
 * onClose。GET/PUT 失败：错误 message 透传 onError（NoticeBar 呈现——
 * 501 未装配 / 404 已闭 / 400 坏词 / 500 fold 坏词全折同呈现位），浮层
 * 不自动收仍可关。esc 与遮罩点击收层；v1 不求焦点陷阱（document 级
 * esc 监听——浮层卸载即解绑）。
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactElement } from 'react';

import { api, type TiersPayload } from '../api.js';

/** 浮层档族（两词面共享一件——行集与当前档按 kind 取应答对应半边） */
export type TierKind = 'thinking' | 'sandbox';

/** 档位浮层（App 拦截 /thinking //sandbox 恰零参后渲染——sessionId = 活跃会话） */
export function TierPopover({
  kind,
  sessionId,
  onClose,
  onReceipt,
  onError,
}: {
  readonly kind: TierKind;
  readonly sessionId: string;
  /** 收层回调（esc / 遮罩点击 / 选定成功 / 失败态关闭键——全路同归） */
  readonly onClose: () => void;
  /** 切档成功回执呈现回调（receipt 文案单源服务端拼装） */
  readonly onReceipt: (receipt: string) => void;
  /** 错误呈现回调（message 透传——501/404/500/400 同呈现位） */
  readonly onError: (message: string) => void;
}): ReactElement {
  /** 行集（null = 未就绪——加载/失败态分立呈现） */
  const [tiers, setTiers] = useState<TiersPayload | null>(null);
  /** 读档失败旗标（true = 失败行呈现——错误本体已透传 onError） */
  const [failed, setFailed] = useState(false);
  /** 在途 PUT 守卫（true = 行点击忽略——双击不重发） */
  const [submitting, setSubmitting] = useState(false);
  // 回调 ref 化：挂载读档 effect 只随 sessionId 重发，回调身份漂移（App
  // 内联箭头函数每渲染新造）不触发重拉。
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // 挂载即读档（GET tiers——alive 守卫防卸载后 setState；sessionId 随会话
  // 切换重发——浮层跨会话存活时行集随新会话刷新）
  useEffect(() => {
    let alive = true;
    setTiers(null);
    setFailed(false);
    api
      .getSessionTiers(sessionId)
      .then((payload) => {
        if (!alive) return;
        setTiers(payload);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        // 501（面未装配）/404（会话不在场或已闭）/500（fold 坏词）全折同
        // 呈现位：message 透传 onError（NoticeBar），浮层内只留失败行
        setFailed(true);
        onErrorRef.current(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // esc 收层（document 级监听——v1 不求焦点陷阱；卸载即解绑）
  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  /** 行集归一（两族词面 level/mode 折 {value, detail} 呈现形）与当前档锚 */
  const rows =
    tiers === null
      ? []
      : kind === 'thinking'
        ? tiers.thinkingLevels.map((row) => ({ value: row.level, detail: row.detail }))
        : tiers.sandboxModes.map((row) => ({ value: row.mode, detail: row.detail }));
  // 当前档标记锚：thinking 用 thinkingLevel（null = 零标记不虚标）、sandbox
  // 用 sandboxMode（恒有锚）
  const current = tiers === null ? null : kind === 'thinking' ? tiers.thinkingLevel : tiers.sandboxMode;

  /** 选定行 → PUT 切档 → receipt 呈现 + 收层；失败透传 onError 留层可重选 */
  const pick = (value: string): void => {
    if (submitting) return; // 在途守卫——PUT 不重发
    setSubmitting(true);
    const pending = kind === 'thinking' ? api.setThinkingLevel(sessionId, value) : api.setSandboxMode(sessionId, value);
    pending
      .then(({ receipt }) => {
        onReceipt(receipt);
        onClose(); // 选定先收层（theme-picker「选定先收副屏再回调」同律）
      })
      .catch((err: unknown) => {
        // 坏词 400 / 已闭 404 / 未装配 501——message 透传 onError 呈现；
        // 浮层不自动收（可重选可关），守卫复位
        setSubmitting(false);
        onErrorRef.current(err instanceof Error ? err.message : String(err));
      });
  };

  return (
    // 全屏遮罩锚（fixed）——点击遮罩即关；卡体停在输入区上方（bottom 锚，
    // 体例随 Composer 补全弹层自洽——同 zinc 色系浮层语汇）
    <div className="fixed inset-0 z-20">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label={kind === 'thinking' ? 'thinking 档位' : 'sandbox 档位'}
        className="absolute bottom-32 left-1/2 z-30 w-[28rem] -translate-x-1/2 rounded border border-zinc-700 bg-zinc-900 shadow-lg"
      >
        <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
          <span className="text-xs font-semibold text-zinc-400">
            {kind === 'thinking' ? 'thinking 档位' : 'sandbox 档位'}
          </span>
          <button
            type="button"
            aria-label="关闭档位浮层"
            className="rounded px-1.5 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {tiers === null && !failed ? (
          // 加载态一行（回环毫秒级——通常瞬过）
          <p className="px-3 py-3 text-xs text-zinc-500">档位读取中……</p>
        ) : null}
        {failed ? (
          // 失败态一行错误 + 关闭键（501/404/500 全折同呈现位——错误本体
          // 已透传 NoticeBar，此处只留可关的失败行）
          <div className="flex items-center justify-between gap-2 px-3 py-3">
            <p className="text-xs text-red-300">档位读取失败</p>
            <button
              type="button"
              className="shrink-0 rounded border border-zinc-700 px-2 py-0.5 text-[11px] text-zinc-400 hover:bg-zinc-800"
              onClick={onClose}
            >
              关闭
            </button>
          </div>
        ) : null}
        {tiers !== null ? (
          <ul className="max-h-72 overflow-y-auto py-1">
            {rows.map((row) => {
              const marked = row.value === current; // null 恒不等——无锚零标记
              return (
                <li key={row.value}>
                  <button
                    type="button"
                    disabled={submitting}
                    className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-xs hover:bg-zinc-800 disabled:opacity-40"
                    onClick={() => {
                      pick(row.value);
                    }}
                  >
                    {/* 当前档标记位（●——TUI picker 同形；宽占位对齐） */}
                    <span className="w-3 shrink-0 text-zinc-200">{marked ? '●' : ''}</span>
                    <span className="shrink-0 text-zinc-200">{row.value}</span>
                    <span className="ml-auto truncate text-zinc-500">{row.detail}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
