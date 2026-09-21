/**
 * host/webui-bridge 组合根测试——`--port` webui 一次性开面装配桥（批 12f-2c）。
 *
 * 组合根全栈惯例：真 conversation 栈（真盘真库 + faux provider 走真实
 * streamFn）+ 真 webui 服务端（node:http 真监听）+ fetch 真请求——18a 通报
 * 「compat 互证归 host 装配批」本件兑现（桥真身经服务端全链，词面独立律
 * 结构兼容双向互证）。mock 只停在模型层。
 */
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import { canonicalWorkspaceRoot } from '../context/index.js';
import { BaseError } from '../contracts/index.js';
import { THINKING_LEVELS } from '../conversation/index.js';
import { fauxProvider } from '../llm/index.js';
import type { Provider } from '../llm/index.js';
import { SANDBOX_MODES } from '../safety/index.js';
import { createSdkHttpFace } from '../sdk/index.js';
import type { WebuiRouteDescriptor, WebuiRouteRegistrar } from '../webui/index.js';

import { createConversationStack } from './conversation-stack.js';
import type { ConversationStack } from './conversation-stack.js';
import { createServeBridge } from './serve-entry.js';
import { renderSessionMarkdown } from './session-export.js';
import {
  SANDBOX_MODE_DETAILS,
  THINKING_LEVEL_DETAILS,
  sandboxModeReceipt,
  thinkingLevelReceipt,
} from './session-tier-copy.js';
import { createHostRuntime } from './runtime.js';
import type { HostRuntime } from './runtime.js';
import { mountWebuiOnFace, openWebuiFace } from './webui-bridge.js';
import type { WebuiExportSource, WebuiFaceMount, WebuiMountKit } from './webui-bridge.js';

/* ---------------- 测试基建 ---------------- */

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** faux 响应脚本件（'ok' 文本终态） */
function messageOf(): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 临时目录族 */
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function rigDir(prefix: string): string {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
}

/** 真栈 + faux provider 速记（真盘真库） */
function rigStack(rt: HostRuntime) {
  const faux = fauxProvider({ provider: 'faux-webui', models: [{ id: 'm1' }] });
  const stack = createConversationStack({
    runtime: rt,
    providers: [faux.provider] as readonly Provider[],
    model: 'faux-webui/m1',
    env: {},
  });
  return { faux, stack };
}

/**
 * 装配根同构 webui kit（批 19e——openWebuiFace 挂载改走 kit 分档；测试
 * 自组真身闭包 = assembly webuiFaceMount 同构，件在场形全覆盖）
 */
function mountKitOf(stack: ConversationStack, exportSource?: WebuiExportSource, cwd?: string): WebuiMountKit {
  return {
    mountOnFace: (face, opts) =>
      mountWebuiOnFace({
        stack,
        face,
        ...(opts?.staticDir !== undefined ? { staticDir: opts.staticDir } : {}),
        ...(exportSource !== undefined ? { exportSource } : {}),
        ...(cwd !== undefined ? { cwd } : {}),
      }),
  };
}

/** 微任务推进（write-behind 落账等待） */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/**
 * 占位 TCP 端口（C4 开面失败形公共手法）：node:http 真监听 127.0.0.1 内核
 * 指派口并保持占用——对被测开面即确定性 EADDRINUSE 拒形（sdk/http.ts tcp
 * 绑定失败直上抛，无重试面）；调用方 finally 内 close 释放。
 */
async function occupyTcpPort(): Promise<{ port: number; close(): Promise<void> }> {
  const server: Server = createServer();
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr === null || typeof addr === 'string') {
        server.close();
        reject(new Error('address 非 TCP 形（占位端口基建异常）'));
        return;
      }
      resolve({ port: addr.port, close: () => new Promise<void>((r) => server.close(() => r())) });
    });
  });
}

/** 轮询至谓词真（有界；支持异步谓词——投影/HTTP 轮询） */
async function until(predicate: () => boolean | Promise<boolean>, budgetMs = 2000): Promise<void> {
  const start = Date.now();
  while (!(await predicate())) {
    if (Date.now() - start > budgetMs) throw new Error('轮询超时（装配序未达预期态）');
    await tick();
  }
}

/** 带鉴权 fetch（Bearer 桥——18a 通报「Bearer 与 cookie 桥并行受理」） */
async function apiFetch(
  port: number,
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  return { status: res.status, body: text === '' ? null : (JSON.parse(text) as unknown) };
}

/** SSE 帧形（kind + payload 投影——判帧只看这两位；message_end 的 role 嵌 message 内） */
interface SseFrame {
  readonly kind: string;
  readonly payload?: {
    readonly type?: string;
    readonly role?: string;
    readonly message?: { readonly role?: string };
    readonly status?: string;
  };
}

