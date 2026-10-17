/**
 * 输出保尾器（04 §11：stdout/stderr 合计截尾保后半 60KiB）。
 *
 * 合计帽语义：两流按到达序共享同一字节预算——超预算时从最旧侧连续劈头保
 * 尾部（尾部才有失败现场：栈迹/错误摘要在尾）。实现 = 到达序分块账本（每块
 * 记来源流与字节），超帽量从最旧块头部起跨块连续扣除——finish 输出恒为实收
 * 字节流的最后 ≤cap 字节（保尾不变式不受 data 分块边界影响）。
 *
 * 解码纪律：UTF-8 增量宽容解码（decoder.decode(part, {stream:true})——分块
 * 边界不劈多字节字符；fatal:false 替换符）。与 fs 读的 strict 拒收分立：
 * fs 读是数据面（mojibake 进上下文污染模型观察），进程输出是诊断面（二进
 * 制命令〔cat file.bin〕的输出须能以可读形态回执，不能整单拒收）。
 */
import { OUTPUT_TAIL_BYTES } from './types.js';

/** 单块到达账（来源流 + 字节） */
interface Chunk {
  stream: 'stdout' | 'stderr';
  bytes: Uint8Array;
}

/** 合计保尾器（构造帽缺省 OUTPUT_TAIL_BYTES；帽 0 = 全弃仍记账） */
export class OutputTail {
  private readonly chunks: Chunk[] = [];
  private totalBytes = 0;
  private droppedBytes = 0;

  constructor(private readonly cap: number = OUTPUT_TAIL_BYTES) {}

  /** 追加一块输出（到达序）；随即收缩——账本在任意时刻都满足保尾不变式 */
  append(stream: 'stdout' | 'stderr', bytes: Uint8Array): void {
    if (bytes.byteLength === 0 || this.cap === 0) {
      // 帽 0 形：不记账本只记体量（全弃仍是真实输出量）
      this.droppedBytes += bytes.byteLength;
      return;
    }
    this.chunks.push({ stream, bytes });
    this.totalBytes += bytes.byteLength;
    // 超帽量从最旧块头部起跨块连续扣除——finish 输出恒为实收流的最后 ≤cap 字节。
    // （2026-09-15 保尾不变式修：原「整块弃最旧」在末块小时会把含尾部数据的
    // 倒数第二块整块丢弃——尾部最多丢一个 data 块〔可达 64KiB〕，04 §11「保
    // 后半」语义被 data 分块边界破坏〔CI run 34962693484 macos 腿实录〕）
    const excess = this.totalBytes - this.cap;
    if (excess > 0) {
      let remaining = excess;
      while (remaining > 0 && this.chunks.length > 0) {
        const oldest = this.chunks[0];
        if (oldest === undefined) break;
        if (oldest.bytes.byteLength <= remaining) {
          this.chunks.shift();
          this.totalBytes -= oldest.bytes.byteLength;
          this.droppedBytes += oldest.bytes.byteLength;
          remaining -= oldest.bytes.byteLength;
        } else {
          this.chunks[0] = { stream: oldest.stream, bytes: oldest.bytes.subarray(remaining) };
          this.totalBytes -= remaining;
          this.droppedBytes += remaining;
          remaining = 0;
        }
      }
    }
  }

  /** 结算：按流增量解码归并（分块边界不劈多字节字符） */
  finish(): { stdout: string; stderr: string; truncated: boolean; bytes: number } {
    // 每流一个增量解码器 + 累积面——decode(part, {stream:true}) 的返回值是本批
    // 已解码文本（解码器内部只留存尾部未完序列不存产出），丢弃返回值 = 丢文本
    const decoders = {
      stdout: new TextDecoder('utf-8'),
      stderr: new TextDecoder('utf-8'),
    };
    let stdout = '';
    let stderr = '';
    for (const chunk of this.chunks) {
      const text = decoders[chunk.stream].decode(chunk.bytes, { stream: true });
      if (chunk.stream === 'stdout') stdout += text;
      else stderr += text;
    }
    // 终了 flush：补出留存在解码器内的尾部未完序列（替换符或空）
    stdout += decoders.stdout.decode();
    stderr += decoders.stderr.decode();
    // 实收总量含已丢弃——披露真实体量（「输出被截了多少」模型可自知）
    return {
      stdout,
      stderr,
      truncated: this.droppedBytes > 0,
      bytes: this.totalBytes + this.droppedBytes,
    };
  }
}
