/**
 * 输出保尾器测试（04 §11 合计 60KiB 截尾保后半；到达序分块账本语义）。
 */
import { describe, expect, it } from 'vitest';
import { OutputTail } from './tail.js';
import { OUTPUT_TAIL_BYTES } from './types.js';

/** ASCII 便捷构造（1 字符 1 字节） */
const b = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('OutputTail 输出保尾', () => {
  it('帽内全保——两流分立归并', () => {
    const tail = new OutputTail(1024);
    tail.append('stdout', b('hello '));
    tail.append('stderr', b('warn'));
    tail.append('stdout', b('world'));
    const out = tail.finish();
    expect(out.stdout).toBe('hello world');
    expect(out.stderr).toBe('warn');
    expect(out.truncated).toBe(false);
    expect(out.bytes).toBe(15); // 'hello '6 + 'warn'4 + 'world'5
  });

  it('合计帽语义——两流共享预算，超帽弃最旧整块', () => {
    const tail = new OutputTail(10);
    tail.append('stdout', b('AAAA')); // 4
    tail.append('stderr', b('BBBBBBBB')); // 8 → 合计 12 超 10 → 弃 AAAA
    tail.append('stdout', b('CC')); // 10 → 恰满
    const out = tail.finish();
    expect(out.stdout).toBe('CC');
    expect(out.stderr).toBe('BBBBBBBB');
    expect(out.truncated).toBe(true);
    // bytes = 实收总量（含已弃——真实体量披露）
    expect(out.bytes).toBe(14);
  });

  it('多块淘汰按到达序（最旧先弃）且保留尾部现场', () => {
    const tail = new OutputTail(10);
    tail.append('stdout', b('111'));
    tail.append('stdout', b('222'));
    tail.append('stderr', b('333'));
    tail.append('stdout', b('4444444444')); // 此块入账后合计远超帽 → 旧块全弃
    const out = tail.finish();
    expect(out.stdout).toBe('4444444444');
    expect(out.stderr).toBe('');
    expect(out.bytes).toBe(19); // 3+3+3 + 10
  });

  it('单块超帽劈尾保后半（100KiB 单块帽 60KiB 形）', () => {
    const cap = OUTPUT_TAIL_BYTES;
    const big = new Uint8Array(cap + 40 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = 65; // 'A'
    const tail = new OutputTail(cap);
    tail.append('stdout', big);
    const out = tail.finish();
    expect(out.stdout.length).toBe(cap);
    expect(out.truncated).toBe(true);
    expect(out.bytes).toBe(big.length);
  });

  it('帽 0 = 全弃仍记体量', () => {
    const tail = new OutputTail(0);
    tail.append('stdout', b('hello'));
    tail.append('stderr', b('x'));
    const out = tail.finish();
    expect(out.stdout).toBe('');
    expect(out.stderr).toBe('');
    expect(out.truncated).toBe(true);
    expect(out.bytes).toBe(6);
  });

  it('增量解码——多字节字符跨块边界不劈（宽容非拒收）', () => {
    const tail = new OutputTail(1024);
    // '你好' = 6 字节；劈在两块边界（3+3）
    const raw = new TextEncoder().encode('你好世界');
    tail.append('stdout', raw.subarray(0, 6));
    tail.append('stdout', raw.subarray(6));
    const out = tail.finish();
    expect(out.stdout).toBe('你好世界');
  });

  it('跨块且跨流——解码器按流归并，到达序喂块', () => {
    const tail = new OutputTail(1024);
    const enc = new TextEncoder();
    tail.append('stderr', enc.encode('错'));
    tail.append('stdout', enc.encode('对'));
    tail.append('stderr', enc.encode('了'));
    const out = tail.finish();
    expect(out.stderr).toBe('错了');
    expect(out.stdout).toBe('对');
  });

  it('无效字节序列宽容替换（诊断面——二进制命令输出可回执）', () => {
    const tail = new OutputTail(1024);
    tail.append('stdout', new Uint8Array([0xff, 0xfe, 0x41]));
    const out = tail.finish();
    // fatal:false 替换符——不抛、不空
    expect(out.stdout).toContain('A');
    expect(out.stdout.length).toBeGreaterThan(0);
  });

  it('整块淘汰边界：最后一块永远保留（帽再小也有现场）', () => {
    const tail = new OutputTail(3);
    tail.append('stdout', b('12345678'));
    tail.append('stderr', b('XY'));
    // 8 字节入账即单块劈尾（→'678'）；XY 入账后合计 5>3 弃最旧整块 → 仅剩 XY
    const out = tail.finish();
    expect(out.stdout).toBe('');
    expect(out.stderr).toBe('XY');
    expect(out.truncated).toBe(true);
    expect(out.bytes).toBe(10);
  });
});
