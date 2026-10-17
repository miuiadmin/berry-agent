/**
 * FrameDecoder 帧层测试（03 §10.2——帧资源卫生双帽 + 状态机跨 chunk）。
 *
 * 覆盖：encodeFrame 往返 / 头跨 chunk / 一 chunk 多帧 / 攒头帽 fatal /
 * 声明超帽 fatal（头时刻即拒）/ 坏头 fatal / 半批全弃 / 死后恒静默。
 */
import { describe, expect, it } from 'vitest';
import { FrameDecoder, encodeFrame } from './frame.js';
import { LSP_BODY_LIMIT_BYTES, LSP_HEADER_LIMIT_BYTES } from './types.js';

/** 按字节切 chunk（跨 chunk 测试用） */
function chunkify(buf: Buffer, size: number): Buffer[] {
  const out: Buffer[] = [];
  for (let i = 0; i < buf.length; i += size) out.push(buf.subarray(i, i + size));
  return out;
}

describe('encodeFrame 往返', () => {
  it('单帧喂入即解出（payload 逐字节还原）', () => {
    const payload = JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true, 中文: '值' } });
    const d = new FrameDecoder();
    const { frames, fatal } = d.feed(encodeFrame(payload));
    expect(fatal).toBe(false);
    expect(frames).toEqual([payload]);
  });

  it('往返保多字节 UTF-8（CJK 不劈坏）', () => {
    const payload = '诊断：宽字素体 🎉——正文';
    const d = new FrameDecoder();
    expect(d.feed(encodeFrame(payload)).frames).toEqual([payload]);
  });
});

describe('跨 chunk 状态机', () => {
  it('头逐字节喂入（最细粒度分裂）仍闭合解帧', () => {
    const payload = JSON.stringify({ m: 'hello' });
    const d = new FrameDecoder();
    const frames: string[] = [];
    for (const c of chunkify(encodeFrame(payload), 1)) {
      frames.push(...d.feed(c).frames);
    }
    expect(frames).toEqual([payload]);
  });

  it('一 chunk 含多帧（帧背靠背）逐帧解出', () => {
    const a = JSON.stringify({ id: 1 });
    const b = JSON.stringify({ id: 2, big: 'x'.repeat(64) });
    const c = JSON.stringify({ id: 3 });
    const d = new FrameDecoder();
    const merged = Buffer.concat([encodeFrame(a), encodeFrame(b), encodeFrame(c)]);
    expect(d.feed(merged).frames).toEqual([a, b, c]);
  });

  it('跨 chunk 拼接的正文（帧体分裂在中间任意点）', () => {
    const payload = JSON.stringify({ data: 'y'.repeat(100) });
    const frame = encodeFrame(payload);
    const d = new FrameDecoder();
    const frames: string[] = [];
    for (const c of chunkify(frame, 7)) frames.push(...d.feed(c).frames);
    expect(frames).toEqual([payload]);
  });

  it('恰好耗尽后零余段（下一帧从干净态起）', () => {
    const d = new FrameDecoder();
    expect(d.feed(encodeFrame('A')).frames).toEqual(['A']);
    expect(d.feed(encodeFrame('B')).frames).toEqual(['B']);
  });

  it('额外头行（Content-Type 等）与头大小写不敏感', () => {
    const body = Buffer.from('{"k":1}', 'utf8');
    const frame = Buffer.concat([
      Buffer.from(
        `content-length: ${body.length}\r\nContent-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n`,
        'ascii',
      ),
      body,
    ]);
    expect(new FrameDecoder().feed(frame).frames).toEqual(['{"k":1}']);
  });
});

describe('帧资源卫生双帽（fatal 路径）', () => {
  it('攒头帽超限：无分隔符持续流 16KiB+1 即死', () => {
    const d = new FrameDecoder();
    // 16KiB 无分隔符流——分两段喂（段内帽未爆继续攒，累计超帽即死）
    expect(d.feed(Buffer.alloc(8 * 1024, 0x61)).fatal).toBe(false);
    const r = d.feed(Buffer.alloc(8 * 1024 + 1, 0x61));
    expect(r.fatal).toBe(true);
    expect(r.frames).toEqual([]);
  });

  it('攒头帽边界内（恰 16KiB 存活——帽是 > 不是 >=）', () => {
    const d = new FrameDecoder();
    // 16384 字节无分隔符：未超帽（size > 16KiB 才死）——继续攒
    expect(d.feed(Buffer.alloc(LSP_HEADER_LIMIT_BYTES, 0x61)).fatal).toBe(false);
  });

  it('声明超帽：Content-Length 16MiB+1 头闭合即拒（不进正文态）', () => {
    const d = new FrameDecoder();
    const r = d.feed(Buffer.from(`Content-Length: ${LSP_BODY_LIMIT_BYTES + 1}\r\n\r\n`, 'ascii'));
    expect(r.fatal).toBe(true);
  });

  it('坏头：非数字值 fatal', () => {
    expect(new FrameDecoder().feed(Buffer.from('Content-Length: abc\r\n\r\n', 'ascii')).fatal).toBe(true);
  });

  it('坏头：负数声明 fatal', () => {
    expect(new FrameDecoder().feed(Buffer.from('Content-Length: -5\r\n\r\n', 'ascii')).fatal).toBe(true);
  });

  it('坏头：缺 Content-Length 头（分隔符直闭）fatal', () => {
    expect(new FrameDecoder().feed(Buffer.from('Content-Type: x\r\n\r\nbody', 'ascii')).fatal).toBe(true);
  });

  it('半批全弃：同批先解出好帧后遇坏头——已解帧不外发', () => {
    const d = new FrameDecoder();
    const good = encodeFrame('{"ok":1}');
    const bad = Buffer.from('Content-Length: NaN\r\n\r\n', 'ascii');
    const r = d.feed(Buffer.concat([good, bad]));
    expect(r.fatal).toBe(true);
    expect(r.frames).toEqual([]); // 半批不发——同批好帧一并弃
  });

  it('死后恒静默：后续 feed 恒空恒不报（不再 fatal 二次）', () => {
    const d = new FrameDecoder();
    expect(d.feed(Buffer.from('Content-Length: -1\r\n\r\n', 'ascii')).fatal).toBe(true);
    expect(d.feed(encodeFrame('{"late":1}'))).toEqual({ frames: [], fatal: false });
    expect(d.feed(Buffer.from('garbage'))).toEqual({ frames: [], fatal: false });
  });
});