/** SSE 后台泵读取腿（Bearer 开流；next 顺序取帧——ping 注释行天然跳过；abort 收线） */
async function openSse(
  port: number,
  sessionId: string,
  token: string,
): Promise<{ next(): Promise<SseFrame | undefined>; abort(): void }> {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/events`, {
    headers: { authorization: `Bearer ${token}` },
    signal: controller.signal,
  });
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toContain('text/event-stream');
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const queue: SseFrame[] = [];
  let wake: (() => void) | undefined;
  let buffer = '';
  let done = false;
  // 唤醒一次性（取走即清）：同 chunk 帧簇内若对每帧都调已 resolve 的
  // poll，僵尸 poll 会再 shift 一帧塞进死 promise——帧被逐个吞光（假超时）
  const nudge = (): void => {
    const w = wake;
    wake = undefined;
    w?.();
  };
  void (async (): Promise<void> => {
    try {
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });
        for (;;) {
          const idx = buffer.indexOf('\n\n');
          if (idx === -1) break;
          const block = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = block.split('\n').find((line) => line.startsWith('data: '));
          if (dataLine === undefined) continue; // ping 注释行
          queue.push(JSON.parse(dataLine.slice(6)) as SseFrame);
          nudge();
        }
      }
    } catch {
      // abort 收线——泵终止
    }
    done = true;
    nudge();
  })();
  return {
    // 单挂起消费者语义：超时先撤 wake 再 resolve——迟到的帧留在队内不被
    // 「已超时无人观察」的 pending 消费吞掉
    next: (timeoutMs = 500) =>
      new Promise((resolve) => {
        const timer = setTimeout(() => {
          wake = undefined;
          resolve(undefined);
        }, timeoutMs);
        const poll = () => {
          if (queue.length > 0) {
            clearTimeout(timer);
            wake = undefined;
            resolve(queue.shift());
            return;
          }
          if (done) {
            clearTimeout(timer);
            resolve(undefined);
            return;
          }
          wake = poll;
        };
        poll();
      }),
    abort: () => controller.abort(),
  };
}

/** 取帧至谓词真（有界——单消费者逐帧判，超时归 next 内部不吞帧） */
async function untilFrame(
  sse: { next(timeoutMs?: number): Promise<SseFrame | undefined> },
  predicate: (frame: SseFrame) => boolean,
  budgetMs = 2000,
): Promise<SseFrame> {
  const start = Date.now();
  for (;;) {
    if (Date.now() - start > budgetMs) throw new Error('SSE 取帧超时（信封未达）');
    const frame = await sse.next();
    if (frame !== undefined && predicate(frame)) return frame;
  }
}

/* ---------------- 桥单元（三窄面映射真身） ---------------- */

describe('openWebuiFace 桥单元', () => {
  it('createSession 开真驱动 + sessionStateOf 三档 + listSessions 映射形', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-bridge-data-') });
    const { stack } = rigStack(rt);
    const disclosed: string[] = [];
    const face = await openWebuiFace({
      stack,
      runtime: rt,
      port: 0, // 实配端口
      mountKit: mountKitOf(stack),
      disclose: (line) => disclosed.push(line),
    });
    try {
      // createSession：真开驱动（零 I/O——行随首事件落库）
      const id = face.deps!.sessions.createSession();
      expect(stack.manager.isOpen(id)).toBe(true);
      // 三档：open（内存册）→ missing（未知 id）
      expect(face.deps!.sessions.sessionStateOf(id)).toBe('open');
      expect(face.deps!.sessions.sessionStateOf('不存在')).toBe('missing');
      // listSessions：新建未落库不在持久册（零 I/O 承诺）——驱动落一事件后可见
      expect(face.deps!.sessions.listSessions().some((s) => s.id === id)).toBe(false);
      stack.driverOf(id)!.session.append('turn/start', {});
      await rt.persistence.flush();
      const row = face.deps!.sessions.listSessions().find((s) => s.id === id);
      expect(row).toBeDefined();
      expect(row!.title).toBeNull(); // 无标题 null（不造占位串）
      expect(row!.lastActivityAt).toBeGreaterThan(0);
      // closed 档：拆解后持久册仍见（已闭只读兜底判据；dispose 幂等——rt.shutdown
      // 的 manager closer 再跑无害）
      stack.manager.dispose();
      expect(face.deps!.sessions.sessionStateOf(id)).toBe('closed');
    } finally {
      await rt.shutdown(); // closer 内含 webui stop
    }
    // 披露两行：URL + token 一次性
    expect(disclosed.some((l) => l.includes('http://127.0.0.1:'))).toBe(true);
    expect(disclosed.some((l) => l.includes('仅此一次显示'))).toBe(true);
  });

  it('listSessions title 净化（第五役 G6 双保险读位）：存量脏 title 剥逃逸/控制字节外发、归空退 null', async () => {
    // 双保险腿锁（与 serve-entry JSON 面同谱）：写路物化已源头净化，webui 读位
    // sanitizeTitleText 兜旧码/异源写落库的脏 title——读位简化回 row.title ?? null
    // （修前形）即无红拦截。seam：updateSessionTitle 同步裸写不净化 + manager.list
    // 经 persistence.listSessions 活读无缓存
    const rt = createHostRuntime({ dataDir: rigDir('webui-title-data-') });
    const { stack } = rigStack(rt);
    const face = await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      mountKit: mountKitOf(stack),
      disclose: () => undefined,
    });
    try {
      const id = face.deps!.sessions.createSession();
      // 行随首事件落库（createSession 零 I/O 承诺——先落行再 plant）
      stack.driverOf(id)!.session.append('turn/start', {});
      await rt.persistence.flush();
      // plant 脏 title（模拟旧码/异源写）：OSC 逃逸段 + NUL + 可见题文混排
      expect(rt.persistence.updateSessionTitle(id, '\x1b]0;evil\x07题\x00')).toBe(true);
      const dirty = face.deps!.sessions.listSessions().find((s) => s.id === id);
      expect(dirty).toBeDefined();
      expect(dirty!.title).toBe('题'); // OSC 逃逸 + NUL 剥除外发——可见题文保留
      // 净化归空（纯不可见形态：CSI 清屏段 + 零宽空格）：诚实退 null 不造占位
      expect(rt.persistence.updateSessionTitle(id, '\x1b[2J\u200b')).toBe(true);
      const emptied = face.deps!.sessions.listSessions().find((s) => s.id === id);
      expect(emptied).toBeDefined();
      expect(emptied!.title).toBeNull();
    } finally {
      await rt.shutdown();
    }
  });

  it('submitPrompt 全链 + fetchMessages 投影 + todoOf 两态', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-bridge-data-') });
    const { faux, stack } = rigStack(rt);
    const face = await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      mountKit: mountKitOf(stack),
      disclose: () => undefined,
    });
    try {
      const id = face.deps!.sessions.createSession();
      faux.setResponses([() => messageOf()]);
      // submitPrompt：fire-and-forget 受理（回执经信封——投影轮询达终态）
      const outcome = face.deps!.sessions.submitPrompt({ sessionId: id, content: '你好', messageId: 'm-1' });
      expect(outcome).toEqual({ sessionId: id });
      const projection = await face.deps!.read.fetchMessages(id);
      // 中途投影已含 user 消息；应答终态轮询投影（faux 全链毫秒级，有界）
      expect(projection.some((m) => m.role === 'user' && m.content === '你好')).toBe(true);
      await until(async () => (await face.deps!.read.fetchMessages(id)).some((m) => m.role === 'assistant'));
      const settled = await face.deps!.read.fetchMessages(id);
      expect(settled.some((m) => m.role === 'assistant')).toBe(true); // 全链达 faux 模型
      // todoOf：无 todo 事件 = 空表（fold 空事件得 []）；无驱动 = undefined
      expect(face.deps!.read.todoOf?.(id)).toEqual([]);
      expect(face.deps!.read.todoOf?.('不存在')).toBeUndefined();
      // interrupt 幂等（未知 id 静默）
      face.deps!.sessions.interruptSession(id);
      face.deps!.sessions.interruptSession('不存在');
    } finally {
      await rt.shutdown();
    }
  });

  it('submitPrompt 幂等位（第六役转交 webui-face#2）：同 messageId 双发恰落一条 user 消息', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-bridge-data-') });
    const { faux, stack } = rigStack(rt);
    const face = await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      mountKit: mountKitOf(stack),
      disclose: () => undefined,
    });
    try {
      const id = face.deps!.sessions.createSession();
      // 三跑应答：首发 + 缺席键 + 陈旧字面量（幂等重收执与冲突拒不耗应答）
      faux.setResponses([() => messageOf(), () => messageOf(), () => messageOf()]);
      // 首发受理（SPA 携 UUID 形幂等键——03:938 ⑤ submit 体 messageId 选填位）
      face.deps!.sessions.submitPrompt({ sessionId: id, content: '重试同文', messageId: 'spa-uuid-1' });
      // 轮询至首笔 durable 可见（真重试形：响应丢失后重发——重发时首笔已在账）
      await until(async () => (await face.deps!.read.fetchMessages(id)).some((m) => m.role === 'user'));
      // 同 messageId 同内容再发（SPA 重试形）：受理即幂等回执不重跑
      const receipt = face.deps!.sessions.submitPrompt({ sessionId: id, content: '重试同文', messageId: 'spa-uuid-1' });
      expect(receipt).toEqual({ sessionId: id });
      // 同 messageId 异内容（调用方 bug 形）：fail-loud 拒收（admit 冲突档——判据族与 SDK 线同源）
      expect(() =>
        face.deps!.sessions.submitPrompt({ sessionId: id, content: '异内容', messageId: 'spa-uuid-1' }),
      ).toThrow('同键异内容');
      // 终态断言：恰一条 user 消息（修前双发各落一条 = 2 条——幂等位断裂）
      const settled = await face.deps!.read.fetchMessages(id);
      expect(settled.filter((m) => m.role === 'user')).toHaveLength(1);
      // 落账透传：durable user/message 载荷带 dedupeKey + 具名通道归因（channel: 前缀投影同视 user）
      const firstUser = stack
        .driverOf(id)!
        .session.events()
        .find((e) => e.type === 'user/message')!;
      expect((firstUser.data as { dedupeKey?: string }).dedupeKey).toBe('spa-uuid-1');
      expect((firstUser.data as { source?: string }).source).toBe('channel:webui');
      // messageId 缺席（undefined 透传——8572ccd 拍板收敛落地：件侧不补生成）：
      // 无幂等不落账（SDK 线同律）——durable 载荷不带 dedupeKey
      face.deps!.sessions.submitPrompt({ sessionId: id, content: '缺席键形', messageId: undefined });
      await until(() => {
        const events = stack.driverOf(id)!.session.events();
        return events.filter((e) => e.type === 'user/message').length >= 2;
      });
      const secondUser = stack
        .driverOf(id)!
        .session.events()
        .filter((e) => e.type === 'user/message')[1]!;
      expect((secondUser.data as { dedupeKey?: string }).dedupeKey).toBeUndefined();
      // 陈旧字面量 'webui-N'（旧客户端形）：形判别已退役——任何非空 messageId
      // 都是客户端自选幂等键，照常落账（修前形判别旁路 = 不落账，本断言即红）
      face.deps!.sessions.submitPrompt({ sessionId: id, content: '陈旧字面量形', messageId: 'webui-5' });
      await until(() => {
        const events = stack.driverOf(id)!.session.events();
        return events.filter((e) => e.type === 'user/message').length >= 3;
      });
      const thirdUser = stack
        .driverOf(id)!
        .session.events()
        .filter((e) => e.type === 'user/message')[2]!;
      expect((thirdUser.data as { dedupeKey?: string }).dedupeKey).toBe('webui-5');
    } finally {
      await rt.shutdown();
    }
  });
});

/* ---------------- HTTP e2e（compat 互证——桥真身经服务端全链） ---------------- */

describe('openWebuiFace HTTP e2e（18a compat 互证）', () => {
  it('鉴权受理：list → create → submit → messages 全链 + API-only 形 / 404', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-e2e-data-') });
    const { faux, stack } = rigStack(rt);
    let opened: { host: string; port: number; token: string } | undefined;
    const face = await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      mountKit: mountKitOf(stack),
      onOpen: (info) => {
        opened = info;
      },
    });
    try {
      expect(opened).toBeDefined();
      const { port, token } = opened!;
      // 无鉴权拒（监听 ⇒ 鉴权恒在场）
      const anon = await fetch(`http://127.0.0.1:${port}/api/sessions`);
      expect(anon.status).toBe(401);
      // list：空册 200
      const list = await apiFetch(port, token, '/api/sessions');
      expect(list.status).toBe(200);
      // create：POST 新会话（响应体 { sessionId }——服务端 sendJson 形状）
      const created = await apiFetch(port, token, '/api/sessions', { method: 'POST' });
      expect(created.status).toBe(200);
      const sessionId = (created.body as { sessionId: string }).sessionId;
      expect(stack.manager.isOpen(sessionId)).toBe(true); // 桥真身真开驱动
      // submit：POST 文本 → faux 全链
      faux.setResponses([() => messageOf()]);
      const submit = await apiFetch(port, token, `/api/sessions/${sessionId}/submit`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'e2e 提交', messageId: 'e2e-1' }),
      });
      expect(submit.status).toBe(200);
      expect(submit.body).toEqual({ sessionId });
      // messages：投影兜底可拉——轮询至 user 文本在场（有界）
      await until(async () => {
        const res = await apiFetch(port, token, `/api/sessions/${sessionId}/messages`);
        if (res.status !== 200) return false;
        return ((res.body as { messages?: { role: string }[] }).messages ?? []).some((m) => m.role === 'user');
      });
      const messages = await apiFetch(port, token, `/api/sessions/${sessionId}/messages`);
      expect(messages.status).toBe(200);
      const items = (messages.body as { messages: { role: string; content: unknown }[] }).messages;
      expect(items.some((m) => m.role === 'user')).toBe(true);
      // API-only 形：测试态无 dist/webui 静态面——/ 与未知路径 404（诚实缺席）
      const root = await apiFetch(port, token, '/');
      expect(root.status).toBe(404);
      // stop 幂等收口（rt.shutdown 经 closer 已含 stop——二次直调幂等；改形后
      // 收口 = webui detach + 面 stop 两段，handle.stop 统一封装）
      await face.stop();
      const gone = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => undefined);
      expect(gone).toBeUndefined(); // 监听已关（连接拒绝）
    } finally {
      await rt.shutdown();
    }
  });

  it('submit 幂等位 HTTP 会合验（messageId 收敛批）：同键重试 200 回执 / 同键异内容 409 结构码', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-idem-data-') });
    const { faux, stack } = rigStack(rt);
    let opened: { port: number; token: string } | undefined;
    await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      mountKit: mountKitOf(stack),
      onOpen: (info) => {
        opened = info;
      },
    });
    try {
      const { port, token } = opened!;
      const created = await apiFetch(port, token, '/api/sessions', { method: 'POST' });
      const sessionId = (created.body as { sessionId: string }).sessionId;
      faux.setResponses([() => messageOf()]);
      const submitOf = (text: string, messageId: string) =>
        apiFetch(port, token, `/api/sessions/${sessionId}/submit`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text, messageId }),
        });
      // 首发受理（messageId 携键——8572ccd 收敛后唯一形，件侧不补生成）
      const first = await submitOf('HTTP 幂等首文', 'e2e-idem-1');
      expect(first.status).toBe(200);
      await until(async () => {
        const res = await apiFetch(port, token, `/api/sessions/${sessionId}/messages`);
        if (res.status !== 200) return false;
        return ((res.body as { messages?: { role: string }[] }).messages ?? []).some((m) => m.role === 'user');
      });
      // 同键同内容重试（SPA 重发形）：幂等回执 200 不重跑（恰一条 user）
      const retry = await submitOf('HTTP 幂等首文', 'e2e-idem-1');
      expect(retry.status).toBe(200);
      expect(retry.body).toEqual({ sessionId });
      // 同键异内容（调用方 bug 形）：桥 admit 抛 SDK_MESSAGE_CONFLICT——
      // server 件窄 catch 折 409 结构码（error 位带码、message 位人读因；
      // 与 sdk 面 HTTP_STATUS_BY_CODE 码表跨面一致）
      const conflict = await submitOf('异内容', 'e2e-idem-1');
      expect(conflict.status).toBe(409);
      expect((conflict.body as { error?: string }).error).toBe('SDK_MESSAGE_CONFLICT');
      expect((conflict.body as { message?: string }).message).toContain('同键异内容');
      // 终态：durable 恰一条 user（重试与冲突拒均不落账）
      expect(
        stack
          .driverOf(sessionId)!
          .session.events()
          .filter((e) => e.type === 'user/message'),
      ).toHaveLength(1);
    } finally {
      await rt.shutdown();
    }
  });

  it('staticDir 注入：SPA 静态面 / 200 文本（探测位覆盖）', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-static-data-') });
    const { stack } = rigStack(rt);
    const staticDir = rigDir('webui-static-');
    writeFileSync(join(staticDir, 'index.html'), '<!doctype html><title>spa</title>');
    let opened: { port: number; token: string } | undefined;
    await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      staticDir,
      mountKit: mountKitOf(stack),
      onOpen: (info) => {
        opened = info;
      },
    });
    try {
      const res = await fetch(`http://127.0.0.1:${opened!.port}/`, {
        headers: { authorization: `Bearer ${opened!.token}` },
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('<title>spa</title>');
    } finally {
      await rt.shutdown();
    }
  });

  it('mountKit 缺席（webui 件禁用形——批 19e 分档）：面开 /api/* 404 而 /v1/* 在场 + 披露诚实不虚报', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-bare-data-') });
    const { stack } = rigStack(rt);
    const disclosed: string[] = [];
    let opened: { port: number; token: string } | undefined;
    const face = await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      disclose: (line) => disclosed.push(line),
      onOpen: (info) => {
        opened = info;
      },
    });
    try {
      expect(face.webui).toBeUndefined(); // 件缺席 = 无挂载产物（handle 诚实 undefined）
      expect(face.deps).toBeUndefined();
      // /api/* 全族 404（webui 路由未挂——件禁用语义族）
      const api = await fetch(`http://127.0.0.1:${opened!.port}/api/sessions`, {
        headers: { authorization: `Bearer ${opened!.token}` },
      });
      expect(api.status).toBe(404);
      // /v1/* 程序调用族在场（sdk 面本体——面开而 webui 路由缺席；协议版本头
      // 恒要求——x-sdk-protocol: 1，缺席即 400 属面本体行为）
      const sdk = await fetch(`http://127.0.0.1:${opened!.port}/v1/sessions`, {
        headers: { authorization: `Bearer ${opened!.token}`, 'x-sdk-protocol': '1' },
      });
      expect(sdk.status).toBe(200);
      // 披露分档：诚实报 SDK 面形（不虚报 Web 界面）+ token 行照旧
      expect(disclosed.some((l) => l.includes('webui 件未装载'))).toBe(true);
      expect(disclosed.some((l) => l.includes('Web 界面已开面'))).toBe(false);
      expect(disclosed.some((l) => l.includes('仅此一次显示'))).toBe(true);
    } finally {
      await rt.shutdown();
    }
  });
});

