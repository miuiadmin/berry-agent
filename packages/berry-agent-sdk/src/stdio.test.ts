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
 * 错误帧〕、getEntries 常规〔's-missing' 回错误帧——事务自身错误锁〕、sessions
 * 常规、interrupt 静默〔's-missing' 异步回无主 error 帧——对齐宿主 wire-core〕。
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
    if (req.sessionId === 's-missing') {
      // 会话域错误帧恒携请求 sessionId（对齐宿主 wire-core emitError 纪律——
      // handleHello/handleGetEntries/handleInterrupt 三位同携）
      out({ kind: 'error', code: 'SESSION_NOT_FOUND', message: '会话 ' + req.sessionId + ' 不存在', sessionId: req.sessionId });
      return;
    }
    out({ kind: 'hello', protocolVersion: req.protocolVersion, sessionId: req.sessionId, highWaterSeq: 3 });
    out({ kind: 'entries', sessionId: req.sessionId, entries: [{ type: 'user/message', seq: 1, time: 1, data: {} }], lastSeq: 2 });
    out({ kind: 'replay-end', sessionId: req.sessionId, lastReplayedSeq: 2 });
    setTimeout(() => out({ kind: 'event', seq: 3, sessionId: req.sessionId, event: { type: 'turn_end', turn: 1, stopReason: 'end_turn' } }), 40);
  } else if (req.verb === 'getEntries') {
    // missing 会话错误应答（对齐宿主 wire-core handleGetEntries——事务自身错误帧锁）
    if (req.sessionId === 's-missing') {
      out({ kind: 'error', code: 'SESSION_NOT_FOUND', message: '会话 ' + req.sessionId + ' 不存在', sessionId: req.sessionId });
      return;
    }
    out({ kind: 'entries', sessionId: req.sessionId, entries: [], lastSeq: 0 });
  } else if (req.verb === 'sessions') {
    out({ kind: 'sessions', sessions: [] });
  } else if (req.verb === 'interrupt') {
    // 无应答档失败形：missing 会话异步回无主 error 帧（对齐宿主 wire-core
    // handleInterrupt——SESSION_NOT_FOUND 携 sessionId；成功形静默无帧）。
    // s-ghost = 可订阅但 interrupt 失败的会话（多订阅锚路由后，吸收路由的
    // onFrame 可观察性须同会话在订——跨会话投递即 sweep10 件2 所修改道形）
    if (req.sessionId === 's-missing' || req.sessionId === 's-ghost') {
      out({ kind: 'error', code: 'SESSION_NOT_FOUND', message: '会话 ' + req.sessionId + ' 不存在', sessionId: req.sessionId });
    }
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

/**
 * 应答机变体（sweep10 件2 多订阅三形锁用）：连接级握手 + 任意会话可订阅
 * （hello→replay-end 两帧即建立、无重放无延迟直播）；getEntries 应答前置投
 * 一发该会话的直播 event 帧（携带请求会话锚——直播帧触发器：事务应答与订阅
 * 面投递在线序上交错，deliver 逐行处理保序）。s-missing 同主应答机（hello
 * 即错——订阅失败形）。
 */
const MULTI_SUB_SCRIPT = `
const rl = require('node:readline').createInterface({ input: process.stdin });
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
rl.on('line', (line) => {
  let req; try { req = JSON.parse(line); } catch { return; }
  if (req.verb === 'hello') {
    if (req.sessionId === undefined) {
      out({ kind: 'hello', protocolVersion: req.protocolVersion, sessionId: '', highWaterSeq: 0 });
      return;
    }
    if (req.sessionId === 's-missing') {
      out({ kind: 'error', code: 'SESSION_NOT_FOUND', message: '会话 ' + req.sessionId + ' 不存在', sessionId: req.sessionId });
      return;
    }
    out({ kind: 'hello', protocolVersion: req.protocolVersion, sessionId: req.sessionId, highWaterSeq: 1 });
    out({ kind: 'replay-end', sessionId: req.sessionId, lastReplayedSeq: 0 });
    return;
  }
  if (req.verb === 'getEntries') {
    out({ kind: 'event', seq: 1, sessionId: req.sessionId, event: { type: 'turn_end', turn: 1, stopReason: 'end_turn' } });
    out({ kind: 'entries', sessionId: req.sessionId, entries: [], lastSeq: 0 });
    return;
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

  it('send 档无主 error 帧吸收：interrupt missing 会话后紧接正当事务拿到自己的应答（修前串味红）', async () => {
    const warns: string[] = [];
    const transport = rig((m) => warns.push(m));
    try {
      const client = createSdkClient(transport);
      // interrupt 失败形：服务端异步回无主 error 帧（FIFO 先于 getEntries 应答到线）
      await client.interrupt('s-missing');
      // 修前：该帧落进紧随事务期望集（恒含 'error'）——getEntries 吃到别人的
      // SESSION_NOT_FOUND、真应答帧静默丢（reject 红出）
      const frame = await withDeadline(client.getEntries({ sessionId: 's-1' }));
      expect(frame).toMatchObject({ kind: 'entries', sessionId: 's-1' });
      // 吸收可观察：诊断面 warn 一行（无主帧不入事务）
      expect(warns.join('\n')).toContain('无主 error 帧吸收');
    } finally {
      await transport.close();
    }
  });

  it('无主 error 帧路由订阅面：吸收后 onFrame 可观察（interrupt 错误经事件流可观察契约）', async () => {
    const transport = rig();
    try {
      const seen: string[] = [];
      // s-ghost = 可订阅但 interrupt 失败的会话——多订阅按会话锚路由后，错误帧
      // 只投该会话在订者（跨会话投递即件2 所修改道形），可观察性锁在同会话在订形
      const handle = await transport.openLive({ sessionId: 's-ghost' }, (frame) => seen.push(frame.kind));
      const client = createSdkClient(transport);
      await client.interrupt('s-ghost');
      const frame = await withDeadline(client.getEntries({ sessionId: 's-1' }));
      expect(frame.kind).toBe('entries');
      // 吸收路由进订阅监听面（types.ts send 契约：错误帧走 onFrame 面）
      expect(seen).toContain('error');
      await handle.close();
    } finally {
      await transport.close();
    }
  });

  it('吸收位不误伤事务自身错误：armed 窗内同会话 error 应答照常归属（无悬挂回归锁）', async () => {
    const transport = rig();
    try {
      const client = createSdkClient(transport);
      await client.interrupt('s-1'); // 成功 interrupt：服务端静默——吸收位在飞空守
      // 事务自身错误帧（sessionId 同锚）须照常回属——吸收只吃无主帧，不吞
      // 正当应答（否则事务永挂——比串味更劣的回归形）
      const frame = await withDeadline(transport.request({ verb: 'getEntries', sessionId: 's-missing', since: -1 }));
      expect(frame).toMatchObject({ kind: 'error', code: 'SESSION_NOT_FOUND' });
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

  it('子进程终局：未完成的请求 fail-loud reject（SDK_TRANSPORT 含退出码）、串行链续走后即拒不挂', async () => {
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

describe('多订阅会话锚路由（sweep10 件2——修前三形锁：改道/死柄/连坐）', () => {
  it('双订阅各自收自己会话帧（修前：单槽覆写——A 的帧投 B，改道形）', async () => {
    const transport = spawnServeTransport({ args: ['-e', MULTI_SUB_SCRIPT] });
    try {
      const aSeen: string[] = [];
      const bSeen: string[] = [];
      await transport.openLive({ sessionId: 's-a' }, (frame) => aSeen.push(frame.kind));
      await transport.openLive({ sessionId: 's-b' }, (frame) => bSeen.push(frame.kind));
      // 触发 s-a 直播帧（应答机 getEntries 前置投 event）——修前 liveListener
      // 已被 B 覆写：A 的帧投 B、A 自己收不到（与 HTTP 形每流独立的能力漂移位）
      const client = createSdkClient(transport);
      await client.getEntries({ sessionId: 's-a' });
      expect(aSeen).toEqual(['replay-end', 'event']); // 修前红：A 收不到自己的帧
      expect(bSeen).toEqual(['replay-end']); // 修前红：B 吃到 A 的帧（改道）
    } finally {
      await transport.close();
    }
  });

  it('订阅失败回滚自己条目：B 失败后 A 仍收自己会话帧（修前：死柄残占）+ reject 携会话锚（件3：修前 undefined）', async () => {
    const transport = spawnServeTransport({ args: ['-e', MULTI_SUB_SCRIPT] });
    try {
      const aSeen: string[] = [];
      await transport.openLive({ sessionId: 's-a' }, (frame) => aSeen.push(frame.kind));
      // B 订阅失败（hello 应答 error 帧）——reject 须携会话锚（wire-core
      // emitError 纪律：会话域错误帧恒携请求 sessionId；修前缺第三参恒 undefined）
      await expect(transport.openLive({ sessionId: 's-missing' }, () => {})).rejects.toMatchObject({
        name: 'SdkError',
        code: 'SESSION_NOT_FOUND',
        sessionId: 's-missing',
      });
      // 修前：openLive 无条件覆写单槽后失败——槽位残占死柄，A 的帧投无主
      const client = createSdkClient(transport);
      await client.getEntries({ sessionId: 's-a' });
      expect(aSeen).toEqual(['replay-end', 'event']); // 修前红：A 的帧路被死柄占
    } finally {
      await transport.close();
    }
  });

  it('close 只清自己订阅条目：close B 后 A 仍收帧（修前：连坐清空全局槽）', async () => {
    const transport = spawnServeTransport({ args: ['-e', MULTI_SUB_SCRIPT] });
    try {
      const aSeen: string[] = [];
      const bHandle = await transport.openLive({ sessionId: 's-b' }, () => {});
      await transport.openLive({ sessionId: 's-a' }, (frame) => aSeen.push(frame.kind));
      // 修前：liveClose 清全局单槽——close B 连坐斩断 A 的帧路
      await bHandle.close();
      const client = createSdkClient(transport);
      await client.getEntries({ sessionId: 's-a' });
      expect(aSeen).toEqual(['replay-end', 'event']); // 修前红：A 帧路被 B 的 close 连坐
    } finally {
      await transport.close();
    }
  });
});
