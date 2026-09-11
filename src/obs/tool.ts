/**
 * obs — obs_query 只读工具件（03 §10.8；fetch 工具同款薄包装先例）。
 *
 * 参数面 typebox schema（07 schema 层宿主件直用同律）+ 回执文本表格
 * （usage 行主计费桶与 cache 分列——模型可见）。effect 'read'：聚合查询
 * 是模型读观测面动作，零写权。装载归批 12 装配面（createObsQueryTool
 * 工厂——与 createFetchTool 同款接线位）。
 */
import { BaseError, type AgentToolResult, type ToolDefinition } from '../contracts/index.js';
import { Type } from 'typebox';
import type { ObsEventsRow, ObsQueryRow, ObsService, ObsUsageRow } from './types.js';

/** 桶起点格式化（ISO UTC 整点/整日——存储客观、呈现换算的第一面） */
function formatBucket(bucket: number): string {
  return new Date(bucket).toISOString().replace('.000Z', 'Z');
}

/** 用量行文本（列对齐——主计费桶与 cache 桶分列 + 命中率派生列〔RP5〕） */
function usageLine(row: ObsUsageRow): string {
  const main = row.input + row.output;
  return [
    formatBucket(row.bucket),
    `calls=${row.calls}`,
    `main(in+out)=${main}`,
    `cache_read=${row.cacheRead}`,
    `cache_write=${row.cacheWrite}`,
    `cache_write_1h=${row.cacheWrite1h}`,
    `reasoning=${row.reasoning}`,
    // 命中率呈现：null = 桶内无 token 流（诚实缺席）；有值取两位百分比
    `hit_rate=${row.hitRate === null ? 'n/a' : `${(row.hitRate * 100).toFixed(2)}%`}`,
  ].join('  ');
}

/** 事件计数行文本 */
function eventsLine(row: ObsEventsRow): string {
  return `${formatBucket(row.bucket)}  ${row.eventType}  count=${row.count}`;
}

/**
 * obs_query 工具定义工厂（装载批由装配根经插件注册面挂入工具注册表）。
 * @param service obs 服务句柄（与告警/摄取同一实例）
 */
export function createObsQueryTool(service: ObsService): ToolDefinition {
  return {
    name: 'obs_query',
    description:
      '查询观测聚合（durable 事件流的小时/日桶统计）。metric=events 返回各事件类型' +
      '计数；metric=usage 返回 LLM token 用量聚合（input/output 主计费桶与 cache 桶' +
      '分列，token 原始值——不折算货币；hit_rate = 缓存命中率派生列 cacheRead/' +
      '(input+cacheRead+cacheWrite) 桶内聚合比值，n/a = 桶内无 token 流）。桶时刻 ' +
      'UTC 对齐。窗口 from/to 为 epoch 毫秒（含边界）；行上限缺省 100、硬帽 1000，' +
      '按时间正序返回。',
    parameters: Type.Object(
      {
        granularity: Type.Union([Type.Literal('hour'), Type.Literal('day')], {
          description: '粒度：hour = 小时桶；day = 日桶（仅含已闭合日）',
        }),
        metric: Type.Optional(
          Type.Union([Type.Literal('events'), Type.Literal('usage')], {
            description: '指标：events = 事件计数（缺省）；usage = LLM 用量聚合',
          }),
        ),
        from: Type.Optional(Type.Number({ description: '窗口下界（epoch 毫秒，含）' })),
        to: Type.Optional(Type.Number({ description: '窗口上界（epoch 毫秒，含）' })),
        eventType: Type.Optional(Type.String({ description: '事件类型过滤（仅 metric=events 有效）' })),
        limit: Type.Optional(Type.Number({ description: '行上限（缺省 100、硬帽 1000）' })),
      },
      { additionalProperties: false },
    ),
    effect: 'read',
    execute: async (args): Promise<AgentToolResult> => {
      try {
        const rows: readonly ObsQueryRow[] = service.query({
          granularity: args.granularity === 'day' ? 'day' : 'hour',
          metric: args.metric === 'usage' ? 'usage' : 'events',
          ...(typeof args.from === 'number' ? { from: args.from } : {}),
          ...(typeof args.to === 'number' ? { to: args.to } : {}),
          ...(typeof args.eventType === 'string' ? { eventType: args.eventType } : {}),
          ...(typeof args.limit === 'number' ? { limit: args.limit } : {}),
        });
        if (rows.length === 0) {
          return { content: [{ type: 'text', text: '（窗口内无聚合行）' }] };
        }
        const header =
          args.metric === 'usage'
            ? 'bucket  calls  main(in+out)  cache_read  cache_write  cache_write_1h  reasoning  hit_rate'
            : 'bucket  event_type  count';
        const lines = rows.map((row) => ('eventType' in row ? eventsLine(row) : usageLine(row)));
        return { content: [{ type: 'text', text: [header, ...lines].join('\n') }] };
      } catch (error) {
        // 一切失败编码为 isError 数据面（03 §2.3）——BaseError 携码前置披露
        const code = error instanceof BaseError ? error.code : undefined;
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: code ? `[${code}] ${message}` : message }],
          isError: true,
        };
      }
    },
  };
}
