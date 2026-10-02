/**
 * 紧凑耗时格式单源（07 §4.1 V-0 注④整秒定值——任务行括号段 / turn 收尾行 /
 * 工具超时人读形三面真同源零分叉）。原居 channels/tui/status/task-status-line，
 * 2026-10-02 TUI 视觉重设计批 V-2 笔 1 迁入：webui 客户端（DOM 类型面——不可
 * 拉 TUI engine/theme 图）与 tools（DAG 不邻 channels）双消费面所需，env-ref /
 * redact 同律零新边纯件。
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
