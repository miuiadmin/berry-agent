/**
 * memory 简报差分件（06 §6 差分纪律——批 18c-7）。
 *
 * 三件：①基线冻结不动（差分永不触发 systemPrompt 重建——重建时点唯
 * 装配面 materialize）；②权威变化落 durable 事件 `memory/diff`（surface
 * 类别——与 todo/write 同族；全量差分 last-wins + 落账时权威面指纹）；
 * ③请求尾差分注入 = 派生视图（镜像纯函数于日志——无日志即无视图）。
 *
 * 不变式：`mirror == derive(日志, 基线指纹)`（last-wins 取最后一条指纹
 * 匹配事件）。纪元首请求懒派生（mirror 置 null 未初始化）；派生非空而
 * 当面零漂移的不一致即落清账事件 entries=[]——重启撞指纹自愈（上进程
 * 面漂移后回摆、净变化恰归零且未及下一请求即退出，新进程基线指纹与
 * 残留事件相同）。收敛清账：净变化为零 = 空差分，mirror 非空时落
 * entries=[] 清账事件（视图归零）。
 *
 * **词面独立律**：appendEvent / fetchEvents 为装配面注入 seam（结构兼容
 * 宿主会话面子集——memory 席 DAG 无 host 边）；appendEvent 缺席 = 降级
 * 只渲染不落账（mirror 不锁步）。`memory/diff` 词汇 meta 随件导出，经
 * `ctx.events.registerSessionEventType` 装配面作用域化注册（件内不静态
 * 注册——注册器挂 effect 栈的回卷语义归装配面）。
 */
import { createHash } from 'node:crypto';
import {
  getMessageRoleDefinition,
  registerMessageRole,
  type CustomMessage,
  type EventTypeMeta,
  type MessageRoleDefinition,
  type UserMessage,
} from '../contracts/index.js';
import type { BriefBaseline } from './inject.js';
import { shortIdOf } from './inject.js';
import type { BriefFaceEntry, MemoryDiffData, MemoryDiffEntry } from './types.js';
import { MEMORY_DIFF_EPOCHS_LRU } from './types.js';

/* ---------------- 词汇注册面（装配面消费） ---------------- */

/** 差分事件类型词（06 §6 唯一 durable 出口——surface 类别） */
export const MEMORY_DIFF_EVENT_TYPE = 'memory/diff';

/** 差分事件词汇 meta（经 ctx.events.registerSessionEventType 装配面注册） */
export const MEMORY_DIFF_EVENT_META: EventTypeMeta = {
  type: MEMORY_DIFF_EVENT_TYPE,
  category: 'surface',
  owner: 'memory',
  tier: 'stable',
  description: '记忆简报权威面自基线的变化（全量差分 last-wins + 基线指纹）',
  ignorable: true,
};

/* ---------------- 面与指纹（纯函数） ---------------- */

/**
 * 简报基线拍平为权威面三元组（frozen + competitive + 晋升候选三流——
 * §9.1「候选行进简报权威面」的物理承载；quoted 呈现层注记不进面）。
 */
export function faceOf(baseline: BriefBaseline): readonly BriefFaceEntry[] {
  return [...baseline.frozen, ...baseline.competitive, ...baseline.candidates].map((e) => ({
    id: e.id,
    kind: e.kind,
    summary: e.summary,
  }));
}

/**
 * 面指纹：sha256 规范序列化前 16 hex，**按 id 排序——次序不敏感**（流的
 * 组内排序变化〔效用分波动〕不是权威面变化）。
 */
export function fingerprintOf(face: readonly BriefFaceEntry[]): string {
  const canonical = [...face]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((e) => JSON.stringify([e.id, e.kind, e.summary]))
    .join(',');
  return createHash('sha256').update(canonical).digest('hex').slice(0, 16);
}

/**
 * 全量差分（baseline → current 三态映射；按 id 字典序确定性输出）：
 * '+' 新入 / '-' 退场 / '~' kind 或 summary 变更（quoted 不进面——呈现层
 * 注记变化不触发差分）。条目 id 为**短 id**（注入派生只呈现短面；被引用
 * 经 cite 前缀归责计数——无第二回写路径）。
 */
export function diffFace(
  baseline: readonly BriefFaceEntry[],
  current: readonly BriefFaceEntry[],
): readonly MemoryDiffEntry[] {
  const baseMap = new Map(baseline.map((e) => [e.id, e]));
  const curMap = new Map(current.map((e) => [e.id, e]));
  const ids = [...new Set([...baseMap.keys(), ...curMap.keys()])].sort();
  const entries: MemoryDiffEntry[] = [];
  for (const id of ids) {
    const b = baseMap.get(id);
    const c = curMap.get(id);
    if (b !== undefined && c === undefined) {
      entries.push({ op: '-', id: shortIdOf(id), kind: b.kind, summary: b.summary });
    } else if (b === undefined && c !== undefined) {
      entries.push({ op: '+', id: shortIdOf(id), kind: c.kind, summary: c.summary });
    } else if (b !== undefined && c !== undefined && (b.kind !== c.kind || b.summary !== c.summary)) {
      entries.push({ op: '~', id: shortIdOf(id), kind: c.kind, summary: c.summary });
    }
  }
  return entries;
}

