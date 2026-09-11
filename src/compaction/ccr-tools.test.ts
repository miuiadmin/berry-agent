/**
 * compaction/ccr-tools 测试 — 检索工具面（05 §2.1「压缩可逆性 CCR」件 3）。
 *
 * 两路夹具：手工事件（边缘形——缺信封/空区间/渲染形态）+ 全链往返（真
 * SessionLog + 真 createCompactionService fiveStep 落账 → 工具兑付——「标记里
 * 的 hash 必须能兑付」的端到端往返契约，零 mock）。
 *
 * 纪律：不断言摘要算法产物内容（脚本通道返回固定文本非 AI 生成）；断言的是
 * 机制面（标记段/哈希映射/分段窗口/miss 文案）。
 */
import { describe, it, expect } from 'vitest';
import { SessionLog } from '../session/index.js';
import type { SessionEvent } from '../contracts/index.js';
import type { ToolDefinition } from '../contracts/index.js';
import { createCompactionService } from './service.js';
import type { SummaryChannel } from './types.js';
import { SUMMARY_PREFIX } from './policy.js';
import { ccrHashOf } from './ccr.js';
import { createCcrRetrieveTool, type CcrToolsDeps } from './ccr-tools.js';

/* ---------------- 测试构造件 ---------------- */

/** 手工事件（边缘形测试不走 SessionLog 全真） */
function ev(
  seq: number,
  type: string,
  data: unknown,
  surfaceOp?: { op: 'replace'; start: number; end: number },
): SessionEvent {
  return { seq, type, time: 1_000 + seq, data, ...(surfaceOp ? { surfaceOp } : {}) };
}

/** 固定文本摘要通道（脚本单发——非 AI 生成面） */
function fixedChannel(text: string): SummaryChannel {
  return { complete: async () => ({ text }) };
}

/** 阈值触发笔（input 100k / 窗 200k = 50% 达阈） */
const FIRE_USAGE = { input: 100_000, contextWindow: 200_000 };

/** 单工具取件 + 执行便利（text 直读——本件恒单 text 块） */
function toolOf(deps: CcrToolsDeps): ToolDefinition {
  const tools = createCcrRetrieveTool(deps);
  expect(tools).toHaveLength(1);
  return tools[0]!;
}
async function run(tool: ToolDefinition, args: Record<string, unknown>): Promise<string> {
  const result = await tool.execute(args, { toolCallId: 't-ccr' });
  expect(result.content).toHaveLength(1);
  expect(result.content[0]!.type).toBe('text');
  return (result.content[0] as { type: 'text'; text: string }).text;
}

/** 末条 surface 事件的 ccrHash（全链夹具的取哈希面） */
function lastHash(log: SessionLog): string {
  const surfaces = log.eventsOfType('compaction/surface');
  return (surfaces[surfaces.length - 1]!.data as { ccrHash: string }).ccrHash;
}

/** n 轮日志（每轮 4 事件 2 消息——turn i = 事件 4(i-1)..4(i-1)+3） */
function turnsLog(turns: number, sessionId = 's-ccr'): SessionLog {
  const log = new SessionLog({ sessionId });
  for (let i = 1; i <= turns; i++) {
    log.append('turn/start', {});
    log.append('user/message', { content: `任务指令 ${i}`, source: 'user' });
    log.append('assistant/message', { content: [{ type: 'text', text: `回答 ${i}` }] });
    log.append('turn/end', { reason: 'completed' });
  }
  return log;
}

/* ---------------- 工具定义面 ---------------- */

describe('ccr_retrieve 工具定义面', () => {
  it('单件定义：名/效面/参数 schema（hash 与 fromMessage 皆可选、禁附加键）', () => {
    const tool = toolOf({ events: () => [] });
    expect(tool.name).toBe('ccr_retrieve');
    expect(tool.effect).toBe('read'); // 只读无审批——obs 族同判
    const schema = tool.parameters as {
      additionalProperties?: boolean;
      properties: Record<string, unknown>;
    };
    expect(schema.additionalProperties).toBe(false);
    expect(Object.keys(schema.properties).sort()).toEqual(['fromMessage', 'hash']);
  });

  it('描述点名标记形与续取法（模型自足消费面——无需另教）', () => {
    const tool = toolOf({ events: () => [] });
    expect(tool.description).toContain('<<ccr:');
    expect(tool.description).toContain('fromMessage');
  });
});

