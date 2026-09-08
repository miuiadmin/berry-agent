/**
 * agent/queue 测试 — PendingMessageQueue 双轴（04 §4：取件策略轴 + 容量溢出策略轴）。
 *
 * 覆盖：one-at-a-time/all 取件、drop-oldest 溢出（被丢项回执）、bounded 溢出
 * （拒新回执）、capacity 非法拒构造、mode 运行期调整、clear 回执。
 */
import { describe, it, expect } from 'vitest';
import { PendingMessageQueue } from './queue.js';
import type { AgentMessage } from '../contracts/index.js';
import type { DeliverChannel } from './events.js';

/** 测试消息构造（同引用断言用——不复制） */
function msg(n: number): AgentMessage {
  return { role: 'user', content: `m${n}`, timestamp: n };
}

/** 入列三件（channel 恒 followUp——队列不裁通道只暂存） */
const ch: DeliverChannel = 'followUp';

describe('PendingMessageQueue 取件策略轴', () => {
  it('one-at-a-time 缺省：一次取一件、FIFO', () => {
    const q = new PendingMessageQueue();
    q.enqueue(msg(1), ch);
    q.enqueue(msg(2), ch);
    expect(q.mode).toBe('one-at-a-time');
    const first = q.drain();
    expect(first).toHaveLength(1);
    expect(first[0]!.message.content).toBe('m1');
    expect(q.size).toBe(1);
    expect(q.hasItems()).toBe(true);
  });

  it('all 合批：全取清空 + mode 运行期调整', () => {
    const q = new PendingMessageQueue();
    q.enqueue(msg(1), ch);
    q.enqueue(msg(2), ch);
    q.mode = 'all';
    const all = q.drain();
    expect(all).toHaveLength(2);
    expect(q.size).toBe(0);
    // drain 空队列：空数组不抛
    expect(q.drain()).toEqual([]);
  });

  it('条目携带通道判定与入列时间戳', () => {
    const q = new PendingMessageQueue();
    q.enqueue(msg(1), 'steer');
    const [item] = q.drain();
    expect(item!.channel).toBe('steer');
    expect(typeof item!.enqueuedAt).toBe('number');
  });

  it('backgroundWake 位随条目入列/取件透传（三通道标记——04 §4 唤醒合批与预算的载体）', () => {
    const q = new PendingMessageQueue();
    q.enqueue(msg(1), 'steer', { backgroundWake: true });
    q.enqueue(msg(2), 'steer');
    const [wake, plain] = [q.drain()[0]!, q.drain()[0]!];
    expect(wake.backgroundWake).toBe(true);
    expect(plain.backgroundWake).toBeUndefined();
    // 被丢/被拒回执项同载位（丢弃面不丢标记）
    const bounded = new PendingMessageQueue({ capacity: 1, overflowPolicy: 'bounded' });
    bounded.enqueue(msg(3), 'steer');
    const receipt = bounded.enqueue(msg(4), 'steer', { backgroundWake: true });
    expect(receipt.dropped?.backgroundWake).toBe(true);
  });
});

describe('PendingMessageQueue 容量溢出策略轴', () => {
  it('drop-oldest 缺省：到帽丢队首、被丢项回执', () => {
    const q = new PendingMessageQueue({ capacity: 2 });
    q.enqueue(msg(1), ch);
    q.enqueue(msg(2), ch);
    const receipt = q.enqueue(msg(3), ch);
    expect(receipt.accepted).toBe(true);
    // 被丢的是队首 m1——丢弃可见（回执面不静默）
    expect(receipt.dropped?.message.content).toBe('m1');
    expect(q.size).toBe(2);
    q.mode = 'all'; // 全取核账（缺省 one-at-a-time 只取一件——两轴各证各的）
    const drained = q.drain();
    expect(drained.map((i) => i.message.content)).toEqual(['m2', 'm3']);
  });

  it('bounded：到帽拒新、被拒项回执', () => {
    const q = new PendingMessageQueue({ capacity: 1, overflowPolicy: 'bounded' });
    q.enqueue(msg(1), ch);
    const receipt = q.enqueue(msg(2), ch);
    expect(receipt.accepted).toBe(false);
    expect(receipt.dropped?.message.content).toBe('m2'); // 被拒项原样回执
    expect(q.size).toBe(1);
  });

  it('capacity 非法拒构造（空队列是死配置）', () => {
    expect(() => new PendingMessageQueue({ capacity: 0 })).toThrow(RangeError);
    expect(() => new PendingMessageQueue({ capacity: 1.5 })).toThrow(RangeError);
  });

  it('clear 清空并回执被清条目', () => {
    const q = new PendingMessageQueue();
    q.enqueue(msg(1), ch);
    q.enqueue(msg(2), ch);
    const cleared = q.clear();
    expect(cleared).toHaveLength(2);
    expect(q.size).toBe(0);
  });
});

describe('PendingMessageQueue 撤回关联键与在队撤回（e-4 withdraw——03 §2.2 第十一面）', () => {
  it('id 位随 enqueue 入列透传、取件随条目带出', () => {
    const q = new PendingMessageQueue();
    q.enqueue(msg(1), ch, { id: 'msg-1' });
    q.enqueue(msg(2), ch); // 普通件无 id 位
    q.mode = 'all';
    const [first, second] = q.drain();
    expect(first?.id).toBe('msg-1');
    expect(second?.id).toBeUndefined();
  });

  it('withdraw 命中移除在队件（保序余件）、不在队返 undefined', () => {
    const q = new PendingMessageQueue();
    q.enqueue(msg(1), ch, { id: 'msg-1' });
    q.enqueue(msg(2), ch, { id: 'msg-2' });
    q.enqueue(msg(3), ch, { id: 'msg-3' });
    const removed = q.withdraw('msg-2');
    expect(removed?.id).toBe('msg-2');
    expect(removed?.message.content).toBe('m2');
    expect(q.size).toBe(2);
    // 命中件是队中段——余件 FIFO 序不变
    q.mode = 'all';
    const drained = q.drain();
    expect(drained.map((i) => i.message.content)).toEqual(['m1', 'm3']);
    // 不在队（已出队被消费/从未入列/已被溢出丢弃）→ undefined（诚实缺席）
    expect(q.withdraw('msg-2')).toBeUndefined();
    expect(q.withdraw('never-enqueued')).toBeUndefined();
  });
});
