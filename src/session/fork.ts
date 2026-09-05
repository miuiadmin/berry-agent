/**
 * fork 与血缘（05 篇 §5.0——forkSession 边界快照的纯函数面）。
 *
 * fork = 前缀种子 + 复制。物理动作（sessions 表新行/flush 屏障）归 persist 与
 * host 装配序；本文件只做日志侧的两件事：前缀拷贝与切片重编（遮蔽载体随种子
 * 走——重编时同步重写 surfaceOp 的 start/end 与 sourceEventSeqs）。
 */
import type { SessionEvent } from '../contracts/index.js';

/**
 * 普通前缀拷贝：[0, upToSeq] 原样拷贝（seq 不重编——结构共享，data 已冻结
 * 天然免拷贝）。end-seed 的 append 与 flush 屏障由调用方（SessionLog/host）编排。
 * @param events 源日志（冻结态）
 * @param upToSeq 前缀上界（含）；调用方负责边界合法性（缺省 lastClosedBoundary）
 */
export function forkPrefix(events: readonly SessionEvent[], upToSeq: number): SessionEvent[] {
  const out: SessionEvent[] = [];
  for (let i = 0; i <= upToSeq && i < events.length; i++) {
    out.push(events[i]!);
  }
  return out;
}

/**
 * 中段前缀种子（第三形态 slice，05 §5.0——goal 续跑/导出再导入的「中段取种子」）：
 * 取 [fromSeq, toSeq] 切片并从 0 重编 seq（日志内 seq 连续性是硬约束）；遮蔽
 * 载体随种子走——surfaceOp 区间与 sourceEventSeqs 同步平移 fromSeq。
 *
 * 遮蔽跨界的保守语义（本实现补全，05 篇未细写）：遮蔽区间完全落在切片外
 * （[0, fromSeq)）的指令事件整体丢弃（被遮蔽节点不在新日志内，指令失去对象）；
 * 跨切点的区间截断到切点（部分遮蔽——遮蔽者不可越界遮到不存在的前史）；
 * sourceEventSeqs 中指向切片前的引用过滤（溯源悬空不如溯源精简）。
 */
export function slicePrefix(events: readonly SessionEvent[], fromSeq: number, toSeq: number): SessionEvent[] {
  const out: SessionEvent[] = [];
  for (let i = fromSeq; i <= toSeq && i < events.length; i++) {
    const event = events[i]!;
    const op = event.surfaceOp;
    if (!op) {
      out.push(rewriteSeq(event, i - fromSeq));
      continue;
    }
    // 遮蔽区间在新坐标系的位置
    const newStart = Math.max(op.start - fromSeq, 0);
    const newEnd = op.end - fromSeq;
    if (newEnd < 0) {
      // 区间整体在切片前——指令失去对象，丢弃（不拷贝本事件）
      continue;
    }
    const seqs = event.sourceEventSeqs?.map((seq) => seq - fromSeq).filter((seq) => seq >= 0);
    out.push({
      ...rewriteSeq(event, i - fromSeq),
      surfaceOp: { op: 'replace', start: newStart, end: newEnd },
      ...(seqs !== undefined ? { sourceEventSeqs: seqs } : {}),
    });
  }
  return out;
}

/** 重编 seq 的事件拷贝（其余字段引用共享——data 冻结态不可变） */
function rewriteSeq(event: SessionEvent, newSeq: number): SessionEvent {
  return { ...event, seq: newSeq };
}

/**
 * ensureSeeded（05 §5.1）：导入/fork 后新会话日志必须是合法种子前缀。
 * 校验位 = **前缀尾条**（尾界标记在场且 seq 对齐 seedLength——end-seed 位于
 * 前缀末尾而非开头，「以 end-seed 开头」字面不成立）；裸拷贝不走正门即断言失败。
 * 切片形态（无 end-seed 尾条）以 seedLength 锚定校验（尾条 seq 恰 = seedLength - 1）。
 * @returns 布尔判据（调用方决定 fail-loud 形态：导入闸抛 SESSION_IMPORT_BAD_FORMAT、
 *   fork 断言直接炸）
 */
export function isSeededPrefix(events: readonly SessionEvent[], seedLength: number, requireEndSeed: boolean): boolean {
  if (events.length !== seedLength) return false;
  if (seedLength === 0) return !requireEndSeed; // 空前缀：仅无尾界要求时合法（新建会话）
  const tail = events[seedLength - 1];
  if (!tail || tail.seq !== seedLength - 1) return false;
  if (requireEndSeed && tail.type !== 'session/end-seed') return false;
  return true;
}
