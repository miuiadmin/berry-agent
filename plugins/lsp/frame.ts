/**
 * Content-Length 帧编解码（03 §10.2 帧层——手写零依赖）。
 *
 * 帧形：`Content-Length: <n>\r\n[其余头行……]\r\n\r<n 字节正文>`（LSP stdio
 * 载体标准形；正文 UTF-8 JSON）。
 *
 * 帧资源卫生双帽（03 §10.2 明律）：
 * - 攒头态 16KiB——无 \r\n\r\n 分隔符的持续流不无界攒积；
 * - 攒正文态 16MiB——**Content-Length 声明值即缓冲吸收上界**：头解析时刻
 *   即拒超帽声明（不攒了才发现——巨帧在头落地时就被拦在门外）。
 * 任一超帽/坏头 = fatal 坏帧：同批已解帧全弃（半批不发），此后解码器恒死
 * （不再攒、不再上报——一次语义）；fatal 后残余不外发（pending 由连接层
 * 结清）。与 mcp 件 LineDecoder 同律异形（行帧 vs 长度帧）——DAG 零边故
 * 平行实现，词面独立律（02 §4.1）。
 */
import { LSP_BODY_LIMIT_BYTES, LSP_HEADER_LIMIT_BYTES } from './types.js';

/** 头分隔符（\r\n\r\n——四字节） */
const HEADER_SEPARATOR = '\r\n\r\n';

/** 帧编码（payload → Content-Length 帧 Buffer——写出面单源） */
export function encodeFrame(payload: string): Buffer {
  const body = Buffer.from(payload, 'utf8');
  return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'ascii'), body]);
}

/**
 * 帧解码器（字节面——攒头/攒正文两态；跨 chunk 拼接）。
 *
 * 状态即 `pendingBodyLength`：undefined = 攒头态；数值 = 攒正文态（已闭
 * 合头的声明正文长）。凑满一帧即出帧、余段自动进入下一帧解析循环。
 */
export class FrameDecoder {
  private buf: Buffer[] = [];
  private size = 0;
  private fatal = false;
  private pendingBodyLength: number | undefined;

  /**
   * 喂入一段字节；返回完整帧正文（UTF-8 解码）。
   * fatal = true 即载体级失败（本次起解码器死——后续 feed 恒空恒不报；
   * 同批先出的正常帧一并弃——半批不发）。
   */
  feed(chunk: Buffer): { frames: string[]; fatal: boolean } {
    if (this.fatal) return { frames: [], fatal: false };
    this.buf.push(chunk);
    this.size += chunk.length;
    const frames: string[] = [];
    for (;;) {
      if (this.pendingBodyLength === undefined) {
        // ── 攒头态：找 \r\n\r\n ──
        const merged = this.concat();
        const sep = merged.indexOf(HEADER_SEPARATOR, 'ascii' as BufferEncoding);
        if (sep < 0) {
          // 头未闭合——攒头帽执法（无分隔符持续流不无界攒积）
          if (this.size > LSP_HEADER_LIMIT_BYTES) return this.die();
          this.buf = [Buffer.from(merged)]; // subarray 视图拷贝释放（帽内拷贝有界）
          return { frames, fatal: false };
        }
        const declared = parseContentLength(merged.subarray(0, sep).toString('ascii'));
        if (declared === undefined || declared > LSP_BODY_LIMIT_BYTES) return this.die();
        this.pendingBodyLength = declared;
        const rest = merged.subarray(sep + HEADER_SEPARATOR.length);
        this.buf = rest.length > 0 ? [Buffer.from(rest)] : [];
        this.size = rest.length;
        // 落入攒正文态——继续循环凑正文
      } else {
        // ── 攒正文态：凑满即出帧 ──
        if (this.size < this.pendingBodyLength) return { frames, fatal: false }; // 还不够
        const merged = this.concat();
        frames.push(merged.subarray(0, this.pendingBodyLength).toString('utf8'));
        const rest = merged.subarray(this.pendingBodyLength);
        this.buf = rest.length > 0 ? [Buffer.from(rest)] : [];
        this.size = rest.length;
        this.pendingBodyLength = undefined;
        if (this.size === 0) return { frames, fatal: false }; // 恰好耗尽——零余段
        // 余段可能含后续帧——回循环重新走攒头态
      }
    }
  }

  /** 缓冲合并（单段零拷贝直取；攒头帽内的合并有界） */
  private concat(): Buffer {
    return this.buf.length === 1 ? this.buf[0]! : Buffer.concat(this.buf);
  }

  /** 死面（清槽 + 恒死封口；同批已解帧全弃） */
  private die(): { frames: string[]; fatal: boolean } {
    this.fatal = true;
    this.buf = [];
    this.size = 0;
    this.pendingBodyLength = undefined;
    return { frames: [], fatal: true };
  }
}

/** 头区解析 Content-Length（大小写不敏感；坏形/负数返 undefined） */
function parseContentLength(headerText: string): number | undefined {
  for (const line of headerText.split('\r\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    if (line.slice(0, colon).trim().toLowerCase() !== 'content-length') continue;
    const value = Number.parseInt(line.slice(colon + 1).trim(), 10);
    if (!Number.isFinite(value) || value < 0) return undefined;
    return value;
  }
  return undefined;
}
