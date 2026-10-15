/**
 * 持屏期 stderr 抑制桩测试（挖掘 47 轮件 C——TUI 持屏期 stderr 写点装桩拦截）。
 *
 * 纯机制件单测：sink/target 全注假（零真 stderr patch——vitest worker 的
 * stderr 不被吞，测试诊断面保全）。修前红锚：本文件先于实现落（模块缺席
 * 即红）——装/卸双形还原（own 值还原 + 原型 delete）、末参扫描全形、
 * 上限丢弃计数、dispose 摘要措辞全链锁死。
 */
import { describe, expect, it } from 'vitest';
import { installStderrGuard, STDERR_GUARD_CAP, type StderrWriteTarget } from './stderr-guard.js';

/** 原型形 target（write 在原型——Node process.stderr 真形：own 赋值遮蔽、delete 还原） */
function makeProtoTarget(): {
  readonly target: StderrWriteTarget;
  /** 原写点收到的调用（透传腿记录） */
  readonly passthrough: unknown[][];
  readonly proto: { write(...args: unknown[]): boolean };
} {
  const passthrough: unknown[][] = [];
  const proto = {
    write(...args: unknown[]): boolean {
      passthrough.push(args);
      return true;
    },
  };
  return { target: Object.create(proto) as StderrWriteTarget, passthrough, proto };
}

/** own 形 target（write 自持——注入面极端形：dispose 原值回填） */
function makeOwnTarget(): {
  readonly target: StderrWriteTarget;
  readonly passthrough: unknown[][];
  readonly original: (...args: unknown[]) => boolean;
} {
  const passthrough: unknown[][] = [];
  const original = (...args: unknown[]): boolean => {
    passthrough.push(args);
    return true;
  };
  return { target: { write: original }, passthrough, original };
}

