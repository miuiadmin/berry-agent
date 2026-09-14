/**
 * stdio 传输测试（批 13f-3）——spawn 真实子进程（node -e 脚本应答机）：
 * 事务串行链帧归属、订阅两段建立（hello→replay-end resolve 位）、坏行跳过、
 * 反向帧跳过、send 无应答档、close/exited 终局。
 */
import { describe, expect, it } from 'vitest';

import { createSdkClient } from './client.js';
import { spawnServeTransport } from './stdio.js';
import type { SdkStdioTransport } from './stdio.js';
import { SDK_PROTOCOL_VERSION } from './types.js';
import { SdkError } from './types.js';

/**
 * 子进程应答机脚本：按动词回帧——prompt→ack〔messageId='m-bad' 时先吐坏行〕、
 * hello→hello+entries+replay-end+40ms 后直播 event〔sessionId='s-missing' 回
 * 错误帧〕、getEntries/sessions 常规、interrupt 静默（无应答档）。
 */
const RESPONDER_SCRIPT = `
const rl = require('node:readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let n = 0;
rl.on('line', (line) => {
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.verb === 'prompt') {
    if (req.messageId === 'm-bad') process.stdout.write('this is { not json\\n');
    out({ kind: 'ack', sessionId: req.sessionId ?? 's-1', messageId: req.messageId, duplicate: false, highWaterSeq: ++n });
  } else if (req.verb === 'hello') {
    if (req.sessionId === undefined) {
      // 连接级握手档（无会话订阅）——仅回 hello 帧（对齐宿主 wire-core 连接级档零订阅语义）
      out({ kind: 'hello', protocolVersion: req.protocolVersion, sessionId: '', highWaterSeq: 0 });
      return;
    }
    if (req.sessionId === 's-missing') { out({ kind: 'error', code: 'SESSION_NOT_FOUND', message: '无此会话' }); return; }
    out({ kind: 'hello', protocolVersion: req.protocolVersion, sessionId: req.sessionId, highWaterSeq: 3 });
    out({ kind: 'entries', sessionId: req.sessionId, entries: [{ type: 'user/message', seq: 1, time: 1, data: {} }], lastSeq: 2 });
    out({ kind: 'replay-end', sessionId: req.sessionId, lastReplayedSeq: 2 });
    setTimeout(() => out({ kind: 'event', seq: 3, sessionId: req.sessionId, event: { type: 'turn_end', turn: 1, stopReason: 'end_turn' } }), 40);
  } else if (req.verb === 'getEntries') {
    out({ kind: 'entries', sessionId: req.sessionId, entries: [], lastSeq: 0 });
  } else if (req.verb === 'sessions') {
    out({ kind: 'sessions', sessions: [] });
  }
});
`;

/** 建 spawned 应答机传输（缺省静默诊断） */
function rig(onWarn?: (m: string) => void): SdkStdioTransport {
  return spawnServeTransport({ args: ['-e', RESPONDER_SCRIPT], onWarn });
}

/**
 * 应答机变体：连接级握手正常应答，收到 prompt 即 exit(9) 不应答——
 * 「子进程终局时在飞事务 fail-loud」谱（修前红锚：现状在飞请求永挂）。
 */
const DIE_ON_PROMPT_SCRIPT = `
const rl = require('node:readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
rl.on('line', (line) => {
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.verb === 'hello' && req.sessionId === undefined) {
    out({ kind: 'hello', protocolVersion: req.protocolVersion, sessionId: '', highWaterSeq: 0 });
    return;
  }
  if (req.verb === 'prompt') process.exit(9); // 在飞期死亡——不应答
});
`;

/** 应答机变体：连接级握手回错配版本（999）——「版本错配 fail-loud 拒用传输」谱 */
const MISMATCH_SCRIPT = `
const rl = require('node:readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
rl.on('line', (line) => {
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.verb === 'hello') {
    out({ kind: 'hello', protocolVersion: 999, sessionId: '', highWaterSeq: 0 });
  } // 其余动词不应答（错配后传输应已拒用——不应再发）
});
`;

