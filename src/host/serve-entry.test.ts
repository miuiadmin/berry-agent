/**
 * host/serve-entry 组合根测试——serve stdio 宿主全环（真盘真库 + faux
 * provider + PassThrough 传输对——mock 只停在模型层）。
 *
 * 钉死：--daemon 诚实拒 / prompt 新会话全环（ack→直播事件流）+ 显式会话
 * 续接 / 幂等 admit（同键重发 duplicate 收执 + durable 单条）/ hello 重放
 * （entries→replay-end 衔接）/ 游标越界拒 / sessions·getEntries 读面 /
 * --no-delta 宿主立场缺省（message_update 剥、message_end 留）/ EOF 优雅
 * 退 0 / 坏行跳过不断连 / 版本不符先应答后置闭 / 心跳装配层定时驱动。
 *
 * 断言只对线面帧与行为（禁断言 AI 生成文本——事件类型与结构位为准）。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import type { AssistantMessage as PiAssistantMessage } from '@earendil-works/pi-ai';

import type { SdkWireFrame } from '../channels/index.js';
import { decodeWireLine } from '../channels/index.js';
import { fauxProvider } from '../llm/index.js';
import type { Provider } from '../llm/index.js';

import { runServeEntry } from './serve-entry.js';
import type { ServeFlags } from './cli.js';

/* ---------------- 测试基建 ---------------- */

/** 零用量 */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };

/** faux 响应脚本件（pi-ai 面形状——'ok' 文本终态） */
function messageOf(): PiAssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'ok' }],
    usage: NO_USAGE,
    stopReason: 'stop',
    timestamp: 1,
  } as unknown as PiAssistantMessage;
}

/** 线传输对（PassThrough 双向——出站行聚帧账） */
class WireRig {
  readonly input = new PassThrough();
  readonly output = new PassThrough();
  /** 已解码出站帧账（只收完整行） */
  readonly frames: SdkWireFrame[] = [];
  private text = '';

  constructor() {
    this.output.on('data', (chunk: string) => {
      this.text += chunk;
      const lines = this.text.split('\n');
      this.text = lines.pop() ?? ''; // 尾段 = 未完行留待下轮
      for (const line of lines) {
        if (line.length > 0) this.frames.push(decodeWireLine(line) as SdkWireFrame);
      }
    });
  }

  /** 发一行请求（对象直写） */
  send(req: object): void {
    this.input.write(`${JSON.stringify(req)}\n`);
  }

  /** 发裸行（坏行注入） */
  sendRaw(line: string): void {
    this.input.write(`${line}\n`);
  }

  /** 轮询直至谓词成立（行为断言统一等待位） */
  async until(pred: () => boolean, ms = 4_000): Promise<void> {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error(`until 超时：帧序 ${JSON.stringify(this.frames.map((f) => f.kind))}`);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }

  /** 收线（EOF 语义） */
  end(): void {
    this.input.end();
  }
}

/** 临时目录账（afterAll 清场） */
const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** serve 速记（faux provider 预脚本 + PassThrough 传输对；cwd 锚临时目录） */
function rigServe(flags: Partial<ServeFlags> = {}, heartbeatIntervalMs?: number) {
  const faux = fauxProvider({ provider: 'faux-serve', models: [{ id: 'm1' }] });
  faux.setResponses([() => messageOf(), () => messageOf(), () => messageOf(), () => messageOf()]); // 多轮余量
  const dataDir = mkdtempSync(join(tmpdir(), 'serve-data-'));
  dirs.push(dataDir);
  const rig = new WireRig();
  const providers: readonly Provider[] = [faux.provider];
  const entry = runServeEntry({
    flags: { debug: false, daemon: false, noDelta: false, ...flags },
    io: rig,
    dataDir,
    cwd: mkdtempSync(join(tmpdir(), 'serve-ws-')), // 新会话工作区根锚（不追踪清场——数据目录已隔离）
    providers,
    model: 'faux-serve/m1', // faux-only 运行时必须点名模型（缺省解析 anthropic 档必失败）
    env: {},
    ...(heartbeatIntervalMs !== undefined ? { heartbeatIntervalMs } : {}),
  });
  return { rig, entry, faux };
}

