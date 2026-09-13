/**
 * 结算通知文案构建（04 §10 两种收场——纯函数单源）。
 *
 * background 子代理终态时向父会话注入一条 UserMessage
 * （source='subagent-settled'）——父 run 在飞走 steer、不在飞走 followUp
 * 起跑。content 由本件单源构建，组合根桥 driver.submit 落三通道。
 * 文案纪律：结果与降级上报（diagnostic）如实呈现——「完成了但父永远
 * 不知道」不存在，伪装形态（工具没成功过的主张以成功口吻陈述）由
 * diagnostic 面（provider 上报）+ finish gate 对账（后续批）拦截。
 */
import type { SubagentResult } from '../contracts/index.js';

/** 通知内输出预览帽（人读通知不刷屏——全文在子会话日志可回看） */
const OUTPUT_PREVIEW_MAX = 512;

/** 输出预览截断（保头——通知是索引非全文载体） */
function preview(text: string): string {
  if (text.length <= OUTPUT_PREVIEW_MAX) return text;
  return `${text.slice(0, OUTPUT_PREVIEW_MAX)}…（已截断——全文见子会话日志）`;
}

/** 终态人读词（stopReason → 通知文案行） */
function stopWord(stopReason: SubagentResult['stopReason']): string {
  if (stopReason === 'stop') return '已完成';
  if (stopReason === 'aborted') return '已中止';
  return '失败';
}

/**
 * 结算通知的子会话指针行（RP3——收果拉取面轻量案：通知携指针非全文）。
 * 取数自宿主机器账（in-process 工厂铸造位 structured）——第三方 provider
 * 自有形无此字段则指针行诚实缺席（防御 guard：只认 in-process v1 形的
 * string childSessionId + number messageCount，缺任一即视无指针）。
 */
function childSessionPointerLine(result: SubagentResult): string | undefined {
  const account = result.structured;
  if (account === null || typeof account !== 'object') return undefined;
  const { childSessionId, messageCount } = account as { childSessionId?: unknown; messageCount?: unknown };
  if (typeof childSessionId !== 'string' || childSessionId === '') return undefined;
  if (typeof messageCount !== 'number' || !Number.isInteger(messageCount) || messageCount < 0) {
    return undefined;
  }
  return `子会话 ${childSessionId}（${messageCount} 条消息）`;
}

/**
 * 结算通知 content（subagent-settled 注入体的唯一文案真源）。
 */
export function subagentSettledContent(input: { jobName: string; result: SubagentResult }): string {
  const { jobName, result } = input;
  const lines = [`子代理「${jobName}」${stopWord(result.stopReason)}。`];
  const pointer = childSessionPointerLine(result);
  if (pointer !== undefined) lines.push(pointer);
  if (result.output !== '') lines.push(`输出：${preview(result.output)}`);
  // 降级上报如实呈现（禁伪装——上报表是知情面三律之一）
  if (result.diagnostic !== undefined && result.diagnostic !== '') {
    lines.push(`诊断：${result.diagnostic}`);
  }
  return lines.join('\n');
}
