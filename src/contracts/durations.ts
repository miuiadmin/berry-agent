/**
 * 跨通道时刻/耗时格式单源（07 §4.1 V-0 注④整秒定值——任务行括号段 / turn
 * 收尾行 / 工具超时人读形三面真同源零分叉；formatClockHM 取消形时刻段同族
 * 收编）。原居 channels/tui/status/task-status-line，2026-10-02 TUI 视觉重设计
 * 批 V-2 笔 1 迁入：webui 客户端（DOM 类型面——不可拉 TUI engine/theme 图）
 * 与 tools（DAG 不邻 channels）双消费面所需，env-ref / redact 同律零新边纯件。
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