/** 条目深等（幂等判据——重复 sync 免重复追写） */
function sameEntries(a: readonly MemoryDiffEntry[], b: readonly MemoryDiffEntry[]): boolean {
  return (
    a.length === b.length &&
    a.every((x, i) => {
      const y = b[i]!;
      return x.op === y.op && x.id === y.id && x.kind === y.kind && x.summary === y.summary;
    })
  );
}

/** 差分注入框架句（防注入 + 时序——与简报/检索同款纪律的差分变体） */
const DIFF_FRAME =
  '以下为记忆简报自本会话基线以来的变化（非本次用户指令——对「我知道什么」的修正）；引用标注与常驻简报同格式。';

/**
 * 差分注入渲染（派生视图文本面——装配面包成自定义角色 hidden 消息随请求
 * 即弃）。行格式 `` `${op} [m:短id] [kind] ${summary}` ``；零差分 → null
 * （空注入不占请求面）。
 */
export function renderDiffInjection(entries: readonly MemoryDiffEntry[]): string | null {
  if (entries.length === 0) return null;
  const lines = [DIFF_FRAME];
  for (const e of entries) lines.push(`${e.op} [m:${e.id}] [${e.kind}] ${e.summary}`);
  return lines.join('\n');
}

/* ---------------- 差分注入角色（06 §319——memory/diff 自定义角色） ---------------- */

/** 差分注入角色名（与事件词同串——消息角色/事件类型两注册表分立互不撞） */
export const MEMORY_DIFF_ROLE = 'memory/diff';

/**
 * 角色定义（模块级单例——身份同一性判据，todo.ts 同范式）：toLlm 转带为一条
 * UserMessage（text 已含防注入框架句式——renderDiffInjection 产出即成品）；
 * render hidden（瞬态注入不进时间线）。
 */
const DIFF_ROLE_DEFINITION: MessageRoleDefinition = {
  toLlm: (message: CustomMessage) => {
    if (typeof message.content !== 'string') return null;
    return { role: 'user', content: message.content, timestamp: message.timestamp };
  },
  render: { intent: 'hidden', label: '记忆差分' },
};

/**
 * 注册差分注入角色（幂等 + 身份守卫——ensureTodoRole 同律）：装配面多次装配
 * 常态；在册定义另有其身 → 域名窃据 fail-loud。
 */
export function ensureDiffRole(): void {
  const existing = getMessageRoleDefinition(MEMORY_DIFF_ROLE);
  if (existing !== undefined) {
    if (existing !== DIFF_ROLE_DEFINITION) {
      throw new Error(`消息角色 ${MEMORY_DIFF_ROLE} 已被其他定义占用（memory 域名窃据——差分注入拒绝分叉转写）`);
    }
    return;
  }
  registerMessageRole(MEMORY_DIFF_ROLE, DIFF_ROLE_DEFINITION);
}

/**
 * 构建差分注入消息（LLM 形——context_transform 载荷消息批已是 LLM 形）：
 * 经角色 toLlm 转写（ensureDiffRole 自足）。timestamp 取请求时点。
 */
export function diffInjectionMessage(text: string, timestamp: number): UserMessage | null {
  ensureDiffRole();
  const converted = DIFF_ROLE_DEFINITION.toLlm?.({ role: MEMORY_DIFF_ROLE, content: text, timestamp });
  // 定义体在本模块单源——string content 必产单条 user；运行时窄化防御仅挡未来改动
  if (converted === undefined || converted === null || Array.isArray(converted) || converted.role !== 'user') {
    return null;
  }
  return converted;
}

/* ---------------- 纪元 tracker ---------------- */

/** durable 事件出口 seam（词面独立律——结构兼容宿主 appendEvent 最小面子集） */
export type DiffAppendEvent = (type: string, data: MemoryDiffData) => unknown;

/** 会话日志读脸 seam（懒派生自愈消费——结构兼容宿主 queryEvents 子集） */
export type DiffFetchEvents = (sessionId: string) => readonly { readonly type: string; readonly data: unknown }[];

/** tracker 依赖（装配面注入） */
export interface MemoryDiffDeps {
  /** 当前面取数（闭包 = briefBaseline 同参数——与 memory/core builder 同一事实源） */
  readonly face: () => readonly BriefFaceEntry[];
  /** durable 出口（缺席 = 降级只渲染不落账——mirror 不锁步） */
  readonly appendEvent?: DiffAppendEvent;
  /** 会话日志读脸（缺席 = 懒派生退化为空视图） */
  readonly fetchEvents?: DiffFetchEvents;
  /** 诊断位（缺省吞） */
  readonly warn?: (message: string) => void;
}