/* ---------------- 三入口咬合（18a-3'）——共用挂载段 + 信封扇出 + compat 互证 ---------------- */

describe("18a-3' 三入口咬合：共用挂载段", () => {
  it('开面即挂 backend：submitPrompt 后 SSE 流收到信封（12f-2c 期挂接缺位 = SSE 死流真缺陷的回归锁）', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-fanout-data-') });
    const { faux, stack } = rigStack(rt);
    let opened: { port: number; token: string } | undefined;
    await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      mountKit: mountKitOf(stack),
      disclose: () => undefined, // 测试态 stderr 静默（token 只进 onOpen 收账）
      onOpen: (info) => {
        opened = info;
      },
    });
    let sse: { next(timeoutMs?: number): Promise<SseFrame | undefined>; abort(): void } | undefined;
    try {
      const sessionId = stack.manager.create().sessionId; // 真开驱动（SSE 存在性先决）
      // SSE 开流在提交前——首帧不漏（连接即当下）
      sse = await openSse(opened!.port, sessionId, opened!.token);
      faux.setResponses([() => messageOf()]);
      stack.submitText(sessionId, '扇出接线'); // 桥真身同式（fire-and-forget——回执经信封回流）
      // 信封全链：driver 事件 → conversation-stack onEvent → channels emit →
      // webui backend 扇出 → SSE data 帧（user 侧活体 = display 族 message_start）
      const user = await untilFrame(
        sse,
        (f) => f.kind === 'display' && f.payload?.type === 'message_start' && f.payload?.role === 'user',
      );
      expect(user).toBeDefined();
      expect(user).toBeDefined();
      // 终结型换装 session 族（18a 定形注②：message_end 落 durable 镜像——
      // assistant 终结位在 payload.message.role）
      const settled = await untilFrame(
        sse,
        (f) => f.kind === 'session' && f.payload?.type === 'message_end' && f.payload?.message?.role === 'assistant',
      );
      expect(settled).toBeDefined();
    } finally {
      sse?.abort();
      await rt.shutdown(); // closer 内含 stop（detach + 面 stop）
    }
  });

  it('compat 互证归本批：描述符方向〔webui 形经注入位 routes 承载〕+ 注册器方向〔face.register 可作 WebuiRouteRegistrar〕真 TCP 全环', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-compat-data-') });
    const { stack } = rigStack(rt);
    try {
      // 描述符方向（协变位）：WebuiRouteDescriptor 值形可作面侧描述符消费——
      // 经 18a-1' 注入位（options.routes 构造期注册）承载（typecheck 门禁执法）
      const injected: WebuiRouteDescriptor = {
        method: 'GET',
        path: '/api/compat-injected',
        auth: { mode: 'open', purpose: 'liveness' },
        loopbackOnly: true,
        handler: (_req, res) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ via: 'injected' }));
        },
      };
      const face = createSdkHttpFace({
        config: { tcp: { host: '127.0.0.1', port: 0 } },
        bridge: createServeBridge(stack, rt, { cwd: process.cwd() }),
        routes: [injected],
      });
      // 注册器方向（逆变位）：sdk 面注册器可作 WebuiRouteRegistrar 消费——
      // mountWebui 同款晚绑（词面独立律的结构性两方向全锁）
      const asWebuiRegistrar: WebuiRouteRegistrar = face.register;
      asWebuiRegistrar({
        method: 'GET',
        path: '/api/compat-late',
        auth: { mode: 'open', purpose: 'liveness' },
        loopbackOnly: true,
        handler: (_req, res) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ via: 'late' }));
        },
      });
      const info = await face.start();
      const { port } = info.tcp[0]!;
      // 两方向真 TCP 全环（open/liveness 位无凭证可达）
      const a = await fetch(`http://127.0.0.1:${port}/api/compat-injected`);
      expect(a.status).toBe(200);
      expect(await a.json()).toEqual({ via: 'injected' });
      const b = await fetch(`http://127.0.0.1:${port}/api/compat-late`);
      expect(b.status).toBe(200);
      expect(await b.json()).toEqual({ via: 'late' });
      await face.stop();
    } finally {
      await rt.shutdown();
    }
  });

  it('mountWebuiOnFace 直挂 daemon 形 face：/api 族随挂即活 + detach 摘路由幂等（面仍在听）', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-mount-data-') });
    const { stack } = rigStack(rt);
    try {
      const face = createSdkHttpFace({
        config: { tcp: { host: '127.0.0.1', port: 0 } },
        bridge: createServeBridge(stack, rt, { cwd: process.cwd() }),
      });
      const mount = mountWebuiOnFace({ stack, face });
      const info = await face.start();
      const { port } = info.tcp[0]!;
      // 挂载即活：webui 探活位（open/liveness）无凭证可达
      const before = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(before.status).toBe(200);
      // detach = backend 摘除 + 全路由摘除——面仍在听（daemon 收口序：先摘挂再停面）
      mount.detach();
      mount.detach(); // 幂等二次 no-op
      const after = await fetch(`http://127.0.0.1:${port}/api/health`);
      expect(after.status).toBe(404);
      await face.stop();
    } finally {
      await rt.shutdown();
    }
  });
});

