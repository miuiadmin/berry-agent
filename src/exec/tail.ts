/**
 * 输出保尾器（04 §11：stdout/stderr 合计截尾保后半 60KiB）。
 *
 * 合计帽语义：两流按到达序共享同一字节预算——超预算时弃头部保尾部（尾部
 * 才有失败现场：栈迹/错误摘要在尾）。实现 = 到达序分块账本（每块记来源流
 * 与字节），超帽先整块弃最旧，仅剩单块仍超帽时劈尾保后半。
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
    // 整块弃最旧（块级粒度：read() 边界的块不必劈——留最后一块保证有现场）
    while (this.chunks.length > 1 && this.totalBytes > this.cap) {
      const oldest = this.chunks.shift();
      if (oldest === undefined) break;
      this.totalBytes -= oldest.bytes.byteLength;
      this.droppedBytes += oldest.bytes.byteLength;
    }
    // 仅剩单块仍超帽：劈尾保后半（单块 100KiB 帽 60KiB 形）
    const only = this.chunks[0];
    if (only !== undefined && this.totalBytes > this.cap) {
      const drop = this.totalBytes - this.cap;
      this.chunks[0] = { stream: only.stream, bytes: only.bytes.subarray(drop) };
      this.totalBytes = this.cap;
      this.droppedBytes += drop;
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