/** 收场：EOF 后 entry 落 0（行为测试统一退出位——不留悬挂定时器） */
async function closeExpect0(rig: WireRig, entry: Promise<number>): Promise<void> {
  rig.end();
  await expect(entry).resolves.toBe(0);
}

/* ---------------- 测试面 ---------------- */

describe('runServeEntry 装配序与旗标', () => {
  it('--daemon 诚实拒：退 1 不组装运行时（HTTP 面归 13e——不静默吞）', async () => {
    const faux = fauxProvider({ provider: 'faux-daemon', models: [{ id: 'm1' }] });
    const dataDir = mkdtempSync(join(tmpdir(), 'serve-data-'));
    dirs.push(dataDir);
    const rig = new WireRig();
    const entry = runServeEntry({
      flags: { debug: false, daemon: true, noDelta: false },
      io: rig,
      dataDir,
      providers: [faux.provider],
      model: 'faux-daemon/m1',
      env: {},
    });
    await expect(entry).resolves.toBe(1);
    expect(rig.frames).toEqual([]); // 零帧出站——拒在传输环装配前
  });

  it('EOF 收线：空连接直退 0（优雅档——不留悬挂）', async () => {
    const { rig, entry } = rigServe();
    await closeExpect0(rig, entry);
  });
});

describe('prompt 受理全环（fresh 新建 + 直播事件流）', () => {
  it('新会话：ack 携句柄与 followUp 观察 → agent 全程直播帧流（含 message_update 正控）', async () => {
    const { rig, entry } = rigServe();
    rig.send({ verb: 'prompt', messageId: 'm-1', content: '问' });
    await rig.until(() => rig.frames.some((f) => f.kind === 'ack'));
    const ack = rig.frames.find((f) => f.kind === 'ack') as {
      sessionId: string;
      routedChannel?: string;
      duplicate: boolean;
    };
    expect(ack.sessionId).toBeTruthy();
    expect(ack.routedChannel).toBe('followUp'); // 新会话无在飞 run——受理时刻 idle
    expect(ack.duplicate).toBe(false);
    // 直播腿：agent 全程事件帧（事件类型结构位断言——不断言生成文本）
    await rig.until(() => rig.frames.some((f) => f.kind === 'event' && f.event.type === 'agent_end'));
    const eventTypes = rig.frames.filter((f) => f.kind === 'event').map((f) => f.event.type);
    expect(eventTypes).toContain('agent_start');
    expect(eventTypes).toContain('message_update'); // delta 缺省开（①正控——noDelta 测试的反面对照）
    expect(eventTypes).toContain('message_end');
    // 显式会话续接：同 sessionId 二发 → 同会话句柄
    rig.send({ verb: 'prompt', sessionId: ack.sessionId, messageId: 'm-2', content: '再问' });
    await rig.until(() => rig.frames.filter((f) => f.kind === 'ack').length >= 2);
    const ack2 = rig.frames.filter((f) => f.kind === 'ack')[1] as { sessionId: string };
    expect(ack2.sessionId).toBe(ack.sessionId);
    await closeExpect0(rig, entry);
  });

  it('幂等 admit：同 messageId 同内容重发 → duplicate 收执 + durable 单条（05 §3.5 第二腿）', async () => {
    const { rig, entry } = rigServe();
    rig.send({ verb: 'prompt', messageId: 'm-1', content: '问' });
    await rig.until(() => rig.frames.some((f) => f.kind === 'event' && f.event.type === 'agent_end'));
    const sid = (rig.frames.find((f) => f.kind === 'ack') as { sessionId: string }).sessionId;
    // 连接内快速档：同键同内容重发 → duplicate 收执（零二次提交）
    const beforeCalls = 0;
    rig.send({ verb: 'prompt', sessionId: sid, messageId: 'm-1', content: '问' });
    await rig.until(() => {
      const acks = rig.frames.filter((f) => f.kind === 'ack');
      return acks.length >= 2 && (acks.at(-1) as { duplicate: boolean }).duplicate === true;
    });
    expect(beforeCalls).toBe(0); // 占位语义位（调用计数以 durable 条数为断言锚——下行）
    // durable 查证：entries 面同键 user/message 恰一 + 载荷落 dedupeKey/归因
    //（since 语义 = 已收末 seq——−1 哨兵从头取全窗〔cursor.ts resolveLiveStart 同款〕）
    rig.send({ verb: 'getEntries', sessionId: sid, since: -1 });
    await rig.until(() => rig.frames.some((f) => f.kind === 'entries'));
    const entries = (
      rig.frames.find((f) => f.kind === 'entries') as {
        entries: Array<{ type: string; data: Record<string, unknown> }>;
      }
    ).entries;
    const userMsgs = entries.filter((e) => e.type === 'user/message');
    expect(userMsgs).toHaveLength(1);
    expect(userMsgs[0]?.data).toMatchObject({ dedupeKey: 'm-1', source: 'channel:sdk' });
    await closeExpect0(rig, entry);
  });

  it('--no-delta 宿主立场缺省：message_update 剥、message_end 留（07 §5）', async () => {
    const { rig, entry } = rigServe({ noDelta: true });
    rig.send({ verb: 'prompt', messageId: 'm-1', content: '问' });
    await rig.until(() => rig.frames.some((f) => f.kind === 'event' && f.event.type === 'agent_end'));
    const eventTypes = rig.frames.filter((f) => f.kind === 'event').map((f) => f.event.type);
    expect(eventTypes).not.toContain('message_update'); // 退订增量降流量档
    expect(eventTypes).toContain('message_end'); // 整消息事件仍在（定稿锚定帧）
    await closeExpect0(rig, entry);
  });
});