/* ---------------- 开面失败形（C4——端口占用先摘挂载不留半挂） ---------------- */

describe('openWebuiFace 开面失败（端口占用）——先摘挂载不留半挂', () => {
  it('EADDRINUSE 拒形：mount detach 恰一次 + 失败先于 closer 注册位（无半挂 backend 入退出序）', async () => {
    const occupied = await occupyTcpPort();
    const rt = createHostRuntime({ dataDir: rigDir('webui-busy-data-') });
    try {
      // registerCloser 计数包装（spread 委派真身——栈装配期的 closer 注册照走，
      // 断言只比 openWebuiFace 前后的增量：失败形应先于 :168 注册位零新增）
      let closerCount = 0;
      const guarded: HostRuntime = {
        ...rt,
        registerCloser: (closer) => {
          closerCount += 1;
          rt.registerCloser(closer);
        },
      };
      const { stack } = rigStack(guarded);
      const beforeClosers = closerCount; // 栈装配已完成——此后增量全归 openWebuiFace
      // detach 计数假挂载（批 19e 同构 mountKit——只数摘挂，不建真路由）
      let detachCount = 0;
      const kit: WebuiMountKit = {
        mountOnFace: () =>
          ({
            detach: () => {
              detachCount += 1;
            },
          }) as unknown as WebuiFaceMount,
      };
      await expect(
        openWebuiFace({ stack, runtime: guarded, port: occupied.port, mountKit: kit, disclose: () => undefined }),
      ).rejects.toMatchObject({ code: 'EADDRINUSE' }); // 确定性拒形（tcp 绑定失败直上抛——占位口非 flaky）
      expect(detachCount).toBe(1); // 主断言：监听未成先摘挂载——不留半挂 backend
      expect(closerCount).toBe(beforeClosers); // 失败先于注册位——半挂 stop 不入退出序
    } finally {
      await rt.shutdown(); // closer 内含（未注册的）stop 不在场——幂等收口
      await occupied.close();
    }
  });
});