/** 应答机变体：首帧必须握手 hello——请求帧先到（无握手）即自毁 exit(5)（「握手先于任何请求帧」锁） */
const HANDSHAKE_FIRST_SCRIPT = `
const rl = require('node:readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
let sawHello = false;
rl.on('line', (line) => {
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.verb === 'hello' && req.sessionId === undefined) {
    sawHello = true;
    out({ kind: 'hello', protocolVersion: req.protocolVersion, sessionId: '', highWaterSeq: 0 });
    return;
  }
  if (!sawHello) process.exit(5); // 请求帧先于握手——违约自毁
  if (req.verb === 'prompt') {
    out({ kind: 'ack', sessionId: req.sessionId ?? 's-1', messageId: req.messageId, duplicate: false, highWaterSeq: 1 });
  }
});
`;

/** 等直播帧到齐（轮询 setImmediate/短眠——子进程异步面） */
async function waitFor(ready: () => boolean, budgetMs = 4000): Promise<void> {
  const start = Date.now();
  while (!ready()) {
    if (Date.now() - start > budgetMs) throw new Error('waitFor 超时');
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * 限期锚（fail-loud 断言用）：超期以 Error resolve——永挂形在 expects.rejects
 * 断言下即红（而非等测程超时兜底），修前红锚的可判形态。
 */
function withDeadline<T>(p: Promise<T>, ms = 2000): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => {
      const timer = setTimeout(() => resolve(new Error(`限期 ${ms}ms 内未落定（永挂形）`) as unknown as T), ms);
      timer.unref?.(); // 不持住进程句柄（测程收口干净）
    }),
  ]);
}