describe('订阅重放与读面动词', () => {
  it('hello after=0 重放：entries 全窗 + replay-end 衔接（lastReplayedSeq = 末条 seq）', async () => {
    const { rig, entry } = rigServe();
    rig.send({ verb: 'prompt', messageId: 'm-1', content: '问' });
    await rig.until(() => rig.frames.some((f) => f.kind === 'event' && f.event.type === 'agent_end'));
    const sid = (rig.frames.find((f) => f.kind === 'ack') as { sessionId: string }).sessionId;
    rig.send({ verb: 'hello', protocolVersion: 1, sessionId: sid, after: -1 }); // −1 = 从头哨兵（未收任何——全窗重放）
    await rig.until(() => rig.frames.some((f) => f.kind === 'replay-end'));
    const entries = rig.frames.find((f) => f.kind === 'entries') as { entries: Array<{ seq: number }> };
    const replayEnd = rig.frames.find((f) => f.kind === 'replay-end') as { lastReplayedSeq: number };
    expect(entries.entries.length).toBeGreaterThan(0);
    // 衔接不变式：replay-end 尾 = entries 末条 seq（重放-直播无缝——05 §3.5）
    expect(replayEnd.lastReplayedSeq).toBe(entries.entries.at(-1)!.seq);
    await closeExpect0(rig, entry);
  });

  it('hello after ≥ 高水位 → SDK_CURSOR_INVALID（崩溃对账尾截断侦测）', async () => {
    const { rig, entry } = rigServe();
    rig.send({ verb: 'prompt', messageId: 'm-1', content: '问' });
    await rig.until(() => rig.frames.some((f) => f.kind === 'event' && f.event.type === 'agent_end'));
    const sid = (rig.frames.find((f) => f.kind === 'ack') as { sessionId: string }).sessionId;
    rig.send({ verb: 'hello', protocolVersion: 1, sessionId: sid, after: 99_999 });
    await rig.until(() => rig.frames.some((f) => f.kind === 'error'));
    expect(rig.frames.find((f) => f.kind === 'error')).toMatchObject({ code: 'SDK_CURSOR_INVALID' });
    await closeExpect0(rig, entry);
  });

  it('sessions 清单：含本连接会话（id/标题空档 null/末活动时间）', async () => {
    const { rig, entry } = rigServe();
    rig.send({ verb: 'prompt', messageId: 'm-1', content: '问' });
    await rig.until(() => rig.frames.some((f) => f.kind === 'event' && f.event.type === 'agent_end'));
    const sid = (rig.frames.find((f) => f.kind === 'ack') as { sessionId: string }).sessionId;
    rig.send({ verb: 'sessions' });
    await rig.until(() => rig.frames.some((f) => f.kind === 'sessions'));
    const frame = rig.frames.find((f) => f.kind === 'sessions') as {
      sessions: Array<{ id: string; title: string | null; lastActivityAt: number }>;
    };
    const row = frame.sessions.find((s) => s.id === sid);
    expect(row).toBeDefined();
    expect(row!.title).toBeNull(); // 无标题不造占位串
    expect(row!.lastActivityAt).toBeGreaterThan(0);
    await closeExpect0(rig, entry);
  });

  it('getEntries 窗口过滤：since=1 排除首条（(since, 高水位) 开区间）', async () => {
    const { rig, entry } = rigServe();
    rig.send({ verb: 'prompt', messageId: 'm-1', content: '问' });
    await rig.until(() => rig.frames.some((f) => f.kind === 'event' && f.event.type === 'agent_end'));
    const sid = (rig.frames.find((f) => f.kind === 'ack') as { sessionId: string }).sessionId;
    rig.send({ verb: 'getEntries', sessionId: sid, since: -1 }); // 从头全窗
    await rig.until(() => rig.frames.some((f) => f.kind === 'entries'));
    const all = (rig.frames.find((f) => f.kind === 'entries') as { entries: Array<{ seq: number }> }).entries;
    rig.frames.length = 0;
    rig.send({ verb: 'getEntries', sessionId: sid, since: 1 }); // 已收末 seq=1 → 窗 (1, 高水)
    await rig.until(() => rig.frames.some((f) => f.kind === 'entries'));
    const windowed = (rig.frames.find((f) => f.kind === 'entries') as { entries: Array<{ seq: number }> }).entries;
    expect(windowed.map((e) => e.seq)).toEqual(all.filter((e) => e.seq > 1).map((e) => e.seq));
    await closeExpect0(rig, entry);
  });
});