describe('持屏期 stderr 抑制桩（挖掘 47 轮件 C）', () => {
  it('装桩拦截：write 走 sink 不透传原写点 + 恒返 true', () => {
    const sink: string[] = [];
    const { target, passthrough } = makeProtoTarget();
    const guard = installStderrGuard({ sink: (t) => sink.push(t), target });
    const ret = target.write('warn-line\n');
    expect(ret).toBe(true);
    expect(sink).toEqual(['warn-line\n']);
    expect(passthrough).toEqual([]); // 不透传（持屏期拦截正果）
    guard.dispose();
  });

  it('dispose 原型形还原：delete 撤遮蔽——回原型写点透传', () => {
    const sink: string[] = [];
    const { target, passthrough, proto } = makeProtoTarget();
    const guard = installStderrGuard({ sink: (t) => sink.push(t), target });
    guard.dispose();
    expect(Object.prototype.hasOwnProperty.call(target, 'write')).toBe(false); // own 撤除
    expect(target.write === proto.write).toBe(true); // 回原型
    target.write('after\n');
    expect(passthrough).toEqual([['after\n']]); // 透传复原
    expect(sink).toEqual([]); // dispose 后写不再进 sink
  });

  it('dispose own 形还原：原值回填透传', () => {
    const sink: string[] = [];
    const { target, passthrough, original } = makeOwnTarget();
    const guard = installStderrGuard({ sink: (t) => sink.push(t), target });
    guard.dispose();
    expect(target.write === original).toBe(true); // own 值还原
    target.write('after\n');
    expect(passthrough).toEqual([['after\n']]);
  });

  it('回调契约：cb 同步被调（write 返回前已置旗）', () => {
    const { target } = makeProtoTarget();
    const guard = installStderrGuard({ sink: () => {}, target });
    let called = false;
    const ret = target.write('x', () => {
      called = true;
    });
    expect(called).toBe(true); // 同步性：write 返回后立查即证
    expect(ret).toBe(true);
    guard.dispose();
  });

  it('末参扫描三形 + Buffer 四参：cb 均达；encoding 位不误当 cb', () => {
    const { target } = makeProtoTarget();
    const guard = installStderrGuard({ sink: () => {}, target });
    // (chunk) 单参形：无 cb 不炸
    expect(target.write('a')).toBe(true);
    // (chunk, cb) 两参形（Node 24 实测 console.error 真形）
    let cb2: unknown = 'unset';
    target.write('b', (err: Error | null) => {
      cb2 = err;
    });
    expect(cb2).toBe(null); // cb 达 + err null
    // (chunk, encoding, cb) 三参形
    let cb3 = false;
    target.write('c', 'utf8', () => {
      cb3 = true;
    });
    expect(cb3).toBe(true);
    // (chunk, encoding) 无 cb 形：encoding 字符串位不误当 cb（不炸零调）
    expect(target.write('d', 'utf8')).toBe(true);
    // Buffer 四参 (chunk, offset, length, cb) 形
    let cb4 = false;
    target.write(Buffer.from('e'), 0, 1, () => {
      cb4 = true;
    });
    expect(cb4).toBe(true);
    guard.dispose();
  });

  it('Buffer 与 Uint8Array chunk：utf8 串化', () => {
    const sink: string[] = [];
    const { target } = makeProtoTarget();
    const guard = installStderrGuard({ sink: (t) => sink.push(t), target });
    target.write(Buffer.from('中文警告'));
    target.write(new TextEncoder().encode('café'));
    expect(sink).toEqual(['中文警告', 'café']);
    guard.dispose();
  });

  it('上限外丢弃：计数不 sink；缺省帽 200 锁死', () => {
    const sink: string[] = [];
    const { target } = makeProtoTarget();
    const guard = installStderrGuard({ sink: (t) => sink.push(t), target, cap: 2 });
    target.write('1');
    target.write('2');
    target.write('3'); // 超限段
    expect(sink).toEqual(['1', '2']);
    expect(guard.capturedCount()).toBe(2);
    expect(guard.droppedCount()).toBe(1);
    guard.dispose();
    expect(STDERR_GUARD_CAP).toBe(200); // 帽值锁死（规范定值）
  });

  it('dispose 摘要行：N 与 M 计数 + 措辞「超限丢弃」；M=0 无尾注', () => {
    const sink: string[] = [];
    const { target } = makeProtoTarget();
    const guard = installStderrGuard({ sink: (t) => sink.push(t), target, cap: 2 });
    target.write('1');
    target.write('2');
    target.write('3');
    guard.dispose();
    expect(sink[2]).toBe('持屏期 stderr 抑制 2 段（超限丢弃 1 段）'); // 摘要措辞锁死（禁替表：帽→上限）
    // M=0 形：无尾注单段
    const sink2: string[] = [];
    const { target: t2 } = makeProtoTarget();
    const g2 = installStderrGuard({ sink: (t) => sink2.push(t), target: t2 });
    t2.write('only');
    g2.dispose();
    expect(sink2).toEqual(['only', '持屏期 stderr 抑制 1 段']);
  });

  it('N=0 零摘要：装后不写直接 dispose——sink 全程零收', () => {
    const sink: string[] = [];
    const { target } = makeProtoTarget();
    const guard = installStderrGuard({ sink: (t) => sink.push(t), target });
    guard.dispose();
    expect(sink).toEqual([]);
  });

  it('幂等双 dispose：二次 no-op——摘要恰一段', () => {
    const sink: string[] = [];
    const { target } = makeProtoTarget();
    const guard = installStderrGuard({ sink: (t) => sink.push(t), target });
    target.write('x');
    guard.dispose();
    guard.dispose();
    expect(sink).toEqual(['x', '持屏期 stderr 抑制 1 段']); // 摘要恰一段（二次不重发）
  });

  it('sink 抛错不炸写者：吞 + cb 仍调 + 返 true；计数不受影响', () => {
    const { target } = makeProtoTarget();
    const guard = installStderrGuard({
      sink: () => {
        throw new Error('boom');
      },
      target,
    });
    let cbCalled = false;
    expect(() =>
      target.write('x', () => {
        cbCalled = true;
      }),
    ).not.toThrow();
    expect(cbCalled).toBe(true); // 写者契约不因 sink 故障破
    expect(guard.capturedCount()).toBe(1);
    guard.dispose(); // dispose 摘要 sink 同抛——同样吞不炸
  });
});
