/**
 * webui/client/components/AuthGate — 换桥位（批 18a-2）。
 *
 * auth cookie 桥的浏览器半边：一次性 token 输入 → POST /api/auth 换
 * HttpOnly cookie（此后 fetch/EventSource 同源自动携行——凭证态零 JS
 * 可触面，XSS 读不走 cookie）。失败错因分档呈现（401/403 = token 不符；
 * 其余 = 服务异常）可重试。
 */
import { useState } from 'react';
import type { ReactElement } from 'react';

import { api, ApiError } from '../api.js';

/** 换桥面板（onAuthed = 桥成回调） */
export function AuthGate({ onAuthed }: { onAuthed: () => void }): ReactElement {
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = (): void => {
    if (token === '' || busy) return;
    setBusy(true);
    setError(null);
    api
      .auth(token)
      .then(() => {
        onAuthed();
      })
      .catch((err: unknown) => {
        // 错误分档：401/403 = token 确实不符（401 = 服务端判词〔server.ts
        // verifyToken 不符即 401〕；403 归拒族防御收编）；其余（网络断/5xx/
        // 代理错）折服务异常话术——错误身份不吞（一律折叠「token 不符」会
        // 误导用户反复核对一个本就正确的 token）
        const denied = err instanceof ApiError && (err.status === 401 || err.status === 403);
        setError(denied ? 'token 不符——请核对后重试' : '服务暂不可达或内部异常——请检查网络后重试');
        setBusy(false);
      });
  };

  return (
    <div className="flex h-screen items-center justify-center bg-zinc-900">
      <div className="w-80 rounded-lg border border-zinc-800 bg-zinc-950 p-5">
        <h1 className="mb-1 text-base font-semibold text-zinc-200">berry-agent Web 界面</h1>
        <p className="mb-4 text-xs text-zinc-500">
          输入启动时终端披露的一次性 token 换取会话凭证（cookie 仅存本机回环）。
        </p>
        <input
          type="password"
          className="mb-3 w-full rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-200 outline-none focus:border-zinc-500"
          placeholder="一次性 token"
          value={token}
          onChange={(ev) => {
            setToken(ev.target.value);
          }}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') submit();
          }}
        />
        {error !== null ? <p className="mb-2 text-xs text-red-400">{error}</p> : null}
        <button
          type="button"
          className="w-full rounded bg-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
          disabled={token === '' || busy}
          onClick={submit}
        >
          {busy ? '换桥中……' : '进入'}
        </button>
      </div>
    </div>
  );
}