/* ---------------- /export 端点全链（2026-09-17 TUI 余量收官批②——拼装单源第三消费位） ---------------- */

describe('webui /export 端点（markdown 直出——host 装配桥真身）', () => {
  /** 测试钟（文档头「导出时间」确定性——拼装单源对拍锚） */
  const FIXED_NOW = 1_789_600_000_000;

  /** 装配根同构导出源（assembly webuiFaceMount 闭包同构——双事实源 + 行面元数据 + 测试钟） */
  function exportSourceOf(stack: ConversationStack, rt: HostRuntime, now?: () => number): WebuiExportSource {
    return {
      rowOf: (sessionId) => rt.persistence.store.getSessionRow(sessionId),
      eventsOf: (sessionId) => {
        const driver = stack.driverOf(sessionId);
        if (driver !== undefined) return driver.session.events(); // 活体真源
        try {
          return rt.persistence.loadSession(sessionId).log.events(); // durable 回退（近史兜底）
        } catch {
          return undefined; // 行不在场——端点 404 not_found
        }
      },
      ...(now !== undefined ? { now } : {}),
    };
  }

  it('桥真身拼装单源：exportMarkdown(id) === renderSessionMarkdown(同会话输入) 逐字节 + HTTP 直出同体同型', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-export-data-') });
    const { faux, stack } = rigStack(rt);
    faux.setResponses([() => messageOf()]);
    let opened: { port: number; token: string } | undefined;
    const face = await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      mountKit: mountKitOf(
        stack,
        exportSourceOf(stack, rt, () => FIXED_NOW),
      ),
      disclose: () => undefined, // 测试态 stderr 静默（token 只进 onOpen 收账）
      onOpen: (info) => {
        opened = info;
      },
    });
    try {
      const id = face.deps!.sessions.createSession();
      stack.submitText(id, '导出对拍');
      await until(async () => (await face.deps!.read.fetchMessages(id)).some((m) => m.role === 'assistant'));
      await rt.persistence.flush(); // write-behind 排空——行面两读同一时点（对拍确定性）
      // 对拍输入单源：同一事件数组 + 同一行面元数据投影 + 同钟（桥真身读同一行）
      const events = stack.driverOf(id)!.session.events();
      const row = rt.persistence.store.getSessionRow(id);
      const expected = renderSessionMarkdown({
        events,
        meta: {
          sessionId: id,
          ...(row?.title !== undefined && row.title !== '' ? { title: row.title } : {}),
          ...(row?.workspaceRoot !== undefined ? { workspaceRoot: row.workspaceRoot } : {}),
          ...(row?.createdAt !== undefined ? { createdAt: row.createdAt } : {}),
        },
        now: FIXED_NOW,
      });
      expect(face.deps!.read.exportMarkdown).toBeDefined();
      expect(face.deps!.read.exportMarkdown!(id)).toBe(expected); // 拼装单源——逐字节恒等
      // HTTP 直出：应答体 === 桥真身产物；Content-Type 精确值（03 §10.4 批注钉死）
      const res = await fetch(`http://127.0.0.1:${opened!.port}/api/sessions/${id}/export`, {
        headers: { authorization: `Bearer ${opened!.token}` },
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/markdown; charset=utf-8');
      expect(await res.text()).toBe(expected);
    } finally {
      await rt.shutdown();
    }
  });

  it('已闭近史兜底照返体 + 缺席 undefined（404 形判据）', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-export-closed-') });
    const { faux, stack } = rigStack(rt);
    faux.setResponses([() => messageOf()]);
    const face = await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      mountKit: mountKitOf(
        stack,
        exportSourceOf(stack, rt, () => FIXED_NOW),
      ),
      disclose: () => undefined,
    });
    try {
      const id = face.deps!.sessions.createSession();
      stack.submitText(id, '已闭兜底');
      await until(async () => (await face.deps!.read.fetchMessages(id)).some((m) => m.role === 'assistant'));
      await rt.persistence.flush(); // 拆驱动前排空——兜底腿读库行必有全量事件
      const eventsBeforeClose = stack.driverOf(id)!.session.events(); // 关前活体快照（对拍锚）
      const row = rt.persistence.store.getSessionRow(id);
      stack.manager.dispose(); // 拆驱动 → 已闭（持久册可见）
      expect(face.deps!.sessions.sessionStateOf(id)).toBe('closed');
      // 近史兜底：closed 会话照常返体（读面语义同 GET messages——host 桥真身内兜底）
      expect(face.deps!.read.exportMarkdown!(id)).toBe(
        renderSessionMarkdown({
          events: eventsBeforeClose,
          meta: {
            sessionId: id,
            ...(row?.title !== undefined && row.title !== '' ? { title: row.title } : {}),
            ...(row?.workspaceRoot !== undefined ? { workspaceRoot: row.workspaceRoot } : {}),
            ...(row?.createdAt !== undefined ? { createdAt: row.createdAt } : {}),
          },
          now: FIXED_NOW,
        }),
      );
      // 缺席：未知 id → undefined（端点 404 not_found 同族判据）
      expect(face.deps!.read.exportMarkdown!('不存在')).toBeUndefined();
    } finally {
      await rt.shutdown();
    }
  });

  it('注入窄面缺席：exportSource 未注入 → exportMarkdown 键不在（端点 501 诚实缺席的桥侧形）', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-export-bare-') });
    const { stack } = rigStack(rt);
    const face = await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      mountKit: mountKitOf(stack), // 无导出源——装配缺席形（WebuiCompletionFace? 同精神）
      disclose: () => undefined,
    });
    try {
      expect(face.deps!.read.exportMarkdown).toBeUndefined();
    } finally {
      await rt.shutdown();
    }
  });
});

