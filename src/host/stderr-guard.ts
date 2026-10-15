/**
 * 持屏期 stderr 抑制桩（挖掘 47 轮件 C——TUI 持屏期 stderr 写点装桩拦截，
 * 07 §4.1 持屏期 stderr 抑制条款的机制面）。
 *
 * codex terminal_stderr.rs 走 dup2→/dev/null（Rust 面）；Node 无公开
 * dup2——JS 层写点桩（berry 风险写点全 JS 面：console.error 与
 * process.stderr.write 同经写点可拦；native 直写 fd2 非射程，规范不承诺
 * native 面）。sink 不经 logger 通道（logger 缺省 sink 即 stderr：
 * guard→logger.warn→stderr.write→guard 回灌成环——07 §4.1 定谳注）。
 *
 * install 原子性（07 §4.1 定谳）：机制件内部不含 sink 建立——装配侧须
 * **先建 sink 产线**（文件/目录就绪）**后调本件** patch 写点，sink 建立
 * 抛错时桩未上零泄漏（顺序归装配序保证）。
 */
import { Buffer } from 'node:buffer';

/** 缓冲段数上限（超限丢弃有计数——诚实降级非静默；措辞遵 07 §4.4 禁替表帽→上限） */
export const STDERR_GUARD_CAP = 200;

/** 写点最小结构面（process.stderr.write 兼容——机制件不引 Node 流类型） */
export interface StderrWriteTarget {
  write(...args: unknown[]): boolean;
}

/** 抑制桩注入面（sink/target 全注入——测试零真 stderr patch） */
export interface StderrGuardOptions {
  /** 拦截去向（测试注内存；产线注文件追加——不经 logger 通道） */
  readonly sink: (chunk: string) => void;
  /** 写点（缺省 process.stderr） */
  readonly target?: StderrWriteTarget;
  /** 缓冲段数上限（缺省 STDERR_GUARD_CAP） */
  readonly cap?: number;
}

/** 抑制桩柄（dispose 幂等——二次调用 no-op） */
export interface StderrGuard {
  /** 还原写点 + 摘要行经 sink（N=0 零摘要；M=0 无尾注） */
  dispose(): void;
  /** 已拦截段数 */
  capturedCount(): number;
  /** 超限丢弃段数 */
  droppedCount(): number;
}

/**
 * 装桩拦截写点：write 调用改道 sink（不透传原写点），dispose 双形还原
 * （own 值还原 / 原型形 delete 撤遮蔽——Node 24 双形实测均成立）。
 */
export function installStderrGuard(options: StderrGuardOptions): StderrGuard {
  const target = options.target ?? process.stderr;
  const sink = options.sink;
  const cap = options.cap ?? STDERR_GUARD_CAP;
  let captured = 0;
  let dropped = 0;
  let disposed = false;
  // own property 判别（Node process.stderr 的 write 恒原型链形——own 赋值
  // 遮蔽、delete 还原；own 形〔注入面〕保存原值回填——双形还原都正确）
  const hadOwn = Object.prototype.hasOwnProperty.call(target, 'write');
  const original = target.write;
  const wrapped = (...args: unknown[]): boolean => {
    // 末参扫描判位（07 §4.1 wrapped 契约条款）：实参末位向前首个函数即
    // cb——覆盖 (chunk) / (chunk, cb) / (chunk, encoding, cb) 与 Buffer
    // 四参 (chunk, offset, length, cb) 全形；encoding/offset/length 位的
    // 字符串数字不误当 cb
    let cb: ((err: Error | null) => void) | undefined;
    for (let i = args.length - 1; i >= 1; i--) {
      if (typeof args[i] === 'function') {
        cb = args[i] as (err: Error | null) => void;
        break;
      }
    }
    // chunk 串化（string | Buffer | Uint8Array → utf8 串）
    const chunk = args[0];
    const text =
      typeof chunk === 'string'
        ? chunk
        : chunk instanceof Uint8Array
          ? Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString('utf8')
          : String(chunk);
    if (captured < cap) {
      captured++;
      try {
        sink(text);
      } catch {
        /* sink 抛错吞不上抛——抑制面非故障面（写者契约不因 sink 故障破） */
      }
    } else {
      dropped++; // 上限外丢弃有计数（不 sink——洪水有界不爆内存）
    }
    cb?.(null); // 同步调 cb(null)——写者契约「回调必被调」保全（漏调挂起下游）
    return true; // 恒返 true（拦截即受理语义）
  };
  target.write = wrapped; // own 赋值遮原型
  return {
    dispose() {
      if (disposed) return; // 幂等（二次 no-op）
      disposed = true;
      // 双形还原：原值 own 形回填；原型形 delete 撤遮蔽
      if (hadOwn) target.write = original;
      else delete (target as { write?: unknown }).write;
      // 摘要行经 sink（N=0 零噪音跳过；M>0 才带「超限丢弃」尾注）
      if (captured > 0) {
        const summary =
          dropped > 0
            ? `持屏期 stderr 抑制 ${captured} 段（超限丢弃 ${dropped} 段）`
            : `持屏期 stderr 抑制 ${captured} 段`;
        try {
          sink(summary);
        } catch {
          /* 吞——抑制面非故障面 */
        }
      }
    },
    capturedCount: () => captured,
    droppedCount: () => dropped,
  };
}