describe('传输环鲁棒位', () => {
  it('坏行跳过不断连：解码失败行后健康请求照常受理', async () => {
    const { rig, entry } = rigServe();
    rig.sendRaw('{"broken":'); // 截断 JSON——解码失败
    rig.sendRaw('{"kind":"hello"}'); // 帧形行（服务端只受理请求行）
    rig.send({ verb: 'sessions' });
    await rig.until(() => rig.frames.some((f) => f.kind === 'sessions'));
    await closeExpect0(rig, entry);
  });

  it('版本不符：先应答 SDK_PROTOCOL_MISMATCH 后置闭——残行同码重申', async () => {
    const { rig, entry } = rigServe();
    rig.send({ verb: 'hello', protocolVersion: 99 });
    await rig.until(() => rig.frames.some((f) => f.kind === 'error'));
    expect(rig.frames[0]).toMatchObject({ kind: 'error', code: 'SDK_PROTOCOL_MISMATCH' });
    rig.frames.length = 0;
    rig.send({ verb: 'sessions' }); // 残行——同码直写重申
    await rig.until(() => rig.frames.length >= 1);
    expect(rig.frames[0]).toMatchObject({ kind: 'error', code: 'SDK_PROTOCOL_MISMATCH' });
    await closeExpect0(rig, entry);
  });

  it('心跳装配层定时驱动：静默超阈补拍 heartbeat 帧（03 §10.6 ②协议义务）', async () => {
    const { rig, entry } = rigServe({}, 25); // 测试提速节拍
    rig.send({ verb: 'prompt', messageId: 'm-1', content: '问' });
    await rig.until(() => rig.frames.some((f) => f.kind === 'event' && f.event.type === 'agent_end'));
    rig.frames.length = 0;
    await rig.until(() => rig.frames.some((f) => f.kind === 'heartbeat'), 2_000);
    await closeExpect0(rig, entry);
  });
});