/* ---------------- 档位面桥真身（2026-09-18 webui 档位面受理批——tiers 注入） ---------------- */

describe('webui 档位面桥真身（tiers 注入——/thinking //sandbox webui 受路）', () => {
  /** 抓错误码（conversation 档位件测试同款——BaseError 码位断言形，不断言文案细节） */
  function catchCode(fn: () => unknown): string | undefined {
    try {
      fn();
    } catch (e) {
      return e instanceof BaseError ? e.code : `非 BaseError：${String(e)}`;
    }
    return undefined;
  }

  /**
   * setStatus 扇出 spy 后端（CR-TIER-3 裁决①观测位）：只声明 setStatus 能力，
   * 其余能力全关——notify 静默。宿主域 addBackend 直挂（测试观测形）。
   */
  function tierSpyBackend(sink: Array<{ sessionId: string; status: string }>) {
    return {
      id: 'tier-fanout-spy',
      capabilities: {
        notify: true,
        confirm: false,
        select: false,
        input: false,
        approval: false,
        setStatus: true,
        setWidget: false,
      },
      hasAudience: () => false,
      notify: () => undefined,
      setStatus: (sessionId: string, status: string) => {
        sink.push({ sessionId, status });
      },
    };
  }

  it('tiersOf 形状：行集两表单源（词表 × host 文案表）+ 新会话现值（thinking 无锚 null / sandbox 恒锚）+ 切档后 fold 现值 + 驱动缺席退栈基线', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-tiers-shape-') });
    const { stack } = rigStack(rt);
    // 面不起监听——桥真身 deps 直消费（completion 面同测试形）
    const face = createSdkHttpFace({
      config: { tcp: { host: '127.0.0.1', port: 0 } },
      bridge: createServeBridge(stack, rt, { cwd: process.cwd() }),
    });
    const mount = mountWebuiOnFace({ stack, face });
    try {
      const tiers = mount.deps.tiers;
      expect(tiers).toBeDefined(); // 桥真身恒注入（stack 在场——非 seam 缺席形）
      const id = stack.manager.create().sessionId; // 真开驱动
      const shape = tiers!.tiersOf(id);
      // 新会话零档位事件：thinking 无锚（fold 与栈基线均缺席）= null（行集照常全量）
      expect(shape.thinkingLevel).toBeNull();
      // sandbox 恒有锚——boot 解析值（rigStack 缺省 workspace-write）
      expect(shape.sandboxMode).toBe('workspace-write');
      // 行集 = 词表单源（conversation THINKING_LEVELS / safety SANDBOX_MODES）× host 文案表
      expect(shape.thinkingLevels).toEqual(
        THINKING_LEVELS.map((level) => ({ level, detail: THINKING_LEVEL_DETAILS[level] })),
      );
      expect(shape.thinkingLevels).toHaveLength(7);
      expect(shape.thinkingLevels[0]).toEqual({ level: 'off', detail: '关闭思考' });
      expect(shape.sandboxModes).toEqual(SANDBOX_MODES.map((mode) => ({ mode, detail: SANDBOX_MODE_DETAILS[mode] })));
      // danger 行警示语 07 §4.1 钉死句（第三档语义不粉饰）
      expect(shape.sandboxModes).toContainEqual({ mode: 'danger', detail: '无沙箱——任何命令直跑宿主' });
      // 切档后现值 = fold 现值（append 即入账——tiersOf 每次现取）
      tiers!.setThinkingLevel(id, 'high');
      tiers!.setSandboxMode(id, 'read-only');
      const after = tiers!.tiersOf(id);
      expect(after.thinkingLevel).toBe('high');
      expect(after.sandboxMode).toBe('read-only');
      // 驱动缺席防御：现值退栈基线（thinking null / sandbox boot 值）——行集照常全量
      const absent = tiers!.tiersOf('不存在');
      expect(absent.thinkingLevel).toBeNull();
      expect(absent.sandboxMode).toBe('workspace-write');
      expect(absent.thinkingLevels).toHaveLength(7);
      expect(absent.sandboxModes).toHaveLength(3);
    } finally {
      mount.detach();
      await rt.shutdown();
    }
  });

  it('setXxx 消费：append 落账 + setStatus 恒一笔（CR-TIER-3 扇出）+ 回执与单源函数同文（字面锁）', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-tiers-set-') });
    const { stack } = rigStack(rt);
    const face = createSdkHttpFace({
      config: { tcp: { host: '127.0.0.1', port: 0 } },
      bridge: createServeBridge(stack, rt, { cwd: process.cwd() }),
    });
    const mount = mountWebuiOnFace({ stack, face });
    const statuses: Array<{ sessionId: string; status: string }> = [];
    try {
      stack.channels.addBackend(tierSpyBackend(statuses));
      const tiers = mount.deps.tiers!;
      const id = stack.manager.create().sessionId;
      // thinking 半边：回执 = 单源 helper 逐字符一致 + 字面锁（单元级快速位——
      // tmux e2e 之外的第二道回执文案锁）
      const receipt = tiers.setThinkingLevel(id, 'max');
      expect(receipt).toBe(thinkingLevelReceipt('max'));
      expect(receipt).toBe('思考档位：max（下一 run 起生效；档位是否生效随模型能力）');
      // append 落账（conversation 单写者面——durable 事件恰一条）
      const thinkingEvents = stack
        .driverOf(id)!
        .session.events()
        .filter((e) => e.type === 'session/thinking-level');
      expect(thinkingEvents).toHaveLength(1);
      expect((thinkingEvents[0]!.data as { level: string }).level).toBe('max');
      // setStatus 恒一笔（成功尾扇出——session-scoped，他通道观众可见）
      expect(statuses).toEqual([{ sessionId: id, status: receipt }]);
      // sandbox 半边同律（A4 分拆形另一半：即刻生效于后续工具调用）
      const receipt2 = tiers.setSandboxMode(id, 'danger');
      expect(receipt2).toBe(sandboxModeReceipt('danger'));
      expect(receipt2).toBe('沙箱档位：danger（即刻生效于后续工具调用）');
      const modeEvents = stack
        .driverOf(id)!
        .session.events()
        .filter((e) => e.type === 'sandbox/mode');
      expect(modeEvents).toHaveLength(1);
      expect((modeEvents[0]!.data as { mode: string }).mode).toBe('danger');
      expect(statuses).toEqual([
        { sessionId: id, status: receipt },
        { sessionId: id, status: receipt2 },
      ]);
    } finally {
      mount.detach();
      await rt.shutdown();
    }
  });

  it('坏词与缺席 fail-loud：THINKING_LEVEL_INVALID/SANDBOX_MODE_INVALID 上抛（不扇出不入账）+ SESSION_NOT_FOUND（驱动缺席）+ fold 坏词上抛', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-tiers-bad-') });
    const { stack } = rigStack(rt);
    const face = createSdkHttpFace({
      config: { tcp: { host: '127.0.0.1', port: 0 } },
      bridge: createServeBridge(stack, rt, { cwd: process.cwd() }),
    });
    const mount = mountWebuiOnFace({ stack, face });
    const statuses: Array<{ sessionId: string; status: string }> = [];
    try {
      stack.channels.addBackend(tierSpyBackend(statuses));
      const tiers = mount.deps.tiers!;
      const id = stack.manager.create().sessionId;
      // 坏词上抛：append 面词法校验自然传播（BaseError 码族——服务端 400 呈现）
      expect(() => tiers.setThinkingLevel(id, 'ultra')).toThrowError(BaseError);
      expect(catchCode(() => tiers.setThinkingLevel(id, 'ultra'))).toBe('THINKING_LEVEL_INVALID');
      expect(catchCode(() => tiers.setSandboxMode(id, 'full-access'))).toBe('SANDBOX_MODE_INVALID');
      // 坏词不入账不扇出（校验在 append 之前；setStatus 只在成功尾）
      expect(
        stack
          .driverOf(id)!
          .session.events()
          .filter((e) => e.type === 'session/thinking-level'),
      ).toHaveLength(0);
      expect(statuses).toHaveLength(0);
      // 驱动缺席：BaseError（会话不在场——服务端前置 404 分账之外的桥侧防御位）
      expect(catchCode(() => tiers.setThinkingLevel('不存在', 'high'))).toBe('SESSION_NOT_FOUND');
      expect(catchCode(() => tiers.setSandboxMode('不存在', 'danger'))).toBe('SESSION_NOT_FOUND');
      // fold 坏词上抛：tiersOf 不 catch（CR-TIER-2——GET 走面级 500，TUI 开屏
      // notify 降级形分立如实）；坏行 = 直落事件模拟持久层异源写入形
      stack.driverOf(id)!.session.append('session/thinking-level', { level: '幽灵档' });
      expect(catchCode(() => tiers.tiersOf(id))).toBe('THINKING_LEVEL_INVALID');
    } finally {
      mount.detach();
      await rt.shutdown();
    }
  });

  it('PUT 切档成功尾 → SSE status 帧达 webui 观众（通道核扇出×webui backend setStatus 能力位组合锁——第九役 C5；变异烟测锚：backend capabilities.setStatus 翻 false 本测必红）', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-tiers-sse-') });
    const { stack } = rigStack(rt);
    let opened: { port: number; token: string } | undefined;
    await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      mountKit: mountKitOf(stack),
      disclose: () => undefined, // 测试态 stderr 静默
      onOpen: (info) => {
        opened = info;
      },
    });
    let sse: { next(timeoutMs?: number): Promise<SseFrame | undefined>; abort(): void } | undefined;
    try {
      const sessionId = stack.manager.create().sessionId; // 真开驱动（SSE 存在性先决）
      // SSE 开流在 PUT 之前——status 帧不漏（连接即当下）
      sse = await openSse(opened!.port, sessionId, opened!.token);
      // webui 受路真身：PUT 切档 → 桥 tiers.setThinkingLevel（append 落账 +
      // 成功尾通道核 setStatus 扇出）→ webui backend（能力位放行）→ SSE 帧体
      const put = await apiFetch(opened!.port, opened!.token, `/api/sessions/${sessionId}/thinking-level`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level: 'high' }),
      });
      expect(put.status).toBe(200);
      expect(put.body).toEqual({ receipt: thinkingLevelReceipt('high') });
      // 观众半边：status 帧经通道核扇出达 SSE（回执单源——payload.status 与
      // PUT 应答 receipt 同文；capabilities.setStatus 缺位即此帧不达）
      const statusFrame = await untilFrame(sse, (f) => f.kind === 'status');
      expect(statusFrame.payload?.status).toBe(thinkingLevelReceipt('high'));
    } finally {
      sse?.abort();
      await rt.shutdown();
    }
  });
});