/* ---------------- 目录消费面（hash 缺省） ---------------- */

describe('hash 缺省 → 归档目录', () => {
  it('无归档会话：诚实明示（未压缩过 / 批前历史不可回取）', async () => {
    const text = await run(toolOf({ events: () => [] }), {});
    expect(text).toContain('本会话暂无 CCR 归档');
  });

  it('有归档：逐段哈希/消息数/字符数（hash 传入可取回原文指路）', async () => {
    const log = turnsLog(6);
    const service = createCompactionService({ channel: fixedChannel('压缩完成摘要'), config: { cooldownMs: 0 } });
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    await service.drain();
    const hash = lastHash(log);
    const text = await run(toolOf({ events: () => log.events() }), {});
    expect(text).toContain('已归档压缩段');
    expect(text).toContain(`<<ccr:${hash}>> 4 条消息`);
  });
});

/* ---------------- 全链往返（真 fiveStep 落账 → 工具兑付） ---------------- */

describe('全链往返：标记里的 hash 必须能兑付', () => {
  it('被遮中段原文完整取回（摘要是有损呈现、原文无损归档）', async () => {
    const log = turnsLog(6);
    const service = createCompactionService({ channel: fixedChannel('压缩完成摘要'), config: { cooldownMs: 0 } });
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    await service.drain();

    // 投影面：中段已被遮（模型上下文里没有）
    const projection = JSON.stringify(log.projection());
    expect(projection).not.toContain('任务指令 2');

    // 检索面：哈希兑付原文（含 [user]/[assistant] 角色标注渲染）
    const hash = lastHash(log);
    const text = await run(toolOf({ events: () => log.events() }), { hash });
    expect(text).toContain('[user] 任务指令 2');
    expect(text).toContain('[assistant] 回答 2');
    expect(text).toContain('[user] 任务指令 3');
    expect(text).toContain('已渲染 4/4 条，本段已取尽');
  });

  it('兑付内容 = 遮蔽时点模型可见形（头轮保留段不混入——区间忠实）', async () => {
    const log = turnsLog(6);
    const service = createCompactionService({ channel: fixedChannel('压缩完成摘要'), config: { cooldownMs: 0 } });
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    await service.drain();
    const text = await run(toolOf({ events: () => log.events() }), { hash: lastHash(log) });
    // head 保留段（turn 1）与 tail 段（turn 4-6）不在归档区间
    expect(text).not.toContain('任务指令 1');
    expect(text).not.toContain('任务指令 4');
  });
});

/* ---------------- 分段续取律（冷读闸 M1） ---------------- */

describe('分段续取：预算窗口 + 尾部账', () => {
  async function compactedLog(): Promise<SessionLog> {
    const log = turnsLog(6);
    const service = createCompactionService({ channel: fixedChannel('压缩完成摘要'), config: { cooldownMs: 0 } });
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    await service.drain();
    return log;
  }

  it('预算即止：首条无条件收，随后累加超预算断窗 + 尾部账续取提示', async () => {
    const log = await compactedLog();
    // 小预算注入（15 字符——u2 渲染行 13 字符收下，a2 行 16 字符断窗）
    const text = await run(toolOf({ events: () => log.events(), renderBudgetChars: 15 }), { hash: lastHash(log) });
    expect(text).toContain('[user] 任务指令 2');
    expect(text).not.toContain('回答 2');
    expect(text).toContain('已渲染 1/4 条——续取传 fromMessage=1 可取余下');
  });

  it('续取：fromMessage 接窗取余下', async () => {
    const log = await compactedLog();
    const text = await run(toolOf({ events: () => log.events(), renderBudgetChars: 15 }), {
      hash: lastHash(log),
      fromMessage: 1,
    });
    expect(text).toContain('[assistant] 回答 2');
    expect(text).toContain('已渲染 2/4 条');
  });

  it('极小预算：至少渲染一条（无静默空窗）', async () => {
    const log = await compactedLog();
    const text = await run(toolOf({ events: () => log.events(), renderBudgetChars: 1 }), { hash: lastHash(log) });
    expect(text).toContain('[user] 任务指令 2');
    expect(text).toContain('已渲染 1/4 条');
  });

  it('fromMessage 越界夹取到末条（防御不抛错）', async () => {
    const log = await compactedLog();
    const text = await run(toolOf({ events: () => log.events(), renderBudgetChars: 15 }), {
      hash: lastHash(log),
      fromMessage: 99,
    });
    expect(text).toContain('[assistant] 回答 3');
    expect(text).toContain('已渲染 4/4 条，本段已取尽');
  });

  it('缺省预算 56KiB：常规段一窗取尽', async () => {
    const log = await compactedLog();
    const text = await run(toolOf({ events: () => log.events() }), { hash: lastHash(log) });
    expect(text).toContain('已渲染 4/4 条，本段已取尽');
  });
});