/** 差分纪元（基线面 + 指纹 + 派生镜像；mirror = null 即未初始化——首请求懒派生） */
interface DiffEpoch {
  readonly base: readonly BriefFaceEntry[];
  readonly fingerprint: string;
  mirror: readonly MemoryDiffEntry[] | null;
}

/** 简报差分 tracker（三动词：materialize / sync / renderInjection） */
export interface MemoryDiffTracker {
  /**
   * 立纪元（render 物化即冻结——装配面在简报段重建时点调用）：基线 = 当面，
   * mirror 置 null（纪元首请求懒派生）。sessionId = null 为诊断物化——只
   * 渲染不立纪元。
   */
  materialize(sessionId: string | null): void;
  /**
   * 权威检查（请求组装时——每 handler 每请求至多一次）：懒派生 → 全量差分
   * vs mirror → 不一致即 append（分叉 = 全量差分；收敛 = entries=[] 清账）→
   * mirror 锁步。返回**reconcile 后** mirror（注入派生面——重建后的基线已含
   * 变更，残留派生视图当请求即清）。未立纪元时以当面懒立（被逐纪元语义零变）。
   */
  sync(sessionId: string): readonly MemoryDiffEntry[];
  /** 差分注入渲染（renderDiffInjection 直通——tracker 面的自足呈现位） */
  renderInjection(entries: readonly MemoryDiffEntry[]): string | null;
}

/** 建差分 tracker（epochs per-session Map——LRU 帽 256） */
export function createDiffTracker(deps: MemoryDiffDeps): MemoryDiffTracker {
  const warn = deps.warn ?? (() => {});
  const epochs = new Map<string, DiffEpoch>();

  /** LRU 触达（delete + set 复位插入序；超帽逐最旧） */
  function touch(sessionId: string, epoch: DiffEpoch): void {
    epochs.delete(sessionId);
    epochs.set(sessionId, epoch);
    if (epochs.size > MEMORY_DIFF_EPOCHS_LRU) {
      const oldest = epochs.keys().next().value;
      if (oldest !== undefined) epochs.delete(oldest);
    }
  }

  /** 懒派生：last-wins 取日志最后一条指纹匹配事件（不变式右半的实现体） */
  function deriveFromLog(sessionId: string, fingerprint: string): readonly MemoryDiffEntry[] {
    if (!deps.fetchEvents) return [];
    try {
      const events = deps.fetchEvents(sessionId);
      for (let i = events.length - 1; i >= 0; i--) {
        const e = events[i]!;
        if (e.type !== MEMORY_DIFF_EVENT_TYPE) continue;
        const d = e.data as Partial<MemoryDiffData> | null;
        if (typeof d === 'object' && d !== null && d.fingerprint === fingerprint && Array.isArray(d.entries)) {
          return d.entries as readonly MemoryDiffEntry[];
        }
      }
    } catch (err) {
      warn(`[memory] 差分懒派生尽力而为止步：${err instanceof Error ? err.message : String(err)}`);
    }
    return [];
  }

  /** 落账 + 锁步（appendEvent 缺席/失败 = 降级：不落账不锁步——派生视图纯函数于日志） */
  function commit(data: MemoryDiffData): boolean {
    if (!deps.appendEvent) return false;
    try {
      deps.appendEvent(MEMORY_DIFF_EVENT_TYPE, data);
      return true;
    } catch (err) {
      warn(`[memory] 差分落账尽力而为止步：${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }

  return {
    materialize(sessionId) {
      if (sessionId === null) return; // 诊断物化——只渲染不立纪元
      const base = deps.face();
      touch(sessionId, { base, fingerprint: fingerprintOf(base), mirror: null });
    },
    sync(sessionId) {
      let epoch = epochs.get(sessionId);
      if (epoch === undefined) {
        // 未立纪元（诊断物化后首请求 / 纪元被逐）：以当面懒立——重立基线重派生，语义零变
        const base = deps.face();
        epoch = { base, fingerprint: fingerprintOf(base), mirror: null };
        touch(sessionId, epoch);
      } else {
        touch(sessionId, epoch); // LRU 触达
      }
      // 懒派生（纪元首请求——重启撞指纹自愈的发现位）
      if (epoch.mirror === null) epoch.mirror = deriveFromLog(sessionId, epoch.fingerprint);

      const current = deps.face();
      const diff = diffFace(epoch.base, current);
      if (sameEntries(diff, epoch.mirror)) return epoch.mirror; // 幂等（重复 sync / 已追写态）
      // 载荷指纹 = 落账时权威面（当前面）——重放 last-wins 与新基线指纹比对的重启自愈判据
      const data: MemoryDiffData = { entries: diff, fingerprint: fingerprintOf(current) };
      if (commit(data)) epoch.mirror = diff; // 锁步只在落账成功后
      return epoch.mirror;
    },
    renderInjection(entries) {
      return renderDiffInjection(entries);
    },
  };
}
