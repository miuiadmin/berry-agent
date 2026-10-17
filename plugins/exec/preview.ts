/**
 * 流式活预览抽头（04 §8 流式活预览批②——纯逻辑腿，仅依赖 contracts 类型面）。
 *
 * bash 是旗舰工具（缺省 120s/上限 600s 帽），修前运行期 TUI 零输出可见——
 * 本件把 spawn 管道的 onData 抽头流加工成 tool_execution_update 载荷：
 *
 *   两流增量宽容解码合并（到达序）→ 尾窗钳尾 2KiB → trailing 节流 400ms 发
 *   `{content:[{type:'text',text}]}` 形（07 §4.1 件 5 面板宽容解码 AgentToolResult
 *   形零改承接——呈现面零改动）。
 *
 * 节流与清账语义：首帧只走计时器（短命命令零帧——面板行非承诺，终卡即刻
 * 到）；dispose 末窗冲刷**仅刷新已建行**（发过帧才冲刷待发窗——末行确定
 * 呈现；零帧短命令不凭空造行）；dispose 后零新发射，迟到发射由 loop 侧
 * accepting 旗兜底丢弃。timer unref（不阻进程退出）。时钟面测试走 vitest
 * 假钟（设计档 now 注入口省略形——advanceTimersByTime 等价覆盖步进语义）。
 */
import type { ToolUpdateCallback } from '../../src/contracts/index.js';

/** 节流定值（04 §8 批⑤：面板单行换装 2.5Hz——足「活」且帧量温和；webui update 帧本列背压可丢） */
export const BASH_PREVIEW_INTERVAL_MS = 400;

/** 载荷钳尾窗（04 §8 批⑤：末行呈现窗 2KiB） */
export const BASH_PREVIEW_TAIL_BYTES = 2 * 1024;

/** 抽头选项（测试注入口——缺省常量形；生产装配不传） */
export interface StreamPreviewOptions {
  /** 节流间隔毫秒（缺省 BASH_PREVIEW_INTERVAL_MS；测试注小值） */
  readonly intervalMs?: number;
  /** 钳尾字节（缺省 BASH_PREVIEW_TAIL_BYTES） */
  readonly tailBytes?: number;
}

/** 抽头面（SpawnRequest.onData 直供形——bash.ts 装配腿唯一消费） */
export interface StreamPreviewTap {
  /** 挂 SpawnRequest.onData（随到随调——三律见 types.ts onData 键） */
  onData(stream: 'stdout' | 'stderr', chunk: Uint8Array): void;
  /** 计时器清账（pipeline.run 结算后必调：已建行冲刷待发窗、此后零新发射） */
  dispose(): void;
}

/**
 * 取字节窗尾部至多 maxBytes 字节（UTF-8 安全：起点落在多字节字符中段则前移
 * 过续字节——不劈 U+FFFD；与 tools/pipeline.ts tailBytes 同律，本件内自持）。
 */
function clampTailBytes(buf: Buffer, maxBytes: number): Buffer {
  if (maxBytes <= 0 || buf.length <= maxBytes) return buf;
  let start = buf.length - maxBytes;
  while (start > 0 && start < buf.length && (buf[start]! & 0xc0) === 0x80) start++;
  return buf.subarray(start);
}

/**
 * 建流式活预览抽头：onUpdate 在场才由调用方建（缺席零行为——bash.ts 装配腿
 * 判定）；本函数恒活到 dispose。
 */
export function createStreamPreview(onUpdate: ToolUpdateCallback, options?: StreamPreviewOptions): StreamPreviewTap {
  const intervalMs = options?.intervalMs ?? BASH_PREVIEW_INTERVAL_MS;
  const tailBytes = options?.tailBytes ?? BASH_PREVIEW_TAIL_BYTES;
  // 两流解码器分立（同流分块边界不劈多字节字符——tail.ts finish 同律），解码
  // 产出按到达序合并；窗持有已解码文本的 UTF-8 字节（钳尾在字节面、发射在
  // 文本面）。
  const decoders: Record<'stdout' | 'stderr', TextDecoder> = {
    stdout: new TextDecoder('utf-8'),
    stderr: new TextDecoder('utf-8'),
  };
  let window = Buffer.alloc(0) as Buffer;
  let timer: NodeJS.Timeout | undefined;
  let dirty = false;
  let emitted = false; // 已建行（首帧只走计时器——dispose 冲刷腿的判据）
  let disposed = false;

  const emit = (): void => {
    timer = undefined;
    if (!dirty) return;
    dirty = false;
    emitted = true;
    onUpdate({ content: [{ type: 'text', text: window.toString('utf8') }] });
  };

  return {
    onData(stream, chunk) {
      if (disposed || chunk.byteLength === 0) return;
      const text = decoders[stream].decode(chunk, { stream: true });
      if (text !== '') {
        window = clampTailBytes(Buffer.concat([window, Buffer.from(text, 'utf8')]), tailBytes);
      }
      dirty = true;
      // trailing 节流：首块起算一窗，窗内多块合并、到点发最新尾窗
      if (timer === undefined) {
        timer = setTimeout(emit, intervalMs);
        timer.unref(); // 不阻进程退出（宿主收尾不等呈现面）
      }
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      // 末窗冲刷仅刷新已建行：发过帧才冲刷待发窗（末行确定呈现）；零帧短命令
      // 不凭空造行（面板行非承诺——终卡即刻到）。冲刷后零新发射。
      if (dirty && emitted) {
        dirty = false;
        onUpdate({ content: [{ type: 'text', text: window.toString('utf8') }] });
      }
      dirty = false;
    },
  };
}