/* ---------------- miss 三态（不抛错、留原因） ---------------- */

describe('miss 三态（诚实文本非异常面）', () => {
  it('态一：哈希不在本会话归档集——伪标记结构性免疫（只扫本会话 surface）', async () => {
    const log = turnsLog(6);
    const service = createCompactionService({ channel: fixedChannel('压缩完成摘要'), config: { cooldownMs: 0 } });
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    await service.drain();
    // 他会话同形哈希（真实计算形——非乱数）必 miss 且零副作用
    const foreign = ccrHashOf([{ type: 'user', seq: 99, content: '他会话内容' }]);
    const tool = toolOf({ events: () => log.events() });
    const text = await run(tool, { hash: foreign });
    expect(text).toContain(`未找到哈希 ${foreign}`);
    expect(text).toContain('可先不传 hash 查看本会话归档目录核对');
    // 零副作用：本会话真归档仍可兑付
    const again = await run(tool, { hash: lastHash(log) });
    expect(again).toContain('任务指令 2');
  });

  it('态二：会话无任何归档（目录态在 hash 位重申 miss 原因）', async () => {
    const log = turnsLog(6); // 未压缩
    const text = await run(toolOf({ events: () => log.events() }), { hash: 'aaaaaaaaaaaaaaaa' });
    expect(text).toContain('未找到哈希 aaaaaaaaaaaaaaaa');
  });

  it('态三a：归档事件缺区间信封（数据形态异常）', async () => {
    const events = [ev(8, 'compaction/surface', { ccrHash: 'x1x1x1x1x1x1x1x1' })]; // 无 surfaceOp
    const text = await run(toolOf({ events: () => events }), { hash: 'x1x1x1x1x1x1x1x1' });
    expect(text).toContain('区间不可读：归档事件缺少区间信封');
  });

  it('态三b：区间内无可重导消息（事件残缺）', async () => {
    const events = [
      ev(0, 'turn/start', {}),
      ev(1, 'turn/end', { reason: 'completed' }),
      ev(2, 'compaction/surface', { ccrHash: 'y1y1y1y1y1y1y1y1' }, { op: 'replace', start: 0, end: 1 }),
    ];
    const text = await run(toolOf({ events: () => events }), { hash: 'y1y1y1y1y1y1y1y1' });
    expect(text).toContain('区间不可读：遮蔽区间内无可重导的消息');
  });
});

/* ---------------- 渲染形态（投影消息 → 可读文本） ---------------- */