describe('spawnServeTransport stdio 传输', () => {
  it('prompt 请求档：ack 应答回属、连接级新建 sessionId 回执', async () => {
    const transport = rig();
    try {
      const client = createSdkClient(transport);
      const ack = await client.prompt({ messageId: 'm-1', content: '你好' });
      expect(ack).toMatchObject({ kind: 'ack', sessionId: 's-1', messageId: 'm-1', duplicate: false });
    } finally {
      await transport.close();
    }
  });

  it('并发两 prompt：串行链帧归属无歧义（各自 messageId 应答各自回）', async () => {
    const transport = rig();
    try {
      const client = createSdkClient(transport);
      const [a, b] = await Promise.all([
        client.prompt({ messageId: 'm-1', content: '一' }),
        client.prompt({ messageId: 'm-2', content: '二' }),
      ]);
      expect(a.messageId).toBe('m-1');
      expect(b.messageId).toBe('m-2');
      // 高水位随受理单调（应答机每笔自增——序即 FIFO）
      expect(b.highWaterSeq).toBeGreaterThan(a.highWaterSeq);
    } finally {
      await transport.close();
    }
  });

  it('坏行跳过不崩：坏行后的合法帧照常归属', async () => {
    const warns: string[] = [];
    const transport = rig((m) => warns.push(m));
    try {
      const client = createSdkClient(transport);
      const ack = await client.prompt({ messageId: 'm-bad', content: 'x' });
      expect(ack.messageId).toBe('m-bad');
      await waitFor(() => warns.some((m) => m.includes('坏行')));
      expect(warns.join('\n')).toContain('坏行跳过');
    } finally {
      await transport.close();
    }
  });

  it('订阅两段建立：hello 取高水位、replay-end 入监听面后 resolve、直播帧续入', async () => {
    const transport = rig();
    try {
      const seen: string[] = [];
      const handle = await transport.openLive({ sessionId: 's-1' }, (frame) => seen.push(frame.kind));
      // resolve 位 = replay-end 落定后：此刻监听面已收重放段〔entries+replay-end〕、
      // 未收 40ms 后的直播 event（时序承诺）
      expect(handle).toMatchObject({ sessionId: 's-1', highWaterSeq: 3 });
      expect(seen).toEqual(['entries', 'replay-end']);
      await waitFor(() => seen.includes('event'));
      expect(seen).toEqual(['entries', 'replay-end', 'event']);
      await handle.close(); // 幂等收口不误伤连接
      const client = createSdkClient(transport);
      const ack = await client.prompt({ messageId: 'm-1', content: '续用' });
      expect(ack.kind).toBe('ack');
    } finally {
      await transport.close();
    }
  });

  it('订阅失败：hello 应答错误帧 → 投形拒绝（SESSION_NOT_FOUND）', async () => {
    const transport = rig();
    try {
      await expect(transport.openLive({ sessionId: 's-missing' }, () => {})).rejects.toMatchObject({
        name: 'SdkError',
        code: 'SESSION_NOT_FOUND',
      });
    } finally {
      await transport.close();
    }
  });

  it('send 无应答档：interrupt 写后即决（应答机静默——无帧不挂）', async () => {
    const transport = rig();
    try {
      await transport.send({ verb: 'interrupt', sessionId: 's-1' }); // 不挂即过
      // 线仍可用（send 不占在队事务）
      const client = createSdkClient(transport);
      expect((await client.prompt({ messageId: 'm-1', content: 'x' })).kind).toBe('ack');
    } finally {
      await transport.close();
    }
  });

  it('请求档动词闭集执法：hello 走 request 档即拒（SDK_TRANSPORT）', async () => {
    const transport = rig();
    try {
      await expect(
        transport.request({ verb: 'hello', protocolVersion: SDK_PROTOCOL_VERSION, sessionId: 's-1' }),
      ).rejects.toBeInstanceOf(SdkError);
    } finally {
      await transport.close();
    }
  });

  it('close 收线：stdin EOF → 子进程自然退出 0、exited 落定、幂等', async () => {
    const transport = rig();
    await transport.close();
    await expect(transport.exited).resolves.toBe(0);
    await transport.close(); // 幂等
  });

  it('子进程终局：在飞事务 fail-loud reject（SDK_TRANSPORT 含退出码）、串行链续走后即拒不挂', async () => {
    const transport = spawnServeTransport({ args: ['-e', DIE_ON_PROMPT_SCRIPT] });
    try {
      const client = createSdkClient(transport);
      // 在飞请求限期落定（修前：子进程退出后在飞请求永挂——deadline 锚判红）
      await expect(withDeadline(client.prompt({ messageId: 'm-die', content: 'x' }))).rejects.toMatchObject({
        name: 'SdkError',
        code: 'SDK_TRANSPORT',
        message: expect.stringContaining('code=9') as unknown,
      });
      // 串行链续走：后续请求立即 fail-loud 拒（不永挂），报因同含退出码
      await expect(withDeadline(client.prompt({ messageId: 'm-next', content: 'x' }))).rejects.toMatchObject({
        name: 'SdkError',
        code: 'SDK_TRANSPORT',
        message: expect.stringContaining('code=9') as unknown,
      });
    } finally {
      await transport.close();
    }
  });

  it('建立即连接级握手：版本错配 → fail-loud 拒用传输（SDK_PROTOCOL_MISMATCH）', async () => {
    const transport = spawnServeTransport({ args: ['-e', MISMATCH_SCRIPT] });
    try {
      const client = createSdkClient(transport);
      // 修前：无握手——prompt 无应答永挂（deadline 锚判红）
      await expect(withDeadline(client.prompt({ messageId: 'm-1', content: 'x' }))).rejects.toMatchObject({
        name: 'SdkError',
        code: 'SDK_PROTOCOL_MISMATCH',
      });
      // 毒丸持续：其后一切事务面同错拒用（不挂、不静默互操作）
      await expect(withDeadline(client.sessions())).rejects.toMatchObject({ code: 'SDK_PROTOCOL_MISMATCH' });
    } finally {
      await transport.close();
    }
  });

  it('建立即连接级握手：握手先于任何请求帧（首帧非 hello 应答机即自毁）', async () => {
    const transport = spawnServeTransport({ args: ['-e', HANDSHAKE_FIRST_SCRIPT] });
    try {
      const client = createSdkClient(transport);
      // ack 到手即证明 hello 先行（若请求帧先到，应答机 exit(5) 自毁——prompt 永挂）
      const ack = await withDeadline(client.prompt({ messageId: 'm-1', content: 'x' }));
      expect(ack).toMatchObject({ kind: 'ack', messageId: 'm-1' });
    } finally {
      await transport.close();
    }
  });
});