/* ---------------- serve 四桥会话键 canonical 统一（CL-A2） ---------------- */

describe('serve 四桥会话键 canonical 统一（CL-A2）', () => {
  it('登记位（webui 桥 cwd 锚）：非 canonical 锚（symlink 别名）经 canonical 化登记——查询侧按 canonical 根必命中', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('a2-webui-data-') });
    const { faux, stack } = rigStack(rt);
    faux.setResponses([() => messageOf()]);
    // 非 canonical 形造法：git 仓库根 + symlink 别名（canonicalWorkspaceRoot
    // (别名) = realpath 仓库根 ≠ raw 别名串——06 §74 解析律）
    const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'a2-webui-')));
    const repoRoot = join(base, 'repo');
    mkdirSync(join(repoRoot, '.git'), { recursive: true });
    const alias = join(base, 'repo-link');
    symlinkSync(repoRoot, alias);
    const canonical = canonicalWorkspaceRoot(alias);
    expect(canonical).toBe(realpathSync(repoRoot)); // 前置自证：别名确非 canonical 形
    expect(canonical).not.toBe(alias);

    let opened: { port: number; token: string } | undefined;
    // webui 登记位：openWebuiFace 内 createServeBridge cwd 锚（CL-A2 补注入位）
    const handle = await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      cwd: alias, // raw 别名锚注入（修前直落 raw 键）
      disclose: () => undefined, // 测试态 stderr 静默
      onOpen: (info) => {
        opened = info;
      },
    });
    try {
      // /v1/prompt 无 sessionId → 桥 submitPrompt 走 manager.create（登记位）
      const res = await fetch(`http://127.0.0.1:${opened!.port}/v1/prompt`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-sdk-protocol': '1',
          authorization: `Bearer ${opened!.token}`,
        },
        body: JSON.stringify({ messageId: 'a2-w-1', content: '键统一' }),
      });
      expect(res.status).toBe(200);
      const ack = (await res.json()) as { sessionId: string };
      // 行随首事件落库——等无过滤清单见本会话（红因锁定在键断言非时序）
      await until(() => rt.persistence.store.listSessions().some((row) => row.id === ack.sessionId));
      // 断言：按 canonical 根查询必须命中（修前 raw 别名键落库 → miss → 红）
      const hit = rt.persistence.store
        .listSessions({ workspaceRoot: canonical })
        .find((row) => row.id === ack.sessionId);
      expect(hit, `canonical=${canonical} 键下未见会话 ${ack.sessionId}`).toBeDefined();
    } finally {
      await handle.stop(); // closer 幂等——rt.shutdown 内二次 stop 无害
      await rt.shutdown();
    }
  });

  it('分立律：WebuiBridgeOptions.cwd 只透传 createServeBridge（会话登记键）——不流向 mountKit.mountOnFace（@ 补全锚恒挂载缺省全局态）', async () => {
    // 锁「有意分立」为机器执法（f-2 验收批）：两锚各键各源——会话登记锚
    // （本键，CL-A2）与补全列举锚（WebuiFaceMountOptions.cwd）互不串流。
    // spy kit 捕 mountOnFace 实收 options：staticDir 在场形实参恰
    // { staticDir } 单键——cwd 键不在（若未来统一两锚〔透传形〕本锁先红，
    // 红即提醒同步更新两处 JSDoc/注释与本锁——有意/意外分立由此可区分）。
    const rt = createHostRuntime({ dataDir: rigDir('a2-webui-split-') });
    const { stack } = rigStack(rt);
    const received: Array<{ staticDir?: string } | undefined> = [];
    const mountKit: WebuiMountKit = {
      mountOnFace: (face, opts) => {
        received.push(opts);
        // 真身照常挂（面 start/stop 全链不因 spy 而缺挂载）
        return mountWebuiOnFace({
          stack,
          face,
          ...(opts?.staticDir !== undefined ? { staticDir: opts.staticDir } : {}),
        });
      },
    };
    const handle = await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      cwd: '/nondefault/registration/anchor', // 非缺省登记锚注入——若串流必现于 mountOnFace 实参
      staticDir: '/tmp/webui-static-override', // 在场形：mountOnFace 实参当为恰 { staticDir } 单键
      mountKit,
      disclose: () => undefined, // 测试态 stderr 静默
    });
    try {
      expect(received).toHaveLength(1);
      // toEqual 精确键集匹配：实参多出 cwd 键即红（分立律核心断言）
      expect(received[0]).toEqual({ staticDir: '/tmp/webui-static-override' });
    } finally {
      await handle.stop(); // closer 幂等——rt.shutdown 内二次 stop 无害
      await rt.shutdown();
    }
  });
});