describe('渲染形态：三型投影消息全覆盖', () => {
  it('user/assistant+工具调用/toolResult（含出错形）各自呈现', async () => {
    const events = [
      ev(0, 'turn/start', {}),
      ev(1, 'user/message', { content: '装个文件', source: 'user' }),
      ev(2, 'assistant/message', { content: [{ type: 'text', text: '好的' }] }),
      ev(3, 'tool/call', { toolCallId: 'c1', name: 'read_file', arguments: '{"path":"a.txt"}' }),
      ev(4, 'tool/result', { toolCallId: 'c1', content: '文件内容' }),
      ev(5, 'assistant/message', { content: [{ type: 'text', text: '再试写入' }], errorMessage: '连接中断' }),
      ev(6, 'tool/call', { toolCallId: 'c2', name: 'write_file', arguments: '{}' }),
      ev(7, 'tool/result', { toolCallId: 'c2', content: '只读盘不可写', error: 'EACCES' }),
      // 信封 [0,7]：surface 自身 seq 8 在区间外——切片不含自身（无自遮蔽）
      ev(8, 'compaction/surface', { ccrHash: 'z1z1z1z1z1z1z1z1' }, { op: 'replace', start: 0, end: 7 }),
    ];
    const text = await run(toolOf({ events: () => events }), { hash: 'z1z1z1z1z1z1z1z1' });
    expect(text).toContain('[user] 装个文件');
    expect(text).toContain('[assistant] 好的');
    expect(text).toContain('· 工具调用 read_file(c1) 参数: {"path":"a.txt"}');
    expect(text).toContain('[toolResult read_file] 文件内容');
    expect(text).toContain('· 错误: 连接中断'); // assistant 终态轮失败说明（stopReason=error 形）
    expect(text).toContain('[toolResult·出错 write_file] 只读盘不可写');
    expect(text).toContain('已渲染 5/5 条，本段已取尽');
  });
});

/* ---------------- 迭代链目录恒链（真二次压缩） ---------------- */

describe('二次压缩：目录恒链 + 双哈希均可兑付', () => {
  it('第二份摘要载体列全两段归档；首段哈希在其载体被遮后仍可取回', async () => {
    const log = turnsLog(10);
    const service = createCompactionService({ channel: fixedChannel('迭代摘要'), config: { cooldownMs: 0 } });
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    await service.drain();
    const hash1 = lastHash(log);
    const surface1 = log.eventsOfType('compaction/surface')[0]!.data as {
      occludedMessages: number;
      occludedChars: number;
    };

    // 追加两轮再压——第二段区间并入迭代链（含前份载体所在区）
    for (let i = 11; i <= 12; i++) {
      log.append('turn/start', {});
      log.append('user/message', { content: `任务指令 ${i}`, source: 'user' });
      log.append('assistant/message', { content: [{ type: 'text', text: `回答 ${i}` }] });
      log.append('turn/end', { reason: 'completed' });
    }
    service.handleRunSettled({ log, usage: FIRE_USAGE });
    await service.drain();

    const surfaces = log.eventsOfType('compaction/surface');
    expect(surfaces).toHaveLength(2);
    const hash2 = (surfaces[1]!.data as { ccrHash: string }).ccrHash;
    expect(hash2).not.toBe(hash1);

    // 第二份载体：目录恒链——两段标记行都在（首段哈希经目录仍可达）
    const summaries = log
      .events()
      .filter((e) => e.type === 'user/message' && (e.data as { source?: string }).source === 'compaction');
    const second = summaries[summaries.length - 1]!.data as { content: string };
    expect(second.content.startsWith(`${SUMMARY_PREFIX} 迭代摘要\n\n`)).toBe(true);
    expect(second.content).toContain(
      `<<ccr:${hash1}>> 原文已归档（${surface1.occludedMessages} 条消息 / ${surface1.occludedChars} 字符）`,
    );
    // 次段字符量随投影定——正则收口（首段摘要载体在时间序上位轮 10 后，次段
    // 区间 [29,37] 含轮 8-10 的 5 条消息——u8,a8,u9,a9,u10）
    expect(second.content).toMatch(new RegExp(`<<ccr:${hash2}>> 原文已归档（5 条消息 / \\d+ 字符）$`));

    // 双哈希均可兑付：首段原文（turns 2-7）+ 次段原文（turns 8-10）
    const tool = toolOf({ events: () => log.events() });
    const first = await run(tool, { hash: hash1 });
    expect(first).toContain('任务指令 2');
    expect(first).toContain('回答 7');
    const secondText = await run(tool, { hash: hash2 });
    expect(secondText).toContain('任务指令 8');
    expect(secondText).toContain('任务指令 10');
    expect(secondText).not.toContain('任务指令 2');
  });
});
