/**
 * agent 件 — PendingMessageQueue 待发队列（04 篇 §4：三通道的暂存与合批机制）。
 *
 * 两轴分立（本仓 vs berry 蓝本差异④——蓝本只有取件单轴）：
 *  - QueueMode 取件策略轴：one-at-a-time（缺省，一次取一件）/ all（合批——后台
 *    唤醒合批收窄工具面即此）；
 *  - overflowPolicy 容量溢出策略轴：drop-oldest（缺省，丢弃即回执可见不静默
 *    堆积）/ bounded（排到帽拒新并回执拒收）。
 * 队列是内存态：崩溃即丢——durable 真相只有已进 timeline 的消息（05 篇）。
 */

import type { AgentMessage } from '../contracts/index.js';
import type { DeliverChannel } from './events.js';

/** 取件策略轴（04 §4：一次取一件为缺省，合批多件是显式策略） */
export type QueueMode = 'one-at-a-time' | 'all';

/** 容量溢出策略轴（04 §4 定值：capacity 缺省 100、缺省策略 drop-oldest） */
export type OverflowPolicy = 'drop-oldest' | 'bounded';

/** 队列条目（消息 + 通道判定结果 + 入列时间戳——回执与诊断面用） */
export interface PendingItem {
  message: AgentMessage;
  channel: DeliverChannel;
  /** Unix 毫秒时间戳（入列时刻） */
  enqueuedAt: number;
}

/** enqueue 回执：accepted=false 时 dropped 载被拒/被丢项（回执面可见，不静默） */
export interface EnqueueReceipt {
  accepted: boolean;
  /** 被丢（drop-oldest）或被拒（bounded）的项 */
  dropped?: PendingItem;
}

/** 队列缺省容量帽（04 §4 定值——码面缺省参数非契约常数，channels 件可再裁） */
export const DEFAULT_QUEUE_CAPACITY = 100;

/**
 * 待发队列（机制件——通道判定在驱动侧 conversation，本件只司暂存与取件）。
 * mode 可运行期调整（合批窗口的开关）；capacity/overflowPolicy 构造期钉死
 * （溢出语义漂移属配置面变更，不开放热改）。
 */
export class PendingMessageQueue {
  /** 待发条目（FIFO；队首最旧） */
  private readonly items: PendingItem[] = [];
  /** 取件策略（可运行期调整） */
  private modeValue: QueueMode;
  /** 容量帽（构造期钉死） */
  private readonly capacityValue: number;
  /** 溢出策略（构造期钉死） */
  private readonly overflowValue: OverflowPolicy;

  /**
   * @param options.mode 取件策略（缺省 one-at-a-time）
   * @param options.capacity 容量帽（缺省 100；<1 拒构造——空队列是死配置）
   * @param options.overflowPolicy 溢出策略（缺省 drop-oldest）
   */
  constructor(options?: { mode?: QueueMode; capacity?: number; overflowPolicy?: OverflowPolicy }) {
    this.modeValue = options?.mode ?? 'one-at-a-time';
    this.capacityValue = options?.capacity ?? DEFAULT_QUEUE_CAPACITY;
    this.overflowValue = options?.overflowPolicy ?? 'drop-oldest';
    if (!Number.isInteger(this.capacityValue) || this.capacityValue < 1) {
      throw new RangeError(`capacity 须为正整数，收到 ${this.capacityValue}——空队列是死配置`);
    }
  }

  /** 取件策略（读） */
  get mode(): QueueMode {
    return this.modeValue;
  }

  /** 取件策略（写——运行期调整面：合批窗口开关） */
  set mode(mode: QueueMode) {
    this.modeValue = mode;
  }

  /** 当前条目数 */
  get size(): number {
    return this.items.length;
  }

  /** 是否有待发条目 */
  hasItems(): boolean {
    return this.items.length > 0;
  }

  /**
   * 入列（溢出按策略执法、回执不静默）。
   * @param message 待发消息 @param channel 通道判定结果（驱动侧已裁）
   * @returns 回执：accepted=true 正常入列；false 时 dropped 载被丢/被拒项
   */
  enqueue(message: AgentMessage, channel: DeliverChannel): EnqueueReceipt {
    const item: PendingItem = { message, channel, enqueuedAt: Date.now() };
    if (this.items.length < this.capacityValue) {
      this.items.push(item);
      return { accepted: true };
    }
    if (this.overflowValue === 'bounded') {
      // 有界排队腿：排到帽拒新——拒收项原样回执（调用方告知用户）
      return { accepted: false, dropped: item };
    }
    // drop-oldest 腿：丢队首腾位（丢弃可见——被丢项回执给调用方）
    const dropped = this.items.shift()!;
    this.items.push(item);
    return { accepted: true, dropped };
  }

  /**
   * 取件（按 mode：one-at-a-time 取队首一件；all 全取清空）。
   * @returns 取出的条目（空队列返回空数组）
   */
  drain(): PendingItem[] {
    if (this.items.length === 0) return [];
    if (this.modeValue === 'all') {
      return this.items.splice(0, this.items.length);
    }
    return [this.items.shift()!];
  }

  /** 清空（run 收场/会话拆解用；返回被清条目供回执） */
  clear(): PendingItem[] {
    return this.items.splice(0, this.items.length);
  }
}