/* ---------------- completion 面接线（@ 文件段补全——TUI 同源源真身注入） ---------------- */

describe('completion 面接线：workspaceFiles = FileMentionSource replacement 直出', () => {
  /**
   * 隔离工作区造法（真目录真文件）：sub/ 目录（目录优先锚）+ 空白路径文件
   * （引号形锚）+ .git/ 内脏（含一文件——跳过锚：内脏非空仍不可见）+ 两常
   * 规文件（字典序锚）。realpath 起底——canonical 锚与真身同址（macOS
   * /var → /private/var 符号链消歧）。
   */
  function filesRig(): string {
    const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'webui-files-')));
    dirs.push(root);
    mkdirSync(join(root, 'sub'));
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, 'alpha.ts'), 'export {};\n');
    writeFileSync(join(root, 'beta.md'), '# beta\n');
    writeFileSync(join(root, 'my file.txt'), '空白路径文件\n');
    writeFileSync(join(root, '.git', 'config'), '[core]\n');
    return root;
  }

  it('e2e：GET /api/workspace/files 回 replacement 形条目（目录优先 + 引号形 + .git 跳过）；q=sub 前缀过滤', async () => {
    const wsRoot = filesRig();
    const rt = createHostRuntime({ dataDir: rigDir('webui-files-data-') });
    const { stack } = rigStack(rt);
    let opened: { port: number; token: string } | undefined;
    await openWebuiFace({
      stack,
      runtime: rt,
      port: 0,
      mountKit: mountKitOf(stack, undefined, wsRoot), // kit 透传补全锚——隔离工作区形
      disclose: () => undefined, // 测试态 stderr 静默
      onOpen: (info) => {
        opened = info;
      },
    });
    try {
      // 空查询（q=''——裸 '@' 触发形）：列工作区根——唯一目录置顶 + 尾斜杠
      const root = await apiFetch(opened!.port, opened!.token, '/api/workspace/files?q=');
      expect(root.status).toBe(200);
      const items = (root.body as { items: string[] }).items;
      expect(items[0]).toBe('@sub/'); // 目录优先置顶 + 尾斜杠（续深语义）
      expect(items).toContain('@"my file.txt"'); // 空白路径引号形——整 token 直插单位
      expect(items.some((it) => it.startsWith('@.git'))).toBe(false); // 版本库内脏跳过
      // 前缀过滤（确定性全等）：q=sub → 恰 ['@sub/']
      const sub = await apiFetch(opened!.port, opened!.token, '/api/workspace/files?q=sub');
      expect(sub.status).toBe(200);
      expect((sub.body as { items: string[] }).items).toEqual(['@sub/']);
    } finally {
      await rt.shutdown();
    }
  });

  it('deps 直锁：completion.workspaceFiles 函数形 + replacement 条目；workspaceSymbols 键级缺席', async () => {
    const wsRoot = filesRig();
    const rt = createHostRuntime({ dataDir: rigDir('webui-files-deps-') });
    const { stack } = rigStack(rt);
    // 面不起监听——路由注册与桥真身不依赖 start（deps 消费位直取）
    const face = createSdkHttpFace({
      config: { tcp: { host: '127.0.0.1', port: 0 } },
      bridge: createServeBridge(stack, rt, { cwd: process.cwd() }),
    });
    const mount = mountWebuiOnFace({ stack, face, cwd: wsRoot });
    try {
      // workspaceFiles 函数形（面在场）——真询回 replacement 形条目
      expect(typeof mount.deps.completion!.workspaceFiles).toBe('function');
      expect(mount.deps.completion!.workspaceFiles!('sub')).toEqual(['@sub/']);
      // 键级诚实缺席（与整面缺席分立——全仓零实现零消费，不造符号索引）
      expect(mount.deps.completion!.workspaceSymbols).toBeUndefined();
    } finally {
      mount.detach();
      await rt.shutdown();
    }
  });

  it('daemon 直挂形（无 cwd）：workspaceFiles 仍在场（process.cwd canonical 兜底恒接线）', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-files-daemon-') });
    const { stack } = rigStack(rt);
    const face = createSdkHttpFace({
      config: { tcp: { host: '127.0.0.1', port: 0 } },
      bridge: createServeBridge(stack, rt, { cwd: process.cwd() }),
    });
    const mount = mountWebuiOnFace({ stack, face }); // daemon 形零参——缺省全局态锚
    try {
      expect(typeof mount.deps.completion!.workspaceFiles).toBe('function');
      // 真询不炸即可（锚 = 宿主树 canonical 根——内容随树面，不锚具体条目）
      expect(Array.isArray(mount.deps.completion!.workspaceFiles!(''))).toBe(true);
      expect(mount.deps.completion!.workspaceSymbols).toBeUndefined();
    } finally {
      mount.detach();
      await rt.shutdown();
    }
  });
});
