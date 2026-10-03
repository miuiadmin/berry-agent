/**
 * 跨通道时刻/耗时格式单源（07 §4.1 V-0 注④整秒定值——任务行括号段 / turn
 * 收尾行 / 工具超时人读形三面真同源零分叉；formatClockHM 取消形时刻段同族
 * 收编）。原居 channels/tui/status/task-status-line，2026-10-02 TUI 视觉重设计
 * 批 V-2 笔 1 迁入：webui 客户端（DOM 类型面——不可拉 TUI engine/theme 图）
 * 与 tools（DAG 不邻 channels）双消费面所需，env-ref / redact 同律零新边纯件。
 *
 * 2026-10-04 收尾行段拼装双站单源化批扩域：run 收尾行段集/整行构造 + 用户面
 * 段串接（『 · 』间隔号）自本件供出——webui frames（runCloseLine）与
 * tui-backend（appendClosingLine）原为逐字同构双拷贝（连「段形随规范真源」
 * 注释都双份），自此段形知识单源。
 */

/**
 * 紧凑耗时格式：0s（亚秒）/ Ns / Nm NNs / Nh NNm NNs——秒位两位补零
 * （1m 02s）、分级段不补（1h 00m 00s）。
 */
export function formatElapsedCompact(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 1) return '0s';
  if (totalSec < 60) return `${totalSec}s`;
  const totalMin = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (totalMin < 60) return `${totalMin}m ${String(sec).padStart(2, '0')}s`;
  const hours = Math.floor(totalMin / 60);
  const min = totalMin % 60;
  return `${hours}h ${String(min).padStart(2, '0')}m ${String(sec).padStart(2, '0')}s`;
}

/**
 * Unix 毫秒 → 24 小时制 HH:MM（本地时区——取消形收尾行时刻段双通道同源）。
 * 原两处逐字克隆（channels/tui/backend 收尾行 / webui 客户端取消回执），
 * 2026-10-03 V-4 扫描处置批收编单源（formatElapsedCompact 同族位）——
 * 双消费面（tui-backend 收尾行 / webui frames 取消回执）均已改引本源。
 */
export function formatClockHM(unixMs: number): string {
  const d = new Date(unixMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * 用户面段串接：各段以「 · 」（前后各一空格的全角间隔号）串接，空串段跳过
 * （调用侧按态拼段时守卫省写）。跨通道状态/数值段拼装单源——键位提示行域
 * （keys/hint.ts hintLine，07 §4.4 律三）语义独立不共用本件：律三钉的是
 * 「键名+动作词」行族，本件管数值/状态段族，两域各自单源。
 */
export function joinSegments(...segments: string[]): string {
  return segments.filter((segment) => segment !== '').join(' · ');
}

/** run 收尾行段集输入（耗时终值或诚实缺席 null——真源序折取在调用侧） */
export interface RunRecapInput {
  readonly durationMs: number | null;
  readonly toolCount: number;
  readonly retryCount: number;
}

/**
 * run 收尾行段集构造（07 §4.1 V-0 注④族——收尾行三面真同源）：用时/
 * 工具次数/重试三段序，段形随规范真源——**重试段无「次」字**；工具/重试
 * 双零段缺席（「纯对话轮整行缺席」的双零判据在调用侧——本函数只管段集，
 * 双零入参返回空集）。双站逐字同构收编：webui frames runCloseLine /
 * tui-backend appendClosingLine（2026-10-04）。
 */
export function runRecapSegments(input: RunRecapInput): string[] {
  const segments: string[] = [];
  if (input.durationMs !== null) segments.push(`用时 ${formatElapsedCompact(input.durationMs)}`);
  if (input.toolCount > 0) segments.push(`工具 ${input.toolCount} 次`);
  if (input.retryCount > 0) segments.push(`重试 ${input.retryCount}`); // 段形随规范真源：重试段无「次」字
  return segments;
}

/**
 * run 收尾行整行（`── 段 · 段 ──` 段头段尾横线）：色壳不归本件——tui 侧
 * SGR 弱线色包壳在调用侧（appendTransientLine 纯文本路的 ANSI 感知收口），
 * webui 侧无色直用。段集空时返回空段头（调用侧双零判据已拦，此形仅防御）。
 */
export function runRecapLine(input: RunRecapInput): string {
  return `── ${joinSegments(...runRecapSegments(input))} ──`;
}
