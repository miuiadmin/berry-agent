/**
 * host/webui-bridge 组合根测试——`--port` webui 一次性开面装配桥（批 12f-2c）。
 *
 * 组合根全栈惯例：真 conversation 栈（真盘真库 + faux provider 走真实
 * streamFn）+ 真 webui 服务端（node:http 真监听）+ fetch 真请求——18a 通报
 * 「compat 互证归 host 装配批」本件兑现（桥真身经服务端全链，词面独立律
 * 结构兼容双向互证）。mock 只停在模型层。
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import { fauxProvider } from '../llm/index.js';
import type { Provider } from '../llm/index.js';

import { createConversationStack } from './conversation-stack.js';
import { createHostRuntime } from './runtime.js';
import type { HostRuntime } from './runtime.js';
import { openWebuiFace } from './webui-bridge.js';

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

/** 微任务推进（write-behind 落账等待） */
function tick(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
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
      disclose: (line) => disclosed.push(line),
    });
    try {
      // createSession：真开驱动（零 I/O——行随首事件落库）
      const id = face.deps.sessions.createSession();
      expect(stack.manager.isOpen(id)).toBe(true);
      // 三档：open（内存册）→ missing（未知 id）
      expect(face.deps.sessions.sessionStateOf(id)).toBe('open');
      expect(face.deps.sessions.sessionStateOf('不存在')).toBe('missing');
      // listSessions：新建未落库不在持久册（零 I/O 承诺）——驱动落一事件后可见
      expect(face.deps.sessions.listSessions().some((s) => s.id === id)).toBe(false);
      stack.driverOf(id)!.session.append('turn/start', {});
      await rt.persistence.flush();
      const row = face.deps.sessions.listSessions().find((s) => s.id === id);
      expect(row).toBeDefined();
      expect(row!.title).toBeNull(); // 无标题 null（不造占位串）
      expect(row!.lastActivityAt).toBeGreaterThan(0);
      // closed 档：拆解后持久册仍见（已闭只读兜底判据；dispose 幂等——rt.shutdown
      // 的 manager closer 再跑无害）
      stack.manager.dispose();
      expect(face.deps.sessions.sessionStateOf(id)).toBe('closed');
    } finally {
      await rt.shutdown(); // closer 内含 webui stop
    }
    // 披露两行：URL + token 一次性
    expect(disclosed.some((l) => l.includes('http://127.0.0.1:'))).toBe(true);
    expect(disclosed.some((l) => l.includes('仅此一次显示'))).toBe(true);
  });

  it('submitPrompt 全链 + fetchMessages 投影 + todoOf 两态', async () => {
    const rt = createHostRuntime({ dataDir: rigDir('webui-bridge-data-') });
    const { faux, stack } = rigStack(rt);
    const face = await openWebuiFace({ stack, runtime: rt, port: 0, disclose: () => undefined });
    try {
      const id = face.deps.sessions.createSession();
      faux.setResponses([() => messageOf()]);
      // submitPrompt：fire-and-forget 受理（回执经信封——投影轮询达终态）
      const outcome = face.deps.sessions.submitPrompt({ sessionId: id, content: '你好', messageId: 'm-1' });
      expect(outcome).toEqual({ sessionId: id });
      const projection = await face.deps.read.fetchMessages(id);
      // 中途投影已含 user 消息；应答终态轮询投影（faux 全链毫秒级，有界）
      expect(projection.some((m) => m.role === 'user' && m.content === '你好')).toBe(true);
      await until(async () => (await face.deps.read.fetchMessages(id)).some((m) => m.role === 'assistant'));
      const settled = await face.deps.read.fetchMessages(id);
      expect(settled.some((m) => m.role === 'assistant')).toBe(true); // 全链达 faux 模型
      // todoOf：无 todo 事件 = 空表（fold 空事件得 []）；无驱动 = undefined
      expect(face.deps.read.todoOf?.(id)).toEqual([]);
      expect(face.deps.read.todoOf?.('不存在')).toBeUndefined();
      // interrupt 幂等（未知 id 静默）
      face.deps.sessions.interruptSession(id);
      face.deps.sessions.interruptSession('不存在');
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
});
