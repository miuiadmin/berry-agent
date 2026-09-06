/**
 * fetch 工具件（消费面一——模型消费；02 §4.1 席 18「fetch 工具」）。
 *
 * 工具面 = WebFetchService 的薄包装：参数 schema 收紧（方法词表/头表/体）
 * + 卫生拦截码转 isError 数据面（一切失败编码为结果——03 §2.3 工具契约）
 * + 应答拼模型可见文本（元信息头 + 正文——承 berry fetch 头形思路：URL/
 *   Content-Type/跳转/截断记全披露，正文分隔线下置）。effect 'read'：GET/
 *   POST 皆模型读世界动作，不触发审批对与可写根（写盘另有 fs 族——fetch
 *   不落盘）。
 *
 * consumer 标注 'tool'——归因落账与 ctx.fetch 服务消费（'service'）、browser
 * 导航（'navigate'）三面可区分（同一 execute 路径）。
 */
import { BaseError, type AgentToolResult, type ToolDefinition } from '../contracts/index.js';
import { Type } from 'typebox';
import type { WebFetchService } from './types.js';

/** 工具面方法词表（服务面不收紧——插件经 ctx.fetch 可用任意标准方法） */
const TOOL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'] as const;

/**
 * fetch 工具定义工厂（装载批由装配根经插件注册面挂入工具注册表）。
 * @param service 三消费面共用的 execute 载体（与 ctx.fetch 服务同一实例）
 */
export function createFetchTool(service: WebFetchService): ToolDefinition {
  return {
    name: 'fetch',
    description:
      '发起 HTTP(S) 请求取回文本响应（GET 缺省；可 POST/PUT/PATCH/DELETE/HEAD）。' +
      '自动跟随重定向（上限 5 跳）；响应体上限 1 MiB、超限截断并在回执标注；' +
      '仅接受 UTF-8 文本（二进制/非 UTF-8 拒）。内网地址（私网/环回段）被' +
      '安全卫生件拒绝。回执含最终 URL、状态码、Content-Type 与字节数。',
    parameters: Type.Object(
      {
        url: Type.String({ description: '完整 URL（须含 http:// 或 https:// 协议）' }),
        method: Type.Optional(Type.Union(TOOL_METHODS.map((m) => Type.Literal(m)))),
        headers: Type.Optional(Type.Record(Type.String(), Type.String(), { description: '请求头（可选）' })),
        body: Type.Optional(Type.String({ description: '请求体（POST/PUT/PATCH 用；字符串形）' })),
      },
      { additionalProperties: false },
    ),
    effect: 'read',
    execute: async (args, toolCtx): Promise<AgentToolResult> => {
      // 管道已按 schema 校验；此处窄化取参（缺省腿全在场判定）
      const url = String(args.url);
      const method = typeof args.method === 'string' ? args.method : 'GET';
      const headers =
        args.headers && typeof args.headers === 'object' && !Array.isArray(args.headers)
          ? (Object.fromEntries(
              Object.entries(args.headers as Record<string, unknown>).filter(
                (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
            ) as Record<string, string>)
          : undefined;
      const body = typeof args.body === 'string' ? args.body : undefined;
      try {
        const response = await service.fetch(url, {
          method,
          ...(headers ? { headers } : {}),
          ...(body !== undefined ? { body } : {}),
          ...(toolCtx.signal ? { signal: toolCtx.signal } : {}),
          consumer: 'tool',
        });
        // 元信息头 + 分隔线 + 正文（截断记显式披露——模型自知内容不完整）
        const meta = [
          `URL: ${response.finalUrl}`,
          `Status: ${response.status}`,
          `Content-Type: ${response.contentType || '未知'}`,
          `Bytes: ${response.bytes}${response.truncated ? `（超上限截断——原文更长）` : ''}`,
          ...(response.redirects > 0 ? [`Redirects: ${response.redirects} 跳（入口 ${response.url}）`] : []),
        ];
        return {
          content: [{ type: 'text', text: `${meta.join('\n')}\n\n---\n\n${response.body}` }],
        };
      } catch (error) {
        // 一切失败编码为 isError 数据面（03 §2.3）——BaseError 携码前置披露
        // （判别收紧：Node 系统错误也带 code 属性，只认注册码体系成员）
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
